import { isCompactionSummaryMessage, extractLastCompactionSummary, formatCompactionMessageBody, formatCompactionMessages, formatCompactionToolResults, formatCompactionArtifactPaths, ContextCompactorRunInput, buildContextCompactionPrompt, runContextCompactor, maybeRunMidWorkflowCompaction, configureCompactionDependencies } from './chat/pipeline/compaction';
export { isCompactionSummaryMessage, extractLastCompactionSummary, formatCompactionMessageBody, formatCompactionMessages, formatCompactionToolResults, formatCompactionArtifactPaths, ContextCompactorRunInput, buildContextCompactionPrompt, runContextCompactor, maybeRunMidWorkflowCompaction } from './chat/pipeline/compaction';
import { handleChat, handleChatUntraced, editRerunAbortResetSessions, configureHandleChatDependencies } from './chat/pipeline/handle-chat';
export { handleChatUntraced, editRerunAbortResetSessions } from './chat/pipeline/handle-chat';
import { maybeRefreshProjectLearning, activeMainChatGoalRuns, broadcastMainChatGoalState, delayMs, isGrokGenerationOverride, isGrokGreetingLikeMessage, INVISIBLE_FILLER_RUN, hasRunawayInvisibleTail, stripInvisibleFillerRuns, trimGrokRunawayRepetition, getParentheticalRuns, isLikelyGrokInlineLoop, trimGrokInlineLoop, shouldCheckBlockedTaskFollowup } from './chat/pipeline/text-guards';
export { maybeRefreshProjectLearning, activeMainChatGoalRuns, broadcastMainChatGoalState, delayMs, isGrokGenerationOverride, isGrokGreetingLikeMessage, INVISIBLE_FILLER_RUN, hasRunawayInvisibleTail, stripInvisibleFillerRuns, trimGrokRunawayRepetition, getParentheticalRuns, isLikelyGrokInlineLoop, trimGrokInlineLoop, shouldCheckBlockedTaskFollowup } from './chat/pipeline/text-guards';
import { startMainChatGoalRunner, resumeMainChatGoalsInterruptedForRestart, configureGoalRunnerDependencies } from './chat/pipeline/goal-runner';
export { startMainChatGoalRunner, resumeMainChatGoalsInterruptedForRestart } from './chat/pipeline/goal-runner';
import { cleanGeneratedSessionTitle, sessionTitleTranscript, maybeAutoNameChatSession } from './chat/pipeline/session-title';
export { cleanGeneratedSessionTitle, sessionTitleTranscript, maybeAutoNameChatSession } from './chat/pipeline/session-title';
import { runInteractiveTurn, configureInteractiveTurnDependencies } from './chat/pipeline/interactive-turn';
export {  } from './chat/pipeline/interactive-turn';
import { describeRestartProvenance, extractPreRestartArtifacts, buildPreRestartWorkDigest, pendingBackgroundWakeRetries, wakeInterruptedBackgroundOwner, retriggerInterruptedMainChat, announceRestartContinuityResumed, configureRestartContinuityDependencies } from './chat/pipeline/restart-continuity';
export { describeRestartProvenance, extractPreRestartArtifacts, buildPreRestartWorkDigest, pendingBackgroundWakeRetries, wakeInterruptedBackgroundOwner, retriggerInterruptedMainChat, announceRestartContinuityResumed } from './chat/pipeline/restart-continuity';
import { createSSESender, streamExistingMainChatToResponse, inferTaskChannelFromSession, parseTelegramChatIdFromSessionId, bindTeamNotificationTargetFromSession, attachRuntimeProcessEntriesToLatestAssistant, withBackgroundJoinKeepalive, normalizeExcludedSkillIdsInput, normalizeForcedSkillIdsInput, configureStreamDependencies } from './chat/pipeline/stream';
export { createSSESender, streamExistingMainChatToResponse, inferTaskChannelFromSession, parseTelegramChatIdFromSessionId, attachRuntimeProcessEntriesToLatestAssistant, withBackgroundJoinKeepalive, normalizeExcludedSkillIdsInput, normalizeForcedSkillIdsInput } from './chat/pipeline/stream';
import { sanitizeDurableMediaDescriptorForUi, isTransientLiveTraceEntryForUi, LIVE_TRACE_HEAD_RETENTION_RATIO } from './chat/shared';
import { registerTracesRoutes } from './chat/traces';
import { registerStatusRoutes } from './chat/status';
import { registerMobileRoutes } from './chat/mobile';
import { registerEmailComposerRoutes } from './chat/email-composer';
import { splitComposerEmailList, findStoredEmailComposerArtifact, buildSentEmailComposerArtifact } from './chat/email-composer';
import { registerSteerRoutes } from './chat/steer';
import { registerPushRoutes } from './chat/push';
import { configureContextWindowDependencies } from './chat/context-window';
import { estimateJsonTokensForModel, safeTokenSessionFileName, rawToolTokenCache, estimateToolObservationRawTokens, estimateStoredThreadFootprint, aggregateModelUsageEvents, aggregateSessionModelUsage, summarizeTurnToolResultBudget, buildActiveSkillsContextEstimate, ContextWindowRow, allocateContextChildren, friendlyContextToolCategory, estimateCurrentSystemToolSchemaTokens, estimateCurrentSystemPromptTokens, buildSystemToolSchemaChildren, buildContextWindowSubagentsRosterEstimate, getLastUserContextText, isBrainMemoryContextSession, resolveContextWindowMemoryMode, buildContextWindowMemoryAtomEstimate, buildContextWindowThoughtPacketEstimate, buildSystemPromptChildren, buildProviderUsageGroup, buildToolUsageGroup, buildContextWindowCurrentState } from './chat/context-window';
export { buildContextWindowCurrentState } from './chat/context-window';
import { registerSessionsRoutes } from './chat/sessions';
import { registerSessionsDetailRoutes } from './chat/sessions';
import { markActiveRunsOnSessionList, attachProjectMembershipToSessionList, isMobileHistorySyncRequest, isMobileVisualStateSyncRequest, timelineHistoryMessages, firstUserMessageKey, wouldDangerouslyReplaceSessionHistory } from './chat/sessions';
import { normalizeRuntimeVisionAttachmentsInput, normalizeRuntimeAttachmentPreviewsInput, getOrchestrationConfig, truncateRuntimeProcessText, summarizeMobileRuntime, isLiveRunningRuntime, sessionProcessLogFromHistory, boundedPositiveInt, sanitizeUiProcessValue, sanitizeProcessEntryForUi, sanitizeAttachmentPreviewForUi, sanitizeMessageMediaForUi, trimLiveTraceStringLeaves, sanitizeLiveTraceEntriesForUi, compactFileChangeFilesForUi, sanitizeHistoryForUiResponse, MainChatTurnReconciliation } from './chat/shared';
export { compactFileChangeFilesForUi } from './chat/shared';
import { registerRealtimeVoiceRoutes, REALTIME_AGENT_CLIENT_SECRETS_ENDPOINT, DEFAULT_REALTIME_AGENT_MODEL, DEFAULT_REALTIME_AGENT_VOICE, DEFAULT_REALTIME_AGENT_TRANSCRIPTION_MODEL, PUBLIC_REALTIME_AGENT_VOICE_IDS, REALTIME_AGENT_INSTRUCTIONS_MAX, realtimeAgentCallTokens, getRealtimeAgentApiKey, RealtimeAgentAuthCandidate, getJwtExpiryMs, loadRealtimeAgentOpenAiCodexTokens, getRealtimeAgentAuthCandidates, sanitizeRealtimeAgentVoice, sanitizePublicRealtimeAgentVoice, sanitizeRealtimeAgentModel, sanitizeRealtimeAgentSpeed, clampRealtimeInstructions, buildRealtimeVoiceAgentTools, buildRealtimeVoiceAgentInstructions, mobileCameraRuntimeContextText } from './chat/voice/realtime';
import { registerXaiVoiceRoutes, XAI_REALTIME_CLIENT_SECRETS_ENDPOINT, XAI_VOICE_CATALOG_ENDPOINT, XAI_REALTIME_WS_BASE, DEFAULT_XAI_REALTIME_MODEL, DEFAULT_XAI_REALTIME_VOICE, XAI_REALTIME_USER_AGENT, XAI_REALTIME_VOICE_IDS, XaiRealtimeAuthCandidate, getXaiRealtimeAuthCandidates, getXaiRealtimeVoices, sanitizeXaiRealtimeModel, sanitizeXaiRealtimeVoice, sanitizeXaiRealtimeSpeed } from './chat/voice/xai';
import { registerDispatchVoiceRoutes, NormalizedVoiceDispatchTask, NormalizedPrimaryVoiceWorker, compactVoiceDispatchTitle, normalizeVoiceDispatchMode, normalizeVoiceDispatchDelivery, normalizeVoiceDispatchTasks, normalizePrimaryVoiceWorker } from './chat/voice/dispatch';
import { registerRoomsVoiceRoutes, normalizeVoiceRoomParticipants } from './chat/voice/rooms';
import { configureVoiceDependencies, configureVoiceSingletons } from './chat/voice/dependencies';
import { registerVoiceRoutes } from './chat/voice/routes';
import { createVoiceNarrator, classifyVoiceInterruption, buildVoiceInterruptionContextBlock, buildChatSteerContextBlock, appendVoiceInterruptionLog } from './chat/voice/narrator';
import { VoiceAgentTargetContext, normalizeVoiceAgentTarget, voiceAgentTargetIdentity, loadVoiceAgentMemoryForTarget, voiceAgentWorkerHandoffSessions, findActiveMainChatRuntimeForSession, compactVoiceText, summarizeUnlockedToolCategories, buildVoiceConversationTranscript, buildVoiceCompactionSummaryBlock, buildVoiceRecentToolLog, buildVoiceWorkerContextPacket, getReusableVoiceContextPacket, getVoiceAgentContextBlock } from './chat/voice/context';
import { decideVoiceAgentAction, voiceSteerKindFromIntent, buildVoiceContextSummaryForSteer, VoiceAgentProcessEntry, takeLastVoiceScreenshotPreview, executeVoiceAgentToolWithTrace } from './chat/voice/decision';
import { buildVoiceTimeContext, buildRealtimeSkillContextForTranscript, voiceRuntimeDirectiveFromToolResult, parseVoiceToolArgs, cleanVoiceWakePhrase } from './chat/voice/tool-helpers';
import { buildVoiceToolDefinitions } from './chat/voice/tool-definitions';
import { buildVoicePrometheusToolsDefinition, VOICE_TOOLS_SUPERSEDED_BY_CORE, voiceCoreToolSurface, toRealtimeFunctionTool, voiceCoreSurfaceSignature } from './chat/voice/core-tools';
export { __voiceToolEntryForTesting } from './chat/voice/core-tools';
import { parseVoiceToolResult, voiceRuntimeContextText } from './chat/voice/fallback';
import { hasRecentVoiceWorkflowUserMessage } from './chat/voice/spoken-reply';
/**
 * routes/chat.router.ts â€” B6 Refactor
 *
 * The chat pipeline: handleChat + /api/chat SSE endpoint + /api/status.
 * Extracted verbatim from server-v2.ts â€” zero logic changes.
 *
 * Module-scope singletons (cronScheduler, telegramChannel, skillsManager)
 * are injected via initChatRouter() â€” same pattern as all other routers.
 */


import express from 'express';
import { slimSessionList, responseEtag } from './perf-projections';
import { claimRuntimeRecovery } from '../runtime/recovery-claims';
import { buildDirectMediaObservationMessage, buildMediaAnalysisPreviewPayloads } from '../media-analysis-preview';
// cors and http moved to core/app.ts + core/server.ts (B3)
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { voiceContextRequestHash, voiceContextEntryMatches } from '../voice/context-cache-key';
import { execFile } from 'child_process';
import { lockFreeGitReadOptions } from '../../runtime/git-read';
import { createTurnTimingRecorder, type TurnTimingRecorder } from '../chat/turn-timing';
import { shouldRecordWorkerBatchTiming } from '../chat/worker-batch-timing';
import { goalReminderForTool } from '../chat/goal-reminder';
import { createMainChatStreamStore, type MainChatStreamFrame, type MainChatStreamState } from '../chat/main-chat-stream-store';
import { ModelResponseRecovery } from '../chat/model-response-recovery';
import { presentProviderCallFailure } from '../chat/provider-error-presentation';
import { attemptModelDigest, buildDeterministicTurnDigest, describeTurnCutoffCause } from '../chat/degraded-turn-finish';
import { fitToolDefinitionsToBudget } from '../tools/schema-compaction';
import { currentTrace, getTrace, listRecentTraces, recordSpan, runInTrace, withSpan } from '../observability/turn-trace';
import { evaluateToolDispatch, resolveIdleRoundLimit, resolveToolSurfaceEnforcementMode, toolNameSetOf, type ToolDispatchDecision } from '../chat/tool-dispatch-policy';
import { createForegroundToolActivityTracker, foregroundConnectionMessage, type ForegroundToolActivity } from '../chat/foreground-tool-activity';
import { ToolPerformanceTracker } from '../chat/tool-performance-telemetry';
import { formatToolCategoryProvisioningFailure, preserveActivatedToolCategoriesForTurnOverride, verifyToolCategorySurface } from '../tool-category-provisioning';
import { normalizeManifestToolCategory } from '../../runtime/tool-category-manifest';
import { getRuntimeToolCategories as getVoiceRuntimeToolCategories } from '../tool-builder';
import { getWorkspaceToolMode } from '../../runtime/workspace-tool-mode';
import { buildOperatingInstructions } from '../../runtime/operating-instructions';
import { digestCanonicalToolArgs, digestPollResult, isPollingToolCall, POLL_LOOP_CRITICAL_THRESHOLD, POLL_LOOP_WARNING_THRESHOLD, previewCanonicalToolArgs } from '../chat/tool-loop-identity';
import { assembleCacheAwareSystemPrompt } from '../prompt-cache';
import { enqueuePostTurnJob, getPostTurnQueueStatus } from '../chat/post-turn-queue';
import { getContextBuildLimiterStatus, runWithContextBuildPermit } from '../chat/context-build-limiter';
import { getContextBuildWorkerPoolStatus } from '../chat/context-build-worker-client';
import {
  ChatHistoryCursorError,
  historyMessageCursorKey,
  paginateChatHistory,
} from '../chat/history-cursor';

