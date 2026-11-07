import assert from 'node:assert/strict';
import { resolveTaskModelRef, type TaskModelRefDeps } from './task-model-ref';

const deps: TaskModelRefDeps = {
  sessionModel: (id) => (id === 'ran' ? { providerId: 'xai', model: 'grok-4.3' } : id === 'chat1' ? { providerId: 'anthropic', model: 'claude-opus-5-5' } : null),
  scheduleModel: (id) => (id === 'job-sol' ? 'openai_codex/gpt-6.1-sol' : undefined),
  agentModel: (id) => (id === 'ledger' ? 'anthropic/claude-haiku-5-5' : undefined),
  primaryModel: () => 'openai_codex/gpt-6-astra',
  defaultProvider: () => 'openai_codex',
};

// Actual run evidence beats every configured route.
assert.deepEqual(resolveTaskModelRef({ sessionId: 'ran', executorProvider: 'anthropic/claude-opus-5-5', scheduleId: 'job-sol' }, deps),
  { providerId: 'xai', model: 'grok-4.3', source: 'session' });
// Explicit executor route next.
assert.equal(resolveTaskModelRef({ sessionId: 'none', executorProvider: 'anthropic/claude-opus-5-5' }, deps)?.providerId, 'anthropic');
// Bare executor model: inferred provider, else active provider.
assert.equal(resolveTaskModelRef({ executorProvider: 'claude-opus-5-5' }, deps)?.providerId, 'anthropic');
assert.equal(resolveTaskModelRef({ executorProvider: 'mystery-model' }, deps)?.providerId, 'openai_codex');
// Schedule override, then configured agent, then global main chat route.
assert.deepEqual(resolveTaskModelRef({ scheduleId: 'job-sol', taskKind: 'scheduled' }, deps),
  { providerId: 'openai_codex', model: 'gpt-6.1-sol', source: 'schedule' });
assert.equal(resolveTaskModelRef({ teamSubagent: { agentId: 'ledger', teamId: 't' } }, deps)?.source, 'agent');
assert.equal(resolveTaskModelRef({ title: 'plain bg' }, deps)?.source, 'primary');
// Planned chat runs: the chat's own model, else main chat route.
assert.deepEqual(resolveTaskModelRef({ sourceKind: 'planned_chat', sessionId: 'chat1' }, deps),
  { providerId: 'anthropic', model: 'claude-opus-5-5', source: 'session' });
assert.equal(resolveTaskModelRef({ sourceKind: 'planned_chat', sessionId: 'unknown', executorProvider: 'xai/grok-4.3' }, deps)?.source, 'primary');
// Genuinely unknown -> null (UI falls back to initials); throwing deps never break the list.
assert.equal(resolveTaskModelRef({ title: 'x' }, {}), null);
assert.equal(resolveTaskModelRef({ sessionId: 's' }, { sessionModel: () => { throw new Error('boom'); } }), null);
assert.equal(resolveTaskModelRef(null, deps), null);
console.log('PASS task modelRef: session > executor > schedule > agent > primary, planned chat, unknown');
