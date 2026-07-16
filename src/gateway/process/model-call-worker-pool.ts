import { fork, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ModelStreamEvent } from '../../providers/LLMProvider.js';
import {
  DEFAULT_MODEL_CALL_MAX_MESSAGE_BYTES,
  MODEL_CALL_WORKER_PROTOCOL_VERSION,
  boundedModelCallError,
  isModelCallWorkerMessage,
  modelCallMessageBytes,
  type ModelCallStreamItem,
  type ModelCallWorkerChildMessage,
  type ModelCallWorkerParentMessage,
  type ModelCallWorkerRequest,
  type ModelCallWorkerResult,
} from './model-call-worker-protocol.js';

export interface ModelCallCallbacks {
  onToken?: (value: string) => void;
  onThinking?: (value: string) => void;
  onReasoningSummary?: (value: string) => void;
  onModelEvent?: (value: ModelStreamEvent) => void;
  signal?: AbortSignal;
}

export class ModelCallWorkerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly safeToFallback: boolean,
    readonly providerStarted: boolean,
  ) {
    super(message);
    this.name = 'ModelCallWorkerError';
  }
}

const AMBIGUOUS_MODEL_CALL_ERROR_CODES = new Set([
  'MODEL_CALL_TIMEOUT',
  'WORKER_HEARTBEAT_TIMEOUT',
  'WORKER_EXITED',
  'IPC_RESULT_TOO_LARGE',
  'IPC_NOT_CONNECTED',
]);

/**
 * Definite provider errors retain the callers' established retry policy.
 * Transport loss, timeout, crash, and cancellation are surfaced immediately
 * because the provider may already have completed a billable request.
 */
export function shouldSuppressModelCallRetry(error: unknown): boolean {
  if ((error as any)?.name === 'AbortError') return true;
  return error instanceof ModelCallWorkerError
    && AMBIGUOUS_MODEL_CALL_ERROR_CODES.has(error.code);
}

type SlotState = 'stopped' | 'starting' | 'ready' | 'busy' | 'stopping' | 'failed';

interface Task {
  id: string;
  request: ModelCallWorkerRequest;
  callbacks: ModelCallCallbacks;
  timeoutMs: number;
  deadlineAt: number;
  enqueuedAt: number;
  resolve: (result: ModelCallWorkerResult) => void;
  reject: (error: Error) => void;
  settled: boolean;
  dispatched: boolean;
  providerStarted: boolean;
  callbackError?: Error;
  timer?: NodeJS.Timeout;
  cancelTimer?: NodeJS.Timeout;
  abortListener?: () => void;
}

interface WorkerSlot {
  id: number;
  state: SlotState;
  child: ChildProcess | null;
  task: Task | null;
  completedJobs: number;
  rssBytes: number;
  lastHeartbeatAt: number;
  lastError?: string;
  lastStderrTail?: string;
  startupTimer?: NodeJS.Timeout;
}

