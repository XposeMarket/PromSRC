import { randomUUID } from 'crypto';
import { getConfig } from '../config/config';
import { getOllamaClient } from '../agents/ollama-client';
import { getDevSourceEditContinuation, getLatestPendingDevSourceEditContinuation } from './dev-source-approvals';
import { getCoordinatedDevEdit } from './dev-edit-coordinator';
import {
  archiveMainChatGoal,
  flushSession,
  getMainChatGoal,
  getRecentToolObservationsForContext,
  getSession,
  listMainChatGoalRecords,
  setMainChatGoal,
  updateMainChatGoal,
  type ChatMessage,
  type MainChatGoalPlanStep,
  type MainChatGoalState,
  type MainChatGoalCompletionReport,
  type MainChatGoalTurnPlan,
} from './session';
import type { ModelUsageEvent } from '../providers/model-usage';

export interface MainChatGoalPolicy {
  enabled: boolean;
  autoResumeOnRestart: boolean;
  summaryEveryTurns: number;
  summaryMaxWords: number;
  compactionModel: string;
  compactionReasoning: string;
  maxConsecutiveJudgeFailures: number;
  maxConsecutiveRuntimeFailures: number;
  maxIterations: number;
  maxNoProgressTurns: number;
  completionVerificationEnabled: boolean;
  permissions: {
    approvalMode: 'normal' | 'never';
    hardDenyEnabled: boolean;
    recordDeniedActions: boolean;
  };
}

export interface MainChatGoalOutcome {
  status: 'done' | 'continue' | 'blocked';
  reason: string;
  /** Concrete instruction for the next autonomous worker turn. Empty only when the goal is done. */
  directive: string;
  confidence: number;
  parseFailed: boolean;
  qualityGrade?: string;
  unresolvedIssues?: string[];
  missingAcceptanceCriteria?: string[];
  verificationGaps?: string[];
  evidence?: string[];
}

export interface MainChatGoalCommandResult {
  handled: boolean;
  message: string;
  shouldStartRunner: boolean;
  goal: MainChatGoalState | null;
}

const CONTINUATION_HEADER = '[Continuing toward active main-chat goal]';

function goalNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function goalStartTime(goal: MainChatGoalState, now: number): number {
  const createdAt = Number.isFinite(Number(goal.createdAt)) ? Number(goal.createdAt) : now;
  return Math.max(0, createdAt);
}

function goalPauseStartedAt(goal: MainChatGoalState): number {
  return Number.isFinite(Number(goal.pauseStartedAt)) ? Number(goal.pauseStartedAt) : 0;
}

function goalPausedMs(goal: MainChatGoalState): number {
  return Math.max(0, goalNumber(goal.pausedMs));
}

function elapsedPauseMs(goal: MainChatGoalState, now: number): number {
  const pausedMs = goalPausedMs(goal);
  const pauseStartedAt = goalPauseStartedAt(goal);
  if (!pauseStartedAt || String(goal.status || '').toLowerCase() !== 'paused') return pausedMs;
  return Math.max(0, pausedMs + Math.max(0, now - pauseStartedAt));
}

export function buildMainChatGoalCompletionReport(
  goal: MainChatGoalState,
  usageEvents: ModelUsageEvent[],
  reportedAt = Date.now(),
): MainChatGoalCompletionReport | null {
  // A user stop is terminal, but it is not evidence of a completed goal and
  // must not produce success totals in the primary conversation.
  if (!goal?.id || String(goal.status || '') !== 'done' || goal.lastVerdict === 'stopped') return null;
  const startedAt = goalStartTime(goal, reportedAt);
  const completedAt = Math.max(startedAt, Number(goal.completedAt || reportedAt));
  const reportEndAt = Math.max(completedAt, Number(reportedAt || completedAt));
  const relevantUsage = (Array.isArray(usageEvents) ? usageEvents : []).filter((event) => {
    const timestamp = Date.parse(String(event?.timestamp || ''));
    return Number.isFinite(timestamp) && timestamp >= startedAt && timestamp <= reportEndAt;
  });
  return {
    goalId: goal.id,
    elapsedMs: Math.max(0, reportEndAt - startedAt - elapsedPauseMs(goal, reportEndAt)),
    totalTokens: relevantUsage.reduce((sum, event) => sum + Math.max(0, Number(event.totalTokens || 0)), 0),
    totalCostMicros: relevantUsage.reduce((sum, event) => sum + Math.max(0, Number(event.totalCostMicros || 0)), 0),
    startedAt,
    completedAt: reportEndAt,
  };
}

function startPause(
  goal: MainChatGoalState,
  reason: string,
  now: number,
): MainChatGoalState {
  const existingPauseStartedAt = goalPauseStartedAt(goal);
  return {
    ...goal,
    status: 'paused',
    pauseStartedAt: existingPauseStartedAt || now,
    pausedMs: goalPausedMs(goal),
    pausedReason: reason || goal.pausedReason || 'paused',
    failureReason: undefined,
    blockedReason: undefined,
    updatedAt: now,
  };
}

function endPause(goal: MainChatGoalState, now: number): MainChatGoalState {
  if (String(goal.status || '').toLowerCase() !== 'paused' && !goalPauseStartedAt(goal)) {
    return goal;
  }
  const pauseStartedAt = goalPauseStartedAt(goal);
  const addMs = pauseStartedAt ? Math.max(0, now - pauseStartedAt) : 0;
  return {
    ...goal,
    pauseStartedAt: undefined,
    pausedMs: Math.max(0, goalPausedMs(goal) + addMs),
  };
}

function finalizePause(goal: MainChatGoalState, now: number): MainChatGoalState {
  if (!goalPauseStartedAt(goal)) return goal;
  const nextGoal = endPause({
    ...goal,
    status: goal.status || 'active',
  }, now);
  return {
    ...nextGoal,
    status: goal.status,
    updatedAt: now,
  };
}

export function resolveMainChatGoalPolicy(): MainChatGoalPolicy {
  const cfg = (getConfig().getConfig() as any)?.session?.mainChatGoals || {};
  const summaryEveryTurnsRaw = Number(cfg.summaryEveryTurns);
  const summaryMaxWordsRaw = Number(cfg.summaryMaxWords);
  const maxJudgeRaw = Number(cfg.maxConsecutiveJudgeFailures);
  const maxRuntimeRaw = Number(cfg.maxConsecutiveRuntimeFailures);
  const maxIterationsRaw = Number(cfg.maxIterations);
  const maxNoProgressRaw = Number(cfg.maxNoProgressTurns);
  return {
    enabled: cfg.enabled !== false,
    autoResumeOnRestart: cfg.autoResumeOnRestart !== false,
    summaryEveryTurns: Number.isFinite(summaryEveryTurnsRaw) ? Math.max(1, Math.min(50, Math.floor(summaryEveryTurnsRaw))) : 5,
    summaryMaxWords: Number.isFinite(summaryMaxWordsRaw) ? Math.max(120, Math.min(1200, Math.floor(summaryMaxWordsRaw))) : 450,
    compactionModel: String(cfg.compactionModel || '').trim(),
    compactionReasoning: String(cfg.compactionReasoning || '').trim(),
    maxConsecutiveJudgeFailures: Number.isFinite(maxJudgeRaw) ? Math.max(1, Math.min(20, Math.floor(maxJudgeRaw))) : 3,
    maxConsecutiveRuntimeFailures: Number.isFinite(maxRuntimeRaw) ? Math.max(1, Math.min(20, Math.floor(maxRuntimeRaw))) : 3,
    maxIterations: Number.isFinite(maxIterationsRaw) ? Math.max(1, Math.min(500, Math.floor(maxIterationsRaw))) : 100,
    maxNoProgressTurns: Number.isFinite(maxNoProgressRaw) ? Math.max(1, Math.min(50, Math.floor(maxNoProgressRaw))) : 8,
    completionVerificationEnabled: cfg.completionVerificationEnabled !== false,
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
    pauseStartedAt: undefined,
    pausedMs: 0,
    createdAt: now,
    updatedAt: now,
    turnPlans: [],
    requirementsLedger: [{ id: `goal_requirement_${now}`, text: goal, at: now, source: 'initial_goal' }],
    currentIteration: 1,
    iterations: [{
      iterationNumber: 1,
      turnNumber: 1,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      restartCount: 0,
    }],
    consecutiveNoProgressTurns: 0,
    consecutiveJudgeFailures: 0,
    consecutiveRuntimeFailures: 0,
  };
}

