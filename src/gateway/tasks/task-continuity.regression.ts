import assert from 'node:assert/strict';

import {
  buildTaskContinuitySnapshot,
  formatTaskContinuityForPrompt,
  serializeTaskSessionMessage,
} from './task-continuity.js';

const task: any = {
  id: 'continuity-fixture',
  title: 'Resume the fixture task',
  prompt: 'Inspect the workspace and continue from the last verified boundary.',
  originalAssignment: 'Inspect the workspace and continue from the last verified boundary.',
  currentStepIndex: 1,
  plan: [
    { index: 0, description: 'Inspect the workspace', status: 'done' },
    { index: 1, description: 'Continue from the checkpoint', status: 'running' },
  ],
  status: 'running',
  pauseReason: undefined,
  pendingClarificationQuestion: undefined,
};

const processEntries = [
  {
    type: 'preamble',
    content: 'I verified the workspace before the next boundary.',
    source: 'agent_thought',
    visibility: 'user',
  },
  { type: 'tool', content: 'read_file self/index.md' },
  { type: 'result', content: 'The subsystem map is present.' },
  {
    type: 'think',
    content: 'private provider reasoning must not be replayed',
    source: 'provider_thinking',
    visibility: 'private',
  },
];

const snapshot = buildTaskContinuitySnapshot({
  task,
  sessionId: 'task_continuity_fixture',
  status: 'aborted',
  processEntries,
  visibleReasoningSummary: 'The next step is the continuation boundary.',
  resultText: 'The task was interrupted after verification.',
  abortReason: 'gateway_restart',
});

assert.equal(snapshot.packet.status, 'aborted');
assert.match(snapshot.commentaryContext, /verified the workspace/);
assert.match(snapshot.commentaryContext, /read_file/);
assert.doesNotMatch(snapshot.commentaryContext, /private provider reasoning/);
assert.match(formatTaskContinuityForPrompt({
  latestContextSummary: 'Earlier work was compacted into this summary.',
  commentaryContext: snapshot.commentaryContext,
  lastTurnPacket: snapshot.packet,
  onResumeInstruction: 'Continue from the saved boundary.',
} as any), /TASK_CONTINUITY_PACKET/);
assert.match(formatTaskContinuityForPrompt({
  latestContextSummary: 'Earlier work was compacted into this summary.',
  commentaryContext: snapshot.commentaryContext,
  lastTurnPacket: snapshot.packet,
  onResumeInstruction: 'Continue from the saved boundary.',
} as any), /gateway_restart/);
assert.doesNotMatch(
  formatTaskContinuityForPrompt({
    latestContextSummary: 'Earlier work was compacted into this summary.',
    commentaryContext: snapshot.commentaryContext,
    lastTurnPacket: snapshot.packet,
    onResumeInstruction: 'Continue from the saved boundary.',
  } as any),
  /private provider reasoning/,
  'the structured resume packet must not replay provider-private reasoning either',
);

const serialized = serializeTaskSessionMessage({
  role: 'assistant',
  content: 'Checkpoint response',
  timestamp: Date.now(),
  commentaryContext: snapshot.commentaryContext,
  processEntries,
  liveTraceEntries: [{ type: 'tool', text: 'read_file self/index.md' }],
});
assert.match(String(serialized.commentaryContext || ''), /verified the workspace/);
assert.equal(serialized.processEntries?.length, processEntries.length);

console.log('task continuity regression: ok');
