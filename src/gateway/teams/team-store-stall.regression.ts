import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-stall-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

async function main() {
  const { getConfig } = await import('../../config/config');
  const storePath = path.join(getConfig().getConfigDir(), 'managed-teams.json');
  const now = Date.now();
  const team = {
    id: 'team_stall', name: 'Stall', subagentIds: [], managerAgentId: 'team_stall_manager',
    purpose: 'p', currentFocus: 'goal A', teamChat: [], runHistory: [], createdAt: now, updatedAt: now,
    roomState: {
      purpose: 'p', runGoal: 'goal A', roomMessages: [], managerInbox: [], memberStates: {}, sharedArtifacts: [],
      dispatches: [
        { id: 'd_orphan', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', createdAt: now - 3600_000 },
        { id: 'd_done', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: 'task_done', createdAt: now - 60_000 },
        { id: 'd_fresh', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', createdAt: now - 60_000 },
        { id: 'd_live', agentId: 'a', agentName: 'A', taskSummary: 'x', status: 'running', taskId: 'task_live', createdAt: now - 60_000 },
      ],
    },
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, updatedAt: now, teams: [team] }));

  const mt = await import('./managed-teams');

  // 1) Team events must not re-read/re-parse the whole store each time.
  mt.getManagedTeam('team_stall');
  const realRead = fs.readFileSync;
  let storeReads = 0;
  (fs as any).readFileSync = function (p: any, ...rest: any[]) {
    if (String(p).endsWith('managed-teams.json')) storeReads++;
    return (realRead as any).call(fs, p, ...rest);
  };
  try {
    for (let i = 0; i < 20; i++) {
      mt.appendTeamRoomMessage('team_stall', { actorType: 'system', actorName: 'T', content: `m${i}`, category: 'status' } as any);
    }
  } finally {
    (fs as any).readFileSync = realRead;
  }
  assert.equal(storeReads, 0, `20 room messages re-parsed the store ${storeReads} times`);
  assert.equal(mt.getManagedTeam('team_stall')!.roomState!.roomMessages.length, 20);

  // 2) A write from another process (different size/mtime) is still picked up.
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  raw.teams[0].name = 'Renamed by other gateway process';
  fs.writeFileSync(storePath, JSON.stringify(raw));
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(storePath, future, future);
  assert.equal(mt.getManagedTeam('team_stall')!.name, 'Renamed by other gateway process');

  // 3) Exactly one completion review per goal; a new goal re-arms it.
  const k1 = mt.claimTeamGoalCompletionReview('team_stall');
  assert.ok(k1, 'first GOAL_COMPLETE claims the review');
  assert.equal(mt.claimTeamGoalCompletionReview('team_stall'), null, 'repeat GOAL_COMPLETE is skipped');
  assert.equal(mt.claimTeamGoalCompletionReview('team_stall'), null, 'and stays skipped');
  const t = mt.getManagedTeam('team_stall')!;
  t.roomState!.runGoal = 'goal B';
  t.currentFocus = 'goal B';
  mt.saveManagedTeam(t);
  const k2 = mt.claimTeamGoalCompletionReview('team_stall');
  assert.ok(k2 && k2 !== k1, 'new goal gets its own review');

  // 4) Stale dispatch records settle; live/fresh ones are left alone.
  const tasks: Record<string, { status: string }> = { task_done: { status: 'complete' }, task_live: { status: 'running' } };
  const fixed = mt.reconcileStaleTeamDispatches(Date.now(), (id) => tasks[id] || null);
  assert.equal(fixed, 2);
  const byId = Object.fromEntries(mt.getManagedTeam('team_stall')!.roomState!.dispatches.map((d: any) => [d.id, d.status]));
  assert.deepEqual(byId, { d_orphan: 'failed', d_done: 'completed', d_fresh: 'running', d_live: 'running' });
  assert.equal(mt.reconcileStaleTeamDispatches(Date.now(), (id) => tasks[id] || null), 0, 'idempotent');

  console.log('team-store-stall regression: PASS');
}

main().then(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
