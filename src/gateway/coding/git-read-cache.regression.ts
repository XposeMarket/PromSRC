import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  backgroundGitStats,
  cachedGitRead,
  findGitRootByWalk,
  invalidateGitReadCache,
  runGitReadAsync,
  settleGitReadRefreshes,
} from './git-read-cache';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

async function main(): Promise<void> {
  // 1. Fresh hit inside TTL never runs anything.
  let syncRuns = 0;
  let asyncRuns = 0;
  const run = () => { syncRuns += 1; return `sync-${syncRuns}`; };
  const refresh = async () => { asyncRuns += 1; await new Promise((r) => setTimeout(r, 20)); return `async-${asyncRuns}`; };
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-1', 'cold miss runs sync');
  clock += 1_000;
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-1', 'fresh hit');
  assert.equal(syncRuns, 1);

  // 2. Past TTL: stale value returned immediately, one shared background refresh, no sync run.
  clock += 5_000;
  const t0 = realNow();
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-1', 'stale value served');
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-1', 'stale value served again');
  assert.ok(realNow() - t0 < 15, 'stale read must not wait for the refresh');
  assert.equal(syncRuns, 1, 'no blocking run on a stale hit');
  await settleGitReadRefreshes();
  assert.equal(asyncRuns, 1, 'concurrent stale reads share one refresh');
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'async-1', 'refreshed value lands');

  // 3. A refresh that started before invalidation must not repopulate the cache.
  clock += 5_000;
  cachedGitRead('/repo-a', ['status'], run, 't', refresh); // kicks refresh #2
  invalidateGitReadCache('/repo-a');
  await settleGitReadRefreshes();
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-2', 'post-write read is fresh, not the racing refresh');

  // 4. Too stale (> 60 s) falls back to a sync read rather than serving ancient data.
  clock += 120_000;
  assert.equal(cachedGitRead('/repo-a', ['status'], run, 't', refresh), 'sync-3');

  // 5. Callers without a refresher keep the old behavior (sync on expiry).
  clock += 5_000;
  let plain = 0;
  cachedGitRead('/repo-b', ['log'], () => `p${++plain}`);
  clock += 5_000;
  assert.equal(cachedGitRead('/repo-b', ['log'], () => `p${++plain}`), 'p2');

  // 6. Background refreshes are globally capped (spawn() blocks the loop on Windows).
  clock += 5_000;
  let peak = 0;
  const slow = (i: number) => async () => {
    peak = Math.max(peak, backgroundGitStats().active);
    await new Promise((r) => setTimeout(r, 15));
    return `bulk-${i}`;
  };
  for (let i = 0; i < 12; i += 1) cachedGitRead(`/bulk-${i}`, ['status'], () => `seed-${i}`, 't', slow(i));
  clock += 5_000;
  for (let i = 0; i < 12; i += 1) assert.equal(cachedGitRead(`/bulk-${i}`, ['status'], () => 'x', 't', slow(i)), `seed-${i}`, 'stale served while queued');
  assert.ok(backgroundGitStats().queued > 0, 'excess refreshes queue instead of spawning at once');
  await settleGitReadRefreshes();
  assert.ok(peak <= backgroundGitStats().max, `peak concurrent background git ${peak} <= cap`);
  assert.equal(backgroundGitStats().active, 0, 'limiter drains');
  assert.equal(cachedGitRead('/bulk-11', ['status'], () => 'x', 't', slow(11)), 'bulk-11', 'queued refresh still lands');

  // 7. Async runner matches sync output shapes on a real repo.
  Date.now = realNow;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gitcache-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const syncOut = execFileSync('git', ['status', '--porcelain=v1'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(await runGitReadAsync(dir, ['status', '--porcelain=v1'], { timeout: 10_000, mode: 'raw' }), syncOut);
    assert.equal(await runGitReadAsync(dir, ['status', '--porcelain=v1'], { timeout: 10_000, mode: 'trim' }), syncOut.trim());
    assert.equal(await runGitReadAsync(dir, ['not-a-command'], { timeout: 10_000, mode: 'trim' }), '', 'trim mode swallows failures');

    // 8. Root lookup by filesystem walk matches `git rev-parse --show-toplevel`
    //    for nested dirs, a linked worktree (.git file) and a non-repo dir.
    const toplevel = (cwd: string) => {
      try { return path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
      catch { return null; }
    };
    const nested = path.join(dir, 'src', 'deep', 'er');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findGitRootByWalk(nested), toplevel(nested), 'nested dir resolves to repo root');
    assert.equal(findGitRootByWalk(dir), toplevel(dir), 'repo root resolves to itself');
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, windowsHide: true });
    const wt = `${dir}-wt`;
    execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: dir, windowsHide: true });
    try {
      fs.mkdirSync(path.join(wt, 'pkg'), { recursive: true });
      assert.equal(findGitRootByWalk(path.join(wt, 'pkg')), toplevel(path.join(wt, 'pkg')), 'linked worktree (.git file) resolves to the worktree');
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: dir, windowsHide: true });
      fs.rmSync(wt, { recursive: true, force: true });
    }
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-nogit-'));
    try {
      if (toplevel(plain) === null) assert.equal(findGitRootByWalk(plain), null, 'non-repo dir has no root');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('git read cache regression passed (fresh hit, stale-while-revalidate, shared refresh, invalidation race, stale cap, background cap, async parity, root walk)');
}

main().catch((err) => { console.error(err); process.exit(1); });
