import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance as nodePerformance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultUrl = process.env.PROMETHEUS_BENCHMARK_URL || 'http://127.0.0.1:18789/';
const args = process.argv.slice(2);

function argument(name, fallback) {
  const prefix = '--' + name + '=';
  const match = args.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return args.includes('--' + name);
}

function numberArgument(name, fallback, min, max) {
  const value = Number(argument(name, fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const baseUrl = new URL(defaultUrl);
const samples = numberArgument('samples', 3, 1, 10);
const startupWaitMs = numberArgument('startup-wait-ms', 3000, 500, 15000);
const mobileWaitMs = numberArgument('mobile-wait-ms', 1200, 300, 10000);
const phase = String(argument('phase', process.env.PROMETHEUS_BENCHMARK_PHASE || 'post-fix'));
const sourceMode = String(argument('source', 'working-tree'));
const skipMobile = hasFlag('skip-mobile');
const skipSyntheticChat = hasFlag('skip-synthetic-chat');

const GIT_SOURCE_FILES = {
  '/': 'web-ui/index.html',
  '/index.html': 'web-ui/index.html',
  '/src/api.js': 'web-ui/src/api.js',
  '/src/app.js': 'web-ui/src/app.js',
  '/src/pages/ChatPage.js': 'web-ui/src/pages/ChatPage.js',
  '/src/pages/ConnectionsPage.js': 'web-ui/src/pages/ConnectionsPage.js',
  '/src/pages/ProjectsPage.js': 'web-ui/src/pages/ProjectsPage.js',
  '/src/mobile/mobile-router.js': 'web-ui/src/mobile/mobile-router.js',
};

function loadGitSources() {
  if (sourceMode !== 'git') return null;
  const sources = new Map();
  for (const [pathname, repositoryPath] of Object.entries(GIT_SOURCE_FILES)) {
    sources.set(pathname, execFileSync('git', ['show', 'HEAD:' + repositoryPath], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }));
  }
  return sources;
}

const gitSources = loadGitSources();

function round(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null;
}

function distribution(values) {
  const sorted = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50: null, p75: null, p95: null, p99: null, max: null };
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p75: round(at(0.75)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function safePath(value) {
  try {
    const parsed = new URL(String(value));
    let pathname = parsed.pathname || '/';
    pathname = pathname
      .replace(/\/sessions\/[^/]+(?=\/|$)/gi, '/sessions/:id')
      .replace(/\/threads\/[^/]+(?=\/|$)/gi, '/threads/:id')
      .replace(/\/runs\/[^/]+(?=\/|$)/gi, '/runs/:id')
      .replace(/\/tasks\/[^/]+(?=\/|$)/gi, '/tasks/:id')
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
      .replace(/\/[^/]{48,}(?=\/|$)/g, '/:id');
    const kind = parsed.searchParams.get('kind');
    const strict = parsed.searchParams.get('strict');
    const safeQuery = [];
    if (kind === 'connector' || kind === 'provider') safeQuery.push('kind=' + kind);
    if (strict === '1') safeQuery.push('strict=1');
    return safeQuery.length ? pathname + '?' + safeQuery.join('&') : pathname;
  } catch {
    return '';
  }
}

function attachRequestLedger(page) {
  const pending = new Map();
  const completed = [];
  const onRequest = (request) => {
    const pathname = safePath(request.url());
    if (!pathname.startsWith('/api/')) return;
    pending.set(request, {
      method: request.method(),
      path: pathname,
      startedAt: nodePerformance.now(),
    });
  };
  const onResponse = (response) => {
    const record = pending.get(response.request());
    if (!record) return;
    pending.delete(response.request());
    completed.push({
      method: record.method,
      path: record.path,
      status: response.status(),
      durationMs: round(nodePerformance.now() - record.startedAt),
    });
  };
  const onFailed = (request) => {
    const record = pending.get(request);
    if (!record) return;
    pending.delete(request);
    completed.push({
      method: record.method,
      path: record.path,
      status: null,
      durationMs: round(nodePerformance.now() - record.startedAt),
      failed: true,
    });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  return {
    get length() {
      return completed.length;
    },
    slice(index) {
      return completed.slice(index);
    },
  };
}

function summarizeApiCalls(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = call.method + ' ' + call.path;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  const endpoints = [...groups.entries()]
    .map(([key, rows]) => {
      const split = key.indexOf(' ');
      const method = key.slice(0, split);
      const pathName = key.slice(split + 1);
      return {
        method,
        path: pathName,
        count: rows.length,
        failed: rows.filter((row) => row.failed || !Number.isFinite(row.status) || row.status >= 400).length,
        durationMs: distribution(rows.map((row) => row.durationMs)),
      };
    })
    .sort((a, b) => b.count - a.count || (b.durationMs.p95 || 0) - (a.durationMs.p95 || 0));
  return {
    count: calls.length,
    failed: calls.filter((row) => row.failed || !Number.isFinite(row.status) || row.status >= 400).length,
    endpoints,
  };
}

async function pageEvaluation(page, callback, fallback) {
  try {
    return await page.evaluate(callback);
  } catch {
    return fallback;
  }
}

async function collectPageMetrics(page) {
  return pageEvaluation(page, () => {
    const navigation = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find((entry) => entry.name === 'first-contentful-paint');
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType || '',
      durationMs: entry.duration,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0,
    }));
    return {
      navigation: {
        responseEndMs: navigation.responseEnd,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventEndMs: navigation.loadEventEnd,
        durationMs: navigation.duration,
      },
      fcpMs: fcp ? fcp.startTime : null,
      resources,
    };
  }, null);
}

function summarizeResources(metrics) {
  const resources = Array.isArray(metrics?.resources) ? metrics.resources : [];
  const scripts = resources.filter((entry) => entry.initiatorType === 'script' || /\.js$/i.test(safePath(entry.name)));
  const bySize = resources
    .slice()
    .sort((a, b) => Number(b.decodedBodySize || 0) - Number(a.decodedBodySize || 0))
    .slice(0, 8)
    .map((entry) => ({
      path: safePath(entry.name),
      initiatorType: entry.initiatorType,
      decodedBytes: Number(entry.decodedBodySize || 0),
      transferBytes: Number(entry.transferSize || 0),
      durationMs: round(entry.durationMs),
    }));
  return {
    count: resources.length,
    transferBytes: resources.reduce((sum, entry) => sum + Number(entry.transferSize || 0), 0),
    encodedBytes: resources.reduce((sum, entry) => sum + Number(entry.encodedBodySize || 0), 0),
    decodedBytes: resources.reduce((sum, entry) => sum + Number(entry.decodedBodySize || 0), 0),
    scriptDecodedBytes: scripts.reduce((sum, entry) => sum + Number(entry.decodedBodySize || 0), 0),
    largest: bySize,
  };
}

async function clientState(page) {
  return pageEvaluation(page, () => ({
    currentMode: String(window.currentMode || ''),
    sessionCount: Array.isArray(window.chatSessions) ? window.chatSessions.length : null,
    historyCount: Array.isArray(window.chatHistory) ? window.chatHistory.length : null,
    activeSession: Boolean(window.activeChatSessionId),
    sessionNodes: document.querySelectorAll('#jobs-list .chat-session-item').length,
    messageNodes: document.querySelectorAll('.chat-message').length,
  }), null);
}

async function clientMarks(page) {
  const events = await pageEvaluation(page, () => window.__PROM_PERF_GET_EVENTS?.() || [], []);
  const submit = events.find((entry) => entry.name === 'chat_submit');
  return events
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => ({
      name: entry.name,
      offsetMs: round(Number(entry.atMs) - Number(submit?.atMs || entry.atMs)),
    }));
}

