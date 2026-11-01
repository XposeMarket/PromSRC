/**
 * Queued gateway restarts.
 *
 * gateway_restart used to return "Restart deferred" whenever another turn was
 * active, leaving the caller to poll with timers. Instead the request is now
 * persisted here, the gateway enters drain mode (scheduled/heartbeat/brain/timer
 * runs are held so the gateway can actually go quiet), and a small runner fires
 * the restart once no runtime has been active for a short stable window. After
 * boot, each requesting chat receives one automatic follow-up turn via the
 * existing main-chat timer runner, so the caller never has to poll.
 */
import fs from 'fs';
import path from 'path';
import type { RestartContext } from '../lifecycle';

export interface QueuedRestartRequester {
  sessionId: string;
  reason: string;
  continuation?: string;
  requestedAt: number;
}

export interface PendingGatewayRestart {
  id: string;
  createdAt: number;
  gatewayPid: number;
  ctx: RestartContext;
  requesters: QueuedRestartRequester[];
  lastError?: string;
  /** Set on a record kept only to retry post-boot wake-ups for a restart that already ran. */
  ranAsQueued?: boolean;
}

export interface ContinuationDeps {
  createTimer: (input: { sessionId: string; instruction: string; dueAt: Date; label?: string; origin?: Record<string, any> }) => unknown;
  /** Idempotency: true when a wake-up timer with this key already exists. */
  hasTimer?: (key: string, sessionId: string) => boolean;
}

export interface QueuedRestartRecord {
  id: string;
  requestedAt: number;
  requesters: QueuedRestartRequester[];
}

type RestartRuntime = {
  sessionId?: string;
  status?: string;
  abortRequestedAt?: number;
  completedAt?: number;
  label?: string;
  kind?: string;
  recoveryData?: Record<string, any> | null;
  checkpoint?: Record<string, any> | null;
};

const FILE_NAME = 'pending-gateway-restart.json';
const PROCESS_STARTED_AT = Date.now();

let stateDirResolver: () => string = () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../config/config').getConfig().getConfigDir();
};
let cache: { loaded: boolean; value: PendingGatewayRestart | null } = { loaded: false, value: null };
let lastBlockers: string[] = [];

/** Test hook: point the store at an isolated directory. */
export function setGatewayRestartQueueStateDir(resolver: () => string): void {
  stateDirResolver = resolver;
  cache = { loaded: false, value: null };
  lastBlockers = [];
}

function filePath(): string {
  return path.join(stateDirResolver(), FILE_NAME);
}

function persist(value: PendingGatewayRestart | null): void {
  const target = filePath();
  if (!value) {
    try { fs.rmSync(target, { force: true }); } catch { /* best effort */ }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  }
  cache = { loaded: true, value };
}

export function readPendingGatewayRestart(): PendingGatewayRestart | null {
  if (cache.loaded) return cache.value;
  let target: string;
  // Config may not be initialized yet (early boot / isolated tests): report
  // nothing queued but do not cache, so a later read sees the real file.
  try { target = filePath(); } catch { return null; }
  let value: PendingGatewayRestart | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (raw && typeof raw === 'object' && raw.id && raw.ctx && Array.isArray(raw.requesters)) value = raw;
  } catch { /* missing or unreadable means nothing queued */ }
  cache = { loaded: true, value };
  return value;
}

/** A pending record written by a previous gateway process is stale: that process is gone. */
export function isPendingRestartOwnedByThisProcess(
  pending: PendingGatewayRestart | null,
  pid: number = process.pid,
  processStartedAt: number = PROCESS_STARTED_AT,
): boolean {
  return !!pending && pending.gatewayPid === pid && pending.createdAt >= processStartedAt - 1000;
}

export function clearPendingGatewayRestart(): PendingGatewayRestart | null {
  const existing = readPendingGatewayRestart();
  persist(null);
  lastBlockers = [];
  return existing;
}

/** True while this process owns a queued restart: new automated runs should hold off. */
export function isGatewayRestartDrainActive(): boolean {
  return isPendingRestartOwnedByThisProcess(readPendingGatewayRestart());
}

