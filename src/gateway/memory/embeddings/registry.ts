import { getConfig } from '../../../config/config';
import { hashMemoryEmbeddingProvider } from './hash-provider';
import {
  createJinaEmbeddingProvider,
  createLmStudioEmbeddingProvider,
  createOllamaEmbeddingProvider,
  createOpenAiCodexOAuthEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  createVoyageEmbeddingProvider,
} from './http-providers';
import type { MemoryEmbeddingPreference, MemoryEmbeddingProvider, MemoryEmbeddingProviderStatus } from './types';

let cachedProviders: MemoryEmbeddingProvider[] | null = null;

export function listMemoryEmbeddingProviders(): MemoryEmbeddingProvider[] {
  if (!cachedProviders) {
    cachedProviders = [
      createOpenAiEmbeddingProvider(),
      createOpenAiCodexOAuthEmbeddingProvider(),
      createOllamaEmbeddingProvider(),
      createLmStudioEmbeddingProvider(),
      createVoyageEmbeddingProvider(),
      createJinaEmbeddingProvider(),
      hashMemoryEmbeddingProvider,
    ];
  }
  return cachedProviders;
}

export function resetMemoryEmbeddingProvidersForTests(): void {
  cachedProviders = null;
}

export function getMemoryEmbeddingPreference(): MemoryEmbeddingPreference {
  const data = getConfig().getConfig() as any;
  return String(data.memory?.embeddings?.provider || process.env.PROMETHEUS_MEMORY_EMBEDDING_PROVIDER || 'auto') as MemoryEmbeddingPreference;
}

function orderedProviders(preferred: MemoryEmbeddingPreference): MemoryEmbeddingProvider[] {
  const providers = listMemoryEmbeddingProviders();
  if (preferred && !['auto', 'local-first', 'cloud', 'hash'].includes(preferred)) {
    return [
      ...providers.filter(provider => provider.id === preferred),
      hashMemoryEmbeddingProvider,
    ];
  }
  if (preferred === 'hash') return [hashMemoryEmbeddingProvider];
  if (preferred === 'local-first') {
    return [
      ...providers.filter(provider => provider.local && provider.id !== 'hash'),
      ...providers.filter(provider => !provider.local),
      hashMemoryEmbeddingProvider,
    ];
  }
  if (preferred === 'cloud') {
    return [
      ...providers.filter(provider => !provider.local),
      ...providers.filter(provider => provider.local && provider.id !== 'hash'),
      hashMemoryEmbeddingProvider,
    ];
  }
  return [
    ...providers.filter(provider => provider.id === 'openai'),
    ...providers.filter(provider => provider.id === 'openai_codex_oauth'),
    ...providers.filter(provider => provider.id === 'ollama'),
    ...providers.filter(provider => provider.id === 'lmstudio'),
    ...providers.filter(provider => provider.id === 'voyage'),
    ...providers.filter(provider => provider.id === 'jina'),
    hashMemoryEmbeddingProvider,
  ];
}

export async function getActiveMemoryEmbeddingProvider(requested?: MemoryEmbeddingPreference): Promise<MemoryEmbeddingProvider> {
  const pref = requested || getMemoryEmbeddingPreference();
  const failures: string[] = [];
  for (const provider of orderedProviders(pref)) {
    try {
      const status = await provider.status();
      if (status.ok) return provider;
      failures.push(`${provider.id}: ${status.reason || 'unavailable'}`);
    } catch (err: any) {
      failures.push(`${provider.id}: ${String(err?.message || err)}`);
    }
  }
  if (failures.length) {
    // The hash provider should always be reachable, but keep a defensive fallback.
    return hashMemoryEmbeddingProvider;
  }
  return hashMemoryEmbeddingProvider;
}

export async function getAutomaticMemoryEmbeddingProvider(requested?: MemoryEmbeddingPreference): Promise<MemoryEmbeddingProvider | null> {
  const pref = requested || getMemoryEmbeddingPreference();
  if (pref === 'hash') return null;

  const explicitProvider = pref && !['auto', 'local-first', 'cloud'].includes(String(pref));
  const providers = listMemoryEmbeddingProviders();
  const connectedOpenAiCandidates = [
    ...providers.filter(provider => provider.id === 'openai'),
    ...providers.filter(provider => provider.id === 'openai_codex_oauth'),
  ];
  const candidates = explicitProvider || pref === 'cloud'
    ? orderedProviders(pref).filter(provider => provider.id !== 'hash')
    : [
      ...connectedOpenAiCandidates,
      ...providers.filter(provider => provider.local && provider.id !== 'hash'),
    ];

  for (const provider of candidates) {
    try {
      const status = await provider.status();
      if (status.ok) return provider;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function getMemoryEmbeddingStatus(): Promise<{
  preference: MemoryEmbeddingPreference;
  active: string;
  automatic: string | null;
  providers: MemoryEmbeddingProviderStatus[];
}> {
  const pref = getMemoryEmbeddingPreference();
  const providers = await Promise.all(listMemoryEmbeddingProviders().map(async (provider) => {
    try {
      return await provider.status();
    } catch (err: any) {
      return {
        ok: false,
        reason: String(err?.message || err),
        providerId: provider.id,
        model: provider.defaultModel,
        local: provider.local,
      };
    }
  }));
  const active = await getActiveMemoryEmbeddingProvider(pref);
  const automatic = await getAutomaticMemoryEmbeddingProvider(pref);
  return { preference: pref, active: active.id, automatic: automatic?.id || null, providers };
}
