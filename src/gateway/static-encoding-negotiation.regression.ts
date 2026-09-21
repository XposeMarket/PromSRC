/**
 * Regression: Accept-Encoding negotiation and service-worker module consistency.
 *
 * 1. ENCODING (src/gateway/core/server.ts)
 *    pickCompressionEncoding() substring-matched `br` and `gzip` with no q-value
 *    parsing. In HTTP, `q=0` means "not acceptable", so `br;q=0, gzip;q=1`
 *    returned brotli - an encoding the client explicitly refused. This imports the
 *    REAL exported function rather than a mirrored copy, so the shipped
 *    negotiation is what gets asserted.
 *
 * 2. MODULE CONSISTENCY (web-ui/service-worker.js)
 *    Cache-first was applied to mutable /src/ and /static/ URLs alongside
 *    content-hashed /build/ URLs. Mutable modules live at stable URLs, so each one
 *    could refresh independently and a load could mix a new importer with an old
 *    dependency; a renamed export then fails the real `import` and the app does not
 *    start. Bumping RELEASE_VERSION does not help because the skew happens within a
 *    single cache generation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { pickCompressionEncoding } from './core/server';

function pick(acceptEncoding?: string): 'br' | 'gzip' | null {
  return pickCompressionEncoding({
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  } as unknown as http.IncomingMessage);
}

function assertEncodingNegotiation(): void {
  // Normal negotiation still prefers brotli.
  assert.equal(pick('br, gzip'), 'br', 'brotli is preferred when both are acceptable');
  assert.equal(pick('gzip'), 'gzip', 'gzip is selected when it is the only option');
  assert.equal(pick('gzip, deflate'), 'gzip', 'gzip is selected alongside unsupported encodings');
  assert.equal(pick(''), null, 'an empty Accept-Encoding selects no compression');
  assert.equal(pick(undefined), null, 'an absent Accept-Encoding selects no compression');

  // q=0 means "not acceptable". These are the protocol violations.
  assert.equal(
    pick('br;q=0, gzip;q=1'),
    'gzip',
    'REGRESSION: brotli was selected despite br;q=0. In HTTP q=0 means NOT ACCEPTABLE, so this '
    + 'returns an encoding the client explicitly refused.',
  );
  assert.equal(
    pick('gzip;q=0'),
    null,
    'REGRESSION: gzip was selected despite gzip;q=0',
  );
  assert.equal(
    pick('gzip;q=0, br;q=0'),
    null,
    'REGRESSION: an encoding was selected despite every supported encoding being forbidden',
  );
  assert.equal(pick('*;q=0'), null, 'a wildcard rejection must forbid every encoding');
  assert.equal(
    pick('identity;q=0'),
    null,
    'identity;q=0 names no supported encoding, so nothing is acceptable',
  );

  // Wildcards, spacing and casing.
  assert.equal(pick('*'), 'br', 'a bare wildcard accepts brotli');
  assert.equal(pick('*;q=0, gzip;q=1'), 'gzip', 'an explicit token overrides a wildcard rejection');
  assert.equal(pick('br;q=0, *;q=1'), 'gzip', 'a wildcard must not resurrect an explicitly forbidden encoding');
  assert.equal(pick('  BR ;  Q=1 , gzip'), 'br', 'parsing tolerates whitespace and casing');
  assert.equal(pick('br;q=0.001'), 'br', 'a small positive q-value is still acceptable');
}

function assertServiceWorkerModulePolicy(): void {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'web-ui', 'service-worker.js'),
    'utf-8',
  );

  const buildBranch = /startsWith\('\/build\/'\)[\s\S]{0,400}?cacheFirstRevalidate/.test(source);
  assert.ok(
    buildBranch,
    'content-hashed /build/ assets should stay cache-first; their URL never changes meaning',
  );

  const mutableBranch = source.match(
    /startsWith\('\/src\/'\)[\s\S]{0,400}?(staleWhileRevalidate|networkFirst|cacheFirstRevalidate)/,
  );
  assert.ok(mutableBranch, 'the service worker must route /src/ explicitly');
  assert.notEqual(
    mutableBranch![1],
    'cacheFirstRevalidate',
    'REGRESSION: mutable /src/ modules are served cache-first. They live at stable URLs, so each '
    + 'module refreshes independently and one load can mix a new importer with an old dependency. '
    + 'A renamed export then fails the real `import` and the app does not start at all.',
  );

  assert.ok(
    /cacheFirstRevalidate\(request, cacheName, event\)|cacheFirstRevalidate\(\s*request,\s*cacheName,\s*event\s*\)/.test(source)
    || /function cacheFirstRevalidate\(request, cacheName, event\)/.test(source),
    'cacheFirstRevalidate must receive the fetch event so it can extend the worker lifetime',
  );
  assert.ok(
    /event\.waitUntil\(settled\)|waitUntil\(revalidate/.test(source),
    'REGRESSION: background revalidation is not attached to event.waitUntil(), so the browser may '
    + 'terminate the worker after respondWith() settles and before the refresh is written.',
  );
}

function main(): void {
  assertEncodingNegotiation();
  assertServiceWorkerModulePolicy();
  console.log('static-encoding-negotiation regression: OK');
}

main();
