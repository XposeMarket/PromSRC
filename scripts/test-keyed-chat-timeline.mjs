import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  allocateTimelinePaneBudgets,
  chatTimelineRowSignature,
  chatTurnRenderWeight,
  createTimelineEntries,
  createWeightedTimelineController,
} from '../web-ui/src/features/chat/timeline/weighted-timeline.js';
import { reconcileKeyedTimelinePanes, reconcileKeyedTimelineRows } from '../web-ui/src/features/chat/timeline/keyed-dom.js';
import { createAdaptiveStreamScheduler } from '../web-ui/src/features/chat/timeline/adaptive-stream-scheduler.js';
import { createDesktopTimelineView } from '../web-ui/src/features/chat/timeline/desktop-timeline-view.js';

function messages(count, { rich = false } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `turn-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    timestamp: 1_700_000_000_000 + index,
    content: `turn ${index} ${'x'.repeat(rich && index % 9 === 0 ? 2_800 : 40)}`,
    liveTraceEntries: rich && index % 7 === 0
      ? Array.from({ length: 8 }, (__, toolIndex) => ({ id: `${index}:${toolIndex}`, type: 'tool_result' }))
      : [],
    generatedImages: rich && index % 23 === 0 ? [{ id: `image-${index}` }] : [],
    approvalRequest: rich && index % 41 === 0 ? { id: `approval-${index}`, status: 'pending' } : null,
  }));
}

{
  const windowRef = { activeChatSessionId: 'nav', chatMessagesUserScrolledUp: false };
  const view = createDesktopTimelineView({ windowRef, runtimeFor: () => null });
  const source = Array.from({ length: 500 }, (_, index) => ({ originalIndex: index }));
  const sampled = view.navigatorEntries(source);
  assert.equal(sampled.length, 120, 'message navigation must not reintroduce an unbounded parallel DOM');
  assert.equal(sampled[0], source[0], 'bounded navigation must retain the oldest range endpoint');
  assert.equal(sampled.at(-1), source.at(-1), 'bounded navigation must retain the newest range endpoint');
}

{
  const plain = messages(1_200);
  const entries = createTimelineEntries(plain);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 1_200, 'turn keys must be unique');
  assert.equal(entries[10].key, 'id:turn-10', 'explicit runtime identity must win');
  assert.equal(chatTurnRenderWeight(plain[10]), 1, 'plain short turns should use one unit');
  assert.ok(chatTurnRenderWeight(messages(50, { rich: true })[0]) > 5, 'rich turns must consume more render weight');

  const desktop = createWeightedTimelineController({ surface: 'desktop' });
  const desktopTail = desktop.select('desktop', entries, { followTail: true });
  assert.equal(desktopTail.paintEntries.length, 96, 'desktop plain DOM budget must be exact and bounded');
  assert.equal(desktopTail.materializedEntries.length, 180, 'desktop state materialization must exceed paint budget');
  assert.equal(desktopTail.lastPaintIndex, 1_199, 'tail mode must retain the newest turn');

  const mobile = createWeightedTimelineController({ surface: 'mobile' });
  const mobileTail = mobile.select('mobile', entries, { followTail: true });
  assert.equal(mobileTail.paintEntries.length, 52, 'mobile DOM must retain fewer rows than desktop');
  assert.equal(mobileTail.materializedEntries.length, 92, 'mobile materialization and paint budgets must be distinct');

  const hidden = desktop.select('hidden', entries, { followTail: true, hidden: true });
  assert.equal(hidden.paintEntries.length, 26, 'hidden transcripts must use the reduced paint budget');
  assert.equal(hidden.materializedEntries.length, 48, 'hidden transcripts must use the reduced materialization budget');

  const firstKey = entries[0].key;
  const pinned = desktop.select('pinned', entries, { followTail: true, pinnedKeys: new Set([firstKey]) });
  assert.ok(pinned.paintEntries.some((entry) => entry.key === firstKey), 'a selected row must stay painted outside the normal window');
  assert.ok(pinned.omittedBefore > 0, 'selection pinning must not hide the earlier-history control');

  assert.equal(desktop.stepEarlier('desktop', entries), true, 'stepped backfill must move into loaded history');
  const older = desktop.select('desktop', entries);
  assert.ok(older.omittedAfter > 0, 'stepped backfill must release newer paint rows instead of growing forever');
  assert.ok(older.estimatedDomRows <= 96, 'stepped backfill must stay bounded');

  desktop.focusIndex('desktop', entries, 500);
  const focused = desktop.select('desktop', entries);
  assert.ok(focused.paintEntries.some((entry) => entry.key === entries[500].key), 'search/navigation focus must materialize the requested row');
  assert.ok(focused.omittedBefore > 0 && focused.omittedAfter > 0, 'focused rows should receive before/after slack');

  const paneBudgets = allocateTimelinePaneBudgets([{ key: 'main' }, { key: 'side' }], {
    surface: 'desktop', focusedKey: 'main',
  });
  assert.ok(paneBudgets.main.paintWeight > paneBudgets.side.paintWeight, 'focused pane must receive the larger share');
  assert.ok(paneBudgets.main.paintWeight + paneBudgets.side.paintWeight <= 96, 'pane paint budgets must share one global cap');
  const hiddenPanes = allocateTimelinePaneBudgets([{ key: 'main' }, { key: 'side' }], { surface: 'desktop', hidden: true });
  assert.ok(hiddenPanes.main.paintWeight + hiddenPanes.side.paintWeight <= 26, 'hidden panes must share the reduced global cap');
}

{
  const base = { messageId: 'stable', role: 'assistant', content: 'alpha', liveTraceEntries: [] };
  assert.equal(chatTimelineRowSignature(base), chatTimelineRowSignature({ ...base }), 'equivalent rows need stable signatures');
  assert.notEqual(chatTimelineRowSignature(base), chatTimelineRowSignature({ ...base, content: 'beta' }), 'text changes must revise a row');
  assert.notEqual(
    chatTimelineRowSignature(base),
    chatTimelineRowSignature({ ...base, liveTraceEntries: [{ id: 'tool-1', status: 'done' }] }),
    'tool transitions must revise a row',
  );
}

{
  const { document } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>');
  const root = document.getElementById('root');
  root.innerHTML = '<article data-chat-row-key="a" data-chat-row-signature="1"><details open><summary>A</summary></details></article><article data-chat-row-key="b" data-chat-row-signature="1">B</article>';
  const rowA = root.children[0];
  const rowB = root.children[1];
  const stats = reconcileKeyedTimelineRows(root, '<article data-chat-row-key="a" data-chat-row-signature="1"><details><summary>A replacement that must not commit</summary></details></article><article data-chat-row-key="b" data-chat-row-signature="2">B2</article><article data-chat-row-key="c" data-chat-row-signature="1">C</article>');
  assert.equal(root.children[0], rowA, 'unchanged keyed rows must retain DOM identity');
  assert.equal(root.children[1], rowB, 'changed keyed rows must retain their outer shell');
  assert.equal(rowA.querySelector('details').hasAttribute('open'), true, 'unrelated updates must preserve disclosure state');
  assert.equal(root.children[1].textContent, 'B2', 'only the changed row content should commit');
  assert.deepEqual({ created: stats.created, updated: stats.updated, reused: stats.reused }, { created: 1, updated: 1, reused: 1 });
  const removal = reconcileKeyedTimelineRows(root, '<article data-chat-row-key="a" data-chat-row-signature="1"><details open><summary>A</summary></details></article><article data-chat-row-key="c" data-chat-row-signature="1">C</article>');
  assert.equal(removal.removed, 1, 'rows outside the paint window must leave the DOM');

  root.innerHTML = '<article data-chat-row-key="shift" data-chat-row-signature="1" data-msg-index="4"><button data-msg-index="4">Copy</button></article>';
  const shifted = reconcileKeyedTimelineRows(root, '<article data-chat-row-key="shift" data-chat-row-signature="1" data-msg-index="24"><button data-msg-index="24">Copy</button></article>');
  assert.equal(shifted.updated, 1, 'cursor prepends must refresh index-bearing row controls');
  assert.equal(root.querySelector('button').getAttribute('data-msg-index'), '24');
}

{
  const { document } = parseHTML('<!doctype html><html><body><main id="split"><section data-chat-pane-key="main"><header class="side-chat-pane-header">Main</header><div class="side-chat-main-messages"><article data-chat-row-key="settled" data-chat-row-signature="1">settled</article><article data-chat-row-key="live" data-chat-row-signature="1">one</article></div></section><section data-chat-pane-key="side"><header class="side-chat-header">Side</header><div class="side-chat-messages"><article data-chat-row-key="side-row" data-chat-row-signature="1">side</article></div></section></main></body></html>');
  const root = document.getElementById('split');
  const mainPane = root.children[0];
  const settled = root.querySelector('[data-chat-row-key="settled"]');
  const applied = reconcileKeyedTimelinePanes(root, '<section data-chat-pane-key="main"><header class="side-chat-pane-header">Main renamed</header><div class="side-chat-main-messages"><article data-chat-row-key="settled" data-chat-row-signature="1">settled</article><article data-chat-row-key="live" data-chat-row-signature="2">two</article></div></section><section data-chat-pane-key="side"><header class="side-chat-header">Side</header><div class="side-chat-messages"><article data-chat-row-key="side-row" data-chat-row-signature="1">side</article></div></section>');
  assert.equal(applied, true, 'matching split panes must reconcile without a shell rebuild');
  assert.equal(root.children[0], mainPane, 'split pane identity must remain stable');
  assert.equal(root.querySelector('[data-chat-row-key="settled"]'), settled, 'settled main rows must survive side-by-side stream updates');
  assert.equal(root.querySelector('[data-chat-row-key="live"]').textContent, 'two');
}

class FakeDocument {
  constructor() { this.hidden = false; this.visibilityState = 'visible'; this.listeners = new Map(); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type) { for (const listener of this.listeners.get(type) || []) listener(); }
}

{
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const frames = [];
  const documentRef = new FakeDocument();
  const scheduler = createAdaptiveStreamScheduler({
    floorMs: 20,
    ceilingMs: 120,
    hiddenMs: 80,
    documentRef,
    now: () => clock,
    setTimer: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, due: clock + Number(delay || 0) }); return id; },
    clearTimer: (id) => timers.delete(id),
    requestFrame: (fn) => frames.push(fn),
  });
  const runTimer = () => {
    const next = [...timers.entries()].sort((left, right) => left[1].due - right[1].due)[0];
    assert.ok(next, 'expected a scheduled timer');
    timers.delete(next[0]);
    clock = Math.max(clock, next[1].due);
    next[1].fn();
  };
  const runFrame = (cost = 0) => { clock += cost; frames.shift()?.(clock); };

  const calls = [];
  scheduler.schedule('stream', () => calls.push('stale'));
  scheduler.schedule('stream', () => { calls.push('latest'); clock += 4; });
  runTimer();
  runFrame(6);
  assert.deepEqual(calls, ['latest'], 'queued token paints must coalesce to the newest task');
  assert.equal(scheduler.snapshot('stream').intervalMs, 26, 'cheap paints should settle near the responsive floor');

  scheduler.schedule('stream', () => { calls.push('costly'); clock += 55; });
  runTimer();
  runFrame(20);
  assert.ok(scheduler.snapshot('stream').intervalMs > 26, 'measured expensive paints must increase the interval');
  assert.ok(scheduler.snapshot('stream').intervalMs <= 120, 'adaptive delay must respect the latency cap');

  scheduler.schedule('stream', () => calls.push('structural'), { structural: true });
  assert.equal(calls.at(-1), 'structural', 'structural completion must flush synchronously');
  runFrame();

  documentRef.hidden = true;
  documentRef.visibilityState = 'hidden';
  scheduler.schedule('hidden', () => calls.push('hidden'));
  runTimer();
  runTimer();
  assert.equal(calls.at(-1), 'hidden', 'hidden documents must still receive bounded stream delivery');

  scheduler.schedule('visibility', () => calls.push('visible-flush'));
  documentRef.hidden = false;
  documentRef.visibilityState = 'visible';
  documentRef.emit('visibilitychange');
  assert.equal(calls.at(-1), 'visible-flush', 'visibility restoration must deliver pending output immediately');
  runFrame();
  scheduler.destroy();
}

console.log('Keyed weighted chat timeline behavioral tests passed.');
