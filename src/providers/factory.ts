/**
 * factory.ts
 * Returns the active LLMProvider based on config.
 * All code that needs to talk to an LLM goes through here.
 */

import { getConfig } from '../config/config';
import { log } from '../security/log-scrubber';
import type { LLMProvider, ProviderID } from './LLMProvider';
import { OllamaAdapter } from './ollama-adapter';
import { OpenAICompatAdapter } from './openai-compat-adapter';
import { OpenAICodexAdapter } from './openai-codex-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { PerplexityAdapter } from './perplexity-adapter';
import { GeminiAdapter } from './gemini-adapter';
import {
  getProviderDefaultConfig,
  getProviderDescriptor,
  getProviderRuntimeOptions,
} from './provider-registry.js';

const LEGACY_BLOCKED_MODELS = new Set(['codex-davinci-002']);
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENAI_CODEX_MODEL = 'gpt-5.4';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_PERPLEXITY_MODEL = 'sonar-pro';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

function getProviderConfig(): { active: ProviderID; providers: any } {
  const raw = getConfig().getConfig() as any;

  if (raw.llm?.provider) {
    return { active: raw.llm.provider, providers: raw.llm.providers || {} };
  }

  return {
    active: 'ollama',
    providers: {
      ollama: {
        endpoint: raw.ollama?.endpoint || 'http://localhost:11434',
        model: raw.models?.primary || 'qwen3:4b',
      },
    },
  };
}

function getConfigDir(): string {
  return getConfig().getConfigDir();
}

function getProviderSettings(id: string, providers: any): Record<string, unknown> {
  const configured = providers?.[id];
  return {
    ...getProviderDefaultConfig(id),
    ...(configured && typeof configured === 'object' && !Array.isArray(configured) ? configured : {}),
  };
}

function getProviderDisplayName(id: string): string {
  return getProviderDescriptor(id)?.name || id;
}

function readStringSetting(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

function requireApiKey(id: string, cfg: Record<string, unknown>): string {
  const apiKey = resolveSecretKey(readStringSetting(cfg, 'api_key'));
  if (!apiKey) {
    throw new Error(`${getProviderDisplayName(id)} API key not configured. Add it in Settings -> Models.`);
  }
  return apiKey;
}

let cachedProvider: LLMProvider | null = null;
let cachedProviderId: ProviderID | null = null;

export function getProvider(): LLMProvider {
  const { active, providers } = getProviderConfig();

  if (cachedProvider && cachedProviderId === active) {
    if (active === 'ollama' && cachedProvider instanceof OllamaAdapter) {
      const cfg = getProviderSettings('ollama', providers);
      cachedProvider.updateEndpoint(readStringSetting(cfg, 'endpoint') || 'http://localhost:11434');
    }
    return cachedProvider;
  }

  cachedProviderId = active;
  cachedProvider = buildProvider(active, providers);
  return cachedProvider;
}

export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderId = null;
}

export function buildProviderById(providerId: string): LLMProvider {
  const raw = getConfig().getConfig() as any;
  const providers = raw.llm?.providers || {};
  return buildProvider(providerId, providers);
}

export function buildProviderForLLM(llm: any): LLMProvider {
  const active = String(llm?.provider || 'ollama');
  const providers = llm?.providers || {};
  return buildProvider(active, providers);
}

function buildProvider(id: ProviderID, providers: any): LLMProvider {
  const descriptor = getProviderDescriptor(id);
  if (!descriptor) {
    log.warn(`[Provider] Unknown provider "${id}", falling back to Ollama`);
    return new OllamaAdapter('http://localhost:11434');
  }

  const cfg = getProviderSettings(id, providers);
  const runtime = getProviderRuntimeOptions(id);

  switch (descriptor.runtime.binding) {
    case 'providers/ollama-adapter': {
      return new OllamaAdapter(readStringSetting(cfg, 'endpoint') || 'http://localhost:11434');
    }

    case 'providers/openai-compat-adapter': {
      const authType = descriptor.setup?.authType || 'none';
      const apiKey = authType === 'api_key'
        ? requireApiKey(id, cfg)
        : resolveSecretKey(readStringSetting(cfg, 'api_key'));
      const endpoint = readStringSetting(cfg, 'endpoint') || runtime.endpoint || 'http://localhost:11434';
      return new OpenAICompatAdapter({
        endpoint,
        apiKey,
        providerId: id,
        chatCompletionsPath: runtime.chatCompletionsPath,
        modelsPath: runtime.modelsPath,
        defaultHeaders: runtime.defaultHeaders,
        staticModels: runtime.staticModels,
        supportsReasoningEffort: runtime.supportsReasoningEffort,
      });
    }

    case 'providers/openai-codex-adapter': {
      return new OpenAICodexAdapter(getConfigDir());
    }

    case 'providers/anthropic-adapter': {
      if (id === 'anthropic') {
        return new AnthropicAdapter(getConfigDir());
      }
      return new AnthropicAdapter({
        providerId: id,
        apiKey: requireApiKey(id, cfg),
        baseUrl: readStringSetting(cfg, 'endpoint') || runtime.endpoint || '',
        authHeader: runtime.authHeader,
        staticModels: runtime.staticModels,
        defaultHeaders: runtime.defaultHeaders,
      });
    }

    case 'providers/perplexity-adapter': {
      return new PerplexityAdapter(requireApiKey(id, cfg));
    }

    case 'providers/gemini-adapter': {
      return new GeminiAdapter(requireApiKey(id, cfg));
    }

    default: {
      log.warn(`[Provider] Unsupported binding "${descriptor.runtime.binding}" for "${id}", falling back to Ollama`);
      return new OllamaAdapter('http://localhost:11434');
    }
  }
}

function resolveEnvKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('env:')) {
    const envName = value.slice(4);
    return process.env[envName];
  }
  return value;
}

function resolveSecretKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const envResolved = resolveEnvKey(value);
  if (envResolved !== value) return envResolved;
  return getConfig().resolveSecret(value);
}

export function getModelForRole(role: 'manager' | 'executor' | 'verifier'): string {
  const raw = getConfig().getConfig() as any;
  const { active, providers } = getProviderConfig();
  const providerCfg = getProviderSettings(active, providers);

  if (providerCfg.model) {
    const model = String(providerCfg.model).trim();
    if (active === 'openai_codex' && LEGACY_BLOCKED_MODELS.has(model)) return DEFAULT_OPENAI_CODEX_MODEL;
    return model;
  }

  const defaultModel = String(getProviderDefaultConfig(active).model || '').trim();
  if (defaultModel) {
    if (active === 'openai_codex' && LEGACY_BLOCKED_MODELS.has(defaultModel)) return DEFAULT_OPENAI_CODEX_MODEL;
    return defaultModel;
  }

  if (active === 'openai_codex') return DEFAULT_OPENAI_CODEX_MODEL;
  if (active === 'openai') return DEFAULT_OPENAI_MODEL;
  if (active === 'anthropic') return DEFAULT_ANTHROPIC_MODEL;
  if (active === 'perplexity') return DEFAULT_PERPLEXITY_MODEL;
  if (active === 'gemini') return DEFAULT_GEMINI_MODEL;

  return raw.models?.roles?.[role] || raw.models?.primary || 'qwen3:4b';
}

export function getPrimaryModel(): string {
  return getModelForRole('executor');
}
