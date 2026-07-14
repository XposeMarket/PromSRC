import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';

export type LiveRuntimeKind =
  | 'main_chat'
  | 'main_chat_goal'
  | 'team_manager'
  | 'team_member'
  | 'team_subagent'
  | 'subagent'
  | 'background_agent'
  | 'background_task'
  | 'proposal_execution'
  | 'scheduled_task'
  | 'cron'
  | 'heartbeat'
  | 'brain_thought'
  | 'brain_dream';

export function isSteerableChatRuntimeKind(kind: LiveRuntimeKind | string | null | undefined): boolean {
  return kind === 'main_chat' || kind === 'main_chat_goal';
}

export interface LiveRuntimeRegistration {
  kind: LiveRuntimeKind;
  label: string;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  source?: string;
  chatId?: number;
  detail?: string;
  abortSignal?: { aborted: boolean };
  onAbort?: () => void;
  recoveryPolicy?: 'resume' | 'rerun' | 'mark_interrupted' | 'do_not_resume';
  recoveryData?: Record<string, any>;
}

export interface LiveRuntimeSnapshot {
  id: string;
  kind: LiveRuntimeKind;
  label: string;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  source?: string;
  chatId?: number;
  detail?: string;
  startedAt: number;
  updatedAt?: number;
  abortable: boolean;
  abortRequestedAt?: number;
  status?: 'running' | 'completed' | 'aborted' | 'interrupted';
  recoveryPolicy?: 'resume' | 'rerun' | 'mark_interrupted' | 'do_not_resume';
  recoveryData?: Record<string, any>;
  checkpoint?: Record<string, any>;
  completedAt?: number;
  interruptedAt?: number;
  interruptReason?: string;
  pid?: number;
}

export interface RuntimeSteerEvent {
  id: string;
  sessionId: string;
  message: string;
  source?: string;
  createdAt: number;
  clientRequestId?: string;
  kind?: 'correction' | 'question' | 'status' | 'constraint' | 'cancel' | 'pause' | 'continue' | 'clarification' | 'unknown';
  requiresWorkerResponse?: boolean;
  voiceContextPacketId?: string;
  spokenAck?: string;
  responseMode?: 'silent' | 'narrate' | 'worker_reply';
  contextSummary?: string;
  attachments?: Array<{ base64: string; mimeType: string; name: string }>;
  attachmentPreviews?: any[];
}

const TERMINAL_CHECKPOINT_EVENTS = new Set(['done', 'final', 'error']);

export function hasTerminalRuntimeCheckpoint(runtime: Pick<LiveRuntimeSnapshot, 'status' | 'checkpoint' | 'completedAt'> | null | undefined): boolean {
  if (!runtime) return false;
  const status = String(runtime.status || '').trim();
  if (status === 'completed' || status === 'aborted') return true;
  if (Number(runtime.completedAt || 0) > 0) return true;
  const event = String(runtime.checkpoint?.event || '').trim().toLowerCase();
  return TERMINAL_CHECKPOINT_EVENTS.has(event);
}

export function isRuntimeRecoverableAfterRestart(runtime: Pick<LiveRuntimeSnapshot, 'status' | 'checkpoint' | 'completedAt' | 'recoveryData'> | null | undefined): boolean {
  if (!runtime) return false;
  if (hasTerminalRuntimeCheckpoint(runtime)) return false;
  const recoveryData = runtime.recoveryData || {};
  if (recoveryData.recoveredAt || recoveryData.recovery) return false;
  return runtime.status === 'running' || runtime.status === 'interrupted';
}

// The epoch (ms timestamp) of the most recent shutdown that interrupted live
// runtimes in THIS process. Stamped onto each runtime it interrupts so post-restart
// recovery can distinguish "interrupted by this restart" from stale runtimes left
// over from an earlier crash that were never marked recovered, and from work that
// was already paused/failed before the restart ever happened.
let _restartInterruptEpoch = 0;

export function getRestartInterruptEpoch(): number {
  return _restartInterruptEpoch;
}

