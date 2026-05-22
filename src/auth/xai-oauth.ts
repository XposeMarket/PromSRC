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

export interface XAITokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
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

type BgOAuthResult = { done: false } | { done: true; success: boolean; error?: string };
let _bgResult: BgOAuthResult = { done: false };
let _activeFlow: { verifier: string; state: string; authUrl: string; createdAt: number; tokenEndpoint: string } | null = null;

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

function saveTokens(configDir: string, tokens: XAITokens): void {
  getVault(configDir).set(VAULT_KEY, JSON.stringify(tokens), 'xai-oauth:save');
  log.security('[xai-oauth] Tokens saved to vault');
  try {
    require('../extensions/xai-extension-adapter').refreshXAITools();
  } catch {}
}

export function loadXAITokens(configDir: string): XAITokens | null {
  const secret = getVault(configDir).get(VAULT_KEY, 'xai-oauth:load');
  if (!secret) return null;
  try {
    const tokens = JSON.parse(secret.expose()) as XAITokens;
    return tokens?.access_token && tokens?.refresh_token ? tokens : null;
  } catch {
    return null;
  }
}

export function clearXAITokens(configDir: string): void {
  getVault(configDir).delete(VAULT_KEY, 'xai-oauth:clear');
  log.security('[xai-oauth] Tokens cleared from vault');
  try {
    require('../extensions/xai-extension-adapter').refreshXAITools();
  } catch {}
}

export function isXAIConnected(configDir: string): boolean {
  return loadXAITokens(configDir) !== null;
}

export async function refreshXAITokens(configDir: string): Promise<XAITokens> {
  const existing = loadXAITokens(configDir);
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
    throw new Error(`xAI token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  const tokens: XAITokens = {
    access_token: String(data.access_token || existing.access_token),
    refresh_token: String(data.refresh_token || existing.refresh_token),
    id_token: data.id_token || existing.id_token,
    token_type: String(data.token_type || existing.token_type || 'Bearer'),
    token_endpoint: tokenEndpoint,
    base_url: existing.base_url || DEFAULT_BASE_URL,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  saveTokens(configDir, tokens);
  return tokens;
}

export async function getValidXAIToken(configDir: string): Promise<string> {
  let tokens = loadXAITokens(configDir);
  if (!tokens) throw new Error('xAI OAuth is not connected. Connect xAI in Settings -> Models.');
  const expiresAt = Number(tokens.expires_at || 0);
  const shouldRefresh = expiresAt
    ? Date.now() > expiresAt - 2 * 60 * 1000
    : accessTokenIsExpiring(tokens.access_token, 2 * 60 * 1000);
  if (shouldRefresh) {
    tokens = await refreshXAITokens(configDir);
  }
  return tokens.access_token;
}

export async function getValidXAIRuntimeCredentials(configDir: string): Promise<XAIRuntimeCredentials> {
  const apiKey = await getValidXAIToken(configDir);
  const tokens = loadXAITokens(configDir);
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
  saveTokens(configDir, {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    id_token: data.id_token,
    token_type: String(data.token_type || 'Bearer'),
    token_endpoint: flow.tokenEndpoint,
    base_url: DEFAULT_BASE_URL,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
  });
}

export async function completeXAIOAuthWithCode(configDir: string, code: string): Promise<{ success: boolean; error?: string }> {
  const flow = _activeFlow;
  if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000) {
    return { success: false, error: 'No active xAI OAuth flow. Click Connect again, then paste the code from the browser page.' };
  }
  const trimmed = String(code || '').trim();
  if (!trimmed) return { success: false, error: 'Paste the code shown by xAI.' };
  try {
    await exchangeAuthorizationCode(configDir, trimmed, CALLBACK_URL, flow);
    _activeFlow = null;
    _bgResult = { done: true, success: true };
    return { success: true };
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

export async function startXAIOAuthFlowBackground(configDir: string): Promise<{ authUrl: string } | { error: string }> {
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
  _activeFlow = { verifier, state, authUrl, createdAt: Date.now(), tokenEndpoint: endpoints.token_endpoint };
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
      await exchangeAuthorizationCode(configDir, code, CALLBACK_URL, { verifier, state, authUrl, createdAt: Date.now(), tokenEndpoint: endpoints.token_endpoint });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Connected to Prometheus xAI OAuth</h2><p>You can close this window.</p></body></html>');
      server.close(); _activeFlow = null;
      _bgResult = { done: true, success: true };
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
