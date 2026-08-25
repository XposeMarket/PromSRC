import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-runtime-persistence-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const runtimeApi = await import('./live-runtime-registry');
    const recoveryApi = await import('./runtime-recovery');
    const ownerPolicy = await import('./chat/main-chat-execution-owner');
    const runtimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'async persistence regression',
      sessionId: 'runtime_persistence_regression',
      recoveryPolicy: 'mark_interrupted',
    });
    const ledgerPath = path.join(root, '.prometheus', 'runtimes', 'active-runtimes.json');
    assert.equal(fs.existsSync(ledgerPath), false, 'runtime registration must not synchronously rewrite the ledger');

    runtimeApi.updateLiveRuntimeCheckpoint(runtimeId, { event: 'working', message: 'checkpoint' });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await runtimeApi.flushLiveRuntimePersistence();

    let ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[runtimeId].sessionId, 'runtime_persistence_regression');
    assert.equal(ledger.runtimes[runtimeId].checkpoint.event, 'working');

    runtimeApi.finishLiveRuntime(runtimeId);
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[runtimeId], undefined, 'terminal runtimes must be removed before graceful drain completes');

    const deferredRuntimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'deferred terminal cleanup regression',
      sessionId: 'runtime_deferred_terminal_cleanup_regression',
      recoveryPolicy: 'mark_interrupted',
      abortSignal: { aborted: false },
      onAbort: () => undefined,
      deferTerminalCleanup: true,
    });
    runtimeApi.updateLiveRuntimeCheckpoint(deferredRuntimeId, { event: 'done', message: 'final frame before request finally' });
    await runtimeApi.flushLiveRuntimePersistence();
    assert.ok(runtimeApi.getLiveRuntime(deferredRuntimeId), 'a main-chat owner must survive terminal checkpoint reads until its request settles');
    const deferredAbort = runtimeApi.abortLiveRuntime(deferredRuntimeId, 'operator_abort', { source: 'mobile_stop_button' });
    assert.equal(deferredAbort.ok, true);
    assert.equal(deferredAbort.runtime?.status, 'running', 'deferred aborts remain owned until the request finalizer runs');
    assert.ok(runtimeApi.getLiveRuntime(deferredRuntimeId), 'aborting a deferred owner must not allow a registry read to prune it');
    runtimeApi.finishLiveRuntime(deferredRuntimeId);
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[deferredRuntimeId], undefined, 'the request finalizer must still remove the settled deferred owner');

    const watchdogRuntimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'semantic watchdog recovery regression',
      sessionId: 'runtime_watchdog_recovery_regression',
      recoveryPolicy: 'mark_interrupted',
      abortSignal: { aborted: false },
      onAbort: () => undefined,
      deferTerminalCleanup: true,
    });
    runtimeApi.updateLiveRuntimeCheckpoint(watchdogRuntimeId, { event: 'working', message: 'stalled before watchdog' });
    const watchdogAbort = runtimeApi.abortLiveRuntime(watchdogRuntimeId, 'semantic_progress_stall', { source: 'main_chat_owner_watchdog' });
    assert.equal(watchdogAbort.ok, true);
    assert.equal(watchdogAbort.runtime?.status, 'running', 'the watchdog must leave the request-owned record visible while abort settles');
    // Exercise the same late request finalizer that runs after the abort hook;
    // it must preserve the recovery record even when the periodic watchdog has
    // not yet performed its fallback interrupt.
    runtimeApi.finishLiveRuntime(watchdogRuntimeId);
    const watchdogInterrupt = runtimeApi.listInterruptedRuntimes().find((runtime) => runtime.id === watchdogRuntimeId);
    assert.ok(watchdogInterrupt, 'watchdog finalization must persist an interrupted recovery record');
    assert.equal(watchdogInterrupt?.status, 'interrupted');
    assert.equal(
      runtimeApi.isRuntimeRecoverableAfterRestart(watchdogInterrupt),
      true,
      'a watchdog interruption must remain eligible for exactly-once restart recovery',
    );
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[watchdogRuntimeId]?.status, 'interrupted');
    runtimeApi.markDurableRuntimeRecovered(watchdogRuntimeId, 'interrupted', { recovery: 'regression_cleanup' });
    runtimeApi.pruneDurableLedger();
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[watchdogRuntimeId], undefined, 'recovery acknowledgement must make the watchdog record disposable');

    const noFinalizerRuntimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'watchdog no-finalizer reconciliation regression',
      sessionId: 'runtime_watchdog_no_finalizer_regression',
      recoveryPolicy: 'mark_interrupted',
      abortSignal: { aborted: false },
      onAbort: () => undefined,
      deferTerminalCleanup: true,
    });
    runtimeApi.updateLiveRuntimeCheckpoint(noFinalizerRuntimeId, { event: 'working', message: 'stream closed after watchdog abort' });
    const noFinalizerAbort = runtimeApi.abortLiveRuntime(noFinalizerRuntimeId, 'semantic_progress_stall', { source: 'main_chat_owner_watchdog' });
    assert.equal(noFinalizerAbort.ok, true);
    const settleNow = Number(noFinalizerAbort.runtime?.abortRequestedAt || Date.now()) + ownerPolicy.MAIN_CHAT_ABORT_SETTLE_GRACE_MS + 1;
    assert.equal(ownerPolicy.resolveMainChatAbortSettlement({
      now: settleNow,
      abortRequestedAt: noFinalizerAbort.runtime?.abortRequestedAt,
      abortSource: noFinalizerAbort.runtime?.abortSource,
    }), 'recover', 'reconciliation must choose recovery after the stream has already closed');
    runtimeApi.interruptLiveRuntimeForRecovery(noFinalizerRuntimeId, 'main_chat_owner_watchdog_timeout');
    assert.equal(runtimeApi.getLiveRuntime(noFinalizerRuntimeId), null, 'watchdog fallback must remove the orphaned live owner without a request finalizer');
    const noFinalizerInterrupted = runtimeApi.listInterruptedRuntimes().find((runtime) => runtime.id === noFinalizerRuntimeId);
    assert.ok(noFinalizerInterrupted, 'watchdog fallback must persist the owner as interrupted/recoverable');
    assert.equal(runtimeApi.isRuntimeRecoverableAfterRestart(noFinalizerInterrupted), true);
    runtimeApi.markDurableRuntimeRecovered(noFinalizerRuntimeId, 'interrupted', { recovery: 'regression_cleanup' });
    runtimeApi.pruneDurableLedger();

    const restartRuntimeId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat_goal',
      label: 'shutdown recovery regression',
      sessionId: 'runtime_shutdown_recovery_regression',
      recoveryPolicy: 'resume',
      abortSignal: { aborted: false },
    });
    runtimeApi.updateLiveRuntimeCheckpoint(restartRuntimeId, { event: 'working', message: 'before shutdown' });
    await runtimeApi.flushLiveRuntimePersistence();
    const interrupted = recoveryApi.prepareActiveRuntimesForGatewayShutdown('signal_sigterm');
    assert.equal(interrupted.some((runtime) => runtime.id === restartRuntimeId), true);
    runtimeApi.finishLiveRuntime(restartRuntimeId);
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(
      ledger.runtimes[restartRuntimeId]?.status,
      'interrupted',
      'a turn unwinding after shutdown must not erase its durable restart checkpoint',
    );

    const eventsPath = path.join(root, '.prometheus', 'runtimes', 'runtime-events.ndjson');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(
      events.filter((event) => event.runtimeId === runtimeId).map((event) => event.type),
      ['registered', 'checkpoint', 'completed'],
    );
    assert.deepEqual(
      events.filter((event) => event.runtimeId === restartRuntimeId).map((event) => event.type),
      ['registered', 'interrupted'],
    );
    const status = runtimeApi.getLiveRuntimePersistenceStatus();
    assert.equal(status.pendingEvents, 0);
    assert.equal(status.ledgerDirty, false);
    assert.equal(status.dropped, 0);
    assert.equal(status.maxPendingEvents, 4096);
    console.log('live runtime persistence regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
