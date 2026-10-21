import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeBusyComposerMode,
  shouldAutoSteerBusyTurn,
  setCachedBusyComposerMode,
  getCachedBusyComposerMode,
  loadBusyComposerModeFromServer,
} from './busy-composer-mode.js';

// normalize: only exact 'steer' is steer; everything else is queue.
assert.equal(normalizeBusyComposerMode('steer'), 'steer');
assert.equal(normalizeBusyComposerMode('queue'), 'queue');
assert.equal(normalizeBusyComposerMode('STEER'), 'queue');
assert.equal(normalizeBusyComposerMode(' steer '), 'queue');
assert.equal(normalizeBusyComposerMode(undefined), 'queue');
assert.equal(normalizeBusyComposerMode(null), 'queue');
assert.equal(normalizeBusyComposerMode(''), 'queue');

// shouldAutoSteer: true only for steer + busy + not a queued replay.
assert.equal(shouldAutoSteerBusyTurn({ mode: 'steer', sessionBusy: true, isQueuedReplay: false }), true);
assert.equal(shouldAutoSteerBusyTurn({ mode: 'steer', sessionBusy: true }), true);
// Queue mode never auto-steers.
assert.equal(shouldAutoSteerBusyTurn({ mode: 'queue', sessionBusy: true, isQueuedReplay: false }), false);
assert.equal(shouldAutoSteerBusyTurn({ mode: undefined, sessionBusy: true }), false);
// Idle chat never auto-steers.
assert.equal(shouldAutoSteerBusyTurn({ mode: 'steer', sessionBusy: false, isQueuedReplay: false }), false);
// Queued replay never auto-steers.
assert.equal(shouldAutoSteerBusyTurn({ mode: 'steer', sessionBusy: true, isQueuedReplay: true }), false);
assert.equal(shouldAutoSteerBusyTurn(), false);

// cache: stores normalized values only.
assert.equal(setCachedBusyComposerMode('steer'), 'steer');
assert.equal(getCachedBusyComposerMode(), 'steer');
assert.equal(setCachedBusyComposerMode('bogus'), 'queue');
assert.equal(getCachedBusyComposerMode(), 'queue');

// load: reads GET body, and falls back to the cached value on error.
const mode = await loadBusyComposerModeFromServer(async (url) => {
  assert.equal(url, '/api/settings/session');
  return { session: { busyComposerMode: 'steer' } };
});
assert.equal(mode, 'steer');
assert.equal(getCachedBusyComposerMode(), 'steer');
const fallback = await loadBusyComposerModeFromServer(async () => { throw new Error('offline'); });
assert.equal(fallback, 'steer');

// Source-level guard: in the busy/queue branch, the existing queue bookkeeping
// (composer clear, queued-panel refresh) must run BEFORE the steer call, so the
// composer clears after send in both modes. Regressions here were the P0 bugs.
const here = dirname(fileURLToPath(import.meta.url));
const desktopSrc = readFileSync(resolve(here, 'desktop-send-chat-runtime.js'), 'utf8');
const mobileSrc = readFileSync(resolve(here, '../../../mobile/mobile-chat-page-runtime.js'), 'utf8');

function assertBefore(src, steerNeedle, queueNeedle, requiredCalls, label) {
  const steerIdx = src.indexOf(steerNeedle);
  assert.ok(steerIdx > 0, `${label}: steer call not found (${steerNeedle})`);
  const queueIdx = src.lastIndexOf(queueNeedle, steerIdx);
  assert.ok(queueIdx > 0, `${label}: queue branch anchor not found before steer call`);
  const branch = src.slice(queueIdx, steerIdx);
  for (const call of requiredCalls) {
    assert.ok(branch.includes(call), `${label}: ${call} must run in the busy branch before the steer call`);
  }
}

assertBefore(
  desktopSrc,
  'await window.steerQueuedPrompt(',
  'sessionQueue.push(makeQueuedChatTurn(',
  ['addProcessEntry(', 'clearChatComposerAfterSend(', 'updateQueuedPromptUI(', 'releaseChatSendLock('],
  'desktop',
);
assertBefore(
  mobileSrc,
  'await window.__pmSteerMobileQueuedPrompt(',
  'queue.push(_makeMobileQueuedPrompt(',
  ['resetComposerInput()', '_pmClearActiveSlashCommand(', '_renderMobileQueuedPromptsPanel('],
  'mobile',
);

console.log('busy-composer-mode tests passed');
