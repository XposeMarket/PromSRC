import assert from 'node:assert/strict';
import { TeamExecutionQueue, TeamExecutionQueueError, teamReceiptOutcome } from './team-execution-queue';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // A hung execution is abandoned at the lease, and the queued dispatch behind it starts.
  const queue = new TeamExecutionQueue(4, 50);
  const started: string[] = [];
  const hung = queue.run('team-hung', async () => {
    started.push('hung');
    await new Promise<never>(() => {});
    return 'never';
  });
  const next = queue.run('team-hung', async () => {
    started.push('next');
    return 'next-result';
  });

  await assert.rejects(
    hung,
    (error: unknown) => error instanceof TeamExecutionQueueError && error.code === 'TEAM_EXECUTION_ABANDONED',
  );
  assert.equal(await next, 'next-result');
  assert.deepEqual(started, ['hung', 'next']);
  assert.equal(queue.snapshot().teams.length, 0, 'abandoned team slot is released');

  // A healthy execution that settles inside the lease keeps its result and is not abandoned.
  const healthyQueue = new TeamExecutionQueue(4, 500);
  const healthy = await healthyQueue.run('team-healthy', async () => {
    await delay(5);
    return 'healthy-result';
  });
  assert.equal(healthy, 'healthy-result');
  assert.equal(healthyQueue.snapshot().teams.length, 0);

  // The lease trips the abort signal handed to the hung work, so the member turn can stop.
  const signalQueue = new TeamExecutionQueue(4, 50);
  let seenSignal: { aborted: boolean } | undefined;
  const signalHung = signalQueue.run('team-signal', (signal) => {
    seenSignal = signal;
    return new Promise<never>(() => {});
  });
  await assert.rejects(signalHung, (error: unknown) => error instanceof TeamExecutionQueueError);
  assert.equal(seenSignal?.aborted, true, 'lease expiry aborts the hung work');

  // A healthy execution's signal is never aborted.
  const healthySignalQueue = new TeamExecutionQueue(4, 500);
  let healthySignal: { aborted: boolean } | undefined;
  await healthySignalQueue.run('team-signal-ok', (signal) => {
    healthySignal = signal;
    return 'ok';
  });
  assert.equal(healthySignal?.aborted, false, 'a settled execution is not aborted');

  // Receipt outcome mapping: abandoned is a hard failure, capacity is retryable, success completes.
  assert.deepEqual(
    teamReceiptOutcome({ success: false, admissionCode: 'TEAM_EXECUTION_ABANDONED' }),
    { status: 'failed', acceptanceState: 'rejected' },
    'abandoned lease maps to failed, not retryable',
  );
  assert.deepEqual(
    teamReceiptOutcome({ success: false, admissionCode: 'TEAM_EXECUTION_QUEUE_FULL' }),
    { status: 'capacity_limited', acceptanceState: 'retryable' },
    'queue-full stays a retryable capacity signal',
  );
  assert.deepEqual(
    teamReceiptOutcome({ success: false }),
    { status: 'failed', acceptanceState: 'rejected' },
    'an ordinary failure is failed',
  );
  assert.deepEqual(
    teamReceiptOutcome({ success: true }),
    { status: 'complete', acceptanceState: 'pending' },
  );

  console.log('team-execution-queue lease regression passed');
}

// The lease timer is unref'd for production shutdown, so keep the test process alive
// while it waits. A watchdog turns a hang into a loud failure instead of a silent exit 0.
const keepAlive = setInterval(() => {}, 1_000);
const watchdog = setTimeout(() => {
  console.error('team-execution-queue lease regression hung: a pending promise never settled');
  process.exit(1);
}, 60_000);
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(keepAlive);
    clearTimeout(watchdog);
  });
