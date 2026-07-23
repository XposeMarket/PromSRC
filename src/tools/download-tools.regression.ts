import assert from 'node:assert/strict';
import { runYtDlpProcess, type DownloadMediaProgress } from './download-tools.js';

async function verifiesProgressStreaming(): Promise<void> {
  const progress: DownloadMediaProgress[] = [];
  const script = [
    "process.stdout.write('__PROMETHEUS_PROGRESS__| 42.0%|1.5MiB/s|00:08\\n')",
    "setTimeout(() => process.exit(0), 30)",
  ].join(';');
  const result = await runYtDlpProcess(
    { cmd: process.execPath, preArgs: [], label: 'test-node' },
    ['-e', script],
    { cwd: process.cwd(), env: process.env, onProgress: (event) => progress.push(event) },
  );
  assert.match(result.stdout, /PROMETHEUS_PROGRESS/);
  assert.equal(progress.some((event) => event.phase === 'downloading' && event.percent === '42.0%'), true);
}

async function verifiesAbortKillsTheRun(): Promise<void> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const run = runYtDlpProcess(
    { cmd: process.execPath, preArgs: [], label: 'test-node' },
    ['-e', 'setInterval(() => {}, 1000)'],
    { cwd: process.cwd(), env: process.env, signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(run, /canceled by user/i);
  assert.ok(Date.now() - startedAt < 2_000, 'abort should reject promptly instead of waiting for the tool timeout');
}

async function main(): Promise<void> {
  await verifiesProgressStreaming();
  await verifiesAbortKillsTheRun();
  console.log('download-tools regression checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