async function waitBriefly(page, durationMs) {
  try {
    await page.waitForTimeout(durationMs);
  } catch {}
}

async function runSyntheticChat(page) {
  const input = page.locator('#chat-input');
  const button = page.locator('#send-btn');
  if (!await input.count() || !await button.count()) {
    return { available: false, reason: 'desktop composer not present' };
  }
  let routeInstalled = false;
  try {
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const events = [
        { type: 'ui_preflight', traceId: 'benchmark-trace', clientRequestId: 'benchmark-client' },
        { type: 'latency_mark', stage: 'request_received', elapsedMs: 1, traceId: 'benchmark-trace' },
        { type: 'token', text: 'ok', seq: 1, streamId: 'benchmark-stream' },
        { type: 'final', text: 'ok', seq: 2, streamId: 'benchmark-stream', traceId: 'benchmark-trace' },
        { type: 'done', seq: 3, streamId: 'benchmark-stream', traceId: 'benchmark-trace' },
      ];
      const body = events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Prometheus-Trace-Id': 'benchmark-trace',
        },
        body,
      });
    });
    routeInstalled = true;
    const startedAt = nodePerformance.now();
    await input.fill('performance benchmark');
    await button.click();
    await page.waitForFunction(
      () => (window.__PROM_PERF_GET_EVENTS?.() || []).some((entry) => entry.name === 'chat_done'),
      null,
      { timeout: 12000 },
    );
    await waitBriefly(page, 350);
    return {
      available: true,
      mode: 'synthetic_client_sse_parser_and_render',
      wallMs: round(nodePerformance.now() - startedAt),
      marks: await clientMarks(page),
    };
  } catch {
    return {
      available: false,
      reason: 'composer did not complete the synthetic stream',
      marks: await clientMarks(page),
    };
  } finally {
    if (routeInstalled) {
      await page.unroute('**/api/chat').catch(() => {});
    }
  }
}

