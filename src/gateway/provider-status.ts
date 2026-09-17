import crypto from 'crypto';
import { getConfig } from '../config/config';

interface ProviderStatusCacheEntry {
  checkedAt: number;
  connected: boolean;
  cacheKey: string;
  result: ProviderCheckResult;
  source: 'connection_probe' | 'runtime_report';
}

export type ProviderCheckResult = 'success' | 'failed' | 'timeout' | 'exception';

const providerStatusCache = new Map<string, ProviderStatusCacheEntry>();
const PROVIDER_STATUS_CACHE_ENTRY_LIMIT = 8;
const providerStatusChecking = new Set<string>();
let cacheGeneration = 0;

export const PROVIDER_STATUS_CACHE_MS = 5 * 60_000;
export const PROVIDER_STATUS_TIMEOUT_MS = 3_000;

export function getProviderStatusCacheKey(): string {
  const raw = getConfig().getConfig() as any;
  const providerId = String(raw?.llm?.provider || 'ollama').trim().toLowerCase() || 'ollama';
  const providerConfig = raw?.llm?.providers?.[providerId] && typeof raw.llm.providers[providerId] === 'object'
    ? raw.llm.providers[providerId]
    : (providerId === 'ollama' ? (raw?.ollama || {}) : {});
  const requestedAccountId = String(raw?.llm?.accountId || '').trim();
  const defaultAccountId = String(providerConfig?.defaultAccountId || '').trim();
  const accounts = providerConfig?.accounts && typeof providerConfig.accounts === 'object' && !Array.isArray(providerConfig.accounts)
    ? providerConfig.accounts
    : {};
  const accountId = requestedAccountId || defaultAccountId || Object.keys(accounts)[0] || '';
  // Hash the provider-specific config rather than embedding credentials or
  // endpoints in the public/debuggable cache key. Any credential/auth/endpoint
  // mutation invalidates the health result even when provider/account are stable.
  const configFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(providerConfig || {}))
    .digest('hex')
    .slice(0, 16);
  return `${providerId}:${accountId}:${configFingerprint}`;
}

export function markProviderStatus(
  connected: boolean,
  cacheKey = getProviderStatusCacheKey(),
  evidence: { result: ProviderCheckResult; source: 'connection_probe' | 'runtime_report' } = { result: connected ? 'success' : 'failed', source: 'runtime_report' },
): void {
  providerStatusChecking.delete(cacheKey);
  providerStatusCache.set(cacheKey, { checkedAt: Date.now(), connected, cacheKey, ...evidence });
  while (providerStatusCache.size > PROVIDER_STATUS_CACHE_ENTRY_LIMIT) {
    const oldest = [...providerStatusCache.entries()].sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0];
    if (!oldest) break;
    providerStatusCache.delete(oldest[0]);
  }
}

export function markProviderStatusChecking(checking = true, cacheKey = getProviderStatusCacheKey()): void {
  if (checking) providerStatusChecking.add(cacheKey);
  else providerStatusChecking.delete(cacheKey);
}

export function invalidateProviderStatusCache(): void {
  cacheGeneration += 1;
  providerStatusCache.clear();
  providerStatusChecking.clear();
}

export function readProviderStatusCache(cacheKey = getProviderStatusCacheKey()): { checkedAt: number; connected: boolean } | null {
  const cached = providerStatusCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt >= PROVIDER_STATUS_CACHE_MS) {
    return null;
  }
  return { checkedAt: cached.checkedAt, connected: cached.connected };
}

export function isProviderStatusChecking(cacheKey = getProviderStatusCacheKey()): boolean {
  return providerStatusChecking.has(cacheKey);
}

/** Evidence is retained after expiry for inspection; expired results never imply live health. */
export function readProviderStatusEvidence(cacheKey = getProviderStatusCacheKey(), now = Date.now()) {
  const cached = providerStatusCache.get(cacheKey);
  const ageMs = cached ? Math.max(0, now - cached.checkedAt) : null;
  return {
    provider: cached?.source === 'connection_probe' ? cacheKey.split(':')[0] : null,
    configuredProvider: cacheKey.split(':')[0],
    model: null,
    scope: cached?.source === 'connection_probe' ? 'configured_provider_connection' : 'unverified_runtime_route',
    source: cached?.source || null,
    checkedAt: cached?.checkedAt || null,
    ageMs,
    freshness: !cached ? 'unknown' : ageMs! >= PROVIDER_STATUS_CACHE_MS ? 'stale' : 'fresh',
    result: cached?.result || null,
    checking: isProviderStatusChecking(cacheKey),
  };
}

export async function resolveProviderStatus(
  testConnection: () => Promise<boolean>,
  cacheKey = getProviderStatusCacheKey(),
): Promise<boolean> {
  const cached = readProviderStatusCache(cacheKey);
  if (cached && providerStatusCache.get(cacheKey)?.source === 'connection_probe') {
    providerStatusChecking.delete(cacheKey);
    return cached.connected;
  }

  const generation = cacheGeneration;
  providerStatusChecking.add(cacheKey);
  const entryAtStart = providerStatusCache.get(cacheKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: ProviderCheckResult;
  try {
    result = await Promise.race([
      Promise.resolve().then(testConnection).then((connected): ProviderCheckResult => connected ? 'success' : 'failed', (): ProviderCheckResult => 'exception'),
      new Promise<ProviderCheckResult>((resolve) => { timer = setTimeout(() => resolve('timeout'), PROVIDER_STATUS_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const connected = result === 'success';
  // Capture the identity before the async probe. If settings change while the
  // probe is in flight, its result must stay attached to the old identity.
  if (generation === cacheGeneration && providerStatusCache.get(cacheKey) === entryAtStart) {
    markProviderStatus(connected, cacheKey, { result, source: 'connection_probe' });
  } else {
    // A newer runtime observation or config invalidation wins over an older probe.
    if (generation === cacheGeneration) providerStatusChecking.delete(cacheKey);
    return readProviderStatusCache(cacheKey)?.connected ?? connected;
  }
  return connected;
}
