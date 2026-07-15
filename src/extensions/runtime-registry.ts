import { resolveConnectorCredential } from './credential-access.js';
import { listExtensionDescriptors } from './registry.js';
import type {
  PrometheusConnectorRuntime,
  PrometheusContextProviderRuntime,
  PrometheusExtensionApi,
  PrometheusExtensionDefinition,
  PrometheusExtensionRuntimeRecord,
  PrometheusExtensionTool,
  PrometheusHookRuntime,
  PrometheusMcpPresetRuntime,
  PrometheusMemorySourceRuntime,
  PrometheusProviderRuntime,
  PrometheusRouteRuntime,
  PrometheusToolExecutionResult,
} from './runtime-api.js';
import type { ConnectionAdapter } from '../connections/types.js';
import type { ConnectionToolClassifier } from '../connections/tool-classifier.js';
import type { ConnectionVerifier } from '../connections/verification-service.js';
import type { LoadedExtensionDescriptor } from './types.js';

type RegisteredTool = PrometheusExtensionTool & {
  extensionId: string;
};

function descriptorContracts(manifest: LoadedExtensionDescriptor) {
  if (manifest.contracts) {
    return {
      tools: manifest.contracts.tools || manifest.ownership?.tools,
      capabilities: manifest.contracts.capabilities || manifest.ownership?.capabilities,
      connectors: manifest.contracts.connectors || (manifest.kind === 'connector' ? [manifest.id] : undefined),
      providers: manifest.contracts.providers || manifest.ownership?.providerIds,
      mcpPresets: manifest.contracts.mcpPresets || (manifest.kind === 'mcp_preset' ? [manifest.id] : undefined),
      memorySources: manifest.contracts.memorySources,
      contextProviders: manifest.contracts.contextProviders,
    };
  }
  return {
    tools: manifest.ownership?.tools,
    capabilities: manifest.ownership?.capabilities,
    connectors: manifest.kind === 'connector' ? [manifest.id] : undefined,
    providers: manifest.ownership?.providerIds,
    mcpPresets: manifest.kind === 'mcp_preset' ? [manifest.id] : undefined,
  };
}

function toFunctionTool(tool: RegisteredTool): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', required: [], properties: {} },
    },
  };
}

export class PrometheusExtensionRuntimeRegistry {
  private extensions = new Map<string, PrometheusExtensionRuntimeRecord>();
  private tools = new Map<string, RegisteredTool>();
  private connectors = new Map<string, PrometheusConnectorRuntime & { extensionId: string }>();
  private connectorStatusCache: { at: number; text: string } | null = null;
  private connectorHealth = new Map<string, { authState: 'expired_or_invalid'; lastAuthError: string; reauthRequired: true; at: number }>();
  private providers = new Map<string, PrometheusProviderRuntime & { extensionId: string }>();
  private mcpPresets = new Map<string, PrometheusMcpPresetRuntime & { extensionId: string }>();
  private routes: Array<PrometheusRouteRuntime & { extensionId: string }> = [];
  private hooks: Array<PrometheusHookRuntime & { extensionId: string }> = [];
  private memorySources = new Map<string, PrometheusMemorySourceRuntime & { extensionId: string }>();
  private contextProviders = new Map<string, PrometheusContextProviderRuntime & { extensionId: string }>();
  private connectionAdapters = new Map<string, ConnectionAdapter & { extensionId: string }>();
  private connectionVerifiers = new Map<string, ConnectionVerifier & { extensionId: string }>();
  private toolClassifiers = new Map<string, ConnectionToolClassifier & { extensionId: string }>();
  private deactivators = new Map<string, () => void | Promise<void>>();

  registerManifest(manifest: LoadedExtensionDescriptor): void {
    if (this.extensions.has(manifest.id)) return;
    this.extensions.set(manifest.id, {
      id: manifest.id,
      manifest,
      trustLevel: manifest.trustLevel || 'bundled',
      activation: manifest.activation || { onStartup: manifest.enabledByDefault === true },
      contracts: descriptorContracts(manifest),
    });
  }

  registerDefinition(definition: PrometheusExtensionDefinition): void {
    const existing = this.extensions.get(definition.id);
    this.extensions.set(definition.id, {
      id: definition.id,
      manifest: existing?.manifest,
      trustLevel: definition.trustLevel || existing?.trustLevel || 'local',
      activation: definition.activation || existing?.activation,
      contracts: definition.contracts || existing?.contracts,
    });

    const api = this.createApi(definition.id);
    void definition.register(api);
    if (definition.deactivate) this.deactivators.set(definition.id, () => definition.deactivate!());
  }

