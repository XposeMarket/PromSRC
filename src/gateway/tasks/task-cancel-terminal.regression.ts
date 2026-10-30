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

  console.log('task-cancel-terminal regression: PASS');
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
