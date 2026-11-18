import { bindAccountAction, revalidateAccountAction, type AccountPrincipal } from './account-policy.js';
import { withAccountExecution } from './account-execution-context.js';
import type { ConnectionRecord } from './types.js';

/** Host integration contract: the model cannot provide principal, grants, or approval callbacks. */
export interface AccountDispatchHost {
  readConnections(): readonly ConnectionRecord[];
  readPrincipal(): AccountPrincipal;
  approve(binding: ReturnType<typeof bindAccountAction>, action: Readonly<{ tool: string; args: unknown }>): Promise<boolean>;
}
export async function dispatchAccountAction<T>(host: AccountDispatchHost, input: {
  serviceId: string; connectionId?: string; capability: string; resourceId?: string;
  tool: string; args: unknown; requiresApproval: boolean;
}, execute: (args: unknown) => Promise<T>): Promise<T> {
  // Snapshot routing fields as well as arguments before the approval await.
  input = Object.freeze({ ...input });
  // Snapshot action before waiting: caller changes cannot redirect an already approved action.
  const args = structuredClone(input.args);
  const action = Object.freeze({ tool: input.tool, args });
  const state = () => ({ connections: host.readConnections().filter(record => record.serviceId === input.serviceId),
    principal: host.readPrincipal(), connectionId: input.connectionId, capability: input.capability,
    resourceId: input.resourceId, tool: action.tool, args: action.args });
  const binding = bindAccountAction(state());
  if (input.requiresApproval && !await host.approve(binding, action)) throw new Error('ACCOUNT_ACTION_NOT_APPROVED');
  const revalidate = () => revalidateAccountAction(binding, state());
  revalidate();
  return withAccountExecution({ binding, serviceId: input.serviceId, revalidate }, () => execute(structuredClone(args)));
}
