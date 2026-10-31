import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  throw new Error(`Playwright is required for thread-detail-summary DOM tests: ${error.message}`);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  renderer: path.join(rootDir, 'web-ui/src/features/chat/thread-detail-summary.js'),
  desktop: path.join(rootDir, 'web-ui/src/pages/ChatPage.js'),
  mobile: path.join(rootDir, 'web-ui/src/mobile/mobile-context-window.js'),
  endpoint: path.join(rootDir, 'src/gateway/routes/chat/sessions.ts'),
  currentState: path.join(rootDir, 'src/gateway/routes/chat/context-window.ts'),
};
const [rendererSource, desktopSource, mobileSource, endpointSource, stateSource] = await Promise.all(
  Object.values(paths).map((filename) => readFile(filename, 'utf8')),
);

// Keep the estimate labels tied to the values actually returned by the backend state contract.
const builderStart = stateSource.indexOf('export function buildContextWindowCurrentState');
assert.notEqual(builderStart, -1, 'currentState builder exists');
const builder = stateSource.slice(builderStart);
for (const field of ['latestProviderReportedInputTokens', 'latestProviderInputTokens', 'currentStateTokens']) {
  assert.match(builder, new RegExp(`\\b${field}\\b`), `currentState contract includes ${field}`);
}
assert.match(builder, /const latestProviderReportedInputTokens = hasCurrentHistory && lastCall\.source === 'provider'/,
  'reported input is sourced only from provider usage for sessions with history');
assert.match(builder, /const latestProviderInputTokens = hasCurrentHistory[\s\S]*?estimatedProviderInputTokens/,
  'request-estimate input is the estimated provider input in currentState');
assert.match(builder, /latestProviderInputTokens,\s*latestProviderReportedInputTokens,/,
  'the currentState return object exposes both source fields');
assert.match(endpointSource, /contextMeasurement:\s*currentState\.latestProviderReportedInputTokens\s*>\s*0\s*\?\s*'provider_reported'[\s\S]*?currentState\.latestProviderInputTokens\s*>\s*0\s*\?\s*'request_estimate'\s*:\s*'composition_estimate'/,
  'endpoint provenance maps the actual currentState fields, falling back to composition');
assert.match(endpointSource, /observedAt:\s*new Date\(\)\.toISOString\(\)/,
  'endpoint observation time is generated server-side');

// Verify each actual integration calls the shared renderer in its intended scope and gates by session.
assert.match(desktopSource, /import \{ renderThreadDetailSummary \} from '\.\.\/features\/chat\/thread-detail-summary\.js'/,
  'desktop imports the shared renderer');
assert.match(desktopSource, /const elements = getChatContextWindowElements\(target\);[\s\S]{0,300}?renderThreadDetailSummary\(elements\.popover,\s*data\?\.sessionId === sessionId \? data : null\)/,
  'desktop mounts in the targeted composer popover and rejects a different session snapshot');
assert.match(desktopSource, /source\?\.closest\('\.chat-input-area\[data-canonical-secondary-composer="1"\]'\)/,
  'desktop target resolution scopes the selected secondary composer');
assert.match(mobileSource, /import \{ renderThreadDetailSummary \} from '\.\.\/features\/chat\/thread-detail-summary\.js'/,
  'mobile imports the shared renderer');
assert.match(mobileSource, /renderThreadDetailSummary\(document\.getElementById\('pm-ctx-popover'\),\s*data\?\.sessionId === _lastSessionId \? data : null\)/,
  'mobile mounts in its context sheet and only accepts the active session snapshot');
console.log('PASS backend contract and desktop/mobile mount scope');

