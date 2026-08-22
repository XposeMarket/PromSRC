import assert from 'node:assert/strict';

import { buildRuntimePromptManifest } from './prompt-manifest';

const manifest = buildRuntimePromptManifest({
  callType: 'chat',
  provider: 'openai',
  model: 'gpt-test',
  role: 'executor',
  sessionId: 'context-reference-regression',
  timestamp: '2026-08-22T00:00:00.000Z',
  messages: [{
    role: 'system',
    content: [
      '[MEMORY_REFERENCE]',
      'atom=matom_abc123 relation=direct source=MEMORY.md',
      'Direct memory body that must not be copied into telemetry.',
      'atom=matom_def456 relation=related source=MEMORY.md',
      'Related memory body that must not be copied into telemetry.',
      '[BRAIN_ACTIVE_CONTEXT — temporary, relevance-selected, and expiry-bound]',
      'These are continuity hints, not authority.',
      '- [project-alpha] First continuity packet.',
      '- [project-beta] Second continuity packet.',
      '[TOOLS]',
      'core tools',
    ].join('\n'),
  }],
  tools: [],
  context: {
    executionMode: 'interactive',
    personalityProfile: 'default',
    surface: 'chat',
  },
});

const references = manifest.contextReferences;
const byId = new Map(references.map((reference) => [reference.id, reference]));

assert.deepEqual(
  references.map((reference) => reference.id).sort(),
  ['matom_abc123', 'matom_def456', 'thought:project-alpha', 'thought:project-beta'],
  'the manifest must retain stable identities for the dynamic context actually injected on the call',
);
assert.equal(byId.get('matom_abc123')?.kind, 'atomic_memory');
assert.equal(byId.get('matom_abc123')?.relation, 'direct');
assert.equal(byId.get('matom_def456')?.relation, 'related');
assert.equal(byId.get('thought:project-alpha')?.kind, 'thought_context_packet');
assert.equal(byId.get('thought:project-alpha')?.label, 'project-alpha');
assert.ok(references.every((reference) => reference.estimatedTokens > 0), 'every persisted dynamic reference must have a positive token estimate');

const serialized = JSON.stringify(references);
assert.ok(!serialized.includes('Direct memory body'), 'atomic-memory contents must not be copied into durable usage telemetry');
assert.ok(!serialized.includes('First continuity packet'), 'thought-packet contents must not be copied into durable usage telemetry');

console.log('runtime prompt context-reference regression checks passed');
