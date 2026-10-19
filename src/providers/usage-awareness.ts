// Multi-provider usage belongs only in the volatile per-turn prompt tail.
import { getConfig } from '../config/config';
import { getVault } from '../security/vault';
import { listProviderDescriptors, listProviderSecretFieldPaths } from './provider-registry.js';
import type { UsageLimitsResult } from './provider-usage-limits';

export const PROVIDER_OAUTH_VAULT_KEYS: Record<string, string[]> = {
  openai_codex: ['openai.oauth_tokens'], anthropic: ['anthropic.oauth_tokens'], xai: ['xai.oauth_tokens'],
};
export function providerAccountVaultKey(providerId: string, accountId: string, field = 'api_key'): string {
  return `llm.${providerId}.accounts.${accountId}.${field}`;
}
export function providerOAuthVaultKey(providerId: string, accountId?: string): string {
  const key = PROVIDER_OAUTH_VAULT_KEYS[providerId]?.[0];
  return key ? `${key}${accountId?.trim() ? `.${accountId.trim()}` : ''}` : '';
}
/** Same current-user config/vault discovery used by Settings and chat. */
export function listCredentialedModelProviderIds(): string[] {
  const providers = (getConfig().getConfig() as any)?.llm?.providers || {};
  const keys = new Set(getVault().keys());
  const ids = new Set<string>();
  const saved = (cfg: any, field: string) => typeof cfg?.[field] === 'string' && !!cfg[field].trim();
  for (const [id, field] of listProviderSecretFieldPaths()) {
    if (keys.has(`llm.${id}.${field}`) || saved(providers[id], field)) ids.add(id);
  }
  for (const [id, cfg] of Object.entries(providers)) {
    const accounts = (cfg as any)?.accounts;
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) continue;
    for (const [accountId, account] of Object.entries(accounts)) {
      if (saved(account, 'api_key') || keys.has(providerAccountVaultKey(id, accountId))
        || keys.has(providerOAuthVaultKey(id, accountId))) ids.add(id);
    }
  }
  for (const [id, names] of Object.entries(PROVIDER_OAUTH_VAULT_KEYS)) {
    if (names.some(key => keys.has(key))) ids.add(id);
  }
  const order = new Map<string, number>();
  listProviderDescriptors().forEach((descriptor, index) => {
    order.set(descriptor.id, index);
    for (const id of descriptor.ownership?.providerIds || []) if (!order.has(id)) order.set(id, index);
  });
  return [...ids].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
}

export interface UsageAwarenessWindow {
  label: string;
  usedPercent: number;
  resetAt: string | null;
}

export interface UsageAwarenessSnapshot {
  provider: string;
  windows: UsageAwarenessWindow[];
  source: 'response_headers' | 'usage_api';
  at: number;
  budget?: { usedPercent: number; resetAt: string };
}

const snapshots = new Map<string, UsageAwarenessSnapshot>();
const refreshInFlight = new Set<string>();
// Background refresh reads live provider credentials (and a failed OAuth
// refresh can clear them). Tests must never trigger it.
let refreshEnabled = !process.env.PROMETHEUS_DISABLE_USAGE_AWARENESS_REFRESH;
const API_SNAPSHOT_TTL_MS = 5 * 60_000;
const HEADER_SNAPSHOT_TTL_MS = 30 * 60_000;

export const USAGE_AWARENESS_NOTICE_PERCENT_LEFT = 30;
export const USAGE_AWARENESS_CAUTION_PERCENT_LEFT = 15;
export const USAGE_AWARENESS_CRITICAL_PERCENT_LEFT = 5;

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function epochSecondsToIso(raw: string | undefined): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Feed from the Anthropic adapter on every successful subscription response. */
export function recordAnthropicRateLimitHeaders(headers: Record<string, string>): void {
  if (!headers || typeof headers !== 'object') return;
  const windows: UsageAwarenessWindow[] = [];
  const add = (label: string, key: string) => {
    const util = Number(headers[`anthropic-ratelimit-unified-${key}-utilization`]);
    if (!Number.isFinite(util)) return;
    windows.push({
      label,
      usedPercent: clampPct(util <= 1 ? util * 100 : util),
      resetAt: epochSecondsToIso(headers[`anthropic-ratelimit-unified-${key}-reset`]),
    });
  };
  add('5-hour', '5h');
  add('Weekly', '7d');
  if (!windows.length) return;
  snapshots.set('anthropic', { provider: 'anthropic', windows, source: 'response_headers', at: Date.now() });
}

