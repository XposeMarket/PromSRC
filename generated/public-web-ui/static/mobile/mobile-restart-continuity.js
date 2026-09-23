// Mobile handling for a planned mid-turn gateway restart.
//
// A planned restart suspends the active turn rather than ending it: the
// replacement gateway resumes the same work under a new stream id. The UI
// contract is therefore "the turn hangs, then continues" — the assistant row,
// its tool trace, and the busy composer must survive the process swap.
//
// This lives outside mobile-chat-page-runtime.js so the restart contract is
// reviewable on its own and the page runtime stays under its module ceiling.

export const RESTART_CONTINUITY_FLAG = '_pmRestartContinuity';
export const RESTART_CONTINUITY_LABEL = 'Gateway restarting — turn will continue';

/** Drop any previously painted restart notice from an assistant turn. */
export function clearRestartContinuityStatus(turn) {
  if (!turn || !Array.isArray(turn.processEntries)) return;
  turn.processEntries = turn.processEntries.filter((entry) => entry?.[RESTART_CONTINUITY_FLAG] !== true
    && entry?.extra?.[RESTART_CONTINUITY_FLAG] !== true);
}

/**
 * True when recovery must keep treating the local streaming turn as live.
 *
 * A planned restart's durable checkpoint is not a completed turn, so the
 * streaming row must survive until the replacement stream reports in.
 *
 * `gatewayRestartContinuity` marks exactly that case, so it must *extend* the
 * hold rather than cancel it. Treating it as a release condition tore the
 * streaming row down the moment recovery noticed the restart checkpoint, and
 * the later `restart_continuity` resume arrived with no row left to reattach
 * to — the turn silently vanished until the next manual message forced a
 * history reload. `resolveRestartRecoveryMerge` below reads the same flag as a
 * preserve signal; both must agree.
 */
export function shouldHoldStreamingTurn({
  replayStillActive = false,
  localTurnStreaming = false,
  completedDurableTurn = false,
  gatewayRestartContinuity = false,
} = {}) {
  if (replayStillActive) return true;
  if (!localTurnStreaming) return false;
  // A planned restart outranks a "completed" durable read: the checkpoint that
  // marks the suspension can look terminal while the turn is still resuming.
  if (gatewayRestartContinuity) return true;
  return !completedDurableTurn;
}

/**
 * True when the remembered run is mid planned-restart suspension.
 *
 * A suspended run's dropped socket is expected, so callers must not surface it
 * as a chat error or reconnect toast.
 */
export function isRestartSuspendedRun(remembered) {
  return remembered?.restartSuspended === true;
}

/**
 * Decide how recovery should reconcile durable history with the local thread.
 *
 * A planned restart's durable acknowledgement completes the already-painted
 * restart row, so recovery must keep the pre-clear snapshot and preserve local
 * history instead of letting a "completed turn" read erase the live trace.
 */
export function resolveRestartRecoveryMerge({
  completedDurableTurn = false,
  gatewayRestartContinuity = false,
  localThread,
  localThreadBeforeClear,
  historyPageIsPartial = false,
  hasProtectedLocalContinuity = false,
} = {}) {
  return {
    thread: completedDurableTurn && !gatewayRestartContinuity ? localThread : localThreadBeforeClear,
    preserveLocalHistory: historyPageIsPartial
      || gatewayRestartContinuity
      || (!completedDurableTurn && hasProtectedLocalContinuity),
  };
}

/**
 * Own the reconnect banner for one mobile chat page.
 *
 * A planned restart is part of the active turn, so the global connection banner
 * would be false-alarm UI layered over an otherwise continuous row. Suppressing
 * it here keeps the "hanging turn" illusion intact while a genuine network drop
 * still surfaces normally.
 */
export function createReconnectStatusController(context = {}) {
  const {
    requestedSession,
    connectionStatus,
    readActiveRun,
    setChatConnectionStatus,
    setSuccessTimer,
    clearSuccessTimer,
  } = context;
  let wsReconnectPending = false;

  const hasPendingRestartContinuity = () => readActiveRun?.(requestedSession)?.restartSuspended === true;

  return {
    hasPendingRestartContinuity,
    isReconnectPending: () => wsReconnectPending,
    setReconnectPending: (value) => { wsReconnectPending = value === true; },
    showReconnectingStatus(msg = {}) {
      wsReconnectPending = true;
      if (hasPendingRestartContinuity()) return;
      const waitingForNetwork = String(msg?.type || '') === 'ws:waiting_for_network';
      setChatConnectionStatus?.(true, waitingForNetwork ? 'Waiting for network' : 'Reconnecting to Prometheus');
    },
    /** Own the ws reconnect-banner subscriptions; returns an unbind function. */
    bind(wsEventBus) {
      const show = (msg) => this.showReconnectingStatus(msg);
      const open = () => { wsReconnectPending = false; this.hideReconnectingStatus(); };
      const events = ['ws:reconnecting', 'ws:waiting_for_network', 'ws:timeout', 'ws:error'];
      for (const event of events) wsEventBus?.on?.(event, show);
      wsEventBus?.on?.('ws:open', open);
      return () => {
        for (const event of events) wsEventBus?.off?.(event, show);
        wsEventBus?.off?.('ws:open', open);
      };
    },
    hideReconnectingStatus() {
      if (wsReconnectPending) return;
      if (connectionStatus && !connectionStatus.hidden && connectionStatus.classList.contains('visible')) {
        setChatConnectionStatus?.(true, 'Prometheus Reconnected', { mode: 'success' });
        setSuccessTimer?.(setTimeout(() => {
          clearSuccessTimer?.();
          setChatConnectionStatus?.(false, 'Prometheus Reconnected', { mode: 'success', delayMs: 180 });
        }, 950));
        return;
      }
      setChatConnectionStatus?.(false, 'Reconnecting to Prometheus', { delayMs: 180 });
    },
  };
}

