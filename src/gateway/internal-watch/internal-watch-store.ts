import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig } from '../../config/config';

export type InternalWatchTargetType = 'file' | 'task' | 'scheduled_job' | 'event_queue';
export type InternalWatchStatus = 'active' | 'matched' | 'timed_out' | 'cancelled' | 'failed';

export interface InternalWatchOrigin {
  sessionId: string;
  channel?: 'web' | 'telegram';
  telegramChatId?: number;
  telegramUserId?: number;
}

export interface InternalWatchTarget {
  type: InternalWatchTargetType;
  config: Record<string, any>;
}

export interface InternalWatchCondition {
  mode?: string;
  terminalStatuses?: string[];
  requireText?: string;
  absentText?: string;
  match?: Record<string, any>;
}

export interface InternalWatch {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ttlMs: number;
  origin: InternalWatchOrigin;
  target: InternalWatchTarget;
  condition: InternalWatchCondition;
  onMatch: string;
  onTimeout?: string;
  maxFirings: number;
  firedCount: number;
  status: InternalWatchStatus;
  lastCheckedAt?: string;
  lastObservation?: Record<string, any>;
  matchedAt?: string;
  timedOutAt?: string;
  completedAt?: string;
  error?: string;
}

interface InternalWatchStoreData {
  watches: InternalWatch[];
  updatedAt: string;
}

const DEFAULT_TTL_MS = 20 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function getWatchDir(): string {
  return path.join(getConfig().getConfigDir(), 'internal-watch');
}

function getWatchStorePath(): string {
  return path.join(getWatchDir(), 'watches.json');
}

function defaultStore(): InternalWatchStoreData {
  return { watches: [], updatedAt: new Date().toISOString() };
}

function cleanIdSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function normalizeStatus(raw: any): InternalWatchStatus {
  const status = String(raw || 'active');
  return ['active', 'matched', 'timed_out', 'cancelled', 'failed'].includes(status)
    ? status as InternalWatchStatus
    : 'active';
}

function normalizeWatch(raw: any): InternalWatch | null {
  const id = String(raw?.id || '').trim();
  const sessionId = String(raw?.origin?.sessionId || raw?.sessionId || '').trim();
  const targetType = String(raw?.target?.type || '').trim() as InternalWatchTargetType;
  const expiresAt = new Date(String(raw?.expiresAt || ''));
  if (!id || !sessionId || !['file', 'task', 'scheduled_job', 'event_queue'].includes(targetType)) return null;
  if (!Number.isFinite(expiresAt.getTime())) return null;
  const createdAt = String(raw?.createdAt || new Date().toISOString());
  return {
    id,
    label: String(raw?.label || id).trim(),
    createdAt,
    updatedAt: String(raw?.updatedAt || createdAt),
    expiresAt: expiresAt.toISOString(),
    ttlMs: Math.max(5_000, Math.min(MAX_TTL_MS, Math.floor(Number(raw?.ttlMs) || DEFAULT_TTL_MS))),
    origin: {
      sessionId,
      channel: raw?.origin?.channel === 'telegram' ? 'telegram' : 'web',
      telegramChatId: Number.isFinite(Number(raw?.origin?.telegramChatId)) ? Number(raw.origin.telegramChatId) : undefined,
      telegramUserId: Number.isFinite(Number(raw?.origin?.telegramUserId)) ? Number(raw.origin.telegramUserId) : undefined,
    },
    target: {
      type: targetType,
      config: raw?.target?.config && typeof raw.target.config === 'object' ? raw.target.config : {},
    },
    condition: raw?.condition && typeof raw.condition === 'object' ? raw.condition : {},
    onMatch: String(raw?.onMatch || '').trim(),
    onTimeout: raw?.onTimeout ? String(raw.onTimeout).trim() : undefined,
    maxFirings: Math.max(1, Math.min(10, Math.floor(Number(raw?.maxFirings) || 1))),
    firedCount: Math.max(0, Math.floor(Number(raw?.firedCount) || 0)),
    status: normalizeStatus(raw?.status),
    lastCheckedAt: raw?.lastCheckedAt ? String(raw.lastCheckedAt) : undefined,
    lastObservation: raw?.lastObservation && typeof raw.lastObservation === 'object' ? raw.lastObservation : undefined,
    matchedAt: raw?.matchedAt ? String(raw.matchedAt) : undefined,
    timedOutAt: raw?.timedOutAt ? String(raw.timedOutAt) : undefined,
    completedAt: raw?.completedAt ? String(raw.completedAt) : undefined,
    error: raw?.error ? String(raw.error) : undefined,
  };
}

