// readModelUsageEventsForSession used to re-read and JSON-parse the entire
// append-only model-usage log on every call. The context-window endpoint polls
// it, so on a 50MB log it blocked the gateway main thread ~1.6s during turn
// prep. It must now parse only appended bytes after the first read, while
// still returning every event for the session (including new ones).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-usage-cache-'));
process.env.PROMETHEUS_CONFIG_DIR = tmp;
process.env.PROMETHEUS_DATA_DIR = tmp;

async function main() {
  const mod: any = await import('./model-usage');
  const { readModelUsageEventsForSession, resetModelUsageIndexForTests } = mod;
  resetModelUsageIndexForTests?.();

  // Find the log path the module uses by writing through the probe below.
  const candidates = [path.join(tmp, 'model-usage.jsonl'), path.join(tmp, '.prometheus', 'model-usage.jsonl')];
  const row = (sid: string, n: number) => JSON.stringify({ sessionId: sid, provider: 'anthropic', model: 'm', inputTokens: n, source: 'provider' }) + '\n';
  for (const c of candidates) {
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, row('a', 1) + row('b', 2) + row('a', 3));
  }

  const first = readModelUsageEventsForSession('a');
  assert.equal(first.length, 2, 'first read returns the session\'s events');

  // Append: new events for 'a' must be visible, and 'b' must not leak in.
  for (const c of candidates) fs.appendFileSync(c, row('a', 4) + row('b', 5));
  const second = readModelUsageEventsForSession('a');
  assert.deepEqual(second.map((e: any) => e.inputTokens), [1, 3, 4], 'appended rows are picked up incrementally');

  // A partial trailing row is not consumed until it is complete.
  for (const c of candidates) fs.appendFileSync(c, row('a', 6).slice(0, 20));
  assert.equal(readModelUsageEventsForSession('a').length, 3, 'partial trailing row is deferred');
  for (const c of candidates) fs.appendFileSync(c, row('a', 6).slice(20));
  assert.deepEqual(readModelUsageEventsForSession('a').map((e: any) => e.inputTokens), [1, 3, 4, 6], 'completed row is read exactly once');

  // Returned arrays are copies: mutating one must not corrupt the cache.
  const copy = readModelUsageEventsForSession('a');
  copy.length = 0;
  assert.equal(readModelUsageEventsForSession('a').length, 4, 'cache is not exposed to callers');

  // Log rotation/truncation falls back to a full re-read.
  for (const c of candidates) fs.writeFileSync(c, row('a', 9));
  assert.deepEqual(readModelUsageEventsForSession('a').map((e: any) => e.inputTokens), [9], 'truncated log is re-read');

  console.log('model-usage-session-cache regression: ok');
}

main().catch((err) => { console.error(err); process.exit(1); });
