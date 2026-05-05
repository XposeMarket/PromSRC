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
import { addMessage, clearHistory } from '../session';
import { BackgroundTaskRunner } from './background-task-runner';
import { type TaskControlResponse } from '../tool-builder';
import {
  buildTaskPauseSnapshot,
  formatTaskPauseSnapshot,
  formatTaskRecoveryConversation,
  getTaskRecoveryNoToolsFilter,
  getTaskRecoverySessionId,
  getTaskReplySessionIds,
  getTaskResumeBriefSessionId,
  isTaskRecoveryEligible,
  matchesTaskReplySession,
  syncTaskRecoverySession,
} from './task-recovery';

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

const RECOVERY_BLOCKED_STATUSES: TaskStatus[] = [
  'needs_assistance',
  'stalled',
  'paused',
  'failed',
  'awaiting_user_input',
];

function isRecoveryBlockedTask(task: TaskRecord | null | undefined): boolean {
  if (!task || !isTaskRecoveryEligible(task)) return false;
  if (!RECOVERY_BLOCKED_STATUSES.includes(task.status)) return false;
  return task.status !== 'paused' || task.pauseReason !== 'user_pause';
}

function findRecoveryTaskForReplySession(sessionId: string, statuses?: TaskStatus[]): TaskRecord | null {
  const blocked = listTasks({ status: statuses || RECOVERY_BLOCKED_STATUSES })
    .filter((task) => isRecoveryBlockedTask(task))
    .filter((task) => matchesTaskReplySession(task, sessionId))
    .sort((a, b) => b.lastProgressAt - a.lastProgressAt);
  return blocked[0] || null;
}

function buildTaskRecoveryCallerContext(task: TaskRecord, objective: 'conversation' | 'resume_brief'): string {
  const liveTask = loadTask(task.id) || task;
  const snapshot = liveTask.pauseSnapshot || buildTaskPauseSnapshot(liveTask);
  const latestAnalysis = String(liveTask.pauseAnalysis?.message || '').trim();
  const latestConversation = formatTaskRecoveryConversation(liveTask.recoveryConversation, { maxTurns: 14 });
  return [
    objective === 'resume_brief'
      ? 'TASK RECOVERY MODE: resume brief synthesis.'
      : 'TASK RECOVERY MODE: paused-task conversation.',
    'This is a task-attached recovery conversation for a paused background task.',
    'Do not use tools.',
    objective === 'resume_brief'
      ? 'Write only the compact execution brief the task runner should receive next. Do not include pleasantries.'
      : 'Answer the user using the paused-task context below. Explain what happened, what is known, and the safest next step.',
    '',
    formatTaskPauseSnapshot(snapshot, { maxChars: objective === 'resume_brief' ? 60_000 : 80_000 }),
    '',
    '[LATEST PAUSE ANALYSIS]',
    latestAnalysis || '(none)',
    '',
    '[RECOVERY DISCUSSION SO FAR]',
    latestConversation,
    '',
    objective === 'resume_brief'
      ? 'The output must be a compact recovery plan for the worker. Include what failed, agreed fix, what to avoid repeating, and the exact next step.'
      : 'Stay in discussion mode unless the outer system has already chosen to resume the task.',
  ].filter(Boolean).join('\n');
}

async function generateTaskRecoveryReply(task: TaskRecord, userMessage: string): Promise<string> {
  const liveTask = loadTask(task.id) || task;
  if (!liveTask.pauseSnapshot) {
    liveTask.pauseSnapshot = buildTaskPauseSnapshot(liveTask);
    saveTask(liveTask);
  }
  syncTaskRecoverySession(liveTask);
  const { handleChat } = getDeps();
  const result = await handleChat(
    userMessage,
    getTaskRecoverySessionId(liveTask.id),
    () => {},
    undefined,
    undefined,
    buildTaskRecoveryCallerContext(liveTask, 'conversation'),
    undefined,
    undefined,
    getTaskRecoveryNoToolsFilter(),
    undefined,
    undefined,
    liveTask.executorProvider,
  );
  return String(result?.text || '').trim();
}

