import assert from 'node:assert/strict';
import {
  ComputerUseViewTracker,
  classifyComputerUseTool,
  extractComputerUseCursor,
} from './computer-use-view-state';

assert.equal(classifyComputerUseTool('read_file'), null, 'ordinary tools must not activate computer-use live view');

const browser = classifyComputerUseTool('browser_click', { ref: '@7' });
assert.equal(browser?.source, 'browser');
assert.equal(browser?.hostControl, false);

const desktopClick = classifyComputerUseTool('desktop_click', { x: 100, y: 200 });
assert.equal(desktopClick?.source, 'desktop');
assert.equal(desktopClick?.desktopMode, 'host');
assert.equal(desktopClick?.hostControl, true);
assert.equal(desktopClick?.pointerAction, true);

const desktopShot = classifyComputerUseTool('desktop_screenshot');
assert.equal(desktopShot?.source, 'desktop');
assert.equal(desktopShot?.hostControl, false, 'a screenshot is view activity, not host control');

const sandbox = classifyComputerUseTool('desktop_background', { action: 'click', x: 10, y: 20 });
assert.equal(sandbox?.desktopMode, 'sandbox');
assert.equal(sandbox?.hostControl, false, 'sandbox actions must never claim host control');

assert.deepEqual(
  extractComputerUseCursor('desktop_drag', { from_x: 1, from_y: 2, to_x: 90, to_y: 91 }, 1234),
  { x: 90, y: 91, kind: 'drag-end', updatedAt: 1234 },
);
assert.equal(extractComputerUseCursor('desktop_type', { text: 'hi' }), null);

const tracker = new ComputerUseViewTracker();
assert.equal(tracker.get('s1'), null);

let state = tracker.beginToolCall({
  sessionId: 's1',
  callId: 'c1',
  toolName: 'desktop_click',
  args: { x: 320, y: 240 },
  now: 100,
});
assert.equal(state?.active, true);
assert.equal(state?.desktop?.active, true);
assert.equal(state?.desktop?.hostControl, true);
assert.deepEqual(state?.desktop?.cursor, { x: 320, y: 240, kind: 'pointer', updatedAt: 100 });

state = tracker.beginToolCall({
  sessionId: 's1',
  callId: 'c2',
  toolName: 'desktop_type',
  args: { text: 'hello' },
  now: 110,
});
assert.deepEqual(state?.desktop?.cursor, { x: 320, y: 240, kind: 'pointer', updatedAt: 100 }, 'typing keeps the last pointer position');
assert.equal(state?.desktop?.activeCalls.length, 2);

state = tracker.finishToolCall({ sessionId: 's1', callId: 'c1', now: 120 });
assert.equal(state?.desktop?.active, true, 'overlapping relevant calls keep viewer active');
assert.equal(state?.desktop?.activeCalls.length, 1);

state = tracker.finishToolCall({ sessionId: 's1', callId: 'c2', now: 130 });
assert.equal(state?.active, false);
assert.equal(state?.desktop?.active, false);
assert.deepEqual(state?.desktop?.cursor, { x: 320, y: 240, kind: 'pointer', updatedAt: 100 }, 'cursor remains persisted after calls settle');

state = tracker.beginToolCall({
  sessionId: 's1',
  callId: 'b1',
  toolName: 'browser_open',
  args: { url: 'https://example.com' },
  now: 140,
});
assert.equal(state?.active, true);
assert.equal(state?.preferredSource, 'browser');
assert.equal(state?.browser?.active, true);

state = tracker.settleSession('s1', 150);
assert.equal(state?.active, false);
assert.equal(state?.browser?.active, false);
assert.equal(state?.desktop?.active, false);

console.log('[computer-use-view-state] activation, host/sandbox control, cursor persistence, overlap, and settle semantics passed');
