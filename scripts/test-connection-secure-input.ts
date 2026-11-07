import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SecureInputService } from '../src/connections/secure-input-service';
import { SecretVault } from '../src/security/vault';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connection-ownership-'));
try {
  const service = new SecureInputService(dir);
  const vault = new SecretVault(dir);
  const session = service.create({ serviceId: 'fixture', attemptId: 'attempt-1', fields: [{ key: 'api_key', label: 'Key', secret: true, required: true }] });
  const result = service.submit(session.id, { api_key: '  CANARY_KEY  ' });
  assert(service.ownsReference(result.credentialRef, 'fixture', 'attempt-1'));
  assert(!service.ownsReference(result.credentialRef, 'different', 'attempt-1'));
  assert(!service.ownsReference('vault:openai.oauth_tokens', 'fixture', 'attempt-1'));
  assert.throws(() => service.clearReference('vault:openai.oauth_tokens', 'fixture', 'attempt-1'));
  assert.throws(() => service.clearReference(result.credentialRef, 'fixture', 'wrong-attempt'));
  const read = new SecretVault(dir).get(result.credentialRef.replace('vault:', ''))?.expose(); assert.equal(JSON.parse(read!).api_key, '  CANARY_KEY  ');

  // Pre-existing connection ref (no ownership index entry): refused by default,
  // cleared only via the trusted persisted connection.credentialRef flag.
  const legacyKey = 'connection.credentials.fixture.legacy';
  vault.set(legacyKey, '{"api_key":"LEGACY_CANARY"}', 'test');
  assert.throws(() => service.clearReference(`vault:${legacyKey}`, 'fixture', 'attempt-1'));
  assert.ok(vault.has(legacyKey), 'untrusted clear must leave legacy value');
  service.clearReference(`vault:${legacyKey}`, 'fixture', 'attempt-1', { persistedLegacy: true });
  assert.equal(vault.has(legacyKey), false, 'persisted legacy ref must disconnect cleanly');

  // Newer re-attempt mismatch: attempt-2 does not own the reference and cannot clear it.
  assert.throws(() => service.clearReference(result.credentialRef, 'fixture', 'attempt-2'));
  assert.ok(vault.has(result.credentialRef.replace('vault:', '')), 'owned value must survive mismatched attempt');

  // Forged refs: not owned and not persisted => refused, value untouched.
  const forgedKey = 'connection.credentials.fixture.forged';
  vault.set(forgedKey, '{"api_key":"FORGED_CANARY"}', 'test');
  assert.throws(() => service.clearReference(`vault:${forgedKey}`, 'fixture', 'attempt-1'));
  assert.throws(() => service.clearReference('vault:secure.access.owner.cred_x.v1', 'fixture', 'attempt-1', { persistedLegacy: true }));
  assert.ok(vault.has(forgedKey), 'forged ref must not delete anything');

  const restarted = new SecureInputService(dir);
  assert(restarted.ownsReference(result.credentialRef, 'fixture', 'attempt-1'));
  restarted.clearReference(result.credentialRef, 'fixture', 'attempt-1');
  assert(!restarted.ownsReference(result.credentialRef, 'fixture', 'attempt-1'));

  // Corrupt ownership file: constructor must not throw and owns nothing (fail closed).
  const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connection-ownership-corrupt-'));
  try {
    fs.writeFileSync(path.join(corruptDir, 'connection-credential-owners.json'), '{not json');
    const corrupt = new SecureInputService(corruptDir);
    assert.equal(corrupt.ownsReference('vault:connection.credentials.fixture.any', 'fixture', 'attempt-1'), false);
  } finally {
    fs.rmSync(corruptDir, { recursive: true, force: true });
  }
  console.log('PASS connector secure input: exact preservation, scoped ref/delete, persisted ownership, legacy persisted disconnect, mismatch and forged refs refused, corrupt ownership fails closed.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
