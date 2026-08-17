import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function loadCatalog() {
  let source = read('web-ui/src/mobile/mobile-gateway-catalog.js');
  source = source.replace(/import\s+\{\s*API\s*\}\s+from\s+'\.\.\/state\.js';\s*/, '');
  source = source.replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\/mobile-api\.js';\s*/, '');
  source = source.replace(/\bexport\s+/g, '');

  const localStorage = createStorage();
  const sessionStorage = createStorage();
  let deviceToken = '';
  const events = [];

  const context = {
    API: 'https://phone.example',
    localStorage,
    sessionStorage,
    location: { origin: 'https://phone.example' },
    Headers,
    Request,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    escape,
    unescape,
    console,
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent(event) { events.push(event); return true; },
    __fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => '{}' }),
    getDeviceToken: () => deviceToken,
    clearDeviceToken: () => { deviceToken = ''; },
  };
  context.window = context;
  context.fetch = (...args) => context.__fetchImpl(...args);

  vm.runInNewContext(`${source}\nthis.__catalog = {\n    loadGatewayCatalog, getGateway, upsertGateway, updateGatewayStatus,\n    getGatewayToken, setGatewayToken, getGatewayDeviceId,\n    setActiveGatewayId, getActiveGatewayId, setGatewayFilter, getGatewayFilter,\n    bindMobileSessionTarget, getMobileSessionTarget, setMobileActiveGatewayTarget,\n    probeGateway, normalizeGatewayOrigin\n  };`, context, { filename: 'mobile-gateway-catalog.js' });

  context.__setDeviceToken = (value) => { deviceToken = String(value || ''); };
  context.__events = events;
  return context;
}

