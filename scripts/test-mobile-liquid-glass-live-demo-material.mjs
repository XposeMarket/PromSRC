import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = 'web-ui/src/styles/mobile-liquid-glass-demo.css';
const generatedPath = 'generated/public-web-ui/static/styles/mobile-liquid-glass-demo.css';
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');
const sourceCode = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

assert.equal(generated, source, 'generated mobile liquid-glass CSS must mirror source exactly');

// Lock the actual LIVE Vercel demo mount, not DEFAULT_SPEC by itself.
assert.match(source, /spec:\s*\{\s*\.\.\.DEFAULT_SPEC,\s*blur:\s*0,\s*fill:\s*0\.65\s*\}/,
  'reference comment must record the live demo override: blur 0 / fill .65');
assert.match(source, /rim 32, strength 20, chroma \.7, spec \.28/,
  'reference comment must retain the live compositor optical constants');
assert.match(source, /--pm-demo-body:\s*rgba\(18, 22, 28, \.4275\)/,
  'fill .65 must resolve through body=.07+fill*.55 to .4275 toward rgb(18,22,28)');
assert.match(source, /--pm-demo-hairline:\s*rgba\(255, 252, 248, \.1936\)/,
  'top/bottom hairline must follow .16 + spec*.12 for spec=.28');
assert.match(source, /--pm-demo-directional-glint:\s*rgba\(255, 255, 255, \.0242\)/,
  'directional glint must stay tied to spec*22/255');
assert.match(source, /--pm-demo-chroma:\s*\.35px/,
  'live .7 device-pixel chroma must map to .35 CSS px at the demo DPR cap of 2');

for (const selector of [
  '.pm-header > .pm-icon-btn',
  '.pm-header-actions > .pm-icon-btn',
  '.pm-header .pm-online',
  '.pm-header-action-cluster',
  '.pm-completion-toast',
  '.chat-pulse-card',
  '.pm-composer',
  '.pm-tabbar',
  '.pm-tab-indicator',
]) {
  assert.ok(source.includes(selector), `missing live-demo material surface: ${selector}`);
}

// The stable mobile base intentionally hides the old decorative lens layer.
// This material override must explicitly re-enable only the absolute lens layer
// for composer/tabbar; otherwise the rim-refraction code below is dead CSS.
assert.match(sourceCode, /body\.pm-mobile-active :is\(\.pm-tabbar, \.pm-composer\) > \.pm-glass-lens\s*\{[\s\S]*?display:\s*block !important;/,
  'composer/tabbar decorative lens must be re-enabled by the late material override');
const displayDeclarations = sourceCode.match(/^\s*display\s*:[^;]+;/gm) || [];
assert.deepEqual(displayDeclarations.map((line) => line.trim()), ['display: block !important;'],
  'the only display override allowed is enabling the absolute decorative glass lens');

// mobile.css still contains the older two-mask rim implementation. A late
// mask-image declaration alone does NOT reset mask-composite in WebKit, so both
// new lens paths must explicitly reset the mask shorthand before installing the
// single radial mask. This prevents the old XOR/exclude compositor from leaking
// into the new material on iOS.
const mobileBase = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
assert.match(mobileBase, /(?:-webkit-)?mask-composite\s*:/,
  'base mobile CSS is expected to contain the legacy composite-mask rim path');
assert.match(sourceCode, /body\.pm-mobile-active :is\(\.pm-tabbar, \.pm-composer\) > \.pm-glass-lens\s*\{[\s\S]*?-webkit-mask:\s*none !important;[\s\S]*?mask:\s*none !important;[\s\S]*?-webkit-mask-image:/,
  'composer/tabbar lens must reset inherited mask shorthand before its radial mask');
assert.match(sourceCode, /\.pm-tab-indicator[\s\S]*?\)::after\s*\{[\s\S]*?-webkit-mask:\s*none !important;[\s\S]*?mask:\s*none !important;[\s\S]*?-webkit-mask-image:/,
  'header/slider edge lens must reset inherited mask shorthand before its radial mask');
assert.equal((sourceCode.match(/-webkit-mask:\s*none !important;/g) || []).length, 2,
  'exactly the two decorative lens paths must reset the WebKit mask shorthand');
assert.equal((sourceCode.match(/^\s*mask:\s*none !important;/gm) || []).length, 2,
  'exactly the two decorative lens paths must reset the standard mask shorthand');

// Resting material follows the deployed demo's blur=0. Only the opened composer
// gets the explicit readability exception requested for Prometheus.
assert.match(source, /body\.pm-mobile-active \.pm-composer \{[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;/,
  'resting composer must remain blur-free');
assert.match(source, /\.pm-composer:is\(:focus-within, \.is-focused, \.has-attachments, \.is-voice-active\)[\s\S]*?blur\(var\(--pm-demo-open-composer-blur\)\)/,
  'opened/focused composer must enable the 2.5px readability blur');
assert.match(source, /--pm-demo-open-composer-blur:\s*2\.5px/,
  'opened composer blur must stay 2.5px');

// Regression guard for the #128 failure: this override is MATERIAL ONLY.
// Comments are stripped first so documentation can name forbidden mechanisms
// without the safety test mistaking prose for executable CSS. `display` is
// checked separately above because the absolute decorative lens must be turned
// back on after mobile.css intentionally hides it.
const geometryDeclaration = /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|grid-template-columns|grid-template-rows|flex|transform)\s*:/m;
assert.doesNotMatch(sourceCode, geometryDeclaration,
  'mobile liquid-glass override must never alter control geometry/layout/motion');

// Also prohibit the exact WebKit-hostile experiment that corrupted the app.
// The safe shorthand reset above is allowed; active composite operators are not.
assert.doesNotMatch(sourceCode, /url\(#|feDisplacementMap|mask-composite|-webkit-mask-composite/,
  'mobile glass must not reintroduce SVG displacement or active composite-mask rings');

const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
for (const data of [sourceData, generatedData]) {
  assert.match(data, /PM_DEMO_GLASS_STYLE_VERSION = 'pm-v298-2026-08-21-live-demo-material-v2'/,
    'mobile glass stylesheet cache key must be bumped for the live-demo material');
}

console.log('mobile liquid glass is source-locked to the live Vercel demo and geometry-safe');
