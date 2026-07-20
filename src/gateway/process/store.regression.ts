import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProcessRunStore } from './store';
import type { ProcessRunRecord } from './types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-process-store-'));
const store = new ProcessRunStore(root);
const record = {
  runId: 'run_retry_test',
  command: 'echo ok',
  cwd: root,
  mode: 'foreground',
  shell: 'powershell',
  shellCommand: 'echo ok',
  pty: false,
  state: 'running',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stdinOpen: false,
  stdoutBytes: 0,
  stderrBytes: 0,
  outputPreview: '',
  outputSeq: 0,
} as ProcessRunRecord;

const originalRenameSync = fs.renameSync;
let attempts = 0;
try {
  (fs as any).renameSync = (source: fs.PathLike, target: fs.PathLike) => {
    attempts++;
    if (attempts <= 2) {
      const error = new Error('simulated rename lock') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(source, target);
  };
  store.writeRecord(record);
} finally {
  (fs as any).renameSync = originalRenameSync;
}

assert.equal(attempts, 3);
assert.equal(store.loadRecord(record.runId)?.command, 'echo ok');
assert.equal(fs.readdirSync(store.recordsDir).some((name) => name.endsWith('.tmp')), false);
fs.rmSync(root, { recursive: true, force: true });
console.log('process store regression passed');
