import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Isolate task/runtime persistence before loading application modules.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-recovery-bg-agent-'));
process.env.PROMETHEUS_CONFIG_PATH = path.join(root, 'config.json');
process.env.PROMETHEUS_APP_DATA_DIR = root;
process.env.PROMETHEUS_DATA_DIR = root;
process.env.PROMETHEUS_WORKSPACE_DIR = root;
process.env.APPDATA = root;
process.env.USERPROFILE = root;
process.env.HOME = root;

async function main(): Promise<void> {
  try {
    const config = require('../config/config').getConfig();
    config.getConfigDir = () => root;
    config.getWorkspacePath = () => root;

    const taskStore = require('./tasks/task-store');
    const runtimeRegistry = require('./live-runtime-registry');
    const loadTaskIds: string[] = [];
    const taskStatusUpdates: string[] = [];
    const originalLoadTask = taskStore.loadTask.bind(taskStore);
    const Module = require('node:module') as any;
    const originalModuleLoad = Module._load;
    Module._load = function (request: string, parent: { filename?: string } | undefined, isMain: boolean): any {
      const loaded = originalModuleLoad.call(this, request, parent, isMain);
      if (request !== './tasks/task-store' || !String(parent?.filename || '').includes('runtime-recovery')) return loaded;
      return new Proxy(loaded, {
        get(target, property, receiver) {
          if (property === 'loadTask') return (id: string) => {
            loadTaskIds.push(String(id));
            return originalLoadTask(id);
          };
          if (property === 'updateTaskStatus') return (id: string, ...args: any[]) => {
            taskStatusUpdates.push(String(id));
            return Reflect.get(target, property, receiver)(id, ...args);
          };
          return Reflect.get(target, property, receiver);
        },
      });
    };
    let recovery: any;
    try {
      recovery = require('./runtime-recovery');
    } finally {
      Module._load = originalModuleLoad;
    }
    const backgroundAgentId = `bg_${randomUUID()}`;
    const backgroundAgentRuntimeId = runtimeRegistry.registerLiveRuntime({
      kind: 'background_agent',
      label: 'ephemeral regression agent',
      taskId: backgroundAgentId,
      sessionId: `agent-session-${randomUUID()}`,
      recoveryPolicy: 'mark_interrupted',
      abortSignal: { aborted: false },
    });

    const task = taskStore.createTask({
      title: 'formal recovery regression task',
      prompt: 'verify normal formal task recovery',
      sessionId: `task-parent-${randomUUID()}`,
      channel: 'web',
      plan: [],
    });
    task.status = 'running';
    taskStore.saveTask(task);
    const taskRuntimeId = runtimeRegistry.registerLiveRuntime({
      kind: 'background_task',
      label: 'formal recovery regression task',
      taskId: task.id,
      sessionId: `task_${task.id}`,
      recoveryPolicy: 'mark_interrupted',
      abortSignal: { aborted: false },
    });

    const selectedRuntimeIds = new Set([backgroundAgentRuntimeId, taskRuntimeId]);
    const interrupted = recovery.prepareInitiatingRuntimesForGatewayHandoff(
      'runtime recovery regression',
      (runtime: { id: string }) => selectedRuntimeIds.has(runtime.id),
    );
    assert.deepEqual(new Set(interrupted.map((runtime: { id: string }) => runtime.id)), selectedRuntimeIds);

    assert.equal(loadTaskIds.includes(backgroundAgentId), false,
      'background_agent steering identity must not be passed to loadTask during formal task cleanup');
    assert.equal(taskStatusUpdates.includes(backgroundAgentId), false,
      'background_agent must not enter pauseTaskForRestart task-status cleanup');
    const pausedTask = taskStore.loadTask(task.id);
    assert.equal(pausedTask?.status, 'paused', 'real background_task still goes through task cleanup');
    assert.equal(pausedTask?.pauseReason, 'gateway_restart');
    assert.ok(taskStatusUpdates.includes(task.id), 'real background_task still updates its formal task status');
    assert.ok(pausedTask?.journal.some((entry: { type?: string }) => entry.type === 'pause'),
      'real background_task still records a pause journal entry');

    const summary = recovery.buildHotRestartRecoverySummary(30 * 60_000, 0);
    assert.doesNotMatch(summary, new RegExp(backgroundAgentId),
      'restart summary must exclude background_agent as a formal task');
    assert.doesNotMatch(summary, new RegExp(`task_control\\(action:"resume", task_id:"${backgroundAgentId}"\\)`),
      'restart summary must not suggest task_control resume for a background_agent ID');
    assert.match(summary, new RegExp(`background_task: formal recovery regression task \\(${task.id}\\); status=paused`),
      'restart summary must continue to report the real formal task');
    assert.match(summary, new RegExp(`task_control\\(action:"resume", task_id:"${task.id}"\\)`),
      'restart summary must retain the formal task resume hint');

    console.log('PASS runtime recovery background-agent isolation: no task lookup/pause or resume hint for bg_*; background_task cleanup and summary preserved');
  } finally {
    // Flush isolated coalesced runtime-ledger writes before removing their temp root.
    await new Promise((resolve) => setTimeout(resolve, 800));
    try { await require('./live-runtime-registry').flushLiveRuntimePersistence(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
