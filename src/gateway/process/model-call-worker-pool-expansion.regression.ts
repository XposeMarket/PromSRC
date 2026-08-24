import assert from 'node:assert/strict';

process.env.PROMETHEUS_MODEL_CALL_WORKERS = '1';
process.env.PROMETHEUS_MODEL_WORKER_COUNT = '3';
process.env.PROMETHEUS_MODEL_WORKER_MAX_QUEUE = '4';
process.env.PROMETHEUS_MODEL_WORKER_TIMEOUT_MS = '5000';
process.env.PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS = '100';
process.env.PROMETHEUS_MODEL_WORKER_TEST_HOOKS = '1';

type TestRequest = import('./model-call-worker-protocol.js').ModelCallChatRequest;

function request(delayMs: number): TestRequest {
  return {
    operation: 'chat',
    providerId: '__model_worker_test__',
    model: 'synthetic-v1',
    messages: [{ role: 'user', content: 'expansion' }],
    options: { __testDelayMs: delayMs } as any,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for lazy model-pool expansion.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main(): Promise<void> {
  const {
    dispatchModelCallWorker,
    getModelCallWorkerPoolStatus,
    shutdownModelCallWorkerPool,
  } = await import('./model-call-worker-pool.js');
  try {
    const first = dispatchModelCallWorker(request(1_000));
    await waitFor(() => getModelCallWorkerPoolStatus().active === 1);
    const firstLive = getModelCallWorkerPoolStatus().slots.filter((slot) => slot.pid).length;
    assert.equal(firstLive, 1, 'a single request should start only one configured model slot');

    const concurrent = [
      dispatchModelCallWorker(request(1_200)),
      dispatchModelCallWorker(request(1_200)),
    ];
    await waitFor(() => getModelCallWorkerPoolStatus().active === 3);
    const expanded = getModelCallWorkerPoolStatus();
    assert.equal(expanded.slots.filter((slot) => slot.pid).length, 3, 'queued demand should expand to all needed slots');
    await Promise.all([first, ...concurrent]);
    console.log('model-call worker lazy expansion regression: ok');
  } finally {
    await shutdownModelCallWorkerPool();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
