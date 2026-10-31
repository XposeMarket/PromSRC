import type { Router, RequestHandler } from 'express';
import express from 'express';
import { slimSessionList, responseEtag } from '.././perf-projections';
import crypto from 'crypto';
import {
  ChatHistoryCursorError,
  historyMessageCursorKey,
  paginateChatHistory,
} from '../../chat/history-cursor';
import {
  captureModelUsageLogCursor,
  readModelUsageEventsForSession,
  readModelUsageEventsSince,
  getUsageCalibration,
  resolveProviderPromptTokens,
  type ModelUsageEvent,
} from '../../../providers/model-usage';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { SessionSettlementError, settleSessionWithGuards, unsettleSessionSafely } from '../../session-settlement';
import { clearChatModelRoute, setChatModelRoute } from '../../session';
import { isInternalBackgroundResult, mergeHistoryWithExistingMessageMetadata } from '../../history-reconciliation';
import { buildContextBudget, estimateMessageTokenBreakdownForModel, estimateMessagesTokensForModel, estimateTextTokensForModel, resolveActiveModelContextProfile } from '../../context/model-context';
import { captureChatTurnRouteSnapshot, ChatModelRouteUnavailableError, resolveChatModelRouteSource, validateChatModelRoute } from '../../chat/chat-model-route';
import { createToolObservationsFromResults, formatToolStateSummaryForContext, persistToolResultsAsObservations, readToolObservationSnapshot, readToolObservations, type ToolObservation, type ToolObservationSnapshot } from '../../tool-observations';
import { buildProjectContextBlock, findProjectBySessionId, listProjects, deleteSessionFromProject } from '../../projects/project-store.js';
import { cancelThreadSupervision, listThreadSupervisions } from '../../threads/thread-supervision';
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
} from '../../comms/broadcaster';
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
import { isLiveRunningRuntime, boundedPositiveInt, sanitizeHistoryForUiResponse, sessionProcessLogFromHistory, sanitizeProcessEntryForUi } from './shared';
import { estimateStoredThreadFootprint, aggregateSessionModelUsage, buildContextWindowCurrentState } from './context-window';

export function markActiveRunsOnSessionList<T extends any>(input: T): T {
  const activeSessionIds = new Set(
    listLiveRuntimes()
      .filter((runtime: any) => (
        isLiveRunningRuntime(runtime)
        && (runtime?.kind === 'main_chat' || runtime?.kind === 'main_chat_goal')
        && runtime?.sessionId
      ))
      .map((runtime: any) => String(runtime.sessionId)),
  );

  const mark = (session: any) => session && typeof session === 'object'
    // The live-runtime registry is authoritative. Do not carry a persisted
    // activeRun bit forward after the runtime has finished, or a stale flag
    // can make the sidebar show Working on the wrong chat after a switch.
    ? { ...session, activeRun: activeSessionIds.has(String(session.id || '')) }
    : session;

  if (Array.isArray(input)) return input.map(mark) as T;
  if (input && typeof input === 'object' && Array.isArray((input as any).sessions)) {
    return { ...(input as any), sessions: (input as any).sessions.map(mark) } as T;
  }
  return input;
}

export function attachProjectMembershipToSessionList<T extends any>(input: T): T {
  // The session index is already compact, but project membership used to call
  // listProjects() once per session. A sidebar refresh over ~1,400 sessions
  // therefore performed thousands of synchronous directory/file reads and could
  // monopolize the gateway event loop for tens of seconds. Build the reverse map
  // once per response instead; project writes remain durable and this only
  // changes the read-side work from O(sessions * projects) to O(sessions + projects).
  const projectBySessionId = new Map<string, { id: string; name: string }>();
  try {
    for (const project of listProjects()) {
      for (const session of Array.isArray(project.sessions) ? project.sessions : []) {
        const sessionId = String(session?.id || '').trim();
        if (!sessionId || projectBySessionId.has(sessionId)) continue;
        projectBySessionId.set(sessionId, { id: project.id, name: project.name });
      }
    }
  } catch {
    // Project metadata is an optional presentation overlay; a broken project
    // record must never make the ordinary chat list unavailable.
  }
  const attach = (session: any) => {
    if (!session || typeof session !== 'object') return session;
    const project = projectBySessionId.get(String(session.id || '').trim());
    return project
      ? { ...session, projectId: project.id, projectName: project.name }
      : session;
  };
  if (Array.isArray(input)) return input.map(attach) as T;
  if (input && typeof input === 'object' && Array.isArray((input as any).sessions)) {
    return { ...(input as any), sessions: (input as any).sessions.map(attach) } as T;
  }
  return input;
}

