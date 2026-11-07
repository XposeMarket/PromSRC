import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { getConfig } from '../../config/config';
import { listLiveRuntimes } from '../live-runtime-registry';
import { broadcastWS } from '../comms/broadcaster';

export type PlannedRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface PlannedRunItem { text: string; status: string; startedAt?: number; completedAt?: number }
export interface PlannedRunActivity { t: number; kind: 'tool' | 'result' | 'error'; name: string; detail?: string }
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
  /** User message that started the turn. Set once; optional for old records. */
  originPrompt?: string;
  /** Bounded recent tool activity ring. Optional for old records. */
  activity?: PlannedRunActivity[];
  runtimeProgress: { source: 'declared'; activeIndex: number; updatedAt: number; items: PlannedRunItem[] };
}
export const PLANNED_ACTIVITY_MAX = 40;
export const PLANNED_ORIGIN_PROMPT_MAX = 4000;
const ACTIVE_ITEM = new Set(['in_progress', 'running']);
const TERMINAL_ITEM = new Set(['completed', 'done', 'skipped', 'failed']);

/** Derive per-item timing from status transitions, preserving prior timestamps. */
export function applyPlannedItemTiming(items: { text: string; status: string }[], prior: PlannedRunItem[] | undefined, now: number): PlannedRunItem[] {
  return items.map((item, index) => {
    const before = prior?.[index] && prior[index].text === item.text ? prior[index] : undefined;
    const out: PlannedRunItem = { text: item.text, status: item.status };
    let startedAt = before?.startedAt;
    let completedAt = before?.completedAt;
    if (ACTIVE_ITEM.has(item.status)) { if (!startedAt) startedAt = now; completedAt = undefined; }
    else if (TERMINAL_ITEM.has(item.status)) { if (!completedAt) completedAt = now; if (!startedAt && before && ACTIVE_ITEM.has(before.status)) startedAt = now; }
    else completedAt = undefined;
    if (startedAt) out.startedAt = startedAt;
    if (completedAt) out.completedAt = completedAt;
    return out;
  });
}

