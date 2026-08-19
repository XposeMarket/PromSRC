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
  ['web-ui/src/chat-final-response.js', 'generated/public-web-ui/static/chat-final-response.js'],
  ['web-ui/src/chat-error-presentation.js', 'generated/public-web-ui/static/chat-error-presentation.js'],
  ['web-ui/src/chat-slash-commands.js', 'generated/public-web-ui/static/chat-slash-commands.js'],
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

for (const [wrapper, target] of [
  ['web-ui/src/chat-final-response.js', './features/chat/core/final-response.js'],
  ['web-ui/src/chat-error-presentation.js', './features/chat/core/error-presentation.js'],
  ['web-ui/src/chat-slash-commands.js', './features/chat/core/slash-commands.js'],
]) {
  const content = fs.readFileSync(path.join(root, wrapper), 'utf8');
  assert.match(content, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('Chat core contract passed.');
