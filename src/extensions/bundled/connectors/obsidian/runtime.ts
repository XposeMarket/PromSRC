// Native Obsidian connector runtime. See §23B. Obsidian is a LOCAL bridge (no
// OAuth/connector class) — connection state derives from configured vaults, and
// execution calls the bridge directly.
import {
  loadObsidianBridgeState,
  syncObsidianVaults,
  upsertObsidianVault,
  writePrometheusNoteToObsidian,
} from '../../../../gateway/obsidian/bridge.js';
import type { PrometheusExtensionApi, PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { notConnected, toolError, toolOk } from '../_runtime/connector-helpers.js';

const ID = 'obsidian';
const NAME = 'Obsidian';
const tools = ['connector_obsidian_status', 'connector_obsidian_connect_vault', 'connector_obsidian_sync', 'connector_obsidian_writeback'];

function obsidianConnected(): boolean {
  try {
    return loadObsidianBridgeState().vaults.some((v) => v.enabled !== false);
  } catch {
    return false;
  }
}

function vaultCount(): number {
  try {
    return loadObsidianBridgeState().vaults.length;
  } catch {
    return 0;
  }
}

const ext: PrometheusExtensionDefinition = {
  id: ID,
  register(api: PrometheusExtensionApi) {
    api.registerConnector({
      id: ID,
      name: NAME,
      authType: 'none',
      capabilities: ['memory-source', 'drive'],
      toolNames: tools,
      isConnected: () => obsidianConnected(),
      hasCredentials: () => vaultCount() > 0,
      describeStatus: () => `${vaultCount()} vault(s)`,
    });

    api.registerTool({
      name: 'connector_obsidian_status',
      description: '[Obsidian] Show configured local vaults, bridge modes, and last sync stats.',
      parameters: { type: 'object', required: [], properties: {} },
      connectorId: ID,
      capability: 'memory-source',
      execute: async () => toolOk(loadObsidianBridgeState()),
    });

    api.registerTool({
      name: 'connector_obsidian_connect_vault',
      description: '[Obsidian] Connect a local Obsidian vault folder to Prometheus. Defaults to read-only indexing.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute path to the local Obsidian vault folder.' },
          name: { type: 'string', description: 'Optional display name for the vault.' },
          mode: { type: 'string', enum: ['read_only', 'assisted', 'full'], description: 'Bridge mode. read_only indexes only; assisted/full allow writeback.' },
          include: { type: 'array', items: { type: 'string' }, description: 'Optional glob list. Default: **/*.md' },
          exclude: { type: 'array', items: { type: 'string' }, description: 'Optional glob list. Default excludes .obsidian, trash, and node_modules.' },
          writeback_folder: { type: 'string', description: 'Folder inside the vault where Prometheus writes notes in assisted/full mode.' },
          sync_now: { type: 'boolean', description: 'If true, sync immediately after connecting. Default true.' },
        },
      },
      connectorId: ID,
      capability: 'memory-source',
      execute: async (args: any) => {
        const vaultPath = String(args.path || '').trim();
        if (!vaultPath) return toolError('connector_obsidian_connect_vault: path is required');
        const vault = upsertObsidianVault({
          path: vaultPath,
          name: args.name ? String(args.name).trim() : undefined,
          mode: args.mode === 'full' || args.mode === 'assisted' ? args.mode : 'read_only',
          include: Array.isArray(args.include) ? args.include.map((v: any) => String(v || '').trim()).filter(Boolean) : undefined,
          exclude: Array.isArray(args.exclude) ? args.exclude.map((v: any) => String(v || '').trim()).filter(Boolean) : undefined,
          writebackFolder: args.writeback_folder ? String(args.writeback_folder).trim() : undefined,
          enabled: true,
        });
        const sync = args.sync_now === false ? null : syncObsidianVaults({ vaultId: vault.id, force: true });
        return toolOk({ vault, sync });
      },
    });

    api.registerTool({
      name: 'connector_obsidian_sync',
      description: '[Obsidian] Sync configured Obsidian vault notes into Prometheus memory and refresh the memory index.',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          vault_id: { type: 'string', description: 'Optional vault id to sync. Omit to sync every enabled vault.' },
          force: { type: 'boolean', description: 'Force reindex unchanged notes. Default true.' },
        },
      },
      connectorId: ID,
      capability: 'memory-source',
      execute: async (args: any) => {
        const state = loadObsidianBridgeState();
        if (!state.vaults.length) return notConnected(NAME);
        return toolOk(syncObsidianVaults({ vaultId: args.vault_id ? String(args.vault_id).trim() : undefined, force: args.force !== false }));
      },
    });

    api.registerTool({
      name: 'connector_obsidian_writeback',
      description: '[Obsidian] Write a Prometheus-generated Markdown note into an Obsidian vault in assisted/full mode.',
      parameters: {
        type: 'object',
        required: ['vault_id', 'title', 'content'],
        properties: {
          vault_id: { type: 'string', description: 'Vault id from connector_obsidian_status.' },
          title: { type: 'string', description: 'Note title.' },
          content: { type: 'string', description: 'Markdown note content to write.' },
          folder: { type: 'string', description: 'Optional folder inside the vault. Defaults to the vault writeback folder.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional extra tags.' },
          source_record_id: { type: 'string', description: 'Optional Prometheus memory record id for traceability.' },
        },
      },
      connectorId: ID,
      capability: 'memory-source',
      execute: async (args: any) => {
        const vaultId = String(args.vault_id || '').trim();
        const title = String(args.title || '').trim();
        const content = String(args.content || '').trim();
        if (!vaultId) return toolError('connector_obsidian_writeback: vault_id is required');
        if (!title) return toolError('connector_obsidian_writeback: title is required');
        if (!content) return toolError('connector_obsidian_writeback: content is required');
        return toolOk(writePrometheusNoteToObsidian({
          vaultId,
          title,
          content,
          folder: args.folder ? String(args.folder).trim() : undefined,
          tags: Array.isArray(args.tags) ? args.tags.map((v: any) => String(v || '').trim()).filter(Boolean) : undefined,
          sourceRecordId: args.source_record_id ? String(args.source_record_id).trim() : undefined,
        }));
      },
    });
  },
};

export default ext;
