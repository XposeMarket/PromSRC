/**
 * background-task-runner.ts
 *
 * Executes a TaskRecord autonomously in the background, detached from any HTTP request.
 * Agent-driven step completion: the AI calls step_complete() to advance the plan.
 * No external auditor. No per-round verification LLM call.
 *
 * Stall detection: if 10 tool calls fire with no step_complete, inject a nudge.
 * Stall counter resets automatically when any write/mutate tool fires (real progress).
 */

import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../../config/config';
import {
  loadTask,
  saveTask,
  createTask,
  updateTaskStatus,
  setTaskStepRunning,
  appendJournal,
  mutatePlan,
  updateResumeContext,
  updateTaskRuntimeProgress,
  resolveSubagentCompletion,
  writeToEvidenceBus,
  loadEvidenceBus,
  type TaskRecord,
} from './task-store';
import { clearHistory, addMessage, getHistory, flushSession } from '../session';
import { activateToolCategory } from '../session';
import { errorCategorizer } from '../errors/error-categorizer';
import { getRetryStrategy } from '../retry-strategy';
import { getErrorAnalyzer } from '../errors/error-analyzer';
import { getErrorHistory } from '../errors/error-history';
// task-self-healer / synthesis round removed — lastResultSummary is delivered directly
import { runWithWorkspace } from '../../tools/workspace-context';
import { getSubagentToolFilter } from '../../tools/registry';
import {
  formatTelegramProgressState,
  formatTelegramToolCall,
  inferActorFromTask,
} from '../comms/telegram-tool-log';

// ─── Globals ──────────────────────────────────────────────────────────────────
const pauseRequests = new Set<string>();
const activeRunners = new Set<string>();
const taskAbortSignals = new Map<string, { aborted: boolean }>();  // Per-task abort signals for immediate pause

const MAX_RESUME_MESSAGES = 10;
const BACKGROUND_SESSION_MAX_MESSAGES = 40;
const DEFAULT_ROUND_TIMEOUT_MS = 120_000;
// How long to wait after the LAST tool call before timing out a round.
// This resets on every tool_call SSE event so slow-starting models don't
// burn the budget before their first tool fires.
const INACTIVITY_TIMEOUT_MS = 120_000;
// After this many tool calls with no step_complete, inject a nudge.
const STALL_TOOL_CALL_THRESHOLD = 10;
// Tools that indicate real write progress — reset stall counter when fired.
const MUTATE_TOOLS = new Set([
  'find_replace', 'find_replace_source',
  'replace_lines', 'replace_lines_source',
  'insert_after_source', 'delete_lines_source', 'write_source',
  'create_file', 'write_file', 'append_file',
  'write_note', 'delete_file', 'rename_file',
  'browser_fill', 'browser_click',
]);

function resolveRoundTimeoutMs(isResearchTask?: boolean): number {
  const candidates = [
    process.env.LOCALCLAW_BG_ROUND_TIMEOUT_MS,
    process.env.LOCALCLAW_TASK_ROUND_TIMEOUT_MS,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 10_000) return Math.floor(n);
  }
  if (isResearchTask) return 300_000;
  return DEFAULT_ROUND_TIMEOUT_MS;
}

function buildSubagentToolFilter(subagentProfile: string | undefined): string[] | undefined {
  return getSubagentToolFilter(subagentProfile);
}

function looksLikeClarificationQuestion(text: string): boolean {
  if (!text || text.length < 20) return false;
  const t = text.trim();
  const hasQuestion = t.includes('?');
  const hasNeedPhrasing = /\b(i need|please (provide|tell|give|let me know|share|specify)|to complete this|before i can|in order to|could you (provide|tell|share|confirm|clarify|give)|what (exactly|should|would|tone|text|content|do you want))\b/i.test(t);
  if (!hasQuestion && !hasNeedPhrasing) return false;
  const strongSignals = [
    /\bwhat (exactly|should|would|tone|text|content|link|hashtag|word.?for.?word)\b/i,
    /\bplease (provide|tell me|share|let me know|specify|give me)\b/i,
    /\bi need (you to|the|your|exact|more|a|an|to know)\b/i,
    /\bto complete this (step|task|request)\b/i,
    /\b(tell me|let me know)\b.*\?/i,
    /\b(word.?for.?word|exact text|exact wording|exact content)\b/i,
    /\b(1[\)\.]|2[\)\.]|3[\)\.]).*\n.*(1[\)\.]|2[\)\.])/i,
  ];
  return strongSignals.some(re => re.test(t));
}

function extractClarificationQuestion(text: string): string {
  return text.trim().slice(0, 800);
}

function isProposalLikeSourceSessionId(sessionId: string): boolean {
  const sid = String(sessionId || '');
  return sid.startsWith('proposal_') || sid.startsWith('code_exec');
}