export function isMobileHistorySyncRequest(req: express.Request): boolean {
  const origin = req.body?.origin;
  return !!req.headers['x-pairing-token']
    || String(origin?.channel || '').toLowerCase() === 'mobile'
    || String(origin?.surface || '').toLowerCase() === 'mobile_app';
}

export function isMobileVisualStateSyncRequest(req: express.Request): boolean {
  return isMobileHistorySyncRequest(req)
    && String(req.body?.origin?.reason || '').toLowerCase() === 'visual_state';
}

export function timelineHistoryMessages(history: any[]): any[] {
  return (Array.isArray(history) ? history : [])
    .filter((msg) => {
      const role = msg?.role === 'assistant' || msg?.role === 'ai' || msg?.role === 'user' ? msg.role : '';
      const content = String(msg?.content || '').replace(/\s+/g, ' ').trim();
      return !!role && !!content && !isInternalBackgroundResult(msg);
    });
}

export function firstUserMessageKey(history: any[]): string {
  const msg = timelineHistoryMessages(history).find((item) => item?.role === 'user');
  return String(msg?.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 500);
}

export function wouldDangerouslyReplaceSessionHistory(sessionId: string, incomingHistory: any[]): boolean {
  try {
    const existing = timelineHistoryMessages(getHistory(sessionId));
    const incoming = timelineHistoryMessages(incomingHistory);
    if (existing.length < 2 || incoming.length < 1) return false;
    if (incoming.length >= existing.length) return false;
    const existingFirst = firstUserMessageKey(existing);
    const incomingFirst = firstUserMessageKey(incoming);
    return !!existingFirst && !!incomingFirst && existingFirst !== incomingFirst;
  } catch {
    return false;
  }
}

