'use strict';

const KEY_ALIASES = Object.freeze({ ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Del: 'Delete', Control: 'Control', Ctrl: 'Control', Meta: 'Meta', Cmd: 'Meta', Return: 'Enter', '+': 'Plus', '-': 'Minus', '_': 'Minus', Hyphen: 'Minus', Dash: 'Minus', Subtract: 'Minus', '=': 'Equal', Equals: 'Equal', ',': 'Comma', '.': 'Period', Dot: 'Period', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', Apostrophe: 'Quote', '`': 'Backquote', Backtick: 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' });
const SPECIAL = Object.freeze({ Up: ['ArrowUp', 'ArrowUp', 38], Down: ['ArrowDown', 'ArrowDown', 40], Left: ['ArrowLeft', 'ArrowLeft', 37], Right: ['ArrowRight', 'ArrowRight', 39], Space: [' ', 'Space', 32], Enter: ['Enter', 'Enter', 13], Escape: ['Escape', 'Escape', 27], Tab: ['Tab', 'Tab', 9], Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46], Home: ['Home', 'Home', 36], End: ['End', 'End', 35], PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34], Insert: ['Insert', 'Insert', 45], Shift: ['Shift', 'ShiftLeft', 16], Control: ['Control', 'ControlLeft', 17], Alt: ['Alt', 'AltLeft', 18], Meta: ['Meta', 'MetaLeft', 91], Plus: ['+', 'Equal', 187], Minus: ['-', 'Minus', 189], Equal: ['=', 'Equal', 187], Comma: [',', 'Comma', 188], Period: ['.', 'Period', 190], Slash: ['/', 'Slash', 191], Backslash: ['\\', 'Backslash', 220], Semicolon: [';', 'Semicolon', 186], Quote: ["'", 'Quote', 222], Backquote: ['`', 'Backquote', 192], BracketLeft: ['[', 'BracketLeft', 219], BracketRight: [']', 'BracketRight', 221] });
function normalizeKey(value) {
  if (typeof value !== 'string' || !value || value.length > 40) throw new Error('Invalid browser key.');
  const name = KEY_ALIASES[value] || value;
  if (SPECIAL[name]) { const [key, code, vk] = SPECIAL[name]; return { accelerator: name, key, code, vk }; }
  if (/^[a-zA-Z]$/.test(name)) return { accelerator: name.toUpperCase(), key: name, code: `Key${name.toUpperCase()}`, vk: name.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(name)) return { accelerator: name, key: name, code: `Digit${name}`, vk: name.charCodeAt(0) };
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(name)) { const n = Number(name.slice(1)); return { accelerator: name, key: name, code: name, vk: 111 + n }; }
  throw new Error(`Invalid browser key ${JSON.stringify(value)}.`);
}
function boundedMs(value, max) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Input duration must be an integer from 0 to ${max}ms.`);
  return value;
}
function normalizeSteps(payload = {}) {
  const raw = payload.sequence !== undefined ? payload.sequence : [{ keys: payload.keys || [payload.key || 'Enter'], holdMs: payload.holdMs }];
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) throw new Error('Input sequence needs 1–32 steps.');
  let total = 0;
  const steps = raw.map((step) => {
    if (!step || typeof step !== 'object') throw new Error('Invalid input sequence step.');
    const keys = step.keys || (step.key ? [step.key] : []);
    const waitOnly = !keys.length && step.waitMs !== undefined;
    if (!Array.isArray(keys) || keys.length > 4 || (!keys.length && !waitOnly)) throw new Error('Input chord needs 1–4 keys or a waitMs-only step.');
    const normalized = keys.map(normalizeKey);
    if (new Set(normalized.map(k => k.accelerator)).size !== normalized.length) throw new Error('Duplicate key in chord.');
    const holdMs = boundedMs(step.holdMs, 5000);
    const delayMs = boundedMs(step.waitMs ?? step.delayMs, 5000);
    total += holdMs + delayMs;
    return { keys: normalized, holdMs, delayMs };
  });
  if (total > 10000) throw new Error('Input sequence cannot exceed 10000ms.');
  return steps;
}
function sleepOrCancel(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Browser input cancelled.'));
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => { clearTimeout(timer); reject(new Error('Browser input cancelled.')); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
// release is attempted even when dispatch/down, sleep, navigation or cancellation throws.
async function runSteps(steps, dispatch, signal) {
  let count = 0;
  for (const step of steps) {
    if (signal?.aborted) throw new Error('Browser input cancelled.');
    const held = [];
    try {
      for (const key of step.keys) { held.push(key); await dispatch('keyDown', key); }
      await sleepOrCancel(step.holdMs, signal);
    } finally {
      for (const key of held.reverse()) { try { await dispatch('keyUp', key); } catch {} }
    }
    count++;
    await sleepOrCancel(step.delayMs, signal);
  }
  return count;
}
module.exports = { normalizeKey, normalizeSteps, runSteps };
