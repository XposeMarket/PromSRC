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

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../config/config';
import { getVault } from '../security/vault';
import { getOllamaClient } from '../agents/ollama-client';
import { spawnAgent } from '../agents/spawner';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getWorkspace, setWorkspace, clearHistory, cleanupSessions } from './session';
import { hookBus } from './hooks';
import { loadWorkspaceHooks } from './hook-loader';
import { runBootMd } from './boot';
import { TaskRunner, runTask, TaskTool, TaskState } from './tasks/task-runner';
import { setupErrorResponseEndpoint } from './errors/error-response-endpoint-integrated';
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
import { CronScheduler } from './scheduling/cron-scheduler';
import { HeartbeatRunner, setHeartbeatRunnerInstance } from './scheduling/heartbeat-runner';
import { BrainRunner, setBrainRunnerInstance } from './brain/brain-runner';
import {
  getAgentRunHistory, getAgentLastRun, recordAgentRun,
  stopAgentSchedules,
} from '../scheduler';
import { TelegramChannel } from './comms/telegram-channel';
import { setShutdownHooks } from './lifecycle';
import { browserVisionScreenshot, browserVisionClick, browserVisionType, browserPreviewScreenshot } from './browser-tools';
import {
  createTask, loadTask, saveTask, updateTaskStatus, setTaskStepRunning,
  updateTaskRuntimeProgress, appendJournal, updateResumeContext,
  listTasks, deleteTask, mutatePlan, getEvidenceBusSnapshot,
  type TaskRecord, type TaskStatus,
} from './tasks/task-store';
import {
  loadScheduleMemory, loadRunLog, startRunLogEntry, completeScheduledRun, formatScheduleMemoryForPrompt,
} from './scheduling/schedule-memory';
import { BackgroundTaskRunner } from './tasks/background-task-runner';
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
import { buildTeamDispatchTask } from './teams/team-dispatch-runtime';
import { checkForTeamSuggestion } from './teams/team-detector';
import { runWeeklyPerformanceReview, formatPerformanceReport, loadSelfImprovementStore, approveSkillEvolution, getWeeklyReviewJobDefinition } from './scheduling/self-improvement-engine';
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
  setTelegramChannelForBroadcaster, isModelBusy,
  getLastMainSessionId, setLastMainSessionId,
  type TelegramChannelConfig, type DiscordChannelConfig, type WhatsAppChannelConfig,
  type ChannelsConfig, normalizeTelegramConfig, normalizeDiscordConfig, normalizeWhatsAppConfig,
} from './comms/broadcaster';
import {
  getSessionSkillWindows, sessionCurrentTurn,
  recoverSkillsIfEmpty,
  initSkillWindows, setSkillRecoveryFn,
} from './skills-runtime/skill-windows';
import { separateThinkingFromContent, sanitizeFinalReply, stripExplicitThinkTags, normalizeForDedup, isGreetingLikeMessage } from './comms/reply-processor';
import {
  initTaskRouter, latestTaskForSession, findBlockedTaskForSession, findClarificationWaitingTask,
  isResumeIntent, isRerunIntent, isCancelIntent, isStatusQuestion, isTaskListIntent, isAdjustmentIntent,
  getLatestPauseContext, summarizeTaskRecord, buildBlockedTaskStatusMessage,
  parseTaskStatusFilter, getTaskScopeBuckets, parseTaskIdFromText,
  launchBackgroundTaskRunner, handleTaskControlAction, renderTaskCandidatesForHuman, tryHandleBlockedTaskFollowup,
} from './tasks/task-router';
import { router as skillsRouter, setSkillsRouterManager } from './routes/skills.router';
import { router as tasksRouter, initTasksRouter, makeBroadcastForTask } from './routes/tasks.router';
import { router as channelsRouter, initChannelsRouter, sanitizeAgentId, normalizeAgentsForSave } from './routes/channels.router';
import {
  router as teamsRouter, initTeamsRouter, pauseManagedTeamInternal, resumeManagedTeamInternal,
  buildTeamDispatchContext, runTeamAgentViaChat,
} from './routes/teams.router';
import { runTeamAgentViaChat as _runTeamAgentViaChat2, setDispatchDeps } from './teams/team-dispatch-runtime';
import { router as settingsRouter, initSettingsRouter } from './routes/settings.router';
import { router as accountRouter, refreshPersistedSession } from './routes/account.router';
import { router as goalsRouter, initGoalsRouter } from './routes/goals.router';
import { router as proposalsRouter, setProposalsBroadcast, broadcastProposalCreated } from './routes/proposals.router';
import { router as auditLogRouter } from './routes/audit-log.router';
import { router as connectionsRouter } from './routes/connections.router';
import { router as canvasRouter, initCanvasRouter } from './routes/canvas.router';
import { router as projectsRouter } from './routes/projects.router';
import { router as memoryRouter } from './routes/memory.router';
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
  isExecutionLikeRequest, isBrowserAutomationRequest, isDesktopAutomationRequest,
  extractLikelyUrl, looksLikeSafetyRefusal, looksLikeIntentOnlyReply,
  isContinuationCue, hasPendingExecutionIntent, isHardBlockerReply, hasConcreteCompletion,
  isHighStakesFile, requestedFullTemplate, resolveWorkspaceFilePath, collectFileSnapshots,
  goalIsInteractiveAction, isBrowserHeavyResearchPage, goalLikelyNeedsTextInput,
  parseSnapshotDiagnostics, evaluateBrowserSnapshotQuality,
} from './chat/chat-helpers';
import { createApp } from './core/app';
import { createServer } from './core/server';
import { runStartup } from './core/startup';
import {
  buildBootStartupSnapshot as _buildBootStartupSnapshot, loadWorkspaceFile,
  readDailyMemoryContext, detectToolCategories, readMemoryCategories, readMemorySnippets,
  buildPersonalityContext as _buildPersonalityContext,
  TOOL_BLOCKS, TOOL_TO_MEMORY_CATS, type SkillWindow,
} from './prompt-context';
import { detectGpu, logGpuStatus } from './gpu-detector';
import { internalAgentTaskRouter } from './agents-runtime/internal-agent-task';
import {
  registerAgentBuilderTools, executeAgentBuilderTool, AGENT_BUILDER_TOOL_NAMES, getWorkflowContextBlock,
} from './agents-runtime/agent-builder-integration';

