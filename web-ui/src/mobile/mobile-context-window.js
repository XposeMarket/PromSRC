// Mobile context-window chip — a free-floating ring under the header on the
// chat page. Tapping it opens a popover (sliding in from the right, over the
// chat) showing the live context-window fill, an expandable breakdown, and the
// current provider's plan-usage limits. Tapping outside closes it.
//
// Mirrors the desktop context-window popover (ChatPage.js) but self-contained
// for the mobile shell.

import { mobileGatewayFetch } from './mobile-api.js';
import { escapeHtml } from './mobile-shell.js';

let _open = false;
let _expanded = false;
let _expandedRows = new Set();
let _outsideHandler = null;
let _planFetchAt = 0;
let _planData = null;
let _activeProvider = '';
let _lastSessionId = '';
let _modelChangeListenerBound = false;
let _refreshSeq = 0;

function _fmtTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) { const m = n / 1_000_000; return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}m`; }
  if (n >= 1_000) { const k = n / 1_000; return `${k >= 100 ? k.toFixed(0) : k.toFixed(1)}k`; }
  return String(Math.round(n));
}

function _gaugeClass(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return 'crit';
  if (p >= 75) return 'warn';
  return 'ok';
}

function _fmtRelative(diffMs) {
  if (diffMs <= 0) return 'soon';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) {
    const rem = mins % 60;
    return rem ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
  }
  return `in ${Math.round(hrs / 24)}d`;
}

// Exact reset time. Short windows show a clock time ("at 11:08 AM"); weekly /
// multi-day windows show date AND time ("Jun 18, 11:08 AM"). A relative hint is
// appended in parentheses. `label` lets us detect the weekly windows.
function _fmtReset(iso, label) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return 'resets now';
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rel = _fmtRelative(diff);
  const isLong = /week|day|opus/i.test(String(label || '')) || diff >= 24 * 3600 * 1000;
  if (isLong) {
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `resets ${date}, ${time} (${rel})`;
  }
  return `resets at ${time} (${rel})`;
}

export function renderMobileContextChip() {
  return `
    <button type="button" class="pm-ctx-chip" id="pm-ctx-chip" aria-label="Context window" aria-expanded="false" title="Context window">
      <span class="pm-ctx-chip-ring" id="pm-ctx-chip-ring"></span>
    </button>
    <div class="pm-ctx-popover" id="pm-ctx-popover" hidden role="dialog" aria-label="Context window">
      <button type="button" class="pm-ctx-toggle" id="pm-ctx-toggle" aria-expanded="false">
        <div class="pm-ctx-head">
          <span>Context window<svg class="pm-ctx-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>
          <span id="pm-ctx-total">…</span>
        </div>
        <div class="pm-ctx-track" aria-hidden="true"><div class="pm-ctx-fill" id="pm-ctx-fill"></div></div>
      </button>
      <div class="pm-ctx-metrics" id="pm-ctx-metrics" hidden></div>
      <div class="pm-ctx-plan" id="pm-ctx-plan" hidden>
        <div class="pm-ctx-plan-head">Plan usage</div>
        <div class="pm-ctx-plan-body" id="pm-ctx-plan-body"></div>
      </div>
    </div>
  `;
}

function _setExpanded(expanded) {
  _expanded = !!expanded;
  const metrics = document.getElementById('pm-ctx-metrics');
  const toggle = document.getElementById('pm-ctx-toggle');
  if (metrics) metrics.hidden = !expanded;
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function _renderRows(rows, windowTokens, depth = 0) {
  const source = Array.isArray(rows) ? rows : [];
  return source.map((row) => {
    const tokens = Math.max(0, Number(row?.tokens || 0));
    const pct = windowTokens > 0 ? `${((tokens / windowTokens) * 100).toFixed(1)}%` : '';
    const pctText = row?.percentLabel ? String(row.percentLabel) : (row?.percentBasis === 'window' ? pct : '');
    const children = Array.isArray(row?.children) ? row.children.filter(Boolean) : [];
    const rowId = String(row?.id || row?.label || `row_${depth}`);
    const expandable = children.length > 0;
    const expanded = expandable && _expandedRows.has(rowId);
    const tag = expandable ? 'button' : 'div';
    const typeAttr = expandable ? ' type="button"' : '';
    const dataAttr = expandable ? ` data-pm-ctx-row-id="${escapeHtml(rowId)}" aria-expanded="${expanded ? 'true' : 'false'}"` : '';
    const caret = expandable ? `<span class="pm-ctx-caret" aria-hidden="true">${expanded ? '&#9662;' : '&#9656;'}</span>` : '';
    const estimate = row?.estimated ? '<span class="pm-ctx-estimate">est</span>' : '';
    const childHtml = expanded ? _renderRows(children, windowTokens, depth + 1) : '';
    return `<${tag}${typeAttr}${dataAttr} class="pm-ctx-row${expandable ? ' is-expandable' : ''}${depth > 0 ? ' is-child' : ''}" style="--pm-ctx-depth:${Math.max(0, depth)};"><span>${caret}${escapeHtml(row?.label || 'Context')}${estimate}</span><span class="pm-ctx-row-val">${_fmtTokens(tokens)}</span><span class="pm-ctx-row-pct">${escapeHtml(pctText)}</span></${tag}>${childHtml}`;
  }).join('');
}

function _renderContext(data) {
  const ring = document.getElementById('pm-ctx-chip-ring');
  const fill = document.getElementById('pm-ctx-fill');
  const total = document.getElementById('pm-ctx-total');
  const metrics = document.getElementById('pm-ctx-metrics');
  if (!data || data.success === false) {
    if (ring) ring.style.setProperty('--pm-ctx-deg', '0deg');
    if (fill) fill.style.width = '0%';
    if (total) total.textContent = 'Unavailable';
    if (metrics) metrics.innerHTML = '';
    return;
  }
  const currentState = data.currentState || {};
  const current = Math.max(0, Number(data.currentStateTokens || currentState.currentStateTokens || data.currentInputTokens || 0));
  const windowTokens = Math.max(0, Number(data.contextWindowTokens || 0));
  const percent = windowTokens > 0 ? Math.min(100, Math.max(0, (current / windowTokens) * 100)) : 0;
  if (ring) ring.style.setProperty('--pm-ctx-deg', `${Math.round(percent * 3.6)}deg`);
  if (fill) fill.style.width = `${percent.toFixed(1)}%`;
  if (total) total.textContent = `${_fmtTokens(current)} / ${_fmtTokens(windowTokens)} (${Math.round(percent)}%)`;

  const rows = Array.isArray(currentState.rows) ? currentState.rows : [];
  if (metrics) {
    metrics.innerHTML = _renderRows(rows, windowTokens);
  }
}

function _renderPlan() {
  const wrap = document.getElementById('pm-ctx-plan');
  const body = document.getElementById('pm-ctx-plan-body');
  if (!wrap || !body) return;
  const providers = (_planData && Array.isArray(_planData.providers)) ? _planData.providers : [];
  const prov = providers.find((p) => String(p.provider).toLowerCase() === String(_activeProvider).toLowerCase());
  if (!prov) { wrap.hidden = true; body.innerHTML = ''; return; }

  const windows = Array.isArray(prov.windows) ? prov.windows : [];
  let html = '';
  if (windows.length) {
    html += windows.map((w) => {
      const pct = Math.max(0, Math.min(100, Number(w.used_percent) || 0));
      const left = (100 - pct).toFixed(0);
      const reset = _fmtReset(w.reset_at || w.resets_at, w.label);
      return `
        <div class="pm-ctx-gauge">
          <div class="pm-ctx-gauge-head"><span>${escapeHtml(w.label || '')}</span><span class="pm-ctx-gauge-pct">${left}% left</span></div>
          <div class="pm-ctx-gauge-track"><div class="pm-ctx-gauge-fill ${_gaugeClass(pct)}" style="width:${pct}%"></div></div>
          ${reset ? `<div class="pm-ctx-gauge-reset">${escapeHtml(reset)}</div>` : ''}
        </div>`;
    }).join('');
  }
  if (!windows.length) {
    const t = prov.tokens || {};
    html += `<div class="pm-ctx-plan-tokens">${_fmtTokens(t.total || 0)} tokens · ${Number(t.calls || 0)} calls tracked</div>`;
  }
  body.innerHTML = html;
  wrap.hidden = false;
}

async function _refresh(sessionId, { force = false, provider = '' } = {}) {
  const seq = ++_refreshSeq;
  _lastSessionId = String(sessionId || _lastSessionId || '');
  const providerOverride = String(provider || '').trim().toLowerCase();
  if (force) {
    _planFetchAt = 0;
    _planData = null;
    if (providerOverride) _activeProvider = providerOverride;
    else _activeProvider = '';
  } else if (providerOverride) {
    _activeProvider = providerOverride;
  }

  // Context window for the active session.
  try {
    if (sessionId) {
      const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-window`);
      if (seq === _refreshSeq) _renderContext(data && data.success !== false ? data : null);
    } else if (seq === _refreshSeq) {
      _renderContext(null);
    }
  } catch { if (seq === _refreshSeq) _renderContext(null); }

  // Active provider (for plan-usage scoping) + usage limits. Model-change events
  // force this cache so plan usage updates at the same time as the context ring.
  try {
    if (!_activeProvider) {
      const p = await mobileGatewayFetch('/api/settings/provider');
      _activeProvider = String(p?.llm?.provider || '').toLowerCase();
    }
    const now = Date.now();
    if (force || !_planData || now - _planFetchAt > 60000) {
      const lim = await mobileGatewayFetch('/api/usage/limits');
      if (lim && lim.success !== false) { _planData = lim; _planFetchAt = now; }
    }
    if (seq === _refreshSeq) _renderPlan();
    if (force) console.info('[mobile context] refreshed after model change', { sessionId, provider: _activeProvider });
  } catch { /* leave plan hidden */ }
}

