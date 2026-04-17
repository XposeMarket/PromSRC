// src/integrations/connectors/reddit.ts
// Reddit OAuth connector.
//
// SETUP REQUIRED:
//   1. https://www.reddit.com/prefs/apps → Create App → script or web app
//   2. Redirect URI: http://localhost:19424/auth/callback/reddit
//   3. Set env vars: REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class RedditConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'reddit',
      name: 'Reddit',
      authUrl: 'https://www.reddit.com/api/v1/authorize',
      tokenUrl: 'https://www.reddit.com/api/v1/access_token',
      clientId: process.env.REDDIT_CLIENT_ID || '',
      clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
      scopes: ['identity', 'read', 'submit', 'history'],
      usePkce: false,
      callbackPort: 19424,
      callbackPath: '/auth/callback/reddit',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    const tokens: ConnectorTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    try {
      const res = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'Prometheus-CIS/1.0' },
      });
      if (res.ok) {
        const me = await res.json() as any;
        tokens.account_email = me.name;
        tokens.account_id = me.id;
      }
    } catch {}
    return tokens;
  }

  private async redditGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS/1.0' },
    });
    if (!res.ok) throw new Error(`Reddit API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async redditPost(path: string, body: Record<string, string>): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Prometheus-CIS/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) throw new Error(`Reddit API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async getMe(): Promise<any> {
    return this.redditGet('/api/v1/me');
  }

  async getSubredditPosts(subreddit: string, sort: 'hot' | 'new' | 'top' | 'rising' = 'hot', limit = 25): Promise<any[]> {
    const data = await this.redditGet(`/r/${subreddit}/${sort}?limit=${limit}`);
    return data?.data?.children?.map((c: any) => c.data) || [];
  }

  async searchPosts(query: string, subreddit?: string, sort: 'relevance' | 'new' | 'top' = 'relevance', limit = 25): Promise<any[]> {
    const sub = subreddit ? `/r/${subreddit}` : '';
    const params = new URLSearchParams({ q: query, sort, limit: String(limit), type: 'link' });
    const data = await this.redditGet(`${sub}/search?${params}`);
    return data?.data?.children?.map((c: any) => c.data) || [];
  }

  async getPostComments(subreddit: string, postId: string, limit = 20): Promise<any[]> {
    const data = await this.redditGet(`/r/${subreddit}/comments/${postId}?limit=${limit}`);
    if (Array.isArray(data) && data[1]) {
      return data[1]?.data?.children?.map((c: any) => c.data) || [];
    }
    return [];
  }

  async submitPost(subreddit: string, title: string, text: string): Promise<any> {
    return this.redditPost('/api/submit', {
      sr: subreddit,
      kind: 'self',
      title,
      text,
      resubmit: 'true',
    });
  }

  async getUserHistory(username?: string, limit = 25): Promise<any[]> {
    const path = username ? `/user/${username}/submitted` : '/user/me/submitted';
    const data = await this.redditGet(`${path}?limit=${limit}`);
    return data?.data?.children?.map((c: any) => c.data) || [];
  }
}
