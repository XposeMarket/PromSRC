/**
 * Effect registry — { id, label, defaultParams, paramDefs, preFilter?, preApply?, postApply? }
 *
 * preFilter(params) → CSS filter string fragment (composed with other filters)
 * preApply(ctx, el, params, sw, sh) → called after save/transform, before element draw
 * postApply(ctx, el, params, sw, sh) → called after element draw (overlays, glow, etc.)
 *
 * Mask system — el.mask: { type, points?, rx?, ry?, feather? }
 *   polygon: clip to normalized points [[nx,ny],...]  (0..1 of element w/h)
 *   ellipse: clip to ellipse (rx/ry default to 0.5)
 *   feather: soften edges via shadow trick
 */

const REGISTRY = new Map();

export function registerEffect(def) { REGISTRY.set(def.id, def); }
export function getEffect(id)       { return REGISTRY.get(id) || null; }
export function getAllEffects()      { return Array.from(REGISTRY.values()); }

// ── Filter composition ────────────────────────────────────────────────────────

export function buildFilter(el) {
  const parts = [];
  for (const ef of (el.effects || [])) {
    const def = REGISTRY.get(ef.id);
    if (!def?.preFilter) continue;
    const f = def.preFilter(ef.params || {});
    if (f) parts.push(f);
  }
  return parts.length ? parts.join(' ') : 'none';
}

// ── Pre-draw application ──────────────────────────────────────────────────────

export function applyPreEffects(ctx, el, sw, sh) {
  for (const ef of (el.effects || [])) {
    const def = REGISTRY.get(ef.id);
    def?.preApply?.(ctx, el, ef.params || {}, sw, sh);
  }
}

// ── Post-draw application ─────────────────────────────────────────────────────

export function applyPostEffects(ctx, el, sw, sh) {
  for (const ef of (el.effects || [])) {
    const def = REGISTRY.get(ef.id);
    def?.postApply?.(ctx, el, ef.params || {}, sw, sh);
  }
}

// ── Mask clip path ────────────────────────────────────────────────────────────

export function applyMask(ctx, el, sw, sh) {
  const mask = el.mask;
  if (!mask || mask.type === 'none' || !mask.type) return;

  if (mask.type === 'polygon') {
    const pts = mask.points || [[0,0],[1,0],[1,1],[0,1]];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [nx, ny] = pts[i];
      if (i === 0) ctx.moveTo(nx * sw, ny * sh);
      else         ctx.lineTo(nx * sw, ny * sh);
    }
    ctx.closePath();
    ctx.clip();

  } else if (mask.type === 'ellipse') {
    const rx = (mask.rx ?? 0.5) * sw;
    const ry = (mask.ry ?? 0.5) * sh;
    ctx.beginPath();
    ctx.ellipse(sw / 2, sh / 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

  } else if (mask.type === 'feather') {
    const r = mask.radius ?? 20;
    ctx.save();
    ctx.filter = `blur(${r}px)`;
    ctx.beginPath();
    ctx.rect(r, r, sw - r * 2, sh - r * 2);
    ctx.clip();
    ctx.filter = 'none';
    ctx.restore();
    ctx.beginPath();
    ctx.rect(0, 0, sw, sh);
    ctx.clip();
  }
}

// ── Gradient fill helper ──────────────────────────────────────────────────────

export function buildGradientFill(ctx, el, sw, sh) {
  const gd = el.gradientFill;
  if (!gd) return null;

  let grad;
  if (gd.type === 'radial') {
    grad = ctx.createRadialGradient(sw/2, sh/2, 0, sw/2, sh/2, Math.max(sw,sh)/2);
  } else {
    // linear — angle in degrees
    const angle = ((gd.angle || 0) * Math.PI) / 180;
    const cx = sw / 2, cy = sh / 2;
    const len = Math.max(sw, sh);
    grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * len / 2, cy - Math.sin(angle) * len / 2,
      cx + Math.cos(angle) * len / 2, cy + Math.sin(angle) * len / 2,
    );
  }

  for (const stop of (gd.stops || [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }])) {
    grad.addColorStop(stop.offset, stop.color);
  }
  return grad;
}

