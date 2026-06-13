/**
 * Properties panel — shows and edits the selected element's properties.
 * Includes effects inspector (Phase 8): add/remove/configure effects,
 * mask type, gradient fill, and advanced text controls.
 */

import { getAllEffects, getEffect } from '../effects/registry.js';

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function _safeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Field builders ────────────────────────────────────────────────────────────

function field(label, inputHtml) {
  return `<div class="ce-prop-row">
    <label class="ce-prop-label">${label}</label>
    <div class="ce-prop-control">${inputHtml}</div>
  </div>`;
}

function numInput(key, value, opts = {}) {
  const { min = '', max = '', step = 1 } = opts;
  const v = num(value);
  const hasMin = min !== '' && min != null;
  const hasMax = max !== '' && max != null;
  // Derive a usable slider range when bounds aren't explicit. Computed once at
  // render time; the panel does not re-render on edits, so the range is stable.
  const lo = hasMin ? Number(min) : Math.min(0, v) - Math.max(100, Math.abs(v));
  const hi = hasMax ? Number(max) : Math.max(100, Math.abs(v) * 2 || 100);
  return `<div class="ce-prop-slider-wrap">
    <input class="ce-prop-range" type="range" data-key="${key}"
      value="${v}" min="${lo}" max="${hi}" step="${step}">
    <input class="ce-prop-input ce-prop-num" type="number" data-key="${key}"
      value="${v}" min="${min}" max="${max}" step="${step}">
  </div>`;
}

function textInput(key, value) {
  return `<input class="ce-prop-input ce-prop-input--text" type="text" data-key="${key}"
    value="${_safeHtml(String(value ?? ''))}">`;
}

function colorInput(key, value) {
  const hex = String(value || '#000000');
  return `<div class="ce-prop-color-wrap">
    <input class="ce-prop-color" type="color" data-key="${key}" value="${_safeHtml(hex)}">
    <input class="ce-prop-input ce-prop-input--hex" type="text" data-key="${key}-hex"
      value="${_safeHtml(hex)}" maxlength="9">
  </div>`;
}

function textarea(key, value) {
  return `<textarea class="ce-prop-textarea" data-key="${key}" rows="3">${_safeHtml(String(value ?? ''))}</textarea>`;
}

function select(key, value, options) {
  const opts = options.map(o =>
    `<option value="${_safeHtml(o)}"${o === value ? ' selected' : ''}>${_safeHtml(o)}</option>`
  ).join('');
  return `<select class="ce-prop-select" data-key="${key}">${opts}</select>`;
}

function metaValue(el, key, fallback) {
  return el?.[key] ?? el?.meta?.[key] ?? fallback;
}

// ── Section renderer ──────────────────────────────────────────────────────────

function renderTransformSection(el) {
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Transform</div>
      <div class="ce-prop-row ce-prop-row--2col">
        <div class="ce-prop-row">
          <label class="ce-prop-label">X</label>
          <div class="ce-prop-control">${numInput('x', el.x, { step: 1 })}</div>
        </div>
        <div class="ce-prop-row">
          <label class="ce-prop-label">Y</label>
          <div class="ce-prop-control">${numInput('y', el.y, { step: 1 })}</div>
        </div>
      </div>
      <div class="ce-prop-row ce-prop-row--2col">
        <div class="ce-prop-row">
          <label class="ce-prop-label">W</label>
          <div class="ce-prop-control">${numInput('width', el.width, { min: 1, step: 1 })}</div>
        </div>
        <div class="ce-prop-row">
          <label class="ce-prop-label">H</label>
          <div class="ce-prop-control">${numInput('height', el.height, { min: 1, step: 1 })}</div>
        </div>
      </div>
      ${field('Rotation', numInput('rotation', el.rotation ?? 0, { min: -360, max: 360, step: 1 }))}
      ${field('Opacity', numInput('opacity', el.opacity ?? 1, { min: 0, max: 1, step: 0.01 }))}
      ${field('Zoom', numInput('meta.zoom', metaValue(el, 'zoom', 1), { min: 0.1, max: 5, step: 0.01 }))}
    </div>
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">3D / Perspective</div>
      ${field('Tilt X', numInput('meta.tiltX', metaValue(el, 'tiltX', 0), { min: -80, max: 80, step: 1 }))}
      ${field('Tilt Y', numInput('meta.tiltY', metaValue(el, 'tiltY', 0), { min: -80, max: 80, step: 1 }))}
      ${field('Roll', numInput('meta.roll', metaValue(el, 'roll', 0), { min: -180, max: 180, step: 1 }))}
      ${field('Perspective', numInput('meta.perspective', metaValue(el, 'perspective', 1200), { min: 200, max: 3000, step: 50 }))}
      ${field('Focus blur', numInput('meta.focusBlur', metaValue(el, 'focusBlur', 0), { min: 0, max: 40, step: 0.5 }))}
    </div>
  `;
}

function renderTimingSection(el) {
  const start = el.meta?.startMs ?? 0;
  const end   = el.meta?.endMs   ?? 0;
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Timing</div>
      ${field('Start (ms)', numInput('meta.startMs', start, { min: 0, step: 100 }))}
      ${field('End (ms)',   numInput('meta.endMs',   end,   { min: 0, step: 100 }))}
    </div>
  `;
}

