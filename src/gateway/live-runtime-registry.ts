import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';
import { buildDurableChatTraceFromProcessEntries } from './durable-chat-trace';
import {
  finishRuntimeProgressLease,
  registerRuntimeProgressLease,
  renewRuntimeProgressLease,
  type RuntimeProgressLeaseRenewal,
} from './gateway-progress-lease';

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

export function isSteerableTaskRuntimeKind(kind: LiveRuntimeKind | string | null | undefined): boolean {
  return kind === 'background_task'
    || kind === 'subagent'
    || kind === 'team_subagent'
    || kind === 'proposal_execution'
    || kind === 'scheduled_task';
}

/**
 * Ephemeral background agents have their own fresh chat session.  They are not
 * foreground chats, but while running they can consume the same queued steer
 * events between model rounds (and before their final response).
 */
export function isSteerableBackgroundAgentRuntimeKind(kind: LiveRuntimeKind | string | null | undefined): boolean {
  return kind === 'background_agent';
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
  /** Stable client-generated id used to reconnect to the same user turn. */
  clientRequestId?: string;
  abortSignal?: { aborted: boolean; reason?: string };
  onAbort?: () => void;
  /** Keep the live record until its owning request calls finishLiveRuntime(). */
  deferTerminalCleanup?: boolean;
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
  clientRequestId?: string;
  startedAt: number;
  updatedAt?: number;
  abortable: boolean;
  abortRequestedAt?: number;
  abortReason?: string;
  abortSource?: string;
  deferTerminalCleanup?: boolean;
  status?: 'running' | 'completed' | 'aborted' | 'interrupted';
  recoveryPolicy?: 'resume' | 'rerun' | 'mark_interrupted' | 'do_not_resume';
  recoveryData?: Record<string, any>;
  checkpoint?: Record<string, any>;
  completedAt?: number;
  interruptedAt?: number;
  interruptReason?: string;
  pid?: number;
  /**
   * Set on a mirror of a runtime that a draining previous gateway still owns.
   * `pid` is that host's pid; control requests are forwarded to it.
   */
  remoteHostPid?: number;
}

