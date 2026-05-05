import { addMessage, clearHistory, getHistory } from '../session';
import type {
  TaskPauseSnapshot,
  TaskPauseSnapshotStep,
  TaskRecord,
  TaskRecoveryConversationTurn,
} from './task-store';

const TASK_RECOVERY_NO_TOOLS_FILTER = ['__task_recovery_no_tools__'];
const TASK_RECOVERY_SESSION_PREFIX = 'task_recovery_';
const TASK_RESUME_BRIEF_SESSION_PREFIX = 'task_resume_brief_';

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}

export function isProposalLikeTask(task: TaskRecord | null | undefined): boolean {
  if (!task) return false;
  const sourceSessionId = String(task.sessionId || '').trim();
  return /^proposal_/i.test(sourceSessionId) || /^code_exec/i.test(sourceSessionId);
}

export function isTaskRecoveryEligible(task: TaskRecord | null | undefined): boolean {
  return !!task && !isProposalLikeTask(task);
}

export function getTaskReplySessionIds(task: TaskRecord | null | undefined): string[] {
  if (!task) return [];
  return uniqueStrings([task.sessionId, task.originatingSessionId]);
}

export function matchesTaskReplySession(task: TaskRecord | null | undefined, sessionId: string): boolean {
  const needle = String(sessionId || '').trim();
  if (!needle) return false;
  return getTaskReplySessionIds(task).includes(needle);
}

export function getTaskRecoverySessionId(taskId: string): string {
  return `${TASK_RECOVERY_SESSION_PREFIX}${taskId}`;
}

export function getTaskResumeBriefSessionId(taskId: string): string {
  return `${TASK_RESUME_BRIEF_SESSION_PREFIX}${taskId}`;
}

export function getTaskRecoveryNoToolsFilter(): string[] {
  return [...TASK_RECOVERY_NO_TOOLS_FILTER];
}

export function collectTaskExecutionTranscript(taskId: string, maxTurns = 250): TaskPauseSnapshot['executionTranscript'] {
  return getHistory(`task_${taskId}`, maxTurns)
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content || ''),
      timestamp: Number(msg.timestamp) || Date.now(),
    }));
}

export function buildTaskPauseSnapshot(task: TaskRecord): TaskPauseSnapshot {
  const planState: TaskPauseSnapshotStep[] = Array.isArray(task.plan)
    ? task.plan.map((step, idx) => ({
        index: Number.isFinite(Number(step?.index)) ? Number(step.index) : idx,
        description: String(step?.description || `Step ${idx + 1}`),
        status: step?.status === 'running' || step?.status === 'done' || step?.status === 'failed' || step?.status === 'skipped'
          ? step.status
          : 'pending',
        notes: typeof step?.notes === 'string' && step.notes.trim() ? step.notes : undefined,
      }))
    : [];
  const currentStepIndex = Number.isFinite(Number(task.currentStepIndex)) ? Math.max(0, Number(task.currentStepIndex)) : 0;
  const currentStepDescription = planState[currentStepIndex]?.description;
  const completedSteps = planState.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  return {
    createdAt: Date.now(),
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    pauseReason: task.pauseReason,
    originalRequest: String(task.prompt || ''),
    currentStepIndex,
    currentStepDescription,
    completedSteps,
    totalSteps: Math.max(1, planState.length),
    pendingClarificationQuestion: typeof task.pendingClarificationQuestion === 'string' && task.pendingClarificationQuestion.trim()
      ? task.pendingClarificationQuestion
      : undefined,
    lastToolCall: typeof task.lastToolCall === 'string' && task.lastToolCall.trim() ? task.lastToolCall : undefined,
    lastToolCallAt: Number.isFinite(Number(task.lastToolCallAt)) ? Number(task.lastToolCallAt) : undefined,
    planState,
    journalLog: Array.isArray(task.journal) ? [...task.journal] : [],
    executionTranscript: collectTaskExecutionTranscript(task.id),
  };
}

export function syncTaskRecoverySession(task: TaskRecord): void {
  const sessionId = getTaskRecoverySessionId(task.id);
  clearHistory(sessionId);
  const turns = Array.isArray(task.recoveryConversation) ? task.recoveryConversation : [];
  for (const turn of turns) {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
    addMessage(
      sessionId,
      {
        role: turn.role,
        content: String(turn.content || ''),
        timestamp: Number(turn.timestamp) || Date.now(),
      },
      {
        disableMemoryFlushCheck: true,
        disableCompactionCheck: true,
        disableAutoSave: true,
        maxMessages: 120,
      },
    );
  }
}

function formatStepLine(step: TaskPauseSnapshotStep): string {
  const icon = step.status === 'done'
    ? '[done]'
    : step.status === 'running'
      ? '[running]'
      : step.status === 'failed'
        ? '[failed]'
        : step.status === 'skipped'
          ? '[skipped]'
          : '[pending]';
  const notes = step.notes ? ` | notes: ${step.notes}` : '';
  return `${icon} Step ${step.index + 1}: ${step.description}${notes}`;
}