function loadStore(): InternalWatchStoreData {
  const p = getWatchStorePath();
  if (!fs.existsSync(p)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const watches = Array.isArray(parsed?.watches)
      ? parsed.watches.map(normalizeWatch).filter(Boolean) as InternalWatch[]
      : [];
    return { watches, updatedAt: String(parsed?.updatedAt || new Date().toISOString()) };
  } catch {
    return defaultStore();
  }
}

function saveStore(store: InternalWatchStoreData): void {
  const dir = getWatchDir();
  fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  const p = getWatchStorePath();
  const tmp = `${p}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function createInternalWatch(input: {
  id?: string;
  label?: string;
  ttlMs?: number;
  origin: InternalWatchOrigin;
  target: InternalWatchTarget;
  condition?: InternalWatchCondition;
  onMatch: string;
  onTimeout?: string;
  maxFirings?: number;
  initialObservation?: Record<string, any>;
}): InternalWatch {
  const sessionId = String(input.origin?.sessionId || '').trim();
  const onMatch = String(input.onMatch || '').trim();
  if (!sessionId) throw new Error('origin.sessionId is required');
  if (!onMatch) throw new Error('onMatch is required');
  if (!['file', 'task', 'scheduled_job', 'event_queue'].includes(String(input.target?.type || ''))) {
    throw new Error('target.type must be file, task, scheduled_job, or event_queue');
  }

  const now = new Date();
  const ttlMs = Math.max(5_000, Math.min(MAX_TTL_MS, Math.floor(Number(input.ttlMs) || DEFAULT_TTL_MS)));
  const label = String(input.label || `${input.target.type} watch`).trim().slice(0, 120);
  const explicitId = cleanIdSegment(String(input.id || ''));
  const watch: InternalWatch = {
    id: explicitId || `watch_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    label,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ttlMs,
    origin: {
      sessionId,
      channel: input.origin.channel === 'telegram' ? 'telegram' : 'web',
      telegramChatId: input.origin.telegramChatId,
      telegramUserId: input.origin.telegramUserId,
    },
    target: {
      type: input.target.type,
      config: input.target.config || {},
    },
    condition: input.condition || {},
    onMatch,
    onTimeout: input.onTimeout ? String(input.onTimeout).trim() : undefined,
    maxFirings: Math.max(1, Math.min(10, Math.floor(Number(input.maxFirings) || 1))),
    firedCount: 0,
    status: 'active',
    lastObservation: input.initialObservation,
  };

  const store = loadStore();
  const dedupeKey = `${watch.origin.sessionId}|${watch.label}|${watch.target.type}|${JSON.stringify(watch.target.config)}|${JSON.stringify(watch.condition)}`;
  const duplicate = store.watches.find((existing) =>
    existing.status === 'active' &&
    `${existing.origin.sessionId}|${existing.label}|${existing.target.type}|${JSON.stringify(existing.target.config)}|${JSON.stringify(existing.condition)}` === dedupeKey
  );
  if (duplicate) return duplicate;

  const existingIdx = store.watches.findIndex((existing) => existing.id === watch.id);
  if (existingIdx >= 0 && store.watches[existingIdx].status === 'active') return store.watches[existingIdx];
  if (existingIdx >= 0) store.watches.splice(existingIdx, 1);
  store.watches.push(watch);
  saveStore(store);
  return watch;
}

export function listInternalWatches(filter?: { sessionId?: string; includeDone?: boolean }): InternalWatch[] {
  const sessionId = String(filter?.sessionId || '').trim();
  const includeDone = filter?.includeDone === true;
  return loadStore().watches
    .filter((watch) => !sessionId || watch.origin.sessionId === sessionId)
    .filter((watch) => includeDone || watch.status === 'active')
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

export function getActiveInternalWatches(): InternalWatch[] {
  return loadStore().watches.filter((watch) => watch.status === 'active');
}

export function updateInternalWatch(id: string, patch: Partial<InternalWatch>): InternalWatch | null {
  const watchId = String(id || '').trim();
  if (!watchId) return null;
  const store = loadStore();
  const idx = store.watches.findIndex((watch) => watch.id === watchId);
  if (idx < 0) return null;
  store.watches[idx] = {
    ...store.watches[idx],
    ...patch,
    id: store.watches[idx].id,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store.watches[idx];
}

export function cancelInternalWatch(id: string): InternalWatch | null {
  return updateInternalWatch(id, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  });
}
