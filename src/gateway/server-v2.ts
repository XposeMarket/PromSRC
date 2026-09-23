/**
 * server-v2.ts - Prometheus Gateway
 * 
 * Architecture: Native Ollama Tool Calling
 * Memory: Reads SOUL.md and USER.md from workspace
 * Search: Tavily / Google Custom Search API / Brave / DuckDuckGo
 * Logging: Daily session logs in memory/
 *
 * B6 Refactor: handleChat + /api/chat + /api/status extracted to routes/chat.router.ts
 */

// MUST be first: synchronously consumes the master key handed over stdin by the
// Electron main process, before any vault access or config side effects run.
import '../security/vault-key-bootstrap.js';
import './exit-diagnostics.js';
import './startup-async-diagnostics.js';

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../config/config';
import { getVault } from '../security/vault';
import { getOllamaClient } from '../agents/ollama-client';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getWorkspace, setWorkspace, clearHistory, flushAllSessions, flushPendingSessionWrites, flushPendingChatAuditWrites, getChatAuditPersistenceStatus, getSessionPersistenceStatus, getSessionCacheStatus } from './session';
import { stopAutoSettleScheduler } from './auto-settle';
import { compactRuntimeStateOnStartup, flushLiveRuntimePersistence, getLiveRuntimePersistenceStatus, warmLiveRuntimePersistence, listLiveRuntimes, type LiveRuntimeSnapshot } from './live-runtime-registry';
import { evaluateUpdatePreflight } from '../update/canonical-updater';
import { runBootMd } from './boot';
import { setupErrorResponseEndpoint } from './errors/error-response-endpoint-integrated';
import { isStorageBoundaryError } from './storage/storage-paths';
import { initCredentialHandler, getCredentialHandler } from '../security/credential-handler';
import { getVerificationFlowManager } from './verification-flow';
import { getErrorAnalyzer } from './errors/error-analyzer';
import { getErrorHistory } from './errors/error-history';
import { getRetryStrategy } from './retry-strategy';
import { getVisualErrorDetector } from './visual-error-detection';
import { getErrorAudit } from '../security/error-audit';
import { getContextInjectionManager } from './context-injection';
import { SkillsManager } from './skills-runtime/skills-manager';
import { buildSelfReflectionInstruction } from '../config/self-reflection.js';
import {
  browserOpen, browserSnapshot, browserClick, browserFill, browserPressKey,
  browserWait, browserScroll, browserClose, browserGetFocusedItem, browserGetPageText,
  getBrowserToolDefinitions, getBrowserSessionInfo, getBrowserAdvisorPacket,
} from './browser-tools';
import {
  seedDefaultShortcuts, getAllShortcuts, saveSiteShortcut, deleteSiteShortcut, listKnownHosts,
} from './site-shortcuts';
import {
  desktopScreenshot, desktopFindWindow, desktopFocusWindow, desktopClick, desktopDrag,
  desktopWait, desktopType, desktopPressKey, desktopGetClipboard, desktopSetClipboard,
  desktopLaunchApp, desktopCloseApp, desktopGetProcessList,
  desktopWaitForChange, desktopDiffScreenshot, desktopScreenshotWithHistory,
  getDesktopToolDefinitions, getDesktopAdvisorPacket,
} from './desktop-tools';
import { CronScheduler, setCronSchedulerInstance } from './scheduling/cron-scheduler';
import { HeartbeatRunner, setHeartbeatRunnerInstance } from './scheduling/heartbeat-runner';
import { MainChatTimerRunner } from './timers/timer-runner';
import { InternalWatchRunner } from './internal-watch/internal-watch-runner';
import { ActiveThreadSupervisionController } from './threads/thread-supervision-controller';
import { BrainRunner, createBrainHandleChatAdapter, setBrainRunnerInstance } from './brain/brain-runner';
import {
  getAgentRunHistory, getAgentLastRun, recordAgentRun,
} from '../scheduler';
import { TelegramChannel } from './comms/telegram-channel';
import { TelegramPersonaBotManager } from './comms/telegram-persona-bots';
import { TelegramTeamRoomBridge } from './comms/telegram-team-room-bridge';
import { readRestartContext, setShutdownHooks } from './lifecycle';
import { adoptGatewayHandoffHostsAtBoot, startHandoffSyntheticRuntimeFixture } from './runtime/gateway-handoff-bridge';
import { attachOpenAiRealtimeProxy, attachXaiVoiceStreaming } from './voice/xai-streaming';
import { prepareActiveRuntimesForGatewayShutdown, retriggerDeferredMainChatRuntime, isPlannedMainChatRestartRuntime, isFirstLoneCrashRetry, registerRestartContinuityEmitter } from './runtime-recovery';
import { browserVisionScreenshot, browserVisionClick, browserVisionType, browserPreviewScreenshot } from './browser-tools';
import { assertSupportedNodeRuntime } from './runtime/node-runtime';
import {
  createTask, loadTask, saveTask, updateTaskStatus, setTaskStepRunning,
  updateTaskRuntimeProgress, appendJournal, updateResumeContext,
  listTasks, deleteTask, mutatePlan, getEvidenceBusSnapshot,
  type TaskRecord, type TaskStatus,
} from './tasks/task-store';
import {
  loadScheduleMemory, loadRunLog, startRunLogEntry, completeScheduledRun, formatScheduleMemoryForPrompt,
} from './scheduling/schedule-memory';
import { BackgroundTaskRunner, setStandaloneSubagentCompletionTurn } from './tasks/background-task-runner';
import { analyzeRunForImprovement, applyPromptMutation } from './scheduling/prompt-mutation';
import { processTaskFailure, buildSelfRepairTriggerPrompt } from './errors/error-watchdog';
import { goalDecomposeTool, executeGoalDecompose, approveGoal, loadGoal, listGoals } from './goal-decomposer';
import {
  listManagedTeams, getManagedTeam, saveManagedTeam, deleteManagedTeam, createManagedTeam,
  appendTeamChat, appendManagerNote, applyTeamChange, rejectTeamChange,
  getTeamMemberAgentIds, recordTeamRun, addTeamNotificationTarget, getTeamNotificationTargets,
  listTeamContextReferences, addTeamContextReference, updateTeamContextReference, deleteTeamContextReference,
  buildTeamContextRuntimeBlock,
} from './teams/managed-teams';
import { triggerManagerReview, handleManagerConversation, setTeamRunAgentFn } from './teams/team-manager-runner';
import { checkForTeamSuggestion } from './teams/team-detector';
import { SubagentManager } from './agents-runtime/subagent-manager';

import { webSearch, webFetch } from '../tools/web';
import {
  buildTools as _buildTools, type BuildToolsDeps, type ToolResult, type TaskControlResponse,
  type ScheduleJobAction, normalizeScheduleJobAction, summarizeCronJob,
  normalizeDeliveryChannel, normalizeToolArgs, parseJsonLike, toStringRecord, parseLooseMap,
} from './tool-builder';
import {
  executeTool as _executeTool, lastFilenameUsed, type ExecuteToolDeps,
} from './agents-runtime/subagent-executor';
import {
  wss as _wssRef, setWss, broadcastWS, broadcastTeamEvent,
  addTeamSseClient, removeTeamSseClient, sendTeamNotificationToChannels,
  sendDiscordNotification, sendWhatsAppNotification, resolveChannelsConfig,
  setTelegramChannelForBroadcaster, setTeamEventMirror, isModelBusy,
  getLastMainSessionId, setLastMainSessionId, startRuntimeHeartbeat,
  type TelegramChannelConfig, type DiscordChannelConfig, type WhatsAppChannelConfig,
  type ChannelsConfig, normalizeTelegramConfig, normalizeDiscordConfig, normalizeWhatsAppConfig,
} from './comms/broadcaster';
import { initializeRuntimeProgressLease } from './gateway-progress-lease';
import {
  getSessionSkillWindows, sessionCurrentTurn,
  recoverSkillsIfEmpty,
  initSkillWindows, setSkillRecoveryFn,
} from './skills-runtime/skill-windows';
import { separateThinkingFromContent, sanitizeFinalReply, stripExplicitThinkTags, normalizeForDedup, isGreetingLikeMessage } from './comms/reply-processor';
import {
  initTaskRouter, isTaskRouterInitialized, latestTaskForSession, findBlockedTaskForSession, findClarificationWaitingTask,
  isResumeIntent, isRerunIntent, isCancelIntent, isStatusQuestion, isTaskListIntent, isAdjustmentIntent,
  getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
  parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText,
  launchBackgroundTaskRunner, handleTaskControlAction, renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup,
} from './tasks/task-router';
import { router as skillsRouter, setSkillsRouterManager } from './routes/skills.router';
import { router as tasksRouter, initTasksRouter, makeBroadcastForTask } from './routes/tasks.router';
import { router as channelsRouter, initChannelsRouter, runSubagentChatTurnFromChannel } from './routes/channels.router';
import { sanitizeAgentId, normalizeAgentsForSave } from './agents/agent-normalize';
import {
  router as teamsRouter, initTeamsRouter, pauseManagedTeamInternal, resumeManagedTeamInternal,
  buildTeamDispatchContext, postTeamChatFromChannel, runTeamAgentViaChat,
} from './routes/teams.router';
import { router as settingsRouter, initSettingsRouter } from './routes/settings.router';
import { router as accountRouter, refreshPersistedSession, requireAccountAccess } from './routes/account.router';
import { router as goalsRouter, initGoalsRouter } from './routes/goals.router';
import { router as proposalsRouter, setProposalsBroadcast, broadcastProposalCreated } from './routes/proposals.router';
import { router as auditLogRouter } from './routes/audit-log.router';
import { router as connectionsRouter } from './routes/connections.router';
import { router as connectionsV2Router } from './routes/connections-v2.router';
import { router as extensionsRouter } from './routes/extensions.router';
import { router as canvasRouter, initCanvasRouter } from './routes/canvas.router';
import { router as resourcesRouter } from './routes/resources.router';
import { router as projectsRouter } from './routes/projects.router';
import { router as memoryRouter } from './routes/memory.router';
import { router as pairingRouter } from './routes/pairing.router';
import { router as obsidianRouter } from './routes/obsidian.router';
import { router as hubRouter, setHubRouterDeps } from './routes/hub.router';
import { router as onboardingRouter } from './routes/onboarding.router';
import { router as migrationRouter } from './routes/migration.router';
import { router as importsRouter } from './routes/imports.router';
import { router as processesRouter } from './routes/processes.router';
import { router as processHygieneRouter } from './routes/process-hygiene.router';
import { router as codingRouter } from './routes/coding.router';
import { router as realtimeRouter } from './routes/realtime.router';
import { router as voiceRouter } from './routes/voice.router';
import { getCodexRealtimeBridge, shutdownCodexRealtimeBridge } from './realtime/codex-app-server-bridge';
import { addCanvasFile, getCanvasContextBlock } from './routes/canvas-state';
import { getMCPManager } from './mcp-manager';
import {
  buildTools, executeTool, _dispatchToAgent, initChatHelpers, buildPersonalityContext,
  getPreemptSessionCount, incrementPreemptSessionCount,
  type SubagentProfile, type HandleChatResult, type RuntimeProgressItem,
  resolveSkillsDir, configuredSkillsDir, fallbackSkillsDir,
  syncMissingSkills, migrateSkillsStateIfMissing,
  prettifyToolName, buildProgressItems,
  logToolCall, isBrowserToolName, isDesktopToolName, buildBrowserAck, buildDesktopAck, buildDesktopScreenshotContent,
  isExecutionLikeRequest, looksLikeIntentOnlyReply,
  isContinuationCue, hasPendingExecutionIntent, isHardBlockerReply, hasConcreteCompletion,
  isHighStakesFile, requestedFullTemplate, resolveWorkspaceFilePath, collectFileSnapshots,
  goalIsInteractiveAction, isBrowserHeavyResearchPage, goalLikelyNeedsTextInput,
  parseSnapshotDiagnostics, evaluateBrowserSnapshotQuality,
} from './chat/chat-helpers';
import { createApp } from './core/app';
import { createServer } from './core/server';
import { runStartup, setStartupMarkSink, startPostReadyWorkspaceStartup } from './core/startup';
import { getMemoryIndexRefreshWorkerStatus, scheduleMemoryIndexRefresh, shutdownMemoryIndexRefreshWorker } from './memory-index/index';
import { warmMemoryAtomSnapshot } from './memory-index/memory-atoms.js';
import {
  getMemorySearchWorkerStatus,
  getAutomaticMemorySearchWorkerStatus,
  shutdownMemorySearchWorker,
  warmAutomaticMemorySearchWorkers,
  warmMemorySearchWorker,
} from './memory-index/search-worker-client';
import { warmModelUsageIndex } from '../providers/model-usage';
import { getContextBuildLimiterStatus } from './chat/context-build-limiter';
import { getContextBuildWorkerPoolStatus, shutdownContextBuildWorkerPool, warmContextBuildWorkerPool } from './chat/context-build-worker-client';
import { prepareTaskReplyLookupIndex } from './tasks/task-store';
import { getModelCallWorkerPoolStatus, prewarmModelCallWorkers, shutdownModelCallWorkerPool } from './process/model-call-worker-pool';
import { getBrainActivityWorkerStatus, shutdownBrainActivityWorker } from './brain/activity-package-worker-client';
import { getRuntimeWorkerDiagnostics } from './process/runtime-worker-broker.js';
import { gatewayRuntimeAdmission } from './runtime-admission';
import { getPostTurnQueueStatus } from './chat/post-turn-queue';
import { requireGatewayAuth } from './gateway-auth';
import { isProviderStatusChecking, readProviderStatusCache } from './provider-status';
import { getGatewayDescriptor } from './gateway-identity';
import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot, loadWorkspaceFile,
  readDailyMemoryContext, detectToolCategories, readMemoryCategories, readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  TOOL_BLOCKS, TOOL_TO_MEMORY_CATS, type SkillWindow,
} from './prompt-context';
import { internalAgentTaskRouter } from './agents-runtime/internal-agent-task';
import {
  registerAgentBuilderTools, executeAgentBuilderTool, AGENT_BUILDER_TOOL_NAMES,
} from './agents-runtime/agent-builder-integration';

