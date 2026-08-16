/**
 * Creative Editor entry point — live viewport, timeline, media, and export.
 *
 * Usage (ChatPage.js):
 *   Import syncCreativeEditor from this module and call it in applyCreativeModeUI().
 *   syncCreativeEditor({ mode, shell, scene, api });
 */

import { createStore, createEditorState } from './store.js';
import { createEditorLayout } from './layout.js';
import { applySceneGraphOps } from '../sceneGraph.js';
import { createViewport } from './preview/viewport.js';
import { clearPreviewMediaCache, createRenderer, hitTestScene } from './preview/renderer.js';
import { createPropertiesPanel } from './properties/panel.js';
import { createAssetsPanel } from './assets/panel.js';
import { createHandlesOverlay } from './interactions/handles.js';
import { createTextEditor } from './interactions/text-edit.js';
import { createContextMenu } from './interactions/context-menu.js';
import { createExportDialog } from './export/dialog.js';
import { createHistory } from './history/index.js';
import { createShortcuts } from './shortcuts/index.js';
import { createGraphEditor } from './timeline/graph-editor.js';
import { createTimelineEditor } from './timeline/editor.js';
import { createSubtitlesPanel } from './subtitles/panel.js';
import { createTextPanel } from './panels/text-panel.js';
import { createShapesPanel } from './panels/shapes-panel.js';
import { createEffectsPanel } from './panels/effects-panel.js';
import { createFiltersPanel } from './panels/filters-panel.js';
import { syncCreativeAudioPreviewToTimeline, stopCreativeAudioPreview } from '../audioEngine.js';

// ── Feature flag ─────────────────────────────────────────────────────────────
// Server config (creative_editor.enabled) wins; localStorage is dev override.
let _flagResolved = false;
let _flagEnabled  = false;

async function resolveFlag() {
  if (_flagResolved) return _flagEnabled;
  // localStorage fast path for development
  if (typeof localStorage !== 'undefined' && localStorage.getItem('prometheus_creative_editor') === 'on') {
    _flagResolved = true;
    _flagEnabled  = true;
    return true;
  }
  // Runtime flag set by server config at boot
  if (window.prometheusCreativeCore?.featureFlags?.creativeEditorEnabled === true) {
    _flagResolved = true;
    _flagEnabled  = true;
    return true;
  }
  try {
    const r = await fetch('/api/settings/features');
    if (r.ok) {
      const d = await r.json();
      _flagEnabled = d.creativeEditorEnabled === true;
    }
  } catch { /* keep false */ }
  _flagResolved = true;
  return _flagEnabled;
}

// ── Singleton editor instance ─────────────────────────────────────────────────
let _instance = null;

/**
 * createCreativeEditor({ root, scene, api }) → { mount, unmount, dispose }
 *
 * @param {object} opts
 * @param {Element} opts.root — container element (canvas-creative-shell)
 * @param {object}  opts.scene — window.prometheusCreativeScene ref
 * @param {object}  opts.api   — window.prometheusCreativeCore ref
 */
