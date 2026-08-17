import crypto from 'crypto';
import { getConfig } from '../config/config';

interface ProviderStatusCacheEntry {
  checkedAt: number;
  connected: boolean;
  cacheKey: string;
}

const providerStatusCache = new Map<string, ProviderStatusCacheEntry>();
const PROVIDER_STATUS_CACHE_ENTRY_LIMIT = 8;
let providerStatusChecking = false;

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

export function markProviderStatus(connected: boolean, cacheKey = getProviderStatusCacheKey()): void {
  providerStatusChecking = false;
  providerStatusCache.set(cacheKey, { checkedAt: Date.now(), connected, cacheKey });
  while (providerStatusCache.size > PROVIDER_STATUS_CACHE_ENTRY_LIMIT) {
    const oldest = [...providerStatusCache.entries()].sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0];
    if (!oldest) break;
    providerStatusCache.delete(oldest[0]);
  }
}

export function markProviderStatusChecking(checking = true): void {
  providerStatusChecking = checking;
}

export function invalidateProviderStatusCache(): void {
  providerStatusCache.clear();
  providerStatusChecking = false;
}

export function readProviderStatusCache(cacheKey = getProviderStatusCacheKey()): { checkedAt: number; connected: boolean } | null {
  const cached = providerStatusCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt >= PROVIDER_STATUS_CACHE_MS) {
    providerStatusCache.delete(cacheKey);
    return null;
  }
  return { checkedAt: cached.checkedAt, connected: cached.connected };
}

export function isProviderStatusChecking(): boolean {
  return providerStatusChecking;
}

export async function resolveProviderStatus(
  testConnection: () => Promise<boolean>,
  cacheKey = getProviderStatusCacheKey(),
): Promise<boolean> {
  const cached = readProviderStatusCache(cacheKey);
  if (cached) {
    providerStatusChecking = false;
    return cached.connected;
  }

  const connected = await Promise.race([
    testConnection().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROVIDER_STATUS_TIMEOUT_MS)),
  ]);
  // Capture the identity before the async probe. If settings change while the
  // probe is in flight, its result must stay attached to the old identity.
  markProviderStatus(connected, cacheKey);
  return connected;
}
