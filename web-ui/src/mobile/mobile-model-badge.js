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
import { effortOptions, supportsFastSpeed } from '../reasoning-capabilities.js';
import { formatModelDisplayName, formatModelWithReasoning } from '../model-display.js';

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
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o1'],
  openai_codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-codex', 'gpt-5.4-codex-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.3', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1'],
  anthropic: ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning', 'sonar-deep-research'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  xai: ['grok-4.5', 'grok-composer-2.5-fast', 'grok-4.3', 'grok-4.3-latest', 'grok-latest', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent', 'grok-build-0.1'],
};

// Reasoning controls per provider (mirrors mobile-settings renderProviderFields).
const REASONING_EFFORT_PROVIDERS = new Set(['openai', 'openai_codex', 'perplexity', 'xai']);
const EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORT_OPTIONS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
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
  return formatModelDisplayName(model, provider);
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
  try {
    const haptics = window.Capacitor?.Plugins?.Haptics || window.Haptics;
    if (haptics?.selectionChanged) {
      haptics.selectionChanged();
      return;
    }
    if (haptics?.impact) {
      haptics.impact({ style: strength >= 16 ? 'medium' : 'light' });
      return;
    }
  } catch {}
  try {
    const tgHaptics = window.Telegram?.WebApp?.HapticFeedback;
    if (tgHaptics?.selectionChanged) {
      tgHaptics.selectionChanged();
      return;
    }
    if (tgHaptics?.impactOccurred) {
      tgHaptics.impactOccurred(strength >= 16 ? 'medium' : 'light');
      return;
    }
  } catch {}
  try { if (navigator.vibrate) navigator.vibrate(strength); } catch {}
  // Best effort on iOS web. Physical clicks on native switch inputs can haptic;
  // synthetic clicks usually cannot, but doing this synchronously during a touch
  // event is the only web-only fallback available for drag boundary ticks.
  try {
    const sw = _ensureHapticSwitch();
    sw.click?.();
    sw.checked = !sw.checked;
  } catch {}
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
  // Catalog order is source of truth; builtin fills gaps only.
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

function _activeChatSessionId() {
  return String(window.__pmChat?.activeSessionId || '').trim();
}

