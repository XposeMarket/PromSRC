/**
 * Shared, model-safe continuity for background tasks, subagents, and team
 * members.  This is intentionally separate from the task runner so every
 * execution path (normal rounds, manager dispatches, and gateway recovery)
 * can persist the same handoff shape.
 */

import {
  buildDurableCommentaryContext,
  DURABLE_COMMENTARY_CONTEXT_MAX_CHARS,
} from '../context/commentary-context';
import {
  buildTurnContextPacket,
  formatTurnContextPacketForPrompt,
  type TurnContextPacket,
} from '../context/turn-context-packet';
import type { TaskRecord, TaskResumeContext } from './task-store';

export type TaskContinuityStatus = 'completed' | 'aborted' | 'failed';

export interface TaskContinuitySnapshotInput {
  task: TaskRecord;
  sessionId: string;
  status?: TaskContinuityStatus;
  processEntries?: Array<Record<string, any>>;
  liveTraceEntries?: Array<Record<string, any>>;
  visibleReasoningSummary?: string;
  resultText?: string;
  abortReason?: string;
}

export interface TaskContinuitySnapshot {
  commentaryContext: string;
  packet: TurnContextPacket;
  processEntries: Array<Record<string, any>>;
  liveTraceEntries: Array<Record<string, any>>;
  visibleReasoningSummary?: string;
}

const MAX_PERSISTED_TRACE_ENTRIES = 320;
const MAX_PACKET_LIST_ITEMS = 8;
const MAX_PROMPT_CHARS = 10_000;

