// Regression: parallel admission for read-only wrappers, mixed-batch grouping,
// multi-engine early settle, and the direct-fetch usability gate.
import assert from 'node:assert/strict';
import {
  canExecuteToolCallsInParallel,
  isParallelSafeToolCall,
  partitionToolCallsForParallelExecution,
} from './parallel-tool-calls.js';
import { isUsableDirectFetchResult, settleSearchProvidersEarly } from './web.js';

async function main(): Promise<void> {
  // Read-only wrapper actions overlap; mutating actions never do.
  assert.equal(isParallelSafeToolCall({ name: 'skill_read', args: { id: 'a' } }), true);
  assert.equal(isParallelSafeToolCall({ name: 'memory', args: { action: 'search', query: 'x' } }), true);
  assert.equal(isParallelSafeToolCall({ name: 'memory', args: { action: 'write', content: 'x' } }), false);
  assert.equal(isParallelSafeToolCall({ name: 'connector_github', args: { action: 'get_pr', pr_number: 1 } }), true);
  assert.equal(isParallelSafeToolCall({ name: 'connector_github', args: { action: 'merge_pr', pr_number: 1 } }), false);
  assert.equal(isParallelSafeToolCall({ name: 'connector_github', args: { action: 'api_request', path: '/x' } }), true);
  assert.equal(isParallelSafeToolCall({ name: 'connector_github', args: { action: 'api_request', path: '/x', method: 'POST' } }), false);
  assert.equal(isParallelSafeToolCall({ name: 'background_ops', args: { action: 'spawn', prompt: 'x' } }), false);
  assert.equal(canExecuteToolCallsInParallel([
    { name: 'skill_read', args: { id: 'a' } },
    { name: 'skill_read', args: { id: 'b' } },
    { name: 'web_search', args: { query: 'q' } },
  ]), true, 'skill reads + web search batch should overlap');

  // Mixed batch: reads before a write form one group; the write stays alone and in order.
  const groups = partitionToolCallsForParallelExecution([
    { id: '1', name: 'workspace_read', args: { action: 'read', path: 'a' } },
    { id: '2', name: 'workspace_read', args: { action: 'read', path: 'b' } },
    { id: '3', name: 'workspace_edit', args: { action: 'find_replace', path: 'a' } },
    { id: '4', name: 'workspace_read', args: { action: 'read', path: 'a' } },
  ]);
  assert.deepEqual(groups.map((g) => [g.parallel, g.calls.map((c) => c.id)]), [
    [true, ['1', '2']],
    [false, ['3']],
    [false, ['4']],
  ]);

  // Multi-engine: a slow engine must not hold a fast engine's results past the grace window.
  const fast = Promise.resolve({ success: true, data: { results: [{ url: 'u', title: 't', snippet: 's' }] } } as any);
  const slow = new Promise<any>((resolve) => setTimeout(() => resolve({ success: true, data: { results: [] } }), 3000));
  const started = Date.now();
  const settled = await settleSearchProvidersEarly([fast, slow], 100);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `early settle took ${elapsed}ms`);
  assert.equal(settled[0].status, 'fulfilled');
  assert.equal(settled[1].status, 'rejected');
  // All engines failing still waits for every engine.
  const allFail = await settleSearchProvidersEarly([Promise.reject(new Error('a')), Promise.resolve({ success: false } as any)], 100);
  assert.deepEqual(allFail.map((s) => s.status), ['rejected', 'fulfilled']);

  // Direct fetch gate: thin or bot-wall pages go to TinyFish.
  assert.equal(isUsableDirectFetchResult({ success: true, stdout: 'x'.repeat(2000) }), true);
  assert.equal(isUsableDirectFetchResult({ success: true, stdout: 'short' }), false);
  assert.equal(isUsableDirectFetchResult({ success: true, stdout: `Just a moment... ${'y'.repeat(2000)}` }), false);
  assert.equal(isUsableDirectFetchResult({ success: false, error: 'HTTP 403' }), false);

  console.log('web/parallel speed regression passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
