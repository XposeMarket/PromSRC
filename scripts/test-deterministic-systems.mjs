import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tsx = process.platform === 'win32'
  ? path.join(repoRoot, 'node_modules', '.bin', 'tsx.cmd')
  : path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const includeWorkers = process.argv.includes('--workers');

const pureCases = [
  ['tool-category-manifest', 'tsx', 'src/runtime/tool-category-manifest.regression.ts'],
  ['tool-category-prompt-signals', 'tsx', 'src/runtime/tool-category-prompt-signals.regression.ts'],
  ['tool-category-routing', 'tsx', 'src/runtime/tool-category-routing.regression.ts'],
  ['instruction-segment-registry', 'tsx', 'src/runtime/instruction-segment-registry.regression.ts'],
  ['instruction-intent-benchmark', 'tsx', 'src/runtime/instruction-intent-benchmark.regression.ts'],
  ['skill-routing-benchmark', 'tsx', 'src/runtime/skill-routing-benchmark.regression.ts'],
  ['skill-catalog-routing', 'tsx', 'src/runtime/skill-catalog-routing.regression.ts'],
  ['prompt-manifest', 'tsx', 'src/runtime/prompt-manifest.regression.ts'],
  ['extension-activation-planner', 'tsx', 'src/extensions/activation-planner.regression.ts'],
  ['extension-tool-contracts', 'tsx', 'src/extensions/tool-contracts.regression.ts'],
  ['stage4-menu-pilot', 'tsx', 'src/runtime/stage4-menu-pilot.regression.ts'],
  ['tool-category-activation', 'tsx', 'src/gateway/tool-category-activation.regression.ts'],
  ['tool-category-provisioning', 'tsx', 'src/gateway/tool-category-provisioning.regression.ts'],
  ['memory-atoms', 'tsx', 'src/gateway/memory-index/memory-atoms.regression.ts'],
  ['memory-atoms-hybrid', 'tsx', 'src/gateway/memory-index/memory-atoms-hybrid.regression.ts'],
  ['memory-atoms-real-corpus', 'tsx', 'src/gateway/memory-index/memory-atoms-real-corpus.stress.ts'],
  ['memory-bounds', 'tsx', 'src/gateway/memory-index/memory-bounds.regression.ts'],
  ['memory-platform', 'tsx', 'src/gateway/memory/memory-platform.regression.ts'],
  ['memory-wrapper', 'tsx', 'src/gateway/agents-runtime/capabilities/memory-wrapper.regression.ts'],
  ['turn-context-packet', 'tsx', 'src/gateway/context/turn-context-packet.regression.ts'],
  ['context-window', 'tsx', 'src/gateway/context/context-window-usage.regression.ts'],
  ['context-build-worker', 'tsx', 'src/gateway/chat/context-build-worker.regression.ts'],
  ['subagent-prompt-context', 'tsx', 'src/gateway/subagent-prompt-context.regression.ts'],
  ['coding-context-packet', 'tsx', 'src/gateway/coding-context-packet.regression.ts'],
  ['activity-package', 'tsx', 'src/gateway/brain/activity-package.regression.ts'],
  ['brain-continuity', 'tsx', 'src/gateway/brain/brain-continuity.regression.ts'],
  ['brain-thought-runtime', 'tsx', 'src/gateway/brain/brain-thought-runtime.regression.ts'],
  ['brain-cognition-integrity', 'tsx', 'src/gateway/brain/brain-cognition-integrity.regression.ts'],
  ['brain-dream-memory-contract', 'tsx', 'src/gateway/brain/brain-dream-memory-contract.regression.ts'],
  ['brain-run-outcome', 'tsx', 'src/gateway/brain/brain-run-outcome.regression.ts'],
  ['brain-proposal-policy', 'tsx', 'src/gateway/brain/brain-proposal-policy.regression.ts'],
  ['brain-runner-progress', 'tsx', 'src/gateway/brain/brain-runner-progress.regression.ts'],
];

const workerCases = [
  ['memory-search-worker', 'tsx', 'src/gateway/memory-index/memory-search-worker.regression.ts'],
  ['memory-search-worker-readiness', 'tsx', 'src/gateway/memory-index/memory-search-worker-readiness.regression.ts'],
  ['automatic-memory-search', 'tsx', 'src/gateway/memory-index/automatic-memory-search.regression.ts'],
  ['automatic-memory-prewarm', 'tsx', 'src/gateway/memory-index/automatic-memory-prewarm.regression.ts'],
  ['runtime-worker-broker', 'tsx', 'src/gateway/process/runtime-worker-broker.regression.ts'],
  ['model-call-worker-pool', 'tsx', 'src/gateway/process/model-call-worker-pool.regression.ts'],
  ['model-call-worker-pool-expansion', 'tsx', 'src/gateway/process/model-call-worker-pool-expansion.regression.ts'],
];

const cases = includeWorkers ? [...pureCases, ...workerCases] : pureCases;
const failures = [];
const startedAt = Date.now();

for (const [label, kind, relativePath] of cases) {
  console.log(`\n=== ${label} ===`);
  const executable = kind === 'tsx' ? tsx : process.execPath;
  const result = spawnSync(executable, [relativePath], {
    cwd: repoRoot,
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '' },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failures.push({
      label,
      status: result.status,
      signal: result.signal,
      error: result.error ? String(result.error.message || result.error) : undefined,
    });
  }
}

const summary = {
  mode: includeWorkers ? 'full_no_llm_with_workers' : 'deterministic_no_llm',
  cases: cases.length,
  passed: cases.length - failures.length,
  failed: failures.length,
  elapsedMs: Date.now() - startedAt,
  failures,
};
console.log(`\n${JSON.stringify(summary, null, 2)}`);
if (failures.length) process.exitCode = 1;
