import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-task-cancel-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  // Load through require so the test and task-router share ONE runner module instance
  // (mixed import()/require can load background-task-runner twice and split its state).
  const taskStore: typeof import('./task-store') = require('./task-store');
  const router: typeof import('./task-router') = require('./task-router');
  const { BackgroundTaskRunner }: typeof import('./background-task-runner') = require('./background-task-runner');
  const mt: typeof import('../teams/managed-teams') = require('../teams/managed-teams');

  const sessionId = 'sess_cancel_terminal';
  const makeTask = (title: string) => taskStore.createTask({
    title,
    prompt: `${title} prompt`,
    sessionId,
    channel: 'web',
    plan: [{ index: 0, description: 'Do it', status: 'pending' } as any],
  } as any);

  // 1) Idle cancel: status failed immediately, never paused/user_pause.
  const idle = makeTask('idle cancel');
  const idleRes: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: idle.id, confirm: true, note: 'stop it' });
  assert.equal(idleRes.success, true, 'idle cancel succeeds');
  const idleAfter = taskStore.loadTask(idle.id)!;
  assert.equal(idleAfter.status, 'failed', 'idle cancel is terminal failed');
  assert.notEqual(idleAfter.pauseReason, 'user_pause', 'idle cancel is not a resumable user_pause');
  assert.equal(idleAfter.finalSummary, 'Cancelled via task_control: stop it', 'cancel reason recorded as finalSummary');
  assert.equal(BackgroundTaskRunner.isRunning(idle.id), false, 'cancel starts no runner');

  // 2) Already terminal: cancel of a failed or complete task is a refused no-op.
  const terminalRes: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: idle.id, confirm: true });
  assert.equal(terminalRes.success, false, 'cancel of failed task is refused');
  assert.equal(terminalRes.code, 'already_terminal');
  const idleAgain = taskStore.loadTask(idle.id)!;
  assert.equal(idleAgain.status, 'failed', 'terminal status unchanged');
  assert.equal(idleAgain.finalSummary, 'Cancelled via task_control: stop it', 'terminal summary unchanged');
  const done = makeTask('already complete');
  taskStore.updateTaskStatus(done.id, 'complete', { finalSummary: 'done' } as any);
  const doneRes: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: done.id, confirm: true });
  assert.equal(doneRes.code, 'already_terminal', 'cancel of complete task is refused');
  assert.equal(taskStore.loadTask(done.id)!.status, 'complete', 'complete status unchanged');

  // 3) Pause still resumable: pause writes paused/user_pause (unchanged behaviour).
  const pausable = makeTask('pause me');
  const pauseRes: any = await router.handleTaskControlAction(sessionId, { action: 'pause', task_id: pausable.id, confirm: true });
  assert.equal(pauseRes.success, true, 'pause succeeds');
  const pausedAfter = taskStore.loadTask(pausable.id)!;
  assert.equal(pausedAfter.status, 'paused', 'pause writes paused');
  assert.equal(pausedAfter.pauseReason, 'user_pause', 'pause is user_pause (resumable)');

  // 4) Cancel of a paused task is terminal, not a pause.
  const pausedToCancel = makeTask('paused then cancelled');
  await router.handleTaskControlAction(sessionId, { action: 'pause', task_id: pausedToCancel.id });
  const cancelPaused: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: pausedToCancel.id, confirm: true });
  assert.equal(cancelPaused.success, true, 'cancel of paused task succeeds');
  assert.equal(taskStore.loadTask(pausedToCancel.id)!.status, 'failed', 'cancel of paused task is failed');

  // 5) Running-cancel race through the real runner: cancel lands while a round is in
  //    flight; the runner's pause exit must not overwrite failed with paused.
  const runCancel = makeTask('running cancel');
  let cancelFired = false;
  const cancelRunner = new BackgroundTaskRunner(runCancel.id, (async () => {
    if (!cancelFired) {
      cancelFired = true;
      const res: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: runCancel.id, confirm: true, note: 'mid-round' });
      assert.equal(res.success, true, 'cancel during a live round succeeds');
    }
    return { type: 'text', text: 'round output' } as any;
  }) as any, () => {}, null);
  await cancelRunner.start();
  assert.equal(cancelFired, true, 'runner executed a round');
  const runCancelAfter = taskStore.loadTask(runCancel.id)!;
  assert.equal(runCancelAfter.status, 'failed', 'running cancel stays failed after the runner exits, not paused');
  assert.equal(runCancelAfter.finalSummary, 'Cancelled via task_control: mid-round');
  assert.equal(BackgroundTaskRunner.isRunning(runCancel.id), false, 'runner released after cancel');

  // 6) Running-pause through the same runner path is still a resumable pause.
  const runPause = makeTask('running pause');
  let pauseFired = false;
  const pauseRunner = new BackgroundTaskRunner(runPause.id, (async () => {
    if (!pauseFired) {
      pauseFired = true;
      await router.handleTaskControlAction(sessionId, { action: 'pause', task_id: runPause.id });
    }
    return { type: 'text', text: 'round output' } as any;
  }) as any, () => {}, null);
  await pauseRunner.start();
  assert.equal(pauseFired, true, 'pause runner executed a round');
  const runPauseAfter = taskStore.loadTask(runPause.id)!;
  assert.equal(runPauseAfter.status, 'paused', 'running pause ends paused');
  assert.equal(runPauseAfter.pauseReason, 'user_pause', 'running pause stays resumable');

  // 7) No automatic resurrection. A cancelled task is `failed`, so (like any failed task)
  //    findBlockedTaskForSession may surface it as blocked/attention context. That lookup
  //    is read-only: the task stays failed with no runner until the user explicitly
  //    resumes/reruns it (a new attempt). user_pause tasks stay excluded.
  const blocked = router.findBlockedTaskForSession(sessionId);
  assert.ok(!blocked || blocked.pauseReason !== 'user_pause', 'a user_pause task is not a blocked candidate');
  for (const id of [idle.id, pausedToCancel.id, runCancel.id]) {
    const t = taskStore.loadTask(id)!;
    assert.equal(t.status, 'failed', `cancelled task ${id} not resurrected by lookup`);
    assert.equal(BackgroundTaskRunner.isRunning(id), false, `cancelled task ${id} has no runner`);
  }
  // A non-intent follow-up does not touch the cancelled task.
  // (It may return a read-only status message; it must not resume/rerun anything.)
  const noIntent = await router.tryHandleBlockedTaskFollowup(sessionId, 'thanks, looks good');
  assert.ok(!/^(Resuming|Rerunning)/.test(String(noIntent || '')), 'plain follow-up does not resume/rerun a cancelled task');
  assert.equal(BackgroundTaskRunner.isRunning(runCancel.id), false, 'plain follow-up starts no runner');
  assert.equal(taskStore.loadTask(runCancel.id)!.status, 'failed', 'plain follow-up leaves cancelled task failed');

  // 8) Team dispatch reconcile: a running dispatch whose task was cancelled (failed) is
  //    settled; a dispatch whose task is paused/user_pause is NOT settled.
  const now = Date.now();
  const store = mt.loadManagedTeamStore();
  store.teams.push({
    id: 'team_cancel', name: 'Cancel', subagentIds: [], managerAgentId: 'team_cancel_manager',
    purpose: 'p', currentFocus: 'g', teamChat: [], runHistory: [], createdAt: now, updatedAt: now,
    roomState: {
      purpose: 'p', runGoal: 'g', roomMessages: [], managerInbox: [], memberStates: {}, sharedArtifacts: [],
      dispatches: [
        { id: 'd_cancelled', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: runCancel.id, createdAt: now - 60_000 },
        { id: 'd_paused', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: pausable.id, createdAt: now - 60_000 },
      ],
    },
  } as any);
  mt.saveManagedTeamStore(store);
  const fixed = mt.reconcileStaleTeamDispatches(now, (id) => taskStore.loadTask(id));
  assert.equal(fixed, 1, 'exactly one dispatch settled');
  const team = mt.loadManagedTeamStore().teams.find((t: any) => t.id === 'team_cancel')!;
  const byId = Object.fromEntries((team.roomState!.dispatches as any[]).map((d) => [d.id, d]));
  assert.equal(byId.d_cancelled.status, 'failed', 'cancelled task dispatch settles failed');
  assert.equal(byId.d_paused.status, 'running', 'paused/user_pause dispatch is not settled');

  // ── Stage 1: durable stop intent ──────────────────────────────────────────
  const { agentRunCanRecover }: typeof import('../agents-runtime/subagent-executor') = require('../agents-runtime/subagent-executor');
  const tdr: typeof import('../teams/team-dispatch-runtime') = require('../teams/team-dispatch-runtime');
  const lrr: typeof import('../live-runtime-registry') = require('../live-runtime-registry');

  // 9) task_control cancel writes stopIntent {source:'task_control'}; reload keeps it.
  assert.equal(idleAfter.stopIntent?.source, 'task_control', 'task_control cancel records its source');
  assert.equal(taskStore.loadTask(idle.id)!.stopIntent?.by, 'user');
  // Direct API callers default to source 'api' (no fabricated channel).
  const apiTask = makeTask('api cancel');
  BackgroundTaskRunner.cancelTask(apiTask.id, 'api reason');
  assert.equal(taskStore.loadTask(apiTask.id)!.stopIntent?.source, 'api', 'default stop source is api');

  // 10) NL cancel in the recovery conversation is terminal (not pause), source nl.
  const nlBlocked = makeTask('nl blocked');
  taskStore.updateTaskStatus(nlBlocked.id, 'needs_assistance');
  const nlRes = await router.handleTaskRecoveryMessage(nlBlocked.id, 'cancel that task', { sourceSessionId: sessionId });
  assert.equal(nlRes.handled, true, 'NL cancel handled');
  const nlAfter = taskStore.loadTask(nlBlocked.id)!;
  assert.equal(nlAfter.status, 'failed', 'NL cancel is failed, never paused');
  assert.equal(nlAfter.stopIntent?.source, 'nl', 'NL cancel records source nl');
  // A following "continue" does not resume it, and it is no longer a blocked candidate.
  assert.notEqual(router.findBlockedTaskForSession(sessionId)?.id, nlBlocked.id, 'stopped task is not a blocked candidate');
  const cont = await router.tryHandleBlockedTaskFollowup(sessionId, 'continue');
  assert.ok(!/^(Resuming|Rerunning|Resumed)/.test(String(cont || '')), 'continue does not resume a stopped task');
  assert.equal(taskStore.loadTask(nlBlocked.id)!.status, 'failed', 'stopped task stays failed after continue');
  const recRes = await router.handleTaskRecoveryMessage(nlBlocked.id, 'go ahead', { sourceSessionId: sessionId });
  assert.equal(recRes.handled, false, 'recovery conversation refuses a stopped task');

  // 11) NL cancel while a clarification is pending is terminal too.
  const clar = makeTask('clarification cancel');
  taskStore.updateTaskStatus(clar.id, 'awaiting_user_input');
  await router.tryHandleBlockedTaskFollowup(sessionId, 'cancel that task');
  const clarAfter = taskStore.loadTask(clar.id)!;
  assert.equal(clarAfter.status, 'failed', 'clarification NL cancel is failed');
  assert.equal(clarAfter.stopIntent?.source, 'nl');

  // 12) NL cancel with an explicit task id (Path A) is terminal.
  const pathA = makeTask('path a cancel');
  taskStore.updateTaskStatus(pathA.id, 'needs_assistance');
  await router.tryHandleBlockedTaskFollowup(sessionId, `please cancel task ${pathA.id}`);
  const pathAAfter = taskStore.loadTask(pathA.id)!;
  assert.equal(pathAAfter.status, 'failed', 'Path A NL cancel is failed');
  assert.equal(pathAAfter.stopIntent?.source, 'nl');

  // 13) Resume / auto-recovery refuse a stopped task; late completion cannot wipe it.
  const resumeRes: any = await router.handleTaskControlAction(sessionId, { action: 'resume', task_id: nlBlocked.id });
  assert.equal(resumeRes.code, 'stopped_by_operator', 'resume refuses a stopped task');
  assert.equal(agentRunCanRecover(taskStore.loadTask(nlBlocked.id)!), false, 'agent_run recover selector refuses a stopped task');
  taskStore.updateTaskStatus(nlBlocked.id, 'complete', { finalSummary: 'late result' });
  taskStore.updateTaskStatus(nlBlocked.id, 'paused', { pauseReason: 'error' });
  taskStore.updateTaskStatus(nlBlocked.id, 'failed', { finalSummary: 'Team agent failed.' });
  const lateAfter = taskStore.loadTask(nlBlocked.id)!;
  assert.equal(lateAfter.status, 'failed', 'late completion/pause cannot rewrite a stop');
  assert.equal(lateAfter.stopIntent?.source, 'nl', 'late writes keep stopIntent');
  assert.equal(lateAfter.finalSummary, nlAfter.finalSummary, 'late generic failure keeps the stop summary');

  // 14) Explicit rerun with task_id is the only way back: clears stopIntent, journals the stop.
  // Isolated runner deps: the rerun launch must never reach a real model.
  if (!router.isTaskRouterInitialized()) {
    router.initTaskRouter({ handleChat: () => new Promise(() => {}), telegramChannel: null, makeBroadcastForTask: () => () => {}, cronScheduler: null } as any);
  }
  const rerunNoId: any = await router.handleTaskControlAction(sessionId, { action: 'resume' });
  assert.notEqual(rerunNoId.success, true, 'id-less resume never picks up a stopped task');
  const rerunRes: any = await router.handleTaskControlAction(sessionId, { action: 'rerun', task_id: nlBlocked.id });
  assert.equal(rerunRes.success, true, 'explicit rerun accepted');
  const rerunAfter = taskStore.loadTask(nlBlocked.id)!;
  assert.equal(rerunAfter.stopIntent, undefined, 'rerun clears stopIntent');
  assert.equal(rerunAfter.currentStepIndex, 0, 'rerun resets the attempt');
  assert.ok(rerunAfter.journal.some((j: any) => String(j.content).startsWith('rerun_after_stop')), 'journal preserves the stop');
  BackgroundTaskRunner.cancelTask(nlBlocked.id, 'test cleanup');

  // 15) Negative: pause has no stopIntent and stays resumable; genuine failure stays recoverable.
  assert.equal(taskStore.loadTask(pausable.id)!.stopIntent, undefined, 'pause sets no stopIntent');
  const genuine = makeTask('genuine failure');
  taskStore.updateTaskStatus(genuine.id, 'failed', { finalSummary: 'ERROR: provider crashed' });
  const genuineAfter = taskStore.loadTask(genuine.id)!;
  assert.equal(genuineAfter.stopIntent, undefined, 'genuine failure has no stopIntent');
  assert.equal(agentRunCanRecover(genuineAfter), true, 'genuine failure stays recoverable');
  assert.equal(router.findBlockedTaskForSession(sessionId)?.id, genuine.id, 'genuine failure is still a blocked candidate');

  // 16) team_bg cancel resolves the real task + runtime + dispatch record.
  const bgTask = makeTask('team bg run');
  taskStore.updateTaskStatus(bgTask.id, 'running');
  const abortSignal: any = { aborted: false };
  const runtimeId = lrr.registerLiveRuntime({ kind: 'team_member', label: 'bg', sessionId: 'team_sess', taskId: bgTask.id, teamId: 'team_cancel', agentId: 'a', source: 'team_dispatch', abortSignal } as any);
  tdr._bgAgentResults.set('team_bg_live', { status: 'running', agentId: 'a', teamId: 'team_cancel', startedAt: now, promise: new Promise(() => {}), taskId: bgTask.id, runtimeId });
  const st = mt.loadManagedTeamStore();
  st.teams.find((t: any) => t.id === 'team_cancel')!.roomState!.dispatches.push({ id: 'd_bg', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: 'team_bg_live', createdAt: now } as any);
  mt.saveManagedTeamStore(st);
  const noConfirm: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: 'team_bg_live' });
  assert.equal(noConfirm.code, 'needs_confirmation', 'team_bg cancel keeps the confirmation gate');
  const bgRes: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: 'team_bg_live', confirm: true });
  assert.equal(bgRes.success, true, 'team_bg cancel succeeds');
  const bgAfter = taskStore.loadTask(bgTask.id)!;
  assert.equal(bgAfter.status, 'failed');
  assert.equal(bgAfter.stopIntent?.source, 'team_bg');
  assert.equal(abortSignal.aborted, true, 'live runtime aborted');
  const dispatchOf = () => (mt.getManagedTeam('team_cancel')!.roomState!.dispatches as any[]).find((d) => d.id === 'd_bg');
  assert.equal(dispatchOf().status, 'failed', 'dispatch record failed');
  assert.equal(dispatchOf().stopIntent?.source, 'team_bg', 'dispatch record carries stopIntent');
  mt.updateTeamDispatchRecord('team_cancel', 'd_bg', { status: 'completed', resultPreview: 'late' });
  assert.equal(dispatchOf().status, 'failed', 'late completion cannot flip a stopped dispatch');
  assert.equal(dispatchOf().stopIntent?.source, 'team_bg');
  // Missing entry (restart): truthful not_found, nothing changed.
  const gone: any = await router.handleTaskControlAction(sessionId, { action: 'cancel', task_id: 'team_bg_gone', confirm: true });
  assert.equal(gone.code, 'not_found', 'team_bg cancel after restart is not_found');
  // Reconcile copies stopIntent from a stopped task onto its dispatch.
  const st2 = mt.loadManagedTeamStore();
  st2.teams.find((t: any) => t.id === 'team_cancel')!.roomState!.dispatches.push({ id: 'd_rec', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: clar.id, createdAt: now } as any);
  mt.saveManagedTeamStore(st2);
  mt.reconcileStaleTeamDispatches(Date.now(), (id) => taskStore.loadTask(id));
  const rec = (mt.getManagedTeam('team_cancel')!.roomState!.dispatches as any[]).find((d) => d.id === 'd_rec');
  assert.equal(rec.status, 'failed');
  assert.equal(rec.stopIntent?.source, 'nl', 'reconcile copies stopIntent');

  console.log('task-cancel-terminal regression: PASS');
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
