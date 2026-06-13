/**
 * Filters panel — CapCut-style one-click cinematic looks.
 *
 * Applies a `cinematic` effect (see effects/registry.js) to the selected clip,
 * or — when nothing is selected — to every visual clip in the scene. The look
 * composes as a CSS filter at render time, so it is fully live and exports with
 * the scene. The AI drives the exact same path via `add-effect` / `set-effects`
 * ops, so anything done here can be done by the agent.
 */

import { FILTER_PRESETS, buildCinematicFilter } from '../effects/registry.js';

function _safe(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isVisualType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'video' || t === 'image' || t === 'img' || t === 'shape' ||
         t === 'rect' || t === 'rectangle' || t === 'ellipse' || t === 'circle' || t === 'text';
}

function effectStackOf(el) {
  return Array.isArray(el?.meta?.effectStack)
    ? el.meta.effectStack
    : (Array.isArray(el?.effects) ? el.effects : []);
}

function activeCinematicOf(el) {
  return effectStackOf(el).find(ef => ef?.id === 'cinematic') || null;
}

export function createFiltersPanel({ container, store, getScene, applyOps }) {
  let intensity = 1;

  function getSelectedEl() {
    const { selectedIds } = store.getState();
    if (!selectedIds?.length) return null;
    const scene = getScene();
    return (scene?.elements || []).find(e => e.id === selectedIds[0]) || null;
  }

  function targetElements() {
    const sel = getSelectedEl();
    if (sel) return [sel];
    const scene = getScene();
    return (scene?.elements || []).filter(e => isVisualType(e.type));
  }

  function currentPresetId() {
    const sel = getSelectedEl();
    if (sel) return activeCinematicOf(sel)?.params?.preset || 'none';
    // No selection: report the most common preset across visual clips
    const counts = new Map();
    for (const el of targetElements()) {
      const pid = activeCinematicOf(el)?.params?.preset || 'none';
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    let best = 'none', bestN = -1;
    for (const [pid, n] of counts) if (n > bestN) { best = pid; bestN = n; }
    return best;
  }

  function applyPreset(presetId) {
    const targets = targetElements();
    if (!targets.length) return;
    const ops = targets.map(el => {
      const stack = effectStackOf(el).filter(ef => ef?.id !== 'cinematic');
      if (presetId !== 'none') {
        stack.push({ id: 'cinematic', params: { preset: presetId, intensity } });
      }
      return { op: 'set-effects', id: el.id, effects: stack };
    });
    applyOps(ops);
    render();
  }

  function applyIntensity(next) {
    intensity = Math.max(0, Math.min(2, Number(next) || 0));
    const targets = targetElements();
    const ops = [];
    for (const el of targets) {
      const active = activeCinematicOf(el);
      if (!active) continue;
      const stack = effectStackOf(el).map(ef =>
        ef?.id === 'cinematic' ? { ...ef, params: { ...ef.params, intensity } } : ef
      );
      ops.push({ op: 'set-effects', id: el.id, effects: stack });
    }
    if (ops.length) applyOps(ops);
  }

  function render() {
    const sel = getSelectedEl();
    const activePreset = currentPresetId();
    const scope = sel ? (sel.name || sel.type || 'clip') : 'all clips';

    container.innerHTML = `
      <div class="ce-lib-panel ce-filters-panel">
        <div class="ce-lib-header">Filter → <strong>${_safe(scope)}</strong></div>
        <div class="ce-filter-intensity">
          <label>Strength</label>
          <input type="range" min="0" max="2" step="0.05" value="${intensity}" data-ce-filter-intensity>
          <span data-ce-filter-intensity-val>${Math.round(intensity * 100)}%</span>
        </div>
        <div class="ce-lib-grid ce-filters-grid" data-ce-filters-grid>
          ${FILTER_PRESETS.map(p => {
            const css = buildCinematicFilter(p.id, intensity);
            const selected = p.id === activePreset ? ' ce-filter-tile--active' : '';
            return `
              <button class="ce-filter-tile${selected}" data-ce-filter="${_safe(p.id)}" title="${_safe(p.label)}">
                <span class="ce-filter-swatch" style="filter:${css || 'none'}"></span>
                <span class="ce-filter-label">${_safe(p.label)}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-ce-filter]').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.ceFilter));
    });

    const range = container.querySelector('[data-ce-filter-intensity]');
    const valLabel = container.querySelector('[data-ce-filter-intensity-val]');
    if (range) {
      range.addEventListener('input', () => {
        if (valLabel) valLabel.textContent = `${Math.round(Number(range.value) * 100)}%`;
        // Live-update swatches without a full re-render
        intensity = Math.max(0, Math.min(2, Number(range.value) || 0));
        container.querySelectorAll('[data-ce-filter]').forEach(b => {
          const sw = b.querySelector('.ce-filter-swatch');
          if (sw) sw.style.filter = buildCinematicFilter(b.dataset.ceFilter, intensity) || 'none';
        });
      });
      range.addEventListener('change', () => applyIntensity(range.value));
    }
  }

  const _unsub = store.derive(s => s.selectedIds?.[0], () => render());
  render();

  function dispose() { _unsub(); }
  return { render, dispose };
}
