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
  'directional glint must stay tied to spec*.22/255');
assert.match(source, /--pm-demo-chroma:\s*\.35px/,
  'live .7 device-pixel chroma must map to .35 CSS px at the demo DPR cap of 2');

for (const selector of [
  '.pm-header > .pm-icon-btn',
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
// without the safety test mistaking prose for executable CSS.
const geometryDeclaration = /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|display|grid-template-columns|grid-template-rows|flex|transform)\s*:/m;
assert.doesNotMatch(sourceCode, geometryDeclaration,
  'mobile liquid-glass override must never alter control geometry/layout/motion');

// Also prohibit the exact WebKit-hostile experiment that corrupted the app.
assert.doesNotMatch(sourceCode, /url\(#|feDisplacementMap|mask-composite|-webkit-mask-composite/,
  'mobile glass must not reintroduce SVG displacement or composite-mask rings');

const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
for (const data of [sourceData, generatedData]) {
  assert.match(data, /PM_DEMO_GLASS_STYLE_VERSION = 'pm-v298-2026-08-21-live-demo-material-v2'/,
    'mobile glass stylesheet cache key must be bumped for the live-demo material');
}

console.log('mobile liquid glass is source-locked to the live Vercel demo and geometry-safe');