// True only when the runtime was actively interrupted by a gateway restart and has
// not yet been recovered. Optionally require the interruption to belong to a
// specific restart epoch (e.g. the one persisted in this process's ledger), which
// excludes pre-paused/pre-failed work and stale records from older crashes.
export function isInterruptedByRestart(
  runtime: Pick<LiveRuntimeSnapshot, 'status' | 'checkpoint' | 'completedAt' | 'recoveryData' | 'interruptReason' | 'interruptedAt'> | null | undefined,
  sinceEpoch = 0,
): boolean {
  if (!runtime) return false;
  if (hasTerminalRuntimeCheckpoint(runtime)) return false;
  const recoveryData = runtime.recoveryData || {};
  if (recoveryData.recoveredAt || recoveryData.recovery) return false;
  // Must have actually been marked interrupted (not merely 'running' left dangling).
  if (runtime.status !== 'interrupted') return false;
  const epoch = Number(recoveryData.restartEpoch || 0);
  if (sinceEpoch > 0) {
    // Only accept runtimes stamped by this exact restart epoch (or newer).
    return epoch >= sinceEpoch;
  }
  // No epoch filter requested: any runtime carrying a restart epoch stamp qualifies.
  return epoch > 0;
}

interface LiveRuntimeRecord extends LiveRuntimeSnapshot {
  abortSignal?: { aborted: boolean };
  onAbort?: () => void;
  pendingSteers?: RuntimeSteerEvent[];
}

const activeRuntimes = new Map<string, LiveRuntimeRecord>();

interface RuntimeLedger {
  version: 1;
  updatedAt: number;
  runtimes: Record<string, LiveRuntimeSnapshot>;
}

function getRuntimeStateDir(): string {
  const dir = path.join(getConfig().getConfigDir(), 'runtimes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRuntimeLedgerPath(): string {
  return path.join(getRuntimeStateDir(), 'active-runtimes.json');
}

function getRuntimeEventsPath(): string {
  return path.join(getRuntimeStateDir(), 'runtime-events.ndjson');
}

function readLedger(): RuntimeLedger {
  const filePath = getRuntimeLedgerPath();
  if (!fs.existsSync(filePath)) return { version: 1, updatedAt: Date.now(), runtimes: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      version: 1,
      updatedAt: Number(parsed?.updatedAt || Date.now()),
      runtimes: parsed?.runtimes && typeof parsed.runtimes === 'object' ? parsed.runtimes : {},
    };
  } catch {
    return { version: 1, updatedAt: Date.now(), runtimes: {} };
  }
}