export function createCreativeEditor({ root, scene, api, compositionBridge = null }) {
  const store = createStore(createEditorState());
  let layout = null;
  let _hiddenChildren = [];
  let sceneRef = scene || window.prometheusCreativeScene || null;
  let compositionBridgeRef = compositionBridge || window.prometheusCreativeCompositionBridge || null;

  // Sync store.durationMs from scene
  function syncDuration() {
    const activeScene = getScene();
    const baseDuration = activeScene && typeof activeScene.durationMs === 'number'
      ? activeScene.durationMs
      : 0;
    const contentEnd = (activeScene?.elements || []).reduce((max, element) => {
      const start = Math.max(0, Number(element?.meta?.startMs ?? element?.startMs) || 0);
      const explicitEnd = Number(element?.meta?.endMs ?? element?.endMs);
      const duration = Number(element?.meta?.durationMs ?? element?.durationMs);
      const end = Number.isFinite(explicitEnd) && explicitEnd > start
        ? explicitEnd
        : start + Math.max(0, duration || 0);
      return Math.max(max, end);
    }, 0);
    const audio = activeScene?.audioTrack || {};
    const audioEnd = Math.max(0, Number(audio.startMs) || 0)
      + Math.max(0, Number(audio.durationMs) || Number(audio.analysis?.durationMs) || 0);
    const d = Math.max(1000, baseDuration, contentEnd, audioEnd);
    store.setState(s => ({
      durationMs: d,
      timeMs: Math.min(Math.max(0, Number(s.timeMs) || 0), Math.max(0, d)),
      playing: d > 0 ? s.playing : false,
    }));
  }

  function getScene() {
    return sceneRef || window.prometheusCreativeScene || null;
  }

  function setScene(nextScene) {
    if (!nextScene) return;
    sceneRef = nextScene;
    window.prometheusCreativeScene = nextScene;
    syncDuration();
    _renderer?.markDirty?.();
    _handles?.render?.();
    _graphEditor?.draw?.();
    _timelineEditor?.render?.();
    _subsPanel?.render?.();
  }

  let _viewport     = null;
  let _renderer     = null;
  let _propPanel    = null;
  let _assetsPanel  = null;
  let _audioPanel   = null;
  let _handles      = null;
  let _textEditor   = null;
  let _contextMenu  = null;
  let _exportDialog = null;
  let _history      = null;
  let _shortcuts    = null;
  let _graphEditor  = null;
  let _timelineEditor = null;
  let _subsPanel    = null;
  let _textPanel    = null;
  let _shapesPanel  = null;
  let _effectsPanel = null;
  let _filtersPanel = null;
  let _playbackOverlay = null;

  function replaceScene(nextScene) {
    const target = getScene();
    if (!target || !nextScene) return;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, nextScene);
    sceneRef = target;
    window.prometheusCreativeScene = target;
  }

  function applyEditorOps(ops, options = {}) {
    const list = Array.isArray(ops) ? ops : [ops];
    if (!list.length) return getScene();
    const runner = api?.applySceneGraphOps || applySceneGraphOps;
    replaceScene(runner(getScene(), list));
    syncDuration();
    if (options.selectedIds) store.setState({ selectedIds: options.selectedIds });
    else store.setState(s => ({ ...s }));
    _renderer?.markDirty?.();
    if (options.history !== false) _history?.commit();
    if (options.persist !== false) persistSceneSoon();
    return getScene();
  }

  function applySceneSnapshot(snapshot) {
    applyEditorOps({ op: 'set-scene', patch: snapshot }, { history: false });
    // Track buttons mirror persisted element/audio metadata. Reset their
    // transient category flags when undo/redo swaps in a snapshot.
    const validIds = new Set((getScene()?.elements || []).map(element => element.id));
    store.setState(s => ({
      mutedTracks: [],
      hiddenTracks: [],
      selectedIds: (s.selectedIds || []).filter(id => validIds.has(id)),
    }));
  }

  let _persistTimer = null;
  function persistSceneSoon() {
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      const sessionId = window.currentCreativeSessionId || window.currentChatSessionId || window.activeChatSessionId || '';
      const mode = window.currentCreativeMode || 'video';
      if (!sessionId) return;
      fetch('/api/canvas/creative-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode, filename: `${mode}-scene.json`, doc: getScene() }),
      }).catch(() => {});
    }, 700);
  }

  function mount(container, opts = {}) {
    if (!container) return;
    if (layout) return; // already mounted

    syncDuration();

    _hiddenChildren = Array.from(container.children);
    for (const child of _hiddenChildren) child.style.display = 'none';

    layout = createEditorLayout(container);
    container.appendChild(layout.root);

    const p = layout.panes;

    // ── Left tabs ────────────────────────────────────────────────────────────
    _assetsPanel = createAssetsPanel({
      container: p.media, store, getScene, applyOps: applyEditorOps,
    });

    _audioPanel = createAssetsPanel({
      container: p.audio,
      store,
      getScene,
      applyOps: applyEditorOps,
      filterType: 'audio',
    });

    _textPanel = createTextPanel({
      container: p.text, store, getScene, applyOps: applyEditorOps,
    });

    _shapesPanel = createShapesPanel({
      container: p.shapes, store, getScene, applyOps: applyEditorOps,
    });

    _effectsPanel = createEffectsPanel({
      container: p.effects, store, getScene, applyOps: applyEditorOps,
    });

    _filtersPanel = createFiltersPanel({
      container: p.filters, store, getScene, applyOps: applyEditorOps,
    });

    _subsPanel = createSubtitlesPanel({
      container: p.captions, store, getScene, applyOps: applyEditorOps,
    });

    // ── Center: viewport + renderer ──────────────────────────────────────────
    mountPreview(p.preview);

    // ── Right tabs ───────────────────────────────────────────────────────────
    _propPanel = createPropertiesPanel({
      container: p.properties, store, getScene, applyOps: applyEditorOps,
    });

    _graphEditor = createGraphEditor({
      container: p.keyframes, store, getScene, applyOps: applyEditorOps,
    });

    // Switch right panel to Properties when an element is selected
    store.derive(s => s.selectedIds?.[0], id => {
      if (id) layout.switchTab('right', 'properties');
    });

    // ── Bottom: timeline ─────────────────────────────────────────────────────
    _timelineEditor = createTimelineEditor({
      container: p.timeline,
      store,
      getScene,
      applyOps: applyEditorOps,
      getCompositionBridge: () => compositionBridgeRef || window.prometheusCreativeCompositionBridge || null,
    });

    // Export button
    mountExportBtn(layout.panes);

    _history = createHistory({ getScene, applySnapshot: applySceneSnapshot });
    _shortcuts = createShortcuts({
      store,
      getScene,
      history: _history,
      viewport: _viewport,
      textEditor: _textEditor,
      timeline: _timelineEditor,
      applyOps: applyEditorOps,
    });
  }

  function mountPreview(el) {
    let _lastClickTime = 0;

    _viewport = createViewport({
      container: el,
      store,
      onHitTest: (sceneCoords, event) => {
        if (_textEditor?.isActive()) return; // let text editor handle

        const { timeMs } = store.getState();
        const hit = hitTestScene(sceneCoords.x, sceneCoords.y, getScene(), timeMs);
        const newId = hit?.id ?? null;
        const { selectedIds } = store.getState();

        // Double-click on text element → activate in-place editor
        const now = Date.now();
        const isDblClick = (now - _lastClickTime) < 350;
        _lastClickTime = now;
        if (isDblClick && hit && (hit.type === 'text')) {
          _textEditor?.activate(hit);
          return;
        }

        if (newId && selectedIds?.[0] === newId) {
          store.setState({ selectedIds: [] });
        } else {
          store.setState({ selectedIds: newId ? [newId] : [] });
        }
      },
    });

    _renderer = createRenderer({
      viewport: _viewport,
      store,
      getScene,
    });

    // Phase 6: handles + text editor + context menu
    _handles = createHandlesOverlay({
      viewportRoot: _viewport.root,
      store,
      getScene,
      applyOps: applyEditorOps,
    });

    _textEditor = createTextEditor({
      viewportRoot: _viewport.root,
      store,
      getScene,
      applyOps: applyEditorOps,
    });

    _contextMenu = createContextMenu({
      viewportRoot: _viewport.root,
      store,
      getScene,
      onAction: (action, el) => handleContextAction(action, el),
    });

    // Accept asset drags onto the preview canvas
    _viewport.root.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('text/ce-asset-id')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    _viewport.root.addEventListener('drop', e => {
      const assetId = e.dataTransfer.getData('text/ce-asset-id');
      if (assetId) {
        e.preventDefault();
        _assetsPanel?.handleExternalDrop(assetId);
      }
    });

    mountPlaybackOverlay(el);
  }

  function handleContextAction(action, el) {
    if (!el && action !== 'paste' && action !== 'selectAll' && action !== 'fit') return;
    const activeScene = getScene();
    const elements = activeScene?.elements;
    if (!elements) return;

    if (action === 'delete') {
      if (el.locked || el.meta?.locked) return;
      applyEditorOps({ op: 'delete', id: el.id }, { selectedIds: [] });
    } else if (action === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(el));
      copy.id = 'el_' + Math.random().toString(36).slice(2);
      copy.x  = (copy.x || 0) + 20;
      copy.y  = (copy.y || 0) + 20;
      applyEditorOps({ op: 'add', ...copy }, { selectedIds: [copy.id] });
    } else if (action === 'bringToFront') {
      const maxZ = Math.max(...elements.map(e => e.zIndex || 0));
      applyEditorOps({ op: 'set', id: el.id, patch: { zIndex: maxZ + 1 } });
    } else if (action === 'sendToBack') {
      const minZ = Math.min(...elements.map(e => e.zIndex || 0));
      applyEditorOps({ op: 'set', id: el.id, patch: { zIndex: minZ - 1 } });
    } else if (action === 'selectAll') {
      store.setState({ selectedIds: elements.filter(e => e.locked !== true && e.meta?.locked !== true).map(e => e.id) });
    } else if (action === 'fit') {
      _viewport?.fitToScreen();
    }
  }

  function mountExportBtn(panes) {
    _exportDialog = createExportDialog({ store, getScene });
    const btn = document.createElement('button');
    btn.className = 'ce-export-trigger-btn';
    btn.textContent = '⬆ Export';
    btn.addEventListener('click', () => _exportDialog.open());
    // Place export button in the header's right slot (not on the grid root)
    const host = panes.exportHost || panes.preview?.parentElement;
    if (host) host.appendChild(btn);

    // Wire header undo/redo buttons
    panes.hdrUndo?.addEventListener('click', () => _history?.undo());
    panes.hdrRedo?.addEventListener('click', () => _history?.redo());
  }

  function mountPlaybackOverlay(el) {
    const overlay = document.createElement('div');
    overlay.className = 'ce-playback-overlay';
    overlay.innerHTML = `
      <button class="ce-ctrl-btn" data-ce-action="play" title="Play / Pause">▶</button>
      <div class="ce-timecode" data-ce-timecode>0:00.000</div>
      <input type="range" class="ce-scrubber" data-ce-scrubber
        min="0" max="${store.getState().durationMs || 5000}" step="10" value="0">
      <div class="ce-timecode" data-ce-duration>${fmtTime(store.getState().durationMs || 5000)}</div>
    `;
    el.appendChild(overlay);

    const playBtn  = overlay.querySelector('[data-ce-action="play"]');
    const scrubber = overlay.querySelector('[data-ce-scrubber]');
    const timecode = overlay.querySelector('[data-ce-timecode]');
    const durLabel = overlay.querySelector('[data-ce-duration]');

    // Update scrubber + timecode from store
    const unsub = store.subscribe(s => {
      const t = Math.round(s.timeMs);
      if (timecode) timecode.textContent = fmtTime(t);
      if (scrubber && !scrubber.matches(':active')) scrubber.value = t;
      if (playBtn) playBtn.textContent = s.playing ? '⏸' : '▶';
      if (durLabel && s.durationMs) {
        if (scrubber) scrubber.max = s.durationMs;
        durLabel.textContent = fmtTime(s.durationMs);
      }
      syncCreativeAudioPreviewToTimeline({
        mode: 'video',
        timelineMs: s.timeMs,
        durationMs: s.durationMs || 5000,
        track: {
          ...(getScene()?.audioTrack || {}),
          muted: (getScene()?.audioTrack?.muted === true)
            || s.mutedTracks?.includes('audio')
            || s.hiddenTracks?.includes('audio'),
        },
        playing: s.playing,
      });
    });
    overlay._unsub = unsub;
    _playbackOverlay = overlay;

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        store.setState(s => ({ playing: !s.playing }));
      });
    }
    if (scrubber) {
      scrubber.addEventListener('input', () => {
        store.setState({ timeMs: Number(scrubber.value), playing: false });
        syncCreativeAudioPreviewToTimeline({
          mode: 'video',
          timelineMs: Number(scrubber.value),
          durationMs: store.getState().durationMs || 5000,
          track: {
            ...(getScene()?.audioTrack || {}),
            muted: (getScene()?.audioTrack?.muted === true)
              || store.getState().mutedTracks?.includes('audio')
              || store.getState().hiddenTracks?.includes('audio'),
          },
          playing: false,
          forceSeek: true,
        });
      });
    }
  }

  function unmount() {
    if (!layout) return;
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    if (_shortcuts)    { _shortcuts.dispose();    _shortcuts    = null; }
    if (_timelineEditor) { _timelineEditor.dispose(); _timelineEditor = null; }
    if (_playbackOverlay?._unsub) { _playbackOverlay._unsub(); _playbackOverlay = null; }
    if (_graphEditor)  { _graphEditor.dispose();  _graphEditor  = null; }
    if (_subsPanel)    { _subsPanel.dispose();    _subsPanel    = null; }
    if (_effectsPanel) { _effectsPanel.dispose(); _effectsPanel = null; }
    if (_filtersPanel) { _filtersPanel.dispose(); _filtersPanel = null; }
    if (_textPanel)    { _textPanel.dispose();    _textPanel    = null; }
    if (_shapesPanel)  { _shapesPanel.dispose();  _shapesPanel  = null; }
    if (_exportDialog) { _exportDialog.dispose(); _exportDialog = null; }
    if (_contextMenu)  { _contextMenu.dispose();  _contextMenu  = null; }
    if (_textEditor)   { _textEditor.dispose();   _textEditor   = null; }
    if (_handles)      { _handles.dispose();      _handles      = null; }
    if (_propPanel)    { _propPanel.dispose();    _propPanel    = null; }
    if (_audioPanel)   { _audioPanel.dispose();   _audioPanel   = null; }
    if (_assetsPanel)  { _assetsPanel.dispose();  _assetsPanel  = null; }
    if (_renderer)     { _renderer.dispose();     _renderer     = null; }
    if (_viewport)     { _viewport.dispose();     _viewport     = null; }
    clearPreviewMediaCache();
    layout.dispose();
    layout = null;
    _history = null;
    stopCreativeAudioPreview({ reset: true, dispose: true });
    // Restore original shell children
    for (const child of _hiddenChildren) child.style.removeProperty('display');
    _hiddenChildren = [];
  }

  function dispose() {
    unmount();
    store.setState(createEditorState()); // reset
  }

  function hydrateCreativeAssets(payload = {}, options = {}) {
    const assets = normalizeCreativeEditorAssets(payload);
    _assetsPanel?.setAssets?.(assets, options);
    if (!_assetsPanel && assets.length) {
      const current = Array.isArray(store.getState().mediaAssets) ? store.getState().mediaAssets : [];
      const byId = new Map(current.map(asset => [asset.id, asset]));
      for (const asset of assets) byId.set(asset.id, { ...byId.get(asset.id), ...asset });
      store.setState({ mediaAssets: Array.from(byId.values()) });
    }
  }

  function setCompositionBridge(nextBridge) {
    compositionBridgeRef = nextBridge || window.prometheusCreativeCompositionBridge || null;
    _timelineEditor?.render?.();
  }

  return { mount, unmount, dispose, store, setScene, getScene, setCompositionBridge, hydrateCreativeAssets };
}

