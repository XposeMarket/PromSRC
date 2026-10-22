import assert from 'node:assert/strict';
import { createForegroundToolActivityTracker, foregroundConnectionMessage, QUIET_CONNECTION_PILL_MS } from './foreground-tool-activity';

assert.equal(QUIET_CONNECTION_PILL_MS, 60_000);
const tracker = createForegroundToolActivityTracker();
const start = 1_000_000;

tracker.record('tool_call', { action: 'run_command', toolCallId: 'command-1', stepNum: 1 }, start);
assert.deepEqual(tracker.current(), {
  name: 'run_command', kind: 'terminal', startedAt: start, lastUpdateAt: start, openCalls: 1,
});
assert.match(foregroundConnectionMessage(tracker.current(), 143_000, start + 143_000),
  /Terminal command is open; waiting for output \(143s since last tool update\)/);

// Quiet gate: tool updates within the last 60s suppress the pill.
tracker.record('tool_progress', { toolCallId: 'command-1', output: 'building' }, start + 130_000);
assert.equal(foregroundConnectionMessage(tracker.current(), 13_000, start + 143_000), '', '13s quiet: no pill');
assert.equal(foregroundConnectionMessage(tracker.current(), 59_000, start + 189_000), '', '59s quiet: no pill');
assert.match(foregroundConnectionMessage(tracker.current(), 60_000, start + 190_000), /60s since last tool update/, '60s quiet: pill');
tracker.record('process_run_output', { toolCallId: 'command-1', chunk: 'built' }, start + 140_000);
assert.equal(foregroundConnectionMessage(tracker.current(), 3_000, start + 143_000), '');

tracker.record('tool_call', { action: 'background_ops', toolCallId: 'background-1', stepNum: 2, args: { action: 'status' } }, start + 140_000);
assert.equal(tracker.current()?.openCalls, 2);
assert.equal(tracker.current()?.kind, 'background');
assert.equal(foregroundConnectionMessage(tracker.current(), 3_000, start + 143_000), '');
assert.match(foregroundConnectionMessage(tracker.current(), 61_000, start + 201_000), /Waiting for background operation result \(61s\)/);

tracker.record('tool_result', { action: 'run_command', toolCallId: 'command-1', stepNum: 1 }, start + 145_000);
assert.equal(tracker.current()?.name, 'background_ops', 'parallel tool completion must leave the other call open');
tracker.record('tool_result', { action: 'background_ops', toolCallId: 'background-1', stepNum: 2 }, start + 150_000);
assert.equal(tracker.current(), null, 'a completed background call is not proof its detached worker is still the foreground tool');

// No open tool: idle gate.
assert.equal(foregroundConnectionMessage(null, 30_000), '', 'idle 30s: no pill');
assert.match(foregroundConnectionMessage(null, 61_000), /No new model or tool update for 61s/, 'idle 61s: pill');
assert.match(foregroundConnectionMessage(null, 143_000), /No new model or tool update for 143s/);

// Known-duration wait: countdown on the client, never a pill while within the wait.
tracker.record('tool_call', { action: 'background_ops', toolCallId: 'wait-1', stepNum: 5, args: { action: 'wait', wait_ms: 60_000 } }, start + 200_000);
assert.equal(tracker.current()?.kind, 'wait');
assert.equal(tracker.current()?.waitUntil, start + 260_000);
assert.equal(foregroundConnectionMessage(tracker.current(), 59_000, start + 259_000), '');
assert.equal(foregroundConnectionMessage(tracker.current(), 90_000, start + 290_000), '', 'wait overrun < 60s: still no pill');
assert.match(foregroundConnectionMessage(tracker.current(), 125_000, start + 325_000), /Wait passed its timeout/, 'wait overrun >= 60s: pill');
tracker.record('tool_result', { action: 'background_ops', toolCallId: 'wait-1', stepNum: 5 }, start + 230_000);
assert.equal(tracker.current(), null);

// User-driven waits and non-wait actions are not countdown waits.
tracker.record('tool_call', { action: 'await_prometheus_question_response', toolCallId: 'q-1', arguments: '{"question_id":"q","timeout_ms":60000}' }, start + 300_000);
assert.notEqual(tracker.current()?.kind, 'wait');
assert.equal(tracker.current()?.waitUntil, undefined);
tracker.record('done', {}, start + 301_000);
tracker.record('tool_call', { action: 'workspace_run', toolCallId: 'r-1', arguments: '{"action":"wait","runId":"x","timeout_ms":30000}' }, start + 302_000);
assert.equal(tracker.current()?.kind, 'wait', 'workspace_run wait with string args is a countdown wait');
tracker.record('done', {}, start + 303_000);

tracker.record('tool_call', { action: 'workspace_run', stepNum: 3 }, start + 160_000);
tracker.record('tool_result', { action: 'workspace_run', stepNum: 3 }, start + 161_000);
assert.equal(tracker.current(), null, 'a result without a tool-call id must still clear the matching step');

tracker.record('tool_call', { action: 'run_command', stepNum: 4 }, start + 170_000);
tracker.record('done', {}, start + 171_000);
assert.equal(tracker.current(), null, 'terminal chat frames must clear any interrupted tool display');

console.log('Foreground tool activity regression passed.');
