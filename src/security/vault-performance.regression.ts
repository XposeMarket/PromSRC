import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SecretVault } from './vault.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-vault-performance-'));
try {
  const vault = new SecretVault(root);
  vault.set('connector.test', JSON.stringify({ token: 'test-only-secret' }), 'regression:set');

  const startedAt = performance.now();
  for (let index = 0; index < 100; index++) {
    const secret = vault.get('connector.test', 'regression:get');
    assert.equal(secret?.expose(), JSON.stringify({ token: 'test-only-secret' }));
  }
  const repeatedReadMs = performance.now() - startedAt;
  assert.ok(
    repeatedReadMs < 2_000,
    `100 reads of one unchanged vault entry should reuse its derived key (took ${Math.round(repeatedReadMs)}ms)`,
  );

  const auditPath = path.join(root, 'vault', 'vault-audit.log');
  const backupPath = `${auditPath}.1`;
  fs.truncateSync(auditPath, 10 * 1024 * 1024 + 1);
  const rotationProbe = new SecretVault(root);
  const rotatedRead = rotationProbe.get('connector.test', 'regression:rotation');
  assert.equal(rotatedRead?.expose(), JSON.stringify({ token: 'test-only-secret' }));
  assert.ok(fs.existsSync(backupPath), 'oversized vault audit log should rotate to one bounded backup');
  assert.ok(fs.statSync(auditPath).size < 1024, 'active vault audit log should be small after rotation');

  console.log(`vault performance regression passed (${Math.round(repeatedReadMs)}ms for 100 cached reads)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
