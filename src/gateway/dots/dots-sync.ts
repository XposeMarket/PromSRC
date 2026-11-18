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
  getSession,
  getSessionExternalAgent,
  markSessionReadForMobile,
  renameSession,
  setSessionExternalAgent,
} from '../session';
import { getExternalAgentEntry } from '../external-agents/store';
import { listDots, listRoomMessages, type DotInfo, type DotMessage } from './dots-api';

export const DOTS_AGENT_ID = 'openai-dots' as const;
const MAX_SEEN = 400;
const FIRST_SYNC_LIMIT = 20;
const SYNC_LIMIT = 32; // ChatGPT's maximum page size
const DOTS_CACHE_MS = 5 * 60_000;
const POLL_MS = 45_000;

/** lastAt = newest mirrored message time; older messages are never appended (keeps the chat in order). */
interface RoomState { sessionId: string; seen: string[]; syncedAt?: number; lastAt?: number }
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
export function rememberSeen(roomId: string, ids: string[], options: { synced?: boolean; lastAt?: number } = {}): void {
  const clean = ids.map((id) => String(id || '').trim()).filter(Boolean);
  const state = readState();
  const room = state.rooms[roomId] || { sessionId: dotSessionId(roomId), seen: [] };
  const seen = new Set(room.seen);
  for (const id of clean) seen.add(id);
  room.seen = [...seen].slice(-MAX_SEEN);
  if (options.synced) room.syncedAt = Date.now();
  if (Number(options.lastAt) > 0) room.lastAt = Math.max(Number(room.lastAt || 0), Number(options.lastAt));
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
export async function getDots(fresh = false): Promise<DotInfo[]> {
  if (!fresh && dotsCache && Date.now() - dotsCache.at < DOTS_CACHE_MS) return dotsCache.dots;
  const dots = await listDots();
  dotsCache = { at: Date.now(), dots };
  return dots;
}

/** The one Prometheus chat for this dot, bound to the openai-dots agent. */
export function ensureDotSession(dot: DotInfo): string {
  const sessionId = dotSessionId(dot.roomId);
  const session = getSession(sessionId);
  if (session.title !== dot.name) {
    try { renameSession(sessionId, dot.name); } catch { /* cosmetic */ }
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

export async function syncDotRoom(dot: DotInfo): Promise<{ sessionId: string; added: number }> {
  const sessionId = ensureDotSession(dot);
  if (busyRooms.has(dot.roomId) || syncingRooms.has(dot.roomId)) return { sessionId, added: 0 };
  syncingRooms.add(dot.roomId);
  try {
    const room = readState().rooms[dot.roomId];
    const first = !room;
    const messages = await listRoomMessages(dot.roomId, first ? FIRST_SYNC_LIMIT : SYNC_LIMIT);
    // A turn may have started while the request was out; it owns the room now.
    if (busyRooms.has(dot.roomId)) return { sessionId, added: 0 };
    const current = readState().rooms[dot.roomId];
    const seen = new Set(current?.seen || []);
    // Only append what is newer than everything already mirrored; a wider page must not
    // back-fill older history at the bottom of the chat.
    const floor = Math.max(Number(current?.lastAt || 0), ...messages.filter((msg) => seen.has(msg.id)).map((msg) => msg.at), 0);
    const fresh = messages.filter((msg) => !seen.has(msg.id) && (first || msg.at > floor));
    for (const msg of fresh) mirror(sessionId, msg);
    rememberSeen(dot.roomId, messages.map((msg) => msg.id), { synced: true, lastAt: Math.max(0, ...messages.map((msg) => msg.at)) });
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
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSyncAll(fresh).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

async function runSyncAll(fresh: boolean): Promise<SyncSummary> {
  const dots = await getDots(fresh);
  let added = 0;
  const sessions: string[] = [];
  const errors: string[] = [];
  for (const dot of dots) {
    try {
      const result = await syncDotRoom(dot);
      added += result.added;
      sessions.push(result.sessionId);
    } catch (error: any) {
      // One dot failing must not stop the others; report it instead of hiding it.
      errors.push(`${dot.name}: ${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return { dots: dots.length, added, sessions, ...(errors.length ? { errors } : {}) };
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
}
