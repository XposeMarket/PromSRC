import assert from 'node:assert/strict';
import {
  getPrimaryModelRef,
  resolveConfiguredAgentModel,
  resolveConfiguredAgentRouting,
} from './model-routing.js';

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
