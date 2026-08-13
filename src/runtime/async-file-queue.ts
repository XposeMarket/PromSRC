import fs from 'fs';
import path from 'path';

const MAX_APPEND_BATCH_BYTES = 512 * 1024;
const DEFAULT_MAX_PENDING_APPEND_BYTES = 8 * 1024 * 1024;

interface AsyncFileState {
  appendChunks: string[];
  appendBytes: number;
  appendActive: boolean;
  pendingWrite: string | undefined;
  writeActive: boolean;
}

const states = new Map<string, AsyncFileState>();

function getState(filePath: string): AsyncFileState {
  let state = states.get(filePath);
  if (!state) {
    state = {
      appendChunks: [],
      appendBytes: 0,
      appendActive: false,
      pendingWrite: undefined,
      writeActive: false,
    };
    states.set(filePath, state);
  }
  return state;
}

function maybeReleaseState(filePath: string, state: AsyncFileState): void {
  if (
    !state.appendActive
    && !state.writeActive
    && state.appendChunks.length === 0
    && state.pendingWrite === undefined
  ) {
    states.delete(filePath);
  }
}

async function flushAppends(filePath: string, state: AsyncFileState): Promise<void> {
  try {
    while (state.appendChunks.length > 0) {
      const batch: string[] = [];
      let batchBytes = 0;
      while (state.appendChunks.length > 0) {
        const next = state.appendChunks[0];
        const nextBytes = Buffer.byteLength(next, 'utf8');
        if (batch.length > 0 && batchBytes + nextBytes > MAX_APPEND_BATCH_BYTES) break;
        state.appendChunks.shift();
        state.appendBytes = Math.max(0, state.appendBytes - nextBytes);
        batch.push(next);
        batchBytes += nextBytes;
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.appendFile(filePath, batch.join(''), 'utf8');
    }
  } catch {
    // These files are telemetry only. Drop a failed backlog rather than
    // allowing an unavailable disk to retain memory for the lifetime of the
    // gateway process.
    state.appendChunks = [];
    state.appendBytes = 0;
  } finally {
    state.appendActive = false;
    if (state.appendChunks.length > 0) {
      scheduleAppendFlush(filePath, state);
    }
    maybeReleaseState(filePath, state);
  }
}

function scheduleAppendFlush(filePath: string, state: AsyncFileState): void {
  if (state.appendActive) return;
  state.appendActive = true;
  void flushAppends(filePath, state);
}

async function flushWrites(filePath: string, state: AsyncFileState): Promise<void> {
  try {
    while (state.pendingWrite !== undefined) {
      const contents = state.pendingWrite;
      state.pendingWrite = undefined;
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, contents, 'utf8');
    }
  } catch {
    state.pendingWrite = undefined;
  } finally {
    state.writeActive = false;
    if (state.pendingWrite !== undefined) {
      scheduleWriteFlush(filePath, state);
    }
    maybeReleaseState(filePath, state);
  }
}

function scheduleWriteFlush(filePath: string, state: AsyncFileState): void {
  if (state.writeActive) return;
  state.writeActive = true;
  void flushWrites(filePath, state);
}

/**
 * Queue a best-effort append without making the caller block on disk I/O.
 * Returns false only when the bounded in-memory backlog is full.
 */
export function enqueueAsyncAppend(
  filePath: string,
  contents: string,
  maxPendingBytes = DEFAULT_MAX_PENDING_APPEND_BYTES,
): boolean {
  const value = String(contents || '');
  if (!value) return true;
  const state = getState(filePath);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (state.appendBytes + bytes > Math.max(1, maxPendingBytes)) return false;
  state.appendChunks.push(value);
  state.appendBytes += bytes;
  scheduleAppendFlush(filePath, state);
  return true;
}

/** Queue a latest-value-wins file replacement without blocking the caller. */
export function enqueueAsyncWrite(filePath: string, contents: string): void {
  const state = getState(filePath);
  state.pendingWrite = String(contents ?? '');
  scheduleWriteFlush(filePath, state);
}
