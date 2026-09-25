/**
 * mcp-oauth.ts — OAuth 2.1 + PKCE client for remote MCP servers.
 *
 * Implements the MCP Authorization spec so Prometheus can connect to remote MCP
 * servers that require interactive OAuth (e.g. Robinhood), not just static
 * bearer tokens. Flow:
 *   1. Discover the authorization server (RFC 9728 protected-resource metadata
 *      from the WWW-Authenticate header, then RFC 8414 auth-server metadata).
 *   2. Dynamic Client Registration (RFC 7591) when no client is stored.
 *   3. Authorization Code + PKCE (S256) in the user's browser, with a local
 *      loopback redirect to capture the code.
 *   4. Token exchange + refresh. Tokens are stored in the secret vault.
 *
 * Tokens/clients are keyed by MCP server id. getValidMcpAccessToken() returns a
 * fresh bearer token (refreshing when expired) for the MCP transport to use.
 */
import crypto from 'crypto';
import http from 'http';
import { spawn } from 'child_process';
import { getConfig } from '../config/config.js';
import { getVault } from '../security/vault.js';

const REDIRECT_PORT = 19847;
const REDIRECT_PATH = '/mcp-oauth/callback';
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

interface AuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface StoredClient {
  client_id: string;
  client_secret?: string;
  dynamically_registered?: boolean;
  metadata: AuthServerMetadata;
  resource: string;
  scope?: string;
  redirect_uris?: string[];
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  scope?: string;
  token_type?: string;
}

type FlowStatus = 'pending' | 'connected' | 'error';

interface ActiveFlow {
  serverId: string;
  state: string;
  codeVerifier: string;
  client: StoredClient;
  server?: http.Server;
  redirectUri: string;
  status: FlowStatus;
  processing?: boolean;
  error?: string;
  startedAt: number;
  authorizeUrl: string;
}

const activeFlows = new Map<string, ActiveFlow>();

// In-memory overrides are only available to isolated regression processes, never the gateway.
let testOverrides: { publicUrl?: string; storage?: Map<string, string> } | null = null;
export function setMcpOAuthTestOverrides(overrides: { publicUrl?: string; storage?: Map<string, string> } | null): void {
  if (process.env.MCP_OAUTH_TEST_MODE !== '1') throw new Error('OAuth test overrides require MCP_OAUTH_TEST_MODE=1');
  testOverrides = overrides;
}

export function getMcpOAuthRedirectUris(): string[] {
  const publicUrl = testOverrides?.publicUrl ?? (() => {
    const remote = getConfig().getConfig().gateway.remoteAccess;
    return remote?.enabled ? remote.publicUrl : undefined;
  })();
  if (!publicUrl) return [REDIRECT_URI];
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('Public OAuth callback requires an HTTPS gateway URL.');
  }
  return [REDIRECT_URI, `${publicUrl.replace(/\/+$/, '')}${REDIRECT_PATH}`];
}

// ─── storage ────────────────────────────────────────────────────────────────
function vault() {
  return getVault(getConfig().getConfigDir());
}
function tokenKey(id: string) { return `mcp.oauth.${id}.tokens`; }
function clientKey(id: string) { return `mcp.oauth.${id}.client`; }

function loadClient(id: string): StoredClient | null {
  try {
    const key = clientKey(id);
    const raw = testOverrides?.storage ? testOverrides.storage.get(key) : vault().get(key, `mcp-oauth:client:${id}`)?.expose();
    return raw ? (JSON.parse(raw) as StoredClient) : null;
  } catch { return null; }
}
function saveClient(id: string, client: StoredClient): void {
  if (testOverrides?.storage) testOverrides.storage.set(clientKey(id), JSON.stringify(client));
  else vault().set(clientKey(id), JSON.stringify(client), `mcp-oauth:client:${id}`);
}
function loadTokens(id: string): StoredTokens | null {
  try {
    const key = tokenKey(id);
    const raw = testOverrides?.storage ? testOverrides.storage.get(key) : vault().get(key, `mcp-oauth:tokens:${id}`)?.expose();
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch { return null; }
}
function saveTokens(id: string, tokens: StoredTokens): void {
  if (testOverrides?.storage) testOverrides.storage.set(tokenKey(id), JSON.stringify(tokens));
  else vault().set(tokenKey(id), JSON.stringify(tokens), `mcp-oauth:tokens:${id}`);
}

function safeOAuthError(value: unknown): string {
  const text = String(value || 'OAuth operation failed.')
    .replace(/"(?:access_token|refresh_token|client_secret|authorization)"\s*:\s*"[^"]*"/gi, '"credential":"[redacted]"')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(access_token|refresh_token|client_secret|authorization|code_verifier|state)=?[^\s&,'"}]*/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 240) || 'OAuth operation failed.';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clearMcpOAuth(id: string): void {
  const flow = activeFlows.get(id);
  if (flow) { try { flow.server?.close(); } catch {} activeFlows.delete(id); }
  if (testOverrides?.storage) {
    testOverrides.storage.delete(tokenKey(id));
    testOverrides.storage.delete(clientKey(id));
    return;
  }
  try { vault().delete(tokenKey(id), `mcp-oauth:clear:${id}`); } catch {}
  try { vault().delete(clientKey(id), `mcp-oauth:clear:${id}`); } catch {}
}

