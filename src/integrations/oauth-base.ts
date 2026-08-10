// src/integrations/oauth-base.ts
// Base class for all OAuth 2.0 connector flows.
// Each connector extends this with its own client ID, scopes, and endpoints.
// Follows the same PKCE + local callback server pattern as openai-oauth.ts.

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { getVault } from '../security/vault.js';

export interface OAuthConnectorConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  usePkce: boolean;
  callbackPort: number;
  callbackPath: string;
  revokeUrl?: string;
  useOfflineAccess?: boolean;
  /** Add an OIDC nonce and require it to bind the returned ID token when the provider supports OpenID Connect. */
  useNonce?: boolean;
  /** OAuth token endpoint client authentication method. Most connectors use body; Notion requires Basic. */
  tokenAuthMethod?: 'body' | 'basic';
}

export interface ConnectorTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
  account_email?: string;
  account_id?: string;
  resource_id?: string;
  resource_name?: string;
  resource_kind?: string;
  identity_url?: string;
  instance_url?: string;
}

export interface OAuthStartResult {
  success: false;
  authUrl: string;
  flowId: string;
  error?: string;
}

export interface OAuthCallbackResult {
  success: boolean;
  account_email?: string;
  error?: string;
}

export interface OAuthConnectorMetadata {
  account?: { providerAccountId?: string; email?: string; displayName?: string; username?: string };
  resources?: Array<{ kind: string; id: string; displayName?: string; parentId?: string; scope?: string }>;
  grantedScopes?: string[];
  expiresAt?: number;
  refreshAvailable: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
}

interface FlowState {
  verifier?: string;
  state: string;
  createdAt: number;
  expectedAccountId?: string;
  requestedScopes?: string[];
  nonce?: string;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const activeFlows = new Map<string, FlowState>();

export abstract class OAuthConnector {
  protected cfg: OAuthConnectorConfig;
  protected configDir: string;

  constructor(cfg: OAuthConnectorConfig, configDir: string) {
    this.cfg = cfg;
    this.configDir = configDir;
  }

  get id() { return this.cfg.id; }

  protected vaultKey(): string {
    return `integration.${this.cfg.id}.oauth_tokens`;
  }

  /** Opaque vault reference only; never returns a credential value. */
  public credentialReference(): string { return `vault:${this.vaultKey()}`; }

  loadTokens(): ConnectorTokens | null {
    try {
      const secret = getVault(this.configDir).get(this.vaultKey(), `oauth:load:${this.cfg.id}`);
      if (!secret) return null;
      return JSON.parse(secret.expose()) as ConnectorTokens;
    } catch { return null; }
  }

  saveTokens(tokens: ConnectorTokens): void {
    getVault(this.configDir).set(this.vaultKey(), JSON.stringify(tokens), `oauth:save:${this.cfg.id}`);
    this.updateConnectionsFile(true, tokens.account_email);
  }

  clearTokens(): void {
    getVault(this.configDir).delete(this.vaultKey(), `oauth:clear:${this.cfg.id}`);
    this.updateConnectionsFile(false);
  }

  /** RFC 7009-compatible provider revoke. Providers with a different revoke
   * contract can override this method; local disconnect remains the fallback. */
  public async revokeAccess(): Promise<void> {
    this.loadCredentialsFromVault();
    const tokens = this.loadTokens();
    if (!tokens?.access_token || !this.cfg.revokeUrl) return;
    const body = new URLSearchParams({ token: tokens.refresh_token || tokens.access_token });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    this.applyClientAuthentication(body, headers);
    const response = await fetch(this.cfg.revokeUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok && response.status !== 400 && response.status !== 404) {
      throw new Error(`${this.cfg.name} token revocation failed (HTTP ${response.status}).`);
    }
  }

  isConnected(): boolean {
    const tokens = this.loadTokens();
    if (!tokens?.access_token || typeof tokens.expires_at !== 'number') return false;
    if (Date.now() <= tokens.expires_at - 5 * 60 * 1000) return true;
    return !!tokens.refresh_token && this.hasCredentials();
  }

