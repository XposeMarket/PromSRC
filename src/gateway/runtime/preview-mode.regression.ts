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

  // Secondary guard: the startup wiring still references the gates.
  const startupSrc = fs.readFileSync(path.join(__dirname, '../core/startup.ts'), 'utf-8');
  for (const label of ['cron-scheduler', 'auto-settle', 'heartbeat', 'brain', 'telegram', 'runtime-recovery']) {
    assert.ok(startupSrc.includes(`skipInPreview('${label}')`), `startup.ts missing skipInPreview('${label}')`);
  }
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