export function registerSessionsRoutes(router: Router, deps: {
  requireSafeSessionParam: RequestHandler;
  editRerunAbortResetSessions: Set<string>;
  startMainChatGoalRunner: (sessionId: string, source?: string) => void;
  broadcastMainChatGoalState: (sessionId: string, event: string, extra?: Record<string, unknown>) => void;
  storageAwareStatus: (error: unknown) => number;
}): void {
  const { requireSafeSessionParam, editRerunAbortResetSessions, startMainChatGoalRunner, broadcastMainChatGoalState, storageAwareStatus } = deps;
router.get('/api/sessions', async (req, res) => {
  try {
    const profileSessions = (label: string, startedAt: number, detail = '') => {
      if (process.env.PROMETHEUS_STARTUP_DIAGNOSTICS !== '1') return;
      try { process.stderr.write(`[sessions-profile] ${label} durationMs=${Date.now() - startedAt}${detail ? ` ${detail}` : ''}\n`); } catch {}
    };
    const routeStartedAt = Date.now();
    const channel = req.query.channel as string | undefined;
    const scope = String(req.query.scope || '').trim().toLowerCase();
    if (scope && scope !== 'all') {
      res.status(400).json({ error: 'Invalid scope. Valid values: all' });
      return;
    }
    if (scope === 'all' && channel) {
      res.status(400).json({ error: 'Use either scope=all or channel, not both.' });
      return;
    }
    if (channel) {
      const validChannels = ['terminal', 'telegram', 'web', 'mobile', 'voice_room', 'discord', 'whatsapp', 'system'];
      if (!validChannels.includes(channel)) {
        res.status(400).json({ error: 'Invalid channel. Valid values: ' + validChannels.join(', ') });
        return;
      }
    }

    const includeAutomated = req.query.includeAutomated === '1'
      || req.query.includeAutomated === 'true';
    const state = String(req.query.state || 'active').trim().toLowerCase();
    if (!['active', 'settled', 'all'].includes(state)) {
      res.status(400).json({ error: 'Invalid state. Valid values: active, settled, all' });
      return;
    }
    const pinnedOnly = req.query.pinned === '1'
      || req.query.pinned === 'true';

    const hasPaging = req.query.limit != null || req.query.offset != null || scope === 'all' || req.query.state != null || req.query.pinned != null;
    if (hasPaging) {
      const listStartedAt = Date.now();
      const page = listSessionSummaries({
        channel: channel as any,
        scope: scope === 'all' ? 'all' : undefined,
        limit: Number(req.query.limit),
        offset: Number(req.query.offset),
        includeAutomated,
        state: state as any,
        pinnedOnly,
      });
      profileSessions('list', listStartedAt, `count=${page.sessions.length} total=${page.total}`);
      const projectStartedAt = Date.now();
      const withProjects = attachProjectMembershipToSessionList(page);
      profileSessions('projects', projectStartedAt);
      const activeStartedAt = Date.now();
      const withActiveRuns = markActiveRunsOnSessionList(withProjects);
      profileSessions('active-runs', activeStartedAt);
      const responseStartedAt = Date.now();
      const payload = req.query.full === '1' ? withActiveRuns : slimSessionList(withActiveRuns);
      const etag = responseEtag(payload);
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) res.status(304).end();
      else res.json(payload);
      profileSessions('response', responseStartedAt, `routeMs=${Date.now() - routeStartedAt}`);
      return;
    }

    const listStartedAt = Date.now();
    const sessions = listSessionSummaries(channel as any);
    profileSessions('list', listStartedAt, `count=${sessions.length}`);
    const projectStartedAt = Date.now();
    const withProjects = attachProjectMembershipToSessionList(sessions);
    profileSessions('projects', projectStartedAt);
    const activeStartedAt = Date.now();
    const withActiveRuns = markActiveRunsOnSessionList(withProjects);
    profileSessions('active-runs', activeStartedAt);
    const responseStartedAt = Date.now();
    const payload = req.query.full === '1' ? { sessions: withActiveRuns } : slimSessionList({ sessions: withActiveRuns });
    const etag = responseEtag(payload);
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) res.status(304).end();
    else res.json(payload);
    profileSessions('response', responseStartedAt, `routeMs=${Date.now() - routeStartedAt}`);
  } catch (err: any) {
    console.error('[/api/sessions] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to list sessions' });
  }
});

router.post('/api/sessions/reorder', (req, res) => {
  try {
    const requestedChannel = String(req.body?.channel || 'web').trim();
    const validChannels = ['terminal', 'telegram', 'web', 'mobile', 'voice_room', 'discord', 'whatsapp', 'system'];
    if (!validChannels.includes(requestedChannel)) {
      res.status(400).json({ error: 'Invalid channel.' });
      return;
    }
    const ordered = reorderSessionSidebar(
      Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [],
      {
        channel: requestedChannel as any,
        state: req.body?.state === 'settled' ? 'settled' : 'all',
      },
    );
    res.json({ success: true, sessionIds: ordered.map((summary) => summary.id), sessions: ordered });
  } catch (err: any) {
    console.error('[/api/sessions/reorder] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to reorder sessions' });
  }
});

router.post('/api/sessions', (req, res) => {
  try {
    const id = String(req.body?.id || req.body?.sessionId || '').trim() || `prom_${crypto.randomUUID()}`;

    const requestedChannel = String(req.body?.channel || '').trim();
    const validChannels = ['terminal', 'telegram', 'web', 'mobile', 'voice_room', 'discord', 'whatsapp', 'system'];
    if (requestedChannel && !validChannels.includes(requestedChannel)) {
      res.status(400).json({ error: 'Invalid channel. Valid values: ' + validChannels.join(', ') });
      return;
    }

    const defaultChannel = req.headers['x-pairing-token'] ? 'mobile' : 'web';
    const channel = (requestedChannel || defaultChannel) as any;
    const session = touchSession(id, {
      channel,
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      voiceRoom: req.body?.voiceRoom && typeof req.body.voiceRoom === 'object'
        ? req.body.voiceRoom as VoiceRoomMetadata
        : undefined,
    });
    flushSession(id);
    res.json({ success: true, session: { id: session.id, channel: session.channel, title: getSessionDisplayTitle(session), createdAt: session.createdAt, lastActiveAt: session.lastActiveAt, pinnedAt: session.pinnedAt || null, settledAt: session.settledAt || null, settled: !!session.settledAt } });
  } catch (err: any) {
    console.error('[/api/sessions POST] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to create session' });
  }
});
}

