/**
 * Effects browser panel — shows all registered effects.
 * Click one to apply it to the currently selected element.
 * Selected element's active effects are shown with remove buttons.
 */

import { getAllEffects, getEffect } from '../effects/registry.js';

function _safe(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const EFFECT_ICONS = {
  blur: '💧', brightness: '☀️', contrast: '◑', saturate: '🎨',
  'hue-rotate': '🌈', invert: '⬜', sepia: '🟤', 'drop-shadow': '🕶️', glow: '✨',
};

export function createEffectsPanel({ container, store, getScene, applyOps }) {
  const allEffects = getAllEffects();

  function getSelectedEl() {
    const { selectedIds } = store.getState();
    if (!selectedIds?.length) return null;
    const scene = getScene();
    return (scene?.elements || []).find(e => e.id === selectedIds[0]) || null;
  }

  function render() {
    const el = getSelectedEl();
    const activeEffects = el?.effects || [];

    container.innerHTML = `
      <div class="ce-lib-panel">
        ${el ? `
          <div class="ce-lib-header">Applied to: <strong>${_safe(el.name || el.id)}</strong></div>
          ${activeEffects.length ? `
            <div class="ce-effects-active" data-active-effects>
              ${activeEffects.map((ef, i) => {
                const def = getEffect(ef.id);
                return `
                  <div class="ce-effect-chip">
                    <span>${EFFECT_ICONS[ef.id] || '🔧'} ${_safe(def?.label || ef.id)}</span>
                    <button class="ce-effect-chip-remove" data-remove-idx="${i}" title="Remove">✕</button>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="ce-lib-hint">No effects applied. Click below to add.</div>'}
        ` : '<div class="ce-lib-hint">Select an element to apply effects.</div>'}

        <div class="ce-lib-section-title">Available Effects</div>
        <div class="ce-lib-grid ce-lib-grid--effects" data-effects-grid>
          ${allEffects.map(ef => `
            <button class="ce-effect-preset-btn${!el ? ' ce-effect-preset-btn--disabled' : ''}"
              data-add-ef="${_safe(ef.id)}" title="${_safe(ef.label)}" ${!el ? 'disabled' : ''}>
              <span class="ce-effect-preset-icon">${EFFECT_ICONS[ef.id] || '🔧'}</span>
              <span class="ce-effect-preset-label">${_safe(ef.label)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Remove effect buttons
    container.querySelectorAll('[data-remove-idx]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const el2 = getSelectedEl();
        if (!el2) return;
        const idx = parseInt(btn.dataset.removeIdx);
        const next = (el2.effects || []).filter((_, i) => i !== idx);
        applyOps({ op: 'set', id: el2.id, patch: { effects: next } });
        render();
      });
    });

    // Add effect buttons
    container.querySelectorAll('[data-add-ef]').forEach(btn => {
      btn.addEventListener('click', () => {
        const el2 = getSelectedEl();
        if (!el2) return;
        const efId = btn.dataset.addEf;
        const def = getEffect(efId);
        if (!def) return;
        const next = [...(el2.effects || []), { id: efId, params: { ...(def.defaultParams || {}) } }];
        applyOps({ op: 'set', id: el2.id, patch: { effects: next } });
        render();
      });
    });
  }

  // Re-render when selection changes
  const _unsub = store.derive(s => s.selectedIds?.[0], () => render());
  render();

  function dispose() { _unsub(); }
  return { render, dispose };
}
