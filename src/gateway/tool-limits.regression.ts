import assert from 'node:assert/strict';
import { boundBrowserPageText } from './browser-tools';
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
