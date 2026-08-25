import path from 'path';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import { scheduleMemoryIndexRefresh, type MemorySearchParams } from './index.js';
import { acquireMemoryAccess } from './memory-access-gate.js';

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
  warmup: MemorySearchWorkerWarmupStatus;
}

export interface MemorySearchWorkerWarmupStatus {
  processReadyAt?: number;
  processStartupMs?: number;
  queryStartedAt?: number;
  queryCompletedAt?: number;
  queryDurationMs?: number;
  queryStatus: 'not_started' | 'completed' | 'skipped' | 'failed';
  queryError?: string;
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
const deepTimeoutMs = envMs('PROMETHEUS_MEMORY_SEARCH_DEEP_TIMEOUT_MS', 30_000, 2_000, 10 * 60_000);
const warmupTimeoutMs = envMs('PROMETHEUS_MEMORY_SEARCH_WARMUP_TIMEOUT_MS', 2_000, 1_000, 10_000);
// Process readiness and first-query readiness are separate phases. A cold
// SQLite/FTS open can legitimately exceed the automatic prompt SLA without
// meaning that the child process is unhealthy. Keep the prewarm query bounded,
// but do not let the old 2s gate kill a healthy worker before real demand.
const prewarmQueryTimeoutMs = envMs(
  'PROMETHEUS_MEMORY_SEARCH_PREWARM_TIMEOUT_MS',
  15_000,
  Math.max(1_000, warmupTimeoutMs),
  60_000,
);
const recycleRssBytes = envBytes('PROMETHEUS_MEMORY_SEARCH_RECYCLE_RSS_BYTES', 768 * 1024 * 1024, 128 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
const automaticIdleTtlMs = envMs('PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_IDLE_TTL_MS', 30_000, 1_000, 10 * 60_000);
// Production automatic retrieval remains capped at 250 ms. The regression
// suite may use a larger test-only window to observe a cold child's direct
// request path without weakening the real prompt-retrieval SLA.
const automaticTimeoutCeilingMs = String(process.env.PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_HOOKS || '').trim() === '1'
  ? envMs('PROMETHEUS_MEMORY_SEARCH_WORKER_TEST_TIMEOUT_CEILING_MS', 250, 250, 5_000)
  : 250;
const maxQueued = 2;
const broker = new RuntimeWorkerBroker({
  name: 'memory-search-query',
  entryBasename: 'memory-search-worker',
  maxMessageBytes: 256 * 1024,
  startupTimeoutMs: envMs('PROMETHEUS_MEMORY_SEARCH_STARTUP_TIMEOUT_MS', 30_000, 1000, 2 * 60_000),
  defaultJobTimeoutMs: deepTimeoutMs,
  maxRssBytes: recycleRssBytes,
  env: {
    PROMETHEUS_MEMORY_SEARCH_QUERY_WORKER: '1',
  },
});

// Automatic prompt retrieval has a much tighter deadline than an explicit
// memory tool call. Keep it on a small read-only worker pool so one explicit
// search, maintenance handoff, or slow automatic query cannot serialize every
// other chat turn behind the same child process.
const automaticWorkerCount = Math.max(
  1,
  Math.min(2, Math.floor(Number(process.env.PROMETHEUS_AUTOMATIC_MEMORY_SEARCH_WORKERS || 2) || 2)),
);
const automaticMaxQueued = 8;
const automaticBrokers = Array.from({ length: automaticWorkerCount }, (_, index) => new RuntimeWorkerBroker({
  name: `memory-search-automatic-${index + 1}`,
  entryBasename: 'memory-search-worker',
  maxMessageBytes: 256 * 1024,
  startupTimeoutMs: envMs('PROMETHEUS_MEMORY_SEARCH_STARTUP_TIMEOUT_MS', 30_000, 1000, 2 * 60_000),
  defaultJobTimeoutMs: quickTimeoutMs,
  env: {
    PROMETHEUS_MEMORY_SEARCH_QUERY_WORKER: '1',
  },
  // Keep one worker logically warm, but still give its process the same RSS
  // ceiling as the elastic slot. A floor process may rotate after a lookup;
  // the client replaces it before treating the floor as healthy again.
  maxRssBytes: recycleRssBytes,
  idleTtlMs: index === 0 ? 0 : automaticIdleTtlMs,
}));

interface QueuedAutomaticSearch {
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

interface AutomaticSearchSlot {
  broker: RuntimeWorkerBroker;
  active: boolean;
  warmFloor: boolean;
}

const automaticQueue: QueuedAutomaticSearch[] = [];
const automaticSlots: AutomaticSearchSlot[] = automaticBrokers.map((automaticBroker, index) => ({
  broker: automaticBroker,
  active: false,
  warmFloor: index === 0,
}));
let automaticDrainScheduled = false;
let automaticDraining = false;
let automaticWarmupTimer: NodeJS.Timeout | null = null;
let automaticWarmupPromise: Promise<void> | null = null;
let automaticShuttingDown = false;

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

function settleAutomatic(
  task: QueuedAutomaticSearch,
  outcome: { value: string } | { error: Error },
): void {
  if (task.settled) return;
  task.settled = true;
  if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
  if (task.signal && task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
  if ('value' in outcome) task.resolve(outcome.value);
  else task.reject(outcome.error);
}

function scheduleAutomaticDrain(): void {
  if (automaticDrainScheduled || automaticDraining || automaticShuttingDown) return;
  automaticDrainScheduled = true;
  setImmediate(() => {
    automaticDrainScheduled = false;
    void drainAutomaticQueue();
  });
}

function hasRssRetirement(status: RuntimeWorkerBrokerStatus): boolean {
  return String(status.retirementReason || '').startsWith('rss_limit_');
}

async function rotateAutomaticWarmFloor(slot: AutomaticSearchSlot, workspacePath: string): Promise<void> {
  const elastic = automaticSlots.find((candidate) => !candidate.warmFloor);
  // If the elastic slot is already covering another request, it is useful
  // coverage during this rotation. Otherwise make it ready before retiring
  // the floor so a concurrent request does not lose all capacity.
  if (elastic && !elastic.active) await warmAutomaticSlot(elastic, workspacePath);
  await slot.broker.shutdown(1500);
  await warmAutomaticSlot(slot, workspacePath);
}

async function runAutomaticSearchTask(slot: AutomaticSearchSlot, task: QueuedAutomaticSearch): Promise<void> {
  slot.active = true;
  if (task.timeoutHandle) {
    clearTimeout(task.timeoutHandle);
    task.timeoutHandle = undefined;
  }

  const remainingMs = task.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    settleAutomatic(task, { error: new Error(`Automatic memory search timed out after ${task.timeoutMs}ms while queued.`) });
    slot.active = false;
    scheduleAutomaticDrain();
    return;
  }

  let timedOut = false;
  let cancelled = false;
  let rssRotationRequested = false;
  let removeSignalListener: (() => void) | undefined;
  const workerPromise = slot.broker.run<MemorySearchWorkerResult>(task.kind, task.payload, Math.max(1_000, remainingMs));
  const onAbort = () => {
    cancelled = true;
    slot.broker.forceKill();
  };
  if (task.signal) {
    if (task.signal.aborted) onAbort();
    else {
      task.signal.addEventListener('abort', onAbort, { once: true });
      removeSignalListener = () => task.signal?.removeEventListener('abort', onAbort);
    }
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      task.timeoutHandle = setTimeout(() => {
        timedOut = true;
        slot.broker.forceKill();
        reject(new Error(`Automatic memory search exceeded ${remainingMs}ms.`));
      }, remainingMs);
      task.timeoutHandle.unref?.();
    });
    const result = await Promise.race([workerPromise, timeoutPromise]);
    if (cancelled || task.signal?.aborted) settleAutomatic(task, { error: abortError() });
    else {
      settleAutomatic(task, { value: result.serialized });
      const rssExceeded = Number(result.rssBytes || 0) >= recycleRssBytes;
      const brokerStatus = slot.broker.getStatus();
      rssRotationRequested = rssExceeded || hasRssRetirement(brokerStatus);
      if (rssRotationRequested && slot.warmFloor) {
        await rotateAutomaticWarmFloor(slot, task.payload.workspacePath);
      } else if (rssRotationRequested || (!slot.warmFloor && result.usedJsonFallback)) {
        await slot.broker.shutdown(1500);
      }
    }
  } catch (error: any) {
    const normalized = cancelled || task.signal?.aborted
      ? abortError()
      : error instanceof Error ? error : new Error(String(error));
    settleAutomatic(task, { error: normalized });
  } finally {
    if (timedOut || cancelled) await workerPromise.catch(() => undefined);
    if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
    removeSignalListener?.();
    slot.active = false;
    if (!automaticShuttingDown && slot.broker.getStatus().state !== 'ready') {
      scheduleAutomaticMemorySearchWorkerWarmup(task.payload.workspacePath, rssRotationRequested ? 0 : 250);
    }
    scheduleAutomaticDrain();
  }
}

async function drainAutomaticQueue(): Promise<void> {
  if (automaticDraining || automaticShuttingDown) return;
  automaticDraining = true;
  try {
    while (!automaticShuttingDown) {
      const task = automaticQueue.shift();
      const readySlot = automaticSlots.find((candidate) => !candidate.active && candidate.broker.getStatus().state === 'ready');
      // The floor handles the normal single-request path. If it is already
      // busy and demand increases after the elastic slot retired, let that
      // cold elastic slot take the real request directly. A separate warmup
      // search would consume the same 250 ms deadline before useful work ran.
      const slot = readySlot || automaticSlots.find((candidate) => (
        !candidate.active
        && !candidate.warmFloor
        && ['stopped', 'failed', 'starting', 'stopping'].includes(candidate.broker.getStatus().state)
      ));
      if (!slot || !task) {
        if (task) {
          automaticQueue.unshift(task);
          if (!slot) scheduleAutomaticMemorySearchWorkerWarmup(task.payload.workspacePath, 0);
        }
        break;
      }
      if (task.settled || task.signal?.aborted) {
        settleAutomatic(task, { error: abortError() });
        continue;
      }
      void runAutomaticSearchTask(slot, task);
    }
  } finally {
    automaticDraining = false;
    if (!automaticShuttingDown && automaticQueue.length > 0) scheduleAutomaticDrain();
  }
}

async function warmAutomaticSlot(slot: AutomaticSearchSlot, workspacePath: string): Promise<void> {
  // A healthy sibling does not mean this slot is warm. Rewarm only the
  // missing slot so recovery does not repeat an expensive query on every
  // already-ready worker.
  if (slot.broker.getStatus().state === 'ready') return;
  await slot.broker.warmup();
  try {
    await slot.broker.run<MemorySearchWorkerResult>('memory_search', {
      workspacePath: path.resolve(workspacePath),
      params: {
        query: 'memory search',
        mode: 'quick',
        limit: 4,
        rerank: false,
        queryRoute: 'startup_automatic_warmup',
      },
    }, prewarmQueryTimeoutMs);
  } catch (error: any) {
    if (slot.broker.getStatus().state === 'ready' || slot.broker.getStatus().state === 'busy') {
      console.warn(`[memory-search-worker] automatic prewarm query failed after process readiness; keeping slot alive: ${String(error?.message || error).slice(0, 400)}`);
      return;
    }
    throw error;
  }
}

/** Warm the isolated automatic-search slots without touching the explicit-search lane. */
export async function warmAutomaticMemorySearchWorkers(workspacePath: string): Promise<void> {
  if (!workerEnabled || automaticShuttingDown) return;
  const resolvedWorkspacePath = String(workspacePath || '').trim();
  if (!resolvedWorkspacePath) return;
  if (automaticWarmupPromise) {
    await automaticWarmupPromise;
    return;
  }
  automaticWarmupPromise = (async () => {
    const outcomes = await Promise.allSettled(automaticSlots.map((slot) => warmAutomaticSlot(slot, resolvedWorkspacePath)));
    const failedOutcome = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failedOutcome) {
      // Do not tear down a sibling that stayed healthy while one slot failed
      // its short warmup. The failed slot will be retried by the bounded
      // rewarm tick below.
      for (const slot of automaticSlots) {
        const state = slot.broker.getStatus().state;
        if (state !== 'ready' && state !== 'busy') slot.broker.forceKill();
      }
      throw failedOutcome.reason;
    }
  })().finally(() => {
    automaticWarmupPromise = null;
    if (!automaticShuttingDown && automaticSlots.some((slot) => slot.broker.getStatus().state !== 'ready')) {
      scheduleAutomaticMemorySearchWorkerWarmup(resolvedWorkspacePath, 1_000);
    }
    if (!automaticShuttingDown) scheduleAutomaticDrain();
  });
  await automaticWarmupPromise;
}

