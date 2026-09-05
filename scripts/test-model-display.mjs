import assert from 'node:assert/strict';
import { formatModelDisplayName, formatModelWithReasoning } from '../web-ui/src/model-display.js';
import { effortOptions, reasoningSelectorOptions, supportsFastSpeed } from '../web-ui/src/reasoning-capabilities.js';

assert.equal(formatModelDisplayName('gpt-6-astra', 'openai'), 'Astra 6');
assert.equal(formatModelDisplayName('openai_codex/gpt-6-astra'), 'Astra 6');
assert.equal(formatModelWithReasoning('gpt-6-astra', 'openai_codex', 'medium'), 'Astra 6 Medium');
assert.equal(formatModelWithReasoning('gpt-6-astra', 'openai_codex', 'ultra'), 'Astra 6');
assert.equal(formatModelWithReasoning('gpt-6-astra', 'openai', 'ultra'), 'Astra 6');
assert.deepEqual(reasoningSelectorOptions('openai_codex', 'gpt-6-astra'), ['low', 'medium', 'high', 'xhigh', 'max']);
assert.deepEqual(reasoningSelectorOptions('openai', 'gpt-6-astra'), ['low', 'medium', 'high', 'xhigh', 'max']);
assert.equal(supportsFastSpeed('openai_codex', 'gpt-6-astra'), true);

assert.equal(formatModelDisplayName('gpt-5.5', 'openai'), 'GPT 5.5');
assert.equal(formatModelDisplayName('gpt-4.1-mini', 'openai'), 'GPT 4.1 mini');
assert.equal(formatModelDisplayName('gpt-5.3-codex-spark', 'openai_codex'), '5.3 Spark');
assert.equal(formatModelDisplayName('gpt-5.6-sol', 'openai_codex'), '5.6 Sol');
assert.equal(formatModelDisplayName('gpt-5.6-terra', 'openai_codex'), '5.6 Terra');
assert.equal(formatModelDisplayName('gpt-5.6-luna', 'openai_codex'), '5.6 Luna');
assert.equal(formatModelWithReasoning('gpt-5.6-sol', 'openai_codex', 'medium'), '5.6 Sol Medium');
assert.equal(formatModelWithReasoning('gpt-5.6-luna', 'openai_codex', 'ultra'), '5.6 Luna');
assert.deepEqual(effortOptions('openai_codex', 'gpt-5.6-luna'), ['', 'low', 'medium', 'high', 'xhigh', 'max']);
assert.deepEqual(reasoningSelectorOptions('openai_codex', 'gpt-5.6-luna'), ['low', 'medium', 'high', 'xhigh', 'max']);
assert.ok(effortOptions('openai_codex', 'gpt-5.6-sol').includes('ultra'));
assert.equal(formatModelWithReasoning('gpt-5.5', 'openai', 'high'), 'GPT 5.5 High');
assert.equal(formatModelWithReasoning('gpt-5.3-codex-spark', 'openai_codex', 'xhigh'), '5.3 Spark Extra High');

console.log('model display contract passed');
