// mobile-model-badge.js — interactive header model badge for Prometheus Mobile.
//
// The header used to show a static "Online" pill. It now shows the *current
// main-chat model* (truncated to a friendly short name) while keeping the same
// green/red gateway online/offline dot.
//
//   • TAP            → reasoning / thinking-level sheet for the ACTIVE provider
//                      (mirrors the desktop composer reasoning controls).
//   • PRESS-AND-HOLD → haptic buzz + quick provider→model switch sheet, limited
//                      to providers the user actually has saved credentials for.
//
// Haptics: iOS Safari has no Web Vibration API. The working trick (per the
// 2026 iOS 26.5 discussion) is a *native* `<input type="checkbox" switch>`:
// a real tap that toggles it emits a system haptic. We embed one, invisibly,
// inside every badge so the physical touch buzzes natively, and we also fire
// `navigator.vibrate` (Android) + a programmatic toggle at the long-press
// threshold as best-effort. All paths degrade silently.

import { mobileGatewayFetch } from './mobile-api.js';

// ── Provider metadata (mirrors web-ui/src/components/agent-model-picker.js) ──
const BUILTIN_LABELS = {
  ollama: 'Ollama (local)',
  llama_cpp: 'llama.cpp (local)',
  lm_studio: 'LM Studio (local)',
  openai: 'OpenAI',
  openai_codex: 'OpenAI Codex',
  anthropic: 'Anthropic Claude',
  perplexity: 'Perplexity',
  gemini: 'Google Gemini',
  xai: 'xAI Grok',
};

