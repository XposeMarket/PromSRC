import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { boundTurnDeliveryFrame, boundTurnDeliveryFrameAsync, jsonUtf8Bytes } from '../turn-delivery/bounded-payload.js';
import {
  createTurnDeliveryReferenceAsync,
  getTurnJobBlobStore,
  reuseExistingTurnDeliveryReference,
} from './blob-runtime.js';
import { getTurnJobStore } from './runtime.js';
import { TurnJobLeaseLostError } from './store.js';
import type {
  BeginToolEffectResult,
  JsonObject,
  JsonValue,
  ToolEffectRecord,
  ToolEffectReplayPolicy,
  TurnDeliveryInput,
  TurnJob,
  TurnJobKind,
} from './types.js';

const TURN_LEASE_MS = 45_000;
const TURN_HEARTBEAT_MS = 10_000;
const INLINE_EVENT_BYTES = 12 * 1024;

export interface BeginDurableTurnInput {
  sessionId: string;
  kind: TurnJobKind;
  payload: JsonValue;
  requestFingerprint?: string;
  clientRequestId?: string | null;
  taskId?: string | null;
  goalId?: string | null;
  goalTurnId?: string | null;
  actorContext?: JsonObject | null;
  priority?: number;
  maxAttempts?: number;
}

export interface DurableTurnExecution {
  readonly jobId: string;
  readonly sessionId: string;
  readonly kind: TurnJobKind;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly leaseOwner: string;
  readonly payloadRef: string;
  nextToolSequence: number;
  nextModelSequence: number;
  heartbeatTimer: NodeJS.Timeout | null;
  readonly fenceController: AbortController;
  readonly signal: AbortSignal;
  fencedAt: number | null;
  fenceReason: string | null;
  fenceError: DurableTurnFenceError | null;
  finalRef: string | null;
  /** Materialized bounded final waiting for the authoritative session flush. */
  preparedFinalRef?: string;
  /** Already-bounded terminal payload safe for synchronous SSE/replay hooks. */
  boundedFinalResult?: JsonValue;
  settled: boolean;
  replayed: boolean;
  replayedResult?: JsonValue;
}

export class DurableTurnFenceError extends Error {
  readonly code = 'TURN_LEASE_FENCED';
  readonly jobId: string;

  constructor(jobId: string, reason: string, options: { cause?: unknown } = {}) {
    super(`Durable turn ${jobId} was fenced: ${reason}`, options);
    this.name = 'DurableTurnFenceError';
    this.jobId = jobId;
  }
}

export function isDurableTurnFenceError(error: unknown): error is DurableTurnFenceError {
  return error instanceof DurableTurnFenceError
    || (error instanceof Error && (error as any).code === 'TURN_LEASE_FENCED');
}

function createFenceState(): Pick<DurableTurnExecution,
  'fenceController' | 'signal' | 'fencedAt' | 'fenceReason' | 'fenceError'> {
  const fenceController = new AbortController();
  return {
    fenceController,
    signal: fenceController.signal,
    fencedAt: null,
    fenceReason: null,
    fenceError: null,
  };
}

const storage = new AsyncLocalStorage<DurableTurnExecution>();

