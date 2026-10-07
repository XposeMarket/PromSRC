import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const router = fs.readFileSync(path.join(root, 'src/gateway/routes/chat.router.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'src/gateway/timers/timer-runner.ts'), 'utf8');

// 1. A runtime mirrored from a draining gateway must never be adopted as the
//    owner of a new turn in this process (it disappears when that gateway exits,
//    and the owner watchdog then kills the turn as runtime_missing).
const finder = router.slice(router.indexOf('function findSessionMainChatRuntime'), router.indexOf('function finishMainChatStreamAsOrphaned'));
assert.match(finder, /remoteHostPid/, 'findSessionMainChatRuntime must skip mirrored (remoteHostPid) runtimes');

// 2. System-caused stops must not be saved under the hidden "Restart Context Packet" text.
assert.match(router, /const userCancelled = \/\^User cancelled\/i\.test\(abortCause\)/);
assert.match(router, /This turn was stopped by the gateway, not by you\./);

// 3. An aborted timer turn is recorded as failed, not as a silent "completed".
assert.match(runner, /if \(abortSignal\.aborted\) \{[\s\S]*?throw new Error\(`Timer turn was interrupted/);

console.log('timer-turn-owner regression: ok');
