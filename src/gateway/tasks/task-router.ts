// src/gateway/task-router.ts
// Task intent detection, task control, blocked-task follow-up — extracted from server-v2.ts (Step 16.1).
// Exports: TaskRouterDeps, latestTaskForSession, findBlockedTaskForSession, findClarificationWaitingTask,
//          isResumeIntent, isRerunIntent, isCancelIntent, isStatusQuestion, isTaskListIntent,
//          isAdjustmentIntent, getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
//          parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText, launchBackgroundTaskRunner,
//          handleTaskControlAction, renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup

import path from 'path';
import {
  loadTask, saveTask, updateTaskStatus, setTaskStepRunning, appendJournal,
  updateResumeContext, listTasks, deleteTask, mutatePlan, getEvidenceBusSnapshot,
  createTask, type TaskRecord, type TaskStatus,
} from './task-store';
import { addMessage } from '../session';
import { BackgroundTaskRunner } from './background-task-runner';
import { type TaskControlResponse } from '../tool-builder';

const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  'queued', 'running', 'paused', 'stalled',
  'needs_assistance', 'awaiting_user_input', 'failed', 'waiting_subagent',
];

function inferTaskChannelFromSession(sessionId: string): 'web' | 'telegram' {
  return String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web';
}

// ─── Dep-injection interface ───────────────────────────────────────────────────
export interface TaskRouterDeps {
  handleChat: (...args: any[]) => Promise<any>;
  telegramChannel: any;
  makeBroadcastForTask: (taskId: string) => (data: object) => void;
  cronScheduler: any;
}

let _deps: TaskRouterDeps | null = null;
export function initTaskRouter(deps: TaskRouterDeps): void { _deps = deps; }

function getDeps(): TaskRouterDeps {
  if (!_deps) throw new Error('[task-router] Not initialized — call initTaskRouter() first');
  return _deps;
}

export function latestTaskForSession(sessionId: string, statuses: TaskStatus[]): TaskRecord | null {
  const tasks = listTasks({ status: statuses })
    .filter(t => t.sessionId === sessionId)
    .sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  return tasks[0] || null;
}

export function findBlockedTaskForSession(sessionId: string): TaskRecord | null {
  const blocked = listTasks({ status: ['needs_assistance', 'stalled', 'paused', 'failed', 'awaiting_user_input'] })
    .filter(t => t.sessionId === sessionId)
    .filter(t =>
      t.status === 'needs_assistance'
      || t.status === 'stalled'
      || t.status === 'failed'
      || t.status === 'awaiting_user_input'
      || (t.status === 'paused' && t.pauseReason !== 'user_pause'),
    )
    .sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  return blocked[0] || null;
}

/**
 * Find the most recent task for this session that is awaiting user input
 * (i.e. the AI asked a clarification question and needs a reply to proceed).
 */
export function findClarificationWaitingTask(sessionId: string): TaskRecord | null {
  const tasks = listTasks({ status: ['awaiting_user_input'] })
    .filter(t => t.sessionId === sessionId)
    .sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  return tasks[0] || null;
}

export function isResumeIntent(message: string): boolean {
  const text = message.trim();
  // Must explicitly reference resuming/continuing a task — not just a casual "go ahead"
  // which people often say when starting a NEW task ("go ahead and open chatgpt").
  // Require task context, or an explicit resume/rerun keyword standalone.
  if (/\b(resume|rerun|re-run|run again|retry|restart)\b/i.test(text)) return true;
  if (/\b(continue|proceed)\b.*\b(task|it|that|this)\b/i.test(text)) return true;
  if (/\b(go ahead|do it|apply)\b.*\b(task|resume|rerun)\b/i.test(text)) return true;
  return false;
}

export function isRerunIntent(message: string): boolean {
  return /\b(rerun|re-run|run again|retry|restart|start again)\b/i.test(message);
}

