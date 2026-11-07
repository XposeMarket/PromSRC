// PR821 F3 owner-boundary regression. Synthetic dummy credentials only; no live operations.
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSecureAccessRouter, type OwnerProof } from '../src/gateway/routes/secure-access.router';
import { captureGatewayOwnerSecrets, secureAccessOwnerToken, gatewayRespawnSecrets, pairedDeviceOwnerProofTrusted } from '../src/security/secure-access-owner';

const OWNER = 'a'.repeat(64);
type Spy = Record<string, number>;
function fakeRuntime(spy: Spy) {
  const hit = (name: string, value: any = { ok: true }) => { spy[name] = (spy[name] || 0) + 1; return value; };
  const broker = {
    listRequests: () => hit('listRequests', []),
    create: () => hit('create', { id: 'req_1' }),
    submit: () => hit('submit', { id: 'cred_1' }),
    cancel: () => hit('cancel'),
    revoke: () => hit('revoke', { id: 'cred_1' }),
    setGrants: () => hit('setGrants', { id: 'cred_1' }),
    delete: () => hit('delete'),
    replace: () => hit('replace', { id: 'req_2' }),
    events: () => hit('events', []),
    recordOutcome: () => hit('recordOutcome', { id: 'cred_1' }),
  };
  const proxy = new Proxy(broker as any, { get: (t, k) => t[k] || (() => hit(String(k), { id: 'cred_1' })) });
  return {
    getSecureAccess: () => proxy,
    secureAccessCredentials: () => hit('credentials', []),
    secureAccessStatus: async () => hit('status', {}),
    prepareProtectedLogin: async () => hit('prepareProtectedLogin', { phase: 'ready' }),
    submitProtectedLogin: async () => hit('submitProtectedLogin', { phase: 'submitted_outcome_unknown', transferred: true }),
    cancelProtectedLogin: async () => { hit('cancelProtectedLogin'); },
  } as any;
}
const MUTATIONS: Array<[string, object]> = [
  ['/requests', { origin: 'https://fixture.test', mode: 'existing', label: 'x' }],
  ['/requests/req_1/submit', { secret: 'DUMMY_SECRET_NOT_REAL', identifier: 'a@example.test' }],
  ['/credentials/cred_1/revoke', {}],
  ['/credentials/cred_1/grants', { grants: ['main'] }],
  ['/credentials/cred_1/delete', { confirm: true }],
  ['/credentials/cred_1/replace', {}],
  ['/credentials/cred_1/login/prepare', { url: 'https://fixture.test/login' }],
  ['/credentials/cred_1/login/submit', { confirm: true }],
  ['/credentials/cred_1/outcome', { verified: true }],
];

async function withServer(proof: OwnerProof, fn: (call: (route: string, body?: object, extra?: Record<string, string>) => Promise<Response>, spy: Spy) => Promise<void>) {
  const spy: Spy = {};
  const app = express(); app.use(express.json({ limit: '32kb' }));
  app.use(createSecureAccessRouter(fakeRuntime(spy), proof));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  // A model terminal can forge all of this: loopback peer, Origin==Host, JSON.
  const call = (route: string, body?: object, extra: Record<string, string> = {}) => fetch(origin + '/api/secure-access' + route, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin, ...extra }, body: body ? JSON.stringify(body) : undefined });
  try { await fn(call, spy); } finally { await new Promise<void>(r => server.close(() => r())); }
}
const total = (spy: Spy) => Object.entries(spy).filter(([k]) => !['listRequests', 'credentials', 'status', 'events'].includes(k)).reduce((n, [, v]) => n + v, 0);

