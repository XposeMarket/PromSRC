/**
 * git-read-cache.ts
 *
 * Short-lived memo for read-only git invocations used by the Sources/coding
 * panel. One panel refresh used to run `git status` three times per repo
 * (~1.3s each on a large worktree), synchronously on the gateway thread, and
 * every panel refresh repeated it. Reads are now shared for a few seconds and
 * any git write through Prometheus clears the cache for that repo.
 *
 * Stale-while-revalidate: the callers run git with execFileSync, which blocks
 * the whole gateway event loop (measured 2026-10-01: `git status
 * --untracked-files=all` on PromSRC takes 1.2-1.7 s, and a desktop chat switch
 * sat queued 2.4-2.6 s behind /api/coding/context). When a caller passes an
 * async refresher, an entry that is past TTL but younger than STALE_MAX_MS is
 * returned immediately and refreshed in the background with a non-blocking
 * child process. Concurrent refreshes of the same key share one process. Only
 * a cold miss (or an entry older than STALE_MAX_MS) still runs synchronously.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const TTL_MS = 4_000;
const STALE_MAX_MS = 60_000;
const MAX_ENTRIES = 256;

interface Entry { at: number; value: string }
const cache = new Map<string, Entry>();
const refreshing = new Map<string, Promise<void>>();
// Bumped on invalidation so a refresh that started before a git write cannot
// repopulate the cache with pre-write output.
let generation = 0;

function norm(root: string): string {
  return path.resolve(String(root || '')).replace(/\\/g, '/').toLowerCase();
}

export function gitReadCacheKey(root: string, args: string[], ns = ''): string {
  return `${norm(root)}\u0000${ns}\u0000${args.join('\u0001')}`;
}

function store(key: string, value: string, now: number): void {
  cache.set(key, { at: now, value });
  if (cache.size > MAX_ENTRIES) {
    for (const [k, v] of cache) {
      if (now - v.at >= STALE_MAX_MS || cache.size > MAX_ENTRIES) cache.delete(k);
      if (cache.size <= MAX_ENTRIES / 2) break;
    }
  }
}

/**
 * ns separates callers whose runners post-process output differently (trimmed vs raw).
 * `refresh` (optional) must produce the same value as `run` without blocking.
 */
export function cachedGitRead(
  root: string,
  args: string[],
  run: () => string,
  ns = '',
  refresh?: () => Promise<string>,
): string {
  const key = gitReadCacheKey(root, args, ns);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  if (hit && refresh && now - hit.at < STALE_MAX_MS) {
    rememberRefresher(key, root, refresh);
    void refreshInto(key, refresh);
    return hit.value;
  }
  if (refresh) rememberRefresher(key, root, refresh);
  const value = run();
  store(key, value, now);
  return value;
}

/*
 * Cold-miss avoidance. A cold miss (first read, or an entry older than
 * STALE_MAX_MS after the panel sat idle) still has to run git synchronously,
 * which froze the whole gateway for up to 18.7 s on PromSRC (2026-10-01: the
 * health probe timed out and the relay served 503s to every other request).
 * Callers with an async refresher are remembered here, so a route can
 * `await warmGitReads(...)` before its synchronous work: every remembered read
 * that is missing or past TTL is refreshed with non-blocking child processes
 * first, and the sync path then hits the cache.
 */
const MAX_REFRESHERS = 64;
const RECENT_USE_MS = 30 * 60_000;
const WARM_CONCURRENCY = 4;
interface Refresher { root: string; refresh: () => Promise<string>; usedAt: number }
const refreshers = new Map<string, Refresher>();

function rememberRefresher(key: string, root: string, refresh: () => Promise<string>): void {
  refreshers.delete(key);
  refreshers.set(key, { root: norm(root), refresh, usedAt: Date.now() });
  while (refreshers.size > MAX_REFRESHERS) {
    const oldest = refreshers.keys().next().value;
    if (oldest === undefined) break;
    refreshers.delete(oldest);
  }
}

/*
 * Global cap on concurrent background git processes. On Windows, spawn() itself
 * blocks the event loop for ~25-30 ms per child. A thread panel that kicked
 * ~130 stale refreshes in one request spent 3.7 s of a 4.8 s "warm" response
 * inside spawn() (CPU profile, 2026-10-01). Excess refreshes queue and start
 * as earlier ones finish, so one request costs at most a few spawns.
 */
const MAX_BACKGROUND_GIT = 4;
let activeBackgroundGit = 0;
const backgroundGitQueue: Array<() => void> = [];

function acquireBackgroundGit(): Promise<void> {
  if (activeBackgroundGit < MAX_BACKGROUND_GIT) {
    activeBackgroundGit += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => backgroundGitQueue.push(() => { activeBackgroundGit += 1; resolve(); }));
}

function releaseBackgroundGit(): void {
  activeBackgroundGit = Math.max(0, activeBackgroundGit - 1);
  const next = backgroundGitQueue.shift();
  if (next) next();
}

/** Test/diagnostic hook: peak-safe view of the background git limiter. */
export function backgroundGitStats(): { active: number; queued: number; max: number } {
  return { active: activeBackgroundGit, queued: backgroundGitQueue.length, max: MAX_BACKGROUND_GIT };
}

