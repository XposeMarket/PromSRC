import assert from 'node:assert/strict';
import fs from 'node:fs';

const baselineSha = '9fc966536b71aee88cd677265ebbebabf1f20adc';
const source = fs.readFileSync('web-ui/src/styles/mobile-liquid-glass-demo.css', 'utf8');
const generated = fs.readFileSync('generated/public-web-ui/static/styles/mobile-liquid-glass-demo.css', 'utf8');
const mobileBase = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
const sourceCode = source.replace(/\/\*[\s\S]*?\*\//g, '');

assert.equal(generated, source, 'generated mobile glass restore CSS must mirror source exactly');
assert.match(source, new RegExp(`Historical baseline: ${baselineSha}`));

for (const [name, value] of [
  ['--pm-lg-header-blur', '1.5px'],
  ['--pm-lg-pill-blur', '2.5px'],
  ['--pm-lg-panel-blur', '2px'],
  ['--pm-lg-shadow-y', '8px'],
  ['--pm-lg-shadow-blur', '56px'],
  ['--pm-lg-shadow-alpha', '.11'],
  ['--pm-lg-lens-inset', '-5px'],
  ['--pm-lg-lens-opacity', '.56'],
  ['--pm-lg-lens-scale', '1.054'],
  ['--pm-lg-lens-blur', '1.7px'],
  ['--pm-lg-lens-saturate', '1'],
  ['--pm-lg-lens-contrast', '.7'],
  ['--pm-lg-lens-brightness', '1.075'],
  ['--pm-lg-rim-width', '9px'],
]) {
  assert.ok(mobileBase.includes(`${name}: ${value};`), `August 12 base token drifted: ${name}`);
}

assert.match(mobileBase, /These layers were specific to the old panel treatment[\s\S]*?\.pm-composer > \.pm-glass-lens,[\s\S]*?\.pm-tabbar > \.pm-glass-lens,[\s\S]*?display:\s*none !important;/,
  'August 12 composer/tabbar decorative lens layers must stay hidden');
assert.match(mobileBase, /Mobile glass cleanup:[\s\S]*?remove the cast shadow behind floating glass surfaces/,
  'August 13 cleanup remains in base and must be narrowly overridden');

assert.match(sourceCode, /body\.pm-mobile-active \.pm-header\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/,
  '#163 clear header/safe-area contract must remain intact');

for (const selector of [
  '.pm-header > .pm-icon-btn',
  '.pm-header > .pm-haptic-host > .pm-icon-btn',
  '.pm-header-actions > .pm-icon-btn',
  '.pm-header .pm-online',
  '.pm-header-action-cluster',
  '.pm-completion-toast',
  '.pm-composer',
  '.pm-tabbar',
]) {
  assert.ok(source.includes(selector), `missing August 12 restore surface: ${selector}`);
}
assert.match(sourceCode, /\.pm-header-action-cluster \.pm-icon-btn,[\s\S]*?\.pm-header-action-cluster \.pm-icon-btn:hover\s*\{[\s\S]*?box-shadow:\s*none !important;/,
  'action-cluster child icons must remain shadowless instead of becoming nested glass buttons');
assert.match(sourceCode, /0 6px 16px rgba\(0,0,0,\.16\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.08\) !important;/,
  'light persistent chrome must restore pre-August-13 depth');
assert.match(sourceCode, /0 6px 16px rgba\(0,0,0,\.34\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.22\) !important;/,
  'dark persistent chrome must restore pre-August-13 depth');
assert.match(sourceCode, /\.pm-tab-indicator\s*\{[\s\S]*?0 8px 22px rgba\(40,28,16,\.18\),[\s\S]*?0 1px 4px rgba\(40,28,16,\.12\) !important;/,
  'tab selector must restore its light August 12 depth');
assert.match(sourceCode, /\.pm-tabbar\.pm-tabbar-pressing\s*\{[\s\S]*?0 20px 52px rgba\(0,0,0,\.24\),[\s\S]*?0 5px 14px rgba\(0,0,0,\.12\) !important;/,
  'tabbar press/drag must restore the lifted August 12 depth');

assert.doesNotMatch(sourceCode, /--pm-demo-|DEFAULT_SPEC|pm-demo-refract|saturate\(1\.0001\)|mask-image:\s*radial-gradient/,
  'later demo material/refraction override must stay out of the runtime layer');
assert.match(sourceCode, /\.pm-hamburger-liquid-glass-canvas\s*\{[\s\S]*?display:\s*none !important;/,
  'stale exact-canvas hamburger output must remain inert');
assert.doesNotMatch(sourceCode, /popover|msheet|attach-sheet|ctx-popover|chat-settings-popover/,
  'popover/sheet styling is outside this restore');

const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
assert.equal(generatedData, sourceData, 'generated mobile-data wrapper must mirror source');
assert.match(sourceData, /initMobileStatusBarTheme/,
  'mobile boot must preserve the lighter iOS/PWA status-edge bridge');
assert.match(sourceData, /pm-v303-2026-08-22-aug12-glass-status-edge/);
assert.match(sourceData, /PM_AUG12_GLASS_STYLE_VERSION = 'pm-v303-2026-08-22-aug12-glass-restore'/,
  'restored material must use a fresh cache key');
assert.doesNotMatch(sourceData, /mobile-hamburger-liquid-glass|initMobileHamburgerLiquidGlass/,
  'exact-canvas hamburger must not run on mobile boot');

const statusJs = fs.readFileSync('web-ui/src/mobile/mobile-status-bar-theme.js', 'utf8');
const statusJsGenerated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-status-bar-theme.js', 'utf8');
const statusCss = fs.readFileSync('web-ui/src/styles/mobile-status-bar-theme.css', 'utf8');
const statusCssGenerated = fs.readFileSync('generated/public-web-ui/static/styles/mobile-status-bar-theme.css', 'utf8');
assert.equal(statusJsGenerated, statusJs, 'generated status-edge JS must mirror source');
assert.equal(statusCssGenerated, statusCss, 'generated status-edge CSS must mirror source');
assert.match(statusJs, /--pm-mobile-native-chrome-color/);
assert.match(statusJs, /meta\[name="theme-color"\]/);
for (const signal of ['prom-theme-change', 'prom-appearance-change', 'pageshow', 'focus', 'visibilitychange']) {
  assert.ok(statusJs.includes(signal), `status edge must re-sync on ${signal}`);
}
assert.match(statusJs, /attributeFilter:\s*\['data-theme', 'data-skin'\]/);
assert.match(statusCss, /\.pm-mobile-status-edge-tint\s*\{[\s\S]*?z-index:\s*5;/,
  'status-edge tint must stay below header controls');
assert.match(mobileBase, /\.pm-header\s*\{[\s\S]*?z-index:\s*6;/,
  'mobile header must remain above the status-edge tint');
assert.match(statusCss, /-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;[\s\S]*?filter:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/,
  'status-edge bridge must preserve native WebKit blur without adding app blur/filter/shadow');

assert.match(source, /\.pm-title-row \.pm-title/);
assert.match(source, /\.pm-drawer-list \.pm-drawer-item > \.pm-flex/);

console.log('mobile chat glass matches August 12 while preserving the lighter native iOS/PWA status edge');