const BUILTIN_STATIC_MODELS = {
  openai: ['gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  xai: ['grok-build-0.1', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.3-latest', 'grok-latest', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent'],
};

// Reasoning controls per provider (mirrors mobile-settings renderProviderFields).
const REASONING_EFFORT_PROVIDERS = new Set(['openai', 'openai_codex', 'perplexity', 'xai']);
const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high'];
const CODEX_EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PERPLEXITY_EFFORT_OPTIONS = ['', 'low', 'medium', 'high'];
const XAI_EFFORT_OPTIONS = ['', 'none', 'low', 'medium', 'high'];
const XAI_MULTI_AGENT_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh'];
const ANTHROPIC_EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// ── Caches ───────────────────────────────────────────────────────────────────
let _llmCache = null;            // full llm config { provider, providers }
let _catalogCache = null;        // [{ id, name, runtime, ... }]
let _credentialedIds = null;     // [providerId, ...]

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── Friendly model-name truncation ───────────────────────────────────────────
// claude-haiku-4-5-20251001 → "Claude Haiku 4.5"
// gpt-5.5 → "GPT 5.5"   ·   grok-4.20-reasoning → "Grok 4.20"
export function prettifyModelName(model, provider) {
  const raw = String(model || '').trim();
  const providerId = String(provider || '').trim().toLowerCase();
  if (!raw) return _providerLabel(providerId) || 'Model';
  let s = raw.toLowerCase();
  // Drop date stamps like -20251001 / 20250514.
  s = s.replace(/-?20\d{6}\b/g, '');
  // Drop trailing qualifier words that add noise on a tiny badge.
  s = s.replace(/-(reasoning|non-reasoning|latest|preview|exp|instruct|thinking|online)\b/g, '');
  s = s.replace(/-\d{4}\b/g, '');
  // Strip the redundant "claude-" family prefix (anthropic).
  s = s.replace(/^claude-/, '');
  // Version dashes between digits become dots: 4-5 → 4.5.
  s = s.replace(/(\d)-(\d)/g, '$1.$2');
  // Remaining separators → spaces.
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = raw;

  if (/^gpt\b/.test(s)) {
    s = s.replace(/^gpt\b/i, 'GPT');
  } else if (/^o\d\b/.test(s)) {
    s = s.toUpperCase();
  } else if (providerId === 'anthropic' || /^(opus|sonnet|haiku)\b/.test(s)) {
    s = s.replace(/^(opus|sonnet|haiku)\b/i, 'Claude $1');
  } else if (providerId === 'gemini' || /^gemini\b/.test(s)) {
    s = s.replace(/^gemini\b/i, 'Gemini');
  } else if (providerId === 'xai' || /^grok\b/.test(s)) {
    s = s.replace(/^grok\b/i, 'Grok');
  } else if (providerId === 'perplexity' || /^sonar\b/.test(s)) {
    s = s.replace(/^sonar\b/i, 'Sonar');
  } else {
    s = s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }

  s = s.replace(/\bmini\b/gi, 'mini')
    .replace(/\b(Pro|Flash|Lite|Build|Codex|Max|Haiku|Opus|Sonnet|Deep|Research|Multi|Agent)\b/gi, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 24) s = s.slice(0, 23).trim() + '…';
  return s;
}

// ── Haptic feedback ──────────────────────────────────────────────────────────
function _ensureHapticSwitch() {
  let sw = document.getElementById('pm-haptic-switch');
  if (!sw) {
    sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.setAttribute('switch', '');     // iOS native switch styling = haptic on toggle
    sw.id = 'pm-haptic-switch';
    sw.setAttribute('aria-hidden', 'true');
    sw.tabIndex = -1;
    sw.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(sw);
  }
  return sw;
}

export function pmHaptic(strength = 12) {
  try { if (navigator.vibrate) navigator.vibrate(strength); } catch {}
  // Programmatic toggle of a native iOS switch — best-effort earlier buzz.
  try { const sw = _ensureHapticSwitch(); sw.checked = !sw.checked; } catch {}
}

// Give an arbitrary button the same real iOS haptic the model badge has: a native
// `<input switch>` overlay sits on top of the button so the user's physical tap
// toggles it (system haptic), then we forward the activation to the real control.
// The overlay is a sibling (inside a wrapper) — not a child — so it survives the
// button's innerHTML being rewritten (the send button morphs send↔voice↔abort).
export function attachMobileButtonHaptic(btn, activate) {
  if (!btn || btn.dataset.pmHaptic === '1') return;
  btn.dataset.pmHaptic = '1';
  let host = btn.parentElement;
  if (!host || !host.classList.contains('pm-haptic-host')) {
    host = document.createElement('span');
    host.className = 'pm-haptic-host';
    btn.parentNode.insertBefore(host, btn);
    host.appendChild(btn);
  }
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.className = 'pm-haptic-switch-overlay';
  sw.setAttribute('aria-hidden', 'true');
  sw.tabIndex = -1;
  host.appendChild(sw);
  sw.addEventListener('click', () => {
    pmHaptic(10);
    try { typeof activate === 'function' ? activate() : btn.click(); } catch {}
  });
}

// ── Data loaders ─────────────────────────────────────────────────────────────
async function _loadLlm(force) {
  if (_llmCache && !force) return _llmCache;
  try {
    const d = await mobileGatewayFetch('/api/settings/provider');
    _llmCache = d?.llm || { provider: 'ollama', providers: {} };
  } catch {
    _llmCache = _llmCache || { provider: 'ollama', providers: {} };
  }
  return _llmCache;
}

async function _loadCatalog(force) {
  if (_catalogCache && !force) return _catalogCache;
  try {
    const d = await mobileGatewayFetch('/api/extensions/catalog?kind=provider');
    _catalogCache = Array.isArray(d?.items) ? d.items : [];
  } catch {
    _catalogCache = Object.keys(BUILTIN_LABELS).map((id) => ({ id, name: BUILTIN_LABELS[id], runtime: {} }));
  }
  return _catalogCache;
}

async function _loadCredentialedIds(force) {
  if (_credentialedIds && !force) return _credentialedIds;
  try {
    const d = await mobileGatewayFetch('/api/settings/credentialed-model-providers');
    _credentialedIds = Array.isArray(d?.providers) ? d.providers.map(String) : [];
  } catch {
    _credentialedIds = [];
  }
  return _credentialedIds;
}

function _providerLabel(id) {
  const item = (_catalogCache || []).find((p) => p.id === id);
  return item?.name || BUILTIN_LABELS[id] || id;
}

function _modelsForProvider(provider) {
  const item = (_catalogCache || []).find((p) => p.id === provider);
  const out = [];
  const push = (arr) => { if (Array.isArray(arr)) for (const m of arr) { const s = String(m?.name || m || '').trim(); if (s && !out.includes(s)) out.push(s); } };
  push(item?.runtime?.options?.staticModels);
  push(BUILTIN_STATIC_MODELS[provider]);
  const def = item?.config?.defaults?.model;
  if (def && !out.includes(String(def))) out.unshift(String(def));
  return out;
}

function _activeModel(llm) {
  const provider = String(llm?.provider || 'ollama');
  const model = String(llm?.providers?.[provider]?.model || '');
  return { provider, model };
}

function _modelDetail(detail = {}) {
  const modelRef = String(detail?.modelRef || '').trim();
  const slashIdx = modelRef.indexOf('/');
  const provider = String(detail?.provider || detail?.providerId || (slashIdx > 0 ? modelRef.slice(0, slashIdx) : '') || '').trim();
  const model = String(detail?.model || (slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef) || '').trim();
  return { provider, model };
}

function _setBadgeLabel(label) {
  const safe = String(label || '').trim() || 'Online';
  window.__pmModelBadgeLabel = safe;
  document.querySelectorAll('.pm-model-badge .pm-model-badge-label').forEach((el) => {
    el.textContent = safe;
  });
  return safe;
}

// ── Badge label refresh ──────────────────────────────────────────────────────
export async function refreshMobileModelBadge(force = false, modelChangeDetail = null) {
  const eventModel = _modelDetail(modelChangeDetail || {});
  if (eventModel.model || eventModel.provider) {
    const label = _setBadgeLabel(prettifyModelName(eventModel.model, eventModel.provider));
    // switch_model is turn-scoped and does not mutate /api/settings/provider, so
    // keep the streamed active-model label instead of overwriting it from config.
    if (String(modelChangeDetail?.sourceEventType || '') === 'model_switched') {
      _llmCache = null;
      return label;
    }
  }
  const llm = await _loadLlm(force);
  const { provider, model } = _activeModel(llm);
  return _setBadgeLabel(prettifyModelName(model, provider));
}

// Seed text used by renderMobileHeader so the badge isn't empty on first paint.
export function mobileModelBadgeSeedLabel() {
  return window.__pmModelBadgeLabel || 'Online';
}

// ── Model popover plumbing ────────────────────────────────────────────────────
function _closeSheet() {
  const scrim = document.getElementById('pm-msheet-scrim');
  const sheet = document.getElementById('pm-msheet');
  sheet?.__pmModelSheetCleanup?.();
  if (scrim) scrim.classList.remove('open');
  if (sheet) sheet.classList.remove('open');
  setTimeout(() => {
    if (scrim) scrim.remove();
    if (sheet) sheet.remove();
  }, 220);
}

function _positionSheetNearBadge(sheet) {
  if (!sheet) return;
  const margin = 10;
  const badge = document.querySelector('.pm-model-badge');
  const rect = badge?.getBoundingClientRect?.();
  const width = Math.min(360, Math.max(280, window.innerWidth - margin * 2));
  const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, center - width / 2));
  const preferredTop = rect ? rect.bottom + 10 : Math.max(70, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 70);
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - 260));
  const maxHeight = Math.max(240, window.innerHeight - top - margin);
  sheet.style.setProperty('--pm-msheet-left', `${left}px`);
  sheet.style.setProperty('--pm-msheet-top', `${top}px`);
  sheet.style.setProperty('--pm-msheet-width', `${width}px`);
  sheet.style.setProperty('--pm-msheet-max-height', `${maxHeight}px`);
}

