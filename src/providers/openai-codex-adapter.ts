/**
 * openai-codex-adapter.ts
 *
 * Dedicated adapter for OpenAI Codex via ChatGPT Plus/Pro OAuth.
 * Uses https://chatgpt.com/backend-api/codex/responses — NOT /v1/chat/completions.
 *
 * Required headers:
 *   Authorization: Bearer <api_token>        (from OAuth token exchange)
 *   ChatGPT-Account-Id: <account_id>         (from JWT claims)
 *   OpenAI-Beta: responses=experimental
 *
 * Response format: SSE stream, we read response.completed for the final output.
 * Tool calls come back as response.output items with type "function_call".
 */

import fs from 'fs';
import path from 'path';
import type { LLMProvider, ChatMessage, ContentPart, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo, ModelUsage } from './LLMProvider';
import { loadTokens, getValidToken, buildCodexCloudflareHeaders } from '../auth/openai-oauth';
import { isRetryableAccountFailure } from '../auth/provider-account-pool';
import { contentToString, stripCacheMarker } from './content-utils';
import { getConfig } from '../config/config';
import { normalizeReasoningEffort, normalizeSpeed } from './reasoning-capabilities';

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
function envMs(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
const CODEX_REQUEST_TIMEOUT_MS = envMs('PROMETHEUS_CODEX_REQUEST_TIMEOUT_MS', 900_000, 60_000);
const CODEX_STREAM_IDLE_TIMEOUT_MS = envMs('PROMETHEUS_CODEX_STREAM_IDLE_TIMEOUT_MS', 300_000, 60_000);
const DEFAULT_CODEX_INSTRUCTIONS = 'You are Prometheus, a helpful AI assistant. Answer the user directly and follow the conversation context.';

export interface CodexStreamDiagnostics {
  failureClass?: 'missing_completed' | 'empty_completion';
  sawCompleted: boolean;
  eventTypes: string[];
  outputItemTypes: string[];
  outputItemCount: number;
  finalTextChars: number;
  toolCallCount: number;
  usage?: ModelUsage;
}

export class CodexIncompleteStreamError extends Error {
  readonly code = 'CODEX_INCOMPLETE_STREAM';
  readonly diagnostics: CodexStreamDiagnostics;

  constructor(message: string, diagnostics: CodexStreamDiagnostics) {
    super(message);
    this.name = 'CodexIncompleteStreamError';
    this.diagnostics = diagnostics;
  }
}

// Models available via Codex OAuth (latest first; official OpenAI IDs only).
// Model access depends on the connected account's provisioning.
export const CODEX_MODELS = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-codex',
  'gpt-5.4-codex-mini',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.3',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex',
  'gpt-5.1',
];

const CHATGPT_ACCOUNT_CODEX_MODEL_FALLBACKS: Record<string, string> = {
  'gpt-5.6-sol': 'gpt-5.5',
  'gpt-5.6-terra': 'gpt-5.5',
  'gpt-5.6-luna': 'gpt-5.5',
  'gpt-5.5': 'gpt-5.4',
  'gpt-5.4-codex': 'gpt-5.4',
  'gpt-5.4-codex-mini': 'gpt-5.4-mini',
  'gpt-5.3-codex': 'gpt-5.3',
  'gpt-5.3-codex-spark': 'gpt-5.3',
  'gpt-5.2-codex': 'gpt-5.2',
  'gpt-5.1-codex-max': 'gpt-5.1',
  'gpt-5.1-codex-mini': 'gpt-5.1',
  'gpt-5.1-codex': 'gpt-5.1',
};

function getChatgptAccountCompatibleModel(model: string): string {
  return CHATGPT_ACCOUNT_CODEX_MODEL_FALLBACKS[String(model || '').trim()] || String(model || '').trim();
}

function isUnsupportedChatgptAccountCodexModel(status: number, bodyText: string): boolean {
  return status === 400 && /not supported when using Codex with a ChatGPT account/i.test(String(bodyText || ''));
}

function writeCodexModelRuntimeStatus(status: {
  configuredModel: string;
  requestedModel: string;
  actualModel?: string;
  fallbackFrom?: string;
  fallbackReason?: string;
  ok: boolean;
  error?: string;
}): void {
  try {
    const filePath = path.join(getConfig().getConfigDir(), 'model-runtime-status.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      provider: 'openai_codex',
      timestamp: new Date().toISOString(),
      ...status,
      fallback: !!status.fallbackFrom,
    }, null, 2), 'utf-8');
  } catch {
    // Diagnostics must never break model calls.
  }
}

