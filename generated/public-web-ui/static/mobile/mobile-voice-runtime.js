// Mobile Voice runtime entry. Realtime transport and camera code stay in the deferred Voice-owned implementation.
import { createMobileVoiceRealtimeRuntime } from './mobile-voice-realtime-runtime.js';
export function createMobileVoiceRuntime(context = {}) {
  const {
    ICONS,
    MOBILE_CHAT_SESSION_ID,
    PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE,
    VOICE_PREVIEW_DRAG_START_PX,
    __pmChat,
    __pmRealtimeAgent,
    __pmVoice,
    _appendMobileLiveTrace,
    _appendMobilePrimaryWorkerProcess,
    _appendMobileProcess,
    _appendMobileUserProcess,
    _applyMobileAgentStreamEvent,
    _applyMobileToolActivity,
    _clearMobileActiveRun,
    _collectMediaFromToolEvent,
    _collectMessageMedia,
    _deliveryNotificationToMobileMedia,
    _drawAgentSVG,
    _ensureDurableMobileVoiceSession,
    _flushMobilePendingThinkingBurst,
    _formatBytes,
    _handleMobileCleanThought,
    _handleMobileThinkingCallback,
    _isMobileNewChatDraftActiveForVoice,
    _markMobileSessionRunning,
    _mergeMobileMediaIntoMessage,
    _mergeMobileSessionThreadWithLocal,
    _mobileAssistantWorkStartedAt,
    _mobileMediaKind,
    _mobileToolLabel,
    _mobileToolResultLabel,
    _mobileWorkerStatusLabel,
    _moveMobileVisibleAnswerIntoWorkflowTrace,
    _newMobileClientRequestId,
    _normalizeMobileApproval,
    _normalizeMobileFile,
    _normalizeMobileMediaList,
    _normalizeMobileVoiceWorkgroup,
    _notifyMobileChatVoiceUpdate,
    _nowTime,
    _pmApprovalCanSave,
    _pmApprovalTechnicalText,
    _pmHasProcessRun,
    _pmHumanApproval,
    _pmIsCommandApproval,
    _pmLoadApprovalProcessRun,
    _readMobileActiveRun,
    _recordMobileChatError,
    _rememberMobileActiveRun,
    _rememberMobileLastChatSession,
    _renderAgentVoicePicker,
    _renderMobileMediaGallery,
    _renderMobileRichArtifacts,
    _restoreMobileVoiceWorkgroupsForSession,
    _restoreTemporaryMobileSubagentVoiceProfile,
    _safeJsonPreview,
    _setTemporaryMobileSubagentVoiceProfile,
    _startMobileNewVoiceDraft,
    _updateMobilePrimaryWorkgroupLink,
    _uploadMobileChatAttachments,
    _upsertMobileVoiceWorkgroup,
    _voiceAgentProcessEntriesFromResult,
    _wireMobileMediaCards,
    _wireMobileProcessRunActions,
    agentVoicePickerHydrate,
    approveMobileApproval,
    attachMobileButtonHaptic,
    attachMobileHapticGestureSurface,
    bindMobileSessionTarget,
    buildMobileGatewayWsUrl,
    denyMobileApproval,
    escapeHtml,
    getVoicePreviewDragStyle,
    getVoicePreviewGestureOutcome,
    invalidateMobileDrawerSessions,
    isCurrentGateway,
    loadMobileApprovals,
    loadMobileChatSession,
    loadMobileSubagents,
    loadVoiceStatus,
    mobileGatewayFetch,
    mountThinkingOrbWhenReady,
    notifyMobileModelChanged,
    openDrawer,
    parseTargetNamespacedId,
    pmHaptic,
    pmToast,
    probeGateway,
    refreshMobileDrawerSessions,
    registerAgentVoicePickerOnSaved,
    renderMobileHeader,
    resolveMobileSessionGateway,
    setMobileActiveGatewayTarget,
    stopMobileMainChat,
    streamChat,
    streamSubagentChat,
    transcribeVoiceAudio,
    window,
    wireHeaderActions,
    wsEventBus,
  } = context || {};

  // Voice configuration and room ownership remain adjacent to the transpor
  // so the optional runtime has one stateful Voice authority.
  const PM_VOICE_SETTINGS_KEY = 'pm_voice_settings_v1';
  const PUBLIC_REALTIME_VOICE_OPTIONS = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
  const CODEX_AVAS_REALTIME_VOICE_OPTIONS = ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove'];
  const SERVER_VOICE_FALLBACKS = {
    openai: [
      { id: 'alloy', label: 'Alloy' },
      { id: 'ash', label: 'Ash' },
      { id: 'ballad', label: 'Ballad' },
      { id: 'coral', label: 'Coral' },
      { id: 'echo', label: 'Echo' },
      { id: 'fable', label: 'Fable' },
      { id: 'marin', label: 'Marin' },
      { id: 'nova', label: 'Nova' },
      { id: 'onyx', label: 'Onyx' },
      { id: 'sage', label: 'Sage' },
      { id: 'shimmer', label: 'Shimmer' },
      { id: 'verse', label: 'Verse' },
    ],
    xai: [
      { id: 'carina', label: 'Carina' },
      { id: 'zagan', label: 'Zagan' },
      { id: 'helix', label: 'Helix' },
      { id: 'orion', label: 'Orion' },
      { id: 'luna', label: 'Luna' },
      { id: 'iris', label: 'Iris' },
      { id: 'altair', label: 'Altair' },
      { id: 'zenith', label: 'Zenith' },
      { id: 'perseus', label: 'Perseus' },
      { id: 'helios', label: 'Helios' },
      { id: 'lux', label: 'Lux' },
      { id: 'kepler', label: 'Kepler' },
      { id: 'rigel', label: 'Rigel' },
      { id: 'cosmo', label: 'Cosmo' },
      { id: 'celeste', label: 'Celeste' },
      { id: 'ursa', label: 'Ursa' },
      { id: 'sirius', label: 'Sirius' },
      { id: 'lumen', label: 'Lumen' },
      { id: 'castor', label: 'Castor' },
      { id: 'naksh', label: 'Naksh' },
      { id: 'atlas', label: 'Atlas' },
      { id: 'eve', label: 'Eve' },
      { id: 'ara', label: 'Ara' },
      { id: 'rex', label: 'Rex' },
      { id: 'sal', label: 'Sal' },
      { id: 'leo', label: 'Leo' },
    ],
    openai_realtime: PUBLIC_REALTIME_VOICE_OPTIONS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  };

  function _isMobileCodexAvasRealtime(status = __pmVoice?.lastVoiceStatus) {
    const realtime = status?.realtime || {};
    return realtime?.auth === 'chatgpt_oauth_app_server'
      && realtime?.transport === 'codex_app_server'
      && realtime?.codexBridgeAvailable === true;
  }

  function _mobileRealtimeVoiceOptions(status = __pmVoice?.lastVoiceStatus) {
    const realtime = status?.realtime || {};
    if (_isMobileCodexAvasRealtime(status)) {
      const live = Array.isArray(realtime?.codexBridgeActiveVoices)
        ? realtime.codexBridgeActiveVoices.map((voice) => String(voice || '').trim()).filter(Boolean)
        : [];
      return live.length ? [...new Set(live)] : [...CODEX_AVAS_REALTIME_VOICE_OPTIONS];
    }
    return [...PUBLIC_REALTIME_VOICE_OPTIONS];
  }

  function _mobileRealtimeDefaultVoice(status = __pmVoice?.lastVoiceStatus) {
    const realtime = status?.realtime || {};
    const options = _mobileRealtimeVoiceOptions(status);
    const advertised = _isMobileCodexAvasRealtime(status)
      ? String(realtime?.codexBridgeDefaultVoice || '').trim()
      : 'marin';
    return options.includes(advertised) ? advertised : (options[0] || 'marin');
  }

  function _mobileRealtimeVoice(value = __pmVoice?.settings?.realtimeVoice, status = __pmVoice?.lastVoiceStatus) {
    const options = _mobileRealtimeVoiceOptions(status);
    const voice = String(value || '').trim();
    return options.includes(voice) ? voice : _mobileRealtimeDefaultVoice(status);
  }

  function _voicePresetForProviders(inputProvider, outputProvider) {
    const input = String(inputProvider || '').trim();
    const output = String(outputProvider || '').trim();
    if (input === 'openai_realtime' && output === 'openai_realtime') return 'openai_realtime';
    if (input === 'xai' && output === 'xai') return 'xai';
    if ((input === 'browser' || input === 'auto') && (output === 'browser' || output === 'auto')) return 'default';
    return 'custom';
  }

  function _inputProviderForMode(mode) {
    if (mode === 'openai_realtime') return 'openai_realtime';
    if (mode === 'xai') return 'xai';
    return 'browser';
  }

  function _outputProviderForMode(mode) {
    if (mode === 'openai_realtime') return 'openai_realtime';
    if (mode === 'xai') return 'xai';
    return 'browser';
  }

  function _loadVoiceSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(PM_VOICE_SETTINGS_KEY) || '{}');
      const voiceMode = saved.voiceMode === 'xai' ? 'xai' : 'openai_realtime';
      const listenMode = ['push_to_speak', 'always_listening'].includes(saved.listenMode) ? saved.listenMode : 'push_to_speak';
      return {
        voiceMode,
        sttProvider: 'auto',
        ttsProvider: 'realtime',
        realtimeVoice: saved.realtimeVoice || 'marin',
        realtimeSpeed: Number(saved.realtimeSpeed || 1.05),
        serverVoice: saved.serverVoice || '',
        xaiSpeed: Number(saved.xaiSpeed || saved.realtimeSpeed || 1.0),
        dictation: saved.dictation || 'quiet',
        listenMode,
        wakePhrase: listenMode === 'always_listening' ? _cleanMobileWakePhrase(saved.wakePhrase || '') : '',
        wakeGateActive: listenMode === 'always_listening' && saved.wakeGateActive === true,
        sttProviderLocked: saved.sttProviderLocked === true,
        autoProviderDefault: saved.autoProviderDefault || '',
        voiceAgentRealtimeAgent: voiceMode === 'openai_realtime',
        voiceAgentXaiRealtime: voiceMode === 'xai',
      };
    } catch {
      return { voiceMode: 'openai_realtime', sttProvider: 'auto', ttsProvider: 'realtime', realtimeVoice: 'marin', realtimeSpeed: 1.05, serverVoice: '', xaiSpeed: 1.0, dictation: 'quiet', listenMode: 'push_to_speak', wakePhrase: '', wakeGateActive: false, sttProviderLocked: true, autoProviderDefault: '', voiceAgentRealtimeAgent: true, voiceAgentXaiRealtime: false };
    }
  }

  function _saveVoiceSettings(settings) {
    const previous = { ...(__pmVoice.settings || {}) };
    __pmVoice.settings = { ...__pmVoice.settings, ...settings };
    __pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';
    try { localStorage.setItem(PM_VOICE_SETTINGS_KEY, JSON.stringify(__pmVoice.settings)); } catch {}
    _applyVoiceSettingsLive(previous, __pmVoice.settings || {}, settings || {});
  }

  function _mobileRealtimeListenModeFromSettings(settings = __pmVoice?.settings || {}) {
    return settings?.listenMode === 'always_listening' ? 'always_listening' : 'push_to_talk';
  }

  function _mobileRealtimeProviderKeyFromSettings(settings = __pmVoice?.settings || {}) {
    const mode = String(settings?.voiceMode || '').trim();
    return mode === 'xai' ? 'xai_realtime' : 'openai_realtime';
  }

  function _mobileRealtimeTurnDetectionForListenMode(listenMode, settings = __pmVoice?.settings || {}) {
    if (listenMode !== 'always_listening') return null;
    const wakePhrase = _cleanMobileWakePhrase(settings?.wakePhrase || '');
    const quietActive = !!(wakePhrase && settings?.wakeGateActive === true);
    return {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: !quietActive && !__pmRealtimeAgent?.quiet?.active,
    };
  }

  function _mobileRealtimeProviderLabel(status = __pmVoice?.lastVoiceStatus) {
    return _isMobileCodexAvasRealtime(status) ? 'Codex Voice / Live' : 'OpenAI Realtime';
  }

  function _isMobileCodexV3RealtimeConnection(conn = __pmRealtimeAgent?.conn) {
    // The mobile client only selects this transport when status reports AVAS v3.
    // Its WebRTC data channel is not the public OpenAI Realtime event protocol.
    return conn?.transport === 'codex_app_server';
  }

  function _sendMobileRealtimeAgentSessionUpdateFromSettings(reason = 'settings_live_update') {
    const conn = __pmRealtimeAgent?.conn;
    const dc = conn?.dc;
    if (!conn || !dc || dc.readyState !== 'open') return false;
    const settings = __pmVoice?.settings || {};
    const listenMode = _mobileRealtimeListenModeFromSettings(settings);
    const turnDetection = _mobileRealtimeTurnDetectionForListenMode(listenMode, settings);
    // A public Realtime fallback must never inherit an AVAS-only voice saved
    // while the Codex OAuth bridge was active (for example, `juniper`).
    const realtimeVoiceStatus = conn.transport === 'codex_app_server'
      ? __pmVoice?.lastVoiceStatus
      : { realtime: {} };
    const realtimeVoice = _mobileRealtimeVoice(settings.realtimeVoice, realtimeVoiceStatus);
    conn.listenMode = listenMode;
    __pmRealtimeAgent.listenMode = listenMode;
    _syncMobileRealtimeAgentQuietFromSettings?.();
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // AVAS v3 rejects public `session.update` events. It owns VAD/turn
      // lifecycle from thread/realtime/start; PTT gates only the mic track.
      const ptt = __pmRealtimeAgent.ptt || {};
      const shouldEnable = listenMode === 'always_listening'
        || (ptt.held === true && String(ptt.sessionId || '') === String(conn.sessionId || ''));
      _setMobileRealtimeAgentMicEnabled(shouldEnable);
      _voiceDebug?.('codex-v3-session-settings-applied-natively', {
        reason,
        listenMode,
        micEnabled: shouldEnable,
      });
      return true;
    }
    try {
      if (conn.provider === 'xai') {
        const speed = Number(settings.xaiSpeed || 1.0);
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: _mobileXaiVoice(settings.serverVoice || settings.realtimeVoice),
            speed,
            audio: {
              output: { speed },
            },
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: turnDetection,
          },
        }));
      } else {
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            audio: {
              input: {
                turn_detection: turnDetection,
                transcription: { model: 'gpt-realtime-whisper' },
              },
              output: {
                voice: realtimeVoice,
                speed: Number(settings.realtimeSpeed || 1.05),
              },
            },
          },
        }));
      }
      if (listenMode === 'always_listening') _setMobileRealtimeAgentMicEnabled(true);
      else _setMobileRealtimeAgentMicEnabled(false);
      _voiceDebug?.('voice-settings-live-session-update', { reason, provider: conn.provider || 'openai_webrtc', listenMode });
      return true;
    } catch (err) {
      _voiceDebug?.('voice-settings-live-session-update-failed', { reason, message: err?.message || String(err) });
      return false;
    }
  }

  function _updateRealtimeSpeechConnectionFromSettings(reason = 'settings_live_update') {
    const conn = __pmVoice?.realtimeSpeechConnection;
    const dc = conn?.dc;
    if (!dc || dc.readyState !== 'open') return false;
    try {
      dc.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            output: {
              voice: __pmVoice.settings?.realtimeVoice || __pmVoice.provider?.voice || 'marin',
              speed: Number(__pmVoice.settings?.realtimeSpeed || __pmVoice.provider?.speed || 1.05),
            },
          },
        },
      }));
      _voiceDebug?.('voice-settings-live-tts-update', { reason });
      return true;
    } catch {
      return false;
    }
  }

  function _restartMobileRealtimeAgentForSettings(reason = 'settings_changed') {
    const wasListening = __pmVoice?.listening === true;
    const nextListenMode = _mobileRealtimeListenModeFromSettings(__pmVoice?.settings || {});
    const sid = String(__pmVoice?.targetSessionId || __pmRealtimeAgent?.conn?.sessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    const restartId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    __pmRealtimeAgent.restartId = restartId;
    _stopMobileRealtimeAgentSession?.();
    if (_mobileRealtimeProviderKeyFromSettings(__pmVoice?.settings || {}) === 'split') return;
    if (nextListenMode !== 'always_listening' && !wasListening) return;
    _startMobileRealtimeAgentSession?.(sid, { listenMode: nextListenMode })
      .then((conn) => {
        if (__pmRealtimeAgent.restartId !== restartId) return;
        if (conn && String(conn.sessionId || '').trim() !== sid) return;
        if (nextListenMode === 'always_listening' || wasListening) _setMobileRealtimeAgentMicEnabled?.(true);
        _voiceDebug?.('voice-settings-live-restarted-agent', { reason, listenMode: nextListenMode });
      })
      .catch((err) => {
        if (_isMobileRealtimeBootstrapSupersededError(err)) {
          _voiceDebug?.('voice-settings-live-restart-superseded', { reason });
          return;
        }
        _voiceDebug?.('voice-settings-live-restart-failed', { reason, message: err?.message || String(err) });
      });
  }

  function _mobileRealtimeBootstrapSupersededError(provider = 'Realtime agent') {
    const error = new Error(`${provider} bootstrap superseded`);
    error.code = 'MOBILE_REALTIME_BOOTSTRAP_SUPERSEDED';
    return error;
  }

  function _isMobileRealtimeBootstrapSupersededError(error) {
    return error?.code === 'MOBILE_REALTIME_BOOTSTRAP_SUPERSEDED'
      || /\bbootstrap superseded\b/i.test(String(error?.message || error || ''));
  }

  function _applyVoiceSettingsLive(previous = {}, next = {}, changed = {}) {
    const keys = Object.keys(changed || {});
    if (!keys.length) return;
    const oldKey = _mobileRealtimeProviderKeyFromSettings(previous);
    const newKey = _mobileRealtimeProviderKeyFromSettings(next);
    const activeConn = __pmRealtimeAgent?.conn;
    const activeProviderKey = activeConn
      ? (activeConn.provider === 'xai' ? 'xai_realtime' : 'openai_realtime')
      : '';
    const realtimeKeys = ['voiceMode', 'sttProvider', 'ttsProvider', 'listenMode', 'wakePhrase', 'wakeGateActive', 'realtimeVoice', 'realtimeSpeed', 'serverVoice', 'xaiSpeed', 'voiceAgentRealtimeAgent', 'voiceAgentXaiRealtime'];
    const touchedRealtime = keys.some((key) => realtimeKeys.includes(key));
    const openAiAgentVoiceChanged = activeProviderKey === 'openai_realtime'
      && keys.includes('realtimeVoice')
      && String(previous.realtimeVoice || '') !== String(next.realtimeVoice || '');
    // Do this before updating any other realtime connection: OpenAI rejects a
    // voice mutation after assistant audio, and the agent session is authoritative
    // while full realtime voice is active.
    if (openAiAgentVoiceChanged) {
      _restartMobileRealtimeAgentForSettings('openai_voice_changed');
      return;
    }
    if (keys.some((key) => ['realtimeVoice', 'realtimeSpeed', 'ttsProvider', 'voiceMode'].includes(key))) {
      _updateRealtimeSpeechConnectionFromSettings('settings_changed');
      if (String(previous.ttsProvider || '') === 'openai_realtime' && String(next.ttsProvider || '') !== 'openai_realtime') _closeRealtimeSpeechConnection?.();
    }
    if (!touchedRealtime && !activeConn) return;
    if (activeConn && (newKey === 'split' || (activeProviderKey && newKey !== activeProviderKey))) {
      _restartMobileRealtimeAgentForSettings('provider_changed');
      return;
    }
    if (!activeConn && newKey !== oldKey && newKey !== 'split' && _mobileRealtimeListenModeFromSettings(next) === 'always_listening') {
      _restartMobileRealtimeAgentForSettings('provider_enabled');
      return;
    }
    if (!activeConn) return;
    // OpenAI Realtime locks a conversation's voice once assistant audio exists.
    // A new WebRTC session is the supported way to switch voices; preserve the
    // user's listening mode and reconnect in the background instead of sending a
    // session.update that the service will reject.
    if (activeConn.provider === 'xai' && keys.some((key) => ['serverVoice', 'realtimeVoice', 'xaiSpeed'].includes(key))) {
      _restartMobileRealtimeAgentForSettings('xai_voice_or_speed_changed');
      return;
    }
    _sendMobileRealtimeAgentSessionUpdateFromSettings('settings_changed');
  }

  function _mobileVoiceDefaultProviderFromStatus(status) {
    const realtime = status?.realtime || {};
    const sttProviders = Array.isArray(status?.voice?.sttProviders) ? status.voice.sttProviders : [];
    const ttsProviders = Array.isArray(status?.voice?.ttsProviders) ? status.voice.ttsProviders : [];
    const openAiReady = !!(realtime?.configured && (realtime?.oauthConfigured || realtime?.apiKeyConfigured));
    if (openAiReady) return 'openai_realtime';
    const xaiReady =
      sttProviders.some(p => p?.configured && p?.id === 'xai') &&
      ttsProviders.some(p => p?.configured && p?.id === 'xai');
    return xaiReady ? 'xai' : 'default';
  }

  function _applyMobileVoiceProviderDefaults(status) {
    const provider = _mobileVoiceDefaultProviderFromStatus(status);
    if (provider === 'default') return false;
    const settings = __pmVoice.settings || {};
    const currentMode = String(settings.voiceMode || 'default');
    const autoProviderDefault = String(settings.autoProviderDefault || '');
    const isDefaultRoute =
      !settings.sttProviderLocked ||
      autoProviderDefault ||
      currentMode === 'default' ||
      (
        String(settings.sttProvider || 'browser') === 'browser' &&
        String(settings.ttsProvider || 'browser') === 'browser'
      );
    if (!isDefaultRoute) return false;
    if (
      currentMode === provider &&
      settings.listenMode === 'always_listening' &&
      autoProviderDefault === provider
    ) return false;
    _saveVoiceSettings({
      voiceMode: provider,
      sttProvider: _inputProviderForMode(provider),
      ttsProvider: _outputProviderForMode(provider),
      listenMode: 'always_listening',
      wakeGateActive: false,
      sttProviderLocked: true,
      autoProviderDefault: provider,
      serverVoice: provider === 'xai' ? (settings.serverVoice || 'eve') : '',
    });
    return true;
  }

  function _normalizeMobileWakePhrase(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _cleanMobileWakePhrase(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.:;"'!?-]+|[\s,.:;"'!?-]+$/g, '')
      .trim()
      .slice(0, 80);
  }

  function _stripMobileWakeCommandPunctuation(value) {
    return _cleanMobileWakePhrase(String(value || '').replace(/\b(?:please|thanks|thank you)\b/gi, ''));
  }

  function _parseMobileWakePhraseSettingCommand(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    if (!source) return null;
    const patterns = [
      /\bset\s+(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:to|as)\s+(.+)$/i,
      /\b(?:make|change)\s+(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:to|as)\s+(.+)$/i,
      /\b(?:my\s+|the\s+)?wake\s+(?:phrase|word)\s+(?:is|should\s+be)\s+(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const phrase = _stripMobileWakeCommandPunctuation(match?.[1] || '');
      if (phrase) return { kind: 'set_wake_phrase', phrase };
    }
    return null;
  }

  function _isMobileQuietModeCommand(value) {
    const normalized = _normalizeMobileWakePhrase(value);
    if (!normalized) return false;
    const command = normalized
      .replace(/^(?:(?:okay|ok|alright|all right|great|cool|perfect|thanks|thank you|now|please)\s+)+/g, '')
      .replace(/^prometheus\s+please\s+/g, 'prometheus ')
      .replace(/\s+(?:please|thanks|thank you)$/g, '')
      .trim();
    return [
      /^prometheus\s+quiet$/,
      /^quiet\s+prometheus$/,
      /^(?:be|go|stay|get|keep|become)\s+quiet\s+prometheus$/,
      /^prometheus\s+(?:be\s+quiet|go\s+quiet|quiet|sleep)$/,
      /^prometheus\s+stop\s+listening$/,
      /^(?:turn\s+on|enter|go\s+into|start)\s+quiet\s+mode$/,
      /^(?:prometheus\s+)?(?:now\s+)?be\s+quiet$/,
    ].some((pattern) => pattern.test(command));
  }

  function _isMobileWakeUnlockCommand(value) {
    const normalized = _normalizeMobileWakePhrase(value);
    if (!normalized) return false;
    return (
      /\bprometheus\s+(?:unlock|wake\s+up|listen\s+normally)\b/.test(normalized)
      || /\b(?:unlock|wake\s+up)\s+prometheus\b/.test(normalized)
      || /\b(?:turn|switch)\s+off\s+(?:the\s+)?wake\s+(?:phrase|word)\b/.test(normalized)
      || /\b(?:disable|clear|remove|reset)\s+(?:the\s+)?wake\s+(?:phrase|word)\b/.test(normalized)
    );
  }

  function _applyVoiceRuntimeDirective(directive) {
    const action = String(directive?.action || '');
    if (action === 'set_wake_phrase') {
      const wakePhrase = _cleanMobileWakePhrase(directive.wakePhrase || '');
      if (!wakePhrase) return false;
      _saveVoiceSettings({ wakePhrase, wakeGateActive: false });
      _setMobileRealtimeAgentWakePhrase(wakePhrase);
      __pmRealtimeAgent.quiet.active = false;
      __pmRealtimeAgent.quiet.pendingActivate = false;
      _sendMobileRealtimeAgentCreateResponseFlag(true);
      try { pmToast(`Wake phrase set to "${wakePhrase}"`, 'success'); } catch {}
      return true;
    }
    if (action === 'clear_wake_phrase') {
      _saveVoiceSettings({ wakePhrase: '', wakeGateActive: false });
      _setMobileRealtimeAgentWakePhrase('');
      __pmRealtimeAgent.quiet.active = false;
      __pmRealtimeAgent.quiet.pendingActivate = false;
      _sendMobileRealtimeAgentCreateResponseFlag(true);
      try { pmToast('Wake phrase cleared', 'success'); } catch {}
      return true;
    }
    if (action === 'set_quiet_until') {
      const wakePhrase = _cleanMobileWakePhrase(directive.wakePhrase || '');
      if (!wakePhrase) {
        try { pmToast('Wake phrase needed', 'Say "set my wake phrase to ..." first.', 'info'); } catch {}
        _voiceSetStatus('Wake phrase needed', 'Say “set my wake phrase to ...” first');
        return false;
      }
      _saveVoiceSettings({ wakePhrase, wakeGateActive: true });
      _setMobileRealtimeAgentWakePhrase(wakePhrase);
      __pmRealtimeAgent.quiet.pendingActivate = false;
      if (__pmRealtimeAgent.conn) _activateMobileRealtimeAgentQuietMode();
      _voiceSetStatus('Quiet mode', `Say "${wakePhrase}" to wake Prometheus`);
      try { pmToast(`Quiet until "${wakePhrase}"`, 'info'); } catch {}
      return true;
    }
    if (action === 'enter_quiet_mode') {
      const wakePhrase = _cleanMobileWakePhrase(directive.wakePhrase || __pmVoice?.settings?.wakePhrase || '');
      if (!wakePhrase) {
        try { pmToast('Wake phrase needed', 'Say "set my wake phrase to ..." first.', 'info'); } catch {}
        _voiceSetStatus('Wake phrase needed', 'Say “set my wake phrase to ...” first');
        return false;
      }
      _saveVoiceSettings({ wakePhrase, wakeGateActive: true });
      _setMobileRealtimeAgentWakePhrase(wakePhrase);
      __pmRealtimeAgent.quiet.pendingActivate = false;
      if (__pmRealtimeAgent.conn) _activateMobileRealtimeAgentQuietMode();
      _voiceSetStatus('Quiet mode', `Say "${wakePhrase}" to wake Prometheus`);
      try { pmToast(`Quiet until "${wakePhrase}"`, 'info'); } catch {}
      return true;
    }
    return false;
  }

  function _applyVoiceRuntimeDirectives(result, options = {}) {
    const directives = Array.isArray(result?.runtimeDirectives) ? result.runtimeDirectives : [];
    let applied = false;
    directives.forEach((directive) => {
      const afterReply = directive?.activateAfterReply === true || directive?.activate_after_reply === true;
      if (options.onlyAfterReply === true && !afterReply) return;
      if (options.deferAfterReply === true && afterReply) {
        __pmVoice.pendingRuntimeDirectivesAfterReply = Array.isArray(__pmVoice.pendingRuntimeDirectivesAfterReply)
          ? __pmVoice.pendingRuntimeDirectivesAfterReply
          : [];
        __pmVoice.pendingRuntimeDirectivesAfterReply.push(directive);
        return;
      }
      applied = _applyVoiceRuntimeDirective(directive) || applied;
    });
    return applied;
  }

  function _applyPendingVoiceRuntimeDirectivesAfterReply() {
    const pending = Array.isArray(__pmVoice.pendingRuntimeDirectivesAfterReply)
      ? __pmVoice.pendingRuntimeDirectivesAfterReply.splice(0)
      : [];
    let applied = false;
    pending.forEach((directive) => {
      applied = _applyVoiceRuntimeDirective(directive) || applied;
    });
    return applied;
  }

  let mobileVoiceWorkerContextPacketCache = null;
  let mobileVoiceWorkerContextPacketFetchedAt = 0;
  let mobileVoiceWorkerContextPacketPromise = null;
  let xaiWarmAudioContext = null;

  function _getCachedMobileVoiceWorkerContextPacket(sessionId) {
    const sid = String(sessionId || 'default').trim() || 'default';
    const packet = mobileVoiceWorkerContextPacketCache;
    const ageMs = Date.now() - Number(mobileVoiceWorkerContextPacketFetchedAt || 0);
    if (!packet || String(packet.sessionId || '') !== sid || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10_000) return null;
    return packet;
  }

  async function _prefetchMobileVoiceWorkerContextPacket(sessionId, options = {}) {
    const sid = String(sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || 'default').trim() || 'default';
    const cached = _getCachedMobileVoiceWorkerContextPacket(sid);
    if (cached && options.force !== true) return cached;
    if (mobileVoiceWorkerContextPacketPromise && options.force !== true) return mobileVoiceWorkerContextPacketPromise;
    mobileVoiceWorkerContextPacketPromise = (async () => {
      try {
        const result = await mobileGatewayFetch('/api/voice-agent/realtime-context', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: sid,
            source: String(options.source || 'mobile_voice_context_prefetch'),
            voiceMode: String(__pmVoice?.settings?.voiceMode || 'default'),
            originalUserPrompt: String(options.originalUserPrompt || ''),
            voiceTarget: _mobileVoiceTargetPayload(),
            voiceRoomContext: _mobileVoiceRoomContextPayload(),
          }),
        });
        if (!result?.success && !result?.ok) return null;
        if (!result?.contextPacket) return null;
        mobileVoiceWorkerContextPacketCache = result.contextPacket;
        mobileVoiceWorkerContextPacketFetchedAt = Date.now();
        _voiceDebug?.('voice-context-prefetch-ok', { sessionId: sid, source: options.source || '', elapsedMs: result?.timings?.totalMs || null });
        return mobileVoiceWorkerContextPacketCache;
      } catch (err) {
        console.warn('[voice] mobile context packet prefetch failed', err);
        _voiceDebug?.('voice-context-prefetch-error', { sessionId: sid, source: options.source || '', message: String(err?.message || err).slice(0, 300) });
        return null;
      } finally {
        mobileVoiceWorkerContextPacketPromise = null;
      }
    })();
    return mobileVoiceWorkerContextPacketPromise;
  }

  function _prewarmMobileVoiceWorkerContext(options = {}) {
    const sid = String(options.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || '').trim();
    if (!sid) return;
    _prefetchMobileVoiceWorkerContextPacket(sid, options).catch(() => {});
  }

  function _prewarmMobileCodexRealtimeBridge() {
    if (_mobileRealtimeProviderKeyFromSettings(__pmVoice?.settings || {}) !== 'openai_realtime') return null;
    if (__pmVoice?.codexRealtimeBridgeWarmPromise) return __pmVoice.codexRealtimeBridgeWarmPromise;
    const promise = mobileGatewayFetch('/api/realtime/status', { method: 'GET' })
      .then((status) => {
        _voiceDebug?.('codex-realtime-bridge-prewarm', {
          available: status?.codexBridgeAvailable === true,
          transport: status?.transport || '',
        });
        return status;
      })
      .catch((err) => {
        _voiceDebug?.('codex-realtime-bridge-prewarm-failed', { message: err?.message || String(err) });
        return null;
      })
      .finally(() => {
        if (__pmVoice) __pmVoice.codexRealtimeBridgeWarmPromise = null;
      });
    __pmVoice.codexRealtimeBridgeWarmPromise = promise;
    return promise;
  }

  function _getMobileVoiceWorkerContextPacketForTurn(sessionId, options = {}) {
    const sid = String(sessionId || 'default').trim() || 'default';
    const cached = _getCachedMobileVoiceWorkerContextPacket(sid);
    if (!cached) _prefetchMobileVoiceWorkerContextPacket(sid, options).catch(() => {});
    return cached;
  }

  // Persistent voice state across navigation.

  const PM_VOICE_ROOM_STATE_KEY = 'pm_voice_room_state_v1';
  const PM_VOICE_ROOM_FOCUS_MS = 45_000;
  const PM_VOICE_ROOM_ROUTE_DEDUPE_MS = 12_000;
  const PM_VOICE_ROOM_WARM_MAX = 4;

  function _voiceRoomNormalizeText(value) {
    return _normalizeMobileWakePhrase(String(value || ''));
  }

  function _voiceRoomParticipantKey(participant = {}) {
    const kind = String(participant?.kind || '').trim();
    if (kind === 'subagent') {
      const id = String(participant.agentId || participant.id || '').trim();
      return id ? `subagent:${id}` : '';
    }
    return kind === 'main' || !kind ? 'main' : '';
  }

  function _voiceRoomParticipantLabel(participant = {}) {
    if (String(participant?.kind || '') === 'main') return String(participant.label || 'Prometheus').trim() || 'Prometheus';
    return String(participant.label || participant.name || participant.alias || participant.agentId || participant.id || 'Subagent').trim() || 'Subagent';
  }

  function _voiceRoomUniqueAliases(values = []) {
    const out = [];
    const seen = new Set();
    values.forEach((value) => {
      const label = String(value || '').replace(/\s+/g, ' ').trim();
      const normalized = _voiceRoomNormalizeText(label);
      if (!label || !normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(label);
    });
    return out;
  }

  function _voiceMainRoomParticipant() {
    return {
      key: 'main',
      kind: 'main',
      label: 'Prometheus',
      aliases: _voiceRoomUniqueAliases(['Prometheus', 'Prom', 'main agent', 'main chat']),
    };
  }

  function _voiceSubagentRoomParticipant(agent = {}) {
    const agentId = String(agent?.agentId || agent?.id || '').trim();
    if (!agentId) return null;
    const label = String(agent?.label || agent?.name || agent?.alias || agentId).trim() || agentId;
    const voice = agent.voice || agent.raw?.voice || null;
    return {
      key: `subagent:${agentId}`,
      kind: 'subagent',
      agentId,
      label,
      voice,
      aliases: _voiceRoomUniqueAliases([label, agent.alias, agent.name, agentId]),
    };
  }

  function _normalizeVoiceRoomState(source = {}) {
    const fallback = {
      enabled: false,
      participants: [],
      activeKey: '',
      focusUntil: 0,
      quiet: {},
      recentRoutes: [],
      transcript: [],
      sessionId: '',
      rosterKey: '',
    };
    const participants = Array.isArray(source?.participants)
      ? source.participants.map((item) => {
          const participant = String(item?.kind || '') === 'subagent'
            ? _voiceSubagentRoomParticipant(item)
            : _voiceMainRoomParticipant();
          if (!participant) return null;
          const aliases = _voiceRoomUniqueAliases([...(Array.isArray(item?.aliases) ? item.aliases : []), participant.label, ...(participant.aliases || [])]);
          return { ...participant, aliases };
        }).filter(Boolean)
      : [];
    const unique = [];
    const seen = new Set();
    participants.forEach((participant) => {
      const key = _voiceRoomParticipantKey(participant);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push({ ...participant, key });
    });
    const activeKey = String(source?.activeKey || '').trim();
    const focusUntil = Number(source?.focusUntil || 0) || 0;
    const quiet = source?.quiet && typeof source.quiet === 'object' ? { ...source.quiet } : {};
    const recentRoutes = Array.isArray(source?.recentRoutes) ? source.recentRoutes.slice(-12) : [];
    const transcript = (Array.isArray(source?.transcript) ? source.transcript : [])
      .map((entry) => ({
        role: String(entry?.role || '').trim() === 'assistant' ? 'assistant' : 'user',
        speaker: String(entry?.speaker || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        targetKey: String(entry?.targetKey || '').trim().slice(0, 180),
        text: String(entry?.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
        at: Number(entry?.at || 0) || Date.now(),
      }))
      .filter((entry) => entry.text)
      .slice(-48);
    return {
      ...fallback,
      enabled: source?.enabled === true && unique.length > 1,
      participants: unique,
      activeKey: activeKey && unique.some((p) => p.key === activeKey) ? activeKey : (unique[0]?.key || ''),
      focusUntil,
      quiet,
      recentRoutes,
      transcript,
      sessionId: String(source?.sessionId || '').trim(),
      rosterKey: String(source?.rosterKey || '').trim(),
    };
  }

  function _loadVoiceRoomState() {
    try {
      return _normalizeVoiceRoomState(JSON.parse(localStorage.getItem(PM_VOICE_ROOM_STATE_KEY) || '{}'));
    } catch {
      return _normalizeVoiceRoomState({});
    }
  }

  function _saveVoiceRoomState(next = null) {
    const room = _normalizeVoiceRoomState(next || __pmVoice?.room || {});
    __pmVoice.room = room;
    try { localStorage.setItem(PM_VOICE_ROOM_STATE_KEY, JSON.stringify(room)); } catch {}
    return room;
  }

  __pmVoice.room = _normalizeVoiceRoomState(__pmVoice.room || _loadVoiceRoomState());

  function _isVoiceRoomEnabled() {
    return __pmVoice?.room?.enabled === true && Array.isArray(__pmVoice.room.participants) && __pmVoice.room.participants.length > 1;
  }

  function _voiceRoomActiveParticipant() {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    if (!room.enabled) return null;
    return room.participants.find((participant) => participant.key === room.activeKey) || room.participants[0] || null;
  }

  function _voiceRoomCurrentTargetKey() {
    const target = __pmVoice?.target;
    if (target?.kind === 'subagent') return _voiceRoomParticipantKey(target);
    return 'main';
  }

  function _exitMobileVoiceRoomForFreshChat(reason = 'regular_mobile_chat') {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || _loadVoiceRoomState());
    const activeConn = __pmRealtimeAgent?.conn || null;
    const wasRoomActive = room.enabled || activeConn?.roomActive === true || String(activeConn?.sessionId || '').startsWith('voice_room_');
    if (wasRoomActive) {
      try { _stopMobileRealtimeAgentSession?.(); } catch {}
    }
    __pmVoice.room = _saveVoiceRoomState({
      enabled: false,
      participants: [],
      activeKey: '',
      focusUntil: 0,
      quiet: {},
      recentRoutes: [],
      transcript: [],
      sessionId: '',
      rosterKey: '',
    });
    _voiceDebug?.('voice-room-exited-for-fresh-chat', { reason, wasRoomActive });
    return wasRoomActive;
  }

  function _voiceRoomRememberTranscript(role, speaker, text, targetKey = '') {
    if (!_isVoiceRoomEnabled()) return false;
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return false;
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    const cleanRole = String(role || '') === 'assistant' ? 'assistant' : 'user';
    const cleanSpeaker = String(speaker || (cleanRole === 'user' ? 'User' : 'Agent')).replace(/\s+/g, ' ').trim();
    const normalized = _normalizeVoiceEchoText(cleanText);
    const duplicate = [...room.transcript].reverse().slice(0, 4).some((entry) => (
      entry.role === cleanRole
      && entry.speaker === cleanSpeaker
      && _normalizeVoiceEchoText(entry.text) === normalized
      && Date.now() - Number(entry.at || 0) < 8_000
    ));
    if (duplicate) return false;
    const entry = {
      role: cleanRole,
      speaker: cleanSpeaker,
      targetKey: String(targetKey || '').trim(),
      text: cleanText.slice(0, 1200),
      at: Date.now(),
    };
    room.transcript.push(entry);
    room.transcript = room.transcript.slice(-48);
    _saveVoiceRoomState(room);
    const roomSessionId = String(room.sessionId || __pmVoice?.targetSessionId || '').trim();
    if (roomSessionId.startsWith('voice_room_')) {
      const messageId = `voice-room-${entry.at}-${cleanRole}-${Math.random().toString(36).slice(2, 8)}`;
      appendMobileVoiceRoomTranscript(roomSessionId, {
        messageId,
        role: cleanRole,
        speaker: cleanSpeaker,
        targetKey: entry.targetKey,
        text: entry.text,
        timestamp: entry.at,
      }).then(() => {
        invalidateMobileDrawerSessions('voice_room');
      }).catch((error) => {
        _voiceDebug?.('voice-room-transcript-persist-failed', { message: error?.message || String(error) });
      });
    }
    mobileVoiceWorkerContextPacketCache = null;
    mobileVoiceWorkerContextPacketFetchedAt = 0;
    return true;
  }

  async function _resolveDurableMobileVoiceRoom(participants = []) {
    const normalized = participants.map((participant) => ({
      key: _voiceRoomParticipantKey(participant),
      kind: String(participant?.kind || 'main'),
      agentId: String(participant?.agentId || '').trim(),
      label: _voiceRoomParticipantLabel(participant),
    })).filter((participant) => participant.key);
    const result = await resolveMobileVoiceRoom(normalized);
    const session = result?.session;
    const sid = String(session?.id || '').trim();
    if (!result?.success || !sid) throw new Error(result?.error || 'Voice Room session could not be resolved.');
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    room.sessionId = sid;
    room.rosterKey = String(session?.voiceRoom?.rosterKey || normalized.map((participant) => participant.key).sort().join('|'));
    __pmVoice.room = _saveVoiceRoomState(room);
    __pmVoice.targetSessionId = sid;
    __pmVoice.targetSessionLabel = String(session?.title || `Voice Room · ${normalized.map((participant) => participant.label).join(' + ')}`);
    __pmVoice.targetSessionChannel = 'voice_room';
    __pmVoice.targetSessionForced = true;
    __pmChat.activeSessionId = sid;
    _rememberMobileLastChatSession(sid);
    if (!Array.isArray(__pmChat.threads?.[sid])) __pmChat.threads[sid] = [];
    if (!Array.isArray(__pmChat.attachments?.[sid])) __pmChat.attachments[sid] = [];
    await _rebindMobileCodexBridgeOwnerSession(sid);
    invalidateMobileDrawerSessions('voice_room');
    refreshMobileDrawerSessions({ force: true, channel: 'voice_room' }).catch(() => {});
    return session;
  }

  async function _loadDurableMobileVoiceRoom(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid.startsWith('voice_room_')) return false;
    const data = await loadMobileChatSession(sid);
    const session = data?.session || data;
    const meta = session?.voiceRoom;
    if (!meta || !Array.isArray(meta.participants) || meta.participants.length < 2) return false;
    const agents = await loadMobileSubagents().catch(() => []);
    const byId = new Map(agents.map((agent) => [String(agent?.id || '').trim(), agent]));
    const participants = meta.participants.map((participant) => {
      if (String(participant?.kind || '') !== 'subagent') return _voiceMainRoomParticipant();
      return _voiceSubagentRoomParticipant({
        ...(byId.get(String(participant.agentId || '').trim()) || {}),
        id: participant.agentId,
        name: participant.label,
      });
    }).filter(Boolean);
    const history = Array.isArray(session?.history) ? session.history : [];
    const transcript = history
      .filter((message) => String(message?.source || '') === 'voice_room_transcript')
      .map((message) => ({
        role: String(message?.role || '') === 'assistant' ? 'assistant' : 'user',
        speaker: String(message?.voiceSpeaker || (message?.role === 'user' ? 'User' : 'Agent')),
        targetKey: String(message?.voiceTargetKey || ''),
        text: String(message?.content || ''),
        at: Number(message?.timestamp || 0) || Date.now(),
      }))
      .slice(-48);
    const activeKey = participants.some((participant) => participant.key === __pmVoice?.room?.activeKey)
      ? __pmVoice.room.activeKey
      : participants[0].key;
    __pmVoice.room = _saveVoiceRoomState({
      enabled: true,
      participants,
      activeKey,
      focusUntil: 0,
      quiet: {},
      recentRoutes: [],
      transcript,
      sessionId: sid,
      rosterKey: String(meta.rosterKey || ''),
    });
    __pmVoice.targetSessionId = sid;
    __pmVoice.targetSessionLabel = String(session?.title || 'Voice Room');
    __pmVoice.targetSessionChannel = 'voice_room';
    __pmVoice.targetSessionForced = true;
    __pmChat.activeSessionId = sid;
    __pmChat.threads[sid] = history.map(_mapServerMessageToMobile).filter(Boolean);
    __pmChat.thread = __pmChat.threads[sid];
    _rememberMobileLastChatSession(sid);
    const active = participants.find((participant) => participant.key === activeKey) || participants[0];
    await _applyMobileVoiceTarget(active, { restart: false, applyLive: false, reason: 'voice_room_session_loaded' });
    return true;
  }

  function _mobileVoiceRoomContextPayload(options = {}) {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    if (!room.enabled || room.participants.length < 2) return null;
    const maxEntries = Math.max(1, Math.min(48, Number(options.maxEntries || 32) || 32));
    return {
      enabled: true,
      activeKey: room.activeKey || _voiceRoomCurrentTargetKey(),
      participants: room.participants.map((participant) => ({
        key: _voiceRoomParticipantKey(participant),
        kind: String(participant?.kind || 'main'),
        agentId: String(participant?.agentId || '').trim(),
        label: _voiceRoomParticipantLabel(participant),
      })),
      transcript: room.transcript.slice(-maxEntries),
      updatedAt: Number(room.transcript[room.transcript.length - 1]?.at || Date.now()) || Date.now(),
    };
  }

  function _mobileVoiceRoomTranscriptBlock(options = {}) {
    const payload = _mobileVoiceRoomContextPayload(options);
    if (!payload?.transcript?.length) return '';
    const maxChars = Math.max(800, Math.min(7000, Number(options.maxChars || 5200) || 5200));
    const lines = payload.transcript.map((entry) => `${entry.speaker || (entry.role === 'assistant' ? 'Agent' : 'User')}: ${entry.text}`);
    while (lines.length > 1 && lines.join('\n').length > maxChars) lines.shift();
    return [
      '[VOICE_ROOM_SHARED_TRANSCRIPT]',
      'This is the shared transcript of the current private Voice Room. It includes turns spoken to other participants. Treat it as conversation you witnessed; do not claim every line was addressed to you.',
      ...lines,
      '[/VOICE_ROOM_SHARED_TRANSCRIPT]',
    ].join('\n');
  }

  function _mobileVoiceRoomHandoffContextText(participant, currentTurn) {
    const label = _voiceRoomParticipantLabel(participant);
    // Keep handoffs fast: the current conversational window is more useful than
    // replaying the whole room into an already-warmed AVAS participant.
    const transcriptBlock = _mobileVoiceRoomTranscriptBlock({ maxEntries: 20, maxChars: 3200 });
    const turn = String(currentTurn || '').replace(/\s+/g, ' ').trim();
    return [
      transcriptBlock,
      '[VOICE_ROOM_CURRENT_TURN]',
      `The user is now addressing ${label}. Answer as ${label} with the shared room discussion in mind.`,
      turn,
      '[/VOICE_ROOM_CURRENT_TURN]',
    ].filter(Boolean).join('\n\n');
  }

  function _voiceRoomSetFocus(participant) {
    const key = _voiceRoomParticipantKey(participant);
    if (!key) return;
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    room.activeKey = key;
    room.focusUntil = Date.now() + PM_VOICE_ROOM_FOCUS_MS;
    _saveVoiceRoomState(room);
  }

  function _voiceRoomQuietState(key) {
    const quiet = __pmVoice?.room?.quiet || {};
    const state = quiet?.[key] && typeof quiet[key] === 'object' ? quiet[key] : null;
    return state?.active === true ? state : null;
  }

  function _voiceRoomSetQuiet(participant, phrase = '') {
    const key = _voiceRoomParticipantKey(participant);
    if (!key) return;
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    const aliases = Array.isArray(participant?.aliases) ? participant.aliases : [];
    const wakePhrase = String(phrase || aliases[0] || _voiceRoomParticipantLabel(participant)).replace(/\s+/g, ' ').trim();
    room.quiet = { ...(room.quiet || {}), [key]: { active: true, wakePhrase } };
    _saveVoiceRoomState(room);
  }

  function _voiceRoomClearQuiet(participant) {
    const key = _voiceRoomParticipantKey(participant);
    if (!key) return;
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    room.quiet = { ...(room.quiet || {}) };
    delete room.quiet[key];
    _saveVoiceRoomState(room);
  }

  function _voiceRoomAliasPatterns(alias) {
    const normalized = _voiceRoomNormalizeText(alias);
    if (!normalized) return [];
    return [
      `hey ${normalized}`,
      `hi ${normalized}`,
      `hello ${normalized}`,
      `okay ${normalized}`,
      `ok ${normalized}`,
      `yo ${normalized}`,
      normalized,
    ];
  }

  function _voiceRoomSpeechWords(value) {
    const words = String(value || '').match(/[\p{L}\p{N}']+/gu) || [];
    return words.map((raw) => ({ raw, normalized: _voiceRoomNormalizeText(raw) }))
      .filter((word) => word.normalized);
  }

  function _voiceRoomStartsWithWords(words = [], at = 0, pattern = []) {
    if (!pattern.length || at < 0 || at + pattern.length > words.length) return false;
    return pattern.every((word, index) => words[at + index]?.normalized === word);
  }

  function _voiceRoomOnlyLeadingFillers(words = [], end = 0) {
    // Keep name mentions in ordinary prose from stealing the room.  A greeting
    // may be preceded by natural disfluencies, but not arbitrary sentence text.
    const fillers = new Set(['uh', 'um', 'er', 'erm', 'ah', 'hmm', 'hm', 'well', 'alright', 'all', 'right', 'okay', 'ok', 'so', 'please', 'just', 'now', 'then', 'again', 'yeah', 'yep']);
    return words.slice(0, Math.max(0, end)).every((word) => fillers.has(word.normalized));
  }

  function _voiceRoomConversationalAddressPrefix(words = [], aliasAt = 0) {
    // Natural room handoffs often put the name after the conversational cue:
    // "How about you, Nolan?", "What do you think, Victor?", or
    // "Let's hear from Prometheus." Keep these patterns explicit so a mere
    // mention such as "I talked to Nolan yesterday" cannot steal the room.
    const patterns = [
      ['i', 'would', 'like', 'to', 'hear', 'from'],
      ['i', 'want', 'to', 'hear', 'from'],
      ['can', 'we', 'hear', 'from'],
      ['can', 'i', 'hear', 'from'],
      ['let s', 'hear', 'from'],
      ['let', 'us', 'hear', 'from'],
      ['what', 'do', 'you', 'think'],
      ['what', 'do', 'you', 'say'],
      ['what', 'about', 'you'],
      ['what', 'bout', 'you'],
      ['how', 'about', 'you'],
      ['how', 'bout', 'you'],
      ['how', 'are', 'you'],
      ['over', 'to', 'you'],
      ['your', 'turn'],
      ['and', 'you'],
      ['let', 'me', 'ask'],
      ['can', 'we', 'ask'],
      ['can', 'i', 'ask'],
      ['i', 'want', 'to', 'ask'],
    ];
    for (const pattern of patterns) {
      const start = aliasAt - pattern.length;
      if (start < 0 || !_voiceRoomStartsWithWords(words, start, pattern)) continue;
      // These are explicit handoff phrases, so they remain valid after an
      // earlier sentence: "I'm good. How about you, Victor?". Requiring the
      // phrase to start the whole transcription caused the active agent to
      // answer those turns instead of handing them off.
      return { start, pattern };
    }
    return null;
  }

  function _voiceRoomHasUnmatchedAddressCue(transcript) {
    const words = _voiceRoomSpeechWords(transcript);
    if (words.length < 2) return false;
    const greetings = new Set(['hey', 'hi', 'hello', 'yo', 'okay', 'ok']);
    for (let index = 0; index < words.length - 1; index += 1) {
      if (!greetings.has(words[index]?.normalized) || !_voiceRoomOnlyLeadingFillers(words, index)) continue;
      return true;
    }
    for (let index = 1; index < words.length; index += 1) {
      if (_voiceRoomConversationalAddressPrefix(words, index)) return true;
    }
    return words.some((word, index) => /^(?:ask|tell)$/.test(word.normalized || '') && index < words.length - 2);
  }

  function _voiceRoomMatchAddress(transcript, participants = []) {
    const words = _voiceRoomSpeechWords(transcript);
    if (!words.length) return null;
    const greetings = new Set(['hey', 'hi', 'hello', 'yo', 'okay', 'ok']);
    const byParticipant = new Map();
    participants.forEach((participant) => {
      const aliases = Array.isArray(participant.aliases) && participant.aliases.length ? participant.aliases : [_voiceRoomParticipantLabel(participant)];
      aliases.forEach((alias) => {
        const aliasWords = _voiceRoomNormalizeText(alias).split(/\s+/).filter(Boolean);
        if (!aliasWords.length) return;
        for (let at = 0; at <= words.length - aliasWords.length; at += 1) {
          if (!_voiceRoomStartsWithWords(words, at, aliasWords)) continue;
          const greeting = at > 0 && greetings.has(words[at - 1]?.normalized);
          const direct = at === 0 || _voiceRoomOnlyLeadingFillers(words, at);
          const conversational = _voiceRoomConversationalAddressPrefix(words, at);
          const asked = at > 0
            && /^(?:ask|tell)$/.test(words[at - 1]?.normalized || '')
            && words[at + aliasWords.length]?.normalized === 'to';
          // A greeting can follow harmless fillers ("Uh, hey Victor"), while a
          // naked alias must begin the utterance.  This intentionally rejects
          // prose such as "I talked to Victor yesterday".
          const greetingAddress = greeting && _voiceRoomOnlyLeadingFillers(words, at - 1);
          if (!asked && !conversational && !greetingAddress && !direct) continue;
          const mode = asked ? 'ask_tell' : (conversational ? 'conversational' : (greetingAddress ? 'greeting' : 'direct'));
          const remainderAt = at + aliasWords.length + (asked ? 1 : 0);
          const remainder = conversational
            ? words.slice(conversational.start).map((word) => word.raw).join(' ').trim()
            : words.slice(remainderAt).map((word) => word.raw).join(' ').trim();
          const candidate = {
            participant,
            pattern: aliasWords.join(' '),
            mode,
            score: (asked ? 3000 : (conversational ? 2500 : (greetingAddress ? 2000 : 1000))) + (aliasWords.length * 20),
            remainder,
          };
          const key = _voiceRoomParticipantKey(participant);
          const existing = byParticipant.get(key);
          if (!existing || candidate.score > existing.score) byParticipant.set(key, candidate);
        }
      });
    });
    const matches = [...byParticipant.values()].sort((a, b) => b.score - a.score);
    if (!matches.length) return null;
    if (matches.length > 1 && matches[0].score === matches[1].score) {
      return { ambiguous: true, candidates: matches.filter((match) => match.score === matches[0].score) };
    }
    return matches[0];
  }

  function _mobileVoiceRoomCodexInstructions(baseInstructions, participantKey = '') {
    const base = String(baseInstructions || '').trim();
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    if (!room.enabled || room.participants.length < 2) return base;
    const currentKey = String(participantKey || _voiceRoomCurrentTargetKey()).trim();
    const current = room.participants.find((participant) => _voiceRoomParticipantKey(participant) === currentKey) || null;
    const currentLabel = _voiceRoomParticipantLabel(current || {}) || 'the current agent';
    const otherLabels = room.participants
      .filter((participant) => _voiceRoomParticipantKey(participant) !== currentKey)
      .map((participant) => _voiceRoomParticipantLabel(participant))
      .filter(Boolean);
    if (!otherLabels.length) return base;
    const routingContract = [
      '[VOICE_ROOM_HOST_ROUTING]',
      `You are ${currentLabel}, one participant in a host-routed private voice room.`,
      `Other participants in this room: ${otherLabels.join(', ')}.`,
      'The host normally switches participants when the user explicitly addresses another participant by name.',
      'If you still receive a turn that clearly addresses any other participant, call voice_room_handoff immediately with that participant key and the complete user request. This is a safety fallback for a missed host switch.',
      'Never speak, acknowledge, say "one sec", announce the handoff, or merely say "that\'s for Victor" before calling voice_room_handoff. The newly active participant answers instead.',
      `Respond normally only when the user addresses ${currentLabel}, or when no other participant is explicitly addressed.`,
    ].join('\n');
    const transcriptBlock = _mobileVoiceRoomTranscriptBlock({ maxEntries: 24, maxChars: 4200 });
    return [base, routingContract, transcriptBlock].filter(Boolean).join('\n\n');
  }

  function _voiceRoomParseQuietCommand(transcript, match) {
    if (!match?.participant) return null;
    const label = _voiceRoomParticipantLabel(match.participant);
    const text = String(match.remainder || transcript || '').replace(/\s+/g, ' ').trim();
    const normalized = _voiceRoomNormalizeText(text);
    if (!normalized) return null;
    const quiet = normalized.match(/\b(?:be quiet|go quiet|stay quiet|mute|stand by|sleep)\b(?:\s+until\s+(?:i\s+say\s+)?(.+))?/i);
    if (quiet) return { action: 'quiet', phrase: String(quiet[1] || '').trim() || label };
    if (/\b(?:wake up|listen normally|come back|unmute|you can talk|start listening)\b/i.test(normalized)) return { action: 'wake' };
    return null;
  }

  function _voiceRoomRouteDedupeKey(participant, text) {
    const key = _voiceRoomParticipantKey(participant);
    const normalized = _voiceRoomNormalizeText(text);
    return key && normalized ? `${key}:${normalized}` : '';
  }

  function _voiceRoomSeenRecently(participant, text) {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    const routeKey = _voiceRoomRouteDedupeKey(participant, text);
    if (!routeKey) return false;
    const now = Date.now();
    const recent = Array.isArray(room.recentRoutes) ? room.recentRoutes : [];
    return recent.some((entry) => entry?.key === routeKey && now - Number(entry.at || 0) < PM_VOICE_ROOM_ROUTE_DEDUPE_MS);
  }

  function _voiceRoomRememberRoute(participant, text) {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    const routeKey = _voiceRoomRouteDedupeKey(participant, text);
    if (!routeKey) return;
    const now = Date.now();
    const recent = (Array.isArray(room.recentRoutes) ? room.recentRoutes : [])
      .filter((entry) => entry?.key !== routeKey && now - Number(entry?.at || 0) < PM_VOICE_ROOM_ROUTE_DEDUPE_MS)
      .slice(-10);
    recent.push({ key: routeKey, at: now });
    room.recentRoutes = recent;
    _saveVoiceRoomState(room);
  }

  async function _applyMobileVoiceTarget(participant = {}, options = {}) {
    const kind = String(participant?.kind || 'main').trim();
    if (kind === 'subagent') {
      const agentId = String(participant.agentId || participant.id || '').trim();
      if (!agentId) return null;
      const detail = participant.voice && participant.label
        ? participan
        : await loadMobileSubagentDetail(agentId).catch(() => null);
      const label = _voiceRoomParticipantLabel(detail || participant);
      const voiceProfile = participant.voice || detail?.voice || detail?.raw?.voice || null;
      __pmVoice.target = { kind: 'subagent', agentId, label, voice: voiceProfile };
      __pmVoice.targetSessionId = `subagent_chat_${agentId}`;
      __pmVoice.targetSessionLabel = label;
      __pmVoice.targetSessionChannel = 'subagent';
      __pmVoice.targetSessionForced = true;
      _setTemporaryMobileSubagentVoiceProfile(voiceProfile, { applyLive: options.applyLive !== false });
    } else {
      _restoreTemporaryMobileSubagentVoiceProfile({ applyLive: options.applyLive !== false });
      __pmVoice.target = { kind: 'main' };
      __pmVoice.targetSessionForced = false;
      const sid = String(__pmChat?.activeSessionId || __pmVoice.targetSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
      __pmVoice.targetSessionId = sid;
      __pmVoice.targetSessionLabel = sid === MOBILE_CHAT_SESSION_ID ? 'Mobile - New Chat' : 'Mobile - Chat';
      __pmVoice.targetSessionChannel = 'mobile';
    }
    if (options.restart !== false) _restartMobileRealtimeAgentForSettings?.(String(options.reason || 'voice_target_changed'));
    try { options.paint?.(); } catch {}
    return __pmVoice.target || { kind: 'main' };
  }

  async function _refreshMobileRealtimeAgentRoomTarget(participant = {}, options = {}) {
    const conn = __pmRealtimeAgent?.conn;
    const dc = conn?.dc;
    if (!conn || !dc || dc.readyState !== 'open') return false;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // AVAS v3 is bound to its app-server thread at start time.  Pretending a
      // public session.update succeeded here leaves the previous agent alive.
      _voiceDebug?.('voice-room-codex-target-refresh-requires-handoff', {
        target: _voiceRoomParticipantKey(participant),
        reason: String(options.reason || ''),
      });
      return false;
    }
    const sid = String(__pmVoice?.targetSessionId || _mobileRealtimeAgentEffectiveSessionId?.() || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    const listenMode = String(conn.listenMode || __pmRealtimeAgent?.listenMode || _mobileRealtimeListenModeFromSettings(__pmVoice?.settings || {}) || 'always_listening');
    const quietState = _syncMobileRealtimeAgentQuietFromSettings?.() || {};
    const wakePhrase = quietState.wakePhrase;
    try {
      const source = String(options.source || options.reason || 'voice_room_target_refresh');
      const workerContextPacket = await _prefetchMobileVoiceWorkerContextPacket(sid, { source, force: true });
      const provider = String(conn.provider || '').trim();
      const isXai = provider === 'xai';
      const endpoint = isXai ? '/api/voice-agent/xai-realtime-bootstrap' : '/api/voice-agent/realtime-bootstrap';
      const settings = __pmVoice?.settings || {};
      const bootstrap = await mobileGatewayFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sid,
          voiceTarget: _mobileVoiceTargetPayload(),
          voice: isXai
            ? _mobileXaiVoice(settings.serverVoice || settings.realtimeVoice)
            : String(settings.realtimeVoice || 'marin'),
          speed: isXai ? Number(settings.xaiSpeed || 1.0) : Number(settings.realtimeSpeed || 1.05),
          voiceRuntime: wakePhrase
            ? { wakePhrase, wakeGateActive: settings.wakeGateActive === true }
            : undefined,
          cameraRuntime: _mobileRealtimeCameraRuntimePayload(),
          deviceTime: _mobileVoiceDeviceTimeContext(),
          voiceRoomContext: _mobileVoiceRoomContextPayload(),
          ...(workerContextPacket ? { contextPacket: workerContextPacket } : {}),
        }),
      });
      if (!bootstrap?.success) throw new Error(bootstrap?.error || 'Realtime target refresh failed');
      const turnDetection = _mobileRealtimeTurnDetectionForListenMode(listenMode, settings);
      if (isXai) {
        const speed = Number(settings.xaiSpeed || bootstrap.speed || 1.0);
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions: bootstrap.instructions,
            voice: bootstrap.voice || _mobileXaiVoice(settings.serverVoice || settings.realtimeVoice),
            speed,
            audio: { output: { speed } },
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'grok-stt' },
            turn_detection: turnDetection,
          },
        }));
        if (Array.isArray(bootstrap.tools) && bootstrap.tools.length) {
          dc.send(JSON.stringify({ type: 'session.update', session: { tools: bootstrap.tools, tool_choice: 'auto' } }));
        }
      } else {
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: bootstrap.instructions,
            tools: Array.isArray(bootstrap.tools) ? bootstrap.tools : [],
            tool_choice: 'auto',
            audio: {
              input: {
                turn_detection: turnDetection,
                transcription: { model: 'gpt-realtime-whisper' },
              },
              output: {
                voice: settings.realtimeVoice || 'marin',
                speed: Number(settings.realtimeSpeed || 1.05),
              },
            },
          },
        }));
      }
      conn.sessionId = sid;
      conn.listenMode = listenMode;
      conn.baseInstructions = String(bootstrap.instructions || conn.baseInstructions || '').trim();
      __pmRealtimeAgent.listenMode = listenMode;
      _sendMobileRealtimeCameraRuntimeUpdate('voice_room_target_refresh');
      if (listenMode === 'always_listening') _setMobileRealtimeAgentMicEnabled(true);
      _voiceDebug?.('voice-room-target-refresh-ok', {
        sessionId: sid,
        provider: provider || 'openai_webrtc',
        target: _voiceRoomParticipantKey(participant),
        label: _voiceRoomParticipantLabel(participant),
        listenMode,
      });
      return true;
    } catch (err) {
      _voiceDebug?.('voice-room-target-refresh-failed', {
        sessionId: sid,
        target: _voiceRoomParticipantKey(participant),
        message: err?.message || String(err),
      });
      return false;
    }
  }

  function _sendMobileRealtimeRoomTextToTarget(participant = {}, userText = '', options = {}) {
    const conn = __pmRealtimeAgent?.conn;
    const dc = conn?.dc;
    const text = String(userText || '').replace(/\s+/g, ' ').trim();
    if (!conn || !dc || dc.readyState !== 'open' || !text) return false;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // Do not feed AVAS v3 public conversation/response commands.  Targe
      // changes use _handoffMobileCodexVoiceRoomTarget after a new thread is up.
      _voiceDebug?.('voice-room-codex-public-text-blocked', {
        target: _voiceRoomParticipantKey(participant),
        textLen: text.length,
        ackOnly: options.ackOnly === true,
      });
      return false;
    }
    const label = _voiceRoomParticipantLabel(participant);
    const isAck = options.ackOnly === true;
    const prompt = isAck
      ? `[VOICE_ROOM_TARGET_SWITCH]\nThe user addressed ${label} in a voice room. Briefly acknowledge as ${label} in one short natural sentence. Do not start any work unless the user asks for it.`
      : `[VOICE_ROOM_ROUTE]\nThe user addressed ${label} in a voice room. Treat this as ${label}'s current spoken turn and answer as ${label}:\n\n${text}`;
    try {
      if (!isAck) {
        __pmRealtimeAgent.turn.lastUserTranscript = text;
        __pmRealtimeAgent.turn.liveUserTranscript = '';
        __pmRealtimeAgent.turn.lastAssistantTranscript = '';
        __pmRealtimeAgent.turn.nudged = false;
        __pmRealtimeAgent.turn.subagentVoiceUserLogKey = '';
        __pmRealtimeAgent.turn.subagentVoiceReplyLogKey = '';
        const target = _currentMobileSubagentVoiceTarget();
        if (target) _persistRealtimeSubagentUserTranscript(target, text, 'voice_room_realtime').catch(() => {});
      }
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      }));
      dc.send(JSON.stringify({ type: 'response.create' }));
      _voiceDebug?.('voice-room-realtime-text-sent', {
        target: _voiceRoomParticipantKey(participant),
        textLen: text.length,
        ackOnly: isAck,
        provider: conn.provider || 'openai_webrtc',
      });
      return true;
    } catch (err) {
      _voiceDebug?.('voice-room-realtime-text-failed', {
        target: _voiceRoomParticipantKey(participant),
        message: err?.message || String(err),
      });
      return false;
    }
  }

  function _voiceRoomAddressOnlyHandoffText(participant = {}) {
    const label = _voiceRoomParticipantLabel(participant);
    return [
      '[VOICE_ROOM_CONTROL]',
      `You are now the active participant in the user's private mobile Voice Room (${label}).`,
      'The user addressed you by name without a request. Briefly acknowledge that you are listening, in your own identity. Do not claim other agents spoke and do not begin work.',
    ].join('\n');
  }

  async function _appendMobileCodexVoiceRoomText(connection, text, handoffId) {
    const sessionId = String(connection?.codexBridgeSessionId || '').trim();
    const payload = String(text || '').replace(/\s+/g, ' ').trim();
    if (!sessionId || !payload || connection?.transport !== 'codex_app_server') return false;
    // One handoff may observe duplicate final transcript events on mobile.  The
    // new AVAS thread must receive its routed text exactly once.
    if (__pmRealtimeAgent?.roomHandoffInjectedId === handoffId) return true;
    const result = await mobileGatewayFetch('/api/realtime/codex-bridge/append-text', {
      method: 'POST',
      body: JSON.stringify({ sessionId, text: payload }),
    });
    if (!result?.success) throw new Error(result?.error || 'Codex Voice Room text handoff failed.');
    __pmRealtimeAgent.roomHandoffInjectedId = handoffId;
    return true;
  }

  function _silenceMobileVoiceRoomOutput() {
    const conn = __pmRealtimeAgent?.conn;
    if (_isMobileCodexV3RealtimeConnection(conn)) {
      // AVAS v3 does not support public response.cancel/output-buffer commands.
      // The handoff closes this peer; muting makes that interruption immediate.
      try { if (conn?.audio) conn.audio.muted = true; } catch {}
    } else {
      _cancelMobileRealtimeAgentResponseForDispatch?.();
    }
    _ttsStop?.();
  }

  function _armMobileVoiceRoomHandoffAckGuard(text) {
    if (!_isVoiceRoomEnabled() || !_isMobileCodexV3RealtimeConnection()) return false;
    const normalized = _voiceRoomNormalizeText(text);
    if (!/^(?:one|just a) (?:sec|second|moment)\b/.test(normalized)) return false;
    const turn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
    const conn = __pmRealtimeAgent?.conn || null;
    if (!turn.roomHandoffAckGuard) {
      turn.roomHandoffAckGuard = {
        conn,
        wasMuted: conn?.audio?.muted === true,
        armedAt: Date.now(),
      };
    }
    try { if (conn?.audio) conn.audio.muted = true; } catch {}
    _voiceDebug?.('voice-room-handoff-ack-suppressed', { text: String(text || '').slice(0, 80) });
    return true;
  }

  function _releaseMobileVoiceRoomHandoffAckGuard(reason = 'released') {
    const turn = __pmRealtimeAgent?.turn;
    const guard = turn?.roomHandoffAckGuard || null;
    if (!guard) return false;
    turn.roomHandoffAckGuard = null;
    const conn = __pmRealtimeAgent?.conn || null;
    if (conn && conn === guard.conn && !__pmRealtimeAgent?.quiet?.active) {
      try { if (conn.audio) conn.audio.muted = guard.wasMuted === true; } catch {}
    }
    _voiceDebug?.('voice-room-handoff-ack-guard-released', { reason });
    return true;
  }

  function _mobileVoiceRoomWarmPool() {
    if (!(__pmRealtimeAgent.roomWarmConnections instanceof Map)) {
      __pmRealtimeAgent.roomWarmConnections = new Map();
    }
    return __pmRealtimeAgent.roomWarmConnections;
  }

  function _mobileVoiceRoomParticipantSessionId(participant = {}) {
    if (String(participant?.kind || '') === 'subagent') {
      const agentId = String(participant.agentId || participant.id || '').trim();
      return agentId ? `subagent_chat_${agentId}` : '';
    }
    const activeMain = String(__pmChat?.activeSessionId || '').trim();
    if (activeMain && activeMain !== MOBILE_CHAT_SESSION_ID) return activeMain;
    const current = String(__pmVoice?.targetSessionId || '').trim();
    return current && current !== MOBILE_CHAT_SESSION_ID && !current.startsWith('subagent_chat_') ? current : '';
  }

  function _isHealthyMobileVoiceRoomConnection(conn) {
    return !!(
      conn
      && conn.transport === 'codex_app_server'
      && conn.codexBridgeSessionId
      && conn.dc?.readyState === 'open'
      && !['closed', 'failed', 'disconnected'].includes(String(conn.pc?.connectionState || ''))
    );
  }

  function _mobileVoiceRoomParkedAudio(conn) {
    const current = conn?.audio;
    if (!current || current.id !== 'pm-voice-agent-realtime-audio') return current || null;
    const parked = document.createElement('audio');
    parked.autoplay = true;
    parked.playsInline = true;
    parked.muted = true;
    parked.style.display = 'none';
    parked.dataset.voiceRoomStandby = 'true';
    try {
      parked.srcObject = current.srcObject;
      current.srcObject = null;
    } catch {}
    document.body.appendChild(parked);
    conn.audio = parked;
    return parked;
  }

  async function _parkMobileCodexVoiceRoomConnection(conn, participantKey) {
    const key = String(participantKey || '').trim();
    if (!key || !_isHealthyMobileVoiceRoomConnection(conn)) return false;
    // During a warm handoff, the new target is promoted before this old peer is
    // parked.  Only stop the global poll/refresh loops if this connection is
    // still the active one; otherwise parking the old peer would briefly tear
    // down the freshly-promoted participant and add avoidable switch latency.
    const wasActiveConnection = __pmRealtimeAgent.conn === conn;
    if (wasActiveConnection) {
      _stopMobileCodexBridgeRealtimeEventPoll();
      _stopMobileRealtimeAgentContextRefreshLoop();
      __pmRealtimeAgent.conn = null;
    }
    conn.roomActive = false;
    conn.roomParticipantKey = key;
    const audio = _mobileVoiceRoomParkedAudio(conn);
    try { if (audio) audio.muted = true; } catch {}
    const sender = conn.roomMicSender
      || conn.pc?.getSenders?.().find((candidate) => candidate?.track?.kind === 'audio')
      || null;
    conn.roomMicSender = sender;
    try {
      if (conn.roomMicClone) conn.roomMicClone.enabled = false;
      else if (sender) await sender.replaceTrack(null);
    } catch {}
    const pool = _mobileVoiceRoomWarmPool();
    const previous = pool.get(key);
    if (previous && previous !== conn) _closeMobileCodexVoiceRoomConnection(previous, 'replaced');
    const standbyLimit = Math.max(1, PM_VOICE_ROOM_WARM_MAX - 1);
    while (!pool.has(key) && pool.size >= standbyLimit) {
      const oldestKey = pool.keys().next().value;
      const oldest = pool.get(oldestKey);
      pool.delete(oldestKey);
      _closeMobileCodexVoiceRoomConnection(oldest, 'warm_pool_lru');
    }
    pool.set(key, conn);
    _voiceDebug?.('voice-room-warm-parked', { target: key, sessionId: conn.sessionId || '' });
    return true;
  }

  async function _promoteMobileCodexVoiceRoomConnection(conn, participant, listenMode = 'always_listening') {
    if (!_isHealthyMobileVoiceRoomConnection(conn)) return false;
    const key = _voiceRoomParticipantKey(participant);
    _mobileVoiceRoomWarmPool().delete(key);
    conn.roomActive = true;
    conn.roomParticipantKey = key;
    conn.listenMode = listenMode;
    __pmRealtimeAgent.conn = conn;
    __pmRealtimeAgent.listenMode = listenMode;
    const sender = conn.roomMicSender
      || conn.pc?.getSenders?.().find((candidate) => candidate?.track?.kind === 'audio')
      || null;
    conn.roomMicSender = sender;
    try {
      if (conn.roomMicClone) {
        conn.roomMicClone.enabled = listenMode === 'always_listening';
        if (sender?.track !== conn.roomMicClone) await sender?.replaceTrack?.(conn.roomMicClone);
      } else if (sender && !sender.track && conn.micTrack) {
        await sender.replaceTrack(conn.micTrack);
      }
    } catch (err) {
      _voiceDebug?.('voice-room-warm-mic-promote-failed', { target: key, message: err?.message || String(err) });
      return false;
    }
    try {
      if (conn.audio) {
        conn.audio.muted = false;
        await conn.audio.play?.().catch?.(() => {});
      }
    } catch {}
    _startMobileCodexBridgeRealtimeEventPoll(conn);
    _startMobileRealtimeAgentContextRefreshLoop(conn);
    _setMobileRealtimeAgentMicEnabled(listenMode === 'always_listening');
    _voiceDebug?.('voice-room-warm-promoted', { target: key, sessionId: conn.sessionId || '' });
    return true;
  }

  function _closeMobileCodexVoiceRoomConnection(conn, reason = 'cleanup') {
    if (!conn) return;
    if (__pmRealtimeAgent?.conn === conn) {
      _stopMobileCodexBridgeRealtimeEventPoll();
      _stopMobileRealtimeAgentContextRefreshLoop();
      __pmRealtimeAgent.conn = null;
    }
    conn.roomActive = false;
    try { if (conn.audio) conn.audio.muted = true; } catch {}
    if (conn.codexBridgeSessionId) {
      mobileGatewayFetch('/api/realtime/codex-bridge/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: conn.codexBridgeSessionId }),
      }).catch(() => {});
    }
    try { conn.dc?.close?.(); } catch {}
    try { conn.pc?.close?.(); } catch {}
    try { conn.roomMicClone?.stop?.(); } catch {}
    try {
      if (conn.audio?.dataset?.voiceRoomStandby === 'true') conn.audio.remove();
      else if (conn.audio) conn.audio.srcObject = null;
    } catch {}
    _voiceDebug?.('voice-room-warm-closed', {
      target: conn.roomParticipantKey || '',
      sessionId: conn.sessionId || '',
      reason,
    });
  }

  function _clearMobileCodexVoiceRoomWarmPool(reason = 'cleanup') {
    __pmRealtimeAgent.roomWarmGeneration = Number(__pmRealtimeAgent.roomWarmGeneration || 0) + 1;
    const pool = _mobileVoiceRoomWarmPool();
    for (const conn of pool.values()) _closeMobileCodexVoiceRoomConnection(conn, reason);
    pool.clear();
    if (__pmRealtimeAgent.roomWarmPromises instanceof Map) __pmRealtimeAgent.roomWarmPromises.clear();
  }

  function _scheduleMobileCodexVoiceRoomPrewarm(reason = 'room_active') {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    const activeConn = __pmRealtimeAgent?.conn;
    if (!room.enabled || !_isMobileCodexV3RealtimeConnection(activeConn)) return;
    const generation = Number(__pmRealtimeAgent.roomWarmGeneration || 0) + 1;
    __pmRealtimeAgent.roomWarmGeneration = generation;
    setTimeout(async () => {
      const pool = _mobileVoiceRoomWarmPool();
      const candidates = room.participants
        .filter((participant) => _voiceRoomParticipantKey(participant) !== _voiceRoomCurrentTargetKey())
        .slice(0, Math.max(0, PM_VOICE_ROOM_WARM_MAX - 1));
      // Start every bounded standby in parallel.  A sequential warm-up made the
      // third participant wait behind the first two TLS/WebRTC negotiations,
      // which translated straight into a cold 3-5s named handoff.
      await Promise.all(candidates.map(async (participant) => {
        if (Number(__pmRealtimeAgent.roomWarmGeneration || 0) !== generation || !_isVoiceRoomEnabled()) return;
        const key = _voiceRoomParticipantKey(participant);
        if (_isHealthyMobileVoiceRoomConnection(pool.get(key))) return;
        try {
          const conn = await _startMobileCodexVoiceRoomStandbyConnection(participant);
          if (Number(__pmRealtimeAgent.roomWarmGeneration || 0) !== generation || !_isVoiceRoomEnabled()) {
            _closeMobileCodexVoiceRoomConnection(conn, 'prewarm_superseded');
            return;
          }
          const standbyLimit = Math.max(1, PM_VOICE_ROOM_WARM_MAX - 1);
          while (!pool.has(key) && pool.size >= standbyLimit) {
            const oldestKey = pool.keys().next().value;
            const oldest = pool.get(oldestKey);
            pool.delete(oldestKey);
            _closeMobileCodexVoiceRoomConnection(oldest, 'warm_pool_lru');
          }
          pool.set(key, conn);
          _voiceDebug?.('voice-room-warm-ready', { target: key, sessionId: conn.sessionId || '', reason });
        } catch (err) {
          _voiceDebug?.('voice-room-warm-failed', { target: key, reason, message: err?.message || String(err) });
        }
      }));
    }, 250);
  }

  async function _recordMobileVoiceRoomHandoffUserTranscript(originalTranscript, participant, sessionId, options = {}) {
    const transcript = String(originalTranscript || '').replace(/\s+/g, ' ').trim();
    const sid = String(sessionId || __pmVoice?.targetSessionId || '').trim();
    const targetKey = _voiceRoomParticipantKey(participant);
    if (!transcript || !sid || !targetKey) return false;
    const turn = __pmRealtimeAgent.turn || (__pmRealtimeAgent.turn = {});
    const recordKey = `${String(options.handoffId || 'room').trim()}:${targetKey}:${sid}:${_normalizeVoiceEchoText(transcript)}`;
    if (turn.roomHandoffUserTranscriptKey === recordKey) {
      _voiceDebug?.('voice-room-handoff-user-transcript-dedupe', { target: targetKey, sessionId: sid });
      return true;
    }
    turn.roomHandoffUserTranscriptKey = recordKey;
    const previousTranscript = String(turn.lastUserTranscript || '').trim();
    // A tool fallback is invoked only after the original agent already received
    // the missed routing turn. In that case the normal transcript path has
    // already persisted this user message; preserve the visible turn rather
    // than adding a duplicate when the handoff promotes the intended agent.
    const transcriptAlreadyCaptured = transcript === previousTranscript;
    if (transcript !== previousTranscript) _clearMobileRealtimeAgentQueuedFinalSummary('voice_room_handoff_user_transcript');
    const needsNewExchange = !!(turn.currentVoiceExchangeHasUser && transcript !== previousTranscript);
    _ensureMobileRealtimeExchangeId({ forceNew: needsNewExchange });
    turn.lastUserTranscript = transcript;
    turn.currentVoiceExchangeHasUser = true;
    turn.liveUserTranscript = '';
    turn.liveAssistantTranscript = '';
    turn.lastAssistantTranscript = '';
    turn.nudged = false;
    turn.currentUserTranscriptItemId = '';
    turn.currentUserSpeechStartedAt = Date.now();
    turn.subagentVoiceUserLogKey = '';
    turn.subagentVoiceReplyLogKey = '';
    _voiceShowRealtimeUserTranscript(transcript, 'Realtime transcript');
    _voiceDebug?.('voice-room-handoff-user-transcript-recorded', { target: targetKey, sessionId: sid, textLen: transcript.length });
    const subagentTarget = _currentMobileSubagentVoiceTarget();
    try {
      // The missed-routing turn may already have been written to the visible
      // main transcript before this tool runs.  A newly selected subagent still
      // needs its own worker-facing copy, though, so only suppress re-finalizing
      // the main-chat item below.
      if (subagentTarget) {
        await _persistRealtimeSubagentUserTranscript(subagentTarget, transcript, 'voice_room_codex_handoff');
      } else if (!subagentTarget && !transcriptAlreadyCaptured) {
        const staged = __pmRealtimeAgent.stagedAttachmentTurn || __pmRealtimeAgent.stagedImageTurn;
        if (staged && Array.isArray(__pmChat.threads?.[sid]) && __pmChat.threads[sid].includes(staged)) {
          staged.body = staged.body || { text: '', attachments: [] };
          staged.body.text = transcript;
          staged.content = transcript;
          staged.streaming = false;
          staged.staged = false;
          staged.time = _nowTime();
          __pmRealtimeAgent.stagedImageTurn = null;
          __pmRealtimeAgent.stagedAttachmentTurn = null;
        } else {
          _finalizeMobileRealtimeAgentChatTurn(sid, 'user', transcript);
          _ensureMobileRealtimeAgentTurnOrder(sid);
        }
        _persistMobileThreadSnapshot(sid);
        _renderRecent();
        _renderMobileChatSessionNow(sid);
        _notifyMobileChatVoiceUpdate(sid, { reason: 'voice_room_handoff_user_transcript', force: true });
      }
      _consumeMobileRealtimeAgentPendingFiles('voice_room_handoff_transcript');
    } catch (err) {
      _voiceDebug?.('voice-room-handoff-user-transcript-persist-failed', {
        target: targetKey,
        sessionId: sid,
        message: err?.message || String(err),
      });
    }
    const injectedText = String(options.injectedText || '').replace(/\s+/g, ' ').trim();
    if (injectedText) {
      turn.roomHandoffPendingEcho = {
        targetKey,
        sessionId: sid,
        text: _normalizeVoiceEchoText(injectedText),
        expiresAt: Date.now() + 12_000,
      };
    }
    return true;
  }

  function _consumeMobileVoiceRoomHandoffEcho(transcript, sessionId) {
    const pending = __pmRealtimeAgent?.turn?.roomHandoffPendingEcho;
    if (!pending) return false;
    const sid = String(sessionId || '').trim();
    const targetKey = _voiceRoomCurrentTargetKey();
    const normalized = _normalizeVoiceEchoText(transcript);
    if (Date.now() > Number(pending.expiresAt || 0)) {
      __pmRealtimeAgent.turn.roomHandoffPendingEcho = null;
      return false;
    }
    if (pending.targetKey !== targetKey || pending.sessionId !== sid || !normalized || normalized !== pending.text) return false;
    __pmRealtimeAgent.turn.roomHandoffPendingEcho = null;
    _voiceDebug?.('voice-room-handoff-injected-echo-ignored', { target: targetKey, sessionId: sid });
    return true;
  }

  async function _handoffMobileCodexVoiceRoomTarget(participant = {}, routedText = '', options = {}) {
    const previous = __pmRealtimeAgent?.conn;
    if (!_isMobileCodexV3RealtimeConnection(previous)) return false;
    const targetKey = _voiceRoomParticipantKey(participant);
    const previousTargetKey = _voiceRoomCurrentTargetKey();
    const handoffId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const label = _voiceRoomParticipantLabel(participant);
    __pmRealtimeAgent.roomHandoff = { id: handoffId, targetKey, startedAt: Date.now(), previousPc: previous?.pc || null, previousDc: previous?.dc || null };
    _voiceSetStatus?.('Switching room agent', `${label} is joining the room`);
    _voiceDebug?.('voice-room-codex-handoff-start', {
      handoffId,
      from: _voiceRoomCurrentTargetKey(),
      target: targetKey,
      textLen: String(routedText || '').length,
      addressOnly: !String(routedText || '').trim(),
    });
    try {
      // AVAS has no public response.cancel.  Muting + closing its peer and
      // stopping the bridge session is the strongest available interruption;
      // it also invalidates the old event poll before the new session starts.
      try { if (previous?.audio) previous.audio.muted = true; } catch {}
      _silenceMobileVoiceRoomOutput();
      // Remove the old participant from the microphone immediately, but do no
      // await its WebRTC parking work before promoting the warm target.  On iOS
      // that await was the dominant 3-5s gap between "Hey Nolan" and Nolan.
      previous.roomActive = false;
      try { if (previous.roomMicClone) previous.roomMicClone.enabled = false; } catch {}
      try {
        const oldSender = previous.roomMicSender
          || previous.pc?.getSenders?.().find((candidate) => candidate?.track?.kind === 'audio')
          || null;
        previous.roomMicSender = oldSender;
        if (!previous.roomMicClone && oldSender) void oldSender.replaceTrack?.(null);
      } catch {}
      if (__pmRealtimeAgent.conn === previous) __pmRealtimeAgent.conn = null;
      await _applyMobileVoiceTarget(participant, {
        restart: false,
        reason: 'voice_room_codex_handoff',
        applyLive: false,
        paint: options.paint,
      });
      const sid = String(__pmVoice?.targetSessionId || '').trim();
      const listenMode = _mobileRealtimeListenModeFromSettings(__pmVoice?.settings || {}) || 'always_listening';
      let next = _mobileVoiceRoomWarmPool().get(targetKey) || null;
      let warmPromoted = false;
      if (_isHealthyMobileVoiceRoomConnection(next)) {
        warmPromoted = await _promoteMobileCodexVoiceRoomConnection(next, participant, listenMode);
        if (!warmPromoted) {
          _mobileVoiceRoomWarmPool().delete(targetKey);
          _closeMobileCodexVoiceRoomConnection(next, 'promotion_failed');
          next = null;
        }
      } else if (next) {
        _mobileVoiceRoomWarmPool().delete(targetKey);
        _closeMobileCodexVoiceRoomConnection(next, 'stale');
        next = null;
      }
      if (!next) next = await _startMobileRealtimeAgentSession?.(sid, { listenMode });
      if (__pmRealtimeAgent?.roomHandoff?.id !== handoffId) return false;
      if (!next || next.transport !== 'codex_app_server' || !next.codexBridgeSessionId || next.dc?.readyState !== 'open') {
        throw new Error('The addressed Codex Voice session did not become ready.');
      }
      const readySessionId = String(next.sessionId || sid).trim() || sid;
      const currentTurn = String(routedText || '').trim() || _voiceRoomAddressOnlyHandoffText(participant);
      const pendingFileContext = String(routedText || '').trim()
        ? _mobileRealtimeAgentPendingFileContext()
        : '';
      const text = [
        _mobileVoiceRoomHandoffContextText(participant, currentTurn),
        pendingFileContext,
      ].filter(Boolean).join('\n\n');
      await _recordMobileVoiceRoomHandoffUserTranscript(
        String(options.originalTranscript || routedText || '').trim(),
        participant,
        readySessionId,
        { handoffId, injectedText: text },
      );
      await _appendMobileCodexVoiceRoomText(next, text, handoffId);
      if (pendingFileContext) _consumeMobileRealtimeAgentPendingFiles('voice_room_handoff');
      // The old connection can now park asynchronously.  It is already muted
      // and has no active mic clone, so this cannot leak audio into the handoff.
      _parkMobileCodexVoiceRoomConnection(previous, previousTargetKey).catch((parkError) => {
        _voiceDebug?.('voice-room-warm-park-after-promote-failed', {
          target: previousTargetKey,
          message: parkError?.message || String(parkError),
        });
        _closeMobileCodexVoiceRoomConnection(previous, 'post_promote_park_failed');
      });
      _voiceSetStatus?.(`Switched to: ${label}`, 'Always listening');
      _voiceDebug?.('voice-room-codex-handoff-ready', {
        handoffId,
        target: targetKey,
        sessionId: readySessionId,
        bridgeSessionId: String(next.codexBridgeSessionId || ''),
        addressOnly: !String(routedText || '').trim(),
        warmPromoted,
      });
      _scheduleMobileCodexVoiceRoomPrewarm(warmPromoted ? 'warm_switch' : 'cold_switch');
      return true;
    } catch (err) {
      _voiceSetStatus?.('Room handoff failed', `${label} could not join`);
      _voiceDebug?.('voice-room-codex-handoff-failed', {
        handoffId,
        target: targetKey,
        message: err?.message || String(err),
      });
      return false;
    } finally {
      if (__pmRealtimeAgent?.roomHandoff?.id === handoffId) __pmRealtimeAgent.roomHandoff = null;
    }
  }

  function _voiceRoomParticipantFromHandoffToolArgs(args = {}) {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    if (!room.enabled || room.participants.length < 2) return null;
    const requested = [args.agent_key, args.agentKey, args.target_key, args.targetKey, args.agent, args.target, args.name]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
    if (!requested) return null;
    const exact = room.participants.find((participant) => _voiceRoomParticipantKey(participant) === requested);
    if (exact) return exact;
    const normalized = _voiceRoomNormalizeText(requested);
    if (!normalized) return null;
    const matches = room.participants.filter((participant) => (
      _voiceRoomNormalizeText(_voiceRoomParticipantLabel(participant)) === normalized
      || (participant.aliases || []).some((alias) => _voiceRoomNormalizeText(alias) === normalized)
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  async function _executeMobileVoiceRoomHandoffTool(args = {}, callId = '', sessionId = '') {
    const participant = _voiceRoomParticipantFromHandoffToolArgs(args);
    if (!participant) {
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: false,
        error: 'That participant is not in the active Voice Room.',
      }), { createResponse: false });
      return false;
    }
    const targetKey = _voiceRoomParticipantKey(participant);
    const currentKey = _voiceRoomCurrentTargetKey();
    if (targetKey === currentKey) {
      _voiceRoomSetFocus(participant);
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: true,
        already_active: true,
        agent_key: targetKey,
        agent: _voiceRoomParticipantLabel(participant),
      }), { createResponse: false });
      return true;
    }
    const originalTranscript = String(
      args.user_reques
      || args.userReques
      || __pmRealtimeAgent?.turn?.lastUserTranscrip
      || __pmRealtimeAgent?.turn?.liveUserTranscrip
      || ''
    ).replace(/\s+/g, ' ').trim();
    if (!originalTranscript) {
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: false,
        error: 'The original spoken request was missing, so the room was not switched.',
      }), { createResponse: false });
      return false;
    }
    _voiceRoomSetFocus(participant);
    _silenceMobileVoiceRoomOutput();
    try {
      let switched = false;
      if (_isMobileCodexV3RealtimeConnection()) {
        switched = await _handoffMobileCodexVoiceRoomTarget(participant, originalTranscript, {
          originalTranscript,
        });
      } else {
        await _applyMobileVoiceTarget(participant, {
          restart: false,
          applyLive: false,
          reason: 'voice_room_tool_handoff',
        });
        const refreshed = await _refreshMobileRealtimeAgentRoomTarget(participant, { reason: 'voice_room_tool_handoff' });
        switched = !!refreshed;
        if (switched && _realtimeAgentDataChannelOpen()) {
          _sendMobileRealtimeRoomTextToTarget(participant, originalTranscript, { source: 'voice_room_tool_handoff' });
        }
        if (switched) _voiceSetStatus?.(`Switched to: ${_voiceRoomParticipantLabel(participant)}`, 'Always listening');
      }
      const label = _voiceRoomParticipantLabel(participant);
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({
        ok: switched,
        switched,
        agent_key: targetKey,
        agent: label,
        message: switched ? `Switched to ${label}.` : `Could not switch to ${label}.`,
      }), { createResponse: false });
      _voiceDebug?.('voice-room-tool-handoff', {
        target: targetKey,
        switched,
        sessionId: String(sessionId || '').trim(),
        transcriptLength: originalTranscript.length,
      });
      return switched;
    } catch (error) {
      const message = String(error?.message || error || 'Voice Room handoff failed.');
      _voiceDebug?.('voice-room-tool-handoff-failed', { target: targetKey, message });
      _sendMobileRealtimeAgentFunctionOutput(callId, JSON.stringify({ ok: false, error: message }), { createResponse: false });
      return false;
    }
  }

  async function _routeMobileVoiceRoomTranscript(transcript, options = {}) {
    const room = _normalizeVoiceRoomState(__pmVoice?.room || {});
    if (!room.enabled || room.participants.length < 2) return { handled: false };
    const text = String(transcript || '').replace(/\s+/g, ' ').trim();
    if (!text) return { handled: false };
    const match = _voiceRoomMatchAddress(text, room.participants);
    if (match?.ambiguous) {
      const labels = (match.candidates || []).map((candidate) => _voiceRoomParticipantLabel(candidate.participant)).filter(Boolean);
      _silenceMobileVoiceRoomOutput();
      _voiceSetStatus?.('Room listening', labels.length ? `Which agent: ${labels.join(' or ')}?` : 'Please say the agent name again');
      _voiceDebug?.('voice-room-address-ambiguous', { textLen: text.length, candidates: labels });
      return { handled: true, suppressed: true, ambiguous: true };
    }
    if (!match && _voiceRoomHasUnmatchedAddressCue(text)) {
      _silenceMobileVoiceRoomOutput();
      _voiceSetStatus?.('Room listening', 'That agent is not in this room');
      _voiceDebug?.('voice-room-address-unknown', { textLen: text.length });
      return { handled: true, suppressed: true, unknown: true };
    }
    let participant = match?.participant || null;
    let routedText = match ? String(match.remainder || '').trim() : text;
    if (!participant) {
      const active = room.participants.find((item) => item.key === room.activeKey) || room.participants[0] || null;
      if (active && Date.now() < Number(room.focusUntil || 0)) participant = active;
    }
    if (!participant) {
      _voiceDebug?.('voice-room-ignored-no-target', { textLen: text.length });
      _silenceMobileVoiceRoomOutput();
      _voiceSetStatus?.('Room listening', 'Say "Hey Prometheus" or an agent name');
      return { handled: true, suppressed: true };
    }
    const quietCommand = _voiceRoomParseQuietCommand(text, match || { participant, remainder: routedText });
    if (quietCommand?.action === 'quiet') {
      _silenceMobileVoiceRoomOutput();
      _voiceRoomSetQuiet(participant, quietCommand.phrase);
      const label = _voiceRoomParticipantLabel(participant);
      const phrase = quietCommand.phrase || label;
      _voiceSetStatus?.('Room quiet', `${label} wakes on "${phrase}"`);
      pmToast(`${label} is quiet until "${phrase}"`, 'info');
      return { handled: true, suppressed: true };
    }
    if (quietCommand?.action === 'wake') {
      _silenceMobileVoiceRoomOutput();
      _voiceRoomClearQuiet(participant);
      _voiceRoomSetFocus(participant);
      _voiceSetStatus?.('Room active', `${_voiceRoomParticipantLabel(participant)} is listening`);
      return { handled: true, suppressed: true };
    }
    const participantKey = _voiceRoomParticipantKey(participant);
    const quiet = _voiceRoomQuietState(participantKey);
    if (quiet) {
      const wake = _voiceRoomNormalizeText(quiet.wakePhrase || _voiceRoomParticipantLabel(participant));
      const heard = _voiceRoomNormalizeText(text);
      if (!wake || !heard.includes(wake)) {
        _voiceDebug?.('voice-room-target-quiet-suppressed', { target: participantKey, textLen: text.length });
        _silenceMobileVoiceRoomOutput();
        return { handled: true, suppressed: true };
      }
      _voiceRoomClearQuiet(participant);
    }
    _voiceRoomRememberTranscript('user', 'User', text, participantKey);
    routedText = String(routedText || text).trim();
    const currentKey = _voiceRoomCurrentTargetKey();
    const targetChanged = currentKey !== participantKey;
    if (match && !String(match.remainder || '').trim()) routedText = '';
    if (!routedText) {
      _voiceRoomSetFocus(participant);
      _voiceSetStatus?.('Room active', `${_voiceRoomParticipantLabel(participant)} is listening`);
      if (targetChanged) {
        _silenceMobileVoiceRoomOutput();
        if (_isMobileCodexV3RealtimeConnection()) {
          const handedOff = await _handoffMobileCodexVoiceRoomTarget(participant, '', { paint: options.paint, originalTranscript: text });
          return { handled: true, suppressed: !handedOff, realtimeRouted: handedOff, codexHandoff: true, participant };
        }
        await _applyMobileVoiceTarget(participant, { restart: false, reason: 'voice_room_address', applyLive: false, paint: options.paint });
        const refreshed = await _refreshMobileRealtimeAgentRoomTarget(participant, { reason: 'voice_room_address' });
        if (refreshed && _realtimeAgentDataChannelOpen()) {
          _sendMobileRealtimeRoomTextToTarget(participant, _voiceRoomParticipantLabel(participant), { ackOnly: true, source: 'voice_room_address' });
        } else {
          _restartMobileRealtimeAgentForSettings?.('voice_room_address_refresh_failed');
        }
      }
      return { handled: true, suppressed: true };
    }
    if (_voiceRoomSeenRecently(participant, routedText)) {
      _voiceDebug?.('voice-room-route-dedupe-ignored', { target: participantKey, textLen: routedText.length });
      _silenceMobileVoiceRoomOutput();
      return { handled: true, suppressed: true };
    }
    _voiceRoomRememberRoute(participant, routedText);
    _voiceRoomSetFocus(participant);
    if (targetChanged) {
      _silenceMobileVoiceRoomOutput();
      if (_isMobileCodexV3RealtimeConnection()) {
        const handedOff = await _handoffMobileCodexVoiceRoomTarget(participant, routedText, { paint: options.paint, originalTranscript: text });
        return { handled: true, suppressed: !handedOff, realtimeRouted: handedOff, codexHandoff: true, participant, text: routedText };
      }
      await _applyMobileVoiceTarget(participant, { restart: false, reason: 'voice_room_route', applyLive: false, paint: options.paint });
      const refreshed = await _refreshMobileRealtimeAgentRoomTarget(participant, { reason: 'voice_room_route' });
      _voiceSetStatus?.('Room routed', `${_voiceRoomParticipantLabel(participant)} is listening`);
      if (refreshed && _realtimeAgentDataChannelOpen()) {
        if (_sendMobileRealtimeRoomTextToTarget(participant, routedText, { source: 'voice_room_route' })) {
          return { handled: true, submitted: false, realtimeRouted: true, participant, text: routedText };
        }
      }
    }
    if (targetChanged || options.forceSubmit === true) {
      const submit = typeof options.submit === 'function' ? options.submit : __pmRealtimeAgent?.submitToWorker;
      if (typeof submit === 'function') {
        await submit(routedText, { source: 'voice_room_route', skipVoiceAgentHandoff: true, roomRouted: true });
        return { handled: true, submitted: true, participant, text: routedText };
      }
    }
    // File descriptors were staged into the currently-active AVAS bridge a
    // attachment time. This is now the spoken turn they belong to, so do no
    // carry them into a later unrelated request.
    _consumeMobileRealtimeAgentPendingFiles('voice_room_same_agent_turn');
    return { handled: false, participant, text: routedText, targetChanged };
  }

  function _hasMobileVoiceWarmMic() {
    const stream = __pmVoice?.warmMicStream;
    return !!(stream && stream.getAudioTracks?.().some(track => track.readyState === 'live'));
  }

  function _requestMobileVoiceMicFromGesture() {
    if (_hasMobileVoiceWarmMic()) return Promise.resolve(__pmVoice.warmMicStream);
    if (__pmVoice?.warmMicPromise) return __pmVoice.warmMicPromise;
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error('Microphone capture is not available in this browser.'));
    }
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
      __pmVoice.warmMicPromise = null;
      throw err;
    });
    __pmVoice.warmMicPromise = promise;
    return promise;
  }

  function _voiceSetStatus(s, hint) {
    if (
      __pmVoice?.settings?.listenMode === 'always_listening'
      && __pmVoice?.settings?.wakeGateActive === true
      && _cleanMobileWakePhrase(__pmVoice?.settings?.wakePhrase || '')
      && /^(listening|ready)\b/i.test(String(s || ''))
    ) {
      const wakePhrase = _cleanMobileWakePhrase(__pmVoice.settings.wakePhrase || '');
      s = 'Quiet mode';
      hint = `Say "${wakePhrase}" to wake Prometheus`;
    }
    const statusEl = __pmVoice.statusEl || document.getElementById('pm-voice-status');
    const hintEl = __pmVoice.hintEl || document.getElementById('pm-voice-hint');
    const standaloneStage = statusEl?.closest?.('.pm-voice-body--page .pm-voice-stage');
    if (standaloneStage) {
      if (standaloneStage.classList.contains('pm-voice-final-response-pinned') && /^(speaking with|audio failed)\b/i.test(String(s || '').trim())) {
        return;
      }
      const idleStatus = /^(ready|quiet mode)$/i.test(String(s || '').trim());
      const activeStatus = !idleStatus && /\b(thinking|working|respond\w*|speaking|process\w*|execut\w*|sending|switch(?:ing|ed)?)\b/i
        .test(`${String(s || '')} ${String(hint || '')}`);
      standaloneStage.classList.remove('pm-voice-mode-intro');
      standaloneStage.classList.toggle('pm-voice-status-visible', activeStatus);
      if (!activeStatus) {
        s = '';
        hint = '';
      }
    }
    if (statusEl) statusEl.textContent = s;
    if (hint != null && hintEl) hintEl.textContent = hint;
  }

  // Realtime handlers live outside the rendered voice-panel closure. Route their
  // status updates through this module-level helper so a successful voice tool
  // cannot be marked failed merely because the panel-local `_setStatus` is ou
  // of scope.
  function _setMobileVoiceStatus(s, hint) {
    _voiceSetStatus(s, hint);
  }

  function _voiceStatusPreviewText(text, fallback = '') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return fallback;
    return clean.length > 110 ? `${clean.slice(0, 107).trim()}...` : clean;
  }

  function _voiceReadyHintGlobal() {
    const always = __pmVoice?.settings?.listenMode === 'always_listening';
    if (!always) return 'Tap and hold the mic to speak';
    const wakePhrase = _cleanMobileWakePhrase(__pmVoice?.settings?.wakePhrase || '');
    return wakePhrase && __pmVoice?.settings?.wakeGateActive === true
      ? `Quiet until "${wakePhrase}"`
      : 'Always listening while this page stays open';
  }

  function _voiceSetStatusTone(tone = '') {
    const statusEl = __pmVoice.statusEl || document.getElementById('pm-voice-status');
    const hintEl = __pmVoice.hintEl || document.getElementById('pm-voice-hint');
    [statusEl, hintEl].forEach((el) => {
      if (!el) return;
      el.classList.remove('pm-voice-live-text', 'pm-voice-agent-text');
      if (tone) el.classList.add(tone);
    });
  }

  function _voiceScrollLiveTranscriptToEnd() {
    const statusEl = __pmVoice.statusEl || document.getElementById('pm-voice-status');
    const statusRegion = statusEl?.closest?.('.pm-voice-status-region');
    const isVoiceSurface = _isMobileInlineChatVoiceActive()
      || !!statusEl?.closest?.('.pm-voice-body--page');
    if (!statusEl || !isVoiceSurface) return;
    requestAnimationFrame(() => {
      const target = statusRegion || statusEl;
      target.scrollTop = target.scrollHeight;
    });
  }

  function _isMobileInlineChatVoiceActive() {
    if (document.body?.classList.contains('pm-chat-voice-active')) return true;
    // The camera overlay hides the composer while it is open. Use the mounted
    // inline host as a second signal so camera-mode transcript deltas do not fall
    // back to the standalone voice status renderer if a route repaint briefly
    // drops the body class.
    const shell = document.getElementById('pm-chat-voice-shell');
    const host = document.getElementById('pm-chat-voice-inline');
    return !!(
      shell
      && hos
      && !shell.hidden
      && !host.hidden
      && host.dataset?.pmVoiceMounted === '1'
    );
  }

  function _mobileRealtimeCurrentStagedAttachmentTurn(sessionId = '') {
    const sid = String(sessionId || '').trim();
    const thread = __pmChat?.threads?.[sid];
    const staged = __pmRealtimeAgent.stagedAttachmentTurn || __pmRealtimeAgent.stagedImageTurn;
    if (!staged || !Array.isArray(thread) || !thread.includes(staged)) return null;
    const cameraTurnId = Number(staged?._pmCameraTurnId || 0) || 0;
    if (!cameraTurnId) return staged;
    const vision = __pmRealtimeAgent.liveCameraVision || {};
    const activeTurnId = Number(vision.turnId || 0) || 0;
    const associatedTurnId = Number(vision.lastAssociatedTurnId || 0) || 0;
    const belongsToCurrentTurn = (
      vision.active === true
      && !Number(vision.responseStartedAt || 0)
      && activeTurnId === cameraTurnId
    ) || (
      !Number(vision.responseStartedAt || 0)
      && associatedTurnId === cameraTurnId
    );
    return belongsToCurrentTurn ? staged : null;
  }

  // Inline mobile chat voice should use the normal chat transcript for the
  // user's live speech. Rendering the same text into the voice status region and
  // then finalizing it into chat creates the duplicate-looking transcript seen
  // while the orb is docked. Keep one streaming user bubble and let the final
  // transcript close that same object.
  function _renderMobileRealtimeUserTranscriptInChat(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    const sid = _mobileRealtimeAgentEffectiveSessionId(
      __pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId,
    );
    const thread = __pmChat?.threads?.[sid];
    const staged = _mobileRealtimeCurrentStagedAttachmentTurn(sid);
    const turn = staged && Array.isArray(thread) && thread.includes(staged)
      ? staged
      : _ensureMobileRealtimeAgentChatTurn(sid, 'user');
    const activeThread = __pmChat?.threads?.[sid];
    if (!turn || !Array.isArray(activeThread)) return false;
    if (staged) __pmRealtimeAgent.turn.mobileUserTurn = turn;
    turn.body = turn.body || { text: '', source: 'voice' };
    turn.body.text = clean;
    turn.body.source = turn.body.source || 'voice';
    turn.content = clean;
    turn.streaming = true;
    turn.voiceRealtimeLive = true;
    _notifyMobileChatVoiceUpdate(sid, { reason: 'realtime_user_transcript_delta', force: true });
    return true;
  }

  function _findMobileRealtimeUserDraft(sessionId, finalText = '') {
    const sid = String(sessionId || '').trim();
    const thread = __pmChat?.threads?.[sid];
    if (!sid || !Array.isArray(thread)) return null;
    const finalKey = _normalizeVoiceEchoText(finalText);
    for (let index = thread.length - 1; index >= 0; index -= 1) {
      const turn = thread[index];
      if (turn?.role !== 'user' || turn.voiceRealtimeLive !== true || turn.streaming !== true) continue;
      const draftText = String(turn.body?.text || turn.content || '').trim();
      const draftKey = _normalizeVoiceEchoText(draftText);
      const compatible = !draftKey || !finalKey
        || draftKey === finalKey
        || finalKey.startsWith(`${draftKey} `)
        || draftKey.startsWith(`${finalKey} `);
      if (compatible) return { sid, thread, turn };
    }
    return null;
  }

  function _promoteMobileRealtimeUserDraft(targetSessionId, candidateSessionIds, finalText, options = {}) {
    const clean = String(finalText || '').replace(/\s+/g, ' ').trim();
    const targetSid = String(targetSessionId || '').trim();
    if (!clean || !targetSid) return false;
    const candidates = [targetSid, ...(Array.isArray(candidateSessionIds) ? candidateSessionIds : [])]
      .map((sid) => String(sid || '').trim())
      .filter((sid, index, list) => sid && list.indexOf(sid) === index);
    let found = null;
    for (const sid of candidates) {
      found = _findMobileRealtimeUserDraft(sid, clean);
      if (found) break;
    }
    if (!found) return false;

    const targetThread = __pmChat.threads[targetSid] || (__pmChat.threads[targetSid] = []);
    if (found.thread !== targetThread) {
      const index = found.thread.indexOf(found.turn);
      if (index >= 0) found.thread.splice(index, 1);
      targetThread.push(found.turn);
    }
    const source = options.realtimeAgentChatHandoff
      ? 'realtime_agent_chat_handoff'
      : (options.realtimeAgentDispatch ? 'realtime_agent_dispatch' : 'voice');
    found.turn.body = found.turn.body || { text: '', source };
    found.turn.body.text = clean;
    found.turn.body.source = source;
    found.turn.content = clean;
    found.turn.source = source;
    found.turn.channelLabel = options.realtimeAgentChatHandoff
      ? 'Voice Agent to Worker'
      : (options.realtimeAgentDispatch ? 'Voice Agent handoff' : 'voice');
    found.turn.voiceAgentWorkerHandoff = !!(options.realtimeAgentChatHandoff || options.realtimeAgentDispatch);
    found.turn._clientRequestId = String(options.clientRequestId || '').trim() || found.turn._clientRequestId;
    found.turn.streaming = false;
    found.turn.voiceRealtimeLive = false;
    found.turn.time = _nowTime();
    found.turn.timestamp = Number(found.turn.timestamp || Date.now()) || Date.now();
    return true;
  }

  function _voiceShowRealtimeUserTranscript(text, hint = 'Realtime transcript') {
    const isChatVoice = _isMobileInlineChatVoiceActive();
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean) {
      // A transcript delta is still useful feedback when iOS has not exposed a
      // readable MediaStream to the analyser yet. Let the published orb answer
      // the same event immediately, then let the audio meter take over.
      _pulseMobileVoiceOrb(Math.min(1, .42 + Math.min(.58, clean.length / 92)));
    }
    if (isChatVoice) {
      _renderMobileRealtimeUserTranscriptInChat(clean);
      return;
    }
    _voiceSetStatus(isChatVoice ? (clean || 'Listening...') : _voiceStatusPreviewText(text, 'Listening...'), hint);
    _voiceSetStatusTone('pm-voice-live-text');
    _voiceScrollLiveTranscriptToEnd();
  }

  function _voiceRenderHighlightedStatus(text, highlight = '') {
    const statusEl = __pmVoice.statusEl || document.getElementById('pm-voice-status');
    if (!statusEl) return false;
    const clean = _voiceStatusPreviewText(text, 'Thinking...');
    const tail = String(highlight || '').replace(/\s+/g, ' ').trim();
    if (!tail || !clean || !clean.endsWith(tail)) {
      statusEl.textContent = clean;
      return true;
    }
    const head = clean.slice(0, Math.max(0, clean.length - tail.length));
    statusEl.innerHTML = `${escapeHtml(head)}<span class="pm-voice-speaking-highlight">${escapeHtml(tail)}</span>`;
    return true;
  }

  function _voiceShowRealtimeAgentMessage(text, hint = 'Realtime agent is responding', options = {}) {
    if (_isMobileInlineChatVoiceActive()) {
      _voiceSetStatus('', '');
      _voiceSetStatusTone('pm-voice-agent-text');
      return;
    }
    if (String(text || '').trim()) __pmVoice.clearToolStatus?.({ preserveDisplay: true });
    _voiceSetStatus('', hint);
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const statusEl = __pmVoice.statusEl || document.getElementById('pm-voice-status');
    // The dedicated mobile Voice page used to render a karaoke-style rolling
    // window here. That made the response jump between three lines and hid tex
    // that had already arrived. Keep the complete streamed prefix in place so i
    // matches the normal mobile/desktop chat transcript: each delta simply
    // appends to the visible message.
    if (statusEl) statusEl.textContent = clean || 'Thinking...';
    _voiceSetStatusTone('pm-voice-agent-text');
    _voiceScrollLiveTranscriptToEnd();
    const stage = document.getElementById('pm-voice-status')?.closest('.pm-voice-body--page .pm-voice-stage');
    if (stage && String(text || '').trim()) stage.classList.add('pm-voice-final-response-pinned');
  }

  function _voiceShowReadyStatus() {
    document.getElementById('pm-voice-status')
      ?.closest('.pm-voice-body--page .pm-voice-stage')
      ?.classList.remove('pm-voice-final-response-pinned');
    _voiceSetStatus('Ready', _voiceReadyHintGlobal());
    _voiceSetStatusTone('');
  }

  function _setMobileVoiceLyricProgress(text, progress, hint = 'Prometheus is responding') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    __pmVoice.lyricText = clean;
    __pmVoice.lyricProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    // Keep this compatibility hook for the audio playback clock, but do not use
    // the old rolling lyric renderer. The full response remains visible while i
    // is being spoken, just like a regular streaming chat answer.
    _voiceShowRealtimeAgentMessage(clean, hint);
  }

  function _mobileRealtimeAudioPlaybackMs(turn = null) {
    const activeTurn = turn || _mobileRealtimeActiveAssistantTurn();
    if (!activeTurn) return 0;
    const audio = __pmRealtimeAgent?.conn?.audio;
    const mediaNow = Number(audio?.currentTime);
    if (Number.isFinite(mediaNow)) {
      const previousMediaTime = Number(activeTurn.voiceRealtimeMediaLastTime);
      if (!Number.isFinite(previousMediaTime)) {
        activeTurn.voiceRealtimeMediaLastTime = mediaNow;
        activeTurn.voiceRealtimePlaybackClockPrimedAt = Date.now();
        return Number(activeTurn.voiceRealtimePlaybackMs || 0) || 0;
      }
      const rawDeltaMs = (mediaNow - previousMediaTime) * 1000;
      activeTurn.voiceRealtimeMediaLastTime = mediaNow;
      // A live WebRTC element may briefly jump its media timeline when a track is
      // attached. Never let that historical jump skip the lyric highlight ahead.
      if (rawDeltaMs > 0 && rawDeltaMs < 750) {
        activeTurn.voiceRealtimePlaybackMs = (Number(activeTurn.voiceRealtimePlaybackMs || 0) || 0) + rawDeltaMs;
        activeTurn.voiceRealtimePlaybackClockObservedAt = Date.now();
        return activeTurn.voiceRealtimePlaybackMs;
      }
      if (Number(activeTurn.voiceRealtimePlaybackMs || 0) > 0) return activeTurn.voiceRealtimePlaybackMs;
    }
    const started = Number(activeTurn?.voiceRealtimeAudioStartedAt || activeTurn?.voiceRealtimeUpdatedAt || Date.now());
    return Math.max(0, Date.now() - started);
  }

  function _mobileRealtimeRawTranscriptDelta(event = {}) {
    const candidates = [event?.delta, event?.transcript, event?.text, event?.content, event?.output_text];
    const raw = candidates.find((value) => typeof value === 'string');
    return typeof raw === 'string' ? raw.replace(/\r?\n/g, ' ') : '';
  }

  function _appendMobileRealtimeTranscriptDelta(previous = '', rawDelta = '') {
    const before = String(previous || '');
    const next = String(rawDelta || '');
    if (!next) return before;
    if (!before) return next.trimStart();
    if (/^\s/.test(next) || /\s$/.test(before) || /^[,.;:!?%)\]}]/.test(next)) return `${before}${next}`;
    // The event helper intentionally trims display text; preserve the boundary
    // here so word-level Realtime deltas do not render as "Doyouhave...".
    return `${before} ${next}`;
  }

  function _mergeMobileRealtimeTranscriptSnapshot(turn, snapshot = '') {
    const next = String(snapshot || '').replace(/\s+/g, ' ').trim();
    if (!next) return String(turn?.liveUserTranscript || '').trim();
    const prefix = String(turn?.currentUserTranscriptPrefix || '').replace(/\s+/g, ' ').trim();
    if (!prefix) {
      if (turn) turn.currentUserTranscriptSegment = '';
      return next;
    }
    const prefixKey = _normalizeVoiceEchoText(prefix);
    const nextKey = _normalizeVoiceEchoText(next);
    if (nextKey === prefixKey || nextKey.startsWith(`${prefixKey} `)) {
      if (turn) turn.currentUserTranscriptSegment = next.slice(prefix.length).trim();
      return next;
    }
    const previousSegment = String(turn?.currentUserTranscriptSegment || '').replace(/\s+/g, ' ').trim();
    let segment = next;
    if (previousSegment && _isProgressiveMobileRealtimeTranscript(previousSegment, next)) segment = next;
    else if (previousSegment && _isProgressiveMobileRealtimeTranscript(next, previousSegment)) segment = previousSegment;
    if (turn) turn.currentUserTranscriptSegment = segment;
    return _appendMobileRealtimeTranscriptDelta(prefix, segment);
  }

  function _setMobileVoicePlaybackLyricProgress(localProgress) {
    const playback = __pmVoice.lyricPlayback || null;
    const local = Math.max(0, Math.min(1, Number(localProgress) || 0));
    if (playback?.text) {
      const start = Math.max(0, Math.min(1, Number(playback.start || 0) || 0));
      const end = Math.max(start, Math.min(1, Number(playback.end || 1) || 1));
      _setMobileVoiceLyricProgress(playback.text, start + ((end - start) * local));
      return;
    }
    const text = String(__pmVoice.currentSpokenSegment || __pmVoice.lyricText || '').trim();
    if (text) _setMobileVoiceLyricProgress(text, local);
  }

  function _mobileVoiceToolKey(payload = {}, fallback = '') {
    const source = payload && typeof payload === 'object' ? payload : {};
    const candidates = [
      source.call_id,
      source.callId,
      source.tool_call_id,
      source.toolCallId,
      source.tool_call?.id,
      source.name,
      source.tool,
      source.action,
      source.id,
      fallback,
    ];
    return String(candidates.find((value) => value != null && String(value).trim()) || '').trim();
  }

  function _mobileVoiceToolsAreActive() {
    return __pmVoice?.activeVoiceToolCalls instanceof Set && __pmVoice.activeVoiceToolCalls.size > 0;
  }

  function _setMobileVoiceToolActive(active, key = '', payload = {}) {
    const calls = __pmVoice.activeVoiceToolCalls instanceof Se
      ? __pmVoice.activeVoiceToolCalls
      : (__pmVoice.activeVoiceToolCalls = new Set());
    const normalized = _mobileVoiceToolKey(payload, key);
    if (active) {
      calls.add(normalized || `voice_tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    } else if (normalized) {
      calls.delete(normalized);
    } else {
      calls.clear();
    }
    if (_mobileVoiceToolsAreActive()) _setOrbState('solving');
    else if (__pmVoice?.listening) _setOrbState('listening');
    else _setOrbState(null);
    return calls.size;
  }

  function _pulseMobileVoiceOrb(level = 0.8) {
    const next = Math.max(0, Math.min(1, Number(level) || 0));
    if (!next) return;
    __pmVoice.thinkingOrbAudioPulse = Math.max(
      Number(__pmVoice.thinkingOrbAudioPulse || 0) || 0,
      next,
    );
  }

  function _setOrbState(state) {
    const orbController = __pmVoice?.thinkingOrbController;
    const requestedState = _mobileVoiceToolsAreActive() ? 'solving' : state;
    const visualState = requestedState === 'listening' ? 'listening' : requestedState === 'solving' ? 'solving' : 'thinking';
    orbController?.setState(visualState);
    const orbEl = document.getElementById('pm-voice-orb');
    if (!orbEl) return;
    orbEl.classList.remove('listening', 'thinking', 'speaking', 'confirmed');
    if (requestedState) orbEl.classList.add(requestedState);
  }

  function _mobileMediaKey(media) {
    if (!media) return '';
    return String(media.dataUrl || media.path || media.name || '').trim();
  }

  function _diffMobileMedia(before, after) {
    const seen = new Set((Array.isArray(before) ? before : []).map(_mobileMediaKey).filter(Boolean));
    return (Array.isArray(after) ? after : []).filter((media) => {
      const key = _mobileMediaKey(media);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function _visionEventToMobileMedia(evt = {}) {
    const source = String(evt?.source || '').toLowerCase();
    if (!['desktop', 'browser'].includes(source)) return null;
    const preview = evt.preview && typeof evt.preview === 'object' ? evt.preview : {};
    const dataUrl = String(preview.dataUrl || evt.dataUrl || '').trim();
    if (!dataUrl) return null;
    const dimensions = preview.width && preview.height ? ` ${preview.width}x${preview.height}` : '';
    const label = source === 'desktop' ? 'Desktop screenshot' : 'Browser screenshot';
    return _normalizeMobileMedia({
      kind: 'image',
      name: `${label}${dimensions}.png`,
      dataUrl,
      mimeType: preview.mimeType || 'image/png',
    });
  }

  function _flashVoiceOrbConfirmed(durationMs = 2200) {
    _setOrbState('confirmed');
    const token = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    __pmVoice.confirmedOrbToken = token;
    setTimeout(() => {
      if (__pmVoice.confirmedOrbToken === token) _setOrbState(null);
    }, Math.max(800, Number(durationMs) || 2200));
  }

  function _installMobileCameraPinchZoom(root, video, getTrack) {
    if (!root || !video) return null;
    let track = null;
    let hasHardwareZoom = false;
    let minZoom = 1;
    let maxZoom = 1;
    let zoom = 1;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;
    let applying = false;
    let queuedZoom = null;

    const clampZoom = (value) => Math.max(minZoom, Math.min(maxZoom, Number(value) || 1));
    const touchDistance = (touches) => {
      const first = touches?.[0];
      const second = touches?.[1];
      if (!first || !second) return 0;
      return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    };
    const applyZoom = async (value) => {
      zoom = clampZoom(value);
      video.style.transform = hasHardwareZoom ? '' : `scale(${zoom})`;
      if (!hasHardwareZoom || !track?.applyConstraints) return;
      queuedZoom = zoom;
      if (applying) return;
      applying = true;
      try {
        while (queuedZoom != null) {
          const next = queuedZoom;
          queuedZoom = null;
          try { await track.applyConstraints({ advanced: [{ zoom: next }] }); } catch {}
        }
      } finally {
        applying = false;
      }
    };
    const setTrack = (nextTrack) => {
      track = nextTrack || null;
      const capabilities = track?.getCapabilities?.() || {};
      minZoom = Number(capabilities.zoom?.min || 1) || 1;
      maxZoom = Math.max(minZoom, Number(capabilities.zoom?.max || minZoom) || minZoom);
      hasHardwareZoom = maxZoom > minZoom && typeof track?.applyConstraints === 'function';
      zoom = clampZoom(Number(track?.getSettings?.().zoom || minZoom) || minZoom);
      video.style.transform = hasHardwareZoom ? '' : `scale(${zoom})`;
    };
    const reset = () => {
      pinchStartDistance = 0;
      pinchStartZoom = zoom;
      zoom = clampZoom(minZoom);
      queuedZoom = null;
      video.style.transform = hasHardwareZoom ? '' : `scale(${zoom})`;
    };
    const onTouchStart = (event) => {
      if (event.touches?.length !== 2) return;
      pinchStartDistance = touchDistance(event.touches);
      pinchStartZoom = zoom;
      event.preventDefault();
    };
    const onTouchMove = (event) => {
      if (event.touches?.length !== 2 || !pinchStartDistance) return;
      const distance = touchDistance(event.touches);
      if (!distance) return;
      event.preventDefault();
      void applyZoom(pinchStartZoom * (distance / pinchStartDistance));
    };
    const onTouchEnd = () => { pinchStartDistance = 0; };
    root.addEventListener('touchstart', onTouchStart, { passive: false });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return {
      setTrack,
      reset,
      getZoom: () => zoom,
      hasHardwareZoom: () => hasHardwareZoom,
      destroy: () => {
        root.removeEventListener('touchstart', onTouchStart);
        root.removeEventListener('touchmove', onTouchMove);
        root.removeEventListener('touchend', onTouchEnd);
        root.removeEventListener('touchcancel', onTouchEnd);
        video.style.transform = '';
      },
    };
  }

  function _detectProvider(status) {
    const realtime = status?.realtime || {};
    const configuredTts = (status?.voice?.ttsProviders || []).filter(p => p?.configured);
    const configuredStt = (status?.voice?.sttProviders || []).filter(p => p?.configured && p?.id !== 'browser');
    const settings = __pmVoice.settings || {};
    const inputProvider = String(settings.sttProvider || _inputProviderForMode(settings.voiceMode || 'default'));
    const outputProvider = String(settings.ttsProvider || _outputProviderForMode(settings.voiceMode || 'default'));
    const realtimeReady = !!(realtime?.configured && (realtime?.oauthConfigured || realtime?.apiKeyConfigured));
    const xaiTtsReady = configuredTts.some(p => p?.id === 'xai');
    const xaiSttReady = configuredStt.some(p => p?.id === 'xai');
    const sttReady = inputProvider === 'openai_realtime' ? realtimeReady : inputProvider === 'xai' ? xaiSttReady : true;
    const ttsReady = outputProvider === 'openai_realtime' ? realtimeReady : outputProvider === 'xai' ? xaiTtsReady : true;
    const sttProvider = sttReady ? inputProvider : 'browser';
    const ttsProvider = ttsReady ? outputProvider : 'browser';
    if (sttProvider !== 'browser' || ttsProvider !== 'browser') return {
      id: _voicePresetForProviders(sttProvider, ttsProvider),
      label: [sttProvider, ttsProvider].filter(Boolean).join(' input / ') || 'Voice',
      model: realtime.model || 'gpt-realtime',
      voice: settings.realtimeVoice || realtime.voice || 'marin',
      speed: ttsProvider === 'xai' ? Number(settings.xaiSpeed || 1.0) : Number(settings.realtimeSpeed || 1.05),
      canRealtime: sttProvider === 'openai_realtime' || ttsProvider === 'openai_realtime',
      sttProvider,
      ttsProvider,
      ttsVoice: ttsProvider === 'xai' ? (settings.serverVoice || 'eve') : (settings.realtimeVoice || realtime.voice || 'marin'),
    };
    return {
      id: 'browser',
      label: 'Default',
      canRealtime: false,
      sttProvider: 'browser',
      ttsProvider: 'browser',
      requestedMode: settings.voiceMode || 'default',
    };
  }

  function _serverVoiceFallback(provider) {
    return SERVER_VOICE_FALLBACKS[String(provider || '').trim()] || [];
  }

  function _isRealtimeConnected(status = __pmVoice.lastVoiceStatus) {
    const realtime = status?.realtime || {};
    return !!(realtime?.configured && (realtime?.oauthConfigured || realtime?.apiKeyConfigured));
  }

  async function _loadServerVoiceCatalog(provider) {
    const id = String(provider || '').trim();
    if (!id) return [];
    if (__pmVoice.voiceCatalog?.[id]) return __pmVoice.voiceCatalog[id];
    const advertised = __pmVoice.lastVoiceStatus?.voice?.voiceCatalogs?.[id];
    const voices = Array.isArray(advertised) && advertised.length
      ? advertised.map((voice) => {
        if (typeof voice === 'string') return { id: voice, label: voice[0].toUpperCase() + voice.slice(1) };
        const voiceId = String(voice?.id || voice?.voice_id || '').trim();
        return voiceId ? { id: voiceId, label: String(voice?.label || voice?.name || voiceId) } : null;
      }).filter(Boolean)
      : _serverVoiceFallback(id);
    __pmVoice.voiceCatalog = { ...(__pmVoice.voiceCatalog || {}), [id]: voices };
    return voices;
  }

  function _voiceProviderSummary() {
    const p = __pmVoice.provider || {};
    return `stt=${p.sttProvider || 'unknown'}; audio=${p.ttsProvider || 'unknown'}; realtime=${p.canRealtime ? 'yes' : 'no'}`;
  }

  function _cleanVoiceSpeechText(text) {
    const value = String(text || '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/(^|\s)[!?.,;:()[\]{}"'`~@#$%^&*_+=|\\/<>-]+(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return /[A-Za-z0-9]/.test(value) ? value : '';
  }

  function _normalizeVoiceEchoText(text) {
    const value = _cleanVoiceSpeechText(text).toLowerCase();
    return value
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _isLikelyMobileVoiceSelfEcho(text, options = {}) {
    const candidate = _normalizeVoiceEchoText(text);
    if (!candidate || candidate.length < 3) return false;
    const now = Date.now();
    const recentlySpeaking = !!(
      __pmVoice.speaking
      || __pmVoice.realtimeSpeechActiveResponse
      || (Number(__pmVoice.speakingEndedAt || 0) && now - Number(__pmVoice.speakingEndedAt || 0) < 8500)
    );
    const spokenCandidates = [
      __pmVoice.currentSpokenSegment,
      __pmVoice.lastAi,
      __pmVoice.subagentLastSpokenReply?.text,
      __pmVoice.recentSpokenText,
    ].map(_normalizeVoiceEchoText).filter(Boolean);
    if (!recentlySpeaking && !spokenCandidates.length) return false;
    return spokenCandidates.some((spoken) => {
      if (spoken === candidate) return true;
      if (candidate.length >= 8 && spoken.includes(candidate)) return true;
      if (options.allowPartial && candidate.length >= 8 && spoken.startsWith(candidate)) return true;
      const words = candidate.split(' ').filter((word) => word.length > 1);
      if (words.length < 3) return false;
      const spokenWords = new Set(spoken.split(' ').filter(Boolean));
      const overlap = words.filter((word) => spokenWords.has(word)).length / words.length;
      return overlap >= 0.82 && spoken.length >= candidate.length;
    });
  }

  function _voiceSpokenMilestone(text) {
    const value = _cleanVoiceSpeechText(text);
    if (!value) return '';
    const normalized = value.toLowerCase().replace(/[^\w\s.-]/g, '').trim();
    if (!normalized || /^(thinking|thinking\.{0,3}|responding|responding\.{0,3}|complete|done|processing|working)$/i.test(normalized)) {
      return '';
    }
    // Keep internal startup/preflight labels visible in the process feed, but never
    // speak them aloud in mobile milestone mode. These are implementation details,
    // not useful voice progress updates.
    if (/^(request received|preparing|building|classifying|compacting|saving important memory|checking paused task follow-up)\b/i.test(normalized)) {
      return '';
    }
    if (!/\b(running|searching|reading|using|calling|preparing|opening|fetching|loading|creating|writing|updating|checking|connecting)\b/i.test(value)) {
      return '';
    }
    return value
      .replace(/\b(tool|api|http|json|sql)\b/gi, x => x.toUpperCase())
      .slice(0, 140);
  }

  function _speakVoiceMilestone(text, options = {}) {
    const spoken = _cleanVoiceSpeechText(text);
    if (!spoken || __pmVoice.dictation !== 'milestone') return;
    __pmVoice.lastVoiceMilestone = spoken.slice(0, 500);
    const now = Date.now();
    const recent = __pmVoice.milestoneRecent instanceof Map ? __pmVoice.milestoneRecent : new Map();
    for (const [key, at] of recent.entries()) {
      if (!at || now - at > 45000) recent.delete(key);
    }
    const key = spoken.toLowerCase();
    if (recent.has(key)) return;
    __pmVoice.milestoneRecent = recent;
    const minGap = Math.max(0, Number(options.minGapMs ?? 2800) || 0);
    const waitForQuiet = () => new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!__pmVoice.speaking || Date.now() - started > 5500) return resolve();
        setTimeout(tick, 180);
      };
      tick();
    });
    __pmVoice.milestoneChain = (__pmVoice.milestoneChain || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (__pmVoice.dictation !== 'milestone') return;
        await waitForQuiet();
        if (__pmVoice.dictation !== 'milestone' || __pmVoice.speaking) return;
        if (minGap) await new Promise((resolve) => setTimeout(resolve, minGap));
        if (__pmVoice.dictation !== 'milestone' || __pmVoice.speaking) return;
        recent.set(key, Date.now());
        __pmVoice.milestoneRecent = recent;
        await _ttsSpeak(spoken);
      })
      .catch((err) => console.warn('[voice] milestone narration failed', err));
  }

  function _voiceToolTargetLabel(args = {}) {
    const raw = String(
      args.path || args.file || args.filename || args.url || args.command || args.query || args.target || ''
    ).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
      try { return new URL(raw).hostname.replace(/^www\./i, ''); } catch {}
    }
    const last = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    return las
      .replace(/\.[a-z0-9]{1,6}$/i, (ext) => ext.replace('.', ' dot '))
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function _voiceLiveToolStatus(evt = {}, phase = 'start') {
    const action = String(evt?.action || evt?.toolName || evt?.name || evt?.type || '').trim();
    const actionKey = action.toLowerCase().replace(/[\s-]+/g, '_');
    const args = (evt?.args || evt?.params || evt?.input || evt?.toolArgs || {});
    const target = args && typeof args === 'object' ? _voiceToolTargetLabel(args) : '';
    const progress = _voiceSpokenMilestone(evt?.message || evt?.summary || '');
    if (phase === 'progress' && progress) return progress;
    if (/browser.*open|open.*browser/.test(actionKey)) return 'Opening the browser';
    if (/browser.*(screenshot|observe|snapshot|inspect|view)|vision/.test(actionKey)) return 'Looking at the browser';
    if (/browser.*click|click.*browser/.test(actionKey)) return 'Clicking in the browser';
    if (/browser.*(type|press|key|input)|(?:type|press|key).*browser/.test(actionKey)) return 'Typing in the browser';
    if (/desktop.*(screenshot|observe|snapshot|inspect)|computer/.test(actionKey)) return 'Looking at the desktop';
    if (/run_command|terminal|shell|powershell|cmd/.test(actionKey)) return 'Running a terminal command';
    if (/search|grep|rg|find/.test(actionKey)) return target ? `Searching ${target}` : 'Searching the files';
    if (/read|fetch|get_content|open_file|fetch_file|cat/.test(actionKey)) return target ? `Reading ${target}` : 'Reading files';
    if (/write|edit|patch|apply|update|create_file|delete_file|replace|insert/.test(actionKey)) return 'Preparing file edits';
    if (/web|http|url|fetch/.test(actionKey)) return target ? `Opening ${target}` : 'Opening the web';
    const label = _mobileToolLabel(evt);
    return label && label !== 'Working' ? `Using ${label}` : '';
  }

  function _speakVoiceLiveStatus(text, options = {}) {
    const spoken = _cleanVoiceSpeechText(text);
    if (!spoken || __pmVoice.dictation !== 'milestone') return;
    const now = Date.now();
    const recent = __pmVoice.milestoneRecent instanceof Map ? __pmVoice.milestoneRecent : new Map();
    for (const [key, at] of recent.entries()) {
      if (!at || now - at > 45000) recent.delete(key);
    }
    const key = `live:${spoken.toLowerCase()}`;
    if (recent.has(key)) return;
    __pmVoice.milestoneRecent = recent;
    const force = options.force === true;
    const minGap = Math.max(0, Number(options.minGapMs ?? 900) || 0);
    const staleMs = Math.max(800, Number(options.staleMs ?? 4200) || 4200);
    const speak = async (candidate, candidateKey) => {
      const clean = _cleanVoiceSpeechText(candidate);
      if (!clean || __pmVoice.dictation !== 'milestone') return;
      recent.set(candidateKey, Date.now());
      __pmVoice.milestoneRecent = recent;
      __pmVoice.lastVoiceMilestone = clean.slice(0, 500);
      __pmVoice.lastLiveMilestoneAt = Date.now();
      await _ttsSpeak(clean);
    };
    if (force) {
      __pmVoice.pendingLiveMilestone = null;
      if (options.interrupt !== false) _ttsStop();
      speak(spoken, key).catch((err) => console.warn('[voice] live narration failed', err));
      return;
    }
    const lastAt = Number(__pmVoice.lastLiveMilestoneAt || 0);
    if (!__pmVoice.speaking && now - lastAt >= minGap) {
      speak(spoken, key).catch((err) => console.warn('[voice] live narration failed', err));
      return;
    }
    __pmVoice.pendingLiveMilestone = { text: spoken, key, at: now, staleMs, minGap };
    if (__pmVoice.liveMilestoneTimer) clearTimeout(__pmVoice.liveMilestoneTimer);
    const flush = () => {
      const pending = __pmVoice.pendingLiveMilestone;
      if (!pending) return;
      const age = Date.now() - Number(pending.at || 0);
      if (age > Number(pending.staleMs || staleMs)) {
        __pmVoice.pendingLiveMilestone = null;
        return;
      }
      if (__pmVoice.speaking || Date.now() - Number(__pmVoice.lastLiveMilestoneAt || 0) < Number(pending.minGap || minGap)) {
        __pmVoice.liveMilestoneTimer = setTimeout(flush, 320);
        return;
      }
      __pmVoice.pendingLiveMilestone = null;
      speak(pending.text, pending.key).catch((err) => console.warn('[voice] live narration failed', err));
    };
    __pmVoice.liveMilestoneTimer = setTimeout(flush, Math.min(600, Math.max(120, minGap)));
  }

  async function _appendMobileCodexBridgeRealtimeSpeech(connection, text) {
    const sessionId = String(connection?.codexBridgeSessionId || '').trim();
    const speakable = _cleanVoiceSpeechText(text);
    if (connection?.transport !== 'codex_app_server' || !sessionId || !speakable) return false;
    const data = await mobileGatewayFetch('/api/realtime/codex-bridge/speak', {
      method: 'POST',
      body: JSON.stringify({ sessionId, text: speakable }),
    });
    if (data?.success === false) throw new Error(data?.error || 'Codex realtime speech append failed.');
    return true;
  }

  async function _speakMobileRealtimeAgentMilestone(text, options = {}) {
    const spoken = _cleanVoiceSpeechText(text);
    if (!spoken || __pmVoice.dictation !== 'milestone') return;
    if (_voiceWorkerOutputBusy()) {
      setTimeout(() => _speakMobileRealtimeAgentMilestone(spoken, { ...options, force: true }), 750);
      return;
    }
    const connection = __pmRealtimeAgent?.conn;
    const dc = connection?.dc;
    if (!dc || dc.readyState !== 'open') return;
    const now = Date.now();
    const recent = __pmVoice.milestoneRecent instanceof Map ? __pmVoice.milestoneRecent : new Map();
    for (const [key, at] of recent.entries()) {
      if (!at || now - at > 45000) recent.delete(key);
    }
    const key = `realtime:${spoken.toLowerCase()}`;
    if (recent.has(key)) return;
    const minGap = Math.max(0, Number(options.minGapMs ?? 20000) || 0);
    if (options.force !== true && now - Number(__pmVoice.lastMilestoneRealtimeAt || 0) < minGap) return;
    recent.set(key, now);
    __pmVoice.milestoneRecent = recent;
    __pmVoice.lastMilestoneRealtimeAt = now;
    __pmVoice.lastVoiceMilestone = spoken.slice(0, 500);
    try {
      if (await _appendMobileCodexBridgeRealtimeSpeech(connection, spoken)) return;
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: [
              '[WORKER_MILESTONE]',
              `Current worker update: ${spoken}`,
              'Say a short natural progress update only if the user benefits from hearing it.',
              'Do not start new work. Do not repeat the original acknowledgement.',
              '[/WORKER_MILESTONE]',
            ].join('\n'),
          }],
        },
      }));
      if (!sent) return false;
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: 'You are Prometheus in realtime voice mode. If useful, speak one concise progress update based on the worker milestone. Otherwise say nothing. Speak only normal words and numbers; never vocalize punctuation marks, symbols, emoji, markdown, bullets, or standalone characters.',
        },
      }));
    } catch (err) {
      _voiceDebug('realtime-agent-milestone-forward-failed', { message: err?.message || String(err) });
    }
  }

  function _isMobileVoiceStatusQuestion(text) {
    const value = String(text || '').toLowerCase();
    return /\b(what are you doing|what're you doing|what is happening|what's happening|status|where are we|where are you|what step|what stage|what did you do|what have you done|what do you see|what are you seeing|what's on screen|what is on screen)\b/.test(value);
  }

  function _hasMobileVoiceWorkIntent(text) {
    const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!value) return false;
    if (/\b(run|start|stop|restart|open|close|click|tap|scroll|search|find|look up|check|inspect|analyze|summarize|write|draft|create|make|build|fix|update|change|edit|delete|remove|send|post|schedule|monitor|test|smoke test|deploy|install|fetch|download|upload|attach|read|review|compare|debug|tell the worker|ask the worker|handoff|hand off|go ahead|proceed|continue|keep going|do it|kick it off)\b/.test(value)) return true;
    if (/\b(can you|could you|please|i need you to|i want you to|let'?s)\b.*\b(do|run|check|look|make|create|fix|send|post|open|search|find|test|review|analyze|summarize)\b/.test(value)) return true;
    return false;
  }

  function _isMobileVoiceDirectAnswerOnlyTurn(text) {
    const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!value) return false;
    if (_hasMobileVoiceWorkIntent(value)) return false;
    if (_isMobileVoiceStatusQuestion(value)) return true;
    return /\b(who are you|what are you|which agent are you|what agent are you|are you prometheus|are you a subagent|what do you do|what is your role|what's your role|what are you for|tell me about yourself|introduce yourself|how are you|how'?s it going|what'?s up|you there|can you hear me|testing|test voice|thanks|thank you|appreciate it|cool|alright|all right|okay|ok|got it|sounds good|perfect|nice|great|good to know|glad|nevermind|never mind)\b/.test(value);
  }

  function _isSubagentVoiceDirectAnswerOnlyTurn(text) {
    return _isMobileVoiceDirectAnswerOnlyTurn(text);
  }

  function _isBenignRealtimeCancelError(data) {
    const message = String(data?.error?.message || data?.error || data?.message || '').toLowerCase();
    return /cancell?ation failed|no active response|response not found|active response in progress|conversation already has an active response/.test(message);
  }

  function _isNoActiveRealtimeCancelError(data) {
    const message = String(data?.error?.message || data?.error || data?.message || '').toLowerCase();
    return /\bno active response\b|cancell?ation failed:\s*no active response|response not found/.test(message);
  }

  function _isBenignRealtimeParseError(value) {
    const message = String(value?.error?.message || value?.error || value?.message || value || '').toLowerCase();
    return /message failed to parse|failed to parse offer|unmarshal sdp|parse offer|sdp:eof|sdp error/.test(message);
  }

  function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read audio'));
      reader.readAsDataURL(blob);
    });
  }

  function _isIosSafariBrowser() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    return isIOS || isSafari;
  }

  function _getRecorderMimeType(provider = '') {
    const wantsXai = String(provider || '').toLowerCase() === 'xai';
    const preferMp4 = wantsXai || _isIosSafariBrowser();
    const candidates = preferMp4
      ? ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  function _audioExtensionForMimeType(mimeType) {
    const value = String(mimeType || '').toLowerCase();
    if (value.includes('mp4') || value.includes('m4a') || value.includes('aac')) return 'm4a';
    if (value.includes('ogg')) return 'ogg';
    if (value.includes('wav')) return 'wav';
    if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
    return 'webm';
  }

  function _gatewayJsonHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = getDeviceToken?.();
    if (token) headers['X-Pairing-Token'] = token;
    return headers;
  }

  function _gatewayAuthHeaders() {
    const headers = {};
    const token = getDeviceToken?.();
    if (token) headers['X-Pairing-Token'] = token;
    return headers;
  }

  function _voiceDebug(event, data = {}) {
    try {
      const payload = JSON.stringify({
        event: String(event || ''),
        at: Date.now(),
        route: String(location.hash || location.pathname || ''),
        mode: String(__pmVoice?.settings?.voiceMode || ''),
        provider: __pmVoice?.provider || null,
        data,
      });
      fetch('/api/mobile/voice-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        cache: 'no-store',
      }).catch(() => {});
    } catch {}
  }

  function _extractRealtimeClientSecret(data) {
    return String(data?.client_secret?.value || data?.value || data?.client_secret || '').trim();
  }

  function _isUsableRealtimeOfferSdp(sdp) {
    const text = String(sdp || '').trim();
    return !!(text && text.startsWith('v=') && /\r?\nm=audio\s/i.test(text));
  }

  function _localRealtimeOfferSdp(pc) {
    return String(pc?.localDescription?.sdp || '');
  }

  function _realtimeSdpPostBody(sdp) {
    const text = String(sdp || '').replace(/\s+$/g, '');
    return text ? `${text}\r\n` : '';
  }

  async function _waitForLocalRealtimeOfferSdp(pc) {
    if (pc?.iceGatheringState !== 'complete') {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2500);
        const done = () => {
          clearTimeout(timeout);
          try { pc.removeEventListener('icegatheringstatechange', onChange); } catch {}
          resolve();
        };
        const onChange = () => {
          if (pc.iceGatheringState === 'complete') done();
        };
        try { pc.addEventListener('icegatheringstatechange', onChange); } catch { clearTimeout(timeout); resolve(); }
        if (pc.iceGatheringState === 'complete') done();
      });
    }
    for (let i = 0; i < 20; i++) {
      const sdp = _localRealtimeOfferSdp(pc);
      if (_isUsableRealtimeOfferSdp(sdp)) return sdp;
      await new Promise(resolve => setTimeout(resolve, i < 2 ? 0 : 100));
    }
    return _localRealtimeOfferSdp(pc);
  }

  async function _exchangeRealtimeSdpViaGateway({ sdp, mode, language, voice, speed, instructions }) {
    const offerSdp = String(sdp || '').trim();
    if (!_isUsableRealtimeOfferSdp(offerSdp)) throw new Error(`Realtime SDP offer was empty or missing audio (${offerSdp.length} bytes).`);
    _voiceDebug('realtime-sdp-exchange-start', { mode, sdpLength: offerSdp.length, hasAudio: /\r?\nm=audio\s/i.test(offerSdp) });
    try {
      const text = await mobileGatewayTextFetch('/api/realtime/call', {
        method: 'POST',
        body: JSON.stringify({ sdp: offerSdp, mode, language, voice, speed, instructions }),
      });
      _voiceDebug('realtime-sdp-exchange-ok', { mode, answerLength: String(text || '').length });
      return text;
    } catch (err) {
      const raw = String(err?.body || err?.message || err || '');
      let error = raw;
      try {
        const data = JSON.parse(raw);
        const bits = [];
        if (data?.error) bits.push(String(data.error));
        if (data?.sdpLength != null) bits.push(`sdpLength=${data.sdpLength}`);
        if (data?.hasAudio != null) bits.push(`hasAudio=${data.hasAudio}`);
        if (data?.startsWithV != null) bits.push(`startsWithV=${data.startsWithV}`);
        if (data?.firstLine) bits.push(`firstLine=${data.firstLine}`);
        error = bits.join(' | ') || raw;
      } catch {}
      _voiceDebug('realtime-sdp-exchange-error', { mode, status: err?.status || 0, error: error.slice(0, 500) });
      throw new Error(error || `Realtime gateway call failed (${err?.status || 'unknown'})`);
    }
  }

  async function _exchangeRealtimeSdpDirect({ sdp, mode, language, voice, speed, instructions }) {
    const offerSdp = String(sdp || '').trim();
    if (!_isUsableRealtimeOfferSdp(offerSdp)) throw new Error(`Realtime SDP offer was empty or missing audio (${offerSdp.length} bytes).`);
    const tokenResponse = await fetch('/api/realtime/client-secret', {
      method: 'POST',
      headers: _gatewayJsonHeaders(),
      body: JSON.stringify({ mode, language, voice, speed, instructions }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || tokenData?.success === false) {
      throw new Error(tokenData?.error || `Realtime token request failed (${tokenResponse.status})`);
    }
    const clientSecret = _extractRealtimeClientSecret(tokenData);
    if (!clientSecret) throw new Error('Realtime client secret was missing from the gateway response.');
    const _directModel1 = String(tokenData?.model || 'gpt-realtime').trim();
    const sdpResponse = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(_directModel1)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
      body: offerSdp,
    });
    const answerSdp = await sdpResponse.text();
    if (!sdpResponse.ok) throw new Error(answerSdp || `Realtime call failed (${sdpResponse.status})`);
    return answerSdp;
  }

  function _playAudioBase64({ audioBase64, mimeType, playbackRate }) {
    return new Promise((resolve, reject) => {
      const audioUrl = arguments[0]?.audioUrl || arguments[0]?.url;
      const rate = Number(playbackRate);
      const safeRate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
      if (audioUrl) {
        _playAudioUrl(audioUrl, mimeType, safeRate).then(resolve).catch(reject);
        return;
      }
      if (!audioBase64) { resolve(false); return; }
      let bytes = null;
      try {
        const binary = atob(String(audioBase64 || ''));
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {}
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const isIOS = /iPad|iPhone|iPod/i.test(ua) || (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
      const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
      const isMp3 = String(mimeType || '').toLowerCase().includes('mpeg') || String(mimeType || '').toLowerCase().includes('mp3');
      if (isIOS || isSafari || isMp3) {
        playWithHtmlAudio();
        return;
      }
      _playAudioBytesWithContext(bytes, safeRate).then((played) => {
        if (played) { resolve(true); return; }
        playWithHtmlAudio();
      }).catch((err) => {
        console.warn('[voice] Web Audio playback failed, falling back to audio element', err);
        playWithHtmlAudio();
      });

      function playWithHtmlAudio() {
      const audio = _getServerAudioElement();
      try {
        if (__pmVoice.audioObjectUrl) URL.revokeObjectURL(__pmVoice.audioObjectUrl);
      } catch {}
      try {
        if (bytes?.byteLength) {
          const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
          __pmVoice.audioObjectUrl = URL.createObjectURL(blob);
          audio.srcObject = null;
          audio.src = __pmVoice.audioObjectUrl;
        } else {
          audio.srcObject = null;
          audio.src = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;
        }
      } catch {
        audio.srcObject = null;
        audio.src = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;
      }
      _playHtmlAudioElement(audio, safeRate).then(resolve).catch(reject);
      }
    });
  }

  async function _playAudioBytesWithContext(bytes, playbackRate = 1) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !bytes?.byteLength) return false;
    const ctx = __pmVoice.audioCtx || new AudioCtx();
    __pmVoice.audioCtx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    _ensureVoiceAudioKeepalive();
    const decodeBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await ctx.decodeAudioData(decodeBuffer);
    if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration < 0.05) return false;
    try { __pmVoice.audioSource?.stop?.(); } catch {}
    const source = ctx.createBufferSource();
    const gain = __pmVoice.audioGain || ctx.createGain();
    __pmVoice.audioGain = gain;
    gain.gain.value = 1;
    source.buffer = decoded;
    source.playbackRate.value = Math.max(0.5, Math.min(2, Number(playbackRate) || 1));
    source.connect(gain);
    gain.connect(ctx.destination);
    __pmVoice.audioSource = source;
    _markVoiceSpeakingStart(__pmVoice.currentSpokenSegment);
    const lyricText = String(__pmVoice.lyricPlayback?.text || __pmVoice.currentSpokenSegment || '').trim();
    const lyricStartedAt = ctx.currentTime;
    const lyricDuration = decoded.duration / Math.max(0.5, Math.min(2, Number(playbackRate) || 1));
    const updateLyrics = () => {
      if (__pmVoice.audioSource !== source || !lyricText) return;
      _setMobileVoicePlaybackLyricProgress((ctx.currentTime - lyricStartedAt) / Math.max(.05, lyricDuration));
      __pmVoice.lyricRaf = requestAnimationFrame(updateLyrics);
    };
    if (lyricText) {
      if (__pmVoice.lyricRaf) cancelAnimationFrame(__pmVoice.lyricRaf);
      __pmVoice.lyricRaf = requestAnimationFrame(updateLyrics);
    }
    return await new Promise((resolve, reject) => {
      source.onended = () => {
        if (__pmVoice.audioSource === source) __pmVoice.audioSource = null;
        if (lyricText) _setMobileVoicePlaybackLyricProgress(1);
        _markVoiceSpeakingEnd();
        resolve(true);
      };
      try { source.start(0); } catch (err) { reject(err); }
    });
  }

  function _markVoiceSpeakingStart(text) {
    const segment = String(text || '').replace(/\s+/g, ' ').trim();
    if (segment) __pmVoice.currentSpokenSegment = segment.slice(0, 1200);
    __pmVoice.speaking = true;
    __pmVoice.speakingStartedAt = Date.now();
    document.body.classList.add('pm-voice-ai-speaking');
  }

  function _markVoiceSpeakingEnd() {
    const segment = String(__pmVoice.currentSpokenSegment || '').trim();
    if (segment) {
      const prior = String(__pmVoice.spokenTextSoFar || '').trim();
      __pmVoice.spokenTextSoFar = [prior, segment].filter(Boolean).join('\n').slice(-4000);
      __pmVoice.recentSpokenText = segment.slice(0, 1200);
    }
    __pmVoice.currentSpokenSegment = '';
    __pmVoice.speaking = false;
    __pmVoice.speakingEndedAt = Date.now();
    document.body.classList.remove('pm-voice-ai-speaking');
  }

  function _getServerAudioElement() {
    const audio = __pmVoice.serverAudioEl || document.getElementById('pm-mobile-server-voice-audio') || new Audio();
    __pmVoice.serverAudioEl = audio;
    audio.id = 'pm-mobile-server-voice-audio';
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    audio.preload = 'auto';
    audio.controls = false;
    audio.style.position = 'fixed';
    audio.style.left = '0';
    audio.style.bottom = '0';
    audio.style.width = '1px';
    audio.style.height = '1px';
    audio.style.opacity = '0.01';
    audio.style.pointerEvents = 'none';
    if (!audio.parentNode) document.body.appendChild(audio);
    return audio;
  }

  function _playHtmlAudioElement(audio, playbackRate = 1) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let playbackStarted = false;
      let startedAt = Date.now();
      const markSpeaking = (fromPlayback = false) => {
        if (fromPlayback) playbackStarted = true;
        startedAt = Date.now();
        _markVoiceSpeakingStart(__pmVoice.currentSpokenSegment);
      };
      const updateLyrics = () => {
        const duration = Number(audio.duration || 0);
        if (Number.isFinite(duration) && duration > 0) {
          _setMobileVoicePlaybackLyricProgress(Number(audio.currentTime || 0) / duration);
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        _markVoiceSpeakingEnd();
        try { if (__pmVoice.audioObjectUrl) URL.revokeObjectURL(__pmVoice.audioObjectUrl); } catch {}
        __pmVoice.audioObjectUrl = null;
        resolve(true);
      };
      audio.onplay = () => markSpeaking(true);
      audio.onplaying = () => markSpeaking(true);
      audio.ontimeupdate = updateLyrics;
      audio.onended = () => {
        const elapsed = Date.now() - startedAt;
        if (elapsed < 1200 && Number(audio.currentTime || 0) < 0.25) {
          setTimeout(() => {
            if (!settled) audio.play?.().catch(() => finish());
          }, 180);
          return;
        }
        finish();
      };
      audio.onpause = () => {
        if (!playbackStarted && Number(audio.currentTime || 0) < 0.05) return;
        finish();
      };
      audio.onerror = () => {
        if (settled) return;
        settled = true;
        _markVoiceSpeakingEnd();
        reject(new Error('Audio playback failed'));
      };
      try { audio.playbackRate = Math.max(0.5, Math.min(2, Number(playbackRate) || 1)); } catch {}
      try { audio.load?.(); } catch {}
      markSpeaking(false);
      const played = audio.play?.();
      if (played?.catch) played.catch(reject);
    });
  }

  function _ensureVoiceAudioKeepalive() {
    try {
      const ctx = __pmVoice.audioCtx;
      if (!ctx || __pmVoice.audioKeepalive) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 20;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      __pmVoice.audioKeepalive = { oscillator, gain };
    } catch {}
  }

  async function _playAudioUrl(audioUrl, mimeType, playbackRate = 1) {
    const src = String(audioUrl || '').trim();
    if (!src) return false;
    const url = `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    // iOS Safari has a long-standing AudioContext.decodeAudioData() bug where
    // certain MP3 profiles (including xAI Grok's TTS encoder) resolve with a
    // zero-length AudioBuffer instead of failing — playback "succeeds" with 0ms
    // of audio (the orb flashes on then immediately off). The native HTML <audio>
    // element decoder doesn't have this bug. So on iOS / Safari, or for any MP3
    // URL delivery, skip the Web Audio decode path and stream through <audio>.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isMp3 = String(mimeType || '').toLowerCase().includes('mpeg') || String(mimeType || '').toLowerCase().includes('mp3') || /\.mp3(\?|$)/i.test(src);
    const preferHtmlAudio = isIOS || isSafari || isMp3;
    const authHeaders = _gatewayAuthHeaders();
    if (!preferHtmlAudio) {
      try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: authHeaders });
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const played = await _playAudioBytesWithContext(new Uint8Array(buffer), playbackRate);
          if (played) return;
        }
      } catch (err) {
        console.warn('[voice] Audio URL fetch/WebAudio playback failed, falling back to element', err);
      }
    }
    const audio = _getServerAudioElement();
    audio.srcObject = null;
    try { audio.crossOrigin = 'anonymous'; } catch {}
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: authHeaders });
      if (response.ok) {
        const blob = await response.blob();
        if (__pmVoice.audioObjectUrl) URL.revokeObjectURL(__pmVoice.audioObjectUrl);
        __pmVoice.audioObjectUrl = URL.createObjectURL(blob);
        audio.src = __pmVoice.audioObjectUrl;
        return _playHtmlAudioElement(audio, playbackRate);
      }
    } catch (err) {
      console.warn('[voice] Authenticated audio URL fetch failed, falling back to direct media URL', err);
    }
    audio.src = url;
    return _playHtmlAudioElement(audio, playbackRate);
  }

  function _unlockVoiceAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && !__pmVoice.audioCtx) __pmVoice.audioCtx = new AudioCtx();
      if (__pmVoice.audioCtx?.state === 'suspended') __pmVoice.audioCtx.resume?.().catch?.(() => {});
      _ensureVoiceAudioKeepalive();
    } catch {}
    if (__pmVoice.audioUnlocked) return;
    try {
      const audio = _getServerAudioElement();
      audio.autoplay = false;
      audio.muted = true;
      audio.volume = 0;
      audio.playsInline = true;
      audio.preload = 'auto';
      audio.controls = false;
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';
      const played = audio.play?.();
      if (played?.then) {
        played.then(() => {
          __pmVoice.audioUnlocked = true;
          try { audio.pause(); audio.currentTime = 0; } catch {}
        }).catch(() => {});
      } else {
        __pmVoice.audioUnlocked = true;
      }
    } catch {}
  }

  async function _speakWithRealtimeVoice(text) {
    const content = String(text || '').trim();
    if (!content) return false;
    const { dc, audio } = await _ensureRealtimeSpeechConnection();
    if (!dc || dc.readyState !== 'open') throw new Error('Realtime speech channel is not open.');
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Realtime speech timed out'));
      }, 45000);
      const cleanup = () => {
        clearTimeout(timeout);
        dc.removeEventListener?.('message', onMessage);
        dc.removeEventListener?.('error', onError);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Realtime data channel failed'));
      };
      const onMessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = String(data?.type || '');
          if (type === 'response.audio.delta' || type === 'response.output_audio.delta' || type === 'response.created') {
            __pmVoice.realtimeSpeechActiveResponse = true;
            _markVoiceSpeakingStart(__pmVoice.currentSpokenSegment || 'Realtime voice response');
          }
          if (type === 'response.done' || type === 'response.audio.done' || type === 'response.output_audio.done' || type === 'response.cancelled') {
            __pmVoice.realtimeSpeechActiveResponse = false;
            cleanup();
            setTimeout(() => resolve(true), 1800);
          }
          if (type === 'error') {
            if (_isBenignRealtimeParseError(data)) return;
            if (_isBenignRealtimeCancelError(data)) return;
            cleanup();
            reject(new Error(data?.error?.message || data?.error || 'Realtime speech failed'));
          }
        } catch {}
      };
      dc.addEventListener('message', onMessage);
      dc.addEventListener('error', onError, { once: true });
    }).finally(() => {
      _markVoiceSpeakingEnd();
    });

    if (__pmVoice.realtimeSpeechActiveResponse) {
      try { dc.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
    }
    try { dc.send(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
    dc.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          output: {
            voice: __pmVoice.settings?.realtimeVoice || __pmVoice.provider?.voice || 'marin',
            speed: Number(__pmVoice.settings?.realtimeSpeed || __pmVoice.provider?.speed || 1.05),
          },
        },
      },
    }));
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `Repeat this Prometheus response aloud exactly:\n\n${content.slice(0, 5000)}` }],
      },
    }));
    dc.send(JSON.stringify({
      type: 'response.create',
      response: {
        output_modalities: ['audio'],
        instructions: 'Speak only the supplied Prometheus response text.',
      },
    }));
    _markVoiceSpeakingStart(content);
    audio.muted = false;
    audio.volume = 1;
    audio.play?.().catch((err) => {
      console.warn('[voice] realtime audio play blocked after response.create', err);
      pmToast('Realtime audio is blocked. Tap Repeat Last Response once.', 'error');
    });
    await done;
    return true;
  }

  async function _ensureRealtimeSpeechConnection() {
    const existing = __pmVoice.realtimeSpeechConnection;
    if (existing?.dc?.readyState === 'open') return existing;
    if (__pmVoice.realtimeSpeechConnecting) return __pmVoice.realtimeSpeechConnecting;
    __pmVoice.realtimeSpeechConnecting = (async () => {
      const tokenResponse = await fetch('/api/realtime/client-secret', {
        method: 'POST',
        headers: _gatewayJsonHeaders(),
        body: JSON.stringify({
          voice: __pmVoice.settings?.realtimeVoice || __pmVoice.provider?.voice || 'marin',
          speed: Number(__pmVoice.settings?.realtimeSpeed || __pmVoice.provider?.speed || 1.05),
          instructions: 'Speak the supplied Prometheus response verbatim. Do not add extra commentary.',
        }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || tokenData?.success === false) {
        throw new Error(tokenData?.error || `Realtime token request failed (${tokenResponse.status})`);
      }
      const clientSecret = _extractRealtimeClientSecret(tokenData);
      if (!clientSecret) throw new Error('Realtime client secret was missing from the gateway response.');
      const _realtimeSpeechModel = String(tokenData?.model || 'gpt-realtime').trim();

      const pc = new RTCPeerConnection();
    const audio = document.getElementById('pm-mobile-realtime-audio') || __pmVoice.audioEl || document.createElement('audio');
    __pmVoice.audioEl = audio;
    audio.id = 'pm-mobile-realtime-audio';
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = 1;
    audio.playsInline = true;
    audio.style.display = 'none';
    if (!audio.parentNode) document.body.appendChild(audio);
    audio.onplaying = () => { _markVoiceSpeakingStart(__pmVoice.currentSpokenSegment || 'Realtime voice response'); };
    audio.onended = () => { _markVoiceSpeakingEnd(); };
    audio.onerror = () => { console.warn('[voice] realtime audio element playback failed'); };
    pc.ontrack = (event) => {
      _tuneMobileRealtimeAudioReceiver(event.receiver);
      _attachMobileRealtimeOutput(audio, event.streams[0], { receiver: event.receiver });
    };
    try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}
    const dc = pc.createDataChannel('oai-events');
      dc.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = String(data?.type || '');
          if (type === 'response.audio.delta' || type === 'response.output_audio.delta' || type === 'response.created') {
            __pmVoice.realtimeSpeechActiveResponse = true;
            _markVoiceSpeakingStart(__pmVoice.currentSpokenSegment || 'Realtime voice response');
          }
          if (type === 'response.done' || type === 'response.audio.done' || type === 'response.output_audio.done' || type === 'response.cancelled') {
            __pmVoice.realtimeSpeechActiveResponse = false;
            _markVoiceSpeakingEnd();
          }
          if (type === 'error') {
            if (_isBenignRealtimeParseError(data)) return;
            if (_isBenignRealtimeCancelError(data)) return;
            console.warn('[voice] realtime speech event error', data?.error || data);
          }
        } catch {}
      });
      const dcOpen = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Realtime data channel did not open.')), 12000);
        dc.addEventListener('open', () => { clearTimeout(timeout); resolve(true); }, { once: true });
        dc.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Realtime data channel failed.')); }, { once: true });
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(_realtimeSpeechModel)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });
      const answerSdp = await sdpResponse.text();
      if (!sdpResponse.ok) throw new Error(answerSdp || `Realtime call failed (${sdpResponse.status})`);
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      await dcOpen;
      const connection = { pc, dc, audio };
      __pmVoice.realtimeSpeechConnection = connection;
      pc.addEventListener('connectionstatechange', () => {
        if (['closed', 'failed', 'disconnected'].includes(pc.connectionState) && __pmVoice.realtimeSpeechConnection === connection) {
          __pmVoice.realtimeSpeechConnection = null;
        }
      });
      return connection;
    })().finally(() => {
      __pmVoice.realtimeSpeechConnecting = null;
    });
    return __pmVoice.realtimeSpeechConnecting;
  }

  function _closeRealtimeSpeechConnection() {
    const conn = __pmVoice.realtimeSpeechConnection;
    __pmVoice.realtimeSpeechConnection = null;
    __pmVoice.realtimeSpeechConnecting = null;
    try { conn?.dc?.close?.(); } catch {}
    try { conn?.pc?.close?.(); } catch {}
    try { if (conn?.audio) conn.audio.srcObject = null; } catch {}
  }

  function _configuredServerTtsProviders() {
    const providers = Array.isArray(__pmVoice.voiceStatus?.ttsProviders) ? __pmVoice.voiceStatus.ttsProviders : [];
    return providers
      .filter(p => p?.configured && p?.id && !['browser', 'openai_realtime'].includes(p.id))
      .map(p => p.id);
  }

  // ============================================================================
  // REALTIME VOICE AGENT (mobile) — full audio-in / audio-out via OpenAI Realtime.
  // When voice mode is openai_realtime end-to-end, this replaces the split flow.
  // ============================================================================

  const mobileVoiceRealtimeRuntime = createMobileVoiceRealtimeRuntime({
    ...(context || {}),
    _appendMobileCodexBridgeRealtimeSpeech,
    _appendMobileCodexVoiceRoomText,
    _appendMobileRealtimeTranscriptDelta,
    _applyMobileVoiceProviderDefaults,
    _applyMobileVoiceTarget,
    _applyPendingVoiceRuntimeDirectivesAfterReply,
    _applyVoiceInterruptionToMobileChat,
    _applyVoiceRuntimeDirective,
    _applyVoiceRuntimeDirectives,
    _applyVoiceSettingsLive,
    _armMobileVoiceRoomHandoffAckGuard,
    _audioExtensionForMimeType,
    _blobToBase64,
    _canUseBrowserRecognition,
    _captureVoicePlaybackInterrupt,
    _claimSubagentVoiceReplyOnce,
    _cleanMobileWakePhrase,
    _cleanVoiceSpeechText,
    _clearMobileCodexVoiceRoomWarmPool,
    _closeMobileCodexVoiceRoomConnection,
    _closeRealtimeSpeechConnection,
    _configuredServerTtsProviders,
    _consumeMobileVoiceRoomHandoffEcho,
    _consumeVoicePlaybackInterruptContext,
    _createMobileVoiceStreamingDispatcher,
    _deliverSubagentVoiceReplyOnce,
    _detectProvider,
    _diffMobileMedia,
    _ensureRealtimeSpeechConnection,
    _ensureVoiceAudioKeepalive,
    _exchangeRealtimeSdpDirect,
    _exchangeRealtimeSdpViaGateway,
    _executeMobileVoiceRoomHandoffTool,
    _exitMobileVoiceRoomForFreshChat,
    _extractRealtimeClientSecret,
    _finalizeVoiceInterruptionForTranscript,
    _findMobileRealtimeUserDraft,
    _findMobileRecoverableAssistantTurn,
    _flashVoiceOrbConfirmed,
    _gatewayAuthHeaders,
    _gatewayJsonHeaders,
    _getCachedMobileVoiceWorkerContextPacket,
    _getMobileVoiceWorkerContextPacketForTurn,
    _getRecorderMimeType,
    _getServerAudioElement,
    _handoffMobileCodexVoiceRoomTarget,
    _hasMobileVoiceWarmMic,
    _hasMobileVoiceWorkIntent,
    _inputProviderForMode,
    _installMobileCameraPinchZoom,
    _isBenignRealtimeCancelError,
    _isBenignRealtimeParseError,
    _isHealthyMobileVoiceRoomConnection,
    _isIosSafariBrowser,
    _isLikelyMobileVoiceSelfEcho,
    _isMobileCodexAvasRealtime,
    _isMobileCodexV3RealtimeConnection,
    _isMobileInlineChatVoiceActive,
    _isMobileQuietModeCommand,
    _isMobileRealtimeBootstrapSupersededError,
    _isMobileVoiceDirectAnswerOnlyTurn,
    _isMobileVoiceStatusQuestion,
    _isMobileWakeUnlockCommand,
    _isNoActiveRealtimeCancelError,
    _isRealtimeConnected,
    _isSubagentVoiceDirectAnswerOnlyTurn,
    _isUsableRealtimeOfferSdp,
    _isVoiceRoomEnabled,
    _loadDurableMobileVoiceRoom,
    _loadServerVoiceCatalog,
    _loadVoiceRoomState,
    _loadVoiceSettings,
    _localRealtimeOfferSdp,
    _makeRecognizer,
    _markVoiceSpeakingEnd,
    _markVoiceSpeakingStart,
    _mergeMobileRealtimeTranscriptSnapshot,
    _mobileMediaKey,
    _mobileRealtimeAudioPlaybackMs,
    _mobileRealtimeBootstrapSupersededError,
    _mobileRealtimeCurrentStagedAttachmentTurn,
    _mobileRealtimeDefaultVoice,
    _mobileRealtimeListenModeFromSettings,
    _mobileRealtimeProviderKeyFromSettings,
    _mobileRealtimeProviderLabel,
    _mobileRealtimeRawTranscriptDelta,
    _mobileRealtimeTurnDetectionForListenMode,
    _mobileRealtimeVoice,
    _mobileRealtimeVoiceOptions,
    _mobileStreamTargetTurn,
    _mobileVoiceDefaultProviderFromStatus,
    _mobileVoiceRoomCodexInstructions,
    _mobileVoiceRoomContextPayload,
    _mobileVoiceRoomHandoffContextText,
    _mobileVoiceRoomParkedAudio,
    _mobileVoiceRoomParticipantSessionId,
    _mobileVoiceRoomTranscriptBlock,
    _mobileVoiceRoomWarmPool,
    _mobileVoiceToolKey,
    _mobileVoiceToolsAreActive,
    _normalizeMobileWakePhrase,
    _normalizeVoiceEchoText,
    _normalizeVoiceRoomState,
    _outputProviderForMode,
    _parkMobileCodexVoiceRoomConnection,
    _parseMobileWakePhraseSettingCommand,
    _persistMobileThreadSnapshot,
    _playAudioBase64,
    _playAudioBytesWithContext,
    _playAudioUrl,
    _playHtmlAudioElement,
    _prefetchMobileVoiceWorkerContextPacket,
    _prepareVoiceAgentHandoff,
    _prewarmMobileCodexRealtimeBridge,
    _prewarmMobileVoiceWorkerContext,
    _promoteMobileCodexVoiceRoomConnection,
    _promoteMobileRealtimeUserDraft,
    _pulseMobileVoiceOrb,
    _realtimeSdpPostBody,
    _recordMobileVoiceRoomHandoffUserTranscript,
    _refreshMobileRealtimeAgentRoomTarget,
    _releaseMobileVoiceRoomHandoffAckGuard,
    _renderMobileRealtimeUserTranscriptInChat,
    _renderVoiceAgentTargetPickerHtml,
    _requestMobileVoiceMicFromGesture,
    _resolveDurableMobileVoiceRoom,
    _restartMobileRealtimeAgentForSettings,
    _routeMobileVoiceRoomTranscript,
    _saveVoiceRoomState,
    _saveVoiceSettings,
    _scheduleMobileCodexVoiceRoomPrewarm,
    _sendMobileCodexVisionSummaryToRealtime,
    _sendMobileRealtimeAgentSessionUpdateFromSettings,
    _sendMobileRealtimeRoomTextToTarget,
    _serverVoiceFallback,
    _setMobileSteerContinuationTurn,
    _setMobileVoiceLyricProgress,
    _setMobileVoicePlaybackLyricProgress,
    _setMobileVoiceStatus,
    _setMobileVoiceToolActive,
    _setOrbState,
    _silenceMobileVoiceRoomOutput,
    _speakMobileRealtimeAgentMilestone,
    _speakVoiceLiveStatus,
    _speakVoiceMilestone,
    _speakWithRealtimeVoice,
    _startVoiceAgentNarrationLoop,
    _stripMobileWakeCommandPunctuation,
    _trySubmitVoiceAsLiveSteer,
    _ttsSpeak,
    _ttsStop,
    _unlockVoiceAudio,
    _updateRealtimeSpeechConnectionFromSettings,
    _visionEventToMobileMedia,
    _voiceChannelLabel,
    _voiceDebug,
    _voiceLiveToolStatus,
    _voiceMainAgentSvg,
    _voiceMainRoomParticipant,
    _voicePresetForProviders,
    _voiceProviderSummary,
    _voiceReadyHintGlobal,
    _voiceRenderHighlightedStatus,
    _voiceRoomActiveParticipant,
    _voiceRoomAddressOnlyHandoffText,
    _voiceRoomAliasPatterns,
    _voiceRoomClearQuiet,
    _voiceRoomConversationalAddressPrefix,
    _voiceRoomCurrentTargetKey,
    _voiceRoomHasUnmatchedAddressCue,
    _voiceRoomMatchAddress,
    _voiceRoomNormalizeText,
    _voiceRoomOnlyLeadingFillers,
    _voiceRoomParseQuietCommand,
    _voiceRoomParticipantFromHandoffToolArgs,
    _voiceRoomParticipantKey,
    _voiceRoomParticipantLabel,
    _voiceRoomQuietState,
    _voiceRoomRememberRoute,
    _voiceRoomRememberTranscript,
    _voiceRoomRouteDedupeKey,
    _voiceRoomSeenRecently,
    _voiceRoomSetFocus,
    _voiceRoomSetQuiet,
    _voiceRoomSpeechWords,
    _voiceRoomStartsWithWords,
    _voiceRoomUniqueAliases,
    _voiceScrollLiveTranscriptToEnd,
    _voiceSetStatus,
    _voiceSetStatusTone,
    _voiceShortSessionLabel,
    _voiceShowReadyStatus,
    _voiceShowRealtimeAgentMessage,
    _voiceShowRealtimeUserTranscript,
    _voiceSpokenMilestone,
    _voiceStatusPreviewText,
    _voiceSubagentRoomParticipant,
    _voiceTargetLabel,
    _voiceToolTargetLabel,
    _waitForLocalRealtimeOfferSdp,
  });
  const {
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
  } = mobileVoiceRealtimeRuntime;

  // Streaming TTS dispatcher used for chunk-by-chunk speech as the voice agen
  // streams sentences. Picks the matching path for the current TTS provider so
  // realtime, xAI, OpenAI and browser TTS all work the same way from callers.
  function _createMobileVoiceStreamingDispatcher() {
    const mode = String(__pmVoice?.settings?.voiceMode || 'default');
    const outputProvider = String(
      __pmVoice?.settings?.ttsProvider
        || __pmVoice?.provider?.ttsProvider
        || _outputProviderForMode(mode),
    );
    // Realtime: relay each chunk through the realtime narration path.
    if (outputProvider === 'openai_realtime') {
      let chain = Promise.resolve();
      return {
        provider: 'openai_realtime',
        enqueue(text) {
          const t = String(text || '').trim();
          if (!t) return;
          chain = chain.catch(() => {}).then(() => _speakWithRealtimeVoice(t).catch(() => {}));
        },
        wait() { return chain.catch(() => {}); },
      };
    }
    // xAI / OpenAI: serialized fetch+play per chunk, pre-fetched concurrently.
    if (outputProvider === 'xai' || outputProvider === 'openai') {
      const ttsProvider = outputProvider;
      const xaiSpeed = Number(__pmVoice?.settings?.xaiSpeed || __pmVoice?.provider?.speed || 1.0);
      const serverVoice = String(__pmVoice?.settings?.serverVoice || __pmVoice?.provider?.ttsVoice || '').trim();
      const xaiVoice = String(serverVoice || 'eve').trim();
      const useUrl = ttsProvider === 'xai' && !_isIosSafariBrowser();
      const buildChunkBody = (chunk) => {
        const b = { provider: ttsProvider, text: chunk };
        if (ttsProvider === 'openai' && serverVoice) b.voice = serverVoice;
        if (ttsProvider === 'xai' && xaiVoice) b.voiceId = xaiVoice;
        if (ttsProvider === 'xai') b.speed = xaiSpeed;
        if (useUrl) b.delivery = 'url';
        return b;
      };
      let chain = Promise.resolve();
      return {
        provider: ttsProvider,
        enqueue(text) {
          const t = String(text || '').trim();
          if (!t) return;
          const fetched = synthesizeVoiceAudio(buildChunkBody(t)).catch((err) => {
            _voiceDebug('tts-stream-fetch-failed', { provider: ttsProvider, message: err?.message || String(err) });
            return null;
          });
          chain = chain.catch(() => {}).then(async () => {
            const audio = await fetched;
            if (!audio) return;
            try {
              await _playAudioBase64({ ...audio, playbackRate: ttsProvider === 'xai' ? xaiSpeed : 1 });
            } catch (err) {
              _voiceDebug('tts-stream-play-failed', { provider: ttsProvider, message: err?.message || String(err) });
            }
          });
        },
        wait() { return chain.catch(() => {}); },
      };
    }
    // Browser TTS: speakSynthesis enqueues utterances natively.
    if (outputProvider === 'browser' || !outputProvider) {
      return {
        provider: 'browser',
        enqueue(text) {
          const t = String(text || '').trim();
          if (!t) return;
          try {
            const utter = new SpeechSynthesisUtterance(t);
            window.speechSynthesis.speak(utter);
          } catch {}
        },
        wait() { return Promise.resolve(); },
      };
    }
    return null;
  }

  async function _ttsSpeak(text) {
    // Legacy TTS is retired. OpenAI/xAI realtime owns all spoken output.
    return;
    text = _cleanVoiceSpeechText(text);
    if (!text) return;
    __pmVoice.currentSpokenSegment = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const mode = String(__pmVoice.settings?.voiceMode || 'default');
    const outputProvider = String(__pmVoice.settings?.ttsProvider || __pmVoice.provider?.ttsProvider || _outputProviderForMode(mode));
    _voiceDebug('tts-start', { textLen: String(text || '').length, mode, provider: outputProvider });
    const wantsRealtime = outputProvider === 'openai_realtime';
    const wantsXai = outputProvider === 'xai';
    const wantsOpenaiTts = outputProvider === 'openai';
    let realtimeReady = !!(__pmVoice.provider?.canRealtime || _isRealtimeConnected());
    if (wantsRealtime && !realtimeReady) {
      try {
        const status = await loadVoiceStatus();
        __pmVoice.lastVoiceStatus = status;
        __pmVoice.voiceStatus = status?.voice || null;
        const detected = _detectProvider(status);
        __pmVoice.provider = { ...detected, sttProvider: __pmVoice.provider?.sttProvider || detected.sttProvider || 'browser' };
        realtimeReady = !!(__pmVoice.provider?.canRealtime || _isRealtimeConnected(status));
      } catch {}
    }
    if ((wantsXai || wantsOpenaiTts) && !Array.isArray(__pmVoice.voiceStatus?.ttsProviders)) {
      try {
        const status = await loadVoiceStatus();
        __pmVoice.lastVoiceStatus = status;
        __pmVoice.voiceStatus = status?.voice || null;
        const detected = _detectProvider(status);
        __pmVoice.provider = { ...__pmVoice.provider, ...detected };
      } catch {}
    }
    if (wantsRealtime && realtimeReady) {
      try {
        _voiceSetStatus('Speaking with Realtime', 'OpenAI Realtime audio is generating the response');
        await _speakWithRealtimeVoice(text);
        return;
      } catch (err) {
        console.warn('[voice] realtime speech failed, falling back', err);
        if (_isBenignRealtimeParseError(err)) return;
        pmToast(err.message || 'OpenAI Realtime audio failed', 'error');
        _voiceSetStatus('Audio failed', 'OpenAI Realtime could not play this response');
      }
    }
    const xaiTtsConfigured = Array.isArray(__pmVoice.voiceStatus?.ttsProviders)
      && __pmVoice.voiceStatus.ttsProviders.some(p => p?.id === 'xai' && p?.configured);
    const openaiTtsConfigured = Array.isArray(__pmVoice.voiceStatus?.ttsProviders)
      && __pmVoice.voiceStatus.ttsProviders.some(p => p?.id === 'openai' && p?.configured);
    const xaiDisabled = !!(typeof window !== 'undefined' && window.__pmDisableXaiTts);
    const providersToTry = wantsXai && xaiTtsConfigured && !xaiDisabled
      ? ['xai']
      : (wantsOpenaiTts && openaiTtsConfigured ? ['openai'] : []);
    try { console.log('[voice] server TTS gate split-routing', { mode, outputProvider, xaiTtsConfigured, openaiTtsConfigured, willTry: providersToTry }); } catch {}
    _voiceDebug('tts-gate', { mode, provider: outputProvider, xaiTtsConfigured, openaiTtsConfigured, wantsXai, wantsOpenaiTts, providersToTry });
    for (const ttsProvider of providersToTry) {
      try {
        _voiceSetStatus(ttsProvider === 'xai' ? 'Speaking with xAI / Grok' : 'Speaking with OpenAI', `${ttsProvider === 'xai' ? 'Grok' : 'OpenAI'} voice audio is generating the response`);
        _markVoiceSpeakingStart(text);
        const xaiSpeed = Number(__pmVoice.settings?.xaiSpeed || __pmVoice.provider?.speed || 1.0);
        const serverVoice = String(__pmVoice.settings?.serverVoice || __pmVoice.provider?.ttsVoice || '').trim();
        const xaiVoice = String(serverVoice || 'eve').trim();
        const useUrl = ttsProvider === 'xai' && !_isIosSafariBrowser();
        const buildChunkBody = (chunk) => {
          const b = { provider: ttsProvider, text: chunk };
          if (ttsProvider === 'openai' && serverVoice) b.voice = serverVoice;
          if (ttsProvider === 'xai' && xaiVoice) b.voiceId = xaiVoice;
          if (ttsProvider === 'xai') b.speed = xaiSpeed;
          if (useUrl) b.delivery = 'url';
          return b;
        };
        // Split into sentence-sized chunks and pipeline fetch+play so the firs
        // audio segment starts playing before the full reply is encoded.
        const sentences = (() => {
          const src = String(text || '').replace(/\s+/g, ' ').trim();
          if (!src) return [];
          const parts = src.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [src];
          const out = []; let cur = '';
          for (const p of parts) {
            const next = p.trim();
            if (!next) continue;
            if ((cur + ' ' + next).trim().length <= 400) { cur = (cur + ' ' + next).trim(); continue; }
            if (cur) out.push(cur);
            cur = next.length <= 400 ? next : (out.push(...next.match(/.{1,400}/g) || [next]), '');
          }
          if (cur) out.push(cur);
          return out.filter(Boolean);
        })();
        const chunks = sentences.length ? sentences : [String(text || '').trim().slice(0, 4000)];
        const totalChunkChars = Math.max(1, chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let completedChunkChars = 0;
        _voiceDebug('tts-fetch-start', { provider: ttsProvider, voiceId: xaiVoice, delivery: useUrl ? 'url' : 'base64', chunks: chunks.length });
        let nextFetch = synthesizeVoiceAudio(buildChunkBody(chunks[0]));
        for (let ci = 0; ci < chunks.length; ci++) {
          const audio = await nextFetch;
          if (ci + 1 < chunks.length) nextFetch = synthesizeVoiceAudio(buildChunkBody(chunks[ci + 1]));
          _voiceDebug('tts-fetch-ok', { provider: ttsProvider, chunk: ci, mimeType: audio?.mimeType || '', hasBase64: !!audio?.audioBase64, hasUrl: !!(audio?.audioUrl || audio?.url) });
          __pmVoice.lyricPlayback = {
            text,
            start: completedChunkChars / totalChunkChars,
            end: (completedChunkChars + chunks[ci].length) / totalChunkChars,
          };
          __pmVoice.currentSpokenSegment = chunks[ci];
          await _playAudioBase64({ ...audio, playbackRate: ttsProvider === 'xai' ? xaiSpeed : 1 });
          completedChunkChars += chunks[ci].length;
        }
        __pmVoice.lyricPlayback = null;
        _voiceDebug('tts-play-ok', { provider: ttsProvider });
        return;
      } catch (err) {
        console.warn(`[voice] server TTS failed for ${ttsProvider}, falling back`, err);
        _voiceDebug('tts-error', { provider: ttsProvider, message: err?.message || String(err) });
        pmToast(err.message || `${ttsProvider} voice failed`, 'error');
        _voiceSetStatus('Audio failed', `${ttsProvider === 'xai' ? 'xAI / Grok' : ttsProvider} could not play this response`);
        _markVoiceSpeakingEnd();
      }
    }
    _voiceDebug('tts-browser-fallback', { mode, provider: outputProvider });
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      utter.onstart = () => { _markVoiceSpeakingStart(text); };
      utter.onboundary = (event) => {
        const charIndex = Math.max(0, Number(event.charIndex || 0) || 0);
        _setMobileVoiceLyricProgress(text, charIndex / Math.max(1, text.length));
      };
      utter.onend   = () => { _setMobileVoiceLyricProgress(text, 1); _markVoiceSpeakingEnd(); };
      utter.onerror = () => { _markVoiceSpeakingEnd(); };
      synth.speak(utter);
    } catch (err) { console.warn('[voice] TTS failed', err); }
  }

  function _ttsStop() {
    return;
    try { window.speechSynthesis?.cancel(); } catch {}
    if (__pmVoice.lyricRaf) {
      cancelAnimationFrame(__pmVoice.lyricRaf);
      __pmVoice.lyricRaf = 0;
    }
    __pmVoice.lyricPlayback = null;
    try { __pmVoice.audioSource?.stop?.(); } catch {}
    __pmVoice.audioSource = null;
    const realtimeDc = __pmVoice.realtimeSpeechConnection?.dc;
    if (realtimeDc?.readyState === 'open') {
      try { realtimeDc.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
      try { realtimeDc.send(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
    }
    __pmVoice.realtimeSpeechActiveResponse = false;
    try { __pmVoice.audioEl?.pause?.(); if (__pmVoice.audioEl) __pmVoice.audioEl.currentTime = 0; } catch {}
    try { __pmVoice.serverAudioEl?.pause?.(); if (__pmVoice.serverAudioEl) __pmVoice.serverAudioEl.currentTime = 0; } catch {}
    _markVoiceSpeakingEnd();
  }

  function _claimSubagentVoiceReplyOnce(agentId, text) {
    const clean = _cleanVoiceSpeechText(text);
    if (!clean) return '';
    const key = `${String(agentId || '').trim()}:${clean.toLowerCase().slice(0, 800)}`;
    const last = __pmVoice.subagentLastSpokenReply || {};
    if (last.key === key && Date.now() - Number(last.at || 0) < 12000) return '';
    __pmVoice.subagentLastSpokenReply = { key, at: Date.now(), text: clean, agentId: String(agentId || '').trim() };
    __pmVoice.lastAi = clean;
    return clean;
  }

  async function _deliverSubagentVoiceReplyOnce(agentId, text) {
    // Claim the completion before choosing an output. Subagent SSE completion can
    // be observed by both the local stream and its reconciliation path; only one
    // observer may hand the reply to either realtime summary audio or verbatim TTS.
    const clean = _claimSubagentVoiceReplyOnce(agentId, text);
    if (!clean) return false;
    if (_realtimeAgentDataChannelOpen() && _requestMobileRealtimeAgentFinalSummary(clean)) return true;
    _ttsStop();
    await _ttsSpeak(clean);
    return true;
  }

  function _captureVoicePlaybackInterrupt(reason = 'barge_in') {
    const now = Date.now();
    const realtimeActive = !!__pmVoice.realtimeSpeechActiveResponse;
    const currentSpokenSegment = String(__pmVoice.currentSpokenSegment || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const speechStartedAt = Number(__pmVoice.speakingStartedAt || 0);
    const speechEndedAt = Number(__pmVoice.speakingEndedAt || 0);
    const recentlyEnded = !!(speechEndedAt && now - speechEndedAt < 1200);
    const speechLikelyActive = !!(
      __pmVoice.speaking
      && !recentlyEnded
      && (currentSpokenSegment || realtimeActive || (speechStartedAt && now - speechStartedAt < 45000))
    );
    const active = !!(speechLikelyActive || realtimeActive);
    if (!active) {
      __pmVoice.speaking = false;
      if (!realtimeActive) __pmVoice.currentSpokenSegment = '';
      document.body.classList.remove('pm-voice-ai-speaking');
      return false;
    }
    const runtime = __pmVoice.activeVoiceRuntime || {};
    const runtimeActive = !!(
      runtime
      && runtime.isStreamActive === true
      && String(runtime.sessionId || '').trim()
    );
    if (!runtimeActive) {
      _voiceDebug('voice-playback-cutoff-no-interruption', {
        reason,
        textLen: currentSpokenSegment.length,
        realtimeActive,
      });
      return true;
    }
    const interruptedText = String(runtime.assistantTextSoFar || __pmVoice.lastAi || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
    const spokenTextSoFar = String(__pmVoice.spokenTextSoFar || '').replace(/\s+/g, ' ').trim().slice(-1600);
    __pmVoice.pendingInterruptContext = {
      id: `voice_intr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      reason,
      sessionId: String(__pmVoice.targetSessionId || ''),
      voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
      activeRequestId: String(runtime.activeRequestId || ''),
      originalUserPrompt: String(runtime.originalPrompt || '').trim().slice(0, 1600),
      assistantTextSoFar: interruptedText,
      assistantSpokenTextSoFar: spokenTextSoFar,
      currentSpokenSegment,
      lastVoiceMilestone: String(__pmVoice.lastVoiceMilestone || '').trim().slice(0, 500),
      isStreamActive: runtime.isStreamActive === true,
      interruptedText,
    };
    const sid = String(__pmVoice.targetSessionId || '');
    const thread = sid ? __pmChat.threads?.[sid] : null;
    const lastAi = Array.isArray(thread) ? [...thread].reverse().find((turn) => turn?.role === 'ai') : null;
    if (lastAi && (currentSpokenSegment || realtimeActive)) _appendMobileProcess(lastAi, 'warn', 'Voice playback interrupted by user.');
    return true;
  }

  function _consumeVoicePlaybackInterruptContext(sessionId) {
    const ctx = __pmVoice.pendingInterruptContext;
    if (!ctx) return '';
    if (Date.now() - Number(ctx.at || 0) > 120000) {
      __pmVoice.pendingInterruptContext = null;
      return '';
    }
    __pmVoice.pendingInterruptContext = null;
    return [
      '[VOICE INTERRUPTION CONTEXT]',
      `The user interrupted Prometheus while it was speaking in the mobile voice page (${ctx.voiceMode || 'voice'}).`,
      `Target session: ${sessionId || ctx.sessionId || 'unknown'}.`,
      'Treat the next user message as a barge-in/follow-up to the interrupted spoken response, not an unrelated new request.',
      'Acknowledge that you were interrupted only if it helps the response; do not over-apologize.',
      ctx.interruptedText ? `Interrupted spoken response preview:\n${ctx.interruptedText}` : '',
    ].filter(Boolean).join('\n');
  }

  async function _finalizeVoiceInterruptionForTranscript(userInterruptionTranscript, sessionId) {
    const ctx = __pmVoice.pendingInterruptContext;
    if (!ctx) return '';
    if (Date.now() - Number(ctx.at || 0) > 180000) {
      __pmVoice.pendingInterruptContext = null;
      return '';
    }
    const payload = {
      ...ctx,
      sessionId: sessionId || ctx.sessionId || __pmVoice.targetSessionId || MOBILE_CHAT_SESSION_ID,
      userInterruptionTranscript: String(userInterruptionTranscript || '').trim(),
    };
    __pmVoice.pendingInterruptContext = null;
    try {
      _voiceSetStatus('Interrupted - updating context', 'Prometheus is classifying the interruption');
      let result = null;
      let streamingDispatcher = _createMobileVoiceStreamingDispatcher();
      try {
        result = await streamVoiceAgentInputMobile(payload, (chunk) => {
          try { streamingDispatcher?.enqueue?.(chunk); } catch {}
        });
      } catch (streamErr) {
        _voiceDebug('voice-agent-interruption-stream-failed', { message: streamErr?.message || String(streamErr) });
        streamingDispatcher = null;
        result = await createVoiceInterruptionEvent(payload);
      }
      __pmVoice.lastInterruptionEvent = result;
      const reply = String(result?.voiceReply || '').trim();
      const alreadySpoken = !!result?.streamedSpeech && !!streamingDispatcher;
      if (reply && !alreadySpoken) await _ttsSpeak(reply);
      else if (alreadySpoken) await streamingDispatcher.wait();
      if (result?.classification?.intent === 'cancel') {
        _voiceSetStatus('Cancelled', reply || 'Voice interruption cancelled the active run');
      } else if (result?.classification?.intent === 'pause') {
        _voiceSetStatus('Paused', reply || 'Voice output paused');
      } else {
        _voiceSetStatus('Continuing with correction', 'The next response includes the interruption context');
      }
      return String(result?.injectedContextText || '').trim();
    } catch (err) {
      console.warn('[voice] interruption event failed', err);
      return [
        '[VOICE INTERRUPTION EVENT]',
        `Reason: ${payload.reason || 'barge_in'}`,
        `Original user request: ${payload.originalUserPrompt || '(unknown)'}`,
        `Assistant text so far: ${payload.assistantTextSoFar || '(none)'}`,
        `Spoken segment at interruption: ${payload.currentSpokenSegment || '(unknown)'}`,
        `User interruption: ${payload.userInterruptionTranscript || '(none)'}`,
        'Interpretation: unknown',
        'Runtime instruction: Treat this as a live voice interruption/follow-up. Do not abort unless the user explicitly cancelled.',
        '[/VOICE INTERRUPTION EVENT]',
      ].join('\n');
    }
  }

  const _mobileThreadSnapshotWriteQueues = new Map();

  function _persistMobileThreadSnapshot(sessionId) {
    const sid = String(sessionId || '').trim();
    const thread = sid ? __pmChat.threads?.[sid] : null;
    if (!sid || !Array.isArray(thread)) return Promise.resolve(false);
    mobileChatRuntimeAdapter.sync(sid, { history: thread, source: 'mobile-persist' });
    const history = _mobileHistoryForServer(thread);
    const previous = _mobileThreadSnapshotWriteQueues.get(sid) || Promise.resolve(true);
    const write = previous.catch(() => false).then(() => updateMobileChatSessionHistory(sid, history)).then(() => true).catch((err) => {
      console.warn('[mobile voice] failed to persist interruption chat state:', err);
      return false;
    });
    _mobileThreadSnapshotWriteQueues.set(sid, write);
    write.finally(() => {
      if (_mobileThreadSnapshotWriteQueues.get(sid) === write) _mobileThreadSnapshotWriteQueues.delete(sid);
    });
    return write;
  }

  function _setMobileSteerContinuationTurn(sourceTurn, continuationTurn) {
    if (!sourceTurn || !continuationTurn) return;
    try {
      Object.defineProperty(sourceTurn, '_steerContinuationTurn', {
        value: continuationTurn,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(continuationTurn, '_steerSourceTurn', {
        value: sourceTurn,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(continuationTurn, '_steerTimerAnchorTurn', {
        value: sourceTurn._steerTimerAnchorTurn || sourceTurn,
        configurable: true,
        writable: true,
      });
    } catch {
      sourceTurn._steerContinuationTurn = continuationTurn;
      continuationTurn._steerSourceTurn = sourceTurn;
      continuationTurn._steerTimerAnchorTurn = sourceTurn._steerTimerAnchorTurn || sourceTurn;
    }
  }

  // Codex AVAS v3 accepts the app-server appendText operation, but not the
  // browser's public input_image event. Analyze the pixels server-side and pass
  // the grounded description into the same live Codex thread. This is also the
  // path used for live camera frames, so the agent receives visual context even
  // when the WebRTC preview itself cannot carry image items.
  async function _sendMobileCodexVisionSummaryToRealtime(dataUrls, opts = {}) {
    const conn = __pmRealtimeAgent.conn;
    if (!_isMobileCodexV3RealtimeConnection(conn) || !conn?.codexBridgeSessionId) return false;
    const urls = (Array.isArray(dataUrls) ? dataUrls : [dataUrls])
      .map((u) => String(u || '').trim())
      .filter((u) => u.startsWith('data:image'));
    if (!urls.length) return false;
    if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return false;
    const summary = String(opts.precomputedSummary || await _summarizeMobileXaiVisionImages(urls, {
      ...opts,
      toast: opts.toast === true,
      reason: opts.reason || 'codex_bridge_camera',
    })).trim();
    if (!summary) return false;
    if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return false;
    const label = String(opts.label || '').trim();
    const isLive = String(opts.reason || '').startsWith('live_camera');
    const text = [
      isLive ? 'Live visual context from the mobile camera.' : 'Visual context from a mobile camera image.',
      label || '',
      'The image was analyzed by Prometheus vision and the grounded description below is the current camera view.',
      'Use it as visual context for the user\'s spoken turn. Do not say you cannot see the image unless this context is missing.',
      `Vision description: ${summary}`,
    ].filter(Boolean).join('\n');
    try {
      if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) return false;
      const result = await mobileGatewayFetch('/api/realtime/codex-bridge/append-text', {
        method: 'POST',
        body: JSON.stringify({ sessionId: conn.codexBridgeSessionId, text }),
      });
      if (typeof opts.isCurrent === 'function' && !opts.isCurrent()) {
        _voiceDebug('realtime-agent-codex-vision-summary-dropped-stale', { isLive, count: urls.length });
        return false;
      }
      if (result?.success === false) throw new Error(result?.error || 'Codex realtime visual context was not accepted.');
      _voiceDebug('realtime-agent-codex-vision-summary-injected', {
        isLive,
        count: urls.length,
        summaryLen: summary.length,
      });
      return true;
    } catch (err) {
      _voiceDebug('realtime-agent-codex-vision-summary-failed', { message: err?.message || String(err) });
      if (opts.toast === true) {
        try { pmToast(`Could not send camera context to voice: ${String(err?.message || err).slice(0, 180)}`, 'error'); } catch {}
      }
      return false;
    }
  }

  function _mobileStreamTargetTurn(aiTurn) {
    return aiTurn?._steerContinuationTurn || aiTurn;
  }

  function _findMobileRecoverableAssistantTurn(thread, clientRequestId) {
    const cid = String(clientRequestId || '').trim();
    if (!cid || !Array.isArray(thread)) return null;
    const matches = thread.filter((turn) => turn?.role === 'ai'
      && String(turn._clientRequestId || '').trim() === cid);
    if (!matches.length) return null;
    const continuation = [...matches].reverse().find((turn) => (
      String(turn.messageKind || '').trim() === 'steer_continuation'
      || String(turn.workflowPart || '').trim() === 'interruption_response'
    ));
    return continuation || [...matches].reverse().find((turn) => turn.streaming === true) || null;
  }

  function _applyVoiceInterruptionToMobileChat(sessionId, result, transcript = '') {
    const sid = String(sessionId || '').trim();
    if (!sid || !result?.classification) return false;
    const thread = __pmChat.threads?.[sid];
    if (!Array.isArray(thread)) return false;
    const eventId = String(result?.eventId || result?.steerEventId || '').trim();
    if (eventId && thread.some((turn) => String(turn?.voiceInterruptionEventId || '') === eventId)) {
      return result?.classification?.shouldAbortOriginalRun === true;
    }
    const classification = result.classification || {};
    const intent = String(classification.intent || 'unknown').trim() || 'unknown';
    const shouldAbort = classification.shouldAbortOriginalRun === true;
    const asSteer = result.steerApplied === true && !shouldAbort;
    const latestAi = _findLatestAssistantTurn(thread);
    const transcriptText = String(transcript || '').trim();
    const workflowGroupId = `${asSteer ? 'chat_steer' : 'voice_workflow'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const eventExtra = {
      eventId,
      runtimeId: result.runtimeId || result.activeRun?.id || '',
      intent,
      shouldAbortOriginalRun: shouldAbort,
      steerApplied: result.steerApplied === true,
      transcript: transcriptText,
    };
    if (latestAi) {
      _appendMobileProcess(
        latestAi,
        shouldAbort ? 'warn' : 'info',
        asSteer
          ? (transcriptText ? `Voice steer: ${transcriptText}` : `Voice steer: ${intent}`)
          : shouldAbor
          ? (transcriptText ? `Voice interruption: ${intent} - ${transcriptText}` : `Voice interruption: ${intent}`)
          : (transcriptText ? `Voice interruption: ${intent} - ${transcriptText}` : `Voice interruption: ${intent}`),
        eventExtra,
      );
      const entries = Array.isArray(latestAi.processEntries) ? latestAi.processEntries.slice() : [];
      if (latestAi.streaming && !shouldAbort) {
        latestAi.streaming = false;
        latestAi.workEndedAt = Number(latestAi.workEndedAt || Date.now()) || Date.now();
        latestAi.workDurationMs = Math.max(0, latestAi.workEndedAt - _mobileAssistantWorkStartedAt(latestAi));
        latestAi.time = _nowTime();
        latestAi.timestamp = Number(latestAi.timestamp || Date.now()) || Date.now();
        latestAi.content = String(latestAi.body?.text || latestAi.content || '');
      }
      if (entries.length) {
        thread.push({
          role: 'ai',
          time: _nowTime(),
          timestamp: Date.now(),
          body: { sender: 'Prometheus', text: 'Tool stream continued below.' },
          content: 'Tool stream continued below.',
          processEntries: entries,
          workflowGroupId,
          workflowPart: 'before_interruption',
          workflowLabel: asSteer ? 'Tool stream before steer' : 'Tool stream before interruption',
          voiceInterruptionEventId: eventId || undefined,
        });
      }
    }
    thread.push({
      role: 'user',
      time: _nowTime(),
      timestamp: Date.now(),
      body: { text: transcriptText || '(voice interruption)', source: asSteer ? 'voice_steer' : 'voice_interruption' },
      content: transcriptText || '(voice interruption)',
      workflowGroupId,
      workflowPart: 'interruption',
      workflowLabel: asSteer ? 'Steer' : `Interruption: ${intent}`,
      voiceInterruptionEventId: eventId || undefined,
    });
    const reply = String(result?.voiceReply || '').trim();
    if (reply) {
      thread.push({
        role: 'ai',
        time: _nowTime(),
        timestamp: Date.now(),
        body: { sender: 'Prometheus', text: reply },
        content: reply,
        source: 'voice_agent',
        processEntries: _voiceAgentProcessEntriesFromResult(sid, result),
        workflowGroupId,
        workflowPart: shouldAbort ? 'abort_response' : 'interruption_response',
        workflowLabel: shouldAbort ? 'Abort response' : 'Interruption response',
        voiceInterruptionEventId: eventId || undefined,
      });
    }
    if (latestAi && !shouldAbort) {
      const continuationTurn = {
        role: 'ai',
        messageKind: 'steer_continuation',
        time: '',
        timestamp: Date.now(),
        streaming: true,
        workStartedAt: Date.now(),
        body: { sender: 'Prometheus', text: '' },
        content: '',
        processEntries: [],
        liveTraceEntries: [],
        _clientRequestId: latestAi._clientRequestId || result?.clientRequestId || '',
        workflowGroupId,
        workflowPart: 'interruption_response',
        workflowLabel: asSteer ? 'Response after steer' : 'Interruption response',
        voiceInterruptionEventId: eventId || undefined,
      };
      thread.push(continuationTurn);
      _setMobileSteerContinuationTurn(latestAi, continuationTurn);
    }
    if (!shouldAbort) {
      _persistMobileThreadSnapshot(sid);
      return false;
    }

    const runtimeId = String(result.runtimeId || result.activeRun?.id || __pmChat.activeRuns?.[sid]?.runtimeId || _readMobileActiveRun(sid)?.runtimeId || '').trim();
    stopMobileMainChat(sid, { runtimeId, source: 'mobile_voice_interruption' }).catch((err) => {
      if (latestAi) {
        _appendMobileProcess(latestAi, 'error', `Backend abort request failed: ${err?.message || err}`, eventExtra);
      }
    });

    const localAbort = __pmChat.activeRuns?.[sid]?.abort;
    if (localAbort && typeof localAbort.abort === 'function') {
      if (latestAi) {
        _appendMobileProcess(latestAi, 'warn', 'Voice interruption requested worker abort. Backend stop requested; closing the local stream.', eventExtra);
      }
      localAbort.abort();
    } else if (__pmVoice.activeVoiceRuntime?.sessionId === sid) {
      __pmVoice.activeVoiceRuntime.isStreamActive = false;
    }

    if (!latestAi || !latestAi.streaming) {
      _clearMobileActiveRun(sid);
      _markMobileSessionRunning(sid, false);
      _persistMobileThreadSnapshot(sid);
      return false;
    }
    _appendMobileProcess(latestAi, 'warn', 'Voice interruption requested worker abort. Process log preserved.', eventExtra);
    const streamed = String(latestAi.body?.text || latestAi.content || '').trim();
    latestAi.streaming = false;
    latestAi.time = _nowTime();
    latestAi.timestamp = Number(latestAi.timestamp || Date.now()) || Date.now();
    latestAi.body = latestAi.body || { sender: 'Prometheus', text: '' };
    latestAi.body.text = streamed
      ? `[Stopped by user]\n\n${streamed}`
      : '[Stopped by user]\n\nVoice interruption stopped the active Prometheus worker. Process log preserved.';
    latestAi.content = latestAi.body.text;
    _clearMobileActiveRun(sid);
    _markMobileSessionRunning(sid, false);
    _persistMobileThreadSnapshot(sid);
    return true;
  }

  async function _trySubmitVoiceAsLiveSteer(sessionId, transcript = '') {
    const sid = String(sessionId || '').trim();
    const text = String(transcript || '').trim();
    if (!sid || !text) return false;
    const activeVoice = __pmVoice.activeVoiceRuntime || null;
    const voiceRuntimeActive = !!(
      activeVoice
      && activeVoice.isStreamActive === true
      && String(activeVoice.sessionId || '').trim() === sid
    );
    const chatRunActive = !!(__pmChat.activeRuns?.[sid]?.busy || __pmChat.activeRuns?.[__pmChat.activeSessionId]?.busy);
    let gatewayActive = false;
    if (!voiceRuntimeActive && !chatRunActive) {
      const status = await loadMobileChatRunStatus(sid).catch(() => null);
      gatewayActive = status?.active === true;
    }
    if (!voiceRuntimeActive && !chatRunActive && !gatewayActive) return false;

    try {
      _voiceSetStatus('Routing voice', 'Prometheus voice is checking the current worker');
      const contextPacket = _getMobileVoiceWorkerContextPacketForTurn(sid, { source: 'mobile_voice_live_steer', originalUserPrompt: text });
      const wakePhrase = _cleanMobileWakePhrase(__pmVoice.settings?.wakePhrase || '');
      const requestPayload = {
        sessionId: sid,
        voiceTarget: _mobileVoiceTargetPayload(),
        transcript: text,
        userInterruptionTranscript: text,
        source: 'mobile_voice_live_steer',
        voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
        realtimeAgent: _isMobileRealtimeAgentMode(),
        clientRequestId: String(activeVoice?.activeRequestId || ''),
        voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice.settings?.wakeGateActive === true } : undefined,
        deviceTime: _mobileVoiceDeviceTimeContext(),
        ...(contextPacket ? { contextPacket } : {}),
      };
      let result = null;
      let streamingDispatcher = _createMobileVoiceStreamingDispatcher();
      try {
        result = await streamVoiceAgentInputMobile(requestPayload, (chunk) => {
          try { streamingDispatcher?.enqueue?.(chunk); } catch {}
        });
      } catch (streamErr) {
        _voiceDebug('voice-agent-steer-stream-failed', { sessionId: sid, message: streamErr?.message || String(streamErr) });
        streamingDispatcher = null;
        result = await mobileGatewayFetch('/api/voice-agent/input', {
          method: 'POST',
          body: JSON.stringify(requestPayload),
        });
      }
      if (!result?.success && !result?.ok) return false;
      _applyVoiceRuntimeDirectives(result, { deferAfterReply: true });
      const voiceProcessEntries = _voiceAgentProcessEntriesFromResult(sid, result);
      _applyVoiceInterruptionToMobileChat(sid, result, text);
      if (voiceProcessEntries.length) {
        const thread = __pmChat.threads?.[sid];
        const latestAi = Array.isArray(thread) ? _findLatestAssistantTurn(thread) : null;
        if (latestAi) {
          latestAi.processEntries = Array.isArray(latestAi.processEntries) ? latestAi.processEntries : [];
          latestAi.processEntries.push(...voiceProcessEntries);
        }
      }
      const reply = String(result?.voiceReply || '').trim();
      const alreadySpoken = !!result?.streamedSpeech && !!streamingDispatcher;
      try {
        if (reply && !alreadySpoken) await _ttsSpeak(reply);
        else if (alreadySpoken) await streamingDispatcher.wait();
      } finally {
        _applyPendingVoiceRuntimeDirectivesAfterReply();
      }
      const action = String(result?.action || result?.decision?.action || '').trim();
      const confirmed = !!(result?.steerApplied || action === 'steer_worker' || action === 'interrupt_worker');
      if (confirmed) _flashVoiceOrbConfirmed();
      else _setOrbState(null);
      const statusTitle = action === 'interrupt_worker' ? 'Stopped' : result?.steerApplied ? 'Steer sent' : 'Answered';
      _voiceSetStatus(statusTitle, reply || 'Voice agent handled the interruption');
      pmToast(action === 'interrupt_worker' ? 'Voice stop confirmed' : result?.steerApplied ? 'Voice steer sent' : 'Voice answered', 'success');
      return true;
    } catch (err) {
      if (Number(err?.status) === 409) return false;
      const thread = __pmChat.threads?.[sid];
      const latestAi = Array.isArray(thread) ? _findLatestAssistantTurn(thread) : null;
      if (latestAi) _appendMobileProcess(latestAi, 'error', `Voice steer failed: ${err?.message || err}`);
      pmToast(`Voice steer failed: ${err?.message || err}`, 'error');
      return false;
    }
  }

  async function _prepareVoiceAgentHandoff(sessionId, transcript = '', options = {}) {
    const sid = String(sessionId || '').trim();
    const text = String(transcript || '').trim();
    if (!sid || !text) return { shouldContinueToWorker: true, result: null };
    try {
      const handoffStartedAt = Date.now();
      _voiceSetStatus('Routing voice', 'Prometheus voice is preparing a reply');
      const contextPacket = _getMobileVoiceWorkerContextPacketForTurn(sid, { source: 'mobile_voice_handoff', originalUserPrompt: text });
      const wakePhrase = _cleanMobileWakePhrase(__pmVoice.settings?.wakePhrase || '');
      const requestPayload = {
        sessionId: sid,
        voiceTarget: _mobileVoiceTargetPayload(),
        transcript: text,
        userInterruptionTranscript: text,
        source: 'mobile_voice_handoff',
        voiceMode: String(__pmVoice.settings?.voiceMode || 'default'),
        realtimeAgent: _isMobileRealtimeAgentMode(),
        voiceRuntime: wakePhrase ? { wakePhrase, wakeGateActive: __pmVoice.settings?.wakeGateActive === true } : undefined,
        deviceTime: _mobileVoiceDeviceTimeContext(),
        ...(contextPacket ? { contextPacket } : {}),
      };
      // Try SSE streaming first: pipe each sentence into TTS as the model generates it.
      let result = null;
      let streamingDispatcher = _createMobileVoiceStreamingDispatcher();
      let firstChunkLogged = false;
      try {
        result = await streamVoiceAgentInputMobile(requestPayload, (chunk) => {
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            _voiceDebug('voice-agent-first-chunk', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt });
          }
          try { streamingDispatcher?.enqueue?.(chunk); } catch {}
        });
      } catch (streamErr) {
        _voiceDebug('voice-agent-stream-failed', { sessionId: sid, message: streamErr?.message || String(streamErr) });
        streamingDispatcher = null;
        result = await mobileGatewayFetch('/api/voice-agent/input', {
          method: 'POST',
          body: JSON.stringify(requestPayload),
        });
      }
      if (!result?.success && !result?.ok) return { shouldContinueToWorker: true, result: null };
      // The server may have rotated a voice-first new chat off the throwaway
      // 'mobile_default' draft slot to a real mobile_<id> session so it lists in
      // the drawer. Adopt that id locally so the open conversation, drawer entry,
      // and downstream worker dispatch all point at the same durable session.
      let workSid = sid;
      const resolvedSid = String(result?.resolvedSessionId || '').trim();
      if (resolvedSid && resolvedSid !== sid) {
        try {
          if (Array.isArray(__pmChat.threads?.[sid]) && !Array.isArray(__pmChat.threads?.[resolvedSid])) {
            __pmChat.threads[resolvedSid] = __pmChat.threads[sid];
          }
          if (Array.isArray(__pmChat.attachments?.[sid]) && !Array.isArray(__pmChat.attachments?.[resolvedSid])) {
            __pmChat.attachments[resolvedSid] = __pmChat.attachments[sid];
          }
          if (sid === MOBILE_CHAT_SESSION_ID) {
            __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
            __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
          }
          if (String(__pmChat.activeSessionId || '').trim() === sid) {
            __pmChat.activeSessionId = resolvedSid;
            __pmChat.thread = __pmChat.threads[resolvedSid];
          }
          if (String(__pmVoice.targetSessionId || '').trim() === sid || !__pmVoice.targetSessionId) {
            __pmVoice.targetSessionId = resolvedSid;
            __pmVoice.targetSessionLabel = 'Mobile - Chat';
            __pmVoice.targetSessionChannel = 'mobile';
            __pmVoice.targetSessionForced = true;
            _paintVoiceTarget?.();
          }
          invalidateMobileDrawerSessions('mobile');
          refreshMobileDrawerSessions({ force: true, channel: 'mobile' }).catch(() => {});
          _notifyMobileChatVoiceUpdate?.(resolvedSid, { reason: 'voice_session_rotated', force: true });
          workSid = resolvedSid;
          _voiceDebug('voice-agent-session-rotated', { from: sid, to: resolvedSid });
        } catch (rotateErr) {
          _voiceDebug('voice-agent-session-rotate-failed', { from: sid, to: resolvedSid, message: rotateErr?.message || String(rotateErr) });
        }
      }
      const alreadySpoken = !!result?.streamedSpeech && !!streamingDispatcher;
      _applyVoiceRuntimeDirectives(result, { deferAfterReply: true });
      _voiceDebug('voice-agent-endpoint', {
        sessionId: sid,
        action: result?.action || '',
        elapsedMs: Date.now() - handoffStartedAt,
        timings: result?.timings || null,
      });
      const reply = String(result?.voiceReply || '').trim();
      const responseArtifacts = Array.isArray(result?.richArtifacts)
        ? result.richArtifacts
        : Array.isArray(result?.decision?.richArtifacts) ? result.decision.richArtifacts : [];
      if (responseArtifacts.length && typeof __pmRealtimeAgent.enqueueArtifacts === 'function') {
        __pmRealtimeAgent.enqueueArtifacts(responseArtifacts);
      }
      const voiceProcessEntries = _voiceAgentProcessEntriesFromResult(sid, result);
      if (result?.action === 'handoff_new_work') {
        if (reply) {
          if (!__pmChat.threads[workSid]) __pmChat.threads[workSid] = [];
          const thread = __pmChat.threads[workSid];
          const eventId = String(result?.eventId || result?.steerEventId || '').trim();
          const alreadyHasAck = thread.some((turn) => (
            turn?.role === 'ai'
            && String(turn?.content || turn?.body?.text || '').trim() === reply
            && (!eventId || String(turn?.voiceInterruptionEventId || '') === eventId)
          ));
          if (!alreadyHasAck) {
            thread.push({
              role: 'ai',
              time: _nowTime(),
              timestamp: Date.now(),
              body: { sender: 'Prometheus', text: reply },
              content: reply,
              source: 'voice_agent',
              richArtifacts: responseArtifacts.length ? responseArtifacts : undefined,
              processEntries: voiceProcessEntries,
              voiceInterruptionEventId: eventId || undefined,
            });
            _persistMobileThreadSnapshot(workSid);
            _renderRecent();
          }
        }
        if (reply && !alreadySpoken) {
          _voiceDebug('ack-tts-started', { sessionId: workSid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: true });
          _ttsSpeak(reply)
            .then(() => _voiceDebug('ack-tts-dispatched', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: true }))
            .catch((err) => _voiceDebug('ack-tts-error', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, message: err?.message || String(err) }))
            .finally(() => _applyPendingVoiceRuntimeDirectivesAfterReply());
        } else if (alreadySpoken) {
          streamingDispatcher.wait().finally(() => _applyPendingVoiceRuntimeDirectivesAfterReply());
        } else {
          _applyPendingVoiceRuntimeDirectivesAfterReply();
        }
        _voiceDebug('worker-handoff-released', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt });
        return { shouldContinueToWorker: true, result };
      }
      if (reply && !alreadySpoken) {
        _voiceDebug('ack-tts-started', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: false });
        try {
          await _ttsSpeak(reply);
        } finally {
          _voiceDebug('ack-tts-completed', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt, nonBlocking: false });
          _applyPendingVoiceRuntimeDirectivesAfterReply();
        }
      } else if (alreadySpoken) {
        await streamingDispatcher.wait();
        _voiceDebug('streamed-tts-completed', { sessionId: sid, elapsedMs: Date.now() - handoffStartedAt });
        _applyPendingVoiceRuntimeDirectivesAfterReply();
      } else {
        _applyPendingVoiceRuntimeDirectivesAfterReply();
      }
      if (result?.steerApplied === true || result?.action === 'steer_worker') {
        _applyVoiceInterruptionToMobileChat(sid, result, text);
        _voiceSetStatus('Steer sent', reply || 'Prometheus will fold it into the active run');
        return { shouldContinueToWorker: false, result };
      }
      if (result?.action === 'answer_now' || result?.action === 'no_reply' || result?.action === 'interrupt_worker') {
        if (reply) {
          if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
          const thread = __pmChat.threads[sid];
          thread.push({ role: 'user', time: _nowTime(), body: { text, source: 'voice' } });
          thread.push({
            role: 'ai',
            time: _nowTime(),
            body: { sender: 'Prometheus', text: reply },
            content: reply,
            source: 'voice_agent',
            richArtifacts: responseArtifacts.length ? responseArtifacts : undefined,
            processEntries: voiceProcessEntries,
          });
          _persistMobileThreadSnapshot(sid);
        }
        _voiceSetStatus('Answered', reply || 'Voice handled that');
        return { shouldContinueToWorker: false, result };
      }
      return { shouldContinueToWorker: true, result };
    } catch (err) {
      console.warn('[voice] voice-agent handoff failed', err);
      return { shouldContinueToWorker: true, result: null };
    }
  }

  function _startVoiceAgentNarrationLoop(sessionId, requestId, options = {}) {
    const sid = String(sessionId || '').trim();
    const rid = String(requestId || '').trim();
    const useRealtimeAgent = options?.realtimeAgent === true;
    if (!sid || !rid) return () => {};
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight || __pmVoice.dictation !== 'milestone') return;
      if (__pmVoice.activeVoiceRuntime?.activeRequestId !== rid) return;
      inFlight = true;
      try {
        if (useRealtimeAgent) {
          await _refreshMobileRealtimeAgentWorkerContext('narration_tick', { requestNarration: true });
          return;
        }
        const result = await mobileGatewayFetch('/api/voice-agent/narrate', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: sid,
            minGapMs: 5500,
            source: 'mobile_voice_narration',
          }),
        });
        const reply = String(result?.voiceReply || '').trim();
        if ((result?.action === 'reply' || reply) && reply) _speakVoiceMilestone(reply, { minGapMs: 4500 });
      } catch (err) {
        console.warn('[voice] narration tick failed', err);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(tick, 5600);
    setTimeout(tick, 1700);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  function _makeRecognizer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    return rec;
  }

  function _canUseBrowserRecognition() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function _voiceChannelLabel(channel) {
    const key = String(channel || '').trim().toLowerCase();
    if (key === 'terminal') return 'CLI';
    if (key === 'telegram') return 'Telegram';
    if (key === 'mobile') return 'Mobile';
    if (key === 'discord') return 'Discord';
    if (key === 'whatsapp') return 'WhatsApp';
    if (key === 'web') return 'Web';
    return key ? key[0].toUpperCase() + key.slice(1) : 'Chat';
  }

  function _voiceShortSessionLabel(session) {
    if (!session) return 'Latest chat';
    const title = String(session.title || session.preview || '').trim();
    const channel = _voiceChannelLabel(session.channel);
    return title ? `${channel} - ${title}` : `${channel} - ${session.id}`;
  }

  function _voiceTargetLabel(target = null) {
    const kind = String(target?.kind || '').trim();
    if (kind === 'subagent') return String(target.label || target.name || 'Subagent').trim() || 'Subagent';
    return String(__pmVoice?.targetSessionLabel || target?.label || 'Latest chat').trim() || 'Latest chat';
  }

  function _voiceMainAgentSvg() {
    return `<svg viewBox="0 0 96 96" width="72" height="72" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="pm-main-agent-glow" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="var(--pm-voice-orb-hot, #ffd8a8)"/>
          <stop offset="44%" stop-color="var(--pm-voice-orb-accent, #ea6a1f)"/>
          <stop offset="100%" stop-color="var(--pm-voice-orb-deep, #8f3b16)"/>
        </radialGradient>
        <linearGradient id="pm-main-agent-line" x1="0" x2="1">
          <stop offset="0%" stop-color="var(--pm-voice-orb-accent, #ea6a1f)" stop-opacity=".1"/>
          <stop offset="48%" stop-color="#fff2d2"/>
          <stop offset="100%" stop-color="var(--pm-voice-orb-accent, #ea6a1f)" stop-opacity=".1"/>
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="34" fill="url(#pm-main-agent-glow)" opacity=".92"/>
      <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,188,118,.25)" stroke-width="1.5"/>
      <path d="M12 50 C24 50 25 40 36 40 C46 40 43 62 52 62 C62 62 59 35 69 35 C77 35 75 51 84 51" fill="none" stroke="url(#pm-main-agent-line)" stroke-width="4" stroke-linecap="round"/>
      <circle cx="31" cy="25" r="2" fill="#fff8df" opacity=".8"/>
      <circle cx="72" cy="67" r="2.2" fill="#fff8df" opacity=".72"/>
      <circle cx="23" cy="70" r="1.8" fill="#fff8df" opacity=".86"/>
    </svg>`;
  }

  function _renderVoiceAgentTargetPickerHtml() {
    return `
      <div class="pm-voice-target-card" id="pm-voice-target-card" hidden aria-label="Choose voice target">
        <div class="pm-voice-target-grid" id="pm-voice-target-grid">
          <button type="button" class="pm-voice-target-character" data-voice-target-kind="main" aria-label="Main Agent" title="Main Agent">
            <span class="pm-voice-target-avatar pm-main-agent-avatar">${_voiceMainAgentSvg()}</span>
          </button>
        </div>
        <div class="pm-voice-target-actions">
          <button type="button" class="pm-voice-room-btn" id="pm-voice-room-toggle">Room</button>
        </div>
      </div>
      <button type="button" class="pm-voice-room-attach-btn" id="pm-voice-room-attach" aria-label="Attach files, photos, or open camera" hidden>${ICONS.paperclip}</button>
      <input id="pm-voice-room-file-input" class="pm-voice-room-file-input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip" hidden tabindex="-1" aria-hidden="true" />
      <input id="pm-voice-room-photo-input" class="pm-voice-room-file-input" type="file" multiple accept="image/*" hidden tabindex="-1" aria-hidden="true" />
      <div class="pm-attach-sheet pm-voice-attach-sheet" id="pm-voice-attach-sheet" hidden>
        <div class="pm-attach-sheet-scrim" id="pm-voice-attach-sheet-scrim"></div>
        <section class="pm-attach-sheet-panel" aria-label="Attach">
          <button type="button" class="pm-attach-sheet-action" data-pm-voice-attach-action="files">
            <span>${ICONS.paperclip}</span><strong>Files</strong>
          </button>
          <button type="button" class="pm-attach-sheet-action" data-pm-voice-attach-action="photos">
            <span>${ICONS.image}</span><strong>Photos</strong>
          </button>
          <button type="button" class="pm-attach-sheet-action" data-pm-voice-attach-action="camera">
            <span>${ICONS.image}</span><strong>Camera</strong>
          </button>
        </section>
      </div>
      <div class="pm-camera-capture pm-voice-camera-capture" id="pm-voice-camera-capture" hidden>
        <video class="pm-camera-video" id="pm-voice-camera-video" autoplay muted playsinline></video>
        <div class="pm-camera-status" id="pm-voice-camera-status">Opening camera...</div>
        <div class="pm-camera-topbar">
          <button type="button" class="pm-camera-icon" id="pm-voice-camera-close" aria-label="Close camera">&times;</button>
          <button type="button" class="pm-camera-icon" id="pm-voice-camera-flip" aria-label="Flip camera">${ICONS.refresh}</button>
        </div>
        <div class="pm-camera-controls">
          <button type="button" class="pm-camera-shutter pm-camera-wave-shutter voice-realtime" id="pm-voice-camera-shutter" aria-label="Take picture">
            <span class="pm-camera-wave-ambient" aria-hidden="true"></span>
            <span class="pm-camera-wave-line" aria-hidden="true"></span>
            <span class="pm-camera-strands-orb-canvas" aria-hidden="true"></span>
            <span class="pm-camera-glass-glint" aria-hidden="true"></span>
            <span class="pm-camera-voice-fallback" aria-hidden="true"></span>
            <span class="pm-camera-record-core" aria-hidden="true"></span>
          </button>
          <div class="pm-camera-more-wrap">
            <div class="pm-camera-more-menu" id="pm-camera-more-menu" role="group" aria-label="Camera options" hidden>
              <button type="button" class="pm-camera-icon pm-camera-more-action" id="pm-camera-flash" aria-label="Toggle flash" aria-pressed="false">${ICONS.flash}</button>
              <button type="button" class="pm-camera-icon pm-camera-more-action" id="pm-camera-flip" aria-label="Flip camera">${ICONS.refresh}</button>
            </div>
            <button type="button" class="pm-camera-icon pm-camera-more" id="pm-camera-more" aria-label="Camera options" aria-expanded="false">
              <span class="pm-camera-more-dots" aria-hidden="true">${ICONS.dots}</span>
              <span class="pm-camera-more-close" aria-hidden="true">${ICONS.x}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }


  const runtime = Object.freeze({
    _isMobileCodexAvasRealtime,
    _mobileRealtimeVoiceOptions,
    _mobileRealtimeDefaultVoice,
    _mobileRealtimeVoice,
    _voicePresetForProviders,
    _inputProviderForMode,
    _outputProviderForMode,
    _loadVoiceSettings,
    _saveVoiceSettings,
    _mobileRealtimeListenModeFromSettings,
    _mobileRealtimeProviderKeyFromSettings,
    _mobileRealtimeTurnDetectionForListenMode,
    _mobileRealtimeProviderLabel,
    _isMobileCodexV3RealtimeConnection,
    _sendMobileRealtimeAgentSessionUpdateFromSettings,
    _updateRealtimeSpeechConnectionFromSettings,
    _restartMobileRealtimeAgentForSettings,
    _mobileRealtimeBootstrapSupersededError,
    _isMobileRealtimeBootstrapSupersededError,
    _applyVoiceSettingsLive,
    _mobileVoiceDefaultProviderFromStatus,
    _applyMobileVoiceProviderDefaults,
    _normalizeMobileWakePhrase,
    _cleanMobileWakePhrase,
    _stripMobileWakeCommandPunctuation,
    _parseMobileWakePhraseSettingCommand,
    _isMobileQuietModeCommand,
    _isMobileWakeUnlockCommand,
    _applyVoiceRuntimeDirective,
    _applyVoiceRuntimeDirectives,
    _applyPendingVoiceRuntimeDirectivesAfterReply,
    _getCachedMobileVoiceWorkerContextPacket,
    _prefetchMobileVoiceWorkerContextPacket,
    _prewarmMobileVoiceWorkerContext,
    _prewarmMobileCodexRealtimeBridge,
    _getMobileVoiceWorkerContextPacketForTurn,
    _voiceRoomNormalizeText,
    _voiceRoomParticipantKey,
    _voiceRoomParticipantLabel,
    _voiceRoomUniqueAliases,
    _voiceMainRoomParticipant,
    _voiceSubagentRoomParticipant,
    _normalizeVoiceRoomState,
    _loadVoiceRoomState,
    _saveVoiceRoomState,
    _isVoiceRoomEnabled,
    _voiceRoomActiveParticipant,
    _voiceRoomCurrentTargetKey,
    _exitMobileVoiceRoomForFreshChat,
    _voiceRoomRememberTranscript,
    _resolveDurableMobileVoiceRoom,
    _loadDurableMobileVoiceRoom,
    _mobileVoiceRoomContextPayload,
    _mobileVoiceRoomTranscriptBlock,
    _mobileVoiceRoomHandoffContextText,
    _voiceRoomSetFocus,
    _voiceRoomQuietState,
    _voiceRoomSetQuiet,
    _voiceRoomClearQuiet,
    _voiceRoomAliasPatterns,
    _voiceRoomSpeechWords,
    _voiceRoomStartsWithWords,
    _voiceRoomOnlyLeadingFillers,
    _voiceRoomConversationalAddressPrefix,
    _voiceRoomHasUnmatchedAddressCue,
    _voiceRoomMatchAddress,
    _mobileVoiceRoomCodexInstructions,
    _voiceRoomParseQuietCommand,
    _voiceRoomRouteDedupeKey,
    _voiceRoomSeenRecently,
    _voiceRoomRememberRoute,
    _applyMobileVoiceTarget,
    _refreshMobileRealtimeAgentRoomTarget,
    _sendMobileRealtimeRoomTextToTarget,
    _voiceRoomAddressOnlyHandoffText,
    _appendMobileCodexVoiceRoomText,
    _silenceMobileVoiceRoomOutput,
    _armMobileVoiceRoomHandoffAckGuard,
    _releaseMobileVoiceRoomHandoffAckGuard,
    _mobileVoiceRoomWarmPool,
    _mobileVoiceRoomParticipantSessionId,
    _isHealthyMobileVoiceRoomConnection,
    _mobileVoiceRoomParkedAudio,
    _parkMobileCodexVoiceRoomConnection,
    _promoteMobileCodexVoiceRoomConnection,
    _closeMobileCodexVoiceRoomConnection,
    _clearMobileCodexVoiceRoomWarmPool,
    _scheduleMobileCodexVoiceRoomPrewarm,
    _recordMobileVoiceRoomHandoffUserTranscript,
    _consumeMobileVoiceRoomHandoffEcho,
    _handoffMobileCodexVoiceRoomTarget,
    _voiceRoomParticipantFromHandoffToolArgs,
    _executeMobileVoiceRoomHandoffTool,
    _routeMobileVoiceRoomTranscript,
    _hasMobileVoiceWarmMic,
    _requestMobileVoiceMicFromGesture,
    _voiceSetStatus,
    _setMobileVoiceStatus,
    _voiceStatusPreviewText,
    _voiceReadyHintGlobal,
    _voiceSetStatusTone,
    _voiceScrollLiveTranscriptToEnd,
    _isMobileInlineChatVoiceActive,
    _mobileRealtimeCurrentStagedAttachmentTurn,
    _renderMobileRealtimeUserTranscriptInChat,
    _findMobileRealtimeUserDraft,
    _promoteMobileRealtimeUserDraft,
    _voiceShowRealtimeUserTranscript,
    _voiceRenderHighlightedStatus,
    _voiceShowRealtimeAgentMessage,
    _voiceShowReadyStatus,
    _setMobileVoiceLyricProgress,
    _mobileRealtimeAudioPlaybackMs,
    _mobileRealtimeRawTranscriptDelta,
    _appendMobileRealtimeTranscriptDelta,
    _mergeMobileRealtimeTranscriptSnapshot,
    _setMobileVoicePlaybackLyricProgress,
    _mobileVoiceToolKey,
    _mobileVoiceToolsAreActive,
    _setMobileVoiceToolActive,
    _pulseMobileVoiceOrb,
    _setOrbState,
    _mobileMediaKey,
    _diffMobileMedia,
    _visionEventToMobileMedia,
    _flashVoiceOrbConfirmed,
    _installMobileCameraPinchZoom,
    _detectProvider,
    _serverVoiceFallback,
    _isRealtimeConnected,
    _loadServerVoiceCatalog,
    _voiceProviderSummary,
    _cleanVoiceSpeechText,
    _normalizeVoiceEchoText,
    _isLikelyMobileVoiceSelfEcho,
    _voiceSpokenMilestone,
    _speakVoiceMilestone,
    _voiceToolTargetLabel,
    _voiceLiveToolStatus,
    _speakVoiceLiveStatus,
    _appendMobileCodexBridgeRealtimeSpeech,
    _speakMobileRealtimeAgentMilestone,
    _isMobileVoiceStatusQuestion,
    _hasMobileVoiceWorkIntent,
    _isMobileVoiceDirectAnswerOnlyTurn,
    _isSubagentVoiceDirectAnswerOnlyTurn,
    _isBenignRealtimeCancelError,
    _isNoActiveRealtimeCancelError,
    _isBenignRealtimeParseError,
    _blobToBase64,
    _isIosSafariBrowser,
    _getRecorderMimeType,
    _audioExtensionForMimeType,
    _gatewayJsonHeaders,
    _gatewayAuthHeaders,
    _voiceDebug,
    _extractRealtimeClientSecret,
    _isUsableRealtimeOfferSdp,
    _localRealtimeOfferSdp,
    _realtimeSdpPostBody,
    _waitForLocalRealtimeOfferSdp,
    _exchangeRealtimeSdpViaGateway,
    _exchangeRealtimeSdpDirect,
    _playAudioBase64,
    _playAudioBytesWithContext,
    _markVoiceSpeakingStart,
    _markVoiceSpeakingEnd,
    _getServerAudioElement,
    _playHtmlAudioElement,
    _ensureVoiceAudioKeepalive,
    _playAudioUrl,
    _unlockVoiceAudio,
    _speakWithRealtimeVoice,
    _ensureRealtimeSpeechConnection,
    _closeRealtimeSpeechConnection,
    _configuredServerTtsProviders,
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
    _createMobileVoiceStreamingDispatcher,
    _ttsSpeak,
    _ttsStop,
    _claimSubagentVoiceReplyOnce,
    _deliverSubagentVoiceReplyOnce,
    _captureVoicePlaybackInterrupt,
    _consumeVoicePlaybackInterruptContext,
    _finalizeVoiceInterruptionForTranscript,
    _persistMobileThreadSnapshot,
    _setMobileSteerContinuationTurn,
    _sendMobileCodexVisionSummaryToRealtime,
    _mobileStreamTargetTurn,
    _findMobileRecoverableAssistantTurn,
    _applyVoiceInterruptionToMobileChat,
    _trySubmitVoiceAsLiveSteer,
    _prepareVoiceAgentHandoff,
    _startVoiceAgentNarrationLoop,
    _makeRecognizer,
    _canUseBrowserRecognition,
    _voiceChannelLabel,
    _voiceShortSessionLabel,
    _voiceTargetLabel,
    _voiceMainAgentSvg,
    _renderVoiceAgentTargetPickerHtml,
  });
  try {
    if (context?.window) context.window.__pmMobileVoiceRuntime = runtime;
  } catch {}
  return runtime;
}