async function runDesktopSample(index) {
  let browser;
  let page;
  const errors = { pageErrors: 0, navigationFailed: false };
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
    });
    // Desktop measurements should not include the first-install PWA service
    // worker takeover reload. Mobile keeps the real service-worker path below.
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    if (gitSources) {
      await page.route('**/*', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const body = gitSources.get(pathname);
        if (body == null) {
          await route.continue();
          return;
        }
        const isHtml = pathname === '/' || pathname === '/index.html';
        await route.fulfill({
          status: 200,
          contentType: isHtml ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8',
          body,
        });
      });
    }
    page.on('pageerror', () => { errors.pageErrors += 1; });
    const ledger = attachRequestLedger(page);
    const coldApiStart = ledger.length;
    const coldStartedAt = nodePerformance.now();
    try {
      await page.goto(baseUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      errors.navigationFailed = true;
    }
    const coldNavigationWallMs = round(nodePerformance.now() - coldStartedAt);
    await waitBriefly(page, startupWaitMs);
    const coldMetrics = await collectPageMetrics(page);
    const coldState = await clientState(page);

    const warmStartedAt = nodePerformance.now();
    let warmNavigationFailed = false;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      warmNavigationFailed = true;
    }
    const warmNavigationWallMs = round(nodePerformance.now() - warmStartedAt);
    await waitBriefly(page, Math.min(startupWaitMs, 1800));
    const warmMetrics = await collectPageMetrics(page);
    const warmState = await clientState(page);

    const threadApiStart = ledger.length;
    const threadStartedAt = nodePerformance.now();
    let threadResult = { available: false, reason: 'no chat session item' };
    const firstSession = page.locator('#jobs-list .chat-session-item').first();
    if (await firstSession.count()) {
      try {
        await firstSession.click({ timeout: 8000 });
        await page.waitForFunction(() => Boolean(window.activeChatSessionId), null, { timeout: 10000 });
        await waitBriefly(page, 700);
        threadResult = {
          available: true,
          wallMs: round(nodePerformance.now() - threadStartedAt),
          state: await clientState(page),
          api: summarizeApiCalls(ledger.slice(threadApiStart)),
        };
      } catch {
        threadResult = {
          available: false,
          reason: 'thread item did not become active',
          wallMs: round(nodePerformance.now() - threadStartedAt),
          api: summarizeApiCalls(ledger.slice(threadApiStart)),
        };
      }
    }

    const routeResults = [];
    const routeButton = async (selector, expectedMode) => {
      const routeApiStart = ledger.length;
      const startedAt = nodePerformance.now();
      const button = page.locator(selector).first();
      if (!await button.count()) return { available: false, reason: selector + ' not present' };
      try {
        await button.click({ timeout: 8000 });
        await page.waitForFunction(
          (mode) => String(window.currentMode || '') === mode,
          expectedMode,
          { timeout: 10000 },
        );
        await waitBriefly(page, 300);
        return {
          available: true,
          wallMs: round(nodePerformance.now() - startedAt),
          mode: expectedMode,
          state: await clientState(page),
          api: summarizeApiCalls(ledger.slice(routeApiStart)),
        };
      } catch {
        return {
          available: false,
          reason: 'route did not settle',
          wallMs: round(nodePerformance.now() - startedAt),
          api: summarizeApiCalls(ledger.slice(routeApiStart)),
        };
      }
    };
    routeResults.push({ route: 'bgtasks', result: await routeButton('#nav-bgtasks', 'bgtasks') });
    routeResults.push({ route: 'chat', result: await routeButton('#nav-chat', 'chat') });

    const syntheticChat = skipSyntheticChat
      ? { available: false, reason: 'skipped by flag' }
      : await runSyntheticChat(page);

    return {
      sample: index + 1,
      errors,
      cold: {
        navigationWallMs: coldNavigationWallMs,
        page: coldMetrics ? {
          navigation: coldMetrics.navigation,
          fcpMs: round(coldMetrics.fcpMs),
          resources: summarizeResources(coldMetrics),
        } : null,
        state: coldState,
        api: summarizeApiCalls(ledger.slice(coldApiStart)),
      },
      warmReload: {
        navigationWallMs: warmNavigationWallMs,
        navigationFailed: warmNavigationFailed,
        page: warmMetrics ? {
          navigation: warmMetrics.navigation,
          fcpMs: round(warmMetrics.fcpMs),
          resources: summarizeResources(warmMetrics),
        } : null,
        state: warmState,
      },
      threadOpen: threadResult,
      routes: routeResults,
      syntheticChat,
    };
  } catch {
    return {
      sample: index + 1,
      errors,
      unavailable: true,
      reason: 'browser sample failed before completion',
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function runMobileSample() {
  let browser;
  let crashed = false;
  let page;
  const url = new URL(baseUrl.toString());
  url.searchParams.set('source', 'pwa');
  url.hash = 'mobile/pair';
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    page.on('crash', () => { crashed = true; });
    const startedAt = nodePerformance.now();
    let navigationFailed = false;
    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      navigationFailed = true;
    }
    const navigationWallMs = round(nodePerformance.now() - startedAt);
    await waitBriefly(page, mobileWaitMs);
    const shell = await pageEvaluation(page, () => ({
      rootPresent: Boolean(document.getElementById('mobile-root')),
      loadingPresent: /Loading Prometheus Mobile/i.test(document.body?.textContent || ''),
      mode: String(window.currentMode || ''),
      bodyTextLength: String(document.body?.textContent || '').length,
    }), null);
    return {
      available: true,
      pairedJourney: false,
      reason: 'no paired-device token was supplied',
      navigationWallMs,
      navigationFailed,
      crashed,
      shell,
    };
  } catch {
    return {
      available: true,
      pairedJourney: false,
      reason: 'no paired-device token was supplied',
      crashed: crashed || Boolean(page?.isClosed?.()),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function readServerSnapshot() {
  try {
    const responses = await Promise.all([
      fetch(new URL('/api/system-stats', baseUrl), { signal: AbortSignal.timeout(5000) }),
      fetch(new URL('/api/status', baseUrl), { signal: AbortSignal.timeout(5000) }),
      fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(5000) }),
    ]);
    const response = responses[0];
    if (!response.ok) return { available: false, status: response.status };
    const data = await response.json();
    const status = responses[1].ok ? await responses[1].json() : null;
    const health = responses[2].ok ? await responses[2].json() : null;
    return {
      available: true,
      gatewayRssMb: round(data?.gateway_process?.rss_mb),
      gatewayPrivateMb: round(data?.gateway_process?.private_mb),
      systemUsedPct: round(data?.system?.memory_percent),
      healthMemory: health?.memory ? {
        rssBytes: Number(health.memory.rssBytes || 0),
        heapUsedBytes: Number(health.memory.heapUsedBytes || 0),
        heapTotalBytes: Number(health.memory.heapTotalBytes || 0),
        externalBytes: Number(health.memory.externalBytes || 0),
        arrayBuffersBytes: Number(health.memory.arrayBuffersBytes || 0),
      } : null,
      gatewayPid: Number(health?.pid || 0) || null,
      sessionCache: status?.gatewayQueues?.sessionCache || status?.gateway_queues?.sessionCache || null,
    };
  } catch {
    return { available: false, reason: 'system-stats unavailable' };
  }
}

function normalizeTurnStage(label) {
  const clean = String(label || '').split('.').at(-1).trim();
  return clean || '';
}

function readTurnTimingSummary(days) {
  const logDir = path.join(root, '.prometheus', 'logs');
  let files = [];
  try {
    files = fs.readdirSync(logDir)
      .filter((name) => /^turn-timing\.log(?:\.\d+)?$/i.test(name))
      .sort((a, b) => {
        if (a === 'turn-timing.log') return -1;
        if (b === 'turn-timing.log') return 1;
        return a.localeCompare(b, undefined, { numeric: true });
      });
  } catch {
    return { available: false, reason: 'turn-timing logs unavailable' };
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const stageValues = new Map();
  const byTurn = new Map();
  let records = 0;
  for (const file of files) {
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(logDir, file), 'utf8').split(/\r?\n/);
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const timestamp = Date.parse(String(event.timestamp || ''));
      if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
      const stage = normalizeTurnStage(event.label);
      const value = Number(event.latencyElapsedMs ?? event.elapsedMs);
      if (!stage || !Number.isFinite(value)) continue;
      records += 1;
      if (!stageValues.has(stage)) stageValues.set(stage, []);
      stageValues.get(stage).push(value);
      const turnId = String(event.turnId || '');
      if (turnId) {
        if (!byTurn.has(turnId)) byTurn.set(turnId, new Map());
        const turn = byTurn.get(turnId);
        if (!turn.has(stage)) turn.set(stage, value);
      }
    }
  }
  const stages = {};
  for (const [stage, values] of stageValues.entries()) stages[stage] = distribution(values);
  const deltaPairs = [
    ['request_received', 'provider_request_start', 'request_to_provider_start'],
    ['provider_request_start', 'first_provider_event', 'provider_start_to_first_provider_event'],
    ['first_provider_event', 'first_visible_token', 'provider_event_to_first_visible_token'],
    ['first_visible_token', 'provider_done', 'first_visible_token_to_provider_done'],
  ];
  const deltas = {};
  for (const [from, to, name] of deltaPairs) {
    const values = [];
    for (const turn of byTurn.values()) {
      if (turn.has(from) && turn.has(to)) values.push(Number(turn.get(to)) - Number(turn.get(from)));
    }
    deltas[name] = distribution(values);
  }
  return {
    available: true,
    windowDays: days,
    files,
    records,
    turns: byTurn.size,
    stages,
    deltas,
  };
}