  private updateConnectionsFile(connected: boolean, accountEmail?: string): void {
    try {
      const connectionsPath = path.join(this.configDir, 'connections.json');
      let data: Record<string, any> = {};
      if (fs.existsSync(connectionsPath)) {
        data = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
      }
      if (connected) {
        data[this.cfg.id] = { connected: true, connectedAt: Date.now(), authType: 'oauth', accountId: accountEmail };
      } else {
        delete data[this.cfg.id];
      }
      fs.mkdirSync(path.dirname(connectionsPath), { recursive: true });
      fs.writeFileSync(connectionsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn(`[oauth:${this.cfg.id}] Could not update connections.json:`, e.message);
    }
  }

  async getValidAccessToken(): Promise<string> {
    let tokens = this.loadTokens();
    if (!tokens) throw new Error(`${this.cfg.name} not connected. Connect via the Connections panel.`);
    if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
      this.loadCredentialsFromVault();
      tokens = await this.refreshTokens(tokens);
    }
    return tokens.access_token;
  }

  async refreshTokens(existing: ConnectorTokens): Promise<ConnectorTokens> {
    this.loadCredentialsFromVault();
    if (!existing.refresh_token) throw new Error(`No refresh token for ${this.cfg.name}.`);
    if (!this.cfg.clientId) {
      throw new Error(`${this.cfg.name} OAuth credentials are missing. Re-enter Client ID and Client Secret in the Connections panel.`);
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: existing.refresh_token,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    this.applyClientAuthentication(body, headers);
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      throw new Error(`Token refresh failed (${res.status}).`);
    }
    const data = await res.json() as any;
    const tokens: ConnectorTokens = {
      ...existing,
      access_token: data.access_token || existing.access_token,
      refresh_token: data.refresh_token || existing.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    this.saveTokens(tokens);
    return tokens;
  }

  private generateVerifier(): string { return crypto.randomBytes(32).toString('base64url'); }
  private generateChallenge(v: string): string {
    return crypto.createHash('sha256').update(v).digest('base64url');
  }

  // Load credentials from vault if env vars weren't set at startup time.
  // Mutates cfg so subsequent calls (handleCallback, refreshTokens) use them too.
  protected loadCredentialsFromVault(): void {
    if (this.cfg.clientId && this.cfg.clientSecret) return; // already have credentials
    try {
      const vaultKey = `integration.${this.cfg.id}.credentials`;
      const secret = getVault(this.configDir).get(vaultKey, `creds:load:${this.cfg.id}`);
      if (!secret) return;
      const creds = JSON.parse(secret.expose()) as { clientId?: string; clientSecret?: string; apiKey?: string };
      if (!this.cfg.clientId && creds.clientId) this.cfg.clientId = creds.clientId;
      if (!this.cfg.clientSecret && creds.clientSecret) this.cfg.clientSecret = creds.clientSecret;
    } catch { /* vault not ready or no creds stored */ }
  }

  saveCredentials(clientId: string, clientSecret?: string): void {
    const vaultKey = `integration.${this.cfg.id}.credentials`;
    getVault(this.configDir).set(vaultKey, JSON.stringify({ clientId, clientSecret: clientSecret || '' }), `creds:save:${this.cfg.id}`);
    this.cfg.clientId = clientId;
    if (clientSecret) this.cfg.clientSecret = clientSecret;
  }

  hasCredentials(): boolean {
    if (this.cfg.clientId) return true;
    try {
      const vaultKey = `integration.${this.cfg.id}.credentials`;
      const secret = getVault(this.configDir).get(vaultKey, `creds:check:${this.cfg.id}`);
      if (!secret) return false;
      const creds = JSON.parse(secret.expose()) as { clientId?: string };
      return !!creds.clientId;
    } catch { return false; }
  }

  getOAuthMetadata(): OAuthConnectorMetadata {
    this.loadCredentialsFromVault();
    const tokens = this.loadTokens();
    return {
      account: tokens ? {
        providerAccountId: tokens.account_id,
        email: tokens.account_email,
        displayName: tokens.account_email,
      } : undefined,
      grantedScopes: tokens?.scope?.split(/\s+/).filter(Boolean),
      expiresAt: tokens?.expires_at,
      refreshAvailable: Boolean(tokens?.refresh_token && this.hasCredentials()),
      clientIdConfigured: Boolean(this.cfg.clientId),
      clientSecretConfigured: Boolean(this.cfg.clientSecret),
    };
  }

  startFlow(expectedAccountId?: string, requestedScopes?: string[]): OAuthStartResult {
    this.loadCredentialsFromVault();
    if (!this.cfg.clientId) {
      return {
        success: false,
        authUrl: '',
        flowId: this.cfg.id,
        error: `${this.cfg.name} OAuth app is not configured. Add the provider app credentials in Advanced setup.`,
      };
    }
    const existing = activeFlows.get(this.cfg.id);
    if (existing && Date.now() - existing.createdAt <= FLOW_TTL_MS) {
      return { success: false, authUrl: '', flowId: this.cfg.id, error: `${this.cfg.name} authorization is already in progress.` };
    }
    activeFlows.delete(this.cfg.id);
    const state = crypto.randomBytes(16).toString('hex');
    const scopes = [...new Set((requestedScopes || this.cfg.scopes)
      .map((scope) => String(scope || '').trim())
      .filter(Boolean))];
    const nonce = this.cfg.useNonce ? crypto.randomBytes(16).toString('hex') : undefined;
    const flowState: FlowState = { state, createdAt: Date.now(), expectedAccountId, requestedScopes: scopes, nonce };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId,
      redirect_uri: this.callbackUrl(),
      state,
    });
    if (this.cfg.useOfflineAccess !== false) {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }
    if (scopes.length) params.set('scope', scopes.join(' '));
    if (nonce) params.set('nonce', nonce);