function resolveLiveMainChatModelRef(): string {
  const cfg = getConfig().getConfig() as any;
  const provider = String(cfg?.llm?.provider || '').trim();
  const model = String(cfg?.llm?.providers?.[provider]?.model || cfg?.models?.primary || '').trim();
  return provider && model ? `${provider}/${model}` : model;
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

function normalizeProgressStatus(input: any): MainChatGoalPlanStep['status'] {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'in_progress' || value === 'done' || value === 'failed' || value === 'skipped') return value;
  return 'pending';
}

function statusFromPlanSteps(steps: MainChatGoalPlanStep[]): MainChatGoalTurnPlan['status'] {
  if (!steps.length) return 'planned';
  if (steps.every((step) => step.status === 'done' || step.status === 'skipped')) return 'complete';
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'in_progress')) return 'in_progress';
  return 'planned';
}

function normalizeTurnPlanSource(input: any): MainChatGoalTurnPlan['source'] {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'declared' || value === 'tool_sequence' || value === 'preflight' || value === 'judge') return value;
  return 'unknown';
}

function statusLine(goal: MainChatGoalState | null): string {
  if (!goal) return 'No active main-chat goal. Set one with /goal <objective>.';
  const bits = [
    `Goal: ${goal.goal}`,
    `Status: ${goal.lastVerdict === 'stopped' ? 'stopped' : goal.status}`,
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
    return { handled: true, message: statusLine(current), shouldStartRunner: false, goal: current };
  }

  if (sub === 'pause') {
    const note = arg.replace(/^pause\b/i, '').trim();
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      return startPause(goal, note || 'user-paused', Date.now());
    });
    return { handled: true, message: next ? statusLine(next) : 'No main-chat goal to pause.', shouldStartRunner: false, goal: next };
  }

  if (sub === 'resume') {
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      const now = Date.now();
      const status = String(goal.status || '').toLowerCase();
      if (!['restarting', 'paused', 'blocked', 'failed'].includes(status) && !goalPauseStartedAt(goal) && String(goal.lastVerdict || '') !== 'failed') {
        return goal;
      }
      return {
        ...endPause({ ...goal, status: 'active' }, now),
        status: 'active',
        pausedReason: undefined,
        blockedReason: undefined,
        failureReason: undefined,
        consecutiveRuntimeFailures: 0,
        restartCheckpoint: goal.restartCheckpoint ? {
          ...goal.restartCheckpoint,
          phase: 'resuming',
          recoveredAt: goal.restartCheckpoint.recoveredAt || now,
        } : undefined,
        updatedAt: now,
      };
    });
    return { handled: true, message: next ? `Resumed main-chat goal.\n${statusLine(next)}` : 'No main-chat goal to resume.', shouldStartRunner: !!next, goal: next };
  }

  if (sub === 'clear') {
    const note = arg.replace(/^clear\b/i, '').trim();
    const now = Date.now();
    if (current) {
      const currentState = finalizePause(current, now);
      archiveMainChatGoal(sessionId, {
      ...currentState,
      status: 'cleared',
      lastReason: note || current.lastReason,
      updatedAt: now,
      });
    }
    setMainChatGoal(sessionId, null);
    return { handled: true, message: note ? `Cleared the main-chat goal. Note: ${note}` : 'Cleared the main-chat goal.', shouldStartRunner: false, goal: null };
  }

  if (sub === 'done') {
    const note = arg.replace(/^done\b/i, '').trim();
    const next = updateMainChatGoal(sessionId, (goal) => {
      if (!goal) return null;
      const now = Date.now();
      const plans = Array.isArray(goal.turnPlans) ? goal.turnPlans.map((plan) => ({ ...plan, steps: [...(plan.steps || [])] })) : undefined;
      if (plans?.length) {
        let planIndex = plans.map((plan) => isOpenGoalTurnPlan(plan)).lastIndexOf(true);
        if (planIndex < 0) planIndex = plans.length - 1;
        plans[planIndex] = {
          ...plans[planIndex],
          status: 'complete',
          activeIndex: -1,
          updatedAt: now,
          completedAt: plans[planIndex].completedAt || now,
          judgeReason: note || 'Marked done by user.',
          judgeDirective: undefined,
          steps: plans[planIndex].steps.map((step) => (
            step.status === 'done' || step.status === 'skipped'
              ? step
              : {
                  ...step,
                  status: 'skipped' as const,
                  note: step.note || `Superseded by owner closeout: ${oneLine(note || 'Marked done by user.', 420)}`,
                  updatedAt: now,
                }
          )),
        };
      }
      return {
        ...goal,
        ...finalizePause(goal, now),
        status: 'done',
        lastVerdict: 'stopped',
        lastReason: note || 'Marked done by user.',
        nextStepDirective: undefined,
        blockedReason: undefined,
        pausedReason: undefined,
        failureReason: undefined,
        turnPlans: plans,
        restartCheckpoint: goal.restartCheckpoint ? { ...goal.restartCheckpoint, phase: 'complete', completedAt: now } : undefined,
        completedAt: now,
        updatedAt: now,
      };
    });
    return { handled: true, message: next ? `Stopped main-chat goal.\n${statusLine(next)}` : 'No main-chat goal to stop.', shouldStartRunner: false, goal: next };
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

export function recordMainChatGoalTurnPlanProgress(
  sessionId: string,
  progress: {
    source?: string;
    reason?: string;
    activeIndex?: number;
    items?: Array<{ id?: string; text?: string; status?: string; note?: string }>;
  },
  expectedGoalId?: string,
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.status !== 'active') return goal;
    if (expectedGoalId && goal.id !== expectedGoalId) return goal;
    const rawItems = Array.isArray(progress.items) ? progress.items : [];
    const now = Date.now();
    const resumablePlan = findResumableGoalTurnPlan(goal);
    const turnNumber = Number(resumablePlan?.turnNumber || 0) || goal.turnsUsed + 1;
    const steps: MainChatGoalPlanStep[] = rawItems
      .map((item, index) => {
        const text = oneLine(String(item?.text || ''), 240);
        if (!text) return null;
        return {
          id: String(item?.id || `g${turnNumber}_s${index + 1}`),
          text,
          status: normalizeProgressStatus(item?.status),
          note: item?.note ? oneLine(String(item.note), 700) : undefined,
          updatedAt: now,
        };
      })
      .filter(Boolean) as MainChatGoalPlanStep[];
    if (steps.length < 2) return goal;

    const planStatus = statusFromPlanSteps(steps);
    const plans = Array.isArray(goal.turnPlans) ? [...goal.turnPlans] : [];
    const existingIndex = plans.findIndex((plan) => Number(plan.turnNumber) === turnNumber);
    const existing = existingIndex >= 0 ? plans[existingIndex] : null;
    const nextPlan: MainChatGoalTurnPlan = {
      id: existing?.id || `goal_turn_${turnNumber}_${now}`,
      turnNumber,
      status: planStatus,
      source: normalizeTurnPlanSource(progress.source),
      activeIndex: Number.isFinite(Number(progress.activeIndex)) ? Number(progress.activeIndex) : -1,
      startedAt: existing?.startedAt || now,
      updatedAt: now,
      completedAt: planStatus === 'complete' ? (existing?.completedAt || now) : existing?.completedAt,
      judgeReason: existing?.judgeReason,
      judgeDirective: existing?.judgeDirective,
      steps,
    };
    if (existingIndex >= 0) plans[existingIndex] = nextPlan;
    else plans.push(nextPlan);
    return {
      ...goal,
      turnPlans: plans.slice(-50),
      updatedAt: now,
    };
  });
}