async function _loadChatModelRoute() {
  const sessionId = _activeChatSessionId();
  if (!sessionId || sessionId === 'mobile_default') return null;
  try {
    const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`);
    return data?.chatModelRoute || null;
  } catch { return null; }
}

async function _saveChatModelRoute(route) {
  const sessionId = _activeChatSessionId();
  if (!sessionId || sessionId === 'mobile_default') throw new Error('Send the first message before choosing a model for this chat.');
  const data = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, {
    method: 'PUT', body: JSON.stringify(route),
  });
  if (data?.success === false) throw new Error(data.error || 'Could not update this chat model');
  return data?.chatModelRoute || null;
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

function _setBadgeFast(fast) {
  window.__pmModelBadgeFast = !!fast;
  document.querySelectorAll('.pm-model-badge .pm-model-speed-icon').forEach((el) => {
    el.hidden = !fast;
  });
}

// ── Badge label refresh ──────────────────────────────────────────────────────
export async function refreshMobileModelBadge(force = false, modelChangeDetail = null) {
  const eventModel = _modelDetail(modelChangeDetail || {});
  const llm = await _loadLlm(force);
  if (eventModel.model || eventModel.provider) {
    const eventCfg = llm?.providers?.[eventModel.provider] || {};
    const eventEffort = String(modelChangeDetail?.reasoningEffort || modelChangeDetail?.reasoning_effort || eventCfg.reasoning_effort || '').trim();
    const label = _setBadgeLabel(formatModelWithReasoning(eventModel.model, eventModel.provider, eventEffort));
    // switch_model is turn-scoped and does not mutate /api/settings/provider, so
    // keep the streamed active-model label instead of overwriting it from config.
    if (String(modelChangeDetail?.sourceEventType || '') === 'model_switched') {
      _llmCache = null;
      return label;
    }
  }
  const route = await _loadChatModelRoute();
  window.__pmChatModelRoute = route;
  const { provider, model } = route?.effective?.providerId
    ? { provider: route.effective.providerId, model: route.effective.model }
    : _activeModel(llm);
  const cfg = { ...(llm?.providers?.[provider] || {}), model, reasoning_effort: route?.effective?.reasoningEffort || (llm?.providers?.[provider] || {}).reasoning_effort };
  if (route?.effective?.providerId && _llmCache) {
    _llmCache = { ..._llmCache, provider, providers: { ...(_llmCache.providers || {}), [provider]: cfg } };
  }
  _setBadgeFast(supportsFastSpeed(provider, model) && (cfg.speed === 'fast' || cfg.fast_mode === true));
  return _setBadgeLabel(formatModelWithReasoning(model, provider, cfg.reasoning_effort));
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
  const positionSheet = () => {
    if (sheet.classList.contains('is-reasoning') || sheet.classList.contains('is-model-switch')) return;
    _positionSheetNearBadge(sheet);
  };
  positionSheet();
  const reposition = positionSheet;
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

// ── TAP: fluid reasoning slider + click-through advanced model controls ───────
let _reasoningSaveTimer = null;
let _reasoningSaveChain = Promise.resolve();

function _effortOptions(provider, cfg = {}) {
  if (provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic') {
    return effortOptions(provider, cfg.model || '');
  }
  if (provider === 'perplexity') return PERPLEXITY_EFFORT_OPTIONS;
  if (provider === 'xai') {
    const model = String(cfg.model || '').trim();
    return /^grok-4\.20-multi-agent(?:-|$)/i.test(model) ? XAI_MULTI_AGENT_EFFORT_OPTIONS : XAI_EFFORT_OPTIONS;
  }
  return null;
}

function _effortLabel(value, provider) {
  if (!value) return (provider === 'anthropic' || provider === 'xai') ? 'Auto' : 'None';
  if (value === 'xhigh') return 'X high';
  if (value === 'max') return 'Max';
  if (value === 'ultra') return 'Ultra';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function _openReasoningSheet() {
  pmHaptic(10);
  const sheet = _openSheet('', '<div class="pm-msheet-loading">Loading…</div>');
  sheet?.classList.add('is-reasoning');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-reasoning');
  sheet?.removeAttribute('style');
  await Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true)]);
  await refreshMobileModelBadge(true);
  const { provider } = _activeModel(_llmCache);
  const cfg = (_llmCache.providers || {})[provider] || {};
  _renderReasoningBody(provider, cfg);
}

function _renderReasoningBody(provider, cfg) {
  const options = _effortOptions(provider, cfg);
  const current = String(cfg.reasoning_effort || '').trim();
  const selectedIndex = Math.max(0, options ? options.indexOf(current) : 0);
  const selectedProgress = options && options.length > 1 ? selectedIndex / (options.length - 1) : 0;
  const selectedFillWidth = options && options.length ? ((1 / options.length) + selectedProgress * ((options.length - 1) / options.length)) * 100 : 0;
  const modelName = prettifyModelName(cfg.model, provider);
  const effortName = options ? _effortLabel(options[selectedIndex], provider) : 'Default';
  const sourceLabel = window.__pmChatModelRoute?.mode === 'explicit' ? 'This chat' : 'Main Chat default';
  _setSheetTitle('');

  const slider = options ? `
    <div class="pm-reasoning-control" id="pm-reasoning-control" style="--pm-reasoning-index:${selectedIndex};--pm-reasoning-progress:${selectedProgress};--pm-reasoning-fill-width:${selectedFillWidth}%;--pm-reasoning-steps:${Math.max(1, options.length - 1)}" role="slider" tabindex="0" aria-label="Reasoning level" aria-valuemin="0" aria-valuemax="${options.length - 1}" aria-valuenow="${selectedIndex}" aria-valuetext="${_esc(effortName)}">
      <div class="pm-reasoning-track" aria-hidden="true">
        <div class="pm-reasoning-fill"></div>
        ${options.map((value, index) => `<button type="button" class="pm-reasoning-segment ${index === selectedIndex ? 'is-active ' : ''}${index <= selectedIndex ? 'is-filled' : ''}" data-index="${index}" aria-label="${_esc(_effortLabel(value, provider))}"><span>${_esc(_effortLabel(value, provider))}</span></button>`).join('')}
      </div>
    </div>` : `<div class="pm-msheet-empty">${_esc(_providerLabel(provider))} has no adjustable reasoning levels.</div>`;

  const body = _setSheetBody(`
    <button type="button" class="pm-reasoning-summary" id="pm-reasoning-model" aria-label="Choose model and provider">
      <strong>${_esc(modelName)}</strong><span aria-hidden="true">·</span><span id="pm-reasoning-live-label">${_esc(effortName)}</span><span class="pm-reasoning-summary-chev" aria-hidden="true">›</span>
    </button>
    <div class="pm-msheet-source">${_esc(sourceLabel)}</div>
    ${slider}`);
  if (!body) return;

  document.getElementById('pm-reasoning-model')?.addEventListener('click', () => {
    pmHaptic(10);
    _openSwitchSheet();
  });

  const control = document.getElementById('pm-reasoning-control');
  if (control && options) {
    let lastIndex = selectedIndex;
    const indexMax = Math.max(1, options.length - 1);
    const setProgress = (progress) => {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      control.style.setProperty('--pm-reasoning-progress', String(safeProgress));
      const fillWidth = ((1 / options.length) + safeProgress * ((options.length - 1) / options.length)) * 100;
      control.style.setProperty('--pm-reasoning-fill-width', `${fillWidth}%`);
    };
    const commitIndex = (index, immediate = false, { snap = true, save = true } = {}) => {
      const safeIndex = Math.max(0, Math.min(options.length - 1, Number(index) || 0));
      const value = options[safeIndex] || '';
      const label = _effortLabel(value, provider);
      control.style.setProperty('--pm-reasoning-index', String(safeIndex));
      if (snap) setProgress(safeIndex / indexMax);
      control.setAttribute('aria-valuenow', String(safeIndex));
      control.setAttribute('aria-valuetext', label);
      document.getElementById('pm-reasoning-live-label').textContent = label;
      control.querySelectorAll('.pm-reasoning-segment').forEach((segment, segmentIndex) => {
        segment.classList.toggle('is-active', segmentIndex === safeIndex);
        segment.classList.toggle('is-filled', segmentIndex <= safeIndex);
      });
      if (safeIndex !== lastIndex) { pmHaptic(4); lastIndex = safeIndex; }
      if (save) _queueReasoningSave(provider, { reasoning_effort: value }, immediate);
    };
    const progressFromEvent = (event) => {
      const rect = control.getBoundingClientRect();
      const pct = rect.width ? (event.clientX - rect.left) / rect.width : 0;
      return Math.max(0, Math.min(1, pct));
    };
    const indexFromProgress = (progress) => {
      return Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * (options.length - 1));
    };
    const updateFromPointer = (event, immediate = false) => {
      const progress = progressFromEvent(event);
      setProgress(progress);
      commitIndex(indexFromProgress(progress), immediate, { snap: immediate, save: immediate });
    };
    control.querySelectorAll('.pm-reasoning-segment').forEach((segment) => {
      segment.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitIndex(segment.getAttribute('data-index'), true);
      });
    });
    control.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      control.setPointerCapture?.(event.pointerId);
      control.classList.add('is-dragging');
      updateFromPointer(event);
    });
    control.addEventListener('pointermove', (event) => {
      if (!control.classList.contains('is-dragging')) return;
      updateFromPointer(event);
    });
    const finishDrag = (event) => {
      if (!control.classList.contains('is-dragging')) return;
      control.classList.remove('is-dragging');
      control.releasePointerCapture?.(event.pointerId);
      updateFromPointer(event, true);
    };
    control.addEventListener('pointerup', finishDrag);
    control.addEventListener('pointercancel', finishDrag);
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const currentIndex = Number(control.getAttribute('aria-valuenow') || selectedIndex);
      if (event.key === 'Home') commitIndex(0, true);
      else if (event.key === 'End') commitIndex(options.length - 1, true);
      else commitIndex(currentIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
    });
  }
}

function _queueReasoningSave(provider, patch, immediate = false) {
  const existing = (_llmCache?.providers || {})[provider] || {};
  const merged = { ...existing, ...patch };
  if (merged.reasoning_effort === '') delete merged.reasoning_effort;
  if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
  _setBadgeLabel(formatModelWithReasoning(merged.model || _activeModel(_llmCache).model, provider, merged.reasoning_effort));
  clearTimeout(_reasoningSaveTimer);
  const commit = () => {
    _reasoningSaveChain = _reasoningSaveChain.then(async () => {
      const route = await _loadChatModelRoute();
      const effective = route?.effective || { providerId: provider, model: merged.model || _activeModel(_llmCache).model };
      await _saveChatModelRoute({ providerId: provider, model: merged.model || effective.model, reasoningEffort: merged.reasoning_effort || undefined, accountId: effective.accountId || undefined });
      await refreshMobileModelBadge(true);
    }).catch((err) => _toast(err?.message || 'Could not save reasoning', 'error'));
  };
  if (immediate) commit();
  else _reasoningSaveTimer = setTimeout(commit, 180);
}

// ── Advanced: provider / model / intelligence controls ───────────────────────
async function _openSwitchSheet() {
  const sheet = _openSheet('Advanced <span class="pm-msheet-chev">›</span>', '<div class="pm-msheet-loading">Loading controls…</div>');
  sheet?.classList.add('is-model-switch');
  document.getElementById('pm-msheet-scrim')?.classList.add('is-model-switch');
  sheet?.removeAttribute('style');
  await Promise.all([_loadLlm(true), _loadCatalog(false), _loadCredentialedIds(true)]);
  await refreshMobileModelBadge(true);
  _renderAdvancedSheet();
}

function _currentAdvancedState() {
  const { provider, model } = _activeModel(_llmCache);
  const cfg = (_llmCache?.providers || {})[provider] || {};
  const options = _effortOptions(provider, cfg);
  const effort = String(cfg.reasoning_effort || '').trim();
  const effortValue = options && options.includes(effort) ? effort : (options ? options[0] : '');
  return { provider, model: cfg.model || model, cfg, options, effortValue };
}

function _advancedRow(label, value, action, { disabled = false } = {}) {
  return `
    <button type="button" class="pm-advanced-row" data-action="${_esc(action)}" ${disabled ? 'disabled' : ''}>
      <span class="pm-advanced-row-label">${_esc(label)}</span>
      <span class="pm-advanced-row-value">${_esc(value)}</span>
      <span class="pm-advanced-row-chev" aria-hidden="true">⌄</span>
    </button>`;
}

function _renderAdvancedSheet() {
  _setSheetTitle('Advanced <span class="pm-msheet-chev">›</span>');
  const { provider, model, cfg, options, effortValue } = _currentAdvancedState();
  const rows = [
    _advancedRow('Provider', _providerLabel(provider), 'provider'),
    _advancedRow('Model', prettifyModelName(model, provider), 'model'),
    _advancedRow('Intelligence', options ? _effortLabel(effortValue, provider) : 'Default', 'intelligence', { disabled: !options }),
  ];
  if (supportsFastSpeed(provider, model)) rows.push(_advancedRow('Speed', cfg.speed === 'fast' || cfg.fast_mode === true ? 'Fast' : 'Standard', 'speed'));
  const source = window.__pmChatModelRoute?.mode === 'explicit' ? 'This chat' : 'Main Chat default';
  const reset = window.__pmChatModelRoute?.mode === 'explicit' ? '<button type="button" class="pm-msheet-row" data-action="follow-default"><span class="pm-msheet-row-label">Use Main Chat Default</span></button>' : '';
  const body = _setSheetBody(`<div class="pm-msheet-source">${_esc(source)}</div><div class="pm-advanced-panel">${rows.join('')}</div>${reset}`);
  if (!body) return;
  body.querySelector('[data-action="provider"]')?.addEventListener('click', _renderProviderList);
  body.querySelector('[data-action="model"]')?.addEventListener('click', () => _renderModelList(provider));
  body.querySelector('[data-action="intelligence"]')?.addEventListener('click', () => _renderEffortList(provider));
  body.querySelector('[data-action="speed"]')?.addEventListener('click', () => _renderSpeedList(provider));
  body.querySelector('[data-action="follow-default"]')?.addEventListener('click', async () => {
    const sessionId = _activeChatSessionId();
    await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/model-route`, { method: 'DELETE' });
    window.__pmChatModelRoute = await _loadChatModelRoute();
    await refreshMobileModelBadge(true);
    _renderAdvancedSheet();
  });
}

