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

  // 5) One live dispatch per member: d_fresh/d_live are running for agent 'a'.
  const team5 = mt.getManagedTeam('team_stall')!;
  assert.ok(mt.findActiveTeamDispatch(team5, 'a'), 'running dispatch is found for the member');
  assert.equal(mt.findActiveTeamDispatch(team5, 'b'), null, 'other members are free');
  assert.equal(mt.findActiveTeamDispatch(team5, 'a', Date.now() + 3 * 3600_000), null, 'ancient runs do not block');

  // 6) A background handle created up front is stored on the record, and one
  //    the process no longer knows (restart) settles as lost.
  const rec = mt.createTeamDispatchRecord('team_stall', { agentId: 'c', taskSummary: 'bg', taskId: 'team_bg_abc_123' })!;
  assert.equal(rec.taskId, 'team_bg_abc_123', 'dispatch record carries the team_bg handle at creation');
  const t6 = mt.getManagedTeam('team_stall')!;
  const r6 = t6.roomState!.dispatches.find((d: any) => d.id === rec.id)!;
  r6.status = 'running';
  r6.createdAt = Date.now() - 30 * 60_000;
  mt.saveManagedTeam(t6);
  assert.equal(mt.reconcileStaleTeamDispatches(Date.now(), () => null), 1, 'lost team_bg handle settles after 20 min');
  const after = mt.getManagedTeam('team_stall')!.roomState!.dispatches.find((d: any) => d.id === rec.id)!;
  assert.equal(after.status, 'failed');

  // 7) [GOAL_COMPLETE] gate: unlogged work, a skipped proposal step and a member
  //    still running all block completion; a finished goal swallows repeats.
  mt.setTeamRunGoal('team_stall', 'goal C: build it, then Soren drafts a formal proposal');
  const t7 = mt.getManagedTeam('team_stall')!;
  t7.roomState!.dispatches = [];
  mt.saveManagedTeam(t7);
  const noProps = () => [] as Array<{ createdAt?: number }>;
  let g = mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: noProps });
  assert.equal(g.ok, false);
  assert.equal(g.missing.length, 2, 'needs log_completed and the proposal');
  mt.logCompletedWork('team_stall', 'built it');
  g = mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: noProps });
  assert.deepEqual(g.missing.length, 1, 'log satisfies the first gap');
  assert.match(g.missing[0], /proposal/);
  const old = () => [{ createdAt: Date.now() - 86_400_000 }];
  assert.equal(mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: old }).ok, false, 'an older goal\'s proposal does not count');
  const fresh = () => [{ createdAt: Date.now() + 1 }];
  assert.equal(mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: fresh }).ok, true, 'proposal for this goal passes');
  mt.createTeamDispatchRecord('team_stall', { agentId: 'tt_reviewer', agentName: 'TT Reviewer', taskSummary: 're-review', taskId: 'team_bg_live' });
  const t7b = mt.getManagedTeam('team_stall')!;
  t7b.roomState!.dispatches[t7b.roomState!.dispatches.length - 1].status = 'running';
  mt.saveManagedTeam(t7b);
  g = mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: fresh });
  assert.deepEqual(g.waitForMembers, ['TT Reviewer'], 'a member still working blocks completion');
  // A goal without a proposal step does not demand one.
  mt.setTeamRunGoal('team_stall', 'goal D: just build it');
  mt.logCompletedWork('team_stall', 'built D');
  const t7c = mt.getManagedTeam('team_stall')!;
  t7c.roomState!.dispatches = [];
  t7c.purpose = 'p';
  mt.saveManagedTeam(t7c);
  assert.equal(mt.evaluateTeamGoalCompletionGate('team_stall', { listTeamProposals: noProps }).ok, true);
  assert.equal(mt.isTeamGoalCompleted('team_stall'), false);
  assert.ok(mt.claimTeamGoalCompletionReview('team_stall'));
  assert.equal(mt.isTeamGoalCompleted('team_stall'), true, 'reviewed goal reads as completed');
  const { shouldWakeManager } = await import('./team-event-router');
  assert.equal(shouldWakeManager({ type: 'member_completed_task', teamId: 'team_stall', agentId: 'x', source: 'background_dispatch' }, []), false,
    'a straggler result after the review does not wake the manager');
  assert.equal(shouldWakeManager({ type: 'member_failed_task', teamId: 'team_stall', agentId: 'x' }, []), true, 'failures still wake it');
  mt.setTeamRunGoal('team_stall', 'goal E');
  assert.equal(mt.isTeamGoalCompleted('team_stall'), false, 'a new goal re-arms everything');

  console.log('team-store-stall regression: PASS');
}

main().then(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
