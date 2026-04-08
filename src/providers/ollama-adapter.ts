/**
 * ollama-adapter.ts
 * Wraps the existing Ollama SDK. This keeps backward compatibility —
 * all existing code that relied on the Ollama SDK still works unchanged.
 */

import { Ollama } from 'ollama';
import type { LLMProvider, ChatMessage, ContentPart, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo } from './LLMProvider';

/**
 * Coerce a message's content to a plain string.
 * Ollama 4B models do not support multimodal content arrays.
 * If a ContentPart[] somehow reaches this adapter, extract only the text parts.
 */
function contentToString(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

export class OllamaAdapter implements LLMProvider {
  readonly id = 'ollama' as const;
  private client: Ollama;
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.client = new Ollama({ host: endpoint });
  }

  updateEndpoint(endpoint: string) {
    if (endpoint !== this.endpoint) {
      this.endpoint = endpoint;
      this.client = new Ollama({ host: endpoint });
    }
  }

  async chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    // Normalize all messages to string content before sending to Ollama.
    // Small models do not support ContentPart[] arrays.
    const normalizedMessages = messages.map(m => ({
      ...m,
      content: contentToString(m.content),
    }));

    const thinkCandidates = this.buildThinkCandidates(options?.think);
    let lastError: any = null;

    for (const think of thinkCandidates) {
      try {
        const hasOnToken = typeof options?.onToken === 'function';

        if (hasOnToken) {
          // ── Streaming mode: pipe tokens live, collect full response ──────────
          // This fixes connection timeout errors on slow/small models — the HTTP
          // connection stays alive as tokens arrive instead of waiting for the
          // entire response before any bytes are returned.
          const stream = await (this.client.chat as any)({
            model,
            messages: normalizedMessages as any,
            tools: options?.tools,
            ...(Array.isArray(options?.tools) && options!.tools!.length ? { tool_choice: 'auto' } : {}),
            options: {
              temperature: options?.temperature ?? 0.25,
              top_p: 0.9,
              num_ctx: options?.num_ctx ?? 4096,
              num_predict: options?.max_tokens ?? 256,
            },
            ...(think === undefined ? {} : { think }),
            stream: true,
          });

          let fullContent = '';
          let fullThinking = '';
          let tool_calls: any[] | undefined;
          let lastMessage: any = null;

          for await (const chunk of stream) {
            const delta = chunk?.message?.content || '';
            const thinkDelta = chunk?.message?.thinking || '';
            if (delta) {
              fullContent += delta;
              options!.onToken!(delta);
            }
            if (thinkDelta) {
              fullThinking += thinkDelta;
              // Emit thinking tokens prefixed so the UI can distinguish them
              options!.onToken!(`<think_delta>${thinkDelta}</think_delta>`);
            }
            if (chunk?.message?.tool_calls?.length) {
              tool_calls = chunk.message.tool_calls;
            }
            lastMessage = chunk?.message;
          }

          const message = {
            role: 'assistant' as const,
            content: fullContent,
            ...(tool_calls ? { tool_calls } : {}),
          };
          return { message, thinking: fullThinking || undefined };
        }

        // ── Non-streaming mode (no onToken callback) ─────────────────────────
        // Always stream internally — resolves hanging promise issues with certain
        // Ollama models (e.g. Qwen3) that never resolve stream:false non-streaming calls.
        const internalStream = await (this.client.chat as any)({
          model,
          messages: normalizedMessages as any,
          tools: options?.tools,
          ...(Array.isArray(options?.tools) && options!.tools!.length ? { tool_choice: 'auto' } : {}),
          options: {
            temperature: options?.temperature ?? 0.25,
            top_p: 0.9,
            num_ctx: options?.num_ctx ?? 4096,
            num_predict: options?.max_tokens ?? 256,
          },
          ...(think === undefined ? {} : { think }),
          stream: true,
        });

        let fullContent = '';
        let fullThinking = '';
        let tool_calls: any[] | undefined;
        for await (const chunk of internalStream) {
          fullContent += chunk?.message?.content || '';
          fullThinking += chunk?.message?.thinking || '';
          if (chunk?.message?.tool_calls?.length) tool_calls = chunk.message.tool_calls;
        }
        const message = {
          role: 'assistant' as const,
          content: fullContent,
          ...(tool_calls ? { tool_calls } : {}),
        };
        return { message, thinking: fullThinking || undefined };
      } catch (error: any) {
        lastError = error;
        const msg = String(error?.message || error || '');
        if (!/think value .* not supported|invalid think|think .* not supported/i.test(msg)) {
          throw new Error(`Ollama chat failed: ${msg}`);
        }
      }
    }
    throw new Error(`Ollama chat failed: ${lastError?.message || 'Unknown'}`);
  }

  async generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    const thinkCandidates = this.buildThinkCandidates(options?.think);
    let lastError: any = null;

    for (const think of thinkCandidates) {
      try {
        // Always stream generate calls — keeps the connection alive on slow models
        // and surfaces tokens as they arrive instead of blocking until completion.
        const stream = await this.client.generate({
          model,
          prompt,
          system: options?.system,
          format: options?.format as any,
          options: {
            temperature: options?.temperature ?? 0.3,
            top_p: 0.9,
            num_ctx: options?.num_ctx ?? 2048,
            num_predict: options?.max_tokens ?? 256,
          },
          ...(think === undefined ? {} : { think }),
          stream: true,
        });

        let fullResponse = '';
        let fullThinking = '';
        for await (const chunk of stream) {
          if (chunk.response) fullResponse += chunk.response;
          if ((chunk as any).thinking) fullThinking += (chunk as any).thinking;
        }
        return { response: fullResponse, thinking: fullThinking || undefined };
      } catch (error: any) {
        lastError = error;
        const msg = String(error?.message || error || '');
        if (!/think value .* not supported|invalid think|think .* not supported/i.test(msg)) {
          throw new Error(`Ollama generate failed: ${msg}`);
        }
      }
    }
    throw new Error(`Ollama generate failed: ${lastError?.message || 'Unknown'}`);
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await this.client.list();
    return response.models.map((m: any) => ({
      name: m.name,
      size: m.size,
      parameter_size: m.details?.parameter_size || '',
      family: m.details?.family || '',
      modified_at: m.modified_at,
    }));
  }

  async testConnection(): Promise<boolean> {
    try { await this.listModels(); return true; } catch { return false; }
  }

  async pullModel(modelName: string): Promise<void> {
    await this.client.pull({ model: modelName, stream: false });
  }

  private buildThinkCandidates(requested?: boolean | 'extra_high' | 'high' | 'medium' | 'low') {
    // Ollama doesn't support extra_high — fall back to high
    const normalized: boolean | 'high' | 'medium' | 'low' | undefined =
      requested === 'extra_high' ? 'high' : requested;
    const candidates: Array<boolean | 'high' | 'medium' | 'low' | undefined> = [];
    const push = (v: boolean | 'high' | 'medium' | 'low' | undefined) => {
      if (!candidates.some(x => x === v)) candidates.push(v);
    };
    push(normalized);
    if (normalized !== 'low') push('low');
    push(undefined);
    if (normalized !== true) push(true);
    push('medium');
    return candidates;
  }
}