export function registerSessionsDetailRoutes(router: Router, deps: {
  requireSafeSessionParam: RequestHandler;
  editRerunAbortResetSessions: Set<string>;
  startMainChatGoalRunner: (sessionId: string, source?: string) => void;
  broadcastMainChatGoalState: (sessionId: string, event: string, extra?: Record<string, unknown>) => void;
  storageAwareStatus: (error: unknown) => number;
}): void {
  const { requireSafeSessionParam, editRerunAbortResetSessions, startMainChatGoalRunner, broadcastMainChatGoalState, storageAwareStatus } = deps;
router.get('/api/sessions/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const channel = String(req.query.channel || '').trim();
    const scope = String(req.query.scope || '').trim().toLowerCase();
    const mode = String(req.query.mode || 'content').trim().toLowerCase();
    const limit = Number(req.query.limit || 80);
    const state = String(req.query.state || 'active').trim().toLowerCase();
    const validChannels = ['', 'terminal', 'telegram', 'web', 'mobile', 'voice_room', 'discord', 'whatsapp', 'system'];
    if (!validChannels.includes(channel)) {
      res.status(400).json({ error: 'Invalid channel. Valid values: terminal, telegram, web, system' });
      return;
    }
    if (scope && scope !== 'all') {
      res.status(400).json({ error: 'Invalid scope. Valid values: all' });
      return;
    }
    if (!['active', 'settled', 'all'].includes(state)) {
      res.status(400).json({ error: 'Invalid state. Valid values: active, settled, all' });
      return;
    }
    if (scope === 'all' && channel) {
      res.status(400).json({ error: 'Use either scope=all or channel, not both.' });
      return;
    }
    if (!['title', 'content'].includes(mode)) {
      res.status(400).json({ error: 'Invalid search mode. Valid values: title, content' });
      return;
    }
    const sessions = searchSessionSummaries(q, {
      channel: channel ? channel as any : undefined,
      scope: scope === 'all' ? 'all' : undefined,
      state: state as any,
      includeAutomated: req.query.includeAutomated === '1' || req.query.includeAutomated === 'true',
      limit,
      includeContent: mode !== 'title',
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
      mode,
      state,
      sessions: markActiveRunsOnSessionList(sessions),
    });
  } catch (err: any) {
    console.error('[/api/sessions/search] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to search sessions' });
  }
});

router.get('/api/thread-supervisions', (req, res) => {
  try {
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const validStatuses = ['', 'active', 'paused', 'complete', 'blocked', 'failed', 'cancelled'];
    if (!validStatuses.includes(rawStatus)) {
      res.status(400).json({ success: false, error: 'Invalid supervision status' });
      return;
    }
    const supervisions = listThreadSupervisions({
      ownerSessionId: String(req.query.ownerSessionId || req.query.owner_session_id || '').trim() || undefined,
      targetSessionId: String(req.query.targetSessionId || req.query.target_session_id || '').trim() || undefined,
      status: rawStatus ? rawStatus as any : undefined,
      includeTerminal: req.query.includeTerminal !== 'false' && req.query.include_terminal !== 'false',
      limit: Number(req.query.limit) || 100,
    });
    res.json({ success: true, supervisions });
  } catch (e: any) {
    console.error('[/api/thread-supervisions GET] Error:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to list managed threads' });
  }
});

router.delete('/api/thread-supervisions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const supervision = cancelThreadSupervision(String(req.params.id || ''));
    if (!supervision) {
      res.status(404).json({ success: false, error: 'Supervision not found' });
      return;
    }
    res.json({ success: true, supervision });
  } catch (e: any) {
    console.error('[/api/thread-supervisions/:id DELETE] Error:', e);
    res.status(500).json({ success: false, error: e.message || 'Failed to cancel managed-thread supervision' });
  }
});

