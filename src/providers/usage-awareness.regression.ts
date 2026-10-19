import assert from 'node:assert/strict';
import { formatUsageAwarenessForPrompt as format, recordUsageApiSnapshot as record, resetUsageAwarenessForTests as reset } from './usage-awareness';
import type { UsageLimitsResult } from './provider-usage-limits';

async function main() {
  reset();
  const now = Date.now();
  const window = (used_percent: number, reset_at = new Date(now + 3600000).toISOString()) => ({ label: '5-hour', used_percent, reset_at });
  record('anthropic', [window(90)]);
  record('openai_codex', [window(10)]);
  const block = format(['anthropic', 'openai_codex', 'anthropic'], now, 'anthropic');
  assert.equal(block.split('\n').filter(line => line.startsWith('anthropic:')).length, 1);
  assert.match(block, /openai_codex: 5-hour 90% left \(resets in 1h 0m\)/);
  assert.match(block, /Low:/);
  assert.match(block, /more headroom/);
  record('anthropic', [window(99)]);
  assert.match(format('anthropic'), /CRITICAL:/);
  assert.match(format(['openai_codex'], now + 6 * 60000), /openai_codex: unknown/);
  record('expired', [window(1, new Date(now - 1000).toISOString())]);
  assert.match(format('expired'), /expired: unknown/);
  let calls = 0;
  let resolve!: (value: UsageLimitsResult) => void;
  let batch: string[] = [];
  reset(ids => { calls++; batch = ids; return new Promise(done => { resolve = done; }); });
  const ids = ['stale', 'missing', 'ollama', 'failed'];
  record('stale', [window(1, new Date(now - 1000).toISOString())]);
  const immediate = format(ids);
  assert.equal(typeof immediate, 'string');
  assert.equal(calls, 0, 'refresh must not execute during synchronous formatting');
  ids.forEach(id => assert.match(immediate, new RegExp(`${id}: unknown`)));
  format(ids);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(batch, ids);
  format(ids);
  await Promise.resolve();
  assert.equal(calls, 1, 'in-flight batch deduplicates repeated turns');
  resolve({ fetched_at: new Date().toISOString(), providers: [
    { provider: 'missing', windows: [window(20)], budget: null, error: null },
    { provider: 'ollama', windows: [], budget: { used_percent: 25 }, error: null },
    { provider: 'failed', windows: [window(1)], budget: null, error: 'secret/path must not appear' },
  ] as any });
  await new Promise(done => setImmediate(done));
  const refreshed = format(ids);
  assert.match(refreshed, /missing: 5-hour 80% left/);
  assert.match(refreshed, /ollama: internal budget 75% left/);
  assert.match(refreshed, /failed: unknown/);
  assert.doesNotMatch(refreshed, /secret|path/);
  reset(async () => { throw new Error('sensitive'); });
  format(['xai']);
  await new Promise(done => setImmediate(done));
  assert.match(format(['xai']), /xai: unknown/);
  reset();
  console.log('PASS usage-awareness: multiple/healthy/stale/expired/missing/local/failed, deduped nonblocking refresh, budget, caution');
  console.log(block);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
