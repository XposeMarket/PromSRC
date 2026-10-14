import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { extractTurnFileTouches, mergeTurnFileTouches, type TurnFileTouch } from '../../../file-change-summary';
import {
  blockMainChatGoalFromOwner,
  buildMainChatGoalCompletionReport,
  buildMainChatGoalContinuationPrompt,
  getAllMainChatGoalRecords,
  handleMainChatGoalCommand,
  stopMainChatGoalByUser,
  canAutomaticallyResumeMainChatGoal,
  isMainChatGoalContinuation,
  maybeSummarizeMainChatGoal,
  recordMainChatGoalTurnPlanProgress,
  recordMainChatGoalDeniedAction,
  recordMainChatGoalRuntimeFailure,
  recordMainChatGoalContinuationBoundary,
  recordMainChatGoalRequirement,
  resolveMainChatGoalPolicy,
  snapshotMainChatGoal,
  completeMainChatGoalFromOwner,
} from '../../../main-chat-goals';
import {
  wss as _wssRef, setWss,
  broadcastWS,
  broadcastTeamEvent,
  addTeamSseClient,
  removeTeamSseClient,
  sendTeamNotificationToChannels,
  sendDiscordNotification,
  sendWhatsAppNotification,
  resolveChannelsConfig,
  setTelegramChannelForBroadcaster,
  isModelBusy, setModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  setSessionChannelHint,
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
  isGatewayDraining,
} from '../../../comms/broadcaster';
import {
  registerLiveRuntime,
  finishLiveRuntime,
  hasTerminalRuntimeCheckpoint,
  updateLiveRuntimeCheckpoint,
  markLiveRuntimeProgress,
  interruptLiveRuntimeForRecovery,
  listLiveRuntimes,
  listInterruptedRuntimes,
  getLiveRuntime,
  abortLiveRuntime,
  addPendingRuntimeSteer,
  consumePendingRuntimeSteersForSession,
  isSteerableChatRuntimeKind,
  stripInheritedRecoveryMarks,
  type RuntimeSteerEvent,
} from '../../../live-runtime-registry';
import {
  // Core exports
  buildTools,
  executeTool,
  _dispatchToAgent,
  initChatHelpers,
  buildPersonalityContext,
  // Stats / maps
  getOrchestrationSessionStats,
  orchestrationSessionStats,
  recordOrchestrationEvent,
  ensureMultiAgentSkill,
  getPreemptSessionCount,
  incrementPreemptSessionCount,
  // Types
  type SubagentProfile,
  type HandleChatResult,
  type RuntimeProgressItem,
  // Skills
  resolveSkillsDir,
  configuredSkillsDir,
  fallbackSkillsDir,
  syncMissingSkills,
  migrateSkillsStateIfMissing,
  // Progress
  prettifyToolName,
  buildProgressItems,
  // Tool call helpers
  logToolCall,
  isBrowserToolName,
  isDesktopToolName,
  isDesktopVisualToolName,
  buildBrowserAck,
  wrapUntrustedBrowserToolContent,
  buildDesktopAck,
  buildDesktopScreenshotContent,
  buildVisionScreenshotMessage,
  // Chat intent classifiers
  isExecutionLikeRequest,
  isContinuationCue,
  hasPendingExecutionIntent,
  isHardBlockerReply,
  hasConcreteCompletion,
  autoActivateToolCategories,
  // File helpers
  isHighStakesFile,
  requestedFullTemplate,
  resolveWorkspaceFilePath,
  collectFileSnapshots,
  // Browser quality
  goalIsInteractiveAction,
  isBrowserHeavyResearchPage,
  goalLikelyNeedsTextInput,
  parseSnapshotDiagnostics,
  evaluateBrowserSnapshotQuality,
} from '../../../chat/chat-helpers';


