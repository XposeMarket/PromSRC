import fs from 'fs';
import path from 'path';
import { automationDashboardTool, jobHealth } from '../scheduling/schedule-admin-tools';
import { listDurableRuntimes, listLiveRuntimes } from '../live-runtime-registry';
import { getErrorWatchdogSummary, loadWatchdogState } from '../errors/error-watchdog';
import { readProviderStatusEvidence } from '../provider-status';
import { getBuildStatus } from '../../runtime/build-status';
import { listPendingStartupNotifications, readRestartContext } from '../lifecycle';
import { getConfig } from '../../config/config';

type DiagnosticDeps = { scheduler: any; workspacePath: string; configDir?: string; now?: () => number };

function readJson(file: string): any | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function age(now: number, value: any): number | null {
  const n = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(n) && n > 0 ? Math.max(0, now - n) : null;
}

const INTERRUPTED_RUNTIME_STATUSES = new Set(['interrupted', 'stalled', 'failed', 'recoverable']);

export function classifyJobDiagnostics(jobs: any[]) {
  const liveFailures = new Set(['error_backoff', 'overdue', 'output_alert']);
  return {
    unhealthyJobs: jobs.filter((job) => liveFailures.has(String(job.health?.state))),
    intentionalJobs: jobs.filter((job) => job.health?.state === 'paused'),
    unverifiedJobs: jobs.filter((job) => ['unknown', 'unverified'].includes(String(job.health?.state || 'unknown'))),
  };
}

export function summarizeRuntimeDiagnostics(runtimeRows: any[], now: number, limit: number, depth: 'summary' | 'full') {
  const seenRuntimeIds = new Set<string>();
  const rows = runtimeRows
    .filter((row: any) => {
      const id = String(row?.id || '').trim();
      if (!id) return true;
      if (seenRuntimeIds.has(id)) return false;
      seenRuntimeIds.add(id);
      return true;
    })
    .map((row: any) => ({
      id: row.id, kind: row.kind || row.type, label: row.label || row.title,
      status: row.status, taskId: row.taskId, agentId: row.agentId, scheduleId: row.scheduleId,
      lastUpdatedAt: row.updatedAt || row.lastUpdatedAt, ageMs: age(now, row.updatedAt || row.lastUpdatedAt || row.startedAt),
    }));
  // Live runtimes are persisted to the durable ledger under the same runtime ID.
  // The caller passes live rows first, so deduplication keeps the freshest in-memory
  // snapshot while preventing duplicate counts/items from the durable copy.
  // Detect faults before applying the display limit so a truncated snapshot cannot
  // report a false clean runtime state. The returned items remain bounded.
  const interrupted = rows.filter((row: any) => INTERRUPTED_RUNTIME_STATUSES.has(String(row.status || '')));
  return {
    count: rows.length,
    interruptedCount: interrupted.length,
    items: depth === 'full' ? rows.slice(0, limit) : interrupted.slice(0, limit),
    interrupted,
  };
}

