import assert from 'node:assert/strict';

import { buildContextWindowCurrentState } from './chat.router.js';

const state = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_empty',
  profile: { contextWindowTokens: 272_000, tokenizer: 'heuristic' },
  currentInputTokens: 0,
  messageTokens: 0,
  historyMessages: 0,
  recentToolTokens: 0,
  inputBudgetTokens: 190_000,
  compactionTriggerTokens: 192_000,
  storedThread: { fullStoredThreadTokens: 0 },
  modelUsage: {
    cacheReadTokens: 9_999,
    lastContextCall: {
      estimatedMessageInputTokens: 30_000,
      estimatedSystemPromptTokens: 25_000,
      estimatedProviderInputTokens: 30_000,
      estimatedToolSchemaTokens: 7_000,
    },
  },
});

const rows = state.rows as Array<Record<string, any>>;
const systemPrompt = rows.find((row) => row.id === 'system_prompt');
const children: Array<Record<string, any>> = Array.isArray(systemPrompt?.children) ? systemPrompt.children : [];

assert.equal(state.cachedTokens, 0, 'an empty new chat must not inherit cached tokens from a prior call');
assert.ok(state.currentStateTokens < 25_000, 'an empty new chat must not reuse the prior prompt total');
assert.ok(!children.some((row) => row.id === 'system_prompt.memory'), 'default prompt accounting must not expose the full MEMORY row');
assert.equal(children.find((row) => row.id === 'system_prompt.atomic_memory')?.tokens, 0, 'no user turn means no atomic memories are selected');
assert.match(String(children.find((row) => row.id === 'system_prompt.atomic_memory')?.label || ''), /none/);
assert.ok(children.some((row) => row.id === 'system_prompt.thought_context_packets'), 'Thought packet telemetry must be present in the breakdown');

console.log('context-window regression: ok');
