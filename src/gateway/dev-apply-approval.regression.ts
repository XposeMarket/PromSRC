import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-dev-apply-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_APP_ROOT = root;
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'example.ts'), 'export const example = 1;\n');

const coordinator = require('./dev-edit-coordinator') as typeof import('./dev-edit-coordinator');
// Loading approval-actions registers the durable resolution hook.
require('./approval-actions');
const { getApprovalQueue } = require('./verification-flow') as typeof import('./verification-flow');

try {
  coordinator.registerCoordinatedDevEdit({ id: 'solo', sessionId: 'session-solo', files: ['src/example.ts'] });
  coordinator.recordCoordinatedDevEditVerification({ id: 'solo', files: ['src/example.ts'], success: true, summary: 'ok' });
  const decision = coordinator.requestCoordinatedDevEditApply('solo');
  assert.equal(decision.role, 'leader');
  assert.ok(decision.batch);
  const batch = decision.batch!;
  const approval = getApprovalQueue().create({
    sessionId: 'session-solo', toolName: 'prom_apply_dev_changes', toolArgs: { batch_id: batch.id },
    approvalKind: 'dev_apply_live', action: 'Apply verified dev batch live', policyTier: 'commit', riskScore: 6,
    affectedSystems: ['Prometheus gateway'],
    devApplyLive: { batchId: batch.id, memberIds: ['solo'], files: ['src/example.ts'], expiresAt: Date.now() - 1 },
  });
  coordinator.setCoordinatedDevApplyBatchApproval({ batchId: batch.id, approvalId: approval.id, expiresAt: Date.now() - 1 });
  getApprovalQueue().listPending();
  assert.equal(getApprovalQueue().get(approval.id)?.status, 'rejected');
  assert.equal(coordinator.getCoordinatedDevEdit('solo')?.phase, 'verified_not_live');
  console.log('dev-apply approval regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
