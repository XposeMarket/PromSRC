import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'web-ui');
const generatedRoot = path.join(root, 'generated', 'public-web-ui', 'static');
const read = (file) => fs.readFileSync(file, 'utf8');
const source = (relative) => path.join(sourceRoot, 'src', relative);
const generated = (relative) => path.join(generatedRoot, relative);

const ownerModules = [
  'mobile/mobile-style-owners.js',
  'mobile/mobile-shell.js',
  'mobile/mobile-pages.js',
  'mobile/mobile-chat-page-runtime.js',
  'mobile/mobile-voice-page.js',
  'mobile/mobile-settings.js',
  'mobile/mobile-status-bar-theme.js',
  'mobile/mobile-hamburger-liquid-glass.js',
];
const ownerStyles = [
  ['styles/mobile-liquid-glass-demo.css', 'shell'],
  ['styles/mobile-hamburger-liquid-glass.css', 'shell'],
  ['styles/mobile-status-bar-theme.css', 'shell'],
  ['styles/mobile-composer-stack.css', 'components'],
  ['styles/mobile-settings.css', 'route'],
  ['styles/mobile-voice.css', 'route'],
];

for (const relative of ownerModules) {
  assert.equal(read(generated(relative)), read(source(relative)), `generated ${relative} must mirror source`);
}
for (const [relative, layer] of ownerStyles) {
  const css = read(source(relative));
  assert.equal(read(generated(relative)), css, `generated ${relative} must mirror source`);
  assert.match(css, new RegExp(`@layer\\s+${layer}\\s*\\{`), `${relative} must declare its ${layer} cascade layer`);
}

const mobileEntry = read(source('styles/mobile-entry.css'));
assert.match(mobileEntry, /@layer tokens, shell, route, components, state, compatibility;/,
  'mobile entry must define the ownership layer order');
assert.match(mobileEntry, /@import '\.\/mobile\.css' layer\(route\);/,
  'shared mobile route CSS must enter the route layer');

const dataBase = read(source('mobile/mobile-data-base.js'));
assert.doesNotMatch(dataBase, /stylesheet|createElement\(['"]link|mobile-(?:liquid-glass|composer-stack|settings|voice)\.css/,
  'compatibility data must not install route or shell styles');
const owners = read(source('mobile/mobile-style-owners.js'));
assert.match(owners, /relativeUrl\.pathname\.includes\('\/build\/'\)/,
  'production-bundled owner modules must detect their /build/chunks base');
assert.match(owners, /relativeUrl\.pathname = `\/static\/styles\/\$\{definition\.file\}`/,
  'production owner modules must resolve route CSS to the static stylesheet directory');
for (const [owner, file, layer] of [
  ['shell', 'mobile-liquid-glass-demo.css', 'shell'],
  ['chat', 'mobile-composer-stack.css', 'components'],
  ['voice', 'mobile-voice.css', 'route'],
  ['settings', 'mobile-settings.css', 'route'],
]) {
  assert.match(owners, new RegExp(`${owner}:\\s*Object\\.freeze\\(\\[[\\s\\S]*?${file}`), `${owner} must name its owned stylesheet`);
  assert.match(owners, new RegExp(`layer: '${layer}'`), `${owner} must be assigned to the ${layer} layer`);
}

for (const [module, owner] of [
  ['mobile/mobile-shell.js', 'ensureMobileShellStyles'],
  ['mobile/mobile-voice-page.js', 'ensureMobileVoiceStyles'],
  ['mobile/mobile-settings.js', 'ensureMobileSettingsStyles'],
]) {
  const code = read(source(module));
  assert.match(code, /mobile-style-owners\.js/, `${module} must import its style-owner module`);
  assert.match(code, new RegExp(`${owner}\\(\\)`), `${module} must activate ${owner}`);
}
assert.match(read(source('mobile/mobile-pages.js')), /mobile-style-owners\.js/,
  'mobile-pages must import the style-owner module for its route runtime');
assert.match(read(source('mobile/mobile-chat-page-runtime.js')), /ensureMobileChatStyles\(\)/,
  'the extracted mobile chat route must activate its style owner');
for (const module of ['mobile/mobile-status-bar-theme.js', 'mobile/mobile-hamburger-liquid-glass.js']) {
  assert.match(read(source(module)), /pathname\.includes\('\/build\/'\)/,
    `${module} must resolve its shell stylesheet from the production static directory`);
}

const mobileCss = read(source('styles/mobile.css'));
const settingsCss = read(source('styles/mobile-settings.css'));
const proposalsPage = read(source('mobile/mobile-proposals-pages.js'));
assert.doesNotMatch(mobileCss, /\/\* ---------- settings ---------- \*\//,
  'settings-only block must not remain in the shared mobile route stylesheet');
assert.doesNotMatch(mobileCss, /The standalone voice page is two deliberate, full-screen stops/,
  'standalone Voice snap block must not remain in the shared mobile route stylesheet');
assert.match(mobileCss, /\.pm-select\s*\{[\s\S]*?appearance:\s*none[\s\S]*?background-image:/,
  'shared select presentation must remain available to every route that renders .pm-select');
assert.match(mobileCss, /\.pm-schedule-card\s*\{[\s\S]*?border:\s*0;/,
  'schedule cards must use a borderless surface treatment');
assert.match(mobileCss, /\.pm-proposal-card,[\s\S]*?\.pm-proposal-review-card\s*\{[\s\S]*?border:\s*0;/,
  'proposal cards must not render an accent rim');
assert.match(mobileCss, /\.pm-proposals-page\s*>\s*\.pm-card\s*\{[\s\S]*?border:\s*0;/,
  'proposal-page card sections must use borderless surfaces');
assert.match(mobileCss, /\.pm-proposal-step\s*\{[\s\S]*?border:\s*0;/,
  'proposal execution-step cards must not render a rim');
assert.doesNotMatch(settingsCss, /(?:^|\n)\s*\.pm-select\s*\{/,
  'Settings CSS must not claim the shared .pm-select component');
assert.match(proposalsPage, /class="pm-select"/,
  'Proposals must remain covered by the shared .pm-select component owner');

const manifestPath = path.join(root, 'generated', 'public-web-ui', 'asset-manifest.json');
const manifest = JSON.parse(read(manifestPath));
assert.ok(manifest.entries?.mobile?.css, 'production manifest must expose the mobile CSS entry');
const manifestCssFile = path.join(root, 'generated', 'public-web-ui', manifest.entries.mobile.css.replace(/^\//, ''));
assert.ok(fs.existsSync(manifestCssFile), 'mobile CSS entry from the manifest must exist');

const measure = (file) => {
  const body = fs.readFileSync(file);
  return { rawBytes: body.length, gzipBytes: zlib.gzipSync(body, { level: 9 }).length };
};
const measurements = {
  mobileEntry: measure(manifestCssFile),
};
for (const [relative] of ownerStyles) {
  measurements[path.basename(relative)] = measure(generated(relative));
}

console.log(JSON.stringify({
  layerOrder: ['tokens', 'shell', 'route', 'components', 'state', 'compatibility'],
  manifestMobileCss: manifest.entries.mobile.css,
  measurements,
}, null, 2));
console.log('[test-mobile-css-ownership] passed: route-owned styles, cascade layers, generated parity, and manifest measurements');
