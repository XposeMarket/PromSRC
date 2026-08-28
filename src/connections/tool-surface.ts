import { getConfig } from '../config/config.js';
import { ConnectionStore } from './connection-store.js';
import type { ConnectionRecord } from './types.js';

/**
 * The host-owned boundary between a connected integration and the model tool
 * surface.
 *
 * `registeredTools` describes what the runtime implements. `availableTools`
 * describes what the authenticated connection has enabled for the model. The
 * older `exposedTools` field is the automatically exposed/read-safe subset;
 * write and higher-risk tools can still be available and are protected by the
 * normal tool approval policy at execution time. This mirrors the useful
 * separation used by mature MCP/plugin clients: connection permission,
 * tool selection, and per-call approval are different decisions.
 */

const CACHE_TTL_MS = 500;

export interface ConnectionToolSurfaceDecision {
  managed: boolean;
  available: boolean;
  /** True when the tool is in the connection's automatic/read-safe grant. */
  exposed: boolean;
  reason: string;
  connectionIds: string[];
  registeredTools: string[];
  availableTools: string[];
  exposedTools: string[];
}

interface SurfaceCache {
  configDir: string;
  loadedAt: number;
  records: ConnectionRecord[];
  error?: string;
}

let cache: SurfaceCache | null = null;

