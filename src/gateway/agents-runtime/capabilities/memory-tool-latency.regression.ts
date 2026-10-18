import assert from 'node:assert/strict';
import { runStructuredSearchWithBudget } from './memory-executor';
import { acquireMemoryAccess } from '../../memory-index/memory-access-gate';

// Reproduces the 8.7s memory tool call: a structured search queued behind
// index maintenance must be bounded by a short budget and aborted, not wait
// 8s and linger in the worker queue.
async function main(): Promise<void> {
  // 1) Maintenance holds the gate: search waits on the gate like the real worker.
  const releaseMaint = await acquireMemoryAccess('maintenance');
  let aborted = false;
  const t0 = Date.now();
  const out = await runStructuredSearchWithBudget(async (signal) => {
    signal.addEventListener('abort', () => { aborted = true; });
    const release = await acquireMemoryAccess('search', { signal });
    release();
    return 'never';
  }, { maintenanceBudgetMs: 200 });
  const elapsed = Date.now() - t0;
  assert.equal(out.ok, false);
  assert.match((out as any).error, /maintenance/);
  assert.ok(elapsed < 1000, `expected fast skip, took ${elapsed}ms`);
  assert.equal(aborted, true, 'queued task must be aborted on budget expiry');
  releaseMaint();

  // 2) Idle gate + fast worker: result passes through.
  const ok = await runStructuredSearchWithBudget(async () => 'hits', { budgetMs: 500 });
  assert.deepEqual(ok, { ok: true, value: 'hits' });

  // 3) Idle gate + slow active query: skipped on budget, NOT aborted (abort
  // would force-kill and cold-restart the worker).
  let slowAborted = false;
  const slow = await runStructuredSearchWithBudget((signal) => {
    signal.addEventListener('abort', () => { slowAborted = true; });
    return new Promise<string>((r) => setTimeout(() => r('late'), 400));
  }, { budgetMs: 100 });
  assert.equal(slow.ok, false);
  assert.match((slow as any).error, /slow/);
  assert.equal(slowAborted, false);

  // 4) Parent abort propagates.
  const parent = new AbortController();
  let propagated = false;
  const p = runStructuredSearchWithBudget((signal) => new Promise<string>((_, rej) => {
    signal.addEventListener('abort', () => { propagated = true; rej(new Error('aborted')); });
  }), { parentSignal: parent.signal, budgetMs: 2000 });
  parent.abort();
  const pr = await p;
  assert.equal(pr.ok, false);
  assert.equal(propagated, true);

  console.log('memory-tool-latency regression: PASS');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