/** Revoke a remote-MCP token when the authorization server advertises RFC 7009 support, then clear local state. */
export async function revokeMcpOAuth(id: string): Promise<{ revoked: boolean; cleared: true }> {
  const tokens = loadTokens(id);
  const client = loadClient(id);
  let revoked = false;
  const endpoint = client?.metadata?.revocation_endpoint;
  if (tokens?.access_token && endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          token: tokens.refresh_token || tokens.access_token,
          token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
          client_id: client.client_id,
          ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      revoked = response.ok || response.status === 400 || response.status === 404;
    } catch {
      // Local state is still cleared below; the provider can be revisited from repair.
    }
  }
  clearMcpOAuth(id);
  return { revoked, cleared: true };
}

export function hasMcpOAuthTokens(id: string): boolean {
  return Boolean(loadTokens(id)?.access_token);
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makePkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ─── discovery (RFC 9728 + RFC 8414) ──────────────────────────────────────────
function originOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Pull the resource_metadata URL out of a WWW-Authenticate header, if present. */
export function parseResourceMetadataUrl(wwwAuthenticate?: string | null): string | null {
  if (!wwwAuthenticate) return null;
  const m = wwwAuthenticate.match(/resource_metadata="?([^",\s]+)"?/i);
  return m ? m[1] : null;
}

export function buildAuthMetadataCandidates(authServerUrl: string | undefined, resourceOrigin: string): string[] {
  const candidates: string[] = [];
  if (authServerUrl) {
    const issuer = new URL(authServerUrl);
    const issuerOrigin = `${issuer.protocol}//${issuer.host}`;
    const issuerPath = issuer.pathname.replace(/\/$/, '');
    // RFC 8414 path-bearing issuer form, plus common provider variants.
    candidates.push(`${issuerOrigin}/.well-known/oauth-authorization-server${issuerPath}`);
    candidates.push(`${issuerOrigin}${issuerPath}/.well-known/openid-configuration`);
    candidates.push(`${issuerOrigin}/.well-known/oauth-authorization-server`);
    candidates.push(`${issuerOrigin}/.well-known/openid-configuration`);
  }
  candidates.push(`${resourceOrigin}/.well-known/oauth-authorization-server`);
  candidates.push(`${resourceOrigin}/.well-known/openid-configuration`);
  return [...new Set(candidates)];
}

export async function discoverMcpAuthServer(serverUrl: string, wwwAuthenticate?: string | null): Promise<AuthServerMetadata> {
  const origin = originOf(serverUrl);

  // 1. Protected-resource metadata → authorization_servers[]
  let authServerUrl: string | undefined;
  const resourcePath = new URL(serverUrl).pathname.replace(/\/$/, '');
  const advertisedResourceMetadata = parseResourceMetadataUrl(wwwAuthenticate);
  const resourceCandidates = advertisedResourceMetadata
    ? [advertisedResourceMetadata]
    : [`${origin}/.well-known/oauth-protected-resource${resourcePath}`, `${origin}/.well-known/oauth-protected-resource`];
  for (const rmUrl of [...new Set(resourceCandidates)]) {
    const rm = await fetchJson(rmUrl);
    if (rm && Array.isArray(rm.authorization_servers) && rm.authorization_servers.length) {
      authServerUrl = String(rm.authorization_servers[0]);
      break;
    }
  }

  // 2. Auth-server metadata (RFC 8414 / OIDC), with sensible fallbacks.
  const candidates = buildAuthMetadataCandidates(authServerUrl, origin);

  for (const url of candidates) {
    const meta = await fetchJson(url);
    if (meta?.authorization_endpoint && meta?.token_endpoint) {
      return {
        issuer: meta.issuer,
        authorization_endpoint: meta.authorization_endpoint,
        token_endpoint: meta.token_endpoint,
        revocation_endpoint: meta.revocation_endpoint,
        registration_endpoint: meta.registration_endpoint,
        scopes_supported: meta.scopes_supported,
        code_challenge_methods_supported: meta.code_challenge_methods_supported,
      };
    }
  }

  // Never invent authorization/token endpoints. A guessed URL can send users
  // to the wrong origin/path and cannot establish a trustworthy OAuth flow.
  throw new Error(`OAuth authorization-server metadata was not found. Checked: ${candidates.join(', ')}`);
}

