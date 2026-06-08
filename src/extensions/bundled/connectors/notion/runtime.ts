// Native Notion connector runtime. See §23B. Auth stays in NotionConnector.
import type { NotionConnector } from '../../../../integrations/connectors/notion.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'notion';
const NAME = 'Notion';
const tools = ['connector_notion_search', 'connector_notion_get_page', 'connector_notion_create_page', 'connector_notion_query_database'];

async function withConn(fn: (c: NotionConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<NotionConnector>(ID);
  if (!c) return toolError(`${NAME} is unavailable.`);
  return fn(c);
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID, name: NAME, authType: 'oauth', capabilities: ['drive'], toolNames: tools,
      isConnected: () => connectorConnected(ID), hasCredentials: () => connectorHasCredentials(ID),
      describeStatus: () => (connectorConnected(ID) ? 'connected' : 'not connected'),
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
