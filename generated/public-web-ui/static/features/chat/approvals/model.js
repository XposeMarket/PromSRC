/** Pure approval normalization and risk classification. */

function getApprovalToolLabel(toolName = '') {
  const tool = String(toolName || '').trim();
  if (!tool) return 'action';
  if (tool === 'desktop_click') return 'desktop click';
  if (tool === 'desktop_press_key') return 'desktop keypress';
  if (tool === 'browser_click') return 'browser click';
  if (tool === 'browser_press_key' || tool === 'browser_key') return 'browser keypress';
  if (tool === 'run_command') return 'command';
  return tool.replace(/_/g, ' ');
}

function summarizeApprovalForHumans(record = {}, fallback = {}) {
  const toolName = String(record.toolName || fallback.toolName || '').trim();
  const approvalKind = String(record.approvalKind || fallback.approvalKind || '').trim();
  const status = String(record.status || fallback.status || 'pending').trim().toLowerCase();
  const args = record.toolArgs && typeof record.toolArgs === 'object' ? record.toolArgs : {};
  const finalAction = record.finalAction || fallback.finalAction || null;
  const devSourceEdit = record.devSourceEdit || fallback.devSourceEdit || null;
  const isFinalAction = approvalKind === 'final_action' || toolName === 'request_final_action_approval';
  const isDevSource = approvalKind === 'dev_source_edit' || toolName === 'request_dev_source_edit';

  if (approvalKind === 'elevated_command') {
    const command = String(args.command || record.command || '').trim();
    return {
      title: 'Administrator command',
      summary: 'Run this exact command with Windows administrator privileges after your one-shot approval.',
      detail: command,
    };
  }

  if (isFinalAction) {
    const target = String(finalAction?.targetLabel || args.target_label || 'final action').trim();
    const summary = String(finalAction?.summary || record.reason || fallback.summary || '').trim();
    return {
      title: status === 'pending' ? `Ready to ${String(finalAction?.actionKind || args.action_kind || 'continue')}` : 'Final action',
      summary: summary || `Approve ${target}.`,
      detail: target,
    };
  }

  if (isDevSource) {
    const files = Array.isArray(devSourceEdit?.allowedFiles) ? devSourceEdit.allowedFiles : [];
    return {
      title: 'Dev source edit',
      summary: String(record.reason || fallback.summary || 'Approve a scoped source edit.').trim(),
      detail: files.length ? `${files.length} file${files.length === 1 ? '' : 's'} requested` : '',
    };
  }

  if (toolName === 'run_command') {
    const command = String(args.command || record.command || '').trim();
    const boundary = record.commandBoundary || fallback.commandBoundary || null;
    const boundaryScope = String(boundary?.scope || '').trim();
    return {
      title: boundaryScope && boundaryScope !== 'workspace' ? 'Outside-workspace command' : 'Command approval',
      summary: boundaryScope && boundaryScope !== 'workspace'
        ? `Run a command that may change ${boundaryScope.replace(/_/g, ' ')} state.`
        : (command ? `Run command${args.cwd ? ` in ${args.cwd}` : ''}` : 'Run a command.'),
      detail: command,
    };
  }

  if (toolName.startsWith('desktop_')) {
    const windowLabel = String(args.window_name || args.app || '').trim();
    const target = args.element != null
      ? `element ${args.element}`
      : Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
        ? `point ${Number(args.x)}, ${Number(args.y)}`
        : '';
    return {
      title: status === 'pending' ? 'Desktop action' : 'Desktop action',
      summary: `${status === 'pending' ? 'Approve' : 'Review'} ${getApprovalToolLabel(toolName)}${windowLabel ? ` in ${windowLabel}` : ''}.`,
      detail: target,
    };
  }

  if (toolName.startsWith('browser_')) {
    const target = args.element || args.selector || (args.ref != null ? `ref ${args.ref}` : '');
    return {
      title: status === 'pending' ? 'Browser action' : 'Browser action',
      summary: `${status === 'pending' ? 'Approve' : 'Review'} ${getApprovalToolLabel(toolName)}.`,
      detail: String(target || '').trim(),
    };
  }

  return {
    title: toolName ? `${getApprovalToolLabel(toolName)} approval` : 'Approval required',
    summary: String(record.reason || fallback.reason || record.summary || fallback.summary || record.action || '').trim(),
    detail: '',
  };
}

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
