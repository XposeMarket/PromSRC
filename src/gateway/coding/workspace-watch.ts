/**
 * Recursive workspace watcher used by the terminal change tracker to skip
 * redundant before/after walks when nothing in the workspace changed.
 *
 * Correctness hinges on the barrier: fs events arrive asynchronously, so
 * "no events yet" does not prove "no writes". workspaceWatchBarrier() writes a
 * uniquely named sentinel file inside the watched root and waits for its event.
 * A single ReadDirectoryChangesW handle (Windows recursive fs.watch) delivers
 * events in order, so once the sentinel is seen every earlier write is too.
 * Any failure, timeout or unsupported platform returns false / null and the
 * tracker falls back to its full walk.
 */
import fs from 'fs';
import path from 'path';

const SENTINEL_DIR = '.prometheus';
const SENTINEL_PREFIX = 'terminal-watch-barrier-';

interface WatchState {
  root: string;
  watcher: fs.FSWatcher | null;
  generation: number;
  failed: boolean;
  pending: Map<string, () => void>;
}

const states = new Map<string, WatchState>();
const MAX_WATCHED_ROOTS = 8;

function stateKey(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function workspaceWatchSupported(): boolean {
  return process.platform === 'win32' && process.env.PROMETHEUS_DISABLE_TRACKER_WATCH !== '1';
}

function fail(state: WatchState): void {
  if (state.failed) return;
  state.failed = true;
  state.generation += 1;
  try { state.watcher?.close(); } catch {}
  state.watcher = null;
  for (const resolve of Array.from(state.pending.values())) resolve();
}

/**
 * Start (or reuse) the watcher for `root`. `isIgnored` receives a
 * forward-slash relative path; ignored paths never bump the generation.
 */
export function ensureWorkspaceWatch(root: string, isIgnored: (relative: string) => boolean): boolean {
  if (!workspaceWatchSupported()) return false;
  const key = stateKey(root);
  const existing = states.get(key);
  if (existing) return !existing.failed;
  if (states.size >= MAX_WATCHED_ROOTS) return false;
  const state: WatchState = { root: path.resolve(root), watcher: null, generation: 0, failed: false, pending: new Map() };
  states.set(key, state);
  const sentinelPrefix = `${SENTINEL_DIR}/${SENTINEL_PREFIX}`.toLowerCase();
  try {
    state.watcher = fs.watch(state.root, { recursive: true, persistent: false }, (_event, filename) => {
      const relative = String(filename || '').replace(/\\/g, '/');
      if (!relative) {
        // Unknown path (e.g. buffer overflow): treat as a change.
        state.generation += 1;
        return;
      }
      if (relative.toLowerCase().startsWith(sentinelPrefix)) {
        state.pending.get(relative.slice(sentinelPrefix.length))?.();
        return;
      }
      if (isIgnored(relative)) return;
      state.generation += 1;
    });
    state.watcher.on('error', () => fail(state));
  } catch {
    fail(state);
    return false;
  }
  return true;
}

/** Current change generation, or null when the watcher is unavailable. */
export function workspaceWatchGeneration(root: string): number | null {
  const state = states.get(stateKey(root));
  return state && !state.failed ? state.generation : null;
}

/** Resolve true once every fs event that happened before this call has been delivered. */
export function workspaceWatchBarrier(root: string, timeoutMs = 300): Promise<boolean> {
  const state = states.get(stateKey(root));
  if (!state || state.failed) return Promise.resolve(false);
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const file = path.join(state.root, SENTINEL_DIR, `${SENTINEL_PREFIX}${token}`);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.pending.delete(token);
      try { fs.rmSync(file, { force: true }); } catch {}
      resolve(ok && !state.failed);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    state.pending.set(token, () => done(true));
    try {
      // Never create .prometheus in a user repo just for a barrier.
      if (!fs.existsSync(path.dirname(file))) { done(false); return; }
      fs.writeFileSync(file, token);
    } catch {
      done(false);
    }
  });
}

export function __resetWorkspaceWatchForTests(): void {
  for (const state of Array.from(states.values())) fail(state);
  states.clear();
}
