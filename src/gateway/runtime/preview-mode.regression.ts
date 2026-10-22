/**
 * Regression: PROMETHEUS_PREVIEW_MODE=1 gateways must refuse OAuth refresh
 * (shared refresh tokens belong to the live gateway) and report skips, while
 * the unset path stays identical. Asserts both polarities on behavior.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as pm from './preview-mode';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-preview-mode-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;

const ON = { PROMETHEUS_PREVIEW_MODE: '1' };

async function main(): Promise<void> {
  // isPreviewMode: flag parsing
  assert.equal(pm.isPreviewMode({}), false);
  assert.equal(pm.isPreviewMode({ PROMETHEUS_PREVIEW_MODE: '0' }), false);
  assert.equal(pm.isPreviewMode({ PROMETHEUS_PREVIEW_MODE: '' }), false);
  for (const v of ['1', 'true', ' YES ', 'True']) {
    assert.equal(pm.isPreviewMode({ PROMETHEUS_PREVIEW_MODE: v }), true, `value ${JSON.stringify(v)} should enable preview`);
  }

  // skipInPreview: false without flag, true with flag
  assert.equal(pm.skipInPreview('regression-label', {}), false);
  assert.equal(pm.skipInPreview('regression-label', ON), true);

  // assertTokenRefreshAllowed: silent without flag, typed error with flag
  assert.doesNotThrow(() => pm.assertTokenRefreshAllowed('regression', {}));
  assert.throws(
    () => pm.assertTokenRefreshAllowed('regression', ON),
    (err: any) => err instanceof pm.PreviewRefreshBlockedError && err.name === 'PreviewRefreshBlockedError'
      && /regression token refresh is disabled/.test(err.message),
  );

  // Integration: a real refresh entry point, flag on then off.
  process.env.PROMETHEUS_PREVIEW_MODE = '1';
  const openai = await import('../../auth/openai-oauth');
  await assert.rejects(
    openai.refreshTokens(root),
    (err: any) => err instanceof pm.PreviewRefreshBlockedError,
  );

  delete process.env.PROMETHEUS_PREVIEW_MODE;
  await assert.rejects(
    openai.refreshTokens(root),
    (err: any) => !(err instanceof pm.PreviewRefreshBlockedError) && /No refresh token/.test(String(err?.message)),
  );

  // Vault stdin handoff: only Electron-managed or explicit opt-in reads the key;
  // anything else (the default) stays a no-op and uses the key file.
  const vb = await import('../../security/vault-key-bootstrap');
  assert.equal(vb.isStdinVaultKeyMode({}), false, 'default must not read stdin');
  assert.equal(vb.isStdinVaultKeyMode({ PROMETHEUS_VAULT_KEY_STDIN: '0' }), false);
  assert.equal(vb.isStdinVaultKeyMode({ PROMETHEUS_VAULT_KEY_STDIN: '1' }), true);
  assert.equal(vb.isStdinVaultKeyMode({ PROMETHEUS_ELECTRON_MANAGED: '1' }), true);
  // This process was started without either flag, so no key was injected.
  assert.equal(vb.getInjectedMasterKey(), null, 'bootstrap must be a no-op without the flags');

  // Supabase account refresh is refused in preview (returns null, never POSTs).
  process.env.PROMETHEUS_PREVIEW_MODE = '1';
  assert.throws(() => pm.assertTokenRefreshAllowed('supabase-account'), pm.PreviewRefreshBlockedError);
  delete process.env.PROMETHEUS_PREVIEW_MODE;

  // Secondary guard: every gate label is still wired (source check, not the primary test).
  const startupSrc = fs.readFileSync(path.join(__dirname, '../core/startup.ts'), 'utf-8');
  for (const label of ['runtime-recovery', 'mcp-servers', 'cron-scheduler', 'auto-settle', 'heartbeat', 'brain', 'telegram', 'audit-materializer', 'user-chrome-relay', 'tailscale-funnel']) {
    assert.ok(startupSrc.includes(`skipInPreview('${label}')`), `startup.ts missing skipInPreview('${label}')`);
  }
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server-v2.ts'), 'utf-8');
  for (const label of ['subagent-heartbeats', 'detached-turn-resume', 'main-chat-recovery', 'main-chat-timers', 'internal-watch', 'thread-supervision', 'telegram-persona-bots']) {
    assert.ok(serverSrc.includes(`skipInPreview('${label}')`), `server-v2.ts missing skipInPreview('${label}')`);
  }
  const accountSrc = fs.readFileSync(path.join(__dirname, '../routes/account.router.ts'), 'utf-8');
  assert.ok(accountSrc.includes(`assertTokenRefreshAllowed('supabase-account')`), 'account refresh guard missing');
}

main()
  .then(() => {
    console.log('preview-mode regression: PASS');
  })
  .catch((err) => {
    console.error('preview-mode regression: FAIL', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  });
