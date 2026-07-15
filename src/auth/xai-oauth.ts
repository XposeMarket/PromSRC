/**
 * xai-oauth.ts
 * Browser OAuth for xAI Grok account/subscription auth.
 *
 * This does not bypass xAI entitlements. It stores the OAuth bearer token and
 * lets xAI decide whether the connected account tier may use API-style Grok,
 * image, video, and audio endpoints.
 */

import crypto from 'crypto';
import http from 'http';
import { exec } from 'child_process';
import { getVault } from '../security/vault';
import { log } from '../security/log-scrubber';

const ISSUER = 'https://auth.x.ai';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
const CALLBACK_HOST = process.env.PROMETHEUS_XAI_OAUTH_HOST || '127.0.0.1';
const CALLBACK_PORT = Number(process.env.PROMETHEUS_XAI_OAUTH_PORT || '56121');
const CALLBACK_PATH = '/callback';
const CALLBACK_URL = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
const VAULT_KEY = 'xai.oauth_tokens';
const accountVaultKey = (accountId?: string): string => {
  const id = String(accountId || '').trim();
  return id ? `${VAULT_KEY}.${id}` : VAULT_KEY;
};

export interface XAITokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  refresh_token_expires_at?: number;
  id_token?: string;
  token_type?: string;
  token_endpoint?: string;
  base_url?: string;
}

export interface XAIRuntimeCredentials {
  provider: 'xai-oauth';
  auth_mode: 'oauth_pkce';
  api_key: string;
  base_url: string;
}

type BgOAuthResult = { done: false } | { done: true; success: boolean; error?: string; accountId?: string };
let _bgResult: BgOAuthResult = { done: false };
let _activeFlow: { verifier: string; state: string; authUrl: string; createdAt: number; tokenEndpoint: string; accountId?: string } | null = null;
const refreshInFlight = new Map<string, Promise<XAITokens>>();

function assertGatewayCredentialWriter(operation: string): void {
  if (process.env.PROMETHEUS_RUNTIME_WORKER === '1') {
    throw new Error(`Runtime workers are read-only OAuth credential consumers and cannot ${operation}; gateway preflight must refresh credentials.`);
  }
}

function generateVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function validateXaiEndpoint(raw: string, field: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`xAI ${field} must be HTTPS`);
  const host = url.hostname.toLowerCase();
  if (host !== 'x.ai' && !host.endsWith('.x.ai')) {
    throw new Error(`xAI ${field} host must be x.ai or a *.x.ai subdomain`);
  }
  return raw;
}

function resolveXAIBaseUrl(tokens?: XAITokens | null): string {
  return (
    process.env.PROMETHEUS_XAI_BASE_URL
    || process.env.XAI_BASE_URL
    || process.env.HERMES_XAI_BASE_URL
    || tokens?.base_url
    || DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
}

function accessTokenIsExpiring(accessToken: string, skewMs: number): boolean {
  if (!accessToken || !accessToken.includes('.')) return false;
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as any;
    const exp = Number(payload?.exp || 0);
    return Number.isFinite(exp) && exp > 0 && exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

async function discovery(): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const res = await fetch(DISCOVERY_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`xAI discovery failed (${res.status})`);
  const data = await res.json() as any;
  const authorization_endpoint = validateXaiEndpoint(String(data?.authorization_endpoint || ''), 'authorization_endpoint');
  const token_endpoint = validateXaiEndpoint(String(data?.token_endpoint || ''), 'token_endpoint');
  return { authorization_endpoint, token_endpoint };
}

function saveTokens(configDir: string, tokens: XAITokens, accountId?: string): void {
  assertGatewayCredentialWriter('persist xAI OAuth credentials');
  getVault(configDir).set(accountVaultKey(accountId), JSON.stringify(tokens), 'xai-oauth:save');
  log.security('[xai-oauth] Tokens saved to vault');
  try {
    require('../extensions/xai-extension-adapter').refreshXAITools();
  } catch {}
}

export function loadXAITokens(configDir: string, accountId?: string): XAITokens | null {
  const secret = getVault(configDir).get(accountVaultKey(accountId), 'xai-oauth:load');
  if (!secret) return null;
  try {
    const tokens = JSON.parse(secret.expose()) as XAITokens;
    return tokens?.access_token && tokens?.refresh_token ? tokens : null;
  } catch {
    return null;
  }
}

export function clearXAITokens(configDir: string, accountId?: string): void {
  assertGatewayCredentialWriter('clear xAI OAuth credentials');
  getVault(configDir).delete(accountVaultKey(accountId), 'xai-oauth:clear');
  log.security('[xai-oauth] Tokens cleared from vault');
  try {
    require('../extensions/xai-extension-adapter').refreshXAITools();
  } catch {}
}

export function isXAIConnected(configDir: string, accountId?: string): boolean {
  return loadXAITokens(configDir, accountId) !== null;
}

export async function refreshXAITokens(configDir: string, accountId?: string): Promise<XAITokens> {
  assertGatewayCredentialWriter('refresh xAI OAuth credentials');
  const refreshKey = `${configDir}:${String(accountId || '')}`;
  const activeRefresh = refreshInFlight.get(refreshKey);
  if (activeRefresh) return activeRefresh;
  const refresh = refreshXAITokensUncoordinated(configDir, accountId);
  refreshInFlight.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    refreshInFlight.delete(refreshKey);
  }
}

