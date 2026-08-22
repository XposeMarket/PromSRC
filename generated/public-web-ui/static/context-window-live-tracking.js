const PERF_EVENT = 'prometheus:client-performance-mark';
const SEMANTIC_LABEL = 'Context window';
const SEMANTIC_HELP = 'Effective context pressure · compaction starts before the hard limit';
const SETTLE_REFRESH_DELAYS_MS = [120, 900];
const MAINTENANCE_INTERVAL_MS = 500;
const PRESSURE_REFRESH_MS = 2000;

const liveBySession = new Map();
let maintenanceTimer = 0;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatTokens(value) {
  const number = numeric(value);
  if (number >= 1_000_000) {
    const millions = number / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)}m`;
  }
  if (number >= 1_000) {
    const thousands = number / 1_000;
    return `${thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return String(Math.round(number));
}

function parseTokens(value) {
  const text = String(value || '').trim().toLowerCase().replace(/,/g, '');
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/);
  if (!match) return 0;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === 'm') return base * 1_000_000;
  if (match[2] === 'k') return base * 1_000;
  return base;
}

function parseUsageLabel(value) {
  const text = String(value || '');
  const match = text.match(/~?\s*([0-9.,]+\s*[km]?)\s*\/\s*([0-9.,]+\s*[km]?)/i);
  if (!match) return null;
  const current = parseTokens(match[1]);
  const limit = parseTokens(match[2]);
  if (limit <= 0) return null;
  return { current, limit };
}