function parseGoalJsonCandidate(candidate: string): any | null {
  const text = String(candidate || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
    if (typeof parsed === 'string' && /^\s*\{[\s\S]*\}\s*$/.test(parsed)) {
      try {
        const nested = JSON.parse(parsed);
        return nested && typeof nested === 'object' ? nested : null;
      } catch {}
    }
  } catch {}
  return null;
}

function extractJsonObject(raw: string): any | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const unfenced = text.startsWith('```')
    ? text.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim()
    : text;
  const direct = parseGoalJsonCandidate(unfenced);
  if (direct) return direct;
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return parseGoalJsonCandidate(match[0]);
}

function stripThink(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function compactTextBlock(text: string, max = 1800): string {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function isOpenGoalTurnPlan(plan: MainChatGoalTurnPlan | null | undefined): boolean {
  const status = String(plan?.status || '').trim().toLowerCase();
  return !!plan && !['complete', 'blocked'].includes(status);
}

function shouldResumeExistingTurnPlan(goal: MainChatGoalState): boolean {
  const reason = [
    goal.lastReason,
    goal.pausedReason,
    goal.failureReason,
  ].map((part) => String(part || '').toLowerCase()).join(' ');
  if (String(goal.status || '').toLowerCase() === 'paused') return true;
  if (goal.lastVerdict === 'failed') return true;
  return /\b(interrupted|gateway_restart|gateway_crash|restart|request canceled|request cancelled|canceled|cancelled|abort|aborted|stopped|runtime failure|runtime error|judge returned unparseable output)\b/.test(reason);
}

function findResumableGoalTurnPlan(goal: MainChatGoalState): MainChatGoalTurnPlan | null {
  if (!shouldResumeExistingTurnPlan(goal)) return null;
  const plans = Array.isArray(goal.turnPlans) ? [...goal.turnPlans] : [];
  if (!plans.length) return null;
  const checkpointPlanId = String(goal.restartCheckpoint?.planId || '').trim();
  if (checkpointPlanId) {
    const checkpointPlan = plans.find((plan) => plan.id === checkpointPlanId && isOpenGoalTurnPlan(plan));
    if (checkpointPlan) return checkpointPlan;
  }
  const nextTurn = Number(goal.turnsUsed || 0) + 1;
  const exact = [...plans].reverse().find((plan) => Number(plan.turnNumber) === nextTurn && isOpenGoalTurnPlan(plan));
  if (exact) return exact;

  // Backward compatibility for goals interrupted before this fix: some restart
  // paths already advanced turnsUsed, leaving the open plan at the current turn.
  const current = [...plans].reverse().find((plan) => Number(plan.turnNumber) === Number(goal.turnsUsed || 0) && isOpenGoalTurnPlan(plan));
  if (current) return current;

  // Older broken sessions may have advanced turnsUsed multiple times while the
  // actual UI card remained open at an earlier turn. Resume that latest open
  // card instead of creating another abandoned plan.
  return [...plans].reverse().find((plan) => isOpenGoalTurnPlan(plan)) || null;
}

function reopenPlanStepAfterContinue(plan: MainChatGoalTurnPlan, judge: MainChatGoalOutcome, now: number): MainChatGoalTurnPlan {
  const steps = Array.isArray(plan.steps) ? plan.steps.map((step) => ({ ...step })) : [];
  if (!steps.length) return plan;
  const hasOpenStep = steps.some((step) => ['pending', 'in_progress', 'failed'].includes(String(step.status || '').toLowerCase()));
  if (hasOpenStep) return { ...plan, steps };

  const judgeText = [
    judge.reason,
    judge.directive,
    ...(judge.missingAcceptanceCriteria || []),
    ...(judge.verificationGaps || []),
    ...(judge.unresolvedIssues || []),
  ].join(' ').toLowerCase();
  const mentionsMissingArtifact = /\b(missing|not exist|not found|undelivered|not delivered|not created|unreadable|no successful write|artifact|file|index|html|deliverable)\b/.test(judgeText);
  const implementationIndex = steps.findIndex((step) => {
    const text = String(step.text || '').toLowerCase();
    return /\b(write|create|implement|build|edit|patch|add|update|fix|scaffold|generate|complete)\b/.test(text)
      && /\b(file|html|index|app|game|page|component|code|script|feature|deliverable)\b/.test(text);
  });
  const skippedIndex = steps.findIndex((step) => String(step.status || '').toLowerCase() === 'skipped');
  const index = mentionsMissingArtifact && implementationIndex >= 0
    ? implementationIndex
    : skippedIndex >= 0
      ? skippedIndex
      : Math.max(0, steps.length - 1);
  steps[index] = {
    ...steps[index],
    status: 'in_progress',
    note: undefined,
    updatedAt: now,
  };
  return {
    ...plan,
    activeIndex: index,
    steps,
  };
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
    goal.lastReason ? `Still incomplete because: ${goal.lastReason}` : 'Still incomplete because: Prometheus has not submitted an accepted evidence-backed completion.',
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
    '[DURABLE_ACCEPTANCE_REQUIREMENTS_AND_AMENDMENTS]',
    formatGoalRequirements(current),
    '',
    '[PREVIOUS_GOAL_PROGRESS_SUMMARY]',
    current.progressSummary || '(none)',
    '',
    '[LAST_LIFECYCLE_OR_VERIFIER_REASON]',
    current.lastReason || '(none)',
    '',
    '[LAST_COMPLETION_VERIFIER_DIRECTIVE]',
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
        ...(policy.compactionModel || resolveLiveMainChatModelRef() ? { model: policy.compactionModel || resolveLiveMainChatModelRef() } : {}),
        ...(policy.compactionReasoning ? { think: policy.compactionReasoning as any } : {}),
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
  const nextTurn = Number(goal.turnsUsed || 0) + 1;
  const resumablePlan = findResumableGoalTurnPlan(goal);
  const resumableSteps = Array.isArray(resumablePlan?.steps) ? resumablePlan.steps : [];
  const hasDeclaredGoalPlan = Array.isArray(goal.turnPlans) && goal.turnPlans.some((plan) => Array.isArray(plan.steps) && plan.steps.length >= 2);
  const planInstruction = resumablePlan
    ? [
        `This is autonomous goal turn ${Number(resumablePlan.turnNumber) || nextTurn}, resuming an interrupted unfinished turn plan.`,
        'Do NOT call declare_plan at the start. The stored plan is already active in the progress UI. Continue at the first step that is not done/skipped, call complete_plan_step with concrete evidence as each step finishes, and only declare a replacement plan if the stored plan is obsolete or impossible.',
        '',
        'Stored active turn plan:',
        ...resumableSteps.map((step, index) => `${index + 1}. [${step.status || 'pending'}] ${oneLine(step.text, 220)}${step.note ? ` | evidence: ${oneLine(step.note, 260)}` : ''}`),
      ].join('\n')
    : !hasDeclaredGoalPlan
      ? [
          `This is autonomous goal turn ${nextTurn}, and the Goal does not have a declared plan yet.`,
          'Before doing substantive work, call declare_plan with 2-6 concrete steps that cover the current path to completion, then execute them in order. Keep each step in_progress until it is truly done and call complete_plan_step with concrete evidence after each completed step.',
          'This first declared plan becomes the durable Goal plan shown in the progress UI and must survive continuation and restart boundaries.',
        ].join('\n')
      : `This is autonomous goal continuation ${nextTurn}. Continue directly from the thread and evidence already gathered. Call declare_plan only when a new tracked multi-step plan would materially help; it is not required at every continuation boundary.`;
  const crashRecovered = goal.restartCheckpoint?.phase === 'crash_recovered'
    || goal.restartCheckpoint?.recoveryKind === 'crash';
  const restart = goal.restartCheckpoint && goal.restartCheckpoint.phase !== 'complete'
    ? [
        '',
        'Restart recovery checkpoint:',
        `- checkpoint_id: ${goal.restartCheckpoint.id}`,
        `- reason: ${goal.restartCheckpoint.reason}`,
        `- phase: ${goal.restartCheckpoint.phase}`,
        `- dev_edit_id: ${goal.restartCheckpoint.devEditId || '(none)'}`,
        `- affected_files: ${(goal.restartCheckpoint.affectedFiles || []).join(', ') || '(none recorded)'}`,
        `- known_touched_files: ${(goal.restartCheckpoint.touchedFiles || []).join(', ') || '(none recorded; approved/checkpoint files are not proof of mutation)'}`,
        `- changed_surfaces: ${(goal.restartCheckpoint.changedSurfaces || []).join(', ') || '(none recorded)'}`,
        `- pre_restart_verification: ${goal.restartCheckpoint.verificationSummary || '(none recorded)'}`,
        crashRecovered
          ? 'This was an UNEXPECTED gateway restart before the current changes were verified or applied. Do not claim that the changes are live. Preserve and resume the existing dev edit ID when present. Reread every known touched file before making further edits; when no touched-file evidence exists, treat the checkpoint file list only as possible scope and reread it before mutation. Reconcile partial work without blindly repeating it, then finish verification and use the normal apply/restart path only when the changes are actually ready.'
          : 'This was an intentional restart boundary inside the same goal. Do not stop after acknowledging it. Confirm the new gateway is healthy, perform the post-restart verification or benchmark required by the goal, continue the stored unfinished plan, and include concrete evidence in the eventual completion attempt.',
    ].join('\n')
    : '';
  const restartDevEdit = String(goal.restartCheckpoint?.devEditId || '').trim()
    ? getDevSourceEditContinuation(goal.restartCheckpoint?.devEditId)
    : getLatestPendingDevSourceEditContinuation(goal.sessionId);
  const devEditContinuation = restartDevEdit
    ? [
        '',
        'Durable dev-edit continuation:',
        `- id: ${restartDevEdit.id}`,
        `- status: ${restartDevEdit.status}`,
        `- files: ${(restartDevEdit.affectedFiles || restartDevEdit.allowedFiles || []).join(', ') || '(none)'}`,
        `- verification: ${restartDevEdit.lastVerification?.summary || restartDevEdit.verification?.join('; ') || '(none)'}`,
        restartDevEdit.status === 'complete'
          ? '- LIVE APPLY ALREADY COMPLETED. Do not call prom_apply_dev_changes or trigger another restart for this dev-edit ID; perform only post-restart verification and remaining goal work.'
          : '- Resume this exact dev-edit ID; do not create a duplicate approval or apply the same completed work twice.',
      ].join('\n')
    : '';
  return [
    CONTINUATION_HEADER,
    '',
    'ACTIVE GOAL EXECUTION CONTRACT:',
    'You are operating inside an active Goal. Own the objective end to end.',
    'Do not ask the user for confirmation, permission, preferences, or next steps when the existing request and available context are enough to proceed. Make reasonable in-scope assumptions, use the available tools, revise your approach when necessary, and finish every requested part with concrete verification.',
    'Do not stop at partial progress, a plan, an edit, a build, a successful command, or a restart acknowledgement. Continue until the complete requested outcome is implemented and verified.',
    'Do not claim the Goal is finished in prose alone. When you decide the objective is complete, call complete_goal with a completion note and the concrete steps you took.',
    'The declared plan is progress tracking, not a completion authority. If the objective is complete, call complete_goal even when plan items are stale, overly broad, or still marked open; owner completion supersedes that bookkeeping.',
    'A finished, verified, ready-to-use deliverable may be completed with clearly documented user activation or physical handoff steps when Prometheus cannot perform those steps itself. Do not use block_goal for that handoff unless the user explicitly made live activation or physical-device verification a required acceptance criterion.',
    'Use block_goal only after exhausting safe in-scope alternatives and only when missing user authority, credentials, an essential user choice, an unavailable external system, or a hard policy boundary makes further progress impossible. Include what you tried and the exact missing requirement.',
    'A Goal does not expand your permissions. Never bypass approval, credential, safety, or scope boundaries.',
    '',
    'Goal:',
    goal.goal,
    '',
    'Durable acceptance requirements and user amendments:',
    formatGoalRequirements(goal),
    '',
    planInstruction,
    restart,
    devEditContinuation,
    '',
    'Tool routing:',
    'This autonomous goal turn uses the normal main-chat tool route. Core tools such as request_tool_category, skill_list, skill_read, and declare_plan are available; complete_plan_step is injected after declare_plan or when a stored manual plan is resumed. If the current step needs tools that are not currently visible, call request_tool_category with the right category before describing tool use. For workspace files/directories/builds/games, use request_tool_category({"category":"workspace_write","scope":"turn"}) when workspace_read/workspace_edit/workspace_run tools are needed. Do not narrate or claim a tool call unless you actually call the tool.',
    '',
    'Goal continuation note:',
    goal.nextStepDirective || '(Continue the most useful concrete work toward the goal.)',
    '',
    'Last lifecycle reason:',
    goal.lastReason || '(No prior lifecycle reason.)',
    '',
    'Progress so far:',
    goal.progressSummary || '(No compacted progress summary yet.)',
  ].join('\n');
}

export function applyMainChatGoalOutcome(
  sessionId: string,
  expectedGoalId: string,
  judge: MainChatGoalOutcome,
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const now = Date.now();
    const consecutiveJudgeFailures = judge.parseFailed ? goal.consecutiveJudgeFailures + 1 : 0;
    const resumablePlan = findResumableGoalTurnPlan(goal);
    const turnNumber = Number(resumablePlan?.turnNumber || 0) || goal.turnsUsed + 1;
    const nextTurnsUsed = Math.max(goal.turnsUsed, turnNumber);
    const iterationNumber = Math.max(1, Number(goal.currentIteration || 0) || (goal.iterations?.length || 0) || 1);
    const judgeFingerprint = [
      judge.qualityGrade,
      ...(judge.unresolvedIssues || []),
      ...(judge.missingAcceptanceCriteria || []),
      ...(judge.verificationGaps || []),
      judge.reason,
    ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const previousJudged = [...(goal.iterations || [])].reverse().find((item) => item.status === 'judged' || item.status === 'done' || item.status === 'blocked');
    const previousFingerprint = previousJudged
      ? [previousJudged.qualityGrade, ...(previousJudged.unresolvedIssues || []), ...(previousJudged.verificationGaps || []), previousJudged.reason]
          .join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
      : '';
    const noProgress = judge.status === 'continue' && !!previousFingerprint && previousFingerprint === judgeFingerprint;
    const consecutiveNoProgressTurns = noProgress ? Number(goal.consecutiveNoProgressTurns || 0) + 1 : 0;
    const stampIteration = (status: 'judged' | 'blocked' | 'done' | 'failed') => {
      const rows = [...(goal.iterations || [])];
      let index = rows.findIndex((item) => item.iterationNumber === iterationNumber);
      if (index < 0) {
        rows.push({ iterationNumber, turnNumber, status: 'running', startedAt: now, updatedAt: now, restartCount: 0 });
        index = rows.length - 1;
      }
      rows[index] = {
        ...rows[index],
        turnNumber,
        status,
        updatedAt: now,
        completedAt: now,
        qualityGrade: judge.qualityGrade || undefined,
        verdict: status === 'judged' ? 'continue' : status === 'done' ? 'done' : status === 'blocked' ? 'blocked' : 'failed',
        reason: judge.reason,
        directive: judge.directive || undefined,
        evidence: judge.evidence || [],
        unresolvedIssues: judge.unresolvedIssues || [],
        verificationGaps: judge.verificationGaps || [],
      };
      return rows.slice(-100);
    };
    const stampLatestPlan = (status: MainChatGoalTurnPlan['status']): MainChatGoalTurnPlan[] | undefined => {
      const plans = Array.isArray(goal.turnPlans) ? [...goal.turnPlans] : [];
      const index = plans.findIndex((plan) => Number(plan.turnNumber) === turnNumber);
      if (index < 0) return plans;
      const stamped = {
        ...plans[index],
        status,
        judgeReason: judge.reason,
        judgeDirective: judge.directive || undefined,
        updatedAt: now,
        completedAt: status === 'complete' || status === 'blocked' || status === 'failed' ? (plans[index].completedAt || now) : plans[index].completedAt,
      };
      plans[index] = status === 'incomplete'
        ? reopenPlanStepAfterContinue(stamped, judge, now)
        : stamped;
      return plans.slice(-50);
    };
    const judgeDiagnostics = {
      lastQualityGrade: judge.qualityGrade || undefined,
      lastUnresolvedIssues: judge.unresolvedIssues || [],
      lastMissingAcceptanceCriteria: judge.missingAcceptanceCriteria || [],
      lastVerificationGaps: judge.verificationGaps || [],
      lastEvidence: judge.evidence || [],
    };
    if (judge.status === 'done') {
      const finalized = finalizePause(goal, now);
      return {
        ...goal,
        ...judgeDiagnostics,
        ...finalized,
        status: 'done',
        turnsUsed: nextTurnsUsed,
        lastTurnAt: now,
        completedAt: now,
        lastVerdict: 'done',
        lastReason: judge.reason,
        nextStepDirective: undefined,
        turnPlans: stampLatestPlan('complete'),
        consecutiveJudgeFailures,
        consecutiveRuntimeFailures: 0,
        consecutiveNoProgressTurns: 0,
        iterations: stampIteration('done'),
        restartCheckpoint: goal.restartCheckpoint ? { ...goal.restartCheckpoint, phase: 'complete', completedAt: now } : undefined,
        updatedAt: now,
      };
    }
    if (judge.status === 'blocked') {
      const finalized = finalizePause(goal, now);
      return {
        ...goal,
        ...judgeDiagnostics,
        ...finalized,
        status: 'blocked',
        turnsUsed: nextTurnsUsed,
        lastTurnAt: now,
        lastVerdict: 'blocked',
        lastReason: judge.reason,
        nextStepDirective: judge.directive || undefined,
        blockedReason: judge.reason,
        turnPlans: stampLatestPlan('blocked'),
        consecutiveJudgeFailures,
        consecutiveRuntimeFailures: 0,
        consecutiveNoProgressTurns,
        iterations: stampIteration('blocked'),
        restartCheckpoint: goal.restartCheckpoint ? { ...goal.restartCheckpoint, phase: 'complete', completedAt: now } : undefined,
        updatedAt: now,
      };
    }
    const policy = resolveMainChatGoalPolicy();
    const iterationLimitReached = iterationNumber >= policy.maxIterations;
    const plateauReached = consecutiveNoProgressTurns >= policy.maxNoProgressTurns;
    const judgeFailureLimitReached = consecutiveJudgeFailures >= policy.maxConsecutiveJudgeFailures;
    if (iterationLimitReached || plateauReached || judgeFailureLimitReached) {
      const reason = judgeFailureLimitReached
        ? `Goal judge failed to return usable output ${consecutiveJudgeFailures} consecutive times.`
        : plateauReached
          ? `No material progress was detected across ${consecutiveNoProgressTurns} consecutive judged turns.`
          : `The goal reached its configured ${policy.maxIterations}-iteration safety budget.`;
      return {
        ...finalizePause(goal, now),
        ...judgeDiagnostics,
        status: 'blocked',
        turnsUsed: nextTurnsUsed,
        lastTurnAt: now,
        lastVerdict: 'blocked',
        lastReason: reason,
        blockedReason: reason,
        nextStepDirective: judge.directive || goal.nextStepDirective,
        turnPlans: stampLatestPlan('blocked'),
        consecutiveJudgeFailures,
        consecutiveRuntimeFailures: 0,
        consecutiveNoProgressTurns,
        iterations: stampIteration('blocked'),
        restartCheckpoint: goal.restartCheckpoint ? { ...goal.restartCheckpoint, phase: 'complete', completedAt: now } : undefined,
        updatedAt: now,
      };
    }
    return {
      ...goal,
      ...judgeDiagnostics,
      status: 'active',
      turnsUsed: nextTurnsUsed,
      lastTurnAt: now,
      lastVerdict: 'continue',
      lastReason: judge.reason,
      nextStepDirective: judge.directive || goal.nextStepDirective,
      turnPlans: stampLatestPlan('incomplete'),
      consecutiveJudgeFailures,
      consecutiveRuntimeFailures: 0,
      consecutiveNoProgressTurns,
      iterations: stampIteration('judged'),
      currentIteration: iterationNumber + 1,
      restartCheckpoint: goal.restartCheckpoint ? { ...goal.restartCheckpoint, phase: 'complete', completedAt: now } : undefined,
      updatedAt: now,
    };
  });
}

export interface MainChatGoalCompletionAttempt {
  note: string;
  stepsTaken: string[];
}

export async function completeMainChatGoalFromOwner(
  sessionId: string,
  expectedGoalId: string,
  attempt: MainChatGoalCompletionAttempt,
): Promise<{ accepted: boolean; goal: MainChatGoalState | null; verification: MainChatGoalOutcome }> {
  const current = snapshotMainChatGoal(sessionId);
  if (!current || current.id !== expectedGoalId || current.status !== 'active') {
    const verification: MainChatGoalOutcome = {
      status: 'continue',
      reason: 'The active Goal changed before this completion attempt could be verified.',
      directive: 'Refresh the active Goal state and continue only if it is still active.',
      confidence: 0,
      parseFailed: false,
    };
    return { accepted: false, goal: current, verification };
  }
  // Prometheus owns the Goal and explicitly called complete_goal after the
  // handler's deterministic evidence checks. Do not send that decision to a
  // second LLM; persist the owner's closeout directly.
  const verification: MainChatGoalOutcome = {
    status: 'done',
    reason: attempt.note,
    directive: '',
    confidence: 1,
    parseFailed: false,
    qualityGrade: 'owner_completed',
    evidence: attempt.stepsTaken.map((item) => `Step taken: ${item}`),
    unresolvedIssues: [],
    missingAcceptanceCriteria: [],
    verificationGaps: [],
  };
  const appliedGoal = applyMainChatGoalOutcome(sessionId, expectedGoalId, verification);
  const goal = appliedGoal?.status === 'done'
    ? updateMainChatGoal(sessionId, (latest) => {
        if (!latest || latest.id !== expectedGoalId || latest.status !== 'done') return latest;
        const plans = Array.isArray(latest.turnPlans) ? latest.turnPlans.map((plan) => ({ ...plan, steps: [...(plan.steps || [])] })) : [];
        const planIndex = plans.map((plan) => Number(plan.turnNumber) === Number(latest.turnsUsed) && plan.status === 'complete').lastIndexOf(true);
        if (planIndex < 0) return latest;
        const now = Date.now();
        plans[planIndex] = {
          ...plans[planIndex],
          status: 'complete',
          activeIndex: -1,
          updatedAt: now,
          completedAt: plans[planIndex].completedAt || now,
          steps: plans[planIndex].steps.map((step) => (
            step.status === 'done' || step.status === 'skipped'
              ? step
              : {
                  ...step,
                  status: 'skipped' as const,
                  note: step.note || `Superseded by Prometheus owner completion: ${oneLine(attempt.note, 420)}`,
                  updatedAt: now,
                }
          )),
        };
        return { ...latest, turnPlans: plans.slice(-50), updatedAt: now };
      })
    : appliedGoal;
  return { accepted: goal?.status === 'done', goal, verification };
}

export function blockMainChatGoalFromOwner(
  sessionId: string,
  expectedGoalId: string,
  input: { reason: string; missingRequirement: string; attemptedAlternatives: string[] },
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const now = Date.now();
    const reason = oneLine(input.reason, 900) || 'Prometheus reported a genuine blocker.';
    const missing = oneLine(input.missingRequirement, 700);
    const attempted = input.attemptedAlternatives.map((item) => oneLine(item, 500)).filter(Boolean).slice(0, 12);
    const fullReason = [reason, missing ? `Missing requirement: ${missing}` : '', attempted.length ? `Safe alternatives exhausted: ${attempted.join(' | ')}` : ''].filter(Boolean).join(' ');
    const plans = Array.isArray(goal.turnPlans) ? goal.turnPlans.map((plan) => ({ ...plan, steps: [...(plan.steps || [])] })) : undefined;
    if (plans?.length) {
      const checkpointPlanId = String(goal.restartCheckpoint?.planId || '').trim();
      let planIndex = checkpointPlanId ? plans.findIndex((plan) => plan.id === checkpointPlanId) : -1;
      if (planIndex < 0) planIndex = plans.map((plan) => isOpenGoalTurnPlan(plan)).lastIndexOf(true);
      if (planIndex >= 0) {
        plans[planIndex] = {
          ...plans[planIndex],
          status: 'blocked',
          judgeReason: fullReason,
          updatedAt: now,
          completedAt: plans[planIndex].completedAt || now,
        };
      }
    }
    return {
      ...finalizePause(goal, now),
      status: 'blocked',
      turnsUsed: Math.max(goal.turnsUsed, Number(goal.restartCheckpoint?.turnNumber || goal.turnsUsed + 1)),
      lastTurnAt: now,
      lastVerdict: 'blocked',
      lastReason: fullReason,
      blockedReason: fullReason,
      nextStepDirective: missing || reason,
      turnPlans: plans,
      updatedAt: now,
    };
  });
}

