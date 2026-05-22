/**
 * OpenCut-style scene timeline for Prometheus Creative Editor.
 *
 * The scene graph remains the source of truth. This timeline edits element
 * timing metadata directly: meta.startMs, meta.endMs, meta.durationMs,
 * meta.trimStartMs, and meta.trimEndMs.
 */

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const f = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
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

function laneForType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'audio') return 'Audio';
  if (t === 'text') return 'Text';
  if (t === 'image') return 'Image';
  if (t === 'video') return 'Video';
  return 'Overlay';
}

function renderRow(el, sceneDuration, selectedIds) {
  const timing = elementTiming(el, sceneDuration);
  const left = clamp((timing.start / sceneDuration) * 100, 0, 100);
  const width = clamp(((timing.end - timing.start) / sceneDuration) * 100, 0.4, 100 - left);
  const selected = selectedIds?.includes(el.id) ? ' ce-timeline-clip--selected' : '';
  const lane = laneForType(el.type);
  const label = el.name || el.meta?.content || el.type || el.id;
  return `
    <div class="ce-track-row" data-ce-timeline-row="${safeHtml(el.id)}">
      <div class="ce-track-row__label" title="${safeHtml(label)}">${safeHtml(lane)}</div>
      <div class="ce-track-row__lane" data-ce-lane>
        <div class="ce-track-row__clip${selected}" data-ce-clip="${safeHtml(el.id)}"
          style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"
          title="${safeHtml(label)} • ${fmtTime(timing.start)} - ${fmtTime(timing.end)}">
          <span class="ce-timeline-trim ce-timeline-trim--left" data-ce-trim="left"></span>
          <span class="ce-timeline-clip-label">${safeHtml(label)}</span>
          <span class="ce-timeline-trim ce-timeline-trim--right" data-ce-trim="right"></span>
        </div>
      </div>
    </div>
  `;
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
    container.innerHTML = `
      <div class="ce-timeline-stub ce-timeline-editor">
        <div class="ce-timeline-stub__header">
          <span class="ce-timeline-stub__label">Timeline</span>
          <span class="ce-timeline-stub__dur">${fmtTime(duration)}</span>
        </div>
        <div class="ce-timeline-ruler" data-ce-ruler>
          <div class="ce-timeline-playhead" style="left:${playheadLeft.toFixed(3)}%"></div>
        </div>
        <div class="ce-timeline-stub__tracks">
          ${elements.length
            ? elements.map(el => renderRow(el, duration, selectedIds)).join('')
            : '<div class="ce-timeline-stub__empty">Drop or generate media to build the edit.</div>'}
        </div>
      </div>
    `;
  }

  function timeFromClientX(clientX) {
    const scene = getScene() || {};
    const duration = Math.max(1000, Number(scene.durationMs) || 12000);
    const ruler = container.querySelector('[data-ce-ruler]') || container.querySelector('.ce-track-row__lane');
    const rect = ruler?.getBoundingClientRect();
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
    if (e.target.closest?.('[data-ce-ruler]')) {
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
