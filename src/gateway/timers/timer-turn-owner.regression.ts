import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readChatRouterSource } from '../../testing/chat-router-source';

const root = process.cwd();
const router = readChatRouterSource();
const runner = fs.readFileSync(path.join(root, 'src/gateway/timers/timer-runner.ts'), 'utf8');
// findSessionMainChatRuntime moved out of the chat router into the stream store.
const streamStore = fs.readFileSync(path.join(root, 'src/gateway/chat/main-chat-stream-store.ts'), 'utf8');

// 1. A runtime mirrored from a draining gateway must never be adopted as the
//    owner of a new turn in this process (it disappears when that gateway exits,
//    and the owner watchdog then kills the turn as runtime_missing).
const finderStart = streamStore.indexOf('function findSessionMainChatRuntime');
const finderEnd = streamStore.indexOf('function finishMainChatStreamAsOrphaned');
assert.ok(finderStart >= 0 && finderEnd > finderStart, 'findSessionMainChatRuntime must exist in main-chat-stream-store.ts');
const finder = streamStore.slice(finderStart, finderEnd);
assert.match(finder, /remoteHostPid/, 'findSessionMainChatRuntime must skip mirrored (remoteHostPid) runtimes');

// 2. System-caused stops must not be saved under the hidden "Restart Context Packet" text.
assert.match(router, /const userCancelled = \/\^User cancelled\/i\.test\(abortCause\)/);
assert.match(router, /This turn was stopped by the gateway, not by you\./);

// 3. An aborted timer turn is recorded as failed, not as a silent "completed".
assert.match(runner, /if \(abortSignal\.aborted\) \{[\s\S]*?throw new Error\(`Timer turn was interrupted/);

// 4. The runner claims a timer for this process before running it, and does not
//    run one it failed to claim (cancelled, or already running in another gateway).
const fire = runner.slice(runner.indexOf('private async fireTimer'), runner.indexOf('const firedUserMessage'));
assert.match(fire, /if \(!claimMainChatTimerForRun\(timer\.id, firedAt\)\) return;/, 'fireTimer must claim the timer and stop when the claim fails');
assert.ok(
  fire.indexOf('claimMainChatTimerForRun(') < fire.indexOf('this.runningTimerId = timer.id'),
  'the claim must come before this process records the timer as its running one',
);
assert.doesNotMatch(runner, /updateMainChatTimer\(timer\.id, \{ status: 'running'/, 'marking a timer running must go through the owner-stamping claim');

console.log('timer-turn-owner regression: ok');
