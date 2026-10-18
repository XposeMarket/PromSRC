import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const scheduler = source.slice(source.indexOf('const streamingChatFrames ='), source.indexOf('function syncAssistantWorkTimer()'));
assert.ok(scheduler.startsWith('const streamingChatFrames ='), 'extract the production scheduler');
const frames = [];
const listeners = {};
let patches = 0, fullRenders = 0, patchResult = true;
const context = {
  Map, String,
  document: { hidden: false, addEventListener: (event, fn) => { listeners[event] = fn; } },
  window: { activeChatSessionId: 'a' },
  requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  patchStreamingChatBubble: () => { patches++; return patchResult; },
  renderChatMessages: () => fullRenders++,
  isSessionThinking: () => true,
};
vm.runInNewContext(scheduler, context);
const burst = () => { for (let i = 0; i < 100; i++) context.renderStreamingChatUpdate('a'); };
burst();
assert.equal(frames.length, 1);
frames.shift()();
assert.equal(patches, 1);
assert.equal(fullRenders, 0);
patchResult = false;
burst();
assert.equal(frames.length, 1);
frames.shift()();
assert.equal(fullRenders, 1, 'structural fallback is coalesced, not once per token');
context.document.hidden = true;
burst();
assert.equal(frames.length, 0);
context.document.hidden = false;
listeners.visibilitychange();
assert.equal(frames.length, 1, 'visible tab catches up');
context.window.activeChatSessionId = 'b';
frames.shift()();
assert.equal(fullRenders, 1, 'stale session frame cannot rebuild a different chat');
context.window.activeChatSessionId = 'a';
patchResult = true;
burst();
frames.shift()();
assert.equal(patches, 3, 'completed/stale frames release their session key');

// Exercise the actual production idle timer: no body renderer or markdown path
// is provided, so accidental work there fails instead of silently passing.
let tick, writes = 0;
const label = { _text: '', get textContent() { return this._text; }, set textContent(v) { writes++; this._text = v; } };
Object.assign(context, {
  setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
  getSessionStreamState: () => ({ turnStartedAt: 1 }),
  formatAssistantWorkDuration: () => '5s',
});
context.document.getElementById = () => ({ classList: { toggle() {} } });
context.document.querySelector = () => label;
vm.runInNewContext(source.slice(source.indexOf('function syncAssistantWorkTimer()'), source.indexOf('async function copyChatMessage(')), context);
context.syncAssistantWorkTimer();
tick(); tick();
assert.equal(writes, 1, 'unchanged elapsed label is a no-op');
context.document.hidden = true;
tick();
assert.equal(writes, 1);
console.log('PASS: token batching, structural fallback coalescing, visibility, session switch, idle no-op');
console.log('Scope: production functions in a VM with DOM stubs; not a browser/layout benchmark.');
