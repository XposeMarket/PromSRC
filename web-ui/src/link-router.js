import { wsSend, wsEventBus } from './ws.js';
import {
  choosePrometheusBrowserLane,
  classifyPrometheusLink,
  normalizePrometheusLink,
} from './link-routing-policy.mjs';

const TELEMETRY_LIMIT = 120;
const MENU_ID = 'prometheus-link-context-menu';
let installed = false;
let activeMenuAnchor = null;

function isElectronSurface() {
  return !!(window.prometheusExternalLinks || window.prometheusBrowserSurface || window.prometheusApp);
}

function currentBrowserTarget() {
  const state = window.browserCanvasState && typeof window.browserCanvasState === 'object'
    ? window.browserCanvasState
    : {};
  const record = state.sessionId && state.browserSessions && typeof state.browserSessions === 'object'
    ? state.browserSessions[state.sessionId]
    : null;
  return {
    browserTarget: String(record?.browserTarget || state.browserTarget || '').trim(),
    profileKind: String(record?.profileKind || state.profileKind || '').trim(),
  };
}

function recordLinkRouting(event = {}) {
  const entry = {
    timestamp: Date.now(),
    decision: String(event.decision || '').trim(),
    reason: String(event.reason || '').trim(),
    lane: String(event.lane || '').trim(),
    surface: isElectronSurface() ? 'electron' : 'desktop-web',
    scheme: String(event.scheme || '').trim(),
    host: String(event.host || '').trim(),
    target: String(event.target || '').trim(),
    modifier: event.modifier === true,
    success: event.success !== false,
    error: String(event.error || '').trim(),
  };
  const history = Array.isArray(window.__prometheusLinkRoutingTelemetry)
    ? window.__prometheusLinkRoutingTelemetry
    : [];
  history.push(entry);
  if (history.length > TELEMETRY_LIMIT) history.splice(0, history.length - TELEMETRY_LIMIT);
  window.__prometheusLinkRoutingTelemetry = history;
  try { window.dispatchEvent(new CustomEvent('prometheus:link-routing', { detail: entry })); } catch {}
  return entry;
}

export function getPrometheusLinkRoutingTelemetry() {
  return Array.isArray(window.__prometheusLinkRoutingTelemetry)
    ? window.__prometheusLinkRoutingTelemetry.map((entry) => ({ ...entry }))
    : [];
}

function showLinkError(message) {
  const text = String(message || 'The link could not be opened in the Prometheus Browser.').trim();
  try { window.showToast?.(text, 'error'); } catch {}
}

function getSessionId() {
  return String(window.activeChatSessionId || window.agentSessionId || window.browserCanvasState?.sessionId || 'default').trim() || 'default';
}

function getAnchor(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const anchor = target.closest('a[href]');
  if (!anchor || !document.documentElement.contains(anchor)) return null;
  return anchor;
}

function linkOptions(anchor) {
  return {
    rawUrl: anchor?.getAttribute?.('href') || '',
    baseUrl: document.baseURI || window.location.href,
    currentOrigin: window.location.origin,
    gatewayOrigin: 'http://127.0.0.1:18789',
    download: !!anchor?.hasAttribute?.('download'),
    allowExplicitSafeFlow: anchor?.hasAttribute?.('onclick') === true,
    explicitExternal: String(anchor?.dataset?.prometheusLinkMode || '').trim().toLowerCase() === 'external'
      || anchor?.dataset?.prometheusExternal === 'true',
  };
}

function classifyAnchor(anchor) {
  return classifyPrometheusLink(linkOptions(anchor));
}

function openNativeBrowserLink(url, sessionId) {
  const api = window.prometheusBrowserSurface;
  if (!api || typeof api.available !== 'function' || typeof api.attach !== 'function') return null;
  return Promise.resolve(api.available()).then((available) => {
    if (!available) return false;
    return api.attach({ sessionId, url, profile: 'main' }).then(() => true);
  });
}

async function sendBrowserLinkToGateway(url, sessionId, lane) {
  if (!(window.ws && window.ws.readyState === WebSocket.OPEN)) {
    try { window.ensureWSConnected?.({ timeoutMs: 2500 }); } catch {}
    recordLinkRouting({ decision: 'failed', reason: 'ws_unavailable', lane, success: false });
    showLinkError('Browser connection is reconnecting. Try again in a second.');
    return false;
  }
  wsSend({
    type: 'browser:link_open',
    sessionId,
    url,
    lane,
    source: 'desktop-link',
    timestamp: Date.now(),
  });
  return true;
}

