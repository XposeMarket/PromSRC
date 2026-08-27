import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('web-ui/src/tool-activity.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const activity = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const {
  applyToolActivityEvent,
  applyCommandProcessEvent,
  coalesceToolActivityEntries,
  renderToolActivityEntry,
  toolActivitySummary,
} = activity;

{
  const entries = [];
  const preparing = applyToolActivityEvent(entries, 'prepare', {
    id: 'call_click_1',
    action: 'desktop_click',
  });
  assert.equal(entries.length, 1, 'preparing creates one visible operation row');
  assert.match(preparing.text, /Preparing desktop click/i);

  const called = applyToolActivityEvent(entries, 'call', {
    toolCallId: 'call_click_1',
    action: 'desktop_click',
    args: { x: 512, y: 340, window: 'ChatGPT' },
  });
  assert.equal(entries.length, 1, 'normalized call updates the preparing row in place');
  assert.equal(called.id, preparing.id, 'operation identity remains stable');
  assert.match(called.text, /Clicking desktop · ChatGPT · \(512, 340\)/);

  applyToolActivityEvent(entries, 'progress', {
    toolCallId: 'call_click_1',
    action: 'desktop_click',
    message: 'Verifying screenshot anchor',
  });
  assert.equal(entries.length, 1, 'progress does not append another tool row');
  assert.equal(entries[0].activity.progress, 'Verifying screenshot anchor');

  const result = applyToolActivityEvent(entries, 'result', {
    toolCallId: 'call_click_1',
    action: 'desktop_click',
    args: { x: 512, y: 340, window: 'ChatGPT' },
    result: 'Clicked successfully',
    error: false,
    durationMs: 420,
  });
  assert.equal(entries.length, 2, 'result is the second visible row');
  assert.equal(result.type, 'result');
  assert.match(result.text, /Clicked desktop · 420 ms/);
}

{
  const entries = [];
  applyToolActivityEvent(entries, 'call', { toolCallId: 'persist_open_1', action: 'workspace_read', args: { action: 'read', path: 'main.cpp' } });
  const html = renderToolActivityEntry(entries[0], (value) => String(value));
  assert.match(html, /tool-activity-entry-summary/);
  assert.doesNotMatch(html, /data-tool-disclosure-key="activity:persist_open_1:operation"/);
  assert.doesNotMatch(html, /tool-activity-details|Arguments|Result/);
}

{
  const entries = [];
  applyToolActivityEvent(entries, 'call', {
    toolCallId: 'command_live_1',
    action: 'workspace_run',
    args: { action: 'run', command: 'npm test' },
  });
  applyCommandProcessEvent(entries, 'process_run_started', {
    run: { runId: 'run_live_1', toolCallId: 'command_live_1', sessionId: 'chat_1', command: 'npm test', state: 'running', outputSeq: 0 },
  });
  applyCommandProcessEvent(entries, 'process_run_output', {
    run: { runId: 'run_live_1', toolCallId: 'command_live_1', state: 'running', outputSeq: 1 },
    sequence: 1,
    stream: 'stdout',
    chunk: '\u001b[32mPASS\u001b[0m first\n',
  });
  applyCommandProcessEvent(entries, 'process_run_output', {
    run: { runId: 'run_live_1', toolCallId: 'command_live_1', state: 'running', outputSeq: 2 },
    sequence: 2,
    stream: 'stderr',
    chunk: 'warning second\n',
  });
  applyCommandProcessEvent(entries, 'process_run_output', {
    run: { runId: 'run_live_1', toolCallId: 'command_live_1', state: 'running', outputSeq: 1 },
    sequence: 1,
    chunk: 'duplicate ignored\n',
  });
  assert.equal(entries[0].activity.terminal.output, 'PASS first\nwarning second\n');
  assert.equal(coalesceToolActivityEntries(entries)[0].activity.terminal.output, 'PASS first\nwarning second\n');
  let html = renderToolActivityEntry(entries[0], (value) => String(value));
  assert.match(html, /tool-command-terminal is-live/);
  assert.match(html, /data-command-run-id="run_live_1" open/);
  assert.doesNotMatch(html, /duplicate ignored|\u001b/);

  applyCommandProcessEvent(entries, 'process_run_exited', {
    run: { runId: 'run_live_1', toolCallId: 'command_live_1', state: 'exited', exitCode: 0, durationMs: 850, outputSeq: 2 },
  });
  applyToolActivityEvent(entries, 'result', {
    toolCallId: 'command_live_1',
    action: 'workspace_run',
    args: { action: 'run', command: 'npm test' },
    result: 'tests passed',
    error: false,
    extra: { runId: 'run_live_1' },
  });
  html = renderToolActivityEntry(entries[1], (value) => String(value));
  assert.match(html, /tool-command-terminal is-complete/);
  assert.doesNotMatch(html, /data-command-run-id="run_live_1" open/);
  assert.match(html, /PASS first/);
}

