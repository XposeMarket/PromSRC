import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = 'web-ui/src/styles/mobile-liquid-glass-demo.css';
const generatedPath = 'generated/public-web-ui/static/styles/mobile-liquid-glass-demo.css';
const source = fs.readFileSync(sourcePath, 'utf8');
const generated = fs.readFileSync(generatedPath, 'utf8');

for (const selector of [
  '.pm-header > .pm-icon-btn',
  '.pm-header .pm-online',
  '.pm-header-action-cluster',
  '.pm-tabbar',
  '.pm-tab-indicator',
  '.chat-pulse-card',
  '.pm-composer',
]) {
  assert.ok(source.includes(selector), `missing mobile liquid-glass surface: ${selector}`);
}

assert.match(source, /--pm-demo-rim:\s*16px\s*;/, 'rim=32 reference must map to 16 CSS px at DPR 2');
assert.match(source, /--pm-demo-strength:\s*10px\s*;/, 'strength=20 reference must map to 10 CSS px at DPR 2');
assert.match(source, /--pm-demo-chroma:\s*\.35px\s*;/, 'chroma=.7 reference must map to .35 CSS px at DPR 2');
assert.match(source, /--pm-demo-spec:\s*\.28\s*;/, 'reference specular amount must stay .28');
assert.match(source, /--pm-demo-body-alpha:\s*\.4275\s*;/, 'fill=.65 must use the reference body blend (.07 + fill*.55)');
assert.match(source, /--pm-demo-blur:\s*0px\s*;/, 'resting material must remain blur-free');
assert.match(source, /--pm-demo-open-composer-blur:\s*2\.5px\s*;/, 'opened composer must restore 2.5px blur');

assert.match(source, /url\(#pm-liquid-glint\)/, 'mobile glass must use a real displacement filter, not only painted borders');
assert.match(source, /mask-composite:\s*exclude/, 'refraction must be clipped to the rim so the center remains identity');
assert.match(source, /drop-shadow\(var\(--pm-demo-chroma\)/, 'rim must retain chromatic edge separation');
assert.match(source, /\.pm-composer:is\(:focus-within,[\s\S]*?blur\(var\(--pm-demo-open-composer-blur\)\)/, 'composer blur must activate when the composer is open/focused');

assert.equal(generated, source, 'generated mobile liquid-glass CSS must mirror source exactly');

const sourceData = fs.readFileSync('web-ui/src/mobile/mobile-data.js', 'utf8');
const generatedData = fs.readFileSync('generated/public-web-ui/static/mobile/mobile-data.js', 'utf8');
for (const data of [sourceData, generatedData]) {
  assert.match(data, /PM_DEMO_GLASS_STYLE_VERSION = 'pm-v297-2026-08-21-liquid-optics'/, 'mobile glass cache key must be bumped');
}

console.log('mobile liquid-glass optics match the locked demo material contract');
