import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-brain-progress-'));
  const workspace = path.join(root, 'workspace');
  const previousDataDir = process.env.PROMETHEUS_DATA_DIR;
  const previousWorkspaceDir = process.env.PROMETHEUS_WORKSPACE_DIR;
  const previousLeaseThrottle = process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_WRITE_THROTTLE_MS;
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = workspace;
  process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_WRITE_THROTTLE_MS = '0';

  try {
    const runtimeApi = await import('../live-runtime-registry');
    const leaseApi = await import('../gateway-progress-lease');
    const configApi = await import('../../config/config');
    const { checkpointBrainRuntime } = await import('./brain-runner');

    const runtimeId = runtimeApi.registerLiveRuntime({
      kind: 'brain_thought',
      label: 'Brain progress checkpoint regression',
      sessionId: 'brain_progress_regression',
      recoveryPolicy: 'rerun',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    const leasePath = path.join(configApi.getConfig().getConfigDir(), 'gateway-progress-lease.json');
    const before = leaseApi.readGatewayProgressLease(leasePath);
    assert.ok(before, `progress lease was not persisted at ${leasePath}; snapshot=${JSON.stringify(leaseApi.getRuntimeProgressLeaseSnapshot())}`);
    assert.equal(before?.runtimeId, runtimeId);
    assert.equal(before?.phase, 'registered');

    checkpointBrainRuntime(runtimeId, 'thinking', {
      phase: 'model_stream',
      action: 'workspace_read',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await runtimeApi.flushLiveRuntimePersistence();

    const after = leaseApi.readGatewayProgressLease(leasePath);
    assert.equal(after?.runtimeId, runtimeId);
    assert.equal(after?.phase, 'model_stream');
    assert.equal(after?.activeToolName, undefined);
    assert.ok(Number(after?.lastProgressAt) > Number(before?.lastProgressAt));
    assert.ok(Number(after?.expiresAt) > Number(after?.lastProgressAt));

    const ledgerPath = path.join(root, '.prometheus', 'runtimes', 'active-runtimes.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.runtimes[runtimeId]?.checkpoint?.event, 'thinking');
    assert.equal(ledger.runtimes[runtimeId]?.checkpoint?.phase, 'model_stream');

    runtimeApi.finishLiveRuntime(runtimeId);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    await runtimeApi.flushLiveRuntimePersistence();
    assert.equal(leaseApi.readGatewayProgressLease(leasePath)?.state, 'idle');
    console.log('brain runner progress regression passed');
  } finally {
    if (previousDataDir === undefined) delete process.env.PROMETHEUS_DATA_DIR;
    else process.env.PROMETHEUS_DATA_DIR = previousDataDir;
    if (previousWorkspaceDir === undefined) delete process.env.PROMETHEUS_WORKSPACE_DIR;
    else process.env.PROMETHEUS_WORKSPACE_DIR = previousWorkspaceDir;
    if (previousLeaseThrottle === undefined) delete process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_WRITE_THROTTLE_MS;
    else process.env.PROMETHEUS_GATEWAY_PROGRESS_LEASE_WRITE_THROTTLE_MS = previousLeaseThrottle;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
