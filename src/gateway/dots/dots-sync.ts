/**
 * Keeps each OpenAI dot's single conversation mirrored into ONE Prometheus chat
 * (`dot_<room>`). A dot is a contact, not a chat factory: there is no "new chat"
 * with a dot, so the chat is created here, never from the new-chat picker.
 *
 * - First sync imports the recent history and leaves the chat read.
 * - Later syncs append anything new (messages the dot posts on its own, or the
 *   user sends from ChatGPT) and leave the chat unread, so it surfaces in
 *   Priority mode and the mobile inbox like any Prometheus chat.
 * - Rooms with a turn in flight are skipped; the turn records its own messages.
 * Seen message ids live in <configDir>/dots/state.json.
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/config';
import { broadcastWS } from '../comms/broadcaster';
import {
  addMessage,
  flushSession,
  getSession,
  getSessionExternalAgent,
  markSessionReadForMobile,
  renameSession,
  setSessionExternalAgent,
} from '../session';
import { getExternalAgentEntry, updateExternalAgentEntry } from '../external-agents/store';
import { DotsApiError, listDots, listRoomMessages, type DotInfo, type DotMessage } from './dots-api';

export const DOTS_AGENT_ID = 'openai-dots' as const;
const MAX_SEEN = 400;
const FIRST_SYNC_LIMIT = 20;
const SYNC_LIMIT = 32; // ChatGPT's maximum page size
const DOTS_CACHE_MS = 5 * 60_000;
const POLL_MS = 45_000;

/** A send whose answer never came back. The same token is used again so a retry can't post twice. */
export interface UncertainSend { token: string; textHash: string; at: number }
/**
 * floorAt = time of the oldest message imported on the first sync. History older than that is
 * never appended; everything newer is matched by id, so nothing in between can be skipped.
 * lastAt is the older, moving boundary and is only read to upgrade rooms saved before floorAt.
 * sent = idempotency tokens of messages sent from Prometheus (never mirrored back as ChatGPT messages).
 */
interface RoomState { sessionId: string; seen: string[]; syncedAt?: number; lastAt?: number; floorAt?: number; sent?: string[]; uncertain?: UncertainSend }
interface DotsState { version: 1; rooms: Record<string, RoomState> }

function statePath(): string {
  return path.join(getConfig().getConfigDir(), 'dots', 'state.json');
}

function readState(): DotsState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (raw && typeof raw === 'object' && raw.rooms && typeof raw.rooms === 'object') return { version: 1, rooms: raw.rooms };
  } catch { /* first run */ }
  return { version: 1, rooms: {} };
}

