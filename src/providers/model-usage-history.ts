import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { ModelUsageEvent } from './model-usage';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 35;
const CHUNK_BYTES = 256 * 1024;

type LogLock = { tail: Promise<void>; busy: boolean };
const logLocks = new Map<string, LogLock>();

export interface ModelUsageHistoryOptions {
  /** Include a row only when this predicate returns true. Invalid rows are skipped. */
  filter?: (event: ModelUsageEvent) => boolean;
}

export interface RotateModelUsageLogOptions {
  maxBytes?: number;
  retentionDays?: number;
  now?: Date;
}

export interface ModelUsageRotationResult {
  rotated: boolean;
  archivedRows: number;
  activeRows: number;
  archivePaths: string[];
}

interface RotationJournal {
  version: 1;
  activePath: string;
  activeStagePath: string;
  activeSha256: string;
  archives: Array<{ targetPath: string; stagePath: string; sha256: string }>;
}

function lockFor(filePath: string): LogLock {
  const resolved = path.resolve(filePath);
  let lock = logLocks.get(resolved);
  if (!lock) {
    lock = { tail: Promise.resolve(), busy: false };
    logLocks.set(resolved, lock);
  }
  return lock;
}

/**
 * Serializes append and rotation operations made through this module for one log path.
 * Callers must use this API instead of fs.appendFile[Sync] if rotation is enabled.
 * Direct external writes are unsupported while a rotation is in progress.
 */
export async function enqueueModelUsageAppend(filePath: string, line: string): Promise<void> {
  if (!line) return;
  await withLogLock(filePath, async () => {
    await recoverPendingRotation(filePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await appendSeparatedLine(filePath, line);
  });
}

/**
 * Preserve synchronous append behavior when idle. When rotation/recovery is active,
 * queue this row behind it and return true; callers must skip their direct append.
 */
export function tryQueueModelUsageAppend(filePath: string, line: string): boolean {
  const lock = lockFor(filePath);
  if (!lock.busy && !fs.existsSync(journalPath(filePath))) return false;
  void enqueueModelUsageAppend(filePath, line).catch(error => {
    console.warn('[usage] Queued ledger append failed:', error?.message || error);
  });
  return true;
}

/** Wait for queued append/rotation work before an async reader opens the history. */
export async function flushModelUsageAppends(filePath: string): Promise<void> {
  await lockFor(filePath).tail;
}

async function appendSeparatedLine(filePath: string, line: string): Promise<void> {
  let separator = '';
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > 0) {
      const handle = await fs.promises.open(filePath, 'r');
      try {
        const last = Buffer.allocUnsafe(1);
        await handle.read(last, 0, 1, stat.size - 1);
        if (last[0] !== 10) separator = '\n';
      } finally { await handle.close(); }
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.promises.appendFile(filePath, `${separator}${line}`, 'utf8');
}

async function withLogLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lock = lockFor(filePath);
  const previous = lock.tail;
  let release!: () => void;
  lock.busy = true;
  const own = new Promise<void>((resolve) => { release = resolve; });
  lock.tail = own;
  await previous;
  try {
    return await operation();
  } finally {
    release();
    // A later queued operation owns lock.tail and keeps the fast-path blocked.
    if (lock.tail === own) lock.busy = false;
  }
}

/**
 * Holds the append/rotation lock for a complete async history read. Use this around
 * listing archive files plus indexed/recent reads so a rotation cannot split a query.
 * Recovery completes an interrupted journal before the read begins.
 */
export async function withModelUsageReadLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  return withLogLock(filePath, async () => {
    await recoverPendingRotation(filePath);
    return operation();
  });
}


