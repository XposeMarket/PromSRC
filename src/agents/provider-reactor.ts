/**
 * provider-reactor.ts
 *
 * Bridges a raw LLMProvider + model string into an OllamaClient-shaped shim
 * so Reactor can use any provider (OpenAI, OAuth, llama.cpp, etc.) directly
 * without touching the global getProvider() singleton.
 *
 * Used by spawner.ts when a sub-agent has an explicit model/provider configured.
 * Ollama agents continue to use the global singleton path (unchanged).
 */

import type { LLMProvider } from '../providers/LLMProvider';
import {
  appendModelUsageEvent,
  estimateMessagesTokens,
  estimateTextTokens,
  normalizeUsage,
} from '../providers/model-usage';
import type { AgentRole } from '../types';

// Minimal interface Reactor actually needs from OllamaClient
export interface ReactorClient {
  generateWithRetryThinking(
    prompt: string,
    role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low' | 'minimal' | 'none';
      usageContext?: { sessionId?: string; agentId?: string };
    },
    maxRetries?: number,
  ): Promise<{ response: string; thinking?: string }>;

  chatWithThinking(
    messages: Array<any>,
    role: AgentRole,
    options?: {
      temperature?: number;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low' | 'minimal' | 'none';
      tools?: any[];
      model?: string;
      usageContext?: { sessionId?: string; agentId?: string };
    },
  ): Promise<{ message: any; thinking?: string }>;
}

/**
 * Wraps a pre-built LLMProvider + model into the OllamaClient API surface
 * that Reactor depends on. Does not touch the global provider singleton.
 */
export class ProviderReactorClient implements ReactorClient {
  /** Marker used by Reactor to detect cloud providers and enable native tool calls */
  readonly isCloudProvider = true;

  constructor(
    private readonly provider: LLMProvider,
    private readonly model: string,
  ) {}

  async generateWithRetryThinking(
    prompt: string,
    _role: AgentRole,
    options?: {
      temperature?: number;
      format?: 'json';
      system?: string;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low' | 'minimal' | 'none';
      usageContext?: { sessionId?: string; agentId?: string };
    },
    maxRetries: number = 3,
  ): Promise<{ response: string; thinking?: string }> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startedAt = Date.now();
        const result = await this.provider.generate(prompt, this.model, {
          temperature: options?.temperature,
          format: options?.format,
          system: options?.system,
          num_ctx: options?.num_ctx,
          max_tokens: options?.num_predict,
          think: options?.think,
        });
        const usage = normalizeUsage(result.usage, {
          inputTokens: estimateTextTokens(`${options?.system || ''}\n${prompt}`),
          outputTokens: estimateTextTokens(result.response) + estimateTextTokens(result.thinking),
        });
        appendModelUsageEvent({
          provider: this.provider.id,
          model: this.model,
          callType: 'generate',
          sessionId: options?.usageContext?.sessionId,
          agentId: options?.usageContext?.agentId,
          ...usage,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (err: any) {
        lastError = err;
        console.warn(`[ProviderReactorClient] Attempt ${attempt + 1}/${maxRetries} failed: ${err?.message}`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError || new Error('Generation failed after retries');
  }

  async chatWithThinking(
    messages: Array<any>,
    _role: AgentRole,
    options?: {
      temperature?: number;
      num_ctx?: number;
      num_predict?: number;
      think?: boolean | 'high' | 'medium' | 'low' | 'minimal' | 'none';
      tools?: any[];
      model?: string;
      usageContext?: { sessionId?: string; agentId?: string };
    },
  ): Promise<{ message: any; thinking?: string }> {
    const model = options?.model || this.model;
    const startedAt = Date.now();
    const result = await this.provider.chat(messages, model, {
      temperature: options?.temperature,
      max_tokens: options?.num_predict,
      num_ctx: options?.num_ctx,
      tools: options?.tools,
      think: options?.think,
    });
    const usage = normalizeUsage(result.usage, {
      inputTokens: estimateMessagesTokens(messages),
      outputTokens: estimateMessagesTokens([result.message]) + estimateTextTokens(result.thinking),
    });
    appendModelUsageEvent({
      provider: this.provider.id,
      model,
      callType: 'chat',
      sessionId: options?.usageContext?.sessionId,
      agentId: options?.usageContext?.agentId,
      ...usage,
      durationMs: Date.now() - startedAt,
    });
    return { message: result.message, thinking: result.thinking };
  }
}

/**
 * Parses an agent model string in "provider/model" format.
 * Returns null if the string is empty or has no provider prefix.
 *
 * Examples:
 *   "openai_codex/gpt-4o"     → { provider: "openai_codex", model: "gpt-4o" }
 *   "openai/gpt-4o"           → { provider: "openai",       model: "gpt-4o" }
 *   "ollama/qwen3:4b"         → { provider: "ollama",       model: "qwen3:4b" }
 *   "qwen3:4b"                → null  (no provider prefix — use global)
 *   ""                        → null
 */
export function parseAgentModelString(modelStr?: string): { provider: string; model: string } | null {
  if (!modelStr || !modelStr.trim()) return null;
  const idx = modelStr.indexOf('/');
  if (idx <= 0) return null; // no prefix or starts with /
  const provider = modelStr.slice(0, idx).trim();
  const model = modelStr.slice(idx + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}
