// Copy and decision rules for the mobile chat approval card. Kept DOM-free so the rules
// can be tested directly; mirrors desktop ChatPage.js renderApprovalCard (isFinalAction / isOneShot).

export const MOBILE_APPROVAL_IRREVERSIBLE_KINDS = ['purchase', 'delete', 'transfer'];
export const MOBILE_APPROVAL_SLIDE_RISK = 8;
export const MOBILE_APPROVAL_SLIDE_THRESHOLD = 0.88;

const VERB_BY_KIND = {
  post: 'post',
  send: 'send',
  publish: 'publish',
  submit: 'submit',
  purchase: 'buy',
  delete: 'delete',
  transfer: 'transfer',
};

/** "7/10" or "7/10 · commit"; empty when there is no meaningful risk score. */
export function mobileApprovalRiskText(riskScore, policyTier = '') {
  const risk = Number(riskScore);
  if (!Number.isFinite(risk) || risk <= 0) return '';
  const tier = String(policyTier || '').trim();
  return `${risk}/10${tier ? ` · ${tier}` : ''}`;
}

/** Verb used in "Approve & <verb>" / "Slide to <verb>". Empty when the kind has no verb. */
export function mobileApprovalVerb(actionKind) {
  const key = String(actionKind || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VERB_BY_KIND, key) ? VERB_BY_KIND[key] : '';
}

/** 'slide' for pending one-shot approvals that are high risk or irreversible; otherwise 'tap'. */
export function mobileApprovalConfirmMode(approval = {}) {
  const pending = String(approval?.status || 'pending').toLowerCase() === 'pending';
  const kind = String(approval?.approvalKind || '').trim();
  const finalAction = approval?.finalAction && typeof approval.finalAction === 'object' ? approval.finalAction : {};
  const actionKind = String(finalAction.actionKind || '').trim().toLowerCase();
  const oneShot = approval?.oneShot === true || kind === 'elevated_command' || kind === 'dev_source_edit'
    || kind === 'final_action' || String(approval?.toolName || '') === 'request_final_action_approval';
  const risk = Number(approval?.riskScore || 0);
  const highRisk = Number.isFinite(risk) && risk >= MOBILE_APPROVAL_SLIDE_RISK;
  const irreversible = MOBILE_APPROVAL_IRREVERSIBLE_KINDS.includes(actionKind);
  if (pending && oneShot && kind !== 'dev_apply_live' && (highRisk || irreversible)) return 'slide';
  return 'tap';
}

/** 'high' (risk >= 8), 'mid' (risk >= 5), 'low' (risk > 0), '' (no risk). */
export function mobileApprovalRiskLevel(riskScore) {
  const risk = Number(riskScore);
  if (!Number.isFinite(risk) || risk <= 0) return '';
  if (risk >= MOBILE_APPROVAL_SLIDE_RISK) return 'high';
  if (risk >= 5) return 'mid';
  return 'low';
}

/** "4:52" (m:ss, floor of seconds left), "Expired" when <= 0, "" when expiresAt is missing or invalid. */
export function mobileApprovalExpiryText(expiresAt, now = Date.now()) {
  const end = Number(expiresAt);
  if (!Number.isFinite(end) || end <= 0) return '';
  const left = Math.floor((end - now) / 1000);
  if (left <= 0) return 'Expired';
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** True when the drag distance reached 88% of the track travel. */
export function mobileApprovalSlideReached(dx, max) {
  if (!(max > 0)) return false;
  return dx >= max * MOBILE_APPROVAL_SLIDE_THRESHOLD;
}

/**
 * Title, meta line, labels and display flags for one approval record.
 * @param {object} approval normalized mobile approval
 * @param {{ resolvedTitle?: string }} [options] title to show once the approval is no longer pending
 */
export function mobileApprovalCardCopy(approval = {}, { resolvedTitle = '' } = {}) {
  const kind = String(approval?.approvalKind || '').trim();
  const tool = String(approval?.toolName || '').trim();
  const args = approval?.toolArgs && typeof approval.toolArgs === 'object' ? approval.toolArgs : {};
  const finalAction = approval?.finalAction && typeof approval.finalAction === 'object' ? approval.finalAction : {};
  const pending = String(approval?.status || 'pending').toLowerCase() === 'pending';
  const isFinalAction = kind === 'final_action' || tool === 'request_final_action_approval';
  const isDevSource = kind === 'dev_source_edit' || tool === 'request_dev_source_edit';
  const oneShot = approval?.oneShot === true || kind === 'elevated_command' || isDevSource || isFinalAction;
  const riskText = mobileApprovalRiskText(approval?.riskScore, approval?.policyTier);
  const actionKind = String(finalAction.actionKind || args.action_kind || '').trim();
  const verb = isFinalAction ? mobileApprovalVerb(actionKind) : '';

  let title;
  let toolLabel;
  let subtitle;
  if (isFinalAction) {
    const target = String(finalAction.targetLabel || args.target_label || '').trim();
    title = pending ? (target || 'Confirm final action') : (resolvedTitle || 'Final action approval');
    toolLabel = `Final action${actionKind ? ` · ${actionKind}` : ''}`;
    subtitle = String(finalAction.surface || '').trim();
  } else {
    title = pending ? 'Allow this tool to run?' : (resolvedTitle || 'Tool access');
    toolLabel = tool || 'tool';
    subtitle = tool;
  }

  const eyebrowParts = [];
  if (pending) eyebrowParts.push('Needs your OK');
  if (oneShot) eyebrowParts.push('one time');
  if (riskText) eyebrowParts.push(`risk ${Number(approval?.riskScore)}/10`);

  let approveLabel;
  if (kind === 'dev_apply_live') approveLabel = 'Apply live';
  else if (isFinalAction && verb) approveLabel = `Approve & ${verb}`;
  else if (oneShot) approveLabel = 'Approve';
  else approveLabel = 'Allow once';

  return {
    isFinalAction,
    oneShot,
    title,
    toolLabel,
    subtitle,
    eyebrow: eyebrowParts.join(' · '),
    approveLabel,
    slideLabel: verb ? `Slide to ${verb}` : 'Slide to approve',
    denyLabel: kind === 'dev_apply_live' ? 'Keep verified' : 'Deny',
    confirmMode: mobileApprovalConfirmMode(approval),
    riskLevel: mobileApprovalRiskLevel(approval?.riskScore),
    detailsOpenByDefault: !isFinalAction,
    riskText,
  };
}
