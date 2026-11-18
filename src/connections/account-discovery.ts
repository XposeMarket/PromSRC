import type { ConnectionRecord } from './types.js';
import type { AccountPrincipal } from './account-policy.js';
import { accountAuthorized } from './account-policy.js';
import { publicAccountView } from './account-view.js';

/** Filter before projection: hidden personal labels/identities never enter worker results. */
export function discoverAccounts(records: readonly ConnectionRecord[], principal: AccountPrincipal,
  serviceId: string, capability: string, resourceId?: string) {
  return records.filter(record => record.serviceId === serviceId
    && accountAuthorized(record, principal, capability, resourceId))
    .map(publicAccountView);
}

/** Resolve identities using the executing host session, never a caller-supplied owner. */
export async function discoverSessionAccounts(sessionId: string, records: readonly ConnectionRecord[],
  serviceId: string, capability: string, resourceId?: string) {
  const { getAccountSessionAuthority } = await import('./account-session-authority.js');
  const { resolveAccountPrincipal } = await import('./account-principal.js');
  const principal = resolveAccountPrincipal(getAccountSessionAuthority(sessionId), records);
  return discoverAccounts(records, principal, serviceId, capability, resourceId);
}

/** Compact account choices for connector_list; deny by omission without authenticated authority. */
export async function sessionAccountChoices(sessionId: string, records: readonly ConnectionRecord[]) {
  const { getAccountSessionAuthority } = await import('./account-session-authority.js');
  const { resolveAccountPrincipal } = await import('./account-principal.js');
  let principal: AccountPrincipal;
  try { principal = resolveAccountPrincipal(getAccountSessionAuthority(sessionId), records); }
  catch { return []; }
  return records.filter(record => record.accountAccess && (principal.isOwner
    ? record.accountAccess.ownerId === principal.ownerId
    : (record.availableTools || []).some(tool => accountAuthorized(record, principal, tool))))
    .map(publicAccountView);
}
