import { bindAccountAction, revalidateAccountAction } from './account-policy.js';
import { resolveAccountPrincipal } from './account-principal.js';
import { getAccountSessionAuthority, getAccountSessionAuthorityVersion } from './account-session-authority.js';
import { withAccountExecution } from './account-execution-context.js';
import type { ConnectionRecord } from './types.js';

/** Resolve before the existing approval gate; revalidate after it, immediately before dispatch. */
export function prepareRuntimeAccountAction(input: {
  sessionId: string; serviceId: string; connectionId?: string; tool: string; capability?: string;
  args: Record<string, unknown>; readArgs?(): Record<string, unknown>; readConnections(): ConnectionRecord[];
}) {
  const read = () => {
    const records = input.readConnections();
    return { connections: records.filter(record => record.serviceId === input.serviceId),
      principal: resolveAccountPrincipal(getAccountSessionAuthority(input.sessionId), records),
      connectionId: input.connectionId, capability: input.capability || input.tool, tool: input.tool, args: input.readArgs ? input.readArgs() : input.args };
  };
  const authorityVersion = getAccountSessionAuthorityVersion(input.sessionId);
  const initial = read();
  const binding = bindAccountAction(initial);
  const selected = initial.connections.find(record => record.id === binding.connectionId)!;
  const revalidate = () => {
    if (getAccountSessionAuthorityVersion(input.sessionId) !== authorityVersion) throw new Error('ACCOUNT_AUTHORITY_CHANGED');
    revalidateAccountAction(binding, read());
  };
  return {
    binding,
    approvalAccount: { connectionId: binding.connectionId, serviceId: binding.serviceId,
      label: selected.accountAccess?.label || selected.serviceName || selected.serviceId,
      identity: selected.account?.email || selected.account?.displayName || selected.account?.username || '',
      generation: binding.generation, actionDigest: binding.actionDigest },
    run<T>(operation: () => T): T {
      return withAccountExecution({ binding, serviceId: input.serviceId, revalidate }, operation);
    },
  };
}
