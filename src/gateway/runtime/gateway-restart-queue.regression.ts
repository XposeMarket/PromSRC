import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setGatewayRestartQueueStateDir,
  queueGatewayRestart,
  readPendingGatewayRestart,
  isGatewayRestartDrainActive,
  isPendingRestartOwnedByThisProcess,
  clearPendingGatewayRestart,
  evaluateQueuedRestart,
  queuedRestartMessage,
  describePendingGatewayRestart,
  scheduleQueuedRestartContinuations,
  startGatewayRestartQueueRunner,
  toQueuedRestartContext,
} from './gateway-restart-queue';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-queue-'));
setGatewayRestartQueueStateDir(() => dir);
const file = path.join(dir, 'pending-gateway-restart.json');
const baseCtx = { reason: 'manual' as const, timestamp: Date.now(), summary: 'Deploy A', quickRestart: true, previousSessionId: 'chat_a' };
const running = (sessionId: string, label = 'Team dispatch - Ledger') => ({ sessionId, label, status: 'running' });

// 1. Nothing queued: no drain, status says so.
assert.equal(readPendingGatewayRestart(), null);
assert.equal(isGatewayRestartDrainActive(), false);
assert.match(describePendingGatewayRestart([]), /No gateway restart is queued/);

// 2. Queue: persisted, drain active, turn-scoped fields stripped.
const first = queueGatewayRestart({
  ctx: { ...baseCtx, taskId: 'task_1', taskInitiatedTool: 'gateway_restart' } as any,
  requester: { sessionId: 'chat_a', reason: 'Deploy A', continuation: 'verify HEAD', requestedAt: 1 },
});
assert.equal(first.merged, false);
assert.ok(fs.existsSync(file));
assert.equal(isGatewayRestartDrainActive(), true);
assert.equal((first.pending.ctx as any).taskId, undefined);
assert.equal(first.pending.ctx.suppressStandaloneRestartMessage, true);
assert.match(queuedRestartMessage(first.pending, [running('team_x')], false), /Restart queued .*Do NOT set timers/);

// 3. Second request merges (one pending restart), widens scope, dedupes requester.
const second = queueGatewayRestart({
  ctx: { ...baseCtx, summary: 'Deploy B', quickRestart: false, restartScope: 'supervisor', affectedFiles: ['src/cli/index.ts'] } as any,
  requester: { sessionId: 'chat_b', reason: 'Deploy B', requestedAt: 2 },
});
assert.equal(second.merged, true);
assert.equal(second.pending.id, first.pending.id);
assert.deepEqual(second.pending.requesters.map((r) => r.sessionId), ['chat_a', 'chat_b']);
assert.equal(second.pending.ctx.restartScope, 'supervisor');
assert.equal(second.pending.ctx.quickRestart, false);
assert.match(String(second.pending.ctx.summary), /Deploy A \+ Deploy B/);
const again = queueGatewayRestart({ ctx: baseCtx as any, requester: { sessionId: 'chat_a', reason: 'retry', requestedAt: 3 } });
assert.equal(again.pending.requesters.length, 2);
assert.equal(again.pending.requesters.find((r) => r.sessionId === 'chat_a')?.continuation, 'verify HEAD', 'continuation survives re-request');
assert.equal(again.pending.ctx.summary, 'Deploy A + Deploy B', 'merged summary is deduped');

// 4. Quiet-window decision: busy resets, quiet must hold for quietMs.
assert.deepEqual(evaluateQueuedRestart({ runtimes: [running('x')], quietSince: 5, now: 100, quietMs: 10 }).fire, false);
assert.equal(evaluateQueuedRestart({ runtimes: [running('x')], quietSince: 5, now: 100, quietMs: 10 }).quietSince, null);
const startQuiet = evaluateQueuedRestart({ runtimes: [{ ...running('x'), status: 'completed' }], quietSince: null, now: 100, quietMs: 10 });
assert.deepEqual([startQuiet.fire, startQuiet.quietSince], [false, 100]);
assert.equal(evaluateQueuedRestart({ runtimes: [], quietSince: 100, now: 110, quietMs: 10 }).fire, true);
assert.equal(evaluateQueuedRestart({ runtimes: [{ ...running('x'), abortRequestedAt: 1 }], quietSince: 100, now: 111, quietMs: 10 }).fire, true);