export function scheduleAutomaticMemorySearchWorkerWarmup(workspacePath: string, delayMs = 250): void {
  if (!workerEnabled || automaticShuttingDown || automaticWarmupTimer || automaticWarmupPromise) return;
  const resolvedWorkspacePath = String(workspacePath || '').trim();
  if (!resolvedWorkspacePath) return;
  if (automaticSlots.some((slot) => slot.broker.getStatus().state === 'busy' || slot.broker.getStatus().state === 'starting')) return;
  if (automaticSlots.every((slot) => slot.broker.getStatus().state === 'ready')) return;
  automaticWarmupTimer = setTimeout(() => {
    automaticWarmupTimer = null;
    void warmAutomaticMemorySearchWorkers(resolvedWorkspacePath).catch(() => undefined);
  }, Math.max(0, Math.floor(delayMs)));
  automaticWarmupTimer.unref?.();
}

export function getAutomaticMemorySearchWorkerStatus(): {
  workerCount: number;
  active: number;
  queued: number;
  ready: number;
  warming: boolean;
  workers: RuntimeWorkerBrokerStatus[];
} {
  return {
    workerCount: automaticSlots.length,
    active: automaticSlots.filter((slot) => slot.active).length,
    queued: automaticQueue.length,
    ready: automaticSlots.filter((slot) => slot.broker.getStatus().state === 'ready').length,
    warming: Boolean(automaticWarmupPromise || automaticWarmupTimer),
    workers: automaticSlots.map((slot) => slot.broker.getStatus()),
  };
}