export function recordMainChatGoalContinuationBoundary(
  sessionId: string,
  expectedGoalId: string,
  input: {
    successfulToolCalls: number;
    meaningfulToolCalls: number;
    failedToolCalls: number;
    responseText?: string;
  },
): { goal: MainChatGoalState | null; shouldContinue: boolean; reason: string } {
  const policy = resolveMainChatGoalPolicy();
  let decisionReason = 'continue';
  let shouldContinue = true;
  const goal = updateMainChatGoal(sessionId, (current) => {
    if (!current || current.id !== expectedGoalId || current.status !== 'active') {
      shouldContinue = false;
      decisionReason = current?.status || 'goal_changed';
      return current;
    }
    const now = Date.now();
    const turnNumber = Math.max(current.turnsUsed + 1, Number(current.restartCheckpoint?.turnNumber || 0));
    const iterationNumber = Math.max(1, Number(current.currentIteration || turnNumber));
    if (turnNumber >= policy.maxIterations) {
      shouldContinue = false;
      decisionReason = 'budget_limited';
      const reason = `The Goal reached its configured ${policy.maxIterations}-continuation safety budget without an accepted completion attempt.`;
      return {
        ...finalizePause(current, now),
        status: 'blocked',
        turnsUsed: turnNumber,
        lastTurnAt: now,
        lastVerdict: 'blocked',
        lastReason: reason,
        blockedReason: reason,
        updatedAt: now,
      };
    }
    if (input.meaningfulToolCalls <= 0 || input.successfulToolCalls <= 0) {
      shouldContinue = false;
      decisionReason = 'no_measurable_progress';
      return {
        ...startPause(current, 'no_measurable_progress', now),
        status: 'paused',
        turnsUsed: turnNumber,
        lastTurnAt: now,
        lastVerdict: 'continue',
        lastReason: 'Automatic continuation was suppressed because the previous Goal turn produced no successful measurable tool progress.',
        nextStepDirective: 'Resume only with a concrete next action that uses tools or produces verifiable progress.',
        updatedAt: now,
      };
    }
    const rows = [...(current.iterations || [])];
    rows.push({
      iterationNumber,
      turnNumber,
      status: 'continued',
      startedAt: Number(current.lastTurnAt || now),
      updatedAt: now,
      completedAt: now,
      restartCount: 0,
      verdict: 'continue',
      reason: `${input.successfulToolCalls} successful tool call(s), ${input.meaningfulToolCalls} measurable, ${input.failedToolCalls} failed.`,
      evidence: input.responseText ? [oneLine(input.responseText, 500)] : [],
    });
    return {
      ...current,
      turnsUsed: turnNumber,
      currentIteration: iterationNumber + 1,
      lastTurnAt: now,
      lastVerdict: 'continue',
      lastReason: `Continuation boundary passed with ${input.meaningfulToolCalls} measurable tool action(s).`,
      iterations: rows.slice(-100),
      consecutiveRuntimeFailures: 0,
      updatedAt: now,
    };
  });
  return { goal, shouldContinue: shouldContinue && goal?.status === 'active', reason: decisionReason };
}

