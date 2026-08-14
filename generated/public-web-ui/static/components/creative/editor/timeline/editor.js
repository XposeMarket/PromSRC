/**
 * Multi-track timeline for the Prometheus Creative Editor.
 *
 * The scene graph remains the source of truth. Elements are grouped into
 * stacked lanes (CapCut-style): clips are organised by category
 * (Text / Overlay / Video / Audio) and then greedily packed into sub-lanes so
 * overlapping clips appear on separate rows — a real multi-track layout that
 * works directly off the existing scene data.
 *
 * This timeline edits element timing metadata directly: meta.startMs,
 * meta.endMs, meta.durationMs, meta.trimStartMs and meta.trimEndMs. A vertical
 * drag onto a Video/Overlay lane re-stacks the clip via zIndex.
 */

import { assetToSceneElement } from '../assets/importer.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const f = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

function fmtTick(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function safeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function elementTiming(el, sceneDuration) {
  const start = Math.max(0, Number(el?.meta?.startMs ?? el?.startMs) || 0);
  const explicitEnd = Number(el?.meta?.endMs ?? el?.endMs);
  const duration = Math.max(100, Number(el?.meta?.durationMs ?? el?.durationMs) || sceneDuration || 1000);
  const end = Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : Math.min(sceneDuration, start + duration);
  return {
    start,
    end: Math.max(start + 100, end),
    duration: Math.max(100, end - start),
    trimStart: Math.max(0, Number(el?.meta?.trimStartMs) || 0),
    trimEnd: Math.max(0, Number(el?.meta?.trimEndMs) || 0),
  };
}

function sceneTimelineDuration(scene, composition, store) {
  const base = Math.max(
    1000,
    Number(composition?.durationMs) || 0,
    Number(scene?.durationMs) || 0,
    Number(store?.getState?.().durationMs) || 0,
  );
  const elementEnd = (scene?.elements || []).reduce((max, el) => {
    const timing = elementTiming(el, base);
    return Math.max(max, timing.end);
  }, 0);
  const audio = scene?.audioTrack || {};
  const audioEnd = Math.max(0, Number(audio.startMs) || 0)
    + Math.max(0, Number(audio.durationMs) || Number(audio.analysis?.durationMs) || 0);
  return Math.max(base, elementEnd, audioEnd);
}

function createClipId() {
  return 'el_' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
}

const CAT_ORDER = ['text', 'overlay', 'video', 'audio'];
const CAT_LABEL = { text: 'Text', overlay: 'Overlay', video: 'Video', audio: 'Audio' };

function categoryOf(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'audio') return 'audio';
  if (t === 'text' || t === 'caption' || t === 'subtitle') return 'text';
  if (t === 'video' || t === 'image' || t === 'img') return 'video';
  return 'overlay';
}

/** Group elements into stacked lanes; pack overlapping clips into sub-lanes. */
function buildLanes(elements, duration) {
  const byCat = { text: [], overlay: [], video: [], audio: [] };
  for (const el of elements) {
    byCat[categoryOf(el.type)].push({ el, timing: elementTiming(el, duration) });
  }
  const lanes = [];
  for (const cat of CAT_ORDER) {
    const items = byCat[cat].sort((a, b) => a.timing.start - b.timing.start);
    if (!items.length) continue;
    const sub = [];
    for (const item of items) {
      let placed = false;
      for (const lane of sub) {
        if (item.timing.start >= lane.lastEnd - 1) {
          lane.items.push(item);
          lane.lastEnd = item.timing.end;
          placed = true;
          break;
        }
      }
      if (!placed) sub.push({ items: [item], lastEnd: item.timing.end });
    }
    sub.forEach((lane, i) => {
      lanes.push({ cat, label: CAT_LABEL[cat] + (sub.length > 1 ? ` ${i + 1}` : ''), items: lane.items });
    });
  }
  return lanes;
}

