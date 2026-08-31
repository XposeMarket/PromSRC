import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function importSource(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const pairs = [
  ['web-ui/src/features/chat/core/final-response.js', 'generated/public-web-ui/static/features/chat/core/final-response.js'],
  ['web-ui/src/features/chat/core/error-presentation.js', 'generated/public-web-ui/static/features/chat/core/error-presentation.js'],
  ['web-ui/src/features/chat/core/slash-commands.js', 'generated/public-web-ui/static/features/chat/core/slash-commands.js'],
  ['web-ui/src/features/chat/core/background-agent-work.js', 'generated/public-web-ui/static/features/chat/core/background-agent-work.js'],
  ['web-ui/src/chat-final-response.js', 'generated/public-web-ui/static/chat-final-response.js'],
  ['web-ui/src/chat-error-presentation.js', 'generated/public-web-ui/static/chat-error-presentation.js'],
  ['web-ui/src/chat-slash-commands.js', 'generated/public-web-ui/static/chat-slash-commands.js'],
  ['web-ui/src/background-agent-work.js', 'generated/public-web-ui/static/background-agent-work.js'],
];

for (const [sourcePath, generatedPath] of pairs) {
  assert.equal(
    fs.readFileSync(path.join(root, sourcePath), 'utf8'),
    fs.readFileSync(path.join(root, generatedPath), 'utf8'),
    `${sourcePath} must match its public mirror`,
  );
}

const finalResponse = await importSource('web-ui/src/features/chat/core/final-response.js');
assert.equal(finalResponse.appendFinalResponseDelta('hello', ' world'), 'hello world');
assert.equal(finalResponse.appendFinalResponseDelta('abc', 'abcdef'), 'abcdef');
assert.equal(finalResponse.appendFinalResponseDelta('**', '**'), '****');
assert.equal(finalResponse.reconcileFinalResponse('preview', 'canonical'), 'canonical');
assert.equal(finalResponse.reconcileFinalResponse('preview', ''), 'preview');
const state = {};
assert.equal(finalResponse.beginFinalResponse(state), state);
assert.equal(state.finalResponseStarted, true);

const errors = await importSource('web-ui/src/features/chat/core/error-presentation.js');
assert.equal(errors.presentChatError({ code: 'SESSION_TURN_ACTIVE' }).key, 'session-turn-active');
assert.equal(errors.presentChatError({ mobileStreamDisconnected: true }).key, 'chat-connection-dropped');
assert.equal(errors.presentGoalAction('done', { goal: { id: 'g1', turnsUsed: 2 } }).title, 'Goal stopped');

const slash = await importSource('web-ui/src/features/chat/core/slash-commands.js');
const desktopCommands = slash.getChatSlashCommands('desktop').map((entry) => entry.command);
const mobileCommands = slash.getChatSlashCommands('mobile').map((entry) => entry.command);
assert.equal(desktopCommands.includes('/models'), false);
assert.equal(mobileCommands.includes('/models'), true);
assert.deepEqual(slash.mergeSlashCommandSkillIds('/visual make a chart', ['existing']), ['existing', 'interactive-visuals']);

let backgroundRaw = JSON.stringify([
  { id: 'bg-cache-1', sessionId: 'session-cache', status: 'running', updatedAt: 1 },
]);
let backgroundWriteCount = 0;
globalThis.localStorage = {
  getItem(key) {
    return key === 'prometheus_background_agent_work_v1' ? backgroundRaw : null;
  },
  setItem(key, value) {
    if (key === 'prometheus_background_agent_work_v1') {
      backgroundWriteCount += 1;
      backgroundRaw = String(value);
    }
  },
};

const background = await importSource('web-ui/src/features/chat/core/background-agent-work.js');
const normalized = background.normalizeBackgroundAgentWork({
  id: 'bg-1',
  sessionId: 'session-1',
  state: 'completed',
  result: 'done',
  processEntries: [{ type: 'tool', content: 'worked' }],
});
assert.equal(normalized.id, 'bg-1');
assert.equal(normalized.sessionId, 'session-1');
assert.equal(normalized.status, 'completed');
assert.equal(normalized.events.length, 1);
assert.equal(background.backgroundAgentPreview('a '.repeat(100), 20).length <= 20, true);
assert.equal(background.backgroundAgentAgeLabel(Date.now(), Date.now()), 'just now');
assert.equal(background.resolveBackgroundAgentIdentity('bg-1').name.length > 0, true);
const firstLiveEvent = background.appendBackgroundAgentEvent([], {
  streamId: 'stream-test',
  seq: 1,
  type: 'tool',
  content: 'first',
});
const secondLiveEvent = background.appendBackgroundAgentEvent(firstLiveEvent, {
  streamId: 'stream-test',
  seq: 2,
  type: 'result',
  content: 'second',
});
assert.deepEqual(secondLiveEvent.map((event) => event.seq), [1, 2]);
assert.equal(background.appendBackgroundAgentEvent(secondLiveEvent, {
  streamId: 'stream-test',
  seq: 2,
  type: 'result',
  content: 'second',
}).length, 2, 'duplicate stream events must remain deduplicated');

const firstRead = background.readBackgroundAgentWork();
const secondRead = background.readBackgroundAgentWork();
assert.strictEqual(secondRead, firstRead, 'unchanged serialized background work should reuse the normalized array');
assert.equal(firstRead[0].id, 'bg-cache-1');

backgroundRaw = JSON.stringify([
  { id: 'bg-cache-2', sessionId: 'session-cache', status: 'completed', updatedAt: 2 },
]);
const changedRead = background.readBackgroundAgentWork();
assert.notStrictEqual(changedRead, secondRead, 'changed serialized background work must invalidate the cache');
assert.equal(changedRead[0].id, 'bg-cache-2');

const written = background.writeBackgroundAgentWork([
  { id: 'bg-cache-3', sessionId: 'session-cache', status: 'completed', updatedAt: 3 },
]);
assert.strictEqual(background.readBackgroundAgentWork(), written, 'writes should seed the same normalized cache used by reads');
assert.equal(written[0].id, 'bg-cache-3');

const writesBeforeDeferredPersist = backgroundWriteCount;
background.persistBackgroundAgentWork({
  id: 'bg-live',
  sessionId: 'session-live',
  status: 'running',
  streamId: 'stream-test',
  lastSeq: 1,
  events: [firstLiveEvent[0]],
  updatedAt: 4,
});
background.persistBackgroundAgentWork({
  id: 'bg-live',
  sessionId: 'session-live',
  status: 'running',
  streamId: 'stream-test',
  lastSeq: 2,
  events: secondLiveEvent,
  updatedAt: 5,
});
assert.equal(backgroundWriteCount, writesBeforeDeferredPersist, 'live persistence should be deferred');
background.flushBackgroundAgentWorkPersistence();
assert.equal(backgroundWriteCount, writesBeforeDeferredPersist + 1, 'flush should coalesce deferred persistence into one write');
assert.deepEqual(
  background.findBackgroundAgentWork('bg-live', 'session-live').events.map((event) => event.seq),
  [1, 2],
);

delete globalThis.localStorage;

for (const [wrapper, target] of [
  ['web-ui/src/chat-final-response.js', './features/chat/core/final-response.js'],
  ['web-ui/src/chat-error-presentation.js', './features/chat/core/error-presentation.js'],
  ['web-ui/src/chat-slash-commands.js', './features/chat/core/slash-commands.js'],
  ['web-ui/src/background-agent-work.js', './features/chat/core/background-agent-work.js'],
]) {
  const content = fs.readFileSync(path.join(root, wrapper), 'utf8');
  assert.match(content, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('Chat core contract passed.');
