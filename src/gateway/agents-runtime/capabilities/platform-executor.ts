import { getMCPManager } from '../../mcp-manager';
import { buildConnectorStatus } from '../../tool-builder';
import { ensurePrometheusExtensionRuntimeLoaded } from '../../../extensions/legacy-connector-adapter';
import { getExtensionRuntimeRegistry } from '../../../extensions/runtime-registry';
import type { CapabilityExecutionContext, CapabilityExecutor } from './types';
import type { ToolResult } from '../../tool-builder';
import { resolveHookConfig } from '../../comms/webhook-handler';
import { getConfig } from '../../../config/config';
import { listMcpPresets, buildMcpServerConfigFromPreset } from '../../../extensions/mcp-preset-service';

const PLATFORM_TOOL_NAMES = new Set([
  'mcp_server_manage',
  'connection_ops',
  'connector_list',
  'webhook_manage',
  'integration_quick_setup',
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
          const { isManagedMcpToolExposed } = await import('../../../connections/runtime.js');
          if (!isManagedMcpToolExposed(serverId, toolName)) return { name, args, result: `MCP tool "${toolName}" is blocked by the connection exposure policy. Review and approve it before use.`, error: true };
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

        if (action === 'oauth_status') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'oauth_status requires id', error: true };
          const cfg = mcpMgr.getConfigs().find((item: any) => item.id === id);
          if (!cfg) return { name, args, result: `Server "${id}" not found`, error: true };
          const { getMcpOAuthFlowStatus } = await import('../../mcp-oauth.js');
          const status = getMcpOAuthFlowStatus(id);
          return { name, args, result: JSON.stringify({ id, status: status?.status || 'none', error: status?.error, authorizeUrl: status?.authorizeUrl }, null, 2), error: false };
        }

        if (action === 'oauth_start') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'oauth_start requires id', error: true };
          const cfg = mcpMgr.getConfigs().find((item: any) => item.id === id);
          if (!cfg) return { name, args, result: `Server "${id}" not found`, error: true };
          if (!cfg.url || !['http', 'sse'].includes(cfg.transport)) return { name, args, result: 'OAuth only applies to remote HTTP/SSE MCP servers.', error: true };
          const { startMcpOAuthFlow } = await import('../../mcp-oauth.js');
          const result = await startMcpOAuthFlow(id, cfg.url, mcpMgr.getOAuthHint(id)?.wwwAuthenticate, args.scope == null ? undefined : String(args.scope));
          return { name, args, result: JSON.stringify({ id, ...result }, null, 2), error: result.status === 'error' };
        }

        if (action === 'oauth_clear') {
          const id = String(args.id || '').trim();
          if (!id) return { name, args, result: 'oauth_clear requires id', error: true };
          if (!mcpMgr.getConfigs().some((item: any) => item.id === id)) return { name, args, result: `Server "${id}" not found`, error: true };
          await mcpMgr.disconnect(id);
          const { clearMcpOAuth } = await import('../../mcp-oauth.js');
          clearMcpOAuth(id);
          return { name, args, result: `Cleared MCP OAuth state for "${id}".`, error: false };
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

        return { name, args, result: `Unknown mcp_server_manage action: "${action}". Valid: list, status, connect, disconnect, delete, upsert, import, list_tools, start_enabled, oauth_start, oauth_status, oauth_clear`, error: true };
      } catch (err: any) {
        return { name, args, result: `mcp_server_manage error: ${err.message}`, error: true };
      }
    }

    if (name === 'connection_ops') {
      try {
        const { getConnectionRuntime } = await import('../../../connections/runtime.js');
        const runtime = getConnectionRuntime();
        const action = String(args.action || 'list').trim().toLowerCase();
        if (action === 'list' || action === 'list_connections') return { name, args, result: JSON.stringify({ connections: runtime.orchestrator.listConnections() }, null, 2), error: false };
        if (action === 'status') {
          const attemptId = String(args.connection_attempt_id || args.attempt_id || '').trim();
          const attempt = runtime.orchestrator.getAttempt(attemptId);
          return attempt ? { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: false } : { name, args, result: `Connection attempt "${attemptId}" not found.`, error: true };
        }
        if (action === 'discover') {
          const service = String(args.service || args.service_id || '').trim();
          if (!service) return { name, args, result: 'discover requires service', error: true };
          const discovery = runtime.orchestrator.discover(service);
          return { name, args, result: JSON.stringify({ discovery }, null, 2), error: false };
        }
        if (action === 'plan' || action === 'connect') {
          const existingAttemptId = String(args.connection_attempt_id || args.attempt_id || '').trim();
          if (existingAttemptId) {
            const existing = runtime.orchestrator.getAttempt(existingAttemptId);
            if (!existing) return { name, args, result: `Connection attempt "${existingAttemptId}" not found.`, error: true };
            const attempt = action === 'plan'
              ? (existing.plan ? existing : await runtime.orchestrator.plan(existingAttemptId))
              : await runtime.orchestrator.connect(existingAttemptId, { ...(args.input || {}), approved: args.approved === true });
            return { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: false };
          }
          const serviceId = String(args.service || args.service_id || '').trim();
          if (!serviceId) return { name, args, result: `${action} requires service`, error: true };
          const created = runtime.orchestrator.create({ serviceId, serviceName: args.service_name, requestedCapabilities: Array.isArray(args.requested_capabilities) ? args.requested_capabilities.map(String) : [], readOnly: args.read_only !== false, metadata: args.metadata });
          let attempt = await runtime.orchestrator.plan(created.id);
          if (action === 'connect' && args.approved === true) attempt = await runtime.orchestrator.connect(created.id, { approved: true });
          return { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: false };
        }
        const attemptId = String(args.connection_attempt_id || args.attempt_id || '').trim();
        if (!attemptId && action !== 'disconnect') return { name, args, result: `${action} requires connection_attempt_id`, error: true };
        if (action === 'continue') { const attempt = await runtime.orchestrator.continue(attemptId, args.input || args); return { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: false }; }
        if (action === 'verify') { const attempt = await runtime.orchestrator.verify(attemptId); return { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: attempt.state === 'failed' }; }
        if (action === 'repair') { const attempt = await runtime.orchestrator.repair(attemptId); return { name, args, result: JSON.stringify({ attempt }, null, 2), artifacts: [{ type: 'connection_card', title: attempt.serviceName || attempt.serviceId, status: attempt.state, summary: attempt.plan?.summary, attempt }], error: attempt.state === 'failed' }; }
        if (action === 'cancel') return { name, args, result: JSON.stringify({ attempt: runtime.orchestrator.cancel(attemptId) }, null, 2), error: false };
        if (action === 'disconnect') { const id = String(args.connection_id || '').trim(); if (!id) return { name, args, result: 'disconnect requires connection_id', error: true }; await runtime.orchestrator.disconnect(id); return { name, args, result: `Disconnected "${id}".`, error: false }; }
        return { name, args, result: `Unknown connection_ops action: ${action}`, error: true };
      } catch (error: any) { return { name, args, result: `connection_ops failed: ${error?.message || error}`, error: true }; }
    }

    if (name === 'webhook_manage') {
      const action = String(args.action || 'get').trim().toLowerCase();
      if (action === 'get' || action === 'test') {
        const cfg = resolveHookConfig();
        const providers = Object.entries(cfg.providers || {}).map(([provider, providerCfg]) => ({
          provider,
          enabled: providerCfg?.enabled === true,
          secretConfigured: Boolean(providerCfg?.secret),
          eventCount: Object.keys(providerCfg?.events || {}).length,
          deliver: providerCfg?.deliver === true,
          ready: cfg.enabled && providerCfg?.enabled === true && Boolean(providerCfg?.secret) && Object.keys(providerCfg?.events || {}).length > 0,
        }));
        const requestedProvider = String(args.provider || '').trim().toLowerCase();
        const selectedProvider = requestedProvider
          ? providers.find((provider) => provider.provider === requestedProvider)
          : undefined;
        const ready = selectedProvider
          ? selectedProvider.ready
          : cfg.enabled && (Boolean(cfg.token) || providers.some((provider) => provider.ready));
        const result = { enabled: cfg.enabled, path: cfg.path, tokenConfigured: Boolean(cfg.token), providers, ready };
        return { name, args, result: JSON.stringify(result, null, 2), error: action === 'test' && !result.ready };
      }
      if (action === 'set') {
        const current = (getConfig().getConfig() as any).hooks || {};
        const next = {
          enabled: args.enabled == null ? current.enabled === true : args.enabled === true,
          token: args.token == null || args.token === '••••••••' ? String(current.token || '') : String(args.token).trim(),
          path: args.path == null ? String(current.path || '/hooks') : String(args.path).trim(),
          providers: current.providers || {},
        };
        getConfig().updateConfig({ hooks: next } as any);
        return {
          name,
          args: { ...args, token: args.token == null ? undefined : '••••••••' },
          result: JSON.stringify({ enabled: next.enabled, path: next.path, tokenConfigured: Boolean(next.token), restartRequired: true }, null, 2),
          error: false,
        };
      }
      if (action === 'set_provider') {
        const safeArgs = { ...args, secret: args.secret == null ? undefined : '••••••••' };
        const provider = String(args.provider || '').trim().toLowerCase();
        if (!['github', 'stripe', 'slack'].includes(provider)) {
          return { name, args: safeArgs, result: 'set_provider requires provider: github | stripe | slack', error: true };
        }
        const currentHooks = (getConfig().getConfig() as any).hooks || {};
        const currentProvider = currentHooks.providers?.[provider] || {};
        const events = Object.create(null) as Record<string, 'audit' | 'wake' | 'agent' | 'ignore'>;
        const rawEvents = args.events == null ? currentProvider.events || {} : args.events;
        if (!rawEvents || typeof rawEvents !== 'object' || Array.isArray(rawEvents)) {
          return { name, args: safeArgs, result: 'set_provider events must be an object mapping event names to audit | wake | agent | ignore', error: true };
        }
        for (const [eventType, rawAction] of Object.entries(rawEvents)) {
          const normalizedEvent = String(eventType || '').trim();
          const normalizedAction = String(rawAction || '').trim().toLowerCase();
          if (!normalizedEvent
            || normalizedEvent.length > 120
            || normalizedEvent === '__proto__'
            || Object.prototype.hasOwnProperty.call(Object.prototype, normalizedEvent)
            || !['audit', 'wake', 'agent', 'ignore'].includes(normalizedAction)) {
            return { name, args: safeArgs, result: `Invalid provider event mapping: ${eventType}`, error: true };
          }
          events[normalizedEvent] = normalizedAction as 'audit' | 'wake' | 'agent' | 'ignore';
        }
        const secret = args.secret == null || args.secret === '••••••••'
          ? String(currentProvider.secret || '')
          : String(args.secret).trim();
        const nextProvider = {
          enabled: args.enabled == null ? currentProvider.enabled === true : args.enabled === true,
          secret,
          events,
          deliver: args.deliver == null ? currentProvider.deliver === true : args.deliver === true,
        };
        const nextHooks = {
          ...currentHooks,
          providers: { ...(currentHooks.providers || {}), [provider]: nextProvider },
        };
        getConfig().updateConfig({ hooks: nextHooks } as any);
        return {
          name,
          args: safeArgs,
          result: JSON.stringify({
            provider,
            enabled: nextProvider.enabled,
            secretConfigured: Boolean(nextProvider.secret),
            eventCount: Object.keys(nextProvider.events).length,
            deliver: nextProvider.deliver,
            ready: nextHooks.enabled === true && nextProvider.enabled && Boolean(nextProvider.secret) && Object.keys(nextProvider.events).length > 0,
            restartRequired: true,
          }, null, 2),
          error: false,
        };
      }
      return { name, args, result: `Unknown webhook_manage action: ${action}`, error: true };
    }

    if (name === 'integration_quick_setup') {
      ensurePrometheusExtensionRuntimeLoaded();
      const action = String(args.action || 'list_presets').trim().toLowerCase();
      if (action === 'list_presets') return { name, args, result: JSON.stringify({ presets: listMcpPresets() }, null, 2), error: false };
      if (action !== 'setup') return { name, args, result: `Unknown integration_quick_setup action: ${action}`, error: true };
      const preset = String(args.preset || '').trim();
      if (!preset) return { name, args, result: 'setup requires preset', error: true };
      const credentials: Record<string, string> = {};
      for (const [key, value] of Object.entries(args || {})) if (typeof value === 'string') credentials[key] = value;
      if (args.github_token) credentials.GITHUB_PERSONAL_ACCESS_TOKEN = String(args.github_token);
      if (args.brave_api_key) credentials.BRAVE_API_KEY = String(args.brave_api_key);
      const built = buildMcpServerConfigFromPreset(preset, credentials);
      const cfg = { ...built, id: String(args.id || built.id), name: String(args.name || preset), enabled: args.enabled !== false } as any;
      getMCPManager().upsertConfig(cfg);
      if (args.connect === false) return { name, args, result: `Saved MCP preset "${preset}" as "${cfg.id}".`, error: false };
      const connected = await getMCPManager().connect(cfg.id);
      return { name, args, result: connected.success ? `Saved and connected "${cfg.id}" (${(connected.tools || []).length} tools).` : `Saved "${cfg.id}", but connection failed: ${connected.error}`, error: !connected.success };
    }

    if (name === 'connector_list') {
      return { name, args, result: buildConnectorStatus(), error: false };
    }

    if (name.startsWith('connector_') && name !== 'connector_list') {
      // Route through the extension registry (native connectors own execution).
      ensurePrometheusExtensionRuntimeLoaded();
      const connResult = await getExtensionRuntimeRegistry().executeTool(name, args);
      return { name, args, ...connResult };
    }

    const { handleCompositeTool } = await import('../../tools/composite-tools');
    const compositeResult = await handleCompositeTool(name, args, ctxExecuteToolBridge(workspacePath, deps, sessionId), workspacePath, deps, sessionId);
    if (compositeResult) return compositeResult;

    return { name, args, result: `Unhandled platform tool: ${name}`, error: true };
  },
};

function ctxExecuteToolBridge(workspacePath: string, deps: any, sessionId: string) {
  const { executeTool } = require('../subagent-executor');
  return (toolName: string, toolArgs: any) => executeTool(toolName, toolArgs, workspacePath, deps, sessionId);
}
