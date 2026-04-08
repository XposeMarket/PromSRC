// src/integrations/connectors/slack.ts
// Slack OAuth connector.
//
// SETUP REQUIRED:
//   1. Go to https://api.slack.com/apps → Create New App → From scratch
//   2. OAuth & Permissions → Add scopes: channels:history, channels:read,
//      chat:write, users:read, search:read, files:read
//   3. Install to workspace → copy Bot Token
//   4. For user OAuth: OAuth & Permissions → Redirect URLs → add http://localhost:19421/auth/callback/slack
//   5. Set env vars: SLACK_CLIENT_ID and SLACK_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class SlackConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'slack',
      name: 'Slack',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      clientId: process.env.SLACK_CLIENT_ID || '',
      clientSecret: process.env.SLACK_CLIENT_SECRET || '',
      scopes: ['channels:history', 'channels:read', 'chat:write', 'users:read', 'search:read', 'files:read', 'im:history'],
      usePkce: false,
      callbackPort: 19421,
      callbackPath: '/auth/callback/slack',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    // Slack returns the token nested under authed_user or at top-level
    const accessToken = data.authed_user?.access_token || data.access_token;
    const email = data.authed_user?.id;
    return {
      access_token: accessToken,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : Date.now() + 365 * 24 * 60 * 60 * 1000,
      account_email: data.authed_user?.email,
      account_id: email,
    };
  }

  async postMessage(channel: string, text: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    });
    return res.json();
  }

  async listChannels(): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://slack.com/api/conversations.list?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as any;
    return data.channels || [];
  }
}
