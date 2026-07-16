import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import {
  buildPersonalityContext,
  capturePersonalityContextSnapshot,
  finalizePersonalityContextSnapshot,
  type BuildPersonalityContextOptions,
  type PersonalityContextSnapshot,
  type SkillWindow,
} from '../prompt-context.js';
import type { SkillsManager } from '../skills-runtime/skills-manager.js';

interface ContextBuildResult {
  context: string;
  rssBytes: number;
}

interface ContextBuildTask {
  sessionId: string;
  payload: {
    sessionId: string;
    workspacePath: string;
    messageText: string;
    executionMode: string;
    historyLength: number;
    extraCats?: string[];
    options: BuildPersonalityContextOptions & { serializedSnapshot: PersonalityContextSnapshot };
  };
  signal?: AbortSignal;
  deadlineAt: number;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  settled: boolean;
  abortListener?: () => void;
}

interface WorkerSlot {
  broker: RuntimeWorkerBroker;
  active: ContextBuildTask | null;
  completedJobs: number;
}

export interface ContextBuildWorkerPoolStatus {
  enabled: boolean;
  isolation: 'child_process' | 'in_process';
  workers: number;
  active: number;
  queued: number;
  maxQueued: number;
  shuttingDown: boolean;
  completed: number;
  failed: number;
  cancelled: number;
  fallbacks: number;
  fallbackActive: number;
  lastError?: string;
  brokers: RuntimeWorkerBrokerStatus[];
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

const enabled = String(process.env.PROMETHEUS_CONTEXT_BUILD_WORKERS || '1').trim() !== '0';
const fallbackEnabled = String(process.env.PROMETHEUS_CONTEXT_BUILD_IN_PROCESS_FALLBACK || '1').trim() !== '0';
const workerCount = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_COUNT', 2, 1, 4);
const maxQueued = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_MAX_QUEUE', 4, 0, 32);
const timeoutMs = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_TIMEOUT_MS', 15_000, 1_000, 120_000);
const startupTimeoutMs = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_STARTUP_TIMEOUT_MS', 15_000, 1_000, 120_000);
const maxMessageBytes = envInt('PROMETHEUS_CONTEXT_BUILD_MAX_MESSAGE_BYTES', 2 * 1024 * 1024, 64 * 1024, 8 * 1024 * 1024);
const recycleAfterJobs = envInt('PROMETHEUS_CONTEXT_BUILD_RECYCLE_JOBS', 100, 1, 10_000);
const recycleRssBytes = envInt('PROMETHEUS_CONTEXT_BUILD_RECYCLE_RSS_BYTES', 768 * 1024 * 1024, 128 * 1024 * 1024, 2_147_483_647);

const slots: WorkerSlot[] = Array.from({ length: workerCount }, (_, index) => ({
  broker: new RuntimeWorkerBroker({
    name: `context-build-${index + 1}`,
    entryBasename: 'context-build-worker',
    maxMessageBytes,
    startupTimeoutMs,
    defaultJobTimeoutMs: timeoutMs,
  }),
  active: null,
  completedJobs: 0,
}));
const queue: ContextBuildTask[] = [];
let shuttingDown = false;
let drainScheduled = false;
let completed = 0;
let failed = 0;
let cancelled = 0;
let fallbacks = 0;
let fallbackActive = 0;
let lastError = '';

function abortError(message = 'Context build was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function settle(task: ContextBuildTask, result: { value: string } | { error: Error }): void {
  if (task.settled) return;
  task.settled = true;
  if (task.signal && task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
  if ('value' in result) task.resolve(result.value);
  else task.reject(result.error);
}

function scheduleDrain(): void {
  if (drainScheduled || shuttingDown) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    for (const slot of slots) {
      if (!slot.active) void runNext(slot);
    }
  });
}

async function recycleSlot(slot: WorkerSlot): Promise<void> {
  await slot.broker.shutdown(1000).catch(() => undefined);
  slot.completedJobs = 0;
}

async function runNext(slot: WorkerSlot): Promise<void> {
  if (shuttingDown || slot.active) return;
  const task = queue.shift();
  if (!task) return;
  if (task.signal?.aborted) {
    cancelled += 1;
    settle(task, { error: abortError() });
    scheduleDrain();
    return;
  }
  const remainingMs = task.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    failed += 1;
    settle(task, { error: new Error(`Context build timed out after ${timeoutMs}ms while queued.`) });
    scheduleDrain();
    return;
  }
  slot.active = task;
  let aborted = false;
  const onActiveAbort = () => {
    aborted = true;
    slot.broker.forceKill();
  };
  if (task.signal) {
    if (task.abortListener) task.signal.removeEventListener('abort', task.abortListener);
    task.abortListener = onActiveAbort;
    task.signal.addEventListener('abort', onActiveAbort, { once: true });
  }
  try {
    const result = await slot.broker.run<ContextBuildResult>(
      'build_personality_context',
      task.payload,
      remainingMs,
    );
    if (aborted || task.signal?.aborted) {
      cancelled += 1;
      settle(task, { error: abortError() });
      await recycleSlot(slot);
    } else {
      slot.completedJobs += 1;
      completed += 1;
      settle(task, { value: result.context });
      if (slot.completedJobs >= recycleAfterJobs || Number(result.rssBytes || 0) >= recycleRssBytes) {
        await recycleSlot(slot);
      }
    }
  } catch (error: any) {
    const normalized = aborted || task.signal?.aborted
      ? abortError()
      : error instanceof Error ? error : new Error(String(error));
    if (normalized.name === 'AbortError') cancelled += 1;
    else failed += 1;
    lastError = normalized.message;
    settle(task, { error: normalized });
    await recycleSlot(slot);
  } finally {
    slot.active = null;
    scheduleDrain();
  }
}

