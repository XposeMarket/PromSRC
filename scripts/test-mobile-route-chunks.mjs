import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'generated', 'public-web-ui');
const assetManifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'asset-manifest.json'), 'utf8'));
const mobileOutput = (filename) => assetManifest.moduleOutputs[`src/mobile/${filename}`];
const ownerFiles = [
  'mobile-voice-page.js',
  'mobile-schedule-pages.js',
  'mobile-teams-pages.js',
  'mobile-hub-pages.js',
  'mobile-proposals-pages.js',
  'mobile-tasks-pages.js',
  'mobile-creative-pages.js',
  'mobile-subagent-pages.js',
].map(mobileOutput);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

function safeFile(base, pathname) {
  const candidate = path.resolve(base, pathname.replace(/^\/+/, ''));
  return candidate === base || candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
}

function apiFixture(pathname) {
  if (pathname === '/api/schedules') return { success: true, schedules: [] };
  if (pathname === '/api/brain/status') return { success: true, thought: null, dream: null };
  if (pathname.includes('/sessions')) return { success: true, sessions: [], groups: [], items: [] };
  if (pathname.includes('/approvals')) return { success: true, approvals: [] };
  if (pathname.includes('/questions')) return { success: true, questions: [] };
  return { success: true, items: [], data: [], status: 'ok' };
}

