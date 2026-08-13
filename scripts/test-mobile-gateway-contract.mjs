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
  vm.runInNewContext(`${source}\nthis.__catalog = {\n  normalizeGatewayDescriptor, targetNamespacedId, parseTargetNamespacedId,\n  upsertGateway, loadGatewayCatalog, getGateway, setGatewayToken, getGatewayToken,\n  saveGatewayCatalog, setGatewayFilter, getGatewayFilter, updateGatewayStatus, bindMobileSessionTarget,\n  resolveMobileSessionGateway, getMobileSessionTarget, encodePairingPayload, getPairingPayload, gatewayFetchJson,\n  hasAnyGatewayCredential, filterOnlineGatewayEntries, loadMobileGatewaySessionPage,\n  searchMobileGatewaySessions\n};`, context, { filename: 'mobile-gateway-catalog.js' });
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
  assert.match(identity, /paired-device-direct/);
  assert.match(identity, /chat\.write/);
  assert.match(pairing, /api\/mobile\/gateway\/catalog/);
  assert.match(pairing, /x-pairing-device-fingerprint/);
  assert.match(pairing, /consumePendingRequestToken/);
  assert.match(pairing, /api\/pairing\/me\/revoke/);
  assert.match(auth, /X-Pairing-Device-Fingerprint/);
  assert.match(auth, /access-control-request-headers/);
  assert.match(auth, /pathname === '\/api\/gateway\/descriptor'/, 'descriptor liveness probes must be CORS-allowed');
  assert.match(auth, /pathname === '\/api\/status'/, 'legacy status fallback must remain CORS-allowed');
  assert.match(pages, /BarcodeDetector/);
  assert.match(pages, /jsQR/);
  assert.match(pages, /attemptBoth/);
  assert.match(pages, /not a valid Prometheus pairing QR/);
  assert.match(pages, /REMOTE_EXECUTION_NOT_ENABLED|read-only/);
  assert.match(pairingPage, /Confirm this gateway/);
  assert.match(pairingPage, /wrong gateway identity/i);
  assert.match(gatewaysPage, /View filter/);
  assert.doesNotMatch(gatewaysPage, /Aggregated read-only view/);
  assert.doesNotMatch(pages, /pm-mobile-gateway-pills/);
  assert.match(pages, /pm-chat-settings-connections/);
  assert.match(pages, /installMobileContextPopoverGuard/);
  assert.match(pages, /document\.addEventListener\('touchstart', onPointerDown, \{ capture: true, passive: false \}\)/);
  assert.match(pages, /document\.addEventListener\('click', onClick, true\)/);
  assert.match(pages, /pm-mobile-context-popover-open/);
  assert.match(pages, /requestedSession === MOBILE_CHAT_SESSION_ID \? `/, 'gateway selector must be limited to the new-chat draft');
  assert.match(pages, /requestedSession !== MOBILE_CHAT_SESSION_ID \|\| !targetChip/, 'existing chats must not open the gateway selector');
  assert.match(pages, /selectedGateway\.status !== MOBILE_GATEWAY_STATUS\.ONLINE/, 'chat sends must fail closed for every non-online target state');
  assert.match(pages, /probeGateway\(selectedGateway\)/, 'chat sends must verify target liveness before admission');
  assert.match(pages, /gatewayExecutionRefresh\.then\(\(\) => loadMobileChatSession/, 'opening a stale remote chat must refresh execution metadata before loading history');
  assert.match(pages, /refreshedVoiceGateway/, 'selecting a stale remote chat as a Voice target must refresh execution metadata first');
  assert.match(pages, /targetNamespacedId\(selectedGateway\?\.gatewayId, actualSessionId\)/, 'new remote chats must keep their gateway in the route after the first send');
  assert.match(pages, /_saveMobileLastChatContext\(\{[\s\S]*gatewayId: selectedGateway\.gatewayId/, 'chat sends must persist the selected gateway for legacy bare routes');
  assert.match(mobileApi, /_isCurrentMobileRequestTarget/);
  assert.match(mobileApi, /__pmMobileActiveGatewayExecutionEnabled/);
  assert.match(mobileApi, /if \(!_isCurrentMobileRequestTarget\(\)\) return ''/);
  assert.doesNotMatch(mobileApi, /chat execution is\s+strictly local/);
  assert.doesNotMatch(shell, /disabled in the first read-only multi-gateway slice/);
  assert.match(router, /loadMobileGatewaySessionGroups/);
  assert.match(router, /hasAnyGatewayCredential/);
  assert.doesNotMatch(shell, /pm-drawer-gateway-link/);
  assert.match(shell, /pm-drawer-gateway-filter/);
  assert.match(shell, /pm-drawer-gateway-pill/);
  assert.match(shell, /pm-session-gateway/);
  assert.match(shell, /gatewayAware/);
  assert.match(shell, /type === 'status_changed'/);
  assert.match(shell, /PM_DRAWER_GATEWAY_HEARTBEAT_MS/);
  assert.match(shell, /refreshGatewayStatuses/);
  assert.match(css, /--pm-drawer-width: min\(76vw, 350px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.pm-chat-target-chip \{[\s\S]*display: none/);
  assert.match(css, /pm-target-popover-open/);
  assert.match(css, /pm-drawer-gateway-filter/);
  assert.match(css, /pm-drawer-gateway-pills[\s\S]*overflow-x: auto/);
  assert.doesNotMatch(css, /pm-drawer-gateway-filter-inner|pm-drawer-gateway-filter-label/);
  assert.match(index, /Gateway Connections · Pair a phone/);
  assert.match(index, /vendor\/jsqr\/jsQR\.js/);
  assert.doesNotMatch(index, /class="status-pill gateway-status-pill"/);
  assert.doesNotMatch(index, /id="gateway-status-pill"/);
  assert.match(css, /\.pm-header \.pm-online::before[\s\S]{0,120}display: none/);
  assert.match(shell, /pm-model-badge/);
  assert.match(catalog, /filterOnlineGatewayEntries/);
  assert.match(catalog, /await _loadOnlineSelectedGatewayEntries/);
}

async function run() {
  assertContractFiles();
  const ctx = loadCatalogForTest();
  const c = ctx.__catalog;

  const mac = c.upsertGateway({ gatewayId: 'gw-mac', name: 'MacBook Prometheus', platform: 'darwin', version: '1.0.9', origin: 'https://mac.example', execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] } }, { token: 'mac-token', deviceId: 'dev-mac' });
  const desktop = c.upsertGateway({ gatewayId: 'gw-desktop', name: 'Desktop Prometheus', platform: 'win32', version: '1.0.9', origin: 'https://desktop.example', execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] } }, { token: 'desktop-token', deviceId: 'dev-desktop' });
  assert.equal(c.loadGatewayCatalog().length, 2, 'two independent gateways are catalogued');
  assert.notEqual(c.getGatewayToken(mac.gatewayId), c.getGatewayToken(desktop.gatewayId), 'credentials are target-scoped');
  assert.equal(c.getGateway(mac.gatewayId).execution.enabled, true, 'paired gateways advertise direct execution');
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
  assert.equal(c.getMobileSessionTarget('session-1').origin, mac.origin, 'session bindings retain the gateway origin for recovery');
  assert.equal(c.bindMobileSessionTarget('mobile_default', desktop.gatewayId, { started: true }), false, 'draft slot is never persisted as a real target binding');

  // Existing chats must survive a descriptor/catalog refresh even when the
  // gateway id changes, while legacy local chats may recover to this PWA only.
  const repairedMac = c.upsertGateway({ gatewayId: 'gw-mac-repaired', name: 'MacBook Prometheus', platform: 'darwin', version: '1.0.10', origin: mac.origin }, { token: 'mac-repaired-token', deviceId: 'dev-mac-repaired' });
  c.saveGatewayCatalog([repairedMac, desktop]);
  c.updateGatewayStatus(repairedMac.gatewayId, { status: 'online' });
  assert.equal(c.resolveMobileSessionGateway('session-1').gatewayId, repairedMac.gatewayId, 'bound chats recover a replacement descriptor by origin');

  const current = c.upsertGateway({ gatewayId: 'gw-current', name: 'This Prometheus', platform: 'win32', version: '1.0.16', origin: 'https://phone.example' }, { token: 'current-token', deviceId: 'dev-current' });
  c.updateGatewayStatus(current.gatewayId, { status: 'online' });
  ctx.window.localStorage.setItem('pm_mobile_session_targets_v1', JSON.stringify({
    'legacy-session': { gatewayId: 'gw-old-local', immutable: true },
    'remote-session': { gatewayId: 'gw-old-remote', origin: 'https://remote.example', immutable: true },
  }));
  c.saveGatewayCatalog([current]);
  assert.equal(c.resolveMobileSessionGateway('legacy-session', { fallbackToCurrentGateway: true }).gatewayId, current.gatewayId, 'legacy local bindings recover the sole current gateway');
  assert.equal(c.resolveMobileSessionGateway('remote-session', { fallbackToCurrentGateway: true }), null, 'stale remote bindings do not route to the current gateway');
  c.saveGatewayCatalog([mac, desktop]);
  c.updateGatewayStatus(mac.gatewayId, { status: 'online' });

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

  // Session aggregation is liveness-gated, not merely catalog-filtered. Both
  // independent targets can expose the same local session id without a
  // collision while they are live.
  let desktopReachable = true;
  ctx.fetch = async (url, options) => {
    request = { url, options };
    const parsed = new URL(url);
    const gatewayId = parsed.hostname === 'mac.example' ? mac.gatewayId : desktop.gatewayId;
    if (parsed.pathname === '/api/gateway/descriptor') {
      if (gatewayId === desktop.gatewayId && !desktopReachable) throw new TypeError('Failed to fetch');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ gateway: { gatewayId, name: gatewayId === mac.gatewayId ? mac.name : desktop.name, platform: gatewayId === mac.gatewayId ? 'darwin' : 'win32', version: '1.0.9' } }),
      };
    }
    if (parsed.pathname === '/api/mobile/gateway/catalog') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sessions: [{ id: 'same-session', title: `${gatewayId} chat`, lastMessageAt: 10 }] }),
      };
    }
    if (parsed.pathname === '/api/sessions/search') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sessions: [{ id: 'same-session', title: `${gatewayId} chat` }] }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) };
  };
  c.updateGatewayStatus(mac.gatewayId, { status: 'unknown' });
  c.updateGatewayStatus(desktop.gatewayId, { status: 'unknown' });
  const livePage = await c.loadMobileGatewaySessionPage({ limit: 20, offset: 0, state: 'active' });
  assert.deepEqual(new Set(livePage.sessions.map((session) => session.id)), new Set(['gw-mac::same-session', 'gw-desktop::same-session']), 'online aggregate includes both target-namespaced sessions');
  assert.deepEqual(Array.from(c.filterOnlineGatewayEntries(c.loadGatewayCatalog()), (entry) => entry.gatewayId).sort(), ['gw-desktop', 'gw-mac'], 'both live gateways pass the online-only filter');

  desktopReachable = false;
  const offlinePage = await c.loadMobileGatewaySessionPage({ limit: 20, offset: 0, state: 'active' });
  assert.deepEqual(Array.from(offlinePage.sessions, (session) => session.id), ['gw-mac::same-session'], 'offline gateway sessions disappear from aggregate results');
  assert.equal(c.getGateway(desktop.gatewayId).status, 'offline', 'failed liveness probe records offline state');
  assert.deepEqual(Array.from(await c.searchMobileGatewaySessions('same-session', { limit: 20 }), (session) => session.id), ['gw-mac::same-session'], 'search cannot return sessions from an offline gateway');

  desktopReachable = true;
  const recoveredPage = await c.loadMobileGatewaySessionPage({ limit: 20, offset: 0, state: 'active' });
  assert.deepEqual(new Set(Array.from(recoveredPage.sessions, (session) => session.id)), new Set(['gw-mac::same-session', 'gw-desktop::same-session']), 'sessions reappear after the target recovers');
  assert.equal(c.getGateway(desktop.gatewayId).status, 'online', 'recovery probe restores online state');

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