export function recordMainChatGoalRuntimeFailure(sessionId: string, expectedGoalId: string, reason: string): MainChatGoalState | null {
  const policy = resolveMainChatGoalPolicy();
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const failures = goal.consecutiveRuntimeFailures + 1;
    const failed = failures >= policy.maxConsecutiveRuntimeFailures;
    const now = Date.now();
    const resumablePlan = findResumableGoalTurnPlan(goal);
    const turnNumber = Number(resumablePlan?.turnNumber || 0) || goal.turnsUsed + 1;
    const plans = Array.isArray(goal.turnPlans) ? [...goal.turnPlans] : undefined;
    if (plans) {
      const index = plans.findIndex((plan) => Number(plan.turnNumber) === turnNumber);
      if (index >= 0) {
        plans[index] = {
          ...plans[index],
          status: 'failed',
          judgeReason: reason,
          updatedAt: now,
          completedAt: plans[index].completedAt || now,
        };
      }
    }
    if (!failed) {
      return {
        ...goal,
        status: 'active',
        lastVerdict: 'continue',
        lastReason: reason,
        nextStepDirective: `The previous autonomous turn hit a recoverable runtime/tool error: ${oneLine(reason, 220)}. Continue with the next concrete step, avoid repeating the exact failing call, and verify progress with available tools.`,
        turnPlans: plans,
        consecutiveRuntimeFailures: failures,
        updatedAt: now,
      };
    }
    return {
      ...finalizePause(goal, now),
      status: 'failed',
      lastVerdict: 'failed',
      lastReason: reason,
      failureReason: reason,
      turnPlans: plans,
      consecutiveRuntimeFailures: failures,
      updatedAt: now,
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
    const resumablePlan = findResumableGoalTurnPlan(goal)
      || [...(goal.turnPlans || [])].reverse().find((plan) => isOpenGoalTurnPlan(plan));
    const pendingDevEdit = getLatestPendingDevSourceEditContinuation(sessionId);
    // Later restart/verification boundaries still need to know that the
    // original apply is complete.  Do not resurrect it as pending; retain the
    // durable checkpoint identity strictly as an already-applied boundary.
    const priorCheckpointEditId = String(goal.restartCheckpoint?.devEditId || '').trim();
    const priorCompletedDevEdit = priorCheckpointEditId ? getDevSourceEditContinuation(priorCheckpointEditId) : null;
    const checkpointDevEdit = pendingDevEdit || (priorCompletedDevEdit?.status === 'complete' ? priorCompletedDevEdit : null);
    const restartProgress = [
      String(goal.progressSummary || '').trim(),
      `Planned restart checkpoint (${new Date(now).toISOString()}): ${reason}.`,
      checkpointDevEdit ? `Dev edit ${checkpointDevEdit.id}: status=${checkpointDevEdit.status}; verification=${checkpointDevEdit.lastVerification?.summary || '(none recorded)'}.` : '',
    ].filter(Boolean).join('\n').slice(-8000);
    const iterationNumber = Math.max(1, Number(goal.currentIteration || 0) || (goal.iterations?.length || 0) || 1);
    const iterations = [...(goal.iterations || [])];
    let iterationIndex = iterations.findIndex((item) => item.iterationNumber === iterationNumber);
    if (iterationIndex < 0) {
      iterations.push({
        iterationNumber,
        turnNumber: Number(resumablePlan?.turnNumber || goal.turnsUsed + 1),
        status: 'running',
        startedAt: Number(runtimeStartedAt || now) || now,
        updatedAt: now,
        restartCount: 0,
      });
      iterationIndex = iterations.length - 1;
    }
    iterations[iterationIndex] = {
      ...iterations[iterationIndex],
      status: 'restarting',
      updatedAt: now,
      restartCount: Number(iterations[iterationIndex].restartCount || 0) + 1,
    };
    return {
      ...startPause(goal, reason, now),
      status: 'restarting',
      turnsUsed: goal.turnsUsed,
      lastTurnAt: goal.lastTurnAt,
      lastVerdict: 'continue',
      lastReason: `Interrupted by ${reason}.`,
      progressSummary: restartProgress,
      failureReason: undefined,
      restartCheckpoint: {
        id: `goal_restart_${now}_${randomUUID().slice(0, 8)}`,
        reason,
        phase: 'interrupted',
        turnNumber: Number(resumablePlan?.turnNumber || goal.turnsUsed + 1),
        planId: resumablePlan?.id,
        activeStepIndex: resumablePlan?.activeIndex,
        runtimeStartedAt: Number(runtimeStartedAt || 0) || undefined,
        devEditId: checkpointDevEdit?.id,
        affectedFiles: checkpointDevEdit?.affectedFiles || checkpointDevEdit?.allowedFiles,
        changedSurfaces: checkpointDevEdit?.changedSurfaces,
        verificationSummary: checkpointDevEdit?.lastVerification?.summary,
        createdAt: now,
      },
      iterations: iterations.slice(-100),
      currentIteration: iterationNumber,
      updatedAt: now,
    };
  });
}

