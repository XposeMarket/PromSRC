import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('web-ui/src/features/chat/composer-drafts.js').replace(/\bexport\s+/g, '');
const values = new Map();
const context = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  },
  Date,
};
vm.runInNewContext(`${source}\nthis.drafts = { composerDraftKey, readComposerDraft, saveComposerDraft, moveComposerDraft };`, context);
const { composerDraftKey: key, readComposerDraft: readDraft, saveComposerDraft: saveDraft, moveComposerDraft: moveDraft } = context.drafts;

const a = key('mobile', 'chat-a', 'gateway-1');
const b = key('mobile', 'chat-b', 'gateway-1');
const otherGateway = key('mobile', 'chat-a', 'gateway-2');
const desktop = key('desktop', 'chat-a');
saveDraft(a, 'half typed in A');
saveDraft(b, 'message in B');
assert.equal(readDraft(a), 'half typed in A');
assert.equal(readDraft(b), 'message in B');
assert.equal(readDraft(otherGateway), '');
assert.equal(readDraft(desktop), '');
saveDraft(b, '');
assert.equal(readDraft(b), '');
assert.equal(readDraft(a), 'half typed in A');
moveDraft(a, key('mobile', 'promoted-chat', 'gateway-1'));
assert.equal(readDraft(a), '');
assert.equal(readDraft(key('mobile', 'promoted-chat', 'gateway-1')), 'half typed in A');

const mobile = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const desktopPage = read('web-ui/src/pages/ChatPage.js');
const desktopSend = read('web-ui/src/features/chat/runtime/desktop-send-chat-runtime.js');
const mobileApi = read('web-ui/src/mobile/mobile-api.js');
assert.match(mobile, /input\.value = readComposerDraft\(draftKeyFor\(\)\)/);
assert.match(mobile, /restoreRejectedMessage\(\)/);
assert.match(mobileApi, /cb\('onAccepted'\)/);
assert.match(desktopPage, /syncDesktopComposerDraft\(\)/);
assert.match(desktopSend, /!chatRequestAccepted && !queuedTurn/);
console.log('[test-chat-composer-drafts] passed');
