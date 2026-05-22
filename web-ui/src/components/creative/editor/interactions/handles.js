/**
 * Transform handles overlay — 8-handle resize + rotation for selected elements.
 *
 * Renders a transparent div overlay on top of the viewport canvas.
 * Handles are DOM elements so they receive pointer events naturally.
 */

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20; // px above top-center handle

function resolveElementAtTime(el, atMs) {
  if (typeof window.resolveElementAtTime === 'function') return window.resolveElementAtTime(el, atMs);
  return { x: el.x ?? 0, y: el.y ?? 0, width: el.width ?? 100, height: el.height ?? 60, rotation: el.rotation ?? 0, opacity: el.opacity ?? 1 };
}

// 8 handles: corners + edge midpoints (clockwise from top-left)
const HANDLE_DEFS = [
  { id: 'tl', cx: 0,   cy: 0,   cursor: 'nwse-resize' },
  { id: 'tm', cx: 0.5, cy: 0,   cursor: 'ns-resize'   },
  { id: 'tr', cx: 1,   cy: 0,   cursor: 'nesw-resize' },
  { id: 'mr', cx: 1,   cy: 0.5, cursor: 'ew-resize'   },
  { id: 'br', cx: 1,   cy: 1,   cursor: 'nwse-resize' },
  { id: 'bm', cx: 0.5, cy: 1,   cursor: 'ns-resize'   },
  { id: 'bl', cx: 0,   cy: 1,   cursor: 'nesw-resize' },
  { id: 'ml', cx: 0,   cy: 0.5, cursor: 'ew-resize'   },
];