function summarizeDesktopSamples(rows) {
  const cold = rows.filter((row) => row.cold?.page);
  const warm = rows.filter((row) => row.warmReload?.page);
  const field = (items, selector) => distribution(items.map(selector));
  return {
    samples: rows.length,
    cold: {
      navigationWallMs: field(cold, (row) => row.cold.navigationWallMs),
      domContentLoadedMs: field(cold, (row) => row.cold.page.navigation.domContentLoadedMs),
      fcpMs: field(cold, (row) => row.cold.page.fcpMs),
      decodedBytes: field(cold, (row) => row.cold.page.resources.decodedBytes),
      scriptDecodedBytes: field(cold, (row) => row.cold.page.resources.scriptDecodedBytes),
    },
    warmReload: {
      navigationWallMs: field(warm, (row) => row.warmReload.navigationWallMs),
      domContentLoadedMs: field(warm, (row) => row.warmReload.page.navigation.domContentLoadedMs),
      fcpMs: field(warm, (row) => row.warmReload.page.fcpMs),
      decodedBytes: field(warm, (row) => row.warmReload.page.resources.decodedBytes),
      scriptDecodedBytes: field(warm, (row) => row.warmReload.page.resources.scriptDecodedBytes),
    },
    threadOpenWallMs: field(rows, (row) => row.threadOpen?.wallMs),
    bgtasksRouteWallMs: field(rows, (row) => row.routes?.find((route) => route.route === 'bgtasks')?.result?.wallMs),
    chatRouteWallMs: field(rows, (row) => row.routes?.find((route) => route.route === 'chat')?.result?.wallMs),
    syntheticChatWallMs: field(rows, (row) => row.syntheticChat?.wallMs),
  };
}

const desktop = [];
for (let index = 0; index < samples; index += 1) {
  desktop.push(await runDesktopSample(index));
}

const mobile = skipMobile ? { skipped: true } : await runMobileSample();
const server = await readServerSnapshot();
const turnTiming = readTurnTimingSummary(numberArgument('log-days', 7, 1, 30));

let browserVersion = null;
try {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  browserVersion = browser.version();
  await browser.close();
} catch {}

console.log(JSON.stringify({
  benchmark: 'prometheus-performance',
  phase,
  capturedAt: new Date().toISOString(),
  conditions: {
    classification: 'local synthetic/browser-observed; no production traffic',
    sourceMode,
    urlOrigin: baseUrl.origin,
    viewport: { desktop: '1440x900', mobile: '390x844' },
    samples,
    startupWaitMs,
    mobileWaitMs,
    node: process.version,
    platform: process.platform + ' ' + os.release(),
    browser: browserVersion,
    playwright: 'playwright',
    desktopServiceWorkers: 'blocked',
  },
  desktop: {
    samples: desktop,
    aggregate: summarizeDesktopSamples(desktop),
  },
  mobile,
  server,
  turnTiming,
}, null, 2));
