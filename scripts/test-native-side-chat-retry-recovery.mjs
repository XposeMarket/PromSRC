import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const sourcePath = path.join(root, 'web-ui/src/features/chat/multi-chat-workspace-v2.js');
const generatedPath = path.join(root, 'generated/public-web-ui/static/features/chat/multi-chat-workspace-v2.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');

assert.equal(generated, source, 'generated multi-chat workspace must mirror source');
assert.match(
  source,
  /function revealNativeSide\(attempt = 0, expectedSessionId = state\.sideSessionId\)/,
  'native-side retry chain must capture the session it is opening',
);
assert.match(
  source,
  /if \(!sid \|\| !expectedSid \|\| sid !== expectedSid\) return false;/,
  'a stale retry chain must stop after the requested side session changes',
);
assert.match(
  source,
  /setTimeout\(\(\) => revealNativeSide\(attempt \+ 1, expectedSid\), 100\)/,
  'retries must stay bound to the original side session',
);
assert.match(
  source,
  /if \(pendingSideSessionId === expectedSid && state\.sideSessionId === expectedSid\) \{[\s\S]*?pendingSideSessionId = '';[\s\S]*?state\.sideSessionId = '';[\s\S]*?persistState\(\);[\s\S]*?renderTabStrip\(\);/,
  'retry exhaustion must clear phantom side-pane state while keeping the retained tab available',
);

const storage = new Map();
const retryQueue = [];
const sideCalls = [];
const classNames = new Set();
const strip = { setAttribute() {}, innerHTML: '', hidden: false };
const mainShell = {
  firstElementChild: {},
  insertBefore(node) {
    node.parentElement = this;
  },
};

globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};
globalThis.document = {
  readyState: 'loading',
  body: { classList: {
    add(...names) { names.forEach((name) => classNames.add(name)); },
    remove(...names) { names.forEach((name) => classNames.delete(name)); },
    toggle(name, force) {
      if (force === undefined ? !classNames.has(name) : force) classNames.add(name);
      else classNames.delete(name);
    },
  } },
  addEventListener() {},
  querySelector(selector) {
    return selector === '.main-shell' ? mainShell : null;
  },
  querySelectorAll() { return []; },
  getElementById(id) {
    if (id === 'prom-multi-chat-tabs') return strip;
    return null;
  },
  createElement() {
    return { dataset: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } };
  },
};
globalThis.window = {
  activeChatSessionId: 'main',
  state: {},
  agentSessionId: '',
  chatSessions: [
    { id: 'main', title: 'Main' },
    { id: 'side-a', title: 'Side A' },
    { id: 'side-b', title: 'Side B' },
    { id: 'side-c', title: 'Side C' },
  ],
  sideChatLinks: [],
  sideChatSplitOpen: false,
  activeSideChatId: '',
  showSideChatSplit(sessionId) {
    sideCalls.push(sessionId);
    return false;
  },
  closeSideChatSplit() {},
  setTimeout(callback) {
    retryQueue.push(callback);
    return retryQueue.length;
  },
  clearTimeout() {},
  addEventListener() {},
  dispatchEvent() {},
};

const runtimeModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const workspace = runtimeModule && window.__PROM_MULTI_CHAT_WORKSPACE;
workspace.openSide('side-a');
assert.deepEqual(workspace.getState().tabs.map((tab) => tab.sessionId), ['main', 'side-a'], 'opening a side chat must retain Main as the first tab');
assert.equal(strip.parentElement, mainShell, 'the multi-chat tab rail must live in the main shell above the context header');
const staleRetry = retryQueue.shift();
assert.equal(typeof staleRetry, 'function', 'the first unavailable side open must schedule a retry');
workspace.openSide('side-b');
staleRetry();
assert.deepEqual(sideCalls, ['side-a', 'side-b'], 'an old retry must not reopen the newly selected side session');
assert.equal(workspace.getState().sideSessionId, 'side-b');

workspace.closeSide();
retryQueue.length = 0;
workspace.openSide('side-c');
for (let attempt = 0; attempt < 30; attempt += 1) {
  const retry = retryQueue.shift();
  assert.equal(typeof retry, 'function', `retry ${attempt + 1} should be scheduled`);
  retry();
}
const finalState = workspace.getState();
assert.equal(finalState.sideSessionId, '', 'retry exhaustion must clear the phantom side designation');
assert.ok(finalState.tabs.some((tab) => tab.sessionId === 'side-c'), 'retry exhaustion must retain the chat tab');
assert.equal(storage.has('prometheus_multi_chat_tabs_v3'), true, 'retry exhaustion must persist cleared side state');

console.log('native side-chat retry recovery contract: ok');
