/**
 * Text quick-add panel — click a preset to drop a text element onto the scene.
 */

const PRESETS = [
  { label: 'Big Title',    fontSize: 96,  fontWeight: 700, color: '#ffffff', text: 'Big Title',    x: 96,  y: 180, width: 1728, height: 140 },
  { label: 'Subtitle',     fontSize: 56,  fontWeight: 400, color: '#e2e8f0', text: 'Subtitle',     x: 96,  y: 340, width: 1728, height: 90  },
  { label: 'Body',         fontSize: 36,  fontWeight: 400, color: '#cbd5e1', text: 'Body text here', x: 96, y: 460, width: 1728, height: 60  },
  { label: 'Lower Third',  fontSize: 40,  fontWeight: 600, color: '#f97316', text: 'Lower Third',  x: 80,  y: 860, width: 900,  height: 70  },
  { label: 'Caption',      fontSize: 28,  fontWeight: 400, color: '#94a3b8', text: 'Caption text', x: 96,  y: 980, width: 1728, height: 50  },
  { label: 'Bold Quote',   fontSize: 52,  fontWeight: 800, color: '#fbbf24', text: '"Quote here"', x: 200, y: 400, width: 1520, height: 80  },
  { label: 'Label',        fontSize: 22,  fontWeight: 500, color: '#a78bfa', text: 'LABEL',        x: 80,  y: 80,  width: 300,  height: 40  },
  { label: 'Watermark',    fontSize: 20,  fontWeight: 400, color: 'rgba(255,255,255,0.35)', text: '© Prometheus', x: 1700, y: 1040, width: 200, height: 36 },
];

export function createTextPanel({ container, store, getScene, applyOps }) {
  container.innerHTML = `
    <div class="ce-lib-panel">
      <div class="ce-lib-header">Click to add text to scene</div>
      <div class="ce-lib-grid ce-lib-grid--text" data-ce-text-list></div>
    </div>
  `;

  const list = container.querySelector('[data-ce-text-list]');

  PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.className = 'ce-text-preset-btn';
    btn.title = preset.label;
    btn.innerHTML = `
      <span class="ce-text-preset-preview" style="
        font-size:${Math.round(preset.fontSize * 0.25)}px;
        font-weight:${preset.fontWeight};
        color:${preset.color};
      ">${preset.label}</span>
    `;
    btn.addEventListener('click', () => {
      const scene = getScene();
      if (!scene) return;
      const { timeMs } = store.getState();
      const id = 'el_' + Math.random().toString(36).slice(2);
      applyOps({
        op: 'add',
        id,
        type: 'text',
        name: preset.label,
        text: preset.text,
        x: preset.x,
        y: preset.y,
        width: preset.width,
        height: preset.height,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        color: preset.color,
        textAlign: 'left',
        opacity: 1,
        rotation: 0,
        meta: { startMs: timeMs, endMs: (scene.durationMs || 5000) },
      }, { selectedIds: [id] });
    });
    list.appendChild(btn);
  });

  function dispose() {}
  return { dispose };
}
