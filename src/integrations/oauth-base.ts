// src/integrations/oauth-base.ts
// Base class for all OAuth 2.0 connector flows.
// Each connector extends this with its own client ID, scopes, and endpoints.
// Follows the same PKCE + local callback server pattern as openai-oauth.ts.

import fs from 'fs';
import { assertTokenRefreshAllowed } from '../gateway/runtime/preview-mode';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { getVault } from '../security/vault.js';
import { GATEWAY_OAUTH_CALLBACK_PREFIX, awaitGatewayOAuthCallback, gatewayPublicOrigin } from './gateway-oauth-callback.js';
import { accountKeySuffix, addAccountArmed, listConnectorAccounts, routeIncomingAccount, runWithConnectorAccounts, type AccountIdentity } from '../connections/connector-accounts.js';

export interface OAuthConnectorConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  /**
   * Scopes the connector cannot work without. When the token response reports
   * granted scopes and any of these are missing (e.g. the user left Google's
   * granular consent checkboxes unticked), the callback fails instead of
   * saving a connection that looks connected but 403s on every call.
   */
  requiredScopes?: string[];
  usePkce: boolean;
  callbackPort: number;
  callbackPath: string;
  revokeUrl?: string;
  useOfflineAccess?: boolean;
  /** Add an OIDC nonce and require it to bind the returned ID token when the provider supports OpenID Connect. */
  useNonce?: boolean;
  /** OAuth token endpoint client authentication method. Most connectors use body; Notion requires Basic. */
  tokenAuthMethod?: 'body' | 'basic';
  /**
   * Receive the provider redirect on the gateway's public HTTPS origin
   * (gateway.remoteAccess.publicUrl, e.g. the Tailscale Funnel URL) instead of
   * a localhost listener. Needed by providers that reject http://localhost
   * redirect URIs (Instagram Business Login). Falls back to localhost when no
   * public URL is configured.
   */
  gatewayCallback?: boolean;
  /**
   * Provider also accepts an optional "web" OAuth client (vault
   * integration.<id>.web_credentials, or a fallback connector's). When one is
   * saved and the gateway has a public https origin, sign-in returns through
   * the gateway callback so it can finish from a phone browser. Grants record
   * which client issued them so refresh/revoke keep using the same client.
   */
  webClient?: boolean;
}

/**
 * Required scopes absent from a token response's space/comma separated `scope`.
 * If the provider does not report scopes, nothing can be verified: return [].
 */
export function missingRequiredScopes(required: string[] | undefined, grantedRaw: unknown): string[] {
  if (!required?.length || typeof grantedRaw !== 'string' || !grantedRaw.trim()) return [];
  const granted = new Set(grantedRaw.split(/[\s,]+/).filter(Boolean));
  return required.filter((s) => !granted.has(s));
}

export interface ConnectorTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
  account_email?: string;
  account_id?: string;
  /** Set when the provider rejected the refresh token (revoked/expired grant). Cleared by a fresh OAuth connect. */
  reauth_required_at?: number;
  reauth_reason?: string;
  resource_id?: string;
  resource_name?: string;
  resource_kind?: string;
  identity_url?: string;
  instance_url?: string;
  /** 'web' when the grant came from the optional web OAuth client; absent = primary client. */
  oauth_client?: 'web';
}

export interface OAuthStartResult {
  success: false;
  authUrl: string;
  flowId: string;
  error?: string;
  /** True when the flow uses the web client + public gateway callback (works from any device). */
  web?: boolean;
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
  processing?: boolean;
  verifier?: string;
  state: string;
  createdAt: number;
  expectedAccountId?: string;
  requestedScopes?: string[];
  nonce?: string;
  web?: boolean;
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

  /** Default account keeps the original slot; extra accounts (connector-accounts.ts) get a suffix. */
  protected vaultKey(): string {
    return `integration.${this.cfg.id}.oauth_tokens${accountKeySuffix(this.cfg.id)}`;
  }

