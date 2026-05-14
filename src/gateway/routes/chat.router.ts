/**
 * routes/chat.router.ts — B6 Refactor
 *
 * The chat pipeline: handleChat + /api/chat SSE endpoint + /api/status.
 * Extracted verbatim from server-v2.ts — zero logic changes.
 *
 * Module-scope singletons (cronScheduler, telegramChannel, skillsManager)
 * are injected via initChatRouter() — same pattern as all other routers.
 */


import express from 'express';
// cors and http moved to core/app.ts + core/server.ts (B3)
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
// WebSocketServer + WebSocket moved to core/server.ts (B3)
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../config/config';
import { getVault } from '../../security/vault';
import { isOnboardingSession, getMeetAndGreetSystemPrompt } from '../onboarding/meet-prompt';
import { getOllamaClient } from '../../agents/ollama-client';
import { parseProviderModelRef } from '../../agents/model-routing.js';
import { spawnAgent } from '../../agents/spawner';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getRecentToolLog, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, replaceHistory, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt } from '../session';
import { hookBus } from '../hooks';
import { loadWorkspaceHooks } from '../hook-loader';
import { runBootMd } from '../boot';
import { refreshProjectContextForSession } from '../projects/project-learning.js';
import { findProjectBySessionId, removeSessionFromProject } from '../projects/project-store.js';
import { TaskRunner, runTask, TaskTool, TaskState, bgPlanDeclare, bgPlanAdvance, backgroundJoin } from '../tasks/task-runner';
import { setupErrorResponseEndpoint } from '../errors/error-response-endpoint-integrated';
import { initCredentialHandler, getCredentialHandler } from '../../security/credential-handler';
import { getVerificationFlowManager } from '../verification-flow';
import { getErrorAnalyzer } from '../errors/error-analyzer';
import { getErrorHistory } from '../errors/error-history';
import { getRetryStrategy } from '../retry-strategy';
import { getVisualErrorDetector } from '../visual-error-detection';
import { getErrorAudit } from '../../security/error-audit';
import { getContextInjectionManager } from '../context-injection';
import { SkillsManager } from '../skills-runtime/skills-manager';
import { buildSelfReflectionInstruction } from '../../config/self-reflection.js';
import { recordSkillGardenerTurn } from '../brain/skill-episodes.js';
import {
  browserOpen,
  browserSnapshot,
  browserSnapshotDelta,
  browserClick,
  browserFill,
  browserPressKey,
  browserWait,
  browserScroll,
  browserClose,
  formatBrowserInteractionContextBlock,
  browserGetFocusedItem,
  browserGetPageText,
  getBrowserToolDefinitions,
  getBrowserSessionInfo,
  getBrowserAdvisorPacket,
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
  desktopScreenshot,
  desktopFindWindow,
  desktopFocusWindow,
  desktopClick,
  desktopDrag,
  desktopWait,
  desktopType,
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
  desktopGetActiveMonitorIndex,
  getDesktopToolDefinitions,
  getDesktopAdvisorPacket,
} from '../desktop-tools';
// import { runDesktopTask } from '../tasks/desktop-task-runner'; // removed — module deleted
import { CronScheduler } from '../scheduling/cron-scheduler';
import { HeartbeatRunner } from '../scheduling/heartbeat-runner';
import {
  initializeAgentSchedules,
  reloadAgentSchedules,
  stopAgentSchedules,
  getAgentRunHistory,
  getAgentLastRun,
  recordAgentRun,
  setSchedulerBroadcast,
  setSchedulerRunAgentFn,
} from '../../scheduler';
import { TelegramChannel } from '../comms/telegram-channel';
// orchestration/multi-agent removed — stubs to prevent reference errors
const OrchestrationTriggerState: any = class { recordToolResult() {} recordRoundNoProgress() {} shouldTrigger() { return { fire: false, reason: '' }; } markFired() {} };
const callSecondaryPreflight: any = async () => null;
const callSecondaryAdvisor: any = async () => null;
const callSecondaryFileOpClassifier: any = async () => null;
const callSecondaryFileAnalyzer: any = async () => null;
const callSecondaryFileVerifier: any = async () => null;
const callSecondaryFilePatchPlanner: any = async () => null;
const callSecondaryBrowserAdvisor: any = async () => null;
const callSecondaryDesktopAdvisor: any = async () => null;
const formatPreflightExecutionObjective: any = () => '';
const formatPreflightHint: any = () => '';
const formatAdvisoryHint: any = () => '';
const formatBrowserAdvisorHint: any = () => '';

function formatRecentMessagesForCreativeHandoff(
  history: Array<{ role: string; content: string }>,
  currentMessage: string,
): string {
  const current = String(currentMessage || '').trim();
  const recent = (history || [])
    .filter((m) => {
      const role = String(m?.role || '').trim();
      const content = String(m?.content || '').trim();
      if (!role || !content) return false;
      return !(role === 'user' && current && content === current);
    })
    .slice(-5);
  if (!recent.length) return '';
  return recent
    .map((m, index) => {
      const role = String(m.role || 'message').toUpperCase();
      const content = String(m.content || '').replace(/\r/g, '').trim();
      return `${index + 1}. ${role}: ${content}`;
    })
    .join('\n\n');
}

