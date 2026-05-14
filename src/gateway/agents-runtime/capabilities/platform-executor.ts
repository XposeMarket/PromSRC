import { getMCPManager } from '../../mcp-manager';
import { buildConnectorStatus } from '../../tool-builder';
import { handleConnectorTool } from '../../tools/handlers/connector-handlers';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import type { ToolResult } from '../../tool-builder';

const PLATFORM_TOOL_NAMES = new Set([
  'mcp_server_manage',
  'connector_list',
  'create_composite',
  'get_composite',
  'edit_composite',
  'delete_composite',
  'list_composites',
]);

function isPlatformToolName(name: string): boolean {
  if (PLATFORM_TOOL_NAMES.has(name)) return true;
  if (name.startsWith('mcp__')) return true;
  if (name.startsWith('connector_')) return true;
  try {
    const { loadComposites } = require('../../tools/composite-tools');
    return loadComposites().has(name);
  } catch {
    return false;
  }
}

export const platformCapabilityExecutor: CapabilityExecutor = {
  id: 'platform',

  canHandle(name: string): boolean {
    return isPlatformToolName(name);
  },

  async execute(ctx: CapabilityExecutionContext): Promise<ToolResult> {
    const { name, args, workspacePath, deps, sessionId } = ctx;

    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      if (parts.length >= 3) {
        const serverId = parts[1];
        const toolName = parts.slice(2).join('__');
        try {
          const mcpResult = await getMCPManager().callTool(serverId, toolName, args ?? {});
          const text = mcpResult.content
            .map((c: any) => c.text || c.data || '')
            .join('\n')
            .trim();
          return { name, args, result: text || '(empty result)', error: !!mcpResult.isError };
        } catch (mcpErr: any) {
          return { name, args, result: `MCP error (${serverId}/${toolName}): ${mcpErr.message}`, error: true };
        }
      }
    }

    if (name === 'mcp_server_manage') {
      try {
        const mcpMgr = getMCPManager();
        const action = String(args.action || 'list').trim().toLowerCase();

        if (action === 'list' || action === 'status') {
          const allStatuses = mcpMgr.getStatus();
          const configs = mcpMgr.getConfigs();
          const servers = allStatuses.map((s: any) => {
            const cfg = configs.find((c: any) => c.id === s.id);
            return {
              id: s.id,
              name: s.name,
              enabled: s.enabled,
              transport: cfg?.transport || 'unknown',
              url: cfg?.url,
              command: cfg?.command,
              status: s.status,
              tools: s.tools,
              toolNames: s.toolNames || [],
              error: s.error,
              description: cfg?.description,
            };
          });
          const connected = servers.filter((s: any) => s.status === 'connected').length;
          const disconnected = servers.filter((s: any) => s.status === 'disconnected' || s.status === 'error').length;
          const lines = [
            `MCP Servers: ${servers.length} total | ${connected} connected | ${disconnected} not connected`,
            '',
            ...servers.map((s: any) => {
              const statusIcon = s.status === 'connected' ? '[connected]' : s.status === 'error' ? '[error]' : '[disconnected]';
              const toolStr = s.tools > 0 ? ` [${s.tools} tools: ${s.toolNames.slice(0, 5).join(', ')}${s.tools > 5 ? '...' : ''}]` : ' [no tools]';
              const errorStr = s.error ? ` - Error: ${s.error}` : '';
              const endpointStr = s.url ? ` (${s.url})` : s.command ? ` (${s.command})` : '';
              return `${statusIcon} ${s.id} (${s.name})${endpointStr} - ${s.status}${toolStr}${errorStr}`;
            }),
          ];
          return { name, args, result: lines.join('\n'), error: false };
        }

        if (action === 'connect') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'connect requires id', error: true };
          const configs = mcpMgr.getConfigs();
          const cfg = configs.find((c: any) => c.id === id);
          if (!cfg) return { name, args, result: `No saved config for server "${id}". Use mcp_server_manage(action:"list") to see available servers.`, error: true };
          const result = await mcpMgr.connect(id);
          if (result.success) {
            const toolNames = (result.tools || []).map((t: any) => t.name);
            return {
              name,
              args,
              result: `Connected to "${id}" - ${toolNames.length} tool(s) available: ${toolNames.join(', ') || '(none)'}`,
              error: false,
            };
          }
          return { name, args, result: `Failed to connect "${id}": ${result.error}`, error: true };
        }

        if (action === 'disconnect') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'disconnect requires id', error: true };
          await mcpMgr.disconnect(id);
          return { name, args, result: `Disconnected "${id}"`, error: false };
        }

        if (action === 'list_tools') {
          const id = String(args.id || '').trim();
          if (id) {
            const statuses = mcpMgr.getStatus();
            const s = statuses.find((st: any) => st.id === id);
            if (!s) return { name, args, result: `Server "${id}" not found`, error: true };
            if (s.status !== 'connected') return { name, args, result: `Server "${id}" is ${s.status} - connect it first`, error: true };
            return { name, args, result: `Tools for "${id}" (${s.tools}):\n${(s.toolNames || []).join('\n')}`, error: false };
          }
          const allTools = mcpMgr.getAllTools();
          if (!allTools.length) return { name, args, result: 'No MCP tools available - no servers connected.', error: false };
          const lines = allTools.map((t: any) => `mcp__${t.serverId}__${t.name}: ${t.description || '(no description)'}`);
          return { name, args, result: `All MCP tools (${allTools.length}):\n${lines.join('\n')}`, error: false };
        }

        if (action === 'delete') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'delete requires id', error: true };
          if (!args.confirm) return { name, args, result: `Set confirm:true to delete server "${id}"`, error: true };
          const ok = mcpMgr.deleteConfig(id);
          return { name, args, result: ok ? `Deleted server config "${id}"` : `Server "${id}" not found`, error: !ok };
        }

        if (action === 'upsert') {
          const id = String(args.id || args.config?.id || '').trim();
          if (!id) return { name, args, result: 'upsert requires id', error: true };
          const cfg = args.config || {
            id,
            name: args.name || id,
            enabled: args.enabled !== false,
            transport: args.transport || args.type || 'stdio',
            command: args.command,
            args: args.args,
            env: args.env,
            url: args.url,
            headers: args.headers,
            description: args.description,
          };
          mcpMgr.upsertConfig(cfg);
          let msg = `Saved MCP server config "${id}"`;
          if (args.connect) {
            const r = await mcpMgr.connect(id);
            msg += r.success
              ? ` and connected (${(r.tools || []).length} tools)`
              : ` but connection failed: ${r.error}`;
          }
          return { name, args, result: msg, error: false };
        }

        if (action === 'import') {
          const raw = args.json;
          if (!raw) return { name, args, result: 'import requires json', error: true };
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const servers = parsed?.mcpServers || parsed;
          if (typeof servers !== 'object' || Array.isArray(servers)) {
            return { name, args, result: 'import: expected {mcpServers:{...}} or object of server configs', error: true };
          }
          const imported: string[] = [];
          for (const [id, cfg] of Object.entries(servers)) {
            try {
              mcpMgr.upsertConfig({ id, ...(cfg as any) });
              imported.push(id);
            } catch {}
          }
          if (args.connect) await mcpMgr.startEnabledServers();
          return { name, args, result: `Imported ${imported.length} server(s): ${imported.join(', ')}`, error: false };
        }

        if (action === 'start_enabled') {
          await mcpMgr.startEnabledServers();
          const statuses = mcpMgr.getStatus();
          const connected = statuses.filter((s: any) => s.status === 'connected');
          return {
            name,
            args,
            result: `start_enabled complete - ${connected.length}/${statuses.length} servers now connected:\n` +
              connected.map((s: any) => `  ${s.id}: ${s.tools} tools`).join('\n'),
            error: false,
          };
        }

        return { name, args, result: `Unknown mcp_server_manage action: "${action}". Valid: list, status, connect, disconnect, delete, upsert, import, list_tools, start_enabled`, error: true };
      } catch (err: any) {
        return { name, args, result: `mcp_server_manage error: ${err.message}`, error: true };
      }
    }

    if (name === 'connector_list') {
      return { name, args, result: buildConnectorStatus(), error: false };
    }

    if (name.startsWith('connector_') && name !== 'connector_list') {
      const connResult = await handleConnectorTool(name, args);
      return { name, args, ...connResult };
    }

    const { loadComposites, saveComposite, deleteComposite, executeComposite } = await import('../../tools/composite-tools');

    if (name === 'create_composite') {
      const cName = String(args.name || '').trim().replace(/\s+/g, '_');
      if (!cName) return { name, args, result: 'name is required', error: true };
      if (!Array.isArray(args.steps) || !args.steps.length) return { name, args, result: 'steps array is required', error: true };
      saveComposite({
        name: cName,
        description: String(args.description || ''),
        parameters: args.parameters && typeof args.parameters === 'object' ? args.parameters : {},
        steps: args.steps,
      });
      return { name, args, result: `Composite "${cName}" saved with ${args.steps.length} step(s). It will appear as a callable tool next message.`, error: false };
    }

    if (name === 'get_composite') {
      const cName = String(args.name || '').trim();
      if (!cName) return { name, args, result: 'name is required', error: true };
      const existing = loadComposites().get(cName);
      if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
      return { name, args, result: JSON.stringify(existing, null, 2), error: false };
    }

    if (name === 'edit_composite') {
      const cName = String(args.name || '').trim();
      if (!cName) return { name, args, result: 'name is required', error: true };
      const composites = loadComposites();
      const existing = composites.get(cName);
      if (!existing) return { name, args, result: `Composite "${cName}" not found.`, error: true };
      const newName = args.new_name ? String(args.new_name).trim() : cName;
      const updated = {
        name: newName,
        description: args.description !== undefined ? String(args.description) : existing.description,
        parameters: args.parameters !== undefined ? args.parameters : existing.parameters,
        steps: Array.isArray(args.steps) ? args.steps : existing.steps,
      };
      if (newName !== cName) deleteComposite(cName);
      saveComposite(updated);
      const renamed = newName !== cName ? ` (renamed from "${cName}")` : '';
      return { name, args, result: `Composite "${newName}" updated${renamed}.`, error: false };
    }

    if (name === 'delete_composite') {
      const cName = String(args.name || '').trim();
      if (!cName) return { name, args, result: 'name is required', error: true };
      const removed = deleteComposite(cName);
      return { name, args, result: removed ? `Composite "${cName}" deleted.` : `Composite "${cName}" not found.`, error: !removed };
    }

    if (name === 'list_composites') {
      const composites = loadComposites();
      if (!composites.size) return { name, args, result: 'No composites defined yet.', error: false };
      const lines = Array.from(composites.values()).map(
        (c: any) => `- ${c.name} (${c.steps.length} steps) - ${c.description}`,
      );
      return { name, args, result: lines.join('\n'), error: false };
    }

    if (loadComposites().has(name)) {
      const result = await executeComposite(name, args, ctxExecuteToolBridge(workspacePath, deps, sessionId), workspacePath, deps, sessionId);
      return { name, args, result, error: false };
    }

    return { name, args, result: `Unhandled platform tool: ${name}`, error: true };
  },
};

function ctxExecuteToolBridge(workspacePath: string, deps: any, sessionId: string) {
  const { executeTool } = require('../subagent-executor');
  return (toolName: string, toolArgs: any) => executeTool(toolName, toolArgs, workspacePath, deps, sessionId);
}
