import {
  RuntimeWorkerBroker,
  type RuntimeWorkerBrokerStatus,
} from '../process/runtime-worker-broker.js';
import path from 'path';

export interface MemoryRefreshOptions {
  force?: boolean;
  minIntervalMs?: number;
  maxChangedFiles?: number;
  syncSqlite?: boolean;
}

export interface MemoryRefreshResult {
  indexedFiles: number;
  skippedFiles: number;
  removedFiles: number;
  deferredFiles: number;
  totalRecords: number;
  totalChunks: number;
  updatedAt: string;
}

export interface MemoryEmbeddingBackfillOptions {
  limit?: number;
  provider?: string;
  force?: boolean;
}

export interface MemoryEmbeddingBackfillResult {
  ok: boolean;
  provider: string;
  model: string;
  dimensions?: number;
  scanned: number;
  updated: number;
  skipped: number;
  error?: string;
}

interface MemoryRefreshState {
  running: boolean;
  queued: boolean;
  options: MemoryRefreshOptions;
  waiters: Array<{
    resolve: (result: MemoryRefreshResult) => void;
    reject: (error: Error) => void;
  }>;
}

interface MemoryEmbeddingJob {
  workspacePath: string;
  automatic: boolean;
  options: MemoryEmbeddingBackfillOptions;
  resolve?: (result: MemoryEmbeddingBackfillResult) => void;
  reject?: (error: Error) => void;
}

export interface MemoryIndexRefreshWorkerStatus {
  isolation: 'child_process';
  workerHeapMb: number;
  runningKind?: 'memory_index_refresh' | 'memory_embedding_backfill' | 'memory_embedding_auto_backfill';
  runningWorkspace?: string;
  queuedWorkspaces: number;
  queuedJobs: number;
  lastWorkerPid?: number;
  lastRunStartedAt?: number;
  lastRunCompletedAt?: number;
  lastResult?: MemoryRefreshResult;
  lastError?: string;
  broker: RuntimeWorkerBrokerStatus;
}

function envMs(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

const refreshTimeoutMs = envMs('PROMETHEUS_MEMORY_REFRESH_WORKER_TIMEOUT_MS', 15 * 60_000, 30_000);
const configuredMemoryWorkerHeapMb = Number(process.env.PROMETHEUS_MEMORY_REFRESH_WORKER_HEAP_MB || 3_072);
const memoryWorkerHeapMb = Number.isFinite(configuredMemoryWorkerHeapMb)
  ? Math.max(1_024, Math.min(4_096, Math.floor(configuredMemoryWorkerHeapMb)))
  : 3_072;
const broker = new RuntimeWorkerBroker({
  name: 'memory-index-maintenance',
  entryBasename: 'memory-index-worker',
  startupTimeoutMs: envMs('PROMETHEUS_MEMORY_REFRESH_WORKER_STARTUP_TIMEOUT_MS', 45_000, 1000),
  defaultJobTimeoutMs: refreshTimeoutMs,
  maxOldSpaceMb: memoryWorkerHeapMb,
  env: {
    PROMETHEUS_MEMORY_REFRESH_WORKER: '1',
  },
});

const refreshStates = new Map<string, MemoryRefreshState>();
const embeddingJobs: MemoryEmbeddingJob[] = [];
const queuedAutomaticEmbeddingWorkspaces = new Set<string>();
let drainScheduled = false;
let draining = false;
let shuttingDown = false;
let runningWorkspace = '';
let runningKind: MemoryIndexRefreshWorkerStatus['runningKind'];
let lastWorkerPid: number | undefined;
let lastRunStartedAt: number | undefined;
let lastRunCompletedAt: number | undefined;
let lastResult: MemoryRefreshResult | undefined;
let lastError = '';
let lastWarnedError = '';
let lastWarnedAt = 0;

function mergeMemoryRefreshOptions(current: MemoryRefreshOptions, next?: MemoryRefreshOptions): MemoryRefreshOptions {
  const merged: MemoryRefreshOptions = {
    force: Boolean(current.force || next?.force),
  };
  if (current.syncSqlite === true || next?.syncSqlite === true) merged.syncSqlite = true;
  else if (current.syncSqlite === false || next?.syncSqlite === false) merged.syncSqlite = false;

  const currentMin = Number.isFinite(Number(current.minIntervalMs)) ? Number(current.minIntervalMs) : null;
  const nextMin = Number.isFinite(Number(next?.minIntervalMs)) ? Number(next?.minIntervalMs) : null;
  if (currentMin !== null && nextMin !== null) merged.minIntervalMs = Math.min(currentMin, nextMin);
  else if (currentMin !== null) merged.minIntervalMs = currentMin;
  else if (nextMin !== null) merged.minIntervalMs = nextMin;

  const currentMax = Number.isFinite(Number(current.maxChangedFiles)) ? Number(current.maxChangedFiles) : null;
  const nextMax = Number.isFinite(Number(next?.maxChangedFiles)) ? Number(next?.maxChangedFiles) : null;
  if (currentMax !== null && nextMax !== null) merged.maxChangedFiles = Math.max(currentMax, nextMax);
  else if (currentMax !== null) merged.maxChangedFiles = currentMax;
  else if (nextMax !== null) merged.maxChangedFiles = nextMax;
  return merged;
}

function warnRefreshFailure(message: string): void {
  const now = Date.now();
  if (message === lastWarnedError && now - lastWarnedAt < 60_000) return;
  lastWarnedError = message;
  lastWarnedAt = now;
  console.warn(`[memory-index] Maintenance worker failed; continuing with the last good index: ${message}`);
}

function nextQueuedWorkspace(): [string, MemoryRefreshState] | null {
  for (const entry of refreshStates.entries()) {
    if (entry[1].queued && !entry[1].running) return entry;
  }
  return null;
}

function hasQueuedMaintenance(): boolean {
  return !!nextQueuedWorkspace() || embeddingJobs.length > 0;
}

function enqueueAutomaticEmbeddingBackfill(workspacePath: string): void {
  if (shuttingDown || queuedAutomaticEmbeddingWorkspaces.has(workspacePath)) return;
  queuedAutomaticEmbeddingWorkspaces.add(workspacePath);
  embeddingJobs.push({ workspacePath, automatic: true, options: {} });
}

function queueDrain(): void {
  if (drainScheduled || draining || shuttingDown) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    void drainRefreshQueue();
  });
}

