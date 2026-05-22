/**
 * Preview viewport — canvas stage with zoom/pan, DPI scaling, coordinate transforms.
 *
 * Coordinate spaces:
 *   screen  — mouse event clientX/Y (CSS pixels)
 *   view    — canvas CSS pixel space (relative to canvas top-left)
 *   scene   — logical canvas space (e.g. 1920×1080)
 *
 * Transforms:
 *   scene → view: (x * scale + panX,  y * scale + panY)
 *   view → scene: ((x - panX) / scale, (y - panY) / scale)
 */

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const WHEEL_SENSITIVITY = 0.001;
const FIT_PADDING = 28; // px around scene frame

export function createViewport({ container, store, onHitTest }) {
  let dpr = window.devicePixelRatio || 1;
  let canvas = null;
  let ctx = null;
  let ro = null;
  let _panDrag = null;

  // Build DOM
  const root = document.createElement('div');
  root.className = 'ce-viewport-root';
  root.innerHTML = `
    <canvas class="ce-viewport-canvas"></canvas>
    <div class="ce-viewport-controls">
      <button class="ce-viewport-btn" data-action="zoom-out" title="Zoom out">−</button>
      <button class="ce-viewport-btn" data-action="fit" title="Fit to screen">Fit</button>
      <button class="ce-viewport-btn" data-action="zoom-in" title="Zoom in">+</button>
      <span class="ce-viewport-zoom-label" data-zoom-label>100%</span>
    </div>
  `;

  canvas = root.querySelector('canvas');
  ctx    = canvas.getContext('2d', { alpha: false });
  const zoomLabel = root.querySelector('[data-zoom-label]');

  container.appendChild(root);

  // ── Resize Observer ─────────────────────────────────────────────────────────
  function onResize() {
    dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth  || container.clientWidth  || 1;
    const h = root.clientHeight || container.clientHeight || 1;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    fitToScreen(true);
  }

  ro = new ResizeObserver(onResize);
  ro.observe(root);
  // Initial size after a microtask (container may not have dimensions yet)
  Promise.resolve().then(onResize);

  // ── Fit to screen ───────────────────────────────────────────────────────────
  function fitToScreen(skipUpdate = false) {
    const scene = getScene();
    const sw = scene?.width  || 1920;
    const sh = scene?.height || 1080;
    const vw = root.clientWidth  || 1;
    const vh = root.clientHeight || 1;
    let scale = Math.min(
      (vw - FIT_PADDING * 2) / sw,
      (vh - FIT_PADDING * 2) / sh,
    );
    if (!isFinite(scale) || scale <= 0) scale = 1;
    const panX = (vw - sw * scale) / 2;
    const panY = (vh - sh * scale) / 2;
    store.setState({ zoom: scale, panX, panY });
    if (!skipUpdate) updateZoomLabel();
  }

  function updateZoomLabel() {
    const { zoom } = store.getState();
    if (zoomLabel) zoomLabel.textContent = (isNaN(zoom) || zoom <= 0 ? 100 : Math.round(zoom * 100)) + '%';
  }

  function getScene() {
    return window.prometheusCreativeScene || null;
  }

  // ── Coordinate transforms ────────────────────────────────────────────────────
  function viewToScene(vx, vy) {
    const { zoom, panX, panY } = store.getState();
    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
  }

  function sceneToView(sx, sy) {
    const { zoom, panX, panY } = store.getState();
    return { x: sx * zoom + panX, y: sy * zoom + panY };
  }

  function clientToView(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    return { x: cx - rect.left, y: cy - rect.top };
  }

  // ── Mouse wheel zoom ─────────────────────────────────────────────────────────
  function onWheel(e) {
    e.preventDefault();
    const { zoom, panX, panY } = store.getState();
    const delta  = -e.deltaY * WHEEL_SENSITIVITY;
    const factor = Math.exp(delta * 3);
    const nextZoom = Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom * factor));

    // Zoom toward mouse position
    const { x: vx, y: vy } = clientToView(e.clientX, e.clientY);
    const nextPanX = vx - (vx - panX) * (nextZoom / zoom);
    const nextPanY = vy - (vy - panY) * (nextZoom / zoom);

    store.setState({ zoom: nextZoom, panX: nextPanX, panY: nextPanY });
    updateZoomLabel();
  }

  // ── Middle-mouse / space+drag pan ────────────────────────────────────────────
  function onMouseDown(e) {
    // Middle mouse button or space+left drag pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      const { panX, panY } = store.getState();
      _panDrag = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    // Left click — hit test
    if (e.button === 0 && typeof onHitTest === 'function') {
      const { x: vx, y: vy } = clientToView(e.clientX, e.clientY);
      const scene = viewToScene(vx, vy);
      onHitTest(scene, e);
    }
  }

  function onMouseMove(e) {
    if (!_panDrag) return;
    const dx = e.clientX - _panDrag.startX;
    const dy = e.clientY - _panDrag.startY;
    store.setState({ panX: _panDrag.startPanX + dx, panY: _panDrag.startPanY + dy });
  }

  function onMouseUp() {
    if (!_panDrag) return;
    _panDrag = null;
    canvas.style.cursor = '';
  }

  // ── Toolbar buttons ──────────────────────────────────────────────────────────
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const { zoom, panX, panY } = store.getState();
    if (action === 'zoom-in') {
      const nz = Math.min(MAX_SCALE, zoom * 1.25);
      const cx = root.clientWidth / 2, cy = root.clientHeight / 2;
      store.setState({ zoom: nz, panX: cx - (cx - panX) * (nz / zoom), panY: cy - (cy - panY) * (nz / zoom) });
    } else if (action === 'zoom-out') {
      const nz = Math.max(MIN_SCALE, zoom / 1.25);
      const cx = root.clientWidth / 2, cy = root.clientHeight / 2;
      store.setState({ zoom: nz, panX: cx - (cx - panX) * (nz / zoom), panY: cy - (cy - panY) * (nz / zoom) });
    } else if (action === 'fit') {
      fitToScreen();
    }
    updateZoomLabel();
  });

  canvas.addEventListener('wheel',     onWheel,     { passive: false });
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // ── Subscribe to zoom/pan changes for label update ───────────────────────────
  const unsub = store.derive(s => s.zoom, () => updateZoomLabel());

  // ── Expose transform matrix for renderer ─────────────────────────────────────
  function getTransform() {
    const { zoom, panX, panY } = store.getState();
    return { scale: zoom, panX, panY, dpr };
  }

  function dispose() {
    ro?.disconnect();
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    unsub();
    root.remove();
  }

  return {
    root,
    canvas,
    ctx,
    getTransform,
    viewToScene,
    sceneToView,
    clientToView,
    fitToScreen,
    dispose,
  };
}
