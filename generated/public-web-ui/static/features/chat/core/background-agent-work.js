const BACKGROUND_AGENT_WORK_KEY = 'prometheus_background_agent_work_v1';
const BACKGROUND_AGENT_WORK_PERSIST_DEBOUNCE_MS = 750;

let backgroundAgentWorkCacheRaw = null;
let backgroundAgentWorkCache = null;
let backgroundAgentWorkPersistTimer = null;
let backgroundAgentWorkPersistPending = false;

export const BACKGROUND_AGENT_NAMES = [
  'Atlas', 'Athena', 'Apollo', 'Artemis', 'Ares', 'Hermes',
  'Hera', 'Helios', 'Iris', 'Nyx', 'Orion', 'Daphne',
  'Mars', 'Venus', 'Juno', 'Minerva',
];

// This palette is intentionally fixed and high-contrast across the desktop
// preset skins and the mobile light/dark surfaces.
export const BACKGROUND_AGENT_COLORS = [
  '#1677d2', '#b52d68', '#8a6500', '#087a62',
  '#7147b8', '#b84d18', '#087f96', '#8a4d9e',
  '#3d7c1f', '#a13b3b', '#315da8', '#9a5a08',
  '#08706f', '#6b4a9f', '#a22c50', '#436b16',
];

function hashBackgroundAgent(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  return Math.abs(hash);
}

function isGenericBackgroundAgentName(value) {
  return !String(value || '').trim()
    || /^(?:undefined|null|background\s*spawn|background\s*agent|agent|subagent)$/i.test(String(value || '').trim());
}

export function resolveBackgroundAgentIdentity(id, options = {}) {
  const usedNames = new Set((Array.isArray(options.usedNames) ? options.usedNames : []).map((value) => String(value || '').trim()).filter(Boolean));
  const usedColors = new Set((Array.isArray(options.usedColors) ? options.usedColors : []).map((value) => String(value || '').trim()).filter(Boolean));
  const existingName = String(options.existingName || '').trim();
  const existingColor = String(options.existingColor || '').trim();
  const seed = hashBackgroundAgent(id);
  let name = !isGenericBackgroundAgentName(existingName) ? existingName : '';
  if (!name) {
    for (let offset = 0; offset < BACKGROUND_AGENT_NAMES.length; offset += 1) {
      const candidate = BACKGROUND_AGENT_NAMES[(seed + offset) % BACKGROUND_AGENT_NAMES.length];
      if (!usedNames.has(candidate)) {
        name = candidate;
        break;
      }
    }
    name ||= BACKGROUND_AGENT_NAMES[seed % BACKGROUND_AGENT_NAMES.length];
  }
  let color = existingColor || '';
  if (!color || usedColors.has(color)) {
    for (let offset = 0; offset < BACKGROUND_AGENT_COLORS.length; offset += 1) {
      const candidate = BACKGROUND_AGENT_COLORS[(seed + offset) % BACKGROUND_AGENT_COLORS.length];
      if (!usedColors.has(candidate)) {
        color = candidate;
        break;
      }
    }
    color ||= BACKGROUND_AGENT_COLORS[seed % BACKGROUND_AGENT_COLORS.length];
  }
  return { name, color };
}

export function normalizeBackgroundAgentEvent(event = {}) {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const source = { ...data, ...event };
  const content = String(source.content || source.text || source.message || source.reply || source.result || '').trim();
  if (!content && !source.type && !source.eventType) return null;
  const streamId = String(source.streamId || data.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(source.seq || data.seq || 0)) || 0);
  const eventId = String(source.id || source.eventId || data.eventId || (streamId && seq ? `background_trace_${streamId}_${seq}` : '')).trim();
  const extra = source.extra && typeof source.extra === 'object' ? source.extra : data;
  return {
    id: eventId || undefined,
    seq: seq || undefined,
    streamId: streamId || undefined,
    at: Number(source.at || data.at || 0) || undefined,
    ts: String(source.ts || source.time || '').trim(),
    type: String(source.type || source.eventType || 'info').trim(),
    actor: String(source.actor || '').trim(),
    text: content,
    content,
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  };
}

function normalizeBackgroundAgentTrace(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const text = String(entry.text || entry.content || entry.message || '').trim();
  if (!text && !entry.activity && !entry.preview) return null;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : null;
  const streamId = String(entry.streamId || extra?.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(entry.seq || extra?.seq || 0)) || 0);
  const id = String(entry.id || (streamId && seq ? `background_trace_${streamId}_${seq}` : '')).trim();
  return {
    ...entry,
    ...(id ? { id } : {}),
    type: String(entry.type || entry.kind || 'info').trim().toLowerCase(),
    ...(text ? { text } : {}),
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    time: String(entry.time || entry.ts || '').trim(),
  };
}