{
  const entries = [];
  applyToolActivityEvent(entries, 'prepare', { id: 'batch_window', action: 'desktop_window' });
  applyToolActivityEvent(entries, 'prepare', { id: 'batch_input', action: 'desktop_input' });
  applyToolActivityEvent(entries, 'call', { id: 'batch_window', action: 'desktop_window' });
  applyToolActivityEvent(entries, 'result', { id: 'batch_window', action: 'desktop_window', result: 'ok', error: false });
  assert.deepEqual(
    entries.map((entry) => `${entry.activity.callId}:${entry.activity.kind}`),
    ['batch_window:operation', 'batch_window:result', 'batch_input:operation'],
    'a result is inserted directly below its matching call even when later calls prepared first',
  );
  applyToolActivityEvent(entries, 'call', { id: 'batch_input', action: 'desktop_input' });
  applyToolActivityEvent(entries, 'result', { id: 'batch_input', action: 'desktop_input', result: 'ok', error: false });
  assert.deepEqual(
    entries.map((entry) => `${entry.activity.callId}:${entry.activity.kind}`),
    ['batch_window:operation', 'batch_window:result', 'batch_input:operation', 'batch_input:result'],
  );
  assert.equal(toolActivitySummary(entries), '2 desktop actions', 'related desktop actions collapse into one clean summary');
}

{
  const legacy = [
    {
      type: 'tool',
      text: 'Preparing dev_source_read',
      extra: { event: 'tool_call', toolName: 'dev_source_read', args: { action: 'stats', file: 'src/gateway/missing-helper.ts' }, stepNum: 1 },
    },
    {
      type: 'error',
      text: 'ERROR: src/gateway/missing-helper.ts not found',
      extra: { event: 'tool_result', toolName: 'dev_source_read', args: { action: 'stats', file: 'src/gateway/missing-helper.ts' }, error: true, stepNum: 1 },
    },
    {
      type: 'tool',
      text: 'Preparing dev_source_read',
      extra: { event: 'tool_call', toolName: 'dev_source_read', args: { action: 'grep', pattern: 'class Win32DesktopHelper' }, stepNum: 2 },
    },
    {
      type: 'result',
      text: JSON.stringify({ match_count: 1, returned_count: 1 }),
      extra: { event: 'tool_result', toolName: 'dev_source_read', args: { action: 'grep', pattern: 'class Win32DesktopHelper' }, error: false, stepNum: 2 },
    },
    {
      type: 'tool',
      text: 'Preparing dev_source_read',
      extra: { event: 'tool_call', toolName: 'dev_source_read', args: { action: 'read', file: 'src/gateway/desktop-platform-win32-helper.ts', start_line: 1 }, stepNum: 3 },
    },
    {
      type: 'result',
      text: 'source text containing the phrase verification failed inside a comment',
      extra: { event: 'tool_result', toolName: 'dev_source_read', args: { action: 'read', file: 'src/gateway/desktop-platform-win32-helper.ts', start_line: 1 }, error: false, stepNum: 3 },
    },
    {
      type: 'tool',
      text: 'Preparing dev_source_read',
      extra: { event: 'tool_call', toolName: 'dev_source_read', args: { action: 'read', file: 'src/gateway/desktop-platform-win32-helper.ts', start_line: 125 }, stepNum: 4 },
    },
    {
      type: 'result',
      text: 'more source text',
      extra: { event: 'tool_result', toolName: 'dev_source_read', args: { action: 'read', file: 'src/gateway/desktop-platform-win32-helper.ts', start_line: 125 }, error: false, stepNum: 4 },
    },
  ];
  const rows = coalesceToolActivityEntries(legacy);
  assert.equal(rows.filter((entry) => entry.activity?.kind === 'operation').length, 4);
  assert.equal(rows.filter((entry) => entry.activity?.kind === 'result').length, 4);
  assert.equal(rows.filter((entry) => entry.type === 'error').length, 1, 'structured error metadata is authoritative');
  const summary = toolActivitySummary(legacy);
  assert.match(summary, /2 file reads/);
  assert.match(summary, /failed/i);
  assert.doesNotMatch(summary, /Read 3 files/i);
}