// ─── B6: Chat router (handleChat + /api/chat + /api/status) ─────────────────

// ─── CIS: Tool dependency injection (A2 + A5) ────────────────────────────────
import { injectAnalysisTeamDeps } from '../tools/deploy-analysis-team';
import { injectSocialScraperDeps } from '../tools/social-scraper';
import { setNotifyBroadcastFn } from './teams/notify-bridge';

// ─── Config ────────────────────────────────────────────────────────────────────

assertSupportedNodeRuntime('gateway');
const configManager = getConfig();
const config = configManager.getConfig();
const CONFIG_DIR_PATH = configManager.getConfigDir();
// Electron may retain the configured/public gateway port in a stable relay
// while this worker is restarted behind it. The internal listener override is
// deliberately separate from PROMETHEUS_GATEWAY_PORT so pairing, lifecycle,
// and external URLs continue to describe the public endpoint.
const configuredInternalPort = Number(process.env.PROMETHEUS_GATEWAY_INTERNAL_PORT || '');
const PORT = Number.isInteger(configuredInternalPort) && configuredInternalPort >= 1 && configuredInternalPort <= 65_535
  ? configuredInternalPort
  : (config.gateway.port || (process.env.GATEWAY_PORT ? parseInt(process.env.GATEWAY_PORT, 10) : 18789));
const configuredGatewayHost = config.gateway.host || process.env.GATEWAY_HOST || '0.0.0.0';
const HOST = String(process.env.PROMETHEUS_GATEWAY_INTERNAL_HOST || '').trim()
  || configuredGatewayHost;
// The optional HTTPS listener is an independently configured endpoint. Keep
// it on the configured host when Electron moves only the primary HTTP worker
// behind the stable local relay.
const HTTPS_HOST = configuredGatewayHost;

function resolveConfigPath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve(CONFIG_DIR_PATH, raw);
}

function loadGatewayHttpsOptions(): { port: number; options: any } | null {
  const httpsCfg = (config.gateway as any)?.https || {};
  const enabled = httpsCfg.enabled === true || process.env.GATEWAY_HTTPS_ENABLED === '1' || process.env.GATEWAY_HTTPS_ENABLED === 'true';
  if (!enabled) return null;
  const port = Number(httpsCfg.port || process.env.GATEWAY_HTTPS_PORT || 18790);
  const pfxPath = resolveConfigPath(httpsCfg.pfxPath || process.env.GATEWAY_HTTPS_PFX_PATH);
  const keyPath = resolveConfigPath(httpsCfg.keyPath || process.env.GATEWAY_HTTPS_KEY_PATH);
  const certPath = resolveConfigPath(httpsCfg.certPath || process.env.GATEWAY_HTTPS_CERT_PATH);
  const passphrase = String(httpsCfg.passphrase || process.env.GATEWAY_HTTPS_PFX_PASSPHRASE || '').trim();

  try {
    if (pfxPath && fs.existsSync(pfxPath)) {
      return { port, options: { pfx: fs.readFileSync(pfxPath), passphrase } };
    }
    if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { port, options: { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), passphrase } };
    }
    console.warn('[Gateway] HTTPS requested but no certificate was found. Configure gateway.https.pfxPath or keyPath/certPath.');
  } catch (err: any) {
    console.warn('[Gateway] HTTPS certificate could not be loaded:', err?.message || err);
  }
  return null;
}

