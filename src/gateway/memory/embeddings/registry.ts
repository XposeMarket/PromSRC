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

export function listMemoryEmbeddingProviders(): MemoryEmbeddingProvider[] {
  // Provider factories are intentionally rebuilt from current configuration.
  // They are lightweight descriptors, while caching them freezes endpoint,
  // model, and secret-reference choices captured when the gateway first asks
  // for memory embeddings. Settings changes must take effect without restart.
  return [
    createOpenAiEmbeddingProvider(),
    createOpenAiCodexOAuthEmbeddingProvider(),
    createOllamaEmbeddingProvider(),
    createLmStudioEmbeddingProvider(),
    createVoyageEmbeddingProvider(),
    createJinaEmbeddingProvider(),
    hashMemoryEmbeddingProvider,
  ];
}

export function resetMemoryEmbeddingProvidersForTests(): void {
  // Kept as a compatibility no-op for existing tests/callers. Providers no
  // longer retain configuration-backed state between resolutions.
}

export function getMemoryEmbeddingPreference(): MemoryEmbeddingPreference {
  const data = getConfig().getConfig() as any;
  return String(data.memory?.embeddings?.provider || process.env.PROMETHEUS_MEMORY_EMBEDDING_PROVIDER || 'auto') as MemoryEmbeddingPreference;
}

export function cloudMemoryEmbeddingsEnabled(): boolean {
  const data = getConfig().getConfig() as any;
  return data.memory?.embeddings?.allow_cloud === true
    || process.env.PROMETHEUS_MEMORY_ALLOW_CLOUD_EMBEDDINGS === '1';
}

export function orderedMemoryEmbeddingProviders(
  preferred: MemoryEmbeddingPreference,
  cloudEnabled = cloudMemoryEmbeddingsEnabled(),
  providers = listMemoryEmbeddingProviders(),
): MemoryEmbeddingProvider[] {
  const localProviders = providers.filter(provider => provider.local && provider.id !== 'hash');
  const cloudProviders = providers.filter(provider => !provider.local && provider.id !== 'hash');
  const withHash = (candidates: MemoryEmbeddingProvider[]) => [...candidates, hashMemoryEmbeddingProvider];

  if (preferred && !['auto', 'local-first', 'cloud', 'hash'].includes(preferred)) {
    const requested = providers.filter(provider => provider.id === preferred);
    return withHash(cloudEnabled ? requested : requested.filter(provider => provider.local));
  }
  if (preferred === 'hash') return [hashMemoryEmbeddingProvider];
  if (preferred === 'cloud') return withHash(cloudEnabled ? cloudProviders : localProviders);
  if (preferred === 'local-first') return withHash(cloudEnabled ? [...localProviders, ...cloudProviders] : localProviders);
  // `auto` must never turn a background refresh into an unexpected paid
  // request. Prefer local/ONNX-capable providers and otherwise stay on hash.
  return withHash(localProviders);
}

function orderedProviders(preferred: MemoryEmbeddingPreference): MemoryEmbeddingProvider[] {
  return orderedMemoryEmbeddingProviders(preferred);
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
  const cloudEnabled = cloudMemoryEmbeddingsEnabled();
  const providers = listMemoryEmbeddingProviders();
  const candidates = explicitProvider || pref === 'cloud'
    ? orderedProviders(pref).filter(provider => provider.id !== 'hash')
    : providers.filter(provider => provider.local && provider.id !== 'hash');

  // Explicit provider choices still need the cloud opt-in; without it, auto
  // backfill may only use local providers and never fall back to the cloud.
  const eligibleCandidates = cloudEnabled ? candidates : candidates.filter(provider => provider.local);
  for (const provider of eligibleCandidates) {
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
