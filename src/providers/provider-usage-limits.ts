/**
 * provider-usage-limits.ts
 *
 * Surfaces per-provider usage/limit information for the providers a user has
 * actually configured. Two complementary sources are merged:
 *
 *   1. "live"     — the provider's own usage/rate-limit endpoint, queried with
 *                   the OAuth/subscription token already stored in the vault.
 *                   Available for Anthropic (setup-token), OpenAI ChatGPT/Codex
 *                   (OAuth) and xAI Grok. Yields real subscription windows
 *                   (e.g. 5-hour / weekly / monthly utilisation + reset times).
 *   2. "internal" — Prometheus' own token accounting from model-usage.jsonl,
 *                   aggregated per provider. Used for API-key-only providers
 *                   (OpenAI key, Gemini, Perplexity, …) and as a complement to
 *                   live data. An optional user-set monthly token budget turns
 *                   this into a gauge as well.
 *
 * Live fetches are cached for 2 minutes to avoid hammering provider endpoints.
 */

import { getConfig } from '../config/config';
import { readModelUsageEvents } from './model-usage';

export interface UsageWindow {
  /** Human label e.g. "5-hour", "Weekly", "Monthly credits". */
  label: string;
  /** Utilisation 0–100. */
  used_percent: number;
  /** ISO timestamp the window resets, when known. */
  reset_at: string | null;
}

export interface ProviderBudget {
  limit_tokens: number;
  used_tokens: number;
  used_percent: number;
}

export interface ProviderTokenTotals {
  total: number;
  input: number;
  output: number;
  calls: number;
  /** Tokens used since the start of the current calendar month. */
  monthTotal: number;
}

export interface ProviderUsage {
  provider: string;
  label: string;
  configured: boolean;
  /** 'live' = provider usage endpoint; 'internal' = local token accounting only. */
  source: 'live' | 'internal';
  plan_label: string | null;
  windows: UsageWindow[];
  budget: ProviderBudget | null;
  tokens: ProviderTokenTotals;
  error: string | null;
}

export interface UsageLimitsResult {
  fetched_at: string;
  providers: ProviderUsage[];
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic · Claude',
  openai_codex: 'OpenAI · ChatGPT / Codex',
  openai: 'OpenAI',
  xai: 'xAI · Grok',
  gemini: 'Google · Gemini',
  perplexity: 'Perplexity',
  ollama: 'Ollama (local)',
  llama_cpp: 'llama.cpp (local)',
  lm_studio: 'LM Studio (local)',
};

/** Local providers have no account-level usage/limit concept. */
const LOCAL_PROVIDERS = new Set(['ollama', 'llama_cpp', 'lm_studio']);

function labelFor(id: string): string {
  return PROVIDER_LABELS[id] || id;
}

// ─── Normalisation helpers ───────────────────────────────────────────────────

function clampPct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Read a utilisation percentage from a provider window object of varying shape. */
function pctFrom(win: any): number {
  if (!win || typeof win !== 'object') return 0;
  if (win.used_percent != null) return clampPct(win.used_percent);
  if (win.utilization != null) return clampPct(win.utilization);
  if (win.percent != null) return clampPct(win.percent);
  const used = Number(win.used);
  const limit = Number(win.limit ?? win.total);
  if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
    return clampPct((used / limit) * 100);
  }
  return 0;
}

/** Read a reset timestamp (ISO) from a provider window object of varying shape. */
function resetIsoFrom(win: any): string | null {
  if (!win || typeof win !== 'object') return null;
  if (typeof win.resets_at === 'string') return win.resets_at;
  if (typeof win.reset_at === 'string') return win.reset_at;
  if (typeof win.resetsAt === 'string') return win.resetsAt;
  const secs = Number(win.resets_in_seconds ?? win.reset_in_seconds ?? win.resets_in);
  if (Number.isFinite(secs) && secs > 0) {
    return new Date(Date.now() + secs * 1000).toISOString();
  }
  return null;
}

