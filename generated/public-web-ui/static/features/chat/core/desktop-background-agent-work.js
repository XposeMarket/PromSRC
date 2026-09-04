const BACKGROUND_AGENT_WORK_PERSIST_DEBOUNCE_MS = 750;

export function createDesktopBackgroundAgentWork({
  mergeBackgroundAgentEvents,
  mergeBackgroundAgentTraceEntries,
  normalizeBackgroundAgentWork,
  readBackgroundAgentWork,
  writeBackgroundAgentWork,
} = {}) {
  let backgroundAgentWorkPersistTimer = null;
  let backgroundAgentWorkPersistPending = false;

  // The live gateway stream is ordered by sequence number. Keep that hot path
  // append-only and reserve the Map/sort merge for replayed or out-of-order data.
  function appendBackgroundAgentEvent(existing = [], incoming = {}) {
    const normalized = normalizeBackgroundAgentWork({
      id: '__event__',
      sessionId: '__event__',
      events: [incoming],
    })?.events?.[0];
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
    backgroundAgentWorkPersistTimer?.unref?.();
  }

  function flushBackgroundAgentWorkPersistence() {
    clearBackgroundAgentWorkPersistTimer();
    if (!backgroundAgentWorkPersistPending) return;
    backgroundAgentWorkPersistPending = false;
    return writeBackgroundAgentWork(readBackgroundAgentWork());
  }

  function persistBackgroundAgentWork(record = {}, options = {}) {
    const normalized = normalizeBackgroundAgentWork(record);
    if (!normalized) return null;
    const records = readBackgroundAgentWork();
    const index = records.findIndex((item) => item.id === normalized.id && item.sessionId === normalized.sessionId);
    if (index >= 0) {
      const previous = records[index];
      const previousLastSeq = Number(previous.lastSeq || 0);
      const normalizedLastSeq = Number(normalized.lastSeq || 0);
      const sameStream = Boolean(normalized.streamId)
        && normalized.streamId === String(previous.streamId || '').trim();
      const previousEvents = Array.isArray(previous.events) ? previous.events : [];
      const hasCompleteEventBuffer = normalized.events.length >= previousEvents.length;
      records[index] = {
        ...previous,
        ...normalized,
        events: sameStream && normalizedLastSeq > previousLastSeq && hasCompleteEventBuffer
          ? normalized.events.slice(-1200)
          : mergeBackgroundAgentEvents(previousEvents, normalized.events),
        liveTraceEntries: mergeBackgroundAgentTraceEntries(previous.liveTraceEntries, normalized.liveTraceEntries),
        steerMessages: normalized.steerMessages.length ? normalized.steerMessages : previous.steerMessages,
        backgroundSessionId: normalized.backgroundSessionId || previous.backgroundSessionId,
        streamId: normalized.streamId || previous.streamId,
        lastSeq: Math.max(previousLastSeq, normalizedLastSeq),
      };
    } else records.push({ ...normalized, events: mergeBackgroundAgentEvents([], normalized.events) });
    if (options.immediate === true) {
      backgroundAgentWorkPersistPending = true;
      flushBackgroundAgentWorkPersistence();
    } else scheduleBackgroundAgentWorkPersistence();
    return normalized;
  }

  if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', flushBackgroundAgentWorkPersistence);
  }

  return Object.freeze({ appendBackgroundAgentEvent, flushBackgroundAgentWorkPersistence, persistBackgroundAgentWork });
}
