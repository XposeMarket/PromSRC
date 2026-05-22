/**
 * Snap guides — snaps element edges/centers to other elements and grid.
 * Returns snapped x/y and visible guide lines for overlay rendering.
 */

const SNAP_THRESHOLD = 6; // scene pixels
const GRID_SIZE = 20;

/**
 * snapElement(el, scene, options)
 *   el      — element being moved (has x, y, width, height)
 *   scene   — full scene (for other elements + dimensions)
 *   options — { snapToGrid, snapToElements, snapToEdges }
 *
 * Returns { x, y, guides: [{ type, value, axis }] }
 */
export function snapElement(el, scene, options = {}) {
  const { snapToGrid = true, snapToElements = true } = options;
  const others = (scene?.elements || []).filter(e => e.id !== el.id);
  const sw = scene?.width  || 1920;
  const sh = scene?.height || 1080;

  let x = el.x;
  let y = el.y;
  const guides = [];

  const elEdges = {
    left:   el.x,
    right:  el.x + el.width,
    top:    el.y,
    bottom: el.y + el.height,
    cx:     el.x + el.width  / 2,
    cy:     el.y + el.height / 2,
  };

  let bestDX = SNAP_THRESHOLD + 1;
  let bestDY = SNAP_THRESHOLD + 1;

  // Collect snap targets
  const xTargets = []; // { value, snapSide }
  const yTargets = [];

  if (snapToElements) {
    // Scene edges + center
    xTargets.push({ v: 0,       s: 'left'  }, { v: sw,      s: 'right'  }, { v: sw / 2, s: 'cx' });
    yTargets.push({ v: 0,       s: 'top'   }, { v: sh,      s: 'bottom' }, { v: sh / 2, s: 'cy' });

    for (const other of others) {
      xTargets.push(
        { v: other.x,                    s: 'left'  },
        { v: other.x + other.width,      s: 'right' },
        { v: other.x + other.width / 2,  s: 'cx'    },
      );
      yTargets.push(
        { v: other.y,                    s: 'top'    },
        { v: other.y + other.height,     s: 'bottom' },
        { v: other.y + other.height / 2, s: 'cy'     },
      );
    }
  }

  // Test X snaps
  for (const t of xTargets) {
    for (const side of ['left', 'right', 'cx']) {
      const elVal = elEdges[side];
      const delta = Math.abs(elVal - t.v);
      if (delta < SNAP_THRESHOLD && delta < bestDX) {
        bestDX = delta;
        const offset = side === 'left' ? 0 : side === 'right' ? -el.width : -el.width / 2;
        x = t.v + offset;
        guides.push({ axis: 'x', value: t.v });
      }
    }
  }

  // Test Y snaps
  for (const t of yTargets) {
    for (const side of ['top', 'bottom', 'cy']) {
      const elVal = elEdges[side];
      const delta = Math.abs(elVal - t.v);
      if (delta < SNAP_THRESHOLD && delta < bestDY) {
        bestDY = delta;
        const offset = side === 'top' ? 0 : side === 'bottom' ? -el.height : -el.height / 2;
        y = t.v + offset;
        guides.push({ axis: 'y', value: t.v });
      }
    }
  }

  // Grid snap (lower priority — only if no element snap)
  if (snapToGrid && bestDX > SNAP_THRESHOLD) {
    x = Math.round(x / GRID_SIZE) * GRID_SIZE;
  }
  if (snapToGrid && bestDY > SNAP_THRESHOLD) {
    y = Math.round(y / GRID_SIZE) * GRID_SIZE;
  }

  return { x, y, guides };
}

/**
 * drawSnapGuides(ctx, guides, transform, sceneW, sceneH)
 * Called from renderer after main draw pass.
 */
export function drawSnapGuides(ctx, guides, transform, sceneW, sceneH) {
  if (!guides?.length) return;
  const { zoom, panX, panY } = transform;
  ctx.save();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth   = 0.5;
  ctx.setLineDash([4, 3]);

  for (const g of guides) {
    if (g.axis === 'x') {
      const vx = g.value * zoom + panX;
      ctx.beginPath();
      ctx.moveTo(vx, panY);
      ctx.lineTo(vx, sceneH * zoom + panY);
      ctx.stroke();
    } else {
      const vy = g.value * zoom + panY;
      ctx.beginPath();
      ctx.moveTo(panX, vy);
      ctx.lineTo(sceneW * zoom + panX, vy);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}
