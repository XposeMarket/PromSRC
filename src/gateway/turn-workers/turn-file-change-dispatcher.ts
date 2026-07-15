import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
import type { JsonValue } from '../turn-jobs/types.js';
import {
  TurnWorkerPool,
  type TurnWorkerPoolJob,
  type TurnWorkerPoolStatus,
} from './turn-worker-pool.js';
import {
  TURN_FILE_CHANGE_SCAN_VERSION,
  type StoredTurnFileChangeScanRequest,
  type StoredTurnFileChangeScanResult,
  type TurnFileChangeScanInputEnvelope,
  type TurnFileChangeScanResultReference,
} from './turn-file-change-contract.js';
import {
  collectTurnFileChangesDirect,
  isTurnFileMutationTool,
  type TurnFileChanges,
} from './turn-file-change-collector.js';

export interface TurnFileChangeScanOptions {
  signal?: AbortSignal;
}

let pool: TurnWorkerPool | null = null;
let scanSequence = 0;
let shutdownRequested = false;

function resolveWorkerEntry(): string {
  const candidates = [
    path.join(__dirname, 'turn-file-change-worker.js'),
    path.join(__dirname, 'turn-file-change-worker.ts'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`File-change worker entry not found: ${candidates.join(' or ')}`);
  return found;
}

function configuredWorkerCount(): number {
  const value = Number(process.env.PROMETHEUS_FILE_CHANGE_WORKER_COUNT || 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(2, Math.floor(value))) : 2;
}

function configuredWorkerOldSpaceMb(): number {
  const value = Number(process.env.PROMETHEUS_FILE_CHANGE_WORKER_OLD_SPACE_MB || 384);
  return Number.isFinite(value) ? Math.max(128, Math.min(1_024, Math.floor(value))) : 384;
}

export function buildTurnFileChangeWorkerExecArgv(): string[] {
  const inherited: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const argument = process.execArgv[index];
    if (argument === '--max-old-space-size' || argument === '--max_old_space_size') {
      index += 1;
      continue;
    }
    if (/^--max[-_]old[-_]space[-_]size=/.test(argument)) continue;
    inherited.push(argument);
  }
  return [...inherited, `--max-old-space-size=${configuredWorkerOldSpaceMb()}`];
}

function getPool(): TurnWorkerPool {
  if (shutdownRequested) throw new Error('File-change worker pool is shutting down.');
  if (!pool) {
    pool = new TurnWorkerPool({
      name: 'file-change-workers',
      entryPath: resolveWorkerEntry(),
      maxWorkers: configuredWorkerCount(),
      maxQueuedJobs: 32,
      recycleAfterJobs: Math.max(1, Number(process.env.PROMETHEUS_FILE_CHANGE_WORKER_RECYCLE_JOBS || 25)),
      execArgv: buildTurnFileChangeWorkerExecArgv(),
      heartbeatTimeoutMs: 45_000,
      cancelGraceMs: 2_000,
      shutdownGraceMs: 2_000,
    });
  }
  return pool;
}

function hasCandidateMutation(toolResults: unknown[] | undefined): boolean {
  return (Array.isArray(toolResults) ? toolResults : []).some((result) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const record = result as Record<string, unknown>;
    return record.error !== true && isTurnFileMutationTool(String(record.name || record.toolName || ''));
  });
}

