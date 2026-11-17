import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTaskModelRef } from '../gateway/tasks/task-model-ref.js';
import { CODEX_MODELS } from './openai-codex-adapter.js';
import { getReasoningCapability, normalizeReasoningEffort, supportsFastSpeed } from './reasoning-capabilities.js';
import { resolveModelPricing, estimateModelUsageCost } from './model-pricing.js';
import { resolveModelContextProfile } from '../gateway/context/model-context.js';

for (const [model, input, output, cacheRead, cacheWrite] of [
  ['gpt-6.2-astra', 8, 40, 0.4, 10],
  ['gpt-6.2-sol', 2, 10, 0.1, 2.5],
] as const) {
  assert.ok(CODEX_MODELS.includes(model));
  for (const provider of ['openai', 'openai_codex']) {
    const manifest = JSON.parse(fs.readFileSync(`src/extensions/bundled/providers/${provider}/prometheus.extension.json`, 'utf8'));
    assert.ok(manifest.runtime.options.staticModels.includes(model), `${provider} offline catalog`);
    assert.equal(resolveTaskModelRef({ executorProvider: model }, { defaultProvider: () => 'anthropic' })?.providerId, 'openai_codex');
    const capability = getReasoningCapability(provider, model);
    assert.deepEqual(capability.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.notEqual(normalizeReasoningEffort(provider, model, 'none'), 'none');
    assert.ok(supportsFastSpeed(provider, model));
    const profile = resolveModelContextProfile(provider, model, undefined, { llm: { providers: {} } });
    assert.equal(profile.standardContextWindowTokens, 272000);
    assert.equal(profile.maxContextWindowTokens, 1050000);
    assert.equal(profile.maxOutputTokens, 128000);
    const pricing = resolveModelPricing(provider, model);
    assert.equal(pricing.inputMicrosPerToken, input);
    assert.equal(pricing.outputMicrosPerToken, output);
    assert.equal(pricing.cacheReadMicrosPerToken, cacheRead);
    assert.equal(pricing.cacheWriteMicrosPerToken, cacheWrite);
    const standard = estimateModelUsageCost({ provider, model, inputTokens: 272000, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 100 });
    const long = estimateModelUsageCost({ provider, model, inputTokens: 272001, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 100 });
    assert.equal(standard.outputCostMicros, output * 100);
    assert.equal(long.outputCostMicros, output * 150);
    assert.equal(long.cacheReadCostMicros, cacheRead * 200);
    assert.equal(long.cacheWriteCostMicros, cacheWrite * 200);
    assert.equal(long.inputCostMicros, (272001 - 100) * input * 2);
  }
  for (const file of ['pages/SettingsPage.js', 'mobile/mobile-settings.js', 'mobile/mobile-model-badge.js', 'components/agent-model-picker.js', 'legacy-desktop-bootstrap.js']) {
    assert.ok(fs.readFileSync(`web-ui/src/${file}`, 'utf8').includes(`'${model}'`), file);
  }
}
assert.ok(CODEX_MODELS.includes('gpt-6-astra'), 'preserve previous models');
console.log('PASS GPT-6.2 catalog, capabilities, context, pricing and UI parity');
