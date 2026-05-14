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
  private providers = new Map<string, PrometheusProviderRuntime & { extensionId: string }>();
  private mcpPresets = new Map<string, PrometheusMcpPresetRuntime & { extensionId: string }>();
  private routes: Array<PrometheusRouteRuntime & { extensionId: string }> = [];
  private hooks: Array<PrometheusHookRuntime & { extensionId: string }> = [];
  private memorySources = new Map<string, PrometheusMemorySourceRuntime & { extensionId: string }>();
  private contextProviders = new Map<string, PrometheusContextProviderRuntime & { extensionId: string }>();

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
  }

  private createApi(extensionId: string): PrometheusExtensionApi {
    return {
      registerTool: (tool) => this.registerTool(extensionId, tool),
      registerConnector: (connector) => this.registerConnector(extensionId, connector),
      registerProvider: (provider) => this.registerProvider(extensionId, provider),
      registerMcpPreset: (preset) => this.registerMcpPreset(extensionId, preset),
      registerRoute: (route) => this.routes.push({ ...route, extensionId }),
      registerHook: (hook) => this.hooks.push({ ...hook, extensionId }),
      registerMemorySource: (source) => this.memorySources.set(source.id, { ...source, extensionId }),
      registerContextProvider: (provider) => this.contextProviders.set(provider.id, { ...provider, extensionId }),
    };
  }

  registerTool(extensionId: string, tool: PrometheusExtensionTool): void {
    const existing = this.tools.get(tool.name);
    if (existing && existing.extensionId !== extensionId) {
      throw new Error(`Tool "${tool.name}" is already registered by extension "${existing.extensionId}"`);
    }
    this.tools.set(tool.name, { ...tool, extensionId });
  }

  registerConnector(extensionId: string, connector: PrometheusConnectorRuntime): void {
    this.connectors.set(connector.id, { ...connector, extensionId });
  }

  registerProvider(extensionId: string, provider: PrometheusProviderRuntime): void {
    this.providers.set(provider.id, { ...provider, extensionId });
  }

  registerMcpPreset(extensionId: string, preset: PrometheusMcpPresetRuntime): void {
    this.mcpPresets.set(preset.id, { ...preset, extensionId });
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
    return tool.execute(args || {}, {
      extensionId: tool.extensionId,
      trustLevel: extension?.trustLevel || 'local',
    });
  }

  buildConnectorStatus(): string {
    const connectors = this.listConnectors();
    const connected = connectors.filter((connector) => connector.isConnected?.() === true);
    const disconnected = connectors.filter((connector) => connector.isConnected?.() !== true);

    if (connected.length === 0) {
      return `No connectors connected yet (${disconnected.length} available: ${disconnected.map((c) => c.id).join(', ')}).\nConnect them in the Connections panel, then activate the external_apps category to use their tools.`;
    }

    const lines = [`Connected connectors (${connected.length} of ${connectors.length}):`];
    for (const connector of connected) {
      const described = connector.describeStatus?.();
      lines.push(`  ${connector.id}${typeof described === 'string' && described ? ` - ${described}` : ''}`);
      if (connector.toolNames?.length) {
        lines.push(`    Tools: ${connector.toolNames.join(', ')}`);
      }
    }
    if (disconnected.length > 0) {
      lines.push(`\nNot connected (${disconnected.length}): ${disconnected.map((c) => c.id).join(', ')}`);
    }
    lines.push('\nUse request_tool_category({"category":"external_apps"}) to unlock all connector tools for this session.');
    return lines.join('\n');
  }
}

let runtimeRegistry: PrometheusExtensionRuntimeRegistry | null = null;

export function getExtensionRuntimeRegistry(): PrometheusExtensionRuntimeRegistry {
  if (!runtimeRegistry) {
    runtimeRegistry = new PrometheusExtensionRuntimeRegistry();
  }
  return runtimeRegistry;
}

export function clearExtensionRuntimeRegistry(): void {
  runtimeRegistry = null;
}

export function registerBundledExtensionManifests(): void {
  const registry = getExtensionRuntimeRegistry();
  for (const descriptor of listExtensionDescriptors()) {
    registry.registerManifest(descriptor);
  }
}
