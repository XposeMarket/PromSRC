import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-dev-edit-ledger-'));
process.env.PROMETHEUS_DATA_DIR = testRoot;

async function main() {
  const ledger = await import('./dev-edit-ledger');
  const target = path.join(testRoot, 'src', 'example.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'alpha\nbeta\ngamma\n', 'utf8');

  const created = ledger.createDevEditLedger({
    id: 'dev_edit_regression', sessionId: 'test', planHash: 'plan', allowedFiles: ['src/example.ts'],
  });
  assert.match(created.displayId, /^DEV-\d{8}-\d{5}$/);
  const prepared = ledger.prepareDevEditMutation({
    devEditId: created.id, toolName: 'find_replace_source', file: 'src/example.ts', absPath: target,
  });
  fs.writeFileSync(target, 'alpha\nBETA\ngamma\n', 'utf8');
  const mutation = ledger.finalizeDevEditMutation(prepared);
  assert.equal(mutation?.status, 'applied');
  assert.equal(mutation?.operation, 'update');
  assert.ok(mutation?.beforeSha256 && mutation?.afterSha256 && mutation.beforeSha256 !== mutation.afterSha256);
  const patch = ledger.getDevEditLedgerPatch(created.displayId, 1) || '';
  assert.match(patch, /-beta/);
  assert.match(patch, /\+BETA/);
  assert.equal(ledger.getDevEditLedger(created.displayId)?.mutations.length, 1);
  console.log('dev-edit ledger regression: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
