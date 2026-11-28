// Real Settings markup/controller; every network request is intercepted, never a real gateway.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('web-ui');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://fixture.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    const file = path.join(root, url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : undefined });
  });
  await page.goto('http://fixture.test/');
  await page.evaluate(async () => {
    document.body.classList.remove('auth-pending');document.querySelector('#prometheus-auth-gate')?.remove(); // fixture starts signed in
    await import('/src/pages/SettingsPage.js');
    document.querySelector('#settings-modal').style.display = 'flex';
    const nav = await import('/src/settings/settings-mobile-nav.js'); nav.initSettingsMobileNav(); nav.showMobileSettingsPage();
    document.querySelectorAll('.settings-page-main > [id^="settings-panel-"]').forEach(el => el.style.display = el.id === 'settings-panel-models' ? 'block' : 'none');
    // The legacy Models controls now live in a hidden store (the Manage sheet borrows
    // them); show it so their own refresh/disconnect behavior is still exercised.
    const store = document.getElementById('settings-models-store'); if (store) store.hidden = false;
    document.querySelector('#prov-fields-openai_codex').style.display = 'block';
    document.querySelector('#codex-connected-state').style.display = 'block';
    document.querySelector('#codex-disconnected-state').style.display = 'none';
  });
  let release, count = 0, block = false;
  await page.route('**/api/usage/limits', async route => {
    count++;
    if (block) await new Promise(r => { release = r; });
    await route.fulfill({ json: { success: true, providers: [{ provider:'openai_codex', label:'Test account' }] } });
  });
  await page.evaluate(() => window.renderModelsUsage());
  const grid = page.locator('#settings-models-usage-grid');
  await grid.evaluate(el => { window.testCard = el.firstElementChild; });
  const height = (await grid.boundingBox()).height;
  block = true;
  const requestStarted = page.waitForRequest('**/api/usage/limits');
  const requests = page.evaluate(() => Promise.all([window.renderModelsUsage(),window.renderModelsUsage()]));
  await requestStarted;
  assert.equal((await grid.boundingBox()).height, height);
  assert.equal(await grid.evaluate(el => el.firstElementChild === window.testCard), true);
  release(); await requests; block = false;
  assert.equal(count, 2); assert.equal(await grid.evaluate(el => el.firstElementChild === window.testCard), true);
  let success = false, posts = [];
  await page.route('**/api/auth/openai/disconnect', async route => {
    posts.push(route.request().postDataJSON()); await route.fulfill({ json: {success} });
  });
  const button = page.locator('#codex-disconnect'); await button.click();
  await page.waitForFunction(() => document.querySelector('#codex-disconnect-status').textContent.includes('Could not confirm'));
  success = true; await button.click();
  await page.locator('#codex-disconnected-state').waitFor({state:'visible'});
  assert.deepEqual(posts, [{accountId:'default'},{accountId:'default'}]);
  assert.equal(await button.isVisible(), false);
  const choices = await page.locator('#settings-panel-system > section:first-child #settings-busy-composer-mode option').evaluateAll(options => options.map(o=>o.value));
  assert.deepEqual(choices,['queue','steer']);
  let savedMode = 'queue'; const saves = [];
  await page.route('**/api/settings/session', route => route.fulfill({json:{session:{busyComposerMode:savedMode,autoSettle:{afterDays:14}}}}));
  await page.route('**/api/settings/bulk', route => {
    const body = route.request().postDataJSON(); saves.push(body); savedMode = body.session.busyComposerMode;
    return route.fulfill({json:{success:true}});
  });
  await page.evaluate(() => { window.settingsTab='system'; window.addProcessEntry=()=>{}; window.updateQuickModeUI=()=>{}; });
  const choice = page.locator('#settings-busy-composer-mode');
  for (const mode of ['steer','queue']) {
    await page.evaluate(() => window.loadAutoSettleSettings());
    await choice.selectOption(mode, {force:true});
    await page.evaluate(() => window.saveSettings());
    assert.equal(saves.at(-1)?.session.busyComposerMode, mode);
    assert.equal(saves.at(-1)?.session.autoSettle.afterDays, 14);
    await choice.evaluate(el=>el.value='');
    await page.evaluate(() => window.loadAutoSettleSettings());
    assert.equal(await choice.inputValue(), mode);
  }
  console.log('PASS: stable cards across concurrent reads; actual disconnect button failure/retry/success; General queue and steer choices');
} finally { await browser.close(); }
