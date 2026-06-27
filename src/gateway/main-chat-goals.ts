import { randomUUID } from 'crypto';
import { getConfig } from '../config/config';
import { getOllamaClient } from '../agents/ollama-client';
import {
  archiveMainChatGoal,
  getMainChatGoal,
  getRecentToolObservationsForContext,
  getSession,
  listMainChatGoalRecords,
  setMainChatGoal,
  updateMainChatGoal,
  type ChatMessage,
  type MainChatGoalState,
} from './session';

export interface MainChatGoalPolicy {
  enabled: boolean;
  autoResumeOnRestart: boolean;
  summaryEveryTurns: number;
  summaryMaxWords: number;
  judgeModel: string;
  compactionModel: string;
  maxConsecutiveJudgeFailures: number;
  maxConsecutiveRuntimeFailures: number;
  permissions: {
    approvalMode: 'normal' | 'never';
    hardDenyEnabled: boolean;
    recordDeniedActions: boolean;
  };
}

export interface MainChatGoalJudgeResult {
  status: 'done' | 'continue' | 'blocked';
  reason: string;
  /** Concrete instruction for the next autonomous worker turn. Empty only when the goal is done. */
  directive: string;
  confidence: number;
  parseFailed: boolean;
}

export interface MainChatGoalCommandResult {
  handled: boolean;
  message: string;
  shouldStartRunner: boolean;
  goal: MainChatGoalState | null;
}

const CONTINUATION_HEADER = '[Continuing toward active main-chat goal]';

export function resolveMainChatGoalPolicy(): MainChatGoalPolicy {
  const cfg = (getConfig().getConfig() as any)?.session?.mainChatGoals || {};
  const summaryEveryTurnsRaw = Number(cfg.summaryEveryTurns);
  const summaryMaxWordsRaw = Number(cfg.summaryMaxWords);
  const maxJudgeRaw = Number(cfg.maxConsecutiveJudgeFailures);
  const maxRuntimeRaw = Number(cfg.maxConsecutiveRuntimeFailures);
  return {
    enabled: cfg.enabled !== false,
    autoResumeOnRestart: cfg.autoResumeOnRestart !== false,
    summaryEveryTurns: Number.isFinite(summaryEveryTurnsRaw) ? Math.max(1, Math.min(50, Math.floor(summaryEveryTurnsRaw))) : 5,
    summaryMaxWords: Number.isFinite(summaryMaxWordsRaw) ? Math.max(120, Math.min(1200, Math.floor(summaryMaxWordsRaw))) : 450,
    judgeModel: String(cfg.judgeModel || '').trim(),
    compactionModel: String(cfg.compactionModel || '').trim(),
    maxConsecutiveJudgeFailures: Number.isFinite(maxJudgeRaw) ? Math.max(1, Math.min(20, Math.floor(maxJudgeRaw))) : 3,
    maxConsecutiveRuntimeFailures: Number.isFinite(maxRuntimeRaw) ? Math.max(1, Math.min(20, Math.floor(maxRuntimeRaw))) : 3,
    permissions: {
      approvalMode: cfg?.permissions?.approvalMode === 'normal' ? 'normal' : 'never',
      hardDenyEnabled: cfg?.permissions?.hardDenyEnabled !== false,
      recordDeniedActions: cfg?.permissions?.recordDeniedActions !== false,
    },
  };
}

export function isMainChatGoalContinuation(message: string): boolean {
  return String(message || '').trim().startsWith(CONTINUATION_HEADER);
}

function nowGoal(sessionId: string, goal: string): MainChatGoalState {
  const now = Date.now();
  return {
    id: `main_goal_${now}_${randomUUID().slice(0, 8)}`,
    sessionId,
    goal,
    status: 'active',
    turnsUsed: 0,
    goalSummaryTurn: 0,
    createdAt: now,
    updatedAt: now,
    consecutiveJudgeFailures: 0,
    consecutiveRuntimeFailures: 0,
  };
}

function cloneGoal(goal: MainChatGoalState): MainChatGoalState {
  return JSON.parse(JSON.stringify(goal));
}

