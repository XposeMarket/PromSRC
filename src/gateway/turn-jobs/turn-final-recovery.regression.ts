import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteTurnJobStore } from './store.js';
import type { TurnDeliveryInput } from './types.js';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-turn-final-recovery-'));
  const databasePath = path.join(root, 'turn-jobs.sqlite');
  let now = Date.now();
  const clock = () => now;
  const finalRef = 'turnblob:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const payloadRef = 'turnblob:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const stores: SqliteTurnJobStore[] = [];

  const finalize = (
    store: SqliteTurnJobStore,
    id: string,
    sessionId: string,
    clientRequestId: string | null,
    deliveries: readonly TurnDeliveryInput[] = [],
  ) => {
    const requestFingerprint = `sha256:${id}`;
    store.enqueueJob({
      id,
      sessionId,
      kind: 'interactive',
      payloadRef,
      requestFingerprint,
      clientRequestId,
      createdAt: now,
    });
    const lease = store.claimJob(id, {
      leaseOwner: `worker:${id}`,
      workerPid: 1234,
      leaseMs: 30_000,
      now,
    });
    assert.ok(lease);
    store.markJobRunning(id, lease.token, now);
    const final = store.persistFinal(id, lease.token, {
      finalRef,
      payload: { text: `result:${id}` },
      deliveries,
      at: now,
    });
    assert.equal(final.job.state, 'final_persisted');
    return { requestFingerprint, final };
  };

  try {
    // Simulate a process stopping after final persistence but before the caller
    // could acknowledge terminal publication.
    const writer = new SqliteTurnJobStore(databasePath, { now: clock, reconcileOnOpen: false });
    stores.push(writer);
    const crash = finalize(writer, 'job-crash-window', 'session-crash', 'request-1');
    finalize(writer, 'job-explicit-outbox', 'session-outbox', null, [
      { id: 'delivery-explicit', channel: 'telegram', destination: 'chat-1', dedupeKey: 'telegram:chat-1' },
    ]);
    writer.close();
    stores.pop();

    const recovered = new SqliteTurnJobStore(databasePath, { now: clock });
    stores.push(recovered);
    assert.equal(recovered.getJob('job-crash-window')?.state, 'completed',
      'opening the journal must close a final-only crash window');
    assert.equal(recovered.getJob('job-explicit-outbox')?.state, 'final_persisted',
      'recovery must never erase explicit outbox intent');

    const completionEvents = recovered.listEvents('job-crash-window', 0, 100)
      .filter((event) => event.type === 'job_completed');
    assert.equal(completionEvents.length, 1);
    assert.equal(completionEvents[0]?.source, 'recovery');
    assert.deepEqual(completionEvents[0]?.payload, { finalRef, recovered: true });

    // A retried HTTP/mobile request still gets the exact persisted result after
    // recovery changed the row to completed.
    const replay = recovered.enqueueJob({
      sessionId: 'session-crash',
      kind: 'interactive',
      payloadRef,
      requestFingerprint: crash.requestFingerprint,
      clientRequestId: 'request-1',
      createdAt: now,
    });
    assert.equal(replay.created, false);
    assert.equal(replay.job.id, 'job-crash-window');
    assert.equal(replay.job.state, 'completed');
    assert.equal(replay.job.finalRef, finalRef);

    // Recovery is bounded, and a saturated pass reports the remaining backlog.
    now += 1;
    finalize(recovered, 'job-batch-a', 'session-batch-a', null);
    now += 1;
    finalize(recovered, 'job-batch-b', 'session-batch-b', null);
    const firstBatch = recovered.reconcileFinalizedJobs({ at: now, limit: 1 });
    assert.equal(firstBatch.recovered, 1);
    assert.equal(firstBatch.remainingRecoverable, 1);
    assert.equal(firstBatch.deferredWithDeliveries, 1);
    const secondBatch = recovered.reconcileFinalizedJobs({ at: now, limit: 1 });
    assert.equal(secondBatch.recovered, 1);
    assert.equal(secondBatch.remainingRecoverable, 0);

    // Even a delivered outbox row remains explicit intent. A future channel
    // drainer/ack owner must decide when that job is safe to complete.
    const delivery = recovered.claimNextDelivery({
      leaseOwner: 'delivery-worker',
      channels: ['telegram'],
      leaseMs: 30_000,
      now,
    });
    assert.ok(delivery);
    assert.equal(recovered.completeDelivery(delivery.delivery.id, delivery.token, now), true);
    const afterDelivery = recovered.reconcileFinalizedJobs({ at: now, limit: 10 });
    assert.equal(afterDelivery.recovered, 0);
    assert.equal(afterDelivery.deferredWithDeliveries, 1);
    assert.equal(recovered.getJob('job-explicit-outbox')?.state, 'final_persisted');

    // The periodic lease half of the same serialized pass is bounded too. It
    // promptly transitions expired attempts but never touches a healthy lease.
    const startActive = (id: string, leaseMs: number) => {
      recovered.enqueueJob({
        id,
        sessionId: `session-${id}`,
        kind: 'background_task',
        payloadRef,
        requestFingerprint: `sha256:${id}`,
        createdAt: now,
      });
      const lease = recovered.claimJob(id, {
        leaseOwner: `worker:${id}`,
        workerPid: 5678,
        leaseMs,
        now,
      });
      assert.ok(lease);
      recovered.markJobRunning(id, lease.token, now);
      return lease;
    };
    startActive('job-stale-a', 1_000);
    startActive('job-stale-b', 1_000);
    startActive('job-healthy', 10_000);
    now += 1_500;
    const firstStaleBatch = recovered.reconcileStaleLeases(now, 1);
    assert.equal(firstStaleBatch.jobs.length, 1);
    assert.equal(firstStaleBatch.jobsRemaining, 1);
    assert.equal(recovered.getJob('job-healthy')?.state, 'running');
    const secondStaleBatch = recovered.reconcileStaleLeases(now, 1);
    assert.equal(secondStaleBatch.jobs.length, 1);
    assert.equal(secondStaleBatch.jobsRemaining, 0);
    assert.equal(recovered.getJob('job-healthy')?.state, 'running');
    recovered.cancelJob('job-healthy', 'regression cleanup', now);
  } finally {
    for (const store of stores.reverse()) {
      try { store.close(); } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('durable final-state recovery regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