async function run() {
  const ctx = loadCatalog();
  const c = ctx.__catalog;

  const macOld = c.upsertGateway({
    gatewayId: 'gw-mac-old',
    name: 'MacBook Prometheus',
    origin: 'https://mac.example',
    platform: 'darwin',
    execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] },
  }, { token: 'mac-token', deviceId: 'dev-mac' });
  c.upsertGateway({
    gatewayId: 'gw-desktop',
    name: 'Desktop Prometheus',
    origin: 'https://desktop.example',
    platform: 'win32',
    execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] },
  }, { token: 'desktop-token', deviceId: 'dev-desktop' });
  c.setActiveGatewayId(macOld.gatewayId);
  c.setGatewayFilter([macOld.gatewayId]);
  assert.equal(c.bindMobileSessionTarget('session-1', macOld.gatewayId, { started: true }), true);
  c.setMobileActiveGatewayTarget(macOld);

  const macNew = c.upsertGateway({
    gatewayId: 'gw-mac-new',
    name: 'MacBook Prometheus',
    origin: 'https://mac.example',
    platform: 'darwin',
    version: '1.0.18',
    execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.write'] },
  });

  assert.equal(c.getGateway('gw-mac-old'), null, 'old same-origin gateway identity is removed');
  assert.equal(c.getGateway('gw-mac-new')?.gatewayId, 'gw-mac-new', 'replacement gateway identity is stored');
  assert.equal(c.getGatewayToken('gw-mac-new'), 'mac-token', 'target credential migrates to the replacement identity');
  assert.equal(c.getGatewayToken('gw-mac-old'), '', 'old target credential slot is cleared');
  assert.equal(c.getGatewayDeviceId('gw-mac-new'), 'dev-mac', 'device grant id migrates with the credential');
  assert.equal(c.getActiveGatewayId(), 'gw-mac-new', 'active target migrates atomically');
  assert.deepEqual(Array.from(c.getGatewayFilter().gatewayIds), ['gw-mac-new'], 'selected gateway filter migrates atomically');
  assert.equal(c.getMobileSessionTarget('session-1').gatewayId, 'gw-mac-new', 'immutable session binding migrates to the replacement identity');
  assert.equal(ctx.__pmMobileActiveGatewayId, 'gw-mac-new', 'live request target id migrates');
  assert.equal(ctx.__pmMobileActiveGatewayToken, 'mac-token', 'live request target keeps the inherited credential');

  c.updateGatewayStatus(macNew.gatewayId, { status: 'online' });
  ctx.__fetchImpl = async () => ({
    ok: false,
    status: 401,
    headers: new Headers(),
    text: async () => JSON.stringify({ error: 'revoked' }),
  });
  await ctx.fetch('https://mac.example/api/chat', {
    method: 'POST',
    headers: { 'X-Pairing-Token': 'mac-token' },
  });
  assert.equal(c.getGatewayToken(macNew.gatewayId), '', 'a remote paired-token 401 clears only that target credential');
  assert.equal(c.getGateway(macNew.gatewayId).status, 'revoked', 'a remote paired-token 401 marks that gateway revoked');
  assert.equal(ctx.__pmMobileActiveGatewayToken, '', 'a rejected active target fails closed immediately');
  assert.equal(ctx.__pmMobileActiveGatewayExecutionEnabled, false, 'remote execution is disabled after rejection');
  assert.ok(ctx.__events.some((event) => event.type === 'pm-device-revoked'), 'the mobile router is notified after target revocation');
  assert.equal(c.getGatewayToken('gw-desktop'), 'desktop-token', 'another computer credential is never cleared by the rejected target');

  c.setGatewayToken(macNew.gatewayId, 'fresh-token', 'dev-mac-fresh');
  c.updateGatewayStatus(macNew.gatewayId, { status: 'online', revokedAt: 0, lastError: '' });
  c.setMobileActiveGatewayTarget(c.getGateway(macNew.gatewayId));
  await ctx.fetch('https://mac.example/api/chat', {
    method: 'POST',
    headers: { 'X-Pairing-Token': 'stale-token' },
  });
  assert.equal(c.getGatewayToken(macNew.gatewayId), 'fresh-token', 'a late 401 from an old request cannot revoke a freshly repaired grant');
  assert.equal(c.getGateway(macNew.gatewayId).status, 'online', 'stale-token rejection does not poison the repaired gateway status');

  const probeOld = c.upsertGateway({
    gatewayId: 'gw-probe-old',
    name: 'Probe computer',
    origin: 'https://probe.example',
    platform: 'linux',
  }, { token: 'probe-token', deviceId: 'dev-probe' });
  c.updateGatewayStatus(probeOld.gatewayId, { status: 'unknown' });
  ctx.__fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/gateway/descriptor') {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          gateway: {
            gatewayId: 'gw-probe-new',
            name: 'Probe computer',
            origin: 'https://probe.example',
            platform: 'linux',
            version: '1.0.18',
            execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.read'] },
          },
        }),
      };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '{}' };
  };
  const probed = await c.probeGateway('gw-probe-old');
  assert.equal(probed.gatewayId, 'gw-probe-new', 'descriptor probing adopts a regenerated stable identity');
  assert.equal(c.getGateway('gw-probe-old'), null, 'descriptor probing removes the stale id instead of persisting status onto it');
  assert.equal(c.getGateway('gw-probe-new').status, 'online', 'replacement descriptor is persisted online');
  assert.equal(c.getGatewayToken('gw-probe-new'), 'probe-token', 'descriptor identity migration preserves the existing pairing grant');

  ctx.__setDeviceToken('local-token');
  c.upsertGateway({
    gatewayId: 'gw-current-stable',
    name: 'This Prometheus',
    origin: 'https://phone.example',
    platform: 'win32',
    execution: { enabled: true, mode: 'paired-device-direct', scopes: ['chat.read'] },
  }, { token: 'local-token', deviceId: 'local-device' });
  const currentOriginEntries = c.loadGatewayCatalog().filter((entry) => c.normalizeGatewayOrigin(entry.origin) === 'https://phone.example');
  assert.equal(currentOriginEntries.length, 1, 'stable current-origin identity suppresses the synthetic legacy duplicate');
  assert.equal(currentOriginEntries[0].gatewayId, 'gw-current-stable');

  console.log('[test-mobile-gateway-auth-identity-hardening] passed: remote 401 isolation, stale-response safety, atomic identity migration, and current-origin dedupe');
}

run().catch((error) => {
  console.error('[test-mobile-gateway-auth-identity-hardening] failed:', error);
  process.exitCode = 1;
});
