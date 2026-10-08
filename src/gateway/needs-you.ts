export type NeedsYouKind =
  | 'question'
  | 'browser_login'
  | 'final_action_approval'
  | 'tool_approval'
  | 'dev_source_edit_proposal'
  | 'needs_user_supervision'
  | 'team_escalation'
  | 'paused_agent_run';

export interface NeedsYouItem {
  id: string;
  kind: NeedsYouKind;
  source: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, any>;
}

const iso = (value: any): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};
const text = (value: any, fallback = ''): string => String(value ?? fallback).trim();

/** Pure normalization boundary; every live store is adapted here, preserving its pending-record id. */
export function buildNeedsYouItems(sources: {
  questions?: any[];
  approvals?: any[];
  proposals?: any[];
  supervisions?: any[];
  teams?: any[];
  tasks?: any[];
  proposalsNeedApproval?: any[];
}): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const record of sources.questions || []) {
    if (!record || record.status !== 'pending') continue;
    const login = !!record.loginHandoff;
    items.push({
      id: `question:${record.id}`, kind: login ? 'browser_login' : 'question',
      source: text(record.originLabel, record.originType === 'subagent' ? 'Subagent' : record.originType === 'background_task' ? 'Background task' : 'Chat'),
      sessionId: text(record.sessionId), createdAt: iso(record.createdAt),
      payload: { ...record, interactionKind: login ? 'browser_login' : 'question' },
    });
  }
  for (const record of sources.approvals || []) {
    if (!record || record.status !== 'pending') continue;
    const finalAction = ['final_action', 'final-action', 'request_final_action_approval'].includes(text(record.approvalType || record.kind || record.toolName).toLowerCase());
    items.push({
      id: `approval:${record.id}`, kind: finalAction ? 'final_action_approval' : 'tool_approval',
      source: text(record.originLabel, text(record.toolName, 'Chat')),
      sessionId: text(record.sessionId), createdAt: iso(record.createdAt), payload: record,
    });
  }
  for (const record of sources.proposals || []) {
    if (!record || record.status !== 'pending' || !record.requiresSrcEdit) continue;
    items.push({ id: `proposal:${record.id}`, kind: 'dev_source_edit_proposal', source: text(record.sourceAgentId || 'Dev source edit'), sessionId: text(record.sourceSessionId), createdAt: iso(record.createdAt), payload: record });
  }
  for (const record of sources.proposalsNeedApproval || []) {
    if (!record || record.status !== 'pending') continue;
    items.push({ id: `proposal-approval:${record.id}`, kind: 'tool_approval', source: text(record.originLabel, text(record.toolName, 'Chat')), sessionId: text(record.sessionId), createdAt: iso(record.createdAt), payload: record });
  }
  for (const record of sources.supervisions || []) {
    if (!record || record.status !== 'blocked' || record.lastDecision !== 'needs_user') continue;
    items.push({ id: `supervision:${record.id}`, kind: 'needs_user_supervision', source: text(record.targetTitle, 'Managed thread'), sessionId: text(record.ownerSessionId), createdAt: iso(record.lastDecisionAt || record.updatedAt), payload: record });
  }
  for (const team of sources.teams || []) {
    const room = team?.roomState || {};
    for (const blocker of room.blockers || []) {
      if (!blocker || blocker.resolvedAt || !text(blocker.content || blocker.message || blocker.reason)) continue;
      const memberId = text(blocker.agentId || blocker.memberId || blocker.targetId);
      items.push({ id: `team:${team.id}:blocker:${blocker.id}`, kind: 'team_escalation', source: text(team.name, 'Team'), sessionId: text(team.originatingSessionId), createdAt: iso(blocker.createdAt || blocker.timestamp), payload: { ...blocker, teamId: team.id, teamName: team.name, memberId } });
    }
    for (const entry of room.managerInbox || []) {
      if (!entry || entry.drainedAt || !(entry.pendingMessages && Object.keys(entry.pendingMessages).length)) continue;
      items.push({ id: `team:${team.id}:inbox:${entry.id}`, kind: 'team_escalation', source: text(team.name, 'Team'), sessionId: text(team.originatingSessionId), createdAt: iso(entry.createdAt || entry.timestamp), payload: { ...entry, teamId: team.id, teamName: team.name } });
    }
    for (const thread of Object.values(room.directThreads || {})) {
      const messages = Array.isArray((thread as any)?.pendingUserMessages) ? (thread as any).pendingUserMessages : [];
      if (!thread || !messages.length) continue;
      items.push({ id: `team:${team.id}:thread:${(thread as any).id}`, kind: 'team_escalation', source: text(team.name, 'Team'), sessionId: text((thread as any).sessionId || team.originatingSessionId), createdAt: iso(messages[messages.length - 1]?.createdAt || (thread as any).lastMessageAt), payload: { ...(thread as any), teamId: team.id, teamName: team.name, pendingUserMessages: messages } });
    }
  }
  for (const task of sources.tasks || []) {
    if (!task || !['paused', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(text(task.status).toLowerCase())) continue;
    if (!['awaiting_user_input', 'awaiting_approval', 'awaiting_command_approval', 'awaiting_final_action_approval', 'awaiting_prometheus_question_response'].includes(text(task.pauseReason).toLowerCase()) && !['needs_assistance', 'awaiting_user_input'].includes(text(task.status).toLowerCase())) continue;
    items.push({ id: `task:${task.id}`, kind: 'paused_agent_run', source: text(task.title || task.channel || task.source, 'Agent run'), sessionId: text(task.originatingSessionId || task.sessionId), createdAt: iso(task.startedAt || task.createdAt), payload: task });
  }
  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
