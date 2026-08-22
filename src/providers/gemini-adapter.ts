/**
 * gemini-adapter.ts
 *
 * Provider adapter for Google Gemini via the OpenAI-compatible endpoint:
 *   https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 *
 * Auth: API key from https://aistudio.google.com/apikey (stored in vault).
 * Sent as Bearer <key> via the shared OpenAICompatAdapter.
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo } from './LLMProvider';
import { OpenAICompatAdapter } from './openai-compat-adapter';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai';

// Stable/current text models exposed through the OpenAI-compatible surface.
// Live model discovery remains authoritative; this list is only the fallback.
export const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];

function normalizeGeminiOptions<T extends ChatOptions | GenerateOptions>(model: string, options?: T): T {
  const next = { ...(options || {}) } as T;
  // Gemini 3 reasoning is optimized around temperature 1.0. Prometheus's
  // shared OpenAI-compatible adapter otherwise supplies 0.25 by default.
  if (/^gemini-3(?:\.|-)/i.test(String(model || '')) && next.temperature === undefined) {
    next.temperature = 1;
  }
  return next;
}

export class GeminiAdapter implements LLMProvider {
  readonly id = 'gemini' as const;
  private inner: OpenAICompatAdapter;

  constructor(apiKey: string) {
    this.inner = new OpenAICompatAdapter({
      endpoint: GEMINI_ENDPOINT,
      apiKey,
      providerId: 'gemini' as any,
      staticModels: GEMINI_MODELS,
      supportsReasoningEffort: true,
    });
  }

  chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    return this.inner.chat(messages, model, normalizeGeminiOptions(model, options));
  }

  generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.inner.generate(prompt, model, normalizeGeminiOptions(model, options));
  }

  async listModels(): Promise<ModelInfo[]> {
    // Prefer Google's live list; fall back to the current known set if listing fails.
    const live = await this.inner.listModels();
    if (live && live.length) return live;
    return GEMINI_MODELS.map(name => ({ name }));
  }

  async testConnection(): Promise<boolean> {
    return this.inner.testConnection();
  }
}