// ─── dynamic client registration (RFC 7591) ───────────────────────────────────
async function ensureClient(serverId: string, serverUrl: string, metadata: AuthServerMetadata, redirectUri: string, scope?: string): Promise<StoredClient> {
  // Register only loopback for loopback flows: several providers (Asana,
  // Square, Intercom, Monday) reject the whole registration if any redirect
  // URI is non-loopback, which would break the PC flow that used to work.
  const all = getMcpOAuthRedirectUris();
  const redirectUris = redirectUri === REDIRECT_URI ? [REDIRECT_URI] : all;
  const existing = loadClient(serverId);
  const metadataMatches = existing?.metadata?.authorization_endpoint === metadata.authorization_endpoint
    && existing?.metadata?.token_endpoint === metadata.token_endpoint;
  // Reuse only a client registered with exactly this redirect set: a client
  // that also carries the public URI is rejected by some authorize pages
  // (Vercel) even for the loopback flow.
  const sameUris = Array.isArray(existing?.redirect_uris)
    && existing!.redirect_uris.length === redirectUris.length
    && redirectUris.every((uri) => existing!.redirect_uris!.includes(uri));
  if (existing?.client_id && metadataMatches && existing.client_id !== 'prometheus' && sameUris) {
    return { ...existing, metadata, resource: serverUrl, scope: scope || existing.scope };
  }

  let clientId: string | undefined;
  let clientSecret: string | undefined;
  if (metadata.registration_endpoint) {
    const reg = await fetchJson(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Prometheus',
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(scope ? { scope } : {}),
      }),
    });
    if (reg?.client_id) {
      clientId = String(reg.client_id);
      clientSecret = reg.client_secret ? String(reg.client_secret) : undefined;
    }
  }

  if (!clientId) throw new Error(metadata.registration_endpoint
    ? 'Dynamic OAuth client registration did not return a client_id.'
    : 'The authorization server does not advertise dynamic client registration and no valid registered client is stored.');
  const client: StoredClient = {
    client_id: clientId,
    client_secret: clientSecret,
    dynamically_registered: true,
    redirect_uris: redirectUris,
    metadata,
    resource: serverUrl,
    scope,
  };
  saveClient(serverId, client);
  return client;
}

// ─── browser ──────────────────────────────────────────────────────────────────
function openBrowser(url: string): void {
  if (process.env.MCP_OAUTH_NO_BROWSER === '1') return; // headless / tests
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* caller still has the URL to open manually */ }
}

// ─── token exchange / refresh ──────────────────────────────────────────────────
async function postToken(metadata: AuthServerMetadata, body: Record<string, string>): Promise<StoredTokens> {
  const r = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`token endpoint rejected request (${r.status})`);
  const json = JSON.parse(text);
  const expiresIn = Number(json.expires_in);
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_at: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : undefined,
    scope: json.scope,
    token_type: json.token_type || 'Bearer',
  };
}

/** Returns a valid access token, refreshing when expired. null if not authorized. */
export async function getValidMcpAccessToken(serverId: string): Promise<string | null> {
  const tokens = loadTokens(serverId);
  if (!tokens?.access_token) return null;
  const fresh = !tokens.expires_at || tokens.expires_at - Date.now() > 60_000;
  if (fresh) return tokens.access_token;

  const client = loadClient(serverId);
  if (!tokens.refresh_token || !client) return tokens.access_token; // best effort
  try {
    const refreshed = await postToken(client.metadata, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    });
    if (!refreshed.refresh_token) refreshed.refresh_token = tokens.refresh_token;
    saveTokens(serverId, refreshed);
    return refreshed.access_token;
  } catch {
    return tokens.access_token;
  }
}

// ─── flow ──────────────────────────────────────────────────────────────────────
export interface StartFlowResult {
  status: FlowStatus;
  authorizeUrl?: string;
  error?: string;
}

export function getMcpOAuthFlowStatus(serverId: string): { status: FlowStatus; error?: string; authorizeUrl?: string } | null {
  const flow = activeFlows.get(serverId);
  if (!flow) {
    return hasMcpOAuthTokens(serverId) ? { status: 'connected' } : null;
  }
  return { status: flow.status, error: flow.error, authorizeUrl: flow.authorizeUrl };
}