const STARTUP_PROFILE = process.env.PROMETHEUS_STARTUP_PROFILE === '1';
const startupT0 = Date.now();
let startupLast = startupT0;
let startupImportLogged = false;
// Always-on startup timeline. Console output stays opt-in, but every boot
// records its phase timings so restart latency is measured, not guessed.
const startupTimeline: Array<{ label: string; atMs: number; deltaMs: number }> = [];
const startupImportMs = Math.round(process.uptime() * 1000);
let startupTimelineFlushed = false;
function startupMark(label: string): void {
  const now = Date.now();
  startupTimeline.push({ label, atMs: now - startupT0, deltaMs: now - startupLast });
  if (STARTUP_PROFILE) {
    if (!startupImportLogged) {
      // Time from process spawn to this module body = tsx transpile + eager import graph.
      startupImportLogged = true;
      console.error(`[startup] process uptime at first mark: ${startupImportMs}ms (module import graph + transpile)`);
    }
    console.error(`[startup] +${String(now - startupT0).padStart(5)}ms Δ${String(now - startupLast).padStart(5)}ms ${label}`);
  }
  startupLast = now;
}
function flushStartupTimeline(reason: string): void {
  if (startupTimelineFlushed) return;
  startupTimelineFlushed = true;
  try {
    const logDir = path.join(configManager.getConfigDir(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const record = {
      at: new Date().toISOString(),
      pid: process.pid,
      reason,
      hotRestart: process.env.PROMETHEUS_HOT_RESTART === '1',
      importMs: startupImportMs,
      listenMs: startupTimeline.find((m) => m.label === 'server listen callback')?.atMs ?? null,
      totalFromSpawnMs: Math.round(process.uptime() * 1000),
      marks: startupTimeline,
    };
    fs.appendFileSync(path.join(logDir, 'startup-timeline.jsonl'), `${JSON.stringify(record)}\n`);
  } catch {}
}

type ChatRouterModule = typeof import('./routes/chat.router');
let chatRouterModule: ChatRouterModule | null = null;
let chatRouterDeps: Parameters<ChatRouterModule['initChatRouter']>[0] | null = null;
let chatRouterInitialized = false;
let chatRouterWarmupState: 'cold' | 'warming' | 'ready' | 'failed' = 'cold';
let chatRouterWarmupStartedAt = 0;
let chatRouterWarmupFinishedAt = 0;
let chatRouterWarmupError = '';

function getChatRouterModule(): ChatRouterModule {
  if (!chatRouterModule) {
    chatRouterWarmupState = 'warming';
    chatRouterWarmupStartedAt = chatRouterWarmupStartedAt || Date.now();
    try {
      chatRouterModule = require('./routes/chat.router') as ChatRouterModule;
      startupMark('chat router module loaded');
    } catch (err: any) {
      chatRouterWarmupState = 'failed';
      chatRouterWarmupFinishedAt = Date.now();
      chatRouterWarmupError = String(err?.message || err);
      throw err;
    }
  }
  if (!chatRouterInitialized && chatRouterDeps) {
    chatRouterModule.initChatRouter(chatRouterDeps);
    chatRouterInitialized = true;
    startupMark('chat router initialized lazily');
  }
  if (chatRouterInitialized) {
    chatRouterWarmupState = 'ready';
    chatRouterWarmupFinishedAt = chatRouterWarmupFinishedAt || Date.now();
    chatRouterWarmupError = '';
  }
  return chatRouterModule;
}

function warmChatRouter(reason = 'background'): void {
  if (chatRouterWarmupState === 'warming' || chatRouterWarmupState === 'ready') return;
  chatRouterWarmupState = 'warming';
  chatRouterWarmupStartedAt = Date.now();
  chatRouterWarmupFinishedAt = 0;
  chatRouterWarmupError = '';
  try {
    getChatRouterModule();
    console.log(`[Gateway] Chat router warmup complete (${reason}) in ${Date.now() - chatRouterWarmupStartedAt}ms`);
  } catch (err: any) {
    console.warn(`[Gateway] Chat router warmup failed (${reason}):`, err?.message || err);
  }
}

function getChatRouterWarmupStatus(): Record<string, any> {
  return {
    state: chatRouterWarmupState,
    startedAt: chatRouterWarmupStartedAt || null,
    finishedAt: chatRouterWarmupFinishedAt || null,
    elapsedMs: chatRouterWarmupStartedAt
      ? ((chatRouterWarmupFinishedAt || Date.now()) - chatRouterWarmupStartedAt)
      : 0,
    error: chatRouterWarmupError || undefined,
  };
}

function initChatRouterLazy(deps: Parameters<ChatRouterModule['initChatRouter']>[0]): void {
  chatRouterDeps = deps;
  if (chatRouterModule && !chatRouterInitialized) {
    chatRouterModule.initChatRouter(deps);
    chatRouterInitialized = true;
    startupMark('chat router initialized');
  }
}

const chatRouter = (req: any, res: any, next: any) => getChatRouterModule().router(req, res, next);
const handleChat: ChatRouterModule['handleChat'] = (...args: Parameters<ChatRouterModule['handleChat']>) =>
  getChatRouterModule().handleChat(...args);
const runInteractiveTurn: ChatRouterModule['runInteractiveTurn'] = (...args: Parameters<ChatRouterModule['runInteractiveTurn']>) =>
  getChatRouterModule().runInteractiveTurn(...args);
const retriggerInterruptedMainChat: ChatRouterModule['retriggerInterruptedMainChat'] = (...args: Parameters<ChatRouterModule['retriggerInterruptedMainChat']>) =>
  getChatRouterModule().retriggerInterruptedMainChat(...args);
setStandaloneSubagentCompletionTurn((...args) => runInteractiveTurn(...args as Parameters<ChatRouterModule['runInteractiveTurn']>));
const bindTeamNotificationTargetFromSession: ChatRouterModule['bindTeamNotificationTargetFromSession'] = (
  ...args: Parameters<ChatRouterModule['bindTeamNotificationTargetFromSession']>
) => getChatRouterModule().bindTeamNotificationTargetFromSession(...args);

// Electron starts the gateway directly, so we need to create the workspace/config
// scaffold here rather than relying on the CLI onboarding flow.
configManager.ensureDirectories();
startupMark('config directories ensured');

// Start child-process warmups now. They run in separate processes, so they
// overlap the synchronous skill scan and chat-router import below instead of
// adding ~0.7s serially right before listen. The pre-listen await further down
// reuses these same in-flight promises (the warm functions are idempotent).
const earlyWorkerWarmups = (() => {
  try {
    const workspacePath = getConfig().getWorkspacePath();
    const settle = <T,>(p: Promise<T>) => { p.catch(() => {}); return p; };
    return {
      context: settle(warmContextBuildWorkerPool()),
      memory: settle(warmMemorySearchWorker(workspacePath, { awaitPrewarm: false })),
      automaticMemory: settle(warmAutomaticMemorySearchWorkers(workspacePath, { awaitPrewarm: false })),
    };
  } catch {
    return null;
  }
})();
startupMark('child worker warmups started early');

const skillsDir = resolveSkillsDir(configuredSkillsDir);

// Seed bundled skills before SkillsManager scans — only runs if
// PROMETHEUS_BUNDLED_SKILLS_DIR is set (Electron desktop builds).
if (process.env.PROMETHEUS_BUNDLED_SKILLS_DIR) {
  try {
    const {
      seedBundledSkills,
      seedBundledSkillsIntoDir,
    } = require('../config/public-workspace.js') as typeof import('../config/public-workspace');
    const wp = getConfig().getWorkspacePath();
    if (wp) seedBundledSkills(wp, process.env.PROMETHEUS_BUNDLED_SKILLS_DIR);
    seedBundledSkillsIntoDir(skillsDir, process.env.PROMETHEUS_BUNDLED_SKILLS_DIR);
  } catch (e: any) {
    console.warn('[Skills] Could not seed bundled skills:', e?.message);
  }
}

const skillsManager = new SkillsManager(skillsDir);
console.log(`[Skills] Directory: ${skillsDir}`);
startupMark('skills manager constructed');

// ─── CronScheduler Init ────────────────────────────────────────────────────────

const cronStorePath = path.join(CONFIG_DIR_PATH, 'cron', 'jobs.json');
const cronScheduler = new CronScheduler({
  storePath: cronStorePath,
  handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter) =>
    handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter),
  broadcast: broadcastWS,
  deliverTelegram: (text: string) => telegramChannel.sendToAllowed(text),
  getMainSessionId: () => getLastMainSessionId() || 'default',
  getIsModelBusy: isModelBusy,
  getAvailableToolNames: () =>
    buildTools()
      .map((t: any) => String(t?.function?.name || '').trim())
      .filter(Boolean),
  injectSystemEvent: (sessionId, text, job) => {
    addMessage(sessionId, {
      role: 'assistant',
      content: `[System Event: ${job.name}]\n${text}`,
      timestamp: Date.now(),
    });
    broadcastWS({
      type: 'system_event',
      sessionId,
      source: 'cron',
      jobId: job.id,
      jobName: job.name,
      text,
    });
  },
  spawnBackgroundTask: async (job) => {
    try {
      let taskTitle = job.name;
      let plan: Array<{ index: number; description: string; status: 'pending' }>;
      {
        const prompt = job.prompt.toLowerCase();
        const isNews = /news|summar|stories|headlines|brief|report|digest/.test(prompt);
        const isResearch = /research|find|look up|search|gather|collect/.test(prompt);
        const isEmail = /email|inbox|gmail|message/.test(prompt);
        if (isNews) {
          plan = [
            { index: 0, description: 'Search for today\'s top news stories from multiple sources', status: 'pending' },
            { index: 1, description: 'Fetch and read full article content from results', status: 'pending' },
            { index: 2, description: 'Synthesize stories into a concise 3-5 bullet summary with sources', status: 'pending' },
            { index: 3, description: 'Deliver final summary to user', status: 'pending' },
          ];
        } else if (isResearch) {
          plan = [
            { index: 0, description: 'Search for relevant information on the topic', status: 'pending' },
            { index: 1, description: 'Read and extract key details from top results', status: 'pending' },
            { index: 2, description: 'Compile findings into a clear summary', status: 'pending' },
          ];
        } else if (isEmail) {
          plan = [
            { index: 0, description: 'Check inbox for new messages', status: 'pending' },
            { index: 1, description: 'Summarize important emails', status: 'pending' },
          ];
        } else {
          plan = [
            { index: 0, description: `Execute: ${job.prompt.slice(0, 120)}`, status: 'pending' },
            { index: 1, description: 'Review results and deliver output to user', status: 'pending' },
          ];
        }
      }

      let effectivePrompt = job.prompt;
      if ((job as any).subagent_id) {
        try {
          const workspacePath = getConfig().getWorkspacePath();
          const subagentConfigPath = path.join(workspacePath, '.prometheus', 'subagents', (job as any).subagent_id, 'config.json');
          if (fs.existsSync(subagentConfigPath)) {
            const subagentDef = JSON.parse(fs.readFileSync(subagentConfigPath, 'utf-8'));
            effectivePrompt = [
              `[SUBAGENT: ${subagentDef.name || (job as any).subagent_id}]`, '',
              subagentDef.system_instructions || job.prompt, '', 'TASK:', job.prompt, '', 'CONSTRAINTS:',
              ...(subagentDef.constraints || []).map((c: string) => `• ${c}`), '',
              `SUCCESS CRITERIA: ${subagentDef.success_criteria || 'Complete the task and report back.'}`,
            ].join('\n');
          }
        } catch (subagentErr: any) {
          console.warn(`[CronScheduler] Failed to load subagent config:`, subagentErr.message);
        }
      }

      const scheduleMem = loadScheduleMemory(job.id);
      let memoryInjectedPrompt = effectivePrompt;
      if (scheduleMem) {
        const memText = formatScheduleMemoryForPrompt(scheduleMem);
        memoryInjectedPrompt = [effectivePrompt, '', memText].join('\n');
      }

      const cronSessionId = `cron_${job.id}`;
      const scheduledAt = Date.now();
      const task = createTask({
        title: taskTitle, prompt: memoryInjectedPrompt, sessionId: cronSessionId,
        channel: 'web', plan, scheduleId: job.id,
      });
      const runId = startRunLogEntry({ scheduleId: job.id, taskId: task.id, scheduledAt });
      const freshTask = loadTask(task.id);
      if (freshTask) { (freshTask as any).scheduleRunId = runId; saveTask(freshTask); }

      appendJournal(task.id, { type: 'status_push', content: `Scheduled job "${job.name}" launched as background task (${plan.length} steps, runId=${runId})` });
      const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), telegramChannel);

      runner.start().then(async () => {
        const completedTask = loadTask(task.id);
        if (completedTask) {
          const busSnapshot = getEvidenceBusSnapshot(task.id);
          const busEntries = busSnapshot?.entries?.map(e => ({ category: e.category as string, key: e.key, value: e.value })) || [];
          const taskSuccess = completedTask.status === 'complete';
          const taskSummary = (completedTask.finalSummary || completedTask.journal.slice(-3).map((j: any) => j.content).join(' ')).slice(0, 400);
          const taskStepCount = completedTask.plan.filter((s: any) => s.status === 'done').length;
          completeScheduledRun({ scheduleId: job.id, runId, taskId: task.id, success: taskSuccess, summary: taskSummary, stepCount: taskStepCount, errorIfAny: !taskSuccess ? (completedTask.journal.slice(-1)[0]?.content || 'failed') : undefined, scheduledAt, busEntries, memoryUpdates: [] });
          broadcastWS({ type: 'schedule_memory_updated', jobId: job.id, scheduleId: job.id, runId });
          if (taskSuccess) {
            try {
              const analysis = await analyzeRunForImprovement(job, completedTask.journal, taskSummary, handleChat);
              if (analysis) {
                const mutationResult = applyPromptMutation(job, analysis, (id, partial) => cronScheduler.updateJob(id, partial));
                if (mutationResult.applied) {
                  broadcastWS({ type: 'prompt_mutated', jobId: job.id, jobName: job.name, version: mutationResult.version, improvements: analysis.improvements.length });
                  telegramChannel.sendToAllowed(`🧠 Prompt upgraded for "${job.name}" → v${mutationResult.version}\nLearned: ${analysis.improvements[0]?.slice(0, 100) || '(see task log)'}\nConfidence: ${(analysis.confidence * 100).toFixed(0)}%`).catch(() => {});
                }
              }
            } catch (mutErr: any) { console.warn(`[PromptMutation] Analysis failed for "${job.name}":`, mutErr.message); }
          }
          if (!taskSuccess) {
            try {
              const errorText = completedTask.journal.filter((j: any) => j.type === 'error').map((j: any) => j.content + (j.detail ? '\n' + j.detail : '')).join('\n');
              if (errorText) {
                const watchdogDecision = processTaskFailure(completedTask, errorText);
                if (watchdogDecision.action === 'notify' && watchdogDecision.message) {
                  telegramChannel.sendToAllowed(watchdogDecision.message).catch(() => {});
                } else if (watchdogDecision.action === 'auto_escalate' && watchdogDecision.shouldTriggerRepair) {
                  const repairPrompt = buildSelfRepairTriggerPrompt(errorText, watchdogDecision.sourceFile, watchdogDecision.sourceLine, completedTask.title);
                  handleChat(repairPrompt, `self_repair_${Date.now()}`, () => {}, undefined, undefined, '[BACKGROUND SELF-REPAIR ANALYSIS]', undefined, 'background_task')
                    .then(result => telegramChannel.sendToAllowed(`🔧 Self-repair analysis complete:\n${String(result?.text || '').slice(0, 500)}`).catch(() => {}))
                    .catch((e: any) => console.warn('[ErrorWatchdog] Self-repair trigger failed:', e.message));
                }
              }
            } catch (watchdogErr: any) { console.warn(`[ErrorWatchdog] Failed for task ${task.id}:`, watchdogErr.message); }
          }
        }
      }).catch((err: any) => console.error(`[CronScheduler] Task ${task.id} error:`, err.message));

      broadcastWS({ type: 'cron_task_spawned', jobId: job.id, jobName: job.name, taskId: task.id });
      return { taskId: task.id, sessionId: cronSessionId };
    } catch (err: any) {
      console.error('[CronScheduler] spawnBackgroundTask failed:', err.message);
      return null;
    }
  },
});
setCronSchedulerInstance(cronScheduler);
startupMark('cron scheduler constructed');

