import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getLastAssistantModel, normalizeSessionModelRef, SESSION_LAST_MODEL_VERSION } from './session-last-model';
import { mergeHistoryWithExistingMessageMetadata } from './history-reconciliation';
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

// Root cause (2026-11): mobile history sync rewrote assistant rows without
// turnProviderUsage; only the process trace still named the model.
const mobileSynced = [
  { role: 'user', content: 'q' },
  { role: 'ai', content: 'a', processEntries: [
    { type: 'tool', extra: { source: 'model_stream_event', modelEvent: { provider: 'anthropic', model: 'claude-opus-4-8' } } },
    { type: 'tool', extra: { source: 'model_stream_event', modelEvent: { provider: 'openai_codex', model: 'gpt-5.6-luna' } } },
    { type: 'note', extra: { other: true } },
  ] },
];
assert.deepEqual(getLastAssistantModel(mobileSynced), { providerId: 'openai_codex', model: 'gpt-5.6-luna' },
  'client-shaped assistant rows resolve the model from the newest modelEvent in processEntries');
assert.deepEqual(getLastAssistantModel([
  ...mobileSynced,
  { role: 'assistant', content: 'b', turnProviderUsage: { lastCall: { provider: 'xai', model: 'grok-4.3' } } },
]), { providerId: 'xai', model: 'grok-4.3' }, 'newer turnProviderUsage still wins');
assert.equal(getLastAssistantModel([{ role: 'assistant', processEntries: [{ extra: {} }] }]), null, 'trace without modelEvent = unknown');
assert.equal(SESSION_LAST_MODEL_VERSION >= 2, true, 'derivation version bumped so stale index rows rehydrate');

// The sync merge must keep the server-only usage the client never echoes.
const merged = mergeHistoryWithExistingMessageMetadata(
  [{ role: 'user', content: 'q', clientRequestId: 'r1' },
    { role: 'assistant', content: 'answer', clientRequestId: 'r1', timestamp: 1000, turnProviderUsage: { lastCall: { provider: 'anthropic', model: 'claude-opus-5-5' } } }],
  [{ role: 'user', content: 'q', clientRequestId: 'r1' },
    { role: 'ai', content: 'answer', clientRequestId: 'r1', timestamp: 1000, _pmFinalReceived: true }],
  { preserveAllExisting: true },
);
assert.deepEqual(getLastAssistantModel(merged), { providerId: 'anthropic', model: 'claude-opus-5-5' },
  'mobile history sync preserves turnProviderUsage on the merged assistant row');
console.log('PASS lastModel survives mobile history sync (processEntries fallback + merge preserves usage)');

// Desktop sidebar parity: the priority-chat provider logo must read the same server
// lastModel as mobile before falling back to the configured (global) provider.
const desktopSrc = readFileSync(path.join(__dirname, '../../web-ui/src/legacy-desktop-bootstrap.js'), 'utf8');
const providerFn = desktopSrc.slice(desktopSrc.indexOf('function _prioritySessionProvider('), desktopSrc.indexOf('function renderPriorityProviderLogo('));
assert.ok(providerFn.includes('session?.lastModel?.providerId'), 'desktop sidebar logo reads lastModel');
assert.ok(providerFn.indexOf('lastModel') < providerFn.indexOf('_llmSettingsCache'), 'lastModel wins over the global configured provider');
console.log('PASS desktop sidebar logo uses server lastModel before the global provider');
