import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.');
const tools = await import(pathToFileURL(path.join(root, 'dist/gateway/tools/defs/agent-team-schedule.js')).href);
const executor = await import(pathToFileURL(path.join(root, 'dist/gateway/agents-runtime/subagent-executor.js')).href);
const subagentManager = await import(pathToFileURL(path.join(root, 'dist/gateway/agents-runtime/subagent-manager.js')).href);
const taskRouter = await import(pathToFileURL(path.join(root, 'dist/gateway/tasks/task-router.js')).href);
const taskRunner = await import(pathToFileURL(path.join(root, 'dist/gateway/tasks/task-runner.js')).href);
const liveRuntime = await import(pathToFileURL(path.join(root, 'dist/gateway/live-runtime-registry.js')).href);
const defs = tools.getAgentTeamScheduleTools();
const def = (name) => defs.find((entry) => entry.function?.name === name)?.function;

const runOps = def('agent_run_ops');
assert.ok(runOps.parameters.properties.action.enum.includes('benchmark_disposable'));
assert.equal(runOps.parameters.properties.detail.default, undefined);
assert.deepEqual(runOps.parameters.properties.detail.enum, ['compact', 'full']);
const chat = def('chat_with_subagent');
assert.ok(chat.parameters.properties.include_history);
assert.ok(chat.parameters.properties.history_limit);
const chatOps = def('agent_chat_ops');
for (const action of ['chat', 'delegate', 'steer', 'send_mailbox']) {
  assert.ok(chatOps.parameters.properties.action.enum.includes(action), `agent_chat_ops exposes unambiguous ${action} action`);
}
assert.ok(chatOps.parameters.properties.assignment);
assert.ok(chatOps.parameters.properties.task_id);
const delegate = def('message_subagent');
assert.ok(delegate.parameters.properties.assignment);
assert.match(delegate.description, /already creates and starts the task/i);
const taskControl = def('task_control');
assert.ok(taskControl.parameters.properties.include_scheduled);
const agentOps = def('agent_ops');
assert.ok(agentOps.parameters.properties.patch.properties.reasoning_effort);
assert.ok(agentOps.parameters.properties.reasoning_effort);
const agentUpdate = def('agent_update');
assert.ok(agentUpdate.parameters.properties.name);
assert.ok(agentUpdate.parameters.properties.reasoning_effort);
assert.match(agentUpdate.description, /independent/i);
assert.ok(agentOps.parameters.properties.patch.properties.description);
assert.ok(agentOps.parameters.properties.patch.properties.max_steps);
const teamOps = def('team_ops_wrapper');
for (const requiredCreateField of ['name', 'purpose', 'team_context', 'subagent_ids']) {
  assert.ok(teamOps.parameters.properties[requiredCreateField], `team_ops_wrapper exposes ${requiredCreateField}`);
}
const backgroundOps = def('background_ops');
assert.ok(backgroundOps.parameters.properties.action.enum.includes('steer'));
assert.ok(backgroundOps.parameters.properties.message);
const backgroundSteer = def('background_steer');
assert.deepEqual(backgroundSteer.parameters.required, ['background_id', 'message']);

assert.equal(liveRuntime.isSteerableBackgroundAgentRuntimeKind('background_agent'), true);
const backgroundRuntimeId = liveRuntime.registerLiveRuntime({
  kind: 'background_agent',
  label: 'Background steer contract',
  sessionId: 'background_agent_contract_session',
  taskId: 'bg_contract_agent',
  abortSignal: { aborted: false },
});
const queuedBackgroundSteer = liveRuntime.addPendingRuntimeSteerForBackgroundAgent('bg_contract_agent', {
  message: 'Prioritize the new constraint before your next action.',
  source: 'agent_contract_test',
  kind: 'constraint',
  requiresWorkerResponse: true,
});
assert.equal(queuedBackgroundSteer.ok, true, queuedBackgroundSteer.error);
const consumedBackgroundSteer = liveRuntime.consumePendingRuntimeSteersForSession('background_agent_contract_session');
assert.equal(consumedBackgroundSteer.length, 1);
assert.equal(consumedBackgroundSteer[0].message, 'Prioritize the new constraint before your next action.');
liveRuntime.finishLiveRuntime(backgroundRuntimeId);

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

