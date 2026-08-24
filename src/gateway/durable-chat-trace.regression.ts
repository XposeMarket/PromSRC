import assert from 'node:assert/strict';

import {
  buildDurableChatTraceFromFrames,
  buildDurableChatTraceFromProcessEntries,
} from './durable-chat-trace';

const streamTrace = buildDurableChatTraceFromFrames([
  {
    seq: 1,
    type: 'tool_call',
    at: 1,
    data: { action: 'workspace_run', toolCallId: 'call-1', args: { command: 'git status' } },
  },
  {
    seq: 2,
    type: 'reasoning_summary_delta',
    at: 2,
    data: { text: 'Inspecting', source: 'reasoning_summary', visibility: 'user' },
  },
  {
    seq: 3,
    type: 'reasoning_summary_delta',
    at: 3,
    data: { text: ' the workspace', source: 'reasoning_summary', visibility: 'user' },
  },
  {
    seq: 4,
    type: 'tool_progress',
    at: 4,
    data: { action: 'workspace_run', toolCallId: 'call-1', message: 'Running command' },
  },
  {
    seq: 5,
    type: 'tool_result',
    at: 5,
    data: { action: 'workspace_run', toolCallId: 'call-1', result: 'clean', ok: true },
  },
  {
    seq: 6,
    type: 'thinking_delta',
    at: 6,
    data: { thinking: 'private provider chain of thought', visibility: 'private' },
  },
]);

assert.ok(streamTrace, 'ordinary tool traces must survive without a vision event');
assert.deepEqual(streamTrace?.map((entry) => entry.type), ['tool', 'think', 'progress', 'result']);
assert.equal(streamTrace?.[0]?.extra?.action, 'workspace_run');
assert.equal(streamTrace?.[0]?.extra?.toolCallId, 'call-1');
assert.equal(streamTrace?.[1]?.text, 'Inspecting the workspace');
assert.equal(streamTrace?.[1]?.extra?.source, 'reasoning_summary');
assert.equal(streamTrace?.some((entry) => String(entry.text || '').includes('private provider')), false);

const checkpointTrace = buildDurableChatTraceFromProcessEntries([
  {
    type: 'info',
    content: 'preflight noise',
    extra: { source: 'runtime_checkpoint', event: 'ui_preflight' },
  },
  {
    type: 'think',
    content: 'Recovered planning summary',
    extra: { source: 'runtime_checkpoint', event: 'reasoning_summary_delta', visibility: 'user' },
  },
  {
    type: 'tool',
    content: 'Preparing workspace_run',
    extra: { source: 'runtime_checkpoint', event: 'tool_call', toolName: 'workspace_run', toolCallId: 'call-2', args: { command: 'pwd' } },
  },
  {
    type: 'result',
    content: 'done',
    extra: { source: 'runtime_checkpoint', event: 'tool_result', toolName: 'workspace_run', toolCallId: 'call-2', ok: true },
  },
  {
    type: 'think',
    content: 'Recovered narrated progress',
    extra: { source: 'runtime_checkpoint', event: 'token_narration_boundary' },
  },
  {
    type: 'think',
    content: 'private thinking must stay hidden',
    extra: { source: 'runtime_checkpoint', event: 'thinking', visibility: 'private' },
  },
]);

assert.ok(checkpointTrace, 'restart checkpoints must expose a durable trace');
assert.deepEqual(checkpointTrace?.map((entry) => entry.type), ['think', 'tool', 'result', 'preamble']);
assert.equal(checkpointTrace?.[0]?.extra?.source, 'reasoning_summary');
assert.equal(checkpointTrace?.[1]?.extra?.action, 'workspace_run');
assert.equal(checkpointTrace?.[3]?.extra?.source, 'agent_progress');
assert.equal(checkpointTrace?.some((entry) => String(entry.text || '').includes('private thinking')), false);

console.log('durable chat trace recovery regression passed');