router.post('/api/sessions/:id/settle', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const summary = settleSessionWithGuards(sessionId, {
      confirmPinned: req.body?.confirmPinned === true,
      runtimeRecords: listLiveRuntimes(),
    });
    broadcastWS({ type: 'session_state_changed', sessionId, state: 'settled', session: summary, source: 'manual' });
    res.json({ success: true, state: 'settled', session: summary });
  } catch (error: any) {
    if (error instanceof SessionSettlementError) {
      res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
        blockers: error.blockers,
      });
      return;
    }
    console.error('[/api/sessions/:id/settle POST] Error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to settle session' });
  }
});

router.post('/api/sessions/:id/unsettle', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const summary = unsettleSessionSafely(sessionId);
    broadcastWS({ type: 'session_state_changed', sessionId, state: 'active', session: summary, source: 'manual' });
    res.json({ success: true, state: 'active', session: summary });
  } catch (error: any) {
    if (error instanceof SessionSettlementError) {
      res.status(error.statusCode).json({ success: false, code: error.code, error: error.message, blockers: error.blockers });
      return;
    }
    console.error('[/api/sessions/:id/unsettle POST] Error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to reopen session' });
  }
});

router.post('/api/sessions/:id/mobile-read', requireSafeSessionParam, (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const readAt = Number.isFinite(Number(req.body?.readAt)) ? Number(req.body.readAt) : Date.now();
    const summary = markSessionReadForMobile(id, readAt);
    res.json({ success: true, session: summary });
  } catch (e: any) {
    console.error('[/api/sessions/:id/mobile-read POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to mark session read' });
  }
});

router.post('/api/sessions/:id/mobile-unread', requireSafeSessionParam, (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const summary = markSessionUnreadForMobile(id);
    res.json({ success: true, session: summary });
  } catch (e: any) {
    console.error('[/api/sessions/:id/mobile-unread POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to mark session unread' });
  }
});

router.post('/api/sessions/:id/history', requireSafeSessionParam, (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    if (isMobileHistorySyncRequest(req) && wouldDangerouslyReplaceSessionHistory(id, rawHistory)) {
      res.status(409).json({
        success: false,
        error: 'Refusing to overwrite an existing chat with an unrelated shorter mobile history sync.',
      });
      return;
    }
    const existingHistory = Array.isArray(getSession(id).history) ? getSession(id).history : [];
    const history = mergeHistoryWithExistingMessageMetadata(existingHistory, rawHistory, {
      preserveAllExisting: isMobileHistorySyncRequest(req),
      preferIncomingContent: req.body?.repairTranscriptText === true && !isMobileHistorySyncRequest(req),
      preferIncomingTrace: req.body?.repairTranscriptTrace === true && !isMobileHistorySyncRequest(req),
    });
    replaceHistory(id, history as any, {
      resetCompaction: req.body?.resetCompaction === true,
      historyChangeSource: isMobileVisualStateSyncRequest(req) ? 'mobile_visual_state' : 'replace_history',
    });
    flushSession(id);
    res.json({ success: true });
  } catch (e: any) {
    console.error('[/api/sessions/:id/history POST] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to replace session history' });
  }
});

router.post('/api/sessions/:id/edit-rerun-reset', requireSafeSessionParam, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Session id required' });
    return;
  }
  editRerunAbortResetSessions.add(id);
  res.json({ success: true });
});

router.patch('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const hasTitle = typeof req.body?.title === 'string';
    const hasPinned = typeof req.body?.pinned === 'boolean';
    if (!hasTitle && !hasPinned) {
      res.status(400).json({ error: 'Provide title and/or pinned' });
      return;
    }
    let summary = hasTitle
      ? renameSession(req.params.id, String(req.body.title).replace(/\s+/g, ' ').trim())
      : null;
    if (hasPinned) summary = setSessionPinned(req.params.id, req.body.pinned === true);
    if (!summary) {
      res.status(400).json({ error: 'Could not update session' });
      return;
    }
    res.json({ success: true, session: summary });
  } catch (e: any) {
    console.error('[/api/sessions/:id PATCH] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to update session' });
  }
});

router.get('/api/sessions/:id/model-route', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    let state = resolveChatModelRouteSource(sessionId).state;
    try { state = captureChatTurnRouteSnapshot(sessionId).state; } catch (error: any) {
      if (error instanceof ChatModelRouteUnavailableError) state = error.state;
      else throw error;
    }
    res.json({ success: true, sessionId, chatModelRoute: state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: String(error?.message || error) });
  }
});

