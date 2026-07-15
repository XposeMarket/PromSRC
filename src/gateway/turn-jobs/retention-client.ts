import path from 'path';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import { getTurnJobBlobRoot } from './blob-runtime.js';
import { getTurnJobStorePath } from './runtime.js';
import type { TurnJournalRetentionOptions, TurnJournalRetentionResult } from './retention.js';

const DAY_MS = 24 * 60 * 60_000;

export interface TurnRetentionRuntimeStatus {
  enabled: boolean;
  isolation: 'child_process';
  workerHeapMb: number;
  scheduled: boolean;
  scheduledFor?: number;
  running: boolean;
  jobRetentionMs: number;
  blobRetentionMs: number;
  intervalMs: number;
  catchupDelayMs: number;
  jobBatchLimit: number;
  blobScanLimit: number;
  blobDeleteLimit: number;
  lastWorkerPid?: number;
  lastRunStartedAt?: number;
  lastRunCompletedAt?: number;
  lastResult?: TurnJournalRetentionResult;
  lastError?: string;
  broker: RuntimeWorkerBrokerStatus;
}

interface RetentionConfig {
  enabled: boolean;
  jobRetentionMs: number;
  blobRetentionMs: number;
  intervalMs: number;
  initialDelayMs: number;
  catchupDelayMs: number;
  failureRetryMs: number;
  jobBatchLimit: number;
  blobScanLimit: number;
  blobDeleteLimit: number;
  workerTimeoutMs: number;
  workerHeapMb: number;
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function readConfig(): RetentionConfig {
  const jobRetentionMs = envInteger('PROMETHEUS_TURN_JOB_RETENTION_MS', 30 * DAY_MS, 60 * 60_000, 3650 * DAY_MS);
  const requestedBlobRetentionMs = envInteger('PROMETHEUS_TURN_BLOB_RETENTION_MS', 90 * DAY_MS, 60 * 60_000, 3650 * DAY_MS);
  const blobScanLimit = envInteger('PROMETHEUS_TURN_RETENTION_BLOB_SCAN_BATCH', 2_000, 1, 100_000);
  return {
    enabled: process.env.PROMETHEUS_DISABLE_TURN_RETENTION !== '1'
      && process.env.PROMETHEUS_DISABLE_TURN_JOURNAL !== '1',
    jobRetentionMs,
    // Blob data deliberately outlives journal rows. This grace period also
    // protects signed delivery URLs and nested references inside final blobs.
    blobRetentionMs: Math.max(requestedBlobRetentionMs, jobRetentionMs + DAY_MS),
    intervalMs: envInteger('PROMETHEUS_TURN_RETENTION_INTERVAL_MS', DAY_MS, 60_000, 30 * DAY_MS),
    initialDelayMs: envInteger('PROMETHEUS_TURN_RETENTION_INITIAL_DELAY_MS', 2 * 60_000, 5_000, DAY_MS),
    catchupDelayMs: envInteger('PROMETHEUS_TURN_RETENTION_CATCHUP_DELAY_MS', 5 * 60_000, 30_000, DAY_MS),
    failureRetryMs: envInteger('PROMETHEUS_TURN_RETENTION_FAILURE_RETRY_MS', 15 * 60_000, 30_000, DAY_MS),
    jobBatchLimit: envInteger('PROMETHEUS_TURN_RETENTION_JOB_BATCH', 500, 1, 10_000),
    blobScanLimit,
    blobDeleteLimit: envInteger('PROMETHEUS_TURN_RETENTION_BLOB_DELETE_BATCH', 500, 1, blobScanLimit),
    workerTimeoutMs: envInteger('PROMETHEUS_TURN_RETENTION_WORKER_TIMEOUT_MS', 10 * 60_000, 30_000, 60 * 60_000),
    workerHeapMb: envInteger('PROMETHEUS_TURN_RETENTION_WORKER_HEAP_MB', 512, 128, 2_048),
  };
}

const broker = new RuntimeWorkerBroker({
  name: 'turn-journal-retention',
  entryBasename: 'turn-journal-retention-worker',
  startupTimeoutMs: envInteger('PROMETHEUS_TURN_RETENTION_WORKER_STARTUP_TIMEOUT_MS', 30_000, 1_000, 5 * 60_000),
  defaultJobTimeoutMs: envInteger('PROMETHEUS_TURN_RETENTION_WORKER_TIMEOUT_MS', 10 * 60_000, 30_000, 60 * 60_000),
  maxOldSpaceMb: readConfig().workerHeapMb,
  env: { PROMETHEUS_TURN_RETENTION_WORKER: '1' },
});

let scheduleStarted = false;
let scheduleTimer: NodeJS.Timeout | null = null;
let scheduledFor: number | undefined;
let shuttingDown = false;
let activeRun: Promise<TurnJournalRetentionResult> | null = null;
let lastWorkerPid: number | undefined;
let lastRunStartedAt: number | undefined;
let lastRunCompletedAt: number | undefined;
let lastResult: TurnJournalRetentionResult | undefined;
let lastError = '';

function buildOptions(config: RetentionConfig): TurnJournalRetentionOptions {
  const databasePath = getTurnJobStorePath();
  return {
    databasePath,
    blobRoot: getTurnJobBlobRoot(),
    statePath: path.join(path.dirname(databasePath), 'turn-retention-state.json'),
    jobRetentionMs: config.jobRetentionMs,
    blobRetentionMs: config.blobRetentionMs,
    jobBatchLimit: config.jobBatchLimit,
    blobScanLimit: config.blobScanLimit,
    blobDeleteLimit: config.blobDeleteLimit,
  };
}

function armSchedule(delayMs: number): void {
  if (shuttingDown || !scheduleStarted || scheduleTimer || !readConfig().enabled) return;
  const delay = Math.max(1_000, Math.floor(delayMs));
  scheduledFor = Date.now() + delay;
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    scheduledFor = undefined;
    let nextDelayMs = readConfig().intervalMs;
    void runTurnJournalRetentionNow()
      .then((result) => {
        if (result.jobBatchSaturated || result.blobs.batchSaturated) {
          nextDelayMs = readConfig().catchupDelayMs;
        }
      })
      .catch((error) => {
        nextDelayMs = readConfig().failureRetryMs;
        console.warn(`[TurnRetention] Maintenance pass failed: ${String((error as Error)?.message || error).slice(0, 1000)}`);
      })
      .finally(() => {
        if (!shuttingDown && scheduleStarted) armSchedule(nextDelayMs);
      });
  }, delay);
  scheduleTimer.unref?.();
}

