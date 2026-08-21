import crypto from 'crypto';

export type RuntimeAdmissionLane = 'interactive' | 'system' | 'background';

export interface RuntimeAdmissionLease {
  id: string;
  lane: RuntimeAdmissionLane;
  acquiredAt: number;
  queuedAt: number;
  waitMs: number;
  release: () => boolean;
}

export interface RuntimeAdmissionSnapshot {
  maxActive: number;
  maxBackgroundActive: number;
  maxQueued: number;
  active: number;
  queued: number;
  activeByLane: Record<RuntimeAdmissionLane, number>;
  queuedByLane: Record<RuntimeAdmissionLane, number>;
  activeRuns: Array<{
    id: string;
    lane: RuntimeAdmissionLane;
    acquiredAt: number;
    waitMs: number;
    metadata?: Record<string, string | number | boolean>;
  }>;
}

export class RuntimeAdmissionError extends Error {
  constructor(
    message: string,
    readonly code: 'RUNTIME_ADMISSION_QUEUE_FULL' | 'RUNTIME_ADMISSION_TIMEOUT' | 'RUNTIME_ADMISSION_ABORTED',
  ) {
    super(message);
    this.name = 'RuntimeAdmissionError';
  }
}

type AdmissionWaiter = {
  lane: RuntimeAdmissionLane;
  queuedAt: number;
  resolve: (lease: RuntimeAdmissionLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer?: NodeJS.Timeout;
  metadata?: Record<string, string | number | boolean>;
};

type ActiveAdmission = {
  lease: RuntimeAdmissionLease;
  metadata?: Record<string, string | number | boolean>;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function abortError(): RuntimeAdmissionError {
  return new RuntimeAdmissionError('Runtime admission was cancelled.', 'RUNTIME_ADMISSION_ABORTED');
}

/**
 * Process-wide governor for model/tool executions.
 *
 * SessionTurnCoordinator prevents duplicate turns in one chat. This governor
 * is the second boundary: it limits the total number of model loops and keeps
 * background work from consuming every available worker while foreground chat
 * is waiting for service.
 */
export class RuntimeAdmissionController {
  readonly maxActive: number;
  readonly maxBackgroundActive: number;
  readonly maxQueued: number;
  readonly maxWaitMs: number;
  private readonly active = new Map<string, ActiveAdmission>();
  private readonly waiters: AdmissionWaiter[] = [];

  constructor(options: {
    maxActive?: number;
    maxBackgroundActive?: number;
    maxQueued?: number;
    maxWaitMs?: number;
  } = {}) {
    this.maxActive = Math.max(1, Math.floor(options.maxActive ?? envInt('PROMETHEUS_RUNTIME_MAX_ACTIVE', 3, 1, 16)));
    this.maxBackgroundActive = Math.max(
      0,
      Math.min(this.maxActive, Math.floor(options.maxBackgroundActive ?? envInt('PROMETHEUS_RUNTIME_MAX_BACKGROUND_ACTIVE', 1, 0, 16))),
    );
    this.maxQueued = Math.max(0, Math.floor(options.maxQueued ?? envInt('PROMETHEUS_RUNTIME_MAX_QUEUE', 16, 0, 256)));
    this.maxWaitMs = Math.max(1_000, Math.floor(options.maxWaitMs ?? envInt('PROMETHEUS_RUNTIME_ADMISSION_MAX_WAIT_MS', 120_000, 1_000, 15 * 60_000)));
  }

  acquire(options: {
    lane: RuntimeAdmissionLane;
    signal?: AbortSignal;
    metadata?: Record<string, string | number | boolean>;
    maxWaitMs?: number;
  }): Promise<RuntimeAdmissionLease> {
    const lane = options.lane;
    if (options.signal?.aborted) return Promise.reject(abortError());
    const immediate = this.tryAcquire(lane, Date.now(), options.metadata);
    if (immediate) return Promise.resolve(immediate);
    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(new RuntimeAdmissionError(
        'Prometheus is at its runtime admission queue limit. Retry after an active run finishes.',
        'RUNTIME_ADMISSION_QUEUE_FULL',
      ));
    }

    const queuedAt = Date.now();
    return new Promise<RuntimeAdmissionLease>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        lane,
        queuedAt,
        resolve,
        reject,
        signal: options.signal,
        metadata: options.metadata,
      };
      const maxWaitMs = Math.max(1_000, Math.floor(options.maxWaitMs ?? this.maxWaitMs));
      waiter.timer = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(new RuntimeAdmissionError(
          'Prometheus kept this runtime queued until its admission deadline expired.',
          'RUNTIME_ADMISSION_TIMEOUT',
        ));
      }, maxWaitMs);
      waiter.timer.unref?.();
      if (options.signal) {
        waiter.onAbort = () => {
          this.removeWaiter(waiter);
          reject(abortError());
        };
        options.signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.drain();
    });
  }

  tryAcquire(
    lane: RuntimeAdmissionLane,
    now = Date.now(),
    metadata?: Record<string, string | number | boolean>,
  ): RuntimeAdmissionLease | null {
    if (!this.canStart(lane)) return null;
    const id = crypto.randomUUID();
    const lease: RuntimeAdmissionLease = {
      id,
      lane,
      acquiredAt: now,
      queuedAt: now,
      waitMs: 0,
      release: () => this.release(id),
    };
    this.active.set(id, { lease, metadata });
    return lease;
  }

  release(leaseOrId: RuntimeAdmissionLease | string): boolean {
    const id = typeof leaseOrId === 'string' ? leaseOrId : leaseOrId?.id;
    if (!id || !this.active.delete(id)) return false;
    this.drain();
    return true;
  }

  snapshot(): RuntimeAdmissionSnapshot {
    const activeByLane: Record<RuntimeAdmissionLane, number> = {
      interactive: 0,
      system: 0,
      background: 0,
    };
    const queuedByLane: Record<RuntimeAdmissionLane, number> = {
      interactive: 0,
      system: 0,
      background: 0,
    };
    const activeRuns = Array.from(this.active.values()).map(({ lease, metadata }) => {
      activeByLane[lease.lane] += 1;
      return {
        id: lease.id,
        lane: lease.lane,
        acquiredAt: lease.acquiredAt,
        waitMs: lease.waitMs,
        metadata,
      };
    });
    for (const waiter of this.waiters) queuedByLane[waiter.lane] += 1;
    return {
      maxActive: this.maxActive,
      maxBackgroundActive: this.maxBackgroundActive,
      maxQueued: this.maxQueued,
      active: this.active.size,
      queued: this.waiters.length,
      activeByLane,
      queuedByLane,
      activeRuns,
    };
  }

  clear(reason = 'Runtime admission was reset.'): void {
    const error = new RuntimeAdmissionError(reason, 'RUNTIME_ADMISSION_ABORTED');
    for (const waiter of this.waiters.splice(0)) {
      this.clearWaiter(waiter);
      waiter.reject(error);
    }
    this.active.clear();
  }

  private canStart(lane: RuntimeAdmissionLane): boolean {
    if (this.active.size >= this.maxActive) return false;
    if (lane === 'background') {
      let backgroundActive = 0;
      for (const { lease } of this.active.values()) {
        if (lease.lane === 'background') backgroundActive += 1;
      }
      if (backgroundActive >= this.maxBackgroundActive) return false;
    }
    return true;
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      let nextIndex = -1;
      let nextPriority = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.waiters.length; index += 1) {
        const waiter = this.waiters[index];
        if (!this.canStart(waiter.lane)) continue;
        const priority = waiter.lane === 'interactive' ? 0 : waiter.lane === 'system' ? 1 : 2;
        if (priority < nextPriority) {
          nextIndex = index;
          nextPriority = priority;
          if (priority === 0) break;
        }
      }
      if (nextIndex < 0) return;
      const [waiter] = this.waiters.splice(nextIndex, 1);
      if (waiter.signal?.aborted) {
        this.clearWaiter(waiter);
        waiter.reject(abortError());
        continue;
      }
      this.clearWaiter(waiter);
      const acquiredAt = Date.now();
      const lease: RuntimeAdmissionLease = {
        id: crypto.randomUUID(),
        lane: waiter.lane,
        acquiredAt,
        queuedAt: waiter.queuedAt,
        waitMs: Math.max(0, acquiredAt - waiter.queuedAt),
        release: () => this.release(lease.id),
      };
      this.active.set(lease.id, { lease, metadata: waiter.metadata });
      waiter.resolve(lease);
    }
  }

  private removeWaiter(waiter: AdmissionWaiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    this.clearWaiter(waiter);
  }

  private clearWaiter(waiter: AdmissionWaiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  }
}

export const gatewayRuntimeAdmission = new RuntimeAdmissionController();
