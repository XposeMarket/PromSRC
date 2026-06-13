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

function renderClip(item, duration, selectedIds) {
  const { el, timing } = item;
  const left = clamp((timing.start / duration) * 100, 0, 100);
  const width = clamp(((timing.end - timing.start) / duration) * 100, 0.4, 100 - left);
  const selected = selectedIds?.includes(el.id) ? ' ce-timeline-clip--selected' : '';
  const cat = categoryOf(el.type);
  const label = el.name || el.meta?.content || el.type || el.id;
  return `
    <div class="ce-track-row__clip ce-clip--${cat}${selected}" data-ce-clip="${safeHtml(el.id)}"
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

export function createTimelineEditor({ container, store, getScene, applyOps }) {
  let drag = null;

  function render() {
    const scene = getScene() || {};
    const duration = Math.max(1000, Number(scene.durationMs) || Number(store.getState().durationMs) || 12000);
    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const selectedIds = store.getState().selectedIds || [];
    const timeMs = clamp(Number(store.getState().timeMs) || 0, 0, duration);
    const playheadLeft = (timeMs / duration) * 100;
    const lanes = buildLanes(elements, duration);

    const laneRowsHtml = lanes.length
      ? lanes.map(lane => `
          <div class="ce-track-row" data-ce-cat="${lane.cat}">
            <div class="ce-track-row__lane" data-ce-lane>
              ${lane.items.map(item => renderClip(item, duration, selectedIds)).join('')}
            </div>
          </div>
        `).join('')
      : '<div class="ce-timeline-stub__empty">Drop or generate media to build the edit.</div>';

    const gutterHtml = lanes.map(lane =>
      `<div class="ce-tl-gutter-row" title="${safeHtml(lane.label)}">${safeHtml(lane.label)}</div>`
    ).join('');

    container.innerHTML = `
      <div class="ce-timeline-stub ce-timeline-editor ce-timeline-multitrack">
        <div class="ce-timeline-stub__header">
          <span class="ce-timeline-stub__label">Timeline</span>
          <span class="ce-timeline-stub__dur">${fmtTime(timeMs)} / ${fmtTime(duration)}</span>
        </div>
        <div class="ce-tl-body">
          <div class="ce-tl-gutter">
            <div class="ce-tl-gutter-ruler"></div>
            ${gutterHtml}
          </div>
          <div class="ce-tl-lanes" data-ce-lanes>
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
    const scene = getScene() || {};
    const duration = Math.max(1000, Number(scene.durationMs) || 12000);
    const rect = lanesRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  }

  function getElement(id) {
    return (getScene()?.elements || []).find(el => el.id === id) || null;
  }

  function startDrag(e, clip) {
    const id = clip.dataset.ceClip;
    const el = getElement(id);
    if (!el) return;
    const scene = getScene() || {};
    const duration = Math.max(1000, Number(scene.durationMs) || 12000);
    const timing = elementTiming(el, duration);
    const trim = e.target?.dataset?.ceTrim || '';
    drag = {
      id,
      kind: trim === 'left' ? 'trim-left' : trim === 'right' ? 'trim-right' : 'move',
      startClientX: e.clientX,
      startTime: timeFromClientX(e.clientX),
      timing,
      duration,
    };
    store.setState({ selectedIds: [id], playing: false });
    e.preventDefault();
  }

  function patchDrag(e, commit = false) {
    if (!drag) return;
    const at = timeFromClientX(e.clientX);
    const delta = at - drag.startTime;
    let start = drag.timing.start;
    let end = drag.timing.end;
    let trimStart = drag.timing.trimStart;
    let trimEnd = drag.timing.trimEnd;
    if (drag.kind === 'move') {
      const span = end - start;
      start = clamp(drag.timing.start + delta, 0, Math.max(0, drag.duration - span));
      end = start + span;
    } else if (drag.kind === 'trim-left') {
      start = clamp(drag.timing.start + delta, 0, end - 100);
      trimStart = Math.max(0, drag.timing.trimStart + (start - drag.timing.start));
    } else if (drag.kind === 'trim-right') {
      end = clamp(drag.timing.end + delta, start + 100, drag.duration);
      trimEnd = Math.max(0, drag.timing.trimEnd + (drag.timing.end - end));
    }
    applyOps?.({
      op: 'set',
      id: drag.id,
      patch: {
        'meta.startMs': Math.round(start),
        'meta.endMs': Math.round(end),
        'meta.durationMs': Math.round(end - start),
        'meta.trimStartMs': Math.round(trimStart),
        'meta.trimEndMs': Math.round(trimEnd),
      },
    }, { history: commit });
  }

  container.addEventListener('pointerdown', (e) => {
    const clip = e.target.closest?.('[data-ce-clip]');
    if (clip) {
      startDrag(e, clip);
      return;
    }
    // Click anywhere in the time area (ruler or empty lane) seeks the playhead.
    if (e.target.closest?.('[data-ce-lanes]')) {
      store.setState({ timeMs: Math.round(timeFromClientX(e.clientX)), playing: false });
    }
  });

  function onPointerMove(e) {
    if (!drag) return;
    patchDrag(e, false);
  }

  function onPointerUp(e) {
    if (!drag) return;
    patchDrag(e, true);
    drag = null;
  }

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  const unsub = store.subscribe(() => render());
  render();

  function dispose() {
    unsub();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  return { render, dispose };
}
