import { getConfig } from '../config/config';
import { getMCPManager } from '../gateway/mcp-manager';
import { broadcastWS } from '../gateway/comms/broadcaster';
import { getExtensionRuntimeRegistry } from '../extensions/runtime-registry';
import { ConnectionAdapterRegistry } from './adapter-registry';
import { ConnectionActivityStore } from './activity-store';
import { ConnectionAttemptStore } from './attempt-store';
import { ConnectionStore } from './connection-store';
import { ConnectionOrchestrator } from './orchestrator';
import { PluginConnectionPlanResolver } from './plugin-plan-resolver';
import { SecureInputService } from './secure-input-service';
import { McpOAuthConnectionAdapter } from './adapters/mcp-oauth';
import { McpStdioConnectionAdapter } from './adapters/mcp-stdio';
import { ApiKeyConnectionAdapter } from './adapters/api-key';
import { OpenAiCompatibleModelConnectionAdapter } from './adapters/openai-compatible-model';
import { CustomHttpConnectionAdapter } from './adapters/custom-http';
import type { ConnectionAdapterContext } from './types';
import { buildMcpServerConfigFromPreset } from '../extensions/mcp-preset-service';
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/legacy-connector-adapter';
import { migrateLegacyConnections } from './legacy-migration';

let singleton: { orchestrator: ConnectionOrchestrator; secureInput: SecureInputService; adapters: ConnectionAdapterRegistry } | null = null;

function mcpServerId(context: ConnectionAdapterContext): string {
  return String(context.attempt.plan?.strategy.configuration?.mcpServerId || context.attempt.serviceId);
}

