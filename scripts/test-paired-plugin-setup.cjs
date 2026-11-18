// Real pairing registry + setup guard. Synthetic credentials; isolated temporary config only.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-plugin-'));
const load = p => require('../dist/' + p);
load('config/config.js').getConfig = () => ({ getConfigDir: () => root });
const store = load('gateway/pairing/pairing-store.js');
const storage = load('security/plugin-credential-state.js');
let available = true; storage.protectedPluginStorageAvailable = () => available;
const owner = load('gateway/routes/secure-access.router.js');
const setup = load('gateway/routes/plugin-setup-access.js');
function pair(name) {
  const challenge = store.createPairingChallenge();
  const request = store.createPendingRequest({ challengeId: challenge.id, deviceName: name, deviceFingerprint: name, userAgent: 'fixture', ipHint: '' });
  return store.approvePendingRequest(request.id);
}
const active = pair('Enabled phone without owner grant'), disabled = pair('Disabled'), revoked = pair('Revoked');
store.setDeviceEnabled(disabled.device.id, false); store.removeDevice(revoked.device.id);
function req(token, origin = 'https://app.example', host = 'app.example') {
  return { method: 'POST', path: '/api/auth/x-api/credentials', originalUrl: '/api/auth/x-api/credentials', headers: { host, origin, ...(token ? { 'x-pairing-token': token } : {}) }, socket: { remoteAddress: '198.51.100.2' }, is: t => t === 'application/json', body: {} };
}
function invoke(request, guard = setup.requirePluginSetup) {
  let status = 200, allowed = false, body;
  const res = { setHeader() {}, status(v) { status = v; return this; }, json(v) { body = v; } };
  guard(request, res, () => allowed = true); return { status, allowed, body };
}
try {
  const good = req(active.deviceToken);
  assert.equal(owner.ownerSurfaceState(good).canApprove, false, 'ordinary pairing must not acquire owner provenance');
  assert.equal(setup.pluginSetupSurfaceState(good).canConfigure, true);
  assert.equal(invoke(good).allowed, true);
  assert.equal(invoke(good, owner.requireProtectedOwner).allowed, false, 'general owner gate unchanged');
  for (const token of [undefined, 'unknown', disabled.deviceToken, revoked.deviceToken]) {
    assert.equal(setup.pluginSetupSurfaceState(req(token)).canConfigure, false);
    assert.equal(invoke(req(token)).allowed, false);
  }
  for (const origin of ['https://evil.example', 'http://app.example']) assert.equal(invoke(req(active.deviceToken, origin)).allowed, false);
  const noOrigin = req(active.deviceToken); delete noOrigin.headers.origin; assert.equal(invoke(noOrigin).allowed, false);
  const bodyOnly = req(); bodyOnly.body.token = active.deviceToken; assert.equal(invoke(bodyOnly).allowed, false);
  available = false; assert.equal(invoke(good).status, 409); available = true;
  for (const id of ['openai-compatible-model', 'mcp-stdio', 'local-resource', 'browser-session', 'unknown', undefined]) {
    assert(!setup.PAIRED_PLUGIN_SETUP_ADAPTERS.has(id));
    assert.equal(invoke(good, (req,res,next)=>setup.requirePluginSetupAdapter(req,res,next,id)).allowed,false);
  }
  for (const id of setup.PAIRED_PLUGIN_SETUP_ADAPTERS) assert.equal(invoke(good,(req,res,next)=>setup.requirePluginSetupAdapter(req,res,next,id)).allowed,true);
  store.setDeviceEnabled(active.device.id, false); assert.equal(invoke(good).allowed, false, 'revocation checked each request');
  store.setDeviceEnabled(active.device.id, true); assert.equal(invoke(good).allowed, true);
  // Persisted enabled pairing remains valid after the registry module is reloaded; no provenance migration.
  delete require.cache[require.resolve('../dist/gateway/pairing/pairing-store.js')];
  assert(load('gateway/pairing/pairing-store.js').verifyDeviceToken(active.deviceToken));
  console.log('PASS paired plugin setup: real pairing with no owner grant, save guard, owner isolation, disabled/revoked/unknown/missing tokens, hostile/no Origin, remote HTTP, body spoof, unavailable storage, restart and executable adapters excluded.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
