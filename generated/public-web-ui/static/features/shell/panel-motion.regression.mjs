// Regression test for the shared desktop panel motion helper.
// Run: node web-ui/src/features/shell/panel-motion.regression.mjs
import assert from 'node:assert/strict';
import {
  animatePanelWidth, getPanelMotionTarget, getPanelMotionTiming, isPanelInMotion, finishPanelMotion, PANEL_MOTION,
} from './panel-motion.js';

// Minimal DOM stand-ins. Width comes from an inline width when set, else from the
// "stylesheet" (open/closed class). el.animate() records keyframes and returns a
// controllable animation, like the Web Animations API.
function makeStyle() {
  const props = new Map();
  const writes = [];
  return {
    writes,
    setProperty(name, value, priority = '') { props.set(name, { value: String(value), priority }); writes.push(name); },
    getPropertyValue(name) { return props.get(name)?.value ?? ''; },
    getPropertyPriority(name) { return props.get(name)?.priority ?? ''; },
    removeProperty(name) { props.delete(name); },
  };
}
function makeEnv({ reduced = false, hidden = false } = {}) {
  const bodyClasses = new Set();
  const body = { style: makeStyle(), classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), contains: (c) => bodyClasses.has(c) } };
  const win = { document: { hidden }, matchMedia: () => ({ matches: reduced }), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  return { body, bodyClasses, win };
}
function makePanel(env, { openW = 280, closedW = 64, open = true, waapi = true } = {}) {
  const classes = new Set(open ? ['open'] : []);
  const animations = [];
  const el = {
    isConnected: true,
    ownerDocument: { body: env.body, hidden: false },
    style: makeStyle(),
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    getClientRects: () => [{}],
    get cssWidth() { return classes.has('open') ? openW : closedW; },
    // A browser reports the interpolated width mid-animation; visualWidth models one such read.
    visualWidth: null,
    getBoundingClientRect() {
      if (this.visualWidth != null) { const w = this.visualWidth; this.visualWidth = null; return { width: w }; }
      const inline = Number.parseFloat(this.style.getPropertyValue('width'));
      return { width: Number.isFinite(inline) ? inline : this.cssWidth };
    },
    get clientWidth() { return this.getBoundingClientRect().width - 1; },
    get offsetWidth() { return this.getBoundingClientRect().width; },
  };
  if (waapi) {
    el.animate = (keyframes, options) => {
      const anim = { keyframes, options, playState: 'running', cancelled: false, onfinish: null, cancel() { this.cancelled = true; this.playState = 'idle'; } };
      anim.end = () => { anim.playState = 'finished'; anim.onfinish?.(); };
      animations.push(anim);
      return anim;
    };
  }
  el.classes = classes;
  el.animations = animations;
  el.kidAnims = [];
  const kidAnimate = (kf, opts) => { const a = { kf, opts, cancel() {} }; el.kidAnims.push(a); return a; };
  el.kids = [{ style: makeStyle(), animate: kidAnimate }, { style: makeStyle(), animate: kidAnimate }];
  el.kids[1].style.setProperty('width', '50%');
  return el;
}
const frozenW = (el) => el.kids.map((k) => k.style.getPropertyValue('width'));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };

await test('opening: state applied at once, width animated from->to, everything handed back on finish', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: false, openW: 380, closedW: 1 });
  let settled = 0;
  const r = animatePanelWidth(el, { apply: () => el.classList.add('open'), content: () => el.kids, onSettle: () => { settled += 1; }, win: env.win });
  assert.deepEqual([r.instant, r.from, r.to], [false, 1, 380]);
  assert.ok(el.classes.has('open'), 'state class is applied immediately when opening');
  assert.ok(el.classes.has('pm-panel-motion') && el.classes.has('pm-panel-motion--opening'));
  assert.deepEqual(getPanelMotionTiming(el), { to: 380, duration: PANEL_MOTION.openMs, ease: PANEL_MOTION.ease });
  assert.equal(env.bodyClasses.size + env.body.style.writes.length, 0, 'never touches <body> (no whole-document style recalc)');
  const anim = el.animations[0];
  assert.equal(anim.keyframes[0].width, '1px'); assert.equal(anim.keyframes[1].width, '380px');
  assert.equal(anim.options.duration, PANEL_MOTION.openMs);
  assert.equal(el.style.getPropertyValue('transition'), 'none', 'own CSS width transition disabled during motion');
  assert.deepEqual(frozenW(el), ['379px', '379px'], 'content children frozen at the open client width');
  assert.equal(el.style.writes.some((p) => p.startsWith('--')), false, 'no inherited custom property on the panel (would restyle its whole subtree)');
  assert.equal(getPanelMotionTarget(el), 380, 'readers see the destination width mid-motion');
  assert.equal(settled, 0);
  anim.end();
  assert.equal(settled, 1);
  assert.ok(anim.cancelled, 'fill:forwards animation is cancelled so CSS owns sizing again');
  assert.equal(isPanelInMotion(el), false);
  assert.equal(getPanelMotionTarget(el), null);
  assert.equal(el.style.getPropertyValue('transition'), '', 'previous inline transition restored');
  assert.deepEqual(frozenW(el), ['', '50%'], 'children inline widths restored exactly');
  assert.equal(el.kids[0].style.getPropertyValue('min-width'), '');
  assert.equal(el.classes.has('pm-panel-motion'), false);
  assert.equal(getPanelMotionTiming(el), null);
  assert.equal(el.style.writes.includes('width'), false, 'never writes an inline width (user-resized widths survive)');
});