/**
 * Persist restart ownership for every currently active goal, including the
 * short idle gaps between autonomous turns when no live runtime exists yet.
 * Active runtime recovery calls the single-session helper too; that second
 * call is intentionally a no-op once the goal has entered `restarting`.
 */
export function recordActiveMainChatGoalsInterruptedForRestart(
  reason = 'gateway_restart',
): string[] {
  const checkpointed: string[] = [];
  for (const record of listMainChatGoalRecords()) {
    if ((record as any)?.current === false || String(record?.status || '') !== 'active') continue;
    const sessionId = String(record?.sessionId || '').trim();
    if (!sessionId) continue;
    const next = recordMainChatGoalInterruptedForRestart(sessionId, reason);
    if (next?.status === 'restarting' && next.restartCheckpoint) {
      // gracefulRestart flushed the initiating session before shutdown began.
      // This transition happens during shutdown, so persist it synchronously
      // rather than relying on the normal debounced session writer.
      flushSession(sessionId);
      checkpointed.push(sessionId);
    }
  }
  return Array.from(new Set(checkpointed));
}

/** Only an explicit live-apply step may be completed by planned-restart recovery. */
export function findMainChatGoalLiveApplyBoundaryStepIndex(steps: Array<Pick<MainChatGoalPlanStep, 'text'>> | null | undefined): number {
  return (Array.isArray(steps) ? steps : []).findIndex((step) => {
    const text = String(step?.text || '');
    return /\bprom_apply_dev_changes\b/i.test(text)
      || /\bapply\s+(?:the\s+)?(?:live\s+)?(?:dev\s+)?(?:changes?|edit|deployment)\b/i.test(text);
  });
}