  disposeAll(): void {
    for (const [id, deactivate] of this.deactivators) {
      try { void Promise.resolve(deactivate()).catch((error) => console.warn(`[extensions] Failed to deactivate ${id}: ${String(error?.message || error)}`)); }
      catch (error: any) { console.warn(`[extensions] Failed to deactivate ${id}: ${String(error?.message || error)}`); }
    }
    this.deactivators.clear();
  }

  private createApi(extensionId: string): PrometheusExtensionApi {
    return {
      registerTool: (tool) => this.registerTool(extensionId, tool),
      unregisterTool: (name) => this.unregisterTool(name, extensionId),
      registerConnector: (connector) => this.registerConnector(extensionId, connector),
      registerProvider: (provider) => this.registerProvider(extensionId, provider),
      registerMcpPreset: (preset) => this.registerMcpPreset(extensionId, preset),
      registerRoute: (route) => this.routes.push({ ...route, extensionId }),
      registerHook: (hook) => this.hooks.push({ ...hook, extensionId }),
      registerMemorySource: (source) => this.memorySources.set(source.id, { ...source, extensionId }),
      registerContextProvider: (provider) => this.contextProviders.set(provider.id, { ...provider, extensionId }),
      registerConnectionAdapter: (adapter) => this.connectionAdapters.set(adapter.id, Object.assign(adapter, { extensionId })),
      registerConnectionVerifier: (verifier) => this.connectionVerifiers.set(verifier.id, Object.assign(verifier, { extensionId })),
      registerToolClassifier: (classifier) => this.toolClassifiers.set(classifier.id, Object.assign(classifier, { extensionId })),
    };
  }

  registerTool(extensionId: string, tool: PrometheusExtensionTool): void {
    const existing = this.tools.get(tool.name);
    if (existing && existing.extensionId !== extensionId) {
      throw new Error(`Tool "${tool.name}" is already registered by extension "${existing.extensionId}"`);
    }
    this.tools.set(tool.name, { ...tool, extensionId });
    this.connectorStatusCache = null;
  }

  unregisterTool(name: string, extensionId?: string): boolean {
    const existing = this.tools.get(name);
    if (!existing) return false;
    if (extensionId && existing.extensionId !== extensionId) return false;
    const deleted = this.tools.delete(name);
    if (deleted) this.connectorStatusCache = null;
    return deleted;
  }

  registerConnector(extensionId: string, connector: PrometheusConnectorRuntime): void {
    this.connectors.set(connector.id, { ...connector, extensionId });
    this.connectorStatusCache = null;
  }

  registerProvider(extensionId: string, provider: PrometheusProviderRuntime): void {
    this.providers.set(provider.id, { ...provider, extensionId });
  }

  registerMcpPreset(extensionId: string, preset: PrometheusMcpPresetRuntime): void {
    this.mcpPresets.set(preset.id, { ...preset, extensionId });
  }

  getMcpPreset(id: string): (PrometheusMcpPresetRuntime & { extensionId: string }) | undefined {
    return this.mcpPresets.get(id);
  }

