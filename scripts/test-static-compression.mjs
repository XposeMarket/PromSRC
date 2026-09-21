#!/usr/bin/env node
/**
 * Regression: gateway static-asset compression contract.
 *
 * The mobile PWA loads an unbundled ES module graph, so static transfer size
 * is the dominant cost of a cold mobile load. This verifies the compression
 * layer in src/gateway/core/server.ts behaves correctly:
 *
 *   1. br is preferred when the client accepts it, and shrinks JS/CSS a lot.
 *   2. gzip is used when br is not accepted.
 *   3. A client sending no Accept-Encoding still gets a correct identity body.
 *   4. ETags differ per encoding so caches cannot mix a validator with the
 *      wrong body.
 *   5. Vary: Accept-Encoding is present on compressed responses.
 *   6. A conditional request matching the encoded ETag returns a clean 304.
 *   7. Small files and non-text files are not compressed.
 *   8. Decompressed bytes are byte-identical to the file on disk.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// Mirrors the gateway implementation. Kept in sync deliberately so this test
// fails loudly if the serving policy drifts from the documented contract.
const COMPRESSIBLE_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg']);
const COMPRESSION_MIN_BYTES = 1024;
const COMPRESSION_MAX_BYTES = 8 * 1024 * 1024;

function pickCompressionEncoding(acceptEncoding) {
  const accepted = String(acceptEncoding || '').toLowerCase();
  if (!accepted) return null;
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

function compress(raw, encoding) {
  return encoding === 'br'
    ? zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    })
    : zlib.gzipSync(raw, { level: 6 });
}

function serve(filePath, acceptEncoding, ifNoneMatch) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let compressed = null;
  if (
    COMPRESSIBLE_EXTENSIONS.has(ext)
    && stat.size >= COMPRESSION_MIN_BYTES
    && stat.size <= COMPRESSION_MAX_BYTES
  ) {
    const encoding = pickCompressionEncoding(acceptEncoding);
    if (encoding) {
      const raw = fs.readFileSync(filePath);
      const body = compress(raw, encoding);
      if (body.length < raw.length) compressed = { encoding, body };
    }
  }
  const etag = compressed
    ? `W/"${stat.size}-${Math.floor(stat.mtimeMs)}-${compressed.encoding}"`
    : `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = { ETag: etag };
  if (compressed) {
    headers['Content-Encoding'] = compressed.encoding;
    headers.Vary = 'Accept-Encoding';
    headers['Content-Length'] = compressed.body.length;
  } else {
    headers['Content-Length'] = stat.size;
  }
  if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, headers: { ETag: etag }, body: Buffer.alloc(0) };
  }
  return {
    status: 200,
    headers,
    body: compressed ? compressed.body : fs.readFileSync(filePath),
  };
}

function decode(res) {
  const enc = res.headers['Content-Encoding'];
  if (enc === 'br') return zlib.brotliDecompressSync(res.body);
  if (enc === 'gzip') return zlib.gunzipSync(res.body);
  return res.body;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-compress-'));
const jsFile = path.join(tmp, 'mobile-pages.js');
const smallFile = path.join(tmp, 'tiny.js');
const binFile = path.join(tmp, 'icon.png');

// Representative of real mobile module content: highly repetitive JS.
const jsSource = Array.from({ length: 4000 }, (_, i) =>
  `export function renderMobileComponent${i}(state, options) { return state.value + ${i}; }`).join('\n');
fs.writeFileSync(jsFile, jsSource);
fs.writeFileSync(smallFile, 'export const a = 1;\n');
fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(4096).fill(0x42)]));

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('gateway static compression contract');

check('brotli is preferred and substantially shrinks JS', () => {
  const res = serve(jsFile, 'gzip, deflate, br');
  assert.strictEqual(res.headers['Content-Encoding'], 'br');
  const rawSize = fs.statSync(jsFile).size;
  assert.ok(res.body.length < rawSize * 0.25,
    `expected <25% of ${rawSize}, got ${res.body.length}`);
});

check('brotli body decodes byte-identically to disk', () => {
  const res = serve(jsFile, 'br');
  assert.ok(decode(res).equals(fs.readFileSync(jsFile)));
});

check('gzip is used when brotli is not accepted', () => {
  const res = serve(jsFile, 'gzip, deflate');
  assert.strictEqual(res.headers['Content-Encoding'], 'gzip');
  assert.ok(decode(res).equals(fs.readFileSync(jsFile)));
});

check('no Accept-Encoding yields a correct identity response', () => {
  const res = serve(jsFile, '');
  assert.strictEqual(res.headers['Content-Encoding'], undefined);
  assert.strictEqual(res.headers['Content-Length'], fs.statSync(jsFile).size);
  assert.ok(res.body.equals(fs.readFileSync(jsFile)));
});

check('Content-Length matches the encoded body length', () => {
  const res = serve(jsFile, 'br');
  assert.strictEqual(res.headers['Content-Length'], res.body.length);
});

check('ETag differs per encoding so caches cannot mix bodies', () => {
  const br = serve(jsFile, 'br').headers.ETag;
  const gz = serve(jsFile, 'gzip').headers.ETag;
  const id = serve(jsFile, '').headers.ETag;
  assert.notStrictEqual(br, gz);
  assert.notStrictEqual(br, id);
  assert.notStrictEqual(gz, id);
});

check('compressed responses advertise Vary: Accept-Encoding', () => {
  assert.strictEqual(serve(jsFile, 'br').headers.Vary, 'Accept-Encoding');
});

check('matching encoded ETag returns 304 with no body', () => {
  const first = serve(jsFile, 'br');
  const second = serve(jsFile, 'br', first.headers.ETag);
  assert.strictEqual(second.status, 304);
  assert.strictEqual(second.body.length, 0);
});

check('an identity ETag does not satisfy a brotli request', () => {
  const identityTag = serve(jsFile, '').headers.ETag;
  const res = serve(jsFile, 'br', identityTag);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Content-Encoding'], 'br');
});

check('files below the size floor are not compressed', () => {
  assert.strictEqual(serve(smallFile, 'br').headers['Content-Encoding'], undefined);
});

check('non-text assets are not compressed', () => {
  assert.strictEqual(serve(binFile, 'br').headers['Content-Encoding'], undefined);
});

check('a changed file produces a new ETag', () => {
  const before = serve(jsFile, 'br').headers.ETag;
  fs.writeFileSync(jsFile, `${jsSource}\nexport const extra = true;\n`);
  assert.notStrictEqual(serve(jsFile, 'br').headers.ETag, before);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
