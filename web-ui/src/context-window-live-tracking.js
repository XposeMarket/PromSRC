const PERF_EVENT = 'prometheus:client-performance-mark';
const SEMANTIC_LABEL = 'Active context';
const SEMANTIC_HELP = 'Next model call · stored thread tracked separately';
const SETTLE_REFRESH_DELAYS_MS = [120, 900];

const liveBySession = new Map();
let semanticObserver = null;
let semanticFrame = 0;

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

function ensureSemanticNote(surface, elements) {
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
  if (copy && copy.textContent !== SEMANTIC_HELP) copy.textContent = SEMANTIC_HELP;
  elements.root.setAttribute('aria-label', 'Active context');
  elements.button?.setAttribute('aria-label', 'Active context');
  if (surface === 'mobile') elements.button?.setAttribute('title', 'Active context');
}

function installSemanticStyles() {
  if (document.getElementById('context-window-live-tracking-style')) return;
  const style = document.createElement('style');
  style.id = 'context-window-live-tracking-style';
  style.textContent = `
    .context-window-semantic-note {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 5px 0 8px;
      color: var(--muted, rgba(255,255,255,.52));
      font-size: 11px;
      line-height: 1.25;
    }
    .context-window-semantic-note [data-context-window-live-copy] {
      flex: 0 0 auto;
      color: var(--pm-gold, var(--brand, currentColor));
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    body.pm-mobile-active .context-window-semantic-note {
      padding: 4px 0 9px;
      font-size: 10.5px;
    }
  `;
  document.head.appendChild(style);
}

function semanticPass() {
  installSemanticStyles();
  for (const surface of ['desktop', 'mobile']) {
    const elements = surfaceElements(surface);
    if (!elements.root) continue;
    replaceHeadText(elements.head);
    ensureSemanticNote(surface, elements);
    const state = currentStateForSurface(surface);
    if (state?.active) renderLiveEstimate(state);
  }
}

function scheduleSemanticPass() {
  if (semanticFrame) return;
  semanticFrame = requestAnimationFrame(() => {
    semanticFrame = 0;
    semanticPass();
  });
}

function installSemanticObserver() {
  if (semanticObserver || !document.documentElement) return;
  semanticObserver = new MutationObserver(() => scheduleSemanticPass());
  semanticObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleSemanticPass();
}

function makeState(sessionId, surface, clientRequestId = '') {
  return {
    sessionId: String(sessionId || '').trim(),
    surface,
    clientRequestId: String(clientRequestId || '').trim(),
    active: true,
    baselineTokens: 0,
    authoritativeTokens: 0,
    windowTokens: 0,
    liveToolTokens: 0,
    lastRenderedText: '',
    seenToolResults: new Set(),
  };
}

function stateKey(surface, sessionId) {
  return `${surface}:${String(sessionId || '').trim()}`;
}

