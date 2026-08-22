/**
 * opencode-adapter.ts
 *
 * OpenCode Zen / Go expose a mixed protocol catalog. Some models use the
 * OpenAI-compatible chat-completions surface while others use Anthropic's
 * Messages API (and still others use Responses or model-specific Google
 * endpoints). Prometheus must not advertise a model through a protocol it
 * cannot actually speak.
 *
 * This adapter supports the two protocol families Prometheus can route safely
 * today: OpenAI-compatible chat completions and Anthropic Messages. The bundled
 * manifests intentionally curate only models using those two surfaces. Models
 * that OpenCode marks as Responses-only or Google-native stay hidden until a
 * native adapter is added for those protocols.
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ProviderID,
} from './LLMProvider';
import { OpenAICompatAdapter } from './openai-compat-adapter';
import { AnthropicAdapter } from './anthropic-adapter';

export interface OpenCodeAdapterConfig {
  providerId: string;
  endpoint: string;
  apiKey: string;
  staticModels: string[];
}

function usesMessagesProtocol(providerId: string, model: string): boolean {
  const id = String(model || '').trim().toLowerCase();
  if (providerId === 'opencode') {
    return id.startsWith('claude-') || id.startsWith('qwen3.');
  }
  if (providerId === 'opencode-go') {
    return id.startsWith('minimax-') || id.startsWith('qwen3.');
  }
  return false;
}

function baseWithoutV1(endpoint: string): string {
  return String(endpoint || '').trim().replace(/\/$/, '').replace(/\/v1$/, '');
}

export class OpenCodeAdapter implements LLMProvider {
  readonly id: ProviderID;
  private readonly staticModels: string[];
  private readonly chatCompat: OpenAICompatAdapter;
  private readonly messagesCompat: AnthropicAdapter;

  constructor(config: OpenCodeAdapterConfig) {
    this.id = config.providerId;
    this.staticModels = [...config.staticModels];
    this.chatCompat = new OpenAICompatAdapter({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      providerId: config.providerId,
      chatCompletionsPath: '/chat/completions',
      modelsPath: '/models',
      staticModels: config.staticModels,
    });
    this.messagesCompat = new AnthropicAdapter({
      providerId: config.providerId,
      apiKey: config.apiKey,
      baseUrl: baseWithoutV1(config.endpoint),
      authHeader: 'bearer',
      staticModels: config.staticModels,
    });
  }

  chat(messages: ChatMessage[], model: string, options?: ChatOptions): Promise<ChatResult> {
    return usesMessagesProtocol(this.id, model)
      ? this.messagesCompat.chat(messages, model, options)
      : this.chatCompat.chat(messages, model, options);
  }

  generate(prompt: string, model: string, options?: GenerateOptions): Promise<GenerateResult> {
    return usesMessagesProtocol(this.id, model)
      ? this.messagesCompat.generate(prompt, model, options)
      : this.chatCompat.generate(prompt, model, options);
  }

  async listModels(): Promise<ModelInfo[]> {
    // OpenCode's /models endpoint also returns Responses-only and Google-native
    // models. Returning that unfiltered list would let users select models this
    // adapter cannot invoke, so expose the verified manifest subset only.
    return this.staticModels.map((name) => ({ name }));
  }

  async testConnection(): Promise<boolean> {
    // /models is shared across OpenCode protocols and is the least expensive
    // authenticated connectivity check.
    return this.chatCompat.testConnection();
  }
}
