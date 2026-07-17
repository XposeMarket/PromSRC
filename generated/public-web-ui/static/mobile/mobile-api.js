// Mobile API shim — adapts Prometheus gateway endpoints into the shapes
// expected by mobile-pages.js. Keep this layer thin; do not put rendering here.

import { api } from '../api.js';
import { API } from '../state.js';

/* ---------------- pairing / device token ---------------- */
// All mobile fetches go through `mfetch()` below which automatically attaches
// the device token from localStorage. If a server rejects the token (401), we
// clear it and let the router redirect to #mobile/pair.

const PM_TOKEN_KEY = 'pm_device_token';
const PM_DEVICE_KEY = 'pm_device_id';
const PM_MOBILE_PAGE_CACHE_KEY = 'pm_mobile_page_data_v1';
const _mobilePageMemoryCache = new Map();
const _mobilePageRequests = new Map();

function _readMobilePageCacheStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_MOBILE_PAGE_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function getCachedMobilePageData(key, maxAgeMs = 300_000) {
  const id = String(key || '').trim();
  if (!id) return null;
  const memory = _mobilePageMemoryCache.get(id);
  if (memory && Date.now() - Number(memory.savedAt || 0) <= maxAgeMs) return memory.value;
  const entry = _readMobilePageCacheStore()[id];
  if (!entry || Date.now() - Number(entry.savedAt || 0) > maxAgeMs) return null;
  _mobilePageMemoryCache.set(id, entry);
  return entry.value;
}

function _saveMobilePageData(key, value) {
  const id = String(key || '').trim();
  if (!id || value == null) return value;
  const entry = { savedAt: Date.now(), value };
  _mobilePageMemoryCache.set(id, entry);
  try {
    const store = _readMobilePageCacheStore();
    if (id === 'tasks' && Date.now() - Number(store[id]?.savedAt || 0) < 20_000) return value;
    store[id] = entry;
    const keys = Object.keys(store).sort((a, b) => Number(store[b]?.savedAt || 0) - Number(store[a]?.savedAt || 0));
    keys.slice(8).forEach((oldKey) => delete store[oldKey]);
    localStorage.setItem(PM_MOBILE_PAGE_CACHE_KEY, JSON.stringify(store));
  } catch {}
  return value;
}

function _invalidateMobilePageData(key) {
  const id = String(key || '').trim();
  _mobilePageMemoryCache.delete(id);
  try {
    const store = _readMobilePageCacheStore();
    delete store[id];
    localStorage.setItem(PM_MOBILE_PAGE_CACHE_KEY, JSON.stringify(store));
  } catch {}
}

function _coalesceMobilePageRequest(key, factory) {
  const id = String(key || '').trim();
  const existing = _mobilePageRequests.get(id);
  if (existing) return existing;
  const request = Promise.resolve().then(factory).finally(() => _mobilePageRequests.delete(id));
  _mobilePageRequests.set(id, request);
  return request;
}

export function getDeviceToken() { try { return localStorage.getItem(PM_TOKEN_KEY) || ''; } catch { return ''; } }
export function setDeviceToken(token, deviceId) {
  try {
    if (token) localStorage.setItem(PM_TOKEN_KEY, token);
    else localStorage.removeItem(PM_TOKEN_KEY);
    if (deviceId) localStorage.setItem(PM_DEVICE_KEY, deviceId);
    else if (!token) localStorage.removeItem(PM_DEVICE_KEY);
  } catch {}
}
export function clearDeviceToken() { setDeviceToken('', ''); }

function _buildUrl(path) {
  const base = String(API || '').replace(/\/+$/, '');
  return base + path;
}

export function buildMobileGatewayWsUrl(path, params = {}) {
  const token = getDeviceToken();
  const base = String(API || '').replace(/\/+$/, '') || location.origin;
  const httpUrl = new URL(path, base);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) httpUrl.searchParams.set('pt', token);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    httpUrl.searchParams.set(key, String(value));
  }
  return httpUrl.toString();
}

async function mfetch(path, opts = {}) {
  const token = getDeviceToken();
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('X-Pairing-Token', token);
  const timeoutMs = Math.max(1000, Math.floor(Number(opts.timeoutMs || 15000) || 15000));
  const controller = new AbortController();
  const parentSignal = opts.signal;
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _timeoutMs, signal: _signal, ...fetchOpts } = opts;
  let res;
  try {
    res = await fetch(_buildUrl(path), { ...fetchOpts, headers, signal: controller.signal });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    const out = new Error(isAbort
      ? 'Gateway request timed out. Prometheus may still be starting.'
      : (err?.message || 'Gateway request failed.'));
    out.cause = err;
    out.retryable = true;
    throw out;
  } finally {
    clearTimeout(timeout);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
  if (res.status === 401 && token) {
    // Device token rejected — invalidate locally so the router sends user to pairing.
    clearDeviceToken();
    window.dispatchEvent(new Event('pm-device-revoked'));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

async function mfetchWithRetry(path, opts = {}, retry = {}) {
  const attempts = Math.max(1, Math.floor(Number(retry.attempts || 2) || 2));
  const delayMs = Math.max(100, Math.floor(Number(retry.delayMs || 500) || 500));
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await mfetch(path, opts);
    } catch (err) {
      lastErr = err;
      const status = Number(err?.status || 0);
      const retryable = err?.retryable === true || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt >= attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function mobileGatewayFetch(path, opts = {}) {
  return mfetch(path, opts);
}

export async function mobileGatewayTextFetch(path, opts = {}) {
  const token = getDeviceToken();
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('X-Pairing-Token', token);
  const res = await fetch(_buildUrl(path), { ...opts, headers });
  if (res.status === 401 && token) {
    clearDeviceToken();
    window.dispatchEvent(new Event('pm-device-revoked'));
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text;
}

function _urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - String(value || '').length % 4) % 4);
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + padding;
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getMobilePushStatus() {
  const browserSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let permission = 'unsupported';
  try { permission = browserSupported ? Notification.permission : 'unsupported'; } catch {}
  let subscription = null;
  if (browserSupported) {
    try {
      const currentReg = await navigator.serviceWorker.getRegistration();
      await currentReg?.update?.();
      const reg = await navigator.serviceWorker.ready;
      subscription = await reg.pushManager.getSubscription();
    } catch {}
  }
  const server = await mfetch('/api/push/status').catch(() => null);
  return {
    browserSupported,
    permission,
    subscribed: !!subscription,
    subscriptionCount: Number(server?.subscriptionCount || 0),
    server,
  };
}

export async function enableMobileChatPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push notifications are not supported on this browser.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  try { await reg.update?.(); } catch {}
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    const key = await mfetch('/api/push/public-key');
    const publicKey = String(key?.publicKey || '').trim();
    if (!publicKey) throw new Error('Push public key unavailable.');
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(publicKey),
    });
  }
  const deviceName = navigator.userAgent.includes('iPhone') ? 'iPhone PWA' : navigator.userAgent.includes('iPad') ? 'iPad PWA' : 'Mobile PWA';
  const saved = await mfetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: subscription.toJSON ? subscription.toJSON() : subscription,
      deviceId: getDeviceToken(),
      deviceName,
    }),
  });
  await mfetch('/api/push/test', { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
  return saved;
}

export async function disableMobileChatPushNotifications() {
  let endpoint = '';
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    endpoint = subscription?.endpoint || '';
    if (subscription) await subscription.unsubscribe();
  } catch {}
  if (endpoint) {
    return mfetch('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  }
  return { success: true, removed: false };
}

export async function loadMobileApprovals(status = 'pending') {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await mfetch(`/api/approvals${qs}`);
  return Array.isArray(r?.approvals) ? r.approvals : [];
}

export async function loadMobileQuestions(status = 'pending') {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await mfetch(`/api/questions${qs}`);
  return Array.isArray(r?.questions) ? r.questions : [];
}

export async function approveMobileApproval(id, grantScope = '', options = {}) {
  const scope = String(grantScope || '').trim();
  const source = String(options?.source || options?.resolvedBy || '').trim();
  const body = scope ? { grantScope: scope } : {};
  if (source) {
    body.source = source;
    body.resolvedBy = source;
  }
  return mfetch(`/api/approvals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function denyMobileApproval(id, options = {}) {
  const source = String(options?.source || options?.resolvedBy || '').trim();
  return mfetch(`/api/approvals/${encodeURIComponent(id)}/deny`, {
    method: 'POST',
    body: JSON.stringify(source ? { source, resolvedBy: source } : {}),
  });
}

export async function loadMobileProcessRuns(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const r = await mfetch(`/api/processes?limit=${encodeURIComponent(String(safeLimit))}`);
  return Array.isArray(r?.runs) ? r.runs : [];
}

export async function loadMobileProcessRunLog(runId, maxChars = 200000) {
  const id = encodeURIComponent(String(runId || ''));
  const safeMax = Math.max(1000, Math.min(1000000, Math.floor(Number(maxChars) || 200000)));
  return mfetch(`/api/processes/${id}/log?maxChars=${encodeURIComponent(String(safeMax))}`);
}

export async function rerunMobileProcessRun(runId) {
  return mfetch(`/api/processes/${encodeURIComponent(String(runId || ''))}/rerun`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function killMobileProcessRun(runId) {
  return mfetch(`/api/processes/${encodeURIComponent(String(runId || ''))}/kill`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function submitMobileProcessInput(runId, data) {
  return mfetch(`/api/processes/${encodeURIComponent(String(runId || ''))}/submit`, {
    method: 'POST',
    body: JSON.stringify({ data: String(data || '') }),
  });
}

export async function uploadMobileTextFile({ filename, content }) {
  return mfetchWithRetry('/api/canvas/upload', {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
    timeoutMs: 60000,
  }, { attempts: 3, delayMs: 700 });
}

export async function uploadMobileBinaryFile({ filename, base64, mimeType }) {
  return mfetchWithRetry('/api/canvas/upload-binary', {
    method: 'POST',
    body: JSON.stringify({ filename, base64, mimeType }),
    timeoutMs: 60000,
  }, { attempts: 3, delayMs: 700 });
}

/* ---------------- pairing endpoints ---------------- */

export async function claimPairing({ code, deviceName, deviceFingerprint }) {
  return mfetch('/api/pairing/claim', {
    method: 'POST',
    body: JSON.stringify({ code, deviceName, deviceFingerprint }),
  });
}
export async function pollPairing(requestId) {
  return mfetch(`/api/pairing/poll/${encodeURIComponent(requestId)}`);
}
export async function verifyPairingMe() {
  if (!getDeviceToken()) return null;
  try { return await mfetch('/api/pairing/me'); } catch { return null; }
}

export async function createVoiceInterruptionEvent(payload = {}) {
  return mfetch('/api/voice-agent/input', {
    method: 'POST',
    body: JSON.stringify({
      ...(payload || {}),
      transcript: String(payload?.userInterruptionTranscript || payload?.transcript || '').trim(),
      source: String(payload?.source || 'mobile_voice_agent'),
    }),
  });
}

// Streaming variant: POSTs with { stream: true } and consumes the SSE response,
// invoking onChunk(text) per sentence as the model generates the spokenReply.
// Returns a promise resolving with the full result payload from the `done` event.
export async function streamVoiceAgentInputMobile(payload = {}, onChunk) {
  const token = getDeviceToken();
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  });
  if (token) headers.set('X-Pairing-Token', token);
  const body = JSON.stringify({
    ...(payload || {}),
    transcript: String(payload?.userInterruptionTranscript || payload?.transcript || '').trim(),
    source: String(payload?.source || 'mobile_voice_agent'),
    stream: true,
  });
  const res = await fetch(_buildUrl('/api/voice-agent/input'), { method: 'POST', headers, body });
  if (res.status === 401 && token) {
    clearDeviceToken();
    window.dispatchEvent(new Event('pm-device-revoked'));
    throw new Error('HTTP 401');
  }
  if (!res.ok || !res.body) throw new Error(`Voice agent stream failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let finalResult = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      let p = null;
      try { p = JSON.parse(json); } catch { continue; }
      if (!p || typeof p !== 'object') continue;
      if (p.type === 'chunk' && p.text) {
        try { onChunk?.(String(p.text)); } catch {}
      } else if (p.type === 'done') {
        finalResult = p.result || null;
      } else if (p.type === 'error') {
        throw new Error(String(p.error || 'voice-agent stream error'));
      }
    }
  }
  return finalResult || {};
}

/* ---------------- helpers ---------------- */

function fmtDate(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch { return null; }
}

function pickColor(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('brain')) return 'purple';
  if (n.includes('signal') || n.includes('radar') && n.includes('collector')) return 'green';
  if (n.includes('weekly') || n.includes('radar')) return 'orange';
  if (n.includes('telegram') || n.includes('chat')) return 'blue';
  return 'orange';
}

