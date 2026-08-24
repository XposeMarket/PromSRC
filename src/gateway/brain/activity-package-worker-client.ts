import fs from 'node:fs';
import path from 'node:path';
import { RuntimeWorkerBroker, type RuntimeWorkerBrokerStatus } from '../process/runtime-worker-broker.js';
import type { BuildActivityPackageOptions, BuiltActivityPackage } from './activity-package.js';

interface ActivityPackageResultReference {
  kind: 'activity_package_reference';
  packagePath?: string;
  resultPath?: string;
  continuationPaths: string[];
  metricsPath?: string;
}

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
  oneShot: true,
  resourceSampleIntervalMs: envInt('PROMETHEUS_BRAIN_ACTIVITY_RESOURCE_SAMPLE_MS', 5_000, 1_000, 60_000),
});
let shuttingDown = false;

function workerDisabledError(): Error {
  return new Error('Brain activity worker is disabled; refusing to run the activity scan in the gateway process.');
}

async function readWorkerResult(reference: ActivityPackageResultReference): Promise<BuiltActivityPackage> {
  if (!reference || reference.kind !== 'activity_package_reference') {
    throw new Error('Brain activity worker returned an invalid result reference.');
  }

  const packagePath = String(reference.packagePath || '').trim();
  if (packagePath) {
    const packageFile = path.resolve(packagePath);
    const parsedPackage = JSON.parse(await fs.promises.readFile(packageFile, 'utf8'));
    if (!parsedPackage || typeof parsedPackage !== 'object') throw new Error('Brain activity package artifact was invalid.');
    return {
      package: parsedPackage,
      packagePath: packageFile,
      continuationPaths: Array.isArray(reference.continuationPaths) ? reference.continuationPaths : [],
      metricsPath: reference.metricsPath,
    } as BuiltActivityPackage;
  }

  const resultPath = String(reference.resultPath || '').trim();
  if (!resultPath) throw new Error('Brain activity worker returned neither a package nor a result path.');
  const resultFile = path.resolve(resultPath);
  const resultDir = path.dirname(resultFile);
  try {
    const built = JSON.parse(await fs.promises.readFile(resultFile, 'utf8')) as BuiltActivityPackage;
    if (!built || typeof built !== 'object' || !built.package) {
      throw new Error('Brain activity worker result artifact was invalid.');
    }
    return built;
  } finally {
    await fs.promises.rm(resultDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
    return readWorkerResult(reference);
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
