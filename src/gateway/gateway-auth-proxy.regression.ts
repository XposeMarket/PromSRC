/**
 * Regression: a reverse proxy on this machine (Tailscale Funnel/Serve, a
 * tunnel, nginx) connects to the gateway from 127.0.0.1. Before this fix, with
 * no gateway.auth.token configured, every proxied internet request was
 * treated as trusted local traffic: the public Funnel URL served /api/status,
 * /api/tasks and the chat API to anyone (observed live 2026-10-14).
 *
 * Asserts both polarities: direct loopback stays trusted, proxied loopback
 * does not; paired devices still pass through a proxy.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-gw-auth-proxy-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const auth = require('./gateway-auth') as typeof import('./gateway-auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pairingAdmin = require('./pairing/pairing-admin-auth') as typeof import('./pairing/pairing-admin-auth');

const LOOPBACK = { socket: { remoteAddress: '127.0.0.1' } };
const FUNNEL_HEADERS = {
  host: 'example-host.tailnet.ts.net',
  'tailscale-funnel-request': '?1',
  'x-forwarded-for': '34.96.49.65',
  'x-forwarded-host': 'example-host.tailnet.ts.net',
  'x-forwarded-proto': 'https',
};

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  assert.equal(auth.resolveGatewayAuthToken(), '', 'fixture must have no gateway token (the vulnerable config)');

  check('direct loopback request without token is still trusted (desktop UI)', () => {
    const r = auth.evaluateGatewayRequest({ ...LOOPBACK, headers: { host: '127.0.0.1:18789' }, url: '/api/status' });
    assert.equal(r.ok, true);
  });

  check('Tailscale Funnel request (loopback socket + funnel headers) is rejected', () => {
    const r = auth.evaluateGatewayRequest({ ...LOOPBACK, headers: FUNNEL_HEADERS, url: '/api/tasks' });
    assert.equal(r.ok, false);
    assert.equal((r as any).status, 401);
  });

  check('any x-forwarded-for proxy hop is rejected', () => {
    const r = auth.evaluateGatewayRequest({ ...LOOPBACK, headers: { 'x-forwarded-for': '10.0.0.5' }, url: '/api/chat' });
    assert.equal(r.ok, false);
  });

  check('tailnet Serve request (tailscale-user-login) is rejected', () => {
    const r = auth.evaluateGatewayRequest({ ...LOOPBACK, headers: { 'tailscale-user-login': 'someone@example.com' }, url: '/api/status' });
    assert.equal(r.ok, false);
  });

  check('websocket-shaped funnel request (no Express ip) is rejected', () => {
    const r = auth.evaluateGatewayRequest({ headers: FUNNEL_HEADERS, socket: { remoteAddress: '::ffff:127.0.0.1' }, url: '/ws' });
    assert.equal(r.ok, false);
  });

  check('invalid pairing token over funnel is rejected, not downgraded to loopback trust', () => {
    const r = auth.evaluateGatewayRequest({ ...LOOPBACK, headers: { ...FUNNEL_HEADERS, 'x-pairing-token': 'not-a-real-token' }, url: '/api/tasks' });
    assert.equal(r.ok, false);
  });

  check('isDirectLoopbackRequest guards internal shutdown/update endpoints', () => {
    assert.equal(auth.isDirectLoopbackRequest({ ...LOOPBACK, headers: {} }), true);
    assert.equal(auth.isDirectLoopbackRequest({ ...LOOPBACK, headers: FUNNEL_HEADERS }), false);
    assert.equal(auth.isDirectLoopbackRequest({ socket: { remoteAddress: '192.168.1.20' }, headers: {} }), false);
  });

  const loopbackPolicy = {
    desktopToken: '', gatewayToken: '', electronManaged: false,
    gatewayHost: '127.0.0.1', gatewayPort: 18789, httpsEnabled: false, httpsPort: 0,
  };
  check('standalone loopback pairing admin still works locally', () => {
    const r = pairingAdmin.evaluatePairingAdminRequestWithPolicy({ ...LOOPBACK, headers: {} }, loopbackPolicy);
    assert.equal(r.ok, true);
  });
  check('pairing admin through Funnel on a loopback-bound gateway is rejected (no self-approval)', () => {
    const r = pairingAdmin.evaluatePairingAdminRequestWithPolicy({ ...LOOPBACK, headers: FUNNEL_HEADERS }, loopbackPolicy);
    assert.equal(r.ok, false);
  });

  console.log(`\ngateway-auth-proxy: ${passed} checks passed`);
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}
