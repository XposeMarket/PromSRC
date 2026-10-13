import type { Router, RequestHandler } from 'express';
import { assertSafeStorageId, isStorageBoundaryError } from '../../../storage/storage-paths.js';
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
import { normalizeVoiceAgentTarget, buildVoiceWorkerContextPacket, prewarmVoiceAgentContextBlock, findActiveMainChatRuntimeForSession, getReusableVoiceContextPacket, compactVoiceText, VoiceAgentAction, voiceAgentTargetIdentity, voiceAgentWorkerHandoffSessions } from './context';
import { composeVoiceAgentNarration, callVoiceAgentDecisionModel } from './decision-model';
import { classifyVoiceInterruption, buildVoiceInterruptionContextBlock, buildChatSteerContextBlock, appendVoiceInterruptionLog } from './narrator';
import { voiceRuntimeContextText, parseVoiceToolResult, buildVoiceAgentHandoffContext } from './fallback';
import { decideVoiceAgentAction, VoiceAgentDecision, VoiceAgentProcessEntry, pushVoiceAgentProcessEntry, exactActiveWorkerVoiceCommand, voiceSteerKindFromIntent, buildVoiceContextSummaryForSteer } from './decision';
import { executeVoiceThreadOps } from './task-tools';
import { cleanVoiceWakePhrase } from './tool-helpers';
import { persistVoiceAgentVisibleTurn } from './spoken-reply';
import { router, requireSafeSessionParam, summarizeMobileRuntime, storageAwareStatus } from './dependencies';

