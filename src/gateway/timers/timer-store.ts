import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';
import { quarantineCorruptStateFile, writeFileAtomicSync } from '../state-file-quarantine';
import { getMainChatGoal, getSessionExternalAgent } from '../session';
import { isPidAlive } from '../runtime/recovery-claims';

export type MainChatTimerStatus = 'pending' | 'due_waiting' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface MainChatTimer {
  id: string;
  sessionId: string;
  label: string;
  instruction: string;
  dueAt: string;
  status: MainChatTimerStatus;
  createdAt: string;
  updatedAt: string;
  firedAt?: string;
  completedAt?: string;
  resultPreview?: string;
  error?: string;
  origin?: Record<string, any>;
  delivery?: Record<string, any>;
  /** Gateway process that marked this timer `running` (kept afterwards for diagnostics). */
  ownerPid?: number;
  /** ISO start time of that process, so a reused pid is not mistaken for the owner. */
  ownerStartedAt?: string;
}

interface TimerStoreData {
  timers: MainChatTimer[];
  updatedAt: string;
}

// A `running` timer is owned by the process that fired it, recorded on the timer
// as ownerPid + ownerStartedAt. A later process recovers a running timer only
// once that owner is gone, so it is picked up again instead of remaining
// stranded forever. Records without an owner (written by older builds) are
// recovered on any fresh boot.
const timerStoreProcessStartedAt = Date.now();
const timerOwnerPid = process.pid;
const timerOwnerStartedAt = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/**
 * Backstop for pid reuse: an unrelated process that took a dead owner's pid
 * cannot be told apart from the owner, so a running timer fired longer ago than
 * this is recovered even while its owner pid still answers.
 */
export const OWNED_RUNNING_TIMER_MAX_MS = 24 * 60 * 60 * 1000;

/** Who is asking, and how to tell whether another process exists. Overridable in tests. */
export interface TimerOwnerProbe {
  pid: number;
  startedAt: string;
  isPidAlive: (pid: number) => boolean;
  nowMs: number;
}

function getTimerDir(): string {
  return path.join(getConfig().getConfigDir(), 'timers');
}

function getTimerStorePath(): string {
  return path.join(getTimerDir(), 'timers.json');
}

function defaultStore(): TimerStoreData {
  return { timers: [], updatedAt: new Date().toISOString() };
}

function normalizeTimer(raw: any): MainChatTimer | null {
  const id = String(raw?.id || '').trim();
  const sessionId = String(raw?.sessionId || '').trim();
  const instruction = String(raw?.instruction || '').trim();
  const due = new Date(String(raw?.dueAt || ''));
  if (!id || !sessionId || !instruction || !Number.isFinite(due.getTime())) return null;
  const status = String(raw?.status || 'pending') as MainChatTimerStatus;
  return {
    id,
    sessionId,
    label: String(raw?.label || instruction.slice(0, 60) || 'Timer').trim(),
    instruction,
    dueAt: due.toISOString(),
    status: ['pending', 'due_waiting', 'running', 'completed', 'cancelled', 'failed'].includes(status) ? status : 'pending',
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    firedAt: raw?.firedAt ? String(raw.firedAt) : undefined,
    completedAt: raw?.completedAt ? String(raw.completedAt) : undefined,
    resultPreview: raw?.resultPreview ? String(raw.resultPreview) : undefined,
    error: raw?.error ? String(raw.error) : undefined,
    origin: raw?.origin && typeof raw.origin === 'object' ? raw.origin : undefined,
    delivery: raw?.delivery && typeof raw.delivery === 'object' ? raw.delivery : undefined,
    ownerPid: Number.isInteger(Number(raw?.ownerPid)) && Number(raw.ownerPid) > 0 ? Number(raw.ownerPid) : undefined,
    ownerStartedAt: raw?.ownerStartedAt ? String(raw.ownerStartedAt) : undefined,
  };
}

