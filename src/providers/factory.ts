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
import { getValidXAIToken, isXAIConnected } from '../auth/xai-oauth';
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

function getProviderConfig(): { active: ProviderID; providers: any; accountId?: string } {
  const raw = getConfig().getConfig() as any;

  if (raw.llm?.provider) {
    return { active: raw.llm.provider, providers: raw.llm.providers || {}, accountId: raw.llm.accountId };
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

function readAccountId(id: string, providers: any, requestedAccountId?: string): string {
  const providerCfg = providers?.[id];
  const accounts = providerCfg?.accounts && typeof providerCfg.accounts === 'object' && !Array.isArray(providerCfg.accounts)
    ? providerCfg.accounts
    : {};
  const requested = String(requestedAccountId || '').trim();
  if (requested && accounts[requested]) return requested;
  const providerDefault = String(providerCfg?.defaultAccountId || '').trim();
  if (providerDefault && accounts[providerDefault]) return providerDefault;
  const first = Object.keys(accounts).find(key => accounts[key] && typeof accounts[key] === 'object');
  return first || requested || '';
}

function getProviderAccountSettings(id: string, providers: any, requestedAccountId?: string): { cfg: Record<string, unknown>; accountId?: string } {
  const base = getProviderSettings(id, providers);
  const providerCfg = providers?.[id] && typeof providers[id] === 'object' && !Array.isArray(providers[id])
    ? providers[id]
    : {};
  const accountId = readAccountId(id, providers, requestedAccountId);
  const accounts = providerCfg?.accounts && typeof providerCfg.accounts === 'object' && !Array.isArray(providerCfg.accounts)
    ? providerCfg.accounts
    : {};
  const accountCfg = accountId && accounts[accountId] && typeof accounts[accountId] === 'object' && !Array.isArray(accounts[accountId])
    ? accounts[accountId]
    : {};
  const { accounts: _accounts, defaultAccountId: _defaultAccountId, ...providerNoAccounts } = providerCfg;
  const cfg = {
    ...getProviderDefaultConfig(id),
    ...providerNoAccounts,
    ...accountCfg,
  };
  void base;
  return { cfg, accountId: accountId || undefined };
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
let cachedProviderKey: string | null = null;
const providerAccountIds = new WeakMap<object, string>();

function rememberProviderAccount(provider: LLMProvider, accountId?: string): LLMProvider {
  const normalized = String(accountId || '').trim();
  if (normalized) providerAccountIds.set(provider as object, normalized);
  return provider;
}

/** Preserve the credential identity when a provider instance crosses a worker boundary. */
export function getProviderAccountId(provider: LLMProvider): string | undefined {
  return providerAccountIds.get(provider as object)
    || String((provider as any)?.accountId || '').trim()
    || undefined;
}

export function getProvider(): LLMProvider {
  const { active, providers, accountId } = getProviderConfig();
  const selectedAccountId = readAccountId(active, providers, accountId);
  const cacheKey = `${active}:${selectedAccountId || ''}`;

  if (cachedProvider && cachedProviderKey === cacheKey) {
    if (active === 'ollama' && cachedProvider instanceof OllamaAdapter) {
      const cfg = getProviderSettings('ollama', providers);
      cachedProvider.updateEndpoint(readStringSetting(cfg, 'endpoint') || 'http://localhost:11434');
    }
    return cachedProvider;
  }

  cachedProviderKey = cacheKey;
  cachedProvider = rememberProviderAccount(
    buildProvider(active, providers, selectedAccountId),
    selectedAccountId,
  );
  return cachedProvider;
}

export function resetProvider(): void {
  cachedProvider = null;
  cachedProviderKey = null;
}

export function buildProviderById(providerId: string, accountId?: string): LLMProvider {
  const raw = getConfig().getConfig() as any;
  const providers = raw.llm?.providers || {};
  const selectedAccountId = readAccountId(providerId, providers, accountId);
  return rememberProviderAccount(
    buildProvider(providerId, providers, selectedAccountId),
    selectedAccountId,
  );
}

export function buildProviderForLLM(llm: any): LLMProvider {
  const active = String(llm?.provider || 'ollama');
  const providers = llm?.providers || {};
  const selectedAccountId = readAccountId(active, providers, llm?.accountId);
  return rememberProviderAccount(
    buildProvider(active, providers, selectedAccountId),
    selectedAccountId,
  );
}

function buildProvider(id: ProviderID, providers: any, accountId?: string): LLMProvider {
  const descriptor = getProviderDescriptor(id);
  if (!descriptor) {
    log.warn(`[Provider] Unknown provider "${id}", falling back to Ollama`);
    return new OllamaAdapter('http://localhost:11434');
  }

  const { cfg, accountId: resolvedAccountId } = getProviderAccountSettings(id, providers, accountId);
  const runtime = getProviderRuntimeOptions(id);

  switch (descriptor.runtime.binding) {
    case 'providers/ollama-adapter': {
      return new OllamaAdapter(readStringSetting(cfg, 'endpoint') || 'http://localhost:11434');
    }

    case 'providers/openai-compat-adapter': {
      const authType = descriptor.setup?.authType || 'none';
      const rawProviderCfg = providers?.[id] && typeof providers[id] === 'object' && !Array.isArray(providers[id])
        ? providers[id]
        : {};
      const explicitAuthMode = readStringSetting(rawProviderCfg, 'auth_mode');
      const authMode = explicitAuthMode || readStringSetting(cfg, 'auth_mode') || 'api_key';
      const useXaiOAuth = id === 'xai' && (authMode === 'oauth' || (!explicitAuthMode && isXAIConnected(getConfigDir(), resolvedAccountId)));
      const apiKey = useXaiOAuth
        ? undefined
        : authType === 'api_key'
          ? requireApiKey(id, cfg)
          : resolveSecretKey(readStringSetting(cfg, 'api_key'));
      const endpoint = readStringSetting(cfg, 'endpoint') || runtime.endpoint || 'http://localhost:11434';
      return new OpenAICompatAdapter({
        endpoint,
        apiKey,
        getToken: useXaiOAuth ? () => getValidXAIToken(getConfigDir(), resolvedAccountId) : undefined,
        providerId: id,
        chatCompletionsPath: runtime.chatCompletionsPath,
        modelsPath: runtime.modelsPath,
        defaultHeaders: runtime.defaultHeaders,
        authLabel: useXaiOAuth ? 'xAI OAuth' : (authType === 'api_key' ? 'API key' : undefined),
        staticModels: runtime.staticModels,
        supportsReasoningEffort: runtime.supportsReasoningEffort,
      });
    }

    case 'providers/openai-codex-adapter': {
      return new OpenAICodexAdapter({ configDir: getConfigDir(), accountId: resolvedAccountId });
    }

    case 'providers/anthropic-adapter': {
      if (id === 'anthropic') {
        return new AnthropicAdapter({ configDir: getConfigDir(), accountId: resolvedAccountId });
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