interface GoalRunnerDependencies {
  activeMainChatGoalRuns: typeof import('./text-guards').activeMainChatGoalRuns;
  broadcastMainChatGoalState: typeof import('./text-guards').broadcastMainChatGoalState;
  runInteractiveTurn: typeof import('./interactive-turn').runInteractiveTurn;
  appendRuntimeNarrationBoundary: typeof import('../../chat.router').appendRuntimeNarrationBoundary;
  runtimeProcessEntryFromSseEvent: typeof import('../../chat.router').runtimeProcessEntryFromSseEvent;
  appendRuntimeFileTouch: typeof import('../../chat.router').appendRuntimeFileTouch;
  attachRuntimeProcessEntriesToLatestAssistant: typeof import('./stream').attachRuntimeProcessEntriesToLatestAssistant;
  delayMs: typeof import('./text-guards').delayMs;
}
let activeMainChatGoalRuns: GoalRunnerDependencies['activeMainChatGoalRuns'];
let broadcastMainChatGoalState: GoalRunnerDependencies['broadcastMainChatGoalState'];
let runInteractiveTurn: GoalRunnerDependencies['runInteractiveTurn'];
let appendRuntimeNarrationBoundary: GoalRunnerDependencies['appendRuntimeNarrationBoundary'];
let runtimeProcessEntryFromSseEvent: GoalRunnerDependencies['runtimeProcessEntryFromSseEvent'];
let appendRuntimeFileTouch: GoalRunnerDependencies['appendRuntimeFileTouch'];
let attachRuntimeProcessEntriesToLatestAssistant: GoalRunnerDependencies['attachRuntimeProcessEntriesToLatestAssistant'];
let delayMs: GoalRunnerDependencies['delayMs'];
export function configureGoalRunnerDependencies(deps: GoalRunnerDependencies): void {
  ({ activeMainChatGoalRuns, broadcastMainChatGoalState, runInteractiveTurn, appendRuntimeNarrationBoundary, runtimeProcessEntryFromSseEvent, appendRuntimeFileTouch, attachRuntimeProcessEntriesToLatestAssistant, delayMs } = deps);
}


