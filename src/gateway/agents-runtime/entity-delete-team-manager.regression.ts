import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real config/store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-delete-manager-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  const { getConfig } = await import('../../config/config');
  const managed = await import('../teams/managed-teams');
  const { deleteAgentCompletely, deleteTeamCompletely } = await import('./entity-delete');
  const cm = getConfig();

  const agentIds = () => (((cm.getConfig() as any).agents || []) as any[]).map((a) => String(a.id));
  const hasAgent = (id: string) => agentIds().includes(id);
  const addAgents = (...ids: string[]) => {
    const agents = [...(((cm.getConfig() as any).agents || []) as any[])];
    for (const id of ids) if (!agents.some((a) => a.id === id)) agents.push({ id, name: id, description: `agent ${id}` });
    cm.updateConfig({ agents } as any);
  };
  const patchAgent = (id: string, patch: Record<string, any>) => {
    const agents = [...(((cm.getConfig() as any).agents || []) as any[])];
    const i = agents.findIndex((a) => a.id === id);
    assert.ok(i >= 0, `fixture agent ${id} exists`);
    agents[i] = { ...agents[i], ...patch };
    cm.updateConfig({ agents } as any);
  };
  const newTeam = (name: string, members: string[]) => {
    addAgents(...members);
    return managed.createManagedTeam({ name, description: 'd', subagentIds: members, teamContext: 'ctx', managerSystemPrompt: 'p' });
  };
  const fakeScheduler = (jobs: Array<{ id: string; subagent_id?: string }>) => ({
    jobs: [...jobs],
    getJobs() { return [...this.jobs]; },
    deleteJob(id: string) { const n = this.jobs.length; this.jobs = this.jobs.filter((j) => j.id !== id); return this.jobs.length !== n; },
  });

  // A standalone agent and a second, untouched team that must survive everything below.
  addAgents('solo');
  const keep = newTeam('Keep', ['keep_member']);
  const keepManager = `${keep.id}_manager`;
  assert.ok(hasAgent(keepManager), 'creating a team registers its manager agent');

  // 1) Explicit delete (the reported fault): members, manager, manager schedule and manager chat all go.
  const a = newTeam('Alpha', ['alpha_one', 'alpha_two']);
  const aManager = `${a.id}_manager`;
  const aIdentity = managed.getTeamManagerIdentityPath(a.id);
  const aChat = path.join(cm.getConfigDir(), 'agent-chats', `${aManager}.json`);
  fs.mkdirSync(path.dirname(aChat), { recursive: true });
  fs.writeFileSync(aChat, '[]', 'utf-8');
  assert.ok(hasAgent(aManager) && fs.existsSync(aIdentity), 'fixture: manager record and identity exist');
  const scheduler = fakeScheduler([
    { id: 'j_manager', subagent_id: aManager },
    { id: 'j_member', subagent_id: 'alpha_one' },
    { id: 'j_solo', subagent_id: 'solo' },
    { id: 'j_keep_manager', subagent_id: keepManager },
  ]);
  const events: any[] = [];
  const del = deleteTeamCompletely({ teamId: a.id, cronScheduler: scheduler, broadcastTeamEvent: (e) => events.push(e) });
  assert.equal(del.success, true);
  assert.deepEqual(del.deletedAgents, ['alpha_one', 'alpha_two'], 'deletedAgents still lists members only');
  assert.equal(del.deletedManagerAgentId, aManager, 'result names the removed manager');
  assert.equal(hasAgent(aManager), false, 'manager agent record is gone (was left behind as an orphan)');
  assert.equal(hasAgent('alpha_one') || hasAgent('alpha_two'), false, 'member agents removed as before');
  assert.equal(managed.getManagedTeam(a.id), null, 'team removed');
  assert.equal(fs.existsSync(aIdentity), false, 'manager identity directory removed with the team');
  assert.equal(fs.existsSync(aChat), false, 'manager chat history removed');
  assert.ok(del.removedAgentPaths.includes(path.resolve(aChat)), 'removed manager paths are reported');
  assert.equal(del.deletedScheduledJobs, 2, 'manager + member schedules removed');
  assert.deepEqual(scheduler.jobs.map((j) => j.id), ['j_solo', 'j_keep_manager'], 'unrelated schedules untouched');
  assert.deepEqual(events.map((e) => e.type), ['team_deleted'], 'one team_deleted event, nothing extra');
  assert.ok(hasAgent('solo') && hasAgent(keepManager) && hasAgent('keep_member'), 'unrelated agents and the other team survive');
  assert.ok(managed.getManagedTeam(keep.id), 'other team survives');
  assert.deepEqual(managed.reconcileOrphanedManagerAgents(), [], 'nothing left for the startup orphan sweep to detach');

  // 2) delete_agents:false keeps the members but still removes the manager (it cannot outlive its team).
  const b = newTeam('Beta', ['beta_one']);
  const bDel = deleteTeamCompletely({ teamId: b.id, deleteAgents: false });
  assert.equal(bDel.success, true);
  assert.deepEqual(bDel.deletedAgents, []);
  assert.equal(bDel.deletedManagerAgentId, `${b.id}_manager`);
  assert.equal(hasAgent('beta_one'), true, 'member kept when delete_agents is false');
  assert.equal(hasAgent(`${b.id}_manager`), false, 'manager removed even when members are kept');

  // 3) Guard: a team record pointing managerAgentId at an unrelated standalone agent must not delete it.
  const c = newTeam('Gamma', ['gamma_one']);
  const cStored: any = managed.getManagedTeam(c.id);
  cStored.managerAgentId = 'solo';
  managed.saveManagedTeam(cStored);
  const cDel = deleteTeamCompletely({ teamId: c.id });
  assert.equal(cDel.success, true);
  assert.equal(cDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent('solo'), true, 'unlinked agent named as manager is NOT deleted');

  // 4) Guard: a manager record linked to a different team is not this team's manager.
  const d = newTeam('Delta', ['delta_one']);
  patchAgent(`${d.id}_manager`, { teamId: keep.id });
  const dDel = deleteTeamCompletely({ teamId: d.id });
  assert.equal(dDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent(`${d.id}_manager`), true, 'record linked to another team is NOT deleted');

  // 5) Guard: a non-manager record sitting on the default id is left alone.
  const e = newTeam('Epsilon', ['epsilon_one']);
  patchAgent(`${e.id}_manager`, { isTeamManager: false, roleType: 'agent' });
  const eDel = deleteTeamCompletely({ teamId: e.id });
  assert.equal(eDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent(`${e.id}_manager`), true, 'record that is not a manager is NOT deleted');

  // 6) Guard: an agent another live team uses (as a member) is never taken.
  const f = newTeam('Zeta', ['zeta_one']);
  const keepStored: any = managed.getManagedTeam(keep.id);
  keepStored.subagentIds = [...keepStored.subagentIds, `${f.id}_manager`];
  managed.saveManagedTeam(keepStored);
  const fDel = deleteTeamCompletely({ teamId: f.id });
  assert.equal(fDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent(`${f.id}_manager`), true, 'agent still used by another team is NOT deleted');

  // 7) Guard: manager id that is also listed as a member follows delete_agents, not the manager rule.
  const g = newTeam('Eta', ['eta_one']);
  const gStored: any = managed.getManagedTeam(g.id);
  gStored.subagentIds = ['eta_one', `${g.id}_manager`];
  managed.saveManagedTeam(gStored);
  const gDel = deleteTeamCompletely({ teamId: g.id, deleteAgents: false });
  assert.equal(gDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent(`${g.id}_manager`), true, 'kept with the other members when delete_agents is false');

  // 8) Guard: a manager the startup sweep already detached has no link back, so it is left alone.
  const h = newTeam('Theta', ['theta_one']);
  patchAgent(`${h.id}_manager`, { isTeamManager: false, roleType: 'orphaned_manager', teamId: '' });
  const hDel = deleteTeamCompletely({ teamId: h.id });
  assert.equal(hDel.deletedManagerAgentId, undefined);
  assert.equal(hasAgent(`${h.id}_manager`), true, 'detached record without a team link is NOT deleted');

  // 9) No manager record at all: delete still succeeds and reports no manager.
  const i = newTeam('Iota', ['iota_one']);
  assert.equal(deleteAgentCompletely({ agentId: `${i.id}_manager`, updateTeamMembership: false }).success, true);
  const iDel = deleteTeamCompletely({ teamId: i.id });
  assert.equal(iDel.success, true);
  assert.equal(iDel.deletedManagerAgentId, undefined);

  // 10) Deleting the LAST member auto-deletes the team; its manager goes too. Workspace stays, as before.
  const j = newTeam('Kappa', ['kappa_one', 'kappa_two']);
  const jManager = `${j.id}_manager`;
  const jIdentity = managed.getTeamManagerIdentityPath(j.id);
  const first = deleteAgentCompletely({ agentId: 'kappa_one' });
  assert.equal(first.success, true);
  assert.deepEqual(first.affectedTeams.map((t) => [t.id, t.removedTeam, t.deletedManagerAgentId]), [[j.id, false, undefined]]);
  assert.equal(hasAgent(jManager), true, 'manager stays while the team still has a member');
  assert.ok(managed.getManagedTeam(j.id), 'team stays while it still has a member');
  const jScheduler = fakeScheduler([{ id: 'j_k_manager', subagent_id: jManager }, { id: 'j_k_member', subagent_id: 'kappa_two' }]);
  const last = deleteAgentCompletely({ agentId: 'kappa_two', cronScheduler: jScheduler });
  assert.equal(last.success, true);
  assert.deepEqual(last.affectedTeams.map((t) => [t.id, t.removedTeam, t.deletedManagerAgentId]), [[j.id, true, jManager]]);
  assert.equal(managed.getManagedTeam(j.id), null, 'team auto-deleted with its last member');
  assert.equal(hasAgent(jManager), false, 'manager removed with the auto-deleted team');
  assert.equal(last.deletedScheduledJobs, 2, 'member + manager schedules counted');
  assert.deepEqual(jScheduler.jobs, []);
  assert.equal(fs.existsSync(jIdentity), true, 'auto-delete still leaves the team workspace on disk');

  // Everything unrelated is still intact at the end.
  assert.ok(hasAgent('solo') && hasAgent(keepManager) && hasAgent('keep_member') && managed.getManagedTeam(keep.id));
  assert.equal(deleteAgentCompletely({ agentId: 'main' }).success, false, 'main agent can never be deleted');

  console.log('entity-delete-team-manager regression: PASS');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