export function getConnectionRuntime() {
  if (singleton) return singleton;
  const configDir = getConfig().getConfigDir();
  const attempts = new ConnectionAttemptStore(configDir);
  const connections = new ConnectionStore(configDir);
  migrateLegacyConnections(connections);
  const activity = new ConnectionActivityStore(configDir);
  const secureInput = new SecureInputService(configDir);
  const adapters = new ConnectionAdapterRegistry();
  const mcp = getMCPManager();

  adapters.register(new McpOAuthConnectionAdapter({
    startOAuth: async (context, strategy) => {
      const id = mcpServerId(context);
      let cfg = mcp.getConfigs().find((item) => item.id === id);
      if (!cfg) {
        ensurePrometheusExtensionRuntimeLoaded();
        const built = buildMcpServerConfigFromPreset(id);
        mcp.upsertConfig({ ...built, id, name: context.attempt.serviceName || id, enabled: true } as any);
        cfg = mcp.getConfigs().find((item) => item.id === id);
      }
      if (!cfg?.url) throw new Error(`Remote MCP config "${id}" is missing its URL.`);
      const { startMcpOAuthFlow } = await import('../gateway/mcp-oauth.js');
      const result = await startMcpOAuthFlow(id, cfg.url, mcp.getOAuthHint(id)?.wwwAuthenticate, strategy.authentication?.scopes?.join(' '), { openBrowser: false });
      if (result.status === 'error' || !result.authorizeUrl) throw new Error(result.error || 'OAuth did not return an authorization URL.');
      return { authorizationUrl: result.authorizeUrl, scopes: strategy.authentication?.scopes, discoveryVersion: 2 };
    },
    oauthStatus: async (context) => {
      const { getMcpOAuthFlowStatus } = await import('../gateway/mcp-oauth.js');
      const result = getMcpOAuthFlowStatus(mcpServerId(context));
      if (!result) return { state: 'error', error: 'The OAuth session is not active. Restart authorization to create a fresh verified flow.' };
      if (result.status === 'pending') return { state: 'pending' };
      if (result.status === 'connected') return { state: 'connected' };
      return { state: 'error', error: result.error || 'OAuth authorization failed.' };
    },
    connectServer: async (context) => {
      const id = mcpServerId(context);
      const result = await mcp.connect(id);
      return { ok: result.success, tools: (result.tools || []).map((tool: any) => tool.name), error: result.error, configuration: { mcpServerId: id } };
    },
    disconnectServer: async (context) => { await mcp.disconnect(mcpServerId(context)); },
    clearOAuth: async (context) => { const { clearMcpOAuth } = await import('../gateway/mcp-oauth.js'); clearMcpOAuth(mcpServerId(context)); },
  }));

  adapters.register(new McpStdioConnectionAdapter({
    connect: async (context) => {
      const id = mcpServerId(context);
      const result = await mcp.connect(id);
      return { ok: result.success, tools: (result.tools || []).map((tool: any) => tool.name), error: result.error, configuration: { mcpServerId: id } };
    },
    disconnect: async (context) => { await mcp.disconnect(mcpServerId(context)); },
  }));

  adapters.register(new ApiKeyConnectionAdapter({
    createCredentialSession: async (context, fields) => secureInput.create({ serviceId: context.attempt.serviceId, attemptId: context.attempt.id, fields }),
    verifyCredential: async (reference) => ({ ok: String(reference).startsWith('vault:'), message: 'Credential is stored as an opaque vault reference.' }),
    clearCredential: async (reference) => secureInput.clearReference(reference),
  }));

  adapters.register(new OpenAiCompatibleModelConnectionAdapter({
    createCredentialSession: async (context, fields) => secureInput.create({ serviceId: context.attempt.serviceId, attemptId: context.attempt.id, fields }),
    probe: async (context, configuration) => {
      const baseUrl = String(configuration.baseUrl || configuration.endpoint || '').replace(/\/$/, '');
      if (!baseUrl) return { ok: false, error: 'Base URL is required.' };
      const key = context.credentialRef ? getConfig().resolveSecret(context.credentialRef) : undefined;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      try {
        const response = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) return { ok: false, error: `Model discovery returned HTTP ${response.status}.` };
        const body: any = await response.json();
        const models = Array.isArray(body?.data) ? body.data.map((item: any) => String(item?.id || '')).filter(Boolean) : [];
        return { ok: true, models, streaming: true, toolCalling: true, details: { status: response.status } };
      } catch (error: any) { return { ok: false, error: String(error?.message || error) }; }
    },
    register: async (context, configuration) => {
      const cfg: any = getConfig().getConfig();
      const providerId = String(configuration.providerId || context.attempt.serviceId).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const models = Array.isArray(configuration.discoveredModels) ? configuration.discoveredModels.map(String) : [];
      const providers = { ...(cfg.llm?.providers || {}), [providerId]: { ...(cfg.llm?.providers?.[providerId] || {}), api_key: context.credentialRef || '', base_url: String(configuration.baseUrl || configuration.endpoint || ''), model: String(configuration.model || models[0] || '') } };
      getConfig().updateConfig({ llm: { ...(cfg.llm || {}), providers } } as any);
      return { providerId, models };
    },
  }));

  adapters.register(new CustomHttpConnectionAdapter({
    probe: async (_context, configuration) => {
      const endpoint = String(configuration.endpoint || configuration.url || '');
      try { const response = await fetch(endpoint, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) }); return { ok: response.status < 500, status: response.status }; }
      catch (error: any) { return { ok: false, error: String(error?.message || error) }; }
    },
    register: async (context, configuration) => {
      if (context.attempt.plan?.strategy.adapter === 'mcp-http') {
        const id = String(configuration.mcpServerId || context.attempt.serviceId);
        mcp.upsertConfig({ id, name: context.attempt.serviceName || id, enabled: true, transport: 'http', url: String(configuration.endpoint || configuration.url) });
        const result = await mcp.connect(id);
        if (!result.success) throw new Error(result.error || 'MCP HTTP connection failed.');
        return { mcpServerId: id, discoveredTools: (result.tools || []).map((tool: any) => tool.name) };
      }
      return { endpoint: configuration.endpoint || configuration.url };
    },
  }));

  // Touch the runtime registry so plugin-contributed connection metadata and
  // operational tools share one lifecycle boundary.
  for (const adapter of getExtensionRuntimeRegistry().listConnectionAdapters()) {
    if (!adapters.get(adapter.id)) adapters.register(adapter);
  }
  const plans = new PluginConnectionPlanResolver(() => mcp.getConfigs());
  const orchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity, plans, broadcast: broadcastWS });
  singleton = { orchestrator, secureInput, adapters };
  return singleton;
}

export function resetConnectionRuntime(): void { singleton = null; }

export function isManagedMcpToolExposed(serverId: string, toolName: string): boolean {
  const records = getConnectionRuntime().orchestrator.listConnections().filter((connection) =>
    String(connection.configuration?.mcpServerId || connection.serviceId) === serverId,
  );
  if (!records.length) return true; // legacy unmanaged MCP configs retain compatibility
  return records.some((connection) => connection.enabled && connection.exposedTools.includes(toolName));
}
