import assert from 'node:assert/strict';
import { isLiveRestartOwnerStatus } from './restart-owner';

// Finished tasks bound to a chat must not swallow the chat's restart continuation.
assert.equal(isLiveRestartOwnerStatus('complete'), false, 'complete task must not own a chat restart');
assert.equal(isLiveRestartOwnerStatus('failed'), false, 'failed task must not own a chat restart');
assert.equal(isLiveRestartOwnerStatus(' complete '), false, 'status is trimmed');
// Live or resumable tasks still own their restart lifecycle.
for (const status of ['running', 'queued', 'paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'waiting_subagent']) {
  assert.equal(isLiveRestartOwnerStatus(status), true, `${status} task keeps restart ownership`);
}
// Unknown status keeps the historical task-owned behaviour.
assert.equal(isLiveRestartOwnerStatus(undefined), true);
console.log('restart owner regression passed');
