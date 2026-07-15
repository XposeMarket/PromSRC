import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config.js';
import type { TokenizerFamily } from '../context/model-context.js';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import { writeJsonAtomicCooperatively } from '../storage/cooperative-json.js';
import type { StoredThreadFootprint } from './stored-thread-footprint.js';

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const contextWorkerHeapMb = boundedNumber(process.env.PROMETHEUS_CONTEXT_FOOTPRINT_HEAP_MB, 384, 256, 1_024);
const contextSnapshotMaxBytes = boundedNumber(
  Number(process.env.PROMETHEUS_CONTEXT_FOOTPRINT_MAX_SNAPSHOT_MB) * 1024 * 1024,
  96 * 1024 * 1024,
  16 * 1024 * 1024,
  256 * 1024 * 1024,
);
const broker = new RuntimeWorkerBroker({
  name: 'context-footprint',
  entryBasename: 'context-footprint-worker',
  startupTimeoutMs: 30_000,
  defaultJobTimeoutMs: 2 * 60_000,
  maxOldSpaceMb: contextWorkerHeapMb,
  env: { PROMETHEUS_CONTEXT_FOOTPRINT_MAX_SNAPSHOT_BYTES: String(contextSnapshotMaxBytes) },
});

const maxQueued = Math.max(1, Math.min(32, Number(process.env.PROMETHEUS_CONTEXT_FOOTPRINT_QUEUE || 8)));
let queueTail: Promise<void> = Promise.resolve();
let queued = 0;
let running = false;
let shuttingDown = false;
let lastStartedAt: number | undefined;
let lastCompletedAt: number | undefined;
let lastError = '';
const inFlightBySession = new Map<string, Promise<StoredThreadFootprint>>();

export interface ContextFootprintWorkerStatus {
  isolation: 'child_process';
  queued: number;
  running: boolean;
  maxQueued: number;
  workerHeapMb: number;
  maxSnapshotBytes: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastError?: string;
  broker: RuntimeWorkerBrokerStatus;
}

async function execute(sessionId: string, session: any, tokenizer: TokenizerFamily): Promise<StoredThreadFootprint> {
  const configDir = getConfig().getConfigDir();
  const snapshotDir = path.join(configDir, 'runtime', 'context-footprint');
  const snapshotPath = path.join(snapshotDir, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.json`);
  await writeJsonAtomicCooperatively(snapshotPath, session, {
    spaces: 0,
    mode: 0o600,
    maxBytes: contextSnapshotMaxBytes,
  });
  try {
    lastStartedAt = Date.now();
    running = true;
    return await broker.run<StoredThreadFootprint>('context_footprint', {
      sessionId,
      configDir,
      snapshotPath,
      tokenizer,
    });
  } finally {
    running = false;
    lastCompletedAt = Date.now();
    await fs.promises.unlink(snapshotPath).catch(() => undefined);
  }
}

export function calculateStoredThreadFootprintIsolated(
  sessionId: string,
  session: any,
  tokenizer: TokenizerFamily,
): Promise<StoredThreadFootprint> {
  const key = String(sessionId || '').trim();
  const existing = inFlightBySession.get(key);
  if (existing) return existing;
  if (shuttingDown) return Promise.reject(new Error('Context-footprint worker is shutting down.'));
  if (queued >= maxQueued) return Promise.reject(new Error('Context-footprint worker queue is full.'));
  queued += 1;
  const prior = queueTail.catch(() => undefined);
  let releaseQueue!: () => void;
  queueTail = new Promise<void>((resolve) => { releaseQueue = resolve; });
  const job = prior
    .then(() => execute(key, session, tokenizer))
    .catch((error) => {
      lastError = String((error as Error)?.message || error || 'Unknown context-footprint failure').slice(0, 2000);
      throw error;
    })
    .finally(() => {
      queued = Math.max(0, queued - 1);
      releaseQueue();
      if (inFlightBySession.get(key) === job) inFlightBySession.delete(key);
    });
  inFlightBySession.set(key, job);
  return job;
}

export function getContextFootprintWorkerStatus(): ContextFootprintWorkerStatus {
  return {
    isolation: 'child_process',
    queued,
    running,
    maxQueued,
    workerHeapMb: contextWorkerHeapMb,
    maxSnapshotBytes: contextSnapshotMaxBytes,
    lastStartedAt,
    lastCompletedAt,
    lastError: lastError || undefined,
    broker: broker.getStatus(),
  };
}

export async function shutdownContextFootprintWorker(): Promise<void> {
  shuttingDown = true;
  await queueTail.catch(() => undefined);
  await broker.shutdown(1_500).catch(() => undefined);
}
