import assert from 'node:assert/strict';
import { ScheduledRunDeadline, isOrphanedRun, scheduledRunTimeoutMs } from './scheduled-run-deadline';

async function main(): Promise<void> {
  // Default and override policy.
  assert.equal(scheduledRunTimeoutMs({ kind: 'agent' }), 90 * 60_000);
  assert.equal(scheduledRunTimeoutMs({ kind: 'script' }), 120_000);
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 5_000 }), 5_000);
  // Over-cap overrides clamp to 4h; they must not silently fall back to 90 min.
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 5 * 60 * 60_000 }), 4 * 60 * 60_000, 'over-cap override clamps to 4h');
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 3 * 60 * 60_000 }), 3 * 60 * 60_000, 'in-cap override is kept');
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: 5_000.7 }), 5_000, 'non-integer override is floored, not dropped');
  assert.equal(scheduledRunTimeoutMs({ timeoutMs: -1 }), 90 * 60_000, 'non-positive override uses the default');

  // Late-completion guard: an orphaned run (deadline fired) is detectable; a healthy run is not.
  const orphaned = new ScheduledRunDeadline(20);
  await assert.rejects(orphaned.wait(() => new Promise<never>(() => {})), /timed out/);
  assert.equal(isOrphanedRun(orphaned), true, 'timed-out run is orphaned after its deadline fires');
  orphaned.dispose();
  const live = new ScheduledRunDeadline(500);
  assert.equal(isOrphanedRun(live), false, 'a run inside its deadline is not orphaned');
  assert.equal(isOrphanedRun(undefined), false, 'no deadline means not orphaned');
  live.dispose();

  // A second run gets its own deadline and can settle after the first one timed out.
  const second = new ScheduledRunDeadline(500);
  assert.equal(await second.wait(async () => 'second-result'), 'second-result');
  assert.equal(isOrphanedRun(second), false, 'a newer run is not affected by an earlier timeout');
  second.dispose();

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

// The deadline timer is unref'd for production shutdown, so keep the test process alive
// while it waits. A watchdog turns a hang into a loud failure instead of a silent exit 0.
const keepAlive = setInterval(() => {}, 1_000);
const watchdog = setTimeout(() => {
  console.error('scheduled-run-deadline regression hung: a pending promise never settled');
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
