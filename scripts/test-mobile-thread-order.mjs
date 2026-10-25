#!/usr/bin/env node
// Mobile thread ordering contract: delivery_send rows vs the streaming turn,
// and recovered live rows vs older history. Pure helpers, no DOM.
import assert from 'node:assert/strict';
import {
  buildMobileDeliveryPaintPlan,
  isMobileDeliveryRow,
  mobileDeliverySplitMessage,
  orderMobileTurnDeliveries,
  repairMobileLiveRowPlacement,
} from '../web-ui/src/mobile/mobile-thread-order.js';

const ids = (list) => list.map((m) => m.id);
const user = (id, ts, req = '') => ({ id, role: 'user', timestamp: ts, _clientRequestId: req, body: { text: id } });
const ai = (id, ts, extra = {}) => ({ id, role: 'ai', timestamp: ts, body: { text: '' }, ...extra });
const delivery = (id, ts) => ({ id, role: 'ai', timestamp: ts, messageKind: 'delivery', channelLabel: 'delivery', messageId: `delivery_${id}`, body: { text: '' } });
const entries = (list) => list.map((msg, i) => ({ msg, key: `k:${msg.id}`, originalIndex: i, signature: msg.id }));
const paint = (list) => buildMobileDeliveryPaintPlan(entries(list)).map(({ entry, part }) => `${entry.msg.id}${part === 'full' ? '' : `:${part}`}`);
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

test('isMobileDeliveryRow recognises messageKind or channelLabel', () => {
  assert.equal(isMobileDeliveryRow(delivery('d', 1)), true);
  assert.equal(isMobileDeliveryRow({ role: 'ai', channelLabel: 'delivery' }), true);
  assert.equal(isMobileDeliveryRow(ai('a', 1)), false);
  assert.equal(isMobileDeliveryRow({ role: 'user', messageKind: 'delivery' }), false);
});

test('(1) streaming turn + delivery -> delivery renders after the live trace', () => {
  // History refresh anchored the server [user, delivery] next to the painted
  // prompt, i.e. above the still-streaming assistant row.
  const live = ai('live', 2000, { streaming: true, liveTraceEntries: [{ id: 't1' }] });
  const list = [user('u0', 100), ai('a0', 200, { body: { text: 'old' } }), user('u1', 1000, 'r1'), delivery('d1', 1500), delivery('d2', 1600), live];
  orderMobileTurnDeliveries(list);
  assert.deepEqual(ids(list), ['u0', 'a0', 'u1', 'live', 'd1', 'd2']);
  // Later tool events (re-reconcile) must not move it back above/inside.
  live.liveTraceEntries.push({ id: 't2' });
  orderMobileTurnDeliveries(list);
  assert.deepEqual(ids(list), ['u0', 'a0', 'u1', 'live', 'd1', 'd2']);
  assert.deepEqual(paint(list), ['u0', 'a0', 'u1', 'live', 'd1', 'd2'], 'no answer text yet -> no split');
});

test('(2) after final -> trace, deliveries (send order), final text', () => {
  const final = ai('turn', 2000, { streaming: false, _pmFinalReceived: true, body: { text: 'Done.' }, processEntries: [{ id: 't1' }] });
  // Reload order from the gateway: delivery persisted before the final row.
  const list = [user('u1', 1000, 'r1'), delivery('d1', 1500), delivery('d2', 1600), final];
  orderMobileTurnDeliveries(list);
  assert.deepEqual(ids(list), ['u1', 'turn', 'd1', 'd2']);
  assert.deepEqual(paint(list), ['u1', 'turn:trace', 'd1', 'd2', 'turn:answer']);
  const tracePart = mobileDeliverySplitMessage(final, 'trace');
  const answerPart = mobileDeliverySplitMessage(final, 'answer');
  assert.equal(tracePart.body.text, '');
  assert.deepEqual(tracePart.processEntries, final.processEntries);
  assert.equal(answerPart.body.text, 'Done.');
  assert.equal(answerPart.suppressWorkTimer, true);
  assert.equal(answerPart.processEntries, undefined);
  assert.equal(final.body.text, 'Done.', 'split never mutates the source row');
});

test('older-turn delivery is never pulled into a newer turn', () => {
  const list = [user('u1', 1000, 'r1'), delivery('dOld', 500), ai('a1', 1100, { body: { text: 'x' } })];
  orderMobileTurnDeliveries(list);
  assert.deepEqual(ids(list), ['u1', 'dOld', 'a1']);
});

test('(3) recovered live row with timestamp 0 goes after its user prompt, not index 0', () => {
  const live = ai('live', 0, { streaming: true, _clientRequestId: 'r2' });
  const list = [live, user('u0', 100, 'r0'), ai('a0', 200, { body: { text: 'old' } }), user('u1', 1000, 'r2'), user('u2', 5000, 'r3')];
  repairMobileLiveRowPlacement(list);
  assert.deepEqual(ids(list), ['u0', 'a0', 'u1', 'live', 'u2']);
});

test('(3b) recovered live row with no owner and missing timestamp goes to the end', () => {
  const live = ai('live', undefined, { streaming: true });
  const list = [live, user('u0', 100), ai('a0', 200, { body: { text: 'old' } }), user('u1', 1000)];
  repairMobileLiveRowPlacement(list);
  assert.deepEqual(ids(list), ['u0', 'a0', 'u1', 'live']);
});

test('(3c) stale duplicate live row is folded into the owner segment row', () => {
  const stale = ai('stale', 0, { streaming: true, _clientRequestId: 'r1' });
  const fresh = ai('fresh', 1100, { streaming: true, _clientRequestId: 'r1' });
  const merged = [];
  const list = [stale, user('u0', 100), ai('a0', 200, { body: { text: 'old' } }), user('u1', 1000, 'r1'), fresh];
  repairMobileLiveRowPlacement(list, { merge: (target, source) => merged.push([target.id, source.id]) });
  assert.deepEqual(ids(list), ['u0', 'a0', 'u1', 'fresh']);
  assert.deepEqual(merged, [['fresh', 'stale']]);
});

test('steer: live continuation above a newer steer prompt is left in place', () => {
  const list = [user('u1', 1000, 'r1'), ai('frozen', 1100, { _steerFrozenTrace: true, streaming: true }), user('steer', 3000), ai('cont', 0, { streaming: true })];
  repairMobileLiveRowPlacement(list);
  assert.deepEqual(ids(list), ['u1', 'frozen', 'steer', 'cont']);
  const list2 = [user('u1', 1000), ai('live', 1100, { streaming: true }), user('queued', 3000)];
  repairMobileLiveRowPlacement(list2);
  assert.deepEqual(ids(list2), ['u1', 'live', 'queued']);
});

test('negative: no deliveries / correct order -> unchanged', () => {
  const list = [user('u0', 100, 'r0'), ai('a0', 200, { body: { text: 'a' } }), user('u1', 1000, 'r1'), ai('a1', 1100, { streaming: true, _clientRequestId: 'r1', body: { text: 'partial' } })];
  const before = ids(list);
  orderMobileTurnDeliveries(list);
  repairMobileLiveRowPlacement(list);
  assert.deepEqual(ids(list), before);
  assert.deepEqual(paint(list), before);
});

console.log(`\n${passed} mobile thread-order tests passed`);
