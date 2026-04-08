/**
 * self-improvement-api.ts
 *
 * Exposes all self-improvement-engine.ts functionality as callable functions
 * that any agent can invoke — not just the weekly review cron job.
 *
 * Used by:
 *   - nightly_consolidator (nightly Workflow 2)
 *   - code_analyst (Workflow 1 team member)
 *   - Any scheduled agent that wants to inspect performance data
 *   - The `self_improve` tool registered in tool-builder.ts
 *
 * Proposal routing:
 *   - Workflow 1 (Intel team): proposals go as TeamChange entries via proposeTeamChange()
 *   - Workflow 2 (nightly standalone): proposals go as file-based proposals via proposal-store.ts
 *   - write_proposal tool routes based on caller context (team session vs standalone)
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import {
  loadSelfImprovementStore,
  formatPerformanceReport,
  getPromptLibraryForCategory,
  formatPromptLibraryForContext,
  addBehaviorChangelogEntry,
  approveSkillEvolution,
  type PerformanceReport,
} from '../scheduling/self-improvement-engine';
import {
  loadScheduleMemory,
  formatScheduleMemoryForPrompt,
  addLearnedContext,
  addDedupKey,
  setNote,
  loadRunLog,
  aggregateStructuredStats,
} from '../scheduling/schedule-memory';
import { getMutationVersion } from '../scheduling/prompt-mutation';
import { getErrorWatchdogSummary } from '../errors/error-watchdog';
import { listGoals } from '../goal-decomposer';
import {
  createProposal,
  listProposals,
} from '../proposals/proposal-store';
import type { CronJob } from '../scheduling/cron-scheduler';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SelfImproveSummary {
  lastReportId: string | null;
  lastReportAt: string | null;
  pendingSkillEvolutions: number;
  pendingProposedActions: number;
  promptLibrarySize: number;
  behaviorChangelogEntries: number;
  errorWatchdog: {
    totalTracked: number;
    recurring: number;
    repairsProposed: number;
  };
  activeGoals: number;
  pendingProposals: number;
}

export interface SchedulePerformanceSummary {
  scheduleId: string;
  jobName: string;
  totalRuns: number;
  successRate: number;
  promptVersion: number;
  learnedContextCount: number;
  lastRunAt: number | null;
  topError: string | null;
}

// ─── Summary / Status ─────────────────────────────────────────────────────────

export function getSelfImproveSummary(): SelfImproveSummary {
  const store = loadSelfImprovementStore();
  const latestReport = store.reports.slice(-1)[0];
  const errorSummary = getErrorWatchdogSummary();
  const goals = listGoals({ status: ['active'] });
  const pendingProposals = listProposals('pending');

  return {
    lastReportId: latestReport?.id || null,
    lastReportAt: store.lastRunAt,
    pendingSkillEvolutions: store.pendingSkillEvolutions.filter(e => !e.approved).length,
    pendingProposedActions: store.pendingProposedActions.filter(a => !a.approved).length,
    promptLibrarySize: store.promptLibrary.length,
    behaviorChangelogEntries: store.behaviorChangelog.length,
    errorWatchdog: {
      totalTracked: errorSummary.totalTracked,
      recurring: errorSummary.recurring,
      repairsProposed: errorSummary.repairsProposed,
    },
    activeGoals: goals.length,
    pendingProposals: pendingProposals.length,
  };
}

// ─── Latest Report ────────────────────────────────────────────────────────────

export function getLatestReport(): PerformanceReport | null {
  const store = loadSelfImprovementStore();
  const reports = store.reports;
  if (!reports.length) return null;
  const latest = reports[reports.length - 1];
  try {
    const configDir = getConfig().getConfigDir();
    const reportPath = path.join(configDir, 'self-improvement', `report_${latest.id}.json`);
    if (fs.existsSync(reportPath)) {
      return JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as PerformanceReport;
    }
  } catch { /* fall through */ }
  return latest;
}

export function getLatestReportFormatted(): string {
  const report = getLatestReport();
  if (!report) return 'No performance reports yet.';
  return formatPerformanceReport(report);
}

// ─── Schedule Performance ─────────────────────────────────────────────────────

