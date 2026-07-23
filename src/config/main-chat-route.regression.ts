import assert from 'node:assert/strict';
import {
  mainChatRoutePatch,
  preserveLiveMainChatRoute,
  readLiveMainChatRoute,
  seedLegacyMainChatRoute,
} from './main-chat-route.js';

const legacy = {
  llm: {
    provider: 'openai_codex',
    providers: {
      openai_codex: { model: 'gpt-5.6-sol', reasoning_effort: 'high' },
      anthropic: { model: 'claude-sonnet-5' },
    },
  },
  models: { primary: 'gpt-5.6-sol', roles: { manager: 'old', executor: 'old', verifier: 'old' } },
  agent_model_defaults: {},
  agent_model_default_reasoning: {},
};

// Legacy installs inherit the actually live route exactly once.
const seed = seedLegacyMainChatRoute(legacy);
assert.ok(seed);
assert.equal(seed?.agent_model_defaults.main_chat, 'openai_codex/gpt-5.6-sol');
assert.equal(seed?.agent_model_default_reasoning.main_chat, 'high');
assert.equal(seedLegacyMainChatRoute({ ...legacy, ...seed }), null);

// Templates/direct main-chat edits make one route authoritative everywhere.
const switched = mainChatRoutePatch(legacy, {
  provider: 'anthropic', model: 'claude-opus-4-8', reasoningEffort: 'max',
});
assert.deepEqual(readLiveMainChatRoute({ ...legacy, ...switched }), {
  provider: 'anthropic', model: 'claude-opus-4-8', reasoningEffort: 'max',
});
assert.equal(switched.agent_model_defaults.main_chat, 'anthropic/claude-opus-4-8');
assert.equal(switched.agent_model_default_reasoning.main_chat, 'max');

// Omitting reasoning is a model-only change, not an instruction to erase it.
const modelOnly = mainChatRoutePatch({ ...legacy, ...switched }, {
  provider: 'anthropic', model: 'claude-sonnet-5',
});
assert.equal(modelOnly.llm.providers.anthropic.reasoning_effort, 'max');
assert.equal(modelOnly.agent_model_default_reasoning.main_chat, 'max');

// A left-side connection save may update credentials, but may never activate
// its selected provider or replace the main-chat model/reasoning.
const connectionSave = preserveLiveMainChatRoute({ ...legacy, ...switched }, {
  provider: 'openai',
  providers: {
    openai: { api_key: 'vault:llm.openai.api_key', model: 'gpt-5.6-terra' },
    anthropic: { model: 'claude-haiku-4-5-20251001', reasoning_effort: 'low', api_key: 'vault:llm.anthropic.api_key' },
  },
});
assert.equal(connectionSave.provider, 'anthropic');
assert.equal(connectionSave.providers.anthropic.model, 'claude-opus-4-8');
assert.equal(connectionSave.providers.anthropic.reasoning_effort, 'max');
assert.equal(connectionSave.providers.openai.api_key, 'vault:llm.openai.api_key');

const accountRoute = mainChatRoutePatch({
  ...legacy,
  llm: { ...legacy.llm, providers: { ...legacy.llm.providers, anthropic: { model: 'claude-sonnet-5', defaultAccountId: 'claude-work' } } },
}, { provider: 'anthropic', model: 'claude-sonnet-5' });
assert.equal(accountRoute.llm.accountId, 'claude-work');

const crossProviderRoute = mainChatRoutePatch({
  ...legacy,
  llm: { ...legacy.llm, accountId: 'codex-personal' },
}, { provider: 'anthropic', model: 'claude-sonnet-5' });
assert.equal(crossProviderRoute.llm.accountId, undefined);

console.log('main-chat-route regression: OK');
