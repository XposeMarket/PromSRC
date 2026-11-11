import type { ConnectionRecord } from '../connections/types.js';
import { isLegacyCompatibilityConnection } from '../connections/connection-ops-summary.js';

export type CatalogConnectorState = Record<string, unknown>;

export interface CatalogConnectorLiveStatus {
  connected: boolean;
}

/**
 * Pick the connection record that describes a connector on the Plugins page.
 * A canonical v2 record always wins. A legacy-compatibility stub is used only
 * when it is the service's sole record, so a newer stub can never mask it.
 */
export function pickCatalogConnectionRecord(records: ConnectionRecord[]): ConnectionRecord | undefined {
  return records.find((record) => !isLegacyCompatibilityConnection(record)) || records[0];
}

/**
 * Overlay a stored connection record on the live connector state.
 *
 * Canonical v2 records carry real lifecycle fields (registered, verified, tool
 * allowlist). Legacy-compatibility stubs were frozen at migration time with
 * registered=false, verified=false and no tools even while the built-in runtime
 * is connected and serving tools, so for those the live status is the authority
 * and the tool list comes from the connector descriptor.
 */
export function overlayConnectionOnConnectorState(
  base: CatalogConnectorState,
  latest: ConnectionRecord,
  liveStatus: CatalogConnectorLiveStatus | undefined,
  descriptorTools: string[] = [],
): CatalogConnectorState {
  const liveKnown = liveStatus !== undefined;

  if (isLegacyCompatibilityConnection(latest)) {
    const connected = liveKnown ? liveStatus.connected === true : base.connected === true;
    const needsReauth = !connected && liveKnown && latest.authenticated === true;
    const tools = connected ? [...descriptorTools] : [];
    return {
      ...base,
      connectionId: latest.id,
      connected,
      configured: connected || base.hasCredentials === true,
      authenticated: connected,
      registered: connected,
      exposed: connected,
      verified: connected,
      authState: needsReauth ? 'reauth_required' : connected ? 'healthy' : 'none',
      health: needsReauth ? 'degraded' : connected ? 'healthy' : 'unknown',
      contractVersion: latest.contractVersion,
      legacyRuntime: true,
      account: latest.account || base.account,
      grantedScopes: latest.grantedScopes || base.grantedScopes,
      registeredTools: tools,
      availableTools: tools,
      exposedTools: [],
      lastError: connected ? undefined : latest.lastError,
    };
  }

  const liveConnected = latest.authenticated && (!liveKnown || liveStatus.connected);
  const needsReauth = latest.authenticated && liveKnown && !liveStatus.connected;
  return {
    ...base,
    connectionId: latest.id,
    connected: liveConnected,
    configured: latest.configured,
    authenticated: liveConnected,
    registered: latest.registered,
    exposed: liveConnected && latest.exposed,
    verified: latest.verified && liveConnected,
    authState: needsReauth ? 'reauth_required' : latest.authState,
    health: needsReauth ? 'degraded' : latest.health,
    contractVersion: latest.contractVersion,
    migration: latest.migration,
    account: latest.account || base.account,
    resources: latest.resources,
    grantedCapabilities: latest.grantedCapabilities,
    grantedScopes: latest.grantedScopes || base.grantedScopes,
    capabilityGrants: latest.capabilityGrants,
    registeredTools: latest.registeredTools,
    availableTools: latest.availableTools || latest.registeredTools,
    exposedTools: liveConnected ? latest.exposedTools : [],
    tools: latest.tools,
    providerApp: latest.providerApp,
    verification: latest.verification,
    lastVerifiedAt: latest.lastVerifiedAt,
    lastHealthCheckAt: latest.lastHealthCheckAt,
    lastError: latest.lastError,
  };
}
