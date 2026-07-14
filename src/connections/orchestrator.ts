import { randomUUID } from 'crypto';
import { ConnectionAdapterRegistry } from './adapter-registry';
import { ConnectionActivityStore } from './activity-store';
import { ConnectionAttemptStore } from './attempt-store';
import { ConnectionStore } from './connection-store';
import type {
  ConnectionAdapterResult, ConnectionAttempt, ConnectionPlan, ConnectionRecord,
  ConnectionDiscoveryResult, ConnectionStrategy, ConnectionVerificationResult,
} from './types';

export interface ConnectionPlanResolver {
  discover?(service: string): ConnectionDiscoveryResult;
  resolve(input: { serviceId: string; requestedCapabilities: string[]; readOnly: boolean; metadata?: Record<string, unknown> }): Promise<ConnectionPlan>;
}

export interface ConnectionOrchestratorOptions {
  attempts: ConnectionAttemptStore;
  connections: ConnectionStore;
  adapters: ConnectionAdapterRegistry;
  activity: ConnectionActivityStore;
  plans: ConnectionPlanResolver;
  broadcast?: (event: Record<string, unknown>) => void;
}

export class ConnectionOrchestrator {
  constructor(private readonly options: ConnectionOrchestratorOptions) {}

  create(input: { serviceId: string; serviceName?: string; requestedCapabilities?: string[]; readOnly?: boolean; metadata?: Record<string, unknown> }): ConnectionAttempt {
    const discovery = this.options.plans.discover?.(input.serviceId);
    const canonicalServiceId = discovery?.status === 'resolved' ? discovery.canonicalServiceId! : input.serviceId;
    const requestedCapabilities = input.requestedCapabilities || [];
    const reusable = this.options.attempts.list({ limit: 100 }).find((item) =>
      item.serviceId === canonicalServiceId
      && !['connected', 'failed', 'cancelled'].includes(item.state)
      && !(item.state === 'awaiting_oauth' && Number(item.metadata?.oauthDiscoveryVersion || 0) < 2)
      && item.readOnly === (input.readOnly !== false)
      && JSON.stringify([...item.requestedCapabilities].sort()) === JSON.stringify([...requestedCapabilities].sort()));
    if (reusable) return reusable;
    const match = discovery?.status === 'resolved' ? discovery.matches[0] : undefined;
    const attempt = this.options.attempts.create({ ...input, serviceId: canonicalServiceId, serviceName: input.serviceName || match?.serviceName, pluginId: match?.pluginId, requestedCapabilities, readOnly: input.readOnly !== false, metadata: { ...(input.metadata || {}), originalServiceQuery: input.serviceId } });
    this.record(attempt, 'attempt.created', `Connection requested for ${input.serviceName || input.serviceId}.`);
    return attempt;
  }

  getAttempt(id: string): ConnectionAttempt | undefined { return this.options.attempts.get(id); }
  listAttempts(limit = 50): ConnectionAttempt[] { return this.options.attempts.list({ limit }); }
  listConnections(): ConnectionRecord[] { return this.options.connections.list(); }

  discover(service: string): ConnectionDiscoveryResult {
    return this.options.plans.discover?.(service) || { status: 'research_required', query: service, matches: [], nextAction: 'research_official_sources' };
  }

  async plan(id: string): Promise<ConnectionAttempt> {
    let attempt = this.requireAttempt(id);
    attempt = this.transition(attempt, 'discovering', 'Discovering trusted connection options.');
    try {
      const discovery = this.options.plans.discover?.(attempt.serviceId);
      if (discovery?.status === 'research_required' && attempt.metadata?.officialSource !== true) {
        return this.transition(this.options.attempts.update(id, { metadata: { ...(attempt.metadata || {}), discovery } }), 'research_required', 'No installed match was found. Research official sources before proposing a connection definition.');
      }
      if (discovery?.status === 'ambiguous') {
        return this.transition(this.options.attempts.update(id, { metadata: { ...(attempt.metadata || {}), discovery } }), 'research_required', 'Multiple connection plugins match. Select one before continuing.');
      }
      const plan = await this.options.plans.resolve({ serviceId: attempt.serviceId, requestedCapabilities: attempt.requestedCapabilities, readOnly: attempt.readOnly !== false, metadata: attempt.metadata });
      attempt = this.options.attempts.update(id, { serviceId: plan.serviceId, serviceName: plan.serviceName, plan, pluginId: plan.pluginId, selectedStrategy: plan.strategy.id, state: 'planning', error: undefined });
      return this.transition(attempt, 'awaiting_approval', plan.summary);
    } catch (error: any) {
      return this.fail(attempt, 'DISCOVERY_FAILED', String(error?.message || error), true);
    }
  }

