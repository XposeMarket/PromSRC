import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { getNextRun, type CronJob } from './cron-scheduler';
import {
  loadRunLog,
  loadScheduleMemory,
  loadStructuredLog,
} from './schedule-memory';
import { listInternalWatches } from '../internal-watch/internal-watch-store';
import { observeInternalWatchTarget } from '../internal-watch/internal-watch-runner';
import { listTasks, loadTask, saveTask, updateTaskStatus } from '../tasks/task-store';
import { peekPendingEvents } from '../teams/notify-bridge';
import { getAgents } from '../../config/config';
import { listManagedTeams } from '../teams/managed-teams';
import { getBuildStatus } from '../../runtime/build-status';
import { ensureScheduleRuntimeForAgent } from './schedule-agent';
import { normalizeScheduleSpec } from './schedule-pattern';

export interface SchedulerAdminResult {
  success: boolean;
  message?: string;
  data?: Record<string, any>;
  error?: string;
}

type SchedulerLike = {
  getJobs: () => CronJob[];
  updateJob: (id: string, partial: Partial<CronJob>) => CronJob | null;
  runJobNow: (id: string, options?: any) => Promise<void>;
};

type ExpectedOutput = {
  path: string;
  requiredText?: string;
  absentText?: string;
};

function configDir(): string {
  try {
    return getConfig().getConfigDir();
  } catch {
    return path.join(process.cwd(), '.prometheus');
  }
}

function workspaceRoot(): string {
  try {
    return getConfig().getWorkspacePath();
  } catch {
    return process.cwd();
  }
}

function safeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function toIsoOrNull(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function clampLimit(raw: any, fallback = 10, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

function normalizeScheduleSkillIds(value: any): string[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((id: any) => String(id || '').trim())
      .filter(Boolean)
  ));
}

function normalizeScheduleContextRefs(value: any, existing: any[] = []): any[] {
  if (!Array.isArray(value)) return [];
  const existingById = new Map((Array.isArray(existing) ? existing : []).map((ref: any) => [String(ref?.id || ''), ref]));
  const now = Date.now();
  return value.map((raw: any) => {
    const title = String(raw?.title || '').trim().slice(0, 160);
    const content = String(raw?.content || '').trim().slice(0, 12000);
    if (!title || !content) return null;
    const id = String(raw?.id || `ref_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`).trim();
    const prior = existingById.get(id) || {};
    return {
      id,
      title,
      content,
      createdAt: Number(raw?.createdAt || raw?.created_at || prior?.createdAt || now) || now,
      updatedAt: Number(raw?.updatedAt || raw?.updated_at || now) || now,
    };
  }).filter(Boolean);
}

function findJob(scheduler: SchedulerLike, rawId: any): CronJob | null {
  const id = String(rawId || '').trim();
  if (!id) return null;
  const lower = id.toLowerCase();
  return scheduler.getJobs().find((job) =>
    String(job.id || '') === id ||
    String(job.name || '').toLowerCase() === lower
  ) || null;
}

function summarizeJob(job: CronJob): Record<string, any> {
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    status: job.status,
    enabled: job.enabled !== false,
    schedule: job.schedule,
    runAt: job.runAt,
    tz: job.tz || null,
    nextRun: job.nextRun,
    lastRun: job.lastRun,
    lastDuration: job.lastDuration,
    consecutiveErrors: job.consecutiveErrors || 0,
    pausedReason: job.pausedReason || null,
    lastOutputSessionId: job.lastOutputSessionId || null,
    subagent_id: job.subagent_id || null,
    team_id: (job as any).team_id || null,
    assignmentTarget: (job as any).assignmentTarget || null,
    deliverToMainChannel: (job as any).deliverToMainChannel === true,
    model: job.model || null,
    sessionTarget: job.sessionTarget || 'isolated',
    expectedOutputs: normalizeExpectedOutputs((job as any).expectedOutputs || []),
  };
}

function classifyBlocker(text: string): string | null {
  const t = String(text || '');
  if (!t) return null;
  if (/BLOCKED:/i.test(t)) return t.match(/BLOCKED:[^\n.]+[.\n]?/i)?.[0]?.trim() || 'blocked';
  if (/required scheduled-job source file is missing/i.test(t)) return 'missing required scheduled-job source file';
  if (/approval required|needs approval/i.test(t)) return 'awaiting approval';
  if (/timeout|timed out/i.test(t)) return 'timeout';
  if (/auth|unauthorized|forbidden|credential/i.test(t)) return 'auth or credentials';
  return null;
}