export function getAllSchedulePerformance(jobs: CronJob[]): SchedulePerformanceSummary[] {
  const now = Date.now();
  const periodMs = 7 * 24 * 60 * 60 * 1000;

  return jobs.map(job => {
    const mem = loadScheduleMemory(job.id);
    const log = loadRunLog(job.id);
    aggregateStructuredStats(job.id, now - periodMs, now);

    const recentRuns = log.runs.slice(-10);
    const successCount = recentRuns.filter(r => r.status === 'complete').length;
    const successRate = recentRuns.length > 0 ? successCount / recentRuns.length : 0;

    const errors = log.runs.filter(r => r.status === 'failed' && r.errorIfAny).slice(-3);
    const topError = errors.length > 0 ? errors[errors.length - 1].errorIfAny || null : null;

    const lastRun = recentRuns.length > 0
      ? recentRuns[recentRuns.length - 1].completedAt || recentRuns[recentRuns.length - 1].startedAt
      : null;

    return {
      scheduleId: job.id,
      jobName: job.name,
      totalRuns: log.runs.length,
      successRate,
      promptVersion: getMutationVersion(job.id),
      learnedContextCount: mem?.learnedContext.length || 0,
      lastRunAt: lastRun || null,
      topError,
    };
  });
}

export function formatSchedulePerformanceForPrompt(jobs: CronJob[]): string {
  const summaries = getAllSchedulePerformance(jobs);
  if (!summaries.length) return '(no scheduled jobs with run history)';
  return summaries.map(s => {
    const successPct = (s.successRate * 100).toFixed(0);
    const lastRunStr = s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'never';
    const errorStr = s.topError ? ` | last error: ${s.topError.slice(0, 60)}` : '';
    return `• ${s.jobName}: ${s.totalRuns} runs, ${successPct}% success, v${s.promptVersion} prompt, last: ${lastRunStr}${errorStr}`;
  }).join('\n');
}

// ─── Error Watchdog ───────────────────────────────────────────────────────────

