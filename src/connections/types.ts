/** Canonical contracts for Prometheus's plugin-backed connection orchestrator. */

export const CONNECTION_SCHEMA_VERSION = 1 as const;
/** Additive connection contract marker. The durable file schema remains v1 so
 * existing records can still be read and rolled back without reauthorization. */
export const CONNECTOR_CONNECTION_CONTRACT_VERSION = 2 as const;

export type ConnectionAttemptState =
  | 'requested'
  | 'discovering'
  | 'research_required'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_secure_input'
  | 'awaiting_oauth'
  | 'awaiting_device_code'
  | 'awaiting_browser_login'
  | 'awaiting_cli_login'
  | 'awaiting_external_admin'
  | 'installing'
  | 'registering'
  | 'verifying'
  | 'connected'
  | 'degraded'
  | 'reauth_required'
  | 'failed'
  | 'cancelled';

export type ConnectionAuthState =
  | 'none'
  | 'pending'
  | 'healthy'
  | 'expired'
  | 'invalid'
  | 'reauth_required';

export type ConnectionHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export type ConnectionAdapterKind =
  | 'oauth-pkce'
  | 'connector-oauth'
  | 'oauth-device-code'
  | 'oauth-manual-callback'
  | 'api-key'
  | 'setup-token'
  | 'browser-session'
  | 'cli-login'
  | 'mcp-oauth'
  | 'mcp-stdio'
  | 'mcp-http'
  | 'local-resource'
  | 'custom-http'
  | 'openai-compatible-model'
  | 'external-admin-approval'
  | 'composite';

export type ConnectionToolRisk =
  | 'read-only'
  | 'write'
  | 'financial-mutation'
  | 'destructive'
  | 'credential-security'
  | 'unknown';

export interface ConnectionError {
  code: string;
  message: string;
  retryable?: boolean;
  phase?: ConnectionAttemptState;
  details?: Record<string, unknown>;
  occurredAt?: string;
}

export interface ConnectionProgress {
  id: string;
  at: string;
  state: ConnectionAttemptState;
  message: string;
  percent?: number;
  details?: Record<string, unknown>;
}

export interface ConnectionDiscoverySource {
  url?: string;
  title: string;
  sourceType: 'installed-plugin' | 'bundled-plugin' | 'marketplace' | 'official-docs' | 'official-package' | 'community' | 'generated';
  official: boolean;
  confidence: number;
  evidence?: string[];
}

export interface ConnectionStrategy {
  id: string;
  adapter: ConnectionAdapterKind | string;
  name?: string;
  priority?: number;
  capabilities: string[];
  capabilityContracts?: ConnectionCapabilityContract[];
  readOnly?: boolean;
  authentication?: {
    type: string;
    scopes?: string[];
    authorizationUrl?: string;
    tokenUrl?: string;
    revokeUrl?: string;
    pkceRequired?: boolean;
    nonceRequired?: boolean;
    callback?: { host?: string; port?: number; path?: string };
    clientIdEnv?: string;
    clientSecretEnv?: string;
  };
  configuration?: Record<string, unknown>;
  verification?: string[];
}

export interface ConnectionCapabilityContract {
  id: string;
  label?: string;
  description?: string;
  risk: 'read' | 'write' | 'high_impact';
}

export interface ConnectionPlan {
  id: string;
  serviceId: string;
  serviceName: string;
  pluginId?: string;
  strategy: ConnectionStrategy;
  alternatives?: ConnectionStrategy[];
  requestedCapabilities: string[];
  requestedScopes?: string[];
  sources?: ConnectionDiscoverySource[];
  installRequired?: boolean;
  permissions?: string[];
  risks?: string[];
  summary: string;
  createdAt: string;
}

export interface ConnectionDiscoveryMatch {
  serviceId: string;
  serviceName: string;
  pluginId?: string;
  score: number;
  matchedOn: string[];
}

export interface ConnectionDiscoveryResult {
  status: 'resolved' | 'ambiguous' | 'research_required';
  query: string;
  matches: ConnectionDiscoveryMatch[];
  canonicalServiceId?: string;
  nextAction?: 'plan' | 'select_match' | 'research_official_sources';
}

export interface OAuthConsentAction {
  type: 'oauth';
  label: string;
  authorizationUrl: string;
  scopes?: string[];
  expiresAt?: string;
  opensExternalBrowser?: boolean;
  desktopRequired?: boolean;
  desktopReason?: string;
}

