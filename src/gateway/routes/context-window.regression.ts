import assert from 'node:assert/strict';

import { buildContextWindowCurrentState } from './chat.router.js';
import { resolveProviderPromptTokens } from '../../providers/model-usage.js';

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

const providerContextState = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_provider_authority',
  profile: { contextWindowTokens: 272_000, tokenizer: 'heuristic' },
  currentInputTokens: 43_800,
  messageTokens: 14,
  historyMessages: 20,
  recentToolTokens: 0,
  inputBudgetTokens: 190_000,
  compactionTriggerTokens: 192_000,
  storedThread: { fullStoredThreadTokens: 900_000 },
  modelUsage: {
    calls: 12,
    inputTokens: 857_000,
    outputTokens: 12_500,
    reasoningTokens: 6_100,
    cacheReadTokens: 585_000,
    totalTokens: 875_600,
    lastContextCall: {
      source: 'provider',
      callType: 'chat',
      agentId: 'main',
      inputTokens: 188_400,
      estimatedProviderInputTokens: 43_800,
      estimatedMessageInputTokens: 32_900,
      estimatedSystemPromptTokens: 10_800,
      estimatedToolSchemaTokens: 32_800,
    },
  },
});

assert.equal(providerContextState.currentStateTokens, 188_400, 'the context header must use the latest provider-reported input, not the cumulative thread total');
assert.equal(providerContextState.latestProviderReportedInputTokens, 188_400);
assert.ok(Math.abs(providerContextState.contextUsage.percent - 69.26470588235294) < 0.000001);
assert.equal(
  (providerContextState.rows as Array<Record<string, any>>).find((row) => row.id === 'provider_session_total')?.tokens,
  875_600,
  'cumulative thread usage must remain separate from current-call context',
);

console.log('context-window provider authority regression: ok');

// ─── Anthropic cached-prefix context accounting ──────────────────────────────
// Anthropic reports `input_tokens` as the UNCACHED remainder only. Once prefix
// caching warms up, a real ~140k-token turn reports input_tokens=1..2 with the
// rest in cache_read/cache_creation. Reading inputTokens directly pinned the
// context bar at ~0% on mobile and desktop for every Claude session.

assert.equal(
  resolveProviderPromptTokens({ provider: 'anthropic', inputTokens: 2, cacheReadTokens: 135_577, cacheWriteTokens: 1_996 }),
  137_575,
  'anthropic prompt size must add cache read + cache write to the uncached remainder',
);
assert.equal(
  resolveProviderPromptTokens({ provider: 'openai', inputTokens: 36_484, cacheReadTokens: 34_304 }),
  36_484,
  'openai cached_tokens is a subset of prompt_tokens and must never be added again',
);
assert.equal(
  resolveProviderPromptTokens({ provider: 'openai_codex', inputTokens: 35_378, cacheReadTokens: 0 }),
  35_378,
  'openai_codex prompt size is the reported input',
);
assert.equal(
  resolveProviderPromptTokens({ provider: '', inputTokens: 500, cacheReadTokens: 9_000 }),
  500,
  'an unknown provider must not speculatively add cache tokens',
);
assert.equal(resolveProviderPromptTokens(null), 0, 'a missing usage event resolves to zero');

const anthropicCachedState = buildContextWindowCurrentState({
  sessionId: 'context_window_regression_anthropic_cache',
  profile: { contextWindowTokens: 1_000_000, tokenizer: 'anthropic' },
  currentInputTokens: 128,
  messageTokens: 128,
  historyMessages: 12,
  recentToolTokens: 0,
  inputBudgetTokens: 857_232,
  compactionTriggerTokens: 771_508,
  storedThread: { fullStoredThreadTokens: 100_754 },
  modelUsage: {
    calls: 30,
    cacheReadTokens: 870_086,
    lastContextCall: {
      source: 'provider',
      callType: 'chat',
      agentId: 'main',
      provider: 'anthropic',
      inputTokens: 2,
      cacheReadTokens: 135_577,
      cacheWriteTokens: 1_996,
      estimatedProviderInputTokens: 106_012,
      estimatedMessageInputTokens: 90_000,
      estimatedSystemPromptTokens: 13_009,
      estimatedToolSchemaTokens: 12_483,
    },
  },
});

assert.equal(
  anthropicCachedState.latestProviderReportedInputTokens,
  137_575,
  'a cache-warm Claude turn must report the full processed prompt, not the uncached remainder',
);
assert.equal(anthropicCachedState.currentStateTokens, 137_575, 'the context bar total must be the real prompt size');
assert.ok(
  anthropicCachedState.contextUsage.percent > 13 && anthropicCachedState.contextUsage.percent < 14,
  `a 137.5k/1M cached Claude turn must read ~13.8%, got ${anthropicCachedState.contextUsage.percent}`,
);
assert.ok(
  anthropicCachedState.freeSpaceTokens < 900_000,
  'free space must shrink once the cached prefix is counted as occupied context',
);

console.log('context-window anthropic cached-prefix regression: ok');