async function drainRefreshQueue(): Promise<void> {
  if (draining || shuttingDown) return;
  draining = true;
  try {
    while (!shuttingDown) {
      const next = nextQueuedWorkspace();
      if (!next) {
        const embeddingJob = embeddingJobs.shift();
        if (!embeddingJob) break;
        runningWorkspace = embeddingJob.workspacePath;
        runningKind = embeddingJob.automatic ? 'memory_embedding_auto_backfill' : 'memory_embedding_backfill';
        lastRunStartedAt = Date.now();
        lastError = '';
        try {
          const result = await broker.run<MemoryEmbeddingBackfillResult>(runningKind, {
            workspacePath: embeddingJob.workspacePath,
            options: embeddingJob.options,
          }, refreshTimeoutMs);
          lastWorkerPid = broker.getStatus().pid || lastWorkerPid;
          lastRunCompletedAt = Date.now();
          embeddingJob.resolve?.(result);
        } catch (error: any) {
          const message = String(error?.message || error || 'Unknown maintenance worker failure').slice(0, 2000);
          const normalized = error instanceof Error ? error : new Error(message);
          lastError = message;
          lastRunCompletedAt = Date.now();
          if (!shuttingDown) warnRefreshFailure(message);
          embeddingJob.reject?.(normalized);
        } finally {
          if (embeddingJob.automatic) queuedAutomaticEmbeddingWorkspaces.delete(embeddingJob.workspacePath);
          runningWorkspace = '';
          runningKind = undefined;
          await broker.shutdown(1500).catch(() => undefined);
        }
        continue;
      }
      const [workspacePath, state] = next;
      const options = state.options;
      const waiters = state.waiters.splice(0);
      state.options = {};
      state.queued = false;
      state.running = true;
      runningWorkspace = workspacePath;
      runningKind = 'memory_index_refresh';
      lastRunStartedAt = Date.now();
      lastError = '';
      try {
        const result = await broker.run<MemoryRefreshResult>('memory_index_refresh', {
          workspacePath,
          options,
        }, refreshTimeoutMs);
        lastWorkerPid = broker.getStatus().pid || lastWorkerPid;
        lastResult = result;
        lastRunCompletedAt = Date.now();
        for (const waiter of waiters) waiter.resolve(result);
        enqueueAutomaticEmbeddingBackfill(workspacePath);
      } catch (error: any) {
        const message = String(error?.message || error || 'Unknown maintenance worker failure').slice(0, 2000);
        const normalized = error instanceof Error ? error : new Error(message);
        lastError = message;
        lastRunCompletedAt = Date.now();
        warnRefreshFailure(message);
        for (const waiter of waiters) waiter.reject(normalized);
      } finally {
        state.running = false;
        runningWorkspace = '';
        runningKind = undefined;
        // A refresh can temporarily need gigabytes of heap for legacy JSON
        // snapshots. Recycle the process after every run so that heap is returned
        // to the OS instead of becoming the maintenance worker's new baseline.
        await broker.shutdown(1500).catch(() => undefined);
      }
    }
  } finally {
    draining = false;
    if (!shuttingDown && hasQueuedMaintenance()) queueDrain();
  }
}

