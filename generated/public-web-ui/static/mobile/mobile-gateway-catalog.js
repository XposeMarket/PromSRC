// Phone-side registry for independent Prometheus gateways.
//
// This module deliberately owns only client catalog metadata, target-scoped
// credentials, target-scoped status/catalog reads, and immutable chat target
// bindings. Chat and voice work runs directly on the selected gateway with
// that gateway's paired-device grant; it is not a federation layer and it
// never forwards work from one gateway to another.

import { API } from '../state.js';
import {
  getDeviceToken,
  clearDeviceToken,
} from './mobile-api.js';

export const MOBILE_GATEWAY_CATALOG_ENABLED = true;
export const MOBILE_GATEWAY_PROTOCOL = 'prometheus-mobile-gateway';
export const MOBILE_GATEWAY_PROTOCOL_VERSION = 1;
export const MOBILE_GATEWAY_STATUS = Object.freeze({
  ONLINE: 'online',
  SUSPECT: 'suspect',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
  REVOKED: 'revoked',
});

const CATALOG_KEY = 'pm_mobile_gateway_catalog_v1';
const FILTER_KEY = 'pm_mobile_gateway_filter_v1';
const ACTIVE_KEY = 'pm_mobile_active_gateway_v1';
const SESSION_TARGETS_KEY = 'pm_mobile_session_targets_v1';
const PENDING_GATEWAY_PAIR_KEY = 'pm_mobile_pending_gateway_pair_v1';
const TOKEN_PREFIX = 'pm_mobile_gateway_token_v1:';
const DEVICE_PREFIX = 'pm_mobile_gateway_device_v1:';
const STATUS_PROBE_TIMEOUT_MS = 8000;

export function isMobileGatewayCatalogEnabled() {
  try {
    if (window.__PROMETHEUS_DISABLE_MOBILE_GATEWAY_CATALOG === true) return false;
    if (window.localStorage?.getItem('pm_mobile_gateway_catalog_disabled') === '1') return false;
  } catch {}
  return MOBILE_GATEWAY_CATALOG_ENABLED;
}

function _storage() {
  try { return window.localStorage; } catch { return null; }
}

function _readJson(key, fallback) {
  try {
    const raw = _storage()?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch { return fallback; }
}

function _writeJson(key, value) {
  try { _storage()?.setItem(key, JSON.stringify(value)); } catch {}
  return value;
}

function _remove(key) {
  try { _storage()?.removeItem(key); } catch {}
}

function _apiOrigin() {
  const configured = String(API || '').trim();
  if (configured) {
    try { return new URL(configured, window.location.origin).origin; } catch {}
  }
  try { return window.location.origin; } catch { return ''; }
}

export function normalizeGatewayOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, _apiOrigin() || undefined);
    if (!['http:', 'https:'].includes(url.protocol) || !url.host) return '';
    // New gateway calls never carry credentials in the URL. Query/hash data
    // from a pasted link is discarded before it can enter the catalog.
    return url.origin;
  } catch { return ''; }
}