/**
 * Build the `restart_continuity` websocket handler for one mobile chat page.
 *
 * `suspended` keeps the turn streaming and paints an inline notice; `resumed`
 * re-points the live run at the replacement stream and clears that notice, so
 * the same assistant row keeps streaming instead of rendering a second bubble.
 */
export function createRestartContinuityHandler(context = {}) {
  const {
    requestedSession,
    chatState,
    activeThread,
    findRecoverableAssistantTurn,
    findLatestAssistantTurn,
    appendProcess,
    readActiveRun,
    rememberActiveRun,
    markSessionRunning,
    setBusy,
    setChatConnectionStatus,
    renderThreadNow,
    onResumed,
  } = context;

  return function onRestartContinuity(msg = {}) {
    const sid = String(msg.sessionId || '').trim();
    if (sid !== requestedSession || chatState?.activeSessionId !== requestedSession) return;
    const phase = String(msg.phase || '').trim().toLowerCase();
    if (phase !== 'suspended' && phase !== 'resumed') return;
    const thread = activeThread?.();
    const remembered = readActiveRun?.(requestedSession) || {};
    const clientRequestId = String(msg.clientRequestId || remembered.clientRequestId || '').trim();
    const aiTurn = findRecoverableAssistantTurn?.(thread, clientRequestId)
      || findLatestAssistantTurn?.(thread);
    if (!aiTurn) return;

    clearRestartContinuityStatus(aiTurn);
    if (phase === 'suspended') {
      const priorStreamId = String(msg.priorStreamId || aiTurn._streamId || remembered.streamId || '').trim();
      const priorRuntimeId = String(msg.priorRuntimeId || aiTurn.runtimeId || remembered.runtimeId || '').trim();
      aiTurn.streaming = true;
      appendProcess?.(aiTurn, 'info', RESTART_CONTINUITY_LABEL, { [RESTART_CONTINUITY_FLAG]: true });
      const entry = aiTurn.processEntries?.[aiTurn.processEntries.length - 1];
      if (entry) entry[RESTART_CONTINUITY_FLAG] = true;
      rememberActiveRun?.(requestedSession, {
        restartSuspended: true,
        restartReason: String(msg.reason || ''),
        priorStreamId,
        priorRuntimeId,
        clientRequestId,
        disconnected: false,
      });
      markSessionRunning?.(requestedSession, true);
      setBusy?.(true);
      setChatConnectionStatus?.(false);
      renderThreadNow?.();
      return;
    }

    const newStreamId = String(msg.newStreamId || msg.streamId || '').trim();
    const runtimeId = String(msg.runtimeId || '').trim();
    // The resumed runtime continues this request. Drop any "completed" pin the
    // pre-restart stream left behind so its frames are not treated as replays.
    const pins = chatState?.completedAssistantTurns;
    const pinnedRequest = String(pins?.[requestedSession]?.turn?._clientRequestId || '').trim();
    if (pins && (!clientRequestId || !pinnedRequest || pinnedRequest === clientRequestId)) {
      delete pins[requestedSession];
    }
    delete aiTurn._pmFinalized;
    delete aiTurn._pmLiveActivityCompleted;
    if (chatState && (!chatState.activeRuns || typeof chatState.activeRuns !== 'object')) chatState.activeRuns = {};
    if (chatState?.activeRuns) {
      chatState.activeRuns[requestedSession] = {
        ...(chatState.activeRuns[requestedSession] || {}),
        busy: true,
        streamId: newStreamId,
        runtimeId,
        clientRequestId,
        lastSeq: 0,
      };
    }
    aiTurn.streaming = true;
    if (newStreamId) aiTurn._streamId = newStreamId;
    if (runtimeId) aiTurn.runtimeId = runtimeId;
    if (clientRequestId) aiTurn._clientRequestId = clientRequestId;
    rememberActiveRun?.(requestedSession, {
      restartSuspended: false,
      restartReason: '',
      priorStreamId: '',
      priorRuntimeId: '',
      streamId: newStreamId,
      runtimeId,
      clientRequestId,
      lastSeq: 0,
      disconnected: false,
    });
    onResumed?.();
    setChatConnectionStatus?.(false);
    markSessionRunning?.(requestedSession, true);
    setBusy?.(true);
    renderThreadNow?.();
  };
}