function compactDetail(value: any): string {
  if (value == null) return '';
  let text = '';
  if (typeof value === 'string') text = value;
  else { try { text = JSON.stringify(value); } catch { text = String(value); } }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Map a chat SSE event to a compact activity entry (tool_call / tool_result only). */
export function plannedActivityFromSse(event: string, data: any, now = Date.now()): PlannedRunActivity | undefined {
  if (event !== 'tool_call' && event !== 'tool_result') return undefined;
  const name = String(data?.action || data?.tool || data?.name || data?.toolName || '').trim().slice(0, 80);
  if (!name) return undefined;
  if (event === 'tool_call') return { t: now, kind: 'tool', name, detail: compactDetail(data?.args ?? data?.input) || undefined };
  const isError = data?.error === true || data?.isError === true || data?.success === false;
  return { t: now, kind: isError ? 'error' : 'result', name, detail: compactDetail(data?.result ?? data?.output ?? data?.error) || undefined };
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
  // ── Sync read model (get/list only; never called from the chat/SSE hot path) ──
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
  // ── Async persistence. One promise chain per runtimeId serializes every read-merge-write for that run,
  // so queued activity can never overwrite newer progress/finish state.
  private chains = new Map<string, Promise<void>>();
  private known = new Set<string>();
  /** Bounded finish intent (last 200): late progress/resume/activity for these runs is a no-op even with no record. */
  private finished = new Set<string>();
  private pending = new Map<string, PlannedRunActivity[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastActivityWrite = new Map<string, number>();
  private activityFlushMs = 1500;
  setActivityFlushMs(ms: number) { this.activityFlushMs = Math.max(0, ms); }
  private enqueue(runtimeId: string, job: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(runtimeId) || Promise.resolve();
    const next: Promise<void> = prev.then(job).catch(error => { console.warn('[planned-chat] Could not persist run:', error); });
    this.chains.set(runtimeId, next);
    void next.then(() => { if (this.chains.get(runtimeId) === next) this.chains.delete(runtimeId); });
    return next;
  }
  private async readAsync(id: string): Promise<PlannedChatRun | undefined> {
    try {
      const row = JSON.parse(await fsp.readFile(this.filename(id), 'utf8'));
      if (row?.runtimeId === id && row.sourceKind === 'planned_chat' && row.sessionId && Array.isArray(row.runtimeProgress?.items)) return row;
    } catch { /* Missing/torn records cannot affect original chat execution. */ }
    return undefined;
  }
  private async writeAsync(row: PlannedChatRun) {
    await fsp.mkdir(this.directory, { recursive: true });
    const target = this.filename(row.runtimeId);
    const tmp = `${target}.${this.ownerPid}.${randomUUID()}.tmp`;
    try { await fsp.writeFile(tmp, JSON.stringify(row)); await fsp.rename(tmp, target); }
    finally { try { await fsp.unlink(tmp); } catch {} }
    // Only mutations prune history; polling is read-only. Never prune a live owner.
    await this.pruneAsync();
  }
  private async pruneAsync() {
    let names: string[];
    try { names = (await fsp.readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); } catch { return; }
    const rows: PlannedChatRun[] = [];
    for (const name of names) {
      try {
        const row = JSON.parse(await fsp.readFile(path.join(this.directory, name), 'utf8'));
        if (row?.sourceKind === 'planned_chat' && row.runtimeId) rows.push(row);
      } catch { /* skip torn */ }
    }
    const terminal = rows.filter(r => r.status !== 'running' || !this.alive(r.ownerPid)).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of terminal.slice(500)) {
      const latest = await this.readAsync(old.runtimeId);
      if (latest && (latest.status !== 'running' || !this.alive(latest.ownerPid))) {
        try { await fsp.unlink(this.filename(old.runtimeId)); } catch {}
      }
    }
  }
  private takePendingActivity(runtimeId: string) {
    const entries = this.pending.get(runtimeId) || [];
    this.pending.delete(runtimeId);
    const timer = this.timers.get(runtimeId);
    if (timer) { clearTimeout(timer); this.timers.delete(runtimeId); }
    return entries;
  }
  private markFinished(runtimeId: string) {
    this.finished.add(runtimeId);
    if (this.finished.size > 200) this.finished.delete(this.finished.values().next().value as string);
  }
  private normalizeProgress(payload: any): { text: string; status: string }[] | undefined {
    if (payload?.source !== 'declared' || !Array.isArray(payload.items) || payload.items.length < 2 || payload.items.length > 6) return undefined;
    const items = payload.items.map((item: any) => ({ text: String(item?.text || '').trim().slice(0, 500), status: ['pending', 'in_progress', 'completed', 'done', 'skipped', 'failed'].includes(item?.status) ? item.status : 'pending' }));
    return items.some((item: any) => !item.text) ? undefined : items;
  }
  progress(runtimeId: string, sessionId: string, payload: any, fallbackTitle: string, resumedFromRuntimeId?: string, originPrompt?: string, carry?: Pick<PlannedChatRun, 'originPrompt' | 'activity'> & { items?: PlannedRunItem[] }): Promise<void> {
    // Late calls for a finished run are rejected synchronously; calls queued before finish still land.
    if (this.finished.has(runtimeId)) return Promise.resolve();
    const items = this.normalizeProgress(payload);
    if (!items) return Promise.resolve();
    return this.enqueue(runtimeId, () => this.writeProgress(runtimeId, sessionId, payload, items, fallbackTitle, resumedFromRuntimeId, originPrompt, carry));
  }
  /** Read-merge-write for one progress update. Must run inside runtimeId's chain; never enqueues itself. */
  private async writeProgress(runtimeId: string, sessionId: string, payload: any, items: { text: string; status: string }[], fallbackTitle: string, resumedFromRuntimeId?: string, originPrompt?: string, carry?: Pick<PlannedChatRun, 'originPrompt' | 'activity'> & { items?: PlannedRunItem[] }) {
    const prior = await this.readAsync(runtimeId);
    if (prior && (prior.status !== 'running' || prior.ownerPid !== this.ownerPid)) return;
    const now = Date.now();
    // originPrompt is set exactly once: prior record wins, then carried (resume), then the new turn message.
    const origin = prior?.originPrompt || carry?.originPrompt || String(originPrompt || '').trim().slice(0, PLANNED_ORIGIN_PROMPT_MAX) || undefined;
    const pendingActivity = this.takePendingActivity(runtimeId);
    const activity = [...(prior?.activity || carry?.activity || []), ...pendingActivity].slice(-PLANNED_ACTIVITY_MAX);
    await this.writeAsync({
      id: `chat-plan:${runtimeId}`, sourceKind: 'planned_chat', runtimeId, ownerPid: this.ownerPid, sessionId,
      title: String(payload.taskSummary || prior?.title || fallbackTitle || 'Planned chat').slice(0, 240),
      status: 'running', createdAt: prior?.createdAt || now, updatedAt: now,
      ...((resumedFromRuntimeId || prior?.resumedFromRuntimeId) ? { resumedFromRuntimeId: resumedFromRuntimeId || prior?.resumedFromRuntimeId } : {}),
      ...(origin ? { originPrompt: origin } : {}),
      ...(activity.length ? { activity } : {}),
      runtimeProgress: { source: 'declared', activeIndex: Math.max(-1, Math.min(items.length, Number(payload.activeIndex) || 0)), updatedAt: now, items: applyPlannedItemTiming(items, prior?.runtimeProgress?.items || carry?.items, now) },
    });
    this.lastActivityWrite.set(runtimeId, now);
    // Only an accepted write re-enters bookkeeping; a run finished meanwhile stays closed.
    if (!this.finished.has(runtimeId)) this.known.add(runtimeId);
  }
  /** Reserves destination ordering synchronously: the source read runs inside runtimeId's chain, so a finish() called meanwhile lands after this write. */
  resume(priorRuntimeId: string, runtimeId: string, sessionId: string): Promise<void> {
    if (this.finished.has(runtimeId)) return Promise.resolve();
    return this.enqueue(runtimeId, async () => {
      const prior = await this.readAsync(priorRuntimeId);
      if (!prior) return;
      const payload = { ...prior.runtimeProgress, taskSummary: prior.title };
      const items = this.normalizeProgress(payload);
      if (!items) return;
      await this.writeProgress(runtimeId, sessionId, payload, items, prior.title, priorRuntimeId, undefined, { originPrompt: prior.originPrompt, activity: prior.activity, items: prior.runtimeProgress.items });
    });
  }

  /** SSE hook: bounded in-memory enqueue only (ring capped at PLANNED_ACTIVITY_MAX). Never touches the filesystem. */
  activity(runtimeId: string, entry: PlannedRunActivity): void {
    if (!this.known.has(runtimeId)) return;
    const buffer = this.pending.get(runtimeId) || [];
    buffer.push(entry);
    this.pending.set(runtimeId, buffer.slice(-PLANNED_ACTIVITY_MAX));
    if (this.timers.has(runtimeId)) return;
    const wait = Math.max(0, this.activityFlushMs - (Date.now() - (this.lastActivityWrite.get(runtimeId) || 0)));
    const timer = setTimeout(() => { this.timers.delete(runtimeId); void this.flushActivity(runtimeId); }, wait);
    (timer as any).unref?.();
    this.timers.set(runtimeId, timer);
  }
  flushActivity(runtimeId: string): Promise<void> {
    if (!this.pending.get(runtimeId)?.length) return this.chains.get(runtimeId) || Promise.resolve();
    return this.enqueue(runtimeId, async () => {
      const entries = this.takePendingActivity(runtimeId);
      if (!entries.length) return;
      const row = await this.readAsync(runtimeId);
      if (!row || row.status !== 'running' || row.ownerPid !== this.ownerPid) return;
      row.activity = [...(row.activity || []), ...entries].slice(-PLANNED_ACTIVITY_MAX);
      row.updatedAt = Date.now();
      this.lastActivityWrite.set(runtimeId, row.updatedAt);
      await this.writeAsync(row);
    });
  }
  finish(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>): Promise<void> {
    this.known.delete(runtimeId); this.lastActivityWrite.delete(runtimeId); this.markFinished(runtimeId);
    return this.enqueue(runtimeId, async () => {
      // Drain queued activity as part of the terminal write, in the same serialized chain.
      const entries = this.takePendingActivity(runtimeId);
      const row = await this.readAsync(runtimeId);
      if (!row || row.status !== 'running' || row.ownerPid !== this.ownerPid) return;
      if (entries.length) row.activity = [...(row.activity || []), ...entries].slice(-PLANNED_ACTIVITY_MAX);
      row.status = status;
      row.completedAt = row.updatedAt = Date.now();
      if (status === 'completed') {
        row.runtimeProgress.items = row.runtimeProgress.items.map(item => (item.status === 'in_progress' || item.status === 'running') ? { ...item, completedAt: item.completedAt || row.completedAt } : item);
      }
      await this.writeAsync(row);
    });
  }
  get(runtimeId: string) { return this.read(runtimeId); }
  list(liveRuntimeIds: Set<string>, pending: PendingRequest[] = []) {
    const rows = this.rows().sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    const newestRunning = new Map<string, string>();
    const effective = (row: PlannedChatRun): PlannedRunStatus => row.status === 'running'
      && (row.ownerPid === this.ownerPid ? !liveRuntimeIds.has(row.runtimeId) : !this.alive(row.ownerPid)) ? 'interrupted' : row.status;
    for (const row of rows) if (effective(row) === 'running' && !newestRunning.has(row.sessionId)) newestRunning.set(row.sessionId, row.runtimeId);
    return rows.map(row => {
      const { activity, originPrompt, ...rest } = row;
      const last = Array.isArray(activity) && activity.length ? activity[activity.length - 1] : undefined;
      return {
        ...rest,
        status: effective(row) === 'running' && newestRunning.get(row.sessionId) === row.runtimeId && pending.some(item => item.sessionId === row.sessionId && (typeof item.createdAt === 'number' ? item.createdAt : Date.parse(String(item.createdAt || ''))) >= row.createdAt) ? 'awaiting_user_input' : effective(row),
        source: 'Chat', channel: 'Chat', startedAt: row.createdAt, lastProgressAt: row.updatedAt,
        currentStepIndex: row.runtimeProgress.activeIndex, supportedActions: ['open_chat'],
        // Compact list fields; full originPrompt/activity come from the detail route.
        ...(originPrompt ? { originalAssignment: String(originPrompt).slice(0, 280) } : {}),
        ...(last ? { lastToolCall: { name: last.name, kind: last.kind, t: last.t } } : {}),
        activityCount: Array.isArray(activity) ? activity.length : 0,
      };
    });
  }
}



let cached: { directory: string; store: PlannedChatRunStore } | undefined;
function store() {
  const directory = path.join(getConfig().getConfigDir(), 'planned-chat-runs');
  if (cached?.directory !== directory) cached = { directory, store: new PlannedChatRunStore(directory) };
  return cached.store;
}
export function recordPlannedChatProgress(runtimeId: string, sessionId: string, payload: any, title: string, resumedFromRuntimeId?: string, originPrompt?: string) {
  try {
    // Serialized async write; broadcast only after it lands.
    void store().progress(runtimeId, sessionId, payload, title, resumedFromRuntimeId, originPrompt).then(() => {
      if (payload?.source === 'declared') broadcastWS({ type: 'planned_chat_updated', runtimeId, sessionId });
    }).catch(error => console.warn('[planned-chat] Could not save progress:', error));
  } catch (error) { console.warn('[planned-chat] Could not save progress:', error); }
}
/** Feed chat SSE events into the planned-run activity ring. Never throws, never blocks on IO for unplanned chats. */
export function recordPlannedChatActivity(runtimeId: string, event: string, data: any) {
  if (event !== 'tool_call' && event !== 'tool_result') return;
  try {
    const entry = plannedActivityFromSse(event, data);
    if (entry) store().activity(runtimeId, entry);
  } catch (error) { console.warn('[planned-chat] Could not record activity:', error); }
}
export function resumePlannedChatRun(priorRuntimeId: string, runtimeId: string, sessionId: string) {
  try { void store().resume(priorRuntimeId, runtimeId, sessionId).catch(error => console.warn('[planned-chat] Could not link recovery:', error)); }
  catch (error) { console.warn('[planned-chat] Could not link recovery:', error); }
}
export function finishPlannedChatRun(runtimeId: string, status: Exclude<PlannedRunStatus, 'running'>) {
  try { void store().finish(runtimeId, status).then(() => broadcastWS({ type: 'planned_chat_updated', runtimeId })).catch(error => console.warn('[planned-chat] Could not save outcome:', error)); }
  catch (error) { console.warn('[planned-chat] Could not save outcome:', error); }
}
export function listPlannedChatRuns(pending: PendingRequest[] = []) {
  return store().list(new Set(listLiveRuntimes().filter(r => r.kind === 'main_chat').map(r => r.id)), pending);
}
/** Full planned run (origin prompt + activity) for the task detail view. id may be `chat-plan:<runtimeId>`. */
export function getPlannedChatRunDetail(id: string, pending: PendingRequest[] = []) {
  const runtimeId = String(id || '').replace(/^chat-plan:/, '');
  if (!runtimeId) return undefined;
  const row = store().get(runtimeId);
  if (!row) return undefined;
  const listed = listPlannedChatRuns(pending).find(item => item.runtimeId === runtimeId);
  return { ...(listed || {}), ...row, status: listed?.status || row.status, originalAssignment: row.originPrompt, activity: row.activity || [] };
}

