// A background follow-up is a fresh execution (own id, own stream) inside its
// root agent's conversation. Both clients keep ONE lane per conversation, keyed
// by the root id, so a follow-up continues the original agent's thread: the
// earlier answer is archived as a finished round and the follow-up prompt shows
// as the next message. These checks pin the shared contract plus the desktop
// wiring (the mobile reducer path is exercised in
// test-mobile-background-agent-reducer.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const work = await import('../web-ui/src/features/chat/core/background-agent-work.js');
const compat = await import('../web-ui/src/background-agent-work.js');
const { createDesktopBackgroundAgentWork, backgroundAgentFollowUpThreadHistory } = await import('../web-ui/src/features/chat/core/desktop-background-agent-work.js');
const {
  advanceBackgroundAgentLane,
  archiveBackgroundAgentRound,
  backgroundAgentFollowUpLink,
  backgroundAgentFollowUpPromptMessage,
  backgroundAgentLaneExecutionId,
  backgroundAgentLaneKey,
  backgroundAgentLaneRoundState,
  backgroundAgentRoundTransition,
  findBackgroundAgentWork,
  normalizeBackgroundAgentRounds,
  persistBackgroundAgentWork,
} = work;

for (const name of ['advanceBackgroundAgentLane', 'archiveBackgroundAgentRound', 'backgroundAgentFollowUpLink', 'backgroundAgentFollowUpPromptMessage',
  'backgroundAgentLaneExecutionId', 'backgroundAgentLaneKey', 'backgroundAgentLaneRoundState',
  'backgroundAgentRoundTransition', 'normalizeBackgroundAgentRounds']) {
  assert.equal(typeof compat[name], 'function', `compat entrypoint re-exports ${name}`);
}

const ROOT = 'bg_root-1111';
const ROUND = 'bg_round-2222';
const ROUND2 = 'bg_round-3333';
const SID = 'chat-1';

// Link + lane key: only a link to a DIFFERENT execution is a follow-up.
assert.equal(backgroundAgentFollowUpLink(ROOT, { bgId: ROOT }), null, 'root frame has no link');
assert.equal(backgroundAgentFollowUpLink(ROOT, { conversationId: ROOT }), null, 'self link is not a follow-up');
assert.deepEqual(backgroundAgentFollowUpLink(ROUND, {}, { conversationId: ROOT, followUpRound: 2 }), { conversationId: ROOT, round: 2 });
assert.equal(backgroundAgentLaneKey(ROUND, { conversationId: ROOT, followUpRound: 1 }), ROOT, 'a round lands in its agent lane');
assert.equal(backgroundAgentLaneKey(ROOT, { bgId: ROOT }), ROOT, 'a root run keys by itself');
assert.equal(backgroundAgentLaneExecutionId({ id: ROOT }), ROOT);
assert.equal(backgroundAgentLaneExecutionId({ id: ROOT, executionId: ROUND }), ROUND, 'steer/status/replay target the shown round');

// Transitions.
const rootLane = { id: ROOT, status: 'completed', result: 'Root answer', startedAt: 1, completedAt: 2 };
const link1 = { conversationId: ROOT, round: 1 };
assert.equal(backgroundAgentRoundTransition({}, ROUND, link1), 'same', 'a fresh lane just adopts the round');
assert.equal(backgroundAgentRoundTransition(rootLane, ROOT, null), 'same');
assert.equal(backgroundAgentRoundTransition(rootLane, ROUND, link1), 'new', 'first follow-up advances the agent');
const roundLane = { id: ROOT, executionId: ROUND, followUpRound: 1, rounds: [{ executionId: ROOT, round: 0 }] };
assert.equal(backgroundAgentRoundTransition(roundLane, ROUND, link1), 'same');
assert.equal(backgroundAgentRoundTransition(roundLane, ROOT, null), 'stale', 'a late root frame never rewinds the agent');
assert.equal(backgroundAgentRoundTransition(roundLane, 'bg_other', { conversationId: ROOT, round: 1 }), 'stale', 'an older/equal round is stale');
assert.equal(backgroundAgentRoundTransition(roundLane, ROUND2, { conversationId: ROOT, round: 2 }), 'new');
assert.equal(backgroundAgentRoundTransition(roundLane, ROUND2, { conversationId: ROOT, round: 0 }), 'new', 'unknown round number still advances once');

