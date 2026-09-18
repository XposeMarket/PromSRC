import assert from 'node:assert/strict';
import { acquireMemoryAccess, getMemoryAccessGateState } from './memory-access-gate';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function main(): Promise<void> {
  // The gate unref()s its queue timeout timers (correct inside the gateway,
  // where the HTTP server keeps the loop alive). In a bare test process that
  // would let Node exit 0 before the timeout in case 4 fires, so hold a ref'd
  // timer for the duration of the test.
  const keepAlive = setTimeout(() => {}, 30_000);
  try {
    await runCases();
  } finally {
    clearTimeout(keepAlive);
  }
}

async function runCases(): Promise<void> {
  // 1. Concurrent searches share the gate.
  {
    const r1 = await acquireMemoryAccess('search');
    const r2 = await acquireMemoryAccess('search');
    assert.equal(getMemoryAccessGateState().activeKind, 'search');
    assert.equal(getMemoryAccessGateState().activeCount, 2);
    r1();
    assert.equal(getMemoryAccessGateState().activeCount, 1);
    r2();
    assert.equal(getMemoryAccessGateState().activeKind, null);
  }

  // 2. Maintenance is exclusive: a search queued behind it waits, but a queued
  //    search is granted BEFORE a queued maintenance pass when the gate frees.
  {
    const releaseMaint = await acquireMemoryAccess('maintenance');
    assert.equal(getMemoryAccessGateState().activeKind, 'maintenance');

    const order: string[] = [];
    const maint2 = acquireMemoryAccess('maintenance').then((rel) => { order.push('maintenance'); return rel; });
    const search = acquireMemoryAccess('search', { timeoutMs: 2000 }).then((rel) => { order.push('search'); return rel; });
    await tick();
    assert.deepEqual(getMemoryAccessGateState().pending, ['maintenance', 'search']);

    releaseMaint();
    const releaseSearch = await search;
    assert.equal(order[0], 'search', 'queued search must preempt queued maintenance');
    assert.equal(getMemoryAccessGateState().activeKind, 'search');
    await tick();
    assert.equal(order.length, 1, 'maintenance must not start while a search is active');

    releaseSearch();
    const releaseMaint2 = await maint2;
    assert.deepEqual(order, ['search', 'maintenance']);
    releaseMaint2();
    assert.equal(getMemoryAccessGateState().activeKind, null);
  }

  // 3. Maintenance never fast-paths ahead of a queued search while another
  //    maintenance holds the gate (no starvation of user searches).
  {
    const releaseMaint = await acquireMemoryAccess('maintenance');
    const search = acquireMemoryAccess('search', { timeoutMs: 2000 });
    await tick();
    const maint2 = acquireMemoryAccess('maintenance');
    releaseMaint();
    const releaseSearch = await search;
    assert.equal(getMemoryAccessGateState().activeKind, 'search');
    releaseSearch();
    (await maint2)();
  }

  // 4. Timeout error is descriptive.
  {
    const releaseMaint = await acquireMemoryAccess('maintenance');
    await assert.rejects(
      acquireMemoryAccess('search', { timeoutMs: 20 }),
      (err: Error) => /timed out after 20ms while queued behind maintenance/.test(err.message),
    );
    releaseMaint();
  }

  console.log('memory-access-gate regression: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
