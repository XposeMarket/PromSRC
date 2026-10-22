// Regression: mobile approval card rules (action sheet layout, slide-to-confirm, countdown).
// Covers both polarities: positive (slide / button shown) and negative (no slide / no approve).
import assert from 'node:assert/strict';
import {
  mobileApprovalCardCopy,
  mobileApprovalConfirmMode,
  mobileApprovalExpiryText,
  mobileApprovalRiskLevel,
  mobileApprovalRiskText,
  mobileApprovalSlideReached,
  mobileApprovalSlideOutcome,
  mobileApprovalVerb,
} from '../web-ui/src/mobile/mobile-approval-copy.js';

// Final action, risk 7, targetLabel present: tap mode, meta line, collapsed details.
const post = mobileApprovalCardCopy({
  status: 'pending',
  toolName: 'request_final_action_approval',
  approvalKind: 'final_action',
  riskScore: 7,
  finalAction: { actionKind: 'post', targetLabel: 'Post reply', surface: 'X in Chrome' },
});
assert.equal(post.title, 'Post reply');
assert.equal(post.approveLabel, 'Approve & post');
assert.equal(post.confirmMode, 'tap');
assert.equal(post.eyebrow, 'Needs your OK · one time · risk 7/10');
assert.equal(post.subtitle, 'X in Chrome');
assert.equal(post.detailsOpenByDefault, false);
assert.equal(post.riskLevel, 'mid');
assert.equal(post.oneShot, true);
assert.equal(post.riskText, '7/10');
assert.equal(post.slideLabel, 'Slide to post');

// Final action, risk 8 on a post: slide (the high-risk boundary is inclusive).
assert.equal(mobileApprovalCardCopy({
  status: 'pending', approvalKind: 'final_action', riskScore: 8, finalAction: { actionKind: 'post' },
}).confirmMode, 'slide');

// Final action, purchase, risk 3: slide even below the risk threshold.
const buy = mobileApprovalCardCopy({
  status: 'pending',
  approvalKind: 'final_action',
  riskScore: 3,
  finalAction: { actionKind: 'purchase', targetLabel: 'Order #42' },
});
assert.equal(buy.confirmMode, 'slide');
assert.equal(buy.slideLabel, 'Slide to buy');
assert.equal(buy.approveLabel, 'Approve & buy');
assert.equal(buy.title, 'Order #42');

// Delete and transfer also slide regardless of risk.
assert.equal(mobileApprovalConfirmMode({ status: 'pending', approvalKind: 'final_action', riskScore: 1, finalAction: { actionKind: 'delete' } }), 'slide');
assert.equal(mobileApprovalConfirmMode({ status: 'pending', approvalKind: 'final_action', riskScore: 1, finalAction: { actionKind: 'transfer' } }), 'slide');

// Elevated command, risk 8: slide, generic verb.
const elevated = mobileApprovalCardCopy({ status: 'pending', approvalKind: 'elevated_command', riskScore: 8 });
assert.equal(elevated.confirmMode, 'slide');
assert.equal(elevated.slideLabel, 'Slide to approve');
assert.equal(elevated.approveLabel, 'Approve');

// Normal tool, risk 9, not one-shot: tap, Allow once, details open by default, tool name as subtitle.
const tool = mobileApprovalCardCopy({ status: 'pending', toolName: 'run_command', riskScore: 9 });
assert.equal(tool.confirmMode, 'tap');
assert.equal(tool.approveLabel, 'Allow once');
assert.equal(tool.detailsOpenByDefault, true);
assert.equal(tool.subtitle, 'run_command');
assert.equal(tool.title, 'Allow this tool to run?');
assert.equal(tool.eyebrow, 'Needs your OK · risk 9/10');

// Normal command, risk 4 with a policy tier: keeps the tier in riskText only.
const command = mobileApprovalCardCopy({ status: 'pending', toolName: 'run_command', riskScore: 4, policyTier: 'commit' });
assert.equal(command.riskText, '4/10 · commit');
assert.equal(command.eyebrow, 'Needs your OK · risk 4/10');

// dev_apply_live, risk 9: never slides, keeps its own labels.
const live = mobileApprovalCardCopy({ status: 'pending', approvalKind: 'dev_apply_live', riskScore: 9 });
assert.equal(live.confirmMode, 'tap');
assert.equal(live.approveLabel, 'Apply live');
assert.equal(live.denyLabel, 'Keep verified');

