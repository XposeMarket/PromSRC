import { getApprovalQueue } from './verification-flow';
import { getPrometheusQuestionQueue } from './prometheus-questions';
import { listDurableRuntimes, listLiveRuntimes } from './live-runtime-registry';
import { snapshotMainChatGoal } from './main-chat-goals';
import { listMainChatTimers } from './timers/timer-store';
import { listInternalWatches } from './internal-watch/internal-watch-store';
import { listTaskSummaries, type TaskSummary } from './tasks/task-store';
import { listThreadSupervisions } from './threads/thread-supervision';
import {
  getSession,
  settleSession,
  sessionExists,
  type SessionSummary,
  unsettleSession,
} from './session';

export type SessionSettlementBlockerCode =
  | 'automated_session'
  | 'active_runtime'
  | 'active_task'
  | 'pending_approval'
  | 'pending_question'
  | 'active_goal'
  | 'managed_thread'
  | 'pending_timer'
  | 'active_watch'
  | 'pinned_confirmation_required'
  | 'pinned_chat'
  | 'project_session'
  | 'scheduled_session'
  | 'recent_activity';

export interface SessionSettlementBlocker {
  code: SessionSettlementBlockerCode;
  message: string;
  id?: string;
}

export class SessionSettlementError extends Error {
  readonly code: SessionSettlementBlockerCode | 'session_not_found';
  readonly blockers: SessionSettlementBlocker[];
  readonly statusCode: number;

  constructor(
    code: SessionSettlementError['code'],
    message: string,
    blockers: SessionSettlementBlocker[] = [],
    statusCode = code === 'session_not_found' ? 404 : 409,
  ) {
    super(message);
    this.name = 'SessionSettlementError';
    this.code = code;
    this.blockers = blockers;
    this.statusCode = statusCode;
  }
}

const AUTOMATED_SESSION_RE = /^(auto_|brain_|brain_thought_|brain_dream_|subagent_chat_|task_|task_recovery_|task_resume_brief_|cron_|team_|proposal_|prom_supervision_)/i;
const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed']);
const TERMINAL_RUNTIME_STATUSES = new Set(['completed', 'aborted']);

function isAutomatedSession(sessionId: string, channel?: string): boolean {
  return String(channel || '').toLowerCase() === 'system' || AUTOMATED_SESSION_RE.test(String(sessionId || ''));
}

function taskMatchesSession(task: TaskSummary, sessionId: string): boolean {
  return String(task.sessionId || '') === sessionId
    || String(task.originatingSessionId || '') === sessionId;
}

function runtimeMatchesSession(runtime: any, sessionId: string, tasks: TaskSummary[]): boolean {
  if (String(runtime?.sessionId || '') === sessionId) return true;
  const taskId = String(runtime?.taskId || '').trim();
  if (!taskId) return false;
  return tasks.some((task) => task.id === taskId && taskMatchesSession(task, sessionId));
}

