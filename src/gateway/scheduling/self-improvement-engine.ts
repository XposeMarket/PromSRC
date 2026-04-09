/**
 * self-improvement-engine.ts — Phase 7: Continuous Self-Improvement Engine
 *
 * The end-state system. Runs weekly performance reviews, identifies patterns,
 * proposes skill improvements, builds a prompt library, and tracks model quality.
 *
 * This is the culmination of all other phases — it requires:
 *   - schedule-memory (run summaries to analyze)
 *   - prompt-mutation state (version history)
 *   - error-watchdog (failure patterns)
 *   - managed-teams (team performance data)
 *   - goal-decomposer (goal completion rates)
 *
 * Weekly review job: every Sunday, reads ALL run histories, categorizes
 * successes/failures, computes efficiency metrics, and produces:
 *   1. A performance report → delivered to user via Telegram/web
 *   2. Proposed skill evolutions → new SKILL.md files for recurring patterns
 *   3. Prompt library updates → proven patterns extracted from successful runs
 *   4. Model recommendations → flag task types that consistently fail
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { loadScheduleMemory, loadRunLog, aggregateStructuredStats, type StructuredStats } from './schedule-memory';
import { loadMutationState, getMutationVersion } from './prompt-mutation';
import { loadWatchdogState, getErrorWatchdogSummary } from '../errors/error-watchdog';
import { listGoals } from '../goal-decomposer';
import type { CronJob } from './cron-scheduler';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TaskPerformanceMetric {
  scheduleId: string;
  jobName: string;
  totalRuns: number;
  successRate: number;          // 0-1
  avgStepCount: number;
  promptVersion: number;
  improvementTrend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
  topFailureReasons: string[];
  recommendedAction: 'none' | 'mutate_prompt' | 'retrain_skill' | 'change_model' | 'investigate';
}

export interface PerformanceReport {
  id: string;
  generatedAt: string;          // ISO timestamp
  periodStart: string;
  periodEnd: string;
  overallSuccessRate: number;
  totalTaskRuns: number;
  totalScheduledJobs: number;
  metrics: TaskPerformanceMetric[];
  topInsights: string[];
  proposedActions: ProposedAction[];
  skillEvolutions: SkillEvolution[];
  promptLibraryUpdates: PromptLibraryEntry[];
  modelRecommendations: ModelRecommendation[];
}

export interface ProposedAction {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'skill_update' | 'prompt_mutation' | 'model_change' | 'new_schedule' | 'investigation';
  title: string;
  description: string;
  affectedScheduleId?: string;
  affectedJobName?: string;
  estimatedImpact: string;
  approved?: boolean;
  approvedAt?: string;
}

export interface SkillEvolution {
  id: string;
  discoveredAt: string;
  patternName: string;
  description: string;
  sourceScheduleIds: string[];
  proposedSkillContent: string;  // new SKILL.md content
  proposedSkillPath: string;     // where to write it
  approved?: boolean;
}

export interface PromptLibraryEntry {
  id: string;
  addedAt: string;
  category: string;              // e.g. "browser_navigation", "tweet_posting", "research"
  pattern: string;               // the proven prompt pattern
  sourceScheduleIds: string[];   // which jobs this was extracted from
  successRate: number;
  useCount: number;
}

export interface ModelRecommendation {
  taskType: string;
  currentModel: string;
  issue: string;
  recommendation: string;
  supportingEvidence: string[];
}

export interface BehaviorChangelogEntry {
  date: string;           // ISO date YYYY-MM-DD
  change: string;         // what was changed (e.g. "Added retry logic to X poster")
  reason: string;         // why (e.g. "network errors causing 40% failure rate")
  jobId?: string;         // which schedule it affects
  jobName?: string;
  expectedImpact?: string; // e.g. "reduce network failures by ~50%"
}

export interface SelfImprovementStore {
  reports: PerformanceReport[];
  promptLibrary: PromptLibraryEntry[];
  pendingSkillEvolutions: SkillEvolution[];
  pendingProposedActions: ProposedAction[];
  behaviorChangelog: BehaviorChangelogEntry[]; // tracks improvements so we can connect them to success rate changes
  lastRunAt: string | null;
  updatedAt: number;
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

function getSelfImprovementDir(): string {
  let base: string;
  try {
    base = getConfig().getConfigDir();
  } catch {
    base = path.join(process.cwd(), '.prometheus');
  }
  const dir = path.join(base, 'self-improvement');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getSelfImprovementDir(), 'store.json');
}

function getReportPath(reportId: string): string {
  return path.join(getSelfImprovementDir(), `report_${reportId}.json`);
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export function loadSelfImprovementStore(): SelfImprovementStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) {
    return {
      reports: [],
      promptLibrary: [],
      pendingSkillEvolutions: [],
      pendingProposedActions: [],
      behaviorChangelog: [],
      lastRunAt: null,
      updatedAt: Date.now(),
    };
  }
  try {
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as SelfImprovementStore;
    // Backfill changelog if missing from older store
    if (!stored.behaviorChangelog) stored.behaviorChangelog = [];
    return stored;
  } catch {
    return {
      reports: [],
      promptLibrary: [],
      pendingSkillEvolutions: [],
      pendingProposedActions: [],
      behaviorChangelog: [],
      lastRunAt: null,
      updatedAt: Date.now(),
    };
  }
}

function saveSelfImprovementStore(store: SelfImprovementStore): void {
  store.updatedAt = Date.now();
  // Keep only last 10 report IDs in store (full reports are saved individually)
  store.reports = store.reports.slice(-10);
  const tmp = `${getStorePath()}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, getStorePath());
}

// ─── Data Collection ───────────────────────────────────────────────────────────

interface RawRunData {
  scheduleId: string;
  jobName: string;
  runs: Array<{
    success: boolean;
    stepCount: number;
    summary: string;
    error?: string;
    completedAt: number;
  }>;
  currentPromptVersion: number;
  learnedContext: string[];
  notes: Record<string, string>;
}

function collectRunDataForPeriod(
  jobs: CronJob[],
  periodStartMs: number,
  periodEndMs: number,
): RawRunData[] {
  const results: RawRunData[] = [];

  for (const job of jobs) {
    const scheduleId = job.id;
    const runLog = loadRunLog(scheduleId);
    const mem = loadScheduleMemory(scheduleId);

    // Filter runs within the period
    const periodRuns = runLog.runs.filter(r => {
      const ts = r.completedAt || r.startedAt;
      return ts >= periodStartMs && ts <= periodEndMs;
    });

    if (periodRuns.length === 0 && (!mem || mem.runSummaries.length === 0)) continue;

    // Map to normalized format
    const normalizedRuns = periodRuns.map(r => ({
      success: r.status === 'complete',
      stepCount: 0, // will be populated from run summaries if available
      summary: r.summary || '',
      error: r.errorIfAny,
      completedAt: r.completedAt || r.startedAt,
    }));

    // Supplement with run summaries from schedule memory (they have step counts)
    const summaries = (mem?.runSummaries || []).filter(s =>
      s.completedAt >= periodStartMs && s.completedAt <= periodEndMs
    );
    for (let i = 0; i < normalizedRuns.length; i++) {
      const matching = summaries.find(s => Math.abs(s.completedAt - normalizedRuns[i].completedAt) < 60000);
      if (matching) {
        normalizedRuns[i].stepCount = matching.stepCount;
      }
    }

    // Include older summary data if not enough period data
    if (normalizedRuns.length < 3 && mem?.runSummaries && mem.runSummaries.length > 0) {
      const olderSummaries = mem.runSummaries.slice(-10).map(s => ({
        success: s.success,
        stepCount: s.stepCount,
        summary: s.summary,
        error: s.errorIfAny,
        completedAt: s.completedAt,
      }));
      // Merge without duplicates
      for (const s of olderSummaries) {
        if (!normalizedRuns.find(r => Math.abs(r.completedAt - s.completedAt) < 60000)) {
          normalizedRuns.push(s);
        }
      }
    }

    results.push({
      scheduleId,
      jobName: job.name,
      runs: normalizedRuns,
      currentPromptVersion: getMutationVersion(scheduleId),
      learnedContext: mem?.learnedContext || [],
      notes: mem?.notes || {},
    });
  }

  return results;
}

// ─── Metric Computation ────────────────────────────────────────────────────────

function computeMetrics(rawData: RawRunData[]): TaskPerformanceMetric[] {
  return rawData.map(data => {
    const { runs } = data;
    if (runs.length === 0) {
      return {
        scheduleId: data.scheduleId,
        jobName: data.jobName,
        totalRuns: 0,
        successRate: 0,
        avgStepCount: 0,
        promptVersion: data.currentPromptVersion,
        improvementTrend: 'insufficient_data' as const,
        topFailureReasons: [],
        recommendedAction: 'none' as const,
      };
    }

    const successCount = runs.filter(r => r.success).length;
    const successRate = successCount / runs.length;

    const stepsWithData = runs.filter(r => r.stepCount > 0);
    const avgStepCount = stepsWithData.length > 0
      ? stepsWithData.reduce((sum, r) => sum + r.stepCount, 0) / stepsWithData.length
      : 0;

    // Detect trend: compare first half vs second half success rates
    const half = Math.floor(runs.length / 2);
    let trend: TaskPerformanceMetric['improvementTrend'] = 'insufficient_data';
    if (runs.length >= 4) {
      const firstHalfRate = runs.slice(0, half).filter(r => r.success).length / half;
      const secondHalfRate = runs.slice(half).filter(r => r.success).length / (runs.length - half);
      const diff = secondHalfRate - firstHalfRate;
      if (diff > 0.15) trend = 'improving';
      else if (diff < -0.15) trend = 'degrading';
      else trend = 'stable';
    }

    // Collect failure reasons
    const failures = runs.filter(r => !r.success && r.error);
    const errorCounts = new Map<string, number>();
    for (const f of failures) {
      const key = (f.error || 'unknown').slice(0, 80);
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    const topFailureReasons = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason);

    // Determine recommended action
    let recommendedAction: TaskPerformanceMetric['recommendedAction'] = 'none';
    if (successRate < 0.5 && runs.length >= 3) {
      recommendedAction = 'investigate';
    } else if (trend === 'degrading' && runs.length >= 4) {
      recommendedAction = 'mutate_prompt';
    } else if (avgStepCount > 15 && data.currentPromptVersion === 0) {
      // High step count with no prompt mutations yet → good candidate
      recommendedAction = 'mutate_prompt';
    } else if (successRate < 0.7 && runs.length >= 5) {
      recommendedAction = 'retrain_skill';
    }

    return {
      scheduleId: data.scheduleId,
      jobName: data.jobName,
      totalRuns: runs.length,
      successRate,
      avgStepCount,
      promptVersion: data.currentPromptVersion,
      improvementTrend: trend,
      topFailureReasons,
      recommendedAction,
    };
  });
}

// ─── LLM-Powered Insight Generation ───────────────────────────────────────────

function buildInsightGenerationPrompt(
  metrics: TaskPerformanceMetric[],
  errorSummary: ReturnType<typeof getErrorWatchdogSummary>,
  goalsSummary: string,
  periodDays: number,
  structuredStats: StructuredStats[],
  behaviorChangelog: BehaviorChangelogEntry[],
): string {
  // Job inventory with structured stats
  const jobInventory = metrics.map(m => {
    const ss = structuredStats.find(s => s.jobId === m.scheduleId);
    const wow = ss?.weekOverWeekDelta != null
      ? ` (${ss.weekOverWeekDelta >= 0 ? '+' : ''}${(ss.weekOverWeekDelta * 100).toFixed(0)}% vs last week)`
      : '';
    const errorBreakdown = ss?.errorTypes && Object.keys(ss.errorTypes).length > 0
      ? ' | errors: ' + Object.entries(ss.errorTypes).map(([t, n]) => `${t}=${n}`).join(', ')
      : '';
    const metrics2 = ss?.keyMetricAggregates && Object.keys(ss.keyMetricAggregates).length > 0
      ? ' | ' + Object.entries(ss.keyMetricAggregates).map(([k, v]) => `${k}=${v}`).join(', ')
      : '';
    const avgAttempts = ss?.avgAttempts && ss.avgAttempts > 1.1 ? ` | avg_attempts=${ss.avgAttempts.toFixed(1)}` : '';
    return `- ${m.jobName}: runs=${m.totalRuns}, success=${(m.successRate * 100).toFixed(0)}%${wow}, steps=${m.avgStepCount.toFixed(1)}${errorBreakdown}${metrics2}${avgAttempts}, trend=${m.improvementTrend}`;
  }).join('\n');

  // Recent behavior changes with their expected impact
  const changelogText = behaviorChangelog.length > 0
    ? behaviorChangelog.slice(-10).map(c =>
        `  [${c.date}] ${c.change} — reason: ${c.reason}${c.expectedImpact ? ` — expected: ${c.expectedImpact}` : ''}`
      ).join('\n')
    : '  (no behavior changes recorded yet)';

  return `You are the Prometheus agent analyzing your own performance over the last ${periodDays} days.

STRUCTURED JOB INVENTORY (${metrics.length} jobs):
${jobInventory || '(no scheduled tasks with run data)'}

ERROR WATCHDOG:
- Unique errors tracked: ${errorSummary.totalTracked}
- Source code errors: ${errorSummary.sourceErrors}
- Recurring errors (3+ times): ${errorSummary.recurring}
- Repairs proposed: ${errorSummary.repairsProposed}

ACTIVE GOALS:
${goalsSummary || '(no active goals)'}

RECENT BEHAVIOR CHANGES (changelog of improvements I've made):
${changelogText}

Your task: produce a structured weekly performance report following this EXACT template:

1. TOP 3 ISSUES this week (most impactful problems, with specific numbers)
2. TOP 3 IMPROVEMENTS implemented (connect to behavior changelog above; note if they measurably changed success rates)
3. JOB PERFORMANCE SUMMARY (for each job: run count, success rate, trend, top error if any)
4. PROPOSED SKILL EVOLUTIONS (new learnable patterns observed)
5. NEXT WEEK PRIORITIES (top 3 things to fix or build)

Return ONLY valid JSON:
{
  "top_insights": [
    "Issue 1: [job name] — [specific problem with numbers]",
    "Issue 2: ...",
    "Issue 3: ..."
  ],
  "top_improvements": [
    "Improvement 1: [what changed] — [measurable impact if known]",
    "Improvement 2: ..."
  ],
  "next_week_priorities": [
    "Priority 1: [concrete action]",
    "Priority 2: ...",
    "Priority 3: ..."
  ],
  "skill_evolution_opportunities": [
    {
      "pattern_name": "Short descriptive name",
      "description": "What recurring pattern was observed",
      "affected_task_names": ["job name 1"],
      "proposed_skill_content": "# Skill Name\\n\\n## When to use\\n...\\n## Steps\\n..."
    }
  ],
  "behavior_changelog_entries": [
    {
      "change": "Description of what changed",
      "reason": "Why it was changed (what problem it solves)",
      "job_name": "Job name or 'all'",
      "expected_impact": "Expected measurable improvement"
    }
  ],
  "model_recommendations": [
    {
      "task_type": "Type of task",
      "issue": "Specific problem observed",
      "recommendation": "What to do about it"
    }
  ]
}`;
}

// ─── Behavior Changelog ───────────────────────────────────────────────────────

export function addBehaviorChangelogEntry(entry: Omit<BehaviorChangelogEntry, 'date'>): void {
  const store = loadSelfImprovementStore();
  store.behaviorChangelog = store.behaviorChangelog || [];
  store.behaviorChangelog.push({
    date: new Date().toISOString().split('T')[0],
    ...entry,
  });
  // Keep last 100 entries
  store.behaviorChangelog = store.behaviorChangelog.slice(-100);
  saveSelfImprovementStore(store);
}

// ─── Main Weekly Review Function ──────────────────────────────────────────────

export async function runWeeklyPerformanceReview(
  jobs: CronJob[],
  handleChat: (
    message: string,
    sessionId: string,
    sendSSE: (event: string, data: any) => void,
    pinnedMessages?: Array<{ role: string; content: string }>,
    abortSignal?: { aborted: boolean },
    callerContext?: string,
    modelOverride?: string,
    executionMode?: 'interactive' | 'background_task' | 'heartbeat' | 'cron',
  ) => Promise<{ type: string; text: string }>,
  broadcastReport: (report: PerformanceReport) => void,
): Promise<PerformanceReport> {
  const reportId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const periodDays = 7;
  const periodStart = now - periodDays * 24 * 60 * 60 * 1000;

  console.log(`[SelfImprovement] Starting weekly performance review (report ${reportId})`);

  // 1. Collect raw run data for the past 7 days
  const rawData = collectRunDataForPeriod(jobs, periodStart, now);
  console.log(`[SelfImprovement] Collected data for ${rawData.length} scheduled jobs`);

  // 2. Compute objective metrics
  const metrics = computeMetrics(rawData);

  // 3. Get error watchdog summary
  const errorSummary = getErrorWatchdogSummary();

  // 4. Get goals summary
  const activeGoals = listGoals({ status: ['active'] });
  const goalsSummary = activeGoals.map(g =>
    `${g.title}: ${g.subTasks.filter(st => st.status === 'active').length}/${g.subTasks.length} sub-tasks active`
  ).join('\n');

  // 5. LLM analysis for insights, skill evolutions, model recommendations
  let topInsights: string[] = [];
  let skillEvolutions: SkillEvolution[] = [];
  let modelRecommendations: ModelRecommendation[] = [];

  // Gather structured observability stats (richer than raw run data)
  const structuredStats = jobs.map(job =>
    aggregateStructuredStats(job.id, periodStart, now)
  ).filter((s): s is NonNullable<typeof s> => s !== null);

  // Load behavior changelog for week-over-week context
  const store0 = loadSelfImprovementStore();
  const analysisPrompt = buildInsightGenerationPrompt(
    metrics, errorSummary, goalsSummary, periodDays,
    structuredStats,
    store0.behaviorChangelog || [],
  );

  try {
    const result = await handleChat(
      analysisPrompt,
      `self_improvement_review_${reportId}`,
      () => {},
      undefined,
      undefined,
      '[SYSTEM: You are a performance analyst. Return ONLY valid JSON. No markdown, no explanation.]',
      undefined,
      'background_task',
    );

    const responseText = String(result?.text || '').trim();
    const clean = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(clean);

    topInsights = Array.isArray(parsed.top_insights)
      ? parsed.top_insights.map((s: any) => String(s).slice(0, 300))
      : [];

    // Top improvements and next week priorities — store as insights with prefix tags
    if (Array.isArray(parsed.top_improvements)) {
      for (const imp of parsed.top_improvements) {
        topInsights.push(`✅ ${String(imp).slice(0, 280)}`);
      }
    }
    if (Array.isArray(parsed.next_week_priorities)) {
      for (const p of parsed.next_week_priorities) {
        topInsights.push(`🎯 Next: ${String(p).slice(0, 260)}`);
      }
    }

    // Auto-add behavior changelog entries the agent proposed
    if (Array.isArray(parsed.behavior_changelog_entries)) {
      const store = loadSelfImprovementStore();
      for (const entry of parsed.behavior_changelog_entries.slice(0, 5)) {
        if (!entry.change) continue;
        store.behaviorChangelog = store.behaviorChangelog || [];
        store.behaviorChangelog.push({
          date: new Date().toISOString().split('T')[0],
          change: String(entry.change).slice(0, 200),
          reason: String(entry.reason || '').slice(0, 200),
          jobName: entry.job_name || undefined,
          expectedImpact: entry.expected_impact ? String(entry.expected_impact).slice(0, 150) : undefined,
        });
      }
      store.behaviorChangelog = (store.behaviorChangelog || []).slice(-100);
      saveSelfImprovementStore(store);
    }

    // Process skill evolution opportunities
    if (Array.isArray(parsed.skill_evolution_opportunities)) {
      for (const opp of parsed.skill_evolution_opportunities) {
        if (!opp.pattern_name || !opp.proposed_skill_content) continue;

        const skillId = `skill_evo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const safeName = opp.pattern_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const skillPath = `workspace/.prometheus/evolved-skills/${safeName}.md`;

        skillEvolutions.push({
          id: skillId,
          discoveredAt: new Date().toISOString(),
          patternName: opp.pattern_name,
          description: opp.description || '',
          sourceScheduleIds: rawData
            .filter(d => (opp.affected_task_names || []).some((n: string) =>
              d.jobName.toLowerCase().includes(n.toLowerCase())
            ))
            .map(d => d.scheduleId),
          proposedSkillContent: String(opp.proposed_skill_content).slice(0, 3000),
          proposedSkillPath: skillPath,
          approved: false,
        });
      }
    }

    // Model recommendations
    if (Array.isArray(parsed.model_recommendations)) {
      for (const rec of parsed.model_recommendations) {
        modelRecommendations.push({
          taskType: String(rec.task_type || ''),
          currentModel: 'configured default',
          issue: String(rec.issue || ''),
          recommendation: String(rec.recommendation || ''),
          supportingEvidence: [],
        });
      }
    }
  } catch (err: any) {
    console.warn(`[SelfImprovement] LLM analysis failed:`, err.message);
    // Fallback: generate basic insights from metrics alone
    topInsights = generateFallbackInsights(metrics, errorSummary);
  }

  // 6. Generate proposed actions from metrics
  const proposedActions = generateProposedActions(metrics, skillEvolutions);

  // 7. Extract prompt library entries from successful runs
  const promptLibraryUpdates = extractPromptLibraryEntries(rawData, metrics);

  // 8. Compute overall stats
  const totalRuns = metrics.reduce((sum, m) => sum + m.totalRuns, 0);
  const overallSuccessRate = totalRuns > 0
    ? metrics.reduce((sum, m) => sum + m.successRate * m.totalRuns, 0) / totalRuns
    : 0;

  // 9. Assemble final report
  const report: PerformanceReport = {
    id: reportId,
    generatedAt: new Date().toISOString(),
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(now).toISOString(),
    overallSuccessRate,
    totalTaskRuns: totalRuns,
    totalScheduledJobs: jobs.length,
    metrics,
    topInsights,
    proposedActions,
    skillEvolutions,
    promptLibraryUpdates,
    modelRecommendations,
  };

  // 10. Save report
  fs.writeFileSync(getReportPath(reportId), JSON.stringify(report, null, 2), 'utf-8');

  // 11. Update store
  const store = loadSelfImprovementStore();
  store.reports.push(report);
  store.pendingSkillEvolutions = [...store.pendingSkillEvolutions, ...skillEvolutions].slice(-20);
  store.pendingProposedActions = [...store.pendingProposedActions, ...proposedActions].slice(-50);
  store.promptLibrary = mergePromptLibrary(store.promptLibrary, promptLibraryUpdates);
  store.behaviorChangelog = store.behaviorChangelog || [];
  store.lastRunAt = new Date().toISOString();
  saveSelfImprovementStore(store);

  // 12. Broadcast report to web UI
  broadcastReport(report);

  console.log(`[SelfImprovement] Weekly review complete: ${totalRuns} runs analyzed, ${topInsights.length} insights, ${skillEvolutions.length} skill evolutions proposed`);

  return report;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateFallbackInsights(
  metrics: TaskPerformanceMetric[],
  errorSummary: ReturnType<typeof getErrorWatchdogSummary>,
): string[] {
  const insights: string[] = [];

  const degrading = metrics.filter(m => m.improvementTrend === 'degrading');
  if (degrading.length > 0) {
    insights.push(`${degrading.length} task(s) show degrading performance trends: ${degrading.map(m => m.jobName).join(', ')}`);
  }

  const highStepCount = metrics.filter(m => m.avgStepCount > 15 && m.promptVersion === 0);
  if (highStepCount.length > 0) {
    insights.push(`${highStepCount.length} task(s) use many steps (avg >15) and haven't had prompt mutation yet — good candidates for optimization`);
  }

  if (errorSummary.recurring > 0) {
    insights.push(`${errorSummary.recurring} recurring error pattern(s) detected — same errors appearing 3+ times, consider self-repair proposals`);
  }

  const highSuccess = metrics.filter(m => m.successRate >= 0.9 && m.totalRuns >= 5);
  if (highSuccess.length > 0) {
    insights.push(`${highSuccess.length} task(s) running with 90%+ success rate — their prompts are strong candidates for the prompt library`);
  }

  if (insights.length === 0) {
    insights.push('Insufficient data for insights — need more run history. Keep running scheduled tasks.');
  }

  return insights;
}

function generateProposedActions(
  metrics: TaskPerformanceMetric[],
  skillEvolutions: SkillEvolution[],
): ProposedAction[] {
  const actions: ProposedAction[] = [];

  for (const m of metrics) {
    if (m.recommendedAction === 'none') continue;

    const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

    if (m.recommendedAction === 'mutate_prompt') {
      actions.push({
        id: actionId,
        priority: m.improvementTrend === 'degrading' ? 'high' : 'medium',
        type: 'prompt_mutation',
        title: `Optimize prompt for "${m.jobName}"`,
        description: `This task has ${m.avgStepCount.toFixed(1)} avg steps and hasn't had prompt optimization. The next run will trigger automatic mutation analysis.`,
        affectedScheduleId: m.scheduleId,
        affectedJobName: m.jobName,
        estimatedImpact: 'Expected 20-40% step count reduction after 3 runs',
      });
    }

    if (m.recommendedAction === 'investigate') {
      actions.push({
        id: actionId,
        priority: 'high',
        type: 'investigation',
        title: `Investigate failures in "${m.jobName}"`,
        description: `Only ${(m.successRate * 100).toFixed(0)}% success rate over ${m.totalRuns} runs. Top failure: ${m.topFailureReasons[0] || 'unknown'}`,
        affectedScheduleId: m.scheduleId,
        affectedJobName: m.jobName,
        estimatedImpact: 'Fix will restore to expected success rate',
      });
    }
  }

  for (const evo of skillEvolutions) {
    actions.push({
      id: `action_skill_${evo.id}`,
      priority: 'medium',
      type: 'skill_update',
      title: `New skill opportunity: ${evo.patternName}`,
      description: evo.description,
      estimatedImpact: 'New SKILL.md will be available for similar future tasks',
    });
  }

  return actions;
}

function extractPromptLibraryEntries(
  rawData: RawRunData[],
  metrics: TaskPerformanceMetric[],
): PromptLibraryEntry[] {
  const entries: PromptLibraryEntry[] = [];

  for (const data of rawData) {
    const metric = metrics.find(m => m.scheduleId === data.scheduleId);
    if (!metric) continue;

    // Only extract from high-performing tasks
    if (metric.successRate < 0.8 || metric.totalRuns < 3) continue;

    // Extract learned context as a library entry
    if (data.learnedContext.length > 0 && data.currentPromptVersion > 0) {
      const category = detectTaskCategory(data.jobName);
      entries.push({
        id: `lib_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        addedAt: new Date().toISOString(),
        category,
        pattern: data.learnedContext.slice(-3).join('\n'),
        sourceScheduleIds: [data.scheduleId],
        successRate: metric.successRate,
        useCount: 1,
      });
    }
  }

  return entries;
}

function detectTaskCategory(jobName: string): string {
  const name = jobName.toLowerCase();
  if (/tweet|twitter|x\.com|post/.test(name)) return 'social_media_posting';
  if (/research|search|news|article/.test(name)) return 'web_research';
  if (/file|write|create|document/.test(name)) return 'file_operations';
  if (/code|review|bug|fix/.test(name)) return 'code_operations';
  if (/email|message|send/.test(name)) return 'communication';
  if (/report|summary|analyze/.test(name)) return 'reporting';
  return 'general';
}

function mergePromptLibrary(
  existing: PromptLibraryEntry[],
  newEntries: PromptLibraryEntry[],
): PromptLibraryEntry[] {
  const MAX_LIBRARY_SIZE = 200;
  const merged = [...existing];

  for (const entry of newEntries) {
    // Check if a similar pattern already exists (same category and similar content)
    const existingIdx = merged.findIndex(e =>
      e.category === entry.category &&
      e.pattern.slice(0, 50) === entry.pattern.slice(0, 50)
    );

    if (existingIdx !== -1) {
      // Update existing entry
      merged[existingIdx].useCount++;
      merged[existingIdx].successRate =
        (merged[existingIdx].successRate * 0.7) + (entry.successRate * 0.3);
      if (!merged[existingIdx].sourceScheduleIds.includes(entry.sourceScheduleIds[0])) {
        merged[existingIdx].sourceScheduleIds.push(entry.sourceScheduleIds[0]);
      }
    } else {
      merged.push(entry);
    }
  }

  // Sort by success rate and use count, trim to max
  return merged
    .sort((a, b) => (b.successRate * b.useCount) - (a.successRate * a.useCount))
    .slice(0, MAX_LIBRARY_SIZE);
}

// ─── Approve Skill Evolution ───────────────────────────────────────────────────

export function approveSkillEvolution(evolutionId: string): { success: boolean; skillPath?: string } {
  const store = loadSelfImprovementStore();
  const evolution = store.pendingSkillEvolutions.find(e => e.id === evolutionId);
  if (!evolution) return { success: false };

  // Write the skill file
  const absPath = path.resolve(process.cwd(), evolution.proposedSkillPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, evolution.proposedSkillContent, 'utf-8');
    evolution.approved = true;
    saveSelfImprovementStore(store);
    console.log(`[SelfImprovement] Approved and wrote skill evolution: ${evolution.proposedSkillPath}`);
    return { success: true, skillPath: evolution.proposedSkillPath };
  } catch (err: any) {
    console.error(`[SelfImprovement] Failed to write skill file:`, err.message);
    return { success: false };
  }
}

// ─── Format Report for Delivery ───────────────────────────────────────────────

export function formatPerformanceReport(report: PerformanceReport): string {
  const successPct = (report.overallSuccessRate * 100).toFixed(0);
  const period = `${report.periodStart.slice(0, 10)} → ${report.periodEnd.slice(0, 10)}`;

  const lines = [
    `📊 <b>Prometheus Weekly Performance Report</b>`,
    `Period: ${period}  |  ${report.totalScheduledJobs} jobs  |  ${report.totalTaskRuns} runs  |  <b>${successPct}% overall success</b>`,
    ``,
  ];

  // Top issues (insights that are NOT improvements or priorities)
  const issues = report.topInsights.filter(s => !s.startsWith('✅') && !s.startsWith('🎯'));
  if (issues.length > 0) {
    lines.push(`🚨 <b>Top Issues (${Math.min(issues.length, 3)}):</b>`);
    issues.slice(0, 3).forEach((insight, i) => lines.push(`${i + 1}. ${insight}`));
    lines.push('');
  }

  // Improvements implemented
  const improvements = report.topInsights.filter(s => s.startsWith('✅'));
  if (improvements.length > 0) {
    lines.push(`✅ <b>Improvements This Week:</b>`);
    improvements.slice(0, 3).forEach(s => lines.push(`• ${s.slice(2).trim()}`));
    lines.push('');
  }

  // Job inventory (per-job summary)
  if (report.metrics.length > 0) {
    lines.push(`📁 <b>Job Inventory:</b>`);
    for (const m of report.metrics) {
      const icon = m.successRate >= 0.9 ? '✅' : m.successRate >= 0.6 ? '⚠️' : '❌';
      const trend = m.improvementTrend === 'improving' ? '⬆️' : m.improvementTrend === 'degrading' ? '⬇️' : '➡️';
      lines.push(`${icon} ${trend} <b>${m.jobName}</b>: ${m.totalRuns} runs, ${(m.successRate * 100).toFixed(0)}% success${m.topFailureReasons[0] ? ` | top error: ${m.topFailureReasons[0].slice(0, 60)}` : ''}`);
    }
    lines.push('');
  }

  // Next week priorities
  const priorities = report.topInsights.filter(s => s.startsWith('🎯'));
  if (priorities.length > 0) {
    lines.push(`🎯 <b>Next Week Priorities:</b>`);
    priorities.slice(0, 3).forEach(s => lines.push(`• ${s.replace('🎯 Next: ', '').trim()}`));
    lines.push('');
  }

  // High priority actions
  const criticalActions = report.proposedActions.filter(a => a.priority === 'critical' || a.priority === 'high');
  if (criticalActions.length > 0) {
    lines.push(`⚡ <b>High Priority Actions (${criticalActions.length}):</b>`);
    criticalActions.slice(0, 3).forEach(a => lines.push(`• ${a.title}: ${a.description.slice(0, 100)}`));
    lines.push('');
  }

  if (report.skillEvolutions.length > 0) {
    lines.push(`🧠 <b>Skill Evolutions Proposed (${report.skillEvolutions.length}):</b>`);
    report.skillEvolutions.forEach(e => lines.push(`• ${e.patternName}: ${e.description.slice(0, 80)}`));
    lines.push(`Use /approve_skill &lt;id&gt; to apply a skill evolution.`);
    lines.push('');
  }

  if (report.modelRecommendations.length > 0) {
    lines.push(`🤖 <b>Model Notes:</b>`);
    report.modelRecommendations.forEach(r => lines.push(`• ${r.taskType}: ${r.recommendation.slice(0, 100)}`));
    lines.push('');
  }

  lines.push(`🔑 Report ID: <code>${report.id}</code>`);

  return lines.join('\n');
}

// ─── Get Prompt Library for Injection ─────────────────────────────────────────

export function getPromptLibraryForCategory(category: string): PromptLibraryEntry[] {
  const store = loadSelfImprovementStore();
  return store.promptLibrary
    .filter(e => e.category === category)
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 5);
}

export function formatPromptLibraryForContext(category: string): string {
  const entries = getPromptLibraryForCategory(category);
  if (entries.length === 0) return '';

  const lines = [`[PROVEN PATTERNS FOR ${category.toUpperCase()} - from ${entries.length} past successful runs]:`];
  for (const entry of entries) {
    lines.push(`• ${entry.pattern.slice(0, 200)}`);
  }
  lines.push(`[/PROVEN PATTERNS]`);
  return lines.join('\n');
}

// ─── Weekly Review Scheduled Job Definition ───────────────────────────────────

/**
 * Creates the weekly performance review as a scheduled job.
 * Should be called once during gateway startup if the job doesn't exist.
 */
export function getWeeklyReviewJobDefinition() {
  return {
    name: '📊 Weekly Performance Review',
    prompt: 'Run the weekly self-improvement performance review. Analyze all scheduled task run histories from the past 7 days, identify patterns, propose skill evolutions, and generate a performance report.',
    schedule: '0 9 * * 0',        // Every Sunday at 9am
    type: 'recurring' as const,
    enabled: true,
    priority: 100,                 // Low priority (high number = low priority)
    payloadKind: 'agentTurn' as const,
  };
}