// ─── B6: Chat router (handleChat + /api/chat + /api/status) ─────────────────
import { router as chatRouter, initChatRouter, handleChat, runInteractiveTurn, bindTeamNotificationTargetFromSession } from './routes/chat.router';

// ─── CIS: Tool dependency injection (A2 + A5) ────────────────────────────────
import { injectAnalysisTeamDeps } from '../tools/deploy-analysis-team';
import { injectSocialScraperDeps } from '../tools/social-scraper';
import { setNotifyBroadcastFn } from './teams/notify-bridge';

// ─── Config ────────────────────────────────────────────────────────────────────

const config = getConfig().getConfig();
const CONFIG_DIR_PATH = getConfig().getConfigDir();
const PORT = config.gateway.port || (process.env.GATEWAY_PORT ? parseInt(process.env.GATEWAY_PORT, 10) : 18789);
const HOST = config.gateway.host || process.env.GATEWAY_HOST || (process.env.DOCKER_CONTAINER ? '0.0.0.0' : '127.0.0.1');

{
  const cleaned = cleanupSessions();
  if (cleaned.deleted > 0) {
    console.log(`[session] Cleaned up ${cleaned.deleted} stale automated session file(s).`);
  }
}

const skillsDir = resolveSkillsDir(configuredSkillsDir);
const skillsManager = new SkillsManager(skillsDir);
console.log(`[Skills] Directory: ${skillsDir}`);

// ─── CronScheduler Init ────────────────────────────────────────────────────────

const cronStorePath = path.join(CONFIG_DIR_PATH, 'cron', 'jobs.json');
const cronScheduler = new CronScheduler({
  storePath: cronStorePath,
  handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter) =>
    handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter),
  broadcast: broadcastWS,
  deliverTelegram: (text: string) => telegramChannel.sendToAllowed(text),
  getMainSessionId: () => getLastMainSessionId() || 'default',
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

