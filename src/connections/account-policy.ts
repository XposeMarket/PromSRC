import { createHash } from 'node:crypto';
import type { ConnectionRecord } from './types.js';

export interface AccountGrant {
  connectionId: string;
  principalId: string;
  capabilities: string[];
  resourceIds?: string[];
  expiresAt?: number;
}
/** Created from trusted runtime metadata, never deserialized from tool arguments. */
export interface AccountPrincipal {
  ownerId: string;
  principalId: string;
  isOwner: boolean;
  /** Delegation chains restrict rights at every hop; an empty hop denies everything. */
  grantLayers: readonly (readonly AccountGrant[])[];
}
export interface AccountBinding {
  connectionId: string;
  instanceId: string;
  serviceId: string;
  pluginId: string;
  ownerId: string;
  principalId: string;
  generation: number;
  policyRevision: number;
  identityDigest: string;
  actionDigest: string;
  capability: string;
  payloadDigest: string;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('INVALID_ACCOUNT_ACTION');
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function accountPayloadDigest(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INVALID_ACCOUNT_ACTION');
  const payload = { ...(args as Record<string, unknown>) };
  delete payload.connection_id; // host selector, independently bound to connectionId
  return digest(payload);
}
export function accountAuthorized(connection: ConnectionRecord, principal: AccountPrincipal, capability: string, resourceId?: string, now = Date.now()): boolean {
  if (!connection.accountAccess || connection.accountAccess.ownerId !== principal.ownerId) return false;
  if (principal.isOwner) return principal.principalId === principal.ownerId;
  if (!principal.grantLayers.length) return false;
  return principal.grantLayers.every(layer => layer.some(grant =>
    grant.connectionId === connection.id && grant.principalId === principal.principalId
    && (!grant.expiresAt || grant.expiresAt > now)
    && grant.capabilities.includes(capability)
    && (!grant.resourceIds || (!!resourceId && grant.resourceIds.includes(resourceId)))));
}
export function bindAccountAction(input: {
  connections: readonly ConnectionRecord[]; connectionId?: string; principal: AccountPrincipal;
  capability: string; resourceId?: string; tool: string; args: unknown; now?: number;
}): AccountBinding {
  const visible = input.connections.filter(record => accountAuthorized(record, input.principal, input.capability, input.resourceId, input.now));
  const selected = input.connectionId ? visible.find(record => record.id === input.connectionId)
    : input.principal.isOwner && visible.length === 1 ? visible[0] : undefined;
  if (!selected) throw new Error(input.connectionId ? 'ACCOUNT_UNAVAILABLE' : 'ACCOUNT_SELECTION_REQUIRED');
  if (!selected.enabled || !selected.authenticated || selected.authState !== 'healthy') throw new Error('ACCOUNT_REAUTH_REQUIRED');
  const access = selected.accountAccess!;
  return Object.freeze({ connectionId: selected.id, instanceId: access.instanceId, serviceId: selected.serviceId, pluginId: selected.pluginId, ownerId: access.ownerId,
    principalId: input.principal.principalId, generation: access.generation,
    policyRevision: access.policyRevision, capability: input.capability, payloadDigest: accountPayloadDigest(input.args), identityDigest: digest(selected.account || {}),
    actionDigest: digest({ tool: input.tool, args: input.args, capability: input.capability, resource: input.resourceId || null }) });
}
export function revalidateAccountAction(binding: AccountBinding, input: Parameters<typeof bindAccountAction>[0]): void {
  const current = bindAccountAction({ ...input, connectionId: binding.connectionId });
  if (Object.keys(binding).some(key => binding[key as keyof AccountBinding] !== current[key as keyof AccountBinding])) {
    throw new Error('ACCOUNT_APPROVAL_STALE');
  }
}