// ─── Telegram Channel Init ─────────────────────────────────────────────────────

const telegramChannel = new TelegramChannel(
  resolveChannelsConfig().telegram,
  {
    handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter, attachments) =>
      handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter, attachments),
    runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOrigin, requestMeta, callerOnToken) =>
      runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOrigin, requestMeta, callerOnToken),
    addMessage,
    getIsModelBusy: isModelBusy,
    broadcast: broadcastWS,
  }
);
setTelegramChannelForBroadcaster(telegramChannel);
const telegramPersonaBots = new TelegramPersonaBotManager(
  resolveChannelsConfig().telegram,
  {
    runSubagentTurn: (params) => runSubagentChatTurnFromChannel(params),
  },
);
const telegramTeamRoomBridge = new TelegramTeamRoomBridge(
  resolveChannelsConfig().telegram,
  {
    postTeamChat: (params) => postTeamChatFromChannel(params),
    sendMain: (chatId, text, topicId) => telegramChannel.sendMessage(chatId, text, topicId),
    sendPersona: (opts) => opts.agentId
      ? telegramPersonaBots.sendMessageForAgent(opts.agentId, opts.chatId, opts.text, opts.topicId)
      : opts.accountId
        ? telegramPersonaBots.sendMessageForAccount(opts.accountId, opts.chatId, opts.text, opts.topicId)
        : Promise.resolve(false),
  },
);
telegramPersonaBots.setTeamRoomBridge(telegramTeamRoomBridge);
setTeamEventMirror((data) => telegramTeamRoomBridge.handleTeamEvent(data));
startupMark('telegram bridges constructed');
initSkillWindows(skillsManager, skillsDir, fallbackSkillsDir);
startupMark('skill windows initialized');
setSkillRecoveryFn(() => {
  try {
    syncMissingSkills(fallbackSkillsDir, skillsDir);
    migrateSkillsStateIfMissing(skillsDir);
    skillsManager.scanSkills();
  } catch (err: any) { console.warn(`[Skills] Recovery failed: ${err.message}`); }
});
// Deferred: forcing getAll() here would pull the full skill scan back before
// listen. The empty-catalog recovery runs once the post-listen warm finishes.
setTimeout(() => { try { recoverSkillsIfEmpty(); } catch {} }, 2_000).unref?.();

const heartbeatConfigPath = path.join(CONFIG_DIR_PATH, 'heartbeat', 'config.json');
const heartbeatRunner = new HeartbeatRunner({
  configPath: heartbeatConfigPath,
  handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter) =>
    handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter),
  getMainSessionId: () => getLastMainSessionId() || 'default',
  broadcast: broadcastWS,
  deliverChannels: async (text: string) => { sendTeamNotificationToChannels(text); },
  reviewAllTeams: async () => {
    const teams = listManagedTeams();
    let reviewed = 0; let failed = 0;
    for (const team of teams) {
      try { const result = await triggerManagerReview(team.id, broadcastTeamEvent); if (result) reviewed += 1; } catch { failed += 1; }
    }
    return { reviewed, failed };
  },
  resolveAgentWorkspace: (agentId: string) => {
    try {
      const agent = getAgentById(agentId);
      if (!agent) return null;
      const subagentPath = path.join(getConfig().getWorkspacePath(), '.prometheus', 'subagents', agentId);
      if (fs.existsSync(subagentPath)) return subagentPath;
      return ensureAgentWorkspace(agent);
    } catch { return null; }
  },
});

setHeartbeatRunnerInstance(heartbeatRunner);
startupMark('heartbeat runner constructed');

const brainRunner = new BrainRunner({
  handleChat: createBrainHandleChatAdapter(handleChat),
  broadcast: broadcastWS,
  workspacePath: getConfig().getWorkspacePath(),
  skillsManager,
});
setBrainRunnerInstance(brainRunner);
startupMark('brain runner constructed');
{
  const mainWorkspace = getConfig().getWorkspacePath();
  const mainHeartbeatPath = path.join(mainWorkspace, 'HEARTBEAT.md');
  if (!fs.existsSync(mainHeartbeatPath)) {
    fs.writeFileSync(mainHeartbeatPath, [
      '# HEARTBEAT.md - Main',
      '',
      '## Heartbeat Checklist',
      '- Review active priorities and pending follow-ups.',
      '- Execute only actionable maintenance/ops tasks.',
      '- Write any artifacts to workspace files.',
      '- If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else. This is the silence token and must not notify the user.',
      '- When creating or editing any HEARTBEAT.md for yourself or another agent, always keep this HEARTBEAT_OK silence rule in that file.',
    ].join('\n'), 'utf-8');
  }
  heartbeatRunner.registerAgent('main', mainWorkspace);
}
(function registerSubagentHeartbeats() {
  try {
    // Heartbeats are available only to agents that are still configured.  The
    // previous directory scan resurrected deleted agents whenever an old
    // workspace folder remained on disk.
    for (const agent of getAgents()) {
      if (!agent || agent.id === 'main' || agent.default === true) continue;
      const agentDir = ensureAgentWorkspace(agent);
      const heartbeatPath = path.join(agentDir, 'HEARTBEAT.md');
      if (!fs.existsSync(heartbeatPath)) {
        fs.writeFileSync(heartbeatPath, [
          `# HEARTBEAT.md - ${agent.id}`,
          '',
          '## Heartbeat Checklist',
          '- Perform only clearly actionable tasks for this role.',
          '- Persist outputs to files in this workspace.',
          '- If no action was taken or nothing applies, reply exactly HEARTBEAT_OK and nothing else. This is the silence token and must not notify the user.',
          '- When creating or editing any HEARTBEAT.md for yourself or another agent, always keep this HEARTBEAT_OK silence rule in that file.',
        ].join('\n'), 'utf-8');
      }
      heartbeatRunner.registerAgent(agent.id, agentDir);
      console.log(`[HeartbeatRunner] Auto-registered configured agent "${agent.id}"`);
    }
  } catch (err: any) { console.warn('[HeartbeatRunner] Subagent auto-registration failed:', err?.message); }
})();
startupMark('heartbeat agents registered');

// ─── B6: Wire chat router ──────────────────────────────────────────────────────
initChatRouterLazy({ cronScheduler, telegramChannel, skillsManager });
initTaskRouter({ handleChat, telegramChannel, makeBroadcastForTask, cronScheduler });
if (!isTaskRouterInitialized()) {
  throw new Error('[startup] Task recovery router failed to initialize');
}
startupMark('chat router init deferred');

const mainChatTimerRunner = new MainChatTimerRunner({
  runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, modelOverride) =>
    runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, undefined, modelOverride),
  telegramChannel,
});
mainChatTimerRunner.start();

const internalWatchRunner = new InternalWatchRunner({
  runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOriginInput) =>
    runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOriginInput),
  broadcast: broadcastWS,
  cronScheduler,
});
const activeThreadSupervisionController = new ActiveThreadSupervisionController({
  runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOriginInput) =>
    runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOriginInput),
  routeOwnerReviewToVoice: (ownerSessionId, prompt) =>
    getCodexRealtimeBridge().appendRealtimeTextForOwner(ownerSessionId, prompt),
  // Supervision is a hidden persistent checkpoint loop. The owner chat/voice
  // runtime is reserved for the terminal notification, not review turns.
  persistentSupervisorLoop: true,
  broadcast: broadcastWS,
});
let stopThreadSupervisionRunner: () => void = () => undefined;
startupMark('recovery-aware timers constructed');

