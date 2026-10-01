import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveSourceIssues, parseRealDiffNumstat, readLiveSourceState, inspectIndexLock } from './live-source-state';

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

// 1. numstat parsing drops line-ending-only rows (0/0) and keeps real changes.
assert.deepEqual(parseRealDiffNumstat('0\t0\tgenerated/a.js\n3\t1\tsrc/b.ts\n-\t-\tassets/c.png\n'), ['src/b.ts', 'assets/c.png']);

// 2. Real temp repo: clean -> no issues; real edit + untracked src -> warning; EOL-only -> ignored.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-live-src-'));
try {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');

  let state = readLiveSourceState({ root, force: true });
  assert.ok(state);
  assert.equal(state!.branch, 'main');
  assert.deepEqual(state!.dirtyFiles, []);
  assert.deepEqual(liveSourceIssues(state), [], 'clean checkout has no issues');

  // EOL-only change must not count as dirty.
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\r\nexport const b = 2;\r\n');
  state = readLiveSourceState({ root, force: true });
  assert.deepEqual(state!.dirtyFiles, [], 'line-ending-only diffs are ignored');

  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 42;\nexport const b = 2;\n');
  fs.writeFileSync(path.join(root, 'src', 'new.ts'), 'export {};\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'scratch\n');
  state = readLiveSourceState({ root, force: true });
  assert.deepEqual(state!.dirtyFiles, ['src/a.ts']);
  assert.deepEqual(state!.untrackedSourceFiles, ['src/new.ts'], 'only untracked files under source dirs count');
  const issues = liveSourceIssues(state);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'live_source_uncommitted');
  assert.match(issues[0].summary, /2 uncommitted source change/);
  assert.ok(!/\u2014/.test(issues[0].summary), 'no em dashes in user-facing text');

  // Probing must not leave an index.lock behind.
  assert.equal(fs.existsSync(path.join(root, '.git', 'index.lock')), false, 'read-only probe leaves no index.lock');

  // 3. Stale index.lock detection.
  const lock = path.join(root, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  const old = (Date.now() - 20 * 60_000) / 1000;
  fs.utimesSync(lock, old, old);
  const lockState = inspectIndexLock(path.join(root, '.git'), Date.now());
  assert.equal(lockState.exists, true);
  assert.equal(lockState.stale, true);
  assert.equal(inspectIndexLock(path.join(root, '.git'), Date.now() - 19 * 60_000).stale, false, 'fresh lock is not stale');
  state = readLiveSourceState({ root, force: true });
  assert.ok(liveSourceIssues(state).some((i) => i.code === 'live_source_stale_index_lock'));

  // 4. Non-git directory (packaged install) -> null, no issues.
  assert.equal(readLiveSourceState({ root: null, force: true }), null);
  assert.deepEqual(liveSourceIssues(null), []);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('live source state regression passed');