async function refreshXAITokensUncoordinated(configDir: string, accountId?: string): Promise<XAITokens> {
  const existing = loadXAITokens(configDir, accountId);
  if (!existing?.refresh_token) throw new Error('No xAI refresh token; reconnect xAI OAuth.');
  const tokenEndpoint = validateXaiEndpoint(existing.token_endpoint || (await discovery()).token_endpoint, 'token_endpoint');
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: existing.refresh_token,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 401) {
      // Refresh token has expired or been revoked — clear stale session so UI
      // shows disconnected rather than a forever-broken "connected" state.
      clearXAITokens(configDir, accountId);
      throw new Error(`xAI OAuth session expired (${res.status}). Please reconnect xAI in Settings → Models.`);
    }
    throw new Error(`xAI token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  const rtExpiresIn = Number(data.refresh_token_expires_in || 0);
  const tokens: XAITokens = {
    access_token: String(data.access_token || existing.access_token),
    refresh_token: String(data.refresh_token || existing.refresh_token),
    id_token: data.id_token || existing.id_token,
    token_type: String(data.token_type || existing.token_type || 'Bearer'),
    token_endpoint: tokenEndpoint,
    base_url: existing.base_url || DEFAULT_BASE_URL,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
    refresh_token_expires_at: rtExpiresIn > 0 ? Date.now() + rtExpiresIn * 1000 : existing.refresh_token_expires_at,
  };
  saveTokens(configDir, tokens, accountId);
  return tokens;
}

export async function getValidXAIToken(configDir: string, accountId?: string): Promise<string> {
  let tokens = loadXAITokens(configDir, accountId);
  if (!tokens) throw new Error('xAI OAuth is not connected. Connect xAI in Settings -> Models.');
  const expiresAt = Number(tokens.expires_at || 0);
  const refreshExpiresAt = Number(tokens.refresh_token_expires_at || 0);
  // Proactively refresh if the refresh token itself expires within 30 minutes.
  const refreshTokenNearExpiry = refreshExpiresAt > 0 && Date.now() > refreshExpiresAt - 30 * 60 * 1000;
  const accessTokenNearExpiry = expiresAt
    ? Date.now() > expiresAt - 2 * 60 * 1000
    : accessTokenIsExpiring(tokens.access_token, 2 * 60 * 1000);
  if (accessTokenNearExpiry || refreshTokenNearExpiry) {
    tokens = await refreshXAITokens(configDir, accountId);
  }
  return tokens.access_token;
}

export async function getValidXAIRuntimeCredentials(configDir: string, accountId?: string): Promise<XAIRuntimeCredentials> {
  const apiKey = await getValidXAIToken(configDir, accountId);
  const tokens = loadXAITokens(configDir, accountId);
  return {
    provider: 'xai-oauth',
    auth_mode: 'oauth_pkce',
    api_key: apiKey,
    base_url: resolveXAIBaseUrl(tokens),
  };
}

async function exchangeAuthorizationCode(configDir: string, code: string, redirectUri: string, flow: NonNullable<typeof _activeFlow>): Promise<void> {
  const tokenRes = await fetch(flow.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: flow.verifier,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 300)}`);
  }
  const data = await tokenRes.json() as any;
  if (!data?.access_token || !data?.refresh_token) throw new Error('xAI OAuth response missing access or refresh token.');
  const rtExpiresIn = Number(data.refresh_token_expires_in || 0);
  saveTokens(configDir, {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    id_token: data.id_token,
    token_type: String(data.token_type || 'Bearer'),
    token_endpoint: flow.tokenEndpoint,
    base_url: DEFAULT_BASE_URL,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
    refresh_token_expires_at: rtExpiresIn > 0 ? Date.now() + rtExpiresIn * 1000 : undefined,
  }, flow.accountId);
}

