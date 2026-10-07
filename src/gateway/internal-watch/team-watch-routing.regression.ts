import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-watch-routing-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function main(): Promise<void> {
  const runnerApi = await import('./internal-watch-runner');
  const broadcaster = await import('../comms/broadcaster');
  const dispatchRuntime = await import('../teams/team-dispatch-runtime');

  // Unrelated main chat that happens to be the last active one (the Edna chat).
  broadcaster.setLastMainSessionId('mobile_unrelated_chat');

  const teamWatch: any = {
    id: 'w1',
    label: 'Teams v3 planner completion',
    origin: { sessionId: 'team_coord_team_abc', channel: 'web' },
    target: { type: 'task', config: { task_id: 'team_bg_missing_1' } },
    condition: {},
  };

  // 1. A team-owned watch resolves to its team, and never to the last main chat.
  assert.equal(runnerApi.resolveWatchOwningTeamId(teamWatch), 'team_abc');
  const sid = runnerApi.resolveWatchDeliverySessionId(teamWatch, {});
  assert.notEqual(sid, 'mobile_unrelated_chat', 'team watch must not leak into the last active main chat');

  // A normal main-chat watch still uses its origin.
  const mainWatch: any = { ...teamWatch, origin: { sessionId: 'mobile_owner', channel: 'web' } };
  assert.equal(runnerApi.resolveWatchOwningTeamId(mainWatch), null);
  assert.equal(runnerApi.resolveWatchDeliverySessionId(mainWatch, {}), 'mobile_owner');

  // 2. team_bg_* ids are observed from the team dispatch runtime.
  assert.equal(runnerApi.observeTeamBackgroundDispatch('task_123'), null);
  const missing = runnerApi.observeTeamBackgroundDispatch('team_bg_missing_1');
  assert.equal(missing?.exists, false);

  dispatchRuntime._bgAgentResults.set('team_bg_live_1', {
    status: 'complete',
    agentId: 'tt_planner',
    teamId: 'team_abc',
    startedAt: Date.now(),
    promise: Promise.resolve({} as any),
    result: { success: true, result: 'SPEC.md written', durationMs: 1, agentName: 'Rhea' } as any,
  });
  const obs = runnerApi.observeTeamBackgroundDispatch('team_bg_live_1');
  assert.equal(obs?.exists, true);
  assert.equal(obs?.status, 'complete');
  assert.match(String(obs?.finalSummary), /SPEC\.md/);

  const observed = runnerApi.observeInternalWatchTarget({ ...teamWatch, target: { type: 'task', config: { task_id: 'team_bg_live_1' } } });
  assert.equal(observed.status, 'complete', 'watch on team_bg id must see completion');

  console.log('team-watch-routing.regression: OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
