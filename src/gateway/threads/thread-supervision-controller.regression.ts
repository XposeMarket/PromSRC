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
  const threadOps = await import('./thread-ops');
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
  const recoveredEventId = recovered.pendingEvent?.id;
  supervisionApi.recoverThreadSupervisionReviewLeases();
  assert.equal(supervisionApi.getThreadSupervision(restart.id)?.pendingEvent?.id, recoveredEventId, 'a repeated restart recovery must not duplicate the already released lease');

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

  // A real manager loop is a sequence of bounded wake/review turns in the
  // same owner session, not a replacement task. The first completion claim is
  // rejected for a deficiency; a later target update is independently accepted.
  makeSession('owner_cycles', 'Persistent manager');
  makeSession('target_cycles', 'Managed implementation');
  let cycles = supervisionApi.createThreadSupervision({
    ownerSessionId: 'owner_cycles', targetSessionId: 'target_cycles',
    objective: 'Implement the change and prove it with focused tests.',
    acceptanceCriteria: 'Changed files are reviewed and focused tests pass.', minReviewIntervalMs: 1,
  });
  const expectedRunId = cycles.supervisionRunId;
  const cycleCalls: Array<{ sessionId: string; prompt: string }> = [];
  const deficiencyFollowUps: string[] = [];
  const cycleController = new controllerApi.ActiveThreadSupervisionController({
    pollIntervalMs: 60_000,
    runInteractiveTurn: async (prompt: string, sessionId: string) => {
      if (!prompt.includes(`"supervisionId": "${cycles.id}"`)) return { type: 'chat', text: 'Other supervision is outside this fixture.' };
      cycleCalls.push({ prompt, sessionId });
      const current = supervisionApi.getThreadSupervision(cycles.id)!;
      if (cycleCalls.length === 1) {
        await threadOps.executePrometheusThreadOps('owner_cycles', {
          action: 'send', session_id: 'target_cycles', supervision_id: current.id,
          message: 'Please run and report the missing focused verification before claiming completion.', wait: true,
        }, {
          runInteractiveTurn: async (_message: string, targetSessionId: string) => {
            deficiencyFollowUps.push(targetSessionId);
            return { type: 'chat', text: 'Target received focused verification request.' };
          },
        });
        supervisionApi.resolveThreadSupervisionReview({
          ownerSessionId: current.ownerSessionId, supervisionId: current.id, reviewEventId: current.leasedEventId!,
          decision: 'continue', progressMade: true,
          reason: 'Target claimed completion but did not provide the requested focused test result.',
          evidence: ['Target transcript was inspected; the required verification output is absent.'],
        });
      } else {
        supervisionApi.resolveThreadSupervisionReview({
          ownerSessionId: current.ownerSessionId, supervisionId: current.id, reviewEventId: current.leasedEventId!,
          decision: 'verified_complete', progressMade: true,
          reason: 'Supervisor independently reviewed the final update and focused test evidence.',
          evidence: ['Focused regression passed after the target supplied the missing verification.'],
        });
      }
      return { type: 'chat', text: 'Bounded manager review.' };
    },
  });
  addAssistant('target_cycles', 'Implementation is complete.');
  await cycleController.tick();
  cycles = supervisionApi.getThreadSupervision(cycles.id)!;
  assert.equal(cycles.status, 'active', 'a completion claim with a deficiency must remain supervised');
  assert.deepEqual(deficiencyFollowUps, ['target_cycles'], 'a deficiency must follow up with the existing target thread');
  assert.equal(cycles.followUpCount, 1);
  addAssistant('target_cycles', 'Added the missing focused test and it passes.');
  const doneCycles = sessionApi.getSession('target_cycles');
  doneCycles.mainChatGoal = { id: 'goal_cycles', objective: 'cycle', status: 'done', createdAt: Date.now(), updatedAt: Date.now() } as any;
  sessionApi.flushSession('target_cycles');
  await cycleController.tick();
  cycles = supervisionApi.getThreadSupervision(cycles.id)!;
  assert.equal(cycles.status, 'complete');
  assert.ok(cycleCalls.length >= 2, 'the same workflow must survive multiple wait/review cycles');
  assert.ok(cycleCalls.every((call) => call.sessionId === 'owner_cycles'));
  assert.ok(cycleCalls.every((call) => call.prompt.includes(expectedRunId) && call.prompt.includes('SAME durable supervisory workflow')));

  // Interim output from an active target is retained but not reviewed until
  // the worker becomes idle, avoiding a competing manager turn.
  makeSession('owner_active_wait', 'Active wait owner');
  makeSession('target_active_wait', 'Active wait target');
  const activeWait = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_active_wait', targetSessionId: 'target_active_wait', objective: 'Wait for active work' });
  let activeWaitReviews = 0;
  const activeWaitController = new controllerApi.ActiveThreadSupervisionController({
    runInteractiveTurn: async (prompt: string) => {
      if (!prompt.includes(`"supervisionId": "${activeWait.id}"`)) return { type: 'chat', text: 'Other supervision is outside this fixture.' };
      activeWaitReviews += 1;
      const current = supervisionApi.getThreadSupervision(activeWait.id)!;
      supervisionApi.resolveThreadSupervisionReview({
        ownerSessionId: current.ownerSessionId, supervisionId: current.id, reviewEventId: current.leasedEventId!,
        decision: 'wait', progressMade: true, reason: 'Target became idle after a material update.', evidence: ['Observed target update.'],
      });
      return { type: 'chat', text: 'Reviewed only after idle.' };
    },
  });
  const activeWaitRuntime = runtimeApi.registerLiveRuntime({ kind: 'main_chat', label: 'active target', sessionId: 'target_active_wait' });
  addAssistant('target_active_wait', 'Interim progress while target is still running.');
  await activeWaitController.tick();
  assert.equal(activeWaitReviews, 0, 'active target should be waited on, not reviewed concurrently');
  runtimeApi.finishLiveRuntime(activeWaitRuntime);
  await activeWaitController.tick();
  assert.equal(activeWaitReviews, 1, 'idle transition should wake the same supervision for review');

  // The bounded fallback poll must be quiet when its observation fingerprint
  // has not changed: no persistence churn and no managed-thread UI event.
  makeSession('owner_quiet', 'Quiet owner');
  makeSession('target_quiet', 'Quiet target');
  const quiet = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_quiet', targetSessionId: 'target_quiet', objective: 'Wait quietly' });
  const quietEvents: any[] = [];
  const quietController = new controllerApi.ActiveThreadSupervisionController({
    broadcast: (event: any) => quietEvents.push(event),
    runInteractiveTurn: async () => ({ type: 'chat', text: 'not used' }),
  });
  await quietController.tick();
  const quietFirst = supervisionApi.getThreadSupervision(quiet.id)!;
  const eventsAfterFirst = quietEvents.filter((event) => event.supervision?.id === quiet.id).length;
  await quietController.tick();
  const quietSecond = supervisionApi.getThreadSupervision(quiet.id)!;
  assert.equal(quietSecond.updatedAt, quietFirst.updatedAt, 'no-change fallback poll must not rewrite the supervision record');
  assert.equal(quietEvents.filter((event) => event.supervision?.id === quiet.id).length, eventsAfterFirst, 'no-change fallback poll must not publish UI noise');

  // Same content must not repeatedly steer a running target, and live controls
  // revise/pause/resume the one durable record rather than creating a new one.
  makeSession('owner_controls', 'Control owner');
  makeSession('target_controls', 'Control target');
  let controls = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_controls', targetSessionId: 'target_controls', objective: 'Original objective' });
  const targetRuntime = runtimeApi.registerLiveRuntime({ kind: 'main_chat', label: 'running target', sessionId: 'target_controls' });
  const firstSteer = await threadOps.executePrometheusThreadOps('owner_controls', {
    action: 'steer', session_id: 'target_controls', supervision_id: controls.id, message: 'Run the focused verification next.',
  }, {});
  const duplicateSteer = await threadOps.executePrometheusThreadOps('owner_controls', {
    action: 'steer', session_id: 'target_controls', supervision_id: controls.id, message: 'Run the focused verification next.',
  }, {});
  assert.equal(firstSteer.ok, true);
  assert.equal(duplicateSteer.deduped, true, 'duplicate guidance must not consume another intervention');
  controls = supervisionApi.getThreadSupervision(controls.id)!;
  assert.equal(controls.followUpCount, 1);
  controls = (await threadOps.executePrometheusThreadOps('owner_controls', {
    action: 'revise_supervision', supervision_id: controls.id, objective: 'Revised objective', acceptance_criteria: 'New focused test passes',
  }, {})).supervision;
  assert.equal(controls.objectiveRevision, 2);
  assert.equal(controls.targetSessionId, 'target_controls');
  controls = (await threadOps.executePrometheusThreadOps('owner_controls', { action: 'pause_supervision', supervision_id: controls.id }, {})).supervision;
  assert.equal(controls.status, 'paused');
  controls = (await threadOps.executePrometheusThreadOps('owner_controls', { action: 'resume_supervision', supervision_id: controls.id }, {})).supervision;
  assert.equal(controls.status, 'active');
  runtimeApi.finishLiveRuntime(targetRuntime);

  // A missing session is a terminal, explicit failure rather than silently
  // creating a replacement target or polling forever.
  const missing = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_controls', targetSessionId: 'missing_target_thread', objective: 'Cannot be observed' });
  await cycleController.tick();
  assert.equal(supervisionApi.getThreadSupervision(missing.id)?.status, 'failed');

  // A target that reports an actual blocker is escalated through the
  // authoritative decision path, rather than being treated as completion.
  makeSession('owner_blocked', 'Blocked owner');
  makeSession('target_blocked', 'Blocked target');
  const blocked = supervisionApi.createThreadSupervision({ ownerSessionId: 'owner_blocked', targetSessionId: 'target_blocked', objective: 'Needs user choice' });
  const blockedTarget = sessionApi.getSession('target_blocked');
  blockedTarget.mainChatGoal = { id: 'goal_blocked', objective: 'blocked', status: 'blocked', createdAt: Date.now(), updatedAt: Date.now() } as any;
  sessionApi.flushSession('target_blocked');
  const blockedController = new controllerApi.ActiveThreadSupervisionController({
    runInteractiveTurn: async (prompt: string) => {
      if (!prompt.includes(`"supervisionId": "${blocked.id}"`)) return { type: 'chat', text: 'Other supervision is outside this fixture.' };
      const current = supervisionApi.getThreadSupervision(blocked.id)!;
      supervisionApi.resolveThreadSupervisionReview({
        ownerSessionId: current.ownerSessionId, supervisionId: current.id, reviewEventId: current.leasedEventId!,
        decision: 'needs_user', progressMade: false, reason: 'Target requires a user decision before it can continue.', evidence: ['Target goal is blocked.'],
      });
      return { type: 'chat', text: 'Escalated blocker.' };
    },
  });
  await blockedController.tick();
  assert.equal(supervisionApi.getThreadSupervision(blocked.id)?.status, 'blocked');
  assert.equal(supervisionApi.getThreadSupervision(blocked.id)?.finalVerificationState, 'escalated');

  console.log('PASS: active Prometheus supervision persistence, review cycles, verification, follow-up safeguards, controls, and restart recovery');
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
