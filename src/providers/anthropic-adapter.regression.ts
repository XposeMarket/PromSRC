import assert from 'node:assert/strict';
import { AnthropicAdapter } from './anthropic-adapter';
import { ModelResponseRecovery } from '../gateway/chat/model-response-recovery';
import { PROMPT_CACHE_MARKER, type ChatMessage } from './LLMProvider';

const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' });
const toolA = { function: { name: 'a', description: 'Stable', parameters: { type: 'object', properties: { z: { type: 'string' }, a: { type: 'number' } } } } };
const toolB = { function: { name: 'b', description: 'Stable B', parameters: { properties: {}, type: 'object' } } };
const wire = (tools: any[]) => JSON.stringify((adapter as any).buildTools(tools));
assert.equal(wire([toolB, toolA]), wire([toolA, toolB]), 'registry order must not change wire bytes');
const reorderedA = { function: { ...toolA.function, parameters: { properties: { a: { type: 'number' }, z: { type: 'string' } }, type: 'object' } } };
assert.equal(wire([toolA, toolB]), wire([reorderedA, toolB]), 'schema object key order must not change wire bytes');
assert.equal(JSON.stringify(toolA).includes('cache_control'), false, 'serialization must not mutate source schemas');
assert.notEqual(wire([toolA]), wire([toolA, toolB]), 'new tools still change the complete cache prefix');
// Category retention is provider-neutral now: see src/gateway/tool-category-retention.regression.ts.
const systemBlocks = (adapter as any).buildSystemBlocks(
  `Stable instructions${PROMPT_CACHE_MARKER}Matched skill reference: imagegen`, true,
);
assert.equal(systemBlocks[0]?.text, "You are Claude Code, Anthropic's official CLI for Claude.");
assert.ok(systemBlocks.some((block: any) => String(block.text || '').includes('Matched skill reference: imagegen')));
assert.ok(systemBlocks.findIndex((block: any) => String(block.text || '').includes('Matched skill reference: imagegen')) > 0);
const event = (type: string, fields: object = {}) => ({ type, ...fields });
function stream(events: object[], terminalNewline = true): Response {
  const text = events.map(e => `data: ${JSON.stringify(e)}`).join('\n\n') + (terminalNewline ? '\n\n' : '');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      // Exercise events and UTF-8 across arbitrary transport chunk boundaries.
      for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
const finish = (reason: string) => [
  event('message_delta', { delta: { stop_reason: reason }, usage: { output_tokens: 4096 } }),
  event('message_stop'),
];
const call = [
  event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'write_1', name: 'write_file', input: {} } }),
  event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"game.c","text":"fixed"}' } }),
  event('content_block_stop', { index: 0 }),
];
const text = [
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done ?' } }),
  event('content_block_stop', { index: 0 }),
];

