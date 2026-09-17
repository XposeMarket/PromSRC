import assert from 'node:assert/strict';
import { TeamExecutionQueue, TeamExecutionQueueError } from './team-execution-queue';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const queue = new TeamExecutionQueue(4);
  const order: string[] = [];
  const first = queue.run('team-a', async () => {
    order.push('first:start');
    await delay(15);
    order.push('first:end');
    return 'first';
  });
  const second = queue.run('team-a', async () => {
    order.push('second:start');
    await delay(5);
    order.push('second:end');
    return 'second';
  });
  const third = queue.run('team-a', async () => {
    order.push('third:start');
    order.push('third:end');
    return 'third';
  });

  assert.equal(queue.snapshot().teams[0].queued, 2);
  assert.deepEqual(await Promise.all([first, second, third]), ['first', 'second', 'third']);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end', 'third:start', 'third:end']);
  assert.equal(queue.snapshot().teams.length, 0);

  const limited = new TeamExecutionQueue(0);
  const active = limited.run('team-b', async () => {
    await delay(5);
    return 'active';
  });
  await assert.rejects(
    limited.run('team-b', async () => 'never'),
    (error: unknown) => error instanceof TeamExecutionQueueError && error.code === 'TEAM_EXECUTION_QUEUE_FULL',
  );
  assert.equal(await active, 'active');

  console.log('team-execution-queue regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
