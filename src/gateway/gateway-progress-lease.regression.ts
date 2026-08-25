import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RuntimeProgressLeaseStore,
  isGatewayProgressLeaseFresh,
  isMeaningfulRuntimeProgressEvent,
  readGatewayProgressLease,
} from './gateway-progress-lease';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-progress-lease-'));
  const filePath = path.join(root, 'gateway-progress-lease.json');
  let now = 1_000;
  const store = new RuntimeProgressLeaseStore({
    filePath,
    pid: 4242,
    processStartedAt: 500,
    ttlMs: 10_000,
    writeThrottleMs: 0,
    now: () => now,
  });

  try {
    const previousProcessStartedAt = process.env.PROMETHEUS_GATEWAY_PROCESS_STARTED_AT;
    process.env.PROMETHEUS_GATEWAY_PROCESS_STARTED_AT = '777';
    try {
      const configuredStore = new RuntimeProgressLeaseStore({
        filePath: path.join(root, 'configured-process.json'),
        pid: 4243,
        now: () => now,
      });
      assert.equal(configuredStore.snapshot().processStartedAt, 777, 'lease identity must use the gateway generation');
    } finally {
      if (previousProcessStartedAt === undefined) delete process.env.PROMETHEUS_GATEWAY_PROCESS_STARTED_AT;
      else process.env.PROMETHEUS_GATEWAY_PROCESS_STARTED_AT = previousProcessStartedAt;
    }

    const originalRename = fs.promises.rename;
    let renameAttempts = 0;
    (fs.promises as any).rename = async (from: string, to: string) => {
      renameAttempts += 1;
      if (renameAttempts < 3) {
        const error: any = new Error('simulated Windows file lock');
        error.code = 'EPERM';
        throw error;
      }
      return originalRename(from, to);
    };
    try {
      const retryStore = new RuntimeProgressLeaseStore({
        filePath: path.join(root, 'rename-retry.json'),
        pid: 4244,
        processStartedAt: 600,
        ttlMs: 10_000,
        writeThrottleMs: 0,
        now: () => now,
      });
      retryStore.register({ runtimeId: 'rename-retry', kind: 'main_chat' });
      await retryStore.flush();
      assert.equal(renameAttempts, 3, 'transient Windows rename locks must be retried');
      assert.equal(readGatewayProgressLease(path.join(root, 'rename-retry.json'))?.runtimeId, 'rename-retry');
    } finally {
      (fs.promises as any).rename = originalRename;
    }

    const first = store.register({
      runtimeId: 'runtime-a',
      kind: 'main_chat',
      sessionId: 'session-a',
      startedAt: 900,
    });
    assert.ok(first?.leaseId);
    await store.flush();

    let persisted = readGatewayProgressLease(filePath);
    assert.equal(persisted?.pid, 4242);
    assert.equal(persisted?.runtimeId, 'runtime-a');
    assert.equal(persisted?.state, 'active');
    assert.equal(persisted?.lastCheckpointAt, 0);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 10_999, expectedPid: 4242 }), true);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 11_000, expectedPid: 4242 }), false);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 2_000, expectedPid: 9999 }), false);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 2_000, expectedPid: 4242, expectedProcessStartedAt: 500 }), true);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 2_000, expectedPid: 4242, expectedProcessStartedAt: 501 }), false);
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now: 2_001, expectedPid: 4242, maxProgressAgeMs: 500 }), false);

    const beforeHeartbeat = store.snapshot();
    now = 2_000;
    store.renew('runtime-a', { event: 'heartbeat', checkpoint: true, at: now });
    const afterHeartbeat = store.snapshot();
    assert.equal(afterHeartbeat.progressSeq, beforeHeartbeat.progressSeq, 'timer heartbeat must not renew progress');
    assert.equal(afterHeartbeat.lastProgressAt, beforeHeartbeat.lastProgressAt, 'timer heartbeat must not extend the lease');

    store.renew('runtime-a', { event: 'token', phase: 'model_stream', at: now });
    now = 2_500;
    store.renew('runtime-a', {
      event: 'tool_call',
      activeToolName: 'connector_list',
      checkpoint: true,
      at: now,
    });
    await store.flush();
    persisted = readGatewayProgressLease(filePath);
    assert.equal(persisted?.phase, 'tool_running');
    assert.equal(persisted?.activeToolName, 'connector_list');
    assert.equal(persisted?.lastProgressAt, 2_500);
    assert.equal(persisted?.lastCheckpointAt, 2_500);
    assert.equal(persisted?.expiresAt, 12_500);
    assert.equal(persisted?.progressSeq, 3);

    now = 2_750;
    store.renew('runtime-a', { event: 'tool_result', activeToolName: 'connector_list', checkpoint: true, at: now });
    assert.equal(store.snapshot().phase, 'tool_completed');
    assert.equal(store.snapshot().activeToolName, undefined, 'completed tools must not remain marked active');

    now = 3_000;
    store.register({ runtimeId: 'runtime-b', kind: 'background_task' });
    assert.equal(store.snapshot().runtimeId, 'runtime-b', 'the summary should follow the freshest active runtime');
    now = 3_500;
    store.renew('runtime-a', { event: 'tool_progress', activeToolName: 'connector_list', at: now });
    assert.equal(store.snapshot().runtimeId, 'runtime-a');

    store.finish('runtime-a');
    assert.equal(store.snapshot().runtimeId, 'runtime-b', 'finishing one runtime must preserve another active lease');
    store.finish('runtime-b');
    await store.flush();
    persisted = readGatewayProgressLease(filePath);
    assert.equal(persisted?.state, 'idle');
    assert.equal(persisted?.runtimeId, '');
    assert.equal(isGatewayProgressLeaseFresh(persisted, { now, expectedPid: 4242 }), false);

    assert.equal(isMeaningfulRuntimeProgressEvent('heartbeat'), false);
    assert.equal(isMeaningfulRuntimeProgressEvent('keepalive'), false);
    assert.equal(isMeaningfulRuntimeProgressEvent('provider_heartbeat'), true);
    assert.equal(isMeaningfulRuntimeProgressEvent('tool_result'), true);

    now = 4_000;
    const reset = store.resetForProcess();
    assert.equal(reset.state, 'idle');
    assert.equal(reset.runtimeId, '');
    assert.equal(reset.pid, 4242);
    assert.equal(reset.processStartedAt, 500);
    await store.flush();
    persisted = readGatewayProgressLease(filePath);
    assert.equal(persisted?.state, 'idle');
    assert.equal(persisted?.runtimeId, '');
    assert.equal(persisted?.pid, 4242);
    assert.equal(persisted?.updatedAt, 4_000);
    assert.equal(fs.readdirSync(root).some((name) => name.includes('.tmp-')), false, 'atomic temp files must be cleaned up');
    console.log('gateway progress lease regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
