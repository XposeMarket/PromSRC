let providerStatusCache: { checkedAt: number; connected: boolean } | null = null;
let providerStatusChecking = false;

export const PROVIDER_STATUS_CACHE_MS = 5 * 60_000;
export const PROVIDER_STATUS_TIMEOUT_MS = 15_000;

export function markProviderStatus(connected: boolean): void {
  providerStatusChecking = false;
  providerStatusCache = { checkedAt: Date.now(), connected };
}

export function markProviderStatusChecking(checking = true): void {
  providerStatusChecking = checking;
}

export function readProviderStatusCache(): { checkedAt: number; connected: boolean } | null {
  return providerStatusCache ? { ...providerStatusCache } : null;
}

export function isProviderStatusChecking(): boolean {
  return providerStatusChecking;
}

export async function resolveProviderStatus(testConnection: () => Promise<boolean>): Promise<boolean> {
  const now = Date.now();
  if (providerStatusCache && now - providerStatusCache.checkedAt < PROVIDER_STATUS_CACHE_MS) {
    return providerStatusCache.connected;
  }

  const connected = await Promise.race([
    testConnection().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROVIDER_STATUS_TIMEOUT_MS)),
  ]);
  markProviderStatus(connected);
  return connected;
}