router.put('/api/sessions/:id/model-route', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const requestedSpeed = String(req.body?.speed || '').trim().toLowerCase();
    const route = {
      providerId: String(req.body?.providerId || req.body?.provider || '').trim(),
      model: String(req.body?.model || '').trim(),
      reasoningEffort: String(req.body?.reasoningEffort ?? req.body?.reasoning_effort ?? '').trim() || undefined,
      ...((requestedSpeed === 'standard' || requestedSpeed === 'fast') ? { speed: requestedSpeed as 'standard' | 'fast' } : {}),
      accountId: String(req.body?.accountId ?? req.body?.account_id ?? '').trim() || undefined,
    };
    const state = validateChatModelRoute(route);
    if (state.availability !== 'ready') {
      res.status(409).json({ success: false, code: 'chat_model_route_unavailable', error: state.error, chatModelRoute: state });
      return;
    }
    const override = setChatModelRoute(sessionId, route);
    res.json({ success: true, sessionId, chatModelRoute: { ...state, mode: 'explicit', override } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: String(error?.message || error) });
  }
});

router.delete('/api/sessions/:id/model-route', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    clearChatModelRoute(sessionId);
    const state = resolveChatModelRouteSource(sessionId).state;
    res.json({ success: true, sessionId, chatModelRoute: state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: String(error?.message || error) });
  }
});

router.get('/api/sessions/:id/history-page', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const mobileOptimized = req.query.mobile === '1'
      || req.query.client === 'mobile'
      || !!req.headers['x-pairing-token']
      || sessionId.startsWith('mobile_')
      || sessionId === 'mobile_default';
    const limit = boundedPositiveInt(req.query.limit, mobileOptimized ? 40 : 80, 1, 500);
    const includeToolLog = req.query.includeToolLog === '1' || req.query.includeToolLog === 'true';
    const fullProcess = req.query.fullProcess === '1' || req.query.fullProcess === 'true';
    const page = paginateChatHistory(sessionId, session.history, {
      limit,
      before: String(req.query.before || '').trim(),
    });
    const items = sanitizeHistoryForUiResponse(page.items, {
      historyLimit: 0,
      includeToolLog,
      perMessageProcessLimit: fullProcess ? 500 : mobileOptimized ? 12 : 50,
      processEntryTextLimit: fullProcess ? 4000 : mobileOptimized ? 900 : 1600,
      processEntryExtraLimit: fullProcess ? 4000 : mobileOptimized ? 700 : 1200,
      attachmentPreviewDataUrlLimit: mobileOptimized ? 30_000 : 60_000,
      attachmentPreviewTextLimit: mobileOptimized ? 2000 : 4000,
      perMessageLiveTraceLimit: fullProcess ? undefined : mobileOptimized ? 60 : 180,
    });
    res.json({ sessionId, items, pageInfo: page.pageInfo });
  } catch (error: any) {
    if (error instanceof ChatHistoryCursorError) {
      res.status(400).json({ code: error.code, error: error.message });
      return;
    }
    console.error('[/api/sessions/:id/history-page] Error:', error);
    res.status(500).json({ error: error?.message || 'Failed to page session history' });
  }
});

