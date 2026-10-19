import assert from 'node:assert/strict';
import { aggregateHubUsageAnalytics, readHubUsageAnalytics } from './hub-usage-analytics';

const now = Date.parse('2026-10-18T12:00:00.000Z');
const result = aggregateHubUsageAnalytics([
  { timestamp: '2026-10-18T11:15:00.000Z', provider: 'openai', model: 'gpt-test', callType: 'chat', inputTokens: 100, outputTokens: 25, reasoningTokens: 0, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 125, source: 'provider', totalCostMicros: 250, durationMs: 200, agentId: 'writer', executionMode: 'desktop' },
  { timestamp: '2026-10-18T11:45:00.000Z', provider: 'openai', model: 'gpt-test', callType: 'chat', inputTokens: 20, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 10, totalTokens: 25, source: 'provider', totalCostMicros: 0, durationMs: 100, agentId: 'writer', executionMode: 'desktop' },
  { timestamp: '2026-10-18T10:00:00.000Z', provider: 'anthropic', model: 'claude-test', callType: 'chat', inputTokens: 10, outputTokens: 2, reasoningTokens: 0, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 20, source: 'estimated', agentId: 'researcher' },
  { timestamp: '2026-10-16T11:00:00.000Z', provider: 'openai', model: 'old', callType: 'chat', inputTokens: 999, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 999, source: 'provider' },
] as any, { range: '24h', now });

assert.deepEqual(result.providers, ['anthropic', 'openai']);
assert.deepEqual(result.totals, { totalTokens: 170, inputTokens: 130, outputTokens: 32, cacheReadTokens: 58, cacheWriteTokens: 10, requests: 3, costMicros: 250, pricedRequests: 2, cacheHitPercent: 30.85 });
assert.equal(result.models[0].provider, 'openai');
assert.equal(result.models[0].averageDurationMs, 150);
assert.deepEqual(result.agents.map((row) => row.name), ['writer', 'researcher']);
assert.deepEqual(result.surfaces.map((row) => row.name), ['desktop', 'unknown']);
assert.equal(result.series.length, 25, '24h range includes quiet hours and partial edges');
assert.equal(result.series.filter(row => Object.keys(row.values).length).length, 2);
assert.equal(result.coverage.inRangeEvents, 3);
assert.equal(result.coverage.bucket, 'hour');
const filtered = aggregateHubUsageAnalytics([{ timestamp: '2026-10-18T11:00:00.000Z', provider: 'openai', model: 'gpt-test', callType: 'chat', inputTokens: 1, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1, source: 'provider' }] as any, { range: '24h', provider: 'anthropic', now });
assert.equal(filtered.totals.requests, 0);
assert.deepEqual(filtered.providers, ['openai'], 'provider selector options remain available when filtered');

async function testAsyncWindowReads() {
  for (const [range, days] of [['24h', 1], ['7d', 7], ['30d', 30], ['invalid', 7]] as const) {
    let calls = 0;
    const analytics = await readHubUsageAnalytics({ range, provider: 'openai', now }, async cutoff => {
      calls += 1;
      assert.equal(cutoff, now - days * 24 * 60 * 60_000, 'reader must receive the normalized window cutoff');
      await Promise.resolve();
      return [{ timestamp: new Date(now).toISOString(), provider: 'openai', model: 'async-test', callType: 'chat', inputTokens: 10, outputTokens: 2, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 12, source: 'provider', totalCostMicros: 42 }];
    });
    assert.equal(calls, 1, 'one indexed read per request');
    assert.equal(analytics.totals.totalTokens, 12, 'aggregate awaited reader results');
    assert.equal(analytics.totals.costMicros, 42);
    assert.equal(analytics.coverage.providerFilter, 'openai');
    assert.equal(analytics.coverage.until, new Date(now).toISOString());
    assert.equal(analytics.range, range === 'invalid' ? '7d' : range);
  }
  await assert.rejects(readHubUsageAnalytics({ now }, async () => { throw new Error('ledger read failed'); }), /ledger read failed/);
  console.log('hub usage analytics regression passed');
}
void testAsyncWindowReads().catch(error => { console.error(error); process.exitCode = 1; });