function writeState(state: DotsState): void {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function dotSessionId(roomId: string): string {
  return `dot_${String(roomId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64)}`;
}

export function isDotSessionId(sessionId: string): boolean {
  return /^dot_[A-Za-z0-9]+$/.test(String(sessionId || ''));
}

/** Record message ids as already mirrored (the turn adapter calls this for its own sends/replies). */
export function rememberSeen(roomId: string, ids: string[], options: { synced?: boolean; lastAt?: number; floorAt?: number } = {}): void {
  const clean = ids.map((id) => String(id || '').trim()).filter(Boolean);
  const state = readState();
  const room = state.rooms[roomId] || { sessionId: dotSessionId(roomId), seen: [] };
  const seen = new Set(room.seen);
  for (const id of clean) seen.add(id);
  room.seen = [...seen].slice(-MAX_SEEN);
  if (options.synced) room.syncedAt = Date.now();
  if (Number(options.lastAt) > 0) room.lastAt = Math.max(Number(room.lastAt || 0), Number(options.lastAt));
  // Set once and never moved.
  if (options.floorAt !== undefined && room.floorAt === undefined) room.floorAt = Number(options.floorAt) || 0;
  state.rooms[roomId] = room;
  writeState(state);
}

/** Record the token of a message sent from Prometheus, before it goes out. */
export function rememberSent(roomId: string, token: string): void {
  const state = readState();
  const room = state.rooms[roomId] || { sessionId: dotSessionId(roomId), seen: [] };
  room.sent = [...new Set([...(room.sent || []), token])].slice(-50);
  state.rooms[roomId] = room;
  writeState(state);
}

export function getUncertainSend(roomId: string): UncertainSend | null {
  return readState().rooms[roomId]?.uncertain || null;
}

export function setUncertainSend(roomId: string, value: UncertainSend | null): void {
  const state = readState();
  const room = state.rooms[roomId] || { sessionId: dotSessionId(roomId), seen: [] };
  if (value) room.uncertain = value; else delete room.uncertain;
  state.rooms[roomId] = room;
  writeState(state);
}

const busyRooms = new Set<string>();
const syncingRooms = new Set<string>();
export function setDotRoomBusy(roomId: string, busy: boolean): void {
  if (busy) busyRooms.add(roomId); else busyRooms.delete(roomId);
}

export function dotsEnabled(): boolean {
  const entry = getExternalAgentEntry(DOTS_AGENT_ID);
  return entry.enabled === true && entry.lastStatus === 'ready';
}

let dotsCache: { at: number; dots: DotInfo[] } | null = null;
export async function getDots(fresh = false, signal?: AbortSignal): Promise<DotInfo[]> {
  if (!fresh && dotsCache && Date.now() - dotsCache.at < DOTS_CACHE_MS) return dotsCache.dots;
  const dots = await listDots(signal);
  dotsCache = { at: Date.now(), dots };
  return dots;
}

/** Chat title for a dot: its own name, capitalized ("dot" -> "Dot"); "Dot" when unnamed. */
export function dotTitle(name: string): string {
  const clean = String(name || '').trim();
  if (!clean || /^your dot$/i.test(clean)) return 'Dot';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** The one Prometheus chat for this dot, bound to the openai-dots agent. */
export function ensureDotSession(dot: DotInfo): string {
  const sessionId = dotSessionId(dot.roomId);
  const session = getSession(sessionId);
  const title = dotTitle(dot.name);
  if (session.title !== title) {
    try { renameSession(sessionId, title); } catch { /* cosmetic */ }
  }
  const binding = getSessionExternalAgent(sessionId);
  if (!binding || binding.agentId !== DOTS_AGENT_ID || binding.upstreamSessionId !== dot.roomId) {
    setSessionExternalAgent(sessionId, {
      version: 1,
      agentId: DOTS_AGENT_ID,
      cwd: binding?.cwd || getConfig().getWorkspacePath(),
      upstreamSessionId: dot.roomId,
      boundAt: binding?.boundAt || new Date().toISOString(),
    });
  }
  return sessionId;
}

function mirror(sessionId: string, msg: DotMessage): void {
  const base = { content: msg.text, timestamp: msg.at || Date.now() };
  addMessage(sessionId, (msg.fromDot
    // Mirrored, not worked on here: no "Worked for 0s" row.
    ? { ...base, role: 'assistant', suppressWorkTimer: true, externalAgent: { agentId: DOTS_AGENT_ID, status: 'completed' }, ...(msg.trigger === 'parent_notification' ? { dotInitiated: true } : {}) }
    : { ...base, role: 'user', channel: 'web', channelLabel: 'ChatGPT' }) as any,
  { disableCompactionCheck: true, disableMemoryFlushCheck: true });
}

/** Shown once when a catch-up page is entirely new, because older messages may sit beyond it. */
export const DOT_GAP_TEXT = '_Some earlier messages from this dot are not shown here. Open ChatGPT to read them._';

export async function syncDotRoom(dot: DotInfo, signal?: AbortSignal): Promise<{ sessionId: string; added: number }> {
  const sessionId = ensureDotSession(dot);
  if (busyRooms.has(dot.roomId) || syncingRooms.has(dot.roomId)) return { sessionId, added: 0 };
  syncingRooms.add(dot.roomId);
  try {
    const room = readState().rooms[dot.roomId];
    const first = !room;
    const messages = await listRoomMessages(dot.roomId, first ? FIRST_SYNC_LIMIT : SYNC_LIMIT, signal);
    // A turn may have started while the request was out (it owns the room now), or Dots was turned off.
    if (busyRooms.has(dot.roomId) || signal?.aborted || !dotsEnabled()) return { sessionId, added: 0 };
    const current = readState().rooms[dot.roomId];
    const seen = new Set(current?.seen || []);
    const sent = new Set(current?.sent || []);
    // Messages are matched by id, not by time, so one that arrived before a newer mirrored
    // message is still picked up. Only history older than the first import stays out, so a
    // wider page never back-fills old history at the bottom of the chat.
    const floor = Number(current?.floorAt ?? current?.lastAt ?? 0);
    const fresh = messages.filter((msg) => !seen.has(msg.id) && !(msg.requestId && sent.has(msg.requestId)) && (first || msg.at > floor));
    // ChatGPT's page size is the limit of what can be caught up. A full page with nothing
    // already mirrored means older messages may be missing, so the chat says so.
    if (!first && messages.length >= SYNC_LIMIT && fresh.length === messages.length) {
      addMessage(sessionId, { role: 'assistant', content: DOT_GAP_TEXT, timestamp: (fresh[0].at || Date.now()) - 1, suppressWorkTimer: true, externalAgent: { agentId: DOTS_AGENT_ID, status: 'completed' } } as any,
        { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    }
    for (const msg of fresh) mirror(sessionId, msg);
    // Saved to disk before the ids are marked seen: a crash can repeat a message, never lose one.
    if (fresh.length) flushSession(sessionId);
    const oldest = messages.length ? Math.min(...messages.map((msg) => msg.at)) : 0;
    rememberSeen(dot.roomId, messages.map((msg) => msg.id), { synced: true, floorAt: first ? oldest : floor });
    if (fresh.length) {
      if (first) markSessionReadForMobile(sessionId);
      broadcastWS({ type: 'session_history_changed', sessionId, timestamp: Date.now(), source: 'openai_dots' });
    }
    return { sessionId, added: fresh.length };
  } finally {
    syncingRooms.delete(dot.roomId);
  }
}

type SyncSummary = { dots: number; added: number; sessions: string[]; errors?: string[] };
let syncInFlight: Promise<SyncSummary> | null = null;

/** Sync every dot. No-op unless OpenAI Dots is on and ready. Single-flight: overlapping callers share one run. */
export function syncAllDots(fresh = false): Promise<SyncSummary> {
  if (!dotsEnabled()) return Promise.resolve({ dots: 0, added: 0, sessions: [] });
  // Background ticks wait out a backoff after failures; an explicit refresh always tries.
  if (!fresh && Date.now() < syncBlockedUntil) return Promise.resolve({ dots: 0, added: 0, sessions: [] });
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSyncAll(fresh).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

let syncFailures = 0;
let syncBlockedUntil = 0;
let syncAbort = new AbortController();

/** A rejected sign-in stops polling until the user signs in and checks again; other failures back off. */
function noteSyncFailure(error: unknown): boolean {
  const status = error instanceof DotsApiError ? error.status : 0;
  if (status === 401 || status === 403) {
    updateExternalAgentEntry(DOTS_AGENT_ID, { lastStatus: 'signed_out', lastStatusText: 'ChatGPT rejected the OpenAI sign-in. Sign in again in Settings > Models, then Check again.' });
    return true;
  }
  syncFailures += 1;
  const retryAfter = error instanceof DotsApiError ? error.retryAfterMs : 0;
  syncBlockedUntil = Date.now() + Math.max(retryAfter, Math.min(15 * 60_000, POLL_MS * 2 ** Math.min(syncFailures, 5)));
  return false;
}

async function runSyncAll(fresh: boolean): Promise<SyncSummary> {
  const signal = syncAbort.signal;
  let dots: DotInfo[];
  try { dots = await getDots(fresh, signal); } catch (error) { if (!signal.aborted) noteSyncFailure(error); throw error; }
  let added = 0;
  const sessions: string[] = [];
  const errors: string[] = [];
  for (const dot of dots) {
    // Turned off or cancelled part-way: stop before touching the next dot.
    if (signal.aborted || !dotsEnabled()) break;
    try {
      const result = await syncDotRoom(dot, signal);
      added += result.added;
      sessions.push(result.sessionId);
    } catch (error: any) {
      if (signal.aborted) break;
      // One dot failing must not stop the others; report it instead of hiding it.
      errors.push(`${dot.name}: ${String(error?.message || error).slice(0, 160)}`);
      if (noteSyncFailure(error)) break;
    }
  }
  if (!errors.length) { syncFailures = 0; syncBlockedUntil = 0; }
  return { dots: dots.length, added, sessions, ...(errors.length ? { errors } : {}) };
}

/** Cancel a sync that is mid-request, so nothing is mirrored after Dots is turned off or the gateway stops. */
export function cancelDotsSync(): void {
  syncAbort.abort();
  syncAbort = new AbortController();
}

let pollTimer: NodeJS.Timeout | null = null;
export function startDotsPoller(intervalMs = POLL_MS): void {
  if (pollTimer || process.env.PROMETHEUS_DISABLE_DOTS_POLL === '1') return;
  pollTimer = setInterval(() => { void syncAllDots().catch(() => undefined); }, intervalMs);
  pollTimer.unref?.();
}

export function stopDotsPoller(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  cancelDotsSync();
}
