import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'generated', 'public-web-ui');
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'asset-manifest.json'), 'utf8'));
const requests = [];
const missing = [];
const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff2', 'font/woff2'],
]);

function safeFile(base, pathname) {
  const candidate = path.resolve(base, pathname.replace(/^\/+/, ''));
  return candidate === base || candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
}

function apiFixture(pathname) {
  if (pathname === '/api/account/status') {
    return { authenticated: true, email: 'performance@example.test', subscriptionActive: true, accessActive: true };
  }
  if (pathname === '/api/health' || pathname === '/api/status') return { success: true, status: 'ok' };
  if (pathname.includes('sessions')) return { success: true, sessions: [], items: [] };
  if (pathname.includes('settings')) return { success: true, settings: {} };
  return { success: true, items: [], data: [], status: 'ok' };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  requests.push(url.pathname);
  if (url.pathname.startsWith('/api/')) {
    const body = Buffer.from(JSON.stringify(apiFixture(url.pathname)));
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
    response.end(body);
    return;
  }

  let filePath;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = path.join(publicRoot, 'index.html');
  } else if (url.pathname === '/mobile' || url.pathname.startsWith('/mobile/')) {
    filePath = path.join(publicRoot, 'mobile.html');
  } else if (url.pathname.startsWith('/assets/')) {
    filePath = safeFile(path.join(root, 'assets'), url.pathname.slice('/assets/'.length));
  } else if (url.pathname.startsWith('/vendor/pretext/')) {
    filePath = safeFile(path.join(root, 'node_modules', '@chenglou', 'pretext', 'dist'), url.pathname.slice('/vendor/pretext/'.length));
  } else if (url.pathname.startsWith('/vendor/jspdf/')) {
    filePath = safeFile(path.join(root, 'node_modules', 'jspdf', 'dist'), url.pathname.slice('/vendor/jspdf/'.length));
  } else if (url.pathname.startsWith('/vendor/dompurify/')) {
    filePath = safeFile(path.join(root, 'node_modules', 'dompurify', 'dist'), url.pathname.slice('/vendor/dompurify/'.length));
  } else {
    filePath = safeFile(publicRoot, url.pathname);
  }

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    missing.push(url.pathname);
    response.writeHead(404).end('not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'content-type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(body);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('prometheus_account', JSON.stringify({
      email: 'performance@example.test',
      subscriptionActive: true,
      accessActive: true,
    }));
  });
  const page = await context.newPage();
  const moduleErrors = [];
  page.on('pageerror', (error) => {
    const message = String(error?.message || error || '');
    if (/SyntaxError|requested module|does not provide an export|Failed to fetch dynamically imported module/i.test(message)) {
      moduleErrors.push(message);
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__PROM_DESKTOP_MODULES_READY instanceof Promise);
  await page.evaluate(() => window.__PROM_DESKTOP_MODULES_READY);
  await page.waitForSelector('body:not(.auth-pending) .app', { timeout: 12_000 });
  await page.waitForTimeout(500);

  assert(requests.includes(manifest.entries.desktop.js), 'desktop entry was not requested');
  assert(requests.includes(manifest.entries.desktop.css), 'desktop stylesheet was not requested');
  assert(!requests.includes(manifest.entries.mobile.js), 'desktop boot requested the mobile entry');
  assert.deepEqual(moduleErrors, [], 'production desktop module evaluation failed');
  assert.deepEqual(missing.filter((pathname) => pathname.startsWith('/build/')), [], 'production desktop requested a missing hashed asset');
  await context.close();
  console.log(JSON.stringify({ desktopRequests: new Set(requests).size, buildRequests: new Set(requests.filter((item) => item.startsWith('/build/'))).size }, null, 2));
  console.log('Production desktop browser smoke passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