export class BackgroundTaskRunner {
  private taskId: string;
  private handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'proposal_execution' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent',
    toolFilter?: string[],
    attachments?: undefined,
    reasoningOptions?: undefined,
    providerOverride?: string,
  ) => Promise<{ type: string; text: string; thinking?: string }>;
  private broadcast: (data: object) => void;
  private telegramChannel: {
    sendToAllowed: (text: string) => Promise<void>;
    sendMessage?: (chatId: number, text: string) => Promise<void>;
  } | null;
  private openingAction: string | undefined;

  constructor(
    taskId: string,
    handleChat: BackgroundTaskRunner['handleChat'],
    broadcast: (data: object) => void,
    telegramChannel: {
      sendToAllowed: (text: string) => Promise<void>;
      sendMessage?: (chatId: number, text: string) => Promise<void>;
    } | null,
    openingAction?: string,
  ) {
    this.taskId = taskId;
    this.handleChat = handleChat;
    this.broadcast = broadcast;
    this.telegramChannel = telegramChannel;
    this.openingAction = openingAction;
  }

  static requestPause(taskId: string): void {
    pauseRequests.add(taskId);
    // Immediately set abort signal so in-flight handleChat calls can interrupt
    const signal = taskAbortSignals.get(taskId);
    if (signal) {
      signal.aborted = true;
      console.log(`[Background Task] Pause requested for ${taskId} - abort signal set`);
    }
  }

  static isRunning(taskId: string): boolean { return activeRunners.has(taskId); }

  static forceRelease(taskId: string): void {
    if (activeRunners.has(taskId)) {
      console.warn(`[Background Task] Force-releasing stale activeRunners entry for task ${taskId}`);
      activeRunners.delete(taskId);
      pauseRequests.delete(taskId);
    }
    taskAbortSignals.delete(taskId);
  }

  static getRunningTasks(): string[] { return Array.from(activeRunners); }

  static interruptTaskForSchedule(taskId: string, scheduleId: string): boolean {
    if (!activeRunners.has(taskId)) return false;
    const task = loadTask(taskId);
    if (!task) return false;
    updateTaskStatus(taskId, 'paused', {
      pauseReason: 'interrupted_by_schedule',
      pausedByScheduleId: scheduleId,
      pausedAt: Date.now(),
      pausedAtStepIndex: task.currentStepIndex,
      shouldResumeAfterSchedule: true,
    });
    pauseRequests.add(taskId);
    console.log(`[Background Task] Task ${taskId} interrupted by schedule ${scheduleId}`);
    return true;
  }

  static resumeTaskAfterSchedule(taskId: string, scheduleId: string): boolean {
    const task = loadTask(taskId);
    if (!task) return false;
    if (task.pausedByScheduleId !== scheduleId) {
      console.warn(`[Background Task] Task ${taskId} not paused by schedule ${scheduleId}`);
      return false;
    }
    updateTaskStatus(taskId, 'running', {
      pauseReason: undefined,
      pausedByScheduleId: undefined,
      pausedAt: undefined,
      pausedAtStepIndex: undefined,
      shouldResumeAfterSchedule: false,
    });
    if (!activeRunners.has(taskId)) {
      console.log(`[Background Task] Resuming task ${taskId} after schedule ${scheduleId} completed`);
    }
    return true;
  }

  async start(): Promise<void> {
    const { taskId } = this;
    if (activeRunners.has(taskId)) {
      console.log(`[Background Task] Task ${taskId} already running - skipping duplicate start.`);
      return;
    }
    const task = loadTask(taskId);
    if (!task) { console.error(`[Background Task] Task ${taskId} not found.`); return; }
    if (task.status === 'complete' || task.status === 'failed') {
      console.log(`[Background Task] Task ${taskId} is already ${task.status} - nothing to do.`);
      return;
    }

    activeRunners.add(taskId);
    pauseRequests.delete(taskId);

    // ── Mandatory write_note step ─────────────────────────────────────────────
    // Every background task gets a final "Log completion" step appended at start.
    // This replaces the old synthesis round: the AI calls write_note inside this
    // step, its text response becomes lastResultSummary, and that is delivered
    // directly to the user. No second LLM call needed after all steps are done.
    //
    // Skip for: resuming mid-task, legacy child sub-agents (they don't deliver to user chat),
    // and tasks that already have the step (idempotent on restart).
    const isResuming = task.currentStepIndex > 0;
    const isLegacySubagent = !task.teamSubagent && (!!task.subagentProfile || !!task.parentTaskId);
    const alreadyHasWriteNoteStep = task.plan.some((s: any) => s.notes === 'write_note_completion');
    if (!isResuming && !isLegacySubagent && !alreadyHasWriteNoteStep && task.plan.length > 0) {
      mutatePlan(taskId, [{
        op: 'add',
        after_index: task.plan.length - 1,
        description:
          'Log completion: call write_note with a full summary of what was done in this task — ' +
          'what changed, what was created or modified, key results, and any important findings. ' +
          'Tag it "task_complete". Then write your final response to the user summarizing the outcome.',
        notes: 'write_note_completion',
      }]);
      appendJournal(taskId, { type: 'status_push', content: 'Appended mandatory write_note completion step.' });
    }

    // ── Legacy memory extraction (opt-in, kept for backward compat) ───────────
    const alreadyHasMemStep = task.plan.some((s: any) => s.notes === 'memory_extraction');
    const memExtractionEnabled = !!(task as any).enableMemoryExtraction;
    if (!isResuming && !isLegacySubagent && !alreadyHasMemStep && task.plan.length > 0 && memExtractionEnabled) {
      mutatePlan(taskId, [{
        op: 'add',
        after_index: task.plan.length - 1,
        description:
          'Memory extraction: review everything learned during this run and call write_note ' +
          'for each distinct fact about the user, their business, preferences, environment, ' +
          'tools, contacts, or recurring patterns. Write one write_note per fact — be specific ' +
          'and concrete. Skip facts already in USER.md.',
        notes: 'memory_extraction',
      }]);
    }

    const agentWs = (task as any).agentWorkspace as string | undefined;
    if (agentWs) console.log(`[Background Task] Workspace scoped to: ${agentWs} for task ${taskId}`);

    try {
      if (agentWs) {
        await runWithWorkspace(agentWs, () => this._run());
      } else {
        await this._run();
      }
    } finally {
      activeRunners.delete(taskId);
      pauseRequests.delete(taskId);
      taskAbortSignals.delete(taskId);
    }
  }

  private _buildCallerContext(task: TaskRecord): string {
    if (isProposalLikeSourceSessionId(task.sessionId || '')) {
      return [
        `PROPOSAL EXECUTION PROTOCOL:`,
        `- Execute only the approved proposal scope and task steps.`,
        `- Do NOT create a new proposal during this run.`,
        `- Execute each step directly with tools; after finishing a step, call step_complete(note: "what you did").`,
        `- Do NOT call declare_plan again.`,
        `- If blocked, state the blocker and best next action concisely.`,
      ].join('\n');
    }

    const teamSubagentNote = task.teamSubagent?.callerContext
      ? `\n${task.teamSubagent.callerContext}`
      : '';
    const profileNote = task.subagentProfile
      ? `\nSub-agent role: ${task.subagentProfile}. Stay focused on your assigned task only. Do NOT call delegate_to_specialist or subagent_spawn.`
      : '';
    const resumeNote = task.resumeContext?.onResumeInstruction
      ? `\n${task.resumeContext.onResumeInstruction}`
      : '';
    const isXTask = /\b(x\.com|twitter|tweet|retweet|post.*tweet|reply.*tweet)\b/i.test(task.prompt + ' ' + task.title);
    const xLoginGuidance = isXTask
      ? `\nX.COM LOGIN NOTE: If the browser page title shows "(N) Home / X", "Home / X", or any title ending in "/ X", ` +
        `the user IS already logged in to X — do NOT ask to confirm login or suggest they log in. ` +
        `Proceed directly with the task action.\n` +
        `X.COM POSTING FLOW: When posting a tweet, follow EXACTLY these steps:\n` +
        `  1. browser_open("https://x.com")\n` +
        `  2. Find the textbox with name "Post text" — browser_fill it.\n` +
        `  3. The fill result shows "COMPOSER SUBMIT BUTTON: @N" — browser_click(@N) immediately.\n` +
        `  4. After posting, call browser_close() then call step_complete. STOP.`
      : '';

    // Inline plan summary for context
    const planLines = task.plan.map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'running' ? '►' : s.status === 'skipped' ? '-' : ' ';
      const current = i === task.currentStepIndex ? ' ← CURRENT' : '';
      return `  [${icon}] Step ${i + 1}: ${s.description.slice(0, 120)}${current}`;
    }).join('\n');

    return [
      `[BACKGROUND TASK CONTEXT]`,
      `Task ID: ${task.id}`,
      `Task Title: ${task.title}`,
      `Original Request: ${task.prompt.slice(0, 400)}`,
      ``,
      `PLAN (${task.plan.length} steps):`,
      planLines,
      ``,
      `PROTOCOL:`,
      `- Execute steps in order. Use whatever tools each step requires.`,
      `- After completing ALL tool calls for a step, call step_complete(note: "what you did").`,
      `- Do NOT call declare_plan again — your plan is already set.`,
      `- The FINAL step in every plan is "Log completion". In that step you MUST call write_note`,
      `  (tag: "task_complete") with a full rundown of what was done, then write your summary`,
      `  response to the user as plain text. That text becomes the final message delivered to chat.`,
      `- If blocked, say what is blocking you and stop.`,
      `You are running autonomously.${teamSubagentNote}${profileNote}${resumeNote}${xLoginGuidance}`,
      `[/BACKGROUND TASK CONTEXT]`,
    ].filter(Boolean).join('\n');
  }

  private _restoreSessionForRetry(sessionId: string, resumeMessages: any[]): void {
    clearHistory(sessionId);
    for (const msg of resumeMessages) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
        addMessage(sessionId, {
          role: msg.role,
          content: String(msg.content || ''),
          timestamp: msg.timestamp || Date.now(),
        }, {
          disableMemoryFlushCheck: true,
          disableCompactionCheck: true,
          disableAutoSave: true,
          maxMessages: BACKGROUND_SESSION_MAX_MESSAGES,
        });
      }
    }
  }

  private _persistResumeContextSnapshot(taskId: string, sessionId: string): void {
    const task = loadTask(taskId);
    const existingRound = Number(task?.resumeContext?.round) || 0;
    const sessionHistory = getHistory(sessionId, 40);
    updateResumeContext(taskId, {
      messages: sessionHistory.slice(-MAX_RESUME_MESSAGES).map(h => ({
        role: h.role,
        content: h.content,
        timestamp: h.timestamp,
      })),
      round: existingRound,
    });
  }

  private async _withRoundTimeout<T>(
    op: Promise<T>,
    timeoutMs: number,
    abortSignal?: { aborted: boolean },
    // Optional callback to subscribe to activity pings that reset the inactivity clock.
    // Pass a function; it receives a "ping" callback the caller should invoke on each
    // tool_call SSE event. When present, timeoutMs becomes the INACTIVITY window
    // (time since last activity) rather than an absolute wall-clock limit.
    onRegisterPing?: (ping: () => void) => void,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;

    const scheduleTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (abortSignal) abortSignal.aborted = true;
        reject(new Error(`Round timeout (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);
      if (timeoutId && typeof (timeoutId as any).unref === 'function') (timeoutId as any).unref();
    };

    let reject!: (err: Error) => void;
    const timeoutPromise = new Promise<T>((_, rej) => { reject = rej; });

    // Register the ping so callers can reset the inactivity window on tool activity.
    if (onRegisterPing) onRegisterPing(() => scheduleTimeout());

    scheduleTimeout();
    try {
      return await Promise.race([op, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async _runRoundWithRetry(
    task: TaskRecord,
    prompt: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    abortSignal: { aborted: boolean },
    callerContextOverride?: string,
    modelOverride?: string,
    toolFilter?: string[],
    timeoutOverrideMs?: number,
    providerOverride?: string,
    executionModeOverride: 'background_task' | 'proposal_execution' | 'team_subagent' = 'background_task',
  ): Promise<
    | { ok: true; result: { type: string; text: string; thinking?: string } }
    | { ok: false; reason: string; detail: string }
  > {
    const MAX_TRANSPORT_RETRIES = 2;
    const RETRY_DELAY_MS = 4000;
    const isResearchTask = /\b(research|search|news|articles?|web.*search|browser|scroll|page|google)\b/i.test(task.prompt + ' ' + task.title);
    const roundTimeoutMs = timeoutOverrideMs ?? resolveRoundTimeoutMs(isResearchTask);
    const resumeMessages = Array.isArray(task.resumeContext?.messages)
      ? task.resumeContext.messages.slice(-MAX_RESUME_MESSAGES)
      : [];
    const callerContext = callerContextOverride ?? this._buildCallerContext(task);

    for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
      let attemptResult: { type: string; text: string; thinking?: string };
      // Pass the REFERENCE, not a snapshot, so pause requests update it live
      try {
        // Wire up inactivity-based timeout: the clock resets each time a tool_call
        // SSE fires, so the 120s budget is "120s since last tool activity" not
        // "120s since handleChat was called". This prevents slow-startup models
        // from burning the whole budget before their first tool fires.
        let pingInactivityTimeout: (() => void) | null = null;
        const wrappedSendSSE = (event: string, data: any) => {
          if (event === 'tool_call' && pingInactivityTimeout) pingInactivityTimeout();
          sendSSE(event, data);
        };
        attemptResult = await this._withRoundTimeout(
          this.handleChat(prompt, sessionId, wrappedSendSSE, undefined, abortSignal, callerContext, modelOverride, executionModeOverride, toolFilter, undefined, undefined, providerOverride),
          INACTIVITY_TIMEOUT_MS,
          abortSignal,
          (ping) => { pingInactivityTimeout = ping; },
        );
      } catch (retryErr: any) {
        const errMsg = String(retryErr?.message || retryErr || 'unknown');
        appendJournal(task.id, { type: 'error', content: `Attempt ${attempt + 1} threw: ${errMsg.slice(0, 200)}` });
        if (attempt < MAX_TRANSPORT_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          this._restoreSessionForRetry(sessionId, resumeMessages);
          continue;
        }
        return { ok: false, reason: `Task stopped after ${MAX_TRANSPORT_RETRIES + 1} failed attempts.`, detail: errMsg.slice(0, 600) };
      }

      const text = String(attemptResult.text || '');
      const isTransportError =
        text.startsWith('Error: Ollama') || text.startsWith('Error: fetch failed') ||
        text.startsWith('Error: provider') || text.includes('fetch failed');

      if (isTransportError) {
        const errSnippet = text.slice(0, 200);
        const retryStrategy = getRetryStrategy();
        if (!retryStrategy.getState(task.id)) {
          retryStrategy.createRetryState(task.id, { maxAttempts: MAX_TRANSPORT_RETRIES + 1, baseDelayMs: RETRY_DELAY_MS, maxDelayMs: 30000, jitter: true });
        }
        const retryResult = retryStrategy.recordAttempt(task.id);
        appendJournal(task.id, { type: 'error', content: `Transport error (attempt ${retryResult.attemptsUsed}/${MAX_TRANSPORT_RETRIES + 1}): ${errSnippet}` });
        if (retryResult.canRetry && attempt < MAX_TRANSPORT_RETRIES) {
          await new Promise(r => setTimeout(r, retryResult.delayMs || RETRY_DELAY_MS * (attempt + 1)));
          this._restoreSessionForRetry(sessionId, resumeMessages);
          continue;
        }
        retryStrategy.clearState(task.id);
        return { ok: false, reason: `Task paused after transport retries exhausted at step ${task.currentStepIndex + 1}.`, detail: errSnippet };
      }

      if (text.startsWith('Error:')) {
        appendJournal(task.id, { type: 'error', content: `Model returned error: ${text.slice(0, 200)}` });
        return { ok: false, reason: `Task paused — model returned an unrecoverable error at step ${task.currentStepIndex + 1}.`, detail: text.slice(0, 600) };
      }

      return { ok: true, result: attemptResult };
    }

    return { ok: false, reason: 'Task paused — no valid result produced.', detail: 'No result after retry loop.' };
  }

  private async _run(): Promise<void> {
    const { taskId } = this;

    updateTaskStatus(taskId, 'running');
    appendJournal(taskId, { type: 'resume', content: 'Runner started.' });

    const initialTask = loadTask(taskId);
    if (!initialTask) return;

    this._broadcast('task_running', { taskId, title: initialTask.title });

    // Always use task_<id> as the execution session ID.
    // task.sessionId (e.g. 'proposal_prop_...') is preserved for result delivery only.
    // Using task_ prefix is required so chat.router.ts step_complete/declare_plan handlers
    // can resolve the task record from the session ID.
    const sessionId = `task_${taskId}`;
    clearHistory(sessionId);

    // Proposal/code execution tasks need source write tools available from round 1.
    // Activate on the runtime task session and on the originating session for parity.
    const sourceSessionId = String(initialTask.sessionId || '');
    const isProposalLikeSourceSession =
      isProposalLikeSourceSessionId(sourceSessionId);
    if (isProposalLikeSourceSession) {
      try {
        activateToolCategory(sessionId, 'source_write');
        activateToolCategory(sourceSessionId, 'source_write');
      } catch {
        // Non-fatal: category activation failures should not block task execution.
      }
    }

    // Pre-warm browser session alias
    try {
      const { resolveSessionId } = await import('../browser-tools');
      resolveSessionId(sessionId);
    } catch { /* lazy */ }

    // Restore conversation context
    // Cap total restored chars to avoid context-overflow death loops where a prior
    // run's large read_source results make every retry exceed the 200k token limit.
    const MAX_RESUME_TOTAL_CHARS = 60_000;
    const rawResumeMessages = Array.isArray(initialTask.resumeContext?.messages)
      ? initialTask.resumeContext.messages.slice(-MAX_RESUME_MESSAGES)
      : [];
    let resumeTotalChars = 0;
    const initialMessages = rawResumeMessages.filter(m => {
      const chars = String(m?.content || '').length;
      if (resumeTotalChars + chars > MAX_RESUME_TOTAL_CHARS) return false;
      resumeTotalChars += chars;
      return true;
    });
    if (initialMessages.length > 0) {
      for (const msg of initialMessages) {
        if (msg && (msg.role === 'user' || msg.role === 'assistant')) {
          addMessage(sessionId, {
            role: msg.role,
            content: String(msg.content || ''),
            timestamp: msg.timestamp || Date.now(),
          }, {
            disableMemoryFlushCheck: true,
            disableCompactionCheck: true,
            disableAutoSave: true,
            maxMessages: BACKGROUND_SESSION_MAX_MESSAGES,
          });
        }
      }
      appendJournal(taskId, { type: 'resume', content: `Restored ${initialMessages.length}/${rawResumeMessages.length} message(s) (${resumeTotalChars} chars).` });
    }

    // ── Stall counter state ───────────────────────────────────────────────────
    // Tracks tool calls since the last step_complete. At threshold, inject nudge.
    let toolCallsSinceLastStepComplete = 0;
    let stallNudgeInjected = false;
    let buildFailureRetryCount = 0;  // NEW: Track build failures in current step
    let lastProgressSignature = '';

    const sendSSE = (event: string, data: any) => {
      if (event === 'tool_call') {
        this._broadcast('task_panel_update', { taskId });
        const toolName = String(data.action || '');
        if (toolName === 'step_complete' || toolName === 'declare_plan') {
          // handled by task_step_done below
        } else if (MUTATE_TOOLS.has(toolName)) {
          // Write/mutate tool fired — real progress, reset stall counter
          toolCallsSinceLastStepComplete = 0;
          stallNudgeInjected = false;
          buildFailureRetryCount = 0;  // NEW: Reset on real progress
        } else {
          toolCallsSinceLastStepComplete++;
        }
        appendJournal(taskId, {
          type: 'tool_call',
          content: `${data.action || 'unknown'}(${JSON.stringify(data.args || {}).slice(0, 80)})`,
        });
        this._broadcast('task_tool_call', { taskId, tool: data.action, args: data.args });
        const liveTask = loadTask(taskId);
        if (
          liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const tgMessage = formatTelegramToolCall({
            actor,
            toolName: String(data?.action || 'unknown_tool'),
            args: data?.args,
          });
          this.telegramChannel.sendMessage(liveTask.telegramChatId, tgMessage).catch(() => {});
        }
      } else if (event === 'task_step_done') {
        // step_complete was called — reset stall counter
        toolCallsSinceLastStepComplete = 0;
        stallNudgeInjected = false;
        appendJournal(taskId, { type: 'status_push', content: `Step complete signal received.` });
        this._broadcast('task_step_done', { taskId, ...data });
        this._broadcast('task_panel_update', { taskId });
        const liveTask = loadTask(taskId);
        if (
          liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const tgMessage = formatTelegramToolCall({
            actor,
            toolName: 'step_complete',
            args: { note: String(data?.note || '').trim() },
          });
          this.telegramChannel.sendMessage(liveTask.telegramChatId, tgMessage).catch(() => {});
        }
      } else if (event === 'tool_result') {
        appendJournal(taskId, {
          type: 'tool_result',
          content: `${data.action || 'unknown'}: ${String(data.result || '').slice(0, 120)}${data.error ? ' [ERROR]' : ''}`,
          detail: data.error ? String(data.result || '') : undefined,
        });
        // Proposal build failure guard — check both plumbing session and original task session
        const _isProposalTask = isProposalLikeSourceSessionId(sessionId) || (() => {
          if (!sessionId.startsWith('task_')) return false;
          try { const t = loadTask(sessionId.replace(/^task_/, '')); return isProposalLikeSourceSessionId(String(t?.sessionId || '')); } catch { return false; }
        })();
        if (data.error && _isProposalTask) {
          const action = String(data.action || '').toLowerCase();
          const result = String(data.result || '');
          const isBuildFailure =
            (action === 'run_command' && /npm\s+run\s+build|npm\s+run\s+tsc/.test(result) && /exit\s+[1-9]\d*|TIMED OUT/i.test(result)) ||
            (action === 'gateway_restart' && /build\s+failed|Build\s+FAILED/i.test(result));
          if (isBuildFailure) {
            buildFailureRetryCount++;
            const taskForStatusUpdate = loadTask(taskId);
            if (taskForStatusUpdate) {
              // First failure: log + let agent continue (self-healing attempt)
              if (buildFailureRetryCount === 1) {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed (attempt 1): ${result.slice(-200)}. Agent will attempt recovery.`,
                });
                // Do NOT pause — allow agent to self-heal
              } 
              // Second failure: show "recovering" status + continue
              else if (buildFailureRetryCount === 2) {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed again (attempt 2): ${result.slice(-200)}. Recovery in progress.`,
                });
                updateTaskStatus(taskId, 'running', { pauseReason: 'recovering_from_build_error' });
                this._broadcast('task_panel_update', { taskId });
                // Do NOT pause — agent gets one more chance
              } 
              // Third+ failure: genuinely stuck, pause for assistance
              else {
                appendJournal(taskId, {
                  type: 'error',
                  content: `Build failed ${buildFailureRetryCount} times. Pausing for assistance: ${result.slice(-500)}`,
                  detail: result.slice(-1500),
                });
                this._pauseForAssistance(taskForStatusUpdate, `Build failed ${buildFailureRetryCount} times — unable to auto-recover.`, result.slice(-1500));
                return; // Only return here to stop SSE processing on actual pause
              }
            }
          }
        }
      } else if (event === 'progress_state') {
        updateTaskRuntimeProgress(taskId, {
          source: data?.source,
          activeIndex: Number(data?.activeIndex ?? -1),
          items: Array.isArray(data?.items)
            ? data.items.map((item: any, idx: number) => ({
              id: String(item?.id || `p${idx + 1}`),
              text: String(item?.text || ''),
              status: String(item?.status || 'pending') as any,
            }))
            : [],
        });
        // declare_plan → real plan sync (first call only, at step 0, all-pending)
        if (data?.source === 'tool_sequence' && Array.isArray(data?.items) && data.items.length >= 2) {
          try {
            const liveTask = loadTask(taskId);
            if (liveTask) {
              const allPending = liveTask.plan.every((s: any) => s.status === 'pending');
              const isMoreGranular = data.items.length > liveTask.plan.length;
              const atStart = liveTask.currentStepIndex === 0;
              if (allPending && isMoreGranular && atStart) {
                const newPlan = data.items.map((item: any, i: number) => ({
                  index: i,
                  description: String(item?.text || `Step ${i + 1}`).slice(0, 300),
                  status: 'pending' as const,
                }));
                liveTask.plan = newPlan;
                saveTask(liveTask);
                appendJournal(taskId, { type: 'plan_mutation', content: `declare_plan seeded ${newPlan.length} steps.` });
              }
            }
          } catch { /* best-effort */ }
        }
        this._broadcast('task_panel_update', { taskId });
        const liveTask = loadTask(taskId);
        if (
          liveTask?.channel === 'telegram'
          && liveTask.telegramChatId
          && this.telegramChannel
          && typeof this.telegramChannel.sendMessage === 'function'
        ) {
          const actor = inferActorFromTask({
            managerEnabled: !!liveTask.managerEnabled,
            subagentProfile: liveTask.subagentProfile,
            title: liveTask.title,
            sessionId: liveTask.sessionId,
          });
          const progressMsg = formatTelegramProgressState({
            actor,
            items: Array.isArray(data?.items) ? data.items : [],
          });
          if (progressMsg) {
            const sig = `${data?.source || 'none'}|${JSON.stringify(data?.items || [])}`;
            if (sig !== lastProgressSignature) {
              lastProgressSignature = sig;
              this.telegramChannel.sendMessage(liveTask.telegramChatId, progressMsg).catch(() => {});
            }
          }
        }
      } else if (event === 'task_panel_update') {
        this._broadcast('task_panel_update', { taskId });
      }
    };

    const abortSignal = { aborted: false };
    taskAbortSignals.set(taskId, abortSignal);  // Store so requestPause can access it
    let lastResultSummary = '';
    let firstRound = true;

    while (true) {
      const task = loadTask(taskId);
      if (!task) return;
      if (task.status === 'complete' || task.status === 'failed') return;
      if (task.status === 'needs_assistance') return;
      if (task.status === 'awaiting_user_input') return;

      if (pauseRequests.has(taskId)) {
        const pauseReason = task.pauseReason || 'user_pause';
        const scheduleId = task.pausedByScheduleId;
        updateTaskStatus(taskId, 'paused', { pauseReason });
        const pauseMsg = pauseReason === 'interrupted_by_schedule' && scheduleId
          ? `Paused by scheduled task (schedule: ${scheduleId}). Will resume after schedule completes.`
          : 'Paused by user request.';
        appendJournal(taskId, { type: 'pause', content: pauseMsg });
        this._broadcast('task_paused', { taskId, reason: pauseReason, scheduleId });
        flushSession(sessionId);
        return;
      }

      if (task.status === 'waiting_subagent') {
        activeRunners.delete(taskId);
        appendJournal(taskId, { type: 'pause', content: 'Waiting for sub-agents to complete.' });
        flushSession(sessionId);
        return;
      }

      // ── All steps done → deliver lastResultSummary directly ───────────────
      // The synthesis round has been removed. The AI's response from the final
      // plan step (which always ends with a write_note call) IS the final output.
      // lastResultSummary captures the last text the AI returned, which is the
      // summary it wrote after completing write_note. Deliver it as-is.
      if (task.currentStepIndex >= task.plan.length) {
        const finalMsg = task.finalSummary
          || lastResultSummary
          || 'Task completed all planned steps.';
        updateTaskStatus(taskId, 'complete', { finalSummary: finalMsg });
        // If this task originated from an approved proposal session, mark the proposal executed.
        try {
          const sourceSessionId = String(task.sessionId || '');
          if (sourceSessionId.startsWith('proposal_')) {
            const proposalId = sourceSessionId.replace(/^proposal_/, '');
            if (proposalId) {
              const { markProposalExecuted } = await import('../proposals/proposal-store.js');
              markProposalExecuted(proposalId, finalMsg);
              this._broadcast('proposal_executed', { proposalId, taskId, sessionId: sourceSessionId });
            }
          }
        } catch (e: any) {
          console.warn(`[Background Task] Could not mark proposal executed for task ${taskId}:`, e?.message || e);
        }
        appendJournal(taskId, { type: 'status_push', content: 'Task complete.' });
        this._broadcast('task_complete', { taskId, summary: finalMsg });
        await this._deliverToChannel(task, finalMsg);
        this._persistResumeContextSnapshot(taskId, sessionId);
        flushSession(sessionId);
        return;
      }

      // ── Execute current step ──────────────────────────────────────────────
      updateTaskStatus(taskId, 'running');
      setTaskStepRunning(taskId, task.currentStepIndex);
      const liveTask = loadTask(taskId) || task;
      const currentStep = liveTask.plan[liveTask.currentStepIndex];

      // ── Stall nudge injection ─────────────────────────────────────────────
      // If the stall counter has fired and we haven't injected a nudge yet this
      // stall window, append a reminder message to the conversation.
      let stallNudgeMessage: string | null = null;
      if (toolCallsSinceLastStepComplete >= STALL_TOOL_CALL_THRESHOLD && !stallNudgeInjected) {
        stallNudgeInjected = true;
        const stepDesc = currentStep?.description || 'current step';
        stallNudgeMessage = [
          `[STALL DETECTED: ${toolCallsSinceLastStepComplete} tool calls with no step_complete]`,
          ``,
          `You are currently on: Step ${liveTask.currentStepIndex + 1}/${liveTask.plan.length} — "${stepDesc}"`,
          ``,
          `Either:`,
          `  A) Call step_complete(note: "what you did") if this step is actually done, then continue.`,
          `  B) Briefly describe what you're doing and why you haven't completed the step yet, then continue.`,
          ``,
          `Do NOT call declare_plan. Continue executing the current plan.`,
        ].join('\n');
        appendJournal(taskId, { type: 'status_push', content: `Stall detected: ${toolCallsSinceLastStepComplete} tool calls with no step_complete. Injecting nudge.` });
        this._broadcast('task_panel_update', { taskId });
      }

      const isWriteNoteStep = currentStep?.notes === 'write_note_completion';
      // Canonical completion detection uses durable write_note journal entries.
      const hasTaskCompleteWriteNoteAlready = isWriteNoteStep
        && Array.isArray(liveTask.journal)
        && liveTask.journal.some((entry: any) =>
          entry?.type === 'write_note'
          && /^\s*\[task_complete\]\b/i.test(String(entry?.content || ''))
        );
      const prompt = firstRound
        ? (this.openingAction
            ? `[Resuming task from heartbeat. Opening action: ${this.openingAction}]\n\n${task.prompt}`
            : task.prompt)
        : stallNudgeMessage
          ? stallNudgeMessage
          : isWriteNoteStep
            ? [
                `Continue task: ${liveTask.title}`,
                ``,
                `CURRENT STEP: ${liveTask.currentStepIndex + 1} of ${liveTask.plan.length} — FINAL STEP`,
                `STEP GOAL: ${currentStep?.description}`,
                ``,
                ...(hasTaskCompleteWriteNoteAlready
                  ? [
                      `A task_complete note is already logged. The task will complete automatically.`,
                      `Write your final plain-text summary response now — do NOT call write_note or step_complete again.`,
                    ]
                  : [
                      `This is the final step. Do the following IN ORDER:`,
                      `1. Call write_note with tag "task_complete" and a full summary of everything done:`,
                      `   what files changed, what was created/modified, key results, findings.`,
                      `   Calling write_note with tag "task_complete" will automatically complete the task.`,
                      `   Do NOT call step_complete after write_note.`,
                      `2. After write_note returns, write your final plain-text response to the user.`,
                      `   Make it clear and complete — this goes directly to chat.`,
                    ]),
              ].filter(Boolean).join('\n')
            : [
                `Continue task: ${liveTask.title}`,
                ``,
                `CURRENT STEP: ${liveTask.currentStepIndex + 1} of ${liveTask.plan.length}`,
                `STEP GOAL: ${currentStep?.description || 'No step description provided.'}`,
                ``,
                `Execute this step now. When you have finished ALL tool calls for this step, call step_complete(note: "brief summary").`,
                ``,
                `REMAINING STEPS:`,
                ...liveTask.plan.slice(liveTask.currentStepIndex + 1).map((s, i) =>
                  `  Step ${liveTask.currentStepIndex + 2 + i}: ${s.description}`
                ),
              ].filter(Boolean).join('\n');

      firstRound = false;

      // Parse task.executorProvider ("providerId/model") → per-round model + provider override.
      // Set at task creation time by dispatchApprovedProposal when proposal has a risk_tier.
      let taskModelOverride: string | undefined;
      let taskProviderOverride: string | undefined;
      if (liveTask.executorProvider) {
        const slashIdx = liveTask.executorProvider.indexOf('/');
        if (slashIdx > 0) {
          taskProviderOverride = liveTask.executorProvider.slice(0, slashIdx);
          taskModelOverride = liveTask.executorProvider.slice(slashIdx + 1);
        } else {
          taskModelOverride = liveTask.executorProvider;
        }
      }

      const roundOutcome = await this._runRoundWithRetry(
        liveTask,
        prompt,
        sessionId,
        sendSSE,
        abortSignal,
        undefined,
        taskModelOverride,
        buildSubagentToolFilter(task.subagentProfile),
        undefined,
        taskProviderOverride,
        task.teamSubagent ? 'team_subagent' : isProposalLikeSourceSession ? 'proposal_execution' : 'background_task',
      );

      if (!roundOutcome.ok) {
        await this._pauseForAssistance(task, roundOutcome.reason, roundOutcome.detail);
        return;
      }

      const result = roundOutcome.result;
      lastResultSummary = String(result.text || '').replace(/\s+/g, ' ').trim();

      // ── Clarification check ───────────────────────────────────────────────
      const freshTask = loadTask(taskId);
      const taskAfterRound = freshTask || liveTask;

      if (looksLikeClarificationQuestion(lastResultSummary)) {
        const question = extractClarificationQuestion(lastResultSummary);
        appendJournal(taskId, { type: 'status_push', content: `Task paused — agent asked a clarification question.` });
        await this._pauseForClarification(taskAfterRound, question);
        flushSession(sessionId);
        return;
      }

      // Persist session context
      const sessionHistory = getHistory(sessionId, 40);
      updateResumeContext(taskId, {
        messages: sessionHistory.slice(-MAX_RESUME_MESSAGES).map(h => ({
          role: h.role,
          content: h.content,
          timestamp: h.timestamp,
        })),
        round: (Number(task.resumeContext?.round) || 0) + 1,
      });
      flushSession(sessionId);

      if (pauseRequests.has(taskId)) {
        const t2 = loadTask(taskId);
        const pauseReason = t2?.pauseReason || 'user_pause';
        updateTaskStatus(taskId, 'paused', { pauseReason });
        appendJournal(taskId, { type: 'pause', content: 'Paused by user request.' });
        this._broadcast('task_paused', { taskId, reason: pauseReason });
        flushSession(sessionId);
        return;
      }

      // Check if handleChat hit its internal step cap
      const hitMaxSteps = /^hit max steps/i.test(lastResultSummary);
      if (hitMaxSteps) {
        appendJournal(taskId, { type: 'status_push', content: 'Round hit max tool steps — continuing.' });
        continue;
      }

      // Check if step_complete was called during this round (currentStepIndex advanced)
      const reloadedTask = loadTask(taskId);
      if (!reloadedTask) return;

      if (reloadedTask.currentStepIndex !== liveTask.currentStepIndex) {
        // Agent called step_complete and step advanced — log it and continue
        appendJournal(taskId, {
          type: 'status_push',
          content: `Step advanced from ${liveTask.currentStepIndex + 1} to ${reloadedTask.currentStepIndex + 1} via step_complete.`,
        });
        toolCallsSinceLastStepComplete = 0;
        stallNudgeInjected = false;
        buildFailureRetryCount = 0;  // NEW: Reset for new step
        this._broadcast('task_step_done', {
          taskId,
          completedStep: liveTask.currentStepIndex,
          nextStep: reloadedTask.currentStepIndex,
        });
        // Continue loop — the top of loop will check if all steps are done
        continue;
      }

      // Step did NOT advance. The agent either:
      // 1. Is still working on the step (stall counter running), or
      // 2. Said something meaningful but didn't call step_complete.
      // Final-step safeguard: if this is write_note_completion and a canonical
      // [task_complete] write_note journal entry exists, auto-complete deterministically.
      const stepAfterRound = reloadedTask.plan[reloadedTask.currentStepIndex];
      const isWriteNoteCompletionStep = stepAfterRound?.notes === 'write_note_completion';
      if (isWriteNoteCompletionStep) {
        const hasTaskCompleteWriteNote = Array.isArray(reloadedTask.journal)
          && reloadedTask.journal.some((entry: any) =>
            entry?.type === 'write_note'
            && /^\s*\[task_complete\]\b/i.test(String(entry?.content || ''))
          );

        if (hasTaskCompleteWriteNote) {
          const completedStepIndex = reloadedTask.currentStepIndex;
          mutatePlan(taskId, [{
            op: 'complete',
            step_index: completedStepIndex,
            notes: 'auto-complete: task_complete already logged',
          }]);

          const postMutationTask = loadTask(taskId);
          if (postMutationTask && postMutationTask.currentStepIndex === completedStepIndex) {
            postMutationTask.currentStepIndex = Math.min(completedStepIndex + 1, postMutationTask.plan.length);
            postMutationTask.lastProgressAt = Date.now();
            saveTask(postMutationTask);
          }

          appendJournal(taskId, {
            type: 'status_push',
            content: `Auto-advanced final step ${completedStepIndex + 1}: task_complete note already logged.`,
          });
          toolCallsSinceLastStepComplete = 0;
          stallNudgeInjected = false;
          this._broadcast('task_step_done', {
            taskId,
            completedStep: completedStepIndex,
            nextStep: completedStepIndex + 1,
          });
          continue;
        }
      }

      // Otherwise, continue the loop and let the model keep working this step.
      continue;
    }
  }

  private async _pauseForClarification(task: TaskRecord, question: string): Promise<void> {
    if (task.teamSubagent?.teamId && task.teamSubagent?.agentId) {
      try {
        const { appendTeamChat, queueManagerMessage } = await import('../teams/managed-teams.js');
        queueManagerMessage(task.teamSubagent.teamId, task.teamSubagent.agentId, question);
        appendTeamChat(task.teamSubagent.teamId, {
          from: 'subagent',
          fromName: task.teamSubagent.agentName || task.teamSubagent.agentId,
          fromAgentId: task.teamSubagent.agentId,
          content: `Question for manager: ${question}`,
        });
      } catch (e) {
        console.warn('[TeamSubagent] Could not route clarification to manager:', e);
      }
    }
    const freshTask = loadTask(task.id);
    if (freshTask) {
      freshTask.pendingClarificationQuestion = question;
      freshTask.status = 'awaiting_user_input';
      freshTask.pauseReason = 'awaiting_user_input';
      freshTask.lastProgressAt = Date.now();
      saveTask(freshTask);
    }
    appendJournal(task.id, { type: 'pause', content: `Task paused — waiting for clarification: ${question.slice(0, 200)}` });
    this._broadcast('task_awaiting_input', { taskId: task.id, question });
    this._broadcast('task_paused', { taskId: task.id, reason: 'awaiting_user_input' });
    await this._deliverToChannel(freshTask || task, question);
    if (this.telegramChannel && task.channel !== 'telegram') {
      try { await this.telegramChannel.sendToAllowed(question); } catch {}
    }
  }

  private async _pauseForAssistance(task: TaskRecord, reason: string, detail?: string): Promise<void> {
    updateTaskStatus(task.id, 'needs_assistance', { pauseReason: 'error' });
    appendJournal(task.id, {
      type: 'pause',
      content: `Task paused for assistance: ${reason.slice(0, 220)}`,
      detail: detail ? detail.slice(0, 1200) : undefined,
    });

    const fullErrorMsg = detail ? `${reason}\n${detail}` : reason;
    const categorization = errorCategorizer.categorizeError(fullErrorMsg);

    try {
      const analyzer = getErrorAnalyzer();
      const history = getErrorHistory();
      if (categorization.category !== 'unknown') analyzer.recordError(fullErrorMsg, categorization.category);
      history.add({ taskId: task.id, errorMessage: reason.substring(0, 200), category: categorization.category, resolved: false });
    } catch {}

    if (categorization.confidence > 0.7 && categorization.template) {
      this._broadcast('task_error_requires_response', {
        taskId: task.id,
        errorCategory: categorization.category,
        errorMessage: reason,
        errorDetail: detail || '',
        template: categorization.template,
      });
    }

    this._broadcast('task_paused', { taskId: task.id, reason: 'needs_assistance' });
    this._broadcast('task_needs_assistance', { taskId: task.id, title: task.title, reason, detail: detail || '' });

    const message = [
      `Task paused and needs input: ${task.title}`,
      `Reason: ${reason}`,
      detail ? `Details: ${detail}` : '',
      `Reply in this chat with any adjustment or confirmation, and I will resume the task.`,
      `Task ID: ${task.id}`,
    ].filter(Boolean).join('\n');

    await this._deliverToChannel(task, message);
    if (this.telegramChannel && task.channel !== 'telegram') {
      try { await this.telegramChannel.sendToAllowed(message); } catch {}
    }
  }

  private _broadcast(event: string, data: object): void {
    try { this.broadcast({ type: event, ...data }); } catch {}
  }

  private async _deliverToChannel(task: TaskRecord, message: string, opts?: { forceTelegram?: boolean }): Promise<void> {
    // Sub-agent path: notify parent instead of user chat
    if (task.parentTaskId) {
      try {
        const { parentTask, allChildrenDone } = resolveSubagentCompletion(task.id, message);
        if (parentTask && allChildrenDone) {
          this._broadcast('task_step_followup_needed', { taskId: parentTask.id, delayMs: 2000 });
        }
      } catch (e) {
        console.warn('[SubAgent] resolveSubagentCompletion error:', e);
      }
      return;
    }

    // run_once_task path: verification + delivery to originating session
    if (task.taskKind === 'run_once' && task.originatingSessionId) {
      try {
        await this._verifyAndDeliverRunOnce(task, message);
        // Re-load task to get the updated finalSummary from verification
        const updatedTask = loadTask(task.id);
        const finalMsg = updatedTask?.finalSummary || message;
        this._broadcast('task_notification', {
          taskId: task.id,
          sessionId: task.originatingSessionId,
          channel: task.channel,
          message: finalMsg
        });
      } catch (e) {
        console.warn('[BTR] run_once verification/delivery error:', e);
        // Fallback: deliver unverified to originating session
        try {
          addMessage(task.originatingSessionId, {
            role: 'assistant',
            content: message,
            timestamp: Date.now()
          } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
        } catch {}
        this._broadcast('task_notification', {
          taskId: task.id,
          sessionId: task.originatingSessionId,
          channel: task.channel,
          message
        });
      }
      return;
    }

    // Normal task path (scheduled, background_spawn spawned, subagent, etc.)
    try {
      addMessage(task.sessionId, { role: 'user', content: `[BACKGROUND_TASK_RESULT task_id=${task.id}]`, timestamp: Date.now() - 1 });
      addMessage(task.sessionId, { role: 'assistant', content: message, timestamp: Date.now() });
    } catch (e) {
      console.warn('[BTR] Delivery failed (addMessage):', e);
    }

    // Skip Telegram delivery for run_once tasks — only web delivery
    if (!task.taskKind?.startsWith('run_once') && ((opts?.forceTelegram || task.channel === 'telegram') && this.telegramChannel)) {
      try {
        if (task.telegramChatId && typeof this.telegramChannel.sendMessage === 'function') {
          await this.telegramChannel.sendMessage(task.telegramChatId, message);
        } else {
          await this.telegramChannel.sendToAllowed(message);
        }
      } catch (e) {
        console.warn('[BTR] Delivery failed (telegram):', e);
      }
    }

    this._broadcast('task_notification', { taskId: task.id, sessionId: task.sessionId, channel: task.channel, message });
  }

  private async _verifyAndDeliverRunOnce(task: TaskRecord, taskResult: string): Promise<void> {
    const noOp = () => {};
    const { modelOverride, providerOverride } = this._resolveRunOnceModel();

    // Collect evidence notes
    const bus = loadEvidenceBus(task.id);
    const notes = (bus?.entries || [])
      .filter((e: any) => e.category === 'finding' || e.category === 'artifact')
      .map((e: any) => `• ${String(e.value || '').slice(0, 300)}`)
      .join('\n');

    // Build and run verification prompt
    const verifyPrompt = this._buildVerifyPrompt(task.title, taskResult, notes);
    const verifySessionId = `run_once_verify_${task.id}_${Date.now()}`;

    let verificationText = taskResult;
    try {
      const verifyResult = await this.handleChat(
        verifyPrompt, verifySessionId, noOp,
        undefined, undefined, undefined,
        modelOverride || undefined, 'background_task',
        undefined, undefined, undefined, providerOverride || undefined,
      );
      verificationText = (verifyResult?.text || '').trim() || taskResult;
    } catch (err: any) {
      console.warn(`[RunOnce] Verification error for task ${task.id}:`, err?.message);
    } finally {
      try { clearHistory(verifySessionId); } catch {}
    }

    // Update task with verification status + final result
    task.verificationStatus = 'complete';
    task.finalSummary = verificationText;
    saveTask(task);

    // Deliver verified result to originating session
    if (task.originatingSessionId) {
      try {
        addMessage(task.originatingSessionId, {
          role: 'assistant',
          content: verificationText,
          timestamp: Date.now(),
        } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
      } catch (e) {
        console.warn('[RunOnce] addMessage to originating session failed:', e);
      }
    }

    console.log(`[RunOnce] Task "${task.title}" (${task.id}) verified and delivered to session ${task.originatingSessionId}`);
  }

  private _resolveRunOnceModel(): { modelOverride?: string; providerOverride?: string } {
    try {
      const cfg = getConfig().getConfig() as any;
      const ref = String(cfg?.agent_model_defaults?.background_task || '').trim();
      if (!ref) return {};
      const slash = ref.indexOf('/');
      if (slash > 0) return { providerOverride: ref.slice(0, slash), modelOverride: ref.slice(slash + 1) };
      return { modelOverride: ref };
    } catch {
      return {};
    }
  }

  private _buildVerifyPrompt(title: string, taskResult: string, notes: string): string {
    const lines = [
      `A task you executed has completed. Please review the results, verify the work was done correctly, and provide a clear summary.`,
      '',
      `**Task:** ${title}`,
      '',
      '**Results from execution:**',
      taskResult || '*(no output)*',
    ];
    if (notes) lines.push('', '**Evidence collected during execution:**', notes);
    lines.push(
      '',
      'Please:',
      '1. Confirm the task was completed successfully (or identify any issues)',
      '2. Highlight the key outcomes',
      '3. Note anything that needs follow-up',
      '',
      'Keep your response concise and actionable.',
    );
    return lines.join('\n');
  }
}

// ─── run_task_now: one-off background task with automatic verification ───────
// Creates a task with proper plan, runs through BackgroundTaskRunner,
// automatically verifies on completion, and delivers to originating session.

export interface RunOnceOpts {
  title: string;
  prompt: string;
  subagentId?: string;
  timeoutMs?: number;
  originatingSessionId: string;
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: any,
    abortSignal?: any,
    callerContext?: string,
    modelOverride?: string,
    executionMode?: string,
    toolFilter?: string[],
    attachments?: any,
    reasoningOptions?: any,
    providerOverride?: string,
  ) => Promise<{ text: string; [k: string]: any }>;
  broadcastWS: (data: object) => void;
}

/**
 * Spawn a one-off background task that runs with full plan/step tracking,
 * then automatically verifies the result and delivers to the originating session.
 * Returns immediately with task_id — execution is fully detached.
 */
export function runOnceTask(opts: RunOnceOpts): { task_id: string } {
  const task = createTask({
    title: opts.title,
    prompt: opts.prompt,
    sessionId: `run_once_${opts.originatingSessionId}_${Date.now()}`, // Isolated session for task execution
    channel: 'web',
    plan: [
      { index: 0, description: opts.prompt.slice(0, 200), status: 'pending' }
    ],
    taskKind: 'run_once',
    originatingSessionId: opts.originatingSessionId,
  });

  saveTask(task);

  // Spawn the BackgroundTaskRunner in background
  setImmediate(() => {
    try {
      const runner = new BackgroundTaskRunner(
        task.id,
        opts.handleChat as any,  // Cast to match BackgroundTaskRunner's strict signature
        opts.broadcastWS,
        null  // No telegram channel for web-based run_once tasks
      );
      runner.start().catch((err: any) => {
        console.error(`[RunOnce] BackgroundTaskRunner error for task ${task.id}:`, err?.message || err);
      });
    } catch (err: any) {
      console.error(`[RunOnce] Failed to spawn runner for task ${task.id}:`, err?.message || err);
    }
  });

  return { task_id: task.id };
}