function formatSkillsReadForCreativeHandoff(toolResults: ToolResult[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const tr of toolResults || []) {
    if (tr?.name !== 'skill_read' || tr.error) continue;
    const id = String((tr.args as any)?.id || (tr.args as any)?.skill_id || '').trim() || `skill_${blocks.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const content = String(tr.result || '').replace(/\r/g, '').trim();
    if (!content) continue;
    blocks.push(`--- skill_read: ${id} ---\n${content}`);
  }
  return blocks.join('\n\n');
}

function formatPreCreativeSwitchToolResultsForHandoff(toolResults: ToolResult[]): string {
  const results = (toolResults || [])
    .filter((tr) => tr && tr.name && tr.name !== 'switch_creative_mode' && tr.name !== 'enter_creative_mode' && tr.name !== 'exit_creative_mode');
  if (!results.length) return '';

  const blocks = results.map((tr, index) => {
    let args = '{}';
    try {
      args = JSON.stringify(tr.args || {});
    } catch {}
    const result = String(tr.result || '').replace(/\r/g, '').trim();
    return [
      `--- pre_switch_tool_${index + 1}: ${tr.name}${tr.error ? ' [ERROR]' : ''} ---`,
      `args: ${args}`,
      result ? `result:\n${result}` : 'result: (empty)',
    ].join('\n');
  });

  return blocks.join('\n\n');
}
const formatDesktopAdvisorHint: any = () => '';
const getOrchestrationConfig: any = () => null;
const clampOrchestrationConfig: any = (x: any) => x;
const clampPreemptConfig: any = (x: any) => x;
const checkOrchestrationEligibility: any = () => false;
const shouldRunPreflight: any = () => false;
const secondarySupportsVision: any = () => false;
import { resolvePrimaryModelCapabilities, buildVisionImagePart, type ModelCapabilities } from '../vision-chat';
import {
  browserVisionScreenshot,
  browserVisionClick,
  browserVisionType,
  browserPreviewScreenshot,
} from '../browser-tools';
import {
  createTask,
  loadTask,
  saveTask,
  updateTaskStatus,
  setTaskStepRunning,
  updateTaskRuntimeProgress,
  appendJournal,
  updateResumeContext,
  listTasks,
  deleteTask,
  mutatePlan,
  getEvidenceBusSnapshot,
  type TaskRecord,
  type TaskStatus,
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
  applyMainChatGoalJudgeResult,
  buildMainChatGoalContinuationPrompt,
  handleMainChatGoalCommand,
  isMainChatGoalContinuation,
  judgeMainChatGoal,
  maybeSummarizeMainChatGoal,
  recordMainChatGoalDeniedAction,
  recordMainChatGoalRuntimeFailure,
  resolveMainChatGoalPolicy,
  snapshotMainChatGoal,
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
// orchestration/file-op-v2 removed — stubs to prevent reference errors
type FileOpType = 'CHAT' | 'FILE_EDIT' | 'FILE_CREATE' | 'FILE_ANALYSIS' | 'BROWSER_OP' | 'DESKTOP_OP';
class FileOpProgressWatchdog { constructor(_n: number) {} record(_x: any) { return { no_progress: false }; } }
const classifyFileOpType: any = () => ({ type: 'CHAT' as FileOpType, reason: 'file-op v2 disabled' });
const resolveFileOpSettings: any = () => ({ enabled: false, watchdog_no_progress_cycles: 3, checkpointing_enabled: false, primary_edit_max_lines: 200, primary_edit_max_chars: 8000, primary_edit_max_files: 3 });
const isFileMutationTool: any = () => false;
const isFileCreateTool: any = () => false;
const isFileEditTool: any = () => false;
const extractFileToolTarget: any = () => null;
const estimateFileToolChange: any = () => ({ lines_changed: 0, chars_changed: 0 });
const canPrimaryApplyFileTool: any = () => ({ allowed: true, reason: '' });
const shouldVerifyFileTurn: any = () => ({ verify: false, reasons: [] });
const isSmallSuggestedFix: any = () => false;
const buildFailureSignature: any = () => '';
const buildPatchSignature: any = () => '';
const loadFileOpCheckpoint: any = () => null;
const saveFileOpCheckpoint: any = () => {};
const clearFileOpCheckpoint: any = () => {};
import { webSearch, webFetch } from '../../tools/web';
import {
	  buildTools as _buildTools,
	  getToolCategory,
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
  type TelegramChannelConfig,
  type DiscordChannelConfig,
  type WhatsAppChannelConfig,
  type ChannelsConfig,
  normalizeTelegramConfig,
  normalizeDiscordConfig,
  normalizeWhatsAppConfig,
} from '../comms/broadcaster';

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
import { buildProviderById, getPrimaryModel } from '../../providers/factory';
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
import {
  router as channelsRouter,
  initChannelsRouter,
  sanitizeAgentId,
  normalizeAgentsForSave,
} from './channels.router';
import {
  registerLiveRuntime,
  finishLiveRuntime,
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
  buildBrowserAck,
  buildDesktopAck,
  buildDesktopScreenshotContent,
  buildVisionScreenshotMessage,
  // Chat intent classifiers
  isExecutionLikeRequest,
  isBrowserAutomationRequest,
  isDesktopAutomationRequest,
  extractLikelyUrl,
  looksLikeSafetyRefusal,
  looksLikeIntentOnlyReply,
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
import { isProviderStatusChecking, markProviderStatus, readProviderStatusCache } from '../provider-status';


import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot,
  loadWorkspaceFile,
  readDailyMemoryContext,
  detectToolCategories,
  readMemoryCategories,
  readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  TOOL_BLOCKS,
  TOOL_TO_MEMORY_CATS,
  type SkillWindow,
} from '../prompt-context';
import { OllamaProcessManager } from '../ollama-process-manager';
import { raceWithWatchdog, PreemptState } from '../scheduling/preempt-watchdog';
import { detectGpu, logGpuStatus } from '../gpu-detector';
import { internalAgentTaskRouter } from '../agents-runtime/internal-agent-task';
import {
  registerAgentBuilderTools,
  executeAgentBuilderTool,
  AGENT_BUILDER_TOOL_NAMES,
  getWorkflowContextBlock,
} from '../agents-runtime/agent-builder-integration';


import { activeTasks, getMaxToolRounds } from '../chat/chat-state';
const MAX_TOOL_ROUNDS = getMaxToolRounds();

function resolveEffectiveMaxToolRounds(
  baseMax: number,
  opts: { creativeMode?: string | null; executionMode: ExecutionMode; message: string },
): number {
  const configured = Number.isFinite(baseMax) && baseMax > 0 ? Math.floor(baseMax) : 80;
  const msg = String(opts.message || '');
  const toolHeavyInteractive =
    opts.executionMode === 'interactive'
    && (
      !!opts.creativeMode
      || /\b(browser|desktop|creative mode|video|clip|export|render|canvas|automation)\b/i.test(msg)
    );

  if (opts.creativeMode === 'video') return Math.max(configured, 160);
  if (opts.creativeMode) return Math.max(configured, 120);
  if (toolHeavyInteractive) return Math.max(configured, 120);
  if (
    opts.executionMode === 'background_task'
    || opts.executionMode === 'background_agent'
    || opts.executionMode === 'proposal_execution'
    || opts.executionMode === 'cron'
    || opts.executionMode === 'team_manager'
    || opts.executionMode === 'team_subagent'
  ) {
    return Math.max(configured, 100);
  }
  return configured;
}

function isResumableExecutionMode(executionMode: ExecutionMode): boolean {
  return executionMode === 'background_task'
    || executionMode === 'background_agent'
    || executionMode === 'proposal_execution'
    || executionMode === 'cron'
    || executionMode === 'team_manager'
    || executionMode === 'team_subagent';
}

// ─── Injected singletons (set by initChatRouter in server-v2.ts) ──────────────
let _cronScheduler: CronScheduler;
let _telegramChannel: TelegramChannel;
let _skillsManager: SkillsManager;

export interface ChatRouterDeps {
  cronScheduler: CronScheduler;
  telegramChannel: TelegramChannel;
  skillsManager: SkillsManager;
}

export function initChatRouter(deps: ChatRouterDeps): void {
  _cronScheduler = deps.cronScheduler;
  _telegramChannel = deps.telegramChannel;
  _skillsManager = deps.skillsManager;

  // Wire chat-helpers and task-router singletons (deferred to init time to avoid use-before-assigned)
  initChatHelpers({ handleChat, telegramChannel: _telegramChannel, makeBroadcastForTask });
  initTaskRouter({ handleChat, telegramChannel: _telegramChannel, makeBroadcastForTask, cronScheduler: _cronScheduler });
}

export const router = express.Router();

type ExecutionMode = 'interactive' | 'background_task' | 'proposal_execution' | 'background_agent' | 'heartbeat' | 'cron' | 'team_manager' | 'team_subagent';
type ReasoningOptions = {
  enabled?: boolean;
  level?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'extra_high';
};
const ROLLING_COMPACTION_SUMMARY_PREFIX = '[Rolling context summary]';
const LEGACY_COMPACTION_SUMMARY_PREFIX = '[Compacted context summary]';
const CONTEXT_COMPACTION_TOOL_NAME = 'context_compaction';

function shouldUseSessionWorkspace(
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
  messageCount: number;
  toolTurns: number;
  summaryMaxWords: number;
  model: string;
}

function resolveRollingCompactionPolicy(): RollingCompactionPolicy {
  const cfg = (getConfig().getConfig() as any)?.session || {};
  const enabled = cfg?.rollingCompactionEnabled !== false;
  const messageCountRaw = Number(cfg?.rollingCompactionMessageCount);
  const toolTurnsRaw = Number(cfg?.rollingCompactionToolTurns);
  const summaryMaxWordsRaw = Number(cfg?.rollingCompactionSummaryMaxWords);
  return {
    enabled,
    messageCount: Number.isFinite(messageCountRaw) ? Math.max(10, Math.min(120, Math.floor(messageCountRaw))) : 20,
    toolTurns: Number.isFinite(toolTurnsRaw) ? Math.max(1, Math.min(12, Math.floor(toolTurnsRaw))) : 5,
    summaryMaxWords: Number.isFinite(summaryMaxWordsRaw) ? Math.max(80, Math.min(500, Math.floor(summaryMaxWordsRaw))) : 220,
    model: String(cfg?.rollingCompactionModel || '').trim(),
  };
}

function isCompactionSummaryMessage(msg: any): boolean {
  if (!msg || msg.role !== 'assistant') return false;
  const text = String(msg.content || '').trim();
  return text.startsWith(ROLLING_COMPACTION_SUMMARY_PREFIX) || text.startsWith(LEGACY_COMPACTION_SUMMARY_PREFIX);
}

function extractLastCompactionSummary(history: Array<any>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!isCompactionSummaryMessage(msg)) continue;
    const raw = String(msg.content || '').trim();
    const stripped = raw
      .replace(/^\[Rolling context summary\]\s*/i, '')
      .replace(/^\[Compacted context summary\]\s*/i, '')
      .trim();
    if (stripped) return stripped;
  }
  return '';
}

function formatCompactionMessages(messages: Array<any>): string {
  const newestFirst = [...messages].reverse();
  return newestFirst.map((msg, idx) => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const ts = Number(msg.timestamp);
    const stamp = Number.isFinite(ts) ? new Date(ts).toISOString() : 'unknown-time';
    const body = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    return `${idx + 1}. [${role}] (${stamp}) ${body}`;
  }).join('\n');
}

function formatCompactionToolLogs(messages: Array<any>, toolTurns: number): string {
  const lines = messages
    .filter((m) => m.role === 'assistant' && m.toolLog)
    .slice(-toolTurns)
    .reverse()
    .map((m, idx) => {
      const toolLog = String(m.toolLog || '').trim().slice(0, 500);
      return `${idx + 1}. ${toolLog}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

function getRollingCompactionProgress(
  session: any,
  incomingUserMsg?: { role: 'user'; content: string; timestamp: number },
): { nonSummarySinceCheckpoint: number; candidateNonSummaryMessages: Array<any> } {
  const history = Array.isArray(session?.history) ? session.history : [];
  const candidateHistory = incomingUserMsg ? [...history, incomingUserMsg] : [...history];
  const checkpointRaw = Number((session as any)?.contextStartIndex);
  const checkpoint = Number.isFinite(checkpointRaw)
    ? Math.max(0, Math.min(Math.floor(checkpointRaw), candidateHistory.length))
    : 0;
  const candidateSinceCheckpoint = candidateHistory.slice(checkpoint);
  const candidateNonSummaryMessages = candidateSinceCheckpoint.filter((msg: any) => !isCompactionSummaryMessage(msg));
  return {
    nonSummarySinceCheckpoint: candidateNonSummaryMessages.length,
    candidateNonSummaryMessages,
  };
}

function buildFallbackCompactionSummary(previousSummary: string, recentWindow: Array<any>, maxWords: number): string {
  const lines: string[] = [];
  if (previousSummary) {
    lines.push(`Previous summary: ${previousSummary.replace(/\s+/g, ' ').trim().slice(0, 900)}`);
  }
  const newestFirst = [...recentWindow].reverse().slice(0, 10);
  if (newestFirst.length > 0) lines.push('Latest updates (newest first):');
  for (const msg of newestFirst) {
    const role = msg.role === 'assistant' ? 'Assistant' : 'User';
    const body = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (body) lines.push(`- ${role}: ${body}`);
  }
  const words = lines.join('\n').split(/\s+/).filter(Boolean);
  return words.slice(0, Math.max(80, maxWords)).join(' ').trim();
}

async function maybeRunRollingCompaction(
  sessionId: string,
  incomingUserMsg: { role: 'user'; content: string; timestamp: number },
  abortSignal?: { aborted: boolean; signal?: AbortSignal },
): Promise<{ compacted: boolean; summaryText?: string; mode?: 'llm' | 'fallback' }> {
  const policy = resolveRollingCompactionPolicy();
  if (!policy.enabled) return { compacted: false };
  const session = getSession(sessionId);
  const { nonSummarySinceCheckpoint, candidateNonSummaryMessages } = getRollingCompactionProgress(session, incomingUserMsg);
  if (nonSummarySinceCheckpoint < policy.messageCount) return { compacted: false };

  const recentWindow = candidateNonSummaryMessages.slice(-policy.messageCount);
  const previousSummary = String((session as any).latestContextSummary || '').trim()
    || extractLastCompactionSummary(session.history || []);
  const recentMessagesBlock = formatCompactionMessages(recentWindow);
  const recentToolLogsBlock = formatCompactionToolLogs(recentWindow, policy.toolTurns);

  const promptLines: string[] = [
    'Create a single rolling thread summary for context compaction.',
    `Target length: <= ${policy.summaryMaxWords} words.`,
    'Prioritize the most recent events first, but keep critical older context.',
    'Include: current goal, key constraints/preferences, decisions made, files/tools touched, and unresolved items.',
    'Do not invent details. If uncertain, say unclear.',
    'Output plain text only.',
    '',
    '[PREVIOUS_SUMMARY]',
    previousSummary || '(none)',
    '',
    `[RECENT_MESSAGES newest->oldest, window=${policy.messageCount}]`,
    recentMessagesBlock || '(none)',
    '',
    `[RECENT_TOOL_LOGS newest->oldest, window=${policy.toolTurns}]`,
    recentToolLogsBlock || '(none)',
  ];

  try {
    const ollama = getOllamaClient();
    const compactResult = await ollama.chatWithThinking(
      [
        {
          role: 'system',
          content: 'You are ContextCompactor. You only produce a faithful rolling summary for context retention. No tools, no chatter.',
        },
        {
          role: 'user',
          content: promptLines.join('\n'),
        },
      ],
      'manager',
      {
        temperature: 0.1,
        num_ctx: 4096,
        num_predict: 520,
        ...(policy.model ? { model: policy.model } : {}),
        usageContext: { sessionId, agentId: 'context_compactor' },
      },
    );

    if (abortSignal?.aborted) return { compacted: false };

    const rawSummary = String(compactResult?.message?.content || '');
    const summary = String(stripExplicitThinkTags(rawSummary)?.cleaned || '').trim() || previousSummary;
    const boundedSummary = summary.slice(0, 5000).trim();
    if (!boundedSummary) return { compacted: false };

    recordSessionCompaction(
      sessionId,
      'rolling',
      boundedSummary,
      session.history.length,
      {
        strategy: 'rolling_window',
        message_window: policy.messageCount,
        tool_turn_window: policy.toolTurns,
        summary_max_words: policy.summaryMaxWords,
        mode: 'llm',
      },
    );
    return { compacted: true, summaryText: boundedSummary, mode: 'llm' };
  } catch (err: any) {
    console.warn('[v2] Rolling context compaction failed:', err?.message || err);
    const fallbackSummary = buildFallbackCompactionSummary(previousSummary, recentWindow, policy.summaryMaxWords);
    if (!fallbackSummary) return { compacted: false };
    try {
      recordSessionCompaction(
        sessionId,
        'rolling',
        fallbackSummary,
        session.history.length,
        {
          strategy: 'rolling_window',
          message_window: policy.messageCount,
          tool_turn_window: policy.toolTurns,
          summary_max_words: policy.summaryMaxWords,
          mode: 'fallback',
        },
      );
      return { compacted: true, summaryText: fallbackSummary, mode: 'fallback' };
    } catch (fallbackErr: any) {
      console.warn('[v2] Rolling compaction fallback failed:', fallbackErr?.message || fallbackErr);
      return { compacted: false };
    }
  }
}

async function handleChat(
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
  abortSignal?: { aborted: boolean; signal?: AbortSignal },
  callerContext?: string,
  modelOverride?: string,
  executionMode: ExecutionMode = 'interactive',
  toolFilter?: string[],  // Piece 2: optional allowlist (supports wildcards like browser_*)
  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
  reasoningOptions?: ReasoningOptions,
  providerOverride?: string,
): Promise<HandleChatResult> {
  try {
  const ollama = getOllamaClient();
  const isBootStartupTurn = /\bBOOT\.md\b/i.test(String(callerContext || ''));
  const isHotRestartTurn = /\[HOT RESTART CONTEXT\]/i.test(String(callerContext || ''));
  const bootAllowedTools = new Set(['list_files', 'read_file']);
  const configuredWorkspace = getConfig().getWorkspacePath();
  const sessionWorkspace = getWorkspace(sessionId);
  // Scoped execution workspaces (set by team dispatch, cron scheduler, etc.) take
  // priority over the global config path. For normal interactive chat, the current
  // launcher/config remains authoritative so stale persisted sessions cannot keep
  // a dev run bound to an old AppData/legacy workspace or vice versa.
  const workspacePath = shouldUseSessionWorkspace(executionMode, sessionWorkspace)
    ? sessionWorkspace
    : configuredWorkspace;
  if (workspacePath && sessionWorkspace !== workspacePath) {
    setWorkspace(sessionId, workspacePath);
  }
  const rawSendSSE = sendSSE;
  sendSSE = (event: string, data: any) => {
    rawSendSSE(event, data);
    mirrorSessionChatEvent(sessionId, event, data, broadcastWS);
  };
  const isHandleChatGoalContinuation = isMainChatGoalContinuation(message);
  const handleChatGoalPolicy = isHandleChatGoalContinuation ? resolveMainChatGoalPolicy() : null;
  const handleChatGoalExecutionPolicy = isHandleChatGoalContinuation ? {
    mode: 'goal_autonomous' as const,
    approvalMode: handleChatGoalPolicy?.permissions.approvalMode || 'never' as const,
    hardDeny: handleChatGoalPolicy?.permissions.hardDenyEnabled !== false,
  } : undefined;
  const buildExecuteToolDeps = (): any => ({
    cronScheduler: _cronScheduler,
    handleChat,
    telegramChannel: _telegramChannel,
    skillsManager: _skillsManager,
    sanitizeAgentId,
    normalizeAgentsForSave,
    buildTeamDispatchContext,
    runTeamAgentViaChat,
    bindTeamNotificationTargetFromSession,
    pauseManagedTeamInternal,
    resumeManagedTeamInternal,
    handleTaskControlAction,
    makeBroadcastForTask,
    sendSSE,
    executionPolicy: handleChatGoalExecutionPolicy,
    onHardToolDeny: (event: any) => {
      if (!isHandleChatGoalContinuation) return;
      const updated = recordMainChatGoalDeniedAction(sessionId, {
        toolName: event.toolName,
        category: event.decision?.category,
        reason: event.decision?.reason,
        safeAlternative: event.decision?.safeAlternative,
      });
      broadcastMainChatGoalState(sessionId, 'policy_denied', { goal: updated, denial: event.decision, toolName: event.toolName });
    },
  });
  const finalizeBoundTaskRun = (status: 'complete' | 'failed', summary: string) => {
    const binding = getTaskRunBinding(sessionId);
    if (!binding?.taskId) return;
    const text = String(summary || '').trim();
    if (status === 'complete') {
      completeNextOpenTaskStep(binding.taskId, text.slice(0, 200));
    }
    updateTaskStatus(binding.taskId, status, { finalSummary: text });
    appendJournal(binding.taskId, {
      type: status === 'complete' ? 'status_push' : 'error',
      content: `${status === 'complete' ? 'Done' : 'Failed'}: ${text.slice(0, 240)}`,
      detail: text.slice(0, 2000),
    });
    broadcastWS({ type: status === 'complete' ? 'task_complete' : 'task_failed', taskId: binding.taskId, summary: text });
    broadcastWS({ type: 'task_panel_update', taskId: binding.taskId });
    clearTaskRunBinding(sessionId, binding.taskId);
  };
  console.log(`[v2] SESSION: ${sessionId} | Workspace: ${workspacePath}`);
  const creativeMode = executionMode === 'interactive' ? getCreativeMode(sessionId) : null;
  const effectiveMaxToolRounds = resolveEffectiveMaxToolRounds(MAX_TOOL_ROUNDS, {
    creativeMode,
    executionMode,
    message,
  });
  const history = executionMode === 'cron'
    ? []
    : getHistoryForApiCall(sessionId, 10);
  if (executionMode !== 'cron') {
    autoActivateToolCategories(sessionId, message, history.length);
  }
  // Build compact tool log from last 3 assistant turns — injected into system prompt
  // so the model always knows what it recently did even across the short history window.
  const recentToolLog = executionMode === 'cron' ? '' : getRecentToolLog(sessionId, 3, 1500);
  const inferReferenceImageMimeType = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/png';
  };
  const resolveReferenceImagePath = (rawPath: string): string | null => {
    const value = String(rawPath || '').trim();
    if (!value) return null;
    const absPath = path.isAbsolute(value) ? value : path.resolve(workspacePath, value);
    try {
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;
    } catch {
      return null;
    }
    return null;
  };
  const buildCreativeReferenceVisionMessage = (): any | null => {
    if (!creativeMode || !currentModelCapabilities.hasVision) return null;
    const refs = getCreativeReferences(sessionId);
    const images: Array<{ path: string; label: string; mimeType: string; base64: string }> = [];
    for (const ref of refs) {
      const candidates = ref.selectedFrames.length > 0
        ? ref.selectedFrames
        : (ref.kind === 'image' && ref.path ? [ref.path] : []);
      for (const candidate of candidates.slice(0, 4)) {
        const absPath = resolveReferenceImagePath(candidate);
        if (!absPath) continue;
        try {
          images.push({
            path: candidate,
            label: `${ref.kind} ${ref.authority} ${ref.intent}`,
            mimeType: inferReferenceImageMimeType(absPath),
            base64: fs.readFileSync(absPath).toString('base64'),
          });
        } catch {
          // Skip unreadable reference frames; the text path remains in the prompt.
        }
        if (images.length >= 10) break;
      }
      if (images.length >= 10) break;
    }
    if (!images.length) return null;
    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `[CREATIVE_REFERENCE_FRAME_OBSERVATION]\n` +
            `These are saved reference images/frames from this chat session. Use direct visual perception of them as style, pacing, composition, typography, UI, and motion-direction evidence before creating or revising the active Creative ${creativeMode} work.\n` +
            images.map((image, index) => `#${index + 1} ${image.label}: ${image.path}`).join('\n'),
        },
        ...images.map((image) => buildVisionImagePart(image.base64, image.mimeType)),
      ],
    };
  };
  // Build full tool list after applying session-scoped category activation.
  // Category activation mutates session state, so this is rebound inside a turn.
  // Telegram sessions: hide start_task so the model never tries to background-task anything.
  // Telegram runs inline (interactive mode) and the background task path has broken tool-arg
  // serialisation that causes browser_open to receive JSON strings instead of objects.
  const isTelegramSessionForTools = String(sessionId || '').startsWith('telegram_');
  // Runtime subagents inherit the same category activation behavior as main chat.
  // Only the legacy recursive start_task guard remains.
  const isBackgroundOrSubagentMode = executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'background_agent' || executionMode === 'cron' || executionMode === 'team_manager' || executionMode === 'team_subagent';
  const isProposalExecutionMode = executionMode === 'proposal_execution';
  // Tools always stripped from background/subagent runs.
  const alwaysStrip = new Set(isBackgroundOrSubagentMode ? ['start_task'] : []);
  // write_note is a core runtime tool and must stay available in interactive chat.
  // Prompt context and tool docs already instruct the model when to skip it.
  const interactiveStrip = new Set<string>();
	  const effectiveToolFilter = toolFilter;
  let currentModelCapabilities = resolvePrimaryModelCapabilities({
    providerId: providerOverride,
    model: modelOverride,
  });
  const VISION_ONLY_TOOL_NAMES = new Set([
    'browser_vision_screenshot',
    'browser_vision_click',
    'browser_vision_type',
    'analyze_image',
    'analyze_video',
    'video_analyze_frame',
    'video_analyze_imported_video',
  ]);
  const isVisionToolName = (name: string): boolean => VISION_ONLY_TOOL_NAMES.has(name);
  const filterToolsForModelCapabilities = (toolDefs: any[]): any[] => {
    if (currentModelCapabilities.hasVision) return toolDefs;
    return toolDefs.filter((t: any) => !isVisionToolName(String(t?.function?.name || '')));
  };
  const buildCurrentTurnBaseTools = (): any[] => {
	    const allBuiltTools = buildTools(sessionId);
	    return isBootStartupTurn
	      ? allBuiltTools.filter((t: any) => bootAllowedTools.has(String(t?.function?.name || '')))
	      : isHotRestartTurn
	        ? []
	      : effectiveToolFilter && effectiveToolFilter.length > 0
	        ? allBuiltTools.filter((t: any) => {
	            const tName = String(t?.function?.name || '');
	            if (alwaysStrip.has(tName)) return false;
	            if (interactiveStrip.has(tName)) return false;
	            return effectiveToolFilter.some(pattern => {
	              if (pattern.endsWith('*')) return tName.startsWith(pattern.slice(0, -1));
	              return tName === pattern;
	            });
          })
        : isTelegramSessionForTools || isBackgroundOrSubagentMode
          ? allBuiltTools.filter((t: any) => !alwaysStrip.has(String(t?.function?.name || '')) && String(t?.function?.name || '') !== 'start_task')
          : allBuiltTools.filter((t: any) => !interactiveStrip.has(String(t?.function?.name || '')));
  };
  const PROPOSAL_CORE_MIN = new Set([
    'run_command',
    'read_file', 'create_file', 'replace_lines', 'insert_after', 'delete_lines', 'find_replace',
    'list_files', 'list_directory', 'mkdir', 'file_stats', 'grep_file', 'grep_files', 'search_files',
    'write_note',
    'memory_search', 'memory_read_record', 'memory_search_project', 'memory_search_timeline', 'memory_get_related', 'memory_graph_snapshot',
    'task_control',
    'declare_plan', 'complete_plan_step', 'step_complete',
    'request_tool_category',
    'business_context_mode',
    'connector_list',
    'switch_model',
    ...(!isPublicDistributionBuild() ? [
      'read_source', 'list_source', 'grep_source', 'source_stats', 'src_stats',
      'read_webui_source', 'list_webui_source', 'grep_webui_source', 'webui_source_stats', 'webui_stats',
      'list_prom', 'prom_file_stats', 'read_prom_file', 'grep_prom',
    ] : []),
  ]);
  const buildCurrentTurnTools = (): any[] => {
    const baseTools = buildCurrentTurnBaseTools();
    let currentTools = isProposalExecutionMode
      ? baseTools.filter((t: any) => {
        const tName = String(t?.function?.name || '');
        if (!tName || tName === 'write_proposal') return false;
        const category = getToolCategory(tName);
        if (category === null) return PROPOSAL_CORE_MIN.has(tName);
        return true; // Category tools are still governed by per-session activation.
      })
      : baseTools;
    return filterToolsForModelCapabilities(currentTools);
  };
  let tools = buildCurrentTurnTools();
  const allToolResults: ToolResult[] = [];
  const finalizeSkillGardenerForTurn = (finalResponse: string): string => {
    const result = recordSkillGardenerTurn({
      workspacePath,
      sessionId,
      executionMode,
      request: message,
      finalResponse,
      toolResults: allToolResults,
    });
    const offer = String(result.offerText || '').trim();
    if (!offer || String(finalResponse || '').includes(offer)) return finalResponse;
    return `${String(finalResponse || '').trim()}\n\n${offer}`;
  };
  let allThinking = '';
  let preflightRoute: 'primary_direct' | 'primary_with_plan' | 'secondary_chat' | 'background_task' | null = null;
  let preflightReasonForTurn = '';
  let continuationNudges = 0;
  const MAX_CONTINUATION_NUDGES = 4;
  let planFinalizationGuard = 0;
  const MAX_PLAN_FINALIZATION_GUARD = 4;
  let writeNoteFinalizationGuard = 0;
  const MAX_WRITE_NOTE_FINALIZATION_GUARD = 1;
  const orchestrationSkillEnabled = isOrchestrationSkillEnabled();
  const greetingLikeTurn = isGreetingLikeMessage(message);
  const progressState: {
    source: 'none' | 'preflight' | 'tool_sequence' | 'declared';
    items: RuntimeProgressItem[];
    toolsSeen: string[];
    activeIndex: number;
    manualStepAdvance: boolean;
  } = {
    source: 'none',
    items: [],
    toolsSeen: [],
    activeIndex: -1,
    manualStepAdvance: false,
  };

  const emitProgressState = (reason: string) => {
    sendSSE('progress_state', {
      source: progressState.source,
      reason,
      activeIndex: progressState.activeIndex,
      total: progressState.items.length,
      items: progressState.items.map((item, index) => ({
        id: item.id,
        index,
        text: item.text,
        status: item.status,
      })),
    });
  };

  const resolveProviderModelOverride = (): {
    model?: string;
    provider?: any;
    providerId?: string;
    source: 'turn_override' | 'provider_override' | 'model_override' | 'config_default' | 'default';
  } => {
    // Highest priority: turn-scoped override set by switch_model tool.
    const turnOverride = getTurnModelOverride(sessionId);
    if (turnOverride?.providerId && turnOverride?.model) {
      try {
        return {
          model: String(turnOverride.model).trim() || undefined,
          provider: buildProviderById(String(turnOverride.providerId).trim()),
          providerId: String(turnOverride.providerId).trim(),
          source: 'turn_override',
        };
      } catch (err: any) {
        console.warn(`[v2] Failed to apply turn model override provider "${turnOverride.providerId}": ${err.message}`);
      }
    }

    // Next priority: explicit provider override arg (used by some task paths).
    const explicitProviderId = String(providerOverride || '').trim();
    const explicitModel = String(modelOverride || '').trim();
    if (explicitProviderId) {
      try {
        return {
          model: explicitModel || undefined,
          provider: buildProviderById(explicitProviderId),
          providerId: explicitProviderId,
          source: 'provider_override',
        };
      } catch (err: any) {
        console.warn(`[v2] Failed to build explicit provider override "${explicitProviderId}": ${err.message}`);
      }
    }

    // Support modelOverride in "provider/model" format (e.g. "anthropic/claude-haiku-4-5-20251001")
    // without mutating global config.
    if (explicitModel.includes('/')) {
      const parsed = parseProviderModelRef(explicitModel);
      if (parsed) {
        try {
          return {
            model: parsed.model,
            provider: buildProviderById(parsed.providerId),
            providerId: parsed.providerId,
            source: 'model_override',
          };
        } catch (err: any) {
          console.warn(`[v2] Failed to build provider from model override "${parsed.providerId}": ${err.message}`);
        }
      }
    }

    // Config defaults by execution mode (when no explicit/turn override is active).
    // This keeps per-mode model routing autonomous and stateless for each API call.
    const cfg = getConfig().getConfig() as any;
    const defaults = cfg?.agent_model_defaults || {};
    const modeKeys = executionMode === 'interactive'
      ? ['main_chat']
      : executionMode === 'background_agent'
        ? ['background_agent', 'background_task']
        : executionMode === 'team_manager'
          ? ['team_manager', 'manager']
          : executionMode === 'team_subagent'
            ? ['team_subagent', 'subagent']
            : (executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'cron')
              ? ['background_task']
              : [];
    let modeKey = '';
    let modeRef = '';
    for (const key of modeKeys) {
      const ref = String(defaults?.[key] || '').trim();
      if (!ref) continue;
      modeKey = key;
      modeRef = ref;
      break;
    }
    if (modeRef) {
      const parsed = parseProviderModelRef(modeRef);
      if (parsed) {
        try {
          return {
            model: parsed.model,
            provider: buildProviderById(parsed.providerId),
            providerId: parsed.providerId,
            source: 'config_default',
          };
        } catch (err: any) {
          console.warn(`[v2] Failed to build provider from ${modeKey} default "${parsed.providerId}": ${err.message}`);
        }
      } else {
        return { model: modeRef, source: 'config_default' };
      }
    }

    return { model: explicitModel || undefined, source: 'default' };
  };

  let currentModelSystemBlock = '';
  const formatCurrentModelSystemBlock = (generationOverride: ReturnType<typeof resolveProviderModelOverride>): string => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(generationOverride.providerId || providerOverride || activeProvider || '').trim() || 'configured primary provider';
    const providerCfgModel = activeProvider ? String(cfg?.llm?.providers?.[activeProvider]?.model || '').trim() : '';
    const model = String(generationOverride.model || modelOverride || providerCfgModel || getPrimaryModel() || '').trim() || 'configured primary model';
    return [
      '[CURRENT_MODEL]',
      `provider=${providerId}`,
      `model=${model}`,
      `source=${generationOverride.source}`,
      `execution_mode=${executionMode || 'interactive'}`,
    ].join('\n');
  };
  const resolveCapabilitiesForGenerationOverride = (
    generationOverride: ReturnType<typeof resolveProviderModelOverride>,
  ): ModelCapabilities => {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = String(cfg?.llm?.provider || '').trim();
    const providerId = String(generationOverride.providerId || providerOverride || activeProvider || '').trim();
    const providerCfgModel = providerId ? String(cfg?.llm?.providers?.[providerId]?.model || '').trim() : '';
    const model = String(generationOverride.model || modelOverride || providerCfgModel || getPrimaryModel() || '').trim();
    return resolvePrimaryModelCapabilities({ providerId, model });
  };
  currentModelCapabilities = resolveCapabilitiesForGenerationOverride(resolveProviderModelOverride());
  tools = buildCurrentTurnTools();
  const buildModelCapabilitySystemBlock = (): string => {
    const provider = currentModelCapabilities.provider || 'unknown';
    const model = currentModelCapabilities.model || 'unknown';
    if (currentModelCapabilities.hasVision) {
      return `[MODEL_CAPABILITIES]\nprovider=${provider}\nmodel=${model}\nvision=true\nsource=${currentModelCapabilities.source}`;
    }
    return [
      '[MODEL_CAPABILITIES]',
      `provider=${provider}`,
      `model=${model}`,
      'vision=false',
      `source=${currentModelCapabilities.source}`,
      'Non-vision runtime rule: do not request, emit, or rely on image payloads, browser vision screenshots, image/video analysis tools, or visual frame injection. Continue with text-first evidence: browser_snapshot, browser_get_page_text, DOM/accessibility data, OCR/window text from desktop screenshots, metadata, layout inventories, and direct file/tool outputs. If the user asks for image interpretation, explain the limitation briefly and continue with the best non-vision path.',
    ].join('\n');
  };

  const seedProgressFromLines = (
    lines: string[],
    source: 'preflight' | 'tool_sequence' | 'declared',
    opts?: { manualStepAdvance?: boolean },
  ): boolean => {
    const items = buildProgressItems(lines);
    if (items.length < 2) return false;
    progressState.source = source;
    progressState.items = items;
    progressState.activeIndex = -1;
    progressState.manualStepAdvance = opts?.manualStepAdvance === true;
    emitProgressState('plan_created');
    return true;
  };

  // ── Progress step cursor ───────────────────────────────────────────────────────────
  // stepCursor: the index of the step currently being worked on.
  // It advances by 1 each time a "meaningful" tool call succeeds.
  // Read-only tools (list_files, read_file, web_search, browser_snapshot)
  // do NOT advance the cursor — they are information-gathering within the same step.
  // Write/action tools DO advance the cursor because they represent completing a unit of work.
  let stepCursor = 0;
  // Declared-plan skill scout gate:
  // Step 1 should run a quick skill scan (skill_list, optional skill_read) before other actions.
  let manualPlanSkillScoutRequired = false;
  let manualPlanSkillScoutCompleted = false;
  let manualPlanSkillListDone = false;
  let manualPlanSkillReadCount = 0;
  const declaredPlanSkillScoutBlockMessage = (attemptedTool?: string): string => {
    const blockedLine = attemptedTool
      ? `Blocked: declared-plan skill scout pre-step is incomplete, so "${attemptedTool}" cannot run yet.`
      : 'Blocked: declared-plan skill scout pre-step is incomplete.';
    return [
      blockedLine,
      'Required next tool call: skill_list({}).',
      'After skill_list succeeds, optionally call skill_read({"id":"<relevant-skill-id>"}) if a relevant skill appears.',
      'Then call complete_plan_step({"note":"Skill scout complete"}).',
      'This closes only the hidden scout pre-step; declared plan step 1 has not started or advanced.',
    ].join('\n');
  };
  // consecutiveFailures: how many times the current step has failed in a row.
  // Resets on any success. Used to stay on the step during retries.
  let consecutiveStepFailures = 0;

  // Tools that gather information — do NOT advance the step cursor.
  const READ_ONLY_PROGRESS_TOOLS = new Set([
    'list_files', 'list_directory', 'read_file', 'web_search', 'web_fetch',
    'browser_snapshot', 'browser_get_page_text', 'browser_get_focused_item',
    'memory_browse', 'memory_read', 'memory_search', 'memory_read_record', 'memory_search_project', 'memory_search_timeline', 'memory_get_related', 'memory_graph_snapshot',
    'skill_list',
  ]);

  // Keep legacy round-stats for the checklist-guard and continuation-nudge logic
  let progressRoundToolCalls = 0;
  let progressRoundHadSuccess = false;
  let progressRoundHadFailure = false;

  const resetProgressRoundStats = (): void => {
    progressRoundToolCalls = 0;
    progressRoundHadSuccess = false;
    progressRoundHadFailure = false;
  };

  const ensureProgressPlanFromObservedTools = (): void => {
    if (progressState.items.length > 0 || progressState.toolsSeen.length < 2) return;
    const observedTools = progressState.toolsSeen.map((t) => String(t || '').trim()).filter(Boolean);
    if (observedTools.length < 2) return;
    const base = observedTools.slice(0, 4).map((tool) => `Run ${prettifyToolName(tool)}`);
    if (base.length >= 2) {
      seedProgressFromLines(base, 'tool_sequence', { manualStepAdvance: false });
    }
  };

  const advanceProgressStep = (reason: string): void => {
    if (progressState.items.length < 2) return;
    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;
    if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
      cursorStep.status = 'done';
    }
    const nextIdx = stepCursor + 1;
    if (nextIdx < progressState.items.length) {
      stepCursor = nextIdx;
      progressState.activeIndex = nextIdx;
      if (progressState.items[nextIdx].status === 'pending') {
        progressState.items[nextIdx].status = 'in_progress';
      }
    } else {
      stepCursor = nextIdx;
      progressState.activeIndex = -1;
    }
    emitProgressState(reason);
  };

  const markProgressStepStart = (toolName: string): void => {
    const cleanTool = String(toolName || '').trim();
    if (cleanTool) progressState.toolsSeen.push(cleanTool);
    ensureProgressPlanFromObservedTools();
    if (progressState.items.length < 2) return;

    // Activate the step at the current cursor position if it's still pending.
    const cursorStep = progressState.items[stepCursor];
    if (cursorStep && cursorStep.status === 'pending') {
      cursorStep.status = 'in_progress';
      progressState.activeIndex = stepCursor;
      emitProgressState('step_started');
    } else if (!cursorStep) {
      // Cursor past end — append a dynamic step for unexpected extra tool calls
      const text = `Run ${prettifyToolName(cleanTool || 'tool')}`;
      progressState.items.push({ id: `p${progressState.items.length + 1}`, text, status: 'in_progress' });
      stepCursor = progressState.items.length - 1;
      progressState.activeIndex = stepCursor;
      emitProgressState('step_started');
    }
    // If already in_progress at cursor, stay there
  };

  const markProgressStepResult = (ok: boolean, toolName?: string): void => {
    if (progressState.items.length < 2) return;
    progressRoundToolCalls++;
    if (ok) {
      progressRoundHadSuccess = true;
      consecutiveStepFailures = 0;
    } else {
      progressRoundHadFailure = true;
      consecutiveStepFailures++;
    }

    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;

    const toolIsReadOnly = READ_ONLY_PROGRESS_TOOLS.has(String(toolName || '').trim());
    const tName = String(toolName || 'tool');

    if (!ok) {
      // Failure: mark in_progress (retrying), do not advance
      if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_retrying');
      }
      console.log(`[Progress] ${tName} FAILED → step ${stepCursor + 1} retrying ("${cursorStep.text}")`);
      return;
    }

    if (toolIsReadOnly) {
      // Read-only success: stay on this step (gathering info), don't advance
      if (cursorStep.status === 'pending') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_started');
      }
      console.log(`[Progress] ${tName} OK (read-only) → step ${stepCursor + 1} still in_progress ("${cursorStep.text}")`);
      return;
    }

    if (progressState.manualStepAdvance) {
      // Declared plans are manually advanced via complete_plan_step/step_complete.
      if (cursorStep.status === 'pending') {
        cursorStep.status = 'in_progress';
      }
      progressState.activeIndex = stepCursor;
      emitProgressState('step_progress');
      console.log(`[Progress] ${tName} OK (manual-plan) → step ${stepCursor + 1} remains in_progress ("${cursorStep.text}")`);
      return;
    }

    // Action tool succeeded: mark current step done and advance cursor
    cursorStep.status = 'done';
    const nextIdx = stepCursor + 1;
    console.log(`[Progress] ${tName} OK (action) → step ${stepCursor + 1} DONE ("${cursorStep.text}")${nextIdx < progressState.items.length ? ` → next: "${progressState.items[nextIdx].text}"` : ' → all steps done'}`);
    if (nextIdx < progressState.items.length) {
      stepCursor = nextIdx;
      progressState.activeIndex = nextIdx;
      // Activate the next step immediately so UI shows it as in_progress
      if (progressState.items[nextIdx].status === 'pending') {
        progressState.items[nextIdx].status = 'in_progress';
      }
      emitProgressState('step_done');
    } else {
      // All declared steps complete
      stepCursor = nextIdx; // past end, any new tools will append
      progressState.activeIndex = -1;
      emitProgressState('step_done');
    }
  };

  // finalizeProgressRound: only used as a safety net at end of each LLM batch.
  // The real step advancement now happens per-tool in markProgressStepResult.
  const finalizeProgressRound = (): void => {
    // If we still have an in_progress step but the round had only failures,
    // make sure it stays visually in_progress for the next round.
    if (progressState.items.length < 2 || progressRoundToolCalls === 0) return;
    const cursorStep = progressState.items[stepCursor];
    if (!cursorStep) return;
    if (progressRoundHadFailure && !progressRoundHadSuccess) {
      if (cursorStep.status !== 'done' && cursorStep.status !== 'skipped') {
        cursorStep.status = 'in_progress';
        progressState.activeIndex = stepCursor;
        emitProgressState('step_retrying');
      }
    }
  };

  const getProgressRemaining = (): number => (
    progressState.items.filter((item) => item.status === 'pending' || item.status === 'in_progress').length
  );
  emitProgressState('reset');

  // ── Preempt watchdog setup ─────────────────────────────────────────────────
  const rawCfgForPreempt = (getConfig().getConfig() as any);
  const primaryProvider = rawCfgForPreempt.llm?.provider || 'ollama';
  // ── Local LLM primary detection (v2.0 local model layer) ──────────────────
  // True when the configured primary is Ollama, LM Studio, or llama.cpp.
  // Gates the local_llm prompt path and the switch_model full-prompt promotion.
  // Cloud-primary sessions are completely unaffected — this flag is false for them.
  const isLocalPrimary = ['ollama', 'llama_cpp', 'lm_studio'].includes(
    String(primaryProvider || '').trim().toLowerCase(),
  );
  const preemptCfg: {
    enabled: boolean;
    stallThresholdMs: number;
    maxPerTurn: number;
    maxPerSession: number;
    restartMode: 'inherit_console' | 'detached_hidden';
  } = (() => {
    const oc = rawCfgForPreempt.orchestration;
    const preemptRaw = {
      ...(oc?.preempt || {}),
      restart_mode: oc?.preempt?.restart_mode
        || process.env.PROMETHEUS_OLLAMA_RESTART_MODE
        || (process.platform === 'win32' ? 'inherit_console' : 'detached_hidden'),
    };
    const normalizedPreempt = clampPreemptConfig(preemptRaw);
    return {
      enabled: orchestrationSkillEnabled
        && primaryProvider === 'ollama'
        && normalizedPreempt.enabled,
      stallThresholdMs: normalizedPreempt.stall_threshold_seconds * 1000,
      maxPerTurn: normalizedPreempt.max_preempts_per_turn,
      maxPerSession: normalizedPreempt.max_preempts_per_session,
      restartMode: normalizedPreempt.restart_mode === 'detached_hidden'
        ? 'detached_hidden'
        : 'inherit_console',
    };
  })();
  const preemptState = new PreemptState();
  preemptState.preemptsThisSession = getPreemptSessionCount(sessionId);
  const ollamaEndpoint = rawCfgForPreempt.llm?.providers?.ollama?.endpoint
    || rawCfgForPreempt.ollama?.endpoint
    || 'http://localhost:11434';
  const ollamaProcMgr = preemptCfg.enabled
    ? new OllamaProcessManager({ endpoint: ollamaEndpoint, restartMode: preemptCfg.restartMode })
    : null;
  let browserContinuationPending = false;
  let browserAdvisorRoute: 'answer_now' | 'continue_browser' | 'collect_more' | 'handoff_primary' | 'vision_interact' | null = null;
  let browserAdvisorHintPreview = '';
  let browserForcedRetries = 0;
  let browserAdvisorCallsThisTurn = 0;
  // Scroll-before-act gate: tracks whether a fill/click has happened yet this turn.
  // Blocks PageDown/scroll calls on interactive pages until the model actually acts.
  let browserFillOrClickDoneThisTurn = false;
  let browserScrollBeforeActCount = 0;
  const SCROLL_BEFORE_ACT_MAX = 1; // allow at most 1 scroll before a fill/click
  let desktopContinuationPending = false;
  let desktopAdvisorRoute: 'answer_now' | 'continue_desktop' | 'handoff_primary' | null = null;
  let desktopAdvisorHintPreview = '';
  let desktopAdvisorCallsThisTurn = 0;
  let browserAdvisorLastHash = '';
  let browserAdvisorUrlKey = '';
  let consecutiveUnchangedSnapshots = 0;
  let browserAdvisorBatch = 0;
  let browserAdvisorDedupeCount = 0;
  let browserNoFeedProgressStreak = 0;
  let browserStabilizeUrlKey = '';
  let browserStabilizeWaitRetries = 0;
  let browserStabilizeTabProbes = 0;
  let browserStabilizeExhausted = false;
  // Vision fallback state — set when stabilization is exhausted and DOM element count is still < 10.
  // Cleared when a subsequent snapshot recovers to > 10 elements.
  let browserVisionModeActive = false;
  const browserAdvisorCollectedFeed: Array<Record<string, any>> = [];
  const browserAdvisorSeenFeedKeys = new Set<string>();
  const orchRuntimeCfg = getOrchestrationConfig();
  const fileOpSettings = resolveFileOpSettings(orchRuntimeCfg as any);
  const fileOpRouterEnabled =
    orchestrationSkillEnabled
    && (orchRuntimeCfg?.enabled ?? false)
    && fileOpSettings.enabled
    && !isBootStartupTurn;
  const localFileOpClassification = fileOpRouterEnabled
    ? classifyFileOpType(message)
    : { type: 'CHAT' as FileOpType, reason: 'file-op v2 disabled' };
  let fileOpClassification = localFileOpClassification;
  if (fileOpRouterEnabled) {
    const secondaryClass = await callSecondaryFileOpClassifier({
      userMessage: message,
      recentHistory: history.slice(-4).map(h => ({ role: h.role, content: h.content })),
    });
    if (secondaryClass) {
      fileOpClassification = {
        type: secondaryClass.operation as FileOpType,
        reason: `secondary classifier: ${secondaryClass.reason || 'runtime classification'} (confidence ${secondaryClass.confidence.toFixed(2)})`,
      };
      sendSSE('orchestration', {
        trigger: 'file_op_classifier',
        mode: 'router',
        route: secondaryClass.operation === 'BROWSER_OP'
          ? 'browser_ops'
          : secondaryClass.operation === 'DESKTOP_OP'
            ? 'desktop_ops'
            : (secondaryClass.operation === 'CHAT' ? 'chat' : 'file_ops'),
        reason: secondaryClass.reason || 'secondary runtime classification',
        operation: secondaryClass.operation,
        confidence: secondaryClass.confidence,
      });
    } else {
      // Secondary classifier unavailable — degrade to local classifier rather than
      // collapsing to CHAT. Falling back to CHAT silently strips all file-op gating
      // and verification, letting unchecked primary writes bypass all thresholds.
      // Local classification is conservative (FILE_EDIT/FILE_CREATE) and safer.
      sendSSE('info', {
        message: `FILE_OP router: secondary classifier unavailable; degrading to local classification (${localFileOpClassification.type}).`,
      });
      fileOpClassification = {
        type: localFileOpClassification.type,
        reason: `secondary classifier unavailable — local fallback: ${localFileOpClassification.reason}`,
      };
    }
  }
  // User preference: no automatic browser retries/snapshots.
  // Let the model explicitly decide when to call browser_snapshot.
  const browserAutoSnapshotRetriesEnabled = false;
  const browserMaxForcedRetries = browserAutoSnapshotRetriesEnabled
    ? (orchRuntimeCfg?.browser?.max_forced_retries ?? 2)
    : 0;
  const browserMaxAdvisorCallsPerTurn = orchRuntimeCfg?.browser?.max_advisor_calls_per_turn ?? 5;
  const desktopMaxAdvisorCallsPerTurn = 4;
  const browserMaxCollectedItems = orchRuntimeCfg?.browser?.max_collected_items ?? 80;
  const browserMinFeedItemsBeforeAnswer = orchRuntimeCfg?.browser?.min_feed_items_before_answer ?? 12;
  const browserStabilizeMaxWaitRetries = browserAutoSnapshotRetriesEnabled ? 2 : 0;
  const browserStabilizeMaxTabProbes = browserAutoSnapshotRetriesEnabled ? 2 : 0;
  const browserPacketMaxItems = Math.max(12, Math.min(60, Math.min(browserMaxCollectedItems, 40)));
  // Tracks how many times each exact tool+args combo has been called this session.
  // Tools are only skipped once they hit DUPLICATE_SKIP_THRESHOLD identical calls.
  // desktop_* and browser_* tools are always exempt — the screen/page changes each call.
  const DUPLICATE_SKIP_THRESHOLD = 5;
  const seenToolCalls = new Map<string, number>();
  const cachedReadOnlyToolResults = new Map<string, ToolResult>();
  // Only list_files is safe to replay from cache — read_file must always re-execute
  // because a write tool (replace_lines, edit, write_file, etc.) may have changed
  // the file between the first read and the verification read.
  const canReplayReadOnlyCall = (toolName: string): boolean =>
    toolName === 'list_files';

  // Write tools that should invalidate any cached read_file results for the same file
  const WRITE_TOOL_NAMES = new Set([
    'replace_lines', 'edit', 'find_replace', 'write_file', 'create_file',
    'apply_patch', 'append_file', 'delete_file', 'move_file',
  ]);

  const invalidateReadCacheForFile = (filename: string): void => {
    if (!filename) return;
    const base = filename.replace(/\\/g, '/');
    for (const key of cachedReadOnlyToolResults.keys()) {
      // key format: "read_file:{\"filename\":\"...\"}" — invalidate if filename matches
      if (key.includes(base)) cachedReadOnlyToolResults.delete(key);
    }
    // Also remove from seenToolCalls so a re-read executes fresh rather than being skipped
    for (const key of seenToolCalls.keys()) {
      if (key.startsWith('read_file:') && key.includes(base)) seenToolCalls.delete(key);
    }
  };
  const loopDetectionEnabled = orchRuntimeCfg?.triggers?.loop_detection !== false;
  const loopWarningThreshold = 3;
  const loopCriticalThreshold = 5;
  const loopWarnNudged = new Set<string>();
  const loopBlockNudged = new Set<string>();
  const recentToolCalls: Array<{ name: string; argsHash: string }> = [];
  const hashArgs = (args: any): string => {
    try {
      const normalize = (v: any): any => {
        if (Array.isArray(v)) return v.map(normalize);
        if (v && typeof v === 'object') {
          const out: Record<string, any> = {};
          for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
          return out;
        }
        return v;
      };
      return JSON.stringify(normalize(args || {})).slice(0, 200);
    } catch {
      return String(args || '').slice(0, 200);
    }
  };
  const checkLoopDetection = (toolName: string, args: any): { state: 'ok' | 'warn' | 'block'; repeats: number } => {
    if (!loopDetectionEnabled) return { state: 'ok', repeats: 1 };
    const argsHash = hashArgs(args);
    // Count includes this current attempt so thresholds are exact:
    // warning at 3rd identical call, block at 5th.
    const repeats = recentToolCalls.filter((t) => t.name === toolName && t.argsHash === argsHash).length + 1;
    recentToolCalls.push({ name: toolName, argsHash });
    if (recentToolCalls.length > 20) recentToolCalls.shift();
    if (repeats >= loopCriticalThreshold) return { state: 'block', repeats };
    if (repeats >= loopWarningThreshold) return { state: 'warn', repeats };
    return { state: 'ok', repeats };
  };
  const orchestrationState = new OrchestrationTriggerState();
  const orchestrationLog: string[] = [];
  const orchestrationStats = getOrchestrationSessionStats(sessionId);
  // Cached once per turn — used by browser interception, preempt nudge, and advisor calls
  const multiAgentActive = orchestrationSkillEnabled && ((getOrchestrationConfig()?.enabled) ?? false);
  const fileOpV2Active = multiAgentActive
    && fileOpSettings.enabled
    && (fileOpClassification.type === 'FILE_ANALYSIS' || fileOpClassification.type === 'FILE_CREATE' || fileOpClassification.type === 'FILE_EDIT');
  const fileOpType = fileOpClassification.type;
  let fileOpOwner: 'primary' | 'secondary' = fileOpType === 'FILE_ANALYSIS' ? 'secondary' : 'primary';
  const fileOpTouchedFiles = new Set<string>();
  const fileOpToolHistory: Array<{
    tool: string;
    args: any;
    result: string;
    error: boolean;
    actor: 'primary' | 'secondary';
    estimate_lines: number;
    estimate_chars: number;
  }> = [];
  let fileOpPrimaryWriteLines = 0;
  let fileOpPrimaryWriteChars = 0;
  let fileOpHadCreate = false;
  let fileOpHadToolFailure = false;
  let fileOpPrimaryStallPromoted = false;
  let fileOpLastFailureSignature = '';
  const fileOpPatchSignatures: string[] = [];
  const fileOpWatchdog = new FileOpProgressWatchdog(fileOpSettings.watchdog_no_progress_cycles);
  const resumedFileOpCheckpoint = (fileOpV2Active && fileOpSettings.checkpointing_enabled)
    ? loadFileOpCheckpoint(sessionId)
    : null;
  if (
    resumedFileOpCheckpoint
    && resumedFileOpCheckpoint.goal === message
    && resumedFileOpCheckpoint.phase !== 'done'
  ) {
    fileOpOwner = resumedFileOpCheckpoint.owner || fileOpOwner;
    for (const f of resumedFileOpCheckpoint.files_changed || []) {
      if (f) fileOpTouchedFiles.add(String(f));
    }
    for (const sig of resumedFileOpCheckpoint.patch_history_signatures || []) {
      if (sig) fileOpPatchSignatures.push(String(sig));
    }
    if (fileOpPatchSignatures.length > 20) {
      fileOpPatchSignatures.splice(0, fileOpPatchSignatures.length - 20);
    }
  }
  // Synthetic tool calls queued by the browser advisor for deterministic next steps.
  // When set, the main loop skips LLM generation and executes these directly.
  let pendingSyntheticToolCalls: Array<{ function: { name: string; arguments: any } }> = [];

  const trackFileOpMutation = (toolName: string, toolArgs: any, toolResult: ToolResult, actor: 'primary' | 'secondary') => {
    if (!isFileMutationTool(toolName)) return;
    const estimate = estimateFileToolChange(toolName, toolArgs);
    const target = extractFileToolTarget(toolName, toolArgs);
    if (target) fileOpTouchedFiles.add(target);
    if (actor === 'primary') {
      fileOpPrimaryWriteLines += estimate.lines_changed;
      fileOpPrimaryWriteChars += estimate.chars_changed;
    }
    if (isFileCreateTool(toolName) && !toolResult.error) fileOpHadCreate = true;
    if (toolResult.error) fileOpHadToolFailure = true;
    fileOpToolHistory.push({
      tool: toolName,
      args: toolArgs,
      result: toolResult.result,
      error: toolResult.error,
      actor,
      estimate_lines: estimate.lines_changed,
      estimate_chars: estimate.chars_changed,
    });
    if (fileOpToolHistory.length > 64) fileOpToolHistory.shift();
    maybeSaveFileOpCheckpoint({
      phase: 'execute',
      next_action: `${actor} applied ${toolName}`,
    });
  };

  const maybeSaveFileOpCheckpoint = (patch: {
    phase: 'plan' | 'execute' | 'verify' | 'repair' | 'done';
    next_action: string;
    findings?: any[];
  }) => {
    if (!fileOpV2Active || !fileOpSettings.checkpointing_enabled) return;
    saveFileOpCheckpoint(sessionId, {
      goal: message,
      phase: patch.phase,
      owner: fileOpOwner,
      operation: fileOpType,
      files_changed: Array.from(fileOpTouchedFiles).slice(0, 24),
      last_verifier_findings: Array.isArray(patch.findings) ? patch.findings : [],
      patch_history_signatures: fileOpPatchSignatures.slice(-12),
      next_action: patch.next_action,
    });
  };

  const executeSecondaryPatchCalls = async (
    calls: Array<{ tool: string; args: any }>,
    reason: string,
  ): Promise<{ ran: number; patchSignature: string }> => {
    const planCalls = (calls || []).filter(c => c && c.tool && typeof c.args === 'object');
    if (!planCalls.length) return { ran: 0, patchSignature: '' };
    const patchSignature = buildPatchSignature(planCalls.map(c => ({ tool: c.tool, args: c.args })));
    fileOpPatchSignatures.push(patchSignature);
    if (fileOpPatchSignatures.length > 20) fileOpPatchSignatures.shift();
    sendSSE('info', { message: `FILE_OP v2: applying ${planCalls.length} secondary patch call(s) (${reason}).` });
    let ran = 0;
    for (const call of planCalls) {
      const toolName = String(call.tool || '').trim();
      const toolArgs = call.args || {};
      markProgressStepStart(toolName);
      sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1, synthetic: true, actor: 'secondary' });
      const toolResult = await executeTool(toolName, toolArgs, workspacePath, buildExecuteToolDeps(), sessionId);
      allToolResults.push(toolResult);
      logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
      trackFileOpMutation(toolName, toolArgs, toolResult, 'secondary');
      if (toolResult.error) fileOpHadToolFailure = true;
      markProgressStepResult(!toolResult.error, toolName);
      sendSSE('tool_result', { action: toolName, result: toolResult.result.slice(0, 500), error: toolResult.error, stepNum: allToolResults.length, synthetic: true, actor: 'secondary' });
      const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
      const isBrowserTool = isBrowserToolName(toolName);
      const isDesktopTool = isDesktopToolName(toolName);
      // Visual screenshot tools deliver a post-action screenshot via the advisor packet.
      // Route through buildDesktopScreenshotContent so vision primaries get the PNG image.
      const isDesktopVisualTool1 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
      const toolMessageContent = (isBrowserTool && multiAgentActive)
        ? buildBrowserAck(toolName, toolResult) + goalReminder
        : (isDesktopTool && isDesktopVisualTool1)
          ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
          : (isDesktopTool)
            ? buildDesktopAck(toolName, toolResult) + goalReminder
            : toolResult.result + goalReminder;
      messages.push({ role: 'tool', tool_name: toolName, content: toolMessageContent });
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      orchestrationLog.push(
        toolResult.error
          ? `✗ [secondary_patch] ${toolName}: ${toolResult.result.slice(0, 100)}`
          : `✓ [secondary_patch] ${toolName}: ${toolResult.result.slice(0, 80)}`,
      );
      ran++;
    }
    return { ran, patchSignature };
  };

  if (fileOpV2Active) {
    sendSSE('info', {
      message: `FILE_OP v2 active: ${fileOpType} (${fileOpClassification.reason}).`,
    });
    sendSSE('orchestration', {
      trigger: 'file_op_router',
      mode: 'router',
      route: 'file_ops',
      reason: `${fileOpType} (${fileOpClassification.reason})`,
      file_op_type: fileOpType,
      owner: fileOpOwner,
    });
    if (resumedFileOpCheckpoint && resumedFileOpCheckpoint.goal === message && resumedFileOpCheckpoint.phase !== 'done') {
      sendSSE('info', {
        message: `FILE_OP v2: resuming checkpoint at phase="${resumedFileOpCheckpoint.phase}" next="${resumedFileOpCheckpoint.next_action || 'n/a'}".`,
      });
    } else {
      maybeSaveFileOpCheckpoint({
        phase: 'plan',
        next_action: fileOpType === 'FILE_ANALYSIS' ? 'secondary analysis' : 'primary execution',
      });
    }
  }

  const teachModeActive = /\[TEACH_SESSION\]/i.test(String(callerContext || ''));
  const personalityCtx = await buildPersonalityContext(
    sessionId,
    workspacePath,
    message,
    executionMode || 'interactive',
    history.length,
    _skillsManager,
    // Component 5: inject browser_vision hint when vision mode is active for this session.
    // browserVisionModeActive is declared higher in handleChat's closure scope.
    browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
    teachModeActive
      ? { profile: 'teach_mode' }
      : (isLocalPrimary ? { profile: 'local_llm' } : undefined),
  );
  let switchModelPersonalityCtx: string | null = null;

  // Inject active browser session state so LLM knows to reuse it instead of re-opening
  const browserInfo = getBrowserSessionInfo(sessionId);
  const browserControlCtx = formatBrowserInteractionContextBlock(sessionId);
  const browserStateCtx = browserInfo.active
    ? `\n\n[BROWSER SESSION ACTIVE: A browser tab is already open.${
        browserInfo.title ? ` Current page: "${browserInfo.title}"` : ''
      }${
        browserInfo.url ? ` at ${browserInfo.url}` : ''
      }. Use browser_snapshot to see current elements, or browser_click to navigate. Do NOT call browser_open unless you need to go to a completely different site.${
        browserInfo.mode ? ` Current browser control mode: ${browserInfo.mode}.` : ''
      }]${browserControlCtx ? `\n${browserControlCtx}` : ''}`
    : '';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const executionModeSystemBlock = (() => {
    if (executionMode === 'background_task') {
      return [
        'EXECUTION MODE: Autonomous background task.',
        'You are running without user oversight. Do not ask clarifying questions.',
        'Make decisions based on available context. Use tools precisely.',
        'If truly blocked: return a concise blocked reason and the best next action.',
      ].join('\n');
    }
    if (executionMode === 'proposal_execution') {
      return [
        'EXECUTION MODE: Approved proposal execution.',
        'Execute the approved proposal scope directly and finish the assigned steps.',
        'Do not ask clarifying questions. Do not create a new proposal in this mode.',
        'If truly blocked: return a concise blocked reason and the best next action.',
      ].join('\n');
    }
    if (executionMode === 'background_agent') {
      return [
        'EXECUTION MODE: Ephemeral background agent.',
        'You are running in parallel with the main chat. Work autonomously and decisively.',
        'Do not ask clarifying questions. Use tools directly and finish the assigned task.',
      ].join('\n');
    }
    if (executionMode === 'heartbeat') {
      return [
        'EXECUTION MODE: Heartbeat check.',
        'Run concise, decisive checks and report only actionable issues.',
      ].join('\n');
    }
    if (executionMode === 'cron') {
      return [
        'EXECUTION MODE: Scheduled cron task.',
        'Act autonomously and complete the prompt without asking follow-up questions.',
        'Follow the scheduled task plan shown in the task panel. Do not create proposals, tasks, or external side effects unless the schedule prompt explicitly instructs you to do so.',
      ].join('\n');
    }
    if (executionMode === 'team_subagent') {
      return [
        'EXECUTION MODE: Team subagent task.',
        'You are Prometheus running locally on the user\'s computer.',
        'You have access to this computer through tools. Use tools directly, verify your work, and do not claim you lack tool access.',
        'Complete the assigned team task. If you need clarification or a decision, ask the team manager with talk_to_manager instead of asking the user.',
      ].join('\n');
    }
    if (executionMode === 'team_manager') {
      return [
        'EXECUTION MODE: Team manager.',
        'You are running a managed team, not the main user chat.',
        'Use the manager context exactly: dispatch only useful subagents, verify their outputs, update team memory, and ask the main Prometheus agent only when team-level context is required.',
        'Use [GOAL_COMPLETE], [NEEDS_INPUT], or [WAITING_MAIN_AGENT] only when those states are genuinely true.',
      ].join('\n');
    }
    return '';
  })();
  const responseStyleInstruction = executionMode === 'heartbeat'
    ? 'Default to concise status output, but provide full detail when HEARTBEAT.md explicitly asks for full reporting.'
    : 'Match the user\'s tone and pacing. Be natural, warm, and conversational. Use concise replies for quick asks, and expand with context, personality, and guidance when helpful or when the user invites depth.';
  const planProtocolInstruction = executionMode === 'background_agent'
    ? 'If this background-agent task has 2+ meaningful phases, call bg_plan_declare FIRST (2-8 short steps). Keep executing within the current step until the phase is actually complete, then call bg_plan_advance(note) to move forward. Do NOT use declare_plan/complete_plan_step in background_agent mode.'
    : executionMode === 'proposal_execution'
      ? 'Proposal execution already has a fixed task plan. Do NOT call declare_plan. Execute steps in order, use tools directly, and call step_complete(note) after each completed step.'
      : 'Unless explicitly told otherwise by the user, do NOT call declare_plan. Default to direct execution. Call declare_plan only when the user explicitly asks for a plan/checklist/step-by-step approach or asks you to outline steps before acting. Do NOT call declare_plan for browser_* or desktop_* actions by default, and do NOT call it for single-phase work, read-only lookups, exploratory tasks, conversational replies, explanations, code generation, or skill-read-then-respond. When a plan is active, declare once, do not re-declare mid-turn, keep each step in_progress until truly complete, then complete_plan_step with concrete evidence, and finish only after all plan steps are complete.';
