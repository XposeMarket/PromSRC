import assert from 'assert';
import { normalizeAgentTeamWrapperTool, normalizeShareArtifactArgs } from './subagent-executor';
import { jsonEditGuardError } from '../../tools/json-edit-guard';
import { teamAgentCapabilityExecutor } from './capabilities/team-agent-executor';

// The capability executor runs before subagent-executor's switch; if it claims these
// tools, the canonical handlers (and their fixes) are dead code.
for (const tool of ['team_manage', 'dispatch_team_agent', 'talk_to_teammate', 'share_artifact']) {
  assert.strictEqual(teamAgentCapabilityExecutor.canHandle(tool), false, `${tool} must route to subagent-executor`);
}

/**
 * Regression coverage for the Teams Gauntlet findings (2026-10-06).
 * Every assertion maps to a failure observed in the live gateway log.
 */
async function main(): Promise<void> {
  // manage_goal: the wrapper consumed `action` and the handler never saw
  // team_action, so every manager goal call failed "requires team_id and action".
  const goal = normalizeAgentTeamWrapperTool('team_ops_wrapper', {
    action: 'manage_goal', team_action: 'update_focus', teamId: 't1', value: 'ship v1',
  });
  assert.equal(goal?.name, 'manage_team_goal');
  assert.equal(goal?.args.action, 'update_focus');
  assert.equal(goal?.args.team_id, 't1');
  assert.equal(goal?.args.team_action, undefined);

  // team_manage update/status route through with the sub-action intact.
  const upd = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'update', team_id: 't1' });
  assert.equal(upd?.name, 'team_manage');
  assert.equal(upd?.args.action, 'update');
  const st = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'status', team_id: 't1' });
  assert.equal(st?.args.action, 'status');

  // Teams v6: the manager sent manage + team_action:"log_completed" and team_manage
  // rejected it as unsupported. Goal sub-actions route to manage_team_goal.
  const logViaManage = normalizeAgentTeamWrapperTool('team_ops_wrapper', {
    action: 'manage', team_action: 'log_completed', team_id: 't1', value: 'built wc-cli', agent_id: '', subagent_ids: [],
  });
  assert.equal(logViaManage?.name, 'manage_team_goal');
  assert.equal(logViaManage?.args.action, 'log_completed');
  assert.equal(logViaManage?.args.value, 'built wc-cli');
  const pauseViaManage = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'pause_agent', team_id: 't1', agent_id: 'a1' });
  assert.equal(pauseViaManage?.name, 'manage_team_goal');
  assert.equal(pauseViaManage?.args.agent_id, 'a1');
  const pauseTeam = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'pause', team_id: 't1' });
  assert.equal(pauseTeam?.name, 'team_manage', 'team-level pause stays on team_manage');

  // Teams v7: manage + team_action:"get_agent_result" failed on team_manage.
  const resViaManage = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'get_agent_result', team_id: 't1', task_id: 'team_bg_x' });
  assert.equal(resViaManage?.name, 'get_agent_result');
  assert.equal(resViaManage?.args.task_id, 'team_bg_x');
  assert.equal(resViaManage?.args.team_action, undefined);
  const dispViaManage = normalizeAgentTeamWrapperTool('team_ops_wrapper', { action: 'manage', team_action: 'dispatch', team_id: 't1', agent_id: 'a1', task: 'x' });
  assert.equal(dispViaManage?.name, 'dispatch_team_agent');

  // share_artifact: Lyra sent artifact:{name,path,...} nested; it was dropped.
  const nested = normalizeShareArtifactArgs({ artifact: { name: 'habit-cli', path: 'habit-cli', description: 'CLI' } });
  assert.equal(nested.name, 'habit-cli');
  assert.equal(nested.path, 'habit-cli');
  assert.equal(nested.type, 'file');
  const fromPath = normalizeShareArtifactArgs({ path: 'habit-cli/REVIEW.md' });
  assert.equal(fromPath.name, 'REVIEW.md');
  const flat = normalizeShareArtifactArgs({ name: 'notes', content: { a: 1 } });
  assert.equal(flat.content, '{"a":1}');
  assert.equal(flat.type, 'data');

  // JSON guard: a line edit that breaks valid JSON is refused; others pass.
  const good = '{\n  "a": 1,\n  "b": 2\n}\n';
  const broken = '{\n  "a": 1,\n  "b": 2,\n}\n';
  assert.ok(jsonEditGuardError('pending.json', good, broken));
  assert.equal(jsonEditGuardError('pending.json', good, '{\n  "a": 3\n}\n'), null);
  assert.equal(jsonEditGuardError('notes.md', good, broken), null);
  assert.equal(jsonEditGuardError('already-bad.json', broken, broken + 'x'), null);
  assert.equal(jsonEditGuardError('bom.json', '\uFEFF' + good, '\uFEFF{"a":1}'), null);

  // Gauntlet v2: managers called manage_goal "log_completion" (unknown action).
  const { normalizeTeamGoalAction } = await import('./capabilities/team-agent-executor');
  assert.equal(normalizeTeamGoalAction('log_completion'), 'log_completed');
  assert.equal(normalizeTeamGoalAction('LOG_COMPLETE'), 'log_completed');
  assert.equal(normalizeTeamGoalAction('update_focus'), 'set_focus');
  assert.equal(normalizeTeamGoalAction('set_goal'), 'set_focus');
  assert.equal(normalizeTeamGoalAction('add_milestone'), 'add_milestone');

  console.log('teams-gauntlet-fixes.regression: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
