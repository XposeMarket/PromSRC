import assert from 'node:assert/strict';
import { TeamExecutionQueue, TeamExecutionQueueError } from './team-execution-queue';

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

  console.log('team-execution-queue lease regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
