import assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TurnJobBlobStore } from '../turn-jobs/blob-store.js';
import type { JsonValue } from '../turn-jobs/types.js';
import type { TurnWorkerCheckpointMessage } from './protocol.js';
import {
  TURN_FILE_CHANGE_SCAN_VERSION,
  type StoredTurnFileChangeScanResult,
  type TurnFileChangeScanResultReference,
} from './turn-file-change-contract.js';
import {
  collectTurnFileChangesDirect,
  type TurnFileChanges,
} from './turn-file-change-collector.js';
import {
  collectTurnFileChangesIsolated,
  buildTurnFileChangeWorkerExecArgv,
  getTurnFileChangeWorkerPoolStatus,
  shutdownTurnFileChangeWorkerPool,
} from './turn-file-change-dispatcher.js';
import { TurnWorkerPool } from './turn-worker-pool.js';

function workerEntryPath(): string {
  const source = path.join(__dirname, 'turn-file-change-worker.ts');
  if (fs.existsSync(source)) return source;
  return path.join(__dirname, 'turn-file-change-worker.js');
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, windowsHide: true, stdio: 'ignore' });
}

function withoutTimestamp(value: TurnFileChanges | undefined): Omit<TurnFileChanges, 'generatedAt'> | undefined {
  if (!value) return undefined;
  const { generatedAt: _generatedAt, ...rest } = value;
  return JSON.parse(JSON.stringify(rest));
}

async function main(): Promise<void> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-file-change-worker-'));
  const workspacePath = path.join(temporaryRoot, 'workspace');
  const blobRoot = path.join(temporaryRoot, 'blobs');
  fs.mkdirSync(workspacePath, { recursive: true });
  git(workspacePath, 'init');
  git(workspacePath, 'config', 'user.email', 'regression@prometheus.local');
  git(workspacePath, 'config', 'user.name', 'Prometheus Regression');
  fs.writeFileSync(path.join(workspacePath, 'tracked.txt'), 'before\n', 'utf8');
  git(workspacePath, 'add', 'tracked.txt');
  git(workspacePath, 'commit', '-m', 'initial');
  fs.writeFileSync(path.join(workspacePath, 'tracked.txt'), 'before\nafter\n', 'utf8');
  fs.writeFileSync(path.join(workspacePath, 'added.txt'), 'new file\n', 'utf8');

  const toolResults = [
    { name: 'write_file', args: { path: 'tracked.txt' }, result: 'updated', error: false },
    { name: 'create_file', args: { path: 'added.txt' }, result: 'created', error: false },
  ];
  const direct = await collectTurnFileChangesDirect(toolResults, workspacePath);
  assert.ok(direct);
  assert.equal(direct.summary.fileCount, 2);
  const lazyPoolStatus = getTurnFileChangeWorkerPoolStatus();
  assert.ok(lazyPoolStatus.maxWorkers >= 1 && lazyPoolStatus.maxWorkers <= 2);
  assert.ok(lazyPoolStatus.workerOldSpaceMb >= 128 && lazyPoolStatus.workerOldSpaceMb <= 1_024);

  const blobs = new TurnJobBlobStore(blobRoot);
  const request = blobs.putJson({
    version: TURN_FILE_CHANGE_SCAN_VERSION,
    workspacePath,
    toolResults,
  } as unknown as JsonValue);
  const checkpoints: TurnWorkerCheckpointMessage[] = [];
  const workerPool = new TurnWorkerPool({
    name: 'file-change-regression',
    entryPath: workerEntryPath(),
    maxWorkers: 2,
    maxQueuedJobs: 4,
    recycleAfterJobs: 25,
    execArgv: buildTurnFileChangeWorkerExecArgv(),
    startupTimeoutMs: 20_000,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 5_000,
    cancelGraceMs: 1_000,
  });

  try {
    assert.ok(buildTurnFileChangeWorkerExecArgv().some((argument) => /^--max-old-space-size=/.test(argument)));
    const first = workerPool.submit<TurnFileChangeScanResultReference>({
      jobId: 'file-change-regression-1',
      attempt: 1,
      input: { blobRoot, requestRef: request.ref },
    }, {
      onCheckpoint: (message) => { checkpoints.push(message); },
    });
    const second = workerPool.submit<TurnFileChangeScanResultReference>({
      jobId: 'file-change-regression-2',
      attempt: 1,
      input: { blobRoot, requestRef: request.ref },
    });
    const [firstStarted, secondStarted] = await Promise.all([first.started, second.started]);
    const [firstReference] = await Promise.all([first.result, second.result]);
    assert.notEqual(firstStarted.pid, process.pid, 'file-change scan must execute outside the gateway process');
    assert.notEqual(secondStarted.pid, process.pid, 'parallel file-change scan must execute outside the gateway process');
    assert.notEqual(firstStarted.pid, secondStarted.pid, 'two finishing threads must be able to scan in separate child processes');
    assert.match(firstReference.resultRef, /^turnblob:sha256:[a-f0-9]{64}$/);
    assert.equal(firstReference.fileCount, 2);
    assert.ok(JSON.stringify(firstReference).length < 1_024, 'terminal IPC must contain only bounded metadata');
    const firstStored = blobs.getJson<StoredTurnFileChangeScanResult>(firstReference.resultRef);
    assert.deepEqual(withoutTimestamp(firstStored.changes || undefined), withoutTimestamp(direct));

    const third = workerPool.submit<TurnFileChangeScanResultReference>({
      jobId: 'file-change-regression-3',
      attempt: 1,
      input: { blobRoot, requestRef: request.ref },
    });
    const thirdStarted = await third.started;
    await third.result;
    assert.ok(
      thirdStarted.pid === firstStarted.pid || thirdStarted.pid === secondStarted.pid,
      'healthy file-change children should be reusable',
    );
    assert.equal(checkpoints.length, 2);
    assert.equal((checkpoints[0].checkpoint as any).kind, 'turn_file_change_scan_start');
    assert.equal((checkpoints[1].checkpoint as any).kind, 'turn_file_change_scan_end');

    const previousDisable = process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS;
    process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS = '1';
    try {
      const diagnosticDirectResult = await collectTurnFileChangesIsolated(toolResults, workspacePath);
      assert.deepEqual(withoutTimestamp(diagnosticDirectResult), withoutTimestamp(direct));
    } finally {
      if (previousDisable === undefined) delete process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS;
      else process.env.PROMETHEUS_DISABLE_FILE_CHANGE_WORKERS = previousDisable;
    }

    assert.equal(await collectTurnFileChangesDirect([{ name: 'web_search', args: {} }], workspacePath), undefined);
  } finally {
    await workerPool.shutdown().catch(() => {});
    await shutdownTurnFileChangeWorkerPool().catch(() => {});
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('turn file-change worker regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
