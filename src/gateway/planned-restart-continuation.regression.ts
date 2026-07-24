import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-planned-restart-continuation-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = root;

  try {
    const runtimes = await import('./live-runtime-registry');
    const recovery = await import('./runtime-recovery');
    const runtimeId = runtimes.registerLiveRuntime({
      kind: 'main_chat',
      label: 'planned restart continuation',
      sessionId: 'planned_restart_session',
      recoveryPolicy: 'mark_interrupted',
      recoveryData: { message: 'Finish the original request after applying the dev edit.' },
    });
    runtimes.updateLiveRuntimeCheckpoint(runtimeId, {
      event: 'tool_call',
      toolName: 'prom_apply_dev_changes',
      message: 'verified changes; applying live',
    });
    recovery.prepareActiveRuntimesForGatewayShutdown('prom_apply_dev_changes');
    runtimes.finishLiveRuntime(runtimeId);
    runtimes.markDurableRuntimeRecovered(runtimeId, 'interrupted', { recovery: 'chat_checkpointed' });

    const resumed: string[] = [];
    const first = recovery.resumePlannedRestartMainChats([runtimeId], (runtime) => {
      resumed.push(runtime.id);
      assert.equal(runtime.sessionId, 'planned_restart_session');
      assert.equal(runtime.checkpoint?.toolName, 'prom_apply_dev_changes');
      return true;
    });
    assert.deepEqual(first, ['planned_restart_session']);
    assert.deepEqual(resumed, [runtimeId]);
    assert.equal(
      runtimes.listDurableRuntimes().find((runtime) => runtime.id === runtimeId)?.recoveryData?.recovery,
      'chat_planned_restart_retriggered',
    );
    assert.deepEqual(
      recovery.resumePlannedRestartMainChats([runtimeId], () => true),
      [],
      'a planned restart checkpoint must only launch one replacement foreground turn',
    );

    const ordinaryId = runtimes.registerLiveRuntime({
      kind: 'main_chat',
      label: 'ordinary checkpoint',
      sessionId: 'ordinary_session',
      recoveryPolicy: 'mark_interrupted',
    });
    runtimes.updateLiveRuntimeCheckpoint(ordinaryId, { toolName: 'workspace_read' });
    recovery.prepareActiveRuntimesForGatewayShutdown('gateway_restart');
    runtimes.finishLiveRuntime(ordinaryId);
    runtimes.markDurableRuntimeRecovered(ordinaryId, 'interrupted', { recovery: 'chat_checkpointed' });
    assert.deepEqual(
      recovery.resumePlannedRestartMainChats([ordinaryId], () => true),
      [],
      'only a gateway restart/apply owner uses the planned-boundary continuation path',
    );

    const session = await import('./session');
    const lifecycle = await import('./lifecycle');
    const boot = await import('./boot');
    const bootRuntimeId = runtimes.registerLiveRuntime({
      kind: 'main_chat',
      label: 'boot-owned planned restart',
      sessionId: 'boot_planned_restart_session',
      recoveryPolicy: 'mark_interrupted',
      recoveryData: { message: 'Verify the live dev edit and finish the original request.' },
    });
    session.addMessage('boot_planned_restart_session', {
      role: 'user',
      content: 'Apply this dev edit, then verify it after restart.',
      timestamp: Date.now(),
    });
    runtimes.updateLiveRuntimeCheckpoint(bootRuntimeId, { toolName: 'prom_apply_dev_changes' });
    recovery.prepareActiveRuntimesForGatewayShutdown('prom_apply_dev_changes');
    runtimes.finishLiveRuntime(bootRuntimeId);
    runtimes.markDurableRuntimeRecovered(bootRuntimeId, 'interrupted', { recovery: 'chat_checkpointed' });
    lifecycle.writeRestartContext({
      reason: 'build_deploy',
      timestamp: Date.now(),
      previousSessionId: 'boot_planned_restart_session',
      summary: 'verified dev edit',
    });
    const bootResult = await boot.runBootMd(root, async () => {
      throw new Error('planned foreground restart must not be replaced by a terminal BOOT chat reply');
    });
    assert.equal(bootResult.status, 'ran');
    assert.ok(
      (bootResult.resumableForegroundRuntimeIds || []).includes(bootRuntimeId),
      'BOOT must hand the planned foreground runtime back to the continuation queue',
    );
    assert.equal(
      session.getHistory('boot_planned_restart_session').some((message) => message.messageKind === 'restart_status'),
      false,
      'BOOT must not append a terminal restart acknowledgement to a resumable foreground thread',
    );

    console.log('planned restart foreground continuation regression: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
