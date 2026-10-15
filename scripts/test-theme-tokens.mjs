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
  assert.equal(blocksForSelectors(':root, :root[data-skin="light"] { --t-bg: x; }', ':root[data-skin="light"]').length, 1);
  assert.equal(countRaw('A{color: RGBA( 249, 115, 22, .2)}').orangeRgba, 1);
  assert.equal(countRaw('A{color: rgba(234, 106, 31, .2)}').emberRgba, 1);
  assert.throws(() => requireTokens('fixture', ['--t-bg: x;'], '--t-', ['bg', 'text']), /--t-text/);
  assert.throws(() => requireTokens('fixture bridge', ['--prom-bg: x;'], '--prom-', ['bg', 'accent']), /--prom-accent/);
}

function main() {
  runFixtures();
  const index = read('web-ui/index.html');
  const tokens = read('web-ui/src/styles/theme-tokens.css');
  const registry = read('web-ui/src/theme-registry.js');
  assert.ok(index.includes('src/theme-registry.js'), 'desktop loads shared registry');
  assert.ok(read('web-ui/mobile.html').includes('/src/theme-registry.js'), 'mobile loads shared registry');
  const registryMatch = registry.match(/window\.PROM_THEMES\s*=\s*\[([\s\S]*?)\];/);
  if (!registryMatch) fail('could not parse window.PROM_THEMES from web-ui/index.html');
  const skins = [...registryMatch[1].matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  if (!skins.length) fail('window.PROM_THEMES has no skins');
  const expectedSkins = [...new Set([...skins, 'custom'])];

  for (const skin of expectedSkins) {
    requireTokens(`skin ${skin}`, blocksForSelectors(tokens, `:root[data-skin="${skin}"]`), '--t-', requiredTokens);
  }
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
  assert.ok(blocksForSelectors(read('web-ui/src/styles/mobile.css'), ':root[data-skin="light"]').some((block) => /--pm-accent:\s*var\(--pm-p1-gold\)/.test(block)), 'mobile P1 palette uses canonical light ID');
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
  console.log(`Theme token guardrail passed: ${expectedSkins.length} skins × ${requiredTokens.length} semantic tokens, ${bridgeTokens.length} --prom bridges, raw accents at or below baseline.`);
}

main();