function _stableHash(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function legacyGatewayId(origin = _apiOrigin()) {
  return `legacy:${_stableHash(normalizeGatewayOrigin(origin) || origin || 'local')}`;
}

export function targetNamespacedId(gatewayId, targetId) {
  const gateway = String(gatewayId || '').trim();
  const target = String(targetId || '').trim();
  if (!gateway || !target) return '';
  return `${gateway}::${target}`;
}

export function parseTargetNamespacedId(value) {
  const raw = String(value || '').trim();
  const marker = raw.indexOf('::');
  if (marker <= 0 || marker >= raw.length - 2) return null;
  return { gatewayId: raw.slice(0, marker), targetId: raw.slice(marker + 2), namespacedId: raw };
}

export function gatewayTokenKey(gatewayId) {
  return `${TOKEN_PREFIX}${encodeURIComponent(String(gatewayId || '').trim())}`;
}

export function getGatewayToken(gatewayId) {
  const id = String(gatewayId || '').trim();
  if (!id) return '';
  try {
    return _storage()?.getItem(gatewayTokenKey(id)) || '';
  } catch { return ''; }
}

export function setGatewayToken(gatewayId, token, deviceId = '') {
  const id = String(gatewayId || '').trim();
  if (!id) return;
  try {
    if (token) _storage()?.setItem(gatewayTokenKey(id), String(token));
    else _remove(gatewayTokenKey(id));
    if (deviceId) _storage()?.setItem(`${DEVICE_PREFIX}${encodeURIComponent(id)}`, String(deviceId));
    else if (!token) _remove(`${DEVICE_PREFIX}${encodeURIComponent(id)}`);
  } catch {}
}

export function getGatewayDeviceId(gatewayId) {
  try { return _storage()?.getItem(`${DEVICE_PREFIX}${encodeURIComponent(String(gatewayId || '').trim())}`) || ''; }
  catch { return ''; }
}

function _currentLegacyEntry() {
  const origin = _apiOrigin();
  const id = legacyGatewayId(origin);
  return normalizeGatewayDescriptor({
    gatewayId: id,
    id,
    name: 'This Prometheus',
    origin,
    platform: 'local',
    version: 'legacy',
    capabilities: ['catalog.read', 'status.read', 'pairing'],
    execution: { enabled: true, mode: 'same-origin' },
    status: MOBILE_GATEWAY_STATUS.UNKNOWN,
  }, { origin, legacy: true });
}

export function normalizeGatewayDescriptor(raw = {}, { origin = '', legacy = false } = {}) {
  const safeOrigin = normalizeGatewayOrigin(raw.origin || origin);
  const id = String(raw.gatewayId || raw.id || '').trim() || legacyGatewayId(safeOrigin || origin);
  const capabilities = Array.isArray(raw.capabilities)
    ? [...new Set(raw.capabilities.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 80)
    : [];
  const status = Object.values(MOBILE_GATEWAY_STATUS).includes(String(raw.status || ''))
    ? String(raw.status)
    : MOBILE_GATEWAY_STATUS.UNKNOWN;
  const rawExecution = raw.execution && typeof raw.execution === 'object' ? raw.execution : null;
  const execution = {
    // Older descriptors are safe to read but must not be used for a remote
    // mutation/stream until that gateway advertises the direct paired-device
    // execution contract. The current same-origin legacy entry remains usable.
    enabled: rawExecution ? rawExecution.enabled === true : legacy === true,
    mode: String(rawExecution?.mode || (legacy ? 'same-origin' : 'read-only')).trim().slice(0, 80),
    scopes: Array.isArray(rawExecution?.scopes)
      ? [...new Set(rawExecution.scopes.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 40)
      : [],
    reason: String(rawExecution?.reason || '').trim().slice(0, 160),
  };
  const lastContactAt = Number(raw.lastContactAt || raw.lastSeenAt || 0) || 0;
  return {
    gatewayId: id,
    name: String(raw.name || raw.gatewayName || raw.hostname || 'Prometheus gateway').trim().slice(0, 120),
    platform: String(raw.platform || raw.os || 'unknown').trim().slice(0, 40),
    architecture: String(raw.architecture || raw.arch || '').trim().slice(0, 40),
    version: String(raw.version || 'unknown').trim().slice(0, 80),
    origin: safeOrigin,
    workspaceName: String(raw.workspaceName || raw.workspace || '').trim().slice(0, 120),
    capabilities,
    protocol: String(raw.protocol || MOBILE_GATEWAY_PROTOCOL).trim(),
    protocolVersion: Number(raw.protocolVersion || raw.protocol?.version || MOBILE_GATEWAY_PROTOCOL_VERSION) || MOBILE_GATEWAY_PROTOCOL_VERSION,
    execution,
    status,
    lastContactAt,
    lastError: String(raw.lastError || '').trim().slice(0, 240),
    addedAt: Number(raw.addedAt || Date.now()) || Date.now(),
    revokedAt: Number(raw.revokedAt || 0) || 0,
    legacy: legacy === true || raw.legacy === true,
  };
}

export function loadGatewayCatalog() {
  const parsed = _readJson(CATALOG_KEY, []);
  const entries = Array.isArray(parsed)
    ? parsed.map((item) => normalizeGatewayDescriptor(item)).filter((item) => item.gatewayId && item.origin)
    : [];
  const legacy = _currentLegacyEntry();
  if (getDeviceToken() && !entries.some((entry) => entry.gatewayId === legacy.gatewayId)) {
    entries.unshift({ ...legacy, status: MOBILE_GATEWAY_STATUS.UNKNOWN });
  }
  return entries;
}

export function saveGatewayCatalog(entries) {
  const next = [];
  const seen = new Set();
  for (const item of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeGatewayDescriptor(item);
    if (!normalized.gatewayId || !normalized.origin || seen.has(normalized.gatewayId)) continue;
    seen.add(normalized.gatewayId);
    next.push(normalized);
  }
  return _writeJson(CATALOG_KEY, next);
}

export function getGateway(gatewayId) {
  return loadGatewayCatalog().find((entry) => entry.gatewayId === String(gatewayId || '').trim()) || null;
}

export function hasAnyGatewayCredential() {
  return loadGatewayCatalog().some((entry) => Boolean(getGatewayToken(entry.gatewayId) || (entry.legacy && getDeviceToken())));
}

export function getActiveGatewayId() {
  const stored = String(_readJson(ACTIVE_KEY, '') || '').trim();
  const entries = loadGatewayCatalog();
  if (stored && entries.some((entry) => entry.gatewayId === stored)) return stored;
  return entries[0]?.gatewayId || '';
}

export function setActiveGatewayId(gatewayId) {
  const id = String(gatewayId || '').trim();
  if (!id || !getGateway(id)) return '';
  try { _storage()?.setItem(ACTIVE_KEY, id); } catch {}
  _emitCatalogChanged({ type: 'active_changed', gatewayId: id });
  return id;
}

export function getGatewayFilter() {
  const raw = _readJson(FILTER_KEY, { mode: 'all', gatewayIds: [] });
  const entries = loadGatewayCatalog();
  const ids = Array.isArray(raw?.gatewayIds)
    ? raw.gatewayIds.map(String).filter((id) => entries.some((entry) => entry.gatewayId === id))
    : [];
  if (raw?.mode === 'selected' && ids.length) return { mode: 'selected', gatewayIds: ids };
  return { mode: 'all', gatewayIds: entries.map((entry) => entry.gatewayId) };
}

export function setGatewayFilter(gatewayIds = []) {
  const entries = loadGatewayCatalog();
  const ids = [...new Set((Array.isArray(gatewayIds) ? gatewayIds : [gatewayIds]).map(String))]
    .filter((id) => entries.some((entry) => entry.gatewayId === id));
  const value = ids.length && ids.length < entries.length
    ? { mode: 'selected', gatewayIds: ids }
    : { mode: 'all', gatewayIds: entries.map((entry) => entry.gatewayId) };
  _writeJson(FILTER_KEY, value);
  _emitCatalogChanged({ type: 'filter_changed', filter: value });
  return value;
}

export function filterGatewayEntries(entries = loadGatewayCatalog(), filter = getGatewayFilter()) {
  if (!filter || filter.mode === 'all') return entries.slice();
  const ids = new Set(Array.isArray(filter.gatewayIds) ? filter.gatewayIds : []);
  return entries.filter((entry) => ids.has(entry.gatewayId));
}

// Session visibility is deliberately stricter than the user-selected view
// filter. A target may remain in the catalog while it is suspect, offline, or
// revoked, but its chats must not remain selectable in an aggregate view.
export function filterOnlineGatewayEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry?.status || '') === MOBILE_GATEWAY_STATUS.ONLINE);
}

