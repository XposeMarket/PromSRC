import assert from 'node:assert/strict';
import {
  getPrimaryModelRef,
  normalizeProviderModel,
  parseProviderModelRef,
  resolveConfiguredAgentModel,
  resolveConfiguredAgentRouting,
} from './model-routing.js';
import { ANTHROPIC_MODELS } from '../providers/anthropic-adapter.js';
import {
  getReasoningCapability,
  normalizeReasoningEffort,
  supportsFastSpeed,
} from '../providers/reasoning-capabilities.js';

assert.equal(normalizeProviderModel('openai_codex', 'sol'), 'gpt-5.6-sol');
assert.equal(normalizeProviderModel('openai_codex', 'luna'), 'gpt-5.6-luna');
assert.equal(normalizeProviderModel('openai_codex', 'astra'), 'gpt-6-astra');
assert.deepEqual(parseProviderModelRef('openai_codex/terra'), { providerId: 'openai_codex', model: 'gpt-5.6-terra' });

// ── Claude Opus 5.5 ─────────────────────────────────────────────────────────
// The dotted marketing name must resolve to the dashed API id, and Opus 5.5
// must be a selectable Anthropic model rather than silently falling back.
assert.equal(normalizeProviderModel('anthropic', 'opus-5.5'), 'claude-opus-5-5');
assert.equal(normalizeProviderModel('anthropic', 'opus-5-5'), 'claude-opus-5-5');
assert.equal(normalizeProviderModel('anthropic', 'claude-opus-5.5'), 'claude-opus-5-5');
// Opus 5 must keep resolving to itself; 5.5 must not shadow it.
assert.equal(normalizeProviderModel('anthropic', 'opus-5'), 'claude-opus-5');
assert.deepEqual(
  parseProviderModelRef('anthropic/opus-5.5'),
  { providerId: 'anthropic', model: 'claude-opus-5-5' },
);
assert.ok(
  ANTHROPIC_MODELS.includes('claude-opus-5-5'),
  'claude-opus-5-5 must be listed in the Anthropic model catalog',
);
assert.ok(
  ANTHROPIC_MODELS.indexOf('claude-opus-5-5') < ANTHROPIC_MODELS.indexOf('claude-opus-5'),
  'Opus 5.5 must rank above Opus 5 in the catalog ordering',
);

// Reasoning/speed capability gates are regex-driven. Pin that Opus 5.5 inherits
// the full Opus-5 surface instead of returning an empty effort list, which is
// what makes a spawn hard-error with "Reasoning effort X is not supported".
const opus55 = getReasoningCapability('anthropic', 'claude-opus-5-5');
assert.ok(opus55.efforts.includes('high'), 'Opus 5.5 must accept high reasoning');
assert.ok(opus55.efforts.includes('xhigh'), 'Opus 5.5 must accept xhigh reasoning');
assert.ok(opus55.efforts.includes('max'), 'Opus 5.5 must accept max reasoning');
assert.equal(opus55.nativeEffort, true, 'Opus 5.5 must use native effort, not manual budgets');
assert.equal(opus55.thinkingMode, 'adaptive');
assert.equal(
  normalizeReasoningEffort('anthropic', 'claude-opus-5-5', 'xhigh'),
  'xhigh',
  'xhigh must survive normalization for Opus 5.5',
);
assert.equal(
  supportsFastSpeed('anthropic', 'claude-opus-5-5'),
  true,
  'Opus 5.5 must keep Opus-5 fast-speed support',
);

const codexGlobal = {
  llm: {
    provider: 'openai_codex',
    providers: { openai_codex: { model: 'gpt-5.6-sol', reasoning_effort: 'high' } },
  },
  models: { primary: '' },
  agent_model_defaults: {},
  agent_model_default_reasoning: {},
};

// A cleared agent override must inherit the actual configured Codex route,
// even when the legacy models.primary mirror is empty.
assert.equal(getPrimaryModelRef(codexGlobal), 'openai_codex/gpt-5.6-sol');
assert.deepEqual(
  resolveConfiguredAgentRouting(codexGlobal, { id: 'researcher' }, { agentType: 'subagent', fallbackToPrimary: true }),
  {
    model: 'openai_codex/gpt-5.6-sol',
    source: 'primary',
    reasoningEffort: 'high',
    reasoningSource: 'llm.providers.openai_codex',
    providerId: 'openai_codex',
    modelName: 'gpt-5.6-sol',
  },
);

// Settings' durable main_chat route is also a valid global fallback for
// legacy configs where llm.providers[provider].model was never backfilled.
const settingsDefault = {
  llm: { provider: 'openai_codex', providers: { openai_codex: {} } },
  models: { primary: '' },
  agent_model_defaults: { main_chat: 'openai_codex/gpt-5.6-sol' },
  agent_model_default_reasoning: { main_chat: 'high' },
};
assert.equal(getPrimaryModelRef(settingsDefault), 'openai_codex/gpt-5.6-sol');
const settingsRouting = resolveConfiguredAgentRouting(settingsDefault, { id: 'researcher' }, { agentType: 'subagent', fallbackToPrimary: true });
assert.equal(settingsRouting.model, 'openai_codex/gpt-5.6-sol');
assert.equal(settingsRouting.reasoningEffort, 'high');
assert.equal(settingsRouting.reasoningSource, 'agent_model_default_reasoning.main_chat');

// A configured type default wins over the global route and carries its
// matching reasoning default into the runtime.
const typeDefault = {
  ...codexGlobal,
  agent_model_defaults: { subagent: 'openai/gpt-5.5' },
  agent_model_default_reasoning: { subagent: 'high' },
};
const typeRouting = resolveConfiguredAgentRouting(typeDefault, { id: 'builder' }, { agentType: 'subagent', fallbackToPrimary: true });
assert.equal(typeRouting.model, 'openai/gpt-5.5');
assert.equal(typeRouting.reasoningEffort, 'high');
assert.equal(typeRouting.reasoningSource, 'agent_model_default_reasoning.subagent');

// Explicit model and reasoning overrides remain authoritative.
const explicit = resolveConfiguredAgentRouting(typeDefault, {
  id: 'builder',
  model: 'openai_codex/gpt-5.6-sol',
  reasoning_effort: 'xhigh',
}, { agentType: 'subagent', fallbackToPrimary: true });
assert.equal(explicit.model, 'openai_codex/gpt-5.6-sol');
assert.equal(explicit.source, 'agent_override');
assert.equal(explicit.reasoningEffort, 'xhigh');
assert.equal(explicit.reasoningSource, 'agent_override');

// Clearing the model and reasoning fields restores inheritance instead of
// serializing an empty route that the spawn runtime cannot execute.
const cleared = resolveConfiguredAgentRouting(typeDefault, {
  id: 'builder',
  model: '',
  reasoning_effort: '',
}, { agentType: 'subagent', fallbackToPrimary: true });
assert.equal(cleared.model, 'openai/gpt-5.5');
assert.equal(cleared.reasoningEffort, 'high');

const noModel = resolveConfiguredAgentModel({
  llm: { provider: '', providers: {} },
  models: { primary: '' },
  agent_model_defaults: {},
}, { id: 'unconfigured' }, { agentType: 'subagent', fallbackToPrimary: true });
assert.equal(noModel.model, '');

console.log('PASS: Settings-backed subagent route, reasoning inheritance, explicit overrides, clear-to-default, and no-model detection');
