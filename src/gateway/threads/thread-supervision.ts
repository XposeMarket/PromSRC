import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { addMessage, flushSession, getSession, getSessionDisplayTitle, type MainChatGoalStatus } from '../session';
import type { LiveRuntimeSnapshot } from '../live-runtime-registry';

export type ThreadSupervisionStatus = 'active' | 'paused' | 'complete' | 'blocked' | 'failed' | 'cancelled';

export type ThreadSupervisionVerificationState =
  | 'pending'
  | 'verified'
  | 'escalated'
  | 'budget_exhausted'
  | 'failed';

export interface ThreadSupervisionMessageSummary {
  identity: string;
  index: number;
  role: 'user' | 'assistant';
  timestamp: number;
  messageKind?: string;
  excerpt: string;
  reasoningSummary?: string;
  toolLog?: string;
  processEntries?: any[];
  liveTraceEntries?: any[];
  fileChanges?: any;
  artifacts?: Array<{ kind: string; label: string }>;
}

export interface ThreadSupervisionPendingEvent {
  id: string;
  types: string[];
  firstObservedAt: number;
  lastObservedAt: number;
  fromMessageCount: number;
  toMessageCount: number;
  observedMessageIdentity?: string;
  observedMessageHash: string;
  runtimeState: 'running' | 'idle';
  goalStatus?: MainChatGoalStatus;
  messages: ThreadSupervisionMessageSummary[];
  /** Recent target transcript, not just the newly-triggering assistant turns. */
  recentMessages?: ThreadSupervisionMessageSummary[];
  /** Live worker checkpoint while the target is still running or just went idle. */
  runtimeCheckpoint?: Record<string, any>;
  /** Durable target Goal state at observation time. */
  targetGoal?: Record<string, any>;
  /** Compact target-side reasoning/tool findings retained for the supervisor. */
  reasoningSummary?: string;
  toolLog?: string;
  processEntries?: any[];
  liveTraceEntries?: any[];
  changedFiles: string[];
  artifacts: Array<{ kind: string; label: string }>;
}

export const DEFAULT_THREAD_SUPERVISION_BUDGETS = Object.freeze({
  maxReviews: 12,
  maxFollowUps: 6,
  maxElapsedMs: 24 * 60 * 60 * 1000,
  minReviewIntervalMs: 15_000,
  maxConsecutiveNoProgress: 3,
});

export interface ThreadSupervision {
  id: string;
  ownerSessionId: string;
  targetSessionId: string;
  targetTitle: string;
  objective: string;
  /** Explicit acceptance contract retained across review turns and restarts. */
  acceptanceCriteria: string;
  /**
   * Durable identity for one logical manager workflow. Production reviews run
   * in a hidden detached supervisor runtime and continue this checkpoint
   * without reopening the owner chat/voice turn.
   */
  supervisionRunId: string;
  objectiveRevision: number;
  status: ThreadSupervisionStatus;
  createdAt: number;
  updatedAt: number;
  lastObservedAt?: number;
  lastGoalStatus?: MainChatGoalStatus;
  lastObservedRuntimeState?: 'running' | 'idle';
  lastObservedMessageCount: number;
  lastObservedMessageIdentity?: string;
  lastObservedMessageHash?: string;
  lastObservationFingerprint?: string;
  lastReviewedMessageCount: number;
  lastReviewedMessageHash?: string;
  lastReviewedEventId?: string;
  lastEventId?: string;
  lastReviewAt?: number;
  lastReviewReason?: string;
  lastDecision?: 'wait' | 'continue' | 'verified_complete' | 'needs_user' | 'failed';
  lastDecisionAt?: number;
  lastDecisionEventId?: string;
  lastDecisionEvidence?: string[];
  lastDecisionProgressMade?: boolean;
  reviewCount: number;
  followUpCount: number;
  lastFollowUpFingerprint?: string;
  lastFollowUpAt?: number;
  consecutiveNoProgressCount: number;
  maxReviews: number;
  maxFollowUps: number;
  maxElapsedMs: number;
  minReviewIntervalMs: number;
  maxConsecutiveNoProgress: number;
  pendingReview: boolean;
  /** Surface currently responsible for the owner-side review turn. */
  reviewDeliverySurface?: 'voice' | 'chat' | 'supervisor';
  /** Hidden session used by the persistent supervisory runtime. */
  supervisorSessionId?: string;
  pendingEvent?: ThreadSupervisionPendingEvent;
  reviewInFlight?: boolean;
  leasedEventId?: string;
  leasedEvent?: ThreadSupervisionPendingEvent;
  finalVerificationState: ThreadSupervisionVerificationState;
  finalVerificationReason?: string;
  finalSummary?: string;
  lastStatusSummary?: string;
  lastStatusEventAt?: number;
  restartCheckpoint?: {
    recoveredAt: number;
    leasedEventId?: string;
    reviewCount: number;
    followUpCount: number;
  };
  notifiedAt?: number;
}

