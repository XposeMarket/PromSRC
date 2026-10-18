import assert from 'node:assert/strict';
import { finalizeMobileMainPlan } from '../web-ui/src/mobile/mobile-plan-finalize.js';

function fixture() {
  let resolve;
  const chat = { threads: { a: [{ role: 'user', _clientRequestId: 'old' }] }, activeRuns: { a: { clientRequestId: 'old' } }, mainPlanProgress: { a: { items: [{ text: 'OLD TURN', status: 'in_progress' }] } } };
  const apply = (progress, sid) => { chat.mainPlanProgress[sid].items = progress.items.map((item) => ({ ...item })); };
  const pending = finalizeMobileMainPlan(chat, 'a', () => new Promise((done) => { resolve = done; }), apply, () => {});
  return { chat, pending, resolve: () => resolve({ stream: { progressState: { source: 'declared', items: [{ text: 'OLD TURN (server)', status: 'done' }] } } }) };
}
let f = fixture();
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