function uniqueSorted(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

/** Legacy migration records intentionally retain the pre-canonical runtime. */
export function isLegacyCompatibilityConnection(record: ConnectionRecord): boolean {
  return record.adapterId === 'legacy'
    || record.contractVersion === 1
    || record.strategyId === 'legacy-compatibility';
}

function matchesTarget(record: ConnectionRecord, targetId: string): boolean {
  const target = String(targetId || '').trim();
  if (!target) return false;
  const configuration = record.configuration || {};
  return [
    record.serviceId,
    record.pluginId,
    configuration.connectorId,
    configuration.mcpServerId,
  ].some((value) => String(value || '').trim() === target);
}

function isOperational(record: ConnectionRecord): boolean {
  return record.enabled === true
    && record.configured === true
    && record.authenticated === true
    && record.registered === true
    && record.authState === 'healthy'
    && record.health !== 'unavailable';
}

function availableToolsFor(record: ConnectionRecord): string[] {
  // `availableTools` was added after the first v2 records were written. An
  // absent field means “all registered tools,” while an explicit empty array
  // is a deliberate disable-all choice.
  return Array.isArray(record.availableTools)
    ? uniqueSorted(record.availableTools)
    : uniqueSorted(record.registeredTools);
}

function emptyDecision(reason: string, managed: boolean): ConnectionToolSurfaceDecision {
  return {
    managed,
    available: false,
    exposed: false,
    reason,
    connectionIds: [],
    registeredTools: [],
    availableTools: [],
    exposedTools: [],
  };
}

function loadRecords(): SurfaceCache {
  const configDir = getConfig().getConfigDir();
  const now = Date.now();
  if (cache && cache.configDir === configDir && now - cache.loadedAt <= CACHE_TTL_MS) return cache;

  try {
    cache = { configDir, loadedAt: now, records: new ConnectionStore(configDir).list() };
  } catch (error) {
    cache = {
      configDir,
      loadedAt: now,
      records: [],
      error: String((error as any)?.message || error),
    };
  }
  return cache;
}

/** Clear the short-lived read cache after a connection or grant mutation. */
export function invalidateConnectionToolSurfaceCache(): void {
  cache = null;
}

/**
 * Keep a managed MCP record's registration snapshot in sync after a server
 * emits `notifications/tools/list_changed` or an operator presses Refresh.
 * Existing explicit allowlists are preserved; newly discovered tools are not
 * silently added to an explicit allowlist.
 */
export function reconcileManagedConnectionTools(targetId: string, toolNames: string[]): void {
  const configDir = getConfig().getConfigDir();
  const store = new ConnectionStore(configDir);
  const names = uniqueSorted(toolNames);
  for (const record of store.list().filter((item) => matchesTarget(item, targetId) && !isLegacyCompatibilityConnection(item))) {
    const previousAvailable = Array.isArray(record.availableTools) ? uniqueSorted(record.availableTools) : null;
    const availableTools = previousAvailable
      ? previousAvailable.filter((tool) => names.includes(tool))
      : names;
    const exposedTools = uniqueSorted(record.exposedTools).filter((tool) => names.includes(tool));
    const registeredTools = uniqueSorted(record.registeredTools);
    if (JSON.stringify(registeredTools) === JSON.stringify(names)
      && JSON.stringify(previousAvailable || names) === JSON.stringify(availableTools)
      && JSON.stringify(uniqueSorted(record.exposedTools)) === JSON.stringify(exposedTools)) continue;
    store.update(record.id, {
      registeredTools: names,
      availableTools,
      exposedTools,
      exposed: exposedTools.length > 0,
      tools: (record.tools || []).filter((tool) => names.includes(tool.name)),
    });
  }
  invalidateConnectionToolSurfaceCache();
}

export function resolveConnectionToolExposure(
  records: ConnectionRecord[],
  targetId: string,
  toolName: string,
): ConnectionToolSurfaceDecision {
  const matching = records.filter((record) => matchesTarget(record, targetId));
  const canonical = matching.filter((record) => !isLegacyCompatibilityConnection(record));

  if (!canonical.length) {
    return {
      managed: false,
      available: true,
      exposed: true,
      reason: 'legacy-compatibility',
      connectionIds: matching.map((record) => record.id),
      registeredTools: [],
      availableTools: [],
      exposedTools: [],
    };
  }

  const operational = canonical.filter(isOperational);
  if (!operational.length) {
    const decision = emptyDecision('connection-not-operational', true);
    decision.connectionIds = canonical.map((record) => record.id);
    decision.registeredTools = [...new Set(canonical.flatMap((record) => uniqueSorted(record.registeredTools)))].sort();
    decision.availableTools = [...new Set(canonical.flatMap((record) => availableToolsFor(record)))].sort();
    decision.exposedTools = [...new Set(canonical.flatMap((record) => uniqueSorted(record.exposedTools)))].sort();
    return decision;
  }

  const registeredTools = [...new Set(operational.flatMap((record) => uniqueSorted(record.registeredTools)))].sort();
  const availableTools = [...new Set(operational.flatMap((record) => availableToolsFor(record)))].sort();
  const exposedTools = [...new Set(operational.flatMap((record) => uniqueSorted(record.exposedTools)))].sort();
  const name = String(toolName || '').trim();
  const available = operational.some((record) => {
    const registered = new Set(uniqueSorted(record.registeredTools));
    return registered.has(name) && new Set(availableToolsFor(record)).has(name);
  });
  const exposed = available && operational.some((record) => uniqueSorted(record.exposedTools).includes(name));
  return {
    managed: true,
    available,
    exposed,
    reason: available ? (exposed ? 'auto-exposed' : 'approval-gated') : 'tool-not-enabled',
    connectionIds: operational.map((record) => record.id),
    registeredTools,
    availableTools,
    exposedTools,
  };
}

export function getConnectionToolExposure(targetId: string, toolName: string): ConnectionToolSurfaceDecision {
  const loaded = loadRecords();
  if (loaded.error) return emptyDecision(`connection-store-unavailable: ${loaded.error}`, true);
  return resolveConnectionToolExposure(loaded.records, targetId, toolName);
}

/** Model-facing availability check for native connector tools. */
export function isManagedConnectorToolAvailable(connectorId: string, toolName: string): boolean {
  return getConnectionToolExposure(connectorId, toolName).available;
}

/** Model-facing availability check for dynamically discovered MCP tools. */
export function isManagedMcpToolAvailable(serverId: string, toolName: string): boolean {
  return getConnectionToolExposure(serverId, toolName).available;
}
