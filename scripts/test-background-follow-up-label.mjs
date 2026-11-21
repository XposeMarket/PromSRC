// Background follow-up rounds are fresh executions in their root agent's
// conversation. The desktop and mobile docks key lanes by execution id, so a
// round used to appear as a brand-new agent (new name, new color). These checks
// pin the shared presentation contract: a round inherits its root's identity,
// the root is never recolored by its rounds, and the round is labelled.
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
const {
  backgroundAgentFollowUp,
  backgroundAgentFollowUpFields,
  backgroundAgentFollowUpLabel,
  normalizeBackgroundAgentWork,
  persistBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
  resolveBackgroundLaneIdentity,
} = work;

for (const name of ['backgroundAgentFollowUp', 'backgroundAgentFollowUpFields', 'backgroundAgentFollowUpLabel', 'resolveBackgroundLaneIdentity']) {
  assert.equal(typeof compat[name], 'function', `compat entrypoint re-exports ${name}`);
}

const ROOT = 'bg_root-1111';
const ROUND = 'bg_round-2222';
const OTHER = 'bg_other-3333';

// Detection: only a link to a DIFFERENT execution marks a follow-up.
assert.equal(backgroundAgentFollowUp({ bgId: ROOT }), null, 'root frame is not a follow-up');
assert.equal(backgroundAgentFollowUp({ id: ROOT, conversationId: ROOT }), null, 'self link is not a follow-up');
assert.deepEqual(backgroundAgentFollowUp({ bgId: ROUND, conversationId: ROOT, followUpRound: 2 }), { conversationId: ROOT, round: 2 });
assert.deepEqual(
  backgroundAgentFollowUp({ bgId: ROUND, conversationId: ROOT }, { id: ROUND, conversationId: ROOT, followUpRound: 1 }),
  { conversationId: ROOT, round: 1 },
  'a partial frame keeps the round known from the lane',
);
assert.deepEqual(backgroundAgentFollowUpFields({ bgId: ROOT }), {}, 'root lanes get no follow-up fields');
assert.deepEqual(backgroundAgentFollowUpFields({ bgId: ROUND, conversationId: ROOT, followUpRound: 1 }), { conversationId: ROOT, followUpRound: 1 });

// Label copy.
assert.equal(backgroundAgentFollowUpLabel({ id: ROUND, conversationId: ROOT, followUpRound: 1 }), 'Follow-up \u00b7 round 1');
assert.equal(backgroundAgentFollowUpLabel({ id: ROUND, conversationId: ROOT }), 'Follow-up', 'older gateways without a round still read as a follow-up');
assert.equal(backgroundAgentFollowUpLabel({ id: ROOT }), '', 'root lanes are unlabelled');

// Identity: the root and an unrelated agent are live; the round arrives.
const rootIdentity = resolveBackgroundAgentIdentity(ROOT);
const rootLane = { id: ROOT, sessionId: 'main', agentName: rootIdentity.name, agentColor: rootIdentity.color };
const otherIdentity = resolveBackgroundAgentIdentity(OTHER, { usedNames: [rootLane.agentName], usedColors: [rootLane.agentColor] });
const otherLane = { id: OTHER, sessionId: 'main', agentName: otherIdentity.name, agentColor: otherIdentity.color };
const roundFrame = { bgId: ROUND, conversationId: ROOT, followUpRound: 1, sessionId: 'main' };
const roundIdentity = resolveBackgroundLaneIdentity(ROUND, { sources: [roundFrame, {}], lanes: [rootLane, otherLane], sessionId: 'main' });
assert.deepEqual(roundIdentity, { name: rootLane.agentName, color: rootLane.agentColor }, 'round shows as the same agent as its root');
const roundLane = { id: ROUND, sessionId: 'main', ...backgroundAgentFollowUpFields(roundFrame), agentName: roundIdentity.name, agentColor: roundIdentity.color };

// Re-resolving the root or the round never recolors either side.
assert.deepEqual(
  resolveBackgroundLaneIdentity(ROOT, { existingName: rootLane.agentName, existingColor: rootLane.agentColor, sources: [{ bgId: ROOT }, rootLane], lanes: [rootLane, roundLane, otherLane] }),
  rootIdentity,
  'root keeps its identity while its round is on screen',
);
assert.deepEqual(
  resolveBackgroundLaneIdentity(ROUND, { existingName: roundLane.agentName, existingColor: roundLane.agentColor, sources: [{ bgId: ROUND }, roundLane], lanes: [rootLane, roundLane, otherLane] }),
  roundIdentity,
  'a later partial frame keeps the inherited identity',
);
// An unrelated agent still avoids the root's color.
const freshIdentity = resolveBackgroundLaneIdentity('bg_fresh-4444', { sources: [{ bgId: 'bg_fresh-4444' }], lanes: [rootLane, roundLane, otherLane] });
assert.notEqual(freshIdentity.color, rootLane.agentColor, 'unrelated agents still get distinct colors');
assert.notEqual(freshIdentity.name, rootLane.agentName);

// Root cleared from the dock: inherit from durable work, else seed by the conversation.
persistBackgroundAgentWork({ id: ROOT, sessionId: 'main', agentName: 'Iris', agentColor: '#087f96', status: 'completed' }, { immediate: true });
assert.deepEqual(
  resolveBackgroundLaneIdentity(ROUND, { sources: [roundFrame], lanes: [], sessionId: 'main' }),
  { name: 'Iris', color: '#087f96' },
  'durable root work supplies the identity when its lane is gone',
);
storage.clear();
assert.deepEqual(
  resolveBackgroundLaneIdentity(ROUND, { sources: [roundFrame], lanes: [] }),
  resolveBackgroundAgentIdentity(ROOT),
  'with no root anywhere, the round lands on the identity the root would have had',
);

// Durable work keeps the link so a reload still labels the round.
const normalized = normalizeBackgroundAgentWork({ ...roundLane, status: 'completed' });
assert.equal(normalized.conversationId, ROOT);
assert.equal(normalized.followUpRound, 1);
assert.equal(normalizeBackgroundAgentWork({ ...rootLane, status: 'completed' }).conversationId, undefined);

// Both docks and detail headers render the label next to the model.
const desktop = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const mobileRenderer = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-renderer-runtime.js', import.meta.url), 'utf8');
const mobilePage = fs.readFileSync(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8');
assert.match(desktop, /const modelLabel = \[backgroundAgentFollowUpLabel\(lane\), agentModelLabel\(lane\)\]/, 'desktop dock labels rounds');
assert.match(desktop, /side-chat-kicker">\$\{escHtml\(\[backgroundAgentFollowUpLabel\(record\)/, 'desktop detail header labels rounds');
assert.match(desktop, /upsertBackgroundSpawnLane[\s\S]{0,200}resolveBackgroundLaneIdentity\(id/, 'desktop lanes inherit root identity');
assert.match(mobileRenderer, /\[backgroundAgentFollowUpLabel\(lane\), agentModelLabel\(lane\)\]/, 'mobile dock labels rounds');
assert.match(mobileRenderer, /const identity = resolveBackgroundLaneIdentity\(id, \{/, 'mobile lanes inherit root identity');
assert.match(mobilePage, /backgroundRecord\.followUpLabel/, 'mobile detail sheet labels rounds');

console.log('background follow-up label: identity inheritance, labels and durable link OK');