function enqueue(task: Omit<ContextBuildTask, 'settled' | 'resolve' | 'reject'>): Promise<string> {
  if (shuttingDown) return Promise.reject(new Error('Context build worker pool is shutting down.'));
  if (task.signal?.aborted) return Promise.reject(abortError());
  if (queue.length >= maxQueued && slots.every((slot) => !!slot.active)) {
    return Promise.reject(new Error(`Context build worker queue is full (${maxQueued} queued maximum).`));
  }
  return new Promise<string>((resolve, reject) => {
    const queued: ContextBuildTask = { ...task, resolve, reject, settled: false };
    if (queued.signal) {
      const onQueuedAbort = () => {
        if (slots.some((slot) => slot.active === queued)) return;
        const index = queue.indexOf(queued);
        if (index >= 0) queue.splice(index, 1);
        cancelled += 1;
        settle(queued, { error: abortError() });
      };
      queued.abortListener = onQueuedAbort;
      queued.signal.addEventListener('abort', onQueuedAbort, { once: true });
    }
    queue.push(queued);
    scheduleDrain();
  });
}

async function guardedFallback(
  build: () => Promise<string>,
  originalError: Error,
): Promise<string> {
  if (!fallbackEnabled || fallbackActive >= 1) throw originalError;
  fallbackActive += 1;
  fallbacks += 1;
  console.warn(`[context-build] Worker isolation failed; using one-at-a-time in-process fallback: ${originalError.message}`);
  try {
    return await build();
  } finally {
    fallbackActive -= 1;
  }
}

export async function buildPersonalityContextIsolated(
  sessionId: string,
  workspacePath: string,
  messageText: string,
  executionMode: string,
  historyLength: number,
  skillsManager: SkillsManager,
  getSessionSkillWindowsFn: (sessionId: string) => Map<string, SkillWindow>,
  setCurrentTurn: (sessionId: string, turn: number) => void,
  extraCats?: Set<string>,
  options?: BuildPersonalityContextOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (!enabled) {
    return buildPersonalityContext(
      sessionId,
      workspacePath,
      messageText,
      executionMode,
      historyLength,
      skillsManager,
      getSessionSkillWindowsFn,
      setCurrentTurn,
      extraCats,
      options,
    );
  }
  const snapshot = await capturePersonalityContextSnapshot(
    sessionId,
    workspacePath,
    messageText,
    executionMode,
    historyLength,
    skillsManager,
    setCurrentTurn,
    extraCats,
    options,
  );
  if (signal?.aborted) {
    cancelled += 1;
    throw abortError();
  }
  const isolatedOptions = { ...(options || {}), serializedSnapshot: snapshot };
  const fallback = () => buildPersonalityContext(
    sessionId,
    workspacePath,
    messageText,
    executionMode,
    historyLength,
    skillsManager,
    getSessionSkillWindowsFn,
    setCurrentTurn,
    extraCats,
    isolatedOptions,
  );
  let context: string;
  try {
    context = await enqueue({
      sessionId,
      payload: {
        sessionId,
        workspacePath,
        messageText,
        executionMode,
        historyLength,
        extraCats: extraCats ? [...extraCats] : undefined,
        options: isolatedOptions,
      },
      signal,
      deadlineAt: Date.now() + timeoutMs,
    });
  } catch (error: any) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name === 'AbortError' || signal?.aborted) throw normalized;
    context = await guardedFallback(fallback, normalized);
  }
  await finalizePersonalityContextSnapshot(
    sessionId,
    workspacePath,
    historyLength,
    snapshot,
    setCurrentTurn,
  );
  return context;
}

export function getContextBuildWorkerPoolStatus(): ContextBuildWorkerPoolStatus {
  return {
    enabled,
    isolation: enabled ? 'child_process' : 'in_process',
    workers: slots.length,
    active: slots.filter((slot) => !!slot.active).length,
    queued: queue.length,
    maxQueued,
    shuttingDown,
    completed,
    failed,
    cancelled,
    fallbacks,
    fallbackActive,
    lastError: lastError || undefined,
    brokers: slots.map((slot) => slot.broker.getStatus()),
  };
}

export async function shutdownContextBuildWorkerPool(): Promise<void> {
  shuttingDown = true;
  const error = new Error('Context build worker pool is shutting down.');
  for (const task of queue.splice(0)) settle(task, { error });
  for (const slot of slots) {
    if (slot.active) {
      settle(slot.active, { error });
      slot.broker.forceKill();
    }
  }
  await Promise.all(slots.map((slot) => recycleSlot(slot)));
}
