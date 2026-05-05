import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { loadTask } from '../tasks/task-store';
import {
  getActiveInternalWatches,
  updateInternalWatch,
  type InternalWatch,
} from './internal-watch-store';
import { isModelBusy, setModelBusy } from '../comms/broadcaster';

type RunInteractiveTurn = (
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean },
  callerContext?: string,
  reasoningOptions?: any,
  attachments?: any,
  modelOverride?: string,
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

const TERMINAL_TASK_STATUSES = new Set(['complete', 'failed', 'needs_assistance', 'awaiting_user_input', 'paused', 'stalled']);

function normalizeRelPath(raw: any): string {
  return String(raw || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveWorkspaceWatchPath(raw: any): string {
  const workspaceRoot = path.resolve(getConfig().getWorkspacePath());
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
    const abs = resolveWorkspaceWatchPath(cfg.path || cfg.file || cfg.relativePath);
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
    const task = loadTask(taskId);
    if (!task) return { exists: false, taskId };
    return {
      exists: true,
      taskId,
      status: task.status,
      finalSummary: task.finalSummary || '',
      completedAt: task.completedAt,
      title: task.title,
    };
  }

  if (watch.target.type === 'scheduled_job') {
    const jobId = String(cfg.jobId || cfg.job_id || '').trim();
    if (!jobId) return { exists: false, error: 'job_id_required' };
    const job = cronScheduler?.getJobs?.().find((j: any) => String(j?.id || '') === jobId);
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
    const workspaceRoot = path.resolve(getConfig().getWorkspacePath());
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

function renderInstruction(template: string, watch: InternalWatch, obs: Observation, kind: 'match' | 'timeout'): string {
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
        if (new Date(watch.expiresAt).getTime() <= now) {
          await this.fireTimeout(watch);
          continue;
        }
        const obs = observeInternalWatchTarget(watch, this.cronScheduler);
        const matched = internalWatchMatches(watch, obs);
        if (matched && !isModelBusy()) {
          updateInternalWatch(watch.id, { lastCheckedAt: new Date().toISOString() });
          await this.fireMatch(watch, obs);
        } else if (matched) {
          updateInternalWatch(watch.id, { lastCheckedAt: new Date().toISOString() });
          this.broadcast({ type: 'internal_watch_waiting', watchId: watch.id, watch, sessionId: watch.origin.sessionId });
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

  private async fireMatch(watch: InternalWatch, obs: Observation): Promise<void> {
    this.runningWatchIds.add(watch.id);
    if (isModelBusy()) {
      this.runningWatchIds.delete(watch.id);
      return;
    }
    setModelBusy(true);
    const firedCount = watch.firedCount + 1;
    const terminal = firedCount >= watch.maxFirings;
    updateInternalWatch(watch.id, {
      status: terminal ? 'matched' : 'active',
      firedCount,
      matchedAt: new Date().toISOString(),
      completedAt: terminal ? new Date().toISOString() : undefined,
    });
    this.broadcast({ type: 'internal_watch_matched', watchId: watch.id, watch, observation: obs, sessionId: watch.origin.sessionId });
    await this.deliver(watch, obs, 'match', watch.onMatch);
    setModelBusy(false);
    this.runningWatchIds.delete(watch.id);
  }

  private async fireTimeout(watch: InternalWatch): Promise<void> {
    this.runningWatchIds.add(watch.id);
    if (isModelBusy()) {
      this.runningWatchIds.delete(watch.id);
      return;
    }
    setModelBusy(true);
    updateInternalWatch(watch.id, {
      status: 'timed_out',
      timedOutAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    const obs = watch.lastObservation || { status: 'timeout' };
    this.broadcast({ type: 'internal_watch_timeout', watchId: watch.id, watch, observation: obs, sessionId: watch.origin.sessionId });
    const timeoutInstruction = watch.onTimeout || `Internal watch "${watch.label}" timed out before the condition matched. Tell Raul/Prom what was being watched and the latest observation.`;
    await this.deliver(watch, obs, 'timeout', timeoutInstruction);
    setModelBusy(false);
    this.runningWatchIds.delete(watch.id);
  }

  private async deliver(watch: InternalWatch, obs: Observation, kind: 'match' | 'timeout', template: string): Promise<void> {
    const instruction = renderInstruction(template, watch, obs, kind);
    const payload = [
      `[Internal watch ${kind}]`,
      `Watch id: ${watch.id}`,
      `Label: ${watch.label}`,
      `Target: ${watch.target.type}`,
      `Observation: ${JSON.stringify({ ...obs, text: obs.text ? `[${String(obs.text).length} chars]` : undefined }, null, 2)}`,
      '',
      'Instruction:',
      instruction,
      '',
      'Reply in this same chat session with the concrete outcome. Do not expose this internal payload unless it helps explain the result.',
    ].join('\n');

    const sendSSE = (event: string, data: any) => {
      this.broadcast({
        type: 'internal_watch_sse',
        watchId: watch.id,
        sessionId: watch.origin.sessionId,
        eventType: event,
        ...(data && typeof data === 'object' ? data : { message: String(data ?? '') }),
      });
    };

    try {
      const result = await this.runInteractiveTurn(
        payload,
        watch.origin.sessionId,
        sendSSE,
        undefined,
        { aborted: false },
        `[InternalWatch ${watch.id}] Bounded internal watcher delivery. Treat as a same-session follow-up.`,
      );
      this.broadcast({
        type: 'internal_watch_delivered',
        watchId: watch.id,
        sessionId: watch.origin.sessionId,
        message: {
          role: 'assistant',
          content: String(result?.text || ''),
          timestamp: Date.now(),
          channel: 'system',
          channelLabel: 'internal_watch',
        },
      });
    } catch (err: any) {
      updateInternalWatch(watch.id, { status: 'failed', error: String(err?.message || err), completedAt: new Date().toISOString() });
      this.broadcast({ type: 'internal_watch_failed', watchId: watch.id, sessionId: watch.origin.sessionId, error: String(err?.message || err) });
    }
  }
}