function normalizeCreativeEditorAssets(payload = {}) {
  const sourceLists = [
    payload.indexedAssets,
    payload.assets,
    payload.exports,
    payload.scenes,
    payload.creativeAssetsState?.indexedAssets,
    payload.creativeAssetsState?.exports,
  ].filter(Array.isArray);
  const out = [];
  for (const list of sourceLists) {
    for (const raw of list) {
      const asset = normalizeCreativeEditorAsset(raw);
      if (asset) out.push(asset);
    }
  }
  return out;
}

function normalizeCreativeEditorAsset(raw = {}) {
  const path = String(raw.path || raw.relativePath || raw.source || '').trim().replace(/\\/g, '/');
  const src = raw.url || raw.src || raw.dataUrl || (/^(https?:|blob:|data:)/i.test(path) ? path : (path ? `/api/canvas/inline?path=${encodeURIComponent(path)}` : ''));
  if (!src) return null;
  const mime = String(raw.mimeType || raw.type || '').toLowerCase();
  const kind = String(raw.kind || raw.assetType || raw.type || '').toLowerCase();
  const ext = String(raw.ext || path.split('?')[0].split('.').pop() || '').toLowerCase();
  const type = kind === 'video' || mime.startsWith('video/') || ['mp4','mov','webm','mkv','m4v'].includes(ext)
    ? 'video'
    : kind === 'audio' || mime.startsWith('audio/') || ['mp3','wav','m4a','aac','ogg','flac'].includes(ext)
      ? 'audio'
      : 'image';
  const id = String(raw.id || raw.assetId || path || src);
  const thumbPath = String(raw.thumbnailUrl || raw.thumbnailPath || raw.poster || '').trim().replace(/\\/g, '/');
  const thumbnail = /^(https?:|blob:|data:)/i.test(thumbPath)
    ? thumbPath
    : (thumbPath ? `/api/canvas/inline?path=${encodeURIComponent(thumbPath)}` : (type === 'image' ? src : null));
  return {
    id,
    name: raw.name || raw.filename || path.split('/').pop() || type,
    type,
    mimeType: raw.mimeType || '',
    src,
    source: src,
    thumbnail,
    duration: Number(raw.durationMs ?? raw.duration) || null,
    width: Number(raw.width) || null,
    height: Number(raw.height) || null,
    peaks: raw.peaks || null,
    path: path || null,
    absPath: raw.absPath || null,
    persisted: true,
    metadata: raw.metadata || null,
  };
}

