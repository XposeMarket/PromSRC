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

console.log('mobile Settings return contract passed');
