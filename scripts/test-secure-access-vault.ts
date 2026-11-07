import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SecretVault } from '../src/security/vault';

// Synthetic canary only. No real credentials or service calls.
const CANARY = 'CANARY_SECURE_ACCESS_VALUE_0001';
const RESERVED = 'secure.access.owner.cred_test.v1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-access-vault-'));

function auditText(): string {
  const parts: string[] = [];
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    if (String(rel).endsWith('vault-audit.log')) parts.push(fs.readFileSync(path.join(dir, String(rel)), 'utf8'));
  }
  return parts.join('\n');
}

try {
  const vault = new SecretVault(dir);
  vault.set(RESERVED, CANARY, 'secure-access');
  assert.equal(vault.get(RESERVED, 'secure-access')?.expose(), CANARY, 'trusted broker must read');

  // Untrusted reads: MCP env resolution, config.resolveSecret, default caller.
  assert.equal(vault.get(RESERVED, 'mcp:S'), null, 'MCP env ref must not resolve reserved key');
  assert.equal(vault.get(RESERVED, 'config:resolve'), null, 'config.resolveSecret must not resolve reserved key');
  assert.equal(vault.get(RESERVED), null, 'default caller must not resolve reserved key');
  assert.equal(vault.has(RESERVED), false, 'reserved key must not report presence');

  // Untrusted writes, deletes and rotations are refused with no value in the error.
  assert.throws(
    () => vault.set(RESERVED, 'ATTACKER_VALUE', 'mcp-upsert'),
    (e: any) => /refused/.test(String(e.message)) && !String(e.message).includes(CANARY) && !String(e.message).includes('ATTACKER_VALUE'),
  );
  assert.throws(() => vault.delete(RESERVED, 'mcp-upsert'), /refused/);
  assert.equal(vault.rotate(RESERVED, 'ATTACKER_VALUE', 'mcp-upsert'), false);

  // Canary survives untouched on disk.
  assert.equal(new SecretVault(dir).get(RESERVED, 'secure-access')?.expose(), CANARY, 'reserved value must be unchanged');

  // Ordinary refs keep working for MCP, config and connection callers.
  vault.set('integrations.github.pat', 'ORDINARY_TOKEN_0001', 'test');
  assert.equal(vault.get('integrations.github.pat', 'mcp:GH')?.expose(), 'ORDINARY_TOKEN_0001');
  vault.set('connection.credentials.fixture.ordinary', '{"api_key":"ORDINARY_KEY_0001"}', 'test');
  assert.ok(vault.get('connection.credentials.fixture.ordinary', 'config:resolve'));
  assert.equal(vault.rotate('integrations.github.pat', 'ORDINARY_TOKEN_0002', 'test'), true);

  const audit = auditText();
  assert.match(audit, /DENY/, 'denials must be audited');
  assert.ok(!audit.includes(CANARY) && !audit.includes('ATTACKER_VALUE'), 'audit must never contain values');
  // Generic clear() (factory reset by any non-broker caller) keeps the reserved namespace.
  vault.clear('settings-reset');
  assert.equal(vault.get(RESERVED, 'secure-access')?.expose(), CANARY, 'non-broker clear keeps protected access');
  assert.equal(vault.get('integrations.github.pat', 'test'), null, 'non-broker clear wipes ordinary entries');
  assert.equal(new SecretVault(dir).get(RESERVED, 'secure-access')?.expose(), CANARY, 'kept across reload');
  vault.clear('secure-access');
  assert.equal(vault.get(RESERVED, 'secure-access'), null, 'broker clear wipes its namespace');
  console.log('PASS secure-access vault: reserved namespace denied to untrusted get/set/delete/rotate/has, broker allowed, ordinary refs unaffected, denials audited without values.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
