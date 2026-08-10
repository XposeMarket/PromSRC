import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function loadCatalogForTest() {
  let source = read('web-ui/src/mobile/mobile-gateway-catalog.js');
  source = source.replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\/mobile-api\.js';/, '');
  source = source.replace(/\bexport\s+/g, '');
  const values = new Map();
  let deviceToken = '';
  const localStorage = {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
  const window = {
    localStorage,
    location: { origin: 'https://phone.example' },
    dispatchEvent() {},
  };
  const context = {
    window,
    location: window.location,
    API: 'https://phone.example',
    getDeviceToken: () => deviceToken,
    clearDeviceToken: () => { deviceToken = ''; },
    Headers,
    URL,
    URLSearchParams,
    AbortController,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    escape,
    unescape,
    console,
  };
  vm.runInNewContext(`${source}\nthis.__catalog = {\n  normalizeGatewayDescriptor, targetNamespacedId, parseTargetNamespacedId,\n  upsertGateway, loadGatewayCatalog, getGateway, setGatewayToken, getGatewayToken,\n  setGatewayFilter, getGatewayFilter, updateGatewayStatus, bindMobileSessionTarget,\n  getMobileSessionTarget, encodePairingPayload, getPairingPayload, gatewayFetchJson,\n  hasAnyGatewayCredential\n};`, context, { filename: 'mobile-gateway-catalog.js' });
  context.__setDeviceToken = (value) => { deviceToken = String(value || ''); };
  return context;
}

function assertContractFiles() {
  const catalog = read('web-ui/src/mobile/mobile-gateway-catalog.js');
  const identity = read('src/gateway/gateway-identity.ts');
  const pairing = read('src/gateway/routes/pairing.router.ts');
  const auth = read('src/gateway/gateway-auth.ts');
  const pages = read('web-ui/src/mobile/mobile-pages.js');
  const pairingPage = read('web-ui/src/mobile/mobile-pairing-page.js');
  const gatewaysPage = read('web-ui/src/mobile/mobile-gateways-page.js');
  const mobileApi = read('web-ui/src/mobile/mobile-api.js');
  const router = read('web-ui/src/mobile/mobile-router.js');
  const shell = read('web-ui/src/mobile/mobile-shell.js');
  const css = read('web-ui/src/styles/mobile.css');
  const index = read('web-ui/index.html');

  assert.match(catalog, /targetNamespacedId/);
  assert.match(catalog, /pm_mobile_gateway_token_v1/);
  assert.match(catalog, /GATEWAY_OFFLINE/);
  assert.match(catalog, /GATEWAY_REVOKED/);
  assert.match(identity, /gateway-identity\.json/);
  assert.match(identity, /gatewayId/);
  assert.match(identity, /catalog\.read/);
  assert.match(pairing, /api\/mobile\/gateway\/catalog/);
  assert.match(pairing, /x-pairing-device-fingerprint/);
  assert.match(pairing, /consumePendingRequestToken/);
  assert.match(pairing, /api\/pairing\/me\/revoke/);
  assert.match(auth, /X-Pairing-Device-Fingerprint/);
  assert.match(pages, /BarcodeDetector/);
  assert.match(pages, /not a valid Prometheus pairing QR/);
  assert.match(pages, /REMOTE_EXECUTION_NOT_ENABLED|read-only/);
  assert.match(pairingPage, /Confirm this gateway/);
  assert.match(pairingPage, /wrong gateway identity/i);
  assert.match(gatewaysPage, /View filter/);
  assert.doesNotMatch(gatewaysPage, /Aggregated read-only view/);
  assert.doesNotMatch(pages, /pm-mobile-gateway-pills/);
  assert.match(pages, /pm-chat-settings-connections/);
  assert.match(pages, /onPointerDownOutside/);
  assert.match(pages, /requestedSession === MOBILE_CHAT_SESSION_ID \? `/, 'gateway selector must be limited to the new-chat draft');
  assert.match(pages, /requestedSession !== MOBILE_CHAT_SESSION_ID \|\| !targetChip/, 'existing chats must not open the gateway selector');
  assert.match(mobileApi, /_isCurrentMobileRequestTarget/);
  assert.match(mobileApi, /REMOTE_EXECUTION_NOT_ENABLED/);
  assert.match(router, /loadMobileGatewaySessionGroups/);
  assert.match(router, /hasAnyGatewayCredential/);
  assert.doesNotMatch(shell, /pm-drawer-gateway-link/);
  assert.match(shell, /pm-drawer-gateway-filter/);
  assert.match(shell, /pm-drawer-gateway-pill/);
  assert.match(shell, /pm-session-gateway/);
  assert.match(css, /--pm-drawer-width: min\(76vw, 350px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.pm-chat-target-chip \{[\s\S]*display: none/);
  assert.match(css, /pm-target-popover-open/);
  assert.match(css, /pm-drawer-gateway-filter/);
  assert.match(css, /pm-drawer-gateway-pills[\s\S]*overflow-x: auto/);
  assert.doesNotMatch(css, /pm-drawer-gateway-filter-inner|pm-drawer-gateway-filter-label/);
  assert.match(index, /Gateway Connections · Pair a phone/);
}

async function run() {
  assertContractFiles();
  const ctx = loadCatalogForTest();
  const c = ctx.__catalog;

  const mac = c.upsertGateway({ gatewayId: 'gw-mac', name: 'MacBook Prometheus', platform: 'darwin', version: '1.0.9', origin: 'https://mac.example' }, { token: 'mac-token', deviceId: 'dev-mac' });
  const desktop = c.upsertGateway({ gatewayId: 'gw-desktop', name: 'Desktop Prometheus', platform: 'win32', version: '1.0.9', origin: 'https://desktop.example' }, { token: 'desktop-token', deviceId: 'dev-desktop' });
  assert.equal(c.loadGatewayCatalog().length, 2, 'two independent gateways are catalogued');
  assert.notEqual(c.getGatewayToken(mac.gatewayId), c.getGatewayToken(desktop.gatewayId), 'credentials are target-scoped');
  assert.equal(c.targetNamespacedId(mac.gatewayId, 'same-session'), 'gw-mac::same-session');
  assert.equal(c.targetNamespacedId(desktop.gatewayId, 'same-session'), 'gw-desktop::same-session');
  assert.notEqual(c.targetNamespacedId(mac.gatewayId, 'same-session'), c.targetNamespacedId(desktop.gatewayId, 'same-session'), 'same local ids cannot collide across targets');
  const parsedTarget = c.parseTargetNamespacedId('gw-mac::same-session');
  assert.equal(parsedTarget.gatewayId, 'gw-mac');
  assert.equal(parsedTarget.targetId, 'same-session');
  assert.equal(parsedTarget.namespacedId, 'gw-mac::same-session');

  const selectedFilter = c.setGatewayFilter(['gw-mac']);
  assert.equal(selectedFilter.mode, 'selected');
  assert.equal(selectedFilter.gatewayIds[0], 'gw-mac');
  assert.equal(c.getGatewayFilter().mode, 'selected');
  assert.equal(c.getGatewayFilter().gatewayIds[0], 'gw-mac');
  c.setGatewayFilter(['gw-mac', 'gw-desktop']);
  assert.equal(c.getGatewayFilter().mode, 'all', 'selecting all targets restores aggregate mode');

  assert.equal(c.bindMobileSessionTarget('session-1', mac.gatewayId, { started: true, path: '/project/mac' }), true);
  assert.equal(c.bindMobileSessionTarget('session-1', desktop.gatewayId, { started: true }), false, 'started session cannot be retargeted');
  assert.equal(c.getMobileSessionTarget('session-1').gatewayId, mac.gatewayId);
  assert.equal(c.bindMobileSessionTarget('mobile_default', desktop.gatewayId, { started: true }), false, 'draft slot is never persisted as a real target binding');

  const payload = c.encodePairingPayload({ gatewayId: desktop.gatewayId, origin: desktop.origin, challenge: 'one-time-challenge', expiresAt: Date.now() + 30_000, name: desktop.name, platform: desktop.platform, version: desktop.version });
  const decoded = c.getPairingPayload(payload);
  assert.equal(decoded.gatewayId, desktop.gatewayId);
  assert.equal(decoded.origin, desktop.origin);
  assert.equal(c.getPairingPayload(c.encodePairingPayload({ gatewayId: desktop.gatewayId, origin: desktop.origin, challenge: 'expired', expiresAt: Date.now() - 1 })), null, 'expired QR payload is rejected');
  assert.equal(c.getPairingPayload('not-a-pairing-payload'), null, 'malformed payload is rejected');

  c.updateGatewayStatus(mac.gatewayId, { status: 'online' });
  let request;
  ctx.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
  };
  await c.gatewayFetchJson(mac.gatewayId, '/api/mobile/gateway/catalog');
  assert.equal(request.url, 'https://mac.example/api/mobile/gateway/catalog');
  assert.equal(request.options.headers.get('X-Pairing-Token'), 'mac-token');
  assert.equal(new URL(request.url).search, '', 'target credentials never enter the URL');

  c.updateGatewayStatus(desktop.gatewayId, { status: 'offline' });
  await assert.rejects(() => c.gatewayFetchJson(desktop.gatewayId, '/api/mobile/gateway/catalog'), (error) => error.code === 'GATEWAY_OFFLINE');
  c.updateGatewayStatus(desktop.gatewayId, { status: 'revoked' });
  await assert.rejects(() => c.gatewayFetchJson(desktop.gatewayId, '/api/mobile/gateway/catalog'), (error) => error.code === 'GATEWAY_REVOKED');
  assert.equal(c.hasAnyGatewayCredential(), true);

  console.log('[test-mobile-gateway-contract] passed: identity, target isolation, pairing payload, replay/fingerprint contract, status fail-closed, filters, and immutable bindings');
}

run().catch((error) => {
  console.error('[test-mobile-gateway-contract] failed:', error);
  process.exitCode = 1;
});
