// Elision must not rewrite old history on every provider round.
//
// Providers cache the conversation prefix; changing any earlier message
// invalidates the cache from that point on. Before this guard, the live call
// site elided ~1 result per round, so roughly every other request re-wrote a
// ~200k-token prefix (measured on claude-opus-5-5: cacheRead=38k/write=200k
// alternating with cacheRead=240k/write=1k), which slowed first token and
// raised usage. With batchMinChars, history is only rewritten once enough stale
// output has accumulated, so most rounds leave the prefix byte-identical.
import assert from 'node:assert/strict';
import { elideStaleToolResults, TOOL_RESULT_ELISION_BATCH_MIN_CHARS } from './tool-result-elision';

function simulate(batchMinChars: number) {
  const messages: any[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }];
  let rewrites = 0;
  let totalElided = 0;
  const ROUNDS = 120;
  for (let round = 0; round < ROUNDS; round++) {
    const id = `call_${round}`;
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'workspace_run', arguments: '{}' } }] });
    messages.push({ role: 'tool', tool_call_id: id, tool_name: 'workspace_run', content: `result ${round} `.padEnd(4000, 'x') });
    const before = JSON.stringify(messages.slice(0, -2));
    const r = elideStaleToolResults(messages, batchMinChars > 0 ? { batchMinChars } : {});
    const after = JSON.stringify(messages.slice(0, -2));
    if (before !== after) rewrites += 1;
    totalElided += r.elidedCount;
  }
  return { rewrites, totalElided, rounds: ROUNDS };
}

const legacy = simulate(0);
const batched = simulate(TOOL_RESULT_ELISION_BATCH_MIN_CHARS);

// The legacy behaviour rewrote history on most rounds once past the window.
assert.ok(legacy.rewrites >= 60, `expected per-round rewrites without batching, got ${legacy.rewrites}`);
// Batched mode must rewrite rarely, yet still bound context growth.
assert.ok(batched.rewrites <= 8, `batched elision rewrote history ${batched.rewrites} times in ${batched.rounds} rounds`);
assert.ok(batched.totalElided > 0, 'batched elision must still elide stale output eventually');

// Deferred rounds must report the pending size and leave messages untouched.
const small: any[] = [
  { role: 'user', content: 'go' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'a', tool_name: 'x', content: 'y'.repeat(5000) },
];
const snapshot = JSON.stringify(small);
const deferred = elideStaleToolResults(small, { batchMinChars: TOOL_RESULT_ELISION_BATCH_MIN_CHARS });
assert.equal(deferred.elidedCount, 0);
assert.equal(JSON.stringify(small), snapshot, 'deferred rounds must not touch history');

console.log(`tool-result-elision-cache regression passed (legacy rewrites=${legacy.rewrites}, batched rewrites=${batched.rewrites}, elided=${batched.totalElided})`);
