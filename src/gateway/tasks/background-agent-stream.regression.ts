import assert from 'node:assert/strict';
import {
  appendBackgroundAgentStreamEvent,
  backgroundAgentStreamSummary,
  createBackgroundAgentStream,
  finishBackgroundAgentStream,
  replayBackgroundAgentStream,
} from './background-agent-stream';
import {
  addPendingRuntimeSteerForBackgroundAgent,
  consumePendingRuntimeSteersForSession,
  finishLiveRuntime,
  registerLiveRuntime,
} from '../live-runtime-registry';
import { backgroundProcessEntryFromSseEvent } from './background-agent-trace';

function testPersistentAccumulationAndReplay(): void {
  const stream = createBackgroundAgentStream(1000);
  const first = appendBackgroundAgentStreamEvent(stream, 'thinking', { text: 'inspect' }, 1100);
  const second = appendBackgroundAgentStreamEvent(stream, 'tool_call', { name: 'read_file' }, 1200);
  const third = appendBackgroundAgentStreamEvent(stream, 'tool_result', { name: 'read_file', result: 'ok' }, 1300);

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(third.seq, 3);
  assert.deepEqual(replayBackgroundAgentStream(stream, 0).map((frame) => frame.seq), [1, 2, 3]);
  assert.deepEqual(replayBackgroundAgentStream(stream, 1).map((frame) => frame.seq), [2, 3]);

  finishBackgroundAgentStream(stream, 1400);
  assert.equal(backgroundAgentStreamSummary(stream)?.active, false);
  assert.deepEqual(replayBackgroundAgentStream(stream, 0).map((frame) => frame.type), ['thinking', 'tool_call', 'tool_result']);
  assert.equal(backgroundAgentStreamSummary(stream)?.lastSeq, 3);
}

function testDirectSteerDelivery(): void {
  const taskId = `bg_regression_${Date.now()}`;
  const sessionId = `background_${taskId}`;
  const runtimeId = registerLiveRuntime({
    kind: 'background_agent',
    label: 'Regression background agent',
    sessionId,
    taskId,
    source: 'background_spawn',
    abortSignal: { aborted: false },
  });
  try {
    const queued = addPendingRuntimeSteerForBackgroundAgent(taskId, {
      message: 'Use the second file too.',
      source: 'web_background_agent_chat',
      kind: 'constraint',
      requiresWorkerResponse: true,
    });
    assert.equal(queued.ok, true);
    assert.equal(queued.event?.message, 'Use the second file too.');
    const delivered = consumePendingRuntimeSteersForSession(sessionId, 4);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.message, 'Use the second file too.');
    assert.equal(delivered[0]?.requiresWorkerResponse, true);
  } finally {
    finishLiveRuntime(runtimeId);
  }
}

function testStructuredToolResultTrace(): void {
  const objectResult = { ok: true, files: ['README.md'], count: 1 };
  const objectEntry = backgroundProcessEntryFromSseEvent('tool_result', {
    name: 'workspace_read',
    result: objectResult,
  });
  assert.equal(objectEntry?.extra?.action, 'workspace_read');
  assert.equal(objectEntry?.text, 'workspace_read complete');
  assert.deepEqual(objectEntry?.extra?.result, objectResult);
  assert.equal(objectEntry?.extra?.resultType, 'object');

  const arrayResult = [{ path: 'README.md' }, { path: 'package.json' }];
  const arrayEntry = backgroundProcessEntryFromSseEvent('tool_result', {
    name: 'workspace_search',
    output: arrayResult,
  });
  assert.equal(arrayEntry?.text, 'workspace_search complete');
  assert.deepEqual(arrayEntry?.extra?.result, arrayResult);
  assert.equal(arrayEntry?.extra?.resultType, 'array');
}

testPersistentAccumulationAndReplay();
testDirectSteerDelivery();
testStructuredToolResultTrace();
console.log('background-agent-stream regression: ok');
