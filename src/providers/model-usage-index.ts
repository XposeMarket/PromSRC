import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { ModelUsageEvent } from './model-usage';

const CHUNK = 64 * 1024;
/** Prefix hash detects truncate-then-regrow replacement even when ino/birthtime are reused. */
const HEAD_BYTES = 4096;
export interface UsageLifetimeTotal {
  provider: string;
  accountId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCostMicros: number;
}
const counters = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'totalCostMicros'] as const;
interface Index {
  totals: Map<string, UsageLifetimeTotal>;
  identity: string;
  head: string;
  headLength: number;
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

/** Hash of the first `length` bytes; a mismatch means the indexed prefix was rewritten. */
async function headHash(handle: fs.promises.FileHandle, length: number): Promise<string> {
  if (!length) return '';
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, 0);
  return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
}

/** Compact byte ranges only: never retain historical event payloads in the gateway heap. */
async function updateIndex(file: string): Promise<Index> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const st = await handle.stat();
    let index = indexes.get(file);
    const headNow = index ? await headHash(handle, index.headLength) : '';
    if (!index || index.identity !== identity(st) || st.size < index.offset || st.size < index.size
      || headNow !== index.head || (st.size === index.size && st.mtimeMs !== index.mtime)) {
      index = { identity: identity(st), head: '', headLength: 0, offset: 0, size: 0, mtime: 0, sessions: new Map(), totals: new Map(), count: 0 };
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
          const provider = String(event.provider || '');
          const accountId = String(event.accountId || '');
          const key = JSON.stringify([provider, accountId]);
          let total = index.totals.get(key);
          if (!total) {
            total = { provider, accountId, calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, totalCostMicros: 0 };
            index.totals.set(key, total);
          }
          total.calls++;
          for (const counter of counters) total[counter] += Number(event[counter]) || 0;
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
    index.headLength = Math.min(HEAD_BYTES, st.size);
    index.head = await headHash(handle, index.headLength);
    return index;
  } finally { await handle.close(); }
}

export async function ensureSessionUsageIndex(file: string): Promise<Index> {
  const existing = pending.get(file);
  if (existing) { await existing; return ensureSessionUsageIndex(file); }
  const operation = updateIndex(file);
  pending.set(file, operation);
  try { return await operation; }
  catch (error) { indexes.delete(file); throw error; }
  finally { pending.delete(file); }
}

export async function readIndexedSessionUsage(file: string, session: string, attempt = 0): Promise<ModelUsageEvent[]> {
  const index = await ensureSessionUsageIndex(file);
  const ranges = (index.sessions.get(session) || []).slice();
  const handle = await fs.promises.open(file, 'r');
  try {
    // A rename or in-place rewrite between indexing and opening must never apply old offsets to new bytes.
    const current = await handle.stat();
    if (identity(current) !== index.identity || current.size < index.size
      || await headHash(handle, index.headLength) !== index.head) {
      await handle.close();
      if (attempt >= 2) throw new Error('Usage ledger repeatedly replaced during session read');
      return readIndexedSessionUsage(file, session, attempt + 1);
    }
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

/** Reverse reader assumes ledger timestamps are appended chronologically; not a hard byte bound. */
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