export function finalizeMainChatGoalRestartRecovery(
  sessionId: string,
  input: {
    reason?: string;
    devEditId?: string;
    affectedFiles?: string[];
    changedSurfaces?: string[];
    verificationSummary?: string;
  } = {},
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || !goal.restartCheckpoint || !['restarting', 'paused'].includes(String(goal.status || ''))) return goal;
    // Boot recovery can be replayed by reconnecting lifecycle observers. Its
    // plan transition and durable progress entry are exactly-once effects.
    if (goal.restartCheckpoint.phase === 'boot_finalized') return goal;
    const now = Date.now();
    const planId = String(goal.restartCheckpoint.planId || '').trim();
    const plans = Array.isArray(goal.turnPlans) ? goal.turnPlans.map((plan) => ({ ...plan, steps: Array.isArray(plan.steps) ? plan.steps.map((step) => ({ ...step })) : [] })) : [];
    const plan = plans.find((item) => item.id === planId);
    if (plan?.steps?.length) {
      const applyIndex = findMainChatGoalLiveApplyBoundaryStepIndex(plan.steps);
      if (applyIndex >= 0) {
        plan.steps[applyIndex] = { ...plan.steps[applyIndex], status: 'done', note: 'Planned live apply completed; do not reapply.', updatedAt: now };
        const nextIndex = plan.steps.findIndex((step, index) => index > applyIndex && step.status !== 'done' && step.status !== 'skipped');
        if (nextIndex >= 0) {
          plan.activeIndex = nextIndex;
          plan.steps[nextIndex] = { ...plan.steps[nextIndex], status: 'in_progress', note: 'Post-restart verification required.', updatedAt: now };
        }
        plan.status = nextIndex >= 0 ? 'in_progress' : 'complete';
        plan.updatedAt = now;
      }
    }
    return {
      ...goal,
      status: 'restarting',
      pausedReason: input.reason || goal.pausedReason || goal.restartCheckpoint.reason,
      turnPlans: plans,
      progressSummary: [String(goal.progressSummary || '').trim(), `Restart recovered at ${new Date(now).toISOString()}; apply step reconciled atomically. Next: post-restart verification; do not reapply ${input.devEditId || goal.restartCheckpoint.devEditId || 'the completed dev edit'}.`].filter(Boolean).join('\n').slice(-8000),
      restartCheckpoint: {
        ...goal.restartCheckpoint,
        phase: 'boot_finalized',
        recoveryKind: 'planned',
        reason: input.reason || goal.restartCheckpoint.reason,
        devEditId: input.devEditId || goal.restartCheckpoint.devEditId,
        affectedFiles: input.affectedFiles?.length ? input.affectedFiles : goal.restartCheckpoint.affectedFiles,
        changedSurfaces: input.changedSurfaces?.length ? input.changedSurfaces : goal.restartCheckpoint.changedSurfaces,
        verificationSummary: input.verificationSummary || goal.restartCheckpoint.verificationSummary,
        recoveredAt: now,
      },
      updatedAt: now,
    };
  });
}

