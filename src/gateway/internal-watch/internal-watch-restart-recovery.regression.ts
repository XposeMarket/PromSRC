import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-internal-watch-restart-'));
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(root, 'workspace');

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
}

async function main(): Promise<void> {
  try {
    const taskApi = await import('../tasks/task-store');
    const storeApi = await import('./internal-watch-store');
    const runnerApi = await import('./internal-watch-runner');

    const task = taskApi.createTask({
      title: 'Restart watched task',
      prompt: 'Complete the same task after a restart.',
      sessionId: 'task_internal_watch_restart',
      originatingSessionId: 'owner_internal_watch_restart',
      channel: 'web',
      plan: [
        { index: 0, description: 'First step', status: 'done' },
        { index: 1, description: 'Resume this step', status: 'pending' },
      ],
      onResumeInstruction: 'Preserved checkpoint: continue at step 1.',
    });
    taskApi.updateTaskStatus(task.id, 'paused', {
      pauseReason: 'gateway_restart',
      pausedAt: 1_784_300_000_000,
      pausedAtStepIndex: 1,
    });

    const observation = runnerApi.observeInternalWatchTarget({
      id: 'shape_only',
      label: 'shape only',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ttlMs: 60_000,
      origin: { sessionId: 'owner_internal_watch_restart', channel: 'web' },
      target: { type: 'task', config: { taskId: task.id } },
      condition: { terminalStatuses: ['complete', 'failed'] },
      onMatch: 'Report the final result.',
      deliveryMode: 'run_turn',
      maxFirings: 1,
      firedCount: 0,
      status: 'active',
    });
    assert.equal(observation.pauseReason, 'gateway_restart');
    assert.equal(observation.pausedAtStepIndex, 1);
    assert.match(String(observation.checkpoint), /Preserved checkpoint/);

    const watch = storeApi.createInternalWatch({
      id: 'restart_recovery_success',
      label: 'Supervise restart recovery',
      ttlMs: 60_000,
      origin: { sessionId: 'owner_internal_watch_restart', channel: 'web' },
      target: { type: 'task', config: { taskId: task.id } },
      condition: { terminalStatuses: ['complete', 'failed'] },
      onMatch: 'Report the final result.',
    });

    const delivered: string[] = [];
    const runner = new runnerApi.InternalWatchRunner({
      tickMs: 60_000,
      broadcast: () => {},
      runInteractiveTurn: async (message) => {
        delivered.push(message);
        return { type: 'chat', text: 'Resuming the same watched task.' };
      },
    });
    await (runner as any).tick();
    await settle();

    let persisted = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === watch.id)!;
    assert.equal(delivered.length, 1, 'restart pause should wake Prometheus exactly once');
    assert.match(delivered[0], /gateway restarted/i);
    assert.match(delivered[0], /watch remains active/i);
    assert.equal(persisted.status, 'active', 'restart wake-up must not complete the watch');
    assert.equal(persisted.pendingRestartInterruption, undefined);
    assert.match(String(persisted.lastDeliveredRestartInterruptionId), new RegExp(String(task.pausedAt || 1_784_300_000_000)));

    await (runner as any).tick();
    await settle();
    assert.equal(delivered.length, 1, 'the same restart pause must not be delivered twice');

    const replayTask = taskApi.createTask({
      title: 'Replay interrupted delivery',
      prompt: 'Retry the durable watch event.',
      sessionId: 'task_internal_watch_replay',
      originatingSessionId: 'owner_internal_watch_replay',
      channel: 'web',
      plan: [{ index: 0, description: 'Resume safely', status: 'pending' }],
    });
    taskApi.updateTaskStatus(replayTask.id, 'paused', {
      pauseReason: 'gateway_restart',
      pausedAt: 1_784_300_001_000,
      pausedAtStepIndex: 0,
    });
    const replayWatch = storeApi.createInternalWatch({
      id: 'restart_recovery_replay',
      label: 'Replay restart delivery',
      ttlMs: 60_000,
      origin: { sessionId: 'owner_internal_watch_replay', channel: 'web' },
      target: { type: 'task', config: { taskId: replayTask.id } },
      condition: { terminalStatuses: ['complete'] },
      onMatch: 'Report completion.',
    });
    let attempts = 0;
    const replayRunner = new runnerApi.InternalWatchRunner({
      tickMs: 60_000,
      broadcast: () => {},
      runInteractiveTurn: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('simulated replacement gateway boundary');
        return { type: 'chat', text: 'Recovered on retry.' };
      },
    });
    await (replayRunner as any).tick();
    await settle();
    persisted = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === replayWatch.id)!;
    assert.equal(persisted.status, 'active');
    assert.ok(persisted.pendingRestartInterruption, 'failed delivery must stay durable for the next gateway/tick');

    await (replayRunner as any).tick();
    await settle();
    persisted = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === replayWatch.id)!;
    assert.equal(attempts, 2);
    assert.equal(persisted.pendingRestartInterruption, undefined);
    assert.equal(persisted.status, 'active');

    const matchTask = taskApi.createTask({
      title: 'Replay a normal match',
      prompt: 'Finish and deliver once.',
      sessionId: 'task_internal_watch_match',
      originatingSessionId: 'owner_internal_watch_match',
      channel: 'web',
      plan: [{ index: 0, description: 'Done', status: 'done' }],
    });
    taskApi.updateTaskStatus(matchTask.id, 'complete');
    const matchWatch = storeApi.createInternalWatch({
      id: 'normal_match_replay',
      label: 'Replay normal completion',
      ttlMs: 60_000,
      origin: { sessionId: 'owner_internal_watch_match', channel: 'web' },
      target: { type: 'task', config: { taskId: matchTask.id } },
      condition: { terminalStatuses: ['complete'] },
      onMatch: 'Deliver the completed task.',
    });
    let matchAttempts = 0;
    const matchRunner = new runnerApi.InternalWatchRunner({
      tickMs: 60_000,
      broadcast: () => {},
      runInteractiveTurn: async () => {
        matchAttempts += 1;
        if (matchAttempts === 1) throw new Error('simulated match delivery interruption');
        return { type: 'chat', text: 'Completion delivered.' };
      },
    });
    await (matchRunner as any).tick();
    await settle();
    persisted = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === matchWatch.id)!;
    assert.equal(persisted.status, 'active', 'a match is not terminal until its follow-up is delivered');
    assert.ok(persisted.pendingMatchObservation);
    assert.equal(persisted.firedCount, 0);

    await (matchRunner as any).tick();
    await settle();
    persisted = storeApi.listInternalWatches({ includeDone: true }).find((item) => item.id === matchWatch.id)!;
    assert.equal(matchAttempts, 2);
    assert.equal(persisted.status, 'matched');
    assert.equal(persisted.pendingMatchObservation, undefined);
    assert.equal(persisted.firedCount, 1);

    console.log('internal watch restart recovery regression passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