function estimateTextTokens(value) {
  const text = String(value || '');
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

function activeDesktopSessionId() {
  return String(window.activeChatSessionId || '').trim();
}

function activeMobileSessionId() {
  try {
    const route = String(window.location.hash || '');
    const encoded = route.match(/^#mobile\/chat\/([^/?#]+)/)?.[1] || '';
    if (encoded) return decodeURIComponent(encoded);
  } catch {}
  try {
    return String(localStorage.getItem('pm_mobile_last_chat_session') || '').trim();
  } catch {
    return '';
  }
}

function activeSessionIdForSurface(surface) {
  return surface === 'mobile' ? activeMobileSessionId() : activeDesktopSessionId();
}

function sessionForClientRequest(clientRequestId) {
  const requestId = String(clientRequestId || '').trim();
  if (!requestId) return '';
  const sessions = window._localMainChatClientRequestIds;
  if (!sessions || typeof sessions !== 'object') return '';
  for (const [sessionId, requests] of Object.entries(sessions)) {
    if (requests && typeof requests === 'object' && requests[requestId]) return String(sessionId || '').trim();
  }
  return '';
}

function surfaceElements(surface) {
  if (surface === 'mobile') {
    return {
      root: document.getElementById('pm-ctx-popover'),
      head: document.getElementById('pm-ctx-head-label'),
      total: document.getElementById('pm-ctx-total'),
      fill: document.getElementById('pm-ctx-fill'),
      ring: document.getElementById('pm-ctx-chip-ring'),
      button: document.getElementById('pm-ctx-chip'),
      metrics: document.getElementById('pm-ctx-metrics'),
    };
  }
  return {
    root: document.getElementById('chat-context-window-popover'),
    head: document.querySelector('#chat-context-window-popover .chat-context-window-head span:first-child'),
    total: document.getElementById('chat-context-window-total'),
    fill: document.getElementById('chat-context-window-fill'),
    ring: document.getElementById('chat-context-window-btn'),
    button: document.getElementById('chat-context-window-btn'),
    metrics: document.querySelector('#chat-context-window-popover .chat-context-window-metrics'),
  };
}

function replaceHeadText(head) {
  if (!head) return;
  const textNode = Array.from(head.childNodes || []).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) {
    if (textNode.nodeValue !== SEMANTIC_LABEL) textNode.nodeValue = SEMANTIC_LABEL;
    return;
  }
  if (!String(head.textContent || '').startsWith(SEMANTIC_LABEL)) head.prepend(document.createTextNode(SEMANTIC_LABEL));
}

function semanticCopyForState(state) {
  const trigger = numeric(state?.pressureTriggerTokens);
  const windowTokens = numeric(state?.windowTokens || state?.pressureWindowTokens);
  if (trigger > 0 && windowTokens > 0) {
    const percent = Math.round((trigger / windowTokens) * 100);
    return `Effective context pressure · compaction at ${formatTokens(trigger)} (${percent}%)`;
  }
  return SEMANTIC_HELP;
}

function ensureSemanticNote(surface, elements, state = null) {
  if (!elements.root) return;
  let note = elements.root.querySelector('[data-context-window-semantic-note]');
  if (!note) {
    note = document.createElement('div');
    note.dataset.contextWindowSemanticNote = 'true';
    note.className = 'context-window-semantic-note';
    note.innerHTML = '<span data-context-window-semantic-copy></span><span data-context-window-live-copy hidden></span>';
    if (elements.metrics?.parentNode === elements.root) elements.root.insertBefore(note, elements.metrics);
    else elements.root.appendChild(note);
  }
  const copy = note.querySelector('[data-context-window-semantic-copy]');
  const semanticCopy = semanticCopyForState(state);
  if (copy && copy.textContent !== semanticCopy) copy.textContent = semanticCopy;
  elements.root.setAttribute('aria-label', SEMANTIC_LABEL);
  elements.button?.setAttribute('aria-label', SEMANTIC_LABEL);
  if (surface === 'mobile' && !String(elements.button?.title || '')) elements.button?.setAttribute('title', SEMANTIC_LABEL);
}

function installSemanticStyles() {
  if (document.getElementById('context-window-live-tracking-style')) return;
  const style = document.createElement('style');
  style.id = 'context-window-live-tracking-style';
  style.textContent = `
    .context-window-semantic-note { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:5px 0 8px; color:var(--muted, rgba(255,255,255,.52)); font-size:11px; line-height:1.25; }
    .context-window-semantic-note [data-context-window-live-copy] { flex:0 0 auto; color:var(--pm-gold, var(--brand, currentColor)); font-variant-numeric:tabular-nums; white-space:nowrap; }
    body.pm-mobile-active .context-window-semantic-note { padding:4px 0 9px; font-size:10.5px; }
  `;
  document.head.appendChild(style);
}

function makeState(sessionId, surface, clientRequestId = '') {
  return {
    sessionId: String(sessionId || '').trim(),
    surface,
    clientRequestId: String(clientRequestId || '').trim(),
    active: false,
    baselineTokens: 0,
    authoritativeTokens: 0,
    windowTokens: 0,
    liveToolTokens: 0,
    pressureTokens: 0,
    pressureWindowTokens: 0,
    pressureTriggerTokens: 0,
    pressureFetchedAt: 0,
    pressurePromise: null,
    pendingCompaction: false,
    lastRenderedText: '',
    seenToolResults: new Set(),
  };
}

function stateKey(surface, sessionId) {
  return `${surface}:${String(sessionId || '').trim()}`;
}

function currentStateForSurface(surface) {
  const activeId = activeSessionIdForSurface(surface);
  return activeId ? liveBySession.get(stateKey(surface, activeId)) || null : null;
}

function ensureSurfaceState(surface) {
  const sessionId = activeSessionIdForSurface(surface);
  if (!sessionId) return null;
  const key = stateKey(surface, sessionId);
  let state = liveBySession.get(key);
  if (!state) {
    state = makeState(sessionId, surface);
    liveBySession.set(key, state);
  }
  return state;
}

function captureAuthoritative(state, elements = surfaceElements(state.surface)) {
  if (!elements.total) return;
  const text = String(elements.total.textContent || '').trim();
  if (!text || text === state.lastRenderedText) return;
  const usage = parseUsageLabel(text);
  if (!usage) return;
  state.authoritativeTokens = usage.current;
  state.windowTokens = usage.limit;
  if (state.baselineTokens <= 0) state.baselineTokens = usage.current;
}

async function fetchPressure(surface, sessionId) {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/context-pressure`;
  if (surface === 'mobile') {
    const mobileApi = await import('./mobile/mobile-api.js');
    return mobileApi.mobileGatewayFetch(path, { timeoutMs: 6000 });
  }
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Context pressure HTTP ${response.status}`);
  return response.json();
}

