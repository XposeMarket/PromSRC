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
import { appendBackgroundSseTrace, backgroundProcessEntryFromSseEvent } from './background-agent-trace';

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

function testReasoningSummaryTrace(): void {
  const deltaEntry = backgroundProcessEntryFromSseEvent('reasoning_summary_delta', {
    text: 'I am checking the available sources first.',
    source: 'reasoning_summary',
    visibility: 'user',
  });
  assert.equal(deltaEntry?.extra?.source, 'reasoning_summary', 'public summary retains its distinct recovery channel');

  const alternateEntry = backgroundProcessEntryFromSseEvent('reasoning_delta', {
    summary: 'I am comparing the captured results.',
    visibility: 'user',
  });
  assert.equal(alternateEntry?.extra?.reasoningKind, 'summary', 'summary packets must not become full commentary');

  assert.equal(backgroundProcessEntryFromSseEvent('reasoning_summary', {
    text: 'private summary must stay hidden',
    source: 'reasoning_summary',
    visibility: 'private',
  }), null);
  assert.equal(backgroundProcessEntryFromSseEvent('reasoning_summary_delta', {
    text: 'internal summary must stay hidden',
    visibility: 'internal',
  }), null);
  assert.equal(backgroundProcessEntryFromSseEvent('reasoning_delta', {
    summary: 'private alternate summary must stay hidden',
    visibility: 'private',
  }), null);
}

function testNarrationBoundaryTrace(): void {
  const entry = backgroundProcessEntryFromSseEvent('token_narration_boundary', {
    text: 'I found the relevant subsystem; now I am checking its recovery path.',
  });
  assert.equal(entry?.type, 'preamble');
  assert.equal(entry?.text, 'I found the relevant subsystem; now I am checking its recovery path.');
  assert.equal(entry?.extra?.reasoningKind, 'full_thought');
}

function testVisibleAgentThoughtTrace(): void {
  const thoughtEntry = backgroundProcessEntryFromSseEvent('agent_thought', {
    text: 'Inspecting the next workspace path.',
    source: 'agent_progress',
    visibility: 'user',
  });
  assert.equal(thoughtEntry?.type, 'think');
  assert.equal(thoughtEntry?.text, 'Inspecting the next workspace path.');
  assert.equal(thoughtEntry?.extra?.visibility, 'user');

  const privateEntry = backgroundProcessEntryFromSseEvent('thinking', {
    thinking: 'Provider-private chain of thought.',
    visibility: 'private',
  });
  assert.equal(privateEntry, null);
}

function testSteerSplitsAdjacentThoughtTrace(): void {
  const stream = createBackgroundAgentStream(1000);
  const processEntries: Record<string, any>[] = [];
  const liveTraceEntries: Record<string, any>[] = [];
  const before = appendBackgroundAgentStreamEvent(stream, 'agent_thought', { text: 'Before steer.' }, 1100);
  appendBackgroundSseTrace(processEntries, liveTraceEntries, 'agent_thought', { text: 'Before steer.' }, before);
  appendBackgroundAgentStreamEvent(stream, 'user_message', { message: 'Change direction.' }, 1200);
  const after = appendBackgroundAgentStreamEvent(stream, 'agent_thought', { text: 'After steer.' }, 1300);
  appendBackgroundSseTrace(processEntries, liveTraceEntries, 'agent_thought', { text: 'After steer.' }, after);
  assert.deepEqual(liveTraceEntries.map((entry) => entry.text), ['Before steer.', 'After steer.']);
  assert.deepEqual(liveTraceEntries.map((entry) => entry.seq), [before.seq, after.seq]);
}

function testStartupDiagnosticsStayOutOfActivity(): void {
  for (const [event, data] of [
    ['ui_preflight', { message: 'Selecting model route...' }],
    ['ui_preflight', { message: 'Loading tool schemas...' }],
    ['progress_state', { reason: 'reset' }],
    ['model_stream_event', { event: { type: 'tool_call_start', name: 'workspace_read' } }],
    ['info', { message: 'Latency: context_build_start at 1169ms' }],
    ['info', { message: 'undefined' }],
  ] as const) {
    assert.equal(backgroundProcessEntryFromSseEvent(event, data), null, `${event} is not agent activity`);
  }
  assert.equal(backgroundProcessEntryFromSseEvent('tool_call', { name: 'workspace_read' })?.type, 'tool');
}