// ─── A2 + A5: CIS tool dependency injection ────────────────────────────────
injectAnalysisTeamDeps({ workspacePath: getConfig().getWorkspacePath(), broadcast: broadcastWS });
injectSocialScraperDeps({ workspacePath: getConfig().getWorkspacePath(), broadcast: broadcastWS });
startupMark('tool deps injected');

// ─── Jarvis Fix #1: Wire live push so team events arrive without user prompting ─
setNotifyBroadcastFn(broadcastWS);

const app = createApp();
startupMark('express app created');

app.use((req, _res, next) => {
  try {
    const path = String(req.path || '').trim();
    if (path === '/api/voice/transcribe' || path === '/api/mobile/voice-debug' || path === '/api/realtime/call') {
      const ua = String(req.headers['user-agent'] || '').slice(0, 160);
      const pairing = req.headers['x-pairing-token'] ? 'pairing=yes' : 'pairing=no';
      appendMobileVoiceDebugLog(`[${new Date().toISOString()}] [voice-preauth] ${req.method} ${path} ${pairing} ua="${ua}"\n`);
    }
  } catch {}
  next();
});

function appendMobileVoiceDebugLog(line: string): void {
  try {
    const configured = String(process.env.PROM_VOICE_DEBUG_LOG || '').trim();
    const logPath = configured || path.join(getConfig().getWorkspacePath(), 'workspace', 'logs', 'voice-debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch {
    try { console.warn('[voice-debug] failed to append mobile voice debug log'); } catch {}
  }
}

app.post('/api/mobile/voice-debug', (req, res) => {
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 160);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const safe = {
      event: String((body as any).event || '').slice(0, 80),
      route: String((body as any).route || '').slice(0, 120),
      mode: String((body as any).mode || '').slice(0, 40),
      data: (body as any).data || {},
    };
    appendMobileVoiceDebugLog(`[${new Date().toISOString()}] [voice-client] ua="${ua}" ${JSON.stringify(safe).slice(0, 1200)}\n`);
  } catch {}
  res.json({ success: true });
});

app.get('/api/status', requireGatewayAuth, requireAccountAccess, (_req, res) => {
  const rawCfg = getConfig().getConfig() as any;
  const provider: string = rawCfg.llm?.provider || 'ollama';
  const isCloudProvider = provider === 'openai' || provider === 'openai_codex' || provider === 'anthropic' || provider === 'perplexity' || provider === 'gemini';
  const cachedProviderStatus = readProviderStatusCache();
  const connected = isCloudProvider ? true : !!cachedProviderStatus?.connected;
  const providerChecking = !isCloudProvider && !cachedProviderStatus && isProviderStatusChecking();
  const providerCfg = rawCfg.llm?.providers?.[provider] || {};
  const activeModel: string = providerCfg.model || rawCfg.models?.primary || 'unknown';
  const workspacePath = String(rawCfg.workspace?.path || getConfig().getWorkspacePath() || '').trim();
  res.json({
    status: 'ok',
    version: 'v2-tools',
    ollama: connected,
    providerOnline: connected,
    providerChecking,
    provider,
    currentModel: activeModel,
    reasoningEffort: String(providerCfg.reasoning_effort || '').trim(),
    workspace: rawCfg.workspace?.path || '',
    search: rawCfg.search?.tinyfish_api_key ? 'tinyfish' : rawCfg.search?.google_api_key ? 'google' : (rawCfg.search?.tavily_api_key ? 'tavily' : 'none'),
    orchestration: null,
    chatRouter: getChatRouterWarmupStatus(),
    memory: {
      searchWorker: getMemorySearchWorkerStatus(),
      automaticSearchWorkers: getAutomaticMemorySearchWorkerStatus(),
      refreshWorker: getMemoryIndexRefreshWorkerStatus(),
    },
    gatewayQueues: {
      contextBuild: getContextBuildLimiterStatus(),
      contextBuildWorkers: getContextBuildWorkerPoolStatus(),
      modelCallWorkers: getModelCallWorkerPoolStatus(),
      brainActivityWorker: getBrainActivityWorkerStatus(),
      postTurn: getPostTurnQueueStatus(),
      sessionPersistence: getSessionPersistenceStatus(),
      sessionCache: getSessionCacheStatus(),
      chatAuditPersistence: getChatAuditPersistenceStatus(),
      runtimePersistence: getLiveRuntimePersistenceStatus(),
      runtimeWorkers: getRuntimeWorkerDiagnostics(),
      runtimeAdmission: gatewayRuntimeAdmission.snapshot(),
    },
  });
});

app.post('/api/internal/shutdown', (req, res) => {
  const addr = req.socket.remoteAddress || '';
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ ok: true });
  setImmediate(() => gracefulShutdown('SIGTERM'));
});

function getUpdatePreflightForInternalRequest() {
  const sessions = getSessionPersistenceStatus();
  const chatAudit = getChatAuditPersistenceStatus();
  const runtimePersistence = getLiveRuntimePersistenceStatus();
  const activeOperations = listLiveRuntimes().filter((runtime) => runtime.status === 'running' || runtime.status === 'interrupted').length;
  const pendingWrites = Number(sessions.pending || 0)
    + Number(chatAudit.pendingBatches || 0)
    + Number(chatAudit.pendingRecords || 0)
    + Number(runtimePersistence.pendingEvents || 0);
  return {
    ...evaluateUpdatePreflight({
      activeOperations,
      pendingWrites,
      persistenceBusy: Boolean(
        sessions.active || sessions.scheduled || chatAudit.active || chatAudit.scheduled
        || runtimePersistence.active || runtimePersistence.scheduled || runtimePersistence.ledgerDirty,
      ),
    }),
    persistence: { sessions, chatAudit, runtimePersistence },
  };
}

app.get('/api/internal/update-preflight', (req, res) => {
  const addr = req.socket.remoteAddress || '';
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ ok: true, preflight: getUpdatePreflightForInternalRequest() });
});

app.post('/api/internal/update-drain', async (req, res) => {
  const addr = req.socket.remoteAddress || '';
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  try {
    const before = getUpdatePreflightForInternalRequest();
    if (before.activeOperations > 0) {
      res.status(409).json({ ok: false, preflight: before });
      return;
    }
    // The Electron main process performs the final active-runtime check before
    // calling this endpoint. Draining here is still idempotent and makes the
    // boundary explicit: no installer is started until durable queues settle.
    flushAllSessions();
    await Promise.all([
      flushPendingSessionWrites(),
      flushPendingChatAuditWrites(),
      flushLiveRuntimePersistence(),
    ]);
    const preflight = getUpdatePreflightForInternalRequest();
    res.json({ ok: preflight.ready, preflight });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Durable Prometheus state could not be drained safely.' });
  }
});

// ─── Router Registrations ────────────────────────────────────────────────────

// Wire deps into routers
setSkillsRouterManager(skillsManager);
setHubRouterDeps({ skillsManager });
initTasksRouter({ cronScheduler, telegramChannel, handleChat, heartbeatRunner, configDirPath: CONFIG_DIR_PATH });
initChannelsRouter({
  cronScheduler,
  telegramChannel,
  telegramPersonaBots,
  telegramTeamRoomBridge,
  skillsManager,
  dispatchToAgent: _dispatchToAgent,
  runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOrigin) =>
    runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, reasoningOptions, attachments, attachmentPreviews, modelOverride, flags, turnOrigin),
});
initTeamsRouter({
  cronScheduler, handleChat, telegramChannel,
  sanitizeAgentId, normalizeAgentsForSave,
  bindTeamNotificationTargetFromSession,
});
initCanvasRouter({ requireGatewayAuth, broadcastWS });
initSettingsRouter({ requireGatewayAuth });
initGoalsRouter({ requireGatewayAuth, cronScheduler, telegramChannel, handleChat });
startupMark('routers initialized');

// Pairing is mounted before gateway auth only so certificate/claim/poll can be
// reached by an unpaired phone. Desktop administration is independently gated
// inside pairingRouter and never accepts a paired-device credential.
app.use('/', pairingRouter);
// Mount routers. Account auth endpoints stay available after gateway auth so
// users can log in, refresh status, or recover from an expired subscription.
// Everything else requires an active account/subscription on the server side.
app.use('/', requireGatewayAuth, accountRouter);
app.use('/', requireGatewayAuth, realtimeRouter);
app.use('/', requireGatewayAuth, voiceRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, skillsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, tasksRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, channelsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, teamsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, settingsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, goalsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, proposalsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, auditLogRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, connectionsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, connectionsV2Router);
app.use('/', requireGatewayAuth, requireAccountAccess, extensionsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, canvasRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, resourcesRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, projectsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, memoryRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, obsidianRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, hubRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, migrationRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, importsRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, processesRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, processHygieneRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, codingRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, chatRouter);
app.use('/', requireGatewayAuth, requireAccountAccess, onboardingRouter);

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!isStorageBoundaryError(err)) {
    next(err);
    return;
  }
  res.status(400).json({ success: false, error: err.message });
});
startupMark('routers mounted');

// ─── Server ────────────────────────────────────────────────────────────────────
const httpsGateway = loadGatewayHttpsOptions();
const getGatewayQueueStatus = () => ({
  contextBuild: getContextBuildLimiterStatus(),
  contextBuildWorkers: getContextBuildWorkerPoolStatus(),
  modelCallWorkers: getModelCallWorkerPoolStatus(),
  brainActivityWorker: getBrainActivityWorkerStatus(),
  postTurn: getPostTurnQueueStatus(),
  sessionPersistence: getSessionPersistenceStatus(),
  sessionCache: getSessionCacheStatus(),
  chatAuditPersistence: getChatAuditPersistenceStatus(),
  runtimePersistence: getLiveRuntimePersistenceStatus(),
  runtimeWorkers: getRuntimeWorkerDiagnostics(),
  runtimeAdmission: gatewayRuntimeAdmission.snapshot(),
  memory: {
    searchWorker: getMemorySearchWorkerStatus(),
    automaticSearchWorkers: getAutomaticMemorySearchWorkerStatus(),
    refreshWorker: getMemoryIndexRefreshWorkerStatus(),
  },
});

// Identity surface for a phone's gateway catalog and target capability check. The paired-device
// token is checked by requireGatewayAuth; no token is accepted in the query
// string on this route. Descriptor metadata is deliberately available to a
// paired device without forwarding this gateway's account cookie/session.
const rejectPairingQueryToken = (req: Request, res: Response, next: NextFunction) => {
  if (String(req.query?.pt || '').trim()) {
    res.status(401).json({ error: 'Pairing credentials must use X-Pairing-Token.' });
    return;
  }
  next();
};