// WebSocketServer + WebSocket moved to core/server.ts (B3)
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../config/config';
import {
  buildCodexCloudflareHeaders,
  getValidToken as getOpenAiCodexToken,
  loadTokens as loadOpenAiCodexTokens,
  refreshTokens as refreshOpenAiCodexTokens,
} from '../../auth/openai-oauth.js';
import { getConfiguredXaiCredentialSummary, getXaiAuthCandidates } from '../../auth/xai-account-pool.js';
import { getVault } from '../../security/vault';
import { isOnboardingSession, getMeetAndGreetSystemPrompt } from '../onboarding/meet-prompt';
import { getOllamaClient } from '../../agents/ollama-client';
import { parseProviderModelRef } from '../../agents/model-routing.js';
import {
  captureModelUsageLogCursor,
  readModelUsageEventsForSession,
  readModelUsageEventsSince,
  getUsageCalibration,
  resolveProviderPromptTokens,
  type ModelUsageEvent,
} from '../../providers/model-usage';
import { estimateContextCostMicros, resolveModelPricing } from '../../providers/model-pricing';
import { normalizeReasoningEffort } from '../../providers/reasoning-capabilities';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../session';
import { SessionSettlementError, settleSessionWithGuards, unsettleSessionSafely } from '../session-settlement';
import { clearChatModelRoute, setChatModelRoute } from '../session';
import { mergeHistoryWithExistingMessageMetadata } from '../history-reconciliation';
import { buildDurableChatTraceFromFrames, buildDurableChatTraceFromProcessEntries } from '../durable-chat-trace';
import { extractTurnFileTouches, mergeTurnFileTouches, type TurnFileTouch } from '../file-change-summary';
import {
  appendDurableCommentaryContext,
  buildDurableCommentaryContext,
} from '../context/commentary-context';
import { getSubagentChatHistory } from '../agents-runtime/subagent-chat-store';
import { BrainRunBudget, type BrainRunBudgetOptions } from '../agents-runtime/brain-run-budget';
import {
  collectRichArtifacts,
  extractVisualArtifactsFromMarkdown,
  normalizeProductArtifactItems,
  normalizeSourceArtifactItems,
  productCarouselToArtifact,
} from '../rich-artifacts';
import { getConnector, isConnectorConnected } from '../../integrations/connector-registry.js';
import type { GmailConnector } from '../../integrations/connectors/gmail.js';
import { gmailSendOptionsFromArgs } from '../../extensions/bundled/connectors/gmail/runtime.js';
import { executeMarketLookup } from '../../tools/market';
import { executeStockLookup } from '../../tools/stocks';
import { executeWeatherLookup } from '../../tools/weather';
import { executePolymarketLookup } from '../../tools/polymarket';
import { executeMapLookup } from '../../tools/mapcard';
import { buildContextBudget, estimateMessageTokenBreakdownForModel, estimateMessagesTokensForModel, estimateTextTokensForModel, resolveActiveModelContextProfile } from '../context/model-context';
import { runCompactionTransaction } from '../context/compaction-safety';
import { captureTurnRouteSnapshot, type TurnRouteSnapshot } from '../chat/turn-route-snapshot';
import { captureChatTurnRouteSnapshot, ChatModelRouteUnavailableError, resolveChatModelRouteSource, validateChatModelRoute } from '../chat/chat-model-route';
import { deriveContextWindowUsage } from '../context/context-window-usage';
import { createToolObservationsFromResults, formatToolStateSummaryForContext, persistToolResultsAsObservations, readToolObservationSnapshot, readToolObservations, type ToolObservation, type ToolObservationSnapshot } from '../tool-observations';
import { envelopeOversizedToolResult } from '../tool-result-envelope';
import { boundToolMessageContentForModelContext } from '../tool-result-model-context';
import { hookBus } from '../hooks';
import { loadWorkspaceHooks } from '../hook-loader';
import { runBootMd } from '../boot';
import { ensurePrometheusThreadOpsForSupervision, getAgentTeamScheduleTools } from '../tools/defs/agent-team-schedule';
import { buildCisContextBlock } from '../business/cis-context-builder.js';
import { refreshProjectContextForSession } from '../projects/project-learning.js';
import { buildProjectContextBlock, findProjectBySessionId, listProjects, removeSessionFromProject } from '../projects/project-store.js';
import { assertSafeStorageId, isStorageBoundaryError } from '../storage/storage-paths.js';
import { bgPlanDeclare, bgPlanAdvance, backgroundJoin, backgroundStatus, backgroundAbort, backgroundSteer, listActiveBackgroundIdsForSession, registerBackgroundCompletionWake } from '../tasks/task-runner';
import { formatBackgroundSpawnContinuity } from '../tasks/background-spawn-continuity';
import { setupErrorResponseEndpoint } from '../errors/error-response-endpoint-integrated';
import { initCredentialHandler, getCredentialHandler } from '../../security/credential-handler';
import { getVerificationFlowManager, getApprovalQueue } from '../verification-flow';
import { getPrometheusQuestionQueue } from '../prometheus-questions';
import { getErrorAnalyzer } from '../errors/error-analyzer';
import { getErrorHistory } from '../errors/error-history';
import { getRetryStrategy } from '../retry-strategy';
import { getVisualErrorDetector } from '../visual-error-detection';
import { getErrorAudit } from '../../security/error-audit';
import { getContextInjectionManager } from '../context-injection';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { rankSkillsForQuery } from '../agents-runtime/capabilities/skills-executor';
import { buildSelfReflectionInstruction } from '../../config/self-reflection.js';
import { loadSoul } from '../../config/soul-loader.js';
import { readAgentPromptFile } from '../../agents/agent-prompt-file.js';
import { buildRuntimeActorRoleContract, getRuntimeActorContext, isDistinctRuntimeActor } from '../runtime-actor.js';
import { recordSkillGardenerTurn } from '../brain/skill-episodes.js';
import { recordContextReceiptOutcome } from '../../runtime/context-receipt';
import type { RetrievalTrace } from '../../runtime/retrieval-provenance';
import { recordLearningTurn } from '../learning/turn-recorder.js';
import { getSkillRoutingReport } from '../../runtime/skill-routing-resolver.js';
import { buildAttachmentRuntimeContext, appendAttachmentContextToMessage, normalizeRuntimeVisionAttachments, type RuntimeVisionAttachment } from '../chat/attachment-context';
import { autoAttachChatInputResources, getResourceStore, redactResourceText, type ResourceContextResult } from '../resources/resource-store';
import { decideTurnAdmission, mainChatTurnCoordinator, type SessionTurnLease } from '../chat/turn-coordinator';
import {
  MAIN_CHAT_MAX_AGE_MS,
  MAIN_CHAT_ORPHAN_GRACE_MS,
  MAIN_CHAT_ABORT_SETTLE_GRACE_MS,
  MAIN_CHAT_SEMANTIC_STALL_MS,
  isMainChatExecutionAgeExceeded,
  isLiveBackgroundJoin,
  isBlockingWaitInFlight,
  resolveMainChatAbortSettlement,
  isMainChatSemanticProgressStalled,
  isMainChatStreamOwnerOrphaned,
} from '../chat/main-chat-execution-owner';
import { gatewayRuntimeAdmission, type RuntimeAdmissionLease, type RuntimeAdmissionLane, type RuntimeAdmissionBudget } from '../runtime-admission';
import {
  browserOpen,
  browserSnapshot,
  browserSnapshotDelta,
  browserClick,
  browserFill,
  browserPressKey,
  browserType,
  browserWait,
  browserScroll,
  browserDrag,
  browserClose,
  formatBrowserInteractionContextBlock,
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
  browserGetFocusedItem,
  browserGetPageText,
  getLastBrowserScreenshot,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  getBrowserAdvisorPacket,
  listBrowserSessions,
  type BrowserAdvisorPacket,
  type BrowserObserveMode,
  resolveBrowserObserveMode,
} from '../browser-tools';
import {
  seedDefaultShortcuts,
  getAllShortcuts,
  saveSiteShortcut,
  deleteSiteShortcut,
  listKnownHosts,
  getShortcutsForUrl,
} from '../site-shortcuts';
import {
  desktopFindWindow,
  desktopFocusWindowVerified,
  desktopWindowControl,
  desktopClick,
  desktopDrag,
  desktopScroll,
  desktopWait,
  desktopType,
  desktopTypeRaw,
  desktopPressKey,
  desktopGetClipboard,
  desktopSetClipboard,
  // Phase 4
  desktopLaunchApp,
  desktopCloseApp,
  desktopGetProcessList,
  // Phase 3
  desktopWaitForChange,
  desktopDiffScreenshot,
  desktopScreenshotWithHistory,
  desktopWindowScreenshot,
  parseDesktopScreenshotToolArgs,
  parseDesktopPointerMonitorArgs,
  resolveDesktopActionPoint,
  getDesktopAdvisorPacketById,
  desktopGetActiveMonitorIndex,
  desktopGetMonitors,
  desktopGetMonitorsSummary,
  desktopFindInstalledApp,
  desktopListWindowsCanonical,
  desktopFocusWindowCanonical,
  desktopWindowClick,
  desktopWindowType,
  desktopWindowPressKey,
  desktopWindowScroll,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../desktop-tools';
import { desktopBackgroundReleaseSession } from '../desktop-background';
// import { runDesktopTask } from '../tasks/desktop-task-runner'; // removed â€” module deleted
import { CronScheduler } from '../scheduling/cron-scheduler';
import { automationDashboardTool } from '../scheduling/schedule-admin-tools';
import { cancelThreadSupervision, listThreadSupervisions } from '../threads/thread-supervision';
import { TelegramChannel } from '../comms/telegram-channel';
import { executeDeliverySendScreenshot } from '../delivery-screenshot.js';
import { executeXaiImageVisionSummary } from '../tools/handlers/xai-handlers.js';
import {
  executeShoppingSearchProducts,
  executeWebSearch,
  executeWebFetch,
} from '../../tools/web';
import { executeGenerateImage } from '../../tools/generate-image.js';
import { executeGenerateVideo } from '../../tools/generate-video.js';
import { executeWriteNote } from '../../tools/write-note';
import { getMemoryIndexRefreshWorkerStatus, searchMemoryIndexAsync, readMemoryRecord } from '../memory-index/index';
import { getMemorySearchWorkerStatus } from '../memory-index/search-worker-client';
import {
  cancelMainChatTimer,
  createMainChatTimer,
  listMainChatTimers,
  updateMainChatTimer,
} from '../timers/timer-store';

const AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE = new Map<string, any>();

export function getAgentTeamScheduleToolDefByName(name: string): any | null {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.has(clean)) {
    return AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.get(clean);
  }
  const found = getAgentTeamScheduleTools()
    .find((tool: any) => String(tool?.function?.name || '').trim() === clean) || null;
  AGENT_TEAM_SCHEDULE_TOOL_DEF_CACHE.set(clean, found);
  return found;
}


export const clampPreemptConfig: any = (x: any) => x;

const mainChatRequestDedupe = new Map<string, { at: number; sessionId: string; streamId: string; fingerprint: string }>();
const MAIN_CHAT_REQUEST_DEDUPE_TTL_MS = 2 * 60 * 1000;

export function normalizeClientRequestId(input: unknown): string {
  return String(input || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160);
}

function fingerprintMainChatRequest(input: Record<string, any>): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    message: input.message,
    pinnedMessages: input.pinnedMessages,
    attachments: input.attachments,
    attachmentPreviews: input.attachmentPreviews,
    reasoning: input.reasoning,
    callerContext: input.callerContext,
    excludedSkillIds: input.excludedSkillIds || input.excludedMatchingSkillIds,
    selectedSkillIds: input.selectedSkillIds || input.forcedSkillIds || input.matchedSkillIds,
  })).digest('hex');
}

export function buildCapturedScreenshotPreviewPayload(
  sessionId: string,
  source: 'desktop' | 'browser',
): Record<string, any> | undefined {
  if (source === 'desktop') {
    const packet = getDesktopAdvisorPacket(sessionId);
    const base64 = String(packet?.screenshotBase64 || '').trim();
    if (!base64) return undefined;
    const mimeType = String(packet?.screenshotMime || 'image/png').trim() || 'image/png';
    const screenshotId = String(packet?.screenshotId || '').trim();
    if (!screenshotId) return undefined;
    return {
      // Keep the stream event small: full desktop frames can exceed buffering
      // limits. The packet index serves the exact session-scoped capture.
      dataUrl: `/api/chat/desktop-screenshot-preview/${encodeURIComponent(sessionId)}/${encodeURIComponent(screenshotId)}`,
      mimeType,
      width: Number(packet?.width || 0) || undefined,
      height: Number(packet?.height || 0) || undefined,
      screenshotId,
      capturedAt: Number(packet?.capturedAt || 0) || undefined,
    };
  }

  const screenshot = getLastBrowserScreenshot(sessionId);
  const base64 = String(screenshot?.base64 || '').trim();
  if (!base64) return undefined;
  const mimeType = String(screenshot?.mimeType || 'image/png').trim() || 'image/png';
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    width: Number(screenshot?.width || 0) || undefined,
    height: Number(screenshot?.height || 0) || undefined,
  };
}

export function inferImageGenerationPresentationMode(userMessage: string, toolName: string, toolArgs: any): 'foreground' | 'background' {
  const explicit = String(toolArgs?.presentation_mode || '').trim().toLowerCase();
  if (explicit === 'foreground' || explicit === 'direct') return 'foreground';
  if (explicit === 'background' || explicit === 'workflow' || explicit === 'tool') return 'background';
  if (toolName === 'creative_generate_image_shot') return 'background';
  const text = `${userMessage || ''}\n${toolArgs?.prompt || ''}`.toLowerCase();
  if (/\b(texture pack|sprite|sprites|asset|assets|wire (?:it|them) into|apply (?:it|them)|add (?:it|them) to|website|site|game|project|repo|implementation|landing page|html|css|app|background plate|keyframe|shot|creative project)\b/.test(text)) {
    return 'background';
  }
  return 'foreground';
}

function pruneMainChatRequestDedupe(now = Date.now()): void {
  for (const [key, entry] of mainChatRequestDedupe.entries()) {
    const activeStream = getMainChatStream(entry.sessionId);
    if (activeStream?.active && activeStream.streamId === entry.streamId) continue;
    if (now - Number(entry?.at || 0) > MAIN_CHAT_REQUEST_DEDUPE_TTL_MS) {
      mainChatRequestDedupe.delete(key);
    }
  }
}

function mainChatRequestDedupeKey(sessionId: string, clientRequestId: string): string {
  return `${String(sessionId || 'default')}::${clientRequestId}`;
}

export function normalizeTurnOrigin(input: unknown, sessionId: string, fallback?: Partial<TurnOrigin>): TurnOrigin {
  const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
  const sid = String(sessionId || '').trim();
  const rawChannel = String(raw.channel || fallback?.channel || '').trim().toLowerCase();
  const inferredChannel =
    rawChannel === 'cli' ? 'terminal'
      : rawChannel === 'terminal' || rawChannel === 'telegram' || rawChannel === 'mobile' || rawChannel === 'discord' || rawChannel === 'whatsapp' || rawChannel === 'system' || rawChannel === 'web'
        ? rawChannel
        : sid.startsWith('telegram_') ? 'telegram'
          : sid.startsWith('mobile_') ? 'mobile'
            : sid.startsWith('cli_') ? 'terminal'
              : sid.startsWith('discord_') ? 'discord'
                : sid.startsWith('whatsapp_') ? 'whatsapp'
                  : sid.startsWith('task_') || sid.startsWith('cron_') || sid.startsWith('brain_') || sid.startsWith('auto_') ? 'system'
                    : 'web';
  const channel = inferredChannel as TurnOrigin['channel'];
  const defaultSurface =
    channel === 'telegram' || channel === 'discord' || channel === 'whatsapp' ? 'bot'
      : channel === 'mobile' ? 'mobile_app'
        : channel === 'terminal' ? 'terminal'
          : channel === 'system' ? 'automation'
            : 'desktop_app';
  const defaultDevice =
    channel === 'mobile' || channel === 'telegram' || channel === 'whatsapp' ? 'phone'
      : channel === 'system' ? 'server'
        : 'computer';
  const cleanOptional = (value: unknown): string | undefined => {
    const s = String(value ?? '').trim();
    return s ? s.slice(0, 240) : undefined;
  };
  return {
    channel,
    surface: cleanOptional(raw.surface) || fallback?.surface || defaultSurface,
    device: cleanOptional(raw.device) || fallback?.device || defaultDevice,
    chatId: cleanOptional(raw.chatId) || fallback?.chatId,
    userId: cleanOptional(raw.userId) || fallback?.userId,
    label: cleanOptional(raw.label) || fallback?.label,
    source: cleanOptional(raw.source) || fallback?.source,
  };
}

export function persistTurnOriginChannelHint(sessionId: string, origin: TurnOrigin): void {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (origin.channel === 'system') return;
  setSessionChannelHint(sid, {
    channel: origin.channel as 'terminal' | 'telegram' | 'web' | 'mobile' | 'discord' | 'whatsapp',
    chatId: Number.isFinite(Number(origin.chatId)) ? Number(origin.chatId) : undefined,
    userId: Number.isFinite(Number(origin.userId)) ? Number(origin.userId) : undefined,
    timestamp: Date.now(),
  });
}


export function formatTurnOriginContext(origin: TurnOrigin, sessionId: string): string {
  const title = origin.label || origin.channel;
  const lines = [
    '[TURN ORIGIN]',
    `User contact channel: ${title}`,
    `Surface: ${origin.surface || 'unknown'}`,
    `User device/surface class: ${origin.device || 'unknown'}`,
    `Session: ${sessionId || 'default'}`,
    origin.chatId ? `External chat id: ${origin.chatId}` : '',
    origin.userId ? `External user id: ${origin.userId}` : '',
    '',
    '[LOCAL RUNTIME]',
    'Prometheus is still running on the user\'s local computer, with its normal local workspace, browser, shell, file, and desktop tools available according to the current tool policy.',
    'The contact channel only describes where the user sent this message from. Do not treat Telegram, mobile, Discord, WhatsApp, or CLI as evidence that desktop/computer tasks are unavailable.',
    'Use the origin only to adapt reply format and delivery assumptions, such as concise mobile responses or Telegram-friendly attachments.',
  ].filter(Boolean);
  return lines.join('\n');
}

type TurnFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

type TurnFileChange = {
  path: string;
  displayPath: string;
  status: TurnFileChangeStatus;
  insertions: number;
  deletions: number;
  oldPath?: string;
  diffPreview?: string;
  binary?: boolean;
  baselineKind?: 'git-head' | 'git-index' | 'turn-snapshot' | 'none';
  baselineId?: string;
};

type TurnFileChanges = {
  summary: {
    fileCount: number;
    insertions: number;
    deletions: number;
  };
  files: TurnFileChange[];
  generatedAt: number;
};

const FILE_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write',
  'write_file',
  'append_file',
  'replace_lines',
  'insert_after',
  'delete_lines',
  'find_replace',
  'apply_patchset',
  'apply_workspace_patchset',
  'workspace_edit',
  'rename_file',
  'delete_file',
  'copy_file',
  'move_file',
  'mkdir',
  'apply_patch',
  'write_source',
  'find_replace_source',
  'apply_dev_source_patchset',
  'replace_lines_source',
  'insert_after_source',
  'delete_lines_source',
  'delete_source',
  'write_webui_source',
  'find_replace_webui_source',
  'replace_lines_webui_source',
  'insert_after_webui_source',
  'delete_lines_webui_source',
  'delete_webui_source',
  'write_prom_file',
  'find_replace_prom',
  'replace_lines_prom',
  'insert_after_prom',
  'delete_lines_prom',
  'delete_prom_file',
  'skill_manifest_write',
  'skill_update_metadata',
  'skill_resource_write',
  'skill_resource_delete',
  'prom_apply_dev_changes',
]);

function isTurnFileMutationTool(toolName: string): boolean {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (FILE_MUTATION_TOOL_NAMES.has(name)) return true;
  if (/^(write|delete|find_replace|replace_lines|insert_after)_/.test(name) && /(source|webui|prom|file)$/.test(name)) return true;
  return false;
}

export function isPlannedRestartToolName(toolName: string): boolean {
  const name = String(toolName || '').trim();
  return name === 'gateway_restart'
    || name === 'prom_apply_dev_changes'
    || /^(prom_)?dev_.*apply/i.test(name)
    || /^(apply_)?dev_source_(changes|edit|patch)$/i.test(name);
}

function normalizeDisplayPath(filePath: string, workspacePath: string): string {
  const value = String(filePath || '').trim();
  if (!value) return '';
  try {
    const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspacePath, value);
    const rel = path.relative(workspacePath, abs).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
    return abs.replace(/\\/g, '/');
  } catch {
    return value.replace(/\\/g, '/');
  }
}

function resolveTurnFilePath(rawPath: any, workspacePath: string): string {
  const value = String(rawPath || '').trim();
  if (!value || value === '.' || value === '/dev/null') return '';
  try {
    if (path.isAbsolute(value)) return path.resolve(value);
    const normalized = value.replace(/\\/g, '/').replace(/^\.?\//, '');
    const workspaceAbs = path.resolve(path.join(workspacePath, normalized));
    if (fs.existsSync(workspaceAbs)) return workspaceAbs;
    if (/^(src|web-ui)\//i.test(normalized)) {
      const projectRoot = path.resolve(workspacePath, '..');
      const projectAbs = path.resolve(path.join(projectRoot, normalized));
      if (
        fs.existsSync(path.join(projectRoot, 'package.json'))
        && fs.existsSync(path.join(projectRoot, 'src'))
        && fs.existsSync(path.join(projectRoot, 'web-ui'))
      ) {
        return projectAbs;
      }
    }
    return workspaceAbs;
  } catch {
    return '';
  }
}

function expandRawPathCandidates(rawPath: any, toolName: string, args: any): string[] {
  const raw = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const surfaces = Array.isArray(args?.changed_surfaces)
    ? args.changed_surfaces.map((surface: any) => String(surface || '').trim().toLowerCase())
    : [];
  const isDevApply = toolName === 'prom_apply_dev_changes';
  const isMobileish = surfaces.includes('mobile') || /^src\/mobile\//i.test(raw) || /^mobile\//i.test(raw);
  if (isMobileish && /^src\/mobile\//i.test(raw)) out.add(`web-ui/${raw}`);
  if (isMobileish && /^mobile\//i.test(raw)) out.add(`web-ui/src/${raw}`);
  if (isDevApply && /^src\/(pages|styles|components|mobile|utils|app\.js|ws\.js)/i.test(raw)) out.add(`web-ui/${raw}`);
  return Array.from(out);
}

function extractPatchTargetPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of String(patchText || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('diff --git ')) {
      const parts = line.split(/\s+/).slice(2, 4).map((part) => part.replace(/^"|"$/g, ''));
      for (let item of parts) {
        if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
        if (item && item !== '/dev/null') paths.add(item);
      }
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      let item = line.slice(4).trim().replace(/^"|"$/g, '').split(/\s+/)[0] || '';
      if (item.startsWith('a/') || item.startsWith('b/')) item = item.slice(2);
      if (item && item !== '/dev/null') paths.add(item);
    } else if (line.startsWith('rename from ')) {
      paths.add(line.slice('rename from '.length).trim());
    } else if (line.startsWith('rename to ')) {
      paths.add(line.slice('rename to '.length).trim());
    }
  }
  return Array.from(paths);
}

function extractTouchedFilesFromToolResult(result: any, workspacePath: string): string[] {
  const toolName = String(result?.name || result?.toolName || '').trim();
  if (!isTurnFileMutationTool(toolName)) return [];
  if (result?.error === true) return [];
  const args = result?.args && typeof result.args === 'object' ? result.args : {};
  const candidates: any[] = [];
  for (const source of [result?.extra, result?.data, result]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of [
      'touchedFiles', 'changedFiles', 'affectedFiles', 'files',
      'touched_files', 'changed_files', 'affected_files',
    ]) {
      if (source[key] != null) candidates.push(source[key]);
    }
  }
  for (const key of [
    'path', 'file', 'filename', 'name', 'target', 'target_path', 'targetPath',
    'old_path', 'oldPath', 'new_path', 'newPath', 'source', 'destination',
    'files', 'allowedFiles', 'affected_files', 'affectedFiles', 'changed_files', 'changedFiles',
  ]) {
    if (args[key] != null) candidates.push(args[key]);
  }
  if (toolName.includes('webui_source')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^web-ui[\\/]/i.test(s) ? path.join('web-ui', s) : s;
    }));
  } else if (/_source$/.test(toolName) && !toolName.includes('webui')) {
    candidates.push(...candidates.map((item) => {
      const s = String(item || '').trim();
      return s && !/^src[\\/]/i.test(s) ? path.join('src', s) : s;
    }));
  }
  if (toolName === 'apply_patch' && typeof args.patch === 'string') {
    candidates.push(...extractPatchTargetPaths(args.patch));
  }
  return Array.from(new Set(
    candidates
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .flatMap((item) => expandRawPathCandidates(item, toolName, args))
      .map((item) => resolveTurnFilePath(item, workspacePath))
      .filter(Boolean),
  ));
}

function isInsideTurnWorkspace(workspacePath: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(workspacePath), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function extractTerminalWorkspaceChangesFromToolResult(result: any, workspacePath: string): TurnFileChange[] {
  const changes: TurnFileChange[] = [];
  const sources = [result?.extra, result?.data, result].filter((source) => source && typeof source === 'object');
  for (const source of sources) {
    const rawChanges = source.workspaceChanges || source.workspace_changes;
    if (!Array.isArray(rawChanges)) continue;
    // The tracker reports the scope it actually watched (e.g. PromSRC or a PR
    // worktree when the command ran there). Changes inside that scope are real
    // even when it is outside the turn workspace.
    const trackedScope = String(source.workspacePath || '').trim();
    const inScope = (candidate: string) => isInsideTurnWorkspace(workspacePath, candidate)
      || Boolean(trackedScope && isInsideTurnWorkspace(trackedScope, candidate));
    for (const raw of rawChanges) {
      if (!raw || typeof raw !== 'object') continue;
      const absPath = resolveTurnFilePath(raw.path || raw.absPath || raw.file || raw.displayPath, trackedScope || workspacePath);
      if (!absPath || !inScope(absPath)) continue;
      const status = String(raw.status || 'modified').toLowerCase();
      if (!['added', 'modified', 'deleted', 'renamed'].includes(status)) continue;
      const rawOldPath = String(raw.oldPath || raw.old_path || '').trim();
      const oldPath = rawOldPath ? resolveTurnFilePath(rawOldPath, trackedScope || workspacePath) : '';
      changes.push({
        path: absPath,
        displayPath: String(raw.displayPath || normalizeDisplayPath(absPath, workspacePath)).replace(/\\/g, '/'),
        status: status as TurnFileChangeStatus,
        insertions: Math.max(0, Number(raw.insertions) || 0),
        deletions: Math.max(0, Number(raw.deletions) || 0),
        ...(oldPath && inScope(oldPath) ? { oldPath } : {}),
        ...(String(raw.diffPreview || '').trim() ? { diffPreview: String(raw.diffPreview).slice(0, 12_000) } : {}),
        ...(raw.binary === true ? { binary: true } : {}),
        ...(raw.baselineKind ? { baselineKind: raw.baselineKind } : {}),
        ...(String(raw.baselineId || '').trim() ? { baselineId: String(raw.baselineId).trim() } : {}),
      });
    }
  }
  return Array.from(new Map(changes.map((change) => [path.resolve(change.path).toLowerCase(), change])).values());
}

function runGitText(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = lockFreeGitReadOptions(args);
    execFile('git', invocation.args, {
      cwd,
      env: invocation.env,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer,
      timeout: 15_000,
    }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

async function findGitRootForPath(filePath: string, workspacePath: string): Promise<string | null> {
  const cwd = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? filePath
    : (fs.existsSync(filePath) ? path.dirname(filePath) : workspacePath);
  try {
    return path.resolve((await runGitText(cwd, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    try {
      return path.resolve((await runGitText(workspacePath, ['rev-parse', '--show-toplevel'])).trim());
    } catch {
      return null;
    }
  }
}

function countTextFileLines(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1_000_000) return 0;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('\0')) return 0;
    return content.length ? content.split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

async function inferGitStatus(root: string, relPath: string, absPath: string): Promise<TurnFileChangeStatus> {
  try {
    const status = (await runGitText(root, ['status', '--porcelain', '--', relPath])).trim();
    if (/^R/.test(status)) return 'renamed';
    if (/^\?\?/.test(status) || /^A/.test(status)) return 'added';
    if (/^D|^.D/.test(status)) return 'deleted';
  } catch {}
  return 'modified';
}

export async function collectTurnFileChanges(toolResults: any[] | undefined, workspacePath: string): Promise<TurnFileChanges | undefined> {
  const terminalChanges = Array.from(new Map(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTerminalWorkspaceChangesFromToolResult(result, workspacePath))
      .map((change) => [path.resolve(change.path).toLowerCase(), change] as const),
  ).values());
  const touched = Array.from(new Set(
    (Array.isArray(toolResults) ? toolResults : [])
      .flatMap((result) => extractTouchedFilesFromToolResult(result, workspacePath)),
  )).filter((filePath) => !terminalChanges.some((change) => path.resolve(change.path).toLowerCase() === path.resolve(filePath).toLowerCase()));
  if (!touched.length && !terminalChanges.length) return undefined;
  const snapshotRefs = collectSnapshotRefsFromToolResults(toolResults);

  const candidates = touched.slice(0, 40);
  const collected: Array<TurnFileChange | undefined> = new Array(candidates.length);
  let nextIndex = 0;
  const collectOne = async (absPath: string): Promise<TurnFileChange | undefined> => {
    const gitRoot = await findGitRootForPath(absPath, workspacePath);
    let insertions = 0;
    let deletions = 0;
    let status: TurnFileChangeStatus = fs.existsSync(absPath) ? 'modified' : 'deleted';
    let diffPreview = '';
    let binary = false;
    const snapshot = snapshotRefs.find((ref: any) => {
      const target = String(ref?.targetPath || '').trim();
      return target && path.resolve(target).toLowerCase() === path.resolve(absPath).toLowerCase();
    });
    let baselineKind: TurnFileChange['baselineKind'] = 'none';

    if (gitRoot) {
      const relPath = path.relative(gitRoot, absPath).replace(/\\/g, '/');
      status = await inferGitStatus(gitRoot, relPath, absPath);
      try {
        // Plumbing diff-index/diff-files never write .git/index (porcelain diff
        // does, even with GIT_OPTIONAL_LOCKS=0, and leaves index.lock on a kill).
        const numstat = (await runGitText(gitRoot, ['diff-index', '--numstat', 'HEAD', '--', relPath])).trim().split(/\r?\n/).filter(Boolean)[0]
          || (await runGitText(gitRoot, ['diff', '--cached', '--numstat', '--', relPath])).trim().split(/\r?\n/).filter(Boolean)[0]
          || (await runGitText(gitRoot, ['diff-files', '--numstat', '--', relPath])).trim().split(/\r?\n/).filter(Boolean)[0]
          || '';
        const parts = numstat.split(/\s+/);
        if (parts[0] === '-' || parts[1] === '-') {
          binary = true;
        } else {
          insertions = Math.max(0, Number(parts[0]) || 0);
          deletions = Math.max(0, Number(parts[1]) || 0);
        }
      } catch {}
      if (status === 'added' && insertions === 0 && deletions === 0 && fs.existsSync(absPath)) {
        insertions = countTextFileLines(absPath);
      }
      try {
        diffPreview = (await runGitText(gitRoot, ['diff-index', '-p', '--unified=2', 'HEAD', '--', relPath], 512 * 1024)).slice(0, 12000)
          || (await runGitText(gitRoot, ['diff', '--cached', '--unified=2', '--', relPath], 512 * 1024)).slice(0, 12000)
          || (await runGitText(gitRoot, ['diff-files', '-p', '--unified=2', '--', relPath], 512 * 1024)).slice(0, 12000);
      } catch {}
      baselineKind = status === 'modified' && !diffPreview ? 'git-index' : 'git-head';
    } else if (fs.existsSync(absPath)) {
      insertions = snapshot ? 0 : countTextFileLines(absPath);
      status = snapshot?.existed ? 'modified' : 'added';
      baselineKind = snapshot ? 'turn-snapshot' : 'none';
    }

    if (!fs.existsSync(absPath) && status !== 'deleted') return undefined;
    if (status === 'deleted' && insertions === 0 && deletions === 0 && !binary && !diffPreview) return undefined;
    if (insertions === 0 && deletions === 0 && !binary && status === 'modified' && !diffPreview) return undefined;
    return {
      path: absPath,
      displayPath: normalizeDisplayPath(absPath, workspacePath),
      status,
      insertions,
      deletions,
      diffPreview: diffPreview || undefined,
      binary: binary || undefined,
      baselineKind,
      ...(snapshot?.id ? { baselineId: snapshot.id } : {}),
    };
  };
  const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      collected[index] = await collectOne(candidates[index]);
    }
  });
  await Promise.all(workers);
  const changes = [
    ...terminalChanges,
    ...collected.filter((change): change is TurnFileChange => !!change),
  ];

  if (!changes.length) return undefined;
  const insertions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.insertions) || 0), 0);
  const deletions = changes.reduce((sum, file) => sum + Math.max(0, Number(file.deletions) || 0), 0);
  return {
    summary: { fileCount: changes.length, insertions, deletions },
    files: changes,
    generatedAt: Date.now(),
  };
}

const MAIN_CHAT_OWNER_WATCHDOG_INTERVAL_MS = 15_000;
const mainChatStreamStore = createMainChatStreamStore({
  broadcastWS: (event) => broadcastWS(event),
  listLiveRuntimes: () => listLiveRuntimes(),
});
export const {
  mainChatStreams, getMainChatStream, pruneMainChatStreams, beginMainChatStream, finishMainChatStream,
  findSessionMainChatRuntime, finishMainChatStreamAsOrphaned,
  appendMainChatStreamEvent, buildDurableToolStreamTrace,
} = mainChatStreamStore;


