import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-simplify-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

/**
 * Teams simplification (2026-10-07):
 *  - background member results wake the manager directly (no internal_watch polling);
 *  - manage_team_goal is set_focus / log_completed / pause_agent / unpause_agent only;
 *  - the manager prompt no longer asks for memory.json / last_run.json / pending.json;
 *  - team workspaces no longer get those files created.
 */
async function main() {
  const { getConfig } = await import('../../config/config');
  const storePath = path.join(getConfig().getConfigDir(), 'managed-teams.json');
  const now = Date.now();
  const team = {
    id: 'team_simp', name: 'Simp', subagentIds: ['a1'], managerAgentId: 'team_simp_manager',
    purpose: 'p', currentFocus: 'goal', teamChat: [], runHistory: [], createdAt: now, updatedAt: now,
    roomState: { purpose: 'p', runGoal: 'goal', roomMessages: [], managerInbox: [], memberStates: {}, sharedArtifacts: [], dispatches: [], plan: [] },
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, updatedAt: now, teams: [team] }));

  // 1. Background completion wakes the manager even with no open plan items.
  const { shouldWakeManager } = await import('./team-event-router');
  const base = { type: 'member_completed_task' as const, teamId: 'team_simp', agentId: 'a1', task: 't', resultSummary: 'done' };
  assert.equal(shouldWakeManager({ ...base, source: 'dispatch_team_agent_background' }, []), true, 'background completion wakes manager');
  assert.equal(shouldWakeManager({ ...base, source: 'api_team_dispatch_background' }, []), true, 'API background completion wakes manager');
  assert.equal(shouldWakeManager({ ...base, source: 'dispatch_team_agent' }, []), false, 'foreground result returns inline, no extra wake');

  // 2. Removed goal actions are rejected with guidance; kept ones still work.
  const { teamAgentCapabilityExecutor, normalizeTeamGoalAction } = await import('../agents-runtime/capabilities/team-agent-executor');
  assert.equal(normalizeTeamGoalAction('mission'), 'mission', 'mission alias removed');
  assert.equal(normalizeTeamGoalAction('log_completion'), 'log_completed');
  const deps: any = { broadcastTeamEvent: () => {}, broadcastWS: () => {} };
  const run = (args: any) => teamAgentCapabilityExecutor.execute({ name: 'manage_team_goal', args, deps, sessionId: 'team_coord_team_simp', workspacePath: root } as any);
  for (const action of ['set_mission', 'add_milestone', 'update_milestone']) {
    const r: any = await run({ team_id: 'team_simp', action, value: 'x', milestone_description: 'x', milestone_id: 'm' });
    assert.equal(r.error, true, `${action} rejected`);
    assert.match(String(r.result), /was removed/);
  }
  const logged: any = await run({ team_id: 'team_simp', action: 'log_completed', value: 'shipped dur-cli' });
  assert.equal(logged.error, false, 'log_completed works');
  const { getManagedTeam } = await import('./managed-teams');
  assert.ok((getManagedTeam('team_simp') as any).completedWork.some((w: string) => w.includes('shipped dur-cli')));

  // 3. Prompt + workspace no longer use the cross-run memory files.
  const coord = fs.readFileSync(path.join(__dirname, 'team-coordinator.ts'), 'utf8');
  assert.ok(!/update memory\.json|last_run\.json: overwrite|CROSS-RUN MEMORY/.test(coord), 'manager prompt drops memory-file bookkeeping');
  assert.ok(!/internal_watch are available/.test(coord), 'manager prompt no longer advertises watch polling');
  const { initTeamWorkspaceArtifacts, getTeamWorkspacePath } = await import('./team-workspace');
  initTeamWorkspaceArtifacts(getManagedTeam('team_simp') as any);
  const ws = getTeamWorkspacePath('team_simp');
  for (const f of ['memory.json', 'last_run.json', 'pending.json']) {
    assert.equal(fs.existsSync(path.join(ws, f)), false, `${f} not created`);
  }

  console.log('team-simplify regression: PASS');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
