import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-active-supervision-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');

async function main(): Promise<void> {
try {
  const sessionApi = await import('../session');
  const runtimeApi = await import('../live-runtime-registry');
  const supervisionApi = await import('./thread-supervision');
  const controllerApi = await import('./thread-supervision-controller');
  const toolDefs = await import('../tools/defs/agent-team-schedule');

  const forcedReviewTools = toolDefs.ensurePrometheusThreadOpsForSupervision([], true);
  assert.equal(forcedReviewTools.length, 1);
  assert.equal(forcedReviewTools[0]?.function?.name, 'prometheus_thread_ops', 'synthetic review must receive the one existing peer-session tool even when its category is inactive');

  const makeSession = (id: string, title: string) => {
    sessionApi.touchSession(id, { channel: 'web', title });
    sessionApi.flushSession(id);
  };
  const addAssistant = (id: string, content: string) => {
    sessionApi.addMessage(id, { role: 'assistant', content, timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    sessionApi.flushSession(id);
  };
  const observeAndPersist = (record: any, runtimeState: 'running' | 'idle' = 'idle') => {
    const patch = controllerApi.observeThreadSupervision(record, runtimeState, Date.now());
    return supervisionApi.updateThreadSupervisionsBatch([{ id: record.id, patch }])[0];
  };

  makeSession('owner_restart', 'Restart owner');
  makeSession('target_restart', 'Restart target');
  let restarted = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_restart', targetSessionId: 'target_restart', objective: 'Continue after restart', minReviewIntervalMs: 1,
  });
  restarted = supervisionApi.updateThreadSupervision(restarted.id, {
    lastObservedRuntimeState: 'running',
    lastObservedMessageCount: 0,
  })!;
  sessionApi.addMessage('target_restart', {
    role: 'assistant',
    messageKind: 'restart_status',
    content: 'The gateway restarted and preserved the current checkpoint.',
    timestamp: Date.now(),
  }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
  sessionApi.flushSession('target_restart');
  restarted = observeAndPersist(restarted, 'idle');
  assert.ok(restarted.pendingEvent?.types.includes('gateway_restart_interruption'));
  assert.ok(restarted.pendingEvent?.types.includes('running_to_idle'));
  assert.equal(restarted.status, 'active', 'restart interruption must remain a non-terminal supervision event');
  supervisionApi.cancelThreadSupervision(restarted.id);

  makeSession('owner_coalesce', 'Coalesce owner');
  makeSession('target_coalesce', 'Coalesce target');
  let coalesced = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_coalesce', targetSessionId: 'target_coalesce', objective: 'Coalesce new evidence', minReviewIntervalMs: 1,
  });
  addAssistant('target_coalesce', 'First implementation update.');
  coalesced = observeAndPersist(coalesced);
  const firstEventId = coalesced.pendingEvent?.id;
  addAssistant('target_coalesce', 'Second implementation update with more files.');
  coalesced = observeAndPersist(supervisionApi.getThreadSupervision(coalesced.id)!);
  assert.equal(coalesced.pendingReview, true);
  assert.notEqual(coalesced.pendingEvent?.id, firstEventId);
  assert.equal(coalesced.pendingEvent?.messages.length, 2, 'new assistant events should coalesce without duplication');

  const doneTarget = sessionApi.getSession('target_coalesce');
  doneTarget.mainChatGoal = { id: 'goal_done', objective: 'done test', status: 'done', createdAt: Date.now(), updatedAt: Date.now() } as any;
  sessionApi.flushSession('target_coalesce');
  coalesced = observeAndPersist(supervisionApi.getThreadSupervision(coalesced.id)!);
  assert.equal(coalesced.status, 'active', 'target done must enqueue review, never auto-complete');
  assert.ok(coalesced.pendingEvent?.types.includes('goal_done'));
  supervisionApi.cancelThreadSupervision(coalesced.id);

  makeSession('owner_busy', 'Busy owner');
  makeSession('target_busy', 'Busy target');
  let busy = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_busy', targetSessionId: 'target_busy', objective: 'Defer until owner idle', minReviewIntervalMs: 1,
  });
  addAssistant('target_busy', 'A meaningful target update.');
  let reviewCalls = 0;
  const controller = new controllerApi.ActiveThreadSupervisionController({
    pollIntervalMs: 60_000,
    runInteractiveTurn: async () => {
      reviewCalls += 1;
      const current = supervisionApi.getThreadSupervision(busy.id)!;
      supervisionApi.resolveThreadSupervisionReview({
        ownerSessionId: current.ownerSessionId,
        supervisionId: current.id,
        reviewEventId: current.leasedEventId!,
        decision: 'wait',
        progressMade: false,
        reason: 'Target update is real but does not yet verify the objective.',
        evidence: [],
      });
      return { type: 'chat', text: 'Reviewed via authoritative tool action.' };
    },
  });
  const ownerRuntime = runtimeApi.registerLiveRuntime({ kind: 'main_chat', label: 'busy owner test', sessionId: 'owner_busy' });
  await controller.tick();
  assert.equal(reviewCalls, 0, 'busy owner must defer without surprise steering or a simultaneous turn');
  busy = supervisionApi.getThreadSupervision(busy.id)!;
  assert.equal(busy.pendingReview, true);
  runtimeApi.finishLiveRuntime(ownerRuntime);
  await controller.tick();
  assert.equal(reviewCalls, 1, 'pending review should run once owner becomes idle');
  busy = supervisionApi.getThreadSupervision(busy.id)!;
  assert.equal(busy.reviewCount, 1);
  assert.equal(busy.consecutiveNoProgressCount, 1, 'no-progress is based on explicit supervisor judgment, not message activity');

  makeSession('owner_attempts', 'Attempt owner');
  makeSession('target_attempts', 'Attempt target');
  const attempts = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_attempts', targetSessionId: 'target_attempts', objective: 'Bound broken reviews',
    minReviewIntervalMs: 1, maxReviews: 1,
  });
  addAssistant('target_attempts', 'Trigger one review attempt.');
  let attemptClock = Date.now();
  let attemptCalls = 0;
  const brokenController = new controllerApi.ActiveThreadSupervisionController({
    now: () => attemptClock,
    runInteractiveTurn: async () => {
      attemptCalls += 1;
      return { type: 'chat', text: 'Omitted the required decision.' };
    },
  });
  await brokenController.tick();
  assert.equal(attemptCalls, 1);
  assert.equal(supervisionApi.getThreadSupervision(attempts.id)?.reviewCount, 1, 'model attempts count even when the turn omits review_decision');
  attemptClock += 100;
  await brokenController.tick();
  assert.equal(attemptCalls, 1, 'review-attempt budget must prevent an infinite broken-controller loop');
  assert.equal(supervisionApi.getThreadSupervision(attempts.id)?.finalVerificationState, 'budget_exhausted');

  makeSession('cycle_a', 'Cycle A');
  makeSession('cycle_b', 'Cycle B');
  makeSession('cycle_other', 'Cycle other');
  supervisionApi.createThreadSupervision({ ownerSessionId: 'cycle_a', targetSessionId: 'cycle_b', objective: 'A supervises B' });
  assert.throws(
    () => supervisionApi.createThreadSupervision({ ownerSessionId: 'cycle_b', targetSessionId: 'cycle_a', objective: 'B supervises A' }),
    /cycle/i,
  );
  assert.throws(
    () => supervisionApi.createThreadSupervision({ ownerSessionId: 'cycle_other', targetSessionId: 'cycle_b', objective: 'Unsafe second owner' }),
    /already supervised/i,
  );

  makeSession('owner_budget', 'Budget owner');
  makeSession('target_budget', 'Budget target');
  let budgeted = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_budget', targetSessionId: 'target_budget', objective: 'Budget protection', maxFollowUps: 1,
  });
  supervisionApi.assertThreadSupervisionFollowUpAllowed({ ownerSessionId: 'owner_budget', targetSessionId: 'target_budget', supervisionId: budgeted.id });
  supervisionApi.commitThreadSupervisionFollowUp(budgeted.id);
  assert.throws(
    () => supervisionApi.assertThreadSupervisionFollowUpAllowed({ ownerSessionId: 'owner_budget', targetSessionId: 'target_budget', supervisionId: budgeted.id }),
    /budget exhausted/i,
  );
  budgeted = supervisionApi.getThreadSupervision(budgeted.id)!;
  assert.equal(budgeted.finalVerificationState, 'budget_exhausted');

  makeSession('owner_restart', 'Restart owner');
  makeSession('target_restart', 'Restart target');
  let restart = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_restart', targetSessionId: 'target_restart', objective: 'Recover review lease' });
  addAssistant('target_restart', 'Evidence before simulated restart.');
  restart = observeAndPersist(restart);
  restart = supervisionApi.updateThreadSupervision(restart.id, {
    reviewInFlight: true,
    leasedEventId: restart.pendingEvent!.id,
    leasedEvent: restart.pendingEvent,
    pendingEvent: undefined,
    pendingReview: false,
  })!;
  supervisionApi.recoverThreadSupervisionReviewLeases();
  const recovered = supervisionApi.getThreadSupervision(restart.id)!;
  assert.equal(recovered.reviewInFlight, false, 'restart must release durable in-flight lease');
  assert.equal(recovered.pendingReview, true, 'restart must idempotently requeue leased event');
  assert.ok(recovered.pendingEvent?.messages.some((message: any) => /Evidence before/.test(message.excerpt)));

  makeSession('owner_hash', 'Hash owner');
  makeSession('target_hash', 'Hash target');
  let hashed = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_hash', targetSessionId: 'target_hash', objective: 'Keep leased cursor stable' });
  addAssistant('target_hash', 'Leased evidence version one.');
  hashed = observeAndPersist(hashed);
  const leasedHash = hashed.pendingEvent!.observedMessageHash;
  hashed = supervisionApi.updateThreadSupervision(hashed.id, {
    reviewInFlight: true,
    leasedEventId: hashed.pendingEvent!.id,
    leasedEvent: hashed.pendingEvent,
    pendingEvent: undefined,
    pendingReview: false,
  })!;
  addAssistant('target_hash', 'Newer evidence arrived during the leased review.');
  hashed = observeAndPersist(supervisionApi.getThreadSupervision(hashed.id)!);
  const hashDecision = supervisionApi.resolveThreadSupervisionReview({
    ownerSessionId: 'owner_hash', supervisionId: hashed.id, reviewEventId: hashed.leasedEventId!,
    decision: 'wait', progressMade: false, reason: 'The leased snapshot is not complete yet.', evidence: [],
  });
  assert.equal(hashDecision.lastReviewedMessageHash, leasedHash, 'review cursor hash must describe the leased event, not newer activity');
  assert.equal(hashDecision.pendingReview, true, 'new activity during a review must remain queued for the next bounded review');

  makeSession('owner_verify', 'Verify owner');
  makeSession('target_verify', 'Verify target');
  let verified = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_verify', targetSessionId: 'target_verify', objective: 'Require authoritative verification' });
  addAssistant('target_verify', 'I am done. Tests pass.');
  verified = observeAndPersist(verified);
  verified = supervisionApi.updateThreadSupervision(verified.id, {
    reviewInFlight: true,
    leasedEventId: verified.pendingEvent!.id,
    leasedEvent: verified.pendingEvent,
    pendingEvent: undefined,
    pendingReview: false,
  })!;
  const resolved = supervisionApi.resolveThreadSupervisionReview({
    ownerSessionId: 'owner_verify', supervisionId: verified.id, reviewEventId: verified.leasedEventId!,
    decision: 'verified_complete', progressMade: true,
    reason: 'Supervisor inspected the target output and verification result.',
    evidence: ['Focused regression command passed with exit code 0.'],
  });
  assert.equal(resolved.status, 'complete');
  assert.equal(resolved.finalVerificationState, 'verified');

  console.log('PASS: active Prometheus supervision coalescing, verification, deferral, safeguards, budgets, and restart recovery');
} finally {
  const resolved = path.resolve(tempRoot);
  const tempBase = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${tempBase}${path.sep}`)) fs.rmSync(resolved, { recursive: true, force: true });
}
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
