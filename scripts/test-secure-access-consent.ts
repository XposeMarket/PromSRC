// PR821 I1/I2 regression: owner consent header, desktop-automation lock, deny policy,
// paired-device owner provenance, Electron/gateway HMAC parity. Synthetic values only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mintConsent, verifyConsent, sha256Hex, setConsentKeySourceForTests, applyConsentLock, ownerConsentActive, lockCanonical, deriveConsentKey } from '../src/security/secure-access-consent';
import { evaluateHardToolDeny } from '../src/gateway/tool-deny-policy';
import { setProvenanceStoreForTests, grantDeviceOwnerProvenance, revokeDeviceOwnerProvenance, deviceHasOwnerProvenance, deviceOwnerProvenance } from '../src/gateway/pairing/pairing-owner-provenance';

const OWNER = 'd'.repeat(64);
const P = '/api/secure-access/requests/req_1/submit';
const BODY = JSON.stringify({ secret: 'DUMMY_SECRET_NOT_REAL' });
setConsentKeySourceForTests(() => OWNER);

// 1. Consent header: exact binding, single use, expiry, key.
const h = mintConsent(OWNER, 'POST', P, sha256Hex(BODY));
assert.equal(verifyConsent(h, 'POST', P, '{"secret":"OTHER"}').ok, false, 'body bound');
assert.equal(verifyConsent(h, 'POST', '/api/secure-access/credentials/x/delete', BODY).ok, false, 'path bound');
assert.equal(verifyConsent(h, 'PUT', P, BODY).ok, false, 'method bound');
assert.equal(verifyConsent(h, 'POST', P, BODY).ok, true, 'valid');
assert.deepEqual(verifyConsent(h, 'POST', P, BODY), { ok: false, reason: 'replayed' });
assert.equal(verifyConsent(mintConsent(OWNER, 'POST', P, sha256Hex(BODY), Date.now() - 121_000), 'POST', P, BODY).ok, false, 'expired');
assert.equal(verifyConsent(mintConsent('e'.repeat(64), 'POST', P, sha256Hex(BODY)), 'POST', P, BODY).ok, false, 'wrong key');
assert.equal(verifyConsent(undefined, 'POST', P, BODY).ok, false);
setConsentKeySourceForTests(() => '');
assert.deepEqual(verifyConsent(mintConsent(OWNER, 'POST', P, sha256Hex(BODY)), 'POST', P, BODY), { ok: false, reason: 'unavailable' }, 'no Electron owner key: fail closed');
setConsentKeySourceForTests(() => OWNER);

// 2. Electron main mints byte-identical headers (shared canonical form).
const electron = require('../electron/owner-consent.js');
const eh: string = electron.mintConsent(OWNER, 'POST', P, BODY);
assert.equal(verifyConsent(eh, 'POST', P, BODY).ok, true, 'electron-minted header verifies in gateway');
assert.equal(electron.consentAction('POST', P) !== '', true);
assert.equal(electron.consentAction('POST', '/api/secure-access/credentials/c/revoke'), '', 'revoke never needs consent');
assert.equal(electron.consentAction('POST', '/api/pairing/devices/d1/owner-approval') !== '', true);

// 3. Desktop-automation lock: HMAC-authenticated, monotonic, auto-expiring.
const lockMac = (active: boolean, ts: number, key = OWNER) => crypto.createHmac('sha256', deriveConsentKey(key)!).update(lockCanonical(active, ts)).digest('hex');
let ts = Date.now();
assert.equal(applyConsentLock({ active: true, ts, mac: lockMac(true, ts, 'f'.repeat(64)) }), false, 'forged lock ignored');
assert.equal(ownerConsentActive(), false);
assert.equal(applyConsentLock({ active: true, ts, mac: lockMac(true, ts) }), true);
assert.equal(ownerConsentActive(), true);
for (const tool of ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_press_key', 'desktop_window_screenshot', 'voice_desktop_click']) {
  const d = evaluateHardToolDeny({ toolName: tool, args: { x: 10, y: 10 } });
  assert.equal(d.denied, true, tool + ' denied while consent open'); assert.equal(d.category, 'owner_approval_in_progress');
}
assert.equal(applyConsentLock({ active: false, ts, mac: lockMac(false, ts) }), false, 'replayed ts rejected');
assert.equal(applyConsentLock({ active: false, ts: ts + 1, mac: lockMac(false, ts + 1) }), true);
assert.equal(ownerConsentActive(), false);
assert.equal(applyConsentLock({ active: true, ts: ts + 2, mac: lockMac(true, ts + 2) }), true);
assert.equal(ownerConsentActive(Date.now() + 151_000), false, 'lock auto-expires if Electron dies mid-approval');
ts = Date.now() + 3; applyConsentLock({ active: false, ts, mac: lockMac(false, ts) });

