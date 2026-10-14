import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../config/config';
import { handleMainChatGoalCommand } from './main-chat-goals';
import { getMainChatGoal, setMainChatGoal, updateMainChatGoal, flushSession } from './session';
import { registerLiveRuntime, finishLiveRuntime } from './live-runtime-registry';
import { createMainChatTimer, listMainChatTimers } from './timers/timer-store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-timer-cancel-'));
const config = getConfig();
const original = config.getConfigDir;
config.getConfigDir = () => dir;
try {
  for (const status of ['done', 'cleared', 'failed', 'removed'] as const) {
    const sessionId = `timer-cancel-${status}-${Date.now()}`;
    const started = handleMainChatGoalCommand(sessionId, '/goal Verify changes');
    const runtimeId = registerLiveRuntime({ kind: 'main_chat_goal', sessionId, label: 'Goal timer regression', abortSignal: { aborted: false } });
    const owned = createMainChatTimer({ sessionId, instruction: 'Final verify', fromGoalTurn: true, dueAt: new Date(0) });
    assert.equal(owned.origin?.goalId, started.goal!.id);
    const reminder = createMainChatTimer({ sessionId, instruction: 'User reminder', dueAt: new Date(0) });
    finishLiveRuntime(runtimeId);
    const continuedTurn = createMainChatTimer({ sessionId, instruction: 'Goal turn without live runtime', fromGoalTurn: true, dueAt: new Date(0) });
    assert.equal(continuedTurn.origin?.goalId, started.goal!.id);
    if (status === 'removed') setMainChatGoal(sessionId, null);
    else updateMainChatGoal(sessionId, goal => goal ? { ...goal, status } : null);
    const timers = listMainChatTimers({ sessionId, includeDone: true });
    assert.equal(timers.find(timer => timer.id === owned.id)?.status, 'cancelled', `${status} must cancel goal-owned timers immediately`);
    assert.equal(timers.find(timer => timer.id === continuedTurn.id)?.status, 'cancelled');
    assert.match(timers.find(timer => timer.id === owned.id)?.error || '', /goal (completed|cleared|failed)/);
    assert.equal(timers.find(timer => timer.id === reminder.id)?.status, 'pending', 'Unowned reminders must survive');
    assert.equal(getMainChatGoal(sessionId)?.status || 'removed', status);
    flushSession(sessionId);
  }
  console.log('goal-timer-cancel regression passed');
} finally {
  config.getConfigDir = original;
  fs.rmSync(dir, { recursive: true, force: true });
}
