// Mobile drawer + tab bar regression (real Chromium touch input via CDP).
// 1. After the drawer opens and closes (button path and swipe path), the tab
//    bar's fixed haptic input surface must line up with the tab bar again and a
//    tap on a tab must navigate. Before the fix it stayed parked where the tab
//    bar was mid-slide, so taps only hit the decorative haptic switches.
// 2. A clearly horizontal swipe right from mid-screen opens the drawer; a swipe
//    left on the drawer closes it.
// 3. A swipe right inside horizontally scrolled content scrolls that content
//    instead of opening the drawer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  entryPoints: [path.join(root, 'web-ui/src/mobile/mobile-shell.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['safari16.4'],
  write: false,
});
const moduleCode = bundled.outputFiles[0].contents;
const css = ['web-ui/src/styles/mobile.css', 'web-ui/src/styles/mobile-shell.css']
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<body class="pm-mobile-active"><div id="mobile-root"></div></body>`;
const server = http.createServer((request, response) => {
  if (request.url === '/module.js') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'content-length': moduleCode.length });
    response.end(moduleCode);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      if (url.pathname.startsWith('/api/')) {
        return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      }
      return originalFetch(input, options);
    };
    window.__routes = [];
    const shell = await import('/module.js');
    window.__shell = shell;
    const { page } = shell.createMobileShell({
      activeTab: 'chat',
      onNavigate(route) { window.__routes.push(route); },
      onNewChat() {},
      onOpenSession() {},
      loadSessions: async () => ({ sessions: [{ id: 's1', title: 'Chat one', channel: 'mobile' }] }),
      searchSessions: async () => [],
    });
    page.innerHTML = `<div style="padding:120px 16px">
      <div id="hscroll" style="overflow-x:auto;width:300px;height:80px;white-space:nowrap">
        <div style="display:inline-block;width:1200px;height:60px;background:#333"></div>
      </div>
    </div>`;
  });
  const cdp = await context.newCDPSession(page);
  const swipe = async (fromX, toX, y, steps = 12) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const drawerOpen = () => page.evaluate(() => document.body.classList.contains('pm-mobile-drawer-open'));
  const surfaceAlignment = () => page.evaluate(() => {
    const bar = document.querySelector('.pm-tabbar')?.getBoundingClientRect();
    const proxy = document.querySelector('.pm-tabbar-haptic-gesture-surface')?.getBoundingClientRect();
    return { bar: bar && { x: bar.left, w: bar.width }, proxy: proxy && { x: proxy.left, w: proxy.width } };
  });
  const tapTab = async (id) => {
    const box = await page.evaluate((tabId) => {
      const r = document.querySelector(`.pm-tab[data-tab="${tabId}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, id);
    const before = await page.evaluate(() => window.__routes.length);
    await page.touchscreen.tap(box.x, box.y);
    await sleep(120);
    return page.evaluate((n) => window.__routes.slice(n), before);
  };
  const assertAligned = async (label) => {
    const { bar, proxy } = await surfaceAlignment();
    assert.ok(bar && proxy, `${label}: tab bar and its touch surface exist`);
    assert.ok(Math.abs(bar.x - proxy.x) < 2 && Math.abs(bar.w - proxy.w) < 2,
      `${label}: tab bar touch surface is aligned (bar x=${bar.x} w=${bar.w}, surface x=${proxy.x} w=${proxy.w})`);
  };

  await sleep(400);
  await assertAligned('initial');

  // Button path: open, then close (back button / opening a chat both call closeDrawer).
  await page.evaluate(() => window.__shell.openDrawer());
  await sleep(450);
  assert.equal(await drawerOpen(), true, 'openDrawer opens');
  await page.evaluate(() => window.__shell.closeDrawer());
  await sleep(600);
  await assertAligned('after button close');
  assert.deepEqual(await tapTab('tasks'), ['#mobile/tasks'], 'tab tap navigates after the drawer closes');

  // Swipe path: mid-screen swipe right opens, swipe left on the drawer closes.
  await swipe(150, 360, 600);
  await sleep(450);
  assert.equal(await drawerOpen(), true, 'mid-screen swipe right opens the drawer');
  await swipe(320, 60, 600);
  await sleep(600);
  assert.equal(await drawerOpen(), false, 'swipe left closes the drawer');
  await assertAligned('after swipe close');
  const afterSwipe = await tapTab('tasks');
  assert.equal(afterSwipe.length, 1, `tab tap navigates after a swipe close (got ${JSON.stringify(afterSwipe)})`);

  // Horizontal content keeps its own swipe while it can still scroll left.
  await page.evaluate(() => { document.getElementById('hscroll').scrollLeft = 300; });
  const hs = await page.evaluate(() => {
    const r = document.getElementById('hscroll').getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 30 };
  });
  await swipe(hs.x, hs.x + 200, hs.y);
  await sleep(450);
  assert.equal(await drawerOpen(), false, 'swipe inside horizontally scrolled content does not open the drawer');

  assert.deepEqual(pageErrors, []);
  console.log('[test-mobile-drawer-tabbar] tab bar works after drawer close; swipe open/close + horizontal-scroll exclusion OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
