/**
 * Graph editor — keyframe value curve editor for the selected element.
 *
 * Renders a mini canvas showing keyframe points over the scene timeline.
 * Supports dragging keyframe points to change value + time.
 * Properties: x, y, width, height, opacity, rotation.
 */

const GRAPH_H    = 120;
const POINT_R    = 5;
const PROPS      = ['x','y','width','height','opacity','rotation'];
const PROP_RANGE = { x:[0,1920], y:[0,1080], width:[0,1920], height:[0,1080], opacity:[0,1], rotation:[-360,360] };

function normY(val, prop) {
  const [lo, hi] = PROP_RANGE[prop] || [0, 1];
  return 1 - (val - lo) / (hi - lo);
}

function denormY(ny, prop) {
  const [lo, hi] = PROP_RANGE[prop] || [0, 1];
  return lo + (1 - ny) * (hi - lo);
}

export function createGraphEditor({ container, store, getScene, applyOps }) {
  container.innerHTML = `
    <div class="ce-graph-editor">
      <div class="ce-graph-toolbar">
        <select class="ce-graph-prop-select" data-ce-graph-prop>
          ${PROPS.map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
        <button class="ce-graph-btn" data-ce-graph-add title="Add keyframe at current time">+KF</button>
        <button class="ce-graph-btn" data-ce-graph-clear title="Clear all keyframes">Clear</button>
      </div>
      <canvas class="ce-graph-canvas" height="${GRAPH_H}"></canvas>
      <div class="ce-graph-hint">Click canvas to add keyframe. Drag to adjust.</div>
    </div>
  `;

  const propSel   = container.querySelector('[data-ce-graph-prop]');
  const canvas    = container.querySelector('.ce-graph-canvas');
  const ctx       = canvas.getContext('2d');
  const addBtn    = container.querySelector('[data-ce-graph-add]');
  const clearBtn  = container.querySelector('[data-ce-graph-clear]');

  let _drag = null; // { kfIdx }
  let _activeProp = 'opacity';

  propSel.addEventListener('change', () => { _activeProp = propSel.value; draw(); });

  function getSelectedEl() {
    const { selectedIds } = store.getState();
    if (!selectedIds?.length) return null;
    const scene = getScene();
    return (scene?.elements || []).find(e => e.id === selectedIds[0]) || null;
  }

  function getKeyframes(el) {
    return (el?.meta?.keyframes || [])
      .filter(kf => Number.isFinite(Number(kf?.[_activeProp])))
      .map(kf => ({ id: kf.id, t: kf.atMs ?? 0, v: kf[_activeProp] ?? 0, raw: kf }));
  }

  function draw() {
    const w = canvas.clientWidth || canvas.offsetWidth || 300;
    canvas.width = w;

    const el    = getSelectedEl();
    const scene = getScene();
    const dur   = scene?.durationMs || 5000;
    const { timeMs } = store.getState();

    ctx.clearRect(0, 0, w, GRAPH_H);

    // Background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, w, GRAPH_H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * GRAPH_H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Playhead
    const phX = (timeMs / dur) * w;
    ctx.strokeStyle = 'rgba(249,115,22,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, GRAPH_H); ctx.stroke();

    if (!el) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select an element to edit keyframes', w/2, GRAPH_H/2);
      return;
    }

    const kfs = getKeyframes(el);
    if (!kfs.length) {
      // Show flat line at current value
      const val = el[_activeProp] ?? 0;
      const ny  = normY(val, _activeProp) * GRAPH_H;
      ctx.strokeStyle = 'rgba(99,102,241,0.4)';
      ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(0, ny); ctx.lineTo(w, ny); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('No keyframes — click + KF to add', 6, 14);
      return;
    }

    // Draw curve (linear interpolation between keyframes)
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < kfs.length; i++) {
      const x = (kfs[i].t / dur) * w;
      const y = normY(kfs[i].v, _activeProp) * GRAPH_H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw keyframe points
    for (const kf of kfs) {
      const x = (kf.t / dur) * w;
      const y = normY(kf.v, _activeProp) * GRAPH_H;
      ctx.beginPath();
      ctx.arc(x, y, POINT_R, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  addBtn.addEventListener('click', () => {
    const el = getSelectedEl();
    if (!el) return;
    const { timeMs } = store.getState();
    const val = el[_activeProp] ?? 0;
    if (typeof applyOps === 'function') {
      applyOps({ op: 'add-keyframe', id: el.id, patch: { atMs: timeMs, [_activeProp]: val } });
    }
    draw();
  });

  clearBtn.addEventListener('click', () => {
    const el = getSelectedEl();
    if (!el) return;
    const remaining = (el.meta?.keyframes || []).map(kf => {
      const next = { ...kf };
      delete next[_activeProp];
      return next;
    });
    if (typeof applyOps === 'function') {
      applyOps({ op: 'set-keyframes', id: el.id, keyframes: remaining });
    }
    draw();
  });

  // Drag keyframe points
  canvas.addEventListener('pointerdown', e => {
    const el = getSelectedEl();
    if (!el) return;
    const kfs = getKeyframes(el);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dur = getScene()?.durationMs || 5000;
    for (let i = 0; i < kfs.length; i++) {
      const x = (kfs[i].t / dur) * canvas.width;
      const y = normY(kfs[i].v, _activeProp) * GRAPH_H;
      if (Math.hypot(mx - x, my - y) < POINT_R + 3) { _drag = { i }; return; }
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!_drag) return;
    const el = getSelectedEl();
    if (!el) return;
    const kfs = getKeyframes(el);
    const rect = canvas.getBoundingClientRect();
    const dur  = getScene()?.durationMs || 5000;
    const nx   = Math.max(0, Math.min(1, (e.clientX - rect.left) / canvas.width));
    const ny   = Math.max(0, Math.min(1, (e.clientY - rect.top) / GRAPH_H));
    const target = kfs[_drag.i];
    const nextKfs = (el.meta?.keyframes || []).map(kf => (
      kf.id === target.id
        ? { ...kf, atMs: Math.round(nx * dur), [_activeProp]: Math.round(denormY(ny, _activeProp) * 100) / 100 }
        : kf
    )).sort((a,b) => (a.atMs || 0) - (b.atMs || 0));
    if (typeof applyOps === 'function') {
      applyOps({ op: 'set-keyframes', id: el.id, keyframes: nextKfs }, { history: false });
    }
    draw();
  });

  canvas.addEventListener('pointerup', () => {
    if (_drag && typeof applyOps === 'function') {
      const el = getSelectedEl();
      if (el) applyOps({ op: 'set-keyframes', id: el.id, keyframes: el.meta?.keyframes || [] });
    }
    _drag = null;
  });

  // Subscribe to store changes
  const unsub = store.subscribe(() => draw());

  draw();

  function dispose() { unsub(); }

  return { draw, dispose };
}
