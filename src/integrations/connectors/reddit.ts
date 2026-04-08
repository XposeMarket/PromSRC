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
}
