import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DesktopTargetState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed';
export type DesktopTargetOwnership = 'owned' | 'external' | 'unknown';

export interface DesktopTargetProbe {
  ready: boolean;
  ownership?: DesktopTargetOwnership;
  detail?: string;
}

export interface DesktopTargetStartResult {
  ownership?: DesktopTargetOwnership;
  detail?: string;
}

export interface DesktopTargetAdapter {
  readonly targetId: string;
  readonly kind: string;
  start(context: { instanceId: string }): Promise<DesktopTargetStartResult | void>;
  probe(context: { instanceId?: string }): Promise<DesktopTargetProbe>;
  waitUntilReady(context: { instanceId: string; timeoutMs: number }): Promise<void>;
  stop(context: { graceMs: number; forceAfterMs: number; reason: string }): Promise<void>;
}

export type DesktopTargetLeaseEventName =
  | 'acquire'
  | 'start_begin'
  | 'readiness_wait'
  | 'ready'
  | 'renew'
  | 'release'
  | 'session_release'
  | 'idle_stop_scheduled'
  | 'idle_stop'
  | 'stale_recovery_detected'
  | 'stale_recovery_adopted'
  | 'stale_recovery_missing'
  | 'crash_recovery'
  | 'failure'
  | 'shutdown_deferred'
  | 'shutdown_complete';

export interface DesktopTargetLeaseEvent {
  event: DesktopTargetLeaseEventName;
  at: number;
  targetId: string;
  kind: string;
  state: DesktopTargetState;
  activeLeases: number;
  activeSessions: number;
  owned: boolean;
  reason?: string;
  errorCode?: string;
}

export interface DesktopTargetLease {
  readonly id: string;
  readonly sessionId: string;
  renew(): void;
  release(): void;
}

export interface DesktopTargetLeaseStatus {
  targetId: string;
  kind: string;
  state: DesktopTargetState;
  ownership: DesktopTargetOwnership;
  warmMode: boolean;
  idleTimeoutMs: number;
  startTimeoutMs: number;
  stopGraceMs: number;
  stopForceAfterMs: number;
  activeLeases: number;
  activeSessions: number;
  recoveryPending: boolean;
  startInFlight: boolean;
  stopInFlight: boolean;
  lastActivityAt: number;
  lastTransitionAt: number;
  lastErrorCode?: string;
  lastEvent?: DesktopTargetLeaseEventName;
  telemetryPath?: string;
}

export interface DesktopTargetLeaseManagerOptions {
  idleTimeoutMs?: number;
  startTimeoutMs?: number;
  stopGraceMs?: number;
  stopForceAfterMs?: number;
  warmMode?: boolean;
  now?: () => number;
  statePath?: string;
  eventsPath?: string;
  onEvent?: (event: DesktopTargetLeaseEvent) => void;
}

type SessionRecord = {
  activeLeases: number;
  lastActivityAt: number;
  ended: boolean;
};

type LeaseRecord = {
  id: string;
  sessionId: string;
  released: boolean;
};

type PersistedRuntimeState = {
  targetId?: string;
  kind?: string;
  state?: DesktopTargetState;
  ownership?: DesktopTargetOwnership;
  instanceId?: string;
  activeLeases?: number;
  activeSessions?: number;
  lastActivityAt?: number;
  updatedAt?: number;
};

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_START_TIMEOUT_MS = 120_000;
const DEFAULT_STOP_GRACE_MS = 8_000;
const DEFAULT_STOP_FORCE_AFTER_MS = 8_000;

function positiveInt(value: number | undefined, fallback: number, minimum = 1): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(Number(value))) : fallback;
}

function normalizeSessionId(value: string | undefined): string {
  const sessionId = String(value || '').trim();
  return sessionId || 'desktop-default';
}

function errorCode(error: unknown): string {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('cancel')) return 'cancelled';
  if (message.includes('not found') || message.includes('not recognized')) return 'target_not_found';
  if (message.includes('access denied') || message.includes('permission')) return 'permission_denied';
  return 'target_failure';
}

function abortError(): Error {
  const error = new Error('Desktop target lease acquisition was cancelled.');
  error.name = 'AbortError';
  return error;
}

