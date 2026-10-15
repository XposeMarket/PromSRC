#!/usr/bin/env node
/**
 * Static Phase-1 theme-token contract guardrail.
 *
 * Keeps the registry, semantic contract, bridge aliases, loader order, and
 * raw-accent ratchet synchronized without evaluating application JavaScript.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = (message) => { throw new Error(`theme-token guardrail: ${message}`); };
const requiredTokens = [
  'bg', 'sidebar', 'surface', 'panel', 'raised', 'input', 'overlay',
  'border', 'border-strong', 'divider', 'text', 'text-2', 'muted',
  'text-on-accent', 'accent', 'accent-hover', 'accent-soft', 'accent-border',
  'accent-glow', 'focus-ring', 'ok', 'warn', 'err', 'info', 'font-ui',
  'font-display', 'font-mono', 'fs-xs', 'fs-sm', 'fs-md', 'fs-lg', 'fs-xl',
  'radius', 'shadow',
];
const bridgeTokens = [
  'bg', 'surface', 'surface-secondary', 'border', 'text', 'muted', 'accent',
  'success', 'warning', 'danger',
];
const rawPatterns = {
  orangeHex: /#f97316/gi,
  orangeRgba: /rgba\s*\(\s*249\s*,\s*115\s*,\s*22\s*,/gi,
  emberRgba: /rgba\s*\(\s*234\s*,\s*106\s*,\s*31\s*,/gi,
  goldHex: /#d6b75e/gi,
  blueHex: /#3d8bff/gi,
  violetHex: /#8b5cf6/gi,
};

function stripCssComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function blocksForSelectors(css, selector) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let match; (match = re.exec(stripCssComments(css))); ) {
    if (match[1].split(',').map((part) => part.trim()).includes(selector)) blocks.push(match[2]);
  }
  return blocks;
}
function declarations(blocks) {
  return new Set(blocks.flatMap((block) => [...block.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])));
}
function requireTokens(label, blocks, prefix, tokens) {
  const found = declarations(blocks);
  const missing = tokens.filter((token) => !found.has(`${prefix}${token}`));
  if (missing.length) fail(`${label} is missing ${missing.map((token) => `${prefix}${token}`).join(', ')}`);
}
function countRaw(css) {
  return Object.fromEntries(Object.entries(rawPatterns).map(([name, pattern]) => {
    pattern.lastIndex = 0;
    return [name, (css.match(pattern) || []).length];
  }));
}
function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? cssFiles(absolute) : entry.name.endsWith('.css') ? [absolute] : [];
  });
}
function normalize(relative) { return relative.split(path.sep).join('/'); }

function runFixtures() {
  assert.deepEqual([...declarations(['--t-bg: x; --t-text: y;'])].sort(), ['--t-bg', '--t-text']);
  assert.equal(blocksForSelectors(':root, :root[data-skin="p1"] { --t-bg: x; }', ':root[data-skin="p1"]').length, 1);
  assert.equal(countRaw('A{color: RGBA( 249, 115, 22, .2)}').orangeRgba, 1);
  assert.equal(countRaw('A{color: rgba(234, 106, 31, .2)}').emberRgba, 1);
  assert.throws(() => requireTokens('fixture', ['--t-bg: x;'], '--t-', ['bg', 'text']), /--t-text/);
  assert.throws(() => requireTokens('fixture bridge', ['--prom-bg: x;'], '--prom-', ['bg', 'accent']), /--prom-accent/);
}

// Executes theme-registry.js in a sandbox to prove the saved-theme migration
// never changes what an existing user sees.
async function runRegistryBehavior(source) {
  const vm = await import('node:vm');
  const boot = ({ saved, surface, schema }) => {
    const store = new Map();
    if (saved != null) store.set('prometheus_theme', saved);
    if (schema != null) store.set('prometheus_theme_schema', schema);
    const window = {
      location: { pathname: surface === 'mobile' ? '/mobile' : '/' },
      __PROM_SHOULD_BOOT_MOBILE: () => surface === 'mobile',
    };
    const localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
    vm.runInNewContext(source, { window, localStorage });
    return { window, store };
  };
  const cases = [
    // [saved, surface, expected read, expected persisted]
    ['light', 'desktop', 'p1', 'p1'],
    ['light', 'mobile', 'p1', 'p1'],
    ['dark', 'mobile', 'p1', 'p1'],       // mobile stored P1 as `dark`
    ['dark', 'desktop', 'dark', 'dark'],  // desktop Default Dark stays put
    ['blue', 'mobile', 'blue', 'blue'],
    ['custom', 'mobile', 'custom', 'custom'],
    [null, 'mobile', '', null],
  ];
  for (const [saved, surface, expected, persisted] of cases) {
    const { window, store } = boot({ saved, surface });
    assert.equal(window.PROM_READ_SAVED_THEME(), expected, `read ${saved} on ${surface}`);
    assert.equal(store.get('prometheus_theme') ?? null, persisted, `persisted ${saved} on ${surface}`);
    assert.equal(store.get('prometheus_theme_schema'), '2', `schema marked for ${saved} on ${surface}`);
  }
  // Migration is one-shot: once marked, a later mobile `dark` is not rewritten.
  const marked = boot({ saved: 'dark', surface: 'mobile', schema: '2' });
  assert.equal(marked.store.get('prometheus_theme'), 'dark');
  // Default Dark is desktop-only: mobile resolves it to P1 rather than showing it.
  const mobile = boot({ saved: null, surface: 'mobile' }).window;
  assert.ok(!mobile.PROM_THEMES.some((theme) => theme.id === 'dark'), 'mobile picker hides Default Dark');
  assert.equal(mobile.PROM_RESOLVE_THEME('dark').id, 'p1');
  assert.equal(mobile.PROM_RESOLVE_THEME('light').id, 'p1');
  const desktop = boot({ saved: null, surface: 'desktop' }).window;
  assert.ok(desktop.PROM_THEMES.some((theme) => theme.id === 'dark'), 'desktop keeps Default Dark');
  for (const theme of desktop.PROM_ALL_THEMES) {
    for (const key of ['id', 'label', 'base', 'description', 'surfaces', 'statusBar', 'chromeAccent']) {
      assert.ok(Object.hasOwn(theme, key), `registry theme ${theme.id} defines ${key}`);
    }
  }
}

// Palette presets, Match system, contrast, loading words, share codes and
// VS Code import all live in theme-registry.js; exercise them in a sandbox.
async function runThemeEngineBehavior(source) {
  const vm = await import('node:vm');
  const boot = ({ saved = null, prefersDark = true, appearance = null, surface = 'desktop' } = {}) => {
    const store = new Map();
    if (saved != null) store.set('prometheus_theme', saved);
    if (appearance) store.set('prometheus_appearance_v1', JSON.stringify(appearance));
    store.set('prometheus_theme_schema', '2');
    const attrs = new Map();
    const props = new Map();
    const documentElement = {
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      style: { setProperty: (k, v) => props.set(k, String(v)), removeProperty: (k) => props.delete(k) },
    };
    const listeners = [];
    const document = { documentElement, addEventListener: (type, fn) => listeners.push([type, fn]), dispatchEvent: () => true };
    const window = {
      location: { pathname: surface === 'mobile' ? '/mobile' : '/' },
      __PROM_SHOULD_BOOT_MOBILE: () => surface === 'mobile',
      matchMedia: () => ({ matches: prefersDark, addEventListener: () => {} }),
    };
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    vm.runInNewContext(source, { window, localStorage, document, CustomEvent: class {} });
    return { window, store, attrs, props };
  };

  // Every palette preset is complete, readable, and paints before first frame.
  const { window, attrs, props } = boot({ saved: 'ares' });
  const engine = window.PROM_THEME_ENGINE;
  assert.equal(attrs.get('data-skin'), 'ares', 'saved palette theme paints at registry load');
  assert.equal(attrs.get('data-skin-kind'), 'palette');
  assert.equal(props.get('--skin-accent'), '#cd7f32');
  for (const theme of window.PROM_ALL_THEMES.filter((t) => t.kind === 'palette')) {
    const p = theme.palette;
    for (const key of engine.paletteKeys) assert.match(p[key], /^#[0-9a-f]{6}$/, `${theme.id}.${key} is a hex color`);
    assert.ok(engine.contrastRatio(p.text, p.bg) >= 7, `${theme.id} body text contrast ${engine.contrastRatio(p.text, p.bg).toFixed(2)} >= 7`);
    assert.ok(engine.contrastRatio(p.muted, p.bg) >= 3.5, `${theme.id} muted contrast ${engine.contrastRatio(p.muted, p.bg).toFixed(2)} >= 3.5`);
    assert.ok(engine.contrastRatio(p.ink, p.accent) >= 3, `${theme.id} accent ink contrast ${engine.contrastRatio(p.ink, p.accent).toFixed(2)} >= 3`);
    assert.equal(engine.toneOf(p.bg), theme.tone, `${theme.id} declared tone matches its background`);
    assert.ok(theme.loadingWords.length >= 2, `${theme.id} has loading words`);
    assert.ok(theme.surfaces.includes('desktop') && theme.surfaces.includes('mobile'), `${theme.id} ships on both surfaces`);
  }
  // Light palettes report a light base so dark-only CSS paths do not apply.
  const day = boot({ saved: 'olympus-day' });
  assert.equal(day.attrs.get('data-theme'), 'light');
  assert.equal(day.attrs.get('data-tone'), 'light');

  // Match system follows the OS and remembers the user's picks.
  const sysDark = boot({ saved: 'system', prefersDark: true });
  assert.equal(sysDark.attrs.get('data-skin'), 'p1');
  assert.equal(sysDark.attrs.get('data-theme-choice'), 'system');
  const sysLight = boot({ saved: 'system', prefersDark: false, appearance: { systemLight: 'parchment' } });
  assert.equal(sysLight.attrs.get('data-skin'), 'parchment');
  assert.equal(sysLight.window.PROM_READ_SAVED_THEME(), 'system');
  const badPick = boot({ saved: 'system', prefersDark: false, appearance: { systemLight: 'ares' } });
  assert.equal(badPick.attrs.get('data-skin'), 'olympus-day', 'a dark theme cannot be the light pick');

  // Contrast is clamped and exposed to CSS as 0..1.
  assert.equal(boot({ saved: 'kiln', appearance: { contrast: 250 } }).props.get('--skin-contrast'), '1');

  // Loading words: themed, deterministic per key, and switchable off.
  const word = engine.loadingWord('msg-1');
  assert.match(word, /^(Forging|Marching|Tempering steel|Sharpening the blade)…$/);
  assert.equal(engine.loadingWord('msg-1'), word, 'same message keeps the same word');
  assert.equal(boot({ saved: 'ares', appearance: { loadingWords: false } }).window.PROM_THEME_ENGINE.loadingWord('x'), '');
  const hostile = engine.loadingWordHtml('x', 'a"><script>', 'script');
  assert.ok(!/<script|"></.test(hostile) && /^<span class="ascript" aria-live="off">[^<>]+<\/span>$/.test(hostile), `loading word html never emits markup from args: ${hostile}`);

  // Share codes round-trip and reject garbage.
  const code = engine.encodeShareCode(window.PROM_RESOLVE_THEME('hearth').palette, { name: 'Hearth & co', contrast: 72 });
  assert.match(code, /^PROM1-[0-9a-f]{44}-/);
  const decoded = engine.decodeShareCode(code);
  assert.equal(decoded.name, 'Hearth & co');
  assert.equal(decoded.contrast, 72);
  assert.deepEqual({ ...decoded.palette }, { ...window.PROM_RESOLVE_THEME('hearth').palette });
  assert.equal(engine.decodeShareCode('PROM1-zz'), null);
  assert.equal(engine.decodeShareCode('hello'), null);

  // VS Code import: JSONC with comments, trailing commas and #rrggbbaa.
  const vscode = `{
    // Tokyo-ish
    "name": "Night Test", "type": "dark",
    "colors": {
      "editor.background": "#1a1b26", "editor.foreground": "#c0caf5",
      "sideBar.background": "#16161eff", "button.background": "#3d59a1",
      "descriptionForeground": "#7f86a8", /* trailing */
    },
  }`;
  const imported = engine.importVsCodeTheme(vscode);
  assert.equal(imported.name, 'Night Test');
  assert.equal(imported.palette.bg, '#1a1b26');
  assert.equal(imported.palette.sidebar, '#16161e');
  assert.equal(imported.palette.accent, '#3d59a1');
  assert.equal(imported.palette.ink, '#ffffff', 'ink is derived for readability');
  assert.match(engine.importVsCodeTheme('{').error, /valid theme JSON/);
  assert.match(engine.importVsCodeTheme('{"tokenColors":[]}').error, /colors/);

  // importTheme writes the custom theme without clobbering other appearance prefs.
  const imp = boot({ saved: 'p1', appearance: { backgroundEffects: true, custom: { font: 'Inter' } } });
  const result = imp.window.PROM_THEME_ENGINE.importTheme(code);
  assert.equal(result.ok, true);
  const stored = JSON.parse(imp.store.get('prometheus_appearance_v1'));
  assert.equal(stored.backgroundEffects, true);
  assert.equal(stored.custom.font, 'Inter');
  assert.equal(stored.custom.accent, window.PROM_RESOLVE_THEME('hearth').palette.accent);
  assert.equal(stored.custom.contrast, 72);
  assert.equal(imp.window.PROM_THEME_ENGINE.palette('custom').sidebar, window.PROM_RESOLVE_THEME('hearth').palette.sidebar);
}

// Phase 4-6 ratchets: typography, legacy ids, and single-writer theme attributes.
function runArchitectureGuards(actualFiles) {
  const stylesRoot = path.join(root, 'web-ui/src/styles');
  const offenders = [];
  for (const relative of Object.keys(actualFiles)) {
    if (relative.endsWith('/theme-tokens.css')) continue;
    // Blank out comments but keep their newlines so reported line numbers are real.
    const css = fs.readFileSync(path.join(root, relative), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    const lines = css.split('\n');
    lines.forEach((line, index) => {
      const where = `${relative}:${index + 1}`;
      if (/data-skin=["']?light["'\]]/.test(line)) offenders.push(`${where} uses legacy data-skin="light" (use p1)`);
      if (/^\s*--[\w-]+\s*:/.test(line)) return;
      if (/['"]Manrope['"]\s*,\s*sans-serif/.test(line)) offenders.push(`${where} hard-codes Manrope (use var(--t-font-ui))`);
      if (/font-family:\s*[^;]*(Plex Mono|JetBrains Mono|SFMono|Menlo|Consolas)/i.test(line) && !/var\(/.test(line)) offenders.push(`${where} hard-codes a mono stack (use var(--t-font-mono))`);
      if (/(^|\/)mobile[\w-]*\.css$/.test(relative) && /\bfont(-size)?:[^;]*\b(\d|10|10\.5|9\.5)px/.test(line) && /\bfont(-size)?:\s*(\d{3}\s+)?(\d|10|10\.5|9\.5)px/.test(line)) offenders.push(`${where} sets mobile text below the 11px floor (use var(--t-fs-2xs))`);
    });
  }
  const tokens = read('web-ui/src/styles/theme-tokens.css');
  for (const token of ['--t-fs-2xs', '--theme-font-ui', '--theme-font-mono', '--theme-palette-blue', '--theme-palette-violet']) {
    if (!tokens.includes(`${token}:`)) offenders.push(`theme-tokens.css must define ${token}`);
  }
  const jsRoots = ['web-ui/src', 'web-ui/index.html', 'web-ui/mobile.html'];
  const jsFiles = [];
  const walk = (absolute) => {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute)) if (!['vendor', 'generated', 'build'].includes(name)) walk(path.join(absolute, name));
    } else if (/\.(js|html)$/.test(absolute)) jsFiles.push(absolute);
  };
  for (const entry of jsRoots) walk(path.join(root, entry));
  for (const absolute of jsFiles) {
    const relative = normalize(path.relative(root, absolute));
    const source = fs.readFileSync(absolute, 'utf8');
    if (relative === 'web-ui/src/theme-registry.js') continue;
    const writes = source.match(/setAttribute\(\s*['"]data-skin['"]/g) || [];
    const guarded = source.match(/PROM_APPLY_THEME_ATTRIBUTES/g) || [];
    if (writes.length > guarded.length) offenders.push(`${relative} writes data-skin without PROM_APPLY_THEME_ATTRIBUTES (${writes.length} writes, ${guarded.length} registry calls)`);
    if (/getAttribute\(\s*['"]data-skin['"]\s*\)\s*\|\|\s*['"]light['"]/.test(source)) offenders.push(`${relative} falls back to legacy skin id light`);
  }
  if (offenders.length) fail(`architecture ratchet failed:\n  ${offenders.slice(0, 40).join('\n  ')}`);
  void stylesRoot;
}

async function main() {
  runFixtures();
  const index = read('web-ui/index.html');
  const tokens = read('web-ui/src/styles/theme-tokens.css');
  const registry = read('web-ui/src/theme-registry.js');
  assert.ok(index.includes('src/theme-registry.js'), 'desktop loads shared registry');
  assert.ok(read('web-ui/mobile.html').includes('/src/theme-registry.js'), 'mobile loads shared registry');
  // Evaluate the registry instead of regex-parsing it: palette presets are
  // declared positionally (preset('ares', ...)), not with `id:` keys.
  const { window: registryWindow } = await (async () => {
    const vm = await import('node:vm');
    const store = new Map();
    const window = { location: { pathname: '/' }, __PROM_SHOULD_BOOT_MOBILE: () => false };
    vm.runInNewContext(registry, { window, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
    return { window };
  })();
  const allThemes = registryWindow.PROM_ALL_THEMES || [];
  const skins = allThemes.map((theme) => theme.id);
  if (!skins.length) fail('theme registry has no skins');
  if (skins.includes('light')) fail('Prometheus One must use canonical id p1, not light');
  if (skins[0] !== 'p1') fail('Prometheus One (p1) must be the first/default registry theme');
  await runRegistryBehavior(registry);
  await runThemeEngineBehavior(registry);
  const legacySkins = allThemes.filter((theme) => theme.kind !== 'palette').map((theme) => theme.id);
  const paletteSkins = allThemes.filter((theme) => theme.kind === 'palette').map((theme) => theme.id);

  for (const skin of [...legacySkins, 'custom']) {
    requireTokens(`skin ${skin}`, blocksForSelectors(tokens, `:root[data-skin="${skin}"]`), '--t-', requiredTokens);
  }
  // Palette themes: one shared semantic block plus the derived desktop/mobile layers.
  requireTokens('palette skins', blocksForSelectors(tokens, ':root[data-skin-kind="palette"]'), '--t-', requiredTokens);
  const paletteDesktop = declarations(blocksForSelectors(tokens, ':root[data-skin-kind="palette"][data-skin]'));
  for (const token of ['--bg', '--panel', '--panel-2', '--line', '--text', '--muted', '--brand', '--sidebar-bg', '--composer-bg']) {
    if (!paletteDesktop.has(token)) fail(`palette desktop layer must derive ${token}`);
  }
  const paletteMobile = declarations(blocksForSelectors(read('web-ui/src/styles/mobile-shell.css'), ':root[data-skin-kind="palette"][data-skin]'));
  for (const token of ['--pm-bg', '--pm-surface', '--pm-border', '--pm-text', '--pm-muted', '--pm-accent', '--pm-orange']) {
    if (!paletteMobile.has(token)) fail(`palette mobile layer must derive ${token}`);
  }
  if (paletteSkins.length < 12) fail(`expected the 12-theme pack, found ${paletteSkins.length} palette presets`);
  requireTokens('common :root bridge', blocksForSelectors(tokens, ':root'), '--prom-', bridgeTokens);
  for (const mobileSelector of [':root:has(body.pm-mobile-active)', 'body.pm-mobile-active']) {
    requireTokens(`mobile semantic aliases (${mobileSelector})`, blocksForSelectors(tokens, mobileSelector), '--t-', requiredTokens);
  }
  requireTokens('mobile bridge aliases', blocksForSelectors(tokens, 'body.pm-mobile-active'), '--prom-', bridgeTokens);

  const loaderMatch = index.match(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']*theme-tokens\.css[^"']*)["'][^>]*>/i);
  if (!loaderMatch) fail('web-ui/index.html does not load theme-tokens.css');
  const firstStylesheet = index.match(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*>/i);
  if (!firstStylesheet || !/theme-tokens\.css/i.test(firstStylesheet[1])) fail('theme-tokens.css must be the first stylesheet loaded by index.html');
  const desktopEntry = read('web-ui/src/styles/desktop-entry.css');
  const firstImport = desktopEntry.match(/^\s*@import\s+['"]([^'"]+)['"];?/m);
  if (!firstImport || firstImport[1] !== './theme-tokens.css') fail('desktop-entry.css must import ./theme-tokens.css first');

  const mobileEntry = read('web-ui/src/styles/mobile-entry.css');
  if (mobileEntry.match(/^\s*@import\s+['"]([^'"]+)['"];?/m)?.[1] !== './theme-tokens.css') fail('mobile-entry.css must import theme-tokens.css first');
  const mobileIndex = read('web-ui/mobile.html');
  if (!/theme-tokens\.css/.test(mobileIndex.match(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*>/i)?.[1] || '')) fail('mobile.html must load theme-tokens.css first');
  const owners = read('web-ui/src/mobile/mobile-style-owners.js');
  if (owners.match(/shell:\s*Object\.freeze\(\[\s*Object\.freeze\(\{[\s\S]*?file:\s*['"]([^'"]+)['"]/m)?.[1] !== 'theme-tokens.css') fail('mobile shell must own theme-tokens.css first');

  const baseline = JSON.parse(read('scripts/theme-token-raw-accent-baseline.json'));
  const stylesRoot = path.join(root, 'web-ui/src/styles');
  assert.ok(baseline.exceptions, 'remaining raw entries must document their exception');
  for (const relative of Object.keys(baseline.files)) assert.ok(baseline.exceptions[relative], `missing exception rationale: ${relative}`);
  const mobileShell = read('web-ui/src/mobile/mobile-shell.js');
  assert.ok(!/\.\.\.p1,\s*id:\s*['"]dark/.test(mobileShell), 'mobile must not remap P1 to dark');
  assert.ok(blocksForSelectors(read('web-ui/src/styles/mobile.css'), ':root[data-skin="p1"]').some((block) => /--pm-accent:\s*var\(--pm-p1-gold\)/.test(block)), 'mobile P1 palette uses canonical p1 ID');
  const actualFiles = Object.fromEntries(cssFiles(stylesRoot).map((absolute) => {
    const relative = normalize(path.relative(root, absolute));
    return [relative, countRaw(fs.readFileSync(absolute, 'utf8'))];
  }));
  for (const [name, baselineTotal] of Object.entries(baseline.totals)) {
    const actualTotal = Object.values(actualFiles).reduce((sum, file) => sum + (file[name] || 0), 0);
    if (actualTotal > baselineTotal) fail(`raw ${name} increased from ${baselineTotal} to ${actualTotal}`);
  }
  for (const [relative, expected] of Object.entries(baseline.files)) {
    const actual = actualFiles[relative] || Object.fromEntries(Object.keys(rawPatterns).map((name) => [name, 0]));
    for (const [name, expectedCount] of Object.entries(expected)) {
      if ((actual[name] || 0) > expectedCount) fail(`raw ${name} in ${relative} increased from ${expectedCount} to ${actual[name] || 0}`);
    }
  }
  for (const [relative, actual] of Object.entries(actualFiles)) {
    if (Object.hasOwn(baseline.files, relative)) continue;
    for (const [name, count] of Object.entries(actual)) {
      if (count > 0) fail(`new stylesheet ${relative} introduces ${count} raw ${name} literal(s); use semantic tokens or add a reviewed baseline`);
    }
  }
  runArchitectureGuards(actualFiles);
  console.log(`Theme token guardrail passed: ${legacySkins.length + 1} legacy skins + ${paletteSkins.length} palette presets × ${requiredTokens.length} semantic tokens, ${bridgeTokens.length} --prom bridges, theme engine behavior, raw accents at or below baseline.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
