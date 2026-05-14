/**
 * HyperFrames clip controller — the seam between the canvas scene graph and
 * the iframe-hosted HyperFrames runtime.
 *
 * Responsibilities:
 *   - Mount/unmount a HyperFrames preview iframe inside a canvas slot
 *   - Round-trip patches through the bridge (POST /api/canvas/hyperframes/...)
 *     keeping the source HTML in element.meta.html canonical
 *   - Translate iframe picker hits to canvas-space coordinates so the
 *     selection box can be drawn over the iframe
 *   - Surface a debounced commit so dragging in the inspector doesn't slam
 *     the network on every keystroke
 *
 * Usage in ChatPage / canvas integration:
 *
 *   import { createHyperframesController } from '/static/components/creative/hyperframesController.js';
 *
 *   const ctrl = createHyperframesController({
 *     element,                  // a scene node where element.type === 'hyperframes'
 *     mount: slotEl,            // DOM container for the iframe
 *     api,                      // wrapper around fetch — must add auth headers
 *     onLayersChanged: (layers, extraction) => updateLayersPanel(layers, extraction),
 *     onExtractionChanged: (extraction) => updateInspector(extraction),
 *     onSourceChanged: (html)   => updateElementMeta(element.id, { html }),
 *     onPick: (info, canvasXY)  => selectLayer(info.id),
 *   });
 *   ctrl.seek(0);
 *   ctrl.patch([{ op: 'set-text', elementId: 'title', text: 'New copy' }]);
 *   ctrl.dispose();
 */

import { createHyperframesPreview } from './hyperframesPreview.js';

const PATCH_DEBOUNCE_MS = 220;

export function createHyperframesController(options = {}) {
  const {
    element,
    mount,
    api,
    onLayersChanged = () => {},
    onExtractionChanged = () => {},
    onSourceChanged = () => {},
    onPick = () => {},
    onError = () => {},
    canvasScale = 1,
  } = options;

  if (!element || element.type !== 'hyperframes') {
    throw new Error('createHyperframesController: element.type must be "hyperframes"');
  }
  if (!mount || !api || typeof api.post !== 'function') {
    throw new Error('createHyperframesController: requires mount and api with post()');
  }

  let html = String(element.meta?.html || '');
  let layers = Array.isArray(element.meta?.layers) ? element.meta.layers : [];
  let extraction = buildExtractionFromMeta(element.meta || {}, layers);
  let pendingPatchOps = [];
  let patchTimer = null;
  let preview = null;
  let disposed = false;

  async function loadPreview() {
    try {
      const res = await api.post('/api/canvas/hyperframes/preview-html', { html });
      const previewHtml = res?.previewHtml || html;
      if (preview) {
        preview.setHtml(previewHtml);
      } else {
        preview = createHyperframesPreview({
          mount,
          html: previewHtml,
          width: element.width,
          height: element.height,
          onPick: (info) => {
            if (!info) return;
            const canvasXY = iframeToCanvas(info.boundingBox, element, canvasScale);
            onPick(info, canvasXY);
          },
          onError,
          onReady: () => {
            preview.enablePickMode();
          },
        });
      }
    } catch (err) {
      onError({ stage: 'load-preview', error: err?.message || String(err) });
    }
  }

  function applyExtraction(res = {}) {
    const nextExtraction = buildExtractionFromMeta({
      ...(element.meta || {}),
      ...res,
      layers: Array.isArray(res.layers) ? res.layers : layers,
    }, Array.isArray(res.layers) ? res.layers : layers);
    layers = nextExtraction.layers;
    extraction = nextExtraction;
    onLayersChanged(layers, extraction);
    onExtractionChanged(extraction);
  }

  async function refreshLayers() {
    try {
      const res = await api.post('/api/canvas/hyperframes/extract-layers', { html });
      if (res?.success) {
        applyExtraction(res);
      }
    } catch (err) {
      onError({ stage: 'extract-layers', error: err?.message || String(err) });
    }
  }

  function flushPatchSoon() {
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(flushPatchNow, PATCH_DEBOUNCE_MS);
  }

  async function flushPatchNow() {
    if (!pendingPatchOps.length || disposed) return;
    const ops = pendingPatchOps;
    pendingPatchOps = [];
    if (patchTimer) { clearTimeout(patchTimer); patchTimer = null; }
    try {
      const res = await api.post('/api/canvas/hyperframes/apply-patch', { html, ops });
      if (res?.success) {
        html = String(res.html || html);
        onSourceChanged(html);
        applyExtraction(res);
        // Reload preview with new source so visuals update.
        if (preview) preview.setHtml(await wrappedPreviewHtml());
      } else if (res?.warnings?.length) {
        onError({ stage: 'apply-patch', warnings: res.warnings });
      }
    } catch (err) {
      onError({ stage: 'apply-patch', error: err?.message || String(err) });
    }
  }

  async function wrappedPreviewHtml() {
    try {
      const res = await api.post('/api/canvas/hyperframes/preview-html', { html });
      return res?.previewHtml || html;
    } catch {
      return html;
    }
  }

  // Initial mount
  Promise.resolve().then(async () => {
    await loadPreview();
    await refreshLayers();
  });

  return {
    element,
    getHtml: () => html,
    getLayers: () => layers.slice(),
    getTracks: () => (Array.isArray(extraction.tracks) ? extraction.tracks.slice() : []),
    getExtraction: () => ({ ...extraction }),
    seek: (timeMs) => preview && preview.seek(timeMs),
    play: () => preview && preview.play(),
    pause: () => preview && preview.pause(),
    enablePickMode: () => preview && preview.enablePickMode(),
    disablePickMode: () => preview && preview.disablePickMode(),
    pickAtPoint: (x, y) => preview && preview.pickAtPoint(x, y),
    /**
     * Queue patch ops. They flush after PATCH_DEBOUNCE_MS or when flush() is
     * called explicitly. Use this from inspector slider/text inputs.
     */
    patch(ops, { immediate = false } = {}) {
      if (!Array.isArray(ops) || ops.length === 0) return;
      pendingPatchOps.push(...ops);
      if (immediate) return flushPatchNow();
      flushPatchSoon();
    },
    flush: flushPatchNow,
    setHtml(nextHtml) {
      html = String(nextHtml || '');
      onSourceChanged(html);
      loadPreview();
      refreshLayers();
    },
    refreshLayers,
    dispose() {
      disposed = true;
      if (patchTimer) clearTimeout(patchTimer);
      if (preview) preview.dispose();
      preview = null;
    },
  };
}

