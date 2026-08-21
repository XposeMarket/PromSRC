const BACKGROUND_AGENT_WORK_KEY = 'prometheus_background_agent_work_v1';

let backgroundAgentWorkCacheRaw = null;
let backgroundAgentWorkCache = null;

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
    || /^(?:background\s*spawn|background\s*agent|agent|subagent)$/i.test(String(value || '').trim());
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
    content,
    ...(extra && Object.keys(extra).length ? { extra } : {}),
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

export function normalizeBackgroundAgentWork(record = {}) {
  const id = String(record.id || record.bgId || record.backgroundId || record.agentId || '').trim();
  const sessionId = String(record.sessionId || record.spawnerSessionId || record.parentSessionId || '').trim();
  if (!id || !sessionId) return null;
  const status = String(record.status || record.state || 'completed').trim().toLowerCase();
  const updatedAt = Number(record.updatedAt || record.completedAt || record.workEndedAt || Date.now()) || Date.now();
  const terminal = ['completed', 'failed', 'timed_out'].includes(status);
  const completedAt = Number(record.completedAt || record.workEndedAt || 0) || (terminal ? updatedAt : 0);
  const stream = record.stream && typeof record.stream === 'object' ? record.stream : {};
  const events = (Array.isArray(record.events) ? record.events : Array.isArray(record.processEntries) ? record.processEntries : [])
    .map(normalizeBackgroundAgentEvent)
    .filter(Boolean);
  return {
    id,
    sessionId,
    agentName: String(record.agentName || record.name || '').trim(),
    agentColor: String(record.agentColor || record.color || '').trim(),
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
    events: mergeBackgroundAgentEvents([], events),
    steerMessages: (Array.isArray(record.steerMessages) ? record.steerMessages : Array.isArray(record.steers) ? record.steers : [])
      .map(normalizeBackgroundAgentSteer)
      .filter(Boolean)
      .slice(-80),
  };
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

function cacheBackgroundAgentWork(raw, records) {
  backgroundAgentWorkCacheRaw = raw;
  backgroundAgentWorkCache = records;
  return records;
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

export function persistBackgroundAgentWork(record = {}) {
  const normalized = normalizeBackgroundAgentWork(record);
  if (!normalized) return null;
  const records = readBackgroundAgentWork();
  const index = records.findIndex((item) => item.id === normalized.id && item.sessionId === normalized.sessionId);
  if (index >= 0) {
    records[index] = {
      ...records[index],
      ...normalized,
      events: mergeBackgroundAgentEvents(records[index].events, normalized.events),
      steerMessages: normalized.steerMessages.length ? normalized.steerMessages : records[index].steerMessages,
      streamId: normalized.streamId || records[index].streamId,
      lastSeq: Math.max(Number(records[index].lastSeq || 0), Number(normalized.lastSeq || 0)),
    };
  } else records.push(normalized);
  writeBackgroundAgentWork(records);
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
  const result = String(record.result || record.error || '').trim();
  return {
    role: 'ai',
    from: String(record.agentName || 'Background agent'),
    content: result,
    body: { sender: String(record.agentName || 'Background agent'), text: result },
    processEntries: Array.isArray(record.events) ? record.events.slice() : [],
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