export function recordMainChatGoalRequirement(sessionId: string, text: string, source = 'user_amendment'): MainChatGoalState | null {
  const requirement = String(text || '').trim();
  if (!requirement || isMainChatGoalContinuation(requirement) || /^\/goal\b/i.test(requirement)) return getMainChatGoal(sessionId);
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || !['active', 'restarting', 'paused'].includes(String(goal.status || ''))) return goal;
    const normalized = requirement.replace(/\s+/g, ' ').trim();
    const existing = Array.isArray(goal.requirementsLedger) ? goal.requirementsLedger.slice(-79) : [];
    if (existing.some((item) => item.text.replace(/\s+/g, ' ').trim() === normalized)) return goal;
    existing.push({ id: `goal_requirement_${Date.now()}_${randomUUID().slice(0, 6)}`, text: normalized.slice(0, 2400), at: Date.now(), source });
    return { ...goal, requirementsLedger: existing, updatedAt: Date.now() };
  });
}

function formatGoalRequirements(goal: MainChatGoalState, max = 20): string {
  const rows = Array.isArray(goal.requirementsLedger) ? goal.requirementsLedger.slice(-max) : [];
  return rows.length ? rows.map((item, index) => `${index + 1}. ${oneLine(item.text, 500)}${item.source ? ` (${item.source})` : ''}`).join('\n') : '(none recorded)';
}

export function finalizeMainChatGoalCrashRecovery(
  sessionId: string,
  input: {
    reason?: string;
    recoveredAt?: number;
  } = {},
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || !goal.restartCheckpoint || !['restarting', 'paused'].includes(String(goal.status || ''))) return goal;
    const now = Number(input.recoveredAt || Date.now()) || Date.now();
    const reason = String(input.reason || 'gateway_crash').trim() || 'gateway_crash';
    const devEditId = goal.restartCheckpoint.devEditId;
    const coordinatedEdit = getCoordinatedDevEdit(devEditId, sessionId);
    const touchedFiles = coordinatedEdit?.touchedFiles || goal.restartCheckpoint.touchedFiles || [];
    const checkpointFiles = goal.restartCheckpoint.affectedFiles || [];
    const recoveryDirective = [
      'The gateway restarted unexpectedly before the current changes were verified or applied.',
      devEditId ? `Resume the existing dev edit ${devEditId}; do not create a duplicate edit for the same work.` : '',
      touchedFiles.length
        ? `Reread the files known to have been touched before editing further: ${touchedFiles.join(', ')}.`
        : checkpointFiles.length
          ? `Partial edits may exist. Reread the checkpoint file list before any further mutation: ${checkpointFiles.join(', ')}.`
          : 'Partial edits may exist. Reread the relevant source and persisted work state before any further mutation.',
      'Reconcile the persisted partial work, finish the intended changes, run the required verification, and only then use the normal apply/restart path.',
    ].filter(Boolean).join(' ');
    return {
      ...goal,
      status: 'restarting',
      pausedReason: 'gateway_crash',
      lastVerdict: 'continue',
      lastReason: `Recovered after an unexpected gateway restart (${reason}); changes were not yet verified or applied.`,
      nextStepDirective: recoveryDirective,
      restartCheckpoint: {
        ...goal.restartCheckpoint,
        phase: 'crash_recovered',
        recoveryKind: 'crash',
        reason,
        touchedFiles,
        recoveredAt: now,
      },
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

export function snapshotMainChatGoal(sessionId: string): MainChatGoalState | null {
  const goal = getMainChatGoal(sessionId);
  return goal ? cloneGoal(goal) : null;
}
