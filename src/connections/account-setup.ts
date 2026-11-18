import type { ConnectionRecord } from './types.js';
import type { ConnectionStore } from './connection-store.js';
import type { AccountLifecycle } from './account-lifecycle.js';
import type { ConnectionStartService } from './start-service.js';

/** Host-only setup orchestration. Never takes owner or account metadata from model input. */
export class AccountSetupService {
  private readonly reauthStarts = new Map<string, Promise<import('./types.js').ConnectionAttempt>>();
  constructor(private readonly store: ConnectionStore, private readonly lifecycle: AccountLifecycle,
    private readonly start: ConnectionStartService) {}

  async add(template: Pick<ConnectionRecord, 'serviceId' | 'serviceName' | 'pluginId' | 'strategyId' | 'adapterId' | 'installed'>, ownerId: string, label: string,
    family: NonNullable<ConnectionRecord['accountAccess']>['family']) {
    // A template supplies plugin metadata, not credentials or authority to use its account.
    const connection = this.lifecycle.add(template, ownerId, label, family);
    try {
      const attempt = await this.start.start({ serviceId: connection.serviceId, kind: family === 'mcp' ? 'mcp_preset' : 'connector', connectionId: connection.id });
      return { connection, attempt };
    } catch (error) {
      // Preserve a visible recoverable record, but never advertise a failed setup as usable.
      this.store.update(connection.id, { enabled: false, authState: 'none', health: 'unavailable' });
      throw error;
    }
  }

  async resume(connectionId: string, ownerId: string, attemptId?: string) {
    const record = this.store.get(connectionId);
    if (!record?.accountAccess || record.accountAccess.ownerId !== ownerId) throw new Error('ACCOUNT_UNAVAILABLE');
    if (attemptId) return this.start.start({ serviceId: record.serviceId, kind: record.accountAccess.family === 'mcp' ? 'mcp_preset' : 'connector', connectionId, attemptId });
    const pending = this.reauthStarts.get(connectionId);
    if (pending) return pending;
    // Fresh re-auth invalidates pending action approvals before credentials may change.
    this.store.update(record.id, { accountAccess: { ...record.accountAccess,
      generation: record.accountAccess.generation + 1 } });
    const operation = this.start.start({ serviceId: record.serviceId, kind: record.accountAccess.family === 'mcp' ? 'mcp_preset' : 'connector', connectionId })
      .finally(() => this.reauthStarts.delete(connectionId));
    this.reauthStarts.set(connectionId, operation);
    return operation;
  }
}
