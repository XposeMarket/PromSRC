function isLegacyCompatibilityConnection(record: any): boolean {
  return record?.adapterId === 'legacy'
    || record?.contractVersion === 1
    || record?.strategyId === 'legacy-compatibility';
}

export interface ConnectionOpsMcpStatus {
  status?: string;
  error?: string;
}

export interface ConnectionOpsLiveOverlay {
  connected: boolean;
  toolCount?: number;
}

export interface ConnectionOpsSummary {
  id: string;
  serviceId: string;
  serviceName: string;
  connected: boolean;
  authState: string;
  health: string;
  verified: boolean;
  toolCount: number;
  autoExposedToolCount: number;
  source?: 'legacy-compatibility';
  liveRuntime?: boolean;
  error?: string;
  action?: string;
}

export interface LiveConnectorLookup {
  getConnector(id: string): { isConnected?: () => boolean; toolNames?: string[] } | undefined;
  getTool?(name: string): unknown;
}

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function storedToolCount(connection: any): number {
  if (Array.isArray(connection?.availableTools)) return connection.availableTools.length;
  if (Array.isArray(connection?.registeredTools)) return connection.registeredTools.length;
  return 0;
}

function isMcpRuntimeInvalid(mcpStatus?: ConnectionOpsMcpStatus): boolean {
  if (!mcpStatus) return false;
  return mcpStatus.status === 'error'
    || /401|unauthori[sz]ed|revoked|invalid token/i.test(String(mcpStatus.error || ''));
}

/** Resolve a live extension-runtime overlay for a legacy-compatibility stub. */
export function liveOverlayForConnection(
  connection: any,
  lookup: LiveConnectorLookup,
): ConnectionOpsLiveOverlay | undefined {
  const ids = uniqueIds([
    connection?.configuration?.connectorId,
    connection?.serviceId,
    connection?.pluginId,
  ]);
  for (const id of ids) {
    const connector = lookup.getConnector(id);
    if (!connector) continue;
    let connected = false;
    try {
      connected = connector.isConnected?.() === true;
    } catch {
      connected = false;
    }
    const toolNames = Array.isArray(connector.toolNames) ? connector.toolNames : [];
    const registered = lookup.getTool
      ? toolNames.filter((name) => Boolean(lookup.getTool?.(name)))
      : toolNames;
    return {
      connected,
      toolCount: registered.length || toolNames.length,
    };
  }
  return undefined;
}

/**
 * Model-facing connection_ops list/status summary.
 *
 * Canonical v2 records keep the registered lifecycle gate. Legacy-compatibility
 * stubs were frozen with registered=false even when the live extension runtime
 * is connected, so those records overlay live connector status instead.
 */
export function summarizeConnectionOps(
  connection: any,
  options: {
    mcpStatus?: ConnectionOpsMcpStatus;
    live?: ConnectionOpsLiveOverlay;
  } = {},
): ConnectionOpsSummary {
  const runtimeInvalid = isMcpRuntimeInvalid(options.mcpStatus);
  const legacy = isLegacyCompatibilityConnection(connection);
  const liveKnown = typeof options.live?.connected === 'boolean';
  const liveConnected = options.live?.connected === true;
  const connected = runtimeInvalid
    ? false
    : legacy
      ? Boolean(connection?.enabled) && (liveKnown ? liveConnected : Boolean(connection?.authenticated))
      : Boolean(connection?.enabled && connection?.authenticated && connection?.registered);

  const summary: ConnectionOpsSummary = {
    id: String(connection?.id || ''),
    serviceId: String(connection?.serviceId || ''),
    serviceName: String(connection?.serviceName || ''),
    connected,
    authState: runtimeInvalid ? 'reauth_required' : String(connection?.authState || 'none'),
    health: runtimeInvalid
      ? 'unavailable'
      : liveConnected
        ? 'healthy'
        : liveKnown
          ? 'unavailable'
          : String(connection?.health || 'unknown'),
    verified: runtimeInvalid
      ? false
      : liveKnown
        ? liveConnected
        : Boolean(connection?.verified),
    toolCount: typeof options.live?.toolCount === 'number' ? options.live.toolCount : storedToolCount(connection),
    autoExposedToolCount: Array.isArray(connection?.exposedTools) ? connection.exposedTools.length : 0,
  };

  if (legacy) {
    summary.source = 'legacy-compatibility';
    summary.liveRuntime = liveKnown;
  }
  if (runtimeInvalid) {
    summary.error = String(options.mcpStatus?.error || 'MCP runtime unavailable').slice(0, 240);
    summary.action = 'reauthenticate';
  }
  return summary;
}
