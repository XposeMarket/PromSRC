import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Exercise the built routes without touching a gateway or real tasks.
const root = fileURLToPath(new URL('../generated/public-web-ui/', import.meta.url));
const base = 'http://localhost:38129';
const shots = process.env.TASK_HEADER_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const surface = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const statuses = ['needs_assistance', 'running', 'queued', 'paused', 'complete', 'failed'];
    let tasks = statuses.map(status => ({ id: `sample-${status}`, status, description: `Sample ${status.replace('_', ' ')} task`, createdAt: Date.now() }));
    await page.addInitScript(m => {
      localStorage.setItem('pm_device_token', 'fixture');
      if (m) localStorage.setItem('pm_force_mobile', '1');
    }, mobile);
    await page.route('**/*', route => {
      const { origin, pathname } = new URL(route.request().url());
      if (origin !== base) return route.abort();
      if (pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, tasks: pathname === '/api/bg-tasks' ? tasks : [], items: [], supervisions: [], sessions: [], agents: [] } });
      const file = path.join(root, pathname === '/' ? 'index.html' : pathname === '/mobile/tasks' ? 'mobile.html' : pathname);
      return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
    });
    await page.goto(base + (mobile ? '/mobile/tasks' : '/?desktop=1'), { waitUntil: 'domcontentloaded' });
    if (!mobile) {
      await page.waitForFunction(() => typeof window.setMode === 'function');
      await page.evaluate(() => window.setMode('bgtasks'));
    }
    const headers = page.locator(mobile ? '#pm-tasks-filter button' : '.bgt-col > div:first-child');
    await page.waitForFunction(() => document.querySelectorAll('.task-header-indicator').length === 3, null, { timeout: 12000 });
    assert.equal(await page.locator('#pm-tasks-count, #bgt-count').count(), 0);
    for (const status of statuses) {
      const key = mobile && status === 'needs_assistance' ? 'needs_you' : status;
      const header = mobile ? page.locator(`[data-filter="${key}"]`) : page.locator(`.bgt-col:has([data-bgt-drop-status="${key}"]) > div:first-child`);
      assert.doesNotMatch(await header.textContent(), /\d/);
      const dot = header.locator('.task-header-indicator');
      if (['running', 'paused', 'needs_assistance'].includes(status)) {
        assert.equal((await dot.textContent()).trim(), '(●)');
        assert.equal(await dot.locator('span').evaluate(e => getComputedStyle(e).color), status === 'running' ? 'rgb(47, 174, 102)' : 'rgb(226, 85, 85)');
      } else assert.equal(await dot.count(), 0);
    }
    if (shots) await page.screenshot({ path: path.join(shots, surface + '.png') });
    // Leave unrelated tasks present so the desktop board stays mounted.
    tasks = tasks.filter(t => ['complete', 'queued', 'failed'].includes(t.status));
    if (mobile) await page.locator('#pm-tasks-refresh').click();
    else await page.evaluate(() => window.refreshBgTasks());
    await page.waitForFunction(() => !document.querySelector('.task-header-indicator'));
    assert.doesNotMatch((await headers.allTextContents()).join(''), /[()\d●]/);
    assert(await headers.count() > 0);
    await page.close();
    console.log(`${surface}: populated and empty headers passed`);
  }
} finally { await browser.close(); }