function canonicalJson(value: JsonValue): string {
  const visit = (current: JsonValue): string => {
    if (current === null || typeof current !== 'object') return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(visit).join(',')}]`;
    return `{${Object.keys(current).sort().map((key) => `${JSON.stringify(key)}:${visit(current[key])}`).join(',')}}`;
  };
  return visit(value);
}

export function toTurnJsonValue(value: unknown): JsonValue {
  const active = new WeakSet<object>();
  const visit = (current: unknown, inArray = false): JsonValue | undefined => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function' || typeof current === 'symbol' || current === undefined) {
      return inArray ? null : undefined;
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        ...(current.stack ? { stack: current.stack } : {}),
      };
    }
    if (Buffer.isBuffer(current)) return { type: 'Buffer', bytes: current.byteLength };
    if (current instanceof Date) return current.toJSON();
    if (!current || typeof current !== 'object') return String(current ?? '');
    if (active.has(current)) return { $prometheus: 'cycle_omitted' };
    active.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((entry) => visit(entry, true) ?? null);
      }
      const output: JsonObject = {};
      for (const key of Object.keys(current)) {
        const normalized = visit((current as Record<string, unknown>)[key], false);
        if (normalized !== undefined) output[key] = normalized;
      }
      return output;
    } finally {
      active.delete(current);
    }
  };
  return visit(value, true) ?? null;
}

/** JSON-normalize a potentially large provider request without starving I/O. */
export async function toTurnJsonValueAsync(value: unknown): Promise<JsonValue> {
  const active = new WeakSet<object>();
  let budget = 0;
  const yieldIfNeeded = async (cost = 1): Promise<void> => {
    budget += Math.max(1, cost);
    if (budget < 256 * 1024) return;
    budget = 0;
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const visit = async (current: unknown, inArray = false): Promise<JsonValue | undefined> => {
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      // String.length is O(1). Buffer.byteLength() scans the entire string and
      // would recreate the large single-value pause this cooperative path is
      // intended to avoid; the estimate only controls yield frequency.
      await yieldIfNeeded(Math.max(1, current.length * 2));
      return current;
    }
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function' || typeof current === 'symbol' || current === undefined) {
      return inArray ? null : undefined;
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        ...(current.stack ? { stack: current.stack } : {}),
      };
    }
    if (Buffer.isBuffer(current)) return { type: 'Buffer', bytes: current.byteLength };
    if (current instanceof Date) return current.toJSON();
    if (!current || typeof current !== 'object') return String(current ?? '');
    if (active.has(current)) return { $prometheus: 'cycle_omitted' };
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const output: JsonValue[] = [];
        for (const entry of current) output.push((await visit(entry, true)) ?? null);
        await yieldIfNeeded(output.length);
        return output;
      }
      const output: JsonObject = {};
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        const normalized = await visit((current as Record<string, unknown>)[key], false);
        if (normalized !== undefined) output[key] = normalized;
        await yieldIfNeeded(key.length + 1);
      }
      return output;
    } finally {
      active.delete(current);
    }
  };
  return (await visit(value, true)) ?? null;
}

export async function hashTurnJsonValueCanonicalAsync(value: JsonValue): Promise<string> {
  const hash = crypto.createHash('sha256');
  const seen = new Set<object>();
  let budget = 0;
  const write = async (piece: string): Promise<void> => {
    hash.update(piece, 'utf8');
    budget += Math.max(1, piece.length * 2);
    if (budget >= 256 * 1024) {
      budget = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const writeString = async (text: string): Promise<void> => {
    await write('"');
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 32 * 1024);
      if (
        end < text.length
        && end > start
        && text.charCodeAt(end - 1) >= 0xd800
        && text.charCodeAt(end - 1) <= 0xdbff
        && text.charCodeAt(end) >= 0xdc00
        && text.charCodeAt(end) <= 0xdfff
      ) end += 1;
      const encoded = JSON.stringify(text.slice(start, end));
      await write(encoded.slice(1, -1));
      start = end;
    }
    await write('"');
  };
  const visit = async (current: JsonValue): Promise<void> => {
    if (current === null) return write('null');
    if (typeof current === 'string') return writeString(current);
    if (typeof current === 'boolean') return write(current ? 'true' : 'false');
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('Turn-job JSON hash cannot contain non-finite numbers');
      return write(JSON.stringify(current));
    }
    if (seen.has(current)) throw new TypeError('Turn-job JSON hash cannot contain cycles');
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        await write('[');
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) await write(',');
          await visit(current[index]);
        }
        await write(']');
        return;
      }
      await write('{');
      const keys = Object.keys(current).sort();
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) await write(',');
        const key = keys[index];
        await writeString(key);
        await write(':');
        await visit(current[key]);
      }
      await write('}');
    } finally {
      seen.delete(current);
    }
  };
  await visit(value);
  return hash.digest('hex');
}

export async function beginDurableTurn(input: BeginDurableTurnInput): Promise<DurableTurnExecution> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) throw new TypeError('Durable turn sessionId is required.');
  const blobs = getTurnJobBlobStore();
  // Callers assemble payloads from optional request fields. Type assertions do
  // not remove runtime `undefined` values (for example
  // requestMeta.clientRequestId on a normal mobile send), while the durable
  // blob format correctly accepts JSON values only. Normalize at the journal
  // boundary so an absent optional field can never reject chat admission.
  const normalizedPayload = await toTurnJsonValueAsync(input.payload);
  const normalizedActorContextValue = input.actorContext == null
    ? null
    : await toTurnJsonValueAsync(input.actorContext);
  const normalizedActorContext = normalizedActorContextValue
    && typeof normalizedActorContextValue === 'object'
    && !Array.isArray(normalizedActorContextValue)
    ? normalizedActorContextValue as JsonObject
    : null;
  const payloadDescriptor = await blobs.putJsonAsync(normalizedPayload);
  const store = getTurnJobStore();
  const enqueued = store.enqueueJob({
    sessionId,
    kind: input.kind,
    payloadRef: payloadDescriptor.ref,
    requestFingerprint: String(input.requestFingerprint || '').trim() || payloadDescriptor.hash,
    clientRequestId: input.clientRequestId || null,
    taskId: input.taskId || null,
    goalId: input.goalId || null,
    goalTurnId: input.goalTurnId || null,
    actorContext: normalizedActorContext,
    priority: input.priority,
    maxAttempts: input.maxAttempts,
  });
  if (!enqueued.created && (enqueued.job.state === 'final_persisted' || enqueued.job.state === 'completed')) {
    if (!enqueued.job.finalRef) throw new Error(`Durable turn ${enqueued.job.id} has no persisted final result.`);
    const replayedResult = blobs.getJson<JsonValue>(enqueued.job.finalRef);
    return {
      jobId: enqueued.job.id,
      sessionId,
      kind: enqueued.job.kind,
      attempt: enqueued.job.attempt,
      leaseToken: '',
      leaseOwner: 'durable-replay',
      payloadRef: enqueued.job.payloadRef,
      nextToolSequence: 1,
      nextModelSequence: 1,
      heartbeatTimer: null,
      ...createFenceState(),
      finalRef: enqueued.job.finalRef,
      settled: enqueued.job.state === 'completed',
      replayed: true,
      replayedResult,
      boundedFinalResult: replayedResult,
    };
  }
  if (!enqueued.created && !['queued', 'checkpointed', 'interrupted'].includes(enqueued.job.state)) {
    throw new Error(`Durable turn ${enqueued.job.id} already exists in state ${enqueued.job.state}.`);
  }
  const leaseOwner = `gateway:${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
  const lease = store.claimJob(enqueued.job.id, {
    leaseOwner,
    workerPid: process.pid,
    leaseMs: TURN_LEASE_MS,
  });
  if (!lease) {
    // Synchronous callers have no general queued-job dispatcher yet. Do not
    // leave a newly admitted row parked forever merely because its session was
    // busy in the small interval between admission and exact claim.
    if (enqueued.created) store.deleteUnclaimedJob(enqueued.job.id);
    throw new Error(`Durable turn ${enqueued.job.id} could not acquire its session lease.`);
  }
  store.markJobRunning(enqueued.job.id, lease.token);
  const execution: DurableTurnExecution = {
    jobId: enqueued.job.id,
    sessionId,
    kind: input.kind,
    attempt: lease.job.attempt,
    leaseToken: lease.token,
    leaseOwner,
    payloadRef: payloadDescriptor.ref,
    nextToolSequence: 1,
    nextModelSequence: 1,
    heartbeatTimer: null,
    ...createFenceState(),
    finalRef: null,
    settled: false,
    replayed: false,
  };
  execution.heartbeatTimer = setInterval(() => {
    if (execution.settled || execution.finalRef) return;
    try {
      store.heartbeatJob(execution.jobId, execution.leaseToken, TURN_LEASE_MS);
    } catch (error: any) {
      const fenced = fenceDurableTurnExecution(execution, error, 'heartbeat renewal failed');
      console.error(`[turn-journal] ${fenced.message}`);
    }
  }, TURN_HEARTBEAT_MS);
  execution.heartbeatTimer.unref?.();
  return execution;
}