export async function openPrometheusBrowserLink(rawUrl, options = {}) {
  const normalized = normalizePrometheusLink(rawUrl, {
    baseUrl: document.baseURI || window.location.href,
    currentOrigin: window.location.origin,
    gatewayOrigin: 'http://127.0.0.1:18789',
  });
  if (normalized.kind !== 'external') {
    recordLinkRouting({ decision: normalized.kind, reason: normalized.reason, scheme: normalized.scheme, success: false });
    if (normalized.kind === 'blocked') showLinkError('This URL cannot be opened by Prometheus.');
    return false;
  }

  const targetInfo = currentBrowserTarget();
  const lane = choosePrometheusBrowserLane({
    electron: isElectronSurface(),
    inhouseAvailable: !!window.prometheusBrowserSurface,
    ...targetInfo,
  });
  const sessionId = getSessionId();
  recordLinkRouting({
    decision: 'prometheus_browser',
    reason: String(options.reason || normalized.reason || 'external_http_url'),
    lane,
    scheme: normalized.scheme,
    host: normalized.host,
    target: options.target || '',
  });

  if (typeof window.openPrometheusBrowserLink === 'function' && window.openPrometheusBrowserLink !== openPrometheusBrowserLink) {
    try {
      const result = await window.openPrometheusBrowserLink(normalized.url, { lane, source: options.source || 'link' });
      if (result === false) throw new Error('Browser link handler declined the navigation.');
      return true;
    } catch (error) {
      recordLinkRouting({ decision: 'failed', reason: 'browser_handler_error', lane, scheme: normalized.scheme, host: normalized.host, success: false, error: error?.message || error });
      showLinkError(error?.message || error);
      return false;
    }
  }

  if (lane === 'inhouse') {
    try {
      const nativeResult = await openNativeBrowserLink(normalized.url, sessionId);
      if (nativeResult === true) return true;
    } catch (error) {
      recordLinkRouting({ decision: 'failed', reason: 'inhouse_attach_error', lane, scheme: normalized.scheme, host: normalized.host, success: false, error: error?.message || error });
      showLinkError(error?.message || error);
      return false;
    }
  }
  return sendBrowserLinkToGateway(normalized.url, sessionId, lane);
}

export async function openPrometheusExternalLink(rawUrl, options = {}) {
  const normalized = normalizePrometheusLink(rawUrl, {
    baseUrl: document.baseURI || window.location.href,
    currentOrigin: window.location.origin,
    gatewayOrigin: 'http://127.0.0.1:18789',
  });
  if (!['external', 'passthrough'].includes(normalized.kind)) {
    recordLinkRouting({ decision: 'external_blocked', reason: normalized.reason, scheme: normalized.scheme, success: false });
    if (normalized.kind === 'blocked') showLinkError('This URL cannot be opened externally.');
    return false;
  }
  const target = String(options.target || '_blank');
  const features = String(options.features || 'noopener,noreferrer');
  try {
    if (window.prometheusExternalLinks?.open && normalized.kind === 'external') {
      await window.prometheusExternalLinks.open(normalized.url);
    } else {
      const opened = window.open(normalized.url, target, features);
      if (!opened && normalized.kind === 'external') throw new Error('The browser blocked the external window.');
    }
    recordLinkRouting({ decision: 'external', reason: 'explicit_external', scheme: normalized.scheme, host: normalized.host, target });
    return true;
  } catch (error) {
    recordLinkRouting({ decision: 'external_failed', reason: 'external_open_error', scheme: normalized.scheme, host: normalized.host, target, success: false, error: error?.message || error });
    showLinkError(error?.message || error);
    return false;
  }
}

function removeMenu() {
  const menu = document.getElementById(MENU_ID);
  if (menu) menu.remove();
  activeMenuAnchor = null;
}

function positionMenu(menu, x, y) {
  const margin = 8;
  const width = 220;
  const height = 86;
  menu.style.left = `${Math.max(margin, Math.min(Number(x) || 0, window.innerWidth - width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(Number(y) || 0, window.innerHeight - height - margin))}px`;
}