function compactText(value: unknown, maxChars: number): string {
  const text = String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return '';
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(0, maxChars - 18)).trimEnd()}...[truncated]`;
}

function uniqueList(values: unknown[], maxItems = MAX_PACKET_LIST_ITEMS, maxChars = 360): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const item = compactText(value, maxChars);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function entryText(entry: any): string {
  return compactText(entry?.text ?? entry?.content ?? entry?.message ?? entry?.result ?? entry?.summary, 700);
}

function entryType(entry: any): string {
  return String(entry?.type ?? entry?.kind ?? entry?.event ?? '').trim().toLowerCase();
}

function entryAction(entry: any): string {
  return compactText(
    entry?.action
      ?? entry?.toolName
      ?? entry?.extra?.action
      ?? entry?.extra?.toolName,
    160,
  );
}

function boundedEntries(entries: unknown): Array<Record<string, any>> {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry): entry is Record<string, any> => !!entry && typeof entry === 'object')
    .slice(-MAX_PERSISTED_TRACE_ENTRIES);
}

function planState(task: TaskRecord): string {
  const current = Math.max(0, Math.min(Number(task.currentStepIndex || 0), Math.max(0, task.plan.length - 1)));
  const step = task.plan[current];
  return [
    `Step ${current + 1} of ${Math.max(1, task.plan.length)}${step?.description ? `: ${step.description}` : ''}`,
    ...task.plan.slice(Math.min(current + 1, task.plan.length)).map((item) => `Pending: ${item.description}`),
  ].join('\n');
}

function traceSummary(entries: Array<Record<string, any>>): string[] {
  return entries
    .filter((entry) => {
      const visibility = String(
        entry?.visibility
          ?? entry?.extra?.visibility
          ?? entry?.presentation?.visibility
          ?? '',
      ).trim().toLowerCase();
      const source = String(entry?.source ?? entry?.extra?.source ?? '').trim().toLowerCase();
      return visibility !== 'private'
        && visibility !== 'internal'
        && source !== 'provider_thinking'
        && source !== 'private_reasoning';
    })
    .map((entry) => {
      const type = entryType(entry) || 'activity';
      const action = entryAction(entry);
      const text = entryText(entry);
      if (!text) return '';
      return `${type}${action ? ` (${action})` : ''}: ${text}`;
    })
    .filter(Boolean)
    .slice(-MAX_PACKET_LIST_ITEMS);
}

/**
 * Build the durable handoff for the current task turn.  Provider-private
 * reasoning is filtered by buildDurableCommentaryContext; only explicit
 * visible narration and bounded tool boundaries are retained.
 */
export function buildTaskContinuitySnapshot(
  input: TaskContinuitySnapshotInput,
): TaskContinuitySnapshot {
  const task = input.task;
  const processEntries = boundedEntries(input.processEntries);
  const liveTraceEntries = boundedEntries(input.liveTraceEntries);
  const visibleReasoningSummary = compactText(input.visibleReasoningSummary, 2_400) || undefined;
  const status = input.status || 'completed';
  const request = compactText(task.originalAssignment || task.prompt || task.title, 1_200);
  const recent = processEntries.length ? processEntries : liveTraceEntries;
  const actions = traceSummary(recent);
  const pendingTasks = task.plan
    .filter((step) => step.status === 'pending' || step.status === 'running')
    .map((step) => `${step.index + 1}. ${step.description}`);
  const resultText = compactText(input.resultText, 900);
  const abortReason = compactText(input.abortReason, 500) || undefined;
  const currentStep = task.plan[Math.max(0, Math.min(task.currentStepIndex, Math.max(0, task.plan.length - 1)))];

  const packet = buildTurnContextPacket({
    id: `task_context_${task.id}`,
    turnId: `task_${task.id}_round_${Math.max(0, Number(task.resumeContext?.round || 0))}`,
    sessionId: input.sessionId,
    status,
    request,
    reasoningSummary: visibleReasoningSummary,
    findings: actions.filter((item) => /result|finding|artifact/i.test(item)),
    decisions: actions.filter((item) => /decision|think|preamble|info/i.test(item)),
    completedActions: actions,
    toolState: actions.slice(-5).join('\n'),
    progressState: planState(task),
    uncertainties: [
      status !== 'completed' ? `Task ended ${status} before the next checkpoint.` : '',
      abortReason ? `Boundary reason: ${abortReason}` : '',
      resultText && status !== 'completed' ? `Last result/error: ${resultText}` : '',
    ].filter(Boolean),
    pendingTasks,
    continueFromHere: currentStep?.description
      ? `Resume at step ${currentStep.index + 1}: ${currentStep.description}. Verify the last recorded tool boundary before repeating any action.`
      : 'Resume from the recorded journal and verify any action that was in flight before taking it again.',
    abortReason,
  });

  const commentaryContext = buildDurableCommentaryContext({
    processEntries,
    liveTraceEntries,
    visibleReasoningSummary,
  }, DURABLE_COMMENTARY_CONTEXT_MAX_CHARS);

  return {
    commentaryContext,
    packet,
    processEntries,
    liveTraceEntries,
    visibleReasoningSummary,
  };
}

/**
 * Preserve the active session transcript without throwing away the durable
 * commentary fields that the normal chat runtime attaches to assistant rows.
 */
export function serializeTaskSessionMessage(message: any): Record<string, any> {
  const serialized: Record<string, any> = {
    role: message?.role === 'assistant' || message?.role === 'ai' ? 'assistant' : 'user',
    content: String(message?.content || ''),
    timestamp: Number(message?.timestamp || Date.now()) || Date.now(),
  };
  for (const key of [
    'messageId',
    'messageKind',
    'activeRunKind',
    'goalId',
    'goalTurnNumber',
    'goalIterationNumber',
    'goalTurnId',
    'commentaryContext',
    'visibleReasoningSummary',
    'reasoningSummary',
    'processEntries',
    'liveTraceEntries',
    'toolLog',
  ]) {
    if (message?.[key] === undefined) continue;
    if (Array.isArray(message[key])) serialized[key] = message[key].slice(-MAX_PERSISTED_TRACE_ENTRIES);
    else if (typeof message[key] === 'string') serialized[key] = message[key].slice(0, 12_000);
    else serialized[key] = message[key];
  }
  return serialized;
}

/**
 * Format task state for the next model call.  The packet is the recovery
 * contract; the commentary capsule is the chronological visible trail since
 * the last compaction boundary.
 */
export function formatTaskContinuityForPrompt(resumeContext: Partial<TaskResumeContext> | undefined): string {
  if (!resumeContext) return '';
  const summary = compactText((resumeContext as any).latestContextSummary, 4_000);
  const packet = (resumeContext as any).lastTurnPacket as TurnContextPacket | undefined;
  const commentary = compactText((resumeContext as any).commentaryContext, 6_000);
  const instruction = compactText((resumeContext as any).onResumeInstruction, 2_400);
  const parts = [
    summary ? `[TASK_COMPACTION_SUMMARY]\n${summary}\n[/TASK_COMPACTION_SUMMARY]` : '',
    packet ? formatTurnContextPacketForPrompt(packet) : '',
    commentary ? `[TASK_RECENT_DURABLE_COMMENTARY]\n${commentary}\n[/TASK_RECENT_DURABLE_COMMENTARY]` : '',
    instruction ? `[TASK_RESUME_INSTRUCTION]\n${instruction}\n[/TASK_RESUME_INSTRUCTION]` : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  const block = `[TASK_CONTINUITY_PACKET]\n${parts.join('\n\n')}\n[/TASK_CONTINUITY_PACKET]`;
  return block.length <= MAX_PROMPT_CHARS
    ? block
    : `${block.slice(0, MAX_PROMPT_CHARS - 18).trimEnd()}\n[...truncated]`;
}