  async connect(id: string, input?: Record<string, unknown>): Promise<ConnectionAttempt> {
    let attempt = this.requireAttempt(id);
    if (!attempt.plan) attempt = await this.plan(id);
    if (!attempt.plan || attempt.state === 'failed') return attempt;
    if (attempt.state === 'awaiting_approval' && input?.approved !== true) return attempt;
    const adapter = this.options.adapters.resolve(attempt.plan.strategy);
    this.options.attempts.addProgress(attempt.id, { state: attempt.state, message: `Using ${adapter.displayName}.` });
    try {
      const result = await adapter.connect(this.context(attempt, input));
      return this.applyResult(attempt, result, adapter.id);
    } catch (error: any) {
      return this.fail(attempt, 'CONNECTION_FAILED', String(error?.message || error), true);
    }
  }

  async continue(id: string, input?: Record<string, unknown>): Promise<ConnectionAttempt> {
    const attempt = this.requireAttempt(id);
    if (attempt.state === 'awaiting_approval') return this.connect(id, { ...(input || {}), approved: true });
    if (!attempt.plan) throw new Error(`Connection attempt ${id} has no plan.`);
    const adapter = this.options.adapters.resolve(attempt.plan.strategy);
    if (!adapter.continue) return this.connect(id, { ...input, approved: true });
    try { return this.applyResult(attempt, await adapter.continue(this.context(attempt, input), input), adapter.id); }
    catch (error: any) { return this.fail(attempt, 'CONNECTION_CONTINUE_FAILED', String(error?.message || error), true); }
  }

  async verify(id: string): Promise<ConnectionAttempt> {
    let attempt = this.requireAttempt(id);
    if (!attempt.connectionId || !attempt.plan) return this.fail(attempt, 'NO_CONNECTION', 'No registered connection is available to verify.', false);
    const connection = this.options.connections.get(attempt.connectionId);
    if (!connection) return this.fail(attempt, 'NO_CONNECTION', 'The connection record no longer exists.', false);
    const adapter = this.options.adapters.resolve(attempt.plan.strategy);
    attempt = this.transition(attempt, 'verifying', 'Verifying authentication, registration, exposure, and safe-read behavior.');
    const checks: ConnectionVerificationResult[] = adapter.verify
      ? await adapter.verify(this.context(attempt), connection)
      : [{ id: randomUUID(), check: 'adapter', passed: connection.authenticated && connection.registered, message: 'Adapter state verification.', verifiedAt: new Date().toISOString() }];
    const passed = checks.length > 0 && checks.every((check) => check.passed);
    this.options.connections.update(connection.id, { verified: passed, health: passed ? 'healthy' : 'degraded', verification: checks, lastVerifiedAt: new Date().toISOString() });
    return this.transition(attempt, passed ? 'connected' : 'degraded', passed ? 'Connection verified and ready.' : 'Connection is available but verification is incomplete.');
  }

  async repair(id: string): Promise<ConnectionAttempt> {
    const attempt = this.requireAttempt(id);
    if (!attempt.plan || !attempt.connectionId) return this.fail(attempt, 'NO_CONNECTION', 'No connection is available to repair.', false);
    const connection = this.options.connections.get(attempt.connectionId);
    if (!connection) return this.fail(attempt, 'NO_CONNECTION', 'The connection record no longer exists.', false);
    const adapter = this.options.adapters.resolve(attempt.plan.strategy);
    if (!adapter.repair) return this.fail(attempt, 'REPAIR_UNSUPPORTED', `${adapter.displayName} does not provide an automated repair flow.`, false);
    try { return this.applyResult(attempt, await adapter.repair(this.context(attempt), connection), adapter.id); }
    catch (error: any) { return this.fail(attempt, 'REPAIR_FAILED', String(error?.message || error), true); }
  }

