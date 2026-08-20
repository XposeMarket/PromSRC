import { listExtensionDescriptors } from './registry.js';
import { getExtensionRuntimeRegistry } from './runtime-registry.js';
import { getDeclaredExtensionTools } from './tool-contracts.js';

export interface ConsistencyIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

/**
 * Structural guardrails for the extension registry. Run after the runtime is
 * loaded (ensurePrometheusExtensionRuntimeLoaded). Catches the failure modes the
 * legacy→native migration can introduce: manifest/registry drift, id/tool-name
 * collisions, and native connectors whose runtime.ts didn't register everything
 * their manifest claims.
 *
 * Pure/read-only: returns issues, never throws. Callers decide whether to warn
 * (runtime) or fail (scripts/verify-extensions.ts, CI).
 */
export function checkExtensionConsistency(): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const registry = getExtensionRuntimeRegistry();
  const registeredByName = new Map(registry.listTools().map((t) => [t.name, t]));

  // 1. Duplicate id within a kind.
  const seenIds = new Map<string, string>();
  for (const d of listExtensionDescriptors()) {
    const key = `${d.kind}:${d.id}`;
    const existing = seenIds.get(key);
    if (existing) {
      issues.push({ level: 'error', code: 'duplicate_id', message: `Duplicate ${key} in ${existing} and ${d.sourcePath}` });
    } else {
      seenIds.set(key, d.sourcePath);
    }
  }

  // 2. A tool name may be claimed by at most one connector manifest. Both the
  // modern contracts.tools field and the legacy ownership.tools field resolve
  // through the same canonical helper used by the connection planner.
  const toolClaim = new Map<string, string>();
  for (const d of listExtensionDescriptors('connector')) {
    for (const toolName of getDeclaredExtensionTools(d)) {
      const owner = toolClaim.get(toolName);
      if (owner && owner !== d.id) {
        issues.push({ level: 'error', code: 'tool_name_collision', message: `tool '${toolName}' claimed by both '${owner}' and '${d.id}'` });
      } else {
        toolClaim.set(toolName, d.id);
      }
    }
  }

  // 3. Declared connector tools ↔ registered tools.
  //    Native connectors MUST register everything they declare (hard error).
  //    Legacy connectors are warned (their tools may be conditional, e.g. x/xai
  //    tools only register when credentials exist).
  for (const d of listExtensionDescriptors('connector')) {
    const native = Boolean(d.runtime?.entrypoint);
    for (const toolName of getDeclaredExtensionTools(d)) {
      const reg = registeredByName.get(toolName);
      if (!reg) {
        issues.push({
          level: native ? 'error' : 'warn',
          code: 'missing_tool',
          message: `${d.id}: declared tool '${toolName}' is not registered${native ? ' (native connector)' : ''}`,
        });
        continue;
      }
      const ownerId = String((reg as { connectorId?: string }).connectorId || (reg as { extensionId?: string }).extensionId || '');
      if (ownerId && ownerId !== d.id && ownerId !== 'connectors') {
        issues.push({ level: 'warn', code: 'tool_owner_mismatch', message: `tool '${toolName}' registered under '${ownerId}' but owned by connector '${d.id}'` });
      }
    }
  }

  // 3b. Native runtime connector declarations must be exact, not merely
  // “at least one manifest tool registered”. This catches stale manifest lists,
  // stale runtime toolNames arrays, and implemented tools that would otherwise
  // exist in the runtime registry while remaining hidden from the connection
  // contract/model surface.
  const runtimeConnectors = new Map(registry.listConnectors().map((connector) => [connector.id, connector]));
  for (const d of listExtensionDescriptors('connector')) {
    if (!d.runtime?.entrypoint) continue;
    const runtime = runtimeConnectors.get(d.id);
    if (!runtime) {
      issues.push({ level: 'error', code: 'missing_connector_runtime', message: `${d.id}: native manifest has no registered connector runtime` });
      continue;
    }
    const manifestTools = new Set(getDeclaredExtensionTools(d));
    const runtimeTools = new Set((runtime.toolNames || []).map(String).filter(Boolean));
    const registeredConnectorTools = registry.listTools()
      .filter((tool) => String((tool as { connectorId?: string }).connectorId || '').trim() === d.id)
      .map((tool) => tool.name);

    for (const toolName of manifestTools) {
      if (!runtimeTools.has(toolName)) {
        issues.push({ level: 'error', code: 'runtime_tool_missing_from_connector', message: `${d.id}: declared tool '${toolName}' is missing from runtime connector toolNames` });
      }
    }
    for (const toolName of runtimeTools) {
      if (!manifestTools.has(toolName)) {
        issues.push({ level: 'error', code: 'runtime_tool_not_declared', message: `${d.id}: runtime connector declares '${toolName}' but the manifest contract does not own it` });
      }
      if (!registeredByName.has(toolName)) {
        issues.push({ level: 'error', code: 'runtime_tool_not_registered', message: `${d.id}: runtime connector declares '${toolName}' but no tool definition is registered` });
      }
    }
    for (const toolName of registeredConnectorTools) {
      if (!manifestTools.has(toolName)) {
        issues.push({ level: 'error', code: 'registered_tool_not_declared', message: `${d.id}: implemented tool '${toolName}' is registered at runtime but missing from the manifest contract` });
      }
      if (!runtimeTools.has(toolName)) {
        issues.push({ level: 'error', code: 'registered_tool_missing_from_connector', message: `${d.id}: implemented tool '${toolName}' is registered at runtime but missing from connector toolNames` });
      }
    }
  }

  // 4. Every mcp_preset manifest must carry a launchable mcpPreset block and be
  //    registered in the registry (source of truth for preset configs).
  const registeredPresetIds = new Set(registry.listMcpPresets().map((p) => p.id));
  for (const d of listExtensionDescriptors('mcp_preset')) {
    const preset = (d as { mcpPreset?: { transport?: string; command?: string; args?: unknown; urlTemplate?: string } }).mcpPreset;
    if (!preset) {
      issues.push({ level: 'error', code: 'mcp_preset_missing_block', message: `mcp_preset '${d.id}' has no mcpPreset block` });
      continue;
    }
    const hasLaunch = Boolean(preset.command || (Array.isArray(preset.args) && preset.args.length) || preset.urlTemplate);
    if (!hasLaunch) {
      issues.push({ level: 'error', code: 'mcp_preset_no_launch', message: `mcp_preset '${d.id}' has no command/args or urlTemplate` });
    }
    if (!registeredPresetIds.has(d.id)) {
      issues.push({ level: 'error', code: 'mcp_preset_unregistered', message: `mcp_preset '${d.id}' is not registered in the runtime registry` });
    }
  }

  return issues;
}

let logged = false;

/** Warn-only runtime surface. Logs once per process. */
export function logExtensionConsistencyOnce(): void {
  if (logged) return;
  logged = true;
  let issues: ConsistencyIssue[] = [];
  try {
    issues = checkExtensionConsistency();
  } catch {
    return;
  }
  for (const issue of issues) {
    const line = `[extensions:consistency] ${issue.code}: ${issue.message}`;
    if (issue.level === 'error') console.error(line);
    else console.warn(line);
  }
}
