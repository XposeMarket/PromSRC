import fs from 'node:fs';
import assert from 'node:assert/strict';

const wrapperPath = new URL('../src/gateway/agents-runtime/subagent-executor.ts', import.meta.url);
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const teamExecutor = fs.readFileSync(new URL('../src/gateway/agents-runtime/capabilities/team-agent-executor.ts', import.meta.url), 'utf8');

const wrapperStart = wrapper.indexOf('team_ops_wrapper:');
const wrapperEnd = wrapper.indexOf('team_collab_ops:', wrapperStart);
const teamWrapperBlock = wrapperStart >= 0 && wrapperEnd > wrapperStart
  ? wrapper.slice(wrapperStart, wrapperEnd)
  : '';
assert.match(teamWrapperBlock, /dispatch:\s*'dispatch_team_agent'/,
  'team_ops_wrapper dispatch must use the team-aware executor');
assert.doesNotMatch(teamWrapperBlock, /dispatch:\s*'dispatch_to_agent'/,
  'team_ops_wrapper dispatch must not create a standalone task');
assert.match(teamExecutor, /case 'dispatch_team_agent':/,
  'the team-aware dispatch capability must remain registered');
assert.match(teamExecutor, /runTeamAgentViaChat\(agentId, dispatchPrompt\.effectiveTask, teamId\)/,
  'team dispatch must execute through the team-bound chat runtime');

console.log('team ops dispatch context regression passed');
