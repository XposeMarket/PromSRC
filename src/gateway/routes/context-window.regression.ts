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

const usageState = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_usage',
  profile: { contextWindowTokens: 272_000, tokenizer: 'heuristic' },
  currentInputTokens: 2_000,
  messageTokens: 1_600,
  historyMessages: 3,
  recentToolTokens: 400,
  inputBudgetTokens: 190_000,
  compactionTriggerTokens: 192_000,
  storedThread: { fullStoredThreadTokens: 80_000 },
  modelUsage: {
    calls: 4,
    inputTokens: 40_000,
    outputTokens: 6_000,
    reasoningTokens: 2_000,
    cacheReadTokens: 10_000,
    cacheWriteTokens: 1_000,
    totalTokens: 59_000,
  },
  toolUsage: {
    calls: 7,
    argsTokens: 700,
    resultTokens: 3_300,
    totalTokens: 4_000,
  },
});

const usageRows = usageState.rows as Array<Record<string, any>>;
const providerUsage = usageRows.find((row) => row.id === 'provider_session_total');
const toolUsage = usageRows.find((row) => row.id === 'tool_usage_thread_total');
assert.equal(providerUsage?.tokens, 59_000, 'provider usage row must use cumulative thread totals');
assert.equal(toolUsage?.tokens, 4_000, 'tool usage row must use cumulative tool I/O totals');
assert.equal(providerUsage?.children?.find((row: any) => row.id === 'provider_session_total_reasoning')?.tokens, 2_000);
assert.equal(toolUsage?.children?.find((row: any) => row.id === 'thread_tool_input')?.tokens, 700);
assert.equal(toolUsage?.children?.find((row: any) => row.id === 'thread_tool_output')?.tokens, 3_300);
assert.ok(!usageRows.some((row) => row.id === 'last_turn_usage'), 'per-turn usage must not be a context-window row');

console.log('context-window thread usage regression: ok');