function normalizeBackgroundAgentSteer(message = {}) {
  const content = String(message.content || message.text || message.message || '').replace(/\s+/g, ' ').trim();
  if (!content) return null;
  const timestamp = Number(message.timestamp || message.createdAt || Date.now()) || Date.now();
  const id = String(message.id || `background_steer_${timestamp}_${hashBackgroundAgent(content)}`).trim();
  return {
    id,
    role: 'user',
    content,
    timestamp,
    channelLabel: 'steer',
    workflowGroupId: String(message.workflowGroupId || `chat_steer_background_${timestamp}`).trim(),
    workflowPart: 'interruption',
  };
}

export function normalizeBackgroundAgentWork(record = {}, options = {}) {
  const mergeEvents = options.mergeEvents !== false;
  const id = String(record.id || record.bgId || record.backgroundId || record.agentId || '').trim();
  const sessionId = String(record.sessionId || record.spawnerSessionId || record.parentSessionId || '').trim();
  if (!id || !sessionId) return null;
  const identity = resolveBackgroundAgentIdentity(id, {
    existingName: record.agentName || record.name,
    existingColor: record.agentColor || record.color,
  });
  const status = String(record.status || record.state || 'completed').trim().toLowerCase();
  const updatedAt = Number(record.updatedAt || record.completedAt || record.workEndedAt || Date.now()) || Date.now();
  const terminal = ['completed', 'failed', 'timed_out'].includes(status);
  const completedAt = Number(record.completedAt || record.workEndedAt || 0) || (terminal ? updatedAt : 0);
  const stream = record.stream && typeof record.stream === 'object' ? record.stream : {};
  const events = (Array.isArray(record.events) ? record.events : Array.isArray(record.processEntries) ? record.processEntries : [])
    .map(normalizeBackgroundAgentEvent)
    .filter(Boolean);
  const liveTraceEntries = mergeBackgroundAgentTraceEntries(
    [],
    Array.isArray(record.liveTraceEntries) ? record.liveTraceEntries : [],
  );
  return {
    id,
    sessionId,
    backgroundSessionId: String(record.backgroundSessionId || record.bgSessionId || '').trim(),
    agentName: identity.name,
    agentColor: identity.color,
    task: String(record.task || record.prompt || '').trim(),
    status,
    startedAt: Number(record.startedAt || record.workStartedAt || record.createdAt || 0) || 0,
    completedAt,
    updatedAt,
    result: String(record.result || '').trim(),
    error: String(record.error || '').trim(),
    fileChanges: record.fileChanges || null,
    streamId: String(record.streamId || stream.streamId || '').trim(),
    lastSeq: Math.max(0, Math.floor(Number(record.lastSeq || stream.lastSeq || 0)) || 0),
    events: mergeEvents ? mergeBackgroundAgentEvents([], events) : events.slice(-1200),
    liveTraceEntries,
    steerMessages: (Array.isArray(record.steerMessages) ? record.steerMessages : Array.isArray(record.steers) ? record.steers : [])
      .map(normalizeBackgroundAgentSteer)
      .filter(Boolean)
      .slice(-80),
  };
}

function backgroundAgentTraceKey(entry = {}) {
  const streamId = String(entry.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(entry.seq || 0)) || 0);
  if (streamId && seq) return `stream:${streamId}:${seq}`;
  const id = String(entry.id || '').trim();
  if (id) return `id:${id}`;
  return [
    String(entry.type || ''),
    String(entry.extra?.source || ''),
    String(entry.text || entry.content || '').replace(/\s+/g, ' ').trim(),
    String(entry.time || entry.ts || ''),
  ].join('|');
}

export function mergeBackgroundAgentTraceEntries(existing = [], incoming = []) {
  const byKey = new Map();
  const add = (entry) => {
    const normalized = normalizeBackgroundAgentTrace(entry);
    if (!normalized) return;
    const key = backgroundAgentTraceKey(normalized);
    const previous = byKey.get(key);
    byKey.set(key, previous
      ? { ...previous, ...normalized, extra: { ...(previous.extra || {}), ...(normalized.extra || {}) } }
      : normalized);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return Array.from(byKey.values())
    .sort((a, b) => {
      const aStream = String(a.streamId || '');
      const bStream = String(b.streamId || '');
      if (aStream && aStream === bStream && Number(a.seq || 0) !== Number(b.seq || 0)) return Number(a.seq || 0) - Number(b.seq || 0);
      if (aStream && !bStream) return -1;
      if (!aStream && bStream) return 1;
      return (Number(a.at || 0) || Date.parse(a.ts || '') || 0)
        - (Number(b.at || 0) || Date.parse(b.ts || '') || 0);
    })
    .slice(-500);
}

function backgroundAgentEventKey(event = {}) {
  const streamId = String(event.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(event.seq || 0)) || 0);
  if (streamId && seq) return `stream:${streamId}:${seq}`;
  const id = String(event.id || '').trim();
  if (id) return `id:${id}`;
  return [
    String(event.ts || event.at || ''),
    String(event.type || ''),
    String(event.actor || ''),
    String(event.content || ''),
  ].join('|');
}

