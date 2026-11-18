// Regression: the mobile tool-progress pill must clear when its tool finishes
// under a wrapper name, and retire itself when no clearing event ever arrives.
import assert from 'node:assert/strict';
import {
  MOBILE_TOOL_PROGRESS_STALE_MS,
  clearMobileToolProgressState,
  readMobileToolProgressState,
  setMobileToolProgressState,
} from '../web-ui/src/mobile/mobile-tool-progress-state.js';

const progress = { action: 'process_wait', toolCallId: 'call_1', message: 'Working', show_pill: true };

// Events that do not ask for a pill, or carry no text, store nothing.
{
  const store = {};
  assert.equal(setMobileToolProgressState(store, 's1', { ...progress, show_pill: false }), false);
  assert.equal(setMobileToolProgressState(store, 's1', { ...progress, message: '  ' }), false);
  assert.equal(setMobileToolProgressState(store, '', progress), false);
  assert.deepEqual(store, {});
}

// The reported bug: progress as process_wait, result as workspace_run.
{
  const store = {};
  assert.equal(setMobileToolProgressState(store, 's1', progress, 1000), true);
  assert.equal(store.s1.toolCallId, 'call_1');
  // Name mismatch alone still refuses (a different tool finishing must not clear it)...
  assert.equal(clearMobileToolProgressState(store, 's1', 'workspace_run'), false);
  assert.equal(clearMobileToolProgressState(store, 's1', 'workspace_run', 'call_other'), false);
  assert.ok(store.s1);
  // ...but the same call id clears it despite the wrapper name.
  assert.equal(clearMobileToolProgressState(store, 's1', 'workspace_run', 'call_1'), true);
  assert.equal(store.s1, undefined);
}

// Matching name and unconditional clears keep working; snake_case id is accepted.
{
  const store = {};
  setMobileToolProgressState(store, 's1', { action: 'web_fetch', tool_call_id: 'c2', message: 'Fetching', show_pill: true });
  assert.equal(store.s1.toolCallId, 'c2');
  assert.equal(clearMobileToolProgressState(store, 's1', 'web_fetch'), true);
  setMobileToolProgressState(store, 's1', progress);
  assert.equal(clearMobileToolProgressState(store, 's1'), true);
  assert.equal(clearMobileToolProgressState(store, 's1'), false);
}

// No clearing event at all: the pill survives while fresh, then retires.
{
  const store = {};
  setMobileToolProgressState(store, 's1', progress, 1000);
  assert.equal(readMobileToolProgressState(store, 's1', 1000 + MOBILE_TOOL_PROGRESS_STALE_MS)?.message, 'Working');
  assert.equal(readMobileToolProgressState(store, 's1', 1001 + MOBILE_TOOL_PROGRESS_STALE_MS), undefined);
  assert.equal(store.s1, undefined);
  assert.equal(readMobileToolProgressState(store, 'missing'), undefined);
}

// Progress ticks every 15s, so a working tool must never look stale.
assert.ok(MOBILE_TOOL_PROGRESS_STALE_MS >= 30000);

console.log('mobile tool progress state regression passed.');
