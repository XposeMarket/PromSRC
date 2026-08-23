import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('src/gateway/core/server.ts', 'utf8');
const sourceSw = fs.readFileSync('web-ui/service-worker.js', 'utf8');
const generatedSw = fs.readFileSync('generated/public-web-ui/service-worker.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('generated/public-web-ui/asset-manifest.json', 'utf8'));

assert.match(
  server,
  /pathname\.startsWith\('\/static\/'\)\) return 'no-cache'/,
  'stable generated /static module URLs must revalidate instead of staying fresh for 24 hours',
);
assert.doesNotMatch(
  server,
  /pathname\.startsWith\('\/static\/'\)\s*\|\|\s*pathname\.startsWith\('\/vendor\/'\)/,
  '/static must not share the long-lived immutable-ish vendor/assets policy',
);
assert.match(
  server,
  /pathname\.startsWith\('\/build\/'\)\) return 'public, max-age=31536000, immutable'/,
  'content-addressed production assets should use immutable HTTP caching',
);

for (const [name, sw] of [['source', sourceSw], ['generated', generatedSw]]) {
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/, `${name} network-first fetch must force HTTP revalidation`);
  assert.match(sw, /url\.pathname\.startsWith\('\/static\/'\)/, `${name} service worker must route /static through CacheStorage fallback`);
  assert.match(sw, /BUILD_PRECACHE\.length \? BUILD_PRECACHE : SOURCE_PRECACHE/, `${name} must select exactly one module identity for precache`);
}
assert.match(sourceSw, /const ASSET_BUILD_ID = 'source-build'/, 'source service worker should keep the raw-module cache identity');
assert.match(generatedSw, new RegExp(`const ASSET_BUILD_ID = '${manifest.buildId}'`), 'generated service worker should use the manifest build id');
assert.ok(manifest.initial.mobile.paths.every((pathname) => generatedSw.includes(JSON.stringify(pathname))), 'generated service worker must precache the mobile boot closure');
assert.ok(!/const BUILD_PRECACHE = \[\s*\/\*__PROM_BUILD_PRECACHE__\*\//.test(generatedSw), 'generated service worker placeholder must be replaced');

console.log('public UI cache contract regression: ok');
