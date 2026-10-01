import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { staticCacheControl } from '../src/gateway/core/static-cache.ts';
import { shouldRecordWorkerBatchTiming } from '../src/gateway/chat/worker-batch-timing.ts';

const manifest = JSON.parse(readFileSync('generated/public-web-ui/asset-manifest.json', 'utf8'));
const boot = manifest.initial?.mobile?.paths;
assert.ok(Array.isArray(boot) && boot.length > 0, 'mobile boot paths must be present');
const rows = boot.map((file) => {
  const content = readFileSync(path.join('generated/public-web-ui', file.replace(/^\//, '')));
  return { path: file, bytes: content.length, gzip: gzipSync(content).length, brotli: brotliCompressSync(content).length };
}).sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((acc, row) => ({ raw: acc.raw + row.bytes, gzip: acc.gzip + row.gzip, brotli: acc.brotli + row.brotli }), { raw: 0, gzip: 0, brotli: 0 });
for (const file of boot) {
  assert.match(file, /^\/build\/(entries|chunks|styles|inline)\/[^/]+-[a-z0-9]{8,}\.(js|css)$/i, `not content hashed: ${file}`);
  assert.equal(staticCacheControl(`C:\\app\\generated\\public-web-ui${file.replaceAll('/', '\\')}`), 'public, max-age=31536000, immutable');
}
for (const file of ['index.html', 'mobile.html', 'asset-manifest.json', 'service-worker.js', 'src/mobile/mobile-entry.js', 'build/chunks/unhashed.js']) {
  assert.equal(staticCacheControl(`/root/${file}`), 'no-cache', `${file} must revalidate`);
}
assert.equal(staticCacheControl('/root/static/styles/mobile.css'), 'public, max-age=86400');
assert.equal(shouldRecordWorkerBatchTiming('provider_heartbeat'), true);
const batches = Array.from({ length: 2000 }, (_, i) => i + 1).filter((count) => shouldRecordWorkerBatchTiming('event_batch', { eventBatches: count }));
assert.deepEqual(batches, [1, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 50)]);
assert.equal(shouldRecordWorkerBatchTiming('worker_completed', { eventBatches: 2000 }), true);
assert.equal(shouldRecordWorkerBatchTiming('worker_error', { eventBatches: 2000 }), true);
const line = JSON.stringify({ timestamp: '2026-10-01T00:00:00.000Z', elapsedMs: 12345, sessionId: 'benchmark-session', turnId: 'benchmark-turn', phase: 'turn', label: 'model_worker_event_batch', provider: 'openai', model: 'benchmark', eventCount: 1, eventBatches: 2000, eventBytes: 400, totalEventCount: 2000, totalEventBytes: 800000 }) + '\n';
console.log(JSON.stringify({ bootFiles: boot.length, total, top15: rows.slice(0, 15),
  cacheHeadersBefore: { hashed: 'no-cache', html: 'no-cache' }, cacheHeadersAfter: { hashed: staticCacheControl('/root' + boot[0]), html: staticCacheControl('/root/index.html') },
  timing: { batches: 2000, beforeLines: 2000, afterLines: batches.length, beforeBytes: 2000 * Buffer.byteLength(line), afterBytes: batches.length * Buffer.byteLength(line), exampleLineBytes: Buffer.byteLength(line) } }));
