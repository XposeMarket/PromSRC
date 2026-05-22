/**
 * In-place text editor — positions a <textarea> over the selected text element.
 * Activated by double-clicking a text element in the preview.
 */

function resolveElementAtTime(el, atMs) {
  if (typeof window.resolveElementAtTime === 'function') return window.resolveElementAtTime(el, atMs);
  return { x: el.x ?? 0, y: el.y ?? 0, width: el.width ?? 100, height: el.height ?? 60, rotation: el.rotation ?? 0 };
}

export function createTextEditor({ viewportRoot, store, getScene, applyOps, onElementChange }) {
  let _overlay = null;
  let _active  = false;

  function sceneToView(sx, sy) {
    const { zoom, panX, panY } = store.getState();
    return { x: sx * zoom + panX, y: sy * zoom + panY };
  }

  /**
   * activate(el) — open the textarea over a text element.
   */
  function activate(el) {
    if (_active) deactivate();

    const { timeMs, zoom } = store.getState();
    const r = resolveElementAtTime(el, timeMs);
    const tl = sceneToView(r.x, r.y);
    const vw = r.width  * zoom;
    const vh = r.height * zoom;
    const rot = r.rotation || 0;

    _overlay = document.createElement('div');
    _overlay.className = 'ce-text-edit-overlay';
    _overlay.style.cssText = `
      position: absolute;
      left: ${tl.x}px; top: ${tl.y}px;
      width: ${vw}px; height: ${vh}px;
      transform: rotate(${rot}deg);
      transform-origin: center center;
      z-index: 20;
    `;

    const ta = document.createElement('textarea');
    ta.className = 'ce-text-edit-input';
    ta.value = el.meta?.content || el.text || el.content || '';
    ta.style.cssText = `
      width: 100%; height: 100%;
      font-size: ${(el.meta?.fontSize || el.fontSize || 48) * zoom}px;
      font-family: ${el.meta?.fontFamily || el.fontFamily || 'Inter, sans-serif'};
      font-weight: ${el.meta?.fontWeight || el.fontWeight || 400};
      color: ${el.meta?.color || el.color || '#ffffff'};
      text-align: ${el.meta?.textAlign || el.textAlign || 'left'};
      background: rgba(0,0,0,0.35);
      border: 1.5px solid #f97316;
      border-radius: 2px;
      resize: none;
      outline: none;
      padding: 2px 4px;
      box-sizing: border-box;
      line-height: 1.3;
    `;

    ta.addEventListener('input', () => {
      if (typeof applyOps === 'function') {
        applyOps({ op: 'set', id: el.id, patch: { 'meta.content': ta.value } }, { history: false });
      }
      if (typeof onElementChange === 'function') onElementChange(el);
    });

    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); deactivate(); }
      // Enter without Shift commits
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); deactivate(); }
    });

    // Click outside deactivates
    const onOutsideClick = e => {
      if (!_overlay?.contains(e.target)) deactivate();
    };
    setTimeout(() => document.addEventListener('pointerdown', onOutsideClick, { once: true }), 50);

    _overlay.appendChild(ta);
    viewportRoot.appendChild(_overlay);
    ta.focus();
    ta.select();
    _active = true;
  }

  function deactivate() {
    if (_active && _overlay && typeof applyOps === 'function') {
      const id = store.getState().selectedIds?.[0];
      const value = _overlay.querySelector('textarea')?.value;
      if (id != null && value != null) {
        applyOps({ op: 'set', id, patch: { 'meta.content': value } });
      }
    }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _active = false;
  }

  function isActive() { return _active; }

  function dispose() {
    deactivate();
  }

  return { activate, deactivate, isActive, dispose };
}
