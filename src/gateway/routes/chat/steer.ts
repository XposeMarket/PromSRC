import type { Router, RequestHandler } from 'express';
import { createVoiceNarrator, classifyVoiceInterruption, buildVoiceInterruptionContextBlock, buildChatSteerContextBlock, appendVoiceInterruptionLog } from './voice/narrator';
import { getSession, addMessage, getHistory, getHistoryForApiCall, getActiveHistoryForApiCall, getActiveHistoryForPersistence, getRecentToolObservationsForContext, getWorkingContextForContext, recordWorkingContextPacket, persistToolLog, getWorkspace, setWorkspace, cleanupSessions, listSessionSummaries, searchSessionSummaries, recordSessionCompaction, deleteSession, renameSession, setSessionPinned, reorderSessionSidebar, autoNameSession, replaceHistory, touchSession, flushSession, markSessionReadForMobile, markSessionUnreadForMobile, getCreativeMode, getCreativeReferences, formatCreativeReferencesForPrompt, getActivatedToolCategories, activateToolCategory, captureToolCategoryActivationState, restoreToolCategoryActivationState, getActivatedSkillIds, getActivatedSkillResources, activateSkillForSession, activateSkillResourceForSession, getSessionDisplayTitle, isBusinessContextEnabled, getSessionPersistenceStatus, type TurnOrigin, type VoiceRoomMetadata, type VoiceRoomParticipant } from '../../session';
import { buildDurableChatTraceFromFrames, buildDurableChatTraceFromProcessEntries } from '../../durable-chat-trace';
import { assertSafeStorageId, isStorageBoundaryError } from '../../storage/storage-paths.js';
import { bgPlanDeclare, bgPlanAdvance, backgroundJoin, backgroundStatus, backgroundAbort, backgroundSteer, listActiveBackgroundIdsForSession, registerBackgroundCompletionWake } from '../../tasks/task-runner';
import { getVerificationFlowManager, getApprovalQueue } from '../../verification-flow';
import { getPrometheusQuestionQueue } from '../../prometheus-questions';
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
import { normalizeRuntimeVisionAttachmentsInput, normalizeRuntimeAttachmentPreviewsInput, summarizeMobileRuntime } from './shared';
import type { MainChatStreamState } from '../../chat/main-chat-stream-store';