// Archive: the current round becomes a finished entry; follow-up rounds keep their prompt.
const archived = archiveBackgroundAgentRound(rootLane, { liveTraceEntries: [{ type: 'preamble', text: 'reading' }] });
assert.equal(archived.length, 1);
assert.deepEqual([archived[0].executionId, archived[0].round, archived[0].prompt, archived[0].result], [ROOT, 0, '', 'Root answer']);
const archived2 = archiveBackgroundAgentRound({ ...roundLane, rounds: archived, roundPrompt: 'Which file?', result: 'scope.ts', status: 'completed' });
assert.deepEqual(archived2.map((round) => [round.executionId, round.round, round.prompt]), [[ROOT, 0, ''], [ROUND, 1, 'Which file?']]);
const many = normalizeBackgroundAgentRounds(Array.from({ length: 20 }, (_, index) => ({
  executionId: `bg_${index}`, round: index, liveTraceEntries: Array.from({ length: 400 }, () => ({ type: 'info', text: 'x' })),
})));
assert.equal(many.length, 8, 'archive keeps a bounded number of rounds');
assert.equal(many[0].round, 12, 'oldest rounds drop first');
assert.ok(many.every((round) => round.liveTraceEntries.length <= 160), 'each archived round is bounded');

const promptMessage = backgroundAgentFollowUpPromptMessage('Which file?', { laneId: ROOT, executionId: ROUND, round: 1, timestamp: 5 });
assert.deepEqual([promptMessage.role, promptMessage.content, promptMessage.timestamp], ['user', 'Which file?', 5]);
assert.equal(backgroundAgentFollowUpPromptMessage('', {}), null);

// Durable work (shared + desktop writer): a newer round replaces per-round
// buffers; an older round's late write never overwrites it.
const desktop = createDesktopBackgroundAgentWork({
  mergeBackgroundAgentEvents: work.mergeBackgroundAgentEvents,
  mergeBackgroundAgentTraceEntries: work.mergeBackgroundAgentTraceEntries,
  mergeBackgroundAgentSteerMessages: work.mergeBackgroundAgentSteerMessages,
  normalizeBackgroundAgentWork: work.normalizeBackgroundAgentWork,
  readBackgroundAgentWork: work.readBackgroundAgentWork,
  writeBackgroundAgentWork: work.writeBackgroundAgentWork,
});
for (const [label, persist] of [['shared', persistBackgroundAgentWork], ['desktop', desktop.persistBackgroundAgentWork]]) {
  storage.clear();
  const rootEvents = [{ type: 'tool', content: 'Read scope.ts', streamId: 's_root', seq: 1 }];
  persist({ id: ROOT, sessionId: SID, task: 'Review scope', status: 'completed', result: 'Root answer', events: rootEvents, streamId: 's_root', lastSeq: 1 }, { immediate: true });
  persist({
    id: ROOT, sessionId: SID, task: 'Review scope', executionId: ROUND, followUpRound: 1, roundPrompt: 'Which file?',
    rounds: archiveBackgroundAgentRound({ id: ROOT, status: 'completed', result: 'Root answer' }, { processEntries: rootEvents }),
    status: 'running', events: [], streamId: 's_round', lastSeq: 0,
  }, { immediate: true });
  let stored = findBackgroundAgentWork(ROOT, SID);
  assert.equal(stored.followUpRound, 1, `${label}: record advanced to the follow-up`);
  assert.equal(stored.executionId, ROUND);
  assert.equal(stored.roundPrompt, 'Which file?');
  assert.equal(stored.events.length, 0, `${label}: the archived round's events are not merged back into the follow-up`);
  assert.equal(stored.result, '', `${label}: the follow-up starts without the earlier answer`);
  assert.match(stored.rounds[0].result, /Root answer/, `${label}: the earlier answer is kept in the archive`);
  persist({ id: ROOT, sessionId: SID, task: 'Review scope', status: 'completed', result: 'stale root write', events: rootEvents }, { immediate: true });
  stored = findBackgroundAgentWork(ROOT, SID);
  assert.equal(stored.followUpRound, 1, `${label}: an older round never overwrites a newer one`);
  assert.notEqual(stored.result, 'stale root write');
  persist({ id: ROOT, sessionId: SID, executionId: ROUND, followUpRound: 1, status: 'completed', result: 'scope.ts', events: [{ type: 'final', content: 'done', streamId: 's_round', seq: 2 }], streamId: 's_round', lastSeq: 2 }, { immediate: true });
  stored = findBackgroundAgentWork(ROOT, SID);
  assert.equal(stored.result, 'scope.ts', `${label}: same-round writes still merge`);
  assert.equal(stored.rounds.length, 1, `${label}: archive survives a same-round write without rounds`);
}