// 4. Deny policy without lock: owner window by name; owner HTTP routes from browser/fetch tools.
assert.equal(evaluateHardToolDeny({ toolName: 'desktop_focus_window', args: { name: 'Prometheus owner approval' } }).category, 'owner_approval_window');
assert.equal(evaluateHardToolDeny({ toolName: 'desktop_screenshot', args: {} }).denied, false, 'normal desktop use unaffected');
for (const [tool, url] of [['browser_open', 'http://127.0.0.1:18789/api/secure-access/requests/r/submit'], ['web_fetch', 'http://127.0.0.1:18789/api/pairing/devices/d/owner-approval'], ['browser_run_js', "fetch('/api/owner-consent/lock')"]]) {
  assert.equal(evaluateHardToolDeny({ toolName: tool, args: { url, script: url } }).category, 'owner_surface_automation', tool);
}

// 5. Paired-device provenance: granted only explicitly, bound to token hash, revocable.
const mem = new Map<string, string>();
const devs = [{ id: 'dev1', enabled: true, tokenHash: 'h1' }, { id: 'dev2', enabled: true, tokenHash: 'h2' }];
setProvenanceStoreForTests(() => ({ get: k => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, delete: k => { mem.delete(k); } }),
  { list: () => devs, verify: t => devs.find(d => 'tok-' + d.id === t) || null });
assert.equal(deviceHasOwnerProvenance('tok-dev1'), false, 'pairing alone is not owner proof');
assert.equal(grantDeviceOwnerProvenance('dev1'), true);
assert(Array.from(mem.keys()).every(k => k.startsWith('secure.access.')), 'stored in reserved vault namespace');
assert.equal(deviceHasOwnerProvenance('tok-dev1'), true);
assert.equal(deviceHasOwnerProvenance('tok-dev2'), false);
devs[0].tokenHash = 'h1-rotated';
assert.equal(deviceOwnerProvenance('dev1'), null, 'token rotation invalidates grant');
devs[0].tokenHash = 'h1';
devs[0].enabled = false; assert.equal(deviceHasOwnerProvenance('tok-dev1'), false, 'disabled device fails closed'); devs[0].enabled = true;
revokeDeviceOwnerProvenance('dev1');
assert.equal(deviceHasOwnerProvenance('tok-dev1'), false, 'reverse path');
assert.equal(grantDeviceOwnerProvenance('missing'), false);
setProvenanceStoreForTests(null);

// 6. Static wiring: native window hardening, routes, UI.
const root = path.resolve(__dirname, '..');
const oc = fs.readFileSync(path.join(root, 'electron/owner-consent.js'), 'utf8');
for (const re of [/setContentProtection\(true\)/, /ev\.isTrusted/, /<canvas id="c"/, /remote-debugging-port/, /devTools: false/, /postLock\(true\)\)\) throw/]) assert.match(oc, re);
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
assert.match(main, /handleTrustedMain\('owner-consent:request'/);
assert.match(main, /'X-Prom-Owner-Consent': consentHeader/);
const pairing = fs.readFileSync(path.join(root, 'src/gateway/routes/pairing.router.ts'), 'utf8');
assert.match(pairing, /authority !== 'electron'/); assert.match(pairing, /revokeDeviceOwnerProvenance\(id\);\s*const ok = removeDevice/);
const server = fs.readFileSync(path.join(root, 'src/gateway/server-v2.ts'), 'utf8');
assert(server.indexOf("app.use('/', ownerConsentRouter)") > 0);
const bd = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/handlers/browser-desktop.ts'), 'utf8');
assert.match(bd, /\^desktop_\/\.test\(String\(name\)\) && ownerConsentActive\(\)/);
const ui = fs.readFileSync(path.join(root, 'web-ui/src/features/secure-access/secure-access-core.js'), 'utf8');
assert.match(ui, /X-Prom-Owner-Consent/); assert.match(ui, /data-sa-owner-blocked/);
console.log('PASS I1/I2 consent: header bound to method/path/body, single use, 120s, key-bound, fail-closed without Electron key; Electron/gateway HMAC parity; HMAC lock pauses every desktop tool and auto-expires; owner window/routes refused to tools; device provenance explicit, reserved-namespace, hash-bound, revocable; static wiring.');
