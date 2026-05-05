/**
 * openai-compat-adapter.ts
 * Implements the OpenAI /v1/chat/completions protocol.
 * Used by: llama.cpp, LM Studio, OpenAI (API key).
 *
 * llama.cpp default:  http://localhost:8080
 * LM Studio default:  http://localhost:1234
 * OpenAI:             https://api.openai.com
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo, ProviderID } from './LLMProvider';
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
      throw new Error(`${this.id} API error ${response.status}: ${text.slice(0, 200)}`);
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

    if (!response.ok) throw new Error(`${this.id} API error ${response.status}`);
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
    if (Array.isArray(options?.tools) && options!.tools!.length) {
      body.tools = options!.tools;
      // Force 'required' on the first model turn (last message is from user) so the
      // model MUST call a tool rather than producing an intent-only acknowledgment.
      // After a tool result is in context the model needs 'auto' to write a final reply.
      const lastMsgRole = finalMessages[finalMessages.length - 1]?.role;
      body.tool_choice = lastMsgRole === 'user' ? 'required' : 'auto';
    }

	    if (body.stream) {
	      return this.streamChatCompletions(body, options);
	    }

		    const data = await this.post(this.config.chatCompletionsPath || '/v1/chat/completions', body);
    const choice = data.choices?.[0];
    const message: ChatMessage = {
      role: 'assistant',
      content: choice?.message?.content ?? '',
      tool_calls: choice?.message?.tool_calls,
    };
	    return { message };
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
	      throw new Error(`${this.id} API error ${response.status}: ${text.slice(0, 200)}`);
	    }

	    const reader = response.body?.getReader();
	    if (!reader) throw new Error(`${this.id} API error: no streaming response body`);

	    const decoder = new TextDecoder();
	    let buffer = '';
	    let content = '';
	    let thinking = '';
	    const toolCalls: any[] = [];

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
	            const delta = event.choices?.[0]?.delta || {};
	            const textDelta = delta.content || '';
	            if (textDelta) {
	              content += textDelta;
	              options?.onToken?.(textDelta);
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
	            }

	            if (Array.isArray(delta.tool_calls)) {
	              for (const tc of delta.tool_calls) {
	                const idx = Number.isFinite(Number(tc.index)) ? Number(tc.index) : toolCalls.length;
	                const acc = ensureToolCall(idx);
	                if (tc.id) acc.id = tc.id;
	                if (tc.type) acc.type = tc.type;
	                if (tc.function?.name) acc.function.name += tc.function.name;
	                if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
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

	    const message: ChatMessage = {
	      role: 'assistant',
	      content,
	      tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined,
	    };
	    return { message, thinking: thinking || undefined };
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
    return { response: contentToString(content) };
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
