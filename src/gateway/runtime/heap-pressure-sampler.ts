/**
 * Gateway heap-pressure sampler (OOM evidence).
 *
 * Every 60 s (unref'd interval) it compares heapUsed with 60% of v8 heap_size_limit. When
 * over the threshold it appends one NDJSON record to <configDir>/gateway-heap-pressure.ndjson:
 * timestamp, pid, heap statistics, per-space usage, process.memoryUsage(), and the active
 * runtime ids/kinds from <configDir>/runtimes/active-runtimes.json (best effort).
 * The file rotates to <name>.1 once it exceeds 5 MB (one generation kept).
 * Disable with PROMETHEUS_GATEWAY_HEAP_SAMPLER=0.
 */
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { getConfig } from '../../config/config';
import { pruneGatewayHeapSnapshots } from './gateway-node-flags';

export const HEAP_PRESSURE_INTERVAL_MS = 60_000;
export const HEAP_PRESSURE_RATIO = 0.6;
export const HEAP_PRESSURE_MAX_BYTES = 5 * 1024 * 1024;
export const HEAP_PRESSURE_FILE_NAME = 'gateway-heap-pressure.ndjson';

export interface HeapPressureOptions {
  configDir?: string;
  intervalMs?: number;
  ratio?: number;
  maxBytes?: number;
  now?: () => number;
}

export interface HeapPressureRecord {
  timestamp: string;
  pid: number;
  ratio: number;
  heapUsedRatio: number;
  heap: v8.HeapInfo;
  heapSpaces: Array<{ name: string; used: number; size: number; available: number }>;
  memory: NodeJS.MemoryUsage;
  runtimes: Array<{ id: string; kind: string }>;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function isHeapPressureSamplerDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROMETHEUS_GATEWAY_HEAP_SAMPLER === '0';
}

function resolveConfigDir(opts: HeapPressureOptions): string {
  return opts.configDir ?? getConfig().getConfigDir();
}

function readActiveRuntimes(configDir: string): Array<{ id: string; kind: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, 'runtimes', 'active-runtimes.json'), 'utf-8'));
    const runtimes = Object.values((parsed?.runtimes ?? {}) as Record<string, { id?: unknown; kind?: unknown }>);
    return runtimes.slice(0, 50).map((runtime) => ({
      id: String(runtime?.id ?? ''),
      kind: String(runtime?.kind ?? ''),
    }));
  } catch {
    return [];
  }
}

function appendWithRotation(file: string, line: string, maxBytes: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch {
    // Missing file: nothing to rotate.
  }
  fs.appendFileSync(file, line, 'utf-8');
}

/** Writes one record when heap pressure is at or above the ratio. Returns the record or null. */
export function sampleHeapPressureOnce(opts: HeapPressureOptions = {}): HeapPressureRecord | null {
  const ratio = opts.ratio ?? HEAP_PRESSURE_RATIO;
  const heap = v8.getHeapStatistics();
  const memory = process.memoryUsage();
  if (heap.heap_size_limit <= 0 || memory.heapUsed < ratio * heap.heap_size_limit) return null;

  const configDir = resolveConfigDir(opts);
  const now = (opts.now ?? Date.now)();
  const record: HeapPressureRecord = {
    timestamp: new Date(now).toISOString(),
    pid: process.pid,
    ratio,
    heapUsedRatio: Math.round((memory.heapUsed / heap.heap_size_limit) * 1000) / 1000,
    heap,
    heapSpaces: v8.getHeapSpaceStatistics().map((space) => ({
      name: space.space_name,
      used: space.space_used_size,
      size: space.space_size,
      available: space.space_available_size,
    })),
    memory,
    runtimes: readActiveRuntimes(configDir),
  };
  appendWithRotation(
    path.join(configDir, HEAP_PRESSURE_FILE_NAME),
    `${JSON.stringify(record)}\n`,
    opts.maxBytes ?? HEAP_PRESSURE_MAX_BYTES,
  );
  return record;
}

/** Starts the unref'd sampler. Returns false when disabled by env. Idempotent. */
export function startHeapPressureSampler(opts: HeapPressureOptions = {}): boolean {
  if (isHeapPressureSamplerDisabled()) return false;
  if (timer) return true;
  if (process.env.PROMETHEUS_GATEWAY_HEAPSNAPSHOT_NEAR_LIMIT === '1') {
    try {
      pruneGatewayHeapSnapshots(path.join(resolveConfigDir(opts), 'logs', 'heap'));
    } catch {
      // Best effort.
    }
  }
  timer = setInterval(() => {
    try {
      sampleHeapPressureOnce(opts);
    } catch (err: unknown) {
      console.warn('[HeapPressure] sample failed:', err instanceof Error ? err.message : err);
    }
  }, opts.intervalMs ?? HEAP_PRESSURE_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopHeapPressureSampler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