const requests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  requests.push(url.pathname);
  if (url.pathname.startsWith('/api/')) {
    const body = Buffer.from(JSON.stringify(apiFixture(url.pathname)));
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': body.length,
    });
    response.end(body);
    return;
  }

  let file = null;
  if (url.pathname === '/mobile' || url.pathname.startsWith('/mobile/')) {
    file = path.join(publicRoot, 'mobile.html');
  } else if (url.pathname.startsWith('/assets/')) {
    file = safeFile(path.join(root, 'assets'), url.pathname.slice('/assets/'.length));
  } else {
    file = safeFile(publicRoot, url.pathname);
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  const body = fs.readFileSync(file);
  response.writeHead(200, {
    'content-type': mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  if (request.method === 'HEAD') response.end();
  else response.end(body);
});

function waitFor(predicate, timeoutMs = 8_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for route owner request.'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function requestMetrics(paths) {
  const unique = [...new Set(paths)];
  const totals = { jsRawBytes: 0, jsGzipBytes: 0, cssRawBytes: 0, cssGzipBytes: 0, moduleCount: 0 };
  for (const pathname of unique) {
    if (!pathname.startsWith('/static/') && !pathname.startsWith('/build/')) continue;
    const file = safeFile(publicRoot, pathname);
    if (!file || !fs.existsSync(file)) continue;
    const extension = path.extname(file).toLowerCase();
    if (extension !== '.js' && extension !== '.mjs' && extension !== '.css') continue;
    const body = fs.readFileSync(file);
    const gzipBytes = zlib.gzipSync(body, { level: 9 }).length;
    if (extension === '.css') {
      totals.cssRawBytes += body.length;
      totals.cssGzipBytes += gzipBytes;
    } else {
      totals.jsRawBytes += body.length;
      totals.jsGzipBytes += gzipBytes;
      totals.moduleCount += 1;
    }
  }
  return totals;
}

async function inspectRoute(browser, baseUrl, { route, paired, expectedOwner, forbiddenOwners, forbiddenApis = [], selector = '#mobile-root .pm-app' }) {
  const start = requests.length;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  if (paired) {
    await context.addInitScript(() => {
      localStorage.setItem('pm_device_token', 'route-chunk-test-token');
      localStorage.setItem('pm_force_mobile', '1');
    });
  }
  const page = await context.newPage();
  const moduleErrors = [];
  page.on('pageerror', (error) => {
    const message = String(error?.message || error || '');
    if (/does not provide an export|requested module|SyntaxError|already been declared/i.test(message)) moduleErrors.push(message);
  });
  const navigation = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  assert(navigation, `${route}: missing navigation response`);
  const documentHtml = await navigation.text();
  assert(documentHtml.includes(assetManifest.entries.mobile.js), `${route}: production mobile entry document was not served`);
  assert(!documentHtml.includes('id="ember-canvas"'), `${route}: desktop shell leaked into mobile document`);
  assert(documentHtml.length < 10_000, `${route}: mobile document is unexpectedly large (${documentHtml.length} bytes)`);

  await waitFor(() => requests.slice(start).includes(expectedOwner));
  await page.waitForSelector(selector, { timeout: 8_000 });
  await page.waitForTimeout(250);
  const observed = requests.slice(start);

  assert(observed.includes(assetManifest.entries.mobile.css), `${route}: mobile stylesheet was not requested`);
  assert(!observed.includes(assetManifest.entries.desktop.css), `${route}: desktop stylesheet was requested`);
  assert(!observed.some((pathname) => /\/static\/styles\/(?:base|components|settings|multi-chat-workspace)\.css$/.test(pathname)), `${route}: raw desktop stylesheet was requested`);
  for (const owner of forbiddenOwners) {
    assert(!observed.includes(owner), `${route}: fetched unrelated owner ${owner}`);
  }
  for (const apiPath of forbiddenApis) {
    assert(!observed.some((pathname) => pathname.startsWith(apiPath)), `${route}: issued unrelated API request ${apiPath}`);
  }
  assert.deepEqual(moduleErrors, [], `${route}: route owner failed module evaluation`);

  const metrics = requestMetrics(observed);
  await context.close();
  return { route, expectedOwner, observed: [...new Set(observed)].sort(), metrics };
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const pair = await inspectRoute(browser, baseUrl, {
    route: '/mobile/pair',
    paired: false,
    expectedOwner: mobileOutput('mobile-pairing-page.js'),
    forbiddenOwners: [mobileOutput('mobile-pages.js'), ...ownerFiles],
  });
  const chat = await inspectRoute(browser, baseUrl, {
    route: '/mobile/chat',
    paired: true,
    expectedOwner: mobileOutput('mobile-pages.js'),
    forbiddenOwners: ownerFiles,
    forbiddenApis: ['/api/bg-tasks', '/api/schedules', '/api/teams', '/api/subagents'],
  });
  const voiceOwner = mobileOutput('mobile-voice-page.js');
  const voice = await inspectRoute(browser, baseUrl, {
    route: '/mobile/voice',
    paired: true,
    expectedOwner: voiceOwner,
    forbiddenOwners: ownerFiles.filter((owner) => owner !== voiceOwner),
    selector: '#pm-voice-orb',
  });
  const schedule = await inspectRoute(browser, baseUrl, {
    route: '/mobile/schedule',
    paired: true,
    expectedOwner: mobileOutput('mobile-schedule-pages.js'),
    forbiddenOwners: [mobileOutput('mobile-pages.js'), ...ownerFiles.filter((file) => file !== mobileOutput('mobile-schedule-pages.js'))],
    selector: '#pm-sched-body',
  });

  const routeContracts = [
    { route: '/mobile/settings', expectedOwner: mobileOutput('mobile-settings.js'), allowed: [], selector: '.pm-settings-body' },
    { route: '/mobile/creative', expectedOwner: mobileOutput('mobile-creative-pages.js'), allowed: [mobileOutput('mobile-creative-pages.js')], selector: '#pm-creative-body' },
    { route: '/mobile/teams', expectedOwner: mobileOutput('mobile-teams-pages.js'), allowed: [mobileOutput('mobile-teams-pages.js')], selector: '#pm-teams-body' },
    { route: '/mobile/tasks', expectedOwner: mobileOutput('mobile-tasks-pages.js'), allowed: [mobileOutput('mobile-tasks-pages.js'), mobileOutput('mobile-teams-pages.js')], selector: '#pm-tasks-body' },
    { route: '/mobile/hub', expectedOwner: mobileOutput('mobile-hub-pages.js'), allowed: [mobileOutput('mobile-hub-pages.js')], selector: '#pm-hub-body' },
    { route: '/mobile/proposals', expectedOwner: mobileOutput('mobile-proposals-pages.js'), allowed: [mobileOutput('mobile-proposals-pages.js'), mobileOutput('mobile-hub-pages.js')], selector: '#pm-proposals-body' },
    { route: '/mobile/subagents', expectedOwner: mobileOutput('mobile-subagent-pages.js'), allowed: [mobileOutput('mobile-subagent-pages.js'), mobileOutput('mobile-teams-pages.js'), mobileOutput('mobile-tasks-pages.js')], selector: '#pm-subagents-body' },
  ];
  for (const contract of routeContracts) {
    await inspectRoute(browser, baseUrl, {
      ...contract,
      paired: true,
      forbiddenOwners: ownerFiles.filter((owner) => !contract.allowed.includes(owner)),
    });
  }

  console.log(JSON.stringify({ pair: pair.metrics, chat: chat.metrics, voice: voice.metrics, schedule: schedule.metrics }, null, 2));
  console.log('Mobile route chunk behavior passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
