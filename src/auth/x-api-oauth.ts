/**
 * x-api-oauth.ts
 *
 * OAuth 2.0 PKCE support for the official X API, modeled after the xurl CLI
 * flow referenced by X Developers / Hermes Agent.
 *
 * This is intentionally separate from xAI/Grok OAuth. xAI OAuth powers Grok
 * models and xAI x_search; official X API user actions require an X Developer
 * app plus OAuth 2.0 User Context tokens.
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { getVault } from '../security/vault';
import { log } from '../security/log-scrubber';

const AUTHORIZATION_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API_BASE_URL = 'https://api.x.com/2';
const DEFAULT_CALLBACK_HOST = process.env.PROMETHEUS_X_API_OAUTH_HOST || 'localhost';
const DEFAULT_CALLBACK_PORT = Number(process.env.PROMETHEUS_X_API_OAUTH_PORT || '8080');
const DEFAULT_CALLBACK_PATH = '/callback';
const DEFAULT_REDIRECT_URI = process.env.PROMETHEUS_X_API_REDIRECT_URI
  || `http://${DEFAULT_CALLBACK_HOST}:${DEFAULT_CALLBACK_PORT}${DEFAULT_CALLBACK_PATH}`;

const TOKENS_VAULT_KEY = 'x.api.oauth_tokens';
const CREDENTIALS_VAULT_KEY = 'x.api.oauth_credentials';
const LEGACY_SOCIAL_X_TOKEN_KEY = 'social_x_token';

const DEFAULT_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'follows.read',
  'follows.write',
  'like.read',
  'like.write',
  'bookmark.read',
  'bookmark.write',
  'list.read',
  'list.write',
  'mute.read',
  'mute.write',
  'block.read',
  'block.write',
  'dm.read',
  'dm.write',
  'space.read',
  'offline.access',
];

function looksLikeXApiConsumerKey(value: string): boolean {
  // X API keys / Consumer Keys are commonly 25-char alphanumeric values.
  // OAuth 2.0 Client IDs are separate values shown after OAuth 2.0 is enabled.
  return /^[A-Za-z0-9]{25}$/.test(value);
}

function unquoteYamlScalar(value: string): string {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadXurlOAuthToken(): XApiTokens | null {
  const file = path.join(os.homedir(), '.xurl');
  if (!fs.existsSync(file)) return null;
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  const defaultApp = unquoteYamlScalar((/^default_app:\s*(.+)$/m.exec(raw) || [])[1] || '');
  const apps: Record<string, any> = {};
  let app = '';
  let inOauth2 = false;
  let user = '';

  for (const line of lines) {
    const appMatch = /^  ([^:\s][^:]*):\s*$/.exec(line);
    if (appMatch) {
      app = unquoteYamlScalar(appMatch[1]);
      apps[app] = apps[app] || { oauth2_tokens: {} };
      inOauth2 = false;
      user = '';
      continue;
    }
    if (!app) continue;
    const appData = apps[app];
    const defaultUserMatch = /^    default_user:\s*(.+)$/.exec(line);
    if (defaultUserMatch) {
      appData.default_user = unquoteYamlScalar(defaultUserMatch[1]);
      continue;
    }
    if (/^    oauth2_tokens:\s*$/.test(line)) {
      inOauth2 = true;
      user = '';
      continue;
    }
    if (!inOauth2) continue;
    const userMatch = /^      ([^:\s][^:]*):\s*$/.exec(line);
    if (userMatch) {
      user = unquoteYamlScalar(userMatch[1]);
      appData.oauth2_tokens[user] = appData.oauth2_tokens[user] || {};
      continue;
    }
    if (!user) continue;
    const valueMatch = /^          (access_token|refresh_token|expiration_time):\s*(.+)$/.exec(line);
    if (valueMatch) {
      appData.oauth2_tokens[user][valueMatch[1]] = unquoteYamlScalar(valueMatch[2]);
    }
  }

  const appNames = Object.keys(apps);
  const appName = apps.prometheus
    ? 'prometheus'
    : defaultApp && apps[defaultApp]
      ? defaultApp
      : '';
  if (!appName) return null;
  const appData = apps[appName];
  const users = Object.keys(appData.oauth2_tokens || {});
  const username = appData.default_user && appData.oauth2_tokens?.[appData.default_user]
    ? appData.default_user
    : users[0];
  const token = username ? appData.oauth2_tokens?.[username] : null;
  if (!token?.access_token) return null;

  return {
    access_token: String(token.access_token),
    refresh_token: token.refresh_token ? String(token.refresh_token) : undefined,
    token_type: 'bearer',
    username,
    expires_at: Number(token.expiration_time || 0) > 0
      ? Number(token.expiration_time) * 1000
      : Date.now() + 60 * 60 * 1000,
    stored_at: Date.now(),
  };
}

export interface XApiOAuthCredentials {
  client_id: string;
  client_secret?: string;
  bearer_token?: string;
  redirect_uri: string;
  scopes: string[];
  stored_at: number;
}

export interface XApiTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
  username?: string;
  user_id?: string;
  redirect_uri?: string;
  stored_at: number;
}

export interface XApiOAuthStatus {
  connected: boolean;
  credentialsConfigured: boolean;
  tokenSource?: 'x_api_oauth' | 'xurl';
  username?: string;
  user_id?: string;
  expires_at?: number;
  refresh_available: boolean;
  redirect_uri: string;
  scopes: string[];
}

type BgOAuthResult = { done: false } | { done: true; success: boolean; error?: string; username?: string; user_id?: string };

let _bgResult: BgOAuthResult = { done: false };
let _activeFlow: {
  verifier: string;
  state: string;
  authUrl: string;
  createdAt: number;
  redirectUri: string;
  credentials: XApiOAuthCredentials;
} | null = null;

function normalizeScopes(scopes?: string[] | string): string[] {
  const source = Array.isArray(scopes) ? scopes : String(scopes || '').split(/[\s,]+/);
  const clean = source.map((s) => String(s || '').trim()).filter(Boolean);
  return Array.from(new Set(clean.length ? clean : DEFAULT_SCOPES));
}

function generateVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function basicAuthHeader(clientId: string, clientSecret?: string): string | undefined {
  if (!clientSecret) return undefined;
  return `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
}

function tokenRequestHeaders(credentials: XApiOAuthCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const basic = basicAuthHeader(credentials.client_id, credentials.client_secret);
  if (basic) headers.Authorization = basic;
  return headers;
}

export function saveXApiCredentials(configDir: string, input: {
  clientId?: string;
  clientSecret?: string;
  bearerToken?: string;
  redirectUri?: string;
  scopes?: string[] | string;
}): XApiOAuthCredentials {
  const clientId = String(input.clientId || '').trim();
  if (!clientId) throw new Error('X API Client ID is required.');
  if (looksLikeXApiConsumerKey(clientId)) {
    throw new Error('That looks like an X API Key / Consumer Key. X OAuth 2.0 needs the separate OAuth 2.0 Client ID from the X Developer app user-auth settings.');
  }
  const redirectUri = String(input.redirectUri || DEFAULT_REDIRECT_URI).trim();
  const credentials: XApiOAuthCredentials = {
    client_id: clientId,
    client_secret: String(input.clientSecret || '').trim() || undefined,
    bearer_token: String(input.bearerToken || '').trim() || undefined,
    redirect_uri: redirectUri,
    scopes: normalizeScopes(input.scopes),
    stored_at: Date.now(),
  };
  getVault(configDir).set(CREDENTIALS_VAULT_KEY, JSON.stringify(credentials), 'x-api-oauth:credentials:save');
  log.security('[x-api-oauth] Credentials saved to vault');
  return credentials;
}

export function loadXApiCredentials(configDir: string): XApiOAuthCredentials | null {
  const secret = getVault(configDir).get(CREDENTIALS_VAULT_KEY, 'x-api-oauth:credentials:load');
  if (!secret) return null;
  try {
    const data = JSON.parse(secret.expose()) as XApiOAuthCredentials;
    if (!data?.client_id) return null;
    return {
      client_id: String(data.client_id),
      client_secret: data.client_secret ? String(data.client_secret) : undefined,
      bearer_token: data.bearer_token ? String(data.bearer_token) : undefined,
      redirect_uri: String(data.redirect_uri || DEFAULT_REDIRECT_URI),
      scopes: normalizeScopes(data.scopes),
      stored_at: Number(data.stored_at || Date.now()),
    };
  } catch {
    return null;
  }
}

export function clearXApiCredentials(configDir: string): void {
  getVault(configDir).delete(CREDENTIALS_VAULT_KEY, 'x-api-oauth:credentials:clear');
  log.security('[x-api-oauth] Credentials cleared from vault');
}

function saveTokens(configDir: string, tokens: XApiTokens): void {
  getVault(configDir).set(TOKENS_VAULT_KEY, JSON.stringify(tokens), 'x-api-oauth:tokens:save');
  // Backward compatibility: older social_intel reads vault://social_x_token.
  getVault(configDir).set(LEGACY_SOCIAL_X_TOKEN_KEY, tokens.access_token, 'x-api-oauth:legacy-token:save');
  log.security('[x-api-oauth] Tokens saved to vault');
}

export function loadXApiTokens(configDir: string): XApiTokens | null {
  const secret = getVault(configDir).get(TOKENS_VAULT_KEY, 'x-api-oauth:tokens:load');
  if (!secret) return null;
  try {
    const tokens = JSON.parse(secret.expose()) as XApiTokens;
    return tokens?.access_token ? tokens : null;
  } catch {
    return null;
  }
}

export function clearXApiTokens(configDir: string): void {
  const vault = getVault(configDir);
  vault.delete(TOKENS_VAULT_KEY, 'x-api-oauth:tokens:clear');
  vault.delete(LEGACY_SOCIAL_X_TOKEN_KEY, 'x-api-oauth:legacy-token:clear');
  log.security('[x-api-oauth] Tokens cleared from vault');
}

export function isXApiConnected(configDir: string): boolean {
  return loadXApiTokens(configDir) !== null;
}

async function fetchXUser(accessToken: string): Promise<{ username?: string; user_id?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/users/me?user.fields=username`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return {};
    const data = await res.json() as any;
    return {
      username: data?.data?.username ? String(data.data.username) : undefined,
      user_id: data?.data?.id ? String(data.data.id) : undefined,
    };
  } catch {
    return {};
  }
}

async function exchangeAuthorizationCode(configDir: string, code: string, flow: NonNullable<typeof _activeFlow>): Promise<XApiTokens> {
  const credentials = flow.credentials;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    code_verifier: flow.verifier,
  });
  if (!credentials.client_secret) body.set('client_id', credentials.client_id);

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: tokenRequestHeaders(credentials),
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`X API token exchange failed (${tokenRes.status}): ${text.slice(0, 300)}`);
  }
  const data = await tokenRes.json() as any;
  if (!data?.access_token) throw new Error('X API OAuth response missing access_token.');
  const account = await fetchXUser(String(data.access_token));
  const tokens: XApiTokens = {
    access_token: String(data.access_token),
    refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
    token_type: String(data.token_type || 'bearer'),
    scope: data.scope ? String(data.scope) : credentials.scopes.join(' '),
    redirect_uri: flow.redirectUri,
    username: account.username,
    user_id: account.user_id,
    expires_at: Date.now() + Number(data.expires_in || 7200) * 1000,
    stored_at: Date.now(),
  };
  saveTokens(configDir, tokens);
  return tokens;
}

export async function refreshXApiTokens(configDir: string): Promise<XApiTokens> {
  const existing = loadXApiTokens(configDir);
  const credentials = loadXApiCredentials(configDir);
  if (!existing?.refresh_token) throw new Error('No X API refresh token; reconnect X API OAuth.');
  if (!credentials) throw new Error('No X API OAuth app credentials configured.');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: existing.refresh_token,
  });
  if (!credentials.client_secret) body.set('client_id', credentials.client_id);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: tokenRequestHeaders(credentials),
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`X API token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  const tokens: XApiTokens = {
    access_token: String(data.access_token || existing.access_token),
    refresh_token: String(data.refresh_token || existing.refresh_token),
    token_type: String(data.token_type || existing.token_type || 'bearer'),
    scope: data.scope ? String(data.scope) : existing.scope,
    redirect_uri: existing.redirect_uri || credentials.redirect_uri,
    username: existing.username,
    user_id: existing.user_id,
    expires_at: Date.now() + Number(data.expires_in || 7200) * 1000,
    stored_at: existing.stored_at || Date.now(),
  };
  saveTokens(configDir, tokens);
  return tokens;
}

export async function getValidXApiToken(configDir: string): Promise<string> {
  let tokens = loadXApiTokens(configDir);
  const vaultBacked = !!tokens;
  if (!tokens) tokens = loadXurlOAuthToken();
  if (!tokens) {
    throw new Error('X API OAuth user context is not connected. Add X Developer app credentials, then run xurl setup or authorize X in Connections.');
  }
  if (!vaultBacked && tokens.expires_at && Date.now() > Number(tokens.expires_at) - 2 * 60 * 1000) {
    throw new Error('xurl X API token is expired or near expiry. Run X connector xurl setup again so xurl can refresh the session.');
  }
  if (tokens.expires_at && Date.now() > Number(tokens.expires_at) - 2 * 60 * 1000) {
    tokens = await refreshXApiTokens(configDir);
  }
  return tokens.access_token;
}

export function getXApiOAuthStatus(configDir: string): XApiOAuthStatus {
  const credentials = loadXApiCredentials(configDir);
  const tokens = loadXApiTokens(configDir);
  const xurlTokens = tokens ? null : loadXurlOAuthToken();
  const activeTokens = tokens || xurlTokens;
  return {
    connected: !!activeTokens,
    credentialsConfigured: !!credentials,
    tokenSource: tokens ? 'x_api_oauth' : xurlTokens ? 'xurl' : undefined,
    username: activeTokens?.username,
    user_id: activeTokens?.user_id,
    expires_at: activeTokens?.expires_at,
    refresh_available: !!activeTokens?.refresh_token,
    redirect_uri: credentials?.redirect_uri || DEFAULT_REDIRECT_URI,
    scopes: credentials?.scopes || DEFAULT_SCOPES,
  };
}

export async function startXApiOAuthFlowBackground(configDir: string): Promise<{ authUrl: string } | { error: string; needsCredentials?: boolean; redirectUri?: string }> {
  const credentials = loadXApiCredentials(configDir);
  if (!credentials) {
    return {
      error: 'X API OAuth app credentials are not configured. Add your X API Client ID/Secret first.',
      needsCredentials: true,
      redirectUri: DEFAULT_REDIRECT_URI,
    };
  }
  if (_activeFlow && Date.now() - _activeFlow.createdAt < 10 * 60 * 1000) {
    _bgResult = { done: false };
    return { authUrl: _activeFlow.authUrl };
  }

  const verifier = generateVerifier();
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: credentials.client_id,
    redirect_uri: credentials.redirect_uri,
    scope: credentials.scopes.join(' '),
    state,
    code_challenge: generateChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const authUrl = `${AUTHORIZATION_URL}?${params.toString()}`;
  _activeFlow = { verifier, state, authUrl, createdAt: Date.now(), redirectUri: credentials.redirect_uri, credentials };
  _bgResult = { done: false };

  const callbackUrl = new URL(credentials.redirect_uri);
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith(callbackUrl.pathname || DEFAULT_CALLBACK_PATH)) { res.writeHead(404); res.end(); return; }
    const url = new URL(req.url, credentials.redirect_uri);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    const fail = (msg: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>${msg}</h2><p>You can close this window.</p></body></html>`);
      server.close(); _activeFlow = null;
      _bgResult = { done: true, success: false, error: msg };
    };

    if (error || !code) return fail(error || 'No code returned by X.');
    if (returnedState !== state) return fail('State mismatch; restart X API OAuth.');

    try {
      const tokens = await exchangeAuthorizationCode(configDir, code, _activeFlow!);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Connected X API OAuth to Prometheus</h2><p>You can close this window.</p></body></html>');
      server.close(); _activeFlow = null;
      _bgResult = { done: true, success: true, username: tokens.username, user_id: tokens.user_id };
    } catch (err: any) {
      fail(String(err?.message || err));
    }
  });

  server.on('error', (err: any) => {
    _activeFlow = null;
    _bgResult = { done: true, success: false, error: `X API OAuth callback server error: ${err.message}` };
  });

  const listenPort = Number(callbackUrl.port || DEFAULT_CALLBACK_PORT);
  const onListen = () => {
    openBrowser(authUrl);
    setTimeout(() => {
      if (!(_bgResult as any).done) {
        server.close(); _activeFlow = null;
        _bgResult = { done: true, success: false, error: 'Timed out waiting for X API OAuth callback.' };
      }
    }, 5 * 60 * 1000);
  };
  if (callbackUrl.hostname === 'localhost') {
    server.listen(listenPort, onListen);
  } else {
    server.listen(listenPort, callbackUrl.hostname, onListen);
  }

  return { authUrl };
}

export async function completeXApiOAuthWithCode(configDir: string, code: string): Promise<{ success: boolean; error?: string; username?: string; user_id?: string }> {
  const flow = _activeFlow;
  if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000) {
    return { success: false, error: 'No active X API OAuth flow. Click Connect again, then paste the code from the browser page.' };
  }
  const trimmed = String(code || '').trim();
  if (!trimmed) return { success: false, error: 'Paste the X API OAuth code first.' };
  try {
    const tokens = await exchangeAuthorizationCode(configDir, trimmed, flow);
    _activeFlow = null;
    _bgResult = { done: true, success: true, username: tokens.username, user_id: tokens.user_id };
    return { success: true, username: tokens.username, user_id: tokens.user_id };
  } catch (err: any) {
    const error = String(err?.message || err);
    _bgResult = { done: true, success: false, error };
    return { success: false, error };
  }
}

export function pollXApiOAuthBackground(): BgOAuthResult {
  return _bgResult;
}
