/**
 * Export dialog — modal UI for video export settings.
 */

import { encodeVideo, downloadBlob, buildDrawFn } from './encoder.js';

function _safeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createExportDialog({ store, getScene }) {
  let _modal = null;

  function open() {
    if (_modal) return;
    const scene = getScene();
    const dur   = scene?.durationMs || 5000;
    const sw    = scene?.width  || 1920;
    const sh    = scene?.height || 1080;

    _modal = document.createElement('div');
    _modal.className = 'ce-export-modal-backdrop';
    _modal.innerHTML = `
      <div class="ce-export-modal" role="dialog" aria-label="Export video">
        <div class="ce-export-modal__header">
          <span class="ce-export-modal__title">Export Video</span>
          <button class="ce-export-modal__close" data-ce-close>✕</button>
        </div>
        <div class="ce-export-modal__body">
          <div class="ce-export-row">
            <label class="ce-export-label">Resolution</label>
            <select class="ce-export-select" data-ce-res>
              <option value="${sw}x${sh}" selected>${sw} × ${sh} (original)</option>
              <option value="1920x1080">1920 × 1080 (1080p)</option>
              <option value="1280x720">1280 × 720 (720p)</option>
              <option value="854x480">854 × 480 (480p)</option>
            </select>
          </div>
          <div class="ce-export-row">
            <label class="ce-export-label">Frame rate</label>
            <select class="ce-export-select" data-ce-fps>
              <option value="60">60 fps</option>
              <option value="30" selected>30 fps</option>
              <option value="24">24 fps</option>
            </select>
          </div>
          <div class="ce-export-row">
            <label class="ce-export-label">Range</label>
            <div class="ce-export-range-inputs">
              <input type="number" class="ce-export-input" data-ce-start
                min="0" max="${dur}" step="100" value="0" placeholder="Start ms">
              <span class="ce-export-range-sep">→</span>
              <input type="number" class="ce-export-input" data-ce-end
                min="0" max="${dur}" step="100" value="${dur}" placeholder="End ms">
              <span class="ce-export-range-unit">ms</span>
            </div>
          </div>
          <div class="ce-export-status" data-ce-status style="display:none">
            <div class="ce-export-progress-bar"><div class="ce-export-progress-fill" data-ce-fill></div></div>
            <div class="ce-export-status-text" data-ce-status-text>Encoding…</div>
          </div>
        </div>
        <div class="ce-export-modal__footer">
          <button class="ce-export-btn-cancel" data-ce-cancel>Cancel</button>
          <button class="ce-export-btn-export" data-ce-export>Export</button>
        </div>
      </div>
    `;

    document.body.appendChild(_modal);

    _modal.querySelector('[data-ce-close]')?.addEventListener('click', close);
    _modal.querySelector('[data-ce-cancel]')?.addEventListener('click', close);
    _modal.querySelector('[data-ce-export]')?.addEventListener('click', () => startExport());

    // Close on backdrop click
    _modal.addEventListener('pointerdown', e => { if (e.target === _modal) close(); });
  }

  async function startExport() {
    const scene = getScene();
    if (!scene) return;

    const resVal  = _modal.querySelector('[data-ce-res]')?.value  || '1920x1080';
    const fps     = parseInt(_modal.querySelector('[data-ce-fps]')?.value  || '30');
    const startMs = parseInt(_modal.querySelector('[data-ce-start]')?.value || '0');
    const endMs   = parseInt(_modal.querySelector('[data-ce-end]')?.value   || String(scene.durationMs || 5000));
    const [w, h]  = resVal.split('x').map(Number);

    const statusEl  = _modal.querySelector('[data-ce-status]');
    const fillEl    = _modal.querySelector('[data-ce-fill]');
    const statusTxt = _modal.querySelector('[data-ce-status-text]');
    const exportBtn = _modal.querySelector('[data-ce-export]');

    statusEl.style.display = '';
    exportBtn.disabled = true;
    exportBtn.textContent = 'Encoding…';

    try {
      const drawFn = buildDrawFn();
      const { blob, mimeType } = await encodeVideo({
        scene, drawFn,
        width: w, height: h, fps,
        startMs, endMs,
        onProgress: p => {
          if (fillEl) fillEl.style.width = Math.round(p * 100) + '%';
          if (statusTxt) statusTxt.textContent = `Encoding… ${Math.round(p * 100)}%`;
        },
      });

      if (fillEl) fillEl.style.width = '100%';
      if (statusTxt) statusTxt.textContent = 'Done! Downloading…';

      const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const name = (scene.name || 'export') + '.' + ext;
      await saveExportToCreativeStorage(blob, name, mimeType).catch((err) => {
        console.warn('[ce] could not persist export to Creative storage:', err);
      });
      downloadBlob(blob, name);

      setTimeout(close, 1500);
    } catch (err) {
      console.error('[ce] export failed:', err);
      if (statusTxt) statusTxt.textContent = 'Export failed: ' + err.message;
      if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = 'Retry'; }
    }
  }

  function close() {
    if (_modal) { _modal.remove(); _modal = null; }
  }

  function dispose() { close(); }

  return { open, close, dispose };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read export blob.'));
    reader.readAsDataURL(blob);
  });
}

async function saveExportToCreativeStorage(blob, filename, mimeType) {
  const sessionId = window.currentCreativeSessionId || window.currentChatSessionId || window.activeChatSessionId || '';
  if (!sessionId) return null;
  const base64 = await blobToDataUrl(blob);
  const response = await fetch('/api/canvas/creative-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      mode: window.currentCreativeMode || 'video',
      filename,
      mimeType,
      base64,
      root: window.canvasProjectRoot || '',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Export save failed with HTTP ${response.status}`);
  }
  return data;
}
