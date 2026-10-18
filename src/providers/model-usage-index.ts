import fs from 'node:fs';
import type { ModelUsageEvent } from './model-usage';

const CHUNK = 64 * 1024;
interface Index {
  identity: string;
  offset: number;
  size: number;
  mtime: number;
  sessions: Map<string, number[]>;
  count: number;
}
const indexes = new Map<string, Index>();
const pending = new Map<string, Promise<Index>>();
function identity(st: fs.Stats): string { return `${st.dev}:${st.ino}:${st.birthtimeMs}`; }
const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Compact byte ranges only: never retain historical event payloads in the gateway heap. */
async function updateIndex(file: string): Promise<Index> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const st = await handle.stat();
    let index = indexes.get(file);
    if (!index || index.identity !== identity(st) || st.size < index.size
      || (st.size === index.size && st.mtimeMs !== index.mtime)) {
      index = { identity: identity(st), offset: 0, size: 0, mtime: 0, sessions: new Map(), count: 0 };
      indexes.set(file, index);
    }
    let position = index.offset;
    let remainder = Buffer.alloc(0);
    while (position < st.size) {
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK, st.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const start = position - remainder.length;
      const data = remainder.length ? Buffer.concat([remainder, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let rowStart = 0;
      for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, rowStart)) {
        try {
          const event = JSON.parse(data.subarray(rowStart, end).toString('utf8')) as ModelUsageEvent;
          const session = String(event.sessionId || '').trim();
          const ranges = index.sessions.get(session) || [];
          const offset = start + rowStart;
          const length = end + 1 - rowStart;
          if (ranges.length && ranges[ranges.length - 2] + ranges[ranges.length - 1] === offset) ranges[ranges.length - 1] += length;
          else ranges.push(offset, length);
          index.sessions.set(session, ranges);
          index.count++;
        } catch { /* Malformed telemetry is skipped, but its byte offset is consumed. */ }
        rowStart = end + 1;
        index.offset = start + rowStart;
      }
      remainder = Buffer.from(data.subarray(rowStart));
      position += bytesRead;
      await yieldLoop();
    }
    index.size = st.size;
    index.mtime = st.mtimeMs;
    return index;
  } finally { await handle.close(); }
}

export async function ensureSessionUsageIndex(file: string): Promise<Index> {
  const existing = pending.get(file);
  if (existing) { await existing; return ensureSessionUsageIndex(file); }
  const operation = updateIndex(file);
  pending.set(file, operation);
  try { return await operation; } finally { pending.delete(file); }
}

export async function readIndexedSessionUsage(file: string, session: string): Promise<ModelUsageEvent[]> {
  const index = await ensureSessionUsageIndex(file);
  const ranges = (index.sessions.get(session) || []).slice();
  const handle = await fs.promises.open(file, 'r');
  try {
    // A rename between indexing and opening must never apply old offsets to a new file.
    const current = await handle.stat();
    if (identity(current) !== index.identity || current.size < index.size) return readIndexedSessionUsage(file, session);
    const result: ModelUsageEvent[] = [];
    for (let i = 0; i < ranges.length; i += 2) {
      let position = ranges[i];
      const end = position + ranges[i + 1];
      let remainder = '';
      const decoder = new TextDecoder();
      while (position < end) {
        const buffer = Buffer.allocUnsafe(Math.min(CHUNK, end - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        const lines = (remainder + decoder.decode(buffer.subarray(0, bytesRead), { stream: true })).split('\n');
        remainder = lines.pop() || '';
        for (const line of lines) { try { result.push(JSON.parse(line)); } catch {} }
        position += bytesRead;
        await yieldLoop();
      }
    }
    return result;
  } finally { await handle.close(); }
}

/** Recent billing windows are read backwards; old history is never parsed on a turn. */
export async function readRecentUsage(file: string, cutoff: number): Promise<ModelUsageEvent[]> {
  const handle = await fs.promises.open(file, 'r');
  try {
    let position = (await handle.stat()).size;
    let remainder = Buffer.alloc(0);
    let trailing = true;
    const result: ModelUsageEvent[] = [];
    while (position > 0) {
      const start = Math.max(0, position - CHUNK);
      const buffer = Buffer.allocUnsafe(position - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const data = Buffer.concat([buffer.subarray(0, bytesRead), remainder]);
      const first = start ? data.indexOf(10) : -1;
      const complete = start && first < 0 ? Buffer.alloc(0) : data.subarray(first + 1);
      const lines = complete.toString('utf8').split('\n');
      if (trailing && complete.length) { lines.pop(); trailing = false; }
      let older = false;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]) as ModelUsageEvent;
          const time = Date.parse(event.timestamp);
          if (time >= cutoff) result.push(event);
          else if (Number.isFinite(time)) older = true;
        } catch {}
      }
      if (older) break;
      remainder = first < 0 ? data : Buffer.from(data.subarray(0, first));
      position = start;
      await yieldLoop();
    }
    return result.reverse();
  } finally { await handle.close(); }
}

export function resetSessionUsageIndexes(): void { indexes.clear(); }

export async function readUsageRange(file: string, start: number, end: number, session = ''): Promise<ModelUsageEvent[]> {
  const handle = await fs.promises.open(file, 'r');
  try {
    let position = start;
    let remainder = '';
    const decoder = new TextDecoder();
    const events: ModelUsageEvent[] = [];
    while (position < end) {
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK, end - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const lines = (remainder + decoder.decode(buffer.subarray(0, bytesRead), { stream: true })).split('\n');
      remainder = lines.pop() || '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as ModelUsageEvent;
          if (!session || String(event.sessionId || '').trim() === session) events.push(event);
        } catch {}
      }
      position += bytesRead;
      await yieldLoop();
    }
    return events;
  } finally { await handle.close(); }
}