  /** Identity stored in the DEFAULT slot, regardless of the active account scope. */
  public defaultAccountIdentity(): AccountIdentity | null {
    try {
      const secret = getVault(this.configDir).get(`integration.${this.cfg.id}.oauth_tokens`, `oauth:identity:${this.cfg.id}`);
      if (!secret) return null;
      const tokens = JSON.parse(secret.expose()) as ConnectorTokens;
      return tokens?.access_token ? { email: tokens.account_email, accountId: tokens.account_id } : null;
    } catch { return null; }
  }

  /** Store a NEW grant: routes to the default slot or an extra account (add-account mode). */
  protected saveIncomingTokens(tokens: ConnectorTokens): string {
    const slug = routeIncomingAccount(this.configDir, this.cfg.id, 'oauth',
      { email: tokens.account_email, accountId: tokens.account_id }, () => this.defaultAccountIdentity());
    runWithConnectorAccounts([this.cfg.id], slug, () => this.saveTokens(tokens));
    return slug;
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
    if (!accountKeySuffix(this.cfg.id)) this.updateConnectionsFile(true, tokens.account_email);
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
    this.applyClientAuthentication(body, headers, tokens.oauth_client === 'web' ? this.webClientCredentials() : null);
    const response = await fetch(this.cfg.revokeUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok && response.status !== 400 && response.status !== 404) {
      throw new Error(`${this.cfg.name} token revocation failed (HTTP ${response.status}).`);
    }
  }

  /** connected | reauth_required (grant revoked/expired, user must reconnect) | not_connected. */
  authStatus(): { state: 'connected' | 'reauth_required' | 'not_connected'; reason?: string } {
    const tokens = this.loadTokens();
    if (tokens?.reauth_required_at) return { state: 'reauth_required', reason: tokens.reauth_reason || 'authorization expired or was revoked' };
    return this.isConnected() ? { state: 'connected' } : { state: 'not_connected' };
  }

  private lastGrantProbeAt = 0;

  /**
   * Fire-and-forget: when the access token has expired, try one refresh so a
   * revoked/expired grant is detected (and flagged reauth_required) while the
   * user is looking at status, not later when a tool call needs it.
   * Rate-limited per connector; refresh failures are recorded by refreshTokens.
   */
  probeExpiredGrant(): void {
    const tokens = this.loadTokens();
    if (!tokens?.refresh_token || tokens.reauth_required_at) return;
    // Only probe a token that has actually expired; never refresh a valid one early.
    if (Date.now() < tokens.expires_at) return;
    if (Date.now() - this.lastGrantProbeAt < 10 * 60 * 1000) return;
    if (!this.hasCredentials()) return;
    this.lastGrantProbeAt = Date.now();
    this.refreshTokens(tokens).catch(() => { /* state persisted by refreshTokens */ });
  }