// ── Built-in effects ──────────────────────────────────────────────────────────

registerEffect({
  id: 'blur',
  label: 'Blur',
  defaultParams: { radius: 4 },
  paramDefs: [{ key: 'radius', label: 'Radius', type: 'number', min: 0, max: 40, step: 0.5 }],
  preFilter: (p) => `blur(${p.radius ?? 4}px)`,
});

registerEffect({
  id: 'brightness',
  label: 'Brightness',
  defaultParams: { value: 1.3 },
  paramDefs: [{ key: 'value', label: 'Amount', type: 'number', min: 0, max: 4, step: 0.05 }],
  preFilter: (p) => `brightness(${p.value ?? 1})`,
});

registerEffect({
  id: 'contrast',
  label: 'Contrast',
  defaultParams: { value: 1.3 },
  paramDefs: [{ key: 'value', label: 'Amount', type: 'number', min: 0, max: 4, step: 0.05 }],
  preFilter: (p) => `contrast(${p.value ?? 1})`,
});

registerEffect({
  id: 'saturate',
  label: 'Saturation',
  defaultParams: { value: 1.5 },
  paramDefs: [{ key: 'value', label: 'Amount', type: 'number', min: 0, max: 4, step: 0.05 }],
  preFilter: (p) => `saturate(${p.value ?? 1})`,
});

registerEffect({
  id: 'hue-rotate',
  label: 'Hue Rotate',
  defaultParams: { angle: 90 },
  paramDefs: [{ key: 'angle', label: 'Degrees', type: 'number', min: 0, max: 360, step: 1 }],
  preFilter: (p) => `hue-rotate(${p.angle ?? 0}deg)`,
});

registerEffect({
  id: 'invert',
  label: 'Invert',
  defaultParams: { amount: 1 },
  paramDefs: [{ key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.05 }],
  preFilter: (p) => `invert(${p.amount ?? 1})`,
});

registerEffect({
  id: 'sepia',
  label: 'Sepia',
  defaultParams: { amount: 0.8 },
  paramDefs: [{ key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.05 }],
  preFilter: (p) => `sepia(${p.amount ?? 0.8})`,
});

registerEffect({
  id: 'drop-shadow',
  label: 'Drop Shadow',
  defaultParams: { x: 4, y: 4, blur: 8, color: '#000000', opacity: 0.6 },
  paramDefs: [
    { key: 'x',       label: 'X',       type: 'number', min: -40, max: 40, step: 1 },
    { key: 'y',       label: 'Y',       type: 'number', min: -40, max: 40, step: 1 },
    { key: 'blur',    label: 'Blur',    type: 'number', min: 0,   max: 40, step: 1 },
    { key: 'color',   label: 'Color',   type: 'color' },
    { key: 'opacity', label: 'Opacity', type: 'number', min: 0,   max: 1,  step: 0.05 },
  ],
  preApply(ctx, _el, p) {
    ctx.shadowOffsetX = p.x    ?? 4;
    ctx.shadowOffsetY = p.y    ?? 4;
    ctx.shadowBlur    = p.blur ?? 8;
    const hex = p.color || '#000000';
    const a   = p.opacity ?? 0.6;
    ctx.shadowColor = hex + Math.round(a * 255).toString(16).padStart(2, '0');
  },
  postApply(ctx) {
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  },
});

registerEffect({
  id: 'glow',
  label: 'Glow',
  defaultParams: { blur: 12, color: '#f97316', opacity: 0.8 },
  paramDefs: [
    { key: 'blur',    label: 'Blur',    type: 'number', min: 0, max: 60, step: 1 },
    { key: 'color',   label: 'Color',   type: 'color' },
    { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
  preApply(ctx, _el, p) {
    ctx.shadowBlur  = p.blur  ?? 12;
    ctx.shadowColor = (p.color || '#f97316') + Math.round((p.opacity ?? 0.8) * 255).toString(16).padStart(2,'0');
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  },
  postApply(ctx) {
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  },
});

// ── Cinematic filter looks (CapCut-style one-click filters) ───────────────────
// Each preset is expressed as a set of CSS-filter primitives blended from the
// identity by an intensity factor (0 = original, 1 = full look, up to 2 = boosted).

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v))); }

