import assert from 'node:assert/strict';
import { ScheduledRunDeadline, scheduledRunTimeoutMs } from './scheduled-run-deadline';

async function main(): Promise<void> {
  // Default and override policy.
  assert.equal(scheduledRunTimeoutMs({ kind: 'agent' }), 90 * 60_000);
  assert.equal(scheduledRunTimeoutMs({ kind: 'script' }), 120_000);
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 5_000 }), 5_000);
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 5 * 60 * 60_000 }), 90 * 60_000, 'over-cap override falls back to default');

  // A hung run times out and flags the abort signal.
  const hung = new ScheduledRunDeadline(50);
  await assert.rejects(
    hung.wait(() => new Promise<never>(() => {})),
    /timed out/,
  );
  assert.equal(hung.abortSignal.aborted, true);
  assert.match(String(hung.cancellationError?.message), /timed out/);
  hung.dispose();

  // A run that finishes inside the deadline is NOT timed out and its result is kept.
  const healthy = new ScheduledRunDeadline(500);
  const result = await healthy.wait(async () => 'done');
  assert.equal(result, 'done');
  assert.equal(healthy.abortSignal.aborted, false);
  assert.equal(healthy.cancellationError, undefined);
  healthy.dispose();

  console.log('scheduled-run-deadline regression passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
