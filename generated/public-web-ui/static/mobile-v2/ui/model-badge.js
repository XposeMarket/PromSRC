import { formatModelDisplayName } from '../../model-display.js';
import { formatReasoningSelectorLabel, reasoningSelectorOptions, supportsFastSpeed } from '../../reasoning-capabilities.js';
import { renderReasoningSelector, wireReasoningSelector } from '../../components/reasoning-selector.js';
import { mobileV2Haptic } from './haptics.js';

const DRAFT_ROUTE_KEY = 'pm_mobile_v2_chat_model_route_v1';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function readDraftRoute() {
  try {
    const route = JSON.parse(localStorage.getItem(DRAFT_ROUTE_KEY) || 'null');
    return route && typeof route === 'object' ? route : null;
  } catch { return null; }
}

function writeDraftRoute(route) {
  try { localStorage.setItem(DRAFT_ROUTE_KEY, JSON.stringify(route)); } catch {}
}

function modelNames(provider, catalog, llm) {
  const item = catalog.find((entry) => String(entry?.id || '') === provider);
  const values = item?.runtime?.options?.staticModels;
  const names = (Array.isArray(values) ? values : []).map((value) => String(value?.name || value || '').trim()).filter(Boolean);
  const configured = String(llm?.providers?.[provider]?.model || '').trim();
  if (configured && !names.includes(configured)) names.unshift(configured);
  return [...new Set(names)];
}