// ─── Telegram Channel Init ─────────────────────────────────────────────────────

const telegramChannel = new TelegramChannel(
  resolveChannelsConfig().telegram,
  {
    handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter, attachments) =>
      handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter, attachments),
    runInteractiveTurn: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, attachments) =>
      runInteractiveTurn(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, attachments),
    addMessage,
    getIsModelBusy: isModelBusy,
    broadcast: broadcastWS,
  }
);
setTelegramChannelForBroadcaster(telegramChannel);
initSkillWindows(skillsManager, skillsDir, fallbackSkillsDir);
setSkillRecoveryFn(() => {
  try {
    syncMissingSkills(fallbackSkillsDir, skillsDir);
    migrateSkillsStateIfMissing(skillsDir);
    skillsManager.scanSkills();
  } catch (err: any) { console.warn(`[Skills] Recovery failed: ${err.message}`); }
});
recoverSkillsIfEmpty();

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

const brainRunner = new BrainRunner({
  handleChat: (message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter) =>
    handleChat(message, sessionId, sendSSE, pinnedMessages, abortSignal, callerContext, modelOverride, executionMode, toolFilter),
  broadcast: broadcastWS,
  workspacePath: getConfig().getWorkspacePath(),
});
setBrainRunnerInstance(brainRunner);
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
      '- If nothing is actionable, reply with HEARTBEAT_OK.',
    ].join('\n'), 'utf-8');
  }
  heartbeatRunner.registerAgent('main', mainWorkspace);
}
(function registerSubagentHeartbeats() {
  try {
    const workspacePath = getConfig().getWorkspacePath();
    const subagentsDir = path.join(workspacePath, '.prometheus', 'subagents');
    if (!fs.existsSync(subagentsDir)) return;
    const entries = fs.readdirSync(subagentsDir);
    for (const entry of entries) {
      const agentDir = path.join(subagentsDir, entry);
      if (!fs.statSync(agentDir).isDirectory()) continue;
      const heartbeatPath = path.join(agentDir, 'HEARTBEAT.md');
      if (!fs.existsSync(heartbeatPath)) {
        fs.writeFileSync(heartbeatPath, [
          `# HEARTBEAT.md - ${entry}`,
          '',
          '## Heartbeat Checklist',
          '- Perform only clearly actionable tasks for this role.',
          '- Persist outputs to files in this workspace.',
          '- If nothing is actionable, reply with HEARTBEAT_OK.',
        ].join('\n'), 'utf-8');
      }
      heartbeatRunner.registerAgent(entry, agentDir);
      console.log(`[HeartbeatRunner] Auto-registered subagent "${entry}"`);
    }
  } catch (err: any) { console.warn('[HeartbeatRunner] Subagent auto-registration failed:', err?.message); }
})();

// ─── B6: Wire chat router ──────────────────────────────────────────────────────
initChatRouter({ cronScheduler, telegramChannel, skillsManager });

// ─── A2 + A5: CIS tool dependency injection ────────────────────────────────
injectAnalysisTeamDeps({ workspacePath: getConfig().getWorkspacePath(), broadcast: broadcastWS });
injectSocialScraperDeps({ workspacePath: getConfig().getWorkspacePath(), broadcast: broadcastWS });

// ─── Jarvis Fix #1: Wire live push so team events arrive without user prompting ─
setNotifyBroadcastFn(broadcastWS);

const app = createApp();

// ─── Router Registrations ────────────────────────────────────────────────────

function requireGatewayAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const cfg = getConfig().getConfig() as any;
  const configuredToken = String(cfg?.gateway?.auth_token || '').trim();
  if (!configuredToken) {
    const remoteIp = String(req.ip || req.socket?.remoteAddress || '');
    const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    if (isLocal) { next(); return; }
    res.status(401).json({ error: 'Unauthorized: configure gateway.auth_token to enable remote access.' });
    return;
  }
  const authHeader = String(req.headers['authorization'] || '');
  const xToken = String(req.headers['x-gateway-token'] || '');
  const provided = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : xToken.trim();
  if (!provided || provided !== configuredToken) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

