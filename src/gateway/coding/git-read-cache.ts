/**
 * git-read-cache.ts
 *
 * Short-lived memo for read-only git invocations used by the Sources/coding
 * panel. One panel refresh used to run `git status` three times per repo
 * (~1.3s each on a large worktree), synchronously on the gateway thread, and
 * every panel refresh repeated it. Reads are now shared for a few seconds and
 * any git write through Prometheus clears the cache for that repo.
 */
import path from 'node:path';

const TTL_MS = 4_000;
const MAX_ENTRIES = 256;

interface Entry { at: number; value: string }
const cache = new Map<string, Entry>();

function norm(root: string): string {
  return path.resolve(String(root || '')).replace(/\\/g, '/').toLowerCase();
}

export function gitReadCacheKey(root: string, args: string[], ns = ''): string {
  return `${norm(root)}\u0000${ns}\u0000${args.join('\u0001')}`;
}

/** ns separates callers whose runners post-process output differently (trimmed vs raw). */
export function cachedGitRead(root: string, args: string[], run: () => string, ns = ''): string {
  const key = gitReadCacheKey(root, args, ns);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = run();
  cache.set(key, { at: now, value });
  if (cache.size > MAX_ENTRIES) {
    for (const [k, v] of cache) {
      if (now - v.at >= TTL_MS || cache.size > MAX_ENTRIES) cache.delete(k);
      if (cache.size <= MAX_ENTRIES / 2) break;
    }
  }
  return value;
}

/** Drop cached reads for a repo (or everything) after a write. */
export function invalidateGitReadCache(root?: string): void {
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
