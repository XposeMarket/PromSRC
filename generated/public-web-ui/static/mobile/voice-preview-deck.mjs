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
  const width = finiteNumber(viewportWidth);
  const height = finiteNumber(viewportHeight);
  const rect = cardRect || {};
  const inset = finiteNumber(edgeInset, 10);
  const leftRoom = Math.max(0, finiteNumber(rect.left) - inset);
  const rightRoom = Math.max(0, width - finiteNumber(rect.right, width) - inset);
  const topRoom = Math.max(0, finiteNumber(rect.top) - inset);
  const bottomRoom = Math.max(0, height - finiteNumber(rect.bottom, height) - inset);
  const x = clamp(rawX, -leftRoom, rightRoom);
  const y = clamp(rawY, -topRoom, bottomRoom);
  const rotate = clamp(rawX / 42, -1.5, 1.5);

  return {
    // Deliberately never fade or shrink a card during a live gesture. The
    // deck remains readable until a dismissal is actually committed.
    opacity: '1',
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg) scale(1)`,
  };
}
