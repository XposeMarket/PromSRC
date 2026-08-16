from pathlib import Path

status = Path('src/gateway/provider-status.ts')
status.write_text(r'''import crypto from 'crypto';
import { getConfig } from '../config/config';

interface ProviderStatusCacheEntry {
  checkedAt: number;
  connected: boolean;
  cacheKey: string;
}

let providerStatusCache: ProviderStatusCacheEntry | null = null;
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
  providerStatusCache = { checkedAt: Date.now(), connected, cacheKey };
}

export function markProviderStatusChecking(checking = true): void {
  providerStatusChecking = checking;
}

export function invalidateProviderStatusCache(): void {
  providerStatusCache = null;
  providerStatusChecking = false;
}

export function readProviderStatusCache(cacheKey = getProviderStatusCacheKey()): { checkedAt: number; connected: boolean } | null {
  const cached = providerStatusCache;
  if (!cached) return null;
  if (cached.cacheKey !== cacheKey || Date.now() - cached.checkedAt >= PROVIDER_STATUS_CACHE_MS) {
    if (providerStatusCache === cached) providerStatusCache = null;
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
  if (cached) return cached.connected;

  const connected = await Promise.race([
    testConnection().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROVIDER_STATUS_TIMEOUT_MS)),
  ]);
  // Capture the identity before the async probe. If settings change while the
  // probe is in flight, its result must stay attached to the old identity.
  markProviderStatus(connected, cacheKey);
  return connected;
}
''', encoding='utf-8')

startup = Path('src/gateway/core/startup.ts')
text = startup.read_text(encoding='utf-8')
old = r'''function scheduleStartupProviderWarmup(): void {
  markProviderStatusChecking(true);
  const timer = setTimeout(async () => {
    try {
      const provider = getProvider();
      const connected = await resolveProviderStatus(() => provider.testConnection());
      broadcastWS({ type: 'provider_status', providerOnline: connected, source: 'startup_probe' });
      console.log(`[ProviderStatus] Startup probe ${connected ? 'succeeded' : 'failed'}.`);
    } catch (err: any) {
      markProviderStatus(false);
      broadcastWS({ type: 'provider_status', providerOnline: false, source: 'startup_probe' });
      console.warn('[ProviderStatus] Startup probe failed:', err?.message || err);
    }
  }, 750);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
}
'''
new = r'''function scheduleStartupProviderWarmup(): void {
  const probe = async (source: 'startup_probe' | 'periodic_probe') => {
    markProviderStatusChecking(true);
    try {
      const provider = getProvider();
      const connected = await resolveProviderStatus(() => provider.testConnection());
      broadcastWS({ type: 'provider_status', providerOnline: connected, source });
      if (source === 'startup_probe') console.log(`[ProviderStatus] Startup probe ${connected ? 'succeeded' : 'failed'}.`);
    } catch (err: any) {
      markProviderStatus(false);
      broadcastWS({ type: 'provider_status', providerOnline: false, source });
      console.warn(`[ProviderStatus] ${source} failed:`, err?.message || err);
    }
  };

  const timer = setTimeout(() => { void probe('startup_probe'); }, 750);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();

  // Poll cheaply so a provider/account/config switch is noticed quickly. The
  // provider-status TTL still means the actual network probe runs at most once
  // every five minutes while the identity is unchanged.
  const refreshTimer = setInterval(() => { void probe('periodic_probe'); }, 30_000);
  if (typeof (refreshTimer as any).unref === 'function') (refreshTimer as any).unref();
}
'''
if old not in text:
    raise SystemExit('startup provider warmup anchor not found')
startup.write_text(text.replace(old, new, 1), encoding='utf-8')

reg = Path('src/gateway/provider-status.regression.ts')
reg.write_text(r'''import assert from 'node:assert/strict';
import {
  PROVIDER_STATUS_CACHE_MS,
  invalidateProviderStatusCache,
  markProviderStatus,
  readProviderStatusCache,
  resolveProviderStatus,
} from './provider-status.js';

async function main(): Promise<void> {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    invalidateProviderStatusCache();
    markProviderStatus(true, 'provider-a');
    assert.equal(readProviderStatusCache('provider-a')?.connected, true);
    assert.equal(readProviderStatusCache('provider-b'), null, 'provider/account/config identity changes must not reuse another health result');

    markProviderStatus(true, 'provider-a');
    now += PROVIDER_STATUS_CACHE_MS + 1;
    assert.equal(readProviderStatusCache('provider-a'), null, 'expired health results must not remain readable indefinitely');

    let probes = 0;
    const first = await resolveProviderStatus(async () => { probes += 1; return true; }, 'provider-b');
    const second = await resolveProviderStatus(async () => { probes += 1; return false; }, 'provider-b');
    assert.equal(first, true);
    assert.equal(second, true, 'fresh same-identity result should be reused');
    assert.equal(probes, 1, 'fresh cache should suppress duplicate provider probes');

    const oldProbe = resolveProviderStatus(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return false;
    }, 'old-provider');
    markProviderStatus(true, 'new-provider');
    await oldProbe;
    assert.equal(readProviderStatusCache('new-provider'), null, 'an old in-flight probe must not be relabeled as the new provider identity');
  } finally {
    Date.now = realNow;
    invalidateProviderStatusCache();
  }
  console.log('provider status cache regression: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
''', encoding='utf-8')
print('provider status cache patch applied')
