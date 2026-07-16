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

    const eventsPath = path.join(root, '.prometheus', 'runtimes', 'runtime-events.ndjson');
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.type), ['registered', 'checkpoint', 'completed']);
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