function _openSheet(titleHtml, bodyHtml) {
  _closeSheetImmediate();
  const scrim = document.createElement('div');
  scrim.id = 'pm-msheet-scrim';
  scrim.className = 'pm-msheet-scrim';
  const sheet = document.createElement('div');
  sheet.id = 'pm-msheet';
  sheet.className = 'pm-msheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="pm-msheet-handle"></div>
    <div class="pm-msheet-head">
      <div class="pm-msheet-title">${titleHtml}</div>
      <button type="button" class="pm-msheet-close" aria-label="Close">&times;</button>
    </div>
    <div class="pm-msheet-body" id="pm-msheet-body">${bodyHtml}</div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  _positionSheetNearBadge(sheet);
  const reposition = () => _positionSheetNearBadge(sheet);
  requestAnimationFrame(() => { scrim.classList.add('open'); sheet.classList.add('open'); });
  scrim.addEventListener('click', _closeSheet);
  sheet.querySelector('.pm-msheet-close')?.addEventListener('click', _closeSheet);
  sheet.addEventListener('selectstart', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  sheet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('resize', reposition, { passive: true });
  window.visualViewport?.addEventListener?.('resize', reposition, { passive: true });
  sheet.__pmModelSheetCleanup = () => {
    window.removeEventListener('resize', reposition);
    window.visualViewport?.removeEventListener?.('resize', reposition);
  };
  return sheet;
}

function _closeSheetImmediate() {
  document.getElementById('pm-msheet')?.__pmModelSheetCleanup?.();
  document.getElementById('pm-msheet-scrim')?.remove();
  document.getElementById('pm-msheet')?.remove();
}

function _setSheetBody(html) {
  const body = document.getElementById('pm-msheet-body');
  if (body) body.innerHTML = html;
  return body;
}

function _setSheetTitle(html) {
  const t = document.querySelector('#pm-msheet .pm-msheet-title');
  if (t) t.innerHTML = html;
}

function _toast(msg, kind) {
  try { window.pmToast ? window.pmToast(msg, kind) : null; } catch {}
}

// ── TAP: reasoning / thinking sheet for the active provider ──────────────────
async function _openReasoningSheet() {
  _openSheet('Reasoning', '<div class="pm-msheet-loading">Loading…</div>');
  const llm = await _loadLlm(true);
  const { provider } = _activeModel(llm);
  const cfg = (llm.providers || {})[provider] || {};
  _renderReasoningBody(provider, cfg);
}

function _renderReasoningBody(provider, cfg) {
  _setSheetTitle(`Reasoning · <span class="pm-msheet-sub">${_esc(_providerLabel(provider))}</span>`);

  let options = null;
  if (provider === 'openai') options = EFFORT_OPTIONS;
  else if (provider === 'openai_codex') options = CODEX_EFFORT_OPTIONS;
  else if (provider === 'perplexity') options = PERPLEXITY_EFFORT_OPTIONS;
  else if (provider === 'xai') {
    const model = String(cfg.model || '').trim();
    options = /^grok-4\.20-multi-agent(?:-|$)/i.test(model) ? XAI_MULTI_AGENT_EFFORT_OPTIONS : XAI_EFFORT_OPTIONS;
  }
  else if (provider === 'anthropic') options = ANTHROPIC_EFFORT_OPTIONS;

  if (!options) {
    _setSheetBody(`<div class="pm-msheet-empty">${_esc(_providerLabel(provider))} has no adjustable reasoning levels.</div>`);
    return;
  }

  const current = String(cfg.reasoning_effort || '').trim();
  const labelFor = (v) => {
    if (!v) return (provider === 'anthropic' || provider === 'xai') ? 'Provider default' : 'None';
    if (v === 'xhigh') return 'Extra high';
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
  const rows = options.map((v) => `
    <button type="button" class="pm-msheet-row" data-effort="${_esc(v)}">
      <span class="pm-msheet-row-label">${_esc(labelFor(v))}</span>
      ${v === current ? '<span class="pm-msheet-check">✓</span>' : ''}
    </button>`).join('');

  const anthropicToggle = provider === 'anthropic'
    ? `<label class="pm-msheet-toggle">
         <span>Extended thinking</span>
         <input type="checkbox" id="pm-msheet-extthink" ${cfg.extended_thinking === true ? 'checked' : ''} />
       </label>
       <label class="pm-msheet-toggle">
         <span>Fast mode<br><span class="pm-msheet-toggle-hint">Faster output · Opus 4.6/4.7/4.8</span></span>
         <input type="checkbox" id="pm-msheet-fastmode" ${cfg.fast_mode === true ? 'checked' : ''} />
       </label>`
    : '';

  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>${anthropicToggle}`);
  if (!body) return;

  body.querySelectorAll('[data-effort]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const effort = btn.getAttribute('data-effort') || '';
      const extEl = document.getElementById('pm-msheet-extthink');
      const fastEl = document.getElementById('pm-msheet-fastmode');
      await _saveReasoning(provider, {
        reasoning_effort: effort,
        ...(provider === 'anthropic' ? {
          extended_thinking: !!(extEl && extEl.checked),
          fast_mode: !!(fastEl && fastEl.checked),
        } : {}),
      });
    });
  });
  document.getElementById('pm-msheet-extthink')?.addEventListener('change', async (e) => {
    await _saveReasoning(provider, { extended_thinking: !!e.target.checked }, { keepOpen: true });
  });
  document.getElementById('pm-msheet-fastmode')?.addEventListener('change', async (e) => {
    await _saveReasoning(provider, { fast_mode: !!e.target.checked }, { keepOpen: true });
  });
}

async function _saveReasoning(provider, patch, { keepOpen = false } = {}) {
  try {
    const llm = await _loadLlm(true);
    const existing = (llm.providers || {})[provider] || {};
    const merged = { ...existing, ...patch };
    if (merged.reasoning_effort === '') delete merged.reasoning_effort;
    await mobileGatewayFetch('/api/settings/provider', {
      method: 'POST',
      body: JSON.stringify({ llm: { provider, providers: { [provider]: merged } } }),
    });
    await _loadLlm(true);
    _toast('Reasoning updated', 'success');
    if (!keepOpen) _closeSheet();
    else {
      const fresh = (_llmCache.providers || {})[provider] || {};
      _renderReasoningBody(provider, fresh);
    }
  } catch (err) {
    _toast(err?.message || 'Could not save reasoning', 'error');
  }
}

// ── HOLD: provider → model switch sheet ──────────────────────────────────────
async function _openSwitchSheet() {
  _openSheet('Switch model', '<div class="pm-msheet-loading">Loading providers…</div>');
  await Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true)]);
  _renderProviderList();
}

function _renderProviderList() {
  _setSheetTitle('Switch model');
  const { provider: activeProvider } = _activeModel(_llmCache);
  const ids = (_credentialedIds || []).slice();
  // Keep a stable, builtin-first ordering.
  const order = Object.keys(BUILTIN_LABELS);
  ids.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (!ids.length) {
    _setSheetBody('<div class="pm-msheet-empty">No providers with saved credentials. Add an API key or connect a provider in Settings.</div>');
    return;
  }

  const rows = ids.map((id) => `
    <button type="button" class="pm-msheet-row" data-provider="${_esc(id)}">
      <span class="pm-msheet-row-label">${_esc(_providerLabel(id))}</span>
      ${id === activeProvider ? '<span class="pm-msheet-dot" title="Current"></span>' : ''}
      <span class="pm-msheet-chev">›</span>
    </button>`).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  if (!body) return;
  body.querySelectorAll('[data-provider]').forEach((btn) => {
    btn.addEventListener('click', () => _renderModelList(btn.getAttribute('data-provider')));
  });
}

function _renderModelList(provider) {
  const { provider: activeProvider, model: activeModel } = _activeModel(_llmCache);
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">‹</button> ${_esc(_providerLabel(provider))}`);
  const models = _modelsForProvider(provider);

  let rows = models.map((m) => {
    const isActive = provider === activeProvider && m === activeModel;
    return `<button type="button" class="pm-msheet-row" data-model="${_esc(m)}">
      <span class="pm-msheet-row-label">${_esc(prettifyModelName(m, provider))}</span>
      ${isActive ? '<span class="pm-msheet-check">✓</span>' : ''}
    </button>`;
  }).join('');
  if (!models.length) {
    rows = '<div class="pm-msheet-empty">No known models — fetch them from Settings ▸ Models.</div>';
  }
  const body = _setSheetBody(`<div class="pm-msheet-rows pm-msheet-model-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderProviderList);
  if (!body) return;
  body.querySelectorAll('[data-model]').forEach((btn) => {
    btn.addEventListener('click', () => _switchModel(provider, btn.getAttribute('data-model')));
  });
}

async function _switchModel(provider, model) {
  if (!provider || !model) return;
  try {
    await mobileGatewayFetch('/api/settings/model', {
      method: 'POST',
      body: JSON.stringify({ provider, model }),
    });
    _llmCache = null; // force refresh
    _toast(`Model → ${prettifyModelName(model, provider)}`, 'success');
    _closeSheet();
    await refreshMobileModelBadge(true);
    try { window.dispatchEvent(new CustomEvent('pm-model-changed', { detail: { provider, model } })); } catch {}
  } catch (err) {
    _toast(err?.message || 'Could not switch model', 'error');
  }
}

// ── Press / long-press gesture wiring (delegated, attached once) ─────────────
let _wired = false;
const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 12;

export function initMobileModelBadge() {
  if (_wired) return;
  _wired = true;

  let pressTimer = null;
  let longFired = false;
  let startX = 0;
  let startY = 0;
  let pressBadge = null;
  let suppressNextClick = false;

  const findBadge = (target) => (target?.closest ? target.closest('.pm-model-badge') : null);
  const setSuppressNativeSelection = (on) => {
    document.documentElement.classList.toggle('pm-model-badge-pressing', !!on);
    document.body?.classList?.toggle('pm-model-badge-pressing', !!on);
  };

  document.addEventListener('pointerdown', (e) => {
    const badge = findBadge(e.target);
    if (!badge) return;
    e.preventDefault();
    longFired = false;
    pressBadge = badge;
    setSuppressNativeSelection(true);
    startX = e.clientX; startY = e.clientY;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longFired = true;
      pmHaptic(18);
      _openSwitchSheet();
    }, LONG_PRESS_MS);
  });

  document.addEventListener('pointermove', (e) => {
    if (!pressTimer) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
      clearTimeout(pressTimer); pressTimer = null; pressBadge = null; setSuppressNativeSelection(false);
    }
  });

  const cancel = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressBadge = null;
    setSuppressNativeSelection(false);
  };
  document.addEventListener('pointerup', (e) => {
    const badge = pressBadge;
    const wasLong = longFired;
    const moved = Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX;
    cancel();
    if (badge && !wasLong && !moved) {
      suppressNextClick = true;
      _openReasoningSheet();
      setTimeout(() => { suppressNextClick = false; }, 350);
    }
  });
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('selectstart', (e) => {
    if (pressBadge || findBadge(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (pressBadge || findBadge(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('click', (e) => {
    const badge = findBadge(e.target);
    if (!badge) return;
    if (suppressNextClick) { e.preventDefault(); e.stopPropagation(); return; }
    if (longFired) { e.preventDefault(); e.stopPropagation(); longFired = false; return; }
    _openReasoningSheet();
  });

  // Keep the label fresh on navigation and when the model changes elsewhere.
  window.addEventListener('hashchange', () => { refreshMobileModelBadge(false).catch(() => {}); });
  window.addEventListener('pm-model-changed', (event) => {
    const detail = event?.detail || {};
    refreshMobileModelBadge(true, detail).catch(() => {});
  });

  refreshMobileModelBadge(true).catch(() => {});
}
