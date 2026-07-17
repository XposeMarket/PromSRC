import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prometheus-goal-restart-'));
process.env.PROMETHEUS_DATA_DIR = path.join(testRoot, 'data');
process.env.PROMETHEUS_WORKSPACE_DIR = path.join(testRoot, 'workspace');

const goals = read('src/gateway/main-chat-goals.ts');
const chat = read('src/gateway/routes/chat.router.ts');
const chatHelpers = read('src/gateway/chat/chat-helpers.ts');
const boot = read('src/gateway/boot.ts');
const lifecycle = read('src/gateway/lifecycle.ts');
const startup = read('src/gateway/core/startup.ts');
const mobile = read('web-ui/src/mobile/mobile-pages.js');

assert.match(goals, /status: 'restarting'/, 'restart interruption must use the restarting state');
assert.match(goals, /phase: 'boot_finalized'/, 'BOOT must be able to finalize the restart checkpoint');
assert.match(goals, /Restart recovery checkpoint:/, 'recovered goal prompt must carry the checkpoint');
assert.match(goals, /Before doing substantive work, call declare_plan/, 'the first autonomous Goal turn must declare a durable plan');
assert.match(goals, /checkpointPlanId/, 'restart recovery must prefer the checkpoint-owned plan');
assert.match(goals, /ACTIVE GOAL EXECUTION CONTRACT:/, 'Prometheus must receive the active Goal ownership contract');
assert.match(goals, /completeMainChatGoalFromOwner/, 'Prometheus must own explicit Goal completion');
const ownerCompletionStart = goals.indexOf('export async function completeMainChatGoalFromOwner');
const ownerCompletionEnd = goals.indexOf('export function blockMainChatGoalFromOwner', ownerCompletionStart);
const ownerCompletion = goals.slice(ownerCompletionStart, ownerCompletionEnd);
assert.doesNotMatch(ownerCompletion, /judgeMainChatGoal|completionVerificationEnabled/, 'complete_goal must never call the legacy Goal Judge or another LLM');
assert.match(goals, /recordMainChatGoalContinuationBoundary/, 'normal code must own continuation decisions');
assert.match(goals, /recordActiveMainChatGoalsInterruptedForRestart/, 'active goals must be checkpointed even between live runner turns');
assert.match(goals, /flushSession\(sessionId\)/, 'restart goal checkpoints must be flushed synchronously before process exit');
assert.match(goals, /maxIterations/, 'goal loop must have an iteration safety budget');
assert.match(lifecycle, /recordActiveMainChatGoalsInterruptedForRestart\(restartTrigger\)/, 'graceful restart must checkpoint active goals before runtime shutdown');

