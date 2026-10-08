// Native Notion connector runtime. See §23B. Auth stays in NotionConnector.
import type { NotionConnector } from '../../../../integrations/connectors/notion.js';
import { NOTION_VERSION } from '../../../../integrations/connectors/notion.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorStatusLabel, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';
import { registerConnectorApiRequestTool } from '../_runtime/api-request.js';

const ID = 'notion';
const NAME = 'Notion';
const tools = ['connector_notion_search', 'connector_notion_get_page', 'connector_notion_create_page', 'connector_notion_query_database', 'connector_notion_append_content', 'connector_notion_update_page', 'connector_notion_create_database_entry', 'connector_notion_add_comment', 'connector_notion_list_comments', 'connector_notion_api_request'];
const READ = { readOnly: true, localWrite: false, externalWrite: false, destructive: false, credentialUse: true, known: true } as const;
const WRITE = { readOnly: false, localWrite: false, externalWrite: true, destructive: false, credentialUse: true, known: true } as const;

async function withConn(fn: (c: NotionConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<NotionConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  try { return await fn(c); } catch (err: any) { return toolError(err?.message || String(err)); }
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['drive'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => connectorStatusLabel(ID),
    });

    registerConnectorApiRequestTool<NotionConnector>(api, {
      connectorId: 'notion', displayName: 'Notion',
      bases: { notion: 'https://api.notion.com' },
      headers: { 'Notion-Version': NOTION_VERSION },
      examplePath: '/v1/blocks/BLOCK_ID/children',
      coverageHint: 'append/update blocks, update pages and properties, databases, comments, users',
    });

    api.registerTool({
      name: 'connector_notion_search',
      description: '[Notion] Search pages and databases in the connected Notion workspace.',
      parameters: { type: 'object', required: [], properties: { query: { type: 'string', description: 'Search query (leave empty to list all)' }, page_size: { type: 'number', description: 'Number of results (default: 20)' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const pages = await c.searchPages(args.query || '', args.page_size || 20);
        if (!pages.length) return toolOk('No pages found.');
        return toolOk(pages.map((p: any) => {
          const title = p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || '(untitled)';
          return `${p.id}: ${title} (${p.object}, last edited: ${p.last_edited_time?.slice(0, 10)})`;
        }).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_notion_get_page',
      description: '[Notion] Get a Notion page with its properties and block content.',
      parameters: { type: 'object', required: ['page_id'], properties: { page_id: { type: 'string', description: 'Notion page ID (UUID from search results)' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const page = await c.getPage(args.page_id);
        const blocks = await c.getPageBlocks(args.page_id);
        const title = (page as any).properties?.title?.title?.[0]?.plain_text || '(untitled)';
        const content = blocks.map((b: any) => b[b.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '').filter(Boolean).join('\n');
        return toolOk(`# ${title}\n\n${content || '(no text content)'}`);
      }),
    });

    api.registerTool({
      name: 'connector_notion_append_content',
      description: '[Notion] Append content to an existing page (or block). Markdown-style lines become blocks: # headings, - bullets, 1. numbered, - [ ] todos, > quotes, ``` code.',
      parameters: { type: 'object', required: ['page_id', 'content'], properties: { page_id: { type: 'string', description: 'Page or block id' }, content: { type: 'string' } } },
      connectorId: ID, capability: 'drive', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => { const r = await c.appendText(args.page_id, args.content); return toolOk(`Appended ${(r as any)?.results?.length ?? 0} block(s) to ${args.page_id}.`); }),
    });

    api.registerTool({
      name: 'connector_notion_update_page',
      description: '[Notion] Update a page: rename (title), set database properties (Notion property-value objects), set an emoji icon, or archive/restore it.',
      parameters: { type: 'object', required: ['page_id'], properties: { page_id: { type: 'string' }, title: { type: 'string' }, properties: { type: 'object', description: 'e.g. {"Status":{"select":{"name":"Done"}}}' }, icon_emoji: { type: 'string' }, archived: { type: 'boolean' } } },
      connectorId: ID, capability: 'drive', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => {
        const page = await c.updatePage(args.page_id, { title: args.title, properties: args.properties, archived: args.archived, icon: args.icon_emoji ? { type: 'emoji', emoji: args.icon_emoji } : undefined });
        return toolOk(`Updated ${(page as any).id}${args.archived ? ' (archived)' : ''}.`);
      }),
    });

    api.registerTool({
      name: 'connector_notion_create_database_entry',
      description: '[Notion] Add a row to a database. properties uses Notion property-value objects keyed by column name, e.g. {"Name":{"title":[{"text":{"content":"Lead"}}]},"Status":{"select":{"name":"New"}}}. Optional content becomes the row page body.',
      parameters: { type: 'object', required: ['database_id', 'properties'], properties: { database_id: { type: 'string' }, properties: { type: 'object' }, content: { type: 'string' } } },
      connectorId: ID, capability: 'drive', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => {
        const page = await c.createDatabaseEntry(args.database_id, args.properties);
        if (args.content) await c.appendText((page as any).id, args.content);
        return toolOk(`Row created: ${(page as any).id}\n${(page as any).url || ''}`);
      }),
    });

    api.registerTool({
      name: 'connector_notion_add_comment',
      description: '[Notion] Add a comment to a page (integration needs the Insert comments capability).',
      parameters: { type: 'object', required: ['page_id', 'text'], properties: { page_id: { type: 'string' }, text: { type: 'string' } } },
      connectorId: ID, capability: 'drive', sideEffects: WRITE,
      execute: (args: any) => withConn(async (c) => toolOk(`Comment added: ${(await c.addComment(args.page_id, args.text) as any).id}`)),
    });

    api.registerTool({
      name: 'connector_notion_list_comments',
      description: '[Notion] List unresolved comments on a page or block.',
      parameters: { type: 'object', required: ['block_id'], properties: { block_id: { type: 'string' } } },
      connectorId: ID, capability: 'drive', sideEffects: READ,
      execute: (args: any) => withConn(async (c) => {
        const rows = await c.listComments(args.block_id);
        if (!rows.length) return toolOk('No comments.');
        return toolOk(rows.map((r: any) => `${r.created_time?.slice(0, 16)} ${r.created_by?.id}: ${(r.rich_text || []).map((t: any) => t.plain_text).join('')}`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_notion_create_page',
      description: '[Notion] Create a new page inside an existing Notion page.',
      parameters: { type: 'object', required: ['parent_page_id', 'title'], properties: { parent_page_id: { type: 'string', description: 'Parent page ID to create the new page inside' }, title: { type: 'string', description: 'Page title' }, content: { type: 'string', description: 'Initial text content for the page body' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const page = await c.createPage(args.parent_page_id, args.title, args.content);
        return toolOk(`Page created: "${args.title}" — ID: ${(page as any).id}`);
      }),
    });

    api.registerTool({
      name: 'connector_notion_query_database',
      description: '[Notion] Query a Notion database with optional filters and sorting.',
      parameters: { type: 'object', required: ['database_id'], properties: { database_id: { type: 'string', description: 'Notion database ID' }, filter: { type: 'object', description: 'Notion filter object (see Notion API docs for filter syntax)' }, page_size: { type: 'number', description: 'Number of results (default: 20)' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const rows = await c.queryDatabase(args.database_id, args.filter, undefined, args.page_size || 20);
        if (!rows.length) return toolOk('No rows found.');
        return toolOk(rows.map((r: any) => {
          const props = Object.entries(r.properties || {}).map(([k, v]: [string, any]) => {
            const text = v.title?.[0]?.plain_text || v.rich_text?.[0]?.plain_text || v.select?.name || v.number || v.checkbox || '';
            return `${k}: ${text}`;
          }).join(' | ');
          return `${r.id}: ${props}`;
        }).join('\n'));
      }),
    });
  },
};

export default ext;
