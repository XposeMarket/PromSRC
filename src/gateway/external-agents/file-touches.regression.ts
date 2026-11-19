/**
 * A harness turn ends like a Prometheus turn: regression test.
 *
 * - what the agent says before a tool call is commentary, only its closing answer is the reply
 * - its reasoning uses the saved, visible reasoning event
 * - the files it changed become the end-of-turn file card
 *
 * No real agent is started: the turn runs against a stub adapter.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ExternalFileTouch, ExternalTurnInput, ExternalTurnResult } from './types';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-file-touches-'));
  const workspace = path.join(root, 'workspace');
  const project = path.join(root, 'project');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;

  const { buildHarnessFileChanges, claudeFileTouch, closingAnswer, codexFileTouches, createAcpFileTracker, replaceDiff } = await import('./file-touches');

  // ── closing answer ──
  assert.strictEqual(closingAnswer("I'll edit it.\n\nDone.", ["I'll edit it."]), 'Done.');
  assert.strictEqual(closingAnswer('First.\n\nSecond.\n\nAll set.', ['\n\nFirst.', '\n\nSecond.']), 'All set.');
  assert.strictEqual(closingAnswer('AB', ['A']), 'B', 'agents that join their messages without a separator');
  assert.strictEqual(closingAnswer('Just the answer.', []), 'Just the answer.');
  assert.strictEqual(closingAnswer('Only the answer.', ['Something else said earlier.']), 'Only the answer.', 'a full text that is already the answer is kept');
  assert.strictEqual(closingAnswer("I'll run it.", ["I'll run it."]), "I'll run it.", 'ending on a tool call keeps the last words');
  assert.strictEqual(closingAnswer('', []), '');

  // ── what each agent reports ──
  assert.deepStrictEqual(codexFileTouches({ changes: [
    { path: 'C:\\repo\\My  Notes\\a.txt', kind: { type: 'add' }, diff: 'one\ntwo\n' },
    { path: '/repo/b.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new\n' },
    { path: '/repo/c.txt', kind: 'delete', diff: 'gone\n' },
    { kind: { type: 'add' }, diff: 'no path' },
  ] }), [
    { path: 'C:\\repo\\My  Notes\\a.txt', status: 'added', diff: '@@\n+one\n+two' },
    { path: '/repo/b.txt', status: 'modified', diff: '@@ -1 +1 @@\n-old\n+new\n' },
    { path: '/repo/c.txt', status: 'deleted', diff: '@@\n-gone' },
  ]);
  assert.deepStrictEqual(codexFileTouches(null), []);

  assert.deepStrictEqual(claudeFileTouch('Write', { file_path: '/p/new.txt', content: 'x' }), { path: '/p/new.txt' });
  assert.deepStrictEqual(claudeFileTouch('Edit', { file_path: '/p/a.txt', old_string: 'a\nb', new_string: 'c' }), { path: '/p/a.txt', status: 'modified', diff: '@@\n-a\n-b\n+c' });
  assert.strictEqual(claudeFileTouch('MultiEdit', { file_path: '/p/a.txt', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })?.diff, '@@\n-a\n+b\n@@\n-c\n+d');
  assert.deepStrictEqual(claudeFileTouch('NotebookEdit', { notebook_path: '/p/n.ipynb' }), { path: '/p/n.ipynb' });
  assert.strictEqual(claudeFileTouch('Read', { file_path: '/p/a.txt' }), null, 'reading is not a change');
  assert.strictEqual(claudeFileTouch('Bash', { command: 'rm x' }), null);
  assert.strictEqual(claudeFileTouch('Write', {}), null);

  const acp = createAcpFileTracker();
  assert.deepStrictEqual(acp({ sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'edit', locations: [{ path: '/p/a.txt' }] }), [], 'nothing until the tool call completes');
  assert.deepStrictEqual(
    acp({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'diff', path: '/p/a.txt', oldText: 'a', newText: 'b' }] }),
    [{ path: '/p/a.txt', status: 'modified', diff: '@@\n-a\n+b' }],
  );
  acp({ sessionUpdate: 'tool_call', toolCallId: 't2', kind: 'read', locations: [{ path: '/p/a.txt' }] });
  assert.deepStrictEqual(acp({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'completed' }), [], 'a read is not a change');
  acp({ sessionUpdate: 'tool_call', toolCallId: 't3', kind: 'edit', locations: [{ path: '/p/b.txt' }] });
  assert.deepStrictEqual(acp({ sessionUpdate: 'tool_call_update', toolCallId: 't3', status: 'failed' }), [], 'a failed edit is not a change');
  assert.deepStrictEqual(acp({ sessionUpdate: 'tool_call_update', toolCallId: 't3', status: 'completed' }), [], 'and it is forgotten');
  assert.deepStrictEqual(acp({ sessionUpdate: 'agent_message_chunk' }), []);

  // ── the file card ──
  const created = path.join(project, 'hello.txt');
  fs.writeFileSync(created, 'one\ntwo\n');
  const edited = path.join(project, 'src', 'app.ts');
  fs.mkdirSync(path.dirname(edited), { recursive: true });
  fs.writeFileSync(edited, 'const a = 2;\n-- still here\n');
  const card = buildHarnessFileChanges([
    { path: 'hello.txt', status: 'added', diff: '@@\n+one\n+two' },
    { path: edited, status: 'modified', diff: replaceDiff('const a = 1;', 'const a = 2;') },
    // A changed line that starts with "-- " is a line, not a file header.
    { path: edited, status: 'modified', diff: replaceDiff('-- gone', '-- still here') },
    { path: path.join(project, 'temp.txt'), status: 'added', diff: '@@\n+scratch' },
    { path: path.join(project, 'removed.txt'), status: 'deleted', diff: '@@\n-bye' },
    { path: '' },
  ], project)!;
  assert.deepStrictEqual(card.files.map((file) => [file.displayPath, file.status, file.insertions, file.deletions]), [
    ['hello.txt', 'added', 2, 0],
    ['removed.txt', 'deleted', 0, 1],
    ['src/app.ts', 'modified', 2, 2],
  ], 'a file that no longer exists and was not deleted (temp.txt) is left out');
  assert.deepStrictEqual(card.summary, { fileCount: 3, insertions: 4, deletions: 3 });
  assert.strictEqual(card.files[0].path, created, 'the card opens the real file');
  assert.ok(card.files[2].diffPreview?.includes('+const a = 2;'));
  assert.strictEqual(buildHarnessFileChanges([], project), undefined);
  // A file with no diff from the agent (a whole-file write) is still listed.
  const written = buildHarnessFileChanges([{ path: created }], project)!;
  assert.strictEqual(written.files.length, 1);
  assert.strictEqual(written.files[0].displayPath, 'hello.txt');
  assert.ok(written.files[0].insertions > 0);

  // ── paths outside the chat folder, and secret files ──
  fs.writeFileSync(path.join(root, 'outside-secret.txt'), 'top secret\n');
  const escaped = buildHarnessFileChanges([{ path: '../outside-secret.txt', status: 'modified' }], project)!;
  assert.strictEqual(escaped.files.length, 1, 'an outside path is listed with its status');
  assert.strictEqual(escaped.files[0].status, 'modified');
  assert.strictEqual(escaped.files[0].diffPreview, undefined, 'no diff is read from outside the chat folder');
  assert.strictEqual(escaped.files[0].insertions, 0);
  fs.writeFileSync(path.join(project, '.env'), 'TOKEN=abc\n');
  const env = buildHarnessFileChanges([{ path: '.env', status: 'modified', diff: '@@\n-OLD=1\n+TOKEN=abc' }], project)!;
  assert.deepStrictEqual([env.files[0].insertions, env.files[0].deletions], [1, 1], 'a secret file keeps its counts');
  assert.strictEqual(env.files[0].diffPreview, undefined, 'a secret file diff is not saved');
  const envUndiffed = buildHarnessFileChanges([{ path: '.env' }], project)!;
  assert.strictEqual(envUndiffed.files[0].diffPreview, undefined, 'the native collector never reads a secret file');

  // ── a whole turn through the runner ──
  const sessions = await import('../session');
  const store = await import('./store');
  const registry = await import('./registry');
  const runner = await import('./turn-runner');
  store.setExternalAgentStorePathForTests(path.join(root, 'external-agents.json'));
  store.updateExternalAgentEntry('codex', { enabled: true, lastStatus: 'ready', lastStatusText: 'Connected' });

  let script: (input: ExternalTurnInput) => ExternalTurnResult = () => ({ upstreamSessionId: 'up-1', status: 'completed', finalText: '' });
  const stub = {
    id: 'codex' as const,
    name: 'Codex',
    tile: 'C',
    capabilities: { images: false, modelList: false },
    detect: async () => ({ found: true }),
    verify: async () => ({ status: 'ready' as const, statusText: 'Connected', capabilities: { images: false, modelList: false } }),
    runTurn: async (input: ExternalTurnInput) => script(input),
    shutdown: async () => undefined,
  };
  registry.setExternalAgentAdapterForTests(stub as never);
  try {
    const bound = runner.bindExternalAgentForRequest('ft_chat', { id: 'codex', cwd: project });
    assert.ok(bound.ok && bound.binding, 'chat bound to the stub agent');

    const touch: ExternalFileTouch = { path: 'hello.txt', status: 'added', diff: '@@\n+one\n+two' };
    script = (input) => {
      input.emit({ type: 'reasoning_delta', text: 'Thinking about ' });
      input.emit({ type: 'reasoning_delta', text: 'the file.' });
      input.emit({ type: 'text_delta', text: "I'll create the file." });
      input.emit({ type: 'item_started', itemId: 'f1', kind: 'file_change', title: 'Changed a file' });
      input.emit({ type: 'file_change', files: [touch] });
      input.emit({ type: 'item_completed', itemId: 'f1', kind: 'file_change', ok: true, summary: 'hello.txt' });
      input.emit({ type: 'text_delta', text: '\n\n' });
      input.emit({ type: 'text_delta', text: 'Created hello.txt.' });
      return { upstreamSessionId: 'up-1', status: 'completed', finalText: "I'll create the file.\n\nCreated hello.txt." };
    };
    const events: Array<[string, Record<string, unknown>]> = [];
    const result = await runner.runExternalAgentTurn({ sessionId: 'ft_chat', message: 'make the file', sendSSE: (e, d) => events.push([e, d]) }, bound.binding!);
    assert.strictEqual(result.text, 'Created hello.txt.', 'the reply is the closing answer, without the words said before the tool call');
    const names = events.map(([name]) => name);
    assert.ok(!names.includes('thinking_delta'), 'reasoning does not use the unsaved thinking event');
    assert.deepStrictEqual(events.filter(([name]) => name === 'reasoning_summary_delta').map(([, data]) => data.text), ['Thinking about ', 'the file.']);
    assert.ok(names.indexOf('token') < names.indexOf('tool_call'), 'the words before the tool call still stream, so they land in the work stream');
    assert.strictEqual(result.fileChanges?.summary.fileCount, 1);
    assert.strictEqual(result.fileChanges?.files[0].displayPath, 'hello.txt');
    const saved = sessions.getSession('ft_chat').history.slice(-1)[0] as unknown as { content: string; fileChanges?: { files: Array<{ path: string; insertions: number }> } };
    assert.strictEqual(saved.content, 'Created hello.txt.');
    assert.strictEqual(saved.fileChanges?.files[0].path, created, 'the saved message carries the file card');
    assert.strictEqual(saved.fileChanges?.files[0].insertions, 2);

    // A turn with no edits has no card; a stopped turn keeps what was said after the last tool call.
    script = (input) => {
      input.emit({ type: 'text_delta', text: 'Checking.' });
      input.emit({ type: 'item_started', itemId: 'c1', kind: 'command', title: 'Ran a command' });
      input.emit({ type: 'item_completed', itemId: 'c1', kind: 'command', ok: true, summary: 'ok' });
      input.emit({ type: 'text_delta', text: 'Half an ans' });
      return { upstreamSessionId: 'up-1', status: 'interrupted', finalText: '' };
    };
    const stopped = await runner.runExternalAgentTurn({ sessionId: 'ft_chat', message: 'again', sendSSE: () => undefined }, sessions.getSessionExternalAgent('ft_chat')!);
    assert.strictEqual(stopped.text, 'Half an ans\n\n_Stopped._');
    assert.strictEqual(stopped.fileChanges, undefined);
  } finally {
    registry.setExternalAgentAdapterForTests(null);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp folder */ }
  }
  console.log('file-touches regression: ok');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