function showLinkMenu(anchor, x, y) {
  removeMenu();
  activeMenuAnchor = anchor;
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Link actions');
  menu.tabIndex = -1;
  Object.assign(menu.style, {
    position: 'fixed',
    zIndex: '2147483647',
    minWidth: '220px',
    padding: '4px',
    border: '1px solid rgba(150, 180, 190, .28)',
    borderRadius: '8px',
    background: 'var(--panel, #14222a)',
    color: 'var(--text, #eaf5f7)',
    boxShadow: '0 12px 28px rgba(0,0,0,.35)',
    font: '12px/1.3 system-ui, sans-serif',
  });
  const actions = [
    ['Open in Prometheus Browser', () => openPrometheusBrowserLink(anchor.href, { reason: 'context_menu' })],
    ['Open externally', () => openPrometheusExternalLink(anchor.href, { target: anchor.target || '_blank' })],
  ];
  actions.forEach(([label, action]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    Object.assign(button.style, {
      display: 'block',
      width: '100%',
      border: '0',
      borderRadius: '5px',
      padding: '7px 9px',
      textAlign: 'left',
      color: 'inherit',
      background: 'transparent',
      cursor: 'pointer',
      font: 'inherit',
    });
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(120, 190, 205, .14)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
    button.addEventListener('click', () => { removeMenu(); Promise.resolve(action()).catch(() => {}); });
    menu.append(button);
  });
  document.body.append(menu);
  positionMenu(menu, x, y);
  menu.querySelector('button')?.focus?.();
}

function handleClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = getAnchor(event.target);
  if (!anchor) return;
  const decision = classifyAnchor(anchor);
  if (decision.kind === 'passthrough' || decision.kind === 'internal' || decision.kind === 'ignored') return;
  if (decision.kind === 'blocked') {
    event.preventDefault();
    recordLinkRouting({ decision: 'blocked', reason: decision.reason, scheme: decision.scheme, success: false });
    showLinkError('This URL cannot be opened by Prometheus.');
    return;
  }
  event.preventDefault();
  const promise = decision.reason === 'explicit_external'
    ? openPrometheusExternalLink(decision.url, { target: anchor.target || '_blank', source: 'anchor' })
    : openPrometheusBrowserLink(decision.url, { target: anchor.target || '', source: 'anchor' });
  Promise.resolve(promise).catch(() => {});
}

function handleContextMenu(event) {
  const anchor = getAnchor(event.target);
  if (!anchor) { removeMenu(); return; }
  const decision = classifyAnchor(anchor);
  if (decision.kind !== 'external') return;
  event.preventDefault();
  showLinkMenu(anchor, event.clientX, event.clientY);
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (document.getElementById(MENU_ID)) {
      event.preventDefault();
      removeMenu();
    }
    return;
  }
  const anchor = getAnchor(document.activeElement);
  if (!anchor) return;
  const decision = classifyAnchor(anchor);
  if (decision.kind !== 'external') return;
  if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    Promise.resolve(openPrometheusExternalLink(decision.url, { target: anchor.target || '_blank', source: 'keyboard' })).catch(() => {});
  } else if ((event.key === 'ContextMenu' || event.key === 'Apps' || (event.key === 'F10' && event.shiftKey)) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const rect = anchor.getBoundingClientRect();
    showLinkMenu(anchor, rect.left, rect.bottom);
  }
}

function handleDocumentPointerDown(event) {
  const menu = document.getElementById(MENU_ID);
  if (menu && !menu.contains(event.target)) removeMenu();
}

function handleElectronNavigation(payload) {
  const url = String(payload?.url || '').trim();
  if (!url) return;
  Promise.resolve(openPrometheusBrowserLink(url, { source: 'electron-main-window' })).catch(() => {});
}

export function installPrometheusLinkRouter() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('contextmenu', handleContextMenu, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  window.prometheusLinkRouting = {
    classify: (anchor) => classifyAnchor(anchor),
    openInBrowser: openPrometheusBrowserLink,
    openExternally: openPrometheusExternalLink,
    telemetry: getPrometheusLinkRoutingTelemetry,
  };
  window.openPrometheusBrowserLink = window.openPrometheusBrowserLink || openPrometheusBrowserLink;
  window.openPrometheusExternalLink = openPrometheusExternalLink;
  window.prometheusExternalLinks?.onPrometheusNavigation?.(handleElectronNavigation);
  wsEventBus.on('browser:input:error', (msg) => {
    if (!msg?.linkNavigation) return;
    recordLinkRouting({ decision: 'failed', reason: 'gateway_navigation_error', success: false, error: msg.error });
    showLinkError(msg.error || 'Browser navigation failed.');
  });
}

installPrometheusLinkRouter();
