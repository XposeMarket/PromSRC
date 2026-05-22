import { getSession } from './session';
import { inferTeamNoteContext } from './agents-runtime/capabilities/team-agent-helpers';

export interface IntradayNoteSource {
  label: string;
  sessionId?: string;
  details: string[];
}

function sanitizeDetail(value: unknown, max = 120): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function loadTaskForSession(sessionId: string): any | null {
  const match = String(sessionId || '').match(/^task_(.+)$/);
  if (!match) return null;
  try {
    const { loadTask } = require('./tasks/task-store');
    return loadTask(match[1]) || null;
  } catch {
    return null;
  }
}

function classifyTaskSource(task: any, sessionId: string): IntradayNoteSource {
  const details = [`session: ${sessionId}`];
  if (task?.id) details.push(`task: ${task.id}`);
  if (task?.title) details.push(`title: ${sanitizeDetail(task.title)}`);

  const sourceSession = String(task?.sessionId || '');
  const isProposal = !!task?.proposalExecution || /^(proposal_|code_exec)/i.test(sourceSession);
  if (isProposal) {
    const proposalId = sanitizeDetail(task?.proposalExecution?.proposalId || sourceSession.replace(/^(proposal_|code_exec_?)/i, ''));
    if (proposalId) details.push(`proposal: ${proposalId}`);
    return { label: 'Proposal', sessionId, details };
  }

  if (task?.scheduleId || task?.taskKind === 'scheduled') {
    if (task.scheduleId) details.push(`schedule: ${sanitizeDetail(task.scheduleId)}`);
    return { label: 'Scheduled job', sessionId, details };
  }

  if (task?.teamSubagent?.agentId) {
    details.push(`agent: ${sanitizeDetail(task.teamSubagent.agentId)}`);
    if (task.teamSubagent.teamId) details.push(`team: ${sanitizeDetail(task.teamSubagent.teamId)}`);
    return { label: 'Subagent', sessionId, details };
  }

  if (task?.parentTaskId || task?.subagentProfile) {
    if (task.parentTaskId) details.push(`parent task: ${sanitizeDetail(task.parentTaskId)}`);
    if (task.subagentProfile) details.push(`profile: ${sanitizeDetail(task.subagentProfile)}`);
    return { label: 'Subagent', sessionId, details };
  }

  if (task?.managerEnabled) return { label: 'Background task manager', sessionId, details };
  return { label: 'Background task', sessionId, details };
}

export function inferIntradayNoteSource(sessionId?: string, args?: any): IntradayNoteSource {
  const explicitSessionId = sanitizeDetail(args?.source_session_id || args?.sourceSessionId || args?.session_id || args?.sessionId);
  const sid = sanitizeDetail(sessionId || explicitSessionId || 'unknown', 160) || 'unknown';
  const explicitLabel = sanitizeDetail(args?.source || args?.session_source || args?.sessionSource || args?.origin);
  const details = sid && sid !== 'unknown' ? [`session: ${sid}`] : [];

  if (explicitLabel) return { label: explicitLabel, sessionId: sid, details };

  const teamNote = inferTeamNoteContext(sid);
  if (teamNote?.authorType === 'manager') {
    details.push(`team: ${teamNote.teamId}`);
    return { label: 'Manager', sessionId: sid, details };
  }
  if (teamNote?.authorType === 'subagent') {
    details.push(`team: ${teamNote.teamId}`, `agent: ${teamNote.authorId}`);
    return { label: 'Subagent', sessionId: sid, details };
  }

  const task = loadTaskForSession(sid);
  if (task) return classifyTaskSource(task, sid);

  if (/^(proposal_|code_exec)/i.test(sid)) return { label: 'Proposal', sessionId: sid, details };
  if (/^cron_/i.test(sid)) return { label: 'Scheduled job', sessionId: sid, details };
  if (/^background_/i.test(sid)) return { label: 'Background agent', sessionId: sid, details };
  if (/^(agent_|dispatch_|webhook_agent_)/i.test(sid)) return { label: 'Background agent', sessionId: sid, details };
  if (/^(subagent_|subagent_chat_)/i.test(sid)) return { label: 'Subagent', sessionId: sid, details };
  if (/^(brain_|auto_boot_|auto_restart_|startup_)/i.test(sid)) return { label: 'Background agent', sessionId: sid, details };

  try {
    const session = getSession(sid);
    const channel = String(session?.channel || '').toLowerCase();
    const lastOrigin = [...(session?.history || [])].reverse().find((m: any) => m?.origin)?.origin;
    if (lastOrigin?.label) details.push(`origin: ${sanitizeDetail(lastOrigin.label)}`);
    if (channel === 'mobile') return { label: 'Mobile chat session', sessionId: sid, details };
    if (channel === 'telegram') return { label: 'Telegram chat session', sessionId: sid, details };
    if (channel === 'terminal') return { label: 'Terminal chat session', sessionId: sid, details };
    if (channel === 'discord') return { label: 'Discord chat session', sessionId: sid, details };
    if (channel === 'whatsapp') return { label: 'WhatsApp chat session', sessionId: sid, details };
  } catch {
    // Fall through to prefix/default classification.
  }

  if (/^mobile_/i.test(sid)) return { label: 'Mobile chat session', sessionId: sid, details };
  if (/^telegram_/i.test(sid)) return { label: 'Telegram chat session', sessionId: sid, details };
  if (/^cli_/i.test(sid)) return { label: 'Terminal chat session', sessionId: sid, details };
  return { label: 'Main chat session', sessionId: sid, details };
}

export function formatIntradayNoteSourceLine(source: IntradayNoteSource): string {
  const details = source.details.filter(Boolean).join('; ');
  return details ? `_Source: ${source.label}; ${details}_` : `_Source: ${source.label}_`;
}

export function formatIntradayNoteSourceInline(source: IntradayNoteSource): string {
  const details = source.details.filter(Boolean).join('; ');
  return details ? `[Source: ${source.label}; ${details}]` : `[Source: ${source.label}]`;
}