function refreshInto(key: string, refresh: () => Promise<string>): Promise<void> {
  const pending = refreshing.get(key);
  if (pending) return pending;
  const gen = generation;
  const job = acquireBackgroundGit()
    .then(() => refresh()
      .then((value) => { if (gen === generation) store(key, value, Date.now()); })
      .catch(() => { /* leave the cache as is; the sync path still works */ })
      .finally(releaseBackgroundGit))
    .finally(() => { refreshing.delete(key); });
  refreshing.set(key, job);
  return job;
}

/*
 * Repository root lookup without spawning git. The thread panel used to run
 * `git rev-parse --show-toplevel` once per file the chat ever touched (118
 * blocking spawns, 7 s, for one long chat), and those per-directory keys also
 * evicted the `git status` refreshers that matter from the 64-slot list.
 * Walking up to the nearest `.git` entry (directory, or file for worktrees and
 * submodules) answers the same question with a few stat calls, memoized per
 * directory.
 */
const ROOT_TTL_MS = 60_000;
const ROOT_MAX_ENTRIES = 2_048;
const rootCache = new Map<string, { at: number; root: string | null }>();

export function findGitRootByWalk(startDir: string): string | null {
  const start = path.resolve(String(startDir || '.'));
  const now = Date.now();
  const visited: string[] = [];
  let current = start;
  let found: string | null = null;
  while (true) {
    const key = norm(current);
    const hit = rootCache.get(key);
    if (hit && now - hit.at < ROOT_TTL_MS) { found = hit.root; break; }
    visited.push(key);
    let marker = false;
    try { marker = fs.existsSync(path.join(current, '.git')); } catch { marker = false; }
    if (marker) { found = current; break; }
    const parent = path.dirname(current);
    if (parent === current) { found = null; break; }
    current = parent;
  }
  for (const key of visited) rootCache.set(key, { at: now, root: found });
  if (rootCache.size > ROOT_MAX_ENTRIES) {
    for (const k of rootCache.keys()) { rootCache.delete(k); if (rootCache.size <= ROOT_MAX_ENTRIES / 2) break; }
  }
  return found;
}

/**
 * Refresh, without blocking the event loop, every remembered git read that is
 * missing or past TTL. `roots` limits the warm-up to reads under those repo
 * roots (or the roots themselves); omit it to warm everything used recently.
 * Resolves when the refreshes settle or after `maxWaitMs`, whichever is first.
 */
export async function warmGitReads(roots?: string[], maxWaitMs = 20_000): Promise<number> {
  const now = Date.now();
  const wanted = (roots || []).map(norm).filter(Boolean);
  const due: Array<[string, Refresher]> = [];
  for (const [key, item] of refreshers) {
    if (now - item.usedAt > RECENT_USE_MS) continue;
    if (wanted.length && !wanted.some((root) => item.root === root || item.root.startsWith(`${root}/`) || root.startsWith(`${item.root}/`))) continue;
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL_MS) continue;
    due.push([key, item]);
  }
  if (!due.length) return 0;
  // Bounded fan-out: a cold PromSRC panel needs ~6 reads; never fork 64 gits at once.
  let next = 0;
  const lane = async () => {
    while (next < due.length) {
      const [key, item] = due[next++];
      await refreshInto(key, item.refresh);
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(WARM_CONCURRENCY, due.length) }, lane));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    all,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, maxWaitMs)); timer.unref?.(); }),
  ]);
  if (timer) clearTimeout(timer);
  return due.length;
}

/** Test hook: forget remembered refreshers and cached values. */
export function resetGitReadCacheForTests(): void {
  cache.clear();
  refreshers.clear();
  refreshing.clear();
  rootCache.clear();
  generation += 1;
}

/** Test/diagnostic hook: resolves when every in-flight background refresh settles. */
export async function settleGitReadRefreshes(): Promise<void> {
  await Promise.all([...refreshing.values()]);
}

/** Drop cached reads for a repo (or everything) after a write. */
export function invalidateGitReadCache(root?: string): void {
  generation += 1;
  if (!root) { cache.clear(); return; }
  const prefix = `${norm(root)}\u0000`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Read-only git subcommands that are safe to memo briefly. */
export function isCacheableGitRead(args: string[]): boolean {
  const sub = String(args[0] || '');
  if (sub === 'diff') return !args.includes('--no-index');
  return ['status', 'rev-parse', 'branch', 'remote', 'symbolic-ref', 'rev-list', 'log', 'ls-files'].includes(sub)
    && !args.some((a) => ['-d', '-D', '-m', '-M', 'add', 'remove', 'rename', 'set-url'].includes(a));
}

/**
 * Non-blocking git read used for background refreshes. `mode` mirrors the
 * sync runners: 'trim' returns '' on failure and trims; 'raw' keeps stdout on a
 * non-zero exit (e.g. `diff` exit 1) and does not trim.
 */
export function runGitReadAsync(
  root: string,
  args: string[],
  opts: { timeout: number; maxBuffer?: number; mode: 'trim' | 'raw' },
): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
    }, (err, stdout) => {
      const out = String(stdout || '');
      if (opts.mode === 'trim') resolve(err ? '' : out.trim());
      else resolve(out);
    });
  });
}