async function synthesizeTaskResumeBrief(task: TaskRecord, latestUserMessage: string, action: 'resume' | 'rerun'): Promise<string> {
  const liveTask = loadTask(task.id) || task;
  if (!liveTask.pauseSnapshot) {
    liveTask.pauseSnapshot = buildTaskPauseSnapshot(liveTask);
    saveTask(liveTask);
  }
  const briefSessionId = getTaskResumeBriefSessionId(liveTask.id);
  try {
    clearHistory(briefSessionId);
  } catch {}
  const prompt = [
    `User approval mode: ${action}.`,
    `Latest user instruction: ${latestUserMessage}`,
    '',
    'Write the compact resume brief for the task runner.',
    'Keep it focused on:',
    '- where the task stopped',
    '- what failed or was missing',
    '- the agreed fix or guidance from the recovery discussion',
    '- what to do next',
    '- what not to repeat',
    '',
    'Output plain text only.',
  ].join('\n');
  const { handleChat } = getDeps();
  const result = await handleChat(
    prompt,
    briefSessionId,
    () => {},
    undefined,
    undefined,
    buildTaskRecoveryCallerContext(liveTask, 'resume_brief'),
    undefined,
    undefined,
    getTaskRecoveryNoToolsFilter(),
    undefined,
    undefined,
    liveTask.executorProvider,
  );
  const text = String(result?.text || '').trim();
  if (text) return text;
  const currentStep = Math.min((liveTask.currentStepIndex || 0) + 1, Math.max(1, liveTask.plan.length));
  return [
    `Resume task "${liveTask.title}" from step ${currentStep}/${Math.max(1, liveTask.plan.length)}.`,
    liveTask.pauseAnalysis?.message ? `Pause analysis: ${liveTask.pauseAnalysis.message}` : '',
    `Latest user instruction: ${latestUserMessage}`,
    'Continue from the blocked step using the agreed recovery guidance. Do not restart completed work unless it is explicitly required.',
  ].filter(Boolean).join('\n');
}

