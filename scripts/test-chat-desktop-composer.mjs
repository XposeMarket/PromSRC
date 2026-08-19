import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/features/chat/composer/desktop-composer.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/composer/desktop-composer.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(
  fs.readFileSync(sourcePath, 'utf8'),
  fs.readFileSync(generatedPath, 'utf8'),
  'desktop composer source must match its public mirror',
);

const { window } = parseHTML('<html><body><div id="chat-model-name">Fallback Model</div></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.Event = window.Event;

const mod = await import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}`);
const markup = mod.renderUnifiedDesktopComposerHtml({
  inputId: 'composer-test',
  stagingId: 'composer-staging',
  placeholder: '<Write & send>',
  modelName: 'Sol & Luna',
  queueBadgeId: 'composer-queue',
  queueCount: 2,
  sendAction: 'submitComposer()',
});
assert.match(markup, /data-unified-composer="1"/);
assert.match(markup, /id="composer-test"/);
assert.match(markup, /id="composer-staging"/);
assert.match(markup, /id="composer-queue"/);
assert.match(markup, /2 queued/);
assert.match(markup, /&lt;Write &amp; send&gt;/);
assert.match(markup, /Sol &amp; Luna/);
assert.match(markup, /onclick="submitComposer\(\)"/);

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/composer\/desktop-composer\.js'/);
assert.equal(chat.includes('function renderUnifiedDesktopComposerHtml('), false);
assert.equal(chat.includes('function toggleUnifiedDesktopComposerDictation('), false);
assert.match(chat, /renderUnifiedDesktopComposerHtml\(/);
assert.match(chat, /toggleUnifiedDesktopComposerDictation\(/);

console.log('Desktop chat composer component contract passed.');
