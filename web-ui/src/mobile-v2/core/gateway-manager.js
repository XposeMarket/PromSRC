import { GatewayClient } from './gateway-client.js';

const CATALOG_KEY = 'pm_mobile_gateway_catalog_v1';
const ACTIVE_KEY = 'pm_mobile_active_gateway_v1';
const SESSION_TARGETS_KEY = 'pm_mobile_session_targets_v1';
const CURRENT_TOKEN_KEY = 'pm_device_token';
const TOKEN_PREFIX = 'pm_mobile_gateway_token_v1:';
const DEVICE_PREFIX = 'pm_mobile_gateway_device_v1:';

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch { return ''; }
}

function normalizeEntry(entry = {}, index = 0) {
  const origin = normalizeOrigin(entry.origin || entry.url || entry.gatewayOrigin || window.location.origin);
  const id = String(entry.gatewayId || entry.id || (origin === window.location.origin ? 'current' : `gateway-${index + 1}`));
  return {
    id,
    gatewayId: id,
    name: String(entry.name || entry.label || entry.gatewayName || (origin === window.location.origin ? 'This gateway' : 'Prometheus gateway')),
    origin,
    platform: String(entry.platform || ''),
    version: String(entry.version || entry.gatewayVersion || ''),
    workspaceLabel: String(entry.workspaceLabel || entry.workspace?.label || ''),
    protocolVersion: String(entry.protocolVersion || ''),
    capabilities: entry.capabilities && typeof entry.capabilities === 'object' ? entry.capabilities : {},
    execution: entry.execution && typeof entry.execution === 'object' ? entry.execution : { enabled: true },
    status: String(entry.status || 'unknown'),
    lastSeenAt: Number(entry.lastSeenAt || entry.updatedAt || 0),
  };
}

export class GatewayManager extends EventTarget {
  constructor() {
    super();
    this.entries = new Map();
    this.sessionTargets = readJson(SESSION_TARGETS_KEY, {});
    this._load();
  }

  _load() {
    const raw = readJson(CATALOG_KEY, []);
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.gateways) ? raw.gateways : [];
    rows.map(normalizeEntry).filter((row) => row.id && row.origin).forEach((row) => this.entries.set(row.id, row));
    const currentOrigin = normalizeOrigin(window.location.origin);
    let current = [...this.entries.values()].find((row) => row.origin === currentOrigin);
    if (!current) {
      current = normalizeEntry({ id: 'current', name: 'This gateway', origin: currentOrigin, execution: { enabled: true } });
      this.entries.set(current.id, current);
    }
    const savedActive = String(localStorage.getItem(ACTIVE_KEY) || '');
    this.activeId = this.entries.has(savedActive) ? savedActive : current.id;
    this._saveCatalog();
  }

  _saveCatalog() {
    writeJson(CATALOG_KEY, [...this.entries.values()]);
    try { localStorage.setItem(ACTIVE_KEY, this.activeId || 'current'); } catch {}
  }

  _tokenFor(id) {
    try {
      const scoped = localStorage.getItem(`${TOKEN_PREFIX}${id}`) || '';
      if (scoped) return scoped;
      const entry = this.entries.get(id);
      if (entry?.origin === normalizeOrigin(window.location.origin)) return localStorage.getItem(CURRENT_TOKEN_KEY) || '';
    } catch {}
    return '';
  }

  list() { return [...this.entries.values()]; }
  get(id) { return this.entries.get(String(id || '')) || null; }
  get activeEntry() { return this.get(this.activeId) || this.list()[0] || null; }
  get active() { return this.client(this.activeId); }

  client(id = this.activeId) {
    const entry = this.get(id);
    if (!entry) throw new Error('Gateway is not available on this phone.');
    return new GatewayClient({
      id: entry.id,
      name: entry.name,
      origin: entry.origin,
      tokenProvider: () => this._tokenFor(entry.id),
    });
  }

  select(id) {
    const key = String(id || '');
    if (!this.entries.has(key)) throw new Error('Unknown gateway.');
    this.activeId = key;
    this._saveCatalog();
    this.dispatchEvent(new CustomEvent('change', { detail: { activeId: key } }));
    return this.activeEntry;
  }

  upsert(entry, { token = '', deviceId = '' } = {}) {
    const normalized = normalizeEntry(entry, this.entries.size);
    if (!normalized.id || !normalized.origin) throw new Error('Gateway identity and origin are required.');
    this.entries.set(normalized.id, { ...(this.entries.get(normalized.id) || {}), ...normalized });
    try {
      if (token) localStorage.setItem(`${TOKEN_PREFIX}${normalized.id}`, token);
      if (deviceId) localStorage.setItem(`${DEVICE_PREFIX}${normalized.id}`, deviceId);
      if (normalized.origin === normalizeOrigin(window.location.origin) && token) localStorage.setItem(CURRENT_TOKEN_KEY, token);
    } catch {}
    this._saveCatalog();
    this.dispatchEvent(new CustomEvent('change', { detail: { gatewayId: normalized.id } }));
    return this.get(normalized.id);
  }

  forget(id) {
    const key = String(id || '');
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    try {
      localStorage.removeItem(`${TOKEN_PREFIX}${key}`);
      localStorage.removeItem(`${DEVICE_PREFIX}${key}`);
    } catch {}
    if (this.activeId === key) this.activeId = this.list()[0]?.id || '';
    for (const [sessionId, gatewayId] of Object.entries(this.sessionTargets)) {
      if (gatewayId === key) delete this.sessionTargets[sessionId];
    }
    writeJson(SESSION_TARGETS_KEY, this.sessionTargets);
    this._saveCatalog();
    this.dispatchEvent(new CustomEvent('change', { detail: { forgotten: key } }));
    return true;
  }

  bindSession(sessionId, gatewayId = this.activeId) {
    const sid = String(sessionId || '').trim();
    const gid = String(gatewayId || '').trim();
    if (!sid || !gid) return;
    const existing = this.sessionTargets[sid];
    if (existing && existing !== gid) throw new Error('This chat is already bound to another gateway.');
    this.sessionTargets[sid] = gid;
    writeJson(SESSION_TARGETS_KEY, this.sessionTargets);
  }

  gatewayIdForSession(sessionId) {
    return String(this.sessionTargets[String(sessionId || '')] || this.activeId || '');
  }

  clientForSession(sessionId) { return this.client(this.gatewayIdForSession(sessionId)); }

  async probe(id = this.activeId) {
    const entry = this.get(id);
    if (!entry) return null;
    try {
      const health = await this.client(id).health({ timeoutMs: 5000 });
      entry.status = 'online';
      entry.lastSeenAt = Date.now();
      this._saveCatalog();
      return { ...entry, health };
    } catch (error) {
      entry.status = Number(error?.status) === 401 ? 'revoked' : 'offline';
      this._saveCatalog();
      return { ...entry, error };
    }
  }

  async probeAll() { return Promise.all(this.list().map((entry) => this.probe(entry.id))); }
}

export { normalizeOrigin };