const creativeRoutingInstruction = 'Creative routing: Creative is a normal main-chat tool category and editor surface, not a separate assistant runtime. Use generate_image for one-shot raster image generation and generate_video for one-shot MP4 generation. Use creative_* and hyperframes_* tools directly for editable canvas, image, video, timeline, animation, HTML Motion, HyperFrames, Remotion, captioned clip, promo video, motion export, or multi-clip workspace work. switch_creative_mode only selects or clears editor workspace state; it must not change the assistant persona, prompt contract, history, or non-creative tool availability. Normal tools such as desktop_*, browser_*, run_command, scheduling, proposals, memory, connectors, and Codex/source tools remain valid while a Creative workspace is open. Creative work must be visual-first: after meaningful edits, call creative_get_state or creative_render_snapshot before deciding the next edit. These tools render actual canvas screenshots/frames and inject them into vision context like browser/desktop screenshots. For video workspace work, prefer HTML Motion / HyperFrames / Remotion / Pretext sources and use creative_list_html_motion_templates, creative_apply_html_motion_template, creative_create_html_motion_clip, creative_read_html_motion_clip, creative_patch_html_motion_clip, creative_list_html_motion_blocks, creative_apply_hyperframes_component, and Pretext text-fit tools when they fit. Before presenting or exporting creative work, run direct visual self-review with creative_render_snapshot; for video, use sampleTimesMs or frame batches when playback inspection matters.';
  const hyperframesAgentRoutingInstruction = 'HyperFrames agent policy: when the user asks to create, compose, import, edit, lint, QA, materialize, or export HyperFrames video, prefer real HyperFrames sources over recreated lookalikes. Prefer first-class hyperframes_* tools when they can create source-backed catalog clips correctly. If a first-class HyperFrames tool fails, lacks catalog access, or cannot prove source-backed output, use run_command with the real local CLI (`npx hyperframes init`, `npx hyperframes add`, `npx hyperframes lint`, `npx hyperframes inspect`, `npx hyperframes render`) from an appropriate workspace directory and report exact CLI errors. Do not substitute hand-authored catalog labels, CSS mockups, or recreated components after the user asked for HyperFrames catalog/registry output. Start with hyperframes_browse_catalog or `npx hyperframes add` discovery, customize with HyperFrames/source-backed edits, then run lint/inspect/QA/export only after visual review. Use creative_list_hyperframes_components, creative_sync_hyperframes_catalog, and creative_apply_hyperframes_component only for low-level compatibility or migration work.';
  const creativeDebuggingInstruction = 'Creative debugging tools: when working in video mode, use video_render_frame, video_render_contact_sheet, video_analyze_frame, video_analyze_timeline, video_check_keyframes, video_check_caption_timing, video_check_audio_sync, video_extract_clip_frames, and video_analyze_imported_video when those names fit the job. Use creative_element_inventory for a complete layer/timeline inventory with text, timing, animation, visibility, provenance, and validation details. Use creative_frame_trace to see which elements are actually active at exact timestamps, with resolved opacity/transform/z-order/source information. Use creative_frame_diff to compare two timestamps and detect what changed, appeared, disappeared, or stayed static. Use creative_history_status, creative_undo, and creative_redo to recover from destructive resets, bad template applications, failed batch edits, or visual regressions; after undo/redo, render or inspect the scene before continuing. For image mode, use image_get_element_at_point, image_get_overlaps, image_get_bounds_summary, image_check_text_overflow, image_check_contrast, and image_detect_empty_regions when diagnosing composition/layout issues. Use creative_export_trace before or after export when you need certainty about the scene hash, render/export job, saved scene, active export, or whether stale/cached output was used. Before risky rebuilds or large experiments, call creative_checkpoint with action "save"; restore a checkpoint if the design gets worse. If a scene is contaminated by duplicated ids, offscreen debris, stale template residue, editor artifacts, hidden layers, or ghost content, call creative_purge_scene first. Only call creative_reset_scene with force=true after a checkpoint/export or when the user explicitly asked for a fresh blank scene. Do not keep patching a corrupted video timeline when purge plus inventory/trace gives a cleaner path.';
  const teachModeSystemBlock = teachModeActive
      ? [
        'TEACH MODE: Workflow teaching and verification.',
        'Your primary objective is to help the user capture, verify, and package a reusable browser workflow.',
        'Treat the recorded Teach steps as the source of truth for the intended flow.',
        'When Teach mode is waiting for verification approval, summarize the workflow, call out risky steps, and ask how far verification should go before running anything.',
        'Once the user approves verification, call browser_teach_verify with the approved boundary before you summarize the replay result.',
        'After verification, explain what actually happened, what adjustments were needed, and what you think the workflow is for.',
        'Ask the user to confirm whether that understanding is correct before proposing packaging.',
        'You may recommend composite, skill, both, or neither after verification, but do NOT create any composite tool or skill unless the user explicitly asks you to.',
      ].join('\n')
    : '';

  const teamRoutingInstruction = [
    'Managed-team routing policy:',
    '- When the user asks main chat to pass a message/question to a managed team, make the intended audience explicit for the coordinator: use [BROADCAST_TO_TEAM] for the whole team, or [ASK_AGENT:<agent id or name>] for a specific member. If the user names no member, default to [BROADCAST_TO_TEAM].',
    '- When replying to a coordinator via reply_to_team, preserve that routing intent in the message instead of collapsing it into a manager-only answer. The reply_to_team tool delivers team/member routes directly to member room turns first, then resumes the manager after those responses settle.',
    '- Do not ask the manager to manually broadcast ordinary reply_to_team messages. Use internal_watch only for explicit background task ids returned by team tools, not for the reply_to_team broadcast path.',
  ].join('\n');

  const buildBaseSystemPrompt = (): string => {
    const visualGroundingPolicy = currentModelCapabilities.hasVision
      ? 'Visual-first policy: for browser/desktop workflows, ground decisions in fresh snapshots/screenshots when state likely changed, the UI is ambiguous, or a risky action just ran. Vision screenshots are the highest-confidence source of current UI truth on dynamic pages. If DOM refs, assumptions, or JS probes conflict with what the page is doing, trust fresh vision/snapshot evidence and re-anchor before acting. Prefer browser_snapshot/browser_vision_screenshot and desktop_screenshot over repeated browser_run_js probing. Use browser_run_js only when visual/snapshot evidence is insufficient for a concrete action.'
      : 'Text-first UI policy: the active model is not vision-capable. For browser/desktop workflows, ground decisions in browser_snapshot, browser_get_page_text, DOM/accessibility data, OCR/window text from desktop screenshots, metadata, and explicit tool outputs. Do not call browser_vision_screenshot, browser_vision_click, browser_vision_type, analyze_image, or analyze_video. Use browser_run_js only when text/snapshot evidence is insufficient for a concrete action.';
    const skillRecoveryInstruction = 'Skill recovery policy: when a skill-guided path fails, recover with another viable approach. If the alternate approach works, offer to update the skill with the corrected steps or guardrail.';
    const creativeRuntimeInstruction = currentModelCapabilities.hasVision
      ? creativeRoutingInstruction
      : 'Creative routing: Creative is a normal main-chat tool category and editor surface, not a separate assistant runtime. Use generate_image for one-shot raster image generation and generate_video for one-shot MP4 generation. Use creative_* and hyperframes_* tools directly for editable canvas, image, video, timeline, animation, HTML Motion, HyperFrames, Remotion, captioned clip, promo video, motion export, or multi-clip workspace work. switch_creative_mode only selects or clears editor workspace state; it must not change the assistant persona, prompt contract, history, or non-creative tool availability. Normal tools such as desktop_*, browser_*, run_command, scheduling, proposals, memory, connectors, and Codex/source tools remain valid while a Creative workspace is open. The active model is not vision-capable, so do not ask for direct visual self-review or image/video frame interpretation. After meaningful edits, use creative_get_state, creative_element_inventory, creative_frame_trace, creative_frame_diff, lint/layout tools, text-fit reports, export traces, and rendered artifact metadata to continue safely. You may still render snapshots or exports as artifacts, but do not rely on image payload injection for reasoning.';
    return `${executionModeSystemBlock ? `${executionModeSystemBlock}\n\n` : ''}${teachModeSystemBlock ? `${teachModeSystemBlock}\n\n` : ''}You are Prom, a local AI assistant running inside Prometheus.\nCurrent date: ${dateStr}, ${timeStr}.\nNever search for or link Prometheus repos unless the user is asking about Prometheus itself.\nThis app runs on the user's own machine - browser/desktop automation requests are pre-authorized.\nExecution policy: default to action, not refusal. When a user asks you to do something, try to complete it directly with available tools and persistent problem-solving. Do not decline for generic capability reasons. If a request is blocked by a real hard constraint (missing auth, unavailable tool, external outage, or physical impossibility), state the exact blocker in one line and immediately continue with the closest viable path that still advances the user goal.\n${buildModelCapabilitySystemBlock()}\n${visualGroundingPolicy}\n${skillRecoveryInstruction}\n${teamRoutingInstruction}\n${hyperframesAgentRoutingInstruction}\n${creativeRuntimeInstruction}\n${creativeDebuggingInstruction}\n${planProtocolInstruction}\n${responseStyleInstruction} Keep internal reasoning private. Be transparent about actions and results, and greet naturally without tools.`;
  };
  const buildSystemPrompt = (mode: 'full' | 'switch_model'): string => {
    const baseSystemPrompt = buildBaseSystemPrompt();
    if (mode === 'switch_model') {
      return `${baseSystemPrompt}${switchModelPersonalityCtx || ''}`;
    }
    if (executionMode === 'team_subagent') {
      // Team subagents inherit the broader Prometheus identity/memory first, then
      // receive their team-local role and task context as the most specific guidance.
      return `${baseSystemPrompt}${currentModelSystemBlock ? '\n\n' + currentModelSystemBlock : ''}${recentToolLog ? '\n\n' + recentToolLog : ''}${personalityCtx}${callerContext ? '\n\n' + callerContext : ''}${browserStateCtx}${(getConfig().getConfig() as any)?.agent_builder?.enabled === true ? '\n\n' + getWorkflowContextBlock() : ''}`;
    }
    const onboardingBlock = isOnboardingSession(sessionId) ? '\n\n' + getMeetAndGreetSystemPrompt() : '';
    return `${baseSystemPrompt}${currentModelSystemBlock ? '\n\n' + currentModelSystemBlock : ''}${recentToolLog ? '\n\n' + recentToolLog : ''}${callerContext ? '\n\n' + callerContext : ''}${browserStateCtx}${personalityCtx}${(getConfig().getConfig() as any)?.agent_builder?.enabled === true ? '\n\n' + getWorkflowContextBlock() : ''}${onboardingBlock}`;
  };
  const messages: any[] = [
    {
      role: 'system',
      content: buildSystemPrompt('full'),
    },
  ];

  if (pinnedMessages && pinnedMessages.length > 0) {
    messages.push({ role: 'user', content: '[PINNED CONTEXT - Important messages from earlier in our conversation:]' });
    for (const pin of pinnedMessages.slice(0, 3)) {
      messages.push({ role: pin.role === 'user' ? 'user' : 'assistant', content: pin.content });
    }
    messages.push({ role: 'assistant', content: 'I have the pinned context. Continuing...' });
  }

  for (const msg of history) {
    messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
  }
  const creativeReferenceVisionMessage = buildCreativeReferenceVisionMessage();
  if (creativeReferenceVisionMessage) {
    messages.push(creativeReferenceVisionMessage);
    sendSSE('vision_injected', { source: 'creative_references', frames: Array.isArray(creativeReferenceVisionMessage.content) ? creativeReferenceVisionMessage.content.length - 1 : 0 });
    sendSSE('info', { message: 'Creative reference frame vision injected for this turn.' });
  }
  if (attachments && attachments.length > 0 && currentModelCapabilities.hasVision) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message },
        ...attachments.map(a => buildVisionImagePart(a.base64, a.mimeType)),
      ],
    });
  } else if (attachments && attachments.length > 0 && !currentModelCapabilities.hasVision) {
    const attachmentNames = attachments
      .map((a) => String(a?.name || a?.mimeType || 'attachment').trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(', ');
    messages.push({
      role: 'user',
      content: `${message}\n\n[ATTACHMENT_NOTICE]\n${attachments.length} image/media attachment(s) were received (${attachmentNames || 'unnamed'}), but the active model is not vision-capable, so raw image payloads were not injected. Continue with filenames, metadata, surrounding text, OCR/tool outputs, or ask for a vision-capable switch only if direct image interpretation is essential.`,
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  // ── Browser observation policy layer ──────────────────────────────────────────────
  type ObserveMode = BrowserObserveMode;
  const BROWSER_OBSERVE_TOOLS = new Set([
    'browser_wait',
    'browser_get_page_text',
    'browser_get_focused_item',
    'browser_click',
    'browser_fill',
    'browser_upload_file',
    'browser_press_key',
    'browser_key',
    'browser_drag',
    'browser_click_and_download',
    'browser_scroll_collect',
    'browser_scroll',
    'browser_open',
    'browser_vision_click',
    'browser_snapshot',
    'browser_snapshot_delta',
    'browser_vision_screenshot',
    'browser_vision_type',
    'browser_send_to_telegram',
    'browser_run_js',
  ]);
  const BROWSER_FORCE_SCREENSHOT_AFTER_TOOLS = new Set([
    'browser_click',
    'browser_fill',
    'browser_upload_file',
    'browser_press_key',
    'browser_drag',
    'browser_scroll',
    'browser_scroll_collect',
  ]);

  const maybeAppendVisionScreenshotForTool = async (
    toolName: string,
    toolResult?: { error?: boolean; data?: any },
    toolInput?: Record<string, any>,
  ): Promise<void> => {
    if (toolName === 'creative_render_snapshot' || toolName === 'creative_get_state' || toolName === 'video_render_frame' || toolName === 'video_render_contact_sheet' || toolName === 'video_analyze_frame' || toolName === 'video_extract_clip_frames') {
      if (toolResult?.error || !currentModelCapabilities.hasVision) return;
      const rawFrames = Array.isArray(toolResult?.data?.snapshots)
        ? toolResult?.data?.snapshots
        : (toolResult?.data?.snapshot ? [toolResult.data.snapshot] : []);
      const frames = rawFrames
        .map((frame: any) => {
          const dataUrl = String(frame?.dataUrl || '').trim();
          const match = dataUrl.match(/^data:([^,]+);base64,(.+)$/);
          if (!match) return null;
          return {
            mimeType: String(match[1] || 'image/png').split(';')[0] || 'image/png',
            base64: match[2] || '',
            width: Number(frame?.width || 0),
            height: Number(frame?.height || 0),
            atMs: frame?.atMs,
          };
        })
        .filter(Boolean);
      if (!frames.length) {
        sendSSE('info', { message: 'Creative frame injection requested, but no image frames were returned.' });
        return;
      }
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `[CREATIVE_DIRECT_FRAME_OBSERVATION]\n` +
              `These are the rendered frame images from the active creative workspace. Use your own visual perception of these frames as direct context for the next step; no separate critic summary has been run.\n` +
              `Frames: ${frames.map((frame: any, index: number) => `#${index + 1} ${frame.width}x${frame.height}${Number.isFinite(Number(frame.atMs)) ? ` @ ${frame.atMs}ms` : ''}`).join(', ')}`,
          },
          ...frames.map((frame: any) => buildVisionImagePart(frame.base64, frame.mimeType)),
        ],
      });
      sendSSE('vision_injected', { source: 'creative', tool: toolName, frames: frames.length });
      sendSSE('info', { message: `Creative rendered frame vision injected (${frames.length} frame${frames.length === 1 ? '' : 's'}).` });
      return;
    }
    // Desktop tools have their own handling
    if (toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot') {
      // Keep existing desktop behavior — always inject on success
      if (toolResult?.error) return;
      const visionMessage = buildVisionScreenshotMessage(sessionId, 'desktop');
      if (visionMessage) {
        messages.push(visionMessage);
        sendSSE('vision_injected', { source: 'desktop', tool: toolName });
        sendSSE('info', { message: `Vision screenshot injected (desktop) after ${toolName}.` });
      }
      return;
    }

    // Browser tool observation policy
    if (!BROWSER_OBSERVE_TOOLS.has(toolName)) return;

    // 1. Determine effective observe mode
    let effectiveMode: ObserveMode = toolResult?.error
      ? 'screenshot'
      : resolveBrowserObserveMode(toolName, toolInput?.observe);

    // 2. Execute the chosen observation mode
    if (effectiveMode === 'none' || effectiveMode === 'compact') return;

    if (effectiveMode === 'delta') {
      // Use lightweight DOM delta instead of full vision
      try {
        const delta = await browserSnapshotDelta(sessionId);
        if (delta) {
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: `[SYSTEM: DOM delta after ${toolName}]\n${delta}` }],
          });
          sendSSE('info', { message: `DOM delta injected (browser) after ${toolName}.` });
        }
      } catch {}
      if (BROWSER_FORCE_SCREENSHOT_AFTER_TOOLS.has(toolName)) {
        try { await browserVisionScreenshot(sessionId); } catch {}
        const visionMessage = buildVisionScreenshotMessage(sessionId, 'browser');
        if (visionMessage) {
          messages.push(visionMessage);
          sendSSE('vision_injected', { source: 'browser', tool: toolName });
          sendSSE('info', { message: `Vision screenshot injected (browser) after ${toolName} (delta+vision mode).` });
        } else {
          sendSSE('info', { message: `Vision screenshot unavailable (browser) after ${toolName} (delta+vision mode).` });
        }
      }
      return;
    }

    if (effectiveMode === 'snapshot') {
      // Snapshot already returns DOM refs — no auto-injection needed
      // EXCEPT for browser_open: also inject screenshot so AI sees both DOM and visual
      if (toolName !== 'browser_open') return;
      effectiveMode = 'screenshot'; // Force screenshot injection for navigation
    }

    if (effectiveMode === 'screenshot') {
      // Full vision screenshot
      try { await browserVisionScreenshot(sessionId); } catch {}
      const visionMessage = buildVisionScreenshotMessage(sessionId, 'browser');
      if (visionMessage) {
        messages.push(visionMessage);
        sendSSE('vision_injected', { source: 'browser', tool: toolName });
        sendSSE('info', { message: `Vision screenshot injected (browser) after ${toolName}.` });
      } else {
        sendSSE('info', { message: `Vision screenshot unavailable (browser) after ${toolName}.` });
      }
    }
  };

  type PreActionObservationContext = {
    browserBefore: BrowserObservationPageState | null;
    desktopBefore: DesktopObservationPacketState | null;
  };

  type AppliedObservationContext = {
    decision: PostActionObservationDecision;
    browserAfterPacket: BrowserAdvisorPacket | null;
    advisorTriggerToolName: string;
    advisorTriggerToolArgs: Record<string, any>;
    advisorTriggerToolResult: ToolResult;
  };

  const isDesktopVisualToolName = (toolName: string): boolean =>
    toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';

  const countRecentToolRepeats = (toolName: string, toolArgs: Record<string, any>): number => {
    const argsHash = hashArgs(toolArgs);
    const loopRepeats = recentToolCalls.filter((t) => t.name === toolName && t.argsHash === argsHash).length;
    const priorRepeats = allToolResults.filter((result) =>
      result.name === toolName && hashArgs(result.args) === argsHash,
    ).length;
    return Math.max(1, loopRepeats, priorRepeats + 1);
  };

  const countRecentToolFailures = (toolName: string, toolArgs: Record<string, any>): number => {
    const argsHash = hashArgs(toolArgs);
    return allToolResults.filter((result) =>
      result.error && result.name === toolName && hashArgs(result.args) === argsHash,
    ).length;
  };

  const captureObservationPreContext = async (
    toolName: string,
    toolArgs: Record<string, any> = {},
  ): Promise<PreActionObservationContext> => {
    let browserBefore: BrowserObservationPageState | null = null;
    let desktopBefore: DesktopObservationPacketState | null = null;

    if (isBrowserToolName(toolName)) {
      const sessionInfo = getBrowserSessionInfo(sessionId);
      const packet = sessionInfo.active
        ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 48 }).catch(() => null)
        : null;
      browserBefore = summarizeBrowserObservationState(packet, sessionInfo.active ? sessionInfo : null);
    }

    if (isDesktopToolName(toolName)) {
      desktopBefore = summarizeDesktopObservationState(getDesktopAdvisorPacket(sessionId));
    }

    return { browserBefore, desktopBefore };
  };

  const buildObservationDecisionForTool = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    preContext: PreActionObservationContext,
  ): Promise<{
    decision: PostActionObservationDecision;
    browserAfterPacket: BrowserAdvisorPacket | null;
  }> => {
    let browserAfterPacket: BrowserAdvisorPacket | null = null;
    let browserAfter: BrowserObservationPageState | null = null;
    let desktopAfter: DesktopObservationPacketState | null = null;
    const isBrowserTool = isBrowserToolName(toolName);
    const isDesktopTool = isDesktopToolName(toolName);
    const requestedBrowserMode = isBrowserTool
      ? resolveBrowserObserveMode(toolName, toolArgs?.observe)
      : undefined;
    const hasObserveOverride = Object.prototype.hasOwnProperty.call(toolArgs || {}, 'observe')
      && toolArgs?.observe !== undefined;

    if (isBrowserTool) {
      const sessionInfo = getBrowserSessionInfo(sessionId);
      browserAfterPacket = sessionInfo.active
        ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 48 }).catch(() => null)
        : null;
      browserAfter = summarizeBrowserObservationState(browserAfterPacket, sessionInfo.active ? sessionInfo : null);
    }

    if (isDesktopTool) {
      desktopAfter = summarizeDesktopObservationState(getDesktopAdvisorPacket(sessionId));
    }

    const decision = decidePostActionObservation({
      toolName,
      args: toolArgs,
      requestedMode: requestedBrowserMode,
      hasObserveOverride,
      error: toolResult.error,
      resultText: toolResult.result,
      recentRepeats: countRecentToolRepeats(toolName, toolArgs),
      recentFailures: countRecentToolFailures(toolName, toolArgs),
      browser: {
        before: preContext.browserBefore,
        after: browserAfter,
      },
      desktop: {
        before: preContext.desktopBefore,
        after: desktopAfter,
      },
    });

    return { decision, browserAfterPacket };
  };

  const appendBrowserDeltaObservation = async (
    toolName: string,
    reason: string,
  ): Promise<void> => {
    try {
      const delta = await browserSnapshotDelta(sessionId);
      if (!delta) return;
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `[SYSTEM: DOM delta after ${toolName}]\n${delta}` }],
      });
      sendSSE('info', { message: `DOM delta injected (browser) after ${toolName}: ${reason}.` });
    } catch {
      // Best-effort only.
    }
  };

  const appendBrowserVisionObservation = async (
    toolName: string,
    reason: string,
    options?: { reuseExisting?: boolean },
  ): Promise<void> => {
    let visionMessage = options?.reuseExisting
      ? buildVisionScreenshotMessage(sessionId, 'browser')
      : null;

    if (!visionMessage) {
      try { await browserVisionScreenshot(sessionId); } catch {}
      visionMessage = buildVisionScreenshotMessage(sessionId, 'browser');
    }

    if (visionMessage) {
      messages.push(visionMessage);
      sendSSE('vision_injected', { source: 'browser', tool: toolName });
      sendSSE('info', { message: `Vision screenshot injected (browser) after ${toolName}: ${reason}.` });
    } else {
      sendSSE('info', { message: `Vision screenshot unavailable (browser) after ${toolName}: ${reason}.` });
    }
  };

  const appendObservationArtifacts = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    decision: PostActionObservationDecision,
  ): Promise<void> => {
    if (toolName === 'creative_render_snapshot' || toolName === 'creative_get_state' || toolName === 'video_render_frame' || toolName === 'video_render_contact_sheet' || toolName === 'video_analyze_frame' || toolName === 'video_extract_clip_frames') {
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      return;
    }
    if (isDesktopVisualToolName(toolName)) {
      await maybeAppendVisionScreenshotForTool(toolName, toolResult, toolArgs);
      return;
    }
    if (!isBrowserToolName(toolName)) return;
    if (decision.mode === 'none' || decision.mode === 'snapshot') return;
    if (decision.mode === 'delta') {
      if (toolName !== 'browser_snapshot_delta') {
        await appendBrowserDeltaObservation(toolName, decision.reason);
      }
      return;
    }
    if (decision.mode === 'screenshot') {
      await appendBrowserVisionObservation(
        toolName,
        decision.reason,
        { reuseExisting: toolName === 'browser_vision_screenshot' },
      );
    }
  };

  const applySharedPostActionObservation = async (
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: ToolResult,
    preContext: PreActionObservationContext,
  ): Promise<AppliedObservationContext> => {
    const { decision, browserAfterPacket } = await buildObservationDecisionForTool(
      toolName,
      toolArgs,
      toolResult,
      preContext,
    );

    let advisorTriggerToolName = toolName;
    let advisorTriggerToolArgs = toolArgs;
    let advisorTriggerToolResult = toolResult;

    await appendObservationArtifacts(toolName, toolArgs, toolResult, decision);

    if (
      isDesktopToolName(toolName)
      && !isDesktopVisualToolName(toolName)
      && decision.mode === 'screenshot'
    ) {
      try {
        await desktopWait(350);
        const autoToolName: 'desktop_screenshot' = 'desktop_screenshot';
        const activeMonitorIndex = await desktopGetActiveMonitorIndex();
        const autoToolArgs = activeMonitorIndex !== null ? { capture: activeMonitorIndex } : {};
        let autoShot = activeMonitorIndex !== null
          ? await desktopScreenshotWithHistory(sessionId, { capture: activeMonitorIndex })
          : await desktopScreenshotWithHistory(sessionId);
        if (String(autoShot).startsWith('ERROR')) {
          autoShot = await desktopScreenshotWithHistory(sessionId);
        }
        const syntheticResult: ToolResult = {
          name: autoToolName,
          args: autoToolArgs,
          result: autoShot,
          error: String(autoShot).startsWith('ERROR'),
        };
        const autoShotContent = buildDesktopScreenshotContent(syntheticResult, sessionId, '');
        messages.push({
          role: 'tool',
          tool_name: autoToolName,
          content: typeof autoShotContent === 'string'
            ? `[Auto-screenshot after ${toolName}: ${decision.reason}]\n${autoShotContent}`
            : autoShotContent,
        });
        await maybeAppendVisionScreenshotForTool(autoToolName, syntheticResult, autoToolArgs);
        sendSSE('tool_result', {
          action: autoToolName,
          result: autoShot.slice(0, 300),
          error: syntheticResult.error,
          stepNum: allToolResults.length,
          synthetic: true,
        });
        if (!syntheticResult.error) {
          advisorTriggerToolName = autoToolName;
          advisorTriggerToolArgs = autoToolArgs;
          advisorTriggerToolResult = syntheticResult;
        }
      } catch {
        // Non-fatal: continue without synthetic screenshot.
      }
    }

    return {
      decision,
      browserAfterPacket,
      advisorTriggerToolName,
      advisorTriggerToolArgs,
      advisorTriggerToolResult,
    };
  };

  const continuationCue = isContinuationCue(message);
  const pendingExecutionFromHistory = continuationCue && hasPendingExecutionIntent(
    history.map((h) => ({ role: h.role, content: h.content })),
  );
  if (pendingExecutionFromHistory) {
    messages.push({
      role: 'assistant',
      content: 'Understood. Continuing execution.',
    });
    messages.push({
      role: 'user',
      content: 'Continue the in-progress task now. Do not restate intent. Call the next required tool immediately.',
    });
  }

  const replaceCurrentUserPromptWithAdvisorObjective = (objective: string): boolean => {
    const objectiveText = String(objective || '').trim();
    if (!objectiveText) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role !== 'user') continue;
      if (String(msg?.content || '') !== message) continue;
      messages.splice(i, 1);
      break;
    }
    messages.push({ role: 'user', content: objectiveText });
    messages.push({
      role: 'assistant',
      content: 'Understood. I will execute this objective and preserve literal values from the request.',
    });
    return true;
  };

  const buildSecondaryAssistContext = () => {
    const availableTools = (tools || [])
      .map((t: any) => String(t?.function?.name || '').trim())
      .filter(Boolean);

    const recentToolExecutions = allToolResults.slice(-24).map((tr, idx, arr) => {
      const step = allToolResults.length - arr.length + idx + 1;
      return {
        step,
        name: String(tr.name || '').slice(0, 80),
        args: tr.args ?? {},
        result: String(tr.result || '').slice(0, 6000),
        error: tr.error === true,
      };
    });

    const recentModelMessages = (messages || [])
      .slice(-60)
      .map((m: any) => {
        const role = String(m?.role || '').trim();
        if (!role || !['user', 'assistant', 'tool'].includes(role)) return null;

        let content = String(m?.content || '');
        if (role === 'assistant' && Array.isArray(m?.tool_calls) && m.tool_calls.length) {
          const toolCallSummary = m.tool_calls
            .slice(0, 10)
            .map((c: any) => {
              const n = String(c?.function?.name || 'unknown');
              let a = '{}';
              try { a = JSON.stringify(c?.function?.arguments || {}); } catch {}
              return `${n}(${a.slice(0, 240)})`;
            })
            .join(' | ');
          content = content
            ? `${content}\nTOOL_CALLS: ${toolCallSummary}`
            : `TOOL_CALLS: ${toolCallSummary}`;
        } else if (role === 'tool') {
          const toolName = String(m?.tool_name || 'tool');
          content = `${toolName}: ${content}`;
        }

        const trimmed = content.replace(/\r/g, '').trim();
        if (!trimmed) return null;
        return { role, content: trimmed.slice(0, 2200) };
      })
      .filter(Boolean)
      .slice(-28) as Array<{ role: string; content: string }>;

    let latestBrowserSnapshot = '';
    let latestDesktopSnapshot = '';
    for (let i = allToolResults.length - 1; i >= 0; i--) {
      const tr = allToolResults[i];
      if (!tr || typeof tr.name !== 'string') continue;
      const txt = String(tr.result || '').trim();
      if (!txt) continue;
      if (!latestBrowserSnapshot && tr.name.startsWith('browser_')) {
        latestBrowserSnapshot = txt.slice(0, 7000);
      }
      if (!latestDesktopSnapshot && tr.name.startsWith('desktop_')) {
        latestDesktopSnapshot = txt.slice(0, 7000);
      }
      if (latestBrowserSnapshot && latestDesktopSnapshot) break;
    }

    return {
      availableTools,
      recentToolExecutions,
      recentModelMessages,
      recentProcessNotes: orchestrationLog.slice(-28),
      latestBrowserSnapshot,
      latestDesktopSnapshot,
    };
  };

  const rawOrchCfg = ((getConfig().getConfig() as any).orchestration || {}) as any;

  // Optional preflight advisor pass: secondary model can route and provide
  // a compact execution plan before primary starts tool calling.
  const preflightCfg = orchestrationSkillEnabled ? getOrchestrationConfig() : null;
  if (!preflightCfg?.enabled && String(rawOrchCfg?.preflight?.mode || '') === 'always') {
    sendSSE('info', {
      message: 'Preflight advisor is set to Always, but Multi-Agent Orchestrator skill is disabled.',
    });
  }
  const skipGenericPreflightForFileOp = fileOpV2Active;
  if (skipGenericPreflightForFileOp) {
    sendSSE('info', {
      message: `FILE_OP v2 route selected (${fileOpType}); skipping generic advisor preflight.`,
    });
  }
  // Task runner sessions (sessionId starts with 'task_') are already inside a background task
  // execution — skip preflight entirely to prevent recursive task spawning loops.
  const isTaskRunnerSession = sessionId.startsWith('task_');

  if (
    preflightCfg?.enabled &&
    !isBootStartupTurn &&
    !skipGenericPreflightForFileOp &&
    !isTaskRunnerSession &&
    shouldRunPreflight(message, preflightCfg.preflight.mode) &&
    orchestrationStats.assistCount < preflightCfg.limits.max_assists_per_session
  ) {
    sendSSE('info', {
      message: `Running advisor preflight via ${preflightCfg.secondary.provider}:${preflightCfg.secondary.model}...`,
    });
    console.log(
      `[Orchestrator] Preflight start (${preflightCfg.secondary.provider}:${preflightCfg.secondary.model})`,
    );
    const preflightBlockedTask = findBlockedTaskForSession(sessionId);
    const preflight = await callSecondaryPreflight({
      userMessage: message,
      recentHistory: history.slice(-4).map(h => ({ role: h.role, content: h.content })),
      blockedTask: preflightBlockedTask
        ? {
            id: preflightBlockedTask.id,
            title: preflightBlockedTask.title,
            // Clarify the status in human terms for the preflight prompt
            status: preflightBlockedTask.status === 'awaiting_user_input'
              ? 'awaiting_user_input (task asked user a question and is paused until they answer)'
              : preflightBlockedTask.status,
            currentStepIndex: preflightBlockedTask.currentStepIndex,
            planLength: Array.isArray(preflightBlockedTask.plan) ? preflightBlockedTask.plan.length : 0,
            pauseReason: preflightBlockedTask.pauseReason,
          }
        : undefined,
    });

    if (preflight) {
      preflightRoute = preflight.route;
      preflightReasonForTurn = String(preflight.reason || '').trim();
      orchestrationLog.push(`[preflight:${preflight.route}] ${preflight.reason || 'no reason'}`);
      console.log(
        `[Orchestrator] Preflight route=${preflight.route} reason=${(preflight.reason || 'n/a').slice(0, 120)}`,
      );
      const stats = recordOrchestrationEvent(
        sessionId,
        {
          trigger: 'preflight',
          mode: 'planner',
          reason: preflight.reason || 'preflight routing',
          route: preflight.route,
        },
        preflightCfg,
      );
      sendSSE('orchestration', {
        trigger: 'preflight',
        mode: 'planner',
        route: preflight.route,
        reason: preflight.reason,
        preflight,
        assist_count: stats.assistCount,
        assist_cap: preflightCfg.limits.max_assists_per_session,
      });
      const preflightProgressSteps = (
        Array.isArray((preflight as any)?.quick_plan) ? (preflight as any).quick_plan
          : Array.isArray((preflight as any)?.task_plan) ? (preflight as any).task_plan
            : []
      )
        .map((line: any) => String(line || '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (preflightProgressSteps.length >= 2) {
        seedProgressFromLines(preflightProgressSteps, 'preflight');
      }

      // ── Background task route ────────────────────────────────────────────
      // Telegram sessions: never use background_task mode — run inline like normal chat.
      // Background tasks lose the browser session aliasing and use a broken tool-arg
      // serialisation path that causes browser_open to receive JSON strings instead of objects.
      const isTelegramSession = String(sessionId || '').startsWith('telegram_');
      if (preflight.route === 'background_task' && multiAgentActive && !isTelegramSession) {
        const taskTitle = preflight.task_title || 'Background Task';
        const taskPlan = (preflight.task_plan || []).map((desc: string, i: number) => ({
          index: i,
          description: desc,
          status: 'pending' as const,
        }));
        const taskChannel = inferTaskChannelFromSession(sessionId);
        const parsedTelegramChatId = taskChannel === 'telegram'
          ? Number(String(sessionId || '').replace(/^telegram_/, ''))
          : NaN;
        const telegramChatId = Number.isFinite(parsedTelegramChatId) && parsedTelegramChatId > 0
          ? parsedTelegramChatId
          : undefined;
        const task = createTask({
          title: taskTitle,
          prompt: message,
          sessionId,
          channel: taskChannel,
          telegramChatId,
          plan: taskPlan.length > 0 ? taskPlan : [{ index: 0, description: 'Execute task', status: 'pending' }],
        });
        appendJournal(task.id, { type: 'status_push', content: `Task queued: ${taskTitle}` });
        // Issue 11: Seed runtimeProgress from the preflight plan immediately so the task
        // panel shows steps before the BackgroundTaskRunner starts its first round.
        // declare_plan inside handleChat will overwrite this once the runner fires.
        if (preflightProgressSteps.length >= 2) {
          updateTaskRuntimeProgress(task.id, {
            source: 'preflight',
            activeIndex: 0,
            items: preflightProgressSteps.map((text: string, idx: number) => ({
              id: `p${idx + 1}`,
              text,
              status: idx === 0 ? 'in_progress' : 'pending',
            })),
          });
          // Also emit progress_state over the current HTTP SSE stream so the
          // task panel widget in the active chat session sees the plan instantly.
          sendSSE('progress_state', {
            source: 'preflight',
            reason: 'background_task_queued',
            activeIndex: 0,
            total: preflightProgressSteps.length,
            items: preflightProgressSteps.map((text: string, idx: number) => ({
              id: `p${idx + 1}`,
              index: idx,
              text,
              status: idx === 0 ? 'in_progress' : 'pending',
            })),
          });
        }
        // Fire background runner (detached — does not block HTTP response)
        const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
        runner.start().catch(err => console.error(`[BackgroundTaskRunner] Task ${task.id} error:`, err.message));
        const queuedMessage = preflight.friendly_queued_message
          || `On it! I've queued "${taskTitle}" as a background task. You can track progress in the Tasks panel.`;
        sendSSE('task_queued', { taskId: task.id, title: taskTitle });
        addMessage(sessionId, { role: 'assistant', content: queuedMessage, timestamp: Date.now() });
        return { type: 'chat', text: queuedMessage };
      }

      if (
        preflight.route === 'secondary_chat' &&
        preflightCfg.preflight.allow_secondary_chat &&
        preflight.secondary_response?.trim()
      ) {
        sendSSE('info', {
          message: 'Advisor route selected secondary_chat. Returning secondary response directly.',
        });
        const text = preflight.secondary_response.trim();
        return { type: 'chat', text };
      }

      if (preflight.route === 'secondary_chat' && !preflightCfg.preflight.allow_secondary_chat) {
        sendSSE('info', {
          message: 'Advisor suggested secondary_chat, but direct secondary chat is disabled. Continuing with primary.',
        });
      } else if (preflight.route === 'primary_direct') {
        sendSSE('info', { message: 'Advisor route selected primary_direct. Continuing with primary response.' });
        // If the advisor provided an executor_objective (e.g. agent_inspection → call agent_list),
        // inject it as a hint so the primary model follows the instruction instead of guessing.
        if (preflight.executor_objective && preflight.executor_objective.trim()) {
          const directHint = formatPreflightExecutionObjective(preflight);
          messages.push({ role: 'user', content: directHint });
          messages.push({ role: 'assistant', content: 'Understood. I will follow this guidance.' });
        }
      } else if (preflight.route === 'primary_with_plan') {
        // primary_with_plan is retired when multi-agent is active — upgrade to background_task
        // Exception: Telegram sessions always stay inline (no background tasks).
        if (multiAgentActive && !isTelegramSession) {
          sendSSE('info', { message: 'Advisor returned primary_with_plan but multi-agent is active — upgrading to background_task.' });
          const taskTitle = preflight.task_title || (preflight.reason ? preflight.reason.slice(0, 60) : 'Background Task');
          const taskPlan = (preflight.task_plan || preflight.quick_plan || []).map((desc: string, i: number) => ({
            index: i, description: desc, status: 'pending' as const,
          }));
          const taskChannel = inferTaskChannelFromSession(sessionId);
          const parsedTelegramChatId = taskChannel === 'telegram'
            ? Number(String(sessionId || '').replace(/^telegram_/, ''))
            : NaN;
          const telegramChatId = Number.isFinite(parsedTelegramChatId) && parsedTelegramChatId > 0
            ? parsedTelegramChatId
            : undefined;
          const task = createTask({
            title: taskTitle,
            prompt: message,
            sessionId,
            channel: taskChannel,
            telegramChatId,
            plan: taskPlan.length > 0 ? taskPlan : [{ index: 0, description: 'Execute task', status: 'pending' }],
          });
          appendJournal(task.id, { type: 'status_push', content: `Task queued (upgraded from primary_with_plan): ${taskTitle}` });
          const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
          runner.start().catch((err: Error) => console.error(`[BackgroundTaskRunner] Task ${task.id} error:`, err.message));
          const queuedMessage = preflight.friendly_queued_message
            || `On it! I've queued "${taskTitle}" as a background task. You can track progress in the Tasks panel.`;
          sendSSE('task_queued', { taskId: task.id, title: taskTitle });
          addMessage(sessionId, { role: 'assistant', content: queuedMessage, timestamp: Date.now() });
          return { type: 'chat', text: queuedMessage };
        }
        sendSSE('info', { message: 'Advisor route selected primary_with_plan. Injecting execution objective and plan guidance.' });
      }

      const shouldInjectObjective = preflight.route === 'primary_with_plan';
      if (shouldInjectObjective) {
        const objectiveHint = formatPreflightExecutionObjective(preflight);
        const injected = replaceCurrentUserPromptWithAdvisorObjective(objectiveHint);
        if (!injected) {
          sendSSE('warn', {
            message: 'Advisor objective injection failed; falling back to raw user prompt.',
          });
        }
      }

      if (preflight.route === 'primary_with_plan') {
        const hint = formatPreflightHint(preflight);
        messages.push({ role: 'user', content: hint });
        messages.push({ role: 'assistant', content: 'Understood. I will follow this preflight guidance.' });
      }
    }
  } else if (
    preflightCfg?.enabled &&
    !isBootStartupTurn &&
    !isTaskRunnerSession &&
    shouldRunPreflight(message, preflightCfg.preflight.mode) &&
    orchestrationStats.assistCount >= preflightCfg.limits.max_assists_per_session
  ) {
    sendSSE('info', { message: 'Advisor preflight skipped: session assist cap reached.' });
  }

  const resetBrowserAdvisorCollection = () => {
    browserAdvisorCollectedFeed.length = 0;
    browserAdvisorSeenFeedKeys.clear();
    browserAdvisorDedupeCount = 0;
    browserAdvisorBatch = 0;
    browserAdvisorLastHash = '';
    consecutiveUnchangedSnapshots = 0;
    browserNoFeedProgressStreak = 0;
    browserStabilizeUrlKey = '';
    browserStabilizeWaitRetries = 0;
    browserStabilizeTabProbes = 0;
    browserStabilizeExhausted = false;
    browserVisionModeActive = false;
  };

  const toUrlKey = (rawUrl: string): string => {
    try {
      const u = new URL(String(rawUrl || ''));
      return `${u.hostname}${u.pathname}`.toLowerCase();
    } catch {
      return String(rawUrl || '').toLowerCase().split('?')[0];
    }
  };

  const feedItemKey = (item: Record<string, any>): string => {
    if (item?.id) return `id:${String(item.id)}`;
    if (item?.link) return `link:${String(item.link)}`;
    const text = String(item?.text || item?.snippet || item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const handle = String(item?.handle || item?.author || '').toLowerCase();
    const time = String(item?.time || '').slice(0, 40);
    return `hash:${handle}|${time}|${text}`;
  };

  const mergeBrowserFeedBatch = (batch: Array<Record<string, any>>): { added: number; deduped: number; total: number } => {
    let added = 0;
    let deduped = 0;
    for (const raw of batch || []) {
      const item = raw && typeof raw === 'object' ? raw : {};
      const key = feedItemKey(item);
      if (!key || browserAdvisorSeenFeedKeys.has(key)) {
        deduped++;
        continue;
      }
      browserAdvisorSeenFeedKeys.add(key);
      browserAdvisorCollectedFeed.push(item);
      if (browserAdvisorCollectedFeed.length > browserMaxCollectedItems) {
        browserAdvisorCollectedFeed.shift();
      }
      added++;
    }
    browserAdvisorDedupeCount += deduped;
    return { added, deduped, total: browserAdvisorCollectedFeed.length };
  };

  const maybeRunBrowserAdvisorPass = async (
    triggerToolName: string,
    triggerResult: ToolResult,
    triggerToolArgs?: Record<string, any>,
    decision?: PostActionObservationDecision,
    prefetchedPacket?: BrowserAdvisorPacket | null,
  ): Promise<void> => {
    if (!isBrowserToolName(triggerToolName)) return;
    if (decision && !decision.shouldRunAdvisor) return;
    if (!decision && triggerResult.error) return;
    const orchCfg = getOrchestrationConfig();
    if (!orchestrationSkillEnabled || !orchCfg?.enabled) return;
    if (browserAdvisorCallsThisTurn >= browserMaxAdvisorCallsPerTurn) return;
    if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) return;

    const packet = prefetchedPacket
      || await getBrowserAdvisorPacket(sessionId, { maxItems: browserPacketMaxItems, snapshotElements: 180 });
    if (!packet) return;
    const packetUrlKey = toUrlKey(packet.page.url);
    if (
      triggerToolName === 'browser_open'
      || (browserAdvisorUrlKey && packetUrlKey && packetUrlKey !== browserAdvisorUrlKey && !browserContinuationPending)
    ) {
      resetBrowserAdvisorCollection();
    }
    browserAdvisorUrlKey = packetUrlKey || browserAdvisorUrlKey;
    if (!browserStabilizeUrlKey || (packetUrlKey && packetUrlKey !== browserStabilizeUrlKey)) {
      browserStabilizeUrlKey = packetUrlKey || browserStabilizeUrlKey;
      browserStabilizeWaitRetries = 0;
      browserStabilizeTabProbes = 0;
      browserStabilizeExhausted = false;
      browserVisionModeActive = false; // new page — start in DOM mode
    }

    const isFeedOrSearchPage = packet.page.pageType === 'x_feed' || packet.page.pageType === 'search_results';
    const quality = evaluateBrowserSnapshotQuality(packet.snapshot, packet.snapshotElements, message);
    if (quality.low) {
      const diag = quality.diagnostics;
      const diagMsg = diag
        ? ` hidden=${diag.hidden}, unlabeled_non_input=${diag.unlabeledNonInput}, unnamed_input_included=${diag.unnamedInputIncluded}`
        : '';
      sendSSE('info', {
        message: `Snapshot quality low: elements=${quality.elementCount}, input_candidates=${quality.inputCandidates}, reasons=${quality.reasons.join(' | ')}.${diagMsg}`,
      });
      const logLine = `[snapshot_quality] low | elements=${quality.elementCount} | inputs=${quality.inputCandidates} | reasons=${quality.reasons.join('; ')}`;
      orchestrationLog.push(logLine.slice(0, 260));
    }

    const stabilizationEligibleTool = (
      triggerToolName === 'browser_open'
      || triggerToolName === 'browser_snapshot'
      || triggerToolName === 'browser_wait'
      || triggerToolName === 'browser_press_key'
    );
    const stabilizationEligiblePage = packet.page.pageType === 'generic' || packet.page.pageType === 'article';
    const shouldAutoStabilize =
      quality.elementCount < 10
      || (goalLikelyNeedsTextInput(message) && quality.inputCandidates === 0);
    if (
      stabilizationEligibleTool
      && stabilizationEligiblePage
      && quality.low
      && shouldAutoStabilize
      && !isFeedOrSearchPage
      && !browserStabilizeExhausted
    ) {
      if (browserStabilizeWaitRetries < browserStabilizeMaxWaitRetries) {
        browserStabilizeWaitRetries += 1;
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Snapshot stabilization in progress';
        pendingSyntheticToolCalls = [
          { function: { name: 'browser_wait', arguments: { ms: 1500 } } },
          { function: { name: 'browser_snapshot', arguments: {} } },
        ];
        sendSSE('info', {
          message: `Snapshot stabilization: wait+snapshot (${browserStabilizeWaitRetries}/${browserStabilizeMaxWaitRetries}) before advisor routing.`,
        });
        return;
      }

      const shouldProbeFocus = goalLikelyNeedsTextInput(message) && quality.inputCandidates === 0;
      if (shouldProbeFocus && browserStabilizeTabProbes < browserStabilizeMaxTabProbes) {
        browserStabilizeTabProbes += 1;
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Input focus probe in progress';
        pendingSyntheticToolCalls = [
          { function: { name: 'browser_press_key', arguments: { key: 'Tab' } } },
          { function: { name: 'browser_wait', arguments: { ms: 500 } } },
          { function: { name: 'browser_snapshot', arguments: {} } },
        ];
        sendSSE('info', {
          message: `Snapshot stabilization: Tab focus probe (${browserStabilizeTabProbes}/${browserStabilizeMaxTabProbes}) to surface input controls.`,
        });
        return;
      }

      browserStabilizeExhausted = true;
      sendSSE('info', {
        message: 'Snapshot stabilization exhausted for this page; proceeding with current snapshot evidence.',
      });

      // ─── Component 4: Vision Fallback Trigger ───────────────────────────────────
      // After stabilization is exhausted AND DOM is still sparse, try vision fallback.
      // We capture a Playwright viewport screenshot and pass it to the advisor so it
      // can identify UI elements visually and route browser_vision_click/type instead.
      const orchCfgForVision = getOrchestrationConfig();
      const visionEligible =
        orchestrationSkillEnabled &&
        orchCfgForVision?.enabled &&
        quality.elementCount < 10 &&
        !browserVisionModeActive &&
        secondarySupportsVision(orchCfgForVision);

      if (visionEligible) {
        const vshot = await browserVisionScreenshot(sessionId);
        if (vshot) {
          browserVisionModeActive = true;
          sendSSE('info', {
            message: `Vision fallback activated: DOM has only ${quality.elementCount} elements. Capturing viewport screenshot for vision-guided routing.`,
          });
          sendSSE('browser_vision_mode', {
            active: true,
            elementCount: quality.elementCount,
            viewport: { width: vshot.width, height: vshot.height },
          });
          // The screenshot will be passed to the advisor on the next advisor call below.
          // We store it temporarily on the packet by augmenting the advisor input below.
          // Flag is read in the advisor input construction.
        } else {
          sendSSE('info', { message: 'Vision fallback: screenshot capture failed, proceeding without vision.' });
        }
      }
      // ───────────────────────────────────────────────────────────────────────
    } else if (
      !quality.low
      && (browserStabilizeWaitRetries > 0 || browserStabilizeTabProbes > 0 || browserVisionModeActive)
    ) {
      // DOM has recovered — exit vision mode if active
      if (browserVisionModeActive) {
        browserVisionModeActive = false;
        sendSSE('info', {
          message: `DOM recovered: ${quality.elementCount} elements visible. Exiting vision mode — switching back to DOM refs.`,
        });
        sendSSE('browser_vision_mode', { active: false, elementCount: quality.elementCount });
      } else {
        sendSSE('info', {
          message: `Snapshot stabilization complete: elements=${quality.elementCount}, input_candidates=${quality.inputCandidates}.`,
        });
      }
      browserStabilizeWaitRetries = 0;
      browserStabilizeTabProbes = 0;
      browserStabilizeExhausted = false;
    } else if (browserVisionModeActive && quality.elementCount >= 10) {
      // Vision mode active but DOM has now recovered — clear it
      browserVisionModeActive = false;
      sendSSE('info', {
        message: `DOM recovered to ${quality.elementCount} elements. Exiting vision mode.`,
      });
      sendSSE('browser_vision_mode', { active: false, elementCount: quality.elementCount });
    }

    if (
      !isBrowserHeavyResearchPage({
        url: packet.page.url,
        pageType: packet.page.pageType,
        snapshotElements: packet.snapshotElements,
        feedCount: packet.extractedFeed.length,
      })
    ) {
      return;
    }
    const hashUnchanged = packet.contentHash === browserAdvisorLastHash;
    if (hashUnchanged && !browserContinuationPending) {
      // On non-feed interactive pages, a stuck snapshot hash means the model is looping.
      // After 2 consecutive identical snapshots, force the advisor to run so it generates
      // a concrete @ref-based action instead of silently returning and letting the model re-snapshot.
      consecutiveUnchangedSnapshots += 1;
      if (consecutiveUnchangedSnapshots >= 2) {
        // Force advisor call — override the early return so it runs with existing data.
        // Applies to ALL page types including feed pages: if the snapshot hasn't changed,
        // the model is looping and needs a concrete directive from the advisor.
        browserContinuationPending = true;
        browserAdvisorRoute = 'continue_browser';
        browserAdvisorHintPreview = 'Snapshot unchanged — forcing advisor to generate concrete action';
        sendSSE('info', { message: `Snapshot hash unchanged (${consecutiveUnchangedSnapshots}x) — forcing browser advisor to generate concrete action.` });
        // Don't return — fall through to advisor call below
      } else {
        return;
      }
    } else {
      consecutiveUnchangedSnapshots = 0;
    }
    browserAdvisorLastHash = packet.contentHash;
    browserAdvisorCallsThisTurn += 1;
    browserAdvisorBatch += 1;

    const merged = mergeBrowserFeedBatch(packet.extractedFeed as Array<Record<string, any>>);
    const isFeedCollectionPage = packet.page.pageType === 'x_feed' || packet.page.pageType === 'search_results';
    if (isFeedCollectionPage) {
      browserNoFeedProgressStreak = merged.added > 0 ? 0 : (browserNoFeedProgressStreak + 1);
    } else {
      browserNoFeedProgressStreak = 0;
    }

    sendSSE('browser_advisor_start', {
      trigger_tool: triggerToolName,
      page_type: packet.page.pageType,
      url: packet.page.url,
      snapshot_elements: packet.snapshotElements,
      extracted_count: packet.extractedFeed.length,
    });
    sendSSE('feed_collected', {
      batch: browserAdvisorBatch,
      added: merged.added,
      total: merged.total,
      deduped: merged.deduped,
      url: packet.page.url,
    });

    const recentFailures = allToolResults
      .filter((r) => r.error)
      .slice(-4)
      .map((r) => `${r.name}: ${String(r.result || '').slice(0, 180)}`);

    const advisorFeed = browserAdvisorCollectedFeed.length > 0
      ? browserAdvisorCollectedFeed.slice(-browserMaxCollectedItems)
      : (packet.extractedFeed as Array<Record<string, any>>);

    // ── Change 5: chat_interface generation-wait — skip advisor, inject synthetic wait ──
    if (browserAutoSnapshotRetriesEnabled && packet.page.pageType === 'chat_interface' && packet.isGenerating) {
      sendSSE('info', { message: 'Browser: chat interface still generating — waiting for response before advising.' });
      pendingSyntheticToolCalls = [
        { function: { name: 'browser_wait', arguments: { ms: 3000 } } },
        { function: { name: 'browser_snapshot', arguments: {} } },
      ];
      return; // don't call advisor yet — next round will re-enter this function with fresh snapshot
    }

    // Component 4: capture fresh viewport screenshot for advisor when vision mode is active.
    // We do this every advisor call while vision mode is on so the advisor always has
    // the current page state, not a stale one from stabilization.
    let visionShotBase64: string | undefined;
    if (browserVisionModeActive) {
      const vshot = await browserVisionScreenshot(sessionId);
      visionShotBase64 = vshot?.base64;
    }

    let advisor = await callSecondaryBrowserAdvisor({
      goal: message,
      minFeedItemsBeforeAnswer: browserMinFeedItemsBeforeAnswer,
      page: {
        title: packet.page.title,
        url: packet.page.url,
        pageType: packet.page.pageType,
        snapshotElements: packet.snapshotElements,
      },
      extractedFeed: advisorFeed,
      textBlocks: packet.textBlocks,
      snapshot: packet.snapshot,
      scrollState: {
        batch: browserAdvisorBatch,
        total_collected: advisorFeed.length,
        dedupe_count: browserAdvisorDedupeCount,
      },
      lastActions: orchestrationLog.slice(-8),
      recentFailures,
      pageText: packet.pageText,
      isGenerating: packet.isGenerating,
      // Vision fields (only populated in vision mode)
      screenshotBase64: visionShotBase64,
      visionModeActive: browserVisionModeActive,
    });
    if (!advisor) return;

    // Guardrail: collect_more should only run on feed/search collection pages.
    // For generic pages (e.g. chatgpt.com composer), force decisive routing.
    if (advisor.route === 'collect_more' && !isFeedCollectionPage) {
      sendSSE('info', {
        message: 'Browser advisor override: collect_more disabled on non-feed page; switching to direct interaction mode.',
      });
      advisor = {
        ...advisor,
        route: 'handoff_primary',
        reason: 'collect_more disabled for non-feed pages; choose a concrete interaction from current snapshot.',
        next_tool: { tool: 'browser_snapshot', params: {} },
        primary_hint: 'Do not scroll/PageDown here. Use the current snapshot refs to click/fill the correct control directly.',
      };
    }

    // Guardrail: if feed collection is making no progress, stop scroll loops.
    if (
      advisor.route === 'collect_more'
      && isFeedCollectionPage
      && browserNoFeedProgressStreak >= 2
      && advisorFeed.length === 0
    ) {
      sendSSE('info', {
        message: 'Browser advisor override: collection stalled with zero extracted items; stopping scroll loop.',
      });
      advisor = {
        ...advisor,
        route: 'continue_browser',
        reason: 'No feed items extracted after repeated collection attempts; stop scrolling and select a concrete next interaction.',
        next_tool: { tool: 'browser_snapshot', params: {} },
        primary_hint: 'Collection is stalled (0 extracted). Do not keep PageDown looping. Use snapshot evidence and pick a concrete click/fill step.',
      };
    }

    if (advisor.route === 'collect_more') {
      if (!advisor.next_tool?.tool) {
        advisor = {
          ...advisor,
          next_tool: { tool: 'browser_press_key', params: { key: 'PageDown' } },
        };
      } else if (
        advisor.next_tool.tool === 'browser_press_key'
        && (!advisor.next_tool.params || !advisor.next_tool.params.key)
      ) {
        advisor = {
          ...advisor,
          next_tool: { tool: 'browser_press_key', params: { ...(advisor.next_tool.params || {}), key: 'PageDown' } },
        };
      }
    }

    const hint = formatBrowserAdvisorHint(advisor);
    const stats = recordOrchestrationEvent(
      sessionId,
      {
        trigger: 'auto',
        mode: 'planner',
        reason: `browser_advisor:${advisor.route}${advisor.reason ? ` (${advisor.reason})` : ''}`,
        route: advisor.route,
      },
      orchCfg,
    );

    browserAdvisorRoute = advisor.route;
    browserAdvisorHintPreview = String(advisor.primary_hint || advisor.reason || advisor.answer || '').slice(0, 220);
    browserContinuationPending = advisor.route === 'continue_browser' || advisor.route === 'collect_more' || advisor.route === 'vision_interact';
    if (!browserContinuationPending) {
      browserForcedRetries = 0;
    }

    sendSSE('browser_advisor_route', {
      route: advisor.route,
      reason: advisor.reason,
      answer: advisor.answer || '',
      primary_hint: advisor.primary_hint || '',
      next_tool: advisor.next_tool || null,
      collect_policy: advisor.collect_policy || null,
      raw_response: advisor.raw_response || '',
      assist_count: stats.assistCount,
      assist_cap: orchCfg.limits.max_assists_per_session,
    });
    sendSSE('browser_advisor_nudge', {
      route: advisor.route,
      preview: browserAdvisorHintPreview,
    });

    orchestrationLog.push(`[browser:${advisor.route}] ${String(advisor.reason || 'n/a').slice(0, 200)}`);

    // ── Synthetic tool call injection for deterministic collect_more scrolls ─────────
    // When the advisor says scroll (PageDown), skip LLM generation entirely.
    // Inject as a synthetic assistant message that the main loop executes directly.
    // This eliminates the 75s stall window between advisor directive and actual scroll.
    const isCollectMoreScroll = advisor.route === 'collect_more'
      && multiAgentActive
      && isFeedCollectionPage
      && advisor.next_tool?.tool === 'browser_press_key';
    const isCollectMoreWait = advisor.route === 'collect_more'
      && multiAgentActive
      && isFeedCollectionPage
      && advisor.next_tool?.tool === 'browser_wait';

    if (browserAutoSnapshotRetriesEnabled && (isCollectMoreScroll || isCollectMoreWait)) {
      // Queue synthetic tool calls: scroll + wait + snapshot (all deterministic)
      const scrollParams = advisor.next_tool!.params || { key: 'PageDown' };
      pendingSyntheticToolCalls = [
        { function: { name: advisor.next_tool!.tool, arguments: scrollParams } },
        { function: { name: 'browser_wait', arguments: { ms: 1500 } } },
        { function: { name: 'browser_snapshot', arguments: {} } },
      ];
      sendSSE('info', { message: `Advisor: synthetic scroll queued (${advisor.route}) — skipping LLM generation.` });
      // Push a compact hint so the LLM knows what happened after the synthetic round
      messages.push({ role: 'user', content: hint });
      messages.push({ role: 'assistant', content: `[ADVISOR] ${advisorFeed.length}/${browserMinFeedItemsBeforeAnswer} items. Scrolling for more.` });
      return;
    }

    // For non-deterministic steps, use the normal message injection path
    // ── Changes 2 & 3: context wipe + stripped executor system for browser ops ──────────
    // Secondary holds full state via buildSecondaryAssistContext().
    // Primary only needs: minimal system + original goal + last 4 tool acks + this directive.
    // Wipe now, before pushing the hint pair, so the hint ends up at the bottom cleanly.
    if (multiAgentActive) {
      const systemMsg = messages[0]; // always keep system at [0]
      // Stripped executor system — no editing rules, no identity prose, just tool list + 3 rules
      const strippedSystem = {
        role: 'system',
        content: `You are Prom. Execute browser tool calls exactly as instructed by the advisor directive below.

BROWSER TOOLS: browser_open, browser_snapshot, browser_click, browser_fill, browser_drag, browser_upload_file, browser_press_key, browser_wait, browser_scroll, browser_click_and_download, browser_close, web_fetch, download_url, download_media, generate_image, generate_video

RULES:
1. Call exactly the tool and params the advisor specifies.
2. Do not think, plan, or explain. Just call the tool.
3. Prefer snapshot/screenshot evidence over browser_run_js unless a JS inspection is explicitly required.
4. If the directive says answer_now, respond in 1-2 sentences using the provided draft.`,
      };
      // Keep last 4 tool-result messages so the LLM has minimal recent action context
      const recentToolMsgs = messages
        .filter((m: any) => m.role === 'tool')
        .slice(-4);
      // Rebuild messages: stripped system + goal + last 4 tool acks
      messages.length = 0;
      messages.push(strippedSystem);
      messages.push({ role: 'user', content: message });
      messages.push({ role: 'assistant', content: 'Understood. Executing browser task.' });
      for (const tm of recentToolMsgs) messages.push(tm);
    }

    messages.push({ role: 'user', content: hint });
    messages.push({ role: 'assistant', content: 'Understood. Continuing with browser advisor guidance.' });
    if (advisor.route === 'answer_now' && advisor.answer.trim()) {
      messages.push({
        role: 'user',
        content: `Use the browser evidence and answer now in 1-2 concise sentences. Draft answer: ${advisor.answer.slice(0, 700)}`,
      });
    } else if (advisor.next_tool?.tool) {
      const isWebFetchStep = advisor.next_tool.tool === 'web_fetch';
      const collectTail = advisor.route === 'collect_more' && !isWebFetchStep
        ? ' Then continue collection: if needed call browser_wait(1200), and capture browser_snapshot before deciding again only if new content should have loaded or the UI is still ambiguous.'
        : '';
      const webFetchNote = isWebFetchStep
        ? ' Use web_fetch (not browser_open) since you already have the URL and only need the text content.'
        : '';
      messages.push({
        role: 'user',
        content: `Immediate next step: call ${advisor.next_tool.tool} with params ${JSON.stringify(advisor.next_tool.params || {})}. Do not stop with intent text. After this step, capture browser_snapshot or browser_vision_screenshot only if state likely changed or the UI is ambiguous before deciding again.${collectTail}${webFetchNote}`,
      });
    }
  };

  const maybeRunDesktopAdvisorPass = async (
    triggerToolName: string,
    triggerResult: ToolResult,
    decision?: PostActionObservationDecision,
  ): Promise<void> => {
    if (!isDesktopToolName(triggerToolName)) return;
    if (decision && !decision.shouldRunAdvisor) return;
    if (!decision && triggerResult.error) return;
    if (!isDesktopVisualToolName(triggerToolName)) return;
    const orchCfg = getOrchestrationConfig();
    if (!orchestrationSkillEnabled || !orchCfg?.enabled) return;
    if (desktopAdvisorCallsThisTurn >= desktopMaxAdvisorCallsPerTurn) return;
    if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) return;

    const packet = getDesktopAdvisorPacket(sessionId);
    if (!packet) return;

    desktopAdvisorCallsThisTurn += 1;
    sendSSE('desktop_advisor_start', {
      trigger_tool: triggerToolName,
      active_window: packet.activeWindow?.title || '',
      open_windows: packet.openWindows.length,
      width: packet.width,
      height: packet.height,
      ocr_confidence: Number(packet.ocrConfidence || 0),
      ocr_chars: String(packet.ocrText || '').length,
    });

    const recentFailures = allToolResults
      .filter((r) => r.error)
      .slice(-4)
      .map((r) => `${r.name}: ${String(r.result || '').slice(0, 180)}`);
    const clipboardPreview = (() => {
      for (let i = allToolResults.length - 1; i >= 0; i--) {
        const r = allToolResults[i];
        if (!r || r.error) continue;
        if (r.name !== 'desktop_get_clipboard') continue;
        return String(r.result || '').slice(0, 1200);
      }
      return '';
    })();

    const advisor = await callSecondaryDesktopAdvisor({
      goal: message,
      screenshot: {
        width: packet.width,
        height: packet.height,
        capturedAt: packet.capturedAt,
        contentHash: packet.contentHash,
      },
      // Pass the raw screenshot to the advisor when available. The advisor function
      // will only inject it as an image_url content part when the secondary provider
      // supports vision (openai / openai_codex). For Ollama/llama.cpp it is ignored.
      screenshotBase64: packet.screenshotBase64 || undefined,
      activeWindow: packet.activeWindow
        ? { processName: packet.activeWindow.processName, title: packet.activeWindow.title }
        : undefined,
      openWindows: packet.openWindows.slice(0, 40).map((w) => ({ processName: w.processName, title: w.title })),
      lastActions: orchestrationLog.slice(-8),
      recentFailures,
      clipboardPreview,
      ocrText: packet.ocrText || '',
      ocrConfidence: Number(packet.ocrConfidence || 0),
    });
    if (!advisor) return;

    const hint = formatDesktopAdvisorHint(advisor);
    const stats = recordOrchestrationEvent(
      sessionId,
      {
        trigger: 'auto',
        mode: 'planner',
        reason: `desktop_advisor:${advisor.route}${advisor.reason ? ` (${advisor.reason})` : ''}`,
        route: advisor.route,
      },
      orchCfg,
    );

    desktopAdvisorRoute = advisor.route;
    desktopAdvisorHintPreview = String(advisor.primary_hint || advisor.reason || advisor.answer || '').slice(0, 220);
    desktopContinuationPending = advisor.route === 'continue_desktop';

    sendSSE('desktop_advisor_route', {
      route: advisor.route,
      reason: advisor.reason,
      answer: advisor.answer || '',
      primary_hint: advisor.primary_hint || '',
      next_tool: advisor.next_tool || null,
      raw_response: advisor.raw_response || '',
      assist_count: stats.assistCount,
      assist_cap: orchCfg.limits.max_assists_per_session,
    });
    sendSSE('desktop_advisor_nudge', {
      route: advisor.route,
      preview: desktopAdvisorHintPreview,
    });

    orchestrationLog.push(`[desktop:${advisor.route}] ${String(advisor.reason || 'n/a').slice(0, 200)}`);

    if (multiAgentActive) {
      const strippedSystem = {
        role: 'system',
        content: `You are Prom. Execute desktop tool calls exactly as instructed by the advisor directive below.

DESKTOP TOOLS: desktop_screenshot, desktop_get_monitors, desktop_find_window, desktop_focus_window, desktop_click, desktop_drag, desktop_scroll, desktop_wait, desktop_type, desktop_type_raw, desktop_press_key, desktop_get_clipboard, desktop_set_clipboard

RULES:
1. Call exactly the tool and params the advisor specifies.
2. Do not think, plan, or explain. Just call the tool.
3. If the directive says answer_now, respond in 1-2 sentences using the provided draft.`,
      };
      const recentToolMsgs = messages
        .filter((m: any) => m.role === 'tool')
        .slice(-4);
      messages.length = 0;
      messages.push(strippedSystem);
      messages.push({ role: 'user', content: message });
      messages.push({ role: 'assistant', content: 'Understood. Executing desktop task.' });
      for (const tm of recentToolMsgs) messages.push(tm);
    }

    messages.push({ role: 'user', content: hint });
    messages.push({ role: 'assistant', content: 'Understood. Continuing with desktop advisor guidance.' });
    if (advisor.route === 'answer_now' && advisor.answer.trim()) {
      messages.push({
        role: 'user',
        content: `Use desktop evidence and answer now in 1-2 concise sentences. Draft answer: ${advisor.answer.slice(0, 700)}`,
      });
    } else if (advisor.next_tool?.tool) {
      messages.push({
        role: 'user',
        content: `Immediate next step: call ${advisor.next_tool.tool} with params ${JSON.stringify(advisor.next_tool.params || {})}. After acting, capture desktop_screenshot again only if the UI likely changed or the outcome is ambiguous before deciding the next step.`,
      });
    }
  };

  if (fileOpV2Active && fileOpType === 'FILE_ANALYSIS') {
    sendSSE('info', { message: 'FILE_OP v2: delegating analysis to secondary model.' });
    const candidateFiles = (() => {
      try {
        return fs.readdirSync(workspacePath, { withFileTypes: true })
          .filter(e => e.isFile())
          .map(e => e.name)
          .slice(0, 80);
      } catch {
        return [] as string[];
      }
    })();
    const analysis = await callSecondaryFileAnalyzer({
      userMessage: message,
      recentHistory: history.slice(-6).map(h => ({ role: h.role, content: h.content })),
      candidateFiles,
    });
    if (analysis) {
      maybeSaveFileOpCheckpoint({
        phase: 'done',
        next_action: 'analysis complete',
      });
      clearFileOpCheckpoint(sessionId);
      const lines: string[] = [];
      if (analysis.summary) lines.push(analysis.summary);
      if (analysis.diagnosis) lines.push(`Diagnosis: ${analysis.diagnosis}`);
      if (analysis.exact_files.length) lines.push(`Files: ${analysis.exact_files.join(', ')}`);
      if (analysis.edit_plan.length) lines.push(`Plan: ${analysis.edit_plan.join(' -> ')}`);
      const text = lines.join('\n');
      return { type: 'chat', text };
    }
    // Secondary unavailable — fail-closed. Spec: FILE_ANALYSIS is always Secondary, no primary fallback.
    sendSSE('info', { message: 'FILE_OP v2: secondary analyzer unavailable; cannot complete FILE_ANALYSIS (fail-closed).' });
    return { type: 'chat', text: 'Analysis could not be completed: the secondary model is unavailable. Please try again.' };
  }

  // ── FILE_CREATE upfront size routing ──
  // If the request is clearly secondary territory (full page / large template),
  // skip primary entirely — queue secondary patch plan now so round 0 executes
  // it as synthetic calls without ever running the LLM for generation.
  // This eliminates the stall→restart spiral for large creates.
  if (
    fileOpV2Active
    && fileOpType === 'FILE_CREATE'
    && fileOpOwner === 'primary'
    && pendingSyntheticToolCalls.length === 0
  ) {
    const looksLarge = requestedFullTemplate(message)
      || /\b(landing page|full html|multi.?section|multiple sections|panels?|sections?.+panels?|panels?.+sections?|full.?page|whole page|full.?site|complete.?page)\b/i.test(message);
    if (looksLarge) {
      fileOpOwner = 'secondary';
      fileOpPrimaryStallPromoted = true;
      sendSSE('info', {
        message: 'FILE_OP v2: large FILE_CREATE detected upfront — routing directly to secondary (skipping primary generation).',
      });
      maybeSaveFileOpCheckpoint({ phase: 'plan', next_action: 'upfront secondary routing for large create' });
      const patchPlan = await callSecondaryFilePatchPlanner({
        userMessage: message,
        operationType: 'FILE_CREATE',
        owner: 'secondary',
        reason: 'Upfront large-create detection: request exceeds primary create thresholds before generation',
        fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
        verifier: null,
      });
      if (patchPlan?.tool_calls?.length) {
        pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
          function: { name: tc.tool, arguments: tc.args || {} },
        }));
        sendSSE('info', {
          message: `FILE_OP v2: queued ${pendingSyntheticToolCalls.length} secondary call(s) for large create.`,
        });
        maybeSaveFileOpCheckpoint({ phase: 'execute', next_action: 'execute secondary upfront create batch' });
      }
    }
  }

  sendSSE('info', { message: 'Thinking...' });
  console.log('[v2] -- CHAT --');

  for (let round = 0; ; round++) {
    if (round >= effectiveMaxToolRounds) {
      const allowExtendedFileOpLoop =
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && (fileOpOwner === 'secondary' || !!fileOpLastFailureSignature);
      if (!allowExtendedFileOpLoop) break;
      if (round === effectiveMaxToolRounds) {
        sendSSE('info', {
          message: 'FILE_OP v2: extending execution beyond default step cap for secondary-owned repair convergence.',
        });
      }
    }

    if (abortSignal?.aborted) {
      console.log(`[v2] Aborted at round ${round} — client disconnected`);
      const partial = allToolResults.length > 0
        ? `Stopped after ${allToolResults.length} step${allToolResults.length !== 1 ? 's' : ''}.`
        : 'Stopped.';
      const finalPartial = finalizeSkillGardenerForTurn(partial);
      return { type: 'execute', text: finalPartial, toolResults: allToolResults.length > 0 ? allToolResults : undefined };
    }

    // ── Synthetic tool calls from browser advisor ─────────────────────────────
    // When the advisor queued deterministic tool calls (e.g. PageDown scroll),
    // skip LLM generation entirely for this round and execute them directly.
    if (pendingSyntheticToolCalls.length > 0) {
      const syntheticCalls = pendingSyntheticToolCalls.map((call: any, idx: number) => ({
        ...call,
        id: String(call?.id || `synthetic_${Date.now()}_${round + 1}_${idx + 1}`),
      }));
      pendingSyntheticToolCalls = []; // consume immediately
      console.log(`[v2] SYNTHETIC[${round + 1}]: executing ${syntheticCalls.length} advisor-injected tool calls`);
      sendSSE('info', { message: `Executing ${syntheticCalls.length} synthetic browser step(s)...` });

      // Inject a synthetic assistant message so the message history is coherent
      const syntheticAssistant = {
        role: 'assistant',
        content: null,
        tool_calls: syntheticCalls,
      };
      messages.push(syntheticAssistant);

      let roundHadProgressSynthetic = false;
      for (const call of syntheticCalls) {
        const toolCallId = String((call as any)?.id || '').trim();
        const toolName = call.function?.name || 'unknown';
        const toolArgs = normalizeToolArgsForTool(toolName, call.function?.arguments);
        console.log(`[v2] SYNTHETIC TOOL: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`);
        markProgressStepStart(toolName);
        sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1, synthetic: true });

        const preObservationContext = await captureObservationPreContext(toolName, toolArgs);
        const toolResult = await executeTool(toolName, toolArgs, workspacePath, buildExecuteToolDeps(), sessionId);
        allToolResults.push(toolResult);
        logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
        trackFileOpMutation(toolName, toolArgs, toolResult, 'secondary');
        if (!toolResult.error) roundHadProgressSynthetic = true;
        markProgressStepResult(!toolResult.error, toolName);

        orchestrationLog.push(
          toolResult.error
            ? `✗ [synthetic] ${toolName}: ${toolResult.result.slice(0, 80)}`
            : `✓ [synthetic] ${toolName}: ${toolResult.result.slice(0, 60)}`
        );
        sendSSE('tool_result', { action: toolName, result: toolResult.result.slice(0, 300), error: toolResult.error, stepNum: allToolResults.length, synthetic: true });

        const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
        const isBrowserTool = isBrowserToolName(toolName);
        const isDesktopTool = isDesktopToolName(toolName);
        // Screenshot always delivers full data (image for OpenAI, rich OCR text for local).
        // Other desktop/browser tools pass their real result text so AI always knows the outcome.
        // Visual screenshot tools also update the advisor packet with the post-action screenshot.
        const isDesktopVisualTool2 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
        const toolMessageContent = (isBrowserTool && multiAgentActive)
          ? buildBrowserAck(toolName, toolResult) + goalReminder
          : (isDesktopTool && isDesktopVisualTool2)
            ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
            : (isDesktopTool)
              ? buildDesktopAck(toolName, toolResult) + goalReminder
              : toolResult.result + goalReminder;
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: toolMessageContent,
        });
        const appliedObservation = await applySharedPostActionObservation(
          toolName,
          toolArgs,
          toolResult,
          preObservationContext,
        );

        if (isBrowserTool && !toolResult.error) {
          browserForcedRetries = 0;
          continuationNudges = 0;
          if (toolName === 'browser_close') {
            browserContinuationPending = false;
            browserAdvisorRoute = null;
            browserAdvisorHintPreview = '';
            resetBrowserAdvisorCollection();
          }
        }
        if (isDesktopTool && !toolResult.error && isDesktopVisualTool2) {
          desktopContinuationPending = false;
        }
        if (!toolResult.error) {
          continuationNudges = 0;
        }
        // Fire advisor after each browser/desktop tool in the synthetic batch
        await maybeRunBrowserAdvisorPass(
          appliedObservation.advisorTriggerToolName,
          appliedObservation.advisorTriggerToolResult,
          appliedObservation.advisorTriggerToolArgs,
          appliedObservation.decision,
          appliedObservation.browserAfterPacket,
        );
        await maybeRunDesktopAdvisorPass(
          appliedObservation.advisorTriggerToolName,
          appliedObservation.advisorTriggerToolResult,
          appliedObservation.decision,
        );
      }

      sendSSE('info', { message: 'Synthetic steps complete.' });
      // Continue to next round — either with fresh LLM gen or another synthetic batch
      continue;
    }

    // ── Secondary-owned FILE_OP: skip Ollama, run verify, return directly ──
    // When secondary has already executed all patch calls there is nothing left
    // for primary to do. Build the reply from what we already know in-memory.
    if (
      fileOpV2Active
      && fileOpOwner === 'secondary'
      && pendingSyntheticToolCalls.length === 0
      && fileOpToolHistory.some(h => isFileMutationTool(h.tool))
    ) {
      // Run verification if triggered
      const verifyDecision = shouldVerifyFileTurn({
        had_create: fileOpHadCreate,
        user_requested_full_template: requestedFullTemplate(message),
        primary_write_lines: fileOpPrimaryWriteLines,
        primary_write_chars: fileOpPrimaryWriteChars,
        had_tool_failure: fileOpHadToolFailure,
        touched_files: Array.from(fileOpTouchedFiles),
        high_stakes_touched: Array.from(fileOpTouchedFiles).some(isHighStakesFile),
      }, fileOpSettings);

      if (verifyDecision.verify) {
        sendSSE('info', { message: `FILE_OP v2: verifier check (${verifyDecision.reasons.join(' | ')}).` });
        maybeSaveFileOpCheckpoint({ phase: 'verify', next_action: 'run secondary verifier' });
        const targetFiles = Array.from(fileOpTouchedFiles);
        const verifier = await callSecondaryFileVerifier({
          userMessage: message,
          operationType: fileOpType as 'FILE_CREATE' | 'FILE_EDIT',
          fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
          recentToolExecutions: fileOpToolHistory.slice(-24).map(h => ({
            tool: h.tool, args: h.args, result: h.result, error: h.error,
          })),
        });
        if (verifier?.verdict === 'FAIL') {
          // Re-enter the repair loop by queuing a secondary patch plan and continuing
          const patchPlan = await callSecondaryFilePatchPlanner({
            userMessage: message,
            operationType: fileOpType as 'FILE_CREATE' | 'FILE_EDIT',
            owner: 'secondary',
            reason: (verifier.reasons || []).join(' | ') || 'verifier fail',
            fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
            verifier,
          });
          if (patchPlan?.tool_calls?.length) {
            pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
              function: { name: tc.tool, arguments: tc.args || {} },
            }));
            maybeSaveFileOpCheckpoint({ phase: 'execute', next_action: 'repair after verify fail' });
            continue; // back to top of round loop — executes repair batch next
          }
        } else if (verifier?.verdict === 'PASS') {
          maybeSaveFileOpCheckpoint({ phase: 'done', next_action: 'verification pass' });
          clearFileOpCheckpoint(sessionId);
        }
      } else {
        maybeSaveFileOpCheckpoint({ phase: 'done', next_action: 'turn complete' });
        clearFileOpCheckpoint(sessionId);
      }

      // Build reply from actual results — no Ollama, no extra AI call
      const createdFiles = fileOpToolHistory
        .filter(h => h.tool === 'create_file' && !h.error)
        .map(h => String(h.args?.filename || h.args?.name || h.args?.path || 'file'));
      const editedFiles = fileOpToolHistory
        .filter(h => isFileMutationTool(h.tool) && h.tool !== 'create_file' && !h.error)
        .map(h => String(h.args?.filename || h.args?.name || h.args?.path || 'file'));
      const failedOps = fileOpToolHistory.filter(h => h.error);

      const parts: string[] = [];
      if (createdFiles.length) parts.push(`Created ${createdFiles.join(', ')}`);
      if (editedFiles.length) parts.push(`Updated ${[...new Set(editedFiles)].join(', ')}`);
      if (failedOps.length) parts.push(`${failedOps.length} operation(s) failed`);
      const finalText = parts.length ? parts.join('. ') + '.' : 'Done.';

      console.log(`[v2] FINAL (secondary-owned): ${finalText}`);
      if (progressState.items.length >= 2) {
        for (const item of progressState.items) {
          if (item.status === 'in_progress') item.status = 'done';
          else if (item.status === 'pending') item.status = 'skipped';
        }
        progressState.activeIndex = -1;
        emitProgressState('finalized');
      }
      const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(finalText);
      return {
        type: 'execute',
        text: finalTextWithSkillOffer,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
      };
    }

    let response: any;
    try {
      // In multi-agent mode, disable thinking for browser ops — the secondary AI
      // holds all context and issues exact directives; the primary just executes.
      // Thinking during browser ops burns the full stall threshold (110s) for no gain.
      const isActiveAutomationOp = multiAgentActive && (
        fileOpType === 'BROWSER_OP'
        || fileOpType === 'DESKTOP_OP'
        || browserContinuationPending
        || browserAdvisorRoute !== null
        || desktopContinuationPending
        || desktopAdvisorRoute !== null
        || allToolResults.some(r =>
          typeof r.name === 'string'
          && (r.name.startsWith('browser_') || r.name.startsWith('desktop_')),
        )
      );
	      const requestedThinkMode = reasoningOptions?.enabled
	        ? (reasoningOptions.level === 'extra_high' ? 'xhigh' : (reasoningOptions.level || 'low'))
	        : undefined;
	      const primaryThinkMode: boolean | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none' =
	        requestedThinkMode || ((multiAgentActive && !isActiveAutomationOp) ? true : false);
	      const emitStreamToken = (chunk: string) => {
	        if (abortSignal?.aborted) return;
	        const text = String(chunk || '');
	        if (text) sendSSE('token', { text });
	      };
	      const emitThinkingToken = (chunk: string, source: 'thinking' | 'reasoning_summary' = 'thinking') => {
	        if (abortSignal?.aborted) return;
	        const text = String(chunk || '');
	        if (!text) return;
	        allThinking += text;
	        sendSSE('thinking_delta', { thinking: text, source });
	      };
	      const generationOverride = resolveProviderModelOverride();
      currentModelCapabilities = resolveCapabilitiesForGenerationOverride(generationOverride);
      tools = buildCurrentTurnTools();
      currentModelSystemBlock = formatCurrentModelSystemBlock(generationOverride);
      if (generationOverride.source === 'turn_override') {
        // ── Local primary switch_model promotion ──────────────────────────────────
        // When primary is a local LLM, the switched cloud model must receive the full
        // v1 Prometheus prompt (buildSystemPrompt('full')) so it operates as complete
        // Prometheus. personalityCtx (already computed above) has the full context.
        // For cloud primaries the existing lightweight switch_model path is unchanged.
        if (!isLocalPrimary && !switchModelPersonalityCtx) {
          switchModelPersonalityCtx = await buildPersonalityContext(
            sessionId,
            workspacePath,
            message,
            executionMode || 'interactive',
            history.length,
            _skillsManager,
            browserVisionModeActive ? new Set(['browser_vision', 'browser']) : undefined,
            teachModeActive ? { profile: 'teach_mode' } : { profile: 'switch_model' },
          );
        }
        if (messages[0]?.role === 'system') messages[0].content = isLocalPrimary
          ? buildSystemPrompt('full')         // cloud model gets complete Prometheus runtime
          : buildSystemPrompt('switch_model'); // cloud primary: existing lightweight path
      } else {
        if (messages[0]?.role === 'system') messages[0].content = buildSystemPrompt('full');
      }
      const generationPromise = ollama.chatWithThinking(messages, 'executor', {
        tools,
        temperature: 0.3,
        num_ctx: 8192,
        num_predict: 4096,
	        think: primaryThinkMode,
	        model: generationOverride.model,
	        provider: generationOverride.provider,
	        onToken: emitStreamToken,
	        onThinking: (chunk: string) => emitThinkingToken(chunk, 'thinking'),
	        onReasoningSummary: (chunk: string) => emitThinkingToken(chunk, 'reasoning_summary'),
	        abortSignal: abortSignal?.signal,
	        usageContext: { sessionId, agentId: 'main' },
	      });

      // ── Preempt watchdog ────────────────────────────────────────────
      if (
        preemptCfg.enabled
        && ollamaProcMgr
        && preemptState.canPreempt(round, preemptCfg.maxPerTurn, preemptCfg.maxPerSession)
      ) {
        const watchdogOutcome = await raceWithWatchdog(
          generationPromise,
          preemptCfg.stallThresholdMs,
          (elapsedMs) => {
            console.log(`[Preempt] Generation stalled at ${Math.round(elapsedMs / 1000)}s — triggering preempt`);
            sendSSE('preempt_start', { elapsed_ms: elapsedMs, threshold_ms: preemptCfg.stallThresholdMs, round });
          },
        );

        if (watchdogOutcome.timedOut) {
          // ── FILE_OP stall: bypass preempt restart entirely, promote immediately ──
          if (
            fileOpV2Active
            && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
            && fileOpOwner === 'primary'
          ) {
            sendSSE('info', {
              message: `FILE_OP v2: stall detected during ${fileOpType} after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s — promoting immediately to secondary (no Ollama restart).`,
            });
            fileOpOwner = 'secondary';
            fileOpPrimaryStallPromoted = true;
            maybeSaveFileOpCheckpoint({
              phase: 'repair',
              next_action: 'stall promotion to secondary patch planning',
            });
            const patchPlan = await callSecondaryFilePatchPlanner({
              userMessage: message,
              operationType: fileOpType,
              owner: fileOpOwner,
              reason: `Primary stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s`,
              fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
              verifier: null,
            });
            if (patchPlan?.tool_calls?.length) {
              pendingSyntheticToolCalls = patchPlan.tool_calls.map((tc: any) => ({
                function: { name: tc.tool, arguments: tc.args || {} },
              }));
              sendSSE('info', {
                message: `FILE_OP v2: queued ${patchPlan.tool_calls.length} secondary patch call(s) after stall promotion.`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'execute secondary synthetic patch batch',
              });
            }
            continue;
          }

          // ── Non-FILE_OP stall: normal preempt restart path ──
          preemptState.recordPreempt(round);
          const sessionPreemptCount = incrementPreemptSessionCount(sessionId);
          sendSSE('info', {
            message: `Preempt: generation stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s. Restarting Ollama... (${sessionPreemptCount}/${preemptCfg.maxPerSession} this session)`,
          });

          const restarted = await ollamaProcMgr.killAndRestart();
          sendSSE('preempt_killed', {
            restarted,
            round,
            preempts_session: sessionPreemptCount,
            preempts_session_cap: preemptCfg.maxPerSession,
          });

          if (!restarted) {
            sendSSE('info', { message: 'Preempt: Ollama did not restart in time. Continuing without rescue.' });
          } else {
            sendSSE('preempt_ready', {
              round,
              preempts_session: sessionPreemptCount,
              preempts_session_cap: preemptCfg.maxPerSession,
            });

            // Fire secondary rescue advisor
            const orchCfgForPreempt = getOrchestrationConfig();
            if (orchCfgForPreempt?.enabled && orchestrationStats.assistCount < orchCfgForPreempt.limits.max_assists_per_session) {
              sendSSE('info', { message: 'Preempt: consulting rescue advisor...' });
              const liveInfoForRescue = getBrowserSessionInfo(sessionId);
              const advice = await callSecondaryAdvisor(
                message,
                orchestrationLog,
                `Generation stalled after ${Math.round(watchdogOutcome.elapsedMs / 1000)}s with no output`,
                'rescue',
                liveInfoForRescue.active ? {
                  active: true,
                  title: liveInfoForRescue.title,
                  url: liveInfoForRescue.url,
                  totalCollected: browserAdvisorCollectedFeed.length,
                } : undefined,
                buildSecondaryAssistContext(),
              );
              if (advice) {
                const hint = formatAdvisoryHint(advice);
                const stats = recordOrchestrationEvent(
                  sessionId,
                  { trigger: 'auto', reason: 'preempt_stall', mode: 'rescue' },
                  orchCfgForPreempt,
                );
                sendSSE('preempt_rescue', {
                  round,
                  assist_count: stats.assistCount,
                  assist_cap: orchCfgForPreempt.limits.max_assists_per_session,
                });
                messages.push({ role: 'user', content: hint });
                messages.push({ role: 'assistant', content: 'Understood. Acting immediately.' });
              }
            }

            // Inject strict nudge and retry — model just woke up fresh
            // Re-inject live browser state so model doesn't re-open an already-open browser
            const liveInfoForRetry = getBrowserSessionInfo(sessionId);
            const browserRetryReminder = liveInfoForRetry.active
              ? multiAgentActive
                ? `\n\nCRITICAL: Browser is ALREADY OPEN at "${liveInfoForRetry.url || 'current page'}". ` +
                  `Do NOT call browser_open. Call browser_snapshot so the secondary AI can analyze and tell you what to do next.`
                : `\n\nCRITICAL: Browser is ALREADY OPEN at "${liveInfoForRetry.url || 'current page'}". ` +
                  `Do NOT call browser_open again. Use browser_snapshot to see the current page.`
              : '';
            messages.push({
              role: 'user',
              content: `Your last generation was interrupted. Do NOT think or plan. Call the next tool immediately. If no tool is needed, reply in 1 sentence.${browserRetryReminder}`,
            });
            sendSSE('preempt_retry', { round });
            sendSSE('info', { message: 'Preempt: retrying with rescue context...' });
          }
          // Re-run this round from the top with the fresh Ollama instance
          continue;
        }

        // Generation finished before watchdog
	        const result = watchdogOutcome.result;
	        response = result.message;
	        if (result.thinking) {
	          console.log(`[v2] THINK (${result.thinking.length} chars): ${result.thinking.slice(0, 150)}...`);
	          if (!allThinking.includes(result.thinking)) {
	            allThinking += (allThinking ? '\n\n' : '') + result.thinking;
	            sendSSE('thinking', { thinking: result.thinking });
	          }
	        }
	      } else {
        // Watchdog not active — normal await
        const result = await generationPromise;
	        response = result.message;
	        if (result.thinking) {
	          console.log(`[v2] THINK (${result.thinking.length} chars): ${result.thinking.slice(0, 150)}...`);
	          if (!allThinking.includes(result.thinking)) {
	            allThinking += (allThinking ? '\n\n' : '') + result.thinking;
	            sendSSE('thinking', { thinking: result.thinking });
	          }
	        }
	      }

      const explicitThink = stripExplicitThinkTags(response?.content || '');
      if (explicitThink.thinking) {
        console.log(`[v2] TAG THINK (${explicitThink.thinking.length} chars): ${explicitThink.thinking.slice(0, 150)}...`);
        allThinking += (allThinking ? '\n\n' : '') + explicitThink.thinking;
        sendSSE('thinking', { thinking: explicitThink.thinking });
      }
      if (String(response?.content || '') !== explicitThink.cleaned) {
        response.content = explicitThink.cleaned;
      }
    } catch (err: any) {
      console.error('[v2] Chat error:', err.message);
      return { type: 'chat', text: `Error: ${err.message}` };
    }

    let toolCalls = response.tool_calls;

    // Auto-recover: if model wrote a tool call as text instead of using the tool mechanism
    if ((!toolCalls || toolCalls.length === 0) && response.content) {
      const textToolMatch = response.content.match(/"action"\s*:\s*"(\w+)"\s*,\s*"action_input"\s*:\s*(\{[^}]+\})/s)
        || response.content.match(/"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})/s);
      if (textToolMatch) {
        const toolName = textToolMatch[1];
        try {
          const toolArgs = JSON.parse(textToolMatch[2]);
          console.log(`[v2] AUTO-RECOVER: Model wrote ${toolName} as text, converting to tool call`);
          const recoveredCallId = `recovered_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
          toolCalls = [{ id: recoveredCallId, type: 'function', function: { name: toolName, arguments: toolArgs } }];
          response.tool_calls = toolCalls;
          response.content = '';
        } catch { /* JSON parse failed, treat as normal text */ }
      }
    }

    // Auto-recover: if model dumped pure reasoning without calling any tools on a
    // question that clearly needs tools (search, file, browser), re-prompt once
    if ((!toolCalls || toolCalls.length === 0) && response.content && round === 0 && allToolResults.length === 0) {
      const content = response.content;
      const looksLikeReasoning = content.length > 300
        && (/\b(let me|I need to|I should|the user|first,|wait,|hmm|the rules say)\b/i.test(content));
      const queryNeedsTools = /\b(search|find|look up|latest|news|info|open|browse|navigate|visit|click|type|fill|what happened|desktop|screen|window|vscode|vs code|codex|clipboard)\b/i.test(message);
      const browserAutomationRequest = isBrowserAutomationRequest(message);
      const desktopAutomationRequest = isDesktopAutomationRequest(message);
      const looksLikeRefusal = looksLikeSafetyRefusal(content);
      if (queryNeedsTools && (looksLikeReasoning || looksLikeRefusal)) {
        console.log(`[v2] AUTO-RECOVER: Model dumped ${content.length} chars of reasoning instead of calling tools. Re-prompting...`);
        allThinking += (allThinking ? '\n\n' : '') + content;
        sendSSE('thinking', { thinking: content.slice(0, 500) + '...' });
        // Inject a forceful nudge and retry this round
        if (browserAutomationRequest) {
          const liveBrowser = getBrowserSessionInfo(sessionId);
          const explicitUrl = extractLikelyUrl(message);
          messages.push({ role: 'assistant', content: 'Understood. Executing browser automation now.' });
          if (liveBrowser.active) {
            messages.push({
              role: 'user',
              content: 'Use browser_snapshot now. Then continue with browser_click/browser_fill/browser_press_key to complete the user request. Do NOT refuse.',
            });
          } else if (explicitUrl) {
            messages.push({
              role: 'user',
              content: `Use browser_open now with url="${explicitUrl}". This is explicitly user-authorized local automation. Then continue with browser_snapshot/browser_fill/browser_press_key as needed. Do NOT refuse.`,
            });
          } else {
            messages.push({
              role: 'user',
              content: 'Call browser_open now using the target site from the user request. Then continue with browser_snapshot/browser_click/browser_fill to complete the task. Do NOT refuse.',
            });
          }
          sendSSE('info', { message: 'Re-prompting model to execute browser automation...' });
        } else if (desktopAutomationRequest) {
          messages.push({ role: 'assistant', content: 'Understood. Checking desktop state now.' });
          messages.push({
            role: 'user',
            content: 'Use desktop_screenshot now. If VS Code or another app must be targeted, use desktop_focus_window first, then continue with desktop_click/desktop_type/desktop_press_key as needed. Do NOT refuse.',
          });
          sendSSE('info', { message: 'Re-prompting model to execute desktop automation...' });
        } else {
          messages.push({ role: 'assistant', content: 'Let me search for that now.' });
          messages.push({ role: 'user', content: 'Yes, use the web_search tool right now. Do NOT think or plan — just call web_search.' });
          sendSSE('info', { message: 'Re-prompting model to use tools...' });
        }
        continue; // retry this round
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      const { reply, thinking: inlineThinking } = separateThinkingFromContent(response.content || '');
      if (inlineThinking) {
        console.log(`[v2] INLINE REASONING (${inlineThinking.length} chars): ${inlineThinking.slice(0, 100)}...`);
        allThinking += (allThinking ? '\n\n' : '') + inlineThinking;
        sendSSE('thinking', { thinking: inlineThinking });
      }

      const rawAssistantText = String(response.content || '').trim();
      const candidateText = String(reply || rawAssistantText || '').trim();
      const manualPlanHasOpenSteps =
        progressState.manualStepAdvance
        && progressState.items.length >= 2
        && getProgressRemaining() > 0;
      const isExecutionTurn =
        preflightRoute === 'primary_with_plan'
        || allToolResults.length > 0
        || isExecutionLikeRequest(message)
        || pendingExecutionFromHistory;
      const lastToolFailed = allToolResults.length > 0 && allToolResults[allToolResults.length - 1].error;
      const shouldContinueInsteadOfFinalizing =
        isExecutionTurn
        && continuationNudges < MAX_CONTINUATION_NUDGES
        && !hasConcreteCompletion(candidateText)
        && !isHardBlockerReply(candidateText)
        && (
          looksLikeIntentOnlyReply(candidateText)
          || (continuationCue && candidateText.length < 220)
          || (lastToolFailed && looksLikeIntentOnlyReply(candidateText))
        );

      const shouldForceBrowserRetry =
        orchestrationSkillEnabled
        && browserContinuationPending
        && browserForcedRetries < browserMaxForcedRetries
        && !hasConcreteCompletion(candidateText);
      const shouldForceDesktopRetry =
        orchestrationSkillEnabled
        && desktopContinuationPending
        && continuationNudges < MAX_CONTINUATION_NUDGES
        && !hasConcreteCompletion(candidateText);

      // Declared plans are strict: do not allow a final assistant reply while plan steps remain open.
      // The model must continue executing tools and use complete_plan_step/step_complete to advance.
      // Add nudge cap to prevent infinite loops (mirrors shouldForceBrowserRetry and shouldForceDesktopRetry).
      const shouldForceManualPlanRetry =
        manualPlanHasOpenSteps
        && continuationNudges < MAX_CONTINUATION_NUDGES
        && !isHardBlockerReply(candidateText);

      if (shouldForceManualPlanRetry) {
        continuationNudges++;
        if (
          manualPlanSkillScoutRequired
          && !manualPlanSkillScoutCompleted
          && progressState.manualStepAdvance
          && stepCursor === 0
        ) {
          const guideMsg = declaredPlanSkillScoutBlockMessage();
          console.log(
            `[v2] PLAN POST-CHECK: forcing continuation (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) - skill scout pre-step incomplete`,
          );
          sendSSE('info', {
            message: 'Post-check: continuing - declared-plan skill scout pre-step needs skill_list.',
          });
          if (candidateText) {
            messages.push({ role: 'assistant', content: candidateText });
          }
          messages.push({
            role: 'user',
            content: guideMsg,
          });
          continue;
        }
        const currentStepIndex = progressState.items.findIndex(
          (i) => i.status === 'in_progress' || i.status === 'pending',
        );
        const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
        const currentStepText = currentStepIndex >= 0
          ? progressState.items[currentStepIndex].text
          : 'Next declared plan step';
        const recentActions = allToolResults
          .slice(-6)
          .map((r) => {
            const status = r.error ? '✗' : '✓';
            const preview = String(r.result || '').replace(/\s+/g, ' ').slice(0, 140);
            return `  ${status} ${String(r.name || 'tool')}${preview ? ` — ${preview}` : ''}`;
          })
          .join('\n');
        console.log(
          `[v2] PLAN POST-CHECK: forcing continuation (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) - declared plan has open steps`,
        );
        sendSSE('info', {
          message: `Post-check: continuing — declared plan step ${currentStepNumber} is still incomplete.`,
        });
        // Do not echo a prose-only "I'll do it now" answer into the retry
        // context; that reinforces narration loops instead of tool recovery.
        const planLines: string[] = [];
        for (const item of progressState.items) {
          const icon = item.status === 'done' ? '✓' : item.status === 'in_progress' ? '▶' : item.status === 'failed' ? '✗' : ' ';
          planLines.push(`  [${icon}] ${item.text}`);
        }
        const nextStep = progressState.items.find(i => i.status === 'pending' || i.status === 'in_progress');
        messages.push({
          role: 'user',
          content: [
            'Do not finalize yet: a declared plan is still in progress.',
            '',
            `Current incomplete step: ${currentStepNumber}. ${currentStepText}`,
            '',
            'Plan status:',
            ...planLines,
            '',
            recentActions ? `Recent tool results:\n${recentActions}` : 'Recent tool results: none',
            '',
            'Your previous reply did not call any tools. Do not describe what you will do.',
            'Your next assistant message must contain tool calls only.',
            'Use the available workspace file tools directly: list_directory, read_file, mkdir, create_file, replace_lines, find_replace, file_stats.',
            '',
            nextStep
              ? `Execute the next required action for: ${nextStep.text}.`
              : 'Execute the next required action now.',
            'If that step is now truly complete, call complete_plan_step with concrete evidence in note.',
            'Example: complete_plan_step({"note":"Step 2 done: opened X live search for openclaw/claude and verified non-FYP results."})',
            'Only provide the final answer after all declared steps are completed.',
          ].join('\n'),
        });
        continue;
      }

      if (shouldForceBrowserRetry) {
        browserForcedRetries++;
        const reason = `browser advisor route=${browserAdvisorRoute || 'continue_browser'} requires continued execution`;
        console.log(
          `[v2] BROWSER POST-CHECK: forcing retry (${browserForcedRetries}/${browserMaxForcedRetries}) - ${reason}`,
        );
        sendSSE('forced_retry', {
          reason,
          retry: browserForcedRetries,
          max_retries: browserMaxForcedRetries,
          route: browserAdvisorRoute,
        });
        sendSSE('info', {
          message: `Browser post-check: continuing execution (${browserForcedRetries}/${browserMaxForcedRetries}).`,
        });
        const preview = browserAdvisorHintPreview ? `Advisor hint: ${browserAdvisorHintPreview}` : '';
        messages.push({
          role: 'user',
          content:
            `${preview}\nDo not stop. Call the next browser tool now and continue execution. If more feed coverage is needed, use browser_press_key with PageDown then browser_wait then browser_snapshot.`,
        });
        continue;
      }

      if (shouldForceDesktopRetry) {
        continuationNudges++;
        const reason = `desktop advisor route=${desktopAdvisorRoute || 'continue_desktop'} requires continued execution`;
        console.log(
          `[v2] DESKTOP POST-CHECK: forcing retry (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) - ${reason}`,
        );
        sendSSE('info', {
          message: `Desktop post-check: continuing execution (${continuationNudges}/${MAX_CONTINUATION_NUDGES}).`,
        });
        const preview = desktopAdvisorHintPreview ? `Advisor hint: ${desktopAdvisorHintPreview}` : '';
        messages.push({
          role: 'user',
          content: `${preview}\nDo not stop. Call the next desktop tool now. If the UI likely changed or the outcome is ambiguous, use desktop_screenshot again.`,
        });
        continue;
      }

      if (shouldContinueInsteadOfFinalizing) {
        continuationNudges++;
        const nudgeReason = lastToolFailed
          ? 'last tool failed'
          : 'intent-only response with no tool execution';
        console.log(`[v2] ORCH POST-CHECK: forcing continuation (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) — ${nudgeReason}`);
        sendSSE('info', {
          message: `Post-check: continuing (${continuationNudges}/${MAX_CONTINUATION_NUDGES}) — ${nudgeReason}.`,
        });

        // Build context-rich nudge: original request + what was done + what's next
        const recentActions = allToolResults
          .slice(-4)
          .map((r, i) => {
            const status = r.error ? '✗' : '✓';
            const preview = String(r.result || '').slice(0, 120).replace(/\n/g, ' ');
            return `  ${status} ${String(r.name || 'tool')}${
              r.error ? ` — ERROR: ${preview}` : (preview ? ` — ${preview}` : '')
            }`;
          })
          .join('\n');

        // If there's a declared plan, include its current state
        const planLines: string[] = [];
        if (progressState.items.length >= 2) {
          for (const item of progressState.items) {
            const icon = item.status === 'done' ? '✓' : item.status === 'in_progress' ? '►' : item.status === 'failed' ? '✗' : ' ';
            planLines.push(`  [${icon}] ${item.text}`);
          }
        }

        const nudgeParts: string[] = [
          `You described an intention but called no tools. You must act now.`,
          ``,
          `Original request: "${message.slice(0, 200)}"`,
        ];
        if (planLines.length > 0) {
          nudgeParts.push(``, `Plan status:`, ...planLines);
        }
        if (recentActions) {
          nudgeParts.push(``, `Last actions taken:`, recentActions);
        }
        if (lastToolFailed) {
          nudgeParts.push(``, `Your last tool call FAILED. Inspect the error above, correct the parameters, and retry.`);
        } else {
          const nextStep = progressState.items.find(i => i.status === 'pending' || i.status === 'in_progress');
          nudgeParts.push(
            ``,
            nextStep
              ? `Next step: ${nextStep.text} — call the tool now.`
              : `Call the next required tool now. Do not explain — execute.`,
          );
        }
        if (executionMode === 'cron' || executionMode === 'background_task' || executionMode === 'proposal_execution' || executionMode === 'background_agent' || executionMode === 'team_manager' || executionMode === 'team_subagent') {
          nudgeParts.push(`Filesystem: list_directory(path="."), read_file, create_file, replace_lines, find_replace, mkdir. Never use path="".`);
        }

        messages.push({ role: 'user', content: nudgeParts.join('\n') });
        continue;
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpToolHistory.some(h => isFileMutationTool(h.tool))
      ) {
        const verifyDecision = shouldVerifyFileTurn({
          had_create: fileOpHadCreate,
          user_requested_full_template: requestedFullTemplate(message),
          primary_write_lines: fileOpPrimaryWriteLines,
          primary_write_chars: fileOpPrimaryWriteChars,
          had_tool_failure: fileOpHadToolFailure,
          touched_files: Array.from(fileOpTouchedFiles),
          high_stakes_touched: Array.from(fileOpTouchedFiles).some(isHighStakesFile),
        }, fileOpSettings);

        if (verifyDecision.verify) {
          sendSSE('info', {
            message: `FILE_OP v2: verifier check (${verifyDecision.reasons.join(' | ')}).`,
          });
          maybeSaveFileOpCheckpoint({
            phase: 'verify',
            next_action: 'run secondary verifier',
          });

          const runVerifier = async () => {
            const targetFiles = (() => {
              const direct = Array.from(fileOpTouchedFiles);
              if (direct.length) return direct;
              const fromHistory = fileOpToolHistory
                .map(h => extractFileToolTarget(h.tool, h.args))
                .filter(Boolean);
              return Array.from(new Set(fromHistory));
            })();
            return callSecondaryFileVerifier({
              userMessage: message,
              operationType: fileOpType,
              fileSnapshots: collectFileSnapshots(workspacePath, targetFiles),
              recentToolExecutions: fileOpToolHistory.slice(-24).map(h => ({
                tool: h.tool,
                args: h.args,
                result: h.result,
                error: h.error,
              })),
            });
          };

          let verifier = await runVerifier();
          if (verifier?.verdict === 'PASS') {
            maybeSaveFileOpCheckpoint({
              phase: 'done',
              next_action: 'verification pass',
            });
            clearFileOpCheckpoint(sessionId);
          } else if (verifier?.verdict === 'FAIL') {
            let delegatePrimaryMicroFix = false;
            let reasonForPatch = (verifier.reasons || []).join(' | ') || 'verifier fail';
            let latestVerifier: typeof verifier | null = verifier;
            let noProgressEscalations = 0;

            while (latestVerifier && latestVerifier.verdict === 'FAIL') {
              const failureSig = buildFailureSignature(latestVerifier as any);
              const smallFix = isSmallSuggestedFix(latestVerifier as any, fileOpSettings);
              const previousPatchSig = fileOpPatchSignatures[fileOpPatchSignatures.length - 1] || 'none';
              const progress = fileOpWatchdog.record({
                failure_signature: failureSig,
                patch_signature: previousPatchSig,
                large_patch: !smallFix,
              });
              fileOpLastFailureSignature = failureSig;
              if (progress.no_progress) {
                noProgressEscalations++;
                // Escalation ladder — each level changes strategy, not just intensity:
                // Level 1: Broaden patch scope, rewrite the broken section
                // Level 2: Regenerate the entire file from scratch using original prompt + accumulated findings
                // Level 3: Switch actor — force primary micro-fix attempt if fix is plausibly small
                // Level 4+: Re-derive requirements checklist and verify full spec coverage
                if (noProgressEscalations === 1) {
                  reasonForPatch = `ESCALATION L1 (no progress on sig=${failureSig}): Broaden patch scope. Do NOT make the same targeted fix again. Rewrite the entire broken section from scratch using the original requirements and verifier findings.`;
                } else if (noProgressEscalations === 2) {
                  reasonForPatch = `ESCALATION L2 (still no progress): Regenerate the ENTIRE file from scratch. Use the original user prompt, all accumulated verifier findings, and current constraints. Do not attempt another targeted patch.`;
                } else if (noProgressEscalations === 3) {
                  // Switch actor: force primary micro-fix regardless of smallFix gating
                  reasonForPatch = `ESCALATION L3: Switching actor to primary for a targeted micro-fix attempt.`;
                  sendSSE('info', {
                    message: `FILE_OP v2: no-progress watchdog L3 — switching actor to primary micro-fix.`,
                  });
                  delegatePrimaryMicroFix = true;
                } else {
                  reasonForPatch = `ESCALATION L${noProgressEscalations} (requirements re-derivation): Re-derive the full requirements checklist from the original user prompt. List every requirement explicitly, then verify which are missing or broken. Patch only what the checklist shows is unmet.`;
                }
                sendSSE('info', {
                  message: `FILE_OP v2: no-progress watchdog triggered (level ${noProgressEscalations}); escalating repair strategy.`,
                });
              }

              maybeSaveFileOpCheckpoint({
                phase: 'repair',
                next_action: progress.no_progress
                  ? `escalate repair strategy L${noProgressEscalations} (no progress watchdog)`
                  : 'repair current verifier findings',
                findings: latestVerifier.findings || [],
              });

              if (delegatePrimaryMicroFix) break;

              if (smallFix) {
                delegatePrimaryMicroFix = true;
                break;
              }

              fileOpOwner = 'secondary';
              const patchPlan = await callSecondaryFilePatchPlanner({
                userMessage: message,
                operationType: fileOpType,
                owner: fileOpOwner,
                reason: reasonForPatch,
                fileSnapshots: collectFileSnapshots(workspacePath, Array.from(fileOpTouchedFiles)),
                verifier: latestVerifier,
              });

              if (!patchPlan?.tool_calls?.length) {
                sendSSE('info', {
                  message: 'FILE_OP v2: secondary patch planner returned no executable calls; switching to primary micro-fix attempt.',
                });
                delegatePrimaryMicroFix = true;
                break;
              }

              const applied = await executeSecondaryPatchCalls(
                patchPlan.tool_calls,
                progress.no_progress ? 'watchdog escalation' : 'verifier repair',
              );
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: applied.ran > 0 ? 'secondary patch batch applied' : 'secondary patch batch empty',
              });

              latestVerifier = await runVerifier();
              if (latestVerifier?.verdict === 'PASS') {
                maybeSaveFileOpCheckpoint({
                  phase: 'done',
                  next_action: 'verification pass after secondary repair',
                });
                clearFileOpCheckpoint(sessionId);
                break;
              }
              if (!latestVerifier) break;
              reasonForPatch = (latestVerifier.reasons || []).join(' | ') || 'verifier fail after repair';
            }

            if (delegatePrimaryMicroFix) {
              const findingsText = (latestVerifier?.findings || [])
                .slice(0, 3)
                .map((f: any) => `${f.filename || 'file'}:${f.type || 'issue'} expected="${String(f.expected || '').slice(0, 70)}" observed="${String(f.observed || '').slice(0, 70)}"`)
                .join(' | ');
              const failReasons = (latestVerifier?.reasons || []).join(' | ');
              fileOpOwner = 'primary';
              if (candidateText) messages.push({ role: 'assistant', content: candidateText });
              messages.push({
                role: 'user',
                content: `Verifier FAIL (${failReasons || 'unspecified'}). Apply ONLY a minimal tool patch now. Constraints: max ${fileOpSettings.primary_edit_max_lines} changed lines, max ${fileOpSettings.primary_edit_max_chars} chars, max ${fileOpSettings.primary_edit_max_files} file. No refactor, no extra files. Findings: ${findingsText || 'fix request mismatch and re-check.'}`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'primary micro-fix patch requested',
                findings: latestVerifier?.findings || [],
              });
              continue;
            }

            const finalVerifier = await runVerifier();
            if (finalVerifier?.verdict === 'FAIL') {
              const reasons = (finalVerifier.reasons || []).join(' | ') || 'verification failed';
              if (candidateText) messages.push({ role: 'assistant', content: candidateText });
              messages.push({
                role: 'user',
                content: `Verifier still FAIL (${reasons}). Apply the next concrete patch now and continue until it passes.`,
              });
              maybeSaveFileOpCheckpoint({
                phase: 'execute',
                next_action: 'retry after final verifier fail',
                findings: finalVerifier.findings || [],
              });
              continue;
            }
            maybeSaveFileOpCheckpoint({
              phase: 'done',
              next_action: 'verification pass after repair loop',
            });
            clearFileOpCheckpoint(sessionId);
          } else {
            sendSSE('info', {
              message: 'FILE_OP v2: secondary verifier unavailable; continuing with current result.',
            });
          }
        }
      }

      const requiresWriteNoteBeforeFinal =
        /\bMUST\s+call\s+write_note\b/i.test(message)
        && tools.some((t: any) => String(t?.function?.name || '').trim() === 'write_note')
        && !allToolResults.some((r) => String(r.name || '').trim() === 'write_note' && !r.error);

      if (requiresWriteNoteBeforeFinal && writeNoteFinalizationGuard < MAX_WRITE_NOTE_FINALIZATION_GUARD) {
        writeNoteFinalizationGuard++;
        console.log('[v2] FINALIZATION BLOCKED: required write_note was not called before final response');
        sendSSE('info', {
          message: 'Post-check: continuing so the required write_note can be recorded.',
        });
        if (candidateText) {
          messages.push({ role: 'assistant', content: candidateText });
        }
        messages.push({
          role: 'user',
          content: [
            'Do not finalize yet: the current task explicitly requires a write_note call before completion.',
            'The write_note tool is available in this runtime.',
            '',
            'Call write_note now with tag "last_run_insight" and a brief 1-2 sentence reflection about this scheduled run.',
            'Do not claim write_note is unavailable. Do not call any other tool unless write_note fails.',
            'After write_note succeeds, repeat the user-facing final summary without adding an operational blocker about write_note.',
          ].join('\n'),
        });
        continue;
      }

      // ── Final safeguard: block finalization if declared plan has open steps
      // This prevents the AI from stopping when manualPlanHasOpenSteps is true.
      // Capped at MAX_PLAN_FINALIZATION_GUARD to prevent infinite loops when the model
      // stops calling tools (e.g. after exhausting continuation nudges).
      if (manualPlanHasOpenSteps && planFinalizationGuard < MAX_PLAN_FINALIZATION_GUARD) {
        planFinalizationGuard++;
        const currentStepIndex = progressState.items.findIndex(
          (i) => i.status === 'in_progress' || i.status === 'pending',
        );
        const currentStepNumber = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
        const currentStepText = currentStepIndex >= 0
          ? progressState.items[currentStepIndex].text
          : 'Next declared plan step';
        console.log(
          `[v2] FINALIZATION BLOCKED: declared plan step ${currentStepNumber} ("${currentStepText}") still incomplete (guard ${planFinalizationGuard}/${MAX_PLAN_FINALIZATION_GUARD})`,
        );
        sendSSE('info', {
          message: `ERROR: Plan step ${currentStepNumber} is still incomplete. You cannot finalize. Complete the step using available tools.`,
        });
        messages.push({
          role: 'user',
          content: [
            `CRITICAL: You must complete plan step ${currentStepNumber}: "${currentStepText}"`,
            '',
            'Your previous reply attempted to finalize or narrated intent without tool calls.',
            'Do not answer in prose. Your next assistant message must contain tool calls only.',
            'Use the workspace file tools directly: list_directory, read_file, mkdir, create_file, replace_lines, find_replace, file_stats.',
            'After the step is actually complete, call complete_plan_step with concrete evidence.',
          ].join('\n'),
        });
        continue;
      }

      // If model dumped massive reasoning with no usable reply, generate a fallback
      let finalText = sanitizeFinalReply(
        String(reply || rawAssistantText || ''),
        { preflightReason: preflightReasonForTurn },
      );
      if (!finalText || finalText.length < 5) {
        if (allToolResults.length > 0) {
          // Build a meaningful auto-summary from what the tools actually did
          // instead of just saying 'Done!' which gives no useful information.
          const lastResult = allToolResults[allToolResults.length - 1];
          if (lastResult.error) {
            finalText = `Tool failed: ${lastResult.result.slice(0, 200)}`;
          } else {
            // Summarize the last few tool calls into a compact completion statement
            const actionSummary = allToolResults
              .filter(r => !r.error)
              .slice(-6)
              .map(r => {
                const name = String(r.name || 'tool');
                const args = r.args || {};
                // Extract the most meaningful arg per tool type
                if (name === 'create_file' || name === 'write') {
                  return args.filename || args.name || args.path || name;
                }
                if (name === 'replace_lines' || name === 'find_replace' || name === 'insert_after' || name === 'delete_lines') {
                  return `edited ${args.filename || args.name || 'file'}`;
                }
                if (name === 'web_fetch' || name === 'web_search') {
                  return `searched`;
                }
                if (name === 'browser_open') {
                  return `opened ${String(args.url || '').slice(0, 50)}`;
                }
                // For other tools just use the result preview
                return String(r.result || '').slice(0, 80).replace(/\n/g, ' ');
              })
              .filter(Boolean);
            const uniqueActions = Array.from(new Set(actionSummary));
            finalText = uniqueActions.length > 0
              ? `Done. ${uniqueActions.join(', ')}.`
              : `Completed ${allToolResults.length} step${allToolResults.length !== 1 ? 's' : ''}.`;
          }
        } else {
          finalText = 'Hey! How can I help?';
        }
      }
      if (greetingLikeTurn && finalText.length > 220) {
        finalText = finalText.split(/\n+/)[0].slice(0, 220).trim();
      }
      finalText = sanitizeFinalReply(finalText, { preflightReason: preflightReasonForTurn }) || 'Hey! How can I help?';
      console.log(`[v2] FINAL: ${finalText.slice(0, 150)}`);
      if (progressState.items.length >= 2) {
        for (const item of progressState.items) {
          if (item.status === 'in_progress') item.status = 'done';
          else if (item.status === 'pending') item.status = 'skipped';
        }
        progressState.activeIndex = -1;
        emitProgressState('finalized');
      }

      if (fileOpV2Active) {
        maybeSaveFileOpCheckpoint({
          phase: 'done',
          next_action: 'turn complete',
        });
        clearFileOpCheckpoint(sessionId);
      }

      // ── Background agent finalization gate ───────────────────────────────────
	      // Collect all background_spawn IDs from this turn, join them, and merge
	      // their results without starting another foreground model request.
      const spawnedBgRuns: Array<{ id: string; timeoutMs?: number }> = allToolResults
        .filter((r) => r.name === 'background_spawn' && !r.error)
        .map((r) => {
          try {
            const parsed = JSON.parse(r.result);
            const id = String(parsed?.id || '').trim();
            if (!id) return null;
            const timeoutMs = Number(parsed?.timeoutMs);
            return {
              id,
              timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ id: string; timeoutMs?: number }>;
      const spawnedBgIds = spawnedBgRuns.map((run) => run.id);

      if (spawnedBgRuns.length > 0) {
        sendSSE('info', { message: `Waiting for ${spawnedBgRuns.length} background agent${spawnedBgRuns.length > 1 ? 's' : ''} to complete...` });
        const joinedResults = await Promise.all(
          spawnedBgRuns.map((run) => backgroundJoin({ backgroundId: run.id, joinPolicy: 'wait_all', timeoutMs: run.timeoutMs }))
        );
        const resultBlocks = joinedResults
          .map((r, i) => {
            if (!r) return null;
            const state = r.state === 'completed' ? '✓' : r.state === 'timed_out' ? '⏱ timed out' : '✗ failed';
            const body = r.state === 'completed' ? (r.result || '(no output)') : (r.error || r.state);
            return `[Background Agent ${spawnedBgIds[i]} — ${state}]\n${body}`;
          })
          .filter(Boolean);
        if (resultBlocks.length > 0) {
	          sendSSE('info', { message: 'Background agents complete - merging results...' });
	          const backgroundText = `Background agent response:\n${resultBlocks.join('\n\n')}`;
	          finalText = [finalText, backgroundText]
	            .map((part) => String(part || '').trim())
	            .filter(Boolean)
	            .join('\n\n');
	          console.log(`[v2] BG MERGE: ${finalText.slice(0, 150)}`);
        }
      }
      // ── End background agent finalization gate ────────────────────────────────

      const finalArtifacts = Array.from(
        new Map(
          allToolResults
            .flatMap((result) => Array.isArray((result as any).artifacts) ? (result as any).artifacts : [])
            .map((artifact: any) => {
              const key = [
                String(artifact?.type || ''),
                String(artifact?.title || ''),
                String(artifact?.path || ''),
                String(artifact?.summary || ''),
              ].join('|');
              return [key, artifact];
            }),
        ).values(),
      );

      const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(finalText);
      finalizeBoundTaskRun(/^\s*ERROR:/i.test(finalTextWithSkillOffer) ? 'failed' : 'complete', finalTextWithSkillOffer);
      return {
        type: allToolResults.length > 0 ? 'execute' : 'chat',
        text: finalTextWithSkillOffer,
        thinking: allThinking || undefined,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        artifacts: finalArtifacts.length > 0 ? finalArtifacts : undefined,
      };
    }

    messages.push(response);

    const batchCreatedFiles = new Set<string>();
    let roundHadProgress = false;
    resetProgressRoundStats();

    for (const call of toolCalls) {
      const toolCallId = String((call as any)?.id || '').trim();
      const toolName = call.function?.name || 'unknown';
      const toolArgs = normalizeToolArgsForTool(toolName, call.function?.arguments);

      // For declared plans, reserve step 1 for skill scouting only.
      // This keeps skill discovery contained to the first step so later steps stay focused.
      if (
        manualPlanSkillScoutRequired
        && !manualPlanSkillScoutCompleted
        && progressState.manualStepAdvance
        && stepCursor === 0
      ) {
        const isSkillScoutTool =
          toolName === 'skill_list'
          || toolName === 'skill_read'
          || toolName === 'request_tool_category'
          || toolName === 'business_context_mode'
          || toolName === 'complete_plan_step'
          || toolName === 'step_complete'
          || toolName === 'declare_plan';
        if (!isSkillScoutTool) {
          const guideMsg = declaredPlanSkillScoutBlockMessage(toolName);
          allToolResults.push({ name: toolName, args: toolArgs, result: guideMsg, error: true });
          logToolCall(workspacePath, toolName, toolArgs, guideMsg, true);
          sendSSE('tool_result', {
            action: toolName,
            result: guideMsg,
            error: true,
            stepNum: allToolResults.length,
          });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: guideMsg,
          });
          continue;
        }
      }

      if (toolName === 'desktop_click') {
        const hasFiniteX = Number.isFinite(Number(toolArgs?.x));
        const hasFiniteY = Number.isFinite(Number(toolArgs?.y));
        if (!hasFiniteX || !hasFiniteY) {
          const blockMsg = 'Blocked desktop_click because it is an actual mouse click tool and requires numeric x and y coordinates. If the target point is not known yet, call desktop_screenshot or desktop_window_screenshot first, then retry with x and y.';
          allToolResults.push({ name: toolName, args: toolArgs, result: blockMsg, error: true });
          logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
          markProgressStepStart(toolName);
          markProgressStepResult(false, toolName);
          sendSSE('tool_result', {
            action: toolName,
            result: blockMsg,
            error: true,
            stepNum: allToolResults.length,
          });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: blockMsg,
          });
          continue;
        }

        if (typeof toolArgs?.modifier === 'string') {
          const requestedModifier = String(toolArgs.modifier || '').toLowerCase().trim();
          const hasValidModifier =
            requestedModifier === 'shift' || requestedModifier === 'ctrl' || requestedModifier === 'alt';
          const userAskedForModifier = /\b(ctrl|control|shift|alt|modifier|cmd\+|command\+)\b/i.test(String(message || ''));
          if (hasValidModifier && !userAskedForModifier) {
            if (toolArgs && typeof toolArgs === 'object') {
              delete (toolArgs as any).modifier;
            }
          }
        }
      }

      // ── Scroll-before-act gate ────────────────────────────────────────────────
      // Block PageDown / browser_scroll on interactive pages when the model hasn't
      // filled or clicked anything yet. This is the #1 cause of the scroll loop bug
      // where the AI scrolls past the X.com composer instead of filling it.
      // Feed/search pages (x_feed, search_results) are exempt — they need scrolling.
      const isScrollAttempt =
        (toolName === 'browser_press_key' && String(toolArgs?.key || '').toLowerCase() === 'pagedown')
        || toolName === 'browser_scroll';
      if (isScrollAttempt && !browserFillOrClickDoneThisTurn) {
        const sessionInfo = getBrowserSessionInfo(sessionId);
        const currentPacket = sessionInfo.active
          ? await getBrowserAdvisorPacket(sessionId, { maxItems: 0, snapshotElements: 10 }).catch(() => null)
          : null;
        const pageType = currentPacket?.page?.pageType || 'generic';
        const isFeedPage = pageType === 'x_feed' || pageType === 'search_results';
        if (!isFeedPage) {
          browserScrollBeforeActCount++;
          if (browserScrollBeforeActCount > SCROLL_BEFORE_ACT_MAX) {
            const lastSnap = currentPacket?.snapshot || '';
            const blockMsg = [
              `SCROLL BLOCKED: You scrolled ${browserScrollBeforeActCount} time(s) without filling or clicking anything.`,
              `This is the scroll-before-act loop bug. The page already shows actionable elements — stop scrolling and act on them.`,
              lastSnap ? `\nCurrent page snapshot (act on these @ref elements NOW):\n${lastSnap.slice(0, 2000)}` : '',
              `\nRequired next action: find the input or button you need and call browser_fill(ref, text) or browser_click(ref) immediately.`,
              `Do NOT call browser_press_key(PageDown), browser_scroll, or browser_snapshot. Act on the snapshot above.`,
            ].filter(Boolean).join(' ');
            console.warn(`[v2] SCROLL-BEFORE-ACT BLOCKED (${browserScrollBeforeActCount}x): ${toolName} on ${pageType} page before any fill/click`);
            sendSSE('info', { message: `Scroll-before-act gate: blocked ${toolName} on non-feed page (${browserScrollBeforeActCount}/${SCROLL_BEFORE_ACT_MAX} allowed before act required).` });
            const blockedResult: ToolResult = { name: toolName, args: toolArgs, result: blockMsg, error: true };
            allToolResults.push(blockedResult);
            logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
            markProgressStepStart(toolName);
            markProgressStepResult(false);
            sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length });
            sendSSE('tool_result', { action: toolName, result: blockMsg.slice(0, 300), error: true, stepNum: allToolResults.length });
            messages.push({ role: 'tool', tool_name: toolName, tool_call_id: toolCallId || undefined, content: blockMsg });
            messages.push({ role: 'user', content: `Scroll blocked. You must call browser_fill or browser_click on a @ref from the snapshot above before scrolling. Stop planning and act now.` });
            continue;
          }
        }
      }
      // Track fills and clicks so the gate knows when it's safe to scroll
      if (toolName === 'browser_fill' || toolName === 'browser_click') {
        browserFillOrClickDoneThisTurn = true;
        browserScrollBeforeActCount = 0;
      }
      // ── End scroll-before-act gate ────────────────────────────────────────────

      const loopSig = `${toolName}:${hashArgs(toolArgs)}`;
      const loopPivotNudge = 'Loop detector: you are looping on this tool, try a different approach or ask the user.';
      const loopCheck = checkLoopDetection(toolName, toolArgs);
      if (loopCheck.state === 'block') {
        const blockMsg = `${loopPivotNudge} Repeated call blocked: ${toolName} with identical arguments has run ${loopCheck.repeats} times (critical threshold ${loopCriticalThreshold}).`;
        console.warn(`[v2] LOOP BLOCK: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) x${loopCheck.repeats}`);
        const blockedResult: ToolResult = {
          name: toolName,
          args: toolArgs,
          result: blockMsg,
          error: true,
        };
        allToolResults.push(blockedResult);
        logToolCall(workspacePath, toolName, toolArgs, blockMsg, true);
        markProgressStepStart(toolName);
        markProgressStepResult(false);
        sendSSE('info', { message: blockMsg });
        sendSSE('tool_result', {
          action: toolName,
          result: blockMsg,
          error: true,
          stepNum: allToolResults.length,
        });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: blockMsg,
        });
        if (!loopBlockNudged.has(loopSig)) {
          loopBlockNudged.add(loopSig);
          messages.push({
            role: 'user',
            content: `${loopPivotNudge} Do not call ${toolName} with the same arguments again this turn.`,
          });
        }
        continue;
      }
      if (loopCheck.state === 'warn') {
        const warnMsg = `${loopPivotNudge} Warning: ${toolName} with identical arguments repeated ${loopCheck.repeats} times (warning threshold ${loopWarningThreshold}).`;
        console.warn(`[v2] LOOP WARN: ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) x${loopCheck.repeats}`);
        sendSSE('info', { message: warnMsg });
        if (!loopWarnNudged.has(loopSig)) {
          loopWarnNudged.add(loopSig);
          messages.push({
            role: 'user',
            content: warnMsg,
          });
        }
      }

      if (isBootStartupTurn && !bootAllowedTools.has(toolName)) {
        const blockMsg = `BOOT mode: "${toolName}" is disabled. Use only list_files and read_file, then provide the startup summary.`;
        console.log(`[v2] BOOT TOOL BLOCKED: ${toolName}`);
        const blockedResult: ToolResult = {
          name: toolName,
          args: toolArgs,
          result: blockMsg,
          error: false,
        };
        allToolResults.push(blockedResult);
        roundHadProgress = true;
        logToolCall(workspacePath, toolName, toolArgs, blockMsg, false);
        markProgressStepStart(toolName);
        markProgressStepResult(true);
        sendSSE('tool_result', {
          action: toolName,
          result: blockMsg,
          error: false,
          stepNum: allToolResults.length,
        });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: blockMsg,
        });
        continue;
	      }

	      if (isHotRestartTurn) {
	        const blockMsg = `HOT RESTART mode: "${toolName}" is disabled. Provide the restart follow-up only.`;
	        console.log(`[v2] HOT RESTART TOOL BLOCKED: ${toolName}`);
	        const blockedResult: ToolResult = {
	          name: toolName,
	          args: toolArgs,
	          result: blockMsg,
	          error: false,
	        };
	        allToolResults.push(blockedResult);
	        roundHadProgress = true;
	        logToolCall(workspacePath, toolName, toolArgs, blockMsg, false);
	        markProgressStepStart(toolName);
	        markProgressStepResult(true);
	        sendSSE('tool_result', {
	          action: toolName,
	          result: blockMsg,
	          error: false,
	          stepNum: allToolResults.length,
	        });
	        messages.push({
	          role: 'tool',
	          tool_name: toolName,
	          tool_call_id: toolCallId || undefined,
	          content: blockMsg,
	        });
	        continue;
	      }

	      if (toolName === 'create_file') {
        const fn = toolArgs.filename || toolArgs.name;
        if (fn && batchCreatedFiles.has(fn)) {
          console.log(`[v2] SKIP: duplicate create_file("${fn}") in same batch`);
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: `${fn} already created in this batch. Use replace_lines to edit.`,
          });
          continue;
        }
        if (fn) batchCreatedFiles.add(fn);
      }

      // browser_* and desktop_* tools are always allowed to repeat — the browser page
      // and the desktop screen change on every call so caching/blocking makes no sense.
      const allowRepeatedTool =
        toolName.startsWith('browser_') || toolName.startsWith('desktop_');
      const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
      if (!allowRepeatedTool) {
        const callCount = (seenToolCalls.get(callKey) ?? 0) + 1;
        seenToolCalls.set(callKey, callCount);
        if (callCount > DUPLICATE_SKIP_THRESHOLD) {
          const cachedResult = canReplayReadOnlyCall(toolName)
            ? cachedReadOnlyToolResults.get(callKey)
            : undefined;
          if (cachedResult) {
            const replayedResult: ToolResult = {
              ...cachedResult,
              args: toolArgs,
            };
            allToolResults.push(replayedResult);
            if (!replayedResult.error) roundHadProgress = true;
            logToolCall(workspacePath, toolName, toolArgs, replayedResult.result, replayedResult.error);
            console.log(`[v2] REPLAY: duplicate ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) [x${callCount}]`);
            markProgressStepStart(toolName);
            markProgressStepResult(!replayedResult.error, toolName);
            sendSSE('tool_result', {
              action: toolName,
              result: replayedResult.result.slice(0, 500),
              error: replayedResult.error,
              stepNum: allToolResults.length,
            });
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: replayedResult.result,
            });
            continue;
          }
          console.log(`[v2] SKIP: duplicate tool call ${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}) [x${callCount}]`);
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: toolName === 'declare_plan'
              ? 'Plan already declared and active. Do NOT call declare_plan again. Proceed immediately with step 1 now.'
              : `Already ran this exact call ${callCount} times. Use the previous result and move on.`,
          });
          continue;
        }
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpOwner === 'secondary'
        && isFileMutationTool(toolName)
      ) {
        sendSSE('info', {
          message: 'FILE_OP v2: secondary-owned turn; replacing primary mutation call with secondary patch plan.',
        });
        const target = extractFileToolTarget(toolName, toolArgs);
        const patchPlan = await callSecondaryFilePatchPlanner({
          userMessage: message,
          operationType: fileOpType,
          owner: fileOpOwner,
          reason: 'secondary-owned execution',
          fileSnapshots: collectFileSnapshots(
            workspacePath,
            target ? [target, ...Array.from(fileOpTouchedFiles)] : Array.from(fileOpTouchedFiles),
          ),
          blockedPrimaryCall: {
            tool: toolName,
            args: toolArgs,
            reason: 'secondary-owned execution',
          },
          verifier: null,
        });
        if (patchPlan?.tool_calls?.length) {
          const applied = await executeSecondaryPatchCalls(patchPlan.tool_calls, 'secondary owner replacement');
          if (applied.ran > 0) roundHadProgress = true;
        } else {
          fileOpHadToolFailure = true;
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: 'FILE_OP v2: secondary planner produced no replacement calls.',
          });
        }
        continue;
      }

      if (
        fileOpV2Active
        && (fileOpType === 'FILE_CREATE' || fileOpType === 'FILE_EDIT')
        && fileOpOwner === 'primary'
        && isFileMutationTool(toolName)
      ) {
        const allowance = canPrimaryApplyFileTool({
          tool_name: toolName,
          args: toolArgs,
          message,
          touched_files: fileOpTouchedFiles,
          settings: fileOpSettings,
        });
        if (!allowance.allowed) {
          fileOpOwner = 'secondary';
          maybeSaveFileOpCheckpoint({
            phase: 'repair',
            next_action: `secondary takeover after gate block: ${allowance.reason}`,
          });
          sendSSE('info', {
            message: `FILE_OP v2 gate: promoted to secondary (${allowance.reason}).`,
          });
          const target = extractFileToolTarget(toolName, toolArgs);
          const snapshots = collectFileSnapshots(
            workspacePath,
            target ? [target, ...Array.from(fileOpTouchedFiles)] : Array.from(fileOpTouchedFiles),
          );
          const patchPlan = await callSecondaryFilePatchPlanner({
            userMessage: message,
            operationType: fileOpType,
            owner: fileOpOwner,
            reason: allowance.reason,
            fileSnapshots: snapshots,
            blockedPrimaryCall: {
              tool: toolName,
              args: toolArgs,
              reason: allowance.reason,
            },
            verifier: null,
          });
          if (patchPlan?.tool_calls?.length) {
            const applied = await executeSecondaryPatchCalls(patchPlan.tool_calls, 'primary threshold gate');
            if (applied.ran > 0) roundHadProgress = true;
            maybeSaveFileOpCheckpoint({
              phase: 'execute',
              next_action: applied.ran > 0 ? 'secondary patch calls applied' : 'no patch calls applied',
            });
            continue;
          }
          fileOpHadToolFailure = true;
          const failText = 'FILE_OP v2: secondary patch planner returned no executable calls.';
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: failText,
          });
          markProgressStepStart(toolName);
          markProgressStepResult(false);
          sendSSE('tool_result', {
            action: toolName,
            result: failText,
            error: true,
            stepNum: allToolResults.length,
            actor: 'secondary',
          });
          continue;
        }
      }

      console.log(`[v2] TOOL[${round + 1}]: ${toolName}(${JSON.stringify(toolArgs).slice(0, 150)})`);
      if (toolName !== 'declare_plan') {
        markProgressStepStart(toolName);
      }
      sendSSE('tool_call', { action: toolName, args: toolArgs, stepNum: allToolResults.length + 1 });

      // ── declare_plan: seed the progress panel and short-circuit (no executeTool needed) ──
      if (toolName === 'declare_plan') {
        const rawSteps = Array.isArray(toolArgs.steps) ? toolArgs.steps : [];
        const steps = rawSteps.map((s: any) => String(s || '').trim()).filter(Boolean);
        const plannedSteps = steps.slice(0, 6);
        if (plannedSteps.length >= 2) {
          seedProgressFromLines(plannedSteps, 'declared', { manualStepAdvance: true });
          stepCursor = 0; // reset cursor whenever a fresh plan is declared
          manualPlanSkillScoutRequired = plannedSteps.length >= 2;
          manualPlanSkillScoutCompleted = false;
          manualPlanSkillListDone = false;
          manualPlanSkillReadCount = 0;
          consecutiveStepFailures = 0;
          console.log(`[v2] declare_plan: seeded ${plannedSteps.length} steps: ${plannedSteps.join(' -> ')}`);
        } else {
          manualPlanSkillScoutRequired = false;
          manualPlanSkillScoutCompleted = false;
          manualPlanSkillListDone = false;
          manualPlanSkillReadCount = 0;
          stepCursor = 0;
          consecutiveStepFailures = 0;
        }
        const planSummary = plannedSteps.length >= 2
          ? `Plan set (${plannedSteps.length} steps): ${plannedSteps.join(' -> ')}`
          : 'Plan acknowledged (no steps provided - proceeding without progress panel).';
        const planArgs = { ...toolArgs, steps: plannedSteps };
        allToolResults.push({ name: toolName, args: planArgs, result: planSummary, error: false });
        sendSSE('tool_result', { action: toolName, result: planSummary, error: false, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: `${planSummary}\n\n${declaredPlanSkillScoutBlockMessage()}`,
        });
        resetProgressRoundStats();
        continue;
      }

      // ── bg_plan_declare: ephemeral background-agent isolated planning ──
      if (toolName === 'bg_plan_declare') {
        const isBgAgentSession = executionMode === 'background_agent' || sessionId.startsWith('background_');
        const rawSteps = Array.isArray(toolArgs?.steps) ? toolArgs.steps : [];
        const steps = rawSteps.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 8);
        const bgSummary = isBgAgentSession
          ? bgPlanDeclare(sessionId, steps)
          : 'ERROR: bg_plan_declare is only valid in background_agent sessions.';
        const bgErr = /^ERROR:/i.test(bgSummary);
        allToolResults.push({ name: toolName, args: toolArgs, result: bgSummary, error: bgErr });
        sendSSE('tool_result', { action: toolName, result: bgSummary, error: bgErr, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: bgSummary,
        });
        markProgressStepResult(!bgErr, toolName);
        resetProgressRoundStats();
        continue;
      }

      // ── bg_plan_advance: ephemeral background-agent isolated plan advancement ──
      if (toolName === 'bg_plan_advance') {
        const isBgAgentSession = executionMode === 'background_agent' || sessionId.startsWith('background_');
        const note = String(toolArgs?.note || '').trim() || undefined;
        const bgSummary = isBgAgentSession
          ? bgPlanAdvance(sessionId, note)
          : 'ERROR: bg_plan_advance is only valid in background_agent sessions.';
        const bgErr = /^ERROR:/i.test(bgSummary);
        allToolResults.push({ name: toolName, args: toolArgs, result: bgSummary, error: bgErr });
        sendSSE('tool_result', { action: toolName, result: bgSummary, error: bgErr, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: bgSummary,
        });
        markProgressStepResult(!bgErr, toolName);
        resetProgressRoundStats();
        continue;
      }

      // ── complete_plan_step / step_complete: advance declared plan step ──
      if (toolName === 'complete_plan_step' || toolName === 'step_complete') {
        const note = String(toolArgs?.note || '').trim();
        const isTaskSession = sessionId.startsWith('task_');
        const completingSkillScoutOnly =
          progressState.manualStepAdvance
          && manualPlanSkillScoutRequired
          && !manualPlanSkillScoutCompleted
          && stepCursor === 0
          && manualPlanSkillListDone;
        let completedSkillScoutOnly = false;
        let completionSummary = note
          ? `Plan step completed: ${note}`
          : 'Plan step completed.';

        if (
          manualPlanSkillScoutRequired
          && !manualPlanSkillScoutCompleted
          && progressState.manualStepAdvance
          && stepCursor === 0
          && !manualPlanSkillListDone
        ) {
          const scoutMsg = declaredPlanSkillScoutBlockMessage(toolName);
          allToolResults.push({ name: toolName, args: toolArgs, result: scoutMsg, error: true });
          sendSSE('tool_result', { action: toolName, result: scoutMsg, error: true, stepNum: allToolResults.length });
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: scoutMsg,
          });
          markProgressStepResult(false, toolName);
          resetProgressRoundStats();
          continue;
        }

        // Task-runner sessions must persist step completion in task-store so
        // background-task-runner can detect the step advancement.
        if (isTaskSession && !completingSkillScoutOnly) {
          const taskId = sessionId.replace(/^task_/, '');
          const liveTask = loadTask(taskId);
          if (!liveTask) {
            const failText = `step_complete failed: task ${taskId} not found`;
            allToolResults.push({ name: toolName, args: toolArgs, result: failText, error: true });
            sendSSE('tool_result', { action: toolName, result: failText, error: true, stepNum: allToolResults.length });
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: failText,
            });
            markProgressStepResult(false, toolName);
            resetProgressRoundStats();
            continue;
          }

          if (liveTask.currentStepIndex >= liveTask.plan.length) {
            completionSummary = 'All plan steps are already complete.';
          } else {
            const completedStep = liveTask.currentStepIndex;
            mutatePlan(taskId, [{
              op: 'complete',
              step_index: completedStep,
              notes: note || undefined,
            }]);

            const nextStep = Math.min(completedStep + 1, liveTask.plan.length);
            if (nextStep < liveTask.plan.length) {
              setTaskStepRunning(taskId, nextStep);
            } else {
              const finalTask = loadTask(taskId);
              if (finalTask) {
                finalTask.currentStepIndex = nextStep;
                finalTask.lastProgressAt = Date.now();
                saveTask(finalTask);
              }
            }

            completionSummary = `Step ${completedStep + 1} completed.${nextStep < liveTask.plan.length ? ` Next: step ${nextStep + 1}.` : ' All steps completed.'}${note ? ` Note: ${note}` : ''}`;
            sendSSE('task_step_done', {
              completedStep,
              nextStep,
              note: note || undefined,
            });
          }
        } else if (!isTaskSession && toolName === 'step_complete') {
          completionSummary = `${completionSummary} (Handled as plan-step completion in interactive chat.)`;
        }

        if (
          manualPlanSkillScoutRequired
          && !manualPlanSkillScoutCompleted
          && progressState.manualStepAdvance
          && stepCursor === 0
          && manualPlanSkillListDone
        ) {
          completionSummary = `Skill scout pre-step completed (skill_list + ${manualPlanSkillReadCount} skill_read call(s)). Declared plan step 1 has NOT advanced; proceed with step 1 now.`;
          manualPlanSkillScoutCompleted = true;
          manualPlanSkillScoutRequired = false;
          manualPlanSkillListDone = false;
          manualPlanSkillReadCount = 0;
          completedSkillScoutOnly = true;
        }

        if (progressState.manualStepAdvance && !completedSkillScoutOnly) {
          advanceProgressStep('step_done');
        }

        allToolResults.push({ name: toolName, args: toolArgs, result: completionSummary, error: false });
        sendSSE('tool_result', { action: toolName, result: completionSummary, error: false, stepNum: allToolResults.length });
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: completionSummary,
        });
        if (!completedSkillScoutOnly) {
          markProgressStepResult(true, toolName);
        }
        resetProgressRoundStats();
        continue;
      }

      if (toolName === 'start_task') {
        const taskGoal = toolArgs.goal || message;
        const maxSteps = toolArgs.max_steps || 25;
        sendSSE('info', { message: `Starting multi-step task: ${taskGoal}` });

        const taskTools = tools.filter((t: any) => t.function.name !== 'start_task') as any[];

        const taskResult = await runTask({
          goal: taskGoal,
          tools: taskTools,
          executor: async (name, args) => {
            const r = await executeTool(name, args, workspacePath, buildExecuteToolDeps(), sessionId);
            return { result: r.result, error: r.error };
          },
          onProgress: sendSSE,
          systemContext: personalityCtx.slice(0, 500),
          maxSteps,
        });
        markProgressStepResult(taskResult.status !== 'failed');
        finalizeProgressRound();

        activeTasks.set(sessionId, taskResult);

        const summary = taskResult.status === 'complete'
          ? `Task completed in ${taskResult.currentStep} steps!`
          : taskResult.status === 'failed'
            ? `Task failed at step ${taskResult.currentStep}: ${taskResult.error}`
            : `Task paused at step ${taskResult.currentStep}/${taskResult.maxSteps}`;

        const journalSummary = taskResult.journal.slice(-5).map(j => j.result).join('\n');

        return {
          type: 'execute',
          text: `${summary}\n\nRecent steps:\n${journalSummary}`,
          thinking: allThinking || undefined,
          toolResults: taskResult.journal.map(j => ({
            name: j.action.split('(')[0],
            args: {},
            result: j.result,
            error: j.result.startsWith('❌'),
          })),
        };
      }

      // ── Sub-agent spawn ────────────────────────────────────────────────────────────────────
      if (toolName === 'subagent_spawn') {
        const isTaskSession = sessionId.startsWith('task_');

        // Determine profile and build child prompt
        const profile = ((toolArgs.profile || 'reader_only') as SubagentProfile);
        const subTitle  = String(toolArgs.task_title || `${profile} sub-agent task`).slice(0, 120);
        const subPrompt = [
          toolArgs.context_snippet ? `[CONTEXT]\n${String(toolArgs.context_snippet).slice(0, 1200)}\n[/CONTEXT]\n\n` : '',
          String(toolArgs.task_prompt || '').trim(),
        ].join('').trim();

        if (!subPrompt) {
          messages.push({
            role: 'tool',
            tool_name: toolName,
            tool_call_id: toolCallId || undefined,
            content: 'Sub-agent spawn failed: no task_prompt provided.',
          });
          markProgressStepResult(false);
          continue;
        }

        // Guard: do not allow sub-agents to spawn more sub-agents (prevent recursion)
        const parentTaskId = isTaskSession ? sessionId.replace(/^task_/, '') : undefined;
        if (parentTaskId) {
          const parentTask = loadTask(parentTaskId);
          if (parentTask?.parentTaskId) {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: 'Sub-agent recursion blocked: sub-agents cannot spawn further sub-agents.',
            });
            markProgressStepResult(false);
            continue;
          }
        }

        const onResumeInstruction =
          `Sub-agent "${subTitle}" has completed. Review the [SUBAGENT RESULT] injected above and continue the parent task.`;
        const parentTask = parentTaskId ? loadTask(parentTaskId) : null;
        const childChannel = parentTask?.channel || inferTaskChannelFromSession(sessionId);

        // Create the child TaskRecord
        const childTask = createTask({
          title: subTitle,
          prompt: subPrompt,
          sessionId: `task_${crypto.randomUUID()}`,
          channel: childChannel,
          plan: [{ index: 0, description: subPrompt.slice(0, 120), status: 'pending' as const }],
          parentTaskId,
          subagentProfile: profile,
          onResumeInstruction,
        });

        // Register child in parent and flip parent to waiting_subagent
        if (parentTaskId) {
          if (parentTask) {
            parentTask.pendingSubagentIds = [...(parentTask.pendingSubagentIds || []), childTask.id];
            parentTask.status = 'waiting_subagent';
            saveTask(parentTask);
          }
        }

        // Spawn the child BackgroundTaskRunner
        const childRunner = new BackgroundTaskRunner(
          childTask.id,
          handleChat,
          makeBroadcastForTask(childTask.id),
          _telegramChannel,
        );
        childRunner.start().catch((err: Error) =>
          console.error(`[SubagentSpawn] Child ${childTask.id} error:`, err.message)
        );

        const ackMsg = `Spawned sub-agent "${subTitle}" (ID: ${childTask.id}, profile: ${profile}). Parent task is paused pending completion.`;

        console.log(`[SubagentSpawn] ${ackMsg}`);
        appendJournal(parentTaskId || childTask.id, { type: 'status_push', content: ackMsg });
        broadcastWS({ type: 'task_subagent_spawned', parentTaskId, childTaskId: childTask.id, subTitle, profile });

        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: ackMsg,
        });
        markProgressStepResult(true);
        // Break out of the tool loop — parent task status is now waiting_subagent,
        // which the BackgroundTaskRunner will detect on its next iteration.
        break;
      }

      // ── Orchestration: explicit request from primary
      if (toolName === 'request_secondary_assist') {
        const orchCfg = getOrchestrationConfig();
        if (orchestrationSkillEnabled && orchCfg?.enabled) {
          if (orchestrationStats.assistCount >= orchCfg.limits.max_assists_per_session) {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: `Secondary advisor session cap reached (${orchCfg.limits.max_assists_per_session}). Continue without escalation.`,
            });
            markProgressStepResult(false);
            continue;
          }

          const mode   = (toolArgs.mode || 'rescue') as 'planner' | 'rescue';
          const reason = toolArgs.reason || 'Explicitly requested by executor';
          sendSSE('info', { message: `Consulting secondary advisor (${mode} mode)...` });
          console.log(`[Orchestrator] Explicit trigger: ${reason}`);
          const advice = await callSecondaryAdvisor(
            message,
            orchestrationLog,
            reason,
            mode,
            undefined,
            buildSecondaryAssistContext(),
          );
          if (advice) {
            const hint = formatAdvisoryHint(advice);
            orchestrationState.markFired(round);
            const stats = recordOrchestrationEvent(
              sessionId,
              { trigger: 'explicit', reason, mode },
              orchCfg,
            );
            sendSSE('orchestration', {
              trigger: 'explicit',
              reason,
              mode,
              advice,
              assist_count: stats.assistCount,
              assist_cap: orchCfg.limits.max_assists_per_session,
            });
            console.log(
              `[Orchestrator] Explicit assist complete (${stats.assistCount}/${orchCfg.limits.max_assists_per_session})`,
            );
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: hint,
            });
            markProgressStepResult(true);
          } else {
            messages.push({
              role: 'tool',
              tool_name: toolName,
              tool_call_id: toolCallId || undefined,
              content: 'Secondary advisor unavailable. Continue with your best judgment.',
            });
            markProgressStepResult(false);
          }
          continue;
        }
        messages.push({
          role: 'tool',
          tool_name: toolName,
          tool_call_id: toolCallId || undefined,
          content: 'Multi-agent orchestration is not enabled.',
        });
        markProgressStepResult(false);
        continue;
      }


	      const preObservationContext = await captureObservationPreContext(toolName, toolArgs);
	      const toolResult = await executeTool(toolName, toolArgs, workspacePath, buildExecuteToolDeps(), sessionId);
      if (
        manualPlanSkillScoutRequired
        && !manualPlanSkillScoutCompleted
        && progressState.manualStepAdvance
        && stepCursor === 0
        && !toolResult.error
      ) {
        if (toolName === 'skill_list') manualPlanSkillListDone = true;
        if (toolName === 'skill_read') manualPlanSkillReadCount++;
      }
      if (canReplayReadOnlyCall(toolName)) cachedReadOnlyToolResults.set(callKey, toolResult);
      // After any write tool, invalidate cached reads for that file so a
      // subsequent read_file gets fresh content instead of the stale cached version.
      if (WRITE_TOOL_NAMES.has(toolName) && !toolResult.error) {
        const writtenFile = String(toolArgs.filename || toolArgs.name || toolArgs.path || '');
        invalidateReadCacheForFile(writtenFile);
      }
      allToolResults.push(toolResult);
      logToolCall(workspacePath, toolName, toolArgs, toolResult.result, toolResult.error);
      trackFileOpMutation(toolName, toolArgs, toolResult, 'primary');
      if (fileOpV2Active && toolResult.error) fileOpHadToolFailure = true;
      if (!toolResult.error) roundHadProgress = true;
      markProgressStepResult(!toolResult.error, toolName);

      // ── Orchestration: track trigger state
      orchestrationState.recordToolResult(round, toolName, toolArgs, toolResult.error);
      orchestrationLog.push(
        toolResult.error
          ? `✗ ${toolName}(${JSON.stringify(toolArgs).slice(0, 60)}): ${toolResult.result.slice(0, 100)}`
          : `✓ ${toolName}(${JSON.stringify(toolArgs).slice(0, 60)}): ${toolResult.result.slice(0, 80)}`
      );

      console.log(toolResult.error ? `[v2] TOOL FAIL: ${toolResult.result.slice(0, 100)}` : `[v2] TOOL OK: ${toolResult.result.slice(0, 100)}`);
		      sendSSE('tool_result', {
		        action: toolName,
		        args: toolArgs,
		        result: toolResult.result.slice(0, 4000),
		        error: toolResult.error,
		        stepNum: allToolResults.length,
		        extra: toolResult.extra,
		      });
      if (toolName === 'switch_model' && !toolResult.error) {
        const switchedModel = getTurnModelOverride(sessionId);
        if (switchedModel?.providerId && switchedModel?.model) {
          sendSSE('model_switched', {
            providerId: switchedModel.providerId,
            model: switchedModel.model,
            reason: switchedModel.reason || String(toolArgs?.reason || '').trim(),
            tier: String(toolArgs?.tier || '').trim().toLowerCase(),
          });
        }
      }
      if (toolName === 'set_agent_model' && !toolResult.error && String(toolArgs?.agent_type || '').trim() === 'main_chat') {
        const modelRef = String(toolArgs?.model || '').trim();
        const slashIdx = modelRef.indexOf('/');
        sendSSE('main_model_changed', {
          providerId: slashIdx > 0 ? modelRef.slice(0, slashIdx) : '',
          model: slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef,
          modelRef,
          source: 'agent_model_defaults.main_chat',
        });
      }
      if (toolName === 'apply_agent_model_template' && !toolResult.error) {
        const modelRef = String((getConfig().getConfig() as any)?.agent_model_defaults?.main_chat || '').trim();
        if (modelRef) {
          const slashIdx = modelRef.indexOf('/');
          sendSSE('main_model_changed', {
            providerId: slashIdx > 0 ? modelRef.slice(0, slashIdx) : '',
            model: slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef,
            modelRef,
            source: 'agent_model_default_template',
          });
        }
      }

      // Only on success, only for file-mutation tools, not during background tasks.
      if (!toolResult.error && executionMode !== 'background_task' && executionMode !== 'proposal_execution' && executionMode !== 'background_agent' && executionMode !== 'cron' && executionMode !== 'team_manager' && executionMode !== 'team_subagent') {
        const FILE_PRESENT_TOOLS = new Set(['create_file', 'write', 'present_file']);
        if (FILE_PRESENT_TOOLS.has(toolName)) {
          const presentPath = toolArgs?.filename || toolArgs?.name || toolArgs?.path || '';
          if (presentPath) {
            // Resolve to absolute path so the AI always gets the exact path
            const absPath = require('path').isAbsolute(presentPath)
              ? presentPath
              : require('path').join(workspacePath, presentPath);
            addCanvasFile(sessionId, absPath);
            sendSSE('canvas_present', { path: String(presentPath), tool: toolName });
          }
        }
      }

      const goalReminder = `\n\n[GOAL REMINDER: Your task is still: "${message.slice(0, 120)}". Stay focused on this goal only.]`;
      // ── Multi-agent browser interception ────────────────────────────────────
      // Screenshot: OpenAI gets actual image, local model gets rich OCR+window text.
      // All other desktop tools: pass real result text so AI always knows the outcome.
      // Browser tools in multi-agent mode: still use ack to avoid token flood from DOM.
      const isBrowserTool = isBrowserToolName(toolName);
      const isDesktopTool = isDesktopToolName(toolName);
      // Visual screenshot tools end with a screenshot stored in the advisor packet.
      // Give vision-capable primaries the actual PNG so they can see the post-action state.
      const isDesktopVisualTool3 = toolName === 'desktop_screenshot' || toolName === 'desktop_window_screenshot';
      const toolMessageContent = (isBrowserTool && multiAgentActive)
        ? buildBrowserAck(toolName, toolResult) + goalReminder
        : (isDesktopTool && isDesktopVisualTool3)
          ? buildDesktopScreenshotContent(toolResult, sessionId, goalReminder)
          : (isDesktopTool)
            ? buildDesktopAck(toolName, toolResult) + goalReminder
            : toolResult.result + goalReminder;
	      messages.push({
	        role: 'tool',
	        tool_name: toolName,
	        tool_call_id: toolCallId || undefined,
	        content: toolMessageContent,
	      });
      if (toolName === 'request_tool_category' && !toolResult.error) {
        const previousNames = new Set(
          tools
            .map((t: any) => String(t?.function?.name || '').trim())
            .filter(Boolean),
        );
        tools = buildCurrentTurnTools();
        const newlyAvailable = tools
          .map((t: any) => String(t?.function?.name || '').trim())
          .filter((name: string) => name && !previousNames.has(name));
        const refreshMessage = newlyAvailable.length > 0
          ? `Tool schemas refreshed for this turn. Newly available: ${newlyAvailable.slice(0, 12).join(', ')}${newlyAvailable.length > 12 ? `, and ${newlyAvailable.length - 12} more` : ''}.`
          : 'Tool schemas refreshed for this turn.';
        sendSSE('info', { message: refreshMessage });
        messages.push({
          role: 'user',
          content: `[SYSTEM: ${refreshMessage} Continue the user's original task using the newly available tools when relevant.]`,
        });
      }
	      const appliedObservation = await applySharedPostActionObservation(
	        toolName,
	        toolArgs,
	        toolResult,
	        preObservationContext,
	      );

      if (isBrowserTool && !toolResult.error) {
        browserForcedRetries = 0;
        continuationNudges = 0;
        if (toolName === 'browser_close') {
          browserContinuationPending = false;
          browserAdvisorRoute = null;
          browserAdvisorHintPreview = '';
          resetBrowserAdvisorCollection();
        }
      }
      if (isDesktopTool && !toolResult.error && isDesktopVisualTool3) {
        desktopContinuationPending = false;
      }
      if (!toolResult.error) {
        continuationNudges = 0;
      }
	      await maybeRunBrowserAdvisorPass(
	        appliedObservation.advisorTriggerToolName,
	        appliedObservation.advisorTriggerToolResult,
	        appliedObservation.advisorTriggerToolArgs,
	        appliedObservation.decision,
	        appliedObservation.browserAfterPacket,
	      );
	      await maybeRunDesktopAdvisorPass(
	        appliedObservation.advisorTriggerToolName,
	        appliedObservation.advisorTriggerToolResult,
	        appliedObservation.decision,
	      );

    }

    finalizeProgressRound();

    // ── Orchestration: auto-trigger check after each round
    const orchCfg = getOrchestrationConfig();
    if (orchestrationSkillEnabled && orchCfg?.enabled && !isBootStartupTurn) {
      if (!roundHadProgress) orchestrationState.recordRoundNoProgress(round);
      const { fire, reason } = orchestrationState.shouldTrigger(
        orchCfg,
        round,
        Date.now(),
        orchestrationStats.assistCount,
      );
      if (fire && orchestrationStats.assistCount < orchCfg.limits.max_assists_per_session) {
        sendSSE('info', { message: `Auto-consulting advisor: ${reason}` });
        console.log(`[Orchestrator] Auto-trigger (${reason})`);
        const advice = await callSecondaryAdvisor(
          message,
          orchestrationLog,
          reason,
          'rescue',
          undefined,
          buildSecondaryAssistContext(),
        );
        if (advice) {
          const hint = formatAdvisoryHint(advice);
          orchestrationState.markFired(round);
          const stats = recordOrchestrationEvent(
            sessionId,
            { trigger: 'auto', reason, mode: 'rescue' },
            orchCfg,
          );
          sendSSE('orchestration', {
            trigger: 'auto',
            reason,
            mode: 'rescue',
            advice,
            assist_count: stats.assistCount,
            assist_cap: orchCfg.limits.max_assists_per_session,
          });
          console.log(
            `[Orchestrator] Auto assist complete (${stats.assistCount}/${orchCfg.limits.max_assists_per_session})`,
          );
          messages.push({ role: 'user', content: hint });
          messages.push({ role: 'assistant', content: 'Understood. Following the advisor guidance now.' });
        }
      }
    }

    sendSSE('info', { message: 'Processing...' });
  }

  const stepCount = allToolResults.length;
  console.warn(`[v2] WARN max tool rounds reached (${effectiveMaxToolRounds}) in ${executionMode} mode after ${stepCount} tool result(s).`);
  sendSSE('info', {
    message: `Reached the turn safety boundary after ${stepCount} tool step(s). Preserving progress and preparing continuation.`,
  });

  if (isResumableExecutionMode(executionMode)) {
    finalizeSkillGardenerForTurn('Hit max steps - continuing next round.');
    return { type: 'execute', text: 'Hit max steps - continuing next round.', toolResults: allToolResults };
  }

  const creativeSuffix = creativeMode
    ? ' The Creative workspace remains open with the latest changes, so the next turn can continue from here.'
    : '';
  const text = stepCount > 0
    ? `I reached the turn safety boundary after ${stepCount} tool step(s), but progress was preserved.${creativeSuffix} Say "continue" and I will pick up from the current state instead of starting over.`
    : 'I reached the turn safety boundary before completing the request. Say "continue" and I will retry from the current state.';
  const finalTextWithSkillOffer = finalizeSkillGardenerForTurn(text);
  return { type: 'execute', text: finalTextWithSkillOffer, toolResults: allToolResults };
  } finally {
    // switch_model overrides are strictly turn-scoped; always clear on turn end.
    clearTurnModelOverride(sessionId);
  }
}
// Wire chat-helpers and task-router deps moved into initChatRouter() (B6)

