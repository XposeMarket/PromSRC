/**
 * openai-compat-adapter.ts
 * Implements the OpenAI /v1/chat/completions protocol.
 * Used by: llama.cpp, LM Studio, OpenAI (API key).
 *
 * llama.cpp default:  http://localhost:8080
 * LM Studio default:  http://localhost:1234
 * OpenAI:             https://api.openai.com
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo, ModelUsage, ProviderID } from './LLMProvider';
import { contentToString } from './content-utils';
import { getConfig } from '../config/config';

// Map Prometheus-internal think hints → OpenAI-style reasoning_effort literal.
// 'xhigh' / 'extra_high' are Codex-only; regular OpenAI + Perplexity cap at 'high',
// so we clamp those cases to 'high'.
const EFFORT_MAP: Record<string, string> = {
  none: 'none', minimal: 'minimal', fast: 'minimal',
  low: 'low', medium: 'medium', high: 'high',
  xhigh: 'high', extra_high: 'high',
};

// Providers that meaningfully accept a `reasoning_effort` parameter via the
// OpenAI-compat surface. lm_studio / llama_cpp ignore unknown fields, so we
// leave them alone to avoid confusing local servers.
const EFFORT_PROVIDERS = new Set<string>(['openai', 'perplexity']);

function providerToolLimit(providerId: string): number | null {
  const id = String(providerId || '').trim().toLowerCase();
  if (id === 'xai') return 200;
  return null;
}

function capProviderTools(providerId: string, tools?: any[]): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const limit = providerToolLimit(providerId);
  if (!limit || tools.length <= limit) return tools;
  console.warn(`[${providerId}] Capping tool payload from ${tools.length} to ${limit} to respect provider limits.`);
  return tools.slice(0, limit);
}

function isOfficialOpenAIEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(String(endpoint || ''));
    return /(^|\.)api\.openai\.com$/i.test(url.hostname);
  } catch {
    return /api\.openai\.com/i.test(String(endpoint || ''));
  }
}

function supportsOpenAIResponsesReasoning(model: string): boolean {
  const m = String(model || '').trim().toLowerCase();
  return /^(o\d|gpt-5|codex)/.test(m);
}

function parseUsage(data: any): ModelUsage | undefined {
  const usage = data?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  const reasoningTokens = Number(
    usage.completion_tokens_details?.reasoning_tokens
    || usage.output_tokens_details?.reasoning_tokens
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

export interface OpenAICompatConfig {
  endpoint: string;
  /** Static Bearer token (API key). Leave undefined for OAuth-managed tokens. */
  apiKey?: string;
  /** Called just before each request to get a fresh token (OAuth providers). */
  getToken?: () => Promise<string>;
  providerId: ProviderID;
  chatCompletionsPath?: string;
  modelsPath?: string;
  defaultHeaders?: Record<string, string>;
  authLabel?: string;
  staticModels?: string[];
  supportsReasoningEffort?: boolean;
}