/**
 * The runtime is the durable owner of a chat turn.  Stream and coordinator
 * state are delivery/admission helpers only.  When their owner vanished, clear
 * them together so a reconnect cannot be blocked indefinitely by ghost state.
 */
export function reconcileMainChatTurn(sessionId: string): MainChatTurnReconciliation {
  const sid = String(sessionId || '').trim();
  const runtimeCandidates = listLiveRuntimes()
    .filter((item) =>
      (item.kind === 'main_chat' || item.kind === 'main_chat_goal')
      && String(item.sessionId || '') === sid)
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  const runtime = runtimeCandidates.find((item) => isLiveRunningRuntime(item)) || null;
  const abortingRuntime = runtimeCandidates.find((item) => Number(item.abortRequestedAt || 0) > 0) || null;
  const stream = getMainChatStream(sid);
  if (runtime) return { active: true, runtime, stream, recovered: false };
  // An explicit abort closes the visible stream immediately, but the owning
  // request may still be unwinding. Keep the coordinator busy until its
  // finally block (or the watchdog) releases it; do not admit a second model
  // turn against the first one's still-running promise.
  if (abortingRuntime) {
    // The owner watchdog only walks *active streams*. A user stop closes the
    // stream immediately, so an abort that never settles (owner died during a
    // gateway restart, hung promise) would hold the session forever and every
    // send returns 409 SESSION_TURN_ACTIVE. Settle it here past the grace.
    const abortAge = Date.now() - Number(abortingRuntime.abortRequestedAt || Date.now());
    if (stream?.active || abortAge <= MAIN_CHAT_ABORT_SETTLE_GRACE_MS) {
      return { active: true, runtime: abortingRuntime, stream, recovered: false };
    }
    try { finishLiveRuntime(abortingRuntime.id); } catch {}
    mainChatTurnCoordinator.discard(sid, 'The aborted Chat execution owner did not settle.');
    console.warn(`[main-chat-owner] settled stale aborted runtime=${abortingRuntime.id} session=${sid} after ${abortAge}ms`);
    return { active: false, runtime: null, stream: getMainChatStream(sid), recovered: true, recoveryReason: 'orphaned_stream_or_lease' as const };
  }

  const lease = mainChatTurnCoordinator.getActive(sid);
  // Avoid racing a just-created stream from a non-HTTP caller.  The normal
  // HTTP path registers its runtime synchronously, so only a genuinely
  // abandoned owner can outlive this grace period.
  if ((stream?.active || lease) && !isMainChatStreamOwnerOrphaned({
    streamActive: stream?.active === true,
    runtimePresent: false,
    startedAt: Number(stream?.startedAt || 0),
    lastSemanticProgressAt: Number(stream?.lastSemanticProgressAt || 0),
    leaseAcquiredAt: Number(lease?.acquiredAt || 0),
  })) {
    return { active: true, runtime: null, stream, recovered: false };
  }

  let recovered = false;
  if (stream?.active) {
    finishMainChatStreamAsOrphaned(sid, stream, 'orphaned_stream_or_lease');
    recovered = true;
  }
  if (lease) recovered = mainChatTurnCoordinator.discard(sid) || recovered;
  return {
    active: false,
    runtime: null,
    stream: getMainChatStream(sid),
    recovered,
    ...(recovered ? { recoveryReason: 'orphaned_stream_or_lease' as const } : {}),
  };
}

function reconcileMainChatExecutionOwners(now = Date.now()): void {
  pruneMainChatStreams();
  const streams = Array.from(mainChatStreams.values()).filter((stream) => stream.active);
  for (const stream of streams) {
    if (!stream.runtimeId) {
      // Synthetic turns (internal watch, Telegram) register their runtime
      // before the stream exists; adopt it instead of declaring an orphan.
      const adopted = findSessionMainChatRuntime(stream.sessionId);
      if (adopted) stream.runtimeId = adopted.id;
    }
    const runtime = stream.runtimeId ? getLiveRuntime(stream.runtimeId) : null;
    if (!runtime) {
      if (isMainChatStreamOwnerOrphaned({
        now,
        streamActive: true,
        runtimePresent: false,
        startedAt: stream.startedAt,
        lastSemanticProgressAt: stream.lastSemanticProgressAt,
      })) {
        finishMainChatStreamAsOrphaned(stream.sessionId, stream, 'runtime_missing');
        mainChatTurnCoordinator.discard(stream.sessionId, 'The previous Chat execution owner was lost.');
        console.warn(`[main-chat-owner] stream=${stream.streamId} session=${stream.sessionId} runtime owner missing after ${MAIN_CHAT_ORPHAN_GRACE_MS}ms; stream reconciled`);
      }
      continue;
    }

    if (runtime.abortRequestedAt) {
      const age = now - Number(runtime.abortRequestedAt || now);
      if (age > MAIN_CHAT_ABORT_SETTLE_GRACE_MS) {
        if (runtime.abortSource === 'main_chat_owner_watchdog') {
          const interrupted = interruptLiveRuntimeForRecovery(runtime.id, 'main_chat_owner_watchdog_timeout').runtime;
          if (interrupted?.sessionId && listActiveBackgroundIdsForSession(interrupted.sessionId).length === 0) {
            setTimeout(() => {
              wakeInterruptedBackgroundOwner(interrupted.sessionId || '');
            }, 100).unref?.();
          }
        } else {
          finishLiveRuntime(runtime.id);
        }
        mainChatTurnCoordinator.discard(stream.sessionId, 'The aborted Chat execution owner did not settle.');
        console.warn(`[main-chat-owner] abort did not settle within ${MAIN_CHAT_ABORT_SETTLE_GRACE_MS}ms for runtime=${runtime.id}`);
      }
      continue;
    }

    const streamAgeMs = Math.max(0, now - Number(stream.startedAt || now));
    const semanticStallMs = Math.max(0, now - Number(stream.lastSemanticProgressAt || now));
    const ageExceeded = isMainChatExecutionAgeExceeded({
      now,
      startedAt: stream.startedAt,
      streamActive: stream.active,
      maxAgeMs: MAIN_CHAT_MAX_AGE_MS,
    });
    // A wait_all join can legitimately outlast the foreground age limit.
    // Do not age-kill it while its workers are active and the keepalive is
    // fresh; retain the absolute cap when a worker or keepalive disappears.
    const activeBackgroundIds = listActiveBackgroundIdsForSession(stream.sessionId);
    const waitingOnBackground = isLiveBackgroundJoin({
      now,
      lastSemanticEvent: stream.lastSemanticEvent,
      lastSemanticProgressAt: stream.lastSemanticProgressAt,
      activeBackgroundCount: activeBackgroundIds.length,
    });
    if (ageExceeded && !waitingOnBackground) {
      const memory = process.memoryUsage();
      const diagnostic = {
        reason: 'max_age_exceeded',
        streamAgeMs,
        semanticStallMs,
        lastSemanticEvent: stream.lastSemanticEvent || 'unknown',
        streamId: stream.streamId,
        admissionLeaseId: stream.admissionLeaseId,
        gatewayRssBytes: memory.rss,
        gatewayHeapUsedBytes: memory.heapUsed,
        gatewayExternalBytes: memory.external,
      };
      updateLiveRuntimeCheckpoint(runtime.id, { event: 'owner_watchdog_triggered', ...diagnostic });
      console.warn(`[main-chat-owner] foreground execution exceeded ${MAIN_CHAT_MAX_AGE_MS}ms; aborting runtime=${runtime.id} session=${stream.sessionId} diagnostic=${JSON.stringify(diagnostic)}`);
      abortLiveRuntime(runtime.id, 'max_age_exceeded', { source: 'main_chat_owner_watchdog' });
      continue;
    }

    if (!isBlockingWaitInFlight(stream.blockingWaits || [], now) && isMainChatSemanticProgressStalled({
      now,
      lastSemanticProgressAt: stream.lastSemanticProgressAt,
      streamActive: stream.active,
      runtimePresent: true,
      runtimeStatus: runtime.status,
      abortRequestedAt: runtime.abortRequestedAt,
      stallMs: MAIN_CHAT_SEMANTIC_STALL_MS,
    })) {
      const memory = process.memoryUsage();
      const diagnostic = {
        reason: 'semantic_progress_stall',
        streamAgeMs,
        semanticStallMs,
        lastSemanticEvent: stream.lastSemanticEvent || 'unknown',
        streamId: stream.streamId,
        admissionLeaseId: stream.admissionLeaseId,
        gatewayRssBytes: memory.rss,
        gatewayHeapUsedBytes: memory.heapUsed,
        gatewayExternalBytes: memory.external,
      };
      updateLiveRuntimeCheckpoint(runtime.id, { event: 'owner_watchdog_triggered', ...diagnostic });
      console.warn(`[main-chat-owner] semantic progress stalled for ${semanticStallMs}ms; aborting runtime=${runtime.id} session=${stream.sessionId} diagnostic=${JSON.stringify(diagnostic)}`);
      abortLiveRuntime(runtime.id, 'semantic_progress_stall', { source: 'main_chat_owner_watchdog' });
    }
  }

  // If a terminal checkpoint was emitted but the request owner disappeared
  // before its finally block, let the watchdog perform the same idempotent
  // cleanup that the request would have performed.  This pass must also settle
  // an abort whose callback already closed the stream: a provider promise can
  // ignore AbortSignal and leave the request finalizer permanently unreachable.
  for (const runtime of listLiveRuntimes()) {
    if ((runtime.kind !== 'main_chat' && runtime.kind !== 'main_chat_goal') || !runtime.deferTerminalCleanup) continue;
    const stream = runtime.sessionId ? getMainChatStream(runtime.sessionId) : null;
    const abortSettlement = resolveMainChatAbortSettlement({
      now,
      abortRequestedAt: runtime.abortRequestedAt,
      abortSource: runtime.abortSource,
      settleMs: MAIN_CHAT_ABORT_SETTLE_GRACE_MS,
    });
    if (abortSettlement !== 'wait') {
      if (abortSettlement === 'recover') {
        // Keep watchdog-originated work in the durable interrupted ledger so a
        // restart can retrigger it exactly once.  Do not require a live stream
        // to still exist: the abort callback may have already closed it.
        const interrupted = interruptLiveRuntimeForRecovery(runtime.id, 'main_chat_owner_watchdog_timeout').runtime;
        if (interrupted?.sessionId && listActiveBackgroundIdsForSession(interrupted.sessionId).length === 0) {
          setTimeout(() => {
            wakeInterruptedBackgroundOwner(interrupted.sessionId || '');
          }, 100).unref?.();
        }
      } else {
        // Explicit user/operator stops are terminal and must not be replayed.
        finishLiveRuntime(runtime.id);
      }
      if (runtime.sessionId) mainChatTurnCoordinator.discard(runtime.sessionId, 'The aborted Chat execution owner did not settle.');
      console.warn(`[main-chat-owner] deferred abort did not settle within ${MAIN_CHAT_ABORT_SETTLE_GRACE_MS}ms for runtime=${runtime.id} streamActive=${Boolean(stream?.active)}`);
      continue;
    }
    if (hasTerminalRuntimeCheckpoint(runtime) && !stream?.active) finishLiveRuntime(runtime.id);
  }
}

const mainChatExecutionOwnerWatchdog = setInterval(() => {
  try { reconcileMainChatExecutionOwners(); } catch (error: any) {
    console.warn('[main-chat-owner] watchdog failed:', error?.message || error);
  }
}, MAIN_CHAT_OWNER_WATCHDOG_INTERVAL_MS);
(mainChatExecutionOwnerWatchdog as any).unref?.();

export function appendRuntimeNarrationBoundary(entries: Record<string, any>[], value: unknown): void {
  const content = truncateRuntimeProcessText(value, 12_000);
  if (!content) return;
  const previous = entries[entries.length - 1];
  if (previous?.type === 'think' && String(previous?.content || '').trim() === content) return;
  entries.push({
    ts: new Date().toLocaleTimeString(),
    type: 'think',
    actor: 'Prom',
    content,
    extra: {
      source: 'agent_thought',
      event: 'token_narration_boundary',
      visibility: 'user',
      reasoningKind: 'full_thought',
    },
  });
  if (entries.length > 12_000) entries.splice(0, entries.length - 12_000);
}

/**
 * Record the files a tool result changed onto a durable, restart-surviving
 * list. The process-entry trace drops tool args when persisted, so this list
 * is the only way a resumed turn knows what it edited before a restart.
 */
// tool_result SSE events do not carry args; the paired tool_call does. Keep
// the pending call args per touch-list, keyed by step (or tool name fallback).
const pendingFileTouchCallArgs = new WeakMap<TurnFileTouch[], Map<string, any>>();

function fileTouchStepKey(data: any): string {
  const step = data?.stepNum ?? data?.toolCallId ?? data?.tool_call_id ?? data?.callId;
  return step != null && String(step) !== '' ? `s:${String(step)}` : `t:${String(data?.action || data?.name || '')}`;
}

export function appendRuntimeFileTouch(fileTouches: TurnFileTouch[], event: string, data: any, processEntry: any): boolean {
  let pending = pendingFileTouchCallArgs.get(fileTouches);
  if (!pending) { pending = new Map(); pendingFileTouchCallArgs.set(fileTouches, pending); }
  if (event === 'tool_call') {
    if (data?.args && typeof data.args === 'object') {
      pending.set(fileTouchStepKey(data), data.args);
      pending.set(`t:${String(data?.action || data?.name || '')}`, data.args);
      if (pending.size > 200) pending.delete(pending.keys().next().value as string);
    }
    return false;
  }
  if (event !== 'tool_result' || !processEntry || data?.error) return false;
  const toolName = String(processEntry.extra?.toolName || data?.action || data?.name || '');
  const args = (data?.args && typeof data.args === 'object')
    ? data.args
    : pending.get(fileTouchStepKey(data)) || pending.get(`t:${toolName}`);
  pending.delete(fileTouchStepKey(data));
  const touches = extractTurnFileTouches([
    { extra: { event: 'tool_call', toolName, args, stepNum: 'x' } },
    { ...processEntry, extra: { ...(processEntry.extra || {}), toolName, args, stepNum: 'x' } },
  ]);
  if (!touches.length) return false;
  const merged = mergeTurnFileTouches(fileTouches, touches);
  fileTouches.splice(0, fileTouches.length, ...merged);
  return true;
}

function compactRuntimeWorkspaceChangeMetadata(data: any): Record<string, any> {
  const sources = [data?.extra, data]
    .filter((source) => source && typeof source === 'object');
  const source = sources.find((candidate) =>
    Array.isArray(candidate.workspaceChanges) || Array.isArray(candidate.workspace_changes));
  if (!source) return {};
  const rawChanges = Array.isArray(source.workspaceChanges) ? source.workspaceChanges : source.workspace_changes;
  const workspaceChanges = rawChanges
    .filter((change: any) => change && typeof change === 'object')
    .slice(0, 200)
    .map((change: any) => ({
      path: change.path || change.absPath || change.file,
      displayPath: change.displayPath,
      status: change.status,
      insertions: Number(change.insertions) || 0,
      deletions: Number(change.deletions) || 0,
      ...(change.oldPath || change.old_path ? { oldPath: change.oldPath || change.old_path } : {}),
      ...(change.binary === true ? { binary: true } : {}),
      ...(change.baselineKind ? { baselineKind: change.baselineKind } : {}),
      ...(change.baselineId ? { baselineId: change.baselineId } : {}),
      ...(String(change.diffPreview || '').trim() ? { diffPreview: String(change.diffPreview).slice(0, 4000) } : {}),
    }))
    .filter((change: any) => String(change.path || change.displayPath || '').trim());
  if (!workspaceChanges.length) return {};
  return {
    workspacePath: source.workspacePath,
    workspaceChanges,
    workspaceChangeSource: source.workspaceChangeSource || 'terminal',
    ...(source.workspaceChangesTruncated === true || rawChanges.length > workspaceChanges.length
      ? { workspaceChangesTruncated: true }
      : {}),
  };
}