function pickEmoji(job) {
  const id = String(job.id || '').toLowerCase();
  const name = String(job.name || '').toLowerCase();
  if (id === 'brain_thought' || name.includes('thought')) return '🧠';
  if (id === 'brain_dream'   || name.includes('dream'))   return '💤';
  if (name.includes('collector') || name.includes('signal')) return '📡';
  if (name.includes('radar') || name.includes('opportunity')) return '🎯';
  if (name.includes('standup') || name.includes('team'))   return '🏠';
  return '⏰';
}

/* ---------------- schedules ---------------- */

function _normalizeBrainJob(job, kind) {
  if (!job) return null;
  const enabled = job.enabled !== false;
  const running = job.running === true;
  const isThought = kind === 'thought';
  return {
    id: isThought ? 'brain_thought' : 'brain_dream',
    kind: 'brain',
    brainType: kind,
    emoji: isThought ? '🧠' : '💤',
    name: isThought ? 'Brain Thought' : 'Brain Dream',
    color: 'purple',
    status: running ? 'running' : (enabled ? 'active' : 'disabled'),
    builtin: true,
    enabled,
    description: isThought
      ? 'Observes the last 6h of activity and writes a reflection.'
      : 'Nightly synthesis plus a second-pass memory cleanup 30m later.',
    next: fmtDate(job.nextRun) || '—',
    last: fmtDate(job.lastRun) || 'Never',
    footLeft: isThought ? 'Every 6 hours' : 'Nightly at 23:30 local, cleanup about 30m later',
    footRight: isThought
      ? (job.todayCount !== undefined ? `Thoughts today: ${job.todayCount}` : '')
      : (job.ranTonight ? 'Dream ran tonight: yes' : 'Dream ran tonight: not yet'),
  };
}

function _normalizeCronJob(job) {
  const enabled = job.enabled !== false;
  const running = job.status === 'running';
  const subagentId = String(job.subagent_id || job.subagentId || '').trim() || null;
  const cron = String(job.cron || job.run_at || job.pattern || '').trim();
  return {
    id: job.id,
    kind: 'cron',
    emoji: pickEmoji(job),
    name: job.name || 'Schedule',
    color: pickColor(job.name),
    status: running ? 'running' : (enabled ? 'active' : 'disabled'),
    builtin: false,
    enabled,
    description: String(job.prompt || job.description || '').slice(0, 160),
    next: fmtDate(job.next_run || job.nextRun) || '—',
    last: fmtDate(job.last_run || job.lastRun) || 'Never',
    assignedTo: subagentId,
    cron,
    timezone: job.timezone || 'UTC',
    prompt: String(job.prompt || ''),
    deliveryChannel: job.delivery_channel || job.deliveryChannel || 'web',
    skillIds: Array.isArray(job.skillIds) ? job.skillIds.map(id => String(id || '').trim()).filter(Boolean) : [],
    contextRefs: Array.isArray(job.context_refs)
      ? job.context_refs
      : (Array.isArray(job.contextReferences) ? job.contextReferences : []),
    raw: job,
    footLeft: '',
    footRight: '',
  };
}

export async function loadMobileSchedules({ force = false } = {}) {
  const cached = !force ? getCachedMobilePageData('schedules', 21_600_000) : null;
  if (cached) return cached;
  return _coalesceMobilePageRequest('schedules', async () => {
  const [schedResult, brainResult] = await Promise.all([
    api('/api/schedules').catch(() => null),
    api('/api/brain/status').catch(() => null),
  ]);

  if (!schedResult && !brainResult) {
    const fallback = getCachedMobilePageData('schedules', 86_400_000);
    if (fallback) return fallback;
  }

  const items = [];
  if (brainResult?.success) {
    const t = _normalizeBrainJob(brainResult.thought, 'thought');
    const d = _normalizeBrainJob(brainResult.dream,   'dream');
    if (t) items.push(t);
    if (d) items.push(d);
  }
  if (schedResult?.success && Array.isArray(schedResult.schedules)) {
    for (const job of schedResult.schedules) items.push(_normalizeCronJob(job));
  }
  return _saveMobilePageData('schedules', items);
  });
}

export async function toggleSchedule(item, nextEnabled) {
  if (item.kind === 'brain') {
    const body = item.brainType === 'thought'
      ? { thoughtEnabled: !!nextEnabled }
      : { dreamEnabled:   !!nextEnabled };
    const result = await api('/api/brain/config', { method: 'PATCH', body: JSON.stringify(body) });
    _invalidateMobilePageData('schedules');
    return result;
  }
  const result = await api(`/api/schedules/${encodeURIComponent(item.id)}`, {
    method: 'PATCH', body: JSON.stringify({ enabled: !!nextEnabled }),
  });
  _invalidateMobilePageData('schedules');
  return result;
}

