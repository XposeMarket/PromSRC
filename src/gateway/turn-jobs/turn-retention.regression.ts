import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeWorkerBroker } from '../process/runtime-worker-broker.js';
import { TurnJobBlobStore, type TurnJobBlobDescriptor } from './blob-store.js';
import { runTurnJournalRetention, type TurnJournalRetentionOptions } from './retention.js';
import { SqliteTurnJobStore } from './store.js';

const DAY_MS = 24 * 60 * 60_000;

function blobPath(root: string, descriptor: TurnJobBlobDescriptor): string {
  return path.join(root, descriptor.hash.slice(0, 2), `${descriptor.hash}.turnblob`);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-turn-retention-'));
  const databasePath = path.join(root, 'turn-jobs.sqlite');
  const blobRoot = path.join(root, 'turn-blobs');
  const statePath = path.join(root, 'turn-retention-state.json');
  const now = Date.now();
  const old = now - 3 * DAY_MS;
  let clock = old;
  const blobs = new TurnJobBlobStore(blobRoot);
  const descriptors: TurnJobBlobDescriptor[] = [];
  const put = (label: string): TurnJobBlobDescriptor => {
    const descriptor = blobs.putText(label);
    descriptors.push(descriptor);
    return descriptor;
  };
  const store = new SqliteTurnJobStore(databasePath, { now: () => clock, reconcileOnOpen: false });

  const enqueue = (id: string, payloadRef = put(`payload:${id}`).ref): void => {
    store.enqueueJob({
      id,
      sessionId: `session:${id}`,
      kind: 'interactive',
      payloadRef,
      requestFingerprint: `fingerprint:${id}`,
      createdAt: clock,
    });
  };
  const start = (id: string): string => {
    const lease = store.claimJob(id, { leaseOwner: `worker:${id}`, workerPid: process.pid, now: clock, leaseMs: 60_000 });
    assert(lease, `expected lease for ${id}`);
    store.markJobRunning(id, lease.token, clock);
    return lease.token;
  };
  const complete = (id: string): void => {
    enqueue(id);
    const token = start(id);
    const finalRef = put(`final:${id}`).ref;
    store.persistFinal(id, token, { finalRef, at: clock });
    store.completeFinalizedJob(id, clock);
  };

  // Three old terminal jobs exercise the deletion cap and FK cascades.
  complete('terminal-a');
  complete('terminal-b');
  enqueue('terminal-c');
  store.failJob('terminal-c', start('terminal-c'), 'expected failure', false, clock);
  enqueue('terminal-d');
  store.cancelJob('terminal-d', 'expected cancellation', clock);

  // Every nonterminal class remains outside the pruning predicate regardless
  // of age, including states that deliberately release their worker lease.
  enqueue('queued-old');
  enqueue('leased-old');
  assert(store.claimJob('leased-old', { leaseOwner: 'leased-worker', now: clock, leaseMs: 60_000 }));
  enqueue('running-old');
  start('running-old');
  enqueue('waiting-user-old');
  store.markJobWaiting('waiting-user-old', start('waiting-user-old'), 'waiting_user', 'question', clock);
  enqueue('waiting-approval-old');
  store.markJobWaiting('waiting-approval-old', start('waiting-approval-old'), 'waiting_approval', 'approval', clock);
  enqueue('review-old');
  store.pauseJobForReview('review-old', start('review-old'), 'verify side effect', clock);

  // One final-persisted job references a distinct blob through every explicit
  // database blob-ref column: job payload/checkpoint/final, event payload,
  // checkpoint continuation, and tool-effect result.
  const directPayload = put('direct:payload');
  const directEvent = put('direct:event');
  const directCheckpoint = put('direct:checkpoint');
  const directTool = put('direct:tool');
  const directFinal = put('direct:final');
  enqueue('final-persisted-old', directPayload.ref);
  const directToken = start('final-persisted-old');
  store.appendWorkerEvent('final-persisted-old', directToken, {
    type: 'referenced_event',
    payloadRef: directEvent.ref,
    at: clock,
  });
  store.saveCheckpoint('final-persisted-old', directToken, {
    phase: 'tool_loop',
    continuationRef: directCheckpoint.ref,
    at: clock,
  });
  const effect = store.prepareToolEffect('final-persisted-old', directToken, {
    logicalSequence: 1,
    toolCallId: 'tool-call-1',
    toolName: 'test_tool',
    argsHash: 'args-hash',
    replayPolicy: 'safe_retry',
    at: clock,
  });
  store.beginToolEffect('final-persisted-old', directToken, effect.effectId, clock);
  store.completeToolEffect('final-persisted-old', directToken, effect.effectId, directTool.ref, clock);
  store.persistFinal('final-persisted-old', directToken, {
    finalRef: directFinal.ref,
    payloadRef: directFinal.ref,
    at: clock,
  });
  for (const descriptor of [directPayload, directEvent, directCheckpoint, directTool, directFinal]) {
    assert(store.isDirectBlobReference(descriptor.ref), `${descriptor.ref} should be directly referenced`);
  }

  clock = now;
  complete('terminal-recent');
  const oldUnreferenced = put('unreferenced:old');
  const recentUnreferenced = put('unreferenced:recent');
  const touchedUnreferenced = put('unreferenced:touched');
  store.close();

  // Make all old content eligible. A subsequent immutable read must refresh
  // mtime and prevent collection even though it has no database reference.
  const oldDate = new Date(old);
  for (const descriptor of descriptors) {
    if (descriptor.ref !== recentUnreferenced.ref) fs.utimesSync(blobPath(blobRoot, descriptor), oldDate, oldDate);
  }
  const beforeTouch = fs.statSync(blobPath(blobRoot, touchedUnreferenced)).mtimeMs;
  assert.equal(blobs.getText(touchedUnreferenced.ref), 'unreferenced:touched');
  assert(fs.statSync(blobPath(blobRoot, touchedUnreferenced)).mtimeMs > beforeTouch, 'blob read should refresh mtime');

  const options: TurnJournalRetentionOptions = {
    databasePath,
    blobRoot,
    statePath,
    now,
    jobRetentionMs: DAY_MS,
    blobRetentionMs: 2 * DAY_MS,
    jobBatchLimit: 2,
    blobScanLimit: 10_000,
    blobDeleteLimit: 1,
  };
  const first = runTurnJournalRetention(options);
  assert.equal(first.jobsDeleted, 2, 'first pass must honor terminal job batch cap');
  assert(first.jobBatchSaturated);
  assert.equal(first.blobs.deleted, 1, 'first pass must honor blob delete cap');
  assert(first.blobs.batchSaturated);

  const verifyAfterFirst = new SqliteTurnJobStore(databasePath, { reconcileOnOpen: false });
  assert.equal(verifyAfterFirst.getJob('terminal-a'), null);
  assert.equal(verifyAfterFirst.getJob('terminal-b'), null);
  assert.deepEqual(verifyAfterFirst.listEvents('terminal-a'), [], 'foreign-key children should cascade');
  assert(verifyAfterFirst.getJob('terminal-c'));
  assert(verifyAfterFirst.getJob('terminal-d'));
  verifyAfterFirst.close();

  // Drain the remaining bounded work across several cursor-resuming passes.
  let pass = first;
  for (let index = 0; index < 8 && (pass.jobBatchSaturated || pass.blobs.batchSaturated); index += 1) {
    pass = runTurnJournalRetention({ ...options, blobDeleteLimit: 100 });
  }

  const verify = new SqliteTurnJobStore(databasePath, { reconcileOnOpen: false });
  for (const id of ['terminal-a', 'terminal-b', 'terminal-c', 'terminal-d']) assert.equal(verify.getJob(id), null);
  for (const id of [
    'queued-old',
    'leased-old',
    'running-old',
    'waiting-user-old',
    'waiting-approval-old',
    'review-old',
    'final-persisted-old',
    'terminal-recent',
  ]) assert(verify.getJob(id), `${id} must not be pruned`);
  verify.close();

  for (const descriptor of [directPayload, directEvent, directCheckpoint, directTool, directFinal]) {
    assert(fs.existsSync(blobPath(blobRoot, descriptor)), `${descriptor.ref} must be protected by its direct DB reference`);
  }
  assert(!fs.existsSync(blobPath(blobRoot, oldUnreferenced)), 'old unreferenced blob should be deleted');
  assert(fs.existsSync(blobPath(blobRoot, recentUnreferenced)), 'recent unreferenced blob should remain');
  assert(fs.existsSync(blobPath(blobRoot, touchedUnreferenced)), 'recently read blob should remain');

  // The same pass through the production broker proves maintenance executes in
  // a distinct process instead of synchronously on the gateway/test event loop.
  const broker = new RuntimeWorkerBroker({
    name: 'turn-retention-regression',
    entryBasename: 'turn-journal-retention-worker',
    startupTimeoutMs: 15_000,
    defaultJobTimeoutMs: 30_000,
  });
  try {
    const childResult = await broker.run<ReturnType<typeof runTurnJournalRetention>>(
      'turn_journal_retention',
      { ...options, jobBatchLimit: 10, blobDeleteLimit: 100 },
      30_000,
    );
    const childPid = broker.getStatus().pid;
    assert(childPid && childPid !== process.pid, 'retention must execute in a child process');
    assert.equal(typeof childResult.jobsDeleted, 'number');
  } finally {
    await broker.shutdown(1_500);
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('turn retention regression tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
