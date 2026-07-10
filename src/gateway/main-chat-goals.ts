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
  type MainChatGoalPlanStep,
  type MainChatGoalState,
  type MainChatGoalTurnPlan,
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
    pauseStartedAt: undefined,
    pausedMs: 0,
    createdAt: now,
    updatedAt: now,
    turnPlans: [],
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

function compactTextArray(input: any, maxItems = 12, maxChars = 360): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => oneLine(String(item || ''), maxChars))
    .filter((item) => {
      if (!item) return false;
      const normalized = item.replace(/[\s._-]+/g, ' ').trim().toLowerCase();
      if (!normalized) return false;
      if (/^(?:none|no|n\/a|na|null|undefined|\[\]|not applicable|no gaps|no issues|no blockers)$/.test(normalized)) return false;
      if (/^no (?:known |remaining |unresolved )?(?:issues|gaps|verification gaps|missing acceptance criteria|unresolved issues|blockers|defects)\.?$/.test(normalized)) return false;
      return true;
    })
    .slice(0, maxItems);
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
      if (!['paused', 'blocked', 'failed'].includes(status) && !goalPauseStartedAt(goal) && String(goal.lastVerdict || '') !== 'failed') {
        return goal;
      }
      return {
        ...endPause({ ...goal, status: 'active' }, now),
        status: 'active',
        pausedReason: undefined,
        blockedReason: undefined,
        failureReason: undefined,
        consecutiveRuntimeFailures: 0,
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
      return {
        ...goal,
        ...finalizePause(goal, now),
        status: 'done',
        lastVerdict: 'done',
        lastReason: note || 'Marked done by user.',
        completedAt: now,
        updatedAt: now,
      };
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

export function recordMainChatGoalTurnPlanProgress(
  sessionId: string,
  progress: {
    source?: string;
    reason?: string;
    activeIndex?: number;
    items?: Array<{ id?: string; text?: string; status?: string; note?: string }>;
  },
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.status !== 'active') return goal;
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

function parseGoalJudgeJsonCandidate(candidate: string): any | null {
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
  const direct = parseGoalJudgeJsonCandidate(unfenced);
  if (direct) return direct;
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return parseGoalJudgeJsonCandidate(match[0]);
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

function formatGoalTurnPlans(goal: MainChatGoalState): string {
  const plans = Array.isArray(goal.turnPlans) ? goal.turnPlans.slice(-8) : [];
  if (!plans.length) return '(none)';
  return plans.map((plan) => {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const stepLines = steps.map((step, index) => `  ${index + 1}. [${step.status || 'pending'}] ${oneLine(step.text, 180)}${step.note ? ` | evidence: ${oneLine(step.note, 220)}` : ''}`);
    return [
      `Turn ${plan.turnNumber} (${plan.status || 'planned'}, source=${plan.source || 'unknown'})`,
      ...stepLines,
      plan.judgeReason ? `  judge: ${oneLine(plan.judgeReason, 260)}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');
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

function reopenPlanStepAfterContinue(plan: MainChatGoalTurnPlan, judge: MainChatGoalJudgeResult, now: number): MainChatGoalTurnPlan {
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
    'Return exactly one JSON object with keys: status, reason, directive, confidence, quality_grade, unresolved_issues, missing_acceptance_criteria, verification_gaps, evidence.',
    'status must be one of: done, continue, blocked.',
    'Use done only when the actual requested outcome is complete, usable, and backed by direct evidence in chat, tool observations, live verification, or assistant response.',
    'Source/file writes, patch success, build success, and a final assistant summary are evidence that work happened. They are NOT sufficient by themselves for done.',
    'For coding/build/app/game goals, done requires all requested acceptance criteria to be met or explicitly out of scope, no known unresolved user-reported defects, no current console/runtime/build errors, and verification appropriate to the artifact.',
    'For UI/frontend/mobile/game goals, require evidence that the artifact was opened or run, core interactions were tested, the UI was not blank/broken, and errors after load/interactions were addressed.',
    'If the result is functional but rough, missing expected polish, missing planned features, has inverted/broken controls, has console errors, or has unverified core paths, choose continue. "Done but not good enough" means continue.',
    'Use blocked only when work cannot continue without user input, credentials, approval, an unavailable external system, or a hard policy/tool constraint.',
    'Use continue for partial progress, insufficient verification, weak quality, unresolved defects, missing acceptance criteria, or unclear evidence.',
    'The directive field is the instruction that will be given to the next worker turn. Make it concrete, imperative, and focused on the next missing work. Do not ask the user unless status is blocked.',
    'quality_grade is A, B, C, D, or F. Only A/B with no unresolved issues, no missing acceptance criteria, and no verification gaps may be done.',
    'If the goal is complete and verified, return status="done", quality_grade="B" or "A", and empty arrays for unresolved_issues, missing_acceptance_criteria, and verification_gaps. Do not carry forward stale gaps from earlier turns after the latest turn fixed or verified them.',
    'If you choose continue, name exactly what still needs to be done or verified. Do not continue just because more polish is possible unless the original goal requires that polish.',
    'unresolved_issues, missing_acceptance_criteria, verification_gaps, and evidence must be arrays of short strings.',
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
    '[GOAL_TURN_PLANS]',
    formatGoalTurnPlans(goal).slice(0, 5000),
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
    const qualityGrade = oneLine(String(parsed.quality_grade || parsed.qualityGrade || ''), 12).toUpperCase();
    const unresolvedIssues = compactTextArray(parsed.unresolved_issues ?? parsed.unresolvedIssues);
    const missingAcceptanceCriteria = compactTextArray(parsed.missing_acceptance_criteria ?? parsed.missingAcceptanceCriteria);
    const verificationGaps = compactTextArray(parsed.verification_gaps ?? parsed.verificationGaps);
    const evidence = compactTextArray(parsed.evidence);
    const hasBlockingGaps = unresolvedIssues.length > 0 || missingAcceptanceCriteria.length > 0 || verificationGaps.length > 0;
    const completionEvidenceText = [
      reason,
      directive,
      ...evidence,
      response.slice(0, 2000),
      toolLog.slice(0, 2000),
    ].join(' ').toLowerCase();
    const hasCompletionEvidence = evidence.length > 0
      || /\b(done|complete|completed|implemented|created|wrote|built|fixed|verified|tested|opened|ran|passed|working|artifact|file|screenshot|no errors|successful)\b/.test(completionEvidenceText);
    const qualityAllowsDone = ['A', 'B'].includes(qualityGrade)
      || (!qualityGrade && confidence >= 0.45 && hasCompletionEvidence);
    const strictStatus = status === 'done' && (hasBlockingGaps || !qualityAllowsDone)
      ? 'continue'
      : status;
    const strictReason = strictStatus !== status
      ? oneLine(`Judge requested done, but strict completion gate found ${hasBlockingGaps ? 'remaining issues/gaps' : `insufficient completion evidence or low quality grade (${qualityGrade || 'missing'})`}. ${reason}`, 700)
      : reason;
    return {
      status: strictStatus,
      reason: strictReason,
      directive: normalizeJudgeDirective(parsed, strictStatus, strictReason),
      confidence,
      parseFailed: false,
      qualityGrade,
      unresolvedIssues,
      missingAcceptanceCriteria,
      verificationGaps,
      evidence,
    };
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
  const nextTurn = Number(goal.turnsUsed || 0) + 1;
  const resumablePlan = findResumableGoalTurnPlan(goal);
  const resumableSteps = Array.isArray(resumablePlan?.steps) ? resumablePlan.steps : [];
  const planInstruction = resumablePlan
    ? [
        `This is autonomous goal turn ${Number(resumablePlan.turnNumber) || nextTurn}, resuming an interrupted unfinished turn plan.`,
        'Do NOT call declare_plan at the start. The stored plan is already active in the progress UI. Continue at the first step that is not done/skipped, call complete_plan_step with concrete evidence as each step finishes, and only declare a replacement plan if the stored plan is obsolete or impossible.',
        '',
        'Stored active turn plan:',
        ...resumableSteps.map((step, index) => `${index + 1}. [${step.status || 'pending'}] ${oneLine(step.text, 220)}${step.note ? ` | evidence: ${oneLine(step.note, 260)}` : ''}`),
      ].join('\n')
    : `This is autonomous goal turn ${nextTurn}. Start by calling declare_plan with 2-6 concrete steps for this turn, then execute the plan. Keep each step in_progress until it is truly done and call complete_plan_step with concrete evidence after each completed step. Do not reuse a previous judged turn plan; make a fresh plan for this turn based on current remaining work.`;
  return [
    CONTINUATION_HEADER,
    '',
    'Goal:',
    goal.goal,
    '',
    planInstruction,
    '',
    'Tool routing:',
    'This autonomous goal turn uses the normal main-chat tool route. Core tools such as request_tool_category, skill_list, skill_read, and declare_plan are available; complete_plan_step is injected after declare_plan or when a stored manual plan is resumed. If the current step needs tools that are not currently visible, call request_tool_category with the right category before describing tool use. For workspace files/directories/builds/games, use request_tool_category({"category":"workspace_write","scope":"turn"}) when workspace_read/workspace_edit/workspace_run tools are needed. Do not narrate or claim a tool call unless you actually call the tool.',
    '',
    'Judge message:',
    goal.nextStepDirective || '(No judge message yet. Infer the next concrete step from the goal and chat context.)',
    '',
    'Last judge reason:',
    goal.lastReason || '(No judge reason yet.)',
    '',
    'Progress so far:',
    goal.progressSummary || '(No compacted progress summary yet.)',
  ].join('\n');
}

export function applyMainChatGoalJudgeResult(
  sessionId: string,
  expectedGoalId: string,
  judge: MainChatGoalJudgeResult,
): MainChatGoalState | null {
  return updateMainChatGoal(sessionId, (goal) => {
    if (!goal || goal.id !== expectedGoalId || goal.status !== 'active') return goal;
    const now = Date.now();
    const consecutiveJudgeFailures = judge.parseFailed ? goal.consecutiveJudgeFailures + 1 : 0;
    const resumablePlan = findResumableGoalTurnPlan(goal);
    const turnNumber = Number(resumablePlan?.turnNumber || 0) || goal.turnsUsed + 1;
    const nextTurnsUsed = Math.max(goal.turnsUsed, turnNumber);
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
    return {
      ...startPause(goal, reason, now),
      status: 'paused',
      turnsUsed: goal.turnsUsed,
      lastTurnAt: goal.lastTurnAt,
      lastVerdict: 'continue',
      lastReason: `Interrupted by ${reason}.`,
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
