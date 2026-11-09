import { getConfig } from '../config/config';
import { ConnectionStartService } from './start-service';
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
import { ConnectorOAuthConnectionAdapter } from './adapters/connector-oauth';
import { buildConnectorOAuthBridges } from './connector-oauth-bridges';
import type { ConnectionAdapterContext } from './types';
import { buildMcpServerConfigFromPreset } from '../extensions/mcp-preset-service';
import { ensurePrometheusExtensionRuntimeLoaded } from '../extensions/extension-bootstrap';
import { migrateLegacyConnections } from './legacy-migration';
import { reconcileNativeConnectorToolSnapshots } from './native-tool-reconcile';
import { invalidateConnectionToolSurfaceCache } from './tool-surface';
import { setPluginCredentialState } from '../security/plugin-credential-state';
export {
  isManagedConnectorToolAvailable,
  isManagedMcpToolAvailable,
} from './tool-surface';

export interface OpenAiCompatibleRegisterDeps {
  readConfig(): any;
  updateConfig(patch: Record<string, unknown>): void;
  copyCredential(reference: string, serviceId: string, attemptId: string, field: string, targetKey: string): string;
}

/**
 * Register an openai-compatible provider. A connection-owned secret ref is copied into an
 * ordinary provider vault key, and only that copied ref is written to config. The original
 * connection.credentials.* ref is never stored in llm.providers.
 */
export function registerOpenAiCompatibleProvider(context: ConnectionAdapterContext, configuration: Record<string, unknown>, deps: OpenAiCompatibleRegisterDeps): { providerId: string; models: string[] } {
  if (context.attempt.plan?.strategy.adapter !== 'openai-compatible-model') throw new Error('Provider registration requires the openai-compatible-model adapter.');
  const cfg: any = deps.readConfig();
  const providerId = String(configuration.providerId || context.attempt.serviceId).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const models = Array.isArray(configuration.discoveredModels) ? configuration.discoveredModels.map(String) : [];
  const apiKeyRef = context.credentialRef ? deps.copyCredential(context.credentialRef, context.attempt.serviceId, context.attempt.id, 'api_key', `llm.provider-key.${providerId}`) : '';
  const existingProvider = cfg.llm?.providers?.[providerId] || {};
  const providers = { ...(cfg.llm?.providers || {}), [providerId]: { ...existingProvider, api_key: apiKeyRef || existingProvider.api_key || '', base_url: String(configuration.baseUrl || configuration.endpoint || ''), model: String(configuration.model || existingProvider.model || models[0] || '') } };
  deps.updateConfig({ llm: { ...(cfg.llm || {}), providers } });
  return { providerId, models };
}

let singleton: { orchestrator: ConnectionOrchestrator; start: ConnectionStartService; secureInput: SecureInputService; adapters: ConnectionAdapterRegistry } | null = null;

function mcpServerId(context: ConnectionAdapterContext): string {
  return String(context.attempt.plan?.strategy.configuration?.mcpServerId || context.attempt.serviceId);
}

export function getConnectionRuntime() {
  if (singleton) return singleton;
  const configDir = getConfig().getConfigDir();
  const attempts = new ConnectionAttemptStore(configDir);
  const connections = new ConnectionStore(configDir);
  migrateLegacyConnections(connections);
  // Native connectors snapshot their tool list at connect time; pick up tools
  // added by later releases (e.g. connector_<id>_api_request) on every boot.
  try {
    if (reconcileNativeConnectorToolSnapshots(connections).length) invalidateConnectionToolSurfaceCache();
  } catch (error: any) {
    console.warn('[connections] native tool reconcile failed:', error?.message || error);
  }
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
    revokeOAuth: async (context) => { const { revokeMcpOAuth } = await import('../gateway/mcp-oauth.js'); await revokeMcpOAuth(mcpServerId(context)); },
    cancelOAuth: async (context) => { const { cancelMcpOAuth } = require('../gateway/mcp-oauth') as typeof import('../gateway/mcp-oauth'); cancelMcpOAuth(mcpServerId(context)); },
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
    verifyCredential: async () => ({ ok: false, message: 'Stored, not verified: this adapter has no safe authentication verifier.' }),
    clearCredential: async (reference, context) => {
      setPluginCredentialState(configDir, context.attempt.serviceId, true, 'disconnected');
      secureInput.clearReference(reference, context.attempt.serviceId, context.attempt.id, { persistedLegacy: true });
    },
  }));

  adapters.register(new OpenAiCompatibleModelConnectionAdapter({
    createCredentialSession: async (context, fields) => secureInput.create({ serviceId: context.attempt.serviceId, attemptId: context.attempt.id, fields }),
    probe: async (context, configuration) => {
      const baseUrl = String(configuration.baseUrl || configuration.endpoint || '').replace(/\/$/, '');
      if (!baseUrl) return { ok: false, error: 'Base URL is required.' };
      const envelope = context.credentialRef ? secureInput.readForConsumer(context.credentialRef, context.attempt.serviceId, context.attempt.id) : undefined;
      let key: string | undefined;
      try { const value = envelope ? JSON.parse(envelope).api_key : undefined; key = typeof value === 'string' ? value : undefined; } catch { return { ok: false, error: 'Credential is unavailable.' }; }
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      try {
        const response = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) return { ok: false, error: `Model discovery returned HTTP ${response.status}.` };
        const body: any = await response.json();
        const models = Array.isArray(body?.data) ? body.data.map((item: any) => String(item?.id || '')).filter(Boolean) : [];
        return { ok: true, models, details: { status: response.status, capabilityNote: 'Model listing does not verify streaming or tool calling.' } };
      } catch (error: any) { return { ok: false, error: String(error?.message || error) }; }
    },
    register: async (context, configuration) => registerOpenAiCompatibleProvider(context, configuration, {
      readConfig: () => getConfig().getConfig(),
      updateConfig: (patch) => getConfig().updateConfig(patch as any),
      copyCredential: (reference, serviceId, attemptId, field, targetKey) => secureInput.copyScalarFieldForProvider(reference, serviceId, attemptId, field, targetKey),
    }),
  }));

  adapters.register(new CustomHttpConnectionAdapter({
    probe: async (_context, configuration) => {
      const endpoint = String(configuration.endpoint || configuration.url || '');
      try { const response = await fetch(endpoint, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) }); return { ok: response.ok, status: response.status }; }
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

  // Native OAuth connector bridges delegate OAuth, vault storage, refresh, and
  // provider verification to the existing connector classes. The shared host
  // adapter owns canonical records, capability grants, and lifecycle state.
  adapters.register(new ConnectorOAuthConnectionAdapter(buildConnectorOAuthBridges()));

  // Touch the runtime registry so plugin-contributed connection metadata and
  // operational tools share one lifecycle boundary.
  for (const adapter of getExtensionRuntimeRegistry().listConnectionAdapters()) {
    if (!adapters.get(adapter.id)) adapters.register(adapter);
  }
  const plans = new PluginConnectionPlanResolver(() => mcp.getConfigs());
  const orchestrator = new ConnectionOrchestrator({ attempts, connections, adapters, activity, plans, validateCredentialReference: (reference, serviceId, attemptId) => secureInput.ownsReference(reference, serviceId, attemptId), broadcast: broadcastWS });
  singleton = { orchestrator, start: new ConnectionStartService(orchestrator), secureInput, adapters };
  return singleton;
}

export function resetConnectionRuntime(): void { singleton = null; }