// 5. A record from a previous process is stale (not draining) and wakes its requesters once on boot.
const stale = { ...readPendingGatewayRestart()!, gatewayPid: process.pid + 1 };
assert.equal(isPendingRestartOwnedByThisProcess(stale), false);
fs.writeFileSync(file, JSON.stringify(stale));
setGatewayRestartQueueStateDir(() => dir);
assert.equal(isGatewayRestartDrainActive(), false);
const timers: any[] = [];
const created = scheduleQueuedRestartContinuations(null, (t) => timers.push(t), 1_000_000);
assert.equal(created, 2);
const wakeA = timers.find((t) => t.sessionId === 'chat_a');
const wakeB = timers.find((t) => t.sessionId === 'chat_b');
assert.match(wakeA.instruction, /restarted before your queued restart fired/);
assert.match(wakeA.instruction, /Continue with: verify HEAD/);
assert.match(wakeB.instruction, /Verify the gateway is healthy/);
assert.ok(!fs.existsSync(file), 'stale record cleared');

// 6. A queued restart that ran: requesters woken, no duplicates when a stale file also lists them.
timers.length = 0;
scheduleQueuedRestartContinuations(
  { ...baseCtx, timestamp: 600_000, queuedRestart: { id: 'q1', requestedAt: 0, requesters: [{ sessionId: 'chat_a', reason: 'r', requestedAt: 0, continuation: 'report to Raul' }] } } as any,
  (t) => timers.push(t),
  700_000,
);
assert.equal(timers.length, 1);
assert.match(timers[0].instruction, /queued has now run .*about 10 min/);
assert.match(timers[0].instruction, /Do not call gateway_restart again/);

// 7. Cancel clears the drain.
queueGatewayRestart({ ctx: baseCtx as any, requester: { sessionId: 'chat_c', reason: 'c', requestedAt: 4 } });
assert.equal(isGatewayRestartDrainActive(), true);
assert.ok(clearPendingGatewayRestart());
assert.equal(isGatewayRestartDrainActive(), false);
assert.equal(toQueuedRestartContext({ ...baseCtx, forwardedToPid: 9 } as any).forwardedToPid, undefined);

// 8. Runner: waits while busy, fires once quiet, passes requesters, re-queues on failure.
async function runnerScenario(): Promise<void> {
  queueGatewayRestart({ ctx: baseCtx as any, requester: { sessionId: 'chat_r', reason: 'r', requestedAt: 5 } });
  let busy = true;
  const calls: any[] = [];
  let failNext = true;
  const runner = startGatewayRestartQueueRunner({
    listRuntimes: () => (busy ? [running('team_y')] : []),
    restart: async (ctx) => { calls.push(ctx); if (failNext) { failNext = false; throw new Error('boom'); } },
    tickMs: 500,
    quietMs: 0,
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const count = (): number => calls.length;
  await sleep(1200);
  assert.equal(count(), 0, 'never fires while busy');
  busy = false;
  await sleep(1200);
  assert.ok(count() >= 1);
  assert.equal(calls[0].queuedRestart.requesters[0].sessionId, 'chat_r');
  if (count() === 1) await sleep(1200);
  assert.equal(count(), 2, 'failed attempt stays queued and retries');
  assert.equal(readPendingGatewayRestart(), null, 'successful fire removes the record');
  runner.stop();
}

runnerScenario().then(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('gateway restart queue regressions passed');
}).catch((error) => { console.error(error); process.exit(1); });
