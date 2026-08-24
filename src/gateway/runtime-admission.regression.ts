import assert from 'node:assert/strict';
import { RuntimeAdmissionController, RuntimeAdmissionError } from './runtime-admission';

async function main(): Promise<void> {
  const admission = new RuntimeAdmissionController({
    maxActive: 2,
    maxBackgroundActive: 1,
    maxQueued: 2,
    maxWaitMs: 5_000,
    reservedInteractiveSlots: 0,
  });

  const foreground = admission.tryAcquire('interactive');
  assert.ok(foreground);
  const background = admission.tryAcquire('background');
  assert.ok(background);
  assert.equal(admission.snapshot().active, 2);
  assert.equal(admission.tryAcquire('background'), null, 'background lane must be capped independently');

  const queuedForeground = admission.acquire({ lane: 'interactive' });
  assert.equal(admission.snapshot().queuedByLane.interactive, 1);
  background!.release();
  const promoted = await queuedForeground;
  assert.equal(promoted.lane, 'interactive');
  assert.ok(promoted.waitMs >= 0);
  assert.equal(admission.snapshot().activeByLane.interactive, 2);

  const queuedBackground = admission.acquire({ lane: 'background' });
  const fullQueue = admission.acquire({ lane: 'background' });
  await assert.rejects(
    admission.acquire({ lane: 'background' }),
    (error: unknown) => error instanceof RuntimeAdmissionError && error.code === 'RUNTIME_ADMISSION_QUEUE_FULL',
  );
  foreground!.release();
  promoted.release();
  const backgroundPromotion = await queuedBackground;
  backgroundPromotion.release();
  await fullQueue;

  const abortController = new AbortController();
  const blocked = admission.tryAcquire('interactive');
  assert.ok(blocked);
  const aborted = admission.acquire({ lane: 'interactive', signal: abortController.signal });
  abortController.abort();
  await assert.rejects(
    aborted,
    (error: unknown) => error instanceof RuntimeAdmissionError && error.code === 'RUNTIME_ADMISSION_ABORTED',
  );
  blocked!.release();

  const reserved = new RuntimeAdmissionController({
    maxActive: 2,
    maxBackgroundActive: 2,
    reservedInteractiveSlots: 1,
    maxResourceWeight: 3,
  });
  const system = reserved.tryAcquire('system', Date.now(), undefined, { resourceWeight: 2 });
  assert.ok(system);
  assert.equal(
    reserved.tryAcquire('system', Date.now(), undefined, { resourceWeight: 1 }),
    null,
    'system work must leave one interactive slot reserved',
  );
  const interactive = reserved.tryAcquire('interactive', Date.now(), undefined, { resourceWeight: 1 });
  assert.ok(interactive, 'interactive work must be able to use the reserved slot');
  assert.equal(reserved.snapshot().activeResourceWeight, 3);
  interactive!.release();
  system!.release();

  console.log('runtime-admission regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
