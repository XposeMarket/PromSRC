import crypto from 'crypto';
import {
  TurnWorkerProcess,
  TurnWorkerProcessError,
  type TurnWorkerJobHandle,
  type TurnWorkerJobHandlers,
  type TurnWorkerJobRequest,
  type TurnWorkerProcessOptions,
  type TurnWorkerProcessStatus,
} from './turn-worker-process.js';
import type { TurnWorkerSteerAckMessage } from './protocol.js';

export interface TurnWorkerPoolOptions extends Omit<TurnWorkerProcessOptions, 'name'> {
  name?: string;
  maxWorkers?: number;
  maxQueuedJobs?: number;
  /** Retire a healthy child after this many terminal turns to bound long-lived heap growth. */
  recycleAfterJobs?: number;
  shutdownGraceMs?: number;
}

export type TurnWorkerPoolJobState = 'queued' | 'starting' | 'running' | 'settled';

export interface TurnWorkerPoolJob<TResult = unknown> {
  readonly jobId: string;
  readonly attempt: number;
  readonly started: Promise<{ workerId: string; pid: number; startedAt: number }>;
  readonly result: Promise<TResult>;
  readonly state: TurnWorkerPoolJobState;
  readonly pid?: number;
  cancel(reason?: string): Promise<void>;
  steer(payload: unknown, steerId?: string): Promise<TurnWorkerSteerAckMessage>;
}

export interface TurnWorkerPoolStatus {
  name: string;
  maxWorkers: number;
  queuedJobs: number;
  runningJobs: number;
  shuttingDown: boolean;
  workers: TurnWorkerProcessStatus[];
}

interface PoolEntry {
  request: TurnWorkerJobRequest & { jobId: string; attempt: number };
  handlers: TurnWorkerJobHandlers<unknown>;
  state: TurnWorkerPoolJobState;
  handle?: TurnWorkerJobHandle<unknown>;
  cancelRequested?: string;
  settled: boolean;
  startedResolve: (value: { workerId: string; pid: number; startedAt: number }) => void;
  startedReject: (error: Error) => void;
  resultResolve: (value: unknown) => void;
  resultReject: (error: Error) => void;
}

interface PoolSlot {
  id: number;
  worker: TurnWorkerProcess;
  busy: boolean;
}

/** FIFO bounded scheduler for isolated, reusable turn processes. */
export class TurnWorkerPool {
  private readonly options: Required<Pick<TurnWorkerPoolOptions,
    'name' | 'maxWorkers' | 'maxQueuedJobs' | 'recycleAfterJobs' | 'shutdownGraceMs'>>
    & Omit<TurnWorkerPoolOptions, 'name' | 'maxWorkers' | 'maxQueuedJobs' | 'recycleAfterJobs' | 'shutdownGraceMs'>;
  private readonly slots: PoolSlot[] = [];
  private readonly queue: PoolEntry[] = [];
  private readonly jobs = new Map<string, PoolEntry>();
  private nextSlotId = 1;
  private pumping = false;
  private pumpAgain = false;
  private shuttingDown = false;

  constructor(options: TurnWorkerPoolOptions) {
    this.options = {
      ...options,
      name: String(options.name || 'turn-workers'),
      maxWorkers: Math.max(1, Math.floor(Number(options.maxWorkers || 2))),
      maxQueuedJobs: Math.max(0, Math.floor(Number(options.maxQueuedJobs ?? 100))),
      recycleAfterJobs: Math.max(1, Math.floor(Number(options.recycleAfterJobs || 25))),
      shutdownGraceMs: Math.max(100, Number(options.shutdownGraceMs || 2_000)),
    };
  }

  getStatus(): TurnWorkerPoolStatus {
    let runningJobs = 0;
    for (const entry of this.jobs.values()) {
      if (entry.state === 'starting' || entry.state === 'running') runningJobs += 1;
    }
    return {
      name: this.options.name,
      maxWorkers: this.options.maxWorkers,
      queuedJobs: this.queue.filter((entry) => !entry.settled).length,
      runningJobs,
      shuttingDown: this.shuttingDown,
      workers: this.slots.map((slot) => slot.worker.getStatus()),
    };
  }

  submit<TResult = unknown>(
    request: TurnWorkerJobRequest,
    handlers: TurnWorkerJobHandlers<TResult> = {},
  ): TurnWorkerPoolJob<TResult> {
    if (this.shuttingDown) {
      throw new TurnWorkerProcessError(`${this.options.name} is shutting down.`, { code: 'TURN_WORKER_SHUTDOWN' });
    }
    const jobId = String(request.jobId || '').trim();
    const attempt = Math.max(1, Number(request.attempt || 1));
    if (!jobId) throw new TurnWorkerProcessError('Turn jobId is required.', { code: 'TURN_WORKER_PROTOCOL_ERROR' });
    if (!Number.isSafeInteger(attempt)) {
      throw new TurnWorkerProcessError('Turn attempt must be a positive integer.', { code: 'TURN_WORKER_PROTOCOL_ERROR' });
    }
    const key = this.jobKey(jobId, attempt);
    if (this.jobs.has(key)) {
      throw new TurnWorkerProcessError(`Turn ${jobId}#${attempt} is already queued or running.`, { code: 'TURN_WORKER_BUSY' });
    }
    const immediatelyAvailable = this.slots.some((slot) => !slot.busy) || this.slots.length < this.options.maxWorkers;
    if (!immediatelyAvailable && this.queue.filter((entry) => !entry.settled).length >= this.options.maxQueuedJobs) {
      throw new TurnWorkerProcessError(`${this.options.name} queue is full.`, { code: 'TURN_WORKER_UNAVAILABLE' });
    }

    let startedResolve!: PoolEntry['startedResolve'];
    let startedReject!: PoolEntry['startedReject'];
    let resultResolve!: PoolEntry['resultResolve'];
    let resultReject!: PoolEntry['resultReject'];
    const started = new Promise<{ workerId: string; pid: number; startedAt: number }>((resolve, reject) => {
      startedResolve = resolve;
      startedReject = reject;
    });
    const result = new Promise<unknown>((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });
    void started.catch(() => {});
    const entry: PoolEntry = {
      request: { ...request, jobId, attempt },
      handlers: handlers as TurnWorkerJobHandlers<unknown>,
      state: 'queued',
      settled: false,
      startedResolve,
      startedReject,
      resultResolve,
      resultReject,
    };
    this.jobs.set(key, entry);
    this.queue.push(entry);
    this.schedulePump();

    const pool = this;
    return {
      jobId,
      attempt,
      started,
      result: result as Promise<TResult>,
      get state() { return entry.state; },
      get pid() { return entry.handle?.pid; },
      cancel: (reason?: string) => pool.cancelEntry(entry, reason),
      steer: (payload: unknown, steerId?: string) => pool.steerEntry(entry, payload, steerId),
    };
  }