// Desktop wiring (ChatPage.js is a browser module; pin the integration points).
const chatPage = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
assert.match(chatPage, /function backgroundSpawnLaneId\(msg = \{\}\) \{\s*return backgroundAgentLaneKey\(/, 'desktop lanes key by conversation root');
assert.match(chatPage, /if \(!advanceBackgroundAgentLane\(existing, executionId, link, \{[\s\S]{0,400}?\}\)\) return null;/, 'desktop upsert advances rounds and drops stale frames');
const mobileRenderer = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-renderer-runtime.js', import.meta.url), 'utf8');
assert.match(mobileRenderer, /if \(!advanceBackgroundAgentLane\(existing, executionId, link, \{[\s\S]{0,400}?\}\)\) return null;/, 'mobile upsert advances rounds and drops stale frames');

// Shared round advance: a new round archives the old answer and resets per-round state.
{
  const lane = { id: ROOT, status: 'completed', result: 'Root answer', events: [{ type: 'final' }], lastSeq: 9, steerMessages: [{ content: 'hi' }] };
  assert.equal(advanceBackgroundAgentLane(lane, ROUND, link1, { startedAt: 5, snapshot: () => ({ processEntries: lane.events }), reset: { events: [] } }), true);
  assert.equal(lane.executionId, ROUND);
  assert.equal(lane.followUpRound, 1);
  assert.equal(lane.result, '');
  assert.equal(lane.status, 'running');
  assert.equal(lane.lastSeq, 0);
  assert.deepEqual(lane.events, []);
  assert.equal(lane.rounds.length, 1);
  assert.equal(lane.rounds[0].result, 'Root answer');
  assert.equal(lane.rounds[0].processEntries.length, 1, 'snapshot is read before the reset');
  assert.equal(advanceBackgroundAgentLane(lane, ROOT, null), false, 'a late root frame is dropped');
  assert.deepEqual(backgroundAgentLaneRoundState({ id: ROOT }, ROOT, ROUND), { executionId: ROUND, followUpRound: undefined, roundPrompt: '', rounds: [] });
}

// Shared thread history: earlier round answers, then the current follow-up prompt.
{
  const history = backgroundAgentFollowUpThreadHistory({
    id: ROOT,
    executionId: ROUND,
    followUpRound: 1,
    roundPrompt: 'Which file?',
    startedAt: 10,
    rounds: [{ executionId: ROOT, round: 0, result: 'Root answer', status: 'completed', steerMessages: [{ content: 'also check tests', timestamp: 2 }] }],
  }, { name: 'Daphne', color: '#087f96' }, '<i>D</i>');
  assert.deepEqual(history.map((entry) => entry.role), ['user', 'ai', 'user'], 'steer, earlier answer, then follow-up prompt');
  assert.equal(history[0].channelLabel, 'steer');
  assert.equal(history[1].workflowAvatarHtml, '<i>D</i>');
  assert.equal(history[1].workflowLabel, 'Daphne');
  assert.equal(history[2].content, 'Which file?');
}
assert.match(chatPage, /\/api\/background\/\$\{encodeURIComponent\(executionId\)\}\/stream/, 'desktop replays the shown round');
assert.match(chatPage, /const backgroundId = backgroundAgentLaneExecutionId\(ensureBackgroundSpawnDockMap\(\)\.get\(laneId\)\) \|\| laneId;/, 'desktop steers the shown round');
assert.match(chatPage, /steerHistory\.unshift\(\.\.\.backgroundAgentFollowUpThreadHistory\(record, identity, renderBackgroundAgentWorkflowAvatar\(identity\)\)\)/, 'desktop detail prepends the earlier rounds and the follow-up prompt');

const mobilePage = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8');
assert.match(mobilePage, /loadMobileBackgroundStatus\(executionId\)/, 'mobile polls the shown round');
assert.match(mobilePage, /sendMobileBackgroundSteer\(steerTarget, msg\)/, 'mobile steers the shown round');
assert.match(mobilePage, /\$\{promptHtml\}\$\{priorRoundsHtml\}\$\{currentFollowUpHtml\}\$\{timelineHtml\}/, 'mobile detail renders the whole conversation');

console.log('background follow-up thread: one lane per conversation, rounds archived, stale frames dropped OK');
