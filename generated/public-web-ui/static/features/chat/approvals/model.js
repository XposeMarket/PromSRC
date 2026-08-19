/** Pure approval normalization and risk classification. */

export function getApprovalRiskLevel(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export function normalizeChatApprovalRecord(record = {}, fallback = {}) {
  const id = String(record.id || record.approvalId || fallback.id || fallback.approvalId || '').trim();
  const toolName = String(record.toolName || fallback.toolName || '').trim();
  const approvalKind = String(record.approvalKind || fallback.approvalKind || '').trim();
  const action = String(record.action || fallback.action || fallback.summary || record.summary || '').trim();
  const command = String(record.command || record.toolArgs?.command || fallback.command || '').trim();
  const status = String(record.status || fallback.status || 'pending').trim().toLowerCase();
  const sessionId = String(record.sourceSessionId || record.sessionId || fallback.sourceSessionId || fallback.sessionId || '').trim();
  const isDevSource = approvalKind === 'dev_source_edit' || toolName === 'request_dev_source_edit';
  const isFinalAction = approvalKind === 'final_action' || toolName === 'request_final_action_approval';
  const human = summarizeApprovalForHumans(record, fallback);
  const pathAccess = record.pathAccess || fallback.pathAccess || null;
  return {
    id,
    sessionId,
    toolName,
    approvalKind,
    title: isDevSource ? 'Dev source edit approval' : (isFinalAction ? 'Final action approval' : human.title),
    action,
    command,
    reason: String(record.reason || fallback.reason || record.summary || fallback.summary || '').trim(),
    summary: human.summary || String(record.summary || fallback.summary || action || '').trim(),
    humanDetail: human.detail || '',
    riskScore: Number.isFinite(Number(record.riskScore)) ? Number(record.riskScore) : Number(fallback.riskScore || 0),
    affectedSystems: Array.isArray(record.affectedSystems) ? record.affectedSystems : (Array.isArray(fallback.affectedSystems) ? fallback.affectedSystems : []),
    scopedAction: String(record.scopedAction || fallback.scopedAction || '').trim(),
    scopedTarget: String(record.scopedTarget || fallback.scopedTarget || '').trim(),
    commandBoundary: record.commandBoundary || fallback.commandBoundary || null,
    pathAccess,
    devSourceEdit: record.devSourceEdit || fallback.devSourceEdit || null,
    finalAction: record.finalAction || fallback.finalAction || null,
    oneShot: record.oneShot === true || fallback.oneShot === true || approvalKind === 'elevated_command' || isDevSource || isFinalAction,
    status: status || 'pending',
  };
}
