// Shared helpers for native bundled connector runtime modules.
//
// Native connectors keep their auth/credential logic in the existing
// integrations/connectors/<id>.ts CLASS (OAuth refresh, vault access). These
// helpers are the one sanctioned bridge to fetch that live, authenticated
// instance and to shape results — so native modules don't each deep-import
// gateway internals.
import { getConnector, isConnectorConnected } from '../../../../integrations/connector-registry.js';
import type { PrometheusToolExecutionResult } from '../../../runtime-api.js';

export function toolOk(data: unknown): PrometheusToolExecutionResult {
  if (typeof data === 'string') return { result: data, error: false };
  return { result: JSON.stringify(data, null, 2), error: false };
}

export function toolError(message: string): PrometheusToolExecutionResult {
  return { result: message, error: true };
}

export function notConnected(displayName: string): PrometheusToolExecutionResult {
  return {
    result: `${displayName} is not connected. Connect it in the Connections panel, then try again.`,
    error: true,
  };
}

/** Live, startup-initialized connector instance (holds credentials/OAuth state). */
export function getLiveConnector<T>(connectorId: string): T | undefined {
  return getConnector(connectorId) as unknown as T | undefined;
}

export function connectorConnected(connectorId: string): boolean {
  try {
    return isConnectorConnected(connectorId);
  } catch {
    return false;
  }
}

export function connectorHasCredentials(connectorId: string): boolean {
  try {
    return Boolean((getConnector(connectorId) as { hasCredentials?: () => boolean } | undefined)?.hasCredentials?.());
  } catch {
    return false;
  }
}