/**
 * True when a `running` timer is being run by a process that still exists: this
 * one, or another gateway that is alive (the draining host after a warm
 * handoff). Records without an owner return false.
 */
function isTimerRunningInLiveProcess(timer: MainChatTimer, probe: TimerOwnerProbe): boolean {
  const ownerPid = Number(timer.ownerPid);
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
  // Same pid with a recorded start time is decisive: an exact match is this
  // process (never recover, uncapped); a mismatch means this process reused a
  // dead owner's pid.
  if (ownerPid === probe.pid && timer.ownerStartedAt) return timer.ownerStartedAt === probe.startedAt;
  // Everything else is unproven (another pid, or this pid with no start time
  // recorded), so it is bounded by the age cap.
  const firedAtMs = new Date(timer.firedAt || timer.updatedAt).getTime();
  if (Number.isFinite(firedAtMs) && probe.nowMs - firedAtMs > OWNED_RUNNING_TIMER_MAX_MS) return false;
  return ownerPid === probe.pid || probe.isPidAlive(ownerPid);
}

export function recoverStrandedMainChatTimers(
  timers: MainChatTimer[],
  processStartedAt: number = timerStoreProcessStartedAt,
  ownerProbe: Partial<TimerOwnerProbe> = {},
): boolean {
  const probe: TimerOwnerProbe = { pid: timerOwnerPid, startedAt: timerOwnerStartedAt, isPidAlive, nowMs: Date.now(), ...ownerProbe };
  let recovered = false;
  for (const timer of timers) {
    const lastOwnedAt = new Date(timer.firedAt || timer.updatedAt).getTime();
    if (timer.status !== 'running' || !Number.isFinite(lastOwnedAt) || lastOwnedAt >= processStartedAt) continue;
    // After a warm handoff the gateway that fired this timer is still alive as a
    // draining host and still running the turn. Recovering the timer here would
    // start a second copy of that turn (2026-11-27: one timer ran three times).
    if (isTimerRunningInLiveProcess(timer, probe)) continue;
    // The original runner died with the previous process. Preserve its schedule
    // semantics: future timers wait pending; elapsed timers wait to be claimed.
    timer.status = new Date(timer.dueAt).getTime() <= processStartedAt ? 'due_waiting' : 'pending';
    timer.firedAt = undefined;
    timer.completedAt = undefined;
    timer.ownerPid = undefined;
    timer.ownerStartedAt = undefined;
    timer.error = 'Recovered after the process that owned this timer stopped.';
    timer.updatedAt = new Date().toISOString();
    recovered = true;
  }
  return recovered;
}

function loadStore(): TimerStoreData {
  const p = getTimerStorePath();
  if (!fs.existsSync(p)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const timers = Array.isArray(parsed?.timers)
      ? parsed.timers.map(normalizeTimer).filter(Boolean) as MainChatTimer[]
      : [];
    const store: TimerStoreData = {
      timers,
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
    };
    if (recoverStrandedMainChatTimers(store.timers)) saveStore(store);
    return store;
  } catch (err) {
    // Preserve the damaged file before the next save replaces it with defaults.
    quarantineCorruptStateFile(p, 'MainChatTimers', err);
    return defaultStore();
  }
}

function saveStore(store: TimerStoreData): void {
  const dir = getTimerDir();
  fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  // pid+random temp name: overlapping gateways (warm handoff) must not share a temp file.
  writeFileAtomicSync(getTimerStorePath(), JSON.stringify(store, null, 2));
}

