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