export async function runScheduleNow(item) {
  if (item.kind === 'brain') {
    return api('/api/brain/run', {
      method: 'POST', body: JSON.stringify({ type: item.brainType }),
    });
  }
  return api(`/api/schedules/${encodeURIComponent(item.id)}/run`, { method: 'POST' });
}

export async function updateMobileSchedule(item, fields) {
  if (!item || item.kind !== 'cron') throw new Error('This schedule cannot be edited here');
  const result = await api(`/api/schedules/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    body: JSON.stringify(fields || {}),
  });
  _invalidateMobilePageData('schedules');
  return result;
}

/* ---------------- teams ---------------- */

const MEMBER_COLORS = ['#2fae66','#c8851f','#d8473a','#a06bd6','#4a82d1','#ea6a1f'];
const MEMBER_AVATARS = ['🤖','👹','🍄','✨','🎯','🛰️'];

let _teamsCache = { at: 0, list: null };

async function _fetchTeamsList(force = false) {
  if (!force && _teamsCache.list && Date.now() - _teamsCache.at < 10_000) return _teamsCache.list;
  const diskCached = !force ? getCachedMobilePageData('teams_raw', 21_600_000) : null;
  if (diskCached) {
    _teamsCache = { at: Date.now(), list: diskCached };
    return diskCached;
  }
  const r = await _coalesceMobilePageRequest('teams_raw', () => api('/api/teams')).catch(() => null);
  if (!r?.success) {
    const fallback = getCachedMobilePageData('teams_raw', 86_400_000);
    if (fallback) return fallback;
  }
  const list = (r?.success && Array.isArray(r.teams)) ? r.teams : [];
  _teamsCache = { at: Date.now(), list };
  return _saveMobilePageData('teams_raw', list);
}

export function invalidateTeamsCache() {
  _teamsCache = { at: 0, list: null };
  _invalidateMobilePageData('teams_raw');
}

export async function loadMobileTeams({ force = false } = {}) {
  const list = await _fetchTeamsList(force);
  return list.map((t, i) => ({
    id: t.id,
    name: t.name || t.id,
    agents: Array.isArray(t.subagentIds) ? t.subagentIds.length : 0,
    house: i % 2 === 1 ? 'blue' : 'brown',
    featured: i === 0,
    emoji: t.emoji || '🏠',
  }));
}

function _normalizeTeam(t) {
  if (!t) return null;
  const subagentIds = Array.isArray(t.subagentIds) ? t.subagentIds : [];
  const purpose = String(t.purpose || t.mission || t.teamContext || t.description || '').trim();
  const currentTask = String(t.currentFocus || t.currentTask || '').trim();
  return {
    id: t.id,
    name: t.name || t.id,
    emoji: t.emoji || '🏠',
    subagents: subagentIds.length,
    totalRuns: t.totalRuns || 0,
    runsDone: t.recentRunsDone ?? Math.min(t.totalRuns || 0, 7),
    runsTotal: t.recentRunsTotal ?? 7,
    paused: t.manager?.paused === true,
    members: [
      { id: 'manager', name: 'Manager', color: '#7d6bd6', avatar: '🧠' },
      ...subagentIds.slice(0, 5).map((id, i) => ({
        id,
        name: id.length > 14 ? id.slice(0, 12) + '…' : id,
        color: MEMBER_COLORS[i % MEMBER_COLORS.length],
        avatar: MEMBER_AVATARS[i % MEMBER_AVATARS.length],
      })),
    ],
    purpose:     purpose || 'No purpose set yet.',
    currentTask: currentTask || 'No current task.',
    lastRun:     fmtDate(t.lastRunAt || t.manager?.lastReviewAt) || 'Never',
    memberStates: 'No member state updates yet.',
    dispatches:   'No active dispatches.',
    workspace:    t.workspaceFileCount ? `${t.workspaceFileCount} files` : 'No workspace files yet.',
  };
}

export async function loadMobileTeamDetail(teamId, { force = false } = {}) {
  const list = await _fetchTeamsList(force);
  return _normalizeTeam(list.find(t => t.id === teamId));
}

export async function startTeamRun(teamId) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/start`, { method: 'POST' });
}
export async function pauseTeam(teamId) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/pause`, { method: 'POST' });
}
export async function resumeTeam(teamId) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/resume`, { method: 'POST' });
}
export async function triggerTeamReview(teamId) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/manager/trigger`, { method: 'POST' });
}
export async function deleteTeam(teamId) {
  return api(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
}
export async function loadTeamRoomState(teamId) {
  const r = await api(`/api/teams/${encodeURIComponent(teamId)}/room-state`).catch(() => null);
  if (!r?.success) return null;
  return r.roomState || null;
}

export async function loadTeamRuns(teamId, limit = 30) {
  const r = await api(`/api/teams/${encodeURIComponent(teamId)}/runs?limit=${limit}`).catch(() => null);
  if (!r?.success) return { runs: [], roomState: null };
  return { runs: Array.isArray(r.runs) ? r.runs : [], roomState: r.roomState || null };
}

export async function loadTeamChat(teamId, limit = 80) {
  const r = await mfetch(`/api/teams/${encodeURIComponent(teamId)}/chat?limit=${limit}`, { timeoutMs: 12000 });
  if (!r?.success) throw new Error(r?.error || 'Failed to load team chat');
  return Array.isArray(r.messages) ? r.messages : [];
}

export async function postTeamChat(teamId, text) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message: text, role: 'user' }),
  });
}

export async function loadTeamChatStreamReplay(teamId, after = 0) {
  const qs = Number(after || 0) > 0 ? `?after=${encodeURIComponent(Math.floor(Number(after)))}` : '';
  const r = await mfetch(`/api/teams/${encodeURIComponent(teamId)}/chat/stream${qs}`, { timeoutMs: 12000 }).catch(() => null);
  if (!r?.success) return { active: false, stream: null, events: [] };
  return {
    active: r.active === true,
    stream: r.stream || null,
    events: Array.isArray(r.events) ? r.events : [],
  };
}

export function streamTeamChat(teamId, { message, signal }, handlers = {}) {
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  const url = (API || '') + `/api/teams/${encodeURIComponent(teamId)}/chat/stream`;
  const cb = (name, ...args) => { try { handlers[name]?.(...args); } catch (e) { console.error('[team stream]', name, e); } };
  const toChatStreamError = (err) => {
    if (err?.name === 'AbortError') return err;
    const raw = String(err?.message || err || '').trim();
    const normalized = new Error(/terminated|load failed|failed to fetch|networkerror/i.test(raw)
      ? 'Connection dropped. The team may still be working; reopening this chat will recover the latest state.'
      : (raw || 'Team chat stream failed.'));
    normalized.cause = err;
    normalized.mobileStreamDisconnected = /terminated|load failed|failed to fetch|networkerror/i.test(raw);
    return normalized;
  };

  (async () => {
    let res;
    try {
      const connectingEvent = { type: 'ui_preflight', message: 'Connecting to Prometheus...' };
      cb('onEvent', connectingEvent);
      cb('onInfo', connectingEvent.message);
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(getDeviceToken() ? { 'X-Pairing-Token': getDeviceToken() } : {}),
        },
        body: JSON.stringify({ message }),
        signal: ctrl.signal,
      });
    } catch (err) {
      cb('onError', toChatStreamError(err));
      cb('onDone');
      return;
    }
    if (!res.ok || !res.body) {
      cb('onError', new Error(`Team chat HTTP ${res.status}`));
      cb('onDone');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let gotFinal = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
          if (!dataLines.length) continue;
          let evt; try { evt = JSON.parse(dataLines.join('\n')); } catch { continue; }
          cb('onEvent', evt);
          switch (evt.type) {
            case 'token':          if (evt.text) cb('onToken', String(evt.text)); break;
            case 'thinking_delta': if (evt.thinking || evt.text) cb('onThinking', String(evt.thinking || evt.text), { source: String(evt.source || '') }); break;
            case 'thinking':
            case 'agent_thought': {
              const thought = String(evt.thinking || evt.text || '').trim();
              if (thought) cb('onThought', thought, evt);
              break;
            }
            case 'info':
            case 'heartbeat':      if (evt.message || evt.state) cb('onInfo', String(evt.message || evt.state)); break;
            case 'progress_state': cb('onProgressState', evt); break;
            case 'tool_call':      cb('onToolCall', evt); break;
            case 'tool_result':    cb('onToolResult', evt); break;
            case 'tool_progress':  cb('onToolProgress', evt); break;
            case 'final':          gotFinal = true; cb('onFinal', String(evt.text || evt.reply || ''), evt); break;
            case 'done':
              if (!gotFinal && evt.reply) cb('onFinal', String(evt.reply), evt);
              cb('onDone');
              return;
            case 'error':
              cb('onError', new Error(String(evt.message || 'Team chat error')));
              cb('onDone');
              return;
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') cb('onError', toChatStreamError(err));
    } finally {
      cb('onDone');
    }
  })();

  return { abort: () => ctrl.abort() };
}

/* ---------------- workspace / memory / tasks / voice ---------------- */

export async function loadTeamWorkspace(teamId) {
  const r = await api(`/api/teams/${encodeURIComponent(teamId)}/workspace`).catch(() => null);
  if (!r?.success) return { files: [], tree: null, workspacePath: '' };
  return { files: r.files || [], tree: r.tree || null, workspacePath: r.workspacePath || '' };
}

export async function loadTeamWorkspaceFile(teamId, relpath) {
  const filename = encodeURIComponent(relpath.split('/').pop() || 'file');
  return api(`/api/teams/${encodeURIComponent(teamId)}/workspace/${filename}?relpath=${encodeURIComponent(relpath)}`);
}

export async function loadMemoryGraph() {
  return api('/api/memory/graph').catch(() => null);
}

/* ---------------- subagents ---------------- */

const SUBAGENT_AVATARS = ['🤖', '🛸', '🦊', '🐙', '🐍', '🐺', '🦉', '🦅', '🐉', '🦄'];
const SUBAGENT_COLORS = ['#ea6a1f', '#7d6bd6', '#3aa3ff', '#19a062', '#d8473a', '#c08ddc', '#0d4faf', '#f0a85e'];

function _subagentAvatarFor(id, idx) {
  const key = String(id || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  const a = SUBAGENT_AVATARS[Math.abs(h) % SUBAGENT_AVATARS.length];
  const c = SUBAGENT_COLORS[(Math.abs(h) + (idx || 0)) % SUBAGENT_COLORS.length];
  return { avatar: a, color: c };
}

function _subagentStatus(agent) {
  if (agent?.lastRun?.inProgress) return 'running';
  if (agent?.isTeamMember) return 'team';
  if (agent?.cronSchedule) return 'scheduled';
  if (agent?.lastRun?.finishedAt) return 'idle';
  return 'idle';
}

export async function loadMobileSubagents({ force = false } = {}) {
  const cached = !force ? getCachedMobilePageData('subagents', 21_600_000) : null;
  if (cached) return cached;
  const r = await _coalesceMobilePageRequest('subagents', () => api('/api/agents', { timeoutMs: 8000 })).catch(() => null);
  if (!r) {
    const fallback = getCachedMobilePageData('subagents', 86_400_000);
    if (fallback) return fallback;
  }
  const rawAgents = Array.isArray(r?.agents) ? r.agents : [];
  // Match desktop: hide default and synthetic shells; show team members with a badge instead.
  const agents = rawAgents.filter(a => !a.default && !a.isSynthetic);
  const normalized = agents.map((a, idx) => {
    const { avatar, color } = _subagentAvatarFor(a.id, idx);
    return {
      id: a.id,
      name: a.name || a.id,
      description: String(a.description || '').trim(),
      model: a.model || '',
      effectiveModel: a.effectiveModel || '',
      effectiveModelSource: a.effectiveModelSource || '',
      avatar,
      color,
      status: _subagentStatus(a),
      lastRunAt: a.lastRun?.finishedAt || a.lastRun?.startedAt || null,
      isTeamMember: a.isTeamMember === true,
      cronSchedule: a.cronSchedule || null,
      voice: (a.voice && typeof a.voice === 'object') ? a.voice : null,
      tools: Array.isArray(a.allowed_tools) ? a.allowed_tools : [],
      mcpServers: Array.isArray(a.mcp_servers) ? a.mcp_servers : [],
      raw: a,
    };
  });
  return _saveMobilePageData('subagents', normalized);
}

export async function loadMobileSubagentDetail(agentId, { force = false } = {}) {
  const list = await loadMobileSubagents({ force });
  return list.find(a => a.id === agentId) || null;
}

export async function loadSubagentSystemPrompt(agentId) {
  const r = await api(`/api/agents/${encodeURIComponent(agentId)}/agent-md`).catch(() => null);
  return String(r?.content || '');
}

export async function loadSubagentHeartbeat(agentId) {
  const [status, md] = await Promise.all([
    api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}`).catch(() => null),
    api(`/api/agents/${encodeURIComponent(agentId)}/heartbeat-md`).catch(() => null),
  ]);
  return {
    status: status || null,
    markdown: String(md?.content || ''),
  };
}