(async () => {
  const proof: OwnerProof = { ownerToken: () => OWNER, deviceTrusted: () => true, verifyDevice: t => t === 'dev-ok' };

  await withServer(proof, async (call, spy) => {
    for (const [route, body] of MUTATIONS) {
      for (const extra of [{}, { cookie: 'prom_sa_owner=' + 'b'.repeat(64) }, { cookie: 'prom_sa_owner=short' }, { cookie: 'other=' + OWNER }, { 'x-pairing-token': 'bad' }]) {
        const res = await call(route, body, extra as any);
        assert.equal(res.status, 403, `${route} ${JSON.stringify(extra)}`);
        assert.equal((await res.json() as any).error, 'OWNER_SURFACE_REQUIRED');
      }
    }
    assert.equal(total(spy), 0, 'runtime must not be invoked without owner proof: ' + JSON.stringify(spy));
    for (const [route, body] of MUTATIONS) {
      const before = total(spy);
      const res = await call(route, body, { cookie: `theme=dark; prom_sa_owner=${OWNER}` });
      assert.equal(res.status, 200, `${route} owner cookie`);
      assert(total(spy) > before, `${route} runtime invoked with owner cookie`);
    }
    for (const [route, body] of MUTATIONS) assert.equal((await call(route, body, { 'x-pairing-token': 'dev-ok' })).status, 200, `${route} paired device`);
    // Cancel routes are safe-direction aborts: allowed without proof.
    assert.equal((await call('/requests/req_1/cancel', {})).status, 200);
    assert.equal((await call('/credentials/cred_1/login/cancel', {})).status, 200);
    for (const route of ['/status', '/requests', '/credentials', '/credentials/cred_1/audit']) assert.equal((await call(route)).status, 200, route);
    // Path tricks must not reach the exemption.
    assert.equal((await call('/requests/req_1/cancel/../submit', { secret: 'x' })).status, 403);
  });

  // Untrusted paired path (CLI/standalone, or gateway token configured): device token fails closed.
  await withServer({ ownerToken: () => OWNER, deviceTrusted: () => false, verifyDevice: t => t === 'dev-ok' }, async (call, spy) => {
    for (const [route, body] of MUTATIONS) assert.equal((await call(route, body, { 'x-pairing-token': 'dev-ok' })).status, 403, route);
    assert.equal(total(spy), 0);
  });
  // No Electron (empty owner token): an empty cookie never matches.
  await withServer({ ownerToken: () => '', deviceTrusted: () => false, verifyDevice: () => false }, async (call, spy) => {
    for (const [route, body] of MUTATIONS) {
      assert.equal((await call(route, body, { cookie: 'prom_sa_owner=' })).status, 403, route);
      assert.equal((await call(route, body)).status, 403, route);
    }
    assert.equal(total(spy), 0);
  });

  // Env scrub: captured before children spawn; children inherit nothing.
  process.env.PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN = OWNER;
  process.env.PROMETHEUS_PAIRING_ADMIN_TOKEN = 'DUMMY_PAIRING_ADMIN';
  process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN = 'DUMMY_RPC';
  captureGatewayOwnerSecrets();
  assert.equal(secureAccessOwnerToken(), OWNER);
  for (const k of ['PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN', 'PROMETHEUS_PAIRING_ADMIN_TOKEN', 'PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN']) assert.equal(process.env[k], undefined, k);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.entries(process.env).filter(([k,v])=>/SECURE_ACCESS_OWNER|PAIRING_ADMIN|BROWSER_RPC_TOKEN/.test(k)||/DUMMY_PAIRING_ADMIN|DUMMY_RPC|aaaaaaaa/.test(String(v)))))'], { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.stdout, '[]', 'spawned child must not inherit owner/pairing/RPC secrets');
  // Readers use the captured values.
  const { getInHouseBrowserRpcConfig } = await import('../src/gateway/browser/chrome');
  process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL = 'http://127.0.0.1:1';
  assert.equal(getInHouseBrowserRpcConfig()?.token, 'DUMMY_RPC');
  delete process.env.PROMETHEUS_ELECTRON_BROWSER_RPC_URL;
  assert.deepEqual(Object.keys(gatewayRespawnSecrets()).sort(), ['PROMETHEUS_ELECTRON_BROWSER_RPC_TOKEN', 'PROMETHEUS_PAIRING_ADMIN_TOKEN', 'PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN']);
  // Paired-device owner proof is never trusted outside Electron-managed mode.
  const prevManaged = process.env.PROMETHEUS_ELECTRON_MANAGED; delete process.env.PROMETHEUS_ELECTRON_MANAGED;
  assert.equal(pairedDeviceOwnerProofTrusted(), false);
  if (prevManaged !== undefined) process.env.PROMETHEUS_ELECTRON_MANAGED = prevManaged;

  // Static boundary checks.
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'src/gateway/server-v2.ts'), 'utf8');
  const firstImport = server.split('\n').find(l => /^import /.test(l));
  assert.equal(firstImport?.trim(), "import '../security/secure-access-owner-boot.js';", 'owner capture must be the first gateway import');
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /name: 'prom_sa_owner', value: SECURE_ACCESS_OWNER_TOKEN,\s*httpOnly: true, secure: false, sameSite: 'strict', path: '\/api\/secure-access'/);
  assert.match(main, /win\.webContents\.session\.cookies\.set/);
  assert.match(main, /PROMETHEUS_SECURE_ACCESS_OWNER_TOKEN: SECURE_ACCESS_OWNER_TOKEN/);
  for (const m of main.matchAll(/loadURL\(GATEWAY_URL\)/g)) {
    const before = main.slice(Math.max(0, m.index! - 400), m.index!);
    assert.match(before, /installSecureAccessOwnerCookie\(/, 'owner cookie must be installed before every owner-window loadURL');
  }
  // The native browser views must never receive the owner session (empty partition = default session).
  assert.match(main, /return `persist:prometheus-inhouse-\$\{slugifyNativeProfile\(profileId\)\}`/);
  const ui = fs.readFileSync(path.join(root, 'web-ui/src/features/secure-access/secure-access-core.js'), 'utf8');
  assert.match(ui, /OWNER_SURFACE_REQUIRED/);
  console.log('PASS F3 owner boundary: 9 mutations x 5 forged/no-proof variants 403 with runtime untouched; owner cookie 200; trusted paired device 200; untrusted paired/no-Electron fail closed; cancel/GET exempt; env scrub + child inherits nothing; readers use captured secrets; static Electron cookie + first-import checks.');
})().catch(e => { console.error(e); process.exitCode = 1; });
