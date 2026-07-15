import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const modulePath = path.join(root, 'dist', 'gateway', 'turn-workers', 'index.js');
const workerEntry = path.join(root, 'dist', 'gateway', 'turn-workers', 'synthetic-turn-worker.js');

if (!fs.existsSync(modulePath) || !fs.existsSync(workerEntry)) {
  throw new Error('Turn-worker regression requires compiled output. Run `npm run build:backend` first.');
}

const {
  TurnWorkerPool,
  TurnWorkerProcess,
  TurnWorkerProcessError,
  TurnWorkerProtocolError,
} = await import(pathToFileURL(modulePath).href);

function withDeadline(promise, label, timeoutMs = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function processOptions(name, overrides = {}) {
  return {
    name,
    entryPath: workerEntry,
    cwd: root,
    startupTimeoutMs: 5_000,
    heartbeatIntervalMs: 100,
    heartbeatCheckIntervalMs: 100,
    heartbeatTimeoutMs: 2_000,
    cancelGraceMs: 500,
    steerAckTimeoutMs: 2_000,
    ...overrides,
  };
}

async function expectReject(promise, predicate, label) {
  try {
    await withDeadline(promise, label);
  } catch (error) {
    assert.ok(predicate(error), `${label} rejected with unexpected error: ${error?.stack || error}`);
    return error;
  }
  assert.fail(`${label} unexpectedly resolved.`);
}

async function testStreamingRpcCheckpointSteeringAndCancellation() {
  const worker = new TurnWorkerProcess(processOptions('transport-regression'));
  try {
    const events = [];
    const checkpoints = [];
    const rpcCalls = [];
    const stream = await worker.runJob({
      jobId: 'stream-job',
      attempt: 1,
      input: { mode: 'stream', value: 'gateway-value' },
      leaseToken: 'lease-stream-1',
    }, {
      onEvent: (message) => events.push(message),
      onCheckpoint: (message) => checkpoints.push(message),
      onRpc: async (request) => {
        rpcCalls.push(request);
        assert.equal(request.method, 'echo');
        assert.equal(request.idempotencyKey, 'stream-job:1:echo');
        return { echoed: request.params.value };
      },
    });
    const started = await withDeadline(stream.started, 'stream start');
    const streamResult = await withDeadline(stream.result, 'stream result');
    assert.equal(started.pid, streamResult.pid);
    assert.deepEqual(events.map((event) => event.sequence), [1, 3]);
    assert.deepEqual(checkpoints.map((event) => event.sequence), [2]);
    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(streamResult.rpcResult, { echoed: 'gateway-value' });

    const steerEvents = [];
    const steer = await worker.runJob({
      jobId: 'steer-job',
      input: { mode: 'steer' },
    }, {
      onEvent: (message) => steerEvents.push(message.event),
    });
    await withDeadline(steer.started, 'steer start');
    const ack = await withDeadline(steer.steer({ instruction: 'continue carefully' }, 'steer-fixed-id'), 'steer ack');
    assert.equal(ack.accepted, true);
    assert.equal(ack.steerId, 'steer-fixed-id');
    const steerResult = await withDeadline(steer.result, 'steer result');
    assert.deepEqual(steerResult.steer.payload, { instruction: 'continue carefully' });
    assert.deepEqual(steerEvents.map((event) => event.kind), ['waiting_for_steer', 'steered']);

    const cancel = await worker.runJob({
      jobId: 'cancel-job',
      input: { mode: 'cancel' },
    });
    await withDeadline(cancel.started, 'cancel start');
    await cancel.cancel('regression cancellation');
    await expectReject(
      cancel.result,
      (error) => error instanceof TurnWorkerProcessError && error.code === 'TURN_CANCELLED',
      'cooperative cancellation',
    );
    assert.equal(worker.getStatus().state, 'ready');

    let rpcSignal;
    let rpcStartedResolve;
    const rpcStarted = new Promise((resolve) => { rpcStartedResolve = resolve; });
    const rpcCancel = await worker.runJob({
      jobId: 'rpc-cancel-job',
      input: { mode: 'rpc_cancel' },
    }, {
      onRpc: ({ method, signal }) => {
        assert.equal(method, 'wait_for_cancel');
        rpcSignal = signal;
        rpcStartedResolve();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      },
    });
    await withDeadline(rpcCancel.started, 'RPC cancellation start');
    await withDeadline(rpcStarted, 'gateway RPC start');
    const cancellation = rpcCancel.cancel('cancel gateway RPC regression');
    assert.equal(rpcSignal?.aborted, true, 'gateway RPC signal must abort synchronously when cancellation starts');
    await cancellation;
    await expectReject(
      rpcCancel.result,
      (error) => error instanceof TurnWorkerProcessError && error.code === 'TURN_CANCELLED',
      'gateway RPC cancellation',
    );
    assert.equal(worker.getStatus().state, 'ready');
  } finally {
    await worker.shutdown();
  }
}

async function testBoundedPayloads() {
  const worker = new TurnWorkerProcess(processOptions('bounds-regression', {
    maxMessageBytes: 8 * 1024,
    maxPayloadBytes: 4 * 1024,
  }));
  try {
    await expectReject(
      worker.runJob({ jobId: 'oversize-input', input: { text: 'x'.repeat(12 * 1024) } }),
      (error) => error instanceof TurnWorkerProtocolError && /maximum is 8192|blob reference/i.test(error.message),
      'oversized gateway payload',
    );
    assert.equal(worker.getStatus().state, 'stopped', 'oversized input must fail before spawning');

    const malicious = await worker.runJob({
      jobId: 'oversize-output',
      input: { mode: 'oversize_output', oversizeChars: 32 * 1024 },
    });
    await expectReject(
      malicious.result,
      (error) => error instanceof TurnWorkerProtocolError && /maximum is 8192/i.test(error.message),
      'oversized child payload',
    );
  } finally {
    await worker.shutdown();
  }
}

async function testCrashRecoveryAndRecycling() {
  const recoveryPool = new TurnWorkerPool({
    ...processOptions('crash-pool'),
    name: 'crash-pool',
    maxWorkers: 1,
    maxQueuedJobs: 4,
    recycleAfterJobs: 50,
  });
  try {
    let crashingPid;
    const crashing = recoveryPool.submit({ jobId: 'crash-job', input: { mode: 'crash' } }, {
      onEvent: (message) => { crashingPid = message.event.pid; },
    });
    await expectReject(
      crashing.result,
      (error) => error instanceof TurnWorkerProcessError && error.code === 'TURN_WORKER_CRASHED',
      'worker crash',
    );
    const recovered = recoveryPool.submit({ jobId: 'after-crash', input: { mode: 'identity' } });
    const recoveredResult = await withDeadline(recovered.result, 'post-crash recovery');
    assert.ok(Number.isInteger(crashingPid));
    assert.notEqual(recoveredResult.pid, crashingPid, 'pool must replace a crashed process');
  } finally {
    await recoveryPool.shutdown();
  }

  const recyclingPool = new TurnWorkerPool({
    ...processOptions('recycle-pool'),
    name: 'recycle-pool',
    maxWorkers: 1,
    maxQueuedJobs: 4,
    recycleAfterJobs: 1,
  });
  try {
    const first = recyclingPool.submit({ jobId: 'recycle-one', input: { mode: 'identity' } });
    const firstResult = await withDeadline(first.result, 'first recyclable turn');
    const second = recyclingPool.submit({ jobId: 'recycle-two', input: { mode: 'identity' } });
    const secondResult = await withDeadline(second.result, 'second recyclable turn');
    assert.notEqual(secondResult.pid, firstResult.pid, 'worker must recycle after the configured job count');
    assert.equal(firstResult.jobsRun, 1);
    assert.equal(secondResult.jobsRun, 1, 'recycled process must have a clean module heap');
  } finally {
    await recyclingPool.shutdown();
  }
}

await testStreamingRpcCheckpointSteeringAndCancellation();
await testBoundedPayloads();
await testCrashRecoveryAndRecycling();

console.log('turn-worker transport regression: ok');
