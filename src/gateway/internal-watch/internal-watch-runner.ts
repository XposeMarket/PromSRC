import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { listTasks, loadTask } from '../tasks/task-store';
import {
  getActiveInternalWatches,
  updateInternalWatch,
  type InternalWatch,
} from './internal-watch-store';
import { getLastMainSessionId, isModelBusy, setModelBusy } from '../comms/broadcaster';
import { findArchivedScheduledJob } from '../scheduling/schedule-archive';
import { addPendingRuntimeSteerForSession } from '../live-runtime-registry';
import { getApprovalQueue, serializeApprovalForClient } from '../verification-flow';

type RunInteractiveTurn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  reasoningOptions?: any,
  attachments?: any,
  attachmentPreviews?: any,
  modelOverride?: string,
  flags?: any,
  turnOriginInput?: any,
) => Promise<{ type: string; text: string; thinking?: string; toolResults?: any[]; artifacts?: any[] }>;

export interface InternalWatchRunnerDeps {
  runInteractiveTurn: RunInteractiveTurn;
  broadcast: (data: any) => void;
  cronScheduler?: any;
  tickMs?: number;
}

interface Observation {
  exists?: boolean;
  hash?: string;
  mtimeMs?: number;
  size?: number;
  text?: string;
  status?: string;
  finalSummary?: string;
  lastRun?: string | null;
  lastResult?: string | null;
  event?: any;
  error?: string;
  [key: string]: any;
}

type InternalWatchDeliveryKind = 'match' | 'timeout' | 'gateway_restart_interruption';

const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed', 'needs_assistance', 'awaiting_user_input', 'paused', 'stalled']);
const TOOL_LIMITED_SESSION_RE = /^(task_|task_recovery_|task_resume_brief_|subagent_|run_once_|cron_|schedule_|auto_|team_dispatch_|team_member_room_|team_coord_|proposal_|code_exec|background_)/i;

