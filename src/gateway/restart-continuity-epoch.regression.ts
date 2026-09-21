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

  // Phase 1 deliberately stops at the shutdown boundary. The 'chat_checkpointed'
  // mark is NOT written here: phase 2 produces it by running the real
  // `recoverInterruptedRuntimes()`, so the test exercises the true production
  // startup sequence rather than a hand-made approximation of its output.
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
  assert.ok(
    runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId),
    'precondition: the previous gateway must have left the interrupted runtime on disk',
  );

  // ---- Real startup sequence, in production order ----------------------------
  // core/startup.ts runs compaction, then runtime recovery, then (much later) BOOT.

  // 1. Startup ledger compaction.
  const compaction = runtimes.compactRuntimeStateOnStartup();
  assert.ok(
    runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId),
    'startup ledger compaction must not delete a runtime interrupted by a planned restart '
    + `(removed=${compaction.ledgerRemoved}, kept=${compaction.ledgerKept})`,
  );

  // 2. The REAL startup runtime recovery. This is what stamps 'chat_checkpointed'
  //    on a planned-restart turn while deliberately NOT resuming it, because BOOT
  //    owns planned boundaries. Running the real function (rather than writing its
  //    mark by hand) is the point: it is the true producer of the state BOOT sees.
  const recovered = recovery.recoverInterruptedRuntimes({
    deferMainChatRetrigger: true,
    retriggerInterruptedMainChat: () => {
      throw new Error(
        'startup runtime recovery must NOT resume a planned-restart turn; BOOT owns that boundary',
      );
    },
  });
  assert.ok(
    recovered.inspected > 0,
    'precondition: startup recovery must inspect the interrupted runtime from the previous pid',
  );

  const survivor = runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId);
  assert.ok(
    survivor,
    'REGRESSION: the runtime interrupted by a planned restart was DELETED during startup, '
    + 'before BOOT ever ran. A checkpoint mark means the turn is WAITING for BOOT to resume '
    + 'it, not that it was already handled.',
  );
  assert.equal(
    survivor?.recoveryData?.recovery,
    'chat_checkpointed',
    'real startup recovery must leave the planned-restart turn checkpointed for BOOT',
  );
  assert.ok(
    !recovered.deferredMainChatRuntimes.some((runtime) => runtime.id === runtimeId),
    'a planned-restart turn must not also enter the deferred crash-recovery queue',
  );

  // 3. A second compaction pass, because a planned checkpoint must survive being
  //    re-compacted while it is still waiting for BOOT.
  runtimes.compactRuntimeStateOnStartup();
  assert.ok(
    runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId),
    'REGRESSION: a planned-restart checkpoint was deleted by ledger compaction while it was '
    + 'still waiting for BOOT to resume it.',
  );

  // 4. BOOT builds its hot-restart targets.
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

  // 5. BOOT must be able to actually resume it, exactly once.
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

  // 6. Resumption is not repeatable. A second recovery pass must not admit a
  //    duplicate turn for the same restart.
  const secondPass = recovery.resumePlannedRestartMainChats(target!.runtimeIds, () => {
    throw new Error('a resumed planned-restart turn must never be admitted twice');
  });
  assert.deepEqual(secondPass, [], 'a consumed planned-restart checkpoint must not resume again');

  // 7. Once consumed, the checkpoint stops being protected and becomes prunable,
  //    so the retention exception cannot leak ledger entries forever.
  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot(
      runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId),
    ),
    false,
    'REGRESSION: a resumed planned-restart record is still treated as awaiting BOOT, so '
    + 'retention would protect it forever.',
  );
}

/**
 * A plain "restart the gateway" request is answered deterministically by BOOT and
 * deliberately NOT replayed. That outcome must still consume its checkpoint,
 * otherwise the retention exception pins the record in the ledger permanently.
 */
async function assertAcknowledgementConsumesCheckpoint(runtimeId: string): Promise<void> {
  const runtimes = await import('./live-runtime-registry');
  const recovery = await import('./runtime-recovery');

  runtimes.compactRuntimeStateOnStartup();
  recovery.recoverInterruptedRuntimes({
    deferMainChatRetrigger: true,
    retriggerInterruptedMainChat: () => {
      throw new Error('startup recovery must not resume a planned-restart turn');
    },
  });

  const checkpointed = runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId);
  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot(checkpointed),
    true,
    'precondition: the planned checkpoint is protected while it waits for BOOT',
  );

  // BOOT's acknowledgement-only branch.
  const acknowledged = recovery.acknowledgePlannedRestartMainChats([runtimeId]);
  assert.deepEqual(acknowledged, [runtimeId], 'the acknowledged checkpoint must be consumed');

  const after = runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId);
  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot(after),
    false,
    'REGRESSION: an acknowledgement-only restart left the checkpoint marked "awaiting BOOT". '
    + 'Retention protects that state, so the record would never be pruned.',
  );

  runtimes.compactRuntimeStateOnStartup();
  runtimes.pruneDurableLedger();
  assert.ok(
    !runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId),
    'REGRESSION: a consumed acknowledgement checkpoint survived both compaction and pruning, '
    + 'leaking a durable ledger entry.',
  );
}

