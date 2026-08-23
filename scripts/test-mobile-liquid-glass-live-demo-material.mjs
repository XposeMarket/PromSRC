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

// Keep the previously correct bottom-chrome geometry. The visual regression was
// caused by material painting outside these bounds, not by these sizing values.
assert.match(mobileBase, /--pm-tabbar-h:\s*60px;/,
  'historical mobile tabbar reservation must stay 60px');
assert.match(mobileBase, /--pm-mobile-tabbar-bottom:\s*7px;/,
  'historical mobile tabbar bottom offset must stay 7px');
assert.match(mobileBase, /--pm-mobile-composer-gap:\s*11px;/,
  'historical mobile composer spacing token must stay 11px');
assert.match(mobileBase, /\.pm-tabbar\s*\{[\s\S]*?height:\s*56px;[\s\S]*?padding:\s*4px;/,
  'historical tabbar body must stay 56px tall with 4px internal padding');
assert.match(mobileBase, /\.pm-composer\s*\{[\s\S]*?bottom:\s*calc\(var\(--pm-tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ var\(--pm-mobile-composer-gap, 22px\)\);/,
  'composer must remain positioned from the historical tabbar reservation and gap');

// Preserve the recently fixed iOS/PWA top strip: transparent, no header-wide
// blur, while each standalone button/model pill keeps its own glass material.
assert.match(sourceCode, /body\.pm-mobile-active \.pm-header\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/,
  'iOS/PWA header safe-area must remain transparent and header-blur-free');

// Restore exactly the pre-August-13 depth for genuinely floating persistent
// glass. The resting tabbar is intentionally not in this cast-shadow group.
for (const selector of [
  '.pm-header > .pm-icon-btn',
  '.pm-header > .pm-haptic-host > .pm-icon-btn',
  '.pm-header-actions > .pm-icon-btn',
  '.pm-header-actions > .pm-haptic-host > .pm-icon-btn',
  '.pm-header .pm-online',
  '.pm-header-action-cluster',
  '.pm-completion-toast',
  '.pm-composer',
]) {
  assert.ok(source.includes(selector), `missing August 12 shadow restore surface: ${selector}`);
}
assert.doesNotMatch(sourceCode, /body\.pm-mobile-active :is\([\s\S]*?\.pm-header \.pm-icon-btn,/,
  'broad descendant header-button shadow ownership must not return');
assert.match(sourceCode, /\.pm-header-action-cluster > \.pm-haptic-host,[\s\S]*?\.pm-header-action-cluster > \.pm-haptic-host > \.pm-icon-btn:hover\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?border:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;/,
  'haptic wrappers and child icon slots inside the combined header action pill must remain completely glassless');
assert.match(sourceCode, /\.pm-header-action-cluster > \.pm-icon-btn::after,[\s\S]*?\.pm-header-action-cluster > \.pm-haptic-host > \.pm-icon-btn::after\s*\{[\s\S]*?display:\s*none !important;/,
  'combined header action child rims must remain disabled');
assert.match(sourceCode, /inset 0 1px 1px rgba\(255,255,255,\.38\),[\s\S]*?inset 0 -1px 1px rgba\(255,255,255,\.18\),[\s\S]*?0 6px 16px rgba\(0,0,0,\.16\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.08\) !important;/,
  'light floating glass must restore the August 12 cast-shadow recipe');
assert.match(sourceCode, /inset 0 1px 1px rgba\(255,255,255,\.16\),[\s\S]*?inset 0 -1px 1px rgba\(255,255,255,\.07\),[\s\S]*?0 6px 16px rgba\(0,0,0,\.34\),[\s\S]*?0 1px 4px rgba\(0,0,0,\.22\) !important;/,
  'dark floating glass must restore the August 12 cast-shadow recipe');

// The resting tabbar keeps its real historical footprint: internal rim only,
// with no outward shadow visually swelling into the composer gap or side inset.
assert.match(sourceCode, /body\.pm-mobile-active \.pm-tabbar\s*\{\s*box-shadow:\s*inset 0 1px 1px rgba\(255,255,255,\.38\),\s*inset 0 -1px 1px rgba\(255,255,255,\.18\) !important;\s*\}/,
  'resting light tabbar must use inset-only depth');
assert.match(sourceCode, /data-theme="dark"\] body\.pm-mobile-active \.pm-tabbar\s*\{\s*box-shadow:\s*inset 0 1px 1px rgba\(255,255,255,\.16\),\s*inset 0 -1px 1px rgba\(255,255,255,\.07\) !important;\s*\}/,
  'resting dark tabbar must use inset-only depth');
assert.match(sourceCode, /\.pm-tab-indicator\s*\{[\s\S]*?inset 0 1\.5px 1\.5px rgba\(255,255,255,\.34\),[\s\S]*?0 8px 22px rgba\(40,28,16,\.18\),[\s\S]*?0 1px 4px rgba\(40,28,16,\.12\) !important;/,
  'tab selector must restore its August 12 light floating depth');
assert.match(sourceCode, /data-theme="dark"[\s\S]*?\.pm-tab-indicator\s*\{[\s\S]*?inset 0 1\.5px 1\.5px rgba\(255,255,255,\.24\),[\s\S]*?0 8px 22px rgba\(0,0,0,\.42\) !important;/,
  'tab selector must restore its August 12 dark floating depth');
assert.match(sourceCode, /\.pm-tabbar\.pm-tabbar-pressing\s*\{[\s\S]*?inset 0 1\.5px 1px rgba\(255,255,255,\.36\),[\s\S]*?0 20px 52px rgba\(0,0,0,\.24\),[\s\S]*?0 5px 14px rgba\(0,0,0,\.12\) !important;/,
  'pressed/dragged tab bar must restore the stronger August 12 floating depth');

// The later live-demo material and exact-canvas hamburger are deliberately no
// longer part of the runtime path.
assert.doesNotMatch(sourceCode, /--pm-demo-|DEFAULT_SPEC|pm-demo-refract|saturate\(1\.0001\)|mask-image:\s*radial-gradient/,
  'late glass layer must not retain the later live-demo material/refraction override');
const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
assert.equal(generatedData, sourceData, 'generated mobile-data wrapper must mirror source exactly');
assert.deepEqual(sourceData.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean), [
  "export * from './mobile-data-base.js';",
  "import { initMobileStatusBarTheme } from './mobile-status-bar-theme.js';",
  'initMobileStatusBarTheme();',
], 'mobile-data must keep the shared base module as its stylesheet owner');
const sourceDataBase = fs.readFileSync('web-ui/src/mobile/mobile-data-base.js', 'utf8');
const generatedDataBase = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data-base.js', 'utf8');
assert.equal(generatedDataBase, sourceDataBase, 'generated mobile-data base must mirror source exactly');
assert.match(sourceDataBase, /PM_DEMO_GLASS_STYLE_VERSION\s*=\s*'pm-v303-2026-08-23-aug12-glass-crosscheck'/,
  'restored glass must use a fresh explicit cache key');
assert.match(sourceDataBase, /getElementById\(PM_DEMO_GLASS_STYLE_ID\)[\s\S]*?mobile-liquid-glass-demo\.css\?v=\$\{PM_DEMO_GLASS_STYLE_VERSION\}/,
  'the existing mobile-data-base owner must refresh the glass stylesheet link');
assert.match(sourceData, /initMobileStatusBarTheme\(\);/,
  'the isolated status-edge theme bridge must remain initialized');
assert.doesNotMatch(sourceData, /mobile-hamburger-liquid-glass|initMobileHamburgerLiquidGlass/,
  'exact-canvas hamburger must not run on mobile boot');
assert.match(sourceCode, /\.pm-hamburger-liquid-glass-canvas\s*\{[\s\S]*?display:\s*none !important;/,
  'a stale exact-canvas child must remain inert after a hot update');

const statusThemeSource = fs.readFileSync('web-ui/src/mobile/mobile-status-bar-theme.js', 'utf8');
const statusThemeGenerated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-status-bar-theme.js', 'utf8');
const statusCssSource = fs.readFileSync('web-ui/src/styles/mobile-status-bar-theme.css', 'utf8');
const statusCssGenerated = fs.readFileSync('generated/public-web-ui/static/styles/mobile-status-bar-theme.css', 'utf8');
assert.equal(statusThemeGenerated, statusThemeSource, 'generated status-edge theme runtime must mirror source exactly');
assert.equal(statusCssGenerated, statusCssSource, 'generated status-edge theme CSS must mirror source exactly');
assert.match(statusThemeSource, /meta\[name="theme-color"\]/,
  'status-edge bridge must sync the PWA theme-color meta tag');
assert.match(statusThemeSource, /prom-theme-change/,
  'status-edge bridge must react to live theme changes');
assert.match(statusCssSource, /z-index:\s*5;/,
  'status-edge tint must remain below the existing mobile header controls');
assert.doesNotMatch(statusCssSource, /blur\(/,
  'status-edge bridge must not add its own blur');
assert.match(statusCssSource, /backdrop-filter:\s*none !important;/,
  'status-edge bridge must explicitly remain blur-free');

// Scope guard: this layer is material-only. Do not let a future cleanup sneak
// geometry, motion, popover, or layout changes into the historical restore.
assert.doesNotMatch(sourceCode, /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|transform|transition)\s*:/m,
  'August 12 restore layer must not alter geometry or motion');
assert.doesNotMatch(sourceCode, /popover|msheet|attach-sheet|ctx-popover|chat-settings-popover/,
  'popover/sheet styling is explicitly outside this restore');

// Keep unrelated white-title fixes that happened to share the old late file.
assert.match(source, /\.pm-title-row \.pm-title/,
  'literal-white mobile page title fix must remain intact');
assert.match(source, /\.pm-drawer-list \.pm-drawer-item > \.pm-flex/,
  'drawer page-tab label fix must remain intact');

console.log('mobile persistent chat glass keeps one header action pill, historical tabbar footprint, pressed depth, cache freshness, and status-edge isolation');