// Resolved final purchase: never slides, no "Needs your OK", resolved title.
const resolved = mobileApprovalCardCopy(
  { status: 'approved', approvalKind: 'final_action', riskScore: 3, finalAction: { actionKind: 'purchase', targetLabel: 'Order #42' } },
  { resolvedTitle: 'Final action approval' },
);
assert.equal(resolved.confirmMode, 'tap');
assert.equal(resolved.title, 'Final action approval');
assert.equal(resolved.toolLabel, 'Final action · purchase');
assert.equal(resolved.eyebrow.includes('Needs your OK'), false);
assert.equal(resolved.eyebrow, 'one time · risk 3/10');

// Final action with no verb ('other'): plain Approve and Slide to approve.
const other = mobileApprovalCardCopy({ status: 'pending', approvalKind: 'final_action', riskScore: 8, finalAction: { actionKind: 'other' } });
assert.equal(other.approveLabel, 'Approve');
assert.equal(other.slideLabel, 'Slide to approve');
assert.equal(other.title, 'Confirm final action');

// Verb mapping.
assert.equal(mobileApprovalVerb('purchase'), 'buy');
assert.equal(mobileApprovalVerb('other'), '');
assert.equal(mobileApprovalVerb('POST'), 'post');
assert.equal(mobileApprovalVerb(undefined), '');

// Risk level tiers.
assert.equal(mobileApprovalRiskLevel(0), '');
assert.equal(mobileApprovalRiskLevel(3), 'low');
assert.equal(mobileApprovalRiskLevel(5), 'mid');
assert.equal(mobileApprovalRiskLevel(8), 'high');

// Risk text.
assert.equal(mobileApprovalRiskText(0), '');
assert.equal(mobileApprovalRiskText(7, ''), '7/10');

// Countdown: m:ss, Expired at or past zero, empty when missing or invalid.
const now = 1_700_000_000_000;
assert.equal(mobileApprovalExpiryText(now + 292_000, now), '4:52');
assert.equal(mobileApprovalExpiryText(now + 59_999, now), '0:59');
assert.equal(mobileApprovalExpiryText(now - 1, now), 'Expired');
assert.equal(mobileApprovalExpiryText(now, now), 'Expired');
assert.equal(mobileApprovalExpiryText(undefined), '');
assert.equal(mobileApprovalExpiryText('not a number'), '');

// Slide threshold: 88% reaches, below does not, zero-width track never reaches.
assert.equal(mobileApprovalSlideReached(88, 100), true);
assert.equal(mobileApprovalSlideReached(87, 100), false);
assert.equal(mobileApprovalSlideReached(50, 0), false);
assert.equal(mobileApprovalSlideReached(100, 0), false);

console.log('mobile approval card copy: all assertions passed');

// Slide outcome (F1/F8): pointerup decides; cancel and lost capture never approve; only keyboard clicks approve.
assert.equal(mobileApprovalSlideOutcome({ type: 'pointerup', x: 88, max: 100, dragging: true }), 'approve');
assert.equal(mobileApprovalSlideOutcome({ type: 'pointerup', x: 87, max: 100, dragging: true }), 'reset');
assert.equal(mobileApprovalSlideOutcome({ type: 'pointerup', x: 100, max: 100, dragging: false }), 'ignore');
assert.equal(mobileApprovalSlideOutcome({ type: 'pointercancel', x: 100, max: 100, dragging: true }), 'reset');
assert.equal(mobileApprovalSlideOutcome({ type: 'pointercancel', x: 100, max: 100, dragging: false }), 'ignore');
assert.equal(mobileApprovalSlideOutcome({ type: 'lostpointercapture', x: 100, max: 100, dragging: true }), 'reset');
assert.equal(mobileApprovalSlideOutcome({ type: 'lostpointercapture', x: 100, max: 100, dragging: false }), 'ignore');
assert.equal(mobileApprovalSlideOutcome({ type: 'click', detail: 1, x: 100, max: 100 }), 'ignore');
assert.equal(mobileApprovalSlideOutcome({ type: 'click', detail: 0, x: 0, max: 100 }), 'approve');
assert.equal(mobileApprovalSlideOutcome({ type: 'click', detail: 0, done: true, x: 100, max: 100 }), 'ignore');
console.log('mobile approval slide outcome: ok');
