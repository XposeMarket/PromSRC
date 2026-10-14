import { aggregateModelUsageEvents, summarizeTurnToolResultBudget } from '../.././chat/context-window';
import { hasRecentVoiceWorkflowUserMessage } from '../.././chat/voice/spoken-reply';
import crypto from 'crypto';
import { createTurnTimingRecorder, type TurnTimingRecorder } from '../../../chat/turn-timing';
import { enqueuePostTurnJob } from '../../../chat/post-turn-queue';
import { getConfig } from '../../../../config/config';
import { captureModelUsageLogCursor, readModelUsageEventsForSession, readModelUsageEventsSince } from '../../../../providers/model-usage';
import { getSession, addMessage, getHistory, recordWorkingContextPacket, persistToolLog, getWorkspace, type TurnOrigin } from '../../../session';
import { buildDurableChatTraceFromFrames, buildDurableChatTraceFromProcessEntries } from '../../../durable-chat-trace';
import { type BrainRunBudgetOptions } from '../../../agents-runtime/brain-run-budget';
import { type TurnRouteSnapshot } from '../../../chat/turn-route-snapshot';
import { captureChatTurnRouteSnapshot, ChatModelRouteUnavailableError } from '../../../chat/chat-model-route';
import { formatToolStateSummaryForContext, persistToolResultsAsObservations, type ToolObservation } from '../../../tool-observations';
import { formatBackgroundSpawnContinuity } from '../../../tasks/background-spawn-continuity';
import { autoAttachChatInputResources, redactResourceText } from '../../../resources/resource-store';
import { mainChatTurnCoordinator, type SessionTurnLease } from '../../../chat/turn-coordinator';
import { gatewayRuntimeAdmission, type RuntimeAdmissionLease } from '../../../runtime-admission';
import { executeWebFetch } from '../../../../tools/web';
import { buildMainChatGoalCompletionReport, handleMainChatGoalCommand, isMainChatGoalContinuation, recordMainChatGoalRequirement, snapshotMainChatGoal } from '../../../main-chat-goals';
import { runWithInternalWatchTurnContext } from '../../../internal-watch/internal-watch-policy';
import { broadcastWS } from '../../../comms/broadcaster';
import { findBlockedTaskForSession, buildBlockedTaskStatusMessage, tryHandleBlockedTaskFollowup } from '../../../tasks/task-router';
import { registerLiveRuntime, finishLiveRuntime, getLiveRuntime } from '../../../live-runtime-registry';
import { getCanvasContextBlock } from '../.././canvas-state';
import { type HandleChatResult } from '../../../chat/chat-helpers';
import { buildTurnContextPacket, formatTurnContextPacketsForPrompt, shouldPersistTurnContext } from '../../../context/turn-context-packet';
import type { ReasoningOptions } from '../../chat.router';

interface InteractiveTurnDependencies {
  normalizeTurnOrigin: typeof import('../../chat.router').normalizeTurnOrigin;
  persistTurnOriginChannelHint: typeof import('../../chat.router').persistTurnOriginChannelHint;
  getMainChatStream: typeof import('../../chat.router').getMainChatStream;
  beginMainChatStream: typeof import('../../chat.router').beginMainChatStream;
  findSessionMainChatRuntime: typeof import('../../chat.router').findSessionMainChatRuntime;
  announceRestartContinuityResumed: typeof import('./restart-continuity').announceRestartContinuityResumed;
  normalizeClientRequestId: typeof import('../../chat.router').normalizeClientRequestId;
  appendMainChatStreamEvent: typeof import('../../chat.router').appendMainChatStreamEvent;
  broadcastMainChatGoalState: typeof import('./text-guards').broadcastMainChatGoalState;
  startMainChatGoalRunner: typeof import('./goal-runner').startMainChatGoalRunner;
  CONTEXT_COMPACTION_TOOL_NAME: typeof import('../../chat.router').CONTEXT_COMPACTION_TOOL_NAME;
  handleChat: typeof import('./handle-chat').handleChat;
  maybeRefreshProjectLearning: typeof import('./text-guards').maybeRefreshProjectLearning;
  shouldCheckBlockedTaskFollowup: typeof import('./text-guards').shouldCheckBlockedTaskFollowup;
  formatTurnOriginContext: typeof import('../../chat.router').formatTurnOriginContext;
  collectTurnFileChanges: typeof import('../../chat.router').collectTurnFileChanges;
  buildDurableToolStreamTrace: typeof import('../../chat.router').buildDurableToolStreamTrace;
  describeTurnAbortCause: typeof import('../../chat.router').describeTurnAbortCause;
  editRerunAbortResetSessions: typeof import('./handle-chat').editRerunAbortResetSessions;
  isPlannedRestartToolName: typeof import('../../chat.router').isPlannedRestartToolName;
  maybeAutoNameChatSession: typeof import('./session-title').maybeAutoNameChatSession;
  finishMainChatStream: typeof import('../../chat.router').finishMainChatStream;
}
let normalizeTurnOrigin: InteractiveTurnDependencies['normalizeTurnOrigin'];
let persistTurnOriginChannelHint: InteractiveTurnDependencies['persistTurnOriginChannelHint'];
let getMainChatStream: InteractiveTurnDependencies['getMainChatStream'];
let beginMainChatStream: InteractiveTurnDependencies['beginMainChatStream'];
let findSessionMainChatRuntime: InteractiveTurnDependencies['findSessionMainChatRuntime'];
let announceRestartContinuityResumed: InteractiveTurnDependencies['announceRestartContinuityResumed'];
let normalizeClientRequestId: InteractiveTurnDependencies['normalizeClientRequestId'];
let appendMainChatStreamEvent: InteractiveTurnDependencies['appendMainChatStreamEvent'];
let broadcastMainChatGoalState: InteractiveTurnDependencies['broadcastMainChatGoalState'];
let startMainChatGoalRunner: InteractiveTurnDependencies['startMainChatGoalRunner'];
let CONTEXT_COMPACTION_TOOL_NAME: InteractiveTurnDependencies['CONTEXT_COMPACTION_TOOL_NAME'];
let handleChat: InteractiveTurnDependencies['handleChat'];
let maybeRefreshProjectLearning: InteractiveTurnDependencies['maybeRefreshProjectLearning'];
let shouldCheckBlockedTaskFollowup: InteractiveTurnDependencies['shouldCheckBlockedTaskFollowup'];
let formatTurnOriginContext: InteractiveTurnDependencies['formatTurnOriginContext'];
let collectTurnFileChanges: InteractiveTurnDependencies['collectTurnFileChanges'];
let buildDurableToolStreamTrace: InteractiveTurnDependencies['buildDurableToolStreamTrace'];
let describeTurnAbortCause: InteractiveTurnDependencies['describeTurnAbortCause'];
let editRerunAbortResetSessions: InteractiveTurnDependencies['editRerunAbortResetSessions'];
let isPlannedRestartToolName: InteractiveTurnDependencies['isPlannedRestartToolName'];
let maybeAutoNameChatSession: InteractiveTurnDependencies['maybeAutoNameChatSession'];
let finishMainChatStream: InteractiveTurnDependencies['finishMainChatStream'];
export function configureInteractiveTurnDependencies(deps: InteractiveTurnDependencies): void {
  ({ normalizeTurnOrigin, persistTurnOriginChannelHint, getMainChatStream, beginMainChatStream, findSessionMainChatRuntime, announceRestartContinuityResumed, normalizeClientRequestId, appendMainChatStreamEvent, broadcastMainChatGoalState, startMainChatGoalRunner, CONTEXT_COMPACTION_TOOL_NAME, handleChat, maybeRefreshProjectLearning, shouldCheckBlockedTaskFollowup, formatTurnOriginContext, collectTurnFileChanges, buildDurableToolStreamTrace, describeTurnAbortCause, editRerunAbortResetSessions, isPlannedRestartToolName, maybeAutoNameChatSession, finishMainChatStream } = deps);
}


