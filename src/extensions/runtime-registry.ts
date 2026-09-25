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
import { getConnectionToolExposure } from '../connections/tool-surface.js';

type RegisteredTool = PrometheusExtensionTool & {
  extensionId: string;
};

const CONNECTOR_CONNECTION_CACHE_TTL_MS = 5_000;

/** Connectors that already have hand-written wrappers (x_* and vercel_ops). */
const HANDWRITTEN_WRAPPER_CONNECTORS = new Set(['x', 'xai', 'vercel']);

export interface ConnectorWrapperSpec {
  /** Provider-facing tool name, e.g. connector_github. */
  wrapper: string;
  connectorId: string;
  connectorName: string;
  actions: Record<string, { tool: string; description: string; parameters: any }>;
}

export function connectorWrapperName(connectorId: string): string {
  return `connector_${String(connectorId || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
}

function describeActionArgs(parameters: any): string {
  const props = Object.keys(parameters?.properties || {});
  const required = new Set<string>(Array.isArray(parameters?.required) ? parameters.required : []);
  return props.map((key) => (required.has(key) ? key : `${key}?`)).join(', ');
}

function firstSentence(text: string, max = 90): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = clean.split(/(?<=\.)\s/)[0] || clean;
  return cut.length > max ? `${cut.slice(0, max - 3)}...` : cut;
}

/**
 * Compact provider-facing definition for a generated connector wrapper. The
 * union of every action's properties keeps typed arguments; the description
 * lists each action with its arguments (required ones unmarked, optional ?).
 */
export function buildConnectorWrapperDefinition(spec: ConnectorWrapperSpec): any {
  const properties: Record<string, any> = {
    action: { type: 'string', enum: Object.keys(spec.actions), description: 'Which operation to run. Pass that operation\'s arguments alongside.' },
  };
  for (const action of Object.values(spec.actions)) {
    for (const [key, schema] of Object.entries<any>(action.parameters?.properties || {})) {
      if (key === 'action' || properties[key]) continue;
      const { description, ...rest } = schema || {};
      properties[key] = { ...rest, ...(description ? { description: String(description).slice(0, 120) } : {}) };
    }
  }
  const actionLines = Object.entries(spec.actions)
    .map(([action, def]) => `${action}(${describeActionArgs(def.parameters)}): ${firstSentence(def.description)}`)
    .join('\n');
  return {
    type: 'function',
    function: {
      name: spec.wrapper,
      description: `${spec.connectorName} connector. Call with action plus that action's arguments (? = optional).\n${actionLines}`,
      parameters: { type: 'object', required: ['action'], properties },
    },
  };
}

/**
 * Resolve a generated wrapper call to the direct connector tool. Returns an
 * error (with the correct argument list) for an unknown action or missing
 * required argument instead of letting the connector fail obscurely.
 */
