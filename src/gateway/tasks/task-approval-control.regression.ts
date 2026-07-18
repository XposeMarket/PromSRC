import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-task-approval-control-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  try {
    const taskApi = await import('./task-store');
    const routerApi = await import('./task-router');
    const approvalApi = await import('../verification-flow');
    const task = taskApi.createTask({
      title: 'Approval control regression',
      prompt: 'Wait for an approval.',
      sessionId: 'task_approval_control_regression',
      originatingSessionId: 'owner_approval_control_regression',
      channel: 'web',
      plan: [{ index: 0, description: 'Run approved action', status: 'pending' }],
    });
    taskApi.updateTaskStatus(task.id, 'needs_assistance', { pauseReason: 'awaiting_command_approval' });
    const approval = approvalApi.getApprovalQueue().create({
      sessionId: task.sessionId,
      taskId: task.id,
      originType: 'background_task',
      originLabel: task.title,
      toolName: 'run_command',
      toolArgs: { command: 'npm test' },
      approvalKind: 'command',
      action: 'Run npm test',
      policyTier: 'commit',
      riskScore: 4,
      affectedSystems: ['workspace'],
    });

    const listed = await routerApi.handleTaskControlAction(task.originatingSessionId!, {
      action: 'list_approvals',
      task_id: task.id,
    });
    assert.equal(listed.success, true);
    assert.equal(listed.approvals?.length, 1);
    assert.equal(listed.approvals?.[0]?.id, approval.id);

    const implicit = await routerApi.handleTaskControlAction(task.originatingSessionId!, {
      action: 'resolve_approval',
      task_id: task.id,
      approval_id: approval.id,
      decision: 'approve',
    });
    assert.equal(implicit.success, false);
    assert.equal(implicit.code, 'explicit_user_authorization_required');

    const selfApproval = await routerApi.handleTaskControlAction(task.sessionId, {
      action: 'resolve_approval',
      task_id: task.id,
      approval_id: approval.id,
      decision: 'approve',
      user_authorized: true,
    });
    assert.equal(selfApproval.success, false);
    assert.equal(selfApproval.code, 'task_cannot_self_approve');

    taskApi.updateTaskStatus(task.id, 'complete');
    const resolved = await routerApi.handleTaskControlAction(task.originatingSessionId!, {
      action: 'resolve_approval',
      task_id: task.id,
      approval_id: approval.id,
      decision: 'approve',
      grant_scope: 'once',
      user_authorized: true,
    });
    assert.equal(resolved.success, true);
    assert.equal(resolved.decision, 'approved');
    assert.equal(resolved.approval?.status, 'approved');
    console.log('task approval control regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