{
  const entries = [];
  applyToolActivityEvent(entries, 'call', { id: 'literal_error_text', action: 'read_file', args: { path: 'example.txt' } });
  applyToolActivityEvent(entries, 'result', {
    id: 'literal_error_text',
    action: 'read_file',
    result: 'ERROR: this is literal file content, not a failed operation',
    error: false,
  });
  assert.equal(entries[1].type, 'result', 'result text never overrides explicit success metadata');
}

{
  const entries = [];
  applyToolActivityEvent(entries, 'call', {
    id: 'command_1',
    action: 'run_command',
    args: { command: 'npm test', api_key: 'should-not-render', nested: { password: 'also-hidden' } },
  });
  applyToolActivityEvent(entries, 'result', {
    id: 'command_1',
    action: 'run_command',
    args: { command: 'npm test', api_key: 'should-not-render', nested: { password: 'also-hidden' } },
    result: '24 tests passed',
    durationMs: 3200,
  });
  const html = entries.map((entry) => renderToolActivityEntry(entry, (value) => String(value))).join('\n');
  assert.match(html, /class="tool-activity-entry"/);
  assert.doesNotMatch(html, /tool-activity-kicker/);
  assert.doesNotMatch(html, /tool-activity-state/);
  assert.doesNotMatch(html, /tool-activity-details|Arguments|Result|\[redacted\]/);
  assert.doesNotMatch(html, /should-not-render|also-hidden/);
  assert.match(html, /Ran command · npm test · 3\.2 s/);
  assert.doesNotMatch(html, /Command finished|Workspace Run/);
}

{
  for (const action of ['workspace_run', 'run_command', 'terminal', 'shell', 'shell_command', 'terminal_run', 'start_process']) {
    const entries = [];
    applyToolActivityEvent(entries, 'call', { id: `alias_${action}`, action, args: { action: 'run', command: 'npm test' } });
    applyToolActivityEvent(entries, 'result', { id: `alias_${action}`, action, args: { action: 'run', command: 'npm test' }, result: 'ok', error: false });
    assert.equal(entries[0].text, 'Running command · npm test', `${action} uses the live command label`);
    assert.match(entries[1].text, /^Ran command · npm test/, `${action} uses the completed command label`);
    assert.doesNotMatch(entries.map((entry) => entry.text).join('\n'), /Command finished|Workspace Run/);
  }
}

{
  // A reconnect can replay the retained stream from sequence zero. The same
  // call/result frames must reconcile into the existing rows instead of
  // appending a second copy of the tool activity.
  const entries = [];
  const call = {
    streamId: 'replay_stream_1',
    seq: 14,
    stepNum: 3,
    action: 'workspace_read',
    args: { action: 'read', path: 'src/app.js' },
  };
  const result = {
    streamId: 'replay_stream_1',
    seq: 15,
    stepNum: 3,
    action: 'workspace_read',
    args: { action: 'read', path: 'src/app.js' },
    result: 'const app = true;',
    error: false,
  };
  applyToolActivityEvent(entries, 'call', call);
  applyToolActivityEvent(entries, 'result', result);
  applyToolActivityEvent(entries, 'call', call);
  applyToolActivityEvent(entries, 'result', result);
  assert.equal(entries.length, 2, 'replayed sequenced call/result frames remain one operation/result pair');
  assert.equal(entries.filter((entry) => entry.activity?.kind === 'operation').length, 1);
  assert.equal(entries.filter((entry) => entry.activity?.kind === 'result').length, 1);
}

console.log('[tool-activity-stream] two-row lifecycle, compact tool/result rows, and terminal output passed');