// Why a turn's abort signal fired. The registry stamps abortSignal.reason when a
// gateway restart/drain/watchdog interrupts a running turn; only a bare abort
// with no reason (or an explicit user stop) is a real user cancellation.
export function describeTurnAbortCause(abortSignal: { aborted?: boolean; reason?: unknown } | undefined | null): string {
  const raw = String((abortSignal as any)?.reason ?? '').trim();
  const reason = raw.toLowerCase();
  if (reason.includes('watchdog') || reason.includes('runtime_missing') || reason.includes('owner_lost')) {
    return `Gateway watchdog interrupted the active turn (${raw.slice(0, 120)}); this was not a user cancellation.`;
  }
  if (reason && /restart|shutdown|drain|sigterm|sigint|exit|crash|reload|gateway/.test(reason)) {
    return `Gateway restart interrupted the active turn (${raw.slice(0, 120)}); this was not a user cancellation.`;
  }
  if (!raw && isGatewayDraining()) {
    return 'Gateway shutdown interrupted the active turn; this was not a user cancellation.';
  }
  return 'User cancelled the active turn.';
}


/** Recovery checkpoints must keep the same tool detail the live stream showed. */
export function runtimeToolDetailMetadata(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const duration = Number(data?.durationMs ?? data?.elapsedMs ?? data?.elapsed_ms);
  if (Number.isFinite(duration) && duration >= 0) out.durationMs = duration;
  if (typeof data?.ok === 'boolean') out.ok = data.ok;
  const summary = typeof data?.summary === 'string' ? data.summary.trim() : '';
  if (summary) out.summary = summary.slice(0, 1_200);
  const streamId = String(data?.streamId || '').trim();
  if (streamId) out.streamId = streamId;
  return out;
}

export function runtimeProcessEntryFromSseEvent(type: string, data: any): Record<string, any> | null {
  const eventType = String(type || '').trim();
  const source = String(data?.source || data?.extra?.source || '').trim().toLowerCase();
  const visibility = String(data?.visibility || data?.extra?.visibility || '').trim().toLowerCase();
  const isUserVisibleReasoning = eventType === 'reasoning_summary_delta'
    || eventType === 'reasoning_summary'
    || source === 'reasoning_summary'
    || visibility === 'user';
  if (!eventType
    || eventType === 'heartbeat'
    || eventType === 'background_wait'
    || eventType === 'token'
    || (eventType === 'thinking_delta' && !isUserVisibleReasoning)) return null;
  const ts = new Date().toLocaleTimeString();
  const compactionExtra = data?.extra && typeof data.extra === 'object' ? data.extra : {};
  const action = String(data?.action || data?.name || data?.toolName || compactionExtra.action || compactionExtra.toolName || '').trim();
  const isContextCompaction = action.toLowerCase() === CONTEXT_COMPACTION_TOOL_NAME;
  const explicitCompactionStatus = String(data?.status || compactionExtra.status || '').trim().toLowerCase();
  const compactionStatus = explicitCompactionStatus === 'skipped'
    ? 'skipped'
    : explicitCompactionStatus === 'failed' || explicitCompactionStatus === 'error'
      || data?.error === true || data?.ok === false || data?.success === false
      ? 'failed'
      : explicitCompactionStatus === 'compacting' || explicitCompactionStatus === 'running' || explicitCompactionStatus === 'in_progress'
        ? 'compacting'
        : eventType === 'tool_call' || eventType === 'tool_progress' ? 'compacting' : 'compacted';
  const compactionSummary = String(data?.summary || compactionExtra.summary || '').trim();
  const compactionLabel = compactionStatus === 'compacting'
    ? 'Compacting context'
    : compactionStatus === 'failed'
      ? 'Context compaction failed'
      : compactionStatus === 'skipped'
        ? 'Context compaction skipped'
      : 'Context compacted';
  const compactionInfoText = String(data?.message || data?.content || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const compactionInfoStatus = /^(?:context|thread) compacted\b/.test(compactionInfoText)
    ? 'compacted'
    : /^(?:context|thread) compaction (?:failed|error)\b/.test(compactionInfoText)
      ? 'failed'
      : /^(?:context|thread) compaction skipped\b/.test(compactionInfoText)
        ? 'skipped'
        : /^(?:compacting context|compacting (?:the )?thread|preparing context compaction)\b/.test(compactionInfoText)
          ? 'compacting'
          : '';
  if (isUserVisibleReasoning && (eventType === 'thinking_delta' || eventType === 'reasoning_summary_delta' || eventType === 'reasoning_summary')) {
    const content = truncateRuntimeProcessText(data?.text || data?.thinking || data?.summary || data?.message);
    if (!content) return null;
    return {
      ts,
      type: 'think',
      actor: 'Prom',
      content,
      extra: { source: 'reasoning_summary', event: eventType, visibility: 'user', reasoningKind: 'summary' },
    };
  }
  if (eventType === 'progress_state') {
    const items = Array.isArray(data?.items)
      ? data.items
          .map((item: any) => String(item?.label || item?.text || item?.title || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(-8)
      : [];
    const activeIndex = Number.isFinite(Number(data?.activeIndex)) ? Number(data.activeIndex) : -1;
    const content = [
      String(data?.reason || '').replace(/\s+/g, ' ').trim(),
      items.length ? `active=${activeIndex}; ${items.join(' | ')}` : '',
    ].filter(Boolean).join(': ');
    if (!content) return null;
    return {
      ts,
      type: 'info',
      actor: 'Prom',
      content: truncateRuntimeProcessText(`Progress: ${content}`, 2_000),
      extra: { source: 'runtime_checkpoint', event: eventType, activeIndex, total: items.length },
    };
  }
  if ((eventType === 'info' || eventType === 'ui_preflight') && compactionInfoStatus) {
    return {
      ts,
      type: 'compaction',
      actor: 'Prom',
      content: compactionInfoStatus === 'compacting'
        ? 'Compacting context'
        : compactionInfoStatus === 'failed'
          ? 'Context compaction failed'
          : compactionInfoStatus === 'skipped'
            ? 'Context compaction skipped'
            : 'Context compacted',
      status: compactionInfoStatus,
      ...(data?.summary ? { summary: String(data.summary).slice(0, 4_000) } : {}),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        action: CONTEXT_COMPACTION_TOOL_NAME,
        toolName: CONTEXT_COMPACTION_TOOL_NAME,
        status: compactionInfoStatus,
        ...(data?.summary ? { summary: String(data.summary).slice(0, 4_000) } : {}),
      },
    };
  }
  if (eventType === 'tool_progress' && isContextCompaction) {
    return {
      ts,
      type: 'compaction',
      actor: 'Prom',
      content: compactionLabel,
      status: compactionStatus,
      ...(compactionSummary ? { summary: compactionSummary } : {}),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        toolName: action,
        action: CONTEXT_COMPACTION_TOOL_NAME,
        status: compactionStatus,
        ...(compactionSummary ? { summary: compactionSummary } : {}),
        message: data?.message,
      },
    };
  }
  if (eventType === 'tool_call') {
    return {
      ts,
      type: isContextCompaction ? 'compaction' : 'tool',
      actor: 'Prom',
      content: truncateRuntimeProcessText(isContextCompaction ? compactionLabel : (action ? `Preparing ${action}` : data?.message || 'Preparing tool')),
      ...(isContextCompaction ? { status: compactionStatus, ...(compactionSummary ? { summary: compactionSummary } : {}) } : {}),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        toolName: action,
        ...(isContextCompaction ? {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          status: compactionStatus,
          ...(compactionSummary ? { summary: compactionSummary } : {}),
        } : {}),
        args: data?.args,
        toolCallId: data?.toolCallId || data?.tool_call_id || data?.callId,
        stepNum: data?.stepNum,
        ...runtimeToolDetailMetadata(data),
      },
    };
  }
  if (eventType === 'tool_result') {
    return {
      ts,
      type: isContextCompaction ? 'compaction' : (data?.error ? 'error' : 'result'),
      actor: 'Prom',
      content: truncateRuntimeProcessText(isContextCompaction ? compactionLabel : (data?.result || (action ? `${action} complete` : 'Tool complete'))),
      ...(isContextCompaction ? { status: compactionStatus, ...(compactionSummary ? { summary: compactionSummary } : {}) } : {}),
      extra: {
        source: 'runtime_checkpoint',
        event: eventType,
        toolName: action,
        ...(isContextCompaction ? {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          status: compactionStatus,
          ...(compactionSummary ? { summary: compactionSummary } : {}),
        } : {}),
        args: data?.args,
        error: data?.ok === false || data?.success === false || Boolean(data?.error),
        toolCallId: data?.toolCallId || data?.tool_call_id || data?.callId,
        stepNum: data?.stepNum,
        ...runtimeToolDetailMetadata(data),
        ...compactRuntimeWorkspaceChangeMetadata(data),
      },
    };
  }
  if (eventType === 'model_stream_event') {
    const modelEvent = data?.event && typeof data.event === 'object' ? data.event : {};
    const modelType = String(modelEvent.type || '').trim();
    if (!modelType || !/^tool_call_(?:start|done)$/i.test(modelType)) return null;
    const modelAction = String(modelEvent.name || modelEvent.toolName || action || 'tool').trim();
    return {
      ts,
      type: 'info',
      actor: 'Prom',
      content: `${modelType.toLowerCase().endsWith('start') ? 'Preparing' : 'Prepared'} ${modelAction}`,
      extra: { source: 'model_stream_event', event: eventType, modelType, toolName: modelAction, modelEvent },
    };
  }
  if (eventType === 'thinking' || eventType === 'agent_thought') {
    const visibility = String(data?.visibility || (eventType === 'agent_thought' ? 'user' : 'private')).toLowerCase();
    if (visibility === 'private' || visibility === 'internal') return null;
    return {
      ts,
      type: 'think',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.thinking || data?.text || data?.message),
      extra: {
        source: String(data?.source || 'runtime_checkpoint'),
        event: eventType,
        visibility,
        reasoningKind: 'full_thought',
      },
    };
  }
  if (eventType === 'reasoning_summary_delta' || eventType === 'reasoning_summary') {
    const content = truncateRuntimeProcessText(data?.text || data?.summary || data?.message);
    if (!content) return null;
    return {
      ts,
      type: 'think',
      actor: 'Prom',
      content,
      extra: { source: 'reasoning_summary', event: eventType, visibility: 'user', reasoningKind: 'summary' },
    };
  }
  if (eventType === 'vision_injected') {
    // Media-analysis / screenshot previews carry no message text, so the
    // generic fallback below would drop them and completed turns would lose
    // their image cards. Persist them as first-class vision trace rows.
    const preview = data?.preview && typeof data.preview === 'object' ? data.preview : null;
    const dataUrl = String(preview?.dataUrl || '').trim();
    if (!preview || !dataUrl || /^data:/i.test(dataUrl)) return null;
    const visionSource = String(data?.source || '').trim();
    const visionTool = String(data?.tool || action || '').trim();
    return {
      ts,
      type: 'vision',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.label || `Vision captured: ${visionTool || visionSource || 'preview'}`),
      preview: {
        dataUrl,
        ...(preview.workspacePath ? { workspacePath: String(preview.workspacePath) } : {}),
        ...(preview.mimeType ? { mimeType: String(preview.mimeType) } : {}),
        ...(preview.title ? { title: String(preview.title) } : {}),
        ...(preview.artifactKind ? { artifactKind: String(preview.artifactKind) } : {}),
        ...(Number(preview.width) > 0 ? { width: Number(preview.width) } : {}),
        ...(Number(preview.height) > 0 ? { height: Number(preview.height) } : {}),
      },
      previewTitle: String(data?.previewTitle || preview.title || '').trim() || undefined,
      extra: { source: visionSource || 'runtime_checkpoint', event: eventType, toolName: visionTool },
    };
  }
  if (eventType === 'error' || eventType === 'warn') {
    return {
      ts,
      type: eventType === 'warn' ? 'warn' : 'error',
      actor: 'Prom',
      content: truncateRuntimeProcessText(data?.message || data?.error || data?.result),
      extra: { source: 'runtime_checkpoint', event: eventType, toolName: action },
    };
  }
  const content = truncateRuntimeProcessText(data?.message || data?.text || data?.result || data?.summary, 2000);
  if (!content) return null;
  return {
    ts,
    type: eventType === 'ui_preflight' || eventType === 'info' ? 'info' : 'info',
    actor: 'Prom',
    content,
    extra: { source: 'runtime_checkpoint', event: eventType, toolName: action },
  };
}

import { resolvePrimaryModelCapabilities, buildVisionImagePart, type ModelCapabilities } from '../vision-chat';
import {
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  appendJournal,
  updateResumeContext,
  listTaskSummaries,
  deleteTask,
  mutatePlan,
  getEvidenceBusSnapshot,
  type TaskRecord,
  type TaskSummary,
} from '../tasks/task-store';
import { clearTaskRunBinding, completeNextOpenTaskStep, getTaskRunBinding, mirrorSessionChatEvent } from '../tasks/task-run-mirror';
import {
  loadScheduleMemory,
  loadRunLog,
  startRunLogEntry,
  completeScheduledRun,
  formatScheduleMemoryForPrompt,
} from '../scheduling/schedule-memory';
import { BackgroundTaskRunner } from '../tasks/background-task-runner';
import { buildPrometheusThreadLinksArtifact, executePrometheusThreadOps } from '../threads/thread-ops';
import {
  addVoiceWorkgroupWorker,
  createVoiceWorkgroup,
  listVoiceWorkgroupsForSession,
  loadVoiceWorkgroup,
  updateVoiceWorkgroupWorkerStatus,
  type VoiceWorkgroupDelivery,
  type VoiceWorkgroupMode,
} from '../voice/voice-workgroup-store';
import { analyzeRunForImprovement, applyPromptMutation } from '../scheduling/prompt-mutation';
import { processTaskFailure, buildSelfRepairTriggerPrompt } from '../errors/error-watchdog';
import {
  decidePostActionObservation,
  summarizeBrowserObservationState,
  summarizeDesktopObservationState,
  type PostActionObservationDecision,
  type BrowserObservationPageState,
  type DesktopObservationPacketState,
} from '../observation-policy';
import { goalDecomposeTool, executeGoalDecompose, approveGoal, loadGoal, listGoals } from '../goal-decomposer';
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
} from '../main-chat-goals';
import {
  listManagedTeams,
  getManagedTeam,
  saveManagedTeam,
  deleteManagedTeam,
  createManagedTeam,
  appendTeamChat,
  appendManagerNote,
  applyTeamChange,
  rejectTeamChange,
  getTeamMemberAgentIds,
  recordTeamRun,
  addTeamNotificationTarget,
  getTeamNotificationTargets,
  listTeamContextReferences,
  addTeamContextReference,
  updateTeamContextReference,
  deleteTeamContextReference,
  buildTeamContextRuntimeBlock,
} from '../teams/managed-teams';
import { triggerManagerReview, handleManagerConversation, setTeamRunAgentFn } from '../teams/team-manager-runner';
import { buildTeamDispatchTask } from '../teams/team-dispatch-runtime';
import { checkForTeamSuggestion } from '../teams/team-detector';
import { SubagentManager } from '../agents-runtime/subagent-manager';
import {
  createInternalWatch,
  listInternalWatches,
  cancelInternalWatch,
} from '../internal-watch/internal-watch-store';
import { observeInternalWatchTarget } from '../internal-watch/internal-watch-runner';
import { runWithInternalWatchTurnContext, setCurrentInternalWatchTurnContext } from '../internal-watch/internal-watch-policy';
export const isFileMutationTool: any = (name: unknown) => FILE_MUTATION_TOOL_NAMES.has(String(name || '').trim());
import { webSearch, webFetch } from '../../tools/web';
import {
  canExecuteToolCallsInParallel,
  executeToolCallsInParallel,
  partitionToolCallsForParallelExecution,
  type ParallelToolCall,
} from '../../tools/parallel-tool-calls.js';
import {
	  buildTools as _buildTools,
	  getToolCategory,
	  isSchemaHiddenCompatToolName,
	  type BuildToolsDeps,
  type ToolResult,
  type TaskControlResponse,
  type ScheduleJobAction,
  normalizeScheduleJobAction,
  summarizeCronJob,
  normalizeDeliveryChannel,
  normalizeToolArgsForTool,
  parseJsonLike,
  toStringRecord,
  parseLooseMap,
} from '../tool-builder';
import {
  executeTool as _executeTool,
  lastFilenameUsed,
} from '../agents-runtime/subagent-executor';
import { countEquivalentFailedReads } from '../tool-failure-guard';
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
} from '../comms/broadcaster';
import { notifyChatCompletion } from '../notifications/completion-bridge';
import {
  getWebPushPublicKey,
  listWebPushSubscriptions,
  removeWebPushSubscription,
  sendWebPushToAll,
  upsertWebPushSubscription,
} from '../notifications/web-push';

