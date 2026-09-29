import { getExtensionDescriptor } from '../extensions/registry';
import { getDeclaredExtensionTools } from '../extensions/tool-contracts.js';
import { classifyConnectorTools } from './connector-contract.js';
import type { ConnectionRecord } from './types';

/**
 * Native connector connections (connector-oauth adapter) snapshot the tool
 * list declared by the connector manifest at connect time. Without this
 * reconcile, every tool a later release adds to that connector (for example
 * `connector_gmail_api_request`) stays "not enabled for this connection"
 * forever, even though the runtime registers it.
 *
 * Policy:
 * - registeredTools always follows the current manifest (added + removed).
 * - availableTools grows with new tools only when the user had not narrowed
 *   it (it still equalled the old registered set, or was absent). A narrowed
 *   allowlist is preserved; removed tools are always pruned.
 * - New read-only tools join exposedTools when the connection already exposes
 *   read-only tools. Write tools stay approval-gated at call time as before.
 */

type ToolLookup = (pluginId: string) => string[] | null;

function uniqueSorted(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function defaultLookup(pluginId: string): string[] | null {
  const descriptor = getExtensionDescriptor(pluginId, 'connector' as any) || getExtensionDescriptor(pluginId);
  if (!descriptor) return null;
  const declared = getDeclaredExtensionTools(descriptor as any);
  return declared.length ? declared : null;
}

export function reconcileNativeConnectorRecord(
  record: ConnectionRecord,
  declaredTools: string[],
): Partial<ConnectionRecord> | null {
  const names = uniqueSorted(declaredTools);
  if (!names.length) return null;
  const previousRegistered = uniqueSorted(record.registeredTools);
  const hadExplicitAvailable = Array.isArray(record.availableTools);
  const previousAvailable = hadExplicitAvailable ? uniqueSorted(record.availableTools) : previousRegistered;
  const userNarrowed = hadExplicitAvailable && !sameList(previousAvailable, previousRegistered);
  const added = names.filter((tool) => !previousRegistered.includes(tool));

  const availableTools = userNarrowed
    ? previousAvailable.filter((tool) => names.includes(tool))
    : names;

  const classified = classifyConnectorTools(names, true);
  const previousExposed = uniqueSorted(record.exposedTools).filter((tool) => names.includes(tool));
  const exposesReads = previousExposed.length > 0;
  const newlyExposed = exposesReads
    ? classified.tools.filter((tool) => tool.approved && added.includes(tool.name) && availableTools.includes(tool.name)).map((tool) => tool.name)
    : [];
  const exposedTools = uniqueSorted([...previousExposed, ...newlyExposed]);

  const previousToolMeta = new Map((record.tools || []).map((tool) => [tool.name, tool]));
  const tools = classified.tools.map((tool) => previousToolMeta.get(tool.name) || tool);

  if (sameList(previousRegistered, names)
    && sameList(hadExplicitAvailable ? previousAvailable : names, availableTools)
    && sameList(uniqueSorted(record.exposedTools), exposedTools)) return null;

  return {
    registeredTools: names,
    availableTools,
    exposedTools,
    exposed: exposedTools.length > 0,
    tools,
  };
}

export function reconcileNativeConnectorToolSnapshots(
  store: { list(): ConnectionRecord[]; update(id: string, patch: Partial<ConnectionRecord>): unknown },
  lookup: ToolLookup = defaultLookup,
): string[] {
  const changed: string[] = [];
  for (const record of store.list()) {
    if (record.adapterId !== 'connector-oauth') continue;
    const pluginId = String(record.pluginId || record.serviceId || '').trim();
    if (!pluginId) continue;
    let declared: string[] | null = null;
    try { declared = lookup(pluginId); } catch { declared = null; }
    if (!declared) continue;
    const patch = reconcileNativeConnectorRecord(record, declared);
    if (!patch) continue;
    store.update(record.id, patch as any);
    changed.push(record.id);
  }
  return changed;
}