assert.doesNotMatch(startup, /resumeMainChatGoalsInterruptedForRestart\(\)/, 'early startup must not race BOOT by resuming goals');
assert.match(boot, /goalOwnedRestart/, 'BOOT must recognize a goal-owned restart');
assert.match(boot, /finalizeMainChatGoalRestartRecovery/, 'BOOT must finalize goal restart ownership');
assert.match(boot, /resumableGoalSessionIds/, 'BOOT must return the exact goal-owned sessions it finalized');
assert.match(chatHelpers, /after startup recovery finalization/, 'goal runner must resume only after planned or crash recovery finalization');
assert.match(chatHelpers, /_resumeMainChatGoalsAfterBoot\?\.\(/, 'post-BOOT goal resume must use the injected runtime callback');
assert.doesNotMatch(chatHelpers, /require\('\.\.\/routes\/chat\.router'\)/, 'post-BOOT resume must not depend on a fragile circular dynamic require');
assert.match(chat, /resumeMainChatGoalsAfterBoot: \(sessionIds\) => resumeMainChatGoalsInterruptedForRestart\(sessionIds\)/, 'chat router must inject the targeted post-BOOT resumer');
assert.match(chat, /goalTurnId/, 'goal turns must have stable persisted identity');
assert.match(chat, /name: 'complete_goal'/, 'Goal turns must expose complete_goal');
assert.match(chat, /required: \['note', 'steps_taken'\]/, 'complete_goal must require only a completion note and steps taken');
assert.match(chat, /name: 'block_goal'/, 'Goal turns must expose block_goal');
assert.match(chat, /recordMainChatGoalContinuationBoundary/, 'runner must use the deterministic continuation gate');
assert.match(chat, /checkpointPhase === 'boot_finalized'/, 'post-BOOT resume must trust the durable checkpoint phase even when the context reason is manual');
assert.match(chat, /turnOwnsActiveGoal && progressState\.source === 'declared'/, 'declared plans must attach to an active Goal even outside the synthetic prompt route');
assert.match(chat, /broadcastMainChatGoalState\(sessionId, 'plan_updated'/, 'persisted plan changes must refresh desktop and mobile Goal pills immediately');
assert.match(chat, /goal\.restartCheckpoint\?\.activeStepIndex/, 'restart recovery must restore the checkpointed active plan step');
assert.match(chat, /Synthetic Goal prompts are runtime control input, not user-authored chat/, 'internal Goal prompts must not be persisted as visible user messages');
assert.match(chat, /Gateway restarted — goal continuing\./, 'restart recovery must emit only a compact lifecycle notice');
assert.match(chat, /goalRestartCheckpointId/, 'restart lifecycle notices must deduplicate by checkpoint identity');
assert.match(chat, /PROGRESS_LIFECYCLE_TOOLS/, 'Goal lifecycle tools must not append synthetic work-plan steps');
assert.match(goals, /Superseded by Prometheus owner completion/, 'owner completion must close stale plan bookkeeping');
const runnerStart = chat.indexOf('function startMainChatGoalRunner');
const runnerEnd = chat.indexOf('export function resumeMainChatGoalsInterruptedForRestart', runnerStart);
const runner = chat.slice(runnerStart, runnerEnd);
assert.doesNotMatch(runner, /judgeMainChatGoal|applyMainChatGoalJudgeResult/, 'runner must not invoke an LLM judge after every turn');

assert.match(mobile, /_mobileMessagesRepresentSameTurn/, 'mobile hydration must match exact turns');
assert.doesNotMatch(mobile, /if \(localLatest && nextLatest\) \{\s*_mergeMobileAssistantTurnDetails\(nextLatest, localLatest\)/, 'mobile must not blindly merge latest assistant turns');
assert.match(mobile, /goal_command_ack/, 'mobile must protect the static goal acknowledgement');
assert.match(mobile, /goal_restart_checkpoint/, 'mobile must preserve restart checkpoint cards');
assert.match(mobile, /isLegacyGoalRuntimePrompt/, 'mobile hydration must sanitize previously persisted internal Goal prompts');

const require = createRequire(import.meta.url);
const goalRuntime = require('../dist/gateway/main-chat-goals.js');
const sessions = require('../dist/gateway/session.js');
const sessionId = `goal_restart_contract_${Date.now()}`;

try {
  const started = goalRuntime.handleMainChatGoalCommand(sessionId, '/goal verify exact restart plan continuity');
  assert.equal(started.goal?.status, 'active');
  const firstPrompt = goalRuntime.buildMainChatGoalContinuationPrompt(started.goal);
  assert.match(firstPrompt, /Before doing substantive work, call declare_plan/, 'new Goal prompt must require its initial plan');

  const planned = goalRuntime.recordMainChatGoalTurnPlanProgress(sessionId, {
    source: 'declared',
    activeIndex: 1,
    items: [
      { id: 'step_1', text: 'Inspect current state', status: 'done', note: 'inspection complete' },
      { id: 'step_2', text: 'Apply scoped source change', status: 'in_progress' },
      { id: 'step_3', text: 'Verify after restart', status: 'pending' },
    ],
  });
  const originalPlan = planned?.turnPlans?.[0];
  assert.ok(originalPlan?.id, 'declared Goal plan must persist');
  assert.equal(originalPlan.activeIndex, 1);

  const interrupted = goalRuntime.recordMainChatGoalInterruptedForRestart(sessionId, 'prom_apply_dev_changes', Date.now());
  assert.equal(interrupted?.status, 'restarting');
  assert.equal(interrupted?.restartCheckpoint?.planId, originalPlan.id, 'restart checkpoint must retain exact plan identity');
  assert.equal(interrupted?.restartCheckpoint?.activeStepIndex, 1, 'restart checkpoint must retain exact active step');
  assert.equal(interrupted?.turnPlans?.[0]?.steps?.[0]?.status, 'done', 'completed step state must survive checkpointing');
  assert.equal(interrupted?.turnPlans?.[0]?.steps?.[1]?.status, 'in_progress', 'active step state must survive checkpointing');

  sessions.updateMainChatGoal(sessionId, (goal) => ({
    ...goal,
    turnPlans: [
      ...(goal.turnPlans || []),
      {
        id: 'newer_decoy_plan',
        turnNumber: 99,
        status: 'in_progress',
        source: 'declared',
        activeIndex: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        steps: [
          { id: 'decoy_1', text: 'Wrong newer plan', status: 'in_progress' },
          { id: 'decoy_2', text: 'Wrong newer verification', status: 'pending' },
        ],
      },
    ],
  }));
  const checkpointOwnedPrompt = goalRuntime.buildMainChatGoalContinuationPrompt(sessions.getMainChatGoal(sessionId));
  assert.match(checkpointOwnedPrompt, /Apply scoped source change/, 'resume prompt must use checkpoint-owned plan');
  assert.doesNotMatch(checkpointOwnedPrompt, /Wrong newer plan/, 'a newer unrelated open plan must not steal restart ownership');
  assert.match(checkpointOwnedPrompt, /Do NOT call declare_plan at the start/, 'restart must resume rather than replace the stored plan');

  goalRuntime.finalizeMainChatGoalRestartRecovery(sessionId, { reason: 'prom_apply_dev_changes' });
  const resumed = goalRuntime.handleMainChatGoalCommand(sessionId, '/goal resume');
  assert.equal(resumed.goal?.status, 'active');
  assert.equal(resumed.goal?.restartCheckpoint?.phase, 'resuming');
  assert.equal(resumed.goal?.restartCheckpoint?.planId, originalPlan.id);
  assert.equal(resumed.goal?.restartCheckpoint?.activeStepIndex, 1);

  sessions.flushSession(sessionId);
  const durable = JSON.parse(fs.readFileSync(path.join(process.env.PROMETHEUS_DATA_DIR, '.prometheus', 'sessions', `${sessionId}.json`), 'utf8'));
  assert.equal(durable.mainChatGoal.restartCheckpoint.planId, originalPlan.id, 'flushed session must durably retain plan identity');
  assert.equal(durable.mainChatGoal.restartCheckpoint.activeStepIndex, 1, 'flushed session must durably retain active step');
  assert.equal(durable.mainChatGoal.turnPlans[0].steps[1].status, 'in_progress', 'flushed session must durably retain step state');

  const ownerCompletion = await goalRuntime.completeMainChatGoalFromOwner(sessionId, resumed.goal.id, {
    note: 'The verified objective is complete despite stale checklist bookkeeping.',
    stepsTaken: ['Built the deliverable', 'Verified the deliverable'],
  });
  assert.equal(ownerCompletion.accepted, true, 'Prometheus owner completion must override open plan items');
  assert.equal(ownerCompletion.goal.status, 'done');
  assert.equal(ownerCompletion.goal.turnPlans[0].status, 'complete');
  assert.equal(ownerCompletion.goal.turnPlans[0].activeIndex, -1);
  assert.equal(ownerCompletion.goal.turnPlans[0].steps[1].status, 'skipped', 'stale active step must close as superseded');

  const blockedSessionId = `${sessionId}_blocked`;
  const blockStarted = goalRuntime.handleMainChatGoalCommand(blockedSessionId, '/goal verify genuine blocker plan state');
  goalRuntime.recordMainChatGoalTurnPlanProgress(blockedSessionId, {
    source: 'declared', activeIndex: 0, items: [
      { text: 'Attempt available work', status: 'in_progress' },
      { text: 'Verify after external access returns', status: 'pending' },
    ],
  });
  const blocked = goalRuntime.blockMainChatGoalFromOwner(blockedSessionId, blockStarted.goal.id, {
    reason: 'Required external system is unavailable.',
    missingRequirement: 'External system access must return.',
    attemptedAlternatives: ['Verified local fallback cannot satisfy the request.'],
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.turnPlans[0].status, 'blocked', 'a genuine blocker must close the active plan as blocked');
  const ownerClosed = goalRuntime.handleMainChatGoalCommand(blockedSessionId, '/goal done Completed after owner review.');
  assert.equal(ownerClosed.goal.status, 'done');
  assert.equal(ownerClosed.goal.blockedReason, undefined, 'owner closeout must clear stale blocker state');
  assert.equal(ownerClosed.goal.nextStepDirective, undefined, 'owner closeout must clear stale blocker directives');
  assert.equal(ownerClosed.goal.turnPlans[0].status, 'complete');
  assert.equal(ownerClosed.goal.turnPlans[0].activeIndex, -1);
  assert.equal(ownerClosed.goal.turnPlans[0].steps[0].status, 'skipped', 'owner closeout must supersede residual open steps');
  sessions.deleteSession(blockedSessionId);

  console.log('main-chat goal restart contract: ok');
} finally {
  sessions.deleteSession(sessionId);
  fs.rmSync(testRoot, { recursive: true, force: true });
}
