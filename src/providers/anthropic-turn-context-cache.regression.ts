import assert from 'node:assert/strict';
import { AnthropicAdapter, anthropicStableCacheTtl, applyAnthropicStableCacheTtl, attachVolatileContextToUserTurn, VOLATILE_TURN_CONTEXT_HEADER } from './anthropic-adapter';
import { PROMPT_CACHE_MARKER, type ChatMessage } from './LLMProvider';

import { estimateModelUsageCost } from './model-pricing';
import { normalizeUsage } from './model-usage';

const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: '***' });
const toolRound = (id: string): ChatMessage[] => [
  { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }] },
  { role: 'tool', content: `Result ${id}`, tool_call_id: id },
];
/** Mirrors chat(): buildMessages places the rolling breakpoint, then the volatile tail is attached. */
async function request(messages: ChatMessage[], context: string) {
  const built = await (adapter as any).buildMessages(messages);
  assert.equal(attachVolatileContextToUserTurn(built.messages, context), true);
  return built.messages as any[];
}
/** Flatten to cache-relevant blocks: role + block body, markers stripped, marker positions recorded. */
function flatten(messages: any[]) {
  const blocks: string[] = [];
  const marks: number[] = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    for (const block of content) {
      const { cache_control, ...body } = block;
      blocks.push(JSON.stringify([m.role, body]));
      if (cache_control) marks.push(blocks.length - 1);
    }
  }
  return { blocks, marks };
}
/** Anthropic reuses an entry only if every block up to its breakpoint is byte-identical in the next request. */
function reusableBreakpoints(prev: any[], next: any[]) {
  const a = flatten(prev);
  const b = flatten(next);
  return a.marks.filter((mark) => mark < b.blocks.length && a.blocks.slice(0, mark + 1).every((block, i) => block === b.blocks[i]));
}
async function main() {
  const base: ChatMessage[] = [
    { role: 'system', content: `Stable instructions${PROMPT_CACHE_MARKER}ctx` },
    { role: 'user', content: 'Older request' }, { role: 'assistant', content: 'Done' },
    { role: 'user', content: [{ type: 'text', text: 'Current request' }] },
  ];
  const original = JSON.stringify(base);
  // Turn 1: first request plus two tool rounds, all with the same runtime context.
  const t1a = await request(base, 'context turn 1');
  const t1b = await request([...base, ...toolRound('one')], 'context turn 1');
  const t1c = await request([...base, ...toolRound('one'), ...toolRound('two')], 'context turn 1');
  assert.equal(JSON.stringify(base), original, 'must not mutate caller messages');
  for (const messages of [t1a, t1b, t1c]) {
    const tail = messages.at(-1).content;
    assert.equal(JSON.stringify(messages).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1, 'context appears exactly once');
    assert.equal(tail.at(-1).text, `${VOLATILE_TURN_CONTEXT_HEADER}\ncontext turn 1`, 'context is the final block');
    assert.equal(tail.at(-1).cache_control, undefined, 'context block is never a cache breakpoint');
    assert.deepEqual(tail.at(-2).cache_control, { type: 'ephemeral' }, 'rolling breakpoint sits right before the context');
  }
  assert.equal(t1b.at(-1).content[0].type, 'tool_result', 'tool pairing unchanged');
  // Within a turn every breakpoint written by round k is reusable by round k+1.
  assert.equal(reusableBreakpoints(t1a, t1b).length, flatten(t1a).marks.length, 'round 1 cache reused by round 2');
  assert.equal(reusableBreakpoints(t1b, t1c).length, flatten(t1b).marks.length, 'round 2 cache reused by round 3');
  // Cross-turn: context CHANGES, yet the last turn's rolling history entry must still be reusable.
  // (#777 pinned a breakpoint on the context block; this assertion fails there: 0 reusable.)
  const turn2Input = [...base, ...toolRound('one'), ...toolRound('two'), { role: 'assistant', content: 'Finished' } as ChatMessage, { role: 'user', content: 'Next turn' } as ChatMessage];
  const t2 = await request(turn2Input, 'context turn 2 (different notes, time, usage)');
  assert.equal(reusableBreakpoints(t1c, t2).length, flatten(t1c).marks.length, 'turn 1 history cache reused by turn 2');
  assert.ok(!JSON.stringify(t2.slice(0, -1)).includes('context turn 1'), 'older turns carry no stale context');
  assert.ok(t2.at(-1).content.at(-1).text.includes('context turn 2'), 'new turn gets fresh context');
  const compacted = await request([{ role: 'system', content: 'Summary' }, ...toolRound('compact')], 'ctx');
  assert.equal(JSON.stringify(compacted).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1, 'compacted/tool-only history still carries context');
  assert.equal(attachVolatileContextToUserTurn([], 'ctx'), false);
  assert.equal(attachVolatileContextToUserTurn([{ role: 'user', content: 'x' }], ''), false);
  assert.equal(attachVolatileContextToUserTurn([{ role: 'assistant', content: 'x' }], 'ctx'), false);
  const context = 'Runtime context unchanged across tool rounds';
  const first = base;
  for (const kind of ['heartbeat', 'cron', 'scheduled', 'background', 'background_task', 'direct_subagent', 'team_subagent']) assert.equal(anthropicStableCacheTtl(kind), '1h');
  for (const kind of [undefined, 'main', 'interactive', 'mobile', 'unknown']) assert.equal(anthropicStableCacheTtl(kind), '5m');
  const fetched: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    fetched.push(JSON.parse(String(init?.body)));
    return Response.json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
  };
  const messages = [{ role: 'system', content: `${'Stable '.repeat(1000)}${PROMPT_CACHE_MARKER}${context}` }, ...first.slice(1)] as ChatMessage[];
  try {
    for (const cacheWorkload of ['heartbeat', 'interactive']) {
      for (const round of [messages, [...messages, ...toolRound('full')]]) {
        await adapter.chat(round, 'claude-haiku-4-5', { think: false, cacheWorkload, tools: [{ function: { name: 'read', parameters: { type: 'object', properties: {} } } }] });
        const body = fetched.at(-1);
        const ttl = cacheWorkload === 'heartbeat' ? '1h' : undefined;
        assert.equal(body.tools.at(-1).cache_control.ttl, ttl);
        assert.equal(body.system.find((block: any) => block.cache_control).cache_control.ttl, ttl);
        assert.equal(body.messages.at(-1).content.at(-1).cache_control, undefined, 'outgoing context block uncached');
        assert.equal(body.messages.at(-1).content.at(-2).cache_control.ttl, undefined, 'rolling history stays 5m');
        assert.equal(JSON.stringify(body).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1);
        assert.ok(JSON.stringify(body).split('cache_control').length - 1 <= 4);
      }
    }
    assert.ok(flatten(fetched[0].messages).marks.length > 0);
    assert.equal(reusableBreakpoints(fetched[0].messages, fetched[1].messages).length, flatten(fetched[0].messages).marks.length, 'actual outgoing round 1 history cache reused by round 2');
    // Retry tool slimming recreates a 5m marker: reapply policy to preserve TTL ordering.
    const retry = fetched[0]; retry.tools.at(-1).cache_control = { type: 'ephemeral' };
    applyAnthropicStableCacheTtl(retry, 'heartbeat');
    assert.equal(retry.tools.at(-1).cache_control.ttl, '1h');
  } finally { globalThis.fetch = originalFetch; }
  const parsed = (adapter as any).parseResponse({ content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 60 } } }).usage;
  assert.equal(parsed.cacheWrite1hTokens, 60);
  const normalized = normalizeUsage(parsed, { inputTokens: 0, outputTokens: 0 });
  assert.equal(normalized.cacheWrite1hTokens, 60);
  assert.equal(normalized.totalTokens, 110, '1h subset not counted twice');
  const costs = estimateModelUsageCost({ provider: 'anthropic', model: 'claude-haiku-4-5', ...normalized });
  assert.equal(costs.cacheWriteCostMicros, 40 * 1.25 + 60 * 2);
  const legacy = estimateModelUsageCost({ provider: 'anthropic', model: 'claude-haiku-4-5', cacheWriteTokens: 100 });
  assert.equal(legacy.cacheWriteCostMicros, 125);
  const other = estimateModelUsageCost({ provider: 'openai_codex', model: 'gpt-6-astra', cacheWriteTokens: 100, cacheWrite1hTokens: 60 });
  assert.equal(other.cacheWriteCostMicros, 1250, 'other provider accounting unchanged');
  assert.equal((adapter as any).mergeStreamingUsage(10, 1, 20, 100, 60).cacheWrite1hTokens, 60);
  console.log('PASS uncached trailing context, within-turn and cross-turn cache reuse, compacted fallback, targeted TTL and mixed-TTL accounting');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