export function registerVoiceRoutes(router: Router, requireSafeSessionParam: RequestHandler) {


router.post('/api/voice-agent/realtime-context', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const originalUserPrompt = String(body.originalUserPrompt || body.transcript || body.userInterruptionTranscript || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, body);
    prewarmVoiceAgentContextBlock(sessionId, originalUserPrompt, { source: body.source || 'voice_context_endpoint', voiceTarget });
    res.json({
      ok: true,
      success: true,
      contextPacket,
      prewarmed: true,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.get('/api/voice-agent/realtime-context/:sessionId', requireSafeSessionParam, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || 'default').trim() || 'default';
    const query = req.query as any;
    const originalUserPrompt = String(query.originalUserPrompt || query.transcript || query.userInterruptionTranscript || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(query);
    const contextPacket = buildVoiceWorkerContextPacket(sessionId, query);
    prewarmVoiceAgentContextBlock(sessionId, originalUserPrompt, { source: query.source || 'voice_context_endpoint', voiceTarget });
    res.json({
      ok: true,
      success: true,
      contextPacket,
      prewarmed: true,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

router.post('/api/_removed/voice-agent-narrate', (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const contextPacket = body.contextPacket && typeof body.contextPacket === 'object'
      ? body.contextPacket
      : buildVoiceWorkerContextPacket(sessionId, body);
    const narration = composeVoiceAgentNarration(contextPacket, body);
    res.json({
      ok: true,
      success: true,
      ...narration,
      contextPacket,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, success: false, error: String(err?.message || err) });
  }
});

function isRealtimeVoiceAgentInputRequest(body: any): boolean {
  const voiceMode = String(body?.voiceMode || body?.voice_mode || '').trim().toLowerCase();
  const source = String(body?.source || body?.origin || '').trim().toLowerCase();
  const runtime = body?.voiceRuntime || body?.voice_runtime || {};
  const runtimeMode = String(runtime?.voiceMode || runtime?.voice_mode || runtime?.mode || '').trim().toLowerCase();
  return (
    voiceMode.includes('realtime')
    || source.includes('realtime')
    || runtimeMode.includes('realtime')
    || body?.realtimeAgent === true
    || body?.realtime_agent === true
    || body?.voiceAgentRealtimeAgent === true
    || body?.voiceAgentXaiRealtime === true
    || runtime?.realtimeAgent === true
    || runtime?.realtime_agent === true
    || runtime?.voiceAgentRealtimeAgent === true
    || runtime?.voiceAgentXaiRealtime === true
  );
}

router.post('/api/_removed/voice-agent-input', async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    const body = req.body || {};
    const sessionId = assertSafeStorageId(String(body.sessionId || 'default').trim() || 'default', 'session ID');
    const realtimeAgentInput = isRealtimeVoiceAgentInputRequest(body);
    // Streaming mode: client sends { stream: true } and consumes SSE.
    // Server emits one `chunk` event per sentence as the model generates the
    // spokenReply, then a `done` event with the full result payload.
    const streamMode = body.stream === true || body.stream === 'true'
      || String(req.headers['accept'] || '').toLowerCase().includes('text/event-stream');
    let chunkSeq = 0;
    const emittedChunkTexts: string[] = [];
    if (streamMode) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      try { (res as any).flushHeaders?.(); } catch {}
      // Heartbeat to keep the connection alive on proxies
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch {}
      }, 15000);
      res.on('close', () => clearInterval(heartbeat));
      res.on('finish', () => clearInterval(heartbeat));
    }
    const writeSseEvent = (type: string, payload: Record<string, any>) => {
      if (!streamMode) return;
      try {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      } catch {}
    };
    const emitSpeechChunk = (text: string) => {
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      chunkSeq += 1;
      emittedChunkTexts.push(trimmed);
      writeSseEvent('chunk', { seq: chunkSeq, text: trimmed });
    };
    const transcript = String(body.transcript || body.userInterruptionTranscript || body.message || '').trim();
    const voiceTarget = normalizeVoiceAgentTarget(body);
    const classification = classifyVoiceInterruption(transcript);
    const activeRuntime = findActiveMainChatRuntimeForSession(sessionId, String(body.expectedRuntimeId || body.runtimeId || body.activeRunId || ''));
    const contextPacketStartedAt = Date.now();
    const contextPacket = getReusableVoiceContextPacket(sessionId, body, activeRuntime);
    const voiceRuntimeContext = voiceRuntimeContextText(body.voiceRuntime || body.voice_runtime);
    const contextPacketMs = Date.now() - contextPacketStartedAt;
    const eventId = String(body.id || `voice_intr_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
    const fallbackAction = decideVoiceAgentAction(transcript, classification, contextPacket);
    const fallbackDecision: VoiceAgentDecision = {
      action: fallbackAction,
      spokenReply: '',
      workerInstruction: fallbackAction === 'handoff_new_work' || fallbackAction === 'steer_worker' ? transcript : '',
      needsWorkerResponse: classification.intent === 'question',
      reason: 'deterministic_fallback',
    };
    if (voiceRuntimeContext) {
      contextPacket.voiceRuntime = voiceRuntimeContext;
    }
    const voiceProcessEntries: VoiceAgentProcessEntry[] = [];
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'user', `User: ${compactVoiceText(transcript, 900)}`, {
      stage: 'voice_user_transcript',
      transcript,
      totalMs: Date.now() - requestStartedAt,
    });
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: worker packet ${contextPacketMs}ms.`, {
      stage: 'voice_worker_context_packet',
      elapsedMs: contextPacketMs,
      totalMs: Date.now() - requestStartedAt,
    });
    if (realtimeAgentInput) {
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', 'Realtime Voice Agent caller detected; deterministic voice fast-routes disabled except quiet/wake runtime controls.', {
        stage: 'voice_realtime_fast_routes_disabled',
        voiceMode: String(body.voiceMode || '').trim(),
        source: String(body.source || '').trim(),
        totalMs: Date.now() - requestStartedAt,
      });
    }
    const exactCommand = !realtimeAgentInput && contextPacket.active ? exactActiveWorkerVoiceCommand(transcript) : '';
    let decision: VoiceAgentDecision;
    let fastRouteReason = '';
    if (exactCommand) {
      const action: VoiceAgentAction = exactCommand === 'stop' ? 'interrupt_worker' : 'steer_worker';
      decision = {
        action,
        spokenReply: '',
        workerInstruction: transcript,
        needsWorkerResponse: exactCommand === 'status',
        reason: `exact_active_worker_voice_command:${exactCommand}`,
      };
      fastRouteReason = `exact:${exactCommand}`;
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: exact ${exactCommand} command routed without model.`, {
        stage: 'voice_fast_router',
        command: exactCommand,
        action,
        totalMs: Date.now() - requestStartedAt,
      });
    } else {
      decision = await callVoiceAgentDecisionModel(
        sessionId,
        transcript,
        classification,
        contextPacket,
        fallbackDecision,
        voiceProcessEntries,
        streamMode ? emitSpeechChunk : undefined,
        { disableDeterministicFastRoutes: realtimeAgentInput, voiceTarget },
      );
    }
    if (decision.action === 'answer_now' && !String(decision.spokenReply || '').trim() && transcript) {
      decision = {
        ...decision,
        action: 'handoff_new_work',
        workerInstruction: decision.workerInstruction || transcript,
        needsWorkerResponse: true,
        reason: `${decision.reason || 'voice_agent_empty_answer'};empty_answer_handoff`,
      };
      pushVoiceAgentProcessEntry(voiceProcessEntries, 'warn', 'Voice Agent returned no spoken answer; handing off instead of using a fallback reply.', {
        stage: 'voice_empty_answer_handoff',
        totalMs: Date.now() - requestStartedAt,
      });
    }
    let action = decision.action;
    // Legacy non-realtime voice routing still emits handoff_new_work. Convert
    // that signal into the new first-class thread path before the client can
    // start the retired foreground/workgroup worker flow.
    if (action === 'handoff_new_work' && !voiceAgentTargetIdentity(voiceTarget).isSubagent) {
      const threadPrompt = String(decision.workerInstruction || transcript).trim();
      if (threadPrompt) {
        const threadRaw = await executeVoiceThreadOps(sessionId, {
          action: 'create',
          title: compactVoiceText(threadPrompt, 80) || 'Voice task',
          prompt: threadPrompt,
          objective: threadPrompt,
          launch_mode: 'supervise',
          voiceTarget,
        });
        const threadResult = parseVoiceToolResult(threadRaw);
        if (threadResult.ok !== false) {
          decision = {
            ...decision,
            action: 'answer_now',
            spokenReply: decision.spokenReply || 'Iâ€™m on it. Iâ€™ll keep you posted as it moves.',
            reason: `${decision.reason || 'voice_handoff'};thread_created`,
          };
          action = decision.action;
          pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', 'Voice handoff created a first-class Prometheus thread.', {
            stage: 'voice_thread_handoff',
            summary: threadResult.summary || '',
          });
        }
      }
    }
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
      voiceTarget,
    };
    let injectedContextText = buildVoiceInterruptionContextBlock(event);
    let steerApplied = false;
    let steerEventId = '';
    if (
      action === 'steer_worker'
      && activeRuntime?.id
      && transcript
      && !classification.shouldAbortOriginalRun
      && (exactCommand === 'pause' || !classification.shouldPauseOriginalRun)
    ) {
      const steer = addPendingRuntimeSteer(activeRuntime.id, {
        sessionId,
        message: decision.workerInstruction || transcript,
        source: String(body.source || `voice_${event.voiceMode || 'agent'}`).trim() || 'voice_agent',
        clientRequestId: event.clientRequestId || undefined,
        kind: voiceSteerKindFromIntent(classification.intent),
        requiresWorkerResponse: decision.needsWorkerResponse === true,
        voiceContextPacketId: contextPacket.id,
        spokenAck: decision.spokenReply || undefined,
        responseMode: decision.needsWorkerResponse ? 'worker_reply' : 'narrate',
        contextSummary: buildVoiceContextSummaryForSteer(contextPacket),
      });
      if (steer.ok && steer.event) {
        steerApplied = true;
        steerEventId = steer.event.id;
        injectedContextText = buildChatSteerContextBlock(steer.event);
      }
    }
    if (action === 'handoff_new_work') {
      injectedContextText = buildVoiceAgentHandoffContext(decision, contextPacket, transcript);
    }
    const voiceReply = decision.spokenReply;
    const rawRuntimeDirectives = [
      ...(Array.isArray((decision as any)?.runtimeDirectives) ? (decision as any).runtimeDirectives : []),
      ...voiceProcessEntries
        .map((entry) => entry?.extra?.runtimeDirective)
        .filter((directive: any) => directive && directive.action),
    ];
    const seenRuntimeDirectives = new Set<string>();
    const runtimeDirectives = rawRuntimeDirectives.filter((directive: any) => {
      const key = JSON.stringify({
        action: String(directive?.action || ''),
        wakePhrase: cleanVoiceWakePhrase(directive?.wakePhrase || ''),
        activateAfterReply: directive?.activateAfterReply === true || directive?.activate_after_reply === true,
        requiresWakePhrase: directive?.requiresWakePhrase === true || directive?.requires_wake_phrase === true,
      });
      if (seenRuntimeDirectives.has(key)) return false;
      seenRuntimeDirectives.add(key);
      return true;
    });
    const storedEvent = { ...event, injectedContextText, status: steerApplied ? 'injected_into_runtime' : 'handled_by_voice_agent', action, voiceReply, decision, contextPacket, processEntries: voiceProcessEntries };
    const totalMs = Date.now() - requestStartedAt;
    pushVoiceAgentProcessEntry(voiceProcessEntries, 'info', `Voice latency: input endpoint total ${totalMs}ms.`, {
      stage: 'voice_agent_input_total',
      elapsedMs: totalMs,
      action,
      steerApplied,
    });
    const isActualInterruption = !!(
      activeRuntime?.id
      || body.isStreamActive === true
      || action === 'steer_worker'
      || action === 'interrupt_worker'
    );
    // resolvedSessionId may differ from the posted sessionId when a voice-first
    // mobile chat was still on the 'mobile_default' draft slot and got rotated
    // to a real mobile_<id> session during persistence. The client adopts this
    // so its live conversation points at the durable, drawer-listed session.
    let resolvedSessionId = sessionId;
    const visibleVoiceArtifacts = Array.isArray(decision.richArtifacts) ? decision.richArtifacts : [];
    if (voiceReply && (action === 'handoff_new_work' || visibleVoiceArtifacts.length)) {
      resolvedSessionId = persistVoiceAgentVisibleTurn(sessionId, transcript, voiceReply, action, eventId, voiceProcessEntries, visibleVoiceArtifacts) || sessionId;
    }
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
          workerInstruction: compactVoiceText(decision.workerInstruction || '', 700),
          voiceReply: voiceReply.slice(0, 500),
          at: Date.now(),
        },
      });
      if (action === 'interrupt_worker' && activeRuntime.abortable) {
        abortLiveRuntime(activeRuntime.id);
      }
    }
    if (isActualInterruption) {
      broadcastWS({
        type: 'voice_interruption',
        isInterruption: true,
        sessionId: resolvedSessionId,
        originalSessionId: sessionId,
        resolvedSessionId,
        eventId,
        intent: classification.intent,
        action,
        transcript,
        currentUserPrompt: transcript,
        userInterruptionTranscript: transcript,
        voiceReply,
        decision,
        processEntries: voiceProcessEntries,
        runtimeDirectives,
        shouldAbortOriginalRun: action === 'interrupt_worker',
        runtimeId: activeRuntime?.id || '',
        steerApplied,
        steerEventId,
        voiceContextPacketId: contextPacket.id,
      });
    } else {
      broadcastWS({
        type: 'voice_agent_turn',
        isInterruption: false,
        sessionId: resolvedSessionId,
        originalSessionId: sessionId,
        resolvedSessionId,
        eventId,
        action,
        transcript,
        currentUserPrompt: transcript,
        voiceReply,
        decision,
        processEntries: voiceProcessEntries,
        runtimeDirectives,
        voiceContextPacketId: contextPacket.id,
      });
    }
    const responsePayload = {
      ok: true,
      success: true,
      eventId,
      action,
      resolvedSessionId,
      steerApplied,
      steerEventId,
      runtimeId: activeRuntime?.id || '',
      classification,
      voiceTarget,
      contextPacket,
      decision,
      richArtifacts: Array.isArray(decision.richArtifacts) ? decision.richArtifacts : undefined,
      processEntries: voiceProcessEntries,
      runtimeDirectives,
      timings: {
        totalMs,
        contextPacketMs,
        fastRouted: !!fastRouteReason,
        fastRouteReason,
        fastCommand: exactCommand || '',
        isActualInterruption,
      },
      injectedContextText,
      voiceReply,
      workerInstruction: decision.workerInstruction || '',
      activeRun: activeRuntime ? summarizeMobileRuntime(activeRuntime) : null,
      // When streaming, tell the client that the spoken reply has already been
      // delivered as `chunk` SSE events so it should NOT re-speak voiceReply.
      streamedSpeech: streamMode && emittedChunkTexts.length > 0,
      streamedChunkCount: emittedChunkTexts.length,
    };
    if (streamMode) {
      writeSseEvent('done', { result: responsePayload });
      try { res.end(); } catch {}
    } else {
      res.json(responsePayload);
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(storageAwareStatus(err)).json({ ok: false, success: false, error: String(err?.message || err) });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: String(err?.message || err) })}\n\n`);
        res.end();
      } catch {}
    }
  }
});
}