    if (this.cfg.usePkce) {
      const verifier = this.generateVerifier();
      flowState.verifier = verifier;
      params.set('code_challenge', this.generateChallenge(verifier));
      params.set('code_challenge_method', 'S256');
    }

    activeFlows.set(this.cfg.id, flowState);
    const authUrl = `${this.cfg.authUrl}?${params.toString()}`;
    return { success: false, authUrl, flowId: this.cfg.id };
  }

  public async handleCallback(code: string, returnedState: string, returnedNonce?: string): Promise<OAuthCallbackResult> {
    this.loadCredentialsFromVault();
    const flow = activeFlows.get(this.cfg.id);
    if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
      activeFlows.delete(this.cfg.id);
      return { success: false, error: 'OAuth session expired or not found. Click Connect again.' };
    }
    if (returnedState !== flow.state) {
      return { success: false, error: 'State mismatch — possible CSRF.' };
    }
    if (flow.nonce && returnedNonce && returnedNonce !== flow.nonce) {
      return { success: false, error: 'Nonce mismatch — possible replay.' };
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl(),
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    this.applyClientAuthentication(body, headers);
    if (flow.verifier) body.set('code_verifier', flow.verifier);

    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!res.ok) {
      await res.text().catch(() => '');
      activeFlows.delete(this.cfg.id);
      return { success: false, error: `Token exchange failed (${res.status}).` };
    }

    const data = await res.json() as any;
    activeFlows.delete(this.cfg.id);

    if (!data?.access_token || typeof data.access_token !== 'string') {
      return { success: false, error: 'Token exchange returned no access token.' };
    }

    if (flow.nonce) {
      const idTokenNonce = this.readIdTokenNonce(data.id_token);
      if (idTokenNonce !== flow.nonce) {
        return { success: false, error: 'Nonce validation failed — restart authorization.' };
      }
    }

    const tokens = await this.buildTokens(data);
    if (flow.expectedAccountId && tokens.account_id && flow.expectedAccountId !== tokens.account_id) {
      return { success: false, error: 'OAuth account mismatch — the selected provider account did not authorize this connection.' };
    }
    this.saveTokens(tokens);

