/**
 * Lazy HyperFrames feature integration for the desktop Creative workspace.
 *
 * ChatPage remains the owner of scene state and persistence. This module owns
 * only the HyperFrames-specific controller registry and catalog surface so
 * those dependencies are not requested for normal chat or non-HyperFrames
 * Creative use.
 */

import { createHyperframesController } from './hyperframesController.js';
import { createHyperframesCatalogBrowser } from './hyperframesCatalogBrowser.js';
import { escHtml } from '../../utils.js';

export function createHyperframesFeature(options = {}) {
  const {
    api,
    getScene = () => null,
    getElementById = () => null,
    getSelectedId = () => null,
    applyExtractionToElement = () => {},
    renderWorkspace = () => {},
    persistActiveChat = () => {},
    downloadFile = () => {},
    getFrameRate = () => 60,
    setActiveExport = () => {},
    onInsertHyperframesClip = () => {},
    showToast = () => {},
  } = options;

  if (typeof api !== 'function') throw new Error('createHyperframesFeature: api required');

  const controllers = new Map();
  let catalogBrowser = null;

  function getControllerEntry(elementId) {
    return controllers.get(String(elementId || '')) || null;
  }

  function disposeController(elementId) {
    const key = String(elementId || '');
    const entry = controllers.get(key);
    if (!entry) return;
    try { entry.controller.dispose(); } catch {}
    controllers.delete(key);
  }

  function syncControllers(stage) {
    if (!stage) return;
    const scene = getScene() || {};
    const liveIds = new Set();
    const placeholders = stage.querySelectorAll('[data-hyperframes-mount]');
    for (const placeholder of placeholders) {
      const elementId = placeholder.getAttribute('data-hyperframes-mount');
      liveIds.add(elementId);
      const element = (scene.elements || []).find((candidate) => candidate.id === elementId);
      if (!element) continue;
      let entry = controllers.get(elementId);
      if (!entry) {
        const controller = createHyperframesController({
          element,
          mount: placeholder,
          api: {
            post: (url, body) => api(url, { method: 'POST', body }),
            get: (url) => api(url),
          },
          onSourceChanged: (html) => {
            const live = getElementById(elementId);
            if (live) live.meta = { ...(live.meta || {}), html, dirty: false };
          },
          onLayersChanged: (layers, extraction = {}) => {
            const live = getElementById(elementId);
            if (live) {
              applyExtractionToElement(live, { ...extraction, layers });
              if (getSelectedId() === elementId) {
                try { renderWorkspace(); } catch {}
              }
            }
          },
          onExtractionChanged: (extraction = {}) => {
            const live = getElementById(elementId);
            if (live) {
              applyExtractionToElement(live, extraction);
              if (getSelectedId() === elementId) {
                try { renderWorkspace(); } catch {}
              }
            }
          },
          onPick: (info) => {
            // Picker hits inside the iframe do not move canvas selection yet;
            // keep the most recent hit available to the inspector.
            window._lastHyperframesPick = info;
          },
          onError: (err) => console.warn('hyperframes controller error', err),
          useStudio: element.meta?.useStudio === true,
        });
        entry = { controller, element };
        controllers.set(elementId, entry);
      } else if (entry.element !== element) {
        const nextHtml = String(element.meta?.html || '');
        if (nextHtml && entry.controller.getHtml() !== nextHtml) {
          entry.controller.setHtml(nextHtml);
        }
        entry.element = element;
      }
    }

    for (const [id] of controllers) {
      if (!liveIds.has(id)) disposeController(id);
    }
  }

  function removeCatalog(modal) {
    catalogBrowser?.dispose?.();
    catalogBrowser = null;
    modal?.remove?.();
  }

  function openCatalog() {
    const existing = document.querySelector('#hyperframes-catalog-modal');
    if (existing) removeCatalog(existing);
    const modal = document.createElement('div');
    modal.id = 'hyperframes-catalog-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;width:min(960px,90vw);height:min(720px,85vh);border-radius:12px;display:flex;flex-direction:column;overflow:hidden';
    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb';
    header.innerHTML = '<div style="font-weight:700">HyperFrames Catalog</div><button id="hf-catalog-close" style="padding:4px 10px">Close</button>';
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';
    panel.appendChild(header);
    panel.appendChild(body);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    header.querySelector('#hf-catalog-close').addEventListener('click', () => removeCatalog(modal));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) removeCatalog(modal);
    });
    catalogBrowser = createHyperframesCatalogBrowser({
      mount: body,
      api: {
        get: (url) => api(url),
        post: (url, body) => api(url, { method: 'POST', body }),
      },
      onInsertEditable: (payload) => onInsertHyperframesClip({ ...payload, advancedBlock: false, modal }),
      onInsertAdvanced: (payload) => onInsertHyperframesClip({ ...payload, advancedBlock: true, modal }),
      onError: (err) => showToast({ message: `HyperFrames catalog: ${err?.message || err}`, kind: 'error' }),
    });
    return { modal, browser: catalogBrowser };
  }

  function getHyperframesElement(elementId) {
    const element = getElementById(elementId);
    return element?.type === 'hyperframes' ? element : null;
  }

  function updateElementMeta(elementId, patch = {}, options = {}) {
    const live = getHyperframesElement(elementId);
    if (!live) return null;
    live.meta = { ...(live.meta || {}), ...patch };
    if (options.render !== false) renderWorkspace({ skipStageRender: options.skipStageRender === true });
    persistActiveChat();
    return live;
  }

  function getElementEntryPath(element) {
    const projectPath = String(element?.meta?.projectPath || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    const entryFile = String(element?.meta?.entryFile || 'index.html').trim().replace(/\\/g, '/').replace(/^\/+/g, '') || 'index.html';
    if (!projectPath) return '';
    return `${projectPath}/${entryFile}`.replace(/\/+/g, '/');
  }

  async function ensureElementSourceHtml(element) {
    if (!element || element.type !== 'hyperframes') return '';
    const existing = String(element.meta?.html || '');
    if (existing.trim()) return existing;
    const entryPath = getElementEntryPath(element);
    if (!entryPath) return '';
    const res = await api(`/api/canvas/file?path=${encodeURIComponent(entryPath)}`);
    const html = typeof res?.content === 'string' ? res.content : '';
    if (html.trim()) {
      element.meta = { ...(element.meta || {}), html, dirty: false };
      persistActiveChat();
    }
    return html;
  }

  function renderInspector(selected) {
    const layers = Array.isArray(selected.meta?.layers) ? selected.meta.layers : [];
    const tracks = Array.isArray(selected.meta?.tracks) ? selected.meta.tracks : [];
    const slots = Array.isArray(selected.meta?.slots) ? selected.meta.slots : [];
    const variableBindings = Array.isArray(selected.meta?.variableBindings) ? selected.meta.variableBindings : [];
    const assets = Array.isArray(selected.meta?.assets) ? selected.meta.assets : [];
    const warnings = Array.isArray(selected.meta?.warnings) ? selected.meta.warnings : [];
    const lintErrors = Array.isArray(selected.meta?.lint?.errors) ? selected.meta.lint.errors : [];
    const lintWarnings = Array.isArray(selected.meta?.lint?.warnings) ? selected.meta.lint.warnings : [];
    const qaIssues = Array.isArray(selected.meta?.qaReport?.issues) ? selected.meta.qaReport.issues : [];
    const ingest = selected.meta?.ingest && typeof selected.meta.ingest === 'object' ? selected.meta.ingest : null;
    const advanced = selected.meta?.advancedBlock === true;
    const safeElementId = escHtml(selected.id).replace(/'/g, '&#39;');
    const layerRows = advanced
      ? `<div style="font-size:11px;color:#a8a29e;padding:8px 0">Advanced block — internals are code-backed. Edit via slots and variables below.</div>`
      : layers.length
        ? layers.map((layer) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;margin-bottom:4px">
              <div>
                <div style="font-size:12px;color:#fafaf9">${escHtml(layer.name || layer.elementId)}</div>
                <div style="font-size:10px;color:#a8a29e">${escHtml(layer.kind)} · ${layer.startMs}–${layer.endMs}ms</div>
              </div>
              ${layer.editable?.text ? `<button onclick="canvasHyperframesEditLayer('${escHtml(selected.id)}','${escHtml(layer.elementId)}','text')" style="font-size:10px;padding:3px 6px">Edit text</button>` : ''}
            </div>
          `).join('')
        : `<div style="font-size:11px;color:#a8a29e;padding:8px 0">No layers extracted yet — open the clip preview to populate.</div>`;
    const trackRows = tracks.length ? tracks.map((track) => `
      <div style="display:grid;grid-template-columns:48px 1fr;gap:8px;align-items:center;padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:6px;margin-bottom:4px">
        <div style="font-size:10px;color:#a8a29e;font-weight:800">T${escHtml(String(track.index ?? 0))}</div>
        <div style="min-width:0">
          <div style="font-size:12px;color:#fafaf9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(track.name || `${track.layers?.length || 0} layers`)}</div>
          <div style="font-size:10px;color:#a8a29e">${escHtml(String(track.startMs || 0))}-${escHtml(String(track.endMs || 0))}ms | ${escHtml(String(track.layers?.length || 0))} clips</div>
        </div>
      </div>
    `).join('') : '';
    const slotRows = slots.length ? slots.map((slot) => `
      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#a8a29e;margin-bottom:3px">${escHtml(slot.label || slot.id)} · ${escHtml(slot.kind)}</div>
        <input data-hf-slot="${escHtml(slot.id)}" data-hf-slot-kind="${escHtml(slot.kind)}" data-hf-element="${escHtml(selected.id)}" type="${slot.kind === 'color' ? 'color' : slot.kind === 'number' ? 'number' : 'text'}" ${slot.min !== null ? `min="${slot.min}"` : ''} ${slot.max !== null ? `max="${slot.max}"` : ''} ${slot.step !== null ? `step="${slot.step}"` : ''} value="${escHtml(String(slot.default ?? ''))}" oninput="canvasHyperframesPatchFromSlot(this)" style="width:100%;padding:5px 8px;font-size:12px;background:rgba(255,255,255,0.06);color:#fafaf9;border:1px solid rgba(255,255,255,0.1);border-radius:6px"/>
      </div>
    `).join('') : '';
    const variableRows = variableBindings.length ? variableBindings.map((binding) => {
      const v = binding.variable || {};
      return `
        <div style="margin-bottom:8px">
          <div style="font-size:10px;color:#a8a29e;margin-bottom:3px">${escHtml(v.label || v.id)} · ${escHtml(v.type || 'string')}</div>
          <input data-hf-variable="${escHtml(v.id)}" data-hf-element="${escHtml(selected.id)}" type="${v.type === 'number' ? 'number' : v.type === 'color' ? 'color' : v.type === 'boolean' ? 'checkbox' : 'text'}" ${v.type === 'boolean' ? (binding.currentValue ? 'checked' : '') : `value="${escHtml(String(binding.currentValue ?? v.default ?? ''))}"`} onchange="canvasHyperframesPatchFromVariable(this)" style="width:100%;padding:5px 8px;font-size:12px;background:rgba(255,255,255,0.06);color:#fafaf9;border:1px solid rgba(255,255,255,0.1);border-radius:6px"/>
        </div>
      `;
    }).join('') : '';
    return `
      <div style="padding:0 16px 14px">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#a8a29e;margin-top:8px">HyperFrames clip</div>
        <div style="font-size:11px;color:#a8a29e;margin-top:4px">${escHtml(selected.meta?.compositionId || '(unknown composition)')} · ${escHtml(advanced ? 'advanced' : 'editable')}</div>
        <div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:#a8a29e;margin-bottom:6px">LAYERS</div>${layerRows}</div>
        <div class="creative-pill-row" style="margin-top:10px">
          <button type="button" class="creative-chip-btn" onclick="canvasToggleHyperframesStudio('${safeElementId}')"><iconify-icon icon="solar:code-square-bold-duotone" width="14" height="14"></iconify-icon>${selected.meta?.useStudio === true ? 'Canvas Preview' : 'Studio'}</button>
          <button type="button" class="creative-chip-btn" onclick="canvasRefreshHyperframesClip('${safeElementId}')"><iconify-icon icon="solar:refresh-bold-duotone" width="14" height="14"></iconify-icon>Refresh</button>
          <button type="button" class="creative-chip-btn" onclick="canvasLintHyperframesClip('${safeElementId}')"><iconify-icon icon="solar:check-circle-bold-duotone" width="14" height="14"></iconify-icon>Lint</button>
          <button type="button" class="creative-chip-btn" onclick="canvasQaHyperframesClip('${safeElementId}')"><iconify-icon icon="solar:eye-bold-duotone" width="14" height="14"></iconify-icon>QA</button>
          <button type="button" class="creative-chip-btn creative-chip-btn--accent" onclick="canvasExportHyperframesClip('${safeElementId}', 'mp4')"><iconify-icon icon="solar:videocamera-record-bold-duotone" width="14" height="14"></iconify-icon>Producer MP4</button>
        </div>
        ${ingest ? `<div class="creative-info-note" style="margin-top:10px">Catalog ingest: ${escHtml(String(ingest.assetCount ?? assets.length))} assets, ${escHtml(String(ingest.fontCount ?? 0))} fonts, ${escHtml(String(ingest.rewrittenPathCount ?? 0))} paths rewritten.</div>` : ''}
        ${warnings.length ? `<div class="creative-info-note" style="margin-top:10px;color:#fbbf24">${warnings.slice(0, 3).map((warning) => escHtml(String(warning))).join('<br>')}</div>` : ''}
        ${lintErrors.length || lintWarnings.length ? `<div class="creative-info-note" style="margin-top:10px">${lintErrors.length} lint errors, ${lintWarnings.length} warnings.</div>` : ''}
        ${qaIssues.length ? `<div class="creative-info-note" style="margin-top:10px">${qaIssues.length} QA issues found.</div>` : ''}
        ${trackRows ? `<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:#a8a29e;margin-bottom:6px">TRACKS</div>${trackRows}</div>` : ''}
        ${slotRows ? `<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:#a8a29e;margin-bottom:6px">SLOTS</div>${slotRows}</div>` : ''}
        ${variableRows ? `<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:#a8a29e;margin-bottom:6px">VARIABLES</div>${variableRows}</div>` : ''}
      </div>
    `;
  }

  function toggleStudio(elementId) {
    const live = getHyperframesElement(elementId);
    if (!live) return;
    live.meta = { ...(live.meta || {}), useStudio: live.meta?.useStudio !== true };
    disposeController(elementId);
    renderWorkspace();
    persistActiveChat();
  }

  function editLayer(elementId, layerElementId, kind) {
    const entry = getControllerEntry(elementId);
    if (!entry || kind !== 'text') return;
    const newText = window.prompt('New text for layer:');
    if (newText === null) return;
    entry.controller.patch([{ op: 'set-text', elementId: layerElementId, text: newText }]);
  }

  function patchFromSlot(input) {
    if (!input) return;
    const elementId = input.getAttribute('data-hf-element');
    const slotId = input.getAttribute('data-hf-slot');
    const kind = input.getAttribute('data-hf-slot-kind');
    const value = input.value;
    const entry = getControllerEntry(elementId);
    if (!entry) return;
    const slot = (entry.element.meta?.slots || []).find((candidate) => candidate.id === slotId);
    if (!slot) return;
    if (slot.kind === 'variable') {
      entry.controller.patch([{ op: 'set-variable', name: slot.variableName || slot.id, value }]);
      return;
    }
    if (!slot.selector || !slot.selector.startsWith('#')) return;
    const elementHfId = slot.selector.slice(1);
    if (kind === 'text') entry.controller.patch([{ op: 'set-text', elementId: elementHfId, text: value }]);
    else if (kind === 'color') entry.controller.patch([{ op: 'set-color', elementId: elementHfId, color: value }]);
    else if (kind === 'number') entry.controller.patch([{ op: 'set-font-size', elementId: elementHfId, fontSize: Number(value) }]);
    else if (kind === 'asset') entry.controller.patch([{ op: 'set-asset', elementId: elementHfId, assetPlaceholderId: value }]);
  }

  function patchFromVariable(input) {
    if (!input) return;
    const elementId = input.getAttribute('data-hf-element');
    const variableId = input.getAttribute('data-hf-variable');
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    const entry = getControllerEntry(elementId);
    if (!entry) return;
    entry.controller.patch([{ op: 'set-variable', name: variableId, value }]);
  }

  async function refreshClip(elementId) {
    const live = getHyperframesElement(elementId);
    if (!live) return;
    try {
      const html = await ensureElementSourceHtml(live);
      const extraction = await api('/api/canvas/hyperframes/extract-layers', { method: 'POST', body: { html } });
      if (!extraction?.success) throw new Error(extraction?.error || 'Could not parse HyperFrames clip');
      applyExtractionToElement(live, extraction);
      renderWorkspace({ skipStageRender: true });
      showToast({ message: 'HyperFrames metadata refreshed.', kind: 'success' });
    } catch (err) {
      showToast({ message: `HyperFrames refresh failed: ${err?.message || err}`, kind: 'error' });
    }
  }

  async function lintClip(elementId) {
    const live = getHyperframesElement(elementId);
    if (!live) return;
    try {
      const html = await ensureElementSourceHtml(live);
      const lint = await api('/api/canvas/hyperframes/lint', { method: 'POST', body: { html } });
      if (!lint?.success) throw new Error(lint?.error || 'HyperFrames lint failed');
      const lintResult = lint.lint || lint;
      updateElementMeta(elementId, { lint: lintResult }, { skipStageRender: true });
      const errorCount = Array.isArray(lintResult.errors) ? lintResult.errors.length : 0;
      const warningCount = Array.isArray(lintResult.warnings) ? lintResult.warnings.length : 0;
      showToast({ message: `HyperFrames lint: ${errorCount} errors, ${warningCount} warnings.`, kind: errorCount ? 'error' : 'success' });
    } catch (err) {
      showToast({ message: `HyperFrames lint failed: ${err?.message || err}`, kind: 'error' });
    }
  }

  async function qaClip(elementId) {
    const live = getHyperframesElement(elementId);
    if (!live) return;
    try {
      const html = await ensureElementSourceHtml(live);
      const qaReport = await api('/api/canvas/hyperframes/qa', { method: 'POST', body: { html } });
      if (!qaReport?.success) throw new Error(qaReport?.error || 'HyperFrames QA failed');
      const report = qaReport.report || qaReport;
      updateElementMeta(elementId, { qaReport: report }, { skipStageRender: true });
      const issueCount = Array.isArray(report.issues) ? report.issues.length : 0;
      showToast({ message: `HyperFrames QA: ${issueCount} issues.`, kind: issueCount ? 'warning' : 'success' });
    } catch (err) {
      showToast({ message: `HyperFrames QA failed: ${err?.message || err}`, kind: 'error' });
    }
  }

  async function exportClip(elementId, format = 'mp4') {
    const live = getHyperframesElement(elementId);
    if (!live) return;
    try {
      showToast({ message: 'Rendering HyperFrames clip with producer...', kind: 'info' });
      const html = await ensureElementSourceHtml(live);
      if (!html.trim()) throw new Error('HyperFrames source HTML is missing.');
      const safeId = String(live.meta?.compositionId || elementId || 'hyperframes').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'hyperframes';
      const variables = {};
      (Array.isArray(live.meta?.variableBindings) ? live.meta.variableBindings : []).forEach((binding) => {
        const id = String(binding?.variable?.id || '').trim();
        if (id) variables[id] = binding.currentValue;
      });
      const result = await api('/api/canvas/hyperframes/render', {
        method: 'POST',
        body: {
          html,
          filename: `${safeId}.${String(format || 'mp4').toLowerCase()}`,
          format,
          fps: Number(getFrameRate()) || 60,
          quality: 'standard',
          variables,
        },
      });
      if (!result?.success) throw new Error(result?.error || 'HyperFrames render failed');
      updateElementMeta(elementId, { lastProducerExport: result }, { skipStageRender: true });
      if (result.outputPath) downloadFile(result.outputPath, result.outputPath.split(/[\\/]/).pop() || `${safeId}.${format}`);
      setActiveExport({
        format: String(format || 'mp4').toLowerCase(),
        renderer: 'hyperframes-producer',
        serverJobId: result.job?.id || '',
        startedAt: Date.now(),
        frameRate: Number(getFrameRate()) || 60,
        progress: 1,
        elapsedMs: 0,
        cancelRequested: false,
        status: 'complete',
        progressLabel: 'HyperFrames producer export complete',
        hyperframesElementId: elementId,
        outputPath: result.outputPath || '',
      });
      showToast({ message: 'HyperFrames producer export complete.', kind: 'success' });
    } catch (err) {
      showToast({ message: `HyperFrames export failed: ${err?.message || err}`, kind: 'error' });
    }
  }

  return {
    getControllerEntry,
    disposeController,
    syncControllers,
    openCatalog,
    ensureElementSourceHtml,
    renderInspector,
    toggleStudio,
    editLayer,
    patchFromSlot,
    patchFromVariable,
    refreshClip,
    lintClip,
    qaClip,
    exportClip,
  };
}