  cancel(id: string): ConnectionAttempt { return this.transition(this.requireAttempt(id), 'cancelled', 'Connection attempt cancelled.'); }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.options.connections.get(connectionId);
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);
    const attempt = this.options.attempts.list({ serviceId: connection.serviceId }).find((item) => item.connectionId === connectionId && item.plan);
    if (attempt?.plan) {
      const adapter = this.options.adapters.resolve(attempt.plan.strategy);
      await adapter.disconnect?.(this.context(attempt), connection);
    }
    this.options.connections.update(connectionId, { enabled: false, authenticated: false, exposed: false, exposedTools: [], authState: 'none', health: 'unavailable' });
    this.options.activity.append({ type: 'connection.disconnected', connectionId, serviceId: connection.serviceId, pluginId: connection.pluginId, message: `Disconnected ${connection.serviceName || connection.serviceId}.` });
    this.emit({ type: 'connection_updated', connection: this.options.connections.get(connectionId) });
  }

  private context(attempt: ConnectionAttempt, input?: Record<string, unknown>) {
    return { attempt, credentialRef: typeof input?.credentialRef === 'string' ? input.credentialRef : undefined, configuration: input, emitProgress: (message: string, details?: Record<string, unknown>) => { this.options.attempts.addProgress(attempt.id, { state: this.requireAttempt(attempt.id).state, message, details }); this.emitAttempt(attempt.id); } };
  }

  private applyResult(attempt: ConnectionAttempt, result: ConnectionAdapterResult, adapterId: string): ConnectionAttempt {
    if (result.error) return this.fail(attempt, result.error.code, result.error.message, result.error.retryable !== false);
    let connectionId = attempt.connectionId;
    if (result.connection && attempt.plan) {
      const now = new Date().toISOString();
      const record = this.options.connections.upsert({
        pluginId: attempt.plan.pluginId || attempt.pluginId || 'core', serviceId: attempt.serviceId, serviceName: attempt.serviceName,
        strategyId: attempt.plan.strategy.id, adapterId, installed: true, enabled: true, configured: true,
        authenticated: false, registered: false, exposed: false, verified: false, authState: 'pending', health: 'unknown',
        grantedCapabilities: attempt.requestedCapabilities, registeredTools: [], exposedTools: [], createdAt: now,
        ...result.connection,
      } as any);
      connectionId = record.id;
    }
    const state = result.userAction ? (result.state || this.userActionState(result.userAction.type)) : (result.state || 'verifying');
    const next = this.options.attempts.update(attempt.id, { state, requiredUserAction: result.userAction, connectionId, metadata: { ...(attempt.metadata || {}), ...(result.configuration || {}) } });
    this.options.attempts.addProgress(next.id, { state, message: result.userAction ? `User action required: ${result.userAction.label}` : 'Connection adapter completed.' });
    this.emitAttempt(next.id);
    return this.requireAttempt(next.id);
  }

  private userActionState(type: string): ConnectionAttempt['state'] {
    if (type === 'oauth') return 'awaiting_oauth';
    if (type === 'secure-input') return 'awaiting_secure_input';
    if (type === 'device-code') return 'awaiting_device_code';
    if (type === 'browser-login') return 'awaiting_browser_login';
    if (type === 'cli-login') return 'awaiting_cli_login';
    if (type === 'external-admin-approval') return 'awaiting_external_admin';
    if (type === 'continue-on-desktop') return 'awaiting_approval';
    return 'awaiting_approval';
  }

  private transition(attempt: ConnectionAttempt, state: ConnectionAttempt['state'], message: string): ConnectionAttempt {
    const preservesAction = state.startsWith('awaiting_');
    const next = this.options.attempts.update(attempt.id, { state, ...(!preservesAction ? { requiredUserAction: undefined } : {}) });
    const updated = this.options.attempts.addProgress(next.id, { state, message });
    this.record(updated, state === 'connected' ? 'attempt.completed' : 'attempt.updated', message);
    return updated;
  }

  private fail(attempt: ConnectionAttempt, code: string, message: string, retryable: boolean): ConnectionAttempt {
    const failed = this.options.attempts.update(attempt.id, { state: 'failed', error: { code, message, retryable, phase: attempt.state, occurredAt: new Date().toISOString() } });
    this.record(failed, 'error', message);
    return failed;
  }

  private requireAttempt(id: string): ConnectionAttempt { const attempt = this.options.attempts.get(id); if (!attempt) throw new Error(`Unknown connection attempt: ${id}`); return attempt; }
  private record(attempt: ConnectionAttempt, type: string, message: string): void { this.options.activity.append({ type, attemptId: attempt.id, connectionId: attempt.connectionId, serviceId: attempt.serviceId, pluginId: attempt.pluginId, message }); this.emitAttempt(attempt.id); }
  private emitAttempt(id: string): void { this.emit({ type: 'connection_attempt_updated', attempt: this.options.attempts.get(id) }); }
  private emit(event: Record<string, unknown>): void { try { this.options.broadcast?.(event); } catch {} }
}
