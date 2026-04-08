// src/integrations/connectors/notion.ts
// Notion OAuth connector.
//
// SETUP REQUIRED:
//   1. https://www.notion.so/my-integrations → New integration → Public
//   2. Set Redirect URI: http://localhost:19423/auth/callback/notion
//   3. Set env vars: NOTION_CLIENT_ID and NOTION_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export class NotionConnector extends OAuthConnector {
  constructor(configDir: string) {
    const cfg: OAuthConnectorConfig = {
      id: 'notion',
      name: 'Notion',
      authUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      clientId: process.env.NOTION_CLIENT_ID || '',
      clientSecret: process.env.NOTION_CLIENT_SECRET || '',
      scopes: [], // Notion doesn't use scope param
      usePkce: false,
      callbackPort: 19423,
      callbackPath: '/auth/callback/notion',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return {
      access_token: data.access_token,
      expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000, // Notion tokens don't expire
      account_email: data.owner?.user?.person?.email,
      account_id: data.owner?.user?.id,
    };
  }

  // Notion token exchange requires Basic auth with client_id:client_secret
  protected callbackUrl(): string {
    return `http://localhost:${this.cfg.callbackPort}${this.cfg.callbackPath}`;
  }

  async searchPages(query: string): Promise<any[]> {
    const token = await this.getValidAccessToken();
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ query, page_size: 20 }),
    });
    const data = await res.json() as any;
    return data.results || [];
  }
}