    return { success: true, account_email: tokens.account_email };
  }

  listenForCallback(): Promise<OAuthCallbackResult> {
    return new Promise((resolve) => {
      let finished = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${this.cfg.callbackPort}`);
        if (req.method !== 'GET' || url.pathname !== this.cfg.callbackPath) {
          res.writeHead(404); res.end(); return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const nonce = url.searchParams.get('nonce') || undefined;
        const error = url.searchParams.get('error');

        const done = (html: string, result: OAuthCallbackResult) => {
          if (finished) return;
          finished = true;
          if (timeout) clearTimeout(timeout);
          activeFlows.delete(this.cfg.id);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
          server.close(() => undefined);
          resolve(result);
        };

        if (error || !code) {
          return done(this.errorHtml(error || 'No code returned'),
            { success: false, error: error || 'No authorization code' });
        }

        try {
          const result = await this.handleCallback(code, state || '', nonce);
          if (result.success) {
            return done(this.successHtml(result.account_email), result);
          } else if (/state mismatch/i.test(result.error || '')) {
            // Do not consume a valid pending flow on an invalid local request;
            // a legitimate provider callback may still arrive next.
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(this.errorHtml(result.error || 'State mismatch — possible CSRF.'));
            return;
          } else {
            return done(this.errorHtml(result.error || 'Unknown error'), result);
          }
        } catch (e: any) {
          return done(this.errorHtml(e.message), { success: false, error: e.message });
        }
      });

      server.on('error', (e: any) => {
        if (finished) return;
        finished = true;
        if (timeout) clearTimeout(timeout);
        activeFlows.delete(this.cfg.id);
        resolve({ success: false, error: `Callback server error: ${e.message}` });
      });
      server.listen(this.cfg.callbackPort, 'localhost', () => {
        timeout = setTimeout(() => {
          if (finished) return;
          finished = true;
          activeFlows.delete(this.cfg.id);
          server.close(() => undefined);
          resolve({ success: false, error: 'Timed out waiting for OAuth callback.' });
        }, FLOW_TTL_MS);
      });
    });
  }

  protected callbackUrl(): string {
    return `http://localhost:${this.cfg.callbackPort}${this.cfg.callbackPath}`;
  }

  private applyClientAuthentication(body: URLSearchParams, headers: Record<string, string>): void {
    if (this.cfg.tokenAuthMethod === 'basic') {
      if (!this.cfg.clientId || !this.cfg.clientSecret) throw new Error(`${this.cfg.name} OAuth client authentication is not configured.`);
      headers.Authorization = `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`, 'utf8').toString('base64')}`;
      return;
    }
    if (this.cfg.clientId) body.set('client_id', this.cfg.clientId);
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret);
  }

  protected abstract buildTokens(data: Record<string, any>): Promise<ConnectorTokens>;

  private readIdTokenNonce(idToken: unknown): string | undefined {
    if (typeof idToken !== 'string') return undefined;
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { nonce?: unknown };
      return typeof payload.nonce === 'string' ? payload.nonce : undefined;
    } catch {
      return undefined;
    }
  }

  private escapeHtml(value: string): string {
    return String(value || '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character] || character));
  }

  private successHtml(email?: string): string {
    const safeEmail = email ? this.escapeHtml(email) : '';
    return `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1a2e;color:#e8edf6">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h2 style="color:#31b884">${this.cfg.name} Connected!</h2>
      ${safeEmail ? `<p style="color:#aeb9cb">Signed in as <strong>${safeEmail}</strong></p>` : ''}
      <p style="color:#aeb9cb">You can close this window and return to Prometheus.</p>
    </body></html>`;
  }

  private errorHtml(error: string): string {
    const safeError = this.escapeHtml(error);
    return `<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1a2e;color:#e8edf6">
      <div style="font-size:48px;margin-bottom:16px">❌</div>
      <h2 style="color:#e06d6d">Connection Failed</h2>
      <p style="color:#aeb9cb">${safeError}</p>
      <p style="color:#aeb9cb">You can close this window and try again.</p>
    </body></html>`;
  }
}
