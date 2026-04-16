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

// Gemini models exposed through the OpenAI-compat surface.
// Order: flagship reasoning → fast → legacy.
export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

export class GeminiAdapter implements LLMProvider {
  readonly id = 'gemini' as const;
  private inner: OpenAICompatAdapter;

  constructor(apiKey: string) {
    this.inner = new OpenAICompatAdapter({
      endpoint:   GEMINI_ENDPOINT,
      apiKey,
      providerId: 'gemini' as any,
    });
  }

  chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    return this.inner.chat(messages, model, options);
  }

  generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.inner.generate(prompt, model, options);
  }

  async listModels(): Promise<ModelInfo[]> {
    // Prefer the live list; fall back to the static set if listing fails.
    const live = await this.inner.listModels();
    if (live && live.length) return live;
    return GEMINI_MODELS.map(name => ({ name }));
  }

  async testConnection(): Promise<boolean> {
    return this.inner.testConnection();
  }
}
