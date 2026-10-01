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
    if (!refreshing.has(key)) {
      const gen = generation;
      const job = refresh()
        .then((value) => { if (gen === generation) store(key, value, Date.now()); })
        .catch(() => { /* keep the stale value; the next call retries */ })
        .finally(() => { refreshing.delete(key); });
      refreshing.set(key, job);
    }
    return hit.value;
  }
  const value = run();
  store(key, value, now);
  return value;
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
