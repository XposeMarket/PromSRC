import type { ConnectionAuthState, ConnectionHealth } from './types.js';

export type ConnectionHealthState = ConnectionHealth;
export type ConnectionAuthHealth = ConnectionAuthState;

export interface ConnectionHealthTarget {
  id: string;
  serviceId: string;
  enabled: boolean;
  authenticated: boolean;
  registered: boolean;
  exposed: boolean;
  verified: boolean;
  authState?: ConnectionAuthHealth;
  lastVerifiedAt?: string;
}

export interface ConnectionHealthProbeResult {
  ok: boolean;
  state?: ConnectionHealthState;
  authState?: ConnectionAuthHealth;
  message?: string;
  reauthRequired?: boolean;
  details?: Record<string, unknown>;
}

export interface ConnectionHealthProbe {
  id: string;
  supports?(target: ConnectionHealthTarget): boolean;
  run(target: ConnectionHealthTarget): Promise<ConnectionHealthProbeResult>;
}

export interface ConnectionHealthReport {
  connectionId: string;
  health: ConnectionHealthState;
  authState: ConnectionAuthHealth;
  reauthRequired: boolean;
  checkedAt: string;
  checks: Array<ConnectionHealthProbeResult & { probeId: string; durationMs: number }>;
}

export interface ConnectionHealthSink {
  updateHealth(connectionId: string, report: ConnectionHealthReport): Promise<void> | void;
}

export class ConnectionHealthService {
  private readonly probes = new Map<string, ConnectionHealthProbe>();

  constructor(private readonly sink?: ConnectionHealthSink) {}

  register(probe: ConnectionHealthProbe): () => void {
    if (!probe.id.trim()) throw new Error('Connection health probe id is required.');
    if (this.probes.has(probe.id)) throw new Error(`Connection health probe "${probe.id}" is already registered.`);
    this.probes.set(probe.id, probe);
    return () => this.probes.delete(probe.id);
  }

  async check(target: ConnectionHealthTarget): Promise<ConnectionHealthReport> {
    const matching = [...this.probes.values()].filter((probe) => !probe.supports || probe.supports(target));
    const checks = await Promise.all(matching.map(async (probe) => {
      const started = Date.now();
      try {
        return { ...(await probe.run(target)), probeId: probe.id, durationMs: Date.now() - started };
      } catch (error: any) {
        return { ok: false, state: 'unavailable' as const, message: String(error?.message || error), probeId: probe.id, durationMs: Date.now() - started };
      }
    }));

    let authState: ConnectionAuthHealth = target.authState || (target.authenticated ? 'healthy' : 'none');
    for (const check of checks) {
      if (check.authState) authState = check.authState;
      if (check.reauthRequired) authState = 'reauth_required';
    }
    const reauthRequired = authState === 'expired' || authState === 'invalid' || authState === 'reauth_required';
    let health: ConnectionHealthState;
    if (!target.enabled) health = 'unavailable';
    else if (reauthRequired) health = 'unavailable';
    else if (!matching.length) health = target.verified ? 'healthy' : 'unknown';
    else if (checks.every((check) => check.ok)) health = 'healthy';
    else if (checks.some((check) => check.ok)) health = 'degraded';
    else health = 'unavailable';

    const report: ConnectionHealthReport = {
      connectionId: target.id,
      health,
      authState,
      reauthRequired,
      checkedAt: new Date().toISOString(),
      checks,
    };
    await this.sink?.updateHealth(target.id, report);
    return report;
  }

  async checkMany(targets: ConnectionHealthTarget[]): Promise<ConnectionHealthReport[]> {
    return Promise.all(targets.map((target) => this.check(target)));
  }
}
