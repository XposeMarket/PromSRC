import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web-ui/src/pages/ChatPage.js', import.meta.url), 'utf8');
const scheduler = source.slice(source.indexOf('const streamingChatFrames ='), source.indexOf('function syncAssistantWorkTimer()'));
assert.ok(scheduler.startsWith('const streamingChatFrames ='), 'extract the production scheduler');
const frames = [];
const listeners = {};
let patches = 0, fullRenders = 0, patchResult = true, paneRedraws = 0;
const order = [];
const sideList = { dataset: {}, querySelector: () => null };
const sideContainer = { querySelector: sel => (sel === '#side-chat-messages' ? sideList : null) };
const context = {
  Map, String, Number,
  document: {
    hidden: false,
    addEventListener: (event, fn) => { listeners[event] = fn; },
    getElementById: id => (id === 'chat-messages' ? sideContainer : null),
    createElement: () => ({ innerHTML: '', querySelector: () => ({ innerHTML: '<i>pane</i>' }) }),
  },
  window: { activeChatSessionId: 'a', sideChatSplitOpen: false, activeSideChatId: '' },
  requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  patchStreamingChatBubble: () => { patches++; order.push('patch'); return patchResult; },
  renderChatMessages: () => fullRenders++,
  isSessionThinking: () => true,
  getSideChatSession: () => ({ id: 'side1', history: [1, 2] }),
  renderSideChatPaneHtml: () => '<div id="side-chat-messages"></div>',
  setInnerHTMLPreservingVisuals: (el, html) => { if (el === sideList) paneRedraws++; },
  isSessionVisibleInChatSurface: sid => sid === String(context.window.activeChatSessionId)
    || (context.window.sideChatSplitOpen && sid === context.window.activeSideChatId),
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

// Visible split pane: side session tokens patch incrementally (no full redraw).
context.window.sideChatSplitOpen = true;
context.window.activeSideChatId = 'side1';
patchResult = true;
const patchesBeforeSide = patches;
context.renderStreamingChatUpdate('side1');
frames.shift()();
assert.equal(patches, patchesBeforeSide + 1, 'visible side pane is patched incrementally');
assert.equal(fullRenders, 1, 'side pane success does not full-redraw the main chat');

// Failed side-pane patch redraws only that pane, coalesced, never the main chat.
patchResult = false;
for (let i = 0; i < 50; i++) context.renderStreamingChatUpdate('side1');
assert.equal(frames.length, 1, 'side pane burst is one frame');
frames.shift()();
assert.equal(paneRedraws, 1, 'failed side patch redraws the side pane once');
assert.equal(fullRenders, 1, 'failed side patch does not full-redraw the main chat');
assert.equal(sideList.dataset.streamSession, 'side1', 'side pane records its stream version');
context.window.sideChatSplitOpen = false;
patchResult = true;
context.renderStreamingChatUpdate('side1');
assert.equal(frames.length, 0, 'hidden/closed side pane is not rendered');

// onFlushed runs after the patch/DOM write in the same frame (metric + motion hook).
order.length = 0;
patchResult = true;
context.renderStreamingChatUpdate('a', () => order.push('hook'));
frames.shift()();
assert.deepEqual(order, ['patch', 'hook'], 'flush hook runs after the DOM write');

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
console.log('PASS: token batching, visible side-pane patch + pane-only fallback, structural coalescing, visibility, session switch, flush-hook order, idle no-op');
console.log('Scope: production functions in a VM with DOM stubs; not a browser/layout benchmark.');
