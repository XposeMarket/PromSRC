/**
 * Regression: a team-manager turn interrupted by a gateway crash/restart must be re-woken.
 *
 * 2026-10-27: the gateway exited (code 134) while the Roblox Studio manager was mid auto-wake
 * for Forge's FIX loop 3 result. Startup recovery only wrote an "[Interrupted by gateway restart]
 * ... will automatically continue" checkpoint into the coordinator session; nothing re-ran the
 * turn, so the team sat idle for 73 minutes until main Prometheus replied to it by hand.
 *
 * Team managers are event-driven, so recovery must hand interrupted manager runtimes back to
 * startup for one auto-wake per team, and must never re-wake a turn that was itself a re-wake.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data/workspace dirs so the real ledger and team store are never touched.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-team-rewake-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

const OTHER_PID = 999_999; // the previous gateway process

function managerRuntime(id: string, teamId: string, extra: Record<string, any> = {}) {
  const now = Date.now();
  return {
    id,
    kind: 'team_manager',
    label: `Team manager - ${teamId}`,
    sessionId: `team_coord_${teamId}`,
    teamId,
    source: 'system',
    detail: '[TEAM EVENT AUTO-WAKE]\nImportant team-room events occurred while the team was working.\n\nEvents:\n1. Forge completed work. Task: FIX loop 3',
    startedAt: now - 90_000,
    updatedAt: now - 60_000,
    abortable: true,
    status: 'running',
    pid: OTHER_PID,
    ...extra,
  };
}

async function main() {
  const { getConfig } = await import('../../config/config');
  const configDir = getConfig().getConfigDir();
  const now = Date.now();

  // Ledger left behind by the crashed gateway. Written before the registry first reads it.
  const runtimes: Record<string, any> = {
    rt_a1: managerRuntime('rt_a1', 'team_a'),
    rt_a2: managerRuntime('rt_a2', 'team_a', { updatedAt: now - 30_000 }),
    rt_loop: managerRuntime('rt_loop', 'team_loop', { recoveryData: { restartRecoveryWake: true } }),
    rt_old: managerRuntime('rt_old', 'team_old', { startedAt: now - 3 * 86_400_000, updatedAt: now - 2 * 86_400_000 }),
    rt_member: { ...managerRuntime('rt_member', 'team_m'), kind: 'team_member', sessionId: 'team_member_m' },
  };
  const ledgerPath = path.join(configDir, 'runtimes', 'active-runtimes.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({ version: 1, updatedAt: now, runtimes }));

  const recovery = await import('../runtime-recovery');
  const coordinator = await import('./team-coordinator');

  const result = recovery.recoverInterruptedRuntimes({ deferMainChatRetrigger: true });
  assert.ok(result.inspected >= 5, `precondition: recovery inspects the crashed gateway's runtimes (got ${result.inspected})`);
  assert.ok(Array.isArray(result.interruptedTeamManagerRuntimes), 'recovery must return interrupted team-manager runtimes');

  const rewoken = result.interruptedTeamManagerRuntimes.map((runtime) => runtime.teamId).sort();
  // Positive: the interrupted manager is handed back exactly once per team.
  assert.deepEqual(rewoken, ['team_a'], `only team_a should be re-woken, got ${JSON.stringify(rewoken)}`);
  // Negative: a re-wake turn that died again, a stale turn, and member runtimes are not re-woken.
  assert.ok(!rewoken.includes('team_loop'), 'a turn that was itself a restart re-wake must not loop');
  assert.ok(!rewoken.includes('team_old'), 'a manager turn older than the re-wake window is left to the schedule');
  assert.ok(!rewoken.includes('team_m'), 'team_member runtimes keep checkpoint-only behavior');

  // Every continuity session still gets its checkpoint (unchanged behavior).
  for (const runtime of Object.values(runtimes)) {
    assert.ok(result.interruptedChats.includes(runtime.sessionId), `${runtime.id} must still be checkpointed`);
  }
  // Marked handled in the ledger, so a later recovery pass (e.g. warm handoff) cannot re-wake it.
  assert.equal(
    recovery.recoverInterruptedRuntimes({ deferMainChatRetrigger: true }).interruptedTeamManagerRuntimes.length,
    0,
    'a second recovery pass must not re-wake the same manager again',
  );

  // The wake prompt carries the marker, and a manager turn started from it is flagged so a
  // crash during the re-wake turn is checkpointed only (one automatic retry, like main chat).
  const reason = coordinator.buildTeamManagerRestartWakeReason(result.interruptedTeamManagerRuntimes[0]);
  assert.ok(reason.startsWith(coordinator.TEAM_MANAGER_RESTART_WAKE_MARKER), 'reason starts with the marker');
  assert.match(reason, /Forge completed work/, 'reason says what the lost turn was handling');
  assert.match(reason, /Do not re-dispatch/, 'reason tells the manager to reconcile instead of duplicating work');
  assert.deepEqual(coordinator.teamManagerRuntimeRecoveryData(`[TEAM EVENT AUTO-WAKE]\n1. ${reason}`), { restartRecoveryWake: true });
  assert.equal(coordinator.teamManagerRuntimeRecoveryData('[TEAM EVENT AUTO-WAKE]\n1. Forge completed work.'), undefined);

  // The auto-wake path delivers that reason to the manager conversation.
  const storePath = path.join(configDir, 'managed-teams.json');
  const team = {
    id: 'team_a', name: 'A', subagentIds: [], managerAgentId: 'team_a_manager', purpose: 'p', currentFocus: 'goal',
    teamChat: [], runHistory: [], createdAt: now, updatedAt: now,
    roomState: { purpose: 'p', runGoal: 'goal', roomMessages: [], managerInbox: [], memberStates: {}, sharedArtifacts: [], dispatches: [] },
  };
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, updatedAt: now, teams: [team] }));
  const autowake = await import('./team-manager-autowake');
  const prompts: string[] = [];
  autowake.setTeamManagerAutoWakeDeps({
    handleManagerConversation: async (_teamId, userMessage) => { prompts.push(userMessage); },
    broadcastTeamEvent: () => {},
  });
  assert.equal(autowake.scheduleTeamManagerAutoWake('team_a', reason), true, 'auto-wake accepts the restart reason');
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  assert.equal(prompts.length, 1, 'exactly one manager turn runs');
  assert.deepEqual(coordinator.teamManagerRuntimeRecoveryData(prompts[0]), { restartRecoveryWake: true }, 'that turn is flagged as the re-wake');

  // Coordinator paths with a stub handleChat that records what each manager invocation receives.
  // Stored team-manager session history must never be loaded (only team state + coordinator prompt),
  // a turn that made any tool call continues, and a no-tool reply stops the run as no_action.
  const calls: Array<{ message: string; runtimeOptions: any }> = [];
  const verbose = 'Reviewing the room. Nothing new has arrived from the dispatched agents yet, so I will wait for their next report before changing anything else.';

  // Source of the bug: the stale 2026-10-27 checkpoint persisted in the coordinator session, read back via the session API.
  const sessionMod = await import('../session');
  sessionMod.addMessage('team_coord_team_a', { role: 'assistant', content: '[Interrupted by gateway restart] oldFIXloop3 will automatically continue' } as any);
  assert.ok(
    sessionMod.getActiveHistoryForApiCall('team_coord_team_a').some((m: any) => String(m.content).includes('oldFIXloop3')),
    'precondition: the stale checkpoint is persisted in coordinator session history',
  );

  // First (non-detailed) loop: a verbose no-tool reply must stop after one manager turn.
  coordinator.setCoordinatorDeps({
    handleChat: async (message: string, _sid: string, _sse: any, ..._rest: any[]) => {
      calls.push({ message, runtimeOptions: _rest[_rest.length - 1] });
      return { type: 'text', text: verbose };
    },
    broadcastTeamEvent: () => {},
  } as any);
  await coordinator.runCoordinatorConversation('team_a', 'Stale probe input', () => {}, true);
  assert.equal(calls.length, 1, `runCoordinatorConversation: a no-tool reply stops after one turn (got ${calls.length})`);

  // First loop: a turn that made a non-team tool call continues once; the following no-tool reply stops it.
  calls.length = 0;
  coordinator.setCoordinatorDeps({
    handleChat: async (message: string, _sid: string, sse: (event: string, data: any) => void, ..._rest: any[]) => {
      calls.push({ message, runtimeOptions: _rest[_rest.length - 1] });
      if (calls.length === 1) {
        sse('tool_call', { action: 'read_file', args: { path: 'notes.md' } });
        return { type: 'text', text: 'Reading one file first.' };
      }
      return { type: 'text', text: verbose };
    },
    broadcastTeamEvent: () => {},
  } as any);
  await coordinator.runCoordinatorConversation('team_a', 'Stale probe input', () => {}, true);
  assert.equal(calls.length, 2, `runCoordinatorConversation: a tool-making turn continues once (got ${calls.length} turns)`);

  // Detailed loop: same contract, tool turn continues, no-tool reply stops as no_action.
  calls.length = 0;
  coordinator.setCoordinatorDeps({
    handleChat: async (message: string, _sid: string, sse: (event: string, data: any) => void, ..._rest: any[]) => {
      const runtimeOptions = _rest[_rest.length - 1];
      calls.push({ message, runtimeOptions });
      if (calls.length === 1) {
        sse('tool_call', { action: 'list_team_members', args: {} });
        return { type: 'text', text: 'Checking the team room for Forge FIX loop 3 results before deciding the next step.' };
      }
      return { type: 'text', text: 'ok' };
    },
    broadcastTeamEvent: () => {},
  } as any);
  const detailed = await coordinator.runCoordinatorConversationDetailed('team_a', 'Stale probe input', () => {}, true);
  assert.equal(calls.length, 2, `a tool-making turn continues once, then the no-tool reply stops (got ${calls.length} manager turns)`);
  assert.ok(!('omitStoredHistory' in (calls[0].runtimeOptions ?? {})), 'no omitStoredHistory runtime option: turn 0 is built like any other invocation');
  assert.ok(!('omitStoredHistory' in (calls[1].runtimeOptions ?? {})), 'no omitStoredHistory runtime option on continuation turns');
  assert.equal(detailed.reason, 'no_action', 'a no-tool continuation reply ends the run as no_action');
  assert.equal(detailed.turns, 2, 'no_action stops at the reply that made no progress');

  // History selection consumed by handle-chat: team managers and cron load no stored history; interactive keeps it.
  const policy = await import('../routes/chat/pipeline/stored-history-policy');
  assert.equal(policy.shouldOmitStoredHistory('team_manager'), true, 'team manager invocations never load stored session history');
  assert.equal(policy.shouldOmitStoredHistory('cron'), true, 'cron stays isolated from stored history');
  assert.equal(policy.shouldOmitStoredHistory('interactive'), false, 'interactive turns keep stored history');
  assert.equal(policy.shouldOmitStoredHistory('background_task'), false, 'background tasks keep stored history');

  // Second stale path (PR802 review): the old checkpoint's toolLog reaches the prompt through
  // getRecentToolObservationsForContext -> legacy getRecentToolLog, not through stored history.
  const restartNotice = '[Interrupted by gateway restart] Continue from latest known progress instead of restarting completed work.';
  sessionMod.addMessage('team_coord_team_a', {
    role: 'assistant',
    content: '[Interrupted by gateway restart] oldFIXloop3',
    toolLog: restartNotice,
  } as any);
  assert.ok(
    sessionMod.getRecentToolObservationsForContext('team_coord_team_a', 3, 2200, true).includes('[Interrupted by gateway restart]'),
    'precondition: the stale restart notice is readable via the session tool-observation context',
  );

  // Production guards for all three stored-context sources, extracted from handle-chat's real ternaries
  // and evaluated against the real helper.
  const handleChatSrc = fs.readFileSync(path.resolve('src/gateway/routes/chat/pipeline/handle-chat.ts'), 'utf8');
  const guardFor = (name: string) => {
    const match = handleChatSrc.match(new RegExp(`const ${name} = ([^\\r\\n]+?)\\r?\\n\\s*\\?`));
    assert.ok(match, `handle-chat guard for ${name} must be found`);
    return new Function('shouldOmitStoredHistory', 'executionMode', 'isBootStartupTurn', `return (${match![1]});`) as
      (h: typeof policy.shouldOmitStoredHistory, mode: string, boot: boolean) => boolean;
  };
  const omitted = (name: string, mode: string, boot = false) => Boolean(guardFor(name)(policy.shouldOmitStoredHistory, mode, boot));
  for (const name of ['rawHistory', 'recentToolLog', 'workingContextBlock']) {
    assert.equal(omitted(name, 'team_manager'), true, `${name}: team manager turns exclude stale session context`);
    assert.equal(omitted(name, 'cron'), true, `${name}: cron stays excluded`);
    assert.equal(omitted(name, 'interactive'), false, `${name}: interactive keeps session context`);
  }
  assert.equal(omitted('recentToolLog', 'interactive', true), true, 'boot startup turns suppress recent tool observations');
  assert.equal(omitted('workingContextBlock', 'interactive', true), true, 'boot startup turns suppress working context');
  assert.equal(omitted('rawHistory', 'interactive', true), false, 'rawHistory boot behavior is unchanged');

  // The current explicit restart wake prompt is still delivered (not stored context).
  assert.ok(prompts[0].includes(coordinator.TEAM_MANAGER_RESTART_WAKE_MARKER), 'current restart wake prompt is preserved');



  console.log('team-manager-restart-rewake regression: PASS');
}

main().then(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
