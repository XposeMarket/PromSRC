import type { AccountGrant, AccountPrincipal } from './account-policy.js';
import type { ConnectionRecord } from './types.js';

export interface TrustedAccountActor {
  kind: 'owner' | 'team' | 'agent' | 'task';
  ownerId: string;
  principalId: string;
  /** Trusted parent principals, never inferred from model arguments. */
  ancestors: readonly string[];
}

/** Convert persisted grants into an intersection for an already authenticated runtime actor.
 * This function cannot authenticate a session; the runtime must supply the actor out of band.
 */
export function resolveAccountPrincipal(actor: TrustedAccountActor, records: readonly ConnectionRecord[]): AccountPrincipal {
  if (!actor.ownerId || !actor.principalId || !Array.isArray(actor.ancestors)) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  if (actor.kind === 'owner') {
    if (actor.principalId !== actor.ownerId || actor.ancestors.length) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
    return { ownerId: actor.ownerId, principalId: actor.principalId, isOwner: true, grantLayers: [] };
  }
  if (!actor.principalId.startsWith(`${actor.kind}:`)) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  const principals = [...new Set([actor.principalId, ...actor.ancestors])];
  if (principals.some(id => !/^(team|agent|task):[^\s]{1,128}$/.test(id))) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  const grants = records.filter(record => record.accountAccess?.ownerId === actor.ownerId)
    .flatMap(record => (record.accountAccess?.grants || []).filter(grant => grant.connectionId === record.id));
  // Ancestor grants constrain the leaf actor. They do not change its identity or confer owner access.
  const grantLayers: AccountGrant[][] = principals.map(id => grants.filter(grant => grant.principalId === id)
    .map(grant => ({ ...structuredClone(grant), principalId: actor.principalId })));
  return { ownerId: actor.ownerId, principalId: actor.principalId, isOwner: false, grantLayers };
}
