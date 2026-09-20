import assert from 'node:assert/strict';

import {
  canExecuteToolCallsInParallel,
  executeToolCallsInParallel,
  getParallelToolCallLimit,
  partitionToolCallsForParallelExecution,
} from './parallel-tool-calls.js';

async function main(): Promise<void> {
  assert.equal(getParallelToolCallLimit(1), 2, 'the executor must keep a useful minimum width');
  assert.equal(getParallelToolCallLimit(20), 8, 'the executor must cap untrusted batch width');

  const independentReads = [
    { id: 'read-1', name: 'read_file', args: { path: 'a.ts' } },
    { id: 'search-1', name: 'grep_files', args: { pattern: 'TODO' } },
    { id: 'web-1', name: 'web_search', args: { query: 'parallel tool calls' } },
  ];
  assert.equal(canExecuteToolCallsInParallel(independentReads), true);
  assert.equal(canExecuteToolCallsInParallel([
    { name: 'workspace_read', args: { action: 'grep', path: 'a.ts', pattern: 'TODO' } },
    { name: 'workspace_read', args: { action: 'stats', path: 'b.ts' } },
  ]), true, 'read-only workspace wrappers should overlap');
  const independentStarts = [
    { name: 'workspace_run', args: { action: 'start', command: 'npm run build', cwd: 'repo-a', parallel_safe: true, parallel_key: 'repo-a' } },
    { name: 'workspace_run', args: { action: 'start', command: 'npm run build', cwd: 'repo-b', parallel_safe: true, parallel_key: 'repo-b' } },
  ];
  assert.equal(canExecuteToolCallsInParallel(independentStarts), true, 'independent process starts should overlap');
  assert.equal(canExecuteToolCallsInParallel([
    { name: 'workspace_run', args: { action: 'run', command: 'git status', parallel_safe: true, parallel_key: 'repo-a' } },
    { name: 'workspace_run', args: { action: 'run', command: 'git status', parallel_safe: true, parallel_key: 'repo-b' } },
  ]), true, 'independent terminal probes should overlap');
  assert.equal(canExecuteToolCallsInParallel([
    { name: 'workspace_run', args: { action: 'wait', runId: 'run-a' } },
    { name: 'workspace_run', args: { action: 'wait', runId: 'run-b' } },
  ]), true, 'waits for distinct existing processes should overlap');
  assert.equal(canExecuteToolCallsInParallel([
    independentStarts[0],
    { name: 'workspace_run', args: { action: 'wait', runId: 'run-b' } },
  ]), false, 'start and wait should use separate tool-call rounds');
  assert.equal(canExecuteToolCallsInParallel([
    independentStarts[0],
    { name: 'workspace_read', args: { action: 'read', path: 'repo-a/output.txt' } },
  ]), false, 'a shell start must not race a separate file read');
  assert.equal(canExecuteToolCallsInParallel([
    independentStarts[0],
    { name: 'workspace_run', args: { action: 'start', command: 'npm test', parallel_safe: true, parallel_key: 'repo-a' } },
  ]), false, 'same mutable resource must remain serial');
  assert.equal(canExecuteToolCallsInParallel([
    independentStarts[0],
    { name: 'workspace_run', args: { action: 'start', command: 'npm test', parallel_key: 'repo-b' } },
  ]), false, 'shell parallelism must be explicitly marked');
  assert.equal(canExecuteToolCallsInParallel([
    independentStarts[0],
    { name: 'workspace_run', args: { action: 'start', command: 'npm test', parallel_safe: true, parallel_key: 'repo-b', elevated: true } },
  ]), false, 'elevated commands stay serial');
  let activeStarts = 0;
  let peakStarts = 0;
  const startedRuns = await executeToolCallsInParallel(independentStarts, async (_call, index) => {
    activeStarts += 1;
    peakStarts = Math.max(peakStarts, activeStarts);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeStarts -= 1;
    return `run-${index}`;
  });
  assert.equal(peakStarts, 2, 'admitted process starts must actually dispatch concurrently');
  assert.deepEqual(startedRuns.map((outcome) => outcome.result), ['run-0', 'run-1']);
  assert.equal(
    canExecuteToolCallsInParallel([
      ...independentReads,
      { id: 'write-1', name: 'write_file', args: { path: 'a.ts', content: 'changed' } },
    ]),
    false,
    'mutating calls must not be admitted to a parallel-only batch',
  );
  assert.equal(
    canExecuteToolCallsInParallel([
      { name: 'read_file', args: { path: 'a.ts' } },
      { name: 'read_file', args: { path: 'a.ts' } },
    ]),
    false,
    'duplicate calls should not be fanned out accidentally',
  );

  const groups = partitionToolCallsForParallelExecution([
    { name: 'read_file', args: { path: 'a.ts' } },
    { name: 'list_files', args: { path: '.' } },
    { name: 'write_file', args: { path: 'a.ts', content: 'changed' } },
    { name: 'read_file', args: { path: 'b.ts' } },
  ]);
  assert.deepEqual(groups.map((group) => [group.parallel, group.calls.map((call) => call.name)]), [
    [true, ['read_file', 'list_files']],
    [false, ['write_file']],
    [false, ['read_file']],
  ]);

  let active = 0;
  let maxActive = 0;
  const calls = Array.from({ length: 5 }, (_, index) => ({
    id: `call-${index}`,
    name: 'read_file',
    args: { path: `file-${index}.ts` },
  }));
  const outcomes = await executeToolCallsInParallel(
    calls,
    async (_call, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8 + (index % 2) * 4));
      active -= 1;
      return `result-${index}`;
    },
    { maxConcurrency: 2 },
  );

  assert.equal(maxActive, 2, 'the bounded executor must respect maxConcurrency');
  assert.deepEqual(outcomes.map((outcome) => outcome.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(outcomes.map((outcome) => outcome.result), [
    'result-0',
    'result-1',
    'result-2',
    'result-3',
    'result-4',
  ]);

  console.log('parallel tool call regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
