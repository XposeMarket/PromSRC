import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { compressLargeJsonResponses, pickJsonResponseEncoding } from './app';
import { sendJsonText } from './json-response';

assert.equal(pickJsonResponseEncoding('gzip, deflate, br'), 'br');
assert.equal(pickJsonResponseEncoding('br;q=0, gzip'), 'gzip');
assert.equal(pickJsonResponseEncoding('identity'), null);
assert.equal(pickJsonResponseEncoding(''), null);
assert.equal(pickJsonResponseEncoding('*;q=0'), null);

const big = { items: Array.from({ length: 400 }, (_, i) => ({ i, text: 'repeated trace payload '.repeat(20) })) };
const small = { ok: true };

const app = express();
// Stand-in for the CORS layer, which sets Vary: Origin before routes run.
app.use((_req, res, next) => { res.vary('Origin'); next(); });
app.use(compressLargeJsonResponses);
app.get('/big', (_req, res) => { res.status(201).json(big); });
app.get('/big-ok', (_req, res) => { res.json(big); });
app.get('/small', (_req, res) => { res.json(small); });
app.get('/text', (req, res) => { sendJsonText(req, res, JSON.stringify(big)); });
app.get('/text-small', (req, res) => { sendJsonText(req, res, JSON.stringify(small)); });

function get(path: string, acceptEncoding?: string, extra: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers = { ...(acceptEncoding ? { 'accept-encoding': acceptEncoding } : {}), ...extra };
    const req = http.request({ host: '127.0.0.1', port: (server.address() as any).port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const br = await get('/big', 'gzip, br');
    assert.equal(br.status, 201, 'status code must survive compression');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(String(br.headers['content-type']), /application\/json/);
    assert.equal(Number(br.headers['content-length']), br.body.length);
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body).toString('utf8')), big);
    assert.ok(br.body.length < JSON.stringify(big).length / 5, 'large repetitive JSON should shrink substantially');

    const gz = await get('/big', 'gzip');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body).toString('utf8')), big);

    const plain = await get('/big');
    assert.equal(plain.headers['content-encoding'], undefined, 'no Accept-Encoding means no compression (node clients)');
    assert.deepEqual(JSON.parse(plain.body.toString('utf8')), big);

    const tiny = await get('/small', 'br');
    assert.equal(tiny.headers['content-encoding'], undefined, 'small bodies stay uncompressed');
    assert.deepEqual(JSON.parse(tiny.body.toString('utf8')), small);

    // Conditional GET survives compression (Express parity) and Vary is appended.
    const ok = await get('/big-ok', 'gzip, deflate, br');
    assert.equal(ok.headers['content-encoding'], 'br');
    assert.ok(ok.headers.etag, 'a compressed response carries an ETag');
    assert.match(String(ok.headers.vary), /Origin/, 'the CORS Vary: Origin is kept');
    assert.match(String(ok.headers.vary), /Accept-Encoding/);
    const okPlain = await get('/big-ok');
    assert.equal(okPlain.headers.etag, ok.headers.etag, 'plain and compressed share one validator (same JSON)');
    const notModified = await get('/big-ok', 'gzip, deflate, br', { 'if-none-match': String(ok.headers.etag) });
    assert.equal(notModified.status, 304, 'If-None-Match on a compressed response gets 304');
    assert.equal(notModified.body.length, 0, '304 has no body');
    assert.equal(notModified.headers['content-encoding'], undefined);
    const stale = await get('/big-ok', 'gzip', { 'if-none-match': 'W/"stale"' });
    assert.equal(stale.status, 200);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(stale.body).toString('utf8')), big);

    const head = await get('/big-ok', 'br', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-encoding'], undefined, 'HEAD is never compressed');
    assert.equal(head.body.length, 0);

    // Routes that already hold the serialized text send it without a second stringify.
    const text = await get('/text', 'br');
    assert.equal(text.headers['content-encoding'], 'br');
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(text.body).toString('utf8')), big);
    assert.equal(text.headers.etag, ok.headers.etag, 'sendJsonText and res.json produce the same validator');
    assert.equal((await get('/text', 'br', { 'if-none-match': String(text.headers.etag) })).status, 304);
    const textPlain = await get('/text');
    assert.equal(textPlain.headers['content-encoding'], undefined);
    assert.match(String(textPlain.headers['content-type']), /application\/json/);
    assert.deepEqual(JSON.parse(textPlain.body.toString('utf8')), big);
    const textSmall = await get('/text-small', 'br');
    assert.equal(textSmall.headers['content-encoding'], undefined);
    assert.ok(textSmall.headers.etag, 'small sendJsonText replies keep Express ETags');
    assert.equal((await get('/text-small', 'br', { 'if-none-match': String(textSmall.headers.etag) })).status, 304);
    assert.deepEqual(JSON.parse(textSmall.body.toString('utf8')), small);

    console.log('json-compression regression: ok');
    server.close();
  } catch (err) {
    console.error(err);
    server.close();
    process.exit(1);
  }
});