function persistRecoveryConversationUpdate(
  taskId: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number; source?: 'pause_analysis' | 'chat' | 'task_panel' | 'team_manager' | 'system' }>,
  opts?: { resumeBrief?: string; approvedAction?: 'resume' | 'rerun'; clearPendingClarification?: boolean },
): TaskRecord | null {
  const liveTask = loadTask(taskId);
  if (!liveTask) return null;
  const existing = Array.isArray(liveTask.recoveryConversation) ? liveTask.recoveryConversation.slice(-30) : [];
  const appended = turns
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim())
    .map((turn, idx) => ({
      role: turn.role,
      content: String(turn.content || '').trim(),
      timestamp: Number(turn.timestamp) || (Date.now() + idx),
      source: turn.source,
    }));
  liveTask.recoveryConversation = [...existing, ...appended].slice(-40);
  if (opts?.resumeBrief) {
    liveTask.resumeBrief = {
      createdAt: Date.now(),
      content: opts.resumeBrief,
      approvedAction: opts.approvedAction,
    };
    liveTask.resumeContext = {
      ...(liveTask.resumeContext || {
        messages: [],
        browserSessionActive: false,
        round: 0,
        orchestrationLog: [],
      }),
      onResumeInstruction: [
        '[TASK RECOVERY BRIEF]',
        opts.resumeBrief,
        'Continue from the current blocked step. Use the recovery brief above instead of replaying the failure chat log.',
        '[/TASK RECOVERY BRIEF]',
      ].join('\n'),
    };
  }
  if (opts?.clearPendingClarification && liveTask.pendingClarificationQuestion) {
    delete liveTask.pendingClarificationQuestion;
  }
  saveTask(liveTask);
  try {
    syncTaskRecoverySession(liveTask);
  } catch {}
  return liveTask;
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

	    const activeBuildRepair = task.proposalExecution?.buildFailure;
	    const activeRepairProposalId = String(activeBuildRepair?.repairProposalId || '').trim();
	    const activeRepairTaskId = String(activeBuildRepair?.repairTaskId || '').trim();
	    const isBlockedOnRepair = !!activeBuildRepair
	      && activeBuildRepair.status !== 'resolved'
	      && (task.pauseReason === 'blocked_on_repair' || !!activeRepairProposalId || !!activeRepairTaskId);
	    if (isBlockedOnRepair) {
	      return {
	        success: false,
	        action,
	        code: 'blocked_on_repair',
	        task: summarizeTaskRecord(task),
	        message: `Task "${task.title}" is blocked on a linked repair${activeRepairProposalId ? ` proposal ${activeRepairProposalId}` : ''}${activeRepairTaskId ? ` (task ${activeRepairTaskId})` : ''}. Approve or finish that repair flow before resuming or rerunning the original task.`,
	      };
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

export async function handleTaskRecoveryMessage(
  taskId: string,
  rawMessage: string,
  opts?: { sourceSessionId?: string; source?: 'chat' | 'task_panel' | 'team_manager' },
): Promise<{ handled: boolean; resumed: boolean; reply: string | null; action?: 'conversation' | 'resume' | 'rerun' | 'cancel' }> {
  const task = loadTask(taskId);
  const message = String(rawMessage || '').trim();
  if (!task || !message || !isRecoveryBlockedTask(task)) {
    return { handled: false, resumed: false, reply: null };
  }

  const source = opts?.source === 'task_panel' ? 'task_panel' : opts?.source === 'team_manager' ? 'team_manager' : 'chat';
  const sourceSessionId = String(opts?.sourceSessionId || task.sessionId || getTaskReplySessionIds(task)[0] || '').trim();

  if (isCancelIntent(message)) {
    const ctl = await handleTaskControlAction(sourceSessionId, { action: 'pause', task_id: task.id, note: message });
    const reply = ctl.success ? (ctl.message || `Paused task "${task.title}".`) : `Could not pause task "${task.title}".`;
    persistRecoveryConversationUpdate(task.id, [
      { role: 'user', content: message, source },
      { role: 'assistant', content: reply, source: 'system' },
    ]);
    appendJournal(task.id, { type: 'status_push', content: `Recovery conversation cancelled task: ${message.slice(0, 200)}` });
    return { handled: true, resumed: false, reply, action: 'cancel' };
  }

  const explicitRerunRequested = /\b(rerun|re-run|restart|start again|from scratch)\b/i.test(message);
  const resumeRequestedBroad =
    isResumeIntent(message) ||
    /\b(retry|try again)\b/i.test(message) ||
    /^\s*(proceed|go ahead|ok|okay|continue|yes|yep|sure|do it|keep going|sounds good|ready|do that)\.?\s*$/i.test(message) ||
    /\b(go ahead|continue|resume|proceed|apply|do that|use that plan)\b/i.test(message);

  if (explicitRerunRequested || resumeRequestedBroad) {
    const approvedAction: 'resume' | 'rerun' = explicitRerunRequested ? 'rerun' : 'resume';
    const resumeBrief = await synthesizeTaskResumeBrief(task, message, approvedAction);
    const summaryReply = approvedAction === 'rerun'
      ? `Rerunning task "${task.title}" from the start with the recovery brief below.\n\n${resumeBrief}`
      : `Resuming task "${task.title}" with the recovery brief below.\n\n${resumeBrief}`;
    persistRecoveryConversationUpdate(
      task.id,
      [
        { role: 'user', content: message, source },
        { role: 'assistant', content: summaryReply, source: 'system' },
      ],
      {
        resumeBrief,
        approvedAction,
        clearPendingClarification: true,
      },
    );
    const ctl = await handleTaskControlAction(sourceSessionId, { action: approvedAction, task_id: task.id });
    const reply = ctl.success
      ? summaryReply
      : `${summaryReply}\n\nI prepared the recovery brief, but I could not ${approvedAction} the task automatically: ${ctl.message || 'unknown error'}`;
    appendJournal(task.id, {
      type: 'resume',
      content: `Recovery discussion approved ${approvedAction}: ${message.slice(0, 220)}`,
    });
    return { handled: true, resumed: !!ctl.success, reply, action: approvedAction };
  }

  let reply = '';
  try {
    reply = await generateTaskRecoveryReply(task, message);
  } catch (err: any) {
    console.warn(`[TaskRecovery] Conversation reply failed for task ${task.id}:`, err?.message || err);
  }
  if (!reply) {
    reply = task.pauseAnalysis?.message || buildBlockedTaskStatusMessage(task);
  }
  persistRecoveryConversationUpdate(task.id, [
    { role: 'user', content: message, source },
    { role: 'assistant', content: reply, source: 'system' },
  ]);
  appendJournal(task.id, {
    type: 'status_push',
    content: `Recovery conversation updated via ${source}: ${message.slice(0, 200)}`,
  });
  return { handled: true, resumed: false, reply, action: 'conversation' };
}

export async function mirrorTeamManagerProposalResponse(teamId: string, managerMessage: string): Promise<{ handled: boolean; taskId?: string; resumed?: boolean }> {
  const cleanTeamId = String(teamId || '').trim();
  const message = String(managerMessage || '').trim();
  if (!cleanTeamId || !message) return { handled: false };
  const candidates = listTasks({ status: ['needs_assistance', 'awaiting_user_input', 'paused', 'stalled', 'failed'] })
    .filter((task) => String(task.proposalExecution?.teamExecution?.teamId || '') === cleanTeamId)
    .sort((a, b) => Number(b.lastProgressAt || b.startedAt || 0) - Number(a.lastProgressAt || a.startedAt || 0));
  const task = candidates[0];
  if (!task) return { handled: false };
  const proposalId = String(task.proposalExecution?.proposalId || '').trim();
  const labeledMessage = [
    `Manager response to proposal executor:`,
    proposalId ? `Proposal: ${proposalId}` : '',
    `Task: ${task.id}`,
    '',
    message,
  ].filter(Boolean).join('\n');
  const recoveryInstruction = `${labeledMessage}\n\nContinue the proposal task using this manager guidance.`;
  const recovery = await handleTaskRecoveryMessage(task.id, recoveryInstruction, {
    sourceSessionId: String(task.proposalExecution?.teamExecution?.managerSessionId || `team_coord_${cleanTeamId}`),
    source: 'team_manager',
  });
  if (recovery.handled) {
    appendJournal(task.id, {
      type: recovery.resumed ? 'resume' : 'status_push',
      content: `Manager response mirrored from team chat: ${message.slice(0, 180)}`,
    });
    try {
      const { getConfig } = await import('../../config/config.js');
      const { notifyMainAgent } = await import('../teams/notify-bridge.js');
      notifyMainAgent(
        getConfig().getWorkspacePath(),
        cleanTeamId,
        recovery.resumed ? 'team_report_ready' : 'team_error',
        {
          proposalId,
          taskId: task.id,
          task: task.title,
          summary: 'Manager responded to paused proposal executor and resumed/recovery-handled the task.',
          error: recovery.resumed ? undefined : labeledMessage.slice(0, 500),
          event: recovery.resumed ? 'manager_resumed_team_proposal' : 'manager_replied_to_team_proposal',
          message: labeledMessage.slice(0, 2000),
        },
        undefined,
        task.proposalExecution?.teamExecution?.originatingSessionId,
      );
    } catch {}
  }
  return { handled: recovery.handled, taskId: task.id, resumed: recovery.resumed };
}

export async function tryHandleBlockedTaskFollowup(sessionId: string, rawMessage: string): Promise<string | null> {
  if (String(sessionId || '').startsWith('task_')) return null;
  const message = String(rawMessage || '').trim();
  if (!message) return null;

  const recoveryTask = findRecoveryTaskForReplySession(sessionId);
  if (recoveryTask) {
    const recovery = await handleTaskRecoveryMessage(recoveryTask.id, message, { sourceSessionId: sessionId, source: 'chat' });
    if (recovery.handled) return recovery.reply;
  }

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