/**
 * syncCreativeEditor — the single call-site function invoked from ChatPage.js.
 * Handles mount/unmount lifecycle based on active creative mode.
 */
export async function syncCreativeEditor({ mode, shell, scene, api, compositionBridge = null }) {
  const enabled = await resolveFlag();
  if (!enabled) return;

  // Only mount the video editor for 'video' mode.
  // Image, design, and other modes keep their own native canvas UI untouched.
  const isVideoMode = mode === 'video';
  const bridge = compositionBridge || window.prometheusCreativeCompositionBridge || null;

  if (isVideoMode && shell) {
    if (!_instance) {
      _instance = createCreativeEditor({ root: shell, scene, api, compositionBridge: bridge });
    }
    _instance.setCompositionBridge?.(bridge);
    _instance.setScene?.(scene || window.prometheusCreativeScene);
    _instance.mount(shell, { mode, scene });
    if (window.prometheusCreativeAssetsState) {
      _instance.hydrateCreativeAssets?.(window.prometheusCreativeAssetsState);
    }
    window.prometheusCreativeEditor = _instance;
    if (shell) shell.dataset.creativeEditor = 'on';
    if (document.body) document.body.classList.add('creative-editor-on');
  } else {
    // Non-video mode (image, design, etc.) — unmount video editor if active
    if (_instance) {
      _instance.unmount();
    }
    if (window.prometheusCreativeEditor === _instance) delete window.prometheusCreativeEditor;
    if (shell) delete shell.dataset.creativeEditor;
    if (document.body) document.body.classList.remove('creative-editor-on');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(isNaN(ms) ? 0 : ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const f = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}
