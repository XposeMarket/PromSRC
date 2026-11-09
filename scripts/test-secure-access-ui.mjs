// Secure-access UI tests: isolated fixtures only (fake fetch, dummy canaries).
// Run: node scripts/test-secure-access-ui.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const CANARY = 'CANARY-pw-7f3a9e!';

// ---- static guardrails -------------------------------------------------
const core = read('web-ui/src/features/secure-access/secure-access-core.js');
const settings = read('web-ui/src/features/secure-access/secure-access-settings.js');
for (const [name, src] of [['core', core], ['settings', settings]]) {
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${name}: no storage`);
  assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/, `${name}: no console output`);
  // Only the static lock SVG uses innerHTML; all request/credential data is textContent.
  assert.equal((src.match(/\.innerHTML\s*=/g) || []).length, name === 'core' ? 1 : 0, `${name}: data never inserted as HTML`);
  assert.doesNotMatch(src, /\.innerHTML\s*=(?!\s*`<svg)/, `${name}: innerHTML limited to static icon`);
}
assert.match(core, /autocomplete: copy\.auto/, 'password field uses mode-specific autocomplete');
assert.match(core, /'new-password'/);
assert.match(core, /'current-password'/);
assert.match(core, /getRandomValues/, 'generation uses browser crypto');
assert.doesNotMatch(core, /Math\.random\(\)\.toString|Math\.random\(\) \*/, 'no Math.random password material');
assert.match(read('web-ui/src/features/secure-access/secure-access-desktop-dock.js'), /mountSecureAccessDock/, 'desktop chat dock module');
assert.match(read('web-ui/src/desktop-entry.js'), /secure-access-desktop-dock\.js/, 'desktop chat dock loaded');
assert.doesNotMatch(read('web-ui/src/pages/ChatPage.js'), /secure-access/, 'ChatPage stays untouched (size ratchet)');
assert.match(read('web-ui/src/mobile/mobile-chat-page-runtime.js'), /mountSecureAccessDock/, 'mobile chat dock wired');
assert.match(read('web-ui/src/pages/SettingsPage.js'), /mountSavedAccessSettings/, 'desktop settings wired');
assert.doesNotMatch(read('web-ui/src/mobile/mobile-settings.js'), /mountSavedAccessSettings|saved-access/, 'retired mobile settings has no dead Saved access code');
assert.match(read('web-ui/index.html'), /id="settings-secure-access-host"/, 'desktop settings host');
assert.doesNotMatch(settings, /grants:\s*\[[^\]]*team/i, 'no team grants offered in v1');

