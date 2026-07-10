import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluatePairingAdminRequestWithPolicy,
} = require('../dist/gateway/pairing/pairing-admin-auth.js');

const electronPolicy = {
  desktopToken: 'desktop-secret',
  gatewayToken: '',
  electronManaged: true,
  gatewayHost: '127.0.0.1',
  gatewayPort: 18789,
  httpsEnabled: false,
  httpsPort: 0,
};

const remoteRequest = {
  headers: {},
  ip: '203.0.113.10',
  socket: { remoteAddress: '203.0.113.10' },
};

assert.equal(evaluatePairingAdminRequestWithPolicy(remoteRequest, electronPolicy).ok, false,
  'remote callers without desktop authority must be rejected');
assert.equal(evaluatePairingAdminRequestWithPolicy({
  ...remoteRequest,
  headers: { 'x-pairing-token': 'previously-approved-device-token' },
}, electronPolicy).ok, false, 'paired-device credentials must not become pairing administrators');
assert.deepEqual(evaluatePairingAdminRequestWithPolicy({
  ...remoteRequest,
  headers: { 'x-prometheus-pairing-admin': 'desktop-secret' },
}, electronPolicy), { ok: true, authority: 'electron' });
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { 'x-prometheus-pairing-admin': 'wrong' },
  ip: '127.0.0.1',
}, electronPolicy).ok, false, 'Electron-managed loopback must not fall through on a wrong token');

const gatewayPolicy = { ...electronPolicy, desktopToken: '', gatewayToken: 'gateway-secret', electronManaged: false };
assert.deepEqual(evaluatePairingAdminRequestWithPolicy({
  ...remoteRequest,
  headers: { authorization: 'Bearer gateway-secret' },
}, gatewayPolicy), { ok: true, authority: 'gateway-token' });
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { origin: 'http://127.0.0.1:18789', 'sec-fetch-site': 'same-origin' },
  ip: '127.0.0.1',
}, gatewayPolicy).ok, false, 'configured gateway credentials must not fall through to loopback trust');

const standalonePolicy = {
  ...electronPolicy,
  desktopToken: '',
  gatewayToken: '',
  electronManaged: false,
};
assert.deepEqual(evaluatePairingAdminRequestWithPolicy({
  headers: { origin: 'http://127.0.0.1:18789', 'sec-fetch-site': 'same-origin' },
  ip: '127.0.0.1',
}, standalonePolicy), { ok: true, authority: 'local-standalone' });
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { origin: 'http://localhost:9999', 'sec-fetch-site': 'same-site' },
  ip: '127.0.0.1',
}, standalonePolicy).ok, false, 'alternate localhost origins must not administer pairing');
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { origin: 'null' },
  ip: '127.0.0.1',
}, standalonePolicy).ok, false, 'Origin:null must not administer pairing');
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { 'sec-fetch-site': 'cross-site' },
  ip: '127.0.0.1',
}, standalonePolicy).ok, false, 'cross-site browser requests must not use no-Origin fallback');
assert.deepEqual(evaluatePairingAdminRequestWithPolicy({
  headers: {},
  ip: '127.0.0.1',
}, standalonePolicy), { ok: true, authority: 'local-standalone' },
  'non-browser loopback administration remains available in standalone development');
assert.equal(evaluatePairingAdminRequestWithPolicy({
  headers: { origin: 'http://127.0.0.1:18789' },
  ip: '127.0.0.1',
}, { ...standalonePolicy, gatewayHost: '0.0.0.0' }).ok, false,
  'LAN-bound gateways must require an explicit credential');

const { router } = require('../dist/gateway/routes/pairing.router.js');
const routeMiddleware = new Map();
for (const layer of router.stack || []) {
  if (!layer.route) continue;
  const path = String(layer.route.path || '');
  for (const method of Object.keys(layer.route.methods || {})) {
    routeMiddleware.set(`${method.toUpperCase()} ${path}`, (layer.route.stack || []).map((entry) => entry.handle?.name));
  }
}

const protectedRoutes = [
  'POST /api/pairing/qr',
  'GET /api/pairing/pending',
  'POST /api/pairing/approve',
  'POST /api/pairing/deny',
  'GET /api/pairing/devices',
  'PATCH /api/pairing/devices/:id',
  'DELETE /api/pairing/devices/:id',
  'GET /api/pairing/remote-access',
  'PUT /api/pairing/remote-access',
  'GET /api/pairing/tailscale/status',
  'POST /api/pairing/tailscale/funnel/enable',
  'POST /api/pairing/tailscale/funnel/disable',
  'GET /api/pairing/tailscale/funnel/status',
];
for (const route of protectedRoutes) {
  assert.ok(routeMiddleware.has(route), `missing expected pairing route: ${route}`);
  assert.ok(routeMiddleware.get(route).includes('requirePairingAdmin'), `${route} lacks pairing admin middleware`);
}

for (const publicRoute of [
  'GET /api/pairing/certificate',
  'POST /api/pairing/claim',
  'GET /api/pairing/poll/:id',
  'GET /api/pairing/me',
]) {
  assert.ok(routeMiddleware.has(publicRoute), `missing expected public pairing route: ${publicRoute}`);
  assert.ok(!routeMiddleware.get(publicRoute).includes('requirePairingAdmin'), `${publicRoute} must remain mobile-accessible`);
}

console.log('Pairing admin boundary tests passed.');
