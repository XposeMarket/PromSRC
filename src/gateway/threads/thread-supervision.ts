import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { addMessage, flushSession, getSession, getSessionDisplayTitle, type MainChatGoalStatus } from '../session';

export type ThreadSupervisionStatus = 'active' | 'complete' | 'blocked' | 'failed' | 'cancelled';

export interface ThreadSupervision {
  id: string;
  ownerSessionId: string;
  targetSessionId: string;
  targetTitle: string;
  objective: string;
  status: ThreadSupervisionStatus;
  createdAt: number;
  updatedAt: number;
  lastObservedAt?: number;
  lastGoalStatus?: MainChatGoalStatus;
  finalSummary?: string;
  notifiedAt?: number;
}

interface ThreadSupervisionStore {
  version: 1;
  updatedAt: number;
  records: ThreadSupervision[];
}

function storePath(): string {
  return path.join(getConfig().getConfigDir(), 'thread-supervisions.json');
}

function normalizeRecord(input: any): ThreadSupervision | null {
  const id = String(input?.id || '').trim();
  const ownerSessionId = String(input?.ownerSessionId || '').trim();
  const targetSessionId = String(input?.targetSessionId || '').trim();
  if (!id || !ownerSessionId || !targetSessionId) return null;
  const validStatuses = new Set<ThreadSupervisionStatus>(['active', 'complete', 'blocked', 'failed', 'cancelled']);
  const status = validStatuses.has(input?.status) ? input.status as ThreadSupervisionStatus : 'active';
  const createdAt = Number(input?.createdAt) || Date.now();
  return {
    id,
    ownerSessionId,
    targetSessionId,
    targetTitle: String(input?.targetTitle || targetSessionId).trim().slice(0, 100) || targetSessionId,
    objective: String(input?.objective || '').trim().slice(0, 12_000),
    status,
    createdAt,
    updatedAt: Number(input?.updatedAt) || createdAt,
    lastObservedAt: Number(input?.lastObservedAt) || undefined,
    lastGoalStatus: input?.lastGoalStatus,
    finalSummary: typeof input?.finalSummary === 'string' ? input.finalSummary.slice(0, 8000) : undefined,
    notifiedAt: Number(input?.notifiedAt) || undefined,
  };
}

function readStore(): ThreadSupervisionStore {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) return { version: 1, updatedAt: Date.now(), records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      version: 1,
      updatedAt: Number(parsed?.updatedAt) || Date.now(),
      records: (Array.isArray(parsed?.records) ? parsed.records : [])
        .map(normalizeRecord)
        .filter((record: ThreadSupervision | null): record is ThreadSupervision => !!record),
    };
  } catch {
    return { version: 1, updatedAt: Date.now(), records: [] };
  }
}