function formatDeniedActions(goal: MainChatGoalState, max = 8): string {
  const denied = Array.isArray(goal.deniedActions) ? goal.deniedActions.slice(-max) : [];
  if (!denied.length) return '(none)';
  return denied.map((item, index) => {
    const at = Number.isFinite(Number(item.at)) ? new Date(Number(item.at)).toISOString() : 'unknown-time';
    return [
      `${index + 1}. [${at}] ${item.toolName || 'tool'} blocked`,
      `Category: ${item.category || 'hard_denied_action'}`,
      `Why: ${item.reason || 'Policy denied this action.'}`,
      `Safe alternative: ${item.safeAlternative || 'Continue with a safer workspace-scoped approach.'}`,
    ].join(' | ');
  }).join('\n');
}

function oneLine(text: string, max = 220): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function statusLine(goal: MainChatGoalState | null): string {
  if (!goal) return 'No active main-chat goal. Set one with /goal <objective>.';
  const bits = [
    `Goal: ${goal.goal}`,
    `Status: ${goal.status}`,
    `Turns: ${goal.turnsUsed}`,
  ];
  if (goal.lastReason) bits.push(`Last reason: ${goal.lastReason}`);
  if (goal.blockedReason) bits.push(`Blocked: ${goal.blockedReason}`);
  if (goal.pausedReason) bits.push(`Paused: ${goal.pausedReason}`);
  if (goal.failureReason) bits.push(`Failure: ${goal.failureReason}`);
  if (goal.progressSummary) bits.push(`Progress summary: ${oneLine(goal.progressSummary, 500)}`);
  return bits.join('\n');
}

export function handleMainChatGoalCommand(sessionId: string, message: string): MainChatGoalCommandResult {
  const policy = resolveMainChatGoalPolicy();
  const raw = String(message || '').trim();
  if (!/^\/goal(?:\s|$)/i.test(raw)) {
    return { handled: false, message: '', shouldStartRunner: false, goal: getMainChatGoal(sessionId) };
  }
  if (!policy.enabled) {
    return { handled: true, message: 'Main-chat goals are disabled in config.', shouldStartRunner: false, goal: getMainChatGoal(sessionId) };
  }

  const arg = raw.replace(/^\/goal\b/i, '').trim();
  const sub = arg.split(/\s+/)[0]?.toLowerCase() || 'status';
  const current = getMainChatGoal(sessionId);

  if (!arg || sub === 'status') {
    return { handled: true, message: statusLine(current), shouldStartRunner: current?.status === 'active', goal: current };
  }

  if (sub === 'pause') {
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      return { ...goal, status: 'paused', pausedReason: 'user-paused', updatedAt: Date.now() };
    });
    return { handled: true, message: next ? statusLine(next) : 'No main-chat goal to pause.', shouldStartRunner: false, goal: next };
  }

  if (sub === 'resume') {
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      return {
        ...goal,
        status: 'active',
        pausedReason: undefined,
        blockedReason: undefined,
        failureReason: undefined,
        consecutiveRuntimeFailures: 0,
        updatedAt: Date.now(),
      };
    });
    return { handled: true, message: next ? `Resumed main-chat goal.\n${statusLine(next)}` : 'No main-chat goal to resume.', shouldStartRunner: !!next, goal: next };
  }

  if (sub === 'clear') {
    if (current) archiveMainChatGoal(sessionId, { ...current, status: 'cleared', updatedAt: Date.now() });
    setMainChatGoal(sessionId, null);
    return { handled: true, message: 'Cleared the main-chat goal.', shouldStartRunner: false, goal: null };
  }

  if (sub === 'done') {
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      const now = Date.now();
      return { ...goal, status: 'done', lastVerdict: 'done', lastReason: 'Marked done by user.', completedAt: now, updatedAt: now };
    });
    return { handled: true, message: next ? `Marked main-chat goal done.\n${statusLine(next)}` : 'No main-chat goal to mark done.', shouldStartRunner: false, goal: next };
  }

  if (sub === 'revise') {
    const revised = arg.replace(/^revise\b/i, '').trim();
    if (!revised) return { handled: true, message: 'Usage: /goal revise <new objective>', shouldStartRunner: false, goal: current };
    const next = updateMainChatGoal(sessionId, (goal) => {
      const base = goal || nowGoal(sessionId, revised);
      return { ...base, goal: revised, status: 'active', updatedAt: Date.now() };
    });
    return { handled: true, message: next ? `Revised and resumed main-chat goal.\n${statusLine(next)}` : 'Could not revise goal.', shouldStartRunner: !!next, goal: next };
  }

  if (current) archiveMainChatGoal(sessionId, current);
  const next = setMainChatGoal(sessionId, nowGoal(sessionId, arg));
  return {
    handled: true,
    message: next
      ? `Started main-chat goal mode.\n${statusLine(next)}\n\nPrometheus will keep working until the goal is done, blocked, paused, cleared, or stopped.`
      : 'Could not start main-chat goal mode.',
    shouldStartRunner: !!next,
    goal: next,
  };
}

