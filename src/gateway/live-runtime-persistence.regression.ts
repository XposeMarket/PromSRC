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
    const watchdogInterrupt = runtimeApi.interruptLiveRuntimeForRecovery(watchdogRuntimeId, 'main_chat_owner_watchdog_timeout');
    assert.equal(watchdogInterrupt.ok, true);
    assert.equal(watchdogInterrupt.runtime?.status, 'interrupted');
    assert.equal(
      runtimeApi.isRuntimeRecoverableAfterRestart(watchdogInterrupt.runtime),
      true,
      'a watchdog interruption must remain eligible for exactly-once restart recovery',
    );
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[watchdogRuntimeId]?.status, 'interrupted');
    assert.equal(runtimeApi.listInterruptedRuntimes().some((runtime) => runtime.id === watchdogRuntimeId), true);
    runtimeApi.markDurableRuntimeRecovered(watchdogRuntimeId, 'interrupted', { recovery: 'regression_cleanup' });
    runtimeApi.pruneDurableLedger();
    await runtimeApi.flushLiveRuntimePersistence();
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[watchdogRuntimeId], undefined, 'recovery acknowledgement must make the watchdog record disposable');

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
