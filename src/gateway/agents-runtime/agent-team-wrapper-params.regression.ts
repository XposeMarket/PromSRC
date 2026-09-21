import assert from 'assert';
import { normalizeAgentTeamWrapperTool } from './subagent-executor';

/**
 * Regression coverage for agent/team wrapper parameter alignment.
 *
 * The wrapper schemas in src/gateway/tools/defs/agent-team-schedule.ts advertise
 * friendly parameter names (teammate_id, content, request, status, from_role) that
 * the underlying handlers did not read. A schema-conformant call therefore failed
 * validation at the handler, and agents burned task steps guessing the handler's
 * private parameter name. These assertions pin the alias mapping.
 */
async function main(): Promise<void> {
  // team_collab_ops: talk_teammate advertises teammate_id, handler reads agent_id.
  const talkTeammate = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'talk_teammate',
    teammate_id: 'systest_team_b',
    message: 'ping',
  });
  assert.ok(talkTeammate, 'talk_teammate should normalize');
  assert.equal(talkTeammate!.name, 'talk_to_teammate');
  assert.equal(talkTeammate!.args.agent_id, 'systest_team_b', 'teammate_id must alias to agent_id');
  assert.equal(talkTeammate!.args.message, 'ping');

  // An explicit agent_id must win over the alias.
  const talkTeammateExplicit = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'talk_teammate',
    teammate_id: 'alias_loser',
    agent_id: 'explicit_winner',
    message: 'ping',
  });
  assert.equal(talkTeammateExplicit!.args.agent_id, 'explicit_winner', 'explicit agent_id must not be overwritten');

  // team_collab_ops: request_context advertises request/context, handler reads question.
  const requestContextViaRequest = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'request_context',
    request: 'what is the repo path?',
  });
  assert.equal(requestContextViaRequest!.name, 'request_context');
  assert.equal(requestContextViaRequest!.args.question, 'what is the repo path?');

  const requestContextViaContext = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'request_context',
    context: 'need the branch name',
  });
  assert.equal(requestContextViaContext!.args.question, 'need the branch name');

  // team_collab_ops: request_manager_help advertises request, handler reads message.
  const managerHelp = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'request_manager_help',
    request: 'blocked on credentials',
  });
  assert.equal(managerHelp!.name, 'request_manager_help');
  assert.equal(managerHelp!.args.message, 'blocked on credentials');

  // team_collab_ops: update_status advertises status, handler reads phase.
  const updateStatus = normalizeAgentTeamWrapperTool('team_collab_ops', {
    action: 'update_status',
    status: 'blocked',
    message: 'waiting on review',
  });
  assert.equal(updateStatus!.name, 'update_my_status');
  assert.equal(updateStatus!.args.phase, 'blocked');
  assert.equal(updateStatus!.args.current_task, 'waiting on review');

  // team_ops_wrapper: post_chat advertises content, handler reads message.
  const postChat = normalizeAgentTeamWrapperTool('team_ops_wrapper', {
    action: 'post_chat',
    team_id: 'team_abc',
    content: 'status update',
  });
  assert.equal(postChat!.name, 'post_to_team_chat');
  assert.equal(postChat!.args.message, 'status update', 'content must alias to message');
  assert.equal(postChat!.args.team_id, 'team_abc');

  // team_ops_wrapper: camelCase teamId must alias to team_id.
  const replyCamel = normalizeAgentTeamWrapperTool('team_ops_wrapper', {
    action: 'reply',
    teamId: 'team_camel',
    content: 'reply body',
  });
  assert.equal(replyCamel!.name, 'reply_to_team');
  assert.equal(replyCamel!.args.team_id, 'team_camel');
  assert.equal(replyCamel!.args.message, 'reply body');

  // team_ops_wrapper: dispatch advertises task, handler reads task_prompt.
  const dispatch = normalizeAgentTeamWrapperTool('team_ops_wrapper', {
    action: 'dispatch',
    team_id: 'team_abc',
    subagent_id: 'member_a',
    task: 'run the checks',
  });
  assert.equal(dispatch!.name, 'dispatch_team_agent');
  assert.equal(dispatch!.args.task_prompt, 'run the checks');
  assert.equal(dispatch!.args.agent_id, 'member_a');

  // agent_ops spawn: from_role shorthand must hydrate create_if_missing
  // instead of being rejected for a missing subagent_id.
  const spawnFromRole = normalizeAgentTeamWrapperTool('agent_ops', {
    action: 'spawn',
    from_role: 'researcher',
    specialization: 'Finds local leads',
    model: 'anthropic/claude-sonnet-4-6',
  });
  assert.equal(spawnFromRole!.name, 'spawn_subagent');
  assert.ok(spawnFromRole!.args.create_if_missing, 'from_role must hydrate create_if_missing');
  assert.equal(spawnFromRole!.args.create_if_missing.from_role, 'researcher');
  assert.equal(spawnFromRole!.args.create_if_missing.specialization, 'Finds local leads');
  assert.equal(spawnFromRole!.args.create_if_missing.model, 'anthropic/claude-sonnet-4-6');

  // An explicit create_if_missing envelope must be preserved untouched.
  const spawnExplicitEnvelope = normalizeAgentTeamWrapperTool('agent_ops', {
    action: 'spawn',
    from_role: 'researcher',
    create_if_missing: { specialization: 'explicit envelope' },
  });
  assert.equal(spawnExplicitEnvelope!.args.create_if_missing.specialization, 'explicit envelope');
  assert.equal(
    spawnExplicitEnvelope!.args.create_if_missing.from_role,
    undefined,
    'explicit create_if_missing must not be rebuilt',
  );

  // agent_id should alias to subagent_id for spawn.
  const spawnByAgentId = normalizeAgentTeamWrapperTool('agent_ops', {
    action: 'spawn',
    agent_id: 'existing_agent',
  });
  assert.equal(spawnByAgentId!.args.subagent_id, 'existing_agent');
  assert.equal(spawnByAgentId!.args.create_if_missing, undefined, 'known subagent_id needs no create envelope');

  // Unrelated wrappers must be untouched.
  assert.equal(normalizeAgentTeamWrapperTool('not_a_wrapper', { action: 'x' }), null);

  const unsupported = normalizeAgentTeamWrapperTool('team_collab_ops', { action: 'nope' });
  assert.ok(unsupported?.error, 'unsupported action should still error');

  const missingAction = normalizeAgentTeamWrapperTool('team_ops_wrapper', {});
  assert.ok(missingAction?.error, 'missing action should still error');

  console.log('agent-team-wrapper-params regression passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