export function isCancelIntent(message: string): boolean {
  return /\b(cancel|abort|stop( task)?|do not continue|don't continue)\b/i.test(message);
}

export function isStatusQuestion(message: string): boolean {
  return /\?|^\s*(what|why|how|status|did|where|when)\b/i.test(message)
    || /\b(what happened|why did|status|stuck|failed|error|progress|what went wrong)\b/i.test(message);
}

export function isTaskListIntent(message: string): boolean {
  return /\b(what|which|show|list)\b.*\b(background\s+)?tasks?\b/i.test(message)
    || /\b(background\s+)?tasks?\b.*\b(do we have|running|active|current)\b/i.test(message);
}

export function isAdjustmentIntent(message: string): boolean {
  return /\b(instead|change|adjust|update|only|skip|don't|do not|use|delete|remove|clear|keep|retry|try again)\b/i.test(message);
}

export function getLatestPauseContext(task: TaskRecord): { reason: string; detail: string } {
  const latestPause = [...(task.journal || [])].reverse().find((j) => j.type === 'pause');
  if (latestPause) {
    return {
      reason: String(latestPause.content || '').replace(/^Task paused for assistance:\s*/i, '').slice(0, 220),
      detail: String(latestPause.detail || '').slice(0, 420),
    };
  }
  return { reason: task.pauseReason || 'paused', detail: '' };
}

export function summarizeTaskRecord(task: TaskRecord): Record<string, any> {
  const total = Array.isArray(task.plan) ? task.plan.length : 0;
  const step = Math.min((task.currentStepIndex || 0) + 1, Math.max(1, total));
  const done = (task.plan || []).filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const latestPause = getLatestPauseContext(task);
  return {
    task_id: task.id,
    title: task.title,
    status: task.status,
    pause_reason: task.pauseReason || null,
    step,
    total_steps: Math.max(1, total),
    completed_steps: done,
    last_issue: latestPause.reason || null,
    last_issue_detail: latestPause.detail || null,
    channel: task.channel,
    session_id: task.sessionId,
    last_progress_at: task.lastProgressAt,
    last_progress_iso: new Date(task.lastProgressAt).toISOString(),
    started_at: task.startedAt,
    started_at_iso: new Date(task.startedAt).toISOString(),
    completed_at: task.completedAt || null,
    completed_at_iso: task.completedAt ? new Date(task.completedAt).toISOString() : null,
  };
}

export function buildBlockedTaskStatusMessage(task: TaskRecord): string {
  const summary = summarizeTaskRecord(task);
  const lines = [
    `Task status: ${summary.title}`,
    `Status: ${summary.status}`,
    `Step: ${summary.step}/${summary.total_steps} (${summary.completed_steps} completed)`,
    summary.last_issue ? `Last issue: ${summary.last_issue}` : '',
    summary.last_issue_detail ? `Details: ${summary.last_issue_detail}` : '',
    `Task ID: ${summary.task_id}`,
    `You can say: "resume task ${summary.task_id}" or "rerun task ${summary.task_id}".`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function parseTaskStatusFilter(raw: any): TaskStatus[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const valid = new Set<TaskStatus>([
    'queued',
    'running',
    'paused',
    'stalled',
    'needs_assistance',
    'failed',
    'complete',
    'waiting_subagent',
  ]);
  const values = String(raw)
    .split(/[,\s]+/)
    .map(v => v.trim())
    .filter(Boolean) as TaskStatus[];
  const filtered = values.filter(v => valid.has(v));
  return filtered.length > 0 ? filtered : undefined;
}

export function getTaskScopeBuckets(sessionId: string, statuses?: TaskStatus[]) {
  const all = listTasks(statuses ? { status: statuses } : undefined).sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  const sessionTasks = all.filter(t => t.sessionId === sessionId);
  const channel = inferTaskChannelFromSession(sessionId);
  const channelTasks = all.filter(t => t.channel === channel && t.sessionId !== sessionId);
  return { all, sessionTasks, channelTasks, channel };
}

export function parseTaskIdFromText(text: string): string | null {
  const m = String(text || '').match(/\b([a-f0-9]{8}-[a-f0-9-]{27,})\b/i);
  return m ? m[1] : null;
}

export function launchBackgroundTaskRunner(taskId: string): void {
  const { handleChat, telegramChannel, makeBroadcastForTask } = getDeps();
  const runner = new BackgroundTaskRunner(taskId, handleChat, makeBroadcastForTask(taskId), telegramChannel);
  runner.start().catch(err => console.error(`[BackgroundTaskRunner] task_control start ${taskId} error:`, err.message));
}

export async function handleTaskControlAction(sessionId: string, args: any): Promise<TaskControlResponse> {
  const action = String(args?.action || '').trim().toLowerCase();
  const taskId = String(args?.task_id || args?.id || '').trim();
  const includeAllSessions = args?.include_all_sessions === true;
  const note = String(args?.note || '').trim();
  const limitRaw = Number(args?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
  const statusFilter = parseTaskStatusFilter(args?.status);

  if (!action) {
    return { success: false, action: 'unknown', code: 'invalid_action', message: 'task_control requires action.' };
  }

  if (action === 'list' || action === 'latest') {
    const statuses = statusFilter || (action === 'list' ? ACTIVE_TASK_STATUSES : undefined);
    const scope = getTaskScopeBuckets(sessionId, statuses);
    const tasks = includeAllSessions
      ? scope.all
      : [...scope.sessionTasks, ...scope.channelTasks];
    if (action === 'latest') {
      const latest = tasks[0] || null;
      return {
        success: true,
        action,
        scope: includeAllSessions ? 'all_sessions' : `session+${scope.channel}`,
        task: latest ? summarizeTaskRecord(latest) : null,
        message: latest ? `Latest task is "${latest.title}" (${latest.status}).` : 'No tasks found.',
      };
    }
    const summarized = tasks.slice(0, limit).map(summarizeTaskRecord);

    // Also include scheduled (cron) jobs so the agent can answer questions like
    // "what scheduled tasks do we have" without needing a separate schedule_job(list) call
    const { cronScheduler: _cs } = getDeps();
    const scheduledJobs = _cs.getJobs().map((j: any) => ({
      id: j.id,
      kind: 'scheduled_job',
      name: j.name,
      schedule: j.schedule || null,
      type: j.type,
      status: j.status,
      enabled: j.enabled,
      nextRun: j.nextRun || null,
      lastRun: j.lastRun || null,
      lastResult: j.lastResult ? String(j.lastResult).slice(0, 120) : null,
    }));

    const totalMsg = [
      summarized.length > 0 ? `${summarized.length} background task(s)` : null,
      scheduledJobs.length > 0 ? `${scheduledJobs.length} scheduled job(s)` : null,
    ].filter(Boolean).join(', ');

    return {
      success: true,
      action,
      scope: includeAllSessions ? 'all_sessions' : `session+${scope.channel}`,
      tasks: summarized,
      scheduled_jobs: scheduledJobs,
      message: totalMsg ? `Found ${totalMsg}.` : 'No background tasks or scheduled jobs found.',
    };
  }

  if (action === 'get') {
    if (!taskId) return { success: false, action, code: 'missing_task_id', message: 'task_control(get) requires task_id.' };
    const task = loadTask(taskId);
    if (!task) return { success: false, action, code: 'not_found', message: `Task not found: ${taskId}` };
    return { success: true, action, task: summarizeTaskRecord(task), message: `Loaded task "${task.title}".` };
  }

  const resolveCandidateForAction = (candidateAction: 'resume' | 'rerun' | 'pause' | 'cancel' | 'delete') => {
    if (taskId) {
      const exact = loadTask(taskId);
      if (!exact) return { task: null as TaskRecord | null, err: `Task not found: ${taskId}` };
      return { task: exact, err: '' };
    }

    const preferredStatuses: TaskStatus[] =
      candidateAction === 'rerun'
        ? ['needs_assistance', 'stalled', 'paused', 'awaiting_user_input', 'failed', 'complete']
        : candidateAction === 'delete'
          ? ['needs_assistance', 'stalled', 'paused', 'awaiting_user_input', 'failed', 'queued', 'complete', 'waiting_subagent']
          // 'running' included so tasks stuck in running state (dead runner) can be resumed
          : ['needs_assistance', 'stalled', 'paused', 'awaiting_user_input', 'failed', 'queued', 'running'];
    const scope = getTaskScopeBuckets(sessionId, preferredStatuses);
    let preferred = [...scope.sessionTasks, ...scope.channelTasks];
    if (preferred.length === 0) {
      preferred = scope.all;
    }
    if (preferred.length === 0) {
      return { task: null as TaskRecord | null, err: 'No matching task found in current scope.' };
    }
    if (preferred.length === 1) {
      return { task: preferred[0], err: '' };
    }
    return { task: null as TaskRecord | null, err: 'AMBIGUOUS', candidates: preferred.slice(0, 3) };
  };

  if (action === 'resume' || action === 'rerun') {
    const resolved = resolveCandidateForAction(action);
    if (!resolved.task) {
      if (resolved.err === 'AMBIGUOUS') {
        return {
          success: false,
          action,
          code: 'ambiguous',
          message: 'Multiple tasks match. Provide task_id.',
          candidates: (resolved.candidates || []).map(summarizeTaskRecord),
        };
      }
      return { success: false, action, code: 'no_candidate', message: resolved.err };
    }
    const task = loadTask(resolved.task.id);
    if (!task) return { success: false, action, code: 'not_found', message: `Task not found: ${resolved.task.id}` };
    if (BackgroundTaskRunner.isRunning(task.id)) {
      return {
        success: true,
        action,
        task: summarizeTaskRecord(task),
        message: `Task "${task.title}" is already actively running (runner is live).`,
      };
    }

    // Status is 'running' but no active runner found — runner died without cleanup.
    // Auto-correct the stale status so the resume proceeds normally.
    if (task.status === 'running') {
      appendJournal(task.id, { type: 'status_push', content: 'Stale running status detected (no active runner). Auto-correcting to paused for resume.' });
      BackgroundTaskRunner.forceRelease(task.id); // clear any ghost activeRunners entry
      updateTaskStatus(task.id, 'paused', { pauseReason: 'error' });
      task.status = 'paused'; // keep local ref in sync
    }

    if (action === 'resume') {
      if (task.status === 'complete') {
        return { success: false, action, code: 'already_complete', message: `Task "${task.title}" is complete. Use rerun to restart.` };
      }
      updateTaskStatus(task.id, 'queued');
      appendJournal(task.id, { type: 'resume', content: `task_control resume${note ? `: ${note.slice(0, 220)}` : ''}` });
      // Reset self-heal counter so the user's manual intervention gives a fresh start
      task.selfHealAttempts = 0;
      task.resynthAttempts = 0;
      saveTask(task);
      if (note) {
        const resumeMessages = Array.isArray(task.resumeContext?.messages) ? task.resumeContext.messages : [];
        updateResumeContext(task.id, {
          messages: [
            ...resumeMessages,
            { role: 'user', content: `[TASK USER FOLLOW-UP]\n${note}`, timestamp: Date.now() },
          ].slice(-80),
        });
      }
      launchBackgroundTaskRunner(task.id);
      const refreshed = loadTask(task.id) || task;
      return {
        success: true,
        action,
        task: summarizeTaskRecord(refreshed),
        message: `Resumed task "${refreshed.title}" at step ${refreshed.currentStepIndex + 1}/${Math.max(1, refreshed.plan.length)}.`,
      };
    }

    // rerun
    task.status = 'queued';
    task.pauseReason = undefined;
    task.currentStepIndex = 0;
    task.completedAt = undefined;
    task.finalSummary = undefined;
    task.lastToolCall = undefined;
    task.lastToolCallAt = undefined;
    task.lastProgressAt = Date.now();
    task.plan = (task.plan || []).map((step, idx) => ({
      ...step,
      index: idx,
      status: 'pending',
      completedAt: undefined,
      notes: undefined,
    }));
    task.resumeContext = {
      ...(task.resumeContext || {
        messages: [],
        browserSessionActive: false,
        round: 0,
        orchestrationLog: [],
      }),
      messages: [],
      browserSessionActive: false,
      browserUrl: undefined,
      round: 0,
      orchestrationLog: [],
      fileOpState: undefined,
    };
    saveTask(task);
    appendJournal(task.id, { type: 'status_push', content: `task_control rerun${note ? `: ${note.slice(0, 220)}` : ''}` });
    launchBackgroundTaskRunner(task.id);
    const refreshed = loadTask(task.id) || task;
    return {
      success: true,
      action,
      task: summarizeTaskRecord(refreshed),
      message: `Rerunning task "${refreshed.title}" from step 1/${Math.max(1, refreshed.plan.length)}.`,
    };
  }

  if (action === 'pause' || action === 'cancel') {
    const resolved = resolveCandidateForAction(action as any);
    if (!resolved.task) {
      if (resolved.err === 'AMBIGUOUS') {
        return {
          success: false,
          action,
          code: 'ambiguous',
          message: 'Multiple tasks match. Provide task_id.',
          candidates: (resolved.candidates || []).map(summarizeTaskRecord),
        };
      }
      return { success: false, action, code: 'no_candidate', message: resolved.err };
    }
    if (action === 'cancel' && args?.confirm !== true) {
      return { success: false, action, code: 'needs_confirmation', message: 'cancel requires confirm=true.' };
    }
    const task = loadTask(resolved.task.id);
    if (!task) return { success: false, action, code: 'not_found', message: `Task not found: ${resolved.task.id}` };
    if (BackgroundTaskRunner.isRunning(task.id)) {
      BackgroundTaskRunner.requestPause(task.id);
    }
    updateTaskStatus(task.id, 'paused', { pauseReason: 'user_pause' });
    appendJournal(task.id, { type: 'pause', content: `task_control ${action}${note ? `: ${note.slice(0, 220)}` : ''}` });
    const refreshed = loadTask(task.id) || task;
    return {
      success: true,
      action,
      task: summarizeTaskRecord(refreshed),
      message: `${action === 'cancel' ? 'Cancelled' : 'Paused'} task "${refreshed.title}".`,
    };
  }

  if (action === 'delete') {
    if (args?.confirm !== true) {
      return { success: false, action, code: 'needs_confirmation', message: 'delete requires confirm=true.' };
    }
    const resolved = resolveCandidateForAction('delete');
    if (!resolved.task) {
      if (resolved.err === 'AMBIGUOUS') {
        return {
          success: false,
          action,
          code: 'ambiguous',
          message: 'Multiple tasks match. Provide task_id.',
          candidates: (resolved.candidates || []).map(summarizeTaskRecord),
        };
      }
      return { success: false, action, code: 'no_candidate', message: resolved.err };
    }
    if (BackgroundTaskRunner.isRunning(resolved.task.id)) {
      return { success: false, action, code: 'running', message: `Task "${resolved.task.title}" is running. Pause it before delete.` };
    }
    const ok = deleteTask(resolved.task.id);
    if (!ok) return { success: false, action, code: 'not_found', message: `Task not found: ${resolved.task.id}` };
    return { success: true, action, message: `Deleted task "${resolved.task.title}" (${resolved.task.id}).` };
  }

  return { success: false, action, code: 'invalid_action', message: `Unsupported task_control action: ${action}` };
}

export function renderTaskCandidatesForHuman(candidates: Array<Record<string, any>>): string {
  if (!Array.isArray(candidates) || candidates.length === 0) return 'No candidates found.';
  return candidates
    .slice(0, 3)
    .map((c, i) => `${i + 1}. ${c.title} [${c.status}] — Task ID: ${c.task_id}`)
    .join('\n');
}

export async function tryHandleBlockedTaskFollowup(sessionId: string, rawMessage: string): Promise<string | null> {
  if (String(sessionId || '').startsWith('task_')) return null;
  const message = String(rawMessage || '').trim();
  if (!message) return null;

  // ── Path 0: Task awaiting clarification — user's reply is the answer ─────────
  // When the AI asked a question mid-task and paused for user input, ANY message
  // (unless it's a cancel) should be treated as the user's answer and injected
  // into the task session so it can resume with that context.
  const clarificationTask = findClarificationWaitingTask(sessionId);
  if (clarificationTask) {
    // If the user wants to cancel, honour that
    if (isCancelIntent(message)) {
      const ctl = await handleTaskControlAction(sessionId, { action: 'pause', task_id: clarificationTask.id, note: message });
      return ctl.success ? `Cancelled task "${clarificationTask.title}".` : null;
    }

    // Otherwise, treat the message as the clarification answer.
    // Inject it into the task session and clear the pending question.
    const taskSessionId = `task_${clarificationTask.id}`;
    addMessage(taskSessionId, {
      role: 'user',
      content: `[USER CLARIFICATION] ${message}`,
      timestamp: Date.now(),
    });
    appendJournal(clarificationTask.id, {
      type: 'status_push',
      content: `User answered clarification question: ${message.slice(0, 200)}`,
    });

    // Update resume context so the answer survives into the next runner round
    updateResumeContext(clarificationTask.id, {
      onResumeInstruction: `The user answered your clarification question. Their answer: "${message}". Use this to complete the current step now — do NOT ask again.`,
    });

    // Clear pending question and resume the task
    const freshTask = loadTask(clarificationTask.id);
    if (freshTask) {
      delete (freshTask as any).pendingClarificationQuestion;
      saveTask(freshTask);
    }

    updateTaskStatus(clarificationTask.id, 'queued');
    const { handleChat: _hc, makeBroadcastForTask: _mbft, telegramChannel: _tc } = getDeps();
    const runner = new BackgroundTaskRunner(
      clarificationTask.id,
      _hc,
      _mbft(clarificationTask.id),
      _tc,
    );
    runner.start().catch((err: any) =>
      console.error(`[ClarificationResume] Task ${clarificationTask.id} resume error:`, err.message),
    );

    console.log(`[ClarificationResume] User answered clarification for task ${clarificationTask.id}: "${message.slice(0, 80)}". Resuming.`);
    return `Got it — resuming task "${clarificationTask.title}" with your answer.`;
  }

  // ── Path A: Explicit task UUID in the message (original behavior) ───────────
  const explicitTaskId = parseTaskIdFromText(message);
  if (explicitTaskId) {
    const rerunRequested = isRerunIntent(message);
    const resumeRequested = isResumeIntent(message);
    const cancelRequested = isCancelIntent(message);
    if (!rerunRequested && !resumeRequested && !cancelRequested) return null;
    const action = rerunRequested ? 'rerun' : cancelRequested ? 'pause' : 'resume';
    const ctl = await handleTaskControlAction(sessionId, { action, task_id: explicitTaskId, note: message });
    return ctl.success ? (ctl.message || null) : null;
  }

  // ── Path B: No UUID — look for a blocked/escalated task on this session ─────
  // Handles user messages like "proceed", "I logged in", "go ahead", "fixed it", etc.
  // where the task ID is implicit from context.
  const blockedTask = findBlockedTaskForSession(sessionId);
  if (!blockedTask) return null;

  const cancelRequested = isCancelIntent(message);
  const rerunRequested = isRerunIntent(message);

  // Broad resume detection: standard resume verbs OR short affirmations that only
  // make sense as "yes, continue" replies when a blocked task already exists.
  const resumeRequestedBroad =
    isResumeIntent(message) ||
    /^\s*(proceed|go ahead|ok|okay|continue|yes|yep|sure|do it|keep going|try again|move on|sounds good|ready|done|fixed|logged in|i logged in|it('s| is) fixed|all good)\.?\s*$/i.test(message) ||
    /\b(logged in|fixed it|done now|all set|ready now|proceed|go ahead)\.?$/i.test(message);

  if (!resumeRequestedBroad && !cancelRequested && !rerunRequested) return null;

  // Safety: if the message is long and contains strong new-task language, let it
  // fall through to the AI rather than hijacking it as a resume.
  const hasNewTaskLanguage =
    message.length > 80 &&
    /\b(open|go to|navigate|search for|create a|make a|write a|post a|send a|find me|check the)\b/i.test(message);
  if (hasNewTaskLanguage) return null;

  const action = rerunRequested ? 'rerun' : cancelRequested ? 'pause' : 'resume';
  const ctl = await handleTaskControlAction(sessionId, {
    action,
    task_id: blockedTask.id,
    note: message,
  });

  if (!ctl.success) return null;

  const verb = action === 'resume' ? 'Resuming' : action === 'rerun' ? 'Rerunning' : 'Cancelling';
  const taskLabel = `"${blockedTask.title}"`;
  return `${verb} task ${taskLabel}. ${ctl.message || ''}`.trim();
}
