/**
 * Background git reads must never write .git/index.
 *
 * Porcelain `git diff` (worktree side) refreshes stat info and rewrites
 * .git/index even with GIT_OPTIONAL_LOCKS=0 / --no-optional-locks (verified on
 * git 2.54.0.windows.1). When a short timeout kills it mid-write, a stale
 * .git/index.lock is left behind and the next pull/commit fails. That blocked
 * five PromSRC deploys in a row on 2026-10-13. Plumbing diff-files/diff-index
 * give the same output without touching the index.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitDiff } from './workspace-session';
import { invalidateGitReadCache } from './git-read-cache';

const SRC = path.resolve(__dirname, '..', '..');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.regression.ts')) out.push(full);
  }
  return out;
}

function main(): void {
  // 1. Behavior: stat-dirty files + a real change. getGitDiff must return the
  //    change and leave .git/index untouched.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-no-index-write-'));
  try {
    git(dir, ['init', '-q']);
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), `x${i}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    fs.appendFileSync(path.join(dir, 'f3.txt'), 'changed\n');
    sleep(1100);
    const now = new Date();
    for (let i = 0; i < 12; i++) fs.utimesSync(path.join(dir, `f${i}.txt`), now, now);

    const indexPath = path.join(dir, '.git', 'index');
    const before = fs.statSync(indexPath).mtimeMs;
    invalidateGitReadCache();
    const diff = getGitDiff(dir);
    assert.match(diff, /\+changed/, 'diff still reports the real change');
    assert.equal((diff.match(/^diff --git/gm) || []).length, 1, 'stat-only touches are not reported as changes');
    assert.equal(fs.statSync(indexPath).mtimeMs, before, 'getGitDiff must not rewrite .git/index');
    assert.equal(fs.existsSync(path.join(dir, '.git', 'index.lock')), false, 'no index.lock left behind');

    // Control: porcelain diff DOES rewrite the index, which is why it is banned below.
    const ctrlBefore = fs.statSync(indexPath).mtimeMs;
    sleep(1100);
    for (let i = 0; i < 12; i++) fs.utimesSync(path.join(dir, `f${i}.txt`), new Date(), new Date());
    git(dir, ['diff', '--stat']);
    if (fs.statSync(indexPath).mtimeMs === ctrlBefore) {
      console.log('note: this git build no longer rewrites the index on porcelain diff (control skipped)');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 2. Guard: runtime code must not use porcelain worktree diffs. Allowed:
  //    'diff', '--cached' (index vs HEAD, never refreshes), '--no-index', and the
  //    conflict probe in prom-repo-sync (runs inside a user-initiated pull).
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /\[\s*(?:'-c',\s*'[^']*',\s*)?'diff',\s*([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const rest = m[1];
      if (/'--cached'|'--no-index'|'--diff-filter=U'/.test(rest)) continue;
      const before = text.slice(Math.max(0, m.index - 160), m.index);
      if (/enum:|description/.test(before.slice(-80))) continue;
      // Explicit opt-out for diffs that never touch the worktree (commit..commit).
      if (/git-index-safe/.test(before)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(SRC, file)}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], `porcelain worktree git diff in runtime code (use diff-files/diff-index):\n${offenders.join('\n')}`);
  console.log('git-no-index-write regression passed');
}

main();
