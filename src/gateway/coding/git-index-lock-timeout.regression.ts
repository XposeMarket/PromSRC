import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { lockFreeGitReadOptions } from '../../runtime/git-read';
import { runGitReadAsync } from './git-read-cache';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main(): Promise<void> {
  const options = lockFreeGitReadOptions(['status', '--porcelain=v1'], { PATH: process.env.PATH, PROM_TEST: 'preserved' });
  assert.deepEqual(options.args.slice(0, 2), ['--no-optional-locks', 'status']);
  assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(options.env.PROM_TEST, 'preserved');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-git-index-timeout-'));
  try {
    git(root, ['init', '-q']);
    // Make status slow enough that the 1ms timeout interrupts its traversal on
    // ordinary machines, after the index contains many stat-cache entries.
    for (let i = 0; i < 900; i += 1) fs.writeFileSync(path.join(root, `tracked-${i}.txt`), `initial-${i}\n`);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.email=regression@example.invalid', '-c', 'user.name=Regression', 'commit', '-qm', 'seed']);
    const future = new Date(Date.now() + 120_000);
    for (let i = 0; i < 900; i += 1) fs.utimesSync(path.join(root, `tracked-${i}.txt`), future, future);
    // A real content change so the successful status read has something to report
    // (touching mtime alone leaves content identical, which status correctly hides).
    fs.writeFileSync(path.join(root, 'tracked-0.txt'), 'changed-0\n');

    const lockPath = path.join(root, '.git', 'index.lock');
    const out = await runGitReadAsync(root, ['status', '--porcelain=v1', '--untracked-files=all'], { timeout: 1, mode: 'raw' });
    assert.equal(out, '', 'timed-out status should not return partial stdout');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fs.existsSync(lockPath), false, 'a timed-out helper Git read must not leave .git/index.lock');

    const status = await runGitReadAsync(root, ['status', '--porcelain=v1', '--untracked-files=all'], { timeout: 30_000, mode: 'raw' });
    assert.ok(status.includes(' M tracked-'), 'the real helper still returns status output for successful reads');
    assert.equal(fs.existsSync(lockPath), false, 'successful lock-free status must not leave .git/index.lock');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('git index-lock timeout regression passed (env/args, timed-out large-repo status, successful status)');
}

main().catch((error) => { console.error(error); process.exit(1); });
