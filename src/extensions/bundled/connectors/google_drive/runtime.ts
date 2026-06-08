// Native Google Drive connector runtime. See §23B. Auth stays in GoogleDriveConnector.
import type { GoogleDriveConnector } from '../../../../integrations/connectors/google-drive.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition, PrometheusToolExecutionResult } from '../../../runtime-api.js';
import { connectorConnected, connectorHasCredentials, getLiveConnector, notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'google_drive';
const NAME = 'Google Drive';
const tools = ['connector_gdrive_list_files', 'connector_gdrive_get_file', 'connector_gdrive_read_file', 'connector_gdrive_search'];

async function withConn(fn: (c: GoogleDriveConnector) => Promise<PrometheusToolExecutionResult>): Promise<PrometheusToolExecutionResult> {
  if (!connectorConnected(ID)) return notConnected(NAME);
  const c = getLiveConnector<GoogleDriveConnector>(ID);
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
      name: 'connector_gdrive_list_files',
      description: '[Google Drive] List files in the connected Google Drive.',
      parameters: { type: 'object', required: [], properties: { query: { type: 'string', description: 'Drive search query (e.g., "mimeType=\'application/pdf\'", "name contains \'report\'", "modifiedTime > \'2024-01-01\'")' }, page_size: { type: 'number', description: 'Number of files (default: 20)' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const files = await c.listFiles(args.query || '', args.page_size || 20);
        if (!files.length) return toolOk('No files found.');
        return toolOk(files.map((f: any) => `${f.id}: ${f.name} (${f.mimeType?.split('.').pop()}, modified: ${f.modifiedTime?.slice(0, 10)})`).join('\n'));
      }),
    });

    api.registerTool({
      name: 'connector_gdrive_get_file',
      description: '[Google Drive] Get metadata for a specific file (name, type, size, link, owner).',
      parameters: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'string', description: 'Google Drive file ID' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => toolOk(await c.getFile(args.file_id))),
    });

    api.registerTool({
      name: 'connector_gdrive_read_file',
      description: '[Google Drive] Read the text content of a file (Google Docs exported as plain text, or raw text files). Not for binary files.',
      parameters: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'string', description: 'Google Drive file ID' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const content = await c.readFileContent(args.file_id);
        return toolOk(content.slice(0, 10000) + (content.length > 10000 ? '\n\n[...truncated at 10,000 chars]' : ''));
      }),
    });

    api.registerTool({
      name: 'connector_gdrive_search',
      description: '[Google Drive] Search for files by name or content in Google Drive.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Search query — searches file names and content' }, page_size: { type: 'number', description: 'Number of results (default: 20)' } } },
      connectorId: ID, capability: 'drive',
      execute: (args: any) => withConn(async (c) => {
        const files = await c.searchFiles(args.query, args.page_size || 20);
        if (!files.length) return toolOk('No files found matching that query.');
        return toolOk(files.map((f: any) => `${f.id}: ${f.name} (${f.mimeType?.split('.').pop()}, ${f.webViewLink})`).join('\n'));
      }),
    });
  },
};

export default ext;