export function upsertGateway(entry, { token = '', deviceId = '' } = {}) {
  const normalized = normalizeGatewayDescriptor(entry);
  if (!normalized.gatewayId || !normalized.origin) throw new Error('Gateway identity and origin are required.');
  const entries = loadGatewayCatalog().filter((item) => item.gatewayId !== normalized.gatewayId);
  const previous = getGateway(normalized.gatewayId);
  saveGatewayCatalog([...entries, { ...previous, ...normalized, addedAt: previous?.addedAt || normalized.addedAt }]);
  if (token) setGatewayToken(normalized.gatewayId, token, deviceId);
  if (!getActiveGatewayId()) setActiveGatewayId(normalized.gatewayId);
  _emitCatalogChanged({ type: 'gateway_upserted', gateway: normalized });
  return getGateway(normalized.gatewayId) || normalized;
}

export function updateGatewayStatus(gatewayId, patch = {}) {
  const current = getGateway(gatewayId);
  if (!current) return null;
  const next = normalizeGatewayDescriptor({ ...current, ...patch, gatewayId: current.gatewayId, id: current.gatewayId });
  saveGatewayCatalog(loadGatewayCatalog().map((entry) => entry.gatewayId === next.gatewayId ? next : entry));
  _emitCatalogChanged({ type: 'status_changed', gateway: next });
  return next;
}

