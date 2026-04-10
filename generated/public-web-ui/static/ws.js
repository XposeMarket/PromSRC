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

export function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  window.ws = new WebSocket(`${proto}://${location.host}/ws`);

  window.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      wsEventBus._dispatch(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  window.ws.onclose = () => setTimeout(connectWS, 2000);
  window.ws.onerror = () => window.ws.close();
}

export function wsSend(msg) {
  if (window.ws && window.ws.readyState === WebSocket.OPEN) {
    window.ws.send(JSON.stringify(msg));
  }
}

// Expose on window
window.connectWS = connectWS;
window.wsEventBus = wsEventBus;
