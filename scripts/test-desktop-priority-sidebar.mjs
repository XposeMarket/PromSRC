import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const source = (path) => readFileSync(new URL(`../web-ui/${path}`, import.meta.url), 'utf8');
const index = source('index.html');
const sidebar = index.match(/<aside\b[^>]*id="sidebar"[\s\S]*?<\/aside>/)?.[0];
assert.ok(sidebar, 'test must use the production sidebar markup');
const styles = [...index.matchAll(/href="(src\/styles\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)]
  .map(([, path]) => `<style>${source(path)}</style>`).join('\n');
const bootstrap = source('src/legacy-desktop-bootstrap.js');
const toggle = bootstrap.match(/function togglePriorityPanel\(event\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(toggle, 'test must exercise the production Priority toggle');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
  await page.setContent(`<html data-theme="dark" data-skin="p1"><head><meta charset="utf-8">${styles}</head><body>
  ${sidebar}<div class="workspace"><main class="main-shell"></main></div>
  <script>
    let _priorityPanelOpen = false, _settledViewOpen = false;
    // The fixture supplies sample rows in place of a signed-in gateway. Use the
    // same collapsed class that the app applies when its transition settles.
    window.setSidebarCollapsed = (collapsed) => document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
    function renderSessionsList() {
      document.getElementById('sidebar-priority-panel').hidden = !_priorityPanelOpen;
      document.getElementById('sidebar-sessions-section').style.display = _priorityPanelOpen ? 'none' : '';
      document.getElementById('sidebar-priority-content').innerHTML = '<div class="priority-section"><div class="section-title">Priority</div><div class="priority-section-list session-list"><div class="session-card priority-chat-card">Design feedback</div></div></div><div class="priority-section"><div class="section-title">Recent</div><div class="priority-section-list session-list"><div class="session-card priority-chat-card">Launch checklist</div><div class="session-card priority-chat-card">Project notes</div></div></div>';
    }
    ${toggle}
  </script></body></html>`);
  const bell = page.locator('#sidebarPriorityToggle');
  const panel = page.locator('#sidebar-priority-panel');
  const sessions = page.locator('#sidebar-sessions-section');
  await bell.click();
  assert.equal(await bell.getAttribute('aria-pressed'), 'true');
  assert.equal(await sessions.isVisible(), false);
  assert.equal(await panel.evaluate((el) => {
    const css = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const scroll = el.closest('.sidebar-scroll')?.getBoundingClientRect();
    return Boolean(scroll && !['absolute', 'fixed'].includes(css.position) && css.boxShadow === 'none'
      && css.borderLeftWidth === '0px' && rect.left >= scroll.left && rect.right <= scroll.right);
  }), true, 'Priority Mode should be an inline list within the sidebar, without popover chrome');
  if (process.env.PROM_PRIORITY_SCREENSHOT_DIR) {
    const dir = process.env.PROM_PRIORITY_SCREENSHOT_DIR;
    mkdirSync(dir, { recursive: true });
    await page.locator('#sidebar').screenshot({ path: join(dir, 'priority-mode.png') });
  }
  await bell.click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await sessions.isVisible(), true);

  await page.evaluate(() => window.setSidebarCollapsed(true));
  await bell.click();
  assert.equal(await page.locator('#sidebar').evaluate((el) => el.classList.contains('collapsed')), false,
    'the rail bell must expand the sidebar, not open a flyout');
  assert.equal(await panel.isVisible(), true);
  await page.evaluate(() => window.setSidebarCollapsed(true));
  assert.equal(await panel.isVisible(), false, 'collapsing the sidebar must never expose a Priority flyout');
  await bell.click();
  assert.equal(await panel.isVisible(), true, 'the rail bell restores an already-active Priority list');
  assert.equal(await bell.getAttribute('aria-expanded'), 'true');
  await bell.click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await sessions.isVisible(), true);
  console.log('Desktop Priority Mode is inline in the sidebar and opens from the collapsed rail.');
} finally {
  await browser.close();
}
