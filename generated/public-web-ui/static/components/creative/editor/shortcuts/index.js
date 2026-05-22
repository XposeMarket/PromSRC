/**
 * Keyboard shortcuts for the creative editor.
 *
 * Registered when the editor is mounted, unregistered on dispose.
 * Shortcuts only fire when the editor is active (not in a text input).
 */

export function createShortcuts({ store, getScene, history, viewport, textEditor, applyOps }) {
  const bindings = [];

  function bind(combo, fn) {
    bindings.push({ combo: normalizeCombo(combo), fn });
  }

  function normalizeCombo(combo) {
    return combo.toLowerCase().split('+').sort().join('+');
  }

  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey)              parts.push('shift');
    if (e.altKey)                parts.push('alt');
    const key = e.key.toLowerCase();
    if (!['control','shift','alt','meta'].includes(key)) parts.push(key);
    return parts.sort().join('+');
  }

  function isEditableTarget(e) {
    const tag = e.target?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
           e.target?.isContentEditable;
  }

  function onKeyDown(e) {
    if (isEditableTarget(e)) return;
    const combo = comboFromEvent(e);
    for (const { combo: c, fn } of bindings) {
      if (c === combo) { e.preventDefault(); fn(e); return; }
    }
  }

  // ── Playback ────────────────────────────────────────────────────────────────
  bind('space', () => {
    store.setState(s => ({ playing: !s.playing }));
  });

  bind('j', () => store.setState(s => ({ timeMs: Math.max(0, s.timeMs - 1000) })));
  bind('l', () => store.setState(s => ({ timeMs: Math.min(s.durationMs || 0, s.timeMs + 1000) })));
  bind('k', () => store.setState({ playing: false }));

  bind('home', () => store.setState({ timeMs: 0, playing: false }));
  bind('end',  () => store.setState(s => ({ timeMs: s.durationMs || 0, playing: false })));

  // ── Selection ───────────────────────────────────────────────────────────────
  bind('escape', () => {
    textEditor?.deactivate();
    store.setState({ selectedIds: [] });
  });

  bind('ctrl+a', () => {
    const scene = getScene();
    const ids = (scene?.elements || []).map(e => e.id);
    store.setState({ selectedIds: ids });
  });

  // ── Nudge ───────────────────────────────────────────────────────────────────
  function nudge(dx, dy) {
    const { selectedIds } = store.getState();
    const scene = getScene();
    if (!selectedIds?.length || !scene) return;
    const ops = (scene.elements || [])
      .filter(el => selectedIds.includes(el.id))
      .map(el => ({ op: 'set', id: el.id, patch: { x: (el.x || 0) + dx, y: (el.y || 0) + dy } }));
    if (typeof applyOps === 'function') applyOps(ops);
  }

  bind('arrowleft',        () => nudge(-1, 0));
  bind('arrowright',       () => nudge( 1, 0));
  bind('arrowup',          () => nudge(0, -1));
  bind('arrowdown',        () => nudge(0,  1));
  bind('shift+arrowleft',  () => nudge(-10, 0));
  bind('shift+arrowright', () => nudge( 10, 0));
  bind('shift+arrowup',    () => nudge(0, -10));
  bind('shift+arrowdown',  () => nudge(0,  10));

  // ── Edit ────────────────────────────────────────────────────────────────────
  bind('delete',    deleteSelected);
  bind('backspace', deleteSelected);

  function deleteSelected() {
    const { selectedIds } = store.getState();
    const scene = getScene();
    if (!selectedIds?.length || !scene) return;
    if (typeof applyOps === 'function') {
      applyOps(selectedIds.map(id => ({ op: 'delete', id })), { selectedIds: [] });
    }
  }

  bind('ctrl+d', () => {
    const { selectedIds } = store.getState();
    const scene = getScene();
    if (!selectedIds?.length || !scene) return;
    const newIds = [];
    for (const id of selectedIds) {
      const el = scene.elements.find(e => e.id === id);
      if (!el) continue;
      const copy = JSON.parse(JSON.stringify(el));
      copy.id = 'el_' + Math.random().toString(36).slice(2);
      copy.x  = (copy.x || 0) + 20;
      copy.y  = (copy.y || 0) + 20;
      newIds.push(copy.id);
      if (typeof applyOps === 'function') applyOps({ op: 'add', ...copy }, { history: false });
    }
    store.setState({ selectedIds: newIds });
    history?.commit();
  });

  // ── History ─────────────────────────────────────────────────────────────────
  bind('ctrl+z',       () => history?.undo());
  bind('ctrl+shift+z', () => history?.redo());
  bind('ctrl+y',       () => history?.redo());

  // ── Zoom ────────────────────────────────────────────────────────────────────
  bind('ctrl+0', () => viewport?.fitToScreen());
  bind('ctrl+=', () => {
    const { zoom, panX, panY } = store.getState();
    const nz = Math.min(8, zoom * 1.25);
    store.setState({ zoom: nz });
  });
  bind('ctrl+-', () => {
    const { zoom } = store.getState();
    store.setState({ zoom: Math.max(0.05, zoom / 1.25) });
  });

  // ── Register ─────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', onKeyDown);

  function dispose() {
    document.removeEventListener('keydown', onKeyDown);
  }

  return { dispose };
}
