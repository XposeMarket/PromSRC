/**
 * Shapes quick-add panel — click a shape to drop it onto the scene.
 */

const SHAPES = [
  { label: 'Rectangle', type: 'shape',   icon: '▬', fill: '#6366f1', stroke: 'none', strokeWidth: 0, width: 400, height: 240, rx: 0 },
  { label: 'Rounded',   type: 'shape',   icon: '▢', fill: '#8b5cf6', stroke: 'none', strokeWidth: 0, width: 400, height: 240, rx: 24 },
  { label: 'Circle',    type: 'ellipse', icon: '●', fill: '#ec4899', stroke: 'none', strokeWidth: 0, width: 300, height: 300 },
  { label: 'Ellipse',   type: 'ellipse', icon: '⬬', fill: '#06b6d4', stroke: 'none', strokeWidth: 0, width: 500, height: 280 },
  { label: 'Line',      type: 'shape',   icon: '—', fill: '#f97316', stroke: 'none', strokeWidth: 0, width: 600, height: 8  },
  { label: 'Square',    type: 'shape',   icon: '■', fill: '#10b981', stroke: 'none', strokeWidth: 0, width: 300, height: 300 },
  { label: 'Rect Outline', type: 'shape', icon: '□', fill: 'rgba(0,0,0,0)', stroke: '#6366f1', strokeWidth: 4, width: 400, height: 240 },
  { label: 'Circle Outline', type: 'ellipse', icon: '○', fill: 'rgba(0,0,0,0)', stroke: '#ec4899', strokeWidth: 4, width: 300, height: 300 },
  { label: 'Triangle',  type: 'shape',   icon: '▲', fill: '#fbbf24', stroke: 'none', strokeWidth: 0, width: 300, height: 300,
    mask: { type: 'polygon', points: [[0.5,0],[1,1],[0,1]] } },
  { label: 'Diamond',   type: 'shape',   icon: '◆', fill: '#f43f5e', stroke: 'none', strokeWidth: 0, width: 300, height: 360,
    mask: { type: 'polygon', points: [[0.5,0],[1,0.5],[0.5,1],[0,0.5]] } },
  { label: 'Bar',       type: 'shape',   icon: '▮', fill: '#64748b', stroke: 'none', strokeWidth: 0, width: 12, height: 200 },
  { label: 'Gradient',  type: 'shape',   icon: '▰', fill: '#6366f1', stroke: 'none', strokeWidth: 0, width: 400, height: 240,
    gradient: { type: 'linear', angle: 90, stops: [{offset:0,color:'#6366f1'},{offset:1,color:'#ec4899'}] } },
];

export function createShapesPanel({ container, store, getScene, applyOps }) {
  container.innerHTML = `
    <div class="ce-lib-panel">
      <div class="ce-lib-header">Click to add shape to scene</div>
      <div class="ce-lib-grid ce-lib-grid--shapes" data-ce-shapes-list></div>
    </div>
  `;

  const list = container.querySelector('[data-ce-shapes-list]');

  SHAPES.forEach(shape => {
    const btn = document.createElement('button');
    btn.className = 'ce-shape-preset-btn';
    btn.title = shape.label;
    btn.innerHTML = `
      <span class="ce-shape-preset-icon" style="color:${shape.fill === 'rgba(0,0,0,0)' ? (shape.stroke || '#fff') : shape.fill}">${shape.icon}</span>
      <span class="ce-shape-preset-label">${shape.label}</span>
    `;
    btn.addEventListener('click', () => {
      const scene = getScene();
      if (!scene) return;
      const { timeMs } = store.getState();
      const id = 'el_' + Math.random().toString(36).slice(2);
      const cx = Math.round((scene.width  || 1920) / 2 - shape.width  / 2);
      const cy = Math.round((scene.height || 1080) / 2 - shape.height / 2);
      const el = {
        op: 'add', id,
        type: shape.type,
        name: shape.label,
        x: cx, y: cy,
        width: shape.width,
        height: shape.height,
        fill: shape.fill,
        stroke: shape.stroke || 'none',
        strokeWidth: shape.strokeWidth ?? 0,
        opacity: 1,
        rotation: 0,
        meta: { startMs: timeMs, endMs: (scene.durationMs || 5000) },
      };
      if (shape.rx)       el.rx       = shape.rx;
      if (shape.mask)     el.mask     = shape.mask;
      if (shape.gradient) el.gradient = shape.gradient;
      applyOps(el, { selectedIds: [id] });
    });
    list.appendChild(btn);
  });

  function dispose() {}
  return { dispose };
}
