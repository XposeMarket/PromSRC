// src/integrations/connectors/tiktok.ts
// Official TikTok connector: Login Kit (desktop) + Content Posting API +
// Display API. Replaces the old browser-session shell.
//
// SETUP:
//   1. developers.tiktok.com -> Manage apps -> Create app (Desktop platform).
//   2. Add products: Login Kit, Content Posting API (enable Direct Post),
//      and request scopes user.info.basic, user.info.profile, user.info.stats,
//      video.list, video.upload, video.publish.
//   3. Login Kit redirect URI: http://localhost:19431/auth/callback/tiktok
//   4. Paste Client key + Client secret in Connections and Authorize.
// Unaudited apps can only Direct Post with SELF_ONLY (private) visibility;
// "upload to inbox" (draft) works for every app. TikTok audit lifts this.

import crypto from 'crypto';
import fs from 'fs';
import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export const TIKTOK_API = 'https://open.tiktokapis.com';

export class TikTokConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'tiktok',
      name: 'TikTok',
      authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      clientId: process.env.TIKTOK_CLIENT_KEY || '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
      scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.upload', 'video.publish'],
      usePkce: true,
      useOfflineAccess: false,
      callbackPort: 19431,
      callbackPath: '/auth/callback/tiktok',
      revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    };
    super(cfg, configDir);
  }

  /** TikTok desktop PKCE uses hex(SHA256(verifier)), not base64url. */
  protected generateChallenge(v: string): string {
    return crypto.createHash('sha256').update(v).digest('hex');
  }

  protected decorateAuthParams(params: URLSearchParams): void {
    const id = params.get('client_id');
    params.delete('client_id');
    if (id) params.set('client_key', id);
    const scope = params.get('scope');
    if (scope) params.set('scope', scope.split(/\s+/).join(','));
  }

  protected decorateTokenBody(body: URLSearchParams): void {
    const id = body.get('client_id');
    body.delete('client_id');
    if (id) body.set('client_key', id);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    if (data?.error && data.error !== 'ok') throw new Error(`TikTok token error: ${data.error_description || data.error}`);
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 86400) * 1000,
      scope: String(data.scope || '').replace(/,/g, ' '),
      account_id: data.open_id,
    };
    try {
      const info = await this.call('GET', '/v2/user/info/?fields=open_id,display_name,username', undefined, tokens.access_token);
      const u = info?.data?.user || {};
      tokens.account_email = u.username ? `@${u.username}` : u.display_name;
    } catch { /* identity is cosmetic */ }
    return tokens;
  }

  protected async buildManualTokens(accessToken: string): Promise<ConnectorTokens> {
    const info = await this.call('GET', '/v2/user/info/?fields=open_id,display_name,username', undefined, accessToken);
    const u = info?.data?.user || {};
    return { access_token: accessToken, expires_at: Date.now() + 23 * 3600 * 1000, account_id: u.open_id, account_email: u.username ? `@${u.username}` : u.display_name };
  }

  /** JSON call against open.tiktokapis.com; TikTok reports errors in body.error.code. */
  async call(method: 'GET' | 'POST', path: string, body?: unknown, tokenOverride?: string): Promise<any> {
    const token = tokenOverride || await this.getValidAccessToken();
    const res = await fetch(`${TIKTOK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    const code = json?.error?.code;
    if (!res.ok || (code && code !== 'ok')) {
      throw new Error(`TikTok API ${method} ${path.split('?')[0]} failed (${res.status}${code ? `, ${code}` : ''}): ${json?.error?.message || 'unknown error'}`);
    }
    return json;
  }

  getUser(): Promise<any> {
    return this.call('GET', '/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count');
  }

  listVideos(maxCount = 20, cursor?: number): Promise<any> {
    return this.call('POST', '/v2/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count', { max_count: Math.min(maxCount, 20), ...(cursor ? { cursor } : {}) });
  }

  creatorInfo(): Promise<any> {
    return this.call('POST', '/v2/post/publish/creator_info/query/', {});
  }

  publishStatus(publishId: string): Promise<any> {
    return this.call('POST', '/v2/post/publish/status/fetch/', { publish_id: publishId });
  }

  /**
   * Upload a local video. mode=direct posts it (needs video.publish; privacy
   * must be one of creator_info privacy_level_options); mode=draft sends it
   * to the creator's TikTok inbox to finish in the app (video.upload).
   */
  async uploadVideo(filePath: string, opts: { mode: 'direct' | 'draft'; title?: string; privacy_level?: string; disable_comment?: boolean; disable_duet?: boolean; disable_stitch?: boolean; video_cover_timestamp_ms?: number; brand_content_toggle?: boolean; brand_organic_toggle?: boolean; is_aigc?: boolean }): Promise<{ publish_id: string; privacy_level?: string }> {
    const size = fs.statSync(filePath).size;
    const MB = 1024 * 1024;
    const chunkSize = size < 5 * MB ? size : 10 * MB;
    const totalChunks = size < 5 * MB ? 1 : Math.floor(size / chunkSize);
    const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks };
    let init: any;
    let privacy: string | undefined;
    if (opts.mode === 'direct') {
      const creator = (await this.creatorInfo())?.data || {};
      const options: string[] = creator.privacy_level_options || [];
      privacy = opts.privacy_level || (options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0]);
      if (options.length && privacy && !options.includes(privacy)) throw new Error(`privacy_level ${privacy} is not allowed for this account. Allowed: ${options.join(', ')}. Unaudited TikTok apps can only post SELF_ONLY.`);
      init = await this.call('POST', '/v2/post/publish/video/init/', {
        post_info: {
          title: opts.title || '',
          privacy_level: privacy,
          disable_comment: opts.disable_comment ?? false,
          disable_duet: opts.disable_duet ?? false,
          disable_stitch: opts.disable_stitch ?? false,
          video_cover_timestamp_ms: opts.video_cover_timestamp_ms ?? 1000,
          brand_content_toggle: opts.brand_content_toggle ?? false,
          brand_organic_toggle: opts.brand_organic_toggle ?? false,
          is_aigc: opts.is_aigc ?? false,
        },
        source_info,
      });
    } else {
      init = await this.call('POST', '/v2/post/publish/inbox/video/init/', { source_info });
    }
    const uploadUrl = init?.data?.upload_url;
    const publishId = init?.data?.publish_id;
    if (!uploadUrl || !publishId) throw new Error('TikTok did not return an upload URL.');
    const fd = fs.openSync(filePath, 'r');
    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
        const buf = Buffer.alloc(end - start + 1);
        fs.readSync(fd, buf, 0, buf.length, start);
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
          body: buf,
        });
        if (res.status !== 201 && res.status !== 206) throw new Error(`TikTok upload chunk ${i + 1}/${totalChunks} failed (HTTP ${res.status}).`);
      }
    } finally {
      fs.closeSync(fd);
    }
    return { publish_id: publishId, privacy_level: privacy };
  }
}