export function startMainChatGoalRunner(sessionId: string, source = 'goal_command'): void {
  const sid = String(sessionId || '').trim();
  if (!sid || activeMainChatGoalRuns.has(sid)) return;
  const initial = snapshotMainChatGoal(sid);
  if (!initial || initial.status !== 'active') return;
  activeMainChatGoalRuns.add(sid);
  broadcastMainChatGoalState(sid, 'runner_started', { source });

  void (async () => {
    try {
      while (true) {
        const current = snapshotMainChatGoal(sid);
        if (!current || current.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: current?.status || 'no_goal' });
          return;
        }

        // Admission is visible immediately. Context/model preparation can take
        // seconds, but it is still part of the active Goal turn rather than a
        // silent gap after the command acknowledgement.
        const turnPreparingAt = Date.now();
        broadcastMainChatGoalState(sid, 'turn_preparing', {
          source,
          message: 'Goal accepted. Preparing the first action.',
          preparingAt: turnPreparingAt,
        });
        const prompt = buildMainChatGoalContinuationPrompt(current);
        const abortController = new AbortController();
        const abortSignal = { aborted: false, signal: abortController.signal };
        (abortSignal as any).abort = (reason?: string) => {
          const normalizedReason = String(reason || 'operator_abort').slice(0, 160);
          if (normalizedReason === 'operator_abort') stopMainChatGoalByUser(sid);
          abortSignal.aborted = true;
          if (!abortSignal.signal.aborted) abortController.abort(normalizedReason);
        };
        const runtimeId = registerLiveRuntime({
          kind: 'main_chat_goal',
          label: 'Main chat goal',
          sessionId: sid,
          source: 'goal',
          detail: current.goal.slice(0, 160),
          abortSignal,
          deferTerminalCleanup: true,
          onAbort: () => (abortSignal as any).abort?.('operator_abort'),
        });
        const runtimeGoalTurnNumber = Math.max(1, Number(current.restartCheckpoint?.turnNumber || current.turnsUsed + 1));
        const runtimeGoalIterationNumber = Math.max(1, Number(current.currentIteration || 1));
        updateLiveRuntimeCheckpoint(runtimeId, {
          event: 'goal_turn_preparing',
          at: turnPreparingAt,
          message: 'Goal accepted. Preparing the first action.',
          activeRunKind: 'main_chat_goal',
          goalId: current.id,
        });
        updateLiveRuntimeCheckpoint(runtimeId, {
          event: 'goal_turn_identity',
          at: Date.now(),
          activeRunKind: 'main_chat_goal',
          goalId: current.id,
          goalTurnNumber: runtimeGoalTurnNumber,
          goalIterationNumber: runtimeGoalIterationNumber,
          goalTurnId: `${current.id}:turn:${runtimeGoalTurnNumber}:iteration:${runtimeGoalIterationNumber}`,
        });
        setModelBusy(true);
        const turnStartedAt = Date.now();
        broadcastMainChatGoalState(sid, 'turn_started', { turnsUsed: current.turnsUsed });
        const runtimeProcessEntries: Record<string, any>[] = [];
        // Durable path-only list of files this turn changed; survives restarts.
        const runtimeFileTouches: TurnFileTouch[] = [];
        let runtimeThinkingTail = '';
        let runtimeNarrationTail = '';
        let lastRuntimeNarrationCheckpointAt = 0;

        let result: HandleChatResult | null = null;
        try {
          result = await runInteractiveTurn(
            prompt,
            sid,
            (event, data) => {
              const checkpoint: Record<string, any> = { event, at: Date.now() };
              if (event === 'token') {
                const token = String(data?.text || '').trim();
                if (token) runtimeNarrationTail = `${runtimeNarrationTail}${data?.text || ''}`.slice(-12_000);
                const now = Date.now();
                const persistNarrationCheckpoint = !!runtimeNarrationTail
                  && now - lastRuntimeNarrationCheckpointAt >= 2_000;
                if (persistNarrationCheckpoint) lastRuntimeNarrationCheckpointAt = now;
                updateLiveRuntimeCheckpoint(runtimeId, {
                  event,
                  at: now,
                  narrationTail: runtimeNarrationTail,
                  ...(runtimeThinkingTail ? { thinkingTail: runtimeThinkingTail } : {}),
                  ...(runtimeProcessEntries.length ? { processEntries: [...runtimeProcessEntries] } : {}),
                }, { persist: persistNarrationCheckpoint });
                return;
              }
              if (event === 'tool_call' && runtimeNarrationTail.trim()) {
                appendRuntimeNarrationBoundary(runtimeProcessEntries, runtimeNarrationTail);
                runtimeNarrationTail = '';
              }
              if (data?.message) checkpoint.message = String(data.message).slice(0, 1000);
              if (data?.action || data?.name) checkpoint.toolName = String(data.action || data.name);
              if (data?.args && typeof data.args === 'object') checkpoint.args = data.args;
              if (data?.result) checkpoint.result = String(data.result).slice(0, 1000);
              if (event === 'thinking_delta') {
                const delta = String(data?.thinking || data?.text || '').trim();
                if (delta) runtimeThinkingTail = `${runtimeThinkingTail}${delta}`.slice(-4000);
                checkpoint.thinkingTail = runtimeThinkingTail;
              } else {
                const processEntry = runtimeProcessEntryFromSseEvent(event, data);
                if (processEntry) {
                  runtimeProcessEntries.push(processEntry);
                  if (runtimeProcessEntries.length > 12_000) {
                    runtimeProcessEntries.splice(0, runtimeProcessEntries.length - 12_000);
                  }
                  checkpoint.processEntries = [...runtimeProcessEntries];
                  if (appendRuntimeFileTouch(runtimeFileTouches, event, data, processEntry)) {
                    checkpoint.fileTouches = [...runtimeFileTouches];
                  }
                }
                if (event === 'thinking') {
                  const thinking = String(data?.thinking || data?.text || '').trim();
                  if (thinking) runtimeThinkingTail = `${runtimeThinkingTail}\n${thinking}`.trim().slice(-4000);
                }
                if (runtimeThinkingTail) checkpoint.thinkingTail = runtimeThinkingTail;
                checkpoint.narrationTail = runtimeNarrationTail;
              }
              updateLiveRuntimeCheckpoint(runtimeId, checkpoint);
              try {
                broadcastWS({ type: 'main_chat_goal_sse', sessionId: sid, event, ...data });
              } catch {}
            },
            undefined,
            abortSignal,
            'CONTEXT: Synthetic continuation turn for active main-chat goal mode.',
            undefined,
            undefined,
            undefined,
            undefined,
            { syntheticGoalContinuation: true, runtimeId } as any,
          );
          const goalTurnNumber = Math.max(1, Number(current.restartCheckpoint?.turnNumber || current.turnsUsed + 1));
          const goalIterationNumber = Math.max(1, Number(current.currentIteration || 1));
          attachRuntimeProcessEntriesToLatestAssistant(sid, runtimeProcessEntries, {
            goalId: current.id,
            goalTurnNumber,
            goalTurnId: `${current.id}:turn:${goalTurnNumber}:iteration:${goalIterationNumber}`,
          });
        } catch (err: any) {
          const failed = recordMainChatGoalRuntimeFailure(sid, current.id, err?.message || String(err));
          broadcastMainChatGoalState(sid, 'runtime_failure', { error: err?.message || String(err), goal: failed });
          if (!failed || failed.status !== 'active') return;
          await delayMs(750);
          continue;
        } finally {
          setModelBusy(false);
          finishLiveRuntime(runtimeId);
        }

        const latest = snapshotMainChatGoal(sid);
        if (!latest || latest.id !== current.id || latest.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: latest?.status || 'goal_changed' });
          return;
        }

        const toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
        const completionVerificationRan = toolResults.some((entry: any) => (
          String(entry?.name || '').trim() === 'complete_goal'
          && /Goal completion (?:accepted|was not accepted)/i.test(String(entry?.result || entry?.content || ''))
        ));
        const lifecycleOnlyTools = new Set([
          'declare_plan', 'complete_plan_step', 'step_complete',
          'request_tool_category', 'switch_model', 'set_current_model',
          'tool_loop_continue', 'complete_goal', 'block_goal',
        ]);
        const successfulToolCalls = toolResults.filter((entry: any) => entry && entry.error !== true).length;
        const failedToolCalls = toolResults.filter((entry: any) => entry?.error === true).length;
        const meaningfulToolCalls = toolResults.filter((entry: any) => {
          const name = String(entry?.name || '').trim();
          return !!name && entry?.error !== true && !lifecycleOnlyTools.has(name);
        }).length;
        // Steers are mirrored into durable chat history for the normal workflow
        // UI, but they were already injected into this runtime. Only a genuinely
        // separate user turn should suppress the next autonomous goal iteration.
        const queuedUserInput = getHistory(sid, 12).some((message) => (
          message.role === 'user'
          && Number(message.timestamp || 0) > turnStartedAt
          && String(message.channel || '') !== 'system'
          && String(message.channelLabel || '').trim().toLowerCase() !== 'steer'
          && String((message as any).workflowPart || '').trim().toLowerCase() !== 'interruption'
        ));
        if (queuedUserInput) {
          broadcastMainChatGoalState(sid, 'continuation_suppressed', { reason: 'user_input_queued' });
          return;
        }

        // A rejected complete_goal already recorded verifier feedback and the
        // next directive. Continue from that result without a second lifecycle
        // decision or another judge call.
        if (!completionVerificationRan) {
          const boundary = recordMainChatGoalContinuationBoundary(sid, latest.id, {
            successfulToolCalls,
            meaningfulToolCalls,
            failedToolCalls,
            responseText: String(result?.text || ''),
          });
          broadcastMainChatGoalState(sid, boundary.shouldContinue ? 'continuation_scheduled' : 'continuation_suppressed', {
            reason: boundary.reason,
            toolStats: { successfulToolCalls, meaningfulToolCalls, failedToolCalls },
            goal: boundary.goal,
          });
          if (!boundary.shouldContinue) return;
        } else {
          broadcastMainChatGoalState(sid, 'completion_rejected_continue', { goal: latest });
        }

        const summarized = await maybeSummarizeMainChatGoal(sid);
        if (summarized?.lastSummaryAt && summarized.goalSummaryTurn === summarized.turnsUsed) {
          broadcastMainChatGoalState(sid, 'summarized', { goal: summarized });
        }
        await delayMs(350);
      }
    } finally {
      activeMainChatGoalRuns.delete(sid);
      broadcastMainChatGoalState(sid, 'runner_idle');
    }
  })();
}

