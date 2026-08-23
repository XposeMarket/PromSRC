import assert from 'node:assert/strict';
import fs from 'node:fs';

const baselineSha = '9fc966536b71aee88cd677265ebbebabf1f20adc';
const sourcePath = 'web-ui/src/styles/mobile-liquid-glass-demo.css';
const generatedPath = 'generated/public-web-ui/static/styles/mobile-liquid-glass-demo.css';
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');
const mobileBase = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
const sourceCode = source.replace(/\/\*[\s\S]*?\*\//g, '');

assert.equal(generated, source, 'generated mobile glass restore CSS must mirror source exactly');
assert.match(source, new RegExp(`Historical baseline: ${baselineSha}`),
  'the restore layer must pin the exact August 12 historical baseline');

// The underlying mobile.css still owns the August 12 material. Lock the optical
// values that matter so this late compatibility layer cannot silently drift.
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
assert.match(mobileBase, /\.pm-header \.pm-icon-btn\s*\{[\s\S]*?background:\s*rgba\(255,255,255,\.025\);[\s\S]*?blur\(var\(--pm-lg-header-blur/,
  'header buttons must still use the historical low-blur material in mobile.css');
assert.match(mobileBase, /\.pm-glass-lens\s*\{[\s\S]*?inset:\s*var\(--pm-lg-lens-inset[\s\S]*?transform:\s*scale\(var\(--pm-lg-lens-scale/,
  'historical refraction vocabulary must remain intact in mobile.css');
assert.match(mobileBase, /These layers were specific to the old panel treatment[\s\S]*?\.pm-composer > \.pm-glass-lens,[\s\S]*?\.pm-tabbar > \.pm-glass-lens,[\s\S]*?display:\s*none !important;/,
  'August 12 composer/tabbar decorative lens layers must stay hidden by the base material');
assert.match(mobileBase, /Mobile glass cleanup:[\s\S]*?remove the cast shadow behind floating glass surfaces/,
  'the later August 13 shadow cleanup is expected to remain in mobile.css and be narrowly overridden here');

// Preserve #163's clear header/safe-area contract. The lighter native status
// edge from #181 is tested separately below and must never become header blur.
assert.match(sourceCode, /body\.pm-mobile-active \.pm-header\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/,
  'iOS/PWA header safe-area must remain transparent and header-blur-free');

// Restore exactly the pre-August-13 depth for persistent chrome. Standalone
// header buttons are explicit so the shared action pill never becomes nested
// glass buttons.
for (const selector of [
  '.pm-header > .pm-icon-btn',
  '.pm-header > .pm-haptic-host > .pm-icon-btn',
  '.pm-header-actions > .pm-icon-btn',
  '.pm-header-actions > .pm-haptic-host > .pm-icon-btn',
  '.pm-header .pm-online',
  '.pm-header-action-cluster',
  '.pm-completion-toast',
  '.pm-composer',
  '.pm-tabbar',
]) {
  assert.ok(source.includes(selector), `missing August 12 shadow restore surface: ${selector}`);
}
assert.doesNotMatch(sourceCode, /body\.pm-mobile-active :is\([\s\S]*?^\s*\.pm-header \.pm-icon-btn,/m,
  'shadow restore must not broadly target nested header icon buttons');
assert.match(sourceCode, /\.pm-header-action-cluster \.pm-icon-btn,[\s\S]*?\.pm-header-action-cluster \.pm-icon-btn:hover\s*\{[\s\S]*?box-shadow:\s*none !important;/,
  'shared action-pill child buttons must remain shadowless');
assert.match(sourceCode, /inset 0 1px 1px rgba\(255,255,255,\.38\),[\s\S]*?inset 0 -1px 1px rgba\(255,255,255,\.18\),[\s\S]*?0 6px 16px rgba\(0,0,0,\.16\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.08\) !important;/,
  'light persistent glass must restore the August 12 cast-shadow recipe');
assert.match(sourceCode, /inset 0 1px 1px rgba\(255,255,255,\.16\),[\s\S]*?inset 0 -1px 1px rgba\(255,255,255,\.07\),[\s\S]*?0 6px 16px rgba\(0,0,0,\.34\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.22\) !important;/,
  'dark persistent glass must restore the August 12 cast-shadow recipe');
assert.match(sourceCode, /\.pm-tab-indicator\s*\{[\s\S]*?inset 0 1\.5px 1\.5px rgba\(255,255,255,\.34\),[\s\S]*?0 8px 22px rgba\(40,28,16,\.18\),[\s\S]*?0 1px 4px rgba\(40,28,16,\.12\) !important;/,
  'tab selector must restore its August 12 light floating depth');
assert.match(sourceCode, /data-theme="dark"[\s\S]*?\.pm-tab-indicator\s*\{[\s\S]*?inset 0 1\.5px 1\.5px rgba\(255,255,255,\.24\),[\s\S]*?0 8px 22px rgba\(0,0,0,\.42\) !important;/,
  'tab selector must restore its August 12 dark floating depth');
assert.match(sourceCode, /\.pm-tabbar\.pm-tabbar-pressing\s*\{[\s\S]*?inset 0 1\.5px 1px rgba\(255,255,255,\.36\),[\s\S]*?inset 0 -10px 26px rgba\(255,255,255,\.05\),[\s\S]*?0 20px 52px rgba\(0,0,0,\.24\),[\s\S]*?0 5px 14px rgba\(0,0,0,\.12\) !important;/,
  'tabbar press/drag must restore the August 12 lifted glass depth');

// The later live-demo material and exact-canvas hamburger are deliberately no
// longer part of the runtime path. Their files may remain for archaeology.
assert.doesNotMatch(sourceCode, /--pm-demo-|DEFAULT_SPEC|pm-demo-refract|saturate\(1\.0001\)|mask-image:\s*radial-gradient/,
  'late glass layer must not retain the later live-demo material/refraction override');
const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
assert.equal(generatedData, sourceData, 'generated mobile-data wrapper must mirror source exactly');
assert.match(sourceData, /initMobileStatusBarTheme/,
  'mobile boot must preserve the lighter iOS/PWA status-edge bridge');
assert.match(sourceData, /pm-v303-2026-08-22-aug12-glass-status-edge/,
  'status-edge module must use the combined restore cache key');
assert.match(sourceData, /PM_AUG12_GLASS_STYLE_VERSION = 'pm-v303-2026-08-22-aug12-glass-restore'/,
  'restored material stylesheet must be cache-busted independently of the old demo key');
assert.match(sourceData, /pm-mobile-demo-glass-style/,
  'mobile wrapper must refresh the already-injected material stylesheet');
assert.doesNotMatch(sourceData, /mobile-hamburger-liquid-glass|initMobileHamburgerLiquidGlass/,
  'exact-canvas hamburger must not run on mobile boot');
assert.match(sourceCode, /\.pm-hamburger-liquid-glass-canvas\s*\{[\s\S]*?display:\s*none !important;/,
  'a stale exact-canvas child must remain inert after a hot update');

// Bring forward #181's lighter, theme-aware iOS status edge without importing
// its hamburger dependency. The tint sits under z-index:6 header controls and
// contributes no Prometheus blur/filter of its own.
const statusJsSource = fs.readFileSync('web-ui/src/mobile/mobile-status-bar-theme.js', 'utf8');
const statusJsGenerated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-status-bar-theme.js', 'utf8');
const statusCssSource = fs.readFileSync('web-ui/src/styles/mobile-status-bar-theme.css', 'utf8');
const statusCssGenerated = fs.readFileSync('generated/public-web-ui/static/styles/mobile-status-bar-theme.css', 'utf8');
assert.equal(statusJsGenerated, statusJsSource, 'generated status-edge JS must mirror source exactly');
assert.equal(statusCssGenerated, statusCssSource, 'generated status-edge CSS must mirror source exactly');
assert.match(statusJsSource, /STYLE_VERSION = 'pm-v303-2026-08-22-aug12-glass-status-edge'/,
  'status-edge bridge must carry the combined restore cache key');
assert.match(statusJsSource, /--pm-mobile-native-chrome-color/,
  'status-edge bridge must sync the live mobile palette into native chrome');
assert.match(statusJsSource, /meta\[name="theme-color"\]/,
  'status-edge bridge must keep the PWA theme-color live');
for (const signal of ['prom-theme-change', 'prom-appearance-change', 'pageshow', 'focus', 'visibilitychange']) {
  assert.ok(statusJsSource.includes(signal), `status-edge bridge must re-sync on ${signal}`);
}
assert.match(statusJsSource, /attributeFilter:\s*\['data-theme', 'data-skin'\]/,
  'status-edge bridge must track theme/skin attribute changes');
assert.match(statusCssSource, /\.pm-mobile-status-edge-tint\s*\{[\s\S]*?z-index:\s*5;/,
  'status-edge tint must remain below the z-index:6 mobile header');
assert.match(mobileBase, /\.pm-header\s*\{[\s\S]*?z-index:\s*6;/,
  'mobile header must remain above the status-edge tint');
assert.match(statusCssSource, /-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;[\s\S]*?filter:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/,
  'status-edge tint must rely on native WebKit blur and add no app-side blur/filter/shadow');

// Scope guard: the historical restore layer is material-only. Do not let a
// future cleanup sneak geometry, motion, popover, or layout changes into it.
assert.doesNotMatch(sourceCode, /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|transform|transition)\s*:/m,
  'August 12 restore layer must not alter geometry or motion');
assert.doesNotMatch(sourceCode, /popover|msheet|attach-sheet|ctx-popover|chat-settings-popover/,
  'popover/sheet styling is explicitly outside this restore');

// Keep unrelated white-title fixes that happened to share the old late file.
assert.match(source, /\.pm-title-row \.pm-title/,
  'literal-white mobile page title fix must remain intact');
assert.match(source, /\.pm-drawer-list \.pm-drawer-item > \.pm-flex/,
  'drawer page-tab label fix must remain intact');

console.log('mobile chat glass matches the August 12 contract with the lighter native iOS/PWA status edge preserved');
