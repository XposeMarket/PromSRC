import type { Router, RequestHandler } from 'express';
import {
  addVoiceWorkgroupWorker,
  createVoiceWorkgroup,
  listVoiceWorkgroupsForSession,
  loadVoiceWorkgroup,
  updateVoiceWorkgroupWorkerStatus,
  type VoiceWorkgroupDelivery,
  type VoiceWorkgroupMode,
} from '../../../voice/voice-workgroup-store';
import { assertSafeStorageId, isStorageBoundaryError } from '../../../storage/storage-paths.js';
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
import { VoiceAgentTargetContext, normalizeVoiceAgentTarget, voiceAgentTargetIdentity, loadVoiceAgentMemoryForTarget, voiceAgentWorkerHandoffSessions, findActiveMainChatRuntimeForSession, compactVoiceText, summarizeUnlockedToolCategories, buildVoiceConversationTranscript, buildVoiceCompactionSummaryBlock, buildVoiceRecentToolLog, buildVoiceWorkerContextPacket, getReusableVoiceContextPacket, getVoiceAgentContextBlock } from './context';
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
  type TaskStatus,
} from '../../../tasks/task-store';
import { BackgroundTaskRunner } from '../../../tasks/background-task-runner';
import {
  router as tasksRouter,
  initTasksRouter,
  makeBroadcastForTask,
} from '../.././tasks.router';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../../session';
import { buildVoicePrometheusToolsDefinition, VOICE_TOOLS_SUPERSEDED_BY_CORE, voiceCoreToolSurface, toRealtimeFunctionTool, voiceCoreSurfaceSignature } from './core-tools';
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
import { createTurnTimingRecorder, type TurnTimingRecorder } from '../../../chat/turn-timing';
import { buildVoiceTimeContext, buildRealtimeSkillContextForTranscript, voiceRuntimeDirectiveFromToolResult, parseVoiceToolArgs, cleanVoiceWakePhrase } from './tool-helpers';
import { decideVoiceAgentAction, voiceSteerKindFromIntent, buildVoiceContextSummaryForSteer, VoiceAgentProcessEntry, takeLastVoiceScreenshotPreview, executeVoiceAgentToolWithTrace } from './decision';
import { parseVoiceToolResult, voiceRuntimeContextText } from './fallback';
import { executeXaiImageVisionSummary } from '../../../tools/handlers/xai-handlers.js';
import { createVoiceNarrator, classifyVoiceInterruption, buildVoiceInterruptionContextBlock, buildChatSteerContextBlock, appendVoiceInterruptionLog } from './narrator';
import crypto from 'crypto';
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
import { buildRealtimeVoiceAgentTools } from './realtime';
import { router, requireSafeSessionParam, storageAwareStatus, inferTaskChannelFromSession, handleChat, _telegramChannel, summarizeMobileRuntime } from './dependencies';


export type NormalizedVoiceDispatchTask = { title: string; prompt: string };
export type NormalizedPrimaryVoiceWorker = NormalizedVoiceDispatchTask & { taskId: string; status: string };

export function compactVoiceDispatchTitle(value: string, fallback: string): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.slice(0, 90);
}

export function normalizeVoiceDispatchMode(value: unknown): VoiceWorkgroupMode {
  return String(value || '').trim() === 'sequential' ? 'sequential' : 'parallel';
}

export function normalizeVoiceDispatchDelivery(value: unknown): VoiceWorkgroupDelivery {
  const clean = String(value || '').trim();
  if (clean === 'grouped_summary' || clean === 'task_panel_only') return clean;
  return 'report_each';
}

export function normalizeVoiceDispatchTasks(body: any): NormalizedVoiceDispatchTask[] {
  const rawTasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const tasks = rawTasks.map((raw: any, index: number) => {
    const prompt = typeof raw === 'string'
      ? raw
      : String(raw?.prompt || raw?.task || raw?.objective || raw?.message || raw?.instruction || '').trim();
    const title = typeof raw === 'object' && raw
      ? String(raw.title || raw.name || raw.label || '').trim()
      : '';
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) return null;
    return {
      title: compactVoiceDispatchTitle(title || cleanPrompt, `Voice worker ${index + 1}`),
      prompt: cleanPrompt.slice(0, 12000),
    };
  }).filter(Boolean) as NormalizedVoiceDispatchTask[];

  if (!tasks.length) {
    const prompt = String(body?.task || body?.prompt || body?.objective || body?.message || '').trim();
    if (prompt) {
      const title = String(body?.title || body?.name || '').trim();
      tasks.push({
        title: compactVoiceDispatchTitle(title || prompt, 'Voice worker task'),
        prompt: prompt.slice(0, 12000),
      });
    }
  }

  return tasks.slice(0, 8);
}

