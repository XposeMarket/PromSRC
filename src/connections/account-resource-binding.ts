import { currentAccountExecution } from './account-execution-context.js';
import type { ConnectionRecord } from './types.js';

/** Resolve a resource only from the canonical selected connection, never from caller arguments. */
export function selectedAccountResource(serviceId: string, read: (id: string) => ConnectionRecord | undefined): string | undefined {
  const execution = currentAccountExecution(serviceId);
  if (!execution) return undefined;
  const record = read(execution.binding.connectionId);
  if (!record || record.id !== execution.binding.connectionId || record.serviceId !== serviceId
    || record.accountAccess?.instanceId !== execution.binding.instanceId
    || record.accountAccess?.ownerId !== execution.binding.ownerId) throw new Error('ACCOUNT_RESOURCE_UNAVAILABLE');
  const resourceId = record.configuration?.resourceId;
  if (typeof resourceId !== 'string' || !resourceId.trim()) throw new Error('ACCOUNT_RESOURCE_UNAVAILABLE');
  execution.revalidate();
  return resourceId;
}

export function requireSelectedResource(selected: string | undefined, requested: unknown): string | undefined {
  const resourceId = typeof requested === 'string' ? requested.trim() : undefined;
  if (selected && resourceId && selected !== resourceId) throw new Error('ACCOUNT_RESOURCE_MISMATCH');
  return selected || resourceId || undefined;
}
