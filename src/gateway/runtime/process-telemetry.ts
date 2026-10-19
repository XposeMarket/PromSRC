import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

export const MEMORY_LOG_INTERVAL_MS = 60_000;
export const HEAP_WARNING_RATIO = 0.85;
const MAX_LOG_BYTES = 256 * 1024;
const marker = Symbol.for('prometheus.gatewayProcessTelemetryInstalled');
const markedProcess = process as NodeJS.Process & { [marker]?: boolean };

export interface ProcessSample {
  timestamp: string;
  pid: number;
  uptimeSeconds: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  heapLimit: number;
  heapPressure: boolean;
  eventLoopDelayMs: { mean: number; max: number; p99: number };
}

export function isHeapPressure(heapUsed: number, heapLimit: number): boolean {
  return heapLimit > 0 && heapUsed >= heapLimit * HEAP_WARNING_RATIO;
}

export function createSampleBuffer(capacity = 60) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid telemetry capacity');
  const samples: ProcessSample[] = [];
  let cursor = 0;
  return {
    push(sample: ProcessSample) {
      if (samples.length < capacity) samples.push(sample);
      else samples[cursor] = sample;
      cursor = (cursor + 1) % capacity;
    },
    latest: () => samples.length ? samples[(cursor + samples.length - 1) % samples.length] : null,
    values: () => samples.length < capacity ? samples.slice() : [...samples.slice(cursor), ...samples.slice(0, cursor)],
  };
}

export function telemetryLogDirectory(): string {
  const runtime = process.env.PROMETHEUS_RUNTIME_DIR?.trim();
  return runtime ? path.join(runtime, 'logs') : path.join(
    process.env.PROMETHEUS_DATA_DIR?.trim() || os.homedir(), '.prometheus', 'logs');
}

export function createExitRecord(reason: string, sample: ProcessSample | null, details: Record<string, unknown> = {}) {
  return { ...details, type: 'exit', timestamp: new Date().toISOString(), pid: process.pid, reason, lastSample: sample };
}

const buffer = createSampleBuffer();
export function getProcessTelemetrySnapshot(): ProcessSample | null { return buffer.latest(); }

/** Best effort only: no synchronous filesystem work on the sampling/hot path. */
export function installProcessTelemetry(): void {
  if (markedProcess[marker]) return;
  markedProcess[marker] = true;
  const directory = telemetryLogDirectory();
  const logPath = path.join(directory, 'gateway-process-telemetry.ndjson');
  const latestPath = path.join(directory, 'gateway-process-telemetry-last.json');
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let pending = false;
  let exitReason = 'natural_exit';
  let exitDetails: Record<string, unknown> = {};
  let lastWarning = -Infinity;

  const sample = (): ProcessSample => {
    const memory = process.memoryUsage();
    const heapLimit = getHeapStatistics().heap_size_limit;
    const millis = (value: number) => Number.isFinite(value) ? value / 1e6 : 0;
    const result: ProcessSample = {
      timestamp: new Date().toISOString(), pid: process.pid, uptimeSeconds: process.uptime(),
      rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external,
      heapLimit, heapPressure: isHeapPressure(memory.heapUsed, heapLimit),
      eventLoopDelayMs: { mean: millis(delay.mean), max: millis(delay.max), p99: millis(delay.percentile(99)) },
    };
    delay.reset();
    buffer.push(result);
    return result;
  };

  const persistSample = async (current: ProcessSample) => {
    if (pending) return; // A slow disk must not accumulate an unbounded promise queue.
    pending = true;
    try {
      await fs.promises.mkdir(directory, { recursive: true });
      const size = await fs.promises.stat(logPath).then(s => s.size, () => 0);
      if (size >= MAX_LOG_BYTES) {
        await fs.promises.rm(`${logPath}.1`, { force: true });
        await fs.promises.rename(logPath, `${logPath}.1`);
      }
      await fs.promises.appendFile(logPath, `${JSON.stringify({ type: 'sample', ...current })}\n`);
      const temporary = path.join(directory, `gateway-process-telemetry-${process.pid}.tmp`);
      await fs.promises.writeFile(temporary, JSON.stringify({ type: 'sample', ...current }));
      await fs.promises.rename(temporary, path.join(directory, 'gateway-process-telemetry-latest.json'));
    } catch { /* Diagnostics must not affect gateway liveness. */ }
    finally { pending = false; }
  };

  const finalRecord = (reason: string, details: Record<string, unknown> = {}) => {
    try {
      const record = createExitRecord(reason, buffer.latest(), { ...exitDetails, ...details });
      // Separate bounded file avoids races with an in-flight asynchronous log rotation.
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(latestPath, JSON.stringify(record));
    } catch { /* Best effort, including disk-full and read-only installs. */ }
  };
  const tick = () => {
    const current = sample();
    if (current.heapPressure && Date.now() - lastWarning >= MEMORY_LOG_INTERVAL_MS) {
      lastWarning = Date.now();
      try { console.warn(`[Gateway telemetry] heap pressure: ${current.heapUsed}/${current.heapLimit} bytes (>=85%)`); } catch {}
    }
    void persistSample(current);
  };
  tick();
  const memoryTimer = setInterval(tick, MEMORY_LOG_INTERVAL_MS);
  memoryTimer.unref();
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    exitReason = 'uncaughtException';
    exitDetails = { origin, error: String(error.stack || error.message).slice(0, 8192) };
    finalRecord(exitReason);
  });
  // exit-diagnostics already owns rejection policy; never change crash behavior here.
  process.on('unhandledRejection', reason => {
    finalRecord('unhandledRejection', { error: String(reason instanceof Error ? reason.stack || reason.message : reason).slice(0, 8192) });
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => { exitReason = signal; finalRecord(signal); });
  }
  process.on('beforeExit', code => finalRecord(exitReason === 'natural_exit' ? 'beforeExit' : exitReason, { code }));
  process.on('exit', code => {
    clearInterval(memoryTimer);
    delay.disable();
    finalRecord(exitReason, { code });
  });
}
