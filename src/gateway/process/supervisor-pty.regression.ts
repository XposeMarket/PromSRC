import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pty from 'node-pty';
import { ProcessRunStore } from './store';
import { ProcessSupervisor } from './supervisor';

async function main(): Promise<void> {
  assert.equal(typeof pty.spawn, 'function', 'node-pty must expose spawn in this runtime');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-pty-regression-'));
  const supervisor = new ProcessSupervisor(new ProcessRunStore(path.join(root, 'runs')));
  let runId = '';
  try {
    const run = await supervisor.spawn({
      command: process.platform === 'win32' ? 'powershell.exe -NoProfile' : 'bash',
      cwd: root,
      mode: 'background',
      pty: true,
      stdinMode: 'pipe',
      timeoutMs: 15_000,
      trackWorkspaceChanges: false,
    });
    runId = run.runId;
    assert.equal(run.record.pty, true);
    const markerCommand = process.platform === 'win32'
      ? "Write-Output ('PROM_' + 'PTY_READY')"
      : "printf '%s%s\\n' PROM_ PTY_READY";
    assert.equal(supervisor.write(run.runId, markerCommand, true), true);
    const deadline = Date.now() + 8_000;
    let output = '';
    while (Date.now() < deadline) {
      output = supervisor.log(run.runId).combined;
      if (output.includes('PROM_PTY_READY')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(output, /PROM_PTY_READY/, 'a persistent shell must accept submitted input');
    assert.equal(supervisor.write(run.runId, 'exit', true), true);
    const exit = await run.wait();
    assert.equal(exit.reason, 'exit');
    console.log('PTY persistent shell regression passed');
  } finally {
    if (runId) supervisor.cancel(runId);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
