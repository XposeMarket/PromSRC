import assert from 'node:assert/strict';
import { getReasoningCapability, normalizeReasoningEffort, normalizeSpeed, supportsFastSpeed } from '../dist/providers/reasoning-capabilities.js';

const efforts = (provider, model) => getReasoningCapability(provider, model).efforts;

for (const provider of ['openai', 'openai_codex']) {
  for (const model of ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.deepEqual(efforts(provider, model), provider === 'openai_codex'
      ? ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
      : ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(getReasoningCapability(provider, model).defaultEffort, 'medium');
  }
}
assert.deepEqual(efforts('openai', 'gpt-5.5'), ['none', 'low', 'medium', 'high', 'xhigh']);
assert.equal(normalizeReasoningEffort('openai', 'gpt-5.5', 'minimal'), undefined);
assert.deepEqual(efforts('openai', 'gpt-5'), ['minimal', 'low', 'medium', 'high']);
assert.equal(normalizeReasoningEffort('openai', 'gpt-5', 'none'), undefined);
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
assert.deepEqual(efforts('xai', 'grok-4.3'), ['none', 'low', 'medium', 'high']);
assert.equal(supportsFastSpeed('openai', 'gpt-5.5'), true);
assert.equal(supportsFastSpeed('openai', 'gpt-5.4-nano'), false);
assert.equal(supportsFastSpeed('anthropic', 'claude-opus-4-8'), true);
assert.equal(supportsFastSpeed('anthropic', 'claude-opus-4-6'), false);
assert.equal(normalizeSpeed('openai', 'gpt-5.4-nano', 'fast'), 'standard');

console.log('reasoning capability policy: ok');
