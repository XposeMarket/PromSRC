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

  private async notionGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async notionPost(path: string, body: any): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async searchPages(query: string, pageSize = 20): Promise<any[]> {
    const data = await this.notionPost('/search', { query, page_size: pageSize, filter: { property: 'object', value: 'page' } });
    return data.results || [];
  }

  async searchDatabases(query: string, pageSize = 20): Promise<any[]> {
    const data = await this.notionPost('/search', { query, page_size: pageSize, filter: { property: 'object', value: 'database' } });
    return data.results || [];
  }

  async getPage(pageId: string): Promise<any> {
    return this.notionGet(`/pages/${pageId}`);
  }

  async getPageBlocks(pageId: string): Promise<any[]> {
    const data = await this.notionGet(`/blocks/${pageId}/children`);
    return data.results || [];
  }

  async createPage(parentPageId: string, title: string, content?: string): Promise<any> {
    const children = content ? [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content } }] },
    }] : [];
    return this.notionPost('/pages', {
      parent: { page_id: parentPageId },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children,
    });
  }

  async queryDatabase(databaseId: string, filter?: any, sorts?: any[], pageSize = 20): Promise<any[]> {
    const body: any = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const data = await this.notionPost(`/databases/${databaseId}/query`, body);
    return data.results || [];
  }

  async createDatabaseEntry(databaseId: string, properties: Record<string, any>): Promise<any> {
    return this.notionPost('/pages', {
      parent: { database_id: databaseId },
      properties,
    });
  }
}
