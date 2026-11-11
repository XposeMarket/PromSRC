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

// A name sent with a task (run_now not false) may mean an existing agent: never auto-create.
const namedWithTask = normalizeAgentTeamWrapperTool('agent_ops', { action: 'spawn', name: 'Wrench', task_prompt: 'List open quotes' });
assert.equal(namedWithTask?.args.create_if_missing, undefined, 'a name plus a task must not silently create a duplicate agent');
const namedRunNowTrue = normalizeAgentTeamWrapperTool('agent_ops', { action: 'spawn', name: 'Wrench', run_now: true, task_prompt: 'x' });
assert.equal(namedRunNowTrue?.args.create_if_missing, undefined);

console.log('[agent-ops-spawn-shorthand.regression] run_now:false shorthand, existing id, explicit envelope, bare spawn, and name-with-task passed');