export class OpenAICompatAdapter implements LLMProvider {
  readonly id: ProviderID;
  private config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig) {
    this.id = config.providerId;
    this.config = config;
  }

  private async getAuthHeader(): Promise<string | null> {
    if (this.config.getToken) {
      const token = await this.config.getToken();
      return `Bearer ${token}`;
    }
    if (this.config.apiKey) {
      return `Bearer ${this.config.apiKey}`;
    }
    return null;
  }

  private async post(path: string, body: object): Promise<any> {
    const auth = await this.getAuthHeader();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.config.defaultHeaders || {}),
    };
    if (auth) headers['Authorization'] = auth;

    const url = `${this.config.endpoint.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const authLabel = this.config.authLabel ? ` via ${this.config.authLabel}` : '';
      throw new Error(`${this.id} API error ${response.status}${authLabel}: ${text.slice(0, 200)}`);
    }
    return response.json();
  }

  private async get(path: string): Promise<any> {
    const auth = await this.getAuthHeader();
    const headers: Record<string, string> = {
      ...(this.config.defaultHeaders || {}),
    };
    if (auth) headers['Authorization'] = auth;

    const url = `${this.config.endpoint.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const authLabel = this.config.authLabel ? ` via ${this.config.authLabel}` : '';
      throw new Error(`${this.id} API error ${response.status}${authLabel}`);
    }
    return response.json();
  }

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    // OpenAI Codex OAuth requires a specific system prompt to validate CLI authorization
    let finalMessages = messages;
    if (this.id === 'openai_codex') {
      const CODEX_SYSTEM = 'You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user\'s local machine.';
      const hasSystem = messages.length > 0 && messages[0].role === 'system';
      const systemContent = hasSystem ? contentToString(messages[0].content) : '';
      if (!hasSystem) {
        finalMessages = [{ role: 'system', content: CODEX_SYSTEM }, ...messages];
      } else if (!systemContent.includes('Codex')) {
        const mergedSystem = systemContent ? `${CODEX_SYSTEM}\n\n${systemContent}` : CODEX_SYSTEM;
        finalMessages = [{ role: 'system', content: mergedSystem }, ...messages.slice(1)];
      }
    }
	    const body: any = {
	      model,
	      messages: finalMessages,
	      temperature: options?.temperature ?? 0.25,
	      max_tokens: options?.max_tokens ?? 512,
	      stream: !!options?.onToken,
	    };
	    // Reasoning effort: only forward for providers that implement it.
    if (this.config.supportsReasoningEffort ?? EFFORT_PROVIDERS.has(this.id as string)) {
	      let rawEffort: string | undefined;
	      if (options?.think === false) {
	        rawEffort = undefined;
	      } else if (typeof options?.think === 'string') {
	        rawEffort = options.think;
	      } else {
	        const cfgRoot = getConfig().getConfig() as any;
	        const provCfg = cfgRoot?.llm?.providers?.[this.id] || {};
	        if (typeof provCfg.reasoning_effort === 'string') {
	          rawEffort = provCfg.reasoning_effort.trim();
	        }
	      }
	      if (rawEffort) {
	        const effort = EFFORT_MAP[rawEffort] || 'medium';
	        if (effort !== 'none') body.reasoning_effort = effort;
	      }
	    }
    const cappedTools = capProviderTools(this.id, options?.tools);
    if (cappedTools?.length) {
      body.tools = cappedTools;
      // Force 'required' on the first model turn (last message is from user) so the
      // model MUST call a tool rather than producing an intent-only acknowledgment.
      // After a tool result is in context the model needs 'auto' to write a final reply.
      const lastMsgRole = finalMessages[finalMessages.length - 1]?.role;
      body.tool_choice = lastMsgRole === 'user' ? 'required' : 'auto';
    }

	    if (body.stream) {
	      if (
	        this.id === 'openai'
	        && isOfficialOpenAIEndpoint(this.config.endpoint)
	        && supportsOpenAIResponsesReasoning(model)
	        && (options?.onThinking || options?.onReasoningSummary || body.reasoning_effort)
	      ) {
	        return this.streamOpenAIResponses(finalMessages, model, body, options);
	      }
	      return this.streamChatCompletions(body, options);
	    }

		    const data = await this.post(this.config.chatCompletionsPath || '/v1/chat/completions', body);
    const choice = data.choices?.[0];
    const message: ChatMessage = {
      role: 'assistant',
      content: choice?.message?.content ?? '',
      tool_calls: choice?.message?.tool_calls,
    };
	    return { message, usage: parseUsage(data) };
	  }

	  private async streamChatCompletions(body: any, options?: ChatOptions): Promise<ChatResult> {
	    const auth = await this.getAuthHeader();
	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	    if (auth) headers['Authorization'] = auth;

		    const url = `${this.config.endpoint.replace(/\/$/, '')}${this.config.chatCompletionsPath || '/v1/chat/completions'}`;
	    const response = await fetch(url, {
	      method: 'POST',
	      headers,
	      body: JSON.stringify(body),
	      signal: AbortSignal.timeout(300_000),
	    });

	    if (!response.ok) {
	      const text = await response.text().catch(() => '');
	      const authLabel = this.config.authLabel ? ` via ${this.config.authLabel}` : '';
	      throw new Error(`${this.id} API error ${response.status}${authLabel}: ${text.slice(0, 200)}`);
	    }

	    const reader = response.body?.getReader();
	    if (!reader) throw new Error(`${this.id} API error: no streaming response body`);

	    const decoder = new TextDecoder();
	    let buffer = '';
	    let content = '';
	    let thinking = '';
	    const toolCalls: any[] = [];
	    let usage: ModelUsage | undefined;

	    const ensureToolCall = (idx: number) => {
	      if (!toolCalls[idx]) {
	        toolCalls[idx] = {
	          id: '',
	          type: 'function',
	          function: { name: '', arguments: '' },
	        };
	      }
	      return toolCalls[idx];
	    };

	    try {
	      while (true) {
	        const { done, value } = await reader.read();
	        if (done) break;
	        buffer += decoder.decode(value, { stream: true });
	        const lines = buffer.split('\n');
	        buffer = lines.pop() || '';

	        for (const line of lines) {
	          if (!line.startsWith('data: ')) continue;
	          const data = line.slice(6).trim();
	          if (!data || data === '[DONE]') continue;
	          try {
	            const event = JSON.parse(data);
	            if (event.usage) usage = parseUsage(event);
	            const delta = event.choices?.[0]?.delta || {};
	            const textDelta = delta.content || '';
	            if (textDelta) {
	              content += textDelta;
	              options?.onToken?.(textDelta);
	              options?.onModelEvent?.({ type: 'assistant_delta', text: textDelta, nativeType: 'chat.completion.chunk', provider: this.id, model: body.model });
	            }

	            const thinkingDelta =
	              delta.reasoning_content
	              || delta.reasoning
	              || delta.reasoning_text
	              || delta.reasoning_summary
	              || '';
	            if (thinkingDelta) {
	              thinking += thinkingDelta;
	              options?.onThinking?.(thinkingDelta);
	              options?.onModelEvent?.({ type: 'reasoning_delta', text: thinkingDelta, nativeType: 'chat.completion.chunk', provider: this.id, model: body.model });
	            }

	            if (Array.isArray(delta.tool_calls)) {
	              for (const tc of delta.tool_calls) {
	                const idx = Number.isFinite(Number(tc.index)) ? Number(tc.index) : toolCalls.length;
	                const acc = ensureToolCall(idx);
	                if (tc.id) acc.id = tc.id;
	                if (tc.type) acc.type = tc.type;
	                if (tc.function?.name) acc.function.name += tc.function.name;
	                if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
	                if (tc.function?.name) {
	                  options?.onModelEvent?.({ type: 'tool_call_start', id: acc.id || `call_${idx}`, name: acc.function.name, nativeType: 'delta.tool_calls', provider: this.id, model: body.model });
	                }
	                if (tc.function?.arguments) {
	                  options?.onModelEvent?.({ type: 'tool_call_delta', id: acc.id || `call_${idx}`, name: acc.function.name, argumentsDelta: tc.function.arguments, nativeType: 'delta.tool_calls', provider: this.id, model: body.model });
	                }
	              }
	            }
	          } catch {
	            // Skip malformed streaming chunks.
	          }
	        }
	      }
	    } finally {
	      reader.releaseLock();
	    }

	    const normalizedToolCalls = toolCalls
	      .filter(Boolean)
	      .map((tc, idx) => ({
	        id: tc.id || `call_${Date.now()}_${idx}`,
	        type: 'function' as const,
	        function: {
	          name: tc.function?.name || '',
	          arguments: tc.function?.arguments || '',
	        },
	      }))
	      .filter(tc => tc.function.name);
	    for (const tc of normalizedToolCalls) {
	      options?.onModelEvent?.({ type: 'tool_call_done', id: tc.id, name: tc.function.name, arguments: tc.function.arguments, nativeType: 'delta.tool_calls.done', provider: this.id, model: body.model });
	    }

	    const message: ChatMessage = {
	      role: 'assistant',
	      content,
	      tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined,
	    };
	    return { message, thinking: thinking || undefined, usage };
	  }

	  private buildResponsesInput(messages: ChatMessage[]): { instructions: string; input: any[] } {
	    const systemParts: string[] = [];
	    const input: any[] = [];
	    for (const m of messages) {
	      if (m.role === 'system') {
	        const text = contentToString(m.content);
	        if (text.trim()) systemParts.push(text);
	        continue;
	      }
	      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
	        for (const tc of m.tool_calls) {
	          input.push({
	            type: 'function_call',
	            call_id: tc.id || `call_${Date.now()}`,
	            name: tc.function?.name || '',
	            arguments: tc.function?.arguments || '{}',
	          });
	        }
	        continue;
	      }
	      if (m.role === 'tool') {
	        const callId = String(m.tool_call_id || '').trim();
	        if (!callId) {
	          input.push({
	            role: 'assistant',
	            content: `[tool-note:${String(m.name || 'tool').slice(0, 80)}] ${typeof m.content === 'string' ? m.content : contentToString(m.content)}`.slice(0, 12000),
	          });
	          continue;
	        }
	        input.push({
	          type: 'function_call_output',
	          call_id: callId,
	          output: typeof m.content === 'string' ? m.content : contentToString(m.content),
	        });
	        continue;
	      }
	      if (Array.isArray(m.content)) {
	        input.push({
	          role: m.role,
	          content: m.content.map((part: any) => {
	            if (part?.type === 'text') return { type: 'input_text', text: String(part.text || '') };
	            if (part?.type === 'image_url') return { type: 'input_image', image_url: String(part.image_url?.url || '') };
	            return { type: 'input_text', text: contentToString(part) };
	          }),
	        });
	        continue;
	      }
	      input.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
	    }
	    return { instructions: systemParts.join('\n\n'), input };
	  }

	  private async streamOpenAIResponses(
	    messages: ChatMessage[],
	    model: string,
	    chatBody: any,
	    options?: ChatOptions,
	  ): Promise<ChatResult> {
	    const auth = await this.getAuthHeader();
	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	    if (auth) headers['Authorization'] = auth;
	    const { instructions, input } = this.buildResponsesInput(messages);
	    const effort = EFFORT_MAP[String(chatBody.reasoning_effort || options?.think || 'medium')] || 'medium';
	    const body: any = {
	      model,
	      input,
	      stream: true,
	      store: false,
	      max_output_tokens: chatBody.max_tokens,
	      reasoning: { effort, summary: 'auto' },
	    };
	    if (instructions) body.instructions = instructions;
	    if (!/^(o\d|gpt-5)/i.test(model) && typeof chatBody.temperature === 'number') {
	      body.temperature = chatBody.temperature;
	    }
    const cappedTools = capProviderTools(this.id, options?.tools);
    if (cappedTools?.length) {
      body.tools = cappedTools.map((t: any) => ({
	        type: 'function',
	        name: t.function?.name || t.name,
	        description: t.function?.description || t.description || '',
	        parameters: t.function?.parameters || t.parameters || {},
	      }));
	      body.tool_choice = chatBody.tool_choice || 'auto';
	      body.parallel_tool_calls = true;
	    }

	    const url = `${this.config.endpoint.replace(/\/$/, '')}/v1/responses`;
	    const response = await fetch(url, {
	      method: 'POST',
	      headers,
	      body: JSON.stringify(body),
	      signal: options?.abortSignal || AbortSignal.timeout(300_000),
	    });

	    if (!response.ok) {
	      const text = await response.text().catch(() => '');
	      throw new Error(`${this.id} Responses API error ${response.status}: ${text.slice(0, 300)}`);
	    }

	    const reader = response.body?.getReader();
	    if (!reader) throw new Error(`${this.id} Responses API error: no streaming response body`);

	    const decoder = new TextDecoder();
	    let buffer = '';
	    let content = '';
	    let thinking = '';
	    let usage: ModelUsage | undefined;
	    let toolCalls: any[] = [];
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
	    const emitReasoning = (delta: any, summary = true) => {
	      const text = String(delta || '');
	      if (!text) return;
	      thinking += text;
	      if (summary) options?.onReasoningSummary?.(text);
	      else options?.onThinking?.(text);
	      options?.onModelEvent?.({ type: 'reasoning_delta', text, summary, nativeType: summary ? 'response.reasoning_summary_text.delta' : 'response.reasoning_text.delta', provider: this.id, model });
	    };

	    try {
	      while (true) {
	        const { done, value } = await reader.read();
	        if (done) break;
	        buffer += decoder.decode(value, { stream: true });
	        const lines = buffer.split('\n');
	        buffer = lines.pop() || '';
	        for (const line of lines) {
	          if (!line.startsWith('data: ')) continue;
	          const data = line.slice(6).trim();
	          if (!data || data === '[DONE]') continue;
	          try {
	            const event = JSON.parse(data);
	            const type = String(event.type || '');
	            if (type === 'response.output_text.delta') {
	              const delta = String(event.delta || '');
	              if (delta) {
	                content += delta;
	                options?.onToken?.(delta);
	                options?.onModelEvent?.({ type: 'assistant_delta', text: delta, nativeType: type, provider: this.id, model });
	              }
	            }
	            if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_summary.delta') {
	              emitReasoning(event.delta || event.text, true);
	            }
	            if (type === 'response.reasoning_text.delta' || type === 'response.reasoning.delta') {
	              emitReasoning(event.delta || event.text, false);
	            }
	            if (
	              type === 'response.reasoning_summary_text.done'
	              || type === 'response.reasoning_summary.done'
	              || type === 'response.reasoning_summary_part.done'
	              || type === 'response.reasoning_text.done'
	              || type === 'response.reasoning.done'
	            ) {
	              const text = String(event.text || event.delta || event.part?.text || '');
	              if (text && !thinking.includes(text)) emitReasoning(text, !type.includes('reasoning_text'));
	            }
	            if (type === 'response.output_item.done' && event.item?.type === 'reasoning') {
	              const summary = Array.isArray(event.item.summary) ? event.item.summary.map((s: any) => s.text || '').join('\n\n') : '';
	              const reasonText = Array.isArray(event.item.content) ? event.item.content.map((s: any) => s.text || '').join('\n\n') : '';
	              const merged = summary || reasonText;
	              if (merged && !thinking.includes(merged)) emitReasoning(merged, !!summary);
	            }
	            if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
	              const tc = {
	                id: event.item.call_id || `call_${Date.now()}`,
	                type: 'function',
	                function: { name: event.item.name || '', arguments: event.item.arguments || '' },
	              };
	              toolCalls.push(tc);
	              rememberToolCall(tc, event.item, event.output_index);
	              options?.onModelEvent?.({ type: 'tool_call_start', id: tc.id, name: tc.function.name, nativeType: type, provider: this.id, model });
	            }
	            if (type === 'response.function_call_arguments.delta') {
	              const tc = findToolCallForEvent(event);
	              if (tc) {
	                const delta = event.delta || '';
	                tc.function.arguments += delta;
	                if (delta) options?.onModelEvent?.({ type: 'tool_call_delta', id: tc.id, name: tc.function.name, argumentsDelta: delta, nativeType: type, provider: this.id, model });
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
	            if (type === 'response.completed') {
	              usage = parseUsage(event.response?.usage);
	              const outputs = event.response?.output || [];
	              for (const item of outputs) {
	                if (item.type === 'message') {
	                  content = (item.content || [])
	                    .filter((c: any) => c.type === 'output_text')
	                    .map((c: any) => c.text || '')
	                    .join('');
	                }
	                if (item.type === 'reasoning') {
	                  const summary = Array.isArray(item.summary) ? item.summary.map((s: any) => s.text || '').join('\n\n') : '';
	                  const reasonText = Array.isArray(item.content) ? item.content.map((s: any) => s.text || '').join('\n\n') : '';
	                  const merged = summary || reasonText;
	                  if (merged && !thinking.includes(merged)) emitReasoning(merged, !!summary);
	                }
	                if (item.type === 'function_call') {
	                  const existing = toolCallByCallId.get(String(item.call_id || '').trim()) || toolCalls.find(tc => tc.id === item.call_id);
	                  if (existing) {
	                    existing.function.name = item.name || existing.function.name;
	                    existing.function.arguments = item.arguments || existing.function.arguments;
	                  } else {
	                    const tc = {
	                      id: item.call_id || `call_${Date.now()}`,
	                      type: 'function',
	                      function: { name: item.name || '', arguments: item.arguments || '' },
	                    };
	                    toolCalls.push(tc);
	                    rememberToolCall(tc, item);
	                  }
	                }
	              }
	            }
	          } catch {
	            // Skip malformed SSE chunks.
	          }
	        }
	      }
	    } finally {
	      reader.releaseLock();
	    }

	    toolCalls = toolCalls.filter(tc => tc?.function?.name);
	    const message: ChatMessage = {
	      role: 'assistant',
	      content,
	      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
	    };
	    return { message, thinking: thinking || undefined, usage };
	  }

  async generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    // OpenAI-compat servers don't have a /completions generate endpoint equivalent
    // so we wrap as a chat call with system + user message.
    const messages: ChatMessage[] = [];
    if (options?.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: prompt });

    const body: any = {
      model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.max_tokens ?? 512,
      stream: false,
    };
    if (options?.format === 'json') {
      body.response_format = { type: 'json_object' };
    }

	    const data = await this.post(this.config.chatCompletionsPath || '/v1/chat/completions', body);
    const content = data.choices?.[0]?.message?.content ?? '';
    return { response: contentToString(content), usage: parseUsage(data) };
  }

	  async listModels(): Promise<ModelInfo[]> {
	    try {
	      const data = await this.get(this.config.modelsPath || '/v1/models');
	      return (data.data || []).map((m: any) => ({ name: m.id }));
	    } catch {
	      return (this.config.staticModels || []).map((name) => ({ name }));
	    }
	  }

	  async testConnection(): Promise<boolean> {
	    try {
	      await this.get(this.config.modelsPath || '/v1/models');
	      return true;
	    } catch {
	      const fallbackModel = this.config.staticModels?.[0];
	      if (!fallbackModel) return false;
	      try {
	        await this.post(this.config.chatCompletionsPath || '/v1/chat/completions', {
	          model: fallbackModel,
	          messages: [{ role: 'user', content: 'Reply with pong only.' }],
	          max_tokens: 8,
	          temperature: 0,
	          stream: false,
	        });
	        return true;
	      } catch {
	        return false;
	      }
	    }
	  }
}