function renderShapeSection(el) {
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Shape</div>
      ${field('Fill',   colorInput('meta.fill',   metaValue(el, 'fill', '#6366f1')))}
      ${field('Stroke', colorInput('meta.stroke', metaValue(el, 'stroke', '#ffffff')))}
      ${field('Stroke W', numInput('meta.strokeWidth', metaValue(el, 'strokeWidth', 0), { min: 0, step: 0.5 }))}
    </div>
  `;
}

function renderTextSection(el) {
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Text</div>
      <div class="ce-prop-row">
        <label class="ce-prop-label">Content</label>
      <div class="ce-prop-control">${textarea('meta.content', metaValue(el, 'content', metaValue(el, 'text', '')))}</div>
      </div>
      ${field('Size',   numInput('meta.fontSize',   metaValue(el, 'fontSize', 48), { min: 4, step: 1 }))}
      ${field('Color',  colorInput('meta.color',    metaValue(el, 'color', '#ffffff')))}
      ${field('Weight', numInput('meta.fontWeight', metaValue(el, 'fontWeight', 400), { min: 100, max: 900, step: 100 }))}
      ${field('Align',  select('meta.textAlign', metaValue(el, 'textAlign', 'left'), ['left', 'center', 'right']))}
    </div>
  `;
}

function renderImageSection(el) {
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Image</div>
      ${field('Src', textInput('meta.source', metaValue(el, 'source', metaValue(el, 'src', metaValue(el, 'url', '')))))}
    </div>
  `;
}

function renderVideoSection(el) {
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Video</div>
      ${field('Src', textInput('meta.source', metaValue(el, 'source', metaValue(el, 'src', metaValue(el, 'url', '')))))}
      ${field('Trim start', numInput('meta.trimStartMs', metaValue(el, 'trimStartMs', 0), { min: 0, step: 100 }))}
      ${field('Trim end', numInput('meta.trimEndMs', metaValue(el, 'trimEndMs', 0), { min: 0, step: 100 }))}
      ${field('Volume', numInput('meta.volume', metaValue(el, 'volume', 0), { min: 0, max: 1, step: 0.05 }))}
    </div>
  `;
}

function renderElementFields(el) {
  const type = (el.type || '').toLowerCase();
  let typeSection = '';
  if (type === 'shape' || type === 'rect' || type === 'rectangle') {
    typeSection = renderShapeSection(el);
  } else if (type === 'ellipse' || type === 'circle') {
    typeSection = renderShapeSection(el);
  } else if (type === 'text') {
    typeSection = renderTextSection(el);
  } else if (type === 'image' || type === 'img') {
    typeSection = renderImageSection(el);
  } else if (type === 'video') {
    typeSection = renderVideoSection(el);
  }

  return `
    <div class="ce-prop-header">
      <span class="ce-prop-type-badge">${_safeHtml(el.type || 'element')}</span>
      <span class="ce-prop-name">${_safeHtml(el.name || el.id || '')}</span>
    </div>
    ${renderTransformSection(el)}
    ${typeSection}
    ${renderTimingSection(el)}
    ${renderMaskSection(el)}
    ${renderEffectsSection(el)}
  `;
}

// ── Mask section ─────────────────────────────────────────────────────────────

