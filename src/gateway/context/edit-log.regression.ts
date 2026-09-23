// The cross-turn edit log must let a follow-up turn see exactly where and what
// an earlier turn changed, so it can go straight to the edit site instead of
// re-reading files to rediscover it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-editlog-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

async function main() {
  const mod = await import('./edit-log');
  const { recordEditLogEntry, formatEditLogForPrompt, readEditLog, __resetEditLogCacheForTests, EDIT_LOG_MAX_ENTRIES } = mod as any;
  const sid = 'editlog_test_session';

  // Turn A: a patchset with a find_replace, plus a single replace_lines.
  recordEditLogEntry({
    sessionId: sid,
    turnId: 'turnA',
    tool: 'workspace_edit',
    args: { action: 'patchset', edits: [{ op: 'find_replace', filename: 'web-ui/src/x.js', find: 'const floor = 0.3;', replace: 'const floor = 0.3;\nconst ceiling = 1;' }] },
    result: 'OK web-ui/src/x.js: replaced first occurrence.\nChanged lines: web-ui/src/x.js:5663-5670 (9537 total lines)',
  });
  recordEditLogEntry({
    sessionId: sid,
    turnId: 'turnA',
    tool: 'workspace_edit',
    args: JSON.stringify({ action: 'replace_lines', path: 'src/y.ts', start_line: 10, end_line: 12, new_content: 'export const Y = 2;' }),
    result: 'OK',
  });

  // Turn B is the in-flight turn: its own entries are excluded (it has them verbatim).
  recordEditLogEntry({ sessionId: sid, turnId: 'turnB', tool: 'workspace_edit', args: { action: 'write', path: 'src/z.ts', content: 'z' }, result: 'OK' });

  const block = formatEditLogForPrompt(sid, { excludeTurnId: 'turnB' });
  assert.match(block, /\[RECENT_EDIT_LOG/);
  assert.match(block, /web-ui\/src\/x\.js:5663-5670/, 'line range must be parsed from the tool result');
  assert.match(block, /removed: const floor = 0\.3;/, 'removed text must be carried');
  assert.match(block, /added: const floor = 0\.3;\n\s+const ceiling = 1;/, 'added text must be carried');
  assert.match(block, /src\/y\.ts:10-12/, 'replace_lines range must be carried from args');
  assert.doesNotMatch(block, /src\/z\.ts/, 'in-flight turn entries must be excluded');

  // Mid-turn restart: the resumed run shares turn id turnB but started later,
  // so turnB's pre-restart edit must be visible again.
  const resumed = formatEditLogForPrompt(sid, { excludeTurnId: 'turnB', excludeSince: Date.now() + 1 });
  assert.match(resumed, /src\/z\.ts/, 'pre-restart edits of the same turn must survive a restart');

  // Persisted across a process restart (cache cleared, reread from disk).
  __resetEditLogCacheForTests();
  assert.equal(readEditLog(sid).length, 3, 'entries must survive a gateway restart');

  // Failed edits are marked, snippets are bounded, the log is capped.
  recordEditLogEntry({ sessionId: sid, turnId: 'turnC', tool: 'workspace_edit', args: { action: 'find_replace', path: 'big.ts', find: 'a'.repeat(5000), replace: 'b' }, error: 'not found' });
  const failed = formatEditLogForPrompt(sid);
  assert.match(failed, /\(FAILED\) big\.ts/);
  assert.match(failed, /\[\+4640 chars\]/, 'long snippets must be truncated');
  for (let i = 0; i < EDIT_LOG_MAX_ENTRIES + 10; i += 1) {
    recordEditLogEntry({ sessionId: sid, turnId: `t${i}`, tool: 'workspace_edit', args: { action: 'write', path: `f${i}.ts`, content: 'x' } });
  }
  assert.equal(readEditLog(sid).length, EDIT_LOG_MAX_ENTRIES, 'log must stay bounded');
  assert.ok(formatEditLogForPrompt(sid).length <= 7_000, 'prompt block must stay bounded');

  // Non-edit noise never throws.
  recordEditLogEntry({ sessionId: sid, turnId: 'x', tool: 'workspace_edit', args: null });

  // Shell-driven edits (PowerShell WriteAllText through workspace_run) must be
  // logged with the real changed line range from git, not silently dropped.
  const { recordShellEditLogEntry, commandLooksLikeFileMutation } = mod as any;
  const { execFileSync } = await import('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-editlog-git-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const target = path.join(repo, 'composer.js');
  fs.writeFileSync(target, 'line1\nline2\nconst floor = 0.3;\nline4\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(target, 'line1\nline2\nconst floor = 0.35;\nline4\n');
  const shellSid = 'editlog_shell_session';
  const cmd = `cd ${repo}; $t=[IO.File]::ReadAllText('composer.js'); [IO.File]::WriteAllText('composer.js',$t.Replace('0.3','0.35'))`;
  assert.equal(commandLooksLikeFileMutation(cmd), true, 'WriteAllText must count as a file mutation');
  assert.equal(commandLooksLikeFileMutation('git status; Get-Content foo.ts | Select-String x'), false, 'read-only commands must not be logged');
  recordShellEditLogEntry({ sessionId: shellSid, turnId: 'turnS', tool: 'workspace_run', command: cmd, cwd: tmp });
  const shellEntries = readEditLog(shellSid);
  assert.equal(shellEntries.length, 1, 'shell edit must produce one entry');
  assert.equal(path.resolve(shellEntries[0].file), path.resolve(target), 'shell edit must resolve the edited file');
  assert.equal(shellEntries[0].lines, '3', 'shell edit must carry the git-diff line range');
  assert.ok(String(shellEntries[0].added).includes('0.35'), 'shell edit must carry the added text');
  assert.ok(String(shellEntries[0].removed).includes('0.3;'), 'shell edit must carry the removed text');
  recordShellEditLogEntry({ sessionId: shellSid, turnId: 'turnS', tool: 'workspace_run', command: 'git log -1', cwd: repo });
  assert.equal(readEditLog(shellSid).length, 1, 'read-only shell commands must not add entries');
  console.log('edit-log regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