/** Start the daily timer without spawning a process until the first pass. */
export function scheduleTurnJournalRetention(): void {
  if (scheduleStarted || shuttingDown) return;
  scheduleStarted = true;
  const config = readConfig();
  if (config.enabled) armSchedule(config.initialDelayMs);
}

export function runTurnJournalRetentionNow(): Promise<TurnJournalRetentionResult> {
  if (activeRun) return activeRun;
  if (shuttingDown) return Promise.reject(new Error('Turn journal retention is shutting down.'));
  const config = readConfig();
  if (!config.enabled) return Promise.reject(new Error('Turn journal retention is disabled.'));
  lastRunStartedAt = Date.now();
  lastError = '';
  activeRun = broker.run<TurnJournalRetentionResult>(
    'turn_journal_retention',
    buildOptions(config),
    config.workerTimeoutMs,
  ).then((result) => {
    lastResult = result;
    return result;
  }).catch((error) => {
    lastError = String((error as Error)?.message || error || 'Unknown retention worker failure').slice(0, 2_000);
    throw error;
  }).finally(async () => {
    lastWorkerPid = broker.getStatus().pid || lastWorkerPid;
    lastRunCompletedAt = Date.now();
    // Recycle after each pass so the maintenance connection and any transient
    // directory/SQLite memory are returned to the OS.
    await broker.shutdown(1_500).catch(() => undefined);
    activeRun = null;
  });
  return activeRun;
}

export function getTurnRetentionRuntimeStatus(): TurnRetentionRuntimeStatus {
  const config = readConfig();
  return {
    enabled: config.enabled,
    isolation: 'child_process',
    workerHeapMb: config.workerHeapMb,
    scheduled: Boolean(scheduleTimer),
    scheduledFor,
    running: Boolean(activeRun),
    jobRetentionMs: config.jobRetentionMs,
    blobRetentionMs: config.blobRetentionMs,
    intervalMs: config.intervalMs,
    catchupDelayMs: config.catchupDelayMs,
    jobBatchLimit: config.jobBatchLimit,
    blobScanLimit: config.blobScanLimit,
    blobDeleteLimit: config.blobDeleteLimit,
    lastWorkerPid,
    lastRunStartedAt,
    lastRunCompletedAt,
    lastResult,
    lastError: lastError || undefined,
    broker: broker.getStatus(),
  };
}

export async function shutdownTurnJournalRetention(): Promise<void> {
  shuttingDown = true;
  scheduleStarted = false;
  scheduledFor = undefined;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
  await broker.shutdown(1_500).catch(() => undefined);
}