assert.deepEqual(
  subagentManager.validateDirectSubagentAssignment('Fix the plane controls and verify the Vita build.'),
  { ok: true },
);
const nestedDelegation = subagentManager.validateDirectSubagentAssignment(
  'Create and execute a BRAND-NEW independent task/run now.\n\nFix the plane controls.',
);
assert.equal(nestedDelegation.ok, false);
assert.equal(nestedDelegation.code, 'INVALID_DELEGATION_ASSIGNMENT');
const rejectedBeforeLookup = await executor.executeTool('message_subagent', {
  agent_id: 'does_not_need_to_exist_for_validation',
  assignment: 'Start a new background task to fix the plane controls.',
}, root, {}, 'agent_contract_test');
assert.equal(rejectedBeforeLookup.error, true);
assert.match(rejectedBeforeLookup.result, /INVALID_DELEGATION_ASSIGNMENT/);
const rejectedThroughWrapper = await executor.executeTool('agent_chat_ops', {
  action: 'delegate',
  agent_id: 'does_not_need_to_exist_for_validation',
  assignment: 'Launch a separate background run now to fix the plane controls.',
}, root, {}, 'agent_contract_test');
assert.equal(rejectedThroughWrapper.error, true);
assert.match(rejectedThroughWrapper.result, /INVALID_DELEGATION_ASSIGNMENT/);

const completedStandaloneAgentTask = { id: 'task_milestone_1', title: 'Milestone 1', status: 'complete', subagentProfile: 'builder' };
assert.equal(taskRouter.isImmutableCompletedAgentTask(completedStandaloneAgentTask), true);
assert.equal(taskRouter.isImmutableCompletedAgentTask({ ...completedStandaloneAgentTask, status: 'running' }), false);
assert.equal(taskRouter.isImmutableCompletedAgentTask({ id: 'ordinary', title: 'Ordinary', status: 'complete' }), false);
assert.throws(
  () => taskRouter.appendScopedTaskContinuation(completedStandaloneAgentTask, 'Complete milestone 2'),
  /immutable.*new task/i,
);

const taskRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/task-runner.ts'), 'utf8');
assert.match(taskRunnerSource, /const slot = 'background_spawn'/);
assert.doesNotMatch(taskRunnerSource, /defaults\.background_task/);
assert.match(taskRunnerSource, /agent_model_default_reasoning/);
assert.doesNotMatch(taskRunnerSource.match(/function resolveBackgroundAgentModelRouting[\s\S]*?function createBackgroundPrompt/)?.[0] || '', /defaults\.main_chat/);
assert.match(taskRunnerSource, /'background_task',\s*\n\s*undefined,\s*\/\/ toolFilter/);
assert.match(taskRunnerSource, /function backgroundSteer\(/);
assert.match(taskRunnerSource, /addPendingRuntimeSteerForBackgroundAgent\(rec\.id/);
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
assert.match(executorSource, /chat: 'chat_with_subagent'/);
assert.match(executorSource, /delegate: 'message_subagent'/);
assert.match(executorSource, /steer: 'agent_run_ops'/);
assert.match(executorSource, /action === 'steer' \|\| action === 'message'/);
assert.match(executorSource, /case 'background_steer'/);
assert.doesNotMatch(executorSource, /Direct background message from main chat to standalone subagent/);

const subagentManagerSource = fs.readFileSync(path.join(root, 'src/gateway/agents-runtime/subagent-manager.ts'), 'utf8');
assert.match(subagentManagerSource, /TASK STATUS: This task\/run already exists/);
assert.match(subagentManagerSource, /ASSIGNMENT: \$\{taskPrompt\}/);
assert.match(subagentManagerSource, /patch\.reasoning_effort/);

const taskRouterSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/task-router.ts'), 'utf8');
assert.match(taskRouterSource, /completed_agent_task_immutable/);
assert.match(taskRouterSource, /Delegate the next milestone or follow-up as a new task/);
const tasksRouteSource = fs.readFileSync(path.join(root, 'src/gateway/routes/tasks.router.ts'), 'utf8');
assert.match(tasksRouteSource, /router\.post\('\/api\/bg-tasks\/:id\/restart'/);
assert.match(tasksRouteSource, /isImmutableCompletedAgentTask\(task\)/);

const chatRouterSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
assert.match(chatRouterSource, /const durableTaskId =/);
assert.match(chatRouterSource, /sessionId\.startsWith\('task_'\) \|\| hasDurableTaskPlan/);
assert.match(chatRouterSource, /durableTaskId \|\| sessionId\.replace/);

const backgroundRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/background-task-runner.ts'), 'utf8');
assert.doesNotMatch(backgroundRunnerSource, /agent_model_defaults\?\.background_task|_resolveRunOnceModel/);
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
