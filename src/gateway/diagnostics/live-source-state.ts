import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Live-source drift guard.
 *
 * The gateway runs straight from a git checkout in dev installs. Twice (2026-09-30
 * and 2026-10-01) real edits sat uncommitted in that checkout and only reached
 * main because someone noticed by hand, and a stale `.git/index.lock` blocked
 * pulls three times. This reports both as diagnostics issues so they surface
 * before they bite. Packaged installs (no `.git`) return null and add nothing.
 */

export type LiveSourceState = {
  repoRoot: string;
  branch: string | null;
  head: string | null;
  originMain: string | null;
  ahead: number | null;
  behind: number | null;
  /** Tracked files with real content changes (line-ending-only diffs ignored). */
  dirtyFiles: string[];
  /** Untracked files under source directories. */
  untrackedSourceFiles: string[];
  indexLock: { exists: boolean; ageMs: number | null; sizeBytes: number | null; stale: boolean };
  checkedAt: number;
  error?: string;
};

const SOURCE_DIRS = /^(src|web-ui\/src|electron|scripts)\//;
const STALE_LOCK_MS = 5 * 60_000;
const CACHE_MS = 60_000;
let cache: { root: string; at: number; value: LiveSourceState | null } | null = null;

export function resolveLiveRepoRoot(startDir: string = __dirname): string | null {
  const override = String(process.env.PROMETHEUS_LIVE_SOURCE_ROOT || '').trim();
  if (override) return fs.existsSync(path.join(override, '.git')) ? override : null;
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.git')) && fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || '');
}

function lines(value: string | null): string[] {
  return String(value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function inspectIndexLock(gitDir: string, now: number) {
  const file = path.join(gitDir, 'index.lock');
  try {
    const st = fs.statSync(file);
    const ageMs = Math.max(0, now - st.mtimeMs);
    return { exists: true, ageMs, sizeBytes: st.size, stale: ageMs > STALE_LOCK_MS };
  } catch {
    return { exists: false, ageMs: null, sizeBytes: null, stale: false };
  }
}

/** Parse `git diff --numstat --ignore-cr-at-eol` output, dropping EOL-only (0/0) rows. */
export function parseRealDiffNumstat(numstat: string): string[] {
  return lines(numstat)
    .map((row) => row.split('\t'))
    .filter((cols) => cols.length >= 3 && !(cols[0] === '0' && cols[1] === '0'))
    .map((cols) => cols.slice(2).join('\t'));
}

export function readLiveSourceState(options: { root?: string | null; now?: number; force?: boolean } = {}): LiveSourceState | null {
  const now = options.now ?? Date.now();
  const root = options.root === undefined ? resolveLiveRepoRoot() : options.root;
  if (!root) return null;
  if (!options.force && cache && cache.root === root && now - cache.at < CACHE_MS) return cache.value;
  const gitDir = path.join(root, '.git');
  const state: LiveSourceState = {
    repoRoot: root, branch: null, head: null, originMain: null, ahead: null, behind: null,
    dirtyFiles: [], untrackedSourceFiles: [], indexLock: inspectIndexLock(gitDir, now), checkedAt: now,
  };
  try {
    state.branch = lines(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']))[0] || null;
    state.head = lines(git(root, ['rev-parse', '--short=9', 'HEAD']))[0] || null;
    state.originMain = lines(git(root, ['rev-parse', '--short=9', 'refs/remotes/origin/main']))[0] || null;
    const counts = lines(git(root, ['rev-list', '--left-right', '--count', 'refs/remotes/origin/main...HEAD']))[0];
    if (counts) {
      const [behind, ahead] = counts.split(/\s+/).map((n) => Number(n));
      state.behind = Number.isFinite(behind) ? behind : null;
      state.ahead = Number.isFinite(ahead) ? ahead : null;
    }
    // Read-only commands; --no-optional-locks keeps git from taking index.lock to refresh stat info.
    state.dirtyFiles = parseRealDiffNumstat(git(root, ['--no-optional-locks', 'diff', '--ignore-cr-at-eol', '--numstat', 'HEAD']) || '')
      .filter((file) => !file.startsWith('generated/'));
    state.untrackedSourceFiles = lines(git(root, ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard']))
      .filter((file) => SOURCE_DIRS.test(file));
  } catch (err: any) {
    state.error = String(err?.message || err);
  }
  cache = { root, at: now, value: state };
  return state;
}

export function liveSourceIssues(state: LiveSourceState | null): any[] {
  if (!state) return [];
  const issues: any[] = [];
  const unshipped = [...state.dirtyFiles, ...state.untrackedSourceFiles];
  if (unshipped.length) {
    issues.push({
      code: 'live_source_uncommitted', severity: 'warning', subsystem: 'source',
      summary: `The live checkout has ${unshipped.length} uncommitted source change(s) that are not on main (${unshipped.slice(0, 5).join(', ')}${unshipped.length > 5 ? ', ...' : ''}). Move them into a PR so they are not lost on the next pull.`,
    });
  }
  if ((state.ahead || 0) > 0) {
    issues.push({ code: 'live_source_ahead_of_main', severity: 'warning', subsystem: 'source', summary: `The live checkout has ${state.ahead} local commit(s) not on origin/main.` });
  }
  if (state.branch && state.branch !== 'main' && state.branch !== 'HEAD') {
    issues.push({ code: 'live_source_not_main', severity: 'warning', subsystem: 'source', summary: `The live checkout is on branch ${state.branch}, not main.` });
  }
  if (state.indexLock.stale) {
    issues.push({
      code: 'live_source_stale_index_lock', severity: 'warning', subsystem: 'source',
      summary: `A stale .git/index.lock (${Math.round((state.indexLock.ageMs || 0) / 60_000)} min old, ${state.indexLock.sizeBytes} bytes) will block the next pull. If no git process is running, delete it.`,
    });
  }
  return issues;
}

export function resetLiveSourceStateCache(): void {
  cache = null;
}
