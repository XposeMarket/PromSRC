import type { Router, RequestHandler } from 'express';
import {
  getConfig,
  getAgents,
  getAgentById,
  ensureAgentWorkspace,
  resolveAgentWorkspace,
} from '../../../config/config';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { assertSafeStorageId, isStorageBoundaryError } from '../../storage/storage-paths.js';
import { bgPlanDeclare, bgPlanAdvance, backgroundJoin, backgroundStatus, backgroundAbort, backgroundSteer, listActiveBackgroundIdsForSession, registerBackgroundCompletionWake } from '../../tasks/task-runner';
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
} from '../../browser-tools';
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
} from '../../desktop-tools';
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
} from '../../main-chat-goals';
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
} from '../../live-runtime-registry';
import { summarizeMobileRuntime, isLiveRunningRuntime } from './shared';
import type { MainChatTurnReconciliation } from './shared';



export function registerMobileRoutes(router: Router, deps: {
  requireSafeSessionParam: RequestHandler;
  pruneMainChatStreams: () => void;
  reconcileMainChatTurn: (sessionId: string) => MainChatTurnReconciliation;
  storageAwareStatus: (error: unknown) => number;
}): void {
  const { requireSafeSessionParam, pruneMainChatStreams, reconcileMainChatTurn, storageAwareStatus } = deps;
router.get('/api/mobile/chat/stream/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required.' });
      return;
    }
    pruneMainChatStreams();
    const reconciliation = reconcileMainChatTurn(sessionId);
    const after = Math.max(0, Math.floor(Number(req.query.after || 0)) || 0);
    const stream = reconciliation.stream;
    const activeRuntime = reconciliation.runtime ? summarizeMobileRuntime(reconciliation.runtime) : null;
    const frames = stream
      ? stream.events
        .filter((frame) => Number(frame.seq || 0) > after)
        .map((frame) => ({
          seq: frame.seq,
          type: frame.type,
          at: frame.at,
          streamId: stream.streamId,
          data: frame.data || {},
        }))
      : [];
    res.json({
      success: true,
      sessionId,
      active: reconciliation.active,
      recovered: reconciliation.recovered,
      run: activeRuntime,
      stream: stream ? {
        streamId: stream.streamId,
        active: stream.active,
        startedAt: stream.startedAt,
        updatedAt: stream.updatedAt,
        completedAt: stream.completedAt || null,
        nextSeq: stream.nextSeq,
        firstSeq: stream.events[0]?.seq || 0,
        lastSeq: stream.events[stream.events.length - 1]?.seq || 0,
        progressState: stream.progressState || null,
      } : null,
      events: frames,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/chat/runs', (_req, res) => {
  try {
    const runtimes = listLiveRuntimes()
      .filter((runtime) => isLiveRunningRuntime(runtime) && (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal'))
      .map(summarizeMobileRuntime)
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
    res.json({
      success: true,
      activeSessionIds: Array.from(new Set(runtimes.map((runtime) => String(runtime.sessionId || '')).filter(Boolean))),
      runs: runtimes,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/chat/runs/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Session id required.' });
      return;
    }
    const reconciliation = reconcileMainChatTurn(sessionId);
    const active = reconciliation.runtime ? summarizeMobileRuntime(reconciliation.runtime) : null;
    const session = getSession(sessionId);
    const history = Array.isArray(session?.history) ? session.history : [];
    const latestAssistant = [...history].reverse().find((entry: any) => entry?.role === 'assistant') || null;
    const latestUser = [...history].reverse().find((entry: any) => entry?.role === 'user') || null;
    res.json({
      success: true,
      active: reconciliation.active,
      run: active,
      recovered: reconciliation.recovered,
      recovery: reconciliation.recovered ? 'start_fresh' : (active ? 'resume_or_interrupt' : 'none'),
      sessionId,
      stream: reconciliation.stream ? {
        streamId: reconciliation.stream.streamId,
        active: reconciliation.stream.active,
        startedAt: reconciliation.stream.startedAt,
        updatedAt: reconciliation.stream.updatedAt,
        firstSeq: reconciliation.stream.events[0]?.seq || 0,
        lastSeq: reconciliation.stream.events[reconciliation.stream.events.length - 1]?.seq || 0,
      } : null,
      historyLength: history.length,
      lastActiveAt: Number(session?.lastActiveAt || 0) || null,
      latestAssistant: latestAssistant ? {
        content: String(latestAssistant.content || ''),
        timestamp: Number(latestAssistant.timestamp || 0) || null,
      } : null,
      latestUser: latestUser ? {
        content: String(latestUser.content || ''),
        timestamp: Number(latestUser.timestamp || 0) || null,
      } : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/chat/reconcile/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    const reconciliation = reconcileMainChatTurn(sessionId);
    res.json({
      success: true,
      sessionId,
      active: reconciliation.active,
      recovered: reconciliation.recovered,
      recovery: reconciliation.recovered ? 'start_fresh' : (reconciliation.runtime ? 'resume_or_interrupt' : 'none'),
      run: reconciliation.runtime ? summarizeMobileRuntime(reconciliation.runtime) : null,
      stream: reconciliation.stream ? {
        streamId: reconciliation.stream.streamId,
        active: reconciliation.stream.active,
        updatedAt: reconciliation.stream.updatedAt,
      } : null,
    });
  } catch (err: any) {
    res.status(storageAwareStatus(err)).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/commands/models', async (_req, res) => {
  try {
    const cfg = getConfig().getConfig() as any;
    const activeProvider = cfg.llm?.provider || 'ollama';
    const providers = Object.entries(cfg.llm?.providers || {}).map(([id, value]: [string, any]) => ({
      id,
      model: String(value?.model || ''),
      endpoint: String(value?.endpoint || ''),
      active: id === activeProvider,
    }));
    res.json({
      success: true,
      activeProvider,
      activeModel: cfg.llm?.providers?.[activeProvider]?.model || cfg.models?.primary || 'unknown',
      providers,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.get('/api/mobile/commands/stop-targets', (_req, res) => {
  try {
    res.json({ success: true, targets: listLiveRuntimes().filter(isLiveRunningRuntime).map(summarizeMobileRuntime) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/stop-now', (req, res) => {
  try {
    const requestedSessionId = String(req.body?.sessionId || '').trim();
    const sessionId = requestedSessionId ? assertSafeStorageId(requestedSessionId, 'session id') : '';
    const runtimeId = String(req.body?.runtimeId || req.body?.id || '').trim();
    const runtimeById = runtimeId ? getLiveRuntime(runtimeId) : null;
    const target = (runtimeById?.kind === 'main_chat' || runtimeById?.kind === 'main_chat_goal')
      && runtimeById.abortable
      && isLiveRunningRuntime(runtimeById)
      && (!sessionId || String(runtimeById.sessionId || '') === sessionId)
      ? runtimeById
      : listLiveRuntimes()
        .filter((runtime) =>
          isLiveRunningRuntime(runtime)
            && (runtime.kind === 'main_chat' || runtime.kind === 'main_chat_goal')
            && runtime.abortable
            && (!sessionId || String(runtime.sessionId || '') === sessionId)
        )
        .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0];

    // Cancel any background_spawn agents launched by this chat session too â€”
    // the user expects "stop" to kill everything running on their behalf.
    const abortedBackgroundIds = sessionId
      ? listActiveBackgroundIdsForSession(sessionId).filter((id) => backgroundAbort(id).ok)
      : [];

    if (sessionId) stopMainChatGoalByUser(sessionId);
    if (!target) {
      if (abortedBackgroundIds.length > 0) {
        res.json({
          success: true,
          message: `Stopped ${abortedBackgroundIds.length} background agent${abortedBackgroundIds.length === 1 ? '' : 's'}.`,
          abortedBackgroundIds,
        });
        return;
      }
      res.json({ success: false, message: 'No active main chat turn is currently running for this session.' });
      return;
    }
    const source = String(req.body?.source || 'mobile_stop_now').trim().slice(0, 120) || 'mobile_stop_now';
    const result = abortLiveRuntime(target.id, 'operator_abort', { source });
    res.json({
      success: result.ok,
      message: result.ok ? 'Main chat aborted.' : (result.error || 'Abort failed.'),
      target: summarizeMobileRuntime(result.runtime || target),
      abortedBackgroundIds,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/stop', (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (!id) {
      res.status(400).json({ success: false, error: 'Runtime id required.' });
      return;
    }
    const runtime = getLiveRuntime(id);
    if (!runtime) {
      res.status(404).json({ success: false, error: 'Runtime is no longer active.' });
      return;
    }
    const source = String(req.body?.source || 'mobile_stop').trim().slice(0, 120) || 'mobile_stop';
    const result = abortLiveRuntime(id, 'operator_abort', { source });
    res.json({
      success: result.ok,
      message: result.ok ? 'Runtime aborted.' : (result.error || 'Abort failed.'),
      target: summarizeMobileRuntime(result.runtime || runtime),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

router.post('/api/mobile/commands/screenshot', async (req, res) => {
  try {
    req.setTimeout?.(120_000);
    res.setTimeout?.(120_000);
    req.socket?.setTimeout?.(120_000);
    const sessionId = assertSafeStorageId(String(req.body?.sessionId || 'mobile_default').trim() || 'mobile_default', 'session id');
    const target = String(req.body?.target || 'desktop').trim().toLowerCase();
    const captureDesktop = async (options: any) => {
      const result = await desktopScreenshotWithHistory(sessionId, { ...options, skipOcr: true });
      const packet = getDesktopAdvisorPacket(sessionId);
      return {
        success: !/^ERROR:/i.test(String(result || '')),
        result,
        image: packet?.screenshotBase64 ? {
          base64: packet.screenshotBase64,
          mimeType: packet.screenshotMime || 'image/png',
          width: packet.width,
          height: packet.height,
          screenshotId: packet.screenshotId,
        } : null,
      };
    };
    if (target === 'monitors') {
      res.json({ success: true, result: await desktopGetMonitorsSummary() });
      return;
    }
    if (target === 'desktop') {
      const monitors = await desktopGetMonitors().catch(() => []);
      const clean = (Array.isArray(monitors) ? monitors : [])
        .filter((m: any) => Number.isFinite(Number(m?.index)) && Number(m?.width) > 0 && Number(m?.height) > 0)
        .map((m: any) => ({
          index: Math.max(0, Math.floor(Number(m.index))),
          width: Math.max(1, Math.floor(Number(m.width))),
          height: Math.max(1, Math.floor(Number(m.height))),
          primary: !!m.primary,
        }))
        .sort((a: any, b: any) => a.index - b.index);
      if (clean.length > 1) {
        res.json({
          success: true,
          menu: 'desktop',
          result: `Detected ${clean.length} monitors. Choose one to capture, or capture all monitors combined.`,
          actions: [
            { action: 'screenshot-desktop-all', label: 'All monitors combined', icon: 'monitor' },
            ...clean.map((m: any) => ({
              action: 'screenshot-desktop-monitor',
              id: String(m.index),
              label: `Monitor ${m.index + 1}${m.primary ? ' (Primary)' : ''} ${m.width}x${m.height}`,
              icon: 'monitor',
            })),
          ],
        });
        return;
      }
      const monitorIndex = clean.length === 1 ? clean[0].index : 0;
      res.json(await captureDesktop({ capture: monitorIndex }));
      return;
    }
    if (target === 'desktop-all') {
      res.json(await captureDesktop({ capture: 'all' }));
      return;
    }
    if (target === 'desktop-monitor') {
      const monitorIndex = Math.max(0, Math.floor(Number(req.body?.id || 0)));
      res.json(await captureDesktop({ capture: monitorIndex }));
      return;
    }
    if (target === 'primary') {
      res.json(await captureDesktop({ capture: 'primary' }));
      return;
    }
    if (target === 'som') {
      res.json(await captureDesktop({ capture: 'all', som: true }));
      return;
    }
    if (target === 'browser') {
      const sessions = listBrowserSessions();
      if (sessions.length > 1) {
        res.json({
          success: true,
          menu: 'browser',
          result: `Detected ${sessions.length} browser instances. Choose one to capture.`,
          actions: sessions.slice(0, 12).map((session: any) => ({
            action: 'screenshot-browser-session',
            id: session.sessionId,
            label: `${session.originLabel || session.label || session.sessionId}${session.title || session.url ? ` - ${session.title || session.url}` : ''}`.slice(0, 100),
            icon: 'globe',
          })),
        });
        return;
      }
      const selected = sessions[0]?.sessionId || sessionId;
      const shot = await browserVisionScreenshot(selected);
      const info = getBrowserSessionInfo(selected);
      res.json({
        success: !!shot?.base64,
        result: shot?.base64
          ? `Browser screenshot captured (${shot.width}x${shot.height}) from ${info?.originLabel || 'Browser'}.`
          : 'ERROR: No browser session. Use browser_open first.',
        image: shot?.base64 ? {
          base64: shot.base64,
          mimeType: shot.mimeType || 'image/png',
          width: shot.width,
          height: shot.height,
          screenshotId: '',
        } : null,
      });
      return;
    }
    if (target === 'browser-session') {
      const selected = String(req.body?.id || '').trim();
      const shot = selected ? await browserVisionScreenshot(selected) : null;
      const info = selected ? getBrowserSessionInfo(selected) : null;
      res.json({
        success: !!shot?.base64,
        result: shot?.base64
          ? `Browser screenshot captured (${shot.width}x${shot.height}) from ${info?.originLabel || 'Browser'}.`
          : 'ERROR: Browser session was not available.',
        image: shot?.base64 ? {
          base64: shot.base64,
          mimeType: shot.mimeType || 'image/png',
          width: shot.width,
          height: shot.height,
          screenshotId: '',
        } : null,
      });
      return;
    }
    res.status(400).json({ success: false, error: 'Unknown screenshot target.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});
}