function _renderSpeedList(provider) {
  const cfg = (_llmCache?.providers || {})[provider] || {};
  if (!supportsFastSpeed(provider, cfg.model || '')) return _renderAdvancedSheet();
  const current = cfg.speed === 'fast' || cfg.fast_mode === true ? 'fast' : 'standard';
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">‹</button> Speed`);
  const rows = ['standard', 'fast'].map(value => `<button type="button" class="pm-msheet-row" data-speed="${value}"><span class="pm-msheet-row-label">${value === 'fast' ? 'Fast' : 'Standard'}</span>${value === current ? '<span class="pm-msheet-check">✓</span>' : ''}</button>`).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  body?.querySelectorAll('[data-speed]').forEach(btn => btn.addEventListener('click', () => {
    const speed = btn.getAttribute('data-speed') === 'fast' ? 'fast' : 'standard';
    _queueReasoningSave(provider, { speed }, true);
    const merged = { ...cfg, speed }; delete merged.fast_mode;
    if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
    _setBadgeFast(speed === 'fast');
    _renderAdvancedSheet();
  }));
}

function _renderProviderList() {
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">‹</button> Provider`);
  const { provider: activeProvider } = _activeModel(_llmCache);
  const ids = (_credentialedIds || []).slice();
  if (activeProvider && !ids.includes(activeProvider)) ids.unshift(activeProvider);
  // Keep a stable, builtin-first ordering.
  const order = Object.keys(BUILTIN_LABELS);
  ids.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  if (!ids.length) {
    _setSheetBody('<div class="pm-msheet-empty">No providers with saved credentials. Add an API key or connect a provider in Settings.</div>');
    document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
    return;
  }

  const rows = ids.map((id) => `
    <button type="button" class="pm-msheet-row" data-provider="${_esc(id)}">
      <span class="pm-msheet-row-label">${_esc(_providerLabel(id))}</span>
      ${id === activeProvider ? '<span class="pm-msheet-dot" title="Current"></span>' : ''}
      <span class="pm-msheet-chev">›</span>
    </button>`).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextProvider = btn.getAttribute('data-provider');
      const existing = (_llmCache?.providers || {})[nextProvider] || {};
      const nextModel = existing.model || _modelsForProvider(nextProvider)[0] || '';
      if (nextModel) await _switchModel(nextProvider, nextModel, { keepOpen: true, returnToAdvanced: true });
      else _renderModelList(nextProvider);
    });
  });
}

