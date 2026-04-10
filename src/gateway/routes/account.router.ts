// src/gateway/routes/account.router.ts
// Supabase account auth: login, status, logout, token refresh, subscription check.
// Session is kept in-memory and persisted to {dataDir}/auth-session.json so it
// survives gateway restarts without requiring re-login.

import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../../config/config';

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

function sessionFilePath(): string {
  const dataDir = (getConfig() as any).getDataDir?.() ||
    process.env.PROMETHEUS_DATA_DIR ||
    path.join(process.env.APPDATA || process.env.HOME || '.', 'Prometheus');
  return path.join(dataDir, 'auth-session.json');
}

function loadPersistedSession(): void {
  try {
    const raw = fs.readFileSync(sessionFilePath(), 'utf-8');
    _session = JSON.parse(raw) as AuthSession;
  } catch {
    _session = null;
  }
}

function persistSession(): void {
  try {
    const file = sessionFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (_session) {
      fs.writeFileSync(file, JSON.stringify(_session, null, 2), 'utf-8');
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

// Load on module init (called when gateway starts)
loadPersistedSession();

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function sbFetch(urlPath: string, opts: RequestInit = {}, token?: string): Promise<any> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${SUPABASE_URL}${urlPath}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (body as any).error_description || (body as any).error || (body as any).message || 'Supabase error';
    throw new Error(msg);
  }
  return body;
}

async function checkSubscription(userId: string, accessToken: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  try {
    const data = await sbFetch(
      `/rest/v1/subscriptions?user_id=eq.${userId}&status=in.(active,trialing)&limit=1`,
      {},
      accessToken
    );
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
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

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  try {
    const data = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    };
  } catch {
    return null;
  }
}

async function refreshSubscriptionIfNeeded(force: boolean = false): Promise<void> {
  if (!_session) return;
  if (_session.isAdmin) {
    _session.subscriptionActive = true;
    _session.subscriptionCheckedAt = Date.now();
    persistSession();
    return;
  }

  const lastCheckedAt = Number(_session.subscriptionCheckedAt || 0);
  if (!force && Date.now() - lastCheckedAt < SUBSCRIPTION_REFRESH_TTL_MS) return;

  _session.subscriptionActive = await checkSubscription(
    _session.userId,
    _session.accessToken,
    _session.isAdmin,
  );
  _session.subscriptionCheckedAt = Date.now();
  persistSession();
}

// ─── Startup refresh ──────────────────────────────────────────────────────────
// Called at gateway start to silently refresh an expired persisted session.
export async function refreshPersistedSession(): Promise<void> {
  if (!_session) return;

  const now = Math.floor(Date.now() / 1000);
  const expiresSoon = _session.expiresAt - now < 300; // refresh if < 5 min remaining

  if (expiresSoon) {
    const refreshed = await refreshAccessToken(_session.refreshToken);
    if (refreshed) {
      _session = { ..._session, ...refreshed };
      await refreshSubscriptionIfNeeded(true);
    } else {
      // Refresh failed — clear session, user must log in again
      _session = null;
      persistSession();
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/account/config — expose public Supabase config for browser-side auth
// The anon key is a public key (designed to be embedded in client apps).
router.get('/api/account/config', (_req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

// GET /api/account/status — return current auth + subscription state
// If token is expired but refresh token exists, attempt inline refresh so the
// web UI doesn't briefly show the login screen on the first request after restart.
router.get('/api/account/status', async (_req, res) => {
  if (!_session) {
    return res.json({ authenticated: false });
  }

  const now = Math.floor(Date.now() / 1000);
  if (_session.expiresAt < now) {
    if (_session.refreshToken) {
      const refreshed = await refreshAccessToken(_session.refreshToken);
      if (refreshed) {
        _session = { ..._session, ...refreshed };
        await refreshSubscriptionIfNeeded(true);
      } else {
        _session = null;
        persistSession();
        return res.json({ authenticated: false });
      }
    } else {
      _session = null;
      persistSession();
      return res.json({ authenticated: false });
    }
  }

  await refreshSubscriptionIfNeeded();

  res.json({
    authenticated: true,
    email: _session.email,
    userId: _session.userId,
    isAdmin: _session.isAdmin,
    subscriptionActive: _session.subscriptionActive,
    expiresAt: _session.expiresAt,
  });
});

// POST /api/account/login — accepts pre-verified session from the browser.
// The browser calls Supabase directly (bypassing gateway firewall restrictions),
// then passes the verified session here for server-side storage.
// Body: { accessToken, refreshToken, email, userId, isAdmin, subscriptionActive, expiresAt }
router.post('/api/account/login', (req, res) => {
  const { accessToken, refreshToken, email, userId, isAdmin, subscriptionActive, expiresAt } = req.body || {};

  if (!accessToken || !email || !userId) {
    return res.status(400).json({ error: 'accessToken, email, and userId are required' });
  }

  _session = {
    userId: String(userId),
    email: String(email),
    accessToken: String(accessToken),
    refreshToken: String(refreshToken || ''),
    expiresAt: Number(expiresAt) || Math.floor(Date.now() / 1000) + 3600,
    isAdmin: Boolean(isAdmin),
    subscriptionActive: Boolean(subscriptionActive),
    subscriptionCheckedAt: Date.now(),
  };
  persistSession();

  res.json({
    authenticated: true,
    email: _session.email,
    userId: _session.userId,
    isAdmin: _session.isAdmin,
    subscriptionActive: _session.subscriptionActive,
  });
});

// POST /api/account/logout
router.post('/api/account/logout', (_req, res) => {
  _session = null;
  persistSession();
  res.json({ success: true });
});

// POST /api/account/refresh — silently refresh token
router.post('/api/account/refresh', async (_req, res) => {
  if (!_session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const refreshed = await refreshAccessToken(_session.refreshToken);
  if (!refreshed) {
    _session = null;
    persistSession();
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }

  _session = { ..._session, ...refreshed };
  await refreshSubscriptionIfNeeded(true);

  res.json({
    authenticated: true,
    email: _session.email,
    userId: _session.userId,
    isAdmin: _session.isAdmin,
    subscriptionActive: _session.subscriptionActive,
  });
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
