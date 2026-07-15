import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../config/config.js';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from './process/runtime-worker-broker.js';
import { writeJsonAtomicCooperatively } from './storage/cooperative-json.js';
import type { ToolObservation } from './tool-observations.js';

export interface AsyncToolObservationPersistenceResult {
  observations: ToolObservation[];
  toolLogText: string;
}

interface Slot {
  broker: RuntimeWorkerBroker;
  tail: Promise<void>;
  queued: number;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const observationWorkerHeapMb = boundedNumber(process.env.PROMETHEUS_TOOL_OBSERVATION_HEAP_MB, 512, 256, 1_024);
const observationSnapshotMaxBytes = boundedNumber(
  Number(process.env.PROMETHEUS_TOOL_OBSERVATION_MAX_SNAPSHOT_MB) * 1024 * 1024,
  192 * 1024 * 1024,
  16 * 1024 * 1024,
  512 * 1024 * 1024,
);
const workerCount = Math.max(1, Math.min(4, Number(process.env.PROMETHEUS_TOOL_OBSERVATION_WORKERS || 2)));
const slots: Slot[] = Array.from({ length: workerCount }, (_value, index) => ({
  broker: new RuntimeWorkerBroker({
    name: `tool-observation-persistence-${index + 1}`,
    entryBasename: 'tool-observation-persistence-worker',
    startupTimeoutMs: 30_000,
    defaultJobTimeoutMs: 5 * 60_000,
    maxOldSpaceMb: observationWorkerHeapMb,
    env: { PROMETHEUS_TOOL_OBSERVATION_MAX_SNAPSHOT_BYTES: String(observationSnapshotMaxBytes) },
  }),
  tail: Promise.resolve(),
  queued: 0,
}));
const maxQueued = Math.max(workerCount, Math.min(64, Number(process.env.PROMETHEUS_TOOL_OBSERVATION_QUEUE || 24)));
let shuttingDown = false;
let running = 0;
let lastStartedAt: number | undefined;
let lastCompletedAt: number | undefined;
let lastError = '';

async function execute(slot: Slot, sessionId: string, turnId: string, toolResults: any[]): Promise<AsyncToolObservationPersistenceResult> {
  const configDir = getConfig().getConfigDir();
  const snapshotDir = path.join(configDir, 'runtime', 'tool-observations');
  const snapshotPath = path.join(snapshotDir, `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.json`);
  await writeJsonAtomicCooperatively(snapshotPath, toolResults, {
    spaces: 0,
    mode: 0o600,
    maxBytes: observationSnapshotMaxBytes,
  });
  running += 1;
  lastStartedAt = Date.now();
  try {
    return await slot.broker.run<AsyncToolObservationPersistenceResult>('persist_tool_observations', {
      configDir,
      snapshotPath,
      sessionId,
      turnId,
    });
  } finally {
    running = Math.max(0, running - 1);
    lastCompletedAt = Date.now();
    await fs.promises.unlink(snapshotPath).catch(() => undefined);
  }
}

export function persistToolResultsAsObservationsInWorker(
  sessionId: string,
  turnId: string,
  toolResults: any[],
): Promise<AsyncToolObservationPersistenceResult> {
  if (shuttingDown) return Promise.reject(new Error('Tool-observation persistence is shutting down.'));
  const queuedTotal = slots.reduce((sum, slot) => sum + slot.queued, 0);
  if (queuedTotal >= maxQueued) return Promise.reject(new Error('Tool-observation persistence queue is full.'));
  const slot = slots.reduce((best, current) => current.queued < best.queued ? current : best, slots[0]);
  slot.queued += 1;
  const job = slot.tail.catch(() => undefined)
    .then(() => execute(slot, sessionId, turnId, toolResults))
    .catch((error) => {
      lastError = String((error as Error)?.message || error || 'Unknown tool-observation persistence failure').slice(0, 2000);
      throw error;
    })
    .finally(() => { slot.queued = Math.max(0, slot.queued - 1); });
  slot.tail = job.then(() => undefined, () => undefined);
  return job;
}

export function getToolObservationPersistenceStatus(): {
  isolation: 'child_process_pool';
  maxWorkers: number;
  workerHeapMb: number;
  maxSnapshotBytes: number;
  queued: number;
  running: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastError?: string;
  workers: RuntimeWorkerBrokerStatus[];
} {
  return {
    isolation: 'child_process_pool',
    maxWorkers: slots.length,
    workerHeapMb: observationWorkerHeapMb,
    maxSnapshotBytes: observationSnapshotMaxBytes,
    queued: slots.reduce((sum, slot) => sum + slot.queued, 0),
    running,
    lastStartedAt,
    lastCompletedAt,
    lastError: lastError || undefined,
    workers: slots.map((slot) => slot.broker.getStatus()),
  };
}

export async function shutdownToolObservationPersistence(): Promise<void> {
  shuttingDown = true;
  await Promise.allSettled(slots.map((slot) => slot.tail));
  await Promise.allSettled(slots.map((slot) => slot.broker.shutdown(1_500)));
}
