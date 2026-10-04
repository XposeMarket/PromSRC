import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (await readFile(new URL('../web-ui/src/mobile/mobile-chat-page-runtime.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const { resolveKeyboardBandTop } = await import('../web-ui/src/mobile/mobile-keyboard-band.js');
assert.match(src, /import \{ resolveKeyboardBandTop, settleLoop \} from '\.\/mobile-keyboard-band\.js'/);

// Layout-relative rects (common iOS): band top is offsetTop, whatever the document scroll.
for (const scrollY of [0, 140]) {
  for (const off of [0, 60, 230]) {
    assert.equal(resolveKeyboardBandTop({ offsetTop: off, pageTop: scrollY + off, rootTop: -scrollY }), off, `layout space off=${off} scroll=${scrollY}`);
  }
}
// Visual-relative rects (some iOS builds / PWAs): the visible band starts at 0.
// Using offsetTop here is what pushed the composer behind the keyboard after scrolling down.
for (const scrollY of [0, 140]) {
  for (const off of [60, 230]) {
    assert.equal(resolveKeyboardBandTop({ offsetTop: off, pageTop: scrollY + off, rootTop: -(scrollY + off) }), 0, `visual space off=${off} scroll=${scrollY}`);
  }
}
assert.equal(resolveKeyboardBandTop({ offsetTop: 90 }), 90);
assert.equal(resolveKeyboardBandTop({}), 0);
assert.match(src, /_pmKbBandTop\(vv\) \+ vh - 4 - height/, 'composer target must use the measured band top');
assert.match(src, /const vTop = _pmKbBandTop\(vv\);/, 'placement verify must use the measured band top');
assert.match(src, /_pmKbSettleComposer\(\)/, 'scroll must keep re-measuring through momentum');

// Docks: fixed `bottom` may be layout- or visual-anchored; alignBottomAbove measures and corrects.
globalThis.window = { visualViewport: { height: 400, offsetTop: 0 }, innerHeight: 800 };
const { alignBottomAbove } = await import('../web-ui/src/mobile/mobile-runtime-chrome.js');
const mkEl = (bottomPx, anchorHeight) => {
  const style = new Map([['bottom', `${bottomPx}px`]]);
  return {
    hidden: false,
    style: { getPropertyValue: (k) => style.get(k) || '', setProperty: (k, v) => style.set(k, v) },
    getBoundingClientRect() { const b = anchorHeight - Number.parseFloat(style.get('bottom')); return { top: b - 30, bottom: b, height: 30 }; },
  };
};
// Composer top 330, keyboard edge 400. Desired dock bottom edge = 322.
const visual = mkEl(78, 400); alignBottomAbove(visual, 330); assert.equal(visual.getBoundingClientRect().bottom, 322);
// Layout-anchored: the same bottom:78 would sit at 722, behind the keyboard; must be corrected.
const layout = mkEl(78, 800); alignBottomAbove(layout, 330); assert.equal(layout.getBoundingClientRect().bottom, 322);
assert.match(src, /alignAbove\(backgroundSpawnDock,/, 'agent dock must be measured-aligned');
console.log('[mobile keyboard band top] layout + visual rect spaces, settle loop, dock alignment: ok');
