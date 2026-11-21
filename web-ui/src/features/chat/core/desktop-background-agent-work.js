import { backgroundAgentFollowUpPromptMessage, backgroundAgentRecordToMessage, backgroundAgentRoundOf } from './background-agent-work.js';

const BACKGROUND_AGENT_WORK_PERSIST_DEBOUNCE_MS = 750;

/**
 * Desktop detail pane: earlier follow-up rounds rendered as one continuous
 * agent thread (each round's prompt, steers and answer), then the current
 * round's prompt. Desktop-only so it stays out of the mobile chat slice.
 */
export function backgroundAgentFollowUpThreadHistory(record, identity = {}, avatarHtml = '') {
  const history = [];
  (Array.isArray(record?.rounds) ? record.rounds : []).forEach((round) => {
    const prompt = round.round
      ? backgroundAgentFollowUpPromptMessage(round.prompt, { laneId: record.id, executionId: round.executionId, round: round.round, timestamp: round.startedAt })
      : null;
    if (prompt) history.push(prompt);
    (Array.isArray(round.steerMessages) ? round.steerMessages : []).forEach((steer) => {
      const content = String(steer?.content || '').trim();
      if (content) history.push({ role: 'user', content, timestamp: Number(steer.timestamp || 0) || Date.now(), channelLabel: 'steer', workflowGroupId: String(steer.workflowGroupId || `chat_steer_background_${round.executionId}`), workflowPart: 'interruption' });
    });
    history.push({
      ...backgroundAgentRecordToMessage({ ...round, id: record.id, agentName: identity.name, agentColor: identity.color, events: round.processEntries }),
      workflowLabel: identity.name,
      workflowAvatarHtml: avatarHtml,
      streaming: false,
    });
  });
  const current = backgroundAgentRoundOf(record)
    ? backgroundAgentFollowUpPromptMessage(record.roundPrompt, { laneId: record.id, executionId: record.executionId, round: record.followUpRound, timestamp: record.startedAt })
    : null;
  if (current) history.push(current);
  return history;
}

export function createDesktopBackgroundAgentWork({
  mergeBackgroundAgentEvents,
  mergeBackgroundAgentTraceEntries,
  mergeBackgroundAgentSteerMessages,
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
    const roundOf = (item) => Math.max(0, Math.floor(Number(item?.followUpRound || 0)) || 0);
    if (index >= 0 && roundOf(normalized) !== roundOf(records[index])) {
      // A follow-up round replaces per-round buffers; an older round's late
      // write never overwrites a newer one.
      if (roundOf(normalized) > roundOf(records[index])) records[index] = { ...normalized, events: normalized.events.slice(-1200) };
    } else if (index >= 0) {
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
        steerMessages: typeof mergeBackgroundAgentSteerMessages === 'function'
          ? mergeBackgroundAgentSteerMessages(previous.steerMessages, normalized.steerMessages)
          : (normalized.steerMessages.length ? normalized.steerMessages : previous.steerMessages),
        backgroundSessionId: normalized.backgroundSessionId || previous.backgroundSessionId,
        model: normalized.model || previous.model,
        providerId: normalized.providerId || previous.providerId,
        reasoningEffort: normalized.reasoningEffort || previous.reasoningEffort,
        plan: normalized.plan || previous.plan,
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