interface ThreadSupervisionStore {
  version: 1;
  updatedAt: number;
  records: ThreadSupervision[];
}

type ThreadSupervisionWaiter = {
  ownerSessionId: string;
  afterEventId?: string;
  resolve: (value: { ready: boolean; timedOut?: boolean; supervision: ThreadSupervision | null }) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const threadSupervisionWaiters = new Map<string, Set<ThreadSupervisionWaiter>>();

function pendingIdleEvent(record: ThreadSupervision | null, afterEventId = ''): boolean {
  return !!(
    record
    && record.status === 'active'
    && record.pendingReview
    && record.pendingEvent
    && record.pendingEvent.runtimeState === 'idle'
    && record.pendingEvent.id !== String(afterEventId || '').trim()
  );
}

/**
 * Wait inside the persistent supervisor runtime until the target produces an
 * idle/material event. This is deliberately not a chat turn or a user-facing
 * notification; it is the blocking checkpoint between two supervisor tool
 * passes.
 */
export function waitForThreadSupervisionUpdate(input: {
  ownerSessionId: string;
  supervisionId: string;
  afterEventId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ ready: boolean; timedOut?: boolean; supervision: ThreadSupervision | null }> {
  const supervisionId = String(input.supervisionId || '').trim();
  const ownerSessionId = String(input.ownerSessionId || '').trim();
  const afterEventId = String(input.afterEventId || '').trim();
  const current = getThreadSupervision(supervisionId);
  if (!current || current.ownerSessionId !== ownerSessionId) {
    return Promise.resolve({ ready: false, supervision: null });
  }
  if (pendingIdleEvent(current, afterEventId) || current.status !== 'active') {
    return Promise.resolve({ ready: true, supervision: current });
  }

  const timeoutMs = Math.max(1_000, Math.min(30 * 60_000, Math.floor(Number(input.timeoutMs) || 10 * 60_000)));
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: { ready: boolean; timedOut?: boolean; supervision: ThreadSupervision | null }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const waiter: ThreadSupervisionWaiter = {
      ownerSessionId,
      afterEventId,
      resolve: settle,
      timer: setTimeout(() => {
        const bucket = threadSupervisionWaiters.get(supervisionId);
        bucket?.delete(waiter);
        if (bucket && bucket.size === 0) threadSupervisionWaiters.delete(supervisionId);
        if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
        settle({ ready: false, timedOut: true, supervision: getThreadSupervision(supervisionId) });
      }, timeoutMs),
      signal: input.signal,
    };
    if (input.signal) {
      waiter.onAbort = () => {
        const bucket = threadSupervisionWaiters.get(supervisionId);
        bucket?.delete(waiter);
        if (bucket && bucket.size === 0) threadSupervisionWaiters.delete(supervisionId);
        clearTimeout(waiter.timer);
        settle({ ready: false, timedOut: false, supervision: getThreadSupervision(supervisionId) });
      };
      if (input.signal.aborted) {
        waiter.onAbort();
        return;
      }
      input.signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    const bucket = threadSupervisionWaiters.get(supervisionId) || new Set<ThreadSupervisionWaiter>();
    bucket.add(waiter);
    threadSupervisionWaiters.set(supervisionId, bucket);
  });
}

/** Wake hidden supervisor loops after a material idle observation is persisted. */
export function signalThreadSupervisionUpdate(record: ThreadSupervision): void {
  const bucket = threadSupervisionWaiters.get(record.id);
  if (!bucket?.size) return;
  for (const waiter of [...bucket]) {
    const shouldWake = record.ownerSessionId === waiter.ownerSessionId
      && (record.status !== 'active' || pendingIdleEvent(record, waiter.afterEventId));
    if (!shouldWake) continue;
    bucket.delete(waiter);
    clearTimeout(waiter.timer);
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve({ ready: true, supervision: record });
  }
  if (bucket.size === 0) threadSupervisionWaiters.delete(record.id);
}

function storePath(): string {
  return path.join(getConfig().getConfigDir(), 'thread-supervisions.json');
}

function normalizeRecord(input: any): ThreadSupervision | null {
  const id = String(input?.id || '').trim();
  const ownerSessionId = String(input?.ownerSessionId || '').trim();
  const targetSessionId = String(input?.targetSessionId || '').trim();
  if (!id || !ownerSessionId || !targetSessionId) return null;
  const validStatuses = new Set<ThreadSupervisionStatus>(['active', 'paused', 'complete', 'blocked', 'failed', 'cancelled']);
  const status = validStatuses.has(input?.status) ? input.status as ThreadSupervisionStatus : 'active';
  const createdAt = Number(input?.createdAt) || Date.now();
  const positiveInt = (value: any, fallback: number, max: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  };
  const verificationStates = new Set<ThreadSupervisionVerificationState>(['pending', 'verified', 'escalated', 'budget_exhausted', 'failed']);
  return {
    id,
    ownerSessionId,
    targetSessionId,
    targetTitle: String(input?.targetTitle || targetSessionId).trim().slice(0, 100) || targetSessionId,
    objective: String(input?.objective || '').trim().slice(0, 12_000),
    acceptanceCriteria: String(input?.acceptanceCriteria || input?.objective || '').trim().slice(0, 12_000),
    supervisionRunId: String(input?.supervisionRunId || id).trim().slice(0, 160) || id,
    objectiveRevision: Math.max(1, Math.floor(Number(input?.objectiveRevision) || 1)),
    status,
    createdAt,
    updatedAt: Number(input?.updatedAt) || createdAt,
    lastObservedAt: Number(input?.lastObservedAt) || undefined,
    lastGoalStatus: input?.lastGoalStatus,
    lastObservedRuntimeState: input?.lastObservedRuntimeState === 'running' ? 'running' : input?.lastObservedRuntimeState === 'idle' ? 'idle' : undefined,
    lastObservedMessageCount: Math.max(0, Math.floor(Number(input?.lastObservedMessageCount) || 0)),
    lastObservedMessageIdentity: typeof input?.lastObservedMessageIdentity === 'string' ? input.lastObservedMessageIdentity : undefined,
    lastObservedMessageHash: typeof input?.lastObservedMessageHash === 'string' ? input.lastObservedMessageHash : undefined,
    lastObservationFingerprint: typeof input?.lastObservationFingerprint === 'string' ? input.lastObservationFingerprint.slice(0, 256) : undefined,
    lastReviewedMessageCount: Math.max(0, Math.floor(Number(input?.lastReviewedMessageCount) || 0)),
    lastReviewedMessageHash: typeof input?.lastReviewedMessageHash === 'string' ? input.lastReviewedMessageHash : undefined,
    lastReviewedEventId: typeof input?.lastReviewedEventId === 'string' ? input.lastReviewedEventId : undefined,
    lastEventId: typeof input?.lastEventId === 'string' ? input.lastEventId : undefined,
    lastReviewAt: Number(input?.lastReviewAt) || undefined,
    lastReviewReason: typeof input?.lastReviewReason === 'string' ? input.lastReviewReason.slice(0, 2000) : undefined,
    lastDecision: ['wait', 'continue', 'verified_complete', 'needs_user', 'failed'].includes(String(input?.lastDecision || ''))
      ? input.lastDecision
      : undefined,
    lastDecisionAt: Number(input?.lastDecisionAt) || undefined,
    lastDecisionEventId: typeof input?.lastDecisionEventId === 'string' ? input.lastDecisionEventId : undefined,
    lastDecisionEvidence: Array.isArray(input?.lastDecisionEvidence)
      ? input.lastDecisionEvidence.map((item: any) => String(item || '').slice(0, 500)).filter(Boolean).slice(0, 12)
      : undefined,
    lastDecisionProgressMade: typeof input?.lastDecisionProgressMade === 'boolean' ? input.lastDecisionProgressMade : undefined,
    reviewCount: Math.max(0, Math.floor(Number(input?.reviewCount) || 0)),
    followUpCount: Math.max(0, Math.floor(Number(input?.followUpCount) || 0)),
    lastFollowUpFingerprint: typeof input?.lastFollowUpFingerprint === 'string' ? input.lastFollowUpFingerprint.slice(0, 256) : undefined,
    lastFollowUpAt: Number(input?.lastFollowUpAt) || undefined,
    consecutiveNoProgressCount: Math.max(0, Math.floor(Number(input?.consecutiveNoProgressCount) || 0)),
    maxReviews: positiveInt(input?.maxReviews, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxReviews, 100),
    maxFollowUps: positiveInt(input?.maxFollowUps, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxFollowUps, 50),
    maxElapsedMs: positiveInt(input?.maxElapsedMs, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxElapsedMs, 7 * 24 * 60 * 60 * 1000),
    minReviewIntervalMs: positiveInt(input?.minReviewIntervalMs, DEFAULT_THREAD_SUPERVISION_BUDGETS.minReviewIntervalMs, 60 * 60 * 1000),
    maxConsecutiveNoProgress: positiveInt(input?.maxConsecutiveNoProgress, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxConsecutiveNoProgress, 20),
    pendingReview: input?.pendingReview === true,
    reviewDeliverySurface: input?.reviewDeliverySurface === 'voice'
      ? 'voice'
      : input?.reviewDeliverySurface === 'supervisor'
        ? 'supervisor'
        : input?.reviewDeliverySurface === 'chat'
          ? 'chat'
          : undefined,
    supervisorSessionId: typeof input?.supervisorSessionId === 'string' ? input.supervisorSessionId.slice(0, 220) : undefined,
    pendingEvent: input?.pendingEvent && typeof input.pendingEvent === 'object' ? input.pendingEvent : undefined,
    reviewInFlight: input?.reviewInFlight === true,
    leasedEventId: typeof input?.leasedEventId === 'string' ? input.leasedEventId : undefined,
    leasedEvent: input?.leasedEvent && typeof input.leasedEvent === 'object' ? input.leasedEvent : undefined,
    finalVerificationState: verificationStates.has(input?.finalVerificationState)
      ? input.finalVerificationState as ThreadSupervisionVerificationState
      : status === 'complete'
        ? 'verified'
        : status === 'blocked'
          ? 'escalated'
          : status === 'failed'
            ? 'failed'
            : 'pending',
    finalVerificationReason: typeof input?.finalVerificationReason === 'string' ? input.finalVerificationReason.slice(0, 8000) : undefined,
    finalSummary: typeof input?.finalSummary === 'string' ? input.finalSummary.slice(0, 8000) : undefined,
    lastStatusSummary: typeof input?.lastStatusSummary === 'string' ? input.lastStatusSummary.slice(0, 2000) : undefined,
    lastStatusEventAt: Number(input?.lastStatusEventAt) || undefined,
    restartCheckpoint: input?.restartCheckpoint && typeof input.restartCheckpoint === 'object' ? {
      recoveredAt: Number(input.restartCheckpoint.recoveredAt) || createdAt,
      leasedEventId: typeof input.restartCheckpoint.leasedEventId === 'string' ? input.restartCheckpoint.leasedEventId.slice(0, 200) : undefined,
      reviewCount: Math.max(0, Math.floor(Number(input.restartCheckpoint.reviewCount) || 0)),
      followUpCount: Math.max(0, Math.floor(Number(input.restartCheckpoint.followUpCount) || 0)),
    } : undefined,
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
  acceptanceCriteria?: string;
  maxReviews?: number;
  maxFollowUps?: number;
  maxElapsedMs?: number;
  minReviewIntervalMs?: number;
  maxConsecutiveNoProgress?: number;
}): ThreadSupervision {
  const ownerSessionId = String(input.ownerSessionId || '').trim();
  const targetSessionId = String(input.targetSessionId || '').trim();
  if (!ownerSessionId || !targetSessionId) throw new Error('Owner and target session ids are required.');
  if (ownerSessionId === targetSessionId) throw new Error('A session cannot supervise itself.');
  const store = readStore();
  const activeForTarget = store.records.find((record) => record.targetSessionId === targetSessionId && record.status === 'active');
  if (activeForTarget) {
    if (activeForTarget.ownerSessionId === ownerSessionId) return activeForTarget;
    throw new Error(`Target thread is already supervised by ${activeForTarget.ownerSessionId}.`);
  }
  const edges = store.records.filter((record) => record.status === 'active');
  const queue = [targetSessionId];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === ownerSessionId) throw new Error('Supervision would create an owner/target cycle.');
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.ownerSessionId === current) queue.push(edge.targetSessionId);
    }
  }
  const now = Date.now();
  const target = getSession(targetSessionId);
  const history = Array.isArray(target.history) ? target.history : [];
  const latest = history[history.length - 1];
  const latestIdentity = latest
    ? String(latest.messageId || `${latest.role}:${Number(latest.timestamp) || 0}:${crypto.createHash('sha256').update(String(latest.content || '')).digest('hex').slice(0, 16)}`)
    : undefined;
  const positiveInt = (value: any, fallback: number, max: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  };
  const record: ThreadSupervision = {
    id: `thread_follow_${crypto.randomUUID()}`,
    ownerSessionId,
    targetSessionId,
    targetTitle: String(input.targetTitle || targetSessionId).trim().slice(0, 100) || targetSessionId,
    objective: String(input.objective || '').trim().slice(0, 12_000),
    acceptanceCriteria: String(input.acceptanceCriteria || input.objective || '').trim().slice(0, 12_000),
    supervisionRunId: `supervision-run_${crypto.randomUUID()}`,
    objectiveRevision: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastObservedMessageCount: history.length,
    lastObservedMessageIdentity: latestIdentity,
    lastObservedMessageHash: latest ? crypto.createHash('sha256').update(`${history.length}:${latestIdentity}`).digest('hex') : undefined,
    lastObservationFingerprint: latest ? crypto.createHash('sha256').update(`${history.length}:${latestIdentity}`).digest('hex') : undefined,
    lastReviewedMessageCount: history.length,
    lastReviewedMessageHash: latest ? crypto.createHash('sha256').update(`${history.length}:${latestIdentity}`).digest('hex') : undefined,
    reviewCount: 0,
    followUpCount: 0,
    consecutiveNoProgressCount: 0,
    maxReviews: positiveInt(input.maxReviews, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxReviews, 100),
    maxFollowUps: positiveInt(input.maxFollowUps, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxFollowUps, 50),
    maxElapsedMs: positiveInt(input.maxElapsedMs, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxElapsedMs, 7 * 24 * 60 * 60 * 1000),
    minReviewIntervalMs: positiveInt(input.minReviewIntervalMs, DEFAULT_THREAD_SUPERVISION_BUDGETS.minReviewIntervalMs, 60 * 60 * 1000),
    maxConsecutiveNoProgress: positiveInt(input.maxConsecutiveNoProgress, DEFAULT_THREAD_SUPERVISION_BUDGETS.maxConsecutiveNoProgress, 20),
    pendingReview: false,
    reviewInFlight: false,
    finalVerificationState: 'pending',
  };
  store.records.push(record);
  writeStore(store);
  return record;
}