function renderClip(item, duration, selectedIds, trackMuted = false) {
  const { el, timing } = item;
  const left = clamp((timing.start / duration) * 100, 0, 100);
  const width = clamp(((timing.end - timing.start) / duration) * 100, 0.4, 100 - left);
  const selected = selectedIds?.includes(el.id) ? ' ce-timeline-clip--selected' : '';
  const cat = categoryOf(el.type);
  const label = el.name || el.meta?.content || el.type || el.id;
  const locked = el.locked === true || el.meta?.locked === true ? ' is-locked' : '';
  const muted = el.meta?.muted === true || trackMuted ? ' is-muted' : '';
  return `
    <div class="ce-track-row__clip ce-clip--${cat}${selected}${locked}${muted}" data-ce-clip="${safeHtml(el.id)}"
      style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"
      title="${safeHtml(label)} • ${fmtTime(timing.start)} - ${fmtTime(timing.end)}">
      <span class="ce-timeline-trim ce-timeline-trim--left" data-ce-trim="left"></span>
      <span class="ce-timeline-clip-label">${safeHtml(label)}</span>
      <span class="ce-timeline-trim ce-timeline-trim--right" data-ce-trim="right"></span>
    </div>
  `;
}

function renderTicks(duration) {
  const count = 10;
  let out = '';
  for (let i = 0; i <= count; i++) {
    const pct = (i / count) * 100;
    out += `<span class="ce-tl-tick" style="left:${pct.toFixed(2)}%"><span class="ce-tl-tick-label">${fmtTick((duration * i) / count)}</span></span>`;
  }
  return out;
}

function renderCompositionClip(clip, duration, selectedId) {
  const start = Math.max(0, Number(clip?.inMs) || 0);
  const end = Math.max(start + 100, Number(clip?.outMs) || start + 1000);
  const left = (start / duration) * 100;
  const width = Math.max(0.4, ((end - start) / duration) * 100);
  const selected = selectedId && selectedId === clip.id ? ' is-selected' : '';
  const label = clip.label || clip.source?.path || clip.id;
  return `
    <div class="ce-track-row__clip ce-clip--video${selected}" data-ce-comp-clip="${safeHtml(clip.id)}"
      style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"
      title="${safeHtml(label)} • ${fmtTime(start)} - ${fmtTime(end)}">
      <span class="ce-timeline-clip-label">${safeHtml(label)}</span>
    </div>
  `;
}

