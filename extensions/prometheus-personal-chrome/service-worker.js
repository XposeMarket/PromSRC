// MV3 service worker. Mutual HMAC authentication prevents a process that only
// owns localhost:9234 from learning the pairing secret or issuing debugger work.
const RELAY = 'ws://127.0.0.1:9234/prometheus-user-chrome';
const PROTOCOL = 'prometheus-personal-chrome/v1';
const attached = new Set();
let ws = null, reconnectTimer = null, auth = null;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const utf8 = value => new TextEncoder().encode(value);
async function hmac(secret, domain, ...parts) { const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64url(await crypto.subtle.sign('HMAC', key, utf8([PROTOCOL, domain, ...parts].join('\0')))); }
function same(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let v = 0; for (let i = 0; i < a.length; i++) v |= a.charCodeAt(i) ^ b.charCodeAt(i); return v === 0; }
function stableJson(value) { return JSON.stringify(value ?? {}); }
function send(value) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }
async function signed(kind, id, payload) { const { pairingSecret } = await chrome.storage.local.get('pairingSecret'); if (!auth || !pairingSecret) return null; return { kind, id, [kind === 'event' ? 'eventPayload' : 'payload']: payload, mac: await hmac(pairingSecret, kind, auth.clientNonce, auth.serverNonce, id, stableJson(payload)) }; }
async function result(id, ok, result, error) { const packet = await signed('result', id, { ok: !!ok, result, error: error ? String(error.message || error) : '' }); if (packet) send({ kind: 'result', id, ok, result, error: error ? String(error.message || error) : undefined, mac: packet.mac }); }
async function emit(eventPayload) { const id = crypto.randomUUID(); const packet = await signed('event', id, eventPayload); if (packet) send({ kind: 'event', id, eventPayload, mac: packet.mac }); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function attach(tabId) { if (attached.has(tabId)) return; await chrome.debugger.attach({ tabId }, '1.3'); attached.add(tabId); }
async function cdp(tabId, method, params = {}) { await attach(tabId); return chrome.debugger.sendCommand({ tabId }, method, params); }
async function resolveTabId(params) { if (Number.isInteger(params.tabId)) return params.tabId; const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (!tabs[0]?.id) throw new Error('No active Chrome tab is available.'); return tabs[0].id; }
async function handle(method, params) {
  switch (method) {
    case 'tabs.list': return (await chrome.tabs.query({})).map(t => ({ id: t.id, windowId: t.windowId, active: t.active, title: t.title || '', url: t.url || '', incognito: !!t.incognito, width: t.width, height: t.height }));
    case 'tabs.create': { const tab = await chrome.tabs.create({ url: params.url || 'about:blank', active: params.active !== false, windowId: params.windowId }); return { id: tab.id, windowId: tab.windowId, title: tab.title || '', url: tab.url || '', width: tab.width, height: tab.height }; }
    case 'tabs.activate': { await chrome.tabs.update(params.tabId, { active: true }); if (params.windowId) await chrome.windows.update(params.windowId, { focused: true }); return true; }
    case 'tabs.remove': { if (attached.has(params.tabId)) { try { await chrome.debugger.detach({ tabId: params.tabId }); } catch {} attached.delete(params.tabId); } await chrome.tabs.remove(params.tabId); return true; }
    case 'tabs.navigate': { const tabId = await resolveTabId(params); await chrome.tabs.update(tabId, { url: params.url, active: params.active !== false }); return true; }
    case 'tabs.get': { const tab = await chrome.tabs.get(await resolveTabId(params)); return { id: tab.id, windowId: tab.windowId, active: tab.active, title: tab.title || '', url: tab.url || '', incognito: !!tab.incognito, width: tab.width, height: tab.height }; }
    case 'cdp': { const tabId = await resolveTabId(params); return cdp(tabId, params.method, params.params || {}); }
    case 'downloads.search': return chrome.downloads.search(params.query || {});
    default: throw new Error(`Unsupported Personal Chrome relay method: ${method}`);
  }
}
async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { pairingSecret } = await chrome.storage.local.get('pairingSecret'); if (!pairingSecret) return;
  try {
    ws = new WebSocket(RELAY); auth = null;
    ws.onopen = () => { const clientNonce = b64url(crypto.getRandomValues(new Uint8Array(32))); auth = { clientNonce, serverNonce: '' }; send({ kind: 'client_hello', clientNonce, extensionVersion: chrome.runtime.getManifest().version }); };
    ws.onmessage = async event => {
      let msg; try { msg = JSON.parse(event.data); } catch { ws.close(4002, 'invalid JSON'); return; }
      if (!auth) return;
      if (msg.kind === 'server_challenge') {
        if (!msg.serverNonce || !same(msg.proof, await hmac(pairingSecret, 'server-proof', auth.clientNonce, msg.serverNonce))) { ws.close(4003, 'server proof failed'); return; }
        auth.serverNonce = msg.serverNonce; send({ kind: 'client_proof', proof: await hmac(pairingSecret, 'client-proof', auth.clientNonce, auth.serverNonce) }); return;
      }
      if (msg.kind === 'authenticated') { if (!auth.serverNonce || !same(msg.proof, await hmac(pairingSecret, 'server-final', auth.clientNonce, auth.serverNonce))) { ws.close(4004, 'server final proof failed'); return; } auth.authenticated = true; return; }
      if (!auth.authenticated || msg.kind !== 'command' || !msg.id || !msg.method) return;
      if (!same(msg.mac, await hmac(pairingSecret, 'command', auth.clientNonce, auth.serverNonce, msg.id, stableJson({ method: msg.method, params: msg.params || {} })))) { ws.close(4005, 'command MAC failed'); return; }
      try { await result(msg.id, true, await handle(msg.method, msg.params || {})); } catch (err) { await result(msg.id, false, null, err); }
    };
    ws.onclose = () => { auth = null; scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  } catch { scheduleReconnect(); }
}
function scheduleReconnect() { if (reconnectTimer) return; reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 2000); }
chrome.alarms.create('prometheus-relay-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => connect()); chrome.runtime.onStartup.addListener(() => connect()); chrome.runtime.onInstalled.addListener(() => connect());
chrome.runtime.onMessage.addListener(message => { if (message?.kind === 'reconnect') { try { ws?.close(); } catch {} connect(); } });
chrome.debugger.onDetach.addListener((source, reason) => { if (source.tabId) attached.delete(source.tabId); emit({ event: 'debugger_detach', tabId: source.tabId, reason }); });
chrome.debugger.onEvent.addListener((source, method, params) => { if (source.tabId && attached.has(source.tabId) && ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Network.responseReceived'].includes(method)) emit({ event: 'cdp', tabId: source.tabId, method, params }); });
chrome.tabs.onRemoved.addListener(tabId => { attached.delete(tabId); emit({ event: 'tab_removed', tabId }); });
connect();