export function forgetGateway(gatewayId) {
  const id = String(gatewayId || '').trim();
  const entries = loadGatewayCatalog();
  const next = entries.filter((entry) => entry.gatewayId !== id);
  if (next.length === entries.length) return false;
  saveGatewayCatalog(next);
  setGatewayToken(id, '');
  if (String(_readJson(ACTIVE_KEY, '') || '') === id) _remove(ACTIVE_KEY);
  _emitCatalogChanged({ type: 'gateway_forgotten', gatewayId: id });
  return true;
}

export function bindMobileSessionTarget(sessionId, gatewayId, { path = '', started = false, project = '', workspace = '' } = {}) {
  const sid = String(sessionId || '').trim();
  const gid = String(gatewayId || '').trim();
  if (!sid || !gid || sid === 'mobile_default') return false;
  const all = _readJson(SESSION_TARGETS_KEY, {});
  const existing = all[sid];
  if (existing?.gatewayId && existing.gatewayId !== gid) return false;
  const gateway = getGateway(gid);
  all[sid] = {
    gatewayId: gid,
    // Keep the origin alongside the immutable id so a refreshed catalog can
    // recover an already-open chat even when the gateway id was regenerated.
    origin: normalizeGatewayOrigin(gateway?.origin || existing?.origin || ''),
    path: String(path || existing?.path || '').trim().slice(0, 500),
    project: String(project || existing?.project || '').trim().slice(0, 160),
    workspace: String(workspace || existing?.workspace || '').trim().slice(0, 160),
    startedAt: Number(existing?.startedAt || (started ? Date.now() : 0)) || 0,
    immutable: existing?.immutable === true || started === true,
  };
  _writeJson(SESSION_TARGETS_KEY, all);
  _emitCatalogChanged({ type: 'session_target_bound', sessionId: sid, gatewayId: gid });
  return true;
}

export function getMobileSessionTarget(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const all = _readJson(SESSION_TARGETS_KEY, {});
  return all[sid] && typeof all[sid] === 'object' ? { ...all[sid], sessionId: sid } : null;
}

export function resolveMobileSessionGateway(sessionId, { pendingGatewayId = '', fallbackToCurrentGateway = false } = {}) {
  const bound = getMobileSessionTarget(sessionId);
  if (bound?.gatewayId) {
    const exact = getGateway(bound.gatewayId);
    if (exact) return exact;

    const boundOrigin = normalizeGatewayOrigin(bound.origin);
    if (boundOrigin) {
      const byOrigin = loadGatewayCatalog().find((entry) => normalizeGatewayOrigin(entry.origin) === boundOrigin);
      if (byOrigin) return byOrigin;
    }

    // Only legacy local sessions may recover to the current PWA gateway. A
    // namespaced remote target must never silently route to another gateway.
    if (fallbackToCurrentGateway && !boundOrigin) {
      const currentEntries = loadGatewayCatalog().filter((entry) => isCurrentGateway(entry));
      if (currentEntries.length === 1) return currentEntries[0];
    }
    return null;
  }
  const pending = getGateway(pendingGatewayId);
  if (pending) return pending;
  return getGateway(getActiveGatewayId()) || loadGatewayCatalog()[0] || null;
}

export function setMobileActiveGatewayTarget(entryOrId) {
  const entry = typeof entryOrId === 'string' ? getGateway(entryOrId) : entryOrId;
  const origin = normalizeGatewayOrigin(entry?.origin);
  const token = entry?.gatewayId
    ? (getGatewayToken(entry.gatewayId) || (isCurrentGateway(entry) ? getDeviceToken() : ''))
    : '';
  try {
    window.__pmMobileActiveGatewayId = String(entry?.gatewayId || '').trim();
    window.__pmMobileActiveGatewayOrigin = origin;
    window.__pmMobileActiveGatewayToken = token;
    window.__pmMobileActiveGatewayExecutionEnabled = entry?.execution?.enabled === true;
  } catch {}
  return entry || null;
}

export function isGatewayExecutionEnabled(entryOrId) {
  const entry = typeof entryOrId === 'string' ? getGateway(entryOrId) : entryOrId;
  return entry?.execution?.enabled === true;
}

