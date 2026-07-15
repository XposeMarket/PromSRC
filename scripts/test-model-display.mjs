import assert from 'node:assert/strict';
import { formatModelDisplayName, formatModelWithReasoning } from '../web-ui/src/model-display.js';

assert.equal(formatModelDisplayName('gpt-5.5', 'openai'), 'GPT 5.5');
assert.equal(formatModelDisplayName('gpt-4.1-mini', 'openai'), 'GPT 4.1 mini');
assert.equal(formatModelDisplayName('gpt-5.3-codex-spark', 'openai_codex'), '5.3 Spark');
assert.equal(formatModelDisplayName('gpt-5.6-sol', 'openai_codex'), '5.6 Sol');
assert.equal(formatModelDisplayName('gpt-5.6-terra', 'openai_codex'), '5.6 Terra');
assert.equal(formatModelDisplayName('gpt-5.6-luna', 'openai_codex'), '5.6 Luna');
assert.equal(formatModelWithReasoning('gpt-5.6-sol', 'openai_codex', 'medium'), '5.6 Sol Medium');
assert.equal(formatModelWithReasoning('gpt-5.5', 'openai', 'high'), 'GPT 5.5 High');
assert.equal(formatModelWithReasoning('gpt-5.3-codex-spark', 'openai_codex', 'xhigh'), '5.3 Spark Extra High');

console.log('model display contract passed');
