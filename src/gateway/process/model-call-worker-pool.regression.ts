import assert from 'node:assert/strict';

process.env.PROMETHEUS_MODEL_CALL_WORKERS = '1';
process.env.PROMETHEUS_MODEL_WORKER_COUNT = '1';
process.env.PROMETHEUS_MODEL_WORKER_MAX_QUEUE = '1';
process.env.PROMETHEUS_MODEL_WORKER_MAX_MESSAGE_BYTES = String(256 * 1024);
process.env.PROMETHEUS_MODEL_WORKER_TIMEOUT_MS = '5000';
process.env.PROMETHEUS_MODEL_WORKER_RECYCLE_JOBS = '100';
process.env.PROMETHEUS_MODEL_WORKER_CANCEL_GRACE_MS = '200';
process.env.PROMETHEUS_MODEL_WORKER_TEST_HOOKS = '1';

type TestRequest = import('./model-call-worker-protocol.js').ModelCallChatRequest;

function request(testOptions: Record<string, unknown> = {}): TestRequest {
  return {
    operation: 'chat',
    providerId: '__model_worker_test__',
    model: 'synthetic-v1',
    messages: [{ role: 'user', content: 'roundtrip-message' }],
    options: {
      tools: [{
        type: 'function',
        function: {
          name: 'roundtrip_tool',
          description: 'schema survives IPC',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      }],
      ...testOptions,
    } as any,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for model-worker state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function main(): Promise<void> {
  const {
    dispatchModelCallWorker,
    getModelCallWorkerPoolStatus,
    shutdownModelCallWorkerPool,
    ModelCallWorkerError,
  } = await import('./model-call-worker-pool.js');
  try {
  const observed: string[] = [];
  const beforeStream = getModelCallWorkerPoolStatus();
  const roundtrip = await dispatchModelCallWorker(request(), {
    onToken: (value) => observed.push(`token:${value}`),
    onThinking: (value) => observed.push(`thinking:${value}`),
    onReasoningSummary: (value) => observed.push(`summary:${value}`),
    onModelEvent: (value) => observed.push(`event:${value.type}`),
  }) as any;
  const decoded = JSON.parse(roundtrip.message.content);
  assert.equal(decoded.lastMessage, 'roundtrip-message');
  assert.equal(decoded.tools[0].function.name, 'roundtrip_tool');
  assert.equal(roundtrip.message.tool_calls[0].function.name, 'roundtrip_tool');
  assert.deepEqual(observed, [
    'token:a',
    'thinking:b',
    'summary:c',
    'event:provider_event',
  ]);
  const afterStream = getModelCallWorkerPoolStatus();
  assert.equal(afterStream.eventBatches - beforeStream.eventBatches, 1, 'immediate stream events should be batched');
  assert.equal(afterStream.streamEvents - beforeStream.streamEvents, 4);

  const first = dispatchModelCallWorker(request({ __testDelayMs: 2_000 }) as any);
  await waitFor(() => getModelCallWorkerPoolStatus().providerStarted >= 2);
  const queuedController = new AbortController();
  const second = dispatchModelCallWorker(
    request({ __testDelayMs: 10 }) as any,
    { signal: queuedController.signal },
  );
  await assert.rejects(
    () => dispatchModelCallWorker(request() as any),
    (error: any) => error instanceof ModelCallWorkerError
      && error.code === 'WORKER_QUEUE_FULL'
      && error.safeToFallback === true
      && error.providerStarted === false,
  );
  // Queued cancellation must remove the request without disturbing the active
  // provider call.
  queuedController.abort(new Error('queued regression cancellation'));
  await assert.rejects(second, (error: any) => error?.name === 'AbortError');
  await first;

  const controller = new AbortController();
  const startedBeforeCancel = getModelCallWorkerPoolStatus().providerStarted;
  const afterRejectEvents: string[] = [];
  const cancelled = dispatchModelCallWorker(
    request({ __testDelayMs: 50, __testMode: 'ignore_cancel' }) as any,
    { signal: controller.signal, onToken: (value) => afterRejectEvents.push(value) },
  );
  await waitFor(() => getModelCallWorkerPoolStatus().providerStarted > startedBeforeCancel);
  controller.abort(new Error('active regression cancellation'));
  await assert.rejects(cancelled, (error: any) => error?.name === 'AbortError');
  await waitFor(() => getModelCallWorkerPoolStatus().active === 0, 7_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(afterRejectEvents, [], 'callbacks must stop after the parent promise rejects');

  const stubbornController = new AbortController();
  const beforeStubborn = getModelCallWorkerPoolStatus().providerStarted;
  const stubborn = dispatchModelCallWorker(
    request({ __testDelayMs: 2_000, __testMode: 'ignore_cancel' }) as any,
    { signal: stubbornController.signal },
  );
  await waitFor(() => getModelCallWorkerPoolStatus().providerStarted > beforeStubborn);
  stubbornController.abort(new Error('stubborn provider cancellation'));
  await assert.rejects(stubborn, (error: any) => error?.name === 'AbortError');
  await waitFor(() => getModelCallWorkerPoolStatus().active === 0, 2_000);

  await assert.rejects(
    () => dispatchModelCallWorker(request({ __testDelayMs: 2_000 }) as any, {}, 1_000),
    (error: any) => error instanceof ModelCallWorkerError
      && error.code === 'MODEL_CALL_TIMEOUT'
      && error.safeToFallback === false,
  );
  await waitFor(() => getModelCallWorkerPoolStatus().active === 0, 7_000);

  await assert.rejects(
    () => dispatchModelCallWorker(request({ __testMode: 'crash_after_provider' }) as any),
    (error: any) => error instanceof ModelCallWorkerError
      && error.code === 'WORKER_EXITED'
      && error.safeToFallback === false,
  );
  const replacement = await dispatchModelCallWorker(request() as any) as any;
  assert.equal(JSON.parse(replacement.message.content).lastMessage, 'roundtrip-message');

  const oversized = request();
  oversized.messages[0].content = 'x'.repeat(300 * 1024);
  await assert.rejects(
    () => dispatchModelCallWorker(oversized),
    (error: any) => error instanceof ModelCallWorkerError
      && error.code === 'IPC_REQUEST_TOO_LARGE'
      && error.safeToFallback === true,
  );

  const status = getModelCallWorkerPoolStatus();
  assert.equal(status.workers, 1);
  assert.ok(status.completed >= 3);
  assert.ok(status.timedOut >= 1);
  assert.ok(status.crashed >= 1);
  console.log('model-call worker pool regression: ok');
  } finally {
    await shutdownModelCallWorkerPool();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
