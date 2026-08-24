import assert from 'assert';
import { getRuntimeWorkerDiagnostics, RuntimeWorkerBroker } from './runtime-worker-broker.js';

async function main(): Promise<void> {
  const broker = new RuntimeWorkerBroker({
    name: 'runtime-worker-regression',
    entryBasename: 'runtime-worker-test-worker',
    startupTimeoutMs: 15_000,
    defaultJobTimeoutMs: 10_000,
  });

  try {
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 20);
    const startedAt = Date.now();
    const busyRun = broker.run<{ pid: number; kind: string }>('busy_loop', { durationMs: 600 });
    await assert.rejects(
      () => broker.run('echo', { shouldNotOverlap: true }),
      /already running a job/,
    );
    const busyResult = await busyRun;
    const diagnostics = getRuntimeWorkerDiagnostics();
    assert.ok(diagnostics.aggregate.workers >= 1, 'active brokers should appear in aggregate diagnostics');
    assert.ok(diagnostics.aggregate.rssBytes > 0, 'aggregate diagnostics should include child RSS');
    const elapsedMs = Date.now() - startedAt;
    clearInterval(ticker);

    assert.equal(busyResult.kind, 'busy_loop');
    assert.notEqual(busyResult.pid, process.pid, 'CPU-heavy work must execute in a child process');
    assert.ok(elapsedMs >= 500, `synthetic worker load should actually run (elapsed=${elapsedMs}ms)`);
    assert.ok(ticks >= 10, `gateway-side event loop should keep ticking during child CPU load (ticks=${ticks})`);

    await assert.rejects(
      () => broker.run('echo', { payload: 'x'.repeat(300_000) }),
      /too large for bounded IPC/,
    );
    await assert.rejects(
      () => broker.run('fail', {}),
      /Synthetic worker failure/,
    );
    await assert.rejects(
      () => broker.run('crash', {}),
      /exited/,
    );

    const recovered = await broker.run<{ pid: number; kind: string }>('echo', { recovered: true });
    assert.equal(recovered.kind, 'echo');
    assert.notEqual(recovered.pid, busyResult.pid, 'broker should spawn a clean worker after a crash');
  } finally {
    await broker.shutdown();
  }

  assert.equal(broker.getStatus().state, 'stopped');

  const disposable = new RuntimeWorkerBroker({
    name: 'runtime-worker-disposable-regression',
    entryBasename: 'runtime-worker-test-worker',
    startupTimeoutMs: 15_000,
    defaultJobTimeoutMs: 10_000,
    oneShot: true,
    idleTtlMs: 0,
  });
  try {
    const first = await disposable.run<{ pid: number }>('echo', { disposable: 1 });
    assert.ok(disposable.getStatus().resource?.rssBytes > 0, 'worker status should carry a resource sample');
    const deadline = Date.now() + 3_000;
    while (disposable.getStatus().state !== 'stopped' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(disposable.getStatus().state, 'stopped', 'one-shot worker should retire after its job');
    const second = await disposable.run<{ pid: number }>('echo', { disposable: 2 });
    assert.notEqual(second.pid, first.pid, 'one-shot worker should respawn for the next job');
  } finally {
    await disposable.shutdown();
  }

  const idle = new RuntimeWorkerBroker({
    name: 'runtime-worker-idle-regression',
    entryBasename: 'runtime-worker-test-worker',
    startupTimeoutMs: 15_000,
    defaultJobTimeoutMs: 10_000,
    idleTtlMs: 100,
  });
  try {
    await idle.warmup();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(idle.getStatus().state, 'stopped', 'idle TTL should retire a warm worker');
  } finally {
    await idle.shutdown();
  }
}

main().then(() => {
  console.log('runtime worker broker regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
