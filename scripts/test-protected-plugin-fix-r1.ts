// PR821 fix round 1 regressions (H1, M1, M2, L1, L2 evidence, steer: mobile host). Synthetic canaries only.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SecretVault } from '../src/security/vault';
import { SecureInputService } from '../src/connections/secure-input-service';
import { bindPluginCredential, resolveBoundPluginCredential } from '../src/connections/plugin-credential-binding';
import { setPluginCredentialState } from '../src/security/plugin-credential-state';

const CANARY = 'R1_SYNTHETIC_CANARY_KEY';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-fix-r1-'));
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-fix-r1-empty-'));
const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

try {
  const service = new SecureInputService(dir, 600_000, () => true);
  const vault = new SecretVault(dir);
  const session = service.create({ serviceId: 'fixture', attemptId: 'attempt-1', fields: [{ key: 'api_key', label: 'Key', secret: true, required: true }] });
  const { credentialRef } = service.submit(session.id, { api_key: CANARY });
  const rawKey = credentialRef.replace(/^vault:/, '');

  // H1: generic readers (config.resolveSecret uses 'config:resolve', MCP/model tools) get nothing for protected refs.
  for (const caller of ['config:resolve', 'mcp:env', 'model-tool', 'unknown']) {
    assert.equal(vault.get(rawKey, caller), null, `generic caller ${caller} must not read protected ref`);
  }
  // Only explicit consumers read it.
  assert.equal(JSON.parse(vault.get(rawKey, 'protected-plugin:consumer')!.expose()).api_key, CANARY);

  // H1 bounded openai-compatible consumer: ownership + explicit purpose, nothing else.
  assert.equal(JSON.parse(service.readForConsumer(credentialRef, 'fixture', 'attempt-1')!).api_key, CANARY);
  assert.equal(service.readForConsumer(credentialRef, 'fixture', 'attempt-2'), undefined, 'other attempt cannot consume');
  assert.equal(service.readForConsumer(credentialRef, 'other', 'attempt-1'), undefined, 'other service cannot consume');
  assert.equal(service.readForConsumer('vault:connection.credentials.fixture.forged', 'fixture', 'attempt-1'), undefined, 'unowned ref cannot consume');

  // Bind succeeds and resolves for the owning plugin only.
  bindPluginCredential(dir, 'fixture', credentialRef, 'attempt-1');
  assert.equal(resolveBoundPluginCredential(dir, 'fixture', 'api_key').value, CANARY);

  // M2: bind failure leaves an orphan only if not cleaned; the route clears the just-written ref.
  const second = service.submit(service.create({ serviceId: 'fixture', attemptId: 'attempt-1', fields: [{ key: 'api_key', label: 'Key', secret: true, required: true }] }).id, { api_key: 'R1_SECOND' });
  assert.throws(() => bindPluginCredential(dir, 'fixture', second.credentialRef, 'attempt-2'), /CREDENTIAL_BINDING_MISMATCH/);
  assert.equal(vault.has(second.credentialRef.replace(/^vault:/, '')), true, 'value exists before cleanup');
  service.clearReference(second.credentialRef, 'fixture', 'attempt-1');
  assert.equal(vault.has(second.credentialRef.replace(/^vault:/, '')), false, 'bind-failure cleanup removes orphan');
  assert.equal(resolveBoundPluginCredential(dir, 'fixture', 'api_key').value, CANARY, 'committed binding unaffected');

  // L1: generation > 0 with missing binding file fails closed (no legacy/env fallback).
  setPluginCredentialState(dir, 'stale-service', false, 'stored-not-verified');
  fs.rmSync(path.join(dir, 'plugin-credential-bindings.json'), { force: true });
  const stale = resolveBoundPluginCredential(dir, 'stale-service', 'api_key');
  assert.equal(stale.handled, true); assert.equal(stale.value, undefined);
  // Fresh install (generation 0, no binding) stays unhandled so generic models keep working.
  assert.deepEqual(resolveBoundPluginCredential(emptyDir, 'fresh-service', 'api_key'), { handled: false });

  // The stale-binding case above removed the binding file; re-establish the legitimate fixture binding first.
  bindPluginCredential(dir, 'fixture', credentialRef, 'attempt-1');
  assert.equal(resolveBoundPluginCredential(dir, 'fixture', 'api_key').value, CANARY, 'legitimate fixture binding resolves before stop');
  // Stopped access: a stopped plugin credential resolves to handled with no value (fail closed, no fallback).
  setPluginCredentialState(dir, 'fixture', true, 'stop');
  const stopped = resolveBoundPluginCredential(dir, 'fixture', 'api_key');
  assert.equal(stopped.handled, true); assert.equal(stopped.value, undefined, 'stopped plugin key must not resolve');
  setPluginCredentialState(dir, 'fixture', false, 'restart');
  assert.equal(resolveBoundPluginCredential(dir, 'fixture', 'api_key').value, CANARY, 'restart restores the legitimate consumer');

  // No blanket deny: ordinary model/provider credentials still resolve through generic readers.
  vault.set('openai.api_key', 'R1_SYNTHETIC_MODEL_KEY', 'test');
  assert.equal(vault.get('openai.api_key', 'config:resolve')?.expose(), 'R1_SYNTHETIC_MODEL_KEY', 'model credentials are not denied');

  // Route-level contracts (static): bindable responses carry no ref, pending status is honest, redaction and owner gates present.
  const router = read('src/gateway/routes/connections-v2.router.ts');
  assert.match(router, /function redactProtectedRef/);
  assert.equal((router.match(/\.map\(redactProtectedRef\)/g) || []).length, 2, 'attempt and connection GETs redact protected refs');
  assert.match(router, /STORED_CONNECTION_PENDING/);
  assert.match(router, /clearReference\(result\.credentialRef/);
  assert.doesNotMatch(router, /status: 'STORED'[^;]*credentialRef/, 'bindable success must not return a ref');
  assert.match(router, /\/disconnect', \(req, res, next\) => requireProtectedOwner/, 'connections-v2 disconnect is owner-gated');
  const plugins = read('src/gateway/routes/protected-plugins.router.ts');
  assert.equal((plugins.match(/if \(req\.params\.action === 'stop'\)/g) || []).length, 2, 'only stop bypasses owner gate');

  // UI: shared card never continues with a returned bindable ref; mobile entry is outside the polled dock.
  const card = read('web-ui/src/features/secure-access/protected-plugin-card.js');
  assert.match(card, /if \(result\?\.credentialRef\) await postJson/);
  const mobile = read('web-ui/src/mobile/mobile-chat-page-runtime.js');
  assert.doesNotMatch(mobile, /secureAccessHost\.prepend\(createAddSecretButton/);
  assert.match(mobile, /sa-add-secret-host-mobile/);
  assert.match(mobile, /cardHost: addSecretHost/);

  // M1: native + web consent allowlists cover every destructive disconnect alias.
  const nativeConsent = read('electron/owner-consent.js');
  assert.match(nativeConsent, /protected-plugins\\\/x\\\/disconnect/);
  assert.match(nativeConsent, /protected-plugins\\\/connection\\\/\[\^\/\]\+\\\/disconnect/);
  assert.match(nativeConsent, /connections-v2\\\/\[\^\/\]\+\\\/disconnect/);
  const consentCore = read('web-ui/src/features/secure-access/secure-access-core.js');
  assert.match(consentCore, /connections-v2\\\/\[\^\/\]\+\\\/disconnect/);
  assert.match(consentCore, /protected-plugins\\\/\(\?:x\|connection\\\/\[\^\/\]\+\)\\\/disconnect/);

  // Steer: native raw-body parser covers connections-v2 so the consent body hash matches; desktop and mobile disconnects are consent-aware.
  const appTs = read('src/gateway/core/app.ts');
  assert(appTs.includes("'/api/protected-plugins', '/api/connections-v2', '/api/connections/disconnect', '/api/auth/x-api/disconnect'], express.json({ limit: '32kb', verify: keepRawBody })"), 'connections-v2 body is hashed from raw bytes');
  const connPage = read('web-ui/src/pages/ConnectionsPage.js');
  assert(connPage.includes('await postJson(api, `/api/connections-v2/${encodeURIComponent(connectionId)}/disconnect`'), 'desktop canonical disconnect uses consent-aware postJson');
  const mobPlugins = read('web-ui/src/mobile/mobile-plugins-page.js');
  assert(mobPlugins.includes('postJsonConsent((p, o = {}) => mobileGatewayFetch'), 'mobile canonical disconnect uses consent-aware postJson');
  assert(mobPlugins.includes("if (/OWNER_CONSENT_/.test(String(e?.message || e))) throw e;"), 'consent declines are not swallowed');

  console.log('PASS protected plugin fix R1: generic vault/config reads denied, bounded consumer, bind-failure orphan cleanup, fail-closed generation, redacted refs, owner-gated disconnect, no UI ref continue, mobile sibling entry host.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
}