async function main() {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  let nextResponse: () => Response;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return nextResponse();
  };
  const messages: ChatMessage[] = [{ role: 'user', content: 'Fix the game and test it.' }];
  const tools = [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }];
  const recovery = new ModelResponseRecovery();
  const run = () => adapter.chat(messages, 'claude-fable-5-1', {
    tools, onToken: () => {}, think: 'high',
    max_tokens: recovery.outputBudget('anthropic', 'claude-fable-5-1'),
  });
  try {
    // Reproduce reasoning-only -> recovery -> real edit -> final, with tools
    // still offered and no user having to send another message.
    nextResponse = () => stream([
      event('content_block_start', { index: 0, content_block: { type: 'thinking' } }),
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Planning the edit' } }),
      event('content_block_stop', { index: 0 }),
      ...finish('max_tokens'),
    ]);
    const empty = await run();
    assert.equal(empty.stopReason, 'max_tokens');
    assert.equal(empty.message.content, null);
    const decision = recovery.inspect(empty.message, empty.stopReason);
    assert.equal(decision.action, 'retry');
    if (decision.action !== 'retry') throw new Error('Expected continuation');
    messages.push({ role: 'user', content: decision.prompt });
    nextResponse = () => stream([...call, ...finish('tool_use')]);
    const edit = await run();
    assert.equal(requests[0].max_tokens, 16384);
    assert.equal(requests[1].max_tokens, 32768);
    assert.equal(edit.stopReason, 'tool_use');
    assert.equal(edit.message.tool_calls?.[0].function.name, 'write_file');
    assert.equal(recovery.inspect(edit.message, edit.stopReason).action, 'accept');
    messages.push(edit.message, { role: 'tool', tool_call_id: 'write_1', content: 'Saved game.c' });
    nextResponse = () => stream([...text, ...finish('end_turn')], false);
    assert.equal((await run()).message.content, 'Done ?');
    assert.ok(requests.every(r => r.tools?.[0].name === 'write_file'));
    assert.equal(requests.at(-1).messages.at(-1).content[0].type, 'tool_result');

    // Round-trip real wire messages across worker-style serialization. Keep the
    // entire signed prefix when the caller changes context and unlocks a tool.
    const signedHistory: ChatMessage[] = [
      { role: 'system', content: 'Stable policy' + PROMPT_CACHE_MARKER + 'first context' },
      { role: 'user', content: 'Inspect the fixture' },
    ];
    const signedBlocks = [
      { type: 'text', text: 'Checking.' },
      { type: 'thinking', thinking: '', signature: 'part-one-two' },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'tool_use', id: 'a', name: 'write_file', input: { path: 'a' } },
    ];
    nextResponse = () => stream([
      event('content_block_start', { index: 0, content_block: signedBlocks[0] }),
      event('content_block_stop', { index: 0 }),
      event('content_block_start', { index: 1, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      ...['part-one', '-two'].map(signature => event('content_block_delta', { index: 1, delta: { type: 'signature_delta', signature } })),
      event('content_block_stop', { index: 1 }),
      event('content_block_start', { index: 2, content_block: signedBlocks[2] }),
      event('content_block_stop', { index: 2 }),
      event('content_block_start', { index: 3, content_block: signedBlocks[3] }),
      event('content_block_stop', { index: 3 }),
      ...finish('tool_use'),
    ]);
    const signedModel = 'claude-opus-5-5';
    const signed = await adapter.chat(signedHistory, signedModel, { tools, think: 'high', onToken: () => {} });
    const initial = requests.at(-1);
    signedHistory.push(structuredClone(signed.message), { role: 'tool', content: 'file evidence', tool_call_id: 'a' });
    signedHistory[0].content = 'Updated policy' + PROMPT_CACHE_MARKER + 'new context';
    const expanded = [...tools, { type: 'function', function: { name: 'inspect', parameters: { type: 'object' } } }];
    nextResponse = () => Response.json({ content: [{ type: 'tool_use', id: 'b', name: 'inspect', input: {} }], stop_reason: 'tool_use' });
    const expandedRound = await adapter.chat(signedHistory, signedModel, { tools: expanded, think: 'high' });
    const second = requests.at(-1);
    assert.deepEqual(second.messages.find((m: any) => m.role === 'assistant').content, signedBlocks);
    assert.deepEqual(second.tools, initial.tools);
    assert.deepEqual(second.system, initial.system);
    assert.ok(second.messages.at(-1).content.some((b: any) => b.type === 'tool_addition' && b.tool.definition.name === 'inspect'));
    const withoutMarkers = (value: any) => JSON.parse(JSON.stringify(value, (key, val) => key === 'cache_control' ? undefined : val));
    assert.deepEqual(withoutMarkers(second.messages.slice(0, initial.messages.length)), withoutMarkers(initial.messages));
    signedHistory.push(structuredClone(expandedRound.message), { role: 'tool', content: 'inspected', tool_call_id: 'b' });
    await adapter.chat(signedHistory, signedModel, { tools, think: 'high' });
    const third = requests.at(-1);
    assert.deepEqual(withoutMarkers(third.messages.slice(0, second.messages.length)), withoutMarkers(second.messages));
    assert.ok(third.messages.at(-1).content.some((b: any) => b.type === 'tool_removal' && b.tool.name === 'inspect'));
    assert.ok(JSON.stringify(third.messages).includes('file evidence'));

    // Volatile per-turn context leaves `system` and rides after the history
    // cache breakpoint, so history stays a cache hit across turns and rounds.
    const volMessages: ChatMessage[] = [
      { role: 'system', content: `${'Stable policy. '.repeat(400)}${PROMPT_CACHE_MARKER}TODAY_NOTES turn 1` },
      { role: 'user', content: 'yo' },
    ];
    nextResponse = () => stream([...text, ...finish('end_turn')]);
    await adapter.chat(volMessages, 'claude-fable-5-1', { onToken: () => {} });
    const turn1 = requests.at(-1);
    assert.ok(!JSON.stringify(turn1.system).includes('TODAY_NOTES'), 'volatile tail must not stay in system');
    const t1Last = turn1.messages.at(-1).content;
    assert.equal(t1Last.at(-1).cache_control, undefined, 'volatile block stays uncached');
    assert.match(t1Last.at(-1).text, /TODAY_NOTES turn 1/);
    assert.deepEqual(t1Last.at(-2).cache_control, { type: 'ephemeral' }, 'history breakpoint sits before volatile');
    volMessages[0].content = `${'Stable policy. '.repeat(400)}${PROMPT_CACHE_MARKER}TODAY_NOTES turn 2`;
    volMessages.push({ role: 'assistant', content: 'hey' }, { role: 'user', content: 'next' });
    await adapter.chat(volMessages, 'claude-fable-5-1', { onToken: () => {} });
    const turn2 = requests.at(-1);
    assert.deepEqual(turn2.system, turn1.system, 'system prefix identical across turns');
    assert.equal(turn2.messages[0].content, 'yo', 'prior user turn carries no stale volatile');
    const breakpoints = JSON.stringify(turn2).split('"cache_control"').length - 1;
    assert.ok(breakpoints <= 4, `Anthropic allows at most 4 cache breakpoints, got ${breakpoints}`);
    assert.match(turn2.messages.at(-1).content.at(-1).text, /TODAY_NOTES turn 2/);

    // Steer acknowledgements and orphan tool notes must not end with assistant prefill.
    messages.push({ role: 'user', content: 'Use the other install folder.' }, { role: 'assistant', content: 'Understood.' });
    await run();
    assert.equal(requests.at(-1).messages.at(-1).role, 'user');
    messages.push({ role: 'tool', tool_call_id: 'orphan', content: 'Old result' });
    await run();
    assert.equal(requests.at(-1).messages.at(-1).role, 'user');

    // Dropped streams cannot dispatch even a completed tool from a partial batch.
    nextResponse = () => stream(call);
    const dropped = await run();
    assert.equal(dropped.stopReason, 'incomplete_stream');
    assert.equal(dropped.message.tool_calls, undefined);
    // Malformed/truncated arguments must not silently become {}.
    nextResponse = () => stream([
      call[0], event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
      call[2], ...finish('max_tokens'),
    ]);
    const truncated = await run();
    assert.equal(truncated.stopReason, 'max_tokens');
    assert.equal(truncated.message.tool_calls, undefined);
    nextResponse = () => stream([
      ...call,
      event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'write_2', name: 'write_file', input: {} } }),
      event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
      ...finish('max_tokens'),
    ]);
    assert.equal((await run()).message.tool_calls, undefined, 'withhold the whole incomplete batch');
    nextResponse = () => stream([event('error', { error: { type: 'overloaded_error', message: 'Temporarily unavailable' } })]);
    await assert.rejects(run, /stream error: overloaded_error/);
    nextResponse = () => stream(finish('refusal'));
    const refusal = await run();
    assert.equal(refusal.stopReason, 'refusal');
    assert.equal(recovery.inspect(refusal.message, refusal.stopReason).action, 'accept');
    nextResponse = () => Response.json({ content: [{ type: 'text', text: 'Complete' }], stop_reason: 'end_turn' });
    const nonstream = await adapter.chat(messages, 'claude-fable-5-1');
    assert.equal(nonstream.stopReason, 'end_turn');
    assert.equal(nonstream.message.content, 'Complete');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('Anthropic continuation, stream integrity, refusal, and steer regressions passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
