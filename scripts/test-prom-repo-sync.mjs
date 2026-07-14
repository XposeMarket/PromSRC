import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executePromRepoSyncTool } from '../dist/gateway/prom-repo-sync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-repo-sync-'));
const remote = path.join(root, 'remote.git');
const repo = path.join(root, 'repo');
const configDir = path.join(root, 'config');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

try {
  fs.mkdirSync(repo, { recursive: true });
  git(root, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Prometheus Test');
  git(repo, 'config', 'user.email', 'prometheus-test@example.invalid');
  fs.writeFileSync(path.join(repo, 'source.txt'), 'one\n');
  git(repo, 'add', 'source.txt');
  git(repo, 'commit', '-m', 'seed');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');

  fs.mkdirSync(path.join(repo, 'workspace', 'temp'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'project', 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'source.txt'), 'two\n');
  fs.writeFileSync(path.join(repo, 'workspace', 'temp', 'tool-result.txt'), 'local only\n');
  fs.writeFileSync(path.join(repo, 'project', 'node_modules', 'pkg', 'index.js'), 'ignored\n');

  const beforePreviewIndex = git(repo, 'diff', '--cached', '--name-only');
  const preview = await executePromRepoSyncTool({ name: 'prom_repo_push', args: {}, repoRoot: repo, configDir });
  assert.equal(preview.ok, true);
  assert.match(preview.message, /Read-only Prometheus repo sync preview/);
  assert.match(preview.message, /source\.txt/);
  assert.match(preview.message, /workspace\/temp/);
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), beforePreviewIndex, 'preview must not mutate the index');

  const lockPath = path.join(repo, '.git', 'prom-repo-sync.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const locked = await executePromRepoSyncTool({
    name: 'prom_repo_push',
    args: { message: 'should not commit' },
    repoRoot: repo,
    configDir,
  });
  assert.equal(locked.ok, false);
  assert.match(locked.message, /already running/);
  fs.rmSync(lockPath, { force: true });

  const pushed = await executePromRepoSyncTool({
    name: 'prom_repo_push',
    args: { message: 'Update source through Prometheus sync' },
    repoRoot: repo,
    configDir,
  });
  assert.equal(pushed.ok, true, pushed.message);
  assert.match(pushed.message, /Stable staging passes/);
  assert.equal(git(repo, 'show', 'HEAD:source.txt'), 'two');
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), '');
  assert.equal(fs.existsSync(path.join(repo, 'workspace', 'temp', 'tool-result.txt')), true);
  assert.equal(fs.existsSync(path.join(repo, 'project', 'node_modules', 'pkg', 'index.js')), true);
  assert.match(git(repo, 'status', '--porcelain=v1'), /workspace\/temp|project/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'refs/heads/main'));

  fs.writeFileSync(path.join(repo, 'leak.txt'), `github_pat_${'A'.repeat(40)}\n`);
  const blockedSecret = await executePromRepoSyncTool({
    name: 'prom_repo_push',
    args: { message: 'must be blocked' },
    repoRoot: repo,
    configDir,
  });
  assert.equal(blockedSecret.ok, false);
  assert.match(blockedSecret.message, /Secret scan blocked/);
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), '', 'failed safety gate must restore a clean index');
  assert.equal(fs.existsSync(path.join(repo, '.git', 'prom-repo-sync.lock')), false, 'lock must always be released');

  console.log('prom repo sync regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