await test('collapsing with deferApply: old layout held during motion, swapped on finish with settle fade', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: true, openW: 280, closedW: 64 });
  let settled = 0;
  const r = animatePanelWidth(el, {
    apply: () => el.classList.remove('open'), revert: () => el.classList.add('open'), deferApply: true,
    content: () => el.kids, onSettle: () => { settled += 1; }, win: env.win,
  });
  assert.equal(r.to, 64);
  assert.ok(el.classes.has('open'), 'collapsed layout must NOT apply at t=0');
  assert.ok(el.classes.has('pm-panel-motion--closing'));
  assert.deepEqual(frozenW(el), ['279px', '279px'], 'content frozen at the expanded width');
  assert.equal(el.kidAnims.length, 0, 'no settle fade before the swap');
  el.animations[0].end();
  assert.equal(el.classes.has('open'), false, 'state applied when the motion finishes');
  assert.equal(el.kidAnims.length, 2, 'settle fade masks the layout swap on each content child');
  assert.deepEqual([el.kidAnims[0].kf[0].opacity, el.kidAnims[0].kf[1].opacity], [0.35, 1]);
  assert.equal(el.kidAnims[0].opts.duration, PANEL_MOTION.settleFadeMs);
  assert.equal(settled, 1);
});

await test('fallback timer settles when no finish event arrives (hidden tab / paused animation)', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: true });
  let settled = 0;
  animatePanelWidth(el, { apply: () => el.classList.remove('open'), revert: () => el.classList.add('open'), deferApply: true, onSettle: () => { settled += 1; }, win: env.win });
  el.animations[0].playState = 'paused';
  await tick(PANEL_MOTION.closeMs + 200);
  assert.equal(settled, 1);
  assert.equal(el.classes.has('open'), false);
  assert.equal(isPanelInMotion(el), false);
});

await test('reduced motion, hidden documents and no-WAAPI browsers switch instantly', async () => {
  for (const [envOpts, panelOpts] of [[{ reduced: true }, {}], [{ hidden: true }, {}], [{}, { waapi: false }]]) {
    const env = makeEnv(envOpts);
    const el = makePanel(env, { open: true, ...panelOpts });
    let settled = 0;
    const r = animatePanelWidth(el, { apply: () => el.classList.remove('open'), revert: () => el.classList.add('open'), deferApply: true, onSettle: () => { settled += 1; }, win: env.win });
    assert.equal(r.instant, true);
    assert.equal(el.classes.has('open'), false);
    assert.equal(settled, 1, 'onSettle runs synchronously');
    assert.equal(el.classes.has('pm-panel-motion'), false);
    assert.equal(el.animations.length, 0);
  }
});

await test('toggle mid-motion finishes the first motion and reverses from the visual width', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: true, openW: 280, closedW: 64 });
  animatePanelWidth(el, { apply: () => el.classList.remove('open'), revert: () => el.classList.add('open'), deferApply: true, win: env.win });
  const first = el.animations[0];
  el.visualWidth = 170; // the browser is mid-animation
  const r = animatePanelWidth(el, { apply: () => el.classList.add('open'), win: env.win });
  assert.ok(first.cancelled, 'first animation cancelled');
  assert.equal(r.from, 170, 'reverse starts from the current visual width, no jump');
  assert.equal(r.to, 280);
  assert.ok(el.classes.has('open'));
  assert.equal(el.classes.has('pm-panel-motion--closing'), false, 'first motion fully cleaned up');
  assert.equal(el.kidAnims.length, 0, 'a forced finish skips the settle fade');
  el.animations[1].end();
  assert.equal(isPanelInMotion(el), false);
});

