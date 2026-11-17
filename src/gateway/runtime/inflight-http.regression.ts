// In-flight HTTP tracking for the memory high-water log, plus compact worker
// diagnostics (each line used to be ~13 KB of per-worker resource detail).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listInflightHttp, resetInflightHttpForTests, sanitizeRequestPath, trackInflightHttp } from './inflight-http';
import { buildMemoryHighWaterEvent, compactRuntimeWorkersForHighWater, formatMemoryHighWaterLine } from './gateway-memory-highwater';

const MB = 1024 * 1024;

// Query strings (auth tokens) never reach the log.
assert.equal(sanitizeRequestPath('/api/agents/reel/chat?limit=20&token=SECRET'), '/api/agents/reel/chat');
assert.equal(sanitizeRequestPath('/a#frag'), '[non-api]');
assert.equal(sanitizeRequestPath(''), '[non-api]');
assert.equal(sanitizeRequestPath('/api/x/' + 'a'.repeat(500)), '/api/x/:id');
// Secrets in path segments never reach the log (tracking runs before auth).
assert.equal(sanitizeRequestPath('/secret-funnel-token/api/status'), '[non-api]');
assert.equal(sanitizeRequestPath('http://host/path'), '[non-api]');
assert.equal(sanitizeRequestPath('/api/x/AbC123token'), '/api/x/:id');
assert.equal(sanitizeRequestPath('/api/x/AbC123token?auth=hidden'), '/api/x/:id');
assert.equal(sanitizeRequestPath('http://h:1/api/agents/abc123/chat?t=1'), '/api/agents/:id/chat');
assert.equal(sanitizeRequestPath('/api/agents/builder_mvnb3jr1/chat'), '/api/agents/:id/chat');
assert.equal(sanitizeRequestPath('/api/canvas/generated-image-preview'), '/api/canvas/generated-image-preview');
assert.equal(sanitizeRequestPath('/api/files/%2e%2e'), '/api/files/:id');
assert.equal(sanitizeRequestPath('/api/a/b/c/d/e/f/g/h'), '/api/a/b/c/d/e/f');

// Tracked until finish OR close (aborted clients), oldest first.
resetInflightHttpForTests();
const mk = (url: string) => ({ req: { method: 'get', url } as any, res: new EventEmitter() as any });
const a = mk('/api/agents/reel/chat?limit=20');
const b = mk('/api/projects');
trackInflightHttp(a.req, a.res, 1_000);
trackInflightHttp(b.req, b.res, 2_000);
let open = listInflightHttp(5_000);
assert.equal(open.total, 2);
assert.deepEqual(open.requests[0], { method: 'GET', path: '/api/agents/reel/chat', ageMs: 4_000 });
b.res.emit('finish');
a.res.emit('close');
a.res.emit('finish'); // double-fire is harmless
open = listInflightHttp(5_000);
assert.equal(open.total, 0);

// Compact worker diagnostics: totals + name/pid/rss only.
const rawWorkers = {
  at: 1,
  workers: [
    { name: 'model-call-1', state: 'busy', pid: 11, activeRequestId: 'r1', resource: { rssBytes: 300 * MB, heapUsedBytes: 100 * MB, heapTotalBytes: 1, externalBytes: 1, arrayBuffersBytes: 1, cpuPercent: 3, extra: 'x'.repeat(5000) } },
    { name: 'memory-search', state: 'idle', resource: { rssBytes: 250 * MB, heapUsedBytes: 90 * MB } },
  ],
  aggregate: { workers: 2, rssBytes: 550 * MB, heapUsedBytes: 190 * MB, heapTotalBytes: 0, externalBytes: 0, arrayBuffersBytes: 0, cpuPercent: 3 },
};
const compact = compactRuntimeWorkersForHighWater(rawWorkers) as any;
assert.deepEqual(compact, {
  count: 2,
  rssMb: 550,
  heapUsedMb: 190,
  workers: [{ name: 'model-call-1', pid: 11, rssMb: 300 }, { name: 'memory-search', rssMb: 250 }],
});
assert.equal(compactRuntimeWorkersForHighWater(undefined), undefined);

// Full event stays small and names open requests.
const event = buildMemoryHighWaterEvent({
  now: 10_000,
  pid: 1,
  uptimeSec: 60,
  decision: { log: true, peakBytes: 2048 * MB, caughtBetweenSamples: false },
  previousPeakBytes: 1792 * MB,
  memory: { rss: 2048 * MB, heapUsed: 1700 * MB, heapTotal: 1800 * MB, external: 10 * MB, arrayBuffers: 5 * MB },
  heapLimitBytes: 8192 * MB,
  modelBusyCount: 1,
  lastMainSessionId: 'mobile_x',
  runtimes: [],
  runtimeWorkers: rawWorkers,
  inflightHttp: { total: 1, requests: [{ method: 'GET', path: '/api/agents/reel/chat', ageMs: 62_000 }] },
}) as any;
assert.equal(event.inflightHttpCount, 1);
assert.deepEqual(event.inflightHttp, [{ method: 'GET', path: '/api/agents/reel/chat', ageSec: 62 }]);
assert.ok(JSON.stringify(event).length < 2_000, `event too large: ${JSON.stringify(event).length}`);
assert.match(formatMemoryHighWaterLine(event), /http: GET \/api\/agents\/reel\/chat/);

console.log('inflight-http + compact high-water regression: PASS');
