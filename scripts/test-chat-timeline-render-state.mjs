import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'web-ui/src/features/chat/timeline/render-state.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/timeline/render-state.js');
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');

assert.equal(
  fs.readFileSync(sourcePath, 'utf8'),
  fs.readFileSync(generatedPath, 'utf8'),
  'timeline render-state source must match its public mirror',
);

const mod = await import(`${pathToFileURL(sourcePath).href}?test=${Date.now()}`);
const expected = [
  'captureProcessPanelScroll',
  'restoreProcessPanelScroll',
  'captureQuestionDraftState',
  'restoreQuestionDraftState',
  'captureApprovalDetailsState',
  'restoreApprovalDetailsState',
];
for (const name of expected) assert.equal(typeof mod[name], 'function', `${name} must be exported`);

const chat = fs.readFileSync(chatPath, 'utf8');
assert.match(chat, /from '\.\.\/features\/chat\/timeline\/render-state\.js'/);
for (const name of expected) {
  assert.equal(chat.includes(`function ${name}(`), false, `${name} must no longer be declared in ChatPage.js`);
  assert.match(chat, new RegExp(`\\b${name}\\(`), `${name} call sites must remain wired in ChatPage.js`);
}

console.log('Chat timeline render-state ownership contract passed.');