export async function tickSubagentHeartbeat(agentId) {
  return api(`/api/heartbeat/agents/${encodeURIComponent(agentId)}/tick`, { method: 'POST' });
}

export async function loadSubagentRuns(agentId, limit = 30) {
  const r = await api(`/api/agents/${encodeURIComponent(agentId)}/runs?limit=${limit}`).catch(() => null);
  return Array.isArray(r?.runs) ? r.runs : [];
}

export async function loadSubagentRunDetail(agentId, taskId) {
  return api(`/api/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(taskId)}`);
}

export async function sendSubagentRunRecovery(agentId, taskId, message, attachmentPreviews = []) {
  return api(`/api/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(taskId)}/recovery`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      attachmentPreviews: Array.isArray(attachmentPreviews) ? attachmentPreviews : [],
    }),
    timeoutMs: 300000,
  });
}

export async function loadSubagentChat(agentId, limit = 100) {
  const r = await api(`/api/agents/${encodeURIComponent(agentId)}/chat?limit=${limit}`).catch(() => null);
  return Array.isArray(r?.messages) ? r.messages : [];
}

export async function loadSubagentChatStreamReplay(agentId, after = 0) {
  const qs = Number(after || 0) > 0 ? `?after=${encodeURIComponent(Math.floor(Number(after)))}` : '';
  const r = await api(`/api/agents/${encodeURIComponent(agentId)}/chat/stream${qs}`).catch(() => null);
  if (!r?.success) return { active: false, stream: null, events: [] };
  return {
    active: r.active === true,
    stream: r.stream || null,
    events: Array.isArray(r.events) ? r.events : [],
  };
}

export async function loadSubagentContextRefs(agentId) {
  const r = await api(`/api/agents/${encodeURIComponent(agentId)}/context-refs`).catch(() => null);
  return Array.isArray(r?.refs) ? r.refs : [];
}

export async function spawnSubagentTask(agentId, task, timeoutMs = 180000) {
  return api(`/api/agents/${encodeURIComponent(agentId)}/spawn`, {
    method: 'POST',
    body: JSON.stringify({ task, timeoutMs }),
  });
}

// POST /api/agents/{id}/chat/stream — streams SSE events. Mirrors `streamChat()` shape.
export function streamSubagentChat(agentId, { message, signal, ...extra }, handlers = {}) {
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  const url = (API || '') + `/api/agents/${encodeURIComponent(agentId)}/chat/stream`;
  const cb = (name, ...args) => { try { handlers[name]?.(...args); } catch (e) { console.error('[subagent stream]', name, e); } };
  let activeRuntimeId = '';
  let streamFinished = false;
  const finishOnce = () => {
    if (streamFinished) return;
    streamFinished = true;
    cb('onDone');
  };

  (async () => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(getDeviceToken() ? { 'X-Pairing-Token': getDeviceToken() } : {}),
        },
        body: JSON.stringify({ message, timeoutMs: 300000, ...(extra || {}) }),
        signal: ctrl.signal,
      });
    } catch (err) {
      cb('onError', err);
      finishOnce();
      return;
    }
    if (!res.ok || !res.body) {
      let detail = '';
      try {
        const raw = await res.text();
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            detail = parsed?.error || parsed?.message || raw;
          } catch {
            detail = raw;
          }
        }
      } catch {}
      cb('onError', new Error(detail ? `Chat HTTP ${res.status}: ${detail}` : `Chat HTTP ${res.status}`));
      finishOnce();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let gotFinal = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data: ')) continue;
          let evt; try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt?.type === 'runtime_registered' && evt.runtimeId) activeRuntimeId = String(evt.runtimeId);
          cb('onEvent', evt);
          switch (evt.type) {
            case 'token':         if (evt.text) cb('onToken', String(evt.text)); break;
            case 'thinking_delta':if (evt.thinking || evt.text) cb('onThinking', String(evt.thinking || evt.text), { source: String(evt.source || '') }); break;
            case 'thinking':
            case 'agent_thought': {
              const thought = String(evt.thinking || evt.text || '').trim();
              if (thought) cb('onThought', thought, evt);
              break;
            }
            case 'info':
            case 'heartbeat':     if (evt.message) cb('onInfo', String(evt.message)); break;
            case 'voice_milestone': if (evt.text) cb('onVoiceMilestone', evt); break;
            case 'tool_call':     cb('onToolCall', evt); break;
            case 'tool_result':   cb('onToolResult', evt); break;
            case 'final':         gotFinal = true; cb('onFinal', String(evt.text || evt.content || ''), evt); break;
            case 'done':
              if (!gotFinal && evt.reply) cb('onFinal', String(evt.reply), evt);
              finishOnce(); return;
            case 'error':         cb('onError', new Error(String(evt.message || 'Chat error'))); finishOnce(); return;
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') cb('onError', err);
    } finally {
      finishOnce();
    }
  })();

  return {
    abort: () => {
      const runtimeId = String(activeRuntimeId || '').trim();
      if (runtimeId) {
        mfetch('/api/mobile/commands/stop', {
          method: 'POST',
          body: JSON.stringify({ id: runtimeId, source: 'mobile_subagent_stream_abort' }),
        }).catch(() => {});
      }
      ctrl.abort();
    },
  };
}