function enqueueMemoryIndexRefresh(
  workspacePath: string,
  options?: MemoryRefreshOptions,
  waiter?: { resolve: (result: MemoryRefreshResult) => void; reject: (error: Error) => void },
): boolean {
  const rawWorkspace = String(workspacePath || '').trim();
  const normalizedWorkspace = rawWorkspace ? path.resolve(rawWorkspace) : '';
  if (!normalizedWorkspace || shuttingDown) return false;
  const state = refreshStates.get(normalizedWorkspace) || {
    running: false,
    queued: false,
    options: {},
    waiters: [],
  };
  state.options = mergeMemoryRefreshOptions(state.options, options);
  state.queued = true;
  if (waiter) state.waiters.push(waiter);
  refreshStates.set(normalizedWorkspace, state);
  queueDrain();
  return true;
}

export function scheduleMemoryIndexRefreshInWorker(workspacePath: string, options?: MemoryRefreshOptions): void {
  enqueueMemoryIndexRefresh(workspacePath, options);
}

export function refreshMemoryIndexInWorker(
  workspacePath: string,
  options?: MemoryRefreshOptions,
): Promise<MemoryRefreshResult> {
  return new Promise<MemoryRefreshResult>((resolve, reject) => {
    const accepted = enqueueMemoryIndexRefresh(workspacePath, options, { resolve, reject });
    if (!accepted) reject(new Error(shuttingDown
      ? 'Memory index maintenance worker is shutting down.'
      : 'Memory index refresh requires a workspace path.'));
  });
}

export function backfillMemoryEmbeddingsInWorker(
  workspacePath: string,
  options?: MemoryEmbeddingBackfillOptions,
): Promise<MemoryEmbeddingBackfillResult> {
  const rawWorkspace = String(workspacePath || '').trim();
  const normalizedWorkspace = rawWorkspace ? path.resolve(rawWorkspace) : '';
  if (!normalizedWorkspace) return Promise.reject(new Error('Memory embedding backfill requires a workspace path.'));
  if (shuttingDown) return Promise.reject(new Error('Memory index maintenance worker is shutting down.'));
  return new Promise<MemoryEmbeddingBackfillResult>((resolve, reject) => {
    embeddingJobs.push({
      workspacePath: normalizedWorkspace,
      automatic: false,
      options: options || {},
      resolve,
      reject,
    });
    queueDrain();
  });
}

export function getMemoryIndexRefreshWorkerStatus(): MemoryIndexRefreshWorkerStatus {
  let queuedWorkspaces = 0;
  for (const state of refreshStates.values()) if (state.queued) queuedWorkspaces += 1;
  return {
    isolation: 'child_process',
    workerHeapMb: memoryWorkerHeapMb,
    runningKind,
    runningWorkspace: runningWorkspace || undefined,
    queuedWorkspaces,
    queuedJobs: queuedWorkspaces + embeddingJobs.length,
    lastWorkerPid,
    lastRunStartedAt,
    lastRunCompletedAt,
    lastResult,
    lastError: lastError || undefined,
    broker: broker.getStatus(),
  };
}

export async function shutdownMemoryIndexRefreshWorker(): Promise<void> {
  shuttingDown = true;
  for (const state of refreshStates.values()) {
    state.queued = false;
    state.options = {};
    const error = new Error('Memory index maintenance worker is shutting down.');
    for (const waiter of state.waiters.splice(0)) waiter.reject(error);
  }
  const error = new Error('Memory index maintenance worker is shutting down.');
  for (const job of embeddingJobs.splice(0)) job.reject?.(error);
  queuedAutomaticEmbeddingWorkspaces.clear();
  await broker.shutdown(1500).catch(() => undefined);
}