router.get('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id);
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const full = req.query.full === '1' || req.query.full === 'true';
    const fullProcess = full || req.query.fullProcess === '1' || req.query.fullProcess === 'true';
    const mobileOptimized = req.query.mobile === '1'
      || req.query.client === 'mobile'
      || !!req.headers['x-pairing-token']
      || sessionId.startsWith('mobile_')
      || sessionId === 'mobile_default';
    const historyLimit = full
      ? 0
      : boundedPositiveInt(req.query.historyLimit, mobileOptimized ? 70 : 200, 20, mobileOptimized ? 180 : 500);
    const processLimit = fullProcess
      ? 500
      : boundedPositiveInt(req.query.processLimit, mobileOptimized ? 120 : 250, 20, mobileOptimized ? 160 : 500);
    const includeToolLog = full || req.query.includeToolLog === '1' || req.query.includeToolLog === 'true';
    const sourceHistory = (Array.isArray(session.history) ? session.history : []).filter((row) => !isInternalBackgroundResult(row));
    const initialHistoryPage = full
      ? {
          items: sourceHistory,
          pageInfo: {
            olderCursor: null,
            hasOlder: false,
            totalCount: sourceHistory.length,
            startIndex: 0,
            endIndex: sourceHistory.length,
            startKey: sourceHistory.length ? historyMessageCursorKey(sourceHistory[0]) : null,
            endKey: sourceHistory.length ? historyMessageCursorKey(sourceHistory[sourceHistory.length - 1]) : null,
          },
        }
      : paginateChatHistory(sessionId, sourceHistory, { limit: historyLimit });
    const responseHistory = sanitizeHistoryForUiResponse(initialHistoryPage.items, {
      historyLimit: 0,
      includeToolLog,
      perMessageProcessLimit: fullProcess ? 500 : mobileOptimized ? 12 : 50,
      processEntryTextLimit: full ? 10_000_000 : fullProcess ? 4000 : mobileOptimized ? 900 : 1600,
      processEntryExtraLimit: full ? 10_000_000 : fullProcess ? 4000 : mobileOptimized ? 700 : 1200,
      attachmentPreviewDataUrlLimit: full ? 10_000_000 : mobileOptimized ? 30_000 : 60_000,
      attachmentPreviewTextLimit: full ? 10_000_000 : mobileOptimized ? 2000 : 4000,
      perMessageLiveTraceLimit: full || fullProcess ? undefined : mobileOptimized ? 60 : 180,
    });
    const durableProcessLog = Array.isArray((session as any).processLog) ? (session as any).processLog : [];
    const responseProcessLog = [
      ...durableProcessLog,
      ...sessionProcessLogFromHistory({ history: responseHistory }),
    ]
      .slice(-processLimit)
      .map((entry: any) => sanitizeProcessEntryForUi(entry, {
        textLimit: full ? 10_000_000 : fullProcess ? 4000 : mobileOptimized ? 900 : 1600,
        extraLimit: full ? 10_000_000 : fullProcess ? 4000 : mobileOptimized ? 700 : 1200,
      }));
    
    res.json({
      session: {
        id: session.id,
        channel: session.channel,
        history: responseHistory,
        processLog: responseProcessLog,
        historyTruncated: initialHistoryPage.pageInfo.hasOlder,
        totalHistoryCount: initialHistoryPage.pageInfo.totalCount,
        historyPage: initialHistoryPage.pageInfo,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        lastAssistantAt: session.lastAssistantAt || null,
        pinnedAt: session.pinnedAt || null,
        settledAt: session.settledAt || null,
        settled: !!session.settledAt,
        mobileLastReadAt: session.mobileLastReadAt || null,
        mobileUnread: Number(session.lastAssistantAt || 0) > Number(session.mobileLastReadAt || 0),
        creativeMode: session.creativeMode || null,
        canvasProjectRoot: session.canvasProjectRoot || null,
        canvasProjectLabel: session.canvasProjectLabel || null,
        canvasProjectLink: session.canvasProjectLink || null,
        mainChatGoal: session.mainChatGoal || null,
        mainChatGoalHistory: session.mainChatGoalHistory || [],
        chatModelRoute: (() => {
          try { return captureChatTurnRouteSnapshot(sessionId).state; }
          catch (error: any) { return error instanceof ChatModelRouteUnavailableError ? error.state : resolveChatModelRouteSource(sessionId).state; }
        })(),
        title: getSessionDisplayTitle(session),
        autoTitleLocked: session.autoTitleLocked === true,
        voiceRoom: session.voiceRoom || null,
      }
    });
  } catch (e: any) {
    console.error('[/api/sessions/:id] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/sessions/:id/context-window', requireSafeSessionParam, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Session id required' });
      return;
    }
    const routeSnapshot = captureChatTurnRouteSnapshot(id).snapshot;
    const profile = routeSnapshot.contextProfile;
    const budget = routeSnapshot.contextBudget;
    const history = getActiveHistoryForApiCall(id);
    const recentToolContext = getRecentToolObservationsForContext(
      id,
      5,
      Math.max(2500, Math.min(16000, budget.toolContextBudgetTokens * 3)),
    );
    const calibration = getUsageCalibration(profile.providerId, profile.model);
    const calibrationFactor = calibration.factor || 1;
    const messageTokens = Math.round(estimateMessagesTokensForModel(history as any, profile) * calibrationFactor);
    const toolTokens = Math.round(estimateTextTokensForModel(recentToolContext, profile.tokenizer) * calibrationFactor);
    const currentInputTokens = messageTokens + toolTokens;
    const session = getSession(id);
    const observationSnapshot = readToolObservationSnapshot(id, 512, profile.tokenizer);
    const storedThread = estimateStoredThreadFootprint(id, session, profile, observationSnapshot);
    const modelUsage = await aggregateSessionModelUsage(id);
    const toolUsage = observationSnapshot.usage;
    const currentState = buildContextWindowCurrentState({
      sessionId: id,
      profile,
      currentInputTokens,
      messageTokens,
      historyMessages: history.length,
      recentToolTokens: toolTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionTriggerTokens: budget.compactionTriggerTokens,
      storedThread,
      modelUsage,
      toolUsage,
    });
    const contextUsage = currentState.contextUsage;
    res.json({
      success: true,
      sessionId: id,
      profile,
      budget,
      metricKind: 'current_context_state',
      observedAt: new Date().toISOString(),
      contextMeasurement: currentState.latestProviderReportedInputTokens > 0 ? 'provider_reported'
        : currentState.latestProviderInputTokens > 0 ? 'request_estimate' : 'composition_estimate',
      currentState,
      currentStateTokens: currentState.currentStateTokens,
      contextUsage,
      nextCallEstimateTokens: currentInputTokens,
      currentInputTokens,
      messageTokens,
      toolObservationTokens: toolTokens,
      storedThread,
      modelUsage,
      toolUsage,
      calibration,
      contextWindowTokens: profile.contextWindowTokens,
      contextLimitTokens: currentState.contextLimitTokens,
      currentContextLimitTokens: profile.contextWindowTokens,
      inputBudgetTokens: budget.inputBudgetTokens,
      compactionTriggerTokens: budget.compactionTriggerTokens,
      cachedTokens: currentState.cachedTokens,
      totalThreadTokens: currentState.totalThreadTokens,
      percentOfWindow: profile.contextWindowTokens > 0 ? currentState.currentStateTokens / profile.contextWindowTokens : 0,
      percentOfContextLimit: contextUsage.ratio,
      percentOfCompactionTrigger: budget.compactionTriggerTokens > 0 ? currentState.currentStateTokens / budget.compactionTriggerTokens : 0,
      percentOfInputBudget: budget.inputBudgetTokens > 0 ? currentInputTokens / budget.inputBudgetTokens : 0,
      historyMessages: history.length,
      hasToolObservations: !!recentToolContext,
    });
  } catch (e: any) {
    console.error('[/api/sessions/:id/context-window] Error:', e);
    res.status(500).json({ error: e.message || 'Failed to compute context window' });
  }
});

