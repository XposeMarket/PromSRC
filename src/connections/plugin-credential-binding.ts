import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getVault } from '../security/vault';
import { pluginCredentialState, setPluginCredentialState } from '../security/plugin-credential-state';
type Binding = { reference: string; attemptId: string; connectionId?: string };
function bindingScope(serviceId: string, connectionId?: string): string {
  if (!connectionId) return serviceId;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId)) throw new Error('INVALID_CONNECTION_ID');
  return `${serviceId}:account:${connectionId}`;
}
function read(directory: string): Record<string, Binding> {
  try { return JSON.parse(fs.readFileSync(path.join(directory, 'plugin-credential-bindings.json'), 'utf8')); }
  catch (error: any) { if (error?.code === 'ENOENT') return {}; throw new Error('CREDENTIAL_BINDING_UNAVAILABLE'); }
}
export function bindPluginCredential(directory: string, serviceId: string, reference: string, attemptId: string, connectionId?: string): void {
  const scope = bindingScope(serviceId, connectionId);
  const owners = JSON.parse(fs.readFileSync(path.join(directory, 'connection-credential-owners.json'), 'utf8'));
  if (owners[reference]?.serviceId !== serviceId || owners[reference]?.attemptId !== attemptId || owners[reference]?.connectionId !== connectionId) throw new Error('CREDENTIAL_BINDING_MISMATCH');
  const bindings = read(directory);
  if (Object.entries(bindings).some(([key, binding]) => key !== scope && binding.reference === reference)) throw new Error('CREDENTIAL_ALREADY_BOUND');
  setPluginCredentialState(directory, scope, true, 'replace-start');
  const previous = bindings[scope];
  bindings[scope] = { reference, attemptId, connectionId };
  const file = path.join(directory, 'plugin-credential-bindings.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(bindings), { mode: 0o600 }); fs.renameSync(temp, file);
  if (previous && previous.reference !== reference) getVault(directory).delete(previous.reference.replace(/^vault:/, ''), 'protected-plugin:replace');
  setPluginCredentialState(directory, scope, false, 'stored-not-verified');
}
/** handled=true forbids falling back to stale legacy/env credentials. */
export function resolveBoundPluginCredential(directory: string, serviceId: string, field: string, connectionId?: string): { handled: boolean; value?: string } {
  try {
    const scope = bindingScope(serviceId, connectionId);
    if (pluginCredentialState(directory, scope).stopped) return { handled: true };
    const binding = read(directory)[scope];
    // Missing binding file with a generation > 0 means credentials were once stored: fail closed, never fall back to legacy/env.
    if (!binding) return { handled: !!connectionId || pluginCredentialState(directory, scope).generation > 0 };
    if (binding.connectionId !== connectionId) return { handled: true };
    const owners = JSON.parse(fs.readFileSync(path.join(directory, 'connection-credential-owners.json'), 'utf8'));
    if (owners[binding.reference]?.serviceId !== serviceId || owners[binding.reference]?.attemptId !== binding.attemptId || owners[binding.reference]?.connectionId !== connectionId) return { handled: true };
    const raw = getVault(directory).get(binding.reference.replace(/^vault:/, ''), 'protected-plugin:consumer')?.expose();
    const value = raw ? JSON.parse(raw)[field] : undefined;
    return { handled: true, value: typeof value === 'string' ? value : undefined };
  } catch { return { handled: true }; }
}
export function deleteBoundPluginCredential(directory: string, serviceId: string, connectionId?: string): void {
  const scope = bindingScope(serviceId, connectionId);
  setPluginCredentialState(directory, scope, true, 'deleted');
  const binding = read(directory)[scope];
  if (binding) getVault(directory).delete(binding.reference.replace(/^vault:/, ''), 'protected-plugin:delete');
  // Retain a tombstone binding so legacy/env fallback cannot silently reconnect.
}