export function searchMemoryAutomaticallyInWorker(
  kind: MemorySearchWorkerKind,
  request: MemorySearchWorkerRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (!workerEnabled) return Promise.reject(new Error('Memory search worker is disabled.'));
  if (automaticShuttingDown) return Promise.reject(new Error('Automatic memory search workers are shutting down.'));
  const workspacePath = String(request.workspacePath || '').trim();
  if (!workspacePath) return Promise.reject(new Error('Automatic memory search requires a workspace path.'));
  if (options.signal?.aborted) return Promise.reject(abortError());
  const configuredTimeout = Number(options.timeoutMs || 250);
  const timeoutMs = Math.max(40, Math.min(automaticTimeoutCeilingMs, Number.isFinite(configuredTimeout) ? Math.floor(configuredTimeout) : 250));
  if (automaticQueue.length >= automaticMaxQueued) {
    return Promise.reject(new Error('Automatic memory search worker pool is busy.'));
  }

  const payload = { ...request, workspacePath: path.resolve(workspacePath) };
  return new Promise<string>((resolve, reject) => {
    const task: QueuedAutomaticSearch = {
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
      if (task.settled) return;
      const index = automaticQueue.indexOf(task);
      if (index >= 0) automaticQueue.splice(index, 1);
      settleAutomatic(task, { error: abortError() });
    };
    if (task.signal) {
      task.abortListener = onQueuedAbort;
      task.signal.addEventListener('abort', onQueuedAbort, { once: true });
    }
    task.timeoutHandle = setTimeout(() => {
      const index = automaticQueue.indexOf(task);
      if (index >= 0) automaticQueue.splice(index, 1);
      settleAutomatic(task, { error: new Error(`Automatic memory search timed out after ${timeoutMs}ms while queued.`) });
    }, timeoutMs);
    task.timeoutHandle.unref?.();
    automaticQueue.push(task);
    scheduleAutomaticDrain();
  });
}

