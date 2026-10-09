import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export {};

// Regressions for the four goal-system friction items found in the 2026-10-09
// legacy-cleanup goal run (reviews/legacy-audit-2026-10-07/tests-pass/GOAL-SYSTEM-BUGS.md).

import {
  digestPollResult,
  isPollingToolCall,
  POLL_LOOP_CRITICAL_THRESHOLD,
  POLL_LOOP_WARNING_THRESHOLD,
} from './tool-loop-identity';
import { compactBackgroundFileChanges, compactBackgroundToolPayload } from '../tasks/task-runner';
import { buildNpmShimScripts, findNodeNpmInstall, withNpmShimsOnPath, resetNpmShimCacheForTests } from '../process/npm-shims';
import { resolveBackgroundWorkDirArg } from '../agents-runtime/background-work-dir';
import { runWithWorkspace } from '../../tools/workspace-context';

// 1. Loop detector: polling a long-running run is not an identical-call loop.
assert.equal(isPollingToolCall('workspace_run', { action: 'wait', runId: 'run_1' }), true);
assert.equal(isPollingToolCall('workspace_run', { action: 'status', runId: 'run_1' }), true);
assert.equal(isPollingToolCall('workspace_run', { action: 'wait' }), false, 'wait without a runId is not a poll');
assert.equal(isPollingToolCall('workspace_run', { action: 'run', command: 'git status' }), false);
assert.equal(isPollingToolCall('background_ops', { action: 'wait' }), true);
assert.equal(isPollingToolCall('background_ops', { action: 'spawn' }), false);
assert.equal(isPollingToolCall('process_wait', { runId: 'x' }), true);
assert.equal(isPollingToolCall('read_file', { filename: 'a' }), false);
assert.equal(
  digestPollResult('run_1 is running after 30s. (no output yet)'),
  digestPollResult('run_1 is running after 60s. (no output yet)'),
  'elapsed-time changes alone must count as a stale poll',
);
assert.notEqual(digestPollResult('running\npass 1/4'), digestPollResult('running\nFAIL x'));
assert.ok(POLL_LOOP_WARNING_THRESHOLD >= 10 && POLL_LOOP_CRITICAL_THRESHOLD > POLL_LOOP_WARNING_THRESHOLD);
const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chat.router.ts'), 'utf8');
assert.match(router, /isPollingToolCall\(toolName, args\)/, 'checkLoopDetection must route polls to the stale-result counter');
assert.match(router, /notePollResult\(toolName, toolArgs, toolResult\?\.result\)/, 'poll results must feed the stale-result counter');
assert.match(router, /toolName\.startsWith\('desktop_'\) \|\| isPollingToolCall\(toolName, toolArgs\)/, 'duplicate-call skip must exempt polls');

// 2. Background tool payloads carry counts + paths, never diff bodies.
const bigDiff = 'x'.repeat(20_000);
const fileChanges = {
  summary: { fileCount: 2, insertions: 10, deletions: 3 },
  files: [
    { path: 'a.ts', displayPath: 'src/a.ts', status: 'modified', insertions: 7, deletions: 3, diffPreview: bigDiff },
    { path: 'b.ts', status: 'added', insertions: 3, deletions: 0, diffPreview: bigDiff },
  ],
};
const compact = compactBackgroundFileChanges(fileChanges);
assert.equal(compact.files.length, 2);
assert.equal(compact.files[0].path, 'src/a.ts');
assert.ok(!JSON.stringify(compact).includes('xxxxxxxxxx'), 'diffPreview must be stripped');
const waitPayload = compactBackgroundToolPayload({ statuses: [{ id: 'bg_1', fileChanges }], completed: true });
assert.ok(JSON.stringify(waitPayload).length < 2_000, `wait payload should be small, got ${JSON.stringify(waitPayload).length}`);
assert.equal(fileChanges.files[0].diffPreview, bigDiff, 'compaction must not mutate the stored record');
const many = compactBackgroundFileChanges({ files: Array.from({ length: 60 }, (_, i) => ({ path: `f${i}.ts`, insertions: 1 })) });
assert.equal(many.files.length, 40);
assert.equal(many.omittedFiles, 20);
assert.equal(many.summary.fileCount, 60);

// 3. npx/npm shims call node + npm CLI by absolute path.
const fakeNode = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-fake-node-'));
fs.mkdirSync(path.join(fakeNode, 'node_modules', 'npm', 'bin'), { recursive: true });
for (const f of ['node.exe', 'node_modules/npm/bin/npm-cli.js', 'node_modules/npm/bin/npx-cli.js']) fs.writeFileSync(path.join(fakeNode, f), '');
const install = findNodeNpmInstall(`C:\\nope;"${fakeNode}"`);
assert.ok(install && install.nodeDir === fakeNode, 'must find the node install on PATH');
const scripts = buildNpmShimScripts(install!);
assert.ok(scripts.npx.includes(`"${path.join(fakeNode, 'node.exe')}"`) && scripts.npx.includes('npx-cli.js" %*'));
assert.ok(!scripts.npx.includes('%~dp0'), 'shim must not depend on %~dp0');
if (process.platform === 'win32') {
  resetNpmShimCacheForTests();
  const shimBase = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-shim-base-'));
  const next = withNpmShimsOnPath(fakeNode, shimBase);
  const shimDir = path.join(shimBase, 'prometheus-npm-shims');
  assert.equal(next.split(';')[0], shimDir, 'shim dir goes first on PATH');
  assert.ok(fs.existsSync(path.join(shimDir, 'npx.cmd')) && fs.existsSync(path.join(shimDir, 'npm.cmd')));
  assert.equal(withNpmShimsOnPath(next, shimBase), next, 'idempotent');
  resetNpmShimCacheForTests();
}

// 4. background_spawn work_dir: validated against allowed roots and scopes relative paths.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-workdir-'));
const worktree = path.join(root, 'wt');
fs.mkdirSync(worktree);
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-outside-'));
async function checkWorkDirScope(): Promise<void> {
await runWithWorkspace(root, async () => {
  const ok = resolveBackgroundWorkDirArg(worktree, root);
  assert.equal(ok.error, undefined);
  assert.equal(ok.workDir, path.resolve(worktree));
  assert.ok(ok.allowedWorkPaths?.includes(path.resolve(root)), 'spawner workspace stays reachable for reports');
  assert.equal(resolveBackgroundWorkDirArg('wt', root).workDir, path.resolve(worktree), 'relative work_dir resolves against the spawner workspace');
  assert.match(String(resolveBackgroundWorkDirArg(outside, root).error), /outside the allowed directories/);
  assert.match(String(resolveBackgroundWorkDirArg(path.join(root, 'missing'), root).error), /not found/);
  return null;
}, [root]);
}
assert.deepEqual(resolveBackgroundWorkDirArg('', root), {}, 'no work_dir keeps today\'s behavior');
const runner = fs.readFileSync(path.join(__dirname, '..', 'tasks', 'task-runner.ts'), 'utf8');
assert.match(runner, /runWithWorkspace\(record\.workDir, fn, record\.allowedWorkPaths\)/, 'workers must run inside the work_dir scope');
assert.match(runner, /if \(record\.workDir\) setWorkspace\(sessionId, record\.workDir\)/);

checkWorkDirScope().then(
  () => console.log('goal-runtime-friction regression: ok'),
  (error) => { console.error(error); process.exit(1); },
);
