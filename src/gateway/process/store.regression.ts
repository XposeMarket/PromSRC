import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessRunStore } from './store';
import type { ProcessRunRecord } from './types';

async function main(): Promise<void> {
const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-process-store-retry-'));
try {
  const retryStore = new ProcessRunStore(retryRoot);
  const retryRecord = {
    runId: 'run_retry_test',
    command: 'echo ok',
    cwd: retryRoot,
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
    retryStore.writeRecord(retryRecord);
  } finally {
    (fs as any).renameSync = originalRenameSync;
  }
  assert.equal(attempts, 3);
  assert.equal(retryStore.loadRecord(retryRecord.runId)?.command, 'echo ok');
  assert.equal(fs.readdirSync(retryStore.recordsDir).some((name) => name.endsWith('.tmp')), false);
} finally {
  fs.rmSync(retryRoot, { recursive: true, force: true });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-process-store-'));
try {
  const recordsDir = path.join(root, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });
  const startedAt = new Date('2026-01-01T00:00:00Z').getTime();
  for (let index = 0; index < 1500; index++) {
    const record: ProcessRunRecord = {
      runId: `run_${index}`,
      command: 'echo test',
      cwd: root,
      mode: 'foreground',
      state: 'exited',
      startedAt: new Date(startedAt + index * 1000).toISOString(),
      updatedAt: new Date(startedAt + index * 1000).toISOString(),
      stdoutBytes: 0,
      stderrBytes: 0,
      outputPreview: '',
    };
    fs.writeFileSync(path.join(recordsDir, `${record.runId}.json`), JSON.stringify(record));
  }

  const store = new ProcessRunStore(root);
  let gatewayTicks = 0;
  const timer = setInterval(() => { gatewayTicks += 1; }, 2);
  const priming = store.prime();
  const updated = {
    ...store.loadRecord('run_1499')!,
    outputPreview: 'newer in-memory update',
  };
  store.writeRecord(updated);
  await priming;
  clearInterval(timer);

  assert.ok(gatewayTicks > 0, 'historical scan must yield to gateway callbacks');
  assert.equal(store.listRecords(1)[0]?.runId, 'run_1499');
  assert.equal(store.listRecords(1)[0]?.outputPreview, 'newer in-memory update');
  assert.equal(store.listRecords(500).length, 500);
  assert.equal(store.loadRecord('run_1')?.runId, 'run_1');
  console.log(`[process-store] indexed 1500 historical runs with ${gatewayTicks} gateway timer ticks`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
