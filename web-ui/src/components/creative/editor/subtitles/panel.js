/**
 * Subtitles panel — timecoded text track entries.
 *
 * Stored on scene.subtitles: [{ id, startMs, endMs, text }]
 * Rendered as an overlay in the preview canvas when timeMs is in range.
 */

function uid() { return Math.random().toString(36).slice(2); }
function fmtT(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2,'0')}.${String((ms || 0) % 1000).padStart(3,'0')}`;
}
function _safe(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function createSubtitlesPanel({ container, store, getScene, applyOps }) {
  let _unsub = null;

  function getSubs() {
    const scene = getScene();
    return scene?.captions || scene?.subtitles || [];
  }

  function setSubs(subtitles) {
    if (typeof applyOps === 'function') {
      applyOps({ op: 'set-scene', patch: { captions: subtitles, subtitles } });
    }
  }

  function render() {
    const subs = getSubs();
    const { timeMs } = store.getState();

    container.innerHTML = `
      <div class="ce-subs-panel">
        <div class="ce-subs-toolbar">
          <span class="ce-subs-title">Subtitles</span>
          <button class="ce-subs-add-btn" data-ce-subs-add>+ Add</button>
        </div>
        <div class="ce-subs-list">
          ${subs.length === 0
            ? '<div class="ce-subs-empty">No subtitles yet. Click + Add to create one.</div>'
            : subs.map((sub, i) => `
              <div class="ce-sub-row ${timeMs >= sub.startMs && timeMs < sub.endMs ? 'ce-sub-row--active' : ''}" data-sub-i="${i}">
                <div class="ce-sub-times">
                  <input class="ce-sub-input" type="number" data-sub="${i}" data-field="startMs"
                    value="${sub.startMs ?? 0}" min="0" step="100">
                  <span>→</span>
                  <input class="ce-sub-input" type="number" data-sub="${i}" data-field="endMs"
                    value="${sub.endMs ?? 2000}" min="0" step="100">
                </div>
                <div class="ce-sub-text-row">
                  <textarea class="ce-sub-textarea" data-sub="${i}" data-field="text"
                    rows="2">${_safe(sub.text || '')}</textarea>
                  <button class="ce-sub-remove" data-sub-remove="${i}" title="Delete">✕</button>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    container.querySelector('[data-ce-subs-add]')?.addEventListener('click', () => {
      const scene = getScene();
      if (!scene) return;
      const { timeMs } = store.getState();
      setSubs([...getSubs(), { id: uid(), startMs: timeMs, endMs: timeMs + 2000, text: 'Subtitle' }]);
      render();
    });

    container.querySelectorAll('[data-sub-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.subRemove);
        setSubs(getSubs().filter((_, j) => j !== i));
        render();
      });
    });

    container.querySelectorAll('[data-sub][data-field]').forEach(input => {
      const handler = () => {
        const i     = parseInt(input.dataset.sub);
        const field = input.dataset.field;
        const subs = getSubs();
        if (!subs?.[i]) return;
        const next = subs.map((entry, idx) => idx === i ? { ...entry } : entry);
        const sub = next[i];
        if (field === 'text') {
          sub.text = input.value;
        } else {
          sub[field] = parseInt(input.value) || 0;
        }
        setSubs(next);
      };
      input.addEventListener('change', handler);
      if (input.tagName === 'TEXTAREA') input.addEventListener('input', handler);
    });
  }

  _unsub = store.derive(s => s.timeMs, () => render());
  render();

  function dispose() { if (_unsub) _unsub(); }
  return { render, dispose };
}

/**
 * drawSubtitles(ctx, scene, timeMs, transform, cssW, cssH)
 * Called from the renderer after element draw to overlay active subtitles.
 */
export function drawSubtitles(ctx, scene, timeMs, transform, cssW, cssH) {
  const subs = (scene?.captions || scene?.subtitles || []).filter(s => timeMs >= s.startMs && timeMs < s.endMs);
  if (!subs.length) return;

  const fontSize = Math.round(cssH * 0.042);
  ctx.save();
  ctx.font         = `600 ${fontSize}px Inter, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';

  for (let i = 0; i < subs.length; i++) {
    const text = subs[i].text || '';
    const y    = cssH - 32 - i * (fontSize + 8);
    const metrics = ctx.measureText(text);
    const pad = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cssW / 2 - metrics.width / 2 - pad, y - fontSize - 4, metrics.width + pad * 2, fontSize + 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cssW / 2, y);
  }

  ctx.restore();
}
