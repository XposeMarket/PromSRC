import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAdaptiveStreamScheduler } from '../web-ui/src/features/chat/timeline/adaptive-stream-scheduler.js';

// Exercise the focus lifecycle without opening a real socket or starting liveness timers.
const wsSource = readFileSync(new URL('../web-ui/src/ws.js', import.meta.url), 'utf8');
const windowRef = new EventTarget();
const documentRef = new EventTarget();
documentRef.hidden = false;
documentRef.body = { classList: { contains: () => false } };
windowRef.activeChatSessionId = 'one';
const sent = [];
windowRef.ws = { readyState: 1, send: (text) => sent.push(JSON.parse(text)) };
const timers = new Map();
let nextId = 0;
const context = vm.createContext({
  window: windowRef, document: documentRef, WebSocket: { OPEN: 1 },
  wsEventBus: { on() {} },
  setInterval: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
  clearInterval: (id) => timers.delete(id),
});
vm.runInContext(wsSource.slice(wsSource.indexOf("let _wsStreamFocusSent = '';"), wsSource.indexOf('// Expose on window', wsSource.indexOf("let _wsStreamFocusSent = '';"))).replace('export function', 'function'), context);
assert.equal(timers.size, 1);
assert.equal([...timers.values()][0].ms, 15000);
assert.equal(sent.length, 1);
[...timers.values()][0].fn();
assert.equal(sent.length, 1, 'unchanged focus must not send again');
windowRef.__promSidePaneSuspended = true;
windowRef.dispatchEvent(new Event('prometheus:pane-activity'));
assert.equal(timers.size, 0, 'suspended pane has no focus polling timer');
windowRef.activeChatSessionId = 'two';
windowRef.__promSidePaneSuspended = false;
windowRef.dispatchEvent(new Event('prometheus:pane-activity'));
assert.equal(sent.at(-1).sessionIds[0], 'two', 'resume synchronizes immediately');
documentRef.hidden = true;
documentRef.dispatchEvent(new Event('visibilitychange'));
assert.equal(timers.size, 0);

// Clock timers exist only for visible, active documents containing clocks.
const cardSource = readFileSync(new URL('../web-ui/src/cards/card-runtime.js', import.meta.url), 'utf8');
let clocksExist = false;
let ticks = 0;
windowRef.__promSidePaneSuspended = false;
documentRef.hidden = false;
documentRef.querySelector = () => clocksExist ? {} : null;
context.tickClocks = () => ticks++;
vm.runInContext('let clockTimer = null;\n' + cardSource.slice(cardSource.indexOf('function syncClockTimer()'), cardSource.indexOf('/** Hydrate anything')), context);
vm.runInContext('syncClockTimer()', context);
assert.equal(timers.size, 0);
clocksExist = true;
vm.runInContext('syncClockTimer()', context);
assert.equal(timers.size, 1);
assert.equal(ticks, 1);
documentRef.hidden = true;
vm.runInContext('syncClockTimer()', context);
assert.equal(timers.size, 0);
documentRef.hidden = false;
vm.runInContext('syncClockTimer()', context);
clocksExist = false;
[...timers.values()][0].fn();
assert.equal(timers.size, 0, 'removing the last clock stops ticking');

// Suspended rendering retains the newest paint, including structural flushes.
globalThis.window = new EventTarget();
globalThis.window.__promSidePaneSuspended = true;
const pending = new Map();
let timerId = 0;
const scheduler = createAdaptiveStreamScheduler({
  documentRef: new EventTarget(), now: () => 100,
  setTimer: (fn) => { pending.set(++timerId, fn); return timerId; },
  clearTimer: (id) => pending.delete(id), requestFrame: (fn) => fn(),
});
const paints = [];
scheduler.schedule('chat', () => paints.push('old'));
scheduler.flush('chat', () => paints.push('latest'));
assert.equal(pending.size, 0);
assert.deepEqual(paints, []);
globalThis.window.__promSidePaneSuspended = false;
globalThis.window.dispatchEvent(new Event('prometheus:pane-activity'));
assert.deepEqual(paints, ['latest']);
scheduler.destroy();
delete globalThis.window;

console.log('PASS: focus lifecycle, clock timer gating, and suspended stream rendering');
