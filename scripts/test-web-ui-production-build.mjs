import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'generated', 'public-web-ui');
const manifestPath = path.join(publicRoot, 'asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const publicFile = (pathname) => path.join(publicRoot, String(pathname).replace(/^\/+/, ''));
const digest = (body) => crypto.createHash('sha256').update(body).digest('hex');
const attributes = read('.gitattributes');

assert.match(attributes, /generated\/public-web-ui\/asset-manifest\.json text eol=lf/);
assert.match(attributes, /generated\/public-web-ui\/build\/\*\*\/\*\.js text eol=lf/);
assert.match(attributes, /generated\/public-web-ui\/build\/\*\*\/\*\.css text eol=lf/);

assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.buildId, /^[a-f0-9]{16}$/);
assert.equal(manifest.builder.name, 'esbuild');
assert.match(manifest.builder.version, /^0\.27\./);

for (const entryName of ['desktop', 'mobile']) {
  const entry = manifest.entries[entryName];
  assert.match(entry.js, /^\/build\/entries\/[a-z]+-[A-Z0-9]+\.js$/);
  assert.match(entry.css, /^\/build\/styles\/[a-z]+-[A-Z0-9]+\.css$/);
  const html = fs.readFileSync(publicFile(entry.html), 'utf8');
  assert(html.includes(entry.js), `${entryName} HTML should reference its JS manifest entry`);
  assert(html.includes(entry.css), `${entryName} HTML should reference its CSS manifest entry`);
  assert.doesNotMatch(html, /\b(?:src|href)=["']\/?src\//i, `${entryName} production HTML must not reference source modules`);
  for (const script of html.matchAll(/<script([^>]*)>/gi)) {
    assert.match(script[1], /\bsrc=["']/i, `${entryName} executable inline script should be extracted`);
  }
}

assert.match(read('web-ui/index.html'), /src=["']\/src\/desktop-entry\.js["']/);
assert.match(read('web-ui/mobile.html'), /src=["']\/src\/mobile\/mobile-entry\.js["']/);
assert.match(read('web-ui/mobile.html'), /href=["']\/src\/styles\/mobile\.css["']/);

for (const asset of manifest.assets) {
  assert.match(asset.path, /^\/build\//);
  const body = fs.readFileSync(publicFile(asset.path));
  assert.equal(body.length, asset.bytes, `${asset.path}: byte count`);
  assert.equal(digest(body), asset.sha256, `${asset.path}: digest`);
  assert.equal(zlib.gzipSync(body, { level: 9 }).length, asset.gzipBytes, `${asset.path}: gzip count`);
  assert(!asset.path.endsWith('.map'), `${asset.path}: public source maps are forbidden`);
  for (const imported of asset.imports || []) {
    assert(fs.existsSync(publicFile(imported.path)), `${asset.path}: missing import ${imported.path}`);
  }
}

for (const source of [
  'src/pages/ChatPage.js',
  'src/pages/SettingsPage.js',
  'src/mobile/mobile-router.js',
  'src/mobile/mobile-pages.js',
  'src/mobile/mobile-schedule-pages.js',
]) {
  assert.match(manifest.moduleOutputs[source] || '', /^\/build\/(?:entries|chunks)\//, `${source}: missing feature-owned output`);
}
assert.notEqual(
  manifest.moduleOutputs['src/mobile/mobile-pages.js'],
  manifest.moduleOutputs['src/mobile/mobile-schedule-pages.js'],
  'Chat and Schedule must remain independently addressable route chunks',
);

assert(manifest.initial.mobile.jsGzipBytes < 250_000, `mobile shell JS gzip budget exceeded: ${manifest.initial.mobile.jsGzipBytes}`);
assert(manifest.initial.mobile.cssGzipBytes < 100_000, `mobile CSS gzip budget exceeded: ${manifest.initial.mobile.cssGzipBytes}`);

const generatedServiceWorker = read('generated/public-web-ui/service-worker.js');
assert(generatedServiceWorker.includes(`const ASSET_BUILD_ID = '${manifest.buildId}';`));
for (const pathname of manifest.initial.mobile.paths) {
  assert(generatedServiceWorker.includes(JSON.stringify(pathname)), `service worker missing mobile boot asset ${pathname}`);
}
assert.doesNotMatch(generatedServiceWorker, /const BUILD_PRECACHE = \[\s*\/\*__PROM_BUILD_PRECACHE__\*\//);

const sourceIndex = fs.readFileSync(path.join(root, 'web-ui', 'index.html'));
const generatedIndex = fs.readFileSync(path.join(publicRoot, 'index.html'));
const sourceMobileCss = fs.readFileSync(path.join(root, 'web-ui', 'src', 'styles', 'mobile.css'));
const generatedMobileCss = fs.readFileSync(publicFile(manifest.entries.mobile.css));
const measurements = {
  index: {
    sourceBytes: sourceIndex.length,
    productionBytes: generatedIndex.length,
    sourceGzipBytes: zlib.gzipSync(sourceIndex, { level: 9 }).length,
    productionGzipBytes: zlib.gzipSync(generatedIndex, { level: 9 }).length,
  },
  mobileCss: {
    sourceBytes: sourceMobileCss.length,
    productionBytes: generatedMobileCss.length,
    sourceGzipBytes: zlib.gzipSync(sourceMobileCss, { level: 9 }).length,
    productionGzipBytes: zlib.gzipSync(generatedMobileCss, { level: 9 }).length,
  },
  initial: manifest.initial,
};

assert(measurements.index.productionBytes < measurements.index.sourceBytes);
assert(measurements.mobileCss.productionGzipBytes < measurements.mobileCss.sourceGzipBytes);
console.log(JSON.stringify(measurements, null, 2));
console.log('Production Web UI asset contract passed.');
