import type { LoadedExtensionDescriptor } from './types.js';

export type PrometheusExtensionTrustLevel =
  | 'core'
  | 'bundled'
  | 'local'
  | 'third_party'
  | 'marketplace';

export type PrometheusExtensionCapability =
  | 'email'
  | 'calendar'
  | 'drive'
  | 'chat'
  | 'crm'
  | 'payments'
  | 'analytics'
  | 'social'
  | 'code-hosting'
  | 'memory-source'
  | 'mcp-server'
  | 'model-provider'
  | string;

export interface PrometheusExtensionActivation {
  onStartup?: boolean;
  whenToolsRequested?: string[];
  whenCapabilityRequested?: string[];
  whenConnected?: boolean;
}

export interface PrometheusExtensionContracts {
  tools?: string[];
  capabilities?: PrometheusExtensionCapability[];
  connectors?: string[];
  providers?: string[];
  mcpPresets?: string[];
  memorySources?: string[];
  contextProviders?: string[];
}

export interface PrometheusToolExecutionResult {
  result: string;
  error: boolean;
  extra?: any;
  data?: any;
  artifacts?: any[];
}

export interface PrometheusToolContext {
  extensionId: string;
  trustLevel: PrometheusExtensionTrustLevel;
}

export interface PrometheusExtensionTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  connectorId?: string;
  capability?: PrometheusExtensionCapability;
  optional?: boolean;
  execute: (args: any, context: PrometheusToolContext) => Promise<PrometheusToolExecutionResult>;
}

export interface PrometheusConnectorRuntime {
  id: string;
  name: string;
  authType?: string;
  capabilities?: PrometheusExtensionCapability[];
  toolNames?: string[];
  isConnected?: () => boolean;
  hasCredentials?: () => boolean;
  describeStatus?: () => string | Record<string, any>;
}

export interface PrometheusProviderRuntime {
  id: string;
  name: string;
  capabilities?: PrometheusExtensionCapability[];
}

export interface PrometheusMcpPresetRuntime {
  id: string;
  name: string;
  config: Record<string, any>;
}

export interface PrometheusRouteRuntime {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  handler: (...args: any[]) => any;
}

export interface PrometheusHookRuntime {
  event: string;
  handler: (...args: any[]) => any;
}

export interface PrometheusMemorySourceRuntime {
  id: string;
  name: string;
  search?: (...args: any[]) => Promise<any>;
  read?: (...args: any[]) => Promise<any>;
}

export interface PrometheusContextProviderRuntime {
  id: string;
  name: string;
  buildContext: (...args: any[]) => Promise<string> | string;
}

export interface PrometheusExtensionRuntimeRecord {
  id: string;
  manifest?: LoadedExtensionDescriptor;
  trustLevel: PrometheusExtensionTrustLevel;
  activation?: PrometheusExtensionActivation;
  contracts?: PrometheusExtensionContracts;
}

export interface PrometheusExtensionApi {
  registerTool(tool: PrometheusExtensionTool): void;
  registerConnector(connector: PrometheusConnectorRuntime): void;
  registerProvider(provider: PrometheusProviderRuntime): void;
  registerMcpPreset(preset: PrometheusMcpPresetRuntime): void;
  registerRoute(route: PrometheusRouteRuntime): void;
  registerHook(hook: PrometheusHookRuntime): void;
  registerMemorySource(source: PrometheusMemorySourceRuntime): void;
  registerContextProvider(provider: PrometheusContextProviderRuntime): void;
}

export interface PrometheusExtensionDefinition {
  id: string;
  activation?: PrometheusExtensionActivation;
  contracts?: PrometheusExtensionContracts;
  trustLevel?: PrometheusExtensionTrustLevel;
  register(api: PrometheusExtensionApi): void | Promise<void>;
}

export function definePrometheusExtension(
  definition: PrometheusExtensionDefinition,
): PrometheusExtensionDefinition {
  return definition;
}
