import { buildNeedsYouItems, type NeedsYouItem } from './needs-you';
import { getPrometheusQuestionQueue, serializePrometheusQuestionForClient } from './prometheus-questions';
import { getApprovalQueue } from './verification-flow';
import { listProposals } from './proposals/proposal-store';
import { listThreadSupervisions } from './threads/thread-supervision';
import { listTasks } from './tasks/task-store';
import { listManagedTeams } from './teams/managed-teams';

/** Reads the same live stores the chat/approval/proposal endpoints use, then normalizes them. */
export function collectNeedsYouItems(): NeedsYouItem[] {
  const safe = <T>(fn: () => T, fallback: T): T => {
    try { return fn(); } catch { return fallback; }
  };
  const questions = safe(() => getPrometheusQuestionQueue().listAll().map((record: any) => ({
    ...serializePrometheusQuestionForClient(record),
    id: record.id,
    status: record.status,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    originLabel: record.originLabel,
    originType: record.originType,
    loginHandoff: record.loginHandoff,
  })), [] as any[]);
  const approvals = safe(() => getApprovalQueue().listAll().map((record: any) => ({
    ...record,
    sourceSessionId: record.sessionId,
  })), [] as any[]);
  const proposals = safe(() => listProposals('pending') as any[], [] as any[]);
  const supervisions = safe(() => listThreadSupervisions({ status: 'blocked', includeTerminal: false, limit: 200 }) as any[], [] as any[]);
  const teams = safe(() => listManagedTeams() as any[], [] as any[]);
  const tasks = safe(() => listTasks({ status: ['paused', 'stalled', 'needs_assistance', 'awaiting_user_input'] as any }) as any[], [] as any[]);
  return buildNeedsYouItems({
    questions,
    approvals: approvals.filter((record) => record.status === 'pending'),
    proposals,
    supervisions,
    teams,
    tasks,
  });
}
