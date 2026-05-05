import { getConfig } from '../config/config.js';
import { isConnected as isAnthropicConnected } from '../auth/anthropic-oauth.js';
import { isConnected as isOpenAIConnected } from '../auth/openai-oauth.js';
import {
  getVercelCredentials,
  loadSavedConnections,
  type SavedConnectionsMap,
  type VercelCredentials,
} from '../integrations/connection-state.js';
import { getConnectorStatuses } from '../integrations/connector-registry.js';
import { getMCPManager } from '../gateway/mcp-manager.js';
import { listExtensionDescriptors } from './registry.js';
import type {
  ExtensionDescriptor,
  ExtensionKind,
  LoadedExtensionDescriptor,
} from './types.js';

type CatalogState = Record<string, unknown>;

export type CatalogItem<TState extends CatalogState = CatalogState> = ExtensionDescriptor & {
  state: TState;
};

type ConnectorStatusMap = Record<
  string,
  { connected: boolean; hasCredentials: boolean; authType: string }
>;

function buildConnectorState(
  descriptor: LoadedExtensionDescriptor,
  savedConnections: SavedConnectionsMap,
  statuses: ConnectorStatusMap,
  vercelCredentials: VercelCredentials | null,
) {
  const saved = savedConnections[descriptor.id] || {};
  const authType = descriptor.setup?.authType || 'none';

  if (descriptor.id === 'vercel') {
    return {
      connected: !!vercelCredentials?.apiKey,
      hasCredentials: !!vercelCredentials?.apiKey,
      available: true,
      authType,
      connectedAt:
        typeof saved.connectedAt === 'number'
          ? saved.connectedAt
          : vercelCredentials?.apiKey
            ? Date.now()
            : undefined,
    };
  }

  const status = statuses[descriptor.id];
  return {
    connected:
      Boolean(status?.connected) || Boolean((saved as { connected?: boolean }).connected),
    hasCredentials:
      Boolean(status?.hasCredentials) ||
      (authType === 'browser_session'
        ? Boolean((saved as { connected?: boolean }).connected)
        : false),
    available: true,
    authType,
    connectedAt:
      typeof (saved as { connectedAt?: number }).connectedAt === 'number'
        ? (saved as { connectedAt?: number }).connectedAt
        : undefined,
  };
}

function buildProviderState(descriptor: LoadedExtensionDescriptor) {
  const configManager = getConfig();
  const raw = (configManager.getConfig() as any) || {};
  const llm = raw.llm || {};
  const providers = llm.providers || {};
  const providerConfig = providers[descriptor.id] || {};
  const active = String(llm.provider || 'ollama') === descriptor.id;
  const authType = descriptor.setup?.authType || 'none';
  const configDir = configManager.getConfigDir();

  let configured = false;
  let connected: boolean | undefined;

  switch (descriptor.id) {
    case 'openai_codex':
      connected = isOpenAIConnected(configDir);
      configured = connected;
      break;
    case 'anthropic':
      connected = isAnthropicConnected(configDir);
      configured =
        connected || !!String(providerConfig?.model || '').trim();
      break;
    default:
      if (authType === 'api_key') {
        configured = !!String(providerConfig?.api_key || '').trim();
        connected = configured;
      } else if (authType === 'none') {
        configured = true;
      } else {
        configured = true;
      }
      break;
  }

  return {
    configured,
    connected,
    active,
    available: true,
    authType,
  };
}

function buildMcpPresetState(descriptor: LoadedExtensionDescriptor) {
  const mcpManager = getMCPManager();
  const configs = mcpManager.getConfigs();
  const statuses = mcpManager.getStatus();
  const configuredInstanceIds = configs
    .filter((config) => config.id === descriptor.id)
    .map((config) => config.id);
  const connectedInstanceIds = statuses
    .filter((status) => status.id === descriptor.id && status.status === 'connected')
    .map((status) => status.id);

  return {
    available: true,
    configuredInstanceIds,
    connectedInstanceIds,
  };
}

function safeGetConnectorStatuses(): ConnectorStatusMap {
  try {
    return getConnectorStatuses();
  } catch {
    return {};
  }
}

function buildCatalogItems(kind: ExtensionKind): CatalogItem[] {
  const descriptors = listExtensionDescriptors(kind);

  if (kind === 'connector') {
    const savedConnections = loadSavedConnections();
    const statuses = safeGetConnectorStatuses();
    const vercelCredentials = getVercelCredentials();
    return descriptors.map((descriptor) => ({
      ...stripSourcePath(descriptor),
      state: buildConnectorState(descriptor, savedConnections, statuses, vercelCredentials),
    }));
  }

  return descriptors.map((descriptor) => {
    let state: CatalogState;
    if (kind === 'provider') {
      state = buildProviderState(descriptor);
    } else {
      state = buildMcpPresetState(descriptor);
    }
    return { ...stripSourcePath(descriptor), state };
  });
}

function stripSourcePath(descriptor: LoadedExtensionDescriptor): ExtensionDescriptor {
  const { sourcePath: _sourcePath, ...rest } = descriptor;
  return rest;
}

export function buildExtensionsCatalog(kind?: ExtensionKind) {
  if (kind) {
    return buildCatalogItems(kind);
  }
  return {
    providers: buildCatalogItems('provider'),
    connectors: buildCatalogItems('connector'),
    mcpPresets: buildCatalogItems('mcp_preset'),
  };
}
