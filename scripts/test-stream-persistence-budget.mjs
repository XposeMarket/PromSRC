import assert from 'node:assert/strict';
import { createSessionPersistenceScheduler, attachSessionPersistenceLifecycle } from '../web-ui/src/features/chat/core/session-persistence-scheduler.js';

let now = 0;
let nextId = 0;
const timers = new Map();
const writes = [];
const scheduler = createSessionPersistenceScheduler({
  save: () => writes.push(now),
  setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, due: now + ms }); return id; },
  clearTimer: (id) => timers.delete(id),
  now: () => now,
  delayMs: 750,
  backgroundDelayMs: 4000,
});
function advance(ms) {
  const end = now + ms;
  while (true) {
    const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
    if (!next || next[1].due > end) break;
    now = next[1].due;
    timers.delete(next[0]);
    next[1].fn();
  }
  now = end;
}
for (let i = 0; i < 3000; i++) { scheduler.schedule({ background: true }); advance(7); }
assert.ok(writes.length <= 6, `background stream wrote ${writes.length} times in 21s`);
for (let i = 1; i < writes.length; i++) assert.ok(writes[i] - writes[i - 1] >= 500, 'synchronous full save within 500ms');
const beforeDone = writes.length;
scheduler.flush();
assert.equal(writes.length, beforeDone + 1, 'done flushes dirty data synchronously');
scheduler.schedule();
scheduler.flush();
assert.equal(writes.length, beforeDone + 2, 'pagehide flushes dirty data synchronously');
advance(10000);
assert.equal(writes.length, beforeDone + 2, 'flush cancels pending timers');
const windowEvents = new Map(), documentEvents = new Map();
let expectedLifecycleWrites = writes.length;
attachSessionPersistenceLifecycle({ addEventListener: (name, fn) => windowEvents.set(name, fn) },
  { hidden: true, addEventListener: (name, fn) => documentEvents.set(name, fn) }, scheduler.flush);
for (const [name, listener] of [['pagehide', windowEvents.get('pagehide')],
  ['beforeunload', windowEvents.get('beforeunload')], ['visibilitychange', documentEvents.get('visibilitychange')]]) {
  scheduler.schedule(); listener();
  assert.equal(writes.length, ++expectedLifecycleWrites, `${name} flushes pending save`);
}
console.log(`stream persistence budget PASS (${beforeDone} background writes / 21 seconds; done + pagehide flush)`);
