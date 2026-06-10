/**
 * anthropic-usage-oauth.ts
 * A SEPARATE, tracking-only OAuth credential for Anthropic.
 *
 * Why this exists (and why it is NOT the same as anthropic-oauth.ts):
 *   - Prometheus's main Anthropic auth uses a `claude setup-token`
 *     (sk-ant-oat01…). That token is scoped to INFERENCE ONLY, so it can run
 *     the Messages API (chat) but Anthropic rejects it at the usage endpoint
 *     (`/api/oauth/usage`) with 401 "Invalid bearer token".
 *   - The usage endpoint requires the `user:profile` scope, which is only
 *     granted by the interactive browser OAuth login (the same flow as
 *     `claude login`), producing an access_token + refresh_token.
 *
 * This module implements that browser OAuth (PKCE S256) login and stores the
 * resulting token under a DIFFERENT vault key. It is used ONLY to read usage
 * limits — never for chat/API calls. The main setup-token path is untouched.
 */

import { createHash, randomBytes } from 'crypto';
import { getVault } from '../security/vault';
import { log } from '../security/log-scrubber';

// ─── OAuth constants (Claude Code's public OAuth client) ─────────────────────────

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = 'user:inference user:profile user:sessions:claude_code user:mcp_servers';

const VAULT_KEY = 'anthropic.usage_oauth_tokens';
const PENDING_VAULT_KEY = 'anthropic.usage_oauth_pending';

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface UsageOAuthTokens {
  access_token: string;
  refresh_token: string;
  /** Unix ms when access_token expires */
  expires_at: number;
  stored_at: number;
}

interface PendingPkce {
  verifier: string;
  state: string;
  created_at: number;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ─── Storage ───────────────────────────────────────────────────────────────────────

export function loadUsageTokens(configDir: string): UsageOAuthTokens | null {
  const secret = getVault(configDir).get(VAULT_KEY, 'anthropic-usage:load');
  if (!secret) return null;
  try {
    return JSON.parse(secret.expose()) as UsageOAuthTokens;
  } catch {
    return null;
  }
}

function saveUsageTokens(configDir: string, tokens: UsageOAuthTokens): void {
  getVault(configDir).set(VAULT_KEY, JSON.stringify(tokens), 'anthropic-usage:save');
}

export function clearUsageTokens(configDir: string): void {
  getVault(configDir).delete(VAULT_KEY, 'anthropic-usage:clear');
  getVault(configDir).delete(PENDING_VAULT_KEY, 'anthropic-usage:clear-pending');
}

export function hasUsageTracking(configDir: string): boolean {
  return loadUsageTokens(configDir) !== null;
}

// ─── Flow ────────────────────────────────────────────────────────────────────────

/**
 * Step 1: begin the OAuth login. Returns the authorize URL the user should open
 * in a browser. After approving, Claude shows a `code#state` string to paste back.
 */
export function beginUsageOAuth(configDir: string): { authorizeUrl: string } {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(32));

  const pending: PendingPkce = { verifier, state, created_at: Date.now() };
  getVault(configDir).set(PENDING_VAULT_KEY, JSON.stringify(pending), 'anthropic-usage:pending');

  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}` };
}

/**
 * Step 2: complete the OAuth login with the pasted `code#state` string.
 * Exchanges the code for access + refresh tokens and stores them.
 */
export async function completeUsageOAuth(configDir: string, pastedCode: string): Promise<void> {
  const pendingSecret = getVault(configDir).get(PENDING_VAULT_KEY, 'anthropic-usage:read-pending');
  if (!pendingSecret) throw new Error('No pending usage-tracking login. Start the connection again.');
  const pending = JSON.parse(pendingSecret.expose()) as PendingPkce;

  // The callback shows `code#state`; accept either that or a bare code.
  const trimmed = pastedCode.trim();
  const [code, stateFromCode] = trimmed.split('#');
  const state = stateFromCode || pending.state;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pending.verifier,
    state,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  storeFromTokenResponse(configDir, json);
  getVault(configDir).delete(PENDING_VAULT_KEY, 'anthropic-usage:clear-pending');
  log.security('[anthropic-usage] Usage-tracking OAuth token stored');
}

function storeFromTokenResponse(configDir: string, json: any): void {
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  const expiresInSec = Number(json.expires_in) || 3600;
  if (!accessToken) throw new Error('Token response missing access_token');
  saveUsageTokens(configDir, {
    access_token: accessToken,
    refresh_token: refreshToken || '',
    expires_at: Date.now() + expiresInSec * 1000,
    stored_at: Date.now(),
  });
}

async function refreshUsageToken(configDir: string, tokens: UsageOAuthTokens): Promise<UsageOAuthTokens> {
  if (!tokens.refresh_token) throw new Error('No refresh token; reconnect usage tracking.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  // A refresh may or may not return a new refresh_token; keep the old one if absent.
  if (!json.refresh_token) json.refresh_token = tokens.refresh_token;
  storeFromTokenResponse(configDir, json);
  return loadUsageTokens(configDir)!;
}

/**
 * Get a valid access token for the usage endpoint, refreshing if near expiry.
 * Returns null if usage tracking is not connected.
 */
export async function getValidUsageToken(configDir: string): Promise<string | null> {
  let tokens = loadUsageTokens(configDir);
  if (!tokens) return null;
  // Refresh if expiring within 60s.
  if (Date.now() >= tokens.expires_at - 60_000) {
    try {
      tokens = await refreshUsageToken(configDir, tokens);
    } catch (e: any) {
      log.security('[anthropic-usage] Refresh failed:', e?.message);
      return null;
    }
  }
  return tokens.access_token;
}
