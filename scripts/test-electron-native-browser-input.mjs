import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeKey, normalizeSteps, runSteps } = require('../electron/native-browser-input.js');
for (const [input, accelerator, code, vk] of [
  ['ArrowUp', 'Up', 'ArrowUp', 38], ['ArrowDown', 'Down', 'ArrowDown', 40],
  ['ArrowLeft', 'Left', 'ArrowLeft', 37], ['ArrowRight', 'Right', 'ArrowRight', 39],
  [' ', 'Space', 'Space', 32], ['a', 'A', 'KeyA', 65], ['F12', 'F12', 'F12', 123],
]) {
  const normalized = normalizeKey(input);
  assert.equal(normalized.accelerator, accelerator);
  assert.equal(normalized.code, code);
  assert.equal(normalized.vk, vk);
}
for (const bad of ['ArrowNothing', 'Control+Q', '', '💩', 'A'.repeat(50)]) assert.throws(() => normalizeKey(bad));
for (const bad of [
  { action: 'key', key: 'ArrowUp', holdMs: 5001 },
  { action: 'key', keys: ['a', 'b', 'c', 'd', 'e'] },
  { action: 'key', keys: ['a', 'a'] },
  { action: 'sequence', sequence: Array.from({ length: 3 }, () => ({ key: 'x', holdMs: 4000 })) },
  { action: 'sequence', sequence: [] },
]) assert.throws(() => normalizeSteps(bad));
let events = [];
const steps = normalizeSteps({ action: 'key', sequence: [
  { keys: ['Control', 'a'], holdMs: 2 }, { waitMs: 2 }, { key: 'ArrowUp', holdMs: 2 },
] });
assert.equal(steps[1].keys.length, 0);
assert.equal(steps[1].delayMs, 2);
assert.equal(await runSteps(steps, async (type, key) => events.push(`${type}:${key.code}`)), 3);
assert.deepEqual(events, ['keyDown:ControlLeft', 'keyDown:KeyA', 'keyUp:KeyA', 'keyUp:ControlLeft', 'keyDown:ArrowUp', 'keyUp:ArrowUp']);
events = [];
await assert.rejects(runSteps(steps, async (type, key) => {
  events.push(`${type}:${key.code}`);
  if (type === 'keyDown' && key.code === 'KeyA') throw new Error('Injected dispatch failure');
}), /Injected dispatch failure/);
assert.deepEqual(events, ['keyDown:ControlLeft', 'keyDown:KeyA', 'keyUp:KeyA', 'keyUp:ControlLeft']);
const controller = new AbortController();
events = [];
const running = runSteps(normalizeSteps({ action: 'key', keys: ['Control', 'a'], holdMs: 5000 }), async (type, key) => {
  events.push(`${type}:${key.code}`);
  if (type === 'keyDown' && key.code === 'KeyA') controller.abort();
}, controller.signal);
await assert.rejects(running, /cancelled/);
assert.deepEqual(events.slice(-2), ['keyUp:KeyA', 'keyUp:ControlLeft']);
console.log('Electron native browser input tests passed (normalization, bounds, chord, failure/cancel release).');
