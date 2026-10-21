import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real config/store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-mgr-model-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  const { getConfig } = await import('../../config/config');
  const { ensureManagedTeamManagerAgent, setManagedTeamManagerRouting } = await import('./managed-teams');
  const cm = getConfig();
  const agentRec = () => ((cm.getConfig() as any).agents || []).find((a: any) => a.id === 'tm1_manager');
  const team: any = { id: 'tm1', name: 'Model Sync', managerAgentId: 'tm1_manager', mission: 'm', manager: { systemPrompt: 's', model: 'openai_codex/gpt-6.1-sol', reviewTrigger: 'manual', autoApplyLowRisk: true } };

  // 1) New manager agent is seeded from team.manager.model.
  ensureManagedTeamManagerAgent(team);
  assert.equal(agentRec()?.model, 'openai_codex/gpt-6.1-sol', 'seeded from team.manager');

  // 2) Bug B: model + effort changed on the AGENT (agent_ops update) must survive the next sync,
  //    and be mirrored into team.manager (it used to revert to the team copy).
  const agents = [...(cm.getConfig() as any).agents];
  const i = agents.findIndex((a: any) => a.id === 'tm1_manager');
  agents[i] = { ...agents[i], model: 'anthropic/claude-opus-5-5', reasoning_effort: 'low' };
  cm.updateConfig({ agents } as any);
  ensureManagedTeamManagerAgent(team);
  ensureManagedTeamManagerAgent(team);
  assert.equal(agentRec()?.model, 'anthropic/claude-opus-5-5', 'agent model not reverted');
  assert.equal(agentRec()?.reasoning_effort, 'low', 'agent effort kept');
  assert.equal(team.manager.model, 'anthropic/claude-opus-5-5', 'team.manager mirrors agent model');
  assert.equal(team.manager.reasoningEffort, 'low', 'team.manager mirrors agent effort');

  // 3) Team-level edit (team_manage manager_model / PUT manager.model) wins and sticks.
  setManagedTeamManagerRouting(team, { model: 'anthropic/claude-haiku-5-5', reasoningEffort: 'medium' });
  ensureManagedTeamManagerAgent(team);
  assert.equal(agentRec()?.model, 'anthropic/claude-haiku-5-5', 'team-level model applied to agent');
  assert.equal(agentRec()?.reasoning_effort, 'medium', 'team-level effort applied to agent');
  assert.equal(team.manager.model, 'anthropic/claude-haiku-5-5');

  // 4) Clearing effort removes it from both (provider default), model untouched.
  setManagedTeamManagerRouting(team, { reasoningEffort: '' });
  assert.equal(agentRec()?.reasoning_effort, undefined, 'effort cleared on agent');
  assert.equal(team.manager.reasoningEffort, undefined, 'effort cleared on team');
  assert.equal(agentRec()?.model, 'anthropic/claude-haiku-5-5', 'model untouched by effort-only patch');

  console.log('team-manager-model-sync regression: PASS');
}

main().catch((err) => { console.error(err); process.exit(1); });
