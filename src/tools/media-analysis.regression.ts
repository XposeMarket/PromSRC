import assert from 'node:assert/strict';
import { runMediaProcess, type MediaAnalysisProgress } from './media-analysis.js';

async function verifiesStructuredProgress(): Promise<void> {
  const events: MediaAnalysisProgress[] = [];
  const payloads = [0, 1, 2, 3].map((current) => JSON.stringify({
    phase: 'extracting_frames',
    message: `Extracting frames: ${current} out of 3`,
    current,
    total: 3,
  }));
  const script = [
    ...payloads.map((payload) => `process.stderr.write('__PROMETHEUS_PROGRESS__' + ${JSON.stringify(payload)} + '\\n')`),
    `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: true }))})`,
  ].join(';');
  const result = await runMediaProcess({
    cmd: process.execPath,
    args: ['-e', script],
    timeoutMs: 5_000,
    onProgress: (event) => events.push(event),
  });
  assert.deepEqual(JSON.parse(result.stdout), { ok: true });
  assert.deepEqual(events.map((event) => event.current), [0, 1, 2, 3]);
  assert.equal(events.at(-1)?.message, 'Extracting frames: 3 out of 3');
}

async function verifiesAbortStopsAnalyzer(): Promise<void> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const run = runMediaProcess({
    cmd: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(run, /canceled by user/i);
  assert.ok(Date.now() - startedAt < 2_000, 'abort should stop analysis promptly');
}

async function main(): Promise<void> {
  await verifiesStructuredProgress();
  await verifiesAbortStopsAnalyzer();
  console.log('media-analysis regression checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
