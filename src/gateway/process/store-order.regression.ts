import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessRunStore } from './store';

// Newest-first order is kept without re-sorting ~25k records per /api/processes
// call, survives output-driven rewrites, and per-chat listing is not limited to
// the newest 500 runs across all chats.
function rec(runId: string, startedAt: number, sessionId: string): any {
  return { runId, sessionId, startedAt: new Date(startedAt).toISOString(), command: 'x', cwd: '.', mode: 'background' };
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-proc-store-'));
  try {
    const base = Date.parse('2026-10-01T00:00:00Z');
    const seed = new ProcessRunStore(dir);
    // 700 runs: chat "old" only in the oldest 50, so list(500)+filter would miss it.
    for (let i = 0; i < 700; i += 1) seed.writeRecord(rec(`r${i}`, base + i * 1000, i < 50 ? 'old' : `s${i % 7}`));

    const store = new ProcessRunStore(dir);
    await store.prime();
    const ids = (list: any[]) => list.map((r) => r.runId);
    assert.deepEqual(ids(store.listRecords(3)), ['r699', 'r698', 'r697'], 'newest first after prime');
    assert.equal(store.listRecords(10_000).length, 500, 'limit capped at 500');

    const old = store.listRecordsForSession('old', 100);
    assert.equal(old.length, 50, 'per-chat listing reaches runs older than the newest 500');
    assert.equal(old[0].runId, 'r49', 'per-chat listing is newest first');
    assert.equal(store.listRecordsForSession('old', 5).length, 5, 'per-chat limit');

    // Output-driven rewrite (same startedAt) keeps order.
    store.writeRecord({ ...rec('r698', base + 698 * 1000, 's5'), title: 'rewritten' });
    assert.deepEqual(ids(store.listRecords(3)), ['r699', 'r698', 'r697'], 'rewrite keeps order');
    assert.equal(store.listRecords(2)[1].title, 'rewritten', 'rewrite visible');

    // New newest run goes to the front; an out-of-order insert re-sorts correctly.
    store.writeRecord(rec('rNew', base + 10_000_000, 's1'));
    assert.equal(store.listRecords(1)[0].runId, 'rNew', 'new run is newest');
    store.writeRecord(rec('rPast', base + 500, 'old'));
    assert.deepEqual(ids(store.listRecordsForSession('old', 2)), ['r49', 'r48'], 'out-of-order insert placed by time');
    assert.ok(ids(store.listRecordsForSession('old', 100)).includes('rPast'), 'out-of-order insert listed');

    // Timing guard: repeated list calls must not re-sort.
    for (let i = 0; i < 25_000; i += 1) (store as any).recordCache.set(`bulk${i}`, rec(`bulk${i}`, base - i * 1000, 'bulk'));
    (store as any).sortedIds = null;
    store.listRecords(100); // one rebuild
    const t = performance.now();
    for (let i = 0; i < 20; i += 1) store.listRecords(100);
    const per = (performance.now() - t) / 20;
    assert.ok(per < 5, `listRecords(100) on 25k records took ${per.toFixed(1)} ms (must not re-sort)`);
    console.log(`process store order regression passed (prime order, cap, per-chat beyond 500, rewrite, insert, ${per.toFixed(2)} ms/list on 25k)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
