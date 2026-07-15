import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TurnJobBlobStore } from './blob-store.js';
import {
  SqliteTurnJobStore,
  TurnJobIdempotencyConflictError,
  TurnJobLeaseLostError,
  TurnJobStateError,
} from './store.js';
import type { JsonValue } from './types.js';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-turn-jobs-'));
  const databasePath = path.join(root, 'runtimes', 'turn-jobs.sqlite');
  const blobRoot = path.join(root, 'runtimes', 'turn-blobs');
  let now = 1_800_000_000_000;
  const clock = (): number => now;
  const stores: SqliteTurnJobStore[] = [];

  try {
    const blobs = new TurnJobBlobStore(blobRoot, {
      maxBlobBytes: 1024 * 1024,
      compressionThresholdBytes: 128,
    });
    const payloadValue = { z: 'checkpoint-data-'.repeat(4_000), a: 1 } as JsonValue;
    const payload = blobs.putJson(payloadValue);
    const samePayload = blobs.putJson({ a: 1, z: 'checkpoint-data-'.repeat(4_000) });
    assert.equal(payload.ref, samePayload.ref, 'canonical JSON should produce one immutable content reference');
    assert.equal(payload.encoding, 'gzip', 'large repetitive checkpoints should be compressed');
    assert.deepEqual(blobs.getJson(payload.ref), { a: 1, z: 'checkpoint-data-'.repeat(4_000) });
    assert.throws(() => new TurnJobBlobStore(path.join(root, 'tiny'), { maxBlobBytes: 4 }).putText('12345'), /exceeds/);

    const storeA = new SqliteTurnJobStore(databasePath, {
      defaultLeaseMs: 1_000,
      now: clock,
    });
    const storeB = new SqliteTurnJobStore(databasePath, {
      defaultLeaseMs: 1_000,
      now: clock,
    });
    stores.push(storeA, storeB);

    const first = storeA.enqueueJob({
      id: 'job-safe',
      sessionId: 'session-a',
      kind: 'interactive',
      clientRequestId: 'mobile-request-1',
      requestFingerprint: 'sha256:request-one',
      payloadRef: payload.ref,
      priority: 100,
      createdAt: now++,
    });
    assert.equal(first.created, true);
    assert.equal(first.job.lastEventSeq, 1);

    const duplicate = storeB.enqueueJob({
      sessionId: 'session-a',
      kind: 'interactive',
      clientRequestId: 'mobile-request-1',
      requestFingerprint: 'sha256:request-one',
      payloadRef: payload.ref,
      createdAt: now++,
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, first.job.id);
    assert.throws(() => storeB.enqueueJob({
      sessionId: 'session-a',
      kind: 'interactive',
      clientRequestId: 'mobile-request-1',
      requestFingerprint: 'sha256:different-request',
      payloadRef: payload.ref,
    }), TurnJobIdempotencyConflictError);

    storeA.enqueueJob({
      id: 'job-same-session',
      sessionId: 'session-a',
      kind: 'background_task',
      requestFingerprint: 'sha256:same-session',
      payloadRef: payload.ref,
      createdAt: now++,
    });
    storeA.enqueueJob({
      id: 'job-other-session',
      sessionId: 'session-b',
      kind: 'interactive',
      requestFingerprint: 'sha256:other-session',
      payloadRef: payload.ref,
      createdAt: now++,
    });

    storeA.enqueueJob({
      id: 'job-exact-older',
      sessionId: 'session-exact',
      kind: 'interactive',
      requestFingerprint: 'sha256:exact-older',
      payloadRef: payload.ref,
      createdAt: now++,
    });
    storeA.enqueueJob({
      id: 'job-exact-new-request',
      sessionId: 'session-exact',
      kind: 'interactive',
      requestFingerprint: 'sha256:exact-new',
      payloadRef: payload.ref,
      createdAt: now++,
    });
    const exactLease = storeB.claimJob('job-exact-new-request', {
      leaseOwner: 'worker-exact',
      workerPid: 77,
      leaseMs: 1_000,
      now,
    });
    assert.ok(exactLease);
    assert.equal(exactLease.job.id, 'job-exact-new-request',
      'exact-ID admission must not select an older queued job in the session');
    assert.equal(storeA.claimJob('job-exact-older', { leaseOwner: 'worker-exact-2', now }), null,
      'the exact claim must still hold the normal session mutation lease');
    storeA.cancelJob(exactLease.job.id, 'exact claim verified', now);
    const olderExactLease = storeA.claimJob('job-exact-older', { leaseOwner: 'worker-exact-2', now });
    assert.ok(olderExactLease, 'the older job remains independently claimable after the exact job releases its session');
    storeA.cancelJob(olderExactLease.job.id, 'exact claim cleanup', now);

    const firstLease = storeA.claimNextJob({ leaseOwner: 'worker-a', workerPid: 111, leaseMs: 1_000, now });
    assert.ok(firstLease);
    assert.equal(firstLease.job.id, 'job-safe');
    assert.equal(firstLease.job.attempt, 1);
    assert.equal(storeB.claimNextJob({ leaseOwner: 'worker-b', sessionId: 'session-a', now }), null,
      'a durable session resource lease must serialize mutating turns');

    storeB.enqueueJob({
      id: 'job-sync-admission-race',
      sessionId: 'session-a',
      kind: 'interactive',
      requestFingerprint: 'sha256:sync-admission-race',
      payloadRef: payload.ref,
      createdAt: now,
    });
    assert.equal(storeB.claimJob('job-sync-admission-race', { leaseOwner: 'worker-race', now }), null);
    assert.equal(storeB.deleteUnclaimedJob('job-sync-admission-race'), true,
      'a synchronous admission that lost the session race must be removable instead of remaining orphaned');
    assert.equal(storeA.getJob('job-sync-admission-race'), null);

    const crossSessionLease = storeB.claimNextJob({ leaseOwner: 'worker-b', sessionId: 'session-b', now });
    assert.ok(crossSessionLease, 'another session should run concurrently');
    storeA.cancelJob(crossSessionLease.job.id, 'regression cleanup', now);
    assert.throws(
      () => storeB.appendWorkerEvent(crossSessionLease.job.id, crossSessionLease.token, { type: 'late_event', at: now }),
      TurnJobLeaseLostError,
    );

    storeA.markJobRunning(firstLease.job.id, firstLease.token, now);
    const progress = storeA.appendWorkerEvent(firstLease.job.id, firstLease.token, {
      type: 'progress',
      dedupeKey: 'progress:one',
      payload: { z: 2, a: 1 },
      at: now,
    });
    const duplicateProgress = storeA.appendWorkerEvent(firstLease.job.id, firstLease.token, {
      type: 'progress',
      dedupeKey: 'progress:one',
      payload: { a: 1, z: 2 },
      at: now + 1,
    });
    assert.equal(duplicateProgress.seq, progress.seq, 'event dedupe must not consume another sequence');

    const checkpoint = storeA.saveCheckpoint(firstLease.job.id, firstLease.token, {
      id: 'checkpoint-safe-1',
      phase: 'after_model_before_tool',
      modelRound: 1,
      continuationRef: payload.ref,
      continuationHash: payload.hash,
      metadata: { provider: 'synthetic' },
      at: now,
    });
    assert.equal(storeB.getLatestCheckpoint(firstLease.job.id)?.id, checkpoint.id);

    const prepared = storeA.prepareToolEffect(firstLease.job.id, firstLease.token, {
      logicalSequence: 1,
      toolCallId: 'provider-tool-call-attempt-1',
      toolName: 'read_file',
      argsHash: 'sha256:tool-args',
      replayPolicy: 'safe_retry',
      at: now,
    });
    const begun = storeA.beginToolEffect(firstLease.job.id, firstLease.token, prepared.effectId, now);
    assert.equal(begun.disposition, 'execute');

    now = firstLease.leaseUntil + 1;
    assert.throws(
      () => storeA.appendWorkerEvent(firstLease.job.id, firstLease.token, { type: 'too_late', at: now }),
      TurnJobLeaseLostError,
      'an expired lease token must be fenced even before another worker claims the job',
    );
    const recovered = storeB.reconcileStaleLeases(now);
    assert.deepEqual(recovered.jobs.map((job) => job.jobId), ['job-safe']);
    assert.equal(recovered.jobs[0].nextState, 'checkpointed');
    assert.deepEqual(recovered.jobs[0].uncertainEffectIds, [prepared.effectId]);
    assert.equal(storeB.getToolEffect(prepared.effectId)?.state, 'unknown');

    const replacementLease = storeB.claimNextJob({
      leaseOwner: 'worker-c',
      workerPid: 333,
      sessionId: 'session-a',
      now,
      leaseMs: 1_000,
    });
    assert.ok(replacementLease);
    assert.equal(replacementLease.job.id, firstLease.job.id);
    assert.equal(replacementLease.job.attempt, 2);
    storeB.markJobRunning(replacementLease.job.id, replacementLease.token, now);
    assert.throws(
      () => storeA.cancelLeasedJob(firstLease.job.id, firstLease.token, 'stale cancellation must be fenced', now),
      TurnJobLeaseLostError,
      'an expired attempt must not cancel the replacement that now owns the same job id',
    );
    assert.equal(storeB.getJob(replacementLease.job.id)?.state, 'running');
    assert.equal(storeB.getJob(replacementLease.job.id)?.attempt, 2);
    assert.throws(
      () => storeA.completeToolEffect(firstLease.job.id, firstLease.token, prepared.effectId, payload.ref, now),
      TurnJobLeaseLostError,
      'the previous worker must not settle an effect after replacement',
    );

    const recoveredEffect = storeB.prepareToolEffect(replacementLease.job.id, replacementLease.token, {
      effectId: prepared.effectId,
      logicalSequence: 1,
      toolCallId: 'provider-tool-call-attempt-2',
      toolName: 'read_file',
      argsHash: 'sha256:tool-args',
      replayPolicy: 'safe_retry',
      at: now,
    });
    assert.equal(recoveredEffect.state, 'unknown');
    const retry = storeB.beginToolEffect(replacementLease.job.id, replacementLease.token, prepared.effectId, now);
    assert.equal(retry.disposition, 'execute');
    assert.equal(retry.effect.executionCount, 2);
    storeB.completeToolEffect(replacementLease.job.id, replacementLease.token, prepared.effectId, payload.ref, now);

    const browserLease = storeB.tryAcquireResourceLease({
      resourceKey: 'browser:default',
      jobId: replacementLease.job.id,
      leaseOwner: 'worker-c',
      leaseToken: replacementLease.token,
      leaseUntil: replacementLease.leaseUntil,
      now,
    });
    assert.ok(browserLease);
    now += 400;
    const desktopLease = storeB.tryAcquireResourceLease({
      resourceKey: 'desktop:global-input',
      jobId: replacementLease.job.id,
      leaseOwner: 'worker-c',
      leaseToken: replacementLease.token,
      leaseUntil: now + 1_000,
      now,
    });
    assert.ok(desktopLease, 'resource acquisition between parent heartbeats must not fence a valid turn');
    assert.equal(desktopLease.leaseUntil, replacementLease.leaseUntil,
      'a child resource lease must clamp to the current parent turn expiry');

    const final = storeB.persistFinal(replacementLease.job.id, replacementLease.token, {
      finalRef: payload.ref,
      payload: { text: 'done' },
      deliveries: [
        { id: 'delivery-session', channel: 'session', dedupeKey: 'session-materialization', maxAttempts: 3 },
        { id: 'delivery-telegram', channel: 'telegram', destination: 'chat-1', dedupeKey: 'telegram:chat-1', maxAttempts: 3 },
      ],
      at: now,
    });
    assert.equal(final.job.state, 'final_persisted');
    assert.equal(final.deliveries.length, 2);
    assert.equal(storeA.getResourceLease('browser:default'), null, 'final persistence must release all job resources');
    assert.throws(
      () => storeB.appendWorkerEvent(replacementLease.job.id, replacementLease.token, { type: 'after_final', at: now }),
      TurnJobLeaseLostError,
    );
    const repeatedFinal = storeA.persistFinal(replacementLease.job.id, replacementLease.token, {
      finalRef: payload.ref,
      payload: { text: 'done' },
      deliveries: [],
      at: now,
    });
    assert.equal(repeatedFinal.event.seq, final.event.seq, 'a lost final acknowledgement must be safely repeatable');
    assert.throws(() => storeA.persistFinal(replacementLease.job.id, replacementLease.token, {
      finalRef: 'turnblob:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      at: now,
    }), TurnJobStateError);

    const sessionDelivery = storeA.claimNextDelivery({ leaseOwner: 'delivery-worker', channels: ['session'], now, leaseMs: 1_000 });
    assert.ok(sessionDelivery);
    assert.equal(storeB.completeDelivery(sessionDelivery.delivery.id, 'wrong-token', now), false);
    assert.equal(storeB.completeDelivery(sessionDelivery.delivery.id, sessionDelivery.token, now), true);

    const telegramDelivery = storeA.claimNextDelivery({ leaseOwner: 'delivery-worker', channels: ['telegram'], now, leaseMs: 1_000 });
    assert.ok(telegramDelivery);
    now = telegramDelivery.leaseUntil + 1;
    const deliveryRecovery = storeB.reconcileStaleLeases(now);
    assert.equal(deliveryRecovery.deliveriesReset, 1);
    const telegramRetry = storeB.claimNextDelivery({ leaseOwner: 'delivery-worker-2', channels: ['telegram'], now, leaseMs: 1_000 });
    assert.ok(telegramRetry);
    assert.equal(telegramRetry.delivery.attempts, 2);
    assert.equal(storeA.failDelivery(telegramRetry.delivery.id, telegramRetry.token, 'permanent synthetic failure', false, now), true);
    assert.equal(storeA.getDelivery(telegramRetry.delivery.id)?.status, 'failed');

    const completed = storeA.completeFinalizedJob(final.job.id, now);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.finalRef, payload.ref);
    storeA.appendGatewayEvent(completed.id, { type: 'post_complete_audit_a', at: now });
    storeB.appendGatewayEvent(completed.id, { type: 'post_complete_audit_b', at: now });
    const events = storeA.listEvents(completed.id, 0, 10_000);
    assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1),
      'all gateway connections must share one gap-free event sequence');
    assert.equal(storeA.getJob(completed.id)?.lastEventSeq, events.length);

    now += 10;
    storeA.enqueueJob({
      id: 'job-unsafe',
      sessionId: 'session-unsafe',
      kind: 'background_task',
      requestFingerprint: 'sha256:unsafe',
      payloadRef: payload.ref,
      createdAt: now,
    });
    const unsafeLease = storeA.claimNextJob({ leaseOwner: 'worker-unsafe', sessionId: 'session-unsafe', now, leaseMs: 1_000 });
    assert.ok(unsafeLease);
    storeA.markJobRunning(unsafeLease.job.id, unsafeLease.token, now);
    const unsafeEffect = storeA.prepareToolEffect(unsafeLease.job.id, unsafeLease.token, {
      logicalSequence: 1,
      toolCallId: 'send-money-1',
      toolName: 'external_non_idempotent_action',
      argsHash: 'sha256:unsafe-args',
      replayPolicy: 'never_replay',
      at: now,
    });
    assert.equal(storeA.beginToolEffect(unsafeLease.job.id, unsafeLease.token, unsafeEffect.effectId, now).disposition, 'execute');
    now = unsafeLease.leaseUntil + 1;
    const unsafeRecovery = storeB.reconcileStaleLeases(now);
    const unsafeResult = unsafeRecovery.jobs.find((job) => job.jobId === unsafeLease.job.id);
    assert.equal(unsafeResult?.nextState, 'needs_review');
    assert.equal(storeA.getToolEffect(unsafeEffect.effectId)?.state, 'unknown');

    now += 10;
    storeA.enqueueJob({
      id: 'job-explicit-failure-unsafe',
      sessionId: 'session-explicit-failure-unsafe',
      kind: 'background_task',
      requestFingerprint: 'sha256:explicit-failure-unsafe',
      payloadRef: payload.ref,
      createdAt: now,
    });
    const explicitFailureLease = storeA.claimNextJob({
      leaseOwner: 'worker-explicit-failure-unsafe',
      sessionId: 'session-explicit-failure-unsafe',
      now,
      leaseMs: 1_000,
    });
    assert.ok(explicitFailureLease);
    storeA.markJobRunning(explicitFailureLease.job.id, explicitFailureLease.token, now);
    const explicitFailureEffect = storeA.prepareToolEffect(explicitFailureLease.job.id, explicitFailureLease.token, {
      logicalSequence: 1,
      toolCallId: 'publish-before-failure',
      toolName: 'publish_external_result',
      argsHash: 'sha256:publish-before-failure',
      replayPolicy: 'never_replay',
      at: now,
    });
    assert.equal(
      storeA.beginToolEffect(explicitFailureLease.job.id, explicitFailureLease.token, explicitFailureEffect.effectId, now).disposition,
      'execute',
    );
    assert.throws(() => storeA.persistFinal(explicitFailureLease.job.id, explicitFailureLease.token, {
      finalRef: payload.ref,
      payloadRef: payload.ref,
      deliveries: [],
      at: now,
    }), TurnJobStateError, 'a final must not commit across an unsettled tool effect');
    const explicitFailure = storeA.failJob(
      explicitFailureLease.job.id,
      explicitFailureLease.token,
      'synthetic failure after external effect began',
      true,
      now,
    );
    assert.equal(explicitFailure.state, 'needs_review',
      'an explicitly failed attempt must not leave an uncertain non-replayable effect claimable');
    assert.equal(storeA.getToolEffect(explicitFailureEffect.effectId)?.state, 'unknown');

    now += 10;
    storeA.enqueueJob({
      id: 'job-startup-recovery',
      sessionId: 'session-startup',
      kind: 'main_chat_goal',
      requestFingerprint: 'sha256:startup',
      payloadRef: payload.ref,
      maxAttempts: 1,
      createdAt: now,
    });
    const startupLease = storeA.claimNextJob({ leaseOwner: 'worker-before-restart', sessionId: 'session-startup', now, leaseMs: 1_000 });
    assert.ok(startupLease);
    now = startupLease.leaseUntil + 1;
    const startupStore = new SqliteTurnJobStore(databasePath, { defaultLeaseMs: 1_000, now: clock });
    stores.push(startupStore);
    assert.equal(startupStore.getJob(startupLease.job.id)?.state, 'failed',
      'opening the gateway store must reconcile an expired final attempt');
  } finally {
    for (const store of stores.reverse()) {
      try { store.close(); } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('durable turn-job store regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
