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

export function loadManifestRuntimeExtensions(): void {
  registerBundledExtensionManifests();
  const registry = getExtensionRuntimeRegistry();
  for (const descriptor of listExtensionDescriptors()) {
    const entrypoint = descriptor.runtime.entrypoint;
    if (!entrypoint) continue;
    const modulePath = resolveRuntimeEntrypoint(descriptor.sourcePath, entrypoint);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(modulePath);
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