export function createMainChatTimer(input: {
  sessionId: string;
  instruction: string;
  dueAt: Date;
  label?: string;
  fromGoalTurn?: boolean;
  origin?: Record<string, any>;
  delivery?: Record<string, any>;
}): MainChatTimer {
  const instruction = String(input.instruction || '').trim();
  const goal = getMainChatGoal(input.sessionId);
  const origin = input.fromGoalTurn === true && goal?.status === 'active' && !goal.userStoppedAt
    ? { ...input.origin, goalId: goal.id } : input.origin;
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId is required');
  if (getSessionExternalAgent(sessionId)) {
    throw new Error("Timers don't apply here: this chat is run by a connected agent (Codex), not Prometheus.");
  }
  if (!instruction) throw new Error('instruction is required');
  if (!Number.isFinite(input.dueAt.getTime())) throw new Error('dueAt must be valid');

  const now = new Date().toISOString();
  const timer: MainChatTimer = {
    id: `timer_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    sessionId,
    label: String(input.label || instruction.slice(0, 60) || 'Timer').trim(),
    instruction,
    dueAt: input.dueAt.toISOString(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    origin: origin && typeof origin === 'object' ? origin : undefined,
    delivery: input.delivery && typeof input.delivery === 'object' ? input.delivery : undefined,
  };
  const store = loadStore();
  store.timers.push(timer);
  saveStore(store);
  return timer;
}

export function listMainChatTimers(filter?: { sessionId?: string; includeDone?: boolean }): MainChatTimer[] {
  const sessionId = String(filter?.sessionId || '').trim();
  const includeDone = filter?.includeDone === true;
  return loadStore().timers
    .filter((timer) => !sessionId || timer.sessionId === sessionId)
    .filter((timer) => includeDone || !['completed', 'cancelled'].includes(timer.status))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

export function getDueMainChatTimers(now: Date = new Date()): MainChatTimer[] {
  const nowMs = now.getTime();
  return loadStore().timers
    .filter((timer) => timer.status === 'pending' || timer.status === 'due_waiting')
    .filter((timer) => new Date(timer.dueAt).getTime() <= nowMs)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

/**
 * Mark a due timer as running in this process and record this process as its
 * owner. Returns null when the timer is no longer due (cancelled, or already
 * claimed by another gateway process); the caller must not run it then.
 */
export function claimMainChatTimerForRun(id: string, firedAt: string = new Date().toISOString()): MainChatTimer | null {
  const timerId = String(id || '').trim();
  if (!timerId) return null;
  const store = loadStore();
  const idx = store.timers.findIndex((timer) => timer.id === timerId);
  if (idx < 0) return null;
  const current = store.timers[idx];
  if (current.status !== 'pending' && current.status !== 'due_waiting') return null;
  store.timers[idx] = {
    ...current,
    status: 'running',
    firedAt,
    ownerPid: timerOwnerPid,
    ownerStartedAt: timerOwnerStartedAt,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store.timers[idx];
}

export function updateMainChatTimer(id: string, patch: Partial<MainChatTimer>): MainChatTimer | null {
  const timerId = String(id || '').trim();
  if (!timerId) return null;
  const store = loadStore();
  const idx = store.timers.findIndex((timer) => timer.id === timerId);
  if (idx < 0) return null;
  // A settling async timer turn must not undo an owner's cancellation.
  if (store.timers[idx].status === 'cancelled' && patch.status && patch.status !== 'cancelled') return store.timers[idx];
  store.timers[idx] = {
    ...store.timers[idx],
    ...patch,
    id: store.timers[idx].id,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store.timers[idx];
}

export function cancelMainChatTimer(id: string): MainChatTimer | null {
  return updateMainChatTimer(id, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  });
}

/** Cancel only timers with explicit goal ownership, never ordinary reminders. */
export function cancelMainChatGoalTimers(sessionId: string, goalId: string, reason = 'goal stopped'): void {
  const store = loadStore();
  let changed = false;
  for (const timer of store.timers) {
    if (timer.sessionId !== sessionId || timer.origin?.goalId !== goalId
      || !['pending', 'due_waiting', 'running'].includes(timer.status)) continue;
    timer.status = 'cancelled';
    timer.error = reason;
    timer.completedAt = new Date().toISOString();
    timer.updatedAt = timer.completedAt;
    changed = true;
  }
  if (changed) saveStore(store);
}
