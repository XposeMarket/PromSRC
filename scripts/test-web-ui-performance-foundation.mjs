import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  createStandardWebUiPerformanceScenarios,
  validateWebUiPerformanceScenario,
} from './lib/web-ui-performance-scenarios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const performanceSource = fs.readFileSync(path.join(root, 'web-ui', 'src', 'performance.js'), 'utf8');

const scenarios = createStandardWebUiPerformanceScenarios();
assert.deepEqual(scenarios.map((scenario) => scenario.expected.turns), [100, 500, 1200]);
for (const scenario of scenarios) {
  const validation = validateWebUiPerformanceScenario(scenario);
  assert.equal(validation.ok, true, `${scenario.id}: ${validation.failures.join('; ')}`);
  assert.ok(scenario.expected.toolCards > 0, `${scenario.id} must include tool cards`);
  assert.ok(scenario.expected.reasoningBlocks > 0, `${scenario.id} must include active reasoning`);
  assert.ok(scenario.expected.foregroundStreams >= 2, `${scenario.id} must exercise two foreground streams`);
  assert.ok(scenario.expected.backgroundStreams >= 1, `${scenario.id} must exercise background streaming`);
  assert.ok(scenario.expected.typingEvents >= 96, `${scenario.id} must type while streaming`);
}

