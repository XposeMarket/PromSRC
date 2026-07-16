import path from 'path';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import { scheduleMemoryIndexRefresh, type MemorySearchParams } from './index.js';

export type MemorySearchWorkerKind = 'memory_search' | 'memory_search_project' | 'memory_search_timeline';

export interface MemorySearchWorkerRequest {
  workspacePath: string;
  params?: MemorySearchParams;
  projectId?: string;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

interface MemorySearchWorkerResult {
  serialized: string;
  backend?: string;
  usedJsonFallback: boolean;
  rssBytes: number;
}

interface QueuedSearch {
  kind: MemorySearchWorkerKind;
  payload: MemorySearchWorkerRequest;
  timeoutMs: number;
  signal?: AbortSignal;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
  timeoutHandle?: NodeJS.Timeout;
  deadlineAt: number;
  settled: boolean;
}

export interface MemorySearchWorkerStatus {
  enabled: boolean;
  isolation: 'child_process';
  active: boolean;
  queued: number;
  shuttingDown: boolean;
  broker: RuntimeWorkerBrokerStatus;
}

function envMs(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

function envBytes(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

const workerEnabled = String(process.env.PROMETHEUS_MEMORY_SEARCH_WORKER || '1').trim() !== '0';
const quickTimeoutMs = envMs('PROMETHEUS_MEMORY_SEARCH_QUICK_TIMEOUT_MS', 8_000, 1_000, 5 * 60_000);
const deepTimeoutMs = envMs('PROMETHEUS_MEMORY_SEARCH_DEEP_TIMEOUT_MS', 15_000, 2_000, 10 * 60_000);
const recycleRssBytes = envBytes('PROMETHEUS_MEMORY_SEARCH_RECYCLE_RSS_BYTES', 768 * 1024 * 1024, 128 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
const maxQueued = 2;
const broker = new RuntimeWorkerBroker({
  name: 'memory-search-query',
  entryBasename: 'memory-search-worker',
  maxMessageBytes: 256 * 1024,
  startupTimeoutMs: envMs('PROMETHEUS_MEMORY_SEARCH_STARTUP_TIMEOUT_MS', 30_000, 1000, 2 * 60_000),
  defaultJobTimeoutMs: deepTimeoutMs,
  env: {
    PROMETHEUS_MEMORY_SEARCH_QUERY_WORKER: '1',
  },
});

const queue: QueuedSearch[] = [];
let active: QueuedSearch | null = null;
let draining = false;
let drainScheduled = false;
let shuttingDown = false;

function abortError(message = 'Memory search was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function settle(task: QueuedSearch, outcome: { value: string } | { error: Error }): void {
  if (task.settled) return;
  task.settled = true;
  if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
  if (task.signal && task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
  if ('value' in outcome) task.resolve(outcome.value);
  else task.reject(outcome.error);
}

function scheduleMaintenance(kind: MemorySearchWorkerKind, workspacePath: string): void {
  scheduleMemoryIndexRefresh(workspacePath, {
    minIntervalMs: kind === 'memory_search' ? 15_000 : 20_000,
    maxChangedFiles: 120,
  });
}

function timeoutFor(kind: MemorySearchWorkerKind, payload: MemorySearchWorkerRequest): number {
  if (kind === 'memory_search' && String(payload.params?.mode || 'quick') === 'deep') return deepTimeoutMs;
  if (kind === 'memory_search_timeline') return deepTimeoutMs;
  return quickTimeoutMs;
}

function scheduleDrain(): void {
  if (drainScheduled || draining || shuttingDown) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    void drainQueue();
  });
}

async function recycleWorker(): Promise<void> {
  await broker.shutdown(1500).catch(() => undefined);
}

async function drainQueue(): Promise<void> {
  if (draining || shuttingDown) return;
  draining = true;
  try {
    while (!shuttingDown && queue.length > 0) {
      const task = queue.shift()!;
      if (task.settled || task.signal?.aborted) {
        settle(task, { error: abortError() });
        continue;
      }
      active = task;
      const remainingMs = task.deadlineAt - Date.now();
      if (remainingMs <= 0) {
        settle(task, { error: new Error(`Memory search timed out after ${task.timeoutMs}ms (queue included).`) });
        active = null;
        continue;
      }
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
        task.timeoutHandle = undefined;
      }
      let cancelled = false;
      const onActiveAbort = () => {
        cancelled = true;
        broker.forceKill();
      };
      if (task.signal) {
        if (task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
        task.abortListener = onActiveAbort;
        task.signal.addEventListener('abort', onActiveAbort, { once: true });
        if (task.signal.aborted) onActiveAbort();
      }
      try {
        const result = await broker.run<MemorySearchWorkerResult>(task.kind, task.payload, remainingMs);
        if (cancelled || task.signal?.aborted) {
          settle(task, { error: abortError() });
          await recycleWorker();
        } else {
          settle(task, { value: result.serialized });
          if (result.usedJsonFallback || Number(result.rssBytes || 0) >= recycleRssBytes) {
            await recycleWorker();
          }
        }
      } catch (error: any) {
        const normalized = shuttingDown
          ? new Error('Memory search worker is shutting down.')
          : cancelled || task.signal?.aborted
            ? abortError()
            : error instanceof Error ? error : new Error(String(error));
        settle(task, { error: normalized });
        // Wait for the killed/failed child to exit and clear broker state before
        // allowing another queued job to spawn a replacement.
        await recycleWorker();
      } finally {
        active = null;
      }
    }
  } finally {
    draining = false;
    if (!shuttingDown && queue.length > 0) scheduleDrain();
  }
}

export function isMemorySearchWorkerEnabled(): boolean {
  return workerEnabled;
}

export function searchMemoryInWorker(
  kind: MemorySearchWorkerKind,
  request: MemorySearchWorkerRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (!workerEnabled) return Promise.reject(new Error('Memory search worker is disabled.'));
  if (shuttingDown) return Promise.reject(new Error('Memory search worker is shutting down.'));
  const workspacePath = String(request.workspacePath || '').trim();
  if (!workspacePath) return Promise.reject(new Error('Memory search worker requires a workspace path.'));
  if (options.signal?.aborted) return Promise.reject(abortError());
  if ((active ? 1 : 0) + queue.length >= 1 + maxQueued) {
    return Promise.reject(new Error('Memory search worker is busy (one active query and two queued queries maximum).'));
  }

  const payload = { ...request, workspacePath: path.resolve(workspacePath) };
  scheduleMaintenance(kind, payload.workspacePath);
  const configuredTimeout = timeoutFor(kind, payload);
  const timeoutMs = process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS === '1' && Number.isFinite(Number(options.timeoutMs))
    ? Math.max(50, Math.min(configuredTimeout, Number(options.timeoutMs)))
    : configuredTimeout;
  return new Promise<string>((resolve, reject) => {
    const task: QueuedSearch = {
      kind,
      payload,
      timeoutMs,
      signal: options.signal,
      deadlineAt: Date.now() + timeoutMs,
      resolve,
      reject,
      settled: false,
    };
    const onQueuedAbort = () => {
      if (active === task) return;
      const index = queue.indexOf(task);
      if (index >= 0) queue.splice(index, 1);
      settle(task, { error: abortError() });
    };
    if (task.signal) {
      task.abortListener = onQueuedAbort;
      task.signal.addEventListener('abort', onQueuedAbort, { once: true });
    }
    task.timeoutHandle = setTimeout(() => {
      if (active === task || task.settled) return;
      const index = queue.indexOf(task);
      if (index >= 0) queue.splice(index, 1);
      settle(task, { error: new Error(`Memory search timed out after ${timeoutMs}ms while queued.`) });
    }, timeoutMs);
    task.timeoutHandle.unref?.();
    queue.push(task);
    scheduleDrain();
  });
}

export function getMemorySearchWorkerStatus(): MemorySearchWorkerStatus {
  return {
    enabled: workerEnabled,
    isolation: 'child_process',
    active: !!active,
    queued: queue.length,
    shuttingDown,
    broker: broker.getStatus(),
  };
}

export async function shutdownMemorySearchWorker(): Promise<void> {
  shuttingDown = true;
  const error = new Error('Memory search worker is shutting down.');
  for (const task of queue.splice(0)) settle(task, { error });
  if (active) {
    settle(active, { error });
    broker.forceKill();
  }
  await recycleWorker();
}
