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
    const recoveryApi = await import('../runtime-recovery');
    const leaseApi = await import('../gateway-progress-lease');
    const configApi = await import('../../config/config');
    const brainStateApi = await import('./brain-state');
    const { BrainRunner, checkpointBrainRuntime, createBrainHandleChatAdapter } = await import('./brain-runner');

    const brainRunnerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'gateway', 'brain', 'brain-runner.ts'), 'utf8');
    assert.match(
      brainRunnerSource,
      /const runFailed = \/\^error:\/i\.test\(String\(resultText \|\| ''\)\.trim\(\)\) && !submissionSucceeded;/,
      'a successful structured submission must not be invalidated by a later provider error text',
    );

    const forwardedChatArgs: any[][] = [];
    const bridge = createBrainHandleChatAdapter(async (...args: any[]) => {
      forwardedChatArgs.push(args);
      return { type: 'chat', text: 'ok', toolResults: [] };
    });
    const bridgeSendSSE = () => undefined;
    const bridgeCallerOnToken = () => undefined;
    const bridgeRuntimeOptions = { brainThoughtRuntime: true, runtimeId: 'runtime-bridge-regression' };
    const bridgeReasoning = { enabled: true, level: 'low' };
    await bridge(
      'bridge test',
      'brain_thought_bridge_regression',
      bridgeSendSSE,
      undefined,
      { aborted: false },
      'bridge context',
      'model',
      'cron',
      ['brain_thought_submit'],
      undefined,
      bridgeReasoning,
      bridgeCallerOnToken,
      bridgeRuntimeOptions,
    );
    assert.equal(forwardedChatArgs.length, 1);
    assert.deepEqual(forwardedChatArgs[0][10], bridgeReasoning, 'Brain reasoning settings must reach the chat router');
    assert.equal(forwardedChatArgs[0][11], undefined, 'providerOverride must remain an empty reserved slot');
    assert.equal(forwardedChatArgs[0][12], bridgeCallerOnToken, 'callerOnToken must reach the chat router');
    assert.deepEqual(forwardedChatArgs[0][13], bridgeRuntimeOptions, 'Brain runtime flags must reach the chat router');

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

    const staleState = brainStateApi.loadLatestState();
    staleState.lastThoughtAttemptAt = new Date(Date.now() - 5_000).toISOString();
    staleState.lastThoughtStatus = 'idle';
    staleState.lastThoughtError = null;
    staleState.lastThoughtRecovery = null;
    brainStateApi.saveLatestState(staleState);
    const startupRecovery = brainStateApi.reconcileStaleThoughtAttemptAfterGatewayRestart();
    assert.equal(startupRecovery.thoughtRecovered, true);
    const recoveredState = brainStateApi.loadLatestState();
    assert.equal(recoveredState.lastThoughtStatus, 'aborted');
    assert.equal(recoveredState.lastThoughtRecovery, 'recovered_after_gateway_restart');
    assert.match(recoveredState.lastThoughtError || '', /recovered_after_gateway_restart/);
    const recoveryStatus = new BrainRunner({
      workspacePath: workspace,
      broadcast: () => undefined,
      handleChat: async () => ({ type: 'text', text: '', toolResults: [] }),
    }).getBrainStatus();
    assert.ok(
      Date.parse(recoveryStatus.thought.nextRun || '') <= Date.now() + 5_000,
      'recovered Thought must be immediately eligible instead of waiting through the failure backoff',
    );

    const thoughtAbortSignal = { aborted: false, reason: undefined as string | undefined };
    const dreamAbortSignal = { aborted: false, reason: undefined as string | undefined };
    const backgroundThoughtId = runtimeApi.registerLiveRuntime({
      kind: 'brain_thought',
      label: 'background Thought coexists with foreground chat',
      sessionId: 'brain_foreground_yield_regression',
      abortSignal: thoughtAbortSignal,
    });
    const backgroundDreamId = runtimeApi.registerLiveRuntime({
      kind: 'brain_dream',
      label: 'background Dream coexists with foreground chat',
      sessionId: 'brain_foreground_dream_regression',
      abortSignal: dreamAbortSignal,
    });
    const foregroundId = runtimeApi.registerLiveRuntime({
      kind: 'main_chat',
      label: 'foreground chat coexists with Brain',
      sessionId: 'foreground_yield_regression',
      abortSignal: { aborted: false },
    });
    assert.equal(thoughtAbortSignal.aborted, false, 'foreground chat must not abort a running Thought');
    assert.equal(dreamAbortSignal.aborted, false, 'foreground chat must not abort a running Dream');
    assert.ok(runtimeApi.getLiveRuntime(backgroundThoughtId), 'Thought must remain in the active runtime lane');
    assert.ok(runtimeApi.getLiveRuntime(backgroundDreamId), 'Dream must remain in the active runtime lane');
    runtimeApi.finishLiveRuntime(foregroundId);
    runtimeApi.finishLiveRuntime(backgroundThoughtId);
    runtimeApi.finishLiveRuntime(backgroundDreamId);

    const broadcasterSource = fs.readFileSync(path.join(process.cwd(), 'src', 'gateway', 'comms', 'broadcaster.ts'), 'utf-8');
    assert.equal(broadcasterSource.includes('abortBrainOnlyStall'), false, 'event-loop recovery must not have a Brain-only abort path');
    assert.equal(broadcasterSource.includes('event_loop_stall_background_brain'), false, 'event-loop stalls must use normal gateway recovery');

    // Simulate a model response arriving after shutdown has already persisted
    // the interrupted runtime. The late finalizer must preserve that durable
    // checkpoint instead of turning it into a terminal completion.
    const lateThoughtState = brainStateApi.loadLatestState();
    const priorCoverageCursor = lateThoughtState.lastThoughtWindowEndAt;
    lateThoughtState.lastThoughtAttemptAt = new Date().toISOString();
    lateThoughtState.lastThoughtStatus = 'aborted';
    lateThoughtState.lastThoughtError = 'Brain thought run aborted (gateway_restart) before verified artifact completion.';
    brainStateApi.saveLatestState(lateThoughtState);
    const lateModelAbortSignal = { aborted: false, reason: undefined as string | undefined };
    const lateModelRuntimeId = runtimeApi.registerLiveRuntime({
      kind: 'brain_thought',
      label: 'late model return after gateway restart',
      sessionId: 'brain_late_model_return_regression',
      abortSignal: lateModelAbortSignal,
    });
    checkpointBrainRuntime(lateModelRuntimeId, 'model_turn_started', { phase: 'model_request' });
    await runtimeApi.flushLiveRuntimePersistence();
    const interrupted = recoveryApi.prepareActiveRuntimesForGatewayShutdown('gateway_restart');
    assert.equal(interrupted.some((runtime) => runtime.id === lateModelRuntimeId), true);
    assert.equal(lateModelAbortSignal.aborted, true);
    assert.equal(lateModelAbortSignal.reason, 'gateway_restart');
    // This is the late model return/finally cleanup arriving after shutdown.
    runtimeApi.finishLiveRuntime(lateModelRuntimeId);
    await runtimeApi.flushLiveRuntimePersistence();
    const lateLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    assert.equal(lateLedger.runtimes[lateModelRuntimeId]?.status, 'interrupted', 'late model cleanup must preserve the restart checkpoint');
    const lateState = brainStateApi.loadLatestState();
    assert.equal(lateState.lastThoughtStatus, 'aborted', 'a late model return must not overwrite the restart interruption');
    assert.equal(lateState.lastThoughtWindowEndAt, priorCoverageCursor, 'a restarted Thought must not advance coverage without verified submission');
    assert.match(lateState.lastThoughtError || '', /gateway_restart/);
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
