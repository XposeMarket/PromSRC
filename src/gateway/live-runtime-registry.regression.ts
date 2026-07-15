import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prometheus-runtime-interrupt-'));
  process.env.PROMETHEUS_DATA_DIR = root;
  process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

  try {
    const runtimes = await import('./live-runtime-registry.js');
    const signal: { aborted: boolean; interrupted?: boolean } = { aborted: false };
    const ioController = new AbortController();
    let operatorAbortCalls = 0;
    let shutdownInterruptCalls = 0;
    let durableBeforeIoCancellation = false;
    let runtimeId = '';

    runtimeId = runtimes.registerLiveRuntime({
      kind: 'background_agent',
      label: 'Shutdown interruption regression',
      sessionId: 'shutdown_interrupt_regression',
      abortSignal: signal,
      onAbort: () => { operatorAbortCalls += 1; },
      onShutdownInterrupt: () => {
        shutdownInterruptCalls += 1;
        durableBeforeIoCancellation = runtimes.listDurableRuntimes().some((entry) => (
          entry.id === runtimeId && entry.status === 'interrupted'
        ));
        ioController.abort();
      },
    });

    runtimes.updateLiveRuntimeCheckpoint(runtimeId, {
      event: 'tool_call',
      args: { image: 'A'.repeat(2 * 1024 * 1024), path: 'safe.txt' },
    });
    const boundedCheckpointText = JSON.stringify(runtimes.getLiveRuntime(runtimeId)?.checkpoint);
    assert.ok(boundedCheckpointText.length < 10_000, 'raw checkpoint arguments must be bounded in memory');
    assert.match(boundedCheckpointText, /large argument string omitted/);

    const interrupted = runtimes.markActiveRuntimesInterrupted('regression_restart');
    assert.equal(interrupted.some((entry) => entry.id === runtimeId), true);
    assert.equal(signal.aborted, true, 'legacy cooperative abort flag must still stop loops');
    assert.equal(signal.interrupted, true, 'shutdown must be distinguishable from operator abort');
    assert.equal(shutdownInterruptCalls, 1, 'shutdown-specific I/O cancellation must run exactly once');
    assert.equal(operatorAbortCalls, 0, 'shutdown must never invoke operator-abort semantics');
    assert.equal(ioController.signal.aborted, true, 'shutdown hook must release underlying I/O');
    assert.equal(durableBeforeIoCancellation, true, 'recovery snapshot must be durable before I/O is cancelled');

    // Real runtimes unwind through finally after their AbortController fires.
    // That cleanup must remove only the in-memory record, not recovery state.
    runtimes.finishLiveRuntime(runtimeId);
    assert.equal(runtimes.getLiveRuntime(runtimeId), null);
    assert.equal(
      runtimes.listDurableRuntimes().find((entry) => entry.id === runtimeId)?.status,
      'interrupted',
      'interrupted runtime must survive normal finally cleanup for restart recovery',
    );

    const taskRunnerSource = await fs.promises.readFile(
      path.join(process.cwd(), 'src', 'gateway', 'tasks', 'task-runner.ts'),
      'utf8',
    );
    const registrationStart = taskRunnerSource.indexOf('const runtimeId = registerLiveRuntime({');
    const registrationEnd = taskRunnerSource.indexOf('record.state = \'in_progress\';', registrationStart);
    const registration = taskRunnerSource.slice(registrationStart, registrationEnd);
    assert.match(registration, /onShutdownInterrupt:\s*\(\)\s*=>\s*abortController\.abort\(\)/);
    const shutdownHook = registration.slice(registration.indexOf('onShutdownInterrupt:'));
    assert.doesNotMatch(shutdownHook, /record\.state\s*=\s*'failed'/, 'shutdown hook must not fail the task-runner record');
    assert.match(taskRunnerSource, /if \(abortSignal\.interrupted\)/, 'task-runner unwind must preserve resumable state');

    const brainSource = await fs.promises.readFile(
      path.join(process.cwd(), 'src', 'gateway', 'brain', 'brain-runner.ts'),
      'utf8',
    );
    assert.equal(
      (brainSource.match(/onShutdownInterrupt:\s*\(\)\s*=>\s*abortController\.abort\(\)/g) || []).length,
      3,
      'thought, dream, and dream-cleanup runtimes must cancel I/O through shutdown-only hooks',
    );
    assert.equal(
      (brainSource.match(/if \(abortSignal\.interrupted\) return false;/g) || []).length,
      3,
      'Brain restart unwind must not publish operator-abort/failure artifacts',
    );

    const heartbeatSource = await fs.promises.readFile(
      path.join(process.cwd(), 'src', 'gateway', 'scheduling', 'heartbeat-runner.ts'),
      'utf8',
    );
    assert.match(heartbeatSource, /onShutdownInterrupt:\s*\(\)\s*=>\s*abortController\.abort\(\)/,
      'heartbeat must release model I/O through a shutdown-only hook');
    assert.match(heartbeatSource, /if \(abortSignal\.interrupted\) return;/,
      'heartbeat restart unwind must not become an operator failure');
    assert.match(heartbeatSource, /if \(!this\.started \|\| !entry\.config\.enabled\) return;/,
      'heartbeat finally must not resurrect a timer after stop()');

    const serverSource = await fs.promises.readFile(path.join(process.cwd(), 'src', 'gateway', 'server-v2.ts'), 'utf8');
    const signalShutdown = serverSource.slice(serverSource.indexOf('async function gracefulShutdown'));
    assert.match(serverSource, /PROMETHEUS_GATEWAY_SHUTDOWN_TIMEOUT_MS\s*\|\|\s*30_000/);
    assert.ok(
      signalShutdown.indexOf('recordActiveMainChatGoalsInterruptedForRestart')
        < signalShutdown.indexOf('prepareActiveRuntimesForGatewayShutdown'),
      'signal shutdown must preserve between-turn goals before interrupting live runtimes',
    );
    assert.ok(
      signalShutdown.indexOf('shutdownModelTurnWorkerPool()') < signalShutdown.indexOf('shutdownSessionPersistence()')
      && signalShutdown.indexOf('shutdownSessionPersistence()') < signalShutdown.indexOf('shutdownTurnJobRuntime()'),
      'signal shutdown must drain workers, then sessions, and close the turn journal last',
    );

    const lifecycleSource = await fs.promises.readFile(path.join(process.cwd(), 'src', 'gateway', 'lifecycle.ts'), 'utf8');
    const coordinatedShutdown = lifecycleSource.slice(
      lifecycleSource.indexOf('async function shutdownGateway'),
      lifecycleSource.indexOf('// ─── Graceful Restart'),
    );
    assert.ok(
      coordinatedShutdown.indexOf('stopRuntimeWorkers') < coordinatedShutdown.indexOf('flushSessions')
      && coordinatedShutdown.indexOf('flushSessions') < coordinatedShutdown.indexOf('closeTurnJournal'),
      'coordinated restart must keep session and journal owners alive until worker drain finishes',
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log('live runtime shutdown interruption regression checks passed');
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
