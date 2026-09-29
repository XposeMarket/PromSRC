/**
 * Generic in-memory game room relay (SSE downstream + POST upstream).
 * Chosen over a WebSocket upgrade handler because the gateway's upgrade hook
 * only routes /ws; SSE+POST rides the normal Express router with zero
 * changes to core/server.ts.
 *
 * Messages on the SSE stream: {type:'welcome', playerId, players[]},
 * {type:'join'|'leave', playerId}, {type:'state'|<custom>, from, data}.
 */
import crypto from 'crypto';

export interface RoomClient { id: string; write: (msg: unknown) => void; lastSeen: number }
const rooms = new Map<string, Map<string, RoomClient>>();

export function validRoom(name: string): boolean { return /^[A-Za-z0-9_-]{1,64}$/.test(String(name || '')); }

export function joinRoom(room: string, write: (msg: unknown) => void): RoomClient {
  if (!validRoom(room)) throw new Error('Invalid room name.');
  let r = rooms.get(room);
  if (!r) { r = new Map(); rooms.set(room, r); }
  if (r.size >= 32) throw new Error('Room is full (32 players).');
  const client: RoomClient = { id: `p_${crypto.randomBytes(4).toString('hex')}`, write, lastSeen: Date.now() };
  const players = [...r.keys()];
  r.set(client.id, client);
  client.write({ type: 'welcome', playerId: client.id, room, players });
  broadcast(room, { type: 'join', playerId: client.id }, client.id);
  return client;
}

export function leaveRoom(room: string, playerId: string): void {
  const r = rooms.get(room);
  if (!r || !r.delete(playerId)) return;
  if (!r.size) rooms.delete(room);
  else broadcast(room, { type: 'leave', playerId });
}

export function broadcast(room: string, msg: unknown, exceptId?: string): number {
  const r = rooms.get(room);
  if (!r) return 0;
  let n = 0;
  for (const c of r.values()) {
    if (c.id === exceptId) continue;
    try { c.write(msg); n++; } catch { /* dropped */ }
  }
  return n;
}

export function relay(room: string, playerId: string, type: string, data: unknown): number {
  const r = rooms.get(room);
  const c = r?.get(playerId);
  if (!c) throw new Error('Unknown player for this room (connect to /events first).');
  c.lastSeen = Date.now();
  const t = /^[a-z][a-z0-9_-]{0,31}$/i.test(type) && !['welcome', 'join', 'leave'].includes(type) ? type : 'state';
  return broadcast(room, { type: t, from: playerId, data }, playerId);
}

export function roomInfo(room: string): { room: string; players: string[] } {
  return { room, players: [...(rooms.get(room)?.keys() || [])] };
}
