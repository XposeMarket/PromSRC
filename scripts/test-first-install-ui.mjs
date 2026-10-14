// Static regression guard for first-install desktop UI wiring.
// Run: npm run test:first-install-ui
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = (file) => fs.readFileSync(file, 'utf8');

const settings = read('web-ui/src/pages/SettingsPage.js');
const html = read('web-ui/index.html');
const preload = read('electron/preload.js');
const main = read('electron/main.js');
const onboarding = read('web-ui/src/onboarding/onboarding-controller.js');

assert.match(preload, /gateway-restarting/);
assert.match(preload, /gateway-degraded/);
assert.match(preload, /gateway-recovered/);
assert.match(main, /send\('gateway-recovered'/);
assert.match(html, /connect-model-composer-cta/);
assert.match(read('web-ui/src/desktop-entry.js'), /record\?\.model\?\.firstConnectedAt/);
assert.match(onboarding, /openModelConnection/);
assert.match(html, /pairing-lan-enabled/);
assert.match(settings, /lanEnabled/);
assert.match(settings, /lanRestartRequired/);
assert.match(settings, /lan_access_off/);
console.log('first-install UI regression: PASS');