function normalizeRelPath(raw: any): string {
  return String(raw || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveWorkspaceWatchPath(raw: any, configuredRoot?: any): string {
  const workspaceRoot = path.resolve(String(configuredRoot || getConfig().getWorkspacePath()));
  const rel = normalizeRelPath(raw);
  if (!rel) throw new Error('file path is required');
  if (path.isAbsolute(rel)) throw new Error('file watches must use workspace-relative paths');
  const abs = path.resolve(workspaceRoot, rel);
  const relToRoot = path.relative(workspaceRoot, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error('file watch path must stay inside the workspace');
  }
  return abs;
}

export function observeInternalWatchTarget(watch: InternalWatch, cronScheduler?: any): Observation {
  const cfg = watch.target.config || {};
  if (watch.target.type === 'file') {
    const abs = resolveWorkspaceWatchPath(cfg.path || cfg.file || cfg.relativePath, cfg.workspaceRoot || cfg.workspace_root);
    if (!fs.existsSync(abs)) return { exists: false, path: normalizeRelPath(cfg.path || cfg.file || cfg.relativePath) };
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return { exists: false, path: normalizeRelPath(cfg.path || cfg.file || cfg.relativePath), error: 'not_a_file' };
    const content = fs.readFileSync(abs);
    const text = content.toString('utf-8');
    return {
      exists: true,
      path: normalizeRelPath(cfg.path || cfg.file || cfg.relativePath),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
      text: text.slice(0, 200_000),
    };
  }

  if (watch.target.type === 'task') {
    const taskId = String(cfg.taskId || cfg.task_id || '').trim();
    if (!taskId) return { exists: false, error: 'task_id_required' };
    const task = loadTask(taskId) || listTasks()
      .filter((candidate) => candidate.scheduleId === taskId)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
    if (!task) return { exists: false, taskId };
    const plan = Array.isArray(task.plan) ? task.plan : [];
    const currentStepIndex = Number.isFinite(Number(task.currentStepIndex)) ? Number(task.currentStepIndex) : 0;
    const currentStep = plan.find((step: any) => Number(step?.index) === currentStepIndex) || plan[currentStepIndex] || null;
    const completedSteps = plan.filter((step: any) => step?.status === 'done' || step?.status === 'skipped').length;
    const unfinishedSteps = plan
      .filter((step: any) => step?.status !== 'done' && step?.status !== 'skipped')
      .slice(0, 8)
      .map((step: any) => ({
        index: step?.index,
        status: step?.status,
        description: String(step?.description || '').slice(0, 240),
      }));
    const pendingApprovals = getApprovalQueue().listPending()
      .filter((approval) => String(approval.taskId || '') === task.id)
      .slice(0, 8)
      .map((approval) => serializeApprovalForClient(approval));
    return {
      exists: true,
      taskId: task.id,
      watchedId: taskId,
      scheduleId: task.scheduleId || null,
      status: task.status,
      pauseReason: task.pauseReason || null,
      pausedAt: task.pausedAt || null,
      pausedAtStepIndex: task.pausedAtStepIndex ?? null,
      finalSummary: task.finalSummary || '',
      completedAt: task.completedAt,
      title: task.title,
      sessionId: task.sessionId,
      originatingSessionId: task.originatingSessionId || null,
      subagentProfile: task.subagentProfile || null,
      teamSubagent: task.teamSubagent || null,
      currentStepIndex,
      currentStep: currentStep ? {
        index: currentStep.index,
        status: currentStep.status,
        description: String(currentStep.description || '').slice(0, 240),
      } : null,
      totalSteps: plan.length,
      completedSteps,
      unfinishedSteps,
      lastToolCall: task.lastToolCall || null,
      lastToolCallAt: task.lastToolCallAt || null,
      lastProgressAt: task.lastProgressAt || null,
      originalRequest: String(task.originalAssignment || task.prompt || '').slice(0, 2_000),
      pendingClarificationQuestion: task.pendingClarificationQuestion || null,
      pendingApprovalCount: pendingApprovals.length,
      pendingApprovals,
      checkpoint: String(task.resumeContext?.onResumeInstruction || '').slice(-6_000),
      pauseSnapshot: task.pauseSnapshot ? {
        createdAt: task.pauseSnapshot.createdAt,
        currentStepIndex: task.pauseSnapshot.currentStepIndex,
        currentStepDescription: task.pauseSnapshot.currentStepDescription || '',
        completedSteps: task.pauseSnapshot.completedSteps,
        totalSteps: task.pauseSnapshot.totalSteps,
        pauseReason: task.pauseSnapshot.pauseReason || null,
      } : null,
    };
  }

  if (watch.target.type === 'scheduled_job') {
    const jobId = String(cfg.jobId || cfg.job_id || '').trim();
    if (!jobId) return { exists: false, error: 'job_id_required' };
    const job = cronScheduler?.getJobs?.().find((j: any) => String(j?.id || '') === jobId)
      || findArchivedScheduledJob(jobId);
    if (!job) return { exists: false, jobId };
    return {
      exists: true,
      jobId,
      status: String(job.status || ''),
      lastRun: job.lastRun || null,
      lastResult: job.lastResult || null,
      lastDuration: job.lastDuration || null,
      lastOutputSessionId: job.lastOutputSessionId || null,
      nextRun: job.nextRun || null,
      name: job.name || '',
    };
  }

  if (watch.target.type === 'event_queue') {
    const workspaceRoot = path.resolve(String(cfg.workspaceRoot || cfg.workspace_root || getConfig().getWorkspacePath()));
    const queuePath = path.join(workspaceRoot, 'events', 'pending.json');
    if (!fs.existsSync(queuePath)) return { exists: false, path: 'events/pending.json' };
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    const match = watch.condition?.match || cfg.match || {};
    const found = events.find((event: any) => {
      if (!match || typeof match !== 'object') return true;
      return Object.entries(match).every(([key, value]) => String(event?.[key] ?? '') === String(value));
    });
    return {
      exists: true,
      path: 'events/pending.json',
      event: found || null,
      eventCount: events.length,
    };
  }

  return { exists: false, error: 'unsupported_target' };
}

function textChecksPass(condition: InternalWatch['condition'], obs: Observation): boolean {
  const text = String(obs.text || obs.finalSummary || obs.lastResult || JSON.stringify(obs.event || obs));
  const requireText = String(condition.requireText || '').trim();
  const absentText = String(condition.absentText || '').trim();
  if (requireText && !text.includes(requireText)) return false;
  if (absentText && text.includes(absentText)) return false;
  return true;
}

function hasChanged(watch: InternalWatch, obs: Observation): boolean {
  const prev = watch.lastObservation || {};
  if (!prev.exists && obs.exists) return true;
  if (prev.hash && obs.hash && prev.hash !== obs.hash) return true;
  if (Number.isFinite(Number(prev.mtimeMs)) && Number.isFinite(Number(obs.mtimeMs)) && Number(prev.mtimeMs) !== Number(obs.mtimeMs)) return true;
  if (prev.lastRun && obs.lastRun && prev.lastRun !== obs.lastRun) return true;
  if (prev.status && obs.status && prev.status !== obs.status) return true;
  if (Number.isFinite(Number(prev.currentStepIndex)) && Number.isFinite(Number(obs.currentStepIndex)) && Number(prev.currentStepIndex) !== Number(obs.currentStepIndex)) return true;
  if (Number.isFinite(Number(prev.completedSteps)) && Number.isFinite(Number(obs.completedSteps)) && Number(prev.completedSteps) !== Number(obs.completedSteps)) return true;
  if (Number(prev.pendingApprovalCount || 0) !== Number(obs.pendingApprovalCount || 0)) return true;
  return false;
}

export function internalWatchMatches(watch: InternalWatch, obs: Observation): boolean {
  const condition = watch.condition || {};
  const mode = String(condition.mode || '').trim().toLowerCase();

  if (watch.target.type === 'file') {
    const fileMode = mode || 'appears_or_changes';
    if (fileMode === 'exists' || fileMode === 'appears') {
      return obs.exists === true && textChecksPass(condition, obs);
    }
    if (fileMode === 'changes' || fileMode === 'appears_or_changes') {
      return obs.exists === true && hasChanged(watch, obs) && textChecksPass(condition, obs);
    }
  }

  if (watch.target.type === 'task') {
    // A restart pause is an intermediate recovery event, never the watched
    // task's final result. The runner wakes Prometheus separately and keeps
    // this watch active for its original completion condition.
    if (String(obs.status || '') === 'paused' && String(obs.pauseReason || '') === 'gateway_restart') return false;
    if (mode === 'changes' || mode === 'milestones') {
      return !!obs.exists && hasChanged(watch, obs) && textChecksPass(condition, obs);
    }
    const statuses = Array.isArray(condition.terminalStatuses) && condition.terminalStatuses.length
      ? new Set(condition.terminalStatuses.map((s) => String(s)))
      : TERMINAL_TASK_STATUSES;
    return !!obs.exists && !!obs.status && statuses.has(String(obs.status)) && textChecksPass(condition, obs);
  }

  if (watch.target.type === 'scheduled_job') {
    if (!obs.exists) return false;
    if ((mode === 'latest_result' || mode === 'ran') && hasChanged(watch, obs) && obs.lastRun) return textChecksPass(condition, obs);
    if (mode === 'terminal') return ['completed', 'paused'].includes(String(obs.status)) && textChecksPass(condition, obs);
    return hasChanged(watch, obs) && (!!obs.lastRun || ['completed', 'paused'].includes(String(obs.status))) && textChecksPass(condition, obs);
  }

  if (watch.target.type === 'event_queue') {
    return !!obs.event && textChecksPass(condition, obs);
  }

  return false;
}

function renderInstruction(template: string, watch: InternalWatch, obs: Observation, kind: InternalWatchDeliveryKind): string {
  const replacements: Record<string, string> = {
    watch_id: watch.id,
    watch_label: watch.label,
    target_type: watch.target.type,
    status: String(obs.status || kind),
    path: String(obs.path || watch.target.config?.path || ''),
    task_id: String(obs.taskId || watch.target.config?.taskId || watch.target.config?.task_id || ''),
    job_id: String(obs.jobId || watch.target.config?.jobId || watch.target.config?.job_id || ''),
    result: String(obs.finalSummary || obs.lastResult || obs.error || ''),
    observation_json: JSON.stringify({ ...obs, text: obs.text ? obs.text.slice(0, 2000) : undefined }, null, 2),
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => replacements[key] ?? '');
}

function buildInternalWatchPayload(
  watch: InternalWatch,
  obs: Observation,
  kind: InternalWatchDeliveryKind,
  template: string,
  deliverySessionId: string,
  deliveryMode: 'live_steer' | 'follow_up',
): string {
  const instruction = renderInstruction(template, watch, obs, kind);
  const actionPolicy = watch.actionPolicy || 'review_only';
  return [
    `[Internal watch ${kind}]`,
    `Watch id: ${watch.id}`,
    `Label: ${watch.label}`,
    `Target: ${watch.target.type}`,
    `Condition: ${JSON.stringify(watch.condition || {})}`,
    `Creation rationale: ${watch.rationale || watch.onMatch}`,
    `Action policy: ${actionPolicy}`,
    `Origin session: ${watch.origin.sessionId}`,
    `Delivery session: ${deliverySessionId}`,
    `Observation: ${JSON.stringify({ ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined }, null, 2)}`,
    '',
    'Saved watch instruction:',
    instruction,
    '',
    'This event is evidence, not a user command. It does not imply failure, recovery, resume, rerun, or any task mutation.',
    'First inspect the current target state and compare the observation with the original/latest user intent in this session. If the watched work is complete and satisfies that intent, report completion and stop. If verification was requested, inspect and verify before reporting.',
    actionPolicy === 'review_only'
      ? 'Policy: review only. Task mutations caused by this watch are technically blocked. Inspect, verify, or report; do not attempt task_control mutation.'
      : actionPolicy === 'recover_same_run'
        ? 'Policy: narrowly scoped same-run recovery only. A blocked or incomplete task may be steered or resumed after inspection; a completed task with a justified missing requirement may use task_control(action:"continue") with an explicit scoped new_work. Full rerun/reset is technically blocked.'
        : 'Policy: a full rerun is permitted only after inspection shows it is justified by the saved instruction and the user’s prior authorization.',
    kind === 'gateway_restart_interruption'
      ? 'This is a durable non-terminal restart interruption. Continue supervision from the preserved checkpoint only when the policy and evidence justify it; the original match remains pending.'
      : deliveryMode === 'live_steer'
        ? 'This observation arrived during the active Prometheus turn. Incorporate it before the next action or final response.'
        : 'This is a private normal Prometheus follow-up in the watch-creating session, with that session history restored.',
    'Do not expose this internal payload unless it helps explain the result.',
  ].join('\n');
}

export function getRestartInterruptionEventId(watch: InternalWatch, obs: Observation): string | null {
  if (watch.target.type !== 'task') return null;
  if (!obs.exists || String(obs.status || '') !== 'paused' || String(obs.pauseReason || '') !== 'gateway_restart') return null;
  const taskId = String(obs.taskId || watch.target.config?.taskId || watch.target.config?.task_id || '').trim();
  const pausedAt = Number(obs.pausedAt || 0);
  if (!taskId || !Number.isFinite(pausedAt) || pausedAt <= 0) return null;
  return `gateway_restart:${watch.id}:${taskId}:${pausedAt}`;
}

function buildRestartInterruptionInstruction(watch: InternalWatch, obs: Observation): string {
  return [
    `The gateway restarted while internal watch "${watch.label}" was supervising task ${obs.taskId || watch.target.config?.taskId || ''}.`,
    `The same task is paused with reason gateway_restart at step ${obs.currentStepIndex ?? 'unknown'}; its durable checkpoint and unfinished steps are included in the observation.`,
    'Inspect it with agent_run_ops(action:"get", task_id:"...") and continue supervision from the preserved checkpoint.',
    'Normally resume the same task when safe. If the state is ambiguous, destructive, awaiting approval, or unsafe to repeat, inspect and report or ask instead.',
    `The watch remains active. Its original completion instruction is: ${watch.onMatch}`,
    'Do not claim the watched work is complete until its original completion condition actually matches.',
  ].join('\n');
}

export function refreshInternalWatchObservation(watch: InternalWatch, cronScheduler?: any): InternalWatch {
  if (watch.status !== 'active') return watch;
  try {
    const obs = watch.pendingMatchObservation || observeInternalWatchTarget(watch, cronScheduler);
    const matched = !!watch.pendingMatchObservation || internalWatchMatches(watch, obs);
    const compactObservation = { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined };
    return updateInternalWatch(watch.id, {
      lastCheckedAt: new Date().toISOString(),
      lastObservation: compactObservation,
      error: undefined,
      ...(matched ? {
        pendingMatchObservation: { ...obs, text: obs.text ? String(obs.text).slice(0, 20_000) : undefined },
        matchPendingAt: watch.matchPendingAt || new Date().toISOString(),
      } : {}),
    }) || watch;
  } catch (err: any) {
    return updateInternalWatch(watch.id, {
      lastCheckedAt: new Date().toISOString(),
      error: String(err?.message || err),
    }) || watch;
  }
}

function isToolLimitedSessionId(sessionId: string): boolean {
  const sid = String(sessionId || '').trim();
  return !sid || TOOL_LIMITED_SESSION_RE.test(sid);
}

/** Timer-like routing: a watch wakes the creating main-chat thread before task provenance fallbacks. */
export function resolveWatchDeliverySessionId(watch: InternalWatch, obs: Observation): string {
  const candidates = [
    watch.deliverySessionId,
    watch.origin?.sessionId,
    obs.originatingSessionId,
    getLastMainSessionId(),
    'default',
  ];
  for (const candidate of candidates) {
    const sid = String(candidate || '').trim();
    if (sid && !isToolLimitedSessionId(sid)) return sid;
  }
  return 'default';
}

export class InternalWatchRunner {
  private timer: NodeJS.Timeout | null = null;
  private runningWatchIds = new Set<string>();
  private readonly runInteractiveTurn: RunInteractiveTurn;
  private readonly broadcast: (data: any) => void;
  private readonly cronScheduler: any;
  private readonly tickMs: number;

  constructor(deps: InternalWatchRunnerDeps) {
    this.runInteractiveTurn = deps.runInteractiveTurn;
    this.broadcast = deps.broadcast;
    this.cronScheduler = deps.cronScheduler;
    this.tickMs = Math.max(1000, Math.floor(Number(deps.tickMs) || 5000));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.warn('[InternalWatchRunner] tick failed:', err?.message || err));
    }, this.tickMs);
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    this.tick().catch(() => {});
    console.log(`[InternalWatchRunner] Started - ticking every ${this.tickMs}ms`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const watch of getActiveInternalWatches().slice(0, 50)) {
      if (this.runningWatchIds.has(watch.id)) continue;
      try {
        if (watch.pendingRestartInterruption) {
          if (!isModelBusy()) {
            this.fireRestartInterruption(watch).catch((err) => {
              updateInternalWatch(watch.id, { error: String(err?.message || err), lastCheckedAt: new Date().toISOString() });
            });
          }
          continue;
        }
        const pendingObservation = watch.pendingMatchObservation;
        const obs = pendingObservation || observeInternalWatchTarget(watch, this.cronScheduler);
        const restartInterruptionId = getRestartInterruptionEventId(watch, obs);
        if (restartInterruptionId && restartInterruptionId !== watch.lastDeliveredRestartInterruptionId) {
          const pendingRestartInterruption = {
            eventId: restartInterruptionId,
            createdAt: new Date().toISOString(),
            observation: { ...obs, text: obs.text ? String(obs.text).slice(0, 20_000) : undefined },
          };
          const persisted = updateInternalWatch(watch.id, {
            lastCheckedAt: new Date().toISOString(),
            lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
            pendingRestartInterruption,
          }) || watch;
          if (!isModelBusy()) {
            this.fireRestartInterruption(persisted).catch((err) => {
              updateInternalWatch(watch.id, { error: String(err?.message || err), lastCheckedAt: new Date().toISOString() });
            });
          } else {
            const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
            this.broadcast({
              type: 'internal_watch_restart_waiting',
              watchId: watch.id,
              eventId: restartInterruptionId,
              sessionId: deliverySessionId,
              originSessionId: watch.origin.sessionId,
            });
          }
          continue;
        }
        if (new Date(watch.expiresAt).getTime() <= now) {
          this.fireTimeout(watch).catch((err) => {
            updateInternalWatch(watch.id, { error: String(err?.message || err), lastCheckedAt: new Date().toISOString() });
          });
          continue;
        }
        const matched = !!pendingObservation || internalWatchMatches(watch, obs);
        if (matched && !isModelBusy()) {
          updateInternalWatch(watch.id, { lastCheckedAt: new Date().toISOString() });
          this.fireMatch(watch, obs).catch((err) => {
            updateInternalWatch(watch.id, { error: String(err?.message || err), lastCheckedAt: new Date().toISOString() });
          });
        } else if (matched) {
          if (this.steerActiveTurn(watch, obs, 'match', watch.onMatch)) continue;
          updateInternalWatch(watch.id, {
            lastCheckedAt: new Date().toISOString(),
            lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
            pendingMatchObservation: { ...obs, text: obs.text ? String(obs.text).slice(0, 20_000) : undefined },
            matchPendingAt: watch.matchPendingAt || new Date().toISOString(),
          });
          const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
          this.broadcast({ type: 'internal_watch_waiting', watchId: watch.id, watch, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId });
        } else {
          updateInternalWatch(watch.id, {
            lastCheckedAt: new Date().toISOString(),
            lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
          });
        }
      } catch (err: any) {
        updateInternalWatch(watch.id, {
          lastCheckedAt: new Date().toISOString(),
          error: String(err?.message || err),
        });
      }
    }
  }

  private async fireRestartInterruption(watch: InternalWatch): Promise<void> {
    const pending = watch.pendingRestartInterruption;
    if (!pending || this.runningWatchIds.has(watch.id) || isModelBusy()) return;
    this.runningWatchIds.add(watch.id);
    try {
      setModelBusy(true);
      const obs = pending.observation || {};
      await this.deliver(
        watch,
        obs,
        'gateway_restart_interruption',
        buildRestartInterruptionInstruction(watch, obs),
      );
      updateInternalWatch(watch.id, {
        pendingRestartInterruption: undefined,
        lastDeliveredRestartInterruptionId: pending.eventId,
        error: undefined,
      });
      const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
      this.broadcast({
        type: 'internal_watch_restart_delivered',
        watchId: watch.id,
        eventId: pending.eventId,
        taskId: obs.taskId,
        sessionId: deliverySessionId,
        originSessionId: watch.origin.sessionId,
      });
    } finally {
      setModelBusy(false);
      this.runningWatchIds.delete(watch.id);
    }
  }

  private async fireMatch(watch: InternalWatch, obs: Observation): Promise<void> {
    this.runningWatchIds.add(watch.id);
    if (isModelBusy()) {
      this.runningWatchIds.delete(watch.id);
      return;
    }
    try {
      setModelBusy(true);
      const firedCount = watch.firedCount + 1;
      const terminal = firedCount >= watch.maxFirings;
      updateInternalWatch(watch.id, {
        status: 'active',
        lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
        pendingMatchObservation: { ...obs, text: obs.text ? String(obs.text).slice(0, 20_000) : undefined },
        matchPendingAt: watch.matchPendingAt || new Date().toISOString(),
      });
      const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
      await this.deliver(watch, obs, 'match', watch.onMatch);
      updateInternalWatch(watch.id, {
        status: terminal ? 'matched' : 'active',
        firedCount,
        matchedAt: new Date().toISOString(),
        completedAt: terminal ? new Date().toISOString() : undefined,
        lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
        pendingMatchObservation: undefined,
        matchPendingAt: undefined,
        error: undefined,
      });
      this.broadcast({ type: 'internal_watch_matched', watchId: watch.id, watch, observation: obs, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId });
      if (watch.target.type === 'task' && /^Voice task watch:/i.test(watch.label)) {
        const status = String(obs.status || '');
        const critical = ['complete', 'failed', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input'].includes(status);
        this.broadcast({
          type: 'voice_worker_update',
          id: `voice_watch_${watch.id}_${Date.now()}`,
          sessionId: watch.origin.sessionId,
          taskId: String(obs.taskId || watch.target.config?.taskId || ''),
          title: String(obs.title || watch.label.replace(/^Voice task watch:\s*/i, '')),
          kind: status === 'complete' ? 'complete' : critical ? 'paused' : 'milestone',
          critical,
          status,
          text: status === 'complete'
            ? `${obs.title || 'The watched task'} completed. ${obs.finalSummary || ''}`
            : critical
              ? `${obs.title || 'The watched task'} needs attention. Status: ${status}.`
              : `${obs.title || 'The watched task'} reached ${obs.completedSteps || 0} of ${obs.totalSteps || 0} completed steps. ${obs.currentStep?.description ? `It is now working on ${obs.currentStep.description}.` : ''}`,
          currentStep: String(obs.currentStep?.description || ''),
          completedSteps: [],
          recentActivity: [],
          finalResult: String(obs.finalSummary || ''),
          timestamp: Date.now(),
          watchId: watch.id,
        });
      }
    } finally {
      setModelBusy(false);
      this.runningWatchIds.delete(watch.id);
    }
  }

  private steerActiveTurn(
    watch: InternalWatch,
    obs: Observation,
    kind: 'match' | 'timeout',
    template: string,
  ): boolean {
    const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
    const payload = buildInternalWatchPayload(watch, obs, kind, template, deliverySessionId, 'live_steer');
    const queued = addPendingRuntimeSteerForSession(deliverySessionId, {
      message: payload,
      source: 'internal_watch_completion',
      kind: 'internal_watch_result',
      requiresWorkerResponse: true,
      clientRequestId: `internal_watch_result:${watch.id}:${watch.firedCount + 1}:${kind}`,
      internalWatchId: watch.id,
      internalWatchKind: kind,
      internalWatchActionPolicy: watch.actionPolicy || 'review_only',
      internalWatchTargetTaskId: String(obs.taskId || watch.target.config?.taskId || watch.target.config?.task_id || '').trim() || undefined,
      contextSummary: `Internal watch "${watch.label}" ${kind === 'match' ? 'matched' : 'timed out'} while this Prometheus turn was active.`,
    });
    if (!queued.ok) return false;

    if (kind === 'match') {
      const firedCount = watch.firedCount + 1;
      const terminal = firedCount >= watch.maxFirings;
      updateInternalWatch(watch.id, {
        status: terminal ? 'matched' : 'active',
        firedCount,
        matchedAt: new Date().toISOString(),
        completedAt: terminal ? new Date().toISOString() : undefined,
        lastObservation: { ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined },
        pendingMatchObservation: undefined,
        matchPendingAt: undefined,
      });
      this.broadcast({ type: 'internal_watch_matched', watchId: watch.id, watch, observation: obs, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId, delivery: 'live_steer' });
    } else {
      updateInternalWatch(watch.id, {
        status: 'timed_out',
        timedOutAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.broadcast({ type: 'internal_watch_timeout', watchId: watch.id, watch, observation: obs, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId, delivery: 'live_steer' });
    }
    this.broadcast({
      type: 'internal_watch_steered',
      watchId: watch.id,
      watchKind: kind,
      sessionId: deliverySessionId,
      originSessionId: watch.origin.sessionId,
      eventId: queued.event?.id,
    });
    return true;
  }

  private async fireTimeout(watch: InternalWatch): Promise<void> {
    this.runningWatchIds.add(watch.id);
    if (isModelBusy()) {
      const obs = watch.lastObservation || { status: 'timeout' };
      const timeoutInstruction = watch.onTimeout || `Internal watch "${watch.label}" timed out before the condition matched. Tell the user what was being watched and the latest observation.`;
      if (this.steerActiveTurn(watch, obs, 'timeout', timeoutInstruction)) {
        this.runningWatchIds.delete(watch.id);
        return;
      }
      this.runningWatchIds.delete(watch.id);
      return;
    }
    try {
      setModelBusy(true);
      const obs = watch.lastObservation || { status: 'timeout' };
      const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
      const timeoutInstruction = watch.onTimeout || `Internal watch "${watch.label}" timed out before the condition matched. Tell the user what was being watched and the latest observation.`;
      await this.deliver(watch, obs, 'timeout', timeoutInstruction);
      updateInternalWatch(watch.id, {
        status: 'timed_out',
        timedOutAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: undefined,
      });
      this.broadcast({ type: 'internal_watch_timeout', watchId: watch.id, watch, observation: obs, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId });
    } finally {
      setModelBusy(false);
      this.runningWatchIds.delete(watch.id);
    }
  }

  private async deliver(watch: InternalWatch, obs: Observation, kind: InternalWatchDeliveryKind, template: string): Promise<void> {
    const deliverySessionId = resolveWatchDeliverySessionId(watch, obs);
    const payload = buildInternalWatchPayload(watch, obs, kind, template, deliverySessionId, 'follow_up');

    const sendSSE = (event: string, data: any) => {
      this.broadcast({
        type: 'internal_watch_sse',
        watchId: watch.id,
        sessionId: deliverySessionId,
        originSessionId: watch.origin.sessionId,
        eventType: event,
        ...(data && typeof data === 'object' ? data : { message: String(data ?? '') }),
      });
    };

    try {
      if (watch.deliveryMode === 'notify_only' && kind !== 'gateway_restart_interruption') {
        this.broadcast({
          type: 'internal_watch_notified',
          watchId: watch.id,
          sessionId: deliverySessionId,
          originSessionId: watch.origin.sessionId,
          deliveryMode: 'notify_only',
          kind,
          observation: obs,
          instruction: template,
        });
        return;
      }

      const result = await this.runInteractiveTurn(
        payload,
        deliverySessionId,
        sendSSE,
        undefined,
        { aborted: false },
        `[InternalWatch ${watch.id}] Private watcher delivery in the creating main-chat session. Treat the observation as evidence, inspect it against the session's latest user intent, and obey the persisted action policy.`,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          syntheticInternalWatch: true,
          internalWatchContext: {
            watchId: watch.id,
            actionPolicy: watch.actionPolicy || 'review_only',
            targetTaskId: String(obs.taskId || watch.target.config?.taskId || watch.target.config?.task_id || '').trim() || undefined,
            delivery: 'follow_up',
          },
        },
        {
          channel: 'system',
          surface: 'automation',
          device: 'server',
          label: 'internal_watch',
          source: 'internal_watch',
        },
      );
      this.broadcast({
        type: 'internal_watch_delivered',
        watchId: watch.id,
        sessionId: deliverySessionId,
        originSessionId: watch.origin.sessionId,
        message: {
          role: 'assistant',
          content: String(result?.text || ''),
          timestamp: Date.now(),
          channel: 'system',
          channelLabel: 'internal_watch',
        },
      });
    } catch (err: any) {
      // Keep the watch and its durable pending payload active. A replacement
      // gateway (or the next tick) must be able to retry this notification.
      updateInternalWatch(watch.id, { error: String(err?.message || err) });
      this.broadcast({ type: 'internal_watch_failed', watchId: watch.id, sessionId: deliverySessionId, originSessionId: watch.origin.sessionId, error: String(err?.message || err) });
      throw err;
    }
  }
}