export function attachMobileV2ModelBadge({ badge, gateways, sessionRef, onModelLabel, onFastMode } = {}) {
  if (!badge || !gateways) return { dispose() {}, applyDraftToSession: async () => null };
  let disposed = false;
  let holdTimer = null;
  let holdTriggered = false;
  let sheet = null;
  let scrim = null;
  let sheetKeydown = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let state = null;
  const label = badge.querySelector('[data-model-label]');
  const fastIcon = badge.querySelector('[data-model-fast]');
  const currentContext = () => {
    const ref = typeof sessionRef === 'function' ? sessionRef() : '';
    const resolved = gateways.resolveSessionRef(ref || 'mobile_default');
    const gatewayId = resolved?.gatewayId || gateways.activeId;
    return {
      ref,
      gatewayId,
      sessionId: String(resolved?.sessionId || 'mobile_default'),
      client: gateways.client(gatewayId),
    };
  };
  const setFast = (fast) => {
    const visible = Boolean(fast);
    if (fastIcon) fastIcon.hidden = !visible;
    badge.classList.toggle('is-fast', visible);
    onFastMode?.(visible);
  };
  const syncBadge = () => {
    if (!state) return;
    const provider = state.provider;
    const model = state.model;
    const fast = state.speed === 'fast' && supportsFastSpeed(provider, model);
    setFast(fast);
    const formatted = model ? formatModelDisplayName(model, provider) : '';
    if (formatted) {
      if (label) label.textContent = formatted;
      onModelLabel?.(formatted);
    }
  };
  const closeSheet = () => {
    if (!sheet) return;
    const oldSheet = sheet;
    const oldScrim = scrim;
    sheet = null;
    scrim = null;
    document.body.classList.remove('pm-mobile-overlay-open');
    if (sheetKeydown) document.removeEventListener('keydown', sheetKeydown, true);
    sheetKeydown = null;
    oldSheet.classList.remove('open');
    oldScrim?.classList.remove('open');
    window.setTimeout(() => { oldSheet.remove(); oldScrim?.remove(); }, 220);
  };
  const openSheet = (kind, title, bodyHtml) => {
    closeSheet();
    document.body.classList.add('pm-mobile-overlay-open');
    scrim = document.createElement('div');
    scrim.className = 'pm-msheet-scrim';
    scrim.dataset.pmV2ModelSheet = 'scrim';
    sheet = document.createElement('div');
    sheet.className = `pm-msheet ${kind}`;
    sheet.dataset.pmV2ModelSheet = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = `<div class="pm-msheet-handle"></div><div class="pm-msheet-head"><div class="pm-msheet-title">${title}</div><button type="button" class="pm-msheet-close" aria-label="Close">&times;</button></div><div class="pm-msheet-body">${bodyHtml}</div>`;
    const current = sheet;
    scrim.addEventListener('click', closeSheet);
    current.querySelector('.pm-msheet-close')?.addEventListener('click', closeSheet);
    current.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); }, true);
    sheetKeydown = (event) => {
      if (event.key === 'Escape' && sheet === current) {
        event.preventDefault();
        closeSheet();
      }
    };
    document.addEventListener('keydown', sheetKeydown, true);
    document.body.append(scrim, current);
    requestAnimationFrame(() => { scrim?.classList.add('open'); current.classList.add('open'); });
    return current.querySelector('.pm-msheet-body');
  };
  async function loadState(force = false) {
    if (!force && state) return state;
    const context = currentContext();
    const [providerBody, catalogBody, credentialBody, routeBody] = await Promise.all([
      context.client.request('/api/settings/provider').catch(() => null),
      context.client.request('/api/extensions/catalog?kind=provider').catch(() => null),
      context.client.request('/api/settings/credentialed-model-providers').catch(() => null),
      context.sessionId === 'mobile_default'
        ? Promise.resolve(null)
        : context.client.request(`/api/sessions/${encodeURIComponent(context.sessionId)}/model-route`).catch(() => null),
    ]);
    const llm = providerBody?.llm || { provider: 'ollama', providers: {} };
    const catalog = Array.isArray(catalogBody?.items) ? catalogBody.items : [];
    const configuredRoute = routeBody?.chatModelRoute || null;
    const draft = context.sessionId === 'mobile_default' ? readDraftRoute() : null;
    const effective = configuredRoute?.effective || configuredRoute?.override || draft || {};
    const provider = String(effective.providerId || effective.provider || llm.provider || 'ollama');
    const cfg = llm.providers?.[provider] || {};
    state = {
      context,
      llm,
      catalog,
      credentialed: Array.isArray(credentialBody?.providers) ? credentialBody.providers.map(String) : [],
      route: configuredRoute,
      provider,
      model: String(effective.model || cfg.model || ''),
      effort: String(effective.reasoningEffort || effective.reasoning_effort || cfg.reasoning_effort || ''),
      speed: String(effective.speed || cfg.speed || (cfg.fast_mode ? 'fast' : 'standard')).toLowerCase() === 'fast' ? 'fast' : 'standard',
      accountId: String(effective.accountId || effective.account_id || ''),
    };
    syncBadge();
    return state;
  }
  function routeValue() {
    return {
      providerId: state.provider,
      model: state.model,
      reasoningEffort: state.effort || undefined,
      speed: state.speed,
      accountId: state.accountId || undefined,
    };
  }
  async function persistRoute(context, value) {
    const result = await context.client.request(`/api/sessions/${encodeURIComponent(context.sessionId)}/model-route`, {
      method: 'PUT', body: JSON.stringify(value),
    });
    if (result?.success === false) throw new Error(result.error || 'Could not save this chat model.');
    if (result?.chatModelRoute && state) state.route = result.chatModelRoute;
    return result;
  }
  function saveRoute(patch, { debounce = false } = {}) {
    if (!state) return;
    Object.assign(state, patch);
    syncBadge();
    const value = routeValue();
    const context = currentContext();
    if (context.sessionId === 'mobile_default') {
      writeDraftRoute(value);
      return Promise.resolve(value);
    }
    clearTimeout(saveTimer);
    if (debounce) {
      saveTimer = window.setTimeout(() => {
        saveChain = saveChain.catch(() => {}).then(() => persistRoute(context, value)).catch(() => {});
      }, 160);
      return Promise.resolve(value);
    }
    saveChain = saveChain.catch(() => {}).then(() => persistRoute(context, value));
    return saveChain;
  }
  async function applyDraftToSession(client, id) {
    const draft = readDraftRoute();
    if (!draft?.providerId || !draft?.model || !client || !id) return null;
    const result = await client.request(`/api/sessions/${encodeURIComponent(id)}/model-route`, {
      method: 'PUT', body: JSON.stringify(draft),
    });
    try { localStorage.removeItem(DRAFT_ROUTE_KEY); } catch {}
    return result?.chatModelRoute || result;
  }
  function renderAdvanced() {
    if (!state || !sheet) return;
    const options = reasoningSelectorOptions(state.provider, state.model);
    const rows = [
      ['Provider', 'provider', esc(state.catalog.find((entry) => entry.id === state.provider)?.name || state.provider)],
      ['Model', 'model', esc(formatModelDisplayName(state.model, state.provider) || 'Choose a model')],
      ['Intelligence', 'intelligence', esc(options ? formatReasoningSelectorLabel(state.effort, state.provider, state.model) : 'Default')],
    ];
    if (supportsFastSpeed(state.provider, state.model)) rows.push(['Speed', 'speed', state.speed === 'fast' ? 'Fast' : 'Standard']);
    const body = sheet.querySelector('.pm-msheet-body');
    body.innerHTML = `<div class="pm-advanced-panel">${rows.map(([name, action, value]) => `<button type="button" class="pm-advanced-row" data-v2-model-action="${action}"><span class="pm-advanced-row-label">${name}</span><span class="pm-advanced-row-value">${value}</span><span class="pm-advanced-row-chev" aria-hidden="true">&rsaquo;</span></button>`).join('')}</div>`;
    body.querySelector('[data-v2-model-action="provider"]')?.addEventListener('click', renderProviders);
    body.querySelector('[data-v2-model-action="model"]')?.addEventListener('click', () => renderModels(state.provider));
    body.querySelector('[data-v2-model-action="intelligence"]')?.addEventListener('click', renderEfforts);
    body.querySelector('[data-v2-model-action="speed"]')?.addEventListener('click', renderSpeeds);
  }
  function renderProviders() {
    // Match V1: expose providers with saved credentials and keep the active
    // provider available even when its credential check is unavailable.
    const available = [...new Set([state.provider, ...state.credentialed].filter(Boolean))];
    const preferredOrder = ['ollama', 'llama_cpp', 'lm_studio', 'openai', 'openai_codex', 'anthropic', 'perplexity', 'gemini', 'xai'];
    available.sort((left, right) => {
      const a = preferredOrder.indexOf(left);
      const b = preferredOrder.indexOf(right);
      return (a < 0 ? preferredOrder.length : a) - (b < 0 ? preferredOrder.length : b) || left.localeCompare(right);
    });
    const body = sheet?.querySelector('.pm-msheet-body');
    if (!body) return;
    sheet.querySelector('.pm-msheet-title').innerHTML = '<button type="button" class="pm-msheet-back" data-v2-model-back>&lsaquo;</button> Provider';
    body.innerHTML = available.length ? `<div class="pm-msheet-rows">${available.map((provider) => `<button type="button" class="pm-msheet-row" data-provider="${esc(provider)}"><span class="pm-msheet-row-label">${esc(state.catalog.find((item) => item.id === provider)?.name || provider)}</span>${provider === state.provider ? '<span class="pm-msheet-dot" title="Current"></span>' : ''}<span class="pm-msheet-chev">&rsaquo;</span></button>`).join('')}</div>` : '<div class="pm-msheet-empty">No providers with saved credentials. Add an API key or connect a provider in Settings.</div>';
    sheet.querySelector('[data-v2-model-back]')?.addEventListener('click', renderAdvanced);
    body.querySelectorAll('[data-provider]').forEach((button) => button.addEventListener('click', () => renderModels(button.dataset.provider)));
  }
  function renderModels(provider) {
    const models = modelNames(provider, state.catalog, state.llm);
    const body = sheet?.querySelector('.pm-msheet-body');
    if (!body) return;
    sheet.querySelector('.pm-msheet-title').innerHTML = '<button type="button" class="pm-msheet-back" data-v2-model-back>&lsaquo;</button> Model';
    body.innerHTML = models.length ? `<div class="pm-msheet-rows pm-msheet-model-rows">${models.map((model) => `<button type="button" class="pm-msheet-row" data-model="${esc(model)}"><span class="pm-msheet-row-label">${esc(formatModelDisplayName(model, provider))}</span>${provider === state.provider && model === state.model ? '<span class="pm-msheet-check">&#10003;</span>' : ''}</button>`).join('')}</div>` : '<div class="pm-msheet-empty">No models were returned for this provider.</div>';
    sheet.querySelector('[data-v2-model-back]')?.addEventListener('click', renderAdvanced);
    body.querySelectorAll('[data-model]').forEach((button) => button.addEventListener('click', async () => {
      state.provider = provider;
      state.model = button.dataset.model;
      state.effort = '';
      await saveRoute({ provider, model: button.dataset.model, effort: '' });
      renderAdvanced();
    }));
  }
  function renderEfforts() {
    const options = reasoningSelectorOptions(state.provider, state.model) || [];
    const body = sheet?.querySelector('.pm-msheet-body');
    if (!body) return;
    sheet.querySelector('.pm-msheet-title').innerHTML = '<button type="button" class="pm-msheet-back" data-v2-model-back>&lsaquo;</button> Intelligence';
    body.innerHTML = options.length ? `<div class="pm-msheet-rows">${options.map((effort) => `<button type="button" class="pm-msheet-row" data-effort="${esc(effort)}"><span class="pm-msheet-row-label">${esc(formatReasoningSelectorLabel(effort, state.provider, state.model))}</span>${effort === state.effort ? '<span class="pm-msheet-check">&#10003;</span>' : ''}</button>`).join('')}</div>` : '<div class="pm-msheet-empty">No adjustable reasoning levels for this model.</div>';
    sheet.querySelector('[data-v2-model-back]')?.addEventListener('click', renderAdvanced);
    body.querySelectorAll('[data-effort]').forEach((button) => button.addEventListener('click', async () => {
      state.effort = button.dataset.effort;
      await saveRoute({ effort: state.effort });
      renderAdvanced();
    }));
  }
  function renderSpeeds() {
    const body = sheet?.querySelector('.pm-msheet-body');
    if (!body) return;
    sheet.querySelector('.pm-msheet-title').innerHTML = '<button type="button" class="pm-msheet-back" data-v2-model-back>&lsaquo;</button> Speed';
    body.innerHTML = `<div class="pm-msheet-rows">${['standard', 'fast'].map((speed) => `<button type="button" class="pm-msheet-row" data-speed="${speed}"><span class="pm-msheet-row-label">${speed === 'fast' ? 'Fast' : 'Standard'}</span>${speed === state.speed ? '<span class="pm-msheet-check">&#10003;</span>' : ''}</button>`).join('')}</div>`;
    sheet.querySelector('[data-v2-model-back]')?.addEventListener('click', renderAdvanced);
    body.querySelectorAll('[data-speed]').forEach((button) => button.addEventListener('click', async () => {
      state.speed = button.dataset.speed;
      await saveRoute({ speed: state.speed });
      renderAdvanced();
    }));
  }
  async function openAdvanced() {
    mobileV2Haptic(16);
    openSheet('is-model-switch', 'Advanced <span class="pm-msheet-chev">&rsaquo;</span>', '<div class="pm-msheet-loading">Loading model controls…</div>');
    try { await loadState(true); renderAdvanced(); }
    catch (error) { const body = sheet?.querySelector('.pm-msheet-body'); if (body) body.innerHTML = `<div class="pm-msheet-empty">${String(error?.message || 'Model controls are unavailable.')}</div>`; }
  }
  async function openReasoning() {
    mobileV2Haptic(10);
    openSheet('is-reasoning', '', '<div class="pm-msheet-loading">Loading reasoning…</div>');
    try {
      await loadState(true);
      if (!sheet || disposed) return;
      const body = sheet.querySelector('.pm-msheet-body');
      sheet.querySelector('.pm-msheet-head')?.remove();
      body.innerHTML = renderReasoningSelector({ provider: state.provider, model: state.model, effort: state.effort, selectorId: 'pm-v2-reasoning-selector', controlId: 'pm-v2-reasoning-control', liveLabelId: 'pm-v2-reasoning-live-label', advancedId: 'pm-v2-reasoning-advanced', includeAdvanced: true });
      body.querySelector('#pm-v2-reasoning-advanced')?.addEventListener('click', openAdvanced);
      wireReasoningSelector(body, { onChange: (effort) => { saveRoute({ effort }, { debounce: true }); } });
    } catch (error) {
      const body = sheet?.querySelector('.pm-msheet-body');
      if (body) body.innerHTML = `<div class="pm-msheet-empty">${String(error?.message || 'Reasoning controls are unavailable.')}</div>`;
    }
  }
  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    holdTriggered = false;
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      holdTriggered = true;
      openAdvanced();
    }, 500);
  };
  const onPointerEnd = () => { clearTimeout(holdTimer); holdTimer = null; };
  const onClick = (event) => {
    if (holdTriggered) {
      holdTriggered = false;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    openReasoning();
  };
  const onContextMenu = (event) => event.preventDefault();
  badge.setAttribute('aria-label', 'Current model — tap for reasoning, hold to switch model');
  badge.setAttribute('aria-live', 'polite');
  badge.addEventListener('pointerdown', onPointerDown);
  badge.addEventListener('pointerup', onPointerEnd);
  badge.addEventListener('pointercancel', onPointerEnd);
  badge.addEventListener('click', onClick);
  badge.addEventListener('contextmenu', onContextMenu);
  loadState().catch(() => {});
  return {
    dispose() {
      disposed = true;
      clearTimeout(holdTimer);
      clearTimeout(saveTimer);
      badge.removeEventListener('pointerdown', onPointerDown);
      badge.removeEventListener('pointerup', onPointerEnd);
      badge.removeEventListener('pointercancel', onPointerEnd);
      badge.removeEventListener('click', onClick);
      badge.removeEventListener('contextmenu', onContextMenu);
      closeSheet();
    },
    applyDraftToSession,
  };
}
