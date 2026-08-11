import {
  CONNECTION_SCHEMA_VERSION,
  ConnectionAttempt,
  ConnectionAttemptState,
  ConnectionRecord,
} from './types';

export const CONNECTION_ATTEMPT_STATES: readonly ConnectionAttemptState[] = [
  'requested', 'discovering', 'research_required', 'planning', 'awaiting_approval', 'awaiting_secure_input',
  'awaiting_oauth', 'awaiting_device_code', 'awaiting_browser_login', 'awaiting_cli_login',
  'awaiting_external_admin', 'installing', 'registering', 'verifying', 'connected',
  'degraded', 'reauth_required', 'failed', 'cancelled',
];

export const TERMINAL_CONNECTION_ATTEMPT_STATES: readonly ConnectionAttemptState[] = [
  'connected', 'failed', 'cancelled',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSafeIdentity(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    ['provider', 'providerAccountId', 'displayName', 'username', 'email'].includes(key)
      ? typeof item === 'string' && item.length <= 256
      : false,
  );
}

function isResourceIdentity(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.kind === 'string' && typeof value.id === 'string'
    && value.kind.length <= 256 && value.id.length <= 256
    && (value.displayName === undefined || typeof value.displayName === 'string')
    && (value.parentId === undefined || typeof value.parentId === 'string')
    && (value.scope === undefined || typeof value.scope === 'string');
}

function isCapabilityGrant(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && ['read', 'write', 'high_impact'].includes(String(value.risk))
    && typeof value.granted === 'boolean'
    && typeof value.approvalRequired === 'boolean'
    && ['manifest', 'user', 'legacy'].includes(String(value.source));
}

function isProviderAppMetadata(value: unknown): boolean {
  if (!isObject(value)) return false;
  const allowed = ['provider', 'appType', 'clientIdConfigured', 'clientSecretConfigured', 'pkceRequired', 'nonceRequired', 'redirectUri', 'externalSetupRequired'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  return typeof value.provider === 'string'
    && ['oauth-app', 'github-app', 'public-client', 'confidential-client', 'unknown'].includes(String(value.appType))
    && typeof value.clientIdConfigured === 'boolean'
    && typeof value.clientSecretConfigured === 'boolean'
    && typeof value.pkceRequired === 'boolean'
    && (value.nonceRequired === undefined || typeof value.nonceRequired === 'boolean')
    && (value.redirectUri === undefined || typeof value.redirectUri === 'string')
    && (value.externalSetupRequired === undefined || typeof value.externalSetupRequired === 'boolean');
}

export function isConnectionAttemptState(value: unknown): value is ConnectionAttemptState {
  return typeof value === 'string' && CONNECTION_ATTEMPT_STATES.includes(value as ConnectionAttemptState);
}

export function isConnectionAttempt(value: unknown): value is ConnectionAttempt {
  if (!isObject(value)) return false;
  return value.schemaVersion === CONNECTION_SCHEMA_VERSION
    && typeof value.id === 'string'
    && typeof value.serviceId === 'string'
    && isStringArray(value.requestedCapabilities)
    && isConnectionAttemptState(value.state)
    && Array.isArray(value.progress)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

export function isConnectionRecord(value: unknown): value is ConnectionRecord {
  if (!isObject(value)) return false;
  const booleans = ['installed', 'enabled', 'configured', 'authenticated', 'registered', 'exposed', 'verified'];
  return value.schemaVersion === CONNECTION_SCHEMA_VERSION
    && typeof value.id === 'string'
    && typeof value.serviceId === 'string'
    && typeof value.pluginId === 'string'
    && typeof value.strategyId === 'string'
    && booleans.every((key) => typeof value[key] === 'boolean')
    && isStringArray(value.grantedCapabilities)
    && isStringArray(value.registeredTools)
    && isStringArray(value.exposedTools)
    && typeof value.authState === 'string'
    && typeof value.health === 'string'
    && (value.contractVersion === undefined || value.contractVersion === 1 || value.contractVersion === 2)
    && (value.account === undefined || isSafeIdentity(value.account))
    && (value.resources === undefined || (Array.isArray(value.resources) && value.resources.every(isResourceIdentity)))
    && (value.capabilityGrants === undefined || (Array.isArray(value.capabilityGrants) && value.capabilityGrants.every(isCapabilityGrant)))
    && (value.providerApp === undefined || isProviderAppMetadata(value.providerApp))
    && (value.availableTools === undefined || isStringArray(value.availableTools))
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

export function assertConnectionAttempt(value: unknown): asserts value is ConnectionAttempt {
  if (!isConnectionAttempt(value)) throw new Error('Invalid connection attempt record');
}

export function assertConnectionRecord(value: unknown): asserts value is ConnectionRecord {
  if (!isConnectionRecord(value)) throw new Error('Invalid canonical connection record');
}

export function isTerminalConnectionAttemptState(state: ConnectionAttemptState): boolean {
  return TERMINAL_CONNECTION_ATTEMPT_STATES.includes(state);
}

/** Allowed transitions protect durable attempts from accidental state regression. */
export const CONNECTION_STATE_TRANSITIONS: Readonly<Record<ConnectionAttemptState, readonly ConnectionAttemptState[]>> = {
  requested: ['discovering', 'planning', 'cancelled', 'failed'],
  discovering: ['research_required', 'planning', 'awaiting_approval', 'cancelled', 'failed'],
  research_required: ['discovering', 'planning', 'cancelled', 'failed'],
  planning: ['awaiting_approval', 'awaiting_secure_input', 'awaiting_oauth', 'awaiting_device_code', 'awaiting_browser_login', 'awaiting_cli_login', 'awaiting_external_admin', 'installing', 'registering', 'cancelled', 'failed'],
  awaiting_approval: ['awaiting_secure_input', 'awaiting_oauth', 'awaiting_device_code', 'awaiting_browser_login', 'awaiting_cli_login', 'awaiting_external_admin', 'installing', 'registering', 'verifying', 'cancelled', 'failed'],
  awaiting_secure_input: ['registering', 'verifying', 'reauth_required', 'cancelled', 'failed'],
  awaiting_oauth: ['registering', 'verifying', 'reauth_required', 'cancelled', 'failed'],
  awaiting_device_code: ['registering', 'verifying', 'reauth_required', 'cancelled', 'failed'],
  awaiting_browser_login: ['registering', 'verifying', 'reauth_required', 'cancelled', 'failed'],
  awaiting_cli_login: ['registering', 'verifying', 'reauth_required', 'cancelled', 'failed'],
  awaiting_external_admin: ['registering', 'verifying', 'cancelled', 'failed'],
  installing: ['registering', 'verifying', 'cancelled', 'failed'],
  registering: ['verifying', 'degraded', 'reauth_required', 'failed'],
  verifying: ['connected', 'degraded', 'reauth_required', 'failed'],
  connected: ['verifying', 'degraded', 'reauth_required', 'cancelled'],
  degraded: ['verifying', 'connected', 'reauth_required', 'awaiting_secure_input', 'awaiting_oauth', 'awaiting_device_code', 'awaiting_browser_login', 'awaiting_cli_login', 'failed', 'cancelled'],
  reauth_required: ['awaiting_secure_input', 'awaiting_oauth', 'awaiting_device_code', 'awaiting_browser_login', 'awaiting_cli_login', 'failed', 'cancelled'],
  failed: ['discovering', 'planning', 'cancelled'],
  cancelled: [],
};

export function canTransitionConnectionAttempt(from: ConnectionAttemptState, to: ConnectionAttemptState): boolean {
  return from === to || CONNECTION_STATE_TRANSITIONS[from].includes(to);
}
