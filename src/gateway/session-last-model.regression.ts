import assert from 'node:assert/strict';
import { getLastAssistantModel, normalizeSessionModelRef } from './session-last-model';
import { slimSessionList } from './routes/perf-projections';

const history = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'a', turnProviderUsage: { lastCall: { provider: 'anthropic', model: 'claude-opus-5-5' } } },
  { role: 'user', content: 'switch' },
  { role: 'assistant', content: 'b', turnProviderUsage: { lastCall: { provider: 'openai_codex', model: 'gpt-6-astra' } } },
  { role: 'assistant', content: 'note without usage' },
];
assert.deepEqual(getLastAssistantModel(history), { providerId: 'openai_codex', model: 'gpt-6-astra' }, 'newest answering model wins');
assert.equal(getLastAssistantModel([{ role: 'user', content: 'x' }]), null, 'no assistant reply = no model');
assert.equal(getLastAssistantModel(undefined), null);
assert.deepEqual(
  getLastAssistantModel([{ role: 'assistant', turnProviderUsage: { provider: 'xai', model: 'grok-4.3', source: 'external_import' } }]),
  { providerId: 'xai', model: 'grok-4.3' },
  'imported history usage without lastCall still resolves',
);
assert.equal(normalizeSessionModelRef(undefined), undefined, 'old index rows stay "not computed" so they hydrate once');
assert.equal(normalizeSessionModelRef(null), null);

const slim = slimSessionList({ sessions: [
  { id: 'a', lastModel: { providerId: 'openai_codex', model: 'gpt-6-astra', extra: 'x' } },
  { id: 'b' },
] });
assert.deepEqual(slim.sessions[0].lastModel, { providerId: 'openai_codex', model: 'gpt-6-astra' }, 'sidebar list carries lastModel');
assert.equal(slim.sessions[1].lastModel, undefined);
console.log('PASS session lastModel: newest model, no-reply null, import shape, slim projection');
