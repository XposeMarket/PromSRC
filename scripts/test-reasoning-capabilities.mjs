import assert from 'node:assert/strict';
import { getReasoningCapability, normalizeReasoningEffort, normalizeSpeed, supportsFastSpeed } from '../dist/providers/reasoning-capabilities.js';
import { reasoningCapability, supportsFastSpeed as browserSupportsFastSpeed } from '../web-ui/src/reasoning-capabilities.js';

const efforts = (provider, model) => getReasoningCapability(provider, model).efforts;

for (const provider of ['openai', 'openai_codex']) {
  const astra = getReasoningCapability(provider, 'gpt-6-astra');
  assert.deepEqual(astra.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(astra.defaultEffort, 'low');
  assert.deepEqual(reasoningCapability(provider, 'gpt-6-astra'), astra);
  assert.equal(normalizeReasoningEffort(provider, 'gpt-6-astra', 'none'), 'low');
  assert.equal(normalizeReasoningEffort(provider, 'gpt-6-astra', 'ultra'), undefined);
  assert.equal(supportsFastSpeed(provider, 'gpt-6-astra'), true);
  assert.equal(browserSupportsFastSpeed(provider, 'gpt-6-astra'), true);
  for (const model of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const expected = provider === 'openai_codex' && ['gpt-5.6-sol', 'gpt-5.6-terra'].includes(model)
      ? ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
      : ['low', 'medium', 'high', 'xhigh', 'max'];
    assert.deepEqual(efforts(provider, model), expected);
    assert.equal(getReasoningCapability(provider, model).defaultEffort, 'medium');
  }
}
assert.equal(normalizeReasoningEffort('openai_codex', 'gpt-5.6-luna', 'ultra'), undefined);
assert.equal(normalizeReasoningEffort('openai_codex', 'gpt-5.6-sol', 'ultra'), 'ultra');
assert.deepEqual(efforts('openai', 'gpt-5.5'), ['low', 'medium', 'high', 'xhigh']);
assert.equal(normalizeReasoningEffort('openai', 'gpt-5.5', 'minimal'), 'low');
assert.deepEqual(efforts('openai', 'gpt-5'), ['low', 'medium', 'high']);
assert.equal(normalizeReasoningEffort('openai', 'gpt-5', 'none'), 'low');
assert.deepEqual(efforts('openai', 'gpt-4.1'), []);
assert.deepEqual(efforts('openai', 'o3'), ['low', 'medium', 'high']);

assert.deepEqual(efforts('anthropic', 'claude-opus-4-8'), ['low', 'medium', 'high', 'xhigh', 'max']);
assert.deepEqual(efforts('anthropic', 'claude-sonnet-4-6'), ['low', 'medium', 'high', 'max']);
assert.deepEqual(efforts('anthropic', 'claude-opus-4-5'), ['low', 'medium', 'high']);
assert.deepEqual(efforts('anthropic', 'claude-haiku-4-5-20251001'), []);
assert.equal(getReasoningCapability('anthropic', 'claude-opus-4-8').thinkingMode, 'adaptive');
assert.equal(getReasoningCapability('anthropic', 'claude-haiku-4-5-20251001').thinkingMode, 'manual');
assert.deepEqual(efforts('perplexity', 'sonar-reasoning-pro'), ['low', 'medium', 'high']);
assert.deepEqual(efforts('xai', 'grok-4.20-multi-agent'), ['low', 'medium', 'high', 'xhigh']);
assert.deepEqual(efforts('xai', 'grok-4.3'), ['low', 'medium', 'high']);
assert.deepEqual(efforts('xai', 'grok-4.6'), ['low', 'medium', 'high']);
for (const provider of ['openai', 'openai_codex', 'anthropic', 'perplexity', 'xai']) {
  for (const model of ['gpt-5.6', 'gpt-5.5', 'gpt-5', 'claude-sonnet-4-6', 'sonar-reasoning-pro', 'grok-4.6']) {
    assert.ok(!efforts(provider, model).includes('none'), `${provider}/${model} must not expose none`);
    assert.ok(!efforts(provider, model).includes('minimal'), `${provider}/${model} must not expose minimal`);
    if (efforts(provider, model).length) assert.equal(efforts(provider, model)[0], 'low');
  }
}
assert.equal(supportsFastSpeed('openai', 'gpt-5.5'), true);
assert.equal(supportsFastSpeed('openai_codex', 'gpt-5.6-luna'), true);
assert.equal(supportsFastSpeed('openai', 'gpt-5.4-nano'), false);
assert.equal(supportsFastSpeed('anthropic', 'claude-opus-4-8'), true);
assert.equal(supportsFastSpeed('anthropic', 'claude-opus-4-6'), false);
assert.equal(normalizeSpeed('openai', 'gpt-5.4-nano', 'fast'), 'standard');
assert.equal(normalizeSpeed('openai_codex', 'gpt-5.6-luna', 'fast'), 'fast');

console.log('reasoning capability policy: ok');