function parseUsage(usage: any): ModelUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  const reasoningTokens = Number(
    usage.output_tokens_details?.reasoning_tokens
    || usage.completion_tokens_details?.reasoning_tokens
    || 0,
  );
  // Codex Responses API reports automatic prompt-cache hits here (subset of
  // input_tokens). Surfaced for cache hit-ratio observability only.
  const cacheReadTokens = Number(
    usage.input_tokens_details?.cached_tokens
    || usage.prompt_tokens_details?.cached_tokens
    || 0,
  );
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens + reasoningTokens));
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    totalTokens,
    source: 'provider',
  };
}

// Reasoning effort levels accepted by the Codex Responses API.
// Maps Prometheus-internal "think" hints → the literal effort string sent in the request body.
export const CODEX_EFFORT_MAP: Record<string, string> = {
  // Recover legacy values as the lowest supported public effort.
  none: 'low',
  minimal: 'low',
  fast: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra_high: 'xhigh',
  xhigh: 'xhigh',
  ultra: 'ultra',
  max: 'max',
};

export class OpenAICodexAdapter implements LLMProvider {
  readonly id = 'openai_codex' as const;
  private configDir: string;
  private accountId?: string;
  private accountIds: string[] = [];

  constructor(config: string | { configDir: string; accountId?: string; accountIds?: string[] }) {
    if (typeof config === 'string') {
      this.configDir = config;
      return;
    }
    this.configDir = config.configDir;
    this.accountId = String(config.accountId || '').trim() || undefined;
    this.accountIds = Array.isArray(config.accountIds)
      ? config.accountIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
  }

  private getAccountCandidates(): Array<string | undefined> {
    const candidates = [this.accountId, ...this.accountIds]
      .map(id => String(id || '').trim())
      .filter((id, index, values) => id && values.indexOf(id) === index);
    return candidates.length ? candidates : [undefined];
  }

  private async getHeaders(accountId = this.accountId): Promise<Record<string, string>> {
    const token = await getValidToken(this.configDir, accountId);
    const tokens = loadTokens(this.configDir, accountId);
    const chatgptAccountId = tokens?.account_id || '';

    const headers: Record<string, string> = {
      ...buildCodexCloudflareHeaders(token, chatgptAccountId),
      'Content-Type':      'application/json',
      'Authorization':     `Bearer ${token}`,
      'OpenAI-Beta':       'responses=experimental',
      'Accept':            'text/event-stream',
    };
    return headers;
  }