  listMcpPresets(): Array<PrometheusMcpPresetRuntime & { extensionId: string }> {
    return [...this.mcpPresets.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getExtension(id: string): PrometheusExtensionRuntimeRecord | undefined {
    return this.extensions.get(id);
  }

  listExtensions(): PrometheusExtensionRuntimeRecord[] {
    return [...this.extensions.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  listToolDefinitions(): any[] {
    return this.listTools().map(toFunctionTool);
  }

  listConnectedConnectorToolDefinitions(): any[] {
    return this.listTools()
      .filter((tool) => {
        const connectorId = String((tool as any).connectorId || '').trim();
        if (!connectorId) return true;
        const connector = this.connectors.get(connectorId);
        return connector?.isConnected?.() === true;
      })
      .map(toFunctionTool);
  }

  listConnectors(): Array<PrometheusConnectorRuntime & { extensionId: string }> {
    return [...this.connectors.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getConnector(id: string): (PrometheusConnectorRuntime & { extensionId: string }) | undefined {
    return this.connectors.get(id);
  }

  async executeTool(name: string, args: any): Promise<PrometheusToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { result: `Extension tool not found: ${name}`, error: true };
    }
    const extension = this.extensions.get(tool.extensionId);
    const connectorScope = String((tool as any).connectorId || tool.extensionId);
    try {
      const result = await tool.execute(args || {}, {
      extensionId: tool.extensionId,
      trustLevel: extension?.trustLevel || 'local',
      getCredential: (fieldKey: string, connectorId?: string) =>
        resolveConnectorCredential(connectorId || connectorScope, fieldKey),
      });
      const message = String(result?.result || '');
      if (result?.error && /token refresh failed|invalid_request|invalid_grant|token was invalid|unauthori[sz]ed|invalid token|token revoked|\b401\b/i.test(message)) {
        this.connectorHealth.set(connectorScope, { authState: 'expired_or_invalid', lastAuthError: message.slice(0, 500), reauthRequired: true, at: Date.now() });
        this.connectorStatusCache = null;
      } else if (!result?.error) {
        this.connectorHealth.delete(connectorScope);
      }
      return result;
    } catch (error: any) {
      const message = String(error?.message || error);
      if (/token refresh failed|invalid_request|invalid_grant|token was invalid|unauthori[sz]ed|invalid token|token revoked|\b401\b/i.test(message)) {
        this.connectorHealth.set(connectorScope, { authState: 'expired_or_invalid', lastAuthError: message.slice(0, 500), reauthRequired: true, at: Date.now() });
        this.connectorStatusCache = null;
      }
      throw error;
    }
  }

  buildConnectorStatus(): string {
    const now = Date.now();
    if (this.connectorStatusCache && now - this.connectorStatusCache.at < 5_000) {
      return this.connectorStatusCache.text;
    }
    const connectors = this.listConnectors();
    const rows = connectors.map((connector) => ({
      connector,
      connected: connector.isConnected?.() === true,
    }));
    const connected = rows.filter((row) => row.connected);
    const disconnected = rows.filter((row) => !row.connected);

    if (connected.length === 0) {
      const text = `No connectors connected yet (${disconnected.length} available: ${disconnected.map((row) => row.connector.id).join(', ')}).\nConnect them in the Connections panel, then activate the external_apps category to use their tools.`;
      this.connectorStatusCache = { at: now, text };
      return text;
    }

    const lines = [`Connected connectors (${connected.length} of ${connectors.length}):`];
    for (const { connector } of connected) {
      const described = connector.describeStatus?.();
      lines.push(`  ${connector.id}${typeof described === 'string' && described ? ` - ${described}` : ''}`);
      if (connector.toolNames?.length) {
        const registered = connector.toolNames.filter((name) => this.tools.has(name));
        const missing = connector.toolNames.filter((name) => !this.tools.has(name));
        lines.push(`    Tools: ${registered.length}/${connector.toolNames.length} registered${missing.length ? `; ${missing.length} missing` : ''}`);
      }
      const health = this.connectorHealth.get(connector.id);
      if (health) lines.push(`    Auth health: ${health.authState}; reauthRequired=true; lastAuthError=${health.lastAuthError.split(/\r?\n/)[0]}`);
    }
    if (disconnected.length > 0) {
      lines.push(`\nNot connected (${disconnected.length}): ${disconnected.map((row) => row.connector.id).join(', ')}`);
    }
    lines.push('\nUse request_tool_category({"category":"external_apps"}) to unlock connected connector tools for this session.');
    const text = lines.join('\n');
    this.connectorStatusCache = { at: now, text };
    return text;
  }

  listConnectionAdapters(): Array<ConnectionAdapter & { extensionId: string }> { return [...this.connectionAdapters.values()]; }
  listConnectionVerifiers(): Array<ConnectionVerifier & { extensionId: string }> { return [...this.connectionVerifiers.values()]; }
  listToolClassifiers(): Array<ConnectionToolClassifier & { extensionId: string }> { return [...this.toolClassifiers.values()]; }
}

let runtimeRegistry: PrometheusExtensionRuntimeRegistry | null = null;

export function getExtensionRuntimeRegistry(): PrometheusExtensionRuntimeRegistry {
  if (!runtimeRegistry) {
    runtimeRegistry = new PrometheusExtensionRuntimeRegistry();
  }
  return runtimeRegistry;
}

export function clearExtensionRuntimeRegistry(): void {
  runtimeRegistry?.disposeAll();
  runtimeRegistry = null;
}

export function registerBundledExtensionManifests(): void {
  const registry = getExtensionRuntimeRegistry();
  for (const descriptor of listExtensionDescriptors()) {
    registry.registerManifest(descriptor);
  }
}
