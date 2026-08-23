import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.detail = options.detail;
    }
  };
}

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
      return values.has(name);
    },
    contains: (name) => values.has(name),
  };
}

function fakeElement() {
  const element = new EventTarget();
  return Object.assign(element, {
    dataset: {},
    style: {},
    classList: classList(),
    appendChild() {},
    prepend() {},
    remove() {},
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    click() {},
    innerHTML: '',
    textContent: '',
  });
}

const documentRef = Object.assign(new EventTarget(), {
  readyState: 'complete',
  head: fakeElement(),
  body: fakeElement(),
  createElement: fakeElement,
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
});
const windowRef = Object.assign(new EventTarget(), {
  document: documentRef,
  location: { origin: 'https://optional.test' },
  chatSessions: [
    { id: 'main-session', title: 'Main' },
    { id: 'side-session', title: 'Side' },
  ],
  activeChatSessionId: 'main-session',
  sideChatLinks: [],
  setTimeout,
  clearTimeout,
});
const storage = new Map();
globalThis.document = documentRef;
globalThis.window = windowRef;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

// A transient hashed/dynamic chunk failure must not poison the optional owner
// for the remainder of the page. Queued synchronous facade work must survive
// the failed attempt and flush after the next first-use retry succeeds.
let retryImportAttempts = 0;
globalThis.__PROM_TOOL_ACTIVITY_IMPORT_FOR_TESTS = async () => {
  retryImportAttempts += 1;
  if (retryImportAttempts === 1) throw new Error('simulated stale optional chunk');
  return import('../web-ui/src/tool-activity.js');
};
const retryToolActivity = await import(`../web-ui/src/features/chat/optional/tool-activity-runtime.js?retry=${Date.now()}`);
retryToolActivity.setToolActivityDisclosureState('retry-disclosure', true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(retryToolActivity.getToolActivityFeatureState().state, 'error', 'first chunk failure should be visible but recoverable');
assert.equal(retryToolActivity.getToolActivityFeatureState().pendingOperations, 1, 'queued tool state must survive a transient chunk failure');
await retryToolActivity.loadToolActivityFeature();
assert.equal(retryImportAttempts, 2, 'a later first-use attempt must retry the failed optional chunk');
assert.equal(retryToolActivity.getToolActivityFeatureState().state, 'ready');
assert.equal(retryToolActivity.getToolActivityFeatureState().pendingOperations, 0, 'queued tool state must flush after recovery');
delete globalThis.__PROM_TOOL_ACTIVITY_IMPORT_FOR_TESTS;

const toolActivity = await import('../web-ui/src/features/chat/optional/tool-activity-runtime.js');
assert.equal(toolActivity.getToolActivityFeatureState().state, 'idle');
toolActivity.installToolActivityExpansionPersistence(documentRef);
assert.equal(toolActivity.getToolActivityFeatureState().state, 'idle', 'installing persistence must not fetch the rich tool renderer');
assert.equal(toolActivity.toolActivitySummary([{ type: 'text', text: 'plain response' }]), '');
assert.equal(toolActivity.getToolActivityFeatureState().state, 'idle', 'plain text summaries must keep the optional renderer dormant');
let toolReadyEvents = 0;
windowRef.addEventListener('prometheus:tool-activity-ready', () => { toolReadyEvents += 1; });
const placeholder = toolActivity.renderToolActivityEntry({ activity: { label: 'Run command' }, text: 'Run command' });
assert.match(placeholder, /data-tool-activity-loading="true"/);
await toolActivity.loadToolActivityFeature();
assert.equal(toolActivity.getToolActivityFeatureState().state, 'ready');
assert.equal(toolReadyEvents, 1);

const detailRuntime = await import('../web-ui/src/features/chat/optional/chat-detail-runtime.js');
assert.deepEqual(detailRuntime.optionalChatDetailState().loadedOrLoading, [], 'detail chunks must start dormant');
const browserOwner = await import('../web-ui/src/features/chat/optional/browser-surface-renderer.js');
const creativeOwner = await import('../web-ui/src/features/chat/optional/creative-workspace-runtime.js');
const voiceOwner = await import('../web-ui/src/mobile/mobile-voice-page.js');
assert.equal(typeof browserOwner.renderBrowserCanvasSurface, 'function');
assert.equal(typeof creativeOwner.renderCreativeWorkspaceStudioV3, 'function');
assert.equal(typeof creativeOwner.handleCreativeCommandMessage, 'function');
assert.equal(typeof voiceOwner.renderVoicePage, 'function');

let intervalCreations = 0;
let observerCreations = 0;
let socketCreations = 0;
const intervalTrap = () => { intervalCreations += 1; return 1; };
globalThis.setInterval = intervalTrap;
windowRef.setInterval = intervalTrap;
globalThis.MutationObserver = class MutationObserver {
  constructor() { observerCreations += 1; }
  observe() {}
  disconnect() {}
};
globalThis.WebSocket = class WebSocket {
  constructor() { socketCreations += 1; }
};
let sideLoadOptions = null;
windowRef.showSideChatSplit = (sessionId) => {
  windowRef.sideChatSplitOpen = true;
  windowRef.activeSideChatId = sessionId;
  return true;
};
windowRef._loadSessionFromServer = async (_sessionId, options) => { sideLoadOptions = options; };
await import('../web-ui/src/features/chat/multi-chat-workspace-v2.js');
windowRef.__PROM_MULTI_CHAT_WORKSPACE.openSide('side-session', 'Side');
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(sideLoadOptions, { force: true, historyLimit: 80, processLimit: 240 });
assert.equal(intervalCreations, 0, 'native side chat must not install a polling loop');
assert.equal(observerCreations, 0, 'native side chat must not observe the entire document');
assert.equal(socketCreations, 0, 'a second chat pane must not create a socket');

windowRef.__PROM_SHOULD_BOOT_MOBILE = () => true;
delete windowRef.__PROM_DESKTOP_FEATURE_LOADS;
await import(`../web-ui/src/performance.js?mobile-guard=${Date.now()}`);
assert.equal(windowRef.__PROM_DESKTOP_FEATURE_LOADS, undefined, 'mobile performance boot must not install desktop feature activation');

console.log('Chat optional ownership behavioral tests passed.');