const editRerunAbortResetSessions = new Set<string>();

// ─── SSE + Routes ──────────────────────────────────────────────────────────────

async function maybeRefreshProjectLearning(
  sessionId: string,
  extraTextBlocks?: string[],
): Promise<void> {
  try {
    await refreshProjectContextForSession(sessionId, { extraTextBlocks });
  } catch (err: any) {
    console.warn(`[ProjectLearning] Refresh failed for session ${sessionId}:`, err?.message || err);
  }
}

const activeMainChatGoalRuns = new Set<string>();

function broadcastMainChatGoalState(sessionId: string, event: string, extra: Record<string, any> = {}): void {
  try {
    broadcastWS({
      type: 'main_chat_goal_updated',
      sessionId,
      event,
      goal: snapshotMainChatGoal(sessionId),
      ...extra,
    });
  } catch {}
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startMainChatGoalRunner(sessionId: string, source = 'goal_command'): void {
  const sid = String(sessionId || '').trim();
  if (!sid || activeMainChatGoalRuns.has(sid)) return;
  const initial = snapshotMainChatGoal(sid);
  if (!initial || initial.status !== 'active') return;
  activeMainChatGoalRuns.add(sid);
  broadcastMainChatGoalState(sid, 'runner_started', { source });

  void (async () => {
    try {
      await delayMs(250);
      while (true) {
        const current = snapshotMainChatGoal(sid);
        if (!current || current.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: current?.status || 'no_goal' });
          return;
        }

        const prompt = buildMainChatGoalContinuationPrompt(current);
        const abortController = new AbortController();
        const abortSignal = { aborted: false, signal: abortController.signal };
        const runtimeId = registerLiveRuntime({
          kind: 'main_chat',
          label: 'Main chat goal',
          sessionId: sid,
          source: 'goal',
          detail: current.goal.slice(0, 160),
          abortSignal,
        });
        setModelBusy(true);
        broadcastMainChatGoalState(sid, 'turn_started', { turnsUsed: current.turnsUsed });

        let result: HandleChatResult | null = null;
        try {
          result = await runInteractiveTurn(
            prompt,
            sid,
            (event, data) => {
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
            { syntheticGoalContinuation: true } as any,
          );
        } catch (err: any) {
          const failed = recordMainChatGoalRuntimeFailure(sid, current.id, err?.message || String(err));
          broadcastMainChatGoalState(sid, 'runtime_failure', { error: err?.message || String(err), goal: failed });
          return;
        } finally {
          setModelBusy(false);
          finishLiveRuntime(runtimeId);
        }

        const latest = snapshotMainChatGoal(sid);
        if (!latest || latest.id !== current.id || latest.status !== 'active') {
          broadcastMainChatGoalState(sid, 'runner_stopped', { reason: latest?.status || 'goal_changed' });
          return;
        }

        const judge = await judgeMainChatGoal(latest, String(result?.text || ''));
        const judged = applyMainChatGoalJudgeResult(sid, latest.id, judge);
        broadcastMainChatGoalState(sid, 'judged', { judge, goal: judged });
        if (!judged || judged.status !== 'active') return;

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

async function runInteractiveTurn(
  message: string,
  sessionId: string,
  sendSSE: (event: string, data: any) => void,
  pinnedMessages?: Array<{ role: string; content: string }>,
	  abortSignal?: { aborted: boolean; signal?: AbortSignal },
	  callerContext?: string,
	  reasoningOptions?: ReasoningOptions,
	  attachments?: Array<{ base64: string; mimeType: string; name: string }>,
    modelOverride?: string,
    flags?: { syntheticGoalContinuation?: boolean },
): Promise<HandleChatResult> {
  const isSubagentChatSession = /^subagent_chat_/i.test(String(sessionId || ''));
  const isGoalContinuationTurn = flags?.syntheticGoalContinuation === true || isMainChatGoalContinuation(message);
  const isTimerTurn = /^\s*\[Timer fired\]/i.test(String(message || ''));
  const userMsg = {
    role: 'user' as const,
    content: message,
    timestamp: Date.now(),
    ...(isTimerTurn ? { channel: 'system' as const, channelLabel: 'timer' } : {}),
    ...(isGoalContinuationTurn ? { channel: 'system' as const, channelLabel: 'goal' } : {}),
  };
  const rollingCompactionPolicy = resolveRollingCompactionPolicy();
  let rollingCompactionApplied = false;

  if (!isSubagentChatSession && !isGoalContinuationTurn && /^\/goal(?:\s|$)/i.test(String(message || '').trim())) {
    const command = handleMainChatGoalCommand(sessionId, message);
    const reply = command.message || 'Goal command handled.';
    addMessage(sessionId, userMsg, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    addMessage(sessionId, { role: 'assistant', content: reply, timestamp: Date.now() }, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
    broadcastMainChatGoalState(sessionId, 'command', { goal: command.goal });
    if (command.shouldStartRunner) startMainChatGoalRunner(sessionId, 'goal_command');
    return { type: 'chat', text: reply };
  }

  if (isSubagentChatSession) {
    const session = getSession(sessionId);
    session.pendingCompaction = false;
    session.pendingMemoryFlush = false;
  }

  if (!isSubagentChatSession && rollingCompactionPolicy.enabled) {
    const currentSession = getSession(sessionId);
    const { nonSummarySinceCheckpoint } = getRollingCompactionProgress(currentSession, userMsg);
    const shouldAttemptRollingCompaction = nonSummarySinceCheckpoint >= rollingCompactionPolicy.messageCount;
    if (shouldAttemptRollingCompaction) {
      sendSSE('tool_call', {
        action: CONTEXT_COMPACTION_TOOL_NAME,
        args: {
          phase: 'start',
          threshold_messages: rollingCompactionPolicy.messageCount,
          candidate_messages: nonSummarySinceCheckpoint,
          tool_turn_window: rollingCompactionPolicy.toolTurns,
          summary_max_words: rollingCompactionPolicy.summaryMaxWords,
        },
        synthetic: true,
        actor: 'system',
      });
    }
    const rollingResult = await maybeRunRollingCompaction(sessionId, userMsg, abortSignal);
    if (rollingResult.compacted) {
      rollingCompactionApplied = true;
      const modeLabel = rollingResult.mode === 'fallback' ? 'fallback summary' : 'LLM summary';
      const summaryText = String(rollingResult.summaryText || '').trim();
      const summaryWordCount = summaryText ? summaryText.split(/\s+/).filter(Boolean).length : 0;
      console.log(`[v2] Rolling context compaction applied for session ${sessionId} at ${rollingCompactionPolicy.messageCount} messages (${modeLabel}).`);
      await maybeRefreshProjectLearning(sessionId, summaryText ? [summaryText] : undefined);
      if (shouldAttemptRollingCompaction) {
        sendSSE('tool_result', {
          action: CONTEXT_COMPACTION_TOOL_NAME,
          result: summaryText
            ? `Thread compacted (${modeLabel}).\n\n${summaryText}`
            : `Thread compacted (${modeLabel}).`,
          error: false,
          synthetic: true,
          actor: 'system',
          extra: {
            phase: 'result',
            status: 'compacted',
            mode: modeLabel,
            summary: summaryText,
            summary_word_count: summaryWordCount,
            message_window: rollingCompactionPolicy.messageCount,
            tool_turn_window: rollingCompactionPolicy.toolTurns,
            summary_max_words: rollingCompactionPolicy.summaryMaxWords,
          },
        });
      }
    } else if (shouldAttemptRollingCompaction) {
      sendSSE('tool_result', {
        action: CONTEXT_COMPACTION_TOOL_NAME,
        result: 'Thread compaction skipped (continuing with normal flow).',
        error: false,
        synthetic: true,
        actor: 'system',
        extra: {
          phase: 'result',
          status: 'skipped',
          message_window: rollingCompactionPolicy.messageCount,
          tool_turn_window: rollingCompactionPolicy.toolTurns,
          summary_max_words: rollingCompactionPolicy.summaryMaxWords,
        },
      });
    }
  }

  const addResult = addMessage(sessionId, userMsg, {
    deferOnMemoryFlush: true,
    deferOnCompaction: true,
    disableCompactionCheck: rollingCompactionApplied || isSubagentChatSession,
    disableMemoryFlushCheck: isSubagentChatSession,
    maxMessages: isSubagentChatSession ? 120 : undefined,
  });

  if (addResult.deferredForCompaction && addResult.compactionPrompt) {
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
      );
      if (!abortSignal?.aborted && compactResult?.text) {
        addMessage(
          sessionId,
          { role: 'assistant', content: compactResult.text, timestamp: Date.now() },
          { disableMemoryFlushCheck: true, disableCompactionCheck: true },
        );
        await maybeRefreshProjectLearning(sessionId, [compactResult.text]);
      }
    } catch (compactErr: any) {
      console.warn('[v2] Context compaction turn failed:', compactErr?.message || compactErr);
    }
    if (abortSignal?.aborted) return { type: 'chat', text: '' };
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  } else if (addResult.deferredForMemoryFlush && addResult.memoryFlushPrompt) {
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
    if (abortSignal?.aborted) return { type: 'chat', text: '' };
    addMessage(sessionId, userMsg, { disableMemoryFlushCheck: true, disableCompactionCheck: true });
  }

  console.log(`\n[v2] USER: ${message.slice(0, 100)}`);
  const followupHandled = await tryHandleBlockedTaskFollowup(sessionId, message);
  if (followupHandled) {
    if (!abortSignal?.aborted) {
      addMessage(sessionId, { role: 'assistant', content: followupHandled, timestamp: Date.now() });
      await maybeRefreshProjectLearning(sessionId);
    }
    return { type: 'chat', text: followupHandled };
  }

  const pins = Array.isArray(pinnedMessages) ? pinnedMessages.slice(0, 3) : [];
  const canvasCtx = getCanvasContextBlock(sessionId);
  const mergedCallerContext = [callerContext, canvasCtx || undefined].filter(Boolean).join('\n\n') || undefined;
  const result = await handleChat(
    message,
    sessionId,
	    sendSSE,
	    pins.length > 0 ? pins : undefined,
	    abortSignal,
	    mergedCallerContext,
	    modelOverride,
	    undefined,
	    undefined,
	    Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
	    reasoningOptions,
	  );

  const toolLogLines = result.toolResults && result.toolResults.length > 0
    ? result.toolResults.slice(-8).map((r) => {
        const ok = r.error ? '\u2717' : '\u2713';
        const args = r.args ? JSON.stringify(r.args).slice(0, 60) : '';
        const preview = String(r.result || '').slice(0, 100).replace(/\n/g, ' ');
        return `${ok} ${r.name}(${args}): ${preview}`;
      })
    : [];

  if (toolLogLines.length > 0) {
    persistToolLog(sessionId, toolLogLines.join('\n'));
  }

  if (abortSignal?.aborted) {
    if (editRerunAbortResetSessions.has(String(sessionId || ''))) {
      return result;
    }
    const interruptedText = String(result.text || '').trim();
    const checkpointText = [
      '[Interrupted by user]',
      interruptedText || 'The turn was stopped before a final response was produced.',
      toolLogLines.length > 0
        ? `Recent tool/process context was preserved for continuation:\n${toolLogLines.join('\n')}`
        : 'No tool calls had completed yet.',
      'When the user asks to continue, resume from this checkpoint instead of restarting from scratch.',
    ].filter(Boolean).join('\n\n');
    addMessage(sessionId, { role: 'assistant', content: checkpointText, timestamp: Date.now() }, {
      disableCompactionCheck: isSubagentChatSession,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    if (!isSubagentChatSession) await maybeRefreshProjectLearning(sessionId, [checkpointText]);
  } else {
    addMessage(sessionId, { role: 'assistant', content: result.text, timestamp: Date.now() }, {
      disableCompactionCheck: isSubagentChatSession,
      disableMemoryFlushCheck: isSubagentChatSession,
      maxMessages: isSubagentChatSession ? 120 : undefined,
    });
    if (!isSubagentChatSession) await maybeRefreshProjectLearning(sessionId);
  }

  return result;
}

function createSSESender(res: express.Response): (event: string, data: any) => void {
  return (type: string, data: any) => { try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch {} };
}

const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'paused',
  'stalled',
  'needs_assistance',
  'awaiting_user_input',
  'failed',
  'waiting_subagent',
];

function inferTaskChannelFromSession(sessionId: string): 'web' | 'telegram' {
  return String(sessionId || '').startsWith('telegram_') ? 'telegram' : 'web';
}

function parseTelegramChatIdFromSessionId(sessionId: string): number | null {
  const v = String(sessionId || '').trim();
  if (!v.startsWith('telegram_')) return null;
  const id = Number(v.replace(/^telegram_/, ''));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function bindTeamNotificationTargetFromSession(teamId: string, sessionId: string, source = 'session'): void {
  const tgChatId = parseTelegramChatIdFromSessionId(sessionId);
  if (tgChatId) {
    addTeamNotificationTarget(teamId, {
      channel: 'telegram',
      peerId: String(tgChatId),
      source,
    });
  }
}

router.get('/api/status', async (_req, res) => {
  const rawCfg = getConfig().getConfig() as any;
  const provider: string = rawCfg.llm?.provider || 'ollama';
  const isCloudProvider = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
  const cachedProviderStatus = readProviderStatusCache();
  const connected = isCloudProvider ? true : !!cachedProviderStatus?.connected;
  const providerChecking = !isCloudProvider && !cachedProviderStatus && isProviderStatusChecking();
  const providerCfg = rawCfg.llm?.providers?.[provider] || {};
  const activeModel: string = providerCfg.model || rawCfg.models?.primary || 'unknown';
  const orchCfg = getOrchestrationConfig();
  res.json({
	    status: 'ok', version: 'v2-tools', ollama: connected, providerOnline: connected, providerChecking,
    provider,
    currentModel: activeModel,
    workspace: (getConfig().getConfig() as any).workspace?.path || '',
    search: rawCfg.search?.tinyfish_api_key ? 'tinyfish' : rawCfg.search?.google_api_key ? 'google' : (rawCfg.search?.tavily_api_key ? 'tavily' : 'none'),
    orchestration: orchCfg ? {
      enabled: orchCfg.enabled,
      secondary: orchCfg.secondary,
    } : null,
  });
});

router.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', pinnedMessages, attachments, reasoning, callerContext } = req.body;
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'Message required' }); return; }
  setLastMainSessionId(String(sessionId || 'default'));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = createSSESender(res);
  sendSSE('progress_state', { source: 'none', reason: 'request_start', activeIndex: -1, total: 0, items: [] });
  const heartbeat = setInterval(() => sendSSE('heartbeat', { state: 'processing' }), 5000);

  // ── Model busy guard — block cron scheduler while user chat is running ──
  setModelBusy(true);

  const abortController = new AbortController();
  const abortSignal = { aborted: false, signal: abortController.signal };
  const runtimeId = registerLiveRuntime({
    kind: 'main_chat',
    label: 'Main chat',
    sessionId: String(sessionId || 'default'),
    source: 'web',
    detail: String(message || '').slice(0, 160),
    abortSignal,
  });
  let requestCompleted = false;
  res.on('close', () => {
    if (!requestCompleted && !abortSignal.aborted) {
      abortSignal.aborted = true;
      abortController.abort();
      console.log(`[v2] Client disconnected — aborting task for session ${sessionId}`);
    }
  });

  try {
    const result = await runInteractiveTurn(
      message,
	      sessionId,
	      sendSSE,
	      pinnedMessages,
		      abortSignal,
		      typeof callerContext === 'string' && callerContext.trim() ? callerContext.trim() : undefined,
		      reasoning && typeof reasoning === 'object' ? reasoning : undefined,
		      Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined,
			    );
		    if (!abortSignal.aborted) {
		      markProviderStatus(true);
	      sendSSE('final', { text: result.text });
	      sendSSE('done', {
        reply: result.text, mode: result.type,
        sections: [{ type: result.type === 'execute' ? 'tool_results' : 'text', content: result.text }],
        thinking: result.thinking, results: result.toolResults, artifacts: result.artifacts,
      });
    }
		  } catch (err: any) {
		    if (!abortSignal.aborted) markProviderStatus(false);
	    if (!abortSignal.aborted) {
      console.error('[v2] ERROR:', err);
      sendSSE('error', { message: err.message || 'Unknown error' });
    }
  } finally {
    requestCompleted = true;
    editRerunAbortResetSessions.delete(String(sessionId || 'default'));
    clearInterval(heartbeat);
    finishLiveRuntime(runtimeId);
    setModelBusy(false); // release busy guard — cron scheduler may now run
    res.end();
  }
});

// ── List sessions endpoint ────────────────────────────────────────────────────
router.get('/api/sessions', async (req, res) => {
  try {
    const channel = req.query.channel as string | undefined;
    if (channel) {
      const validChannels = ['terminal', 'telegram', 'web', 'system'];
      if (!validChannels.includes(channel)) {
        res.status(400).json({ error: 'Invalid channel. Valid values: ' + validChannels.join(', ') });
        return;
      }
    }
    res.json({ sessions: listSessionSummaries(channel as any) });
  } catch (err: any) {
    console.error('[/api/sessions] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to list sessions' });
  }
});

// ── Get single session by ID ──────────────────────────────────────────────────
router.get('/api/sessions/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const channel = String(req.query.channel || '').trim();
    const limit = Number(req.query.limit || 80);
    const validChannels = ['', 'terminal', 'telegram', 'web', 'system'];
    if (!validChannels.includes(channel)) {
      res.status(400).json({ error: 'Invalid channel. Valid values: terminal, telegram, web, system' });
      return;
    }
    const sessions = searchSessionSummaries(q, {
      channel: channel ? channel as any : undefined,
      limit,
    }).map((session) => {
      const project = findProjectBySessionId(session.id);
      return project
        ? {
            ...session,
            projectId: project.id,
            projectName: project.name,
          }
        : session;
    });
    res.json({
      query: q,
      sessions,
    });
  } catch (err: any) {
    console.error('[/api/sessions/search] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to search sessions' });
  }
});

