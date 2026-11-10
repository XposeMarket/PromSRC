/**
 * npm run test:idle-round-ceiling
 *
 * Both polarities of the idle-round ceiling, run through the real turn loop:
 *   - parallel-rounds-are-not-idle: rounds that ran as one parallel batch are work.
 *   - runaway-turn-has-a-ceiling:   a model repeating a blocked call is still stopped.
 * The scenarios themselves live in scenarios.ts so `npm run test:replay` covers them too.
 */
import { bootReplayHarness } from './harness';
import { scenarios } from './scenarios';

const IDS = ['parallel-rounds-are-not-idle', 'runaway-turn-has-a-ceiling'];

async function main(): Promise<void> {
  const harness = await bootReplayHarness();
  let failures = 0;
  for (const id of IDS) {
    const scenario = scenarios.find((entry) => entry.id === id);
    if (!scenario) {
      failures += 1;
      process.stdout.write(`  FAIL   ${id}: scenario not found in scenarios.ts\n`);
      continue;
    }
    try {
      scenario.check(await harness.runTurn(scenario.input));
      process.stdout.write(`  PASS   ${id}\n`);
    } catch (error: any) {
      failures += 1;
      process.stdout.write(`  FAIL   ${id}: ${String(error?.message || error).split('\n')[0].slice(0, 200)}\n`);
    }
  }
  harness.shutdown();
  process.stdout.write(failures ? `idle-round ceiling regression: ${failures} failure(s)\n` : 'idle-round ceiling regression: PASS\n');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  process.stdout.write(`idle-round ceiling regression crashed: ${error?.stack || error}\n`);
  process.exit(1);
});