export function registerSteerRoutes(router: Router, deps: {
  getMainChatStream: (sessionId: string) => MainChatStreamState | null;
}): void {
  const { getMainChatStream } = deps;
router.post('/api/chat/steer', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session id');
    const steerAttachments = normalizeRuntimeVisionAttachmentsInput(body.attachments);
    const steerAttachmentPreviews = normalizeRuntimeAttachmentPreviewsInput(body.attachmentPreviews);
    const message = String(body.message || body.text || '').trim()
      || (steerAttachments.length || steerAttachmentPreviews.length ? `User sent ${steerAttachments.length + steerAttachmentPreviews.length} attachment(s) as a live steer.` : '');
    if (!message && steerAttachments.length === 0 && steerAttachmentPreviews.length === 0) {
      res.status(400).json({ ok: false, success: false, error: 'Message or attachment required' });
      return;
    }
    const mobileQueueSteer = String(body.source || '').trim() === 'mobile_queue_button';
    const clientSteerId = mobileQueueSteer ? String(body.clientSteerId || '').trim().slice(0, 160) : '';
    // A response can be lost after the gateway accepted the steer. Retrying the
    // same queued item must not inject or display it a second time.
    const priorSteer = clientSteerId
      ? getSession(sessionId).history.find((entry: any) => entry?.role === 'user' && entry?.clientSteerId === clientSteerId)
      : null;
    if (priorSteer) {
      res.json({ ok: true, success: true, eventId: (priorSteer as any).steerEventId,
        messageId: priorSteer.messageId, timestamp: priorSteer.timestamp,
        workflowGroupId: (priorSteer as any).workflowGroupId, alreadyAccepted: true });
      return;
    }
    const expectedRuntimeId = String(body.expectedRuntimeId || body.runtimeId || '').trim();
    const activeRuntime = listLiveRuntimes()
      .filter((runtime) => (
        isSteerableChatRuntimeKind(runtime.kind)
        && String(runtime.sessionId || '') === sessionId
        && (!expectedRuntimeId || runtime.id === expectedRuntimeId)
      ))
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0] || null;
    if (!activeRuntime?.id) {
      res.status(409).json({ ok: false, success: false, error: 'No active steerable chat turn for this session.' });
      return;
    }
    const steer = addPendingRuntimeSteer(activeRuntime.id, {
      sessionId,
      message,
      source: String(body.source || 'web_queue_steer').trim() || 'web_queue_steer',
      clientRequestId: String(body.clientRequestId || '').trim() || undefined,
      attachments: steerAttachments,
      attachmentPreviews: steerAttachmentPreviews,
    });
    if (!steer.ok || !steer.event) {
      res.status(409).json({ ok: false, success: false, error: steer.error || 'Could not queue steer event.' });
      return;
    }
    // The server owns the steer split for every source (mobile, desktop, voice):
    // the boundary is the live stream position at acceptance, and the tool
    // stream up to it is persisted as a `before_interruption` row ahead of the
    // steer row. Clients and reconnects read this instead of guessing.
    let durableSteer: any = null;
    let durableBefore: any = null;
    {
      const timestamp = Date.now();
      const displayMessage = String(body.displayMessage || message).trim() || message;
      const groupId = `chat_steer_${steer.event.id}`;
      const liveStream = getMainChatStream(sessionId);
      const streamLive = !!(liveStream && liveStream.active);
      const boundarySeq = streamLive
        ? Math.max(0, Number(liveStream!.nextSeq || 1) - 1)
        : Math.max(0, Math.floor(Number(body.workflowBoundarySeq || 0) || 0));
      const boundaryStreamId = streamLive ? liveStream!.streamId : (String(body.workflowStreamId || '').trim() || undefined);
      // A second steer in the same stream: its "before" segment is the first
      // steer's continuation, and keeps that row's identity.
      const prevSteer: any = boundaryStreamId
        ? [...getSession(sessionId).history].reverse().find((e: any) => e?.role === 'user'
          && String(e.workflowPart || '') === 'interruption'
          && /^chat_steer_/i.test(String(e.workflowGroupId || ''))
          && String(e.workflowStreamId || '') === boundaryStreamId)
        : null;
      const lowerSeq = prevSteer ? Math.max(0, Number(prevSteer.workflowBoundarySeq || 0) || 0) : 0;
      const beforeMessageId = prevSteer ? `${prevSteer.workflowGroupId}:continuation` : `${groupId}:before`;
      if (streamLive && boundarySeq > lowerSeq) {
        const frames = liveStream!.events.filter((f: any) => Number(f.seq) > lowerSeq && Number(f.seq) <= boundarySeq);
        durableBefore = {
          role: 'assistant', content: '', timestamp: timestamp - 1,
          messageId: beforeMessageId,
          workflowGroupId: groupId, workflowPart: 'before_interruption', workflowLabel: 'Tool stream before steer',
          workflowBoundarySeq: boundarySeq, workflowStreamId: boundaryStreamId,
          liveTraceEntries: buildDurableChatTraceFromFrames(frames, `trace_${liveStream!.streamId}`) || [],
          ...(String(body.clientRequestId || '').trim() ? { clientRequestId: String(body.clientRequestId).trim() } : {}),
        };
        if (!getSession(sessionId).history.some((e: any) => String(e?.messageId || '') === beforeMessageId)) {
          addMessage(sessionId, durableBefore, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
        }
      }
      durableSteer = {
        role: 'user', content: displayMessage, timestamp,
        messageId: `chat-steer:${steer.event.id}`,
        steerEventId: steer.event.id,
        clientSteerId: clientSteerId || undefined,
        channel: mobileQueueSteer ? 'mobile' : 'web', channelLabel: 'steer',
        workflowGroupId: groupId,
        workflowPart: 'interruption', workflowLabel: 'Message sent as steer',
        workflowBoundarySeq: boundarySeq,
        workflowStreamId: boundaryStreamId,
        ...(steerAttachments.length ? { attachments: steerAttachments } : {}),
        ...(steerAttachmentPreviews.length ? { attachmentPreviews: steerAttachmentPreviews } : {}),
      };
      addMessage(sessionId, durableSteer, { disableCompactionCheck: true, disableMemoryFlushCheck: true });
      flushSession(sessionId);
    }
    const injectedContextText = buildChatSteerContextBlock(steer.event);
    updateLiveRuntimeCheckpoint(activeRuntime.id, {
      chatSteerEvent: {
        id: steer.event.id,
        transcript: message.slice(0, 500),
        injectedContextText,
        attachmentCount: steerAttachments.length + steerAttachmentPreviews.length,
        at: Date.now(),
      },
    });

    // Wake up any tool Promise waiting for a dev-source-edit approval for this session
    try {
      const approvalQueue = getApprovalQueue();
      const pendingApprovals = approvalQueue.listPending()
        .filter((a) => a.sessionId === sessionId && a.approvalKind === 'dev_source_edit');
      for (const pending of pendingApprovals) {
        approvalQueue.notifySteer(pending.id, message);
      }
    } catch { /* best effort */ }

    try {
      const questionQueue = getPrometheusQuestionQueue();
      const pendingQuestions = questionQueue.listPending()
        .filter((q) => q.sessionId === sessionId);
      for (const pending of pendingQuestions) {
        questionQueue.notifySteer(pending.id, message);
      }
    } catch { /* best effort */ }

    broadcastWS({
      type: 'chat_steer',
      sessionId,
      eventId: steer.event.id,
      runtimeId: activeRuntime.id,
      workflowGroupId: durableSteer?.workflowGroupId,
      messageId: durableSteer?.messageId,
      beforeMessageId: durableBefore?.messageId,
      workflowBoundarySeq: durableSteer?.workflowBoundarySeq,
      workflowStreamId: durableSteer?.workflowStreamId,
      timestamp: durableSteer?.timestamp,
      clientSteerId: clientSteerId || undefined,
      displayMessage: String(durableSteer?.content || '').slice(0, 500),
      message: message.slice(0, 500),
      attachments: steerAttachments,
      attachmentPreviews: steerAttachmentPreviews,
    });
    res.json({
      ok: true,
      success: true,
      eventId: steer.event.id,
      runtimeId: activeRuntime.id,
      injectedContextText,
      activeRun: summarizeMobileRuntime(activeRuntime),
      ...(durableSteer ? {
        messageId: durableSteer.messageId,
        timestamp: durableSteer.timestamp,
        workflowGroupId: durableSteer.workflowGroupId,
        workflowBoundarySeq: durableSteer.workflowBoundarySeq,
        workflowStreamId: durableSteer.workflowStreamId,
        ...(durableBefore ? { beforeMessageId: durableBefore.messageId } : {}),
      } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/background-agents/steer', (req, res) => {
  try {
    const body = req.body || {};
    const backgroundId = assertSafeStorageId(
      String(body.backgroundId || body.id || '').trim(),
      'background agent id',
    );
    const message = String(body.message || body.text || '').trim();
    if (!message) {
      res.status(400).json({ ok: false, success: false, error: 'Message required' });
      return;
    }
    const result = backgroundSteer(backgroundId, message, {
      source: String(body.source || 'web_background_agent_chat').trim() || 'web_background_agent_chat',
      kind: String(body.kind || 'constraint').trim() as any,
    });
    if (!result.queued) {
      res.status(409).json({ ok: false, success: false, ...result });
      return;
    }
    res.json({ ok: true, success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, success: false, error: String(err?.message || err || 'Could not steer background agent.') });
  }
});
}

