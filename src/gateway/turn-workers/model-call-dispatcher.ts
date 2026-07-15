import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getTurnJobBlobRoot, getTurnJobBlobStore } from '../turn-jobs/blob-runtime.js';
import {
  assertDurableTurnLease,
  checkpointDurableTurn,
  getCurrentDurableTurn,
  isDurableTurnFenceError,
  recordDurableTurnEvent,
  runWithDurableTurn,
  toTurnJsonValueAsync,
} from '../turn-jobs/execution-context.js';
import { TurnWorkerPool, type TurnWorkerPoolStatus } from './turn-worker-pool.js';
import type {
  ModelCallInputEnvelope,
  ModelCallRequest,
  ModelCallResultReference,
  ModelCallStreamEvent,
  StoredModelCallResult,
} from './model-call-contract.js';

export interface IsolatedModelCallCallbacks {
  onToken?: (text: string) => void;
  onThinking?: (text: string) => void;
  onReasoningSummary?: (text: string) => void;
  onModelEvent?: (event: any) => void;
  signal?: AbortSignal;
}

let pool: TurnWorkerPool | null = null;

export async function prepareModelWorkerCredentials(request: ModelCallRequest): Promise<void> {
  if (request.operation === 'echo') return;
  const providerId = String(request.providerId || '').trim().toLowerCase();
  if (providerId === 'openai_codex') {
    const [{ getConfig }, { getValidToken }] = await Promise.all([
      import('../../config/config.js'),
      import('../../auth/openai-oauth.js'),
    ]);
    await getValidToken(getConfig().getConfigDir(), request.accountId);
    return;
  }
  if (providerId === 'xai') {
    const [{ getConfig }, { getValidXAIToken, isXAIConnected }] = await Promise.all([
      import('../../config/config.js'),
      import('../../auth/xai-oauth.js'),
    ]);
    const configDir = getConfig().getConfigDir();
    if (isXAIConnected(configDir, request.accountId)) {
      await getValidXAIToken(configDir, request.accountId);
    }
  }
}

