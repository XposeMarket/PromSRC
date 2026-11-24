import assert from 'node:assert/strict';
import { applyMobileMainPlanProgress, finalizeMobileMainPlan } from '../web-ui/src/mobile/mobile-plan-finalize.js';
import { parseHTML } from 'linkedom';

const { window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { createMobileChatRendererRuntime } = await import('../web-ui/src/mobile/mobile-chat-renderer-runtime.js');

// Exercise the actual renderer boundary, not only the extracted reducer.
const chat = { activeSessionId: 'paused' };
const normalizeStatus = (status) => status === 'active' ? 'in_progress' : status;
const renderer = createMobileChatRendererRuntime({ __pmChat: chat, __pmRealtimeAgent: {}, wsEventBus: { on() {} }, _mobileGoalStepStatus: normalizeStatus });
const paused = { source: 'declared', reason: 'usage_limit_paused', items: [{ label: ' Keep step ', status: 'active' }, { text: 'Next', status: 'pending' }] };
const state = renderer._applyMobileMainPlanProgress(paused);
assert.equal(state, chat.mainPlanProgress.paused);
assert.equal(state.usageLimitPaused, true);
assert.deepEqual(state.items, [{ text: 'Keep step', status: 'in_progress' }, { text: 'Next', status: 'pending' }]);
assert.equal(state.activeIndex, 0);
assert.equal(state.total, 2);
await finalizeMobileMainPlan(chat, 'paused', async () => ({ stream: { progressState: paused } }), renderer._applyMobileMainPlanProgress, () => {});
assert.deepEqual(state.items.map((item) => item.status), ['in_progress', 'pending']);
renderer._applyMobileMainPlanProgress({ ...paused, reason: 'resumed', activeIndex: 1, total: 3 });
assert.equal(state.usageLimitPaused, false);
assert.equal(state.activeIndex, 1);
assert.equal(state.total, 3);
state.open = true;
assert.equal(applyMobileMainPlanProgress(state, { source: 'inferred', items: paused.items }, normalizeStatus), state);
assert.deepEqual(state, { usageLimitPaused: false, items: [], activeIndex: -1, total: 0, open: false });

function fixture(usageLimitPaused = false) {
  let resolve;
  const chat = { threads: { a: [{ role: 'user', _clientRequestId: 'old' }] }, activeRuns: { a: { clientRequestId: 'old' } }, mainPlanProgress: { a: { usageLimitPaused, items: [{ text: 'OLD TURN', status: 'in_progress' }] } } };
  const apply = (progress, sid) => { chat.mainPlanProgress[sid].items = progress.items.map((item) => ({ ...item })); };
  const pending = finalizeMobileMainPlan(chat, 'a', () => new Promise((done) => { resolve = done; }), apply, () => {});
  return { chat, pending, resolve: () => resolve({ stream: { progressState: { source: 'declared', items: [{ text: 'OLD TURN (server)', status: 'done' }] } } }) };
}
let f = fixture(true);
assert.equal(f.chat.mainPlanProgress.a.items[0].status, 'in_progress', 'do not check off the interrupted step while awaiting replay');
f.resolve(); await f.pending;
f = fixture();
assert.equal(f.chat.mainPlanProgress.a.items[0].status, 'done', 'local finalization still works');
f.chat.threads.a.push({ role: 'user', _clientRequestId: 'new' });
f.chat.activeRuns.a = { clientRequestId: 'new' };
f.chat.mainPlanProgress.a.items = [{ text: 'NEW TURN', status: 'in_progress' }];
f.resolve();
await f.pending;
assert.deepEqual(f.chat.mainPlanProgress.a.items, [{ text: 'NEW TURN', status: 'in_progress' }], 'old replay cannot overwrite new turn');
f = fixture();
f.resolve();
await f.pending;
assert.deepEqual(f.chat.mainPlanProgress.a.items, [{ text: 'OLD TURN (server)', status: 'done' }], 'matching replay still finalizes and reconciles server state');
f = fixture();
f.chat.mainPlanProgress.a.items = [{ text: 'NEW PLAN', status: 'in_progress' }];
f.resolve();
await f.pending;
assert.equal(f.chat.mainPlanProgress.a.items[0].text, 'NEW PLAN', 'new plan generation alone rejects old replay');
console.log('mobile plan finalize regression passed');