export interface ModelCallWorkerPoolStatus {
  enabled: boolean;
  isolation: 'child_process' | 'in_process';
  workers: number;
  active: number;
  ready: number;
  starting: number;
  queued: number;
  maxQueued: number;
  completed: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  crashed: number;
  recycled: number;
  fallbacks: number;
  providerStarted: number;
  eventBatches: number;
  streamEvents: number;
  shuttingDown: boolean;
  lastError?: string;
  slots: Array<{
    id: number;
    state: SlotState;
    pid?: number;
    requestId?: string;
    completedJobs: number;
    rssBytes: number;
    lastHeartbeatAt?: number;
    lastError?: string;
    lastStderrTail?: string;
  }>;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function resolveWorkerEntry(): string {
  const candidates = [
    path.join(__dirname, 'model-call-worker.js'),
    path.join(__dirname, 'model-call-worker.ts'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Model-call worker entry not found: ${candidates.join(' or ')}`);
  return found;
}

function abortError(reason?: unknown): Error {
  const error = reason instanceof Error ? reason : new Error(String(reason || 'Model call cancelled.'));
  error.name = 'AbortError';
  return error;
}

const enabled = String(process.env.PROMETHEUS_MODEL_CALL_WORKERS || '1').trim() !== '0';
const workerCount = envInt('PROMETHEUS_MODEL_WORKER_COUNT', 3, 1, 4);
const maxQueued = envInt('PROMETHEUS_MODEL_WORKER_MAX_QUEUE', 12, 0, 100);
const defaultTimeoutMs = envInt('PROMETHEUS_MODEL_WORKER_TIMEOUT_MS', 15 * 60_000, 1_000, 60 * 60_000);
const startupTimeoutMs = envInt('PROMETHEUS_MODEL_WORKER_STARTUP_TIMEOUT_MS', 20_000, 1_000, 120_000);
const cancelGraceMs = envInt('PROMETHEUS_MODEL_WORKER_CANCEL_GRACE_MS', 5_000, 100, 30_000);
const heartbeatTimeoutMs = envInt('PROMETHEUS_MODEL_WORKER_HEARTBEAT_TIMEOUT_MS', 30_000, 5_000, 120_000);
const maxMessageBytes = envInt(
  'PROMETHEUS_MODEL_WORKER_MAX_MESSAGE_BYTES',
  DEFAULT_MODEL_CALL_MAX_MESSAGE_BYTES,
  64 * 1024,
  64 * 1024 * 1024,
);
const recycleAfterJobs = envInt('PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS', 20, 1, 10_000);
const recycleRssBytes = envInt(
  'PROMETHEUS_MODEL_WORKER_RECYCLE_RSS_BYTES',
  1024 * 1024 * 1024,
  128 * 1024 * 1024,
  2_147_483_647,
);

const queue: Task[] = [];
const slots: WorkerSlot[] = Array.from({ length: workerCount }, (_, index) => ({
  id: index + 1,
  state: 'stopped',
  child: null,
  task: null,
  completedJobs: 0,
  rssBytes: 0,
  lastHeartbeatAt: 0,
}));
let shuttingDown = false;
let drainScheduled = false;
let completed = 0;
let failed = 0;
let cancelled = 0;
let timedOut = 0;
let crashed = 0;
let recycled = 0;
let fallbacks = 0;
let providerStartedCount = 0;
let eventBatches = 0;
let streamEvents = 0;
let lastError = '';

function cleanupTask(task: Task): void {
  if (task.timer) clearTimeout(task.timer);
  if (task.cancelTimer) clearTimeout(task.cancelTimer);
  if (task.callbacks.signal && task.abortListener) {
    task.callbacks.signal.removeEventListener('abort', task.abortListener);
  }
}

function settle(task: Task, value: { result: ModelCallWorkerResult } | { error: Error }): void {
  if (task.settled) return;
  task.settled = true;
  cleanupTask(task);
  if ('result' in value) task.resolve(value.result);
  else task.reject(value.error);
}

function send(slot: WorkerSlot, message: ModelCallWorkerParentMessage): void {
  const bytes = modelCallMessageBytes(message);
  if (bytes > maxMessageBytes) {
    throw new ModelCallWorkerError(
      `Model worker IPC request exceeded ${maxMessageBytes} bytes (${bytes}).`,
      'IPC_REQUEST_TOO_LARGE',
      true,
      false,
    );
  }
  if (!slot.child?.connected) {
    throw new ModelCallWorkerError('Model worker IPC channel is not connected.', 'IPC_NOT_CONNECTED', true, false);
  }
  slot.child.send(message);
}

function handleEvents(task: Task, events: ModelCallStreamItem[]): void {
  if (task.settled) return;
  for (const event of events) {
    if (task.callbackError) return;
    try {
      if (event.kind === 'token') task.callbacks.onToken?.(event.value);
      else if (event.kind === 'thinking') task.callbacks.onThinking?.(event.value);
      else if (event.kind === 'reasoning_summary') task.callbacks.onReasoningSummary?.(event.value);
      else task.callbacks.onModelEvent?.(event.value);
    } catch (error: any) {
      task.callbackError = error instanceof Error ? error : new Error(String(error));
    }
  }
}

function finishSlotTask(slot: WorkerSlot): void {
  slot.task = null;
  slot.state = slot.child?.connected ? 'ready' : 'failed';
  scheduleDrain();
}

function handleMessage(slot: WorkerSlot, raw: unknown): void {
  const bytes = modelCallMessageBytes(raw);
  if (bytes > maxMessageBytes) {
    failActiveAndKill(slot, new ModelCallWorkerError(
      `Model worker emitted an oversized IPC message (${bytes} bytes).`,
      'IPC_RESULT_TOO_LARGE',
      false,
      Boolean(slot.task?.providerStarted),
    ));
    return;
  }
  if (!isModelCallWorkerMessage(raw)) return;
  const message = raw as ModelCallWorkerChildMessage;
  if (message.type === 'ready') {
    if (slot.startupTimer) clearTimeout(slot.startupTimer);
    slot.startupTimer = undefined;
    slot.state = 'ready';
    slot.lastHeartbeatAt = Date.now();
    slot.lastError = undefined;
    scheduleDrain();
    return;
  }
  if (message.type === 'heartbeat') {
    slot.lastHeartbeatAt = message.at;
    slot.rssBytes = message.rssBytes;
    return;
  }
  const task = slot.task;
  if (!task || ('requestId' in message && message.requestId !== task.id)) return;
  if (message.type === 'started') {
    slot.lastHeartbeatAt = message.at;
    return;
  }
  if (message.type === 'provider_started') {
    task.providerStarted = true;
    providerStartedCount += 1;
    return;
  }
  if (message.type === 'events') {
    if (task.settled) return;
    eventBatches += 1;
    streamEvents += message.events.length;
    handleEvents(task, message.events);
    if (task.callbackError) cancelActive(slot, task, 'Stream callback failed.');
    return;
  }
  if (task.settled && (message.type === 'result' || message.type === 'error')) {
    finishSlotTask(slot);
    return;
  }
  if (message.type === 'result') {
    slot.completedJobs += 1;
    slot.rssBytes = message.rssBytes;
    if (task.callbackError) {
      failed += 1;
      settle(task, { error: task.callbackError });
    } else {
      completed += 1;
      settle(task, { result: message.result });
    }
    const shouldRecycle = slot.completedJobs >= recycleAfterJobs || slot.rssBytes >= recycleRssBytes;
    finishSlotTask(slot);
    if (shouldRecycle) void recycleSlot(slot);
    return;
  }
  if (message.type === 'error') {
    const wasCancelled = message.code === 'MODEL_CALL_CANCELLED' || task.callbacks.signal?.aborted;
    if (wasCancelled) cancelled += 1;
    else failed += 1;
    const error = wasCancelled
      ? abortError(task.callbacks.signal?.reason || message.message)
      : new ModelCallWorkerError(
          boundedModelCallError(message.message),
          message.code,
          !task.dispatched && !message.providerStarted,
          Boolean(message.providerStarted || task.providerStarted),
        );
    lastError = error.message;
    slot.lastError = error.message;
    settle(task, { error });
    finishSlotTask(slot);
  }
}

function handleExit(slot: WorkerSlot, child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
  if (slot.child !== child) return;
  if (slot.startupTimer) clearTimeout(slot.startupTimer);
  slot.startupTimer = undefined;
  const wasStopping = slot.state === 'stopping';
  const task = slot.task;
  slot.child = null;
  slot.state = wasStopping ? 'stopped' : 'failed';
  if (task && !task.settled) {
    crashed += 1;
    failed += 1;
    const error = new ModelCallWorkerError(
      `Model worker exited (${signal || (code ?? 'unknown')}).`,
      'WORKER_EXITED',
      !task.dispatched,
      task.providerStarted,
    );
    lastError = error.message;
    slot.lastError = error.message;
    settle(task, { error });
  }
  slot.task = null;
  if (!shuttingDown) scheduleDrain();
}

function spawnSlot(slot: WorkerSlot): void {
  if (shuttingDown || slot.child || slot.state === 'starting') return;
  slot.state = 'starting';
  let entry: string;
  try {
    entry = resolveWorkerEntry();
  } catch (error: any) {
    slot.state = 'failed';
    slot.lastError = boundedModelCallError(error);
    rejectOneQueuedStartup(slot.lastError);
    return;
  }
  try {
    const child = fork(entry, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROMETHEUS_RUNTIME_WORKER: '1',
        PROMETHEUS_MODEL_WORKER_SLOT: String(slot.id),
      },
      execArgv: process.execArgv,
      serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    slot.child = child;
    child.stdout?.resume();
    child.stderr?.on('data', (chunk) => {
      slot.lastStderrTail = `${slot.lastStderrTail || ''}${String(chunk || '')}`.slice(-2_000);
    });
    child.on('message', (message) => handleMessage(slot, message));
    child.once('error', (error) => {
      slot.lastError = boundedModelCallError(error);
      try { child.kill(); } catch {}
    });
    child.once('exit', (code, signal) => handleExit(slot, child, code, signal));
    slot.startupTimer = setTimeout(() => {
      slot.lastError = `Model worker did not become ready within ${startupTimeoutMs}ms.`;
      rejectOneQueuedStartup(slot.lastError);
      try { child.kill(); } catch {}
    }, startupTimeoutMs);
    slot.startupTimer.unref?.();
  } catch (error: any) {
    slot.child = null;
    slot.state = 'failed';
    slot.lastError = boundedModelCallError(error);
    rejectOneQueuedStartup(slot.lastError);
  }
}

function rejectOneQueuedStartup(message: string): void {
  const task = queue.shift();
  if (!task) return;
  settle(task, {
    error: new ModelCallWorkerError(message, 'WORKER_STARTUP_FAILED', true, false),
  });
}

function cancelActive(slot: WorkerSlot, task: Task, reason: string): void {
  if (slot.task !== task) return;
  try {
    send(slot, {
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'cancel',
      requestId: task.id,
      reason,
    });
  } catch {}
  if (!task.cancelTimer) {
    task.cancelTimer = setTimeout(() => {
      if (slot.task === task) {
        try { slot.child?.kill(); } catch {}
      }
    }, cancelGraceMs);
    task.cancelTimer.unref?.();
  }
}

function failActiveAndKill(slot: WorkerSlot, error: Error): void {
  if (slot.task && !slot.task.settled) {
    failed += 1;
    settle(slot.task, { error });
  }
  try { slot.child?.kill(); } catch {}
}

function runTask(slot: WorkerSlot, task: Task): void {
  if (task.callbacks.signal?.aborted) {
    cancelled += 1;
    settle(task, { error: abortError(task.callbacks.signal.reason) });
    scheduleDrain();
    return;
  }
  slot.task = task;
  slot.state = 'busy';
  task.dispatched = true;
  if (task.timer) clearTimeout(task.timer);
  const remainingMs = Math.max(1, task.deadlineAt - Date.now());
  task.timer = setTimeout(() => {
    if (task.settled) return;
    timedOut += 1;
    failed += 1;
    const error = new ModelCallWorkerError(
      `Model call timed out after ${task.timeoutMs}ms.`,
      'MODEL_CALL_TIMEOUT',
      false,
      task.providerStarted,
    );
    settle(task, { error });
    cancelActive(slot, task, error.message);
  }, remainingMs);
  task.timer.unref?.();
  try {
    send(slot, {
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'run',
      requestId: task.id,
      request: task.request,
    });
  } catch (error: any) {
    task.dispatched = false;
    failed += 1;
    settle(task, {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    finishSlotTask(slot);
  }
}

function scheduleDrain(): void {
  if (drainScheduled || shuttingDown) return;
  drainScheduled = true;
  setImmediate(() => {
    drainScheduled = false;
    for (const slot of slots) {
      if (!queue.length) break;
      if (slot.state === 'ready' && slot.child?.connected && !slot.task) {
        const task = queue.shift();
        if (task) runTask(slot, task);
      } else if (!slot.child && slot.state !== 'starting') {
        spawnSlot(slot);
      }
    }
    if (queue.length && slots.every((slot) => slot.state === 'failed' && !slot.child)) {
      for (const slot of slots) spawnSlot(slot);
    }
  });
}

async function recycleSlot(slot: WorkerSlot): Promise<void> {
  if (slot.task || !slot.child) return;
  recycled += 1;
  slot.state = 'stopping';
  const child = slot.child;
  try {
    if (child.connected) child.send({
      protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
      type: 'shutdown',
      reason: 'worker_recycle',
    } satisfies ModelCallWorkerParentMessage);
  } catch {}
  setTimeout(() => {
    if (slot.child === child) {
      try { child.kill(); } catch {}
    }
  }, 1_000).unref?.();
}

export function areModelCallWorkersEnabled(): boolean {
  return enabled;
}

export async function dispatchModelCallWorker(
  request: ModelCallWorkerRequest,
  callbacks: ModelCallCallbacks = {},
  timeoutMs = defaultTimeoutMs,
): Promise<ModelCallWorkerResult> {
  if (!enabled) {
    throw new ModelCallWorkerError('Model-call workers are disabled.', 'WORKERS_DISABLED', true, false);
  }
  if (shuttingDown) {
    throw new ModelCallWorkerError('Model-call worker pool is shutting down.', 'WORKERS_SHUTTING_DOWN', true, false);
  }
  const probe = {
    protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
    type: 'run',
    requestId: 'size_probe',
    request,
  } satisfies ModelCallWorkerParentMessage;
  const bytes = modelCallMessageBytes(probe);
  if (bytes > maxMessageBytes) {
    throw new ModelCallWorkerError(
      `Model call request is too large for bounded IPC (${bytes} bytes; max ${maxMessageBytes}).`,
      'IPC_REQUEST_TOO_LARGE',
      true,
      false,
    );
  }
  const immediatelyAvailable = slots.some((slot) => slot.state === 'ready' && !slot.task);
  if (!immediatelyAvailable && queue.length >= maxQueued) {
    throw new ModelCallWorkerError(
      `Model-call worker queue is full (${maxQueued} queued maximum).`,
      'WORKER_QUEUE_FULL',
      true,
      false,
    );
  }
  return new Promise<ModelCallWorkerResult>((resolve, reject) => {
    const task: Task = {
      id: `model_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      request,
      callbacks,
      timeoutMs: Math.max(1_000, Math.min(60 * 60_000, Number(timeoutMs || defaultTimeoutMs))),
      deadlineAt: 0,
      enqueuedAt: Date.now(),
      resolve,
      reject,
      settled: false,
      dispatched: false,
      providerStarted: false,
    };
    task.deadlineAt = Date.now() + task.timeoutMs;
    task.timer = setTimeout(() => {
      const queuedIndex = queue.indexOf(task);
      if (queuedIndex < 0 || task.settled) return;
      queue.splice(queuedIndex, 1);
      timedOut += 1;
      settle(task, {
        error: new ModelCallWorkerError(
          `Model call timed out after ${task.timeoutMs}ms while queued.`,
          'MODEL_CALL_QUEUE_TIMEOUT',
          true,
          false,
        ),
      });
    }, task.timeoutMs);
    task.timer.unref?.();
    if (callbacks.signal) {
      const onAbort = () => {
        const queuedIndex = queue.indexOf(task);
        if (queuedIndex >= 0) {
          queue.splice(queuedIndex, 1);
          cancelled += 1;
          settle(task, { error: abortError(callbacks.signal?.reason) });
          return;
        }
        const slot = slots.find((candidate) => candidate.task === task);
        if (slot) {
          cancelled += 1;
          settle(task, { error: abortError(callbacks.signal?.reason) });
          cancelActive(slot, task, String(callbacks.signal?.reason || 'Model call cancelled.'));
        }
      };
      task.abortListener = onAbort;
      if (callbacks.signal.aborted) {
        onAbort();
        return;
      }
      callbacks.signal.addEventListener('abort', onAbort, { once: true });
    }
    queue.push(task);
    scheduleDrain();
  });
}

