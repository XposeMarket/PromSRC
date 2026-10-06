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

// Keyboard up: docks share the composer's fixed `top` space (no viewport math),
// so they cannot float 400px high (IMG_0217) or slide under it (IMG_0218).
const { pinRuntimeChrome, keyboardComposerTop } = await import('../web-ui/src/mobile/mobile-runtime-chrome.js');
const mkDock = (h) => {
  const s = new Map();
  return { hidden: false, classList: { contains: () => false }, style: { getPropertyValue: (k) => s.get(k) || '', setProperty: (k, v) => s.set(k, v), removeProperty: (k) => s.delete(k) }, getBoundingClientRect: () => ({ height: h }), s };
};
const composer = mkDock(120); composer.style.setProperty('position', 'fixed'); composer.style.setProperty('top', '450px');
composer.classList = { contains: () => false };
assert.equal(keyboardComposerTop(composer), 450);
const agent = mkDock(34), plan = mkDock(30), jump = mkDock(36); plan.hidden = true;
const page = { classList: { contains: () => false }, style: { getPropertyValue: () => '' }, querySelector: () => null };
const out = pinRuntimeChrome({ form: composer, page, planDock: plan, agentDock: agent, jumpButton: jump });
assert.deepEqual(out, { keyboardTop: 450 });
assert.equal(agent.s.get('top'), '408px', 'agent pill bottom edge sits 8px above the composer top');
assert.equal(agent.s.get('bottom'), 'auto');
assert.equal(jump.s.get('top'), '362px', 'jump button stacks 10px above the pill (bottom 398 < pill top 408)');
// Keyboard down (no fixed top on the composer): keyboard pins are dropped.
composer.style.removeProperty('top');
assert.equal(keyboardComposerTop(composer), null);
console.log('[mobile keyboard band top] layout + visual rect spaces, settle loop, dock alignment: ok');