export function mergeBackgroundAgentEvents(existing = [], incoming = []) {
  const byKey = new Map();
  const add = (event) => {
    const normalized = normalizeBackgroundAgentEvent(event);
    if (!normalized) return;
    const key = backgroundAgentEventKey(normalized);
    const previous = byKey.get(key);
    byKey.set(key, previous ? { ...previous, ...normalized, extra: { ...(previous.extra || {}), ...(normalized.extra || {}) } } : normalized);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return Array.from(byKey.values())
    .sort((a, b) => {
      const aStream = String(a.streamId || '');
      const bStream = String(b.streamId || '');
      if (aStream && aStream === bStream && Number(a.seq || 0) !== Number(b.seq || 0)) return Number(a.seq || 0) - Number(b.seq || 0);
      if (aStream && !bStream) return -1;
      if (!aStream && bStream) return 1;
      const aAt = Number(a.at || 0) || Date.parse(a.ts || '') || 0;
      const bAt = Number(b.at || 0) || Date.parse(b.ts || '') || 0;
      return aAt - bAt;
    })
    .slice(-1200);
}

// The live gateway stream is ordered by sequence number. Keep that hot path
// append-only and reserve the Map/sort merge for replayed or out-of-order data.
export function appendBackgroundAgentEvent(existing = [], incoming = {}) {
  const normalized = normalizeBackgroundAgentEvent(incoming);
  if (!normalized) return Array.isArray(existing) ? existing.slice() : [];
  const events = Array.isArray(existing) ? existing.slice() : [];
  const previous = events[events.length - 1];
  const streamId = String(normalized.streamId || '').trim();
  const seq = Number(normalized.seq || 0);
  const previousStreamId = String(previous?.streamId || '').trim();
  const previousSeq = Number(previous?.seq || 0);
  if (streamId && seq && (!previous || (previousStreamId === streamId && seq > previousSeq))) {
    events.push(normalized);
    return events.slice(-1200);
  }
  return mergeBackgroundAgentEvents(events, [normalized]);
}

function cacheBackgroundAgentWork(raw, records) {
  backgroundAgentWorkCacheRaw = raw;
  backgroundAgentWorkCache = records;
  return records;
}

function clearBackgroundAgentWorkPersistTimer() {
  if (backgroundAgentWorkPersistTimer === null) return;
  if (typeof clearTimeout === 'function') clearTimeout(backgroundAgentWorkPersistTimer);
  backgroundAgentWorkPersistTimer = null;
}

function scheduleBackgroundAgentWorkPersistence() {
  backgroundAgentWorkPersistPending = true;
  clearBackgroundAgentWorkPersistTimer();
  if (typeof setTimeout !== 'function') {
    flushBackgroundAgentWorkPersistence();
    return;
  }
  backgroundAgentWorkPersistTimer = setTimeout(() => {
    backgroundAgentWorkPersistTimer = null;
    flushBackgroundAgentWorkPersistence();
  }, BACKGROUND_AGENT_WORK_PERSIST_DEBOUNCE_MS);
  // A test/runtime process should not be kept alive solely by a pending UI
  // persistence write when the host exposes Node's timer handles.
  backgroundAgentWorkPersistTimer?.unref?.();
}

export function flushBackgroundAgentWorkPersistence() {
  clearBackgroundAgentWorkPersistTimer();
  if (!backgroundAgentWorkPersistPending) return Array.isArray(backgroundAgentWorkCache) ? backgroundAgentWorkCache : [];
  backgroundAgentWorkPersistPending = false;
  return writeBackgroundAgentWork(Array.isArray(backgroundAgentWorkCache) ? backgroundAgentWorkCache : []);
}

export function readBackgroundAgentWork() {
  try {
    const raw = localStorage.getItem(BACKGROUND_AGENT_WORK_KEY) || '[]';
    if (raw === backgroundAgentWorkCacheRaw && Array.isArray(backgroundAgentWorkCache)) {
      return backgroundAgentWorkCache;
    }
    const parsed = JSON.parse(raw);
    const normalized = Array.isArray(parsed) ? parsed.map(normalizeBackgroundAgentWork).filter(Boolean) : [];
    return cacheBackgroundAgentWork(raw, normalized);
  } catch {
    return cacheBackgroundAgentWork(null, []);
  }
}

export function writeBackgroundAgentWork(records = []) {
  clearBackgroundAgentWorkPersistTimer();
  backgroundAgentWorkPersistPending = false;
  try {
    const normalized = (Array.isArray(records) ? records : [])
      .map(normalizeBackgroundAgentWork)
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80);
    const raw = JSON.stringify(normalized);
    localStorage.setItem(BACKGROUND_AGENT_WORK_KEY, raw);
    return cacheBackgroundAgentWork(raw, normalized);
  } catch {
    return cacheBackgroundAgentWork(null, []);
  }
}