export function runWithDurableTurn<T>(execution: DurableTurnExecution, fn: () => T): T {
  return storage.run(execution, fn);
}

export function getCurrentDurableTurn(): DurableTurnExecution | null {
  return storage.getStore() || null;
}

export function stopDurableTurnHeartbeat(execution: DurableTurnExecution): void {
  if (execution.heartbeatTimer) clearInterval(execution.heartbeatTimer);
  execution.heartbeatTimer = null;
}

export function fenceDurableTurnExecution(
  execution: DurableTurnExecution,
  cause: unknown,
  operation = 'lease ownership was lost',
): DurableTurnFenceError {
  if (execution.fenceError) return execution.fenceError;
  const causeMessage = String((cause as any)?.message || cause || operation).slice(0, 1_000);
  const reason = cause instanceof TurnJobLeaseLostError
    ? `${operation}: journal lease token is no longer active`
    : `${operation}: ${causeMessage}`;
  const error = isDurableTurnFenceError(cause)
    ? cause
    : new DurableTurnFenceError(execution.jobId, reason, { cause });
  execution.fencedAt = Date.now();
  execution.fenceReason = reason;
  execution.fenceError = error;
  stopDurableTurnHeartbeat(execution);
  if (!execution.fenceController.signal.aborted) execution.fenceController.abort(error);
  return error;
}

