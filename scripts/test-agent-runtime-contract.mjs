import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const tools = await import(pathToFileURL(path.join(root, 'dist/gateway/tools/defs/agent-team-schedule.js')).href);
const executor = await import(pathToFileURL(path.join(root, 'dist/gateway/agents-runtime/subagent-executor.js')).href);
const taskRunner = await import(pathToFileURL(path.join(root, 'dist/gateway/tasks/task-runner.js')).href);
const defs = tools.getAgentTeamScheduleTools();
const def = (name) => defs.find((entry) => entry.function?.name === name)?.function;

const runOps = def('agent_run_ops');
assert.ok(runOps.parameters.properties.action.enum.includes('benchmark_disposable'));
assert.equal(runOps.parameters.properties.detail.default, undefined);
assert.deepEqual(runOps.parameters.properties.detail.enum, ['compact', 'full']);
const chat = def('chat_with_subagent');
assert.ok(chat.parameters.properties.include_history);
assert.ok(chat.parameters.properties.history_limit);
const taskControl = def('task_control');
assert.ok(taskControl.parameters.properties.include_scheduled);

const invalid = await executor.executeTool('spawn_subagent', {
  run_now: false,
  create_if_missing: {
    description: 'Disposable schema validation fixture',
    system_instructions: 'Do nothing.',
    constraints: 'not-an-array',
    success_criteria: 'Validate only.',
  },
}, root, {}, 'agent_contract_test');
assert.equal(invalid.error, true);
assert.match(invalid.result, /INVALID_CREATE_SCHEMA/);
assert.match(invalid.result, /generated_subagent_id/);
assert.match(invalid.result, /constraints must be an array/);

const taskRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/task-runner.ts'), 'utf8');
assert.match(taskRunnerSource, /defaults\.background_task \? 'background_task' : 'background_spawn'/);
assert.match(taskRunnerSource, /agent_model_default_reasoning/);
assert.doesNotMatch(taskRunnerSource.match(/function resolveBackgroundAgentModelRouting[\s\S]*?function createBackgroundPrompt/)?.[0] || '', /defaults\.main_chat/);
assert.match(taskRunnerSource, /'background_task',\s*\n\s*undefined,\s*\/\/ toolFilter/);
assert.deepEqual(
  taskRunner.resolveBackgroundAgentModelRouting({ model: 'openai_codex/gpt-5.6-luna', reasoningEffort: 'low' }),
  { providerId: 'openai_codex', model: 'gpt-5.6-luna', reasoningEffort: 'low', source: 'background_spawn.override' },
);

const executorSource = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-executor.ts'), 'utf8');
assert.match(executorSource, /summarizeAgentRunCompact/);
assert.match(executorSource, /args\?\.include_history === true/);
assert.match(executorSource, /messages: args\?\.include_history === true/);
assert.match(executorSource, /reasoning_effort/);

const settingsSource = fs.readFileSync(path.join(root, 'web-ui/src/pages/SettingsPage.js'), 'utf8');
assert.match(settingsSource, /providerId !== 'openai_codex'/);
assert.match(settingsSource, /ensureAmdReasoningControls/);
assert.match(settingsSource, /getAgentReasoningDefaultsFromForm/);
const settingsRouterSource = fs.readFileSync(path.join(root, 'src/gateway/routes/settings.router.ts'), 'utf8');
assert.match(settingsRouterSource, /agent_model_default_reasoning/);
assert.match(settingsRouterSource, /normalizeReasoningEffort/);

console.log('PASS: background routing, disposable validation, compact hydration, and delta-chat contracts');