/** Claim the next idle event from inside an already-running supervisor loop. */
export function leaseThreadSupervisionReview(input: {
  ownerSessionId: string;
  supervisionId: string;
  eventId?: string;
  now?: number;
  broadcast?: (data: any) => void;
}): ThreadSupervision | null {
  const supervisionId = String(input.supervisionId || '').trim();
  const ownerSessionId = String(input.ownerSessionId || '').trim();
  const current = getThreadSupervision(supervisionId);
  if (!current || current.ownerSessionId !== ownerSessionId || current.status !== 'active') return null;
  if (current.reviewInFlight && current.leasedEvent) return current;
  const event = current.pendingEvent;
  if (!current.pendingReview || !event || event.runtimeState === 'running') return null;
  const requestedEventId = String(input.eventId || '').trim();
  if (requestedEventId && requestedEventId !== event.id) return null;
  const now = Number(input.now) || Date.now();
  if (now - current.createdAt >= current.maxElapsedMs) {
    const blocked = updateThreadSupervision(current.id, {
      status: 'blocked',
      pendingReview: false,
      reviewInFlight: false,
      finalVerificationState: 'budget_exhausted',
      finalVerificationReason: `Active supervision reached its elapsed-time limit (${current.maxElapsedMs}ms).`,
      finalSummary: `Active supervision reached its elapsed-time limit (${current.maxElapsedMs}ms).`,
      lastStatusSummary: `Active supervision reached its elapsed-time limit (${current.maxElapsedMs}ms).`,
      lastStatusEventAt: now,
    });
    if (blocked) notifyThreadSupervision(blocked, input.broadcast);
    return null;
  }
  if (current.reviewCount >= current.maxReviews) {
    const blocked = updateThreadSupervision(current.id, {
      status: 'blocked',
      pendingReview: false,
      reviewInFlight: false,
      finalVerificationState: 'budget_exhausted',
      finalVerificationReason: `Active supervision reached its review limit (${current.reviewCount}/${current.maxReviews}).`,
      finalSummary: `Active supervision reached its review limit (${current.reviewCount}/${current.maxReviews}).`,
      lastStatusSummary: `Active supervision reached its review limit (${current.reviewCount}/${current.maxReviews}).`,
      lastStatusEventAt: now,
    });
    if (blocked) notifyThreadSupervision(blocked, input.broadcast);
    return null;
  }
  if (current.consecutiveNoProgressCount >= current.maxConsecutiveNoProgress) {
    const blocked = updateThreadSupervision(current.id, {
      status: 'blocked',
      pendingReview: false,
      reviewInFlight: false,
      finalVerificationState: 'budget_exhausted',
      finalVerificationReason: `Active supervision stopped after ${current.consecutiveNoProgressCount} consecutive no-progress reviews.`,
      finalSummary: `Active supervision stopped after ${current.consecutiveNoProgressCount} consecutive no-progress reviews.`,
      lastStatusSummary: `Active supervision stopped after ${current.consecutiveNoProgressCount} consecutive no-progress reviews.`,
      lastStatusEventAt: now,
    });
    if (blocked) notifyThreadSupervision(blocked, input.broadcast);
    return null;
  }
  if (current.lastReviewAt && now - current.lastReviewAt < current.minReviewIntervalMs) return null;
  return updateThreadSupervision(current.id, {
    reviewInFlight: true,
    reviewCount: current.reviewCount + 1,
    leasedEventId: event.id,
    leasedEvent: event,
    pendingReview: false,
    pendingEvent: undefined,
    lastReviewAt: now,
    reviewDeliverySurface: current.reviewDeliverySurface || 'supervisor',
    lastReviewReason: `Reviewing ${event.types.join(', ')}.`
      .slice(0, 2000),
    lastStatusSummary: `Reviewing target event: ${event.types.join(', ')}.`
      .slice(0, 2000),
    lastStatusEventAt: now,
  });
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
  signalThreadSupervisionUpdate(store.records[index]);
  return store.records[index];
}

