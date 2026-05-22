/**
 * Assets panel — media library with file picker, drag-drop, paste, grid view.
 * Drag an asset to the preview to add it to the scene.
 */

import { importFiles, revokeAsset, assetToSceneElement } from './importer.js';

function _safeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function renderWaveform(peaks) {
  if (!peaks?.length) return '';
  const max = Math.max(...peaks, 0.001);
  const bars = peaks.map(p => {
    const h = Math.round((p / max) * 100);
    return `<div class="ce-asset-wave-bar" style="height:${h}%"></div>`;
  }).join('');
  return `<div class="ce-asset-wave">${bars}</div>`;
}

function renderAssetCard(asset) {
  const thumb = asset.thumbnail
    ? `<img class="ce-asset-thumb" src="${_safeHtml(asset.thumbnail)}" alt="">`
    : asset.type === 'audio'
      ? renderWaveform(asset.peaks)
      : `<div class="ce-asset-thumb ce-asset-thumb--placeholder">${asset.type === 'video' ? '▶' : '?'}</div>`;

  const dur = asset.duration ? `<span class="ce-asset-dur">${fmtDuration(asset.duration)}</span>` : '';
  const badge = `<span class="ce-asset-badge ce-asset-badge--${asset.type}">${asset.type}</span>`;

  return `
    <div class="ce-asset-card" data-asset-id="${_safeHtml(asset.id)}" draggable="true" title="${_safeHtml(asset.name)}">
      <div class="ce-asset-card__thumb">${thumb}${dur}</div>
      <div class="ce-asset-card__meta">
        ${badge}
        <span class="ce-asset-name">${_safeHtml(asset.name)}</span>
      </div>
    </div>
  `;
}

export function createAssetsPanel({ container, store, getScene, applyOps, onAddToScene }) {
  let _unsub = null;
  let _pasteBound = false;

  function render() {
    const { mediaAssets } = store.getState();
    container.innerHTML = `
      <div class="ce-assets-panel">
        <div class="ce-assets-toolbar">
          <button class="ce-assets-upload-btn" data-ce-upload>+ Import</button>
          <input type="file" class="ce-assets-file-input" data-ce-file-input
            accept="video/*,audio/*,image/*" multiple style="display:none">
        </div>
        <div class="ce-assets-drop-zone" data-ce-drop-zone>
          ${mediaAssets.length === 0
            ? `<div class="ce-assets-empty">
                <div class="ce-assets-empty__icon">⬡</div>
                <div class="ce-assets-empty__text">Drop files here or click Import</div>
              </div>`
            : `<div class="ce-assets-grid">${mediaAssets.map(renderAssetCard).join('')}</div>`
          }
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const uploadBtn   = container.querySelector('[data-ce-upload]');
    const fileInput   = container.querySelector('[data-ce-file-input]');
    const dropZone    = container.querySelector('[data-ce-drop-zone]');

    // File picker
    uploadBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', e => handleFiles(e.target.files));

    // Drag-drop onto drop zone
    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('ce-assets-drop-zone--over'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('ce-assets-drop-zone--over'));
    dropZone?.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('ce-assets-drop-zone--over');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    // Paste image from clipboard. Bind once; render() runs often.
    if (!_pasteBound) {
      document.addEventListener('paste', onPaste, { once: false });
      _pasteBound = true;
    }

    // Asset card double-click → add to scene
    container.querySelectorAll('[data-asset-id]').forEach(card => {
      card.addEventListener('dblclick', () => {
        const asset = getAssetById(card.dataset.assetId);
        if (asset) addAssetToScene(asset);
      });

      // Drag asset card → set drag data
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/ce-asset-id', card.dataset.assetId);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  function onPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items.filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) handleFiles(files);
  }

  async function handleFiles(files) {
    const imported = await importFiles(files);
    const current = store.getState().mediaAssets || [];
    store.setState({ mediaAssets: [...current, ...imported] });
  }

  function getAssetById(id) {
    return (store.getState().mediaAssets || []).find(a => a.id === id) || null;
  }

  function setAssets(assets, options = {}) {
    const incoming = Array.isArray(assets) ? assets.filter(Boolean) : [];
    const current = Array.isArray(store.getState().mediaAssets) ? store.getState().mediaAssets : [];
    const byId = new Map();
    if (options.replace !== true) {
      for (const asset of current) byId.set(asset.id, asset);
    }
    for (const asset of incoming) {
      if (!asset?.id || !asset?.src) continue;
      byId.set(asset.id, { ...byId.get(asset.id), ...asset });
    }
    store.setState({ mediaAssets: Array.from(byId.values()) });
  }

  function addAssetToScene(asset) {
    const scene = getScene();
    if (!scene) return;
    const el = assetToSceneElement(asset, scene);
    if (typeof applyOps === 'function') {
      applyOps({ op: 'add', ...el }, { selectedIds: [el.id] });
    }
    if (typeof onAddToScene === 'function') onAddToScene(el);
  }

  // Re-render when mediaAssets changes
  _unsub = store.derive(s => s.mediaAssets?.length, () => render());

  // Initial render
  render();

  // Expose addAssetToScene for external callers (drag-to-preview)
  function handleExternalDrop(assetId) {
    const asset = getAssetById(assetId);
    if (asset) addAssetToScene(asset);
  }

  function dispose() {
    if (_unsub) _unsub();
    if (_pasteBound) document.removeEventListener('paste', onPaste);
    _pasteBound = false;
  }

  return { render, dispose, handleExternalDrop, setAssets };
}