const requestedPaths = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  requestedPaths.push(url.pathname);
  if (url.pathname === '/mobile-fixture' || url.pathname === '/desktop-fixture') {
    const mobile = url.pathname === '/mobile-fixture';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><script>
      window.__PROM_SHOULD_BOOT_MOBILE = () => ${mobile};
      window.__bootEvents = [];
      addEventListener('prometheus:client-performance-mark', (event) => window.__bootEvents.push(event.detail));
    </script><script type="module">
      import { markClientPerformance } from '/src/performance.js';
      markClientPerformance('fixture_ready', { surface: '${mobile ? 'mobile' : 'desktop'}', unsafe: 'not retained' });
      window.__fixtureReady = true;
    </script>`);
    return;
  }
  if (url.pathname === '/src/performance.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(performanceSource);
    return;
  }
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end('export {};');
    return;
  }
  response.writeHead(404);
  response.end('not found');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();

  requestedPaths.length = 0;
  await page.goto(`${origin}/mobile-fixture`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fixtureReady === true);
  await page.waitForTimeout(100);
  const mobileRequests = requestedPaths.slice();
  for (const forbidden of [
    '/src/features/chat/multi-chat-workspace-v2.js',
    '/src/features/chat/canonical-desktop-composer.js',
    '/src/context-window-live-tracking.js',
    '/src/prom-bot.js',
    '/src/prom-bot-roster.js',
    '/src/prom-bot-collab.js',
    '/src/prom-bot-collab-hardening.js',
    '/src/team-prom-bot-flow.js',
    '/src/bot-create.js',
    '/src/bot-create-settings-bridge.js',
  ]) {
    assert.equal(mobileRequests.includes(forbidden), false, `mobile boot requested desktop module ${forbidden}`);
  }
  const event = await page.evaluate(() => window.__bootEvents.at(-1));
  assert.equal(event.name, 'fixture_ready');
  assert.equal(event.surface, 'mobile');
  assert.equal(Object.hasOwn(event, 'unsafe'), false, 'performance marks must keep their privacy allowlist');
  const mobileRendererSample = await page.evaluate(() => window.__bootEvents.find((entry) => entry.name === 'renderer_sample'));
  assert.ok(mobileRendererSample, 'renderer telemetry must emit an initial sample');
  assert.equal(mobileRendererSample.surface, 'mobile');
  assert.equal(typeof mobileRendererSample.domNodes, 'number');

  requestedPaths.length = 0;
  await page.goto(`${origin}/desktop-fixture`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fixtureReady === true);
  for (const expected of [
    '/src/prom-bot.js',
    '/src/bot-create.js',
    '/src/features/chat/canonical-desktop-composer.js',
  ]) {
    assert.equal(requestedPaths.includes(expected), true, `desktop initial boot did not request ${expected}`);
  }
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prometheus:page-activated', { detail: { mode: 'chat' } }));
  });
  await page.waitForTimeout(100);
  const desktopRequests = requestedPaths.slice();
  for (const expected of [
    '/src/features/chat/multi-chat-intent.js',
    '/src/context-window-live-tracking.js',
  ]) {
    assert.equal(desktopRequests.includes(expected), true, `desktop Chat activation did not request ${expected}`);
  }
  for (const forbidden of [
    '/src/features/chat/multi-chat-workspace-v2.js',
    '/src/features/chat/desktop-turn-file-diff.js',
  ]) {
    assert.equal(desktopRequests.includes(forbidden), false, `desktop Chat activation eagerly requested ${forbidden}`);
  }
  requestedPaths.length = 0;
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('prometheus:page-activated', { detail: { mode: 'subagents' } }));
  });
  await page.waitForTimeout(100);
  assert.equal(
    requestedPaths.includes('/src/features/chat/canonical-desktop-composer.js'),
    false,
    'desktop Subagents activation unexpectedly re-requested the already booted canonical composer owner',
  );
  await context.close();
} finally {
  await browser?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

// Execute the actual worker and inspect its install behavior. This protects the
// cache effect rather than locking a source-code location or array formatting.
const workerSource = fs.readFileSync(path.join(root, 'web-ui', 'service-worker.js'), 'utf8');
const listeners = new Map();
const addedUrls = [];
const workerContext = {
  URL,
  Response,
  Request,
  Promise,
  setTimeout,
  clearTimeout,
  fetch: async () => new Response('', { status: 200 }),
  navigator: {},
  caches: {
    open: async () => ({
      add: async (url) => { addedUrls.push(String(url)); },
      match: async () => null,
      put: async () => {},
    }),
    keys: async () => [],
    delete: async () => true,
    match: async () => null,
  },
  self: {
    location: { origin: 'https://prometheus.test' },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { getNotifications: async () => [], showNotification: async () => {} },
    skipWaiting() {},
    addEventListener(name, handler) { listeners.set(name, handler); },
  },
};
workerContext.clients = workerContext.self.clients;
vm.runInNewContext(workerSource, workerContext, { filename: 'web-ui/service-worker.js' });
let installPromise = Promise.resolve();
listeners.get('install')({ waitUntil(promise) { installPromise = Promise.resolve(promise); } });
await installPromise;

assert.equal(new Set(addedUrls).size, addedUrls.length, 'service worker precache URLs must be unique');
assert.equal(addedUrls.some((url) => url.startsWith('/src/')), false, 'precache must not duplicate source and generated module identities');
const shellAliases = addedUrls.filter((url) => (
  url === '/' || url === '/index.html' || url.startsWith('/mobile/') || url.startsWith('/?')
));
assert.deepEqual(shellAliases, ['/mobile/chat'], 'install must cache one canonical mobile navigation shell');

// Resolve local static import specifiers as the browser does and ensure no module
// in the mobile graph creates a query-string alias for the same source file.
const moduleAliases = new Map();
const moduleSources = [path.join(root, 'web-ui', 'index.html')];
const sourceDirectories = [path.join(root, 'web-ui', 'src')];
while (sourceDirectories.length) {
  const directory = sourceDirectories.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceDirectories.push(absolute);
    else if (entry.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) moduleSources.push(absolute);
  }
}
for (const importer of moduleSources) {
  const source = fs.readFileSync(importer, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)) {
    const specifier = match[2];
    if (!/\.(?:js|mjs)(?:\?|$)/i.test(specifier)) continue;
    const [pathname, query = ''] = specifier.split('?');
    const resolved = path.resolve(path.dirname(importer), pathname).toLowerCase();
    if (!moduleAliases.has(resolved)) moduleAliases.set(resolved, new Set());
    moduleAliases.get(resolved).add(query);
  }
}
for (const [resolved, aliases] of moduleAliases) {
  assert.deepEqual([...aliases], [''], `${path.relative(root, resolved)} has multiple URL identities: ${[...aliases].join(', ')}`);
}

console.log('Web UI performance foundation behavior passed.');
