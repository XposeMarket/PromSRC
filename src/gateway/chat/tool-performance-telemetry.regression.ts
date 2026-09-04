import assert from 'node:assert/strict';
import { ToolPerformanceTracker, inferToolPerformanceFamily } from './tool-performance-telemetry';

const rows: Array<{ label: string; extra: Record<string, unknown> }> = [];
const timing = {
  enabled: true,
  sessionId: 'telemetry_test',
  turnId: 'trace_test',
  startedAt: Date.now(),
  mark(label: string, extra: Record<string, unknown> = {}) {
    rows.push({ label, extra });
    return Date.now();
  },
  async flush() {},
} as any;

assert.equal(inferToolPerformanceFamily('browser_observe'), 'browser');
assert.equal(inferToolPerformanceFamily('workspace_read'), 'workspace');
assert.equal(inferToolPerformanceFamily('workspace_run'), 'terminal');
assert.equal(inferToolPerformanceFamily('search_files'), 'workspace');
assert.equal(inferToolPerformanceFamily('fetch_image'), 'creative_media');
assert.equal(inferToolPerformanceFamily('timer'), 'core');
assert.equal(inferToolPerformanceFamily('mcp__filesystem__read_file'), 'mcp_connector');
assert.equal(inferToolPerformanceFamily('subagent_spawn'), 'subagent_task');

const tracker = new ToolPerformanceTracker(timing);
const record = tracker.start('workspace_read', 'provider_call_1', 2);
tracker.dispatch(record);
tracker.executorStart(record);
tracker.event(record, 'read_complete');
tracker.complete(record, 'opaque result', false);
tracker.markSse('tool_result', {
  action: 'workspace_read',
  toolCallId: 'provider_call_1',
  result: 'opaque result',
}, 'before');
tracker.markSse('tool_result', {
  action: 'workspace_read',
  toolCallId: 'provider_call_1',
}, 'after');
tracker.beforeModelRound();
tracker.nextVisibleToken();

const decorated = tracker.decorate('tool_result', {
  action: 'workspace_read',
  toolCallId: 'provider_call_1',
  result: 'opaque result',
});
assert.equal(decorated.telemetryId, record.telemetryId);
assert.equal(decorated.telemetry.toolFamily, 'workspace');
assert.equal(decorated.telemetry.resultBytes, Buffer.byteLength('opaque result', 'utf8'));
assert.ok(rows.some((row) => row.label === 'tool.call_emitted'));
assert.ok(rows.some((row) => row.label === 'tool.result_to_model'));
assert.ok(rows.some((row) => row.label === 'tool.next_visible_token'));
assert.equal(tracker.snapshot(record).state, 'completed');
console.log('PASS: tool performance telemetry lifecycle contract');