export function getModelCallWorkerPoolStatus(): ModelCallWorkerPoolStatus {
  return {
    enabled,
    isolation: enabled ? 'child_process' : 'in_process',
    workers: slots.length,
    active: slots.filter((slot) => slot.state === 'busy').length,
    ready: slots.filter((slot) => slot.state === 'ready').length,
    starting: slots.filter((slot) => slot.state === 'starting').length,
    queued: queue.length,
    maxQueued,
    completed,
    failed,
    cancelled,
    timedOut,
    crashed,
    recycled,
    fallbacks,
    providerStarted: providerStartedCount,
    eventBatches,
    streamEvents,
    shuttingDown,
    lastError: lastError || undefined,
    slots: slots.map((slot) => ({
      id: slot.id,
      state: slot.state,
      pid: slot.child?.pid,
      requestId: slot.task?.id,
      completedJobs: slot.completedJobs,
      rssBytes: slot.rssBytes,
      lastHeartbeatAt: slot.lastHeartbeatAt || undefined,
      lastError: slot.lastError,
      lastStderrTail: slot.lastStderrTail,
    })),
  };
}

export function noteModelCallWorkerFallback(message?: string): void {
  fallbacks += 1;
  if (message) lastError = boundedModelCallError(message);
}

export async function shutdownModelCallWorkerPool(): Promise<void> {
  shuttingDown = true;
  clearInterval(heartbeatWatchdog);
  const error = new Error('Model-call worker pool is shutting down.');
  for (const task of queue.splice(0)) settle(task, { error });
  await Promise.all(slots.map(async (slot) => {
    const child = slot.child;
    if (!child) return;
    slot.state = 'stopping';
    if (slot.task && !slot.task.settled) {
      settle(slot.task, { error });
      cancelActive(slot, slot.task, error.message);
    }
    try {
      if (child.connected) child.send({
        protocolVersion: MODEL_CALL_WORKER_PROTOCOL_VERSION,
        type: 'shutdown',
        reason: 'gateway_shutdown',
      } satisfies ModelCallWorkerParentMessage);
    } catch {}
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once('exit', finish);
      setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, 2_000).unref?.();
    });
  }));
}

const heartbeatWatchdog = setInterval(() => {
  if (shuttingDown) return;
  const now = Date.now();
  for (const slot of slots) {
    if (!slot.child || slot.state !== 'busy' || !slot.lastHeartbeatAt) continue;
    if (now - slot.lastHeartbeatAt <= heartbeatTimeoutMs) continue;
    const task = slot.task;
    const error = new ModelCallWorkerError(
      `Model worker heartbeat was stale for more than ${heartbeatTimeoutMs}ms.`,
      'WORKER_HEARTBEAT_TIMEOUT',
      false,
      Boolean(task?.providerStarted),
    );
    lastError = error.message;
    slot.lastError = error.message;
    if (task && !task.settled) {
      failed += 1;
      settle(task, { error });
    }
    try { slot.child.kill(); } catch {}
  }
}, Math.max(1_000, Math.floor(heartbeatTimeoutMs / 3)));
heartbeatWatchdog.unref?.();
