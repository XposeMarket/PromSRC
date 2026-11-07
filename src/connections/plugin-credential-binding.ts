import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getVault } from '../security/vault';
import { pluginCredentialState, setPluginCredentialState } from '../security/plugin-credential-state';
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
  const previous = bindings[serviceId];
  bindings[serviceId] = { reference, attemptId };
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
    const binding = read(directory)[serviceId];
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
