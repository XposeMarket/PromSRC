import fs from 'fs';
import path from 'path';
import { automationDashboardTool } from '../scheduling/schedule-admin-tools';
import { listDurableRuntimes, listLiveRuntimes } from '../live-runtime-registry';
import { getErrorWatchdogSummary, loadWatchdogState } from '../errors/error-watchdog';
import { isProviderStatusChecking, readProviderStatusCache } from '../provider-status';
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

export function systemDiagnosticsTool(deps: DiagnosticDeps, args: any = {}): { success: true; message: string; data: any } {
  const now = deps.now?.() ?? Date.now();
  const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)));
  const depth = String(args.depth || 'summary') === 'full' ? 'full' : 'summary';
  const configDir = deps.configDir || getConfig().getConfigDir();
  const issues: any[] = [];

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
  const unhealthyJobs = (automationData?.scheduledJobs || []).filter((job: any) => !['healthy', 'idle', 'unknown'].includes(String(job?.health?.state || 'unknown')));
  const troubledTasks = (automationData?.tasks || []).filter((task: any) => ['failed', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(String(task?.status || '')));
  if (unhealthyJobs.length) issues.push({ code: 'automation_job_unhealthy', severity: 'warning', subsystem: 'automation', summary: `${unhealthyJobs.length} scheduled job(s) need attention.`, nextInspectionTool: 'schedule_job_detail' });
  if (troubledTasks.length) issues.push({ code: 'task_needs_attention', severity: 'warning', subsystem: 'tasks', summary: `${troubledTasks.length} task(s) need attention.`, nextInspectionTool: 'task_control' });

  const runtimeRows = [...listLiveRuntimes(), ...listDurableRuntimes()];
  const runtimes = runtimeRows.slice(0, limit).map((row: any) => ({
    id: row.id, kind: row.kind || row.type, label: row.label || row.title,
    status: row.status, taskId: row.taskId, agentId: row.agentId, scheduleId: row.scheduleId,
    lastUpdatedAt: row.updatedAt || row.lastUpdatedAt, ageMs: age(now, row.updatedAt || row.lastUpdatedAt || row.startedAt),
  }));
  const interrupted = runtimes.filter((row: any) => ['interrupted', 'stalled', 'failed', 'recoverable'].includes(String(row.status || '')));
  if (interrupted.length) issues.push({ code: 'runtime_interrupted', severity: 'warning', subsystem: 'runtime', summary: `${interrupted.length} runtime(s) are interrupted or recoverable.`, nextInspectionTool: 'agent_run_ops' });

  const watchdog = getErrorWatchdogSummary();
  const watchdogState: any = loadWatchdogState();
  if (watchdog.recurring) issues.push({ code: 'watchdog_recurring_error', severity: 'warning', subsystem: 'errors', summary: `${watchdog.recurring} recurring error fingerprint(s) detected.` });
  const errors = {
    ...watchdog,
    topErrors: undefined,
    recent: (watchdogState.errors || []).sort((a: any, b: any) => Number(b.lastSeenAt) - Number(a.lastSeenAt)).slice(0, limit).map((entry: any) => ({
      id: String(entry.id || entry.fingerprint || '').slice(0, 16), occurrences: entry.occurrences,
      firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt,
      taskCount: Array.isArray(entry.taskIds) ? entry.taskIds.length : 0, repairProposed: entry.repairProposed === true,
    })),
  };

  const providerCache = readProviderStatusCache();
  const provider = {
    state: isProviderStatusChecking() ? 'checking' : providerCache ? (providerCache.connected ? 'online' : 'offline') : 'unknown',
    checkedAt: providerCache?.checkedAt || null,
    ageMs: age(now, providerCache?.checkedAt),
    source: 'cached_status',
  };
  if (provider.state === 'offline') issues.push({ code: 'provider_offline', severity: 'error', subsystem: 'provider', summary: 'The last observed provider status is offline.' });

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
      automation: { counts: automationData?.counts || {}, unhealthyJobs: unhealthyJobs.slice(0, limit), troubledTasks: troubledTasks.slice(0, limit) },
      runtimes: { count: runtimeRows.length, interruptedCount: interrupted.length, items: depth === 'full' ? runtimes : interrupted },
      errors, provider, build: getBuildStatus(), restart, audit, issues: issues.slice(0, limit),
    },
  };
}