function mergeContexts(base: RestartContext, next: RestartContext): RestartContext {
  const files = [...(base.affectedFiles || []), ...(next.affectedFiles || [])];
  return {
    ...base,
    affectedFiles: files.length ? Array.from(new Set(files)) : undefined,
    restartScope: base.restartScope === 'supervisor' || next.restartScope === 'supervisor' ? 'supervisor' : base.restartScope || next.restartScope,
    quickRestart: !!base.quickRestart && !!next.quickRestart,
    summary: Array.from(new Set(
      [...String(base.summary || '').split(' + '), String(next.summary || '')].map((part) => part.trim()).filter(Boolean),
    )).join(' + ') || undefined,
  };
}

/** Strip turn-scoped fields: by the time a queued restart fires, the requesting turn is over. */
export function toQueuedRestartContext(ctx: RestartContext): RestartContext {
  const {
    taskId: _taskId,
    taskOriginatingSessionId: _taskOrigin,
    taskInitiatedTool: _taskTool,
    forwardedToPid: _forwarded,
    ...rest
  } = ctx as RestartContext & Record<string, any>;
  return { ...rest, suppressStandaloneRestartMessage: true };
}

export function queueGatewayRestart(input: {
  ctx: RestartContext;
  requester: QueuedRestartRequester;
  now?: number;
  pid?: number;
}): { pending: PendingGatewayRestart; merged: boolean } {
  const now = input.now ?? Date.now();
  const pid = input.pid ?? process.pid;
  const ctx = toQueuedRestartContext(input.ctx);
  const existing = readPendingGatewayRestart();
  if (existing && existing.gatewayPid === pid) {
    const previous = existing.requesters.find((entry) => entry.sessionId === input.requester.sessionId);
    const requesters = existing.requesters.filter((entry) => entry.sessionId !== input.requester.sessionId);
    // A re-request without a continuation keeps the earlier one instead of wiping it.
    requesters.push({ ...input.requester, continuation: input.requester.continuation || previous?.continuation });
    const pending: PendingGatewayRestart = { ...existing, ctx: mergeContexts(existing.ctx, ctx), requesters, lastError: undefined };
    persist(pending);
    return { pending, merged: true };
  }
  const pending: PendingGatewayRestart = {
    id: `restartq_${now.toString(36)}`,
    createdAt: now,
    gatewayPid: pid,
    ctx,
    requesters: [input.requester],
  };
  persist(pending);
  return { pending, merged: false };
}

/**
 * A hidden thread supervisor parked in supervision_wait is idle (it can block
 * for up to 30 min and repeat). Its durable supervision record re-launches a
 * review on the next observed event after restart, so it must not hold the
 * quiet window open. An executing supervisor still blocks.
 */
export function isParkedSupervisorRuntime(runtime: RestartRuntime): boolean {
  return !!runtime.recoveryData?.supervisionId
    && runtime.checkpoint?.event === 'tool_call'
    && runtime.checkpoint?.toolAction === 'supervision_wait';
}

export function activeRestartBlockers(runtimes: RestartRuntime[]): RestartRuntime[] {
  return runtimes.filter((runtime) => runtime.status === 'running' && !runtime.abortRequestedAt && !runtime.completedAt
    && !isParkedSupervisorRuntime(runtime));
}

const describeRuntime = (runtime: RestartRuntime): string =>
  `${String(runtime.label || runtime.kind || 'running').slice(0, 80)} [${runtime.sessionId || 'unknown session'}]`;

/** Pure decision step: fire only after the gateway has been quiet for `quietMs`. */
export function evaluateQueuedRestart(input: {
  runtimes: RestartRuntime[];
  quietSince: number | null;
  now: number;
  quietMs: number;
}): { blockers: RestartRuntime[]; quietSince: number | null; fire: boolean } {
  const blockers = activeRestartBlockers(input.runtimes);
  if (blockers.length) return { blockers, quietSince: null, fire: false };
  const quietSince = input.quietSince ?? input.now;
  return { blockers, quietSince, fire: input.now - quietSince >= input.quietMs };
}

