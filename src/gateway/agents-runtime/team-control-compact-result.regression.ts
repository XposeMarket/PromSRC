import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real config/store is never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-control-result-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

// A marker that only exists inside chat / run / room history. If it shows up in
// a pause or resume result, the full team record leaked into the tool output.
const LEAK = 'HISTORY_LEAK_MARKER';
const big = `${LEAK} ${'x'.repeat(20_000)}`;

function hugeHistory() {
  return {
    teamChat: Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`, from: 'manager', content: big, thinking: big, timestamp: 1000 + i,
      processEntries: [{ text: big }], liveTraceEntries: [{ text: big }],
    })),
    runHistory: Array.from({ length: 5 }, (_, i) => ({ startedAt: 100 + i, finishedAt: 200 + i, trace: big })),
  };
}

async function main() {
  const managed = await import('../teams/managed-teams');
  const { handleAgentsTool } = await import('./handlers/agents');
  const { summarizeTeamControlResult, summarizeTeamControlResponse } = await import('../teams/team-list-summary');

  const team = managed.createManagedTeam({
    name: 'Control Result', description: 'd', subagentIds: ['member_a', 'member_b'], teamContext: 'ctx', managerSystemPrompt: 'p',
  });
  const stored: any = managed.getManagedTeam(team.id);
  Object.assign(stored, hugeHistory(), { totalRuns: 78 });
  managed.saveManagedTeam(stored);
  const fullSize = JSON.stringify(managed.getManagedTeam(team.id)).length;
  assert.ok(fullSize > 4_000_000, `fixture is as large as the real failure (${fullSize} chars)`);

  // Stand-ins for the real internals: same contract (flip the flag, return the WHOLE team record).
  const setPaused = (teamId: string, paused: boolean, reason?: string) => {
    const t: any = managed.getManagedTeam(teamId);
    if (!t) return { success: false, error: 'Team not found' };
    if ((t.manager?.paused === true) === paused) return { success: true, team: t };
    t.manager = { ...t.manager, paused, pausedAt: paused ? 1795785128004 : undefined, pauseReason: paused ? reason : undefined };
    managed.saveManagedTeam(t);
    return { success: true, team: managed.getManagedTeam(teamId) };
  };
  const bound: string[] = [];
  const deps: any = {
    bindTeamNotificationTargetFromSession: (_teamId: string, _sessionId: string, source: string) => { bound.push(source); },
    pauseManagedTeamInternal: (teamId: string, reason?: string) => setPaused(teamId, true, reason),
    resumeManagedTeamInternal: (teamId: string) => setPaused(teamId, false),
  };
  const call = (args: any) => handleAgentsTool({ name: 'team_manage', args, deps, sessionId: 's1', workspacePath: root, __dirname } as any);

  // 1) pause: compact, correct state, no history.
  const paused: any = await call({ action: 'pause', team_id: team.id, reason: 'test window closed' });
  assert.equal(paused.error, false);
  assert.ok(paused.result.length < 2_000, `pause result is compact (${paused.result.length} chars, record is ${fullSize})`);
  assert.ok(!paused.result.includes(LEAK), 'pause result carries no chat/run history');
  const p = JSON.parse(paused.result);
  assert.equal(p.success, true);
  assert.equal(p.action, 'pause');
  assert.equal(p.changed, true);
  assert.deepEqual(
    { id: p.team.id, name: p.team.name, paused: p.team.paused, pausedAt: p.team.pausedAt, pauseReason: p.team.pauseReason },
    { id: team.id, name: 'Control Result', paused: true, pausedAt: 1795785128004, pauseReason: 'test window closed' },
  );
  assert.equal(p.team.managerAgentId, `${team.id}_manager`);
  assert.deepEqual(p.team.subagentIds, ['member_a', 'member_b']);
  assert.equal(p.team.memberCount, 2);
  assert.equal(p.team.teamChatCount, 80, 'history is counted, not returned');
  assert.equal(p.team.runHistoryCount, 5);
  assert.equal(p.team.totalRuns, 78);
  assert.equal(managed.getManagedTeam(team.id)?.manager?.paused, true, 'the pause itself still happened');
  assert.equal(managed.getManagedTeam(team.id)?.teamChat?.length, 80, 'stored history is untouched');

  // 2) pausing an already-paused team: still success, changed=false, still compact.
  const again: any = await call({ action: 'pause', team_id: team.id });
  assert.equal(again.error, false);
  assert.equal(JSON.parse(again.result).changed, false);
  assert.ok(again.result.length < 2_000 && !again.result.includes(LEAK));

  // 3) resume: compact, pause fields cleared.
  const resumed: any = await call({ action: 'resume', team_id: team.id });
  assert.equal(resumed.error, false);
  assert.ok(resumed.result.length < 2_000, `resume result is compact (${resumed.result.length} chars)`);
  assert.ok(!resumed.result.includes(LEAK), 'resume result carries no chat/run history');
  const r = JSON.parse(resumed.result);
  assert.deepEqual(
    { action: r.action, changed: r.changed, paused: r.team.paused, pausedAt: r.team.pausedAt, pauseReason: r.team.pauseReason },
    { action: 'resume', changed: true, paused: false, pausedAt: null, pauseReason: null },
  );
  assert.equal(managed.getManagedTeam(team.id)?.manager?.paused, false);
  assert.deepEqual(bound, ['team_manage:pause', 'team_manage:pause', 'team_manage:resume'], 'notification binding unchanged');

  // 4) failures stay errors and keep their message.
  const missing: any = await call({ action: 'pause', team_id: 'team_does_not_exist' });
  assert.equal(missing.error, true);
  assert.deepEqual(JSON.parse(missing.result), { success: false, action: 'pause', error: 'Team not found' });
  const noId: any = await call({ action: 'resume' });
  assert.equal(noId.error, true);
  assert.match(noId.result, /requires team_id/);
  assert.equal(summarizeTeamControlResult('resume', null).success, false);
  assert.equal(summarizeTeamControlResult('resume', { success: true }).success, false, 'success without a team is not reported as success');

  // 5) the read path still returns detail: status is where manager/member state lives.
  const status: any = await call({ action: 'status', team_id: team.id });
  assert.equal(status.error, false);
  assert.equal(JSON.parse(status.result).team.manager.messageCount, 80, 'history is still reachable through status');

  // 6) HTTP pause/resume/interrupt response: heavy fields stripped, everything else passed through.
  const full: any = managed.getManagedTeam(team.id);
  const http: any = summarizeTeamControlResponse({ success: true, team: full, aborted: 2, requested: 3 }, 12_000);
  assert.ok(!JSON.stringify(http).includes(LEAK), 'HTTP response carries no chat/run history');
  assert.ok(JSON.stringify(http).length < 20_000, `HTTP response is small (${JSON.stringify(http).length} chars)`);
  assert.deepEqual({ success: http.success, aborted: http.aborted, requested: http.requested }, { success: true, aborted: 2, requested: 3 });
  assert.equal(http.team.id, team.id);
  assert.equal(http.team.teamChat, undefined);
  assert.equal(http.team.runHistory, undefined);
  assert.equal(http.team.roomState, undefined);
  assert.equal(http.team.teamChatCount, 80);
  assert.equal(http.team.running, true, 'live run state is reported like the list route');
  assert.equal(http.team.manager.paused, false, 'clients can still read pause state');
  const failure = { success: false, error: 'Team not found' };
  assert.equal(summarizeTeamControlResponse(failure), failure, 'failures pass through untouched');
  assert.equal(full.teamChat.length, 80, 'input not mutated');

  console.log(`team-control-compact-result regression: PASS (record ${fullSize} chars -> pause ${paused.result.length}, resume ${resumed.result.length})`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