export function assertDurableTurnLease(
  execution = getCurrentDurableTurn(),
): void {
  if (!execution) return;
  if (execution.fenceError) throw execution.fenceError;
}

function throwDurabilityFailure(
  execution: DurableTurnExecution,
  operation: string,
  error: unknown,
): never {
  const fenced = fenceDurableTurnExecution(execution, error, operation);
  console.error(`[turn-journal] ${fenced.message}`);
  throw fenced;
}

export function createDurableTurnAbortView(
  execution: DurableTurnExecution,
  upstream?: { aborted: boolean; interrupted?: boolean; signal?: AbortSignal },
): { state: { readonly aborted: boolean; readonly interrupted: boolean; signal: AbortSignal }; dispose: () => void } {
  const controller = new AbortController();
  const forward = (signal: AbortSignal, fallback: string) => {
    if (controller.signal.aborted) return;
    controller.abort(signal.reason ?? new Error(fallback));
  };
  const onFence = () => forward(execution.signal, 'Durable turn was fenced.');
  const onUpstream = () => forward(upstream?.signal as AbortSignal, 'Turn was cancelled.');
  execution.signal.addEventListener('abort', onFence, { once: true });
  upstream?.signal?.addEventListener('abort', onUpstream, { once: true });
  if (execution.signal.aborted) onFence();
  else if (upstream?.signal?.aborted) onUpstream();
  else if (upstream?.aborted) controller.abort(new Error('Turn was cancelled.'));
  const state = {
    get aborted() {
      return execution.signal.aborted || upstream?.aborted === true || controller.signal.aborted;
    },
    get interrupted() {
      return upstream?.interrupted === true;
    },
    signal: controller.signal,
  };
  return {
    state,
    dispose: () => {
      execution.signal.removeEventListener('abort', onFence);
      upstream?.signal?.removeEventListener('abort', onUpstream);
    },
  };
}

const NON_DURABLE_EVENT_TYPES = new Set(['token', 'thinking_delta', 'reasoning_summary_delta', 'model_stream_event', 'heartbeat', 'latency_mark']);