  // Convert Prometheus ChatMessage[] -> Codex input[] format.
  // Handles both plain string content and ContentPart[] (multimodal vision calls).
  // Guarantees non-empty function call IDs for both function_call and function_call_output.
  private buildInput(messages: ChatMessage[]): any[] {
    const input: any[] = [];
    const pendingCallIds: string[] = [];
    const knownCallIds = new Set<string>();
    const consumedCallIds = new Set<string>();
    let fallbackSeq = 0;
    const nextFallbackCallId = () => `autocall_${Date.now()}_${++fallbackSeq}`;
    const asJsonArgumentString = (value: any): string => {
      if (typeof value === 'string') return value.trim() || '{}';
      if (value == null) return '{}';
      try {
        return JSON.stringify(value);
      } catch {
        return '{}';
      }
    };

    for (const m of messages) {
      if (m.role === 'system') continue; // system handled separately as instructions

      if (m.role === 'assistant' && m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          const callId = String(tc?.id || (tc as any)?.call_id || '').trim() || nextFallbackCallId();
          pendingCallIds.push(callId);
          knownCallIds.add(callId);
          input.push({
            type: 'function_call',
            call_id: callId,
            name: String(tc?.function?.name || ''),
            arguments: asJsonArgumentString(tc?.function?.arguments),
          });
        }
        continue;
      }

      if (m.role === 'tool') {
        let callId = String(m.tool_call_id || '').trim();
        if (!callId && pendingCallIds.length > 0) {
          callId = pendingCallIds.shift()!;
        }
        if (callId) {
          // Keep the pending queue in sync even when tool_call_id is explicitly provided.
          const idx = pendingCallIds.indexOf(callId);
          if (idx !== -1) pendingCallIds.splice(idx, 1);
        }
        if (!callId) {
          // Some internal orchestration paths emit informational "tool" messages
          // that are not outputs for a real function_call. Codex rejects those as
          // function_call_output without a matching call_id, so preserve them as
          // plain assistant text context instead.
          const toolName = String((m as any).tool_name || m.name || 'tool').slice(0, 80);
          const content = typeof m.content === 'string' ? m.content : '';
          input.push({
            role: 'assistant',
            content: `[tool-note:${toolName}] ${content}`.slice(0, 12000),
          });
          continue;
        }
        if (!knownCallIds.has(callId) || consumedCallIds.has(callId)) {
          // Guard against desync: never send function_call_output for unknown/duplicate IDs.
          // Preserve context as assistant text instead of hard-failing the whole request.
          const toolName = String((m as any).tool_name || m.name || 'tool').slice(0, 80);
          const content = typeof m.content === 'string' ? m.content : '';
          input.push({
            role: 'assistant',
            content: `[tool-note:${toolName}] ${content}`.slice(0, 12000),
          });
          continue;
        }
        consumedCallIds.add(callId);
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: typeof m.content === 'string' ? m.content : '',
        });
        continue;
      }

      // Multimodal content: convert ContentPart[] to Codex Responses API format.
      // The Codex endpoint accepts input_image with image_url as a string —
      // either an HTTPS URL or a data URL (data:image/...;base64,...).
      if (Array.isArray(m.content)) {
        const parts: any[] = m.content.map((part: ContentPart) => {
          if (part.type === 'text') return { type: 'input_text', text: part.text };
          if (part.type === 'image_url') {
            const url = part.image_url.url;
            // Codex endpoint accepts image_url as a string (data URL or HTTPS URL).
            return { type: 'input_image', image_url: url };
          }
          return { type: 'input_text', text: '' };
        });
        input.push({ role: m.role, content: parts });
        continue;
      }

      input.push({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      });
    }

    return input;
  }

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    const accountCandidates = this.getAccountCandidates();

    // Extract system message as instructions
    const systemMsg = messages.find(m => m.role === 'system');
    // Codex auto-caches on a stable instructions+input prefix; strip the cache
    // sentinel so it never reaches the model (it has no API role here).
    const instructions = (systemMsg ? stripCacheMarker(contentToString(systemMsg.content)) : '').trim()
      || DEFAULT_CODEX_INSTRUCTIONS;

    const hasTools = Array.isArray(options?.tools) && options!.tools!.length > 0;
    const _cfgRootCodex = getConfig().getConfig() as any;
    const _codexToolChoiceCfg = String(_cfgRootCodex?.llm?.providers?.openai_codex?.tool_choice || '').trim();
    const toolChoice = hasTools ? (_codexToolChoiceCfg === 'required' ? 'required' : 'auto') : 'auto';
    const input = this.buildInput(messages);

    const configuredModel = String(model || '').trim();
    const runRequest = async (
      requestedModel: string,
      allowFallback: boolean,
      fallbackFrom?: string,
      fallbackReason?: string,
      allowIncompleteStreamRetry = true,
      accountIndex = 0,
    ): Promise<ChatResult> => {
      const activeAccountId = accountCandidates[accountIndex];
      let headers: Record<string, string>;
      try {
        headers = await this.getHeaders(activeAccountId);
      } catch (error) {
        if (accountIndex + 1 < accountCandidates.length) {
          console.warn('[openai_codex] Selected account is unavailable; trying the next configured account.');
          return runRequest(requestedModel, allowFallback, fallbackFrom, fallbackReason, allowIncompleteStreamRetry, accountIndex + 1);
        }
        throw error;
      }
      const controller = new AbortController();
      const requestStartedAt = Date.now();
      let abortReason = '';
      let requestTimeout: ReturnType<typeof setTimeout> | null = null;
      let idleTimeout: ReturnType<typeof setTimeout> | null = null;
      const abortFor = (reason: string) => {
        if (controller.signal.aborted) return;
        abortReason = reason;
        controller.abort();
      };
      const clearTimers = () => {
        if (requestTimeout) clearTimeout(requestTimeout);
        if (idleTimeout) clearTimeout(idleTimeout);
        requestTimeout = null;
        idleTimeout = null;
      };
      const resetIdleTimer = () => {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          abortFor(`openai_codex stream had no activity for ${Math.round(CODEX_STREAM_IDLE_TIMEOUT_MS / 1000)}s`);
        }, CODEX_STREAM_IDLE_TIMEOUT_MS);
      };
      const onExternalAbort = () => abortFor('openai_codex request canceled by client');
      options?.abortSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
      requestTimeout = setTimeout(() => {
        abortFor(`openai_codex request exceeded ${Math.round(CODEX_REQUEST_TIMEOUT_MS / 1000)}s`);
      }, CODEX_REQUEST_TIMEOUT_MS);
      resetIdleTimer();

      const body: any = {
        model: requestedModel,
        store: false,
        input,
        stream: true,
        tool_choice: toolChoice,
        parallel_tool_calls: true,
      };
      body.instructions = instructions;
      // Reasoning effort support (Codex reasoning models).
      // Precedence: options.think (per-call override) → config reasoning_effort → default 'medium'.
      const cfgRoot = getConfig().getConfig() as any;
      const codexCfg = cfgRoot?.llm?.providers?.openai_codex || {};
      const configuredSpeed = options?.speed || codexCfg.speed || (codexCfg.fast_mode === true ? 'fast' : 'standard');
      if (normalizeSpeed('openai_codex', requestedModel, configuredSpeed) === 'fast') body.service_tier = 'priority';
      const configuredEffort = typeof codexCfg.reasoning_effort === 'string' ? codexCfg.reasoning_effort.trim() : '';
      if (options?.think !== false && (options?.think || configuredEffort)) {
        const rawEffort = options?.think
          ? (typeof options.think === 'string' ? options.think : 'medium')
          : configuredEffort;
        const mappedEffort = CODEX_EFFORT_MAP[rawEffort] || rawEffort;
        const effort = normalizeReasoningEffort('openai_codex', requestedModel, mappedEffort);
        if (effort) {
          body.reasoning = { effort, summary: 'auto' };
        }
      }
      if (process.env.PROMETHEUS_DEBUG_REASONING === '1') {
        console.log(`[openai_codex] reasoning ${body.reasoning ? `enabled effort=${body.reasoning.effort} summary=${body.reasoning.summary}` : 'disabled'} think=${String(options?.think)} configured=${configuredEffort || '(none)'}`);
      }
      if (Array.isArray(options?.tools) && options!.tools!.length) {
        body.tools = options!.tools.map((t: any) => ({
          type: 'function',
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || '',
          parameters: t.function?.parameters || t.parameters || {},
        }));
      }

      try {
        const response = await fetch(CODEX_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        resetIdleTimer();

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          if (isRetryableAccountFailure(response.status, text) && accountIndex + 1 < accountCandidates.length) {
            console.warn(`[openai_codex] Account request failed (${response.status}); trying the next configured account.`);
            return runRequest(requestedModel, allowFallback, fallbackFrom, fallbackReason, allowIncompleteStreamRetry, accountIndex + 1);
          }
          const fallbackModel = getChatgptAccountCompatibleModel(requestedModel);
          if (
            allowFallback
            && fallbackModel
            && fallbackModel !== requestedModel
            && isUnsupportedChatgptAccountCodexModel(response.status, text)
          ) {
            console.warn(`[openai_codex] Model "${requestedModel}" is unsupported for this ChatGPT account. Retrying with "${fallbackModel}".`);
            return runRequest(fallbackModel, false, requestedModel, 'unsupported_chatgpt_account_model', allowIncompleteStreamRetry, accountIndex);
          }
          writeCodexModelRuntimeStatus({
            configuredModel,
            requestedModel,
            ok: false,
            error: `HTTP_${response.status}`,
          });
          const providerError = new Error(`openai_codex API error ${response.status}`) as Error & { code?: string; status?: number };
          providerError.name = 'CodexProviderHttpError';
          providerError.code = 'CODEX_HTTP_ERROR';
          providerError.status = response.status;
          throw providerError;
        }

        const result = await this.parseSSEStream(response, requestedModel, options, resetIdleTimer);
        result.usage = {
          ...(result.usage || {}),
          requestedModel: configuredModel,
          actualModel: requestedModel,
          fallbackFrom,
          fallbackReason,
          accountId: activeAccountId,
        };
        writeCodexModelRuntimeStatus({
          configuredModel,
          requestedModel: configuredModel,
          actualModel: requestedModel,
          fallbackFrom,
          fallbackReason,
          ok: true,
        });
        return result;
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          throw new Error(abortReason || 'openai_codex request aborted');
        }
        if (err instanceof CodexIncompleteStreamError && allowIncompleteStreamRetry) {
          options?.onModelEvent?.({
            type: 'provider_event',
            nativeType: 'codex_incomplete_stream',
            provider: this.id,
            model: requestedModel,
            data: {
              ...err.diagnostics,
              requestedModel,
              accountIndex,
              attempt: allowIncompleteStreamRetry ? 1 : 2,
              retrying: allowIncompleteStreamRetry,
              durationMs: Math.max(0, Date.now() - requestStartedAt),
            },
          });
          console.warn(`[openai_codex] ${err.message} Retrying once.`);
          return runRequest(requestedModel, allowFallback, fallbackFrom, fallbackReason, false, accountIndex);
        }
        if (err instanceof CodexIncompleteStreamError) {
          options?.onModelEvent?.({
            type: 'provider_event',
            nativeType: 'codex_incomplete_stream',
            provider: this.id,
            model: requestedModel,
            data: {
              ...err.diagnostics,
              requestedModel,
              accountIndex,
              attempt: 2,
              retrying: false,
              durationMs: Math.max(0, Date.now() - requestStartedAt),
            },
          });
        }
        throw err;
      } finally {
        clearTimers();
        options?.abortSignal?.removeEventListener?.('abort', onExternalAbort);
      }
    };

    return runRequest(configuredModel, true);
  }

	  private async parseSSEStream(
	    response: Response,
	    model: string,
	    options?: ChatOptions,
	    onActivity?: () => void,
	  ): Promise<ChatResult> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from Codex endpoint');

	    const decoder = new TextDecoder();
		    let buffer = '';
		    let finalContent = '';
		    let thinking = '';
	    let toolCalls: any[] = [];
	    let usage: ModelUsage | undefined;
	    let sawCompleted = false;
	    const eventTypes: string[] = [];
	    let outputItemTypes: string[] = [];
	    let outputItemCount = 0;
		    const toolCallByOutputIndex = new Map<number, any>();
		    const toolCallByItemId = new Map<string, any>();
		    const toolCallByCallId = new Map<string, any>();
		    const rememberToolCall = (tc: any, item?: any, outputIndex?: unknown): any => {
		      if (typeof outputIndex === 'number') toolCallByOutputIndex.set(outputIndex, tc);
		      const itemId = String(item?.id || item?.item_id || '').trim();
		      if (itemId) toolCallByItemId.set(itemId, tc);
		      const callId = String(item?.call_id || tc?.id || '').trim();
		      if (callId) toolCallByCallId.set(callId, tc);
		      return tc;
		    };
		    const findToolCallForEvent = (event: any): any | undefined => {
		      const callId = String(event?.call_id || event?.item?.call_id || '').trim();
		      if (callId && toolCallByCallId.has(callId)) return toolCallByCallId.get(callId);
		      const itemId = String(event?.item_id || event?.item?.id || '').trim();
		      if (itemId && toolCallByItemId.has(itemId)) return toolCallByItemId.get(itemId);
		      if (typeof event?.output_index === 'number' && toolCallByOutputIndex.has(event.output_index)) {
		        return toolCallByOutputIndex.get(event.output_index);
		      }
		      return toolCalls[toolCalls.length - 1];
		    };
	
	    try {
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        streamDone = done;
        if (value) {
          onActivity?.();
          buffer += decoder.decode(value, { stream: !done });
        }
        if (done) buffer += decoder.decode();

        // Force the final unterminated SSE line through the same parser when the
        // body closes. Previously it remained stranded in `buffer` and could
        // turn a valid response.completed event into an empty assistant reply.
        const lines = (done ? `${buffer}\n` : buffer).split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            const type = event.type as string;
            if (type && eventTypes.length < 40 && !eventTypes.includes(type)) eventTypes.push(type);

            // Accumulate text deltas
	            if (type === 'response.output_text.delta') {
	              finalContent += event.delta || '';
	              options?.onToken?.(event.delta || '');
	              if (event.delta) options?.onModelEvent?.({ type: 'assistant_delta', text: event.delta, nativeType: type, provider: this.id, model });
	            }

	            if (
	              type === 'response.reasoning_summary_text.delta'
	              || type === 'response.reasoning_summary.delta'
	              || type === 'response.reasoning_text.delta'
	              || type === 'response.reasoning.delta'
	            ) {
	              const delta = event.delta || event.text || '';
	              if (delta) {
	                thinking += delta;
	                const isSummary = type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_summary.delta';
	                if (isSummary) options?.onReasoningSummary?.(delta);
	                else options?.onThinking?.(delta);
	                options?.onModelEvent?.({ type: 'reasoning_delta', text: delta, summary: isSummary, nativeType: type, provider: this.id, model });
	              }
	            }

	            if (
	              type === 'response.reasoning_summary_text.done'
	              || type === 'response.reasoning_summary.done'
	              || type === 'response.reasoning_summary_part.done'
	              || type === 'response.reasoning_text.done'
	              || type === 'response.reasoning.done'
	            ) {
	              const text = event.text || event.part?.text || '';
	              if (text && !thinking.includes(text)) {
	                thinking += (thinking ? '\n\n' : '') + text;
	                const isSummary = type === 'response.reasoning_summary_text.done'
	                  || type === 'response.reasoning_summary.done'
	                  || type === 'response.reasoning_summary_part.done';
	                if (isSummary) options?.onReasoningSummary?.(text);
	                else options?.onThinking?.(text);
	                options?.onModelEvent?.({ type: 'reasoning_done', text, summary: isSummary, nativeType: type, provider: this.id, model });
	              }
	            }

	            // Tool/function call detected
	            if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
	              const tc = {
	                id:       event.item.call_id || `call_${Date.now()}`,
	                type:     'function',
	                function: {
	                  name:      event.item.name || '',
	                  arguments: event.item.arguments || '',
	                },
	                _idx: toolCalls.length,
	              };
	              toolCalls.push(tc);
	              rememberToolCall(tc, event.item, event.output_index);
	              options?.onModelEvent?.({ type: 'tool_call_start', id: tc.id, name: tc.function.name, nativeType: type, provider: this.id, model });
	            }
	
	            // Accumulate function call argument deltas
	            if (type === 'response.function_call_arguments.delta') {
	              const tc = findToolCallForEvent(event);
	              if (tc) {
	                const delta = event.delta || '';
	                tc.function.arguments += delta;
	                if (delta) options?.onModelEvent?.({ type: 'tool_call_delta', id: tc.id, name: tc.function.name, argumentsDelta: delta, nativeType: type, provider: this.id, model });
	              }
	            }

	            if (type === 'response.output_item.done' && event.item?.type === 'reasoning') {
	              const summary = Array.isArray(event.item.summary) ? event.item.summary.map((s: any) => s.text || '').join('\n\n') : '';
	              const reasonText = Array.isArray(event.item.content) ? event.item.content.map((s: any) => s.text || '').join('\n\n') : '';
	              const merged = summary || reasonText;
	              if (merged && !thinking.includes(merged)) {
	                thinking += (thinking ? '\n\n' : '') + merged;
	                if (summary) options?.onReasoningSummary?.(merged);
	                else options?.onThinking?.(merged);
	                options?.onModelEvent?.({ type: 'reasoning_done', text: merged, summary: !!summary, nativeType: type, provider: this.id, model });
	              }
	            }

	            if (
	              (type === 'response.function_call_arguments.done' || type === 'response.output_item.done')
	              && event.item?.type === 'function_call'
	            ) {
	              const tc = findToolCallForEvent(event);
	              if (tc) {
	                tc.function.name = event.item.name || tc.function.name;
	                tc.function.arguments = event.item.arguments || event.arguments || tc.function.arguments;
	                rememberToolCall(tc, event.item, event.output_index);
	                options?.onModelEvent?.({ type: 'tool_call_done', id: tc.id, name: tc.function.name, arguments: tc.function.arguments, nativeType: type, provider: this.id, model });
	              }
	            }
	
	            // response.completed contains the full final snapshot
            if (type === 'response.completed') {
              sawCompleted = true;
              usage = parseUsage(event.response?.usage);
              const outputs = Array.isArray(event.response?.output) ? event.response.output : [];
              outputItemCount = outputs.length;
              outputItemTypes = outputs
                .slice(0, 24)
                .map((item: any) => String(item?.type || 'unknown').slice(0, 80));
              for (const item of outputs) {
	                if (item.type === 'message') {
	                  finalContent = (item.content || [])
	                    .filter((c: any) => c.type === 'output_text')
	                    .map((c: any) => c.text || '')
	                    .join('');
	                }
	                if (item.type === 'reasoning') {
	                  const summary = Array.isArray(item.summary) ? item.summary.map((s: any) => s.text || '').join('\n\n') : '';
	                  const reasonText = Array.isArray(item.content) ? item.content.map((s: any) => s.text || '').join('\n\n') : '';
	                  const merged = summary || reasonText;
	                  if (merged && !thinking.includes(merged)) {
	                    thinking += (thinking ? '\n\n' : '') + merged;
	                    if (summary) options?.onReasoningSummary?.(merged);
	                    else options?.onThinking?.(merged);
	                    options?.onModelEvent?.({ type: 'reasoning_done', text: merged, summary: !!summary, nativeType: 'response.completed', provider: this.id, model });
	                  }
	                }
	                if (item.type === 'function_call') {
	                  // Prefer the complete snapshot over accumulated deltas
	                  const existing = toolCallByCallId.get(String(item.call_id || '').trim())
	                    || toolCalls.find(tc => tc.id === item.call_id);
	                  if (existing) {
	                    existing.function.name      = item.name || existing.function.name;
	                    existing.function.arguments = item.arguments || existing.function.arguments;
	                  } else {
	                    const tc = {
	                      id:       item.call_id || `call_${Date.now()}`,
	                      type:     'function',
	                      function: { name: item.name || '', arguments: item.arguments || '' },
	                    };
	                    toolCalls.push(tc);
	                    rememberToolCall(tc, item);
	                  }
	                }
	              }
              options?.onModelEvent?.({
                type: 'provider_event',
                nativeType: type,
                provider: this.id,
                model,
                data: {
                  sawCompleted: true,
                  eventTypes: eventTypes.slice(),
                  outputItemTypes: outputItemTypes.slice(),
                  outputItemCount,
                  finalTextChars: finalContent.trim().length,
                  toolCallCount: toolCalls.length,
                  usage,
                  ...(finalContent.trim() || toolCalls.length > 0 ? {} : { failureClass: 'empty_completion' }),
                },
              });
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Clean up internal tracking index
    toolCalls = toolCalls.map(({ _idx, ...tc }) => tc);

    const diagnostics: CodexStreamDiagnostics = {
      sawCompleted,
      eventTypes: eventTypes.slice(),
      outputItemTypes: outputItemTypes.slice(),
      outputItemCount,
      finalTextChars: finalContent.trim().length,
      toolCallCount: toolCalls.length,
      usage,
    };

    if (!sawCompleted) {
      throw new CodexIncompleteStreamError('openai_codex stream ended before response.completed.', {
        ...diagnostics,
        failureClass: 'missing_completed',
      });
    }
    if (!finalContent.trim() && toolCalls.length === 0) {
      throw new CodexIncompleteStreamError('openai_codex response.completed contained no assistant text or tool calls.', {
        ...diagnostics,
        failureClass: 'empty_completion',
      });
    }

    const message: ChatMessage = {
      role: 'assistant',
      content: finalContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

	    return { message, thinking: thinking || undefined, usage };
	  }

  async generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    const messages: ChatMessage[] = [];
    if (options?.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });
    const result = await this.chat(messages, model, {
      max_tokens:  options?.max_tokens,
      think:       options?.think,
    });
    return { response: contentToString(result.message.content), usage: result.usage };
  }

  async listModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS.map(name => ({ name }));
  }

	  async testConnection(): Promise<boolean> {
	    try {
	      const token = await getValidToken(this.configDir);
	      return !!String(token || '').trim();
	    } catch {
	      return false;
	    }
	  }
}
