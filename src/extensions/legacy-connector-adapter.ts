import { getConnector, isConnectorConnected, listConnectors } from '../integrations/connector-registry.js';
import { loadObsidianBridgeState } from '../gateway/obsidian/bridge.js';
import {
  CONNECTOR_TOOL_MAP,
  getConnectorToolDefs as getLegacyConnectorToolDefs,
} from '../gateway/tools/defs/connector-tools.js';
import {
  X_API_REQUEST_TOOL_NAME,
  X_SEARCH_TOOL_NAME,
  XAI_LIVE_SEARCH_TOOL_NAME,
  XAI_TOOL_NAMES,
} from '../gateway/tools/defs/xai-tools.js';
import { getXApiOAuthStatus } from '../auth/x-api-oauth.js';
import { getConfig } from '../config/config.js';
import { handleConnectorTool } from '../gateway/tools/handlers/connector-handlers.js';
import { getExtensionRuntimeRegistry } from './runtime-registry.js';
import { loadManifestRuntimeExtensions } from './runtime-loader.js';
import { hasXAIConfiguredCredentials, refreshXAITools } from './xai-extension-adapter.js';

let loaded = false;

function findConnectorIdForTool(toolName: string): string | undefined {
  for (const [connectorId, toolNames] of Object.entries(CONNECTOR_TOOL_MAP)) {
    if (toolNames.includes(toolName)) return connectorId;
  }
  return undefined;
}

function describeConnector(connectorId: string): string {
  if (connectorId === 'obsidian') {
    const vaultCount = loadObsidianBridgeState().vaults.length;
    return `${vaultCount} vault(s)`;
  }
  const connector = getConnector(connectorId);
  const tokens = (connector as any)?.loadTokens?.() as any;
  return tokens?.account_email ? String(tokens.account_email) : '';
}

function connectorConnected(connectorId: string): boolean {
  if (connectorId === 'obsidian') {
    return loadObsidianBridgeState().vaults.some((vault) => vault.enabled !== false);
  }
  return isConnectorConnected(connectorId);
}

function registerConnectorRecords(): void {
  const registry = getExtensionRuntimeRegistry();
  const ids = new Set([...listConnectors(), 'obsidian']);
  for (const connectorId of ids) {
    registry.registerConnector(connectorId, {
      id: connectorId,
      name: connectorId
        .split(/[_-]/g)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      authType: connectorId === 'obsidian' ? 'none' : 'oauth',
      capabilities: getExtensionRuntimeRegistry().getExtension(connectorId)?.contracts?.capabilities || [],
      toolNames: CONNECTOR_TOOL_MAP[connectorId] || [],
      isConnected: () => connectorConnected(connectorId),
      hasCredentials: () => {
        if (connectorId === 'obsidian') return loadObsidianBridgeState().vaults.length > 0;
        return Boolean((getConnector(connectorId) as any)?.hasCredentials?.());
      },
      describeStatus: () => describeConnector(connectorId),
    });
  }

  const xToolNames = XAI_TOOL_NAMES.filter((name) => name.startsWith('x_api_'));
  const getXStatus = () => getXApiOAuthStatus(getConfig().getConfigDir());
  registry.registerConnector('x', {
    id: 'x',
    name: 'X / Twitter',
    authType: 'oauth',
    capabilities: registry.getExtension('x')?.contracts?.capabilities || ['social', 'publishing', 'official_api'],
    toolNames: xToolNames,
    isConnected: () => getXStatus().connected,
    hasCredentials: () => getXStatus().credentialsConfigured || getXStatus().connected,
    describeStatus: () => {
      const status = getXStatus();
      return status.connected
        ? `X API OAuth user context${status.username ? ` (@${status.username})` : ''}; ${xToolNames.length} X API tool(s), including ${X_API_REQUEST_TOOL_NAME}`
        : status.credentialsConfigured
          ? 'X Developer app credentials saved; authorize OAuth user context'
          : 'not connected';
    },
  });

  registry.registerConnector('xai', {
    id: 'xai',
    name: 'xAI / Grok',
    authType: 'oauth',
    capabilities: registry.getExtension('xai')?.contracts?.capabilities || ['search', 'social'],
    toolNames: [X_SEARCH_TOOL_NAME, XAI_LIVE_SEARCH_TOOL_NAME],
    isConnected: () => hasXAIConfiguredCredentials(),
    hasCredentials: () => hasXAIConfiguredCredentials(),
    describeStatus: () => hasXAIConfiguredCredentials() ? 'xAI/Grok credentials configured' : 'not connected',
  });
}

function registerConnectorTools(): void {
  const registry = getExtensionRuntimeRegistry();
  for (const definition of getLegacyConnectorToolDefs()) {
    const fn = definition?.function;
    const name = String(fn?.name || '').trim();
    if (!name || name === 'connector_list') continue;
    const connectorId = findConnectorIdForTool(name) || 'connectors';
    registry.registerTool(connectorId, {
      name,
      description: String(fn?.description || ''),
      parameters: fn?.parameters || { type: 'object', required: [], properties: {} },
      connectorId,
      capability: getExtensionRuntimeRegistry().getExtension(connectorId)?.contracts?.capabilities?.[0],
      execute: async (args) => handleConnectorTool(name, args),
    });
  }
}

export function ensurePrometheusExtensionRuntimeLoaded(): void {
  if (!loaded) {
    loadManifestRuntimeExtensions();
    registerConnectorTools();
    loaded = true;
  }
  // Connector classes are initialized by gateway startup. Refresh connector
  // records on every ensure so early callers cannot freeze an empty registry.
  registerConnectorRecords();
  refreshXAITools();
}
