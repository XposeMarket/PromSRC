import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../web-ui/', import.meta.url));
const origin = 'http://bot-sidebar.test';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(8000);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const api = {
      '/api/account/status': { authenticated: true, accountRequired: false },
      '/api/onboarding/status': { nextStep: 'done' },
      '/api/agents': { agents: [{ id: 'review', name: 'Review Bot', status: 'idle' }] },
    };
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: api[url.pathname] || {} });
    const file = path.resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (file.startsWith(root) && existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(origin);
  const on = page.getByRole('button', { name: 'Turn on Prom Bot mode' });
  const off = page.getByRole('button', { name: 'Turn off Prom Bot mode' });
  const sidebar = page.locator('#windowSidebarToggle:visible, #sidebarToggle:visible').first();
  const roster = page.locator('#prom-bot-sidebar-section');
  const row = roster.getByText('Review Bot', { exact: true });
  await on.click();
  await row.waitFor();
  await sidebar.click();
  await page.locator('#sidebar.collapsed').waitFor();
  if (process.env.BOT_SHOTS) await page.screenshot({ path: path.join(process.env.BOT_SHOTS, 'collapsed.png'), animations: 'disabled' });
  assert.equal(await roster.isVisible(), false, 'collapsed sidebar must not expose a Bot flyout');
  await off.click();
  await on.click();
  assert.equal(await roster.isVisible(), false, 'enabling Bot mode from the rail must not cover chat');
  await page.reload();
  await off.waitFor();
  await page.locator('#sidebar.collapsed').waitFor();
  await row.waitFor({ state: 'attached' });
  assert.equal(await roster.isVisible(), false, 'restoring collapsed Bot mode must keep the roster hidden');
  await sidebar.click();
  await row.waitFor();
  await page.locator('#sidebar:not(.collapsed)').waitFor();
  await page.getByText('Review Bot', { exact: true }).click({ trial: true });
  const bounds = await page.locator('#sidebar').boundingBox();
  const item = await row.boundingBox();
  assert.ok(item.x >= bounds.x && item.x + item.width <= bounds.x + bounds.width + 1, 'reopened roster belongs inside sidebar');
  console.log('Bot roster stays inside desktop sidebar across collapse, toggle, reload and reopen.');
} finally { await browser.close(); }
