import assert from 'node:assert/strict';
import { normalizeAgentTeamWrapperTool } from './wrapper-normalizers.js';

// A model creating a brand-new agent passes just a name and description.
const named = normalizeAgentTeamWrapperTool('agent_ops', {
  action: 'spawn',
  name: 'Eddie',
  description: 'Books appointments',
  run_now: false,
});
assert.equal(named?.name, 'spawn_subagent');
assert.deepEqual(named?.args.create_if_missing, { name: 'Eddie', description: 'Books appointments' });

// An existing agent id must not be turned into a create request.
const existing = normalizeAgentTeamWrapperTool('agent_ops', { action: 'spawn', agent_id: 'wrench_1', name: 'ignored' });
assert.equal(existing?.args.subagent_id, 'wrench_1');
assert.equal(existing?.args.create_if_missing, undefined);

// An explicit create_if_missing object is left alone.
const explicit = normalizeAgentTeamWrapperTool('agent_ops', {
  action: 'spawn',
  name: 'Outer',
  create_if_missing: { name: 'Inner' },
});
assert.deepEqual(explicit?.args.create_if_missing, { name: 'Inner' });

// A bare spawn with nothing to create from still reaches the executor's clear error.
const bare = normalizeAgentTeamWrapperTool('agent_ops', { action: 'spawn' });
assert.equal(bare?.args.create_if_missing, undefined);

console.log('[agent-ops-spawn-shorthand.regression] name/description shorthand, existing id, explicit envelope, and bare spawn passed');