export function resumeMainChatGoalsInterruptedForRestart(targetSessionIds?: string[]): string[] {
  const policy = resolveMainChatGoalPolicy();
  if (!policy.enabled || !policy.autoResumeOnRestart) return [];
  const resumed: string[] = [];
  const hasExplicitTargets = targetSessionIds !== undefined;
  const requested = new Set((targetSessionIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const records = hasExplicitTargets
    ? Array.from(requested).map((sessionId) => ({
        sessionId,
        current: true,
        goal: snapshotMainChatGoal(sessionId),
      }))
    : getAllMainChatGoalRecords();
  for (const record of records) {
    const goal = (record as any)?.goal || record;
    if ((record as any)?.current === false) continue;
    const sessionId = String((record as any)?.sessionId || goal?.sessionId || '').trim();
    if (requested.size > 0 && !requested.has(sessionId)) continue;
    if (!canAutomaticallyResumeMainChatGoal(goal)) continue;
    if (!sessionId || !['restarting', 'paused'].includes(String(goal?.status || ''))) continue;
    const pausedReason = String(goal?.pausedReason || goal?.paused_reason || '').toLowerCase();
    const checkpointReason = String(goal?.restartCheckpoint?.reason || '').toLowerCase();
    const checkpointPhase = String(goal?.restartCheckpoint?.phase || '').toLowerCase();
    const bootFinalized = checkpointPhase === 'boot_finalized' || checkpointPhase === 'resuming';
    if (!bootFinalized && !/gateway_restart|gateway_crash|restart|prom_apply_dev_changes/.test(`${pausedReason} ${checkpointReason}`)) continue;
    if (checkpointPhase === 'crash_recovered') {
      broadcastMainChatGoalState(sessionId, 'startup_crash_recovered', { goal });
    }
    const result = handleMainChatGoalCommand(sessionId, '/goal resume');
    if (result.goal?.status === 'active') {
      startMainChatGoalRunner(sessionId, 'startup_auto_resume');
      broadcastMainChatGoalState(sessionId, 'startup_auto_resume', { goal: result.goal });
      resumed.push(sessionId);
    }
  }
  return Array.from(new Set(resumed));
}