import {
  getSessionSkillWindows,
  sessionCurrentTurn,
  isOrchestrationSkillEnabled,
  setOrchestrationEnabled,
  recoverSkillsIfEmpty,
  syncOrchestrationOnStartup,
  initSkillWindows,
  setSkillRecoveryFn,
} from '../skills-runtime/skill-windows';
import { getPrimaryModel } from '../../providers/factory';
import { clearTurnModelOverride, getTurnModelOverride } from '../chat/model-switch-state';
import {
  separateThinkingFromContent,
  sanitizeFinalReply,
  stripExplicitThinkTags,
  normalizeForDedup,
  isGreetingLikeMessage,
} from '../comms/reply-processor';
import {
  initTaskRouter,
  latestTaskForSession,
  findBlockedTaskForSession,
  findClarificationWaitingTask,
  isResumeIntent, isRerunIntent, isCancelIntent,
  isStatusQuestion, isTaskListIntent, isAdjustmentIntent,
  getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
  parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText,
  launchBackgroundTaskRunner, handleTaskControlAction,
  handleTaskRecoveryMessage,
  renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup,
} from '../tasks/task-router';

import {
  router as skillsRouter,
  setSkillsRouterManager,
} from './skills.router';
import {
  router as tasksRouter,
  initTasksRouter,
  makeBroadcastForTask,
} from './tasks.router';
import { sanitizeAgentId, normalizeAgentsForSave } from '../agents/agent-normalize';
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
} from '../live-runtime-registry';
import {
  router as teamsRouter,
  initTeamsRouter,
  pauseManagedTeamInternal,
  resumeManagedTeamInternal,
  buildTeamDispatchContext,
  runTeamAgentViaChat,
} from './teams.router';
import { runTeamAgentViaChat as _runTeamAgentViaChat2, setDispatchDeps } from '../teams/team-dispatch-runtime';
import {
  router as settingsRouter,
  initSettingsRouter,
} from './settings.router';
import {
  router as goalsRouter,
  initGoalsRouter,
} from './goals.router';
import {
  router as proposalsRouter,
  setProposalsBroadcast,
  broadcastProposalCreated,
} from './proposals.router';
import { router as auditLogRouter } from './audit-log.router';
import { router as connectionsRouter } from './connections.router';
import { router as canvasRouter, initCanvasRouter } from './canvas.router';
import { addCanvasFile, getCanvasContextBlock } from './canvas-state';
import { getMCPManager } from '../mcp-manager';
import { resumePlannedRestartMainChats, retriggerDeferredMainChatRuntime, registerRestartContinuityEmitter } from '../runtime-recovery';
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
} from '../chat/chat-helpers';
import { createApp } from '../core/app';
import { createServer } from '../core/server';
import { runStartup } from '../core/startup';
import { isPublicDistributionBuild } from '../../runtime/distribution.js';
import { detectStage4InstructionIntents } from '../../runtime/instruction-intent-detector';
import { isProviderStatusChecking, markProviderStatus, readProviderStatusCache } from '../provider-status';
import { attachWorkspaceCheckpoint, collectSnapshotRefsFromToolResults, createWorkspaceTurnCheckpoint } from '../../workspace-history';
import {
  getCodingContextPacketTelemetry,
  observeCodingContext,
  recordCodingContextPacketDecisionDiagnostic,
  selectCodingContextPacket,
} from '../coding-context-packet';


import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot,
  loadFullMemoryProfile,
  loadWorkspaceFile,
  loadVoiceAgentMemory,
  readDailyMemoryContext,
  processIntradayNotes,
  processIntradayNotesForPrompt,
  isLowInformationAutomaticMemoryQuery,
  detectToolCategories,
  readMemoryCategories,
  readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  buildToolsContext,
  TOOL_BLOCKS,
  TOOL_TO_MEMORY_CATS,
  type SkillWindow,
} from '../prompt-context';
import { buildBrainCapsuleContextDetails } from '../brain/brain-continuity.js';
import {
  formatMemoryAtomReferenceContext,
  formatMemoryAtomReferenceEntries,
  retrieveMemoryAtoms,
} from '../memory-index/memory-atoms.js';
import { OllamaProcessManager } from '../ollama-process-manager';
import { raceWithWatchdog, PreemptState } from '../scheduling/preempt-watchdog';
import { detectGpu, logGpuStatus } from '../gpu-detector';
import {
  registerAgentBuilderTools,
  executeAgentBuilderTool,
  AGENT_BUILDER_TOOL_NAMES,
} from '../agents-runtime/agent-builder-integration';


import { elideStaleToolResults, TOOL_RESULT_ELISION_BATCH_MIN_CHARS } from './tool-result-elision';

import {
  buildTurnContextPacket,
  formatTurnContextPacketsForPrompt,
  normalizeReasoningSummary,
  shouldPersistTurnContext,
} from '../context/turn-context-packet';
import { recordEditLogEntry, recordShellEditLogEntry, formatEditLogForPrompt } from '../context/edit-log';
import { formatUsageAwarenessForPrompt, isUsageLimitError, recordProviderUsageExhausted } from '../../providers/usage-awareness';
import { isChatGPTWebModel } from '../../providers/chatgpt-web/chatgpt-web-models';
import { getRuntimeToolCategoryIds } from '../../runtime/tool-category-manifest';
import { PROM_VIZ_REFERENCE } from '../prom-viz-reference';
import { beginChatGPTBridgeTurn, bindChatGPTBridgeConversation, chatGPTBridgeTurnKey, waitForChatGPTBridgeSlot } from '../../providers/chatgpt-web/chatgpt-bridge-sessions';

// â”€â”€â”€ Injected singletons (set by initChatRouter in server-v2.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export let _cronScheduler: CronScheduler;
export let _telegramChannel: TelegramChannel;
export let _skillsManager: SkillsManager;
let _sessionHistoryHookRegistered = false;

export interface ChatRouterDeps {
  cronScheduler: CronScheduler;
  telegramChannel: TelegramChannel;
  skillsManager: SkillsManager;
}

export function initChatRouter(deps: ChatRouterDeps): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  configureContextWindowDependencies(deps);
  _skillsManager = deps.skillsManager;
  configureVoiceSingletons(deps);
  configureHandleChatDependencies({ runtimeAdmissionLaneForExecutionMode, runtimeAdmissionBudgetForExecutionMode, shouldUseSessionWorkspace, _cronScheduler, runInteractiveTurn, _telegramChannel, _skillsManager, bindTeamNotificationTargetFromSession, broadcastMainChatGoalState, getAgentTeamScheduleToolDefByName, extractTerminalWorkspaceChangesFromToolResult, clampPreemptConfig, inferImageGenerationPresentationMode, isFileMutationTool, buildCapturedScreenshotPreviewPayload, resolveConfiguredAgentReasoning, isGrokGenerationOverride, isGrokGreetingLikeMessage, hasRunawayInvisibleTail, isLikelyGrokInlineLoop, maybeRunMidWorkflowCompaction, withBackgroundJoinKeepalive, stripInvisibleFillerRuns, trimGrokRunawayRepetition, collectTurnFileChanges, inferTaskChannelFromSession });

  if (!_sessionHistoryHookRegistered) {
    _sessionHistoryHookRegistered = true;
    hookBus.register('session:history_changed', (event) => {
      broadcastWS({
        type: 'session_history_changed',
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        historyCount: event.historyCount,
        source: event.source,
      });
    });
  }

  // Wire chat-helpers and task-router singletons (deferred to init time to avoid use-before-assigned)
  initChatHelpers({
    handleChat,
    telegramChannel: _telegramChannel,
    makeBroadcastForTask,
    resumeMainChatGoalsAfterBoot: (sessionIds) => resumeMainChatGoalsInterruptedForRestart(sessionIds),
    resumePlannedRestartMainChats: (runtimeIds, retrigger) => resumePlannedRestartMainChats(runtimeIds, retrigger),
    retriggerInterruptedMainChat: (runtime) => retriggerInterruptedMainChat(runtime),
  });
  initTaskRouter({ handleChat, telegramChannel: _telegramChannel, makeBroadcastForTask, cronScheduler: _cronScheduler });
}

export const router = express.Router();

// End-to-end turn traces: one trace per agent turn, child agents linked by parentTraceId.
registerTracesRoutes(router);


export function requireSafeSessionParam(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = Object.prototype.hasOwnProperty.call(req.params, 'sessionId') ? 'sessionId' : 'id';
  try {
    req.params[key] = assertSafeStorageId(req.params[key], 'session id');
    next();
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid session id.' });
  }
}

router.get(
  '/api/chat/desktop-screenshot-preview/:sessionId/:screenshotId',
  requireSafeSessionParam,
  (req: express.Request, res: express.Response) => {
    const screenshotId = String(req.params.screenshotId || '').trim();
    if (!/^ds_[a-z0-9_]+$/i.test(screenshotId)) {
      res.status(400).json({ success: false, error: 'Invalid screenshot id.' });
      return;
    }
    const packet = getDesktopAdvisorPacketById(req.params.sessionId, screenshotId);
    const base64 = String(packet?.screenshotBase64 || '').trim();
    if (!packet || !base64) {
      res.status(404).json({ success: false, error: 'Screenshot preview is no longer available.' });
      return;
    }
    res.setHeader('Content-Type', packet.screenshotMime || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(base64, 'base64'));
  },
);

export function storageAwareStatus(error: unknown): number {
  return isStorageBoundaryError(error) ? 400 : 500;
}

export type ExecutionMode = 'interactive' | 'background_task' | 'proposal_execution' | 'background_agent' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent';

export function runtimeAdmissionLaneForExecutionMode(executionMode: ExecutionMode): RuntimeAdmissionLane {
  if (executionMode === 'interactive') return 'interactive';
  if (executionMode === 'background_task' || executionMode === 'background_agent') return 'background';
  if (executionMode === 'team_manager') return 'manager';
  if (executionMode === 'team_subagent') return 'team_member';
  return 'system';
}

export function runtimeAdmissionBudgetForExecutionMode(executionMode: ExecutionMode): RuntimeAdmissionBudget {
  return executionMode === 'interactive'
    ? { resourceWeight: 1 }
    : { resourceWeight: 2 };
}

export function resolveConfiguredAgentReasoning(
  executionMode: ExecutionMode,
  providerId: string | undefined,
  model: string | undefined,
): import('../../providers/reasoning-capabilities').ReasoningEffort | undefined {
  const cfg = getConfig().getConfig() as any;
  const defaults = cfg.agent_model_defaults || {};
  const reasoning = cfg.agent_model_default_reasoning || {};
  const candidates: string[] = executionMode === 'interactive'
    ? ['main_chat']
    : executionMode === 'background_agent'
      ? ['background_spawn', 'main_chat']
      : executionMode === 'team_manager'
        ? ['team_manager', 'manager']
        : executionMode === 'team_subagent'
          ? ['team_subagent', 'subagent', 'subagent_planner', 'subagent_orchestrator', 'subagent_researcher', 'subagent_analyst', 'subagent_builder', 'subagent_operator', 'subagent_verifier']
          : executionMode === 'proposal_execution'
            ? ['proposal_executor_high_risk', 'proposal_executor_low_risk']
            : ['main_chat'];
  const activeRef = `${String(providerId || '').trim()}/${String(model || '').trim()}`.toLowerCase();
  const matching = candidates.find((key) => String(defaults[key] || '').trim().toLowerCase() === activeRef && reasoning[key]);
  if (matching) {
    return normalizeReasoningEffort(String(providerId || ''), String(model || ''), reasoning[matching]);
  }

  // A subagent with no explicit reasoning override inherits the selected
  // provider's Settings value. Never borrow a reasoning value from an
  // unrelated execution-mode default just because it happens to exist.
  const providerReasoning = providerId
    ? String(cfg?.llm?.providers?.[providerId]?.reasoning_effort || '').trim()
    : '';
  return providerReasoning
    ? normalizeReasoningEffort(String(providerId || ''), String(model || ''), providerReasoning)
    : undefined;
}
export type ReasoningOptions = {
  enabled?: boolean;
  level?: 'low' | 'medium' | 'high' | 'xhigh' | 'extra_high' | 'max' | 'ultra';
};
export const ROLLING_COMPACTION_SUMMARY_PREFIX = '[Rolling context summary]';
export const LEGACY_COMPACTION_SUMMARY_PREFIX = '[Compacted context summary]';
export const CONTEXT_COMPACTION_TOOL_NAME = 'context_compaction';

export function shouldUseSessionWorkspace(
  executionMode: ExecutionMode,
  sessionWorkspace: string | undefined,
): boolean {
  if (!sessionWorkspace) return false;
  // Normal web/terminal/Telegram chat should follow the workspace selected by
  // the current launcher/config. Persisted per-session workspaces are for
  // scoped autonomous runs such as teams, cron, heartbeats, and proposals.
  return executionMode !== 'interactive';
}

interface RollingCompactionPolicy {
  enabled: boolean;
  toolTurns: number;
  summaryMaxWords: number;
  model: string;
}

export function resolveRollingCompactionPolicy(): RollingCompactionPolicy {
  const cfg = (getConfig().getConfig() as any)?.session || {};
  const enabled = cfg?.rollingCompactionEnabled !== false;
  const toolTurnsRaw = Number(cfg?.rollingCompactionToolTurns);
  const summaryMaxWordsRaw = Number(cfg?.rollingCompactionSummaryMaxWords);
  return {
    enabled,
    toolTurns: Number.isFinite(toolTurnsRaw) ? Math.max(1, Math.min(12, Math.floor(toolTurnsRaw))) : 5,
    summaryMaxWords: Number.isFinite(summaryMaxWordsRaw) ? Math.max(80, Math.min(1500, Math.floor(summaryMaxWordsRaw))) : 900,
    model: String(cfg?.rollingCompactionModel || '').trim(),
  };
}

export type InterruptedMainChatRuntime = {
  id: string;
  sessionId?: string;
  source?: string;
  detail?: string;
  clientRequestId?: string;
  recoveryData?: Record<string, any>;
  checkpoint?: Record<string, any>;
};

/**
 * Start a fresh execution owner for a foreground turn whose gateway process
 * disappeared. The original user message is already durable in session history,
 * so this path deliberately suppresses a second user-message write while still
 * giving the model the exact original request and preserved checkpoint context.
 */

/**
 * Mirror a pre-shutdown suspension notice into the session's still-open stream.
 * runtime-recovery cannot import this module (circular), so it calls us through
 * this registered bridge. Without it, a client replaying the stream from seq 0
 * after reconnecting never learns the turn was suspended rather than dropped.
 */
registerRestartContinuityEmitter((payload: Record<string, any>) => {
  const sessionId = String(payload?.sessionId || '').trim();
  if (!sessionId) return;
  const stream = getMainChatStream(sessionId);
  if (!stream) return;
  try {
    appendMainChatStreamEvent(sessionId, stream.streamId, 'restart_continuity', {
      ...payload,
      priorStreamId: stream.streamId,
    });
  } catch {}
});
registerBackgroundCompletionWake(wakeInterruptedBackgroundOwner);

registerStatusRoutes(router);


registerMobileRoutes(router, { requireSafeSessionParam, pruneMainChatStreams, reconcileMainChatTurn, storageAwareStatus });


// Explicit, typed recovery for foregrounded mobile clients.  It is safe to
// call repeatedly: only an ownerless stream/lease past its grace window is
// discarded, and a live runtime is returned for replay/interrupt instead.


registerVoiceRoutes(router, requireSafeSessionParam);
registerRealtimeVoiceRoutes(router, requireSafeSessionParam);
registerXaiVoiceRoutes(router, requireSafeSessionParam);
registerDispatchVoiceRoutes(router, requireSafeSessionParam);


registerEmailComposerRoutes(router);

registerSteerRoutes(router, { getMainChatStream });


registerPushRoutes(router);

