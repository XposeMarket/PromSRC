// A restart-spanning turn lost its pre-restart end-of-turn diff because the
// durable runtime snapshot stores a text-only trace (no tool args) and the
// diff collector did not recognise the unified `workspace_edit` tool at all.
// This pins: workspace_edit mutations are detected, read-only actions are
// not, touches survive the durable snapshot shape, and they merge across
// multiple restarts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  collectTurnFileChanges,
  extractTurnFileTouches,
  mergeTurnFileTouches,
} from './file-change-summary';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-touch-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: ws, stdio: 'ignore' });
git('init', '-q');
git('config', 'user.email', 't@t');
git('config', 'user.name', 't');
fs.writeFileSync(path.join(ws, 'a.ts'), 'one\n');
fs.writeFileSync(path.join(ws, 'b.ts'), 'one\n');
git('add', '.');
git('commit', '-qm', 'init');
fs.writeFileSync(path.join(ws, 'a.ts'), 'one\ntwo\n');
fs.writeFileSync(path.join(ws, 'b.ts'), 'one\nthree\n');

// 1. The unified workspace_edit tool is a file mutation (it was ignored before).
const direct = collectTurnFileChanges([
  { name: 'workspace_edit', args: { action: 'find_replace', path: path.join(ws, 'a.ts') }, result: 'OK', error: false },
], ws);
assert.equal(direct?.files.length, 1, 'workspace_edit find_replace must produce an end-of-turn diff');

// 2. Read-only / dry-run workspace_edit actions are not.
const readOnly = collectTurnFileChanges([
  { name: 'workspace_edit', args: { action: 'preview_patch', path: path.join(ws, 'a.ts') }, result: '', error: false },
  { name: 'workspace_edit', args: { action: 'write', path: path.join(ws, 'b.ts'), dry_run: true }, result: '', error: false },
], ws);
assert.equal(readOnly, undefined, 'preview/dry-run workspace_edit must not count as a change');

// 3. Touches extracted from live process entries keep path-only args
//    (no file contents) so they are cheap to persist in the checkpoint.
const touchesRuntime1 = extractTurnFileTouches([
  { extra: { event: 'tool_call', toolName: 'workspace_edit', stepNum: 1, args: { action: 'write', path: path.join(ws, 'a.ts'), content: 'x'.repeat(50_000) } } },
  { content: 'OK', extra: { event: 'tool_result', toolName: 'workspace_edit', stepNum: 1 } },
]);
assert.equal(touchesRuntime1.length, 1);
assert.equal((touchesRuntime1[0].args as any).content, undefined, 'file contents must not be persisted');

// Survive JSON round trip (durable ledger shape).
const persisted = JSON.parse(JSON.stringify(touchesRuntime1));

// 4. A second restart: runtime 2 inherits runtime 1's touches and adds its own.
const touchesRuntime2 = extractTurnFileTouches([
  { extra: { event: 'tool_call', toolName: 'workspace_edit', stepNum: 1, args: { action: 'patchset', edits: [{ path: path.join(ws, 'b.ts') }] } } },
  { content: 'OK', extra: { event: 'tool_result', toolName: 'workspace_edit', stepNum: 1 } },
]);
const inheritedByRuntime3 = mergeTurnFileTouches(persisted, touchesRuntime2, persisted);
assert.equal(inheritedByRuntime3.length, 2, 'touches must merge and de-duplicate across restarts');

const finalDiff = collectTurnFileChanges(
  inheritedByRuntime3.map((touch) => ({ ...touch, result: '', error: false })),
  ws,
);
assert.deepEqual(
  finalDiff?.files.map((f) => f.displayPath).sort(),
  ['a.ts', 'b.ts'],
  'end-of-turn diff must include files edited before every restart',
);

fs.rmSync(ws, { recursive: true, force: true });
console.log('restart-file-touches regression: ok');