function degradeOnWorkerFailure(
  error: unknown,
  durable: ReturnType<typeof getCurrentDurableTurn>,
): undefined {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[file-change-workers] Isolated scan unavailable; omitting optional file-change metadata: ${message}`);
  try {
    recordDurableTurnEvent('file_change_worker_degraded', { message: message.slice(0, 1_000) }, durable);
  } catch {}
  return undefined;
}

/**
 * Runs git/diff/stat/read finalization outside the gateway event loop. The
 * request and result use content-addressed blobs; IPC only carries references.
 */
export async function collectTurnFileChangesIsolated(
  toolResults: unknown[] | undefined,
  workspacePath: string,
  options: TurnFileChangeScanOptions = {},
): Promise<TurnFileChanges | undefined> {
  if (!hasCandidateMutation(toolResults)) return undefined;
  if (options.signal?.aborted) return undefined;
  if (process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS === '1' || process.env.PROMETHEUS_TURN_WORKER === '1') {
    return collectTurnFileChangesDirect(toolResults, workspacePath);
  }

  const durable = getCurrentDurableTurn();
  const inCapturedTurn = <T>(fn: () => T): T => durable ? runWithDurableTurn(durable, fn) : fn();
  assertDurableTurnLease(durable);
  const normalizedResults = await toTurnJsonValueAsync(Array.isArray(toolResults) ? toolResults : []);
  const request: StoredTurnFileChangeScanRequest = {
    version: TURN_FILE_CHANGE_SCAN_VERSION,
    workspacePath,
    toolResults: Array.isArray(normalizedResults) ? normalizedResults : [],
  };
  const blobs = getTurnJobBlobStore();
  const requestDescriptor = await blobs.putJsonAsync(request as unknown as JsonValue);
  assertDurableTurnLease(durable);

  const sequence = ++scanSequence;
  const jobBase = durable?.jobId || `file_changes_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  const jobId = `${jobBase}:file_changes:${sequence}`.slice(0, 256);
  const input: TurnFileChangeScanInputEnvelope = {
    blobRoot: getTurnJobBlobRoot(),
    requestRef: requestDescriptor.ref,
  };

  let submitted: TurnWorkerPoolJob<TurnFileChangeScanResultReference>;
  try {
    submitted = getPool().submit<TurnFileChangeScanResultReference>({
      jobId,
      attempt: durable?.attempt || 1,
      input,
      leaseToken: durable?.leaseToken,
    }, {
      onStarted: ({ pid, workerId }) => inCapturedTurn(() => {
        assertDurableTurnLease(durable);
        recordDurableTurnEvent('file_change_worker_started', { pid, workerId, sequence }, durable);
      }),
      onCheckpoint: (message) => inCapturedTurn(() => {
        assertDurableTurnLease(durable);
        const checkpoint = message.checkpoint as Record<string, unknown>;
        checkpointDurableTurn(
          String(checkpoint?.kind || 'turn_file_change_scan'),
          checkpoint as JsonValue,
          { metadata: { sequence } },
          durable,
        );
      }),
      onError: (message) => inCapturedTurn(() => {
        assertDurableTurnLease(durable);
        recordDurableTurnEvent('file_change_worker_error', {
          code: message.code,
          message: message.message,
          sequence,
        }, durable);
      }),
    });
  } catch (error) {
    if (isDurableTurnFenceError(error)) throw error;
    return degradeOnWorkerFailure(error, durable);
  }

  const signal = options.signal || durable?.signal;
  const onAbort = () => {
    void submitted.cancel(String(signal?.reason || 'File-change scan cancelled.')).catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const reference = await submitted.result;
    assertDurableTurnLease(durable);
    const stored = blobs.getJson<StoredTurnFileChangeScanResult>(reference.resultRef);
    if (stored.version !== TURN_FILE_CHANGE_SCAN_VERSION) {
      throw new Error(`Unsupported file-change result version: ${String(stored.version)}`);
    }
    return stored.changes || undefined;
  } catch (error) {
    if (signal?.aborted) return undefined;
    if (isDurableTurnFenceError(error)) throw error;
    return degradeOnWorkerFailure(error, durable);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export function getTurnFileChangeWorkerPoolStatus(): TurnWorkerPoolStatus & {
  enabled: boolean;
  workerOldSpaceMb: number;
} {
  if (!pool) {
    return {
      enabled: process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS !== '1' && !shutdownRequested,
      workerOldSpaceMb: configuredWorkerOldSpaceMb(),
      name: 'file-change-workers',
      maxWorkers: configuredWorkerCount(),
      queuedJobs: 0,
      runningJobs: 0,
      shuttingDown: shutdownRequested,
      workers: [],
    };
  }
  return { enabled: true, workerOldSpaceMb: configuredWorkerOldSpaceMb(), ...pool.getStatus() };
}

export async function shutdownTurnFileChangeWorkerPool(): Promise<void> {
  shutdownRequested = true;
  const active = pool;
  pool = null;
  await active?.shutdown();
}