/**
 * The retention exception must be bounded. A checkpoint whose BOOT pass never came
 * is abandoned, and terminal work is never "pending BOOT" regardless of markers.
 */
async function assertRetentionExceptionIsBounded(): Promise<void> {
  const runtimes = await import('./live-runtime-registry');

  const base = {
    kind: 'main_chat' as const,
    status: 'interrupted' as const,
    sessionId: SESSION_ID,
  };

  const fresh = Date.now();
  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot({
      ...base,
      recoveryData: { recovery: 'chat_checkpointed', restartEpoch: fresh },
    }),
    true,
    'a fresh planned checkpoint must be protected',
  );

  const stale = fresh - runtimes.PLANNED_RESTART_BOOT_HANDOFF_WINDOW_MS - 60_000;
  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot({
      ...base,
      recoveryData: { recovery: 'chat_checkpointed', restartEpoch: stale },
    }),
    false,
    'REGRESSION: an abandoned planned checkpoint is protected forever. BOOT runs within '
    + 'seconds of startup, so a checkpoint older than the handoff window is never coming back '
    + 'and must not pin a ledger entry.',
  );

  assert.equal(
    runtimes.isPlannedRestartCheckpointAwaitingBoot({
      ...base,
      completedAt: fresh,
      checkpoint: { event: 'done' } as any,
      recoveryData: { recovery: 'chat_checkpointed', restartEpoch: fresh },
    }),
    false,
    'REGRESSION: terminal work is protected as "awaiting BOOT" because it still carries a '
    + 'checkpoint marker. Retention must check terminal state first.',
  );
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
  if (phase === 'acknowledge') {
    await assertAcknowledgementConsumesCheckpoint(
      String(process.env.PROM_RESTART_EPOCH_RUNTIME_ID || ''),
    );
    return;
  }
  if (phase === 'bounds') {
    await assertRetentionExceptionIsBounded();
    return;
  }

  // Each scenario gets its own data dir so phase 1 state is never shared.
  const execArgs = process.execArgv.slice();
  // Re-use the parent's loader flags (tsx) so the child can execute TypeScript.
  if (!execArgs.some((arg) => /tsx|ts-node|--loader|--import|--require/.test(arg))) {
    execArgs.push('--import', 'tsx');
  }
  const self = __filename;

  const runPhase = (root: string, phaseName: string, runtimeId?: string) => spawnSync(
    process.execPath,
    [...execArgs, self],
    {
      env: {
        ...process.env,
        PROMETHEUS_DATA_DIR: root,
        PROMETHEUS_WORKSPACE_DIR: root,
        PROM_RESTART_EPOCH_PHASE: phaseName,
        ...(runtimeId ? { PROM_RESTART_EPOCH_RUNTIME_ID: runtimeId } : {}),
      },
      encoding: 'utf-8',
    },
  );

  /** Process A persists the interrupted turn; a FRESH process B replaces it. */
  const runTwoProcessScenario = (label: string, replacementPhase: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-continuity-epoch-'));
    try {
      const write = runPhase(root, 'write');
      assert.equal(write.status, 0, `${label}: phase 1 (write) failed:\n${write.stderr}`);
      const runtimeId = String(
        JSON.parse(String(write.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}').runtimeId || '',
      );
      assert.ok(runtimeId, `${label}: phase 1 must report the interrupted runtime id`);

      const verify = runPhase(root, replacementPhase, runtimeId);
      assert.equal(
        verify.status,
        0,
        `${label}: replacement gateway failed:\n${verify.stdout}\n${verify.stderr}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  // Scenario 1: a planned mid-turn restart must be found and resumed by BOOT.
  runTwoProcessScenario('resume', 'assert');
  // Scenario 2: an acknowledgement-only restart must consume its checkpoint.
  runTwoProcessScenario('acknowledge', 'acknowledge');

  // Scenario 3: the retention exception itself must stay bounded.
  const boundsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-restart-continuity-bounds-'));
  try {
    const bounds = runPhase(boundsRoot, 'bounds');
    assert.equal(bounds.status, 0, `bounds: failed:\n${bounds.stdout}\n${bounds.stderr}`);
  } finally {
    fs.rmSync(boundsRoot, { recursive: true, force: true });
  }

  console.log('restart-continuity-epoch regression: OK');
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
