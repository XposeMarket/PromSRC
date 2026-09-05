import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const sourcePath = (name) => `web-ui/src/mobile/${name}`;
const generatedPath = (name) => `generated/public-web-ui/static/mobile/${name}`;

const telemetry = [
  read('web-ui/src/mobile/mobile-pages.js'),
  read('web-ui/src/mobile/mobile-chat-page-runtime.js'),
].join('\n');
const pageRuntimeTelemetry = read(sourcePath('mobile-chat-page-runtime.js'));
const lifecycleNames = [
  'mobile_navigation',
  'mobile_shell_paint',
  'mobile_gateway_ready',
  'mobile_chat_chunk_requested',
  'mobile_chat_runtime_hydrated',
  'mobile_first_transcript_paint',
  'mobile_composer_interactive',
];
for (const name of lifecycleNames) assert.match(telemetry, new RegExp(`['"]${name}['"]`), `${name}: lifecycle name missing`);
assert.match(telemetry, /__PROM_PERF_MARK/, 'mobile lifecycle marks must use the scrubbed performance utility');
assert.match(read('web-ui/src/performance.js'), /markClientPerformance\(/, 'the global performance mark utility must remain the scrubbed implementation');
assert.match(read(sourcePath('mobile-router.js')), /markClientPerformance\('mobile_navigation'/);
assert.match(read(sourcePath('mobile-router.js')), /markClientPerformance\('mobile_chat_chunk_requested'/);
assert.match(read(sourcePath('mobile-shell.js')), /__PROM_PERF_MARK\?\.\('mobile_shell_paint'/);
assert.match(read(sourcePath('mobile-api.js')), /__PROM_PERF_MARK\?\.\('mobile_gateway_ready'/);
assert.match(read(sourcePath('mobile-pages.js')), /markMobileLifecycle\('chatRuntimeHydrated'\)/);
assert.match(pageRuntimeTelemetry, /markMobileLifecycle\('composerInteractive'\)/);
const rendererTelemetry = read(sourcePath('mobile-chat-renderer-runtime.js'));
assert.match(rendererTelemetry, /const hasTranscriptTurn = runtimeRows\.some\(/,
  'first transcript paint must be tied to an actual runtime transcript turn');
assert.match(rendererTelemetry, /if \(hasTranscriptTurn && !mobileFirstTranscriptPaintMarked\)/,
  'first transcript paint must not be emitted for an empty transcript container');
assert.match(rendererTelemetry, /context\.markMobileLifecycle\?\.\('firstTranscriptPaint'\)/);
assert.match(read(sourcePath('mobile-pages.js')), /"markMobileLifecycle": \{ enumerable: true/);

for (const name of [
  'mobile-api.js',
  'mobile-chat-renderer-runtime.js',
  'mobile-chat-page-runtime.js',
  'mobile-pages.js',
  'mobile-router.js',
  'mobile-shell.js',
]) {
  assert.equal(read(generatedPath(name)), read(sourcePath(name)), `${name}: generated mobile copy must mirror source`);
}

const manifest = JSON.parse(read('generated/public-web-ui/asset-manifest.json'));
const publicRoot = path.join(root, 'generated', 'public-web-ui');
const publicFile = (pathname) => path.join(publicRoot, String(pathname).replace(/^\/+/, ''));
const mobileHtml = read('generated/public-web-ui/mobile.html');
const mobileCss = manifest.entries?.mobile?.css;
assert.match(mobileHtml, /<script src="\/vendor\/jsqr\/jsQR\.js" defer><\/script>/, 'production mobile HTML must keep jsQR');
assert.ok(fs.existsSync(publicFile('/vendor/jsqr/jsQR.js')), 'production jsQR fallback must be present');
assert.ok(mobileCss && fs.existsSync(publicFile(mobileCss)), 'production mobile CSS entry must exist');
assert.ok(manifest.initial?.mobile?.paths?.includes(mobileCss), 'mobile CSS must remain in the mobile boot closure');
for (const source of [
  'src/mobile/mobile-router.js',
  'src/mobile/mobile-pages.js',
  'src/mobile/mobile-chat-renderer-runtime.js',
]) {
  const output = manifest.moduleOutputs?.[source];
  assert.match(output || '', /^\/build\/(?:entries|chunks)\//, `${source}: production route output missing`);
  assert.ok(fs.existsSync(publicFile(output)), `${source}: production route output file missing`);
}
const productionMarkFiles = manifest.assets
  .map((asset) => asset.path)
  .filter((pathname) => /\.(?:js|css)$/.test(pathname))
  .map((pathname) => publicFile(pathname));
const productionText = productionMarkFiles
  .filter((filename) => fs.existsSync(filename))
  .map((filename) => fs.readFileSync(filename, 'utf8'))
  .join('\n');
for (const name of lifecycleNames) assert.match(productionText, new RegExp(name), `${name}: production mark missing`);

console.log(JSON.stringify({
  buildId: manifest.buildId,
  mobileCss,
  lifecycleNames,
  routeOutputs: {
    router: manifest.moduleOutputs['src/mobile/mobile-router.js'],
    chat: manifest.moduleOutputs['src/mobile/mobile-pages.js'],
    renderer: manifest.moduleOutputs['src/mobile/mobile-chat-renderer-runtime.js'],
  },
}, null, 2));
console.log('Mobile lifecycle telemetry and source-to-production contracts passed.');
