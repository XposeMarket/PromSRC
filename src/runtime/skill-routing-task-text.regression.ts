import assert from 'assert';
import path from 'path';
import { SkillsManager } from '../gateway/skills-runtime/skills-manager';
import { extractTeamDispatchTaskText } from '../gateway/teams/team-dispatch-runtime';

// Routing must follow the real task, not the [TEAM DISPATCH] wrapper, and
// worker/heartbeat modes must not get the "No skill is required" line.

const manager = new SkillsManager(path.join(process.cwd(), 'workspace', 'skills'));

const task = 'Run the QA test plan for Rockfall Relay v0.2 in Studio play mode, check the console and describe any failures';
const wrapper = [
  '[TEAM DISPATCH]',
  'Team: Rockfall Relay',
  'Role: QA lead',
  'Playbook: Report results to the manager with evidence, keep updates short, and never claim verification you did not run. Use the team workspace only.',
  'Dispatch context: prior review notes and milestone list go here.',
  'YOUR TASK:',
  task,
].join('\n');

const extracted = extractTeamDispatchTaskText(wrapper);
assert.equal(extracted, task, 'extractTeamDispatchTaskText must return the bare task');

const bareIds = manager.resolveRuntimeRouting(task).candidates.map((c) => c.id);
const extractedIds = manager.resolveRuntimeRouting(extracted).candidates.map((c) => c.id);
assert.deepEqual(extractedIds, bareIds, 'extracted task must give the same candidates as the bare task');

const dispatchContext = manager.buildTurnContext(extracted, { executionMode: 'team_subagent' });
assert.ok(!dispatchContext.includes('No skill is required'), 'worker dispatch must never get the "No skill is required" line');

const workerIdle = manager.buildTurnContext('thanks, that is all', { executionMode: 'team_subagent' });
assert.ok(workerIdle.includes('call skill_list with a short task query before starting'), 'worker mode must get the discovery hint');
assert.ok(!workerIdle.includes('No skill is required'), 'worker mode must not get the no-skill line');

const interactiveIdle = manager.buildTurnContext('thanks that is all', { executionMode: 'interactive' });
assert.ok(interactiveIdle.includes('No skill is required'), 'interactive non-actionable turns keep the no-skill line');

const definitional = manager.resolveRuntimeRouting('what is the pr-pipeline skill?');
assert.equal(definitional.candidates.length, 0, '"what is" at the start must give no implicit candidates');

const heartbeat = manager.buildTurnContext(task, { executionMode: 'heartbeat' });
assert.ok(!heartbeat.includes('[MATCHING_SKILLS]'), 'heartbeat must not offer matching skills');
assert.ok(!heartbeat.includes('[SKILL_DISCOVERY_REQUIRED]'), 'heartbeat must not require discovery');
assert.ok(!heartbeat.includes('No skill is required'), 'heartbeat must not get the no-skill line');

console.log(JSON.stringify({
  bareCandidates: bareIds,
  extractedMatchesBare: JSON.stringify(extractedIds) === JSON.stringify(bareIds),
  workerHintPresent: workerIdle.includes('call skill_list'),
  heartbeatClean: !heartbeat.includes('[MATCHING_SKILLS]'),
}, null, 2));