function win(label: string, raw: any): UsageWindow {
  return { label, used_percent: pctFrom(raw), reset_at: resetIsoFrom(raw) };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Live fetchers ───────────────────────────────────────────────────────────
// Each returns `null` when the provider cannot do a live fetch (no OAuth token),
// or `{ windows, plan_label, error }` when a fetch was attempted.

type LiveResult = { windows: UsageWindow[]; plan_label: string | null; error: string | null };

async function fetchAnthropicLive(configDir: string): Promise<LiveResult | null> {
  const mod = require('../auth/anthropic-oauth');
  const tokens = mod.loadTokens(configDir);
  // Only the subscription setup-token (sk-ant-oat-*) authenticates the usage API.
  if (!tokens || tokens.auth_type !== 'setup_token' || !tokens.access_token) return null;

  // Reuse the proven Claude Code header shape (full beta set + claude-cli UA +
  // x-app) — the usage endpoint rejects a bare Bearer + single beta with 401.
  const headers: Record<string, string> = { ...mod.buildAuthHeaders(configDir), Accept: 'application/json' };
  const res = await withTimeout(fetch('https://api.anthropic.com/api/oauth/usage', { headers }), 15000);
  if (!res.ok) return { windows: [], plan_label: null, error: `Anthropic usage ${res.status}` };

  const body: any = await res.json().catch(() => ({}));
  const windows: UsageWindow[] = [];
  if (body.five_hour) windows.push(win('5-hour', body.five_hour));
  if (body.seven_day) windows.push(win('Weekly', body.seven_day));
  if (body.seven_day_opus) windows.push(win('Weekly · Opus', body.seven_day_opus));
  return { windows, plan_label: null, error: null };
}

async function fetchCodexLive(configDir: string): Promise<LiveResult | null> {
  const oauth = require('../auth/openai-oauth');
  const tokens = oauth.loadTokens(configDir);
  if (!tokens || !tokens.access_token) return null;

  let accessToken: string = tokens.access_token;
  try { accessToken = await oauth.getValidToken(configDir); } catch { /* fall back to stored token */ }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...oauth.buildCodexCloudflareHeaders(accessToken, tokens.account_id),
  };

  const res = await withTimeout(fetch('https://chatgpt.com/backend-api/wham/usage', { headers }), 15000);
  if (!res.ok) return { windows: [], plan_label: null, error: `ChatGPT usage ${res.status}` };

  const body: any = await res.json().catch(() => ({}));
  const rl = body.rate_limit || {};
  const windows: UsageWindow[] = [];
  const primary = rl.primary_window || rl.primary;
  const secondary = rl.secondary_window || rl.secondary;
  if (primary) windows.push(win('5-hour', primary));
  if (secondary) windows.push(win('Weekly', secondary));
  return { windows, plan_label: null, error: null };
}

// Note on xAI/Grok: Prometheus authenticates xAI via x.ai OAuth (for api.x.ai),
// which is a different credential surface than the consumer Grok CLI billing
// endpoint (cli-chat-proxy.grok.com). There is no usage/limit endpoint that
// accepts the x.ai OAuth token, so xAI falls back to internal token tracking +
// an optional manual budget rather than a live gauge.

// ─── Live cache ──────────────────────────────────────────────────────────────

const LIVE_TTL_MS = 2 * 60 * 1000;
const liveCache = new Map<string, { ts: number; value: LiveResult }>();

async function getLive(providerId: string, configDir: string): Promise<LiveResult | null> {
  const cached = liveCache.get(providerId);
  if (cached && Date.now() - cached.ts < LIVE_TTL_MS) return cached.value;

  let result: LiveResult | null = null;
  try {
    if (providerId === 'anthropic') result = await fetchAnthropicLive(configDir);
    else if (providerId === 'openai_codex') result = await fetchCodexLive(configDir);
  } catch (err: any) {
    result = { windows: [], plan_label: null, error: err?.message || String(err) };
  }

  if (result) liveCache.set(providerId, { ts: Date.now(), value: result });
  return result;
}

// ─── Internal token accounting ───────────────────────────────────────────────

function internalTokens(providerId: string, events: ReturnType<typeof readModelUsageEvents>): ProviderTokenTotals {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthMs = monthStart.getTime();

  let total = 0, input = 0, output = 0, calls = 0, monthTotal = 0;
  for (const e of events) {
    if (String(e.provider) !== providerId) continue;
    const tt = Number(e.totalTokens || 0);
    total += tt;
    input += Number(e.inputTokens || 0);
    output += Number(e.outputTokens || 0);
    calls += 1;
    const t = Date.parse(e.timestamp || '');
    if (Number.isFinite(t) && t >= monthMs) monthTotal += tt;
  }
  return { total, input, output, calls, monthTotal };
}

function getBudgets(): Record<string, { monthly_token_limit?: number }> {
  try {
    const cfg = getConfig().getConfig() as any;
    const b = cfg?.usage_budgets;
    return (b && typeof b === 'object') ? b : {};
  } catch {
    return {};
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Build usage/limit data for the given credentialed provider ids.
 * Local providers are filtered out. Live fetches run in parallel.
 */
export async function getProviderUsageLimits(credentialedIds: string[]): Promise<UsageLimitsResult> {
  let configDir = '';
  try { configDir = getConfig().getConfigDir(); } catch { /* configDir stays '' */ }

  const budgets = getBudgets();
  const events = readModelUsageEvents();
  const ids = (Array.isArray(credentialedIds) ? credentialedIds : [])
    .filter((id) => id && !LOCAL_PROVIDERS.has(id));

  const providers = await Promise.all(ids.map(async (id): Promise<ProviderUsage> => {
    const live = await getLive(id, configDir);
    const tokens = internalTokens(id, events);

    const limitTokens = Number(budgets[id]?.monthly_token_limit || 0);
    const budget: ProviderBudget | null = limitTokens > 0
      ? {
          limit_tokens: limitTokens,
          used_tokens: tokens.monthTotal,
          used_percent: clampPct((tokens.monthTotal / limitTokens) * 100),
        }
      : null;

    return {
      provider: id,
      label: labelFor(id),
      configured: true,
      source: live ? 'live' : 'internal',
      plan_label: live?.plan_label ?? null,
      windows: live?.windows || [],
      budget,
      tokens,
      error: live?.error ?? null,
    };
  }));

  return { fetched_at: new Date().toISOString(), providers };
}
