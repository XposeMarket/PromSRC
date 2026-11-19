import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('web-ui/src/features/chat/multi-chat-workspace-v2.js', 'utf8');
const listeners = new Map();
const stored = new Map();
const focused = [];
const window = {
  activeChatSessionId: 'a', chatSessions: [],
  addEventListener: (name, fn) => listeners.set(name, fn),
  setTimeout: () => 1, clearTimeout() {},
};
const document = {
  readyState: 'loading', addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: (id) => id.endsWith('input') ? { focus: () => focused.push(id) } : null,
  body: { classList: { add() {}, remove() {}, toggle() {} } },
};
const context = vm.createContext({ window, document, console,
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  localStorage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
});
vm.runInContext(source.replaceAll('export function ', 'function ').replaceAll('import.meta.url', '"file:///workspace.js"'), context);
const run = (code) => vm.runInContext(code, context);
const snapshot = () => JSON.parse(run('JSON.stringify(state)'));
run("state = { tabs: [{sessionId:'a'}, {sessionId:'b'}, {sessionId:'c'}], mainSessionId:'a', sideSessionId:'', sourceSessionId:'' }");
assert.equal(run("tabNeighborAfterClose(state.tabs, 'a').sessionId"), 'b');
assert.equal(run("tabNeighborAfterClose(state.tabs, 'c').sessionId"), 'b');
assert.equal(run("tabNeighborAfterClose(state.tabs, 'missing')"), null);
// Run the actual state transitions while isolating native rendering/navigation.
run("render = () => {}; renderTabStrip = () => {}; callNativeSessionSwitcher = (sid) => { window.activeChatSessionId = sid; return true; }");
run("removeTab('a'); syncMainSession()");
assert.equal(window.activeChatSessionId, 'b');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['b', 'c']);
run("reorderTabs('c', 'b')");
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['c', 'b']);
run('persistState(); state.mainSessionId = ""; state.tabs = []; readStoredState()');
assert.equal(snapshot().mainSessionId, 'b');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['c', 'b']);

// Dropping the visible right chat on its own pane focuses it; dragging the left
// chat to the right swaps the panes (both chats stay tabs).
run("state.sideSessionId = 'c'; openSide('c')");
assert.deepEqual(focused, ['side-chat-input']);
run("openSide('b')");
assert.equal(window.activeChatSessionId, 'c', 'swap opens the old right chat on the left');
assert.equal(snapshot().sideSessionId, 'b', 'swap keeps the old left chat on the right');
run('syncMainSession()');
assert.equal(snapshot().mainSessionId, 'c');
assert.equal(snapshot().sideSessionId, 'b');
assert.equal(snapshot().tabs.length, 2);

let closed = 0;
window.activeSideChatId = 'b'; window.sideChatSplitOpen = true;
window.closeSideChatSplit = () => { closed++; window.sideChatSplitOpen = false; };
run("state.sourceSessionId = 'b'; removeTab('b')");
assert.equal(closed, 1);
assert.equal(snapshot().sideSessionId, '');
assert.equal(snapshot().sourceSessionId, '');
assert.ok(!snapshot().tabs.some((tab) => tab.sessionId === 'b'));

