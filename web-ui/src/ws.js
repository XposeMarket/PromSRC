/**
 * ws.js — F5 WebSocket Event Bus
 *
 * Replaces the 235-line if/else chain in the old connectWS().
 * Each page module registers its own handlers via wsEventBus.on().
 * connectWS() just connects, parses JSON, and dispatches.
 *
 * Usage:
 *   import { wsEventBus, connectWS } from './ws.js';
 *   wsEventBus.on('task_complete', (msg) => { ... });
 *   wsEventBus.on('team_*', (msg) => { ... });  // wildcard prefix
 *   connectWS();
 */

// ─── Event Bus ─────────────────────────────────────────────────

const _handlers = new Map();
const _prefixes = new Map();

export const wsEventBus = {
  on(type, fn) {
    if (type.endsWith('*')) {
      const prefix = type.slice(0, -1);
      if (!_prefixes.has(prefix)) _prefixes.set(prefix, new Set());
      _prefixes.get(prefix).add(fn);
    } else {
      if (!_handlers.has(type)) _handlers.set(type, new Set());
      _handlers.get(type).add(fn);
    }
  },

  off(type, fn) {
    if (type.endsWith('*')) {
      _prefixes.get(type.slice(0, -1))?.delete(fn);
    } else {
      _handlers.get(type)?.delete(fn);
    }
  },

  _dispatch(msg) {
    const type = msg.type;
    if (!type) return;

    const exact = _handlers.get(type);
    if (exact) exact.forEach(fn => { try { fn(msg); } catch (e) { console.error(`[WS] Error in '${type}' handler:`, e); } });

    for (const [prefix, fns] of _prefixes) {
      if (type.startsWith(prefix)) {
        fns.forEach(fn => { try { fn(msg); } catch (e) { console.error(`[WS] Error in '${prefix}*' handler:`, e); } });
      }
    }
  },
};

// ─── WebSocket Connection ──────────────────────────────────────

function buildWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = new URL(`${proto}://${location.host}/ws`);
  try {
    const token = localStorage.getItem('pm_device_token');
    if (token) url.searchParams.set('pt', token);
  } catch {}
  return url.toString();
}

// ─── Reconnect state (exponential backoff + online awareness) ──
const _WS_BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // ms, capped at 30s
let _wsBackoffIdx = 0;
let _wsReconnectTimer = null;
let _wsWaitingForOnline = false;
let _wsConnecting = false;

function _wsNextDelay() {
  const d = _WS_BACKOFF_DELAYS[Math.min(_wsBackoffIdx, _WS_BACKOFF_DELAYS.length - 1)];
  _wsBackoffIdx = Math.min(_wsBackoffIdx + 1, _WS_BACKOFF_DELAYS.length - 1);
  return d;
}

function _wsResetBackoff() {
  _wsBackoffIdx = 0;
}

function _wsScheduleReconnect() {
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  if (_wsWaitingForOnline) return; // already waiting for network

  // If the browser reports offline, wait for the 'online' event instead of
  // hammering the server with failed reconnects every few seconds.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _wsWaitingForOnline = true;
    wsEventBus._dispatch({ type: 'ws:waiting_for_network', timestamp: Date.now() });
    const onOnline = () => {
      window.removeEventListener('online', onOnline);
      _wsWaitingForOnline = false;
      _wsBackoffIdx = 0; // fresh start when network comes back
      connectWS();
    };
    window.addEventListener('online', onOnline);
    return;
  }

  const delay = _wsNextDelay();
  wsEventBus._dispatch({ type: 'ws:reconnecting', timestamp: Date.now(), delayMs: delay, attempt: _wsBackoffIdx });
  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    if (!_wsConnecting) connectWS();
  }, delay);
}

export function connectWS() {
  if (_wsConnecting) return; // prevent double-connect races
  _wsConnecting = true;
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }

  window.ws = new WebSocket(buildWsUrl());

  window.ws.onopen = () => {
    _wsConnecting = false;
    _wsResetBackoff();
    wsEventBus._dispatch({ type: 'ws:open', timestamp: Date.now() });
  };

  window.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      wsEventBus._dispatch(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  window.ws.onclose = (event) => {
    _wsConnecting = false;
    wsEventBus._dispatch({ type: 'ws:close', timestamp: Date.now(), code: event?.code, reason: event?.reason || '' });
    _wsScheduleReconnect();
  };

  window.ws.onerror = (event) => {
    _wsConnecting = false;
    wsEventBus._dispatch({ type: 'ws:error', timestamp: Date.now(), message: event?.message || 'WebSocket error' });
    // onclose fires after onerror for WebSockets — no need to close manually.
  };
}

function isMobileRoute() {
  return !!(location.hash && String(location.hash).startsWith('#mobile'));
}

async function prepareMobileReload() {
  if (!isMobileRoute()) return;
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    for (const reg of regs || []) {
      try { reg.waiting?.postMessage?.('pm-skip-waiting'); } catch {}
      try { await reg.update?.(); } catch {}
    }
  } catch {}
  try {
    const keys = await caches?.keys?.();
    await Promise.all((keys || []).filter((key) => String(key).startsWith('prometheus-')).map((key) => caches.delete(key)));
  } catch {}
}

wsEventBus.on('dev_reload_requested', (msg) => {
  const target = String(msg?.target || 'all').toLowerCase();
  const mobile = isMobileRoute();
  if (target && target !== 'all' && target !== 'web') {
    if (mobile && target !== 'mobile') return;
    if (!mobile && target !== 'desktop') return;
  }
  const id = String(msg?.timestamp || msg?.reason || Date.now());
  const key = `prom_dev_reload_${id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {}
  const delayMs = Number.isFinite(Number(msg?.delayMs)) ? Math.max(250, Number(msg.delayMs)) : 900;
  setTimeout(() => {
    prepareMobileReload().finally(() => {
      try { location.reload(); } catch {}
    });
  }, delayMs);
});

export function wsSend(msg) {
  if (window.ws && window.ws.readyState === WebSocket.OPEN) {
    window.ws.send(JSON.stringify(msg));
  }
}

// Expose on window
window.connectWS = connectWS;
window.wsEventBus = wsEventBus;
