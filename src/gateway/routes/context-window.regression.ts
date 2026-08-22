import assert from 'node:assert/strict';

import { buildContextWindowCurrentState } from './chat.router.js';

const state = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_empty',
  profile: { contextWindowTokens: 272_000, tokenizer: 'heuristic' },
  currentInputTokens: 0,
  messageTokens: 0,
  fullMessageTokens: 0,
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

const previousTurnsRow = {
  id: 'previous_turns',
  label: 'Previous turns',
  tokens: 80,
  active: true,
  includedInContext: true,
  percentBasis: 'window',
  estimated: true,
  children: [
    { id: 'previous_turns.atomic_memory', label: 'Atomic memories (1 unique)', tokens: 50, active: true },
    { id: 'previous_turns.thought_context_packets', label: 'Thought context packets (1 unique)', tokens: 30, active: true },
  ],
};

const threaded = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_threaded',
  profile: { contextWindowTokens: 272_000, tokenizer: 'heuristic' },
  currentInputTokens: 100,
  messageTokens: 100,
  fullMessageTokens: 300,
  previousTurnsRow,
  historyMessages: 4,
  recentToolTokens: 0,
  inputBudgetTokens: 190_000,
  compactionTriggerTokens: 192_000,
  storedThread: { fullStoredThreadTokens: 420 },
  modelUsage: { cacheReadTokens: 0 },
});

const threadedRows = threaded.rows as Array<Record<string, any>>;
const messages = threadedRows.find((row) => row.id === 'messages');
const messageChildren: Array<Record<string, any>> = Array.isArray(messages?.children) ? messages.children : [];
const systemPromptIndex = threadedRows.findIndex((row) => row.id === 'system_prompt');
const previousTurnsIndex = threadedRows.findIndex((row) => row.id === 'previous_turns');

assert.equal(messages?.tokens, 300, 'the Messages row must represent the full thread rather than only the next model slice');
assert.equal(messageChildren.find((row) => row.id === 'messages.current_model_slice')?.tokens, 100, 'the rolling model slice must remain visible inside full-thread Messages');
assert.equal(messageChildren.find((row) => row.id === 'messages.earlier_thread')?.tokens, 200, 'earlier stored messages must be represented separately');
assert.equal(previousTurnsIndex, systemPromptIndex + 1, 'Previous turns must render immediately beneath the current System prompt row');
assert.equal(threadedRows[previousTurnsIndex]?.tokens, 80, 'historical dynamic context must contribute to the whole-thread total');
assert.equal(threadedRows.find((row) => row.id === 'total_thread_tokens')?.label, 'Stored thread footprint', 'stored bytes/token footprint must remain a separate out-of-band metric');

console.log('context-window regression: ok');
