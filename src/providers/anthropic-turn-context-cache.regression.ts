import assert from 'node:assert/strict';
import { AnthropicAdapter, anthropicStableCacheTtl, applyAnthropicStableCacheTtl, attachVolatileContextToUserTurn, VOLATILE_TURN_CONTEXT_HEADER } from './anthropic-adapter';
import { PROMPT_CACHE_MARKER, type ChatMessage } from './LLMProvider';

import { estimateModelUsageCost } from './model-pricing';
import { normalizeUsage } from './model-usage';

const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test' });
const context = 'Runtime context unchanged across tool rounds';
const first: ChatMessage[] = [
  { role: 'system', content: `Stable instructions${PROMPT_CACHE_MARKER}${context}` },
  { role: 'user', content: 'Older request' }, { role: 'assistant', content: 'Done' },
  { role: 'user', content: [{ type: 'text', text: 'Current request' }] },
];
const toolRound = (id: string): ChatMessage[] => [
  { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }] },
  { role: 'tool', content: `Result ${id}`, tool_call_id: id },
];
async function request(messages: ChatMessage[]) {
  const built = await (adapter as any).buildMessages(messages);
  assert.equal(attachVolatileContextToUserTurn(built.messages, context, built.turnUserIndex), true);
  return built.messages;
}
async function main() {
  const original = JSON.stringify(first);
  const a = await request(first);
  const b = await request([...first, ...toolRound('one')]);
  const c = await request([...first, ...toolRound('one'), ...toolRound('two')]);
  assert.equal(JSON.stringify(first), original, 'must not mutate caller messages');
  for (const messages of [a, b, c]) {
    assert.equal(JSON.stringify(messages).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1);
    assert.equal(messages[2].content.at(-1).text, `${VOLATILE_TURN_CONTEXT_HEADER}\n${context}`, 'context belongs on source turn, not tool results');
    assert.deepEqual(messages[2].content.at(-1).cache_control, { type: 'ephemeral' });
  }
  assert.equal(JSON.stringify(a.slice(0, 3)), JSON.stringify(b.slice(0, 3)), 'fixed cache prefix bytes identical');
  assert.equal(JSON.stringify(b.slice(0, 3)), JSON.stringify(c.slice(0, 3)));
  const stripMarkers = (messages: any[]) => JSON.stringify(messages, (key, value) => key === 'cache_control' ? undefined : value);
  assert.equal(stripMarkers(b), stripMarkers(c.slice(0, b.length)), 'previous rolling prefix content remains identical');
  assert.equal(b.at(-1).content[0].type, 'tool_result', 'do not alter tool pairing');
  const next = await request([...first, ...toolRound('one'), { role: 'user', content: 'Next turn' }]);
  assert.ok(next.at(-1).content.at(-1).text.includes(context), 'new user turn reanchors');
  assert.ok(!JSON.stringify(next[2]).includes(context), 'old turn not annotated');
  const compacted = await request([{ role: 'system', content: 'Summary' }, ...toolRound('compact')]);
  assert.equal(JSON.stringify(compacted).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1, 'compacted/tool-only fallback retains context');
  assert.equal(attachVolatileContextToUserTurn([], context), false);
  assert.equal(attachVolatileContextToUserTurn([{ role: 'user', content: 'x' }], ''), false);
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
        assert.equal(body.messages.at(-1).content.at(-1).cache_control.ttl, undefined);
        assert.equal(JSON.stringify(body).split(VOLATILE_TURN_CONTEXT_HEADER).length - 1, 1);
        assert.ok(JSON.stringify(body).split('cache_control').length - 1 <= 4);
      }
    }
    assert.equal(JSON.stringify(fetched[0].messages.slice(0, 3)), JSON.stringify(fetched[1].messages.slice(0, 3)), 'actual outgoing request pinned prefix identical');
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
  console.log('PASS pinned context request prefixes, new turns, multimodal, compacted fallback, targeted TTL and mixed-TTL accounting');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