function extractJsonObject(raw: string): any | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const unfenced = text.startsWith('```')
    ? text.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim()
    : text;
  try {
    return JSON.parse(unfenced);
  } catch {}
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function stripThink(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function compactTextBlock(text: string, max = 1800): string {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function buildGoalJudgeSessionContext(goal: MainChatGoalState): string {
  const session = getSession(goal.sessionId);
  const history = Array.isArray(session.history) ? session.history : [];
  if (!history.length) return '(none)';

  const createdAt = Number(goal.createdAt || 0);
  const beforeGoal = history
    .filter((msg) => !createdAt || Number(msg.timestamp || 0) <= createdAt)
    .slice(-10);
  const sinceGoal = history
    .filter((msg) => createdAt && Number(msg.timestamp || 0) > createdAt)
    .slice(-18);

  const seen = new Set<string>();
  const selected: ChatMessage[] = [];
  for (const msg of [...beforeGoal, ...sinceGoal]) {
    const key = `${msg.role}:${msg.timestamp}:${String(msg.content || '').slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(msg);
  }

  return formatGoalMessages(selected).slice(0, 9000) || '(none)';
}

function normalizeJudgeDirective(parsed: any, status: MainChatGoalJudgeResult['status'], reason: string): string {
  const raw = parsed?.directive ?? parsed?.next_step_directive ?? parsed?.nextStepDirective ?? parsed?.next_step ?? '';
  const directive = compactTextBlock(String(raw || ''), 1200);
  if (status === 'done') return '';
  if (directive) return directive;
  if (status === 'blocked') return `Stop and surface the blocker clearly: ${reason}`;
  return `Continue the goal by addressing what remains incomplete: ${reason}`;
}

export async function judgeMainChatGoal(goal: MainChatGoalState, lastResponse: string): Promise<MainChatGoalJudgeResult> {
  const response = String(lastResponse || '').trim();
  if (!response) {
    return {
      status: 'continue',
      reason: 'No assistant response to evaluate yet.',
      directive: 'Run the next concrete worker turn for the goal and produce observable progress.',
      confidence: 0,
      parseFailed: false,
    };
  }
  const policy = resolveMainChatGoalPolicy();
  const sessionContext = buildGoalJudgeSessionContext(goal);
  const toolLog = getRecentToolObservationsForContext(goal.sessionId, 18, 8000);
  const prompt = [
    'Evaluate whether the assistant has satisfied the active main-chat goal.',
    'You are an isolated judge using the main model path, but you do not receive the normal soul/memory/persona prompt.',
    'Return exactly one JSON object with keys: status, reason, directive, confidence.',
    'status must be one of: done, continue, blocked.',
    'Use done only when the actual requested outcome is complete and backed by evidence in the chat, tool observations, or assistant response.',
    'STRONG DONE SIGNALS — any of these in the tool observations is sufficient evidence of completion for source/file/build goals:',
    '  - apply_dev_source_patchset with status "ok" or "applied"',
    '  - find_replace_source / write_source / write_webui_source with status "ok"',
    '  - prom_apply_dev_changes with a result mentioning "succeeded" or "apply_live"',
    '  - write_note with a result or args mentioning "dev_edit_complete" tag',
    '  - A final assistant response that enumerates specific numbered changes that were shipped (e.g. "1. ws.js: replaced X with Y", "2. mobile-api.js: added cache")',
    'For coding/build goals, done is satisfied when tool observations show successful file writes or source edits AND either a build/verify result or a final assistant summary enumerating what was shipped. Do NOT demand a separate explicit verification step if prom_apply_dev_changes, apply_dev_source_patchset, or find_replace_source results already confirm success in the tool observations.',
    'Use blocked only when work cannot continue without user input, credentials, approval, an unavailable external system, or a hard policy/tool constraint.',
    'Use continue for genuinely partial progress where implementation work remains — not for turns where file edits succeeded but the summary reads like natural language. A detailed enumerated summary of shipped changes IS completion evidence, not a "vague claim".',
    'The directive field is the instruction that will be given to the next worker turn. Make it concrete, imperative, and focused on the next missing work. Do not ask the user unless status is blocked.',
    '',
    '[GOAL]',
    goal.goal.slice(0, 3000),
    '',
    '[CURRENT_PROGRESS_SUMMARY]',
    String(goal.progressSummary || '(none)').slice(0, 3000),
    '',
    '[LAST_JUDGE_REASON]',
    String(goal.lastReason || '(none)').slice(0, 1200),
    '',
    '[LAST_JUDGE_DIRECTIVE]',
    String(goal.nextStepDirective || '(none)').slice(0, 1200),
    '',
    '[RELEVANT_CHAT_CONTEXT]',
    sessionContext,
    '',
    '[RECENT_TOOL_OBSERVATIONS]',
    toolLog || '(none)',
    '',
    '[DENIED_ACTIONS]',
    formatDeniedActions(goal, 8).slice(0, 2500),
    '',
    '[LATEST_ASSISTANT_RESPONSE]',
    response.slice(0, 6000),
  ].join('\n');

  try {
    const result = await getOllamaClient().chatWithThinking(
      [
        { role: 'system', content: 'You are GoalJudge. Return strict JSON only. No markdown, no prose outside JSON.' },
        { role: 'user', content: prompt },
      ],
      'manager',
      {
        temperature: 0,
        num_ctx: 16384,
        num_predict: 700,
        ...(policy.judgeModel ? { model: policy.judgeModel } : {}),
        usageContext: { sessionId: goal.sessionId, agentId: 'main_chat_goal_judge' },
      },
    );
    const raw = stripThink(String(result?.message?.content || ''));
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {
        status: 'continue',
        reason: `Judge returned unparseable output: ${oneLine(raw || '(empty)', 180)}`,
        directive: 'Continue with the next concrete step toward the goal, then verify the result with tools before claiming completion.',
        confidence: 0,
        parseFailed: true,
      };
    }
    const statusRaw = String(parsed.status || '').trim().toLowerCase();
    const status = statusRaw === 'done' || statusRaw === 'blocked' ? statusRaw : 'continue';
    const reason = oneLine(String(parsed.reason || 'No reason provided.'), 700);
    const directive = normalizeJudgeDirective(parsed, status, reason);
    const confidenceNum = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0.5;
    return { status, reason, directive, confidence, parseFailed: false };
  } catch (err: any) {
    const reason = `Judge error: ${err?.message || String(err)}`;
    return {
      status: 'continue',
      reason,
      directive: 'The judge errored. Continue with the next concrete step toward the goal and gather clear evidence for the next evaluation.',
      confidence: 0,
      parseFailed: false,
    };
  }
}

function formatGoalMessages(messages: ChatMessage[]): string {
  return messages.map((msg, idx) => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const stamp = Number.isFinite(Number(msg.timestamp)) ? new Date(Number(msg.timestamp)).toISOString() : 'unknown-time';
    const body = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 900);
    return `${idx + 1}. [${role}] (${stamp}) ${body}`;
  }).join('\n');
}

function buildFallbackGoalSummary(goal: MainChatGoalState, messages: ChatMessage[]): string {
  const latestAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant');
  return [
    `Goal: ${goal.goal}`,
    goal.progressSummary ? `Previous progress: ${oneLine(goal.progressSummary, 900)}` : '',
    latestAssistant ? `Latest work: ${oneLine(latestAssistant.content, 700)}` : '',
    goal.lastReason ? `Still incomplete because: ${goal.lastReason}` : 'Still incomplete because: the goal judge has not marked it done.',
    goal.nextStepDirective ? `Next best step: ${oneLine(goal.nextStepDirective, 700)}` : 'Next best step: continue from the latest work without restarting completed steps.',
  ].filter(Boolean).join('\n');
}

export async function maybeSummarizeMainChatGoal(sessionId: string): Promise<MainChatGoalState | null> {
  const policy = resolveMainChatGoalPolicy();
  const current = getMainChatGoal(sessionId);
  if (!current || current.status !== 'active') return current;
  if (current.turnsUsed <= 0 || current.turnsUsed - current.goalSummaryTurn < policy.summaryEveryTurns) return current;

  const session = getSession(sessionId);
  const start = Number.isFinite(Number(current.lastSummaryMessageIndex))
    ? Math.max(0, Math.floor(Number(current.lastSummaryMessageIndex)))
    : 0;
  const recentMessages = (session.history || []).slice(start).slice(-Math.max(10, policy.summaryEveryTurns * 2 + 4));
  const toolLog = getRecentToolObservationsForContext(sessionId, Math.max(3, policy.summaryEveryTurns), 2500);
  const prompt = [
    'Create an active-goal progress ledger for a nonstop main-chat goal loop.',
    `Target length: <= ${policy.summaryMaxWords} words.`,
    'Cross-examine completed work against the actual goal.',
    'Be concrete. Mention files, tools, artifacts, decisions, blockers, and remaining work when known.',
    'Do not say the goal is complete unless the evidence clearly supports it.',
    'Use this exact structure:',
    'Goal:',
    'Completed so far:',
    'Evidence/artifacts:',
    'Still incomplete because:',
    'Next best steps:',
    'Risks/blockers:',
    '',
    '[GOAL]',
    current.goal,
    '',
    '[PREVIOUS_GOAL_PROGRESS_SUMMARY]',
    current.progressSummary || '(none)',
    '',
    '[LAST_JUDGE_REASON]',
    current.lastReason || '(none)',
    '',
    '[LAST_JUDGE_DIRECTIVE]',
    current.nextStepDirective || '(none)',
    '',
    '[DENIED_ACTIONS]',
    formatDeniedActions(current, 12).slice(0, 3500),
    '',
    '[RECENT_GOAL_MESSAGES]',
    formatGoalMessages(recentMessages) || '(none)',
    '',
    '[RECENT_TOOL_OBSERVATIONS]',
    toolLog || '(none)',
  ].join('\n');

  let summary = '';
  try {
    const result = await getOllamaClient().chatWithThinking(
      [
        { role: 'system', content: 'You are GoalCompactor. Produce only the requested progress ledger, no chatter.' },
        { role: 'user', content: prompt },
      ],
      'manager',
      {
        temperature: 0.1,
        num_ctx: 8192,
        num_predict: Math.max(500, Math.min(1600, policy.summaryMaxWords * 3)),
        ...(policy.compactionModel ? { model: policy.compactionModel } : {}),
        usageContext: { sessionId, agentId: 'main_chat_goal_compactor' },
      },
    );
    summary = stripThink(String(result?.message?.content || '')).trim();
  } catch {
    summary = '';
  }
  if (!summary) summary = buildFallbackGoalSummary(current, recentMessages);

  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== current.id) return goal;
    return {
      ...goal,
      progressSummary: summary.slice(0, 8000),
      goalSummaryTurn: goal.turnsUsed,
      lastSummaryAt: Date.now(),
      lastSummaryMessageIndex: session.history.length,
      updatedAt: Date.now(),
    };
  });
}

export function buildMainChatGoalContinuationPrompt(goal: MainChatGoalState): string {
  return [
    CONTINUATION_HEADER,
    '',
    'Goal:',
    goal.goal,
    '',
    'Judge message:',
    goal.nextStepDirective || '(No judge message yet. Infer the next concrete step from the goal and chat context.)',
    '',
    'Last judge reason:',
    goal.lastReason || '(No judge reason yet.)',
  ].join('\n');
}

export function applyMainChatGoalJudgeResult(
  sessionId: string,
  expectedGoalId: string,
  judge: MainChatGoalJudgeResult,
): MainChatGoalState | null {
  const policy = resolveMainChatGoalPolicy();
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const now = Date.now();
    const consecutiveJudgeFailures = judge.parseFailed ? goal.consecutiveJudgeFailures + 1 : 0;
    if (judge.status === 'done') {
      return {
        ...goal,
        status: 'done',
        turnsUsed: goal.turnsUsed + 1,
        lastTurnAt: now,
        completedAt: now,
        lastVerdict: 'done',
        lastReason: judge.reason,
        nextStepDirective: undefined,
        consecutiveJudgeFailures,
        consecutiveRuntimeFailures: 0,
        updatedAt: now,
      };
    }
    if (judge.status === 'blocked') {
      return {
        ...goal,
        status: 'blocked',
        turnsUsed: goal.turnsUsed + 1,
        lastTurnAt: now,
        lastVerdict: 'blocked',
        lastReason: judge.reason,
        nextStepDirective: judge.directive || undefined,
        blockedReason: judge.reason,
        consecutiveJudgeFailures,
        consecutiveRuntimeFailures: 0,
        updatedAt: now,
      };
    }
    const pauseForJudge = consecutiveJudgeFailures >= policy.maxConsecutiveJudgeFailures;
    return {
      ...goal,
      status: pauseForJudge ? 'paused' : 'active',
      turnsUsed: goal.turnsUsed + 1,
      lastTurnAt: now,
      lastVerdict: 'continue',
      lastReason: judge.reason,
      nextStepDirective: judge.directive || goal.nextStepDirective,
      pausedReason: pauseForJudge ? `Judge returned unparseable output ${consecutiveJudgeFailures} turns in a row.` : goal.pausedReason,
      consecutiveJudgeFailures,
      consecutiveRuntimeFailures: 0,
      updatedAt: now,
    };
  });
}

export function recordMainChatGoalRuntimeFailure(sessionId: string, expectedGoalId: string, reason: string): MainChatGoalState | null {
  const policy = resolveMainChatGoalPolicy();
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const failures = goal.consecutiveRuntimeFailures + 1;
    const failed = failures >= policy.maxConsecutiveRuntimeFailures;
    return {
      ...goal,
      status: failed ? 'failed' : 'paused',
      lastVerdict: 'failed',
      lastReason: reason,
      failureReason: reason,
      consecutiveRuntimeFailures: failures,
      updatedAt: Date.now(),
    };
  });
}

export function recordMainChatGoalInterruptedForRestart(
  sessionId: string,
  reason = 'gateway_restart',
  runtimeStartedAt?: number,
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.status !== 'active') return goal;
    const now = Date.now();
    const startedAt = Number(runtimeStartedAt || 0);
    const lastTurnAt = Number(goal.lastTurnAt || 0);
    const shouldCountInterruptedTurn = !startedAt || !lastTurnAt || lastTurnAt < startedAt;
    return {
      ...goal,
      status: 'paused',
      turnsUsed: goal.turnsUsed + (shouldCountInterruptedTurn ? 1 : 0),
      lastTurnAt: shouldCountInterruptedTurn ? now : goal.lastTurnAt,
      lastVerdict: 'continue',
      lastReason: `Interrupted by ${reason}.`,
      pausedReason: reason,
      failureReason: undefined,
      updatedAt: now,
    };
  });
}

export function recordMainChatGoalDeniedAction(
  sessionId: string,
  input: {
    toolName: string;
    category?: string;
    reason?: string;
    safeAlternative?: string;
  },
): MainChatGoalState | null {
  const policy = resolveMainChatGoalPolicy();
  if (!policy.permissions.recordDeniedActions) return getMainChatGoal(sessionId);
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.status !== 'active') return goal;
    const deniedActions = Array.isArray(goal.deniedActions) ? goal.deniedActions.slice(-19) : [];
    deniedActions.push({
      at: Date.now(),
      toolName: String(input.toolName || 'tool').slice(0, 120),
      category: String(input.category || 'hard_denied_action').slice(0, 120),
      reason: String(input.reason || 'Policy denied this action.').slice(0, 600),
      safeAlternative: String(input.safeAlternative || 'Continue with a safer workspace-scoped approach.').slice(0, 600),
    });
    return {
      ...goal,
      deniedActions,
      updatedAt: Date.now(),
    };
  });
}

export function getAllMainChatGoalRecords() {
  return listMainChatGoalRecords();
}

export interface GoalApprovalJudgeResult {
  approved: boolean;
  reason: string;
  /** If rejected, concrete instruction for the worker on what to do instead. */
  redirectDirective: string;
}

/**
 * Judge-evaluated approval gate for /goal autonomous mode.
 * Called synchronously (awaited) inside tool handlers for request_dev_source_edit
 * and request_final_action_approval instead of blindly auto-approving.
 *
 * The judge decides:
 *   - Does this approval make sense given the active goal?
 *   - Is it necessary and scoped correctly?
 *   - If not, what should the worker do instead?
 *
 * Returns approved=true/false with reason and (on rejection) a redirect directive.
 * Falls back to approved=true on judge error so the goal loop is never permanently
 * blocked by a judge failure.
 */
export async function judgeGoalApprovalRequest(
  sessionId: string,
  approvalType: 'dev_source_edit' | 'final_action',
  context: {
    /** Human-readable summary of what is being approved */
    summary: string;
    /** Files being unlocked (dev_source_edit only) */
    files?: string[];
    /** Action kind (final_action only) */
    actionKind?: string;
    /** Target label (final_action only) */
    targetLabel?: string;
    /** Plan reason or description provided by the worker */
    reason?: string;
    /** The plan object (dev_source_edit only) */
    plan?: Record<string, any>;
  },
): Promise<GoalApprovalJudgeResult> {
  const goal = getMainChatGoal(sessionId);
  if (!goal || goal.status !== 'active') {
    // No active goal — fall back to approved so normal approval flow runs
    return { approved: true, reason: 'No active goal; approval passed through.', redirectDirective: '' };
  }

  const policy = resolveMainChatGoalPolicy();

  const approvalDesc = approvalType === 'dev_source_edit'
    ? [
        `Type: dev_source_edit (Prometheus source code edit)`,
        `Files: ${(context.files || []).join(', ') || '(none listed)'}`,
        `Reason: ${context.reason || '(none)'}`,
        context.plan ? `Plan user_request: ${String(context.plan.user_request || context.plan.userRequest || '(none)')}` : '',
        context.plan ? `Plan fix: ${String(context.plan.fix || '(none)')}` : '',
      ].filter(Boolean).join('\n')
    : [
        `Type: final_action (UI action requiring confirmation)`,
        `Action kind: ${context.actionKind || '(unknown)'}`,
        `Target: ${context.targetLabel || '(none)'}`,
        `Summary: ${context.summary || '(none)'}`,
      ].filter(Boolean).join('\n');

  const prompt = [
    'You are GoalJudge evaluating an approval request from an autonomous worker running toward a /goal.',
    'Decide whether this approval is necessary, safe, and aligned with the active goal.',
    'Return exactly one JSON object with keys: approved (boolean), reason (string, <=300 chars), redirectDirective (string, <=500 chars).',
    'approved=true: the approval is on-goal, necessary, and safe to grant automatically.',
    'approved=false: the approval is off-goal, unnecessary, risky, or the worker should take a different approach.',
    'redirectDirective: if approved=false, give the worker a concrete instruction on what to do instead. If approved=true, leave empty string.',
    '',
    '[ACTIVE GOAL]',
    goal.goal.slice(0, 2000),
    '',
    '[CURRENT PROGRESS SUMMARY]',
    String(goal.progressSummary || '(none)').slice(0, 1500),
    '',
    '[LAST JUDGE DIRECTIVE]',
    String(goal.nextStepDirective || '(none)').slice(0, 800),
    '',
    '[APPROVAL REQUEST]',
    approvalDesc,
  ].join('\n');

  try {
    const result = await getOllamaClient().chatWithThinking(
      [
        { role: 'system', content: 'You are GoalJudge. Return strict JSON only. No markdown, no prose outside JSON.' },
        { role: 'user', content: prompt },
      ],
      'manager',
      {
        temperature: 0,
        num_ctx: 8192,
        num_predict: 400,
        ...(policy.judgeModel ? { model: policy.judgeModel } : {}),
        usageContext: { sessionId, agentId: 'main_chat_goal_approval_judge' },
      },
    );
    const raw = stripThink(String(result?.message?.content || ''));
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      // Parse failure — default to approved so the loop doesn't stall
      return { approved: true, reason: `Approval judge parse failed; defaulting to approved. Raw: ${oneLine(raw, 120)}`, redirectDirective: '' };
    }
    const approved = parsed.approved !== false;
    const reason = oneLine(String(parsed.reason || 'No reason provided.'), 300);
    const redirectDirective = oneLine(String(parsed.redirectDirective || parsed.redirect_directive || ''), 500);
    return { approved, reason, redirectDirective };
  } catch (err: any) {
    // Judge error — default to approved so the loop doesn't stall
    return { approved: true, reason: `Approval judge error: ${String(err?.message || err).slice(0, 120)}; defaulting to approved.`, redirectDirective: '' };
  }
}

export function snapshotMainChatGoal(sessionId: string): MainChatGoalState | null {
  const goal = getMainChatGoal(sessionId);
  return goal ? cloneGoal(goal) : null;
}
