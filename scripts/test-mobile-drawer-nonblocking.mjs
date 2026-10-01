import assert from 'node:assert/strict';
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
const server = http.createServer((request, response) => {
  if (request.url === '/module.js') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'content-length': moduleCode.length });
    response.end(moduleCode);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="mobile-root"></div>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      if (url.pathname === '/api/settings/provider' || url.pathname === '/api/projects') {
        // A last-active offline gateway can leave optional drawer metadata pending.
        return new Promise(() => {});
      }
      if (url.pathname.startsWith('/api/')) {
        return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      }
      return originalFetch(input, options);
    };
    const { createMobileShell } = await import('/module.js');
    createMobileShell({
      activeTab: 'chat',
      onNavigate() {},
      onNewChat() {},
      onOpenSession() {},
      loadSessions: async () => ({ sessions: [{ id: 'desktop-chat', title: 'Desktop chat', channel: 'mobile' }] }),
      searchSessions: async () => [],
    });
  });
  await page.getByText('Desktop chat', { exact: true }).waitFor({ timeout: 3000 });
  const sessionList = await page.locator('#pm-mobile-session-list').innerText();
  assert.match(sessionList, /Desktop chat/);
  assert.doesNotMatch(sessionList, /Loading\.\.\./);
  assert.deepEqual(pageErrors, []);
  await page.close();
  console.log('[test-mobile-drawer-nonblocking] sessions render while optional metadata is stalled');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