export function createTimelineEditor({ container, store, getScene, applyOps, getCompositionBridge = null }) {
  let drag = null;
  let renderedDuration = 12000;
  let renderedContentWidth = 0;

  function bridge() {
    try { return typeof getCompositionBridge === 'function' ? getCompositionBridge() : null; } catch { return null; }
  }

  function render() {
    const scene = getScene() || {};
    const b = bridge();
    const comp = b?.getComposition?.() || null;
    const seq = b?.getSequenceState?.() || null;
    const duration = sceneTimelineDuration(scene, comp, store);
    renderedDuration = duration;
    const zoom = clamp(Number(store.getState().timelineZoom) || 1, 0.5, 4);
    const availableWidth = Math.max(520, container.clientWidth || 760);
    renderedContentWidth = Math.max(availableWidth, Math.round(availableWidth * zoom));
    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const state = store.getState();
    const selectedIds = state.selectedIds || [];
    const mutedTracks = new Set(state.mutedTracks || []);
    const hiddenTracks = new Set(state.hiddenTracks || []);
    const timeMs = clamp(Number(state.timeMs) || Number(b?.getPlayheadMs?.()) || 0, 0, duration);
    const playheadLeft = (timeMs / duration) * 100;
    const lanes = buildLanes(elements, duration);
    const compClips = Array.isArray(comp?.clips) ? comp.clips.slice().sort((a, c) => (a.inMs || 0) - (c.inMs || 0)) : [];
    const selectedCompId = comp?.selectedClipId || null;

    const sceneRowsHtml = lanes.length
      ? lanes.map(lane => {
          const laneMuted = mutedTracks.has(lane.cat) || lane.items.every(item => item.el.meta?.muted === true);
          const laneHidden = hiddenTracks.has(lane.cat) || lane.items.every(item => item.el.meta?.hidden === true);
          return `
              <div class="ce-track-row${laneHidden ? ' ce-track-row--track-hidden' : ''}" data-ce-cat="${lane.cat}">
            <div class="ce-track-row__lane" data-ce-lane>
              ${lane.items.map(item => renderClip(item, duration, selectedIds, laneMuted || laneHidden)).join('')}
            </div>
          </div>
        `;
        }).join('')
      : '';

    const compositionRowHtml = compClips.length
      ? `
          <div class="ce-track-row" data-ce-cat="video" data-ce-composition-lane="1">
            <div class="ce-track-row__lane" data-ce-lane>
              ${compClips.map(clip => renderCompositionClip(clip, duration, selectedCompId)).join('')}
            </div>
          </div>
        `
      : '';

    const laneRowsHtml = (compositionRowHtml + sceneRowsHtml)
      || '<div class="ce-timeline-stub__empty">Open a sequence or drop media to build the edit.</div>';

    const gutterRows = [];
    if (compClips.length) gutterRows.push({ label: seq?.id ? 'Sequence' : 'Composition' });
    for (const lane of lanes) {
      gutterRows.push({
        label: lane.label,
        cat: lane.cat,
        muted: mutedTracks.has(lane.cat) || lane.items.every(item => item.el.meta?.muted === true),
        hidden: hiddenTracks.has(lane.cat) || lane.items.every(item => item.el.meta?.hidden === true),
      });
    }
    const gutterHtml = gutterRows.map(row => {
      if (!row.cat) return `<div class="ce-tl-gutter-row" title="${safeHtml(row.label)}">${safeHtml(row.label)}</div>`;
      const muted = row.muted === true;
      const hidden = row.hidden === true;
      return `<div class="ce-tl-gutter-row" title="${safeHtml(row.label)}">
        <span class="ce-tl-gutter-label">${safeHtml(row.label)}</span>
        <span class="ce-tl-gutter-actions">
          <button type="button" data-ce-lane-action="mute" data-ce-lane="${row.cat}" class="ce-tl-lane-btn${muted ? ' is-active' : ''}" title="Mute ${safeHtml(row.label)}">M</button>
          <button type="button" data-ce-lane-action="hide" data-ce-lane="${row.cat}" class="ce-tl-lane-btn${hidden ? ' is-active' : ''}" title="Hide ${safeHtml(row.label)}">H</button>
        </span>
      </div>`;
    }).join('');

    const seqTitle = seq?.id
      ? `Sequence · ${safeHtml(seq.title || seq.id)} · ${safeHtml(seq.status || 'draft')}`
      : (compClips.length ? `Composition · ${compClips.length} clips` : 'Timeline');
    const compositionToolbar = b ? `
      <button type="button" data-ce-comp-action="open" style="border:1px solid rgba(214,179,90,0.45);background:rgba(214,179,90,0.1);color:#f0d98a;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer">Open sequence</button>
      ${seq?.id ? '<button type="button" data-ce-comp-action="save" style="border:1px solid rgba(214,179,90,0.45);background:rgba(214,179,90,0.1);color:#f0d98a;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer">Save</button>' : ''}
      <button type="button" data-ce-comp-action="split" style="border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:#f5f5f4;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer">Split</button>
      <button type="button" data-ce-comp-action="delete" style="border:1px solid rgba(244,63,94,0.35);background:rgba(244,63,94,0.1);color:#fca5a5;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer">Del</button>
      <button type="button" data-ce-comp-action="render" style="border:1px solid rgba(168,85,247,0.35);background:rgba(168,85,247,0.1);color:#c4b5fd;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:700;cursor:pointer">Render</button>
    ` : '';

    container.innerHTML = `
      <div class="ce-timeline-stub ce-timeline-editor ce-timeline-multitrack">
        <div class="ce-timeline-stub__header ce-timeline-toolbar">
          <span class="ce-timeline-stub__label">${seqTitle}</span>
          <span class="ce-timeline-toolbar__controls">
            <span class="ce-timeline-stub__dur">${fmtTime(timeMs)} / ${fmtTime(duration)}</span>
            <button type="button" data-ce-timeline-action="snap" class="ce-timeline-tool-btn${store.getState().timelineSnap !== false ? ' is-active' : ''}" title="Toggle snapping">Snap</button>
            <button type="button" data-ce-timeline-action="split" class="ce-timeline-tool-btn" title="Split selected clips at playhead">Split</button>
            <button type="button" data-ce-timeline-action="delete" class="ce-timeline-tool-btn ce-timeline-tool-btn--danger" title="Delete selected clips">Delete</button>
            <button type="button" data-ce-timeline-action="zoom-out" class="ce-timeline-tool-btn" title="Zoom timeline out">−</button>
            <button type="button" data-ce-timeline-action="zoom-fit" class="ce-timeline-tool-btn" title="Fit timeline">Fit</button>
            <button type="button" data-ce-timeline-action="zoom-in" class="ce-timeline-tool-btn" title="Zoom timeline in">+</button>
            ${compositionToolbar}
          </span>
        </div>
        <div class="ce-tl-body">
          <div class="ce-tl-gutter">
            <div class="ce-tl-gutter-ruler"></div>
            ${gutterHtml}
          </div>
          <div class="ce-tl-lanes" data-ce-lanes style="width:${renderedContentWidth}px;min-width:${renderedContentWidth}px">
            <div class="ce-timeline-ruler" data-ce-ruler>
              ${renderTicks(duration)}
            </div>
            <div class="ce-timeline-playhead" data-ce-playhead style="left:${playheadLeft.toFixed(3)}%"></div>
            <div class="ce-tl-lane-rows">
              ${laneRowsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function lanesRect() {
    const lanesEl = container.querySelector('[data-ce-lanes]');
    return lanesEl?.getBoundingClientRect() || null;
  }

  function timeFromClientX(clientX) {
    const duration = renderedDuration;
    const rect = lanesRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  }

  function snapTime(rawTime, excludeIds = []) {
    const state = store.getState();
    if (state.timelineSnap === false) return rawTime;
    const scene = getScene() || {};
    const excluded = new Set(excludeIds);
    const points = [0, renderedDuration, Number(state.timeMs) || 0];
    for (const el of scene.elements || []) {
      if (excluded.has(el.id)) continue;
      const timing = elementTiming(el, renderedDuration);
      points.push(timing.start, timing.end);
    }
    const rect = lanesRect();
    const threshold = Math.max(18, renderedDuration / Math.max(1, (rect?.width || 640)) * 10);
    let closest = rawTime;
    let distance = threshold;
    for (const point of points) {
      const nextDistance = Math.abs(point - rawTime);
      if (nextDistance <= distance) {
        distance = nextDistance;
        closest = point;
      }
    }
    return clamp(closest, 0, renderedDuration);
  }

  function getElement(id) {
    return (getScene()?.elements || []).find(el => el.id === id) || null;
  }

  function selectClip(id, additive = false) {
    const current = store.getState().selectedIds || [];
    if (!additive) {
      store.setState({ selectedIds: [id] });
      return;
    }
    store.setState({
      selectedIds: current.includes(id) ? current.filter(item => item !== id) : [...current, id],
    });
  }

  function startDrag(e, clip) {
    const id = clip.dataset.ceClip;
    const el = getElement(id);
    if (!el || el.locked === true || el.meta?.locked === true) return;
    const currentSelection = store.getState().selectedIds || [];
    const trim = e.target?.dataset?.ceTrim || '';
    const additive = e.ctrlKey || e.metaKey;
    if (trim) selectClip(id, false);
    else if (!currentSelection.includes(id) || additive) selectClip(id, additive);
    const selectedIds = trim
      ? [id]
      : ((store.getState().selectedIds || []).filter(selectedId => {
          const selected = getElement(selectedId);
          return selected && selected.locked !== true && selected.meta?.locked !== true;
        }));
    const initial = new Map();
    for (const selectedId of selectedIds.length ? selectedIds : [id]) {
      const selected = getElement(selectedId);
      if (selected) initial.set(selectedId, elementTiming(selected, renderedDuration));
    }
    drag = {
      ids: Array.from(initial.keys()),
      primaryId: id,
      kind: trim === 'left' ? 'trim-left' : trim === 'right' ? 'trim-right' : 'move',
      startTime: timeFromClientX(e.clientX),
      initial,
      duration: renderedDuration,
      moved: false,
    };
    store.setState({ playing: false });
    e.preventDefault();
  }

  function patchDrag(e, commit = false) {
    if (!drag) return;
    const at = timeFromClientX(e.clientX);
    if (drag.kind === 'playhead') {
      store.setState({ timeMs: Math.round(at), playing: false });
      return;
    }
    const delta = at - drag.startTime;
    if (Math.abs(delta) > 1) drag.moved = true;
    const primaryTiming = drag.initial.get(drag.primaryId);
    if (!primaryTiming) return;
    const ops = [];
    if (drag.kind === 'move') {
      const rawStart = primaryTiming.start + delta;
      const snappedStart = snapTime(rawStart, drag.ids);
      const minStart = Math.min(...drag.ids.map(id => drag.initial.get(id)?.start ?? 0));
      const maxEnd = Math.max(...drag.ids.map(id => drag.initial.get(id)?.end ?? 0));
      const groupDelta = clamp(snappedStart - primaryTiming.start, -minStart, Math.max(0, drag.duration - maxEnd));
      for (const id of drag.ids) {
        const timing = drag.initial.get(id);
        if (!timing) continue;
        const start = timing.start + groupDelta;
        const end = timing.end + groupDelta;
        ops.push({
          op: 'set',
          id,
          patch: {
            'meta.startMs': Math.round(start),
            'meta.endMs': Math.round(end),
            'meta.durationMs': Math.round(end - start),
          },
        });
      }
    } else if (drag.kind === 'trim-left') {
      const start = clamp(snapTime(primaryTiming.start + delta, drag.ids), 0, primaryTiming.end - 100);
      const speed = Math.max(0.05, Number(getElement(drag.primaryId)?.meta?.speed) || 1);
      const trimStart = Math.max(0, primaryTiming.trimStart + (start - primaryTiming.start) * speed);
      ops.push({
        op: 'set',
        id: drag.primaryId,
        patch: {
          'meta.startMs': Math.round(start),
          'meta.endMs': Math.round(primaryTiming.end),
          'meta.durationMs': Math.round(primaryTiming.end - start),
          'meta.trimStartMs': Math.round(trimStart),
        },
      });
    } else if (drag.kind === 'trim-right') {
      const end = clamp(snapTime(primaryTiming.end + delta, drag.ids), primaryTiming.start + 100, drag.duration);
      const speed = Math.max(0.05, Number(getElement(drag.primaryId)?.meta?.speed) || 1);
      const trimEnd = Math.max(0, primaryTiming.trimEnd + (primaryTiming.end - end) * speed);
      ops.push({
        op: 'set',
        id: drag.primaryId,
        patch: {
          'meta.startMs': Math.round(primaryTiming.start),
          'meta.endMs': Math.round(end),
          'meta.durationMs': Math.round(end - primaryTiming.start),
          'meta.trimEndMs': Math.round(trimEnd),
        },
      });
    }
    if (ops.length) applyOps?.(ops, { history: commit, persist: commit });
  }

  function deleteSelected() {
    const ids = store.getState().selectedIds || [];
    const deletable = ids.filter(id => {
      const element = getElement(id);
      return element && element.locked !== true && element.meta?.locked !== true;
    });
    if (!deletable.length) return;
    applyOps?.(deletable.map(id => ({ op: 'delete', id })), { selectedIds: [] });
  }

  function splitSelected() {
    const scene = getScene() || {};
    const playhead = clamp(Number(store.getState().timeMs) || 0, 0, renderedDuration);
    const selectedIds = store.getState().selectedIds || [];
    const candidates = (selectedIds.length ? selectedIds.map(getElement) : (scene.elements || []))
      .filter(Boolean)
      .filter(el => el.locked !== true && el.meta?.locked !== true)
      // The current audio engine owns one canonical audioTrack. Splitting
      // the visual proxy would create a second clip the mixer cannot play;
      // keep audio as one editable lane until multi-audio mixing lands.
      .filter(el => String(el.type || '').toLowerCase() !== 'audio')
      .map(el => ({ el, timing: elementTiming(el, renderedDuration) }))
      .filter(({ timing }) => playhead > timing.start + 50 && playhead < timing.end - 50);
    if (!candidates.length) return;

    const ops = [];
    const nextSelection = [];
    for (const { el, timing } of candidates) {
      const speed = Math.max(0.05, Number(el.meta?.speed) || 1);
      const leftDuration = playhead - timing.start;
      const rightDuration = timing.end - playhead;
      const leftTrimEnd = Math.max(0, timing.trimEnd + rightDuration * speed);
      const rightTrimStart = Math.max(0, timing.trimStart + leftDuration * speed);
      const rightId = createClipId();
      ops.push({
        op: 'set',
        id: el.id,
        patch: {
          'meta.endMs': Math.round(playhead),
          'meta.durationMs': Math.round(leftDuration),
          'meta.trimEndMs': Math.round(leftTrimEnd),
        },
      });
      const right = JSON.parse(JSON.stringify(el));
      right.id = rightId;
      right.name = `${el.name || el.type || 'Clip'} (right)`;
      right.meta = {
        ...(right.meta || {}),
        startMs: Math.round(playhead),
        endMs: Math.round(timing.end),
        durationMs: Math.round(rightDuration),
        trimStartMs: Math.round(rightTrimStart),
        trimEndMs: Math.round(timing.trimEnd),
      };
      ops.push({ op: 'add', ...right });
      nextSelection.push(el.id, rightId);
    }
    applyOps?.(ops, { selectedIds: nextSelection });
  }

  function addAssetAtPlayhead(assetId) {
    const scene = getScene();
    const asset = (store.getState().mediaAssets || []).find(item => item.id === assetId);
    if (!scene || !asset || typeof applyOps !== 'function') return;
    const playhead = clamp(Number(store.getState().timeMs) || 0, 0, renderedDuration);
    const duration = Math.max(100, Number(asset.duration) || Math.max(100, renderedDuration - playhead));
    const element = assetToSceneElement(asset, scene);
    element.meta = {
      ...(element.meta || {}),
      startMs: Math.round(playhead),
      endMs: Math.round(playhead + duration),
      durationMs: Math.round(duration),
    };
    const ops = [{ op: 'add', ...element }];
    if (asset.type === 'audio') {
      ops.push({
        op: 'set-scene',
        patch: {
          audioTrack: {
            source: asset.src,
            label: asset.name,
            startMs: Math.round(playhead),
            durationMs: Math.round(duration),
            trimStartMs: 0,
            trimEndMs: 0,
            volume: 1,
            muted: false,
            analysis: asset.peaks ? {
              status: 'ready',
              sourceType: 'browser-import',
              durationMs: asset.duration || null,
              waveformPeaks: asset.peaks,
              waveformBucketCount: asset.peaks.length,
            } : null,
          },
        },
      });
    }
    applyOps(ops, { selectedIds: [element.id] });
  }

  function toggleTrackState(action, cat) {
    const key = action === 'mute' ? 'mutedTracks' : 'hiddenTracks';
    const current = new Set(store.getState()[key] || []);
    const enabled = !current.has(cat);
    if (enabled) current.add(cat);
    else current.delete(cat);
    store.setState({ [key]: Array.from(current) });

    // Persist the category toggle to element metadata so preview, export,
    // and a later editor mount agree about what the user hid or muted.
    const scene = getScene() || {};
    const matching = (scene.elements || []).filter(el => categoryOf(el.type) === cat && el.locked !== true && el.meta?.locked !== true);
    const patchKey = action === 'mute' ? 'meta.muted' : 'meta.hidden';
    if (matching.length) {
      applyOps?.(matching.map(el => ({
        op: 'set',
        id: el.id,
        patch: {
          [patchKey]: enabled,
          ...(cat === 'audio' && action === 'hide' ? { 'meta.muted': enabled } : {}),
        },
      })));
    } else if (cat === 'audio' && scene.audioTrack?.source) {
      applyOps?.({
        op: 'set-scene',
        patch: {
          audioTrack: {
            ...scene.audioTrack,
            muted: enabled,
          },
        },
      });
    }
  }

  function handleTimelineAction(action, lane = '') {
    const currentZoom = clamp(Number(store.getState().timelineZoom) || 1, 0.5, 4);
    if (action === 'snap') store.setState({ timelineSnap: store.getState().timelineSnap === false });
    else if (action === 'split') splitSelected();
    else if (action === 'delete') deleteSelected();
    else if (action === 'mute' || action === 'hide') toggleTrackState(action, lane);
    else if (action === 'zoom-in') store.setState({ timelineZoom: Math.min(4, currentZoom * 1.25) });
    else if (action === 'zoom-out') store.setState({ timelineZoom: Math.max(0.5, currentZoom / 1.25) });
    else if (action === 'zoom-fit') store.setState({ timelineZoom: 1 });
  }

  container.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('text/ce-asset-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      container.classList.add('ce-timeline--drop-over');
    }
  });
  container.addEventListener('dragleave', () => container.classList.remove('ce-timeline--drop-over'));
  container.addEventListener('drop', (e) => {
    const assetId = e.dataTransfer?.getData('text/ce-asset-id');
    container.classList.remove('ce-timeline--drop-over');
    if (!assetId) return;
    e.preventDefault();
    addAssetAtPlayhead(assetId);
  });

  container.addEventListener('click', (e) => {
    const laneAction = e.target.closest?.('[data-ce-lane-action]');
    if (laneAction) {
      handleTimelineAction(laneAction.getAttribute('data-ce-lane-action'), laneAction.getAttribute('data-ce-lane') || '');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const timelineAction = e.target.closest?.('[data-ce-timeline-action]');
    if (timelineAction) {
      handleTimelineAction(timelineAction.getAttribute('data-ce-timeline-action'));
      e.preventDefault();
      return;
    }
    const actionBtn = e.target.closest?.('[data-ce-comp-action]');
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-ce-comp-action');
      const b = bridge();
      if (action === 'open') b?.openSequence?.();
      else if (action === 'save') b?.saveSequence?.();
      else if (action === 'render') b?.render?.();
      else if (action === 'split') b?.splitAtPlayhead?.();
      else if (action === 'delete') b?.deleteSelected?.();
      e.preventDefault();
      return;
    }
    const compClip = e.target.closest?.('[data-ce-comp-clip]');
    if (compClip) {
      bridge()?.selectClip?.(compClip.getAttribute('data-ce-comp-clip'));
      e.preventDefault();
    }
  });

  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('[data-ce-comp-action],[data-ce-comp-clip]')) return;
    if (e.target.closest?.('[data-ce-playhead]')) {
      drag = { kind: 'playhead', startTime: timeFromClientX(e.clientX) };
      e.preventDefault();
      return;
    }
    const clip = e.target.closest?.('[data-ce-clip]');
    if (clip) {
      startDrag(e, clip);
      return;
    }
    // Click anywhere in the time area (ruler or empty lane) seeks the playhead.
    if (e.target.closest?.('[data-ce-lanes]')) {
      store.setState({ timeMs: Math.round(timeFromClientX(e.clientX)), playing: false });
      if (!e.ctrlKey && !e.metaKey) store.setState({ selectedIds: [] });
    }
  });

  function onPointerMove(e) {
    if (!drag) return;
    patchDrag(e, false);
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (drag.kind === 'playhead') {
      patchDrag(e, true);
      drag = null;
      return;
    }
    patchDrag(e, true);
    drag = null;
  }

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  const unsub = store.subscribe(() => render());
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => render()) : null;
  resizeObserver?.observe(container);
  render();

  function dispose() {
    unsub();
    resizeObserver?.disconnect();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  return { render, dispose, splitAtPlayhead: splitSelected, deleteSelected };
}
