import assert from 'node:assert/strict';
import { attemptModelDigest, buildDeterministicTurnDigest } from './degraded-turn-finish';

const tools = [
  { name: 'workspace_read', args: { path: 'src/example.ts' }, result: 'Read 19 lines', error: false },
  { name: 'workspace_read', args: { path: 'src/example.ts' }, result: 'Read 19 lines', error: false },
  { name: 'workspace_run', args: { command: 'npx tsc --noEmit' }, result: 'Compilation failed', error: true },
];
const broken = buildDeterministicTurnDigest(tools, { reason: 'incomplete_stream', cause: 'invalid_tool_json', partialText: 'I was checking types.' });
assert.match(broken, /tool calls kept arriving with broken arguments/);
assert.match(broken, /workspace_read \(path: src\/example\.ts\): ok - Read 19 lines \(repeated 2 times\)/);
assert.equal((broken.match(/^- workspace_read /gm) || []).length, 1);
assert.match(broken, /workspace_run .*failed - Compilation failed/);
assert.match(broken, /Last thing I was doing[\s\S]*I was checking types/);
for (const [reason, cause, expected] of [
  ['incomplete_stream', 'connection reset', 'the response stream kept dropping'],
  ['incomplete_stream', 'tool_block_unterminated', 'tool calls kept arriving with broken arguments'],
  ['max_tokens', '', 'the model hit its output limit'],
  ['provider_failure', 'connection refused', 'the provider call failed: connection refused'],
] as const) assert.match(buildDeterministicTurnDigest(tools, { reason, cause }), new RegExp(expected));
const many = Array.from({ length: 40 }, (_, i) => ({ name: `call_${i}`, args: { path: `file_${i}` }, result: `result_${i}`, error: false }));
const capped = buildDeterministicTurnDigest(many, { reason: 'max_tokens' });
assert.equal((capped.match(/^- call_/gm) || []).length, 25);
assert.match(capped, /call_0/);
assert.match(capped, /call_39/);
assert.match(capped, /\.\.\. 15 more/);
for (const text of [broken, capped, buildDeterministicTurnDigest([], { reason: 'provider_failure', cause: 'offline' })]) {
  assert.doesNotMatch(text, /\u2014/);
  assert.match(text, /Say 'continue' and I'll pick up from here\./);
}
assert.match(buildDeterministicTurnDigest([], { reason: 'provider_failure', cause: 'offline' }), /No tool results were saved/);
const short = buildDeterministicTurnDigest(many, { reason: 'max_tokens', maxChars: 450 });
assert.ok(short.length <= 450);
assert.match(short, /Say 'continue' and I'll pick up from here\./);

async function main() {
  let calls = 0;
  const success = await attemptModelDigest(tools, {
    reason: 'max_tokens', userRequest: 'Fix types',
    providerCall: async (messages, options) => {
      calls++;
      assert.deepEqual(options.tools, []);
      assert.equal(options.num_predict, 1200);
      assert.match(messages[1].content, /Compilation failed/);
      return { message: { content: 'I read the file; compilation is unfinished. Next fix types.' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(success, 'I read the file; compilation is unfinished. Next fix types.');
  const throwing = await attemptModelDigest(tools, { reason: 'provider_failure', providerCall: async () => { throw new Error('offline'); } });
  assert.equal(throwing, null);
  const timedOut = await attemptModelDigest(tools, {
    reason: 'incomplete_stream', timeoutMs: 10,
    providerCall: async () => new Promise(() => {}),
  });
  assert.equal(timedOut, null);
  console.log('Degraded turn finish regression passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