export function cancelThreadSupervision(id: string): ThreadSupervision | null {
  return updateThreadSupervision(id, { status: 'cancelled' });
}

export function updateThreadSupervisionsBatch(
  updates: Array<{ id: string; patch: Partial<Omit<ThreadSupervision, 'id' | 'ownerSessionId' | 'targetSessionId' | 'createdAt'>> }>,
): ThreadSupervision[] {
  if (!updates.length) return [];
  const store = readStore();
  const byId = new Map(updates.map((update) => [String(update.id || '').trim(), update.patch]));
  const changed: ThreadSupervision[] = [];
  for (let index = 0; index < store.records.length; index += 1) {
    const current = store.records[index];
    const patch = byId.get(current.id);
    if (!patch) continue;
    store.records[index] = {
      ...current,
      ...patch,
      id: current.id,
      ownerSessionId: current.ownerSessionId,
      targetSessionId: current.targetSessionId,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    changed.push(store.records[index]);
  }
  if (changed.length) writeStore(store);
  for (const record of changed) signalThreadSupervisionUpdate(record);
  return changed;
}

function mergePersistedEvents(older?: ThreadSupervisionPendingEvent, newer?: ThreadSupervisionPendingEvent): ThreadSupervisionPendingEvent | undefined {
  if (!older) return newer;
  if (!newer) return older;
  return {
    ...older,
    ...newer,
    id: `supervision-event:${crypto.createHash('sha256').update(`${older.id}:${newer.id}:recovery`).digest('hex').slice(0, 24)}`,
    types: Array.from(new Set([...older.types, ...newer.types])).sort(),
    firstObservedAt: Math.min(older.firstObservedAt, newer.firstObservedAt),
    fromMessageCount: Math.min(older.fromMessageCount, newer.fromMessageCount),
    messages: Array.from(new Map([...older.messages, ...newer.messages].map((item) => [item.identity, item])).values()).slice(-16),
    changedFiles: Array.from(new Set([...older.changedFiles, ...newer.changedFiles])).slice(0, 40),
    artifacts: Array.from(new Map([...older.artifacts, ...newer.artifacts].map((item) => [`${item.kind}:${item.label}`, item])).values()).slice(0, 40),
  };
}

export function recoverThreadSupervisionReviewLeases(): ThreadSupervision[] {
  const inFlight = listThreadSupervisions({ status: 'active', includeTerminal: false, limit: 500 })
    .filter((record) => record.reviewInFlight && record.leasedEvent);
  return updateThreadSupervisionsBatch(inFlight.map((record) => ({
    id: record.id,
    patch: {
      reviewInFlight: false,
      leasedEventId: undefined,
      leasedEvent: undefined,
      pendingReview: true,
      pendingEvent: mergePersistedEvents(record.leasedEvent, record.pendingEvent),
      lastReviewReason: 'Recovered an interrupted active-supervision review lease after restart.',
      restartCheckpoint: {
        recoveredAt: Date.now(),
        leasedEventId: record.leasedEventId,
        reviewCount: record.reviewCount,
        followUpCount: record.followUpCount,
      },
    },
  })));
}

export function getActiveThreadSupervisionForTarget(targetSessionId: string): ThreadSupervision | null {
  return listThreadSupervisions({ targetSessionId, status: 'active', includeTerminal: false, limit: 2 })[0] || null;
}

export function assertThreadSupervisionFollowUpAllowed(input: {
  ownerSessionId: string;
  targetSessionId: string;
  supervisionId?: string;
  broadcast?: (data: any) => void;
}): ThreadSupervision | null {
  const active = getActiveThreadSupervisionForTarget(String(input.targetSessionId || '').trim());
  if (!active) return null;
  const ownerSessionId = String(input.ownerSessionId || '').trim();
  const supervisionId = String(input.supervisionId || '').trim();
  if (active.ownerSessionId !== ownerSessionId) throw new Error('Target is supervised by another owner session.');
  if (!supervisionId) throw new Error('supervision_id is required for send/steer while this target is actively supervised.');
  if (active.id !== supervisionId) throw new Error('supervision_id does not match the active target supervision.');
  if (active.followUpCount >= active.maxFollowUps) {
    const exhausted = updateThreadSupervision(active.id, {
      status: 'blocked',
      pendingReview: false,
      reviewInFlight: false,
      finalVerificationState: 'budget_exhausted',
      finalVerificationReason: `Follow-up budget exhausted (${active.followUpCount}/${active.maxFollowUps}).`,
      finalSummary: `Active supervision stopped after reaching its ${active.maxFollowUps} follow-up limit.`,
    });
    if (exhausted) notifyThreadSupervision(exhausted, input.broadcast);
    throw new Error(`Supervision follow-up budget exhausted (${active.followUpCount}/${active.maxFollowUps}).`);
  }
  return active;
}

export function isThreadSupervisionFollowUpDuplicate(supervisionId: string, fingerprint: string): boolean {
  const record = getThreadSupervision(supervisionId);
  return !!record && record.status === 'active' && !!fingerprint && record.lastFollowUpFingerprint === fingerprint;
}

export function commitThreadSupervisionFollowUp(supervisionId: string, fingerprint?: string): ThreadSupervision | null {
  const record = getThreadSupervision(supervisionId);
  if (!record || record.status !== 'active') return record;
  if (fingerprint && record.lastFollowUpFingerprint === fingerprint) return record;
  return updateThreadSupervision(record.id, {
    followUpCount: record.followUpCount + 1,
    lastFollowUpFingerprint: fingerprint ? String(fingerprint).slice(0, 256) : record.lastFollowUpFingerprint,
    lastFollowUpAt: Date.now(),
  });
}

/** Update the current manager contract without replacing the managed thread. */
export function reviseThreadSupervision(input: {
  ownerSessionId: string;
  supervisionId: string;
  objective?: string;
  acceptanceCriteria?: string;
}): ThreadSupervision {
  const record = getThreadSupervision(input.supervisionId);
  if (!record) throw new Error('Supervision not found.');
  if (record.ownerSessionId !== String(input.ownerSessionId || '').trim()) throw new Error('Only the owner session may revise this supervision.');
  if (!['active', 'paused'].includes(record.status)) throw new Error(`Supervision is already ${record.status}.`);
  const objective = String(input.objective || record.objective).trim().slice(0, 12_000);
  const acceptanceCriteria = String(input.acceptanceCriteria || objective || record.acceptanceCriteria).trim().slice(0, 12_000);
  if (!objective) throw new Error('objective is required.');
  const next = updateThreadSupervision(record.id, {
    objective,
    acceptanceCriteria,
    objectiveRevision: record.objectiveRevision + 1,
    consecutiveNoProgressCount: 0,
    lastStatusSummary: 'Supervisor objective updated; the existing managed thread remains the target.',
    lastStatusEventAt: Date.now(),
  });
  if (!next) throw new Error('Could not update supervision.');
  return next;
}

export function pauseThreadSupervision(id: string, reason = 'Paused by supervising user.'): ThreadSupervision | null {
  return updateThreadSupervision(id, {
    status: 'paused', pendingReview: false, reviewInFlight: false,
    lastStatusSummary: String(reason).slice(0, 2000), lastStatusEventAt: Date.now(),
  });
}

export function resumeThreadSupervision(id: string, ownerSessionId: string): ThreadSupervision {
  const record = getThreadSupervision(id);
  if (!record) throw new Error('Supervision not found.');
  if (record.ownerSessionId !== String(ownerSessionId || '').trim()) throw new Error('Only the owner session may resume this supervision.');
  if (record.status !== 'paused') throw new Error(`Supervision is ${record.status}, not paused.`);
  const next = updateThreadSupervision(record.id, {
    status: 'active',
    lastStatusSummary: 'Supervision resumed in the same owner session and workflow.',
    lastStatusEventAt: Date.now(),
  });
  if (!next) throw new Error('Could not resume supervision.');
  return next;
}

export function resolveThreadSupervisionReview(input: {
  ownerSessionId: string;
  supervisionId: string;
  reviewEventId: string;
  decision: 'wait' | 'continue' | 'verified_complete' | 'needs_user' | 'failed';
  progressMade: boolean;
  reason: string;
  evidence?: string[];
  broadcast?: (data: any) => void;
}): ThreadSupervision {
  const record = getThreadSupervision(input.supervisionId);
  if (!record) throw new Error('Supervision not found.');
  if (record.ownerSessionId !== String(input.ownerSessionId || '').trim()) {
    throw new Error('Only the owner session may resolve this supervision review.');
  }
  const eventId = String(input.reviewEventId || '').trim();
  const decision = String(input.decision || '').trim() as ThreadSupervision['lastDecision'];
  const reason = String(input.reason || '').trim().slice(0, 8000);
  const evidence = (Array.isArray(input.evidence) ? input.evidence : [])
    .map((item) => String(item || '').trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 12);
  if (!eventId || !decision || !['wait', 'continue', 'verified_complete', 'needs_user', 'failed'].includes(decision)) {
    throw new Error('review_event_id and a valid decision are required.');
  }
  if (!reason) throw new Error('A review decision reason is required.');
  if (typeof input.progressMade !== 'boolean') throw new Error('progress_made must be explicitly true or false.');
  if (record.lastDecisionEventId === eventId && record.lastDecision === decision) return record;
  if (record.status !== 'active') throw new Error(`Supervision is already ${record.status}.`);
  if (!record.leasedEvent || record.leasedEventId !== eventId || !record.reviewInFlight) {
    throw new Error('Review decision does not match the active in-flight supervision event.');
  }
  if (decision === 'verified_complete' && evidence.length === 0) {
    throw new Error('verified_complete requires bounded implementation or verification evidence.');
  }
  if (input.progressMade === true && evidence.length === 0) {
    throw new Error('progress_made=true requires bounded evidence.');
  }
  const terminal = decision === 'verified_complete' || decision === 'needs_user' || decision === 'failed';
  // Observation continues while the hidden supervisor is reviewing. Reload
  // before committing so a target event that arrived during this model pass is
  // not lost by writing a stale pre-review record over it.
  const latest = getThreadSupervision(record.id) || record;
  if (latest.status !== 'active') throw new Error(`Supervision is already ${latest.status}.`);
  if (!latest.leasedEvent || latest.leasedEventId !== eventId || !latest.reviewInFlight) {
    throw new Error('Review decision does not match the active in-flight supervision event.');
  }
  const newerPendingEvent = latest.pendingEvent && latest.pendingEvent.id !== eventId
    ? latest.pendingEvent
    : undefined;
  const next = updateThreadSupervision(latest.id, {
    status: decision === 'verified_complete' ? 'complete' : decision === 'needs_user' ? 'blocked' : decision === 'failed' ? 'failed' : 'active',
    pendingReview: terminal ? false : !!newerPendingEvent || latest.pendingReview,
    pendingEvent: terminal ? undefined : newerPendingEvent,
    reviewInFlight: false,
    leasedEventId: undefined,
    leasedEvent: undefined,
    lastReviewedEventId: eventId,
    lastReviewedMessageCount: latest.leasedEvent.toMessageCount,
    lastReviewedMessageHash: latest.leasedEvent.observedMessageHash,
    lastReviewAt: Date.now(),
    lastReviewReason: reason,
    lastDecision: decision,
    lastDecisionAt: Date.now(),
    lastDecisionEventId: eventId,
    lastDecisionEvidence: evidence,
    lastDecisionProgressMade: input.progressMade === true,
    consecutiveNoProgressCount: input.progressMade === true ? 0 : latest.consecutiveNoProgressCount + 1,
    finalVerificationState: decision === 'verified_complete'
      ? 'verified'
      : decision === 'needs_user'
        ? 'escalated'
        : decision === 'failed'
          ? 'failed'
          : 'pending',
    finalVerificationReason: terminal ? reason : undefined,
    finalSummary: terminal ? [reason, ...evidence].filter(Boolean).join('\n') : latest.finalSummary,
  });
  if (!next) throw new Error('Could not persist supervision decision.');
  if (terminal) notifyThreadSupervision(next, input.broadcast);
  return next;
}

export function notifyThreadSupervision(record: ThreadSupervision, broadcast?: (data: any) => void): void {
  if (record.notifiedAt || !['complete', 'blocked', 'failed'].includes(record.status)) return;
  const heading = record.status === 'complete' ? 'completed' : record.status === 'blocked' ? 'needs attention' : 'failed';
  const summary = String(record.finalSummary || record.finalVerificationReason || '').replace(/\s+/g, ' ').trim();
  try {
    addMessage(record.ownerSessionId, {
      role: 'assistant',
      content: `[Managed thread ${heading}: ${record.targetTitle}]\n${record.finalSummary || record.finalVerificationReason || ''}`.trim(),
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
          subtitle: String(record.finalSummary || record.finalVerificationReason || 'Open the Prometheus thread').replace(/\s+/g, ' ').slice(0, 140),
          status: record.status,
        }],
      }],
    }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    flushSession(record.ownerSessionId);
    updateThreadSupervision(record.id, { notifiedAt: Date.now() });
  } catch {}
  try {
    broadcast?.({
      type: 'managed_thread_update',
      ownerSessionId: record.ownerSessionId,
      targetSessionId: record.targetSessionId,
      supervision: getThreadSupervision(record.id) || record,
    });
    // A supervision review is executed by the durable owner-side chat runtime.
    // Mirror its terminal result as a voice update on that same owner session;
    // the active AVAS client will append it to its current voice thread instead
    // of routing it to the target thread's Worker.
    // A Voice-delivered review is already speaking from AVAS itself. Only
    // synthesize a worker-update narration for legacy/non-Voice completion
    // paths; otherwise the user hears the terminal result twice.
    if (record.reviewDeliverySurface !== 'voice') {
      broadcast?.({
        type: 'voice_worker_update',
        id: `thread_supervision_${record.id}_${record.status}_${Date.now()}`,
        sessionId: record.ownerSessionId,
        taskId: record.targetSessionId,
        title: record.targetTitle,
        kind: record.status === 'complete' ? 'complete' : 'paused',
        critical: true,
        status: record.status,
        text: summary
          ? `${record.targetTitle} ${heading}. ${summary}`
          : `${record.targetTitle} ${heading}.`,
        finalResult: summary,
        timestamp: Date.now(),
      });
    }
  } catch {}
}
