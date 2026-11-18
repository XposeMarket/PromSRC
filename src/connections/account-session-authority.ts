import type { TrustedAccountActor } from './account-principal.js';

const authorities = new Map<string, Readonly<TrustedAccountActor>>();
const parents = new Map<string, string>();
const authorityVersions = new Map<string, number>();
let nextAuthorityVersion = 0;
/** An admission lifetime, not just an identity. Revoked approvals never revive on re-admission. */
export function getAccountSessionAuthorityVersion(sessionId: string): number {
  getAccountSessionAuthority(sessionId);
  const version = authorityVersions.get(sessionId);
  if (version === undefined) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  return version;
}
/** Only authenticated host entrypoints may establish authority. Never expose as a tool. */
export function setAccountSessionAuthority(sessionId: string, actor: TrustedAccountActor): void {
  if (!sessionId || !actor.ownerId || !actor.principalId || !Array.isArray(actor.ancestors)
    || (actor.kind === 'owner' ? actor.principalId !== actor.ownerId || actor.ancestors.length > 0
      : !['team', 'agent', 'task'].includes(actor.kind) || !actor.principalId.startsWith(`${actor.kind}:`)
        || !/^(team|agent|task):[^\s]{1,128}$/.test(actor.principalId))
    || actor.ancestors.some(id => !/^(team|agent|task):[^\s]{1,128}$/.test(id))) {
    throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  }
  const previous = authorities.get(sessionId);
  if (previous && (previous.ownerId !== actor.ownerId || previous.principalId !== actor.principalId
    || previous.kind !== actor.kind || JSON.stringify(previous.ancestors) !== JSON.stringify(actor.ancestors))) {
    throw new Error('ACCOUNT_SESSION_REBIND_FORBIDDEN');
  }
  if (!previous) authorityVersions.set(sessionId, ++nextAuthorityVersion);
  authorities.set(sessionId, Object.freeze({ ...actor, ancestors: Object.freeze([...actor.ancestors]) }));
}
export function hasAccountSessionAuthority(sessionId: string): boolean { return authorities.has(sessionId); }
export function getAccountSessionAuthority(sessionId: string): Readonly<TrustedAccountActor> {
  const actor = authorities.get(sessionId);
  if (!actor) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  const parentId = parents.get(sessionId);
  if (parentId && getAccountSessionAuthority(parentId).ownerId !== actor.ownerId) throw new Error('ACCOUNT_PRINCIPAL_UNAVAILABLE');
  return actor;
}
/** Child authority is an intersection with every non-owner parent, not a copy of owner rights. */
export function delegateAccountSessionAuthority(parentSessionId: string, childSessionId: string,
  kind: 'team' | 'agent' | 'task', principalId: string): void {
  const parent = getAccountSessionAuthority(parentSessionId);
  if (!principalId.startsWith(`${kind}:`) || parentSessionId === childSessionId) throw new Error('ACCOUNT_DELEGATION_INVALID');
  let ancestor: string | undefined = parentSessionId;
  while (ancestor) {
    if (ancestor === childSessionId) throw new Error('ACCOUNT_DELEGATION_INVALID');
    ancestor = parents.get(ancestor);
  }
  if (parents.has(childSessionId) && parents.get(childSessionId) !== parentSessionId) throw new Error('ACCOUNT_SESSION_REBIND_FORBIDDEN');
  setAccountSessionAuthority(childSessionId, { ownerId: parent.ownerId, kind, principalId,
    ancestors: parent.kind === 'owner' ? [] : [...new Set([...parent.ancestors, parent.principalId])] });
  parents.set(childSessionId, parentSessionId);
}
export function clearAccountSessionAuthority(sessionId: string): void {
  for (const [child, parent] of [...parents]) if (parent === sessionId) clearAccountSessionAuthority(child);
  parents.delete(sessionId);
  authorities.delete(sessionId);
  authorityVersions.delete(sessionId);
}

/** Account logout/identity changes invalidate every pending root and delegated action. */
export function clearAllAccountSessionAuthorities(): void {
  authorities.clear();
  parents.clear();
  authorityVersions.clear();
  // Do not reset nextAuthorityVersion: re-login must not recycle approval lifetimes.
}
