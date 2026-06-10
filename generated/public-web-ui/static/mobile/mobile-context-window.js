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
let _outsideHandler = null;
let _planFetchAt = 0;
let _planData = null;
let _activeProvider = '';

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

function _fmtReset(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diff = ts - Date.now();
  if (diff <= 0) return 'resets now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `resets in ${hrs}h`;
  return `resets in ${Math.round(hrs / 24)}d`;
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
    metrics.innerHTML = rows.map((row) => {
      const tokens = Math.max(0, Number(row?.tokens || 0));
      const pct = windowTokens > 0 ? `${((tokens / windowTokens) * 100).toFixed(1)}%` : '';
      const pctText = row?.percentLabel ? String(row.percentLabel) : (row?.percentBasis === 'window' ? pct : '');
      return `<div class="pm-ctx-row"><span>${escapeHtml(row?.label || 'Context')}</span><span class="pm-ctx-row-val">${_fmtTokens(tokens)}</span><span class="pm-ctx-row-pct">${escapeHtml(pctText)}</span></div>`;
    }).join('');
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
  if (windows.length) {
    body.innerHTML = windows.map((w) => {
      const pct = Math.max(0, Math.min(100, Number(w.used_percent) || 0));
      const left = (100 - pct).toFixed(0);
      const reset = _fmtReset(w.resets_at);
      return `
        <div class="pm-ctx-gauge">
          <div class="pm-ctx-gauge-head"><span>${escapeHtml(w.label || '')}${reset ? ` · ${escapeHtml(reset)}` : ''}</span><span class="pm-ctx-gauge-pct">${left}% left</span></div>
          <div class="pm-ctx-gauge-track"><div class="pm-ctx-gauge-fill ${_gaugeClass(pct)}" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  } else {
    const t = prov.tokens || {};
    body.innerHTML = `<div class="pm-ctx-plan-tokens">${_fmtTokens(t.total || 0)} tokens · ${Number(t.calls || 0)} calls tracked</div>`;
  }
  wrap.hidden = false;
}

async function _refresh(sessionId) {
  // Context window for the active session.
  try {
    if (sessionId) {
      const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-window`);
      _renderContext(data && data.success !== false ? data : null);
    } else {
      _renderContext(null);
    }
  } catch { _renderContext(null); }

  // Active provider (for plan-usage scoping) + usage limits, cached 60s.
  try {
    if (!_activeProvider) {
      const p = await mobileGatewayFetch('/api/settings/provider');
      _activeProvider = String(p?.llm?.provider || '').toLowerCase();
    }
    const now = Date.now();
    if (!_planData || now - _planFetchAt > 60000) {
      const lim = await mobileGatewayFetch('/api/usage/limits');
      if (lim && lim.success !== false) { _planData = lim; _planFetchAt = now; }
    }
    _renderPlan();
  } catch { /* leave plan hidden */ }
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
  // Reset transient state for the fresh page render.
  _open = false; _expanded = false;
  if (_outsideHandler) { document.removeEventListener('pointerdown', _outsideHandler, true); _outsideHandler = null; }

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_open) _close(); else _open_(getSessionId);
  });
  if (toggle) toggle.addEventListener('click', (e) => { e.stopPropagation(); _setExpanded(!_expanded); });
}