function _providerFromModelChange(detail = {}) {
  const modelRef = String(detail?.modelRef || '').trim();
  const slashIdx = modelRef.indexOf('/');
  return String(detail?.provider || detail?.providerId || (slashIdx > 0 ? modelRef.slice(0, slashIdx) : '') || '').trim().toLowerCase();
}

function _bindModelChangeListener(getSessionId) {
  if (_modelChangeListenerBound) return;
  _modelChangeListenerBound = true;
  window.__pmMobileRefreshContextWindow = (detail = {}) => {
    const sid = String(detail?.sessionId || (typeof getSessionId === 'function' ? getSessionId() : '') || _lastSessionId || '');
    return _refresh(sid, { force: true, provider: _providerFromModelChange(detail) });
  };
  window.addEventListener('pm-model-changed', (event) => {
    window.__pmMobileRefreshContextWindow?.(event?.detail || {});
  });
}

function _close() {
  const pop = document.getElementById('pm-ctx-popover');
  const chip = document.getElementById('pm-ctx-chip');
  if (pop) pop.hidden = true;
  if (chip) chip.setAttribute('aria-expanded', 'false');
  _open = false;
  if (_outsideHandler) {
    document.removeEventListener('pointerdown', _outsideHandler, true);
    _outsideHandler = null;
  }
}

