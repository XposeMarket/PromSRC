import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnthropicAdapter, ANTHROPIC_MODELS, anthropicContextWindowTokens } from './anthropic-adapter';
import { getReasoningCapability, supportsFastSpeed } from './reasoning-capabilities';
import { resolveModelPricing } from './model-pricing';
import { resolveModelContextProfile } from '../gateway/context/model-context';
import { normalizeProviderModel } from '../agents/model-routing';

const models = ['claude-fable-5-2', 'claude-mythos-5-2'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const originalFetch = globalThis.fetch;
const adapter = new AnthropicAdapter({ providerId: 'anthropic', apiKey: 'test-not-a-secret' });
let request: any;
let response: any = { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' };
globalThis.fetch = async (_url, init) => {
  request = JSON.parse(String(init?.body));
  return Response.json(response);
};
async function main() {
  try {
    for (const model of models) {
      assert.ok(ANTHROPIC_MODELS.includes(model));
      assert.equal(supportsFastSpeed('anthropic', model), true);
      assert.deepEqual(getReasoningCapability('anthropic', model).efforts, efforts);
      assert.equal(getReasoningCapability('anthropic', model).defaultEffort, 'high');
      assert.equal(anthropicContextWindowTokens(model), 1_000_000);
      const context = resolveModelContextProfile('anthropic', model, undefined, {});
      assert.equal(context.contextWindowTokens, 1_000_000);
      assert.equal(context.maxOutputTokens, 128_000);
      const price = resolveModelPricing('anthropic', model);
      assert.deepEqual([price.inputMicrosPerToken, price.outputMicrosPerToken, price.cacheReadMicrosPerToken, price.cacheWriteMicrosPerToken], [8, 40, .2, 10]);
      assert.equal(normalizeProviderModel('anthropic', model.replace('claude-', '').replace('-5-2', '-5.2')), model);
      for (const think of [...efforts, false, 'none'] as const) {
        await adapter.chat([{ role: 'user', content: 'Hello' }], model, { think, max_tokens: 256 });
        assert.equal(request.model, model);
        assert.equal(request.thinking.type, 'adaptive');
        assert.equal(request.thinking.budget_tokens, undefined);
        if (typeof think === 'string' && think !== 'none') assert.equal(request.output_config.effort, think);
        for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) assert.equal(request[key], undefined);
      }
      await adapter.chat([{ role: 'user', content: 'Fast' }], model, { speed: 'fast', think: 'low', max_tokens: 256 });
      assert.equal(request.speed, 'fast');
      response = { content: [{ type: 'thinking', thinking: '', signature: 'test-prefix-signature' }, { type: 'tool_use', id: 'tool_1', name: 'lookup', input: { query: 'test' } }], stop_reason: 'tool_use' };
      const first = await adapter.chat([{ role: 'user', content: 'Look up test' }], model, { think: 'high', max_tokens: 256 });
      assert.equal(first.message.tool_calls?.[0]?.function?.name, 'lookup');
      response = { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
      await adapter.chat([{ role: 'user', content: 'Look up test' }, first.message, { role: 'tool', content: 'Found', tool_call_id: 'tool_1' }], model, { think: 'high', max_tokens: 256 });
      assert.ok(JSON.stringify(request.messages).includes('tool_result'));
      assert.ok(!JSON.stringify(request.messages).includes('test-prefix-signature'));
      assert.ok(!request.messages.some((m: any) => m.content?.some?.((b: any) => b.type === 'thinking')));
    }
    await adapter.chat([{ role: 'user', content: 'Hello' }], 'claude-haiku-4-5-20251001', { think: false, max_tokens: 256 });
    assert.equal(request.thinking, undefined);
    assert.equal(anthropicContextWindowTokens('claude-haiku-4-5-20251001'), 200_000);
    assert.equal(getReasoningCapability('openai', models[0]).thinkingMode, undefined);
    assert.notEqual(resolveModelPricing('anthropic', 'claude-fable-5-1').inputMicrosPerToken, 8);
    for (const file of ['components/agent-model-picker.js', 'legacy-desktop-bootstrap.js', 'pages/SettingsPage.js', 'mobile/mobile-settings.js', 'mobile/mobile-model-badge.js']) {
      const source = readFileSync(`web-ui/src/${file}`, 'utf8');
      for (const model of models) assert.ok(source.includes(`'${model}'`), `${file} missing ${model}`);
    }
    globalThis.fetch = async () => Response.json({ error: { type: 'permission_error', message: 'Model access requires verification' } }, { status: 403 });
    await assert.rejects(adapter.chat([{ role: 'user', content: 'Hello' }], models[1], { think: 'low', max_tokens: 256 }), /verification|403/);
    console.log('PASS Claude 5.2 catalogs, aliases, limits, pricing, efforts, request policy, tool continuation and access denial');
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