export function persistBackgroundAgentWork(record = {}, options = {}) {
  const normalized = normalizeBackgroundAgentWork(record, { mergeEvents: false });
  if (!normalized) return null;
  const records = readBackgroundAgentWork();
  const index = records.findIndex((item) => item.id === normalized.id && item.sessionId === normalized.sessionId);
  if (index >= 0) {
    const previous = records[index];
    const previousLastSeq = Number(previous.lastSeq || 0);
    const normalizedLastSeq = Number(normalized.lastSeq || 0);
    const sameStream = Boolean(normalized.streamId)
      && normalized.streamId === String(previous.streamId || '').trim();
    records[index] = {
      ...previous,
      ...normalized,
      // A monotonic stream update contains the complete bounded lane buffer;
      // replacing it avoids re-sorting up to 1,200 entries on every event.
      events: sameStream && normalizedLastSeq > previousLastSeq
        ? normalized.events.slice(-1200)
        : mergeBackgroundAgentEvents(previous.events, normalized.events),
      liveTraceEntries: mergeBackgroundAgentTraceEntries(previous.liveTraceEntries, normalized.liveTraceEntries),
      steerMessages: normalized.steerMessages.length ? normalized.steerMessages : previous.steerMessages,
      backgroundSessionId: normalized.backgroundSessionId || previous.backgroundSessionId,
      streamId: normalized.streamId || previous.streamId,
      lastSeq: Math.max(previousLastSeq, normalizedLastSeq),
    };
  } else {
    records.push({
      ...normalized,
      events: mergeBackgroundAgentEvents([], normalized.events),
    });
  }
  if (options.immediate === true) {
    backgroundAgentWorkPersistPending = true;
    flushBackgroundAgentWorkPersistence();
  } else scheduleBackgroundAgentWorkPersistence();
  return normalized;
}

export function backgroundAgentWorkForSession(sessionId = '') {
  const sid = String(sessionId || '').trim();
  return readBackgroundAgentWork()
    .filter((item) => !sid || item.sessionId === sid)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findBackgroundAgentWork(id = '', sessionId = '') {
  const cleanId = String(id || '').trim();
  const cleanSessionId = String(sessionId || '').trim();
  return readBackgroundAgentWork().find((item) => item.id === cleanId && (!cleanSessionId || item.sessionId === cleanSessionId)) || null;
}

export function backgroundAgentPreview(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
}

export function backgroundAgentAgeLabel(timestamp, now = Date.now()) {
  const age = Math.max(0, Number(now || Date.now()) - Number(timestamp || 0));
  if (!Number(timestamp) || age < 45_000) return 'just now';
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function backgroundAgentRecordToMessage(record = {}) {
  const identity = resolveBackgroundAgentIdentity(record.id, {
    existingName: record.agentName || record.name,
    existingColor: record.agentColor || record.color,
  });
  const agentName = identity.name || 'Background agent';
  const result = String(record.result || record.error || '').trim();
  return {
    role: 'ai',
    from: agentName,
    content: result,
    body: { sender: agentName, text: result },
    processEntries: Array.isArray(record.events) ? record.events.slice() : [],
    liveTraceEntries: Array.isArray(record.liveTraceEntries) ? record.liveTraceEntries.slice() : [],
    streaming: ['running', 'queued', 'in_progress'].includes(String(record.status || '').toLowerCase()),
    createdAt: Number(record.startedAt || Date.now()) || Date.now(),
    timestamp: Number(record.startedAt || Date.now()) || Date.now(),
    workStartedAt: Number(record.startedAt || Date.now()) || Date.now(),
    workEndedAt: Number(record.completedAt || 0) || undefined,
    workDurationMs: Number(record.completedAt || 0) && Number(record.startedAt || 0)
      ? Math.max(0, Number(record.completedAt) - Number(record.startedAt))
      : undefined,
  };
}

if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pagehide', flushBackgroundAgentWorkPersistence);
}