/** Complete either a loopback or public gateway callback, matched solely by unpredictable state. */
export async function handleMcpOAuthCallback(query: URLSearchParams): Promise<{ ok: boolean; html: string; serverId?: string }> {
  const state = query.get('state');
  const flow = state ? [...activeFlows.values()].find(candidate => candidate.state === state) : undefined;
  const page = (ok: boolean, message: string, serverId?: string) => ({
    ok, serverId,
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? '&#10003; Connected' : '&#10007; Authorization failed'}</h2><p style="color:#9a9">${escapeHtml(message)}</p><p style="color:#667">You can close this tab and return to Prometheus.</p></div></body></html>`,
  });
  // Never mutate another flow on missing/incorrect state; don't expose provider details.
  if (!flow || flow.status !== 'pending' || flow.processing || Date.now() - flow.startedAt >= FLOW_TIMEOUT_MS) {
    return page(false, 'Invalid or expired callback.');
  }
  flow.processing = true;
  const error = query.get('error');
  const code = query.get('code');
  if (error || !code) {
    flow.status = 'error';
    flow.error = error ? `Provider authorization error (${safeOAuthError(error)})` : 'authorization code missing';
    try { flow.server?.close(); } catch {}
    return page(false, error ? 'Provider authorization was not completed.' : 'Invalid callback.');
  }
  try {
    const tokens = await postToken(flow.client.metadata, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.client.client_id,
      code_verifier: flow.codeVerifier,
      ...(flow.client.client_secret ? { client_secret: flow.client.client_secret } : {}),
    });
    saveTokens(flow.serverId, tokens);
    flow.status = 'connected';
    return page(true, 'Authorization complete.', flow.serverId);
  } catch (error: any) {
    flow.status = 'error';
    flow.error = safeOAuthError(error?.message || error);
    return page(false, 'Token exchange failed.');
  } finally {
    try { flow.server?.close(); } catch {}
  }
}

/** Start OAuth via loopback (desktop, default) or the public gateway (phone). */
export async function startMcpOAuthFlow(serverId: string, serverUrl: string, wwwAuthenticate?: string | null, scope?: string, options?: { openBrowser?: boolean; callback?: 'loopback' | 'public' }): Promise<StartFlowResult> {
  const prev = activeFlows.get(serverId);
  if (prev) { try { prev.server?.close(); } catch {} activeFlows.delete(serverId); }

  let metadata: AuthServerMetadata;
  let client: StoredClient;
  let redirectUri: string;
  try {
    const redirectUris = getMcpOAuthRedirectUris();
    redirectUri = options?.callback === 'public' ? redirectUris[1] : redirectUris[0];
    if (!redirectUri) throw new Error('Public OAuth callback requires enabled remote access with a public URL.');
    metadata = await discoverMcpAuthServer(serverUrl, wwwAuthenticate);
    client = await ensureClient(serverId, serverUrl, metadata, redirectUri, scope);
  } catch (error: any) {
    return { status: 'error', error: `OAuth discovery failed: ${safeOAuthError(error?.message || error)}` };
  }

  const { verifier, challenge } = makePkce();
  const state = base64url(crypto.randomBytes(16));
  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('resource', serverUrl);
  const useScope = scope || client.scope || (metadata.scopes_supported ? metadata.scopes_supported.join(' ') : '');
  if (useScope) authorizeUrl.searchParams.set('scope', useScope);

  let server: http.Server | undefined;
  if (options?.callback !== 'public') {
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://127.0.0.1:${REDIRECT_PORT}`);
        if (url.pathname !== REDIRECT_PATH) { res.writeHead(404); res.end(); return; }
        const result = await handleMcpOAuthCallback(url.searchParams);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        res.end(result.html);
        if (result.ok && result.serverId) {
          void import('./mcp-manager.js').then(({ getMCPManager }) => getMCPManager().connect(result.serverId!)).catch(() => {});
        }
      } catch {
        try { res.writeHead(500); res.end(); } catch {}
      }
    });
    try { await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(REDIRECT_PORT, '127.0.0.1', resolve);
    }); } catch (error: any) {
      try { server.close(); } catch {}
      return { status: 'error', error: `OAuth callback listener failed: ${safeOAuthError(error?.message || error)}` };
    }
  }

  const flow: ActiveFlow = {
    serverId, state, codeVerifier: verifier, client, server, redirectUri,
    status: 'pending', startedAt: Date.now(), authorizeUrl: authorizeUrl.toString(),
  };
  activeFlows.set(serverId, flow);
  setTimeout(() => {
    const current = activeFlows.get(serverId);
    if (current === flow && flow.status === 'pending' && !flow.processing) {
      flow.status = 'error'; flow.error = 'authorization timed out';
      try { flow.server?.close(); } catch {}
    }
  }, FLOW_TIMEOUT_MS).unref?.();

  if (options?.openBrowser !== false && options?.callback !== 'public') openBrowser(flow.authorizeUrl);
  return { status: 'pending', authorizeUrl: flow.authorizeUrl };
}