export function getSessionSettlementBlockers(
  sessionId: string,
  options: {
    confirmPinned?: boolean;
    runtimeRecords?: any[];
    automatic?: boolean;
    expectedLastActiveAt?: number;
    cutoffAt?: number;
    activationAt?: number;
    projectSessionIds?: Set<string>;
    scheduledSessionIds?: Set<string>;
  } = {},
): SessionSettlementBlocker[] {
  const targetId = String(sessionId || '').trim();
  if (!targetId) return [];
  const session = getSession(targetId);
  const blockers: SessionSettlementBlocker[] = [];

  if (isAutomatedSession(targetId, session.channel)) {
    blockers.push({
      code: 'automated_session',
      message: 'Automated and system-owned conversations cannot be manually settled.',
      id: targetId,
    });
  }

  if (session.pinnedAt && options.automatic === true) {
    blockers.push({
      code: 'pinned_chat',
      message: 'Pinned chats are never auto-settled.',
      id: targetId,
    });
  } else if (session.pinnedAt && options.confirmPinned !== true) {
    blockers.push({
      code: 'pinned_confirmation_required',
      message: 'This chat is pinned. Confirm settling it to move it out of the normal sidebar.',
      id: targetId,
    });
  }

  if (options.automatic === true) {
    if (options.projectSessionIds?.has(targetId)) {
      blockers.push({
        code: 'project_session',
        message: 'Project conversations are protected from auto-settle.',
        id: targetId,
      });
    }
    if (options.scheduledSessionIds?.has(targetId)) {
      blockers.push({
        code: 'scheduled_session',
        message: 'Conversations owned by a scheduled job are protected from auto-settle.',
        id: targetId,
      });
    }
    const expectedLastActiveAt = Number(options.expectedLastActiveAt || 0);
    const currentLastActiveAt = Number(session.lastActiveAt || session.createdAt || 0);
    const cutoffAt = Number(options.cutoffAt || 0);
    const activationAt = Number(options.activationAt || 0);
    if (
      (expectedLastActiveAt > 0 && currentLastActiveAt !== expectedLastActiveAt)
      || (cutoffAt > 0 && Math.max(currentLastActiveAt, activationAt) > cutoffAt)
    ) {
      blockers.push({
        code: 'recent_activity',
        message: 'The conversation has newer protected activity and was skipped.',
        id: targetId,
      });
    }
  }

  const tasks = listTaskSummaries();
  const matchingTasks = tasks.filter((task) => taskMatchesSession(task, targetId));
  for (const task of matchingTasks) {
    if (!TERMINAL_TASK_STATUSES.has(String(task.status || ''))) {
      blockers.push({
        code: 'active_task',
        message: `Task “${String(task.title || task.id).slice(0, 120)}” is still ${String(task.status || 'active').replace(/_/g, ' ')}.`,
        id: task.id,
      });
    }
  }

  const liveRuntimeRecords = Array.isArray(options.runtimeRecords) ? options.runtimeRecords : listLiveRuntimes();
  const runtimeRecords = [...liveRuntimeRecords, ...listDurableRuntimes()]
    .filter((runtime, index, all) => all.findIndex((candidate) => candidate.id === runtime.id) === index)
    .filter((runtime) => !TERMINAL_RUNTIME_STATUSES.has(String(runtime?.status || '')))
    .filter((runtime) => runtimeMatchesSession(runtime, targetId, matchingTasks));
  for (const runtime of runtimeRecords) {
    blockers.push({
      code: 'active_runtime',
      message: `A ${String(runtime.kind || 'background').replace(/_/g, ' ')} run is still associated with this chat.`,
      id: String(runtime.id || '').trim() || undefined,
    });
  }

  const pendingApprovals = getApprovalQueue().listPending()
    .filter((approval) => approval.sessionId === targetId || (approval.taskId && matchingTasks.some((task) => task.id === approval.taskId)));
  for (const approval of pendingApprovals) {
    blockers.push({ code: 'pending_approval', message: 'A safety approval is waiting for this chat.', id: approval.id });
  }

  const pendingQuestions = getPrometheusQuestionQueue().listPending()
    .filter((question) => question.sessionId === targetId || (question.taskId && matchingTasks.some((task) => task.id === question.taskId)));
  for (const question of pendingQuestions) {
    blockers.push({ code: 'pending_question', message: 'Prometheus is waiting for an answer in this chat.', id: question.id });
  }

  const goal = snapshotMainChatGoal(targetId);
  if (goal && ['active', 'restarting', 'paused'].includes(String(goal.status || ''))) {
    blockers.push({ code: 'active_goal', message: 'A main-chat goal is still active for this chat.', id: goal.id });
  }

  const supervisions = listThreadSupervisions({ includeTerminal: false, limit: 500 })
    .filter((record) => ['active', 'paused'].includes(String(record.status || '')))
    .filter((record) => [record.ownerSessionId, record.targetSessionId, record.supervisorSessionId].includes(targetId));
  for (const supervision of supervisions) {
    blockers.push({ code: 'managed_thread', message: 'A managed-thread supervision is still active for this chat.', id: supervision.id });
  }

  const pendingTimers = listMainChatTimers({ sessionId: targetId });
  for (const timer of pendingTimers) {
    blockers.push({ code: 'pending_timer', message: `A scheduled timer “${timer.label}” is still pending for this chat.`, id: timer.id });
  }

  const activeWatches = listInternalWatches({ sessionId: targetId });
  for (const watch of activeWatches) {
    blockers.push({ code: 'active_watch', message: `An active watch “${watch.label}” is still associated with this chat.`, id: watch.id });
  }

  return blockers;
}

export function settleSessionWithGuards(
  sessionId: string,
  options: {
    confirmPinned?: boolean;
    runtimeRecords?: any[];
    automatic?: boolean;
    expectedLastActiveAt?: number;
    cutoffAt?: number;
    activationAt?: number;
    projectSessionIds?: Set<string>;
    scheduledSessionIds?: Set<string>;
  } = {},
): SessionSummary {
  const targetId = String(sessionId || '').trim();
  if (!sessionExists(targetId)) {
    throw new SessionSettlementError('session_not_found', 'Session not found.');
  }
  const session = getSession(targetId);
  const blockers = getSessionSettlementBlockers(targetId, options);
  const safetyBlockers = options.automatic === true
    ? blockers
    : blockers.filter((blocker) => blocker.code !== 'pinned_confirmation_required');
  if (safetyBlockers.length) {
    throw new SessionSettlementError(safetyBlockers[0].code, safetyBlockers[0].message, blockers);
  }
  if (session.settledAt) return settleSession(targetId, true)!;
  if (blockers.length) {
    throw new SessionSettlementError(blockers[0].code, blockers[0].message, blockers);
  }
  return settleSession(targetId, true)!;
}

export function unsettleSessionSafely(sessionId: string): SessionSummary {
  const targetId = String(sessionId || '').trim();
  if (!sessionExists(targetId)) {
    throw new SessionSettlementError('session_not_found', 'Session not found.');
  }
  return unsettleSession(targetId)!;
}
