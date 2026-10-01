import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ProcessRunRecord } from './types';

const RENAME_RETRY_DELAYS_MS = [5, 10, 20, 40, 80, 160];

function isRetryableRenameError(error: unknown): boolean {
  const code = String((error as NodeJS.ErrnoException)?.code || '').toUpperCase();
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetries(source: string, target: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, target);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safeFileName(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class ProcessRunStore {
  readonly rootDir: string;
  readonly recordsDir: string;
  readonly logsDir: string;
  private readonly recordCache = new Map<string, ProcessRunRecord>();
  private primePromise: Promise<void> | null = null;
  // Newest-first order of recordCache, rebuilt lazily. Sorting
  // ~25k records with Date.parse inside the comparator blocked the gateway
  // ~280 ms on every /api/processes call (measured 2026-10-01).
  // Holds run ids, so output-driven record rewrites (same startedAt) and new
  // runs (newest) keep the order without a re-sort.
  private sortedIds: string[] | null = null;

  private remember(record: ProcessRunRecord): void {
    const previous = this.recordCache.get(record.runId);
    this.recordCache.set(record.runId, record);
    if (!this.sortedIds) return;
    if (previous) {
      if (previous.startedAt !== record.startedAt) this.sortedIds = null;
      return;
    }
    const first = this.sortedIds.length ? this.recordCache.get(this.sortedIds[0]) : undefined;
    if (!first || (Date.parse(record.startedAt) || 0) >= (Date.parse(first.startedAt) || 0)) this.sortedIds.unshift(record.runId);
    else this.sortedIds = null;
  }

  private sortedOrder(): string[] {
    if (this.sortedIds) return this.sortedIds;
    const keyed = Array.from(this.recordCache.values(), (record) => ({ id: record.runId, at: Date.parse(record.startedAt) || 0 }));
    keyed.sort((a, b) => b.at - a.at);
    this.sortedIds = keyed.map((item) => item.id);
    return this.sortedIds;
  }

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.recordsDir = path.join(rootDir, 'records');
    this.logsDir = path.join(rootDir, 'logs');
    ensureDir(this.recordsDir);
    ensureDir(this.logsDir);
  }

  recordPath(runId: string): string {
    return path.join(this.recordsDir, `${safeFileName(runId)}.json`);
  }

  stdoutPath(runId: string): string {
    return path.join(this.logsDir, `${safeFileName(runId)}.stdout.log`);
  }

  stderrPath(runId: string): string {
    return path.join(this.logsDir, `${safeFileName(runId)}.stderr.log`);
  }

  combinedPath(runId: string): string {
    return path.join(this.logsDir, `${safeFileName(runId)}.combined.log`);
  }

  writeRecord(record: ProcessRunRecord): void {
    ensureDir(this.recordsDir);
    const target = this.recordPath(record.runId);
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
      renameWithRetries(tmp, target);
      this.remember(record);
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    }
  }

  appendStdout(runId: string, chunk: string): void {
    ensureDir(this.logsDir);
    fs.appendFileSync(this.stdoutPath(runId), chunk, 'utf-8');
  }

  appendStderr(runId: string, chunk: string): void {
    ensureDir(this.logsDir);
    fs.appendFileSync(this.stderrPath(runId), chunk, 'utf-8');
  }

  appendCombined(runId: string, chunk: string): void {
    ensureDir(this.logsDir);
    fs.appendFileSync(this.combinedPath(runId), chunk, 'utf-8');
  }

  readLogFile(filePath: string, maxChars = 200_000): { text: string; bytes: number; truncated: boolean } {
    if (!fs.existsSync(filePath)) return { text: '', bytes: 0, truncated: false };
    const stat = fs.statSync(filePath);
    const bytes = stat.size;
    const fd = fs.openSync(filePath, 'r');
    try {
      const readBytes = Math.min(bytes, maxChars);
      const buffer = Buffer.alloc(readBytes);
      fs.readSync(fd, buffer, 0, readBytes, Math.max(0, bytes - readBytes));
      return { text: buffer.toString('utf-8'), bytes, truncated: bytes > readBytes };
    } finally {
      fs.closeSync(fd);
    }
  }

  loadRecord(runId: string): ProcessRunRecord | null {
    const cached = this.recordCache.get(runId);
    if (cached) return cached;
    try {
      const p = this.recordPath(runId);
      if (!fs.existsSync(p)) return null;
      const record = JSON.parse(fs.readFileSync(p, 'utf-8')) as ProcessRunRecord;
      this.remember(record);
      return record;
    } catch {
      return null;
    }
  }

  /** Read historical records without blocking the gateway event loop. */
  prime(): Promise<void> {
    if (this.primePromise) return this.primePromise;
    this.primePromise = (async () => {
      const names = (await fs.promises.readdir(this.recordsDir)).filter((name) => name.endsWith('.json'));
      // Small batches let health, chat, and WebSocket callbacks run between
      // parses even when the store has accumulated thousands of terminal runs.
      for (let offset = 0; offset < names.length; offset += 32) {
        const batch = await Promise.all(names.slice(offset, offset + 32).map(async (name) => {
          try {
            return JSON.parse(await fs.promises.readFile(path.join(this.recordsDir, name), 'utf-8')) as ProcessRunRecord;
          } catch {
            return null;
          }
        }));
        for (const record of batch) {
          if (record?.runId && !this.recordCache.has(record.runId)) this.remember(record);
        }
      }
    })();
    return this.primePromise;
  }

  listRecords(limit = 100): ProcessRunRecord[] {
    const max = Math.max(1, Math.min(500, limit));
    const out: ProcessRunRecord[] = [];
    for (const id of this.sortedOrder()) {
      const record = this.recordCache.get(id);
      if (record) out.push(record);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Newest-first records for one chat, scanning the sorted view and stopping at `limit`. */
  listRecordsForSession(sessionId: string, limit = 100): ProcessRunRecord[] {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];
    const max = Math.max(1, Math.min(500, limit));
    const out: ProcessRunRecord[] = [];
    for (const id of this.sortedOrder()) {
      const record = this.recordCache.get(id);
      if (!record) continue;
      if (String(record.sessionId || '').trim() === sid || String((record as any).codingSessionId || '').trim() === sid) {
        out.push(record);
        if (out.length >= max) break;
      }
    }
    return out;
  }
}
