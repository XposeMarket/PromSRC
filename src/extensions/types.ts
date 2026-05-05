export type ExtensionKind = 'provider' | 'connector' | 'mcp_preset';

export type ExtensionSetupFieldInput =
  | 'text'
  | 'password'
  | 'select'
  | 'textarea'
  | 'checkbox';

export type ExtensionSetupAuthType =
  | 'oauth'
  | 'api_key'
  | 'oauth_setup_token'
  | 'browser_session'
  | 'none';

export type ExtensionSetupField = {
  key: string;
  label: string;
  input: ExtensionSetupFieldInput;
  required?: boolean;
  placeholder?: string;
  help?: string;
  secret?: boolean;
  options?: string[];
};

export type ExtensionPermission = {
  icon: string;
  label: string;
};

export type ExtensionRuntimeOptions = {
  endpoint?: string;
  chatCompletionsPath?: string;
  modelsPath?: string;
  messagesPath?: string;
  staticModels?: string[];
  defaultHeaders?: Record<string, string>;
  authHeader?: 'bearer' | 'x-api-key';
  supportsLiveModelDiscovery?: boolean;
  supportsReasoningEffort?: boolean;
};

export type ExtensionDescriptor = {
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  category?: string;
  enabledByDefault?: boolean;
  docsUrl?: string;
  tags?: string[];
  runtime: {
    binding: string;
    options?: ExtensionRuntimeOptions;
  };
  ui?: {
    color?: string;
    permissions?: ExtensionPermission[];
  };
  ownership?: {
    providerIds?: string[];
    modelPrefixes?: string[];
    toolNamespaces?: string[];
    capabilities?: string[];
    tools?: string[];
  };
  setup?: {
    authType?: ExtensionSetupAuthType;
    fields?: ExtensionSetupField[];
    envVars?: string[];
    scopes?: string[];
    callback?: {
      port?: number;
      path?: string;
    };
    browserLogin?: {
      url: string;
      checkUrl: string;
    };
    docsUrl?: string;
    docsHint?: string;
    statusMode?: 'generic' | 'oauth_connector' | 'codex_oauth' | 'anthropic_setup_token';
  };
  config?: {
    schema?: Record<string, unknown>;
    uiHints?: Record<string, { label?: string; help?: string }>;
    defaults?: Record<string, unknown>;
  };
  mcpPreset?: {
    transport?: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    envTemplate?: Record<string, string>;
    urlTemplate?: string;
    headersTemplate?: Record<string, string>;
  };
};

export type LoadedExtensionDescriptor = ExtensionDescriptor & {
  sourcePath: string;
};

export type ExtensionRegistry = {
  descriptors: LoadedExtensionDescriptor[];
  byId: Map<string, LoadedExtensionDescriptor>;
  byKind: Record<ExtensionKind, LoadedExtensionDescriptor[]>;
};