function _withTimeout(promise, fallback, timeoutMs = 3500) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function _nonMainAuditEntry(e) {
  const aid = String(e?.agentId || '').toLowerCase();
  if (aid && aid !== 'main' && aid !== 'unknown') return true;
  const sid = String(e?.sessionId || '');
  return /^(team_|task_|bg_|proposal_|cron_|schedule_|meta_)/i.test(sid);
}

function _titleCaseRun(value) {
  return String(value || 'Agent Run')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function _agentNameFromAudit(entry) {
  const aid = String(entry?.agentId || '').trim();
  if (aid && aid.toLowerCase() !== 'main' && aid.toLowerCase() !== 'unknown') return aid;
  const sid = String(entry?.sessionId || '').trim();
  if (sid.startsWith('team_dispatch_')) return sid.replace(/^team_dispatch_/, '').replace(/_\d+$/, '');
  if (sid.startsWith('team_coord_')) return sid.replace(/^team_coord_/, '').replace(/_\d+$/, '');
  if (sid.startsWith('meta_coordinator_')) return sid.replace(/^meta_coordinator_/, '').replace(/_\d+$/, '');
  if (sid.startsWith('proposal_')) return 'proposal_executor';
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_')) return 'scheduled_task';
  if (sid.startsWith('task_') || sid.startsWith('bg_')) return 'background_task';
  return aid || sid || 'agent';
}

function _runKindFromAudit(entry) {
  const sid = String(entry?.sessionId || '');
  const aid = String(entry?.agentId || '');
  if (sid.startsWith('brain_dream_')) return 'Brain Dream';
  if (sid.startsWith('brain_thought_')) return 'Brain Thought';
  if (sid.startsWith('brain_')) return 'Brain Run';
  if (sid.startsWith('team_dispatch_')) return `Subagent: ${_titleCaseRun(sid.replace(/^team_dispatch_/, '').replace(/_\d+$/, ''))}`;
  if (sid.startsWith('team_coord_')) return `${_titleCaseRun(sid.replace(/^team_coord_/, '').replace(/_\d+$/, ''))} Team Manager`;
  if (sid.startsWith('meta_coordinator_')) return `${_titleCaseRun(sid.replace(/^meta_coordinator_/, '').replace(/_\d+$/, ''))} Meta Coordinator`;
  if (sid.startsWith('proposal_')) return 'Proposal';
  if (sid.startsWith('cron_job_') || sid.startsWith('schedule_') || aid === 'scheduled_task') return 'Scheduled Task';
  if (sid.startsWith('task_') || sid.startsWith('bg_') || aid === 'background_task') return 'Background Task';
  if (aid === 'team_coordinator') return 'Team Manager';
  if (aid === 'meta_coordinator') return 'Meta Coordinator';
  return 'Agent Run';
}

function _auditRunStatus(tools) {
  const list = Array.isArray(tools) ? tools : [];
  if (list.some((t) => String(t?.approvalStatus || '').toLowerCase() === 'pending')) return 'running';
  if (list.some((t) => String(t?.approvalStatus || '').toLowerCase() === 'rejected' || t?.error)) return 'failed';
  return 'complete';
}

function _groupAuditRuns(entries) {
  const runs = new Map();
  for (const entry of (Array.isArray(entries) ? entries : []).filter(_nonMainAuditEntry)) {
    const sid = String(entry?.sessionId || '').trim();
    const key = sid || `${_agentNameFromAudit(entry)}:${String(entry?.timestamp || '').slice(0, 13)}`;
    if (!runs.has(key)) {
      runs.set(key, {
        key,
        sessionId: sid,
        agentId: _agentNameFromAudit(entry),
        kind: _runKindFromAudit(entry),
        startedAt: entry?.timestamp || '',
        endedAt: entry?.timestamp || '',
        tools: [],
      });
    }
    const run = runs.get(key);
    run.tools.push(entry);
    if (entry?.timestamp && (!run.startedAt || entry.timestamp < run.startedAt)) run.startedAt = entry.timestamp;
    if (entry?.timestamp && (!run.endedAt || entry.timestamp > run.endedAt)) run.endedAt = entry.timestamp;
  }
  return [...runs.values()]
    .map((run) => ({
      ...run,
      status: _auditRunStatus(run.tools),
      lastTool: run.tools.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]?.toolName || '',
    }))
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
}

function _isRegularChatMemoryNode(node) {
  const text = `${node?.id || ''} ${node?.sourceType || ''} ${node?.sourcePath || ''} ${node?.label || ''}`.toLowerCase();
  if (/memory\/files|memory_note|note|file|document|workspace|skill|project/.test(text)) return false;
  return /\b(chat|session|conversation|transcript)\b/.test(text) || /audit\/chats|sessions\//.test(text);
}

function _recentMemoryItems(graph, limit = 3) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  return nodes
    .filter((node) => !_isRegularChatMemoryNode(node))
    .sort((a, b) => Date.parse(b?.timestamp || 0) - Date.parse(a?.timestamp || 0))
    .slice(0, limit)
    .map((node) => ({
      id: String(node?.id || ''),
      title: String(node?.label || node?.title || node?.sourcePath || 'Memory'),
      type: String(node?.sourceTypeLabel || node?.sourceType || 'Memory'),
      sourcePath: String(node?.sourcePath || ''),
      timestamp: String(node?.timestamp || ''),
      summary: String(node?.summary || ''),
      degree: Number(node?.degree || 0),
    }));
}

export async function loadMobileMoreSummary() {
  const [models, tools, goals, audit, memory] = await Promise.all([
    _withTimeout(api('/api/hub/models/overview?range=all', { timeoutMs: 4500 }), null, 4800),
    _withTimeout(api('/api/hub/tools/overview?range=30d', { timeoutMs: 4500 }), null, 4800),
    _withTimeout(api('/api/hub/goals', { timeoutMs: 3500 }), null, 3800),
    _withTimeout(api('/api/audit-log?limit=80&offset=0&nonMainOnly=1', { timeoutMs: 4500 }), null, 4800),
    _withTimeout(api('/api/memory/graph', { timeoutMs: 3000 }).catch(() => null), null, 3300),
  ]);
  const goalList = Array.isArray(goals?.goals) ? goals.goals.slice() : [];
  goalList.sort((a, b) => Date.parse(b?.updatedAt || b?.completedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.completedAt || a?.createdAt || 0));
  const auditRuns = _groupAuditRuns(audit?.entries || []);
  return {
    hub: {
      models: models?.stats || {},
      tools: tools?.stats || {},
      latestGoal: goalList[0] || null,
      goalsCount: goalList.length,
    },
    audit: { runs: auditRuns.slice(0, 3), total: auditRuns.length },
    memory: {
      stats: memory?.stats || { nodes: 0, edges: 0 },
      recent: _recentMemoryItems(memory, 3),
    },
  };
}

export async function loadMobileHubOverview() {
  const [models, tools, goals, skills, curator, tokenActivity] = await Promise.all([
    _withTimeout(api('/api/hub/models/overview?range=all', { timeoutMs: 7000 }), null, 7300),
    _withTimeout(api('/api/hub/tools/overview?range=30d', { timeoutMs: 7000 }), null, 7300),
    _withTimeout(api('/api/hub/goals', { timeoutMs: 4500 }), null, 4800),
    _withTimeout(api('/api/hub/skills/usage?range=month', { timeoutMs: 7000 }), null, 7300),
    _withTimeout(api('/api/hub/skills/review', { timeoutMs: 7000 }), null, 7300),
    _withTimeout(api('/api/hub/tokens/activity', { timeoutMs: 7000 }), null, 7300),
  ]);
  const goalList = Array.isArray(goals?.goals) ? goals.goals.slice() : [];
  goalList.sort((a, b) => Date.parse(b?.updatedAt || b?.completedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.completedAt || a?.createdAt || 0));
  return {
    models: models?.stats || {},
    modelDaily: Array.isArray(models?.daily) ? models.daily : [],
    topModels: Array.isArray(models?.topModels) ? models.topModels : [],
    tools: tools?.stats || {},
    toolDaily: Array.isArray(tools?.daily) ? tools.daily : [],
    topTools: Array.isArray(tools?.topTools) ? tools.topTools : [],
    tokenActivity: {
      daily: Array.isArray(tokenActivity?.daily) ? tokenActivity.daily : [],
      stats: tokenActivity?.stats || {},
    },
    goals: goalList,
    goalCounts: goals?.counts || {},
    skills: Array.isArray(skills?.skills) ? skills.skills : [],
    curator: {
      suggestions: Array.isArray(curator?.suggestions) ? curator.suggestions : [],
      activity: Array.isArray(curator?.activity) ? curator.activity : [],
      pending: Number(curator?.pending || 0),
      quarantined: Number(curator?.quarantined || 0),
      appliedActivity: Number(curator?.appliedActivity || 0),
      observedActivity: Number(curator?.observedActivity || 0),
    },
  };
}

