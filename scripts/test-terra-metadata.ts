import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getReasoningCapability, normalizeReasoningEffort, supportsFastSpeed } from '../src/providers/reasoning-capabilities';
import * as context from '../src/gateway/context/model-context';
import { resolveModelPricing, estimateModelUsageCost } from '../src/providers/model-pricing';
import { CODEX_MODELS } from '../src/providers/openai-codex-adapter';

const model = 'gpt-6.1-terra';
for (const provider of ['openai', 'openai_codex']) {
  assert.deepEqual(getReasoningCapability(provider, model), { efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' });
  assert.equal(normalizeReasoningEffort(provider, model, 'none'), 'none');
  assert.equal(normalizeReasoningEffort(provider, model, 'ultra'), undefined);
  assert.equal(supportsFastSpeed(provider, model), true);
  const catalog = JSON.parse(readFileSync(`src/extensions/bundled/providers/${provider}/prometheus.extension.json`, 'utf8'));
  assert.ok(catalog.runtime.options.staticModels.includes(model));
}
assert.ok(CODEX_MODELS.includes(model));
const pricing = resolveModelPricing('openai', model);
assert.equal(pricing.inputMicrosPerToken, 1);
assert.equal(pricing.outputMicrosPerToken, 5);
assert.equal(pricing.cacheReadMicrosPerToken, 0.05);
const cost = (inputTokens: number, provider = 'openai') => estimateModelUsageCost({ provider, model, inputTokens, outputTokens: 100, cacheReadTokens: 100 });
assert.equal(cost(272000).inputCostMicros, 271900);
assert.equal(cost(272000).cacheReadCostMicros, 5);
assert.equal(cost(272000).outputCostMicros, 500);
assert.equal(cost(272001).inputCostMicros, 543802);
assert.equal(cost(272001).cacheReadCostMicros, 10);
assert.equal(cost(272001).outputCostMicros, 750);
assert.equal(cost(272001, 'openai_codex').totalCostMicros, cost(272001).totalCostMicros);
// Exercise the actual exported resolver rather than reimplementing profile rules.
const resolver = (context as any).resolveModelContextProfile;
assert.equal(typeof resolver, 'function');
for (const providerId of ['openai', 'openai_codex']) {
  const profile = resolver(providerId, model, undefined, {});
  assert.equal(profile.contextWindowTokens, 272000);
  assert.equal(profile.maxContextWindowTokens, 1050000);
  assert.equal(profile.maxOutputTokens, 128000);
}
const codexSource = readFileSync('src/providers/openai-codex-adapter.ts', 'utf8');
const fallbackTable = codexSource.split('const CHATGPT_ACCOUNT_CODEX_MODEL_FALLBACKS:')[1].split('};')[0];
assert.ok(!fallbackTable.includes(model), 'Terra must not silently fall back');
console.log('Terra metadata: capabilities, context, pricing, catalogs and exact Codex routing PASS');

// Execute the production think-mode expression, including multi-agent fallback.
const pipeline = readFileSync(new URL('../src/gateway/routes/chat/pipeline/handle-chat.ts', import.meta.url), 'utf8');
const assignment = pipeline.slice(pipeline.indexOf('const primaryThinkMode:'));
const expression = assignment.slice(assignment.indexOf('=') + 1, assignment.indexOf(';'));
const thinkMode = new Function('requestedThinkMode', 'multiAgentActive', 'isActiveAutomationOp', 'activeProviderForThinking', `return (${expression});`);
assert.equal(thinkMode('none', true, false, 'openai'), false);
assert.equal(thinkMode('high', true, false, 'openai'), 'high');
assert.equal(thinkMode(undefined, true, false, 'openai'), true);