function formatRecoveryTurn(turn: TaskRecoveryConversationTurn, index: number): string {
  const stamp = Number.isFinite(Number(turn.timestamp)) ? new Date(turn.timestamp).toISOString() : 'unknown-time';
  const source = turn.source ? ` source=${turn.source}` : '';
  return `${index + 1}. [${turn.role}${source}] (${stamp}) ${String(turn.content || '').trim()}`;
}

function formatJournalEntry(entry: TaskPauseSnapshot['journalLog'][number], index: number): string {
  const stamp = Number.isFinite(Number(entry.t)) ? new Date(entry.t).toISOString() : 'unknown-time';
  const detail = entry.detail ? ` | detail: ${entry.detail}` : '';
  return `${index + 1}. [${entry.type}] (${stamp}) ${String(entry.content || '').trim()}${detail}`;
}

function formatTranscriptEntry(entry: TaskPauseSnapshot['executionTranscript'][number], index: number): string {
  const stamp = Number.isFinite(Number(entry.timestamp)) ? new Date(entry.timestamp).toISOString() : 'unknown-time';
  return `${index + 1}. [${entry.role}] (${stamp}) ${String(entry.content || '').trim()}`;
}

function joinWithHardLimit(lines: string[], maxChars = 120_000): string {
  if (!Array.isArray(lines) || lines.length === 0) return '(none)';
  const chunks: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const line of lines) {
    const next = `${line}\n`;
    if (used + next.length > maxChars) {
      omitted++;
      continue;
    }
    chunks.push(line);
    used += next.length;
  }
  if (omitted > 0) {
    chunks.push(`... ${omitted} additional line(s) omitted to stay within prompt limits.`);
  }
  return chunks.length > 0 ? chunks.join('\n') : '(none)';
}

export function formatTaskPauseSnapshot(snapshot: TaskPauseSnapshot | undefined, opts?: { maxChars?: number }): string {
  if (!snapshot) return 'No pause snapshot is available.';
  const maxChars = Number.isFinite(Number(opts?.maxChars)) ? Math.max(10_000, Number(opts?.maxChars)) : 90_000;
  const planBudget = Math.min(20_000, Math.floor(maxChars * 0.18));
  const journalBudget = Math.max(15_000, Math.floor(maxChars * 0.42));
  const transcriptBudget = Math.max(12_000, Math.floor(maxChars * 0.32));
  const stepLines = snapshot.planState.map(formatStepLine);
  const journalLines = snapshot.journalLog.map(formatJournalEntry);
  const transcriptLines = snapshot.executionTranscript.map(formatTranscriptEntry);
  return [
    `[PAUSE SNAPSHOT]`,
    `Task ID: ${snapshot.taskId}`,
    `Task title: ${snapshot.taskTitle}`,
    `Task status: ${snapshot.taskStatus}`,
    snapshot.pauseReason ? `Pause reason: ${snapshot.pauseReason}` : '',
    `Current step: ${snapshot.currentStepIndex + 1}/${snapshot.totalSteps}`,
    snapshot.currentStepDescription ? `Current step description: ${snapshot.currentStepDescription}` : '',
    `Completed steps: ${snapshot.completedSteps}/${snapshot.totalSteps}`,
    snapshot.pendingClarificationQuestion ? `Pending clarification question: ${snapshot.pendingClarificationQuestion}` : '',
    snapshot.lastToolCall ? `Last tool call: ${snapshot.lastToolCall}` : '',
    snapshot.lastToolCallAt ? `Last tool call at: ${new Date(snapshot.lastToolCallAt).toISOString()}` : '',
    '',
    `[ORIGINAL REQUEST]`,
    snapshot.originalRequest || '(none)',
    '',
    `[PLAN STATE]`,
    joinWithHardLimit(stepLines, planBudget),
    '',
    `[PROCESS JOURNAL]`,
    joinWithHardLimit(journalLines, journalBudget),
    '',
    `[EXECUTION TRANSCRIPT]`,
    joinWithHardLimit(transcriptLines, transcriptBudget),
    `[/PAUSE SNAPSHOT]`,
  ].filter(Boolean).join('\n');
}

export function formatTaskRecoveryConversation(turns: TaskRecoveryConversationTurn[] | undefined, opts?: { maxTurns?: number }): string {
  const items = Array.isArray(turns) ? turns : [];
  const maxTurns = Number.isFinite(Number(opts?.maxTurns)) ? Math.max(1, Number(opts?.maxTurns)) : items.length;
  const lines = items.slice(-maxTurns).map(formatRecoveryTurn);
  return lines.length > 0 ? lines.join('\n') : '(none)';
}