export function resolveConnectorWrapperCall(
  spec: ConnectorWrapperSpec,
  rawArgs: any,
): { name: string; args: any; error?: string } {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const action = String(args.action || '').trim().toLowerCase();
  delete args.action;
  const available = Object.entries(spec.actions)
    .map(([key, def]) => `${key}(${describeActionArgs(def.parameters)})`)
    .join('; ');
  if (!action) return { name: spec.wrapper, args: rawArgs, error: `${spec.wrapper} requires action. Available: ${available}` };
  const target = spec.actions[action];
  if (!target) return { name: spec.wrapper, args: rawArgs, error: `Unsupported ${spec.wrapper} action "${action}". Available: ${available}` };
  const required: string[] = Array.isArray(target.parameters?.required) ? target.parameters.required : [];
  const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
  if (missing.length) {
    return {
      name: spec.wrapper,
      args: rawArgs,
      error: `${spec.wrapper} action "${action}" is missing required argument(s): ${missing.join(', ')}. Arguments: ${describeActionArgs(target.parameters)}`,
    };
  }
  return { name: target.tool, args };
}

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
  private connectorConnectionCache = new Map<string, { at: number; connected: boolean }>();
  private revision = 0;
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
    this.revision++;
  }

  unregisterTool(name: string, extensionId?: string): boolean {
    const existing = this.tools.get(name);
    if (!existing) return false;
    if (extensionId && existing.extensionId !== extensionId) return false;
    const deleted = this.tools.delete(name);
    if (deleted) {
      this.connectorStatusCache = null;
      this.revision++;
    }
    return deleted;
  }

  registerConnector(extensionId: string, connector: PrometheusConnectorRuntime): void {
    this.connectors.set(connector.id, { ...connector, extensionId });
    this.connectorStatusCache = null;
    this.connectorConnectionCache.delete(connector.id);
    this.revision++;
  }

  getRevision(): number {
    return this.revision;
  }

  invalidateConnectorState(connectorId?: string): void {
    if (connectorId) this.connectorConnectionCache.delete(connectorId);
    else this.connectorConnectionCache.clear();
    this.connectorStatusCache = null;
    this.revision++;
  }

  private isConnectorConnected(connectorId: string, now = Date.now()): boolean {
    const cached = this.connectorConnectionCache.get(connectorId);
    if (cached && now - cached.at <= CONNECTOR_CONNECTION_CACHE_TTL_MS) return cached.connected;
    const connector = this.connectors.get(connectorId);
    let connected = false;
    try {
      connected = connector?.isConnected?.() === true;
    } catch {
      connected = false;
    }
    this.connectorConnectionCache.set(connectorId, { at: now, connected });
    return connected;
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

  private connectorIdForTool(tool: RegisteredTool): string {
    const explicit = String((tool as any).connectorId || '').trim();
    if (explicit) return explicit;
    const extension = this.extensions.get(tool.extensionId);
    const declared = extension?.contracts?.connectors || [];
    if (declared.length === 1) return String(declared[0]);
    const owner = this.listConnectors().find((connector) => connector.toolNames?.includes(tool.name));
    return owner?.id || '';
  }

  getConnectorIdForTool(name: string): string {
    const tool = this.tools.get(name);
    return tool ? this.connectorIdForTool(tool) : '';
  }

  isToolAvailable(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    const connectorId = this.connectorIdForTool(tool);
    if (!connectorId) return true;
    const exposure = getConnectionToolExposure(connectorId, tool.name);
    return exposure.managed ? exposure.available : this.isConnectorConnected(connectorId);
  }

  listConnectedConnectorToolDefinitions(): any[] {
    const now = Date.now();
    const connectedById = new Map<string, boolean>();
    return this.listTools()
      .filter((tool) => {
        const connectorId = this.connectorIdForTool(tool);
        if (!connectorId) return true;
        const canonical = getConnectionToolExposure(connectorId, tool.name);
        // Canonical connection records are authoritative for native and
        // managed MCP-backed connectors. Legacy connectors keep their old
        // runtime status path until they are migrated.
        if (canonical.managed) return canonical.available;
        if (!connectedById.has(connectorId)) {
          connectedById.set(connectorId, this.isConnectorConnected(connectorId, now));
        }
        return connectedById.get(connectorId) === true;
      })
      .map(toFunctionTool);
  }

  /**
   * One generated `connector_<id>` wrapper per connected connector that has no
   * hand-written wrapper (X uses x_*, Vercel uses vercel_ops). The wrapper takes
   * `action` plus that action's arguments and dispatches to the direct
   * connector tool, so a connector costs one tool definition instead of 5-12.
   */
  listConnectorWrapperSpecs(options: { connectedOnly?: boolean } = {}): ConnectorWrapperSpec[] {
    const connectedOnly = options.connectedOnly !== false;
    const byConnector = new Map<string, RegisteredTool[]>();
    for (const tool of this.listTools()) {
      if (!/^connector_/.test(tool.name)) continue;
      const connectorId = this.connectorIdForTool(tool);
      if (!connectorId || HANDWRITTEN_WRAPPER_CONNECTORS.has(connectorId)) continue;
      if (connectedOnly && !this.isToolAvailable(tool.name)) continue;
      const list = byConnector.get(connectorId) || [];
      list.push(tool);
      byConnector.set(connectorId, list);
    }
    const specs: ConnectorWrapperSpec[] = [];
    for (const [connectorId, tools] of [...byConnector.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const wrapper = connectorWrapperName(connectorId);
      if (this.tools.has(wrapper)) continue; // never shadow a real tool
      const actions: ConnectorWrapperSpec['actions'] = {};
      for (const tool of tools) {
        const action = tool.name.replace(/^connector_[a-z0-9]+_/, '') || tool.name;
        if (actions[action]) continue;
        actions[action] = {
          tool: tool.name,
          description: String(tool.description || ''),
          parameters: tool.parameters || { type: 'object', required: [], properties: {} },
        };
      }
      specs.push({
        wrapper,
        connectorId,
        connectorName: this.connectors.get(connectorId)?.name || connectorId,
        actions,
      });
    }
    return specs;
  }

  getConnectorWrapperSpec(wrapper: string): ConnectorWrapperSpec | undefined {
    const name = String(wrapper || '').trim();
    if (!/^connector_[a-z0-9_]+$/.test(name) || this.tools.has(name)) return undefined;
    return this.listConnectorWrapperSpecs({ connectedOnly: false }).find((spec) => spec.wrapper === name);
  }

  listConnectorWrapperDefinitions(): any[] {
    return this.listConnectorWrapperSpecs().map(buildConnectorWrapperDefinition);
  }

  listConnectors(): Array<PrometheusConnectorRuntime & { extensionId: string }> {
    return [...this.connectors.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getConnector(id: string): (PrometheusConnectorRuntime & { extensionId: string }) | undefined {
    return this.connectors.get(id);
  }

  isConnectorAvailable(id: string): boolean {
    const connector = this.connectors.get(id);
    if (!connector || !this.isConnectorConnected(id)) return false;
    const toolNames = connector.toolNames?.length
      ? connector.toolNames
      : this.listTools()
        .filter((tool) => this.connectorIdForTool(tool) === id)
        .map((tool) => tool.name);
    return toolNames.length === 0 || toolNames.some((name) => this.isToolAvailable(name));
  }

  async executeTool(name: string, args: any): Promise<PrometheusToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { result: `Extension tool not found: ${name}`, error: true };
    }
    if (!this.isToolAvailable(name)) {
      return { result: `Extension tool "${name}" is not available for an enabled connection. Connect or enable the owning connector before use.`, error: true };
    }
    const extension = this.extensions.get(tool.extensionId);
    const connectorId = this.connectorIdForTool(tool);
    const connectorScope = connectorId || tool.extensionId;
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
      connected: this.isConnectorConnected(connector.id, now),
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
    lines.push('\nConnected connector tools are exposed while the external_apps category is active (X via x_* wrappers, Vercel via vercel_ops). If they are missing from your tool list, call request_tool_category({"category":"external_apps"}).');
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
