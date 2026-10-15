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
assert.equal(earlyWindow.closeSettings('early'), true);
assert.deepEqual(earlyCloseCalls, [
  ['assign', '/mobile/more'],
], 'navigate before invoking any modal-closing shim or revealing desktop');

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

// First-paint and close ordering are safety contracts: modal stays covering
// the desktop document until navigation commits, including the lazy shim.
const { readFileSync } = await import('node:fs');
const source = (name) => readFileSync(new URL(`../web-ui/${name}`, import.meta.url), 'utf8');
const index = source('index.html');
assert.ok(index.indexOf("classList.add('mobile-settings-handoff')") < index.indexOf('<body'));
assert.match(index, /html\.mobile-settings-handoff body > :not\(#settings-modal\)/);
assert.match(index, /html\.mobile-settings-handoff #settings-modal \{ display: flex !important/);
const settings = source('src/pages/SettingsPage.js');
const close = settings.slice(settings.indexOf('function closeSettings()'));
assert.ok(close.indexOf('if (returnFromMobileSettings(window.location)) return;') < close.indexOf("modal.style.display = 'none'"));
assert.match(source('src/styles/settings.css'), /html\.mobile-settings-handoff #settings-modal \.settings-sidebar-top\s*\{\s*padding-top: max\(12px, env\(safe-area-inset-top\)\) !important/);
console.log('mobile Settings first-paint, safe-area and exit ordering passed');

{
  const calls = [];
  const win = {
    location: { href: 'https://example.test/?settings=1&settingsReturn=%23mobile%2Fmore', replace() { calls.push('replace'); } },
    document: { referrer: 'https://example.test/mobile/more' },
    history: { length: 2, back() { calls.push('back'); } },
    closeSettings() { calls.push('close'); },
  };
  installMobileSettingsReturnBridge(win);
  win.closeSettings();
  assert.deepEqual(calls, ['back'], 'same-origin mobile predecessor restores via history without closing modal');
}

assert.match(source('src/styles/mobile-shell.css'), /body\.pm-mobile-active\.pm-mobile-drawer-open \.pm-tabbar-haptic-gesture-surface\s*\{\s*display: none !important/, 'portaled tabbar haptics must not intercept drawer theme taps');