router.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', pinnedMessages, attachments, attachmentPreviews, reasoning, callerContext } = req.body;
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'Message required' }); return; }
  let resolvedSessionId: string;
  try {
    resolvedSessionId = assertSafeStorageId(String(sessionId || 'default'), 'session id');
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Invalid session id.' });
    return;
  }
  const turnTiming = createTurnTimingRecorder(resolvedSessionId, {
    startedAt: Date.now(),
    phase: 'http_admission',
  });
  const traceId = turnTiming.turnId;
  // Expose only the opaque turn correlation ID. It lets the browser join
  // response/SSE marks to the bounded server timing log without logging
  // prompts, tokens, credentials, or request bodies.
  res.setHeader('X-Prometheus-Trace-Id', traceId);
  turnTiming.mark('request_received');
  const excludedSkillIds = normalizeExcludedSkillIdsInput(req.body?.excludedSkillIds || req.body?.excludedMatchingSkillIds);
  const forcedSkillIds = normalizeForcedSkillIdsInput(req.body?.selectedSkillIds || req.body?.forcedSkillIds || req.body?.matchedSkillIds);
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId || req.headers['x-client-request-id']);
  const requestFingerprint = fingerprintMainChatRequest(req.body || {});
  setLastMainSessionId(resolvedSessionId);
  const turnOrigin = normalizeTurnOrigin(req.body?.origin, resolvedSessionId, {
    channel: req.headers['x-pairing-token'] ? 'mobile' : undefined,
    surface: req.headers['x-pairing-token'] ? 'mobile_app' : undefined,
    device: req.headers['x-pairing-token'] ? 'phone' : undefined,
    source: 'api_chat',
  });
  // The benchmark harness can restrict its local synthetic run to the named
  // safe tool family. This is intentionally opt-in and source-scoped: normal
  // clients retain the existing automatic tool selection behavior.
  const benchmarkToolFilter = turnOrigin.source === 'local_benchmark' && Array.isArray(req.body?.toolFilter)
    ? req.body.toolFilter
      .map((value: unknown) => String(value || '').trim())
      .filter((value: string) => /^[a-zA-Z0-9_.*:-]{1,120}$/.test(value))
      .slice(0, 32)
    : undefined;
  // Benchmark-only prompt A/B control. The benchmark runner is a separate
  // process, so its environment cannot directly reach the gateway process;
  // keep the value request-scoped and source-gated so normal clients cannot
  // alter prompt construction.
  const benchmarkPromptMemoryMode = turnOrigin.source === 'local_benchmark'
    && String(req.body?.memoryMode || '').trim().toLowerCase() === 'compact'
    ? 'compact' as const
    : undefined;
  persistTurnOriginChannelHint(resolvedSessionId, turnOrigin);
  const isMobileChatRequest = turnOrigin.channel === 'mobile' || !!req.headers['x-pairing-token'];

  // Reconcile before admission.  A stream/lease is not authoritative without
  // its owning runtime, and must not survive a reconnect as a ghost lock.
  const reconciledTurn = reconcileMainChatTurn(resolvedSessionId);
  pruneMainChatRequestDedupe();
  const activeStream = getMainChatStream(resolvedSessionId);
  const priorRequest = clientRequestId
    ? mainChatRequestDedupe.get(mainChatRequestDedupeKey(resolvedSessionId, clientRequestId))
    : null;
  const admission = decideTurnAdmission({
    active: reconciledTurn.active || mainChatTurnCoordinator.isActive(resolvedSessionId) || activeStream?.active === true,
    activeStreamId: activeStream?.active ? activeStream.streamId : undefined,
    clientRequestId,
    fingerprint: requestFingerprint,
    previous: priorRequest,
  });
  turnTiming.mark('admission_decided', { kind: admission.kind });

  if (admission.kind === 'busy') {
    // A server-started watch review can become active between the phone's last
    // websocket frame and its POST. Treat that narrow race as a live steer,
    // not as a rejected second turn. Persist the user's message before
    // attaching this response to the already-running watch stream.
    const watchRuntime = reconciledTurn.runtime?.source === 'internal_watch'
      ? reconciledTurn.runtime
      : null;
    if (watchRuntime?.id) {
      const steerAttachments = normalizeRuntimeVisionAttachmentsInput(attachments);
      const steerAttachmentPreviews = normalizeRuntimeAttachmentPreviewsInput(attachmentPreviews);
      const steer = addPendingRuntimeSteer(watchRuntime.id, {
        sessionId: resolvedSessionId,
        message,
        source: isMobileChatRequest ? 'mobile_internal_watch_auto_steer' : 'internal_watch_auto_steer',
        clientRequestId: clientRequestId || undefined,
        kind: 'correction',
        requiresWorkerResponse: true,
        attachments: steerAttachments,
        attachmentPreviews: steerAttachmentPreviews,
      });
      if (steer.ok && steer.event) {
        const now = Date.now();
        addMessage(resolvedSessionId, {
          role: 'user',
          content: message,
          timestamp: now,
          channel: turnOrigin.channel,
          channelLabel: 'steer',
          origin: turnOrigin,
          workflowGroupId: `steer_${steer.event.id}`,
          workflowPart: 'interruption',
          workflowLabel: 'Message during internal watch review',
          clientRequestId: clientRequestId || undefined,
          ...(steerAttachmentPreviews.length ? { attachmentPreviews: steerAttachmentPreviews } : {}),
        } as any, { disableCompactionCheck: true, disableMemoryFlushCheck: true });

        const stream = getMainChatStream(resolvedSessionId);
        if (stream?.active) {
          appendMainChatStreamEvent(resolvedSessionId, stream.streamId, 'user_message', {
            message: {
              role: 'user',
              content: message,
              timestamp: now,
              channel: turnOrigin.channel,
              channelLabel: 'steer',
              origin: turnOrigin,
              ...(steerAttachmentPreviews.length ? { attachmentPreviews: steerAttachmentPreviews } : {}),
            },
            clientRequestId: clientRequestId || undefined,
          });
          appendMainChatStreamEvent(resolvedSessionId, stream.streamId, 'info', {
            message: 'Your message was added to the active internal-watch review.',
            clientRequestId: clientRequestId || undefined,
            steerEventId: steer.event.id,
          });
          if (clientRequestId) {
            mainChatRequestDedupe.set(mainChatRequestDedupeKey(resolvedSessionId, clientRequestId), {
              at: now,
              sessionId: resolvedSessionId,
              streamId: stream.streamId,
              fingerprint: requestFingerprint,
            });
          }
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          try { (res as any).flushHeaders?.(); } catch {}
          try { res.write(': connected\n\n'); } catch {}
          await streamExistingMainChatToResponse({
            res,
            sessionId: resolvedSessionId,
            streamId: stream.streamId,
            clientRequestId,
          });
          res.end();
          return;
        }

        // Runtime registration intentionally precedes stream creation. This
        // tiny window still accepts and persists the steer; the websocket
        // stream will appear as soon as runInteractiveTurn starts.
        res.status(202);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({
          type: 'info',
          message: 'Your message was queued into the internal-watch review.',
          clientRequestId: clientRequestId || undefined,
          runtimeId: watchRuntime.id,
          steerEventId: steer.event.id,
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', queued: true, clientRequestId: clientRequestId || undefined })}\n\n`);
        res.end();
        return;
      }
    }
    res.status(409).json({
      success: false,
      code: 'SESSION_TURN_ACTIVE',
      error: 'Another turn is already active for this session. Wait for it to finish or interrupt it before sending a different request.',
      sessionId: resolvedSessionId,
      streamId: admission.streamId,
    });
    return;
  }
  if (admission.kind === 'idempotency_conflict') {
    res.status(409).json({
      success: false,
      code: 'IDEMPOTENCY_KEY_REUSED',
      error: 'This client request ID was already used for a different chat payload.',
      sessionId: resolvedSessionId,
      clientRequestId,
      streamId: admission.streamId,
    });
    return;
  }

  // This is the atomic admission boundary.  The previous implementation
  // created a stream first and waited for the coordinator later, allowing a
  // stale stream and a durable/runtime owner to disagree indefinitely.
  const admissionLease = mainChatTurnCoordinator.tryAcquire(resolvedSessionId);
  if (!admissionLease) {
    const current = reconcileMainChatTurn(resolvedSessionId);
    res.status(409).json({
      success: false,
      code: 'SESSION_TURN_ACTIVE',
      error: 'Another turn is already active for this session. Reconnect to resume it or stop it before sending a different request.',
      sessionId: resolvedSessionId,
      streamId: current.stream?.active ? current.stream.streamId : undefined,
      recovery: current.runtime ? 'resume_or_interrupt' : 'reconcile_then_retry',
    });
    return;
  }

  const startSseResponse = () => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    try { (res as any).flushHeaders?.(); } catch {}
    try { res.write(': connected\n\n'); } catch {}
  };
  startSseResponse();
  turnTiming.mark('sse_started');

  if (admission.kind === 'duplicate') {
      const stream = getMainChatStream(resolvedSessionId);
      res.write(`data: ${JSON.stringify({ type: 'info', message: 'Duplicate chat send ignored; the original request was already accepted.', clientRequestId })}\n\n`);
      if (stream?.streamId === admission.streamId && stream.active) {
        await streamExistingMainChatToResponse({
          res,
          sessionId: resolvedSessionId,
          streamId: stream.streamId,
          clientRequestId,
        });
      } else {
        for (const frame of stream?.events || []) {
          if (stream?.streamId !== admission.streamId) continue;
          res.write(`data: ${JSON.stringify({ type: frame.type, ...(frame.data || {}), seq: frame.seq, streamId: stream.streamId, at: frame.at, clientRequestId })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'done', duplicate: true, clientRequestId })}\n\n`);
      }
      res.end();
      return;
  }

  const chatStream = beginMainChatStream(resolvedSessionId, undefined, admissionLease.leaseId);
  turnTiming.mark('main_stream_started', { streamId: chatStream.streamId });
  if (clientRequestId) {
    mainChatRequestDedupe.set(mainChatRequestDedupeKey(resolvedSessionId, clientRequestId), {
      at: Date.now(),
      sessionId: resolvedSessionId,
      streamId: chatStream.streamId,
      fingerprint: requestFingerprint,
    });
  }

  const httpSendSSE = createSSESender(res);
  let sendSSE = (event: string, data: any) => {
    const attachTrace = event === 'latency_mark'
      || event === 'runtime_registered'
      || event === 'ui_preflight'
      || event === 'progress_state'
      || event === 'final'
      || event === 'done'
      || event === 'error';
    const eventData = (clientRequestId || attachTrace)
      ? {
          ...(data || {}),
          ...(clientRequestId ? { clientRequestId } : {}),
          ...(attachTrace ? { traceId } : {}),
        }
      : data;
    const frame = appendMainChatStreamEvent(resolvedSessionId, chatStream.streamId, event, eventData);
    const payload = frame
      ? { ...(eventData || {}), seq: frame.seq, streamId: chatStream.streamId }
      : eventData;
    httpSendSSE(event, payload);
  };
  const __turnTimingLog = (label: string) => turnTiming.mark(label);
  sendSSE('progress_state', { source: 'none', reason: 'request_start', activeIndex: -1, total: 0, items: [] });
  sendSSE('ui_preflight', { message: 'Request received. Starting chat turn...' });
  let lastNonHeartbeatSseAt = Date.now();
  let lastVisibleHeartbeatAt = 0;
  const foregroundActivity = createForegroundToolActivityTracker();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const idleMs = Math.max(0, now - lastNonHeartbeatSseAt);
    const activity = foregroundActivity.current();
    // Open calls are not proof of progress. Declared blocking waits have a
    // fixed timeout + grace in the owner watchdog; heartbeats cannot renew it.
    const payload: Record<string, any> = { state: 'processing', idleMs, activeTool: activity };
    if (idleMs >= 45_000 && now - lastVisibleHeartbeatAt >= 45_000) {
      lastVisibleHeartbeatAt = now;
      payload.message = foregroundConnectionMessage(activity, idleMs, now);
    }
    try {
      if (!res.destroyed && !res.writableEnded) res.write(': ping\n\n');
    } catch {}
    sendSSE('heartbeat', payload);
  }, 5000);
  let stopMainChatHeartbeat = () => clearInterval(heartbeat);

  // â”€â”€ Model busy guard â€” block cron scheduler while user chat is running â”€â”€
  setModelBusy(true);

  const abortController = new AbortController();
  const abortSignal: { aborted: boolean; signal: AbortSignal; reason?: string; abort?: (reason?: string) => void } = { aborted: false, signal: abortController.signal };
  abortSignal.abort = (reason?: string) => {
    const normalizedReason = String(reason || 'operator_abort').slice(0, 160);
    if (normalizedReason === 'operator_abort') stopMainChatGoalByUser(resolvedSessionId);
    abortSignal.aborted = true;
    abortSignal.reason = normalizedReason;
    if (!abortSignal.signal.aborted) abortController.abort(normalizedReason);
  };
  chatStream.abortExecution = (reason: string) => {
    abortSignal.abort?.(reason);
  };
  let requestCompleted = false;
  let mainChatAbortSettled = false;
  const settleMainChatAbort = (reason: string) => {
    if (mainChatAbortSettled) return;
    mainChatAbortSettled = true;
    stopMainChatHeartbeat();
    const payload = {
      code: 'MAIN_CHAT_RUNTIME_ABORTED',
      message: 'The active Chat turn was aborted before normal completion.',
      reason: String(reason || 'operator_abort').slice(0, 160),
      runtimeId: chatStream.runtimeId,
      clientRequestId: clientRequestId || undefined,
    };
    const frame = appendMainChatStreamEvent(resolvedSessionId, chatStream.streamId, 'error', payload);
    try {
      httpSendSSE('error', frame ? { ...payload, seq: frame.seq, streamId: chatStream.streamId } : payload);
    } catch {}
    finishMainChatStream(resolvedSessionId, chatStream.streamId);
    if (!requestCompleted && !res.destroyed && !res.writableEnded) {
      try { res.end(); } catch {}
    }
  };
  let writeImmediateAbortPacket: (() => void) | undefined;
  const runtimeId = registerLiveRuntime({
    kind: 'main_chat',
    label: 'Main chat',
    sessionId: resolvedSessionId,
    source: turnOrigin.channel,
    detail: String(message || '').slice(0, 160),
    clientRequestId: clientRequestId || undefined,
    abortSignal,
    deferTerminalCleanup: true,
    onAbort: () => {
      abortSignal.abort?.(abortSignal.reason || 'operator_abort');
      // Persist the same continuity shape immediately when the user presses
      // stop. The normal turn finalizer may enrich/replace this packet later.
      try { writeImmediateAbortPacket?.(); } catch (err: any) {
        console.warn('[context] Failed to persist immediate abort packet:', err?.message || err);
      }
      settleMainChatAbort(abortSignal.reason ? String(abortSignal.reason) : 'operator_abort');
    },
    recoveryPolicy: 'mark_interrupted',
    recoveryData: {
      message: String(message || ''),
      origin: turnOrigin,
      chatId: turnOrigin.chatId,
      userId: turnOrigin.userId,
      label: turnOrigin.label,
      attachments: Array.isArray(attachments) ? attachments.map((a: any) => ({ name: a?.name, mimeType: a?.mimeType })) : [],
    },
  });
  chatStream.runtimeId = runtimeId;
  updateLiveRuntimeCheckpoint(runtimeId, {
    event: 'owner_attached',
    streamId: chatStream.streamId,
    admissionLeaseId: admissionLease.leaseId,
  });
  turnTiming.mark('runtime_registered', { runtimeId });
  sendSSE('runtime_registered', {
    runtimeId,
    run: summarizeMobileRuntime(getLiveRuntime(runtimeId)),
  });
  const rawSendSSE = sendSSE;
  const runtimeProcessEntries: Record<string, any>[] = [];
  // Durable path-only list of files this turn changed; survives restarts.
  const runtimeFileTouches: TurnFileTouch[] = [];
  let __firstContentLogged = false;
  let runtimeThinkingTail = '';
  let runtimeNarrationTail = '';
  let lastRuntimeThinkingCheckpointAt = 0;
  let lastRuntimeNarrationCheckpointAt = 0;
  sendSSE = (event, data) => {
    if (event !== 'heartbeat') lastNonHeartbeatSseAt = Date.now();
    foregroundActivity.record(event, data);
    rawSendSSE(event, data);
    // Skip per-token checkpointing â€” token/thinking_delta are high-frequency streaming
    // events that don't need durable persistence. 3 sync fs ops per token was killing
    // streaming throughput by blocking the Node.js event loop on every chunk.
    if (event === 'thinking_delta') {
      if (!__firstContentLogged) { __firstContentLogged = true; __turnTimingLog(`FIRST_CONTENT(${event})`); }
      const delta = String(data?.thinking || data?.text || '').trim();
      if (delta) runtimeThinkingTail = `${runtimeThinkingTail}${delta}`.slice(-4000);
      const now = Date.now();
      if (runtimeThinkingTail && now - lastRuntimeThinkingCheckpointAt >= 2000) {
        lastRuntimeThinkingCheckpointAt = now;
        updateLiveRuntimeCheckpoint(runtimeId, {
          event,
          at: now,
          thinkingTail: runtimeThinkingTail,
          processEntries: runtimeProcessEntries.length ? [...runtimeProcessEntries] : undefined,
        });
      }
      return;
    }
    if (event === 'token') {
      if (!__firstContentLogged) { __firstContentLogged = true; __turnTimingLog(`FIRST_CONTENT(${event})`); }
      const token = String(data?.text || '');
      if (token.trim()) runtimeNarrationTail = `${runtimeNarrationTail}${token}`.slice(-12_000);
      markLiveRuntimeProgress(runtimeId, { event: 'token', phase: 'model_stream' });
      // Keep the newest visible answer/commentary tail in the in-memory
      // runtime checkpoint without reintroducing synchronous per-token disk
      // writes. A graceful shutdown or abort can now capture this tail even
      // when no tool boundary has arrived yet; the debounced normal
      // checkpoints still persist it periodically through non-token events.
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
    if (event === 'ui_preflight') __turnTimingLog(`preflight: ${String(data?.message || '').slice(0, 60)}`);
    else if (event === 'thinking' || event === 'tool_call' || event === 'tool_result' || event === 'progress_state') __turnTimingLog(`${event}: ${String(data?.message || data?.name || data?.action || '').slice(0, 60)}`);
    const checkpoint: Record<string, any> = { event, at: Date.now() };
    checkpoint.activeTool = foregroundActivity.current();
    if (data?.message) checkpoint.message = String(data.message).slice(0, 1000);
    if (data?.action || data?.name) checkpoint.toolName = String(data.action || data.name);
    if (data?.args && typeof data.args === 'object') checkpoint.args = data.args;
    if (data?.result) checkpoint.result = String(data.result).slice(0, 1000);
    if (event === 'thinking') {
      const thinking = String(data?.thinking || data?.text || '').trim();
      if (thinking) runtimeThinkingTail = `${runtimeThinkingTail}\n${thinking}`.trim().slice(-4000);
    }
    if (runtimeThinkingTail) checkpoint.thinkingTail = runtimeThinkingTail;
    if (runtimeNarrationTail) checkpoint.narrationTail = runtimeNarrationTail;
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
    updateLiveRuntimeCheckpoint(runtimeId, checkpoint);
  };
  writeImmediateAbortPacket = () => {
    const runtime = getLiveRuntime(runtimeId);
    const checkpoint = runtime?.checkpoint || {};
    const entries = Array.isArray(checkpoint.processEntries) ? checkpoint.processEntries : [];
    const completedActions = entries
      .filter((entry: any) => entry?.type === 'tool' || entry?.type === 'result' || entry?.type === 'error')
      .slice(-10)
      .map((entry: any) => {
        const toolName = String(entry?.extra?.toolName || '').trim();
        const content = String(entry?.text || entry?.content || entry?.message || entry?.result || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 220);
        return `${toolName || 'runtime step'}: ${entry?.type === 'error' ? 'error' : 'recorded'}${content ? ` â€” ${content}` : ''}`;
      });
    const activeTool = String(checkpoint.toolName || '').trim();
    const visibleCommentary = String(runtimeNarrationTail || checkpoint.narrationTail || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-2_400);
    const packet = buildTurnContextPacket({
      turnId: runtimeId,
      sessionId: resolvedSessionId,
      status: 'aborted',
      request: String(message || ''),
      findings: [
        completedActions.length ? `The runtime recorded ${completedActions.length} completed or attempted step(s) before cancellation.` : '',
        visibleCommentary ? `Last visible commentary before cancellation: ${visibleCommentary}` : '',
        formatBackgroundSpawnContinuity(resolvedSessionId, Number(runtime?.recoveryData?.rootStartedAt || runtime?.startedAt || Date.now()) - 60_000),
      ].filter(Boolean),
      completedActions,
      toolState: activeTool ? `Last runtime boundary: ${activeTool}` : '',
      progressState: [
        String(checkpoint.message || '').slice(0, 700),
        visibleCommentary ? `Visible commentary tail: ${visibleCommentary}` : '',
      ].filter(Boolean).join('\n'),
      uncertainties: [
        activeTool
          ? `The boundary for ${activeTool} may have been in flight when cancellation arrived; verify its effect before retrying.`
          : 'The active model turn was cancelled before a final boundary was recorded.',
      ],
      pendingTasks: [/watchdog|restart|shutdown|drain/i.test(String(abortSignal.reason || ''))
        ? 'Resume the original request automatically from this checkpoint; reconcile spawned agents before repeating work.'
        : 'Resume the original request from this checkpoint when the user asks to continue.'],
      continueFromHere: activeTool
        ? `Verify whether ${activeTool} completed, then continue the original request without repeating confirmed work.`
        : 'Continue the original request from the recorded completed steps.',
      abortReason: describeTurnAbortCause(abortSignal),
    });
    recordWorkingContextPacket(resolvedSessionId, packet, { flush: true });
  };
  res.on('close', () => {
    if (!requestCompleted && !abortSignal.aborted) {
      if (isMobileChatRequest) {
        console.log(`[v2] Mobile client disconnected â€” keeping task alive for session ${resolvedSessionId}`);
        return;
      }
      console.log(`[v2] Desktop client disconnected â€” keeping task alive for session ${resolvedSessionId}`);
    }
  });

  try {
    const result = await runInteractiveTurn(
      message,
	      resolvedSessionId,
	      sendSSE,
	      pinnedMessages,
		      abortSignal,
		      typeof callerContext === 'string' && callerContext.trim() ? callerContext.trim() : undefined,
		      reasoning && typeof reasoning === 'object' ? reasoning : undefined,
		      Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
          Array.isArray(attachmentPreviews) && attachmentPreviews.length > 0 ? attachmentPreviews : undefined,
          undefined,
          { excludedSkillIds, forcedSkillIds, toolFilter: benchmarkToolFilter, timingRecorder: turnTiming, preAcquiredTurnLease: admissionLease, runtimeId, promptMemoryMode: benchmarkPromptMemoryMode },
          turnOrigin,
          { clientRequestId },
			    );
		    if (!abortSignal.aborted) {
		      markProviderStatus(true);
          const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
          const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
          notifyChatCompletion({
            sessionId: resolvedSessionId,
            source: turnOrigin.channel === 'mobile' ? 'mobile' : 'desktop',
            finalText: result.text,
            requestOrigin: host ? `${proto}://${host}` : undefined,
            clientRequestId,
          });
        const finalSendStartedAt = Date.now();
        const clientWorkEndedAt = finalSendStartedAt;
	      sendSSE('final', {
        text: result.text,
        workStartedAt: turnTiming.startedAt,
        workEndedAt: clientWorkEndedAt,
        workDurationMs: Math.max(0, clientWorkEndedAt - turnTiming.startedAt),
        artifacts: result.artifacts,
        generatedImages: result.generatedImages,
        generatedVideos: result.generatedVideos,
        canvasFiles: result.canvasFiles,
        fileChanges: result.fileChanges,
        productCarousel: result.productCarousel,
        richArtifacts: result.richArtifacts,
        goalCompletionReport: result.goalCompletionReport,
      });
	      sendSSE('done', {
        reply: result.text, mode: result.type,
        workStartedAt: turnTiming.startedAt,
        workEndedAt: clientWorkEndedAt,
        workDurationMs: Math.max(0, clientWorkEndedAt - turnTiming.startedAt),
        sections: [{ type: result.type === 'execute' ? 'tool_results' : 'text', content: result.text }],
        thinking: result.thinking,
        results: result.toolResults,
        artifacts: result.artifacts,
        generatedImages: result.generatedImages,
        generatedVideos: result.generatedVideos,
        canvasFiles: result.canvasFiles,
        fileChanges: result.fileChanges,
        productCarousel: result.productCarousel,
        richArtifacts: result.richArtifacts,
        goalCompletionReport: result.goalCompletionReport,
      });
        turnTiming.mark('client_final_sent', { durationMs: Date.now() - finalSendStartedAt });
        enqueuePostTurnJob({
          sessionId: resolvedSessionId,
          label: 'plugin_stop_hooks',
          run: async () => {
            const hooks = await import('../../extensions/plugin-import/plugin-hooks.js').catch(() => null);
            if (!hooks?.hasActivePluginHooks('Stop')) return;
            await hooks.dispatchPluginHooks({ event: 'Stop', sessionId: resolvedSessionId });
          },
        });
        enqueuePostTurnJob({
          sessionId: resolvedSessionId,
          label: 'attach_runtime_process_entries',
          run: () => {
            const attachStartedAt = Date.now();
            attachRuntimeProcessEntriesToLatestAssistant(resolvedSessionId, runtimeProcessEntries);
            turnTiming.mark('runtime_process_entries_attached', {
              durationMs: Date.now() - attachStartedAt,
              deferred: true,
              processEntryCount: runtimeProcessEntries.length,
            });
          },
        });
    }
		  } catch (err: any) {
		    if (!abortSignal.aborted && isTerminalProviderCapacityFailure(err)) {
          // A quota/credit terminal error cannot make progress in this turn.
          // Treat it like a user abort for unfinished dev edits, while keeping
          // their patch and verification evidence available for a new request.
          try {
            const { abandonDevSourceEditContinuationsForSession } = require('../dev-source-approvals');
            abandonDevSourceEditContinuationsForSession({
              sessionId: resolvedSessionId,
              reason: `provider_terminal_failure:${String(err?.message || err).slice(0, 300)}`,
            });
          } catch (cleanupErr: any) {
            console.warn('[v2] Failed to release dev-edit coordination after provider failure:', cleanupErr?.message || cleanupErr);
          }
        }
		    if (!abortSignal.aborted) markProviderStatus(false);
	    if (!abortSignal.aborted) {
      console.error('[v2] ERROR:', err);
      sendSSE('error', { message: err.message || 'Unknown error' });
    }
  } finally {
    requestCompleted = true;
    editRerunAbortResetSessions.delete(resolvedSessionId);
    if (clientRequestId) {
      const dedupeEntry = mainChatRequestDedupe.get(mainChatRequestDedupeKey(resolvedSessionId, clientRequestId));
      if (dedupeEntry?.streamId === chatStream.streamId) dedupeEntry.at = Date.now();
    }
    clearInterval(heartbeat);
    const watchdogInterrupted = abortSignal.aborted && /watchdog/i.test(String(abortSignal.reason || ''));
    if (watchdogInterrupted) {
      // A watchdog abort is recoverable, not a normal terminal finish. Preserve
      // the request and process checkpoint before releasing its owner lease.
      interruptLiveRuntimeForRecovery(runtimeId, 'main_chat_owner_watchdog_timeout');
    } else {
      finishLiveRuntime(runtimeId);
    }
    finishMainChatStream(resolvedSessionId, chatStream.streamId);
    mainChatTurnCoordinator.release(admissionLease);
    if (watchdogInterrupted) {
      // Watchdog is not user cancellation. Once the request owner has actually
      // released its lease, recover immediately if its workers have settled.
      // Otherwise their terminal callback wakes this interrupted runtime.
      const workerIds = listActiveBackgroundIdsForSession(resolvedSessionId);
      if (workerIds.length === 0) {
        const interrupted = listInterruptedRuntimes().find((entry) => entry.id === runtimeId);
        if (interrupted) {
          setTimeout(() => wakeInterruptedBackgroundOwner(resolvedSessionId), 0).unref?.();
        }
      }
    }
    setModelBusy(false); // release busy guard â€” cron scheduler may now run
    const goalAfterUserTurn = snapshotMainChatGoal(resolvedSessionId);
    if (goalAfterUserTurn?.status === 'active') {
      const resumeTimer = setTimeout(() => startMainChatGoalRunner(resolvedSessionId, 'post_user_turn'), 450);
      resumeTimer.unref?.();
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

/** Provider errors that cannot be recovered by continuing this same turn. */
function isTerminalProviderCapacityFailure(error: unknown): boolean {
  const text = String((error as any)?.message || error || '');
  return /personal-team-blocked:spending-limit|usage_limit_reached|usage\s+limit|run out of credits|out of credits|insufficient\s+(?:credits?|quota|usage)|(?:credits?|quota|usage).{0,100}(?:exhausted|limit|exceeded)|rate_limit_error/i.test(text);
}


/** Project membership is stored in the project store rather than the session
 * record.  Expose it on every list response so clients can keep project chats
 * out of the ordinary Chats sidebar. */


// â”€â”€ List sessions endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
registerSessionsRoutes(router, { requireSafeSessionParam, editRerunAbortResetSessions, startMainChatGoalRunner, broadcastMainChatGoalState, storageAwareStatus });


registerRoomsVoiceRoutes(router, requireSafeSessionParam);


// â”€â”€ Get single session by ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
registerSessionsDetailRoutes(router, { requireSafeSessionParam, editRerunAbortResetSessions, startMainChatGoalRunner, broadcastMainChatGoalState, storageAwareStatus });


// Explicit per-chat model route. This is intentionally unrelated to the
// existing session `pinned`/favorite flag above.


// Older transcript pages use an opaque anchor cursor instead of asking clients
// to redownload a progressively larger suffix. The anchor is scoped to the
// session and remains stable when new turns append at the end of the history.


export { handleChat, runInteractiveTurn, bindTeamNotificationTargetFromSession };

configureVoiceDependencies({ ROLLING_COMPACTION_SUMMARY_PREFIX, LEGACY_COMPACTION_SUMMARY_PREFIX, summarizeMobileRuntime, handleChat, router, requireSafeSessionParam, storageAwareStatus, getMainChatStream, runInteractiveTurn, bindTeamNotificationTargetFromSession, inferTaskChannelFromSession });

// Wire pipeline dependencies after router-owned state has been initialized.
configureCompactionDependencies({ ROLLING_COMPACTION_SUMMARY_PREFIX, LEGACY_COMPACTION_SUMMARY_PREFIX, resolveRollingCompactionPolicy, CONTEXT_COMPACTION_TOOL_NAME });
configureGoalRunnerDependencies({ activeMainChatGoalRuns, broadcastMainChatGoalState, runInteractiveTurn, appendRuntimeNarrationBoundary, runtimeProcessEntryFromSseEvent, appendRuntimeFileTouch, attachRuntimeProcessEntriesToLatestAssistant, delayMs });
configureInteractiveTurnDependencies({ normalizeTurnOrigin, persistTurnOriginChannelHint, getMainChatStream, beginMainChatStream, findSessionMainChatRuntime, announceRestartContinuityResumed, normalizeClientRequestId, appendMainChatStreamEvent, broadcastMainChatGoalState, startMainChatGoalRunner, CONTEXT_COMPACTION_TOOL_NAME, handleChat, maybeRefreshProjectLearning, shouldCheckBlockedTaskFollowup, formatTurnOriginContext, collectTurnFileChanges, buildDurableToolStreamTrace, describeTurnAbortCause, editRerunAbortResetSessions, isPlannedRestartToolName, maybeAutoNameChatSession, finishMainChatStream });
configureRestartContinuityDependencies({ normalizeTurnOrigin, appendRuntimeNarrationBoundary, runtimeProcessEntryFromSseEvent, appendRuntimeFileTouch, runInteractiveTurn, appendMainChatStreamEvent });
configureStreamDependencies({ getMainChatStream, router, requireSafeSessionParam, pruneMainChatStreams, reconcileMainChatTurn, storageAwareStatus });