  private jobKey(jobId: string, attempt: number): string {
    return `${jobId}\0${attempt}`;
  }

  private schedulePump(): void {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    queueMicrotask(() => void this.pump());
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        if (this.shuttingDown) return;
        while (true) {
          const entry = this.queue.find((candidate) => !candidate.settled && candidate.state === 'queued');
          if (!entry) break;
          let slot = this.slots.find((candidate) => !candidate.busy);
          if (!slot && this.slots.length < this.options.maxWorkers) slot = this.createSlot();
          if (!slot) break;
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          slot.busy = true;
          entry.state = 'starting';
          void this.runEntry(slot, entry);
        }
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
      if (this.pumpAgain) this.schedulePump();
    }
  }

  private createSlot(): PoolSlot {
    const id = this.nextSlotId++;
    const worker = new TurnWorkerProcess({
      ...this.options,
      name: `${this.options.name}-${id}-${crypto.randomBytes(3).toString('hex')}`,
    });
    const slot: PoolSlot = { id, worker, busy: false };
    this.slots.push(slot);
    return slot;
  }

  private async runEntry(slot: PoolSlot, entry: PoolEntry): Promise<void> {
    try {
      const handle = await slot.worker.runJob(entry.request, entry.handlers);
      entry.handle = handle;
      if (entry.cancelRequested !== undefined) await handle.cancel(entry.cancelRequested);
      handle.started.then(
        (details) => {
          if (!entry.settled) {
            entry.state = 'running';
            entry.startedResolve(details);
          }
        },
        (error) => {
          if (!entry.settled) entry.startedReject(error instanceof Error ? error : new Error(String(error)));
        },
      );
      const result = await handle.result;
      this.settleEntry(entry, undefined, result);
    } catch (error) {
      this.settleEntry(entry, error instanceof Error ? error : new Error(String(error)));
    } finally {
      slot.busy = false;
      const status = slot.worker.getStatus();
      if (slot.worker.jobsCompleted >= this.options.recycleAfterJobs || status.state === 'failed') {
        const index = this.slots.indexOf(slot);
        if (index >= 0) this.slots.splice(index, 1);
        await slot.worker.shutdown(this.options.shutdownGraceMs).catch(() => {});
      }
      this.schedulePump();
    }
  }

  private settleEntry(entry: PoolEntry, error?: Error, result?: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    entry.state = 'settled';
    this.jobs.delete(this.jobKey(entry.request.jobId, entry.request.attempt));
    if (error) {
      entry.startedReject(error);
      entry.resultReject(error);
    } else {
      entry.resultResolve(result);
    }
  }

  private async cancelEntry(entry: PoolEntry, reason?: string): Promise<void> {
    if (entry.settled) return;
    const normalizedReason = String(reason || 'Turn cancelled while queued.');
    if (entry.state === 'queued') {
      const index = this.queue.indexOf(entry);
      if (index >= 0) this.queue.splice(index, 1);
      this.settleEntry(entry, new TurnWorkerProcessError(normalizedReason, {
        code: 'TURN_CANCELLED',
        jobId: entry.request.jobId,
        attempt: entry.request.attempt,
      }));
      return;
    }
    if (!entry.handle) {
      entry.cancelRequested = normalizedReason;
      return;
    }
    await entry.handle.cancel(normalizedReason);
  }

  private async steerEntry(
    entry: PoolEntry,
    payload: unknown,
    steerId?: string,
  ): Promise<TurnWorkerSteerAckMessage> {
    if (entry.settled || entry.state === 'queued' || !entry.handle) {
      throw new TurnWorkerProcessError('Turn is not running yet and cannot be steered.', {
        code: 'TURN_WORKER_UNAVAILABLE',
        jobId: entry.request.jobId,
        attempt: entry.request.attempt,
      });
    }
    return entry.handle.steer(payload, steerId);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const error = new TurnWorkerProcessError(`${this.options.name} shut down before the turn started.`, {
      code: 'TURN_WORKER_SHUTDOWN',
    });
    for (const entry of this.queue.splice(0)) this.settleEntry(entry, error);
    const running = [...this.jobs.values()].filter((entry) => !entry.settled);
    await Promise.allSettled(running.map((entry) => this.cancelEntry(entry, 'Turn worker pool shutdown.')));
    await Promise.allSettled(this.slots.map((slot) => slot.worker.shutdown(this.options.shutdownGraceMs)));
    this.slots.length = 0;
  }
}