function writeLedger(ledger: RuntimeLedger): void {
  const filePath = getRuntimeLedgerPath();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  ledger.updatedAt = Date.now();
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function appendRuntimeEvent(type: string, runtime: LiveRuntimeSnapshot, extra?: Record<string, any>): void {
  try {
    const evt = {
      t: Date.now(),
      type,
      runtimeId: runtime.id,
      kind: runtime.kind,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      teamId: runtime.teamId,
      agentId: runtime.agentId,
      scheduleId: runtime.scheduleId,
      status: runtime.status,
      pid: runtime.pid,
      ...(extra || {}),
    };
    fs.appendFileSync(getRuntimeEventsPath(), `${JSON.stringify(evt)}\n`, 'utf-8');
  } catch {}
}

const MAX_DURABLE_CHECKPOINT_TEXT = 500;

// Strip the heavy live-UI payload (process log, long messages) before writing to
// the durable ledger. The full record stays in memory for live UI + graceful
// shutdown capture; only a lightweight summary is persisted to disk so the ledger
// can't grow into a multi-MB blob that's parsed/rewritten on every checkpoint.
function toDurableSnapshot(snapshot: LiveRuntimeSnapshot): LiveRuntimeSnapshot {
  const out: LiveRuntimeSnapshot = { ...snapshot };
  const cp = out.checkpoint;
  if (cp && typeof cp === 'object') {
    const light: Record<string, any> = {
      event: cp.event,
      message: typeof cp.message === 'string' ? cp.message.slice(0, MAX_DURABLE_CHECKPOINT_TEXT) : cp.message,
      toolName: cp.toolName,
      label: cp.label,
      kind: cp.kind,
      detail: typeof cp.detail === 'string' ? cp.detail.slice(0, MAX_DURABLE_CHECKPOINT_TEXT) : cp.detail,
      pendingSteerCount: cp.pendingSteerCount,
      updatedAt: cp.updatedAt,
    };
    for (const k of Object.keys(light)) {
      if (light[k] === undefined) delete light[k];
    }
    out.checkpoint = light;
  }
  return out;
}

function persistRuntime(runtime: LiveRuntimeSnapshot, eventType: string, extra?: Record<string, any>, opts?: { full?: boolean }): void {
  try {
    const ledger = readLedger();
    // `full` keeps the heavy checkpoint (process log) on disk — only used on
    // interruption so the owning session can recover its own full context.
    ledger.runtimes[runtime.id] = opts?.full ? runtime : toDurableSnapshot(runtime);
    writeLedger(ledger);
    appendRuntimeEvent(eventType, runtime, extra);
  } catch (err: any) {
    console.warn('[live-runtime] Failed to persist runtime:', err?.message || err);
  }
}

// Remove a runtime from the durable ledger entirely (terminal runtimes do not
// need to survive a restart). Still appends a one-line audit event.
function deleteDurableRuntime(id: string, eventType: string, snapshotForEvent?: LiveRuntimeSnapshot, extra?: Record<string, any>): void {
  try {
    const ledger = readLedger();
    if (ledger.runtimes[id]) {
      delete ledger.runtimes[id];
      writeLedger(ledger);
    }
    if (snapshotForEvent) appendRuntimeEvent(eventType, snapshotForEvent, extra);
  } catch (err: any) {
    console.warn('[live-runtime] Failed to delete durable runtime:', err?.message || err);
  }
}

function toSnapshot(record: LiveRuntimeRecord): LiveRuntimeSnapshot {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    sessionId: record.sessionId,
    taskId: record.taskId,
    teamId: record.teamId,
    agentId: record.agentId,
    scheduleId: record.scheduleId,
    source: record.source,
    chatId: record.chatId,
    detail: record.detail,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    abortable: record.abortable,
    abortRequestedAt: record.abortRequestedAt,
    status: record.status,
    recoveryPolicy: record.recoveryPolicy,
    recoveryData: record.recoveryData,
    checkpoint: record.checkpoint,
    completedAt: record.completedAt,
    interruptedAt: record.interruptedAt,
    interruptReason: record.interruptReason,
    pid: record.pid,
  };
}

export function registerLiveRuntime(registration: LiveRuntimeRegistration): string {
  const id = crypto.randomUUID();
  const record: LiveRuntimeRecord = {
    id,
    kind: registration.kind,
    label: String(registration.label || registration.kind),
    sessionId: registration.sessionId ? String(registration.sessionId) : undefined,
    taskId: registration.taskId ? String(registration.taskId) : undefined,
    teamId: registration.teamId ? String(registration.teamId) : undefined,
    agentId: registration.agentId ? String(registration.agentId) : undefined,
    scheduleId: registration.scheduleId ? String(registration.scheduleId) : undefined,
    source: registration.source ? String(registration.source) : undefined,
    chatId: Number.isFinite(Number(registration.chatId)) ? Number(registration.chatId) : undefined,
    detail: registration.detail ? String(registration.detail) : undefined,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    abortable: !!registration.abortSignal || typeof registration.onAbort === 'function',
    status: 'running',
    recoveryPolicy: registration.recoveryPolicy || inferDefaultRecoveryPolicy(registration.kind),
    recoveryData: registration.recoveryData,
    pid: process.pid,
    abortSignal: registration.abortSignal,
    onAbort: registration.onAbort,
  };
  activeRuntimes.set(id, record);
  persistRuntime(toSnapshot(record), 'registered');
  return id;
}

