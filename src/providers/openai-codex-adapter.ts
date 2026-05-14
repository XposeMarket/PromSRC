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

import type { LLMProvider, ChatMessage, ContentPart, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo, ModelUsage } from './LLMProvider';
import { loadTokens, getValidToken, buildCodexCloudflareHeaders } from '../auth/openai-oauth';
import { contentToString } from './content-utils';
import { getConfig } from '../config/config';

const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
function envMs(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
const CODEX_REQUEST_TIMEOUT_MS = envMs('PROMETHEUS_CODEX_REQUEST_TIMEOUT_MS', 240_000, 30_000);
const CODEX_STREAM_IDLE_TIMEOUT_MS = envMs('PROMETHEUS_CODEX_STREAM_IDLE_TIMEOUT_MS', 75_000, 15_000);

// Models available via Codex OAuth (latest first; includes standard GPT and Codex variants)
export const CODEX_MODELS = [
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

function parseUsage(usage: any): ModelUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  const reasoningTokens = Number(
    usage.output_tokens_details?.reasoning_tokens
    || usage.completion_tokens_details?.reasoning_tokens
    || 0,
  );
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens + reasoningTokens));
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    source: 'provider',
  };
}

// Reasoning effort levels accepted by the Codex Responses API.
// Maps Prometheus-internal "think" hints → the literal effort string sent in the request body.
export const CODEX_EFFORT_MAP: Record<string, string> = {
  none: 'none',
  minimal: 'minimal',
  fast: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra_high: 'xhigh',
  xhigh: 'xhigh',
};

export class OpenAICodexAdapter implements LLMProvider {
  readonly id = 'openai_codex' as const;
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await getValidToken(this.configDir);
    const tokens = loadTokens(this.configDir);
    const accountId = tokens?.account_id || '';

    const headers: Record<string, string> = {
      ...buildCodexCloudflareHeaders(token, accountId),
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
    const headers = await this.getHeaders();

    // Extract system message as instructions
    const systemMsg = messages.find(m => m.role === 'system');
    const instructions = systemMsg ? contentToString(systemMsg.content) : '';

    const hasTools = Array.isArray(options?.tools) && options!.tools!.length > 0;
    const toolChoice = hasTools ? 'auto' : 'auto';
    const input = this.buildInput(messages);

    const runRequest = async (requestedModel: string, allowFallback: boolean): Promise<ChatResult> => {
      const controller = new AbortController();
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
      if (instructions) body.instructions = instructions;
      // Reasoning effort support (Codex reasoning models).
      // Precedence: options.think (per-call override) → config reasoning_effort → default 'medium'.
      const cfgRoot = getConfig().getConfig() as any;
      const codexCfg = cfgRoot?.llm?.providers?.openai_codex || {};
      const configuredEffort = typeof codexCfg.reasoning_effort === 'string' ? codexCfg.reasoning_effort.trim() : '';
      if (options?.think !== false && (options?.think || configuredEffort)) {
        const rawEffort = options?.think
          ? (typeof options.think === 'string' ? options.think : 'medium')
          : configuredEffort;
        const effort = CODEX_EFFORT_MAP[rawEffort] || 'medium';
        if (effort !== 'none') {
          body.reasoning = { effort, summary: 'auto' };
        }
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
          const fallbackModel = getChatgptAccountCompatibleModel(requestedModel);
          if (
            allowFallback
            && fallbackModel
            && fallbackModel !== requestedModel
            && isUnsupportedChatgptAccountCodexModel(response.status, text)
          ) {
            console.warn(`[openai_codex] Model "${requestedModel}" is unsupported for this ChatGPT account. Retrying with "${fallbackModel}".`);
            return runRequest(fallbackModel, false);
          }
          throw new Error(`openai_codex API error ${response.status}: ${text.slice(0, 400)}`);
        }

        return await this.parseSSEStream(response, options?.onToken, options?.onThinking, options?.onReasoningSummary, resetIdleTimer);
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          throw new Error(abortReason || 'openai_codex request aborted');
        }
        throw err;
      } finally {
        clearTimers();
        options?.abortSignal?.removeEventListener?.('abort', onExternalAbort);
      }
    };

    return runRequest(String(model || '').trim(), true);
  }

	  private async parseSSEStream(
	    response: Response,
	    onToken?: (chunk: string) => void,
	    onThinking?: (chunk: string) => void,
	    onReasoningSummary?: (chunk: string) => void,
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onActivity?.();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            const type = event.type as string;

            // Accumulate text deltas
	            if (type === 'response.output_text.delta') {
	              finalContent += event.delta || '';
	              onToken?.(event.delta || '');
	            }

	            if (
	              type === 'response.reasoning_summary_text.delta'
	              || type === 'response.reasoning_text.delta'
	            ) {
	              const delta = event.delta || event.text || '';
	              if (delta) {
	                thinking += delta;
	                if (type === 'response.reasoning_summary_text.delta') onReasoningSummary?.(delta);
	                else onThinking?.(delta);
	              }
	            }

	            if (
	              type === 'response.reasoning_summary_text.done'
	              || type === 'response.reasoning_text.done'
	            ) {
	              const text = event.text || '';
	              if (text && !thinking.includes(text)) {
	                thinking += (thinking ? '\n\n' : '') + text;
	                if (type === 'response.reasoning_summary_text.done') onReasoningSummary?.(text);
	                else onThinking?.(text);
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
	            }
	
	            // Accumulate function call argument deltas
	            if (type === 'response.function_call_arguments.delta') {
	              const tc = findToolCallForEvent(event);
	              if (tc) tc.function.arguments += event.delta || '';
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
	              }
	            }
	
	            // response.completed contains the full final snapshot
            if (type === 'response.completed') {
              usage = parseUsage(event.response?.usage);
              const outputs = event.response?.output || [];
              for (const item of outputs) {
                if (item.type === 'message') {
                  finalContent = (item.content || [])
                    .filter((c: any) => c.type === 'output_text')
                    .map((c: any) => c.text || '')
                    .join('');
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
