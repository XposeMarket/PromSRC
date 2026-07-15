import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { SqliteTurnJobStore } from './store.js';

const TURN_BLOB_FILE_PATTERN = /^([a-f0-9]{64})\.turnblob$/;
const SHARD_COUNT = 256;

export interface TurnJournalRetentionOptions {
  databasePath: string;
  blobRoot: string;
  statePath?: string;
  now?: number;
  jobRetentionMs: number;
  blobRetentionMs: number;
  jobBatchLimit: number;
  blobScanLimit: number;
  blobDeleteLimit: number;
}

export interface TurnBlobRetentionResult {
  scanned: number;
  eligible: number;
  referenced: number;
  touchedDuringScan: number;
  deleted: number;
  deletedBytes: number;
  errors: number;
  batchSaturated: boolean;
  cursor: string;
}

export interface TurnJournalRetentionResult {
  startedAt: number;
  completedAt: number;
  jobCutoff: number;
  blobCutoff: number;
  jobsDeleted: number;
  jobBatchSaturated: boolean;
  blobs: TurnBlobRetentionResult;
}

interface BlobGcCursor {
  version: 1;
  shard: number;
  afterName: string;
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeCursor(value: unknown): BlobGcCursor {
  if (!value || typeof value !== 'object') return { version: 1, shard: 0, afterName: '' };
  const raw = value as Partial<BlobGcCursor>;
  const shard = Number(raw.shard);
  return {
    version: 1,
    shard: Number.isSafeInteger(shard) && shard >= 0 && shard < SHARD_COUNT ? shard : 0,
    afterName: typeof raw.afterName === 'string' && raw.afterName.length <= 80 ? raw.afterName : '',
  };
}

function readCursor(statePath: string): BlobGcCursor {
  try {
    return normalizeCursor(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // A truncated cursor is harmless: a full scan simply restarts at shard 00.
    }
    return { version: 1, shard: 0, afterName: '' };
  }
}

function writeCursor(statePath: string, cursor: BlobGcCursor): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(cursor)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporary, statePath);
  } catch (error) {
    try { fs.unlinkSync(statePath); } catch (unlinkError) {
      if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    fs.renameSync(temporary, statePath);
  }
}

function cursorLabel(cursor: BlobGcCursor): string {
  return `${cursor.shard.toString(16).padStart(2, '0')}/${cursor.afterName || '-'}`;
}

function pruneUnreferencedTurnBlobs(
  store: SqliteTurnJobStore,
  blobRootInput: string,
  statePath: string,
  cutoff: number,
  scanLimit: number,
  deleteLimit: number,
): TurnBlobRetentionResult {
  const blobRoot = path.resolve(blobRootInput);
  fs.mkdirSync(blobRoot, { recursive: true });
  let cursor = readCursor(statePath);
  let shardsVisited = 0;
  let scanned = 0;
  let eligible = 0;
  let referenced = 0;
  let touchedDuringScan = 0;
  let deleted = 0;
  let deletedBytes = 0;
  let errors = 0;
  let stop = false;

  while (!stop && scanned < scanLimit && shardsVisited < SHARD_COUNT) {
    const shardName = cursor.shard.toString(16).padStart(2, '0');
    const shardPath = path.join(blobRoot, shardName);
    let names: string[] = [];
    try {
      names = fs.readdirSync(shardPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && TURN_BLOB_FILE_PATTERN.test(entry.name) && entry.name > cursor.afterName)
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors += 1;
    }

    let exhaustedShard = true;
    for (let index = 0; index < names.length; index += 1) {
      if (scanned >= scanLimit || deleted >= deleteLimit) {
        exhaustedShard = false;
        stop = true;
        break;
      }
      const name = names[index];
      cursor = { version: 1, shard: cursor.shard, afterName: name };
      scanned += 1;
      const match = TURN_BLOB_FILE_PATTERN.exec(name);
      if (!match || match[1].slice(0, 2) !== shardName) continue;
      const filePath = path.join(shardPath, name);
      try {
        const first = fs.statSync(filePath);
        if (!first.isFile() || first.mtimeMs >= cutoff) continue;
        eligible += 1;
        const ref = `turnblob:sha256:${match[1]}`;
        if (store.isDirectBlobReference(ref)) {
          referenced += 1;
          continue;
        }

        // A normal blob read/reuse refreshes mtime. Re-stat immediately before
        // unlink so a concurrent reader that touched this candidate wins.
        const current = fs.statSync(filePath);
        if (
          current.mtimeMs >= cutoff
          || current.mtimeMs !== first.mtimeMs
          || current.ctimeMs !== first.ctimeMs
          || current.size !== first.size
        ) {
          touchedDuringScan += 1;
          continue;
        }
        fs.unlinkSync(filePath);
        deleted += 1;
        deletedBytes += first.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors += 1;
      }

      if (index < names.length - 1 && (scanned >= scanLimit || deleted >= deleteLimit)) {
        exhaustedShard = false;
        stop = true;
        break;
      }
    }

    if (exhaustedShard) {
      cursor = { version: 1, shard: (cursor.shard + 1) % SHARD_COUNT, afterName: '' };
      shardsVisited += 1;
      try { fs.rmdirSync(shardPath); } catch {}
    }
  }

  writeCursor(statePath, cursor);
  return {
    scanned,
    eligible,
    referenced,
    touchedDuringScan,
    deleted,
    deletedBytes,
    errors,
    batchSaturated: scanned >= scanLimit || deleted >= deleteLimit,
    cursor: cursorLabel(cursor),
  };
}

