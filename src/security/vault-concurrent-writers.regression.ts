// Two SecretVault instances on one config dir model two gateway processes.
// A write from one must never revert a newer entry written by the other
// (this silently cleared Gmail's "reconnect required" flag, so the Plugins
// page kept showing a dead login as Connected).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecretVault } from './vault.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-vault-writers-'));
try {
  const a = new SecretVault(root);
  a.set('integration.gmail.oauth_tokens', JSON.stringify({ state: 'old' }), 'regression:a');
  assert.equal(a.get('integration.gmail.oauth_tokens', 'regression:a')?.expose(), JSON.stringify({ state: 'old' }));

  // Process B flags the connector while A still holds its stale snapshot.
  const b = new SecretVault(root);
  b.set('integration.gmail.oauth_tokens', JSON.stringify({ state: 'reauth_required' }), 'regression:b');

  // Process A writes an unrelated key (e.g. an OpenAI token migration).
  a.set('openai.oauth_tokens.default', JSON.stringify({ token: 'x' }), 'regression:a');

  const fresh = new SecretVault(root);
  assert.equal(
    fresh.get('integration.gmail.oauth_tokens', 'regression:fresh')?.expose(),
    JSON.stringify({ state: 'reauth_required' }),
    'an unrelated write from a stale process must not revert a newer entry',
  );
  assert.equal(fresh.get('openai.oauth_tokens.default', 'regression:fresh')?.expose(), JSON.stringify({ token: 'x' }));

  // Deletes from a stale process also keep other processes' newer entries.
  b.set('connector.other', 'v2', 'regression:b');
  a.delete('openai.oauth_tokens.default', 'regression:a');
  assert.equal(fresh.get('connector.other', 'regression:fresh')?.expose(), 'v2');
  assert.equal(fresh.get('openai.oauth_tokens.default', 'regression:fresh'), null);
  console.log('vault concurrent writers regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
