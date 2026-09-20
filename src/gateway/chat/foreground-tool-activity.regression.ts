import assert from 'node:assert/strict';
import { createForegroundToolActivityTracker, foregroundConnectionMessage } from './foreground-tool-activity';

const tracker = createForegroundToolActivityTracker();
const start = 1_000_000;

tracker.record('tool_call', { action: 'run_command', toolCallId: 'command-1', stepNum: 1 }, start);
assert.deepEqual(tracker.current(), {
  name: 'run_command', kind: 'terminal', startedAt: start, lastUpdateAt: start, openCalls: 1,
});
assert.match(foregroundConnectionMessage(tracker.current(), 143_000, start + 143_000),
  /Terminal command is open; waiting for output \(143s since last tool update\)/);

tracker.record('tool_progress', { toolCallId: 'command-1', output: 'building' }, start + 130_000);
assert.match(foregroundConnectionMessage(tracker.current(), 13_000, start + 143_000), /13s since last tool update/);

tracker.record('tool_call', { action: 'background_ops', toolCallId: 'background-1', stepNum: 2 }, start + 140_000);
assert.equal(tracker.current()?.openCalls, 2);
assert.match(foregroundConnectionMessage(tracker.current(), 3_000, start + 143_000), /Waiting for background operation result/);

tracker.record('tool_result', { action: 'run_command', toolCallId: 'command-1', stepNum: 1 }, start + 145_000);
assert.equal(tracker.current()?.name, 'background_ops', 'parallel tool completion must leave the other call open');
tracker.record('tool_result', { action: 'background_ops', toolCallId: 'background-1', stepNum: 2 }, start + 150_000);
assert.equal(tracker.current(), null, 'a completed background call is not proof its detached worker is still the foreground tool');
assert.match(foregroundConnectionMessage(null, 143_000), /No new model or tool update for 143s/);

tracker.record('tool_call', { action: 'workspace_run', stepNum: 3 }, start + 160_000);
tracker.record('tool_result', { action: 'workspace_run', stepNum: 3 }, start + 161_000);
assert.equal(tracker.current(), null, 'a result without a tool-call id must still clear the matching step');

tracker.record('tool_call', { action: 'run_command', stepNum: 4 }, start + 170_000);
tracker.record('done', {}, start + 171_000);
assert.equal(tracker.current(), null, 'terminal chat frames must clear any interrupted tool display');

console.log('Foreground tool activity regression passed.');