const browserPath = chromium.executablePath();
assert.ok(existsSync(browserPath), `Playwright Chromium exists at ${browserPath}`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body>
    <section class="chat-input-area" id="composer-a"><div class="chat-context-window-popover" id="desktop-a"></div></section>
    <section class="chat-input-area" id="composer-b"><div class="chat-context-window-popover" id="desktop-b"></div></section>
    <section id="pm-ctx-popover"></section>
  </body></html>`);
  await page.addScriptTag({
    type: 'module',
    content: `${rendererSource}\nwindow.__threadDetail = { threadDetailRows, renderThreadDetailSummary };`,
  });
  const behavior = await page.evaluate(() => {
    const { threadDetailRows, renderThreadDetailSummary } = window.__threadDetail;
    const now = Date.parse('2026-10-31T08:00:00.000Z');
    const base = {
      success: true,
      sessionId: 'session-a',
      profile: { providerId: 'provider-a', model: 'model-a' },
      observedAt: '2026-10-31T07:59:50.000Z',
      contextMeasurement: 'provider_reported',
    };
    const resultFor = (data) => threadDetailRows(data, now);
    const row = (rows, label) => rows.find(([key]) => key === label)?.[1];
    const freshness = {
      current: row(resultFor(base), 'Freshness'),
      stale: row(resultFor({ ...base, observedAt: '2026-10-31T07:58:00.000Z' }), 'Freshness'),
      missing: row(resultFor({ ...base, observedAt: undefined }), 'Freshness'),
      invalid: row(resultFor({ ...base, observedAt: 'not-a-date' }), 'Freshness'),
      future: row(resultFor({ ...base, observedAt: '2026-10-31T08:01:00.000Z' }), 'Freshness'),
      failed: row(resultFor({ ...base, success: false }), 'Freshness'),
    };
    const sources = ['provider_reported', 'request_estimate', 'composition_estimate', 'unrecognized']
      .map((contextMeasurement) => row(resultFor({ ...base, contextMeasurement }), 'Last-call / composition basis'));
    const unknowns = resultFor(null);
    const hostile = `<img id="injected" src=x onerror="window.__xss=1"> <script id="script-injected">window.__xss=2</script> 'quoted'`;
    const desktopTarget = document.querySelector('#composer-b .chat-context-window-popover');
    const desktopOther = document.querySelector('#desktop-a');
    const metrics = document.createElement('div');
    metrics.className = 'chat-context-window-metrics';
    metrics.textContent = 'existing context/account metrics';
    const breakdown = document.createElement('div');
    breakdown.className = 'chat-context-window-breakdown';
    breakdown.textContent = 'existing token breakdown';
    desktopTarget.append(metrics, breakdown);
    const markerHtml = [metrics.innerHTML, breakdown.innerHTML];
    const hostileData = { ...base, profile: { providerId: hostile, model: hostile } };
    renderThreadDetailSummary(desktopTarget, hostileData);
    const details = desktopTarget.querySelector('[data-thread-detail-summary]');
    const afterFirst = {
      detailsCount: desktopTarget.querySelectorAll('[data-thread-detail-summary]').length,
      summaryText: details?.querySelector('summary')?.textContent,
      hostileText: details?.textContent.includes(hostile),
      injectedElements: details?.querySelectorAll('#injected, #script-injected').length,
      scriptElements: details?.querySelectorAll('script').length,
      desktopOtherDetails: desktopOther.querySelectorAll('[data-thread-detail-summary]').length,
      metricsText: metrics.textContent,
      breakdownText: breakdown.textContent,
      metricsPreserved: metrics.innerHTML === markerHtml[0] && breakdown.innerHTML === markerHtml[1],
    };
    details.open = true;
    renderThreadDetailSummary(desktopTarget, { ...base, profile: { providerId: 'provider-b', model: 'model-b' } });
    const afterUpdate = {
      detailsCount: desktopTarget.querySelectorAll('[data-thread-detail-summary]').length,
      sameDetails: desktopTarget.querySelector('[data-thread-detail-summary]') === details,
      expanded: details.open,
      updatedText: details.textContent.includes('provider-b') && details.textContent.includes('model-b'),
      metricsPreserved: metrics.innerHTML === markerHtml[0] && breakdown.innerHTML === markerHtml[1],
    };
    renderThreadDetailSummary(desktopTarget, { ...base, profile: { providerId: 'provider-b', model: 'model-b' } });
    afterUpdate.detailsCountAfterSameSnapshot = desktopTarget.querySelectorAll('[data-thread-detail-summary]').length;

    // Exercise the same session gate used by the mobile mount with matching and non-matching snapshots.
    const mobileRoot = document.querySelector('#pm-ctx-popover');
    const activeSessionId = 'mobile-session';
    const mobileSnapshot = { ...base, sessionId: activeSessionId, profile: { providerId: 'mobile-provider', model: 'mobile-model' } };
    renderThreadDetailSummary(mobileRoot, mobileSnapshot.sessionId === activeSessionId ? mobileSnapshot : null);
    const mobileMatch = mobileRoot.textContent.includes('mobile-provider');
    mobileRoot.replaceChildren();
    const otherSnapshot = { ...mobileSnapshot, sessionId: 'different-session' };
    renderThreadDetailSummary(mobileRoot, otherSnapshot.sessionId === activeSessionId ? otherSnapshot : null);
    const mobileMismatchUnknown = mobileRoot.textContent.includes('Unknown') && !mobileRoot.textContent.includes('mobile-provider');
    return { freshness, sources, unknowns, afterFirst, afterUpdate, mobileMatch, mobileMismatchUnknown };
  });

  const includes = (value, text) => assert.ok(value.includes(text), `${JSON.stringify(value)} includes ${text}`);
  includes(behavior.freshness.current, 'Snapshot');
  assert.ok(!behavior.freshness.current.includes('Stale'), 'recent timestamp is current');
  includes(behavior.freshness.stale, 'Stale snapshot');
  for (const kind of ['missing', 'invalid', 'future', 'failed']) includes(behavior.freshness[kind], 'Unknown observation time');
  assert.deepEqual(behavior.sources.slice(0, 3), [
    'Provider-reported last-call input',
    'Estimated last-call input',
    'Estimated current composition',
  ]);
  assert.equal(behavior.sources[3], 'Unknown');
  assert.deepEqual(Object.fromEntries(behavior.unknowns.filter(([label]) => ['Provider', 'Model', 'Last-call / composition basis', 'Freshness'].includes(label))), {
    Provider: 'Unknown',
    Model: 'Unknown',
    'Last-call / composition basis': 'Unknown',
    Freshness: 'Unknown observation time',
  }, 'missing data remains unknown rather than zero');
  assert.equal(behavior.afterFirst.detailsCount, 1);
  assert.equal(behavior.afterFirst.summaryText, 'Thread details');
  assert.equal(behavior.afterFirst.hostileText, true, 'hostile profile strings are displayed literally');
  assert.equal(behavior.afterFirst.injectedElements, 0, 'hostile strings create no injected elements');
  assert.equal(behavior.afterFirst.scriptElements, 0, 'hostile strings create no scripts');
  assert.equal(behavior.afterFirst.desktopOtherDetails, 0, 'renderer is scoped to the selected desktop popover');
  assert.equal(behavior.afterFirst.metricsText, 'existing context/account metrics');
  assert.equal(behavior.afterFirst.breakdownText, 'existing token breakdown');
  assert.equal(behavior.afterFirst.metricsPreserved, true, 'existing metrics DOM remains untouched');
  assert.equal(behavior.afterUpdate.detailsCount, 1, 'rerender does not duplicate the section');
  assert.equal(behavior.afterUpdate.detailsCountAfterSameSnapshot, 1, 'same snapshot remains deduplicated');
  assert.equal(behavior.afterUpdate.sameDetails, true, 'rerender retains the native disclosure node');
  assert.equal(behavior.afterUpdate.expanded, true, 'expanded state survives data updates');
  assert.equal(behavior.afterUpdate.updatedText, true, 'changed snapshot values update in place');
  assert.equal(behavior.afterUpdate.metricsPreserved, true);
  assert.equal(behavior.mobileMatch, true, 'mobile renders the matching session snapshot');
  assert.equal(behavior.mobileMismatchUnknown, true, 'mobile rejects a different session snapshot');
  console.log('PASS timestamps, provenance labels, safe text-only DOM, single section, disclosure state, metrics preservation, desktop target and mobile session match');
} finally {
  await browser.close();
}