export function queuedRestartMessage(pending: PendingGatewayRestart, blockers: RestartRuntime[], merged: boolean): string {
  return [
    `Restart queued (${pending.id}${merged ? ', merged into the already-queued restart' : ''}).`,
    `${blockers.length} other active turn(s) are running: ${blockers.map(describeRuntime).join(', ')}.`,
    'The gateway restarts automatically as soon as it is quiet. Until then new scheduled, heartbeat, brain and timer runs are held so it can drain; in-flight work finishes normally.',
    'After the restart, this chat gets one automatic follow-up turn (with your continuation, if you passed one).',
    'Do NOT set timers or poll for this. End your turn now. Use gateway_restart action:"status" to check it or action:"cancel" to cancel it.',
  ].join(' ');
}

export function describePendingGatewayRestart(runtimes: RestartRuntime[], now: number = Date.now()): string {
  const pending = readPendingGatewayRestart();
  if (!pending) return 'No gateway restart is queued.';
  if (!isPendingRestartOwnedByThisProcess(pending)) {
    return `A queued restart (${pending.id}) belongs to a previous gateway process; it is resolved on the next boot pass.`;
  }
  const blockers = activeRestartBlockers(runtimes);
  const waitedMin = Math.round((now - pending.createdAt) / 60_000);
  return [
    `Gateway restart ${pending.id} is queued (waiting ${waitedMin} min). Reason: ${pending.ctx.summary || pending.ctx.title || pending.ctx.reason}.`,
    `Requested by: ${pending.requesters.map((entry) => entry.sessionId).join(', ')}.`,
    blockers.length ? `Waiting on ${blockers.length} active turn(s): ${blockers.map(describeRuntime).join(', ')}.` : 'Gateway is quiet; restart fires within seconds.',
    pending.lastError ? `Last attempt failed: ${pending.lastError}` : '',
  ].filter(Boolean).join(' ');
}

export function getGatewayRestartQueueDiagnostics(now: number = Date.now()): Record<string, any> | null {
  const pending = readPendingGatewayRestart();
  if (!pending) return null;
  return {
    id: pending.id,
    ownedByThisProcess: isPendingRestartOwnedByThisProcess(pending),
    createdAt: pending.createdAt,
    waitingMs: Math.max(0, now - pending.createdAt),
    reason: pending.ctx.summary || pending.ctx.title || pending.ctx.reason,
    requesters: pending.requesters.map((entry) => entry.sessionId),
    blockers: lastBlockers.slice(0, 10),
    lastError: pending.lastError || null,
  };
}

export function buildQueuedRestartContinuation(input: {
  requesters: QueuedRestartRequester[];
  reason: string;
  requestedAt: number;
  ranAt: number;
  ranAsQueued: boolean;
}): Array<{ sessionId: string; instruction: string }> {
  const bySession = new Map<string, QueuedRestartRequester[]>();
  for (const entry of input.requesters) {
    const sessionId = String(entry.sessionId || '').trim();
    if (!sessionId) continue;
    bySession.set(sessionId, [...(bySession.get(sessionId) || []), entry]);
  }
  const waitedMin = Math.max(0, Math.round((input.ranAt - input.requestedAt) / 60_000));
  return Array.from(bySession.entries()).map(([sessionId, entries]) => {
    const continuations = entries.map((entry) => String(entry.continuation || '').trim()).filter(Boolean);
    return {
      sessionId,
      instruction: [
        input.ranAsQueued
          ? `The gateway restart you queued has now run (reason: ${input.reason}). It waited about ${waitedMin} min for the gateway to go quiet, and the new gateway process has booted.`
          : `The gateway restarted before your queued restart fired (reason queued: ${input.reason}), so a new gateway process is already running; the queued restart was dropped as no longer needed.`,
        continuations.length
          ? `Continue with: ${continuations.join(' Then: ')}`
          : 'Verify the gateway is healthy and report the restart outcome to the user concisely.',
        'Do not call gateway_restart again for this request.',
      ].join(' '),
    };
  });
}