router.post('/api/sessions/:id/history', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    replaceHistory(id, history as any);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[/api/sessions/:id/history POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to replace session history' });
  }
});

router.post('/api/sessions/:id/edit-rerun-reset', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Session id required' });
    return;
  }
  editRerunAbortResetSessions.add(id);
  res.json({ success: true });
});

router.get('/api/sessions/:id', (req, res) => {
  try {
    const sessionId = String(req.params.id);
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    
    res.json({
      session: {
        id: session.id,
        channel: session.channel,
        history: session.history,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        creativeMode: session.creativeMode || null,
        canvasProjectRoot: session.canvasProjectRoot || null,
        canvasProjectLabel: session.canvasProjectLabel || null,
        canvasProjectLink: session.canvasProjectLink || null,
        mainChatGoal: session.mainChatGoal || null,
        mainChatGoalHistory: session.mainChatGoalHistory || [],
        title: session.history && session.history.length > 0
          ? (session.history.find(m => m.role === 'user')?.content || session.id).slice(0, 42)
          : session.id,
      }
    });
  } catch (e: any) {
    console.error('[/api/sessions/:id] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/sessions/:id/main-goal/:action', (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const action = String(req.params.action || '').trim().toLowerCase();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required' });
      return;
    }
    if (!['status', 'pause', 'resume', 'clear', 'done', 'revise'].includes(action)) {
      res.status(400).json({ success: false, error: 'Invalid goal action' });
      return;
    }
    const suffix = action === 'revise'
      ? `revise ${String(req.body?.goal || req.body?.text || '').trim()}`
      : action;
    const result = handleMainChatGoalCommand(sessionId, `/goal ${suffix}`);
    if (result.shouldStartRunner) startMainChatGoalRunner(sessionId, `goal_action:${action}`);
    broadcastMainChatGoalState(sessionId, `action:${action}`, { goal: result.goal });
    res.json({ success: true, message: result.message, goal: result.goal });
  } catch (e: any) {
    console.error('[/api/sessions/:id/main-goal/:action] Error:', e);
    res.status(500).json({ success: false, error: e.message || 'Goal action failed' });
  }
});

router.delete('/api/sessions/:id', (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'Session id is required' });
      return;
    }
    const project = findProjectBySessionId(sessionId);
    const deleted = project
      ? !!removeSessionFromProject(project.id, sessionId)
      : deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ success: true, projectId: project?.id });
  } catch (e: any) {
    console.error('[/api/sessions/:id DELETE] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

export { handleChat, runInteractiveTurn, bindTeamNotificationTargetFromSession };
