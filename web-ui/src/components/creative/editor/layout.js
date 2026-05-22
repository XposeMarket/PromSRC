/**
 * Resizable 4-pane editor layout with header bar + tabbed left/right panels.
 *
 * Grid:
 *   Row 1 (40px)  : Header — title, undo/redo, export button
 *   Row 2 (1fr)   : [ left-tabbed | col-handle | preview | col-handle | right-tabbed ]
 *   Row 3 (4px)   : Row resize handle (full-width)
 *   Row 4 (minmax): Timeline (full-width, min 120px)
 *
 * Sizes persisted in localStorage under 'prometheus_ce_layout'.
 */

const LS_KEY = 'prometheus_ce_layout';
const MIN_LEFT_W     = 180;
const MAX_LEFT_W     = 560;
const MIN_RIGHT_W    = 200;
const MAX_RIGHT_W    = 560;
const MIN_TIMELINE_H = 120;
const MAX_TIMELINE_H = 500;

const LEFT_TABS  = ['media', 'audio', 'text', 'shapes', 'effects', 'captions'];
const RIGHT_TABS = ['properties', 'keyframes'];

const LEFT_TAB_LABELS  = { media:'Media', audio:'Audio', text:'Text', shapes:'Shapes', effects:'Effects', captions:'Captions' };
const RIGHT_TAB_LABELS = { properties:'Properties', keyframes:'Keyframes' };

function loadSizes() {
  try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch { /**/ }
  return { leftW: 260, rightW: 300, timelineH: 200 };
}
function saveSizes(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /**/ } }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function makeTabs(tabs, labels, activeTab, side) {
  return tabs.map(t =>
    `<button class="ce-tab${t === activeTab ? ' ce-tab--active' : ''}" data-ce-tab="${t}" data-ce-tab-side="${side}">${labels[t]}</button>`
  ).join('');
}
function makePanels(tabs, activeTab) {
  return tabs.map(t =>
    `<div class="ce-tab-panel${t === activeTab ? ' ce-tab-panel--active' : ''}" data-ce-panel="${t}" id="ce-panel-${t}"></div>`
  ).join('');
}

