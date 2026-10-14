import assert from 'node:assert/strict';
import { evaluateRestartReplay, isRealAssistantReply } from './restart-replay-guard';

// Real shape from mobile_mv756r24_ubnpah (2026-10-14): the turn started at
// 02:00:05, a crashed handoff replacement wrote an interruption checkpoint at
// 02:02:47, the original turn kept running on the draining gateway and answered
// at 02:15:42, then a background-completion wake replayed the stale interrupted
// runtime and answered the same _clientRequestId again at 02:16:17.
const rid = 'mobile_mv756r24_ubnpah_mv7gpssn_ad2nibmo';
const startedAt = Date.parse('2026-10-14T02:00:05.568Z');
const interruptedAt = Date.parse('2026-10-14T02:02:47.710Z');
const runtime = { clientRequestId: rid, startedAt, interruptedAt };

const history = [
  { role: 'user', content: 'What the fuck was that?', timestamp: startedAt, _clientRequestId: rid },
  { role: 'assistant', content: '[Interrupted by gateway restart]\nRuntime: Main chat', timestamp: interruptedAt },
  { role: 'assistant', content: '[Internal tool observation omitted.]', timestamp: interruptedAt + 134_000, workflowPart: 'before_interruption' },
  { role: 'user', content: 'I didnt get ANY response from the goal', timestamp: interruptedAt + 134_001, workflowPart: 'interruption' },
  { role: 'assistant', content: "You're right. From where you were, the goal never answered", timestamp: Date.parse('2026-10-14T02:15:42.632Z'), _clientRequestId: rid, workflowPart: 'interruption_response' },
];

// 1. The incident: already answered -> no replay.
const verdict = evaluateRestartReplay(runtime, history);
assert.equal(verdict.replay, false, 'a request answered after the interruption must not be replayed');
assert.equal((verdict as any).reason, 'already_answered');

// 2. Genuinely interrupted with no answer yet -> replay (steer rows do not count as new requests).
assert.deepEqual(evaluateRestartReplay(runtime, history.slice(0, 4)), { replay: true });

// 3. Only restart bookkeeping after the interruption -> replay.
assert.deepEqual(evaluateRestartReplay(runtime, [
  ...history.slice(0, 2),
  { role: 'assistant', content: '[Hot restart checkpoint: planned by this chat]\nGateway restart successful.', timestamp: interruptedAt + 30_000, messageKind: 'restart_checkpoint' },
  { role: 'assistant', content: 'Gateway restarted. Goal continuing.', timestamp: interruptedAt + 31_000, messageKind: 'goal_restart_notice' },
]), { replay: true });

// 4. Planned restart: the turn's own pre-restart summary does not count; the continuation must run.
const preRestartSummary = [
  ...history.slice(0, 1),
  { role: 'assistant', content: 'Merged and built; restarting the gateway now.', timestamp: interruptedAt - 1_000, _clientRequestId: rid },
];
assert.deepEqual(evaluateRestartReplay(runtime, preRestartSummary, { plannedRestart: true }), { replay: true });

// 4b. Unplanned: a finished reply for this request (written before the crash
// interrupted post-final cleanup) means the turn completed -> no replay.
// Shape of mobile_muiukb70 / mobile_mutv05vj 2026-10-07: the same request was
// answered twice 16-32s apart.
const completed = evaluateRestartReplay(runtime, preRestartSummary);
assert.equal(completed.replay, false);
assert.equal((completed as any).reason, 'already_answered');

// 5. The user moved on to a new request -> stale replay is skipped.
const superseded = evaluateRestartReplay(runtime, [
  ...history.slice(0, 2),
  { role: 'user', content: 'Start PR 4 instead', timestamp: interruptedAt + 60_000 },
]);
assert.equal(superseded.replay, false);
assert.equal((superseded as any).reason, 'superseded_by_newer_request');

// 6. An answer that belongs to a DIFFERENT request id is not this request's answer.
assert.deepEqual(evaluateRestartReplay(runtime, [
  ...history.slice(0, 2),
  { role: 'assistant', content: 'Reply to some other turn', timestamp: interruptedAt + 60_000, _clientRequestId: 'other_request' },
]), { replay: true });

// 7. Runtimes without a request id still dedupe on any real answer after the cutoff.
assert.equal(evaluateRestartReplay({ startedAt, interruptedAt }, history).replay, false);

assert.equal(isRealAssistantReply({ role: 'assistant', content: 'x', messageKind: 'goal_turn' }), false);
assert.equal(isRealAssistantReply({ role: 'assistant', content: 'Done.' }), true);

console.log('PASS restart replay guard: answered/superseded interrupted turns are not replayed');

// 7. mobile_mv756r24_ubnpah 2026-10-14 12:31Z: a gateway-stopped checkpoint
// ("This turn was stopped by the gateway ... Stopped before any tool calls
// completed") was tagged with the request id and counted as the answer, so
// RuntimeRecovery skipped the real continuation as `already_answered`.
{
  const deployRid = 'mobile_mv756r24_ubnpah_deploy';
  const deployStart = Date.parse('2026-10-14T12:20:00.000Z');
  const deployInterrupted = Date.parse('2026-10-14T12:31:20.000Z');
  const deployRuntime = { clientRequestId: deployRid, startedAt: deployStart, interruptedAt: deployInterrupted };
  const flagged = {
    role: 'assistant',
    content: '**This turn was stopped by the gateway, not by you.** Gateway restart interrupted the active turn (gateway_restart)\n\nStopped before any tool calls completed.',
    timestamp: Date.parse('2026-10-14T12:31:25.723Z'),
    _clientRequestId: deployRid,
    interruptionCheckpoint: true,
  };
  assert.equal(isRealAssistantReply(flagged as any), false, 'flagged system-stop checkpoint is not an answer');
  // Legacy rows persisted before the flag existed are caught by their prefix.
  const legacy = { ...flagged } as any;
  delete legacy.interruptionCheckpoint;
  assert.equal(isRealAssistantReply(legacy), false, 'legacy system-stop checkpoint is not an answer');
  const deployHistory = [
    { role: 'user', content: 'merge both and deploy', timestamp: deployStart, _clientRequestId: deployRid },
    flagged,
  ];
  assert.deepEqual(evaluateRestartReplay(deployRuntime, deployHistory as any), { replay: true }, 'continuation must replay');
  assert.deepEqual(evaluateRestartReplay(deployRuntime, [deployHistory[0], legacy] as any), { replay: true });
  // A real deployed summary written later still counts.
  const answered = evaluateRestartReplay(deployRuntime, [
    ...deployHistory,
    { role: 'assistant', content: 'Deployed e15305550, health 200.', timestamp: deployInterrupted + 120_000, _clientRequestId: deployRid },
  ] as any);
  assert.equal(answered.replay, false);
  assert.equal((answered as any).reason, 'already_answered');
}

console.log('restart-replay-guard: system-stop checkpoint cases passed');
