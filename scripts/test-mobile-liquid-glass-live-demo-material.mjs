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

// The stable mobile base intentionally hides the decorative lens layer. The
// late material override must re-enable only that absolute child layer.
assert.match(sourceCode, /body\.pm-mobile-active :is\(\.pm-tabbar, \.pm-composer\) > \.pm-glass-lens\s*\{[\s\S]*?display:\s*block !important;/,
  'composer/tabbar decorative lens must be re-enabled by the late material override');
const displayDeclarations = sourceCode.match(/^\s*display\s*:[^;]+;/gm) || [];
assert.deepEqual(displayDeclarations.map((line) => line.trim()), ['display: block !important;'],
  'the only display override allowed is enabling the absolute decorative glass lens');

// mobile.css still contains an older two-mask rim implementation. Reset the mask
// shorthand before installing each one-image radial mask so composite state can
// never leak into the new lens on iOS.
const mobileBase = fs.readFileSync('web-ui/src/styles/mobile.css', 'utf8');
assert.match(mobileBase, /(?:-webkit-)?mask-composite\s*:/,
  'base mobile CSS is expected to contain the legacy composite-mask rim path');
assert.match(mobileBase, /\.pm-tab-indicator::after\s*\{[\s\S]*?content:\s*['"]{2};[\s\S]*?position:\s*absolute;/,
  'base mobile CSS must already own the tab-slider edge pseudo geometry');
assert.equal((sourceCode.match(/-webkit-mask:\s*none !important;/g) || []).length, 2,
  'exactly the two real decorative lens paths must reset the WebKit mask shorthand');
assert.equal((sourceCode.match(/^\s*mask:\s*none !important;/gm) || []).length, 2,
  'exactly the two real decorative lens paths must reset the standard mask shorthand');

// Refraction must be spatial, not just a dark fill/chroma decoration. Force a
// real WebKit backdrop capture with a tiny non-identity color transform, reset
// soft-light, and scale only the decorative snapshot toward the rim. This keeps
// the real control geometry untouched while making background pixels visibly
// shift under glass.
assert.match(source, /--pm-demo-refract-x:\s*1\.06/,
  'large-slab horizontal refraction scale must be present');
assert.match(source, /--pm-demo-refract-y:\s*1\.18/,
  'large-slab vertical refraction scale must be present');
assert.equal((sourceCode.match(/transform:\s*scale\(var\(--pm-demo-refract-x\),\s*var\(--pm-demo-refract-y\)\) !important;/g) || []).length, 2,
  'refraction transform must exist only on the two decorative lens paths');
assert.equal((sourceCode.match(/transform-origin:\s*center center !important;/g) || []).length, 2,
  'both decorative refraction layers must transform from their center');
assert.equal((sourceCode.match(/mix-blend-mode:\s*normal !important;/g) || []).length, 2,
  'both refraction snapshots must reset legacy soft-light blending');
assert.equal((sourceCode.match(/(?:-webkit-)?backdrop-filter:\s*saturate\(1\.0001\) brightness\(1\.0001\) !important;/g) || []).length, 4,
  'both lens paths must force a blur-free non-identity backdrop capture in WebKit and standard CSS');

// The hamburger is a normal header glass control. Its real button must not retain
// the old header blur; only its decorative ::after snapshot may refract.
assert.match(sourceCode, /\.pm-icon-btn\[aria-label="Menu"\][\s\S]*?\.pm-icon-btn\[aria-label="Open menu"\][\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;/,
  'hamburger menu must explicitly use the same blur-free base material');

// Resting material follows the deployed demo's blur=0. Only the opened composer
// gets the explicit readability exception requested for Prometheus.
assert.match(source, /body\.pm-mobile-active \.pm-composer \{[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;/,
  'resting composer must remain blur-free');
assert.match(source, /\.pm-composer:is\(:focus-within, \.is-focused, \.has-attachments, \.is-voice-active\)[\s\S]*?blur\(var\(--pm-demo-open-composer-blur\)\)/,
  'opened/focused composer must enable the 2.5px readability blur');
assert.match(source, /--pm-demo-open-composer-blur:\s*2\.5px/,
  'opened composer blur must stay 2.5px');

// Geometry safety: transforms are permitted ONLY on the decorative backdrop
// snapshots above. Strip those two transform declarations before checking that
// no real-control layout/size/motion declaration entered this material file.
const geometrySafeCode = sourceCode
  .replace(/^\s*transform:\s*scale\(var\(--pm-demo-refract-x\),\s*var\(--pm-demo-refract-y\)\) !important;\s*$/gm, '')
  .replace(/^\s*transform-origin:\s*center center !important;\s*$/gm, '');
const geometryDeclaration = /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|grid-template-columns|grid-template-rows|flex|transform|transform-origin)\s*:/m;
assert.doesNotMatch(geometrySafeCode, geometryDeclaration,
  'mobile liquid-glass override must never alter real control geometry/layout/motion');

// Prohibit the exact WebKit-hostile experiment that corrupted the app.
assert.doesNotMatch(sourceCode, /url\(#|feDisplacementMap|mask-composite|-webkit-mask-composite/,
  'mobile glass must not reintroduce SVG displacement or active composite-mask rings');

const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
assert.equal(generatedData, sourceData, 'generated mobile-data must mirror source exactly');
for (const data of [sourceData, generatedData]) {
  assert.match(data, /PM_DEMO_GLASS_STYLE_VERSION = 'pm-v299-2026-08-22-visible-refraction'/,
    'mobile glass stylesheet cache key must be bumped for visible refraction');
}

console.log('mobile liquid glass is live-demo locked, visibly refractive, hamburger-consistent, and geometry-safe');
