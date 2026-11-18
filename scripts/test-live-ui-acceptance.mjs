import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Read-only acceptance smoke against a running gateway. No chat submissions,
// approvals, account mutations or notification delivery.
const base = (process.env.PROM_UI_BASE || 'http://127.0.0.1:32466').replace(/\/$/, '');
const out = path.resolve(process.env.PROM_UI_OUT || 'artifacts/ui-acceptance');
fs.mkdirSync(out, { recursive: true });
const report = { at: new Date().toISOString(), runnerCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), base, scope: 'Read-only desktop and mobile browser smoke; not physical-phone, accessibility certification, or full interaction coverage.', cases: [] };
const health = await fetch(`${base}/api/health`).then(r => r.json());
assert.equal(health.ok, true);
report.gateway = { pid: health.pid, processStartedAt: health.processStartedAt };
let browser;
try { browser = await chromium.launch({ headless: true, ...(process.env.PROM_UI_CHANNEL ? { channel: process.env.PROM_UI_CHANNEL } : {}) }); }
catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
try {
  for (const spec of [
    { name: 'desktop', url: '/?desktop=1', width: 1280, height: 800, mobile: false },
    { name: 'mobile-390', url: '/mobile/', width: 390, height: 844, mobile: true },
    { name: 'mobile-320', url: '/mobile/', width: 320, height: 740, mobile: true },
  ].filter(spec => !process.env.PROM_UI_CASE || spec.name === process.env.PROM_UI_CASE)) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, isMobile: spec.mobile, hasTouch: spec.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto(`${base}${spec.url}`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    if (spec.mobile) {
      await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
      const back = page.getByRole('button', { name: 'Back to chat', exact: true });
      const backBox = await back.boundingBox();
      if (backBox && backBox.x >= 0 && backBox.x + backBox.width <= spec.width) await back.click();
      await page.getByRole('button', { name: 'Open keyboard composer', exact: true }).waitFor({ state: 'visible' });
    } else {
      await page.getByRole('textbox', { name: 'Send Prometheus a message', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    }
    // A newly installed service worker can reload the initial document once.
    await page.waitForFunction(() => document.body && document.readyState === 'complete');
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => document.body && document.readyState === 'complete');
    await page.screenshot({ path: path.join(out, `${spec.name}-chat.png`) });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert(layout.document <= layout.viewport + 2, `${spec.name}: document overflow ${JSON.stringify(layout)}`);
    const navigation = [];
    if (spec.mobile) {
      for (const name of ['Tasks', 'Hub', 'Chat']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await page.getByRole('tab', { name, exact: true }).waitFor({ state: 'visible' });
        navigation.push(name);
        await page.screenshot({ path: path.join(out, `${spec.name}-${name.toLowerCase()}.png`) });
      }
    }
    // Reload checks persistent shell/bootstrap rather than assuming a single load.
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (spec.mobile) await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    else await page.getByRole('textbox', { name: 'Send Prometheus a message', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    assert.deepEqual(errors, [], `${spec.name}: uncaught page errors`);
    report.cases.push({ name: spec.name, status: 'pass', layout, navigation, uncaughtPageErrors: errors, reload: 'pass' });
    await context.close();
  }
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'receipt.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