export function recordDurableTurnEvent(typeInput: string, data: unknown, execution = getCurrentDurableTurn()): void {
  if (!execution) return;
  assertDurableTurnLease(execution);
  if (execution.settled) return;
  const type = String(typeInput || 'event').trim() || 'event';
  if (NON_DURABLE_EVENT_TYPES.has(type)) return;
  try {
    const bounded = boundTurnDeliveryFrame(type, (data && typeof data === 'object' ? data : {}) as Record<string, unknown>, {
      // Progress journaling is never allowed to introduce a large synchronous
      // blob write on the gateway. Reuse authoritative content when it already
      // exists; otherwise the bounded preview is sufficient for replay.
      createReference: reuseExistingTurnDeliveryReference,
    });
    const payload = toTurnJsonValue(bounded.data);
    if (jsonUtf8Bytes(payload) > INLINE_EVENT_BYTES) {
      const descriptor = getTurnJobBlobStore().putJson(payload);
      getTurnJobStore().appendWorkerEvent(execution.jobId, execution.leaseToken, {
        type,
        payload: { ref: descriptor.ref, bytes: descriptor.sizeBytes, bounded: bounded.changed },
        payloadRef: descriptor.ref,
      });
    } else {
      getTurnJobStore().appendWorkerEvent(execution.jobId, execution.leaseToken, { type, payload });
    }
  } catch (error) {
    throwDurabilityFailure(execution, `append ${type} event`, error);
  }
}

export function checkpointDurableTurn(
  phase: string,
  continuation: unknown,
  options: { modelRound?: number; toolEffectId?: string; metadata?: JsonObject } = {},
  execution = getCurrentDurableTurn(),
): void {
  if (!execution) return;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return;
  try {
    const descriptor = getTurnJobBlobStore().putJson(toTurnJsonValue(continuation));
    getTurnJobStore().saveCheckpoint(execution.jobId, execution.leaseToken, {
      phase: String(phase || 'checkpoint'),
      continuationRef: descriptor.ref,
      continuationHash: descriptor.hash,
      modelRound: options.modelRound,
      toolEffectId: options.toolEffectId,
      metadata: options.metadata == null
        ? undefined
        : toTurnJsonValue(options.metadata) as JsonObject,
    });
  } catch (error) {
    throwDurabilityFailure(execution, `save ${String(phase || 'checkpoint')} checkpoint`, error);
  }
}

export function prepareDurableToolEffect(
  toolName: string,
  toolCallId: string,
  args: unknown,
  replayPolicy: ToolEffectReplayPolicy,
  execution = getCurrentDurableTurn(),
): { record: ToolEffectRecord; begin: BeginToolEffectResult } | null {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return null;
  try {
    const argsJson = canonicalJson(toTurnJsonValue(args));
    const logicalSequence = execution.nextToolSequence++;
    const argsHash = crypto.createHash('sha256').update(argsJson).digest('hex');
    const effectId = `${execution.jobId}:tool:${logicalSequence}`;
    const store = getTurnJobStore();
    const record = store.prepareToolEffect(execution.jobId, execution.leaseToken, {
      effectId,
      logicalSequence,
      toolCallId: String(toolCallId || effectId),
      toolName: String(toolName || 'tool'),
      argsHash,
      replayPolicy,
    });
    const begin = store.beginToolEffect(execution.jobId, execution.leaseToken, effectId);
    return { record, begin };
  } catch (error) {
    throwDurabilityFailure(execution, `prepare ${String(toolName || 'tool')} tool effect`, error);
  }
}

/** Nonblocking preparation for the central/special tool paths with potentially large arguments. */
export async function prepareDurableToolEffectAsync(
  toolName: string,
  toolCallId: string,
  args: unknown,
  replayPolicy: ToolEffectReplayPolicy,
  execution = getCurrentDurableTurn(),
): Promise<{ record: ToolEffectRecord; begin: BeginToolEffectResult } | null> {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return null;
  try {
    const normalized = await toTurnJsonValueAsync(args);
    const argsHash = await hashTurnJsonValueCanonicalAsync(normalized);
    assertDurableTurnLease(execution);
    const logicalSequence = execution.nextToolSequence++;
    const effectId = `${execution.jobId}:tool:${logicalSequence}`;
    const store = getTurnJobStore();
    const record = store.prepareToolEffect(execution.jobId, execution.leaseToken, {
      effectId,
      logicalSequence,
      toolCallId: String(toolCallId || effectId),
      toolName: String(toolName || 'tool'),
      argsHash,
      replayPolicy,
    });
    const begin = store.beginToolEffect(execution.jobId, execution.leaseToken, effectId);
    return { record, begin };
  } catch (error) {
    if (isDurableTurnFenceError(error)) throw error;
    throwDurabilityFailure(execution, `prepare ${String(toolName || 'tool')} tool effect`, error);
  }
}