export interface SecureSecretField {
  key: string;
  label: string;
  secret: true;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface SecureSecretInputAction {
  type: 'secure-input';
  label: string;
  credentialSessionId: string;
  fields: SecureSecretField[];
  expiresAt?: string;
}

export interface DeviceCodeAction {
  type: 'device-code';
  label: string;
  verificationUrl: string;
  userCode: string;
  expiresAt?: string;
  pollIntervalSeconds?: number;
}

export interface BrowserLoginAction {
  type: 'browser-login';
  label: string;
  url: string;
  completionHint?: string;
}

export interface CliLoginAction {
  type: 'cli-login';
  label: string;
  commandPreview: string;
  completionHint?: string;
}

export interface LocalResourcePermissionAction {
  type: 'local-resource';
  label: string;
  resourceKind: 'file' | 'directory' | 'application';
  requestedPath?: string;
}

export interface PackageInstallReviewAction {
  type: 'package-install-review';
  label: string;
  packageName: string;
  version?: string;
  source?: string;
  permissions?: string[];
}

export interface ScopeApprovalAction {
  type: 'scope-approval';
  label: string;
  scopes: string[];
  readOnly?: boolean;
}

export interface ExternalAdminApprovalAction {
  type: 'external-admin-approval';
  label: string;
  instructions: string;
  url?: string;
}

export interface ContinueOnDesktopAction {
  type: 'continue-on-desktop';
  label: string;
  reason: string;
  attemptId?: string;
}

export type ConnectionUserAction =
  | OAuthConsentAction
  | SecureSecretInputAction
  | DeviceCodeAction
  | BrowserLoginAction
  | CliLoginAction
  | LocalResourcePermissionAction
  | PackageInstallReviewAction
  | ScopeApprovalAction
  | ExternalAdminApprovalAction
  | ContinueOnDesktopAction;

export interface ConnectionAttempt {
  id: string;
  schemaVersion: typeof CONNECTION_SCHEMA_VERSION;
  serviceId: string;
  serviceName?: string;
  pluginId?: string;
  requestedCapabilities: string[];
  readOnly?: boolean;
  selectedStrategy?: string;
  state: ConnectionAttemptState;
  plan?: ConnectionPlan;
  requiredUserAction?: ConnectionUserAction;
  progress: ConnectionProgress[];
  error?: ConnectionError;
  connectionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ClassifiedConnectionTool {
  name: string;
  description?: string;
  risk: ConnectionToolRisk;
  capabilities?: string[];
  approved: boolean;
  classificationReason?: string;
}

export interface ConnectionCapabilityGrant {
  id: string;
  label?: string;
  risk: 'read' | 'write' | 'high_impact';
  granted: boolean;
  approvalRequired: boolean;
  source: 'manifest' | 'user' | 'legacy';
}

export interface ConnectionAccountIdentity {
  provider?: string;
  providerAccountId?: string;
  displayName?: string;
  username?: string;
  email?: string;
}

export interface ConnectionResourceIdentity {
  kind: string;
  id: string;
  displayName?: string;
  parentId?: string;
  scope?: string;
}

export interface ConnectionProviderAppMetadata {
  provider: string;
  appType: 'oauth-app' | 'github-app' | 'public-client' | 'confidential-client' | 'unknown';
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  pkceRequired: boolean;
  nonceRequired?: boolean;
  redirectUri?: string;
  externalSetupRequired?: boolean;
}

export interface ConnectionMigrationMarker {
  source: 'legacy' | 'canonical';
  target: 'connection-v2';
  version: number;
  migratedAt: string;
  rollbackSupported: boolean;
  legacyReadable: boolean;
}

export interface ConnectionVerificationResult {
  id: string;
  passed: boolean;
  check: string;
  message?: string;
  details?: Record<string, unknown>;
  verifiedAt: string;
}

export interface ConnectionRecord {
  id: string;
  schemaVersion: typeof CONNECTION_SCHEMA_VERSION;
  serviceId: string;
  serviceName?: string;
  pluginId: string;
  strategyId: string;
  adapterId?: string;
  installed: boolean;
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  registered: boolean;
  exposed: boolean;
  verified: boolean;
  authState: ConnectionAuthState;
  health: ConnectionHealth;
  contractVersion?: typeof CONNECTOR_CONNECTION_CONTRACT_VERSION | 1;
  migration?: ConnectionMigrationMarker;
  account?: ConnectionAccountIdentity;
  resources?: ConnectionResourceIdentity[];
  grantedCapabilities: string[];
  grantedScopes?: string[];
  capabilityGrants?: ConnectionCapabilityGrant[];
  providerApp?: ConnectionProviderAppMetadata;
  registeredTools: string[];
  /** All registered tools enabled for the model/action surface. */
  availableTools?: string[];
  /** Automatically exposed/read-safe subset; higher-risk tools still use the
   * normal per-call approval policy when they are available. */
  exposedTools: string[];
  tools?: ClassifiedConnectionTool[];
  credentialRef?: string;
  configuration?: Record<string, unknown>;
  verification?: ConnectionVerificationResult[];
  lastVerifiedAt?: string;
  lastHealthCheckAt?: string;
  lastError?: ConnectionError;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionAdapterContext {
  attempt: ConnectionAttempt;
  signal?: AbortSignal;
  credentialRef?: string;
  configuration?: Record<string, unknown>;
  emitProgress?: (message: string, details?: Record<string, unknown>) => void;
}

export interface ConnectionAdapterResult {
  state?: ConnectionAttemptState;
  userAction?: ConnectionUserAction;
  connection?: Partial<ConnectionRecord>;
  configuration?: Record<string, unknown>;
  error?: ConnectionError;
}

export interface ConnectionAdapter {
  id: string;
  kind: ConnectionAdapterKind | string;
  displayName: string;
  pluginId?: string;
  priority?: number;
  supports(strategy: ConnectionStrategy): boolean;
  prepare?(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult>;
  connect(context: ConnectionAdapterContext): Promise<ConnectionAdapterResult>;
  continue?(context: ConnectionAdapterContext, input?: Record<string, unknown>): Promise<ConnectionAdapterResult>;
  verify?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionVerificationResult[]>;
  repair?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<ConnectionAdapterResult>;
  disconnect?(context: ConnectionAdapterContext, connection: ConnectionRecord): Promise<void>;
}

export type ConnectionActivityType =
  | 'attempt.created'
  | 'attempt.updated'
  | 'attempt.completed'
  | 'connection.created'
  | 'connection.updated'
  | 'connection.verified'
  | 'connection.disconnected'
  | 'auth.required'
  | 'auth.failed'
  | 'error'
  | string;

export interface ConnectionActivity {
  id: string;
  type: ConnectionActivityType;
  at: string;
  serviceId?: string;
  attemptId?: string;
  connectionId?: string;
  pluginId?: string;
  message: string;
  details?: Record<string, unknown>;
}
