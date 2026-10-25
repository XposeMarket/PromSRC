import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-proposal-approval-'));
process.env.PROMETHEUS_DATA_DIR = path.join(root, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function run(): Promise<void> {
  const {
    approveProposal,
    createProposal,
    loadProposal,
    markProposalFailed,
  } = await import('./proposal-store.js');
  const { createTask, loadTask } = await import('../tasks/task-store.js');
  const { BackgroundTaskRunner } = await import('../tasks/background-task-runner.js');
  const { approveProposalAction, proposalHasExecutionPlan } = await import('../routes/proposals.router.js');
  const { actionProposalPlanError, countExecutableProposalSteps } = await import('./proposal-store.js');
  const {
    compactProposalError,
    normalizeProposalExecutorResponse,
  } = await import('./proposal-execution.js');

  function proposal(title: string) {
    return createProposal({
      type: 'general',
      priority: 'medium',
      title,
      summary: 'Approval flow regression proposal.',
      details: 'A bounded test proposal with no external side effects.',
      sourceAgentId: 'proposal-regression',
      affectedFiles: [],
      requiresBuild: false,
    });
  }

  const successful = proposal('Successful approval');
  const firstApproval = await approveProposalAction(successful.id);
  assert.equal(firstApproval.proposal.status, 'approved');
  assert.equal(firstApproval.dispatched, false);
  assert.equal(firstApproval.idempotent, false);
  assert.equal(loadProposal(successful.id)?.status, 'approved');

  // A repeated request returns the durable state and does not re-decide it.
  const repeatedApproval = await approveProposalAction(successful.id);
  assert.equal(repeatedApproval.idempotent, true);
  assert.equal(repeatedApproval.proposal.status, 'approved');
  assert.equal(loadProposal(successful.id)?.approvalSnapshot?.approvedVersion, 1);

  const malformed = normalizeProposalExecutorResponse({ type: 'final' });
  assert.equal(malformed.ok, false);
  if (malformed.ok) throw new Error('Expected malformed executor response to fail');
  assert.match(malformed.error, /malformed|empty/i);

  const failed = proposal('Malformed executor response');
  const failedProposal = markProposalFailed(failed.id, malformed.error);
  assert.equal(failedProposal?.status, 'failed');
  assert.equal(loadProposal(failed.id)?.executionResult, malformed.error);
  await assert.rejects(
    () => approveProposalAction(failed.id),
    /cannot be approved again/i,
  );

  const hugePayload = JSON.stringify({ error: 'Executor failed', proposal: { details: 'x'.repeat(10_000) } });
  const compact = compactProposalError(hugePayload);
  assert.equal(compact, 'Executor failed');
  assert.ok(compact.length < 100);

  // Exercise the runner boundary with a malformed provider response and
  // verify that both task and proposal state become durable failures.
  const runtimeProposal = proposal('Runtime malformed executor response');
  assert.ok(approveProposal(runtimeProposal.id));
  const runtimeTask = createTask({
    sessionId: `proposal_${runtimeProposal.id}`,
    title: '[Proposal] malformed executor response',
    prompt: 'Return the approved execution result.',
    channel: 'web',
    plan: [{ index: 0, description: 'Return the result.', status: 'pending' }],
    proposalExecution: { proposalId: runtimeProposal.id, mode: 'general' },
  });
  const runner = new BackgroundTaskRunner(
    runtimeTask.id,
    (async () => undefined) as any,
    () => {},
    null,
  );
  await runner.start();
  assert.equal(loadTask(runtimeTask.id)?.status, 'failed');
  assert.equal(loadProposal(runtimeProposal.id)?.status, 'failed');
  assert.match(loadProposal(runtimeProposal.id)?.executionResult || '', /malformed|usable response/i);

  // Steps-only action proposals (no executor_prompt, no affected_files) are runnable plans,
  // so approval dispatches them instead of silently recording an idle approval.
  const steps = [{ title: 'Re-check state' }, { title: 'Do the action' }, { title: 'Report' }];
  assert.equal(proposalHasExecutionPlan({ executionMode: 'action', affectedFiles: [], executionSteps: steps }), true);
  assert.equal(proposalHasExecutionPlan({ executionMode: 'action', affectedFiles: [], executionSteps: [{ title: 'Only one' }] }), false);
  assert.equal(proposalHasExecutionPlan({ executionMode: 'action', affectedFiles: [], executionSteps: ['a', 'b'] }), false);

  // An action proposal with no runnable plan is refused and stays pending.
  const planless = createProposal({
    type: 'general',
    executionMode: 'action',
    priority: 'medium',
    title: 'Planless action',
    summary: 'Action proposal without enough steps.',
    details: 'Should not be approvable.',
    sourceAgentId: 'proposal-regression',
    affectedFiles: [],
    executionSteps: [{ title: 'Only one' }],
    requiresBuild: false,
  } as any);
  await assert.rejects(
    () => approveProposalAction(planless.id),
    (err: any) => err.statusCode === 422 && /execution_steps/.test(String(err.message)),
  );
  assert.equal(loadProposal(planless.id)?.status, 'pending');

  // write_proposal guard.
  assert.match(actionProposalPlanError({ executionMode: 'action', executionSteps: [] }) || '', /at least two execution_steps/);
  assert.equal(actionProposalPlanError({ executionMode: 'action', executionSteps: steps }), null);
  assert.equal(actionProposalPlanError({ executionMode: 'general', executionSteps: [] }), null);
  assert.equal(actionProposalPlanError({ executionMode: 'code_change', executionSteps: [], repair: true }), null);
  assert.equal(countExecutableProposalSteps([{ title: ' ' }, { description: 'x' }, null, 'y']), 1);

  console.log('proposal approval flow regression passed');
}

run().finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
