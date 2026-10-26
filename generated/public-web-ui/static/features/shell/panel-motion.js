// Shared width motion for the desktop shell panels (left sidebar, right panel).
//
// The panels used to rely on a bare CSS `width` transition. With the UI now fast,
// the problems that transition was hiding became visible: the inner content
// re-wrapped on every frame, the collapsed rail layout snapped in at t=0, and
// page views measured the panel at the START of the transition (stale offsets).
//
// animatePanelWidth() runs one Web Animations width animation with a single easing
// curve and never writes the panel's own width, so when the animation is cancelled
// at the end the stylesheet / caller-owned sizing is already in place.
// - content(): direct children frozen at the open width via inline styles, so the
//   moving edge clips them instead of re-wrapping text on every frame.
// - fade(): elements faded with compositor opacity animations (no selectors, so no
//   descendant style invalidation; a class-based fade restyled ~1000 nodes).
// - measureTo(): a known destination width skips the forced layout.
// - deferApply: collapse keeps the current layout while the edge moves and swaps at
//   the end; the swap is masked by a short opacity settle on the content children.
// getPanelMotionTiming() lets layout followers (page views) use the destination
// width and the same timing mid-motion. Nothing here touches <body>.

export const PANEL_MOTION = Object.freeze({
  openMs: 260,
  closeMs: 220,
  ease: 'cubic-bezier(.2, .8, .2, 1)',
  settleFadeMs: 180,
});

const active = new WeakMap();

export function shouldReducePanelMotion(win = globalThis.window) {
  try {
    if (!win || win.document?.hidden) return true;
    return Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return true;
  }
}

export function isPanelInMotion(el) {
  return Boolean(el && active.has(el));
}

/** Destination border-box width of an in-flight motion, or null when idle. */
export function getPanelMotionTarget(el) {
  const entry = el ? active.get(el) : null;
  return entry ? entry.to : null;
}

/** { to, duration, ease } of an in-flight motion, or null when idle. */
export function getPanelMotionTiming(el) {
  const entry = el ? active.get(el) : null;
  return entry ? { to: entry.to, duration: entry.duration, ease: PANEL_MOTION.ease } : null;
}

/** Jump an in-flight motion to its end state (no-op when idle). */
export function finishPanelMotion(el) {
  const entry = el ? active.get(el) : null;
  if (entry) entry.finish(true);
}

function readInline(el, prop) {
  return { value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) };
}

function writeInline(el, prop, saved) {
  if (saved && saved.value) el.style.setProperty(prop, saved.value, saved.priority);
  else el.style.removeProperty(prop);
}

// Style-only flush (no layout): commits a class change made while the element's
// CSS transition is disabled, so re-enabling the transition cannot replay it.
function flushStyle(el, win) {
  try { (win?.getComputedStyle || globalThis.getComputedStyle)?.(el)?.getPropertyValue('transition-property'); } catch {}
}

function list(fn) {
  try { return [...((typeof fn === 'function' ? fn() : null) || [])].filter((node) => node && node.style); } catch { return []; }
}

function fadeAnim(node, from, to, options) {
  try { return typeof node.animate === 'function' ? node.animate([{ opacity: from }, { opacity: to }], options) : null; } catch { return null; }
}

const px = (n) => `${Math.round(n * 100) / 100}px`;

/**
 * Animate `el` from its current width to the width produced by `apply()`.
 *
 * @param {HTMLElement} el
 * @param {object} options
 * @param {() => void} options.apply          Synchronous state change (class flips, inline resets).
 * @param {() => void} [options.revert]       Undo of apply(); needed with deferApply when measureTo is absent.
 * @param {boolean} [options.deferApply]      Hold the current layout during the motion; apply() when it settles.
 * @param {() => number} [options.measureTo]  Known destination border-box width (skips the forced layout).
 * @param {() => Iterable<Element>} [options.content] Direct children to freeze at the open width.
 * @param {() => Iterable<Element>} [options.fade]    Elements to fade out (closing) / in (opening).
 * @param {() => void} [options.onSettle]     Called once after the final state is in place.
 * @returns {{ instant: boolean, from: number|null, to: number|null }|null}
 */