function readCronJsonlHistory(jobId: string): Array<Record<string, any>> {
  const filePath = path.join(configDir(), 'cron', 'runs', `${safeId(jobId)}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const entry = JSON.parse(line);
        const output = String(entry.result_excerpt || '');
        return {
          source: 'cron_history',
          runId: null,
          taskId: null,
          agentId: null,
          startedAt: null,
          completedAt: toIsoOrNull(entry.t),
          status: String(entry.status || ''),
          durationMs: Number(entry.duration || 0),
          attempts: 1,
          retryCount: 0,
          outputSummary: output,
          error: String(entry.status || '') === 'error' ? output : null,
          blockerReason: classifyBlocker(output),
        };
      });
  } catch {
    return [];
  }
}

function readScheduleRunHistory(job: CronJob): Array<Record<string, any>> {
  const log = loadRunLog(job.id);
  return log.runs.map((entry) => {
    const output = String(entry.summary || entry.errorIfAny || '');
    const attempts = Math.max(1, Number(entry.attempts || 1));
    return {
      source: 'schedule_run_log',
      runId: entry.runId,
      taskId: entry.taskId,
      agentId: entry.agentId || job.subagent_id || null,
      startedAt: toIsoOrNull(entry.startedAt),
      completedAt: toIsoOrNull(entry.completedAt),
      scheduledAt: toIsoOrNull(entry.scheduledAt),
      status: entry.status,
      durationMs: entry.completedAt ? Math.max(0, Number(entry.completedAt) - Number(entry.startedAt || entry.scheduledAt || entry.completedAt)) : null,
      attempts,
      retryCount: attempts - 1,
      outputSummary: output,
      error: entry.errorIfAny || (entry.status === 'failed' ? output : null),
      blockerReason: classifyBlocker(entry.errorIfAny || output),
      evidenceWritten: entry.evidenceWritten || 0,
    };
  });
}

function sortRunsDesc(runs: Array<Record<string, any>>): Array<Record<string, any>> {
  return runs.sort((a, b) => {
    const at = new Date(a.completedAt || a.startedAt || a.scheduledAt || 0).getTime();
    const bt = new Date(b.completedAt || b.startedAt || b.scheduledAt || 0).getTime();
    return bt - at;
  });
}

function getRunHistory(job: CronJob, limit: number): Array<Record<string, any>> {
  const structured = loadStructuredLog(job.id).map((entry) => ({
    source: 'structured_log',
    runId: entry.runId,
    taskId: null,
    agentId: job.subagent_id || null,
    startedAt: toIsoOrNull(entry.triggeredAt),
    completedAt: toIsoOrNull(entry.completedAt),
    status: entry.status,
    durationMs: entry.durationMs,
    attempts: entry.attempts || 1,
    retryCount: Math.max(0, Number(entry.attempts || 1) - 1),
    outputSummary: '',
    error: entry.errorMessage || null,
    blockerReason: classifyBlocker(entry.errorMessage || ''),
    stepCount: entry.stepCount,
    errorType: entry.errorType || null,
    keyMetrics: entry.keyMetrics || {},
  }));
  return sortRunsDesc([
    ...readScheduleRunHistory(job),
    ...readCronJsonlHistory(job.id),
    ...structured,
  ]).slice(0, limit);
}

function normalizeExpectedOutputs(raw: any): ExpectedOutput[] {
  const values = Array.isArray(raw) ? raw : [];
  const out: ExpectedOutput[] = [];
  for (const item of values) {
    if (typeof item === 'string') {
      const p = item.trim();
      if (p) out.push({ path: p });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const p = String(item.path || item.file || '').trim();
    if (!p) continue;
    out.push({
      path: p,
      requiredText: item.requiredText || item.required_text ? String(item.requiredText || item.required_text) : undefined,
      absentText: item.absentText || item.absent_text ? String(item.absentText || item.absent_text) : undefined,
    });
  }
  return out.slice(0, 50);
}

function resolveOutputPath(rawPath: string): { abs: string; rel: string; valid: boolean; error?: string } {
  const root = path.resolve(workspaceRoot());
  const rel = String(rawPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) return { abs: root, rel, valid: false, error: 'path is required' };
  if (path.isAbsolute(rel)) return { abs: rel, rel, valid: false, error: 'expected output paths must be workspace-relative' };
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { abs, rel, valid: false, error: 'expected output path must stay inside the workspace' };
  }
  return { abs, rel: relative.replace(/\\/g, '/'), valid: true };
}

function checkExpectedOutput(job: CronJob, expected: ExpectedOutput): Record<string, any> {
  const resolved = resolveOutputPath(expected.path);
  if (!resolved.valid) return { path: expected.path, status: 'invalid', error: resolved.error };
  if (!fs.existsSync(resolved.abs)) return { path: resolved.rel, status: 'missing', exists: false };
  const stat = fs.statSync(resolved.abs);
  if (!stat.isFile()) return { path: resolved.rel, status: 'invalid', exists: true, error: 'not a file' };

  let status = 'ok';
  const issues: string[] = [];
  const lastRunMs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
  if (lastRunMs && stat.mtimeMs + 1000 < lastRunMs) {
    status = 'outdated';
    issues.push('file is older than the latest job run');
  }

  let textPreview: string | undefined;
  if (expected.requiredText || expected.absentText) {
    const text = fs.readFileSync(resolved.abs, 'utf-8');
    textPreview = text.slice(0, 300);
    if (expected.requiredText && !text.includes(expected.requiredText)) {
      status = 'text_failed';
      issues.push(`missing required text: ${expected.requiredText.slice(0, 80)}`);
    }
    if (expected.absentText && text.includes(expected.absentText)) {
      status = 'text_failed';
      issues.push(`contains blocked text: ${expected.absentText.slice(0, 80)}`);
    }
  }

  return {
    path: resolved.rel,
    status,
    exists: true,
    size: stat.size,
    mtime: new Date(stat.mtimeMs).toISOString(),
    issues,
    textPreview,
  };
}

function checkExpectedOutputs(job: CronJob): Array<Record<string, any>> {
  return normalizeExpectedOutputs((job as any).expectedOutputs || [])
    .map((expected) => checkExpectedOutput(job, expected));
}

function linkedTasks(jobId: string, limit = 20): Array<Record<string, any>> {
  return listTasks()
    .filter((task) => task.scheduleId === jobId || task.pausedByScheduleId === jobId)
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      scheduleId: task.scheduleId || null,
      pausedByScheduleId: task.pausedByScheduleId || null,
      startedAt: task.startedAt,
      completedAt: task.completedAt || null,
      finalSummary: task.finalSummary ? String(task.finalSummary).slice(0, 500) : null,
      lastToolCall: task.lastToolCall || null,
    }));
}

function linkedWatches(jobId: string): Array<Record<string, any>> {
  return listInternalWatches({ includeDone: true })
    .filter((watch) => {
      if (watch.target.type !== 'scheduled_job') return false;
      const cfg = watch.target.config || {};
      return String(cfg.jobId || cfg.job_id || '') === jobId;
    })
    .map((watch) => ({
      id: watch.id,
      label: watch.label,
      status: watch.status,
      expiresAt: watch.expiresAt,
      firedCount: watch.firedCount,
      maxFirings: watch.maxFirings,
      lastObservation: watch.lastObservation || null,
      error: watch.error || null,
    }));
}

function linkedEvents(job: CronJob): Array<Record<string, any>> {
  try {
    const lowerId = job.id.toLowerCase();
    const lowerName = job.name.toLowerCase();
    return peekPendingEvents(workspaceRoot()).filter((event) => {
      const text = JSON.stringify(event).toLowerCase();
      return text.includes(lowerId) || text.includes(lowerName);
    }).slice(-20);
  } catch {
    return [];
  }
}

export function scheduleJobHistoryTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const job = findJob(scheduler, args?.job_id || args?.jobId || args?.name);
  if (!job) return { success: false, error: 'schedule_job_history requires a valid job_id or name' };
  const limit = clampLimit(args?.limit, 10, 100);
  const runs = getRunHistory(job, limit);
  return {
    success: true,
    message: `Loaded ${runs.length} recent run record(s) for "${job.name}".`,
    data: { job: summarizeJob(job), runs },
  };
}

export function scheduleJobDetailTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const job = findJob(scheduler, args?.job_id || args?.jobId || args?.name);
  if (!job) return { success: false, error: 'schedule_job_detail requires a valid job_id or name' };
  const recentRuns = getRunHistory(job, clampLimit(args?.limit, 10, 50));
  const recentErrors = recentRuns.filter((run) =>
    /error|failed/i.test(String(run.status || '')) || run.error
  ).slice(0, 10);
  const memory = loadScheduleMemory(job.id);
  const outputChecks = checkExpectedOutputs(job);
  return {
    success: true,
    message: `Loaded scheduled job detail for "${job.name}".`,
    data: {
      job: summarizeJob(job),
      config: job,
      prompt: job.prompt,
      schedule: {
        type: job.type,
        cron: job.schedule,
        runAt: job.runAt,
        timezone: job.tz || null,
        nextRun: job.nextRun,
      },
      latestResult: job.lastResult || null,
      recentRuns,
      recentErrors,
      linked: {
        tasks: linkedTasks(job.id),
        watches: linkedWatches(job.id),
        events: linkedEvents(job),
      },
      outputChecks,
      scheduleMemory: memory ? {
        learnedContext: memory.learnedContext || [],
        runSummaries: (memory.runSummaries || []).slice(-10),
        notes: memory.notes || {},
        dedupKeys: Object.keys(memory.dedup || {}),
      } : null,
    },
  };
}

export function scheduleJobLogSearchTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const query = String(args?.query || args?.text || '').trim().toLowerCase();
  const status = String(args?.status || '').trim().toLowerCase();
  const dateFrom = args?.date_from || args?.dateFrom ? new Date(args.date_from || args.dateFrom).getTime() : null;
  const dateTo = args?.date_to || args?.dateTo ? new Date(args.date_to || args.dateTo).getTime() : null;
  const limit = clampLimit(args?.limit, 25, 200);
  const explicitJob = String(args?.job_id || args?.jobId || '').trim();
  const jobs = explicitJob ? [findJob(scheduler, explicitJob)].filter(Boolean) as CronJob[] : scheduler.getJobs();

  const matches: Array<Record<string, any>> = [];
  for (const job of jobs) {
    for (const run of getRunHistory(job, 500)) {
      const t = new Date(run.completedAt || run.startedAt || run.scheduledAt || 0).getTime();
      if (dateFrom && (!Number.isFinite(t) || t < dateFrom)) continue;
      if (dateTo && (!Number.isFinite(t) || t > dateTo)) continue;
      if (status && String(run.status || '').toLowerCase() !== status) continue;
      const haystack = JSON.stringify({ job: summarizeJob(job), run }).toLowerCase();
      if (query && !haystack.includes(query)) continue;
      matches.push({ job: summarizeJob(job), run });
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  return {
    success: true,
    message: `Found ${matches.length} scheduled-job log match(es).`,
    data: { query, count: matches.length, matches },
  };
}

function buildSchedulePatch(args: any): { patch: Record<string, any>; errors: string[] } {
  const patch: Record<string, any> = {};
  const errors: string[] = [];
  const schedule = args?.schedule && typeof args.schedule === 'object' ? args.schedule : {};

  if (args?.name !== undefined) patch.name = String(args.name || '').trim();
  if (args?.instruction_prompt !== undefined || args?.prompt !== undefined) {
    patch.prompt = String(args.instruction_prompt ?? args.prompt ?? '').trim();
  }
  if (args?.timezone !== undefined || args?.tz !== undefined) {
    patch.tz = String(args.timezone ?? args.tz ?? '').trim() || undefined;
  }
  if (args?.model_override !== undefined || args?.model !== undefined) {
    patch.model = String(args.model_override ?? args.model ?? '').trim() || undefined;
  }
  if (args?.skillIds !== undefined) {
    patch.skillIds = normalizeScheduleSkillIds(args.skillIds);
  }
  if (args?.context_refs !== undefined || args?.contextReferences !== undefined) {
    patch.context_refs = normalizeScheduleContextRefs(
      args.context_refs ?? args.contextReferences,
      args?.existing_context_refs || args?.existingContextRefs || []
    );
  }
  if (args?.team_id !== undefined || args?.teamId !== undefined) {
    const teamId = String(args.team_id ?? args.teamId ?? '').trim();
    patch.team_id = teamId || undefined;
    if (teamId) {
      patch.subagent_id = undefined;
      patch.assignmentTarget = 'team';
      patch.deliverToMainChannel = false;
      patch.sessionTarget = 'isolated';
    }
  }
  if (args?.subagent_id !== undefined || args?.subagentId !== undefined) {
    const subagentId = String(args.subagent_id ?? args.subagentId ?? '').trim();
    patch.subagent_id = subagentId || undefined;
    if (subagentId) {
      patch.team_id = undefined;
      patch.assignmentTarget = 'subagent';
      patch.deliverToMainChannel = false;
      patch.sessionTarget = 'isolated';
    }
  }
  if (args?.enabled !== undefined) {
    patch.enabled = args.enabled === true || String(args.enabled).toLowerCase() === 'true';
    patch.status = patch.enabled ? 'scheduled' : 'paused';
    if (!patch.enabled) patch.pausedReason = 'manual';
    if (patch.enabled) patch.pausedReason = undefined;
  }
  if (args?.delivery !== undefined || args?.channel !== undefined || args?.session_target !== undefined) {
    const delivery = args.delivery && typeof args.delivery === 'object' ? args.delivery : {};
    const channel = String(delivery.channel || args.channel || 'web').toLowerCase();
    if (channel !== 'web') errors.push(`Delivery channel "${channel}" is not enabled for scheduler jobs yet.`);
    const target = String(delivery.session_target || args.session_target || '').toLowerCase();
    if (target === 'main' || target === 'isolated') patch.sessionTarget = 'isolated';
    if (target === 'main') {
      patch.assignmentTarget = 'main';
      patch.deliverToMainChannel = true;
    }
  }
  const rawKind = String(schedule.kind || args?.kind || '').trim().toLowerCase();
  const hasScheduleUpdate = rawKind || schedule.cron !== undefined || args?.cron !== undefined || schedule.run_at !== undefined || args?.run_at !== undefined || schedule.text !== undefined || schedule.time !== undefined || schedule.days_of_week !== undefined || schedule.daysOfWeek !== undefined || schedule.repeat !== undefined || schedule.every_hours !== undefined || schedule.everyHours !== undefined || schedule.every_days !== undefined || schedule.everyDays !== undefined;
  if (hasScheduleUpdate) {
    try {
      const normalized = normalizeScheduleSpec({
        ...schedule,
        kind: schedule.kind || args?.kind || undefined,
        cron: schedule.cron ?? args?.cron,
        run_at: schedule.run_at ?? args?.run_at,
      }, patch.tz);
      patch.type = normalized.kind === 'one-shot' ? 'one-shot' : 'recurring';
      if (normalized.kind === 'recurring') {
        patch.schedule = normalized.cron;
        patch.runAt = null;
      } else {
        patch.runAt = normalized.runAt;
        patch.schedule = null;
      }
    } catch (err: any) {
      errors.push(err?.message || String(err));
    }
  }
  if (args?.expected_outputs !== undefined || args?.expectedOutputs !== undefined) {
    patch.expectedOutputs = normalizeExpectedOutputs(args.expected_outputs ?? args.expectedOutputs);
  }
  return { patch, errors };
}

function diffPatch(job: CronJob, patch: Record<string, any>): Array<Record<string, any>> {
  return Object.keys(patch).map((key) => ({
    field: key,
    before: (job as any)[key] ?? null,
    after: patch[key] ?? null,
  })).filter((change) => JSON.stringify(change.before) !== JSON.stringify(change.after));
}

export function scheduleJobPatchTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const action = String(args?.action || 'preview').trim().toLowerCase();
  const job = findJob(scheduler, args?.job_id || args?.jobId || args?.name);
  if (!job) return { success: false, error: 'schedule_job_patch requires a valid job_id or name' };
  if (action !== 'preview' && action !== 'apply') return { success: false, error: 'schedule_job_patch action must be preview or apply' };

  const { patch, errors } = buildSchedulePatch(args);
  if (errors.length) return { success: false, error: errors.join(' ') };
  const changes = diffPatch(job, patch);
  if (changes.length === 0) {
    return { success: true, message: 'No changes detected.', data: { job: summarizeJob(job), changes: [] } };
  }
  if (action === 'preview') {
    return {
      success: true,
      message: 'Patch preview generated. Re-run with action="apply" and confirm=true to apply it.',
      data: { job: summarizeJob(job), changes, patch },
    };
  }
  if (args?.confirm !== true) {
    return {
      success: false,
      error: 'schedule_job_patch apply requires confirm=true after reviewing the preview.',
      data: { job: summarizeJob(job), changes, patch, needs_confirmation: true },
    };
  }
  let updated = scheduler.updateJob(job.id, patch as Partial<CronJob>);
  if (!updated) return { success: false, error: `Job not found: ${job.id}` };
  if (String((updated as any).team_id || '').trim()) {
    return {
      success: true,
      message: `Applied ${changes.length} change(s) to team schedule "${updated.name}".`,
      data: { job: summarizeJob(updated), changes, assigned_team: (updated as any).team_id },
    };
  }
  // Ownership rule (must match schedule_job action=update in automation-executor):
  // jobs default to Prometheus itself. Only ensure a dedicated owner runtime when the
  // job ALREADY has an explicit subagent_id. Never mint a new subagent on a plain patch —
  // doing so grafted a schedule_<name>_<hash> owner onto main-owned jobs on every edit.
  const ownerId = String(updated.subagent_id || '').trim();
  if (ownerId) {
    ensureScheduleRuntimeForAgent(ownerId, {
      scheduleId: updated.id,
      scheduleName: updated.name,
      prompt: updated.prompt,
      model: updated.model,
    });
  } else if (
    (updated as any).assignmentTarget !== 'main' ||
    updated.sessionTarget !== 'main' ||
    (updated as any).deliverToMainChannel !== true
  ) {
    updated = scheduler.updateJob(updated.id, {
      assignmentTarget: 'main',
      sessionTarget: 'main',
      deliverToMainChannel: true,
    } as Partial<CronJob>) || updated;
  }
  return {
    success: true,
    message: ownerId
      ? `Applied ${changes.length} change(s) to "${updated.name}" and confirmed schedule owner "${ownerId}".`
      : `Applied ${changes.length} change(s) to "${updated.name}" (owned by Prometheus itself).`,
    data: {
      job: summarizeJob(updated),
      changes,
      assigned_owner: ownerId ? { agentId: ownerId, created: false } : { agentId: 'main', created: false },
    },
  };
}

export function scheduleJobOutputsTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const action = String(args?.action || 'check').trim().toLowerCase();
  const job = findJob(scheduler, args?.job_id || args?.jobId || args?.name);
  if (!job) return { success: false, error: 'schedule_job_outputs requires a valid job_id or name' };
  if (!['get', 'set', 'check'].includes(action)) {
    return { success: false, error: 'schedule_job_outputs action must be get, set, or check' };
  }
  if (action === 'get') {
    return { success: true, data: { job: summarizeJob(job), expectedOutputs: normalizeExpectedOutputs((job as any).expectedOutputs || []) } };
  }
  if (action === 'set') {
    if (args?.confirm !== true) return { success: false, error: 'schedule_job_outputs(set) requires confirm=true' };
    const expectedOutputs = normalizeExpectedOutputs(args?.expected_outputs ?? args?.expectedOutputs ?? []);
    const updated = scheduler.updateJob(job.id, { expectedOutputs } as any);
    if (!updated) return { success: false, error: `Job not found: ${job.id}` };
    return {
      success: true,
      message: `Stored ${expectedOutputs.length} expected output(s) for "${updated.name}".`,
      data: { job: summarizeJob(updated), outputChecks: checkExpectedOutputs(updated) },
    };
  }
  const outputChecks = checkExpectedOutputs(job);
  const alerts = outputChecks.filter((check) => check.status !== 'ok');
  return {
    success: true,
    message: alerts.length
      ? `${alerts.length} expected output alert(s) for "${job.name}".`
      : `All expected outputs look current for "${job.name}".`,
    data: { job: summarizeJob(job), outputChecks, alerts },
  };
}

function healthyNextRun(job: CronJob): string | null {
  if (job.type === 'one-shot') return job.runAt || null;
  return getNextRun(job.schedule, new Date(), job.tz).toISOString();
}

export async function scheduleJobStuckControlTool(scheduler: SchedulerLike, args: any): Promise<SchedulerAdminResult> {
  const action = String(args?.action || '').trim().toLowerCase();
  const job = findJob(scheduler, args?.job_id || args?.jobId || args?.name);
  if (!job) return { success: false, error: 'schedule_job_stuck_control requires a valid job_id or name' };
  if (!['clear_blocked', 'mark_handled', 'cancel_retry_loop', 'rerun_clean'].includes(action)) {
    return { success: false, error: 'action must be clear_blocked, mark_handled, cancel_retry_loop, or rerun_clean' };
  }
  if (args?.confirm !== true) {
    return { success: false, error: `schedule_job_stuck_control(${action}) requires confirm=true` };
  }
  if (job.status === 'running' && action !== 'mark_handled') {
    return { success: false, error: `Job "${job.name}" is running; wait for it to finish before changing stuck state.` };
  }

  const note = String(args?.note || '').trim();
  const patch: Record<string, any> = {
    consecutiveErrors: 0,
    pausedReason: undefined,
    enabled: true,
    status: 'scheduled',
    nextRun: healthyNextRun(job),
  };

  if (action === 'mark_handled') {
    patch.lastResult = note ? `HANDLED: ${note}` : 'HANDLED: Operator marked this scheduled-job issue handled.';
  }
  if (action === 'rerun_clean') {
    patch.lastOutputSessionId = null;
    patch.lastResult = null;
  }

  const updated = scheduler.updateJob(job.id, patch as Partial<CronJob>);
  if (!updated) return { success: false, error: `Job not found: ${job.id}` };

  if (action === 'rerun_clean') {
    scheduler.runJobNow(job.id, { respectActiveHours: false }).catch(() => {});
  }

  return {
    success: true,
    message: action === 'rerun_clean'
      ? `Reset "${updated.name}" and queued a clean immediate rerun.`
      : `Applied ${action} to "${updated.name}".`,
    data: { job: summarizeJob(updated), action },
  };
}

function jobHealth(job: CronJob): Record<string, any> {
  const now = Date.now();
  const nextRunMs = job.nextRun ? new Date(job.nextRun).getTime() : 0;
  const overdue = job.enabled && job.status === 'scheduled' && nextRunMs > 0 && nextRunMs < now;
  const outputAlerts = checkExpectedOutputs(job).filter((check) => check.status !== 'ok');
  return {
    state: job.status === 'running'
      ? 'running'
      : job.status === 'paused' || job.enabled === false
        ? 'paused'
        : (job.consecutiveErrors || 0) > 0
          ? 'error_backoff'
          : overdue
            ? 'overdue'
            : outputAlerts.length
              ? 'output_alert'
              : 'healthy',
    overdue,
    consecutiveErrors: job.consecutiveErrors || 0,
    outputAlertCount: outputAlerts.length,
    blockerReason: classifyBlocker(job.lastResult || ''),
  };
}

// ── automation_dashboard v2 helpers ──────────────────────────────────────────

/** Trim a task record for the snapshot. `outputCap` caps the produced output. */
function snapshotTask(task: any, outputCap: number): Record<string, any> {
  const total = Array.isArray(task.plan) ? task.plan.length : 0;
  const done = (task.plan || []).filter((s: any) => s.status === 'done' || s.status === 'skipped').length;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    step: total ? Math.min((task.currentStepIndex || 0) + 1, total) : null,
    total_steps: total || null,
    completed_steps: done,
    scheduleId: task.scheduleId || null,
    pausedByScheduleId: task.pausedByScheduleId || null,
    teamId: task.teamSubagent?.teamId || null,
    agentId: task.teamSubagent?.agentId || null,
    startedAt: task.startedAt,
    completedAt: task.completedAt || null,
    lastProgressAt: task.lastProgressAt,
    pauseReason: task.pauseReason || null,
    finalSummary: task.finalSummary ? String(task.finalSummary).slice(0, outputCap) : null,
  };
}

/** Recent runs for a job, with output/error capped by depth. */
function snapshotRunsForJob(job: CronJob, limit: number, outputCap: number): Array<Record<string, any>> {
  return getRunHistory(job, limit).map((run) => ({
    ...run,
    jobId: job.id,
    jobName: job.name,
    outputSummary: run.outputSummary ? String(run.outputSummary).slice(0, outputCap) : '',
    error: run.error ? String(run.error).slice(0, outputCap) : null,
  }));
}

export function automationDashboardTool(scheduler: SchedulerLike, args: any): SchedulerAdminResult {
  const limit = clampLimit(args?.limit, 25, 200);
  const depth = String(args?.depth || 'summary').toLowerCase() === 'full' ? 'full' : 'summary';
  const outputCap = depth === 'full' ? 4000 : 300;
  const resultCap = depth === 'full' ? 2000 : 120;
  const agentFilter = String(args?.agent_id || args?.agentId || '').trim() || null;
  const includeRaw = Array.isArray(args?.include)
    ? args.include.map((s: any) => String(s || '').trim().toLowerCase()).filter(Boolean)
    : null;
  // Default: every section on. `include` narrows to the requested sections.
  const wants = (section: string): boolean => !includeRaw || includeRaw.includes(section);
  const withOutputs = wants('outputs');

  const allJobs = scheduler.getJobs();
  const allTasks = listTasks();

  const jobs = allJobs.slice(0, limit).map((job) => ({
    ...summarizeJob(job),
    health: jobHealth(job),
    lastResult: (job as any).lastResult ? String((job as any).lastResult).slice(0, resultCap) : null,
  }));
  const tasks = allTasks.slice(0, limit).map((task) => snapshotTask(task, outputCap));

  const watches = listInternalWatches({ includeDone: args?.include_done === true || args?.includeDone === true })
    .slice(0, limit)
    .map((watch) => {
      let observation: any = null;
      if (watch.status === 'active') {
        try {
          observation = observeInternalWatchTarget(watch, scheduler);
          if (observation?.text) observation.text = `[${String(observation.text).length} chars]`;
        } catch (err: any) {
          observation = { error: String(err?.message || err) };
        }
      }
      return {
        id: watch.id,
        label: watch.label,
        status: watch.status,
        target: watch.target,
        expiresAt: watch.expiresAt,
        firedCount: watch.firedCount,
        maxFirings: watch.maxFirings,
        observation,
      };
    });
  const events = (() => {
    try {
      return peekPendingEvents(workspaceRoot()).slice(0, limit);
    } catch {
      return [];
    }
  })();

  // ── Agent-centric joined view: roster ⨝ jobs ⨝ tasks ⨝ recent output ──────
  let agents: Array<Record<string, any>> | undefined;
  if (wants('agents')) {
    const roster = getAgents().filter((a: any) => !agentFilter || a.id === agentFilter);
    agents = roster.map((a: any) => {
      const agentJobs = allJobs.filter((j) => String(j.subagent_id || '') === a.id);
      const agentJobIds = new Set(agentJobs.map((j) => j.id));
      const agentTasks = allTasks.filter(
        (t: any) => t.teamSubagent?.agentId === a.id || (t.scheduleId && agentJobIds.has(t.scheduleId)),
      );
      const recentRuns = withOutputs
        ? sortRunsDesc(agentJobs.flatMap((j) => snapshotRunsForJob(j, 3, outputCap))).slice(0, 5)
        : [];
      const lastOutput =
        recentRuns.find((r) => r.outputSummary)?.outputSummary ||
        (agentJobs.map((j) => (j as any).lastResult).find(Boolean)
          ? String(agentJobs.map((j) => (j as any).lastResult).find(Boolean)).slice(0, outputCap)
          : null);
      const tasksByStatus = agentTasks.reduce((acc: Record<string, number>, t: any) => {
        const s = String(t.status || 'unknown');
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});
      return {
        id: a.id,
        name: a.name || a.id,
        description: a.description || null,
        isTeamManager: (a as any).isTeamManager === true,
        teamRole: a.teamRole || null,
        default: a.default === true,
        jobCount: agentJobs.length,
        taskCount: agentTasks.length,
        tasksByStatus,
        jobs: agentJobs.slice(0, limit).map((j) => summarizeJob(j)),
        tasks: agentTasks.slice(0, limit).map((t: any) => snapshotTask(t, outputCap)),
        recentRuns,
        lastOutput,
      };
    });
  }

  // ── Team-centric joined view: team ⨝ members ⨝ jobs ⨝ recent tasks ────────
  let teams: Array<Record<string, any>> | undefined;
  if (wants('teams') && !agentFilter) {
    const roster = getAgents();
    teams = listManagedTeams().map((t: any) => {
      const memberIds: string[] = Array.isArray(t.subagentIds) ? t.subagentIds : [];
      const members = memberIds.map((id) => {
        const a = roster.find((r: any) => r.id === id);
        return { id, name: a?.name || id, isTeamManager: (a as any)?.isTeamManager === true };
      });
      const teamJobs = allJobs.filter((j) => String((j as any).team_id || '') === t.id);
      const teamTasks = allTasks.filter((task: any) => task.teamSubagent?.teamId === t.id);
      return {
        id: t.id,
        name: t.name,
        description: t.description || null,
        emoji: t.emoji || null,
        memberCount: members.length,
        members,
        jobs: teamJobs.slice(0, limit).map((j) => summarizeJob(j)),
        recentTasks: teamTasks.slice(0, limit).map((task: any) => snapshotTask(task, outputCap)),
      };
    });
  }

  const counts = {
    jobs: jobs.length,
    jobsByHealth: jobs.reduce((acc: Record<string, number>, job: any) => {
      const state = String(job.health?.state || 'unknown');
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {}),
    tasksByStatus: tasks.reduce((acc: Record<string, number>, task: any) => {
      const status = String(task.status || 'unknown');
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
    agents: agents ? agents.length : undefined,
    teams: teams ? teams.length : undefined,
    watches: watches.length,
    events: events.length,
  };
  const build = getBuildStatus();

  return {
    success: true,
    message: 'Automation dashboard snapshot loaded.',
    data: {
      generatedAt: new Date().toISOString(),
      depth,
      build,
      counts,
      ...(agents ? { agents } : {}),
      ...(teams ? { teams } : {}),
      scheduledJobs: jobs,
      tasks,
      internalWatches: watches,
      eventQueue: events,
    },
  };
}

export function clearLinkedBlockedTask(taskId: string, note?: string): Record<string, any> | null {
  const task = loadTask(taskId);
  if (!task) return null;
  task.pauseReason = undefined;
  task.pausedByScheduleId = undefined;
  task.shouldResumeAfterSchedule = undefined;
  if (note) {
    task.journal.push({ t: Date.now(), type: 'resume', content: note });
  }
  saveTask(task);
  updateTaskStatus(task.id, 'queued');
  return { id: task.id, title: task.title, status: 'queued' };
}