function writeStore(store: ThreadSupervisionStore): void {
  const filePath = storePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  store.updatedAt = Date.now();
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function listThreadSupervisions(options: {
  ownerSessionId?: string;
  targetSessionId?: string;
  status?: ThreadSupervisionStatus;
  includeTerminal?: boolean;
  limit?: number;
} = {}): ThreadSupervision[] {
  const ownerSessionId = String(options.ownerSessionId || '').trim();
  const targetSessionId = String(options.targetSessionId || '').trim();
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  return readStore().records
    .filter((record) => !ownerSessionId || record.ownerSessionId === ownerSessionId)
    .filter((record) => !targetSessionId || record.targetSessionId === targetSessionId)
    .filter((record) => !options.status || record.status === options.status)
    .filter((record) => options.includeTerminal !== false || record.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function getThreadSupervision(id: string): ThreadSupervision | null {
  const clean = String(id || '').trim();
  return readStore().records.find((record) => record.id === clean) || null;
}

export function createThreadSupervision(input: {
  ownerSessionId: string;
  targetSessionId: string;
  targetTitle?: string;
  objective: string;
}): ThreadSupervision {
  const ownerSessionId = String(input.ownerSessionId || '').trim();
  const targetSessionId = String(input.targetSessionId || '').trim();
  if (!ownerSessionId || !targetSessionId) throw new Error('Owner and target session ids are required.');
  if (ownerSessionId === targetSessionId) throw new Error('A session cannot supervise itself.');
  const store = readStore();
  const existing = store.records.find((record) => (
    record.ownerSessionId === ownerSessionId
    && record.targetSessionId === targetSessionId
    && record.status === 'active'
  ));
  if (existing) return existing;
  const now = Date.now();
  const record: ThreadSupervision = {
    id: `thread_follow_${crypto.randomUUID()}`,
    ownerSessionId,
    targetSessionId,
    targetTitle: String(input.targetTitle || targetSessionId).trim().slice(0, 100) || targetSessionId,
    objective: String(input.objective || '').trim().slice(0, 12_000),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  store.records.push(record);
  writeStore(store);
  return record;
}

export function updateThreadSupervision(
  id: string,
  patch: Partial<Omit<ThreadSupervision, 'id' | 'ownerSessionId' | 'targetSessionId' | 'createdAt'>>,
): ThreadSupervision | null {
  const store = readStore();
  const index = store.records.findIndex((record) => record.id === String(id || '').trim());
  if (index < 0) return null;
  store.records[index] = {
    ...store.records[index],
    ...patch,
    id: store.records[index].id,
    ownerSessionId: store.records[index].ownerSessionId,
    targetSessionId: store.records[index].targetSessionId,
    createdAt: store.records[index].createdAt,
    updatedAt: Date.now(),
  };
  writeStore(store);
  return store.records[index];
}

export function cancelThreadSupervision(id: string): ThreadSupervision | null {
  return updateThreadSupervision(id, { status: 'cancelled' });
}

function terminalStatus(goalStatus: MainChatGoalStatus): ThreadSupervisionStatus | null {
  if (goalStatus === 'done') return 'complete';
  if (goalStatus === 'blocked') return 'blocked';
  if (goalStatus === 'failed') return 'failed';
  if (goalStatus === 'cleared') return 'cancelled';
  return null;
}

function summarizeTarget(record: ThreadSupervision): string {
  const session = getSession(record.targetSessionId);
  const goal = session.mainChatGoal;
  const latestAssistant = [...(session.history || [])].reverse().find((message) => message.role === 'assistant');
  return String(
    goal?.progressSummary
    || goal?.lastReason
    || goal?.blockedReason
    || goal?.failureReason
    || latestAssistant?.content
    || `Thread ${record.targetTitle} reached ${goal?.status || record.status}.`,
  ).trim().slice(0, 8000);
}

export function refreshThreadSupervisions(broadcast?: (data: any) => void): ThreadSupervision[] {
  const store = readStore();
  let changed = false;
  const notifications: ThreadSupervision[] = [];
  for (const record of store.records) {
    if (record.status !== 'active') {
      if (!record.notifiedAt && ['complete', 'blocked', 'failed'].includes(record.status)) notifications.push(record);
      continue;
    }
    try {
      const target = getSession(record.targetSessionId);
      record.targetTitle = getSessionDisplayTitle(target) || record.targetTitle;
      record.lastObservedAt = Date.now();
      record.lastGoalStatus = target.mainChatGoal?.status;
      const nextStatus = target.mainChatGoal?.status ? terminalStatus(target.mainChatGoal.status) : null;
      if (nextStatus) {
        record.status = nextStatus;
        record.finalSummary = summarizeTarget(record);
        notifications.push(record);
      }
      record.updatedAt = Date.now();
      changed = true;
    } catch (err: any) {
      record.status = 'failed';
      record.finalSummary = `Could not inspect target thread: ${String(err?.message || err)}`;
      record.updatedAt = Date.now();
      notifications.push(record);
      changed = true;
    }
  }
  if (changed) writeStore(store);

  for (const record of notifications) {
    if (record.notifiedAt) continue;
    const heading = record.status === 'complete'
      ? 'completed'
      : record.status === 'blocked'
        ? 'is blocked'
        : record.status === 'cancelled'
          ? 'was cancelled'
          : 'failed';
    try {
      addMessage(record.ownerSessionId, {
        role: 'assistant',
        content: `[Managed thread ${heading}: ${record.targetTitle}]\n${record.finalSummary || ''}`.trim(),
        timestamp: Date.now(),
        messageKind: 'managed_thread_event',
        channel: 'system',
        channelLabel: 'managed thread',
        origin: {
          channel: 'system',
          surface: 'automation',
          device: 'server',
          source: 'peer_session_supervision',
          chatId: record.targetSessionId,
          label: record.targetTitle,
        },
        richArtifacts: [{
          id: `thread-links:supervision:${record.id}:${record.status}`,
          type: 'thread_links',
          title: `Managed thread ${heading}`,
          createdAt: new Date().toISOString(),
          items: [{
            sessionId: record.targetSessionId,
            title: record.targetTitle,
            label: `Thread ${heading}`,
            subtitle: record.finalSummary ? String(record.finalSummary).replace(/\s+/g, ' ').slice(0, 140) : 'Open the Prometheus thread',
            status: record.status,
          }],
        }],
      }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      flushSession(record.ownerSessionId);
      record.notifiedAt = Date.now();
      record.updatedAt = Date.now();
      updateThreadSupervision(record.id, { notifiedAt: record.notifiedAt });
    } catch {}
    try {
      broadcast?.({
        type: 'managed_thread_update',
        ownerSessionId: record.ownerSessionId,
        targetSessionId: record.targetSessionId,
        supervision: record,
      });
    } catch {}
  }
  return store.records;
}

let runnerTimer: ReturnType<typeof setInterval> | null = null;

export function startThreadSupervisionRunner(broadcast?: (data: any) => void): () => void {
  if (runnerTimer) return () => undefined;
  const tick = () => {
    try { refreshThreadSupervisions(broadcast); } catch (err: any) {
      console.warn('[thread-supervision] refresh failed:', err?.message || err);
    }
  };
  tick();
  runnerTimer = setInterval(tick, 5000);
  runnerTimer.unref?.();
  return () => {
    if (runnerTimer) clearInterval(runnerTimer);
    runnerTimer = null;
  };
}