function _open_(getSessionId) {
  const pop = document.getElementById('pm-ctx-popover');
  const chip = document.getElementById('pm-ctx-chip');
  if (!pop || !chip) return;
  _open = true;
  pop.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  _setExpanded(false);
  _refresh(typeof getSessionId === 'function' ? getSessionId() : '');
  // Close when tapping outside the popover or the chip.
  _outsideHandler = (e) => {
    if (pop.contains(e.target) || chip.contains(e.target)) return;
    _close();
  };
  document.addEventListener('pointerdown', _outsideHandler, true);
}

export function wireMobileContextWindow(page, { getSessionId } = {}) {
  const chip = page.querySelector('#pm-ctx-chip');
  const toggle = page.querySelector('#pm-ctx-toggle');
  if (!chip) return;
  _bindModelChangeListener(getSessionId);
  // Reset transient state for the fresh page render.
  _open = false; _expanded = false; _expandedRows = new Set();
  if (_outsideHandler) { document.removeEventListener('pointerdown', _outsideHandler, true); _outsideHandler = null; }

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_open) _close(); else _open_(getSessionId);
  });
  if (toggle) toggle.addEventListener('click', (e) => { e.stopPropagation(); _setExpanded(!_expanded); });
  const metrics = page.querySelector('#pm-ctx-metrics');
  if (metrics) {
    metrics.addEventListener('click', (e) => {
      const row = e.target?.closest?.('[data-pm-ctx-row-id]');
      if (!row) return;
      e.stopPropagation();
      const id = row.dataset.pmCtxRowId;
      if (!id) return;
      if (_expandedRows.has(id)) _expandedRows.delete(id);
      else _expandedRows.add(id);
      _refresh(typeof getSessionId === 'function' ? getSessionId() : '');
    });
  }

  // Pre-load so the ring shows the real fill as soon as the chat opens,
  // not just after the popover is first tapped.
  _refresh(typeof getSessionId === 'function' ? getSessionId() : '');
}
