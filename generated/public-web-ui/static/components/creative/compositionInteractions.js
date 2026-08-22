function editorStore() {
  return window.prometheusCreativeEditor?.store || null;
}

function bridge() {
  return window.prometheusCreativeCompositionBridge || null;
}

function activeComposition() {
  try { return bridge()?.getComposition?.() || null; } catch { return null; }
}

function getAsset(assetId) {
  const assets = editorStore()?.getState?.()?.mediaAssets || [];
  return assets.find((asset) => String(asset?.id || '') === String(assetId || '')) || null;
}

function getClip(clipId) {
  const clips = activeComposition()?.clips || [];
  return clips.find((clip) => String(clip?.id || '') === String(clipId || '')) || null;
}

function timelineContext() {
  const root = document.querySelector('.ce-timeline-editor');
  const lanes = root?.querySelector?.('[data-ce-lanes]');
  const rect = lanes?.getBoundingClientRect?.() || null;
  const comp = activeComposition();
  const state = editorStore()?.getState?.() || {};
  const duration = Math.max(1000, Number(comp?.durationMs) || 0, Number(state.durationMs) || 0);
  return { root, lanes, rect, duration };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function timeFromClientX(clientX) {
  const { rect, duration } = timelineContext();
  if (!rect || rect.width <= 0) return 0;
  return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
}

function snapTime(rawTime, excludeClipId = '') {
  const store = editorStore();
  if (store?.getState?.()?.timelineSnap === false) return rawTime;
  const { rect, duration } = timelineContext();
  const comp = activeComposition();
  const points = [0, duration, Number(store?.getState?.()?.timeMs) || 0];
  for (const clip of comp?.clips || []) {
    if (String(clip?.id || '') === String(excludeClipId || '')) continue;
    points.push(Number(clip?.inMs) || 0, Number(clip?.outMs) || 0);
  }
  const threshold = Math.max(18, duration / Math.max(1, rect?.width || 640) * 10);
  let closest = rawTime;
  let distance = threshold;
  for (const point of points) {
    const nextDistance = Math.abs(point - rawTime);
    if (nextDistance <= distance) {
      distance = nextDistance;
      closest = point;
    }
  }
  return clamp(closest, 0, duration);
}

function compositionClipElement(clipId) {
  const safeId = String(clipId || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return document.querySelector(`[data-ce-comp-clip="${safeId}"]`);
}

function paintClip(clipId, start, end) {
  const el = compositionClipElement(clipId);
  if (!el) return;
  const { duration } = timelineContext();
  const left = clamp((start / duration) * 100, 0, 100);
  const width = clamp(((end - start) / duration) * 100, 0.4, 100 - left);
  el.style.left = `${left.toFixed(3)}%`;
  el.style.width = `${width.toFixed(3)}%`;
}

function ensureStyle() {
  if (document.getElementById('ce-composition-interactions-style')) return;
  const style = document.createElement('style');
  style.id = 'ce-composition-interactions-style';
  style.textContent = `
    [data-ce-comp-clip] { cursor: grab; touch-action: none; }
    [data-ce-comp-clip].ce-comp-dragging { cursor: grabbing; opacity: .88; }
    [data-ce-comp-clip] .ce-timeline-trim { opacity: .9; }
    .ce-asset-sequence-btn {
      margin-left:auto;border:1px solid rgba(214,179,90,.42);background:rgba(214,179,90,.1);
      color:#f0d98a;border-radius:5px;padding:1px 5px;font-size:9px;font-weight:800;cursor:pointer;
    }
    .ce-asset-sequence-btn:hover { background:rgba(214,179,90,.18); }
    [data-ce-composition-lane].ce-composition-drop-over { outline:1px solid rgba(214,179,90,.7); outline-offset:-1px; }
  `;
  document.head.appendChild(style);
}

function decorateCompositionClips() {
  for (const clip of document.querySelectorAll('[data-ce-comp-clip]')) {
    if (!clip.querySelector('[data-ce-comp-trim="head"]')) {
      const left = document.createElement('span');
      left.className = 'ce-timeline-trim ce-timeline-trim--left';
      left.dataset.ceCompTrim = 'head';
      left.title = 'Trim clip start';
      clip.prepend(left);
    }
    if (!clip.querySelector('[data-ce-comp-trim="tail"]')) {
      const right = document.createElement('span');
      right.className = 'ce-timeline-trim ce-timeline-trim--right';
      right.dataset.ceCompTrim = 'tail';
      right.title = 'Trim clip end';
      clip.appendChild(right);
    }
  }
}

function decorateVideoAssets() {
  for (const card of document.querySelectorAll('[data-asset-id]')) {
    if (card.querySelector('[data-ce-add-sequence]')) continue;
    const assetId = card.getAttribute('data-asset-id');
    const asset = getAsset(assetId);
    if (asset?.type !== 'video' || !asset?.path) continue;
    const meta = card.querySelector('.ce-asset-card__meta');
    if (!meta) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ce-asset-sequence-btn';
    button.dataset.ceAddSequence = assetId;
    button.title = 'Add this video to the multi-clip sequence at the playhead';
    button.textContent = 'Seq+';
    meta.appendChild(button);
  }
}

function decorate() {
  ensureStyle();
  decorateCompositionClips();
  decorateVideoAssets();
}

async function addVideoAssetToSequence(asset, atMs) {
  const b = bridge();
  if (!b || asset?.type !== 'video' || !asset?.path) return null;
  await b.openSequence?.();
  return b.addClip?.({
    lane: 'source-video',
    source: { kind: 'source-video', path: String(asset.path) },
    atMs: Math.max(0, Math.round(Number(atMs) || 0)),
    durationMs: Math.max(100, Math.round(Number(asset.duration) || 4000)),
    label: asset.name || 'Video clip',
  });
}

export function installCreativeCompositionTimelineInteractions() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return { dispose() {} };

  let drag = null;
  let observer = null;

  function beginCompositionDrag(event, clipEl) {
    const clipId = clipEl?.getAttribute?.('data-ce-comp-clip') || '';
    const clip = getClip(clipId);
    if (!clip || clip.locked === true) return;
    const trim = event.target?.closest?.('[data-ce-comp-trim]')?.getAttribute?.('data-ce-comp-trim') || '';
    drag = {
      clipId,
      kind: trim === 'head' ? 'trim-head' : trim === 'tail' ? 'trim-tail' : 'move',
      startPointerMs: timeFromClientX(event.clientX),
      initialInMs: Math.max(0, Number(clip.inMs) || 0),
      initialOutMs: Math.max(1, Number(clip.outMs) || 1),
      nextInMs: Math.max(0, Number(clip.inMs) || 0),
      nextOutMs: Math.max(1, Number(clip.outMs) || 1),
    };
    editorStore()?.setState?.({ selectedIds: [], playing: false });
    bridge()?.selectClip?.(clipId)?.catch?.(() => {});
    clipEl.classList.add('ce-comp-dragging');
    event.preventDefault();
  }

  function updateCompositionDrag(event) {
    if (!drag) return;
    const { duration } = timelineContext();
    const pointerMs = timeFromClientX(event.clientX);
    const delta = pointerMs - drag.startPointerMs;
    const clipDuration = Math.max(1, drag.initialOutMs - drag.initialInMs);

    if (drag.kind === 'move') {
      const rawStart = drag.initialInMs + delta;
      const start = clamp(snapTime(rawStart, drag.clipId), 0, Math.max(0, duration - clipDuration));
      drag.nextInMs = start;
      drag.nextOutMs = start + clipDuration;
    } else if (drag.kind === 'trim-head') {
      drag.nextInMs = clamp(snapTime(drag.initialInMs + delta, drag.clipId), 0, drag.initialOutMs - 50);
      drag.nextOutMs = drag.initialOutMs;
    } else {
      drag.nextInMs = drag.initialInMs;
      drag.nextOutMs = clamp(snapTime(drag.initialOutMs + delta, drag.clipId), drag.initialInMs + 50, duration);
    }
    paintClip(drag.clipId, drag.nextInMs, drag.nextOutMs);
    event.preventDefault();
  }

  async function commitCompositionDrag() {
    if (!drag) return;
    const current = drag;
    drag = null;
    compositionClipElement(current.clipId)?.classList.remove('ce-comp-dragging');
    const b = bridge();
    if (!b) return;
    try {
      if (current.kind === 'move') {
        await b.moveClip?.(current.clipId, { atMs: Math.round(current.nextInMs) });
      } else if (current.kind === 'trim-head') {
        await b.trimClip?.(current.clipId, 'head', Math.round(current.nextInMs));
      } else {
        await b.trimClip?.(current.clipId, 'tail', Math.round(current.nextOutMs));
      }
    } catch {
      b.openSequence?.({ force: true, silent: true }).catch?.(() => {});
    }
  }

  function onPointerDown(event) {
    const clipEl = event.target?.closest?.('[data-ce-comp-clip]');
    if (!clipEl) return;
    beginCompositionDrag(event, clipEl);
  }

  function onPointerMove(event) {
    if (drag) updateCompositionDrag(event);
  }

  function onPointerUp() {
    if (drag) void commitCompositionDrag();
  }

  function onClick(event) {
    const addButton = event.target?.closest?.('[data-ce-add-sequence]');
    if (!addButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const asset = getAsset(addButton.getAttribute('data-ce-add-sequence'));
    const atMs = Number(editorStore()?.getState?.()?.timeMs) || 0;
    if (asset) void addVideoAssetToSequence(asset, atMs);
  }

  function onDragOver(event) {
    const lane = event.target?.closest?.('[data-ce-composition-lane]');
    if (!lane || !event.dataTransfer?.types?.includes('text/ce-asset-id')) return;
    const assetId = event.dataTransfer.getData('text/ce-asset-id');
    const asset = getAsset(assetId);
    if (asset?.type !== 'video' || !asset?.path) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    lane.classList.add('ce-composition-drop-over');
  }

  function onDrop(event) {
    const lane = event.target?.closest?.('[data-ce-composition-lane]');
    if (!lane) return;
    lane.classList.remove('ce-composition-drop-over');
    const assetId = event.dataTransfer?.getData?.('text/ce-asset-id') || '';
    const asset = getAsset(assetId);
    if (asset?.type !== 'video' || !asset?.path) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void addVideoAssetToSequence(asset, timeFromClientX(event.clientX));
  }

  function onDragLeave(event) {
    event.target?.closest?.('[data-ce-composition-lane]')?.classList?.remove?.('ce-composition-drop-over');
  }

  function onKeyDown(event) {
    const tag = event.target?.tagName?.toLowerCase?.();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return;
    const b = bridge();
    const selectedClipId = activeComposition()?.selectedClipId || '';
    const sceneSelection = editorStore()?.getState?.()?.selectedIds || [];
    if (!b || !selectedClipId || sceneSelection.length) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void b.deleteSelected?.();
    } else if (key === 's' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void b.splitAtPlayhead?.();
    } else if (key === 'escape') {
      void b.selectClip?.(null);
    }
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('dragleave', onDragLeave, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('keydown', onKeyDown, true);

  observer = new MutationObserver(() => decorate());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  decorate();

  return {
    dispose() {
      observer?.disconnect?.();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('dragleave', onDragLeave, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
