import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'web-ui/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web-ui/src/app.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'web-ui/src/pages/ChatPage.js'), 'utf8');
const emberBlock = html.match(/<script>\s*\/\*[^*]*Ember particle effect[^*]*\*\/\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/)?.[0];
assert.ok(emberBlock, 'find actual embers script');

function simulateEmbers({ enabled, mode = 'chat' }) {
  const listeners = new Map();
  const attributes = { 'data-background-visuals': enabled ? 'on' : 'off' };
  let framesRequested = 0, framesCanceled = 0, clears = 0;
  const callbacks = new Map();
  const canvas = { width: 0, height: 0, getContext: () => ({ clearRect: () => clears++, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, createRadialGradient: () => ({ addColorStop() {} }), fill() {}, arc() {} }) };
  const document = {
    hidden: false, readyState: 'complete',
    documentElement: { getAttribute: k => attributes[k] || (k === 'data-skin' ? 'dark' : ''), setAttribute: (k, v) => { attributes[k] = v; } },
    getElementById: id => id === 'ember-canvas' ? canvas : id === 'centerCol' ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 700, bottom: 700 }) } : null,
    addEventListener: (type, cb) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(cb); },
  };
  const window = {
    currentMode: mode, innerWidth: 1300, innerHeight: 900,
    addEventListener: (type, cb) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(cb); },
  };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe() {} }
  const context = { document, window, MutationObserver, Math, requestAnimationFrame: cb => { const id = ++framesRequested; callbacks.set(id, cb); return id; }, cancelAnimationFrame: id => { framesCanceled++; callbacks.delete(id); } };
  vm.runInNewContext(emberBlock.replace(/<script>|<\/script>/g, ''), context);
  const fire = type => listeners.get(type)?.forEach(cb => cb());
  const tick = () => { const batch = [...callbacks]; callbacks.clear(); batch.forEach(([, cb]) => cb(performance.now())); };
  return { window, document, fire, tick, counts: () => ({ requested: framesRequested, canceled: framesCanceled, pending: callbacks.size, clears }) };
}

// A disabled ember canvas must not schedule work on every animation frame.
const disabled = simulateEmbers({ enabled: false });
for (let i = 0; i < 120; i++) disabled.tick();
assert.equal(disabled.counts().requested, 0, 'disabled embers have zero rAF wakeups');
const offChat = simulateEmbers({ enabled: true, mode: 'teams' });
for (let i = 0; i < 120; i++) offChat.tick();
assert.equal(offChat.counts().requested, 0, 'non-chat view has zero rAF wakeups');
const active = simulateEmbers({ enabled: true });
assert.equal(active.counts().pending, 1, 'visible chat schedules a frame');
active.document.hidden = true;
active.fire('visibilitychange');
assert.equal(active.counts().pending, 0, 'hidden document cancels pending animation');
active.document.hidden = false;
active.fire('visibilitychange');
assert.equal(active.counts().pending, 1, 'visible document resumes animation');
active.window.currentMode = 'teams';
active.fire('prom-mode-change');
assert.equal(active.counts().pending, 0, 'navigating away cancels animation');
active.window.currentMode = 'chat';
active.fire('prom-mode-change');
assert.equal(active.counts().pending, 1, 'returning to chat resumes animation');

assert.match(app, /document\.dispatchEvent\(new CustomEvent\('prom-mode-change'/);
assert.match(chat, /dockOpen \? lanes\.map\(\(lane\) => \[/);
assert.match(chat, /const lazyClosedGroup = !streaming \|\| !isLiveCurrent;/);
assert.match(chat, /lazyClosedGroup && !openAttr && toolBodyEntries\.length/);
assert.match(chat, /\.join\('\|'\) : lanes\.length/);
assert.match(chat, /if \(sess\.activeRun === nextActiveRun\) return;/);
assert.match(chat, /if \(container && shouldFollow\) container\.scrollTop = container\.scrollHeight;/);
assert.doesNotMatch(chat.slice(chat.indexOf('function patchStreamingChatBubble('), chat.indexOf('function renderStreamingChatUpdate(')), /else container\.scrollTop = scrollTop/);
assert.match(chat, /backgroundSpawnDockOffsetFrame !== null \|\| document\.hidden/);
assert.match(chat, /if \(!document\.hidden && String\(window\.currentMode \|\| 'chat'\) === 'chat'\s*&& \(lane\.sessionId ===/);
assert.match(chat, /document\.addEventListener\('prom-mode-change', \(\) => scheduleBackgroundAgentUiUpdate/);
assert.match(chat, /if \(chatView\.style\.getPropertyValue\('--background-spawn-dock-bottom'\) !== value\)/);
console.log(JSON.stringify({ disabledRaf: disabled.counts().requested, offChatRaf: offChat.counts().requested, activeRaf: active.counts().requested, canceled: active.counts().canceled, checks: 11 }));
