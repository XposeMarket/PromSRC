import fs from 'fs';
import path from 'path';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import type { BuildActivityPackageOptions, BuiltActivityPackage } from './activity-package.js';

export interface BrainActivityWorkerStatus {
  enabled: boolean;
  isolation: 'child_process' | 'disabled';
  timeoutMs: number;
  shuttingDown: boolean;
  broker: RuntimeWorkerBrokerStatus;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

const enabled = String(process.env.PROMETHEUS_BRAIN_ACTIVITY_WORKER || '1').trim() !== '0';
const timeoutMs = envInt('PROMETHEUS_BRAIN_ACTIVITY_WORKER_TIMEOUT_MS', 15 * 60_000, 30_000, 30 * 60_000);
const startupTimeoutMs = envInt('PROMETHEUS_BRAIN_ACTIVITY_WORKER_STARTUP_TIMEOUT_MS', 30_000, 1_000, 120_000);
const maxMessageBytes = envInt('PROMETHEUS_BRAIN_ACTIVITY_MAX_MESSAGE_BYTES', 16 * 1024 * 1024, 256 * 1024, 64 * 1024 * 1024);
const broker = new RuntimeWorkerBroker({
  name: 'brain-activity',
  entryBasename: '../brain/activity-package-worker',
  maxMessageBytes,
  startupTimeoutMs,
  defaultJobTimeoutMs: timeoutMs,
});

interface ActivityPackageResultReference {
  kind: 'activity_package_reference';
  packagePath?: string;
  resultPath?: string;
  continuationPaths: string[];
  metricsPath?: string;
}

async function readWorkerResult(reference: ActivityPackageResultReference): Promise<BuiltActivityPackage> {
  if (!reference || reference.kind !== 'activity_package_reference') {
    throw new Error('Brain activity worker returned an invalid package reference.');
  }
  if (reference.packagePath) {
    const packageText = await fs.promises.readFile(reference.packagePath, 'utf8');
    return {
      package: JSON.parse(packageText),
      packagePath: reference.packagePath,
      continuationPaths: reference.continuationPaths,
      metricsPath: reference.metricsPath,
    };
  }
  if (reference.resultPath) {
    const resultText = await fs.promises.readFile(reference.resultPath, 'utf8');
    try {
      return JSON.parse(resultText) as BuiltActivityPackage;
    } finally {
      try { await fs.promises.rm(reference.resultPath, { force: true }); } catch { /* best effort */ }
      try { await fs.promises.rm(path.dirname(reference.resultPath), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  throw new Error('Brain activity worker returned no package reference path.');
}
let shuttingDown = false;

function workerDisabledError(): Error {
  return new Error('Brain activity worker is disabled; refusing to run the activity scan in the gateway process.');
}

export async function buildThoughtActivityPackageIsolated(
  options: BuildActivityPackageOptions,
  abortSignal?: { aborted: boolean },
): Promise<BuiltActivityPackage> {
  if (!enabled) throw workerDisabledError();
  if (shuttingDown) throw new Error('Brain activity worker is shutting down.');
  if (abortSignal?.aborted) {
    const error = new Error('Brain activity package assembly was cancelled.');
    error.name = 'AbortError';
    throw error;
  }

  let abortPoll: NodeJS.Timeout | null = null;
  if (abortSignal) {
    abortPoll = setInterval(() => {
      if (abortSignal.aborted) broker.forceKill();
    }, 100);
    abortPoll.unref?.();
  }
  try {
    const reference = await broker.run<ActivityPackageResultReference>(
      'build_thought_activity_package',
      options,
      timeoutMs,
    );
    if (abortSignal?.aborted) {
      const error = new Error('Brain activity package assembly was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    return await readWorkerResult(reference);
  } finally {
    if (abortPoll) clearInterval(abortPoll);
  }
}


export async function warmBrainActivityWorker(): Promise<void> {
  if (!enabled || shuttingDown) return;
  await broker.warmup();
}

export function getBrainActivityWorkerStatus(): BrainActivityWorkerStatus {
  return {
    enabled,
    isolation: enabled ? 'child_process' : 'disabled',
    timeoutMs,
    shuttingDown,
    broker: broker.getStatus(),
  };
}

export async function shutdownBrainActivityWorker(): Promise<void> {
  shuttingDown = true;
  await broker.shutdown(1000);
}
