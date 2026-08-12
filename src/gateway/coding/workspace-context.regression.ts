import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { getCodingWorkspaceContext, getCodingWorkspaceDiff } from './workspace-context';
import { gitCreateBranch, gitListBranches, gitStage, gitUnstage, getGitFileHistory } from './workspace-session';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-coding-context-regression-'));
const gitRoot = path.join(root, 'git');
const plainRoot = path.join(root, 'plain');
const runGit = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

try {
  fs.mkdirSync(gitRoot, { recursive: true });
  runGit(gitRoot, ['init', '-q']);
  runGit(gitRoot, ['config', 'user.email', 'test@example.com']);
  runGit(gitRoot, ['config', 'user.name', 'Prometheus Regression']);
  const changedPath = path.join(gitRoot, 'example.ts');
  fs.writeFileSync(changedPath, 'const value = 1;\n');
  runGit(gitRoot, ['add', 'example.ts']);
  runGit(gitRoot, ['commit', '-qm', 'initial']);
  fs.writeFileSync(changedPath, 'const value = 2;\n');

  const gitContext = getCodingWorkspaceContext({ root: gitRoot, scope: 'project' });
  assert.equal(gitContext.repositories[0]?.vcs?.kind, 'git');
  assert.ok(gitContext.files.some((file) => file.displayPath === 'example.ts' && file.unstaged));
  const gitDiff = getCodingWorkspaceDiff({ root: gitRoot, file: changedPath });
  assert.ok(gitDiff.diff.includes('-const value = 1;'));
  assert.ok(gitDiff.diff.includes('+const value = 2;'));
  assert.equal(getGitFileHistory(gitRoot, 'example.ts')[0]?.message, 'initial');
  gitStage(gitRoot, ['example.ts']);
  assert.equal(getCodingWorkspaceContext({ root: gitRoot, scope: 'project' }).files[0]?.staged, true);
  gitUnstage(gitRoot, ['example.ts']);
  gitCreateBranch(gitRoot, 'feature/regression');
  assert.ok(gitListBranches(gitRoot).some((branch) => branch.name === 'feature/regression' && branch.current));
  assert.throws(() => gitStage(gitRoot, ['../outside.txt']), /outside/);

  const snapshotDir = path.join(plainRoot, '.prometheus', 'history', 'snapshots', 'snap_test');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const targetPath = path.join(plainRoot, 'note.md');
  const beforePath = path.join(snapshotDir, 'before');
  fs.writeFileSync(beforePath, 'before\n');
  fs.writeFileSync(targetPath, 'after\n');
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify({
    id: 'snap_test', kind: 'file', targetPath, existed: true, contentPath: beforePath, createdAt: Date.now(),
  }));
  const snapshotDiff = getCodingWorkspaceDiff({ root: plainRoot, file: targetPath });
  assert.equal(snapshotDiff.baselineKind, 'session-snapshot');
  assert.ok(snapshotDiff.diff.includes('-before'));
  assert.ok(snapshotDiff.diff.includes('+after'));

  const observedPath = path.join(plainRoot, 'observed.txt');
  fs.writeFileSync(observedPath, 'observed\n');
  const observedDiff = getCodingWorkspaceDiff({ root: plainRoot, file: observedPath });
  assert.equal(observedDiff.baselineKind, 'none');
  assert.equal(observedDiff.insertions, 0);
  assert.equal(observedDiff.deletions, 0);

  const unbound = getCodingWorkspaceContext({ sessionId: 'unbound-thread-regression', scope: 'thread' });
  assert.equal(unbound.roots.length, 0);
  assert.equal(unbound.repositories.length, 0);
  console.log('workspace-context regression: Git/non-Git diffs, scope isolation, history, branch, staging, and path safety passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
