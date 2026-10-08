// Regression: watcher generation + barrier, and the tracker fast path
// (reused baseline, unchanged finalize) never hides a real change.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTerminalWorkspaceTracker, isTerminalTrackerExcludedPath } from './terminal-change-tracker';
import { __resetWorkspaceWatchForTests, ensureWorkspaceWatch, workspaceWatchBarrier, workspaceWatchGeneration, workspaceWatchSupported } from './workspace-watch';

async function main(): Promise<void> {
  if (!workspaceWatchSupported()) {
    console.log('workspace-watch regression: skipped (platform)');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-watch-'));
  try {
    fs.mkdirSync(path.join(root, '.prometheus'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    assert.equal(ensureWorkspaceWatch(root, isTerminalTrackerExcludedPath), true);
    assert.equal(await workspaceWatchBarrier(root), true, 'barrier must observe its sentinel');
    const g0 = workspaceWatchGeneration(root);
    assert.equal(typeof g0, 'number');

    // Barriers and excluded-dir writes do not bump the generation.
    assert.equal(await workspaceWatchBarrier(root), true);
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x');
    assert.equal(await workspaceWatchBarrier(root), true);
    assert.equal(workspaceWatchGeneration(root), g0, 'excluded paths and sentinels must not count as changes');

    // A real write is visible immediately after the barrier (no sleep).
    fs.writeFileSync(path.join(root, 'a.txt'), 'two');
    assert.equal(await workspaceWatchBarrier(root), true);
    const g1 = workspaceWatchGeneration(root)!;
    assert.ok(g1 > g0!, 'write before barrier must bump generation');

    // Nested new file too.
    fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'b.txt'), 'b');
    assert.equal(await workspaceWatchBarrier(root), true);
    assert.ok(workspaceWatchGeneration(root)! > g1, 'nested write must bump generation');

    // Barrier refuses to create .prometheus in a repo that lacks it.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-watch-bare-'));
    ensureWorkspaceWatch(bare, isTerminalTrackerExcludedPath);
    assert.equal(await workspaceWatchBarrier(bare), false);
    assert.equal(fs.existsSync(path.join(bare, '.prometheus')), false);

    // Tracker fast path: reused baseline + real change is still reported.
    const first = createTerminalWorkspaceTracker({ workspacePath: root, cwd: root, command: 'x' }, { gitRoot: null })!;
    const unchanged = first.finalize({ unchanged: true });
    assert.equal(unchanged.workspaceChanges.length, 0);
    const second = createTerminalWorkspaceTracker({ workspacePath: root, cwd: root, command: 'x' }, { gitRoot: null, baseline: first.baselineCapture })!;
    fs.writeFileSync(path.join(root, 'a.txt'), 'three');
    fs.writeFileSync(path.join(root, 'c.txt'), 'new');
    const changed = second.finalize();
    const names = changed.workspaceChanges.map((change) => `${change.status}:${change.displayPath}`).sort();
    assert.deepEqual(names, ['added:c.txt', 'modified:a.txt'], `reused baseline must still diff correctly, got ${names.join(',')}`);

    // A hint the cached capture lacks forces a fresh walk (no reuse).
    fs.writeFileSync(path.join(root, 'hinted.txt'), 'h');
    const third = createTerminalWorkspaceTracker({ workspacePath: root, cwd: root, command: 'Set-Content hinted.txt z' }, { gitRoot: null, baseline: first.baselineCapture })!;
    assert.ok(third.baselineCapture.files.size > first.baselineCapture.files.size, 'missing hint must trigger a fresh capture');
    __resetWorkspaceWatchForTests();
    fs.rmSync(bare, { recursive: true, force: true });
    console.log('workspace-watch regression: ok');
  } finally {
    __resetWorkspaceWatchForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
