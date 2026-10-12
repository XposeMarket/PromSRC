import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildContextBudget, resolveCompactionThreshold, resolveModelContextProfile } from './model-context';
import { buildContextWindowPressure } from './context-window-pressure';

const config = { llm: { providers: {} }, session: { compactionThreshold: 'auto' } };
const profile = (provider: string, model: string, metadata?: any, cfg: any = config) => resolveModelContextProfile(provider, model, metadata, cfg);
const sol = profile('openai_codex', 'gpt-6.1-sol');
assert.equal(sol.contextWindowTokens, 872000);
for (const model of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) assert.equal(profile('openai_codex', model).contextWindowTokens, 872000);
assert.equal(profile('openai', 'gpt-6.1-sol').contextWindowTokens, 1050000);
assert.equal(profile('openai_codex', 'gpt-5.5').contextWindowTokens, 272000);
assert.equal(profile('anthropic', 'claude-fable-5-1').contextWindowTokens, 1000000);
assert.equal(profile('openai', 'gpt-5.4').contextWindowTokens, 1050000);
assert.equal(profile('openai_codex', 'gpt-6.1-sol', { contextWindowTokens: 272000, max_context_window: 872000 }).contextWindowTokens, 872000);
assert.equal(profile('openai_codex', 'gpt-6.1-sol', { contextWindowTokens: 128000 }).contextWindowTokens, 128000);
assert.equal(profile('openai_codex', 'gpt-6.1-sol', { max_context_window: 0, contextWindowTokens: 128000 }).contextWindowTokens, 128000);
assert.equal(profile('openai_codex', 'gpt-6.1-sol', { max_context_window: 872000 }, { llm: { providers: { openai_codex: { context_window: 64000 } } } }).contextWindowTokens, 64000);
assert.equal(resolveCompactionThreshold(undefined), 'auto');
assert.equal(resolveCompactionThreshold('auto'), 'auto');
assert.equal(resolveCompactionThreshold(0.7), 'auto'); // Authorized legacy-default migration.
assert.equal(resolveCompactionThreshold(0.7, 'manual'), 0.7);
assert.equal(resolveCompactionThreshold(0.6), 0.6);
for (const p of [sol, profile('openai_codex', 'gpt-5.5'), profile('anthropic', 'claude-fable-5-1'), profile('openai', 'gpt-6-sol'), profile('ollama', 'qwen3:4b'), profile('openai', 'tiny', { contextWindowTokens: 1024, maxOutputTokens: 4096 })]) {
  for (const threshold of ['auto', 0.4, 0.7, 0.95] as const) {
    const budget = buildContextBudget(p, { compactionThreshold: threshold, compactionThresholdMode: threshold === 'auto' ? 'auto' : 'manual' });
    assert.ok(budget.inputBudgetTokens > 0);
    assert.ok(budget.compactionTriggerTokens <= budget.inputBudgetTokens);
    assert.equal(budget.inputBudgetTokens + budget.reservedOutputTokens + budget.reservedReasoningTokens + budget.safetyHeadroomTokens, p.contextWindowTokens);
    if (threshold === 'auto') assert.equal(budget.compactionTriggerTokens, budget.inputBudgetTokens);
    else assert.equal(budget.compactionTriggerTokens, Math.min(budget.inputBudgetTokens, Math.floor(p.contextWindowTokens * threshold)));
    const pressure = buildContextWindowPressure({ contextWindowTokens: p.contextWindowTokens, inputBudgetTokens: budget.inputBudgetTokens, compactionThreshold: threshold, compactionThresholdMode: threshold === 'auto' ? 'auto' : 'manual', contextTokenEstimate: budget.compactionTriggerTokens });
    assert.equal(pressure.compactionTriggerTokens, budget.compactionTriggerTokens);
    assert.equal(pressure.atOrPastCompactionTrigger, true);
  }
}
const full = buildContextBudget(sol, { compactionThreshold: 'auto' });
assert.equal(full.inputBudgetTokens, 825136);
assert.ok(full.compactionTriggerTokens > 800000);
assert.equal(buildContextBudget(sol, { compactionThreshold: 0.7 }).compactionTriggerTokens, full.inputBudgetTokens);
assert.equal(buildContextBudget(sol, { compactionThreshold: 0.7, compactionThresholdMode: 'manual' }).compactionTriggerTokens, 610400);
const snapshotSource = fs.readFileSync('src/gateway/chat/turn-route-snapshot.ts', 'utf8');
assert.match(snapshotSource, /buildContextBudget\(contextProfile, raw\?\.session \|\| \{\}\)/);
const session = fs.readFileSync('src/gateway/session.ts', 'utf8');
assert.match(session, /buildContextBudget\(resolveActiveModelContextProfile\(\), \{ \.\.\.sessionPolicy, compactionThresholdMode:/);
console.log('PASS model-aware compaction: catalog, metadata, overrides, small windows, manual and auto gates');
