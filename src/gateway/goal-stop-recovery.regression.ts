import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../config/config';
import { handleMainChatGoalCommand, finalizeMainChatGoalCrashRecovery, canAutomaticallyResumeMainChatGoal } from './main-chat-goals';
import { getMainChatGoal, updateMainChatGoal, flushSession } from './session';
import { registerLiveRuntime, finishLiveRuntime } from './live-runtime-registry';
import { MainChatTimerRunner } from './timers/timer-runner';
import { createMainChatTimer, listMainChatTimers, updateMainChatTimer } from './timers/timer-store';

async function main(): Promise<void> {
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-stop-recovery-'));
const config = getConfig();
const originalDir = config.getConfigDir;
config.getConfigDir = () => dir;
try {
  const sessionId = `goal-stop-${Date.now()}`;
  const started = handleMainChatGoalCommand(sessionId, '/goal Verify the pending changes');
  assert.equal(started.goal?.status, 'active');
  const runtimeId = registerLiveRuntime({ kind: 'main_chat_goal', sessionId, label: 'Regression goal', abortSignal: { aborted: false } });
  const continuation = createMainChatTimer({ sessionId, instruction: 'Verify the pending changes', dueAt: new Date(0) });
  assert.equal(continuation.origin?.goalId, started.goal!.id, 'Goal runtime timers must get durable ownership automatically');
  finishLiveRuntime(runtimeId);
  const reminder = createMainChatTimer({ sessionId, instruction: 'Drink water', dueAt: new Date(0) });
  updateMainChatGoal(sessionId, goal => ({ ...goal!, restartCheckpoint: { phase: 'boot_finalized', reason: 'gateway_restart', createdAt: Date.now(), turnNumber: 1 } as any }));
  handleMainChatGoalCommand(sessionId, '/goal pause Stop right now');
  const timers = listMainChatTimers({ sessionId, includeDone: true });
  assert.equal(timers.find(timer => timer.id === continuation.id)?.status, 'cancelled', 'User stop must cancel goal continuation timer');
  assert.equal(timers.find(timer => timer.id === reminder.id)?.status, 'pending', 'Ordinary reminder must survive');
  updateMainChatTimer(continuation.id, { status: 'completed' });
  assert.equal(listMainChatTimers({ sessionId, includeDone: true }).find(timer => timer.id === continuation.id)?.status, 'cancelled', 'Late completion must not undo cancellation');
  assert.ok(getMainChatGoal(sessionId)?.userStoppedAt, 'Stop must survive normalization');
  flushSession(sessionId);
  assert.equal(canAutomaticallyResumeMainChatGoal(getMainChatGoal(sessionId)), false);
  finalizeMainChatGoalCrashRecovery(sessionId);
  assert.equal(getMainChatGoal(sessionId)?.status, 'paused', 'Crash recovery must not overwrite user stop');
  assert.equal(canAutomaticallyResumeMainChatGoal(getMainChatGoal(sessionId)), false);
  let fired = 0;
  const runner = new MainChatTimerRunner({ runInteractiveTurn: async () => { fired++; return { type: 'text', text: 'ok' }; } });
  const stale = createMainChatTimer({ sessionId, instruction: 'Verify stale work', dueAt: new Date(0), origin: { goalId: started.goal!.id } });
  await (runner as any).fireTimer(stale);
  assert.equal(fired, 0, 'Stopped goal timer must not invoke a turn');
  await (runner as any).fireTimer(reminder);
  assert.equal(fired, 1, 'Ordinary reminder must still fire');
  const resumed = handleMainChatGoalCommand(sessionId, '/goal resume');
  assert.equal(resumed.goal?.status, 'active', 'Explicit resume must work');
  assert.equal(resumed.goal?.userStoppedAt, undefined);
  assert.equal(canAutomaticallyResumeMainChatGoal(resumed.goal), true);
  const newTimer = createMainChatTimer({ sessionId, instruction: 'Verify resumed work', dueAt: new Date(0), origin: { goalId: started.goal!.id } });
  await (runner as any).fireTimer(newTimer);
  assert.equal(fired, 2, 'Explicit resume permits new continuation timer');
  console.log('goal-stop-recovery regression PASS');
} finally {
  config.getConfigDir = originalDir;
  fs.rmSync(dir, { recursive: true, force: true });
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
