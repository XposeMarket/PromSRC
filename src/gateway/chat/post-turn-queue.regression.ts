import assert from 'node:assert/strict';
import { enqueuePostTurnJob, flushPostTurnJobs, getPostTurnQueueStatus } from './post-turn-queue';

async function main(): Promise<void> {
  const order: string[] = [];
  enqueuePostTurnJob({
    sessionId: 'session-a',
    label: 'first',
    run: async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      order.push('first:end');
    },
  });
  enqueuePostTurnJob({
    sessionId: 'session-b',
    label: 'second',
    run: () => {
      order.push('second');
    },
  });

  assert.deepEqual(order, [], 'post-turn work must not begin in the response-finalization call stack');
  assert.equal(getPostTurnQueueStatus().queued, 2);

  await flushPostTurnJobs();
  assert.deepEqual(order, ['first:start', 'first:end', 'second'], 'post-turn jobs must remain serialized');
  const status = getPostTurnQueueStatus();
  assert.equal(status.queued, 0);
  assert.equal(status.active, false);
  assert.equal(status.completed, 2);
  assert.equal(status.failed, 0);

  console.log('post-turn queue regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