function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class DesktopTargetLeaseManager {
  private readonly adapter: DesktopTargetAdapter;
  private readonly idleTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly stopForceAfterMs: number;
  private readonly warmMode: boolean;
  private readonly now: () => number;
  private readonly statePath?: string;
  private readonly eventsPath?: string;
  private readonly onEvent?: (event: DesktopTargetLeaseEvent) => void;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly leases = new Map<string, LeaseRecord>();
  private state: DesktopTargetState = 'stopped';
  private ownership: DesktopTargetOwnership = 'unknown';
  private instanceId = '';
  private lastActivityAt = 0;
  private lastTransitionAt = 0;
  private lastErrorCode: string | undefined;
  private lastEvent: DesktopTargetLeaseEventName | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private startFlight: Promise<void> | undefined;
  private stopFlight: Promise<void> | undefined;
  private recoveryPending = false;
  private recoveryPromise: Promise<void>;
  private shuttingDown = false;

  constructor(adapter: DesktopTargetAdapter, options: DesktopTargetLeaseManagerOptions = {}) {
    this.adapter = adapter;
    this.idleTimeoutMs = positiveInt(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 0);
    this.startTimeoutMs = positiveInt(options.startTimeoutMs, DEFAULT_START_TIMEOUT_MS);
    this.stopGraceMs = positiveInt(options.stopGraceMs, DEFAULT_STOP_GRACE_MS, 0);
    this.stopForceAfterMs = positiveInt(options.stopForceAfterMs, DEFAULT_STOP_FORCE_AFTER_MS, 0);
    this.warmMode = options.warmMode === true;
    this.now = options.now || (() => Date.now());
    this.statePath = options.statePath;
    this.eventsPath = options.eventsPath;
    this.onEvent = options.onEvent;
    this.lastTransitionAt = this.now();
    this.recoveryPromise = this.recoverStaleState();
  }

  async acquire(sessionIdValue?: string, signal?: AbortSignal): Promise<DesktopTargetLease> {
    if (this.shuttingDown) throw new Error('Desktop target lifecycle is shutting down.');
    if (signal?.aborted) throw abortError();
    await waitWithAbort(this.recoveryPromise, signal);

    const sessionId = normalizeSessionId(sessionIdValue);
    const session = this.sessions.get(sessionId) || { activeLeases: 0, lastActivityAt: 0, ended: false };
    session.activeLeases += 1;
    session.lastActivityAt = this.now();
    session.ended = false;
    this.sessions.set(sessionId, session);
    this.lastActivityAt = session.lastActivityAt;
    this.clearIdleTimer();

    try {
      await this.ensureReady(signal);
    } catch (error) {
      this.removeSessionLease(sessionId);
      this.recordFailure(error);
      throw error;
    }

    const id = randomUUID();
    this.leases.set(id, { id, sessionId, released: false });
    this.emit('acquire');
    return {
      id,
      sessionId,
      renew: () => this.renew(id),
      release: () => this.release(id),
    };
  }

  renew(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.released) return;
    const session = this.sessions.get(lease.sessionId);
    if (!session) return;
    const at = this.now();
    session.lastActivityAt = at;
    this.lastActivityAt = at;
    this.clearIdleTimer();
    this.emit('renew');
  }

  release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.released) return;
    const sessionEnded = this.sessions.get(lease.sessionId)?.ended === true;
    lease.released = true;
    this.leases.delete(leaseId);
    this.removeSessionLease(lease.sessionId);
    this.emit('release');
    if (this.shuttingDown && this.leases.size === 0) {
      void this.stopIfSafe('shutdown');
    } else if (sessionEnded && this.leases.size === 0 && !this.warmMode) {
      void this.stopIfSafe('session_release');
    } else {
      this.scheduleIdleStop();
    }
  }

  releaseSession(sessionIdValue?: string): void {
    const sessionId = normalizeSessionId(sessionIdValue);
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ended = true;
    if (session.activeLeases === 0) this.sessions.delete(sessionId);
    this.emit('session_release');
    if (this.leases.size === 0 && !this.warmMode) {
      void this.stopIfSafe('session_release');
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.clearIdleTimer();
    await waitWithAbort(this.recoveryPromise);
    if (this.leases.size > 0) {
      this.emit('shutdown_deferred');
      return;
    }
    await this.stopIfSafe('shutdown');
    this.emit('shutdown_complete');
  }

  status(): DesktopTargetLeaseStatus {
    return {
      targetId: this.adapter.targetId,
      kind: this.adapter.kind,
      state: this.state,
      ownership: this.ownership,
      warmMode: this.warmMode,
      idleTimeoutMs: this.idleTimeoutMs,
      startTimeoutMs: this.startTimeoutMs,
      stopGraceMs: this.stopGraceMs,
      stopForceAfterMs: this.stopForceAfterMs,
      activeLeases: this.leases.size,
      activeSessions: Array.from(this.sessions.values()).filter(session => session.activeLeases > 0).length,
      recoveryPending: this.recoveryPending,
      startInFlight: !!this.startFlight,
      stopInFlight: !!this.stopFlight,
      lastActivityAt: this.lastActivityAt,
      lastTransitionAt: this.lastTransitionAt,
      lastErrorCode: this.lastErrorCode,
      lastEvent: this.lastEvent,
      telemetryPath: this.eventsPath,
    };
  }

  private async ensureReady(signal?: AbortSignal): Promise<void> {
    if (this.state === 'ready') {
      let probe: DesktopTargetProbe;
      try {
        probe = await waitWithAbort(this.adapter.probe({ instanceId: this.instanceId || undefined }), signal);
      } catch (error) {
        this.state = 'failed';
        this.lastTransitionAt = this.now();
        this.recordFailure(error);
        throw error;
      }
      if (probe.ready) {
        if (probe.ownership) this.ownership = probe.ownership;
        return;
      }
      this.state = 'stopped';
      this.ownership = 'unknown';
      this.emit('crash_recovery', 'target_not_ready');
    }

    if (this.startFlight) {
      await waitWithAbort(this.startFlight, signal);
      return;
    }

    const existing = await waitWithAbort(this.adapter.probe({ instanceId: this.instanceId || undefined }), signal);
    if (existing.ready) {
      this.state = 'ready';
      this.ownership = existing.ownership || 'external';
      this.lastTransitionAt = this.now();
      this.emit('ready', 'adopted_existing_target');
      return;
    }

    // The probe above is asynchronous. Another acquire can have completed its
    // probe and reserved the single-flight start while this caller was
    // suspended, so re-check before creating a second startup flight.
    if (this.startFlight) {
      await waitWithAbort(this.startFlight, signal);
      return;
    }

    this.instanceId = randomUUID();
    this.state = 'starting';
    this.ownership = 'unknown';
    this.lastTransitionAt = this.now();
    this.emit('start_begin');
    const flight = (async () => {
      try {
        const started = await this.adapter.start({ instanceId: this.instanceId });
        this.ownership = started?.ownership || 'owned';
        this.emit('readiness_wait');
        await this.adapter.waitUntilReady({ instanceId: this.instanceId, timeoutMs: this.startTimeoutMs });
        this.state = 'ready';
        this.lastTransitionAt = this.now();
        this.lastErrorCode = undefined;
        this.emit('ready');
      } catch (error) {
        this.state = 'failed';
        this.lastTransitionAt = this.now();
        this.recordFailure(error);
        if (this.ownership === 'owned') {
          try {
            await this.adapter.stop({
              graceMs: this.stopGraceMs,
              forceAfterMs: this.stopForceAfterMs,
              reason: 'readiness_failure',
            });
          } catch {
            // Preserve the readiness failure as the primary diagnostic.
          }
        }
        throw error;
      } finally {
        this.startFlight = undefined;
        this.persistState();
        if (this.state === 'ready' && this.leases.size === 0) this.scheduleIdleStop();
      }
    })();
    this.startFlight = flight;
    await waitWithAbort(flight, signal);
  }

  private releaseIfSessionEnded(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.ended && session.activeLeases === 0) this.sessions.delete(sessionId);
  }

  private removeSessionLease(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.activeLeases = Math.max(0, session.activeLeases - 1);
    session.lastActivityAt = this.now();
    this.lastActivityAt = session.lastActivityAt;
    this.releaseIfSessionEnded(sessionId);
  }

  private scheduleIdleStop(): void {
    if (this.warmMode || this.leases.size > 0 || this.state !== 'ready' || this.shuttingDown) return;
    this.clearIdleTimer();
    const elapsed = Math.max(0, this.now() - this.lastActivityAt);
    const remaining = Math.max(0, this.idleTimeoutMs - elapsed);
    this.emit('idle_stop_scheduled');
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.stopIfSafe('idle_timeout');
    }, remaining);
    const timer = this.idleTimer as any;
    if (typeof timer?.unref === 'function') timer.unref();
  }

  private async stopIfSafe(reason: string): Promise<void> {
    if (this.leases.size > 0) return;
    if (this.stopFlight) return this.stopFlight;
    if (this.state === 'starting' && this.startFlight) {
      try { await this.startFlight; } catch { return; }
      if (this.leases.size > 0) return;
    }
    if (this.state !== 'ready') return;
    if (!this.warmMode || reason === 'shutdown' || reason === 'session_release') {
      this.state = 'stopping';
      this.lastTransitionAt = this.now();
      this.emit('idle_stop', reason);
      const flight = (async () => {
        try {
          if (this.ownership === 'owned') {
            await this.adapter.stop({
              graceMs: this.stopGraceMs,
              forceAfterMs: this.stopForceAfterMs,
              reason,
            });
          }
          this.state = 'stopped';
          this.ownership = 'unknown';
          this.lastTransitionAt = this.now();
          this.persistState();
        } catch (error) {
          this.state = 'failed';
          this.lastTransitionAt = this.now();
          this.recordFailure(error);
          throw error;
        } finally {
          this.stopFlight = undefined;
        }
      })();
      this.stopFlight = flight;
      await flight;
    }
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private recordFailure(error: unknown): void {
    this.lastErrorCode = errorCode(error);
    this.emit('failure', this.lastErrorCode);
  }

  private emit(event: DesktopTargetLeaseEventName, reason?: string): void {
    this.lastEvent = event;
    const payload: DesktopTargetLeaseEvent = {
      event,
      at: this.now(),
      targetId: this.adapter.targetId,
      kind: this.adapter.kind,
      state: this.state,
      activeLeases: this.leases.size,
      activeSessions: Array.from(this.sessions.values()).filter(session => session.activeLeases > 0).length,
      owned: this.ownership === 'owned',
      reason: reason?.slice(0, 120),
      errorCode: event === 'failure' ? this.lastErrorCode : undefined,
    };
    this.onEvent?.(payload);
    this.appendEvent(payload);
    this.persistState(payload);
  }

  private appendEvent(event: DesktopTargetLeaseEvent): void {
    if (!this.eventsPath) return;
    try {
      fs.mkdirSync(path.dirname(this.eventsPath), { recursive: true });
      fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
      const maxBytes = 2 * 1024 * 1024;
      const size = fs.statSync(this.eventsPath).size;
      if (size > maxBytes) {
        const retained = fs.readFileSync(this.eventsPath).subarray(size - maxBytes);
        fs.writeFileSync(this.eventsPath, retained, 'utf8');
      }
    } catch {
      // Telemetry must never break desktop work.
    }
  }

  private persistState(lastEvent?: DesktopTargetLeaseEvent): void {
    if (!this.statePath) return;
    try {
      const status = this.status();
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify({
        ...status,
        instanceId: this.instanceId || undefined,
        lastEvent: lastEvent?.event || this.lastEvent,
        updatedAt: this.now(),
      }), 'utf8');
    } catch {
      // Diagnostics must never break desktop work.
    }
  }

  private async recoverStaleState(): Promise<void> {
    if (!this.statePath) return;
    let persisted: PersistedRuntimeState;
    try {
      persisted = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as PersistedRuntimeState;
    } catch {
      return;
    }
    if (persisted.targetId && persisted.targetId !== this.adapter.targetId) return;
    if (persisted.state !== 'ready' && persisted.state !== 'starting' && persisted.state !== 'stopping') return;
    if (persisted.ownership !== 'owned') return;

    this.recoveryPending = true;
    this.instanceId = String(persisted.instanceId || '');
    this.emit('stale_recovery_detected');
    try {
      const probe = await this.adapter.probe({ instanceId: this.instanceId || undefined });
      if (!probe.ready) {
        this.state = 'stopped';
        this.ownership = 'unknown';
        this.emit('stale_recovery_missing');
        return;
      }
      this.state = 'ready';
      this.ownership = 'owned';
      this.lastActivityAt = Number(persisted.lastActivityAt) > 0 ? Number(persisted.lastActivityAt) : this.now();
      this.lastTransitionAt = this.now();
      this.emit('stale_recovery_adopted');
      this.scheduleIdleStop();
    } catch (error) {
      this.state = 'failed';
      this.recordFailure(error);
    } finally {
      this.recoveryPending = false;
      this.persistState();
    }
  }
}

export function createDesktopTargetLeaseManager(
  adapter: DesktopTargetAdapter,
  options: DesktopTargetLeaseManagerOptions = {},
): DesktopTargetLeaseManager {
  return new DesktopTargetLeaseManager(adapter, options);
}
