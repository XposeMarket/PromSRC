// Regression for the 2026-10-03 core-tools test findings: chart shapes,
// shopping non-product filter, compact memory hits, X API error text, and
// connectors whose stale "healthy" record outlived a dead login.
import assert from 'node:assert/strict';
import { normalizeChartSeriesArgs, formatStructuredMemoryHits } from './core-tool-normalizers.js';
import { isNonProductPage } from '../../tools/web.js';
import { describeXApiError } from '../../extensions/bundled/connectors/x/x-api-client.js';
import { PrometheusExtensionRuntimeRegistry } from '../../extensions/runtime-registry.js';

// 1. The exact show_chart call that failed: labels[] + data[] at the top level.
const flat = normalizeChartSeriesArgs({ chartType: 'bar', labels: ['chatgpt_sandbox', 'shopping'], data: [5600, 3600] });
assert.equal(flat.length, 1);
assert.deepEqual(flat[0].points, [{ x: 'chatgpt_sandbox', y: 5600 }, { x: 'shopping', y: 3600 }]);
const datasets = normalizeChartSeriesArgs({ labels: ['a', 'b'], datasets: [{ label: 'ms', data: [1, 2] }] });
assert.deepEqual(datasets[0].points, [{ x: 'a', y: 1 }, { x: 'b', y: 2 }]);
const canonical = normalizeChartSeriesArgs({ series: [{ label: 's', points: [{ x: 1, y: 2 }] }] });
assert.deepEqual(canonical[0].points, [{ x: 1, y: 2 }]);
assert.deepEqual(normalizeChartSeriesArgs({}), []);

// 2. Shopping: reviews/videos out, real product pages in.
assert.equal(isNonProductPage('https://www.nytimes.com/wirecutter/reviews/best-usb-c-cables/', 'The Best USB-C Cables'), true);
assert.equal(isNonProductPage('https://www.youtube.com/watch?v=abc', 'Anker 240W cable test'), true);
assert.equal(isNonProductPage('https://www.amazon.com/240-watt-usb-c-cable/s?k=240+watt+usb+c+cable', '240 watt usb c cable'), true, 'search listing pages are not products');
assert.equal(isNonProductPage('https://www.walmart.com/search?q=usb+c+cable', 'usb c cable'), true);
assert.equal(isNonProductPage('https://www.amazon.com/dp/B0C1234567', 'Anker USB-C to USB-C Cable 240W', '$12.99'), false);
assert.equal(isNonProductPage('https://www.bestbuy.com/site/anker-cable/6512345.p', 'Anker 240W USB-C Cable', '$19.99'), false);

// 3. Memory structured hits render as short lines, not a JSON blob.
const memo = formatStructuredMemoryHits(JSON.stringify({ hits: [{ title: 'PR #515', preview: 'browser speed', recordType: 'decision', timestamp: '2026-10-02T10:00:00Z', recordId: 'r1', chunkId: 'c1', canonicalKey: 'k' }], stats: { records: 9 } }));
assert.match(memo, /^- \[decision 2026-10-02\] PR #515 id=r1/);
assert.ok(!memo.includes('chunkId') && !memo.includes('canonicalKey'));

// 4. X errors say what to do.
assert.match(describeXApiError(402, '{"title":"Payment Required","type":"https://api.x.com/2/problems/credits-depleted"}'), /out of API credits/);
assert.match(describeXApiError(403, '{"type":"https://api.twitter.com/2/problems/unsupported-authentication"}'), /app-only Bearer token/);

// 5. A connector runtime that reports disconnected hides its tools even if
//    a canonical connection record still claims healthy (Gmail/Drive case).
const registry = new PrometheusExtensionRuntimeRegistry();
registry.registerConnector('ext', { id: 'zz_dead', name: 'Dead', isConnected: () => false });
registry.registerTool('ext', { name: 'connector_zz_dead_list', description: 'x', parameters: { type: 'object', properties: {} }, connectorId: 'zz_dead', execute: async () => ({ result: 'ok', error: false }) } as any);
assert.equal(registry.isToolAvailable('connector_zz_dead_list'), false);
assert.equal(registry.listConnectedConnectorToolDefinitions().length, 0);

console.log('core-tools-broken regression passed');
