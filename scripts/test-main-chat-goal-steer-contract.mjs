import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-goal-steer-'));
process.env.PROMETHEUS_DATA_DIR = path.join(testRoot, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(testRoot, 'workspace');

const require = createRequire(import.meta.url);
const registry = require('../dist/gateway/live-runtime-registry.js');
const runtimeIds = [];

try {
  assert.equal(registry.isSteerableChatRuntimeKind('main_chat'), true);
  assert.equal(registry.isSteerableChatRuntimeKind('main_chat_goal'), true);
  assert.equal(registry.isSteerableChatRuntimeKind('background_task'), false);

  const goalRuntimeId = registry.registerLiveRuntime({
    kind: 'main_chat_goal',
    label: 'Goal steer test',
    sessionId: 'goal_steer_session',
  });
  runtimeIds.push(goalRuntimeId);

  const queued = registry.addPendingRuntimeSteer(goalRuntimeId, {
    sessionId: 'goal_steer_session',
    message: 'Use the narrower implementation, but keep pursuing the same goal.',
    source: 'goal_steer_contract',
  });
  assert.equal(queued.ok, true, queued.error);
  assert.equal(queued.runtime?.kind, 'main_chat_goal');
  assert.equal(queued.runtime?.status, 'running');

  const consumed = registry.consumePendingRuntimeSteersForSession('goal_steer_session');
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].message, 'Use the narrower implementation, but keep pursuing the same goal.');
  assert.equal(registry.getLiveRuntime(goalRuntimeId)?.status, 'running', 'steering must not stop or replace the goal runtime');

  const backgroundResult = registry.addPendingRuntimeSteerForSession('goal_steer_session', {
    message: 'The delegated inspection found the completion path.',
    source: 'background_spawn_completion',
    kind: 'background_agent_result',
    requiresWorkerResponse: true,
    backgroundAgentId: 'bg_contract_test',
    backgroundAgentState: 'completed',
  });
  assert.equal(backgroundResult.ok, true, backgroundResult.error);
  const consumedBackgroundResult = registry.consumePendingRuntimeSteersForSession('goal_steer_session');
  assert.equal(consumedBackgroundResult.length, 1);
  assert.equal(consumedBackgroundResult[0].kind, 'background_agent_result');
  assert.equal(consumedBackgroundResult[0].backgroundAgentId, 'bg_contract_test');
  assert.equal(consumedBackgroundResult[0].backgroundAgentState, 'completed');

  const internalWatchResult = registry.addPendingRuntimeSteerForSession('goal_steer_session', {
    message: 'The watched task completed; verify and report it now.',
    source: 'internal_watch_completion',
    kind: 'internal_watch_result',
    requiresWorkerResponse: true,
    internalWatchId: 'watch_contract_test',
    internalWatchKind: 'match',
  });
  assert.equal(internalWatchResult.ok, true, internalWatchResult.error);
  const consumedInternalWatchResult = registry.consumePendingRuntimeSteersForSession('goal_steer_session');
  assert.equal(consumedInternalWatchResult.length, 1);
  assert.equal(consumedInternalWatchResult[0].kind, 'internal_watch_result');
  assert.equal(consumedInternalWatchResult[0].internalWatchId, 'watch_contract_test');
  assert.equal(consumedInternalWatchResult[0].internalWatchKind, 'match');

  const unrelatedRuntimeId = registry.registerLiveRuntime({
    kind: 'background_task',
    label: 'Non-chat steer rejection test',
    sessionId: 'goal_steer_session',
  });
  runtimeIds.push(unrelatedRuntimeId);
  assert.equal(
    registry.addPendingRuntimeSteer(unrelatedRuntimeId, {
      sessionId: 'goal_steer_session',
      message: 'This must be rejected.',
    }).ok,
    false,
  );

  const chatSource = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
  const backgroundRunnerSource = fs.readFileSync(path.join(root, 'src/gateway/tasks/task-runner.ts'), 'utf8');
  assert.match(backgroundRunnerSource, /queueBackgroundResultForForeground\(record\)/, 'background completion must queue a live foreground event');
  assert.match(chatSource, /steer\.kind === 'background_agent_result'/, 'foreground chat must recognize typed background-result events');
  assert.match(chatSource, /await injectPendingChatSteers\(\)/, 'the finalization race gate must drain live completion events before synthesis');
  const steerRoute = chatSource.slice(
    chatSource.indexOf("router.post('/api/chat/steer'"),
    chatSource.indexOf("router.get('/api/push/public-key'"),
  );
  assert.match(steerRoute, /isSteerableChatRuntimeKind\(runtime\.kind\)/, 'the HTTP steer route must target goal runtimes');

  const goalRunner = chatSource.slice(
    chatSource.indexOf('function startMainChatGoalRunner'),
    chatSource.indexOf('export function resumeMainChatGoalsInterruptedForRestart'),
  );
  assert.match(goalRunner, /channelLabel \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'steer'/, 'a displayed steer must not suppress goal continuation');
  assert.match(goalRunner, /workflowPart \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'interruption'/, 'steer workflow history must not mutate goal continuation state');

  const desktopSource = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
  assert.match(desktopSource, /isActiveMainGoalRunning\(thisSessionId\)/, 'the desktop goal composer must retain its live-steer path');
  assert.match(desktopSource, /source: 'web_goal_composer'/, 'desktop goal steers must remain identifiable in history');

  console.log('main-chat goal steer contract: ok');
} finally {
  for (const runtimeId of runtimeIds) registry.finishLiveRuntime(runtimeId);
  fs.rmSync(testRoot, { recursive: true, force: true });
}