export function getErrorSummaryForPrompt(): string {
  const summary = getErrorWatchdogSummary();
  return [
    `Total errors tracked: ${summary.totalTracked}`,
    `Source code errors: ${summary.sourceErrors}`,
    `Recurring (3+ times): ${summary.recurring}`,
    `Repairs proposed: ${summary.repairsProposed}`,
  ].join('\n');
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export function getGoalsSummaryForPrompt(): string {
  const goals = listGoals({ status: ['active'] });
  if (!goals.length) return '(no active goals)';
  return goals.map(g => {
    const active = g.subTasks.filter(st => st.status === 'active').length;
    const done = g.subTasks.filter(st => st.status === 'completed').length;
    return `• ${g.title}: ${done}/${g.subTasks.length} sub-tasks done, ${active} active`;
  }).join('\n');
}

// ─── Behavior Changelog ───────────────────────────────────────────────────────

export function addChangelogEntry(
  change: string,
  reason: string,
  jobName?: string,
  expectedImpact?: string,
): void {
  addBehaviorChangelogEntry({ change, reason, jobName, expectedImpact });
}

export function getRecentChangelog(limit = 10): string {
  const store = loadSelfImprovementStore();
  const entries = (store.behaviorChangelog || []).slice(-limit);
  if (!entries.length) return '(no behavior changes recorded)';
  return entries.map(e =>
    `[${e.date}] ${e.change} — ${e.reason}${e.expectedImpact ? ` (expected: ${e.expectedImpact})` : ''}`
  ).join('\n');
}

// ─── Schedule Memory (agent-accessible) ───────────────────────────────────────

export function getScheduleMemorySummary(scheduleId: string): string {
  const mem = loadScheduleMemory(scheduleId);
  return formatScheduleMemoryForPrompt(mem);
}

export function writeScheduleInsight(scheduleId: string, insight: string): void {
  addLearnedContext(scheduleId, insight);
}

export function writeScheduleNote(scheduleId: string, key: string, value: string): void {
  setNote(scheduleId, key, value);
}

export function writeScheduleDedup(scheduleId: string, key: string, value: string): boolean {
  return addDedupKey(scheduleId, key, value);
}

// ─── Prompt Library ───────────────────────────────────────────────────────────

export function getProvenPatterns(category: string): string {
  return formatPromptLibraryForContext(category);
}

// ─── Proposals (Workflow 2 — standalone nightly agent) ────────────────────────
// For Workflow 1 (Intel team), proposals go through proposeTeamChange() instead.
// The write_proposal tool in subagent-executor routes based on session context.

export function submitStandaloneProposal(args: {
  type: string;
  priority: string;
  title: string;
  summary: string;
  details: string;
  sourceAgentId: string;
  sourceSessionId?: string;
  sourcePipeline?: string;
  affectedFiles?: Array<{ path: string; action: string; description: string }>;
  diffPreview?: string;
  estimatedImpact?: string;
  requiresBuild?: boolean;
  executorAgentId?: string;
  executorPrompt?: string;
  riskTier?: 'low' | 'high';
  executorProviderId?: string;
  executorModel?: string;
}) {
  return createProposal({
    type: (args.type || 'general') as any,
    priority: (args.priority || 'medium') as any,
    title: args.title,
    summary: args.summary,
    details: args.details,
    sourceAgentId: args.sourceAgentId,
    sourceSessionId: args.sourceSessionId,
    sourcePipeline: args.sourcePipeline,
    affectedFiles: (args.affectedFiles || []) as any,
    diffPreview: args.diffPreview,
    estimatedImpact: args.estimatedImpact,
    requiresBuild: args.requiresBuild === true,
    executorAgentId: args.executorAgentId,
    executorPrompt: args.executorPrompt,
    riskTier: args.riskTier,
    executorProviderId: args.executorProviderId,
    executorModel: args.executorModel,
  });
}

export function getPendingProposalsSummary(): string {
  const pending = listProposals('pending');
  if (!pending.length) return '(no pending proposals)';
  return pending.map(p =>
    `• [${p.priority.toUpperCase()}] ${p.title} (${p.type}) — ${p.summary.slice(0, 100)}`
  ).join('\n');
}

// ─── Skill Evolutions ─────────────────────────────────────────────────────────

export function getPendingSkillEvolutions(): string {
  const store = loadSelfImprovementStore();
  const pending = store.pendingSkillEvolutions.filter(e => !e.approved);
  if (!pending.length) return '(no pending skill evolutions)';
  return pending.map(e =>
    `• ${e.id}: ${e.patternName} — ${e.description.slice(0, 100)}`
  ).join('\n');
}

export function approveSkillEvolutionById(id: string): { success: boolean; skillPath?: string } {
  return approveSkillEvolution(id);
}

// ─── Full Context Block for Agents ───────────────────────────────────────────

export function buildFullImprovementContext(jobs: CronJob[]): string {
  const summary = getSelfImproveSummary();
  const lastReport = getLatestReportFormatted();
  const schedulePerf = formatSchedulePerformanceForPrompt(jobs);
  const errorSummary = getErrorSummaryForPrompt();
  const goalsSummary = getGoalsSummaryForPrompt();
  const changelog = getRecentChangelog(5);
  const pendingProposals = getPendingProposalsSummary();
  const pendingSkills = getPendingSkillEvolutions();

  return [
    '[SELF-IMPROVEMENT CONTEXT]',
    '',
    `Last performance review: ${summary.lastReportAt || 'never'}`,
    `Pending skill evolutions: ${summary.pendingSkillEvolutions}`,
    `Pending standalone proposals: ${summary.pendingProposals}`,
    `Behavior changelog entries: ${summary.behaviorChangelogEntries}`,
    '',
    '## Schedule Performance (last 7 days)',
    schedulePerf,
    '',
    '## Error Watchdog',
    errorSummary,
    '',
    '## Active Goals',
    goalsSummary,
    '',
    '## Recent Behavior Changes',
    changelog,
    '',
    '## Pending Standalone Proposals (Workflow 2)',
    pendingProposals,
    '',
    '## Pending Skill Evolutions',
    pendingSkills,
    '',
    '## Latest Performance Report',
    lastReport.slice(0, 2000),
    '[/SELF-IMPROVEMENT CONTEXT]',
  ].join('\n');
}
