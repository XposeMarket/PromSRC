// src/gateway/routes/account.router.ts
// Supabase account auth: login, status, logout, token refresh, subscription check.
// Session is kept in-memory and persisted encrypted in the vault so it survives
// gateway restarts without requiring re-login.

import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../../config/config';
import { getVault } from '../../security/vault';

export const router = Router();

// ─── Supabase config (public anon key — safe to ship in desktop app) ──────────
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://wqfauwscvtnqfeqskvos.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxZmF1d3NjdnRucWZlcXNrdm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MzMyNTMsImV4cCI6MjA4ODQwOTI1M30.0X9VvRjWFlPR9T-xRAm78fEvbDQgjaLeeiM2mIKdBB8';

// ─── Session ──────────────────────────────────────────────────────────────────
interface AuthSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;    // unix seconds
  isAdmin: boolean;
  subscriptionActive: boolean;
  subscriptionCheckedAt?: number;
}

let _session: AuthSession | null = null;
const SUBSCRIPTION_REFRESH_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_VAULT_KEY = 'account.supabase.session';
type SubscriptionRefreshResult = 'active' | 'inactive' | 'unknown';

function getConfigDir(): string {
  return getConfig().getConfigDir();
}

function getSessionVault() {
  return getVault(getConfigDir());
}

function sessionFilePath(): string {
  const dataDir = (getConfig() as any).getDataDir?.() ||
    process.env.PROMETHEUS_DATA_DIR ||
    path.join(process.env.APPDATA || process.env.HOME || '.', 'Prometheus');
  return path.join(dataDir, 'auth-session.json');
}

function decodeJwtClaims(token: string): Record<string, any> | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4 || 4)) % 4);
    const raw = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
}

function deriveAccessTokenExpiry(accessToken: string): number {
  const exp = Number(decodeJwtClaims(accessToken)?.exp);
  if (Number.isFinite(exp) && exp > 0) return Math.floor(exp);
  return Math.floor(Date.now() / 1000) + 3600;
}

function normalizeSession(input: any): AuthSession | null {
  const userId = String(input?.userId || '').trim();
  const email = String(input?.email || '').trim();
  const accessToken = String(input?.accessToken || '').trim();
  if (!userId || !email || !accessToken) return null;
  const expiresAtRaw = Number(input?.expiresAt);
  const subscriptionCheckedAtRaw = Number(input?.subscriptionCheckedAt);
  return {
    userId,
    email,
    accessToken,
    refreshToken: String(input?.refreshToken || ''),
    expiresAt: Number.isFinite(expiresAtRaw) && expiresAtRaw > 0
      ? Math.floor(expiresAtRaw)
      : deriveAccessTokenExpiry(accessToken),
    isAdmin: input?.isAdmin === true,
    subscriptionActive: input?.subscriptionActive === true,
    subscriptionCheckedAt: Number.isFinite(subscriptionCheckedAtRaw)
      ? subscriptionCheckedAtRaw
      : undefined,
  };
}

function migrateLegacySession(): void {
  const legacyPath = sessionFilePath();
  if (!fs.existsSync(legacyPath)) return;
  try {
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const parsed = normalizeSession(JSON.parse(raw));
    if (!parsed) return;
    getSessionVault().set(AUTH_SESSION_VAULT_KEY, JSON.stringify(parsed), 'migration:account_session');
    fs.unlinkSync(legacyPath);
  } catch {}
}

function loadPersistedSession(): void {
  try {
    migrateLegacySession();
    const secret = getSessionVault().get(AUTH_SESSION_VAULT_KEY, 'account:load');
    if (!secret) {
      _session = null;
      return;
    }
    const parsed = normalizeSession(JSON.parse(secret.expose()));
    if (!parsed) {
      getSessionVault().delete(AUTH_SESSION_VAULT_KEY, 'account:invalid');
      _session = null;
      return;
    }
    _session = parsed;
  } catch {
    _session = null;
  }
}

function persistSession(): void {
  try {
    const vault = getSessionVault();
    if (_session) {
      vault.set(AUTH_SESSION_VAULT_KEY, JSON.stringify(_session), 'account:save');
    } else {
      vault.delete(AUTH_SESSION_VAULT_KEY, 'account:clear');
    }
    const legacyPath = sessionFilePath();
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  } catch {}
}