function _renderModelList(provider) {
  const { provider: activeProvider, model: activeModel } = _activeModel(_llmCache);
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">‹</button> Model`);
  const models = _modelsForProvider(provider);

  let rows = models.map((m) => {
    const isActive = provider === activeProvider && m === activeModel;
    return `<button type="button" class="pm-msheet-row" data-model="${_esc(m)}">
      <span class="pm-msheet-row-label">${_esc(prettifyModelName(m, provider))}</span>
      ${isActive ? '<span class="pm-msheet-check">✓</span>' : ''}
    </button>`;
  }).join('');
  if (!models.length) {
    rows = '<div class="pm-msheet-empty">No known models. Fetch them from Settings > Models.</div>';
  }
  const body = _setSheetBody(`<div class="pm-msheet-rows pm-msheet-model-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-model]').forEach((btn) => {
    btn.addEventListener('click', () => _switchModel(provider, btn.getAttribute('data-model'), { keepOpen: true, returnToAdvanced: true }));
  });
}

function _renderEffortList(provider) {
  const cfg = (_llmCache?.providers || {})[provider] || {};
  const options = _effortOptions(provider, cfg);
  if (!options) {
    _renderAdvancedSheet();
    return;
  }
  const current = String(cfg.reasoning_effort || '').trim();
  _setSheetTitle(`<button type="button" class="pm-msheet-back" id="pm-msheet-back">‹</button> Intelligence`);
  const rows = options.map((value) => {
    const isActive = value === current || (!value && !current);
    return `<button type="button" class="pm-msheet-row" data-effort="${_esc(value)}">
      <span class="pm-msheet-row-label">${_esc(_effortLabel(value, provider))}</span>
      ${isActive ? '<span class="pm-msheet-check">✓</span>' : ''}
    </button>`;
  }).join('');
  const body = _setSheetBody(`<div class="pm-msheet-rows">${rows}</div>`);
  document.getElementById('pm-msheet-back')?.addEventListener('click', _renderAdvancedSheet);
  if (!body) return;
  body.querySelectorAll('[data-effort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-effort') || '';
      _queueReasoningSave(provider, { reasoning_effort: value }, true);
      const merged = { ...cfg, reasoning_effort: value };
      if (!value) delete merged.reasoning_effort;
      if (_llmCache) _llmCache.providers = { ...(_llmCache.providers || {}), [provider]: merged };
      _renderAdvancedSheet();
    });
  });
}

async function _switchModel(provider, model, { keepOpen = false, returnToAdvanced = false } = {}) {
  if (!provider || !model) return;
  try {
    const current = await _loadChatModelRoute();
    await _saveChatModelRoute({ providerId: provider, model, reasoningEffort: current?.effective?.providerId === provider ? current.effective.reasoningEffort || undefined : undefined, accountId: current?.effective?.providerId === provider ? current.effective.accountId || undefined : undefined });
    window.__pmChatModelRoute = await _loadChatModelRoute();
    const nextCfg = { ...((_llmCache?.providers || {})[provider] || {}), model, reasoning_effort: window.__pmChatModelRoute?.effective?.reasoningEffort };
    _toast(`Model → ${prettifyModelName(model, provider)}`, 'success');
    await refreshMobileModelBadge(false, { provider, model });
    try { window.dispatchEvent(new CustomEvent('pm-model-changed', { detail: { provider, model } })); } catch {}
    if (keepOpen && returnToAdvanced) _renderAdvancedSheet();
    else if (keepOpen) _renderReasoningBody(provider, nextCfg, true);
    else _closeSheet();
  } catch (err) {
    _toast(err?.message || 'Could not switch model', 'error');
  }
}

// ── Tap gesture wiring (delegated, attached once) ────────────────────────────
let _wired = false;

export function initMobileModelBadge() {
  if (_wired) return;
  _wired = true;

  const findBadge = (target) => (target?.closest ? target.closest('.pm-model-badge') : null);

  document.addEventListener('contextmenu', (event) => {
    if (!findBadge(event.target)) return;
    event.preventDefault();
  }, true);

  document.addEventListener('click', (event) => {
    const badge = findBadge(event.target);
    if (!badge) return;
    event.preventDefault();
    event.stopPropagation();
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