export function systemDiagnosticsTool(deps: DiagnosticDeps, args: any = {}): { success: true; message: string; data: any } {
  const now = deps.now?.() ?? Date.now();
  const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)));
  const depth = String(args.depth || 'summary') === 'full' ? 'full' : 'summary';
  const configDir = deps.configDir || getConfig().getConfigDir();
  const issues: any[] = [];
  const historicalIssues: any[] = [];

  const gatewayRaw = readJson(path.join(configDir, 'gateway-runtime-status.json'));
  const heartbeatAt = gatewayRaw?.lastHeartbeatAt || gatewayRaw?.updatedAt || gatewayRaw?.timestamp;
  const heartbeatAgeMs = age(now, heartbeatAt);
  const gatewayState = !gatewayRaw ? 'missing' : heartbeatAgeMs !== null && heartbeatAgeMs <= 15_000 ? 'healthy' : 'stale';
  if (gatewayState !== 'healthy') issues.push({ code: `gateway_${gatewayState}`, severity: 'error', subsystem: 'gateway', summary: `Gateway heartbeat is ${gatewayState}.` });
  const gateway = {
    state: gatewayState,
    observedAt: heartbeatAt || null,
    ageMs: heartbeatAgeMs,
    source: 'gateway_runtime_status',
    pid: Number(gatewayRaw?.pid) || undefined,
    modelBusy: gatewayRaw?.modelBusy === true,
  };

  const dashboard = automationDashboardTool(deps.scheduler, { limit, depth: 'summary', include: [] });
  const automationData: any = dashboard.success ? dashboard.data : {};
  // Classify before applying the display limit: a later failing job must not disappear.
  const jobRows = deps.scheduler.getJobs().map((job: any) => ({
    id: job.id, name: job.name, enabled: job.enabled, status: job.status, health: jobHealth(job),
  }));
  const jobDiagnostics = classifyJobDiagnostics(jobRows);
  const { unhealthyJobs, intentionalJobs, unverifiedJobs } = jobDiagnostics;
  const troubledTasks = (automationData?.tasks || []).filter((task: any) => ['failed', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(String(task?.status || '')));
  if (unhealthyJobs.length) issues.push({ code: 'automation_job_unhealthy', severity: 'warning', subsystem: 'automation', summary: `${unhealthyJobs.length} scheduled job(s) need attention.`, nextInspectionTool: 'schedule_job_detail' });
  if (troubledTasks.length) issues.push({ code: 'task_needs_attention', severity: 'warning', subsystem: 'tasks', summary: `${troubledTasks.length} task(s) need attention.`, nextInspectionTool: 'task_control' });

  const runtimeRows = [...listLiveRuntimes(), ...listDurableRuntimes()];
  const runtimeDiagnostics = summarizeRuntimeDiagnostics(runtimeRows, now, limit, depth);
  if (runtimeDiagnostics.interruptedCount) issues.push({ code: 'runtime_interrupted', severity: 'warning', subsystem: 'runtime', summary: `${runtimeDiagnostics.interruptedCount} runtime(s) are interrupted or recoverable.`, nextInspectionTool: 'agent_run_ops' });

  const watchdog = getErrorWatchdogSummary();
  const watchdogState: any = loadWatchdogState();
  if (watchdog.recurring) historicalIssues.push({ code: 'watchdog_recurring_error', subsystem: 'errors', summary: `${watchdog.recurring} recurring error fingerprint(s) recorded; these are historical observations, not a live health probe.` });
  const errors = {
    ...watchdog,
    topErrors: undefined,
    recent: (watchdogState.errors || []).sort((a: any, b: any) => Number(b.lastSeenAt) - Number(a.lastSeenAt)).slice(0, limit).map((entry: any) => ({
      id: String(entry.id || entry.fingerprint || '').slice(0, 16), occurrences: entry.occurrences,
      firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt,
      taskCount: Array.isArray(entry.taskIds) ? entry.taskIds.length : 0, repairProposed: entry.repairProposed === true,
    })),
  };

  const evidence = readProviderStatusEvidence(undefined, now);
  const provider = {
    ...evidence,
    state: evidence.checking ? 'checking'
      : evidence.freshness !== 'fresh' || evidence.scope !== 'configured_provider_connection' ? 'unknown'
      : evidence.result === 'success' ? 'online' : 'check_failed',
  };
  if (provider.state === 'check_failed') issues.push({ code: 'provider_check_failed', severity: 'warning', subsystem: 'provider', summary: `The ${provider.provider} connection probe returned ${provider.result}; this does not establish the health of an active chat model.` });

  const auditRaw = readJson(path.join(deps.workspacePath, 'audit', '_index', 'global.json'));
  const auditAgeMs = age(now, auditRaw?.generatedAt);
  const intervalMs = Number(auditRaw?.materializer?.intervalMs) || 300_000;
  const audit = {
    available: !!auditRaw, generatedAt: auditRaw?.generatedAt || null, ageMs: auditAgeMs,
    intervalMs, stale: !auditRaw || auditAgeMs === null || auditAgeMs > Math.max(intervalMs * 2, 11 * 60_000),
    errors: Number(auditRaw?.materializer?.errors) || 0,
    provenance: 'materialized_mirror', canonical: false,
  };
  if (audit.stale) issues.push({ code: 'audit_stale', severity: 'warning', subsystem: 'audit', summary: 'The audit mirror is missing or stale; use live tools for current state.' });

  const restartContext: any = readRestartContext();
  const notifications: any[] = listPendingStartupNotifications();
  const restart = {
    contextPending: !!restartContext,
    reason: restartContext?.reason || null,
    createdAt: restartContext?.timestamp || null,
    ageMs: age(now, restartContext?.timestamp),
    pendingNotifications: notifications.length,
  };
  if (notifications.length) issues.push({ code: 'restart_notification_pending', severity: 'warning', subsystem: 'restart', summary: `${notifications.length} startup notification(s) remain pending.` });

  const overall = issues.some((issue) => issue.severity === 'error') ? 'degraded' : issues.length ? 'attention' : 'healthy';
  return {
    success: true,
    message: 'System diagnostic snapshot loaded.',
    data: {
      generatedAt: new Date(now).toISOString(), depth,
      overall: { state: overall, issueCount: issues.length },
      gateway,
      automation: {
        counts: {
          ...(automationData?.counts || {}), jobs: jobRows.length,
          jobsByHealth: jobRows.reduce((counts: Record<string, number>, job: any) => { const state = String(job.health.state || 'unknown'); counts[state] = (counts[state] || 0) + 1; return counts; }, {}),
          unhealthyJobs: unhealthyJobs.length, intentionalJobs: intentionalJobs.length, unverifiedJobs: unverifiedJobs.length,
        },
        unhealthyJobs: unhealthyJobs.slice(0, limit), intentionalJobs: intentionalJobs.slice(0, limit),
        unverifiedJobs: unverifiedJobs.slice(0, limit), troubledTasks: troubledTasks.slice(0, limit),
      },
      runtimes: { count: runtimeDiagnostics.count, interruptedCount: runtimeDiagnostics.interruptedCount, items: runtimeDiagnostics.items },
      errors, provider, build: getBuildStatus(), restart, audit, issues: issues.slice(0, limit), historicalIssues: historicalIssues.slice(0, limit),
    },
  };
}
