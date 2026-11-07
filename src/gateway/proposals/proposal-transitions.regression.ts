/**
 * Proposal lifecycle transition guards (state-machine audit 2026-11-06).
 * Every store setter checks PROPOSAL_STATUS_TRANSITIONS; illegal moves are
 * refused without saving, and dispatch re-reads the durable status before it
 * creates an executor task.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-proposal-transitions-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function run(): Promise<void> {
  const store = await import('./proposal-store.js');
  const {
    PROPOSAL_STATUS_TRANSITIONS,
    approveProposal,
    canTransitionProposal,
    createProposal,
    denyProposal,
    loadProposal,
    markProposalExecuted,
    markProposalExecuting,
    markProposalFailed,
    markProposalRepairing,
    saveProposal,
  } = store;
  const { denyProposalAction, dispatchApprovedProposal } = await import('../routes/proposals.router.js');
  const { listTasks } = await import('../tasks/task-store.js');

  let n = 0;
  const make = (overrides: Record<string, unknown> = {}) => createProposal({
    type: 'general',
    priority: 'medium',
    title: `Transition fixture ${++n}`,
    summary: 'Transition guard regression proposal.',
    details: 'Bounded fixture with no external side effects.',
    sourceAgentId: 'proposal-transition-regression',
    affectedFiles: [],
    requiresBuild: false,
    ...overrides,
  } as any);
  const statusOf = (id: string) => loadProposal(id)?.status;
  const force = (id: string, patch: Record<string, unknown>) => saveProposal({ ...loadProposal(id)!, ...patch } as any);
  const startedWork = (id: string) => {
    markProposalExecuting(id, 'task_should_not_attach');
    markProposalRepairing(id, 'should not reopen');
    markProposalExecuted(id, 'should not finish');
    markProposalFailed(id, 'should not fail');
  };

  // ── table shape ─────────────────────────────────────────────────────────────
  assert.deepEqual(
    Object.keys(PROPOSAL_STATUS_TRANSITIONS).sort(),
    ['approved', 'denied', 'executed', 'executing', 'expired', 'failed', 'pending', 'repairing'],
  );
  assert.equal(canTransitionProposal('executing', 'executing'), true, 'same-state calls stay idempotent');
  assert.equal(canTransitionProposal('denied', 'executing'), false);
  assert.equal(canTransitionProposal('expired', 'pending'), false, 'expired is terminal');
  assert.equal(canTransitionProposal('executed', 'expired'), true, 'archive sweep still allowed');

  // ── pending cannot skip approval ────────────────────────────────────────────
  const pending = make();
  startedWork(pending.id);
  assert.equal(statusOf(pending.id), 'pending', 'pending proposal never starts without approval');
  assert.equal(loadProposal(pending.id)?.executorTaskId, undefined, 'no task attached to a pending proposal');

  // ── denied stays denied ─────────────────────────────────────────────────────
  const denied = make();
  assert.equal(denyProposal(denied.id)?.status, 'denied');
  startedWork(denied.id);
  assert.equal(statusOf(denied.id), 'denied', 'denied proposal cannot execute, repair, finish or fail');
  assert.equal(approveProposal(denied.id), null, 'denied proposal cannot be approved');

  // ── expired stays expired ───────────────────────────────────────────────────
  const expired = make();
  force(expired.id, { status: 'expired' });
  startedWork(expired.id);
  assert.equal(denyProposal(expired.id)?.status, 'expired');
  assert.equal(statusOf(expired.id), 'expired', 'expired proposal cannot be revived');
  assert.throws(() => denyProposalAction(expired.id), (err: any) => err.statusCode === 409);

  // ── normal lifecycle still works ────────────────────────────────────────────
  const happy = make();
  assert.equal(approveProposal(happy.id)?.status, 'approved');
  assert.equal(markProposalExecuting(happy.id, 'task_a')?.status, 'executing');
  assert.equal(markProposalRepairing(happy.id, 'build failed', 'task_repair')?.status, 'repairing');
  assert.equal(markProposalExecuting(happy.id, 'task_b')?.status, 'executing', 'repair hands back to executing');
  assert.equal(markProposalExecuted(happy.id, 'done')?.status, 'executed');
  assert.equal(loadProposal(happy.id)?.executorTaskId, 'task_b');

  // ── terminal work cannot be reopened ────────────────────────────────────────
  markProposalRepairing(happy.id, 'late repair');
  markProposalExecuting(happy.id, 'task_late');
  assert.equal(statusOf(happy.id), 'executed', 'executed proposal cannot be reopened');
  assert.throws(() => denyProposalAction(happy.id), (err: any) => err.statusCode === 409);
  assert.equal(statusOf(happy.id), 'executed', 'deny does not overwrite finished work');

  const failed = make();
  approveProposal(failed.id);
  assert.equal(markProposalFailed(failed.id, 'launch failed')?.status, 'failed', 'approved -> failed (launch failure)');
  markProposalRepairing(failed.id, 'late repair');
  assert.equal(statusOf(failed.id), 'failed', 'failed proposal cannot be reopened by repair');

  // ── deny: revoke before start only ──────────────────────────────────────────
  const revoke = make();
  approveProposal(revoke.id);
  assert.equal(denyProposalAction(revoke.id).status, 'denied', 'approved proposal can be revoked before its executor starts');
  assert.equal(denyProposalAction(revoke.id).status, 'denied', 'repeated deny is idempotent');

  const started = make();
  approveProposal(started.id);
  force(started.id, { executorTaskId: 'task_started' });
  assert.equal(denyProposal(started.id)?.status, 'approved', 'cannot revoke once an executor task exists');

  const running = make();
  approveProposal(running.id);
  markProposalExecuting(running.id, 'task_running');
  assert.throws(() => denyProposalAction(running.id), (err: any) => err.statusCode === 409 && /no longer be denied/.test(err.message));
  assert.equal(statusOf(running.id), 'executing', 'running proposal keeps executing after a refused deny');

  assert.throws(() => denyProposalAction('prop_missing_000'), (err: any) => err.statusCode === 404);

  // ── dispatch re-checks the durable status before creating a task ────────────
  const steps = [{ title: 'Re-check state' }, { title: 'Do the action' }, { title: 'Report' }];
  const late = make({ executionMode: 'action', executionSteps: steps });
  const snapshot = loadProposal(late.id)!;
  denyProposal(late.id);
  await assert.rejects(
    () => dispatchApprovedProposal(snapshot),
    (err: any) => err.statusCode === 409 && /no executor task was started/.test(String(err.message)),
  );
  assert.equal(statusOf(late.id), 'denied', 'refused dispatch does not mark the proposal failed');
  assert.equal(
    listTasks().filter((task: any) => task.sessionId === `proposal_${late.id}`).length,
    0,
    'no executor task exists for a denied proposal',
  );

  console.log('proposal transition guards regression passed');
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => { fs.rmSync(root, { recursive: true, force: true }); });