function clearSession(): void {
  _session = null;
  persistSession();
}

// Load on module init (called when gateway starts)
loadPersistedSession();

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function sbFetch(urlPath: string, opts: RequestInit = {}, token?: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}${urlPath}`, { ...opts, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (body as any).error_description || (body as any).error || (body as any).message || 'Supabase error';
    throw new Error(msg);
  }
  return body;
}

async function checkSubscription(userId: string, accessToken: string, isAdmin: boolean, timeoutMs = 10000): Promise<boolean | null> {
  if (isAdmin) return true;
  try {
    const data = await sbFetch(
      `/rest/v1/subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&limit=1`,
      {},
      accessToken,
      timeoutMs,
    );
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}

async function checkIsAdmin(userId: string, accessToken: string): Promise<boolean> {
  try {
    const data = await sbFetch(
      `/rest/v1/profiles?id=eq.${userId}&select=is_admin&limit=1`,
      {},
      accessToken
    );
    return Array.isArray(data) && data.length > 0 && data[0].is_admin === true;
  } catch {
    return false;
  }
}

async function getAuthenticatedUser(accessToken: string): Promise<{ userId: string; email: string }> {
  const data = await sbFetch('/auth/v1/user', {}, accessToken);
  const userId = String(data?.id || '').trim();
  const email = String(data?.email || data?.user_metadata?.email || '').trim();
  if (!userId || !email) {
    throw new Error('Authenticated user record incomplete');
  }
  return { userId, email };
}

function hasAccountAccess(session: AuthSession): boolean {
  return session.isAdmin || session.subscriptionActive;
}

function buildAuthenticatedResponse(session: AuthSession, extras: Record<string, any> = {}) {
  return {
    authenticated: true,
    email: session.email,
    userId: session.userId,
    isAdmin: session.isAdmin,
    subscriptionActive: session.subscriptionActive,
    expiresAt: session.expiresAt,
    ...extras,
  };
}

function buildInactiveSubscriptionResponse(session: AuthSession) {
  return {
    authenticated: false,
    email: session.email,
    userId: session.userId,
    isAdmin: false,
    subscriptionActive: false,
    reason: 'subscription_inactive',
  };
}

function buildRetryableAuthenticatedResponse(
  session: AuthSession,
  reason = 'session_verification_failed',
  extras: Record<string, any> = {},
) {
  return buildAuthenticatedResponse(session, {
    verified: false,
    retryable: true,
    reason,
    ...extras,
  });
}

async function buildVerifiedSession(accessToken: string, refreshToken: string = ''): Promise<AuthSession> {
  const cleanAccessToken = String(accessToken || '').trim();
  if (!cleanAccessToken) {
    throw new Error('Access token is required');
  }
  const cleanRefreshToken = String(refreshToken || '').trim();
  const { userId, email } = await getAuthenticatedUser(cleanAccessToken);
  const isAdmin = await checkIsAdmin(userId, cleanAccessToken);
  const subscriptionActive = Boolean(await checkSubscription(userId, cleanAccessToken, isAdmin, 10000));
  return {
    userId,
    email,
    accessToken: cleanAccessToken,
    refreshToken: cleanRefreshToken,
    expiresAt: deriveAccessTokenExpiry(cleanAccessToken),
    isAdmin,
    subscriptionActive,
    subscriptionCheckedAt: Date.now(),
  };
}

async function refreshAccessToken(refreshToken: string, timeoutMs = 10000): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  try {
    const data = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, undefined, timeoutMs);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    };
  } catch {
    return null;
  }
}

async function refreshVerifiedSession(refreshToken: string): Promise<AuthSession | null> {
  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed) return null;
  try {
    return await buildVerifiedSession(refreshed.accessToken, refreshed.refreshToken);
  } catch {
    return null;
  }
}

async function refreshSubscriptionIfNeeded(force: boolean = false, timeoutMs = 10000): Promise<SubscriptionRefreshResult> {
  if (!_session) return 'inactive';
  if (_session.isAdmin) {
    _session.subscriptionActive = true;
    _session.subscriptionCheckedAt = Date.now();
    persistSession();
    return 'active';
  }

  const lastCheckedAt = Number(_session.subscriptionCheckedAt || 0);
  if (!force && Date.now() - lastCheckedAt < SUBSCRIPTION_REFRESH_TTL_MS) {
    return _session.subscriptionActive ? 'active' : 'inactive';
  }

  const subscriptionActive = await checkSubscription(
    _session.userId,
    _session.accessToken,
    _session.isAdmin,
    timeoutMs,
  );
  if (subscriptionActive === null) return 'unknown';

  _session.subscriptionActive = subscriptionActive;
  _session.subscriptionCheckedAt = Date.now();
  persistSession();
  return subscriptionActive ? 'active' : 'inactive';
}

async function resolveStrictSessionStatus(timeoutMs = 10000): Promise<Record<string, any>> {
  if (!_session) {
    return { authenticated: false, reason: 'not_authenticated' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (_session.expiresAt < now) {
    if (!_session.refreshToken) {
      return buildRetryableAuthenticatedResponse(_session, 'session_refresh_unavailable');
    }

    const refreshed = await refreshVerifiedSession(_session.refreshToken);
    if (!refreshed) {
      return buildRetryableAuthenticatedResponse(_session, 'session_refresh_failed');
    }

    _session = refreshed;
    persistSession();
    if (!hasAccountAccess(_session)) {
      const response = buildInactiveSubscriptionResponse(_session);
      clearSession();
      return response;
    }
  }

  const subscriptionState = await refreshSubscriptionIfNeeded(true, timeoutMs);
  const activeSession = _session;
  if (!activeSession) {
    return { authenticated: false, reason: 'not_authenticated' };
  }

  if (subscriptionState === 'inactive') {
    const response = buildInactiveSubscriptionResponse(activeSession);
    clearSession();
    return response;
  }
  if (subscriptionState === 'unknown') {
    return buildRetryableAuthenticatedResponse(activeSession);
  }

  return buildAuthenticatedResponse(activeSession, { verified: true });
}

function isTruthyQueryValue(value: any): boolean {
  const normalized = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

// ─── Startup refresh ──────────────────────────────────────────────────────────
// Called at gateway start to silently refresh an expired persisted session.
export async function refreshPersistedSession(): Promise<void> {
  if (!_session) return;

  const now = Math.floor(Date.now() / 1000);
  const expiresSoon = _session.expiresAt - now < 300; // refresh if < 5 min remaining

  if (expiresSoon && _session.refreshToken) {
    const refreshed = await refreshVerifiedSession(_session.refreshToken);
    if (refreshed) {
      _session = refreshed;
      persistSession();
      if (!hasAccountAccess(_session)) {
        clearSession();
        return;
      }
    } else {
      // Keep the persisted session on transient refresh failures.
      // The user should only be logged out for a manual logout or a
      // definitive inactive-subscription result.
      return;
    }
  }

  if (_session.expiresAt < now && !_session.refreshToken) {
    return;
  }

  const subscriptionState = await refreshSubscriptionIfNeeded(true);
  if (subscriptionState === 'inactive') clearSession();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/account/config — expose public Supabase config for browser-side auth
// The anon key is a public key (designed to be embedded in client apps).
router.get('/api/account/config', (_req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

// GET /api/account/status — return cached auth state instantly by default.
// Pass ?strict=1 for a boot-time entitlement check that blocks on refresh.
router.get('/api/account/status', async (req, res) => {
  if (isTruthyQueryValue(req.query?.strict)) {
    try {
      return res.json(await resolveStrictSessionStatus());
    } catch {
      if (_session) return res.json(buildRetryableAuthenticatedResponse(_session));
      return res.json({ authenticated: false, reason: 'session_verification_failed', retryable: true });
    }
  }

  if (!_session) {
    return res.json({ authenticated: false });
  }

  const now = Math.floor(Date.now() / 1000);

  // Keep the cached authenticated session even if refresh is unavailable.
  // We only clear it on a manual logout or a definitive inactive-subscription
  // check.
  if (_session.expiresAt < now && !_session.refreshToken) {
    return res.json(buildRetryableAuthenticatedResponse(_session, 'session_refresh_unavailable'));
  }

  // Token expired but refresh token exists — kick off background refresh,
  // return optimistic authenticated state (next request will use fresh token)
  if (_session.expiresAt < now) {
    refreshVerifiedSession(_session.refreshToken).then(refreshed => {
      if (refreshed) {
        _session = refreshed;
        persistSession();
        if (!hasAccountAccess(_session)) {
          clearSession();
        }
      }
    }).catch(() => {});
    return res.json(buildRetryableAuthenticatedResponse(_session, 'session_refresh_pending'));
  } else {
    // Token valid — background-refresh subscription if TTL lapsed
    refreshSubscriptionIfNeeded(false).then((subscriptionState) => {
      if (subscriptionState === 'inactive') clearSession();
    }).catch(() => {});
  }

  res.json(buildAuthenticatedResponse(_session));
});

// POST /api/account/login — accepts browser-acquired Supabase tokens, then
// validates them server-side before persisting an authenticated session.
// Body: { accessToken, refreshToken }
router.post('/api/account/login', async (req, res) => {
  const accessToken = String(req.body?.accessToken || '').trim();
  const refreshToken = String(req.body?.refreshToken || '').trim();

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' });
  }

  try {
    const nextSession = await buildVerifiedSession(accessToken, refreshToken);
    if (!hasAccountAccess(nextSession)) {
      clearSession();
      return res.json(buildInactiveSubscriptionResponse(nextSession));
    }
    _session = nextSession;
    persistSession();
    return res.json(buildAuthenticatedResponse(_session));
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || 'Session validation failed' });
  }
});

// POST /api/account/login/password - authenticate through the gateway.
// This keeps the Electron renderer from surfacing opaque browser/CORS/network
// TypeErrors such as "Failed to fetch" when Supabase cannot be reached directly.
router.post('/api/account/login/password', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim();
  const normalizedPassword = String(password || '');

  if (!normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const auth = await sbFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, password: normalizedPassword }),
    }, undefined, 15000);

    const accessToken = auth?.access_token;
    const refreshToken = auth?.refresh_token || '';

    if (!accessToken) {
      return res.status(401).json({ error: 'Authentication failed - no token returned' });
    }

    const nextSession = await buildVerifiedSession(accessToken, refreshToken);

    if (!hasAccountAccess(nextSession)) {
      clearSession();
      return res.json(buildInactiveSubscriptionResponse(nextSession));
    }

    _session = nextSession;
    persistSession();

    return res.json(buildAuthenticatedResponse(_session));
  } catch (err: any) {
    return res.status(401).json({ error: err?.message || 'Login failed' });
  }
});

// POST /api/account/logout
router.post('/api/account/logout', (_req, res) => {
  clearSession();
  res.json({ success: true });
});

// POST /api/account/refresh — silently refresh token
router.post('/api/account/refresh', async (_req, res) => {
  if (!_session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const refreshed = await refreshVerifiedSession(_session.refreshToken);
  if (!refreshed) {
    return res.status(503).json({ error: 'Session refresh failed', retryable: true });
  }

  _session = refreshed;
  persistSession();
  if (!hasAccountAccess(_session)) {
    clearSession();
    return res.status(401).json({ error: 'No active subscription found' });
  }

  res.json(buildAuthenticatedResponse(_session));
});

// Helper for other routes to check if current session has an active subscription
export function getSessionStatus(): { authenticated: boolean; subscriptionActive: boolean; isAdmin: boolean } {
  if (!_session) return { authenticated: false, subscriptionActive: false, isAdmin: false };
  const expired = _session.expiresAt < Math.floor(Date.now() / 1000);
  if (expired) return { authenticated: false, subscriptionActive: false, isAdmin: false };
  return {
    authenticated: true,
    subscriptionActive: _session.subscriptionActive,
    isAdmin: _session.isAdmin,
  };
}

export function requireAccountAccess(_req: any, res: any, next: any): void {
  const status = getSessionStatus();
  if (!status.authenticated) {
    res.status(401).json({ error: 'Account login required', reason: 'not_authenticated' });
    return;
  }
  if (!status.subscriptionActive && !status.isAdmin) {
    res.status(402).json({ error: 'Active subscription required', reason: 'subscription_inactive' });
    return;
  }
  next();
}
