/**
 * perplexity-adapter.ts
 *
 * Provider adapter for Perplexity AI via api.perplexity.ai/chat/completions.
 * Perplexity speaks the OpenAI chat-completions protocol, so this adapter
 * extends OpenAICompatAdapter with the correct default endpoint + model list
 * (sonar family, all reasoning + web-grounded).
 *
 * Auth: API key from https://www.perplexity.ai/settings/api (stored in vault).
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResult, GenerateOptions, GenerateResult, ModelInfo } from './LLMProvider';
import { OpenAICompatAdapter } from './openai-compat-adapter';

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai';

// Models available on Perplexity (sonar family — web-grounded + reasoning).
// Ordered newest/flagship first.
export const PERPLEXITY_MODELS = [
  'sonar-pro',
  'sonar',
  'sonar-reasoning-pro',
  'sonar-reasoning',
  'sonar-deep-research',
];

export class PerplexityAdapter implements LLMProvider {
  readonly id = 'perplexity' as const;
  private inner: OpenAICompatAdapter;

  constructor(apiKey: string) {
    this.inner = new OpenAICompatAdapter({
      endpoint:   PERPLEXITY_ENDPOINT,
      apiKey,
      providerId: 'perplexity' as any,
    });
  }

  chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    return this.inner.chat(messages, model, options);
  }

  generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.inner.generate(prompt, model, options);
  }

  async listModels(): Promise<ModelInfo[]> {
    // Perplexity doesn't expose a /v1/models listing, so we return the known static set.
    return PERPLEXITY_MODELS.map(name => ({ name }));
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await Promise.race([
        this.chat(
          [{ role: 'user', content: 'Reply with pong only.' }],
          'sonar',
          { max_tokens: 8, temperature: 0 },
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      return !!result;
    } catch {
      return false;
    }
  }
}
