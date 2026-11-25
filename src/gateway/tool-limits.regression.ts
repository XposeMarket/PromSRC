import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boundBrowserPageText, resolveBrowserPageTextLimits } from './browser-tools';
import { formatWindowList } from './desktop/window-mid';

// Regression: limits the model passes were ignored.
// - browser_observe(page_text) on the in-app browser returned a fixed 12,000
//   character slice regardless of max_chars / max_lines / query.
// - desktop_apps(list_windows) ignored limit.
// (prometheus_thread_ops list_projects limit is covered in
// src/gateway/projects/project-membership.regression.ts.)

const page = { title: 'Fixture', url: 'https://example.test/' };
const body = `Page: Fixture\nURL: https://example.test/\n\n${Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')}`;

const defaults = boundBrowserPageText(body, page);
assert.ok(defaults.length <= 6000, 'default max_chars is 6000');
assert.ok(defaults.split('\n').length <= 200, 'default max_lines is 200');

const small = boundBrowserPageText(body, page, { maxChars: 500 });
assert.ok(small.length <= 500, 'max_chars is honored');
const fewLines = boundBrowserPageText(body, page, { maxLines: 5 });
assert.equal(fewLines.split('\n').length, 5, 'max_lines is honored');
const filtered = boundBrowserPageText(body, page, { query: 'line 42 ' });
assert.match(filtered, /line 42 x/);
assert.doesNotMatch(filtered, /line 300 /, 'query filters lines');
assert.equal(boundBrowserPageText('', page), 'No readable text found on this page.');

// Small limits are honored exactly (no 200-character floor), and the empty-page
// fallback is held to the cap too.
assert.equal(boundBrowserPageText(body, page, { maxChars: 50 }).length, 50, 'max_chars 50 returns 50 characters');
assert.equal(boundBrowserPageText(body, page, { maxChars: 50.9 }).length, 50, 'fractional limits are floored');
assert.equal(boundBrowserPageText(body, page, { maxChars: '120' }).length, 120, 'numeric strings are accepted');
assert.equal(boundBrowserPageText('', page, { maxChars: 10 }), 'No readabl', 'fallback text is capped');
assert.equal(boundBrowserPageText(body, page, { maxChars: 10 }), 'Page: Fixt', 'a small cap does not turn real text into the fallback');
assert.equal(boundBrowserPageText(body, page, { maxChars: 999999 }).length <= 50000, true, 'upper cap stays');
// Zero, negative and non-numeric limits are rejected, not silently defaulted.
for (const [label, value] of [['max_chars', 0], ['max_chars', -5], ['max_chars', 'abc'], ['max_chars', Number.NaN], ['max_chars', 0.5]] as const) {
  const out = boundBrowserPageText(body, page, { maxChars: value });
  assert.match(out, new RegExp(`^ERROR: ${label} must be a positive number`), `max_chars ${String(value)} is rejected`);
}
assert.match(boundBrowserPageText(body, page, { maxLines: 0 }), /^ERROR: max_lines must be a positive number/);
assert.match(boundBrowserPageText(body, page, { maxLines: 'many' }), /^ERROR: max_lines must be a positive number/);
// Omitted limits use the defaults.
assert.deepEqual(resolveBrowserPageTextLimits({}), { maxChars: 6000, maxLines: 200 });
assert.deepEqual(resolveBrowserPageTextLimits({ maxChars: null, maxLines: '' }), { maxChars: 6000, maxLines: 200 });
// Both backends of browserGetPageText end in boundBrowserPageText and check the
// limits before reading the page.
const browserToolsSource = fs.readFileSync(path.join(__dirname, 'browser-tools.ts'), 'utf8');
const getPageText = browserToolsSource.slice(browserToolsSource.indexOf('export async function browserGetPageText('));
const getPageTextBody = getPageText.slice(0, getPageText.indexOf('\nexport '));
assert.equal((getPageTextBody.match(/return boundBrowserPageText\(/g) || []).length, 2, 'in-app and Playwright branches share the bounding');
assert.ok(getPageTextBody.indexOf('resolveBrowserPageTextLimits(options)') < getPageTextBody.indexOf('getInHouseSession(resolved)'), 'limits are validated first');

const windows = Array.from({ length: 7 }, (_, i) => ({
  windowId: `w${i}`, windowToken: `t${i}`, handle: i + 1, appId: 'app', processName: 'proc.exe', pid: 100 + i,
  processStartTime: 0, title: `Window ${i}`, bounds: { x: 0, y: 0, width: 10, height: 10 }, monitorIndex: 0, isActive: i === 0,
})) as any[];
const parse = (text: string) => JSON.parse(text.slice(text.indexOf('\n') + 1));
const limited = formatWindowList(windows, { limit: 3 });
assert.equal(parse(limited).length, 3, 'list_windows honors limit');
assert.match(limited.split('\n')[0], /3 shown of 7/);
assert.match(limited.split('\n')[0], /cursor=3/, 'result says more windows exist and how to page');
const nextPage = formatWindowList(windows, { limit: 3, cursor: 6 });
assert.deepEqual(parse(nextPage).map((w: any) => w.window_id), ['w6']);
assert.match(nextPage.split('\n')[0], /next_cursor=none/);
assert.equal(parse(formatWindowList(windows)).length, 7, 'default limit keeps small lists whole');

console.log('tool limits regression passed');