/**
 * Boot pass: wake every chat that queued a restart. Handles both a queued
 * restart that actually ran (restartCtx.queuedRestart) and a stale pending
 * record left by a previous process that restarted or crashed some other way.
 *
 * Delivery is durable and idempotent: each wake-up timer carries a
 * `restartQueueKey` (queue id + session) so retries never duplicate, and any
 * requester whose timer could not be created stays persisted (as a record no
 * process owns, so it never drains) for the runner to retry.
 */
export function scheduleQueuedRestartContinuations(
  restartCtx: RestartContext | null,
  deps: ContinuationDeps,
  now: number = Date.now(),
): number {
  type Job = { key: string; queueId: string; sessionId: string; instruction: string; requester: QueuedRestartRequester; ranAsQueued: boolean; reason: string; requestedAt: number };
  const jobs: Job[] = [];
  const add = (queueId: string, requesters: QueuedRestartRequester[], reason: string, requestedAt: number, ranAt: number, ranAsQueued: boolean): void => {
    for (const built of buildQueuedRestartContinuation({ requesters, reason, requestedAt, ranAt, ranAsQueued })) {
      const requester = requesters.find((entry) => entry.sessionId === built.sessionId)!;
      jobs.push({ key: `${queueId}:${built.sessionId}`, queueId, sessionId: built.sessionId, instruction: built.instruction, requester, ranAsQueued, reason, requestedAt });
    }
  };
  const ran = restartCtx?.queuedRestart;
  if (ran?.requesters?.length) {
    add(ran.id, ran.requesters, restartCtx?.summary || restartCtx?.title || String(restartCtx?.reason || 'gateway restart'),
      ran.requestedAt, restartCtx?.timestamp || now, true);
  }
  const stale = readPendingGatewayRestart();
  if (stale && !isPendingRestartOwnedByThisProcess(stale)) {
    const covered = new Set(jobs.map((job) => job.sessionId));
    add(stale.id, stale.requesters.filter((entry) => !covered.has(entry.sessionId)),
      stale.ctx.summary || stale.ctx.title || String(stale.ctx.reason), stale.createdAt, now, !!stale.ranAsQueued);
  }
  // Undelivered wake-ups from earlier attempts live in their own file, so a
  // newly queued restart can never overwrite them.
  const queued = new Map<string, PendingWakeup>();
  for (const wake of readPendingWakeups()) queued.set(wake.key, wake);
  for (const job of jobs) {
    if (!queued.has(job.key)) queued.set(job.key, { key: job.key, sessionId: job.sessionId, instruction: job.instruction, createdAt: now, attempts: 0 });
  }
  if (!queued.size) return 0;
  let created = 0;
  const failed: PendingWakeup[] = [];
  for (const wake of queued.values()) {
    try {
      if (deps.hasTimer?.(wake.key, wake.sessionId)) continue;
      deps.createTimer({
        sessionId: wake.sessionId,
        instruction: wake.instruction,
        dueAt: new Date(now + 5_000),
        label: 'Queued gateway restart finished',
        origin: { restartQueueKey: wake.key },
      });
      created += 1;
    } catch (error: any) {
      const attempts = (wake.attempts || 0) + 1;
      if (attempts === 1 || attempts % 20 === 0) {
        console.warn(`[restart-queue] Could not schedule continuation for ${wake.sessionId} (attempt ${attempts}): ${error?.message || error}`);
      }
      failed.push({ ...wake, attempts });
    }
  }
  // Persist undelivered wake-ups BEFORE dropping the stale queue record, so a
  // failed write leaves the stale record in place for the next boot to retry.
  writePendingWakeups(failed);
  if (stale && !isPendingRestartOwnedByThisProcess(stale)) clearPendingGatewayRestart();
  return created;
}

export interface PendingWakeup {
  key: string;
  sessionId: string;
  instruction: string;
  createdAt: number;
  attempts?: number;
}

const WAKE_FILE_NAME = 'pending-restart-wakeups.json';

