import { loadBundledExtensionDescriptors } from './loader.js';
import type {
  ExtensionKind,
  ExtensionRegistry,
  LoadedExtensionDescriptor,
} from './types.js';

let registryCache: ExtensionRegistry | null = null;

function toRegistryKey(kind: ExtensionKind, id: string): string {
  return `${kind}:${id}`;
}

function buildRegistry(): ExtensionRegistry {
  const descriptors = loadBundledExtensionDescriptors();
  const byId = new Map<string, LoadedExtensionDescriptor>();
  const byKind: Record<ExtensionKind, LoadedExtensionDescriptor[]> = {
    provider: [],
    connector: [],
    mcp_preset: [],
  };

  for (const descriptor of descriptors) {
    const registryKey = toRegistryKey(descriptor.kind, descriptor.id);
    if (byId.has(registryKey)) {
      const existing = byId.get(registryKey)!;
      throw new Error(
        `Duplicate extension "${descriptor.kind}:${descriptor.id}" in ${existing.sourcePath} and ${descriptor.sourcePath}`,
      );
    }
    byId.set(registryKey, descriptor);
    byKind[descriptor.kind].push(descriptor);
  }

  for (const kind of Object.keys(byKind) as ExtensionKind[]) {
    byKind[kind].sort((left, right) => left.name.localeCompare(right.name));
  }

  return { descriptors, byId, byKind };
}

export function clearExtensionRegistryCache(): void {
  registryCache = null;
}

export function getExtensionRegistry(): ExtensionRegistry {
  if (!registryCache) {
    registryCache = buildRegistry();
  }
  return registryCache;
}

export function listExtensionDescriptors(kind?: ExtensionKind): LoadedExtensionDescriptor[] {
  const registry = getExtensionRegistry();
  if (!kind) return registry.descriptors.slice();
  return registry.byKind[kind].slice();
}

export function getExtensionDescriptor(
  id: string,
  kind?: ExtensionKind,
): LoadedExtensionDescriptor | undefined {
  const registry = getExtensionRegistry();
  if (kind) return registry.byId.get(toRegistryKey(kind, id));
  return registry.descriptors.find((descriptor) => descriptor.id === id);
}