export function normalizePrimaryVoiceWorker(body: any): NormalizedPrimaryVoiceWorker | null {
  const raw = body?.primaryWorker || body?.primary_worker;
  if (!raw || typeof raw !== 'object') return null;
  const taskId = String(raw.taskId || raw.id || '').trim();
  const prompt = String(raw.prompt || raw.task || raw.objective || '').trim();
  if (!taskId || !prompt) return null;
  return {
    taskId: assertSafeStorageId(taskId, 'primary voice worker id'),
    title: compactVoiceDispatchTitle(String(raw.title || raw.name || prompt), 'Primary chat worker'),
    prompt: prompt.slice(0, 12000),
    status: String(raw.status || 'running').trim() || 'running',
  };
}
export function registerDispatchVoiceRoutes(router: Router, requireSafeSessionParam: RequestHandler) {

router.get('/api/voice-agent/workgroups/session/:sessionId', requireSafeSessionParam, (req, res) => {
  res.status(410).json({ ok: false, success: false, error: 'Voice worker groups were retired. Use thread supervision instead.' });
  return;
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    const requestedLimit = Number(req.query.limit || 8);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.floor(requestedLimit))) : 8;
    const workgroups = listVoiceWorkgroupsForSession(sessionId).slice(0, limit);
    res.json({ ok: true, success: true, sessionId, workgroups });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.get('/api/voice-agent/workgroups/:id', (req, res) => {
  res.status(410).json({ ok: false, success: false, error: 'Voice worker groups were retired. Use thread supervision instead.' });
  return;
  try {
    const workgroup = loadVoiceWorkgroup(String(req.params.id || ''));
    if (!workgroup) {
      res.status(404).json({ ok: false, success: false, error: 'Voice workgroup not found.' });
      return;
    }
    res.json({ ok: true, success: true, workgroup });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.patch('/api/voice-agent/workgroups/:id/workers/:taskId', (req, res) => {
  res.status(410).json({ ok: false, success: false, error: 'Voice worker groups were retired. Use thread supervision instead.' });
  return;
  try {
    const workgroupId = assertSafeStorageId(String(req.params.id || ''), 'voice workgroup id');
    const taskId = assertSafeStorageId(String(req.params.taskId || ''), 'voice worker id');
    const status = String(req.body?.status || '').trim();
    if (!status) {
      res.status(400).json({ ok: false, success: false, error: 'status is required.' });
      return;
    }
    const workgroup = updateVoiceWorkgroupWorkerStatus(workgroupId, taskId, status, {
      currentStep: String(req.body?.currentStep || '').trim() || undefined,
      completedSteps: Array.isArray(req.body?.completedSteps) ? req.body.completedSteps : undefined,
      finalResult: String(req.body?.finalResult || '').trim() || undefined,
      updatedAt: Date.now(),
    });
    if (!workgroup) {
      res.status(404).json({ ok: false, success: false, error: 'Voice workgroup or worker not found.' });
      return;
    }
    const activeWorkgroup = workgroup!;
    const worker = activeWorkgroup.workers.find((entry) => entry.taskId === taskId);
    broadcastWS({
      type: 'voice_worker_update',
      id: `voice_worker_${taskId}_primary_${Date.now()}`,
      sessionId: activeWorkgroup.parentSessionId,
      workgroupId,
      taskId,
      title: worker?.title || 'Primary chat worker',
      kind: status === 'complete' ? 'complete' : status === 'failed' ? 'paused' : 'milestone',
      critical: false,
      silent: true,
      status,
      text: status === 'complete' ? 'Primary chat worker completed.' : `Primary chat worker is ${status}.`,
      currentStep: worker?.currentStep || '',
      completedSteps: worker?.completedSteps || [],
      finalResult: worker?.finalResult || '',
      timestamp: Date.now(),
    });
    res.json({ ok: true, success: true, workgroup: activeWorkgroup, worker });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/restart-gateway-quick', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const reason = compactVoiceText(body.reason || 'Voice-requested quick gateway restart', 240);
    res.status(202).json({
      ok: true,
      success: true,
      restarting: true,
      message: 'Quick gateway restart accepted. No npm build will run.',
    });
    // The HTTP 202 is already written before restart begins. Keep a small
    // configurable grace window for the voice client to receive that ack,
    // instead of holding every quick restart for the former 3.5s default.
    const restartDelayMs = Math.max(100, Number(process.env.PROMETHEUS_QUICK_RESTART_DELAY_MS || 250));
    const timer = setTimeout(() => {
      try {
        const { gracefulRestart } = require('../../../lifecycle') as typeof import('../../../lifecycle');
        gracefulRestart({
          reason: 'manual',
          timestamp: Date.now(),
          title: 'Voice quick gateway restart',
          summary: reason || 'Voice-requested quick gateway restart',
          previousSessionId: sessionId,
          quickRestart: true,
          originChannel: String(body.source || '').toLowerCase().includes('mobile') ? 'mobile' : 'web',
        }).catch((err: any) => console.error('[VoiceRestart] Quick restart failed:', err?.message || err));
      } catch (err: any) {
        console.error('[VoiceRestart] Could not start quick restart:', err?.message || err);
      }
    }, restartDelayMs);
    timer.unref?.();
  } catch (err: any) {
    if (!res.headersSent) res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/dispatch-workers', async (req, res) => {
  // Retired: Voice now delegates only through first-class Prometheus threads.
  // Keep the route as an explicit migration response so older clients cannot
  // silently recreate a workgroup while they are being upgraded.
  res.status(410).json({
    ok: false,
    success: false,
    error: 'Voice worker groups were retired. Use voice_thread_ops to create and supervise Prometheus threads.',
    replacement: 'voice_thread_ops',
  });
  return;
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const tasks = normalizeVoiceDispatchTasks(body);
    const primaryWorker = normalizePrimaryVoiceWorker(body);
    const dispatchSource = String(body.source || 'realtime_voice_dispatch').trim() || 'realtime_voice_dispatch';
    if (!tasks.length) {
      res.status(400).json({ ok: false, success: false, error: 'dispatch_prometheus_worker requires task or tasks[].' });
      return;
    }
    if (!primaryWorker && tasks.length === 1 && /realtime[_-]?agent/i.test(dispatchSource)) {
      res.status(409).json({
        ok: false,
        success: false,
        error: 'The first realtime voice worker must run in the current chat. No background task was created.',
        requiresForegroundPrimary: true,
      });
      return;
    }

    const mode = normalizeVoiceDispatchMode(body.mode);
    const delivery = normalizeVoiceDispatchDelivery(body.delivery);
    const sourceTranscript = String(body.sourceTranscript || body.transcript || body.originalUserPrompt || body.task || '').trim();
    const workgroup = createVoiceWorkgroup({
      parentSessionId: sessionId,
      sourceTranscript,
      source: dispatchSource,
      mode,
      delivery,
    });
    const taskChannel = inferTaskChannelFromSession(sessionId);
    const suppressOriginDelivery = delivery === 'grouped_summary' || delivery === 'task_panel_only';
    const createdTasks: Array<{ taskId: string; title: string; prompt: string; status: string; index: number }> = [];
    const workerIndexOffset = primaryWorker ? 1 : 0;
    const workerTotal = tasks.length + workerIndexOffset;

    if (primaryWorker) {
      const primary = primaryWorker!;
      addVoiceWorkgroupWorker(workgroup.id, {
        taskId: primary.taskId || `legacy_voice_primary_${Date.now()}`,
        title: primary.title || 'Primary chat worker',
        prompt: primary.prompt || sourceTranscript || 'Voice worker',
        status: primary.status || 'running',
        index: 0,
        kind: 'primary_chat',
        currentStep: 'Working in this chat',
        updatedAt: Date.now(),
      });
    }

    tasks.forEach((item, index) => {
      const workerIndex = index + workerIndexOffset;
      const task = createTask({
        title: item.title,
        prompt: item.prompt,
        sessionId: `run_once_${sessionId}_${Date.now()}_${index + 1}`,
        channel: taskChannel,
        plan: [{ index: 0, description: item.prompt.slice(0, 180) || item.title, status: 'pending' as const }],
        taskKind: 'run_once',
        originatingSessionId: sessionId,
        suppressOriginDelivery,
        voiceDispatch: {
          workgroupId: workgroup.id,
          workerIndex,
          workerTotal,
          sourceTranscript: sourceTranscript.slice(0, 500) || undefined,
          delivery,
          mode,
        },
      });
      appendJournal(task.id, {
        type: 'status_push',
        content: `Voice worker ${workerIndex + 1}/${workerTotal} queued from realtime dispatch group ${workgroup.id}.`,
      });
      addVoiceWorkgroupWorker(workgroup.id, {
        taskId: task.id,
        title: task.title,
        prompt: task.prompt,
        index: workerIndex,
        status: task.status,
        kind: 'background_task',
      });
      createdTasks.push({ taskId: task.id, title: task.title, prompt: task.prompt, status: task.status, index: workerIndex });

      setImmediate(() => {
        try {
          const runner = new BackgroundTaskRunner(task.id, handleChat, makeBroadcastForTask(task.id), _telegramChannel);
          runner.start().catch((err: Error) => {
            console.error(`[VoiceDispatch] BackgroundTaskRunner error for ${task.id}:`, err?.message || err);
          });
        } catch (err: any) {
          console.error(`[VoiceDispatch] Failed to spawn runner for ${task.id}:`, err?.message || err);
        }
      });
      try {
        broadcastWS({
          type: 'task_running',
          taskId: task.id,
          title: task.title,
          source: 'voice_dispatch',
          sessionId,
          workgroupId: workgroup.id,
          workerIndex,
          workerTotal,
        });
        broadcastWS({ type: 'task_panel_update', taskId: task.id, workgroupId: workgroup.id });
      } catch {}
    });

    const refreshedWorkgroup = loadVoiceWorkgroup(workgroup.id) || workgroup;
    const dispatchAcknowledgement = primaryWorker
      ? `I'm keeping the primary worker in this chat and sending out ${createdTasks.length} more worker${createdTasks.length === 1 ? '' : 's'}.`
      : createdTasks.length === 1
        ? `All right â€” I'm sending out a worker for this.`
        : `All right â€” I'm sending out ${createdTasks.length} workers for this.`;
    addMessage(sessionId, {
      role: 'assistant',
      content: dispatchAcknowledgement,
      timestamp: Date.now(),
      source: 'voice_workgroup_dispatch',
      voiceWorkgroup: refreshedWorkgroup,
    } as any, { disableMemoryFlushCheck: true, disableCompactionCheck: true } as any);
    broadcastWS({
      type: 'voice_workgroup_dispatched',
      sessionId,
      workgroupId: workgroup.id,
      workgroup: refreshedWorkgroup,
      acknowledgement: dispatchAcknowledgement,
      tasks: createdTasks,
      primaryWorker: primaryWorker || undefined,
      taskIds: createdTasks.map((task) => task.taskId),
      delivery,
      mode,
    });

    res.json({
      ok: true,
      success: true,
      dispatched: true,
      workgroupId: workgroup.id,
      workgroup: refreshedWorkgroup,
      taskIds: createdTasks.map((task) => task.taskId),
      tasks: createdTasks,
      primaryWorker: primaryWorker || undefined,
      delivery,
      mode,
      acknowledgement: dispatchAcknowledgement,
      message: `Dispatched ${createdTasks.length} Prometheus worker${createdTasks.length === 1 ? '' : 's'}.`,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

// Same per-message category auto-activation main chat runs, applied to each
// finalized spoken user turn. Returns a refreshed realtime tool list when the
// surface changed so the client can hot-swap it via session.update.
router.post('/api/voice-agent/realtime-tool-surface', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const transcript = String(body.transcript || '').slice(0, 4000);
    const voiceTarget = body.voiceTarget || body.voice_target || body.target ? normalizeVoiceAgentTarget(body) : undefined;
    if (voiceAgentTargetIdentity(voiceTarget).isSubagent || !transcript.trim()) {
      res.json({ ok: true, changed: false });
      return;
    }
    const before = voiceCoreSurfaceSignature(sessionId);
    const activated = autoActivateToolCategories(sessionId, transcript, 0).map((entry: any) => entry.category);
    // Auto-activation is turn-scoped for main chat; a voice call spans many
    // spoken turns and would otherwise advertise tools that silently expire.
    for (const category of activated) {
      try { activateToolCategory(sessionId, category, { scope: 'ttl', turns: 6 }); } catch { /* unknown category */ }
    }
    const changed = voiceCoreSurfaceSignature(sessionId) !== before;
    res.json({
      ok: true,
      changed,
      activated,
      ...(changed ? { tools: buildRealtimeVoiceAgentTools(voiceTarget, null, sessionId) } : {}),
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post('/api/voice-agent/realtime-tool', async (req, res) => {
  const routeStartedAt = Date.now();
  let timingRecorder: TurnTimingRecorder | null = null;
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const toolName = String(body.toolName || body.name || '').trim();
    timingRecorder = createTurnTimingRecorder(sessionId, { phase: 'voice_realtime_tool' });
    timingRecorder.mark('request_received', { toolName });
    const parsedToolArgs = body.toolArgs && typeof body.toolArgs === 'object'
      ? body.toolArgs
      : parseVoiceToolArgs(body.arguments || body.args);
    const toolArgs = {
      ...parsedToolArgs,
      ...(body.voiceTarget || body.voice_target || body.target
        ? { voiceTarget: normalizeVoiceAgentTarget(body) }
        : {}),
      ...(toolName === 'voice_worker_status' && body.contextPacket && typeof body.contextPacket === 'object'
        ? { contextPacket: body.contextPacket }
        : {}),
    };
    if (!toolName) {
      timingRecorder.mark('request_rejected', { reason: 'toolName_required', elapsedMs: Date.now() - routeStartedAt });
      void timingRecorder.flush();
      res.status(400).json({ ok: false, success: false, error: 'toolName is required' });
      return;
    }
    const trace: VoiceAgentProcessEntry[] = [];
    timingRecorder.mark('tool_executor_start', { toolName });
    const raw = await executeVoiceAgentToolWithTrace(sessionId, toolName, toolArgs, trace);
    const elapsedMs = Math.max(0, Date.now() - routeStartedAt);
    timingRecorder.mark('tool_executor_done', { toolName, elapsedMs });
    const parsed = parseVoiceToolResult(raw);
    const runtimeDirective = voiceRuntimeDirectiveFromToolResult(parsed);
    // If this tool captured a screenshot, hand the preview back so the client can
    // overlay it on the voice orb directly (no reliance on the ws relay).
    const preview = takeLastVoiceScreenshotPreview(sessionId, toolName);
    res.json({
      ok: true,
      success: true,
      toolName,
      result: parsed,
      raw,
      runtimeDirective,
      preview,
      processEntries: trace,
      timing: { elapsedMs },
    });
    void timingRecorder.flush();
  } catch (err: any) {
    const elapsedMs = Math.max(0, Date.now() - routeStartedAt);
    timingRecorder?.mark('tool_error', { elapsedMs, error: String(err?.message || err) });
    void timingRecorder?.flush();
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

// Vision summary for the xAI realtime voice agent. xAI voice/realtime models
// cannot take image input, so captures go through a sidecar vision model and the
// client feeds the text summary back into the live voice session. Grok is tried
// first, with OpenAI mini vision as the default fallback. Accepts { dataUrl } for
// a photo or { frames:[{dataUrl}], durationMs } for a sampled video clip.
router.post('/api/voice-agent/xai-vision-summary', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await executeXaiImageVisionSummary({
      dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : undefined,
      frames: Array.isArray(body.frames) ? body.frames : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      durationMs: Number(body.durationMs || 0) || undefined,
    });
    if (!result.success) {
      res.status(502).json({ ok: false, success: false, error: result.error || 'xAI vision summary failed', model: result.model });
      return;
    }
    res.json({
      ok: true,
      success: true,
      summary: result.summary,
      model: result.model,
      credentialSource: result.credential_source,
      fallbackFrom: result.fallback_from,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/voice/interruption', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'mobile_default').trim() || 'mobile_default', 'session ID');
    const transcript = String(body.userInterruptionTranscript || '').trim();
    const classification = classifyVoiceInterruption(transcript);
    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, body);
    const action = decideVoiceAgentAction(transcript, classification, contextPacket);
    const eventId = String(body.id || `voice_intr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
    if (action === 'handoff_new_work') {
      voiceAgentWorkerHandoffSessions.set(sessionId, {
        at: Date.now(),
        transcript: transcript.slice(0, 500),
        eventId,
      });
    }
    const event = {
      id: eventId,
      sessionId,
      createdAt: new Date().toISOString(),
      reason: String(body.reason || 'barge_in').trim() || 'barge_in',
      originalUserPrompt: String(body.originalUserPrompt || '').trim(),
      currentUserPrompt: transcript,
      assistantTextSoFar: String(body.assistantTextSoFar || body.interruptedText || '').trim(),
      assistantSpokenTextSoFar: String(body.assistantSpokenTextSoFar || '').trim(),
      currentSpokenSegment: String(body.currentSpokenSegment || '').trim(),
      lastVoiceMilestone: String(body.lastVoiceMilestone || '').trim(),
      activeRunId: activeRuntime?.id || String(body.activeRunId || body.activeRequestId || '').trim(),
      activeToolName: contextPacket.activeToolName || activeRuntime?.checkpoint?.toolName || '',
      activeToolLabel: contextPacket.activeToolLabel || '',
      activeWorkflowLabel: activeRuntime?.label || '',
      userInterruptionTranscript: transcript,
      classification,
      status: 'captured',
      voiceMode: String(body.voiceMode || '').trim(),
      clientRequestId: String(body.activeRequestId || body.clientRequestId || '').trim(),
      isStreamActive: body.isStreamActive === true,
      voiceAgentAction: action,
      voiceContextPacketId: contextPacket.id,
    };
    let injectedContextText = buildVoiceInterruptionContextBlock(event);
    let steerApplied = false;
    let steerEventId = '';
    const voiceReply = '';
    if (
      action === 'steer_worker'
      && activeRuntime?.id
      && transcript
      && !classification.shouldAbortOriginalRun
      && !classification.shouldPauseOriginalRun
      && classification.intent !== 'unknown'
    ) {
      const steer = addPendingRuntimeSteer(activeRuntime.id, {
        sessionId,
        message: transcript,
        source: String(body.source || `voice_${event.voiceMode || 'interruption'}`).trim() || 'voice_interruption',
        clientRequestId: event.clientRequestId || undefined,
        kind: voiceSteerKindFromIntent(classification.intent),
        requiresWorkerResponse: classification.intent === 'question',
        voiceContextPacketId: contextPacket.id,
        spokenAck: voiceReply || undefined,
        responseMode: classification.intent === 'question' ? 'worker_reply' : 'narrate',
        contextSummary: buildVoiceContextSummaryForSteer(contextPacket),
      });
      if (steer.ok && steer.event) {
        steerApplied = true;
        steerEventId = steer.event.id;
        injectedContextText = buildChatSteerContextBlock(steer.event);
      }
    }
    const storedEvent = { ...event, injectedContextText, status: steerApplied ? 'injected_into_runtime' : 'handled_by_voice_agent', action, voiceReply, contextPacket };
    appendVoiceInterruptionLog(storedEvent);
    if (activeRuntime?.id) {
      updateLiveRuntimeCheckpoint(activeRuntime.id, {
        voiceInterruptionEvent: {
          id: eventId,
          intent: classification.intent,
          action,
          transcript: transcript.slice(0, 500),
          injectedContextText,
          steerApplied,
          steerEventId,
          voiceContextPacketId: contextPacket.id,
          voiceReply: voiceReply.slice(0, 500),
          at: Date.now(),
        },
      });
      if (action === 'interrupt_worker' && activeRuntime.abortable) {
        abortLiveRuntime(activeRuntime.id);
      }
    }
    broadcastWS({
      type: 'voice_interruption',
      sessionId,
      eventId,
      intent: classification.intent,
      action,
      transcript,
      currentUserPrompt: transcript,
      userInterruptionTranscript: transcript,
      voiceReply,
      contextPacket,
      shouldAbortOriginalRun: action === 'interrupt_worker',
      runtimeId: activeRuntime?.id || '',
      steerApplied,
      steerEventId,
      voiceContextPacketId: contextPacket.id,
    });
    res.json({
      ok: true,
      success: true,
      eventId,
      action,
      steerApplied,
      steerEventId,
      runtimeId: activeRuntime?.id || '',
      classification,
      contextPacket,
      injectedContextText,
      voiceReply,
      activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});
}