function scheduleMaintenance(kind: MemorySearchWorkerKind, workspacePath: string): void {
  scheduleMemoryIndexRefresh(workspacePath, {
    minIntervalMs: kind === 'memory_search' ? 15_000 : 20_000,
    maxChangedFiles: 120,
  });
}

function scheduleMaintenanceAfterQuery(
  kind: MemorySearchWorkerKind,
  workspacePath: string,
  payload?: MemorySearchWorkerRequest,
): void {
  if (kind === 'memory_search') {
    const queryRoute = String(payload?.params?.queryRoute || '');
    // Automatic prompt retrieval and startup warmup must never enqueue a
    // writer. Explicit memory-tool routes are the only query paths that ask
    // for a debounced freshness check after the read completes.
    if (!['tool_manual', 'legacy_executor', 'debug_tool'].includes(queryRoute)) return;
  }
  // Let the just-completed query release its worker/SQLite pressure before an
  // index refresh is queued. Refresh remains automatic, but no longer races
  // the search at the beginning of every request.
  const timer = setTimeout(() => scheduleMaintenance(kind, workspacePath), 0);
  timer.unref?.();
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

let warmupTimer: NodeJS.Timeout | null = null;
let warmupPromise: Promise<void> | null = null;
let warmupAttempts = 0;
let warmupActive = false;
let warmupDiagnostics: MemorySearchWorkerWarmupStatus = { queryStatus: 'not_started' };

function scheduleWorkerWarmup(workspacePath: string, delayMs = 250): void {
  if (!workerEnabled || shuttingDown || warmupTimer || warmupPromise) return;
  const resolvedWorkspacePath = String(workspacePath || '').trim();
  if (!resolvedWorkspacePath) return;
  const brokerState = broker.getStatus().state;
  if (brokerState === 'ready' || brokerState === 'busy' || brokerState === 'starting') return;
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    warmupAttempts += 1;
    warmupPromise = warmMemorySearchWorker(resolvedWorkspacePath)
      .then(() => {
        warmupAttempts = 0;
      })
      .catch(() => {
        if (warmupAttempts < 3) {
          const retryTimer = setTimeout(() => scheduleWorkerWarmup(resolvedWorkspacePath), 1000);
          retryTimer.unref?.();
        }
      })
      .finally(() => {
        warmupPromise = null;
      });
    void warmupPromise;
  }, Math.max(0, Math.floor(delayMs)));
  warmupTimer.unref?.();
}

