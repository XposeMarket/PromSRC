import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { containsRecognizableSecret, payloadContainsRecognizableSecret } from '../src/security/secret-format-guard';
import { SecureInputService } from '../src/connections/secure-input-service';
import { bindPluginCredential, resolveBoundPluginCredential, deleteBoundPluginCredential } from '../src/connections/plugin-credential-binding';
import { pluginCredentialState, setPluginCredentialState, assertPluginCredentialUse } from '../src/security/plugin-credential-state';
import { ApiKeyConnectionAdapter } from '../src/connections/adapters/api-key';
import { getVault } from '../src/security/vault';
import { saveXApiCredentials, clearXApiTokens, refreshXApiTokens, getValidXApiToken } from '../src/auth/x-api-oauth';

async function main() {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-plugin-test-'));
 try {
  const fixtures = ['sk-proj-' + 'a'.repeat(24), 'ghp_' + 'b'.repeat(36), 'xoxb-' + '1'.repeat(20), 'xai-' + 'c'.repeat(35)];
  for (const value of fixtures) { assert(containsRecognizableSecret(value)); assert(payloadContainsRecognizableSecret({ history: [{ content: value }] })); }
  for (const value of ['API_KEY', 'sk-placeholder', 'a'.repeat(100), 'example@email.test', 'abc123def4567890123456789']) assert(!containsRecognizableSecret(value));
  const service = new SecureInputService(directory, 600000, () => true);
  const fields = [{ key: 'apiKey', label: 'API key', required: true, secret: true }];
  const request = service.create({ serviceId: 'fixture', attemptId: 'first', fields });
  assert.throws(() => service.submit(request.id, { apiKey: 'fake', extra: 'bad' }));
  const result = service.submit(request.id, { apiKey: '  SYNTHETIC_CANARY_1  ' });
  assert.throws(() => service.submit(request.id, { apiKey: 'replay' }));
  assert.throws(() => bindPluginCredential(directory, 'other', result.credentialRef, 'first'));
  bindPluginCredential(directory, 'fixture', result.credentialRef, 'first');
  assert.equal(resolveBoundPluginCredential(directory, 'fixture', 'apiKey').value, '  SYNTHETIC_CANARY_1  ');
  const generation = assertPluginCredentialUse(directory, 'fixture');
  setPluginCredentialState(directory, 'fixture', true, 'stop');
  assert.deepEqual(resolveBoundPluginCredential(directory, 'fixture', 'apiKey'), { handled: true });
  assert.throws(() => assertPluginCredentialUse(directory, 'fixture', generation));
  const second = service.create({ serviceId: 'fixture', attemptId: 'second', fields });
  const replacement = service.submit(second.id, { apiKey: 'SYNTHETIC_CANARY_2' });
  bindPluginCredential(directory, 'fixture', replacement.credentialRef, 'second');
  assert(!getVault(directory).has(result.credentialRef.replace('vault:', '')));
  assert.equal(resolveBoundPluginCredential(directory, 'fixture', 'apiKey').value, 'SYNTHETIC_CANARY_2');
  deleteBoundPluginCredential(directory, 'fixture');
  assert.deepEqual(resolveBoundPluginCredential(directory, 'fixture', 'apiKey'), { handled: true });
  assert(pluginCredentialState(directory, 'fixture').stopped);
  const unavailable = new SecureInputService(directory, 600000, () => false);
  const denied = unavailable.create({ serviceId: 'blocked', attemptId: 'blocked', fields });
  assert.throws(() => unavailable.submit(denied.id, { apiKey: 'fake' }), /PROTECTED_STORAGE_REQUIRED/);
  const expired = new SecureInputService(directory, -1, () => true);
  const gone = expired.create({ serviceId: 'expired', attemptId: 'expired', fields });
  assert.throws(() => expired.submit(gone.id, { apiKey: 'fake' }));
  const adapter = new ApiKeyConnectionAdapter({ createCredentialSession: async () => ({ id: 'dummy' }) });
  const connected = await adapter.connect({ credentialRef: 'vault:fake', attempt: { plan: { strategy: { adapter: 'api-key' } } } } as any);
  assert.equal(connected.connection?.authenticated, false);
  const verification = await adapter.verify({} as any, { id: 'dummy', credentialRef: 'vault:fake' } as any);
  assert.equal(verification[0].passed, false);
  saveXApiCredentials(directory, { clientId: 'synthetic-oauth-client-id-not-consumer', clientSecret: 'SYNTHETIC_X_SECRET' });
  clearXApiTokens(directory);
  await assert.rejects(getValidXApiToken(directory), /CREDENTIAL_USE_STOPPED/);
  await assert.rejects(refreshXApiTokens(directory), /CREDENTIAL_USE_STOPPED/);
  fs.writeFileSync(path.join(directory, 'plugin-credential-state.json'), '{broken');
  assert(pluginCredentialState(directory, 'fixture').stopped);
  assert.deepEqual(resolveBoundPluginCredential(directory, 'fixture', 'apiKey'), { handled: true });
  console.log('PASS protected plugin: detector positives/negatives, schema, replay/expiry, storage failure, scoped real consumer, replace/stop/delete/restart state, no false verification, X stopped refresh/fallback.');
 } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error('FAIL protected plugin regression', error?.name, String(error?.stack || '').split('\n').filter((line: string) => /^\s+at /.test(line)).slice(0,3).join('\n')); process.exitCode = 1; });
