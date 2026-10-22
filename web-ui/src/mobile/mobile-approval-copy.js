// Copy rules for the mobile chat approval card. Kept DOM-free so the rules can be
// tested directly; mirrors desktop ChatPage.js renderApprovalCard (isFinalAction / isOneShot).

/** "7/10" or "7/10 · commit"; empty when there is no meaningful risk score. */
export function mobileApprovalRiskText(riskScore, policyTier = '') {
  const risk = Number(riskScore);
  if (!Number.isFinite(risk) || risk <= 0) return '';
  const tier = String(policyTier || '').trim();
  return `${risk}/10${tier ? ` · ${tier}` : ''}`;
}

/**
 * Title, tool chip and approve-button label for one approval record.
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

  let title;
  let toolLabel;
  if (isFinalAction) {
    const target = String(finalAction.targetLabel || args.target_label || '').trim();
    const actionKind = String(finalAction.actionKind || args.action_kind || '').trim();
    title = pending ? (target ? `Confirm: ${target}` : 'Confirm final action') : (resolvedTitle || 'Final action approval');
    toolLabel = `Final action${actionKind ? ` · ${actionKind}` : ''}`;
  } else {
    title = pending ? 'Allow this tool to run?' : (resolvedTitle || 'Tool access');
    toolLabel = tool || 'tool';
  }

  const approveLabel = kind === 'dev_apply_live' ? 'Apply live' : (oneShot ? 'Approve' : 'Allow once');
  return {
    isFinalAction,
    oneShot,
    title,
    toolLabel,
    approveLabel,
    riskText: mobileApprovalRiskText(approval?.riskScore, approval?.policyTier),
  };
}