function refreshPressure(state, force = false) {
  if (!state?.sessionId) return Promise.resolve(null);
  if (state.pressurePromise) return state.pressurePromise;
  if (!force && state.pressureFetchedAt > 0 && Date.now() - state.pressureFetchedAt < PRESSURE_REFRESH_MS) {
    return Promise.resolve(null);
  }

  state.pressurePromise = fetchPressure(state.surface, state.sessionId)
    .then((data) => {
      if (!data || data.success === false) return null;
      state.pressureFetchedAt = Date.now();
      state.pressureTokens = numeric(data.pressureTokens);
      state.pressureWindowTokens = numeric(data.contextWindowTokens);
      state.pressureTriggerTokens = numeric(data.effectiveCompactionTriggerTokens || data.compactionTriggerTokens);
      state.pendingCompaction = data.pendingCompaction === true || data.atOrPastCompactionTrigger === true;
      if (state.pressureWindowTokens > 0 && state.windowTokens <= 0) state.windowTokens = state.pressureWindowTokens;
      renderLiveEstimate(state);
      return data;
    })
    .catch(() => null)
    .finally(() => { state.pressurePromise = null; });
  return state.pressurePromise;
}

function startLive(sessionId, surface, clientRequestId = '') {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const key = stateKey(surface, sid);
  const previous = liveBySession.get(key);
  let state = previous;
  if (!state || state.active || (clientRequestId && state.clientRequestId && state.clientRequestId !== clientRequestId)) {
    state = makeState(sid, surface, clientRequestId);
    if (previous) {
      state.pressureTokens = previous.pressureTokens;
      state.pressureWindowTokens = previous.pressureWindowTokens;
      state.pressureTriggerTokens = previous.pressureTriggerTokens;
      state.pressureFetchedAt = previous.pressureFetchedAt;
    }
    liveBySession.set(key, state);
  }
  state.active = true;
  if (clientRequestId) state.clientRequestId = clientRequestId;
  captureAuthoritative(state);
  void refreshPressure(state, true);
  return state;
}

function resultDedupeKey(details, tokens) {
  const toolCallId = String(details?.toolCallId || details?.tool_call_id || '').trim();
  if (toolCallId) return `${toolCallId}:${Math.round(tokens)}`;
  const telemetryId = String(details?.telemetryId || details?.telemetry_id || '').trim();
  if (telemetryId) return `${telemetryId}:${Math.round(tokens)}`;
  return '';
}

function recordToolTokens(sessionId, surface, details = {}, explicitTokens = 0) {
  const state = startLive(sessionId, surface, details?.clientRequestId || '');
  if (!state) return;
  const tokens = numeric(explicitTokens || details?.resultTokens || details?.result_tokens)
    || estimateTextTokens(details?.result || details?.output || details?.error || '');
  if (tokens <= 0) return;
  const dedupe = resultDedupeKey(details, tokens);
  if (dedupe && state.seenToolResults.has(dedupe)) return;
  if (dedupe) state.seenToolResults.add(dedupe);
  state.liveToolTokens += tokens;
  renderLiveEstimate(state);
}

