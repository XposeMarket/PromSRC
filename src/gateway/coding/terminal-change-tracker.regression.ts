import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createTerminalWorkspaceTracker, type TerminalWorkspaceChangeResult } from './terminal-change-tracker';
import { collectTurnFileChangesFromProcessEntries } from '../file-change-summary';
import { ProcessSupervisor } from '../process/supervisor';
import { ProcessRunStore } from '../process/store';
import { shouldTrackTerminalWorkspaceChanges } from '../terminal-service';

function git(cwd: string, args: string[]): string {
  return String(execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }) || '');
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function changed(result: TerminalWorkspaceChangeResult, relative: string) {
  return result.workspaceChanges.find((file) => file.displayPath === relative);
}

function runGitWorkspaceCase(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-tracker-git-'));
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'prometheus-tests@example.invalid']);
    git(root, ['config', 'user.name', 'Prometheus Tests']);
    write(root, 'tracked.txt', 'one\n');
    write(root, 'preexisting.txt', 'before\n');
    write(root, 'rename-before.txt', 'rename me\n');
    write(root, 'revert.txt', 'keep\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'baseline']);

    write(root, 'preexisting.txt', 'before\noperator change\n');
    const tracker = createTerminalWorkspaceTracker({ workspacePath: root, cwd: root, command: 'test command' });
    assert.ok(tracker, 'Git tracker should initialize');

    write(root, 'tracked.txt', 'one\ntwo\n');
    write(root, 'created.txt', 'created by the failed command\n');
    fs.rmSync(path.join(root, 'preexisting.txt'));
    fs.renameSync(path.join(root, 'rename-before.txt'), path.join(root, 'rename-after.txt'));
    write(root, 'revert.txt', 'temporary\n');
    write(root, 'revert.txt', 'keep\n');
    write(root, 'node_modules/ignored.txt', 'ignored dependency output\n');
    const result = tracker!.finalize();

    assert.equal(changed(result, 'tracked.txt')?.status, 'modified');
    assert.equal(changed(result, 'created.txt')?.status, 'added');
    assert.equal(changed(result, 'preexisting.txt')?.status, 'deleted');
    assert.equal(changed(result, 'rename-after.txt')?.status, 'renamed');
    assert.equal(changed(result, 'rename-after.txt')?.oldPath, path.join(root, 'rename-before.txt'));
    assert.equal(changed(result, 'revert.txt'), undefined, 'edit-then-revert should be invisible');
    assert.equal(changed(result, 'preexisting.txt')?.baselineKind, 'turn-snapshot');
    assert.equal(result.workspaceChanges.some((file) => file.displayPath.includes('node_modules')), false, 'ignored directories stay excluded');
    assert.ok(result.workspaceSnapshots.length >= 1, 'dirty-file baseline snapshot should be retained');
    assert.ok((changed(result, 'tracked.txt')?.diffPreview || '').includes('+two'));

    const recovered = collectTurnFileChangesFromProcessEntries([{
      type: 'result',
      content: 'run_command completed',
      extra: {
        event: 'tool_result',
        toolName: 'run_command',
        workspaceChanges: result.workspaceChanges,
      },
    }], root);
    assert.ok(recovered?.files.some((file) => file.displayPath === 'created.txt'), 'checkpoint recovery should preserve terminal changes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runNonGitWorkspaceCase(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-tracker-nogit-'));
  try {
    write(root, 'existing.txt', 'old\n');
    write(root, 'untouched.txt', 'same\n');
    const tracker = createTerminalWorkspaceTracker({ workspacePath: root, cwd: root, command: 'failed command' });
    assert.ok(tracker, 'non-Git tracker should initialize');
    write(root, 'existing.txt', 'new\n');
    write(root, 'created.txt', 'new file\n');
    fs.rmSync(path.join(root, 'untouched.txt'));
    const result = tracker!.finalize();
    assert.equal(changed(result, 'existing.txt')?.status, 'modified');
    assert.equal(changed(result, 'created.txt')?.status, 'added');
    assert.equal(changed(result, 'untouched.txt')?.status, 'deleted');
    assert.ok(result.workspaceSnapshots.some((snapshot) => snapshot.kind === 'directory'), 'non-Git baseline should use a bounded directory snapshot');
    assert.equal(changed(result, 'existing.txt')?.baselineKind, 'turn-snapshot');
    assert.ok((changed(result, 'existing.txt')?.diffPreview || '').includes('+new'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runBoundedCommandHintCase(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-tracker-bounded-'));
  try {
    for (let index = 0; index < 5010; index += 1) {
      write(root, `aa-noise/${String(index).padStart(5, '0')}.txt`, 'noise\n');
    }
    write(root, 'zz-target/index.html', '<p>before</p>\n');
    write(root, 'audit/internal.json', '{"internal":true}\n');
    const tracker = createTerminalWorkspaceTracker({
      workspacePath: root,
      cwd: root,
      command: "Set-Content -LiteralPath '.\\zz-target\\index.html'; Set-Content -LiteralPath '.\\zz-target\\created.txt'",
    });
    assert.ok(tracker, 'bounded workspace tracker should initialize');
    write(root, 'zz-target/index.html', '<p>after</p>\n');
    write(root, 'zz-target/created.txt', 'created\n');
    const result = tracker!.finalize();
    assert.equal(changed(result, 'zz-target/index.html')?.status, 'modified', 'explicit command target should survive the bounded scan');
    assert.equal(changed(result, 'zz-target/created.txt')?.status, 'added', 'explicitly created command target should be reported');
    assert.ok(changed(result, 'zz-target/created.txt')?.baselineId, 'created command target should have an undo baseline');
    assert.equal(result.workspaceChanges.some((file) => file.displayPath.startsWith('audit/')), false, 'Prometheus audit files stay out of coding changes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function nodeCommand(code: string): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  if (process.platform === 'win32') {
    const executable = process.execPath.replace(/'/g, "''");
    return `& '${executable}' -e "eval(Buffer.from('${encoded}','base64').toString())"`;
  }
  const executable = process.execPath.replace(/"/g, '\\"');
  return `"${executable}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}

async function waitForPath(targetPath: string, timeoutMs = 2500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(targetPath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for test process to create ${path.basename(targetPath)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runProcessSupervisorCase(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-supervisor-'));
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-terminal-supervisor-store-'));
  try {
    const supervisor = new ProcessSupervisor(new ProcessRunStore(storeRoot));
    const foreground = await supervisor.spawn({
      command: nodeCommand("require('fs').writeFileSync('foreground.txt','foreground')"),
      cwd: root,
      mode: 'foreground',
      workspacePath: root,
      trackWorkspaceChanges: true,
    });
    const foregroundExit = await foreground.wait();
    assert.equal(foregroundExit.exitCode, 0, JSON.stringify(foregroundExit));
    assert.equal(foregroundExit.workspaceChanges?.[0]?.displayPath, 'foreground.txt');

    const background = await supervisor.spawn({
      command: nodeCommand("require('fs').writeFileSync('background.txt','background')"),
      cwd: root,
      mode: 'background',
      workspacePath: root,
      trackWorkspaceChanges: true,
    });
    const backgroundExit = await background.wait();
    assert.equal(backgroundExit.exitCode, 0, JSON.stringify(backgroundExit));
    assert.equal(backgroundExit.workspaceChanges?.[0]?.displayPath, 'background.txt');
    assert.equal(supervisor.get(background.runId)?.workspaceChanges?.[0]?.displayPath, 'background.txt');

    const failed = await supervisor.spawn({
      command: nodeCommand("require('fs').writeFileSync('failed-after-edit.txt','partial'); process.exit(7)"),
      cwd: root,
      mode: 'foreground',
      workspacePath: root,
      trackWorkspaceChanges: true,
    });
    const failedExit = await failed.wait();
    assert.notEqual(failedExit.exitCode, 0, 'failed command should remain failed through the shell supervisor');
    assert.equal(failedExit.workspaceChanges?.[0]?.displayPath, 'failed-after-edit.txt', 'failed commands must still report edits');

    const timed = await supervisor.spawn({
      command: nodeCommand("require('fs').writeFileSync('timed-out.txt','timed'); setTimeout(() => {}, 5000)"),
      cwd: root,
      mode: 'foreground',
      workspacePath: root,
      trackWorkspaceChanges: true,
      timeoutMs: 1000,
    });
    const timedExit = await timed.wait();
    assert.equal(timedExit.timedOut, true, 'overall timeout should still finalize the tracker');
    assert.equal(timedExit.workspaceChanges?.[0]?.displayPath, 'timed-out.txt');

    const cancelled = await supervisor.spawn({
      command: nodeCommand("require('fs').writeFileSync('cancelled.txt','cancelled'); setTimeout(() => {}, 5000)"),
      cwd: root,
      mode: 'background',
      workspacePath: root,
      trackWorkspaceChanges: true,
    });
    await waitForPath(path.join(root, 'cancelled.txt'));
    cancelled.cancel('manual_cancel');
    const cancelledExit = await cancelled.wait();
    assert.equal(cancelledExit.reason, 'manual_cancel');
    assert.equal(cancelledExit.workspaceChanges?.[0]?.displayPath, 'cancelled.txt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(storeRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assert.equal(shouldTrackTerminalWorkspaceChanges("$f='games\\figure-8-drift\\index.html'; $raw=Get-Content $f -Raw; $script=[regex]::Match($raw,'x').Value; Write-Output $script"), false, 'known read-only PowerShell inspection must not snapshot the workspace');
  assert.equal(shouldTrackTerminalWorkspaceChanges("$f='games;archive\\index.html'; $raw=Get-Content $f -Raw; Write-Output $raw"), false, 'quoted semicolons must not turn a known read-only PowerShell sequence into a workspace snapshot');
  assert.equal(shouldTrackTerminalWorkspaceChanges('git status --short\nInvoke-Expression $nextCommand; Write-Output done'), true, 'mixed newline and semicolon commands must retain workspace tracking');
  assert.equal(shouldTrackTerminalWorkspaceChanges("Set-Content -LiteralPath '.\\game.html' -Value 'changed'"), true, 'PowerShell writes must retain change tracking');
  assert.equal(shouldTrackTerminalWorkspaceChanges('git status --short'), false, 'read-only Git commands must not snapshot the workspace');
  assert.equal(shouldTrackTerminalWorkspaceChanges('git status --short && printf changed | dd of=tracked.txt'), true, 'a read-only prefix must not suppress tracking for a later compound mutation');
  assert.equal(shouldTrackTerminalWorkspaceChanges('Get-Content README.md; Invoke-Expression $nextCommand'), true, 'an unclassified PowerShell clause after a read-only prefix must stay tracked');
  assert.equal(shouldTrackTerminalWorkspaceChanges('$raw=Get-Content README.md | Invoke-Expression; Write-Output $raw'), true, 'a read-prefixed PowerShell pipeline must not bypass workspace tracking');
  assert.equal(shouldTrackTerminalWorkspaceChanges('git status --short\nInvoke-Expression $nextCommand'), true, 'a read-only first line must not suppress tracking for a later newline-separated command');
  assert.equal(shouldTrackTerminalWorkspaceChanges('npm run build'), true, 'unknown or potentially mutating commands stay tracked');
  runGitWorkspaceCase();
  runNonGitWorkspaceCase();
  runBoundedCommandHintCase();
  await runProcessSupervisorCase();
  console.log('[terminal-change-tracker] Git, read-only classification, dirty-baseline, failed-edit, revert, rename, ignored, non-Git, bounded command hints, and process lifecycle cases passed');
}

void main();