  isConnected(): boolean {
    const tokens = this.loadTokens();
    if (!tokens?.access_token || typeof tokens.expires_at !== 'number') return false;
    // A rejected refresh grant can never succeed again: report it honestly so
    // the tool surface hides the connector instead of failing every call.
    if (tokens.reauth_required_at) return false;
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
    // A rejected grant never recovers by retrying; don't hammer the token endpoint.
    if (tokens.reauth_required_at) {
      throw new Error(`${this.cfg.name} needs to be reconnected: the saved login was rejected (${tokens.reauth_reason || 'authorization expired or was revoked'}). Reconnect ${this.cfg.name} in the Connections panel.`);
    }
    if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
      this.loadCredentialsFromVault();
      tokens = await this.refreshTokens(tokens);
    }
    return tokens.access_token;
  }

  private refreshInFlight: { refreshToken: string; promise: Promise<ConnectorTokens> } | null = null;

  /** True while `existing` is still the stored grant (not reconnected, not disconnected). */
  private isCurrentGrant(existing: ConnectorTokens): boolean {
    const current = this.loadTokens();
    return !!current && current.refresh_token === existing.refresh_token;
  }

  /**
   * Single-flight per grant: a background probe and a foreground tool call
   * share one token request. Results are only persisted if the grant is still
   * the stored one, so a late response can never overwrite a fresh reconnect
   * or resurrect a disconnected connector.
   */
  async refreshTokens(existing: ConnectorTokens): Promise<ConnectorTokens> {
    const key = String(existing.refresh_token || '');
    if (this.refreshInFlight && this.refreshInFlight.refreshToken === key) return this.refreshInFlight.promise;
    const promise = this.refreshTokensOnce(existing);
    this.refreshInFlight = { refreshToken: key, promise };
    try {
      return await promise;
    } finally {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = null;
    }
  }

  private async refreshTokensOnce(existing: ConnectorTokens): Promise<ConnectorTokens> {
    assertTokenRefreshAllowed('connector-oauth');
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
    const webCreds = existing.oauth_client === 'web' ? this.webClientCredentials() : null;
    if (existing.oauth_client === 'web' && !webCreds) {
      throw new Error(`${this.cfg.name} web sign-in client is no longer configured. Reconnect ${this.cfg.name} in the Connections panel.`);
    }
    this.applyClientAuthentication(body, headers, webCreds);
    this.decorateTokenBody(body);
    const res = await fetch(this.cfg.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let code = '';
      try { code = String(JSON.parse(text)?.error || ''); } catch { /* non-JSON body */ }
      // 400/401 from a token endpoint means the grant itself is dead
      // (invalid_grant: revoked, expired, password change, app in testing mode).
      // Retrying cannot fix it, so persist the state and say what to do.
      if (res.status === 400 || res.status === 401 || /invalid_grant|invalid_client|unauthorized_client/.test(code)) {
        const reason = `${code || `HTTP ${res.status}`}: authorization expired or was revoked`;
        if (this.isCurrentGrant(existing)) {
          try { getVault(this.configDir).set(this.vaultKey(), JSON.stringify({ ...existing, reauth_required_at: Date.now(), reauth_reason: reason }), `oauth:reauth:${this.cfg.id}`); } catch { /* best effort */ }
        }
        throw new Error(`${this.cfg.name} needs to be reconnected: the saved login was rejected (${reason}). Reconnect ${this.cfg.name} in the Connections panel.`);
      }
      throw new Error(`${this.cfg.name} token refresh failed (HTTP ${res.status}${code ? `, ${code}` : ''}). This may be temporary; retry shortly.`);
    }
    const data = await res.json() as any;
    const tokens: ConnectorTokens = {
      ...existing,
      access_token: data.access_token || existing.access_token,
      refresh_token: data.refresh_token || existing.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    if (!this.isCurrentGrant(existing)) {
      // Reconnected or disconnected while the request was in flight: keep what is stored now.
      const current = this.loadTokens();
      if (!current) throw new Error(`${this.cfg.name} not connected. Connect via the Connections panel.`);
      // Multi-account: the slot may now hold a DIFFERENT account (make default / remove ran
      // while this refresh was in flight). Never hand that account's token to this call.
      const sameAccount = (existing.account_id && current.account_id === existing.account_id)
        || (existing.account_email && current.account_email?.toLowerCase() === existing.account_email.toLowerCase())
        // No stored identity: we can't prove it's the same account, so only trust the slot when
        // this connector has no extra accounts (no make-default/remove swap could have happened).
        || (!existing.account_id && !existing.account_email && listConnectorAccounts(this.configDir, this.cfg.id).length === 0);
      if (!sameAccount) throw new Error(`${this.cfg.name} account changed while refreshing. Retry the request.`);
      return current;
    }
    this.saveTokens(tokens);
    return tokens;
  }

  private generateVerifier(): string { return crypto.randomBytes(32).toString('base64url'); }
  /** PKCE S256 challenge. TikTok desktop deviates from RFC 7636 and wants hex. */
  protected generateChallenge(v: string): string {
    return crypto.createHash('sha256').update(v).digest('base64url');
  }

  /** Provider-specific authorize URL tweaks (e.g. TikTok's client_key). */
  protected decorateAuthParams(_params: URLSearchParams): void { /* default: none */ }

  /** Provider-specific token-endpoint body tweaks (code exchange and refresh). */
  protected decorateTokenBody(_body: URLSearchParams): void { /* default: none */ }

  /**
   * Save a provider access token the user generated directly (Meta App
   * Dashboard "Generate token", Notion internal integration secret, TikTok/
   * LinkedIn token generators). Skips the browser OAuth round trip.
   */
  async saveManualAccessToken(accessToken: string): Promise<{ account?: string }> {
    const token = String(accessToken || '').trim();
    if (!token) throw new Error('Access token is empty.');
    const tokens = await this.buildManualTokens(token);
    this.saveIncomingTokens(tokens);
    return { account: tokens.account_email || tokens.account_id };
  }

  /** Default manual token: no expiry known. Connectors override to validate and enrich. */
  protected async buildManualTokens(accessToken: string): Promise<ConnectorTokens> {
    return { access_token: accessToken, expires_at: Number.MAX_SAFE_INTEGER };
  }

  // Load credentials from vault if env vars weren't set at startup time.
  // Mutates cfg so subsequent calls (handleCallback, refreshTokens) use them too.
  protected loadCredentialsFromVault(): void {
    if (this.cfg.clientId && this.cfg.clientSecret) return; // already have credentials
    for (const id of [this.cfg.id, ...this.credentialFallbackIds()]) {
      try {
        const vaultKey = `integration.${id}.credentials`;
        const secret = getVault(this.configDir).get(vaultKey, `creds:load:${this.cfg.id}`);
        if (!secret) continue;
        const creds = JSON.parse(secret.expose()) as { clientId?: string; clientSecret?: string; apiKey?: string };
        // Take the pair from one source only; mixing a client id from one app
        // with a secret from another fails at token exchange.
        if (!this.cfg.clientId && creds.clientId) {
          this.cfg.clientId = creds.clientId;
          if (!this.cfg.clientSecret && creds.clientSecret) this.cfg.clientSecret = creds.clientSecret;
        } else if (this.cfg.clientId && !this.cfg.clientSecret && id === this.cfg.id && creds.clientSecret) {
          this.cfg.clientSecret = creds.clientSecret;
        }
        if (this.cfg.clientId && this.cfg.clientSecret) return;
      } catch { /* vault not ready or no creds stored */ }
    }
  }

  /**
   * Other connectors whose stored OAuth client this one may reuse (same
   * provider project). Google Drive reuses Gmail's client so connecting Drive
   * needs only the Drive API enabled, not a second credential entry.
   */
  protected credentialFallbackIds(): string[] { return []; }

  /** Optional web OAuth client (see OAuthConnectorConfig.webClient). Never exposed outside the connector. */
  protected webClientCredentials(): { clientId: string; clientSecret: string } | null {
    if (this.cfg.webClient === false) return null;
    for (const id of [...new Set([this.cfg.id, ...this.credentialFallbackIds(), ...this.webClientFallbackIds()])]) {
      try {
        const secret = getVault(this.configDir).get(`integration.${id}.web_credentials`, `creds:web:${this.cfg.id}`);
        if (!secret) continue;
        const creds = JSON.parse(secret.expose()) as { clientId?: string; clientSecret?: string; samePrimary?: boolean };
        // Providers that allow several redirect URIs on one app (X, Slack, Notion...) reuse the primary client.
        if (creds.samePrimary) {
          if (id !== this.cfg.id) continue;
          if (this.cfg.clientId) return { clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret || '' };
          continue;
        }
        if (creds.clientId) return { clientId: creds.clientId, clientSecret: creds.clientSecret || '' };
      } catch { /* vault unavailable or malformed entry */ }
    }
    return null;
  }

  /** Connectors sharing one provider project may reuse another connector's web client. */
  protected webClientFallbackIds(): string[] { return []; }

  saveWebClientCredentials(clientId: string, clientSecret: string): void {
    if (this.cfg.webClient === false) throw new Error(`${this.cfg.name} does not support a web sign-in client.`);
    // Empty clientId = the primary app already lists the gateway redirect URI; reuse it.
    const value = clientId ? { clientId, clientSecret } : { samePrimary: true };
    getVault(this.configDir).set(`integration.${this.cfg.id}.web_credentials`, JSON.stringify(value), `creds:web:save:${this.cfg.id}`);
  }

  clearWebClientCredentials(): void {
    getVault(this.configDir).delete(`integration.${this.cfg.id}.web_credentials`, `creds:web:clear:${this.cfg.id}`);
  }

  /** A web client entry is saved for this connector but can't be read (e.g. sealed with another vault key). */
  webClientEntryBroken(): boolean {
    if (this.cfg.webClient === false) return false;
    try {
      const vault = getVault(this.configDir);
      const ids = [...new Set([this.cfg.id, ...this.credentialFallbackIds(), ...this.webClientFallbackIds()])];
      return ids.some((id) => vault.has(`integration.${id}.web_credentials`)) && !this.webClientCredentials();
    } catch { return false; }
  }

  /** Web sign-in works only with a saved web client AND a public https gateway origin. */
  webSignInAvailable(): boolean {
    return !!(this.webClientCredentials() && gatewayPublicOrigin());
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

  private cancelListener?: () => void;
  cancelFlow(): void { activeFlows.delete(this.cfg.id); this.cancelListener?.(); this.cancelListener = undefined; }

  startFlow(expectedAccountId?: string, requestedScopes?: string[]): OAuthStartResult {
    this.loadCredentialsFromVault();
    const webCreds = gatewayPublicOrigin() ? this.webClientCredentials() : null;
    if (!this.cfg.clientId && !webCreds) {
      return {
        success: false,
        authUrl: '',
        flowId: this.cfg.id,
        error: `${this.cfg.name} OAuth app is not configured. Add the provider app credentials in Advanced setup.`,
      };
    }
    if (!webCreds && gatewayPublicOrigin() && this.webClientEntryBroken()) {
      // Never silently fall back to the desktop-only flow when a phone setup exists but can't be read.
      return { success: false, authUrl: '', flowId: this.cfg.id, error: `${this.cfg.name} phone sign-in setup can't be read. Open the plugin and save the phone sign-in client again.` };
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
    const web = !!webCreds;
    const flowState: FlowState = { state, createdAt: Date.now(), expectedAccountId, requestedScopes: scopes, nonce, web };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: webCreds ? webCreds.clientId : this.cfg.clientId,
      redirect_uri: this.redirectFor(web),
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
    this.decorateAuthParams(params);
    // Adding another account: let the provider show its account chooser, preselecting the hint.
    const adding = addAccountArmed(this.configDir, this.cfg.id);
    if (adding) {
      if (/accounts\.google\.com/i.test(this.cfg.authUrl)) params.set('prompt', 'select_account consent');
      if (adding.hint) params.set('login_hint', adding.hint);
    }

    activeFlows.set(this.cfg.id, flowState);
    const authUrl = `${this.cfg.authUrl}?${params.toString()}`;
    return { success: false, authUrl, flowId: this.cfg.id, ...(web ? { web: true } : {}) };
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

    if (flow.processing) return { success: false, error: 'OAuth callback already in progress.' };
    flow.processing = true;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectFor(!!flow.web),
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const flowWebCreds = flow.web ? this.webClientCredentials() : null;
    if (flow.web && !flowWebCreds) {
      activeFlows.delete(this.cfg.id);
      return { success: false, error: `${this.cfg.name} web sign-in client was removed during sign-in. Click Connect again.` };
    }
    this.applyClientAuthentication(body, headers, flowWebCreds);
    if (flow.verifier) body.set('code_verifier', flow.verifier);
    this.decorateTokenBody(body);

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
    if (activeFlows.get(this.cfg.id) !== flow) return { success: false, error: 'OAuth session cancelled or replaced.' };

    if (!data?.access_token || typeof data.access_token !== 'string') {
      return { success: false, error: 'Token exchange returned no access token.' };
    }

    if (flow.nonce) {
      const idTokenNonce = this.readIdTokenNonce(data.id_token);
      if (idTokenNonce !== flow.nonce) {
        return { success: false, error: 'Nonce validation failed — restart authorization.' };
      }
    }

    // Verify only the connector-required scopes this flow actually asked for. A least-privilege
    // plan (e.g. read-only) must not be rejected for capability scopes it never requested.
    const requested = new Set(flow.requestedScopes || []);
    const selectedRequired = this.cfg.requiredScopes?.filter((s) => !flow.requestedScopes || requested.has(s));
    const missingScopes = missingRequiredScopes(selectedRequired, data.scope);
    if (missingScopes.length) {
      return {
        success: false,
        error: `${this.cfg.name} was not granted the permissions it needs (${missingScopes.join(', ')}). Click Connect again and tick every permission box on the consent screen.`,
      };
    }

    const tokens = await this.buildTokens(data);
    if (flow.web) tokens.oauth_client = 'web';
    else delete tokens.oauth_client;
    if (flow.expectedAccountId && tokens.account_id && flow.expectedAccountId !== tokens.account_id) {
      return { success: false, error: 'OAuth account mismatch — the selected provider account did not authorize this connection.' };
    }
    if (activeFlows.get(this.cfg.id) !== flow) return { success: false, error: 'OAuth session cancelled or replaced.' };
    activeFlows.delete(this.cfg.id);
    this.saveIncomingTokens(tokens);

    return { success: true, account_email: tokens.account_email };
  }

  listenForCallback(): Promise<OAuthCallbackResult> {
    if ((this.cfg.gatewayCallback || activeFlows.get(this.cfg.id)?.web) && gatewayPublicOrigin()) {
      return awaitGatewayOAuthCallback(this.cfg.id, FLOW_TTL_MS, async (code, state, error) => {
        if (error || !code) return { success: false, error: error || 'No authorization code' };
        return this.handleCallback(code, state);
      });
    }
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
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.errorHtml(result.error || 'State mismatch — possible CSRF.'));
            return;
          } else {
            return done(this.errorHtml(result.error || 'Unknown error'), result);
          }
        } catch (e: any) {
          return done(this.errorHtml(e.message), { success: false, error: e.message });
        }
      });

      this.cancelListener = () => {
        if (finished) return; finished = true;
        if (timeout) clearTimeout(timeout);
        server.close(() => undefined);
        resolve({ success: false, error: 'OAuth cancelled.' });
      };
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
    const origin = this.cfg.gatewayCallback ? gatewayPublicOrigin() : '';
    if (origin) return `${origin}${GATEWAY_OAUTH_CALLBACK_PREFIX}${this.cfg.id}`;
    return `http://localhost:${this.cfg.callbackPort}${this.cfg.callbackPath}`;
  }

  /** Redirect URI the user must register in the provider app. */
  public redirectUri(): string { return this.callbackUrl(); }

  /** Redirect URI to register on the optional web client ('' when no public origin). */
  public webRedirectUri(): string {
    const origin = gatewayPublicOrigin();
    return origin ? `${origin}${GATEWAY_OAUTH_CALLBACK_PREFIX}${this.cfg.id}` : '';
  }

  private redirectFor(web: boolean): string {
    return web ? this.webRedirectUri() : this.callbackUrl();
  }

  private applyClientAuthentication(body: URLSearchParams, headers: Record<string, string>, override?: { clientId: string; clientSecret: string } | null): void {
    const clientId = override ? override.clientId : this.cfg.clientId;
    const clientSecret = override ? override.clientSecret : this.cfg.clientSecret;
    if (this.cfg.tokenAuthMethod === 'basic') {
      if (!clientId || !clientSecret) throw new Error(`${this.cfg.name} OAuth client authentication is not configured.`);
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
      return;
    }
    if (clientId) body.set('client_id', clientId);
    if (clientSecret) body.set('client_secret', clientSecret);
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
