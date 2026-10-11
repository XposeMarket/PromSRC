import { spawnSync } from 'node:child_process';

// Run the bounded evidence/feedback foundation without requiring compiled dist.
const tests = [
  'src/runtime/context-receipt.regression.ts',
  'src/runtime/prompt-manifest.regression.ts',
  'src/gateway/voice/context-cache-key.regression.ts',
  'src/gateway/learning/learning-loop.regression.ts',
  'src/gateway/learning/skill-routing-observability.regression.ts',
  'src/gateway/learning/skill-review-dispatch.regression.ts',
  'src/gateway/audit/audit-ops.regression.ts',
];
for (const test of tests) {
  console.log(`\n[context-routing] ${test}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', test], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nPASS context-routing foundation');