export function finishLiveRuntime(id: string): void {
  const key = String(id || '');
  cancelCheckpointFlush(key);
  const record = activeRuntimes.get(key);
  if (record) {
    record.status = record.abortSignal?.aborted ? 'aborted' : 'completed';
    record.completedAt = Date.now();
    record.updatedAt = Date.now();
    // Terminal runtimes are not recoverable, so drop them from the durable
    // ledger instead of writing a record that would accumulate forever.
    deleteDurableRuntime(key, record.status === 'aborted' ? 'aborted' : 'completed', toSnapshot(record));
  }
  activeRuntimes.delete(key);
}

function pruneTerminalActiveRuntimes(): void {
  for (const [id, record] of activeRuntimes.entries()) {
    if (!hasTerminalRuntimeCheckpoint(record)) continue;
    cancelCheckpointFlush(id);
    const snapshot = toSnapshot(record);
    deleteDurableRuntime(id, 'pruned_terminal_active_runtime', snapshot);
    activeRuntimes.delete(id);
  }
}

export function getLiveRuntime(id: string): LiveRuntimeSnapshot | null {
  pruneTerminalActiveRuntimes();
  const record = activeRuntimes.get(String(id || ''));
  return record ? toSnapshot(record) : null;
}

export function listLiveRuntimes(): LiveRuntimeSnapshot[] {
  pruneTerminalActiveRuntimes();
  return Array.from(activeRuntimes.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(toSnapshot);
}

export function findLiveRuntime(
  predicate: (runtime: LiveRuntimeSnapshot) => boolean,
): LiveRuntimeSnapshot | null {
  for (const runtime of listLiveRuntimes()) {
    if (predicate(runtime)) return runtime;
  }
  return null;
}

export function abortLiveRuntime(id: string): { ok: boolean; runtime?: LiveRuntimeSnapshot; error?: string } {
  const key = String(id || '');
  cancelCheckpointFlush(key);
  const record = activeRuntimes.get(key);
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (!record.abortable) return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not abortable.' };

  record.abortRequestedAt = Date.now();
  record.updatedAt = Date.now();
  if (record.abortSignal) {
    record.abortSignal.aborted = true;
  }

  try {
    record.onAbort?.();
    record.status = 'aborted';
    record.updatedAt = Date.now();
  } catch (err: any) {
    return {
      ok: false,
      runtime: toSnapshot(record),
      error: String(err?.message || err || 'Abort hook failed.'),
    };
  }

  // Aborting the turn must also cancel any pending Prometheus question for this
  // session. Otherwise the question card has no live waiter, never resolves, and
  // re-renders as pending forever. Cancel + broadcast so the UI flips it to
  // cancelled (mirrors the /api/questions/:id/cancel path).
  try {
    const sessionId = String(record.sessionId || '').trim();
    if (sessionId) {
      const { getPrometheusQuestionQueue, serializePrometheusQuestionForClient } = require('./prometheus-questions');
      const queue = getPrometheusQuestionQueue();
      const pending = queue.listPending().filter((q: any) => String(q.sessionId || '') === sessionId);
      if (pending.length) {
        const { broadcastWS } = require('./comms/broadcaster');
        for (const q of pending) {
          const cancelled = queue.cancel(q.id, 'abort');
          if (!cancelled) continue;
          try {
            broadcastWS({
              type: 'question_cancelled',
              sessionId: cancelled.sessionId,
              taskId: cancelled.taskId,
              questionId: cancelled.id,
              question: serializePrometheusQuestionForClient(cancelled),
            });
          } catch {}
        }
      }
    }
  } catch (err: any) {
    console.warn('[live-runtime] Failed to cancel pending questions on abort:', err?.message || err);
  }

  persistRuntime(toSnapshot(record), 'abort_requested');
  return { ok: true, runtime: toSnapshot(record) };
}

export function addPendingRuntimeSteer(
  id: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (!isSteerableChatRuntimeKind(record.kind)) return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not steerable.' };
  const message = String(input.message || '').trim();
  const attachments = Array.isArray((input as any).attachments) ? (input as any).attachments : [];
  const attachmentPreviews = Array.isArray((input as any).attachmentPreviews) ? (input as any).attachmentPreviews : [];
  if (!message && attachments.length === 0 && attachmentPreviews.length === 0) {
    return { ok: false, runtime: toSnapshot(record), error: 'Steer message is empty.' };
  }
  const event: RuntimeSteerEvent = {
    id: String(input.id || crypto.randomUUID()),
    sessionId: String(input.sessionId || record.sessionId || '').trim(),
    message: message || `User sent ${attachments.length + attachmentPreviews.length} attachment(s) as a live steer.`,
    source: input.source ? String(input.source) : undefined,
    createdAt: Number(input.createdAt || Date.now()),
    clientRequestId: input.clientRequestId ? String(input.clientRequestId) : undefined,
    kind: input.kind,
    requiresWorkerResponse: input.requiresWorkerResponse === true,
    voiceContextPacketId: input.voiceContextPacketId ? String(input.voiceContextPacketId) : undefined,
    spokenAck: input.spokenAck ? String(input.spokenAck).slice(0, 1000) : undefined,
    responseMode: input.responseMode,
    contextSummary: input.contextSummary ? String(input.contextSummary).slice(0, 2000) : undefined,
    attachments: attachments.length ? attachments : undefined,
    attachmentPreviews: attachmentPreviews.length ? attachmentPreviews : undefined,
  };
  if (!Array.isArray(record.pendingSteers)) record.pendingSteers = [];
  record.pendingSteers.push(event);
  record.updatedAt = Date.now();
  record.checkpoint = {
    ...(record.checkpoint || {}),
    pendingSteerCount: record.pendingSteers.length,
      lastSteer: {
        id: event.id,
        message: event.message.slice(0, 500),
        source: event.source,
        kind: event.kind,
        voiceContextPacketId: event.voiceContextPacketId,
        attachmentCount: (event.attachments?.length || 0) + (event.attachmentPreviews?.length || 0),
        at: event.createdAt,
      },
    updatedAt: Date.now(),
  };
  persistRuntime(toSnapshot(record), 'steer_queued', { steerId: event.id, source: event.source });
  return { ok: true, runtime: toSnapshot(record), event };
}

export function consumePendingRuntimeSteersForSession(sessionId: string, limit = 4): RuntimeSteerEvent[] {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const out: RuntimeSteerEvent[] = [];
  for (const record of activeRuntimes.values()) {
    if (!isSteerableChatRuntimeKind(record.kind) || String(record.sessionId || '') !== sid) continue;
    const queue = Array.isArray(record.pendingSteers) ? record.pendingSteers : [];
    while (queue.length && out.length < limit) {
      const event = queue.shift();
      if (event) out.push(event);
    }
    if (out.length) {
      record.pendingSteers = queue;
      record.updatedAt = Date.now();
      record.checkpoint = {
        ...(record.checkpoint || {}),
        pendingSteerCount: queue.length,
        consumedSteerCount: Number(record.checkpoint?.consumedSteerCount || 0) + out.length,
        lastConsumedSteerAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistRuntime(toSnapshot(record), 'steer_consumed', { consumed: out.length });
    }
    if (out.length >= limit) break;
  }
  return out;
}

function inferDefaultRecoveryPolicy(kind: LiveRuntimeKind): LiveRuntimeSnapshot['recoveryPolicy'] {
  if (kind === 'background_task' || kind === 'background_agent' || kind === 'subagent' || kind === 'team_subagent' || kind === 'proposal_execution') return 'resume';
  if (kind === 'scheduled_task' || kind === 'cron' || kind === 'heartbeat') return 'rerun';
  if (kind === 'brain_thought' || kind === 'brain_dream') return 'rerun';
  return 'mark_interrupted';
}

// Debounced ledger flush: coalesce rapid checkpoint updates into a single write
// so tool_call/tool_result bursts don't saturate the disk with sync I/O.
const _pendingLedgerFlush = new Map<string, ReturnType<typeof setTimeout>>();
function cancelCheckpointFlush(id: string): void {
  const key = String(id || '');
  const existing = _pendingLedgerFlush.get(key);
  if (!existing) return;
  clearTimeout(existing);
  _pendingLedgerFlush.delete(key);
}

function scheduleCheckpointFlush(id: string, snapshot: LiveRuntimeSnapshot): void {
  const existing = _pendingLedgerFlush.get(id);
  if (existing) clearTimeout(existing);
  _pendingLedgerFlush.set(id, setTimeout(() => {
    _pendingLedgerFlush.delete(id);
    try { persistRuntime(snapshot, 'checkpoint'); } catch {}
  }, 200));
}

export function updateLiveRuntimeCheckpoint(id: string, checkpoint: Record<string, any>): void {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return;
  record.checkpoint = {
    ...(record.checkpoint || {}),
    ...checkpoint,
    updatedAt: Date.now(),
  };
  record.updatedAt = Date.now();
  scheduleCheckpointFlush(id, toSnapshot(record));
}

export function markActiveRuntimesInterrupted(reason = 'gateway_shutdown'): LiveRuntimeSnapshot[] {
  const interrupted: LiveRuntimeSnapshot[] = [];
  // Stamp a single epoch for this shutdown so every runtime interrupted in this
  // pass shares it. Post-restart recovery uses this to carry forward ONLY work that
  // this restart actually interrupted, not pre-paused/failed or stale-crash records.
  const restartEpoch = Date.now();
  _restartInterruptEpoch = restartEpoch;
  for (const record of activeRuntimes.values()) {
    if (!isRuntimeRecoverableAfterRestart(record)) {
      if (record.status === 'running') {
        record.status = hasTerminalRuntimeCheckpoint(record) ? 'completed' : 'aborted';
      }
      if (!record.completedAt && hasTerminalRuntimeCheckpoint(record)) record.completedAt = Date.now();
      record.updatedAt = Date.now();
      const snapshot = toSnapshot(record);
      // Already-finished work is not recoverable — drop it from the ledger.
      deleteDurableRuntime(record.id, 'restart_skipped_completed', snapshot, { reason });
      activeRuntimes.delete(record.id);
      continue;
    }

    record.status = 'interrupted';
    record.interruptedAt = restartEpoch;
    record.interruptReason = reason;
    record.updatedAt = Date.now();
    // Persist the restart epoch onto recoveryData so it survives in the durable
    // ledger and the post-restart process can match "interrupted by this restart".
    record.recoveryData = { ...(record.recoveryData || {}), restartEpoch, interruptReason: reason };
    if (record.abortSignal) record.abortSignal.aborted = true;
    const snapshot = toSnapshot(record);
    interrupted.push(snapshot);
    // Persist the FULL snapshot (with process log) so the owning session can
    // recover its own context after restart. This is the one path that keeps
    // the heavy checkpoint on disk.
    persistRuntime(snapshot, 'interrupted', { reason }, { full: true });
  }
  return interrupted;
}

export function listDurableRuntimes(): LiveRuntimeSnapshot[] {
  return Object.values(readLedger().runtimes || {})
    .sort((a, b) => Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0));
}

export function listInterruptedRuntimes(): LiveRuntimeSnapshot[] {
  return listDurableRuntimes().filter((runtime) => isRuntimeRecoverableAfterRestart(runtime));
}

export function markDurableRuntimeRecovered(id: string, status: 'completed' | 'aborted' | 'interrupted' = 'interrupted', extra?: Record<string, any>): void {
  const ledger = readLedger();
  const runtime = ledger.runtimes[String(id || '')];
  if (!runtime) return;
  runtime.status = status;
  runtime.updatedAt = Date.now();
  if (status === 'interrupted' && !runtime.interruptedAt) runtime.interruptedAt = Date.now();
  runtime.recoveryData = { ...(runtime.recoveryData || {}), ...(extra || {}), recoveredAt: Date.now() };
  // The heavy process log was already injected into the owning session during
  // recovery; only keep the lightweight summary on disk from here on.
  ledger.runtimes[runtime.id] = toDurableSnapshot(runtime);
  writeLedger(ledger);
  appendRuntimeEvent('recovered', runtime, extra);
}

// Remove terminal and already-recovered runtimes from the durable ledger.
// Cheap to call on startup — keeps the ledger from accumulating dead records.
export function pruneDurableLedger(): { removed: number; kept: number } {
  try {
    const ledger = readLedger();
    const ids = Object.keys(ledger.runtimes || {});
    let removed = 0;
    for (const id of ids) {
      const rt = ledger.runtimes[id];
      const recovered = !!(rt?.recoveryData && (rt.recoveryData.recoveredAt || rt.recoveryData.recovery));
      if (hasTerminalRuntimeCheckpoint(rt) || recovered) {
        delete ledger.runtimes[id];
        removed++;
      }
    }
    if (removed > 0) writeLedger(ledger);
    return { removed, kept: Object.keys(ledger.runtimes).length };
  } catch (err: any) {
    console.warn('[live-runtime] pruneDurableLedger failed:', err?.message || err);
    return { removed: 0, kept: 0 };
  }
}

const MAX_RUNTIME_EVENTS_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_RUNTIME_EVENTS_KEPT_LINES = 2000;

// One-time / self-healing compaction. Backs up oversized state files to `.bak`
// then rewrites the ledger with only recoverable, lightweight records and trims
// the append-only event log. Safe to call on every startup.
export function compactRuntimeStateOnStartup(): { ledgerRemoved: number; ledgerKept: number; eventsRotated: boolean } {
  let ledgerRemoved = 0;
  let ledgerKept = 0;
  let eventsRotated = false;

  // --- Ledger compaction ---
  try {
    const ledgerPath = getRuntimeLedgerPath();
    if (fs.existsSync(ledgerPath)) {
      const ledger = readLedger();
      const ids = Object.keys(ledger.runtimes || {});
      const next: Record<string, LiveRuntimeSnapshot> = {};
      for (const id of ids) {
        const rt = ledger.runtimes[id];
        // Keep only entries that can actually be recovered after a restart
        // (running/interrupted, not terminal, not already recovered). Strip the
        // heavy process log from each survivor.
        if (isRuntimeRecoverableAfterRestart(rt)) {
          next[id] = toDurableSnapshot(rt);
        } else {
          ledgerRemoved++;
        }
      }
      ledgerKept = Object.keys(next).length;
      if (ledgerRemoved > 0) {
        try { fs.copyFileSync(ledgerPath, `${ledgerPath}.bak`); } catch {}
        writeLedger({ version: 1, updatedAt: Date.now(), runtimes: next });
      }
    }
  } catch (err: any) {
    console.warn('[live-runtime] ledger compaction failed:', err?.message || err);
  }

  // --- Event log rotation ---
  try {
    const eventsPath = getRuntimeEventsPath();
    if (fs.existsSync(eventsPath)) {
      const size = fs.statSync(eventsPath).size;
      if (size > MAX_RUNTIME_EVENTS_BYTES) {
        const raw = fs.readFileSync(eventsPath, 'utf-8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        const kept = lines.slice(-MAX_RUNTIME_EVENTS_KEPT_LINES);
        try { fs.copyFileSync(eventsPath, `${eventsPath}.bak`); } catch {}
        fs.writeFileSync(eventsPath, kept.length ? `${kept.join('\n')}\n` : '', 'utf-8');
        eventsRotated = true;
      }
    }
  } catch (err: any) {
    console.warn('[live-runtime] event log rotation failed:', err?.message || err);
  }

  return { ledgerRemoved, ledgerKept, eventsRotated };
}
