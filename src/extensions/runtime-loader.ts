import path from 'path';
import { listExtensionDescriptors } from './registry.js';
import { getExtensionRuntimeRegistry, registerBundledExtensionManifests } from './runtime-registry.js';
import type { PrometheusExtensionDefinition } from './runtime-api.js';

function isExtensionDefinition(value: unknown): value is PrometheusExtensionDefinition {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as any).id === 'string' &&
      typeof (value as any).register === 'function',
  );
}

function resolveRuntimeEntrypoint(sourcePath: string, entrypoint: string): string {
  if (path.isAbsolute(entrypoint)) return entrypoint;
  return path.resolve(path.dirname(sourcePath), entrypoint);
}

function readDefinitionFromModule(mod: any): PrometheusExtensionDefinition | null {
  const candidates = [
    mod,
    mod?.default,
    mod?.prometheusExtension,
    mod?.extension,
    mod?.definition,
  ];
  for (const candidate of candidates) {
    if (isExtensionDefinition(candidate)) return candidate;
  }
  return null;
}

// Bundled native connector entrypoints are authored as `runtime.ts` and compiled
// to `runtime.js` in dist. Manifests reference `./runtime.js`. In a compiled run
// that resolves directly; under tsx (dev / tests) only the `.ts` exists, so fall
// back to it. User plugins ship real `.js`, so they hit the first branch.
function requireEntrypointModule(modulePath: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(modulePath);
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' && /\.js$/.test(modulePath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(modulePath.replace(/\.js$/, '.ts'));
    }
    throw err;
  }
}

export function loadManifestRuntimeExtensions(): void {
  registerBundledExtensionManifests();
  const registry = getExtensionRuntimeRegistry();

  // Make the registry the source of truth for MCP preset launch configs: every
  // mcp_preset manifest's `mcpPreset` block (transport/command/args/env/url) is
  // registered here, so quick-setup / mcp_server_manage / the Connections UI can
  // read presets from one place instead of a hardcoded list.
  for (const descriptor of listExtensionDescriptors('mcp_preset')) {
    const preset = (descriptor as { mcpPreset?: Record<string, unknown> }).mcpPreset;
    if (!preset) continue;
    registry.registerMcpPreset(descriptor.id, {
      id: descriptor.id,
      name: descriptor.name,
      config: { ...preset, setup: descriptor.setup },
    });
  }

  for (const descriptor of listExtensionDescriptors()) {
    const entrypoint = descriptor.runtime.entrypoint;
    if (!entrypoint) continue;
    const modulePath = resolveRuntimeEntrypoint(descriptor.sourcePath, entrypoint);
    try {
      const mod = requireEntrypointModule(modulePath);
      const definition = readDefinitionFromModule(mod);
      if (!definition) {
        console.warn(`[extensions] ${descriptor.id} entrypoint did not export a Prometheus extension definition: ${modulePath}`);
        continue;
      }
      registry.registerDefinition({
        trustLevel: descriptor.trustLevel || 'bundled',
        activation: descriptor.activation,
        contracts: descriptor.contracts,
        ...definition,
      });
    } catch (err: any) {
      console.warn(`[extensions] Failed to load runtime entrypoint for ${descriptor.id}: ${String(err?.message || err)}`);
    }
  }
}
