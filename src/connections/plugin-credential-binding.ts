import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getVault } from '../security/vault';
import { pluginCredentialState, setPluginCredentialState } from '../security/plugin-credential-state';
import { bindingKeyFor, bindingKeyForSlug } from './connector-accounts';
type Binding = { reference: string; attemptId: string };
function read(directory: string): Record<string, Binding> {
  try { return JSON.parse(fs.readFileSync(path.join(directory, 'plugin-credential-bindings.json'), 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return {}; throw new Error('CREDENTIAL_BINDING_UNAVAILABLE'); }
}
export function bindPluginCredential(directory: string, serviceId: string, reference: string, attemptId: string): void {
  const owners = JSON.parse(fs.readFileSync(path.join(directory, 'connection-credential-owners.json'), 'utf8'));
  if (owners[reference]?.serviceId !== serviceId || owners[reference]?.attemptId !== attemptId) throw new Error('CREDENTIAL_BINDING_MISMATCH');
  const bindings = read(directory);
  setPluginCredentialState(directory, serviceId, true, 'replace-start');
  // Extra accounts bind under `<serviceId>::acct::<slug>` (active account scope); default keeps `serviceId`.
  const slot = bindingKeyFor(serviceId);
  const previous = bindings[slot];
  bindings[slot] = { reference, attemptId };
  const file = path.join(directory, 'plugin-credential-bindings.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(bindings), { mode: 0o600 }); fs.renameSync(temp, file);
  if (previous && previous.reference !== reference) getVault(directory).delete(previous.reference.replace(/^vault:/, ''), 'protected-plugin:replace');
  setPluginCredentialState(directory, serviceId, false, 'stored-not-verified');
}
/** handled=true forbids falling back to stale legacy/env credentials. */
export function resolveBoundPluginCredential(directory: string, serviceId: string, field: string): { handled: boolean; value?: string } {
  try {
    if (pluginCredentialState(directory, serviceId).stopped) return { handled: true };
    const binding = read(directory)[bindingKeyFor(serviceId)];
    // Missing binding file with a generation > 0 means credentials were once stored: fail closed, never fall back to legacy/env.
    if (!binding) return { handled: pluginCredentialState(directory, serviceId).generation > 0 };
    const owners = JSON.parse(fs.readFileSync(path.join(directory, 'connection-credential-owners.json'), 'utf8'));
    if (owners[binding.reference]?.serviceId !== serviceId || owners[binding.reference]?.attemptId !== binding.attemptId) return { handled: true };
    const raw = getVault(directory).get(binding.reference.replace(/^vault:/, ''), 'protected-plugin:consumer')?.expose();
    const value = raw ? JSON.parse(raw)[field] : undefined;
    return { handled: true, value: typeof value === 'string' ? value : undefined };
  } catch { return { handled: true }; }
}
export function deleteBoundPluginCredential(directory: string, serviceId: string): void {
  setPluginCredentialState(directory, serviceId, true, 'deleted');
  const binding = read(directory)[serviceId];
  if (binding) getVault(directory).delete(binding.reference.replace(/^vault:/, ''), 'protected-plugin:delete');
  // Retain a tombstone binding so legacy/env fallback cannot silently reconnect.
}

export function hasBoundPluginCredential(directory: string, serviceId: string, slug = ''): boolean {
  try { return Boolean(read(directory)[bindingKeyForSlug(serviceId, slug)]); } catch { return false; }
}

/** Remove one extra account's binding + vault value. Never touches the default slot. */
export function deleteAccountPluginCredential(directory: string, serviceId: string, slug: string): void {
  if (!slug) throw new Error('DEFAULT_ACCOUNT_PROTECTED');
  const bindings = read(directory);
  const key = bindingKeyForSlug(serviceId, slug);
  const binding = bindings[key];
  if (!binding) return;
  delete bindings[key];
  const file = path.join(directory, 'plugin-credential-bindings.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(bindings), { mode: 0o600 }); fs.renameSync(temp, file);
  getVault(directory).delete(binding.reference.replace(/^vault:/, ''), 'protected-plugin:account-remove');
}

/** Swap the default binding with an extra account's binding (make default). */
export function swapAccountPluginCredential(directory: string, serviceId: string, slug: string): void {
  const bindings = read(directory);
  const key = bindingKeyForSlug(serviceId, slug);
  if (!bindings[key]) throw new Error('ACCOUNT_NOT_FOUND');
  const previous = bindings[serviceId];
  bindings[serviceId] = bindings[key];
  if (previous) bindings[key] = previous; else delete bindings[key];
  const file = path.join(directory, 'plugin-credential-bindings.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(bindings), { mode: 0o600 }); fs.renameSync(temp, file);
}