export async function runInteractiveTurn(
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
	  abortSignal?: { aborted: boolean; signal?: AbortSignal },
	  callerContext?: string,
	  reasoningOptions?: ReasoningOptions,
	  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
    attachmentPreviews?: any[],
    modelOverride?: string,
    flags?: { syntheticGoalContinuation?: boolean; syntheticSubagentCompletion?: boolean; syntheticThreadSupervisionReview?: boolean; supervisionLoop?: boolean; silentSupervisionLoop?: boolean; supervisionOwnerSessionId?: string; supervisionId?: string; syntheticInternalWatch?: boolean; syntheticRestartRecovery?: boolean; internalWatchContextInstalled?: boolean; internalWatchContext?: { watchId: string; actionPolicy: 'review_only' | 'recover_same_run' | 'full_rerun_allowed'; targetTaskId?: string; delivery: 'follow_up' | 'live_steer' }; directSubagentChat?: boolean; excludedSkillIds?: string[]; forcedSkillIds?: string[]; toolFilter?: string[]; timingRecorder?: TurnTimingRecorder; preAcquiredTurnLease?: SessionTurnLease; runtimeId?: string; turnContextId?: string; promptMemoryMode?: 'full' | 'compact'; brainRunBudget?: BrainRunBudgetOptions },
    turnOriginInput?: TurnOrigin,
    requestMeta?: { clientRequestId?: string },
    /** Optional token-stream sink forwarded to handleChat (see callerOnToken there). */
    callerOnToken?: (token: string) => void,
): Promise<HandleChatResult> {
  // Install the watch policy around the entire synthetic turn, including
  // preflight routers and voice/mobile wrappers that bypass executeTool.
  if (flags?.internalWatchContext && flags.internalWatchContextInstalled !== true) {
    return runWithInternalWatchTurnContext(flags.internalWatchContext, () => runInteractiveTurn(
      message,
      sessionId,
      sendSSE,
      pinnedMessages,
      abortSignal,
      callerContext,
      reasoningOptions,
      attachments,
      attachmentPreviews,
      modelOverride,
      { ...flags, internalWatchContextInstalled: true },
      turnOriginInput,
      requestMeta,
      callerOnToken,
    ));
  }
  const turnTiming = flags?.timingRecorder || createTurnTimingRecorder(sessionId, { phase: 'interactive_turn' });
  const leaseWaitStartedAt = turnTiming.mark('lease_wait_start');
  const preAcquiredTurnLease = flags?.preAcquiredTurnLease;
  const turnLease = preAcquiredTurnLease || await mainChatTurnCoordinator.acquire(sessionId, abortSignal?.signal);
  turnTiming.mark('lease_acquired', { waitMs: Date.now() - leaseWaitStartedAt });
  let runtimeAdmissionLease: RuntimeAdmissionLease | null = null;
  // Runtime registered by this turn when no caller-owned runtime exists
  // (timer turns, session wakes). Without it the owner watchdog reconciles the
  // stream as orphaned after MAIN_CHAT_ORPHAN_GRACE_MS of quiet work.
  let ownedTurnRuntimeId = '';
  try {
  const admissionWaitStartedAt = Date.now();
  runtimeAdmissionLease = await gatewayRuntimeAdmission.acquire({
    lane: 'interactive',
    resourceWeight: 1,
    signal: abortSignal?.signal,
    metadata: { sessionId: String(sessionId), executionMode: 'interactive' },
  });
  turnTiming.mark('runtime_admission_acquired', {
    waitMs: Date.now() - admissionWaitStartedAt,
    queueWaitMs: runtimeAdmissionLease.waitMs,
  });
  // Admission boundary: an explicit chatModelRoute or the current Main Chat
  // default is captured once and stays immutable through this whole turn.
  let turnRouteSnapshot: TurnRouteSnapshot;
  let admittedChatModelRoute: any;
  try {
    const admitted = captureChatTurnRouteSnapshot(sessionId);
    turnRouteSnapshot = admitted.snapshot;
    admittedChatModelRoute = admitted.state;
  } catch (error: any) {
    if (error instanceof ChatModelRouteUnavailableError) {
      const text = error.state.error || 'This chat model route is unavailable. Reconnect it, choose another model, or use Main Chat default.';
      sendSSE('error', { code: 'chat_model_route_unavailable', message: text, chatModelRoute: error.state });
      return { type: 'chat', text };
    }
    throw error;
  }
  sendSSE('chat_model_route', { ...admittedChatModelRoute, sessionId });
  const isSubagentChatSession = /^subagent_chat_/i.test(String(sessionId || ''));
  const isDirectSubagentChatTurn = isSubagentChatSession && flags?.directSubagentChat === true;
  const turnExcludedSkillIds = Array.isArray(flags?.excludedSkillIds)
    ? flags.excludedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const turnForcedSkillIds = Array.isArray(flags?.forcedSkillIds)
    ? flags.forcedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const isGoalContinuationTurn = flags?.syntheticGoalContinuation === true || isMainChatGoalContinuation(message);
  const isSyntheticSubagentCompletionTurn = flags?.syntheticSubagentCompletion === true;
  const isSyntheticThreadSupervisionReview = flags?.syntheticThreadSupervisionReview === true;
  const isSupervisionLoop = flags?.supervisionLoop === true;
  const isSilentSupervisionLoop = flags?.silentSupervisionLoop === true;
  const isSyntheticInternalWatch = flags?.syntheticInternalWatch === true;
  const isSyntheticRestartRecovery = flags?.syntheticRestartRecovery === true;
  const goalTurnSnapshot = isGoalContinuationTurn ? snapshotMainChatGoal(sessionId) : null;
  const goalRestartCheckpoint = goalTurnSnapshot?.restartCheckpoint && goalTurnSnapshot.restartCheckpoint.phase !== 'complete'
    ? goalTurnSnapshot.restartCheckpoint
    : null;
  const goalTurnNumber = goalTurnSnapshot ? Math.max(1, Number(goalTurnSnapshot.restartCheckpoint?.turnNumber || goalTurnSnapshot.turnsUsed + 1)) : 0;
  const goalIterationNumber = goalTurnSnapshot ? Math.max(1, Number(goalTurnSnapshot.currentIteration || 1)) : 0;
  const goalTurnId = goalTurnSnapshot ? `${goalTurnSnapshot.id}:turn:${goalTurnNumber}:iteration:${goalIterationNumber}` : '';
  const goalMessageIdentity = goalTurnSnapshot ? {
    messageKind: 'goal_turn',
    activeRunKind: 'main_chat_goal',
    goalId: goalTurnSnapshot.id,
    goalTurnNumber,
    goalIterationNumber,
    goalTurnId,
  } : {};
  const isTimerTurn = /^\s*\[Timer fired\]/i.test(String(message || ''));
  const turnOrigin = normalizeTurnOrigin(turnOriginInput, sessionId, isTimerTurn || isGoalContinuationTurn ? { channel: 'system', surface: 'automation', device: 'server' } : undefined);
  const threadSupervisionMessageIdentity = isSyntheticThreadSupervisionReview ? {
    messageKind: 'thread_supervision_review',
    channel: 'system' as const,
    channelLabel: 'active supervision',
    origin: turnOrigin,
  } : {};
  persistTurnOriginChannelHint(sessionId, turnOrigin);
  turnTiming.mark('turn_origin_persisted');
  const existingMainChatStream = getMainChatStream(sessionId);
  const streamSetupStartedAt = Date.now();
  const localMainChatStream = isSilentSupervisionLoop
      ? null
      : existingMainChatStream?.active
      ? null
      : beginMainChatStream(sessionId, flags?.runtimeId, turnLease.leaseId);
  if (localMainChatStream && abortSignal) {
    localMainChatStream.abortExecution = (reason: string) => {
      if (abortSignal.aborted) return;
      abortSignal.aborted = true;
      // Keep the cause so describeTurnAbortCause does not report a watchdog
      // or owner-loss abort as "User cancelled the active turn".
      try { if (!(abortSignal as any).reason) (abortSignal as any).reason = reason; } catch {}
      try { (abortSignal as any).abort?.(reason); } catch {}
    };
  }
  if (localMainChatStream && !localMainChatStream.runtimeId) {
    const callerRuntime = findSessionMainChatRuntime(sessionId);
    if (callerRuntime) {
      localMainChatStream.runtimeId = callerRuntime.id;
    } else {
      ownedTurnRuntimeId = registerLiveRuntime({
        kind: 'main_chat',
        label: isTimerTurn ? 'Timer turn' : 'Main chat',
        sessionId,
        source: turnOrigin.channel,
        detail: String(message || '').slice(0, 160),
        abortSignal: abortSignal as any,
        onAbort: () => {
          try { localMainChatStream.abortExecution?.('runtime_abort'); } catch {}
        },
        recoveryPolicy: 'do_not_resume',
        recoveryData: { syntheticOwnedTurn: true, timerTurn: isTimerTurn },
      });
      localMainChatStream.runtimeId = ownedTurnRuntimeId;
    }
  }
  turnTiming.mark('stream_setup_done', {
    durationMs: Date.now() - streamSetupStartedAt,
    reusedActiveStream: !!existingMainChatStream?.active,
  });
  // A restart-recovery turn is the same logical turn the user is already
  // watching. Emit the resumption only once the replacement stream exists, so
  // clients receive the streamId they must follow rather than a bare notice.
  if (flags?.syntheticRestartRecovery) {
    announceRestartContinuityResumed({
      sessionId,
      stream: localMainChatStream || existingMainChatStream || null,
      runtimeId: flags?.runtimeId,
      clientRequestId: normalizeClientRequestId(requestMeta?.clientRequestId) || undefined,
      reason: 'gateway_restart',
    });
  }
  let localMainChatStreamCompleted = false;
  const completeLocalMainChatStream = (result: HandleChatResult | { type?: string; text?: string; thinking?: string; toolResults?: any[]; artifacts?: any[]; generatedImages?: any[]; generatedVideos?: any[]; canvasFiles?: any[]; fileChanges?: any; productCarousel?: any; richArtifacts?: any[]; goalCompletionReport?: any } | null | undefined): void => {
    if (!localMainChatStream || localMainChatStreamCompleted) return;
    localMainChatStreamCompleted = true;
    appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, 'done', {
      reply: String(result?.text || ''),
      mode: String(result?.type || 'chat'),
      sections: [{ type: result?.type === 'execute' ? 'tool_results' : 'text', content: String(result?.text || '') }],
      thinking: result?.thinking,
      results: result?.toolResults,
      artifacts: result?.artifacts,
      generatedImages: result?.generatedImages,
      generatedVideos: result?.generatedVideos,
      canvasFiles: result?.canvasFiles,
      fileChanges: result?.fileChanges,
      productCarousel: result?.productCarousel,
      richArtifacts: result?.richArtifacts,
      goalCompletionReport: result?.goalCompletionReport,
    });
  };
  const upstreamSendSSE = sendSSE;
  sendSSE = (event: string, data: any) => {
    let streamData = data;
    if (localMainChatStream) {
      const frame = appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, event, data);
      if (frame) {
        streamData = {
          ...(data && typeof data === 'object' ? data : {}),
          seq: frame.seq,
          streamId: localMainChatStream.streamId,
          at: frame.at,
        };
      }
    }
    upstreamSendSSE(event, streamData);
  };
  const userMsg = {
    role: 'user' as const,
    content: message,
    timestamp: Date.now(),
    ...(normalizeClientRequestId(requestMeta?.clientRequestId)
      ? { clientRequestId: normalizeClientRequestId(requestMeta?.clientRequestId) }
      : {}),
    channel: turnOrigin.channel,
    channelLabel: turnOrigin.label || turnOrigin.channel,
    origin: turnOrigin,
    ...(isTimerTurn ? { channel: 'system' as const, channelLabel: 'timer' } : {}),
    ...(isGoalContinuationTurn ? { channel: 'system' as const, channelLabel: 'goal' } : {}),
    ...(Array.isArray(attachmentPreviews) && attachmentPreviews.length ? { attachmentPreviews } : {}),
  };
  const assistantRequestIdentity = normalizeClientRequestId(requestMeta?.clientRequestId)
    ? { clientRequestId: normalizeClientRequestId(requestMeta?.clientRequestId) }
    : {};
  // Persist user-provided URLs and uploads before prompt construction. The
  // operation is idempotent, stores immutable snapshots separately from the
  // transcript, and never places raw base64 bytes in session history.
  if (turnOrigin.channel !== 'system' && !isSyntheticInternalWatch && !isSyntheticRestartRecovery) {
    const resourceAttachStartedAt = Date.now();
    try {
      const resourceResult = await autoAttachChatInputResources({
        threadId: sessionId,
        message,
        workspacePath: getWorkspace(sessionId) || getConfig().getWorkspacePath(),
        attachments: Array.isArray(attachments) ? attachments as any[] : [],
        attachmentPreviews: Array.isArray(attachmentPreviews) ? attachmentPreviews as any[] : [],
        actor: 'user',
        fetchUrl: async (url) => executeWebFetch({ url, max_chars: 12_000 }),
      });
      const attachedCount = resourceResult.attached.length + resourceResult.fetched.length;
      turnTiming.mark('chat_resources_attached', {
        durationMs: Date.now() - resourceAttachStartedAt,
        attachedCount,
        fetchedCount: resourceResult.fetched.length,
      });
      if (attachedCount > 0) {
        sendSSE('resource_attached', {
          count: attachedCount,
          fetchedCount: resourceResult.fetched.length,
          resources: [...resourceResult.attached, ...resourceResult.fetched].slice(0, 20),
        });
      }
    } catch (error: any) {
      turnTiming.mark('chat_resources_attach_failed', { durationMs: Date.now() - resourceAttachStartedAt });
      console.warn('[Resources] Chat input attachment maintenance skipped:', redactResourceText(error?.message || error));
    }
  }
  const persistEarlyAbortPacket = (reason: string): void => {
    if (!abortSignal?.aborted) return;
    try {
      const packet = buildTurnContextPacket({
        turnId: String(flags?.turnContextId || flags?.runtimeId || `interactive_${Date.now().toString(36)}`),
        sessionId,
        status: 'aborted',
        request: message,
        progressState: reason,
        uncertainties: ['The turn was cancelled during pre-turn maintenance; no claim is made about work after this boundary.'],
        pendingTasks: ['Resume the original request from the latest durable context.'],
        continueFromHere: 'Resume the original request after checking whether pre-turn maintenance completed.',
        abortReason: 'User cancelled before normal model-turn finalization.',
      });
      recordWorkingContextPacket(sessionId, packet, { flush: true });
    } catch (err: any) {
      console.warn('[context] Failed to persist early abort packet:', err?.message || err);
    }
  };
  if (!isGoalContinuationTurn && !isSyntheticSubagentCompletionTurn && !isSyntheticThreadSupervisionReview && !isSyntheticInternalWatch && !isSyntheticRestartRecovery) {
    appendMainChatStreamEvent(sessionId, localMainChatStream?.streamId || existingMainChatStream?.streamId || '', 'user_message', {
      message: userMsg,
      clientRequestId: normalizeClientRequestId(requestMeta?.clientRequestId),
    });
  }
  try {
  if (!isSubagentChatSession && !isGoalContinuationTurn && /^\/goal(?:\s|$)/i.test(String(message || '').trim())) {
    const command = handleMainChatGoalCommand(sessionId, message);
    const reply = command.message || 'Goal command handled.';
    const goalCompletionReport = command.goal?.status === 'done'
      ? (buildMainChatGoalCompletionReport(command.goal, readModelUsageEventsForSession(sessionId), Date.now()) || undefined)
      : undefined;
    addMessage(sessionId, userMsg, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    addMessage(sessionId, { role: 'assistant', ...assistantRequestIdentity, content: reply, timestamp: Date.now(), messageKind: 'goal_command_ack', goalCompletionReport }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    broadcastMainChatGoalState(sessionId, 'command', { goal: command.goal });
    if (command.shouldStartRunner) {
      broadcastMainChatGoalState(sessionId, 'launch_accepted', {
        source: 'goal_command',
        message: 'Goal accepted. Starting now.',
      });
      startMainChatGoalRunner(sessionId, 'goal_command');
    }
    const commandResult = { type: 'chat' as const, text: reply, goalCompletionReport };
    completeLocalMainChatStream(commandResult);
    return commandResult;
  }

  if (isSubagentChatSession) {
    const session = getSession(sessionId);
    session.pendingCompaction = false;
    session.pendingMemoryFlush = false;
  }

  // Legacy rolling message-count compaction is intentionally no longer triggered
  // at turn start. Context compaction is now driven by provider-aware token/tool
  // budgets inside the execution loop, so users do not see "every 20 messages"
  // compaction attempts.

  const skipDuplicateVoiceWorkflowUser = hasRecentVoiceWorkflowUserMessage(sessionId, message);
  if (isGoalContinuationTurn && goalRestartCheckpoint) {
    const restartNoticeAlreadyStored = getHistory(sessionId, 80).some((historyMessage: any) => (
      String(historyMessage?.messageKind || '') === 'goal_restart_notice'
      && String(historyMessage?.goalRestartCheckpointId || '') === goalRestartCheckpoint.id
    ));
    if (!restartNoticeAlreadyStored) {
      addMessage(sessionId, {
        role: 'assistant',
        content: 'Gateway restarted. Goal continuing.',
        timestamp: Date.now(),
        messageKind: 'goal_restart_notice',
        activeRunKind: 'main_chat_goal',
        goalId: goalTurnSnapshot?.id,
        goalTurnNumber,
        goalIterationNumber,
        goalTurnId,
        channel: 'system',
        channelLabel: 'goal',
        goalRestartCheckpointId: goalRestartCheckpoint.id,
      } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    }
  }
  // Synthetic Goal prompts are runtime control input, not user-authored chat.
  // handleChat receives the full prompt directly below; storing it in history
  // leaks internal instructions into the UI and duplicates model context.
  const addMessageStartedAt = Date.now();
  const addResult: any = isGoalContinuationTurn || isSyntheticSubagentCompletionTurn || isSyntheticThreadSupervisionReview || isSyntheticInternalWatch || isSyntheticRestartRecovery
    ? { added: false, deferredForCompaction: false, deferredForMemoryFlush: false }
    : skipDuplicateVoiceWorkflowUser
    ? { added: false, deferredForCompaction: false, deferredForMemoryFlush: false }
    : addMessage(sessionId, userMsg, {
        deferOnMemoryFlush: true,
        deferOnCompaction: true,
        // The actual model-call boundary owns token-aware compaction.
        // Persisting a message must never impose a message-count context policy.
        disableCompactionCheck: true,
        disableMemoryFlushCheck: isSubagentChatSession,
        maxMessages: isSubagentChatSession ? 120 : undefined,
      });
  turnTiming.mark('user_message_persisted', {
    durationMs: Date.now() - addMessageStartedAt,
    added: addResult.added !== false,
    deferredForCompaction: addResult.deferredForCompaction === true,
    deferredForMemoryFlush: addResult.deferredForMemoryFlush === true,
  });

  if (addResult.deferredForCompaction && addResult.compactionPrompt) {
    sendSSE('ui_preflight', { message: 'Compacting the thread before continuing...' });
    sendSSE('tool_call', {
      action: CONTEXT_COMPACTION_TOOL_NAME,
      args: {
        phase: 'start',
        mode: 'rolling_window',
        reason: 'pre_turn_rolling_compaction',
        estimated_tokens: addResult.estimatedTokens,
        context_limit_tokens: addResult.contextLimitTokens,
      },
      synthetic: true,
      actor: 'system',
    });
    console.log(`[v2] Context compaction triggered for session ${sessionId} (${addResult.estimatedTokens}/${addResult.contextLimitTokens} est. tokens)`);
    try {
      const internalCompactionContext = 'CONTEXT: Internal context compaction turn. Summarize prior conversation into compact retained context only.';
      const compactResult = await handleChat(
        addResult.compactionPrompt,
        sessionId,
        () => {},
        undefined,
        abortSignal,
        internalCompactionContext,
        undefined,
        'interactive',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { turnRouteSnapshot, timingRecorder: turnTiming },
      );
      if (!abortSignal?.aborted && compactResult?.text) {
        addMessage(
          sessionId,
          { role: 'assistant', content: compactResult.text, timestamp: Date.now() },
          { disableMemoryFlushCheck: true, disableCompactionCheck: true },
        );
        await maybeRefreshProjectLearning(sessionId, [compactResult.text]);
        sendSSE('tool_result', {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          result: 'Thread compacted before continuing.',
          error: false,
          synthetic: true,
          actor: 'system',
          extra: {
            phase: 'result',
            status: 'compacted',
            mode: 'rolling_window',
            summary: compactResult.text,
            estimated_tokens: addResult.estimatedTokens,
            context_limit_tokens: addResult.contextLimitTokens,
          },
        });
      } else {
        sendSSE('tool_result', {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          result: 'Thread compaction skipped; continuing with normal flow.',
          error: false,
          synthetic: true,
          actor: 'system',
          extra: {
            phase: 'result',
            status: 'skipped',
            mode: 'rolling_window',
            estimated_tokens: addResult.estimatedTokens,
            context_limit_tokens: addResult.contextLimitTokens,
          },
        });
      }
    } catch (compactErr: any) {
      console.warn('[v2] Context compaction turn failed:', compactErr?.message || compactErr);
      sendSSE('tool_result', {
        action: CONTEXT_COMPACTION_TOOL_NAME,
        result: `Thread compaction failed: ${String(compactErr?.message || compactErr || '').slice(0, 300)}`,
        error: true,
        synthetic: true,
        actor: 'system',
        extra: {
          phase: 'result',
          status: 'failed',
          mode: 'rolling_window',
          estimated_tokens: addResult.estimatedTokens,
          context_limit_tokens: addResult.contextLimitTokens,
        },
      });
    }
    if (abortSignal?.aborted) {
      persistEarlyAbortPacket('Cancelled after pre-turn context compaction maintenance.');
      return { type: 'chat', text: '' };
    }
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  } else if (addResult.deferredForMemoryFlush && addResult.memoryFlushPrompt) {
    sendSSE('ui_preflight', { message: 'Saving important memory before continuing...' });
    console.log(`[v2] Pre-compaction memory flush triggered for session ${sessionId} (${addResult.estimatedTokens}/${addResult.contextLimitTokens} est. tokens)`);
    try {
      const internalFlushContext = 'CONTEXT: Internal pre-compaction memory flush turn. Before continuing, save important durable user/task facts to memory now.';
      const flushResult = await handleChat(
        addResult.memoryFlushPrompt,
        sessionId,
        () => {},
        undefined,
        abortSignal,
        internalFlushContext,
        undefined,
        'interactive',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { turnRouteSnapshot, timingRecorder: turnTiming },
      );
      if (!abortSignal?.aborted && flushResult?.text) {
        addMessage(
          sessionId,
          { role: 'assistant', content: flushResult.text, timestamp: Date.now() },
          { disableMemoryFlushCheck: true, disableCompactionCheck: true },
        );
      }
    } catch (flushErr: any) {
      console.warn('[v2] Pre-compaction memory flush failed:', flushErr?.message || flushErr);
    }
    if (abortSignal?.aborted) {
      persistEarlyAbortPacket('Cancelled after pre-turn memory maintenance.');
      return { type: 'chat', text: '' };
    }
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  }

  console.log(`\n[v2] USER: ${message.slice(0, 100)}`);
  let followupHandled: string | null = null;
  if (!isSyntheticInternalWatch && !isSupervisionLoop && shouldCheckBlockedTaskFollowup(message)) {
    sendSSE('ui_preflight', { message: 'Checking paused task follow-up...' });
    const blockedFollowupLookupStartedAt = Date.now();
    turnTiming.mark('blocked_recovery_followup_lookup_start');
    followupHandled = await tryHandleBlockedTaskFollowup(sessionId, message);
    turnTiming.mark('blocked_recovery_followup_lookup_done', {
      durationMs: Date.now() - blockedFollowupLookupStartedAt,
      handled: !!followupHandled,
    });
  }
  if (followupHandled) {
    if (!abortSignal?.aborted) {
      addMessage(sessionId, { role: 'assistant', ...assistantRequestIdentity, content: followupHandled, timestamp: Date.now() });
      await maybeRefreshProjectLearning(sessionId);
    }
    const followupResult = { type: 'chat' as const, text: followupHandled };
    completeLocalMainChatStream(followupResult);
    return followupResult;
  }

  const pins = Array.isArray(pinnedMessages) ? pinnedMessages.slice(0, 3) : [];
  sendSSE('ui_preflight', { message: 'Preparing chat context...' });
  const canvasCtx = getCanvasContextBlock(sessionId);
  const originCtx = formatTurnOriginContext(turnOrigin, sessionId);
  const assignedTaskAttentionCtx = (() => {
    const assignedTaskLookupStartedAt = Date.now();
    turnTiming.mark('assigned_task_attention_lookup_start');
    try {
      const task = findBlockedTaskForSession(sessionId);
      if (!task) return '';
      return [
        '[ASSIGNED TASK ATTENTION]',
        buildBlockedTaskStatusMessage(task),
        'This context is informational for this turn. Do not claim the task resumed just because the user replied.',
        `Use task_control(action:"get", task_id:"${task.id}") to inspect the current state. Use task_control(action:"resume", task_id:"${task.id}") only when the user clearly asks to continue this task, or task_control(action:"rerun", task_id:"${task.id}") when they ask to retry from the start.`,
        '[/ASSIGNED TASK ATTENTION]',
      ].join('\n');
    } catch {
      return '';
    } finally {
      turnTiming.mark('assigned_task_attention_lookup_done', {
        durationMs: Date.now() - assignedTaskLookupStartedAt,
      });
    }
  })();
  const mergedCallerContext = [originCtx, callerContext, canvasCtx || undefined, assignedTaskAttentionCtx || undefined].filter(Boolean).join('\n\n') || undefined;
  const providerUsageCursor = captureModelUsageLogCursor();
  turnTiming.mark('model_usage_cursor_captured', { logBytes: providerUsageCursor.byteOffset });
  turnTiming.mark('handle_chat_start');
  const result = await runWithInternalWatchTurnContext(flags?.internalWatchContext, () => handleChat(
    message,
    sessionId,
	    sendSSE,
	    pins.length > 0 ? pins : undefined,
	    abortSignal,
	    mergedCallerContext,
    modelOverride,
    undefined,
    Array.isArray(flags?.toolFilter) && flags.toolFilter.length ? flags.toolFilter : undefined,
	    Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
	    reasoningOptions,
	    undefined, // providerOverride
	    callerOnToken,
      {
        directSubagentChat: isDirectSubagentChatTurn,
        syntheticThreadSupervisionReview: isSyntheticThreadSupervisionReview,
        supervisionLoop: isSupervisionLoop,
        silentSupervisionLoop: isSilentSupervisionLoop,
        supervisionOwnerSessionId: flags?.supervisionOwnerSessionId,
        supervisionId: flags?.supervisionId,
        internalWatchContext: flags?.internalWatchContext,
        excludedSkillIds: turnExcludedSkillIds,
        forcedSkillIds: turnForcedSkillIds,
        instructionCallerRequirements: callerContext ? [callerContext] : [],
        timingRecorder: turnTiming,
        turnRouteSnapshot,
        promptMemoryMode: flags?.promptMemoryMode,
        brainRunBudget: flags?.brainRunBudget,
        runtimeId: flags?.runtimeId,
        // Restart-resumed turns keep the root turn id so the cross-turn edit
        // log files pre- and post-restart edits under one turn.
        ...({ turnContextId: (flags as any)?.turnContextId } as any),
        admissionLease: runtimeAdmissionLease || undefined,
      },
  ));
  turnTiming.mark('handle_chat_done');

  const observationPersistStartedAt = Date.now();
  const turnObservationId = `turn_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const toolObservations: ToolObservation[] = !isSilentSupervisionLoop && result.toolResults && result.toolResults.length > 0
    ? persistToolResultsAsObservations(sessionId, turnObservationId, result.toolResults)
    : [];
  turnTiming.mark('tool_observations_persisted', { durationMs: Date.now() - observationPersistStartedAt, count: toolObservations.length });
  const providerUsageAfterStartedAt = Date.now();
  const turnUsageEvents = readModelUsageEventsSince(providerUsageCursor, sessionId, turnTiming.turnId);
  const turnProviderUsage = aggregateModelUsageEvents(turnUsageEvents);
  turnTiming.mark('model_usage_after_loaded', {
    durationMs: Date.now() - providerUsageAfterStartedAt,
    eventCount: turnUsageEvents.length,
    incremental: true,
  });
  const acceptedGoalCompletion = Array.isArray(result.toolResults) && result.toolResults.some((entry: any) => (
    String(entry?.name || entry?.action || '').trim() === 'complete_goal'
    && entry?.error !== true
    && /^Goal completed by Prometheus\b/i.test(String(entry?.result || entry?.content || '').trim())
  ));
  if (acceptedGoalCompletion) {
    const completedGoal = snapshotMainChatGoal(sessionId);
    if (completedGoal?.status === 'done') {
      result.goalCompletionReport = buildMainChatGoalCompletionReport(
        completedGoal,
        readModelUsageEventsForSession(sessionId),
        Date.now(),
      ) || undefined;
    }
  }

  // Preserve every substantive user steer while a goal is active outside of
  // compactable transcript history.  This includes amendments that arrive
  // during the short restart/runner gaps.
  if (!isGoalContinuationTurn && !isSyntheticSubagentCompletionTurn && !isSyntheticThreadSupervisionReview && !isSyntheticInternalWatch && !isSyntheticRestartRecovery) {
    const activeGoal = snapshotMainChatGoal(sessionId);
    if (activeGoal && ['active', 'restarting', 'paused'].includes(String(activeGoal.status || ''))) {
      const amended = recordMainChatGoalRequirement(sessionId, message, 'user_message');
      if (amended?.id === activeGoal.id) {
        sendSSE('goal_context_injected', { goalId: amended.id, amendmentCount: amended.requirementsLedger?.length || 0, source: 'user_message' });
      }
    }
  }
  const toolSummaryStartedAt = Date.now();
  const toolResultBudget = summarizeTurnToolResultBudget(toolObservations);
  const toolLogText = toolObservations.length > 0
    ? formatToolStateSummaryForContext(toolObservations, { includeHeader: true, maxChars: 2200, maxObservations: 14, includeTelemetry: true })
    : '';
  turnTiming.mark('tool_summary_built', { durationMs: Date.now() - toolSummaryStartedAt });
  const fileChangesStartedAt = Date.now();
  // Restart-spanning turns: the end-of-turn diff must cover the work done
  // before the restart(s) too, not only the post-restart tool results.
  // The resumed runtime inherits `fileTouches` from every earlier runtime of
  // this turn (see restart recovery), so this covers N restarts, not just one.
  let preRestartToolResults: any[] = [];
  if (flags?.syntheticRestartRecovery && flags?.runtimeId) {
    try {
      const resumedRuntime: any = getLiveRuntime(String(flags.runtimeId));
      const inherited = Array.isArray(resumedRuntime?.recoveryData?.inheritedFileTouches)
        ? resumedRuntime.recoveryData.inheritedFileTouches
        : [];
      if (inherited.length) preRestartToolResults = inherited.map((touch: any) => ({ ...touch, result: '', error: false }));
    } catch {}
  }
  const resultFileChanges = preRestartToolResults.length
    ? await collectTurnFileChanges(
      [...preRestartToolResults, ...((result.toolResults as any[] | undefined) || [])],
      getWorkspace(sessionId) || process.cwd(),
    ) || result.fileChanges
    : result.fileChanges || await collectTurnFileChanges(
      (result.toolResults as any[] | undefined) || [],
      getWorkspace(sessionId) || process.cwd(),
    );
  turnTiming.mark('file_changes_collected', {
    durationMs: Date.now() - fileChangesStartedAt,
    changedFileCount: Array.isArray((resultFileChanges as any)?.files) ? (resultFileChanges as any).files.length : 0,
  });
  const durableTraceStartedAt = Date.now();
  let durableToolStreamTrace = buildDurableToolStreamTrace(sessionId);
  // A restart-resumed turn is the SAME turn as the work before the restart(s).
  // Its live stream only holds post-restart frames, and the per-restart
  // checkpoint rows are not guaranteed to survive (warm handoff), so the final
  // message must carry the whole turn itself: prepend the pre-restart trace the
  // recovery path seeded into this runtime's checkpoint (chains across restarts).
  let restartSpanStartedAt = 0;
  if (flags?.syntheticRestartRecovery && flags?.runtimeId) {
    try {
      const resumedRuntime: any = getLiveRuntime(String(flags.runtimeId));
      const seeded = (Array.isArray(resumedRuntime?.checkpoint?.processEntries) ? resumedRuntime.checkpoint.processEntries : [])
        .filter((entry: any) => entry && typeof entry === 'object' && entry.extra?.preRestart === true);
      const preTrace = seeded.length ? (buildDurableChatTraceFromProcessEntries(seeded) || []) : [];
      if (preTrace.length) durableToolStreamTrace = [...preTrace, ...(durableToolStreamTrace || [])];
      restartSpanStartedAt = Number(resumedRuntime?.recoveryData?.rootStartedAt || 0) || 0;
    } catch (err: any) {
      console.warn('[restart-span] could not merge pre-restart trace:', err?.message || err);
    }
  }
  const turnWorkStartedAt = restartSpanStartedAt > 0 && restartSpanStartedAt < turnTiming.startedAt
    ? restartSpanStartedAt
    : turnTiming.startedAt;
  turnTiming.mark('durable_trace_built', {
    durationMs: Date.now() - durableTraceStartedAt,
    traceEntryCount: Array.isArray(durableToolStreamTrace) ? durableToolStreamTrace.length : 0,
  });
  if (resultFileChanges && !result.fileChanges) {
    (result as any).fileChanges = resultFileChanges;
  }
  // Carry what each step actually produced, not just "tool: ok". A resumed or
  // aborted turn used to see only tool names + "Completed N tool step(s)" and
  // had to re-run commands to rediscover its own results.
  const backgroundContinuity = formatBackgroundSpawnContinuity(sessionId, turnWorkStartedAt - 60_000);
  const packetToolActions = toolObservations.map((observation) => {
    const paths = Array.isArray(observation.pathsTouched) && observation.pathsTouched.length
      ? ` (${observation.pathsTouched.slice(0, 2).join(', ')})`
      : '';
    const exit = Number.isFinite(Number(observation.exitCode)) ? ` exit=${observation.exitCode}` : '';
    const result = String(observation.resultPreview || '')
      .replace(/\s+/g, ' ')
      .replace(/^.*?\[exit \d+\] run=\S+ cwd=\S+\s*/, '')
      .trim()
      .slice(0, 220);
    return `${observation.toolName}: ${observation.status}${exit}${paths}${result ? ` -> ${result}` : ''}`;
  });
  // Visible commentary is the model's own running summary of findings; keep the
  // last few lines so the next runtime knows what was concluded, not just run.
  const packetCommentary = (Array.isArray(durableToolStreamTrace) ? durableToolStreamTrace : [])
    .filter((entry: any) => /^(?:preamble|commentary|narration)$/i.test(String(entry?.type || '')) || (String(entry?.type || '') === 'info' && String(entry?.extra?.kind || entry?.extra?.source || '').match(/comment|narrat/i)))
    .map((entry: any) => String(entry?.text || '').replace(/\s+/g, ' ').trim())
    .filter((text: string) => text.length > 12)
    .slice(-6);
  const packetFileCount = Array.isArray((resultFileChanges as any)?.files)
    ? (resultFileChanges as any).files.length
    : 0;
  const packetStatus = abortSignal?.aborted
    ? 'aborted'
    : /^\s*error:/i.test(String(result.text || ''))
      ? 'failed'
      : 'completed';
  // An abort is not always the user. A gateway restart/drain (planned by this
  // chat's own gateway_restart call, or an unplanned drop/watchdog) also aborts
  // the turn, and labelling that "User cancelled" makes the resumed turn believe
  // the user stopped it and lose track of who started the restart.
  const packetAbortCause = packetStatus === 'aborted' ? describeTurnAbortCause(abortSignal) : '';
  const packetUncertainties = packetStatus === 'aborted'
    ? ['The active model/tool boundary was interrupted; verify any in-flight side effect before retrying it.']
    : [];
  const packet = shouldPersistTurnContext({
    status: packetStatus,
    reasoningSummary: result.reasoningSummary,
    toolCount: toolObservations.length,
    hasFileChanges: packetFileCount > 0,
    hasArtifacts: !!(result.artifacts?.length || result.generatedImages?.length || result.generatedVideos?.length || result.richArtifacts?.length),
  })
    ? buildTurnContextPacket({
        // A turn that spans restarts runs as several runtimes. Key the packet on
        // the root turn so every segment merges into one packet instead of each
        // segment evicting unrelated context from the bounded packet list.
        turnId: String(flags?.turnContextId || flags?.runtimeId || `interactive_${Date.now().toString(36)}`),
        sessionId,
        status: packetStatus,
        request: message,
        reasoningSummary: result.reasoningSummary,
        findings: [
          ...packetCommentary,
          ...(backgroundContinuity ? [backgroundContinuity] : []),
          ...(packetToolActions.length ? [`Completed ${packetToolActions.length} tool step(s); results below.`] : []),
        ],
        decisions: result.reasoningSummary
          ? []
          : packetToolActions.length
            ? ['Continue from the completed tool state and verify any uncertain boundary before repeating work.']
            : [],
        completedActions: packetToolActions,
        toolState: toolLogText,
        progressState: packetToolActions.slice(-6).join('\n'),
        uncertainties: packetUncertainties,
        pendingTasks: packetStatus === 'aborted' ? ['Resume the user request from this packet after verifying the interrupted boundary.'] : [],
        continueFromHere: packetStatus === 'aborted'
          ? 'Resume from the completed observations, then verify the interrupted boundary before repeating it.'
          : 'Use these findings and decisions as the starting state for the next related turn.',
        abortReason: packetStatus === 'aborted' ? packetAbortCause : undefined,
      })
    : null;
  if (packet) {
    recordWorkingContextPacket(sessionId, packet, { flush: packet.status === 'aborted' });
  }
  const latestChatSteer = [...getHistory(sessionId, 80)].reverse().find((entry: any) =>
    entry?.role === 'user'
    && String(entry.workflowPart || '') === 'interruption'
    && /^chat_steer_/i.test(String(entry.workflowGroupId || ''))
    && Number(entry.timestamp || 0) >= turnTiming.startedAt - 2_000,
  ) as any;
  // The steer endpoint persisted everything up to the boundary as the
  // before-steer row; the reply row keeps only the work after the steer, so
  // reopening the chat does not show the pre-steer tools twice.
  if (latestChatSteer) {
    const steerStream = getMainChatStream(sessionId);
    const boundarySeq = Math.max(0, Number(latestChatSteer.workflowBoundarySeq || 0) || 0);
    if (steerStream && boundarySeq > 0 && String(latestChatSteer.workflowStreamId || '') === steerStream.streamId) {
      durableToolStreamTrace = buildDurableChatTraceFromFrames(
        steerStream.events.filter((frame: any) => Number(frame.seq) > boundarySeq),
        `trace_${steerStream.streamId}`,
      ) || [];
    }
  }
  const chatSteerContinuationIdentity = latestChatSteer ? {
    messageId: `${String(latestChatSteer.workflowGroupId)}:continuation`,
    workflowGroupId: String(latestChatSteer.workflowGroupId),
    workflowPart: 'interruption_response',
    workflowLabel: 'Response after steer',
    workflowBoundarySeq: latestChatSteer.workflowBoundarySeq,
    workflowStreamId: latestChatSteer.workflowStreamId,
  } : {};
  if (abortSignal?.aborted) {
    if (editRerunAbortResetSessions.has(String(sessionId || ''))) {
      return result;
    }
    const plannedRestartAbort = [
      ...((Array.isArray(result.toolResults) ? result.toolResults : []).map((entry: any) => entry?.name || entry?.action || entry?.toolName)),
    ].some((name) => isPlannedRestartToolName(String(name || '')));
    const plannedRestartLog = /\b(gateway_restart|prom_apply_dev_changes)\b/.test(toolLogText);
    if (plannedRestartAbort || plannedRestartLog) {
      return result;
    }
    const interruptedText = String(result.text || '').trim();
    const recentUsers = getHistory(sessionId, 8)
      .filter((msg) => msg.role === 'user')
      .map((msg) => String(msg.content || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const currentRequest = String(message || '').replace(/\s+/g, ' ').trim();
    const priorRequest = [...recentUsers].reverse().find((text) => text && text !== currentRequest) || '';
    const workSummary = priorRequest && currentRequest && /^(ok|okay|yes|yep|sure|go ahead|do that|continue|please)\b/i.test(currentRequest)
      ? `${priorRequest.slice(0, 220)} -> ${currentRequest.slice(0, 160)}`
      : (currentRequest || priorRequest || 'the interrupted turn');
    const stepSummary = result.toolResults && result.toolResults.length > 0
      ? `Stopped after ${result.toolResults.length} step${result.toolResults.length !== 1 ? 's' : ''}.`
      : 'Stopped before any tool calls completed.';
    const checkpointPacket = [
      '[Interrupted by user]',
      `In the middle of: ${workSummary}`,
      interruptedText || stepSummary,
      toolLogText
        ? `Compact tool/process state was preserved for continuation:\n${toolLogText}`
        : 'No tool calls had completed yet.',
      packet ? formatTurnContextPacketsForPrompt([packet], 6_000) : '',
      'When the user asks to continue, resume from this checkpoint instead of restarting from scratch.',
    ].filter(Boolean).join('\n\n');
    const abortCause = describeTurnAbortCause(abortSignal as any);
    const userCancelled = /^User cancelled/i.test(abortCause);
    // A system-caused stop (watchdog, restart, drain) must stay visible: the
    // "Restart Context Packet" prefix is hidden by the mobile transcript, which
    // made killed timer turns look like they never replied.
    const visibleCheckpointText = userCancelled
      ? [
        'Restart Context Packet',
        '',
        `Interrupted by user while I was working on: ${workSummary.slice(0, 260)}`,
        stepSummary,
        'Compact tool/process state was preserved for continuation. Full raw observations remain available out-of-band.',
      ].join('\n')
      : [
        `**This turn was stopped by the gateway, not by you.** ${abortCause}`,
        '',
        `I was working on: ${workSummary.slice(0, 260)}`,
        stepSummary,
        'Say "continue" and I will pick up from the saved checkpoint.',
      ].join('\n');
    if (!isSilentSupervisionLoop) {
    const assistantPersistStartedAt = Date.now();
    const assistantWorkEndedAt = Date.now();
    addMessage(sessionId, {
      role: 'assistant',
      ...assistantRequestIdentity,
      ...chatSteerContinuationIdentity,
      ...goalMessageIdentity,
      ...threadSupervisionMessageIdentity,
      content: visibleCheckpointText,
      timestamp: Date.now(),
      workStartedAt: turnWorkStartedAt,
      workEndedAt: assistantWorkEndedAt,
      workDurationMs: Math.max(0, assistantWorkEndedAt - turnWorkStartedAt),
      toolLog: toolLogText || checkpointPacket,
      reasoningSummary: result.reasoningSummary || result.thinking || undefined,
      visibleReasoningSummary: result.reasoningSummary || undefined,
      turnProviderUsage,
      toolResultBudget,
      goalCompletionReport: result.goalCompletionReport,
      fileChanges: resultFileChanges || undefined,
      liveTraceEntries: durableToolStreamTrace,
      processEntries: [{
        ts: new Date().toLocaleTimeString(),
        type: 'warn',
        actor: 'Prom',
        content: checkpointPacket,
        extra: { packetType: 'restart_context_packet', interrupted: true },
      }],
    } as any, {
      // Subagent threads use the same rolling compaction boundary as main
      // chat. Their shared agent-chat store mirrors the resulting summary.
      disableCompactionCheck: false,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    turnTiming.mark('assistant_message_committed', {
      durationMs: Date.now() - assistantPersistStartedAt,
      interrupted: true,
    });
    if (toolLogText) {
      const toolLogPersistStartedAt = Date.now();
      persistToolLog(sessionId, toolLogText);
      turnTiming.mark('tool_log_persisted', { durationMs: Date.now() - toolLogPersistStartedAt });
    }
    }
    if (!isSubagentChatSession && !isSyntheticThreadSupervisionReview) {
      enqueuePostTurnJob({
        sessionId,
        label: 'interrupted_project_learning',
        run: async () => {
          const projectLearningStartedAt = Date.now();
          await maybeRefreshProjectLearning(sessionId, [visibleCheckpointText, checkpointPacket]);
          turnTiming.mark('project_learning_done', {
            durationMs: Date.now() - projectLearningStartedAt,
            deferred: true,
          });
        },
      });
      turnTiming.mark('post_turn_work_enqueued', { kind: 'interrupted_project_learning' });
    }
  } else {
    if (!isSilentSupervisionLoop) {
    const assistantPersistStartedAt = Date.now();
    const assistantWorkEndedAt = Date.now();
    addMessage(sessionId, {
      role: 'assistant',
      ...assistantRequestIdentity,
      ...chatSteerContinuationIdentity,
      ...goalMessageIdentity,
      ...threadSupervisionMessageIdentity,
      content: result.text,
      timestamp: Date.now(),
      workStartedAt: turnWorkStartedAt,
      workEndedAt: assistantWorkEndedAt,
      workDurationMs: Math.max(0, assistantWorkEndedAt - turnWorkStartedAt),
      artifacts: Array.isArray(result.artifacts) && result.artifacts.length ? result.artifacts : undefined,
      generatedImages: Array.isArray(result.generatedImages) && result.generatedImages.length ? result.generatedImages : undefined,
      generatedVideos: Array.isArray(result.generatedVideos) && result.generatedVideos.length ? result.generatedVideos : undefined,
      canvasFiles: Array.isArray(result.canvasFiles) && result.canvasFiles.length ? result.canvasFiles : undefined,
      fileChanges: result.fileChanges || undefined,
      productCarousel: result.productCarousel || undefined,
      richArtifacts: Array.isArray(result.richArtifacts) && result.richArtifacts.length ? result.richArtifacts : undefined,
      toolLog: toolLogText || undefined,
      reasoningSummary: result.reasoningSummary || result.thinking || undefined,
      visibleReasoningSummary: result.reasoningSummary || undefined,
      liveTraceEntries: durableToolStreamTrace,
      turnProviderUsage,
      toolResultBudget,
      goalCompletionReport: result.goalCompletionReport,
    } as any, {
      // Keep the direct subagent transcript on the same compaction contract
      // as every other long-lived thread.
      disableCompactionCheck: false,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    turnTiming.mark('assistant_message_committed', {
      durationMs: Date.now() - assistantPersistStartedAt,
      interrupted: false,
    });
    if (toolLogText) {
      const toolLogPersistStartedAt = Date.now();
      persistToolLog(sessionId, toolLogText);
      turnTiming.mark('tool_log_persisted', { durationMs: Date.now() - toolLogPersistStartedAt });
    }
    }
    if (!isSubagentChatSession && !isSyntheticThreadSupervisionReview) {
      enqueuePostTurnJob({
        sessionId,
        label: 'project_learning_and_auto_title',
        run: async () => {
          const projectLearningStartedAt = Date.now();
          await maybeRefreshProjectLearning(sessionId);
          turnTiming.mark('project_learning_done', {
            durationMs: Date.now() - projectLearningStartedAt,
            deferred: true,
          });

          const autoTitleStartedAt = Date.now();
          const generatedSessionTitle = await maybeAutoNameChatSession(sessionId);
          turnTiming.mark('auto_title_done', {
            durationMs: Date.now() - autoTitleStartedAt,
            generated: !!generatedSessionTitle,
            deferred: true,
          });
          if (generatedSessionTitle) {
            broadcastWS({
              type: 'session_title',
              sessionId,
              title: generatedSessionTitle,
              autoTitleLocked: true,
            });
          }
        },
      });
      turnTiming.mark('post_turn_work_enqueued', { kind: 'project_learning_and_auto_title' });
    }
  }

    turnTiming.mark('turn_postprocessing_done');
    const streamCompletionStartedAt = Date.now();
    completeLocalMainChatStream(result);
    turnTiming.mark('main_stream_completed', { durationMs: Date.now() - streamCompletionStartedAt });
    return result;
  } finally {
    if (localMainChatStream && !localMainChatStreamCompleted) {
      appendMainChatStreamEvent(sessionId, localMainChatStream.streamId, 'done', {
        reply: '',
        mode: 'chat',
        sections: [],
      });
      localMainChatStreamCompleted = true;
    }
    if (localMainChatStream) finishMainChatStream(sessionId, localMainChatStream.streamId);
  }
  } finally {
    turnTiming.mark('lease_release');
    if (ownedTurnRuntimeId) {
      try { finishLiveRuntime(ownedTurnRuntimeId); } catch {}
    }
    runtimeAdmissionLease?.release();
    // The HTTP admission path acquires atomically before creating a stream;
    // its outer finally owns release so every visible/server state transition
    // is completed together. Other callers retain the original local lease.
    if (!preAcquiredTurnLease) mainChatTurnCoordinator.release(turnLease);
  }
}
