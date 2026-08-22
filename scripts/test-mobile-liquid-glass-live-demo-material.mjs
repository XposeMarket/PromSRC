import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

// Existing large surfaces remain on their current DOM material until their own
// exact-canvas ports are validated. The hamburger prototype below deliberately
// bypasses this approximation entirely.
assert.match(source, /--pm-demo-refract-x:\s*1\.06/,
  'large-slab horizontal refraction scale must remain present for non-prototype surfaces');
assert.match(source, /--pm-demo-refract-y:\s*1\.18/,
  'large-slab vertical refraction scale must remain present for non-prototype surfaces');
assert.equal((sourceCode.match(/transform:\s*scale\(var\(--pm-demo-refract-x\),\s*var\(--pm-demo-refract-y\)\) !important;/g) || []).length, 2,
  'legacy DOM refraction transform must remain limited to its two decorative lens paths');
assert.equal((sourceCode.match(/transform-origin:\s*center center !important;/g) || []).length, 2,
  'both legacy decorative refraction layers must transform from their center');
assert.equal((sourceCode.match(/mix-blend-mode:\s*normal !important;/g) || []).length, 2,
  'both legacy refraction snapshots must reset soft-light blending');
assert.equal((sourceCode.match(/(?:-webkit-)?backdrop-filter:\s*saturate\(1\.0001\) brightness\(1\.0001\) !important;/g) || []).length, 4,
  'legacy non-prototype lens paths must retain their existing capture behavior');