export function completeDurableToolEffect(effectId: string, result: unknown, execution = getCurrentDurableTurn()): string | null {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return null;
  try {
    const descriptor = getTurnJobBlobStore().putJson(toTurnJsonValue(result));
    getTurnJobStore().completeToolEffect(execution.jobId, execution.leaseToken, effectId, descriptor.ref);
    checkpointDurableTurn('tool_result', { effectId, resultRef: descriptor.ref }, { toolEffectId: effectId }, execution);
    return descriptor.ref;
  } catch (error) {
    if (isDurableTurnFenceError(error)) throw error;
    throwDurabilityFailure(execution, `complete tool effect ${String(effectId || '').slice(0, 256)}`, error);
  }
}

/**
 * Large central tool results use the nonblocking blob path. Inline lifecycle
 * tools retain the synchronous variant above because their bounded result is
 * committed from a synchronous event-publication hook.
 */
export async function completeDurableToolEffectAsync(
  effectId: string,
  result: unknown,
  execution = getCurrentDurableTurn(),
): Promise<string | null> {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return null;
  try {
    const normalized = await toTurnJsonValueAsync(result);
    const descriptor = await getTurnJobBlobStore().putJsonAsync(normalized);
    assertDurableTurnLease(execution);
    getTurnJobStore().completeToolEffect(execution.jobId, execution.leaseToken, effectId, descriptor.ref);
    checkpointDurableTurn('tool_result', { effectId, resultRef: descriptor.ref }, { toolEffectId: effectId }, execution);
    return descriptor.ref;
  } catch (error) {
    if (isDurableTurnFenceError(error)) throw error;
    throwDurabilityFailure(execution, `complete tool effect ${String(effectId || '').slice(0, 256)}`, error);
  }
}

export function failDurableToolEffect(effectId: string, error: unknown, execution = getCurrentDurableTurn()): void {
  if (!execution) return;
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef) return;
  try {
    getTurnJobStore().failToolEffect(execution.jobId, execution.leaseToken, effectId, String((error as any)?.message || error || 'Tool failed'));
  } catch (journalError) {
    throwDurabilityFailure(execution, `fail tool effect ${String(effectId || '').slice(0, 256)}`, journalError);
  }
}

export function readDurableToolEffectResult(ref: string): unknown {
  assertDurableTurnLease();
  return getTurnJobBlobStore().getJson(ref);
}