export function createHandlesOverlay({ viewportRoot, store, getScene, applyOps, onElementChange }) {
  const overlay = document.createElement('div');
  overlay.className = 'ce-handles-overlay';
  viewportRoot.appendChild(overlay);

  let _drag = null; // { handleId, startEl, startX, startY, startMouse }
  let _unsub = null;

  function getTransform() {
    const { zoom, panX, panY } = store.getState();
    return { zoom, panX, panY };
  }

  function sceneToView(sx, sy) {
    const { zoom, panX, panY } = getTransform();
    return { x: sx * zoom + panX, y: sy * zoom + panY };
  }

  function viewToScene(vx, vy) {
    const { zoom, panX, panY } = getTransform();
    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
  }

  function getSelectedElement() {
    const { selectedIds } = store.getState();
    if (!selectedIds?.length) return null;
    const scene = getScene();
    return (scene?.elements || []).find(e => e.id === selectedIds[0]) || null;
  }

  function render() {
    overlay.innerHTML = '';
    const el = getSelectedElement();
    if (!el) return;

    const { timeMs } = store.getState();
    const r = resolveElementAtTime(el, timeMs);
    const tl = sceneToView(r.x, r.y);
    const br = sceneToView(r.x + r.width, r.y + r.height);
    const vw = br.x - tl.x;
    const vh = br.y - tl.y;
    const rot = r.rotation || 0;

    // Selection box
    const box = document.createElement('div');
    box.className = 'ce-handle-box';
    box.style.cssText = `
      left:${tl.x}px; top:${tl.y}px;
      width:${vw}px; height:${vh}px;
      transform: rotate(${rot}deg);
      transform-origin: center center;
    `;
    overlay.appendChild(box);

    // Resize handles
    for (const def of HANDLE_DEFS) {
      const h = document.createElement('div');
      h.className = 'ce-handle ce-handle--resize';
      h.dataset.handle = def.id;
      h.style.cssText = `
        left:${tl.x + vw * def.cx - HANDLE_SIZE / 2}px;
        top:${tl.y + vh * def.cy - HANDLE_SIZE / 2}px;
        cursor:${def.cursor};
      `;
      h.addEventListener('pointerdown', e => startDrag(e, def.id, el, r));
      overlay.appendChild(h);
    }

    // Rotation handle (above top-center)
    const rot_h = document.createElement('div');
    rot_h.className = 'ce-handle ce-handle--rotate';
    rot_h.dataset.handle = 'rotate';
    rot_h.style.cssText = `
      left:${tl.x + vw * 0.5 - HANDLE_SIZE / 2}px;
      top:${tl.y - ROTATE_OFFSET - HANDLE_SIZE / 2}px;
      cursor: grab;
    `;
    rot_h.addEventListener('pointerdown', e => startDrag(e, 'rotate', el, r));
    overlay.appendChild(rot_h);

    // Rotation connector line
    const line = document.createElement('div');
    line.className = 'ce-handle-rot-line';
    line.style.cssText = `
      left:${tl.x + vw * 0.5 - 0.5}px;
      top:${tl.y - ROTATE_OFFSET}px;
      height:${ROTATE_OFFSET}px;
    `;
    overlay.appendChild(line);
  }

  function startDrag(e, handleId, el, r) {
    e.preventDefault();
    e.stopPropagation();
    _drag = {
      handleId,
      elId: el.id,
      startR: { ...r },
      startMX: e.clientX,
      startMY: e.clientY,
      center: {
        x: (r.x || 0) + (r.width || 0) / 2,
        y: (r.y || 0) + (r.height || 0) / 2,
      },
      lastPatch: null,
    };
    overlay.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!_drag) return;
    const scene = getScene();
    const el = (scene?.elements || []).find(e2 => e2.id === _drag.elId);
    if (!el) return;

    const { zoom } = getTransform();
    const dx = (e.clientX - _drag.startMX) / zoom;
    const dy = (e.clientY - _drag.startMY) / zoom;
    const r  = _drag.startR;
    const h  = _drag.handleId;

    if (h === 'rotate') {
      // Compute angle from element center to mouse
      const rect = overlay.getBoundingClientRect();
      const cx = (_drag.center.x * zoom + getTransform().panX) + rect.left;
      const cy = (_drag.center.y * zoom + getTransform().panY) + rect.top;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90;
      _drag.lastPatch = { rotation: Math.round(angle) };
    } else {
      // Resize
      _drag.lastPatch = buildResizePatch(r, h, dx, dy);
    }

    if (typeof applyOps === 'function') {
      applyOps({ op: 'set', id: el.id, patch: _drag.lastPatch }, { history: false });
    }
    render();
    if (typeof onElementChange === 'function') onElementChange(el);
  }

  function buildResizePatch(r, handle, dx, dy) {
    const patch = { x: r.x, y: r.y, width: r.width, height: r.height };
    switch (handle) {
      case 'tl': patch.x = r.x + dx; patch.y = r.y + dy; patch.width = Math.max(8, r.width - dx); patch.height = Math.max(8, r.height - dy); break;
      case 'tm': patch.y = r.y + dy; patch.height = Math.max(8, r.height - dy); break;
      case 'tr': patch.y = r.y + dy; patch.width = Math.max(8, r.width + dx); patch.height = Math.max(8, r.height - dy); break;
      case 'mr': patch.width  = Math.max(8, r.width  + dx); break;
      case 'br': patch.width  = Math.max(8, r.width  + dx); patch.height = Math.max(8, r.height + dy); break;
      case 'bm': patch.height = Math.max(8, r.height + dy); break;
      case 'bl': patch.x = r.x + dx; patch.width = Math.max(8, r.width - dx); patch.height = Math.max(8, r.height + dy); break;
      case 'ml': patch.x = r.x + dx; patch.width  = Math.max(8, r.width  - dx); break;
    }
    return patch;
  }

  function onPointerUp() {
    if (_drag?.lastPatch && typeof applyOps === 'function') {
      applyOps({ op: 'set', id: _drag.elId, patch: _drag.lastPatch });
    }
    _drag = null;
  }

  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup',   onPointerUp);

  // Also listen on document for mouse-up outside overlay
  document.addEventListener('pointerup', onPointerUp);

  _unsub = store.derive(
    s => [s.selectedIds?.[0], s.zoom, s.panX, s.panY, s.timeMs].join(','),
    () => render()
  );

  render();

  function dispose() {
    if (_unsub) _unsub();
    document.removeEventListener('pointerup', onPointerUp);
    overlay.remove();
  }

  return { render, dispose };
}
