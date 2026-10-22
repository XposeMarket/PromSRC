// Regression: mobile approval card copy for one-shot final actions vs normal tool approvals.
// Before the fix, mobile showed "Allow this tool to run?" + "Allow once" + a bare "7" for final actions.
import assert from 'node:assert/strict';
import { mobileApprovalCardCopy, mobileApprovalRiskText } from '../web-ui/src/mobile/mobile-approval-copy.js';

// Final action (the exact shape from the UI test card Raul screenshotted).
const finalAction = mobileApprovalCardCopy({
  status: 'pending',
  toolName: 'request_final_action_approval',
  approvalKind: 'final_action',
  riskScore: 7,
  toolArgs: { action_kind: 'other', target_label: 'UI Test: Approve' },
});
assert.equal(finalAction.title, 'Confirm: UI Test: Approve');
assert.equal(finalAction.toolLabel, 'Final action · other');
assert.equal(finalAction.approveLabel, 'Approve');
assert.equal(finalAction.riskText, '7/10');
assert.equal(finalAction.oneShot, true);

// finalAction record wins over raw args; resolved card uses the resolved title.
const resolved = mobileApprovalCardCopy(
  { status: 'approved', approvalKind: 'final_action', finalAction: { targetLabel: 'Post', actionKind: 'post' } },
  { resolvedTitle: 'Final action approval' },
);
assert.equal(resolved.title, 'Final action approval');
assert.equal(resolved.toolLabel, 'Final action · post');

// Normal command approval keeps the reusable "Allow once" flow.
const command = mobileApprovalCardCopy({ status: 'pending', toolName: 'run_command', riskScore: 4, policyTier: 'commit' });
assert.equal(command.title, 'Allow this tool to run?');
assert.equal(command.toolLabel, 'run_command');
assert.equal(command.approveLabel, 'Allow once');
assert.equal(command.riskText, '4/10 · commit');
assert.equal(command.oneShot, false);
assert.equal(command.isFinalAction, false);

// Other one-shot kinds.
assert.equal(mobileApprovalCardCopy({ toolName: 'run_command', approvalKind: 'elevated_command' }).approveLabel, 'Approve');
assert.equal(mobileApprovalCardCopy({ toolName: 'request_dev_source_edit' }).approveLabel, 'Approve');
assert.equal(mobileApprovalCardCopy({ toolName: 'x', oneShot: true }).approveLabel, 'Approve');
assert.equal(mobileApprovalCardCopy({ approvalKind: 'dev_apply_live', toolName: 'prom_apply_dev_changes' }).approveLabel, 'Apply live');

// Risk: none for 0 / missing / garbage.
assert.equal(mobileApprovalRiskText(0), '');
assert.equal(mobileApprovalRiskText(undefined), '');
assert.equal(mobileApprovalRiskText('abc'), '');
assert.equal(mobileApprovalCardCopy({ toolName: 'run_command' }).riskText, '');

console.log('test-mobile-approval-card-copy: all assertions passed');
