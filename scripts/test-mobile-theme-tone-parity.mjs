#!/usr/bin/env node
/**
 * Mobile theme tone parity guardrail.
 *
 * Light palette themes (Olympus Day, Parchment, Daylight, custom light) set
 * data-theme="light". Mobile layout used to live inside
 * :root[data-theme="dark"] rules, so light themes silently lost fonts,
 * spacing, sizes and layout. The contract now is:
 *   - :root[data-theme="dark"] rules in the mobile stylesheets carry ONLY
 *     color/material declarations (and color custom properties);
 *   - structure lives under the tone-neutral :root[data-theme] gate;
 *   - light-tone color corrections live in mobile-light-tone.css and are all
 *     scoped to :root[data-tone="light"].
 * Also checks that visual iframes get plain colors Chart.js/Mermaid can parse.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const postcss = require('postcss');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const MOBILE_FILES = [
  'web-ui/src/styles/mobile.css',
  'web-ui/src/styles/mobile-shell.css',
  'web-ui/src/styles/mobile-composer-stack.css',
  'web-ui/src/styles/mobile-liquid-glass-demo.css',
];
// Declarations allowed in a dark-only rule: color and material, never layout.
const COLOR_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'background-blend-mode',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'outline',
  'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-block-color', 'border-inline-color', 'border-image', 'border-image-source',
  'box-shadow', 'text-shadow', 'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
  '-webkit-text-fill-color', '-webkit-text-stroke', '-webkit-text-stroke-color',
  'outline-color', 'caret-color', 'accent-color', 'text-decoration-color', 'column-rule-color',
  'scrollbar-color', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'opacity',
  'mix-blend-mode', 'color-scheme', '-webkit-tap-highlight-color', 'text-emphasis-color',
]);
const DARK_GATE = /\[data-theme=(["'])dark\1\]/;
const NOT_DARK = /:not\(\s*\[data-theme=(["'])dark\1\]\s*\)/g;
const BORDER_SHORTHAND = /^(border(-(top|right|bottom|left))?|outline)$/;
const STYLE_OR_WIDTH = /(^|\s)(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset|0|thin|medium|thick|[\d.]+(px|em|rem))(\s|$)/i;

const violations = [];
let gatedRules = 0;
for (const file of MOBILE_FILES) {
  const rootNode = postcss.parse(read(file), { from: file });
  rootNode.walkRules((rule) => {
    const gated = rule.selectors.some((sel) => DARK_GATE.test(sel.replace(NOT_DARK, '')));
    if (!gated) return;
    gatedRules++;
    rule.walkDecls((decl) => {
      if (decl.parent !== rule) return;
      const prop = decl.prop.toLowerCase();
      if (prop.startsWith('--') || COLOR_PROPS.has(prop)) return;
      violations.push(`${file}:${decl.source?.start?.line} ${prop} under ${rule.selector.replace(/\s+/g, ' ').slice(0, 120)}`);
    });
    // Border shorthands are fine only when the tone-neutral twin also sets
    // width/style; enforce that the structural part is not dark-only.
    rule.walkDecls((decl) => {
      if (decl.parent !== rule || !BORDER_SHORTHAND.test(decl.prop.toLowerCase())) return;
      if (!STYLE_OR_WIDTH.test(decl.value)) return;
      const twin = rule.prev();
      const prop = decl.prop.toLowerCase();
      const hasTwin = twin && twin.type === 'rule'
        && twin.selectors.join(',') === rule.selectors.map((s) => s.replace(/\[data-theme=(["'])dark\1\]/g, '[data-theme]')).join(',')
        && twin.nodes.some((n) => n.type === 'decl' && n.prop.toLowerCase().startsWith(`${prop}-`));
      if (!hasTwin) violations.push(`${file}:${decl.source?.start?.line} ${prop} width/style only in dark rule ${rule.selector.replace(/\s+/g, ' ').slice(0, 100)}`);
    });
  });
}
assert.ok(gatedRules > 100, `expected the mobile dark color layer to be found (saw ${gatedRules} rules)`);
assert.deepEqual(violations, [], `Layout/type declarations must not be dark-only on mobile (light themes lose them). Move them to a :root[data-theme] rule:\n${violations.join('\n')}`);

// Light-tone corrections must never leak onto dark themes.
const lightTone = postcss.parse(read('web-ui/src/styles/mobile-light-tone.css'));
let lightRules = 0;
lightTone.walkRules((rule) => {
  lightRules++;
  for (const sel of rule.selectors) {
    assert.match(sel.trim(), /^:root\[data-tone="light"\]/, `mobile-light-tone.css selector is not light-scoped: ${sel}`);
  }
});
assert.ok(lightRules >= 8, 'mobile-light-tone.css lost its light color layer');
assert.match(read('web-ui/src/styles/mobile.css'), /@import '\.\/mobile-light-tone\.css';/, 'mobile.css must import mobile-light-tone.css');

// The launcher icons and voice controls were the worst offenders; keep them covered.
const lightCss = read('web-ui/src/styles/mobile-light-tone.css');
for (const sel of ['.pm-chat-mode-button svg', '.pm-voice-control-btn', '.pm-voice-mode-toggle', '.pm-visual-save-btn', '.pm-drawer-item .pm-icon']) {
  assert.ok(lightCss.includes(sel), `mobile-light-tone.css must style ${sel}`);
}

// Visual iframes: theme colors must reach Chart.js/Mermaid as plain rgb()/hex.
const utils = read('web-ui/src/utils.js');
const fnSrc = utils.replace(/\r\n/g, '\n').match(/const legacyVisualColor[\s\S]*?\n}\nexport function plainVisualColor[\s\S]*?\n}\n/);
assert.ok(fnSrc, 'plainVisualColor helper missing from utils.js');
// eslint-disable-next-line no-new-func
const plainVisualColor = new Function(`${fnSrc[0].replace('export function', 'function')}; return plainVisualColor;`)();
assert.equal(plainVisualColor('#17140d'), '#17140d');
assert.equal(plainVisualColor('rgb(23, 20, 13)'), 'rgb(23, 20, 13)');
assert.equal(plainVisualColor('color(srgb 0.0902 0.0784 0.051)'), 'rgb(23, 20, 13)');
assert.equal(plainVisualColor('color(srgb 0.0902 0.0784 0.051 / 0.12)'), 'rgba(23, 20, 13, 0.12)');
assert.equal(plainVisualColor('color(srgb 1 1 1 / 50%)'), 'rgba(255, 255, 255, 0.5)');
assert.equal(plainVisualColor('color-mix(in srgb, red 10%, blue)'), '');
assert.match(utils, /cleanVisualCssValue\(resolveVisualColor\(value\), fallback\)/, 'readVisualTheme must resolve colors before handing them to visuals');
assert.match(utils, /isDark: \(root\.getAttribute\('data-tone'\) \|\| root\.getAttribute\('data-theme'\)\) === 'dark'/, 'visual isDark must follow data-tone');

console.log(`mobile theme tone parity: ${gatedRules} dark color rules, ${lightRules} light-tone rules, visual color normalization OK`);
