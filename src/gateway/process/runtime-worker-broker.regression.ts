import assert from 'assert';
import { RuntimeWorkerBroker } from './runtime-worker-broker.js';

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
}

main().then(() => {
  console.log('runtime worker broker regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
