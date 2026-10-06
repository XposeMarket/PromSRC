// Top of the visible band in getBoundingClientRect space. Rects are layout-
// viewport relative on most iOS builds but visual-viewport relative on some, so
// using offsetTop blindly put the composer offsetTop px behind the keyboard
// after scrolling down. The root rect reveals which space is in use.
export function resolveKeyboardBandTop({ offsetTop, pageTop, rootTop } = {}) {
  const off = Math.max(0, Number(offsetTop) || 0);
  if (!Number.isFinite(Number(pageTop)) || !Number.isFinite(Number(rootTop)) || pageTop == null || rootTop == null) return off;
  const layoutScroll = (Number(pageTop) || 0) - off;
  const shift = Math.max(0, Math.min(off, Math.round(-(Number(rootTop) || 0) - layoutScroll)));
  return off - shift;
}

// iOS momentum scrolling and late offsetTop updates land after the last scroll
// event. Returns a trigger that re-runs `step` every frame for `ms` after the
// latest call; `step` returns false to stop early.
export function settleLoop(step, ms = 600) {
  let until = 0;
  let raf = 0;
  const tick = () => {
    raf = 0;
    if (!step()) return;
    if (performance.now() < until) raf = requestAnimationFrame(tick);
  };
  return () => {
    until = performance.now() + ms;
    if (!raf) raf = requestAnimationFrame(tick);
  };
}
