import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { listLiveRuntimes } from '../live-runtime-registry';
import { broadcastWS } from '../comms/broadcaster';


export type PlannedRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface PlannedChatRun {
  id: string;
  sourceKind: 'planned_chat';
  runtimeId: string;
  sessionId: string;
  title: string;
  status: PlannedRunStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  resumedFromRuntimeId?: string;
  runtimeProgress: { source: 'declared'; activeIndex: number; updatedAt: number; items: { text: string; status: string }[] };
}

/** Passive read model only. Never enqueue these records in BackgroundTaskRunner. */
export class PlannedChatRunStore {
  private records = new Map<string, PlannedChatRun>();
  constructor(private filename: string) {
    try {
      const rows = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.sourceKind === 'planned_chat' && row.runtimeId && row.sessionId && Array.isArray(row.runtimeProgress?.items)) this.records.set(row.runtimeId, row);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') console.warn('[planned-chat] Could not load run history:', error?.message);
    }
  }
  private save() {
    const terminal = [...this.records.values()].filter(r => r.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt);
    for (const row of terminal.slice(500)) this.records.delete(row.runtimeId);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const tmp = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.records.values()]));
    fs.renameSync(tmp, this.filename);
  }
  progress(runtimeId: string, sessionId: string, payload: any, fallbackTitle: string, resumedFromRuntimeId?: string) {
    if (payload?.source !== 'declared' || !Array.isArray(payload.items) || payload.items.length < 2 || payload.items.length > 6) return;
    const items = payload.items.map((item: any) => ({ text: String(item?.text || '').trim().slice(0, 500), status: ['pending', 'in_progress', 'completed', 'done', 'skipped', 'failed'].includes(item?.status) ? item.status : 'pending' }));
    if (items.some((item: any) => !item.text)) return;
    const prior = this.records.get(runtimeId);
    if (prior && prior.status !== 'running') return;
    const now = Date.now();
    this.records.set(runtimeId, {
      id: `chat-plan:${runtimeId}`, sourceKind: 'planned_chat', runtimeId, sessionId,
      title: String(payload.taskSummary || prior?.title || fallbackTitle || 'Planned chat').slice(0, 240),
      status: 'running', createdAt: prior?.createdAt || now, updatedAt: now,
      ...(resumedFromRuntimeId ? { resumedFromRuntimeId } : {}),
      runtimeProgress: { source: 'declared', activeIndex: Math.max(-1, Math.min(items.length, Number(payload.activeIndex) || 0)), updatedAt: now, items },
    });
    this.save();
  }
  resume(priorRuntimeId: string, runtimeId: string, sessionId: string) {
    const prior = this.records.get(priorRuntimeId);
    if (!prior) return;
    this.finish(priorRuntimeId, 'interrupted');
    this.progress(runtimeId, sessionId, { ...prior.runtimeProgress, taskSummary: prior.title }, prior.title, priorRuntimeId);
  }
  finish(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>) {
    const row = this.records.get(runtimeId);
    if (!row || row.status !== 'running') return;
    row.status = status;
    row.completedAt = row.updatedAt = Date.now();
    this.save();
  }
  list(liveRuntimeIds: Set<string>, pending: { sessionId?: string; createdAt?: number | string }[] = []) {
    // A missing owner is interruption, never success. This also reconciles a cold restart.
    for (const row of this.records.values()) if (row.status === 'running' && !liveRuntimeIds.has(row.runtimeId)) this.finish(row.runtimeId, 'interrupted');
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt).map(row => ({
      ...row,
      status: row.status === 'running' && pending.some(item => item.sessionId === row.sessionId && (typeof item.createdAt === 'number' ? item.createdAt : Date.parse(String(item.createdAt || ''))) >= row.createdAt - 1000) ? 'awaiting_user_input' : row.status,
      source: 'Chat', channel: 'Chat', startedAt: row.createdAt, lastProgressAt: row.updatedAt,
      currentStepIndex: row.runtimeProgress.activeIndex, supportedActions: ['open_chat'],
    }));
  }
}

let cached: { filename: string; store: PlannedChatRunStore } | undefined;
function store() {
  const filename = path.join(getConfig().getConfigDir(), 'planned-chat-runs.json');
  if (cached?.filename !== filename) cached = { filename, store: new PlannedChatRunStore(filename) };
  return cached.store;
}
export function recordPlannedChatProgress(runtimeId: string, sessionId: string, payload: any, title: string, resumedFromRuntimeId?: string) {
  try {
    store().progress(runtimeId, sessionId, payload, title, resumedFromRuntimeId);
    if (payload?.source === 'declared') broadcastWS({ type: 'planned_chat_updated', runtimeId, sessionId });
  }
  catch (error) { console.warn('[planned-chat] Could not save progress:', error); }
}
export function resumePlannedChatRun(priorRuntimeId: string, runtimeId: string, sessionId: string) {
  try { store().resume(priorRuntimeId, runtimeId, sessionId); }
  catch (error) { console.warn('[planned-chat] Could not link recovery:', error); }
}
export function finishPlannedChatRun(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>) {
  try { store().finish(runtimeId, status); broadcastWS({ type: 'planned_chat_updated', runtimeId }); }
  catch (error) { console.warn('[planned-chat] Could not save outcome:', error); }
}
export function listPlannedChatRuns(pending: { sessionId?: string; createdAt?: number | string }[] = []) {
  return store().list(new Set(listLiveRuntimes().filter(r => r.kind === 'main_chat').map(r => r.id)), pending);
}