export async function applyMobileSkillCuratorSuggestion(id) {
  return api(`/api/hub/skills/review/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 30000,
  });
}

export async function denyMobileSkillCuratorSuggestion(id) {
  return api(`/api/hub/skills/review/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 30000,
  });
}

export async function loadMobileAuditRuns(limit = 100) {
  const safeLimit = Math.max(20, Math.min(300, Math.floor(Number(limit) || 100)));
  const audit = await api(`/api/audit-log?limit=${encodeURIComponent(safeLimit)}&offset=0&nonMainOnly=1`, { timeoutMs: 7000 });
  return _groupAuditRuns(audit?.entries || []);
}

export async function loadMobileMemoryOverview() {
  const graph = await loadMemoryGraph();
  return {
    stats: graph?.stats || { nodes: 0, edges: 0 },
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
    recent: _recentMemoryItems(graph, 30),
  };
}

export async function loadMobileProposals(status = 'pending') {
  const filter = String(status || 'pending');
  const r = await api(`/api/proposals?status=${encodeURIComponent(filter)}`);
  return r?.success && Array.isArray(r.proposals) ? r.proposals : [];
}

export async function loadMobileProposal(id) {
  return api(`/api/proposals/${encodeURIComponent(id)}`);
}

export async function approveMobileProposal(id) {
  return api(`/api/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: '{}',
  });
}

export async function denyMobileProposal(id) {
  return api(`/api/proposals/${encodeURIComponent(id)}/deny`, {
    method: 'POST',
    body: '{}',
  });
}

export async function loadBgTasks({ force = false } = {}) {
  const cached = !force ? getCachedMobilePageData('tasks', 8_000) : null;
  if (cached) return cached;
  return _coalesceMobilePageRequest('tasks', async () => {
    const r = await api('/api/bg-tasks?mobile=1', { timeoutMs: 9000 });
    if (!r?.success || !Array.isArray(r.tasks)) throw new Error(r?.error || 'Invalid tasks response');
    return _saveMobilePageData('tasks', r.tasks);
  });
}

export function prefetchMobileSecondaryPages() {
  return Promise.allSettled([
    loadBgTasks({ force: true }),
    loadMobileSchedules({ force: true }),
    loadMobileTeams({ force: true }),
    loadMobileSubagents({ force: true }),
  ]);
}

export async function loadBgTaskDetail(taskId) {
  return api(`/api/bg-tasks/${encodeURIComponent(taskId)}`);
}

export async function loadBgTaskEvidence(taskId) {
  const r = await api(`/api/bg-tasks/${encodeURIComponent(taskId)}/evidence`).catch(() => null);
  return r?.success && Array.isArray(r.entries) ? r.entries : [];
}

export async function sendBgTaskMessage(taskId, message) {
  return api(`/api/bg-tasks/${encodeURIComponent(taskId)}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function runBgTaskAction(taskId, action) {
  if (action === 'delete') {
    return api(`/api/bg-tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
  }
  return api(`/api/bg-tasks/${encodeURIComponent(taskId)}/${encodeURIComponent(action)}`, {
    method: 'POST',
  });
}

export async function loadVoiceStatus() {
  const [realtime, voice, creds] = await Promise.all([
    mfetch('/api/realtime/status').catch(() => null),
    mfetch('/api/voice/status').catch(() => null),
    mfetch('/api/settings/credentialed-model-providers').catch(() => null),
  ]);
  return {
    realtime: realtime || { configured: false },
    voice: voice || { sttProviders: [], ttsProviders: [] },
    providers: creds?.providers || creds?.ids || [],
  };
}

export async function transcribeVoiceAudio({ provider, audioBase64, mimeType, filename, language }) {
  return mfetch('/api/voice/stt', {
    method: 'POST',
    body: JSON.stringify({ provider, audioBase64, mimeType, filename, language }),
  });
}

export async function synthesizeVoiceAudio({ provider, text, voice, voiceId, language, speed, delivery }) {
  return mfetch('/api/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ provider, text, voice, voiceId, language, speed, delivery }),
  });
}

export async function loadVoiceVoices(provider) {
  const id = String(provider || '').trim();
  if (!id) return { voices: [] };
  return mfetch(`/api/voice/voices?provider=${encodeURIComponent(id)}`);
}

export async function saveTeamContextReference(teamId, title, body) {
  return api(`/api/teams/${encodeURIComponent(teamId)}/context-references`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

/* ---------------- chat (SSE streaming) ---------------- */

export const MOBILE_CHAT_SESSION_ID = 'mobile_default';

export function createMobileChatSessionId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `mobile_${Date.now().toString(36)}_${rand}`;
}

function _normalizeSessionSummary(s) {
  return {
    id: String(s?.id || '').trim(),
    channel: String(s?.channel || 'web').trim() || 'web',
    title: String(s?.title || s?.preview || s?.id || 'New chat').trim() || 'New chat',
    preview: String(s?.preview || s?.title || '').trim(),
    messageCount: Number(s?.messageCount || 0),
    createdAt: Number(s?.createdAt || Date.now()),
    lastMessageAt: Number(s?.lastMessageAt || s?.lastActiveAt || s?.updatedAt || s?.createdAt || Date.now()),
    lastActiveAt: Number(s?.lastActiveAt || s?.updatedAt || Date.now()),
    lastAssistantAt: Number(s?.lastAssistantAt || 0) || null,
    mobileLastReadAt: Number(s?.mobileLastReadAt || 0) || null,
    mobileUnread: s?.mobileUnread === true,
    activeRun: s?.activeRun === true,
  };
}

export async function createMobileChatSession(sessionId, { title = 'New Chat' } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('Session id required');
  return mfetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ id: sid, channel: 'mobile', title }),
  });
}

const MOBILE_SESSION_PAGE_SIZE = 20;
const MOBILE_SESSION_CHANNELS = [
  { key: 'web', label: 'Computer' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'discord', label: 'Discord' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'terminal', label: 'CLI' },
];

function _normalizeSessionPageResponse(r, { channel = '', limit = MOBILE_SESSION_PAGE_SIZE, offset = 0 } = {}) {
  const sessions = Array.isArray(r?.sessions) ? r.sessions.map(_normalizeSessionSummary).filter(s => s.id) : [];
  const safeLimit = Math.max(1, Math.floor(Number(r?.limit || limit) || limit));
  const safeOffset = Math.max(0, Math.floor(Number(r?.offset || offset) || offset));
  const total = Math.max(safeOffset + sessions.length, Math.floor(Number(r?.total || sessions.length) || sessions.length));
  return {
    channel: String(channel || '').trim(),
    sessions,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: r?.hasMore === true || safeOffset + sessions.length < total,
  };
}

export async function loadMobileSessionPage({ channel = 'mobile', limit = MOBILE_SESSION_PAGE_SIZE, offset = 0 } = {}) {
  const requestedChannel = String(channel || 'mobile');
  const requestedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || MOBILE_SESSION_PAGE_SIZE)));
  const requestedOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const params = new URLSearchParams({
    channel: requestedChannel,
    limit: String(requestedLimit),
    offset: String(requestedOffset),
  });
  // Scheduled-task threads are shared system-owned sessions, but on the mobile
  // surface they belong in the primary chat list instead of Computer chats.
  if (requestedChannel === 'mobile') {
    params.set('includeAutomated', '1');
  }
  const r = await mfetch(`/api/sessions?${params.toString()}`);
  return _normalizeSessionPageResponse(r, { channel: requestedChannel, limit: requestedLimit, offset: requestedOffset });
}

export async function loadMobileSessionGroups(options = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || MOBILE_SESSION_PAGE_SIZE)));
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const channel = String(options.channel || 'mobile');
  const page = await loadMobileSessionPage({ channel, limit, offset });
  return {
    mobile: channel === 'mobile' ? page.sessions : [],
    mobilePage: channel === 'mobile' ? page : _normalizeSessionPageResponse(null, { channel: 'mobile', limit, offset: 0 }),
    channels: MOBILE_SESSION_CHANNELS.map((entry) => ({
      ...entry,
      sessions: entry.key === channel ? page.sessions : [],
      total: entry.key === channel ? page.total : 0,
      hasMore: entry.key === channel ? page.hasMore : false,
      limit,
      offset: entry.key === channel ? page.offset : 0,
    })),
    pageSize: limit,
    activePage: page,
    activeChannel: channel,
  };
}
loadMobileSessionGroups.loadPage = loadMobileSessionPage;


export async function searchMobileChatSessions(query, { limit = 100 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, limit: String(limit) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let r;
  try {
    r = await mfetch(`/api/sessions/search?${params.toString()}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  return Array.isArray(r?.sessions) ? r.sessions.map(_normalizeSessionSummary).filter(s => s.id).map((s, idx) => {
    const raw = r.sessions[idx] || {};
    return {
      ...s,
      matchedRole: String(raw.matchedRole || ''),
      matchedContent: String(raw.matchedContent || ''),
      matchedIndex: Number.isFinite(Number(raw.matchedIndex)) ? Number(raw.matchedIndex) : -1,
      projectName: String(raw.projectName || ''),
    };
  }) : [];
}

export async function loadLatestUsableSession() {
  const r = await mfetch('/api/sessions').catch(() => ({ sessions: [] }));
  const sessions = Array.isArray(r?.sessions) ? r.sessions.map(_normalizeSessionSummary).filter(s => s.id) : [];
  return sessions
    .filter(s => s.channel !== 'system')
    .filter(s => !/^(brain_|subagent_chat_|cron_|task_|auto_)/i.test(s.id))
    .filter(s => Number(s.messageCount || 0) > 0)
    .sort((a, b) => Number(b.lastMessageAt || b.lastActiveAt || 0) - Number(a.lastMessageAt || a.lastActiveAt || 0))[0] || null;
}

// ── Session cache (30s TTL, invalidated on history writes) ────────────────────
const _sessionCache = new Map(); // sessionId → { session, expiresAt }
const _sessionRequests = new Map(); // `${sessionId}:${detail}` → in-flight Promise
const _SESSION_CACHE_TTL = 30_000; // ms

function _sessionCacheGet(sid) {
  const entry = _sessionCache.get(sid);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _sessionCache.delete(sid); return null; }
  return entry.session;
}

function _sessionCacheSet(sid, session) {
  _sessionCache.set(sid, { session, expiresAt: Date.now() + _SESSION_CACHE_TTL });
  // Evict oldest entries if cache grows large (keep ≤ 20)
  if (_sessionCache.size > 20) {
    const oldest = _sessionCache.keys().next().value;
    _sessionCache.delete(oldest);
  }
}

export function invalidateMobileChatSessionCache(sessionId) {
  if (sessionId) _sessionCache.delete(String(sessionId));
  else _sessionCache.clear();
}

export async function loadMobileChatSession(sessionId, { force = false } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  if (!force) {
    const cached = _sessionCacheGet(sid);
    if (cached) return cached;
  }
  const requestKey = `${sid}:${force ? 'recovery' : 'normal'}`;
  const existingRequest = _sessionRequests.get(requestKey);
  if (existingRequest) return existingRequest;
  const historyLimit = force ? 180 : 70;
  const processLimit = force ? 500 : 120;
  const request = mfetch(`/api/sessions/${encodeURIComponent(sid)}?mobile=1&historyLimit=${historyLimit}&processLimit=${processLimit}&includeToolLog=0${force ? '&fullProcess=1&_fresh=1' : ''}`, {
    timeoutMs: force ? 30000 : 20000,
  }).then((r) => {
    const session = r?.session || null;
    if (session) _sessionCacheSet(sid, session);
    return session;
  }).finally(() => {
    if (_sessionRequests.get(requestKey) === request) _sessionRequests.delete(requestKey);
  });
  _sessionRequests.set(requestKey, request);
  return request;
}


export async function loadMobileChatRunStatuses() {
  return mfetch('/api/mobile/chat/runs');
}

export async function markMobileChatSessionRead(sessionId, readAt = Date.now()) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return mfetch(`/api/sessions/${encodeURIComponent(sid)}/mobile-read`, {
    method: 'POST',
    body: JSON.stringify({ readAt }),
  });
}

export async function loadMobileChatRunStatus(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return mfetch(`/api/mobile/chat/runs/${encodeURIComponent(sid)}`);
}

export async function updateMobileChatSessionHistory(sessionId, history = [], options = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('Session id required');
  invalidateMobileChatSessionCache(sid); // stale after write
  return mfetch(`/api/sessions/${encodeURIComponent(sid)}/history`, {
    method: 'POST',
    body: JSON.stringify({
      history: Array.isArray(history) ? history : [],
      resetCompaction: options.resetCompaction === true,
      origin: {
        channel: 'mobile',
        surface: 'mobile_app',
        device: 'phone',
        source: 'mobile_history_sync',
      },
    }),
  });
}

export async function markMobileEditRerunReset(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  return mfetch(`/api/sessions/${encodeURIComponent(sid)}/edit-rerun-reset`, { method: 'POST' });
}

export async function loadMobileChatStreamReplay(sessionId, after = 0) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const seq = Math.max(0, Math.floor(Number(after || 0)) || 0);
  const qs = seq ? `?after=${encodeURIComponent(seq)}` : '';
  return mfetch(`/api/mobile/chat/stream/${encodeURIComponent(sid)}${qs}`);
}

export async function loadMobileBackgroundStatuses(sessionId = '') {
  const sid = String(sessionId || '').trim();
  const qs = sid ? `?sessionId=${encodeURIComponent(sid)}` : '';
  return mfetch(`/api/background${qs}`);
}

export async function loadMobileBackgroundStatus(backgroundId) {
  const id = String(backgroundId || '').trim();
  if (!id) return null;
  return mfetch(`/api/background/${encodeURIComponent(id)}/status`);
}

export async function loadGatewayStatus(opts = {}) {
  const timeoutMs = Math.max(5000, Math.floor(Number(opts.timeoutMs || 30000) || 30000));
  return mfetch('/api/status', { method: 'GET', timeoutMs });
}

export async function loadMobileCommandModels() {
  return mfetch('/api/mobile/commands/models');
}

export async function loadMobileStopTargets() {
  return mfetch('/api/mobile/commands/stop-targets');
}

export async function loadMobileWorkspaceFiles(root = '') {
  const qs = new URLSearchParams();
  if (root) qs.set('root', root);
  qs.set('shallow', '1');
  return mfetch(`/api/canvas/files?${qs.toString()}`);
}

/* ---------------- creative ---------------- */

// GET a workspace file (images returned as base64).
export async function loadCanvasFile(relPath) {
  return mfetch(`/api/canvas/file?path=${encodeURIComponent(relPath)}`);
}

function appendPairingQuery(url) {
  const token = getDeviceToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}pt=${encodeURIComponent(token)}`;
}

// Live HTML/JS/CSS assets under a workspace project (correct base URL for relative paths).
export function buildWorkspaceCanvasUrl(relPath) {
  const path = String(relPath || '').trim().replace(/^\/+/, '');
  if (!path) return '';
  const base = String(API || '').replace(/\/+$/, '');
  const segments = path.split('/').map(encodeURIComponent).join('/');
  const url = appendPairingQuery(`${base}/api/canvas/workspace/${segments}`);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}pmcv=${Date.now().toString(36)}`;
}