/**
 * Run one bounded retention pass. Production calls this only inside the
 * retention child process; keeping the implementation synchronous there makes
 * its SQLite transaction and filesystem accounting simple without blocking the
 * gateway event loop.
 */
export function runTurnJournalRetention(options: TurnJournalRetentionOptions): TurnJournalRetentionResult {
  const startedAt = Date.now();
  if (!String(options.databasePath || '').trim()) throw new TypeError('databasePath is required');
  if (!String(options.blobRoot || '').trim()) throw new TypeError('blobRoot is required');
  const now = boundedInteger('now', options.now ?? startedAt, 0, Number.MAX_SAFE_INTEGER);
  const jobRetentionMs = boundedInteger('jobRetentionMs', options.jobRetentionMs, 1, Number.MAX_SAFE_INTEGER);
  const blobRetentionMs = boundedInteger('blobRetentionMs', options.blobRetentionMs, 1, Number.MAX_SAFE_INTEGER);
  if (blobRetentionMs <= jobRetentionMs) {
    throw new RangeError('blobRetentionMs must be longer than jobRetentionMs');
  }
  const jobBatchLimit = boundedInteger('jobBatchLimit', options.jobBatchLimit, 1, 10_000);
  const blobScanLimit = boundedInteger('blobScanLimit', options.blobScanLimit, 1, 100_000);
  const blobDeleteLimit = boundedInteger('blobDeleteLimit', options.blobDeleteLimit, 1, blobScanLimit);
  const databasePath = path.resolve(options.databasePath);
  const blobRoot = path.resolve(options.blobRoot);
  const statePath = path.resolve(options.statePath || path.join(path.dirname(databasePath), 'turn-retention-state.json'));
  const jobCutoff = Math.max(0, now - jobRetentionMs);
  const blobCutoff = Math.max(0, now - blobRetentionMs);

  const store = new SqliteTurnJobStore(databasePath, { reconcileOnOpen: false });
  try {
    const jobs = store.pruneTerminalJobs({ olderThan: jobCutoff, limit: jobBatchLimit });
    const blobs = pruneUnreferencedTurnBlobs(
      store,
      blobRoot,
      statePath,
      blobCutoff,
      blobScanLimit,
      blobDeleteLimit,
    );
    store.checkpointWal();
    return {
      startedAt,
      completedAt: Date.now(),
      jobCutoff,
      blobCutoff,
      jobsDeleted: jobs.deleted,
      jobBatchSaturated: jobs.deleted >= jobBatchLimit,
      blobs,
    };
  } finally {
    store.close();
  }
}
