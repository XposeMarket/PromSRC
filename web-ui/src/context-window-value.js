function nonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

const CONTEXT_WINDOW_CACHE_KEY = 'prometheus.context-window-cache.v1';
const CONTEXT_WINDOW_CACHE_MAX_ENTRIES = 48;
const CONTEXT_WINDOW_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function finiteCacheNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : undefined;
}

function cacheStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function compactContextUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const compact = {};
  for (const key of ['usedTokens', 'capacityTokens', 'ratio', 'percent', 'progressPercent', 'overflowTokens']) {
    const value = finiteCacheNumber(usage[key]);
    if (value !== undefined) compact[key] = value;
  }
  if (typeof usage.status === 'string') compact.status = usage.status.slice(0, 32);
  return Object.keys(compact).length ? compact : undefined;
}

function compactContextRows(rows, depth = 0) {
  if (!Array.isArray(rows) || depth > 4) return [];
  return rows.slice(0, 80).map((row, index) => {
    if (!row || typeof row !== 'object') return null;
    const compact = {
      id: String(row.id || `row_${depth}_${index}`).slice(0, 120),
      label: String(row.label || 'Context').slice(0, 180),
      tokens: finiteCacheNumber(row.tokens) || 0,
      active: row.active !== false,
      includedInContext: row.includedInContext !== false,
    };
    for (const key of ['outOfBand', 'estimated']) {
      if (row[key] === true) compact[key] = true;
    }
    if (typeof row.percentBasis === 'string') compact.percentBasis = row.percentBasis.slice(0, 24);
    if (typeof row.percentLabel === 'string') compact.percentLabel = row.percentLabel.slice(0, 32);
    const children = compactContextRows(row.children, depth + 1);
    if (children.length) compact.children = children;
    return compact;
  }).filter(Boolean);
}

function compactContextWindowData(data) {
  if (!data || typeof data !== 'object' || data.success === false) return null;
  const currentState = data.currentState && typeof data.currentState === 'object' ? data.currentState : {};
  const compact = { success: true };
  const sessionId = String(data.sessionId || '').trim();
  if (sessionId) compact.sessionId = sessionId;
  for (const key of [
    'currentStateTokens',
    'currentInputTokens',
    'contextWindowTokens',
    'contextLimitTokens',
    'currentContextLimitTokens',
    'inputBudgetTokens',
    'compactionTriggerTokens',
  ]) {
    const value = finiteCacheNumber(data[key]);
    if (value !== undefined) compact[key] = value;
  }
  const currentStateTokens = finiteCacheNumber(data.currentStateTokens ?? currentState.currentStateTokens);
  if (currentStateTokens !== undefined) compact.currentStateTokens = currentStateTokens;
  const contextUsage = compactContextUsage(data.contextUsage || currentState.contextUsage);
  if (contextUsage) compact.contextUsage = contextUsage;
  compact.currentState = {
    ...(currentStateTokens !== undefined ? { currentStateTokens } : {}),
    ...(finiteCacheNumber(currentState.contextWindowTokens) !== undefined
      ? { contextWindowTokens: finiteCacheNumber(currentState.contextWindowTokens) }
      : {}),
    ...(finiteCacheNumber(currentState.contextLimitTokens) !== undefined
      ? { contextLimitTokens: finiteCacheNumber(currentState.contextLimitTokens) }
      : {}),
    ...(contextUsage ? { contextUsage } : {}),
    rows: compactContextRows(currentState.rows),
  };
  return compact;
}

function compactContextPressure(data) {
  if (!data || typeof data !== 'object' || data.success === false) return null;
  const pressureTokens = finiteCacheNumber(data.pressureTokens);
  const contextWindowTokens = finiteCacheNumber(data.contextWindowTokens);
  if (pressureTokens === undefined || contextWindowTokens === undefined || contextWindowTokens <= 0) return null;
  const compact = {
    success: true,
    pressureTokens,
    contextWindowTokens,
  };
  for (const key of ['compactionTriggerTokens', 'effectiveCompactionTriggerTokens']) {
    const value = finiteCacheNumber(data[key]);
    if (value !== undefined) compact[key] = value;
  }
  if (data.pendingCompaction === true) compact.pendingCompaction = true;
  if (data.atOrPastCompactionTrigger === true) compact.atOrPastCompactionTrigger = true;
  const usage = compactContextUsage(data.usage);
  if (usage) compact.usage = usage;
  return compact;
}

function readContextWindowCacheStore(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CONTEXT_WINDOW_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object'
      ? parsed
      : { version: 1, sessions: {} };
  } catch {
    return { version: 1, sessions: {} };
  }
}

/**
 * Read the last successful numeric context snapshot for a session. This is a
 * display cache only: it never participates in a model request and contains
 * no transcript or reasoning text. It lets the ring stay stable across a
 * short gateway restart or a page reload while the authoritative refresh
 * catches up.
 */
export function readContextWindowCache(sessionId) {
  const sid = String(sessionId || '').trim();
  const storage = cacheStorage();
  if (!sid || !storage) return null;
  const store = readContextWindowCacheStore(storage);
  const entry = store.sessions?.[sid];
  if (!entry || typeof entry !== 'object') return null;
  const savedAt = Number(entry.savedAt || 0);
  if (savedAt > 0 && Date.now() - savedAt > CONTEXT_WINDOW_CACHE_MAX_AGE_MS) return null;
  return {
    data: entry.data && typeof entry.data === 'object' ? entry.data : null,
    pressure: entry.pressure && typeof entry.pressure === 'object' ? entry.pressure : null,
    savedAt,
  };
}

/**
 * Persist only the bounded numeric/display shape needed to paint the context
 * ring and its already-safe breakdown labels. Best-effort by design: storage
 * quota/private-mode failures must never affect chat.
 */
export function writeContextWindowCache(sessionId, { data, pressure } = {}) {
  const sid = String(sessionId || '').trim();
  const storage = cacheStorage();
  if (!sid || !storage) return false;
  const compactData = compactContextWindowData(data);
  const compactPressure = compactContextPressure(pressure);
  if (!compactData && !compactPressure) return false;
  const store = readContextWindowCacheStore(storage);
  const previous = store.sessions?.[sid] && typeof store.sessions[sid] === 'object' ? store.sessions[sid] : {};
  const sessions = {
    ...(store.sessions || {}),
    [sid]: {
      ...previous,
      savedAt: Date.now(),
      ...(compactData ? { data: compactData } : {}),
      ...(compactPressure ? { pressure: compactPressure } : {}),
    },
  };
  const ordered = Object.entries(sessions)
    .sort(([, left], [, right]) => Number(right?.savedAt || 0) - Number(left?.savedAt || 0))
    .slice(0, CONTEXT_WINDOW_CACHE_MAX_ENTRIES);
  try {
    storage.setItem(CONTEXT_WINDOW_CACHE_KEY, JSON.stringify({ version: 1, sessions: Object.fromEntries(ordered) }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Select the active context total for a visible meter. The context-window
 * snapshot describes the bounded next model call, while pressure mirrors the
 * full active transcript used by the compaction gate. Either estimate may be
 * temporarily behind the other, so the visible gauge must retain the larger
 * value until an explicit compaction event resets both baselines.
 */
export function resolveActiveContextTokens({ currentStateTokens, pressureTokens, fallbackTokens } = {}) {
  const candidates = [currentStateTokens, pressureTokens, fallbackTokens]
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(nonNegativeFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}
