import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

function measure<T>(fn: () => T): { values: number[]; result: T } {
  const values: number[] = [];
  let result!: T;
  for (let index = 0; index < 5; index += 1) {
    const startedAt = performance.now();
    result = fn();
    values.push(Number((performance.now() - startedAt).toFixed(2)));
  }
  return { values, result };
}

async function main(): Promise<void> {
  const appDataLogPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Prometheus', '.prometheus', 'model-usage.jsonl')
    : '';
  if (!process.env.PROMETHEUS_DATA_DIR && appDataLogPath && fs.existsSync(appDataLogPath)) {
    // The desktop gateway uses the legacy .prometheus layout under its app-data
    // root. Set this before loading the source modules so the benchmark reads
    // the same file as the live process.
    process.env.PROMETHEUS_DATA_DIR = path.dirname(path.dirname(appDataLogPath));
  }

  const { getConfig } = await import('../src/config/config');
  const usage = await import('../src/providers/model-usage');
  const configuredLogPath = path.join(getConfig().getConfigDir(), 'model-usage.jsonl');
  const logPath = [configuredLogPath, appDataLogPath].find((candidate) => candidate && fs.existsSync(candidate));
  if (!logPath) {
    throw new Error(`No model-usage.jsonl found at ${configuredLogPath}${appDataLogPath ? ` or ${appDataLogPath}` : ''}`);
  }
  const stats = fs.statSync(logPath);
  const sampleBytes = Math.min(64 * 1024, stats.size);
  const handle = fs.openSync(logPath, 'r');
  const buffer = Buffer.alloc(sampleBytes);
  fs.readSync(handle, buffer, 0, sampleBytes, stats.size - sampleBytes);
  fs.closeSync(handle);

  const tail = buffer.toString('utf8');
  const end = tail.endsWith('\n') ? tail.length - 1 : tail.length;
  const lineStartInTail = Math.max(0, tail.lastIndexOf('\n', end - 1) + 1);
  const lastLine = tail.slice(lineStartInTail, end);
  const lastEvent = JSON.parse(lastLine) as { sessionId?: string };
  const sessionId = String(lastEvent.sessionId || '').trim();
  const lastLineOffset = stats.size - sampleBytes + lineStartInTail;

  const historical = measure(() => usage.readModelUsageEventsForSession(sessionId));
  const cursorCapture = measure(() => usage.captureModelUsageLogCursor());
  const incremental = measure(() => usage.readModelUsageEventsSince(
    { filePath: logPath, byteOffset: lastLineOffset },
    sessionId,
  ));

  console.log(JSON.stringify({
    benchmark: 'model-usage-cursor',
    logPath,
    logBytes: stats.size,
    sessionId,
    matchingRows: {
      historical: historical.result.length,
      incremental: incremental.result.length,
    },
    historicalFullScanMs: historical.values,
    cursorCaptureMs: cursorCapture.values,
    oneRowTailReadMs: incremental.values,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[model-usage benchmark] ${String(error?.message || error)}`);
  process.exitCode = 1;
});