// Wire deps into routers
setSkillsRouterManager(skillsManager);
initTasksRouter({ cronScheduler, telegramChannel, handleChat, heartbeatRunner, configDirPath: CONFIG_DIR_PATH });
initChannelsRouter({ cronScheduler, telegramChannel, dispatchToAgent: _dispatchToAgent });
initTeamsRouter({
  cronScheduler, handleChat, telegramChannel,
  sanitizeAgentId, normalizeAgentsForSave,
  bindTeamNotificationTargetFromSession,
});
initCanvasRouter({ requireGatewayAuth, broadcastWS });
initSettingsRouter({ requireGatewayAuth });
initGoalsRouter({ requireGatewayAuth, cronScheduler, telegramChannel, handleChat });

// Mount routers
app.use('/', skillsRouter);
app.use('/', tasksRouter);
app.use('/', channelsRouter);
app.use('/', teamsRouter);
app.use('/', settingsRouter);
app.use('/', goalsRouter);
app.use('/', proposalsRouter);
app.use('/', auditLogRouter);
app.use('/', connectionsRouter);
app.use('/', canvasRouter);
app.use('/', projectsRouter);
app.use('/', memoryRouter);
app.use('/', accountRouter);
app.use('/', chatRouter);

// ─── Server ────────────────────────────────────────────────────────────────────
const { server, wss } = createServer(app, PORT, HOST);
setProposalsBroadcast(broadcastWS);
setupErrorResponseEndpoint(app);

// ── Wire lifecycle shutdown hooks for gracefulRestart() ────────────────────
// These enable lifecycle.ts to cleanly shut down all subsystems before respawning.
setShutdownHooks({
  stopTelegram: () => telegramChannel.stop(),
  stopCron: () => { cronScheduler.stop(); stopAgentSchedules(); },
  stopHeartbeat: () => heartbeatRunner.stop(),
  stopBrain: () => brainRunner.stop(),
  closeWebSocket: () => { try { wss.close(); } catch {} },
  closeHttpServer: () => new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
      setTimeout(resolve, 2000); // force-resolve after 2s
    } catch { resolve(); }
  }),
  flushSessions: () => {
    try {
      const { flushSession } = require('./session');
      // Flush is best-effort — sessions auto-save on debounce already
    } catch {}
  },
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

console.log('[Server] ✅ Advanced error response systems initialized');
try { seedDefaultShortcuts(); console.log('[SiteShortcuts] Default shortcuts seeded.'); } catch (e: any) { console.warn('[SiteShortcuts] Seed failed:', e.message); }

server.listen(PORT, HOST, () => {
  // Silently refresh persisted Supabase session so users stay logged in
  refreshPersistedSession().catch(() => {});
  runStartup({
    HOST, PORT, config, skillsManager, cronScheduler, heartbeatRunner, brainRunner, telegramChannel,
    handleChat, buildTools, runTeamAgentViaChat,
  }).catch((err: any) => console.error('[Gateway] Startup error:', err?.message || err));
});

let shuttingDown = false;
function gracefulShutdown(signal: 'SIGINT' | 'SIGTERM'): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Gateway] Shutting down...');
  try { credentialHandler.stop(); } catch {}
  try { verificationFlowManager.stop(); } catch {}
  console.log(`[Gateway] Received ${signal}; shutting down...`);
  try { skillsManager.persistState(); } catch {}
  try { telegramChannel.stop(); } catch {}
  try { getMCPManager().disconnectAll(); } catch {}
  try { cronScheduler.stop(); } catch {}
  try { stopAgentSchedules(); } catch {}
  try { heartbeatRunner.stop(); } catch {}
  try { brainRunner.stop(); } catch {}
  try { if (wss) wss.close(); } catch {}
  try {
    server.close(() => process.exit(0));
    const forceExitTimer = setTimeout(() => process.exit(0), 1200) as any;
    if (typeof forceExitTimer?.unref === 'function') forceExitTimer.unref();
  } catch { process.exit(0); }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { app, server };
