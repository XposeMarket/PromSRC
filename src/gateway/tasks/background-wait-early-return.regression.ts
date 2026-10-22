import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { waitForSettledOrTimeout } from './task-runner';

// background_ops wait must return as soon as the waited agents settle (wait_ms
// is a cap, not a fixed sleep), must clear its timeout timer on early return,
// and the model-facing schema must say so. Otherwise models treat it as a
// sleep and poll in short loops.

let checks = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  checks++;
  console.log(`  ok - ${label}`);
}

async function main() {
  await check('early settle returns well before the cap and clears the timer', async () => {
    const realClear = global.clearTimeout;
    let cleared = 0;
    (global as any).clearTimeout = (t: any) => { cleared++; return realClear(t); };
    try {
      const t0 = Date.now();
      const settled = await waitForSettledOrTimeout([
        new Promise((r) => setTimeout(r, 50)),
        new Promise((r) => setTimeout(r, 80)),
      ], 5_000);
      const elapsed = Date.now() - t0;
      assert.equal(settled, true);
      assert.ok(elapsed < 1_000, `expected early return, waited ${elapsed}ms`);
      assert.ok(cleared >= 1, 'timeout timer must be cleared after early return');
    } finally {
      (global as any).clearTimeout = realClear;
    }
  });

  await check('never-settling work waits the cap and reports not settled', async () => {
    const t0 = Date.now();
    const settled = await waitForSettledOrTimeout([new Promise(() => {})], 100);
    const elapsed = Date.now() - t0;
    assert.equal(settled, false);
    assert.ok(elapsed >= 90 && elapsed < 1_000, `expected ~100ms, waited ${elapsed}ms`);
  });

  await check('a rejected agent promise counts as settled and does not throw', async () => {
    const settled = await waitForSettledOrTimeout([Promise.reject(new Error('boom')), Promise.resolve()], 5_000);
    assert.equal(settled, true);
  });

  await check('tool schema describes wait as returning early with a max wait_ms', () => {
    const defs = readFileSync(path.join(__dirname, '..', 'tools', 'defs', 'agent-team-schedule.ts'), 'utf8');
    assert.ok(!defs.includes('foreground pause duration'), 'old fixed-pause wording must be gone');
    assert.ok(defs.includes('returns early on completion'), 'background_ops description must mention early return');
    assert.ok(/For wait: maximum milliseconds to wait/.test(defs), 'wait_ms must be described as a maximum');
    assert.ok(/background_wait[\s\S]{0,400}returns early as soon as they all finish/.test(defs), 'background_wait must mention early return');
  });

  console.log(`background-wait-early-return: ${checks}/${checks} passed`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
