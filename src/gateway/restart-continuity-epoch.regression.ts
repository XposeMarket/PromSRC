/**
 * Regression: a planned mid-turn gateway restart must still be resumable in the
 * REPLACEMENT gateway process.
 *
 * THE BUG (circular epoch resolution):
 *
 * Gateway startup does two things, in this order:
 *   1. `recoverInterruptedRuntimes()`  (core/startup.ts, early)
 *   2. `runBootMd()` via the gateway:startup hook  (core/startup.ts, much later)
 *
 * Step 1 walks every interrupted runtime. For a PLANNED restart boundary it
 * deliberately does not retrigger the turn (BOOT owns that), but it still calls
 * `markDurableRuntimeRecovered(..., { recovery: 'chat_checkpointed' })`.
 *
 * Step 2 then asks `listHotRestartMainChatRecoveries()` for its targets. That
 * needs the restart epoch. In a freshly-launched process the in-memory
 * `_restartInterruptEpoch` is 0, so `resolveActiveRestartEpoch()` must derive it
 * from the durable ledger - but it SKIPS every record that already carries
 * `recoveryData.recovery`:
 *
 *     if (rd.recoveredAt || rd.recovery) continue;
 *
 * Step 1 just set `recovery` on exactly those records. The scan finds nothing,
 * returns 0, and `isMainChatHotRestartRecoveryCandidate()` bails on
 * `if (sinceEpoch <= 0) return false`.
 *
 * Net effect: BOOT finds ZERO hot-restart targets. The interrupted turn is never
 * resumed. The user sees the gateway drop, come back, and lose the whole turn -
 * no resume, no context, not even the original request.
 *
 * WHY THIS TEST IS TWO PROCESSES: the bug only appears when the in-memory epoch
 * is absent. A single-process test keeps `_restartInterruptEpoch` set from its
 * own shutdown call and passes vacuously. Phase 1 writes the durable ledger and
 * exits; phase 2 re-reads it with a cold module cache, exactly like the real
 * replacement gateway.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SESSION_ID = 'restart_epoch_session';
const ORIGINAL_REQUEST = 'Pull latest and restart, then verify the feature.';

/** Phase 1: the gateway that is about to be replaced. */
async function writeInterruptedRestartState(): Promise<void> {
  const runtimes = await import('./live-runtime-registry');
  const recovery = await import('./runtime-recovery');

  const runtimeId = runtimes.registerLiveRuntime({
    kind: 'main_chat',
    label: 'planned restart continuity',
    sessionId: SESSION_ID,
    recoveryPolicy: 'mark_interrupted',
    recoveryData: { message: ORIGINAL_REQUEST },
  });
  runtimes.updateLiveRuntimeCheckpoint(runtimeId, {
    event: 'tool_call',
    toolName: 'gateway_restart',
    message: 'restarting gateway to load merged changes',
  });

  const interrupted = recovery.prepareActiveRuntimesForGatewayShutdown('gateway_restart');
  assert.equal(interrupted.length, 1, 'the in-flight turn must be marked interrupted at shutdown');
  assert.ok(
    Number(interrupted[0]?.recoveryData?.restartEpoch || 0) > 0,
    'shutdown must stamp a restart epoch for post-restart matching',
  );
  runtimes.finishLiveRuntime(runtimeId);

  // Replacement-gateway step 1 (runtime recovery) stamps this on the record.
  // `recoverInterruptedRuntimes()` itself filters on `pid !== process.pid`, so
  // its exact durable write is reproduced here rather than called.
  runtimes.markDurableRuntimeRecovered(runtimeId, 'interrupted', {
    recovery: 'chat_checkpointed',
    sessionId: SESSION_ID,
  });

  process.stdout.write(`${JSON.stringify({ runtimeId })}\n`);
}

