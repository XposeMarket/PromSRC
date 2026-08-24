import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import {
  buildPersonalityContext,
  capturePersonalityContextSnapshot,
  finalizePersonalityContextSnapshot,
  type BuildPersonalityContextOptions,
  type PersonalityContextSnapshot,
  type SkillWindow,
} from '../prompt-context.js';
import { buildHybridMemoryAtomReferenceContext } from '../memory-index/memory-atoms-hybrid.js';
import type { SkillsManager } from '../skills-runtime/skills-manager.js';
import type { TurnTimingRecorder } from './turn-timing.js';

interface ContextBuildResult {
  context: string;
  rssBytes: number;
}

interface ContextBuildTask {
  sessionId: string;
  queuedAt: number;
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
  timing?: TurnTimingRecorder;
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
  warmupState: 'idle' | 'warming' | 'ready' | 'failed';
  warmWorkers: number;
  warmupStartedAt?: number;
  warmupCompletedAt?: number;
  warmupError?: string;
  brokers: RuntimeWorkerBrokerStatus[];
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

const enabled = String(process.env.PROMETHEUS_CONTEXT_BUILD_WORKERS || '1').trim() !== '0';
const fallbackEnabled = String(process.env.PROMETHEUS_CONTEXT_BUILD_IN_PROCESS_FALLBACK || '1').trim() !== '0';
const workerCount = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_COUNT', 2, 1, 4);
const warmWorkerCount = envInt('PROMETHEUS_CONTEXT_BUILD_WARM_WORKER_COUNT', 1, 0, workerCount);
const maxQueued = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_MAX_QUEUE', 4, 0, 32);
const timeoutMs = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_TIMEOUT_MS', 15_000, 1_000, 120_000);
const startupTimeoutMs = envInt('PROMETHEUS_CONTEXT_BUILD_WORKER_STARTUP_TIMEOUT_MS', 15_000, 1_000, 120_000);
const maxMessageBytes = envInt('PROMETHEUS_CONTEXT_BUILD_MAX_MESSAGE_BYTES', 2 * 1024 * 1024, 64 * 1024, 8 * 1024 * 1024);
const recycleAfterJobs = envInt('PROMETHEUS_CONTEXT_BUILD_RECYCLE_JOBS', 100, 1, 10_000);
const recycleRssBytes = envInt('PROMETHEUS_CONTEXT_BUILD_RECYCLE_RSS_BYTES', 768 * 1024 * 1024, 128 * 1024 * 1024, 2_147_483_647);
const maxHeapUsedBytes = envInt('PROMETHEUS_CONTEXT_BUILD_MAX_HEAP_USED_BYTES', 0, 0, 8 * 1024 * 1024 * 1024);

const slots: WorkerSlot[] = Array.from({ length: workerCount }, (_, index) => ({
  broker: new RuntimeWorkerBroker({
    name: `context-build-${index + 1}`,
    entryBasename: 'context-build-worker',
    maxMessageBytes,
    startupTimeoutMs,
    defaultJobTimeoutMs: timeoutMs,
    maxJobs: recycleAfterJobs,
    maxRssBytes: recycleRssBytes,
    maxHeapUsedBytes,
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
let warmupPromise: Promise<void> | null = null;
let warmupState: ContextBuildWorkerPoolStatus['warmupState'] = 'idle';
let warmupStartedAt: number | undefined;
let warmupCompletedAt: number | undefined;
let warmupError = '';

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
  const claimedAt = Date.now();
  task.timing?.mark('context_worker_queue_wait_done', {
    durationMs: Math.max(0, claimedAt - task.queuedAt),
  });
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
  const startupWaitStartedAt = Date.now();
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
    task.timing?.mark('context_worker_ready_wait_start', {
      worker: slot.broker.getStatus().name,
      state: slot.broker.getStatus().state,
    });
    await slot.broker.warmup();
    task.timing?.mark('context_worker_ready_wait_done', {
      worker: slot.broker.getStatus().name,
      durationMs: Date.now() - startupWaitStartedAt,
    });
    const executionStartedAt = Date.now();
    task.timing?.mark('context_worker_execution_start', {
      worker: slot.broker.getStatus().name,
      queueWaitMs: Math.max(0, claimedAt - task.queuedAt),
    });
    const result = await slot.broker.run<ContextBuildResult>(
      'build_personality_context',
      task.payload,
      remainingMs,
    );
    task.timing?.mark('context_worker_execution_done', {
      worker: slot.broker.getStatus().name,
      durationMs: Date.now() - executionStartedAt,
    });
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
    task.timing?.mark('context_worker_execution_failed', {
      worker: slot.broker.getStatus().name,
      error: String(error?.message || error).slice(0, 240),
    });
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

function enqueue(task: Omit<ContextBuildTask, 'settled' | 'resolve' | 'reject' | 'queuedAt'>): Promise<string> {
  if (shuttingDown) return Promise.reject(new Error('Context build worker pool is shutting down.'));
  if (task.signal?.aborted) return Promise.reject(abortError());
  if (queue.length >= maxQueued && slots.every((slot) => !!slot.active)) {
    return Promise.reject(new Error(`Context build worker queue is full (${maxQueued} queued maximum).`));
  }
  return new Promise<string>((resolve, reject) => {
    const queued: ContextBuildTask = { ...task, queuedAt: Date.now(), resolve, reject, settled: false };
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

function shouldUseHybridAtomicMemory(
  snapshot: PersonalityContextSnapshot,
  sessionId: string,
  executionMode: string,
  profile: BuildPersonalityContextOptions['profile'],
  messageText: string,
): boolean {
  if (profile === 'local_llm' || profile === 'direct_subagent' || profile === 'teach_mode') return false;
  if (executionMode === 'proposal_execution' || /^(?:brain_|auto_brain_)/i.test(String(sessionId || ''))) return false;
  if (snapshot.runtimeActor?.kind === 'agent' || snapshot.runtimeActor?.kind === 'manager') return false;
  const normalized = String(messageText || '').replace(/[^a-z0-9!?\s']/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (/^(?:hi|hey|hello|yo|sup)(?:\s+prometheus)?[!?.,\s]*$/i.test(normalized)) return false;
  if (/^(?:thanks(?:\s+(?:so much|a lot))?|thank you(?:\s+(?:so much|very much))?|thx|ty|ok(?:ay)?|got it|sounds good|great|perfect|nice|cool|alright|all right)[!?.,\s]*$/i.test(normalized)) return false;
  return true;
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
  timing?: TurnTimingRecorder,
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
      signal,
    );
  }
  const snapshotStartedAt = Date.now();
  timing?.mark('personality_snapshot_capture_start');
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
    signal,
    (fields) => timing?.mark('automatic_memory_search', fields),
  );
  if (shouldUseHybridAtomicMemory(snapshot, sessionId, executionMode, options?.profile || 'default', messageText)) {
    const memoryStartedAt = Date.now();
    timing?.mark('atomic_memory_hybrid_start');
    try {
      snapshot.memoryAtomContext = await buildHybridMemoryAtomReferenceContext(
        workspacePath,
        messageText,
        {
          additionalContext: snapshot.projectContextBlock,
          maxAtoms: options?.profile === 'voice_agent' ? 4 : 6,
          maxChars: options?.profile === 'voice_agent' ? 4_500 : 14_000,
        },
      );
      timing?.mark('atomic_memory_hybrid_done', {
        durationMs: Date.now() - memoryStartedAt,
        injected: Boolean(snapshot.memoryAtomContext),
      });
    } catch (error: any) {
      // The snapshot already contains the synchronous deterministic atom result,
      // so semantic retrieval is strictly additive: failure leaves the safe
      // preexisting fallback intact.
      timing?.mark('atomic_memory_hybrid_failed', {
        durationMs: Date.now() - memoryStartedAt,
        error: String(error?.message || error).slice(0, 200),
      });
    }
  }
  timing?.mark('personality_snapshot_capture_done', { durationMs: Date.now() - snapshotStartedAt });
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
    signal,
  );
  let context: string;
  try {
    timing?.mark('context_worker_queue_wait_start');
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
      timing,
    });
  } catch (error: any) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name === 'AbortError' || signal?.aborted) throw normalized;
    context = await guardedFallback(fallback, normalized);
  }
  const finalizationStartedAt = Date.now();
  timing?.mark('personality_snapshot_finalize_start');
  await finalizePersonalityContextSnapshot(
    sessionId,
    workspacePath,
    historyLength,
    snapshot,
    setCurrentTurn,
  );
  timing?.mark('personality_snapshot_finalize_done', { durationMs: Date.now() - finalizationStartedAt });
  return context;
}

/** Prestart the bounded worker pool without capturing any user/session context. */
export async function warmContextBuildWorkerPool(): Promise<void> {
  if (!enabled || shuttingDown) return;
  if (warmupPromise) return warmupPromise;
  warmupState = 'warming';
  warmupStartedAt = Date.now();
  warmupError = '';
  warmupPromise = Promise.all(slots.slice(0, warmWorkerCount).map((slot) => slot.broker.warmup()))
    .then(() => {
      warmupState = 'ready';
      warmupCompletedAt = Date.now();
    })
    .catch((error: any) => {
      warmupState = 'failed';
      warmupCompletedAt = Date.now();
      warmupError = String(error?.message || error);
      warmupPromise = null;
      throw error;
    });
  return warmupPromise;
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
    warmupState,
    warmWorkers: warmWorkerCount,
    warmupStartedAt,
    warmupCompletedAt,
    warmupError: warmupError || undefined,
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
  warmupPromise = null;
  if (warmupState !== 'failed') warmupState = 'idle';
}