// Build an authenticated streaming URL for <video src> / <img src>.
// Canvas routes accept the paired-device token via `?pt=<token>` (iframes/media cannot set headers).
export function buildInlineMediaUrl(relPath) {
  if (!relPath) return '';
  const base = String(API || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ path: relPath });
  return appendPairingQuery(`${base}/api/canvas/inline?${qs.toString()}`);
}

export function buildDownloadMediaUrl(relPath) {
  if (!relPath) return '';
  const base = String(API || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ path: relPath });
  return appendPairingQuery(`${base}/api/canvas/download?${qs.toString()}`);
}

// Resolve a workspace-relative path to a base64 data URL for <img src>.
export async function loadCanvasImageDataUrl(relPath) {
  try {
    const r = await loadCanvasFile(relPath);
    if (r?.success && r.isImage && r.base64 && r.mimeType) {
      return `data:${r.mimeType};base64,${r.base64}`;
    }
  } catch {}
  return '';
}

// Kick off the multi-stage extract-layers pipeline. Server streams progress via
// the `creative_extract_layers_progress` WebSocket event (subscribe through
// window.wsEventBus); this promise resolves with the final scene.
export async function creativeExtractLayers({ sessionId, source, mode = 'balanced', prompt = '', requestId = '', saveLayerAssets = false, layerAssetBatchName = '' } = {}) {
  return mfetch('/api/canvas/creative-extract-layers', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: sessionId || MOBILE_CHAT_SESSION_ID,
      source,
      mode,
      prompt: prompt || undefined,
      requestId: requestId || undefined,
      saveLayerAssets: saveLayerAssets === true,
      autoSaveLayerAssets: saveLayerAssets === true,
      layerAssetBatchName: layerAssetBatchName || undefined,
      textEditable: true,
      extractObjects: true,
      preserveOriginal: true,
      copySource: true,
      useVision: true,
      useOcr: false,
      useSam: true,
      inpaintBackground: true,
      vectorTraceShapes: true,
    }),
  });
}

