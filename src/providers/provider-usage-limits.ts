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
  /** Optional provider-native used amount for credit/cost pools. */
  used?: number | null;
  /** Optional provider-native limit amount for credit/cost pools. */
  limit?: number | null;
  /** Optional provider-native remaining amount for credit/cost pools. */
  remaining?: number | null;
  /** Optional provider-native unit, e.g. "credits" or "USD". */
  unit?: string | null;
  /** Optional compact human detail shown under gauges. */
  detail?: string | null;
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

/**
 * Read a reset timestamp (ISO) from a provider window object of varying shape.
 * Handles three families seen across providers:
 *   - ISO strings:        resets_at / reset_at / resetsAt / reset_time
 *   - relative seconds:    resets_in_seconds / reset_after_seconds / seconds_until_reset …
 *     (ChatGPT/Codex's wham/usage uses `reset_after_seconds`, mirroring the
 *      `x-codex-…-reset-after-seconds` response headers)
 *   - absolute unix epoch: a numeric reset field in seconds OR milliseconds
 */
function resetIsoFrom(win: any): string | null {
  if (!win || typeof win !== 'object') return null;

  // 1. Explicit ISO string fields.
  for (const key of ['resets_at', 'reset_at', 'resetsAt', 'reset_time', 'resetTime']) {
    if (typeof win[key] === 'string' && win[key].trim()) return win[key];
  }

  // 2. Relative "seconds until reset" fields.
  const secs = Number(
    win.resets_in_seconds ?? win.reset_in_seconds ?? win.resets_in ?? win.resets_in_secs ??
    win.reset_after_seconds ?? win.reset_after ?? win.resets_after_seconds ?? win.resets_after ??
    win.seconds_until_reset ?? win.seconds_to_reset,
  );
  if (Number.isFinite(secs) && secs > 0) {
    return new Date(Date.now() + secs * 1000).toISOString();
  }

  // 3. Absolute numeric epoch (seconds or milliseconds) under a reset-ish key.
  const epoch = Number(
    win.resets_at ?? win.reset_at ?? win.reset ?? win.reset_timestamp ??
    win.reset_time ?? win.next_reset ?? win.next_reset_at,
  );
  if (Number.isFinite(epoch) && epoch > 0) {
    // < 1e12 → seconds; otherwise already milliseconds.
    const ms = epoch < 1e12 ? epoch * 1000 : epoch;
    return new Date(ms).toISOString();
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

type GrokAuth = {
  source: 'prometheus_oauth' | 'grok_cli_auth';
  access_token: string;
  refresh_token?: string;
  token_endpoint?: string;
  auth_path?: string;
  raw?: any;
};

async function fetchAnthropicLive(configDir: string): Promise<LiveResult | null> {
  // The usage endpoint requires the `user:profile` scope, which the main
  // setup-token (inference-only) does NOT carry. We use a separate, opt-in
  // browser-OAuth "usage tracking" token instead (see anthropic-usage-oauth.ts).
  const usageOAuth = require('../auth/anthropic-usage-oauth');
  const accessToken: string | null = await usageOAuth.getValidUsageToken(configDir);
  // Not connected → no error, just fall back to internal tracking silently.
  if (!accessToken) return null;

  // The usage endpoint requires Claude Code's User-Agent or it returns 429.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'anthropic-version': '2023-06-01',
    'User-Agent': 'claude-code/2.1.75',
    Accept: 'application/json',
  };
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

  // Diagnostic: if a window came back with no recognised reset field, log its
  // keys once so the field name can be added to resetIsoFrom. Opt-in via env to
  // avoid noise. (Set PROM_DEBUG_USAGE=1.)
  if (process.env.PROM_DEBUG_USAGE && windows.some((w) => !w.reset_at)) {
    try {
      console.error('[usage] Codex window had no reset_at. primary keys=',
        primary && Object.keys(primary), 'secondary keys=', secondary && Object.keys(secondary),
        'sample=', JSON.stringify(primary));
    } catch { /* ignore */ }
  }
  return { windows, plan_label: null, error: null };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const raw = value && typeof value === 'object' && 'val' in (value as any) ? (value as any).val : value;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object') ? acc[part] : undefined, obj);
}

function firstPathNumber(obj: any, paths: string[]): number | null {
  return firstNumber(...paths.map((p) => getPath(obj, p)));
}

function firstPathString(obj: any, paths: string[]): string | null {
  return firstString(...paths.map((p) => getPath(obj, p)));
}

function money(value: number | null, unit: string | null): string {
  if (value == null || !Number.isFinite(value)) return '';
  const isMoney = !unit || /usd|\$|credit/i.test(unit);
  return isMoney
    ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}

function normaliseGrokBillingWindow(body: any): UsageWindow | null {
  const root = body?.config && typeof body.config === 'object' ? body.config : body;
  const pool = body?.weeklyPool || body?.sharedPool || body?.usagePool || body?.credits || root;
  const used = firstPathNumber(pool, [
    'used.val', 'used.value', 'usedCredits.val', 'usedCredits', 'usage.used.val', 'usage.used',
    'totalUsed.val', 'totalUsed', 'amountUsed.val', 'amountUsed',
  ]);
  const limit = firstPathNumber(pool, [
    'weeklyLimit.val', 'weeklyLimit', 'monthlyLimit.val', 'monthlyLimit', 'limit.val', 'limit',
    'total.val', 'total', 'pool.val', 'pool', 'creditLimit.val', 'creditLimit',
  ]);
  const explicitRemaining = firstPathNumber(pool, [
    'remaining.val', 'remaining', 'remainingCredits.val', 'remainingCredits', 'available.val', 'available',
    'balance.val', 'balance',
  ]);
  const remaining = explicitRemaining != null ? explicitRemaining
    : (used != null && limit != null ? Math.max(0, limit - used) : null);
  const usedPercent = firstPathNumber(pool, ['used_percent', 'usedPercent', 'percentUsed', 'utilization', 'percentage'])
    ?? (used != null && limit != null && limit > 0 ? (used / limit) * 100 : null);
  const resetAt = resetIsoFrom({
    reset_at: firstPathString(pool, [
      'reset_at', 'resetAt', 'resets_at', 'resetsAt', 'billingPeriodEnd', 'billing_period_end',
      'periodEnd', 'period_end', 'nextResetAt', 'next_reset_at',
    ]),
    reset_after_seconds: firstPathNumber(pool, [
      'reset_after_seconds', 'resetAfterSeconds', 'resets_in_seconds', 'secondsUntilReset',
      'seconds_until_reset', 'resetCountdownSeconds',
    ]),
  });
  const period = firstPathString(pool, ['period', 'window', 'cadence', 'limitType'])
    || (firstPathString(pool, ['billingPeriodStart', 'billing_period_start']) ? 'Monthly' : 'Weekly');
  const unit = firstPathString(pool, ['unit', 'currency']) || 'credits';
  const parts = [
    remaining != null && limit != null ? `Remaining ${money(remaining, unit)} / ${money(limit, unit)}` : '',
    used != null ? `Used ${money(used, unit)}` : '',
  ].filter(Boolean);
  return {
    label: /month/i.test(period) ? 'Monthly pool' : /day/i.test(period) ? `${period} pool` : 'Weekly pool',
    used_percent: clampPct(usedPercent ?? 0),
    reset_at: resetAt,
    used,
    limit,
    remaining,
    unit,
    detail: parts.join(' · ') || null,
  };
}

function localGrokAuthPath(): string {
  const os = require('os');
  const path = require('path');
  return path.join(os.homedir(), '.grok', 'auth.json');
}

function extractGrokAuth(raw: any, authPath: string): GrokAuth | null {
  const access = firstPathString(raw, [
    'access_token', 'accessToken', 'tokens.access_token', 'tokens.accessToken',
    'oauth.access_token', 'oauth.accessToken',
  ]);
  if (!access) return null;
  const refresh = firstPathString(raw, [
    'refresh_token', 'refreshToken', 'tokens.refresh_token', 'tokens.refreshToken',
    'oauth.refresh_token', 'oauth.refreshToken',
  ]) || undefined;
  const tokenEndpoint = firstPathString(raw, [
    'token_endpoint', 'tokenEndpoint', 'tokens.token_endpoint', 'oauth.token_endpoint',
  ]) || undefined;
  return { source: 'grok_cli_auth', access_token: access, refresh_token: refresh, token_endpoint: tokenEndpoint, auth_path: authPath, raw };
}

function loadLocalGrokAuth(): GrokAuth | null {
  try {
    const fs = require('fs');
    const authPath = localGrokAuthPath();
    if (!fs.existsSync(authPath)) return null;
    return extractGrokAuth(JSON.parse(String(fs.readFileSync(authPath, 'utf8'))), authPath);
  } catch {
    return null;
  }
}

function saveLocalGrokAuth(auth: GrokAuth, update: any): void {
  if (!auth.auth_path || !auth.raw || !update?.access_token) return;
  const fs = require('fs');
  const raw = { ...auth.raw };
  const setKnown = (snake: string, camel: string, value: unknown) => {
    if (raw[snake] != null) raw[snake] = value;
    else if (raw[camel] != null) raw[camel] = value;
  };
  setKnown('access_token', 'accessToken', String(update.access_token));
  if (update.refresh_token) setKnown('refresh_token', 'refreshToken', String(update.refresh_token));
  if (raw.tokens && typeof raw.tokens === 'object') {
    raw.tokens.access_token = String(update.access_token);
    if (update.refresh_token) raw.tokens.refresh_token = String(update.refresh_token);
  }
  if (raw.oauth && typeof raw.oauth === 'object') {
    raw.oauth.access_token = String(update.access_token);
    if (update.refresh_token) raw.oauth.refresh_token = String(update.refresh_token);
  }
  fs.writeFileSync(auth.auth_path, JSON.stringify(raw, null, 2));
}

async function refreshLocalGrokAuth(auth: GrokAuth): Promise<GrokAuth | null> {
  if (!auth.refresh_token) return null;
  const endpoint = auth.token_endpoint || 'https://auth.x.ai/oauth/token';
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || (url.hostname !== 'auth.x.ai' && !url.hostname.endsWith('.x.ai'))) {
    throw new Error('Grok auth refresh endpoint is not an x.ai HTTPS endpoint');
  }
  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
      refresh_token: auth.refresh_token,
    }).toString(),
  }), 15000);
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => ({}));
  if (!data?.access_token) return null;
  try { saveLocalGrokAuth(auth, data); } catch { /* best-effort local CLI cache update */ }
  return { ...auth, access_token: String(data.access_token), refresh_token: String(data.refresh_token || auth.refresh_token) };
}

