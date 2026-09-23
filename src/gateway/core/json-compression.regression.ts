import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { compressLargeJsonResponses, pickJsonResponseEncoding } from './app';

assert.equal(pickJsonResponseEncoding('gzip, deflate, br'), 'br');
assert.equal(pickJsonResponseEncoding('br;q=0, gzip'), 'gzip');
assert.equal(pickJsonResponseEncoding('identity'), null);
assert.equal(pickJsonResponseEncoding(''), null);
assert.equal(pickJsonResponseEncoding('*;q=0'), null);

const big = { items: Array.from({ length: 400 }, (_, i) => ({ i, text: 'repeated trace payload '.repeat(20) })) };
const small = { ok: true };

const app = express();
app.use(compressLargeJsonResponses);
app.get('/big', (_req, res) => { res.status(201).json(big); });
app.get('/small', (_req, res) => { res.json(small); });

function get(path: string, acceptEncoding?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: (server.address() as any).port, path, headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
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

    console.log('json-compression regression: ok');
    server.close();
  } catch (err) {
    console.error(err);
    server.close();
    process.exit(1);
  }
});
