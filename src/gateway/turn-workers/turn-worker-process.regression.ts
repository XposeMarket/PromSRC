import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { TurnWorkerProcess, TurnWorkerProcessError } from './turn-worker-process.js';

function workerEntryPath(): string {
  const source = path.join(__dirname, 'synthetic-turn-worker.ts');
  if (fs.existsSync(source)) return source;
  return path.join(__dirname, 'synthetic-turn-worker.js');
}

function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function main(): Promise<void> {
  const worker = new TurnWorkerProcess({
    name: 'gateway-rpc-cancel-regression',
    entryPath: workerEntryPath(),
    startupTimeoutMs: 20_000,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 5_000,
    cancelGraceMs: 1_000,
  });

  try {
    let rpcSignal: AbortSignal | undefined;
    let rpcStartedResolve!: () => void;
    const rpcStarted = new Promise<void>((resolve) => { rpcStartedResolve = resolve; });
    const handle = await worker.runJob({
      jobId: 'gateway-rpc-cancel-regression',
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

    await withDeadline(handle.started, 'worker start');
    await withDeadline(rpcStarted, 'gateway RPC start');
    const cancellation = handle.cancel('cancel gateway RPC regression');
    assert.equal(rpcSignal?.aborted, true, 'cancel must synchronously abort gateway-owned RPC work');
    await withDeadline(cancellation, 'cancellation delivery');
    await assert.rejects(
      withDeadline(handle.result, 'cancelled result'),
      (error: unknown) => error instanceof TurnWorkerProcessError && error.code === 'TURN_CANCELLED',
    );
    assert.equal(worker.getStatus().state, 'ready');

    const callbackContext = new AsyncLocalStorage<string>();
    for (const label of ['captured-turn-one', 'captured-turn-two']) {
      const observed: string[] = [];
      const scopedHandle = await callbackContext.run(label, () => worker.runJob({
        jobId: `async-context-${label}`,
        input: { mode: 'stream', value: label },
      }, {
        onStarted: () => { observed.push(String(callbackContext.getStore())); },
        onEvent: () => { observed.push(String(callbackContext.getStore())); },
        onCheckpoint: () => { observed.push(String(callbackContext.getStore())); },
        onRpc: ({ params }) => {
          observed.push(String(callbackContext.getStore()));
          return params;
        },
        onFinal: () => { observed.push(String(callbackContext.getStore())); },
      }));
      await withDeadline(scopedHandle.result, `${label} result`);
      assert.ok(observed.length >= 5, `${label} should exercise every reusable-child callback class`);
      assert.deepEqual(
        new Set(observed),
        new Set([label]),
        'every callback must re-enter the async-local context captured for its own submitted job',
      );
    }

    const cancelledBeforeFinal = await worker.runJob({
      jobId: 'cancel-final-race-regression',
      input: { mode: 'delay', delayMs: 40 },
    });
    await withDeadline(cancelledBeforeFinal.started, 'cancel/final race start');
    const cancellationError = new TurnWorkerProcessError('authoritative parent cancellation', {
      code: 'TURN_CANCELLED',
      jobId: cancelledBeforeFinal.jobId,
      attempt: cancelledBeforeFinal.attempt,
    });
    (worker as any).active.abortController.abort(cancellationError);
    await assert.rejects(
      withDeadline(cancelledBeforeFinal.result, 'cancel/final race result'),
      (error: unknown) => error === cancellationError,
      'a child final arriving after authoritative parent cancellation must not resolve success',
    );
  } finally {
    await worker.shutdown().catch(() => {});
  }

  const stuckSendWorker = new TurnWorkerProcess({
    name: 'shutdown-stuck-ipc-regression',
    entryPath: workerEntryPath(),
    startupTimeoutMs: 20_000,
    heartbeatIntervalMs: 100,
    heartbeatTimeoutMs: 5_000,
  });
  const running = await stuckSendWorker.runJob({
    jobId: 'shutdown-stuck-ipc-regression',
    input: { mode: 'delay', delayMs: 10_000 },
  });
  await withDeadline(running.started, 'stuck IPC worker start');
  (stuckSendWorker as any).send = () => new Promise<void>(() => {});
  const shutdownStartedAt = Date.now();
  await withDeadline(stuckSendWorker.shutdown(100), 'shutdown with stuck IPC send', 2_500);
  assert.ok(Date.now() - shutdownStartedAt < 2_000, 'shutdown deadline must be armed before an IPC send can hang');
  await assert.rejects(running.result);
}

main().then(() => {
  console.log('turn-worker gateway RPC cancellation regression: ok');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
