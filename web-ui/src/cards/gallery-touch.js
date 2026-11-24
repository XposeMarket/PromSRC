// Coordinates are relative to the untransformed image viewport, never the scaled photo.
export function installGalleryTouch(stage, image, step) {
  let scale = 1, x = 0, y = 0, gesture;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function draw() {
    const maxX = stage.clientWidth * (scale - 1) / 2;
    const maxY = stage.clientHeight * (scale - 1) / 2;
    x = clamp(x, -maxX, maxX); y = clamp(y, -maxY, maxY);
    image.style.transform = scale === 1 ? '' : `translate(${x}px,${y}px) scale(${scale})`;
  }
  function reset() { scale = 1; x = y = 0; gesture = null; draw(); }
  function pair(touches) {
    const [a, b] = touches, rect = stage.getBoundingClientRect();
    return { d: Math.max(1, Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY)),
      cx: (a.clientX+b.clientX-rect.left*2-rect.width)/2,
      cy: (a.clientY+b.clientY-rect.top*2-rect.height)/2 };
  }
  function begin(touches, allowSwipe) {
    gesture = null;
    if (touches.length === 2) gesture = { pinch: pair(touches), scale, x, y };
    if (touches.length === 1) gesture = { sx: touches[0].clientX, sy: touches[0].clientY,
      x, y, swipe: allowSwipe && scale === 1 };
  }
  stage.addEventListener('touchstart', e => begin(e.targetTouches, true), { passive: true });
  stage.addEventListener('touchmove', e => {
    const g = gesture, t = e.targetTouches;
    if (!g) return;
    if (g.pinch && t.length === 2) {
      const p = pair(t);
      scale = clamp(g.scale * p.d / g.pinch.d, 1, 5);
      x = p.cx - (g.pinch.cx - g.x) * scale / g.scale;
      y = p.cy - (g.pinch.cy - g.y) * scale / g.scale;
    } else if (t.length === 1 && !g.pinch && scale > 1) {
      x = g.x + t[0].clientX - g.sx; y = g.y + t[0].clientY - g.sy;
    } else return;
    if (e.cancelable) e.preventDefault();
    draw();
  }, { passive: false });
  stage.addEventListener('touchend', e => {
    const g = gesture;
    begin(e.targetTouches, false); // The remaining finger can pan, never turn a pinch into a swipe.
    if (!g?.swipe || e.targetTouches.length) return;
    const dx = e.changedTouches[0].clientX - g.sx, dy = e.changedTouches[0].clientY - g.sy;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)*1.3) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { gesture = null; });
  return reset;
}
