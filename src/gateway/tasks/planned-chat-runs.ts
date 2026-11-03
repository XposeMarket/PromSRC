import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { getConfig } from '../../config/config';
import { listLiveRuntimes } from '../live-runtime-registry';
import { broadcastWS } from '../comms/broadcaster';

export type PlannedRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface PlannedChatRun {
  id: string;
  sourceKind: 'planned_chat';
  runtimeId: string;
  ownerPid: number;
  sessionId: string;
  title: string;
  status: PlannedRunStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  resumedFromRuntimeId?: string;
  runtimeProgress: { source: 'declared'; activeIndex: number; updatedAt: number; items: { text: string; status: string }[] };
}
type PendingRequest = { sessionId?: string; createdAt?: number | string };
function processAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error?.code === 'EPERM'; }
}

/** Passive read model. Each runtime's original process owns exactly one atomic file.
 * A draining gateway cannot overwrite another process's records or cached outcomes. */
export class PlannedChatRunStore {
  constructor(private directory: string, private ownerPid = process.pid, private alive = processAlive) {}
  private filename(id: string) { return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`); }
  private read(id: string): PlannedChatRun | undefined {
    try {
      const row = JSON.parse(fs.readFileSync(this.filename(id), 'utf8'));
      if (row?.runtimeId === id && row.sourceKind === 'planned_chat' && row.sessionId && Array.isArray(row.runtimeProgress?.items)) return row;
    } catch { /* Missing/torn records cannot affect original chat execution. */ }
  }
  private rows(): PlannedChatRun[] {
    try {
      return fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
        try {
          const row = JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8'));
          return row?.sourceKind === 'planned_chat' && row.runtimeId && row.sessionId && Array.isArray(row.runtimeProgress?.items) ? [row] : [];
        } catch { return []; }
      });
    } catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  }
  private write(row: PlannedChatRun) {
    fs.mkdirSync(this.directory, { recursive: true });
    const target = this.filename(row.runtimeId);
    const tmp = `${target}.${this.ownerPid}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(row)); fs.renameSync(tmp, target); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    // Only mutations prune history; polling is read-only. Never prune a live owner.
    const terminal = this.rows().filter(r => r.status !== 'running' || !this.alive(r.ownerPid)).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of terminal.slice(500)) {
      const latest = this.read(old.runtimeId);
      if (latest && (latest.status !== 'running' || !this.alive(latest.ownerPid))) {
        try { fs.unlinkSync(this.filename(old.runtimeId)); } catch {}
      }
    }
  }
  progress(runtimeId: string, sessionId: string, payload: any, fallbackTitle: string, resumedFromRuntimeId?: string) {
    if (payload?.source !== 'declared' || !Array.isArray(payload.items) || payload.items.length < 2 || payload.items.length > 6) return;
    const items = payload.items.map((item: any) => ({ text: String(item?.text || '').trim().slice(0, 500), status: ['pending', 'in_progress', 'completed', 'done', 'skipped', 'failed'].includes(item?.status) ? item.status : 'pending' }));
    if (items.some((item: any) => !item.text)) return;
    const prior = this.read(runtimeId);
    if (prior && (prior.status !== 'running' || prior.ownerPid !== this.ownerPid)) return;
    const now = Date.now();
    this.write({
      id: `chat-plan:${runtimeId}`, sourceKind: 'planned_chat', runtimeId, ownerPid: this.ownerPid, sessionId,
      title: String(payload.taskSummary || prior?.title || fallbackTitle || 'Planned chat').slice(0, 240),
      status: 'running', createdAt: prior?.createdAt || now, updatedAt: now,
      ...((resumedFromRuntimeId || prior?.resumedFromRuntimeId) ? { resumedFromRuntimeId: resumedFromRuntimeId || prior?.resumedFromRuntimeId } : {}),
      runtimeProgress: { source: 'declared', activeIndex: Math.max(-1, Math.min(items.length, Number(payload.activeIndex) || 0)), updatedAt: now, items },
    });
  }
  resume(priorRuntimeId: string, runtimeId: string, sessionId: string) {
    const prior = this.read(priorRuntimeId);
    if (prior) this.progress(runtimeId, sessionId, { ...prior.runtimeProgress, taskSummary: prior.title }, prior.title, priorRuntimeId);
  }
  finish(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>) {
    const row = this.read(runtimeId);
    if (!row || row.status !== 'running' || row.ownerPid !== this.ownerPid) return;
    row.status = status;
    row.completedAt = row.updatedAt = Date.now();
    this.write(row);
  }
  list(liveRuntimeIds: Set<string>, pending: PendingRequest[] = []) {
    const rows = this.rows().sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    const newestRunning = new Map<string, string>();
    const effective = (row: PlannedChatRun): PlannedRunStatus => row.status === 'running'
      && (row.ownerPid === this.ownerPid ? !liveRuntimeIds.has(row.runtimeId) : !this.alive(row.ownerPid)) ? 'interrupted' : row.status;
    for (const row of rows) if (effective(row) === 'running' && !newestRunning.has(row.sessionId)) newestRunning.set(row.sessionId, row.runtimeId);
    return rows.map(row => ({
      ...row,
      status: effective(row) === 'running' && newestRunning.get(row.sessionId) === row.runtimeId && pending.some(item => item.sessionId === row.sessionId && (typeof item.createdAt === 'number' ? item.createdAt : Date.parse(String(item.createdAt || ''))) >= row.createdAt) ? 'awaiting_user_input' : effective(row),
      source: 'Chat', channel: 'Chat', startedAt: row.createdAt, lastProgressAt: row.updatedAt,
      currentStepIndex: row.runtimeProgress.activeIndex, supportedActions: ['open_chat'],
    }));
  }
}

let cached: { directory: string; store: PlannedChatRunStore } | undefined;
function store() {
  const directory = path.join(getConfig().getConfigDir(), 'planned-chat-runs');
  if (cached?.directory !== directory) cached = { directory, store: new PlannedChatRunStore(directory) };
  return cached.store;
}
export function recordPlannedChatProgress(runtimeId: string, sessionId: string, payload: any, title: string, resumedFromRuntimeId?: string) {
  try {
    store().progress(runtimeId, sessionId, payload, title, resumedFromRuntimeId);
    if (payload?.source === 'declared') broadcastWS({ type: 'planned_chat_updated', runtimeId, sessionId });
  } catch (error) { console.warn('[planned-chat] Could not save progress:', error); }
}
export function resumePlannedChatRun(priorRuntimeId: string, runtimeId: string, sessionId: string) {
  try { store().resume(priorRuntimeId, runtimeId, sessionId); }
  catch (error) { console.warn('[planned-chat] Could not link recovery:', error); }
}
export function finishPlannedChatRun(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>) {
  try { store().finish(runtimeId, status); broadcastWS({ type: 'planned_chat_updated', runtimeId }); }
  catch (error) { console.warn('[planned-chat] Could not save outcome:', error); }
}
export function listPlannedChatRuns(pending: PendingRequest[] = []) {
  return store().list(new Set(listLiveRuntimes().filter(r => r.kind === 'main_chat').map(r => r.id)), pending);
}
