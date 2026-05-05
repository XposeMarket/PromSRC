import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';

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
}

interface TimerStoreData {
  timers: MainChatTimer[];
  updatedAt: string;
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
  };
}

function loadStore(): TimerStoreData {
  const p = getTimerStorePath();
  if (!fs.existsSync(p)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const timers = Array.isArray(parsed?.timers)
      ? parsed.timers.map(normalizeTimer).filter(Boolean) as MainChatTimer[]
      : [];
    return {
      timers,
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
    };
  } catch {
    return defaultStore();
  }
}

function saveStore(store: TimerStoreData): void {
  const dir = getTimerDir();
  fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  const p = getTimerStorePath();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function createMainChatTimer(input: {
  sessionId: string;
  instruction: string;
  dueAt: Date;
  label?: string;
}): MainChatTimer {
  const instruction = String(input.instruction || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId is required');
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

export function updateMainChatTimer(id: string, patch: Partial<MainChatTimer>): MainChatTimer | null {
  const timerId = String(id || '').trim();
  if (!timerId) return null;
  const store = loadStore();
  const idx = store.timers.findIndex((timer) => timer.id === timerId);
  if (idx < 0) return null;
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
