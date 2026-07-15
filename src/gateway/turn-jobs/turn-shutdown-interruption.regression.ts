import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteTurnJobStore, TurnJobLeaseLostError } from './store.js';

async function main(): Promise<void> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prometheus-turn-interrupt-'));
  const store = new SqliteTurnJobStore(path.join(root, 'turn-jobs.sqlite'), {
    defaultLeaseMs: 30_000,
    reconcileOnOpen: false,
  });

  try {
    store.enqueueJob({
      id: 'orderly-restart-safe',
      sessionId: 'shutdown-session-safe',
      kind: 'background_agent',
      requestFingerprint: 'shutdown-safe-fingerprint',
      payloadRef: 'sha256:shutdown-safe-payload',
    });
    const lease = store.claimJob('orderly-restart-safe', { leaseOwner: 'gateway-before-restart' });
    assert.ok(lease);
    store.markJobRunning(lease.job.id, lease.token);
    const effect = store.prepareToolEffect(lease.job.id, lease.token, {
      logicalSequence: 1,
      toolCallId: 'safe-tool-call',
      toolName: 'read_file',
      argsHash: 'sha256:safe-args',
      replayPolicy: 'safe_retry',
    });
    store.beginToolEffect(lease.job.id, lease.token, effect.effectId);

    const interrupted = store.interruptLeasedJob(
      lease.job.id,
      lease.token,
      'Gateway restart interrupted the turn.',
    );
    assert.equal(interrupted.state, 'interrupted');
    assert.equal(interrupted.lastError, null, 'orderly restart must not become a failed attempt');
    assert.equal(interrupted.interruptionReason, 'Gateway restart interrupted the turn.');
    assert.equal(store.getToolEffect(effect.effectId)?.state, 'unknown');
    assert.throws(
      () => store.appendWorkerEvent(lease.job.id, lease.token, { type: 'late_after_restart' }),
      TurnJobLeaseLostError,
      'shutdown transition must fence the old lease',
    );
    const resumed = store.claimJob(lease.job.id, { leaseOwner: 'gateway-after-restart' });
    assert.ok(resumed, 'orderly interrupted work must remain claimable after restart');
    assert.equal(resumed.job.attempt, lease.job.attempt + 1);
    store.cancelLeasedJob(resumed.job.id, resumed.token, 'regression cleanup');

    store.enqueueJob({
      id: 'orderly-restart-unsafe',
      sessionId: 'shutdown-session-unsafe',
      kind: 'interactive',
      requestFingerprint: 'shutdown-unsafe-fingerprint',
      payloadRef: 'sha256:shutdown-unsafe-payload',
    });
    const unsafeLease = store.claimJob('orderly-restart-unsafe', { leaseOwner: 'gateway-before-unsafe-restart' });
    assert.ok(unsafeLease);
    store.markJobRunning(unsafeLease.job.id, unsafeLease.token);
    const unsafeEffect = store.prepareToolEffect(unsafeLease.job.id, unsafeLease.token, {
      logicalSequence: 1,
      toolCallId: 'unsafe-tool-call',
      toolName: 'external_side_effect',
      argsHash: 'sha256:unsafe-args',
      replayPolicy: 'never_replay',
    });
    store.beginToolEffect(unsafeLease.job.id, unsafeLease.token, unsafeEffect.effectId);
    const needsReview = store.interruptLeasedJob(unsafeLease.job.id, unsafeLease.token, 'Gateway restart');
    assert.equal(needsReview.state, 'needs_review', 'uncertain non-replayable work must not be retried automatically');
    assert.equal(store.getToolEffect(unsafeEffect.effectId)?.state, 'unknown');

    const executionSource = await fs.promises.readFile(path.join(process.cwd(), 'src', 'gateway', 'turn-jobs', 'execution-context.ts'), 'utf8');
    const chatSource = await fs.promises.readFile(path.join(process.cwd(), 'src', 'gateway', 'routes', 'chat.router.ts'), 'utf8');
    assert.match(executionSource, /export function interruptDurableTurn[\s\S]*?interruptLeasedJob/);
    assert.match(executionSource, /get interrupted\(\)[\s\S]*?upstream\?\.interrupted === true/);
    assert.match(chatSource, /abortSignal\?\.interrupted[\s\S]{0,180}interruptDurableTurn/);
    assert.match(
      chatSource,
      /if \(abortSignal\?\.aborted\) \{[\s\S]{0,220}if \(abortSignal\.interrupted\) return result;[\s\S]*?\[Interrupted by user\]/,
      'shutdown interruption must bypass the user-abort history packet',
    );
  } finally {
    store.close();
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('durable turn shutdown interruption regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