export async function completeXAIOAuthWithCode(configDir: string, code: string, accountId?: string): Promise<{ success: boolean; error?: string; accountId?: string }> {
  const flow = _activeFlow;
  if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000) {
    return { success: false, error: 'No active xAI OAuth flow. Click Connect again, then paste the code from the browser page.' };
  }
  const trimmed = String(code || '').trim();
  if (!trimmed) return { success: false, error: 'Paste the code shown by xAI.' };
  try {
    if (accountId && !flow.accountId) flow.accountId = accountId;
    await exchangeAuthorizationCode(configDir, trimmed, CALLBACK_URL, flow);
    const completedAccountId = flow.accountId;
    _activeFlow = null;
    _bgResult = { done: true, success: true, accountId: completedAccountId };
    return { success: true, accountId: completedAccountId };
  } catch (err: any) {
    const error = String(err?.message || err);
    _bgResult = { done: true, success: false, error };
    return { success: false, error };
  }
}

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

export async function startXAIOAuthFlowBackground(configDir: string, accountId?: string): Promise<{ authUrl: string } | { error: string }> {
  if (_activeFlow && Date.now() - _activeFlow.createdAt < 10 * 60 * 1000) {
    _bgResult = { done: false };
    return { authUrl: _activeFlow.authUrl };
  }

  const endpoints = await discovery();
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce: crypto.randomBytes(16).toString('hex'),
    plan: 'generic',
    referrer: 'prometheus',
  });
  const authUrl = `${endpoints.authorization_endpoint}?${params.toString()}`;
  const account = String(accountId || '').trim() || undefined;
  _activeFlow = { verifier, state, authUrl, createdAt: Date.now(), tokenEndpoint: endpoints.token_endpoint, accountId: account };
  _bgResult = { done: false };

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith(CALLBACK_PATH)) { res.writeHead(404); res.end(); return; }
    const url = new URL(req.url, CALLBACK_URL);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    const fail = (msg: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h2>${msg}</h2><p>You can close this window.</p></body></html>`);
      server.close(); _activeFlow = null;
      _bgResult = { done: true, success: false, error: msg };
    };

    if (error || !code) return fail(error || 'No code returned');
    if (returnedState !== state) return fail('State mismatch; restart xAI login.');

    try {
      await exchangeAuthorizationCode(configDir, code, CALLBACK_URL, { verifier, state, authUrl, createdAt: Date.now(), tokenEndpoint: endpoints.token_endpoint, accountId: account });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Connected to Prometheus xAI OAuth</h2><p>You can close this window.</p></body></html>');
      server.close(); _activeFlow = null;
      _bgResult = { done: true, success: true, accountId: account };
    } catch (err: any) {
      fail(String(err?.message || err));
    }
  });

  server.on('error', (err: any) => {
    _activeFlow = null;
    _bgResult = { done: true, success: false, error: `Callback server error: ${err.message}` };
  });
  server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
    openBrowser(authUrl);
    setTimeout(() => {
      if (!(_bgResult as any).done) {
        server.close(); _activeFlow = null;
        _bgResult = { done: true, success: false, error: 'Timed out waiting for xAI OAuth callback.' };
      }
    }, 5 * 60 * 1000);
  });

  return { authUrl };
}

export function pollXAIOAuthBackground(): BgOAuthResult {
  return _bgResult;
}

// Keep-alive: runs every 30 minutes while the server is up to silently rotate
// the access token (and refresh token, if xAI rotates on refresh) before the
// refresh token's own TTL expires. Without this, a ~36-hour gap in usage lets
// the refresh token expire and forces the user to re-authenticate.
const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;
let _keepAliveTimer: ReturnType<typeof setInterval> | null = null;

export function startXAITokenKeepAlive(configDir: string): void {
  if (_keepAliveTimer) return;
  _keepAliveTimer = setInterval(async () => {
    const tokens = loadXAITokens(configDir);
    if (!tokens) return;
    try {
      await refreshXAITokens(configDir);
      log.security('[xai-oauth] Keep-alive token refresh succeeded');
    } catch (err: any) {
      // refreshXAITokens already clears stale tokens on 4xx, so just log.
      log.security(`[xai-oauth] Keep-alive refresh failed: ${err?.message}`);
    }
  }, KEEPALIVE_INTERVAL_MS);
  // Unref so the timer doesn't prevent clean process exit.
  if (typeof _keepAliveTimer === 'object' && (_keepAliveTimer as any)?.unref) {
    (_keepAliveTimer as any).unref();
  }
}

export function stopXAITokenKeepAlive(): void {
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}