router.post('/api/sessions/:id/main-goal/:action', requireSafeSessionParam, (req, res) => {
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
    const note = String(req.body?.goal || req.body?.text || req.body?.reason || req.body?.note || '').trim();
    const suffix = action === 'revise'
      ? `revise ${note}`
      : (note ? `${action} ${note}` : action);
    const result = handleMainChatGoalCommand(sessionId, `/goal ${suffix}`);
    if (result.shouldStartRunner) startMainChatGoalRunner(sessionId, `goal_action:${action}`);
    broadcastMainChatGoalState(sessionId, `action:${action}`, { goal: result.goal });
    res.json({ success: true, message: result.message, goal: result.goal });
  } catch (e: any) {
    console.error('[/api/sessions/:id/main-goal/:action] Error:', e);
    res.status(500).json({ success: false, error: e.message || 'Goal action failed' });
  }
});

router.delete('/api/sessions/:id', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      res.status(400).json({ error: 'Session id is required' });
      return;
    }
    const project = findProjectBySessionId(sessionId);
    const deleted = project
      ? !!deleteSessionFromProject(project.id, sessionId)
      : deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ success: true, projectId: project?.id });
  } catch (e: any) {
    console.error('[/api/sessions/:id DELETE] Error:', e);
    res.status(storageAwareStatus(e)).json({ error: e.message });
  }
});
}

