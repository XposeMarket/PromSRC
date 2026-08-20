import type { ExtensionDescriptor } from './types.js';

/**
 * Canonical declared tool surface for an extension.
 *
 * Newer manifests may use `contracts.tools`; older bundled connectors still
 * use `ownership.tools`. An explicitly present contracts.tools array wins,
 * including an explicit empty array. Keeping this rule in one place prevents
 * the connection planner, runtime registry, and consistency checks from
 * silently disagreeing about which tools a connector owns.
 */
export function getDeclaredExtensionTools(
  descriptor: Pick<ExtensionDescriptor, 'contracts' | 'ownership'> | null | undefined,
): string[] {
  const declared = Array.isArray(descriptor?.contracts?.tools)
    ? descriptor!.contracts!.tools
    : descriptor?.ownership?.tools;

  if (!Array.isArray(declared)) return [];
  return [...new Set(declared.map((tool) => String(tool || '').trim()).filter(Boolean))];
}