export interface RuntimeSteerEvent {
  id: string;
  sessionId: string;
  message: string;
  source?: string;
  createdAt: number;
  clientRequestId?: string;
  kind?: 'correction' | 'question' | 'status' | 'constraint' | 'cancel' | 'pause' | 'continue' | 'clarification' | 'background_agent_result' | 'internal_watch_result' | 'unknown';
  requiresWorkerResponse?: boolean;
  backgroundAgentId?: string;
  backgroundAgentState?: 'completed' | 'failed';
  internalWatchId?: string;
  internalWatchKind?: 'match' | 'timeout';
  internalWatchActionPolicy?: 'review_only' | 'recover_same_run' | 'full_rerun_allowed';
  internalWatchTargetTaskId?: string;
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

export function isRuntimeRecoverableAfterRestart(runtime: Pick<LiveRuntimeSnapshot, 'status' | 'checkpoint' | 'completedAt' | 'recoveryData' | 'abortRequestedAt' | 'abortSource'> | null | undefined): boolean {
  if (!runtime) return false;
  if (hasTerminalRuntimeCheckpoint(runtime)) return false;
  const recoveryData = runtime.recoveryData || {};
  if (recoveryData.recoveredAt || recoveryData.recovery) return false;
  // An explicit operator/user cancellation is not an unexpected restart
  // candidate. The owner may still be unwinding in-process, but it must not be
  // replayed after a later gateway restart. The semantic-progress watchdog is
  // different: it deliberately marks a stalled owner recoverable.
  const abortRequestedAt = Number(runtime.abortRequestedAt || 0);
  const abortSource = String(runtime.abortSource || '').trim();
  if (abortRequestedAt > 0 && abortSource !== 'main_chat_owner_watchdog') return false;
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
  abortSignal?: { aborted: boolean; reason?: string };
  onAbort?: () => void;
  deferTerminalCleanup?: boolean;
  pendingSteers?: RuntimeSteerEvent[];
}

const activeRuntimes = new Map<string, LiveRuntimeRecord>();

// ─── Warm handoff hooks ───────────────────────────────────────────────────────
// While a gateway drains after a planned restart, the replacement gateway is
// the only ledger writer. The draining process routes its durable writes
// through this sink instead of rewriting the shared ledger file underneath
// the replacement. The replacement mirrors those runtimes as remote records.

export interface LiveRuntimePersistenceSink {
  upsert(runtime: LiveRuntimeSnapshot, eventType: string, extra?: Record<string, any>): void;
  delete(runtimeId: string, eventType: string, runtime?: LiveRuntimeSnapshot, extra?: Record<string, any>): void;
}

export type RemoteRuntimeControlOp = 'runtime_abort' | 'runtime_steer' | 'task_pause' | 'task_cancel';
export type RemoteRuntimeControlForwarder = (
  hostPid: number,
  op: RemoteRuntimeControlOp,
  args: Record<string, unknown>,
) => Promise<{ ok: boolean; error?: string }>;

let livePersistenceSink: LiveRuntimePersistenceSink | null = null;
let remoteRuntimeControlForwarder: RemoteRuntimeControlForwarder | null = null;
// Once a sink is installed this process must never rewrite the shared ledger
// file again: the replacement gateway owns it for the rest of this process's
// life, including the final shutdown flush.
let ledgerWritesFrozen = false;

export function setLiveRuntimePersistenceSink(sink: LiveRuntimePersistenceSink | null): void {
  livePersistenceSink = sink;
  if (sink) ledgerWritesFrozen = true;
}

export function areLedgerWritesFrozen(): boolean {
  return ledgerWritesFrozen;
}

/** Forward a control request for a mirrored runtime to the gateway that owns it. */
export function requestRemoteRuntimeControl(
  runtime: Pick<LiveRuntimeSnapshot, 'id' | 'remoteHostPid'>,
  op: RemoteRuntimeControlOp,
  args: Record<string, unknown>,
): boolean {
  const record = activeRuntimes.get(String(runtime.id || ''));
  if (!record || !isRemoteRecord(record)) return false;
  forwardRemoteControl(record, op, args);
  return true;
}

export function setRemoteRuntimeControlForwarder(forwarder: RemoteRuntimeControlForwarder | null): void {
  remoteRuntimeControlForwarder = forwarder;
}

function isRemoteRecord(record: LiveRuntimeRecord | undefined | null): boolean {
  return !!record && Number(record.remoteHostPid || 0) > 0;
}

function forwardRemoteControl(record: LiveRuntimeRecord, op: RemoteRuntimeControlOp, args: Record<string, unknown>): void {
  const hostPid = Number(record.remoteHostPid || 0);
  if (!hostPid || !remoteRuntimeControlForwarder) {
    console.warn(`[live-runtime] no handoff forwarder for remote runtime ${record.id} (${op})`);
    return;
  }
  remoteRuntimeControlForwarder(hostPid, op, args).then((result) => {
    if (!result.ok) console.warn(`[live-runtime] remote ${op} for runtime ${record.id} on host ${hostPid} failed: ${result.error || 'unknown'}`);
  }).catch((error: any) => {
    console.warn(`[live-runtime] remote ${op} for runtime ${record.id} on host ${hostPid} threw: ${error?.message || error}`);
  });
}

interface RuntimeLedger {
  version: 1;
  updatedAt: number;
  runtimes: Record<string, LiveRuntimeSnapshot>;
}

let runtimeLedgerCache: RuntimeLedger | null = null;

function getRuntimeStateDir(): string {
  const dir = path.join(getConfig().getConfigDir(), 'runtimes');
  return dir;
}

function getRuntimeLedgerPath(): string {
  return path.join(getRuntimeStateDir(), 'active-runtimes.json');
}

function getRuntimeEventsPath(): string {
  return path.join(getRuntimeStateDir(), 'runtime-events.ndjson');
}

function readLedger(): RuntimeLedger {
  if (runtimeLedgerCache) return runtimeLedgerCache;
  const filePath = getRuntimeLedgerPath();
  if (!fs.existsSync(filePath)) {
    runtimeLedgerCache = { version: 1, updatedAt: Date.now(), runtimes: {} };
    return runtimeLedgerCache;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    runtimeLedgerCache = {
      version: 1,
      updatedAt: Number(parsed?.updatedAt || Date.now()),
      runtimes: parsed?.runtimes && typeof parsed.runtimes === 'object' ? parsed.runtimes : {},
    };
    return runtimeLedgerCache;
  } catch {
    runtimeLedgerCache = { version: 1, updatedAt: Date.now(), runtimes: {} };
    return runtimeLedgerCache;
  }
}

function writeLedgerSync(ledger: RuntimeLedger): void {
  if (ledgerWritesFrozen) {
    runtimeLedgerCache = ledger;
    return;
  }
  const filePath = getRuntimeLedgerPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  ledger.updatedAt = Date.now();
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
  runtimeLedgerCache = ledger;
}

interface RuntimePersistenceEvent {
  t: number;
  type: string;
  runtimeId: string;
  kind: LiveRuntimeKind;
  sessionId?: string;
  taskId?: string;
  teamId?: string;
  agentId?: string;
  scheduleId?: string;
  status?: LiveRuntimeSnapshot['status'];
  pid?: number;
  extra?: Record<string, any>;
}

const MAX_PENDING_RUNTIME_EVENTS = 4096;
const pendingRuntimeEvents: RuntimePersistenceEvent[] = [];
const runtimePersistenceIdleWaiters = new Set<() => void>();
let runtimeLedgerDirty = false;
let runtimePersistenceActive = false;
let runtimePersistenceScheduled = false;
let runtimePersistenceBlocked = false;
let runtimePersistenceFailureStreak = 0;
let runtimePersistenceCompleted = 0;
let runtimePersistenceFailed = 0;
let runtimePersistenceDropped = 0;
let runtimePersistenceHighWater = 0;

function scheduleRuntimePersistenceDrain(): void {
  if (runtimePersistenceActive || runtimePersistenceScheduled || runtimePersistenceBlocked) return;
  runtimePersistenceScheduled = true;
  setImmediate(() => {
    runtimePersistenceScheduled = false;
    void drainRuntimePersistence();
  });
}

function queueRuntimePersistence(event?: RuntimePersistenceEvent): void {
  runtimeLedgerDirty = true;
  if (runtimePersistenceBlocked) runtimePersistenceFailureStreak = 0;
  runtimePersistenceBlocked = false;
  if (event) {
    if (pendingRuntimeEvents.length >= MAX_PENDING_RUNTIME_EVENTS) {
      // The latest ledger snapshot is authoritative for restart recovery.
      // Event rows are audit-only, so shed the oldest row under sustained
      // overload instead of retaining an unbounded queue.
      pendingRuntimeEvents.shift();
      runtimePersistenceDropped += 1;
    }
    pendingRuntimeEvents.push(event);
  }
  runtimePersistenceHighWater = Math.max(runtimePersistenceHighWater, pendingRuntimeEvents.length);
  scheduleRuntimePersistenceDrain();
}

function makeRuntimePersistenceEvent(
  type: string,
  runtime: LiveRuntimeSnapshot,
  extra?: Record<string, any>,
): RuntimePersistenceEvent {
  return {
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
    extra,
  };
}

function runtimeEventLine(event: RuntimePersistenceEvent): string {
  const { extra, ...fields } = event;
  return `${JSON.stringify({
    ...fields,
    ...(extra || {}),
  })}\n`;
}

function resolveRuntimePersistenceIdleWaiters(): void {
  if (runtimePersistenceActive || runtimePersistenceScheduled) return;
  if (!runtimePersistenceBlocked && (runtimeLedgerDirty || pendingRuntimeEvents.length)) return;
  for (const resolve of runtimePersistenceIdleWaiters) resolve();
  runtimePersistenceIdleWaiters.clear();
}

async function drainRuntimePersistence(): Promise<void> {
  if (runtimePersistenceActive) return;
  if (ledgerWritesFrozen) {
    // Handoff drain: the replacement gateway is the ledger writer now.
    pendingRuntimeEvents.splice(0);
    runtimeLedgerDirty = false;
    resolveRuntimePersistenceIdleWaiters();
    return;
  }
  runtimePersistenceActive = true;
  try {
    while (runtimeLedgerDirty || pendingRuntimeEvents.length) {
      const ledger = readLedger();
      const ledgerJson = JSON.stringify({ ...ledger, updatedAt: Date.now() }, null, 2);
      const events = pendingRuntimeEvents.splice(0);
      runtimeLedgerDirty = false;
      const stateDir = getRuntimeStateDir();
      const ledgerPath = getRuntimeLedgerPath();
      const tempPath = `${ledgerPath}.tmp-${process.pid}-${Date.now()}`;
      try {
        await fs.promises.mkdir(stateDir, { recursive: true });
        await fs.promises.writeFile(tempPath, ledgerJson, 'utf-8');
        await fs.promises.rename(tempPath, ledgerPath);
        if (events.length) {
          await fs.promises.appendFile(getRuntimeEventsPath(), events.map(runtimeEventLine).join(''), 'utf-8');
        }
        ledger.updatedAt = Date.now();
        runtimePersistenceCompleted += Math.max(1, events.length);
        runtimePersistenceFailureStreak = 0;
      } catch (err: any) {
        runtimePersistenceFailed += Math.max(1, events.length);
        // Restore events and dirty state so a later flush can retry.
        pendingRuntimeEvents.unshift(...events);
        if (pendingRuntimeEvents.length > MAX_PENDING_RUNTIME_EVENTS) {
          const excess = pendingRuntimeEvents.length - MAX_PENDING_RUNTIME_EVENTS;
          pendingRuntimeEvents.splice(0, excess);
          runtimePersistenceDropped += excess;
        }
        runtimeLedgerDirty = true;
        runtimePersistenceFailureStreak += 1;
        console.warn('[live-runtime] Failed to persist runtime state:', err?.message || err);
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        if (runtimePersistenceFailureStreak >= 3) runtimePersistenceBlocked = true;
        break;
      } finally {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    runtimePersistenceActive = false;
    if (!runtimePersistenceBlocked && (runtimeLedgerDirty || pendingRuntimeEvents.length)) scheduleRuntimePersistenceDrain();
    resolveRuntimePersistenceIdleWaiters();
  }
}

const MAX_DURABLE_CHECKPOINT_TEXT = 500;
const MAX_DURABLE_CHECKPOINT_TRACE_ENTRIES = 32;

function compactDurableCheckpointTrace(entries: unknown): Record<string, any>[] {
  const normalized = buildDurableChatTraceFromProcessEntries(
    Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') as Record<string, any>[] : [],
  ) || [];
  const out: Record<string, any>[] = [];
  normalized.slice(-MAX_DURABLE_CHECKPOINT_TRACE_ENTRIES).forEach((entry: any, index) => {
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const safeExtra: Record<string, any> = {};
    for (const key of ['source', 'event', 'visibility', 'reasoningKind', 'action', 'toolName', 'status']) {
      if (extra[key] !== undefined) safeExtra[key] = typeof extra[key] === 'string'
        ? String(extra[key]).slice(0, 160)
        : extra[key];
    }
    const text = String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    out.push({
      id: String(entry?.id || `runtime_trace_${index + 1}`).slice(0, 180),
      type: String(entry?.type || 'info').slice(0, 40),
      text: text.slice(0, 900),
      ...(Object.keys(safeExtra).length ? { extra: safeExtra } : {}),
    });
  });
  return out;
}

// Strip the heavy live-UI payload (raw process log, long messages) before writing
// to the durable ledger. Keep only a small sanitized trace/narration tail so an
// unexpected process loss can still reconstruct the interrupted turn; the full
// record stays in memory for live UI + graceful shutdown capture.
function toDurableSnapshot(snapshot: LiveRuntimeSnapshot): LiveRuntimeSnapshot {
  const out: LiveRuntimeSnapshot = { ...snapshot };
  const cp = out.checkpoint;
  if (cp && typeof cp === 'object') {
    const light: Record<string, any> = {
      event: cp.event,
      phase: cp.phase,
      message: typeof cp.message === 'string' ? cp.message.slice(0, MAX_DURABLE_CHECKPOINT_TEXT) : cp.message,
      toolName: cp.toolName,
      label: cp.label,
      kind: cp.kind,
      detail: typeof cp.detail === 'string' ? cp.detail.slice(0, MAX_DURABLE_CHECKPOINT_TEXT) : cp.detail,
      pendingSteerCount: cp.pendingSteerCount,
      updatedAt: cp.updatedAt,
      ...(typeof cp.narrationTail === 'string' && cp.narrationTail.trim()
        ? { narrationTail: cp.narrationTail.slice(-2_400) }
        : {}),
      ...(Array.isArray(cp.processEntries) && cp.processEntries.length
        ? { processEntries: compactDurableCheckpointTrace(cp.processEntries) }
        : {}),
    };
    for (const k of Object.keys(light)) {
      if (light[k] === undefined) delete light[k];
    }
    out.checkpoint = light;
  }
  return out;
}

function persistRuntime(runtime: LiveRuntimeSnapshot, eventType: string, extra?: Record<string, any>, opts?: { full?: boolean }): void {
  if (livePersistenceSink && !runtime.remoteHostPid) {
    try { livePersistenceSink.upsert(opts?.full ? runtime : toDurableSnapshot(runtime), eventType, extra); } catch (err: any) {
      console.warn('[live-runtime] Handoff persistence sink upsert failed:', err?.message || err);
    }
    return;
  }
  try {
    const ledger = readLedger();
    // `full` keeps the heavy checkpoint (process log) on disk — only used on
    // interruption so the owning session can recover its own full context.
    ledger.runtimes[runtime.id] = opts?.full ? runtime : toDurableSnapshot(runtime);
    queueRuntimePersistence(makeRuntimePersistenceEvent(eventType, runtime, extra));
  } catch (err: any) {
    console.warn('[live-runtime] Failed to persist runtime:', err?.message || err);
  }
}

// Remove a runtime from the durable ledger entirely (terminal runtimes do not
// need to survive a restart). Still appends a one-line audit event.
function deleteDurableRuntime(id: string, eventType: string, snapshotForEvent?: LiveRuntimeSnapshot, extra?: Record<string, any>): void {
  if (livePersistenceSink && !snapshotForEvent?.remoteHostPid) {
    try { livePersistenceSink.delete(id, eventType, snapshotForEvent ? toDurableSnapshot(snapshotForEvent) : undefined, extra); } catch (err: any) {
      console.warn('[live-runtime] Handoff persistence sink delete failed:', err?.message || err);
    }
    return;
  }
  try {
    const ledger = readLedger();
    if (ledger.runtimes[id]) {
      delete ledger.runtimes[id];
    }
    queueRuntimePersistence(snapshotForEvent ? makeRuntimePersistenceEvent(eventType, snapshotForEvent, extra) : undefined);
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
    clientRequestId: record.clientRequestId,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    abortable: record.abortable,
    abortRequestedAt: record.abortRequestedAt,
    abortReason: record.abortReason,
    abortSource: record.abortSource,
    deferTerminalCleanup: record.deferTerminalCleanup,
    status: record.status,
    recoveryPolicy: record.recoveryPolicy,
    recoveryData: record.recoveryData,
    checkpoint: record.checkpoint,
    completedAt: record.completedAt,
    interruptedAt: record.interruptedAt,
    interruptReason: record.interruptReason,
    pid: record.pid,
    ...(record.remoteHostPid ? { remoteHostPid: record.remoteHostPid } : {}),
  };
}

/** Compact, transport-safe form of a snapshot (no raw process log). */
export function toDurableLiveRuntimeSnapshot(snapshot: LiveRuntimeSnapshot): LiveRuntimeSnapshot {
  return toDurableSnapshot(snapshot);
}

// ─── Remote (handoff-hosted) runtime mirrors ─────────────────────────────────

function normalizeRemoteSnapshot(hostPid: number, input: Record<string, any>): LiveRuntimeSnapshot | null {
  const id = String(input?.id || '').trim();
  const kind = String(input?.kind || '').trim() as LiveRuntimeKind;
  if (!id || !kind) return null;
  const { abortSignal: _abortSignal, onAbort: _onAbort, pendingSteers: _pendingSteers, ...rest } = input as any;
  return {
    ...rest,
    id,
    kind,
    label: String(input.label || kind),
    startedAt: Number(input.startedAt) || Date.now(),
    abortable: input.abortable !== false,
    status: input.status || 'running',
    pid: hostPid,
    remoteHostPid: hostPid,
    deferTerminalCleanup: false,
  };
}

/**
 * Mirror a runtime still owned by a draining gateway. The replacement keeps the
 * durable ledger entry (under the host's pid) so a further restart can adopt
 * the same host again, and so admission/UI code sees the session as busy.
 */
export function upsertRemoteLiveRuntime(
  hostPid: number,
  input: Record<string, any>,
  eventType = 'remote_mirror',
  extra?: Record<string, any>,
): LiveRuntimeSnapshot | null {
  const snapshot = normalizeRemoteSnapshot(hostPid, input);
  if (!snapshot) return null;
  const existing = activeRuntimes.get(snapshot.id);
  if (existing && !isRemoteRecord(existing)) {
    // Never let a mirror shadow a runtime this process owns.
    return toSnapshot(existing);
  }
  const record: LiveRuntimeRecord = {
    ...(existing || {}),
    ...snapshot,
    updatedAt: Number(snapshot.updatedAt) || Date.now(),
  };
  const terminal = snapshot.status === 'completed' || snapshot.status === 'aborted';
  if (terminal) {
    activeRuntimes.delete(snapshot.id);
    deleteDurableRuntime(snapshot.id, eventType, snapshot, { ...(extra || {}), hostPid });
    return snapshot;
  }
  if (snapshot.status === 'interrupted') {
    // The host interrupted this runtime (restart-initiating turn or drain
    // timeout). It is not live anywhere any more; keep only the durable
    // record so crash/planned recovery can pick it up.
    activeRuntimes.delete(snapshot.id);
    const ledger = readLedger();
    ledger.runtimes[snapshot.id] = snapshot;
    queueRuntimePersistence(makeRuntimePersistenceEvent(eventType, snapshot, { ...(extra || {}), hostPid }));
    return snapshot;
  }
  activeRuntimes.set(snapshot.id, record);
  try {
    const ledger = readLedger();
    ledger.runtimes[snapshot.id] = toDurableSnapshot(snapshot);
    queueRuntimePersistence(makeRuntimePersistenceEvent(eventType, snapshot, { ...(extra || {}), hostPid }));
  } catch (err: any) {
    console.warn('[live-runtime] Failed to persist remote runtime mirror:', err?.message || err);
  }
  return toSnapshot(record);
}

export function removeRemoteLiveRuntime(
  hostPid: number,
  runtimeId: string,
  eventType = 'remote_finished',
  runtime?: Record<string, any>,
  extra?: Record<string, any>,
): LiveRuntimeSnapshot | null {
  const key = String(runtimeId || '');
  const record = activeRuntimes.get(key);
  if (record && !isRemoteRecord(record)) return toSnapshot(record);
  if (record) activeRuntimes.delete(key);
  const snapshot = runtime ? normalizeRemoteSnapshot(hostPid, runtime) : record ? toSnapshot(record) : null;
  try {
    const ledger = readLedger();
    if (ledger.runtimes[key]) delete ledger.runtimes[key];
    queueRuntimePersistence(snapshot ? makeRuntimePersistenceEvent(eventType, snapshot, { ...(extra || {}), hostPid }) : undefined);
  } catch (err: any) {
    console.warn('[live-runtime] Failed to remove remote runtime mirror:', err?.message || err);
  }
  return snapshot;
}

/**
 * Apply the host's authoritative running set. Ledger entries recorded under
 * that host pid that are still `running` but absent from the set finished
 * before the replacement connected, so they are dropped. Interrupted entries
 * are left for recovery.
 */
export function syncRemoteLiveRuntimes(hostPid: number, runtimes: Array<Record<string, any>>): { mirrored: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const mirrored: string[] = [];
  for (const input of runtimes) {
    const snapshot = upsertRemoteLiveRuntime(hostPid, input, 'remote_sync');
    if (!snapshot) continue;
    seen.add(snapshot.id);
    // A local runtime with the same id is never a mirror.
    if (snapshot.status === 'running' && Number(snapshot.remoteHostPid) === hostPid) mirrored.push(snapshot.id);
  }
  const dropped: string[] = [];
  for (const [id, record] of activeRuntimes.entries()) {
    if (isRemoteRecord(record) && Number(record.remoteHostPid) === hostPid && !seen.has(id)) {
      activeRuntimes.delete(id);
      dropped.push(id);
    }
  }
  const ledger = readLedger();
  for (const [id, entry] of Object.entries(ledger.runtimes || {})) {
    if (Number(entry?.pid || 0) !== hostPid || seen.has(id)) continue;
    if (entry.status !== 'running') continue;
    delete ledger.runtimes[id];
    if (!dropped.includes(id)) dropped.push(id);
  }
  if (dropped.length) queueRuntimePersistence();
  return { mirrored, dropped };
}

/** Forget every mirror for a host (drained or lost) without touching the ledger. */
export function dropRemoteLiveRuntimesForHost(hostPid: number): LiveRuntimeSnapshot[] {
  const dropped: LiveRuntimeSnapshot[] = [];
  for (const [id, record] of activeRuntimes.entries()) {
    if (!isRemoteRecord(record) || Number(record.remoteHostPid) !== hostPid) continue;
    activeRuntimes.delete(id);
    dropped.push(toSnapshot(record));
  }
  return dropped;
}

/**
 * A host died mid-drain. Its ledger entries still say `running`; stamp them as
 * interrupted (with a restart epoch) so the standard crash-recovery pass
 * handles them exactly like a gateway crash would.
 */
export function markRemoteHostRuntimesInterrupted(hostPid: number, reason: string): LiveRuntimeSnapshot[] {
  const epoch = Date.now();
  const interrupted: LiveRuntimeSnapshot[] = [];
  dropRemoteLiveRuntimesForHost(hostPid);
  const ledger = readLedger();
  for (const entry of Object.values(ledger.runtimes || {})) {
    if (Number(entry?.pid || 0) !== hostPid || entry.status !== 'running') continue;
    entry.status = 'interrupted';
    entry.interruptedAt = epoch;
    entry.interruptReason = reason;
    entry.updatedAt = epoch;
    entry.recoveryData = { ...(entry.recoveryData || {}), restartEpoch: epoch, interruptReason: reason };
    delete entry.remoteHostPid;
    interrupted.push({ ...entry });
    queueRuntimePersistence(makeRuntimePersistenceEvent('interrupted', entry, { reason, hostPid }));
  }
  if (interrupted.length) queueRuntimePersistence();
  return interrupted;
}

export function listRemoteHandoffHostPids(): number[] {
  const pids = new Set<number>();
  for (const record of activeRuntimes.values()) {
    if (isRemoteRecord(record)) pids.add(Number(record.remoteHostPid));
  }
  return Array.from(pids);
}

export function findRemoteLiveRuntimeForTask(taskId: string): LiveRuntimeSnapshot | null {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  for (const record of activeRuntimes.values()) {
    if (isRemoteRecord(record) && record.status === 'running' && String(record.taskId || '') === tid) return toSnapshot(record);
  }
  return null;
}

export function listLocalRunningRuntimes(): LiveRuntimeSnapshot[] {
  return Array.from(activeRuntimes.values())
    .filter((record) => !isRemoteRecord(record) && record.status === 'running')
    .map(toSnapshot);
}

export function countLocalRunningRuntimes(): number {
  let count = 0;
  for (const record of activeRuntimes.values()) {
    if (!isRemoteRecord(record) && record.status === 'running') count += 1;
  }
  return count;
}

/**
 * Interrupt only the local runtimes a predicate selects (the turn that asked
 * for the restart) while the rest keep running through the handoff drain.
 */
export function markLocalRuntimesInterruptedForHandoff(
  reason: string,
  predicate: (runtime: LiveRuntimeSnapshot) => boolean,
): LiveRuntimeSnapshot[] {
  const interrupted: LiveRuntimeSnapshot[] = [];
  const restartEpoch = Date.now();
  let stamped = false;
  for (const record of activeRuntimes.values()) {
    if (isRemoteRecord(record) || record.status !== 'running') continue;
    if (!predicate(toSnapshot(record))) continue;
    if (!isRuntimeRecoverableAfterRestart(record)) continue;
    if (!stamped) {
      _restartInterruptEpoch = restartEpoch;
      stamped = true;
    }
    record.status = 'interrupted';
    record.interruptedAt = restartEpoch;
    record.interruptReason = reason;
    record.updatedAt = Date.now();
    finishRuntimeProgressLease(record.id);
    record.recoveryData = { ...(record.recoveryData || {}), restartEpoch, interruptReason: reason };
    if (record.abortSignal) {
      record.abortSignal.aborted = true;
      record.abortSignal.reason = reason;
    }
    const snapshot = toSnapshot(record);
    interrupted.push(snapshot);
    persistRuntime(snapshot, 'interrupted', { reason }, { full: true });
  }
  return interrupted;
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
    clientRequestId: registration.clientRequestId ? String(registration.clientRequestId) : undefined,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    abortable: !!registration.abortSignal || typeof registration.onAbort === 'function',
    status: 'running',
    recoveryPolicy: registration.recoveryPolicy || inferDefaultRecoveryPolicy(registration.kind),
    recoveryData: registration.recoveryData,
    pid: process.pid,
    abortSignal: registration.abortSignal,
    onAbort: registration.onAbort,
    deferTerminalCleanup: registration.deferTerminalCleanup === true,
  };
  activeRuntimes.set(id, record);
  registerRuntimeProgressLease({
    runtimeId: id,
    kind: record.kind,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
  });
  persistRuntime(toSnapshot(record), 'registered');
  return id;
}

export function finishLiveRuntime(id: string): void {
  const key = String(id || '');
  cancelCheckpointFlush(key);
  finishRuntimeProgressLease(key);
  const record = activeRuntimes.get(key);
  if (record) {
    // A draining previous gateway owns this runtime; only its own lifecycle
    // events may retire the mirror.
    if (isRemoteRecord(record)) return;
    // During gateway shutdown, prepareActiveRuntimesForGatewayShutdown() has
    // already persisted this runtime as interrupted and marked its abort
    // signal. The unwinding turn will still reach its normal finally block and
    // call finishLiveRuntime(). Do not let that late cleanup overwrite the
    // durable restart checkpoint as aborted/completed.
    if (record.status === 'interrupted' && record.interruptedAt) {
      activeRuntimes.delete(key);
      return;
    }
    // A foreground owner watchdog deliberately aborts the in-flight request,
    // but that abort must remain recoverable. The request's normal finally
    // block can arrive before the periodic watchdog gets a chance to move the
    // record into the interrupted ledger state, so do that transition here as
    // part of the idempotent finalizer.
    if (record.abortSource === 'main_chat_owner_watchdog') {
      record.status = 'interrupted';
      record.interruptedAt = Date.now();
      record.interruptReason = String(record.abortReason || 'main_chat_owner_watchdog').slice(0, 200);
      record.updatedAt = Date.now();
      if (record.abortSignal) record.abortSignal.reason = record.interruptReason;
      const snapshot = toSnapshot(record);
      persistRuntime(snapshot, 'interrupted', { reason: record.interruptReason }, { full: true });
      activeRuntimes.delete(key);
      return;
    }
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
    // Main-chat request handlers finish the stream, coordinator lease, and
    // runtime together in their outer finally block. A terminal checkpoint can
    // arrive just before that finally block; pruning here would recreate the
    // runtime/stream divergence that caused the production incident.
    if (record.deferTerminalCleanup) continue;
    cancelCheckpointFlush(id);
    finishRuntimeProgressLease(id);
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

export type RuntimeAbortOptions = {
  source?: string;
};

export function abortLiveRuntime(id: string, reason = 'operator_abort', options: RuntimeAbortOptions = {}): { ok: boolean; runtime?: LiveRuntimeSnapshot; error?: string } {
  const key = String(id || '');
  cancelCheckpointFlush(key);
  const record = activeRuntimes.get(key);
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (!record.abortable) return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not abortable.' };

  record.abortRequestedAt = Date.now();
  record.abortReason = String(reason || 'operator_abort').slice(0, 160);
  record.abortSource = String(options.source || '').trim().slice(0, 120) || undefined;
  record.updatedAt = Date.now();
  if (isRemoteRecord(record)) {
    // The owning gateway performs the real abort and mirrors the outcome back.
    forwardRemoteControl(record, 'runtime_abort', { runtimeId: record.id, reason: record.abortReason, source: record.abortSource });
    return { ok: true, runtime: toSnapshot(record) };
  }
  if (record.abortSignal) {
    record.abortSignal.aborted = true;
    record.abortSignal.reason = String(reason || 'operator_abort').slice(0, 160);
  }

  try {
    record.onAbort?.();
    // Deferred owners remain visible until their owning request settles. This
    // prevents getLiveRuntime()/listLiveRuntimes() from pruning a record while
    // its stream and execution promise are still alive.
    if (!record.deferTerminalCleanup) record.status = 'aborted';
    record.updatedAt = Date.now();
    finishRuntimeProgressLease(key);
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

  // A user stop is a terminal boundary for unfinished dev edits in this chat.
  // Keep their audit/verification evidence, but release their coordinator
  // ownership immediately so a stale aborted request cannot block later work
  // or a gateway restart. This is dynamic to keep the runtime registry free of
  // a static dependency cycle with the approval subsystem.
  try {
    const sessionId = String(record.sessionId || '').trim();
    if (sessionId && isSteerableChatRuntimeKind(record.kind)) {
      const { abandonDevSourceEditContinuationsForSession } = require('./dev-source-approvals');
      abandonDevSourceEditContinuationsForSession({ sessionId, reason: 'user_aborted_runtime' });
    }
  } catch (err: any) {
    console.warn('[live-runtime] Failed to release aborted dev-edit coordination:', err?.message || err);
  }

  const abortSnapshot = toSnapshot(record);
  persistRuntime(abortSnapshot, 'abort_requested', {
    source: record.abortSource || 'unspecified',
    reason: record.abortReason || 'operator_abort',
  });
  console.warn(`[live-runtime] abort requested runtime=${record.id} kind=${record.kind} session=${record.sessionId || 'none'} source=${record.abortSource || 'unspecified'} reason=${record.abortReason || 'operator_abort'}`);
  return { ok: true, runtime: abortSnapshot };
}

export function addPendingRuntimeSteer(
  id: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (isRemoteRecord(record)) {
    const remoteEvent: RuntimeSteerEvent = {
      ...(input as RuntimeSteerEvent),
      id: String(input.id || crypto.randomUUID()),
      sessionId: String(input.sessionId || record.sessionId || '').trim(),
      message: String(input.message || '').trim(),
      createdAt: Number(input.createdAt || Date.now()),
    };
    forwardRemoteControl(record, 'runtime_steer', { runtimeId: record.id, input: remoteEvent });
    return { ok: true, runtime: toSnapshot(record), event: remoteEvent };
  }
  const isTaskTargetedSteer = isSteerableTaskRuntimeKind(record.kind)
    && !!record.taskId
    && String(input.sessionId || '') === `task_${record.taskId}`;
  const isBackgroundAgentSteer = isSteerableBackgroundAgentRuntimeKind(record.kind)
    && String(input.sessionId || '') === String(record.sessionId || '');
  if (!isSteerableChatRuntimeKind(record.kind) && !isTaskTargetedSteer && !isBackgroundAgentSteer) {
    return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not steerable.' };
  }
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
    backgroundAgentId: input.backgroundAgentId ? String(input.backgroundAgentId) : undefined,
    backgroundAgentState: input.backgroundAgentState,
    internalWatchId: input.internalWatchId ? String(input.internalWatchId) : undefined,
    internalWatchKind: input.internalWatchKind,
    internalWatchActionPolicy: input.internalWatchActionPolicy,
    internalWatchTargetTaskId: input.internalWatchTargetTaskId ? String(input.internalWatchTargetTaskId) : undefined,
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
    const isChatMatch = (isSteerableChatRuntimeKind(record.kind) || isSteerableBackgroundAgentRuntimeKind(record.kind))
      && String(record.sessionId || '') === sid;
    const isTaskMatch = isSteerableTaskRuntimeKind(record.kind)
      && !!record.taskId
      && sid === `task_${record.taskId}`;
    if (!isChatMatch && !isTaskMatch) continue;
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

/**
 * Queue an event on the newest active foreground runtime for a chat session.
 * Background agents use this so their completion enters the same live inbox as
 * a user steer while retaining distinct provenance and instruction priority.
 */
export function addPendingRuntimeSteerForSession(
  sessionId: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'sessionId' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, error: 'Session id is required.' };
  const runtime = Array.from(activeRuntimes.values())
    .filter((record) => isSteerableChatRuntimeKind(record.kind) && String(record.sessionId || '') === sid)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
  if (!runtime) return { ok: false, error: 'No active steerable chat runtime for this session.' };
  return addPendingRuntimeSteer(runtime.id, { ...input, sessionId: sid });
}

/** Queue a live steer for one active background_spawn run by its public ID. */
export function addPendingRuntimeSteerForBackgroundAgent(
  backgroundAgentId: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'sessionId' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const agentId = String(backgroundAgentId || '').trim();
  if (!agentId) return { ok: false, error: 'Background agent id is required.' };
  const runtime = Array.from(activeRuntimes.values())
    .filter((record) => isSteerableBackgroundAgentRuntimeKind(record.kind) && String(record.taskId || '') === agentId)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
  if (!runtime) return { ok: false, error: 'No active background agent runtime was found for this id.' };
  return addPendingRuntimeSteer(runtime.id, {
    ...input,
    sessionId: String(runtime.sessionId || '').trim(),
  });
}

function scheduleCheckpointFlush(id: string, snapshot: LiveRuntimeSnapshot): void {
  const existing = _pendingLedgerFlush.get(id);
  if (existing) clearTimeout(existing);
  _pendingLedgerFlush.set(id, setTimeout(() => {
    _pendingLedgerFlush.delete(id);
    try { persistRuntime(snapshot, 'checkpoint'); } catch {}
  }, 200));
}

export function updateLiveRuntimeCheckpoint(
  id: string,
  checkpoint: Record<string, any>,
  options: { persist?: boolean } = {},
): void {
  const record = activeRuntimes.get(String(id || ''));
  if (!record || record.abortRequestedAt || record.status !== 'running' || isRemoteRecord(record)) return;
  record.checkpoint = {
    ...(record.checkpoint || {}),
    ...checkpoint,
    updatedAt: Date.now(),
  };
  record.updatedAt = Date.now();
  renewRuntimeProgressLease(record.id, {
    event: checkpoint?.event,
    phase: checkpoint?.phase,
    activeToolName: checkpoint?.toolName,
    checkpoint: true,
    at: record.updatedAt,
  });
  if (options.persist !== false) scheduleCheckpointFlush(id, toSnapshot(record));
}

/** Queue guidance directly into the live model loop for one persisted task. */
export function addPendingRuntimeSteerForTask(
  taskId: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'sessionId' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const tid = String(taskId || '').trim();
  if (!tid) return { ok: false, error: 'Task id is required.' };
  const runtime = Array.from(activeRuntimes.values())
    .filter((record) =>
      isSteerableTaskRuntimeKind(record.kind)
      && record.status === 'running'
      && String(record.taskId || '') === tid
    )
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];
  if (!runtime) return { ok: false, error: 'No active steerable runtime for this task.' };
  return addPendingRuntimeSteer(runtime.id, {
    ...input,
    sessionId: `task_${tid}`,
  });
}

/** Record observed model/tool activity without expanding the durable checkpoint ledger. */
export function markLiveRuntimeProgress(id: string, progress: RuntimeProgressLeaseRenewal = {}): void {
  const record = activeRuntimes.get(String(id || ''));
  if (!record || record.status !== 'running' || record.abortRequestedAt || isRemoteRecord(record)) return;
  renewRuntimeProgressLease(record.id, { ...progress, checkpoint: false });
}

/**
 * Move a stalled foreground owner into the durable restart-recovery path and
 * release the in-memory owner. The request promise may still unwind later;
 * finishLiveRuntime() is intentionally idempotent for that late cleanup.
 */
export function interruptLiveRuntimeForRecovery(id: string, reason = 'runtime_owner_watchdog'): { ok: boolean; runtime?: LiveRuntimeSnapshot; error?: string } {
  const key = String(id || '');
  const record = activeRuntimes.get(key);
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (isRemoteRecord(record)) return { ok: false, runtime: toSnapshot(record), error: 'Runtime is owned by a draining gateway.' };
  record.status = 'interrupted';
  record.interruptedAt = Date.now();
  record.interruptReason = String(reason || 'runtime_owner_watchdog').slice(0, 200);
  record.updatedAt = Date.now();
  if (record.abortSignal) {
    record.abortSignal.aborted = true;
    record.abortSignal.reason = record.interruptReason;
  }
  finishRuntimeProgressLease(key);
  const snapshot = toSnapshot(record);
  persistRuntime(snapshot, 'interrupted', { reason: record.interruptReason }, { full: true });
  activeRuntimes.delete(key);
  return { ok: true, runtime: snapshot };
}

export function markActiveRuntimesInterrupted(reason = 'gateway_shutdown'): LiveRuntimeSnapshot[] {
  const interrupted: LiveRuntimeSnapshot[] = [];
  // Stamp a single epoch for this shutdown so every runtime interrupted in this
  // pass shares it. Post-restart recovery uses this to carry forward ONLY work that
  // this restart actually interrupted, not pre-paused/failed or stale-crash records.
  const restartEpoch = Date.now();
  _restartInterruptEpoch = restartEpoch;
  for (const record of activeRuntimes.values()) {
    // Mirrors of a draining gateway's runtimes are not ours to interrupt; the
    // ledger keeps them under the host pid so the next gateway re-adopts them.
    if (isRemoteRecord(record)) continue;
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
    finishRuntimeProgressLease(record.id);
    // Persist the restart epoch onto recoveryData so it survives in the durable
    // ledger and the post-restart process can match "interrupted by this restart".
    record.recoveryData = { ...(record.recoveryData || {}), restartEpoch, interruptReason: reason };
    if (record.abortSignal) {
      record.abortSignal.aborted = true;
      record.abortSignal.reason = reason;
    }
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

export function warmLiveRuntimePersistence(): { runtimes: number } {
  return { runtimes: Object.keys(readLedger().runtimes || {}).length };
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
  queueRuntimePersistence(makeRuntimePersistenceEvent('recovered', runtime, extra));
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
    if (removed > 0) queueRuntimePersistence();
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
        writeLedgerSync({ version: 1, updatedAt: Date.now(), runtimes: next });
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

export function flushLiveRuntimePersistence(): Promise<void> {
  if (runtimePersistenceBlocked || ledgerWritesFrozen) return Promise.resolve();
  if (!runtimePersistenceActive && !runtimePersistenceScheduled && !runtimeLedgerDirty && pendingRuntimeEvents.length === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    runtimePersistenceIdleWaiters.add(resolve);
    scheduleRuntimePersistenceDrain();
  });
}

export function getLiveRuntimePersistenceStatus(): {
  pendingEvents: number;
  ledgerDirty: boolean;
  active: boolean;
  scheduled: boolean;
  blocked: boolean;
  completed: number;
  failed: number;
  dropped: number;
  highWater: number;
  maxPendingEvents: number;
} {
  return {
    pendingEvents: pendingRuntimeEvents.length,
    ledgerDirty: runtimeLedgerDirty,
    active: runtimePersistenceActive,
    scheduled: runtimePersistenceScheduled,
    blocked: runtimePersistenceBlocked,
    completed: runtimePersistenceCompleted,
    failed: runtimePersistenceFailed,
    dropped: runtimePersistenceDropped,
    highWater: runtimePersistenceHighWater,
    maxPendingEvents: MAX_PENDING_RUNTIME_EVENTS,
  };
}
