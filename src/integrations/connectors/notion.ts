// src/integrations/connectors/notion.ts
// Notion OAuth connector.
//
// SETUP REQUIRED:
//   1. https://www.notion.so/my-integrations → New integration → Public
//   2. Set Redirect URI: http://localhost:19423/auth/callback/notion
//   3. Set env vars: NOTION_CLIENT_ID and NOTION_CLIENT_SECRET

import { OAuthConnector, OAuthConnectorConfig, ConnectorTokens } from '../oauth-base.js';

export const NOTION_VERSION = '2022-06-28';

const rt = (content: string) => [{ type: 'text', text: { content: content.slice(0, 2000) } }];

/** Minimal markdown -> Notion blocks: #/##/### headings, -/* bullets, 1. numbered, [ ]/[x] todos, > quotes, ``` code. */
export function markdownToBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'plain text';
      const body: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i]);
      blocks.push({ object: 'block', type: 'code', code: { rich_text: rt(body.join('\n')), language: lang } });
      continue;
    }
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { const t = `heading_${m[1].length}`; blocks.push({ object: 'block', type: t, [t]: { rich_text: rt(m[2]) } }); continue; }
    if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) { blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: rt(m[2]), checked: m[1].toLowerCase() === 'x' } }); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(m[1]) } }); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rt(m[1]) } }); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { blocks.push({ object: 'block', type: 'quote', quote: { rich_text: rt(m[1]) } }); continue; }
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(line) } });
  }
  return blocks.slice(0, 100);
}

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
      useOfflineAccess: false,
      tokenAuthMethod: 'basic',
      callbackPort: 19423,
      callbackPath: '/auth/callback/notion',
    };
    super(cfg, configDir);
  }

  protected async buildTokens(data: Record<string, any>): Promise<ConnectorTokens> {
    return {
      access_token: data.access_token,
      expires_at: Number.MAX_SAFE_INTEGER, // Notion public-connection tokens do not expose a refresh expiry.
      account_email: data.owner?.user?.person?.email,
      account_id: data.owner?.user?.id,
      resource_id: data.workspace_id,
      resource_name: data.workspace_name,
      resource_kind: 'workspace',
    };
  }

  /** Internal integration secret (ntn_/secret_) from notion.so/profile/integrations. Never expires. */
  protected async buildManualTokens(accessToken: string): Promise<ConnectorTokens> {
    const res = await fetch('https://api.notion.com/v1/users/me', { headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': NOTION_VERSION } });
    const me: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion rejected the integration secret: ${me?.message || `HTTP ${res.status}`}`);
    return {
      access_token: accessToken,
      expires_at: Number.MAX_SAFE_INTEGER,
      account_id: me?.bot?.owner?.user?.id || me?.id,
      account_email: me?.bot?.workspace_name ? `${me.name || 'Integration'} (${me.bot.workspace_name})` : me?.name,
      resource_name: me?.bot?.workspace_name,
      resource_kind: 'workspace',
    };
  }

  hasCredentials(): boolean {
    return super.hasCredentials() || Boolean(this.loadTokens()?.access_token);
  }

  async getCurrentUser(): Promise<any> {
    return this.notionGet('/users/me');
  }

  private async notionGet(path: string): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  private async notionPost(path: string, body: any, method: 'POST' | 'PATCH' = 'POST'): Promise<any> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  async searchPages(query: string, pageSize = 20, kind: 'page' | 'database' | 'all' = 'page'): Promise<any[]> {
    const body: any = { query, page_size: pageSize };
    if (kind !== 'all') body.filter = { property: 'object', value: kind };
    const data = await this.notionPost('/search', body);
    return data.results || [];
  }

  /** Append paragraphs/headings/bullets/todos (markdown-ish lines) to a page or block. */
  async appendText(blockId: string, markdown: string): Promise<any> {
    return this.notionPost(`/blocks/${blockId}/children`, { children: markdownToBlocks(markdown) }, 'PATCH');
  }

  async updatePage(pageId: string, patch: { properties?: Record<string, any>; archived?: boolean; icon?: any; title?: string }): Promise<any> {
    const body: any = {};
    if (patch.properties) body.properties = patch.properties;
    if (patch.title) body.properties = { ...(body.properties || {}), title: { title: [{ type: 'text', text: { content: patch.title } }] } };
    if (typeof patch.archived === 'boolean') body.archived = patch.archived;
    if (patch.icon) body.icon = patch.icon;
    return this.notionPost(`/pages/${pageId}`, body, 'PATCH');
  }

  async addComment(pageId: string, text: string): Promise<any> {
    return this.notionPost('/comments', { parent: { page_id: pageId }, rich_text: [{ type: 'text', text: { content: text } }] });
  }

  async listComments(blockId: string): Promise<any[]> {
    const data = await this.notionGet(`/comments?block_id=${encodeURIComponent(blockId)}`);
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
    const children = content ? markdownToBlocks(content) : [];
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