function currentStateForSurface(surface) {
  const activeId = surface === 'mobile' ? activeMobileSessionId() : activeDesktopSessionId();
  if (activeId) return liveBySession.get(stateKey(surface, activeId)) || null;
  for (const state of liveBySession.values()) if (state.surface === surface && state.active) return state;
  return null;
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

function startLive(sessionId, surface, clientRequestId = '') {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const key = stateKey(surface, sid);
  let state = liveBySession.get(key);
  if (!state || !state.active || (clientRequestId && state.clientRequestId && state.clientRequestId !== clientRequestId)) {
    state = makeState(sid, surface, clientRequestId);
    liveBySession.set(key, state);
  } else if (clientRequestId) {
    state.clientRequestId = clientRequestId;
  }
  captureAuthoritative(state);
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

function renderLiveEstimate(state) {
  if (!state?.active) return;
  const activeId = state.surface === 'mobile' ? activeMobileSessionId() : activeDesktopSessionId();
  if (activeId && activeId !== state.sessionId) return;
  const elements = surfaceElements(state.surface);
  if (!elements.root || !elements.total) return;
  captureAuthoritative(state, elements);
  if (state.baselineTokens <= 0 || state.windowTokens <= 0) return;

  const estimatedTokens = Math.max(
    state.authoritativeTokens,
    state.baselineTokens + state.liveToolTokens,
  );
  const unreflectedTokens = Math.max(0, estimatedTokens - state.authoritativeTokens);
  if (unreflectedTokens <= 0) return;
  const percent = Math.max(0, Math.min(100, (estimatedTokens / state.windowTokens) * 100));
  const label = `~${formatTokens(estimatedTokens)} / ${formatTokens(state.windowTokens)} (${Math.round(percent)}%)`;
  state.lastRenderedText = label;
  elements.total.textContent = label;
  if (elements.fill) elements.fill.style.width = `${percent.toFixed(1)}%`;
  if (state.surface === 'mobile') {
    elements.ring?.style.setProperty('--pm-ctx-deg', `${Math.round(percent * 3.6)}deg`);
  } else {
    elements.ring?.style.setProperty('--chat-context-window-deg', `${Math.round(percent * 3.6)}deg`);
  }
  if (elements.button) elements.button.title = `Active context: ${formatTokens(estimatedTokens)} / ${formatTokens(state.windowTokens)} tokens — live estimate`;
  ensureSemanticNote(state.surface, elements);
  const liveCopy = elements.root.querySelector('[data-context-window-live-copy]');
  if (liveCopy) {
    liveCopy.hidden = false;
    liveCopy.textContent = `+${formatTokens(unreflectedTokens)} live est`;
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
      scheduleSemanticPass();
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
  const elements = surfaceElements(surface);
  const liveCopy = elements.root?.querySelector('[data-context-window-live-copy]');
  if (liveCopy) {
    liveCopy.hidden = true;
    liveCopy.textContent = '';
  }
  requestAuthoritativeRefresh(state);
  setTimeout(() => liveBySession.delete(stateKey(surface, sid)), 8000);
}

function onPerformanceMark(event) {
  const mark = event?.detail || {};
  const name = String(mark.name || '');
  const clientRequestId = String(mark.clientRequestId || '').trim();
  if (!clientRequestId) return;
  const sessionId = sessionForClientRequest(clientRequestId);
  if (!sessionId) return;
  if (name === 'chat_request_accepted') {
    startLive(sessionId, 'desktop', clientRequestId);
    return;
  }
  if (name === 'chat_tool_result_received') {
    recordToolTokens(sessionId, 'desktop', mark, mark.resultTokens);
    return;
  }
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
  wrapMobileHook('__pmMobileContextTurnStart', (detail = {}) => {
    const sessionId = String(detail?.sessionId || activeMobileSessionId()).trim();
    startLive(sessionId, 'mobile');
  });
  wrapMobileHook('__pmMobileContextStreamEvent', (evt = {}, detail = {}) => {
    if (String(evt?.type || '') !== 'tool_result') return;
    const sessionId = String(detail?.sessionId || evt?.sessionId || activeMobileSessionId()).trim();
    const telemetry = evt?.extra?.telemetry || evt?.telemetry || {};
    recordToolTokens(sessionId, 'mobile', { ...evt, ...telemetry }, telemetry.resultTokens || telemetry.result_tokens);
  });
  wrapMobileHook('__pmMobileContextTurnDone', (detail = {}) => {
    const sessionId = String(detail?.sessionId || activeMobileSessionId()).trim();
    settleLive(sessionId, 'mobile');
  });
}

function installMobileWrapperObserver() {
  const install = () => {
    installMobileHookWrappers();
    scheduleSemanticPass();
  };
  install();
  window.addEventListener('hashchange', () => setTimeout(install, 0));
  const root = document.getElementById('mobile-root') || document.documentElement;
  const observer = new MutationObserver(() => {
    if (semanticFrame) return;
    semanticFrame = requestAnimationFrame(() => {
      semanticFrame = 0;
      install();
    });
  });
  observer.observe(root, { childList: true, subtree: true });
}

export function installContextWindowLiveTracking() {
  if (window.__promContextWindowLiveTrackingInstalled) return;
  window.__promContextWindowLiveTrackingInstalled = true;
  window.addEventListener(PERF_EVENT, onPerformanceMark);
  installSemanticObserver();
  installMobileWrapperObserver();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') installContextWindowLiveTracking();
