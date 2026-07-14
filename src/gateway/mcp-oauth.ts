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
  server: http.Server;
  status: FlowStatus;
  error?: string;
  startedAt: number;
  authorizeUrl: string;
}

const activeFlows = new Map<string, ActiveFlow>();

// ─── storage ────────────────────────────────────────────────────────────────
function vault() {
  return getVault(getConfig().getConfigDir());
}
function tokenKey(id: string) { return `mcp.oauth.${id}.tokens`; }
function clientKey(id: string) { return `mcp.oauth.${id}.client`; }

function loadClient(id: string): StoredClient | null {
  try {
    const s = vault().get(clientKey(id), `mcp-oauth:client:${id}`);
    return s ? (JSON.parse(s.expose()) as StoredClient) : null;
  } catch { return null; }
}
function saveClient(id: string, client: StoredClient): void {
  vault().set(clientKey(id), JSON.stringify(client), `mcp-oauth:client:${id}`);
}
function loadTokens(id: string): StoredTokens | null {
  try {
    const s = vault().get(tokenKey(id), `mcp-oauth:tokens:${id}`);
    return s ? (JSON.parse(s.expose()) as StoredTokens) : null;
  } catch { return null; }
}
function saveTokens(id: string, tokens: StoredTokens): void {
  vault().set(tokenKey(id), JSON.stringify(tokens), `mcp-oauth:tokens:${id}`);
}
export function clearMcpOAuth(id: string): void {
  const flow = activeFlows.get(id);
  if (flow) { try { flow.server.close(); } catch {} activeFlows.delete(id); }
  try { vault().delete(tokenKey(id), `mcp-oauth:clear:${id}`); } catch {}
  try { vault().delete(clientKey(id), `mcp-oauth:clear:${id}`); } catch {}
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
async function ensureClient(serverId: string, serverUrl: string, metadata: AuthServerMetadata, scope?: string): Promise<StoredClient> {
  const existing = loadClient(serverId);
  const metadataMatches = existing?.metadata?.authorization_endpoint === metadata.authorization_endpoint
    && existing?.metadata?.token_endpoint === metadata.token_endpoint;
  if (existing?.client_id && metadataMatches && existing.client_id !== 'prometheus') return { ...existing, metadata, resource: serverUrl, scope: scope || existing.scope };

  let clientId: string | undefined;
  let clientSecret: string | undefined;
  if (metadata.registration_endpoint) {
    const reg = await fetchJson(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Prometheus',
        redirect_uris: [REDIRECT_URI],
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
  if (!r.ok) throw new Error(`token endpoint ${r.status}: ${text.slice(0, 200)}`);
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

/**
 * Begin the browser OAuth flow for an MCP server. Discovers the auth server,
 * registers a client, starts a loopback callback server, opens the browser, and
 * returns the authorize URL. Poll getMcpOAuthFlowStatus() for completion.
 */
export async function startMcpOAuthFlow(serverId: string, serverUrl: string, wwwAuthenticate?: string | null, scope?: string, options?: { openBrowser?: boolean }): Promise<StartFlowResult> {
  // Tear down any prior in-flight attempt.
  const prev = activeFlows.get(serverId);
  if (prev) { try { prev.server.close(); } catch {} activeFlows.delete(serverId); }

  let metadata: AuthServerMetadata;
  let client: StoredClient;
  try {
    metadata = await discoverMcpAuthServer(serverUrl, wwwAuthenticate);
    client = await ensureClient(serverId, serverUrl, metadata, scope);
  } catch (e: any) {
    return { status: 'error', error: `OAuth discovery failed: ${e?.message || e}` };
  }

  const { verifier, challenge } = makePkce();
  const state = base64url(crypto.randomBytes(16));

  const authorizeUrl = new URL(metadata.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  // RFC 8707 resource indicator — bind the token to this MCP server.
  authorizeUrl.searchParams.set('resource', serverUrl);
  const useScope = scope || client.scope || (metadata.scopes_supported ? metadata.scopes_supported.join(' ') : '');
  if (useScope) authorizeUrl.searchParams.set('scope', useScope);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '', `http://127.0.0.1:${REDIRECT_PORT}`);
      if (!url.pathname.startsWith(REDIRECT_PATH)) { res.writeHead(404); res.end(); return; }
      const flow = activeFlows.get(serverId);
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const err = url.searchParams.get('error');

      const finish = (ok: boolean, message: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>${ok ? '&#10003; Connected' : '&#10007; Authorization failed'}</h2><p style="color:#9a9">${message}</p><p style="color:#667">You can close this tab and return to Prometheus.</p></div></body></html>`);
      };

      if (err) { if (flow) { flow.status = 'error'; flow.error = err; } finish(false, err); server.close(); return; }
      if (!code || !flow || gotState !== flow.state) { if (flow) { flow.status = 'error'; flow.error = 'invalid callback (state mismatch)'; } finish(false, 'Invalid callback.'); server.close(); return; }

      try {
        const tokens = await postToken(client.metadata, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
          code_verifier: flow.codeVerifier,
          ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        });
        saveTokens(serverId, tokens);
        flow.status = 'connected';
        finish(true, 'Authorization complete.');
      } catch (e: any) {
        flow.status = 'error';
        flow.error = e?.message || String(e);
        finish(false, flow.error || 'Token exchange failed.');
      } finally {
        server.close();
      }
    } catch {
      try { res.writeHead(500); res.end(); } catch {}
    }
  });

  try { await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1', () => resolve());
  }); } catch (error: any) {
    try { server.close(); } catch {}
    return { status: 'error', error: `OAuth callback listener failed: ${error?.message || error}` };
  }

  const flow: ActiveFlow = {
    serverId, state, codeVerifier: verifier, client, server,
    status: 'pending', startedAt: Date.now(), authorizeUrl: authorizeUrl.toString(),
  };
  activeFlows.set(serverId, flow);

  // Auto-expire.
  setTimeout(() => {
    const f = activeFlows.get(serverId);
    if (f && f.status === 'pending') { f.status = 'error'; f.error = 'authorization timed out'; try { f.server.close(); } catch {} }
  }, FLOW_TIMEOUT_MS).unref?.();

  if (options?.openBrowser !== false) openBrowser(flow.authorizeUrl);
  return { status: 'pending', authorizeUrl: flow.authorizeUrl };
}