function archivePath(filePath: string, timestamp: string): string | undefined {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  const stem = path.basename(filePath).replace(/\.jsonl$/i, '');
  return path.join(path.dirname(filePath), `${stem}.${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
}

function journalPath(filePath: string): string { return `${filePath}.rotation-journal.json`; }
function stagePath(filePath: string, label: string): string { return `${filePath}.${label}.${process.pid}.${Date.now()}.stage`; }

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest('hex');
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(value), 'utf8');
  await fs.promises.rename(temporary, filePath);
}

async function recoverPendingRotation(filePath: string): Promise<void> {
  const journalFile = journalPath(filePath);
  let journal: RotationJournal;
  try { journal = JSON.parse(await fs.promises.readFile(journalFile, 'utf8')) as RotationJournal; } catch { return; }
  if (journal.version !== 1 || journal.activePath !== filePath) return;
  for (const archive of journal.archives) {
    let targetMatches = false;
    try { targetMatches = await sha256(archive.targetPath) === archive.sha256; } catch {}
    if (!targetMatches) {
      try { await fs.promises.rename(archive.stagePath, archive.targetPath); }
      catch (error: any) { if (error?.code === 'ENOENT') throw new Error(`rotation recovery missing staged archive: ${archive.stagePath}`); throw error; }
    }
  }
  let activeMatches = false;
  try { activeMatches = await sha256(filePath) === journal.activeSha256; } catch {}
  if (!activeMatches) {
    try { await fs.promises.rename(journal.activeStagePath, filePath); }
    catch (error: any) { if (error?.code === 'ENOENT') throw new Error(`rotation recovery missing staged active log: ${journal.activeStagePath}`); throw error; }
  }
  await fs.promises.rm(journalFile, { force: true });
}

async function writeTo(handle: fs.promises.FileHandle, data: string): Promise<void> {
  const buffer = Buffer.from(data);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    offset += bytesWritten;
  }
}

async function* readLines(filePath: string): AsyncGenerator<{ line: string; terminated: boolean }> {
  const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_BYTES });
  let remainder = Buffer.alloc(0);
  for await (const chunk of stream) {
    const data = remainder.length ? Buffer.concat([remainder, chunk as Buffer]) : chunk as Buffer;
    let start = 0;
    for (let newline = data.indexOf(10, start); newline >= 0; newline = data.indexOf(10, start)) {
      yield { line: data.subarray(start, newline).toString('utf8'), terminated: true };
      start = newline + 1;
    }
    remainder = Buffer.from(data.subarray(start));
  }
  if (remainder.length) yield { line: remainder.toString('utf8'), terminated: false };
}

/** Returns archives oldest-first followed by the active file; use for per-session indexed reads. */
export async function listModelUsageHistoryFiles(filePath: string): Promise<string[]> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath).replace(/\.jsonl$/i, '');
  try {
    const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const archives = (await fs.promises.readdir(directory))
      .filter((entry) => new RegExp(`^${escaped}\\.\\d{4}-\\d{2}\\.jsonl$`).test(entry))
      .sort()
      .map((entry) => path.join(directory, entry));
    return [...archives, filePath];
  } catch {
    return [filePath];
  }
}

async function copyIfPresent(source: string, destination: string): Promise<void> {
  try {
    await fs.promises.copyFile(source, destination);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.promises.writeFile(destination, '');
  }
}

async function* iterateModelUsageHistoryUnlocked(filePath: string, options: ModelUsageHistoryOptions = {}): AsyncGenerator<ModelUsageEvent> {
  for (const candidate of await listModelUsageHistoryFiles(filePath)) {
    try {
      for await (const { line, terminated } of readLines(candidate)) {
        if (!terminated || !line.trim()) continue;
        try {
          const event = JSON.parse(line) as ModelUsageEvent;
          if (!options.filter || options.filter(event)) yield event;
        } catch {
          // A damaged/partial telemetry row is intentionally skipped, not discarded from disk.
        }
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * Streams parseable historical rows after queued work has drained. For a stable multi-file
 * view that cannot be split by a rotation, use readModelUsageHistory or wrap the entire
 * consumer operation with withModelUsageReadLock.
 */
export async function* iterateModelUsageHistory(filePath: string, options: ModelUsageHistoryOptions = {}): AsyncGenerator<ModelUsageEvent> {
  await flushModelUsageAppends(filePath);
  yield* iterateModelUsageHistoryUnlocked(filePath, options);
}

/** Convenience collector for request handlers; holds the lock across all archive files. */
export async function readModelUsageHistory(filePath: string, options: ModelUsageHistoryOptions = {}): Promise<ModelUsageEvent[]> {
  return withModelUsageReadLock(filePath, async () => {
    const events: ModelUsageEvent[] = [];
    for await (const event of iterateModelUsageHistoryUnlocked(filePath, options)) events.push(event);
    return events;
  });
}

/**
 * Archives parseable rows older than retentionDays into UTC-month JSONL files when the
 * active log is above maxBytes. Damaged and unterminated rows stay verbatim in active.
 * Every writer must use enqueueModelUsageAppend/tryQueueModelUsageAppend while rotation
 * is enabled; direct filesystem appends cannot be made lossless across the final rename.
 * The transaction journal lets the next queued append or rotation finish an interruption.
 */
export async function rotateModelUsageLog(filePath: string, options: RotateModelUsageLogOptions = {}): Promise<ModelUsageRotationResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = (options.now ? options.now.getTime() : Date.now()) - retentionDays * 86_400_000;
  return withLogLock(filePath, async () => {
    await recoverPendingRotation(filePath);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(filePath); } catch (error: any) {
      if (error?.code === 'ENOENT') return { rotated: false, archivedRows: 0, activeRows: 0, archivePaths: [] };
      throw error;
    }
    if (stat.size <= maxBytes) return { rotated: false, archivedRows: 0, activeRows: 0, archivePaths: [] };

    const activeStagePath = stagePath(filePath, 'active');
    const activeHandle = await fs.promises.open(activeStagePath, 'w');
    const archiveHandles = new Map<string, fs.promises.FileHandle>();
    const archiveStages = new Map<string, string>();
    let archivedRows = 0;
    let activeRows = 0;
    try {
      for await (const { line, terminated } of readLines(filePath)) {
        const rawRow = terminated ? `${line}\n` : line;
        let destination: string | undefined;
        try {
          const event = JSON.parse(line) as ModelUsageEvent;
          const timestamp = Date.parse(String(event.timestamp || ''));
          if (terminated && Number.isFinite(timestamp) && timestamp < cutoff) destination = archivePath(filePath, String(event.timestamp));
        } catch {}
        if (!destination) {
          await writeTo(activeHandle, rawRow);
          activeRows++;
          continue;
        }
        let handle = archiveHandles.get(destination);
        if (!handle) {
          const staged = stagePath(destination, 'archive');
          await copyIfPresent(destination, staged);
          handle = await fs.promises.open(staged, 'a');
          archiveHandles.set(destination, handle);
          archiveStages.set(destination, staged);
        }
        await writeTo(handle, rawRow);
        archivedRows++;
      }
    } finally {
      await activeHandle.close();
      await Promise.all([...archiveHandles.values()].map((handle) => handle.close()));
    }
    if (!archivedRows) {
      await fs.promises.rm(activeStagePath, { force: true });
      return { rotated: false, archivedRows: 0, activeRows, archivePaths: [] };
    }
    const archives = await Promise.all([...archiveStages.entries()].map(async ([targetPath, stage]) => ({ targetPath, stagePath: stage, sha256: await sha256(stage) })));
    await atomicWriteJson(journalPath(filePath), {
      version: 1,
      activePath: filePath,
      activeStagePath,
      activeSha256: await sha256(activeStagePath),
      archives,
    } satisfies RotationJournal);
    await recoverPendingRotation(filePath);
    return { rotated: true, archivedRows, activeRows, archivePaths: archives.map((archive) => archive.targetPath) };
  });
}