/** Store a snapshot from the usage API (Settings data). Exported for tests. */
export function recordUsageApiSnapshot(provider: string, windows: Array<{ label: string; used_percent: number; reset_at: string | null }>): void {
  const id = String(provider || '').trim();
  if (!id) return;
  const mapped = (Array.isArray(windows) ? windows : [])
    .filter((w) => w && Number.isFinite(Number(w.used_percent)))
    .map((w) => ({ label: String(w.label || 'window'), usedPercent: clampPct(Number(w.used_percent)), resetAt: w.reset_at || null }));
  if (!mapped.length) return;
  const existing = snapshots.get(id);
  // Response headers are fresher and exact; do not overwrite them with an
  // older API read.
  if (existing?.source === 'response_headers' && Date.now() - existing.at < HEADER_SNAPSHOT_TTL_MS) return;
  snapshots.set(id, { provider: id, windows: mapped, source: 'usage_api', at: Date.now() });
}

type UsageReader = (ids: string[]) => Promise<UsageLimitsResult>;
const defaultReader: UsageReader = async ids => (await import('./provider-usage-limits')).getProviderUsageLimits(ids);
let usageReader = defaultReader;
const pendingRefresh = new Set<string>();
let refreshScheduled = false;

function fresh(snap: UsageAwarenessSnapshot | undefined, now: number): boolean {
  return !!snap && now - snap.at < (snap.source === 'response_headers' ? HEADER_SNAPSHOT_TTL_MS : API_SNAPSHOT_TTL_MS)
    && snap.windows.every(w => !w.resetAt || Date.parse(w.resetAt) > now)
    && (!snap.budget || Date.parse(snap.budget.resetAt) > now);
}
function refreshFromUsageApi(ids: string[]): void {
  if (!refreshEnabled) return;
  for (const id of ids) if (!refreshInFlight.has(id)) pendingRefresh.add(id);
  if (refreshScheduled || !pendingRefresh.size) return;
  refreshScheduled = true;
  // Queue the entire batch after synchronous prompt preparation, never await it.
  void Promise.resolve().then(async () => {
    refreshScheduled = false;
    const batch = [...pendingRefresh];
    pendingRefresh.clear();
    batch.forEach(id => refreshInFlight.add(id));
    try {
      const result = await usageReader(batch);
      for (const id of batch) {
        const entries = result.providers.filter(p => p.provider === id);
        // Collapse accounts conservatively; do not leak account names or errors.
        const windows = entries.some(p => p.error) ? [] : entries.flatMap(p => p.windows);
        const existing = snapshots.get(id);
        if (windows.length && existing?.source === 'response_headers' && fresh(existing, Date.now())) continue;
        const budgets = entries.flatMap(p => p.budget ? [p.budget.used_percent] : []);
        const now = new Date();
        snapshots.set(id, { provider: id, source: 'usage_api', at: now.getTime(),
          windows: windows.filter(w => Number.isFinite(w.used_percent)).map(w => ({ label: w.label, usedPercent: clampPct(w.used_percent), resetAt: w.reset_at })),
          ...(budgets.length ? { budget: { usedPercent: Math.max(...budgets), resetAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() } } : {}),
        });
      }
    } catch {
      for (const id of batch) snapshots.set(id, { provider: id, source: 'usage_api', at: Date.now(), windows: [] });
    } finally { batch.forEach(id => refreshInFlight.delete(id)); }
  });
}
export function getUsageAwarenessSnapshot(provider: string): UsageAwarenessSnapshot | null {
  const snap = snapshots.get(provider);
  if (!fresh(snap, Date.now())) { refreshFromUsageApi([provider]); return null; }
  return snap || null;
}
function formatReset(resetAt: string | null, now: number): string {
  if (!resetAt || !Number.isFinite(Date.parse(resetAt))) return 'reset unknown';
  const mins = Math.max(0, Math.round((Date.parse(resetAt) - now) / 60_000));
  return `resets in ${mins < 60 ? `${mins}m` : mins < 2880 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)}d`}`;
}
const safeLabel = (text: string) => /^[a-zA-Z0-9 _().-]{1,32}$/.test(text) ? text : 'window';
/** Synchronous cache-only formatter. Old string caller shape remains supported. */
export function formatUsageAwarenessForPrompt(providers: string | string[], now = Date.now(), currentProvider = typeof providers === 'string' ? providers : ''): string {
  const ids = [...new Set((Array.isArray(providers) ? providers : [providers]).filter(id => /^[a-z0-9_-]{1,64}$/.test(id)))];
  const stale: string[] = [];
  const lines = ids.map(id => {
    const snap = snapshots.get(id);
    if (!fresh(snap, now)) { stale.push(id); return `${id}: unknown`; }
    const windows = (snap!.windows).filter(w => Number.isFinite(w.usedPercent));
    const parts = windows.slice(0, 3).map(w => `${safeLabel(w.label)} ${Math.round(100 - w.usedPercent)}% left (${formatReset(w.resetAt, now)})`);
    if (snap!.budget) parts.push(`internal budget ${Math.round(100 - snap!.budget.usedPercent)}% left (${formatReset(snap!.budget.resetAt, now)})`);
    const left = Math.min(...windows.map(w => 100 - w.usedPercent), ...(snap!.budget ? [100 - snap!.budget.usedPercent] : []));
    let guidance = '';
    if (id === currentProvider && left <= USAGE_AWARENESS_NOTICE_PERCENT_LEFT) {
      guidance = left <= USAGE_AWARENESS_CRITICAL_PERCENT_LEFT
        ? ' CRITICAL: save state now (commit/push or write a note) and tell the user before starting anything long. Keep this turn minimal.'
        : left <= USAGE_AWARENESS_CAUTION_PERCENT_LEFT
          ? ' Low: keep turns tight, batch tool calls, save work before long jobs, and do not spawn background agents on this same provider.'
          : ' Be economical: prefer fewer, batched tool calls and avoid unnecessary re-reads.';
    }
    return `${id}: ${parts.join('; ') || 'unknown'}${guidance}`;
  });
  refreshFromUsageApi(stale);
  return lines.length ? `[USAGE_AWARENESS]\n${lines.join('\n')}\nPrefer a provider with more headroom for spawned workers.\n[/USAGE_AWARENESS]` : '';
}
export function resetUsageAwarenessForTests(reader?: UsageReader): void {
  snapshots.clear(); refreshInFlight.clear(); pendingRefresh.clear(); refreshScheduled = false;
  usageReader = reader || defaultReader;
  refreshEnabled = !!reader;
}

// ── Exhaustion tracking (for routing, e.g. switch_model) ────────────────────
// A provider that just answered "usage limit reached" should not be picked as
// a helper tier until its window resets. Recorded from provider errors; the
// usage snapshot is a second source (any window at >= 100% used).
const exhaustedUntil = new Map<string, number>();
const DEFAULT_EXHAUSTED_BACKOFF_MS = 30 * 60_000;

export function isUsageLimitError(err: unknown): boolean {
  const text = String((err as any)?.message || err || '');
  return /\b429\b/.test(text) && /usage limit|rate limit|quota|limit has been reached|exceed your account/i.test(text);
}

export function recordProviderUsageExhausted(provider: string, resetAt?: string | number | null): void {
  const key = String(provider || '').trim();
  if (!key) return;
  const resetMs = typeof resetAt === 'number' ? resetAt : resetAt ? Date.parse(String(resetAt)) : NaN;
  const until = Number.isFinite(resetMs) && resetMs > Date.now() ? resetMs : Date.now() + DEFAULT_EXHAUSTED_BACKOFF_MS;
  exhaustedUntil.set(key, until);
}

/** Returns a human reason when the provider is known to be out of usage, else null. */
export function providerUsageExhaustedReason(provider: string, now = Date.now()): string | null {
  const key = String(provider || '').trim();
  if (!key) return null;
  const until = exhaustedUntil.get(key);
  if (until && until > now) return `hit its usage limit recently (retry after ${new Date(until).toLocaleTimeString()})`;
  if (until) exhaustedUntil.delete(key);
  const snap = snapshots.get(key);
  if (snap) {
    const full = snap.windows.find((w) => clampPct(w.usedPercent) >= 100 && (!w.resetAt || Date.parse(w.resetAt) > now));
    if (full) return `${full.label} usage is at 100%${full.resetAt ? ` until ${new Date(full.resetAt).toLocaleString()}` : ''}`;
  }
  return null;
}

export function clearProviderUsageExhausted(provider: string): void {
  exhaustedUntil.delete(String(provider || '').trim());
}
