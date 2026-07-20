// Pure gesture math for the Voice preview deck. Keeping this separate from
// the DOM wiring makes cancellation and the first few pixels of a drag easy
// to regression-test.
export const VOICE_PREVIEW_DRAG_START_PX = 6;
export const VOICE_PREVIEW_DISMISS_DISTANCE_PX = 96;
export const VOICE_PREVIEW_EXIT_MS = 240;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function getVoicePreviewGestureOutcome({ dx = 0, dy = 0, cancelled = false } = {}) {
  if (cancelled) return 'reset';
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) >= VOICE_PREVIEW_DISMISS_DISTANCE_PX
    ? 'dismiss'
    : 'reset';
}

export function getVoicePreviewDragStyle({
  dx = 0,
  dy = 0,
  cardRect = null,
  viewportWidth = 0,
  viewportHeight = 0,
  edgeInset = 10,
} = {}) {
  const rawX = finiteNumber(dx);
  const rawY = finiteNumber(dy);
  // Live pointer tracking must be expressed in the immutable pointer-origin
  // coordinate space. Reading a transformed DOMRect on each frame makes the
  // available room shrink by the previous transform, so the card sticks and
  // jumps instead of following the finger. A rect is still accepted for
  // callers that intentionally need a one-shot bounded placement.
  let x = rawX;
  let y = rawY;
  if (cardRect && finiteNumber(viewportWidth) > 0 && finiteNumber(viewportHeight) > 0) {
    const width = finiteNumber(viewportWidth);
    const height = finiteNumber(viewportHeight);
    const rect = cardRect;
    const inset = finiteNumber(edgeInset, 10);
    const leftRoom = Math.max(0, finiteNumber(rect.left) - inset);
    const rightRoom = Math.max(0, width - finiteNumber(rect.right, width) - inset);
    const topRoom = Math.max(0, finiteNumber(rect.top) - inset);
    const bottomRoom = Math.max(0, height - finiteNumber(rect.bottom, height) - inset);
    x = clamp(rawX, -leftRoom, rightRoom);
    y = clamp(rawY, -topRoom, bottomRoom);
  }
  const rotate = clamp(rawX / 18, -10, 10);
  const distance = Math.hypot(rawX, rawY);
  const scale = Math.max(.96, 1 - Math.min(distance, 160) / 2200);

  return {
    opacity: String(Math.max(.35, 1 - Math.min(distance, 190) / 260)),
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg) scale(${scale})`,
  };
}