function resolveModelWorkerEntry(): string {
  const candidates = [
    path.join(__dirname, 'model-call-turn-worker.js'),
    path.join(__dirname, 'model-call-turn-worker.ts'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Model-call worker entry not found: ${candidates.join(' or ')}`);
  return found;
}

function configuredWorkerCount(): number {
  const value = Number(process.env.PROMETHEUS_TURN_WORKER_COUNT || process.env.PROMETHEUS_MODEL_WORKER_COUNT || 3);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.floor(value))) : 3;
}

function configuredWorkerHeapMb(): number {
  const value = Number(process.env.PROMETHEUS_MODEL_WORKER_MAX_OLD_SPACE_MB || 1_024);
  return Number.isFinite(value) ? Math.max(256, Math.min(4_096, Math.floor(value))) : 1_024;
}

function modelWorkerExecArgv(): string[] {
  const inherited = [...process.execArgv];
  if (inherited.some((value) => /^--max[-_]old[-_]space[-_]size(?:=|$)/i.test(value))) return inherited;
  return [...inherited, `--max-old-space-size=${configuredWorkerHeapMb()}`];
}

function getPool(): TurnWorkerPool {
  if (!pool) {
    pool = new TurnWorkerPool({
      name: 'model-turn-workers',
      entryPath: resolveModelWorkerEntry(),
      maxWorkers: configuredWorkerCount(),
      maxQueuedJobs: 100,
      recycleAfterJobs: Math.max(1, Number(process.env.PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS || 10)),
      heartbeatTimeoutMs: 45_000,
      cancelGraceMs: 5_000,
      shutdownGraceMs: 2_000,
      execArgv: modelWorkerExecArgv(),
    });
  }
  return pool;
}

function handleModelStreamEvent(
  event: ModelCallStreamEvent,
  callbacks: IsolatedModelCallCallbacks,
  durable: ReturnType<typeof getCurrentDurableTurn>,
): void {
  try {
    if (event.kind === 'model_token') callbacks.onToken?.(event.text);
    else if (event.kind === 'model_thinking') callbacks.onThinking?.(event.text);
    else if (event.kind === 'model_reasoning_summary') callbacks.onReasoningSummary?.(event.text);
    else if (event.kind === 'model_event') callbacks.onModelEvent?.(event.event);
    else if (event.kind === 'model_request') {
      recordDurableTurnEvent('model_request', event, durable);
    }
  } catch (error: any) {
    if (isDurableTurnFenceError(error)) throw error;
    console.warn('[model-turn-workers] Stream callback failed:', error?.message || error);
  }
}

export async function dispatchIsolatedModelCall<TOutput = unknown>(
  request: ModelCallRequest,
  callbacks: IsolatedModelCallCallbacks = {},
): Promise<TOutput> {
  const durable = getCurrentDurableTurn();
  const inCapturedTurn = <T>(fn: () => T): T => durable ? runWithDurableTurn(durable, fn) : fn();
  assertDurableTurnLease(durable);
  // Refresh rotating OAuth credentials in the single gateway process before
  // parallel workers load them. Secrets remain vault-backed and never cross
  // IPC; this only prevents independent children racing the same refresh token.
  await prepareModelWorkerCredentials(request);
  assertDurableTurnLease(durable);
  const blobs = getTurnJobBlobStore();
  // Prompt serialization, compression, and fsync are deliberately asynchronous
  // so a large context cannot pause gateway heartbeats or client connections.
  const requestDescriptor = await blobs.putJsonAsync(await toTurnJsonValueAsync(request));
  assertDurableTurnLease(durable);
  const modelSequence = durable ? durable.nextModelSequence++ : 1;
  const jobIdBase = durable?.jobId || `model_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  const jobId = `${jobIdBase}:model:${modelSequence}`.slice(0, 256);
  const attempt = durable?.attempt || 1;
  const input: ModelCallInputEnvelope = {
    blobRoot: getTurnJobBlobRoot(),
    requestRef: requestDescriptor.ref,
  };
  const submitted = getPool().submit<ModelCallResultReference>({
    jobId,
    attempt,
    input,
    leaseToken: durable?.leaseToken,
  }, {
    onStarted: ({ pid, workerId }) => inCapturedTurn(() => {
      assertDurableTurnLease(durable);
      recordDurableTurnEvent('model_worker_started', { pid, workerId, modelSequence }, durable);
    }),
    onEvent: (message) => inCapturedTurn(() => handleModelStreamEvent(message.event as ModelCallStreamEvent, callbacks, durable)),
    onCheckpoint: (message) => inCapturedTurn(() => {
      assertDurableTurnLease(durable);
      const checkpoint = message.checkpoint as any;
      checkpointDurableTurn(
        String(checkpoint?.kind || 'model_checkpoint'),
        checkpoint,
        { metadata: { modelSequence } },
        durable,
      );
    }),
    onError: (message) => inCapturedTurn(() => {
      assertDurableTurnLease(durable);
      recordDurableTurnEvent('model_worker_error', {
        code: message.code,
        message: message.message,
        modelSequence,
      }, durable);
    }),
    onRpc: ({ method, params }) => inCapturedTurn(async () => {
      assertDurableTurnLease(durable);
      if (method !== 'prepare_model_credentials' || !params || typeof params !== 'object') {
        throw new Error(`Unsupported model-worker gateway RPC: ${String(method || '')}`);
      }
      const requestedProvider = String((params as any).providerId || '').trim();
      const requestedAccount = String((params as any).accountId || '').trim();
      const expectedProvider = request.operation === 'echo' ? '' : String(request.providerId || '').trim();
      const expectedAccount = request.operation === 'echo' ? '' : String(request.accountId || '').trim();
      if (requestedProvider !== expectedProvider || requestedAccount !== expectedAccount) {
        throw new Error('Model worker credential preflight identity did not match its admitted request.');
      }
      await prepareModelWorkerCredentials(request);
      assertDurableTurnLease(durable);
      return { ready: true };
    }),
  });

  const cancellationSignal = callbacks.signal || durable?.signal;
  const onAbort = () => {
    void submitted.cancel(String(cancellationSignal?.reason || 'Model call cancelled.')).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      try {
        recordDurableTurnEvent('model_worker_cancel_error', { message, modelSequence }, durable);
      } catch {}
      console.warn('[model-turn-workers] Failed to deliver cancellation:', message);
    });
  };
  if (cancellationSignal) {
    if (cancellationSignal.aborted) onAbort();
    else cancellationSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const reference = await submitted.result;
    assertDurableTurnLease(durable);
    const stored = blobs.getJson<StoredModelCallResult>(reference.resultRef);
    return stored.output as TOutput;
  } finally {
    cancellationSignal?.removeEventListener('abort', onAbort);
  }
}

export function getModelTurnWorkerPoolStatus(): TurnWorkerPoolStatus & { enabled: boolean; heapLimitMb: number } {
  if (!pool) {
    return {
      enabled: process.env.PROMETHEUS_DISABLE_MODEL_WORKERS !== '1',
      heapLimitMb: configuredWorkerHeapMb(),
      name: 'model-turn-workers',
      maxWorkers: configuredWorkerCount(),
      queuedJobs: 0,
      runningJobs: 0,
      shuttingDown: false,
      workers: [],
    };
  }
  return { enabled: true, heapLimitMb: configuredWorkerHeapMb(), ...pool.getStatus() };
}

export async function shutdownModelTurnWorkerPool(): Promise<void> {
  const active = pool;
  pool = null;
  await active?.shutdown();
}