function buildExtractionFromMeta(meta = {}, fallbackLayers = []) {
  return {
    compositionId: String(meta.compositionId || ''),
    durationMs: Math.max(100, Number(meta.durationMs) || 6000),
    variables: Array.isArray(meta.variables) ? meta.variables : (meta.variables && typeof meta.variables === 'object' ? meta.variables : {}),
    layers: Array.isArray(meta.layers) ? meta.layers : (Array.isArray(fallbackLayers) ? fallbackLayers : []),
    tracks: Array.isArray(meta.tracks) ? meta.tracks : [],
    slots: Array.isArray(meta.slots) ? meta.slots : [],
    variableBindings: Array.isArray(meta.variableBindings) ? meta.variableBindings : [],
    advancedBlock: meta.advancedBlock === true,
    warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
    assets: Array.isArray(meta.assets) ? meta.assets : [],
    ingest: meta.ingest && typeof meta.ingest === 'object' ? meta.ingest : null,
  };
}

/**
 * Iframe-relative bounding box -> canvas-space coords. The iframe occupies
 * a region within the canvas; HF clips render at their own intrinsic size
 * (typically 1080x1920) and are scaled to the element's width/height. We
 * compute the canvas point relative to the element origin.
 */
function iframeToCanvas(boundingBox, element, canvasScale = 1) {
  if (!boundingBox || !element) return null;
  const intrinsicWidth = element.meta?.intrinsicWidth || element.width;
  const intrinsicHeight = element.meta?.intrinsicHeight || element.height;
  const sx = element.width / Math.max(1, intrinsicWidth);
  const sy = element.height / Math.max(1, intrinsicHeight);
  return {
    x: element.x + boundingBox.x * sx,
    y: element.y + boundingBox.y * sy,
    width: boundingBox.width * sx,
    height: boundingBox.height * sy,
    canvasScale,
  };
}