app.get('/api/gateway/descriptor', rejectPairingQueryToken, requireGatewayAuth, (req, res) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.secure ? 'https' : 'http');
  const host = String(req.headers.host || '').trim();
  const origin = host ? `${protocol}://${host}` : '';
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, gateway: getGatewayDescriptor(origin) });
});
const { server, wss } = createServer(app, PORT, HOST, undefined, httpsGateway?.port, getGatewayQueueStatus);
const secureBundle = httpsGateway
  ? createServer(app, httpsGateway.port, HTTPS_HOST, httpsGateway.options, undefined, getGatewayQueueStatus)
  : null;
const xaiVoiceStreaming = attachXaiVoiceStreaming(server);
const secureXaiVoiceStreaming = secureBundle ? attachXaiVoiceStreaming(secureBundle.server) : null;
const openAiRealtimeProxy = attachOpenAiRealtimeProxy(server);
const secureOpenAiRealtimeProxy = secureBundle ? attachOpenAiRealtimeProxy(secureBundle.server) : null;
startupMark('http server created');
initializeRuntimeProgressLease();
startRuntimeHeartbeat();
setProposalsBroadcast(broadcastWS);
setupErrorResponseEndpoint(app);
startupMark('error endpoints setup');

// ── Wire lifecycle shutdown hooks for gracefulRestart() ────────────────────
// These enable lifecycle.ts to cleanly shut down all subsystems before respawning.
setShutdownHooks({
  stopTelegram: () => { telegramChannel.stop(); telegramPersonaBots.stop().catch(() => {}); },
  stopCron: () => cronScheduler.stop(),
  stopAutoSettle: () => stopAutoSettleScheduler(),
  stopTimers: () => mainChatTimerRunner.stop(),
  stopInternalWatches: () => internalWatchRunner.stop(),
  stopHeartbeat: () => heartbeatRunner.stop(),
  stopBrain: () => brainRunner.stop('gateway_restart'),
  stopRuntimeWorkers: () => {
    stopThreadSupervisionRunner();
    shutdownCodexRealtimeBridge();
    return Promise.all([
      shutdownMemorySearchWorker(),
      shutdownMemoryIndexRefreshWorker(),
      shutdownContextBuildWorkerPool(),
      shutdownModelCallWorkerPool(),
      shutdownBrainActivityWorker(),
    ]).then(() => undefined);
  },
  closeWebSocket: () => {
    // WebSocket upgrades are removed from the HTTP socket set, so
    // closeAllConnections() cannot drain them. Terminate clients before
    // closing the WebSocket server; otherwise server.close() falls through to
    // the two-second force timer on every supervised restart.
    const terminateClients = (socketServer: any): void => {
      try {
        socketServer?.clients?.forEach((client: any) => {
          try { client.terminate(); } catch {}
        });
      } catch {}
      try { socketServer?.close(); } catch {}
    };
    terminateClients(wss);
    terminateClients(secureBundle?.wss);
    try { xaiVoiceStreaming.close(); } catch {}
    try { secureXaiVoiceStreaming?.close(); } catch {}
    try { openAiRealtimeProxy.close(); } catch {}
    try { secureOpenAiRealtimeProxy?.close(); } catch {}
  },
  closeHttpServer: () => new Promise<void>((resolve) => {
    try {
      // Keep-alive probes and idle browser sockets otherwise make
      // server.close wait for the two-second force timer on every restart.
      try { (server as any).closeIdleConnections?.(); } catch {}
      try { (secureBundle?.server as any)?.closeIdleConnections?.(); } catch {}
      // Stop accepting first, then terminate established HTTP connections. The
      // ordering matters on Node: closeAllConnections called before close can
      // race with a new health/keep-alive probe and leave server.close waiting
      // for the force timer.
      server.close(() => resolve());
      try { secureBundle?.server.close(); } catch {}
      try { (server as any).closeAllConnections?.(); } catch {}
      try { (secureBundle?.server as any)?.closeAllConnections?.(); } catch {}
      setTimeout(resolve, 2000); // force-resolve after 2s
    } catch { resolve(); }
  }),
  flushSessions: async () => {
    const t0 = Date.now();
    let counts = { flushed: 0, skipped: 0 };
    try { counts = flushAllSessions(); } catch {}
    const t1 = Date.now();
    const timed = async (fn: () => Promise<unknown>) => { const s = Date.now(); try { await fn(); } catch {} return Date.now() - s; };
    const [auditMs, runtimeMs] = await Promise.all([
      timed(() => flushPendingChatAuditWrites()),
      timed(() => flushLiveRuntimePersistence()),
    ]);
    console.log(`[lifecycle] session flush: sessions=${t1 - t0}ms (flushed=${counts.flushed} skipped=${counts.skipped}) audit=${auditMs}ms runtimes=${runtimeMs}ms`);
  },
  // Warm handoff: this process keeps its in-flight runtimes (and the model /
  // context workers they depend on) but must not start anything new. The
  // replacement gateway owns polling, scheduling, and supervision from here.
  stopSchedulersForHandoff: () => {
    draining = true;
    try { telegramChannel.stop(); } catch {}
    try { telegramPersonaBots.stop().catch(() => {}); } catch {}
    try { cronScheduler.stop(); } catch {}
    try { stopAutoSettleScheduler(); } catch {}
    try { mainChatTimerRunner.stop(); } catch {}
    try { internalWatchRunner.stop(); } catch {}
    try { heartbeatRunner.stop(); } catch {}
    try { brainRunner.suspendScheduling(); } catch {}
    try { stopThreadSupervisionRunner(); } catch {}
    try { shutdownCodexRealtimeBridge(); } catch {}
  },
  // Release the listeners so the replacement can bind, but leave established
  // connections (in-flight chat SSE responses) alone: they end when their turn
  // ends. WebSocket clients are terminated so they reconnect to the replacement.
  closeListenersForHandoff: () => new Promise<void>((resolve) => {
    const terminateClients = (socketServer: any): void => {
      try {
        socketServer?.clients?.forEach((client: any) => {
          try { client.terminate(); } catch {}
        });
      } catch {}
      try { socketServer?.close(); } catch {}
    };
    terminateClients(wss);
    terminateClients(secureBundle?.wss);
    try { xaiVoiceStreaming.close(); } catch {}
    try { secureXaiVoiceStreaming?.close(); } catch {}
    try { openAiRealtimeProxy.close(); } catch {}
    try { secureOpenAiRealtimeProxy?.close(); } catch {}
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      try { (server as any).closeIdleConnections?.(); } catch {}
      try { (secureBundle?.server as any)?.closeIdleConnections?.(); } catch {}
      // server.close() only stops the listener; its callback waits for every
      // connection, which is exactly what we do not want to wait for here.
      server.close();
      try { secureBundle?.server.close(); } catch {}
      server.once('close', done);
      setTimeout(done, 1_000);
    } catch { done(); }
  }),
});

// ─── Initialize Advanced Error Response Systems ────────────────────────────────
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const credentialHandler = initCredentialHandler(encryptionKey);
const verificationFlowManager = getVerificationFlowManager();
const errorAnalyzer = getErrorAnalyzer();
const errorHistory = getErrorHistory();
const retryStrategy = getRetryStrategy();
const visualErrorDetector = getVisualErrorDetector();
const errorAudit = getErrorAudit(process.env.ERROR_AUDIT_LOG_PATH || path.join(CONFIG_DIR_PATH, 'logs', 'audit.log'));
const contextInjectionManager = getContextInjectionManager();
startupMark('advanced systems initialized');

console.log('[Server] ✅ Advanced error response systems initialized');
try { seedDefaultShortcuts(); console.log('[SiteShortcuts] Default shortcuts seeded.'); } catch (e: any) { console.warn('[SiteShortcuts] Seed failed:', e.message); }
try {
  compactRuntimeStateOnStartup();
  const runtimeWarmup = warmLiveRuntimePersistence();
  console.log(`[live-runtime] Loaded ${runtimeWarmup.runtimes} durable runtime(s) before accepting traffic.`);
} catch (e: any) {
  console.warn('[live-runtime] Startup ledger warmup failed:', e?.message || e);
}
try {
  const taskLookupIndex = prepareTaskReplyLookupIndex();
  if (taskLookupIndex.rebuilt) {
    console.log(`[tasks] Upgraded compact reply lookup index for ${taskLookupIndex.taskCount} task(s) before accepting traffic.`);
  }
  startupMark('task reply lookup index prepared');
} catch (e: any) {
  // The lookup retains its conservative legacy compatibility route if this
  // best-effort startup upgrade cannot run.
  console.warn('[tasks] Compact reply lookup index warmup failed:', e?.message || e);
}