testPersistentAccumulationAndReplay();
testDirectSteerDelivery();
testStructuredToolResultTrace();
testReasoningSummaryTrace();
testNarrationBoundaryTrace();
testVisibleAgentThoughtTrace();
testSteerSplitsAdjacentThoughtTrace();
testStartupDiagnosticsStayOutOfActivity();
{
  const preview = { dataUrl: '/api/canvas/inline?path=frozen.png', artifactKind: 'contact_sheet', title: 'Video contact sheet' };
  const visual = backgroundProcessEntryFromSseEvent('vision_injected', { source: 'media_analysis', preview });
  assert.equal(visual?.type, 'vision');
  assert.deepEqual(visual?.preview, preview, 'background checkpoints preserve the exact analyzed visual');
  const plan = backgroundProcessEntryFromSseEvent('progress_state', { source: 'declared', items: [{ text: 'Inspect frame', status: 'in_progress' }], activeIndex: 0 });
  assert.equal(plan?.extra?.items[0].text, 'Inspect frame');
  assert.equal(plan?.extra?.activeIndex, 0, 'the first active plan step is retained');
}
console.log('background-agent-stream regression: ok');

// Cold checkpoint recovery must keep visible commentary even when the provider
// only emits tokens followed by a tool (no explicit narration boundary).
{
  const stream = createBackgroundAgentStream(1000);
  const processEntries: Record<string, any>[] = [];
  const liveTraceEntries: Record<string, any>[] = [];
  const emit = (event: string, data: any) => {
    const frame = appendBackgroundAgentStreamEvent(stream, event, data);
    appendBackgroundSseTrace(processEntries, liveTraceEntries, event, data, frame);
  };
  emit('token', { text: 'I found ' });
  emit('token', { text: 'the cause.' });
  emit('tool_call', { name: 'workspace_read' });
  assert.equal(liveTraceEntries[0].type, 'preamble');
  assert.equal(liveTraceEntries[0].text, 'I found the cause.');
  assert.equal(liveTraceEntries[1].type, 'tool');
  emit('token', { text: 'Checking the fix.' });
  emit('token_narration_boundary', {});
  emit('tool_call', { name: 'workspace_run' });
  assert.equal(liveTraceEntries.filter(e => e.type === 'preamble').length, 2, 'explicit boundaries must not duplicate commentary');
  emit('token', { text: 'Final answer only.' });
  emit('final', { text: 'Final answer only.' });
  emit('tool_call', { name: 'later_tool' });
  emit('thinking_delta', { thinking: 'PRIVATE THINKING', visibility: 'private' });
  emit('token', { text: 'PRIVATE TOKEN', visibility: 'private' });
  emit('tool_call', { name: 'safe_tool' });
  const recovered = JSON.parse(JSON.stringify({ processEntries, liveTraceEntries }));
  assert.equal(recovered.liveTraceEntries.filter((e: any) => e.type === 'preamble').length, 2);
  assert.doesNotMatch(JSON.stringify(recovered), /PRIVATE/);
  assert.match(JSON.stringify(recovered), /I found the cause/);
  console.log('background commentary checkpoint recovery: ok');
}

// Team callers intentionally discard process entries but retain their trace.
{
  const stream = createBackgroundAgentStream(1000);
  const trace: Record<string, any>[] = [];
  for (const [event, data] of [['token', { text: 'Team commentary.' }], ['tool_call', { name: 'read' }]] as const) {
    appendBackgroundSseTrace([], trace, event, data, appendBackgroundAgentStreamEvent(stream, event, data));
  }
  assert.equal(trace[0].text, 'Team commentary.');
  assert.equal(trace[0].type, 'preamble');
  assert.equal(trace[1].type, 'tool');
  appendBackgroundSseTrace([], trace, 'token', { text: 'Old stream tail.' }, appendBackgroundAgentStreamEvent(stream, 'token', {}));
  const next = createBackgroundAgentStream(2000);
  appendBackgroundSseTrace([], trace, 'tool_call', { name: 'new_run' }, appendBackgroundAgentStreamEvent(next, 'tool_call', {}));
  assert.doesNotMatch(JSON.stringify(trace), /Old stream tail/);
  console.log('team transient process-array commentary recovery: ok');
}
