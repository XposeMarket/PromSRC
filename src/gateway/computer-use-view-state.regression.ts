import assert from 'node:assert/strict';
import {
  ComputerUseViewTracker,
  classifyComputerUseTool,
  extractComputerUseCursor,
} from './computer-use-view-state';

assert.equal(classifyComputerUseTool('read_file'), null, 'ordinary tools must not activate the computer viewer');

assert.deepEqual(classifyComputerUseTool('browser_click', { ref: '@12' }), {
  source: 'browser',
  hostControl: false,
  pointerAction: true,
  frameRecommended: true,
});
assert.equal(classifyComputerUseTool('browser_wait', {})?.frameRecommended, false);

assert.equal(classifyComputerUseTool('desktop_background', { action: 'click' })?.desktopMode, 'sandbox');
assert.equal(classifyComputerUseTool('desktop_background', { action: 'click' })?.hostControl, false,
  'sandbox desktop activity must never light the host-control overlay');
assert.equal(classifyComputerUseTool('desktop_input', { action: 'click', x: 20, y: 30 })?.hostControl, true);
assert.equal(classifyComputerUseTool('desktop_screen', { action: 'screenshot' })?.hostControl, false,
  'watching/capturing the host is not the same as controlling it');

assert.deepEqual(extractComputerUseCursor('browser_vision_click', { x: 120, y: 240 }, 1000), {
  x: 120,
  y: 240,
  kind: 'pointer',
  updatedAt: 1000,
});
assert.deepEqual(extractComputerUseCursor('desktop_input', { action: 'drag', to_coordinate: [500, 600] }, 1100), {
  x: 500,
  y: 600,
  kind: 'drag-end',
  updatedAt: 1100,
});
assert.equal(extractComputerUseCursor('browser_press_key', { key: 'Enter' }, 1200), null,
  'keyboard-only actions must preserve the previous pointer instead of inventing a new one');

const tracker = new ComputerUseViewTracker();
assert.equal(tracker.beginToolCall({
  sessionId: 'session-a',
  callId: 'tool-read',
  toolName: 'read_file',
  now: 2000,
}), null, 'viewer state begins only on an actual browser/desktop tool call');

let state = tracker.beginToolCall({
  sessionId: 'session-a',
  callId: 'browser-1',
  toolName: 'browser_vision_click',
  args: { x: 44, y: 55 },
  now: 2100,
});
assert.equal(state?.active, true);
assert.equal(state?.preferredSource, 'browser');
assert.deepEqual(state?.browser?.cursor, { x: 44, y: 55, kind: 'pointer', updatedAt: 2100 });

state = tracker.beginToolCall({
  sessionId: 'session-a',
  callId: 'browser-2',
  toolName: 'browser_press_key',
  args: { key: 'Enter' },
  now: 2200,
});
assert.deepEqual(state?.browser?.cursor, { x: 44, y: 55, kind: 'pointer', updatedAt: 2100 },
  'the visible software cursor must stay at the last pointer interaction');
assert.equal(state?.browser?.activeCalls.length, 2);

state = tracker.finishToolCall({ sessionId: 'session-a', callId: 'browser-1', now: 2300 });
assert.equal(state?.active, true, 'viewer remains active while another browser/desktop call is still running');
state = tracker.finishToolCall({ sessionId: 'session-a', callId: 'browser-2', now: 2400 });
assert.equal(state?.active, false, 'viewer becomes inactive after the final relevant call finishes');
assert.deepEqual(state?.browser?.cursor, { x: 44, y: 55, kind: 'pointer', updatedAt: 2100 },
  'cursor history remains available for a grace-period/frozen last frame');

state = tracker.beginToolCall({
  sessionId: 'session-a',
  callId: 'desktop-host',
  toolName: 'desktop_input',
  args: { action: 'click', x: 700, y: 300 },
  now: 2500,
});
assert.equal(state?.desktop?.desktopMode, 'host');
assert.equal(state?.desktop?.hostControl, true);
assert.equal(state?.preferredSource, 'desktop');

state = tracker.beginToolCall({
  sessionId: 'session-a',
  callId: 'desktop-shot',
  toolName: 'desktop_screen',
  args: { action: 'screenshot' },
  now: 2550,
});
assert.equal(state?.desktop?.hostControl, true,
  'a concurrent screenshot must not clear an existing host-control indicator');
state = tracker.finishToolCall({ sessionId: 'session-a', callId: 'desktop-host', now: 2600 });
assert.equal(state?.desktop?.hostControl, false,
  'host-control indicator ends when the last controlling call ends, even if read-only capture remains');
assert.equal(state?.active, true);

state = tracker.settleSession('session-a', 2700);
assert.equal(state?.active, false);
assert.equal(state?.desktop?.activeCalls.length, 0);
assert.equal(state?.browser?.activeCalls.length, 0);

tracker.resetSession('session-a');
assert.equal(tracker.get('session-a'), null);

console.log('computer-use live-view state contract passed');