async function startGatewayListeners(): Promise<void> {
  let deferredMainChatRecoveries: LiveRuntimeSnapshot[] = [];
  // A previous gateway may still be draining runtimes it owns (warm handoff).
  // Adopt it before runtime recovery so that work is mirrored, not "crashed".
  try {
    const adoption = await adoptGatewayHandoffHostsAtBoot();
    if (adoption.hosts || adoption.staleManifests || adoption.unreachable) {
      console.log(`[gateway-handoff] Adopted ${adoption.hosts} draining gateway(s)${adoption.staleManifests ? `, cleared ${adoption.staleManifests} stale manifest(s)` : ''}${adoption.unreachable ? `, ${adoption.unreachable} unreachable` : ''}.`);
    }
    startupMark('handoff hosts adopted');
  } catch (err: any) {
    console.warn('[gateway-handoff] Adoption failed:', err?.message || err);
  }
  try {
    const atomCount = warmMemoryAtomSnapshot(getConfig().getWorkspacePath());
    console.log(`[memory-atoms] Preloaded ${atomCount} durable MEMORY.md atoms.`);
  } catch (error: any) {
    console.warn('[memory-atoms] Preload failed; prompt turns will retry lazily:', error?.message || error);
  }
  // Import the chat router while the child workers finish booting; both used
  // to run back-to-back.
  warmChatRouter('pre-listen');
  startupMark('chat router prewarmed before listen');
  const [contextWarmup, memoryWarmup, automaticMemoryWarmup] = await Promise.allSettled([
    earlyWorkerWarmups?.context ?? warmContextBuildWorkerPool(),
    // Listener readiness depends on the child processes being IPC-ready. The
    // optional SQLite/FTS first-query prewarms continue asynchronously so a
    // slow cold index cannot keep the gateway unavailable for 15 seconds.
    earlyWorkerWarmups?.memory ?? warmMemorySearchWorker(getConfig().getWorkspacePath(), { awaitPrewarm: false }),
    earlyWorkerWarmups?.automaticMemory ?? warmAutomaticMemorySearchWorkers(getConfig().getWorkspacePath(), { awaitPrewarm: false }),
  ]);
  if (contextWarmup.status === 'fulfilled') {
    console.log('[context-build] Worker pool prewarmed before accepting traffic.');
    startupMark('context build workers prewarmed');
  } else {
    // Keep the gateway available with the existing bounded in-process fallback
    // if a child worker cannot start, but never expose a half-warmed success.
    console.warn('[context-build] Worker pool prewarm failed before listen:', contextWarmup.reason?.message || contextWarmup.reason);
    startupMark('context build worker prewarm failed');
  }
  if (memoryWarmup.status === 'fulfilled') {
    console.log('[memory-search] Query worker process ready; first-query prewarm running asynchronously.');
    startupMark('memory search worker process ready');
  } else {
    // Search remains lazy and isolated if the optional prewarm cannot start.
    console.warn('[memory-search] Query worker prewarm failed before listen:', memoryWarmup.reason?.message || memoryWarmup.reason);
    startupMark('memory search worker prewarm failed');
  }
  if (automaticMemoryWarmup.status === 'fulfilled') {
    console.log('[memory-search] Automatic query worker processes ready; first-query prewarms running asynchronously.');
    startupMark('automatic memory search worker processes ready');
  } else {
    console.warn('[memory-search] Automatic query worker prewarm failed before listen:', automaticMemoryWarmup.reason?.message || automaticMemoryWarmup.reason);
    startupMark('automatic memory search worker prewarm failed');
  }

  // The chat router is loaded above (before the worker await) so the first
  // request never races a lazy router/tool-surface import after restart.

  // Finish the synchronous/background wiring that historically ran one second
  // after listen. Some of those startup phases perform large synchronous
  // ledger/index work; keeping them before the listener prevents a port-open
  // but event-loop-blocked window where the first message can time out or lose
  // its tool surface.
  try {
    setStartupMarkSink((label) => startupMark(`runStartup: ${label}`));
    deferredMainChatRecoveries = await runStartup({
      HOST, PORT, config, skillsManager, cronScheduler, heartbeatRunner, brainRunner, telegramChannel,
      handleChat, retriggerInterruptedMainChat, buildTools, runTeamAgentViaChat,
    });
    // The shutdown hook is installed at module initialization. The first
    // supervision recovery/tick can inspect session state synchronously, so
    // start it after the listener is bound rather than making health wait for
    // an otherwise non-critical scan.
    startupMark('recovery-aware timers prepared before listen');
  } catch (err: any) {
    console.error('[Gateway] Pre-listen startup error:', err?.message || err);
  }

  server.listen(PORT, HOST, () => {
    startupMark('server listen callback');
    skillsManager.warmInBackground((count, ms) => startupMark(`skills warmed after listen (${count} in ${ms}ms)`));
    // The mobile model picker's first open after a restart used to pay a
    // ~1.5s cold build of the provider catalog. Build it once off the
    // critical path so the first picker open is served warm.
    setTimeout(() => {
      const startedAt = Date.now();
      import('../extensions/catalog-service.js')
        .then(({ buildExtensionsCatalog }) => {
          buildExtensionsCatalog('provider');
          startupMark(`provider catalog warmed after listen (${Date.now() - startedAt}ms)`);
        })
        .catch(() => {});
    }, 250);
    // Boot the warm model-call worker now so the first turn after a restart
    // (usually a resumed one) does not pay a cold child boot before the
    // provider request is even sent.
    try { startupMark(`model workers prewarmed (${prewarmModelCallWorkers()})`); } catch {}
    const isHotRestartBoot = process.env.PROMETHEUS_HOT_RESTART === '1';
    try { startHandoffSyntheticRuntimeFixture(); } catch {}
    // Foreground recovery checkpoints are durable before the listener binds,
    // but their model turns are deliberately drained only after readiness.
    // Start one at a time and wait for the shared model-busy guard to clear so
    // a restart cannot immediately recreate a CPU-bound context backlog.
    if (deferredMainChatRecoveries.length > 0) {
      // A self-triggered mid-turn restart is a suspension of a turn the user is
      // actively watching, so it must resume promptly. Only crash recovery pays
      // the long cool-down that exists to avoid recreating a CPU-bound backlog.
      //
      // The cadence is chosen PER RUNTIME rather than for the whole queue. A
      // queue-wide `.some()` let a single planned continuation pull every
      // crash-recovered turn into the fast lane with it, which is exactly the
      // backlog the cool-down is meant to prevent.
      //
      // Note that a turn which explicitly owns its restart normally resumes
      // through BOOT (resumableForegroundRuntimeIds -> resumePlannedRestartMainChats),
      // not through this queue: startup recovery deliberately excludes planned
      // boundaries from the deferred queue so the tool-owning turn is not replayed
      // twice. That ownership rule is intentional and is left intact here. The fast
      // lane stays for the runtimes that legitimately reach this queue, and the
      // corrected classifier is what stops crash recovery from claiming it.
      const plannedDelayMs = Math.max(250, Number(process.env.PROMETHEUS_PLANNED_RESTART_RESUME_DELAY_MS || 1_500));
      const crashDelayMs = isHotRestartBoot
        ? Math.max(30_000, Number(process.env.PROMETHEUS_HOT_STARTUP_RECOVERY_DELAY_MS || 60_000))
        : Math.max(10_000, Number(process.env.PROMETHEUS_STARTUP_RECOVERY_DELAY_MS || 30_000));
      const recoveryQueue = [...deferredMainChatRecoveries];
      // Planned continuations resume first; they are the turns a user is watching.
      recoveryQueue.sort((a, b) => Number(isPlannedMainChatRestartRuntime(b)) - Number(isPlannedMainChatRestartRuntime(a)));

      // First crash retry of a lone turn: the user is usually watching it, and
      // the per-turn attempt cap (MAX_AUTOMATIC_MAIN_CHAT_RECOVERY_ATTEMPTS)
      // already stops a crash loop. The long cool-down is kept for repeat
      // attempts and for multi-turn backlogs, which is what it exists for.
      const firstCrashRetryDelayMs = Math.max(1_000, Number(process.env.PROMETHEUS_FIRST_CRASH_RETRY_DELAY_MS || 4_000));
      const delayForRuntime = (runtime: LiveRuntimeSnapshot | undefined): number => {
        if (!runtime) return crashDelayMs;
        if (isPlannedMainChatRestartRuntime(runtime)) return plannedDelayMs;
        return isFirstLoneCrashRetry(runtime, recoveryQueue.length) ? firstCrashRetryDelayMs : crashDelayMs;
      };
      // Planned continuations also must not sit behind the model-busy poll for
      // a full cycle; keep their retry cadence tight.
      const pollForRuntime = (runtime: LiveRuntimeSnapshot | undefined): number => (
        runtime && isPlannedMainChatRestartRuntime(runtime) ? 750 : 5_000
      );
      const scheduleRecoveryDrain = (delayMs: number): void => {
        const timer = setTimeout(drainRecoveryQueue, delayMs);
        if (typeof (timer as any).unref === 'function') (timer as any).unref();
      };
      const drainRecoveryQueue = (): void => {
        if (shuttingDown || draining || recoveryQueue.length === 0) return;
        if (isModelBusy()) {
          scheduleRecoveryDrain(pollForRuntime(recoveryQueue[0]));
          return;
        }
        const runtime = recoveryQueue.shift();
        if (!runtime) return;
        if (!retriggerDeferredMainChatRuntime(runtime, retriggerInterruptedMainChat)) {
          recoveryQueue.push(runtime);
        }
        scheduleRecoveryDrain(pollForRuntime(recoveryQueue[0]));
      };
      const firstDelayMs = delayForRuntime(recoveryQueue[0]);
      scheduleRecoveryDrain(firstDelayMs);
      startupMark(`foreground recovery deferred ${firstDelayMs}ms (${recoveryQueue.length} turn(s))`);

    }
    // Internal watches are durable, but their first scan can inspect task and
    // session state synchronously. Bind the listener first and give health and
    // restart clients a short scheduling window before starting that watcher.
    const delayedInternalWatchStart = setTimeout(() => {
      if (shuttingDown || draining) return;
      startupMark('internal watch callback entered');
      internalWatchRunner.start();
      startupMark('internal watch runner started after listen');
    }, 250);
    if (typeof (delayedInternalWatchStart as any).unref === 'function') (delayedInternalWatchStart as any).unref();
    const delayedThreadSupervisionStart = setTimeout(() => {
      if (shuttingDown || draining) return;
      startupMark('thread supervision callback entered');
      const supervisionStartAt = Date.now();
      stopThreadSupervisionRunner = activeThreadSupervisionController.start();
      startupMark(`thread supervision started after listen (${Date.now() - supervisionStartAt}ms)`);
    }, 750);
    if (typeof (delayedThreadSupervisionStart as any).unref === 'function') (delayedThreadSupervisionStart as any).unref();
    // Silently refresh persisted Supabase session so users stay logged in
    startupMark('persisted account refresh begin');
    const persistedAccountRefresh = refreshPersistedSession();
    startupMark('persisted account refresh scheduled');
    persistedAccountRefresh.catch(() => {});
    // Vault key derivation is valuable for later connector reads but is not a
    // readiness dependency. PBKDF2 still consumes a full CPU core for roughly
    // 20–30s on this workspace and can delay unrelated timers even though it is
    // dispatched asynchronously. Keep it outside the first restart/health
    // window; a hot replacement gets a longer idle grace period because another
    // restart is most likely while the previous build/apply is still settling.
    const vaultWarmupDelayMs = isHotRestartBoot
      // Hot restarts resume a turn within ~1.5 s, and every cold vault read on
      // that turn is a ~150 ms synchronous PBKDF2 on the event loop. Warming on
      // the libuv pool right away (concurrency 1, ~22 entries) keeps those
      // reads off the resumed turn's critical path.
      ? Math.max(0, Number(process.env.PROMETHEUS_HOT_VAULT_WARMUP_DELAY_MS || 250))
      : Math.max(5_000, Number(process.env.PROMETHEUS_VAULT_WARMUP_DELAY_MS || 15_000));
    const vaultWarmupTimer = setTimeout(() => {
      void getVault(CONFIG_DIR_PATH).prewarmDerivedKeysAsync().then((vaultWarmup) => {
        console.log(`[Vault] Prewarmed ${vaultWarmup.warmed}/${vaultWarmup.entries} derived key(s) asynchronously after readiness.`);
      }).catch((err: any) => {
        console.warn('[Vault] Async derived-key warmup failed:', err?.message || err);
      });
    }, vaultWarmupDelayMs);
    if (typeof (vaultWarmupTimer as any).unref === 'function') (vaultWarmupTimer as any).unref();
    // Give the listener a real scheduling window before BOOT/hooks begin. The
    // hook handler can construct a large snapshot or enter the model path; a
    // short post-bind delay keeps /api/health responsive even in TSX mode.
    // A pending restart context means a turn the user is actively watching is
    // waiting on BOOT to resume it (planned gateway_restart/apply). The long
    // hot-boot grace existed to protect health probes from a heavy BOOT
    // snapshot, but on every self-restart it simply added ~5s of dead time
    // before the resumed turn could start. Keep a short scheduling window so
    // the listener still answers first, then resume promptly.
    let plannedResumePending = false;
    try { plannedResumePending = !!readRestartContext(); } catch {}
    const postReadyDelayMs = plannedResumePending
      ? Math.max(250, Number(process.env.PROMETHEUS_PLANNED_RESUME_POST_READY_DELAY_MS || 750))
      : isHotRestartBoot
        ? Math.max(3_000, Number(process.env.PROMETHEUS_POST_READY_STARTUP_DELAY_MS || 5_000))
        : Math.max(500, Number(process.env.PROMETHEUS_POST_READY_STARTUP_DELAY_MS || 3000));
    startupMark(`post-ready startup scheduled in ${postReadyDelayMs}ms (plannedResume=${plannedResumePending})`);
    const postReadyMaintenanceTimer = setTimeout(() => {
      startupMark('post-ready workspace startup callback entered');
      startPostReadyWorkspaceStartup(getConfig().getWorkspacePath());
      startupMark('post-ready workspace startup invoked');
      flushStartupTimeline('post_ready');
    }, postReadyDelayMs);
    if (typeof (postReadyMaintenanceTimer as any).unref === 'function') (postReadyMaintenanceTimer as any).unref();
    // Usage telemetry is useful after a stable boot but has no bearing on
    // health, BOOT recovery, or the explicit quick-restart acknowledgement.
    // The current JSONL is ~31 MB / ~50k events and the indexer parses it
    // synchronously, so even a "deferred" 15s timer can monopolize the event
    // loop and grow the heap by hundreds of MB. Leave a long quiet window for
    // hot replacements and keep cold starts clear of the same burst.
    const usageWarmupDelayMs = isHotRestartBoot
      ? Math.max(30_000, Number(process.env.PROMETHEUS_HOT_USAGE_WARMUP_DELAY_MS || 60_000))
      : Math.max(15_000, Number(process.env.PROMETHEUS_USAGE_WARMUP_DELAY_MS || 30_000));
    const deferredUsageTimer = setTimeout(() => {
      try {
        const usageWarmup = warmModelUsageIndex();
        console.log(`[model-usage] Indexed ${usageWarmup.events} events after stable readiness in ${usageWarmup.durationMs}ms.`);
      } catch (e: any) {
        console.warn('[model-usage] Deferred startup index warmup failed:', e?.message || e);
      }
    }, usageWarmupDelayMs);
    if (typeof (deferredUsageTimer as any).unref === 'function') (deferredUsageTimer as any).unref();
    try {
      if (process.env.PROMETHEUS_STARTUP_MEMORY_REFRESH === '1') {
        const memoryIndexTimer = setTimeout(() => {
          scheduleMemoryIndexRefresh(getConfig().getWorkspacePath(), { minIntervalMs: 5 * 60_000, maxChangedFiles: 50 });
        }, 30_000);
        if (typeof (memoryIndexTimer as any).unref === 'function') (memoryIndexTimer as any).unref();
      }
    } catch {}
    const personaBotStartupDelayMs = isHotRestartBoot
      ? Math.max(10_000, Number(process.env.PROMETHEUS_HOT_TELEGRAM_PERSONA_STARTUP_DELAY_MS || 30_000))
      : 0;
    const personaBotStartupTimer = setTimeout(() => {
      telegramPersonaBots.start().catch((err: any) => console.error('[TelegramPersonaBots] Startup error:', err?.message || err));
    }, personaBotStartupDelayMs);
    if (typeof (personaBotStartupTimer as any).unref === 'function') (personaBotStartupTimer as any).unref();
  });

  if (secureBundle && httpsGateway) {
    secureBundle.server.listen(httpsGateway.port, HTTPS_HOST, () => {
      console.log(`[Gateway] HTTPS listener ready on https://${HTTPS_HOST}:${httpsGateway.port}`);
    });
  }
}

