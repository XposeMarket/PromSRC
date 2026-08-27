const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 2_048;

function clean(value) {
  return String(value ?? '').trim();
}

function eventIdentity(event = {}) {
  const source = event && typeof event === 'object' ? event : {};
  const nested = source.data && typeof source.data === 'object' ? source.data : {};
  const eventId = clean(
    source.eventId
      || source.event_id
      || source.id
      || nested.eventId
      || nested.event_id
      || nested.id,
  );
  if (eventId) return `event:${eventId}`;
  const streamId = clean(source.streamId || source.stream_id || nested.streamId || nested.stream_id);
  const seq = Number(source.seq ?? nested.seq);
  if (streamId && Number.isFinite(seq) && seq > 0) return `stream:${streamId}:${Math.floor(seq)}`;
  return '';
}

export function mobileStreamEventIdentity(event = {}) {
  return eventIdentity(event);
}

/**
 * De-duplicates one logical chat frame delivered through multiple transports
 * (SSE, WebSocket, and replay). The ledger is intentionally in-memory and
 * short-lived: it protects reconnect races without becoming durable history.
 */
export function createMobileStreamReceiptLedger({
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  const sessions = new Map();
  const ttl = Math.max(10_000, Number(ttlMs) || DEFAULT_TTL_MS);
  const cap = Math.max(64, Math.floor(Number(maxEntries) || DEFAULT_MAX_ENTRIES));

  const prune = (state, timestamp) => {
    for (const [key, seenAt] of state.seen.entries()) {
      if (timestamp - seenAt > ttl) state.seen.delete(key);
    }
    while (state.seen.size > cap) {
      const oldest = state.seen.keys().next().value;
      if (!oldest) break;
      state.seen.delete(oldest);
    }
  };

  const stateFor = (sessionId) => {
    const sid = clean(sessionId);
    if (!sid) return null;
    let state = sessions.get(sid);
    if (!state) {
      state = { seen: new Map() };
      sessions.set(sid, state);
    }
    prune(state, Number(now()) || Date.now());
    return state;
  };

  const has = (sessionId, event) => {
    const key = eventIdentity(event);
    if (!key) return false;
    const state = stateFor(sessionId);
    if (!state) return false;
    return state.seen.has(key);
  };

  const accept = (sessionId, event) => {
    const key = eventIdentity(event);
    if (!key) return true;
    const state = stateFor(sessionId);
    if (!state) return true;
    if (state.seen.has(key)) return false;
    state.seen.set(key, Number(now()) || Date.now());
    prune(state, Number(now()) || Date.now());
    return true;
  };

  const clear = (sessionId) => {
    const sid = clean(sessionId);
    if (sid) sessions.delete(sid);
    else sessions.clear();
  };

  return Object.freeze({ accept, clear, has, keyFor: eventIdentity });
}