function recordCompactionEvent(sessionId, surface, evt = {}) {
  const sid = String(sessionId || activeSessionIdForSurface(surface) || '').trim();
  if (!sid) return;
  const state = ensureSurfaceState(surface) || startLive(sid, surface);
  if (!state || state.sessionId !== sid) return;
  const action = String(evt?.action || evt?.tool || evt?.name || '').trim();
  if (action !== 'context_compaction') return;
  const phase = String(evt?.args?.phase || evt?.extra?.phase || '').trim();
  const before = numeric(evt?.args?.projected_tokens || evt?.extra?.projected_tokens || evt?.extra?.projected_tokens_before);
  const after = numeric(evt?.extra?.projected_tokens_after);
  const trigger = numeric(evt?.args?.trigger_tokens || evt?.extra?.trigger_tokens || evt?.extra?.input_budget_tokens);
  if (before > 0) state.pressureTokens = Math.max(state.pressureTokens, before);
  if (after > 0) state.pressureTokens = after;
  if (trigger > 0) state.pressureTriggerTokens = trigger;
  state.pendingCompaction = phase === 'start' || (!after && evt?.type === 'tool_call');
  renderLiveEstimate(state);
  if (evt?.type === 'tool_result') void refreshPressure(state, true);
}

function stateIsVisible(state) {
  if (state.surface === 'mobile') return activeMobileSessionId() === state.sessionId && !!document.getElementById('pm-ctx-popover');
  return activeDesktopSessionId() === state.sessionId;
}

function renderLiveEstimate(state) {
  if (!state || !stateIsVisible(state)) return;
  const elements = surfaceElements(state.surface);
  if (!elements.root || !elements.total) return;
  captureAuthoritative(state, elements);

  const windowTokens = numeric(state.windowTokens || state.pressureWindowTokens);
  if (windowTokens <= 0) return;
  const liveProjection = state.active && state.baselineTokens > 0
    ? state.baselineTokens + state.liveToolTokens
    : 0;
  const authoritativePressure = Math.max(state.authoritativeTokens, state.pressureTokens);
  const estimatedTokens = Math.max(authoritativePressure, liveProjection);
  if (estimatedTokens <= 0) return;

  const unreflectedTokens = Math.max(0, liveProjection - authoritativePressure);
  const percent = Math.max(0, Math.min(100, (estimatedTokens / windowTokens) * 100));
  const isLiveEstimate = unreflectedTokens > 0;
  const label = `${isLiveEstimate ? '~' : ''}${formatTokens(estimatedTokens)} / ${formatTokens(windowTokens)} (${Math.round((estimatedTokens / windowTokens) * 100)}%)`;
  state.lastRenderedText = label;
  elements.total.textContent = label;
  if (elements.fill) elements.fill.style.width = `${percent.toFixed(1)}%`;
  if (state.surface === 'mobile') elements.ring?.style.setProperty('--pm-ctx-deg', `${Math.round(percent * 3.6)}deg`);
  else elements.ring?.style.setProperty('--chat-context-window-deg', `${Math.round(percent * 3.6)}deg`);

  const titleParts = [`Context window: ${formatTokens(estimatedTokens)} / ${formatTokens(windowTokens)} tokens`];
  if (state.authoritativeTokens > 0 && state.pressureTokens > state.authoritativeTokens) {
    titleParts.push(`current model slice ${formatTokens(state.authoritativeTokens)}`);
  }
  if (state.pressureTriggerTokens > 0) titleParts.push(`compaction at ${formatTokens(state.pressureTriggerTokens)}`);
  if (isLiveEstimate) titleParts.push('live estimate');
  if (elements.button) elements.button.title = titleParts.join(' · ');

  ensureSemanticNote(state.surface, elements, state);
  const liveCopy = elements.root.querySelector('[data-context-window-live-copy]');
  if (liveCopy) {
    if (isLiveEstimate) {
      liveCopy.hidden = false;
      liveCopy.textContent = `+${formatTokens(unreflectedTokens)} live est`;
    } else if (state.pressureTokens > state.authoritativeTokens && state.authoritativeTokens > 0) {
      liveCopy.hidden = false;
      liveCopy.textContent = `model slice ${formatTokens(state.authoritativeTokens)}`;
    } else if (state.pendingCompaction) {
      liveCopy.hidden = false;
      liveCopy.textContent = 'compacting';
    } else {
      liveCopy.hidden = true;
      liveCopy.textContent = '';
    }
  }
}

