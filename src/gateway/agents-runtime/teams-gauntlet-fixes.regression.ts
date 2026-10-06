import assert from 'assert';
import { normalizeAgentTeamWrapperTool, normalizeShareArtifactArgs } from './subagent-executor';
import { jsonEditGuardError } from '../../tools/json-edit-guard';

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

  console.log('teams-gauntlet-fixes.regression: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
