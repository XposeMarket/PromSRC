// src/integrations/connectors/instagram.ts
// Official Instagram connector: Instagram API with Instagram Login
// (Business Login for Instagram). Replaces the old browser-session shell.
//
// SETUP (Raul's own accounts need no App Review; Standard Access covers
// professional accounts you own and add to the app):
//   1. developers.facebook.com -> Create app -> add the Instagram product ->
//      "API setup with Instagram login".
//   2. Switch the Instagram account to Professional (Creator or Business).
//   3. Either: Generate token for the account in step 2 of API setup and paste
//      it in Connections (fastest), or: add the Redirect URI shown in
//      Connections under Business login settings and click Authorize.
// Docs: developers.facebook.com/docs/instagram-platform/content-publishing

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export const IG_GRAPH = 'https://graph.instagram.com';
export const IG_API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v26.0';
const LONG_LIVED_MS = 60 * 24 * 3600 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 3600 * 1000;
const MIN_REFRESH_AGE_MS = 24 * 3600 * 1000;

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_insights',
  'instagram_business_manage_messages',
];

interface IgTokens extends ConnectorTokens { issued_at?: number; username?: string }

export class InstagramConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'instagram',
      name: 'Instagram',
      authUrl: 'https://www.instagram.com/oauth/authorize',
      tokenUrl: 'https://api.instagram.com/oauth/access_token',
      clientId: process.env.INSTAGRAM_APP_ID || '',
      clientSecret: process.env.INSTAGRAM_APP_SECRET || '',
      scopes: INSTAGRAM_SCOPES,
      usePkce: false,
      useOfflineAccess: false,
      callbackPort: 19430,
      callbackPath: '/auth/callback/instagram',
      // Meta requires an https redirect URI; use the gateway's Funnel origin.
      gatewayCallback: true,
    };
    super(cfg, configDir);
  }

  protected decorateAuthParams(params: URLSearchParams): void {
    const scope = params.get('scope');
    if (scope) params.set('scope', scope.split(/\s+/).join(','));
    params.set('enable_fb_login', 'false');
  }

  hasCredentials(): boolean {
    return super.hasCredentials() || Boolean(this.loadTokens()?.access_token);
  }

  isConnected(): boolean {
    const t = this.loadTokens();
    if (!t?.access_token || t.reauth_required_at) return false;
    return Date.now() < t.expires_at;
  }

  /** Code -> short-lived token -> 60-day long-lived token -> profile. */
  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const row = Array.isArray(data?.data) ? data.data[0] : data;
    const shortToken = String(row?.access_token || '');
    this.loadCredentialsFromVault();
    let accessToken = shortToken;
    let expiresIn = 3600;
    if (this.cfg.clientSecret) {
      const url = `${IG_GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: this.cfg.clientSecret, access_token: shortToken })}`;
      const res = await fetch(url);
      const body: any = await res.json().catch(() => ({}));
      if (res.ok && body?.access_token) { accessToken = body.access_token; expiresIn = Number(body.expires_in) || 5_183_944; }
    }
    return this.withProfile({ access_token: accessToken, expires_at: Date.now() + expiresIn * 1000, issued_at: Date.now(), scope: Array.isArray(row?.permissions) ? row.permissions.join(' ') : row?.permissions });
  }

  /** Token pasted from Meta App Dashboard "Generate token" (long-lived, 60 days). */
  protected async buildManualTokens(accessToken: string): Promise<ConnectorTokens> {
    return this.withProfile({ access_token: accessToken, expires_at: Date.now() + LONG_LIVED_MS - 24 * 3600 * 1000, issued_at: Date.now() });
  }

  private async withProfile(tokens: IgTokens): Promise<IgTokens> {
    const res = await fetch(`${IG_GRAPH}/${IG_API_VERSION}/me?fields=user_id,username,account_type`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const me: any = await res.json().catch(() => ({}));
    if (!res.ok || !me?.user_id) throw new Error(`Instagram rejected the token: ${me?.error?.message || `HTTP ${res.status}`}. Use a token from "API setup with Instagram login" for a professional account.`);
    return { ...tokens, account_id: String(me.user_id), account_email: me.username ? `@${me.username}` : undefined, username: me.username, resource_kind: me.account_type };
  }

  /** Long-lived tokens refresh with themselves (no refresh_token / client secret). */
  async refreshTokens(existing: ConnectorTokens): Promise<ConnectorTokens> {
    const res = await fetch(`${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(existing.access_token)}`);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.access_token) {
      if (Date.now() < existing.expires_at) return existing;
      throw new Error(`Instagram token expired and could not be refreshed (${body?.error?.message || `HTTP ${res.status}`}). Reconnect Instagram in Connections.`);
    }
    const tokens: IgTokens = { ...existing, access_token: body.access_token, expires_at: Date.now() + (Number(body.expires_in) || 5_183_944) * 1000, issued_at: Date.now() };
    this.saveTokens(tokens);
    return tokens;
  }

  async getValidAccessToken(): Promise<string> {
    const t = this.loadTokens() as IgTokens | null;
    if (!t?.access_token) throw new Error('Instagram not connected. Connect it in the Connections panel.');
    const age = Date.now() - (t.issued_at || 0);
    if (t.expires_at - Date.now() < REFRESH_WINDOW_MS && age > MIN_REFRESH_AGE_MS) {
      try { return (await this.refreshTokens(t)).access_token; } catch (err) { if (Date.now() >= t.expires_at) throw err; }
    }
    if (Date.now() >= t.expires_at) throw new Error('Instagram token expired. Reconnect Instagram in Connections.');
    return t.access_token;
  }

  igUserId(): string {
    const id = this.loadTokens()?.account_id;
    if (!id) throw new Error('Instagram account id unknown. Reconnect Instagram in Connections.');
    return id;
  }

  /** Graph call with Bearer auth; throws Graph's own error message. */
  async graph(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, unknown>): Promise<any> {
    const token = await this.getValidAccessToken();
    const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    let url = `${IG_GRAPH}/${IG_API_VERSION}${path}`;
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
    if (method === 'GET' || method === 'DELETE') {
      const qs = new URLSearchParams(Object.entries(clean).map(([k, v]): [string, string] => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
      if ([...qs.keys()].length) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    } else {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(clean);
    }
    const res = await fetch(url, init);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      throw new Error(`Instagram API ${method} ${path.split('?')[0]} failed (${res.status}${e.code ? `, code ${e.code}` : ''}${e.error_subcode ? `/${e.error_subcode}` : ''}): ${e.error_user_msg || e.message || 'unknown error'}`);
    }
    return body;
  }

  getProfile(): Promise<any> {
    return this.graph('GET', '/me', { fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website' });
  }

  async listMedia(limit = 25, after?: string): Promise<any> {
    return this.graph('GET', `/${this.igUserId()}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url', limit, after });
  }

  publishingLimit(): Promise<any> {
    return this.graph('GET', `/${this.igUserId()}/content_publishing_limit`, { fields: 'config,quota_usage' });
  }
}