function renderMaskSection(el) {
  const mask = el.meta?.mask || el.mask || null;
  const maskType = mask?.type || 'none';
  const pts = (mask?.points || []).map(p => p.join(',')).join(' ');
  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Mask</div>
      ${field('Type', select('meta.mask.type', maskType, ['none', 'polygon', 'ellipse', 'feather']))}
      ${maskType === 'polygon' ? `
        <div class="ce-prop-row">
          <label class="ce-prop-label">Points</label>
          <div class="ce-prop-control">
            <input class="ce-prop-input ce-prop-input--text" type="text"
              data-key="meta.mask.points-raw"
              value="${_safeHtml(pts)}"
              placeholder="0,0 1,0 0.5,1">
          </div>
        </div>
        <div class="ce-prop-row" style="gap:4px;flex-wrap:wrap;padding-top:2px">
          ${['triangle','diamond','hexagon','arrow'].map(p =>
            `<button class="ce-prop-preset-btn" data-mask-preset="${p}">${p}</button>`
          ).join('')}
        </div>
      ` : ''}
      ${maskType === 'ellipse' ? `
        ${field('Rx', numInput('meta.mask.rx', mask?.rx ?? 0.5, { min: 0.01, max: 1, step: 0.01 }))}
        ${field('Ry', numInput('meta.mask.ry', mask?.ry ?? 0.5, { min: 0.01, max: 1, step: 0.01 }))}
      ` : ''}
      ${maskType === 'feather' ? `
        ${field('Radius', numInput('meta.mask.radius', mask?.radius ?? 20, { min: 0, max: 100, step: 1 }))}
      ` : ''}
    </div>
  `;
}

const MASK_PRESETS = {
  triangle: [[0.5,0],[1,1],[0,1]],
  diamond:  [[0.5,0],[1,0.5],[0.5,1],[0,0.5]],
  hexagon:  [[0.25,0],[0.75,0],[1,0.5],[0.75,1],[0.25,1],[0,0.5]],
  arrow:    [[0,0.25],[0.6,0.25],[0.6,0],[1,0.5],[0.6,1],[0.6,0.75],[0,0.75]],
};

// ── Effects section ───────────────────────────────────────────────────────────

function renderEffectParams(ef, def) {
  if (!def?.paramDefs?.length) return '';
  return def.paramDefs.map(pd => {
    const val = ef.params?.[pd.key] ?? pd.default ?? 0;
    if (pd.type === 'color') {
      return field(pd.label, colorInput(`ef.${ef._idx}.params.${pd.key}`, val));
    }
    if (pd.type === 'select') {
      return field(pd.label, select(`ef.${ef._idx}.params.${pd.key}`, val, pd.options || []));
    }
    return field(pd.label, numInput(`ef.${ef._idx}.params.${pd.key}`, val, { min: pd.min, max: pd.max, step: pd.step }));
  }).join('');
}

function renderEffectsSection(el) {
  const effects = (el.meta?.effectStack || el.effects || []).map((ef, i) => ({ ...ef, _idx: i }));
  const allEfx  = getAllEffects();

  return `
    <div class="ce-prop-section">
      <div class="ce-prop-section__title">Effects</div>
      ${effects.length === 0
        ? '<div class="ce-prop-hint">No effects. Add one below.</div>'
        : effects.map(ef => {
            const def = getEffect(ef.id);
            return `
              <div class="ce-effect-row" data-ef-idx="${ef._idx}">
                <div class="ce-effect-row__header">
                  <span class="ce-effect-label">${_safeHtml(def?.label || ef.id)}</span>
                  <button class="ce-effect-remove" data-remove-ef="${ef._idx}" title="Remove">✕</button>
                </div>
                <div class="ce-effect-params">${renderEffectParams(ef, def)}</div>
              </div>
            `;
          }).join('')
      }
      <div class="ce-prop-row" style="margin-top:6px">
        <select class="ce-prop-select" data-ce-add-ef-select style="flex:1">
          <option value="">Add effect…</option>
          ${allEfx.map(e => `<option value="${_safeHtml(e.id)}">${_safeHtml(e.label)}</option>`).join('')}
        </select>
        <button class="ce-prop-btn" data-ce-add-ef>+</button>
      </div>
    </div>
  `;
}

// ── Deep-set helper for dotted keys like "meta.startMs" ──────────────────────

function deepSet(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ── Panel factory ─────────────────────────────────────────────────────────────

export function createPropertiesPanel({ container, store, getScene, applyOps, onElementChange }) {
  let _unsub = null;

  function getSelectedElement() {
    const { selectedIds } = store.getState();
    if (!selectedIds?.length) return null;
    const scene = getScene();
    return (scene?.elements || []).find(e => e.id === selectedIds[0]) || null;
  }

  function render() {
    const el = getSelectedElement();
    if (!el) {
      container.innerHTML = `
        <div class="ce-placeholder">
          <div class="ce-placeholder__icon">⚙</div>
          <div class="ce-placeholder__title">Properties</div>
          <div class="ce-placeholder__hint">Click an element in the preview to inspect it.</div>
        </div>
      `;
      return;
    }
    container.innerHTML = `<div class="ce-prop-panel">${renderElementFields(el)}</div>`;
    bindInputs(el);
  }

  function bindInputs(el) {
    const commitPatch = (patch) => {
      if (typeof applyOps === 'function') {
        applyOps({ op: 'set', id: el.id, patch });
      }
      if (typeof onElementChange === 'function') onElementChange(el);
    };

    // Mask preset buttons
    container.querySelectorAll('[data-mask-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pts = MASK_PRESETS[btn.dataset.maskPreset];
        if (!pts) return;
        commitPatch({ 'meta.mask': { type: 'polygon', points: pts } });
        render();
      });
    });

    // Add effect button
    container.querySelector('[data-ce-add-ef]')?.addEventListener('click', () => {
      const sel = container.querySelector('[data-ce-add-ef-select]');
      const id  = sel?.value;
      if (!id) return;
      const def = getEffect(id);
      if (!def) return;
      const effectStack = [...(el.meta?.effectStack || el.effects || []), { id, params: { ...(def.defaultParams || {}) } }];
      sel.value = '';
      if (typeof applyOps === 'function') applyOps({ op: 'set-effects', id: el.id, effects: effectStack });
      render();
    });

    // Remove effect buttons
    container.querySelectorAll('[data-remove-ef]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.removeEf);
        const effectStack = (el.meta?.effectStack || el.effects || []).filter((_, i) => i !== idx);
        if (typeof applyOps === 'function') applyOps({ op: 'set-effects', id: el.id, effects: effectStack });
        render();
      });
    });

    container.querySelectorAll('[data-key]').forEach(input => {
      const key = input.dataset.key;
      const isHex = key.endsWith('-hex');
      const realKey = isHex ? key.slice(0, -4) : key;

      const handler = () => {
        // Keep the slider + number pair (same data-key) visually in sync.
        if (input.type === 'number' || input.type === 'range') {
          container.querySelectorAll(`[data-key="${realKey}"]`).forEach(sib => {
            if (sib !== input && sib.value !== input.value) sib.value = input.value;
          });
        }
        let value;
        if (input.type === 'number' || input.type === 'range') {
          value = num(input.value);
        } else if (input.type === 'color') {
          value = input.value;
          // Sync the companion hex text input
          const hexInput = container.querySelector(`[data-key="${realKey}-hex"]`);
          if (hexInput) hexInput.value = input.value;
        } else if (isHex) {
          // Sync companion color picker
          const colorInput = container.querySelector(`[data-key="${realKey}"]`);
          if (colorInput && /^#[0-9a-fA-F]{6}$/.test(input.value)) {
            colorInput.value = input.value;
          }
          value = input.value;
        } else {
          value = input.value;
        }

        // Special: mask points raw text "nx,ny nx,ny ..."
        if (realKey === 'meta.mask.points-raw') {
          try {
            const pts = input.value.trim().split(/\s+/).map(p => p.split(',').map(Number));
            const mask = { ...(el.meta?.mask || el.mask || { type: 'polygon' }), type: 'polygon', points: pts };
            commitPatch({ 'meta.mask': mask });
          } catch { /* keep existing */ }
          return;
        }
        // Special: effect param "ef.N.params.key"
        if (realKey.startsWith('ef.')) {
          const parts = realKey.split('.');
          const idx = parseInt(parts[1]);
          const subKey = parts.slice(3).join('.');
          const effectStack = JSON.parse(JSON.stringify(el.meta?.effectStack || el.effects || []));
          if (effectStack?.[idx]) deepSet(effectStack[idx], 'params.' + subKey, value);
          if (typeof applyOps === 'function') applyOps({ op: 'set-effects', id: el.id, effects: effectStack });
          return;
        }
        // Apply to element
        commitPatch({ [realKey]: value });
      };

      const event = (input.tagName === 'SELECT' || input.type === 'color') ? 'input' : 'change';
      if (input.tagName === 'TEXTAREA') {
        input.addEventListener('input', handler);
      } else {
        input.addEventListener(event, handler);
        if (input.type === 'number' || input.type === 'range') input.addEventListener('input', handler);
      }
    });
  }

  // Subscribe to selection changes
  _unsub = store.derive(s => s.selectedIds?.[0], () => render());

  // Initial render
  render();

  function dispose() {
    if (_unsub) _unsub();
  }

  return { render, dispose };
}