await test('measureTo: a known destination skips the forced layout and the apply/revert round trip', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: true, openW: 280, closedW: 64 });
  let applies = 0; let reverts = 0;
  animatePanelWidth(el, {
    apply: () => { applies += 1; el.classList.remove('open'); }, revert: () => { reverts += 1; el.classList.add('open'); },
    deferApply: true, measureTo: () => 64, content: () => el.kids, win: env.win,
  });
  assert.equal(applies, 0, 'collapsed state is not applied (not even briefly) at t=0');
  assert.equal(reverts, 0, 'no apply/revert style round trip');
  assert.equal(el.animations[0].keyframes[1].width, '64px');
  assert.deepEqual(frozenW(el), ['279px', '279px']);
  el.animations[0].end();
  assert.equal(applies, 1);
  assert.equal(el.classes.has('open'), false);
  // expanding from the rail: content frozen at destination minus the current border chrome
  const r = animatePanelWidth(el, { apply: () => el.classList.add('open'), measureTo: () => 300, content: () => el.kids, win: env.win });
  assert.deepEqual([r.from, r.to], [64, 300]);
  assert.ok(el.classes.has('open'), 'opening applies the state immediately');
  assert.deepEqual(frozenW(el), ['299px', '299px']);
  el.animations[1].end();
});

await test('measureTo returning a non-number falls back to measuring the end state', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: false, openW: 380, closedW: 1 });
  for (const unknown of [undefined, null, '', 'n/a']) {
    const r = animatePanelWidth(el, { apply: () => el.classList.add('open'), measureTo: () => unknown, win: env.win });
    assert.equal(r.to, 380, `measureTo -> ${JSON.stringify(unknown)} must not be read as a width`);
    el.animations.at(-1).end();
    el.classList.remove('open');
  }
});

await test('a width set by another caller mid-motion is left untouched', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: false, openW: 380, closedW: 1 });
  animatePanelWidth(el, { apply: () => el.classList.add('open'), win: env.win });
  el.style.setProperty('width', '960px'); // e.g. a canvas width lock
  finishPanelMotion(el);
  assert.equal(el.style.getPropertyValue('width'), '960px');
  assert.equal(isPanelInMotion(el), false);
});

await test('no-op toggles (same width) settle immediately without an animation', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: true, openW: 64, closedW: 64 });
  let settled = 0;
  const r = animatePanelWidth(el, { apply: () => el.classList.remove('open'), revert: () => el.classList.add('open'), deferApply: true, onSettle: () => { settled += 1; }, win: env.win });
  assert.equal(r.instant, true);
  assert.equal(el.classes.has('open'), false, 'deferred apply still runs');
  assert.equal(settled, 1);
  assert.equal(el.animations.length, 0);
  assert.equal(el.style.getPropertyValue('transition'), '');
});

await test('fade(): opacity-only animations (in when opening, out when closing), cancelled on settle', async () => {
  const env = makeEnv();
  const el = makePanel(env, { open: false, openW: 380, closedW: 1 });
  const anims = [];
  const node = { style: makeStyle(), animate: (kf, opts) => { const a = { kf, opts, cancelled: false, cancel() { this.cancelled = true; } }; anims.push(a); return a; } };
  animatePanelWidth(el, { apply: () => el.classList.add('open'), fade: () => [node], win: env.win });
  assert.deepEqual(anims[0].kf.map((k) => Object.keys(k)), [['opacity'], ['opacity']], 'opacity only: no layout/style-heavy properties');
  assert.deepEqual([anims[0].kf[0].opacity, anims[0].kf[1].opacity], [0, 1]);
  assert.ok(anims[0].opts.delay > 0, 'fade-in starts after the edge has moved');
  el.animations[0].end();
  assert.ok(anims[0].cancelled);
  animatePanelWidth(el, { apply: () => el.classList.remove('open'), fade: () => [node], measureTo: () => 1, win: env.win });
  assert.deepEqual([anims[1].kf[0].opacity, anims[1].kf[1].opacity], [1, 0]);
  el.animations[1].end();
  assert.ok(anims[1].cancelled);
  assert.equal(node.style.writes.length, 0, 'fade never writes inline styles');
});

console.log(`\n${passed} passed`);