export function animatePanelWidth(el, {
  apply, revert = null, deferApply = false, measureTo = null, content = null, fade = null, onSettle = null,
  win = globalThis.window,
} = {}) {
  if (!el || typeof apply !== 'function') return null;
  const settle = () => { try { onSettle?.(); } catch (error) { console.warn('[panel-motion] onSettle failed', error); } };

  // A toggle during a motion reverses smoothly from the current visual width.
  const inFlight = active.get(el);
  const midWidth = inFlight ? el.getBoundingClientRect().width : null;
  if (inFlight) inFlight.finish(true);

  const rawKnown = typeof measureTo === 'function' ? measureTo() : null;
  const known = rawKnown == null || rawKnown === '' ? Number.NaN : Number(rawKnown);
  const canMeasure = Number.isFinite(known) || !deferApply || typeof revert === 'function';
  if (shouldReducePanelMotion(win) || typeof el.animate !== 'function' || !el.isConnected
    || !el.getClientRects().length || !canMeasure) {
    apply();
    settle();
    return { instant: true, from: null, to: null };
  }

  // Current layout is normally clean here, so these reads are free.
  const from = midWidth ?? el.getBoundingClientRect().width;
  const fromClient = el.clientWidth;
  const chrome = Math.max(0, el.offsetWidth - fromClient); // borders/scrollbar of the current state
  // The element's own CSS width transition must not run: a running CSS transition
  // outranks a Web Animation in the cascade.
  const prevTransition = readInline(el, 'transition');
  el.style.setProperty('transition', 'none', 'important');
  const restoreTransition = () => {
    flushStyle(el, win);
    writeInline(el, 'transition', prevTransition);
  };

  let to;
  let toClient = null;
  if (Number.isFinite(known)) {
    to = Math.max(0, known);
    if (!deferApply) apply();
  } else {
    apply();
    to = el.getBoundingClientRect().width; // one forced layout
    toClient = el.clientWidth;
    if (deferApply) revert();
  }

  if (Math.abs(to - from) < 1.5) {
    if (deferApply) apply();
    restoreTransition();
    settle();
    return { instant: true, from, to };
  }

  const opening = to > from;
  const duration = opening ? PANEL_MOTION.openMs : PANEL_MOTION.closeMs;
  const phaseClass = opening ? 'pm-panel-motion--opening' : 'pm-panel-motion--closing';
  const frozenW = `${Math.max(1, Math.round(opening ? (toClient ?? to - chrome) : fromClient))}px`;
  const children = list(content);
  const frozen = children.map((child) => {
    const saved = ['width', 'min-width', 'max-width'].map((p) => [p, readInline(child, p)]);
    child.style.setProperty('width', frozenW, 'important');
    child.style.setProperty('min-width', frozenW, 'important');
    child.style.setProperty('max-width', 'none', 'important');
    return { child, saved };
  });
  const fades = list(fade).map((node) => (opening
    ? fadeAnim(node, 0, 1, { duration: Math.round(duration * 0.8), delay: Math.round(duration * 0.2), easing: 'ease-out', fill: 'backwards' })
    : fadeAnim(node, 1, 0, { duration: Math.round(duration * 0.55), easing: 'ease-in', fill: 'forwards' }))).filter(Boolean);
  el.classList.add('pm-panel-motion', phaseClass);
  const anim = el.animate(
    [
      { width: px(from), minWidth: px(from), maxWidth: 'none' },
      { width: px(to), minWidth: px(to), maxWidth: 'none' },
    ],
    { duration, easing: PANEL_MOTION.ease, fill: 'forwards' },
  );

  let timer = null;
  const startedAt = Date.now();
  const entry = { to, duration, finish };
  function finish(forced = false) {
    if (active.get(el) !== entry) return;
    active.delete(el);
    clearTimeout(timer);
    anim.onfinish = null;
    if (deferApply) apply();
    try { anim.cancel(); } catch {}
    for (const f of fades) { try { f.cancel(); } catch {} }
    for (const { child, saved } of frozen) for (const [p, v] of saved) writeInline(child, p, v);
    el.classList.remove('pm-panel-motion', phaseClass);
    restoreTransition();
    if (deferApply && !forced) {
      // The held layout was swapped at the end: a short fade masks the swap.
      for (const child of children) fadeAnim(child, 0.35, 1, { duration: PANEL_MOTION.settleFadeMs, easing: 'ease-out' });
    }
    settle();
  }
  // Fallback when no finish event arrives (hidden tab, detached element). A
  // visibly running animation (e.g. DevTools slow motion) is given more time.
  const fallback = () => {
    const visiblyRunning = anim.playState === 'running' && !el.ownerDocument?.hidden;
    if (visiblyRunning && Date.now() - startedAt < duration * 20) { timer = setTimeout(fallback, 120); return; }
    finish(false);
  };
  active.set(el, entry);
  anim.onfinish = () => finish(false);
  timer = setTimeout(fallback, duration + 120);
  return { instant: false, from, to };
}