export function isCurrentGateway(entry) {
  return normalizeGatewayOrigin(entry?.origin) === _apiOrigin();
}

function _timeoutError(message = 'Gateway request timed out.') {
  const error = new Error(message);
  error.code = 'GATEWAY_TIMEOUT';
  error.retryable = true;
  return error;
}

export async function gatewayFetchJson(entryOrId, path, options = {}) {
  const entry = typeof entryOrId === 'string' ? getGateway(entryOrId) : entryOrId;
  if (!entry?.gatewayId || !entry.origin) {
    const error = new Error('Unknown gateway target.');
    error.code = 'UNKNOWN_GATEWAY_TARGET';
    throw error;
  }
  // UNKNOWN means this target has not been probed in this browser session yet;
  // it must still be reachable for the first catalog read. OFFLINE and
  // REVOKED are the only fail-closed states.
  if (options.allowProbe !== true
      && [MOBILE_GATEWAY_STATUS.OFFLINE, MOBILE_GATEWAY_STATUS.REVOKED].includes(String(entry.status || ''))) {
    const error = new Error(`Gateway “${entry.name}” is not online.`);
    error.code = entry.status === MOBILE_GATEWAY_STATUS.REVOKED ? 'GATEWAY_REVOKED' : 'GATEWAY_OFFLINE';
    error.retryable = entry.status !== MOBILE_GATEWAY_STATUS.REVOKED;
    throw error;
  }
  const token = getGatewayToken(entry.gatewayId) || (isCurrentGateway(entry) ? getDeviceToken() : '');
  if (!token) {
    const error = new Error(`Gateway “${entry.name}” is not paired on this phone.`);
    error.code = 'GATEWAY_NOT_PAIRED';
    throw error;
  }
  if (!String(path || '').startsWith('/')) throw new Error('Gateway path must be absolute.');
  const url = `${normalizeGatewayOrigin(entry.origin)}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set('X-Pairing-Token', token);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const controller = new AbortController();
  const parentSignal = options.signal;
  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs || STATUS_PROBE_TIMEOUT_MS)));
  try {
    const { allowProbe: _allowProbe, timeoutMs: _timeoutMs, signal: _signal, ...fetchOptions } = options;
    const response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      if (response.status === 401) {
        // A rejected pairing grant must not degrade into an empty chat list.
        // Clear only the credential for the target that rejected it, then let
        // the router take the phone back through pairing if no grant remains.
        setGatewayToken(entry.gatewayId, '');
        if (isCurrentGateway(entry)) clearDeviceToken();
        updateGatewayStatus(entry.gatewayId, {
          status: MOBILE_GATEWAY_STATUS.REVOKED,
          lastError: 'This phone is no longer paired with the gateway.',
          revokedAt: Date.now(),
        });
        try { window.dispatchEvent(new Event('pm-device-revoked')); } catch {}
      }
      const restarting = response.status === 503
        && (body?.code === 'GATEWAY_RESTARTING' || response.headers?.get?.('X-Prometheus-Gateway-State') === 'restarting');
      const error = new Error(String(body?.error || body?.message || (restarting ? 'Gateway is restarting. Please retry shortly.' : `Gateway request failed (${response.status}).`)));
      error.status = response.status;
      error.body = body;
      error.code = response.status === 401 ? 'GATEWAY_REVOKED' : restarting ? 'GATEWAY_RESTARTING' : 'GATEWAY_REQUEST_FAILED';
      error.retryable = restarting;
      throw error;
    }
    return body || {};
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (error?.name === 'AbortError') throw _timeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener?.('abort', onAbort);
  }
}

// Pairing is the one intentional pre-credential request. It is bound by the
// short-lived challenge in the body, never by a token in the URL, and the
// target desktop still has to approve the pending request.
export async function pairingGatewayFetchJson(origin, path, options = {}) {
  const safeOrigin = normalizeGatewayOrigin(origin);
  if (!safeOrigin || !String(path || '').startsWith('/')) {
    const error = new Error('Invalid pairing target.');
    error.code = 'INVALID_PAIRING_TARGET';
    throw error;
  }
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const controller = new AbortController();
  const parentSignal = options.signal;
  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs || STATUS_PROBE_TIMEOUT_MS)));
  try {
    const response = await fetch(`${safeOrigin}${path}`, { ...options, headers, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const error = new Error(String(body?.error || body?.message || `Pairing request failed (${response.status}).`));
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body || {};
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (error?.name === 'AbortError') throw _timeoutError('Pairing request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener?.('abort', onAbort);
  }
}

function _descriptorFromResponse(response, entry) {
  const raw = response?.gateway || response?.descriptor || response;
  return normalizeGatewayDescriptor({ ...entry, ...(raw || {}), gatewayId: raw?.gatewayId || raw?.id || entry.gatewayId, origin: entry.origin });
}

export async function probeGateway(entryOrId, { persist = true } = {}) {
  const entry = typeof entryOrId === 'string' ? getGateway(entryOrId) : entryOrId;
  if (!entry) throw new Error('Unknown gateway target.');
  try {
    let response;
    try {
      response = await gatewayFetchJson(entry, '/api/gateway/descriptor', { timeoutMs: STATUS_PROBE_TIMEOUT_MS, allowProbe: true });
    } catch (firstError) {
      // Compatibility with a gateway from before the descriptor route. The
      // status response is still read-only; it simply lacks stable identity.
      if (firstError?.status !== 404) throw firstError;
      response = await gatewayFetchJson(entry, '/api/status', { timeoutMs: STATUS_PROBE_TIMEOUT_MS, allowProbe: true });
    }
    const next = _descriptorFromResponse(response, entry);
    next.status = MOBILE_GATEWAY_STATUS.ONLINE;
    next.lastContactAt = Date.now();
    next.lastError = '';
    if (persist) updateGatewayStatus(entry.gatewayId, next);
    return next;
  } catch (error) {
    const status = error?.code === 'GATEWAY_TIMEOUT' || error?.code === 'GATEWAY_REQUEST_FAILED' || error?.code === 'GATEWAY_RESTARTING'
      ? MOBILE_GATEWAY_STATUS.SUSPECT
      : error?.code === 'GATEWAY_REVOKED'
        ? MOBILE_GATEWAY_STATUS.REVOKED
        : MOBILE_GATEWAY_STATUS.OFFLINE;
    const next = updateGatewayStatus(entry.gatewayId, {
      status,
      lastError: String(error?.message || error || 'Gateway unreachable').slice(0, 240),
    });
    if (next) return next;
    throw error;
  }
}

export async function refreshGatewayStatuses({ gatewayIds = null } = {}) {
  const entries = gatewayIds
    ? loadGatewayCatalog().filter((entry) => gatewayIds.includes(entry.gatewayId))
    : loadGatewayCatalog();
  return Promise.all(entries.map((entry) => probeGateway(entry).catch(() => getGateway(entry.gatewayId) || entry)));
}

async function _loadOnlineSelectedGatewayEntries() {
  const selected = filterGatewayEntries(loadGatewayCatalog());
  if (!selected.length) return [];
  await refreshGatewayStatuses({ gatewayIds: selected.map((entry) => entry.gatewayId) });
  return filterOnlineGatewayEntries(filterGatewayEntries(loadGatewayCatalog()));
}

async function _readGatewayCatalog(entry, state = 'active', limit = 50) {
  const params = new URLSearchParams({ state, limit: String(limit), offset: '0' });
  try {
    const response = await gatewayFetchJson(entry, `/api/mobile/gateway/catalog?${params.toString()}`);
    return {
      gateway: entry,
      sessions: Array.isArray(response?.sessions) ? response.sessions : [],
      agents: Array.isArray(response?.agents) ? response.agents : [],
      tasks: Array.isArray(response?.tasks) ? response.tasks : [],
      total: Number(response?.total || 0) || 0,
      errors: [],
    };
  } catch (catalogError) {
    // Keep older one-gateway installs usable while they upgrade. The legacy
    // fallback is still target-scoped and read-only, but may require the
    // gateway's existing account session; it never receives a query token.
    const legacyParams = new URLSearchParams({ scope: 'all', includeAutomated: '1', state, limit: String(limit), offset: '0' });
    const [sessions, agents, tasks] = await Promise.allSettled([
      gatewayFetchJson(entry, `/api/sessions?${legacyParams.toString()}`),
      gatewayFetchJson(entry, '/api/agents'),
      gatewayFetchJson(entry, '/api/bg-tasks?mobile=1'),
    ]);
    const map = (result, field) => result.status === 'fulfilled'
      ? (Array.isArray(result.value) ? result.value : (Array.isArray(result.value?.[field]) ? result.value[field] : []))
      : [];
    return {
      gateway: entry,
      sessions: map(sessions, 'sessions'),
      agents: map(agents, 'agents'),
      tasks: map(tasks, 'tasks'),
      errors: [catalogError, sessions, agents, tasks]
        .filter((result) => result?.status === 'rejected' || result?.message || result?.reason)
        .map((result) => String(result?.message || result?.reason?.message || result?.reason || 'read failed')),
    };
  }
}

export async function loadMobileGatewaySessionPage({ limit = 20, offset = 0, state = 'active' } = {}) {
  // Re-probe on every session page request. This intentionally makes the
  // aggregate view fail closed instead of relying on a stale 30-second list
  // cache or an old "online" dot.
  const selected = await _loadOnlineSelectedGatewayEntries();
  const pages = await Promise.all(selected.map(async (entry) => {
    try {
      const params = new URLSearchParams({ state, limit: String(limit), offset: String(offset) });
      let result;
      try {
        result = await gatewayFetchJson(entry, `/api/mobile/gateway/catalog?${params.toString()}`);
      } catch (catalogError) {
        const legacyParams = new URLSearchParams({ scope: 'all', includeAutomated: '1', state, limit: String(limit), offset: String(offset) });
        result = await gatewayFetchJson(entry, `/api/sessions?${legacyParams.toString()}`);
      }
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      return {
        ...result,
        gateway: entry,
        sessions: sessions.map((session) => ({
          ...session,
          targetSessionId: String(session.id || '').trim(),
          gatewayId: entry.gatewayId,
          gatewayName: entry.name,
          id: targetNamespacedId(entry.gatewayId, session.id),
        })),
      };
    } catch (error) {
      return { gateway: entry, sessions: [], total: 0, error: String(error?.message || error || 'Gateway unavailable') };
    }
  }));
  const sessions = pages.flatMap((page) => page.sessions || []).sort((a, b) => Number(b.lastMessageAt || b.lastActiveAt || 0) - Number(a.lastMessageAt || a.lastActiveAt || 0));
  return { scope: 'all-gateways', sessions, total: sessions.length, offset, hasMore: false, gateways: pages };
}
loadMobileGatewaySessionPage.loadPage = loadMobileGatewaySessionPage;

export async function loadMobileGatewaySessionGroups(options = {}) {
  if (!isMobileGatewayCatalogEnabled()) return null;
  const page = await loadMobileGatewaySessionPage(options);
  return { sessions: page.sessions, mobile: page.sessions, mobilePage: page, channels: [], pageSize: options.limit || 20, state: options.state || 'active', activeChannel: 'all' };
}

export async function loadMobileGatewayPinnedSessions({ state = 'active' } = {}) {
  const page = await loadMobileGatewaySessionPage({ limit: 200, offset: 0, state });
  return (page.sessions || []).filter((session) => Number(session.pinnedAt || 0) > 0);
}

export async function searchMobileGatewaySessions(query, { limit = 100, mode = 'content', state = 'active' } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const selected = await _loadOnlineSelectedGatewayEntries();
  const results = await Promise.all(selected.map(async (entry) => {
    try {
      const params = new URLSearchParams({ q, limit: String(limit), mode: mode === 'title' ? 'title' : 'content', scope: 'all', includeAutomated: '1', state });
      const response = await gatewayFetchJson(entry, `/api/sessions/search?${params.toString()}`);
      return (Array.isArray(response?.sessions) ? response.sessions : []).map((session) => ({
        ...session,
        gatewayId: entry.gatewayId,
        gatewayName: entry.name,
        targetSessionId: String(session.id || '').trim(),
        id: targetNamespacedId(entry.gatewayId, session.id),
      }));
    } catch { return []; }
  }));
  return results.flat().slice(0, limit);
}

export async function loadMobileGatewayOverview() {
  if (!isMobileGatewayCatalogEnabled()) return { disabled: true, gateways: [], sessions: [], agents: [], tasks: [] };
  const selected = filterGatewayEntries(loadGatewayCatalog());
  const results = await Promise.all(selected.map((entry) => _readGatewayCatalog(entry).catch((error) => ({ gateway: entry, sessions: [], agents: [], tasks: [], errors: [String(error?.message || error)] }))));
  return {
    gateways: results,
    sessions: results.flatMap((result) => (result.sessions || []).map((item) => ({ ...item, gatewayId: result.gateway.gatewayId, gatewayName: result.gateway.name, targetSessionId: item.id, id: targetNamespacedId(result.gateway.gatewayId, item.id) }))),
    agents: results.flatMap((result) => (result.agents || []).map((item) => ({ ...item, gatewayId: result.gateway.gatewayId, gatewayName: result.gateway.name, id: targetNamespacedId(result.gateway.gatewayId, item.id) }))),
    tasks: results.flatMap((result) => (result.tasks || []).map((item) => ({ ...item, gatewayId: result.gateway.gatewayId, gatewayName: result.gateway.name, id: targetNamespacedId(result.gateway.gatewayId, item.id) }))),
  };
}

export async function revokeGateway(gatewayId) {
  const entry = getGateway(gatewayId);
  if (!entry) throw new Error('Unknown gateway target.');
  await gatewayFetchJson(entry, '/api/pairing/me/revoke', { method: 'POST', body: '{}' });
  updateGatewayStatus(gatewayId, { status: MOBILE_GATEWAY_STATUS.REVOKED, revokedAt: Date.now() });
  setGatewayToken(gatewayId, '');
  if (isCurrentGateway(entry)) clearDeviceToken();
  return true;
}

export function getPairingPayload(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const bytes = decodeBase64Url(decoded);
    const parsed = JSON.parse(bytes);
    if (parsed?.audience !== 'prometheus-mobile-pairing') return null;
    if (Number(parsed.expiresAt || 0) < Date.now()) return null;
    if (!parsed.challenge || !parsed.gatewayId || !parsed.origin) return null;
    const origin = normalizeGatewayOrigin(parsed.origin);
    if (!origin) return null;
    return {
      ...parsed,
      origin,
      challenge: String(parsed.challenge),
      gatewayId: String(parsed.gatewayId),
    };
  } catch { return null; }
}

// An in-app QR scan must stay on the current PWA origin. Keep the validated
// payload in session storage while the pairing route claims and polls the
// target gateway; never put the cross-origin target back into window.location.
export function setPendingGatewayPair(value) {
  const raw = String(value || '').trim();
  if (!raw || !getPairingPayload(raw)) return false;
  try {
    sessionStorage.setItem(PENDING_GATEWAY_PAIR_KEY, raw);
    return true;
  } catch { return false; }
}

export function getPendingGatewayPair() {
  try {
    const raw = String(sessionStorage.getItem(PENDING_GATEWAY_PAIR_KEY) || '').trim();
    if (!raw || !getPairingPayload(raw)) {
      if (raw) sessionStorage.removeItem(PENDING_GATEWAY_PAIR_KEY);
      return '';
    }
    return raw;
  } catch { return ''; }
}

export function clearPendingGatewayPair() {
  try { sessionStorage.removeItem(PENDING_GATEWAY_PAIR_KEY); } catch {}
}

export function encodePairingPayload(payload = {}) {
  const safe = {
    version: 1,
    audience: 'prometheus-mobile-pairing',
    gatewayId: String(payload.gatewayId || '').trim(),
    origin: normalizeGatewayOrigin(payload.origin),
    challenge: String(payload.challenge || '').trim(),
    expiresAt: Number(payload.expiresAt || 0) || 0,
    name: String(payload.name || '').trim().slice(0, 120),
    platform: String(payload.platform || '').trim().slice(0, 40),
    gatewayVersion: String(payload.gatewayVersion || payload.version || '').trim().slice(0, 80),
  };
  return encodeBase64Url(JSON.stringify(safe));
}

function encodeBase64Url(value) {
  const text = String(value || '');
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return text;
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))));
  return normalized;
}

const _listeners = new Set();
export function onGatewayCatalogChanged(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _emitCatalogChanged(detail) {
  for (const listener of _listeners) {
    try { listener(detail); } catch {}
  }
  try { window.dispatchEvent(new CustomEvent('pm-gateway-catalog-changed', { detail })); } catch {}
}

export function gatewayStatusLabel(status) {
  return ({ online: 'Online', suspect: 'Suspect', offline: 'Offline', revoked: 'Revoked', unknown: 'Unknown' })[String(status || '')] || 'Unknown';
}