// ---- DOM fixtures ------------------------------------------------------
const { window, document } = parseHTML('<!doctype html><html><head></head><body><div id="host"></div></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.crypto ??= webcrypto;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const calls = [];
function fakeFetch(responses) {
  return async (p, opts = {}) => {
    calls.push({ path: p, opts });
    const key = `${(opts.method || 'GET').toUpperCase()} ${p.split('?')[0]}`;
    const hit = Object.entries(responses).find(([k]) => key.endsWith(k) || key === k);
    if (!hit) throw new Error('unexpected');
    return typeof hit[1] === 'function' ? hit[1](opts) : hit[1];
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const mod = await import(pathToFileURL(path.join(root, 'web-ui/src/features/secure-access/secure-access-core.js')).href);

// Password generator
const pw = mod.generateSecurePassword(24, webcrypto);
assert.equal(pw.length, 24);
assert.match(pw, /[A-Z]/); assert.match(pw, /[a-z]/); assert.match(pw, /[0-9]/); assert.match(pw, /[^A-Za-z0-9]/);
assert.notEqual(pw, mod.generateSecurePassword(24, webcrypto));

// Origin guard
assert.equal(mod.isExactHttpsOriginUrl('https://a.example/login', 'https://a.example'), true);
assert.equal(mod.isExactHttpsOriginUrl('http://a.example/login', 'https://a.example'), false);
assert.equal(mod.isExactHttpsOriginUrl('https://evil.a.example/login', 'https://a.example'), false);

// Card: submit sends exact secret once, clears DOM, receipt + callback carry no secret.
const host = document.getElementById('host');
const request = { id: 'req1', sessionId: 's1', label: 'Demo', purpose: 'test', origin: 'https://demo.example', mode: 'existing', identifier: 'me@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), status: 'pending' };
let resolvedMeta = null;
const card = mod.mountSecureAccessCard(host, {
  request, status: { persistentAllowed: false, owner: { canApprove: true } },
  fetchJson: fakeFetch({ 'POST /api/secure-access/requests/req1/submit': { credential: { id: 'cred1', storage: 'session' } } }),
  onResolved: (m) => { resolvedMeta = m; },
});
const secret = card.el.querySelector('input[data-prom-secret]');
assert.equal(secret.getAttribute('type'), 'password');
assert.equal(secret.getAttribute('autocomplete'), 'current-password');
card.el.querySelector('button[aria-controls]').click();
assert.equal(secret.getAttribute('type'), 'text', 'reveal works');
assert.equal(secret.getAttribute('data-prom-secret'), 'true', 'secret marker survives reveal');
card.el.querySelector('button[aria-controls]').click();
const sw = card.el.querySelector('[role="switch"]');
assert.equal(sw.getAttribute('aria-checked'), 'false', 'remember forced off without protected key');
assert.ok(sw.hasAttribute('disabled'));
secret.value = CANARY;
card.el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await flush(); await flush();
const submit = calls.find((c) => c.path.endsWith('/submit'));
const body = JSON.parse(submit.opts.body);
assert.equal(body.secret, CANARY, 'exact secret preserved');
assert.equal(body.remember, false);
assert.equal(body.generated, false);
assert.equal(secret.value, '', 'secret cleared after success');
assert.ok(!card.el.textContent.includes(CANARY), 'no secret in receipt');
assert.ok(!JSON.stringify(resolvedMeta).includes(CANARY), 'callback metadata only');
assert.equal(resolvedMeta.status, 'saved');
assert.match(card.el.textContent, /cleared when Prometheus restarts/, 'session-only does not claim persistence');
const text = mod.secureAccessContinuationText({ ...resolvedMeta, identifier: 'me@example.test' });
assert.ok(!text.includes(CANARY) && !text.includes('me@example.test'), 'continuation excludes secret and identifier');
card.destroy();

// Generated password requires recovery confirmation before save.
calls.length = 0;
const card2 = mod.mountSecureAccessCard(host, {
  request: { ...request, id: 'req2', mode: 'new' }, status: { persistentAllowed: true, owner: { canApprove: true } },
  fetchJson: fakeFetch({ 'POST /api/secure-access/requests/req2/submit': { credential: { id: 'c2', storage: 'persistent' } } }),
});
const s2 = card2.el.querySelector('input[data-prom-secret]');
assert.equal(s2.getAttribute('autocomplete'), 'new-password');
[...card2.el.querySelectorAll('button')].find((b) => /Generate/.test(b.textContent)).click();
assert.ok(s2.value.length >= 16);
const save2 = card2.el.querySelector('button[type="submit"]');
assert.ok(save2.disabled, 'save blocked until recovery confirmed');
const rec = card2.el.querySelector('input[type="checkbox"]');
rec.checked = true; rec.dispatchEvent(new window.Event('change'));
assert.ok(!save2.disabled);
card2.el.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await flush(); await flush();
const b2 = JSON.parse(calls.find((c) => c.path.endsWith('/submit')).opts.body);
assert.equal(b2.generated, true); assert.equal(b2.recoveryConfirmed, true); assert.equal(b2.remember, true);
assert.equal(s2.value, '');
card2.destroy();

// Cancel and destroy clear typed values.
const card3 = mod.mountSecureAccessCard(host, { request: { ...request, id: 'req3' }, status: { owner: { canApprove: true } }, fetchJson: fakeFetch({ 'POST /api/secure-access/requests/req3/cancel': { ok: true } }) });
const s3 = card3.el.querySelector('input[data-prom-secret]');
s3.value = CANARY;
[...card3.el.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
assert.equal(s3.value, '', 'cancel clears immediately');
await flush();
card3.destroy();
const card4 = mod.mountSecureAccessCard(host, { request: { ...request, id: 'req4' }, status: { owner: { canApprove: true } }, fetchJson: fakeFetch({}) });
const s4 = card4.el.querySelector('input[data-prom-secret]');
s4.value = CANARY; card4.destroy();
assert.equal(s4.value, '', 'unmount clears');
const card5 = mod.mountSecureAccessCard(host, { request: { ...request, id: 'req5' }, status: { owner: { canApprove: true } }, fetchJson: fakeFetch({}) });
const s5 = card5.el.querySelector('input[data-prom-secret]');
s5.value = CANARY; card5.expire();
assert.equal(s5.value, '', 'expiry clears');
card5.destroy();

// Continuation: metadata-only, once, local only, not on expiry.
const sent = [];
const cont = mod.createSecureAccessContinuation((t) => sent.push(t));
cont({ requestId: 'r', status: 'saved', label: 'Demo', origin: 'https://demo.example', credentialId: 'c', local: true });
cont({ requestId: 'r', status: 'saved', local: true });
cont({ requestId: 'x', status: 'saved', local: false });
cont({ requestId: 'y', status: 'expired', local: true });
assert.equal(sent.length, 1);

// Pending login card: approve is login only.
calls.length = 0;
const lc = mod.mountPendingLoginCard(host, { credential: { id: 'c9', label: 'Demo', origin: 'https://demo.example', pendingLogin: true }, fetchJson: fakeFetch({ 'POST /api/secure-access/credentials/c9/login/submit': { phase: 'submitted_outcome_unknown', transferred: true } }) });
[...lc.el.querySelectorAll('button')].find((b) => b.textContent === 'Approve sign-in').click();
await flush(); await flush();
assert.deepEqual(JSON.parse(calls[0].opts.body), { confirm: true });
lc.destroy();

// Dock: renders only matching pending session requests + unexpired pending
// logins, keeps typed DOM values across polls, and polls metadata only.
calls.length = 0;
const dockHost = document.createElement('div');
document.body.appendChild(dockHost);
const future = new Date(Date.now() + 60000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();
const dock = mod.mountSecureAccessDock(dockHost, {
  sessionId: 's1',
  fetchJson: fakeFetch({
    'GET /api/secure-access/status': { persistentAllowed: false, owner: { canApprove: true } },
    'GET /api/secure-access/requests': { requests: [
      { ...request, id: 'd1', sessionId: 's1' },
      { ...request, id: 'd2', sessionId: 'other' },
      { ...request, id: 'd3', sessionId: 's1', status: 'saved' },
    ] },
    'GET /api/secure-access/credentials': { credentials: [
      { id: 'L1', label: 'Demo', origin: 'https://demo.example', pendingLogin: true, loginSessionId: 's1', loginExpiresAt: future },
      { id: 'L2', label: 'Old', origin: 'https://demo.example', pendingLogin: true, loginSessionId: 's1', loginExpiresAt: past },
      { id: 'L3', label: 'Other', origin: 'https://demo.example', pendingLogin: true, loginSessionId: 'other' },
    ] },
  }),
});
await dock.refresh(); await flush();
assert.equal(dockHost.querySelectorAll('[data-secure-access-request]').length, 1, 'only matching pending request');
assert.ok(dockHost.querySelector('[data-secure-access-request="d1"]'));
assert.equal(dockHost.querySelectorAll('[data-secure-access-login]').length, 1, 'only matching unexpired login');
const dockSecret = dockHost.querySelector('input[data-prom-secret]');
dockSecret.value = CANARY;
await dock.refresh(); await flush();
assert.equal(dockHost.querySelector('input[data-prom-secret]'), dockSecret, 'poll keeps same DOM input');
assert.equal(dockSecret.value, CANARY, 'typed value preserved across polls');
assert.ok(calls.every((c) => !String(c.path).includes(CANARY) && !String(c.opts.body || '').includes(CANARY)), 'polls carry no secret');
dock.destroy();
assert.equal(dockSecret.value, '', 'dock teardown clears');

// Hidden correctness: component rules like .sa-check{display:flex} must not
// beat the [hidden] attribute (recovery confirm leaked on existing-mode cards).
assert.match(core, /\.sa-card \[hidden\][^{]*\{display:none!important\}/, 'scoped [hidden] override present');
assert.match(core, /\.sa-settings \[hidden\]/, 'settings panels respect [hidden]');
{
  const exHost = document.createElement('div'); document.body.appendChild(exHost);
  const ex = mod.mountSecureAccessCard(exHost, { request: { ...request, id: 'reqHidden', mode: 'existing' }, status: { persistentAllowed: true, owner: { canApprove: true } }, fetchJson: async () => ({}) });
  const rec = ex.el.querySelector('input[type="checkbox"][id$="-recovery"]');
  assert.ok(rec && rec.closest('label').hidden === true, 'existing mode keeps recovery confirm hidden');
  ex.destroy?.();
}
// Mobile dock fit must mount/teardown without layout APIs (no throw, no RO).
{
  const mHost = document.createElement('div'); mHost.className = 'sa-dock-mobile'; document.body.appendChild(mHost);
  const md = mod.mountSecureAccessDock(mHost, { fetchJson: async () => ({ requests: [], credentials: [] }), sessionId: 'm1' });
  await md.refresh(); await flush();
  assert.equal(mHost.hidden, true, 'empty mobile dock hidden');
  md.destroy();
}
assert.ok(!/ResizeObserver/.test(core), 'dock fit avoids ResizeObserver loops');
assert.match(read('web-ui/src/features/secure-access/secure-access-desktop-dock.js'), /sa-dock-desktop/, 'desktop dock centered class');

// Canonical mobile Settings: the PWA router hands every settings deep link to
// the desktop Settings modal, so Saved access must resolve to Security there.
{
  const router = read('web-ui/src/mobile/mobile-router.js');
  const settingsPage = read('web-ui/src/pages/SettingsPage.js');
  assert.match(router, /page === 'settings' && !document\.getElementById\('settings-modal'\)/, 'mobile settings hand off to canonical Settings');
  assert.match(settingsPage, /tab === 'saved-access'\) tab = 'security'/, 'saved-access alias maps to Security');
  assert.match(settingsPage, /t === 'security'\) \{[\s\S]{0,120}mountDesktopSavedAccess\(\)/, 'Security tab mounts Saved access');
  assert.match(read('web-ui/index.html'), /id="settings-secure-access-host"/, 'canonical Settings has Saved access host');
}

console.log('secure-access UI tests passed');


// Blocked surfaces must not present apparently tappable password controls.
{
  const h = document.createElement('div'); document.body.append(h);
  const blocked = mod.mountSecureAccessCard(h, {
    request: { id: 'blocked-mobile', mode: 'existing', label: 'Fixture', origin: 'https://example.com', expiresAt: new Date(Date.now()+60000).toISOString() },
    status: { persistentAllowed: true, owner: { canApprove: false } }, fetchJson: fakeFetch({}),
  });
  assert.equal(h.querySelector('input[type="password"]'), null);
  assert.ok(h.textContent.includes('Approvals are off'));
  assert.ok([...h.querySelectorAll('button')].some(b => b.textContent === 'Cancel'));
  blocked.destroy(); h.remove();
}
assert.match(core, /op\.scrollTop/, 'mobile absolute coordinates account for ancestor scroll');
assert.match(core, /querySelector\?\.\('#pm-composer'\)/, 'dock anchors only to real composer');
assert.match(core, /removeEventListener\?\.\('scroll', schedule, true\)/, 'capture scroll listener cleaned up');
console.log('PASS blocked-owner presentation and mobile anchor regressions');
// Paired entry does not enable management/sign-in approval or replacement.
for (const replaces of [undefined, 'cred_existing']) {
  const h = document.createElement('div'); document.body.append(h);
  const card = mod.mountSecureAccessCard(h, {
    request: { id: 'paired-mobile', mode: 'existing', replaces, label: 'Fixture', origin: 'https://example.com', expiresAt: new Date(Date.now()+60000).toISOString() },
    status: { persistentAllowed: true, owner: { canApprove: false }, entry: { canEnter: true } }, fetchJson: fakeFetch({}),
  });
  const input = h.querySelector('input[type="password"]');
  assert.equal(!!input, !replaces);
  if (input) { assert.equal(input.disabled, false); input.value = 'synthetic-only'; }
  card.destroy(); h.remove();
}
console.log('PASS paired fresh entry and blocked replacement');
process.exit(0);
