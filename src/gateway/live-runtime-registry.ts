import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/config';

export type LiveRuntimeKind =
  | 'main_chat'
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

function persistRuntime(runtime: LiveRuntimeSnapshot, eventType: string, extra?: Record<string, any>): void {
  try {
    const ledger = readLedger();
    ledger.runtimes[runtime.id] = runtime;
    writeLedger(ledger);
    appendRuntimeEvent(eventType, runtime, extra);
  } catch (err: any) {
    console.warn('[live-runtime] Failed to persist runtime:', err?.message || err);
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
  const record = activeRuntimes.get(key);
  if (record) {
    record.status = record.abortSignal?.aborted ? 'aborted' : 'completed';
    record.completedAt = Date.now();
    record.updatedAt = Date.now();
    persistRuntime(toSnapshot(record), record.status === 'aborted' ? 'aborted' : 'completed');
  }
  activeRuntimes.delete(key);
}

export function getLiveRuntime(id: string): LiveRuntimeSnapshot | null {
  const record = activeRuntimes.get(String(id || ''));
  return record ? toSnapshot(record) : null;
}

export function listLiveRuntimes(): LiveRuntimeSnapshot[] {
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
  const record = activeRuntimes.get(String(id || ''));
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

  persistRuntime(toSnapshot(record), 'abort_requested');
  return { ok: true, runtime: toSnapshot(record) };
}

export function addPendingRuntimeSteer(
  id: string,
  input: Omit<RuntimeSteerEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): { ok: boolean; runtime?: LiveRuntimeSnapshot; event?: RuntimeSteerEvent; error?: string } {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return { ok: false, error: 'Runtime not found.' };
  if (record.kind !== 'main_chat') return { ok: false, runtime: toSnapshot(record), error: 'Runtime is not steerable.' };
  const message = String(input.message || '').trim();
  if (!message) return { ok: false, runtime: toSnapshot(record), error: 'Steer message is empty.' };
  const event: RuntimeSteerEvent = {
    id: String(input.id || crypto.randomUUID()),
    sessionId: String(input.sessionId || record.sessionId || '').trim(),
    message,
    source: input.source ? String(input.source) : undefined,
    createdAt: Number(input.createdAt || Date.now()),
    clientRequestId: input.clientRequestId ? String(input.clientRequestId) : undefined,
    kind: input.kind,
    requiresWorkerResponse: input.requiresWorkerResponse === true,
    voiceContextPacketId: input.voiceContextPacketId ? String(input.voiceContextPacketId) : undefined,
    spokenAck: input.spokenAck ? String(input.spokenAck).slice(0, 1000) : undefined,
    responseMode: input.responseMode,
    contextSummary: input.contextSummary ? String(input.contextSummary).slice(0, 2000) : undefined,
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
    if (record.kind !== 'main_chat' || String(record.sessionId || '') !== sid) continue;
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

export function updateLiveRuntimeCheckpoint(id: string, checkpoint: Record<string, any>): void {
  const record = activeRuntimes.get(String(id || ''));
  if (!record) return;
  record.checkpoint = {
    ...(record.checkpoint || {}),
    ...checkpoint,
    updatedAt: Date.now(),
  };
  record.updatedAt = Date.now();
  persistRuntime(toSnapshot(record), 'checkpoint');
}

export function markActiveRuntimesInterrupted(reason = 'gateway_shutdown'): LiveRuntimeSnapshot[] {
  const interrupted: LiveRuntimeSnapshot[] = [];
  for (const record of activeRuntimes.values()) {
    record.status = 'interrupted';
    record.interruptedAt = Date.now();
    record.interruptReason = reason;
    record.updatedAt = Date.now();
    if (record.abortSignal) record.abortSignal.aborted = true;
    const snapshot = toSnapshot(record);
    interrupted.push(snapshot);
    persistRuntime(snapshot, 'interrupted', { reason });
  }
  return interrupted;
}

export function listDurableRuntimes(): LiveRuntimeSnapshot[] {
  return Object.values(readLedger().runtimes || {})
    .sort((a, b) => Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0));
}

export function listInterruptedRuntimes(): LiveRuntimeSnapshot[] {
  return listDurableRuntimes().filter((runtime) => {
    if (runtime.status === 'running') return true;
    if (runtime.status !== 'interrupted') return false;
    const recoveryData = runtime.recoveryData || {};
    return !recoveryData.recoveredAt && !recoveryData.recovery;
  });
}

export function markDurableRuntimeRecovered(id: string, status: 'completed' | 'aborted' | 'interrupted' = 'interrupted', extra?: Record<string, any>): void {
  const ledger = readLedger();
  const runtime = ledger.runtimes[String(id || '')];
  if (!runtime) return;
  runtime.status = status;
  runtime.updatedAt = Date.now();
  if (status === 'interrupted' && !runtime.interruptedAt) runtime.interruptedAt = Date.now();
  runtime.recoveryData = { ...(runtime.recoveryData || {}), ...(extra || {}), recoveredAt: Date.now() };
  ledger.runtimes[runtime.id] = runtime;
  writeLedger(ledger);
  appendRuntimeEvent('recovered', runtime, extra);
}
