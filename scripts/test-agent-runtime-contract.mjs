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
const agentOps = def('agent_ops');
assert.ok(agentOps.parameters.properties.patch.properties.description);
assert.ok(agentOps.parameters.properties.patch.properties.max_steps);
const teamOps = def('team_ops_wrapper');
for (const requiredCreateField of ['name', 'purpose', 'team_context', 'subagent_ids']) {
  assert.ok(teamOps.parameters.properties[requiredCreateField], `team_ops_wrapper exposes ${requiredCreateField}`);
}

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
assert.match(executorSource, /Object\.assign\(args, nestedPatch\)/);
assert.match(executorSource, /resolved_target_type: 'standalone_subagent'/);
assert.match(executorSource, /success: completed/);

const chatRouterSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
assert.match(chatRouterSource, /const durableTaskId =/);
assert.match(chatRouterSource, /sessionId\.startsWith\('task_'\) \|\| hasDurableTaskPlan/);
assert.match(chatRouterSource, /durableTaskId \|\| sessionId\.replace/);

const backgroundRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/background-task-runner.ts'), 'utf8');
assert.match(backgroundRunnerSource, /explicit text-only standalone assignment returned a substantive result/);
assert.match(backgroundRunnerSource, /String\(liveTask\.originalAssignment \|\| liveTask\.prompt\)/);
assert.match(backgroundRunnerSource, /addPendingRuntimeSteerForSession\(task\.originatingSessionId/);
assert.match(backgroundRunnerSource, /syntheticSubagentCompletion: true/);
assert.doesNotMatch(backgroundRunnerSource, /\[SUBAGENT_RESPONSE/);
assert.doesNotMatch(
  backgroundRunnerSource.match(/Standalone subagent path:[\s\S]*?\/\/ Normal task path/)?.[0] || '',
  /_broadcast\('task_notification'/,
  'standalone subagent completion must not append a floating notification over the active tool stream',
);

assert.match(chatRouterSource, /isSyntheticSubagentCompletionTurn/);
assert.match(chatRouterSource, /!isGoalContinuationTurn && !isSyntheticSubagentCompletionTurn/);

const serverSource = fs.readFileSync(path.join(root, 'src/gateway/server-v2.ts'), 'utf8');
assert.match(serverSource, /if \(!isTaskRouterInitialized\(\)\)/);
assert.match(serverSource, /setStandaloneSubagentCompletionTurn/);

const settingsSource = fs.readFileSync(path.join(root, 'web-ui/src/pages/SettingsPage.js'), 'utf8');
assert.match(settingsSource, /providerId !== 'openai_codex'/);
assert.match(settingsSource, /ensureAmdReasoningControls/);
assert.match(settingsSource, /getAgentReasoningDefaultsFromForm/);
const settingsRouterSource = fs.readFileSync(path.join(root, 'src/gateway/routes/settings.router.ts'), 'utf8');
assert.match(settingsRouterSource, /agent_model_default_reasoning/);
assert.match(settingsRouterSource, /normalizeReasoningEffort/);

console.log('PASS: background routing, disposable validation, compact hydration, and delta-chat contracts');
