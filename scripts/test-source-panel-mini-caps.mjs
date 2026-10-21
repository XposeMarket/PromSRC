// Behavioral checks for the compact, capped Sources peek and docked Sources panel.
// ChatPage.js is a classic global script, so we extract top-level function sources
// by name, evaluate them with small stubs, and assert on the rendered markup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'web-ui', 'src', 'pages', 'ChatPage.js'), 'utf8');

function extractFn(name) {
  const marker = `\nfunction ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`function ${name} not found in ChatPage.js`);
  let i = start + marker.length - 1; // index of the opening '('
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) break; }
  }
  const bodyStart = src.indexOf('{', i);
  depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start + 1, j + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function load(names, stubs) {
  const body = names.map(extractFn).join('\n');
  const keys = Object.keys(stubs);
  return new Function(...keys, `${body}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => stubs[k]));
}

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const encodeInlineJsString = (s) => JSON.stringify(String(s ?? ''));
const sourcePanelIconMarkup = (kind, label) => `<i data-kind="${kind}">${label}</i>`;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// ── Pure slice helpers ─────────────────────────────────────────────
const sliceFns = load(['sourcePanelMiniSlice', 'sourcePanelMiniToggleLabel', 'sourcePanelMiniDisplayTitle'], {});

test('6 items collapsed (3,8): 3 visible, 3 remaining, "+3 more"', () => {
  const items = [1, 2, 3, 4, 5, 6];
  const slice = sliceFns.sourcePanelMiniSlice(items, 3, 8, false);
  assert.equal(slice.visible.length, 3);
  assert.equal(slice.remaining, 3);
  assert.equal(slice.expandable, true);
  assert.equal(sliceFns.sourcePanelMiniToggleLabel(slice, false), '+3 more');
});

test('6 items expanded (3,8): 6 visible, "Show less"', () => {
  const items = [1, 2, 3, 4, 5, 6];
  const slice = sliceFns.sourcePanelMiniSlice(items, 3, 8, true);
  assert.equal(slice.visible.length, 6);
  assert.equal(sliceFns.sourcePanelMiniToggleLabel(slice, true), 'Show less');
});

test('3 items (3,8): not expandable, no label', () => {
  const slice = sliceFns.sourcePanelMiniSlice([1, 2, 3], 3, 8, false);
  assert.equal(slice.expandable, false);
  assert.equal(sliceFns.sourcePanelMiniToggleLabel(slice, false), '');
});

test('12 items expanded (3,8): capped at 8 visible', () => {
  const items = Array.from({ length: 12 }, (_, i) => i);
  const slice = sliceFns.sourcePanelMiniSlice(items, 3, 8, true);
  assert.equal(slice.visible.length, 8);
  assert.equal(slice.remaining, 4);
});

test('sourcePanelMiniDisplayTitle strips scheme and trailing slash only for URLs', () => {
  assert.equal(sliceFns.sourcePanelMiniDisplayTitle('https://example.com/a/'), 'example.com/a');
  assert.equal(sliceFns.sourcePanelMiniDisplayTitle('HTTP://Example.com'), 'Example.com');
  assert.equal(sliceFns.sourcePanelMiniDisplayTitle('notes.md'), 'notes.md');
});

// ── Environment (mini caps at 3 rows, full stays at 6) ────────────
const envItems = () => [
  { glyph: '⊞', label: 'Changes', value: '+1 -0' },
  { glyph: '▱', label: 'Local', value: 'clean' },
  { glyph: '⑂', label: 'main', value: 'main' },
  { glyph: '⇧', label: 'Commit or push', value: '' },
  { glyph: '◉', label: 'Pull request status', value: 'none' },
  { glyph: '↗', label: 'Compare branch', value: '' },
];

function envRenderer(expanded) {
  const sourcePanelState = { miniEnvExpanded: expanded };
  return load(
    ['sourcePanelMiniSlice', 'sourcePanelMiniToggleLabel', 'sourcePanelEnvironmentRowMarkup', 'renderSourcePanelEnvironment'],
    { escHtml, sourcePanelEnvironmentItems: envItems, sourcePanelState },
  ).renderSourcePanelEnvironment;
}

test('environment mini collapsed: 3 rows, "More" toggle', () => {
  const html = envRenderer(false)({}, { mini: true });
  assert.ok(html.includes('Changes'));
  assert.ok(html.includes('Local'));
  assert.ok(!html.includes('Compare branch'));
  assert.ok(!html.includes('Pull request status'));
  assert.ok(html.includes('>More<'));
});

test('environment mini expanded: all rows, "Less" toggle', () => {
  const html = envRenderer(true)({}, { mini: true });
  assert.ok(html.includes('Compare branch'));
  assert.ok(html.includes('>Less<'));
});

test('environment non-mini: all 6 rows, no mini toggle', () => {
  const html = envRenderer(false)({}, { mini: false });
  for (const label of ['Changes', 'Local', 'main', 'Commit or push', 'Pull request status', 'Compare branch']) {
    assert.ok(html.includes(label), `missing ${label}`);
  }
  assert.ok(!html.includes('source-panel-mini-more'));
});

// ── Processes (mini 2/8, full 4/all) ───────────────────────────────
function processItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `process:${i}`,
    title: `cmd ${i}`,
    status: 'running',
    cwd: '/tmp/work',
    run: { runId: `r${i}` },
  }));
}

function processRenderer(state) {
  return load(
    ['sourcePanelMiniSlice', 'sourcePanelMiniToggleLabel', 'sourcePanelProcessRowMarkup', 'renderSourcePanelProcesses'],
    { escHtml, encodeInlineJsString, sourcePanelIconMarkup, sourcePanelState: state },
  ).renderSourcePanelProcesses;
}

const countRows = (html) => (html.match(/source-panel-row--process/g) || []).length;

test('processes mini: 5 items collapsed show 2 and "+3 more"', () => {
  const html = processRenderer({ miniProcessExpanded: false, fullProcessExpanded: false })({ processes: processItems(5) }, { mini: true });
  assert.equal(countRows(html), 2);
  assert.ok(html.includes('+3 more'));
  assert.ok(html.includes('toggleSourcePanelMiniProcesses()'));
});

test('processes mini: 2 items show no toggle', () => {
  const html = processRenderer({ miniProcessExpanded: false, fullProcessExpanded: false })({ processes: processItems(2) }, { mini: true });
  assert.equal(countRows(html), 2);
  assert.ok(!html.includes('source-panel-mini-more'));
});

test('processes full: 6 items collapsed show 4 and "+2 more"', () => {
  const html = processRenderer({ miniProcessExpanded: false, fullProcessExpanded: false })({ processes: processItems(6) }, { mini: false });
  assert.equal(countRows(html), 4);
  assert.ok(html.includes('+2 more'));
  assert.ok(html.includes('toggleSourcePanelFullProcesses()'));
});

test('processes full: 3 items show no toggle', () => {
  const html = processRenderer({ miniProcessExpanded: false, fullProcessExpanded: false })({ processes: processItems(3) }, { mini: false });
  assert.equal(countRows(html), 3);
  assert.ok(!html.includes('source-panel-mini-more'));
});

// ── Live thoughts stream open (source-level: renderLiveTurnTrace has too many deps to stub) ──
test('live thought group is open while streaming (desktop parity with mobile)', () => {
  assert.ok(
    src.includes(`class="live-turn-thought-group"\${(openThoughts || streaming) ? ' open' : ''}`),
    'thought-group open condition must include streaming',
  );
});

console.log(`\n${passed} source-panel mini/caps checks passed`);