void startGatewayListeners();
startupMark('gateway listener startup scheduled after readiness warmup');

let shuttingDown = false;
// Warm handoff drain: deferred post-listen starters must not fire in a
// process that has already given its listeners to a replacement.
let draining = false;
let electronParentWatchdog: NodeJS.Timeout | null = null;
async function gracefulShutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const shutdownT0 = Date.now();
  const shutdownMarks: Array<{ label: string; atMs: number }> = [];
  const shutdownMark = (label: string) => { shutdownMarks.push({ label, atMs: Date.now() - shutdownT0 }); };
  const flushShutdownTimeline = () => {
    try {
      const logDir = path.join(configManager.getConfigDir(), 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'startup-timeline.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, kind: 'shutdown', signal, totalMs: Date.now() - shutdownT0, marks: shutdownMarks })}\n`);
    } catch {}
  };
  if (electronParentWatchdog) {
    clearInterval(electronParentWatchdog);
    electronParentWatchdog = null;
  }
  // Persistence or a provider worker can occasionally hang during teardown.
  // Never let that keep an Electron-owned port alive indefinitely.
  const forceExitTimer = setTimeout(() => {
    console.warn('[Gateway] Graceful shutdown timed out; forcing process exit.');
    shutdownMark('force exit timeout');
    flushShutdownTimeline();
    process.exit(0);
  }, 12_000);
  console.log('[Gateway] Shutting down...');
  try {
    const interrupted = prepareActiveRuntimesForGatewayShutdown(`signal_${signal.toLowerCase()}`);
    if (interrupted.length) console.log(`[Gateway] Preserved ${interrupted.length} runtime(s) before ${signal}.`);
  } catch (err: any) {
    console.warn('[Gateway] Runtime preservation failed:', err?.message || err);
  }
  try { credentialHandler.stop(); } catch {}
  try { verificationFlowManager.stop(); } catch {}
  console.log(`[Gateway] Received ${signal}; shutting down...`);
  try { skillsManager.persistState(); } catch {}
  try { telegramChannel.stop(); } catch {}
  try { telegramPersonaBots.stop().catch(() => {}); } catch {}
  try { getMCPManager().disconnectAll(); } catch {}
  try { cronScheduler.stop(); } catch {}
  try { stopAutoSettleScheduler(); } catch {}
  try { mainChatTimerRunner.stop(); } catch {}
  try { internalWatchRunner.stop(); } catch {}
  try { stopThreadSupervisionRunner(); } catch {}
  try { heartbeatRunner.stop(); } catch {}
  try { brainRunner.stop('gateway_shutdown'); } catch {}
  try { shutdownCodexRealtimeBridge(); } catch {}
  shutdownMark('services stopped');
  try { flushAllSessions(); } catch (err: any) {
    console.warn('[Gateway] Session flush failed:', err?.message || err);
  }
  shutdownMark('sessions flushed');
  try {
    await Promise.all([
      flushPendingChatAuditWrites(),
      flushLiveRuntimePersistence(),
    ]);
  } catch (err: any) {
    console.warn('[Gateway] Async persistence drain failed:', err?.message || err);
  }
  shutdownMark('persistence drained');
  try {
    await Promise.all([
      shutdownMemoryIndexRefreshWorker(),
      shutdownContextBuildWorkerPool(),
      shutdownModelCallWorkerPool(),
      shutdownBrainActivityWorker(),
    ]);
  } catch (err: any) {
    console.warn('[Gateway] Worker shutdown failed:', err?.message || err);
  }
  shutdownMark('workers stopped');
  try { if (wss) wss.close(); } catch {}
  try { secureBundle?.wss.close(); } catch {}
  try { xaiVoiceStreaming.close(); } catch {}
  try { secureXaiVoiceStreaming?.close(); } catch {}
  try {
    try { secureBundle?.server.close(); } catch {}
    server.close(() => {
      clearTimeout(forceExitTimer);
      shutdownMark('server closed');
      flushShutdownTimeline();
      process.exit(0);
    });
    // server.close() only stops accepting; it waits for every open socket.
    // Long-lived SSE/keep-alive clients (mobile + desktop chat streams) never
    // end on their own, so shutdown used to sit until the 12s force-exit.
    // State is already flushed above, so drop idle sockets now and the rest
    // after a short grace window for in-flight responses.
    try { (server as any).closeIdleConnections?.(); } catch {}
    const hardCloseTimer = setTimeout(() => {
      shutdownMark('open connections force-closed');
      try { (server as any).closeAllConnections?.(); } catch {}
      try { (secureBundle?.server as any)?.closeAllConnections?.(); } catch {}
    }, 400);
    hardCloseTimer.unref?.();
  } catch { flushShutdownTimeline(); process.exit(0); }
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

// Normal close uses the local shutdown endpoint. This second boundary handles
// Electron crashes, force-closes, and renderer failures: if the owning desktop
// process disappears, the gateway cleans itself up instead of orphaning its
// listener and worker tree.
const electronParentPid = Number(process.env.PROMETHEUS_ELECTRON_PID || 0);
if (Number.isInteger(electronParentPid) && electronParentPid > 0 && electronParentPid !== process.pid) {
  electronParentWatchdog = setInterval(() => {
    try {
      process.kill(electronParentPid, 0);
    } catch {
      console.warn(`[Gateway] Electron parent ${electronParentPid} is gone; shutting down orphaned gateway.`);
      void gracefulShutdown('SIGTERM');
    }
  }, 2_000);
  electronParentWatchdog.unref?.();
}

export { app, server };
