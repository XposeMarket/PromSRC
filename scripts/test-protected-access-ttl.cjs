'use strict';
// Real module timer test for electron/protected-access.js with a fake clock.
// Synthetic canary only. No browser, no network, no real credentials.
const assert = require('assert');
const path = require('path');

let now = 0;
let seq = 0;
const timers = new Map();
global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
global.clearTimeout = (id) => { timers.delete(id); };
async function advance(ms) {
  const target = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
    if (!next) break;
    timers.delete(next.id);
    now = next.t.at;
    next.t.fn();
    await new Promise(r => setImmediate(r));
  }
  now = target;
}

const windows = [];
class FakeWindow {
  constructor() { this.destroyed = false; this.url = 'about:blank'; windows.push(this); this.webContents = { setWindowOpenHandler() {}, getURL: () => this.url, executeJavaScript: async () => true }; }
  loadURL(href) { this.url = href; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; }
}
const session = { fromPartition: () => ({ setPermissionRequestHandler() {}, webRequest: { onBeforeRequest() {} }, cookies: { get: async () => [] }, clearStorageData: async () => {} }) };
const app = { commandLine: { hasSwitch: () => false } };

const { createProtectedAccess } = require(path.join(__dirname, '..', 'electron', 'protected-access.js'));
const access = createProtectedAccess({ BrowserWindow: FakeWindow, session, app, transferCookies: async () => {} });
const open = () => windows.filter(w => !w.destroyed).length;
const prep = () => access.prepare({ credentialId: 'cred_ttl', origin: 'https://example.com', url: 'https://example.com/login', identifier: 'SYNTHETIC_ID', secret: 'SYNTHETIC_CANARY_TTL', sessionId: 'sess_test' });

(async () => {
  // 1. First prepare opens one window with a 120 s expiry timer.
  assert.equal((await prep()).phase, 'ready');
  assert.equal(open(), 1);

  // 2. Advance 115 s, still inside the first window's lifetime, then re-prepare the same credential.
  await advance(115_000);
  assert.equal(open(), 1, 'first window still open at 115 s');
  assert.equal((await prep()).phase, 'ready', 're-prepare must not fail with PREPARE_FAILED');
  assert.equal(windows[0].destroyed, true, 'stale window must be destroyed before replace');
  assert.equal(open(), 1, 'exactly one window open after replace');

  // 3. The old timer (due at 120 s) was cleared; it must not close the replacement window.
  await advance(5_000);
  assert.equal(open(), 1, 'stale timer must not close the replacement window');

  // 4. The replacement window expires on its own timer (115 s + 120 s).
  await advance(120_000);
  assert.equal(open(), 0, 'replacement window closes at its own expiry');
  console.log('PASS protected-access TTL: stale same-credential window closed before replace, exactly one window open, old timer cleared, replacement expires on its own timer.');
})().catch((error) => { console.error('FAIL protected-access TTL:', error.message); process.exit(1); });
