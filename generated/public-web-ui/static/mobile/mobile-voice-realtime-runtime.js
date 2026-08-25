// Mobile Voice realtime transport and camera runtime. The entry module owns configuration, room helpers, and speech UI.
export function createMobileVoiceRealtimeRuntime(scope = {}) {
  const {
    MOBILE_CHAT_SESSION_ID,
    __pmChat,
    __pmRealtimeAgent,
    __pmVoice,
    _activeMobileThread,
    _appendMobileRealtimeTranscriptDelta,
    _appendVoiceAgentProcessEntriesToTurn,
    _armMobileVoiceRoomHandoffAckGuard,
    _attachVoiceAgentProcessEntriesToMobileTurn,
    _cleanMobileWakePhrase,
    _cleanVoiceSpeechText,
    _clearMobileCodexVoiceRoomWarmPool,
    _closeMobileCodexVoiceRoomConnection,
    _consumeMobileVoiceRoomHandoffEcho,
    _ensureDurableMobileVoiceSession,
    _executeMobileVoiceRoomHandoffTool,
    _getCachedMobileVoiceWorkerContextPacket,
    _hasMobileVoiceWorkIntent,
    _isBenignRealtimeCancelError,
    _isMobileCodexV3RealtimeConnection,
    _isMobileHiddenVoiceDraftMessage,
    _isMobileRestartContextPacketText,
    _isMobileVoiceDirectAnswerOnlyTurn,
    _isMobileVoiceStatusQuestion,
    _isNoActiveRealtimeCancelError,
    _isUsableRealtimeOfferSdp,
    _isVoiceRoomEnabled,
    _loadVoiceSettings,
    _markMobileRealtimeAgentBackendReady,
    _markVoiceSpeakingEnd,
    _markVoiceSpeakingStart,
    _mergeMobileRealtimeTranscriptSnapshot,
    _mobileMessageCopyText,
    _mobileRealtimeAudioPlaybackMs,
    _mobileRealtimeBootstrapSupersededError,
    _mobileRealtimeCurrentStagedAttachmentTurn,
    _mobileRealtimeRawTranscriptDelta,
    _mobileRealtimeTurnDetectionForListenMode,
    _mobileRealtimeVoice,
    _mobileToolLabel,
    _mobileVoiceRoomCodexInstructions,
    _mobileVoiceRoomContextPayload,
    _mobileVoiceRoomParticipantSessionId,
    _mobileVoiceRoomWarmPool,
    _mobileVoiceSettingsFromAgentProfile,
    _mobileVoiceToolKey,
    _normalizeMobileWakePhrase,
    _normalizeVoiceAgentProcessEntry,
    _normalizeVoiceEchoText,
    _notifyMobileChatVoiceUpdate,
    _notifyMobileVoiceAgentConnection,
    _nowTime,
    _persistMobileThreadSnapshot,
    _prefetchMobileVoiceWorkerContextPacket,
    _prewarmMobileCodexRealtimeBridge,
    _readMobileActiveRun,
    _realtimeSdpPostBody,
    _rebindMobileCodexBridgeOwnerSession,
    _releaseMobileVoiceRoomHandoffAckGuard,
    _renderMobileChatSessionNow,
    _renderRecent,
    _routeMobileVoiceRoomTranscript,
    _saveVoiceSettings,
    _scheduleMobileCodexVoiceRoomPrewarm,
    _sendMobileCodexVisionSummaryToRealtime,
    _sendMobileRealtimeAgentSessionUpdateFromSettings,
    _setMobileVoiceLyricProgress,
    _setMobileVoiceStatus,
    _setMobileVoiceToolActive,
    _setOrbState,
    _setReadyVoiceState,
    _setStatus,
    _takePendingVoiceAgentProcessEntries,
    _updateMobilePrimaryWorkgroupLink,
    _upsertMobileVoiceWorkgroup,
    _voiceDebug,
    _voiceRoomActiveParticipant,
    _voiceRoomCurrentTargetKey,
    _voiceRoomParticipantKey,
    _voiceRoomParticipantLabel,
    _voiceRoomRememberTranscript,
    _voiceShowReadyStatus,
    _voiceShowRealtimeAgentMessage,
    _voiceShowRealtimeUserTranscript,
    _voiceSubagentRoomParticipant,
    _waitForLocalRealtimeOfferSdp,
    buildMobileGatewayWsUrl,
    loadMobileSubagentDetail,
    mobileGatewayFetch,
    mobileGatewayTextFetch,
    pmToast,
    stopMobileMainChat,
    window,
  } = scope || {};
  const MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED = true;
  const MOBILE_REALTIME_HANDOFF_CLAIM_RE = /\b(hand(?:ing|ed)?\s*(?:it|that|this)?\s*off|to the worker|kick(?:ing)?\s*(?:it|that)?\s*off|i('?ve|\s*have)?\s*started|getting started|i'?ll\s*(?:start|get|run|handle|take care)|on it|working on (?:it|that)|in progress|started (?:it|that|the|on)|spun? up|firing up)\b/i;

  function _maybeRecoverMobileHallucinatedHandoff() {
    if (!MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED) return;
    const subagentTarget = _currentMobileSubagentVoiceTarget();
    if (!subagentTarget) return;
    const t = __pmRealtimeAgent.turn;
    if (t.hadFunctionCall || t.nudged) return;
    const task = String(t.lastUserTranscript || '').trim();
    if (!task || !MOBILE_REALTIME_HANDOFF_CLAIM_RE.test(t.lastAssistantTranscript || '')) return;
    t.nudged = true;
    _voiceDebug('realtime-agent-handoff-recovery', { task: task.slice(0, 160) });
    try {
      if (typeof __pmRealtimeAgent.submitToWorker === 'function') {
        const sid = __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId;
        _removeMobileRealtimeAgentChatTurn(sid, 'user', task);
        _markMobileRealtimeAgentWorkerDispatch(sid, task);
        __pmRealtimeAgent.submitToWorker(task, {
          source: 'realtime_agent_dispatch_recovery',
          skipVoiceAgentHandoff: true,
          visibleTranscript: task,
        });
      }
    } catch (err) {
      _voiceDebug('realtime-agent-handoff-recovery-failed', { message: err?.message || String(err) });
    }
  }

  function _sendMobileRealtimeAgentCreateResponseFlag(enabled) {
    const conn = __pmRealtimeAgent.conn;
    const dc = conn?.dc;
    if (!dc || dc.readyState !== 'open') return;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      _voiceDebug?.('codex-v3-create-response-flag-managed-by-avas', { enabled: !!enabled });
      return;
    }
    const listenMode = __pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode;
    // Quiet mode (create_response gating) only applies to always-listening server VAD.
    // In push-to-talk there is no turn_detection, so don't reinstate server VAD here.
    if (listenMode !== 'always_listening') return;
    const turnDetection = {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: listenMode === 'always_listening' ? 500 : 800,
      // Keep VAD/transcription active while the camera is open, but make the
      // client explicitly own response creation for the gated camera turn.
      interrupt_response: !!enabled,
      create_response: !!enabled,
    };
    try {
      if (__pmRealtimeAgent.conn?.provider === 'xai') {
        _sendMobileRealtimeDataChannelEvent(dc, {
          type: 'session.update',
          session: { turn_detection: turnDetection },
        });
      } else {
        _sendMobileRealtimeDataChannelEvent(dc, {
          type: 'session.update',
          session: {
            type: 'realtime',
            audio: {
              input: {
                turn_detection: turnDetection,
                transcription: { model: 'gpt-realtime-whisper' },
              },
            },
          },
        });
      }
    } catch {}
  }

  function _mobileRealtimeCameraPendingImageCount() {
    const images = Array.isArray(__pmRealtimeAgent?.pendingImages) ? __pmRealtimeAgent.pendingImages : [];
    return images.filter((image) => image && image.realtimeInjected !== true).length;
  }

  function _mobileRealtimeCameraFeedIsOpen() {
    const runtime = __pmRealtimeAgent?.cameraRuntime || {};
    const live = __pmRealtimeAgent?.liveCameraVision || {};
    return runtime.open === true
      || typeof __pmRealtimeAgent?.liveCameraFrameReader === 'function'
      || live.active === true;
  }

  function _mobileRealtimeCameraSessionIsOpen() {
    const runtime = __pmRealtimeAgent?.cameraRuntime || {};
    return runtime.open === true
      && typeof __pmRealtimeAgent?.liveCameraFrameReader === 'function'
      && __pmRealtimeAgent?.conn?.dc?.readyState === 'open';
  }

  function _mobileRealtimeCameraRuntimeIsActive() {
    return _mobileRealtimeCameraFeedIsOpen() || _mobileRealtimeCameraPendingImageCount() > 0;
  }

  function _mobileRealtimeCameraRuntimePayload() {
    const feedOpen = _mobileRealtimeCameraFeedIsOpen();
    const pendingImageCount = _mobileRealtimeCameraPendingImageCount();
    if (!feedOpen && !pendingImageCount) return undefined;
    return {
      active: true,
      feedOpen,
      pendingImageCount,
    };
  }

  function _mobileRealtimeCameraRuntimeText(options = {}) {
    const runtime = __pmRealtimeAgent?.cameraRuntime || {};
    const feedOpen = options.feedOpen == null ? _mobileRealtimeCameraFeedIsOpen() : options.feedOpen === true;
    const pendingImageCount = _mobileRealtimeCameraPendingImageCount();
    const attachedImageCount = Math.max(0, Number(options.imageCount || 0) || 0);
    const imageCount = attachedImageCount || pendingImageCount;
    if (!feedOpen && !imageCount && options.force !== true) return '';
    const sourceLine = feedOpen
      ? 'The mobile camera live feed is open and is the primary visual source for this voice conversation.'
      : 'The camera was open when the live camera image was captured, and that image is attached to the current voice turn.';
    const attachmentLine = imageCount === 1
      ? 'Live camera image attached.'
      : imageCount > 1
        ? `Multiple live camera images attached (${imageCount}). Treat them as sequential current camera context.`
        : 'The live camera feed is open, but no frame has been attached yet. Use the next live camera frame when it arrives.';
    return [
      '[MOBILE_CAMERA_RUNTIME]',
      sourceLine,
      attachmentLine,
      'When the user asks what they are showing you, inspect the attached live camera image or images directly.',
      'Do not call voice_desktop or voice_browser to obtain a screenshot for a camera-relative request. Never substitute a desktop screenshot for the mobile camera.',
      'Treat this block as runtime metadata for the next spoken request; do not answer this metadata item separately.',
      '[/MOBILE_CAMERA_RUNTIME]',
    ].join('\n');
  }

  function _sendMobileRealtimeCameraRuntimeUpdate(reason = 'camera_runtime') {
    const conn = __pmRealtimeAgent?.conn;
    const dc = conn?.dc;
    if (!conn || !dc || dc.readyState !== 'open' || _isMobileCodexV3RealtimeConnection(conn)) return false;
    const runtime = __pmRealtimeAgent.cameraRuntime || (__pmRealtimeAgent.cameraRuntime = {});
    const baseInstructions = String(conn.baseInstructions || '').trim();
    const cameraInstructions = _mobileRealtimeCameraRuntimeText();
    const instructions = [baseInstructions, cameraInstructions].filter(Boolean).join('\n\n');
    if (!instructions) return false;
    const sent = _sendMobileRealtimeDataChannelEvent(dc, {
      type: 'session.update',
      session: conn.provider === 'xai'
        ? { instructions }
        : { type: 'realtime', instructions },
    });
    if (sent) {
      runtime.lastInstructions = instructions;
      runtime.updatedAt = Date.now();
      _voiceDebug('realtime-agent-camera-runtime-updated', {
        reason,
        provider: conn.provider || 'openai_realtime',
        feedOpen: _mobileRealtimeCameraFeedIsOpen(),
        pendingImageCount: _mobileRealtimeCameraPendingImageCount(),
      });
    }
    return sent;
  }

  function _setMobileRealtimeCameraRuntime(open, options = {}) {
    const runtime = __pmRealtimeAgent.cameraRuntime || (__pmRealtimeAgent.cameraRuntime = {});
    runtime.open = open === true;
    runtime.source = String(options.source || runtime.source || '').trim();
    runtime.updatedAt = Date.now();
    if (runtime.open) runtime.openedAt = runtime.updatedAt;
    if (!runtime.open && !_mobileRealtimeCameraPendingImageCount()) runtime.turnContextKey = '';
    _sendMobileRealtimeCameraRuntimeUpdate(String(options.reason || (runtime.open ? 'camera_opened' : 'camera_closed')));
    return runtime.open;
  }

  function _sendMobileRealtimeCameraTurnContext(options = {}) {
    const conn = __pmRealtimeAgent?.conn;
    const dc = conn?.dc;
    if (!conn || !dc || dc.readyState !== 'open' || _isMobileCodexV3RealtimeConnection(conn)) return false;
    const imageCount = Math.max(0, Number(options.imageCount || 0) || 0);
    const cameraText = _mobileRealtimeCameraRuntimeText({
      imageCount,
      feedOpen: options.feedOpen,
      force: true,
    });
    if (!cameraText) return false;
    const userText = String(options.userText || '').replace(/\s+/g, ' ').trim();
    const turnId = Number(options.turnId || __pmRealtimeAgent.liveCameraVision?.turnId || 0) || 0;
    const key = `${String(conn.sessionId || '')}:${turnId}:${imageCount}:${_mobileRealtimeCameraFeedIsOpen() ? 'open' : 'closed'}`;
    const runtime = __pmRealtimeAgent.cameraRuntime || (__pmRealtimeAgent.cameraRuntime = {});
    if (runtime.turnContextKey === key && options.force !== true) return true;
    const text = [
      cameraText,
      userText ? `The user's text turn associated with these camera image(s) is: ${userText}` : '',
    ].filter(Boolean).join('\n');
    const sent = _sendMobileRealtimeDataChannelEvent(dc, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    if (sent) {
      runtime.turnContextKey = key;
      _voiceDebug('realtime-agent-camera-turn-context-sent', {
        provider: conn.provider || 'openai_realtime',
        turnId,
        imageCount,
        userTextLength: userText.length,
      });
    }
    return sent;
  }

  function _setMobileRealtimeAgentWakePhrase(phrase) {
    const clean = String(phrase || '').replace(/\s+/g, ' ').trim();
    __pmRealtimeAgent.quiet.wakePhrase = clean;
    __pmRealtimeAgent.quiet.wakeNormalized = _normalizeMobileWakePhrase ? _normalizeMobileWakePhrase(clean) : clean.toLowerCase();
  }

  function _syncMobileRealtimeAgentQuietFromSettings() {
    const wakePhrase = _cleanMobileWakePhrase(__pmVoice?.settings?.wakePhrase || '');
    _setMobileRealtimeAgentWakePhrase(wakePhrase || '');
    __pmRealtimeAgent.quiet.active = !!(
      __pmVoice?.settings?.listenMode === 'always_listening'
      && __pmVoice?.settings?.wakeGateActive === true
      && wakePhrase
    );
    __pmRealtimeAgent.quiet.pendingActivate = false;
    return { wakePhrase, active: __pmRealtimeAgent.quiet.active };
  }

  // Seed the live realtime session with the recent chat thread so the voice agen
  // picks up the conversation the user just had on screen instead of starting cold.
  // Injected as a single system context item right after the data channel opens —
  // robust against instruction clamping and independent of any server restart.
  function _seedMobileRealtimeAgentConversationHistory(dc, sessionId) {
    try {
      if (!dc || dc.readyState !== 'open') return false;
      const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
      if (!sid) return false;
      const thread = Array.isArray(__pmChat?.threads?.[sid]) ? __pmChat.threads[sid] : [];
      const turns = thread
        .filter((msg) => {
          const role = String(msg?.role || '');
          if (role !== 'user' && role !== 'ai' && role !== 'assistant') return false;
          if (_isMobileHiddenVoiceDraftMessage?.(msg)) return false;
          const text = _mobileMessageCopyText(msg);
          return !!text && !_isMobileRestartContextPacketText?.(text);
        })
        .slice(-12)
        .map((msg) => {
          const speaker = String(msg?.role || '') === 'user' ? 'User' : 'Prometheus';
          const text = _mobileMessageCopyText(msg).replace(/\s+/g, ' ').slice(0, 600);
          return text ? `${speaker}: ${text}` : '';
        })
        .filter(Boolean);
      if (!turns.length) return false;
      const block = [
        'You are joining an in-progress chat the user just had on screen. Continue from here — do not reintroduce yourself, do not ask what they need from scratch, and reference what was already said. Recent conversation:',
        '',
        turns.join('\n'),
      ].join('\n');
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: block }],
        },
      }));
      _voiceDebug('realtime-agent-seed-history', { sessionId: sid, turns: turns.length });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-seed-history-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  function _sendMobileRealtimeAgentContextUpdate(contextPacket, options = {}) {
    const dc = __pmRealtimeAgent.conn?.dc;
    if (!dc || dc.readyState !== 'open') return false;
    const packet = contextPacket && typeof contextPacket === 'object' ? contextPacket : null;
    if (!packet) return false;
    const summary = String(packet.summary || '').trim();
    const active = packet.active === true;
    const lines = [
      '## Live Worker context update',
      `Reason: ${String(options.reason || 'worker context refreshed')}`,
      `Active Worker: ${active ? 'yes' : 'no'}`,
      summary ? `Summary: ${summary.slice(0, 1600)}` : '',
      packet.trigger?.detail ? `Triggered by: ${String(packet.trigger.detail).slice(0, 700)}` : '',
      packet.currentlyDoing ? `Currently doing: ${String(packet.currentlyDoing).slice(0, 300)}` : '',
      packet.currentGoal ? `Current goal: ${String(packet.currentGoal).slice(0, 600)}` : '',
      packet.currentPhase ? `Current phase: ${String(packet.currentPhase).slice(0, 200)}` : '',
      packet.activeToolLabel || packet.activeToolName ? `Active tool: ${String(packet.activeToolLabel || packet.activeToolName).slice(0, 200)}` : '',
      Array.isArray(packet.processEntries) && packet.processEntries.length
        ? `Recent process entries: ${packet.processEntries.slice(-5).map(entry => String(entry?.message || entry?.text || entry?.stage || '').trim()).filter(Boolean).join(' | ').slice(0, 1000)}`
        : '',
      Array.isArray(packet.doneAlready) && packet.doneAlready.length
        ? `Done already: ${packet.doneAlready.slice(-6).map(entry => String(entry || '').trim()).filter(Boolean).join(' | ').slice(0, 1000)}`
        : '',
      Array.isArray(packet.recentEvents) && packet.recentEvents.length
        ? `Recent stream events: ${packet.recentEvents.slice(-5).map(entry => String(entry?.message || entry?.text || entry?.stage || '').trim()).filter(Boolean).join(' | ').slice(0, 1000)}`
        : '',
      `Packet id: ${packet.id || packet.contextPacketId || ''}`,
      'Use this update for status/progress questions. Do not steer the Worker unless the user clearly gives a correction, cancellation, or direction change.',
    ].filter(Boolean).join('\n');
    try {
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: lines }],
        },
      }));
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-context-update-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  function _clearMobileRealtimeAgentPendingCreateResponse() {
    if (__pmRealtimeAgent.pendingCreateResponse?.timer) {
      clearTimeout(__pmRealtimeAgent.pendingCreateResponse.timer);
    }
    __pmRealtimeAgent.pendingCreateResponse = null;
  }

  function _sendMobileRealtimeAgentResponseCreate(reason = 'manual') {
    const conn = __pmRealtimeAgent.conn;
    const dc = conn?.dc;
    if (!dc || dc.readyState !== 'open') return false;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      _voiceDebug('codex-v3-response-create-managed-by-avas', { reason });
      return false;
    }
    try {
      const cameraState = _mobileRealtimeLiveVisionState();
      cameraState.responseRequestedAt = Date.now();
      _voiceDebug('realtime-agent-model-request-start', {
        reason,
        provider: conn.provider || 'openai_webrtc',
        cameraTurnId: cameraState.turnId || 0,
        cameraPhase: cameraState.phase || 'idle',
        cameraFrameAt: cameraState.lastAssociatedFrameAt || 0,
        cameraFrameId: cameraState.lastAssociatedFrameId || '',
        cameraFrameCapturedAt: cameraState.lastAssociatedCapturedAt || 0,
      });
      dc.send(JSON.stringify({ type: 'response.create' }));
      _voiceDebug('realtime-agent-response-create', { reason });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-response-create-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  function _scheduleMobileRealtimeAgentResponseAfterSkillContext(reason = 'ptt_release') {
    if (_isMobileCodexV3RealtimeConnection()) {
      _voiceDebug('codex-v3-response-after-skill-context-managed-by-avas', { reason });
      return false;
    }
    _clearMobileRealtimeAgentPendingCreateResponse();
    const pending = { createdAt: Date.now(), reason, timer: null };
    pending.timer = setTimeout(() => {
      if (__pmRealtimeAgent.pendingCreateResponse !== pending) return;
      __pmRealtimeAgent.pendingCreateResponse = null;
      _sendMobileRealtimeAgentResponseCreate(`${reason}_skill_context_timeout`);
    }, 500);
    __pmRealtimeAgent.pendingCreateResponse = pending;
  }

  function _finishMobileRealtimeAgentPendingResponse(reason = 'skill_context_ready') {
    if (!__pmRealtimeAgent.pendingCreateResponse) return false;
    _clearMobileRealtimeAgentPendingCreateResponse();
    return _sendMobileRealtimeAgentResponseCreate(reason);
  }

  function _sanitizeMobileRealtimeAgentSkillContext(rawContext) {
    const context = String(rawContext || '').trim();
    if (!context) return '';
    const lines = context
      .split(/\r?\n/)
      .filter((line) => !/^Latest spoken request\s*:/i.test(String(line || '').trim()));
    const body = lines.join('\n').replace(/^##\s*Realtime Skill Trigger Update\s*/i, '').trim();
    if (!body) return '';
    return [
      '## Realtime Skill Trigger Update',
      'Metadata for the current audio turn only. The user did not send a second message. Do not mention duplicate input because of this update.',
      body,
    ].join('\n');
  }

  function _mobileRealtimeRecentList(name, maxAgeMs) {
    const turn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
    const list = Array.isArray(turn[name]) ? turn[name] : [];
    const now = Date.now();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (now - Number(list[i]?.at || 0) > maxAgeMs) list.splice(i, 1);
    }
    turn[name] = list;
    return list;
  }

  function _shouldIgnoreMobileRealtimeAgentTranscriptEvent(sessionId, event, transcript) {
    const textKey = _normalizeVoiceEchoText(transcript);
    if (!textKey) return true;
    const itemId = String(event?.item_id || event?.item?.id || '').trim();
    const list = _mobileRealtimeRecentList('recentTranscriptEvents', 4500);
    const itemKey = itemId ? `${sessionId || ''}:${itemId}` : '';
    const duplicate = list.some((entry) => (
      (itemKey && entry.itemKey === itemKey)
      || (entry.textKey === textKey && Date.now() - Number(entry.at || 0) < 4500)
    ));
    if (duplicate) {
      _voiceDebug('realtime-agent-transcript-event-dedupe-ignored', {
        sessionId,
        itemId,
        textLen: String(transcript || '').length,
      });
      return true;
    }
    list.push({ itemKey, textKey, at: Date.now() });
    while (list.length > 24) list.shift();
    return false;
  }

  function _shouldInjectMobileRealtimeAgentSkillContext(sessionId, transcript) {
    const textKey = _normalizeVoiceEchoText(transcript);
    if (!textKey) return false;
    const list = _mobileRealtimeRecentList('recentSkillContextKeys', 4500);
    const key = `${sessionId || ''}:${textKey}`;
    if (list.some((entry) => entry.key === key)) {
      _voiceDebug('realtime-agent-skill-context-dedupe-ignored', {
        sessionId,
        textLen: String(transcript || '').length,
      });
      return false;
    }
    list.push({ key, at: Date.now() });
    while (list.length > 24) list.shift();
    return true;
  }

  async function _injectMobileRealtimeAgentSkillContext(sessionId, transcript, options = {}) {
    const conn = __pmRealtimeAgent.conn;
    const dc = conn?.dc;
    const text = String(transcript || '').trim();
    if (!dc || dc.readyState !== 'open' || !text) return false;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // AVAS v3 already has the canonical tool policy in its app-server thread;
      // public conversation.item.create is not a valid way to add a late hint.
      _voiceDebug('codex-v3-skill-context-managed-by-thread', { sessionId, textLen: text.length });
      return false;
    }
    if (!_shouldInjectMobileRealtimeAgentSkillContext(sessionId, text)) return false;
    try {
      const data = await mobileGatewayFetch('/api/voice-agent/realtime-skill-context', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          transcript: text,
          maxChars: options.maxChars || 4200,
        }),
      });
      const context = _sanitizeMobileRealtimeAgentSkillContext(data?.context);
      if (!data?.success || !data?.matched || !context) return false;
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: context }],
        },
      }));
      _voiceDebug('realtime-agent-skill-context-injected', {
        skills: (data.skills || []).map(s => s?.id).filter(Boolean),
        reason: options.reason || '',
      });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-skill-context-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  function _requestMobileRealtimeAgentWorkerNarration(reason = 'worker_context_tick') {
    const dc = __pmRealtimeAgent.conn?.dc;
    if (!dc || dc.readyState !== 'open') return false;
    if (__pmRealtimeAgent?.quiet?.active) return false;
    if (__pmVoice.dictation !== 'milestone') return false;
    if (__pmRealtimeAgent.activeResponse || __pmVoice.realtimeSpeechActiveResponse || __pmVoice.speaking) return false;
    const now = Date.now();
    const minGap = 20000;
    if (now - Number(__pmRealtimeAgent.lastNarrationRequestAt || 0) < minGap) return false;
    if (now - Number(__pmRealtimeAgent.lastResponseEndedAt || 0) < 8000) return false;
    __pmRealtimeAgent.lastNarrationRequestAt = now;
    __pmRealtimeAgent.narrationPending = true;
    try {
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: [
            'You are Prometheus in realtime voice mode.',
            'Review the freshest Live Worker context update already in this conversation.',
            'If the user benefits from a short progress update, speak one natural sentence grounded in that worker context.',
            'If the update is minor, duplicate, uncertain, or not useful, produce no spoken update.',
            'Speak only normal words and numbers. Never vocalize punctuation marks, symbols, emoji, markdown, bullets, dashes, or standalone characters.',
            'Do not steer, dispatch, or interrupt the Worker from this narration tick.',
            `Narration tick reason: ${String(reason || 'worker_context_tick')}`,
          ].join('\n'),
        },
      }));
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-narration-request-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  function _requestMobileRealtimeAgentFinalSummary(text) {
    const content = String(text || '').replace(/\s+/g, ' ').trim();
    const dc = __pmRealtimeAgent.conn?.dc;
    if (!content || !dc || dc.readyState !== 'open') return false;
    if (__pmRealtimeAgent.quiet.active) return false;
    __pmVoice.lastAi = content;
    __pmVoice.recentSpokenText = content.slice(0, 1200);
    const contentKey = `${content.length}:${content.slice(0, 160)}`;
    if (__pmRealtimeAgent.turn.finalSummaryPending || __pmRealtimeAgent.activeResponse || __pmVoice.realtimeSpeechActiveResponse || __pmVoice.speaking) {
      if (contentKey !== __pmRealtimeAgent.turn.finalSummaryContentKey) {
        __pmRealtimeAgent.turn.queuedFinalSummary = content;
        __pmRealtimeAgent.turn.queuedFinalSummaryKey = contentKey;
        __pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey = _mobileRealtimeAgentTranscriptKey();
        _voiceDebug('realtime-agent-final-summary-queued', {
          contentLen: content.length,
          activeResponse: !!__pmRealtimeAgent.activeResponse,
          speaking: !!__pmVoice.speaking,
          transcriptKey: __pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey || '',
        });
      }
      return true;
    }
    try {
      __pmRealtimeAgent.turn.suppressAssistantTranscript = true;
      __pmRealtimeAgent.turn.finalSummaryPending = true;
      __pmRealtimeAgent.turn.finalSummaryContentKey = contentKey;
      __pmRealtimeAgent.turn.queuedFinalSummary = '';
      __pmRealtimeAgent.turn.queuedFinalSummaryKey = '';
      __pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey = '';
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: [
              '[WORKER_FINAL_RESPONSE]',
              'The Prometheus worker has finished. Give the user one natural spoken wrap-up in your own realtime voice.',
              'Do not read this verbatim. Do not repeat the full worker answer. Do not preserve the worker wording or sentence order.',
              'Summarize the result, outcome, or next useful thing conversationally. Quote only tiny names, paths, or labels when needed.',
              'Keep it concise unless the result genuinely needs detail.',
              '',
              content.slice(0, 5000),
              '[/WORKER_FINAL_RESPONSE]',
            ].join('\n'),
          }],
        },
      }));
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: [
            'You are Prometheus in live realtime voice mode.',
            'Summarize the completed worker result for the user in your own words.',
            'Do not say you are reading or repeating a message.',
            'Do not duplicate the worker text verbatim, preserve its sentence order, or read whole sentences unchanged.',
            'Speak naturally and briefly.',
          ].join('\n'),
        },
      }));
      _markVoiceSpeakingStart(content.slice(0, 1200));
      _setOrbState('speaking');
      _setStatus('Speaking response', 'Realtime agent is summarizing the result');
      return true;
    } catch (err) {
      __pmRealtimeAgent.turn.suppressAssistantTranscript = false;
      __pmRealtimeAgent.turn.finalSummaryPending = false;
      __pmRealtimeAgent.turn.finalSummaryContentKey = '';
      _markVoiceSpeakingEnd();
      _voiceDebug('realtime-agent-final-summary-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  async function _refreshMobileRealtimeAgentWorkerContext(reason = 'manual_refresh', options = {}) {
    const sid = String(__pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!sid) return null;
    try {
      const packet = _overlayPendingMobileRealtimeAgentWorkerPacket(
        await _prefetchMobileVoiceWorkerContextPacket(sid, { source: `mobile_realtime_${reason}`, force: true }),
        sid,
        reason,
      );
      if (packet) {
        _sendMobileRealtimeAgentContextUpdate(packet, { reason });
        if (options.requestNarration === true) _requestMobileRealtimeAgentWorkerNarration(reason);
      }
      return packet;
    } catch (err) {
      _voiceDebug('realtime-agent-context-refresh-failed', { sessionId: sid, reason, message: err?.message || String(err) });
      return null;
    }
  }

  function _normalizeMobileRealtimeAgentMatchText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function _getPendingMobileRealtimeAgentWorkerDispatch(sessionId) {
    const pending = __pmRealtimeAgent.turn?.pendingWorkerDispatch;
    const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!pending || pending.sessionId !== sid) return null;
    if (Date.now() - Number(pending.startedAt || 0) > 30000) {
      __pmRealtimeAgent.turn.pendingWorkerDispatch = null;
      return null;
    }
    return pending;
  }

  function _makePendingMobileRealtimeAgentWorkerPacket(sessionId, reason = 'worker_dispatch_pending') {
    const pending = _getPendingMobileRealtimeAgentWorkerDispatch(sessionId);
    if (!pending) return null;
    const id = pending.contextPacketId || `mobile_realtime_pending_worker_${pending.startedAt}`;
    const target = _mobileVoiceTargetPayload();
    const isSubagent = target?.kind === 'subagent';
    const workerLabel = isSubagent ? `${target.label || 'the selected subagent'} subagent` : 'Prometheus worker';
    return {
      id,
      contextPacketId: id,
      createdAt: pending.startedAt,
      sessionId,
      active: true,
      summary: `The ${workerLabel} has just been dispatched and is starting up: ${pending.task}`,
      currentGoal: pending.task,
      currentPhase: 'starting',
      activeToolName: 'dispatch_prometheus_worker',
      activeToolLabel: `${isSubagent ? 'Subagent' : 'Worker'} dispatch is starting`,
      pendingSteerCount: 0,
      activeRun: null,
      trigger: {
        source: 'realtime_agent_dispatch',
        detail: pending.task,
        startedAt: pending.startedAt,
      },
      currentlyDoing: `Starting the ${workerLabel} for the realtime voice handoff.`,
      doneAlready: [`Realtime voice agent sent the task to the ${workerLabel}.`],
      observations: [`Pending ${isSubagent ? 'subagent' : 'worker'} context synthesized locally because the live runtime registry has not caught up yet. Reason: ${reason}.`],
      processEntries: [],
      recentEvents: [],
    };
  }

  function _overlayPendingMobileRealtimeAgentWorkerPacket(packet, sessionId, reason = 'worker_context') {
    if (packet?.active === true) {
      __pmRealtimeAgent.turn.pendingWorkerDispatch = null;
      return packet;
    }
    return _makePendingMobileRealtimeAgentWorkerPacket(sessionId, reason) || packet;
  }

  function _markMobileRealtimeAgentWorkerDispatch(sessionId, task) {
    const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    const cleanTask = String(task || '').trim();
    if (!sid || !cleanTask) return null;
    const startedAt = Date.now();
    __pmRealtimeAgent.turn.pendingWorkerDispatch = {
      sessionId: sid,
      task: cleanTask,
      startedAt,
      contextPacketId: `mobile_realtime_pending_worker_${startedAt}`,
    };
    const packet = _makePendingMobileRealtimeAgentWorkerPacket(sid, 'worker_dispatch');
    if (packet) _sendMobileRealtimeAgentContextUpdate(packet, { reason: 'worker_dispatch_pending' });
    return packet;
  }

  function _removeMobileRealtimeAgentChatTurn(sessionId, role, text) {
    const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    const target = _normalizeMobileRealtimeAgentMatchText(text);
    if (!sid || !target) return false;
    const thread = __pmChat.threads?.[sid];
    if (!Array.isArray(thread)) return false;
    const wantedRole = role === 'user' ? 'user' : 'ai';
    const now = Date.now();
    for (let i = thread.length - 1; i >= Math.max(0, thread.length - 12); i -= 1) {
      const msg = thread[i];
      if (!msg || msg.role !== wantedRole || msg.source !== 'voice_agent_realtime') continue;
      if (now - Number(msg.timestamp || now) > 120000) continue;
      const candidate = _normalizeMobileRealtimeAgentMatchText(msg.content || msg.body?.text || '');
      if (candidate && (candidate === target || candidate.includes(target) || target.includes(candidate))) {
        thread.splice(i, 1);
        if (wantedRole === 'user') __pmRealtimeAgent.turn.mobileUserTurn = null;
        if (wantedRole === 'ai') __pmRealtimeAgent.turn.mobileAssistantTurn = null;
        try { _persistMobileThreadSnapshot(sid); } catch {}
        try { _renderRecent(); } catch {}
        try { _renderMobileChatSessionNow(sid); } catch {}
        try { _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_duplicate_removed', force: true }); } catch {}
        return true;
      }
    }
    return false;
  }

  function _cancelMobileRealtimeAgentResponseForDispatch() {
    if (__pmRealtimeAgent.activeResponse) {
      try { __pmRealtimeAgent.conn?.dc?.send?.(JSON.stringify({ type: 'response.cancel' })); } catch {}
    } else {
      _voiceDebug('realtime-agent-cancel-skipped', { reason: 'no_active_response' });
    }
    _clearMobileRealtimeAgentOutputAudioIfStarted('dispatch');
    try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
    __pmRealtimeAgent.activeResponse = false;
    __pmRealtimeAgent.narrationPending = false;
    __pmRealtimeAgent.lastResponseEndedAt = Date.now();
    _restoreMobileRealtimeInputAfterOutput('response_cancelled_for_dispatch');
    __pmVoice.realtimeSpeechActiveResponse = '';
    __pmVoice.speaking = false;
  }

  function _clearMobileRealtimeAgentOutputAudioIfStarted(reason = 'manual') {
    const conn = __pmRealtimeAgent?.conn;
    if (!conn || conn.provider === 'xai') return false;
    const turn = __pmRealtimeAgent?.turn || {};
    const audioMs = (Number(turn.voiceRealtimeAudioMs || 0) || 0) + (Number(turn.voiceRealtimePendingAudioMs || 0) || 0);
    // Clearing before any audio has been delivered makes Realtime try to truncate
    // a zero-length assistant audio item, which it rejects. Cancelling the response
    // is enough in that case.
    if (audioMs < 80) {
      _voiceDebug('realtime-agent-output-clear-skipped', { reason, audioMs });
      return false;
    }
    try {
      conn.dc?.send?.(JSON.stringify({ type: 'output_audio_buffer.clear' }));
      return true;
    } catch {
      return false;
    }
  }

  function _mobileRealtimeAgentEffectiveSessionId(sessionId) {
    const target = _mobileVoiceTargetPayload();
    if (target?.kind === 'subagent' && target.agentId) {
      return String(target.sessionId || `subagent_chat_${target.agentId}`).trim();
    }
    return String(sessionId || __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  }

  function _startMobileRealtimeAgentContextRefreshLoop(conn) {
    if (__pmRealtimeAgent.contextRefreshTimer) clearInterval(__pmRealtimeAgent.contextRefreshTimer);
    const run = () => {
      if (!__pmRealtimeAgent.conn || __pmRealtimeAgent.conn !== conn) return;
      _refreshMobileRealtimeAgentWorkerContext('periodic_worker_context', { requestNarration: true }).catch(() => {});
    };
    __pmRealtimeAgent.contextRefreshTimer = setInterval(run, 5600);
    setTimeout(run, 1500);
  }

  function _stopMobileRealtimeAgentContextRefreshLoop() {
    if (__pmRealtimeAgent.contextRefreshTimer) {
      clearInterval(__pmRealtimeAgent.contextRefreshTimer);
      __pmRealtimeAgent.contextRefreshTimer = null;
    }
  }


  function _activateMobileRealtimeAgentQuietMode(options = {}) {
    if (!__pmRealtimeAgent.conn) return;
    const phrase = __pmRealtimeAgent.quiet.wakePhrase || _cleanMobileWakePhrase(__pmVoice?.settings?.wakePhrase || '');
    if (phrase) {
      _setMobileRealtimeAgentWakePhrase(phrase);
      _saveVoiceSettings({ wakePhrase: phrase, wakeGateActive: true });
    }
    __pmRealtimeAgent.quiet.active = true;
    __pmRealtimeAgent.quiet.pendingActivate = false;
    __pmRealtimeAgent.quiet.suppressResponse = false;
    if (__pmRealtimeAgent.activeResponse && options.skipCancel !== true) {
      try { __pmRealtimeAgent.conn?.dc?.send?.(JSON.stringify({ type: 'response.cancel' })); } catch {}
    } else if (__pmRealtimeAgent.activeResponse) {
      _voiceDebug('realtime-agent-cancel-skipped', { reason: 'quiet_mode_tool_call_active' });
    } else {
      _voiceDebug('realtime-agent-cancel-skipped', { reason: 'quiet_mode_no_active_response' });
    }
    _clearMobileRealtimeAgentOutputAudioIfStarted('quiet_mode');
    try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
    __pmRealtimeAgent.activeResponse = false;
    __pmVoice.realtimeSpeechActiveResponse = false;
    _restoreMobileRealtimeInputAfterOutput('quiet_mode_cancel');
    _sendMobileRealtimeAgentCreateResponseFlag(false);
    if (_isMobileCodexV3RealtimeConnection()) {
      const quietAudio = __pmRealtimeAgent.conn?.audio;
      if (quietAudio) {
        quietAudio.muted = true;
        quietAudio.volume = 0;
      }
      // AVAS v3 owns VAD and has no public create_response gate. Keep its mic
      // live for wake detection while suppressing audio, transcript UI, and
      // tools until the configured phrase is heard.
      _setMobileRealtimeAgentMicEnabled(true);
    }
    pmToast(phrase ? `Quiet mode — say "${phrase}" to wake` : 'Quiet mode on', 'info');
    _setMobileVoiceStatus('Quiet mode', phrase ? `Say "${phrase}" to wake Prometheus` : 'Silent until you wake Prometheus');
  }

  function _deactivateMobileRealtimeAgentQuietMode() {
    if (!__pmRealtimeAgent.quiet.active) return;
    __pmRealtimeAgent.quiet.active = false;
    __pmRealtimeAgent.quiet.pendingActivate = false;
    __pmRealtimeAgent.quiet.suppressResponse = false;
    _saveVoiceSettings({ wakeGateActive: false });
    _sendMobileRealtimeAgentCreateResponseFlag(true);
    if (_isMobileCodexV3RealtimeConnection()) {
      const quietAudio = __pmRealtimeAgent.conn?.audio;
      if (quietAudio) {
        quietAudio.muted = false;
        quietAudio.volume = 1;
        quietAudio.play?.().catch(() => {});
      }
      _setMobileRealtimeAgentMicEnabled(true);
    }
    if (typeof _setReadyVoiceState === 'function') _setReadyVoiceState();
  }

  function _handleMobileRealtimeAgentQuietTranscript(transcript) {
    if (!__pmRealtimeAgent.quiet.active) return false;
    const wake = __pmRealtimeAgent.quiet.wakeNormalized;
    if (!wake) return true;
    const heard = _normalizeMobileWakePhrase ? _normalizeMobileWakePhrase(transcript) : String(transcript || '').toLowerCase();
    if (!heard || !heard.includes(wake)) {
      __pmRealtimeAgent.quiet.suppressResponse = true;
      _sendMobileRealtimeAgentCreateResponseFlag(false);
      if (!_isMobileCodexV3RealtimeConnection()) _cancelMobileRealtimeAgentResponseForDispatch();
      return true; // not woken — suppress transcript display and keep the surface silen
    }
    _deactivateMobileRealtimeAgentQuietMode();
    pmToast('Awake', 'success');
    const dc = __pmRealtimeAgent.conn?.dc;
    if (dc?.readyState === 'open' && !_isMobileCodexV3RealtimeConnection()) {
      try { dc.send(JSON.stringify({ type: 'response.create' })); } catch {}
    }
    return false;
  }

  function _isMobileRealtimeAgentMode() {
    const mode = String(__pmVoice?.settings?.voiceMode || '').trim();
    if (mode === 'openai_realtime') return __pmVoice?.settings?.voiceAgentRealtimeAgent === true;
    if (mode === 'xai') return __pmVoice?.settings?.voiceAgentXaiRealtime === true;
    return false;
  }

  function _wantsMobileXaiRealtime() {
    return String(__pmVoice?.settings?.voiceMode || '').trim() === 'xai'
      && __pmVoice?.settings?.voiceAgentXaiRealtime === true;
  }

  function _mobileVoiceDeviceTimeContext() {
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const timezone = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
    })();
    const format = (options) => {
      try { return now.toLocaleString('en-US', options); } catch { return ''; }
    };
    return {
      source: 'device',
      capturedAt: Date.now(),
      localIso: now.toISOString(),
      timezone,
      utcOffsetMinutes: offsetMinutes,
      dateLabel: format({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeLabel: format({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    };
  }

  function _mobileVoiceTargetPayload() {
    const target = __pmVoice?.target || null;
    if (target?.kind === 'subagent') {
      const agentId = String(target.agentId || '').trim();
      const label = String(target.label || target.name || agentId || 'Subagent').trim();
      return {
        kind: 'subagent',
        agentId,
        label,
        sessionId: `subagent_chat_${agentId}`,
      };
    }
    return { kind: 'main', label: 'Prometheus' };
  }

  function _currentMobileSubagentVoiceTarget() {
    const target = _mobileVoiceTargetPayload();
    return target?.kind === 'subagent' && target.agentId ? target : null;
  }

  function _realtimeAgentDataChannelOpen() {
    return __pmRealtimeAgent?.conn?.dc?.readyState === 'open';
  }

  async function _persistSubagentVoiceLog(agentId, role, text, source = 'voice_agent_realtime') {
    const id = String(agentId || '').trim();
    const content = String(text || '').trim();
    if (!id || !content) return null;
    try {
      return await mobileGatewayFetch(`/api/agents/${encodeURIComponent(id)}/chat/voice-log`, {
        method: 'POST',
        body: JSON.stringify({
          role: role === 'user' ? 'user' : 'agent',
          content,
          source,
          realtime: true,
        }),
      });
    } catch (err) {
      _voiceDebug?.('subagent-voice-log-failed', { agentId: id, role, message: err?.message || String(err) });
      return null;
    }
  }

  function _mobileRealtimeAgentTranscriptKey(text = __pmRealtimeAgent?.turn?.lastUserTranscript || '') {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value ? `${value.length}:${value.slice(0, 160)}` : '';
  }

  function _clearMobileRealtimeAgentQueuedFinalSummary(reason = 'turn_changed') {
    const turn = __pmRealtimeAgent?.turn;
    if (!turn?.queuedFinalSummary && !turn?.queuedFinalSummaryKey && !turn?.queuedFinalSummaryTranscriptKey) return;
    _voiceDebug('realtime-agent-final-summary-cleared', {
      reason,
      contentLen: String(turn.queuedFinalSummary || '').length,
      queuedKey: turn.queuedFinalSummaryKey || '',
      queuedTranscriptKey: turn.queuedFinalSummaryTranscriptKey || '',
      currentTranscriptKey: _mobileRealtimeAgentTranscriptKey(),
    });
    turn.queuedFinalSummary = '';
    turn.queuedFinalSummaryKey = '';
    turn.queuedFinalSummaryTranscriptKey = '';
  }

  async function _persistRealtimeSubagentUserTranscript(target, text, source = 'voice_agent_realtime') {
    const agentId = String(target?.agentId || '').trim();
    const userText = String(text || '').trim();
    if (!agentId || !userText) return null;
    const userKey = `${agentId}:${userText.length}:${userText.slice(0, 120)}`;
    if (__pmRealtimeAgent.turn.subagentVoiceUserLogKey === userKey) return null;
    __pmRealtimeAgent.turn.subagentVoiceUserLogKey = userKey;
    return _persistSubagentVoiceLog(agentId, 'user', userText, source);
  }

  async function _persistRealtimeSubagentDirectReply(target, assistantText) {
    const agentId = String(target?.agentId || '').trim();
    const userText = String(__pmRealtimeAgent?.turn?.lastUserTranscript || '').trim();
    const reply = String(assistantText || '').trim();
    if (!agentId || !reply) return;
    await _persistRealtimeSubagentUserTranscript(target, userText, 'voice_agent_realtime');
    const replyKey = `${agentId}:${reply.length}:${reply.slice(0, 120)}`;
    if (__pmRealtimeAgent.turn.subagentVoiceReplyLogKey !== replyKey) {
      __pmRealtimeAgent.turn.subagentVoiceReplyLogKey = replyKey;
      await _persistSubagentVoiceLog(agentId, 'agent', reply, 'voice_agent_realtime');
    }
  }


  function _installMobileCodexV3RealtimeCommandGuard(dc) {
    if (!dc || dc.__prometheusCodexV3Guard) return;
    const nativeSend = dc.send.bind(dc);
    // AVAS v3 uses app-server-specific data-channel events. Browser-public
    // Realtime commands are invalid here; voice/prompt/client-managed Prometheus
    // handoffs came from the thread/realtime/start request that established this
    // WebRTC call.
    const publicRealtimeCommands = /^(?:conversation\.item\.create|response\..+|input_audio_buffer\..+|output_audio_buffer\..+|session\.update)$/;
    dc.send = (payload) => {
      let event = null;
      try { event = typeof payload === 'string' ? JSON.parse(payload) : null; } catch {}
      if (event && publicRealtimeCommands.test(String(event.type || ''))) {
        _voiceDebug('codex-v3-public-command-skipped', { type: event.type });
        return;
      }
      return nativeSend(payload);
    };
    dc.__prometheusCodexV3Guard = true;
  }

  async function _startMobileCodexVoiceRoomStandbyConnection(participant = {}) {
    const key = _voiceRoomParticipantKey(participant);
    const sid = _mobileVoiceRoomParticipantSessionId(participant);
    if (!key || !sid) throw new Error('Voice Room standby target has no durable session.');
    const pending = __pmRealtimeAgent.roomWarmPromises instanceof Map
      ? __pmRealtimeAgent.roomWarmPromises
      : (__pmRealtimeAgent.roomWarmPromises = new Map());
    if (pending.has(key)) return pending.get(key);

    const startPromise = (async () => {
      let resolvedParticipant = participant;
      if (String(participant?.kind || '') === 'subagent' && !participant?.voice) {
        const detail = await loadMobileSubagentDetail(String(participant.agentId || participant.id || '')).catch(() => null);
        if (detail) resolvedParticipant = _voiceSubagentRoomParticipant(detail) || participant;
      }
      const target = String(resolvedParticipant?.kind || '') === 'subagent'
        ? {
            kind: 'subagent',
            agentId: String(resolvedParticipant.agentId || resolvedParticipant.id || '').trim(),
            label: _voiceRoomParticipantLabel(resolvedParticipant),
            sessionId: sid,
          }
        : { kind: 'main', label: 'Prometheus' };
      const baseSettings = _loadVoiceSettings();
      const voiceOverrides = String(resolvedParticipant?.kind || '') === 'subagent'
        ? (_mobileVoiceSettingsFromAgentProfile(resolvedParticipant.voice || {}) || {})
        : {};
      const settings = { ...baseSettings, ...voiceOverrides };
      const contextResult = await mobileGatewayFetch('/api/voice-agent/realtime-context', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          source: 'mobile_voice_room_standby',
          voiceMode: String(settings.voiceMode || 'openai_realtime'),
          voiceTarget: target,
          voiceRoomContext: _mobileVoiceRoomContextPayload(),
        }),
      }).catch(() => null);
      const realtimeStatus = await mobileGatewayFetch('/api/realtime/status', { method: 'GET' }).catch(() => ({}));
      const useCodexOauthBridge = realtimeStatus?.codexBridgeAvailable === true
        && realtimeStatus?.transport === 'codex_app_server'
        && realtimeStatus?.auth === 'chatgpt_oauth_app_server';
      if (!useCodexOauthBridge) throw new Error('Codex Voice/Live standby requires the ChatGPT OAuth bridge.');
      const selectedVoice = _mobileRealtimeVoice(settings.realtimeVoice, { realtime: realtimeStatus || {} });
      const wakePhrase = _cleanMobileWakePhrase(settings.wakePhrase || '');
      const bootstrap = await mobileGatewayFetch('/api/voice-agent/realtime-bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          voiceTarget: target,
          voice: selectedVoice,
          speed: Number(settings.realtimeSpeed || 1.05),
          voiceRuntime: wakePhrase
            ? { wakePhrase, wakeGateActive: settings.wakeGateActive === true }
            : undefined,
          cameraRuntime: _mobileRealtimeCameraRuntimePayload(),
          deviceTime: _mobileVoiceDeviceTimeContext(),
          contextOnly: true,
          voiceRoomContext: _mobileVoiceRoomContextPayload(),
          ...(contextResult?.contextPacket ? { contextPacket: contextResult.contextPacket } : {}),
        }),
      });
      if (!bootstrap?.success) throw new Error(bootstrap?.error || 'Voice Room standby bootstrap failed.');

      const pc = new RTCPeerConnection();
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = true;
      audio.style.display = 'none';
      audio.dataset.voiceRoomStandby = 'true';
      document.body.appendChild(audio);

      const micStream = await _ensureMobileXaiRealtimeMic();
      const sourceTrack = micStream.getAudioTracks()[0];
      if (!sourceTrack) throw new Error('Voice Room standby could not access the shared microphone.');
      const micTrack = sourceTrack.clone();
      micTrack.enabled = false;
      const standbyStream = new MediaStream([micTrack]);
      const micSender = pc.addTrack(micTrack, standbyStream);
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}

      let conn = null;
      pc.ontrack = (event) => {
        try {
          _tuneMobileRealtimeAudioReceiver(event.receiver);
          audio.srcObject = event.streams[0] || new MediaStream([event.track]);
          audio.muted = true;
          audio.play?.().catch?.(() => {});
        } catch {}
      };
      const dc = pc.createDataChannel('oai-events');
      dc.addEventListener('message', (msgEvent) => {
        if (!conn?.roomActive || __pmRealtimeAgent?.conn !== conn) return;
        let event = null;
        try { event = JSON.parse(msgEvent.data); } catch { return; }
        _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
      });
      const dcOpen = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Voice Room standby data channel did not open.')), 12_000);
        dc.addEventListener('open', () => {
          clearTimeout(timeout);
          resolve(true);
        }, { once: true });
        dc.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Voice Room standby data channel failed.'));
        }, { once: true });
      });

      let bridgeSessionId = '';
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerSdpRaw = await _waitForLocalRealtimeOfferSdp(pc);
        const offerSdp = _realtimeSdpPostBody(offerSdpRaw || offer?.sdp || '');
        if (!_isUsableRealtimeOfferSdp(offerSdp)) throw new Error('Voice Room standby generated an invalid SDP offer.');
        const bridgeResult = await mobileGatewayFetch('/api/realtime/codex-bridge/call', {
          method: 'POST',
          body: JSON.stringify({
            sdp: offerSdp,
            ownerSessionId: sid,
            voice: bootstrap.voice,
            instructions: _mobileVoiceRoomCodexInstructions(bootstrap.instructions, key),
            tools: Array.isArray(bootstrap.tools) ? bootstrap.tools : [],
          }),
        });
        if (!bridgeResult?.success) throw new Error(bridgeResult?.error || 'Voice Room standby bridge failed.');
        bridgeSessionId = String(bridgeResult.sessionId || '').trim();
        const bridgeRealtimeSessionId = String(bridgeResult.realtimeSessionId || '').trim();
        const bridgeRealtimeReady = bridgeResult.realtimeReady === true || !!bridgeRealtimeSessionId;
        let answerSdp = String(bridgeResult.sdp || '');
        answerSdp = `${answerSdp.replace(/\r\n|\r|\n/g, '\n').replace(/\s+$/g, '').replace(/\n/g, '\r\n')}\r\n`;
        if (!_isUsableRealtimeOfferSdp(answerSdp)) throw new Error('Voice Room standby returned an invalid SDP answer.');
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        (pc.getReceivers?.() || []).forEach?.(_tuneMobileRealtimeAudioReceiver);
        await dcOpen;
        _installMobileCodexV3RealtimeCommandGuard(dc);
        conn = {
          pc,
          dc,
          audio,
          micStream: standbyStream,
          micTrack,
          roomMicClone: micTrack,
          roomMicSender: micSender,
          sessionId: sid,
          listenMode: 'always_listening',
          sharedMic: false,
          provider: 'openai_realtime',
          transport: 'codex_app_server',
          auth: 'chatgpt_oauth_app_server',
          codexBridgeSessionId: bridgeSessionId,
          realtimeSessionId: bridgeRealtimeSessionId,
          backendReady: bridgeRealtimeReady,
          backendReadyNotified: false,
          roomParticipantKey: key,
          roomActive: false,
        };
        pc.addEventListener('connectionstatechange', () => {
          if (!['closed', 'failed', 'disconnected'].includes(pc.connectionState)) return;
          const pool = _mobileVoiceRoomWarmPool();
          if (pool.get(key) === conn) {
            pool.delete(key);
            _closeMobileCodexVoiceRoomConnection(conn, `standby_${pc.connectionState}`);
          }
        });
        return conn;
      } catch (err) {
        try { dc.close(); } catch {}
        try { pc.close(); } catch {}
        try { micTrack.stop(); } catch {}
        try { audio.remove(); } catch {}
        if (bridgeSessionId) {
          mobileGatewayFetch('/api/realtime/codex-bridge/stop', {
            method: 'POST',
            body: JSON.stringify({ sessionId: bridgeSessionId }),
          }).catch(() => {});
        }
        throw err;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, startPromise);
    return startPromise;
  }

  async function _startMobileRealtimeAgentSession(sessionId, options = {}) {
    const requestedSessionId = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    const currentConnectionIsOpen = __pmRealtimeAgent?.conn?.dc?.readyState === 'open'
      && (!requestedSessionId
        || requestedSessionId === MOBILE_CHAT_SESSION_ID
        || String(__pmRealtimeAgent.conn.sessionId || '').trim() === requestedSessionId);
    if (!currentConnectionIsOpen) _notifyMobileVoiceAgentConnection('starting', { sessionId: requestedSessionId });
    if (_wantsMobileXaiRealtime()) return _startMobileXaiRealtimeSession(sessionId, options);
    let sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (sid === MOBILE_CHAT_SESSION_ID) {
      sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'realtime_agent_bootstrap' });
    }
    const listenMode = String(options.listenMode || 'push_to_talk').trim();
    if (
      __pmRealtimeAgent.conn?.dc?.readyState === 'open'
      && String(__pmRealtimeAgent.conn.sessionId || '').trim() === sid
    ) {
      __pmRealtimeAgent.conn.listenMode = listenMode;
      __pmRealtimeAgent.listenMode = listenMode;
      _sendMobileRealtimeAgentSessionUpdateFromSettings('realtime_agent_reuse');
      if (listenMode === 'always_listening') _setMobileRealtimeAgentMicEnabled(true);
      _notifyMobileVoiceAgentConnection(
        __pmRealtimeAgent.conn.backendReady === true ? 'connected' : 'starting',
        { sessionId: sid, reused: true },
      );
      _voiceDebug('realtime-agent-reuse', {
        sessionId: sid,
        listenMode,
        dcState: __pmRealtimeAgent.conn.dc?.readyState || '',
        pcState: __pmRealtimeAgent.conn.pc?.connectionState || '',
        iceState: __pmRealtimeAgent.conn.pc?.iceConnectionState || '',
        micEnabled: __pmRealtimeAgent.conn.micTrack?.enabled === true,
        micTrackState: __pmRealtimeAgent.conn.micTrack?.readyState || '',
      });
      return __pmRealtimeAgent.conn;
    }
    if (__pmRealtimeAgent.conn && String(__pmRealtimeAgent.conn.sessionId || '').trim() !== sid) {
      _mobileRealtimeAgentDisableAlwaysListening();
    }
    if (__pmRealtimeAgent.connecting) {
      const pendingSid = String(__pmRealtimeAgent.connectingSessionId || '').trim();
      if (!pendingSid || pendingSid === sid) return __pmRealtimeAgent.connecting;
      _stopMobileRealtimeAgentSession();
    }
    __pmRealtimeAgent.listenMode = listenMode;
    const startId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    __pmRealtimeAgent.connectingSessionId = sid;
    __pmRealtimeAgent.connectingStartId = startId;

    __pmRealtimeAgent.connecting = (async () => {
      _voiceDebug('realtime-agent-bootstrap-start', { sessionId: sid, listenMode });
      const quietState = _syncMobileRealtimeAgentQuietFromSettings();
      const wakePhrase = quietState.wakePhrase;
      const [workerContextPacket, prewarmedRealtimeStatus] = await Promise.all([
        _prefetchMobileVoiceWorkerContextPacket(sid, { source: 'mobile_realtime_bootstrap' }),
        _prewarmMobileCodexRealtimeBridge(),
      ]);
      // A failed prewarm resolves to null. Fetch once more rather than silently
      // falling back to public Realtime with a voice selected for AVAS v3.
      const realtimeStatus = prewarmedRealtimeStatus
        || await mobileGatewayFetch('/api/realtime/status', { method: 'GET' }).catch(() => ({}));
      const useCodexOauthBridge = realtimeStatus?.codexBridgeAvailable === true
        && realtimeStatus?.transport === 'codex_app_server'
        && realtimeStatus?.auth === 'chatgpt_oauth_app_server';
      // The bridge endpoint itself owns protocol selection and currently starts
      // AVAS v3. Do not make mobile reject an otherwise healthy bridge because
      // a cached/older status payload omitted the informational version field.
      // Desktop already uses these three authoritative transport fields.
      const targetVoiceProfile = __pmVoice?.target?.kind === 'subagent'
        ? (__pmVoice.target.voice || {})
        : {};
      const targetRequiresCodexOauthBridge =
        String(targetVoiceProfile?.provider || '').trim() === 'openai_codex'
        || String(targetVoiceProfile?.mode || '').trim() === 'codex_voice_live';
      const requiresCodexOauthBridge = targetRequiresCodexOauthBridge
        || realtimeStatus?.authMode === 'codex_oauth'
        || (realtimeStatus?.oauthConfigured === true && realtimeStatus?.apiKeyConfigured !== true);
      if (requiresCodexOauthBridge && !useCodexOauthBridge) {
        throw new Error(
          realtimeStatus?.codexBridgeError
          || 'Codex Voice/Live requires the ChatGPT OAuth app-server bridge; public Realtime v2 fallback is disabled.',
        );
      }
      // Select from the voice family of the transport this exact attempt will
      // use. Merely advertising an available Codex bridge is not enough: if the
      // attempt falls back to public v2, an AVAS-only voice such as `spruce`
      // would otherwise be rejected by the public Realtime session.
      const selectedVoiceStatus = useCodexOauthBridge
        ? { realtime: realtimeStatus || {} }
        : { realtime: {} };
      const selectedRealtimeVoice = _mobileRealtimeVoice(
        __pmVoice?.settings?.realtimeVoice,
        selectedVoiceStatus,
      );
      _voiceDebug('realtime-agent-transport-voice-selected', {
        transport: useCodexOauthBridge ? 'codex_app_server' : 'openai_public_realtime',
        voice: selectedRealtimeVoice,
        requestedVoice: String(__pmVoice?.settings?.realtimeVoice || ''),
      });
      const bootstrap = await mobileGatewayFetch('/api/voice-agent/realtime-bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          voiceTarget: _mobileVoiceTargetPayload(),
          voice: selectedRealtimeVoice,
          speed: Number(__pmVoice?.settings?.realtimeSpeed || 1.05),
          voiceRuntime: wakePhrase
            ? { wakePhrase, wakeGateActive: __pmVoice?.settings?.wakeGateActive === true }
            : undefined,
          cameraRuntime: _mobileRealtimeCameraRuntimePayload(),
          deviceTime: _mobileVoiceDeviceTimeContext(),
          contextOnly: useCodexOauthBridge,
          voiceRoomContext: _mobileVoiceRoomContextPayload(),
          ...(workerContextPacket ? { contextPacket: workerContextPacket } : {}),
        }),
      });
      if (!bootstrap?.success) throw new Error(bootstrap?.error || 'Voice agent realtime bootstrap failed');
      _voiceDebug('realtime-agent-bootstrap-ready', {
        sessionId: sid,
        listenMode,
        model: bootstrap.model,
        auth: bootstrap.auth,
        variant: bootstrap.variant,
        toolCount: bootstrap.toolCount,
      });

      const pc = new RTCPeerConnection();
      let audio = document.getElementById('pm-voice-agent-realtime-audio');
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'pm-voice-agent-realtime-audio';
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      pc.ontrack = (event) => {
        if (__pmRealtimeAgent?.roomHandoff?.previousPc === pc) return;
        if (__pmRealtimeAgent?.conn && __pmRealtimeAgent.conn.pc !== pc) return;
        _voiceDebug('realtime-agent-remote-track', {
          sessionId: sid,
          kind: event.track?.kind || '',
          streamCount: event.streams?.length || 0,
          trackState: event.track?.readyState || '',
        });
        // AVAS output is already a decoded WebRTC MediaStream. Routing i
        // through a second AudioContext stream can go silent on iOS after a
        // session handoff, so keep the Codex bridge on the direct-output path.
        _tuneMobileRealtimeAudioReceiver(event.receiver);
        _attachMobileRealtimeOutput(audio, event.streams[0], { direct: useCodexOauthBridge, receiver: event.receiver });
      };

      // Reuse the shared warm mic — the SAME stream xAI realtime + the soundwave
      // visualizer use. iOS Safari starves a SECOND concurrent getUserMedia capture
      // (a fresh getUserMedia here gave OpenAI a live-but-silent track), which is why
      // soundwaves animate but VAD/transcription got nothing. xAI works because i
      // shares this mic via _ensureMobileXaiRealtimeMic().
      const micStream = await _ensureMobileXaiRealtimeMic();
      const micTrack = micStream.getAudioTracks()[0];
      // The WebRTC transport can open before the realtime backend has accepted
      // the session. Hold the track until the backend readiness acknowledgemen
      // so the first spoken turn cannot disappear into startup.
      micTrack.enabled = false;
      _voiceDebug('realtime-agent-mic-ready', {
        sessionId: sid,
        listenMode,
        micEnabled: micTrack.enabled,
        micTrackState: micTrack.readyState,
        label: micTrack.label || '',
        settings: micTrack.getSettings?.() || {},
      });
      pc.addTrack(micTrack, micStream);
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}

      const dc = pc.createDataChannel('oai-events');
      let realtimeBackendReady = false;
      const markRealtimeBackendReady = (detail = {}) => {
        realtimeBackendReady = true;
        const active = __pmRealtimeAgent?.conn;
        if (active?.pc === pc) _markMobileRealtimeAgentBackendReady(active, detail);
      };
      dc.addEventListener('message', (msgEvent) => {
        // Ignore buffered messages from a room participant that has already
        // been superseded by another AVAS connection.
        if (__pmRealtimeAgent?.roomHandoff?.previousDc === dc) return;
        if (__pmRealtimeAgent?.conn && __pmRealtimeAgent.conn.dc !== dc) return;
        let event = null;
        try { event = JSON.parse(msgEvent.data); } catch { return; }
        if (!useCodexOauthBridge && String(event?.type || '') === 'session.updated') {
          markRealtimeBackendReady({ source: 'session.updated' });
        }
        _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
      });

      const dcOpen = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Realtime data channel did not open.')), 12000);
        dc.addEventListener('open', () => {
          clearTimeout(timeout);
          _voiceDebug('realtime-agent-dc-open', { sessionId: sid, listenMode, readyState: dc.readyState });
          resolve(true);
        }, { once: true });
        dc.addEventListener('error', () => {
          clearTimeout(timeout);
          _voiceDebug('realtime-agent-dc-error', { sessionId: sid, listenMode, readyState: dc.readyState });
          reject(new Error('Realtime data channel failed.'));
        }, { once: true });
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const offerSdpRaw = await _waitForLocalRealtimeOfferSdp(pc);
      const offerSdp = _realtimeSdpPostBody(offerSdpRaw || offer?.sdp || '');
      if (!_isUsableRealtimeOfferSdp(offerSdp)) {
        throw new Error(`Realtime agent SDP offer was invalid before OpenAI exchange (${offerSdp.length} bytes, local=${String(offerSdpRaw || '').length}, offer=${String(offer?.sdp || '').length}, ice=${pc.iceGatheringState}).`);
      }
      _voiceDebug('realtime-agent-offer-ready', {
        sessionId: sid,
        listenMode,
        sdpLength: offerSdp.length,
        hasAudio: /\r?\nm=audio\s/i.test(offerSdp),
        iceGatheringState: pc.iceGatheringState,
        micTrackState: micTrack.readyState,
        micEnabled: micTrack.enabled,
      });
      let answerSdp = '';
      let codexBridgeSessionId = '';
      let codexRealtimeSessionId = '';
      let codexBridgeRealtimeReady = false;
      const model = String(bootstrap.model || 'gpt-realtime-2' || 'gpt-realtime-2').trim();
      const clientSecret = String(bootstrap.clientSecret || '').trim();
      if (useCodexOauthBridge) {
        const bridgeResult = await mobileGatewayFetch('/api/realtime/codex-bridge/call', {
          method: 'POST',
          body: JSON.stringify({
            sdp: offerSdp,
            ownerSessionId: sid,
            voice: bootstrap.voice,
            instructions: _mobileVoiceRoomCodexInstructions(bootstrap.instructions, _voiceRoomCurrentTargetKey()),
            tools: Array.isArray(bootstrap.tools) ? bootstrap.tools : [],
          }),
        });
        if (!bridgeResult?.success) throw new Error(bridgeResult?.error || 'Codex OAuth realtime bridge failed');
        answerSdp = String(bridgeResult.sdp || '');
        codexBridgeSessionId = String(bridgeResult.sessionId || '');
        codexRealtimeSessionId = String(bridgeResult.realtimeSessionId || '').trim();
        codexBridgeRealtimeReady = bridgeResult.realtimeReady === true || !!codexRealtimeSessionId;
        if (!_isUsableRealtimeOfferSdp(answerSdp)) {
          throw new Error('Codex OAuth realtime v3 bridge returned an invalid SDP answer.');
        }
      } else {
        if (clientSecret) {
          try {
            const directResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${clientSecret}`,
                'Content-Type': 'application/sdp',
              },
              body: offerSdp,
            });
            answerSdp = await directResponse.text();
            if (!directResponse.ok) {
              _voiceDebug('realtime-agent-direct-call-failed', {
                sessionId: sid,
                status: directResponse.status,
                model,
                error: String(answerSdp || '').slice(0, 500),
                sdpLength: offerSdp.length,
              });
              answerSdp = '';
            }
          } catch (err) {
            _voiceDebug('realtime-agent-direct-call-failed', {
              sessionId: sid,
              status: 0,
              model,
              error: err?.message || String(err),
              sdpLength: offerSdp.length,
            });
          }
        }
        if (!answerSdp) {
          try {
            answerSdp = await mobileGatewayTextFetch('/api/voice-agent/realtime-call', {
              method: 'POST',
              body: JSON.stringify({
                callToken: bootstrap.callToken,
                sdp: offerSdp,
              }),
            });
          } catch (err) {
            _voiceDebug('realtime-agent-gateway-call-failed', {
              sessionId: sid,
              model,
              error: err?.message || String(err),
              sdpLength: offerSdp.length,
            });
            try { pc.close(); } catch {}
            try { if (audio) audio.srcObject = null; } catch {}
            try { micStream.getTracks?.().forEach((track) => track.stop()); } catch {}
            return _startMobileOpenAiRealtimeWebSocketSession(sid, { listenMode, bootstrap });
          }
        }
      }
      answerSdp = `${String(answerSdp || '').replace(/\r\n|\r|\n/g, '\n').replace(/\s+$/g, '').replace(/\n/g, '\r\n')}\r\n`;
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      (pc.getReceivers?.() || []).forEach?.(_tuneMobileRealtimeAudioReceiver);
      await dcOpen;
      if (useCodexOauthBridge) _installMobileCodexV3RealtimeCommandGuard(dc);

      if (useCodexOauthBridge) {
        // AVAS v3 receives voice, prompt, tools, and server-VAD policy in
        // thread/realtime/start. Public Realtime commands are invalid on this
        // channel; PTT below controls only the microphone track.
        _voiceDebug('codex-v3-session-native-turn-control', { sessionId: sid, listenMode });
      } else {
        // The public Realtime fallback supports the browser event protocol, so
        // it still needs per-mode configuration and chat-history injection.
        try {
          dc.send(JSON.stringify({
            type: 'session.update',
            session: {
              type: 'realtime',
              audio: {
                input: {
                  turn_detection: _mobileRealtimeTurnDetectionForListenMode(listenMode),
                  transcription: { model: 'gpt-realtime-whisper' },
                },
                output: {
                  voice: selectedRealtimeVoice,
                  speed: Number(__pmVoice?.settings?.realtimeSpeed || 1.05),
                },
              },
            },
          }));
          _voiceDebug('realtime-agent-session-update', { sessionId: sid, listenMode, quietActive: __pmRealtimeAgent.quiet.active });
        } catch (err) {
          _voiceDebug('realtime-agent-session-update-failed', { message: err?.message || String(err) });
        }

        // Seed the live public-Realtime session with the chat thread the user
        // just had on screen so the voice agent continues the conversation.
        _seedMobileRealtimeAgentConversationHistory(dc, sid);
      }

      if (__pmRealtimeAgent.connectingStartId !== startId) {
        try { dc?.close(); } catch {}
        try { pc?.close(); } catch {}
        try { if (audio) audio.srcObject = null; } catch {}
        if (codexBridgeSessionId) {
          mobileGatewayFetch('/api/realtime/codex-bridge/stop', {
            method: 'POST',
            body: JSON.stringify({ sessionId: codexBridgeSessionId }),
          }).catch(() => {});
        }
        const successor = __pmRealtimeAgent.connecting;
        if (successor) {
          _voiceDebug('realtime-agent-bootstrap-joined-successor', { sessionId: sid, listenMode });
          return await successor;
        }
        if (__pmRealtimeAgent.conn) return __pmRealtimeAgent.conn;
        throw _mobileRealtimeBootstrapSupersededError('Realtime agent');
      }
      __pmRealtimeAgent.conn = {
        pc,
        dc,
        audio,
        micStream,
        micTrack,
        sessionId: sid,
        listenMode,
        sharedMic: true,
        provider: 'openai_realtime',
        baseInstructions: String(bootstrap.instructions || '').trim(),
        transport: useCodexOauthBridge ? 'codex_app_server' : 'openai_public_realtime',
        auth: useCodexOauthBridge ? 'chatgpt_oauth_app_server' : (bootstrap.auth || 'api_key'),
        codexBridgeSessionId,
        realtimeSessionId: codexRealtimeSessionId,
        backendReady: useCodexOauthBridge ? codexBridgeRealtimeReady : realtimeBackendReady,
        backendReadyNotified: false,
      };
      _startMobileRealtimeAudioQualityMonitor(__pmRealtimeAgent.conn);
      _startMobileCodexBridgeRealtimeEventPoll(__pmRealtimeAgent.conn);
      if (!useCodexOauthBridge && realtimeBackendReady) {
        _markMobileRealtimeAgentBackendReady(__pmRealtimeAgent.conn, { source: 'session.updated' });
      }
      if (__pmRealtimeAgent.quiet.active) _activateMobileRealtimeAgentQuietMode({ skipCancel: true });
      _sendMobileRealtimeCameraRuntimeUpdate('realtime_session_ready');
      const logState = (reason) => _voiceDebug('realtime-agent-pc-state', {
        sessionId: sid,
        listenMode,
        reason,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
        dcState: dc.readyState,
        micEnabled: micTrack.enabled,
        micTrackState: micTrack.readyState,
      });
      pc.addEventListener('connectionstatechange', () => logState('connectionstatechange'));
      pc.addEventListener('iceconnectionstatechange', () => logState('iceconnectionstatechange'));
      pc.addEventListener('signalingstatechange', () => logState('signalingstatechange'));
      let transientDisconnectTimer = null;
      const clearTransientDisconnectTimer = () => {
        if (transientDisconnectTimer) clearTimeout(transientDisconnectTimer);
        transientDisconnectTimer = null;
      };
      pc.addEventListener('connectionstatechange', () => {
        if (__pmRealtimeAgent.conn?.pc !== pc) {
          clearTransientDisconnectTimer();
          return;
        }
        const state = pc.connectionState;
        if (state === 'connected') {
          clearTransientDisconnectTimer();
          return;
        }
        if (state === 'disconnected') {
          if (!transientDisconnectTimer) {
            transientDisconnectTimer = setTimeout(() => {
              transientDisconnectTimer = null;
              if (__pmRealtimeAgent.conn?.pc !== pc || pc.connectionState !== 'disconnected') return;
              _notifyMobileVoiceAgentConnection('reconnecting', { sessionId: sid, reason: 'rtc_disconnected_timeout' });
              _stopMobileRealtimeAgentSession();
            }, 5000);
          }
          return;
        }
        if (state === 'closed' || state === 'failed') {
          clearTransientDisconnectTimer();
          _notifyMobileVoiceAgentConnection('reconnecting', { sessionId: sid, reason: state });
          _stopMobileRealtimeAgentSession();
        }
      });
      logState('ready');
      _voiceDebug('realtime-agent-transport-ready', {
        sessionId: sid,
        listenMode,
        backendReady: __pmRealtimeAgent.conn.backendReady === true,
        transport: __pmRealtimeAgent.conn.transport,
      });
      if (__pmRealtimeAgent.conn.backendReady === true) {
        _markMobileRealtimeAgentBackendReady(__pmRealtimeAgent.conn, {
          source: useCodexOauthBridge ? 'bridge_session_result' : 'session.updated',
        });
      }
      if (_isVoiceRoomEnabled() && useCodexOauthBridge) {
        _scheduleMobileCodexVoiceRoomPrewarm('active_session_ready');
      }
      return __pmRealtimeAgent.conn;
    })().catch((error) => {
      _notifyMobileVoiceAgentConnection('error', { sessionId: sid, message: error?.message || String(error) });
      throw error;
    }).finally(() => {
      if (__pmRealtimeAgent.connectingStartId === startId) {
        __pmRealtimeAgent.connecting = null;
        __pmRealtimeAgent.connectingSessionId = '';
        __pmRealtimeAgent.connectingStartId = '';
      }
    });
    return __pmRealtimeAgent.connecting;
  }

  function _stopMobileRealtimeAgentSession(options = {}) {
    const conn = __pmRealtimeAgent.conn;
    if (options.preserveRoomPool !== true) _clearMobileCodexVoiceRoomWarmPool('realtime_session_stopped');
    _stopMobileRealtimeAudioQualityMonitor();
    _stopMobileCodexBridgeRealtimeEventPoll();
    // Preserve an open camera stream across reconnects, but invalidate the old
    // frame generation and timer. The next backend-ready callback starts a
    // fresh camera turn against the new data channel.
    _stopMobileRealtimeLiveCameraVision('realtime_session_stopped');
    __pmRealtimeAgent.conn = null;
    __pmRealtimeAgent.connecting = null;
    __pmRealtimeAgent.connectingSessionId = '';
    __pmRealtimeAgent.connectingStartId = '';
    __pmRealtimeAgent.listenMode = 'idle';
    __pmRealtimeAgent.ptt = {
      held: false,
      sessionId: '',
      pressId: (__pmRealtimeAgent.ptt?.pressId || 0) + 1,
      pressedAt: 0,
    };
    __pmRealtimeAgent.pendingImages = [];
    __pmRealtimeAgent.pendingFiles = [];
    __pmRealtimeAgent.stagedImageTurn = null;
    __pmRealtimeAgent.stagedAttachmentTurn = null;
    __pmRealtimeAgent.functionCallBuffers.clear();
    if (__pmRealtimeAgent.turn?.voiceLyricTimer) {
      clearInterval(__pmRealtimeAgent.turn.voiceLyricTimer);
      __pmRealtimeAgent.turn.voiceLyricTimer = null;
    }
    _clearMobileRealtimeAgentPendingCreateResponse();
    _stopMobileRealtimeAgentContextRefreshLoop();
    try { conn?.cleanup?.(); } catch {}
    // AVAS can have a decoded frame queued in the media element.  Silence i
    // before closing so an old room participant cannot speak over the handoff.
    try { if (conn?.audio) conn.audio.muted = true; } catch {}
    if (conn?.codexBridgeSessionId) {
      mobileGatewayFetch('/api/realtime/codex-bridge/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: conn.codexBridgeSessionId }),
      }).catch(() => {});
    }
    try { conn?.dc?.close(); } catch {}
    try { conn?.pc?.close(); } catch {}
    try { if (conn?.audio) conn.audio.srcObject = null; } catch {}
    try { clearTimeout(__pmRealtimeAgent.outputGuard?.restoreTimer); } catch {}
    __pmRealtimeAgent.outputGuard = { suspended: false, restoreSending: null, restoreTrackEnabled: null, until: 0, restoreTimer: null };
    // Shared warm mic (sharedMic) must stay live for the visualizer / xAI / other
    // providers — just re-enable its track. Only fully stop a mic we exclusively own.
    try {
      if (conn?.sharedMic) { if (conn?.micTrack) conn.micTrack.enabled = true; }
      else { conn?.micStream?.getTracks().forEach((t) => t.stop()); }
    } catch {}
  }

  function _setMobileRealtimeAgentMicEnabled(enabled) {
    const conn = __pmRealtimeAgent.conn;
    if ((conn?.provider === 'xai' || conn?.provider === 'openai_ws') && conn?.xaiCapture) {
      const wasSending = conn.xaiCapture.sending === true;
      if (enabled && !wasSending) {
        conn.xaiCapture.appends = 0;
        conn.xaiCapture.nonSilent = 0;
        conn.xaiCapture.peakMax = 0;
        if (Array.isArray(conn.xaiCapture.pending)) conn.xaiCapture.pending.length = 0;
        __pmRealtimeAgent.turn.mobileUserTurn = null;
        __pmRealtimeAgent.turn.lastUserTranscript = '';
        __pmRealtimeAgent.turn.liveUserTranscript = '';
        __pmRealtimeAgent.turn.currentUserTranscriptItemId = '';
        __pmRealtimeAgent.turn.currentUserSpeechStartedAt = Date.now();
      }
      conn.xaiCapture.sending = !!enabled;
      if (conn.micTrack) conn.micTrack.enabled = true;
      return;
    }
    const track = conn?.micTrack;
    if (!track) return;
    if (enabled && conn?.backendReady !== true && conn?.pc && conn?.dc) {
      // WebRTC can report an open data channel before the realtime backend has
      // accepted its session. Keep the track quiet until the backend ack arrives
      // so the first spoken turn is not sent into a half-started session.
      track.enabled = false;
      return;
    }
    track.enabled = !!enabled;
  }

  function _mobileRealtimeCanGateInputWithoutMutingTrack(conn) {
    return !!(conn?.xaiCapture && (conn.provider === 'xai' || conn.provider === 'openai_ws'));
  }

  function _mobileRealtimePlaybackActive(conn = __pmRealtimeAgent.conn) {
    const stats = typeof conn?.playback?.stats === 'function' ? conn.playback.stats() : null;
    return !!(stats && (stats.playing || stats.queuedSamples > 0 || stats.currentSamplesRemaining > 0));
  }

  function _scheduleMobileRealtimeInputRestoreWatchdog(reason = 'assistant_output') {
    const guard = __pmRealtimeAgent.outputGuard || (__pmRealtimeAgent.outputGuard = {});
    try { clearTimeout(guard.restoreTimer); } catch {}
    guard.restoreTimer = setTimeout(() => {
      const conn = __pmRealtimeAgent.conn;
      const stillPlaying = _mobileRealtimePlaybackActive(conn);
      const guardExpired = Date.now() >= Number(guard.until || 0);
      if (guard.suspended && guardExpired && !stillPlaying) {
        _restoreMobileRealtimeInputAfterOutput(`${reason}_watchdog`);
        return;
      }
      if (guard.suspended) _scheduleMobileRealtimeInputRestoreWatchdog(`${reason}_retry`);
    }, 1400);
  }

  function _suspendMobileRealtimeInputForOutput(reason = 'assistant_output') {
    const conn = __pmRealtimeAgent.conn;
    if (!conn) return false;
    const listenMode = conn.listenMode || __pmRealtimeAgent.listenMode;
    const guard = __pmRealtimeAgent.outputGuard || (__pmRealtimeAgent.outputGuard = {});
    guard.until = Date.now() + 1200;
    if (listenMode !== 'always_listening') return false;
    if (!guard.suspended) {
      guard.suspended = true;
      guard.restoreSending = conn.xaiCapture ? conn.xaiCapture.sending === true : null;
      guard.restoreTrackEnabled = conn.micTrack ? conn.micTrack.enabled === true : null;
    }
    if (conn.xaiCapture) conn.xaiCapture.sending = false;
    if (conn.micTrack && !_mobileRealtimeCanGateInputWithoutMutingTrack(conn)) conn.micTrack.enabled = false;
    else if (conn.micTrack) conn.micTrack.enabled = true;
    _scheduleMobileRealtimeInputRestoreWatchdog(reason);
    _voiceDebug?.('realtime-agent-input-suspended-for-output', { reason, provider: conn.provider || 'openai_webrtc' });
    return true;
  }

  function _restoreMobileRealtimeInputAfterOutput(reason = 'assistant_output_done') {
    const conn = __pmRealtimeAgent.conn;
    const guard = __pmRealtimeAgent.outputGuard || {};
    if (!guard.suspended) return false;
    const codexQuietWakeListening = __pmRealtimeAgent.quiet?.active && _isMobileCodexV3RealtimeConnection(conn);
    const shouldListen = (conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening'
      && (!__pmRealtimeAgent.quiet?.active || codexQuietWakeListening);
    const restoreSending = guard.restoreSending === true && shouldListen;
    const restoreTrack = guard.restoreTrackEnabled === true && shouldListen;
    if (conn?.xaiCapture) conn.xaiCapture.sending = restoreSending;
    if (conn?.micTrack) conn.micTrack.enabled = _mobileRealtimeCanGateInputWithoutMutingTrack(conn) ? true : restoreTrack;
    try { clearTimeout(guard.restoreTimer); } catch {}
    guard.suspended = false;
    guard.restoreSending = null;
    guard.restoreTrackEnabled = null;
    guard.until = 0;
    guard.restoreTimer = null;
    _voiceDebug?.('realtime-agent-input-restored-after-output', { reason, provider: conn?.provider || 'openai_webrtc', shouldListen });
    return true;
  }

  function _isMobileRealtimeOutputGuardActive() {
    const guard = __pmRealtimeAgent.outputGuard || {};
    if (guard.suspended) return true;
    return Date.now() < Number(guard.until || 0);
  }

  function _mobileRealtimeAudioReceiverTarget(options = {}) {
    const explicit = Number(options.targetSeconds);
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.max(0.12, Math.min(0.5, explicit));
    }
    const cameraActive = typeof __pmRealtimeAgent?.liveCameraFrameReader === 'function'
      || __pmRealtimeAgent?.liveCameraVision?.active === true;
    return cameraActive ? 0.24 : 0.18;
  }

  function _tuneMobileRealtimeAudioReceiver(receiver, options = {}) {
    if (!receiver) return;
    // Let WebRTC hold a short playout cushion when the mobile connection
    // momentarily drops packets. Native WebRTC jitter buffering can then pause
    // briefly and resume cleanly instead of exposing packet-loss crackle.
    const target = _mobileRealtimeAudioReceiverTarget(options);
    try {
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = target;
    } catch {}
    try {
      if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = target;
    } catch {}
  }

  function _stopMobileRealtimeAudioQualityMonitor() {
    const monitor = __pmRealtimeAgent.audioQualityMonitor;
    if (!monitor) return;
    try { clearInterval(monitor.timer); } catch {}
    __pmRealtimeAgent.audioQualityMonitor = null;
  }

  function _startMobileRealtimeAudioQualityMonitor(conn) {
    if (!conn?.pc?.getStats) return;
    _stopMobileRealtimeAudioQualityMonitor();
    const monitor = {
      conn,
      timer: null,
      previous: null,
      badSamples: 0,
      goodSamples: 0,
      degraded: false,
      targetSeconds: 0,
    };
    const sample = async () => {
      if (__pmRealtimeAgent.conn !== conn || !conn.pc?.getStats) {
        _stopMobileRealtimeAudioQualityMonitor();
        return;
      }
      let report;
      try { report = await conn.pc.getStats(); } catch { return; }
      let inboundAudio = null;
      try {
        report?.forEach?.((stat) => {
          if (!inboundAudio && stat?.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio')) {
            inboundAudio = stat;
          }
        });
      } catch {}
      if (!inboundAudio) return;

      const previous = monitor.previous;
      monitor.previous = inboundAudio;
      const received = Math.max(0, Number(inboundAudio.packetsReceived || 0) || 0);
      const lost = Math.max(0, Number(inboundAudio.packetsLost || 0) || 0);
      const previousReceived = Math.max(0, Number(previous?.packetsReceived || 0) || 0);
      const previousLost = Math.max(0, Number(previous?.packetsLost || 0) || 0);
      const packetDelta = Math.max(0, (received - previousReceived) + (lost - previousLost));
      const lossRatio = previous && packetDelta > 0
        ? Math.max(0, (lost - previousLost) / packetDelta)
        : 0;
      const jitterMs = Math.max(0, (Number(inboundAudio.jitter || 0) || 0) * 1000);
      const jitterBufferDelay = Math.max(0, Number(inboundAudio.jitterBufferDelay || 0) || 0);
      const emitted = Math.max(0, Number(inboundAudio.jitterBufferEmittedCount || 0) || 0);
      const previousEmitted = Math.max(0, Number(previous?.jitterBufferEmittedCount || 0) || 0);
      const emittedDelta = emitted - previousEmitted;
      const averageBufferMs = emittedDelta > 0
        ? Math.max(0, ((jitterBufferDelay - (Number(previous?.jitterBufferDelay || 0) || 0)) / emittedDelta) * 1000)
        : 0;
      const degradedSample = lossRatio >= 0.015 || jitterMs >= 70 || averageBufferMs >= 220;
      if (degradedSample) {
        monitor.badSamples += 1;
        monitor.goodSamples = 0;
      } else {
        monitor.goodSamples += 1;
        monitor.badSamples = 0;
      }
      if (!monitor.degraded && monitor.badSamples >= 1) monitor.degraded = true;
      if (monitor.degraded && monitor.goodSamples >= 3) monitor.degraded = false;

      const cameraActive = typeof __pmRealtimeAgent.liveCameraFrameReader === 'function'
        || __pmRealtimeAgent.liveCameraVision?.active === true;
      const targetSeconds = monitor.degraded ? 0.36 : (cameraActive ? 0.24 : 0.18);
      if (targetSeconds !== monitor.targetSeconds) {
        const receiver = conn.audioReceiver
          || conn.pc.getReceivers?.().find?.((item) => item?.track?.kind === 'audio');
        _tuneMobileRealtimeAudioReceiver(receiver, { targetSeconds });
        conn.audioReceiver = receiver || conn.audioReceiver || null;
        monitor.targetSeconds = targetSeconds;
        _voiceDebug?.('realtime-agent-audio-cushion-adjusted', {
          targetMs: Math.round(targetSeconds * 1000),
          degraded: monitor.degraded,
          cameraActive,
          lossRatio: Number(lossRatio.toFixed(4)),
          jitterMs: Math.round(jitterMs),
          averageBufferMs: Math.round(averageBufferMs),
        });
      }
    };
    __pmRealtimeAgent.audioQualityMonitor = monitor;
    monitor.timer = setInterval(sample, 1500);
    sample();
  }

  function _attachMobileRealtimeOutput(audio, stream, options = {}) {
    if (!audio || !stream) return false;
    // Keep the decoded WebRTC stream on the browser's native audio path. The
    // previous gain/compressor/destination chain could clip recovered packets on
    // a weak mobile connection, which sounded like crunchy or robotic speech.
    // The native element already provides the platform's jitter buffer and
    // packet-loss concealment; `_tuneMobileRealtimeAudioReceiver` adds a small
    // extra cushion where the browser exposes those controls.
    try { __pmVoice.realtimeOutputSource?.disconnect?.(); } catch {}
    try { __pmVoice.realtimeOutputGain?.disconnect?.(); } catch {}
    try { __pmVoice.realtimeOutputCompressor?.disconnect?.(); } catch {}
    const receivers = __pmRealtimeAgent?.conn?.pc?.getReceivers?.() || [];
    const receiver = options.receiver || receivers.find?.((item) => item?.track?.kind === 'audio');
    const monitoredTarget = Number(__pmRealtimeAgent?.audioQualityMonitor?.targetSeconds || 0);
    _tuneMobileRealtimeAudioReceiver(receiver, monitoredTarget > 0 ? { targetSeconds: monitoredTarget } : {});
    if (__pmRealtimeAgent?.conn?.pc && receiver) __pmRealtimeAgent.conn.audioReceiver = receiver;
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = 1;
    audio.play?.().catch(() => {});
    _voiceDebug?.('realtime-agent-output-native', { transport: options.direct === true ? 'codex_app_server' : 'webrtc' });
    return true;
  }

  function _shouldIgnoreMobileRealtimeSpeechStartedDuringOutput(provider = '') {
    const conn = __pmRealtimeAgent.conn;
    const stats = typeof conn?.playback?.stats === 'function' ? conn.playback.stats() : null;
    const playbackActive = _mobileRealtimePlaybackActive(conn);
    const active = __pmRealtimeAgent.activeResponse || __pmVoice.realtimeSpeechActiveResponse || playbackActive || _isMobileRealtimeOutputGuardActive();
    if (!active) return false;
    _voiceDebug?.('realtime-agent-barge-in-cancel', {
      provider,
      activeResponse: !!__pmRealtimeAgent.activeResponse,
      realtimeSpeechActive: !!__pmVoice.realtimeSpeechActiveResponse,
      playbackActive,
      queuedSamples: stats?.queuedSamples || 0,
    });
    const dc = conn?.dc;
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
      if (conn?.provider !== 'xai') {
        try { dc.send(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
      }
    }
    try { conn?.playback?.interrupt?.(); } catch {}
    __pmRealtimeAgent.activeResponse = false;
    __pmRealtimeAgent.narrationPending = false;
    __pmVoice.realtimeSpeechActiveResponse = false;
    _markVoiceSpeakingEnd();
    // Continue processing speech_started as a real user turn.
    return false;
  }

  // --- xAI / Grok realtime (WebSocket transport) for mobile -------------------
  const MOBILE_XAI_REALTIME_SAMPLE_RATE = 24000;
  const MOBILE_XAI_REALTIME_INPUT_SAMPLE_RATE = 24000;

  function _mobileXaiVoice(value) {
    const voices = new Set(['eve', 'ara', 'rex', 'sal', 'leo']);
    const v = String(value || '').trim().toLowerCase();
    return voices.has(v) ? v : 'eve';
  }

  function _mobileBase64ToInt16(b64) {
    const binary = atob(String(b64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // A provider can split a PCM packet on an odd byte boundary. Keep complete
    // little-endian samples only; a partial trailing byte must not become a
    // malformed Int16Array or poison the next playback chunk.
    const usableBytes = bytes.length - (bytes.length % 2);
    return new Int16Array(bytes.buffer, 0, usableBytes / 2);
  }

  function _mobileInt16ToBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function _mobileXaiRealtimeDownsampleFloat32(input, inputRate, outputRate) {
    if (!input?.length) return new Int16Array(0);
    if (!inputRate || inputRate === outputRate) {
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[i] || 0));
        out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return out;
    }
    const ratio = inputRate / outputRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const out = new Int16Array(length);
    for (let i = 0; i < length; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j += 1) {
        sum += input[j] || 0;
        count += 1;
      }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : input[start] || 0));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  function _resampleInt16ToFloat32(int16, inputRate, outputRate) {
    if (!int16 || !int16.length) return new Float32Array(0);
    const inRate = Math.max(1, Number(inputRate || MOBILE_XAI_REALTIME_SAMPLE_RATE) || MOBILE_XAI_REALTIME_SAMPLE_RATE);
    const outRate = Math.max(1, Number(outputRate || inRate) || inRate);
    const outLength = inRate === outRate
      ? int16.length
      : Math.max(1, Math.round((int16.length * outRate) / inRate));
    const out = new Float32Array(outLength);
    if (inRate === outRate) {
      for (let i = 0; i < int16.length; i += 1) {
        const s = int16[i] || 0;
        out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }
      return out;
    }
    const ratio = inRate / outRate;
    for (let i = 0; i < outLength; i += 1) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const aRaw = int16[Math.min(idx, int16.length - 1)] || 0;
      const bRaw = int16[Math.min(idx + 1, int16.length - 1)] || aRaw;
      const a = aRaw < 0 ? aRaw / 0x8000 : aRaw / 0x7fff;
      const b = bRaw < 0 ? bRaw / 0x8000 : bRaw / 0x7fff;
      out[i] = a + ((b - a) * frac);
    }
    return out;
  }

  function _createMobileXaiPlayback(options = {}) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const sourceRate = Math.max(1, Number(options.sampleRate || MOBILE_XAI_REALTIME_SAMPLE_RATE) || MOBILE_XAI_REALTIME_SAMPLE_RATE);
    const outputRate = Math.max(1, Math.round(ctx.sampleRate || sourceRate));
    const provider = String(options.provider || 'openai_ws');
    const isXai = provider === 'xai';
    // A larger callback block keeps the WebSocket fallback from depending on
    // extremely frequent main-thread audio callbacks while camera frames,
    // canvas encoding, or tool UI updates are active on iOS.
    const processorSize = Math.max(1024, Number(options.processorSize || 2048) || 2048);
    const processor = ctx.createScriptProcessor(processorSize, 1, 1);
    const driver = ctx.createBufferSource();
    driver.buffer = ctx.createBuffer(1, processorSize, outputRate);
    driver.loop = true;
    const mutedGain = ctx.createGain();
    // Keep streamed PCM at unity gain. Boosting the decoded samples here can
    // clip perfectly valid peaks and turns a packet recovery/underrun into
    // crunchy speech on mobile speakers.
    mutedGain.gain.value = 1;
    const queue = [];
    let queuedSamples = 0;
    let current = null;
    let currentOffset = 0;
    let playing = false;
    let closed = false;
    let smoothGain = 0;
    let underruns = 0;
    let emptySamples = 0;
    let chunksEnqueued = 0;
    let samplesEnqueued = 0;
    let droppedChunks = 0;
    let lastDebugAt = 0;
    let resampleInput = [];
    let resampleBaseIndex = 0;
    let resampleNextPosition = 0;
    const debugPlayback = (event, data = {}, force = false) => {
      if (!isXai) return;
      const now = Date.now();
      if (!force && now - lastDebugAt < 900) return;
      lastDebugAt = now;
      _voiceDebug(`xai-realtime-playback-${event}`, {
        ...data,
        queuedMs: Math.round((queuedSamples / outputRate) * 1000),
        underruns,
        chunksEnqueued,
        droppedChunks,
      });
    };
    const resampleForXai = (int16) => {
      if (!isXai || sourceRate === outputRate) return _resampleInt16ToFloat32(int16, sourceRate, outputRate);
      for (let i = 0; i < int16.length; i += 1) {
        const raw = int16[i] || 0;
        resampleInput.push(raw < 0 ? raw / 0x8000 : raw / 0x7fff);
      }
      const endIndex = resampleBaseIndex + resampleInput.length;
      const ratio = sourceRate / outputRate;
      const result = [];
      // Keep one look-ahead sample so adjacent xAI deltas share the same linear
      // interpolation boundary. Resetting interpolation per packet is audible
      // as a click/crunch on mobile output devices.
      while (Math.floor(resampleNextPosition) + 1 < endIndex) {
        const floorPosition = Math.floor(resampleNextPosition);
        const index = floorPosition - resampleBaseIndex;
        const frac = resampleNextPosition - floorPosition;
        const a = resampleInput[index] || 0;
        const b = resampleInput[index + 1] ?? a;
        result.push(a + ((b - a) * frac));
        resampleNextPosition += ratio;
      }
      const keepFrom = Math.max(resampleBaseIndex, Math.floor(resampleNextPosition) - 1);
      if (keepFrom > resampleBaseIndex) {
        resampleInput.splice(0, keepFrom - resampleBaseIndex);
        resampleBaseIndex = keepFrom;
      }
      return Float32Array.from(result);
    };
    // A little more cushion lets a short Wi-Fi/cellular stall become a brief
    // pause while the queue catches up, instead of repeatedly starting/stopping
    // at the edge of an underrun.
    const prebufferSamples = Math.max(
      processorSize * 3,
      Math.round(outputRate * (isXai
        ? Math.max(0.48, Number(options.prebufferSeconds || 0.55) || 0.55)
        : Math.max(0.34, Number(options.prebufferSeconds || 0.42) || 0.42))),
    );
    // Do not tear down playback on the first empty callback. A camera read or
    // vision/tool update can briefly occupy the main thread even though the
    // network queue is about to receive more audio. Holding a short silence
    // window lets the output fade smoothly and resume from the same stream.
    const underrunGraceSamples = Math.max(processorSize, Math.round(outputRate * (isXai ? 0.16 : 0.08)));
    // Memory-safety ceiling only (~60s). Realtime audio (esp. xAI/Grok) streams the full
    // response in a fast burst over the WS, faster than realtime playback. A small cap here
    // made trimQueue() destructively delete unplayed/in-flight audio on long messages, causing
    // the spoken audio to skip/jump ahead of the transcript. Keep this huge so trimQueue never
    // fires during normal speech; barge-in is handled separately by interrupt().
    const maxQueueSamples = Math.max(prebufferSamples * 2, Math.round(outputRate * 60));

    const popSample = () => {
      while (!current || currentOffset >= current.length) {
        current = queue.shift() || null;
        currentOffset = 0;
        if (!current) return null;
      }
      const sample = current[currentOffset++] || 0;
      queuedSamples = Math.max(0, queuedSamples - 1);
      return sample;
    };

    processor.onaudioprocess = (event) => {
      const out = event.outputBuffer.getChannelData(0);
      if (closed) {
        out.fill(0);
        return;
      }
      if (!playing && queuedSamples >= prebufferSamples) {
        playing = true;
        debugPlayback('started', { prebufferMs: Math.round((prebufferSamples / outputRate) * 1000) }, true);
      }
      for (let i = 0; i < out.length; i += 1) {
        const sample = playing ? popSample() : null;
        if (sample == null) {
          if (playing) {
            emptySamples += 1;
            if (emptySamples > underrunGraceSamples) {
              underruns += 1;
              playing = false;
              emptySamples = 0;
              debugPlayback('underrun', { graceMs: Math.round((underrunGraceSamples / outputRate) * 1000) }, true);
            }
          }
          const step = 1 / 960;
          smoothGain = Math.max(0, smoothGain - step);
          out[i] = 0;
        } else {
          emptySamples = 0;
          const step = 1 / 960;
          smoothGain = Math.min(1, smoothGain + step);
          out[i] = sample * smoothGain;
        }
      }
    };
    driver.connect(processor);
    processor.connect(mutedGain);
    mutedGain.connect(ctx.destination);
    try { driver.start(0); } catch {}

    const trimQueue = () => {
      while (queuedSamples > maxQueueSamples && queue.length > 1) {
        const chunk = queue.shift();
        queuedSamples = Math.max(0, queuedSamples - (chunk?.length || 0));
        droppedChunks += 1;
      }
      if (droppedChunks) debugPlayback('backpressure-drop', { maxQueueMs: Math.round((maxQueueSamples / outputRate) * 1000) });
    };

    return {
      ctx,
      enqueue(int16) {
        if (!int16 || !int16.length) return;
        const float = resampleForXai(int16);
        if (!float.length) return;
        queue.push(float);
        queuedSamples += float.length;
        chunksEnqueued += 1;
        samplesEnqueued += float.length;
        trimQueue();
        if (isXai && !playing && queuedSamples < prebufferSamples) {
          debugPlayback('buffering', { bufferMs: Math.round((queuedSamples / outputRate) * 1000) });
        }
        try { if (ctx.state === 'suspended') ctx.resume?.(); } catch {}
      },
      interrupt() {
        queue.length = 0;
        queuedSamples = 0;
        current = null;
        currentOffset = 0;
        playing = false;
        smoothGain = 0;
        emptySamples = 0;
        resampleInput = [];
        resampleBaseIndex = 0;
        resampleNextPosition = 0;
        if (isXai) debugPlayback('interrupted', {}, true);
      },
      async resume() { try { await ctx.resume?.(); } catch {} },
      close() {
        closed = true;
        this.interrupt();
        try { driver.stop(0); } catch {}
        try { driver.disconnect(); } catch {}
        try { processor.disconnect(); } catch {}
        try { mutedGain.disconnect(); } catch {}
        try { ctx.close?.(); } catch {}
      },
      stats() {
        return {
          queuedSamples,
          currentSamplesRemaining: current ? Math.max(0, current.length - currentOffset) : 0,
          outputRate,
          sourceRate,
          provider,
          prebufferMs: Math.round((prebufferSamples / outputRate) * 1000),
          underrunGraceMs: Math.round((underrunGraceSamples / outputRate) * 1000),
          playing,
          underruns,
          chunksEnqueued,
          samplesEnqueued,
          droppedChunks,
          resamplePendingSamples: resampleInput.length,
        };
      },
    };
  }

  function _hasMobileXaiRealtimeWarmMic() {
    const stream = __pmVoice?.warmMicStream;
    return !!(stream && stream.getAudioTracks?.().some(track => track.readyState === 'live'));
  }

  async function _ensureMobileXaiRealtimeMic() {
    if (_hasMobileXaiRealtimeWarmMic()) return __pmVoice.warmMicStream;
    if (__pmVoice?.warmMicPromise) return __pmVoice.warmMicPromise;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mobile Safari is not exposing microphone capture to xAI realtime.');
    const promise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then((stream) => {
      __pmVoice.warmMicStream = stream;
      __pmVoice.warmMicPromise = null;
      stream.getAudioTracks?.().forEach(track => {
        track.enabled = true;
        track.addEventListener?.('ended', () => {
          if (__pmVoice.warmMicStream === stream) __pmVoice.warmMicStream = null;
        });
      });
      return stream;
    }).catch((err) => {
      if (__pmVoice) __pmVoice.warmMicPromise = null;
      throw err;
    });
    if (__pmVoice) __pmVoice.warmMicPromise = promise;
    return promise;
  }

  async function _startMobileOpenAiRealtimeWebSocketSession(sessionId, options = {}) {
    let sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (sid === MOBILE_CHAT_SESSION_ID) {
      sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'openai_realtime_ws_bootstrap' });
    }
    const listenMode = String(options.listenMode || 'push_to_talk').trim();
    const bootstrap = options.bootstrap || {};
    const clientSecret = String(bootstrap.clientSecret || '').trim();
    if (!clientSecret) throw new Error('OpenAI realtime WebSocket fallback is missing the client secret.');
    _voiceDebug('openai-realtime-ws-start', { sessionId: sid, listenMode, model: bootstrap.model });

    const micStream = await _ensureMobileXaiRealtimeMic();
    const micTrack = micStream.getAudioTracks()[0];
    micTrack.enabled = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const captureCtx = new AudioCtx({ sampleRate: MOBILE_XAI_REALTIME_SAMPLE_RATE });
    const source = captureCtx.createMediaStreamSource(micStream);
    const processor = captureCtx.createScriptProcessor(2048, 1, 1);
    const mutedGain = captureCtx.createGain();
    mutedGain.gain.value = 0;
    const openAiCapture = {
      sending: listenMode === 'push_to_talk' || listenMode === 'always_listening',
      appends: 0,
      nonSilent: 0,
      peakMax: 0,
      sampleRate: Math.round(captureCtx.sampleRate || MOBILE_XAI_REALTIME_SAMPLE_RATE),
      pending: [],
      ws: null,
      ready: false,
    };
    const flushPendingOpenAiRealtimeAudio = () => {
      const ws = openAiCapture.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      while (openAiCapture.pending.length) {
        const audio = openAiCapture.pending.shift();
        if (!audio) continue;
        try { ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio })); } catch {}
      }
    };
    processor.onaudioprocess = (event) => {
      if (!openAiCapture.sending) return;
      const input = event.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < input.length; i += 64) {
        const a = Math.abs(input[i] || 0);
        if (a > peak) peak = a;
      }
      if (peak > openAiCapture.peakMax) openAiCapture.peakMax = peak;
      if (peak > 0.003) openAiCapture.nonSilent += 1;
      const rate = openAiCapture.sampleRate || MOBILE_XAI_REALTIME_SAMPLE_RATE;
      const pcm = _mobileXaiRealtimeDownsampleFloat32(input, captureCtx.sampleRate || rate, rate);
      if (pcm.length > 0) {
        const audio = _mobileInt16ToBase64(pcm);
        openAiCapture.appends += 1;
        const ws = openAiCapture.ws;
        if (openAiCapture.ready && ws?.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio })); } catch {}
        } else {
          openAiCapture.pending.push(audio);
          if (openAiCapture.pending.length > 240) openAiCapture.pending.splice(0, openAiCapture.pending.length - 240);
        }
      }
    };
    source.connect(processor);
    processor.connect(mutedGain);
    mutedGain.connect(captureCtx.destination);
    await captureCtx.resume?.();

    const modelCandidates = [String(bootstrap.model || 'gpt-realtime-2').trim() || 'gpt-realtime-2'];
    const protocolCandidates = [[]];
    let ws = null;
    let model = '';
    let lastWsError = '';
    for (const modelCandidate of modelCandidates) {
      for (const protocols of protocolCandidates) {
        model = modelCandidate;
        const protocolLabel = 'gateway-proxy';
        _voiceDebug('openai-realtime-ws-attempt', { sessionId: sid, listenMode, model, protocols: protocolLabel });
        let candidate = null;
        try {
          candidate = new WebSocket(
            buildMobileGatewayWsUrl('/api/voice-agent/openai-realtime-ws', {
              model,
              client_secret: clientSecret,
            }),
            protocols,
          );
          candidate.binaryType = 'arraybuffer';
          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (ok, value) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              ok ? resolve(value) : reject(value);
            };
            const timeout = setTimeout(() => finish(false, new Error('OpenAI realtime WebSocket did not open.')), 12000);
            candidate.addEventListener('open', () => {
              _voiceDebug('openai-realtime-ws-open', { sessionId: sid, listenMode, protocol: candidate.protocol, model, protocols: protocolLabel });
              finish(true, true);
            }, { once: true });
            candidate.addEventListener('close', (ev) => {
              _voiceDebug('openai-realtime-ws-attempt-closed', { code: ev.code, reason: ev.reason, protocol: candidate.protocol, model, protocols: protocolLabel });
              finish(false, new Error(`OpenAI realtime WebSocket closed before open (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`));
            }, { once: true });
            candidate.addEventListener('error', () => {
              finish(false, new Error('OpenAI realtime WebSocket failed.'));
            }, { once: true });
          });
          ws = candidate;
          break;
        } catch (err) {
          lastWsError = err?.message || String(err);
          try { candidate?.close?.(); } catch {}
        }
      }
      if (ws) break;
    }
    if (!ws) throw new Error(lastWsError || 'OpenAI realtime WebSocket failed.');
    openAiCapture.ws = ws;
    const playback = _createMobileXaiPlayback({ sampleRate: MOBILE_XAI_REALTIME_SAMPLE_RATE, provider: 'openai_ws' });
    await playback.resume?.();

    ws.addEventListener('close', (ev) => {
      _voiceDebug('openai-realtime-ws-closed', { code: ev.code, reason: ev.reason, protocol: ws.protocol, model });
    });

    const dcShim = {
      get readyState() { return ws.readyState === WebSocket.OPEN ? 'open' : 'closed'; },
      send: (payload) => {
        try {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(payload);
          return true;
        } catch {
          return false;
        }
      },
      close: () => { try { ws.close(); } catch {} },
    };
    let realtimeBackendReady = false;
    const markRealtimeBackendReady = (detail = {}) => {
      realtimeBackendReady = true;
      openAiCapture.ready = true;
      flushPendingOpenAiRealtimeAudio();
      const active = __pmRealtimeAgent?.conn;
      if (active?.ws === ws) _markMobileRealtimeAgentBackendReady(active, detail);
    };

    ws.addEventListener('message', (msgEvent) => {
      let event = null;
      try { event = JSON.parse(typeof msgEvent.data === 'string' ? msgEvent.data : ''); } catch { return; }
      if (!event) return;
      const type = String(event.type || '');
      if (type === 'session.updated') markRealtimeBackendReady({ source: 'session.updated' });
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        if (__pmRealtimeAgent) __pmRealtimeAgent.activeResponse = true;
        _suspendMobileRealtimeInputForOutput('openai_ws_audio_delta');
        if (__pmRealtimeAgent?.quiet?.active || __pmRealtimeAgent?.quiet?.suppressResponse) {
          __pmRealtimeAgent.quiet.suppressResponse = true;
          _voiceDebug('openai-realtime-ws-quiet-audio-suppressed', { type });
          return;
        }
        __pmVoice.realtimeSpeechActiveResponse = true;
        const b64 = event.delta || event.audio;
        if (b64) {
          try {
            const pcm = _mobileBase64ToInt16(b64);
            _noteMobileRealtimeAssistantAudioChunk(sid, pcm);
            playback.enqueue(pcm);
          } catch {}
        }
        return;
      }
      if (type === 'input_audio_buffer.speech_started') {
        if (!_shouldIgnoreMobileRealtimeSpeechStartedDuringOutput('openai_ws')) {
          try { playback.interrupt(); } catch {}
        }
      }
      if (type === 'error' || type === 'response.error' || /\.error$/.test(type)) {
        const msg = String(event?.error?.message || event?.error || event?.message || JSON.stringify(event)).slice(0, 300);
        _voiceDebug('openai-realtime-ws-error', { type, msg });
        try { pmToast(`OpenAI realtime error: ${msg}`, 'error'); } catch {}
      }
      _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
    });

    const turnDetection = _mobileRealtimeTurnDetectionForListenMode(listenMode);
    try {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: bootstrap.instructions,
          tools: Array.isArray(bootstrap.tools) ? bootstrap.tools : [],
          tool_choice: 'auto',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: openAiCapture.sampleRate || MOBILE_XAI_REALTIME_SAMPLE_RATE },
              noise_reduction: { type: 'near_field' },
              transcription: { model: 'gpt-realtime-whisper' },
              turn_detection: turnDetection,
            },
            output: {
              voice: __pmVoice?.settings?.realtimeVoice || bootstrap.voice || 'marin',
              speed: Number(__pmVoice?.settings?.realtimeSpeed || 1.05),
            },
          },
        },
      }));
    } catch {}

    __pmRealtimeAgent.conn = {
      provider: 'openai_ws', ws, dc: dcShim, pc: null, audio: null, micStream, micTrack, sessionId: sid, listenMode, playback, xaiCapture: openAiCapture,
      baseInstructions: String(bootstrap.instructions || '').trim(),
      backendReady: realtimeBackendReady,
      backendReadyNotified: false,
      cleanup: () => {
        try { processor.disconnect(); } catch {}
        try { source.disconnect(); } catch {}
        try { mutedGain.disconnect(); } catch {}
        try { captureCtx.close?.(); } catch {}
        try { playback.close(); } catch {}
        try { ws.close(); } catch {}
      },
    };
    ws.addEventListener('close', () => {
      if (__pmRealtimeAgent.conn?.ws !== ws) return;
      __pmRealtimeAgent.conn = null;
      _notifyMobileVoiceAgentConnection('reconnecting', { sessionId: sid, reason: 'socket_closed' });
    });
    _voiceDebug('openai-realtime-ws-ready', { sessionId: sid, listenMode, model });
    _sendMobileRealtimeCameraRuntimeUpdate('openai_ws_ready');
    if (realtimeBackendReady) {
      _markMobileRealtimeAgentBackendReady(__pmRealtimeAgent.conn, { source: 'session.updated' });
    }
    return __pmRealtimeAgent.conn;
  }

  async function _startMobileXaiRealtimeSession(sessionId, options = {}) {
    let sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (sid === MOBILE_CHAT_SESSION_ID) {
      sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'xai_realtime_agent_bootstrap' });
    }
    const listenMode = String(options.listenMode || 'push_to_talk').trim();
    if (__pmRealtimeAgent.conn?.dc?.readyState === 'open' && String(__pmRealtimeAgent.conn.sessionId || '').trim() === sid) {
      __pmRealtimeAgent.conn.listenMode = listenMode;
      __pmRealtimeAgent.listenMode = listenMode;
      _sendMobileRealtimeAgentSessionUpdateFromSettings('xai_realtime_agent_reuse');
      if (listenMode === 'always_listening') _setMobileRealtimeAgentMicEnabled(true);
      _notifyMobileVoiceAgentConnection(
        __pmRealtimeAgent.conn.backendReady === true ? 'connected' : 'starting',
        { sessionId: sid, reused: true },
      );
      return __pmRealtimeAgent.conn;
    }
    if (__pmRealtimeAgent.conn && String(__pmRealtimeAgent.conn.sessionId || '').trim() !== sid) {
      _mobileRealtimeAgentDisableAlwaysListening();
    }
    if (__pmRealtimeAgent.connecting) {
      const pendingSid = String(__pmRealtimeAgent.connectingSessionId || '').trim();
      if (!pendingSid || pendingSid === sid) return __pmRealtimeAgent.connecting;
      _stopMobileRealtimeAgentSession();
    }
    __pmRealtimeAgent.listenMode = listenMode;
    const startId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    __pmRealtimeAgent.connectingSessionId = sid;
    __pmRealtimeAgent.connectingStartId = startId;
    let xaiRealtimeStartCleanup = null;

    __pmRealtimeAgent.connecting = (async () => {
      _voiceDebug('xai-realtime-bootstrap-start', { sessionId: sid, listenMode });
      const quietState = _syncMobileRealtimeAgentQuietFromSettings();
      const wakePhrase = quietState.wakePhrase;

      // Start capture immediately on the user's gesture. On first PTT, xAI
      // bootstrap + WS open can take long enough that speaking is otherwise over
      // before the capture graph exists.
      const micStream = await _ensureMobileXaiRealtimeMic();
      const micTrack = micStream.getAudioTracks()[0];
      micTrack.enabled = true;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const captureCtx = new AudioCtx();
      const source = captureCtx.createMediaStreamSource(micStream);
      const processor = captureCtx.createScriptProcessor(2048, 1, 1);
      const mutedGain = captureCtx.createGain();
      let ws = null;
      let playback = null;
      xaiRealtimeStartCleanup = () => {
        try { processor.disconnect(); } catch {}
        try { source.disconnect(); } catch {}
        try { mutedGain.disconnect(); } catch {}
        try { captureCtx.close?.(); } catch {}
        try { playback?.close?.(); } catch {}
        try { ws?.close?.(); } catch {}
      };
      mutedGain.gain.value = 0;
      const xaiCapture = {
        sending: listenMode === 'push_to_talk' || listenMode === 'always_listening',
        appends: 0,
        nonSilent: 0,
        peakMax: 0,
        audioLevel: 0,
        sampleRate: MOBILE_XAI_REALTIME_INPUT_SAMPLE_RATE,
        pending: [],
        ws: null,
        ready: false,
      };
      const flushPendingXaiRealtimeAudio = () => {
        const ws = xaiCapture.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        while (xaiCapture.pending.length) {
          const audio = xaiCapture.pending.shift();
          if (!audio) continue;
          try { ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio })); } catch {}
        }
      };
      processor.onaudioprocess = (event) => {
        if (!xaiCapture.sending) return;
        const input = event.inputBuffer.getChannelData(0);
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < input.length; i += 64) {
          const sample = input[i] || 0;
          const a = Math.abs(sample);
          sumSquares += sample * sample;
          if (a > peak) peak = a;
        }
        const sampledCount = Math.max(1, Math.ceil(input.length / 64));
        const rms = Math.sqrt(sumSquares / sampledCount);
        xaiCapture.audioLevel = Math.max(0, Math.min(1, (rms * .78) + (peak * .22)));
        if (peak > xaiCapture.peakMax) xaiCapture.peakMax = peak;
        if (peak > 0.003) xaiCapture.nonSilent += 1;
        const rate = xaiCapture.sampleRate || MOBILE_XAI_REALTIME_INPUT_SAMPLE_RATE;
        const pcm = _mobileXaiRealtimeDownsampleFloat32(input, captureCtx.sampleRate || rate, rate);
        if (pcm.length > 0) {
          const audio = _mobileInt16ToBase64(pcm);
          xaiCapture.appends += 1;
          const ws = xaiCapture.ws;
          if (xaiCapture.ready && ws?.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio })); } catch {}
          } else {
            xaiCapture.pending.push(audio);
            if (xaiCapture.pending.length > 240) xaiCapture.pending.splice(0, xaiCapture.pending.length - 240);
          }
        }
      };
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(captureCtx.destination);
      await captureCtx.resume?.();

      const workerContextPacket = await _prefetchMobileVoiceWorkerContextPacket(sid, { source: 'mobile_xai_realtime_bootstrap', force: true });
      const bootstrap = await mobileGatewayFetch('/api/voice-agent/xai-realtime-bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          voiceTarget: _mobileVoiceTargetPayload(),
          voice: _mobileXaiVoice(__pmVoice?.settings?.serverVoice || __pmVoice?.settings?.realtimeVoice),
          speed: Number(__pmVoice?.settings?.xaiSpeed || 1.0),
          voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice?.settings?.wakeGateActive === true } : undefined,
          cameraRuntime: _mobileRealtimeCameraRuntimePayload(),
          deviceTime: _mobileVoiceDeviceTimeContext(),
          voiceRoomContext: _mobileVoiceRoomContextPayload(),
          ...(workerContextPacket ? { contextPacket: workerContextPacket } : {}),
        }),
      });
      if (!bootstrap?.success) throw new Error(bootstrap?.error || 'xAI realtime bootstrap failed');

      // Single subprotocol entry only — xAI negotiates the wrong protocol if extras
      // (e.g. 'realtime') are offered, which silently breaks session config/auth.
      ws = new WebSocket(bootstrap.wsUrl, [`xai-client-secret.${bootstrap.clientSecret}`]);
      ws.binaryType = 'arraybuffer';
      xaiCapture.ws = ws;
      playback = _createMobileXaiPlayback({ sampleRate: MOBILE_XAI_REALTIME_SAMPLE_RATE, provider: 'xai' });
      await playback.resume?.();

      ws.addEventListener('close', (ev) => {
        _voiceDebug('xai-realtime-socket-closed', { code: ev.code, reason: ev.reason, protocol: ws.protocol });
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('xAI realtime socket did not open.')), 12000);
        ws.addEventListener('open', () => { clearTimeout(timeout); resolve(true); }, { once: true });
        ws.addEventListener('close', (ev) => { clearTimeout(timeout); reject(new Error(`xAI realtime socket closed before open (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`)); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('xAI realtime socket failed.')); }, { once: true });
      });

      const dcShim = {
        get readyState() { return ws.readyState === WebSocket.OPEN ? 'open' : 'closed'; },
        send: (payload) => {
          try {
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(payload);
            return true;
          } catch {
            return false;
          }
        },
        close: () => { try { ws.close(); } catch {} },
      };
      let realtimeBackendReady = false;
      const markRealtimeBackendReady = (detail = {}) => {
        realtimeBackendReady = true;
        xaiCapture.ready = true;
        flushPendingXaiRealtimeAudio();
        const active = __pmRealtimeAgent?.conn;
        if (active?.ws === ws) _markMobileRealtimeAgentBackendReady(active, detail);
      };

      ws.addEventListener('message', (msgEvent) => {
        let event = null;
        try { event = JSON.parse(typeof msgEvent.data === 'string' ? msgEvent.data : ''); } catch { return; }
        if (!event) return;
        const type = String(event.type || '');
        if (type === 'session.updated') markRealtimeBackendReady({ source: 'session.updated' });
        if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
          if (__pmRealtimeAgent) __pmRealtimeAgent.activeResponse = true;
          _suspendMobileRealtimeInputForOutput('xai_audio_delta');
          if (__pmRealtimeAgent?.quiet?.active || __pmRealtimeAgent?.quiet?.suppressResponse) {
            __pmRealtimeAgent.quiet.suppressResponse = true;
            _voiceDebug('xai-realtime-quiet-audio-suppressed', { type });
            return;
          }
          __pmVoice.realtimeSpeechActiveResponse = true;
          const b64 = event.delta || event.audio;
          if (b64) {
            try {
              const pcm = _mobileBase64ToInt16(b64);
              _noteMobileRealtimeAssistantAudioChunk(sid, pcm);
              playback.enqueue(pcm);
            } catch {}
          }
          return;
        }
        if (type === 'input_audio_buffer.speech_started') {
          if (!_shouldIgnoreMobileRealtimeSpeechStartedDuringOutput('xai')) {
            try { playback.interrupt(); } catch {}
          }
        }
        if (type === 'error' || type === 'response.error' || /\.error$/.test(type)) {
          const msg = String(event?.error?.message || event?.error || event?.message || JSON.stringify(event)).slice(0, 300);
          _voiceDebug('xai-realtime-error', { type, msg });
          if (!_isBenignRealtimeCancelError(event)) {
            try { pmToast(`xAI realtime error: ${msg}`, 'error'); } catch {}
          }
        }
        _handleMobileRealtimeAgentEvent(event, sid).catch(() => {});
      });

      const turnDetection = _mobileRealtimeTurnDetectionForListenMode(listenMode);
      try {
        const speed = Number(__pmVoice?.settings?.xaiSpeed || bootstrap.speed || 1.0);
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions: bootstrap.instructions,
            voice: bootstrap.voice,
            speed,
            audio: {
              output: { speed },
            },
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'grok-stt' },
            turn_detection: turnDetection,
          },
        }));
        if (Array.isArray(bootstrap.tools) && bootstrap.tools.length) {
          try { ws.send(JSON.stringify({ type: 'session.update', session: { tools: bootstrap.tools, tool_choice: 'auto' } })); } catch {}
        }
      } catch {}

      if (__pmRealtimeAgent.connectingStartId !== startId) {
        try { ws?.close(); } catch {}
        try { processor.disconnect(); } catch {}
        try { source.disconnect(); } catch {}
        try { mutedGain.disconnect(); } catch {}
        try { captureCtx.close?.(); } catch {}
        try { playback.close(); } catch {}
        const successor = __pmRealtimeAgent.connecting;
        if (successor) {
          _voiceDebug('xai-realtime-bootstrap-joined-successor', { sessionId: sid, listenMode });
          return await successor;
        }
        if (__pmRealtimeAgent.conn) return __pmRealtimeAgent.conn;
        throw _mobileRealtimeBootstrapSupersededError('xAI realtime');
      }
      __pmRealtimeAgent.conn = {
        provider: 'xai', ws, dc: dcShim, pc: null, audio: null, micStream, micTrack, sessionId: sid, listenMode, playback, xaiCapture,
        baseInstructions: String(bootstrap.instructions || '').trim(),
        backendReady: realtimeBackendReady,
        backendReadyNotified: false,
        cleanup: () => {
          try { processor.disconnect(); } catch {}
          try { source.disconnect(); } catch {}
          try { mutedGain.disconnect(); } catch {}
          try { captureCtx.close?.(); } catch {}
          try { playback.close(); } catch {}
          try { ws.close(); } catch {}
        },
      };
      ws.addEventListener('close', () => {
        if (__pmRealtimeAgent.conn?.ws !== ws) return;
        __pmRealtimeAgent.conn = null;
        _notifyMobileVoiceAgentConnection('reconnecting', { sessionId: sid, reason: 'socket_closed' });
      });
      _voiceDebug('xai-realtime-ready', { sessionId: sid, listenMode });
      _sendMobileRealtimeCameraRuntimeUpdate('xai_session_ready');
      if (realtimeBackendReady) {
        _markMobileRealtimeAgentBackendReady(__pmRealtimeAgent.conn, { source: 'session.updated' });
      }
      return __pmRealtimeAgent.conn;
    })().catch((err) => {
      try { xaiRealtimeStartCleanup?.(); } catch {}
      _notifyMobileVoiceAgentConnection('error', { sessionId: sid, message: err?.message || String(err) });
      throw err;
    }).finally(() => {
      if (__pmRealtimeAgent.connectingStartId === startId) {
        __pmRealtimeAgent.connecting = null;
        __pmRealtimeAgent.connectingSessionId = '';
        __pmRealtimeAgent.connectingStartId = '';
      }
    });
    return __pmRealtimeAgent.connecting;
  }

  function _ensureMobileRealtimeAgentChatTurn(sessionId, role) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
    const key = role === 'user' ? 'mobileUserTurn' : 'mobileAssistantTurn';
    const existing = __pmRealtimeAgent.turn?.[key];
    if (existing && __pmChat.threads[sid].includes(existing)) return existing;
    const exchangeId = _ensureMobileRealtimeExchangeId();
    const turn = role === 'user'
      ? {
          role: 'user',
          streaming: true,
          time: '',
          timestamp: Date.now(),
          body: { text: '', source: 'voice' },
          content: '',
          source: 'voice_agent_realtime',
          workflowGroupId: exchangeId,
          workflowPart: 'voice_user',
        }
      : {
          role: 'ai',
          streaming: true,
          time: '',
          timestamp: Date.now(),
          body: { sender: 'Prometheus', text: '' },
          content: '',
          source: 'voice_agent_realtime',
          workflowGroupId: exchangeId,
          workflowPart: 'voice_assistant',
        };
    if (role !== 'user') {
      const pendingEntries = _takePendingVoiceAgentProcessEntries(sid);
      if (pendingEntries.length) {
        turn.processEntries = pendingEntries;
        turn.workStartedAt = Number(turn.timestamp || Date.now()) || Date.now();
      }
    }
    __pmChat.threads[sid].push(turn);
    __pmRealtimeAgent.turn[key] = turn;
    return turn;
  }

  function _newMobileRealtimeExchangeId() {
    return `voice_exchange_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function _ensureMobileRealtimeExchangeId({ forceNew = false } = {}) {
    const turn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
    if (forceNew || !String(turn.currentVoiceExchangeId || '').trim()) {
      turn.currentVoiceExchangeId = _newMobileRealtimeExchangeId();
      turn.currentVoiceExchangeResponseStarted = false;
      turn.currentVoiceExchangeHasUser = false;
      turn.currentUserTranscriptPrefix = '';
      turn.currentUserTranscriptSegment = '';
      if (forceNew) {
        turn.mobileUserTurn = null;
        turn.mobileAssistantTurn = null;
      }
    }
    return turn.currentVoiceExchangeId;
  }

  function _repairMobileRealtimeExchangeOrder(thread = _activeMobileThread()) {
    const list = Array.isArray(thread) ? thread : [];
    const groups = new Map();
    list.forEach((message) => {
      const groupId = String(message?.workflowGroupId || '').trim();
      if (!groupId.startsWith('voice_exchange_')) return;
      const group = groups.get(groupId) || { user: null, assistants: [] };
      if (String(message.role || '') === 'user' || String(message.workflowPart || '') === 'voice_user') {
        if (!group.user) group.user = message;
      } else if (String(message.role || '') === 'ai') {
        group.assistants.push(message);
      }
      groups.set(groupId, group);
    });
    for (const [groupId, group] of groups) {
      if (!group.user || !group.assistants.length) continue;
      const userIndex = list.indexOf(group.user);
      const assistantIndexes = group.assistants.map((message) => list.indexOf(message)).filter((index) => index >= 0);
      if (userIndex < 0 || !assistantIndexes.length || Math.min(...assistantIndexes) > userIndex) continue;
      list.splice(userIndex, 1);
      const remainingAssistantIndexes = group.assistants.map((message) => list.indexOf(message)).filter((index) => index >= 0);
      list.splice(Math.max(0, Math.min(...remainingAssistantIndexes)), 0, group.user);
      _voiceDebug?.('realtime-agent-exchange-order-repaired', { groupId });
    }
    return list;
  }

  function _ensureMobileRealtimeAgentTurnOrder(sessionId) {
    const sid = String(sessionId || '').trim();
    const thread = __pmChat.threads?.[sid];
    const userTurn = __pmRealtimeAgent.turn?.mobileUserTurn;
    const assistantTurn = __pmRealtimeAgent.turn?.mobileAssistantTurn;
    if (!Array.isArray(thread)) return false;
    if (!userTurn || !assistantTurn) {
      _repairMobileRealtimeExchangeOrder(thread);
      return false;
    }
    const userIndex = thread.indexOf(userTurn);
    const assistantIndex = thread.indexOf(assistantTurn);
    if (userIndex < 0 || assistantIndex < 0 || assistantIndex > userIndex) return false;
    thread.splice(assistantIndex, 1);
    thread.splice(thread.indexOf(userTurn) + 1, 0, assistantTurn);
    _voiceDebug('realtime-agent-turn-order-repaired', { sessionId: sid, userIndex, assistantIndex });
    return true;
  }

  function _finalizeMobileRealtimeAgentChatTurn(sessionId, role, text) {
    const sid = String(sessionId || '').trim();
    const turn = _ensureMobileRealtimeAgentChatTurn(sid, role);
    if (!turn) return null;
    if (role !== 'user') {
      const pendingEntries = _takePendingVoiceAgentProcessEntries(sid);
      if (pendingEntries.length) _appendVoiceAgentProcessEntriesToTurn(turn, pendingEntries);
    }
    const value = _cleanVoiceSpeechText(text || turn.content || turn.body?.text || '');
    if (!value) {
      const thread = __pmChat.threads?.[sid];
      if (Array.isArray(thread)) {
        const idx = thread.indexOf(turn);
        if (idx >= 0) thread.splice(idx, 1);
      }
      return null;
    }
    if (value) {
      turn.body = turn.body || (role === 'user' ? { text: '' } : { sender: 'Prometheus', text: '' });
      turn.body.text = value;
      turn.content = value;
    }
    turn.streaming = false;
    if (role === 'user') turn.voiceRealtimeLive = false;
    if (role === 'ai') {
      turn.voiceRealtimeActive = true;
      turn.voiceRealtimeHighlight = '';
      turn.voiceRealtimeProgress = Math.max(Number(turn.voiceRealtimeProgress || 0) || 0, 0.01);
      turn.voiceRealtimeFinalizedAt = Date.now();
    }
    turn.time = _nowTime();
    turn.timestamp = Number(turn.timestamp || Date.now()) || Date.now();
    return turn;
  }

  function _mobileRealtimeUserTurnForSession(sessionId = '') {
    const sid = String(sessionId || '').trim();
    const turn = __pmRealtimeAgent.turn?.mobileUserTurn;
    const thread = __pmChat?.threads?.[sid];
    return turn && Array.isArray(thread) && thread.includes(turn) ? turn : null;
  }

  function _mobileRealtimeUserTurnCanContinueAcrossPause(sessionId = '') {
    const userTurn = _mobileRealtimeUserTurnForSession(sessionId);
    const exchange = __pmRealtimeAgent.turn || {};
    const vision = __pmRealtimeAgent.liveCameraVision || {};
    return !!(
      userTurn
      && userTurn.streaming === true
      && exchange.currentVoiceExchangeHasUser === true
      && exchange.currentVoiceExchangeResponseStarted !== true
      && !__pmRealtimeAgent.activeResponse
      && !__pmVoice.realtimeSpeechActiveResponse
      && !Number(vision.responseStartedAt || 0)
    );
  }

  function _holdMobileRealtimeUserTurnOpen(sessionId, text) {
    const sid = String(sessionId || '').trim();
    const value = _cleanVoiceSpeechText(text || '');
    if (!sid || !value) return null;
    const turn = _ensureMobileRealtimeAgentChatTurn(sid, 'user');
    if (!turn) return null;
    turn.body = turn.body || { text: '', source: 'voice' };
    turn.body.text = value;
    turn.body.source = turn.body.source || 'voice';
    turn.content = value;
    turn.streaming = true;
    turn.voiceRealtimeLive = true;
    return turn;
  }

  function _finalizeMobileRealtimeUserTurn(sessionId, reason = 'response_started') {
    const sid = String(sessionId || '').trim();
    const turn = _mobileRealtimeUserTurnForSession(sid);
    const text = String(turn?.body?.text || turn?.content || '').trim();
    if (!turn || turn.streaming !== true || !text) return null;
    const finalized = _finalizeMobileRealtimeAgentChatTurn(sid, 'user', text);
    if (!finalized) return null;
    if (__pmRealtimeAgent.stagedImageTurn === finalized) __pmRealtimeAgent.stagedImageTurn = null;
    if (__pmRealtimeAgent.stagedAttachmentTurn === finalized) __pmRealtimeAgent.stagedAttachmentTurn = null;
    _persistMobileThreadSnapshot(sid);
    _renderRecent();
    _renderMobileChatSessionNow(sid);
    _notifyMobileChatVoiceUpdate(sid, { reason: `realtime_user_turn_finalized_${reason}`, force: true });
    _voiceDebug('realtime-agent-user-turn-finalized', { reason, transcriptLen: text.length });
    return finalized;
  }



  function _mobileRealtimeActiveAssistantTurn(sessionId = '') {
    const turn = __pmRealtimeAgent?.turn?.mobileAssistantTurn || null;
    const sid = String(sessionId || __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!turn || !sid) return null;
    const thread = __pmChat?.threads?.[sid];
    return Array.isArray(thread) && thread.includes(turn) ? turn : null;
  }

  function _estimateMobileRealtimeSpeechMs(text = '') {
    const words = String(text || '').replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
    return Math.max(1500, Math.min(45000, Math.round((words / 2.65) * 1000) + 450));
  }

  function _startMobileRealtimeAssistantLyricProgress(sessionId = '') {
    const sid = String(sessionId || __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!sid) return;
    const turn = _mobileRealtimeActiveAssistantTurn(sid);
    if (!turn) return;
    const pendingAudioMs = Number(__pmRealtimeAgent.turn.voiceRealtimePendingAudioMs || 0) || 0;
    if (pendingAudioMs > 0) {
      turn.voiceRealtimeAudioMs = (Number(turn.voiceRealtimeAudioMs || 0) || 0) + pendingAudioMs;
      if (!Number(turn.voiceRealtimeAudioStartedAt || 0) && Number(__pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt || 0)) {
        turn.voiceRealtimeAudioStartedAt = Number(__pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt || 0);
      }
      __pmRealtimeAgent.turn.voiceRealtimePendingAudioMs = 0;
      __pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt = 0;
    }
    const pendingMediaStartRaw = __pmRealtimeAgent.turn.voiceRealtimePendingMediaStartTime;
    const pendingMediaStart = Number(pendingMediaStartRaw);
    if (turn.voiceRealtimeMediaStartTime == null && pendingMediaStartRaw != null && Number.isFinite(pendingMediaStart)) {
      turn.voiceRealtimeMediaStartTime = pendingMediaStart;
    }
    __pmRealtimeAgent.turn.voiceRealtimePendingMediaStartTime = null;
    if (!Number(turn.voiceRealtimeAudioStartedAt || 0)) turn.voiceRealtimeAudioStartedAt = Date.now();
    // Establish this reply's playback baseline once. The media element stays live
    // for the whole conversation, so its absolute currentTime is not a reply clock.
    if (!Number.isFinite(Number(turn.voiceRealtimeMediaLastTime))) {
      const mediaNow = Number(__pmRealtimeAgent?.conn?.audio?.currentTime);
      if (Number.isFinite(mediaNow)) turn.voiceRealtimeMediaLastTime = mediaNow;
    }
    turn.voiceRealtimeActive = true;
    if (!Number.isFinite(Number(turn.voiceRealtimeProgress))) turn.voiceRealtimeProgress = 0;
    if (__pmRealtimeAgent.turn.voiceLyricTimer) return;
    __pmRealtimeAgent.turn.voiceLyricTimer = setInterval(() => {
      const activeTurn = _mobileRealtimeActiveAssistantTurn(sid);
      if (!activeTurn || !activeTurn.voiceRealtimeActive) {
        clearInterval(__pmRealtimeAgent.turn.voiceLyricTimer);
        __pmRealtimeAgent.turn.voiceLyricTimer = null;
        return;
      }
      const text = String(activeTurn.body?.text || activeTurn.content || '').trim();
      const estimatedMs = Math.max(
        Number(activeTurn.voiceRealtimeAudioMs || 0) || 0,
        _estimateMobileRealtimeSpeechMs(text),
      );
      const elapsed = _mobileRealtimeAudioPlaybackMs(activeTurn);
      const progress = Math.max(Number(activeTurn.voiceRealtimeProgress || 0) || 0, Math.min(0.98, elapsed / Math.max(1, estimatedMs)));
      activeTurn.voiceRealtimeProgress = progress;
      _setMobileVoiceLyricProgress(text, progress, 'Realtime agent is responding');
      _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_assistant_audio_progress', force: true });
    }, 180);
  }

  function _finishMobileRealtimeAssistantLyricProgress(sessionId = '', options = {}) {
    const sid = String(sessionId || __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    const turn = _mobileRealtimeActiveAssistantTurn(sid);
    if (!turn) return;
    const delayMs = Math.max(650, Math.min(2400, Number(options.delayMs || 900) || 900));
    turn.voiceRealtimeProgress = 1;
    _setMobileVoiceLyricProgress(String(turn.body?.text || turn.content || ''), 1, 'Realtime agent response');
    _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_assistant_audio_progress_done', force: true });
    setTimeout(() => {
      if (turn !== _mobileRealtimeActiveAssistantTurn(sid)) return;
      turn.voiceRealtimeActive = false;
      turn.voiceRealtimeHighlight = '';
      turn.voiceRealtimeProgress = 1;
      if (__pmRealtimeAgent.turn?.mobileAssistantTurn === turn) __pmRealtimeAgent.turn.mobileAssistantTurn = null;
      _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_assistant_audio_progress_final', force: true });
    }, delayMs);
  }

  function _noteMobileRealtimeAssistantAudioChunk(sessionId = '', int16 = null) {
    const sid = String(sessionId || __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    const turn = _mobileRealtimeActiveAssistantTurn(sid);
    const samples = int16 && typeof int16.length === 'number' ? Number(int16.length || 0) : 0;
    const chunkMs = samples > 0 ? (samples / MOBILE_XAI_REALTIME_SAMPLE_RATE) * 1000 : 0;
    if (!turn) {
      if (chunkMs > 0) {
        __pmRealtimeAgent.turn.voiceRealtimePendingAudioMs = (Number(__pmRealtimeAgent.turn.voiceRealtimePendingAudioMs || 0) || 0) + chunkMs;
        if (!Number(__pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt || 0)) __pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt = Date.now();
        if (__pmRealtimeAgent.turn.voiceRealtimePendingMediaStartTime == null) {
          const mediaTime = Number(__pmRealtimeAgent?.conn?.audio?.currentTime);
          if (Number.isFinite(mediaTime)) __pmRealtimeAgent.turn.voiceRealtimePendingMediaStartTime = mediaTime;
        }
      }
      return;
    }
    turn.voiceRealtimeAudioMs = Math.max(Number(turn.voiceRealtimeAudioMs || 0) || 0, 0) + Math.max(0, chunkMs);
    turn.voiceRealtimeAudioLastAt = Date.now();
    if (!Number(turn.voiceRealtimeAudioStartedAt || 0)) turn.voiceRealtimeAudioStartedAt = Date.now();
    if (turn.voiceRealtimeMediaStartTime == null) {
      const mediaTime = Number(__pmRealtimeAgent?.conn?.audio?.currentTime);
      if (Number.isFinite(mediaTime)) turn.voiceRealtimeMediaStartTime = mediaTime;
    }
    if (!Number.isFinite(Number(turn.voiceRealtimeMediaLastTime))) {
      const mediaTime = Number(__pmRealtimeAgent?.conn?.audio?.currentTime);
      if (Number.isFinite(mediaTime)) turn.voiceRealtimeMediaLastTime = mediaTime;
    }
    _startMobileRealtimeAssistantLyricProgress(sid);
  }

  function _mobileRealtimeTranscriptItemId(event = {}) {
    return String(event?.item_id || event?.item?.id || event?.previous_item_id || '').trim();
  }

  function _mobileRealtimeTranscriptWordCount(text = '') {
    return String(text || '').replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  }

  function _chooseMobileRealtimeFinalUserTranscript(eventTranscript = '', liveTranscript = '') {
    const eventText = String(eventTranscript || '').replace(/\s+/g, ' ').trim();
    const liveText = String(liveTranscript || '').replace(/\s+/g, ' ').trim();
    if (!eventText) return liveText;
    if (!liveText) return eventText;
    const eventWords = _mobileRealtimeTranscriptWordCount(eventText);
    const liveWords = _mobileRealtimeTranscriptWordCount(liveText);
    const eventKey = _normalizeVoiceEchoText(eventText);
    const liveKey = _normalizeVoiceEchoText(liveText);
    if (eventKey && liveKey && eventKey === liveKey) return eventText;
    if (liveWords >= 2 && eventWords <= 1 && liveText.length >= eventText.length + 3) return liveText;
    if (liveWords > eventWords && liveText.length >= eventText.length + 8) return liveText;
    if (eventWords > liveWords && eventText.length >= liveText.length + 8) return eventText;
    return eventText.length >= liveText.length ? eventText : liveText;
  }

  function _isProgressiveMobileRealtimeTranscript(previous = '', next = '') {
    const before = _normalizeVoiceEchoText(previous);
    const after = _normalizeVoiceEchoText(next);
    if (!before || !after || before === after) return false;
    return after.startsWith(`${before} `) || before.startsWith(`${after} `);
  }

  function _shouldIgnoreMobileRealtimeTranscriptForCurrentTurn(event = {}, type = '') {
    const itemId = _mobileRealtimeTranscriptItemId(event);
    if (!itemId) return false;
    const turn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
    const current = String(turn.currentUserTranscriptItemId || '').trim();
    if (!current) {
      turn.currentUserTranscriptItemId = itemId;
      return false;
    }
    if (__pmRealtimeAgent.quiet?.active && current !== itemId) {
      // Quiet mode intentionally listens across many independent utterances.
      // Treat each AVAS item as the new wake candidate instead of rejecting i
      // as a stale duplicate from the prior quiet utterance.
      turn.currentUserTranscriptItemId = itemId;
      turn.currentUserSpeechStartedAt = Date.now();
      return false;
    }
    const startedAt = Number(turn.currentUserSpeechStartedAt || 0);
    const withinCurrentSpeechWindow = startedAt > 0 && Date.now() - startedAt < 18000;
    if (current !== itemId && withinCurrentSpeechWindow) {
      _voiceDebug('realtime-agent-stale-transcript-ignored', { type, itemId, currentItemId: current });
      return true;
    }
    return false;
  }

  function _mobileCodexBridgeTranscriptRole(params = {}) {
    const entry = params?.entry || params?.transcript || params?.item || params?.message || params || {};
    const role = String(params?.role || entry?.role || entry?.speaker || entry?.participant || entry?.item?.role || '').toLowerCase();
    return /^(user|human|input)$/.test(role) ? 'user' : 'ai';
  }

  function _mobileCodexBridgeEventText(value = {}) {
    const entry = value?.entry || value?.transcript || value?.item || value?.message || value || {};
    const candidates = [
      entry?.transcript, entry?.text, entry?.delta, entry?.content, entry?.output_text, entry?.audio_transcript,
      entry?.item?.transcript, entry?.item?.text, entry?.item?.content,
    ];
    if (Array.isArray(entry?.content)) candidates.push(...entry.content.map((part) => part?.transcript || part?.text || part?.content));
    return candidates
      .filter((candidate) => typeof candidate === 'string')
      .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
      .sort((a, b) => b.length - a.length)[0] || '';
  }

  function _normalizeMobileCodexBridgeRealtimeTranscript(notification = {}) {
    const method = String(notification?.method || '');
    const params = notification?.params || {};
    if (method === 'thread/realtime/tool/call') {
      return {
        type: 'response.function_call_arguments.done',
        call_id: String(params?.requestId || params?.callId || ''),
        name: String(params?.tool || ''),
        arguments: JSON.stringify(params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}),
        __prometheusCodexBridge: true,
        __prometheusCodexToolCall: true,
      };
    }
    if (/(?:handoff[\/_-]?requested|handoff_request)$/i.test(method)) {
      return { ...params, type: 'handoff_request', __prometheusCodexBridge: true };
    }
    if (!/^thread\/realtime\/transcript\/(?:delta|done)$/.test(method)) return null;
    const entry = params?.entry || params?.transcript || params?.item || params?.message || params;
    const role = _mobileCodexBridgeTranscriptRole(params);
    const done = /\/done$/.test(method);
    const text = _mobileCodexBridgeEventText(entry) || _mobileCodexBridgeEventText(params);
    if (!text) return null;
    return {
      ...entry,
      type: role === 'user'
        ? `conversation.item.input_audio_transcription.${done ? 'completed' : 'delta'}`
        : `response.audio_transcript.${done ? 'done' : 'delta'}`,
      role,
      item: { ...(entry?.item || {}), role },
      ...(done ? { transcript: text } : { delta: text }),
      __prometheusCodexBridge: true,
    };
  }

  function _shouldApplyMobileCodexBridgeTranscriptFallback(event = {}) {
    if (!event?.__prometheusCodexBridge) return true;
    if (event?.__prometheusCodexToolCall) return true;
    const type = String(event?.type || '');
    if (type === 'handoff_request') return true;
    const user = type.startsWith('conversation.item.input_audio_transcription');
    const done = /(?:completed|\.done)$/.test(type);
    const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const incoming = clean(_mobileCodexBridgeEventText(event));
    const live = clean(user ? __pmRealtimeAgent.turn.liveUserTranscript : __pmRealtimeAgent.turn.liveAssistantTranscript);
    const final = clean(user ? __pmRealtimeAgent.turn.lastUserTranscript : __pmRealtimeAgent.turn.lastAssistantTranscript);
    // WebRTC transcript events render alongside the first spoken audio. The
    // app-server feed is only a fallback so it cannot replay a delayed copy.
    if (!done) return !live;
    const current = live || final;
    if (incoming && current && (incoming === current || current.includes(incoming))) return false;
    return true;
  }

  function _sendMobileCodexV3HandoffOutput(handoffId, outputText) {
    const dc = __pmRealtimeAgent?.conn?.dc;
    const id = String(handoffId || '').trim();
    if (!id || !dc || dc.readyState !== 'open') return false;
    try {
      dc.send(JSON.stringify({
        type: 'conversation.handoff.append',
        handoff_id: id,
        output_text: String(outputText || '').slice(0, 12000),
      }));
      return true;
    } catch (err) {
      _voiceDebug('codex-v3-handoff-output-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  async function _handleMobileCodexV3HandoffRequest(event, sessionId) {
    const conn = __pmRealtimeAgent?.conn;
    const handoffId = String(event?.handoff_id || event?.handoffId || event?.id || '').trim();
    if (!conn || !handoffId) return;
    const seen = conn.codexV3Handoffs || (conn.codexV3Handoffs = new Set());
    if (seen.has(handoffId)) return;
    seen.add(handoffId);
    if (seen.size > 64) seen.delete(seen.values().next().value);
    const transcript = _cleanVoiceSpeechText(String(
      event?.active_transcript || event?.input_transcript || _mobileCodexBridgeEventText(event) || '',
    ));
    if (!transcript) {
      _sendMobileCodexV3HandoffOutput(handoffId, 'Prometheus could not recover the spoken request. Ask the user to repeat it briefly.');
      return;
    }

    const trace = _startMobileRealtimeAgentToolTrace(sessionId, 'prometheus_voice_handoff', { task: transcript }, {
      source: 'codex_v3_client_managed_handoff',
    });
    const recent = _addRealtimeAgentRecentCommand('prometheus_voice_handoff', { task: transcript });
    __pmVoice.showToolStatus?.('Prometheus handoff', 'Prometheus is handling this request');
    try {
      if (typeof __pmRealtimeAgent.submitToWorker !== 'function') throw new Error('Prometheus chat runtime is unavailable.');
      _removeMobileRealtimeAgentChatTurn(sessionId, 'user', transcript);
      const result = await __pmRealtimeAgent.submitToWorker(transcript, {
        source: 'codex_v3_client_managed_handoff',
        skipVoiceAgentHandoff: true,
        visibleTranscript: transcript,
      });
      const ok = result !== false;
      const summary = ok ? 'Prometheus accepted the request and is streaming the work in chat.' : 'Prometheus did not accept the request.';
      _finishMobileRealtimeAgentToolTrace(sessionId, trace, 'prometheus_voice_handoff', { task: transcript }, ok, summary, {
        source: 'codex_v3_client_managed_handoff',
      });
      _finishRealtimeAgentRecentCommand(recent, ok, summary);
      _sendMobileCodexV3HandoffOutput(handoffId, summary);
    } catch (err) {
      const message = String(err?.message || err || 'The Prometheus handoff failed.');
      _finishMobileRealtimeAgentToolTrace(sessionId, trace, 'prometheus_voice_handoff', { task: transcript }, false, message, {
        source: 'codex_v3_client_managed_handoff',
      });
      _finishRealtimeAgentRecentCommand(recent, false, message);
      _sendMobileCodexV3HandoffOutput(handoffId, `Prometheus could not complete that action: ${message}`);
    }
  }

  function _stopMobileCodexBridgeRealtimeEventPoll() {
    const poll = __pmRealtimeAgent?.codexBridgeEventPoll;
    if (poll?.timer) clearInterval(poll.timer);
    if (poll?.conn) poll.conn.codexBridgeEventAfterId = Number(poll.afterId || 0) || 0;
    if (__pmRealtimeAgent) __pmRealtimeAgent.codexBridgeEventPoll = null;
  }

  function _startMobileCodexBridgeRealtimeEventPoll(conn) {
    _stopMobileCodexBridgeRealtimeEventPoll();
    const bridgeSessionId = String(conn?.codexBridgeSessionId || '').trim();
    if (!bridgeSessionId) return;
    const poll = {
      conn,
      bridgeSessionId,
      afterId: Number(conn?.codexBridgeEventAfterId || 0) || 0,
      fetching: false,
      timer: null,
    };
    const handleBridgeNotification = (notification) => {
      const method = String(notification?.method || '').trim();
      const params = notification?.params || {};
      if (method === 'thread/realtime/started') {
        const realtimeSessionId = String(params?.realtimeSessionId || '').trim();
        if (realtimeSessionId) conn.realtimeSessionId = realtimeSessionId;
        _markMobileRealtimeAgentBackendReady(conn, {
          source: method,
          ...(realtimeSessionId ? { realtimeSessionId } : {}),
        });
        return;
      }
      if (method === 'thread/realtime/error' && conn.backendReady !== true) {
        const message = String(params?.message || params?.error?.message || 'Realtime voice session failed.').trim();
        _voiceDebug('codex-bridge-realtime-error-before-ready', {
          sessionId: String(conn.sessionId || ''),
          message,
        });
        if (__pmRealtimeAgent?.conn === conn) {
          _notifyMobileVoiceAgentConnection('error', {
            sessionId: String(conn.sessionId || ''),
            message,
          });
        }
      }
    };
    const run = async () => {
      if (poll.fetching || __pmRealtimeAgent?.conn !== conn) return;
      poll.fetching = true;
      try {
        const data = await mobileGatewayFetch(`/api/realtime/codex-bridge/events?sessionId=${encodeURIComponent(bridgeSessionId)}&afterId=${encodeURIComponent(poll.afterId)}`, { method: 'GET' });
        if (!data?.success) return;
        for (const notification of (Array.isArray(data?.events) ? data.events : [])) {
          poll.afterId = Math.max(poll.afterId, Number(notification?.id || 0) || 0);
          handleBridgeNotification(notification);
          const event = _normalizeMobileCodexBridgeRealtimeTranscript(notification);
          if (event && _shouldApplyMobileCodexBridgeTranscriptFallback(event)) await _handleMobileRealtimeAgentEvent(event, conn.sessionId);
        }
        poll.afterId = Math.max(poll.afterId, Number(data?.latestId || 0) || 0);
        conn.codexBridgeEventAfterId = poll.afterId;
      } catch (err) {
        _voiceDebug('codex-bridge-transcript-relay-failed', { message: err?.message || String(err) });
      } finally {
        poll.fetching = false;
      }
    };
    poll.timer = setInterval(run, 350);
    __pmRealtimeAgent.codexBridgeEventPoll = poll;
    if (conn.backendReady === true) _markMobileRealtimeAgentBackendReady(conn, { source: 'bridge_session_result' });
    run();
  }

  async function _handleMobileRealtimeAgentEvent(event, sessionId) {
    sessionId = _mobileRealtimeAgentEffectiveSessionId(sessionId);
    const type = String(event?.type || '');
    const _eventTextCandidates = (value = event) => {
      const parts = [];
      const seen = new Set();
      const push = (v) => {
        if (v == null || (typeof v === 'object' && !Array.isArray(v))) return;
        if (Array.isArray(v)) return;
        const t = String(v || '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        parts.push(t);
      };
      ['transcript', 'text', 'delta', 'content', 'output_text', 'audio_transcript'].forEach((key) => push(value?.[key]));
      const item = value?.item || value?.response || value?.message || null;
      ['transcript', 'text', 'delta', 'content', 'output_text', 'audio_transcript'].forEach((key) => push(item?.[key]));
      const content = Array.isArray(item?.content) ? item.content : (Array.isArray(value?.content) ? value.content : []);
      content.forEach((part) => ['transcript', 'text', 'delta', 'content', 'output_text', 'audio_transcript'].forEach((key) => push(part?.[key])));
      return parts;
    };
    const _eventText = (value = event, options = {}) => {
      const parts = _eventTextCandidates(value);
      if (!parts.length) return '';
      if (options.preferLongest) {
        return [...parts].sort((a, b) => b.length - a.length)[0] || '';
      }
      return parts[0] || '';
    };
    _voiceDebug('realtime-agent-event', {
      type,
      info: type === 'error' ? (event?.error?.message || event?.error) : (event?.transcript ?? event?.delta ?? undefined),
      itemType: event?.item?.type || '',
      responseStatus: event?.response?.status || '',
      keys: event && typeof event === 'object' ? Object.keys(event).slice(0, 12) : [],
    });
    if (type === 'handoff_request') {
      if (__pmRealtimeAgent?.conn?.transport === 'codex_app_server') return;
      await _handleMobileCodexV3HandoffRequest(event, sessionId);
      return;
    }
    if (type === 'response.audio.delta' || type === 'response.output_audio.delta') {
      const b64 = String(event?.delta || event?.audio || '');
      if (b64) {
        const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
        const byteLength = Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
        _noteMobileRealtimeAssistantAudioChunk(sessionId, { length: Math.floor(byteLength / 2) });
      }
    }
    if (type === 'response.created') {
      const cameraState = _mobileRealtimeLiveVisionState();
      const xaiVisionInjectionAgeMs = cameraState.xaiVisionInjectionA
        ? Math.max(0, Date.now() - Number(cameraState.xaiVisionInjectionAt || 0))
        : Infinity;
      const xaiVisionResponse = String(__pmRealtimeAgent.conn?.provider || '') === 'xai'
        && !cameraState.responseGateActive
        && !cameraState.audioCommitted
        && !cameraState.responseRequestedA
        && xaiVisionInjectionAgeMs <= 15_000
        && (__pmRealtimeAgent.turn?.xaiVisionInjecting || cameraState.xaiVisionInjectionAt);
      const cameraGateRace = cameraState.responseGateActive && cameraState.phase !== 'response_ready';
      cameraState.responseStartedAt = Date.now();
      _voiceDebug('realtime-agent-model-inference-start', {
        provider: __pmRealtimeAgent.conn?.provider || 'openai_webrtc',
        cameraTurnId: cameraState.turnId || 0,
        cameraGateRace,
        requestToInferenceMs: cameraState.responseRequestedA
          ? Math.max(0, cameraState.responseStartedAt - cameraState.responseRequestedAt)
          : 0,
        cameraFrameAt: cameraState.lastAssociatedFrameAt || 0,
        cameraFrameId: cameraState.lastAssociatedFrameId || '',
        cameraFrameCapturedAt: cameraState.lastAssociatedCapturedAt || 0,
      });
      // xAI can open a response while the vision-sidecar text item is still
      // being accepted. That response is cancelled below; it is not the user's
      // spoken reply. Preserve an explicit resume request so the live camera
      // timer does not die permanently after its first injected frame.
      cameraState.resumeAfterXaiVisionResponse = xaiVisionResponse
        && _mobileRealtimeXaiLiveCameraCanResume();
      _stopMobileRealtimeLiveCameraVision(xaiVisionResponse ? 'xai_vision_response_created' : 'response_created', {
        preserveCameraSession: _mobileRealtimeCameraSessionIsOpen(),
      });
      _finalizeMobileRealtimeUserTurn(sessionId, 'response_created');
      if (cameraGateRace) {
        // The server can beat the session.update(create_response:false) packe
        // on a fast VAD turn. Cancelling here strands the user with a transcrip
        // but no reply. The generation was already stopped above, so any late
        // camera work is rejected; let this response finish as best-effort text.
        _voiceDebug('realtime-agent-model-request-camera-gate-race-fallback', {
          cameraTurnId: cameraState.turnId || 0,
        });
      }
      if (
        String(__pmRealtimeAgent.conn?.provider || '') === 'xai'
        && __pmRealtimeAgent.turn?.xaiVisionInjecting
        && !cameraGateRace
      ) {
        try { __pmRealtimeAgent.conn?.dc?.send?.(JSON.stringify({ type: 'response.cancel' })); } catch {}
        try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
        _voiceDebug('realtime-agent-xai-premature-response-cancelled-for-vision', {
          reason: __pmRealtimeAgent.turn?.xaiVisionInjectReason || cameraState.xaiVisionInjectionReason || '',
        });
        return;
      }
      __pmRealtimeAgent.activeResponse = true;
      const exchangeTurn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
      if (!String(exchangeTurn.currentVoiceExchangeId || '').trim() || exchangeTurn.currentVoiceExchangeResponseStarted === true) {
        _ensureMobileRealtimeExchangeId({ forceNew: true });
      }
      exchangeTurn.currentVoiceExchangeResponseStarted = true;
      __pmRealtimeAgent.turn.hadFunctionCall = false;
      __pmRealtimeAgent.turn.dispatchedWorkerThisResponse = false;
      __pmRealtimeAgent.turn.lastAssistantTranscript = '';
      __pmRealtimeAgent.turn.liveAssistantTranscript = '';
      __pmRealtimeAgent.turn.mobileAssistantTurn = null;
      if (__pmRealtimeAgent.turn.voiceLyricTimer) {
        clearInterval(__pmRealtimeAgent.turn.voiceLyricTimer);
        __pmRealtimeAgent.turn.voiceLyricTimer = null;
      }
      __pmRealtimeAgent.turn.voiceRealtimePendingAudioMs = 0;
      __pmRealtimeAgent.turn.voiceRealtimePendingAudioStartedAt = 0;
      __pmRealtimeAgent.turn.voiceRealtimePendingMediaStartTime = null;
      if (__pmRealtimeAgent.quiet.active) {
        __pmRealtimeAgent.quiet.suppressResponse = true;
        if (_isMobileCodexV3RealtimeConnection()) {
          const quietAudio = __pmRealtimeAgent.conn?.audio;
          if (quietAudio) {
            quietAudio.muted = true;
            quietAudio.volume = 0;
          }
          _setMobileRealtimeAgentMicEnabled(true);
        }
        try { __pmRealtimeAgent.conn?.playback?.interrupt?.(); } catch {}
        _voiceDebug('realtime-agent-quiet-response-suppressed', { type });
        return;
      }
      _suspendMobileRealtimeInputForOutput('response_created');
      _startMobileRealtimeAssistantLyricProgress(sessionId);
      _voiceShowRealtimeAgentMessage('', 'Realtime agent is responding');
      __pmRealtimeAgent.turn.subagentVoiceReplyLogKey = '';
      return;
    }
    if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
      __pmRealtimeAgent.turn.hadFunctionCall = true;
      const callId = String(event.item.call_id || '').trim();
      const name = String(event.item.name || '').trim();
      const toolKey = _mobileVoiceToolKey({ call_id: callId, name }, name);
      const toolLabel = _mobileToolLabel({ name: event.item.name });
      if (!__pmRealtimeAgent.quiet.active) {
        _setMobileVoiceToolActive(true, toolKey, { call_id: callId, name });
        _startMobileRealtimeAgentToolTrace(sessionId, name, {}, { callId, source: 'realtime_agent_output_item' });
        __pmVoice.showToolStatus?.(toolLabel, 'Using tool');
      }
      if (callId) __pmRealtimeAgent.functionCallBuffers.set(callId, { name, argsStr: '' });
      return;
    }
    if (type === 'response.function_call_arguments.delta') {
      const callId = String(event.call_id || '').trim();
      if (!callId) return;
      const buf = __pmRealtimeAgent.functionCallBuffers.get(callId) || { name: '', argsStr: '' };
      buf.argsStr += String(event.delta || '');
      __pmRealtimeAgent.functionCallBuffers.set(callId, buf);
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      const callId = String(event.call_id || '').trim();
      const name = String(event.name || __pmRealtimeAgent.functionCallBuffers.get(callId)?.name || '').trim();
      const argsStr = String(event.arguments || __pmRealtimeAgent.functionCallBuffers.get(callId)?.argsStr || '');
      __pmRealtimeAgent.functionCallBuffers.delete(callId);
      let args = {};
      try { args = argsStr ? JSON.parse(argsStr) : {}; } catch {}
      const toolKey = _mobileVoiceToolKey({ call_id: callId, name }, name);
      if (__pmRealtimeAgent.quiet.active) {
        _setMobileVoiceToolActive(false, toolKey, { call_id: callId, name });
        _voiceDebug('realtime-agent-quiet-tool-call-suppressed', { name });
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
          ok: false,
          suppressed: true,
          error: 'Quiet mode is active. No tool was executed.',
        }), { createResponse: false });
        return;
      }
      _setMobileVoiceToolActive(true, toolKey, { call_id: callId, name });
      _startMobileRealtimeAgentToolTrace(sessionId, name, args, { callId, source: 'realtime_agent_arguments_done' });
      let toolError = null;
      try {
        await _executeMobileRealtimeAgentFunctionCall({ call_id: callId, name, args }, sessionId);
      } catch (error) {
        toolError = error;
        _voiceDebug('realtime-agent-tool-execution-failed', { name, message: error?.message || String(error) });
      }
      _setMobileVoiceToolActive(false, toolKey, { call_id: callId, name });
      __pmVoice.showToolStatus?.(
        `${_mobileToolLabel({ name })} ${toolError ? 'failed' : 'complete'}`,
        toolError ? 'Tool failed' : 'Tool finished',
      );
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.delta' || type === 'conversation.item.input_audio_transcription.updated') {
      if (_shouldIgnoreMobileRealtimeTranscriptForCurrentTurn(event, type)) return;
      // Codex AVAS v3 relays transcript deltas rather than public
      // input_audio_buffer.speech_started events. The first real delta is the
      // signal that the user is actually speaking, so start live vision here.
      if (event?.__prometheusCodexBridge) {
        _startMobileRealtimeLiveCameraVision('codex_transcription_delta');
        if (__pmRealtimeAgent.pendingImages.length) {
          const cameraState = _mobileRealtimeLiveVisionState();
          const attachmentPreparation = _flushMobileRealtimeAgentPendingImages('codex_transcription_delta', {
            turnId: _mobileRealtimeLiveVisionState().turnId,
          }).catch(() => false);
          cameraState.pendingAttachmentPreparation = attachmentPreparation;
          attachmentPreparation.finally(() => {
            if (cameraState.pendingAttachmentPreparation === attachmentPreparation) cameraState.pendingAttachmentPreparation = null;
          }).catch(() => {});
        }
      }
      if (!String(__pmRealtimeAgent.turn.liveUserTranscript || '').trim()) {
        _releaseMobileVoiceRoomHandoffAckGuard('next_user_utterance');
      }
      const pauseTurn = _mobileRealtimeUserTurnCanContinueAcrossPause(sessionId);
      if (pauseTurn && !String(__pmRealtimeAgent.turn.liveUserTranscript || '').trim()) {
        const existingText = String(pauseTurn.body?.text || pauseTurn.content || '').replace(/\s+/g, ' ').trim();
        __pmRealtimeAgent.turn.currentUserTranscriptPrefix = existingText;
        __pmRealtimeAgent.turn.currentUserTranscriptSegment = '';
        __pmRealtimeAgent.turn.liveUserTranscript = existingText;
        _voiceDebug('realtime-agent-user-turn-resume-without-speech-start', { transcriptLen: existingText.length });
      }
      const isSnapshot = type.endsWith('.updated');
      const delta = isSnapshot
        ? _eventText(event, { preferLongest: true })
        : (_mobileRealtimeRawTranscriptDelta(event) || _eventText(event));
      if (delta) {
        const turn = __pmRealtimeAgent.turn;
        if (isSnapshot) {
          turn.liveUserTranscript = _mergeMobileRealtimeTranscriptSnapshot(turn, delta);
        } else if (String(turn.currentUserTranscriptPrefix || '').trim()) {
          const nextSegment = _appendMobileRealtimeTranscriptDelta(turn.currentUserTranscriptSegment || '', delta);
          turn.currentUserTranscriptSegment = nextSegment;
          turn.liveUserTranscript = _appendMobileRealtimeTranscriptDelta(turn.currentUserTranscriptPrefix, nextSegment);
        } else {
          turn.liveUserTranscript = _appendMobileRealtimeTranscriptDelta(turn.liveUserTranscript || '', delta);
        }
        if (!__pmRealtimeAgent.quiet.active) {
          _voiceShowRealtimeUserTranscript(__pmRealtimeAgent.turn.liveUserTranscript, 'Realtime transcript');
        }
        _voiceDebug('realtime-agent-user-transcript-delta', { textLen: String(__pmRealtimeAgent.turn.liveUserTranscript || '').length, type, itemId: _mobileRealtimeTranscriptItemId(event) });
      }
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      if (_shouldIgnoreMobileRealtimeTranscriptForCurrentTurn(event, type)) return;
      const eventTranscript = String(_eventText(event, { preferLongest: true }) || '').trim();
      const liveTranscript = String(__pmRealtimeAgent.turn.liveUserTranscript || '').trim();
      let transcript = _chooseMobileRealtimeFinalUserTranscript(eventTranscript, liveTranscript);
      if (eventTranscript && liveTranscript && transcript !== eventTranscript) {
        _voiceDebug('realtime-agent-user-transcript-live-preferred', { eventLen: eventTranscript.length, liveLen: liveTranscript.length, itemId: _mobileRealtimeTranscriptItemId(event) });
      }
      if (transcript) {
        if (_shouldIgnoreMobileRealtimeAgentTranscriptEvent(sessionId, event, transcript)) {
          __pmRealtimeAgent.turn.liveUserTranscript = '';
          return;
        }
        if (_consumeMobileVoiceRoomHandoffEcho(transcript, sessionId)) {
          __pmRealtimeAgent.turn.liveUserTranscript = '';
          return;
        }
        const roomRoute = await _routeMobileVoiceRoomTranscript(transcript, {
          submit: (roomText, roomOptions = {}) => {
            if (typeof __pmRealtimeAgent.submitToWorker !== 'function') return Promise.resolve(false);
            return __pmRealtimeAgent.submitToWorker(roomText, { ...roomOptions, roomRouted: true });
          },
        });
        if (roomRoute.handled) {
          __pmRealtimeAgent.turn.liveUserTranscript = '';
          _clearMobileRealtimeAgentPendingCreateResponse();
          return;
        }
        _releaseMobileVoiceRoomHandoffAckGuard('same_agent_turn');
        if (_handleMobileRealtimeAgentQuietTranscript(transcript)) {
          __pmRealtimeAgent.turn.liveUserTranscript = '';
          return;
        }
        if (__pmVoice.tryHandleApprovalIntent?.(transcript, { source: 'realtime_agent' })) {
          __pmRealtimeAgent.turn.liveUserTranscript = '';
          return;
        }
        const previousTranscript = String(__pmRealtimeAgent.turn.lastUserTranscript || '').trim();
        const progressiveTranscript = _isProgressiveMobileRealtimeTranscript(previousTranscript, transcript);
        if (progressiveTranscript && previousTranscript.length > transcript.length) transcript = previousTranscript;
        if (transcript !== previousTranscript) {
          _clearMobileRealtimeAgentQueuedFinalSummary('new_user_transcript');
        }
        const continueCurrentUserTurn = _mobileRealtimeUserTurnCanContinueAcrossPause(sessionId);
        const needsNewExchange = !!(
          !continueCurrentUserTurn
          &&
          __pmRealtimeAgent.turn.currentVoiceExchangeHasUser
          && transcript !== previousTranscript
          && !progressiveTranscript
        );
        if (progressiveTranscript) {
          _voiceDebug('realtime-agent-progressive-user-transcript', {
            previousLen: previousTranscript.length,
            nextLen: transcript.length,
          });
        }
        _ensureMobileRealtimeExchangeId({ forceNew: needsNewExchange });
        __pmRealtimeAgent.turn.lastUserTranscript = transcript;
        __pmRealtimeAgent.turn.currentVoiceExchangeHasUser = true;
        _voiceShowRealtimeUserTranscript(transcript, 'Realtime transcript');
        __pmRealtimeAgent.turn.liveUserTranscript = '';
        __pmRealtimeAgent.turn.currentUserTranscriptPrefix = '';
        __pmRealtimeAgent.turn.currentUserTranscriptSegment = '';
        __pmRealtimeAgent.turn.nudged = false;
        _voiceDebug('realtime-agent-user-transcript', { transcript });
        // Surface what the user said. Subagent voice targets are persisted through
        // the subagent chat store instead of the main mobile chat thread.
        try {
          const sid = sessionId;
          const rawStaged = __pmRealtimeAgent.stagedAttachmentTurn || __pmRealtimeAgent.stagedImageTurn;
          const staged = _mobileRealtimeCurrentStagedAttachmentTurn(sid);
          const associatedCameraTurnId = Number(_mobileRealtimeLiveVisionState().lastAssociatedTurnId || 0) || 0;
          const stagedCameraTurnId = Number(rawStaged?._pmCameraTurnId || 0) || 0;
          const stagedBelongsToCurrentTurn = !stagedCameraTurnId || !!staged;
          const subagentTarget = _currentMobileSubagentVoiceTarget();
          const keepUserTurnOpen = continueCurrentUserTurn;
          if (subagentTarget) {
            _voiceDebug('realtime-agent-subagent-user-transcript', { agentId: subagentTarget.agentId, transcript });
          } else if (rawStaged && !staged && !stagedBelongsToCurrentTurn) {
            // A late frame from the previous response must never become the
            // attachment for this transcript. Leave its already-visible preview
            // in history, but detach it from the next turn's staging pointer.
            _voiceDebug('realtime-agent-live-camera-staged-frame-not-current', {
              stagedCameraTurnId,
              associatedCameraTurnId,
              transcriptLen: transcript.length,
            });
            __pmRealtimeAgent.stagedImageTurn = null;
            __pmRealtimeAgent.stagedAttachmentTurn = null;
            if (keepUserTurnOpen) _holdMobileRealtimeUserTurnOpen(sid, transcript);
            else {
              _finalizeMobileRealtimeAgentChatTurn(sid, 'user', transcript);
              _ensureMobileRealtimeAgentTurnOrder(sid);
            }
          } else if (staged && Array.isArray(__pmChat.threads?.[sid]) && __pmChat.threads[sid].includes(staged)) {
            // The user just spoke about a staged photo — attach the transcript to the
            // photo bubble so the image + caption show as one user message.
            staged.body = staged.body || { text: '', attachments: [] };
            staged.body.text = transcript;
            staged.content = transcript;
            staged.streaming = keepUserTurnOpen;
            staged.voiceRealtimeLive = keepUserTurnOpen;
            staged.staged = false;
            if (!keepUserTurnOpen) staged.time = _nowTime();
            staged.workflowGroupId = staged.workflowGroupId || _ensureMobileRealtimeExchangeId();
            staged.workflowPart = 'voice_user';
            __pmRealtimeAgent.turn.mobileUserTurn = staged;
            __pmRealtimeAgent.stagedImageTurn = null;
            __pmRealtimeAgent.stagedAttachmentTurn = null;
          } else {
            if (keepUserTurnOpen) {
              _holdMobileRealtimeUserTurnOpen(sid, transcript);
              _voiceDebug('realtime-agent-user-turn-held-open', { transcriptLen: transcript.length });
            } else {
              _finalizeMobileRealtimeAgentChatTurn(sid, 'user', transcript);
              // Realtime can emit response text before its final input transcript.
              // Keep the pair in conversational order even when those event streams
              // arrive out of order.
              _ensureMobileRealtimeAgentTurnOrder(sid);
            }
          }
          _persistMobileThreadSnapshot(sid);
          _renderRecent();
          _renderMobileChatSessionNow(sid);
          _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_user_transcript', force: true });
          _consumeMobileRealtimeAgentPendingFiles('realtime_user_transcript');
        } catch {}
        const pendingResponse = __pmRealtimeAgent.pendingCreateResponse;
        const shouldGateResponse = !!(
          pendingResponse
          && Date.now() - Number(pendingResponse.createdAt || 0) >= 0
          && Date.now() - Number(pendingResponse.createdAt || 0) < 2500
        );
        if (shouldGateResponse) {
          await _injectMobileRealtimeAgentSkillContext(sessionId, transcript, { reason: 'ptt_transcript' });
          _finishMobileRealtimeAgentPendingResponse('ptt_transcript_ready');
        } else {
          _injectMobileRealtimeAgentSkillContext(sessionId, transcript, { reason: 'transcript_observed' }).catch(() => {});
        }
      }
      return;
    }
    if ((type === 'conversation.item.created' || type === 'conversation.item.done' || type === 'conversation.item.completed') && String(event?.item?.role || '').toLowerCase() === 'user') {
      const transcript = _eventText(event, { preferLongest: true });
      if (transcript && !String(__pmRealtimeAgent.turn.lastUserTranscript || '').trim()) {
        __pmRealtimeAgent.turn.liveUserTranscript = _chooseMobileRealtimeFinalUserTranscript(transcript, __pmRealtimeAgent.turn.liveUserTranscript || '');
        _voiceShowRealtimeUserTranscript(__pmRealtimeAgent.turn.liveUserTranscript, 'Realtime transcript');
      }
      return;
    }
    if (
      type === 'response.audio_transcript.delta'
      || type === 'response.output_audio_transcript.delta'
      || type === 'response.text.delta'
      || type === 'response.output_text.delta'
      || type === 'response.content_part.delta'
    ) {
      if (__pmRealtimeAgent.quiet.active || __pmRealtimeAgent.quiet.suppressResponse || __pmRealtimeAgent.turn.suppressAssistantTranscript) return;
      // `_eventText` normalizes/trim()s its result for completed messages.  A
      // Realtime transcript delta often carries the leading token whitespace, so
      // using it here made streamed text render as "Surething.Doyou..." until the
      // final transcript replaced it.
      const rawDelta = _mobileRealtimeRawTranscriptDelta(event);
      const delta = rawDelta || _eventText(event);
      if (delta) {
        const ackProbe = _appendMobileRealtimeTranscriptDelta(
          __pmRealtimeAgent.turn.liveAssistantTranscript || '',
          delta,
        );
        if (
          _armMobileVoiceRoomHandoffAckGuard(ackProbe)
          || __pmRealtimeAgent.turn.roomHandoffAckGuard
        ) return;
        const liveTranscript = _appendMobileRealtimeTranscriptDelta(
          __pmRealtimeAgent.turn.liveAssistantTranscript || '',
          delta,
        );
        __pmRealtimeAgent.turn.liveAssistantTranscript = liveTranscript;
        _voiceShowRealtimeAgentMessage(liveTranscript, 'Realtime agent is responding', { highlight: delta });
        if (_currentMobileSubagentVoiceTarget()) return;
        const turn = _ensureMobileRealtimeAgentChatTurn(sessionId, 'ai');
        if (turn) {
          turn.body.text = _appendMobileRealtimeTranscriptDelta(turn.body?.text || '', delta);
          turn.content = String(turn.body.text || '');
          turn.voiceRealtimeActive = true;
          turn.voiceRealtimeHighlight = '';
          turn.voiceRealtimeUpdatedAt = Date.now();
          if (!Number.isFinite(Number(turn.voiceRealtimeProgress))) turn.voiceRealtimeProgress = 0;
          _startMobileRealtimeAssistantLyricProgress(sessionId);
          _notifyMobileChatVoiceUpdate(sessionId, { reason: 'realtime_assistant_transcript_delta', force: true });
        }
      }
      return;
    }
    if (
      type === 'response.audio_transcript.done'
      || type === 'response.output_audio_transcript.done'
      || type === 'response.text.done'
      || type === 'response.output_text.done'
      || type === 'response.content_part.done'
      || (type === 'response.output_item.done' && String(event?.item?.role || event?.item?.type || '').toLowerCase() !== 'function_call')
    ) {
      if (__pmRealtimeAgent.quiet.active || __pmRealtimeAgent.quiet.suppressResponse || __pmRealtimeAgent.turn.suppressAssistantTranscript) return;
      const transcript = _cleanVoiceSpeechText(_eventText(event, { preferLongest: true }) || __pmRealtimeAgent.turn.liveAssistantTranscript || '');
      if (transcript) {
        if (_isVoiceRoomEnabled()) {
          const roomParticipant = _voiceRoomActiveParticipant();
          _voiceRoomRememberTranscript(
            'assistant',
            _voiceRoomParticipantLabel(roomParticipant || __pmVoice?.target || {}),
            transcript,
            _voiceRoomCurrentTargetKey(),
          );
        }
        __pmRealtimeAgent.turn.lastAssistantTranscript = transcript;
        __pmRealtimeAgent.turn.liveAssistantTranscript = '';
        _voiceShowRealtimeAgentMessage(transcript, 'Realtime agent response');
        if (__pmRealtimeAgent.turn.dispatchedWorkerThisResponse) {
          _removeMobileRealtimeAgentChatTurn(sessionId, 'ai', transcript);
          __pmRealtimeAgent.turn.mobileAssistantTurn = null;
          return;
        }
        _voiceDebug('realtime-agent-assistant-transcript', { transcript });
        const subagentTarget = _currentMobileSubagentVoiceTarget();
        if (subagentTarget) {
          await _persistRealtimeSubagentDirectReply(subagentTarget, transcript);
          return;
        }
        // Append to chat thread for visibility
        try {
          const sid = sessionId;
          const finalized = _finalizeMobileRealtimeAgentChatTurn(sid, 'ai', transcript);
          if (finalized) {
            const activeRoomParticipant = _voiceRoomActiveParticipant();
            if (_isVoiceRoomEnabled() && activeRoomParticipant) {
              finalized.voiceSpeaker = _voiceRoomParticipantLabel(activeRoomParticipant);
              finalized.voiceTargetKey = _voiceRoomParticipantKey(activeRoomParticipant);
            }
            finalized.voiceRealtimeActive = true;
            finalized.voiceRealtimeHighlight = '';
            finalized.voiceRealtimeProgress = Math.max(Number(finalized.voiceRealtimeProgress || 0) || 0, 0.01);
            finalized.voiceRealtimeFinalizedAt = Date.now();
            _startMobileRealtimeAssistantLyricProgress(sid);
          } else {
            __pmRealtimeAgent.turn.mobileAssistantTurn = null;
          }
          _persistMobileThreadSnapshot(sid);
          _renderRecent();
          _renderMobileChatSessionNow(sid);
          _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_assistant_transcript', force: true });
        } catch {}
      }
      return;
    }
    if (type === 'response.done' || type === 'response.audio.done' || type === 'response.output_audio.done' || type === 'response.cancelled') {
      const cameraState = _mobileRealtimeLiveVisionState();
      const resumeXaiLiveCamera = cameraState.resumeAfterXaiVisionResponse === true;
      cameraState.resumeAfterXaiVisionResponse = false;
      cameraState.xaiVisionInjectionAt = 0;
      cameraState.xaiVisionInjectionReason = '';
      _voiceDebug('realtime-agent-model-response-finished', {
        type,
        provider: __pmRealtimeAgent.conn?.provider || 'openai_webrtc',
        cameraTurnId: cameraState.turnId || 0,
        cameraFrameId: cameraState.lastAssociatedFrameId || '',
        cameraFrameCapturedAt: cameraState.lastAssociatedCapturedAt || 0,
        inferenceMs: cameraState.responseStartedA
          ? Math.max(0, Date.now() - cameraState.responseStartedAt)
        : 0,
      });
      _finalizeMobileRealtimeUserTurn(sessionId, 'response_finished');
      _stopMobileRealtimeLiveCameraVision('response_finished', {
        preserveCameraSession: _mobileRealtimeCameraSessionIsOpen(),
      });
      if (
        typeof __pmRealtimeAgent.liveCameraFrameReader === 'function'
        && (__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening'
      ) {
        // Keep the camera-open session pre-gated for the next VAD turn. Closing
        // the camera restores create_response:true in stopVoiceCameraFrameCache.
        _sendMobileRealtimeAgentCreateResponseFlag(false);
      }
      __pmRealtimeAgent.activeResponse = false;
      __pmVoice.realtimeSpeechActiveResponse = false;
      if (_mobileRealtimeCameraSessionIsOpen()) {
        _startMobileRealtimeLiveCameraVision('camera_response_finished');
      }
      __pmRealtimeAgent.quiet.suppressResponse = false;
      _releaseMobileVoiceRoomHandoffAckGuard('response_done');
      if (__pmRealtimeAgent.quiet.active && _isMobileCodexV3RealtimeConnection()) {
        const quietAudio = __pmRealtimeAgent.conn?.audio;
        if (quietAudio) {
          quietAudio.muted = true;
          quietAudio.volume = 0;
        }
        _setMobileRealtimeAgentMicEnabled(true);
      }
      if (__pmRealtimeAgent.turn.finalSummaryPending) {
        __pmRealtimeAgent.turn.finalSummaryPending = false;
        __pmRealtimeAgent.turn.suppressAssistantTranscript = false;
        __pmRealtimeAgent.turn.finalSummaryContentKey = '';
        _markVoiceSpeakingEnd();
      }
      const queuedFinalSummary = String(__pmRealtimeAgent.turn.queuedFinalSummary || '').trim();
      if (queuedFinalSummary && !__pmRealtimeAgent.quiet.active) {
        const queuedTranscriptKey = String(__pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey || '');
        const currentTranscriptKey = _mobileRealtimeAgentTranscriptKey();
        if (queuedTranscriptKey && queuedTranscriptKey !== currentTranscriptKey) {
          _clearMobileRealtimeAgentQueuedFinalSummary('queued_summary_transcript_mismatch');
        } else {
          const queuedFinalSummaryKey = String(__pmRealtimeAgent.turn.queuedFinalSummaryKey || '');
          __pmRealtimeAgent.turn.queuedFinalSummary = '';
          __pmRealtimeAgent.turn.queuedFinalSummaryKey = '';
          __pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey = '';
          setTimeout(() => {
            if (!__pmRealtimeAgent.activeResponse && !__pmRealtimeAgent.turn.finalSummaryPending) {
              _requestMobileRealtimeAgentFinalSummary(queuedFinalSummary);
            } else {
              __pmRealtimeAgent.turn.queuedFinalSummary = queuedFinalSummary;
              __pmRealtimeAgent.turn.queuedFinalSummaryKey = queuedFinalSummaryKey;
              __pmRealtimeAgent.turn.queuedFinalSummaryTranscriptKey = queuedTranscriptKey;
            }
          }, 80);
        }
      }
      __pmRealtimeAgent.narrationPending = false;
      __pmRealtimeAgent.lastResponseEndedAt = Date.now();
      const lastRealtimeReply = String(__pmRealtimeAgent.turn.lastAssistantTranscript || __pmRealtimeAgent.turn.liveAssistantTranscript || '').trim();
      if (lastRealtimeReply) _voiceShowRealtimeAgentMessage(lastRealtimeReply, 'Realtime agent response');
      const activeLyricTurn = _mobileRealtimeActiveAssistantTurn(sessionId);
      let responseStatusHoldMs = lastRealtimeReply ? 8500 : 1200;
      if (activeLyricTurn) {
        const estimatedMs = Math.max(Number(activeLyricTurn.voiceRealtimeAudioMs || 0) || 0, _estimateMobileRealtimeSpeechMs(activeLyricTurn.body?.text || activeLyricTurn.content || lastRealtimeReply));
        const playedMs = _mobileRealtimeAudioPlaybackMs(activeLyricTurn);
        // Keep the karaoke rendering alive through the actual output tail.  The
        // per-turn media clock above filters historical WebRTC timeline jumps;
        // this small cushion accounts for the browser's playout buffer.
        const remainingMs = Math.max(850, Math.min(120000, estimatedMs - playedMs + 350));
        responseStatusHoldMs = Math.max(1200, remainingMs + 900);
        setTimeout(() => _finishMobileRealtimeAssistantLyricProgress(sessionId, { delayMs: 900 }), remainingMs);
      }
      setTimeout(() => {
        if (!__pmRealtimeAgent.activeResponse && !__pmRealtimeAgent.turn.finalSummaryPending) _voiceShowReadyStatus();
      }, responseStatusHoldMs);
      setTimeout(() => _restoreMobileRealtimeInputAfterOutput('response_done'), 450);
      if (resumeXaiLiveCamera) {
        // Wait until the cancelled xAI response has released its response flags;
        // then begin a fresh camera turn with the newest cached frame.
        setTimeout(() => {
          if (!_mobileRealtimeXaiLiveCameraCanResume()) return;
          if (__pmRealtimeAgent.activeResponse || __pmVoice.realtimeSpeechActiveResponse) return;
          if (_startMobileRealtimeLiveCameraVision('xai_vision_response_resume')) {
            _voiceDebug('realtime-agent-live-camera-resumed-after-xai-vision-response');
          }
        }, 0);
      }
      if (__pmRealtimeAgent.quiet.pendingActivate) {
        __pmRealtimeAgent.quiet.pendingActivate = false;
        _activateMobileRealtimeAgentQuietMode();
      }
      _maybeRecoverMobileHallucinatedHandoff();
      return;
    }
    if (type === 'input_audio_buffer.speech_started' || type === 'input_audio_buffer.speech_stopped' || type === 'input_audio_buffer.committed') {
      // Flush any staged photo into the conversation the moment the user starts
      // speaking (server-VAD/always-listening), BEFORE the model's auto-response, so
      // the image is attached to this spoken turn.
      if (type === 'input_audio_buffer.speech_started') {
        if (_shouldIgnoreMobileRealtimeSpeechStartedDuringOutput(__pmRealtimeAgent.conn?.provider || 'openai_webrtc')) return;
        const cameraState = _mobileRealtimeLiveVisionState();
        const turn = __pmRealtimeAgent.turn;
        const hadSpeechPause = Number(turn.currentUserSpeechStoppedAt || 0) > Number(turn.currentUserSpeechStartedAt || 0);
        const duplicateCameraSpeechStart = cameraState.active === true
          && !Number(cameraState.responseStartedAt || 0)
          && Number(cameraState.turnStartedAt || 0) > 0
          && Date.now() - Number(cameraState.turnStartedAt || 0) < 18000
          && !hadSpeechPause;
        if (duplicateCameraSpeechStart) {
          // Some mobile VAD/camera combinations repeat speech_started while the
          // same audio item is still being transcribed. Do not reset the exchange
          // pointer or the next transcript delta creates another chat bubble.
          _voiceDebug('realtime-agent-duplicate-camera-speech-start-ignored', {
            turnId: cameraState.turnId || 0,
          });
        } else {
          const continueCurrentUserTurn = _mobileRealtimeUserTurnCanContinueAcrossPause(sessionId);
          _clearMobileRealtimeAgentQueuedFinalSummary('speech_started');
          _clearMobileRealtimeAgentPendingCreateResponse();
          if (continueCurrentUserTurn) {
            const existingText = String(turn.mobileUserTurn?.body?.text || turn.mobileUserTurn?.content || '').replace(/\s+/g, ' ').trim();
            turn.currentUserTranscriptPrefix = existingText;
            turn.currentUserTranscriptSegment = '';
            turn.liveUserTranscript = existingText;
            turn.currentVoiceExchangeHasUser = true;
            _voiceShowRealtimeUserTranscript(existingText, 'Listening for realtime speech');
            _voiceDebug('realtime-agent-user-turn-continued-after-pause', { transcriptLen: existingText.length });
          } else {
            turn.liveUserTranscript = '';
            _ensureMobileRealtimeExchangeId({ forceNew: true });
            turn.mobileUserTurn = null;
            turn.mobileAssistantTurn = null;
            turn.currentUserTranscriptItemId = '';
            turn.currentUserTranscriptPrefix = '';
            turn.currentUserTranscriptSegment = '';
            _voiceShowRealtimeUserTranscript('', 'Listening for realtime speech');
            turn.subagentVoiceUserLogKey = '';
            turn.subagentVoiceReplyLogKey = '';
          }
          turn.currentUserTranscriptItemId = '';
          turn.currentUserSpeechStartedAt = Date.now();
          turn.currentUserSpeechStoppedAt = 0;
          _startMobileRealtimeLiveCameraVision('speech_started');
          cameraState.pendingAttachmentPreparation = __pmRealtimeAgent.pendingImages.length
            ? _flushMobileRealtimeAgentPendingImages('speech_started', { createResponse: false, turnId: cameraState.turnId }).catch(() => false)
            : Promise.resolve(false);
        }
      } else if (type === 'input_audio_buffer.speech_stopped') {
        __pmRealtimeAgent.turn.currentUserSpeechStoppedAt = Date.now();
        const cameraState = _mobileRealtimeLiveVisionState();
        if (cameraState.responseGateActive) {
          const attachmentPreparation = cameraState.pendingAttachmentPreparation || Promise.resolve(false);
          const livePreparation = _prepareMobileRealtimeLiveCameraForTurn('speech_stopped');
          Promise.all([
            Promise.resolve(attachmentPreparation).catch(() => false),
            Promise.resolve(livePreparation).catch(() => false),
          ]).then(() => {
            cameraState.preparationReady = true;
            _maybeReleaseMobileRealtimeCameraResponseGate('speech_stopped_camera_ready');
          }).catch(() => {
            cameraState.preparationReady = true;
            _maybeReleaseMobileRealtimeCameraResponseGate('speech_stopped_camera_prepare_failed');
          });
        } else {
          _stopMobileRealtimeLiveCameraVision(type);
        }
      } else if (type === 'input_audio_buffer.committed') {
        __pmRealtimeAgent.turn.currentUserSpeechStoppedAt = Number(__pmRealtimeAgent.turn.currentUserSpeechStoppedAt || Date.now()) || Date.now();
        const cameraState = _mobileRealtimeLiveVisionState();
        if (cameraState.responseGateActive) {
          cameraState.audioCommitted = true;
          const attachmentPreparation = cameraState.pendingAttachmentPreparation || Promise.resolve(false);
          const livePreparation = cameraState.preparationReady
            ? Promise.resolve(true)
            : _prepareMobileRealtimeLiveCameraForTurn('audio_committed');
          Promise.all([
            Promise.resolve(attachmentPreparation).catch(() => false),
            Promise.resolve(livePreparation).catch(() => false),
          ]).then(() => {
            cameraState.preparationReady = true;
            _maybeReleaseMobileRealtimeCameraResponseGate('audio_committed_camera_ready');
          }).catch(() => {
            cameraState.preparationReady = true;
            _maybeReleaseMobileRealtimeCameraResponseGate('audio_committed_camera_prepare_failed');
          });
        } else {
          _stopMobileRealtimeLiveCameraVision(type);
        }
      }
      const audioItemId = String(event?.item_id || '').trim();
      if (type === 'input_audio_buffer.committed' && audioItemId) __pmRealtimeAgent.turn.currentUserTranscriptItemId = audioItemId;
      _voiceDebug('realtime-agent-audio-buffer-event', {
        type,
        itemId: event?.item_id || '',
        previousItemId: event?.previous_item_id || '',
        currentItemId: __pmRealtimeAgent.turn.currentUserTranscriptItemId || '',
        cameraTurnId: _mobileRealtimeLiveVisionState().turnId || 0,
        cameraPhase: _mobileRealtimeLiveVisionState().phase || 'idle',
        cameraGateActive: _mobileRealtimeLiveVisionState().responseGateActive === true,
      });
      return;
    }
    if (type === 'error') {
      const message = String(event?.error?.message || event?.error || '');
      _voiceDebug('realtime-agent-error', { message });
      if (__pmRealtimeAgent.turn.finalSummaryPending) {
        __pmRealtimeAgent.turn.finalSummaryPending = false;
        __pmRealtimeAgent.turn.suppressAssistantTranscript = false;
        _markVoiceSpeakingEnd();
      }
      _restoreMobileRealtimeInputAfterOutput('response_error');
      if (_isNoActiveRealtimeCancelError(event)) {
        _voiceDebug('realtime-agent-cancel-noop', { message });
        return;
      }
      if (message) pmToast(`Realtime: ${message}`, 'error');
      return;
    }
  }

  // Friendly label + key argument for a realtime tool call, for the recent-commands list.
  function _realtimeAgentToolLabel(name, args) {
    const map = {
      voice_web_search: 'Web Search',
      voice_web_fetch: 'Web Fetch',
      voice_write_note: 'Write Note',
      voice_set_wake_phrase: 'Set Wake Phrase',
      voice_enter_quiet_mode: 'Enter Quiet Mode',
      voice_set_quiet_until: 'Set Quiet Until',
      skill_list: 'Skill List',
      skill_read: 'Skill Read',
      skill_resource_list: 'Skill Resources',
      skill_resource_read: 'Skill Resource Read',
      voice_skill_lookup: 'Skill List',
      voice_skill_read: 'Skill Read',
      voice_skill_resource_read: 'Skill Resource Read',
      voice_memory_search: 'Memory Search',
      voice_timer: 'Timer',
      voice_browser_screenshot: 'Browser Screenshot',
      voice_desktop_screenshot: 'Desktop Screenshot',
      voice_send_screenshot: 'Send Screenshot',
      voice_worker_status: 'Worker Status',
      voice_room_handoff: 'Switch room agent',
      restart_gateway_quick: 'Quick Gateway Restart',

      dispatch_prometheus_worker: 'Hand off to Worker',
      steer_active_worker: 'Steer Worker',
      interrupt_active_worker: 'Interrupt Worker',
    };
    const label = map[name] || name.replace(/^voice_/, '').replace(/_/g, ' ');
    const detail = String(args?.query || args?.task || args?.message || args?.phrase || args?.url || args?.reason || '').trim();
    return detail ? `${label}: ${detail.slice(0, 80)}` : label;
  }

  // Show every realtime tool call in the voice page "recent commands" list (not jus
  // worker dispatch). Returns the cmd object so the caller can mark it complete.
  function _addRealtimeAgentRecentCommand(name, args) {
    try {
      const cmd = {
        id: 'rtcmd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        request: _realtimeAgentToolLabel(name, args),
        currentTool: name,
        finalText: '',
        toolStream: [],
        status: 'thinking',
        ts: Date.now(),
        expanded: false,
        source: 'realtime_agent',
      };
      __pmVoice.recent.unshift(cmd);
      if (__pmVoice.recent.length > 30) __pmVoice.recent.length = 30;
      _renderRecent();
      return cmd;
    } catch { return null; }
  }

  function _finishRealtimeAgentRecentCommand(cmd, ok, summary) {
    if (!cmd) return;
    try {
      cmd.status = ok ? 'done' : 'error';
      cmd.currentTool = ok ? 'complete' : 'error';
      cmd.finalText = String(summary || '').slice(0, 400);
      _renderRecent();
    } catch {}
  }

  function _startMobileRealtimeAgentToolTrace(sessionId, name, args, extra = {}) {
    const turn = _ensureMobileRealtimeAgentChatTurn(sessionId, 'ai');
    if (!turn) return null;
    turn.source = turn.source || 'voice_agent_realtime';
    turn.channel = turn.channel || 'voice';
    turn.streaming = true;
    const label = _realtimeAgentToolLabel(name, args);
    const traceExtra = { type: 'tool_call', toolName: name, args, source: 'realtime_agent_tool_start', ...(extra || {}) };
    const callId = _mobileVoiceToolKey(traceExtra);
    if (callId) {
      const matchingEntries = [
        ...(Array.isArray(turn.processEntries) ? turn.processEntries : []),
        ...(Array.isArray(turn.liveTraceEntries) ? turn.liveTraceEntries : []),
      ].filter((entry, index, entries) => entries.indexOf(entry) === index)
        .filter((entry) => _mobileVoiceToolKey(entry?.extra || {}) === callId);
      if (matchingEntries.length) {
        matchingEntries.forEach((entry) => {
          entry.text = label;
          entry.extra = { ...(entry.extra || {}), ...traceExtra };
        });
        _notifyMobileChatVoiceUpdate(sessionId, { reason: 'realtime_voice_tool_start', force: true });
        return turn;
      }
    }
    _appendVoiceAgentProcessEntriesToTurn(turn, [{
      type: 'tool',
      text: label,
      extra: traceExtra,
    }]);
    _notifyMobileChatVoiceUpdate(sessionId, { reason: 'realtime_voice_tool_start', force: true });
    return turn;
  }

  function _finishMobileRealtimeAgentToolTrace(sessionId, turn, name, args, ok, summary = '', extra = {}) {
    const target = turn || _ensureMobileRealtimeAgentChatTurn(sessionId, 'ai');
    if (!target) return false;
    const cleanSummary = String(summary || '').replace(/\s+/g, ' ').trim();
    const label = _realtimeAgentToolLabel(name, args);
    const text = ok
      ? `${label}${cleanSummary ? ` -> ${cleanSummary.slice(0, 180)}` : ' complete'}`
      : `${label} failed${cleanSummary ? `: ${cleanSummary.slice(0, 180)}` : ''}`;
    const changed = _appendVoiceAgentProcessEntriesToTurn(target, [{
      type: ok ? 'result' : 'error',
      text,
      extra: { type: 'tool_result', toolName: name, args, source: 'realtime_agent_tool_result', ...(extra || {}) },
    }]);
    _notifyMobileChatVoiceUpdate(sessionId, { reason: ok ? 'realtime_voice_tool_result' : 'realtime_voice_tool_error', force: true });
    return changed;
  }

  async function _abortMobileActiveWorkerFromRealtime(sessionId, source = 'realtime_agent_interrupt') {
    const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!sid) return false;
    let requested = false;
    const run = __pmChat.activeRuns?.[sid] || __pmChat.activeRuns?.[__pmChat.activeSessionId];
    const runtimeId = String(run?.runtimeId || _readMobileActiveRun(sid)?.runtimeId || '').trim();
    try {
      if (run?.abort && typeof run.abort.abort === 'function') {
        run.abort.abort();
        requested = true;
      }
    } catch {}
    try {
      const result = await stopMobileMainChat(sid, { runtimeId, source });
      requested = requested || result?.success === true;
    } catch (err) {
      _voiceDebug('realtime-agent-abort-failed', { sessionId: sid, message: err?.message || String(err) });
    }
    return requested;
  }

  async function _executeMobileRealtimeAgentFunctionCall(call, sessionId) {
    const name = String(call?.name || '').trim();
    const callId = String(call?.call_id || '').trim();
    if (!name) return;
    if (callId) {
      const connections = __pmRealtimeAgent.functionCallConnections instanceof Map
        ? __pmRealtimeAgent.functionCallConnections
        : (__pmRealtimeAgent.functionCallConnections = new Map());
      connections.set(callId, __pmRealtimeAgent?.conn || null);
      while (connections.size > 64) connections.delete(connections.keys().next().value);
    }
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    _voiceDebug('realtime-agent-tool-call', { name, args });

    const action = String(args?.action || '').trim().toLowerCase();
    const isScreenshotTool = (name === 'voice_desktop' || name === 'voice_browser' || /^(?:voice_desktop|voice_browser)_screenshot$/.test(name))
      && (!action || action === 'screenshot' || name.endsWith('_screenshot'));
    const spokenTurn = String(
      __pmRealtimeAgent.turn?.liveUserTranscrip
        || __pmRealtimeAgent.turn?.lastUserTranscrip
        || __pmRealtimeAgent.turn?.currentUserTranscriptSegmen
        || '',
    ).replace(/\s+/g, ' ').trim();
    const cameraRelativeRequest = /\b(?:can you see|what (?:am|is) (?:i|we|the user)?\s*show(?:ing|n)?|look at (?:this|that)|what(?:'s| is) this|what(?:'s| is) in (?:the )?(?:camera|frame|picture|image)|describe (?:this|the )?(?:camera|frame|picture|image)|in front of (?:me|you)|what do you see)\b/i.test(spokenTurn)
      && !/\b(?:desktop|browser|window|app|screen capture|screenshot)\b/i.test(spokenTurn);
    if (isScreenshotTool && cameraRelativeRequest && _mobileRealtimeCameraRuntimeIsActive()) {
      _voiceDebug('realtime-agent-camera-screenshot-fallback-blocked', {
        name,
        action,
        transcript: spokenTurn.slice(0, 220),
      });
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: false,
        blocked: true,
        error: 'The mobile camera live feed is active. Inspect the attached live camera image instead of taking a desktop or browser screenshot.',
      }));
      return;
    }

    if (name === 'voice_room_handoff') {
      await _executeMobileVoiceRoomHandoffTool(args, callId, sessionId);
      return;
    }

    if (name === 'voice_thread_ops') {
      // Thread supervision routes its eventual review by owner session id. Make
      // that owner authoritative immediately before creation/steering so a
      // mobile draft/session transition cannot fall through to the chat Worker.
      await _rebindMobileCodexBridgeOwnerSession(sessionId);
    }

    if (name === 'restart_gateway_quick') {
      try {
        const data = await mobileGatewayFetch('/api/voice-agent/restart-gateway-quick', {
          method: 'POST',
          body: JSON.stringify({ sessionId, reason: String(args.reason || '').trim(), source: 'mobile_realtime_voice' }),
        });
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
          ok: data?.success === true,
          restarting: data?.restarting === true,
          note: 'The quick restart has been scheduled. Do not speak again before disconnect; the restarted gateway will confirm success.',
          error: data?.error || '',
        }), { createResponse: false });
      } catch (err) {
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, restarting: false, error: String(err?.message || err) }));
      }
      return;
    }

    if (name === 'send_to_prometheus_chat') {
      const message = String(args.message || args.prompt || '').trim();
      let started = false;
      let error = '';
      if (message && typeof __pmRealtimeAgent.submitToChatWorker === 'function') {
        try {
          const visibleTranscript = String(__pmRealtimeAgent.turn.lastUserTranscript || message).trim();
          _removeMobileRealtimeAgentChatTurn(sessionId, 'user', visibleTranscript);
          _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: true, started: true, mode: 'current_chat', spoken_confirmation_not_needed: true }), { createResponse: false });
          started = true;
          Promise.resolve(__pmRealtimeAgent.submitToChatWorker(message, { visibleTranscript })).catch((err) => {
            _voiceDebug('realtime-agent-chat-handoff-failed', { message: err?.message || String(err) });
          });
        } catch (err) {
          error = String(err?.message || err);
        }
      }
      if (!started) {
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, started: false, mode: 'current_chat', error: error || 'The current-chat bridge is unavailable.' }));
      }
      return;
    }

    if (name === 'dispatch_prometheus_worker') {
      const workerTasks = Array.isArray(args.tasks)
        ? args.tasks.map((raw, index) => {
            const prompt = typeof raw === 'string'
              ? raw
              : String(raw?.prompt || raw?.task || raw?.objective || raw?.message || '').trim();
            if (!prompt) return null;
            const title = typeof raw === 'object' && raw
              ? String(raw.title || raw.name || raw.label || '').trim()
              : '';
            return { title: title || `Voice worker ${index + 1}`, prompt };
          }).filter(Boolean)
        : [];
      const batchTaskText = workerTasks.length > 1
        ? `${workerTasks.length} workers: ${workerTasks.map((item) => item.title || item.prompt).join('; ')}`
        : String(workerTasks[0]?.prompt || '').trim();
      const task = String(args.task || args.prompt || batchTaskText || '').trim();
      if (!workerTasks.length && task) workerTasks.push({ title: String(args.title || '').trim(), prompt: task });
      // Compatibility bridge for an already-open realtime session using the
      // retired tool name. New voice models receive voice_thread_ops directly.
      // This deliberately bypasses the former worker-group transport.
      if (workerTasks.length) {
        const threadArgs = workerTasks.length === 1
          ? {
              action: 'create',
              title: workerTasks[0].title || 'Voice task',
              prompt: workerTasks[0].prompt,
              objective: workerTasks[0].prompt,
              launch_mode: 'supervise',
            }
          : {
              action: 'create_many',
              launch_mode: 'supervise',
              threads: workerTasks.map((workerTask) => ({
                title: workerTask.title || 'Voice task',
                prompt: workerTask.prompt,
                objective: workerTask.prompt,
              })),
            };
        return _executeMobileRealtimeAgentFunctionCall({
          name: 'voice_thread_ops',
          call_id: callId,
          args: threadArgs,
        }, sessionId);
      }
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, error: 'A task is required to create a Prometheus thread.' }));
      return;
      const subagentTarget = _currentMobileSubagentVoiceTarget();
      const spokenTranscript = String(__pmRealtimeAgent.turn.liveUserTranscript || __pmRealtimeAgent.turn.lastUserTranscript || '').trim();
      const visibleTranscript = String(spokenTranscript || task || '').trim();
      const taskKey = _normalizeVoiceEchoText(task);
      const transcriptKey = _normalizeVoiceEchoText(spokenTranscript);
      const taskHasWorkIntent = _hasMobileVoiceWorkIntent(task);
      const transcriptHasWorkIntent = _hasMobileVoiceWorkIntent(spokenTranscript);
      const taskIsDirectAnswerOnly = _isMobileVoiceDirectAnswerOnlyTurn(task);
      const transcriptIsDirectAnswerOnly = _isMobileVoiceDirectAnswerOnlyTurn(spokenTranscript || task);
      const taskAddsSubstance = !!(
        task
        && !taskIsDirectAnswerOnly
        && (
          taskHasWorkIntent
          || !spokenTranscript
          || (taskKey && transcriptKey && taskKey !== transcriptKey)
        )
      );
      if (subagentTarget && !taskHasWorkIntent && !transcriptHasWorkIntent && !taskAddsSubstance) {
        const alreadyAnswered = !!String(__pmRealtimeAgent.turn.lastAssistantTranscript || '').trim();
        _voiceDebug('realtime-agent-subagent-dispatch-blocked-no-work-intent', {
          agentId: subagentTarget.agentId,
          task: task.slice(0, 160),
          transcript: visibleTranscript.slice(0, 160),
          alreadyAnswered,
        });
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
          ok: true,
          dispatched: false,
          direct_answer_only: true,
          no_work_intent: true,
          note: `This is conversational voice traffic for ${subagentTarget.label || 'the selected subagent'}, not a concrete work request. Answer directly as the subagent and do not start the subagent worker/chat stream.`,
        }), { createResponse: !alreadyAnswered });
        return;
      }
      if (transcriptIsDirectAnswerOnly && !taskHasWorkIntent && !taskAddsSubstance) {
        const alreadyAnswered = !!String(__pmRealtimeAgent.turn.lastAssistantTranscript || '').trim();
        const targetLabel = subagentTarget?.label || (subagentTarget ? 'the selected subagent' : 'Prometheus');
        _voiceDebug('realtime-agent-dispatch-blocked-direct-answer', {
          targetKind: subagentTarget ? 'subagent' : 'main',
          agentId: subagentTarget?.agentId || '',
          task: task.slice(0, 160),
          transcript: visibleTranscript.slice(0, 160),
          alreadyAnswered,
        });
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
          ok: true,
          dispatched: false,
          direct_answer_only: true,
          note: subagentTarget
            ? `This is an identity, status, or small-talk turn for ${targetLabel}. Answer directly as the subagent. Do not dispatch worker work for this turn.`
            : 'This is an identity, status, or small-talk turn for Prometheus. Answer directly as Prometheus. Do not dispatch worker work for this turn.',
        }), { createResponse: !alreadyAnswered });
        return;
      }
      let dispatched = false;
      let dispatchResult = null;
      let dispatchError = '';
      if (task) {
        try {
          if (subagentTarget && typeof __pmRealtimeAgent.submitToWorker === 'function') {
            __pmRealtimeAgent.turn.dispatchedWorkerThisResponse = true;
            if (visibleTranscript) __pmRealtimeAgent.turn.lastUserTranscript = visibleTranscript;
            _cancelMobileRealtimeAgentResponseForDispatch();
            _removeMobileRealtimeAgentChatTurn(sessionId, 'user', visibleTranscript || task);
            _markMobileRealtimeAgentWorkerDispatch(sessionId, task);
            // Runs the proven voice→worker path: pushes the user turn, creates a
            // recent command, streams the worker response into the chat thread, and
            // starts the realtime narration/context loop for live milestone updates.
            __pmRealtimeAgent.submitToWorker(task, {
              source: 'realtime_agent_dispatch',
              skipVoiceAgentHandoff: true,
              visibleTranscript,
            });
            dispatched = true;
            setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched_fast'), 300);
            setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched'), 1200);
          } else if (!subagentTarget && typeof __pmRealtimeAgent.submitToWorker === 'function') {
            const primaryTask = workerTasks[0] || { title: String(args.title || '').trim() || 'Primary chat worker', prompt: task };
            const backgroundTasks = workerTasks.slice(1);
            const primaryLink = {
              taskId: `voice_primary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              title: primaryTask.title || 'Primary chat worker',
              prompt: primaryTask.prompt || task,
              status: 'running',
              workgroupId: '',
              finalResult: '',
              processEntries: [],
            };
            __pmRealtimeAgent.turn.dispatchedWorkerThisResponse = true;
            if (visibleTranscript) __pmRealtimeAgent.turn.lastUserTranscript = visibleTranscript;
            _cancelMobileRealtimeAgentResponseForDispatch();
            _removeMobileRealtimeAgentChatTurn(sessionId, 'user', visibleTranscript || task);
            _markMobileRealtimeAgentWorkerDispatch(sessionId, primaryLink.prompt);
            __pmRealtimeAgent.submitToWorker(primaryLink.prompt, {
              source: 'realtime_agent_dispatch',
              skipVoiceAgentHandoff: true,
              visibleTranscript,
              voicePrimaryLink: primaryLink,
            });
            dispatched = true;
            if (backgroundTasks.length) {
              dispatchResult = await mobileGatewayFetch('/api/voice-agent/dispatch-workers', {
                method: 'POST',
                body: JSON.stringify({
                  sessionId,
                  tasks: backgroundTasks,
                  primaryWorker: primaryLink,
                  delivery: 'report_each',
                  sourceTranscript: visibleTranscript || task,
                  source: 'mobile_realtime_agent_hybrid_dispatch',
                }),
              });
              const backgroundDispatched = dispatchResult?.success === true || dispatchResult?.ok === true;
              dispatchError = backgroundDispatched ? '' : (dispatchResult?.error || 'Additional workers could not be started.');
              primaryLink.workgroupId = backgroundDispatched ? String(dispatchResult?.workgroupId || '') : '';
              if (primaryLink.workgroupId) {
                const primaryWorker = dispatchResult?.workgroup?.workers?.find?.((worker) => String(worker?.taskId || '') === primaryLink.taskId);
                if (primaryWorker) primaryWorker.processEntries = primaryLink.processEntries.slice(-40);
                _updateMobilePrimaryWorkgroupLink(primaryLink, primaryLink.status, primaryLink.finalResult);
                _upsertMobileVoiceWorkgroup(sessionId, dispatchResult?.workgroup, dispatchResult?.acknowledgement || '');
              }
            }
            if (dispatched) {
              _voiceDebug('realtime-agent-dispatch-workgroup', {
                workgroupId: dispatchResult?.workgroupId || '',
                taskIds: dispatchResult?.taskIds || [],
                count: workerTasks.length || 1,
                primaryInChat: true,
                backgroundCount: backgroundTasks.length,
              });
              setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched_fast'), 300);
              setTimeout(() => _refreshMobileRealtimeAgentWorkerContext('worker_dispatched'), 1200);
            }
          } else {
            _voiceDebug('realtime-agent-dispatch-no-bridge', {});
          }
        } catch (err) {
          dispatchError = String(err?.message || err);
          _voiceDebug('realtime-agent-dispatch-failed', { message: err?.message || String(err) });
        }
      }
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: dispatched,
        dispatched,
        task,
        tasks: workerTasks,
        workgroupId: dispatchResult?.workgroupId || '',
        taskIds: dispatchResult?.taskIds || [],
        error: dispatchError,
        spoken_confirmation_not_needed: true,
        note: dispatched
          ? (workerTasks.length > 1
            ? 'The primary Worker is linked to the current chat and the additional Workers are tracked as background tasks in one workgroup. Background completions will be surfaced while the primary Worker continues. Do not speak another handoff acknowledgement.'
            : 'The primary Worker is linked to the current chat. No background task or workgroup was created. Do not speak another handoff acknowledgement.')
          : 'Worker dispatch failed before any worker started.',
      }), { createResponse: false });
      return;
    }
    if (name === 'steer_active_worker') {
      const message = String(args.message || '').trim();
      let ok = false;
      let error = '';
      const steerToolTurn = _startMobileRealtimeAgentToolTrace(sessionId, name, args, { callId });
      if (_isMobileVoiceStatusQuestion(message)) {
        try {
          const status = await mobileGatewayFetch('/api/voice-agent/realtime-tool', {
            method: 'POST',
            timeoutMs: 60000,
            body: JSON.stringify({ sessionId, toolName: 'voice_worker_status', toolArgs: { include_recent_events: true }, voiceTarget: _mobileVoiceTargetPayload() }),
          });
            const packet = _overlayPendingMobileRealtimeAgentWorkerPacket(status?.result && typeof status.result === 'object'
            ? {
              id: status.result.contextPacketId,
              active: status.result.active,
              summary: status.result.summary,
              currentGoal: status.result.currentGoal,
              currentPhase: status.result.currentPhase,
              activeToolName: status.result.activeToolName,
              activeToolLabel: status.result.activeToolLabel,
              trigger: status.result.trigger,
              currentlyDoing: status.result.currentlyDoing,
              doneAlready: status.result.doneAlready,
              processEntries: status.result.processEntries,
              recentEvents: status.result.recentEvents,
            }
            : null, sessionId, 'blocked_status_as_steer');
          if (packet) _sendMobileRealtimeAgentContextUpdate(packet, { reason: 'blocked_status_as_steer' });
          _finishMobileRealtimeAgentToolTrace(sessionId, steerToolTurn, name, args, true, 'worker status checked', {
            callId,
            result: status?.result || status?.raw || '',
          });
          _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: true, steered: false, statusQuestion: true, workerStatus: _overlayPendingMobileRealtimeAgentWorkerPacket(status?.result || null, sessionId, 'blocked_status_as_steer_output') || null }));
        } catch (err) {
          _finishMobileRealtimeAgentToolTrace(sessionId, steerToolTurn, name, args, false, String(err?.message || err), {
            callId,
            error: String(err?.message || err),
          });
          _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, steered: false, statusQuestion: true, error: String(err?.message || err) }));
        }
        return;
      }
      if (message) {
        try {
          const result = await mobileGatewayFetch('/api/chat/steer', {
            method: 'POST',
            body: JSON.stringify({ sessionId, message, source: 'realtime_agent_steer' }),
          });
          ok = result?.success === true || result?.ok === true;
          error = result?.error || '';
        } catch (err) {
          error = String(err?.message || err);
        }
      }
      _finishMobileRealtimeAgentToolTrace(sessionId, steerToolTurn, name, args, ok, ok ? 'steer sent' : (error || 'steer failed'), {
        callId,
        result: { steered: ok, message },
        error,
      });
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok, steered: ok, message, error }));
      return;
    }
    if (name === 'interrupt_active_worker') {
      const interruptToolTurn = _startMobileRealtimeAgentToolTrace(sessionId, name, args, { callId });
      let interrupted = true;
      let interruptError = '';
      try { await _abortMobileActiveWorkerFromRealtime(sessionId, 'realtime_agent_interrupt'); } catch (err) {
        interrupted = false;
        interruptError = String(err?.message || err);
      }
      _finishMobileRealtimeAgentToolTrace(sessionId, interruptToolTurn, name, args, interrupted, interrupted ? 'interrupt sent' : interruptError, {
        callId,
        result: { interrupted, reason: String(args.reason || '') },
        error: interruptError,
      });
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: true, interrupted: true, reason: String(args.reason || '') }));
      return;
    }

    const recentCmd = _addRealtimeAgentRecentCommand(name, args);
    try {
      const realtimeToolTurn = _startMobileRealtimeAgentToolTrace(sessionId, name, args, { callId });
      const contextPacket = name === 'voice_worker_status'
        ? _overlayPendingMobileRealtimeAgentWorkerPacket(
          _getCachedMobileVoiceWorkerContextPacket(sessionId),
          sessionId,
          'voice_worker_status_tool_client_context',
        )
        : null;
      const requestStartedAt = Date.now();
      const result = await mobileGatewayFetch('/api/voice-agent/realtime-tool', {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({
          sessionId,
          toolName: name,
          toolArgs: args,
          voiceTarget: _mobileVoiceTargetPayload(),
          ...(contextPacket ? { contextPacket } : {}),
        }),
      });
      if (!result?.success) {
        _voiceDebug('realtime-agent-tool-result', {
          name,
          ok: false,
          clientElapsedMs: Math.max(0, Date.now() - requestStartedAt),
          elapsedMs: Number(result?.timing?.elapsedMs || 0) || undefined,
          error: result?.error || 'Tool failed',
        });
        _finishMobileRealtimeAgentToolTrace(sessionId, realtimeToolTurn, name, args, false, result?.error || 'Tool failed', {
          error: result?.error || 'Tool failed',
        });
        _finishRealtimeAgentRecentCommand(recentCmd, false, result?.error || 'Tool failed');
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, error: result?.error || 'Tool failed' }));
        return;
      }
      if (name === 'voice_worker_status') {
        const packet = _overlayPendingMobileRealtimeAgentWorkerPacket(result?.result && typeof result.result === 'object'
          ? {
            id: result.result.contextPacketId,
            active: result.result.active,
            summary: result.result.summary,
            currentGoal: result.result.currentGoal,
            currentPhase: result.result.currentPhase,
            activeToolName: result.result.activeToolName,
            activeToolLabel: result.result.activeToolLabel,
            trigger: result.result.trigger,
            currentlyDoing: result.result.currentlyDoing,
            doneAlready: result.result.doneAlready,
            processEntries: result.result.processEntries,
            recentEvents: result.result.recentEvents,
          }
          : null, sessionId, 'voice_worker_status_tool');
        if (packet) _sendMobileRealtimeAgentContextUpdate(packet, { reason: 'voice_worker_status_tool' });
      }

      // Apply wake phrase / quiet mode directives to the live realtime session.
      const directive = result.runtimeDirective;
      if (directive?.action) {
        const phrase = String(directive.wakePhrase || '').trim();
        if (directive.action === 'set_wake_phrase' && phrase) {
          _setMobileRealtimeAgentWakePhrase(phrase);
          try { _saveVoiceSettings({ wakePhrase: phrase }); } catch {}
        } else if (directive.action === 'enter_quiet_mode' || directive.action === 'set_quiet_until') {
          if (phrase) {
            _setMobileRealtimeAgentWakePhrase(phrase);
            try { _saveVoiceSettings({ wakePhrase: phrase }); } catch {}
          }
          const quietResult = result.result && typeof result.result === 'object'
            ? result.resul
            : { ok: true, summary: String(result.raw || 'Quiet mode active.') };
          _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
            ...quietResult,
            realtime_quiet_applied: true,
            spoken_confirmation_not_needed: true,
          }), { createResponse: false });
          _activateMobileRealtimeAgentQuietMode({ skipCancel: true });
          return;
        }
      }
      const realtimeToolEntries = Array.isArray(result?.processEntries)
        ? result.processEntries.map(_normalizeVoiceAgentProcessEntry).filter(Boolean)
        : [];
      if (realtimeToolEntries.length) {
        if (_attachVoiceAgentProcessEntriesToMobileTurn(sessionId, realtimeToolEntries)) {
          _notifyMobileChatVoiceUpdate(sessionId, { reason: 'realtime_voice_tool_result', force: true });
        }
      } else {
        _finishMobileRealtimeAgentToolTrace(sessionId, realtimeToolTurn, name, args, true, '', {
          result: result?.result || result?.raw || '',
        });
      }
      // Overlay any captured screenshot on the voice orb, like other preview cards.
      if (result.preview?.dataUrl && typeof __pmRealtimeAgent.enqueuePreviews === 'function') {
        try {
          const p = result.preview;
          const label = p.source === 'desktop' ? 'Desktop screenshot' : p.source === 'browser' ? 'Browser screenshot' : 'Screenshot';
          const dims = p.width && p.height ? ` ${p.width}x${p.height}` : '';
          __pmRealtimeAgent.enqueuePreviews([{ kind: 'image', name: `${label}${dims}.png`, dataUrl: p.dataUrl, mimeType: p.mimeType || 'image/png' }], { transient: true });
        } catch {}
      }
      // A voice show_* tool produced a rich-artifact card — render it into the mobile
      // chat thread and send the model only a lean confirmation (not the full card).
      const voiceArtifacts = result?.result && Array.isArray(result.result.richArtifacts) ? result.result.richArtifacts : null;
      if (voiceArtifacts && voiceArtifacts.length) {
        try {
          const sid = String(sessionId || __pmChat.activeSessionId || '').trim();
          if (sid) {
            if (!Array.isArray(__pmChat.threads[sid])) __pmChat.threads[sid] = [];
            const artifactProcessEntries = _takePendingVoiceAgentProcessEntries(sid);
            const artifactCard = {
              role: 'ai',
              streaming: false,
              time: _nowTime(),
              timestamp: Date.now(),
              body: { sender: 'Prometheus', text: '' },
              content: '',
              richArtifacts: voiceArtifacts,
              source: 'voice_agent_realtime',
              channel: 'voice',
              messageId: `voice_show_ui_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              messageKind: 'voice_show_ui_card',
              processEntries: artifactProcessEntries.length ? artifactProcessEntries : undefined,
            };
            __pmChat.threads[sid].push(artifactCard);
            _renderMobileChatSessionNow(sid);
            await _persistMobileThreadSnapshot(sid);
          }
          if (typeof __pmRealtimeAgent.enqueueArtifacts === 'function') {
            __pmRealtimeAgent.enqueueArtifacts(voiceArtifacts);
          }
        } catch (err) { _voiceDebug('realtime-agent-artifact-render-failed', { error: String(err?.message || err) }); }
        const cardSummary = String(result.result.summary || 'Card shown.');
        _finishRealtimeAgentRecentCommand(recentCmd, true, cardSummary);
        _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: result.result.ok !== false, summary: cardSummary, shown: true }));
        return;
      }
      const toolOutput = name === 'voice_worker_status'
        ? (_overlayPendingMobileRealtimeAgentWorkerPacket(result.result || null, sessionId, 'voice_worker_status_output') || result.result || result.raw || { ok: true })
        : (result.result || result.raw || { ok: true });
      const summary = String(toolOutput?.summary || toolOutput?.stdout || result.raw || 'Done').toString();
      _finishRealtimeAgentRecentCommand(recentCmd, true, summary);
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify(toolOutput), { preview: result.preview });
    } catch (err) {
      _finishMobileRealtimeAgentToolTrace(sessionId, null, name, args, false, String(err?.message || err), {
        error: String(err?.message || err),
        source: 'realtime_agent_tool_exception',
      });
      _finishRealtimeAgentRecentCommand(recentCmd, false, String(err?.message || err));
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  }

  // Downscale/recompress a data URL so a full-res screenshot or photo reliably fits
  // in ONE realtime data-channel (SCTP) message. Without this, a 1-3MB PNG send can
  // fail silently and the voice agent is left with only the text metadata.
  async function _downscaleDataUrlForRealtime(dataUrl, maxDim = 960, quality = 0.74, maxChars = 180000) {
    const src = String(dataUrl || '');
    if (!src.startsWith('data:image')) return src;
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('image decode failed'));
        im.src = src;
      });
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (!w || !h) return src;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return src;
      let dim = Math.max(320, Number(maxDim || 960) || 960);
      let q = Math.max(0.42, Math.min(0.86, Number(quality || 0.74) || 0.74));
      let best = src;
      for (let attempt = 0; attempt < 5; attempt++) {
        const scale = Math.min(1, dim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        canvas.width = cw;
        canvas.height = ch;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        best = canvas.toDataURL('image/jpeg', q);
        if (best.length <= maxChars) return best;
        dim = Math.max(320, Math.round(dim * 0.72));
        q = Math.max(0.42, q - 0.1);
      }
      return best.length < src.length ? best : src;
    } catch {
      return src;
    }
  }

  async function _sendMobileRealtimeAgentFunctionOutput(callId, output, options = {}) {
    if (!callId) return;
    const connections = __pmRealtimeAgent.functionCallConnections instanceof Map
      ? __pmRealtimeAgent.functionCallConnections
      : null;
    const conn = options?.connection || connections?.get(String(callId)) || __pmRealtimeAgent.conn;
    connections?.delete(String(callId));
    if (conn?.transport === 'codex_app_server' && conn?.codexBridgeSessionId) {
      let success = options.success !== false;
      try {
        const parsed = JSON.parse(String(output || '{}'));
        if (parsed?.ok === false || parsed?.success === false) success = false;
      } catch {}
      try {
        await mobileGatewayFetch('/api/realtime/codex-bridge/tool-output', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: conn.codexBridgeSessionId,
            requestId: String(callId),
            output: String(output || ''),
            success,
            previewDataUrl: String(options?.preview?.dataUrl || ''),
          }),
        });
      } catch (err) {
        _voiceDebug('codex-v3-tool-output-failed', { callId: String(callId), message: String(err?.message || err) });
      }
      return;
    }
    const dc = conn?.dc;
    if (!dc || dc.readyState !== 'open') return;
    try {
      const preview = options.preview && typeof options.preview === 'object' ? options.preview : null;
      const previewDataUrl = String(preview?.dataUrl || '').trim();
      const canSendPreviewImage = !!previewDataUrl && String(__pmRealtimeAgent.conn?.provider || 'openai_realtime') !== 'xai';
      // function_call_output (the text/metadata result) goes first, synchronously.
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output: String(output || '') },
      }));
      if (canSendPreviewImage) {
        const source = String(preview?.source || '').trim() || 'screen';
        const dimensions = preview?.width && preview?.height ? ` ${preview.width}x${preview.height}` : '';
        // Inject the ACTUAL screenshot pixels (downscaled to fit the data channel) so
        // the agent sees the screen, not just the metadata above.
        const imageUrl = await _downscaleDataUrlForRealtime(previewDataUrl, 1280, 0.82);
        if (dc.readyState === 'open') {
          dc.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `Fresh ${source} screenshot after the tool call${dimensions}. Look at this image directly and use it as visual context for the next realtime browser/desktop step.`,
                },
                {
                  type: 'input_image',
                  image_url: imageUrl,
                },
              ],
            },
          }));
        }
      }
      if (options.createResponse !== false && dc.readyState === 'open') dc.send(JSON.stringify({ type: 'response.create' }));
    } catch (err) {
      _voiceDebug('realtime-agent-send-output-failed', { message: err?.message || String(err) });
    }
  }

  // RTCDataChannel.send() throws on a closed native channel, while the OpenAI
  // WebSocket shim historically swallowed the same failure. Keep image delivery
  // transactional: callers only mark an image injected after this returns true.
  function _sendMobileRealtimeDataChannelEvent(dc, event) {
    if (!dc || dc.readyState !== 'open') return false;
    try {
      const result = dc.send(typeof event === 'string' ? event : JSON.stringify(event));
      return result !== false;
    } catch (err) {
      _voiceDebug('realtime-agent-data-channel-send-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  // Inject one image into the realtime conversation as a user item, with NO
  // response.create. The caller owns the turn boundary: images are delivered
  // immediately before the associated spoken/text turn, never speculatively when
  // the camera capture button is pressed.
  async function _injectRealtimeImageItemToConversation(img, label) {
    const options = arguments.length > 2 && arguments[2] && typeof arguments[2] === 'object' ? arguments[2] : {};
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    if (!img || img.realtimeInjected) return false;
    if (!isCurrent()) return false;
    if (img.realtimeInjectionPromise) return img.realtimeInjectionPromise;
    img.realtimeInjectionPromise = (async () => {
      const conn = __pmRealtimeAgent.conn;
      const provider = String(conn?.provider || 'openai_realtime');
      // AVAS v3 deliberately rejects the public Realtime event protocol. Its
      // supported browser->agent bridge is text, so the Codex path uses the
      // vision sidecar and appends the resulting visual context through the
      // bridge route instead of silently dropping conversation.item.create.
      if (_isMobileCodexV3RealtimeConnection(conn)) {
        if (!isCurrent()) return false;
        const injected = await _sendMobileCodexVisionSummaryToRealtime([img.dataUrl], {
          name: img.name,
          reason: 'image_staged',
          label,
          toast: false,
          isCurrent,
        });
        if (injected) {
          img.realtimeInjected = true;
          _voiceDebug('realtime-agent-image-injected-via-codex-bridge', { name: img.name });
        }
        return injected;
      }
      const dc = conn?.dc;
      if (!dc || dc.readyState !== 'open' || provider === 'xai') return false;
      try {
        const imageUrl = await _downscaleDataUrlForRealtime(img.dataUrl);
        if (
          !isCurrent()
          || __pmRealtimeAgent.conn !== conn
          || __pmRealtimeAgent.conn?.dc !== dc
          || dc.readyState !== 'open'
        ) return false;
        const sent = _sendMobileRealtimeDataChannelEvent(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: label || 'Image captured from the mobile camera. Keep it in view and use it as visual context for what I say next.' },
              { type: 'input_image', image_url: imageUrl },
            ],
          },
        });
        if (!sent) return false;
        img.realtimeInjected = true;
        _voiceDebug('realtime-agent-image-injected-for-turn', { name: img.name });
        return true;
      } catch (err) {
        _voiceDebug('realtime-agent-image-inject-failed', { message: err?.message || String(err) });
        return false;
      }
    })().finally(() => {
      if (!img.realtimeInjected) img.realtimeInjectionPromise = null;
    });
    return img.realtimeInjectionPromise;
  }

  async function _summarizeMobileXaiVisionImages(dataUrls, opts = {}) {
    const urls = (Array.isArray(dataUrls) ? dataUrls : [dataUrls])
      .map((u) => String(u || '').trim())
      .filter((u) => u.startsWith('data:image'));
    if (!urls.length) return '';
    if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return '';
    const isVideo = urls.length > 1;
    try {
      // Camera stills can be several megabytes on iOS. Keep the vision-sidecar
      // request comfortably below mobile proxy/body limits while preserving the
      // original full-resolution image for the local preview and Codex path.
      const requestUrls = await Promise.all(
        urls.map((url) => _downscaleDataUrlForRealtime(url, isVideo ? 960 : 1280, isVideo ? 0.66 : 0.72, 180000)),
      );
      const reqBody = isVideo
        ? { frames: requestUrls.map((u) => ({ dataUrl: u })), durationMs: Number(opts.durationMs || 0) || 0, name: String(opts.name || 'camera video') }
        : { dataUrl: requestUrls[0], name: String(opts.name || 'camera photo') };
      _voiceDebug('realtime-agent-xai-summary-start', {
        isVideo,
        count: urls.length,
        originalBytes: urls.reduce((sum, url) => sum + url.length, 0),
        requestBytes: requestUrls.reduce((sum, url) => sum + url.length, 0),
        reason: opts.reason || '',
      });
      const res = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', {
        method: 'POST',
        body: JSON.stringify(reqBody),
        timeoutMs: 45_000,
      });
      if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return '';
      const summary = String(res?.summary || '').trim();
      if (!summary) { _voiceDebug('realtime-agent-xai-summary-empty', { error: res?.error || '' }); return ''; }
      _voiceDebug('realtime-agent-xai-summary-ready', { isVideo, summaryLen: summary.length });
      return summary;
    } catch (err) {
      const message = String(err?.message || err || '').trim();
      _voiceDebug('realtime-agent-xai-summary-failed', {
        message,
        status: Number(err?.status || 0) || 0,
        code: String(err?.code || '').trim(),
        bodyError: String(err?.body?.error || err?.body?.message || '').trim().slice(0, 240),
      });
      if (opts.toast !== false) {
        try { pmToast(`Could not summarize the image for xAI voice${message ? `: ${message.slice(0, 180)}` : '.'}`, 'error'); } catch {}
      }
      return '';
    }
  }

  async function _sendMobileXaiVisionSummaryToRealtime(dataUrls, opts = {}) {
    if (String(__pmRealtimeAgent.conn?.provider || 'openai_realtime') !== 'xai') return false;
    const urls = (Array.isArray(dataUrls) ? dataUrls : [dataUrls])
      .map((u) => String(u || '').trim())
      .filter((u) => u.startsWith('data:image'));
    if (!urls.length) return false;
    if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return false;
    const isVideo = urls.length > 1;
    const promptText = String(opts.promptText || '').trim();
    const summary = String(opts.precomputedSummary || await _summarizeMobileXaiVisionImages(urls, opts)).trim();
    if (!summary) return false;
    if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return false;
    try {
      const dc = __pmRealtimeAgent.conn?.dc;
      if (!dc || dc.readyState !== 'open' || String(__pmRealtimeAgent.conn?.provider) !== 'xai') return false;
      const sent = _sendMobileRealtimeDataChannelEvent(dc, {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: [
              `[Visual context from my camera ${isVideo ? 'video clip' : 'photo'}, described by the vision sidecar since you can't see images directly]: ${summary}`,
              promptText ? `User message for this visual context: ${promptText}` : '',
              'Treat this as the image I am referring to now. Do not say you are waiting for the image unless this visual context is absent.',
            ].filter(Boolean).join('\n'),
          }],
        },
      });
      if (!sent) return false;
      _voiceDebug('realtime-agent-xai-summary-injected', { isVideo, summaryLen: summary.length });
      return true;
    } catch (err) {
      const message = String(err?.message || err || '').trim();
      _voiceDebug('realtime-agent-xai-summary-failed', { message });
      if (opts.toast !== false) {
        try { pmToast(`Could not summarize the image for xAI voice${message ? `: ${message.slice(0, 180)}` : '.'}`, 'error'); } catch {}
      }
      return false;
    }
  }

  // Kept for direct callers, but the response-critical path now awaits summary
  // injection from _flushMobileRealtimeAgentPendingImages before responding.
  async function _kickoffMobileXaiVisionSummary(dataUrls, opts = {}) {
    return _sendMobileXaiVisionSummaryToRealtime(dataUrls, opts);
  }

  function _stageMobileRealtimeAgentAttachmentPreview(attachment, sessionId, options = {}) {
    const cameraTurnId = Number(options.cameraTurnId || attachment?.turnId || 0) || 0;
    const cameraFrameId = String(options.cameraFrameId || attachment?.frameId || '').trim();
    const liveVision = __pmRealtimeAgent.liveCameraVision || {};
    const isCurrentLiveCameraTurn = cameraTurnId > 0
      && liveVision.active === true
      && !Number(liveVision.responseStartedAt || 0)
      && Number(liveVision.turnId || 0) === cameraTurnId;
    const previewAttachment = {
      kind: String(attachment?.kind || 'file').trim() || 'file',
      name: String(attachment?.name || 'Voice attachment').trim(),
      mimeType: String(attachment?.mimeType || ''),
      dataUrl: String(attachment?.dataUrl || ''),
      base64: String(attachment?.base64 || ''),
      workspacePath: String(attachment?.workspacePath || ''),
      path: String(attachment?.path || ''),
      sizeLabel: String(attachment?.sizeLabel || ''),
      cameraTurnId,
      cameraFrameId,
      capturedAt: Number(options.capturedAt || attachment?.capturedAt || 0) || 0,
      attachmentState: String(options.attachmentState || attachment?.attachmentState || '').trim(),
    };
    const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    try {
      if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
      let turn = __pmRealtimeAgent.stagedAttachmentTurn || __pmRealtimeAgent.stagedImageTurn;
      const currentUserTurn = __pmRealtimeAgent.turn?.mobileUserTurn;
      const currentExchangeId = isCurrentLiveCameraTurn ? _ensureMobileRealtimeExchangeId() : '';
      // The authoritative live-camera frame can finish after transcription. In
      // that case, extend the already-rendered user bubble instead of creating a
      // second attachment-only bubble after the spoken text.
      if (
        isCurrentLiveCameraTurn
        && currentUserTurn
        && __pmChat.threads[sid].includes(currentUserTurn)
        && (!turn || Number(turn?._pmCameraTurnId || 0) !== cameraTurnId)
      ) {
        turn = currentUserTurn;
      }
      const existingCameraTurnId = Number(turn?._pmCameraTurnId || 0) || 0;
      const canReuseStagedTurn = turn
        && __pmChat.threads[sid].includes(turn)
        && (!cameraTurnId || !existingCameraTurnId || existingCameraTurnId === cameraTurnId);
      if (canReuseStagedTurn) {
        turn.body = turn.body || { text: '', attachments: [] };
        turn.body.attachments = [...(turn.body.attachments || []), previewAttachment];
      } else {
        turn = {
          role: 'user', streaming: true, staged: true, time: '', timestamp: Date.now(),
          body: { text: '', source: 'voice', attachments: [previewAttachment] },
          attachmentPreviews: [previewAttachment], content: '', source: 'voice_agent_realtime',
        };
        if (currentExchangeId) {
          turn.workflowGroupId = currentExchangeId;
          turn.workflowPart = 'voice_user';
        }
        __pmChat.threads[sid].push(turn);
      }
      if (cameraTurnId) {
        turn._pmCameraTurnId = cameraTurnId;
        turn._pmCameraFrameId = cameraFrameId;
        turn._pmCameraAttachmentState = previewAttachment.attachmentState || 'associated';
      }
      turn.attachmentPreviews = turn.body.attachments;
      if (isCurrentLiveCameraTurn) {
        turn.workflowGroupId = currentExchangeId || turn.workflowGroupId || _ensureMobileRealtimeExchangeId();
        turn.workflowPart = 'voice_user';
        __pmRealtimeAgent.turn.mobileUserTurn = turn;
      }
      __pmRealtimeAgent.stagedAttachmentTurn = turn;
      __pmRealtimeAgent.stagedImageTurn = turn;
      _persistMobileThreadSnapshot(sid);
      _renderMobileChatSessionNow(sid);
      _renderRecent();
      _notifyMobileChatVoiceUpdate(sid, {
        reason: options.source === 'realtime_live_camera' ? 'realtime_live_camera_attached' : 'realtime_attachment_staged',
        force: true,
        cameraTurnId: cameraTurnId || undefined,
        cameraFrameId: cameraFrameId || undefined,
      });
    } catch {}
    // The Voice page owns a first-class center preview deck. Feed staged user
    // attachments into it as well, instead of making users infer success from a
    // hidden chat bubble.
    try { __pmRealtimeAgent.enqueuePreviews?.([previewAttachment], { transient: options.previewTransient === true }); } catch {}
    return previewAttachment;
  }

  function _mobileRealtimeAgentPendingFileContext() {
    const files = Array.isArray(__pmRealtimeAgent?.pendingFiles) ? __pmRealtimeAgent.pendingFiles : [];
    const available = files.filter((item) => String(item?.workspacePath || '').trim());
    if (!available.length) return '';
    return [
      '[VOICE_ATTACHMENT]',
      'The user attached these files for the next spoken request. Use them as context; do not reply to this attachment event by itself.',
      ...available.map((item) => `- ${String(item.name || 'Attachment').trim()}: ${String(item.workspacePath).trim()}`),
    ].join('\n');
  }

  function _consumeMobileRealtimeAgentPendingFiles(reason = 'spoken_turn') {
    const count = Array.isArray(__pmRealtimeAgent?.pendingFiles) ? __pmRealtimeAgent.pendingFiles.length : 0;
    __pmRealtimeAgent.pendingFiles = [];
    if (count) _voiceDebug?.('realtime-agent-files-consumed', { count, reason });
    return count;
  }

  function _stageMobileRealtimeAgentFile(attachment, sessionId) {
    const workspacePath = String(attachment?.workspacePath || '').trim();
    if (!workspacePath) return null;
    const file = {
      kind: String(attachment?.kind || 'file').trim() || 'file',
      name: String(attachment?.name || 'Voice attachment').trim(),
      mimeType: String(attachment?.mimeType || ''),
      workspacePath,
      path: String(attachment?.path || workspacePath),
      sizeLabel: String(attachment?.sizeLabel || ''),
    };
    __pmRealtimeAgent.pendingFiles = Array.isArray(__pmRealtimeAgent.pendingFiles)
      ? __pmRealtimeAgent.pendingFiles
      : [];
    const existing = __pmRealtimeAgent.pendingFiles.some((item) => String(item?.workspacePath || '') === file.workspacePath);
    if (!existing) __pmRealtimeAgent.pendingFiles.push(file);
    _stageMobileRealtimeAgentAttachmentPreview(file, sessionId);
    return file;
  }

  function _queueMobileRealtimeAgentImage(attachment, options = {}) {
    const dataUrl = String(attachment?.dataUrl || '').trim();
    if (!dataUrl) return null;
    const img = {
      dataUrl,
      name: String(attachment?.name || 'Camera snapshot').trim(),
      mimeType: String(attachment?.mimeType || 'image/jpeg'),
      base64: String(attachment?.base64 || dataUrl.replace(/^data:[^;]+;base64,/, '')),
      realtimeInjected: false,
      frameId: String(attachment?.frameId || '').trim(),
      turnId: Number(attachment?.turnId || 0) || 0,
      capturedAt: Number(attachment?.capturedAt || 0) || 0,
      encodedAt: Number(attachment?.encodedAt || 0) || 0,
    };
    if (String(__pmRealtimeAgent.conn?.provider || '') === 'xai') {
      img.xaiSummaryPromise = _summarizeMobileXaiVisionImages([dataUrl], {
        name: img.name,
        reason: options.reason || 'image_staged',
        toast: false,
        isCurrent: options.isCurrent,
      });
    }
    if (!Array.isArray(__pmRealtimeAgent.pendingImages)) __pmRealtimeAgent.pendingImages = [];
    __pmRealtimeAgent.pendingImages.push(img);
    // Update the session-level runtime prompt as soon as the capture is staged.
    // The actual image event waits for the next turn so it cannot race VAD.
    _sendMobileRealtimeCameraRuntimeUpdate(options.reason || 'image_staged');
    return img;
  }

  // Stage a captured photo: show it in the chat bubble and hold it for the nex
  // spoken/text turn. Sending only at the turn boundary keeps the image and the
  // transcription in one ordered realtime conversation window. Live camera
  // frames use this same queue with preview/auto-flush disabled, then explicitly
  // flush the queue before their turn response.
  function _stageMobileRealtimeAgentImage(attachment, sessionId, options = {}) {
    const sid = String(sessionId || __pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    const img = _queueMobileRealtimeAgentImage(attachment, options);
    if (!img) return false;
    if (options.skipAutoFlush !== true) _scheduleMobileRealtimeAgentPendingImageFlush(options.reason || 'image_staged');
    if (options.preview !== false) {
      _stageMobileRealtimeAgentAttachmentPreview({
        kind: 'image', name: img.name, mimeType: img.mimeType, dataUrl: img.dataUrl, base64: img.base64, sizeLabel: '',
        frameId: img.frameId, turnId: img.turnId, capturedAt: img.capturedAt, encodedAt: img.encodedAt,
      }, sid);
    }
    if (options.toast !== false) {
      try { pmToast('Photo ready - say what you want to know about it.', 'success'); } catch {}
    }
    _voiceDebug('realtime-agent-image-staged', { count: __pmRealtimeAgent.pendingImages.length });
    return true;
  }

  // Flush staged photos to the model as user input_image items (downscaled), with
  // NO response.create — the spoken turn that follows is what triggers the model's
  // response, so the image is "attached" to what the user says. Called on
  // speech_started (always-listening) and on PTT release.
  async function _flushMobileRealtimeAgentPendingImages(reason = 'speech', options = {}) {
    const images = __pmRealtimeAgent.pendingImages;
    if (!images || !images.length) return false;
    const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    const all = images.slice();
    const restorePendingImages = () => {
      const current = Array.isArray(__pmRealtimeAgent.pendingImages)
        ? __pmRealtimeAgent.pendingImages
        : [];
      const unsent = all.filter((image) => !image?.realtimeInjected);
      __pmRealtimeAgent.pendingImages = [
        ...current.filter((image) => !all.includes(image)),
        ...unsent,
      ];
    };
    const dc = __pmRealtimeAgent.conn?.dc;
    if (!dc || dc.readyState !== 'open') {
      restorePendingImages();
      return false;
    }
    _sendMobileRealtimeCameraTurnContext({
      imageCount: all.length,
      turnId: options.turnId,
      userText: options.promptText,
      feedOpen: options.feedOpen,
    });
    if (_isMobileCodexV3RealtimeConnection()) {
      let injected = false;
      for (const image of all) {
        if (!isCurrent()) break;
        const label = all.length === 1
          ? 'Live camera image attached.'
          : `Live camera image ${all.indexOf(image) + 1} of ${all.length} attached.`;
        if (await _injectRealtimeImageItemToConversation(image, options.label || label, { isCurrent })) {
          injected = true;
        }
      }
      restorePendingImages();
      if (!_mobileRealtimeCameraPendingImageCount() && !_mobileRealtimeCameraFeedIsOpen()) {
        __pmRealtimeAgent.cameraRuntime.turnContextKey = '';
      }
      _sendMobileRealtimeCameraRuntimeUpdate('images_flushed_codex');
      _voiceDebug('realtime-agent-image-flushed-codex-bridge', {
        count: all.length,
        injected: all.filter((image) => image.realtimeInjected).length,
        reason,
      });
      return injected;
    }
    if (provider === 'xai') {
      const promptText = String(options.promptText || '').trim();
      __pmRealtimeAgent.turn.xaiVisionInjecting = true;
      __pmRealtimeAgent.turn.xaiVisionInjectReason = reason;
      let injected = false;
      try {
        let summary = String(options.precomputedSummary || '').trim();
        if (!summary) {
          const stagedSummaries = await Promise.all(
            all.map((im) => im?.xaiSummaryPromise).filter((promise) => promise && typeof promise.then === 'function'),
          ).catch(() => []);
          summary = stagedSummaries.map((value) => String(value || '').trim()).filter(Boolean).join('\n\n');
        }
        injected = await _sendMobileXaiVisionSummaryToRealtime(
          all.map((im) => im.dataUrl),
          {
            name: all.length > 1 ? 'camera images' : (all[0]?.name || 'camera photo'),
            reason,
            promptText,
            precomputedSummary: summary,
            isCurrent,
            toast: options.toast,
          },
        );
      } finally {
        __pmRealtimeAgent.turn.xaiVisionInjecting = false;
        __pmRealtimeAgent.turn.xaiVisionInjectReason = '';
      }
      if (injected) all.forEach((image) => { image.realtimeInjected = true; });
      if (injected) {
        const liveCameraState = _mobileRealtimeLiveVisionState();
        if (liveCameraState.active) {
          liveCameraState.xaiVisionInjectionAt = Date.now();
          liveCameraState.xaiVisionInjectionReason = reason;
        }
      }
      restorePendingImages();
      if (!_mobileRealtimeCameraPendingImageCount() && !_mobileRealtimeCameraFeedIsOpen()) {
        __pmRealtimeAgent.cameraRuntime.turnContextKey = '';
      }
      _sendMobileRealtimeCameraRuntimeUpdate('images_flushed_xai');
      _voiceDebug('realtime-agent-image-flushed-xai-summary', { count: all.length, reason, injected });
      const shouldCreateVisionResponse = options.createResponse === true
        || (reason === 'speech_started' && options.createResponse !== false);
      if (injected && shouldCreateVisionResponse && __pmRealtimeAgent.conn?.dc?.readyState === 'open') {
        _sendMobileRealtimeDataChannelEvent(__pmRealtimeAgent.conn?.dc, {
          type: 'response.create',
          response: {
            output_modalities: ['audio'],
            instructions: promptText
              ? 'Answer using the injected visual context and the user message. Do not say the image has not arrived.'
              : 'Answer using the injected visual context. Do not say the image has not arrived.',
          },
        });
      }
      return !!injected;
    }
    // Deliver every staged image in order. Multiple captures from one turn stay
    // separate so each image fits the realtime channel and the model can inspec
    // them as a sequence.
    try {
      const promptText = String(options.promptText || '').trim();
      let delivered = 0;
      for (let i = 0; i < all.length; i++) {
        const image = all[i];
        if (!isCurrent()) break;
        if (image?.realtimeInjected) {
          delivered += 1;
          continue;
        }
        const label = all.length === 1
          ? 'Live camera image attached.'
          : `Live camera image ${i + 1} of ${all.length} attached.`;
        const sent = await _injectRealtimeImageItemToConversation(image, options.label || label, { isCurrent });
        if (sent) delivered += 1;
        else if (__pmRealtimeAgent.conn?.dc?.readyState !== 'open') break;
      }
      restorePendingImages();
      if (!_mobileRealtimeCameraPendingImageCount() && !_mobileRealtimeCameraFeedIsOpen()) {
        __pmRealtimeAgent.cameraRuntime.turnContextKey = '';
      }
      _sendMobileRealtimeCameraRuntimeUpdate('images_flushed');
      _voiceDebug('realtime-agent-image-flushed', {
        count: delivered,
        pending: __pmRealtimeAgent.pendingImages.length,
        reason,
      });
      if (options.createResponse === true && delivered > 0 && __pmRealtimeAgent.conn?.dc?.readyState === 'open') {
        _sendMobileRealtimeDataChannelEvent(__pmRealtimeAgent.conn?.dc, {
          type: 'response.create',
          response: {
            output_modalities: ['audio'],
            instructions: promptText
              ? 'Use the attached mobile camera image and the user message. Do not say no image was sent unless the image input is actually absent.'
              : 'Use the attached mobile camera image directly. Do not claim the image was saved to the phone.',
          },
        });
      }
      return delivered > 0;
    } catch (err) {
      restorePendingImages();
      _voiceDebug('realtime-agent-image-flush-failed', { message: err?.message || String(err) });
      return false;
    }
  }

  async function _awaitMobileRealtimeCameraOperation(operation, timeoutMs = 900, onTimeout = null) {
    const timeout = Math.max(150, Number(timeoutMs || 900) || 900);
    let timer = null;
    const source = Promise.resolve()
      .then(() => (typeof operation === 'function' ? operation() : operation))
      .then((value) => ({ timedOut: false, value }), () => ({ timedOut: false, value: null }));
    const result = await Promise.race([
      source,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true, value: null }), timeout);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (result?.timedOut) {
      try { onTimeout?.(); } catch {}
      return null;
    }
    return result?.value ?? null;
  }

  function _mobileRealtimeLiveCameraAssociationTimeoutMs() {
    // OpenAI only needs the local canvas/downscale and data-channel send. xAI
    // must wait for the HTTP vision sidecar, whose normal mobile request budge
    // is much longer than a realtime audio tick.
    const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
    if (provider === 'xai' || _isMobileCodexV3RealtimeConnection(__pmRealtimeAgent.conn)) return 48_000;
    return 12_000;
  }

  function _mobileRealtimeLiveVisionState() {
    return __pmRealtimeAgent.liveCameraVision || (__pmRealtimeAgent.liveCameraVision = {
      active: false,
      timer: null,
      inFlight: null,
      prepareInFlight: null,
      queuedFrame: null,
      lastSentAt: 0,
      lastAssociatedFrameAt: 0,
      lastAssociatedCapturedAt: 0,
      lastAssociatedFrameId: '',
      lastAssociatedTurnId: 0,
      frameSequence: 0,
      generation: 0,
      turnId: 0,
      turnStartedAt: 0,
      turnCaptureStartedAt: 0,
      turnFrameId: '',
      attachmentVisibleTurnId: 0,
      phase: 'idle',
      responseGateActive: false,
      preparationReady: false,
      pendingAttachmentPreparation: null,
      audioCommitted: false,
      responseRequestedAt: 0,
      responseStartedAt: 0,
      resumeAfterXaiVisionResponse: false,
      xaiVisionInjectionAt: 0,
      xaiVisionInjectionReason: '',
    });
  }

  function _mobileRealtimeXaiLiveCameraCanResume() {
    if (String(__pmRealtimeAgent.conn?.provider || '') !== 'xai') return false;
    if (typeof __pmRealtimeAgent.liveCameraFrameReader !== 'function') return false;
    if (!_mobileRealtimeCameraFeedIsOpen()) return false;
    const listenMode = String(__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode || '').trim();
    return listenMode === 'always_listening' || __pmRealtimeAgent.ptt?.held === true;
  }

  function _mobileRealtimeLiveVisionIsCurrent(state, generation, turnId) {
    return !!(
      state?.active
      && Number(state.generation || 0) === Number(generation || 0)
      && Number(state.turnId || 0) === Number(turnId || 0)
      && !Number(state.responseStartedAt || 0)
      && !Number(state.responseRequestedAt || 0)
      && !__pmRealtimeAgent.activeResponse
      && !__pmVoice.realtimeSpeechActiveResponse
      && __pmRealtimeAgent.conn?.dc?.readyState === 'open'
    );
  }

  async function _associateMobileRealtimeLiveCameraFrame(frame, options = {}) {
    const state = _mobileRealtimeLiveVisionState();
    const generation = Number(options.generation || state.generation || 0);
    const turnId = Number(options.turnId || state.turnId || 0);
    const isCurrent = () => _mobileRealtimeLiveVisionIsCurrent(state, generation, turnId);
    const dataUrl = String(frame?.dataUrl || '').trim();
    if (!dataUrl.startsWith('data:image')) return false;
    const capturedAt = Number(frame?.capturedAt || 0) || Date.now();
    const encodedAt = Number(frame?.encodedAt || capturedAt) || capturedAt;
    const frameId = String(frame?.frameId || `live_camera_${turnId}_${capturedAt}_${++state.frameSequence}`);
    if (state.lastAssociatedTurnId === turnId && state.lastAssociatedFrameId === frameId) {
      _voiceDebug('realtime-agent-live-camera-frame-already-associated', { turnId, frameId });
      return true;
    }
    const ageMs = Math.max(0, Date.now() - capturedAt);
    if (ageMs > 3200) {
      _voiceDebug('realtime-agent-live-camera-frame-dropped-stale', {
        reason: options.reason || 'live_camera',
        ageMs,
        turnId,
        frameId,
      });
      return false;
    }
    const turnCaptureStartedAt = Number(options.turnCaptureStartedAt || state.turnCaptureStartedAt || 0) || 0;
    if (options.authoritative === true && turnCaptureStartedAt && capturedAt < turnCaptureStartedAt - 1200) {
      _voiceDebug('realtime-agent-live-camera-frame-dropped-before-turn', {
        reason: options.reason || 'live_camera',
        turnId,
        frameId,
        capturedAt,
        turnCaptureStartedAt,
      });
      return false;
    }
    if (!isCurrent()) {
      _voiceDebug('realtime-agent-live-camera-frame-dropped-not-current', {
        reason: options.reason || 'live_camera',
        turnId,
        frameId,
      });
      return false;
    }
    const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
    const image = {
      dataUrl,
      name: String(frame?.name || `Live camera · turn ${turnId}`),
      mimeType: 'image/jpeg',
      realtimeInjected: false,
      frameId,
      turnId,
      capturedAt,
      encodedAt,
    };
    const captureMs = Math.max(0, encodedAt - capturedAt);
    const uploadStartedAt = Date.now();
    _voiceDebug('realtime-agent-live-camera-encode-ready', {
      reason: options.reason || 'live_camera',
      turnId,
      frameId,
      capturedAt,
      encodedAt,
      captureMs,
      bytes: dataUrl.length,
    });
    _voiceDebug('realtime-agent-live-camera-association-start', {
      reason: options.reason || 'live_camera',
      provider,
      turnId,
      frameId,
      ageMs,
      captureMs,
      bytes: dataUrl.length,
    });
    _voiceDebug('realtime-agent-live-camera-upload-start', {
      reason: options.reason || 'live_camera',
      provider,
      turnId,
      frameId,
    });
    _sendMobileRealtimeCameraTurnContext({
      turnId,
      imageCount: 1,
      feedOpen: true,
    });
    let sent = false;
    let associationRun = null;
    try {
      const correlation = `[LIVE_CAMERA_VOICE_TURN turn=${turnId} frame=${frameId}]`;
      const sid = String(
        __pmRealtimeAgent.conn?.sessionId
          || __pmVoice?.targetSessionId
          || __pmChat?.activeSessionId
          || MOBILE_CHAT_SESSION_ID,
      ).trim() || MOBILE_CHAT_SESSION_ID;
      // Use the exact same queue and flush transaction as the capture button.
      // The old live path sent directly to each provider, which meant OpenAI
      // could time out while downscaling and xAI could bypass the staged vision
      // summary entirely.
      const previousPreparation = state.pendingAttachmentPreparation;
      associationRun = Promise.resolve(previousPreparation)
        .catch(() => false)
        .then(async () => {
          if (!isCurrent()) return false;
          const staged = _stageMobileRealtimeAgentImage({
            dataUrl: image.dataUrl,
            name: image.name,
            mimeType: image.mimeType,
            base64: image.base64,
            frameId,
            turnId,
            capturedAt,
            encodedAt,
          }, sid, {
            toast: false,
            preview: false,
            skipAutoFlush: true,
            reason: options.reason || 'live_camera_speech',
            isCurrent,
          });
          if (!staged) return false;
          return _flushMobileRealtimeAgentPendingImages(options.reason || 'live_camera_speech', {
            turnId,
            promptText: correlation,
            label: `${correlation} Live camera image attached.`,
            feedOpen: true,
            isCurrent,
            toast: false,
          });
        });
      state.pendingAttachmentPreparation = associationRun;
      sent = await associationRun;
      if (state.pendingAttachmentPreparation === associationRun) state.pendingAttachmentPreparation = null;
    } catch (err) {
      if (state.pendingAttachmentPreparation === associationRun) {
        state.pendingAttachmentPreparation = null;
      }
      _voiceDebug('realtime-agent-live-camera-association-failed', {
        reason: options.reason || 'live_camera',
        provider,
        turnId,
        frameId,
        uploadMs: Math.max(0, Date.now() - uploadStartedAt),
        message: err?.message || String(err),
      });
      return false;
    }
    const associatedAt = Date.now();
    _voiceDebug('realtime-agent-live-camera-upload-finished', {
      reason: options.reason || 'live_camera',
      provider,
      turnId,
      frameId,
      sent: !!sent,
      uploadMs: Math.max(0, associatedAt - uploadStartedAt),
    });
    // The response boundary may advance immediately after the data-channel
    // accepts the image. Do not discard a successfully sent frame just because
    // the response state changed while the UI/preview bookkeeping was running.
    // _injectRealtimeImageItemToConversation already checked the generation and
    // channel before sending.
    if (!sent) {
      state.phase = 'association_failed';
      return false;
    }
    state.lastSentAt = associatedAt;
    state.lastAssociatedFrameAt = associatedAt;
    state.lastAssociatedCapturedAt = capturedAt;
    state.lastAssociatedFrameId = frameId;
    state.lastAssociatedTurnId = turnId;
    state.turnFrameId = frameId;
    state.phase = sent ? 'associated' : 'association_failed';
    _voiceDebug('realtime-agent-live-camera-frame-associated', {
      reason: options.reason || 'live_camera',
      provider,
      sent: !!sent,
      turnId,
      frameId,
      capturedAt,
      encodedAt,
      associatedAt,
      ageMs: Math.max(0, associatedAt - capturedAt),
      captureMs,
      uploadMs: Math.max(0, associatedAt - uploadStartedAt),
    });
    if (sent && options.authoritative === true && state.attachmentVisibleTurnId !== turnId) {
      const sid = String(__pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
      const visibleAttachment = {
        kind: 'image',
        name: `Live camera attached · turn ${turnId}`,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
        frameId,
        turnId,
        capturedAt,
        attachmentState: 'associated',
      };
      try {
        _stageMobileRealtimeAgentAttachmentPreview(visibleAttachment, sid, {
          cameraTurnId: turnId,
          cameraFrameId: frameId,
          capturedAt,
          source: 'realtime_live_camera',
          attachmentState: 'associated',
          previewTransient: true,
        });
        __pmRealtimeAgent.enqueuePreviews?.([visibleAttachment], { transient: true });
        state.attachmentVisibleTurnId = turnId;
        _voiceDebug('realtime-agent-live-camera-attachment-visible', {
          provider,
          turnId,
          frameId,
          capturedAt,
        });
      } catch (err) {
        _voiceDebug('realtime-agent-live-camera-attachment-visible-failed', {
          turnId,
          frameId,
          message: err?.message || String(err),
        });
      }
    }
    return !!sent;
  }

  function _stopMobileRealtimeLiveCameraVision(reason = 'speech_finished', options = {}) {
    const state = _mobileRealtimeLiveVisionState();
    const preserveCameraSession = options.preserveCameraSession === true && _mobileRealtimeCameraSessionIsOpen();
    const restoreResponseCreation = state.responseGateActive === true && !preserveCameraSession;
    state.active = false;
    state.generation = Number(state.generation || 0) + 1;
    state.queuedFrame = null;
    state.prepareInFlight = null;
    state.phase = 'idle';
    state.responseGateActive = false;
    state.preparationReady = false;
    state.pendingAttachmentPreparation = null;
    state.audioCommitted = false;
    if (!preserveCameraSession) {
      state.resumeAfterXaiVisionResponse = false;
    }
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (restoreResponseCreation) _sendMobileRealtimeAgentCreateResponseFlag(true);
    _voiceDebug('realtime-agent-live-camera-stopped', { reason });
  }

  function _queueMobileRealtimeLiveCameraFrame(reason = 'speech_active') {
    const state = _mobileRealtimeLiveVisionState();
    if (!state.active) return false;
    if (state.prepareInFlight) return true;
    const reader = __pmRealtimeAgent.liveCameraFrameReader;
    const asyncReader = __pmRealtimeAgent.liveCameraFrameAsyncReader;
    if (typeof reader !== 'function') return false;
    let frame = null;
    try { frame = reader(); } catch {}
    const dataUrl = String(frame?.dataUrl || '').trim();
    if (!dataUrl.startsWith('data:image')) return false;
    // Keep only the newest frame if the vision sidecar or network takes longer
    // than a second. This prevents stale camera frames from building a queue.
    if (state.queuedFrame && String(state.queuedFrame.dataUrl || '') !== dataUrl) {
      _voiceDebug('realtime-agent-live-camera-frame-dropped-backpressure', {
        reason,
        turnId: state.turnId,
        droppedFrameId: String(state.queuedFrame.frameId || ''),
        replacementFrameId: String(frame?.frameId || ''),
      });
    }
    state.queuedFrame = {
      ...frame,
      dataUrl,
      capturedAt: Number(frame?.capturedAt || Date.now()) || Date.now(),
      frameId: String(frame?.frameId || `live_camera_${state.turnId}_${Date.now()}_${++state.frameSequence}`),
      reason,
    };
    if (state.inFlight) return true;
    const generation = Number(state.generation || 0);
    const turnId = Number(state.turnId || 0);
    state.inFlight = (async () => {
      while (_mobileRealtimeLiveVisionIsCurrent(state, generation, turnId) && state.queuedFrame) {
        const current = state.queuedFrame;
        state.queuedFrame = null;
        let freshest = null;
        if (typeof asyncReader === 'function') {
          freshest = await _awaitMobileRealtimeCameraOperation(
            () => asyncReader(),
            900,
            () => _voiceDebug('realtime-agent-live-camera-frame-read-timeout', { reason, turnId }),
          );
        }
        if (!_mobileRealtimeLiveVisionIsCurrent(state, generation, turnId)) break;
        const selected = String(freshest?.dataUrl || '').startsWith('data:image') ? freshest : current;
        await _awaitMobileRealtimeCameraOperation(
          () => _associateMobileRealtimeLiveCameraFrame(selected, { reason, generation, turnId }),
          _mobileRealtimeLiveCameraAssociationTimeoutMs(),
          () => {
            if (Number(state.generation || 0) === generation) state.generation += 1;
            _voiceDebug('realtime-agent-live-camera-association-timeout', { reason, turnId });
          },
        );
      }
    })().finally(() => {
      state.inFlight = null;
      if (_mobileRealtimeLiveVisionIsCurrent(state, generation, turnId) && state.queuedFrame) {
        _queueMobileRealtimeLiveCameraFrame('queued_latest_frame');
      }
    });
    return true;
  }

  async function _prepareMobileRealtimeLiveCameraForTurn(reason = 'turn_ready') {
    const state = _mobileRealtimeLiveVisionState();
    // Camera opening and the first mic gesture can overlap on mobile Safari. If
    // the reader became available after speech_started/PTT press, recover the
    // turn here before committing audio. Never create a new camera turn after a
    // response has already begun.
    if (!state.active
      && !__pmRealtimeAgent.activeResponse
      && !__pmVoice.realtimeSpeechActiveResponse
      && typeof __pmRealtimeAgent.liveCameraFrameReader === 'function'
      && __pmRealtimeAgent.conn?.dc?.readyState === 'open') {
      _startMobileRealtimeLiveCameraVision(`${reason}_late_camera_ready`);
    }
    if (!state.active || state.prepareInFlight) return state.prepareInFlight || false;
    const reader = __pmRealtimeAgent.liveCameraFrameReader;
    const asyncReader = __pmRealtimeAgent.liveCameraFrameAsyncReader;
    if (typeof reader !== 'function') return false;
    const generation = Number(state.generation || 0);
    const turnId = Number(state.turnId || 0);
    state.phase = 'preparing';
    const run = (async () => {
      // Drain an older association before selecting the turn's final frame. The
      // generation check below prevents that older request from becoming the
      // current frame if the response has already started.
      if (state.inFlight) {
        let timedOut = false;
        await _awaitMobileRealtimeCameraOperation(
          () => state.inFlight,
          _mobileRealtimeLiveCameraAssociationTimeoutMs(),
          () => {
            timedOut = true;
            if (Number(state.generation || 0) === generation) state.generation += 1;
            _voiceDebug('realtime-agent-live-camera-previous-association-timeout', { reason, turnId });
          },
        );
        if (timedOut) return false;
      }
      if (!_mobileRealtimeLiveVisionIsCurrent(state, generation, turnId)) return false;
      let frame = null;
      try { frame = reader(); } catch {}
      let freshest = null;
      if (typeof asyncReader === 'function') {
        let timedOut = false;
        freshest = await _awaitMobileRealtimeCameraOperation(
          () => asyncReader({ force: true, reason, turnId }),
          1000,
          () => {
            timedOut = true;
            if (Number(state.generation || 0) === generation) state.generation += 1;
            _voiceDebug('realtime-agent-live-camera-turn-frame-read-timeout', { reason, turnId });
          },
        );
        if (timedOut) return false;
      }
      if (!_mobileRealtimeLiveVisionIsCurrent(state, generation, turnId)) return false;
      const selectedCandidate = String(freshest?.dataUrl || '').startsWith('data:image') ? freshest : frame;
      const minTurnFrameAt = Number(state.turnCaptureStartedAt || 0) - 1200;
      const selected = selectedCandidate && (!minTurnFrameAt || Number(selectedCandidate.capturedAt || 0) >= minTurnFrameAt)
        ? selectedCandidate
        : null;
      if (!selected) {
        _voiceDebug('realtime-agent-live-camera-turn-frame-missing', {
          reason,
          turnId,
          turnCaptureStartedAt: state.turnCaptureStartedAt || 0,
          cachedFrameAt: Number(frame?.capturedAt || 0) || 0,
          freshFrameAt: Number(freshest?.capturedAt || 0) || 0,
        });
      }
      const sent = await _awaitMobileRealtimeCameraOperation(
        () => _associateMobileRealtimeLiveCameraFrame(selected, {
          reason,
          generation,
          turnId,
          authoritative: true,
          turnCaptureStartedAt: state.turnCaptureStartedAt,
        }),
        _mobileRealtimeLiveCameraAssociationTimeoutMs(),
        () => {
          if (Number(state.generation || 0) === generation) state.generation += 1;
          state.phase = 'association_timeout';
          _voiceDebug('realtime-agent-live-camera-turn-association-timeout', { reason, turnId });
        },
      );
      state.preparationReady = true;
      _voiceDebug('realtime-agent-live-camera-turn-prepared', {
        reason,
        turnId,
        sent,
        frameId: state.lastAssociatedFrameId || '',
        frameAt: state.lastAssociatedFrameAt || 0,
        frameCapturedAt: state.lastAssociatedCapturedAt || 0,
      });
      return sent;
    })().catch((err) => {
      state.preparationReady = true;
      state.phase = 'association_failed';
      _voiceDebug('realtime-agent-live-camera-turn-preparation-failed', {
        reason,
        turnId,
        message: err?.message || String(err),
      });
      return false;
    }).finally(() => {
      if (state.prepareInFlight === run) state.prepareInFlight = null;
    });
    state.prepareInFlight = run;
    return run;
  }

  function _maybeReleaseMobileRealtimeCameraResponseGate(reason = 'camera_turn_ready') {
    const state = _mobileRealtimeLiveVisionState();
    if (!state.responseGateActive || !state.preparationReady) return false;
    if (!state.active) return false;
    state.phase = 'response_ready';
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.queuedFrame = null;
    const wasCommitted = state.audioCommitted === true;
    const shouldRequestResponse = wasCommitted && !state.responseRequestedAt;
    // Mark the response boundary before releasing server VAD. Any encode/upload
    // promise that was still unwinding now fails its isCurrent() check instead of
    // sending a frame after the response request.
    if (shouldRequestResponse) state.responseRequestedAt = Date.now();
    _sendMobileRealtimeAgentCreateResponseFlag(true);
    if (shouldRequestResponse) {
      state.responseGateActive = false;
      _scheduleMobileRealtimeAgentResponseAfterSkillContext(reason);
    }
    _voiceDebug('realtime-agent-live-camera-response-released', {
      reason,
      turnId: state.turnId,
      wasCommitted,
      waitingForCommit: !shouldRequestResponse,
      frameAt: state.lastAssociatedFrameAt || 0,
    });
    return true;
  }

  function _startMobileRealtimeLiveCameraVision(reason = 'speech_started') {
    const state = _mobileRealtimeLiveVisionState();
    const hasLiveCameraReader = typeof __pmRealtimeAgent.liveCameraFrameReader === 'function';
    const hasPendingImages = Array.isArray(__pmRealtimeAgent.pendingImages)
      && __pmRealtimeAgent.pendingImages.length > 0;
    // A captured image can outlive the camera sheet. Keep the next VAD response
    // gated long enough to flush that pending attachment even when no live frame
    // reader remains attached.
    if (!hasLiveCameraReader && !hasPendingImages) return false;
    if (!__pmRealtimeAgent.conn?.dc || __pmRealtimeAgent.conn.dc.readyState !== 'open') return false;
    if (state.active) return true;
    state.active = true;
    state.generation = Number(state.generation || 0) + 1;
    state.turnId = Number(state.turnId || 0) + 1;
    state.turnStartedAt = Date.now();
    state.turnCaptureStartedAt = state.turnStartedAt;
    state.turnFrameId = '';
    state.lastAssociatedFrameAt = 0;
    state.lastAssociatedCapturedAt = 0;
    state.lastAssociatedFrameId = '';
    state.lastAssociatedTurnId = 0;
    state.attachmentVisibleTurnId = 0;
    state.phase = 'capturing';
    state.preparationReady = false;
    state.pendingAttachmentPreparation = null;
    state.audioCommitted = false;
    state.responseStartedAt = 0;
    state.responseRequestedAt = 0;
    state.xaiVisionInjectionAt = 0;
    state.xaiVisionInjectionReason = '';
    state.responseGateActive = (__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening'
      && !_isMobileCodexV3RealtimeConnection(__pmRealtimeAgent.conn);
    state.lastSentAt = 0;
    __pmRealtimeAgent.cameraRuntime.turnContextKey = '';
    _sendMobileRealtimeCameraRuntimeUpdate('live_camera_turn_started');
    _sendMobileRealtimeCameraTurnContext({
      turnId: state.turnId,
      imageCount: _mobileRealtimeCameraPendingImageCount(),
    });
    if (state.responseGateActive) _sendMobileRealtimeAgentCreateResponseFlag(false);
    _voiceDebug('realtime-agent-live-camera-started', {
      reason,
      intervalMs: 1000,
      turnId: state.turnId,
      responseGateActive: state.responseGateActive,
    });
    if (hasLiveCameraReader) {
      _queueMobileRealtimeLiveCameraFrame(reason);
      state.timer = setInterval(() => {
        if (!state.active) return;
        _queueMobileRealtimeLiveCameraFrame('speech_active_tick');
      }, 1000);
    }
    return true;
  }

  function _scheduleMobileRealtimeAgentPendingImageFlush(reason = 'camera_image_staged') {
    const state = _mobileRealtimeLiveVisionState();
    if (!state.active || Number(state.responseStartedAt || 0) || !_mobileRealtimeCameraPendingImageCount()) return false;
    const previous = state.pendingAttachmentPreparation || Promise.resolve(false);
    const run = Promise.resolve(previous)
      .catch(() => false)
      .then(() => _flushMobileRealtimeAgentPendingImages(reason, {
        createResponse: false,
        turnId: state.turnId,
      }))
      .catch(() => false);
    state.pendingAttachmentPreparation = run;
    run.finally(() => {
      if (state.pendingAttachmentPreparation === run) state.pendingAttachmentPreparation = null;
    }).catch(() => {});
    return true;
  }

  async function _sendMobileRealtimeAgentCameraSnapshot(fileLike = {}, options = {}) {
    const dc = __pmRealtimeAgent.conn?.dc;
    const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
    const dataUrl = String(fileLike?.dataUrl || options.dataUrl || '').trim();
    if (!dc || dc.readyState !== 'open') {
      pmToast('Start realtime voice first, then send a camera snapshot.', 'info');
      return false;
    }
    if (!dataUrl) {
      pmToast('Could not read camera snapshot.', 'error');
      return false;
    }
    const name = String(fileLike?.name || 'Camera snapshot').trim();
    try {
      if (__pmRealtimeAgent.quiet?.active) _deactivateMobileRealtimeAgentQuietMode();
      if (_isMobileCodexV3RealtimeConnection()) {
        const sent = await _sendMobileCodexVisionSummaryToRealtime([dataUrl], {
          name,
          reason: 'camera_snapshot',
          label: 'The user sent this camera snapshot and is asking about it.',
          toast: true,
        });
        if (!sent) throw new Error('Codex realtime did not accept the camera context.');
        __pmRealtimeAgent.enqueuePreviews?.([{ kind: 'image', name, dataUrl, mimeType: fileLike?.mimeType || 'image/jpeg' }], { transient: true });
        _voiceDebug('codex-realtime-agent-camera-summary-sent', { name });
        return true;
      }
      if (provider === 'xai') {
        const snapshotImageUrl = await _downscaleDataUrlForRealtime(dataUrl, 1280, 0.72, 180000);
        const vision = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', {
          method: 'POST',
          body: JSON.stringify({ dataUrl: snapshotImageUrl, name }),
          timeoutMs: 45_000,
        });
        const summary = String(vision?.summary || '').trim();
        if (!summary) throw new Error(vision?.error || 'xAI vision returned no camera summary.');
        const contextSent = _sendMobileRealtimeDataChannelEvent(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  `Mobile camera snapshot from the app: ${name}.`,
                  'Vision summary for xAI voice:',
                  summary,
                  'Use this visual context in the live voice conversation. Do not claim the image was saved to the phone.',
                ].join('\n'),
              },
            ],
          },
        });
        if (!contextSent) throw new Error('xAI realtime did not accept the camera context.');
        if (!_sendMobileRealtimeDataChannelEvent(dc, { type: 'response.create' })) {
          throw new Error('xAI realtime did not accept the camera response request.');
        }
        __pmRealtimeAgent.enqueuePreviews?.([{ kind: 'image', name, dataUrl, mimeType: fileLike?.mimeType || 'image/jpeg' }], { transient: true });
        _voiceDebug('xai-realtime-agent-camera-summary-sent', { name, summaryLen: summary.length });
        return true;
      }
      const snapshotImageUrl = await _downscaleDataUrlForRealtime(dataUrl);
      const contextSent = _sendMobileRealtimeDataChannelEvent(dc, {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Camera snapshot from the mobile app: ${name}. Use this visual context in the live voice conversation.`,
            },
            {
              type: 'input_image',
              image_url: snapshotImageUrl,
            },
          ],
        },
      });
      if (!contextSent) throw new Error('Realtime voice did not accept the camera context.');
      if (provider === 'xai') {
        if (!_sendMobileRealtimeDataChannelEvent(dc, { type: 'response.create' })) {
          throw new Error('Realtime voice did not accept the camera response request.');
        }
      } else {
        if (!_sendMobileRealtimeDataChannelEvent(dc, {
          type: 'response.create',
          response: {
            output_modalities: ['audio'],
            instructions: [
              'You are Prometheus in realtime voice mode.',
              'The user just sent a camera snapshot from the mobile app.',
              'Use the image directly. Respond naturally with what is useful from the visual context.',
              'Do not claim the image was saved to the phone. It is an in-app frame capture.',
            ].join('\n'),
          },
        })) throw new Error('Realtime voice did not accept the camera response request.');
      }
      __pmRealtimeAgent.enqueuePreviews?.([{ kind: 'image', name, dataUrl, mimeType: fileLike?.mimeType || 'image/jpeg' }], { transient: true });
      _voiceDebug('realtime-agent-camera-snapshot-sent', { provider, name, bytes: Number(fileLike?.size || 0) || 0 });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-camera-snapshot-failed', { message: err?.message || String(err) });
      pmToast(err?.message || 'Could not send camera snapshot to voice.', 'error');
      return false;
    }
  }

  async function _sendMobileRealtimeAgentVideoFrames(payload = {}, options = {}) {
    const dc = __pmRealtimeAgent.conn?.dc;
    const provider = String(__pmRealtimeAgent.conn?.provider || 'openai_realtime');
    const frames = (Array.isArray(payload.frames) ? payload.frames : [])
      .map((frame, index) => ({
        ...frame,
        dataUrl: String(frame?.dataUrl || '').trim(),
        name: String(frame?.name || `video-frame-${index + 1}.jpg`).trim(),
      }))
      .filter((frame) => frame.dataUrl)
      .slice(0, 12);
    if (!dc || dc.readyState !== 'open') {
      pmToast('Start realtime voice first, then send video frames.', 'info');
      return false;
    }
    if (!frames.length) {
      pmToast('Could not sample video frames.', 'error');
      return false;
    }
    const durationMs = Number(payload.durationMs || options.durationMs || 0) || 0;
    const seconds = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : 'short';
    try {
      if (__pmRealtimeAgent.quiet?.active) _deactivateMobileRealtimeAgentQuietMode();
      if (provider === 'xai') {
        const requestFrames = await Promise.all(frames.map((frame) => _downscaleDataUrlForRealtime(frame.dataUrl, 960, 0.66, 180000)));
        const vision = await mobileGatewayFetch('/api/voice-agent/xai-vision-summary', {
          method: 'POST',
          body: JSON.stringify({ frames: requestFrames.map((dataUrl, index) => ({ ...frames[index], dataUrl })), durationMs, name: 'mobile camera video frames' }),
          timeoutMs: 45_000,
        });
        const summary = String(vision?.summary || '').trim();
        if (!summary) throw new Error(vision?.error || 'xAI vision returned no video summary.');
        dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  `Mobile camera video capture (${seconds}) sampled into ${frames.length} frame${frames.length === 1 ? '' : 's'}.`,
                  'Vision summary for xAI voice:',
                  summary,
                  'Treat this as sequential visual context from the same short in-app recording. Do not claim live video was streamed.',
                ].join('\n'),
              },
            ],
          },
        }));
        dc.send(JSON.stringify({ type: 'response.create' }));
        __pmRealtimeAgent.enqueuePreviews?.(
          frames.slice(0, 3).map((frame, index) => ({
            kind: 'image',
            name: frame.name || `video-frame-${index + 1}.jpg`,
            dataUrl: frame.dataUrl,
            mimeType: frame.mimeType || 'image/jpeg',
          })),
          { transient: true },
        );
        _voiceDebug('xai-realtime-agent-video-summary-sent', { frames: frames.length, durationMs, summaryLen: summary.length });
        return true;
      }
      // Send frames as INDIVIDUAL conversation items (one image each) so a 12-frame
      // clip never exceeds the realtime data-channel (SCTP) message size limit.
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Mobile camera video capture (${seconds}) sampled into ${frames.length} sequential frame${frames.length === 1 ? '' : 's'} (about one per second). The next ${frames.length} image${frames.length === 1 ? '' : 's'} are those frames in order — treat them as a short clip and respond using the visual context.`,
          }],
        },
      }));
      frames.forEach((frame, index) => {
        dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: `Frame ${index + 1} of ${frames.length}` },
              { type: 'input_image', image_url: frame.dataUrl },
            ],
          },
        }));
      });
      if (provider === 'xai') {
        dc.send(JSON.stringify({ type: 'response.create' }));
      } else {
        dc.send(JSON.stringify({
          type: 'response.create',
          response: {
            output_modalities: ['audio'],
            instructions: [
              'You are Prometheus in realtime voice mode.',
              'The user just recorded a short mobile camera clip.',
              'Use the sampled frames as a temporal visual sequence. Respond naturally with the most useful observation.',
              'Do not claim a video was streamed live; it was an in-app short capture sampled into frames.',
            ].join('\n'),
          },
        }));
      }
      __pmRealtimeAgent.enqueuePreviews?.(
        frames.slice(0, 3).map((frame, index) => ({
          kind: 'image',
          name: frame.name || `video-frame-${index + 1}.jpg`,
          dataUrl: frame.dataUrl,
          mimeType: frame.mimeType || 'image/jpeg',
        })),
        { transient: true },
      );
      _voiceDebug('realtime-agent-camera-video-frames-sent', { provider, frames: frames.length, durationMs });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-camera-video-frames-failed', { message: err?.message || String(err) });
      pmToast(err?.message || 'Could not send video frames to voice.', 'error');
      return false;
    }
  }

  // PTT and always-listening hooks for the mobile mic UI
  function _mobileRealtimeAgentPttPress(sessionId) {
    const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (__pmRealtimeAgent.conn && String(__pmRealtimeAgent.conn.sessionId || '').trim() !== sid) {
      _voiceDebug('realtime-agent-ptt-session-switch', {
        from: String(__pmRealtimeAgent.conn.sessionId || '').trim(),
        to: sid,
      });
      _stopMobileRealtimeAgentSession();
    }
    const ptt = __pmRealtimeAgent.ptt || (__pmRealtimeAgent.ptt = { held: false, sessionId: '', pressId: 0, pressedAt: 0 });
    ptt.held = true;
    ptt.sessionId = sid;
    ptt.pressedAt = Date.now();
    const pressId = ++ptt.pressId;
    if (!__pmRealtimeAgent.conn) {
      return _startMobileRealtimeAgentSession(sid, { listenMode: 'push_to_talk' })
        .then((conn) => {
          // A release can happen while AVAS/WebRTC is still opening. Only honor
          // the press when it is still the current held gesture; otherwise the
          // previous flow left the microphone enabled after that release.
          const stillHeld = ptt.held === true
            && ptt.pressId === pressId
            && String(ptt.sessionId || '') === sid
            && String(conn?.sessionId || '') === sid;
          if (stillHeld) _startMobileRealtimeLiveCameraVision('ptt_press');
          _setMobileRealtimeAgentMicEnabled(stillHeld);
          _voiceDebug('realtime-agent-ptt-bootstrap-resolved', {
            sessionId: sid,
            stillHeld,
            transport: conn?.transport || '',
          });
          return conn;
        })
        .catch((err) => {
          _voiceDebug('realtime-agent-ptt-start-failed', { message: err?.message || String(err) });
          throw err;
        });
    }
    _startMobileRealtimeLiveCameraVision('ptt_press');
    _setMobileRealtimeAgentMicEnabled(true);
    return Promise.resolve(__pmRealtimeAgent.conn);
  }

  function _mobileRealtimeAgentPttRelease() {
    const ptt = __pmRealtimeAgent.ptt || (__pmRealtimeAgent.ptt = { held: false, sessionId: '', pressId: 0, pressedAt: 0 });
    const pressedSessionId = String(ptt.sessionId || '').trim();
    const heldForMs = ptt.pressedAt ? Math.max(0, Date.now() - ptt.pressedAt) : 0;
    ptt.held = false;
    ptt.pressedAt = 0;
    ++ptt.pressId;
    const conn = __pmRealtimeAgent.conn;
    if (!conn || (pressedSessionId && String(conn.sessionId || '').trim() !== pressedSessionId)) {
      _voiceDebug('realtime-agent-ptt-release-before-ready', {
        sessionId: pressedSessionId,
        hasConnection: !!conn,
      });
      return;
    }
    const commitAndRespond = () => {
      const dc = __pmRealtimeAgent.conn?.dc;
      if (dc?.readyState === 'open') {
        try {
          dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          _mobileRealtimeLiveVisionState().audioCommitted = true;
          if (conn?.provider === 'xai') {
            _sendMobileRealtimeAgentResponseCreate('xai_ptt_release');
          } else {
            _scheduleMobileRealtimeAgentResponseAfterSkillContext('ptt_release');
          }
        } catch {}
      }
    };
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // AVAS v3 has server VAD configured by thread/realtime/start. Disabling
      // this track delivers silence, closes the VAD turn, and lets AVAS reply.
      // Public commit/create events are invalid on the v3 data channel.
      Promise.resolve(_prepareMobileRealtimeLiveCameraForTurn('codex_ptt_release')).finally(() => {
        _setMobileRealtimeAgentMicEnabled(false);
        _voiceDebug('codex-v3-ptt-release-server-vad', {
          sessionId: conn.sessionId,
          heldForMs,
          micEnabled: conn.micTrack?.enabled === true,
          cameraFrameAt: _mobileRealtimeLiveVisionState().lastAssociatedFrameAt || 0,
        });
      });
      return;
    }
    if (conn?.provider === 'xai') {
      const capture = conn.xaiCapture || {};
      _voiceDebug('xai-realtime-capture-release', {
        appends: capture.appends || 0,
        nonSilent: capture.nonSilent || 0,
        peakMax: capture.peakMax || 0,
        sampleRate: capture.sampleRate || 0,
      });
      if (!capture.appends || !capture.nonSilent) {
        try { pmToast('xAI realtime did not capture mic audio. Try holding PTT after the button turns active.', 'error'); } catch {}
        _setMobileRealtimeAgentMicEnabled(false);
        return;
      }
      setTimeout(async () => {
        await Promise.resolve(_prepareMobileRealtimeLiveCameraForTurn('xai_ptt_release')).catch(() => false);
        // xAI receives camera pixels through the vision sidecar. It cannot use
        // the OpenAI image event directly, so flush the same staged-image queue
        // as the capture button before committing the spoken audio.
        if (Array.isArray(__pmRealtimeAgent.pendingImages) && __pmRealtimeAgent.pendingImages.length) {
          await _flushMobileRealtimeAgentPendingImages('xai_ptt_release', {
            turnId: _mobileRealtimeLiveVisionState().turnId,
            toast: true,
          }).catch(() => false);
        }
        commitAndRespond();
        _setMobileRealtimeAgentMicEnabled(false);
      }, 180);
      return;
    }
    _setMobileRealtimeAgentMicEnabled(false);
    const flushThenCommit = async () => {
      // Flush any staged photo into the conversation BEFORE committing the audio +
      // creating the response, so the image is attached to this spoken turn.
      await Promise.resolve(_prepareMobileRealtimeLiveCameraForTurn('ptt_release')).catch(() => false);
      if (__pmRealtimeAgent.pendingImages.length) {
        await _flushMobileRealtimeAgentPendingImages('ptt_release', {
          turnId: _mobileRealtimeLiveVisionState().turnId,
        }).catch(() => false);
        commitAndRespond();
      } else {
        commitAndRespond();
      }
    };
    flushThenCommit().catch(() => commitAndRespond());
  }

  async function _mobileRealtimeAgentEnableAlwaysListening(sessionId) {
    const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (__pmRealtimeAgent.conn && String(__pmRealtimeAgent.conn.sessionId || '').trim() !== sid) {
      _voiceDebug('realtime-agent-always-session-switch', {
        from: String(__pmRealtimeAgent.conn.sessionId || '').trim(),
        to: sid,
      });
      _stopMobileRealtimeAgentSession();
    }
    await _startMobileRealtimeAgentSession(sid, { listenMode: 'always_listening' });
    _setMobileRealtimeAgentMicEnabled(true);
  }

  function _mobileRealtimeAgentDisableAlwaysListening() {
    _stopMobileRealtimeAgentSession();
  }

  return Object.freeze({
    MOBILE_REALTIME_HANDOFF_RECOVERY_ENABLED,
    MOBILE_REALTIME_HANDOFF_CLAIM_RE,
    _maybeRecoverMobileHallucinatedHandoff,
    _sendMobileRealtimeAgentCreateResponseFlag,
    _mobileRealtimeCameraPendingImageCount,
    _mobileRealtimeCameraFeedIsOpen,
    _mobileRealtimeCameraSessionIsOpen,
    _mobileRealtimeCameraRuntimeIsActive,
    _mobileRealtimeCameraRuntimePayload,
    _mobileRealtimeCameraRuntimeText,
    _sendMobileRealtimeCameraRuntimeUpdate,
    _setMobileRealtimeCameraRuntime,
    _sendMobileRealtimeCameraTurnContext,
    _setMobileRealtimeAgentWakePhrase,
    _syncMobileRealtimeAgentQuietFromSettings,
    _seedMobileRealtimeAgentConversationHistory,
    _sendMobileRealtimeAgentContextUpdate,
    _clearMobileRealtimeAgentPendingCreateResponse,
    _sendMobileRealtimeAgentResponseCreate,
    _scheduleMobileRealtimeAgentResponseAfterSkillContext,
    _finishMobileRealtimeAgentPendingResponse,
    _sanitizeMobileRealtimeAgentSkillContext,
    _mobileRealtimeRecentList,
    _shouldIgnoreMobileRealtimeAgentTranscriptEvent,
    _shouldInjectMobileRealtimeAgentSkillContext,
    _injectMobileRealtimeAgentSkillContext,
    _requestMobileRealtimeAgentWorkerNarration,
    _requestMobileRealtimeAgentFinalSummary,
    _refreshMobileRealtimeAgentWorkerContext,
    _normalizeMobileRealtimeAgentMatchText,
    _getPendingMobileRealtimeAgentWorkerDispatch,
    _makePendingMobileRealtimeAgentWorkerPacket,
    _overlayPendingMobileRealtimeAgentWorkerPacket,
    _markMobileRealtimeAgentWorkerDispatch,
    _removeMobileRealtimeAgentChatTurn,
    _cancelMobileRealtimeAgentResponseForDispatch,
    _clearMobileRealtimeAgentOutputAudioIfStarted,
    _mobileRealtimeAgentEffectiveSessionId,
    _startMobileRealtimeAgentContextRefreshLoop,
    _stopMobileRealtimeAgentContextRefreshLoop,
    _activateMobileRealtimeAgentQuietMode,
    _deactivateMobileRealtimeAgentQuietMode,
    _handleMobileRealtimeAgentQuietTranscript,
    _isMobileRealtimeAgentMode,
    _wantsMobileXaiRealtime,
    _mobileVoiceDeviceTimeContext,
    _mobileVoiceTargetPayload,
    _currentMobileSubagentVoiceTarget,
    _realtimeAgentDataChannelOpen,
    _persistSubagentVoiceLog,
    _mobileRealtimeAgentTranscriptKey,
    _clearMobileRealtimeAgentQueuedFinalSummary,
    _persistRealtimeSubagentUserTranscript,
    _persistRealtimeSubagentDirectReply,
    _installMobileCodexV3RealtimeCommandGuard,
    _startMobileCodexVoiceRoomStandbyConnection,
    _startMobileRealtimeAgentSession,
    _stopMobileRealtimeAgentSession,
    _setMobileRealtimeAgentMicEnabled,
    _mobileRealtimeCanGateInputWithoutMutingTrack,
    _mobileRealtimePlaybackActive,
    _scheduleMobileRealtimeInputRestoreWatchdog,
    _suspendMobileRealtimeInputForOutput,
    _restoreMobileRealtimeInputAfterOutput,
    _isMobileRealtimeOutputGuardActive,
    _mobileRealtimeAudioReceiverTarget,
    _tuneMobileRealtimeAudioReceiver,
    _stopMobileRealtimeAudioQualityMonitor,
    _startMobileRealtimeAudioQualityMonitor,
    _attachMobileRealtimeOutput,
    _shouldIgnoreMobileRealtimeSpeechStartedDuringOutput,
    MOBILE_XAI_REALTIME_SAMPLE_RATE,
    MOBILE_XAI_REALTIME_INPUT_SAMPLE_RATE,
    _mobileXaiVoice,
    _mobileBase64ToInt16,
    _mobileInt16ToBase64,
    _mobileXaiRealtimeDownsampleFloat32,
    _resampleInt16ToFloat32,
    _createMobileXaiPlayback,
    _hasMobileXaiRealtimeWarmMic,
    _ensureMobileXaiRealtimeMic,
    _startMobileOpenAiRealtimeWebSocketSession,
    _startMobileXaiRealtimeSession,
    _ensureMobileRealtimeAgentChatTurn,
    _newMobileRealtimeExchangeId,
    _ensureMobileRealtimeExchangeId,
    _repairMobileRealtimeExchangeOrder,
    _ensureMobileRealtimeAgentTurnOrder,
    _finalizeMobileRealtimeAgentChatTurn,
    _mobileRealtimeUserTurnForSession,
    _mobileRealtimeUserTurnCanContinueAcrossPause,
    _holdMobileRealtimeUserTurnOpen,
    _finalizeMobileRealtimeUserTurn,
    _mobileRealtimeActiveAssistantTurn,
    _estimateMobileRealtimeSpeechMs,
    _startMobileRealtimeAssistantLyricProgress,
    _finishMobileRealtimeAssistantLyricProgress,
    _noteMobileRealtimeAssistantAudioChunk,
    _mobileRealtimeTranscriptItemId,
    _mobileRealtimeTranscriptWordCount,
    _chooseMobileRealtimeFinalUserTranscript,
    _isProgressiveMobileRealtimeTranscript,
    _shouldIgnoreMobileRealtimeTranscriptForCurrentTurn,
    _mobileCodexBridgeTranscriptRole,
    _mobileCodexBridgeEventText,
    _normalizeMobileCodexBridgeRealtimeTranscript,
    _shouldApplyMobileCodexBridgeTranscriptFallback,
    _sendMobileCodexV3HandoffOutput,
    _handleMobileCodexV3HandoffRequest,
    _stopMobileCodexBridgeRealtimeEventPoll,
    _startMobileCodexBridgeRealtimeEventPoll,
    _handleMobileRealtimeAgentEvent,
    _realtimeAgentToolLabel,
    _addRealtimeAgentRecentCommand,
    _finishRealtimeAgentRecentCommand,
    _startMobileRealtimeAgentToolTrace,
    _finishMobileRealtimeAgentToolTrace,
    _abortMobileActiveWorkerFromRealtime,
    _executeMobileRealtimeAgentFunctionCall,
    _downscaleDataUrlForRealtime,
    _sendMobileRealtimeAgentFunctionOutput,
    _sendMobileRealtimeDataChannelEvent,
    _injectRealtimeImageItemToConversation,
    _summarizeMobileXaiVisionImages,
    _sendMobileXaiVisionSummaryToRealtime,
    _kickoffMobileXaiVisionSummary,
    _stageMobileRealtimeAgentAttachmentPreview,
    _mobileRealtimeAgentPendingFileContext,
    _consumeMobileRealtimeAgentPendingFiles,
    _stageMobileRealtimeAgentFile,
    _queueMobileRealtimeAgentImage,
    _stageMobileRealtimeAgentImage,
    _flushMobileRealtimeAgentPendingImages,
    _awaitMobileRealtimeCameraOperation,
    _mobileRealtimeLiveCameraAssociationTimeoutMs,
    _mobileRealtimeLiveVisionState,
    _mobileRealtimeXaiLiveCameraCanResume,
    _mobileRealtimeLiveVisionIsCurrent,
    _associateMobileRealtimeLiveCameraFrame,
    _stopMobileRealtimeLiveCameraVision,
    _queueMobileRealtimeLiveCameraFrame,
    _prepareMobileRealtimeLiveCameraForTurn,
    _maybeReleaseMobileRealtimeCameraResponseGate,
    _startMobileRealtimeLiveCameraVision,
    _scheduleMobileRealtimeAgentPendingImageFlush,
    _sendMobileRealtimeAgentCameraSnapshot,
    _sendMobileRealtimeAgentVideoFrames,
    _mobileRealtimeAgentPttPress,
    _mobileRealtimeAgentPttRelease,
    _mobileRealtimeAgentEnableAlwaysListening,
    _mobileRealtimeAgentDisableAlwaysListening,
  });
}
