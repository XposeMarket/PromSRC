import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data dir so the store-level cases never touch the real timers.json.
// These three select or relocate the canonical storage layout and would win
// over PROMETHEUS_DATA_DIR (src/runtime/storage-layout.ts), so drop any inherited
// value before an application module is imported.
delete process.env.PROMETHEUS_RUNTIME_DIR;
delete process.env.PROMETHEUS_STORAGE_LAYOUT;
delete process.env.PROMETHEUS_APP_DATA_DIR;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-timer-stranded-'));
process.env.PROMETHEUS_DATA_DIR = tempRoot;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(tempRoot, 'workspace');
fs.mkdirSync(process.env.PROMETHEUS_WORKSPACE_DIR, { recursive: true });

let child: ChildProcess | null = null;

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err: any) { return err?.code === 'EPERM'; }
}

async function waitUntil(test: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main(): Promise<void> {
  const { getConfig } = await import('../config/config');
  const store = await import('./timers/timer-store');
  const { recoverStrandedMainChatTimers, OWNED_RUNNING_TIMER_MAX_MS } = store;
  type Timer = import('./timers/timer-store').MainChatTimer;

  const bootAt = Date.parse('2026-10-14T12:00:00.000Z');
  const firedAt = '2026-10-14T10:30:00.000Z';
  const running = (id: string, extra: Partial<Timer> = {}): Timer => ({
    id, sessionId: 's', label: id, instruction: 'run', dueAt: '2026-10-14T11:00:00.000Z', status: 'running',
    createdAt: '2026-10-14T10:00:00.000Z', updatedAt: firedAt, firedAt, ...extra,
  });

  // 1) Legacy records (no owner fields) keep the original behaviour.
  const legacy = [running('past'), running('future', { dueAt: '2026-10-14T13:00:00.000Z' })];
  assert.equal(recoverStrandedMainChatTimers(legacy, bootAt), true);
  assert.equal(legacy[0].status, 'due_waiting');
  assert.equal(legacy[1].status, 'pending');
  assert.equal(legacy[0].firedAt, undefined);
  assert.match(legacy[0].error || '', /Recovered after the process/);

  // Injected identity + liveness for the deterministic cases below.
  const alive = new Set<number>([2222]);
  const probe = { pid: 1000, startedAt: '2026-10-14T11:59:00.000Z', isPidAlive: (pid: number) => alive.has(pid), nowMs: bootAt + 60_000 };

  // 2) Warm handoff: the gateway that fired it is alive elsewhere. Must not be recovered.
  const liveElsewhere = [running('live', { ownerPid: 2222, ownerStartedAt: '2026-10-14T09:00:00.000Z' })];
  assert.equal(recoverStrandedMainChatTimers(liveElsewhere, bootAt, probe), false);
  assert.equal(liveElsewhere[0].status, 'running');
  assert.equal(liveElsewhere[0].firedAt, firedAt);
  assert.equal(liveElsewhere[0].ownerPid, 2222);
  assert.equal(liveElsewhere[0].error, undefined);

  // 3) Owner process is gone: recovered, owner cleared, schedule semantics kept.
  const deadOwner = [
    running('dead-due', { ownerPid: 3333, ownerStartedAt: '2026-10-14T09:00:00.000Z' }),
    running('dead-future', { ownerPid: 3333, ownerStartedAt: '2026-10-14T09:00:00.000Z', dueAt: '2026-10-14T13:00:00.000Z' }),
  ];
  assert.equal(recoverStrandedMainChatTimers(deadOwner, bootAt, probe), true);
  assert.equal(deadOwner[0].status, 'due_waiting');
  assert.equal(deadOwner[1].status, 'pending');
  assert.equal(deadOwner[0].ownerPid, undefined);
  assert.equal(deadOwner[0].ownerStartedAt, undefined);
  assert.equal(deadOwner[0].firedAt, undefined);

  // 4) Pid reuse by this process: same pid, different start time. Recovered.
  const reusedBySelf = [running('reused', { ownerPid: 1000, ownerStartedAt: '2026-10-13T00:00:00.000Z' })];
  assert.equal(recoverStrandedMainChatTimers(reusedBySelf, bootAt, probe), true);
  assert.equal(reusedBySelf[0].status, 'due_waiting');

  // 5) Exactly this process (a clock set backwards makes firedAt look older than boot). Never recovered.
  const mine = [running('mine', { ownerPid: 1000, ownerStartedAt: probe.startedAt })];
  assert.equal(recoverStrandedMainChatTimers(mine, bootAt, probe), false);
  assert.equal(mine[0].status, 'running');

  // 5b) This pid but no recorded start time (partial record): unproven, so it is
  //     kept only inside the age cap and recovered past it.
  const noStart = [running('no-start', { ownerPid: 1000 })];
  assert.equal(recoverStrandedMainChatTimers(noStart, bootAt, probe), false);
  assert.equal(noStart[0].status, 'running');
  const noStartPastCap = [running('no-start-past-cap', { ownerPid: 1000 })];
  const capEnd = Date.parse(firedAt) + OWNED_RUNNING_TIMER_MAX_MS;
  assert.equal(recoverStrandedMainChatTimers(noStartPastCap, capEnd + 2, { ...probe, nowMs: capEnd + 1 }), true);
  assert.equal(noStartPastCap[0].status, 'due_waiting');
  // The exact-owner exemption is not capped.
  const minePastCap = [running('mine-past-cap', { ownerPid: 1000, ownerStartedAt: probe.startedAt })];
  assert.equal(recoverStrandedMainChatTimers(minePastCap, capEnd + 2, { ...probe, nowMs: capEnd + 1 }), false);

  // 6) Age backstop for a pid reused by an unrelated live process.
  const firedMs = Date.parse(firedAt);
  const atCap = [running('at-cap', { ownerPid: 2222 })];
  assert.equal(recoverStrandedMainChatTimers(atCap, firedMs + OWNED_RUNNING_TIMER_MAX_MS + 1, { ...probe, nowMs: firedMs + OWNED_RUNNING_TIMER_MAX_MS }), false);
  const pastCap = [running('past-cap', { ownerPid: 2222 })];
  assert.equal(recoverStrandedMainChatTimers(pastCap, firedMs + OWNED_RUNNING_TIMER_MAX_MS + 2, { ...probe, nowMs: firedMs + OWNED_RUNNING_TIMER_MAX_MS + 1 }), true);
  assert.equal(pastCap[0].status, 'due_waiting');

  // 7) Store level, real files and a real second process.
  const timersFile = path.join(getConfig().getConfigDir(), 'timers', 'timers.json');
  assert.ok(timersFile.startsWith(tempRoot), `timer store must live in the temp data dir, got ${timersFile}`);
  const sessionId = 'sess_timer_owner_regression';
  const find = (id: string) => store.listMainChatTimers({ sessionId, includeDone: true }).find((timer) => timer.id === id);
  const rewriteOnDisk = (id: string, patch: (raw: any) => void) => {
    const data = JSON.parse(fs.readFileSync(timersFile, 'utf8'));
    patch(data.timers.find((timer: any) => timer.id === id));
    fs.writeFileSync(timersFile, JSON.stringify(data, null, 2));
  };

  // 7a) Claiming stamps this process as owner and persists it.
  const created = store.createMainChatTimer({ sessionId, instruction: 'do the thing', dueAt: new Date(Date.now() - 1000) });
  assert.ok(store.getDueMainChatTimers().some((timer) => timer.id === created.id));
  const claimed = store.claimMainChatTimerForRun(created.id);
  assert.equal(claimed?.status, 'running');
  assert.equal(claimed?.ownerPid, process.pid);
  assert.ok(Number.isFinite(Date.parse(String(claimed?.ownerStartedAt))), 'ownerStartedAt is an ISO time');
  const raw = JSON.parse(fs.readFileSync(timersFile, 'utf8')).timers.find((timer: any) => timer.id === created.id);
  assert.equal(raw.ownerPid, process.pid);
  assert.equal(raw.ownerStartedAt, claimed?.ownerStartedAt);
  assert.equal(find(created.id)?.ownerPid, process.pid, 'owner survives a store reload');
  assert.equal(find(created.id)?.status, 'running');

  // 7b) A second claim, and a claim on a cancelled timer, both return null.
  assert.equal(store.claimMainChatTimerForRun(created.id), null);
  const cancelled = store.createMainChatTimer({ sessionId, instruction: 'never run', dueAt: new Date(Date.now() - 1000) });
  store.cancelMainChatTimer(cancelled.id);
  assert.equal(store.claimMainChatTimerForRun(cancelled.id), null);
  assert.equal(find(cancelled.id)?.status, 'cancelled');
  assert.equal(store.claimMainChatTimerForRun('timer_missing'), null);

  // 7c) The incident: fired before this process started by another process that is still alive.
  let spawnError: Error | null = null;
  child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  child.once('error', (err) => { spawnError = err; });
  await waitUntil(() => {
    if (spawnError) throw spawnError;
    return Number(child?.pid) > 0 && isAlive(Number(child?.pid));
  }, 10_000, 'the stand-in gateway process to start');
  const otherPid = Number(child.pid);
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  rewriteOnDisk(created.id, (timer) => {
    timer.firedAt = anHourAgo;
    timer.updatedAt = anHourAgo;
    timer.ownerPid = otherPid;
    timer.ownerStartedAt = anHourAgo;
  });
  assert.equal(find(created.id)?.status, 'running', 'a timer running on a live draining gateway is not recovered');
  assert.equal(find(created.id)?.ownerPid, otherPid);
  assert.equal(store.getDueMainChatTimers().some((timer) => timer.id === created.id), false, 'and it is not offered to the runner again');

  // 7d) That process dies: the next store read recovers the timer.
  let childExited = false;
  child.once('exit', () => { childExited = true; });
  child.kill();
  await waitUntil(() => childExited && !isAlive(otherPid), 10_000, 'the stand-in gateway process to exit');
  const recovered = find(created.id);
  assert.equal(recovered?.status, 'due_waiting');
  assert.equal(recovered?.ownerPid, undefined);
  assert.match(recovered?.error || '', /Recovered after the process/);
  assert.ok(store.getDueMainChatTimers().some((timer) => timer.id === created.id), 'a recovered timer is due again');

  // 7e) A legacy on-disk record (older build, no owner) is still recovered on load.
  const reclaimed = store.claimMainChatTimerForRun(created.id);
  assert.equal(reclaimed?.status, 'running');
  rewriteOnDisk(created.id, (timer) => {
    timer.firedAt = anHourAgo;
    timer.updatedAt = anHourAgo;
    delete timer.ownerPid;
    delete timer.ownerStartedAt;
  });
  assert.equal(find(created.id)?.status, 'due_waiting');

  console.log('timer-stranded regression: ok (legacy, live owner, dead owner, pid reuse, age cap, claim, real process handoff)');
}

main()
  .then(() => 0, (err) => { console.error(err); return 1; })
  .then((code) => {
    try { child?.kill(); } catch { /* already gone */ }
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(code);
  });
