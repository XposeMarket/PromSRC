import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const chartSource = read('web-ui/src/components/hub-usage-chart.js');
const cardSource = read('web-ui/src/components/provider-usage-card.js');
const hubSource = read('web-ui/src/pages/HubUsage.js');
const mobile = read('web-ui/src/mobile/mobile-hub-pages.js');
assert.match(mobile, /class="settings-models-usage pm-hub-limits"/);
assert.doesNotMatch(mobile.slice(mobile.indexOf('export async function renderHubPage'), mobile.indexOf('async function _renderMoreAudit')), /hub-goals|loadMobileHubGoals/);
assert.match(mobile, /providers\.map\(renderProviderUsageCard\)/);
assert.match(hubSource, /\['24h','7d','30d'\]/);
assert.match(hubSource, /usage-analytics\?range=\$\{range\}&provider=/);
assert.match(read('web-ui/src/pages/HubPage.js'), /import \{ renderProviderUsageCard \} from '..\/components\/provider-usage-card.js'/);
assert.match(read('web-ui/src/pages/SettingsPage.js'), /import \{ renderProviderUsageCard \} from '.\/HubPage.js'/);
// Small browser harness isolates transport; the actual renderers, DOM events and stylesheet run unchanged.
const escapeCode = `const escHtml = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); const esc = escHtml;`;
const strip = s => s.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<style>:root{--panel:#303642;--panel-2:#383e4d;--text:#eee;--muted:#abb1bf;--line:#4d5361;--brand:#8bc4d4}body{margin:0;background:#292f39;font:14px Arial;color:var(--text)}#hub-usage{padding:12px}</style><main id="hub-usage" class="hub-usage"></main><div id="cards"></div>');
  await page.addStyleTag({ content: read('web-ui/src/styles/hub.css') });
  const model = (provider, model, totalTokens) => ({ provider, model, totalTokens, requests: 7, inputTokens: 100, outputTokens: 40, cacheReadTokens: 70, cacheWriteTokens: 30, costMicros: 1230000, pricedRequests: 7, averageDurationMs: 1200 });
  const fixture = { success: true, providers: ['anthropic', 'openai_codex'], totals: { totalTokens: 4500, requests: 21, pricedRequests: 21, costMicros: 3000000, cacheHitPercent: 40 }, models: [model('anthropic', 'opus', 2200), model('anthropic', 'haiku', 1600), model('openai_codex', 'astra', 700)], series: Array.from({ length: 7 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 10, i + 1)).toISOString(), values: { 'anthropic/opus': [120, 300, 170, 430, 220, 520, 440][i], 'anthropic/haiku': [70, 220, 130, 180, 400, 280, 320][i], 'openai_codex/astra': [90, 60, 70, 190, 110, 80, 100][i] } })), agents: [], surfaces: [] };
  await page.evaluate(f => { window.fixture = f; window.requests = []; }, fixture);
  await page.addScriptTag({ content: `${escapeCode}\nconst {renderUsageLines,createChartState,modelLineColor}=(()=>{${strip(chartSource)};return {renderUsageLines,createChartState,modelLineColor}})();\nconst {renderProviderUsageCard}=(()=>{${strip(cardSource)};return {renderProviderUsageCard}})();\nconst api=async url=>{window.requests.push(url);if(window.fail)throw Error('offline');const p=new URL(url,'http://local').searchParams.get('provider');return {...window.fixture,models:window.fixture.models.filter(m=>!p||m.provider===p)}}; const hubProviderLogo=()=>'';\n${strip(hubSource)}\nwindow.test={renderUsageLines,createChartState,renderProviderUsageCard,modelLineColor,activateHubUsage};activateHubUsage();` });
  await page.waitForTimeout(100);
  assert.deepEqual(errors, [], 'browser script errors');
  assert.equal(await page.locator('#hu-status').innerText(), '', 'usage load/render status');
  await page.waitForSelector('.hu-model-line');
  assert.equal(await page.locator('.hu-model-line').count(), 3);
  assert.equal(await page.locator('#hu-chart rect').count(), 0);
  assert.equal(new Set(await page.locator('.hu-model-line').evaluateAll(els => els.map(e => e.getAttribute('stroke')))).size, 3);
  await page.locator('#hu-chart svg').click({ position: { x: 130, y: 110 } });
  assert.equal(await page.locator('.hu-point-popover').isVisible(), true);
  assert.match(await page.locator('[data-details]').innerText(), /tokens in this day/);
  assert.match(await page.locator('[data-details]').innerText(), /Model totals · selected 7d/);
  await page.locator('[data-close]').click();
  await page.locator('#hu-chart svg').press('ArrowRight');
  assert.equal(await page.locator('.hu-point-popover').isVisible(), true);
  await page.locator('#hu-chart svg').press('Escape');
  assert.equal(await page.locator('.hu-point-popover').isVisible(), false);
  await page.locator('[data-only="1"]').click();
  assert.equal(await page.locator('.hu-model-line').count(), 1);
  await page.locator('#hu-refresh').click();
  await page.waitForTimeout(40);
  assert.equal(await page.locator('.hu-model-line').count(), 1, 'model isolation survives refresh');
  await page.locator('[data-toggle="1"]').click();
  assert.match(await page.locator('#hu-chart').innerText(), /All models hidden/);
  await page.locator('[data-show-all]').click();
  assert.equal(await page.locator('.hu-model-line').count(), 3);
  await page.locator('[data-range="24h"]').click();
  await page.locator('#hu-provider').selectOption('anthropic');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.hu-model-line').count(), 2);
  assert.ok((await page.evaluate(() => window.requests)).includes('/api/hub/usage-analytics?range=24h&provider=anthropic'));
  await page.locator('[data-range="30d"]').click();
  await page.locator('#hu-provider').selectOption('');
  await page.waitForTimeout(30);
  assert.equal(await page.locator('.hu-model-line').count(), 3);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(70);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at${width}`);
    await page.locator('#hu-chart svg').press('Enter');
    const bounds = await page.locator('.hu-point-popover').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `popover fits${width}`);
    await page.locator('[data-close]').click();
  }
  await page.evaluate(() => { window.fail = true; });
  await page.locator('#hu-refresh').click();
  await page.waitForTimeout(30);
  assert.match(await page.locator('#hu-status').innerText(), /Showing previous results/);
  assert.equal(await page.locator('.hu-model-line').count(), 3);
  await page.evaluate(() => {
    const entries = [
      { provider: 'anthropic', account_id: 'one', account_label: 'Main', label: 'Anthropic · Claude', source: 'live', windows: [{ label: 'Weekly', used_percent: 95, reset_at: '2099-11-03T10:00:00Z' }] },
      { provider: 'anthropic', account_id: 'two', account_label: '<img src=x onerror=alert(1)>', source: 'tracked', error: '<script>bad</script>' },
    ];
    document.querySelector('#cards').innerHTML = entries.map(test.renderProviderUsageCard).join('');
  });
  assert.equal(await page.locator('#cards .usage-provider-card').count(), 2, 'two accounts from same provider retained');
  assert.equal(await page.locator('#cards script,#cards img').count(), 0);
  assert.match(await page.locator('#cards').innerText(), /resets Nov/);
  assert.match(await page.locator('#cards').innerText(), /Live limits unavailable/);
  await page.evaluate(() => {
    const m = { provider: '<b>provider</b>', model: '<img src=x>', requests: 1 };
    test.renderUsageLines(document.querySelector('#hu-chart'), [m], [{ timestamp: '2026-11-01', values: {} }], '7d', test.createChartState());
  });
  assert.equal(await page.locator('#hu-chart img').count(), 0);
  assert.equal(await page.locator('.hu-model-line').count(), 1, 'one zero bucket is supported');
  await page.evaluate(() => test.renderUsageLines(document.querySelector('#hu-chart'), [], [], '7d', test.createChartState()));
  assert.match(await page.locator('#hu-chart').innerText(), /No recorded calls/);
  assert.deepEqual(errors, []);
  console.log('PASS Hub model lines: touch/keyboard/popover, isolation/refresh, range/provider,320/390/1280,errors/empty,XSS,shared all-account cards');
} finally { await browser.close(); }