function semanticPass() {
  installSemanticStyles();
  for (const surface of ['desktop', 'mobile']) {
    const elements = surfaceElements(surface);
    if (!elements.root) continue;
    const state = ensureSurfaceState(surface);
    replaceHeadText(elements.head);
    ensureSemanticNote(surface, elements, state);
    if (state) {
      captureAuthoritative(state, elements);
      void refreshPressure(state);
      renderLiveEstimate(state);
    }
  }
}

function requestAuthoritativeRefresh(state) {
  for (const delay of SETTLE_REFRESH_DELAYS_MS) {
    setTimeout(() => {
      if (state.surface === 'mobile') {
        try { window.__pmMobileRefreshContextWindow?.({ sessionId: state.sessionId }); } catch {}
      } else {
        try { window.refreshChatContextWindow?.({ force: true }); } catch {}
      }
      void refreshPressure(state, true);
      semanticPass();
    }, delay);
  }
}

function settleLive(sessionId, surface, clientRequestId = '') {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  const state = liveBySession.get(stateKey(surface, sid));
  if (!state) return;
  if (clientRequestId && state.clientRequestId && clientRequestId !== state.clientRequestId) return;
  state.active = false;
  state.clientRequestId = '';
  state.liveToolTokens = 0;
  state.baselineTokens = 0;
  state.seenToolResults.clear();
  requestAuthoritativeRefresh(state);
}

function onPerformanceMark(event) {
  const mark = event?.detail || {};
  const name = String(mark.name || '');
  const clientRequestId = String(mark.clientRequestId || '').trim();
  if (!clientRequestId) return;
  const sessionId = sessionForClientRequest(clientRequestId);
  if (!sessionId) return;
  if (name === 'chat_request_accepted') return void startLive(sessionId, 'desktop', clientRequestId);
  if (name === 'chat_tool_result_received') return void recordToolTokens(sessionId, 'desktop', mark, mark.resultTokens);
  if (name === 'chat_done' || name === 'chat_error') settleLive(sessionId, 'desktop', clientRequestId);
}

function wrapMobileHook(name, after) {
  const current = window[name];
  if (typeof current !== 'function' || current.__promContextLiveWrapped === true) return;
  const wrapped = function (...args) {
    const result = current.apply(this, args);
    try { after(...args); } catch {}
    return result;
  };
  Object.defineProperty(wrapped, '__promContextLiveWrapped', { value: true });
  window[name] = wrapped;
}

function installMobileHookWrappers() {
  wrapMobileHook('__pmMobileContextTurnStart', (detail = {}) => startLive(String(detail?.sessionId || activeMobileSessionId()).trim(), 'mobile'));
  wrapMobileHook('__pmMobileContextStreamEvent', (evt = {}, detail = {}) => {
    const sessionId = String(detail?.sessionId || evt?.sessionId || activeMobileSessionId()).trim();
    recordCompactionEvent(sessionId, 'mobile', evt);
    if (String(evt?.type || '') !== 'tool_result') return;
    const telemetry = evt?.extra?.telemetry || evt?.telemetry || {};
    recordToolTokens(sessionId, 'mobile', { ...evt, ...telemetry }, telemetry.resultTokens || telemetry.result_tokens);
  });
  wrapMobileHook('__pmMobileContextTurnDone', (detail = {}) => settleLive(String(detail?.sessionId || activeMobileSessionId()).trim(), 'mobile'));
}

function maintenancePass() {
  installMobileHookWrappers();
  semanticPass();
}

export function installContextWindowLiveTracking() {
  if (window.__promContextWindowLiveTrackingInstalled) return;
  window.__promContextWindowLiveTrackingInstalled = true;
  window.addEventListener(PERF_EVENT, onPerformanceMark);
  window.addEventListener('hashchange', () => setTimeout(maintenancePass, 0));
  maintenancePass();
  maintenanceTimer = window.setInterval(maintenancePass, MAINTENANCE_INTERVAL_MS);
  window.addEventListener('pagehide', () => {
    if (maintenanceTimer) {
      clearInterval(maintenanceTimer);
      maintenanceTimer = 0;
    }
  }, { once: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') installContextWindowLiveTracking();