async function loadGrokBillingAuth(configDir: string): Promise<GrokAuth | null> {
  try {
    const oauth = require('../auth/xai-oauth');
    const tokens = oauth.loadXAITokens(configDir);
    if (tokens?.access_token) {
      let accessToken = String(tokens.access_token);
      try { accessToken = await oauth.getValidXAIToken(configDir); } catch { /* use stored token */ }
      return {
        source: 'prometheus_oauth',
        access_token: accessToken,
        refresh_token: tokens.refresh_token,
        token_endpoint: tokens.token_endpoint,
      };
    }
  } catch { /* fall back to Grok CLI auth */ }
  return loadLocalGrokAuth();
}

async function grokProxyGet(pathname: string, auth: GrokAuth): Promise<Response> {
  return withTimeout(fetch(`https://cli-chat-proxy.grok.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'Prometheus/grok-usage',
    },
  }), 15000);
}

async function fetchGrokLive(configDir: string): Promise<LiveResult | null> {
  let auth = await loadGrokBillingAuth(configDir);
  if (!auth?.access_token) return null;

  let res = await grokProxyGet('/v1/billing?format=credits', auth);
  if ((res.status === 401 || res.status === 403) && auth.source === 'prometheus_oauth') {
    try {
      const oauth = require('../auth/xai-oauth');
      const refreshed = await oauth.refreshXAITokens(configDir);
      auth = { ...auth, access_token: String(refreshed.access_token || auth.access_token), refresh_token: refreshed.refresh_token || auth.refresh_token };
      res = await grokProxyGet('/v1/billing?format=credits', auth);
    } catch { /* keep original response */ }
  } else if ((res.status === 401 || res.status === 403) && auth.source === 'grok_cli_auth') {
    const refreshed = await refreshLocalGrokAuth(auth).catch(() => null);
    if (refreshed) {
      auth = refreshed;
      res = await grokProxyGet('/v1/billing?format=credits', auth);
    }
  }
  if (!res.ok) return { windows: [], plan_label: null, error: `Grok billing ${res.status}` };

  const billing: any = await res.json().catch(() => ({}));
  const windows = [normaliseGrokBillingWindow(billing)].filter(Boolean) as UsageWindow[];

  let planLabel = firstPathString(billing, [
    'plan.label', 'plan.name', 'subscription.plan', 'subscription.name', 'account.plan', 'planLabel',
  ]);
  try {
    const settings = await grokProxyGet('/v1/settings', auth);
    if (settings.ok) {
      const body: any = await settings.json().catch(() => ({}));
      planLabel = firstPathString(body, [
        'plan.label', 'plan.name', 'subscription.plan', 'subscription.name', 'account.plan',
        'user.plan', 'organization.plan', 'tier', 'planLabel',
      ]) || planLabel;
    }
  } catch { /* billing is enough */ }

  return { windows, plan_label: planLabel, error: windows.length ? null : 'Grok billing response had no recognised credit pool' };
}

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
    else if (providerId === 'xai') result = await fetchGrokLive(configDir);
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

/**
 * Read Grok CLI local session files and unified logs, then sum token usage.
 * Live billing provides the credit pool when available; these local files add
 * Today/Last-month style call/token totals without sending any log contents out.
 */
function readGrokCliTokens(): { total: number; calls: number; monthTotal: number } {
  const out = { total: 0, calls: 0, monthTotal: 0 };
  try {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthMs = monthStart.getTime();

    const addUsage = (obj: any, fallbackCurrentMonth = false) => {
      const input = firstNumber(obj?.inputTokens, obj?.input_tokens, obj?.usage?.inputTokens, obj?.usage?.input_tokens, obj?.tokens?.input);
      const output = firstNumber(obj?.outputTokens, obj?.output_tokens, obj?.usage?.outputTokens, obj?.usage?.output_tokens, obj?.tokens?.output);
      const total = firstNumber(obj?.totalTokens, obj?.total_tokens, obj?.usage?.totalTokens, obj?.usage?.total_tokens, obj?.tokens?.total)
        ?? ((input || output) ? Number(input || 0) + Number(output || 0) : 0);
      if (!total || total <= 0) return;
      out.total += total;
      out.calls += 1;
      const t = Date.parse(obj?.timestamp || obj?.time || obj?.createdAt || obj?.created_at || '');
      if ((Number.isFinite(t) && t >= monthMs) || (!Number.isFinite(t) && fallbackCurrentMonth)) out.monthTotal += total;
    };

    const logsPath = path.join(os.homedir(), '.grok', 'logs', 'unified.jsonl');
    if (fs.existsSync(logsPath)) {
      const lines = String(fs.readFileSync(logsPath, 'utf8')).split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { addUsage(JSON.parse(trimmed)); } catch { /* skip malformed line */ }
      }
    }

    const base = path.join(os.homedir(), '.grok', 'sessions');
    if (!fs.existsSync(base)) return out;

    const sessionDirs = fs.readdirSync(base, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => path.join(base, d.name));

    for (const dir of sessionDirs) {
      // updates.jsonl: one JSON object per line, each may carry totalTokens.
      const updatesPath = path.join(dir, 'updates.jsonl');
      if (fs.existsSync(updatesPath)) {
        const lines = String(fs.readFileSync(updatesPath, 'utf8')).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { addUsage(JSON.parse(trimmed), true); } catch { /* skip malformed line */ }
        }
      }
      // signals.json: snapshot with a contextTokensUsed value (fallback).
      const signalsPath = path.join(dir, 'signals.json');
      if (out.total === 0 && fs.existsSync(signalsPath)) {
        try {
          const sig = JSON.parse(String(fs.readFileSync(signalsPath, 'utf8')));
          const ctx = Number(sig.contextTokensUsed ?? sig.context_tokens_used ?? 0);
          if (ctx > 0) { out.total += ctx; out.monthTotal += ctx; out.calls += 1; }
        } catch { /* skip */ }
      }
    }
  } catch { /* CLI not present or unreadable — return zeros */ }
  return out;
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
  if (!ids.includes('xai') && loadLocalGrokAuth()) ids.push('xai');

  const providers = await Promise.all(ids.map(async (id): Promise<ProviderUsage> => {
    const live = await getLive(id, configDir);
    const tokens = internalTokens(id, events);

    // xAI/Grok has no live usage endpoint here; augment internal accounting with
    // token counts read from local Grok CLI session files, if present.
    if (id === 'xai') {
      const cli = readGrokCliTokens();
      tokens.total += cli.total;
      tokens.calls += cli.calls;
      tokens.monthTotal += cli.monthTotal;
    }

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