// Resting material follows the deployed demo's blur=0. Only the opened composer
// gets the explicit readability exception requested for Prometheus.
assert.match(source, /body\.pm-mobile-active \.pm-composer \{[\s\S]*?-webkit-backdrop-filter:\s*none !important;[\s\S]*?backdrop-filter:\s*none !important;/,
  'resting composer must remain blur-free');
assert.match(source, /\.pm-composer:is\(:focus-within, \.is-focused, \.has-attachments, \.is-voice-active\)[\s\S]*?blur\(var\(--pm-demo-open-composer-blur\)\)/,
  'opened/focused composer must enable the 2.5px readability blur');
assert.match(source, /--pm-demo-open-composer-blur:\s*2\.5px/,
  'opened composer blur must stay 2.5px');

// Geometry safety for the older shared material file: transforms are permitted
// ONLY on its decorative snapshots. The hamburger exact-canvas layer has its own
// isolated integration stylesheet and is tested separately below.
const geometrySafeCode = sourceCode
  .replace(/^\s*transform:\s*scale\(var\(--pm-demo-refract-x\),\s*var\(--pm-demo-refract-y\)\) !important;\s*$/gm, '')
  .replace(/^\s*transform-origin:\s*center center !important;\s*$/gm, '');
const geometryDeclaration = /^\s*(?:position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|border-radius|overflow|grid-template-columns|grid-template-rows|flex|transform|transform-origin)\s*:/m;
assert.doesNotMatch(geometrySafeCode, geometryDeclaration,
  'shared mobile liquid-glass override must never alter real control geometry/layout/motion');

// Prohibit the exact WebKit-hostile experiment that corrupted the app.
assert.doesNotMatch(sourceCode, /url\(#|feDisplacementMap|mask-composite|-webkit-mask-composite/,
  'shared mobile glass must not reintroduce SVG displacement or active composite-mask rings');

// The original data module moved byte-for-byte to mobile-data-base.js so the
// tiny wrapper can initialize the hamburger prototype without rewriting that
// large data file. Source/generated mirrors must remain exact.
const sourceDataBase = fs.readFileSync('web-ui/src/mobile/mobile-data-base.js', 'utf8');
const generatedDataBase = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data-base.js', 'utf8');
assert.equal(generatedDataBase, sourceDataBase, 'generated mobile-data base must mirror source exactly');
for (const data of [sourceDataBase, generatedDataBase]) {
  assert.match(data, /PM_DEMO_GLASS_STYLE_VERSION = 'pm-v299-2026-08-22-visible-refraction'/,
    'existing shared mobile glass stylesheet cache key must remain intact');
}
const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
assert.equal(generatedData, sourceData, 'generated mobile-data wrapper must mirror source exactly');
assert.match(sourceData, /initMobileHamburgerLiquidGlass/,
  'mobile-data wrapper must initialize the hamburger exact-canvas prototype');
assert.match(sourceData, /pm-v300-2026-08-22-exact-canvas-hamburger/,
  'hamburger prototype module cache key must be versioned');

// Pin the exact XposeMarket/liquid-glass source. Git blob identity makes this
// stronger than checking a few constants: any renderer edit will fail this gate.
function gitBlobSha(text) {
  const data = Buffer.from(text, 'utf8');
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${data.length}\0`, 'utf8'))
    .update(data)
    .digest('hex');
}

const exactRendererSource = fs.readFileSync('web-ui/src/vendor/liquid-glass.js', 'utf8');
const exactRendererGenerated = fs.readFileSync('generated/public-web-ui/static/vendor/liquid-glass.js', 'utf8');
assert.equal(exactRendererGenerated, exactRendererSource,
  'generated exact Liquid Glass renderer must mirror source exactly');
assert.equal(gitBlobSha(exactRendererSource), 'c79a03e89fbad053eaa9932d71915be66a27b14d',
  'vendored Liquid Glass renderer must remain byte-identical to XposeMarket/liquid-glass/src/liquid-glass.js');
assert.match(exactRendererSource, /sceneCtx\.getImageData\(/,
  'exact renderer must sample real scene pixels');
assert.match(exactRendererSource, /renderLiquidGlass\(/,
  'exact renderer must expose the canonical compositor');
assert.match(exactRendererSource, /glassCtx\.putImageData\(/,
  'exact renderer must write the canonical pixel result');

// The bridge may only solve DOM -> Canvas input. It must call the exact renderer
// with the exact deployed demo override and must not invent another optical path.
const bridgeSource = fs.readFileSync('web-ui/src/mobile/mobile-hamburger-liquid-glass.js', 'utf8');
const bridgeGenerated = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-hamburger-liquid-glass.js', 'utf8');
assert.equal(bridgeGenerated, bridgeSource, 'generated hamburger canvas bridge must mirror source exactly');
assert.match(bridgeSource, /import \{ DEFAULT_SPEC, renderLiquidGlass \} from '\.\.\/vendor\/liquid-glass\.js';/,
  'hamburger bridge must import the exact vendored compositor');
assert.match(bridgeSource, /Object\.freeze\(\{ \.\.\.DEFAULT_SPEC, blur: 0, fill: 0\.65 \}\)/,
  'hamburger bridge must use the exact deployed demo override');
assert.match(bridgeSource, /import\('\/vendor\/html2canvas\/html2canvas\.esm\.js'\)/,
  'DOM capture adapter must be lazy-loaded so a capture failure cannot break mobile boot');
assert.match(bridgeSource, /const dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 2\);/,
  'hamburger bridge must keep the demo DPR cap of 2');
assert.match(bridgeSource, /TARGET_SELECTOR = '\.pm-header > \.pm-icon-btn\[data-action="menu"\]';/,
  'prototype must target only the hamburger menu button');
assert.match(bridgeSource, /const scene = await html2canvas\(app,/,
  'bridge must rasterize the live DOM backdrop into a Canvas scene');
assert.match(bridgeSource, /renderLiquidGlass\(\{[\s\S]*?sceneCtx,[\s\S]*?glassCtx,[\s\S]*?spec: DEMO_SPEC,/,
  'bridge must feed captured pixels into the exact renderer');
assert.match(bridgeSource, /document\.getElementById\('mobile-root'\)/,
  'mutation observation must stay inside the mobile root so html2canvas clone work cannot self-trigger forever');
assert.doesNotMatch(bridgeSource, /feDisplacementMap|mask-composite|-webkit-mask-composite|url\(#/,
  'hamburger bridge must not contain SVG/composite-mask optical substitutes');

const hamburgerCssSource = fs.readFileSync('web-ui/src/styles/mobile-hamburger-liquid-glass.css', 'utf8');
const hamburgerCssGenerated = fs.readFileSync('generated/public-web-ui/static/styles/mobile-hamburger-liquid-glass.css', 'utf8');
assert.equal(hamburgerCssGenerated, hamburgerCssSource,
  'generated hamburger integration CSS must mirror source exactly');
assert.match(hamburgerCssSource, /\.pm-icon-btn\[data-action="menu"\]::after\s*\{[\s\S]*?content:\s*none !important;/,
  'hamburger must disable the previous pseudo/backdrop approximation');
assert.match(hamburgerCssSource, /data-pm-liquid-glass-ready="1"\]\s*\{[\s\S]*?background:\s*transparent !important;/,
  'once a real frame exists, the canvas must become the hamburger material');
assert.match(hamburgerCssSource, /\.pm-hamburger-liquid-glass-canvas/,
  'hamburger integration CSS must expose the exact renderer output canvas');

const gatewayApp = fs.readFileSync('src/gateway/core/app.ts', 'utf8');
assert.match(gatewayApp, /app\.use\('\/vendor\/html2canvas', express\.static\(html2CanvasDistPath/,
  'gateway must serve the DOM capture adapter locally');
assert.ok(fs.existsSync('node_modules/html2canvas/dist/html2canvas.esm.js'),
  'html2canvas DOM capture adapter must be installed by npm ci');

console.log('mobile liquid glass keeps the shared material stable and pins the hamburger to the exact Canvas compositor');
