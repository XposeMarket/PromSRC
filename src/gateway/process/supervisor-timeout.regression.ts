import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessRunStore } from './store';
import { ProcessSupervisor } from './supervisor';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-process-timeout-'));
  try {
    const childScript = path.join(root, 'child.cjs');
    const parentScript = path.join(root, 'parent.cjs');
    fs.writeFileSync(childScript, 'setTimeout(() => {}, 8000);\n');
    fs.writeFileSync(parentScript, `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [${JSON.stringify(childScript)}], {
  detached: true, cwd: ${JSON.stringify(os.tmpdir())},
  stdio: ['ignore', process.stdout, process.stderr], windowsHide: true,
});
child.unref();
`);
    const supervisor = new ProcessSupervisor(new ProcessRunStore(path.join(root, 'runs')));
    const started = Date.now();
    const run = await supervisor.spawn({
      command: `node "${parentScript}"`,
      cwd: root,
      mode: 'foreground',
      timeoutMs: 700,
    });
    const exit = await run.wait();
    assert.equal(exit.reason, 'overall_timeout');
    assert.ok(Date.now() - started < 5_500,
      'a timed-out shell must settle even when a detached child holds its output pipes open');
    assert.equal(supervisor.get(run.runId)?.state, 'exited');
    console.log('process supervisor timeout regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