export function createEditorLayout(container) {
  const sizes = loadSizes();

  const root = document.createElement('div');
  root.className = 'ce-layout';
  root.innerHTML = `
    <!-- ROW 1: Header bar -->
    <header class="ce-editor-header">
      <div class="ce-editor-header__left">
        <button class="ce-hdr-btn" data-ce-hdr="undo" title="Undo (Ctrl+Z)">↩</button>
        <button class="ce-hdr-btn" data-ce-hdr="redo" title="Redo (Ctrl+Y)">↪</button>
      </div>
      <div class="ce-editor-header__center">
        <span class="ce-editor-title">Prometheus Editor</span>
      </div>
      <div class="ce-editor-header__right" data-ce-export-host></div>
    </header>

    <!-- ROW 2: Main content -->
    <div class="ce-pane ce-pane--left" data-pane="left">
      <nav class="ce-tab-bar" data-ce-tab-bar="left">
        ${makeTabs(LEFT_TABS, LEFT_TAB_LABELS, 'media', 'left')}
      </nav>
      <div class="ce-tab-body">${makePanels(LEFT_TABS, 'media')}</div>
    </div>

    <div class="ce-resize-handle ce-resize-handle--col" data-resize="left" title="Drag to resize panel"></div>

    <div class="ce-pane ce-pane--preview" data-pane="preview">
      <div class="ce-pane-body" id="ce-preview-body"></div>
    </div>

    <div class="ce-resize-handle ce-resize-handle--col" data-resize="right" title="Drag to resize panel"></div>

    <div class="ce-pane ce-pane--right" data-pane="right">
      <nav class="ce-tab-bar" data-ce-tab-bar="right">
        ${makeTabs(RIGHT_TABS, RIGHT_TAB_LABELS, 'properties', 'right')}
      </nav>
      <div class="ce-tab-body">${makePanels(RIGHT_TABS, 'properties')}</div>
    </div>

    <!-- ROW 3: Row resize handle -->
    <div class="ce-resize-handle ce-resize-handle--row" data-resize="timeline" title="Drag to resize timeline"></div>

    <!-- ROW 4: Timeline -->
    <div class="ce-pane ce-pane--timeline" data-pane="timeline">
      <div class="ce-pane-body" id="ce-timeline-body"></div>
    </div>
  `;

  applyGridSizes(root, sizes);

  // ── Tab switching ──────────────────────────────────────────────────────────
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-ce-tab]');
    if (!btn) return;
    const tab  = btn.dataset.ceTab;
    const side = btn.dataset.ceTabSide;
    const bar  = root.querySelector(`[data-ce-tab-bar="${side}"]`);
    if (!bar) return;
    bar.querySelectorAll('[data-ce-tab]').forEach(b =>
      b.classList.toggle('ce-tab--active', b.dataset.ceTab === tab)
    );
    const body = btn.closest('.ce-pane').querySelector('.ce-tab-body');
    body?.querySelectorAll('[data-ce-panel]').forEach(p =>
      p.classList.toggle('ce-tab-panel--active', p.dataset.cePanel === tab)
    );
  });

  // ── Header button delegation (undo/redo wired by index.js via callbacks) ──
  // exposed via onHeaderAction callback below

  // ── Resize drag ────────────────────────────────────────────────────────────
  let drag = null;

  root.addEventListener('mousedown', e => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    const which = handle.dataset.resize;
    if (which === 'left') {
      document.body.style.cursor = 'col-resize';
      drag = { axis: 'col-left', startX: e.clientX, startVal: sizes.leftW };
    } else if (which === 'right') {
      document.body.style.cursor = 'col-resize';
      drag = { axis: 'col-right', startX: e.clientX, startVal: sizes.rightW };
    } else if (which === 'timeline') {
      document.body.style.cursor = 'row-resize';
      drag = { axis: 'row-timeline', startY: e.clientY, startVal: sizes.timelineH };
    }
  });

  function onMouseMove(e) {
    if (!drag) return;
    if (drag.axis === 'col-left') {
      sizes.leftW     = clamp(drag.startVal + (e.clientX - drag.startX), MIN_LEFT_W, MAX_LEFT_W);
    } else if (drag.axis === 'col-right') {
      sizes.rightW    = clamp(drag.startVal - (e.clientX - drag.startX), MIN_RIGHT_W, MAX_RIGHT_W);
    } else if (drag.axis === 'row-timeline') {
      sizes.timelineH = clamp(drag.startVal - (e.clientY - drag.startY), MIN_TIMELINE_H, MAX_TIMELINE_H);
    }
    applyGridSizes(root, sizes);
  }

  function onMouseUp() {
    if (!drag) return;
    drag = null;
    saveSizes(sizes);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  function dispose() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    root.remove();
  }

  return {
    root,
    panes: {
      // Left tabs
      media:      root.querySelector('#ce-panel-media'),
      audio:      root.querySelector('#ce-panel-audio'),
      text:       root.querySelector('#ce-panel-text'),
      shapes:     root.querySelector('#ce-panel-shapes'),
      effects:    root.querySelector('#ce-panel-effects'),
      captions:   root.querySelector('#ce-panel-captions'),
      // Right tabs
      properties: root.querySelector('#ce-panel-properties'),
      keyframes:  root.querySelector('#ce-panel-keyframes'),
      // Center + bottom
      preview:    root.querySelector('#ce-preview-body'),
      timeline:   root.querySelector('#ce-timeline-body'),
      // Header action area
      exportHost: root.querySelector('[data-ce-export-host]'),
      hdrUndo:    root.querySelector('[data-ce-hdr="undo"]'),
      hdrRedo:    root.querySelector('[data-ce-hdr="redo"]'),
    },
    getSizes: () => Object.assign({}, sizes),
    switchTab(side, tab) {
      root.querySelector(`[data-ce-tab-bar="${side}"] [data-ce-tab="${tab}"]`)?.click();
    },
    dispose,
  };
}

function applyGridSizes(root, s) {
  root.style.setProperty('--ce-left-w',     `${s.leftW}px`);
  root.style.setProperty('--ce-right-w',    `${s.rightW}px`);
  root.style.setProperty('--ce-timeline-h', `${s.timelineH}px`);
}
