import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccountBinding } from './account-policy.js';

export interface BoundAccountExecution {
  binding: Readonly<AccountBinding>;
  serviceId: string;
  /** Re-read canonical lifecycle and caller grants immediately before credential use. */
  revalidate(): void;
}
const context = new AsyncLocalStorage<Readonly<BoundAccountExecution>>();
/** Internal runtime API only. Tool/model arguments cannot establish trusted execution context. */
export function withAccountExecution<T>(execution: BoundAccountExecution, run: () => T): T {
  execution.revalidate();
  const parent = context.getStore();
  if (parent && (parent.serviceId !== execution.serviceId
    || Object.keys(parent.binding).some(key => parent.binding[key as keyof AccountBinding] !== execution.binding[key as keyof AccountBinding]))) throw new Error('ACCOUNT_DELEGATION_WIDENING');
  return context.run(Object.freeze({ ...execution, binding: Object.freeze({ ...execution.binding }) }), run);
}
export function currentAccountExecution(serviceId?: string): Readonly<BoundAccountExecution> | undefined {
  const execution = context.getStore();
  if (!execution) return undefined;
  if (serviceId && serviceId !== execution.serviceId) throw new Error('ACCOUNT_SERVICE_MISMATCH');
  execution.revalidate();
  return execution;
}
