import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-task-steer-'));
process.env.PROMETHEUS_DATA_DIR = path.join(testRoot, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(testRoot, 'workspace');

const require = createRequire(import.meta.url);
const store = require('../dist/gateway/tasks/task-store.js');
const router = require('../dist/gateway/tasks/task-router.js');
const registry = require('../dist/gateway/live-runtime-registry.js');
let runtimeId = '';

try {
  const task = store.createTask({
    title: '[Subagent] Dante',
    prompt: 'Inspect the game.',
    sessionId: 'origin_chat',
    channel: 'web',
    subagentProfile: 'dante',
    plan: [{ index: 0, description: 'Inspect', status: 'running' }],
  });
  store.updateTaskStatus(task.id, 'running');
  runtimeId = registry.registerLiveRuntime({
    kind: 'subagent',
    label: task.title,
    sessionId: task.sessionId,
    taskId: task.id,
  });

  const result = await router.handleTaskControlAction('main_chat', {
    action: 'steer',
    task_id: task.id,
    message: 'Prioritize input latency before the rendering audit.',
  });
  assert.equal(result.success, true);
  assert.equal(result.steered, true);
  assert.equal(result.queued, false);

  const injected = registry.consumePendingRuntimeSteersForSession(`task_${task.id}`);
  assert.equal(injected.length, 1);
  assert.match(injected[0].message, /HIGHEST PRIORITY/);
  assert.match(injected[0].message, /Prioritize input latency/);

  const persisted = store.loadTask(task.id);
  assert.equal(persisted.status, 'running');
  assert.ok(persisted.resumeContext.messages.some((entry) => /Prioritize input latency/.test(entry.content)));
  assert.ok(persisted.journal.some((entry) => /Task steer/.test(entry.content)));

  const toolDefs = fs.readFileSync(path.join(root, 'src/gateway/tools/defs/agent-team-schedule.ts'), 'utf8');
  assert.match(toolDefs, /action=\"steer\"/, 'agent tools must advertise existing-run steering');
  assert.match(toolDefs, /force_new_task/, 'new subagent tasks must require an explicit override when a run exists');

  console.log('task steering contract: ok');
} finally {
  if (runtimeId) registry.finishLiveRuntime(runtimeId);
  fs.rmSync(testRoot, { recursive: true, force: true });
}
