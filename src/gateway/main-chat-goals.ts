import { randomUUID } from 'crypto';
import { getConfig } from '../config/config';
import { getOllamaClient } from '../agents/ollama-client';
import {
  archiveMainChatGoal,
  getMainChatGoal,
  getRecentToolLog,
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

export async function judgeMainChatGoal(goal: MainChatGoalState, lastResponse: string): Promise<MainChatGoalJudgeResult> {
  const response = String(lastResponse || '').trim();
  if (!response) {
    return { status: 'continue', reason: 'No assistant response to evaluate yet.', confidence: 0, parseFailed: false };
  }
  const policy = resolveMainChatGoalPolicy();
  const prompt = [
    'Evaluate whether the assistant has satisfied the active main-chat goal.',
    'Return exactly one JSON object with keys: status, reason, confidence.',
    'status must be one of: done, continue, blocked.',
    'Use done only when the goal is actually completed or the final deliverable exists.',
    'Use blocked when the assistant is waiting for user input, approval, credentials, or an external dependency.',
    'Use continue for partial progress.',
    '',
    '[GOAL]',
    goal.goal.slice(0, 3000),
    '',
    '[CURRENT_PROGRESS_SUMMARY]',
    String(goal.progressSummary || '(none)').slice(0, 3000),
    '',
    '[DENIED_ACTIONS]',
    formatDeniedActions(goal, 8).slice(0, 2500),
    '',
    '[ASSISTANT_RESPONSE]',
    response.slice(0, 5000),
  ].join('\n');

  try {
    const result = await getOllamaClient().chatWithThinking(
      [
        { role: 'system', content: 'You are GoalJudge. You return strict JSON only.' },
        { role: 'user', content: prompt },
      ],
      'manager',
      {
        temperature: 0,
        num_ctx: 8192,
        num_predict: 240,
        ...(policy.judgeModel ? { model: policy.judgeModel } : {}),
        usageContext: { sessionId: goal.sessionId, agentId: 'main_chat_goal_judge' },
      },
    );
    const raw = stripThink(String(result?.message?.content || ''));
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { status: 'continue', reason: `Judge returned unparseable output: ${oneLine(raw || '(empty)', 180)}`, confidence: 0, parseFailed: true };
    }
    const statusRaw = String(parsed.status || '').trim().toLowerCase();
    const status = statusRaw === 'done' || statusRaw === 'blocked' ? statusRaw : 'continue';
    const reason = oneLine(String(parsed.reason || 'No reason provided.'), 400);
    const confidenceNum = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0.5;
    return { status, reason, confidence, parseFailed: false };
  } catch (err: any) {
    return { status: 'continue', reason: `Judge error: ${err?.message || String(err)}`, confidence: 0, parseFailed: false };
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
    'Next best step: continue from the latest work without restarting completed steps.',
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
  const toolLog = getRecentToolLog(sessionId, Math.max(3, policy.summaryEveryTurns), 2500);
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
    '[DENIED_ACTIONS]',
    formatDeniedActions(current, 12).slice(0, 3500),
    '',
    '[RECENT_GOAL_MESSAGES]',
    formatGoalMessages(recentMessages) || '(none)',
    '',
    '[RECENT_TOOL_LOGS]',
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
    'Current goal progress summary:',
    goal.progressSummary || '(No compacted goal summary yet. Continue from the conversation state and avoid restarting completed work.)',
    '',
    'Last judge reason:',
    goal.lastReason || '(No judge reason yet.)',
    '',
    'Denied actions to avoid:',
    formatDeniedActions(goal, 8),
    '',
    'Autonomous goal mode policy:',
    'Do not ask the user for permission to use tools. Use available tools directly.',
    'If a tool returns BLOCKED_BY_GOAL_POLICY, do not retry that action or an equivalent.',
    'Read the reason, follow the safe alternative, and continue toward the goal.',
    '',
    'Continue from the current state. Take the next concrete step toward the goal.',
    'Do not restart completed work. Use tools as needed.',
    'If the goal is complete, say so explicitly.',
    'If you are blocked waiting for user input, approval, credentials, or an external dependency, say exactly what is needed and stop.',
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

export function snapshotMainChatGoal(sessionId: string): MainChatGoalState | null {
  const goal = getMainChatGoal(sessionId);
  return goal ? cloneGoal(goal) : null;
}
