// Static + pure-helper checks for PR821 protected plugin UI. No network, no real credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SA = 'web-ui/src/features/secure-access/';
const card = read(`${SA}protected-plugin-card.js`);
const entry = read(`${SA}protected-plugin-entry.js`);
const saved = read(`${SA}protected-plugin-settings.js`);
const dock = read(`${SA}secure-access-desktop-dock.js`);
const savedAccess = read(`${SA}secure-access-settings.js`);
const mobile = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
const chat = read('web-ui/src/pages/ChatPage.js');
const conns = read('web-ui/src/pages/ConnectionsPage.js');
const settings = read('web-ui/src/pages/SettingsPage.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

// Fake-but-format-valid fixtures, built at runtime so no literal key lives in the repo.
const FAKE = 'sk-' + 'proj-' + 'A'.repeat(24);

t('no browser storage of secrets in protected UI', () => {
  for (const src of [card, entry, saved]) assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
});
t('card fails closed on owner/storage before creating inputs', () => {
  const gate = card.indexOf('OWNER_SURFACE_REQUIRED\'); return handle;');
  assert.ok(gate > 0 && gate < card.indexOf("el('input'"));
  assert.match(card, /PROTECTED_STORAGE_REQUIRED'\); return handle;/);
});
t('X card: owner-consent postJson, no callback/scopes/bearer fields', () => {
  assert.match(card, /postJson\(fetchJson, '\/api\/auth\/x-api\/credentials'/);
  assert.match(card, /'\/api\/auth\/x-api\/start'/);
  assert.doesNotMatch(card, /redirectUri|scopes|bearer/i);
});
t('values cleared on error paths and close (pagehide, visibility, expiry)', () => {
  assert.match(card, /finally \{ body\.clientId = ''; body\.clientSecret = ''; \}/);
  assert.match(card, /finally \{ for \(const key of Object\.keys\(body\.values\)\) body\.values\[key\] = ''; \}/);
  assert.match(card, /addEventListener\('pagehide', close\)/);
  assert.match(card, /REQUEST_EXPIRED/);
});
t('saved generic key never claims Connected', () => {
  assert.match(card, /Stored, not verified/);
});
t('Saved access mounts plugin keys and generic lifecycle route', () => {
  assert.match(savedAccess, /mountProtectedPluginSaved/);
  assert.match(saved, /\/api\/protected-plugins\/connection\/\$\{encodeURIComponent\(id\)\}\/\$\{action\}/);
  assert.match(saved, /confirmFn\(/);
});
t('composer guard: capture phase, no send-anyway, value not in events', () => {
  assert.match(entry, /addEventListener\('paste', onPaste, true\)/);
  assert.match(entry, /addEventListener\('input', onInput, true\)/);
  assert.doesNotMatch(entry, /send anyway|allowSecretLike|CustomEvent\(/i);
  assert.match(dock, /installComposerSecretGuard\(input/);
  assert.match(mobile, /installComposerSecretGuard\(protectedInput/);
});
t('legacy inline secret fields removed from chat/connections/settings', () => {
  assert.doesNotMatch(chat, /connection-secure-fields"[^`]*input type="password"/);
  assert.doesNotMatch(chat, /\/api\/connection-secure-input\//);
  assert.doesNotMatch(conns, /data-attempt-key/);
  assert.doesNotMatch(conns, /api\(ENDPOINTS\.CONNECTIONS_CREDENTIALS/);
  assert.match(conns, /postJson\(protectedFetch, ENDPOINTS\.CONNECTIONS_CREDENTIALS/);
  assert.doesNotMatch(settings, /id="x-api-client-(id|secret)"|id="x-api-(redirect-uri|scopes)"/);
  assert.doesNotMatch(chat, /secure-access/); // ChatPage ratchet: reaches card via window.promProtectedPlugin
});

// Pure helpers (DOM-free exports).
const g = globalThis;
g.window = g.window || g; g.document = g.document || { addEventListener() {}, querySelector() { return null; } };
const { protectedErrorText, safeXAuthUrl, protectedRequestFromAction } = await import(`../${SA}protected-plugin-card.js`);
const { xCredentialLabel, connectionLabel, lifecyclePath } = await import(`../${SA}protected-plugin-settings.js`);
const { scrubComposerValue } = await import(`../${SA}protected-plugin-entry.js`);

t('errors never echo values', () => {
  const msg = protectedErrorText(new Error(`HTTP 400: bad key ${FAKE}`));
  assert.ok(!msg.includes(FAKE) && !msg.includes('HTTP'));
  assert.match(protectedErrorText(new Error('OWNER_SURFACE_REQUIRED')), /desktop app/);
});
t('X auth URL allowlist', () => {
  assert.equal(safeXAuthUrl('https://x.com/i/oauth2/authorize?a=1'), 'https://x.com/i/oauth2/authorize?a=1');
  assert.ok(safeXAuthUrl('https://twitter.com/i/oauth2/authorize'));
  for (const bad of ['http://x.com/a', 'https://x.com.evil.test/a', 'https://evil.test/?x.com', 'javascript:alert(1)', 'https://u:p@x.com/']) assert.equal(safeXAuthUrl(bad), '');
});
t('request mapping is metadata only', () => {
  const m = protectedRequestFromAction('vercel', 'att1', { type: 'secure-input', credentialSessionId: 's1', fields: [{ key: 'apiKey', label: 'Key', value: 'leak' }], expiresAt: 'z' });
  assert.deepEqual(m, { serviceId: 'vercel', request: { id: 's1', attemptId: 'att1', fields: [{ key: 'apiKey', label: 'Key', secret: true, required: true }], expiresAt: 'z' } });
  assert.equal(protectedRequestFromAction('x', 'a', { type: 'oauth' }), null);
});
t('labels: no false Connected', () => {
  assert.equal(xCredentialLabel({ configured: true }), 'App stored · not connected');
  assert.equal(xCredentialLabel({ configured: true, connected: true, stopped: true }), 'Stopped · re-enter to reconnect');
  assert.equal(connectionLabel({ configured: true, authenticated: true }), 'Stored · not verified');
  assert.equal(connectionLabel({ authState: 'verified' }), 'Verified');
  assert.equal(lifecyclePath('x', 'x', 'delete'), '/api/protected-plugins/x/delete');
  assert.throws(() => lifecyclePath('connection', 'a', 'export'));
});
t('composer scrub', () => {
  assert.equal(scrubComposerValue('hello world'), null);
  const out = scrubComposerValue(`use ${FAKE} please`);
  assert.ok(out && !out.includes(FAKE) && out.startsWith('use '));
});
console.log(`test-protected-plugin-ui: ${n} passed`);