export function readPendingWakeups(): PendingWakeup[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(stateDirResolver(), WAKE_FILE_NAME), 'utf8'));
    return Array.isArray(raw) ? raw.filter((wake) => wake && wake.key && wake.sessionId && wake.instruction) : [];
  } catch {
    return [];
  }
}

function writePendingWakeups(list: PendingWakeup[]): void {
  const target = path.join(stateDirResolver(), WAKE_FILE_NAME);
  if (!list.length) {
    try { fs.rmSync(target, { force: true }); } catch { /* best effort */ }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}


export function startGatewayRestartQueueRunner(deps: {
  listRuntimes: () => RestartRuntime[];
  restart: (ctx: RestartContext) => Promise<void>;
  isHandoffDraining?: () => boolean;
  /** Retries wake-up delivery for a stale/undelivered record (throttled to every 30s). */
  deliverContinuations?: () => void;
  tickMs?: number;
  quietMs?: number;
  /** How long after restart() resolves the process may still be alive before the attempt counts as failed. */
  acceptanceMs?: number;
}): { stop(): void } {
  const tickMs = Math.max(500, deps.tickMs ?? 3_000);
  const quietMs = Math.max(0, deps.quietMs ?? 10_000);
  const acceptanceMs = Math.max(100, deps.acceptanceMs ?? 120_000);
  let quietSince: number | null = null;
  let firing = false;
  let lastDeliveryAttempt = 0;
  const restoreFailed = (pending: PendingGatewayRestart, message: string): void => {
    const lastError = message.slice(0, 400);
    console.warn(`[restart-queue] Queued restart ${pending.id} failed; keeping it queued: ${lastError}`);
    // Never clobber a newer request queued meanwhile; just annotate it.
    const current = readPendingGatewayRestart();
    persist(current && current.id !== pending.id ? { ...current, lastError } : { ...pending, lastError });
    quietSince = null;
    firing = false;
  };
  const tick = async (): Promise<void> => {
    if (firing) return;
    const pending = readPendingGatewayRestart();
    const owned = isPendingRestartOwnedByThisProcess(pending);
    if (deps.deliverContinuations && Date.now() - lastDeliveryAttempt >= 30_000
      && ((pending && !owned) || readPendingWakeups().length)) {
      lastDeliveryAttempt = Date.now();
      try { deps.deliverContinuations(); } catch (error: any) { console.warn(`[restart-queue] Wake-up retry failed: ${error?.message || error}`); }
    }
    if (!owned) { quietSince = null; return; }
    if (deps.isHandoffDraining?.()) return;
    const now = Date.now();
    const decision = evaluateQueuedRestart({ runtimes: deps.listRuntimes(), quietSince, now, quietMs });
    quietSince = decision.quietSince;
    lastBlockers = decision.blockers.map(describeRuntime);
    if (!decision.fire || !pending) return;
    firing = true;
    persist(null);
    const ctx: RestartContext = {
      ...pending.ctx,
      timestamp: now,
      previousSessionId: pending.ctx.previousSessionId || pending.requesters[0]?.sessionId,
      queuedRestart: { id: pending.id, requestedAt: pending.createdAt, requesters: pending.requesters },
    };
    console.log(`[restart-queue] Gateway quiet for ${Math.round(quietMs / 1000)}s; running queued restart ${pending.id}.`);
    try {
      await deps.restart(ctx);
      // gracefulRestart can return normally without restarting (replacement
      // spawn failure, failed warm handoff). Only a process exit or an active
      // handoff proves acceptance; otherwise restore the request.
      const check = setTimeout(() => {
        if (deps.isHandoffDraining?.()) return;
        restoreFailed(pending, 'restart returned but this gateway is still running (launch or handoff failed)');
      }, acceptanceMs);
      (check as any).unref?.();
    } catch (error: any) {
      restoreFailed(pending, String(error?.message || error));
    }
  };
  const timer = setInterval(() => { void tick(); }, tickMs);
  (timer as any).unref?.();
  return { stop: () => clearInterval(timer) };
}
