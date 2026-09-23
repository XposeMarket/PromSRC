import assert from 'node:assert/strict';

import {
  buildMobileSettingsHandoffUrl,
  installMobileSettingsReturnBridge,
  mobileSettingsReturnRoute,
  normalizeMobileSettingsReturnRoute,
  resolveMobileSettingsReturnUrl,
} from '../web-ui/src/settings-return.js';

const pwaChat = new URL('http://prometheus.local/?source=pwa#mobile/chat/mobile_123');
const handoff = new URL(buildMobileSettingsHandoffUrl(pwaChat, 'models'), pwaChat);
assert.equal(handoff.pathname, '/');
assert.equal(handoff.searchParams.get('desktop'), '1');
assert.equal(handoff.searchParams.get('settings'), '1');
assert.equal(handoff.searchParams.get('settingsTab'), 'models');
assert.equal(handoff.searchParams.get('settingsReturn'), '#mobile/chat/mobile_123');
assert.equal(handoff.searchParams.get('settingsSource'), 'pwa');
assert.equal(handoff.searchParams.has('source'), false, 'PWA marker must not make the gateway serve mobile.html for desktop Settings');
assert.equal(resolveMobileSettingsReturnUrl(handoff), '/?source=pwa#mobile/chat/mobile_123');

const settingsRoute = new URL('http://prometheus.local/mobile/settings/system');
assert.equal(mobileSettingsReturnRoute(settingsRoute), '#mobile/more', 'Settings must not return into a handoff loop');
const pathHandoff = new URL(buildMobileSettingsHandoffUrl(settingsRoute), settingsRoute);
assert.equal(resolveMobileSettingsReturnUrl(pathHandoff), '/mobile/more', 'non-PWA handoffs should return through the lightweight mobile document');
assert.equal(normalizeMobileSettingsReturnRoute('https://attacker.example/'), '', 'external settings return URLs must be rejected');
assert.equal(normalizeMobileSettingsReturnRoute('#desktop/chat'), '', 'desktop return routes must be rejected');

const earlyCloseCalls = [];
const earlyWindow = {
  location: {
    href: 'http://prometheus.local/?desktop=1&settings=1&settingsReturn=%23mobile%2Fmore',
    assign(target) { earlyCloseCalls.push(['assign', target]); },
  },
  document: { body: { classList: { remove(name) { earlyCloseCalls.push(['remove', name]); } } } },
  closeSettings(value) { earlyCloseCalls.push(['close', value]); return 'closed'; },
};
installMobileSettingsReturnBridge(earlyWindow);
assert.equal(earlyWindow.closeSettings('early'), 'closed');
assert.deepEqual(earlyCloseCalls, [
  ['close', 'early'],
  ['remove', 'pm-mobile-overlay-open'],
  ['assign', '/mobile/more'],
], 'the pre-lazy-load close shim must return to the lightweight mobile app');

// Return must REPLACE the desktop handoff entry so iOS swipe-back / bfcache
// can never land on the desktop UI, and a lost query must fall back to the
// return target recorded when the handoff page first loaded.
{
  const store = new Map();
  const sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const calls = [];
  const listeners = {};
  const win = {
    sessionStorage,
    addEventListener(type, fn) { listeners[type] = fn; },
    location: {
      href: 'http://prometheus.local/?desktop=1&settings=1&settingsReturn=%23mobile%2Fchat%2Fmobile_9&settingsSource=pwa',
      assign(target) { calls.push(['assign', target]); },
      replace(target) { calls.push(['replace', target]); },
    },
    document: { body: { classList: { remove() {} } }, getElementById: () => ({ style: { display: 'none' } }) },
    closeSettings() { return 'closed'; },
  };
  installMobileSettingsReturnBridge(win);
  assert.equal(store.get('pm_mobile_settings_return_url'), '/?source=pwa#mobile/chat/mobile_9');
  // Simulate the desktop app rewriting the URL and dropping the handoff query.
  win.location.href = 'http://prometheus.local/';
  win.closeSettings();
  assert.deepEqual(calls, [['replace', '/?source=pwa#mobile/chat/mobile_9']], 'close must replace back to mobile even after the query is lost');
  assert.equal(store.has('pm_mobile_settings_return_url'), false);
  // bfcache restore of the closed handoff page bounces back to mobile.
  win.location.href = 'http://prometheus.local/?desktop=1&settings=1&settingsReturn=%23mobile%2Fmore';
  listeners.pageshow({ persisted: true });
  assert.deepEqual(calls.at(-1), ['replace', '/mobile/more']);
}

console.log('mobile Settings return contract passed');