// Browser semantics: sidebar navigation reuses the current tab...
window.chatSessions = [
  { id: 'x', title: 'X chat', history: [{ role: 'user', content: 'hi' }] },
  { id: 'y', title: 'Y chat', history: [{ role: 'user', content: 'hi' }] },
  { id: 'z', title: 'Z chat', history: [{ role: 'user', content: 'hi' }] },
  { id: 'w', title: 'W chat', history: [{ role: 'user', content: 'hi' }] },
];
run("state = { tabs: [{sessionId:'x', title:'X chat'}], mainSessionId:'x', sideSessionId:'', sourceSessionId:'' }");
window.activeChatSessionId = 'y';
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y'], 'navigation replaces the idle current tab');
// ...but never navigates a working chat away.
window._sessionThinking = { y: true };
window.activeChatSessionId = 'z';
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y', 'z'], 'a running tab stays and the new chat opens beside it');
window._sessionThinking = {};
// New chat (button or "+") opens a new tab right after the current one.
run("newTabIntent = { sessionId: 'n1', previousSessionId: 'z', at: Date.now() }");
window.activeChatSessionId = 'n1';
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y', 'z', 'n1']);
assert.equal(snapshot().tabs[2].draft, true, 'unsent new chats are flagged as drafts');
assert.equal(run("titleForSession('n1')"), 'New chat');
// Pressing New chat again on an empty draft reuses that tab.
run("newTabIntent = { sessionId: 'n2', previousSessionId: 'n1', at: Date.now() }");
window.activeChatSessionId = 'n2';
window.chatHistory = [];
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y', 'z', 'n2'], 'empty New chat tabs do not stack');
// Unsent drafts reopen under their own id instead of the missing-chat error.
const reopened = [];
window.reopenDesktopDraftChatSession = (sid) => { reopened.push(sid); window.activeChatSessionId = sid; };
run("callNativeSessionSwitcher = " + source.match(/function callNativeSessionSwitcher\([\s\S]*?\n}\n/)[0].replace('function callNativeSessionSwitcher', 'function'));
run("callNativeSessionSwitcher('n2')");
assert.deepEqual(reopened, ['n2']);
run("callNativeSessionSwitcher = (sid) => { window.activeChatSessionId = sid; return true; }");
// Switching to an existing tab never reshuffles tabs.
window.activeChatSessionId = 'z';
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y', 'z', 'n2']);
// Ctrl/middle-click intent opens a sidebar chat in a new tab next to the current one.
run("openInNewTabSessionId = 'w'");
window.activeChatSessionId = 'w';
run('syncMainSession()');
assert.deepEqual(snapshot().tabs.map((tab) => tab.sessionId), ['y', 'z', 'w', 'n2']);
// Sources follow the visible chat; only a two-pane split asks which one.
assert.equal(run('allSourceTabs().length'), 1);
// Closing the left chat of a split promotes the right chat to the whole view.
run("state = { tabs: [{sessionId:'p'}, {sessionId:'q'}], mainSessionId:'p', sideSessionId:'q', sourceSessionId:'' }");
window.activeChatSessionId = 'p'; window.activeSideChatId = 'q'; window.sideChatSplitOpen = true;
closed = 0;
run("removeTab('p')");
assert.equal(closed, 1);
assert.equal(window.activeChatSessionId, 'q');
assert.equal(snapshot().sideSessionId, '');
// Closing the last tab leaves a fresh New chat tab, never an empty strip.
let newChats = 0;
window.newChatSession = () => { newChats++; };
run("state = { tabs: [{sessionId:'q'}], mainSessionId:'q', sideSessionId:'', sourceSessionId:'' }");
run("removeTab('q')");
assert.equal(newChats, 1);
// Cold lazy-load drag: preserve payload synchronously, replay only a live drag.
const intent = fs.readFileSync('web-ui/src/features/chat/multi-chat-intent.js', 'utf8');
const dragListeners = new Map();
let resolveImport;
const importPromise = new Promise((resolve) => { resolveImport = resolve; });
const replayed = [];
const intentContext = vm.createContext({ console,
  window: { addEventListener() {} },
  document: { addEventListener: (name, fn) => dragListeners.set(name, fn) },
  localStorage: { getItem: () => '{}' },
  __PROM_MULTI_CHAT_IMPORT_FOR_TESTS: () => importPromise,
});
vm.runInContext(intent.replace('export function ', 'function '), intentContext);
const data = new Map();
const row = { dataset: { sessionId: 'cold-chat' }, querySelector: () => ({ textContent: 'Cold' }) };
dragListeners.get('dragstart')({ target: { closest: () => row }, dataTransfer: { setData: (key, value) => data.set(key, value) } });
assert.equal(data.get('text/plain'), 'cold-chat');
resolveImport([{ installMultiChatWorkspace() {}, beginSessionDrag: (payload) => replayed.push(payload.sessionId) }]);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(replayed, ['cold-chat']);
dragListeners.get('dragstart')({ target: { closest: () => row }, dataTransfer: { setData() {} } });
dragListeners.get('dragend')();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(replayed.length, 1, 'ended drag must not resurrect drop zones');
const page = fs.readFileSync('web-ui/src/pages/ChatPage.js', 'utf8');
assert.ok(page.includes("dispatchDesktopChatLifecycle('chat-session-deleted', { sessionId: id })"));
assert.ok(page.includes("import { dispatchDesktopChatLifecycle } from '../features/chat/lifecycle.js'"));
const lifecycle = fs.readFileSync('web-ui/src/features/chat/lifecycle.js', 'utf8');
const lifecycleEvents = [];
window.dispatchEvent = (event) => lifecycleEvents.push({ type: event.type, sessionId: event.detail.sessionId });
vm.runInContext(lifecycle.replace('export function ', 'function '), context);
run("dispatchDesktopChatLifecycle('chat-session-deleted', {sessionId:'c'})");
assert.deepEqual(lifecycleEvents, [{ type: 'prometheus:chat-session-deleted', sessionId: 'c' }], 'extracted lifecycle helper preserves the tab deletion event contract');
assert.ok(source.includes("window.addEventListener('prometheus:chat-session-deleted'"));
run("window.chatSessions = [{id:'b', title:'Renamed'}]");
assert.equal(run("titleForSession('b', 'Old')"), 'Renamed');
assert.ok(!source.includes("if (!document.getElementById('prom-multi-chat-tabs')) renderTabStrip()"), 'existing strip must refresh on chat renders after rename');
console.log('multi-chat workspace regressions passed (close, reorder, restore, duplicate focus, delete cleanup, cold drag)');
