import assert from 'node:assert/strict';
import {
  CODEX_IMAGE_CHAT_MODEL_CHAIN,
  isUnsupportedCodexImageChatModel,
  resolveCodexImageChatModelChain,
} from './providers/openai-codex.js';

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; };

check('default chain starts with a current account-compatible model, not a retired pin', () => {
  const chain = resolveCodexImageChatModelChain();
  assert.equal(chain[0], 'gpt-6.1-sol');
  assert.deepEqual(chain, [...CODEX_IMAGE_CHAT_MODEL_CHAIN]);
});

check('chain walks past BOTH retired models (the Oct 2026 failure: gpt-5.5 -> gpt-5.4-codex dead end)', () => {
  const chain = resolveCodexImageChatModelChain();
  const after = chain.slice(chain.indexOf('gpt-5.4-codex'));
  assert.ok(chain.length >= 4, 'more than a single fallback hop');
  assert.ok(chain.indexOf('gpt-6.1-sol') < chain.indexOf('gpt-5.5'));
  assert.equal(after.length, 1, 'gpt-5.4-codex is last-resort only');
});

check('override and remembered model go first, deduped, and the chatgpt alias is ignored', () => {
  const chain = resolveCodexImageChatModelChain('gpt-6-luna', 'gpt-6-sol');
  assert.deepEqual(chain.slice(0, 2), ['gpt-6-luna', 'gpt-6-sol']);
  assert.equal(new Set(chain).size, chain.length);
  assert.equal(resolveCodexImageChatModelChain('chatgpt')[0], 'gpt-6.1-sol');
});

check('detects the exact ChatGPT-account rejection the live backend returned', () => {
  const body = '{"detail":"The \'gpt-5.4-codex\' model is not supported when using Codex with a ChatGPT account."}';
  assert.equal(isUnsupportedCodexImageChatModel(400, body), true);
  assert.equal(isUnsupportedCodexImageChatModel(404, '{"detail":"The model gpt-9 does not exist"}'), true);
});

check('does not treat auth, rate-limit or moderation failures as a model problem', () => {
  assert.equal(isUnsupportedCodexImageChatModel(401, 'not supported when using Codex with a ChatGPT account'), false);
  assert.equal(isUnsupportedCodexImageChatModel(429, '{"detail":"rate limited"}'), false);
  assert.equal(isUnsupportedCodexImageChatModel(400, '{"detail":"Your request was rejected by the safety system"}'), false);
});

console.log(`codex-image-chat-model regression: ${passed} passed`);
