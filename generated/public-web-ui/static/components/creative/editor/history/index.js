/**
 * Undo/redo history for the creative editor scene.
 *
 * Stores JSON snapshots of the scene (elements + metadata).
 * Max 50 entries. Also calls window.commitCreativeHistorySnapshot if present.
 */

const MAX_HISTORY = 50;

export function createHistory({ getScene, applySnapshot }) {
  const _past   = []; // older → newer
  const _future = []; // newer → older (redo stack)

  function snapshot() {
    const scene = getScene();
    if (!scene) return null;
    return JSON.stringify({
      elements:   scene.elements   || [],
      background: scene.background,
      width:      scene.width,
      height:     scene.height,
      durationMs: scene.durationMs,
      captions:   scene.captions || scene.subtitles || [],
      subtitles:  scene.captions || scene.subtitles || [],
    });
  }

  /**
   * commit() — call after every meaningful mutation (drag end, property change, etc.)
   */
  function commit() {
    const snap = snapshot();
    if (!snap) return;
    // Don't push duplicate
    if (_past.length && _past[_past.length - 1] === snap) return;
    _past.push(snap);
    if (_past.length > MAX_HISTORY) _past.shift();
    _future.length = 0; // invalidate redo stack

    // Optional external hook
    try { window.commitCreativeHistorySnapshot?.(JSON.parse(snap)); } catch { /* ignore */ }
  }

  function undo() {
    if (_past.length < 2) return false; // need at least 2: current + one before
    const current = _past.pop();
    _future.push(current);
    const prev = _past[_past.length - 1];
    if (prev) applySnapshot(JSON.parse(prev));
    return true;
  }

  function redo() {
    if (!_future.length) return false;
    const next = _future.pop();
    _past.push(next);
    applySnapshot(JSON.parse(next));
    return true;
  }

  function canUndo() { return _past.length >= 2; }
  function canRedo() { return _future.length > 0; }
  function clear()   { _past.length = 0; _future.length = 0; }

  // Push initial snapshot
  commit();

  return { commit, undo, redo, canUndo, canRedo, clear };
}
