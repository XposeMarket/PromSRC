import { listExtensionDescriptors } from '../extensions/registry.js';
import type {
  ExtensionRuntimeOptions,
  LoadedExtensionDescriptor,
} from '../extensions/types.js';

export type ProviderDescriptor = LoadedExtensionDescriptor & { kind: 'provider' };

function listDescriptors(): ProviderDescriptor[] {
  return listExtensionDescriptors('provider') as ProviderDescriptor[];
}

function descriptorOwnsProviderId(descriptor: ProviderDescriptor, providerId: string): boolean {
  if (descriptor.id === providerId) return true;
  return Boolean(descriptor.ownership?.providerIds?.includes(providerId));
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return listDescriptors();
}

export function listKnownProviderIds(): string[] {
  const ids = new Set<string>();
  for (const descriptor of listDescriptors()) {
    ids.add(descriptor.id);
    for (const providerId of descriptor.ownership?.providerIds || []) {
      ids.add(providerId);
    }
  }
  return [...ids];
}

export function isKnownProviderId(providerId: string): boolean {
  const normalized = String(providerId || '').trim();
  if (!normalized) return false;
  return listDescriptors().some((descriptor) => descriptorOwnsProviderId(descriptor, normalized));
}

export function getProviderDescriptor(providerId: string): ProviderDescriptor | undefined {
  const normalized = String(providerId || '').trim();
  if (!normalized) return undefined;
  return listDescriptors().find((descriptor) => descriptorOwnsProviderId(descriptor, normalized));
}

export function getProviderDefaultConfig(providerId: string): Record<string, unknown> {
  return { ...(getProviderDescriptor(providerId)?.config?.defaults || {}) };
}

export function getProviderRuntimeOptions(providerId: string): ExtensionRuntimeOptions {
  return { ...(getProviderDescriptor(providerId)?.runtime?.options || {}) };
}

export function getProviderSecretFields(providerId: string): string[] {
  return (getProviderDescriptor(providerId)?.setup?.fields || [])
    .filter((field) => field.secret)
    .map((field) => field.key);
}

export function listProviderSecretFieldPaths(): Array<[string, string]> {
  const paths: Array<[string, string]> = [];
  for (const providerId of listKnownProviderIds()) {
    for (const field of getProviderSecretFields(providerId)) {
      paths.push([providerId, field]);
    }
  }
  return paths;
}

export function getProviderStaticModels(providerId: string): string[] {
  return [...(getProviderRuntimeOptions(providerId).staticModels || [])];
}