/** Phase 2: the replacement gateway, cold module cache, epoch not in memory. */
async function assertBootCanStillResume(runtimeId: string): Promise<void> {
  const runtimes = await import('./live-runtime-registry');
  const recovery = await import('./runtime-recovery');

  assert.equal(
    runtimes.getRestartInterruptEpoch(),
    0,
    'a freshly-launched gateway must not have an in-memory restart epoch',
  );

  // Precondition: the interrupted record is on disk before startup touches it.
  const beforeCompaction = runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId);
  assert.ok(
    beforeCompaction,
    'precondition: the previous gateway must have left the interrupted runtime on disk',
  );

  // Startup compaction runs first and must keep the record.
  const compaction = runtimes.compactRuntimeStateOnStartup();
  const survivor = runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId);
  assert.ok(
    survivor,
    'REGRESSION: startup ledger compaction DELETED the runtime interrupted by a planned '
    + 'restart, before BOOT ever ran. isRuntimeRecoverableAfterRestart() rejects any record '
    + "carrying recoveryData.recovery, and startup runtime-recovery had just stamped "
    + "'chat_checkpointed' on it. A checkpoint mark means the turn is WAITING for BOOT to "
    + 'resume it, not that it was already handled. '
    + `(removed=${compaction.ledgerRemoved}, kept=${compaction.ledgerKept})`,
  );
  assert.equal(
    survivor?.recoveryData?.recovery,
    'chat_checkpointed',
    'precondition: the record carries the mark left by startup runtime recovery',
  );

  // BOOT builds its hot-restart targets.
  const recoveries = recovery.listHotRestartMainChatRecoveries(30 * 60_000, 0);
  const target = recoveries.find((entry) => entry.sessionId === SESSION_ID);

  assert.ok(
    target,
    'REGRESSION: after runtime recovery marked the planned-restart runtime '
    + "'chat_checkpointed', BOOT found NO hot-restart recovery for it. "
    + 'resolveActiveRestartEpoch() skips every already-recovered record, so it '
    + 'resolves to 0 and isMainChatHotRestartRecoveryCandidate() rejects on '
    + '`sinceEpoch <= 0`. The interrupted turn is silently dropped: no resume, '
    + 'no context, not even the original user request.',
  );
  assert.equal(
    target?.plannedRestartTool,
    'gateway_restart',
    'the recovery must be classified as a planned restart boundary, not an unexplained crash',
  );
  assert.ok(
    target?.runtimeIds.includes(runtimeId),
    'the recovery must carry the runtime id BOOT needs to resume the foreground turn',
  );

  // The resumed turn must still have real context to work from.
  assert.equal(
    String(survivor?.recoveryData?.message || ''),
    ORIGINAL_REQUEST,
    'the original user request must survive so the resumed turn is not contextless',
  );
  assert.equal(
    survivor?.checkpoint?.toolName,
    'gateway_restart',
    'the restart-causing tool must survive so BOOT can classify a planned boundary',
  );

  // And BOOT must be able to actually resume it, exactly once.
  const resumedIds: string[] = [];
  const resumed = recovery.resumePlannedRestartMainChats(target!.runtimeIds, (runtime) => {
    resumedIds.push(runtime.id);
    return true;
  });
  assert.deepEqual(
    resumed,
    [SESSION_ID],
    'REGRESSION: BOOT could not resume the planned-restart foreground turn',
  );
  assert.deepEqual(resumedIds, [runtimeId], 'exactly one replacement foreground turn must start');
}

async function main(): Promise<void> {
  const phase = process.env.PROM_RESTART_EPOCH_PHASE;

  if (phase === 'write') {
    await writeInterruptedRestartState();
    return;
  }
  if (phase === 'assert') {
    await assertBootCanStillResume(String(process.env.PROM_RESTART_EPOCH_RUNTIME_ID || ''));
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-continuity-epoch-'));
  try {
    const env = {
      ...process.env,
      PROMETHEUS_DATA_DIR: root,
      PROMETHEUS_WORKSPACE_DIR: root,
    };
    const self = __filename;
    // Re-use the parent's loader flags (tsx) so the child can execute TypeScript.
    const execArgs = process.execArgv.slice();
    if (!execArgs.some((arg) => /tsx|ts-node|--loader|--import|--require/.test(arg))) {
      execArgs.push('--import', 'tsx');
    }

    const write = spawnSync(process.execPath, [...execArgs, self], {
      env: { ...env, PROM_RESTART_EPOCH_PHASE: 'write' },
      encoding: 'utf-8',
    });
    assert.equal(write.status, 0, `phase 1 (write) failed:\n${write.stderr}`);
    const runtimeId = String(
      JSON.parse(String(write.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}').runtimeId || '',
    );
    assert.ok(runtimeId, 'phase 1 must report the interrupted runtime id');

    const verify = spawnSync(process.execPath, [...execArgs, self], {
      env: {
        ...env,
        PROM_RESTART_EPOCH_PHASE: 'assert',
        PROM_RESTART_EPOCH_RUNTIME_ID: runtimeId,
      },
      encoding: 'utf-8',
    });
    assert.equal(
      verify.status,
      0,
      `phase 2 (replacement gateway) failed:\n${verify.stdout}\n${verify.stderr}`,
    );

    console.log('restart-continuity-epoch regression: OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
