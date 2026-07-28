import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function main(): Promise<void> {
  process.env.PROMETHEUS_CONTEXT_BUILD_WORKERS = '1';
  process.env.PROMETHEUS_CONTEXT_BUILD_WORKER_COUNT = '1';
  process.env.PROMETHEUS_CONTEXT_BUILD_WORKER_MAX_QUEUE = '1';
  process.env.PROMETHEUS_CONTEXT_BUILD_WORKER_TIMEOUT_MS = '5000';
  process.env.PROMETHEUS_CONTEXT_BUILD_WORKER_TEST_HOOKS = '1';
  process.env.PROMETHEUS_CONTEXT_BUILD_TEST_CPU_MS = '600';

  const {
    buildPersonalityContextIsolated,
    getContextBuildWorkerPoolStatus,
    shutdownContextBuildWorkerPool,
    warmContextBuildWorkerPool,
  } = await import('./context-build-worker-client');
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-context-pool-'));
  fs.mkdirSync(path.join(workspacePath, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'USER.md'), 'Pool user fixture.\n');
  fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), 'Pool soul fixture.\n');
  fs.writeFileSync(path.join(workspacePath, 'MEMORY.md'), 'Pool memory fixture.\n');
  const skillsManager = {
    buildTurnContext: () => '',
    getSkill: () => null,
  };
  const timingMarks: Array<{ label: string; extra?: Record<string, unknown> }> = [];
  const timing = { mark: (label: string, extra?: Record<string, unknown>) => { timingMarks.push({ label, extra }); return Date.now(); } } as any;
  const build = (messageText: string, signal?: AbortSignal) => buildPersonalityContextIsolated(
    'context_pool_regression',
    workspacePath,
    messageText,
    'background_task',
    1,
    skillsManager as any,
    () => new Map(),
    () => {},
    undefined,
    undefined,
    signal,
    timing,
  );

  try {
    await Promise.all([warmContextBuildWorkerPool(), warmContextBuildWorkerPool()]);
    assert.equal(getContextBuildWorkerPoolStatus().warmupState, 'ready');
    const slow = build('__PROMETHEUS_CONTEXT_TEST_CPU__');
    await new Promise((resolve) => setTimeout(resolve, 75));
    const controller = new AbortController();
    const cancelled = build('queued cancellation fixture', controller.signal).then(
      () => null,
      (error) => error as Error,
    );
    controller.abort();
    const slowResult = await slow;
    assert.ok(slowResult.includes('Pool soul fixture.'));
    assert.equal((await cancelled)?.name, 'AbortError');

    const afterCancellation = await build('replacement fixture');
    assert.ok(afterCancellation.includes('Pool soul fixture.'));
    const status = getContextBuildWorkerPoolStatus();
    assert.equal(status.workers, 1);
    assert.equal(status.queued, 0);
    assert.equal(status.active, 0);
    assert.ok(status.completed >= 2);
    assert.ok(status.cancelled >= 1);
    for (const label of [
      'personality_snapshot_capture_start',
      'personality_snapshot_capture_done',
      'context_worker_queue_wait_start',
      'context_worker_queue_wait_done',
      'context_worker_ready_wait_start',
      'context_worker_ready_wait_done',
      'context_worker_execution_start',
      'context_worker_execution_done',
      'personality_snapshot_finalize_start',
      'personality_snapshot_finalize_done',
    ]) {
      assert.ok(timingMarks.some((mark) => mark.label === label), `missing timing mark: ${label}`);
    }
    const queueDone = timingMarks.find((mark) => mark.label === 'context_worker_queue_wait_done');
    const executionDone = timingMarks.find((mark) => mark.label === 'context_worker_execution_done');
    assert.ok(Number(queueDone?.extra?.durationMs) < 500, 'queue wait must end when the worker claims the task, before execution');
    assert.ok(Number(executionDone?.extra?.durationMs) >= 500, 'execution timing must cover the worker job itself');
  } finally {
    await shutdownContextBuildWorkerPool();
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
  console.log('context-build worker pool regression passed');
}

void main();
