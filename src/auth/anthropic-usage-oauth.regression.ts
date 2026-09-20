import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getVault } from '../security/vault';
import { getValidUsageToken, usageTrackingState } from './anthropic-usage-oauth';

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'prom-claude-usage-'));
  const originalFetch = globalThis.fetch;
  const vault = getVault(dir);
  const saveExpired = (refreshToken: string) => vault.set('anthropic.usage_oauth_tokens', JSON.stringify({
    access_token: 'old-access', refresh_token: refreshToken,
    expires_at: Date.now() - 1000, stored_at: Date.now() - 3600000,
  }), 'regression');
  try {
    saveExpired('expired-refresh');
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await Promise.resolve();
      return Response.json({ error: 'invalid_grant', error_description: 'Refresh token expired' }, { status: 400 });
    };
    assert.deepEqual(await Promise.all([getValidUsageToken(dir), getValidUsageToken(dir)]), [null, null]);
    assert.equal(calls, 1, 'concurrent usage requests must share one refresh');
    assert.deepEqual(usageTrackingState(dir), { configured: true, reauthRequired: true });
    assert.equal(await getValidUsageToken(dir), null);
    assert.equal(calls, 1, 'an invalid grant must not be retried indefinitely');

    saveExpired('fresh-refresh');
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await Promise.resolve();
      return Response.json({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
    };
    assert.deepEqual(await Promise.all([getValidUsageToken(dir), getValidUsageToken(dir)]), ['new-access', 'new-access']);
    assert.equal(calls, 1);
    assert.deepEqual(usageTrackingState(dir), { configured: true, reauthRequired: false });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('Claude usage OAuth refresh regression passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
