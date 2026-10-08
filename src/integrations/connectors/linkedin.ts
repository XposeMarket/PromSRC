// src/integrations/connectors/linkedin.ts
// Official LinkedIn connector: "Sign In with LinkedIn using OpenID Connect" +
// "Share on LinkedIn" (w_member_social). Both products are self-serve on any
// developer app, so posting as yourself needs no partner approval.
//
// SETUP:
//   1. linkedin.com/developers/apps -> Create app (needs a Company Page to
//      associate; any page you admin works).
//   2. Products tab: request "Sign In with LinkedIn using OpenID Connect" and
//      "Share on LinkedIn" (instant).
//   3. Auth tab: add redirect URL http://localhost:19432/auth/callback/linkedin
//   4. Paste Client ID + Client Secret in Connections and Authorize.
// Tokens last 60 days; LinkedIn issues refresh tokens only to approved
// partner apps, so Prometheus asks for a reconnect when it expires.

import fs from 'fs';
import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202509';

export class LinkedInConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'linkedin',
      name: 'LinkedIn',
      authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      clientId: process.env.LINKEDIN_CLIENT_ID || '',
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
      scopes: ['openid', 'profile', 'email', 'w_member_social'],
      usePkce: false,
      useOfflineAccess: false,
      callbackPort: 19432,
      callbackPath: '/auth/callback/linkedin',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return this.withIdentity({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 5_184_000) * 1000,
      scope: data.scope ? String(data.scope).replace(/,/g, ' ') : undefined,
    });
  }

  protected async buildManualTokens(accessToken: string): Promise<ConnectorTokens> {
    return this.withIdentity({ access_token: accessToken, expires_at: Date.now() + 59 * 24 * 3600 * 1000 });
  }

  private async withIdentity(tokens: ConnectorTokens): Promise<ConnectorTokens> {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const me: any = await res.json().catch(() => ({}));
    if (!res.ok || !me?.sub) throw new Error(`LinkedIn rejected the token (HTTP ${res.status}). It needs the openid + profile scopes.`);
    return { ...tokens, account_id: String(me.sub), account_email: me.email || me.name };
  }

  personUrn(): string {
    const id = this.loadTokens()?.account_id;
    if (!id) throw new Error('LinkedIn member id unknown. Reconnect LinkedIn in Connections.');
    return `urn:li:person:${id}`;
  }

  /** Versioned REST call (api.linkedin.com/rest). */
  async rest(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; headers: Headers; json: any }> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.linkedin.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'LinkedIn-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text().catch(() => '');
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`LinkedIn API ${method} ${path.split('?')[0]} failed (${res.status}): ${json?.message || text.slice(0, 300) || 'unknown error'}`);
    return { status: res.status, headers: res.headers, json };
  }

  getUserInfo(): Promise<any> {
    return this.rest('GET', '/v2/userinfo').then((r) => r.json);
  }

  /** Upload an image or video owned by the member; returns its urn. */
  async uploadMedia(filePath: string, kind: 'image' | 'video'): Promise<string> {
    const owner = this.personUrn();
    const data = fs.readFileSync(filePath);
    if (kind === 'image') {
      const init = await this.rest('POST', '/rest/images?action=initializeUpload', { initializeUploadRequest: { owner } });
      const { uploadUrl, image } = init.json?.value || {};
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${await this.getValidAccessToken()}` }, body: data });
      if (!put.ok) throw new Error(`LinkedIn image upload failed (HTTP ${put.status}).`);
      return image;
    }
    const init = await this.rest('POST', '/rest/videos?action=initializeUpload', { initializeUploadRequest: { owner, fileSizeBytes: data.length, uploadCaptions: false, uploadThumbnail: false } });
    const value = init.json?.value || {};
    const etags: string[] = [];
    for (const part of value.uploadInstructions || []) {
      const chunk = data.subarray(part.firstByte, part.lastByte + 1);
      const put = await fetch(part.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
      if (!put.ok) throw new Error(`LinkedIn video upload failed (HTTP ${put.status}).`);
      etags.push(String(put.headers.get('etag') || '').replace(/"/g, ''));
    }
    await this.rest('POST', '/rest/videos?action=finalizeUpload', { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken || '', uploadedPartIds: etags } });
    return value.video;
  }

  /** Create a member post. Returns the post urn (x-restli-id). */
  async createPost(opts: { text: string; visibility?: 'PUBLIC' | 'CONNECTIONS'; media?: Array<{ urn: string; title?: string; altText?: string }>; article?: { url: string; title?: string; description?: string } }): Promise<string> {
    const body: any = {
      author: this.personUrn(),
      commentary: opts.text,
      visibility: opts.visibility || 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (opts.media?.length === 1) body.content = { media: { id: opts.media[0].urn, title: opts.media[0].title, altText: opts.media[0].altText } };
    else if (opts.media && opts.media.length > 1) body.content = { multiImage: { images: opts.media.map((m) => ({ id: m.urn, altText: m.altText })) } };
    else if (opts.article) body.content = { article: { source: opts.article.url, title: opts.article.title, description: opts.article.description } };
    const res = await this.rest('POST', '/rest/posts', body);
    return String(res.headers.get('x-restli-id') || res.json?.id || '');
  }

  deletePost(urn: string): Promise<any> {
    return this.rest('DELETE', `/rest/posts/${encodeURIComponent(urn)}`);
  }
}