export const FILTER_PRESETS = [
  { id: 'none',      label: 'Original',  f: {} },
  { id: 'vivid',     label: 'Vivid',     f: { saturate: 1.45, contrast: 1.12 } },
  { id: 'warm',      label: 'Warm',      f: { sepia: 0.28, saturate: 1.30, brightness: 1.05, 'hue-rotate': -12 } },
  { id: 'cool',      label: 'Cool',      f: { saturate: 1.12, brightness: 1.04, 'hue-rotate': 14, contrast: 1.05 } },
  { id: 'mono',      label: 'B&W',       f: { grayscale: 1, contrast: 1.08 } },
  { id: 'noir',      label: 'Noir',      f: { grayscale: 1, contrast: 1.45, brightness: 0.90 } },
  { id: 'vintage',   label: 'Vintage',   f: { sepia: 0.50, saturate: 1.20, contrast: 0.95, brightness: 1.05 } },
  { id: 'fade',      label: 'Fade',      f: { contrast: 0.82, brightness: 1.12, saturate: 0.82 } },
  { id: 'dramatic',  label: 'Dramatic',  f: { contrast: 1.40, saturate: 1.20, brightness: 0.95 } },
  { id: 'cyberpunk', label: 'Cyberpunk', f: { saturate: 1.60, 'hue-rotate': -22, contrast: 1.20 } },
  { id: 'dreamy',    label: 'Dreamy',    f: { brightness: 1.10, saturate: 1.12, contrast: 0.95, blur: 0.6 } },
  { id: 'film',      label: 'Film',      f: { sepia: 0.20, contrast: 1.16, saturate: 1.16 } },
  { id: 'sunset',    label: 'Sunset',    f: { sepia: 0.40, saturate: 1.40, 'hue-rotate': -18, brightness: 1.05 } },
  { id: 'arctic',    label: 'Arctic',    f: { brightness: 1.08, saturate: 0.90, 'hue-rotate': 18, contrast: 1.08 } },
  { id: 'invert',    label: 'Negative',  f: { invert: 1 } },
];

const FILTER_IDENTITY = {
  brightness: 1, contrast: 1, saturate: 1,
  sepia: 0, grayscale: 0, invert: 0, blur: 0, 'hue-rotate': 0,
};

export function buildCinematicFilter(presetId, intensity = 1) {
  const preset = FILTER_PRESETS.find(p => p.id === presetId);
  if (!preset || presetId === 'none' || !preset.f || !Object.keys(preset.f).length) return '';
  const t = _clamp(intensity ?? 1, 0, 2);
  const parts = [];
  for (const [key, target] of Object.entries(preset.f)) {
    const ident = FILTER_IDENTITY[key] ?? 0;
    const val = ident + (target - ident) * t;
    if (key === 'hue-rotate')   parts.push(`hue-rotate(${val.toFixed(1)}deg)`);
    else if (key === 'blur')    parts.push(`blur(${Math.max(0, val).toFixed(2)}px)`);
    else                        parts.push(`${key}(${Math.max(0, val).toFixed(3)})`);
  }
  return parts.join(' ');
}

export function getFilterPresets() { return FILTER_PRESETS.slice(); }

registerEffect({
  id: 'cinematic',
  label: 'Filter',
  defaultParams: { preset: 'vivid', intensity: 1 },
  paramDefs: [
    { key: 'preset',    label: 'Look',     type: 'select', options: FILTER_PRESETS.map(p => p.id) },
    { key: 'intensity', label: 'Strength', type: 'number', min: 0, max: 2, step: 0.05 },
  ],
  preFilter: (p) => buildCinematicFilter(p.preset || 'vivid', p.intensity ?? 1),
});
