import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('src/gateway/core/server.ts', 'utf8');
const sourceSw = fs.readFileSync('web-ui/service-worker.js', 'utf8');
const generatedSw = fs.readFileSync('generated/public-web-ui/service-worker.js', 'utf8');

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

for (const [name, sw] of [['source', sourceSw], ['generated', generatedSw]]) {
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/, `${name} network-first fetch must force HTTP revalidation`);
  assert.match(sw, /url\.pathname\.startsWith\('\/static\/'\)/, `${name} service worker must route /static through CacheStorage fallback`);
  assert.match(sw, /'\/static\/mobile\/mobile-api\.js'/, `${name} precache must still include generated mobile modules`);
}
assert.equal(sourceSw, generatedSw, 'source and generated service-worker cache contracts must stay identical');

console.log('public UI cache contract regression: ok');