/** Queue a best-effort worker re-warm without making the caller wait. */
export function scheduleMemorySearchWorkerWarmup(workspacePath: string, delayMs = 0): void {
  scheduleWorkerWarmup(workspacePath, delayMs);
}

async function recycleWorker(workspacePath?: string): Promise<void> {
  await broker.shutdown(1500).catch(() => undefined);
  if (workspacePath && !shuttingDown) scheduleWorkerWarmup(workspacePath);
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
      let releaseMemoryAccess: (() => void) | undefined;
      try {
        releaseMemoryAccess = await acquireMemoryAccess('search', {
          signal: task.signal,
          timeoutMs: remainingMs,
        });
        const result = await broker.run<MemorySearchWorkerResult>(task.kind, task.payload, remainingMs);
        if (cancelled || task.signal?.aborted) {
          settle(task, { error: abortError() });
          await recycleWorker(task.payload.workspacePath);
        } else {
          settle(task, { value: result.serialized });
          scheduleMaintenanceAfterQuery(task.kind, task.payload.workspacePath, task.payload);
          if (result.usedJsonFallback || Number(result.rssBytes || 0) >= recycleRssBytes) {
            await recycleWorker(task.payload.workspacePath);
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
        await recycleWorker(task.payload.workspacePath);
      } finally {
        releaseMemoryAccess?.();
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

export function isMemorySearchWorkerReady(): boolean {
  const status = broker.getStatus();
  return workerEnabled
    && !shuttingDown
    && status.state === 'ready'
    && !active
    && !warmupActive
    && !warmupPromise
    && queue.length === 0;
}

async function runExplicitPrewarmQuery(workspacePath: string): Promise<void> {
  await broker.run<MemorySearchWorkerResult>('memory_search', {
    workspacePath: path.resolve(workspacePath),
    params: {
      query: 'memory search',
      mode: 'quick',
      limit: 4,
      rerank: false,
      queryRoute: 'startup_warmup',
    },
  }, prewarmQueryTimeoutMs);
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

/**
 * Start the isolated query worker and touch the real SQLite/FTS path before
 * the first user search. The worker's ready message only proves that the
 * child IPC loop started; it does not prove that the index can answer a
 * query within the automatic prompt budget.
 */
export async function warmMemorySearchWorker(workspacePath?: string): Promise<void> {
  if (!workerEnabled || shuttingDown) return;
  const processStartedAt = Date.now();
  warmupDiagnostics = { queryStatus: 'not_started' };
  await broker.warmup();
  warmupDiagnostics = {
    processReadyAt: Date.now(),
    processStartupMs: Math.max(0, Date.now() - processStartedAt),
    queryStatus: 'skipped',
  };
  const resolvedWorkspacePath = String(workspacePath || '').trim();
  if (!resolvedWorkspacePath) return;
  warmupActive = true;
  let releaseMemoryAccess: (() => void) | undefined;
  try {
    try {
      releaseMemoryAccess = await acquireMemoryAccess('search', { timeoutMs: prewarmQueryTimeoutMs });
    } catch (error: any) {
      warmupDiagnostics.queryStatus = 'failed';
      warmupDiagnostics.queryError = String(error?.message || error).slice(0, 400);
      console.warn(`[memory-search-worker] prewarm skipped after process readiness because the search gate was unavailable: ${warmupDiagnostics.queryError}`);
      return;
    }
    warmupDiagnostics.queryStartedAt = Date.now();
    warmupDiagnostics.queryStatus = 'failed';
    try {
      await runExplicitPrewarmQuery(resolvedWorkspacePath);
      warmupDiagnostics.queryCompletedAt = Date.now();
      warmupDiagnostics.queryDurationMs = Math.max(0, warmupDiagnostics.queryCompletedAt - Number(warmupDiagnostics.queryStartedAt || warmupDiagnostics.queryCompletedAt));
      warmupDiagnostics.queryStatus = 'completed';
    } catch (error: any) {
      warmupDiagnostics.queryCompletedAt = Date.now();
      warmupDiagnostics.queryDurationMs = Math.max(0, warmupDiagnostics.queryCompletedAt - Number(warmupDiagnostics.queryStartedAt || warmupDiagnostics.queryCompletedAt));
      warmupDiagnostics.queryError = String(error?.message || error).slice(0, 400);
      const brokerState = broker.getStatus().state;
      if (brokerState === 'ready' || brokerState === 'busy') {
        // A query/index problem is not the same as a dead process. Keep the
        // ready child available for the real explicit request and expose the
        // failed prewarm phase in diagnostics.
        console.warn(`[memory-search-worker] prewarm query failed after process readiness; keeping worker alive: ${warmupDiagnostics.queryError}`);
        return;
      }
      await recycleWorker();
      throw error;
    }
  } finally {
    releaseMemoryAccess?.();
    warmupActive = false;
  }
}

export function getMemorySearchWorkerStatus(): MemorySearchWorkerStatus {
  return {
    enabled: workerEnabled,
    isolation: 'child_process',
    active: !!active || warmupActive,
    queued: queue.length,
    shuttingDown,
    broker: broker.getStatus(),
    warmup: { ...warmupDiagnostics },
  };
}

export async function shutdownMemorySearchWorker(): Promise<void> {
  shuttingDown = true;
  automaticShuttingDown = true;
  if (automaticWarmupTimer) clearTimeout(automaticWarmupTimer);
  automaticWarmupTimer = null;
  const automaticError = new Error('Automatic memory search workers are shutting down.');
  for (const task of automaticQueue.splice(0)) settleAutomatic(task, { error: automaticError });
  await Promise.all(automaticBrokers.map((automaticBroker) => automaticBroker.shutdown(1500).catch(() => undefined)));
  const error = new Error('Memory search worker is shutting down.');
  for (const task of queue.splice(0)) settle(task, { error });
  if (active) {
    settle(active, { error });
    broker.forceKill();
  }
  await recycleWorker();
}
