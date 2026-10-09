/**
 * npm run test:replay [-- <scenario-id>,<scenario-id>]
 *
 * Boots the replay harness once and runs every scenario in scenarios.ts.
 * Exit 1 when a contract fails or a known gap unexpectedly passes.
 */
import { bootReplayHarness } from './harness';
import { scenarios } from './scenarios';

async function main(): Promise<void> {
  const filter = new Set(String(process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean));
  const startedAt = Date.now();
  const harness = await bootReplayHarness();
  const bootMs = Date.now() - startedAt;
  const rows: string[] = [];
  let failures = 0;
  let xfail = 0;
  let pass = 0;
  for (const scenario of scenarios) {
    if (filter.size && !filter.has(scenario.id)) continue;
    let ok = true;
    let reason = '';
    let elapsed = 0;
    try {
      const run = await harness.runTurn(scenario.input);
      elapsed = run.elapsedMs;
      scenario.check(run);
    } catch (error: any) {
      ok = false;
      reason = String(error?.message || error).split('\n')[0].slice(0, 200);
    }
    if (scenario.kind === 'contract') {
      if (ok) { pass += 1; rows.push(`  PASS   ${scenario.id} (${elapsed}ms)`); }
      else { failures += 1; rows.push(`  FAIL   ${scenario.id} (${elapsed}ms): ${reason}\n         contract: ${scenario.contract}`); }
    } else if (ok) {
      failures += 1;
      rows.push(`  FIXED? ${scenario.id}: known gap now passes. Promote it to kind 'contract'.`);
    } else {
      xfail += 1;
      rows.push(`  XFAIL  ${scenario.id} (${elapsed}ms): ${reason}`);
    }
  }
  harness.shutdown();
  process.stdout.write(`replay harness: boot ${bootMs}ms, total ${Date.now() - startedAt}ms\n${rows.join('\n')}\n`);
  process.stdout.write(`\n${pass} contract(s) passed, ${xfail} known gap(s) still open, ${failures} failure(s)\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  process.stdout.write(`replay harness crashed: ${error?.stack || error}\n`);
  process.exit(1);
});