export async function acquireDurableResourceLeases(
  resourceKeys: readonly string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
  execution = getCurrentDurableTurn(),
): Promise<string[]> {
  if (!execution) return [];
  assertDurableTurnLease(execution);
  if (execution.settled || execution.finalRef || resourceKeys.length === 0) return [];
  const keys = [...new Set(resourceKeys.map((key) => String(key || '').trim()).filter(Boolean))].sort();
  const acquired: string[] = [];
  const deadline = Date.now() + Math.max(1_000, Number(options.timeoutMs || 30_000));
  try {
    for (const resourceKey of keys) {
      while (true) {
        assertDurableTurnLease(execution);
        if (options.signal?.aborted) throw options.signal.reason || new Error('Resource lease acquisition cancelled.');
        const now = Date.now();
        let lease;
        try {
          lease = getTurnJobStore().tryAcquireResourceLease({
            resourceKey,
            jobId: execution.jobId,
            leaseToken: execution.leaseToken,
            leaseOwner: execution.leaseOwner,
            leaseUntil: now + TURN_LEASE_MS,
            now,
          });
        } catch (error) {
          throwDurabilityFailure(execution, `acquire resource lease ${resourceKey}`, error);
        }
        if (lease) {
          acquired.push(resourceKey);
          break;
        }
        if (now >= deadline) throw new Error(`Timed out waiting for resource lease ${resourceKey}.`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return acquired;
  } catch (error) {
    releaseDurableResourceLeases(acquired, execution);
    throw error;
  }
}

export function releaseDurableResourceLeases(
  resourceKeys: readonly string[],
  execution = getCurrentDurableTurn(),
): void {
  if (!execution) return;
  for (const resourceKey of [...resourceKeys].reverse()) {
    try { getTurnJobStore().releaseResourceLease(resourceKey, execution.jobId, execution.leaseToken); } catch {}
  }
}

export async function prepareDurableTurnFinal(
  result: unknown,
  execution = getCurrentDurableTurn(),
): Promise<string | null> {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.finalRef) return execution.finalRef;
  if (execution.preparedFinalRef) return execution.preparedFinalRef;
  try {
    const bounded = await boundTurnDeliveryFrameAsync('done', (result && typeof result === 'object' ? result : {}) as Record<string, unknown>, {
      createReference: async (candidate) => {
        const ref = await createTurnDeliveryReferenceAsync(candidate);
        if (!ref) throw new Error(`Could not persist bounded delivery content at ${candidate.path}.`);
        return ref;
      },
    });
    const finalPayload = toTurnJsonValue({
      ...bounded.data,
      ...(bounded.replacements.length ? { deliveryReplacements: bounded.replacements } : {}),
    });
    // The async bounder does not return until every referenced replacement is
    // durable. Keep renewing the lease while final JSON compression/fsync run.
    assertDurableTurnLease(execution);
    const descriptor = await getTurnJobBlobStore().putJsonAsync(finalPayload);
    assertDurableTurnLease(execution);
    execution.preparedFinalRef = descriptor.ref;
    execution.boundedFinalResult = finalPayload;
    return descriptor.ref;
  } catch (error) {
    throwDurabilityFailure(execution, 'prepare final result', error);
  }
}

/**
 * Adopt a bounded final reference that was durably attached to the authoritative
 * assistant message before a prior gateway attempt stopped. Reading the bounded
 * blob validates its envelope/hash before it can be committed to the journal.
 */
export function adoptPreparedDurableTurnFinal(
  finalRef: string,
  execution = getCurrentDurableTurn(),
): JsonValue | null {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.finalRef && execution.finalRef !== finalRef) {
    throw new Error(`Durable turn ${execution.jobId} already owns a different final reference.`);
  }
  try {
    const payload = getTurnJobBlobStore().getJson<JsonValue>(String(finalRef || '').trim());
    execution.preparedFinalRef = String(finalRef || '').trim();
    execution.boundedFinalResult = payload;
    return payload;
  } catch (error) {
    throwDurabilityFailure(execution, 'adopt prepared final result', error);
  }
}

export function commitPreparedDurableTurnFinal(
  deliveries: readonly TurnDeliveryInput[] = [],
  execution = getCurrentDurableTurn(),
): string | null {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.finalRef) return execution.finalRef;
  const finalRef = String(execution.preparedFinalRef || '').trim();
  if (!finalRef) throw new Error(`Durable turn ${execution.jobId} has no prepared final result.`);
  try {
    const descriptor = getTurnJobBlobStore().readDescriptor(finalRef);
    stopDurableTurnHeartbeat(execution);
    getTurnJobStore().persistFinal(execution.jobId, execution.leaseToken, {
      finalRef,
      payload: { finalRef, bytes: descriptor.sizeBytes, bounded: true },
      payloadRef: finalRef,
      deliveries,
    });
    execution.finalRef = finalRef;
    return finalRef;
  } catch (error) {
    throwDurabilityFailure(execution, 'commit prepared final result', error);
  }
}

export async function persistDurableTurnFinal(
  result: unknown,
  deliveries: readonly TurnDeliveryInput[] = [],
  execution = getCurrentDurableTurn(),
): Promise<string | null> {
  if (!execution) return null;
  await prepareDurableTurnFinal(result, execution);
  return commitPreparedDurableTurnFinal(deliveries, execution);
}

