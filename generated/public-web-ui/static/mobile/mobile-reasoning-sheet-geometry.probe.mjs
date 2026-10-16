import assert from 'node:assert/strict';
import { reasoningSheetViewportPlacement } from './mobile-reasoning-sheet-geometry.js';

const normal = reasoningSheetViewportPlacement({
  visualViewport: { offsetTop: 0, height: 844 },
  layoutHeight: 844,
  triggerRect: { top: 704, bottom: 748 },
});
assert.equal(normal.anchor, 'above');
assert.equal(normal.bottom, 148);
assert.equal(normal.maxHeight, 686);

const keyboard = reasoningSheetViewportPlacement({
  visualViewport: { offsetTop: 0, height: 390 },
  layoutHeight: 844,
  triggerRect: { top: 302, bottom: 346 },
});
assert.equal(keyboard.anchor, 'above');
assert.equal(keyboard.bottom, 550);
assert.equal(keyboard.maxHeight, 284);

const header = reasoningSheetViewportPlacement({
  visualViewport: { offsetTop: 0, height: 844 },
  layoutHeight: 844,
  triggerRect: { top: 20, bottom: 64 },
});
assert.equal(header.anchor, 'below');
assert.equal(header.bottom, 10);
assert.equal(header.maxHeight, 762);

console.log(JSON.stringify({ normal, keyboard, header }));