// List generated media for the gallery. Returns an array of { name, path, kind }.
export async function loadCreativeGallery({ kind = 'image' } = {}) {
  const root = kind === 'video' ? 'generated/videos' : 'generated/images';
  try {
    const r = await mfetch(`/api/canvas/files?root=${encodeURIComponent(root)}`);
    const flat = [];
    const walk = (nodes) => {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (n?.type === 'file' && n?.path) {
          flat.push({
            name: n.name || n.path.split('/').pop(),
            path: n.path,
            relPath: n.path,
            size: n.size || 0,
            mtime: n.mtime || 0,
          });
        }
        if (Array.isArray(n?.children)) walk(n.children);
      }
    };
    walk(r?.files || []);
    flat.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return flat;
  } catch {
    return [];
  }
}

export async function loadMobileFileScreenshot(path) {
  return mfetch(`/api/preview/screenshot?path=${encodeURIComponent(path)}`);
}

export async function stopMobileMainChat(sessionId, options = {}) {
  const body = { sessionId };
  if (options && typeof options === 'object') {
    if (options.runtimeId) body.runtimeId = String(options.runtimeId);
    if (options.source) body.source = String(options.source);
  } else if (typeof options === 'string' && options) {
    body.source = options;
  }
  return mfetch('/api/mobile/commands/stop-now', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function stopMobileRuntime(id, options = {}) {
  const body = { id };
  if (options && typeof options === 'object' && options.source) body.source = String(options.source);
  return mfetch('/api/mobile/commands/stop', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function runMobileScreenshotCommand({ sessionId, target = 'desktop', id = '' } = {}) {
  return mfetch('/api/mobile/commands/screenshot', {
    method: 'POST',
    body: JSON.stringify({ sessionId, target, id }),
  });
}

export async function restartMobileGateway({ rebuild = false, sessionId = '', origin = null } = {}) {
  try {
    const sid = String(sessionId || '').trim();
    return await mfetch('/api/lifecycle/restart', {
      method: 'POST',
      headers: sid ? { 'X-Prometheus-Session-Id': sid } : undefined,
      body: JSON.stringify({
        rebuild: rebuild === true,
        sessionId: sid,
        previousSessionId: sid,
        origin: origin || {
          channel: 'mobile',
          surface: 'mobile_app',
          device: 'phone',
          source: 'mobile_slash_command',
        },
      }),
    });
  } catch (err) {
    const message = rebuild === true
      ? 'Full build + restart was requested. Prometheus may disconnect while the gateway rebuilds.'
      : 'Quick restart was requested. Prometheus may disconnect for a moment.';
    return { ok: true, rebuild: rebuild === true, message, reconnecting: true };
  }
}

/**
 * POST /api/chat and stream back SSE events.
 *
 * Calls handlers as events arrive:
 *   - onToken(text)       — incremental text chunk
 *   - onThinking(text, meta?) — incremental reasoning chunk (optional; meta.source may be reasoning_summary)
 *   - onThought(text)     — complete thought block (thinking / agent_thought)
 *   - onInfo(message)     — progress info line
 *   - onFinal(text)       — final assistant text (single string)
 *   - onError(err)        — fatal error
 *   - onDone()            — turn complete
 *
 * Returns an { abort } controller.
 */
export function streamChat({ message, sessionId = MOBILE_CHAT_SESSION_ID, attachments, attachmentPreviews, signal, callerContext, clientRequestId, excludedSkillIds, selectedSkillIds }, handlers = {}) {
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

  const url = (API || '') + '/api/chat';
  const cb = (name, ...args) => { try { handlers[name]?.(...args); } catch (e) { console.error('[mobile chat handler]', name, e); } };
  const toChatStreamError = (err) => {
    if (err?.name === 'AbortError') return err;
    const raw = String(err?.message || err || '').trim();
    const disconnected = /terminated|load failed|failed to fetch|networkerror|stream ended before completion/i.test(raw);
    const message = disconnected
      ? 'Connection dropped. Prometheus may still be working — reopen this chat and I’ll recover the latest result automatically.'
      : (raw || 'Mobile chat stream failed.');
    const normalized = new Error(message);
    normalized.cause = err;
    normalized.mobileStreamDisconnected = disconnected;
    return normalized;
  };

  (async () => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(getDeviceToken() ? { 'X-Pairing-Token': getDeviceToken() } : {}),
        },
        body: JSON.stringify({
          message,
          sessionId,
          clientRequestId: typeof clientRequestId === 'string' && clientRequestId.trim() ? clientRequestId.trim() : undefined,
          origin: {
            channel: 'mobile',
            surface: 'mobile_app',
            device: 'phone',
            label: 'Mobile app',
            source: 'mobile_web_ui',
          },
          attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
          attachmentPreviews: Array.isArray(attachmentPreviews) && attachmentPreviews.length ? attachmentPreviews : undefined,
          callerContext: typeof callerContext === 'string' && callerContext.trim() ? callerContext.trim() : undefined,
          excludedSkillIds: Array.isArray(excludedSkillIds) && excludedSkillIds.length ? excludedSkillIds : undefined,
          selectedSkillIds: Array.isArray(selectedSkillIds) && selectedSkillIds.length ? selectedSkillIds : undefined,
        }),
        signal: ctrl.signal,
      });
    } catch (err) {
      cb('onError', toChatStreamError(err));
      cb('onDone');
      return;
    }

    if (!res.ok || !res.body) {
      const body = await res.text?.().catch(() => '') || '';
      cb('onError', new Error(`Chat HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`));
      cb('onDone');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let gotFinal = false;
    let gotDone = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE: events are separated by blank lines. Each event has data: lines.
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
          if (!dataLines.length) continue;
          const json = dataLines.join('\n');
          let evt; try { evt = JSON.parse(json); } catch { continue; }
          cb('onEvent', evt);
          switch (evt.type) {
            case 'token':         if (evt.text)     cb('onToken', String(evt.text)); break;
            case 'thinking_delta':if (evt.thinking || evt.text) cb('onThinking', String(evt.thinking || evt.text), { source: String(evt.source || '') }); break;
            case 'thinking':
            case 'agent_thought': {
              const thought = String(evt.thinking || evt.text || '').trim();
              if (thought) cb('onThought', thought, evt);
              break;
            }
            case 'info':          if (evt.message)  cb('onInfo', String(evt.message)); break;
            case 'ui_preflight':  if (evt.message)  cb('onInfo', String(evt.message)); break;
            case 'voice_milestone': if (evt.text) cb('onVoiceMilestone', evt); break;
            case 'tool_call':     cb('onToolCall', evt); break;
            case 'tool_result':   cb('onToolResult', evt); break;
            case 'tool_progress': cb('onToolProgress', evt); break;
            case 'canvas_present':cb('onCanvasPresent', evt); break;
            case 'model_stream_event':
              cb('onModelEvent', evt);
              break;
            case 'model_switched':
            case 'main_model_changed':
            case 'model_reverted':
              cb('onModelEvent', evt);
              break;
            case 'final':         gotFinal = true; cb('onFinal', String(evt.text || ''), evt); break;
            case 'done':
              gotDone = true;
              if (!gotFinal && evt.reply) cb('onFinal', String(evt.reply), evt);
              cb('onDone'); return;
            case 'error':         cb('onError', new Error(String(evt.message || 'Chat error'))); cb('onDone'); return;
          }
        }
      }
      if (!gotDone && !gotFinal && !ctrl.signal.aborted) {
        cb('onError', toChatStreamError(new Error('stream ended before completion')));
      }
    } catch (err) {
      if (err.name === 'AbortError') { cb('onDone'); return; }
      // A final frame is the durable answer. Some mobile browsers report a
      // transport error while the server is closing an otherwise-complete SSE
      // response; surfacing that late error would replace the answer with the
      // recovery UI even though nothing remains to recover.
      if (!gotFinal) cb('onError', toChatStreamError(err));
    } finally {
      cb('onDone');
    }
  })();

  return { abort: () => ctrl.abort() };
}
