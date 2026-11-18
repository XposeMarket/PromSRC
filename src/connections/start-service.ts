import type { ConnectionOrchestrator } from './orchestrator';
import type { ConnectionAttempt } from './types';
import { accountIdentityKey } from './connector-contract';

export interface ConnectionStartInput {
  serviceId: string;
  kind?: 'connector' | 'mcp_preset' | 'provider' | 'integration';
  attemptId?: string;
  /** Trusted host selection only; public generic start routes must not forward this field. */
  connectionId?: string;
}
/** One metadata-only entry for UI and agents. Starting never implies consent. */
export class ConnectionStartService {
  private pending = new Map<string, Promise<ConnectionAttempt>>();
  constructor(private readonly orchestrator: ConnectionOrchestrator) {}
  start(input: ConnectionStartInput): Promise<ConnectionAttempt> {
    const selector = input.kind ? `${input.kind}:${input.serviceId}` : input.serviceId;
    if (!selector.trim()) return Promise.reject(new Error('SERVICE_REQUIRED'));
    const key = JSON.stringify([selector, input.connectionId || null, input.attemptId || null]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = this.run(input, selector).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
  private async run(input: ConnectionStartInput, selector: string): Promise<ConnectionAttempt> {
    let accountGeneration: number | undefined;
    let expectedAccountId: string | undefined;
    if (input.connectionId) {
      const connection = this.orchestrator.listConnections().find(record => record.id === input.connectionId);
      const discovery = this.orchestrator.discover(selector);
      if (!connection?.accountAccess || discovery.status !== 'resolved'
        || connection.serviceId !== discovery.canonicalServiceId
        || connection.pluginId !== discovery.matches[0]?.pluginId) throw new Error('ACCOUNT_UNAVAILABLE');
      accountGeneration = connection.accountAccess.generation;
      expectedAccountId = accountIdentityKey(connection.account) || undefined;
    }
    if (input.attemptId) {
      const attempt = this.orchestrator.getAttempt(input.attemptId);
      const discovery = this.orchestrator.discover(selector);
      if (!attempt || discovery.status !== 'resolved' || discovery.canonicalServiceId !== attempt.serviceId
        || attempt.metadata?.connectionId !== input.connectionId
        || (input.connectionId && attempt.metadata?.accountGeneration !== accountGeneration)
        || (input.kind && attempt.metadata?.pluginKind !== input.kind)) throw new Error('SERVICE_IDENTITY_MISMATCH');
      if (attempt.state !== 'awaiting_secure_input' || Date.now() - Date.parse(attempt.updatedAt) <= 15 * 60_000) return attempt;
      this.orchestrator.cancel(attempt.id);
    }
    let created = this.orchestrator.create({ serviceId: selector, readOnly: true, metadata: input.connectionId ? { connectionId: input.connectionId, accountGeneration, expectedAccountId } : undefined });
    if (created.state === 'awaiting_secure_input' && Date.now() - Date.parse(created.updatedAt) > 15 * 60_000) {
      this.orchestrator.cancel(created.id);
      created = this.orchestrator.create({ serviceId: selector, readOnly: true, metadata: input.connectionId ? { connectionId: input.connectionId, accountGeneration, expectedAccountId } : undefined });
    }
    return created.plan || created.state !== 'requested' ? created : this.orchestrator.plan(created.id);
  }
}
