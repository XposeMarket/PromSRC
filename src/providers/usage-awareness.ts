// Per-provider usage awareness for the model itself.
//
// The model is told its remaining plan allowance ONLY for the provider it is
// running on right now, and only when it matters (<= 30% left). Above that the
// block is empty, so nothing volatile enters the prompt and the prompt cache is
// untouched. The line is appended to the volatile tail of the system prompt,
// never the stable prefix.
//
// Sources, cheapest first:
//   - Anthropic: `anthropic-ratelimit-unified-*` headers on every response
//     (recordAnthropicRateLimitHeaders), so there is no extra request.
//   - Everyone else: the same live windows Settings shows
//     (getProviderUsageLimits), cached for a few minutes and refreshed in the
//     background so turn prep never waits on it.

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

function refreshFromUsageApi(provider: string): void {
  if (!refreshEnabled || refreshInFlight.has(provider)) return;
  refreshInFlight.add(provider);
  void (async () => {
    try {
      const mod = await import('./provider-usage-limits');
      const result = await mod.getProviderUsageLimits([provider]);
      const entry = (result?.providers || []).find((p: any) => p?.provider === provider && Array.isArray(p.windows) && p.windows.length);
      if (entry) recordUsageApiSnapshot(provider, entry.windows);
    } catch { /* awareness is best-effort */ } finally {
      refreshInFlight.delete(provider);
    }
  })();
}

export function getUsageAwarenessSnapshot(provider: string): UsageAwarenessSnapshot | null {
  const id = String(provider || '').trim();
  if (!id) return null;
  const snap = snapshots.get(id) || null;
  const ttl = snap?.source === 'response_headers' ? HEADER_SNAPSHOT_TTL_MS : API_SNAPSHOT_TTL_MS;
  if (!snap || Date.now() - snap.at > ttl) {
    // Never block turn prep: kick a background refresh and use what we have.
    if (id !== 'anthropic' || !snap) refreshFromUsageApi(id);
  }
  return snap;
}

function formatReset(resetAt: string | null, now: number): string {
  if (!resetAt) return '';
  const t = Date.parse(resetAt);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((t - now) / 60_000));
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `resets in ${hours}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  return `resets in ${Math.round(hours / 24)}d`;
}

/**
 * The block the model sees. Empty unless the tightest window for the CURRENT
 * provider is at or below 30% left. Only the current provider is ever named.
 */
export function formatUsageAwarenessForPrompt(provider: string, now = Date.now()): string {
  const snap = getUsageAwarenessSnapshot(provider);
  if (!snap || !snap.windows.length) return '';
  const withLeft = snap.windows.map((w) => ({ ...w, left: Math.round(100 - w.usedPercent) }));
  const tightest = withLeft.reduce((a, b) => (b.left < a.left ? b : a));
  if (tightest.left > USAGE_AWARENESS_NOTICE_PERCENT_LEFT) return '';
  const windowsText = withLeft
    .map((w) => `${w.label} ${w.left}% left${formatReset(w.resetAt, now) ? ` (${formatReset(w.resetAt, now)})` : ''}`)
    .join('; ');
  let guidance: string;
  if (tightest.left <= USAGE_AWARENESS_CRITICAL_PERCENT_LEFT) {
    guidance = 'CRITICAL: save state now (commit/push or write a note) and tell the user before starting anything long. Keep this turn minimal.';
  } else if (tightest.left <= USAGE_AWARENESS_CAUTION_PERCENT_LEFT) {
    guidance = 'Low: keep turns tight, batch tool calls, save work before long jobs, and do not spawn background agents on this same provider.';
  } else {
    guidance = 'Be economical: prefer fewer, batched tool calls and avoid unnecessary re-reads.';
  }
  return `[USAGE_AWARENESS provider=${snap.provider}] ${windowsText}. ${guidance} [/USAGE_AWARENESS]`;
}

export function resetUsageAwarenessForTests(): void {
  snapshots.clear();
  refreshInFlight.clear();
  refreshEnabled = false;
}
