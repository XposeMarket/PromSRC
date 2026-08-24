import { getHeapSpaceStatistics } from 'node:v8';
import type {
  RuntimeWorkerHeapSpaceSample,
  RuntimeWorkerResourceSample,
} from './runtime-worker-protocol.js';

export interface RuntimeWorkerResourceStatus extends RuntimeWorkerResourceSample {
  cpuPercent?: number;
  sampleAgeMs?: number;
}

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
const MIN_SAMPLE_INTERVAL_MS = 1_000;
const MAX_SAMPLE_INTERVAL_MS = 60_000;

function finiteNonNegative(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeHeapSpaces(): RuntimeWorkerHeapSpaceSample[] {
  try {
    return getHeapSpaceStatistics().map((space) => ({
      name: String(space.space_name || '').slice(0, 80),
      sizeBytes: finiteNonNegative(space.space_size),
      usedBytes: finiteNonNegative(space.space_used_size),
      availableBytes: finiteNonNegative(space.space_available_size),
      physicalBytes: finiteNonNegative(space.physical_space_size),
    }));
  } catch {
    return [];
  }
}

export function getRuntimeWorkerResourceSampleIntervalMs(env = process.env): number {
  const parsed = Number(env.PROMETHEUS_RUNTIME_WORKER_RESOURCE_SAMPLE_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_INTERVAL_MS;
  return Math.max(MIN_SAMPLE_INTERVAL_MS, Math.min(MAX_SAMPLE_INTERVAL_MS, Math.floor(parsed)));
}

export function sampleRuntimeWorkerResources(): RuntimeWorkerResourceSample {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    at: Date.now(),
    pid: process.pid,
    rssBytes: finiteNonNegative(memory.rss),
    heapTotalBytes: finiteNonNegative(memory.heapTotal),
    heapUsedBytes: finiteNonNegative(memory.heapUsed),
    externalBytes: finiteNonNegative(memory.external),
    arrayBuffersBytes: finiteNonNegative(memory.arrayBuffers),
    cpuUserMicros: finiteNonNegative(cpu.user),
    cpuSystemMicros: finiteNonNegative(cpu.system),
    heapSpaces: safeHeapSpaces(),
  };
}

export function deriveRuntimeWorkerResourceStatus(
  previous: RuntimeWorkerResourceStatus | undefined,
  sample: RuntimeWorkerResourceSample,
): RuntimeWorkerResourceStatus {
  let cpuPercent: number | undefined;
  if (previous && sample.at > previous.at) {
    const cpuMicros = Math.max(
      0,
      sample.cpuUserMicros + sample.cpuSystemMicros
        - previous.cpuUserMicros - previous.cpuSystemMicros,
    );
    const wallMicros = (sample.at - previous.at) * 1_000;
    cpuPercent = wallMicros > 0 ? Math.max(0, Math.min(100 * 128, (cpuMicros / wallMicros) * 100)) : undefined;
  }
  return {
    ...sample,
    ...(cpuPercent === undefined ? {} : { cpuPercent }),
  };
}

export function startRuntimeWorkerResourceHeartbeat(
  send: (message: { protocolVersion: 1; type: 'heartbeat'; pid: number; at: number; activeRequestId?: string; resourceSample: RuntimeWorkerResourceSample }) => void,
  getActiveRequestId: () => string | undefined,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const resourceSample = sampleRuntimeWorkerResources();
    try {
      send({
        protocolVersion: 1,
        type: 'heartbeat',
        pid: process.pid,
        at: resourceSample.at,
        activeRequestId: getActiveRequestId() || undefined,
        resourceSample,
      });
    } catch {}
  }, getRuntimeWorkerResourceSampleIntervalMs());
  timer.unref?.();
  return timer;
}
