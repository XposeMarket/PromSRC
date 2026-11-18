import { randomUUID } from 'node:crypto';
import type { ConnectionStore } from './connection-store.js';
import type { ConnectionRecord } from './types.js';

/** Canonical account lifecycle. Caller authority is checked by the host, never by model-supplied owner IDs. */
export class AccountLifecycle {
  constructor(private readonly store: ConnectionStore) {}
  add(template: Pick<ConnectionRecord, 'serviceId' | 'serviceName' | 'pluginId' | 'strategyId' | 'adapterId' | 'installed'>, ownerId: string, label: string, family: NonNullable<ConnectionRecord['accountAccess']>['family']): ConnectionRecord {
    if (!ownerId.trim() || !label.trim() || label.length > 256) throw new Error('INVALID_ACCOUNT_LABEL_OR_OWNER');
    const id = `connection_${randomUUID()}`;
    // Auth/transport/credentials must not be copied from the template account.
    return this.store.create({
      id, serviceId: template.serviceId, serviceName: template.serviceName, pluginId: template.pluginId,
      strategyId: template.strategyId, adapterId: template.adapterId, installed: template.installed,
      enabled: true, configured: false, authenticated: false, registered: false, exposed: false,
      verified: false, authState: 'none', health: 'unknown',
      grantedCapabilities: [], registeredTools: [], exposedTools: [],
      accountAccess: { ownerId, label: label.trim(), family, instanceId: family === 'mcp' ? `account_${id}` : id, generation: 1, policyRevision: 1 },
    });
  }
  rename(id: string, ownerId: string, label: string): ConnectionRecord {
    const record = this.owned(id, ownerId);
    if (!label.trim() || label.length > 256) throw new Error('INVALID_ACCOUNT_LABEL');
    return this.store.update(id, { accountAccess: { ...record.accountAccess!, label: label.trim() } });
  }
  async disconnect(id: string, ownerId: string, detach: (record: ConnectionRecord) => Promise<void>): Promise<ConnectionRecord> {
    const record = this.owned(id, ownerId);
    // Durable deny first. A failed provider detach never re-enables stale local access.
    const blocked = this.store.update(id, { enabled: false, authenticated: false, exposed: false,
      authState: 'none', accountAccess: { ...record.accountAccess!, generation: record.accountAccess!.generation + 1 } });
    await detach(blocked);
    return this.store.get(id)!;
  }
  private owned(id: string, ownerId: string): ConnectionRecord {
    const record = this.store.get(id);
    if (!record?.accountAccess || record.accountAccess.ownerId !== ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
    return record;
  }
}