export function getDurableTurnFinalDeliveryPayload(
  execution = getCurrentDurableTurn(),
): JsonValue | null {
  return execution?.boundedFinalResult ?? execution?.replayedResult ?? null;
}

export function findDurableTurnFinalReplay(
  sessionId: string,
  clientRequestId: string,
): { job: TurnJob; result: JsonValue } | null {
  const job = getTurnJobStore().getJobByClientRequestId(sessionId, clientRequestId);
  if (!job?.finalRef || (job.state !== 'final_persisted' && job.state !== 'completed')) return null;
  return { job, result: getTurnJobBlobStore().getJson<JsonValue>(job.finalRef) };
}

export function completePersistedDurableTurn(jobId: string): TurnJob | null {
  const job = getTurnJobStore().getJob(jobId);
  if (!job || job.state === 'completed') return job;
  if (job.state !== 'final_persisted') return null;
  return getTurnJobStore().completeFinalizedJob(job.id);
}

export function completeDurableTurn(execution = getCurrentDurableTurn()): TurnJob | null {
  if (!execution) return null;
  assertDurableTurnLease(execution);
  if (execution.settled) return null;
  if (!execution.finalRef) throw new Error(`Durable turn ${execution.jobId} cannot complete before final persistence.`);
  const job = getTurnJobStore().completeFinalizedJob(execution.jobId);
  execution.settled = true;
  stopDurableTurnHeartbeat(execution);
  return job;
}

export function failDurableTurn(error: unknown, retryable = true, execution = getCurrentDurableTurn()): void {
  if (!execution || execution.settled) return;
  stopDurableTurnHeartbeat(execution);
  if (execution.fenceError) {
    // A fenced attempt must never use a stale token (or the unfenced cancel
    // API) to alter a replacement attempt. Lease-expiry reconciliation owns
    // the durable transition from this point.
    execution.settled = true;
    return;
  }
  try {
    if (execution.finalRef) {
      getTurnJobStore().appendGatewayEvent(execution.jobId, {
        type: 'delivery_failed',
        payload: { error: String((error as any)?.message || error || 'Delivery failed').slice(0, 4_000) },
      });
    } else {
      getTurnJobStore().failJob(
        execution.jobId,
        execution.leaseToken,
        String((error as any)?.message || error || 'Turn failed'),
        retryable,
      );
    }
  } catch (journalError) {
    console.error(`[turn-journal] Could not record failure for ${execution.jobId}:`, (journalError as any)?.message || journalError);
  }
  execution.settled = true;
}

export function interruptDurableTurn(reason: string, execution = getCurrentDurableTurn()): void {
  if (!execution || execution.settled) return;
  stopDurableTurnHeartbeat(execution);
  // A durable final is already safe; startup final-state reconciliation owns
  // completion and delivery instead of rolling the job back to interrupted.
  if (execution.finalRef || execution.fenceError) {
    execution.settled = true;
    return;
  }
  try {
    getTurnJobStore().interruptLeasedJob(execution.jobId, execution.leaseToken, reason);
  } catch (error) {
    // Preserve token fencing if the lease changed between the local check and
    // the transaction. A stale attempt must not interrupt its replacement.
    fenceDurableTurnExecution(execution, error, 'shutdown interruption lease validation failed');
  }
  execution.settled = true;
}

export function cancelDurableTurn(reason: string, execution = getCurrentDurableTurn()): void {
  if (!execution || execution.settled) return;
  stopDurableTurnHeartbeat(execution);
  if (!execution.fenceError) {
    try {
      getTurnJobStore().cancelLeasedJob(execution.jobId, execution.leaseToken, reason);
    } catch (error) {
      // The token can expire between the local fence check and the transaction.
      // Fence this stale in-memory attempt, but never fall back to the unfenced
      // administrative cancel that could terminate a replacement attempt.
      fenceDurableTurnExecution(execution, error, 'cancel lease validation failed');
    }
  }
  execution.settled = true;
}
