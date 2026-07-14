import { loadBundledExtensionDescriptors, loadUserExtensionDescriptors } from './loader.js';
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
  const bundled = loadBundledExtensionDescriptors();
  // User plugins are best-effort: a bad one is skipped in the loader, and one
  // that collides with a bundled id is skipped here so users can never shadow
  // or break an official connector.
  const user = safeLoadUserExtensionDescriptors();

  const descriptors: LoadedExtensionDescriptor[] = [];
  const byId = new Map<string, LoadedExtensionDescriptor>();
  const byKind: Record<ExtensionKind, LoadedExtensionDescriptor[]> = {
    provider: [],
    connector: [],
    mcp_preset: [],
    integration: [],
  };

  for (const descriptor of bundled) {
    const registryKey = toRegistryKey(descriptor.kind, descriptor.id);
    if (byId.has(registryKey)) {
      const existing = byId.get(registryKey)!;
      throw new Error(
        `Duplicate extension "${descriptor.kind}:${descriptor.id}" in ${existing.sourcePath} and ${descriptor.sourcePath}`,
      );
    }
    byId.set(registryKey, descriptor);
    byKind[descriptor.kind].push(descriptor);
    descriptors.push(descriptor);
  }

  for (const descriptor of user) {
    const registryKey = toRegistryKey(descriptor.kind, descriptor.id);
    if (byId.has(registryKey)) {
      console.warn(
        `[extensions] User plugin "${descriptor.kind}:${descriptor.id}" (${descriptor.sourcePath}) conflicts with a bundled extension and was skipped.`,
      );
      continue;
    }
    byId.set(registryKey, descriptor);
    byKind[descriptor.kind].push(descriptor);
    descriptors.push(descriptor);
  }

  for (const kind of Object.keys(byKind) as ExtensionKind[]) {
    byKind[kind].sort((left, right) => left.name.localeCompare(right.name));
  }

  return { descriptors, byId, byKind };
}

function safeLoadUserExtensionDescriptors(): LoadedExtensionDescriptor[] {
  try {
    return loadUserExtensionDescriptors();
  } catch (err: any) {
    console.warn(`[extensions] Failed to scan user plugins dir: ${String(err?.message || err)}`);
    return [];
  }
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
