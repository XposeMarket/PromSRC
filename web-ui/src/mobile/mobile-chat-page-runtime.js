/**
 * Owns the mobile chat route renderer and its route-local orchestration.
 *
 * The page module supplies a lazy context snapshot so this extracted route
 * retains live access to the page's shared mobile services and caches.
 */
export function createMobileChatPageRenderer(resolveContext = () => ({})) {
  return async function renderChatPage(page, { navigate, sessionId = null, voiceRoomTranscript = false }) {
    let {
      ICONS,
      isMobileChatPinned,
      toggleMobileChatPin,
      MOBILE_CHAT_SESSION_ID,
      MOBILE_GATEWAY_STATUS,
      PM_CHAT_VOICE_ICON_SRC,
      PM_MOBILE_BROWSE_CACHE_TTL_MS,
      PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE,
      PM_MOBILE_MAX_QUEUED_PROMPTS,
      __pmChat,
      __pmRealtimeAgent,
      __pmVoice,
      _ackMobileAbort,
      _activeMobileThread,
      _adoptMobileActiveRunState,
      _appendMobileCompactionTrace,
      _appendMobileLiveTrace,
      _appendMobileProcess,
      _appendMobileUserProcess,
      _appendMobileVisionTrace,
      _appendMobileVisualStreamToken,
      _applyMobileBackgroundSpawnStatus,
      _applyMobileMainPlanProgress,
      _applyMobileToolActivity,
      _applyVoiceInterruptionToMobileChat,
      _attachMobilePromptVariantsToUserMessage,
      _attachVoiceAgentProcessEntriesToMobileTurn,
      _awaitMobileRealtimeCameraOperation,
      _buildMobileFileContextNote,
      _buildMobileSideChatBoundaryMessage,
      _cleanVoiceSpeechText,
      _clearMobileActiveRun,
      _clearMobileBackgroundSpawnDockForSession,
      _clearMobileDraftSessionState,
      _clearMobileLiveRunForSession,
      _clearMobileToolProgress,
      _clearMobileVisualStreamTimer,
      _clearRecoveredMobileChatError,
      _cloneMobileMessageForBranch,
      _closeMobileSources,
      _closeMobileTraceThoughts,
      _coalesceMobileChatError,
      _collectMediaFromToolEvent,
      _commitMobileTranscriptCache,
      _completeMobileBackgroundSpawnLane,
      _dedupeMobileUserTurns,
      _ensureDurableMobileVoiceSession,
      _ensureMobilePromptVariantsForEdit,
      _ensureMobileQuestionController,
      _exitMobileVoiceRoomForFreshChat,
      _filterMobileProcessEntriesForActiveRun,
      _findLatestAssistantTurn,
      _findMobileCompletedTurn,
      _findMobileExpectedAbortTurn,
      _findMobileRecoverableAssistantTurn,
      _findMobileVoiceWorkerHandoffByText,
      _finishMobileVisualStreamText,
      _flushMobilePendingThinkingBurst,
      _flushMobileRealtimeAgentPendingImages,
      _flushMobileTraceThoughtProbe,
      _flushThreadRender,
      _formatBytes,
      _generateMobileSideChatId,
      _getMobileEmptyChatStarterCards,
      _getMobilePromptVariantActiveIndex,
      _getMobileQueuedPrompts,
      _getMobileSideChatLinksForParent,
      _getPendingQuestionForSession,
      _handleMobileCleanThought,
      _handleMobileEmailComposerAction,
      _handleMobileReasoningSummaryDelta,
      _handleMobileThinkingDelta,
      _hydrateMobileBackgroundSpawnLane,
      _installMobileApprovalBridge,
      _installMobileCameraPinchZoom,
      _installMobileTimestampReveal,
      _isIosSafariBrowser,
      _isMobileAssistantMessage,
      _isMobileChatSessionVisibleToUser,
      _isMobileGoalStartAcknowledgementText,
      _isMobileHiddenTranscriptMessage,
      _isMobileRealtimeAgentMode,
      _isMobileReasoningSummaryTraceEntry,
      _isMobileRuntimeAbortEvent,
      _isMobileTransientReasoningTraceEntry,
      _isMobileUserVisibleReasoningTraceEntry,
      _isMobileVoiceAgentWorkerHandoff,
      _loadDurableMobileVoiceRoom,
      _loadMobileEmptyChatBrainCards,
      _loadMobileSideChatLinks,
      _loadMobileSources,
      _loadMobileThreadCache,
      _makeMobileQueuedPrompt,
      _makeMobileSideChatTitle,
      _makeMobileUserMessage,
      _mapServerHistoryToMobile,
      _markMobileSessionRunning,
      _maybeFlushMobileThinkingBeforeEvent,
      _mergeMobileFileChangesWithBackground,
      _mergeMobileLatestAssistantBackgroundFileChanges,
      _mergeMobileLiveTraceIntoProcess,
      _mergeMobileMediaIntoMessage,
      _mergeMobileProcessEntries,
      _mergeMobileProductCarouselIntoMessage,
      _mergeMobileRichArtifacts,
      _mergeMobileSessionThreadWithLocal,
      _mergeMobileUserTurnDetails,
      _mergeMobileWorkflowTraceFromProcessEntries,
      _mobileAssistantHasVisibleAnswer,
      _mobileAssistantWorkStartedAt,
      _mobileBackgroundSpawnId,
      _mobileBackgroundSpawnIdFromSessionId,
      _mobileBackgroundSpawnLanes,
      _mobileBackgroundSpawnWorkRecord,
      _mobileChatRendererInvoke,
      _mobileChatScrollSnapshot,
      _mobileChatScrollTarget,
      _mobileHistoryForServer,
      _mobileHistoryHasCompletedTurnSince,
      _mobileHistoryHasProtectedLocalContinuity,
      _mobileHistoryPageIsPartial,
      _mobileMediaKind,
      _mobileMediaUrl,
      _mobileMessageCopyText,
      _mobileQuestionRememberDraft,
      _mobileRealtimeAgentDisableAlwaysListening,
      _mobileRealtimeProviderLabel,
      _mobileSideThreadNearBottom,
      _mobileStreamTargetTurn,
      _mobileTimelineEntries,
      _mobileToolLabel,
      _mobileToolResultLabel,
      _mobileUserTurnsRepresentSameSend,
      _moveMobileWorkflowBubbleBeforeTool,
      _newMobileClientRequestId,
      _normalizeMobileFile,
      _normalizeMobileProcessEntry,
      _normalizeMobileQuestion,
      _normalizeMobileRecoveredTraceEntry,
      _nowTime,
      _openMobileSources,
      _outputProviderForMode,
      _patchLatestMobileStreamingMessage,
      _patchMobileThreadMessage,
      _persistMobileThreadSnapshot,
      _pmClearActiveSlashCommand,
      _pmClearSelectedComposerSkills,
      _pmClearSkillExclusions,
      _pmEnsureSkillTriggerCacheLoaded,
      _pmGetComposerValue,
      _pmGetExcludedSkillIds,
      _pmHandleSlashInput,
      _pmHideSkillTriggerPill,
      _pmHideSlashPopover,
      _pmNormalizeSelectedComposerSkillRefs,
      _pmNormalizeSelectedSkillIds,
      _pmRefreshSlashChrome,
      _pmRenderSkillTriggerPill,
      _pmRenderSlashPopover,
      _pmReplaceSkillComposerWithSelection,
      _pmSelectSlashCommand,
      _pmShowSkillReferencePopover,
      _pmSkillCacheReady,
      setPmSkillCacheReady,
      _pmSkillComposerState,
      _pmSkillComposerSuggestions,
      _pmSlashCommandSuggestions,
      _pmUpdateComposerRichPreview,
      _pushMobileBackgroundSpawnEvent,
      _pushMobileStreamProcessEntry,
      _readMobileActiveRun,
      _readMobileLastChatContext,
      _readMobileLastChatSession,
      _reconcileMobileBackgroundAgentSideThread,
      _reconcileMobilePendingApprovals,
      _recordMobileChatError,
      _recoverMobileBackgroundSpawnDock,
      _refreshMobileChatPushButton,
      _reindexMobileThread,
      _rememberMobileActiveRun,
      _rememberMobileCompletedAssistantTurn,
      _rememberMobileLastChatSession,
      _rememberMobileSessionGoal,
      _renderChatAttachmentPreviews,
      _renderChatMessageHtml,
      _renderMobileAgentChatBubble,
      _renderMobileBackgroundSpawnDock,
      _renderMobileGoalPill,
      _renderMobileMainPlanDock,
      _renderMobileQueuedPromptsPanel,
      _renderMobileToolProgressDock,
      _renderThread,
      _requestMobileVoiceMicFromGesture,
      _restoreMobileChatScroll,
      _restoreMobileVoiceWorkgroupsForSession,
      _safeJsonPreview,
      _sanitizeMobileAttachmentPreviewForServer,
      _saveActiveMobilePromptVariant,
      _saveMobileLastChatContext,
      _saveMobileSideChatLinks,
      _saveMobileThreadCache,
      _scheduleMobileStreamingPatch,
      _scheduleMobileThreadCacheSave,
      _scheduleThreadRender,
      _scrollChat,
      _sendMobileRealtimeAgentCameraSnapshot,
      _sendMobileRealtimeAgentCreateResponseFlag,
      _setMobileLiveProgressNarration,
      _setMobileRealtimeCameraRuntime,
      _setMobileToolProgress,
      _settleMobileChatSteerWorkflow,
      _shouldRouteMobileTokenToLiveTrace,
      _stageMobileRealtimeAgentImage,
      _startMobileNewChat,
      _startMobileRealtimeLiveCameraVision,
      _stopMobileRealtimeAgentContextRefreshLoop,
      _stopMobileRealtimeLiveCameraVision,
      _stripMobileInternalUploadContext,
      _submitMobileQuestionFromComposer,
      _summarizeMobileXaiVisionImages,
      _syncMobileWorkTimer,
      _toggleMobileChatPushNotifications,
      _ttsSpeak,
      _ttsStop,
      _unlockVoiceAudio,
      _uploadMobileChatAttachments,
      _upsertMobilePendingApproval,
      _upsertMobileQuestion,
      _voiceDebug,
      _wireMobileChatEnhancements,
      _wireMobileProcessRunActions,
      applyMobileDraftModelRouteToSession,
      applyToolActivityEvent,
      attachMobileButtonHaptic,
      attachMobileResource,
      beginFinalResponse,
      bindMobileSessionTarget,
      captureKeyedScrollState,
      createMobileChatSession,
      createMobileChatSessionId,
      createMobileProject,
      createMobileProjectChatSession,
      detachMobileResource,
      ensureMobileChatStyles,
      escapeHtml,
      getActiveGatewayId,
      getGateway,
      getMobileSessionTarget,
      getPairingPayload,
      invalidateMobileChatSessionCache,
      invalidateMobileDrawerSessions,
      isCurrentGateway,
      loadGatewayCatalog,
      loadGatewayStatus,
      loadMobileBackgroundStatus,
      loadMobileBackgroundStatuses,
      loadMobileBackgroundStreamReplay,
      loadMobileChatRendererRuntime,
      loadMobileChatRunStatus,
      loadMobileChatSession,
      loadMobileChatStreamReplay,
      loadMobileCommandModels,
      loadMobileQuestions,
      loadMobileStopTargets,
      loadMobileWorkspaceFiles,
      loadToolActivityFeature,
      markMobileChatSessionRead,
      markMobileEditRerunReset,
      markMobileLifecycle,
      mergeSlashCommandSkillIds,
      mobileChatRendererRuntime,
      mobileChatRuntimeAdapter,
      mobileGatewayFetch,
      mobileSourceState,
      mobileStreamRenderScheduler,
      mobileTimelineController,
      notifyMobileModelChanged,
      onGatewayCatalogChanged,
      parseTargetNamespacedId,
      persistBackgroundAgentWork,
      pmActiveSlashCommand,
      setPmActiveSlashCommand,
      pmHaptic,
      pmMobileBrowseCache,
      pmSelectedComposerSkillIds,
      pmSelectedComposerSkills,
      pmSkillComposerSelectionIndex,
      setPmSkillComposerSelectionIndex,
      pmSlashCommandSelectionIndex,
      setPmSlashCommandSelectionIndex,
      pmToast,
      presentChatError,
      probeGateway,
      receipts,
      setReceipts,
      reconcileMobileChatTurn,
      renderMobileContextChip,
      renderMobileHeader,
      renderVoicePage,
      requestMobileUpdate,
      resolveMobileSessionGateway,
      restartMobileGateway,
      runMobileScreenshotCommand,
      saveMobileCurrentBrowserPage,
      sendMobileBackgroundSteer,
      setActiveGatewayId,
      setInnerHTMLPreservingVisuals,
      setMobileActiveGatewayTarget,
      setPendingGatewayPair,
      stopMobileMainChat,
      stopMobileRuntime,
      streamChat,
      targetNamespacedId,
      updateMobileChatSessionHistory,
      wireHeaderActions,
      wireMobileContextWindow,
      wsEventBus,
    } = resolveContext() || {};
  // A prior render can still have an in-flight history request when the route
  // is remounted (especially after an iOS refresh/bfcache transition). The
  // session id alone is not an ownership check: an old response for the same
  // chat must not repaint the current page with its stale snapshot.
  const mobilePageInstanceToken = `mobile_page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let mobilePageDisposed = false;
  __pmChat.mobilePageInstanceToken = mobilePageInstanceToken;
  await loadMobileChatRendererRuntime();
  receipts = mobileChatRendererRuntime.createMobileStreamReceiptLedger();
  setReceipts(receipts);
  await _ensureMobileQuestionController();
  ensureMobileChatStyles();
  _installMobileApprovalBridge();
  // Chat recovery needs the same tool/result renderer as live streaming. Kick
  // off the optional chunk before history hydration so the first recovered
  // paint normally arrives already coalesced; the ready bridge above handles
  // the remaining cold-cache race.
  void loadToolActivityFeature().catch(() => {});
  // Composer picker state belongs to the mounted page. Resetting the active
  // slash command prevents a prior route's command chip from suppressing the
  // first `$` skill picker on the next mobile chat.
  pmActiveSlashCommand = null;
  setPmActiveSlashCommand(pmActiveSlashCommand);
  pmSlashCommandSelectionIndex = 0;
  setPmSlashCommandSelectionIndex(pmSlashCommandSelectionIndex);
  pmSkillComposerSelectionIndex = 0;
  setPmSkillComposerSelectionIndex(pmSkillComposerSelectionIndex);
  // A bare mobile chat route reopens the last explicitly opened chat. The New
  // Chat button clears that remembered id, so only that action lands on the
  // unsaved mobile_default draft with starter cards.
  const rememberedSession = sessionId ? '' : _readMobileLastChatSession();
  const rememberedChatContext = _readMobileLastChatContext();
  const routedSession = String(sessionId || rememberedSession || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  const routedTarget = parseTargetNamespacedId(routedSession);
  let requestedSession = String(routedTarget?.targetId || routedSession).trim() || MOBILE_CHAT_SESSION_ID;
  const boundTarget = getMobileSessionTarget(requestedSession);
  const currentGateway = loadGatewayCatalog().find((entry) => isCurrentGateway(entry));
  const preferredGatewayId = requestedSession === MOBILE_CHAT_SESSION_ID
    ? (currentGateway?.gatewayId || rememberedChatContext.gatewayId || getActiveGatewayId())
    : (rememberedChatContext.gatewayId || currentGateway?.gatewayId || getActiveGatewayId());
  const gatewayTarget = resolveMobileSessionGateway(requestedSession, {
    // A fresh chat belongs to this PWA's gateway. Remembered context is still
    // preferred for an existing session so a reload does not silently move a
    // remote chat onto the phone's current gateway after a restart.
    pendingGatewayId: routedTarget?.gatewayId
      || boundTarget?.gatewayId
      || preferredGatewayId,
    fallbackToCurrentGateway: requestedSession !== MOBILE_CHAT_SESSION_ID && !routedTarget?.gatewayId,
  });
  if (routedTarget?.gatewayId && requestedSession !== MOBILE_CHAT_SESSION_ID) {
    bindMobileSessionTarget(requestedSession, routedTarget.gatewayId, { started: true });
  } else if (requestedSession !== MOBILE_CHAT_SESSION_ID && gatewayTarget?.gatewayId && !boundTarget?.gatewayId) {
    bindMobileSessionTarget(requestedSession, gatewayTarget.gatewayId, { started: true });
  }
  setMobileActiveGatewayTarget(gatewayTarget);
  try {
    window.__pmMobileComposerPlaceholder = requestedSession === MOBILE_CHAT_SESSION_ID
      ? 'Send Prometheus a message'
      : `Work on ${gatewayTarget?.name || 'this computer'}`;
  } catch {}
  try { window.__pmMobileActiveSessionGateway = gatewayTarget?.gatewayId || ''; } catch {}
  // A gateway paired before direct execution was enabled can still have a
  // cached read-only descriptor in localStorage. Refresh remote capability
  // metadata before the first history request; otherwise the loader rejects
  // the chat before the send path gets a chance to probe the target.
  const gatewayExecutionRefresh = gatewayTarget
    && !isCurrentGateway(gatewayTarget)
    && gatewayTarget.execution?.enabled !== true
    ? probeGateway(gatewayTarget).then((freshGateway) => {
      if (freshGateway) {
        setMobileActiveGatewayTarget(freshGateway);
        try { window.__pmMobileActiveSessionGateway = freshGateway.gatewayId || ''; } catch {}
      }
      return freshGateway;
    }).catch(() => gatewayTarget)
    : Promise.resolve(gatewayTarget);
  const isVoiceRoomTranscript = voiceRoomTranscript === true && requestedSession.startsWith('voice_room_');
  const isCurrentMobilePage = () => !mobilePageDisposed
    && __pmChat.mobilePageInstanceToken === mobilePageInstanceToken
    && __pmChat.activeSessionId === requestedSession;
  if (requestedSession !== MOBILE_CHAT_SESSION_ID) _rememberMobileLastChatSession(requestedSession);
  __pmChat.activeSessionId = requestedSession;
  if (requestedSession === MOBILE_CHAT_SESSION_ID) {
    _clearMobileDraftSessionState();
  }
  if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
  _activeMobileThread();
  const releaseActiveChatRuntime = mobileChatRuntimeAdapter.mount(requestedSession);

  // These values are used by the initial new-chat template below. Keep their
  // declarations before page.innerHTML is evaluated; otherwise the template
  // touches targetProjectLabel while its let binding is still in the TDZ.
  let pendingGatewayId = gatewayTarget?.gatewayId || getActiveGatewayId();
  let targetProjectId = String(rememberedChatContext.projectId || '').trim();
  let targetProjectLabel = String(rememberedChatContext.projectName || '').trim();
  let targetWorkspaceLabel = gatewayTarget?.workspaceName || '';
  let targetPopover = null;
  let closeTargetPopover = () => {};

  function syncContextDockToComposer() {
    if (!contextDock || !form) return;
    const rect = form.getBoundingClientRect?.();
    if (!rect || !rect.height) return;
    const keyboardOpen = _pmKbApp?.classList?.contains('pm-keyboard-open')
      || document.body?.classList?.contains('pm-keyboard-open');
    if (!keyboardOpen) {
      // Anchor to the composer's actual screen position. iOS can leave the
      // resolved `bottom` value at the keyboard offset for several frames
      // after dismissal, which previously let the dock slide behind it.
      const layoutHeight = Math.max(
        Number(window.innerHeight || 0),
        Number(document.documentElement?.clientHeight || 0),
      );
      if (layoutHeight) {
        contextDock.style.setProperty(
          '--pm-context-dock-bottom',
          `${Math.max(8, Math.round(layoutHeight - Number(rect.top || 0) + 8))}px`,
        );
        return;
      }
    }
    const viewport = window.visualViewport;
    const viewportBottom = Number(viewport?.offsetTop || 0)
      + Number(viewport?.height || window.innerHeight || 0);
    if (!viewportBottom) return;
    const bottom = Math.max(8, Math.round(viewportBottom - Number(rect.top || 0) + 8));
    contextDock.style.setProperty('--pm-context-dock-bottom', `${bottom}px`);
  }

  function reanchorContextDockAfterLayout() {
    [0, 80, 180, 360, 700].forEach((delay) => {
      window.setTimeout(() => requestAnimationFrame(() => syncContextDockToComposer()), delay);
    });
  }

  const closeMenu = () => {
    const pop = document.getElementById('pm-chat-settings-popover');
    const overlay = document.getElementById('pm-chat-settings-popover-overlay');
    if (overlay) overlay.remove();
    if (pop) pop.remove();
  };

  const openSettingsMenu = () => {
    const existingPop = document.getElementById('pm-chat-settings-popover');
    const existingOverlay = document.getElementById('pm-chat-settings-popover-overlay');
    if (existingPop) existingPop.remove();
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.id = 'pm-chat-settings-popover-overlay';
    overlay.className = 'pm-chat-settings-popover-overlay';
    overlay.addEventListener('click', () => closeMenu(), { passive: true });
    overlay.addEventListener('touchstart', () => closeMenu(), { passive: true });

    const pop = document.createElement('div');
    pop.id = 'pm-chat-settings-popover';
    pop.className = 'pm-chat-settings-popover';
    pop.setAttribute('aria-label', 'Chat settings menu');
    const activeChatSessionId = String(window.__pmChat?.activeSessionId || '').trim();
    const activeChatPinned = activeChatSessionId ? isMobileChatPinned(activeChatSessionId) : false;
    pop.innerHTML = `
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-notifications" type="button" data-action="notifications" aria-pressed="false"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.bell}</span><span class="pm-chat-settings-menu-label">Notifications</span><span class="pm-chat-settings-menu-status" id="pm-chat-settings-notifications-status" aria-hidden="true" hidden>${ICONS.check}</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-pin" type="button" data-action="pin" aria-pressed="${activeChatPinned ? 'true' : 'false'}"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.pin}</span><span class="pm-chat-settings-menu-label">${activeChatPinned ? 'Unpin from top' : 'Pin to top'}</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-files" type="button" data-action="files"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.doc}</span><span class="pm-chat-settings-menu-label">Files</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-resources" type="button" data-action="resources"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.layers}</span><span class="pm-chat-settings-menu-label">Resources</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-permissions" type="button" data-action="permissions"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.shield}</span><span class="pm-chat-settings-menu-label">Permissions</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-connections" type="button" data-action="connections"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.monitor}</span><span class="pm-chat-settings-menu-label">Connections</span></button>
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-open" type="button" data-action="settings"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.gear}</span><span class="pm-chat-settings-menu-label">Settings</span></button>
    `;

    const openSettings = (tab = '') => {
      closeMenu();
      const target = tab ? `#mobile/settings/${encodeURIComponent(tab)}` : '#mobile/settings';
      if (typeof page.openSettings === 'function' && !tab) page.openSettings();
      else if (typeof window.pmOpenSettings === 'function') {
        const opened = window.pmOpenSettings(tab || undefined);
        if (!opened) navigate?.(target);
      }
      else if (typeof window.openSettings === 'function') window.openSettings(tab || undefined);
      else navigate?.(target);
    };

    pop.querySelector('#pm-chat-settings-permissions')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => openSettings('security'));
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-open')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => openSettings());
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-connections')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => navigate?.('#mobile/gateways'));
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-notifications')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => {
        _toggleMobileChatPushNotifications().catch(() => {});
      });
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-pin')?.addEventListener('click', async () => {
      if (!activeChatSessionId) {
        closeMenu();
        pmToast('No active chat to pin', 'error');
        return;
      }
      const pinButton = pop.querySelector('#pm-chat-settings-pin');
      if (pinButton) pinButton.disabled = true;
      try {
        const nowPinned = await toggleMobileChatPin(activeChatSessionId);
        closeMenu();
        invalidateMobileDrawerSessions();
        refreshMobileDrawerSessions({ force: true }).catch(() => {});
        pmToast(nowPinned ? 'Chat pinned to top' : 'Chat unpinned', 'success');
      } catch (err) {
        if (pinButton) pinButton.disabled = false;
        pmToast(err?.message || 'Could not update pin', 'error');
      }
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-files')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => {
        handleBrowseCommand('').catch((err) => pmToast(err?.message || String(err || 'Could not open files'), 'error'));
      });
    }, { passive: true });

    pop.querySelector('#pm-chat-settings-resources')?.addEventListener('click', () => {
      closeMenu();
      requestAnimationFrame(() => _openMobileSources(page, { history: false }));
    }, { passive: true });

    document.body.appendChild(overlay);
    document.body.appendChild(pop);
    _refreshMobileChatPushButton().catch(() => {});
    _prefetchBrowseRoot().catch(() => {});
  };

  const header = renderMobileHeader({
    title: requestedSession === MOBILE_CHAT_SESSION_ID ? 'New Chat' : 'Chat',
    online: true,
    hideTitle: true,
    hideBrand: true,
    rightActions: `<button class="pm-icon-btn" data-action="new-chat" aria-label="New chat">${ICONS.compose}</button>`,
  });
  page.innerHTML = `
    ${header}
    ${renderMobileContextChip()}
    <div class="pm-body pm-chat-body" id="pm-chat-body">
      <div class="pm-chat-thread" id="pm-chat-thread"></div>
    </div>
    <button type="button" class="pm-scroll-latest" id="pm-scroll-latest" hidden aria-label="Jump to latest message">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5 12 15l5.5-5.5" /></svg>
    </button>
    <div class="pm-mobile-queued-prompts" id="pm-mobile-queued-prompts" hidden></div>
    <div class="pm-tool-progress-dock" id="pm-tool-progress-dock" hidden aria-live="polite"></div>
    <div class="pm-mobile-runtime-pills" id="pm-mobile-runtime-pills">
      <div class="pm-main-plan-dock" id="pm-main-plan-dock" hidden></div>
      <div class="pm-background-spawn-dock" id="pm-background-spawn-dock" hidden></div>
      <div class="pm-mobile-goal-strip" id="pm-mobile-goal-strip" hidden></div>
    </div>
    <div id="pm-mobile-sources-popover" class="pm-mobile-sources-popover" hidden role="dialog" aria-modal="true" aria-label="Chat Sources">
      <button type="button" id="pm-mobile-sources-scrim" class="pm-mobile-sources-popover-scrim" aria-label="Close Sources"></button>
      <section class="pm-mobile-sources-panel">
        <div class="pm-mobile-sources-header"><div><strong>Sources <span id="pm-mobile-sources-count"></span></strong><div id="pm-mobile-sources-mode">Attached to this chat</div></div><button type="button" id="pm-mobile-sources-close" class="pm-mobile-sources-close" aria-label="Close Sources">×</button></div>
        <div class="pm-mobile-sources-toolbar"><button type="button" id="pm-mobile-sources-save" class="pm-mobile-source-toolbar-btn">Save current page</button><button type="button" id="pm-mobile-sources-history" class="pm-mobile-source-toolbar-btn">Browser history</button><button type="button" id="pm-mobile-sources-attached" class="pm-mobile-source-toolbar-btn">Attached</button></div>
        <input id="pm-mobile-sources-search" class="pm-mobile-sources-search" type="search" placeholder="Search Sources" aria-label="Search Sources">
        <div id="pm-mobile-sources-list" class="pm-mobile-sources-list"><div class="pm-mobile-sources-empty">Sources stay online and load selectively when needed.</div></div>
      </section>
    </div>
    ${requestedSession === MOBILE_CHAT_SESSION_ID ? `
      <div class="pm-new-chat-context-dock" id="pm-new-chat-context-dock" aria-label="New chat direction">
        <button type="button" class="pm-new-chat-context-row" id="pm-chat-target-chip" aria-label="Current gateway target" aria-expanded="false">
          <span class="pm-new-chat-context-icon" aria-hidden="true">${ICONS.monitor}</span>
          <span class="pm-new-chat-context-value"><strong>${escapeHtml(gatewayTarget?.name || 'Gateway unavailable')}</strong></span>
          <span class="pm-new-chat-context-chevron" aria-hidden="true">${ICONS.chev}</span>
        </button>
        <button type="button" class="pm-new-chat-context-row" id="pm-new-chat-project" aria-label="Current directed chat" aria-expanded="false">
          <span class="pm-new-chat-context-icon" aria-hidden="true">${ICONS.folder}</span>
          <span class="pm-new-chat-context-value"><strong>${escapeHtml(targetProjectLabel || 'Chat')}</strong><small>Directed chat</small></span>
          <span class="pm-new-chat-context-chevron" aria-hidden="true">${ICONS.chev}</span>
        </button>
      </div>
    ` : ''}
    <div class="pm-chat-connection-status" id="pm-chat-connection-status" hidden aria-live="polite">
      <span class="pm-chat-connection-spinner" aria-hidden="true"></span>
      <span class="pm-chat-connection-text">Reconnecting to Prometheus</span>
    </div>
    ${isVoiceRoomTranscript ? `
      <div class="pm-voice-room-transcript-toolbar">
        <span>${ICONS.micSmall} Voice Room is still listening</span>
        <button type="button" id="pm-voice-room-return" aria-label="Return to Voice Room">Return to voice</button>
      </div>
    ` : ''}
    ${!isVoiceRoomTranscript ? `
      <div class="pm-chat-mode-launcher" id="pm-chat-mode-launcher" role="group" aria-label="Choose chat input">
        <button type="button" class="pm-chat-mode-button pm-chat-mode-button--voice" data-pm-chat-mode="voice" id="pm-chat-mode-voice" aria-label="Start voice mode">
          ${ICONS.micSmall}<span class="pm-chat-mode-button-label">Voice mode</span>
        </button>
        <button type="button" class="pm-chat-mode-button pm-chat-mode-button--keyboard" data-pm-chat-mode="keyboard" id="pm-chat-mode-keyboard" aria-label="Open keyboard composer">
          ${ICONS.keyboard}<span class="pm-chat-mode-button-label">Keyboard composer</span>
        </button>
      </div>
    ` : ''}
    <form class="pm-composer${isVoiceRoomTranscript ? ' pm-voice-room-transcript-composer' : ''}${!isVoiceRoomTranscript ? ' pm-composer-mode-hidden' : ''}" id="pm-composer" aria-hidden="true" inert>
      <span class="pm-glass-lens" aria-hidden="true"></span>
      <span class="pm-glass-border" aria-hidden="true"></span>
      <div class="pm-mobile-question-popover" id="pm-mobile-question-popover" hidden></div>
      <div class="pm-chat-slash-popover" id="pm-chat-slash-popover" hidden></div>
      <div class="pm-skill-trigger-pill" id="pm-skill-trigger-pill" hidden aria-live="polite"></div>
      <div class="pm-attach-tray" id="pm-attach-tray" hidden></div>
      <button type="button" class="pm-command-chip" id="pm-chat-command-chip" hidden aria-label="Clear slash command">
        <span class="pm-command-chip-token"></span>
        <span class="pm-command-chip-clear" aria-hidden="true">&times;</span>
      </button>
      <div class="pm-composer-row">
        <button type="button" class="pm-icon-btn pm-attach-native-btn" id="pm-attach-btn" aria-label="Attach files">
          ${ICONS.paperclip}
        </button>
        <input id="pm-file-input" class="pm-native-file-input" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.txt,.md,.json,.csv,.tsv,.log,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,application/pdf" />
        <input id="pm-photo-input" class="pm-native-file-input" type="file" multiple accept="image/*" />
        <div class="pm-composer-input-wrap" id="pm-composer-input-wrap">
          <div class="pm-composer-rich-preview" id="pm-composer-rich-preview" aria-hidden="true" hidden></div>
          <textarea class="pm-composer-input" id="pm-composer-input" rows="1" placeholder="${escapeHtml(requestedSession === MOBILE_CHAT_SESSION_ID ? 'Send Prometheus a message' : `Work on ${gatewayTarget?.name || 'this computer'}`)}" aria-label="Message" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter"></textarea>
        </div>
        <button type="button" class="pm-icon-btn" id="pm-chat-mic-btn" aria-label="Voice input">${ICONS.micSmall}</button>
        <button type="submit" class="pm-send" id="pm-send-btn" aria-label="Send">${ICONS.send}</button>
      </div>
      <div class="pm-chat-voice-shell" id="pm-chat-voice-shell" hidden>
        <button type="button" class="pm-chat-voice-camera" id="pm-chat-voice-camera" aria-label="Attach realtime camera or photos">${ICONS.paperclip}</button>
        <button type="button" class="pm-chat-voice-close" id="pm-chat-voice-close" aria-label="Exit voice mode">&times;</button>
        <div class="pm-chat-voice-inline" id="pm-chat-voice-inline" hidden></div>
      </div>
    </form>
    <div class="pm-attach-sheet" id="pm-attach-sheet" hidden>
      <div class="pm-attach-sheet-scrim" id="pm-attach-sheet-scrim"></div>
      <section class="pm-attach-sheet-panel" aria-label="Attach">
        <button type="button" class="pm-attach-sheet-action" data-pm-attach-action="files-photos">
          <span>${ICONS.paperclip}</span>
          <strong>Files / Photos</strong>
        </button>
        <button type="button" class="pm-attach-sheet-action" data-pm-attach-action="camera">
          <span>${ICONS.image}</span>
          <strong>Camera</strong>
        </button>
      </section>
    </div>
    <div class="pm-camera-capture" id="pm-camera-capture" hidden>
      <video class="pm-camera-video" id="pm-camera-video" autoplay muted playsinline></video>
      <div class="pm-camera-status" id="pm-camera-status">Opening camera...</div>
      <div class="pm-camera-record-timer" id="pm-camera-record-timer" hidden>0.0s</div>
      <div class="pm-camera-controls">
        <button type="button" class="pm-camera-icon pm-camera-close" id="pm-camera-close" aria-label="Close camera">${ICONS.x}</button>
        <button type="button" class="pm-camera-shutter pm-camera-wave-shutter" id="pm-camera-shutter" aria-label="Capture image">
          <span class="pm-camera-wave-ambient" aria-hidden="true"></span>
          <span class="pm-camera-wave-line" aria-hidden="true"></span>
          <canvas class="pm-camera-strands-orb-canvas" id="pm-camera-strands-orb-canvas" aria-hidden="true"></canvas>
          <span class="pm-camera-glass-glint" aria-hidden="true"></span>
          <span class="pm-camera-shutter-icon" aria-hidden="true"></span>
          <span class="pm-camera-voice-fallback" aria-hidden="true"></span>
          <span class="pm-camera-record-core" aria-hidden="true"></span>
        </button>
        <div class="pm-camera-more-wrap">
          <div class="pm-camera-more-menu" id="pm-camera-more-menu" role="group" aria-label="Camera options" hidden>
            <button type="button" class="pm-camera-icon pm-camera-more-action" id="pm-camera-flash" aria-label="Toggle flash" aria-pressed="false">${ICONS.flash}</button>
            <button type="button" class="pm-camera-icon pm-camera-more-action" id="pm-camera-flip" aria-label="Flip camera">${ICONS.refresh}</button>
            <button type="button" class="pm-camera-more-pair-action" id="pm-camera-pair-scan">Scan pairing QR</button>
          </div>
          <button type="button" class="pm-camera-icon pm-camera-more" id="pm-camera-more" aria-label="Camera options" aria-expanded="false">
            <span class="pm-camera-more-dots" aria-hidden="true">${ICONS.dots}</span>
            <span class="pm-camera-more-close" aria-hidden="true">${ICONS.x}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="pm-mobile-side-sheet" id="pm-mobile-side-sheet" role="dialog" aria-modal="true" aria-label="Side chat" aria-hidden="true" inert>
      <div class="pm-mobile-side-scrim" id="pm-mobile-side-scrim"></div>
      <section class="pm-mobile-side-panel" id="pm-mobile-side-panel">
        <div class="pm-mobile-side-handle" id="pm-mobile-side-handle"></div>
        <header class="pm-mobile-side-header">
          <button type="button" class="pm-mobile-side-close" id="pm-mobile-side-close" aria-label="Close side chat">&times;</button>
          <div class="pm-mobile-side-title-wrap">
            <strong id="pm-mobile-side-title">Side Chat</strong>
            <span id="pm-mobile-side-subtitle">Prometheus · Mobile</span>
          </div>
        </header>
        <div class="pm-mobile-side-thread" id="pm-mobile-side-thread"></div>
        <form class="pm-composer pm-mobile-side-composer" id="pm-mobile-side-composer">
          <span class="pm-glass-lens" aria-hidden="true"></span>
          <span class="pm-glass-border" aria-hidden="true"></span>
          <div class="pm-attach-tray" id="pm-mobile-side-attach-tray" hidden></div>
          <div class="pm-composer-row">
            <button type="button" class="pm-icon-btn" id="pm-mobile-side-attach" aria-label="Attach files">${ICONS.paperclip}</button>
            <div class="pm-composer-input-wrap" id="pm-mobile-side-input-wrap">
              <textarea class="pm-composer-input" id="pm-mobile-side-input" rows="1" placeholder="Follow up" aria-label="Side chat message" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"></textarea>
            </div>
            <button type="button" class="pm-icon-btn" id="pm-mobile-side-mic" aria-label="Voice input">${ICONS.micSmall}</button>
            <button type="submit" class="pm-send" id="pm-mobile-side-send" aria-label="Send side chat">${ICONS.send}</button>
          </div>
        </form>
      </section>
    </div>
  `;
  wireHeaderActions(page, {
    onSettings: openSettingsMenu,
    onNewChat: () => _startMobileNewChat(navigate),
  });
  const sourcesSearch = page.querySelector('#pm-mobile-sources-search');
  page.querySelector('#pm-mobile-sources-close')?.addEventListener('click', () => _closeMobileSources(page));
  page.querySelector('#pm-mobile-sources-scrim')?.addEventListener('click', () => _closeMobileSources(page));
  page.querySelector('#pm-mobile-sources-save')?.addEventListener('click', async () => {
    try {
      await saveMobileCurrentBrowserPage(requestedSession, requestedSession);
      pmToast('Saved current Browser page to Sources', 'success');
      await _loadMobileSources(page, { sessionId: requestedSession, history: false });
    } catch (error) {
      pmToast(error?.message || 'Could not save current Browser page', 'error');
    }
  });
  page.querySelector('#pm-mobile-sources-history')?.addEventListener('click', () => _loadMobileSources(page, { sessionId: requestedSession, history: true }));
  page.querySelector('#pm-mobile-sources-attached')?.addEventListener('click', () => _loadMobileSources(page, { sessionId: requestedSession, history: false }));
  sourcesSearch?.addEventListener('input', () => {
    const timer = Number(sourcesSearch.dataset.searchTimer || 0);
    if (timer) clearTimeout(timer);
    sourcesSearch.dataset.searchTimer = String(setTimeout(() => {
      _loadMobileSources(page, { sessionId: requestedSession, history: mobileSourceState.history, query: sourcesSearch.value });
    }, 250));
  });
  page.querySelector('#pm-mobile-sources-list')?.addEventListener('click', async (event) => {
    const backgroundWorkButton = event.target?.closest?.('[data-mobile-background-work]');
    const attachButton = event.target?.closest?.('[data-mobile-source-attach]');
    const detachButton = event.target?.closest?.('[data-mobile-source-detach]');
    if (backgroundWorkButton) {
      event.preventDefault();
      _closeMobileSources(page);
      openMobileBackgroundAgentDetail(backgroundWorkButton.getAttribute('data-mobile-background-work') || '');
      return;
    }
    try {
      if (attachButton) {
        const id = attachButton.getAttribute('data-mobile-source-attach') || '';
        const source = mobileSourceState.resources.find((resource) => resource.id === id);
        const url = String(source?.locator?.url || '').trim();
        if (!url) return;
        await attachMobileResource(requestedSession, { url, title: source.title, origin: 'browser_save', pinned: true });
        await _loadMobileSources(page, { sessionId: requestedSession, history: false });
      } else if (detachButton) {
        await detachMobileResource(requestedSession, detachButton.getAttribute('data-mobile-source-detach') || '');
        await _loadMobileSources(page, { sessionId: requestedSession, history: false });
      }
    } catch (error) {
      pmToast(error?.message || 'Source operation failed', 'error');
    }
  });
  wireMobileContextWindow(page, { getSessionId: () => __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID });
  setTimeout(() => { _prefetchBrowseRoot().catch(() => {}); }, 300);

  const body     = page.querySelector('#pm-chat-body');
  const threadEl = page.querySelector('#pm-chat-thread');
  const scrollLatestBtn = page.querySelector('#pm-scroll-latest');
  const form     = page.querySelector('#pm-composer');
  const questionHost = page.querySelector('#pm-mobile-question-popover');
  const connectionStatus = page.querySelector('#pm-chat-connection-status');
  const toolProgressDock = page.querySelector('#pm-tool-progress-dock');
  const mainPlanDock = page.querySelector('#pm-main-plan-dock');
  const backgroundSpawnDock = page.querySelector('#pm-background-spawn-dock');
  const goalStrip = page.querySelector('#pm-mobile-goal-strip');
  const input    = page.querySelector('#pm-composer-input');
  const sendBtn  = page.querySelector('#pm-send-btn');
  const attachBtn = page.querySelector('#pm-attach-btn');
  const targetChip = page.querySelector('#pm-chat-target-chip');
  const projectChip = page.querySelector('#pm-new-chat-project');
  const contextDock = page.querySelector('#pm-new-chat-context-dock');
  const micBtn = page.querySelector('#pm-chat-mic-btn');
  const modeLauncher = page.querySelector('#pm-chat-mode-launcher');
  const modeVoiceButton = page.querySelector('#pm-chat-mode-voice');
  const modeKeyboardButton = page.querySelector('#pm-chat-mode-keyboard');
  const chatVoiceShell = page.querySelector('#pm-chat-voice-shell');
  const chatVoiceClose = page.querySelector('#pm-chat-voice-close');
  const chatVoiceCamera = page.querySelector('#pm-chat-voice-camera');
  const chatVoiceHost = page.querySelector('#pm-chat-voice-inline');
  const fileInput = page.querySelector('#pm-file-input');
  const photoInput = page.querySelector('#pm-photo-input');
  const attachTray = page.querySelector('#pm-attach-tray');
  const attachSheet = page.querySelector('#pm-attach-sheet');
  const attachSheetScrim = page.querySelector('#pm-attach-sheet-scrim');
  const cameraCapture = page.querySelector('#pm-camera-capture');
  const cameraVideo = page.querySelector('#pm-camera-video');
  const cameraStatus = page.querySelector('#pm-camera-status');
  const cameraRecordTimer = page.querySelector('#pm-camera-record-timer');
  const cameraClose = page.querySelector('#pm-camera-close');
  const cameraFlip = page.querySelector('#pm-camera-flip');
  const cameraMore = page.querySelector('#pm-camera-more');
  const cameraMoreMenu = page.querySelector('#pm-camera-more-menu');
  const cameraFlash = page.querySelector('#pm-camera-flash');
  const cameraPairScan = page.querySelector('#pm-camera-pair-scan');
  const cameraShutter = page.querySelector('#pm-camera-shutter');
  const cameraOrbCanvas = page.querySelector('#pm-camera-strands-orb-canvas');
  const cameraPinchZoom = _installMobileCameraPinchZoom(cameraCapture, cameraVideo, () => cameraStream?.getVideoTracks?.()[0]);
  const commandChip = page.querySelector('#pm-chat-command-chip');
  page.querySelector('#pm-voice-room-return')?.addEventListener('click', () => {
    navigate?.(`#mobile/voice/${encodeURIComponent(requestedSession)}`);
  });
  const sideSheet = page.querySelector('#pm-mobile-side-sheet');
  const sidePanel = page.querySelector('#pm-mobile-side-panel');
  const sideThreadEl = page.querySelector('#pm-mobile-side-thread');
  const sideComposer = page.querySelector('#pm-mobile-side-composer');
  const sideInput = page.querySelector('#pm-mobile-side-input');
  const sideSendBtn = page.querySelector('#pm-mobile-side-send');
  const sideTitleEl = page.querySelector('#pm-mobile-side-title');
  const sideSubtitleEl = page.querySelector('#pm-mobile-side-subtitle');
  const sideCloseBtn = page.querySelector('#pm-mobile-side-close');
  const sideScrim = page.querySelector('#pm-mobile-side-scrim');
  const sideHandle = page.querySelector('#pm-mobile-side-handle');
  const sideAttachBtn = page.querySelector('#pm-mobile-side-attach');
  const sideMicBtn = page.querySelector('#pm-mobile-side-mic');
  const sideState = {
    link: null,
    thread: [],
    backgroundAgentId: '',
    backgroundTraceExpanded: null,
    busy: false,
    abort: null,
    sideThreadRendered: false,
  };
  // Composer sizing is invoked by startup bridges below. Keep its mutable
  // animation state initialized before any of those callbacks can run.
  let chatComposerSpaceRaf = 0;
  let chatComposerShiftAnimation = null;

  function currentChatGateway() {
    const bound = getMobileSessionTarget(requestedSession);
    return resolveMobileSessionGateway(requestedSession, {
      pendingGatewayId: bound?.gatewayId || pendingGatewayId,
      fallbackToCurrentGateway: requestedSession !== MOBILE_CHAT_SESSION_ID && !routedTarget?.gatewayId,
    });
  }

  function renderChatTargetChip() {
    const target = currentChatGateway();
    if (!targetChip) return target;
    const value = targetChip.querySelector('.pm-new-chat-context-value');
    if (value) value.querySelector('strong').textContent = target?.name || 'Gateway unavailable';
    else targetChip.innerHTML = `<strong>${escapeHtml(target?.name || 'Gateway unavailable')}</strong>`;
    targetChip.disabled = false;
    targetChip.setAttribute('aria-expanded', String(!!targetPopover && targetPopover.dataset?.popoverType === 'target'));
    targetChip.setAttribute('aria-label', target ? `Current gateway: ${target.name}` : 'Gateway target unavailable');
    return target;
  }

  function renderChatProjectChip() {
    if (!projectChip) return;
    const value = projectChip.querySelector('.pm-new-chat-context-value');
    if (value) value.querySelector('strong').textContent = targetProjectLabel || 'Chat';
    else projectChip.innerHTML = `<strong>${escapeHtml(targetProjectLabel || 'Chat')}</strong>`;
    projectChip.setAttribute('aria-expanded', String(!!targetPopover && targetPopover.dataset?.popoverType === 'project'));
    projectChip.setAttribute('aria-label', targetProjectLabel ? `Directed chat: ${targetProjectLabel}` : 'Directed chat: Chat');
  }

  function rememberChatContext() {
    const target = currentChatGateway();
    _saveMobileLastChatContext({
      gatewayId: target?.gatewayId || pendingGatewayId,
      gatewayName: target?.name || '',
      projectId: targetProjectId,
      projectName: targetProjectLabel,
    });
  }

  function dismissNewChatContextDock() {
    // The unsaved-chat selectors are part of the starter surface only. Once
    // the first message has created a real session, remove the mounted dock
    // instead of waiting for a route re-render that may not happen yet.
    closeTargetPopover?.();
    contextDock?.remove();
    document.body.classList.remove('pm-mobile-context-popover-open');
  }

  // iOS can dispatch the delayed trusted click against the element that was
  // underneath a fixed popover when the first touch was not consumed early
  // enough. Keep a capture-phase guard on both the pointer and click paths so
  // the Brain Cards never see a gesture that began inside this picker.
  function installMobileContextPopoverGuard({ wrapper, scrim, trigger, optionSelector }) {
    let shieldTimer = null;
    const clearShield = () => {
      if (shieldTimer) window.clearTimeout(shieldTimer);
      shieldTimer = null;
      document.removeEventListener('click', shieldClick, true);
      document.removeEventListener('pointerup', shieldPointerUp, true);
      document.removeEventListener('touchend', shieldTouchEnd, true);
    };
    const shieldClick = (event) => {
      if (event.isTrusted === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearShield();
    };
    const shieldPointerUp = (event) => {
      if (event.isTrusted === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const shieldTouchEnd = (event) => {
      if (event.isTrusted === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const armShield = () => {
      clearShield();
      document.addEventListener('click', shieldClick, true);
      document.addEventListener('pointerup', shieldPointerUp, true);
      document.addEventListener('touchend', shieldTouchEnd, { capture: true, passive: false });
      shieldTimer = window.setTimeout(clearShield, 900);
    };
    const eventPoint = (event) => {
      const touch = event?.touches?.[0] || event?.changedTouches?.[0] || event;
      const x = Number(touch?.clientX);
      const y = Number(touch?.clientY);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    };
    const containsPoint = (element, point) => {
      if (!element || !point) return false;
      const rect = element.getBoundingClientRect();
      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    };
    const optionAtPoint = (event) => {
      const point = eventPoint(event);
      if (!point) return null;
      return [...wrapper.querySelectorAll(optionSelector)].find((option) => containsPoint(option, point)) || null;
    };
    const interactiveAtPoint = (event) => {
      const point = eventPoint(event);
      if (!point) return null;
      const selector = `${optionSelector}, input, textarea, select, button, a, [contenteditable="true"]`;
      return [...wrapper.querySelectorAll(selector)].find((element) => containsPoint(element, point)) || null;
    };
    const eventPath = (event) => (typeof event.composedPath === 'function' ? event.composedPath() : []);
    const eventIsInside = (event) => {
      const node = event.target;
      const path = eventPath(event);
      return path.includes(wrapper)
        || path.includes(trigger)
        || wrapper.contains(node)
        || trigger?.contains?.(node);
    };
    const popoverInputFocused = () => {
      const active = document.activeElement;
      return wrapper.contains(active)
        && active?.matches?.('input, textarea, select, [contenteditable="true"]');
    };
    // Attachments are a higher visual and interaction layer than the
    // new-chat selectors. If a selector is still mounted when the user taps
    // the paperclip or an attachment action, close the selector but let the
    // attachment event continue to its real handler.
    const eventIsInHigherLayer = (event) => {
      const node = event.target;
      const path = eventPath(event);
      const selectors = ['#pm-attach-btn', '#pm-attach-sheet', '#pm-camera-capture', '#pm-chat-voice-camera'];
      return selectors.some((selector) => path.some((entry) => entry?.matches?.(selector)))
        || selectors.some((selector) => node?.closest?.(selector));
    };
    const stopEvent = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onPointerDown = (event) => {
      if (event.defaultPrevented) return;
      if (eventIsInside(event)) return;
      if (eventIsInHigherLayer(event)) {
        closeTargetPopover();
        return;
      }
      const point = eventPoint(event);
      const option = optionAtPoint(event);
      const interactive = interactiveAtPoint(event);
      if (interactive && !option && interactive.matches?.('input, textarea, select, [contenteditable="true"]')) {
        // WebKit can report the element behind a fixed translucent dialog as
        // the touch target. Focus the visual input explicitly before shielding
        // the underlying composer so the keyboard still opens on first tap.
        try { interactive.focus({ preventScroll: true }); } catch { try { interactive.focus(); } catch {} }
        stopEvent(event);
        return;
      }
      if (option) {
        // Some iOS/WebKit builds report the element underneath a fixed,
        // translucent popover as the pointer target. Preventing that touch
        // without activating the visual option kills the delayed click too,
        // leaving the popover open but completely inert. Resolve the option
        // from the touch coordinates and activate it on the first contact.
        stopEvent(event);
        try { pmHaptic?.(10); } catch {}
        option.click();
        return;
      }
      if (containsPoint(wrapper, point)) {
        // The visual hit-test says the gesture is in the popover even if a
        // mobile browser reported the underlying card as event.target.
        stopEvent(event);
        return;
      }
      if (!point && popoverInputFocused()) {
        // iOS may emit a coordinate-less pointer during keyboard presentation
        // against the element that was underneath the dialog. It is not an
        // away tap; keep the focused field and its popover alive.
        stopEvent(event);
        return;
      }
      stopEvent(event);
      armShield();
      closeTargetPopover();
    };
    const onClick = (event) => {
      if (event.defaultPrevented || eventIsInside(event)) return;
      if (eventIsInHigherLayer(event)) {
        closeTargetPopover();
        return;
      }
      const option = optionAtPoint(event);
      const interactive = interactiveAtPoint(event);
      if (interactive && !option && interactive.matches?.('input, textarea, select, [contenteditable="true"]')) {
        try { interactive.focus({ preventScroll: true }); } catch { try { interactive.focus(); } catch {} }
        stopEvent(event);
        return;
      }
      if (option) {
        stopEvent(event);
        armShield();
        try { pmHaptic?.(10); } catch {}
        option.click();
        return;
      }
      const point = eventPoint(event);
      if (containsPoint(wrapper, point)) {
        stopEvent(event);
        return;
      }
      if (!point && popoverInputFocused()) {
        // Do not treat the keyboard's delayed, coordinate-less click as an
        // away click while the dialog field still owns focus.
        stopEvent(event);
        return;
      }
      stopEvent(event);
      armShield();
      closeTargetPopover();
    };
    const onWrapperPointerDown = (event) => event.stopPropagation();
    const onWrapperClick = (event) => event.stopPropagation();
    const onScrimPointerDown = (event) => {
      stopEvent(event);
      armShield();
      closeTargetPopover();
    };
    wrapper.addEventListener('pointerdown', onWrapperPointerDown);
    wrapper.addEventListener('click', onWrapperClick);
    scrim.addEventListener('pointerdown', onScrimPointerDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, { capture: true, passive: false });
    document.addEventListener('click', onClick, true);
    return {
      armShield,
      cleanup() {
        clearShield();
        wrapper.removeEventListener('pointerdown', onWrapperPointerDown);
        wrapper.removeEventListener('click', onWrapperClick);
        scrim.removeEventListener('pointerdown', onScrimPointerDown, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('touchstart', onPointerDown, true);
        document.removeEventListener('click', onClick, true);
      },
    };
  }

  function openChatTargetPopover() {
    if (requestedSession !== MOBILE_CHAT_SESSION_ID || !targetChip) return;
    if (targetPopover?.dataset?.popoverType === 'target') {
      closeTargetPopover();
      return;
    }
    closeTargetPopover();
    const target = currentChatGateway();
    const immutable = requestedSession !== MOBILE_CHAT_SESSION_ID;
    const wrapper = document.createElement('div');
    wrapper.className = 'pm-chat-settings-popover pm-new-chat-context-popover';
    wrapper.dataset.popoverType = 'target';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-modal', 'true');
    wrapper.setAttribute('aria-label', 'Gateway target');
    const entries = loadGatewayCatalog();
    wrapper.innerHTML = `<div class="pm-new-chat-context-popover-title">${immutable ? 'Chat target' : 'Connected computer'}</div>${entries.map((entry) => `<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option" data-chat-target-id="${escapeHtml(entry.gatewayId)}" aria-selected="${String(entry.gatewayId === target?.gatewayId)}" ${immutable ? 'disabled' : ''}><span class="pm-new-chat-context-option-icon" aria-hidden="true">${ICONS.monitor}</span><span class="pm-new-chat-context-option-copy"><strong>${escapeHtml(entry.name)}</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">${entry.gatewayId === target?.gatewayId ? ICONS.check : ''}</span></button>`).join('')}`;
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'pm-chat-target-popover-scrim';
    scrim.setAttribute('aria-label', 'Close gateway target');
    const onEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeTargetPopover();
    };
    document.body.append(scrim);
    (contextDock || form || document.body).append(wrapper);
    let popoverGuard = null;
    popoverGuard = installMobileContextPopoverGuard({
      wrapper,
      scrim,
      trigger: targetChip,
      optionSelector: '[data-chat-target-id]',
    });
    contextDock?.classList.add('pm-context-popover-open');
    form?.classList.add('pm-target-popover-open');
    document.body.classList.add('pm-mobile-context-popover-open');
    document.addEventListener('keydown', onEscape, true);
    targetPopover = wrapper;
    targetChip?.setAttribute('aria-expanded', 'true');
    scrim.addEventListener('click', () => {
      popoverGuard?.armShield();
      closeTargetPopover();
    });
    closeTargetPopover = () => {
      popoverGuard?.cleanup();
      scrim.remove();
      wrapper.remove();
      contextDock?.classList.remove('pm-context-popover-open');
      form?.classList.remove('pm-target-popover-open');
      document.body.classList.remove('pm-mobile-context-popover-open');
      document.removeEventListener('keydown', onEscape, true);
      targetPopover = null;
      targetChip?.setAttribute('aria-expanded', 'false');
      reanchorContextDockAfterLayout();
      closeTargetPopover = () => {};
    };
    wrapper.querySelectorAll('[data-chat-target-id]').forEach((button) => button.addEventListener('click', (event) => {
      if (event?.isTrusted && button.dataset.pmHaptic !== '1') {
        try { pmHaptic?.(10); } catch {}
      }
      if (button.getAttribute('aria-selected') === 'true') {
        // Treat tapping the current target as an away click. It should dismiss
        // the picker without reopening the keyboard or changing any state.
        popoverGuard?.armShield();
        closeTargetPopover();
        return;
      }
      popoverGuard?.armShield();
      pendingGatewayId = button.getAttribute('data-chat-target-id') || pendingGatewayId;
      setActiveGatewayId(pendingGatewayId);
      setMobileActiveGatewayTarget(pendingGatewayId);
      rememberChatContext();
      renderChatTargetChip();
      renderChatProjectChip();
      closeTargetPopover();
    }));
    // Keep picker rows as real buttons. A native haptic switch overlay consumes
    // the physical iOS tap and relies on a second synthetic click, which can be
    // discarded while the selected row is closing its own modal layer.
  }

  const bindContextTrigger = (button, activate) => {
    if (!button || typeof activate !== 'function') return;
    // The haptic proxy activates on touch while keyboard/mouse activation
    // reaches the real button. Debounce the two browser paths so a selected
    // chip always performs one toggle (close), never close-then-reopen.
    let lastActivationAt = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastActivationAt < 80) return;
      lastActivationAt = now;
      activate();
    };
    button.addEventListener('click', run);
    try { attachMobileButtonHaptic(button, run); } catch {}
  };
  bindContextTrigger(targetChip, openChatTargetPopover);
  bindContextTrigger(projectChip, openChatProjectPopover);
  renderChatTargetChip();
  renderChatProjectChip();
  const stopGatewayTargetUpdates = onGatewayCatalogChanged(() => renderChatTargetChip());

  function syncNewProjectPopoverToKeyboard(keyboardOpen = false, visualBottom = 0, layoutHeight = 0) {
    const popover = targetPopover?.dataset?.popoverType === 'new-project' ? targetPopover : null;
    if (!popover) return;
    const open = keyboardOpen === true;
    const visualHeight = Math.max(0, Number(window.visualViewport?.height || visualBottom || window.innerHeight || 0) - 16);
    if (visualHeight) popover.style.setProperty('--pm-new-project-available-height', `${Math.round(visualHeight)}px`);
    popover.classList.toggle('pm-new-project-keyboard-open', open);
    if (!open) {
      popover.style.removeProperty('--pm-new-project-keyboard-shift');
      return;
    }
    const targetBottom = Math.max(0, Number(visualBottom || window.visualViewport?.height || window.innerHeight || 0) - 8);
    const measureAndAnchor = () => {
      if (targetPopover !== popover || !document.contains(popover)) return;
      const rect = popover.getBoundingClientRect?.();
      if (!rect || !rect.height) return;
      const shift = targetBottom - Number(rect.bottom || 0);
      const limit = Math.max(Number(layoutHeight || window.innerHeight || 0), targetBottom, rect.height) + 80;
      popover.style.setProperty('--pm-new-project-keyboard-shift', `${Math.round(Math.max(-limit, Math.min(limit, shift)))}px`);
    };
    requestAnimationFrame(measureAndAnchor);
  }

  function openNewProjectPopover() {
    if (!projectChip || !contextDock) return;
    closeTargetPopover();
    const wrapper = document.createElement('div');
    wrapper.className = 'pm-chat-settings-popover pm-new-chat-context-popover pm-new-project-popover';
    wrapper.dataset.popoverType = 'new-project';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-modal', 'true');
    wrapper.setAttribute('aria-label', 'New project');
    wrapper.innerHTML = `
      <div class="pm-new-chat-context-popover-title">New project</div>
      <form class="pm-new-project-form">
        <label class="pm-new-project-label" for="pm-new-project-name">Project name</label>
        <input id="pm-new-project-name" class="pm-new-project-input" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Mobile app" />
        <div class="pm-new-project-error" role="alert" hidden></div>
        <div class="pm-new-project-actions">
          <button type="button" class="pm-new-project-button pm-new-project-cancel" data-project-create-action="cancel">Cancel</button>
          <button type="button" class="pm-new-project-button pm-new-project-confirm" data-project-create-action="confirm">Create</button>
        </div>
      </form>`;
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'pm-chat-target-popover-scrim';
    scrim.setAttribute('aria-label', 'Close new project dialog');
    document.body.append(scrim);
    contextDock.append(wrapper);
    const popoverGuard = installMobileContextPopoverGuard({
      wrapper,
      scrim,
      trigger: projectChip,
      optionSelector: '[data-project-create-action]',
    });
    contextDock.classList.add('pm-context-popover-open');
    document.body.classList.add('pm-mobile-context-popover-open');
    document.body.classList.add('pm-new-project-dialog-open');
    targetPopover = wrapper;
    syncNewProjectPopoverToKeyboard(false, Number(window.visualViewport?.height || window.innerHeight || 0), Number(window.innerHeight || 0));
    projectChip.setAttribute('aria-expanded', 'true');
    const nameInput = wrapper.querySelector('#pm-new-project-name');
    const errorEl = wrapper.querySelector('.pm-new-project-error');
    const confirmButton = wrapper.querySelector('.pm-new-project-confirm');
    const formEl = wrapper.querySelector('.pm-new-project-form');
    let submitting = false;
    const close = () => {
      popoverGuard.cleanup();
      scrim.remove();
      wrapper.remove();
      contextDock.classList.remove('pm-context-popover-open');
      document.body.classList.remove('pm-mobile-context-popover-open');
      document.body.classList.remove('pm-new-project-dialog-open');
      document.removeEventListener('keydown', onEscape, true);
      targetPopover = null;
      projectChip.setAttribute('aria-expanded', 'false');
      reanchorContextDockAfterLayout();
      closeTargetPopover = () => {};
    };
    closeTargetPopover = close;
    const onEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', onEscape, true);
    const setError = (message = '') => {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = !message;
    };
    const cancel = () => {
      popoverGuard.armShield();
      close();
    };
    const submit = async (event) => {
      event?.preventDefault?.();
      if (submitting) return;
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        setError('Enter a project name.');
        nameInput?.focus?.();
        return;
      }
      popoverGuard.armShield();
      submitting = true;
      if (confirmButton) confirmButton.disabled = true;
      setError('');
      try {
        const created = await createMobileProject(name);
        const project = created?.project || created;
        const projectId = String(project?.id || '').trim();
        if (!projectId) throw new Error('Prometheus did not return the new project.');
        targetProjectId = projectId;
        targetProjectLabel = String(project?.name || name).trim() || name;
        rememberChatContext();
        renderChatProjectChip();
        invalidateMobileDrawerSessions();
        try { window.__pmMobileProjectsChanged?.(project); } catch {}
        close();
      } catch (error) {
        submitting = false;
        if (confirmButton) confirmButton.disabled = false;
        setError(String(error?.message || error || 'Could not create project.'));
      }
    };
    scrim.addEventListener('click', cancel);
    wrapper.querySelector('.pm-new-project-cancel')?.addEventListener('click', (event) => {
      if (event?.isTrusted) {
        try { pmHaptic?.(10); } catch {}
      }
      cancel();
    });
    formEl?.addEventListener('submit', submit);
    confirmButton?.addEventListener('click', (event) => {
      if (event?.isTrusted) {
        try { pmHaptic?.(10); } catch {}
      }
      void submit(event);
    });
    setTimeout(() => {
      if (document.contains(nameInput)) nameInput.focus({ preventScroll: true });
    }, 80);
  }

  async function openChatProjectPopover() {
    if (requestedSession !== MOBILE_CHAT_SESSION_ID || !projectChip || !contextDock) return;
    if (targetPopover?.dataset?.popoverType === 'project') {
      closeTargetPopover();
      return;
    }
    closeTargetPopover();
    const wrapper = document.createElement('div');
    wrapper.className = 'pm-chat-settings-popover pm-new-chat-context-popover';
    wrapper.dataset.popoverType = 'project';
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', 'Directed chat');
    wrapper.innerHTML = '<div class="pm-new-chat-context-popover-title">Directed chat</div><div class="pm-new-chat-context-loading">Loading projects…</div>';
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'pm-chat-target-popover-scrim';
    scrim.setAttribute('aria-label', 'Close directed chat picker');
    const onEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeTargetPopover();
    };
    document.body.append(scrim);
    contextDock.append(wrapper);
    let popoverGuard = null;
    popoverGuard = installMobileContextPopoverGuard({
      wrapper,
      scrim,
      trigger: projectChip,
      optionSelector: '[data-project-id], [data-new-project]',
    });
    contextDock.classList.add('pm-context-popover-open');
    document.body.classList.add('pm-mobile-context-popover-open');
    document.addEventListener('keydown', onEscape, true);
    targetPopover = wrapper;
    projectChip.setAttribute('aria-expanded', 'true');
    scrim.addEventListener('click', () => {
      popoverGuard?.armShield();
      closeTargetPopover();
    });
    closeTargetPopover = () => {
      popoverGuard?.cleanup();
      scrim.remove();
      wrapper.remove();
      contextDock.classList.remove('pm-context-popover-open');
      document.body.classList.remove('pm-mobile-context-popover-open');
      document.removeEventListener('keydown', onEscape, true);
      targetPopover = null;
      targetChip?.setAttribute('aria-expanded', 'false');
      projectChip?.setAttribute('aria-expanded', 'false');
      reanchorContextDockAfterLayout();
      closeTargetPopover = () => {};
    };
    try {
      const data = await mobileGatewayFetch('/api/projects');
      if (!document.contains(wrapper) || targetPopover !== wrapper) return;
      const projects = (Array.isArray(data) ? data : data?.projects || []).filter((project) => project?.id);
      const options = [{ id: '', name: 'Chat' }, ...projects];
      const newProjectMarkup = '<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option pm-new-project-option" data-new-project="true"><span class="pm-new-chat-context-option-icon" aria-hidden="true">+</span><span class="pm-new-chat-context-option-copy"><strong>New project</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">›</span></button>';
      wrapper.querySelector('.pm-new-chat-context-loading').outerHTML = `${newProjectMarkup}${options.map((project) => {
        const selected = String(project.id || '') === targetProjectId;
        return `<button type="button" class="pm-chat-settings-menu-item pm-new-chat-context-option" data-project-id="${escapeHtml(project.id || '')}" aria-selected="${String(selected)}"><span class="pm-new-chat-context-option-icon" aria-hidden="true">${project.id ? ICONS.folder : ICONS.chat}</span><span class="pm-new-chat-context-option-copy"><strong>${escapeHtml(project.name)}</strong></span><span class="pm-new-chat-context-option-check" aria-hidden="true">${selected ? ICONS.check : ''}</span></button>`;
      }).join('')}`;
      const newProjectButton = wrapper.querySelector('[data-new-project]');
      const openNewProject = (event) => {
        if (event?.isTrusted) {
          try { pmHaptic?.(10); } catch {}
        }
        popoverGuard?.armShield();
        openNewProjectPopover();
      };
      newProjectButton?.addEventListener('click', openNewProject);
      wrapper.querySelectorAll('[data-project-id]').forEach((button) => button.addEventListener('click', (event) => {
        if (event?.isTrusted && button.dataset.pmHaptic !== '1') {
          try { pmHaptic?.(10); } catch {}
        }
        if (button.getAttribute('aria-selected') === 'true') {
          // Match an away click when the user taps the already active route.
          popoverGuard?.armShield();
          closeTargetPopover();
          return;
        }
        popoverGuard?.armShield();
        targetProjectId = String(button.dataset.projectId || '').trim();
        targetProjectLabel = String(button.querySelector('strong')?.textContent || '').trim();
        if (!targetProjectId) targetProjectLabel = '';
        rememberChatContext();
        renderChatProjectChip();
        closeTargetPopover();
      }));
      // Project picker rows intentionally remain direct buttons; see the target
      // picker above for why these modal options do not use a haptic proxy.
    } catch {
      const loading = wrapper.querySelector('.pm-new-chat-context-loading');
      if (loading) loading.textContent = 'Projects are unavailable right now.';
    }
  }

  _pmRefreshSlashChrome(page, input);
  _installMobileTimestampReveal(threadEl, handleMobileMessageAction);
  threadEl?.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('[data-mobile-starter-prompt]');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-mobile-starter-prompt'));
    const card = _getMobileEmptyChatStarterCards()[index];
    if (!card || !input) return;
    if (modeLauncher && !composerModeOpen) {
      setChatComposerMode(true, {
        animate: true,
        preserveScroll: true,
        reason: 'starter',
      });
    }
    input.value = card.prompt;
    resizeComposerInput();
    _pmUpdateComposerRichPreview(page, input);
    _pmClearActiveSlashCommand(page, input, { focus: false });
    updateComposerSubmitState();
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
  });
  if (requestedSession === MOBILE_CHAT_SESSION_ID) {
    _loadMobileEmptyChatBrainCards().catch(() => {});
  }
  const previousBackgroundDockBridge = window.__pmMobileBackgroundSpawnDockChanged;
  const previousBackgroundAgentDetailBridge = window.__pmMobileBackgroundAgentDetail;
  const previousBackgroundAgentDetailRenderBridge = window.__pmMobileBackgroundAgentDetailRender;
  const previousToolProgressDockBridge = window.__pmMobileToolProgressDockChanged;
  const previousQueuedPromptsBridge = window.__pmMobileQueuedPromptsChanged;
  const previousGoalBridge = window.__pmMobileGoalChanged;
  const currentBackgroundDockBridge = () => {
    _renderMobileBackgroundSpawnDock(backgroundSpawnDock, requestedSession);
    updateChatComposerSpace();
  };
  const currentBackgroundAgentDetailBridge = (id = '') => openMobileBackgroundAgentDetail(id);
  const currentBackgroundAgentDetailRenderBridge = () => {
    if (sideState.backgroundAgentId) renderMobileSideSheet();
  };
  const currentQueuedPromptsBridge = () => {
    updateChatComposerSpace();
  };
  const currentGoalBridge = (msg = {}) => {
    _renderMobileGoalPill(goalStrip, requestedSession);
    updateChatComposerSpace();
    const sid = String(msg?.sessionId || requestedSession || '').trim();
    if (sid && sid === requestedSession) {
      const event = String(msg?.event || '').trim();
      const status = String(msg?.goal?.status || '').trim();
      const checkpointPhase = String(msg?.goal?.restartCheckpoint?.phase || '').trim();
      const shouldRecoverGoalStream = /^(runner_started|launch_accepted|turn_preparing|turn_started|runtime_failure|startup_auto_resume|startup_crash_recovered|crash_recovered|recovery_finalized|recovery_resumed)$/.test(event)
        || (!event && status === 'active');
      if (shouldRecoverGoalStream) {
        if (/^(runner_started|launch_accepted|turn_preparing|turn_started)$/.test(event)) {
          onMainChatGoalSse({ sessionId: sid, event: 'runtime_registered' });
        }
        scheduleMobileRunRecovery(120, { force: true, fullRefresh: false });
      } else if (
        event === 'runner_idle'
        && status !== 'restarting'
      ) {
        // `runner_idle` is the durable backend boundary for an ended goal turn.
        // Reconcile it with run-status so a gateway crash cannot leave the
        // phone's cached streaming turn, tool activity, or busy composer alive.
        // A legitimate planned apply restart remains `restarting` until the
        // replacement gateway confirms it, so never downgrade that state here.
        scheduleMobileRunRecovery(120, { force: true, fullRefresh: false });
      } else if (
        status === 'active'
        && /^(boot_finalized|crash_recovered|resuming)$/.test(checkpointPhase)
      ) {
        // Accept the persisted recovered-goal state even if an older gateway
        // does not emit the newer explicit recovery event name.
        scheduleMobileRunRecovery(120, { force: true, fullRefresh: false });
      }
    }
  };
  const currentToolProgressDockBridge = () => updateChatComposerSpace();
  window.__pmMobileBackgroundSpawnDockChanged = currentBackgroundDockBridge;
  window.__pmMobileBackgroundAgentDetail = currentBackgroundAgentDetailBridge;
  window.__pmMobileBackgroundAgentDetailRender = currentBackgroundAgentDetailRenderBridge;
  window.__pmMobileToolProgressDockChanged = currentToolProgressDockBridge;
  window.__pmMobileQueuedPromptsChanged = currentQueuedPromptsBridge;
  window.__pmMobileGoalChanged = currentGoalBridge;
  _renderMobileMainPlanDock(mainPlanDock, requestedSession);
  _renderMobileToolProgressDock(toolProgressDock, requestedSession);
  _renderMobileBackgroundSpawnDock(backgroundSpawnDock, requestedSession);
  _renderMobileGoalPill(goalStrip, requestedSession);

  const resizeComposerInput = () => {
    if (!input) return;
    const viewportHeight = Math.max(320, Math.round(window.visualViewport?.height || window.innerHeight || 640));
    const dynamicCap = Math.max(96, Math.min(280, Math.floor(viewportHeight * 0.5) - 86));
    const maxHeight = Number(input.dataset.maxHeight || dynamicCap);
    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight || 0, maxHeight);
    input.style.height = `${Math.max(28, nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  // SpeechRecognition may deliver a final result after the composer has been
  // cleared. Dictation installs this hook below so a send ends recognition
  // before its captured starting text can be restored.
  let resetChatDictationComposerState = () => {};
  const resetComposerInput = () => {
    if (!input) return;
    input.value = '';
    resetChatDictationComposerState();
    input.style.height = '';
    input.style.overflowY = 'hidden';
    _pmClearSkillExclusions();
    _pmClearSelectedComposerSkills();
    _pmHideSkillTriggerPill(page);
    _pmUpdateComposerRichPreview(page, input);
    form?.classList.remove('has-text', 'has-attachments');
    requestAnimationFrame(resizeComposerInput);
    requestAnimationFrame(updateComposerExpandedState);
  };
  let composerModeOpen = isVoiceRoomTranscript;
  let composerModeTransitionTimer = 0;
  let composerModeScrollLockTop = null;
  let composerModeScrollIgnoreUntil = 0;
  let composerModeScrollIntentUntil = 0;
  let composerModeLastScrollTop = Number(_mobileChatScrollTarget(body)?.scrollTop || 0);

  function setChatComposerMode(open, {
    animate = true,
    preserveScroll = true,
    reason = 'keyboard',
    update = true,
  } = {}) {
    if (!form || !modeLauncher) return;
    const nextOpen = !!open;
    const scrollTarget = _mobileChatScrollTarget(body);
    if (preserveScroll && scrollTarget) {
      composerModeScrollLockTop = Number(scrollTarget.scrollTop || 0);
    }
    composerModeOpen = nextOpen;
    page.classList.toggle('pm-chat-composer-mode-open', nextOpen);
    page.classList.toggle('pm-chat-mode-launcher-active', !nextOpen);
    form.classList.toggle('pm-composer-mode-hidden', !nextOpen);
    form.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    if (nextOpen) form.removeAttribute('inert');
    else form.setAttribute('inert', '');
    modeLauncher.setAttribute('aria-hidden', nextOpen ? 'true' : 'false');
    modeLauncher.classList.toggle('is-transitioning', !!animate);
    if (composerModeTransitionTimer) {
      window.clearTimeout(composerModeTransitionTimer);
      composerModeTransitionTimer = 0;
    }
    if (animate) {
      // The native keyboard can reveal a focused input well after the first
      // visualViewport event. Keep those layout shifts out of the auto-hide
      // path for the complete keyboard hand-off window.
      const transitionIgnoreMs = reason === 'keyboard' ? 1800 : 420;
      composerModeScrollIgnoreUntil = (window.performance?.now?.() || 0) + transitionIgnoreMs;
      composerModeTransitionTimer = window.setTimeout(() => {
        composerModeTransitionTimer = 0;
        modeLauncher.classList.remove('is-transitioning');
      }, 360);
    } else {
      composerModeScrollIgnoreUntil = (window.performance?.now?.() || 0) + 180;
      modeLauncher.classList.remove('is-transitioning');
    }
    modeLauncher.dataset.pmChatModeReason = reason;
    if (update) {
      updateComposerExpandedState();
      updateChatComposerSpace();
    }
  }

  if (modeLauncher) {
    setChatComposerMode(composerModeOpen, {
      animate: false,
      preserveScroll: false,
      update: false,
      reason: 'initial',
    });
  }
  const previousOpenChatComposerBridge = window.__pmMobileOpenChatComposer;
  const currentOpenChatComposerBridge = ({ reason = 'external' } = {}) => {
    if (!modeLauncher || composerModeOpen) return;
    setChatComposerMode(true, {
      animate: true,
      preserveScroll: true,
      reason,
    });
  };
  window.__pmMobileOpenChatComposer = currentOpenChatComposerBridge;
  let connectionStatusHideTimer = null;
  let connectionStatusSuccessTimer = null;
  requestAnimationFrame(resizeComposerInput);
  requestAnimationFrame(() => updateChatComposerSpace());


  function getPendingAttachments() {
    const sid = requestedSession;
    if (!Array.isArray(__pmChat.attachments[sid])) __pmChat.attachments[sid] = [];
    return __pmChat.attachments[sid];
  }

  function renderPendingAttachments() {
    const files = getPendingAttachments();
    attachTray.hidden = files.length === 0;
    attachTray.innerHTML = _renderChatAttachmentPreviews(files, true);
    attachTray.querySelectorAll('[data-remove-attachment]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-attachment'));
        if (Number.isFinite(idx)) getPendingAttachments().splice(idx, 1);
        renderPendingAttachments();
        updateComposerSubmitState();
      });
    });
    updateComposerSubmitState();
  }

  function updateComposerExpandedState() {
    if (!form) return;
    const hasText = !!String(input?.value || '').trim();
    const hasAttachments = getPendingAttachments().length > 0;
    const focused = document.activeElement === input;
    const questionPending = !!_getPendingQuestionForSession(requestedSession);
    if (questionPending && modeLauncher && !composerModeOpen) {
      setChatComposerMode(true, {
        animate: false,
        preserveScroll: true,
        reason: 'question',
        update: false,
      });
    }
    form.classList.toggle('is-focused', focused);
    form.classList.toggle('has-text', hasText);
    form.classList.toggle('has-attachments', hasAttachments);
    form.classList.toggle('has-pending-question', questionPending);
    if (questionPending) form.classList.remove('is-focused', 'has-text', 'has-attachments');
    requestAnimationFrame(() => updateChatComposerSpace());
  }

  let attachSheetTarget = 'chat';
  let pendingFileInputTarget = 'chat';
  const VOICE_PHOTO_FILE_MAX_BYTES = 15 * 1024 * 1024;

  function _isVoicePhotoFile(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(name);
  }

  function openAttachSheet(options = {}) {
    const target = String(options?.target || 'chat').trim() || 'chat';
    attachSheetTarget = target === 'voice' ? 'voice' : 'chat';
    if (!attachSheet) {
      pendingFileInputTarget = attachSheetTarget;
      fileInput?.click();
      return;
    }
    attachSheet.dataset.pmAttachTarget = attachSheetTarget;
    attachSheet.classList.toggle('voice', attachSheetTarget === 'voice');
    attachSheet.hidden = false;
    requestAnimationFrame(() => attachSheet.classList.add('open'));
  }

  function closeAttachSheet() {
    if (!attachSheet) return;
    attachSheet.classList.remove('open');
    setTimeout(() => {
      if (!attachSheet.classList.contains('open')) attachSheet.hidden = true;
    }, 180);
  }

  let cameraStream = null;
  let cameraFacingMode = 'environment';
  let cameraTorchEnabled = false;
  let cameraOpening = false;
  let cameraCaptureOptions = { target: 'chat', onCapture: null, onVideoCapture: null };
  let cameraRecorder = null;
  let cameraRecordingChunks = [];
  let cameraRecordingStartedAt = 0;
  let cameraRecordingTimer = null;
  let cameraRecordingMaxTimer = null;
  let cameraHoldTimer = null;
  let cameraPointerActive = false;
  let cameraSuppressClick = false;
  let cameraOrbRaf = 0;
  let cameraOrbGl = null;
  let cameraPairScanTimer = null;
  let cameraPairScanDetector = null;
  let cameraPairScanCanvas = null;
  let cameraPairScanContext = null;
  let cameraPairScanLastAt = 0;
  let cameraPairScanBusy = false;
  let voiceCameraFrameCacheTimer = null;
  let voiceCameraFrameCache = null;
  let voiceCameraFrameCacheRefreshPending = false;
  let voiceCameraFrameCacheRefreshPromise = null;
  let voiceCameraLiveFrameReader = null;
  let voiceCameraFrameSequence = 0;
  let voiceCameraAutoCaptureInFlight = null;
  let voiceCameraAutoCaptureLastAt = 0;
  const CAMERA_RECORD_HOLD_MS = 420;
  const CAMERA_RECORD_MAX_MS = 12000;

  function setCameraStatus(text = '') {
    if (cameraStatus) cameraStatus.textContent = text;
  }

  function setCameraMoreMenuOpen(open = false) {
    const isOpen = open === true;
    cameraMoreMenu?.toggleAttribute('hidden', !isOpen);
    cameraMore?.classList.toggle('is-open', isOpen);
    cameraMore?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function setCameraTorchUi(enabled = false) {
    cameraTorchEnabled = enabled === true;
    cameraFlash?.setAttribute('aria-pressed', cameraTorchEnabled ? 'true' : 'false');
    cameraFlash?.classList.toggle('is-active', cameraTorchEnabled);
  }

  async function toggleCameraTorch() {
    const track = cameraStream?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.();
    if (!track?.applyConstraints || !capabilities?.torch) {
      pmToast('Flash is not available on this camera.', 'info');
      return;
    }
    const next = !cameraTorchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setCameraTorchUi(next);
    } catch (err) {
      setCameraTorchUi(false);
      pmToast(err?.message || 'Could not change the flash.', 'error');
    }
  }

  function _isCameraVoiceRealtimeTarget() {
    return String(cameraCaptureOptions?.target || '') === 'voice';
  }

  function stopCameraRealtimeOrb() {
    if (cameraOrbRaf) cancelAnimationFrame(cameraOrbRaf);
    cameraOrbRaf = 0;
    cameraCapture?.classList.remove('voice-realtime');
    cameraShutter?.classList.remove('voice-realtime');
    if (cameraOrbGl?.gl) {
      try { cameraOrbGl.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    }
    cameraOrbGl = null;
  }

  function _resizeCameraRealtimeOrbCanvas() {
    if (!cameraOrbCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = cameraOrbCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round((rect.width || cameraOrbCanvas.clientWidth || 76) * dpr));
    const height = Math.max(1, Math.round((rect.height || cameraOrbCanvas.clientHeight || 76) * dpr));
    if (cameraOrbCanvas.width !== width || cameraOrbCanvas.height !== height) {
      cameraOrbCanvas.width = width;
      cameraOrbCanvas.height = height;
      cameraOrbGl?.gl?.viewport?.(0, 0, width, height);
    }
  }

  function _initCameraRealtimeOrbGl() {
    if (cameraOrbGl || !cameraOrbCanvas) return cameraOrbGl;
    const gl = cameraOrbCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) return null;

    const vert = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
    const frag = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[8];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float sphere = length(uv);
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);
  vec3 col = vec3(0.0);

  for (int i = 0; i < 12; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float rim = smoothstep(0.50, 0.34, sphere);
  float edge = smoothstep(0.28, 0.52, sphere);
  col += vec3(1.0) * edge * 0.14;
  col *= rim;

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(max(lum, rim * 0.08), 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * uOpacity, alpha);
}
`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[camera orb] shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[camera orb] program link failed:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    const uniforms = {};
    [
      'uTime', 'uResolution', 'uColors', 'uColorCount', 'uStrandCount', 'uSpeed',
      'uAmplitude', 'uWaviness', 'uThickness', 'uGlow', 'uTaper', 'uSpread',
      'uHueShift', 'uIntensity', 'uOpacity', 'uScale', 'uSaturation',
    ].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, name); });
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    cameraOrbGl = { gl, program, buffer, position, uniforms };
    return cameraOrbGl;
  }

  function _cameraRealtimeOrbPalette() {
    const hex = ['#F97316', '#7C3AED', '#06B6D4', '#F472B6', '#EAB308'];
    const values = [];
    for (let i = 0; i < 8; i += 1) {
      const raw = hex[i] || hex[hex.length - 1];
      const value = raw.replace('#', '');
      values.push(
        parseInt(value.slice(0, 2), 16) / 255,
        parseInt(value.slice(2, 4), 16) / 255,
        parseInt(value.slice(4, 6), 16) / 255,
      );
    }
    return new Float32Array(values);
  }

  function _drawCameraRealtimeOrb(nowMs = performance.now()) {
    if (!_isCameraVoiceRealtimeTarget() || !cameraCapture || cameraCapture.hidden) {
      stopCameraRealtimeOrb();
      return;
    }
    cameraCapture.classList.add('voice-realtime');
    _resizeCameraRealtimeOrbCanvas();
    const state = _initCameraRealtimeOrbGl();
    if (state) {
      const { gl, program, buffer, position, uniforms } = state;
      const width = cameraOrbCanvas.width || 1;
      const height = cameraOrbCanvas.height || 1;
      const recording = !!cameraRecorder && cameraRecorder.state !== 'inactive';
      const t = nowMs * 0.001;
      const pulse = recording ? 0.78 : 0.36 + Math.sin(t * 1.45) * 0.08;
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform2f(uniforms.uResolution, width, height);
      gl.uniform3fv(uniforms.uColors, _cameraRealtimeOrbPalette());
      gl.uniform1i(uniforms.uColorCount, 5);
      gl.uniform1i(uniforms.uStrandCount, 5);
      gl.uniform1f(uniforms.uSpeed, recording ? 0.58 : 0.42);
      gl.uniform1f(uniforms.uAmplitude, 1.18 + pulse * 0.22);
      gl.uniform1f(uniforms.uWaviness, 1.3 + pulse * 0.04);
      gl.uniform1f(uniforms.uThickness, 0.9 + pulse * 0.05);
      gl.uniform1f(uniforms.uGlow, 1.86 + pulse * 0.42);
      gl.uniform1f(uniforms.uTaper, 4.3);
      gl.uniform1f(uniforms.uSpread, 1);
      gl.uniform1f(uniforms.uHueShift, 0);
      gl.uniform1f(uniforms.uIntensity, 0.46 + pulse * 0.26);
      gl.uniform1f(uniforms.uOpacity, 1);
      gl.uniform1f(uniforms.uScale, 1.78);
      gl.uniform1f(uniforms.uSaturation, 1.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    cameraOrbRaf = requestAnimationFrame(_drawCameraRealtimeOrb);
  }

  function startCameraRealtimeOrb() {
    if (!_isCameraVoiceRealtimeTarget() || cameraOrbRaf) return;
    cameraOrbRaf = requestAnimationFrame(_drawCameraRealtimeOrb);
  }

  function cameraVideoMimeType() {
    const candidates = _isIosSafariBrowser()
      ? ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return candidates.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  function cameraVideoExtension(mimeType = '') {
    return String(mimeType || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
  }

  function setCameraRecordingUi(recording) {
    cameraCapture?.classList.toggle('recording', !!recording);
    if (cameraRecordTimer) cameraRecordTimer.hidden = !recording;
    if (!recording && cameraRecordTimer) cameraRecordTimer.textContent = '0.0s';
    if (_isCameraVoiceRealtimeTarget()) startCameraRealtimeOrb();
  }

  function updateCameraRecordingTimer() {
    if (!cameraRecordTimer || !cameraRecordingStartedAt) return;
    const elapsed = Math.max(0, Date.now() - cameraRecordingStartedAt);
    cameraRecordTimer.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  }

  function clearCameraRecordingTimers() {
    if (cameraRecordingTimer) clearInterval(cameraRecordingTimer);
    if (cameraRecordingMaxTimer) clearTimeout(cameraRecordingMaxTimer);
    cameraRecordingTimer = null;
    cameraRecordingMaxTimer = null;
  }

  async function extractCameraVideoFrames(blob, options = {}) {
    const maxFrames = Math.max(1, Math.min(12, Number(options.maxFrames || 12) || 12));
    const quality = Math.max(0.45, Math.min(0.88, Number(options.quality || 0.72) || 0.72));
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    const waitFor = (eventName) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out reading video ${eventName}.`)), 4500);
      video.addEventListener(eventName, () => { clearTimeout(timeout); resolve(true); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not read recorded video.')); }, { once: true });
    });
    try {
      await waitFor('loadedmetadata');
      const duration = Math.min(12, Math.max(0.1, Number(video.duration || 0) || 0.1));
      const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration)));
      const canvas = document.createElement('canvas');
      // Downscale frames (longest side <= 640) so up to 12 of them fit in one
      // realtime data-channel message without exceeding the SCTP size limit.
      const rawW = Math.max(1, Number(video.videoWidth || cameraVideo?.videoWidth || 640) || 640);
      const rawH = Math.max(1, Number(video.videoHeight || cameraVideo?.videoHeight || 480) || 480);
      const frameScale = Math.min(1, 640 / Math.max(rawW, rawH));
      const width = Math.max(1, Math.round(rawW * frameScale));
      const height = Math.max(1, Math.round(rawH * frameScale));
      canvas.width = width;
      canvas.height = height;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('Could not sample video frames.');
      const frames = [];
      for (let i = 0; i < count; i += 1) {
        const rawT = count === 1 ? Math.min(0.08, duration / 2) : (duration * i) / Math.max(1, count - 1);
        const t = Math.min(Math.max(0.05, rawT), Math.max(0.05, duration - 0.05));
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timed out sampling video frame.')), 3500);
          video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(true); }, { once: true });
          video.currentTime = Math.max(0, t);
        });
        ctx2d.drawImage(video, 0, 0, width, height);
        frames.push({
          dataUrl: canvas.toDataURL('image/jpeg', quality),
          at: t,
          width,
          height,
          mimeType: 'image/jpeg',
          name: `video-frame-${i + 1}.jpg`,
        });
      }
      return { frames, durationMs: Math.round(duration * 1000), width, height };
    } finally {
      try { URL.revokeObjectURL(url); } catch {}
    }
  }

  async function handleCameraVideoBlob(blob, mimeType = '') {
    const type = mimeType || blob?.type || 'video/webm';
    const file = new File([blob], `prometheus-camera-video-${Date.now()}.${cameraVideoExtension(type)}`, { type });
    const target = String(cameraCaptureOptions?.target || 'chat');
    if (target === 'voice' && typeof cameraCaptureOptions?.onVideoCapture === 'function') {
      const onVideoCapture = cameraCaptureOptions.onVideoCapture;
      // ~1 frame/sec across the clip (12s cap → up to 12 frames) so the voice
      // agent gets a temporal sequence it can "watch".
      const sampled = await extractCameraVideoFrames(blob, { maxFrames: 12, quality: 0.72 });
      try {
        await onVideoCapture({ file, blob, mimeType: type, ...sampled });
      } finally {
        // Let the voice callback enqueue/inject the sampled frames before the
        // camera teardown clears the live-camera reader and response state.
        stopCameraCapture();
      }
      pmToast('Video frames sent to voice.', 'success');
      return;
    }
    const normalized = await _normalizeMobileFile(file);
    getPendingAttachments().push(normalized);
    renderPendingAttachments();
    stopCameraCapture();
    pmToast('Video attached.', 'success');
  }

  function stopCameraRecording() {
    if (!cameraRecorder) return;
    try {
      if (cameraRecorder.state !== 'inactive') cameraRecorder.stop();
    } catch {}
  }

  function startCameraRecording() {
    if (!cameraStream || cameraRecorder || typeof MediaRecorder === 'undefined') {
      if (typeof MediaRecorder === 'undefined') pmToast('Video recording is not available in this browser.', 'error');
      return;
    }
    const mimeType = cameraVideoMimeType();
    try {
      cameraRecordingChunks = [];
      cameraRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : undefined);
      cameraRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) cameraRecordingChunks.push(event.data);
      });
      cameraRecorder.addEventListener('stop', () => {
        const chunks = cameraRecordingChunks.slice();
        const finalType = mimeType || cameraRecorder?.mimeType || chunks[0]?.type || 'video/webm';
        cameraRecorder = null;
        cameraRecordingChunks = [];
        clearCameraRecordingTimers();
        setCameraRecordingUi(false);
        cameraSuppressClick = true;
        if (!chunks.length) {
          setCameraStatus('');
          pmToast('No video was recorded.', 'info');
          return;
        }
        setCameraStatus('Processing video...');
        handleCameraVideoBlob(new Blob(chunks, { type: finalType }), finalType)
          .catch((err) => {
            setCameraStatus('');
            pmToast(err?.message || 'Could not process video.', 'error');
          });
      });
      cameraRecorder.start(250);
      cameraRecordingStartedAt = Date.now();
      setCameraRecordingUi(true);
      updateCameraRecordingTimer();
      cameraRecordingTimer = setInterval(updateCameraRecordingTimer, 100);
      cameraRecordingMaxTimer = setTimeout(stopCameraRecording, CAMERA_RECORD_MAX_MS);
      setCameraStatus('Recording...');
    } catch (err) {
      cameraRecorder = null;
      clearCameraRecordingTimers();
      setCameraRecordingUi(false);
      pmToast(err?.message || 'Could not start video recording.', 'error');
    }
  }

  function stopCameraCapture() {
    if (cameraPairScanTimer) cancelAnimationFrame(cameraPairScanTimer);
    cameraPairScanTimer = null;
    cameraPairScanDetector = null;
    cameraPairScanCanvas = null;
    cameraPairScanContext = null;
    cameraPairScanLastAt = 0;
    cameraPairScanBusy = false;
    if (cameraHoldTimer) clearTimeout(cameraHoldTimer);
    cameraHoldTimer = null;
    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
      try { cameraRecorder.stop(); } catch {}
    }
    cameraRecorder = null;
    cameraRecordingChunks = [];
    cameraRecordingStartedAt = 0;
    clearCameraRecordingTimers();
    setCameraRecordingUi(false);
    setCameraMoreMenuOpen(false);
    setCameraTorchUi(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      cameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
    cameraPinchZoom?.reset();
    if (cameraCapture) {
      cameraCapture.classList.remove('open');
      setTimeout(() => {
        if (!cameraCapture.classList.contains('open')) {
          cameraCapture.hidden = true;
          document.body.classList.remove('pm-camera-open');
        }
      }, 180);
    } else document.body.classList.remove('pm-camera-open');
    cameraOpening = false;
    cameraCaptureOptions = { target: 'chat', onCapture: null, onVideoCapture: null };
    cameraShutter?.removeAttribute('disabled');
    stopCameraRealtimeOrb();
    stopVoiceCameraFrameCache();
  }

  async function openCameraCapture(options = {}) {
    const target = String(options.target || 'chat').trim() || 'chat';
    closeAttachSheet();
    if (!navigator.mediaDevices?.getUserMedia) {
      pmToast('Camera preview is not available in this browser.', 'error');
      return;
    }
    if (!cameraCapture || !cameraVideo) return;
    stopCameraCapture();
    cameraCaptureOptions = {
      target,
      onCapture: typeof options.onCapture === 'function' ? options.onCapture : null,
      onVideoCapture: typeof options.onVideoCapture === 'function' ? options.onVideoCapture : null,
    };
    cameraOpening = true;
    document.body.classList.add('pm-camera-open');
    setCameraMoreMenuOpen(false);
    setCameraTorchUi(false);
    cameraCapture.hidden = false;
    const voiceTarget = target === 'voice';
    cameraCapture.classList.toggle('voice-realtime', voiceTarget);
    cameraShutter?.classList.toggle('voice-realtime', voiceTarget);
    cameraShutter?.setAttribute('aria-label', voiceTarget ? 'Capture image or hold to record video' : 'Take picture');
    startCameraRealtimeOrb();
    setCameraStatus('Opening camera...');
    requestAnimationFrame(() => cameraCapture.classList.add('open'));
    try {
      const constraints = {
        video: {
          facingMode: { ideal: cameraFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStream = stream;
      const track = stream.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.() || {};
      cameraFlash?.toggleAttribute('disabled', !capabilities.torch);
      cameraPinchZoom?.setTrack(track);
      if (track?.applyConstraints && track.getCapabilities) {
        try {
          const capabilities = track.getCapabilities();
          const qualityConstraints = {};
          const maxWidth = Number(capabilities.width?.max || 0);
          const maxHeight = Number(capabilities.height?.max || 0);
          if (maxWidth >= 1920) qualityConstraints.width = { ideal: Math.min(maxWidth, 2560) };
          if (maxHeight >= 1440) qualityConstraints.height = { ideal: Math.min(maxHeight, 1920) };
          if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
            qualityConstraints.focusMode = 'continuous';
          }
          if (Object.keys(qualityConstraints).length) await track.applyConstraints(qualityConstraints);
        } catch (err) {
          console.debug('[mobile camera] high-quality constraints unavailable:', err?.message || err);
        }
      }
      cameraVideo.srcObject = stream;
      cameraVideo.muted = true;
      cameraVideo.setAttribute('playsinline', '');
      await cameraVideo.play();
      setCameraStatus('');
      if (target === 'voice') startVoiceCameraFrameCache();
    } catch (err) {
      stopCameraCapture();
      pmToast(err?.message || 'Could not open camera.', 'error');
    } finally {
      cameraOpening = false;
    }
  }

  async function flipCameraCapture() {
    if (cameraOpening) return;
    const options = cameraCaptureOptions || { target: 'chat', onCapture: null };
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    await openCameraCapture(options);
  }

  function decodePairingQrFrameWithJsQr() {
    if (typeof window.jsQR !== 'function' || !cameraVideo) return '';
    const rawWidth = Number(cameraVideo.videoWidth || 0);
    const rawHeight = Number(cameraVideo.videoHeight || 0);
    if (!rawWidth || !rawHeight) return '';
    const maxDimension = 960;
    const scale = Math.min(1, maxDimension / Math.max(rawWidth, rawHeight));
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    if (!cameraPairScanCanvas) cameraPairScanCanvas = document.createElement('canvas');
    if (cameraPairScanCanvas.width !== width || cameraPairScanCanvas.height !== height) {
      cameraPairScanCanvas.width = width;
      cameraPairScanCanvas.height = height;
      cameraPairScanContext = cameraPairScanCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!cameraPairScanContext) return '';
    cameraPairScanContext.drawImage(cameraVideo, 0, 0, width, height);
    const frame = cameraPairScanContext.getImageData(0, 0, width, height);
    const code = window.jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
    return String(code?.data || '').trim();
  }

  async function startPairingQrScan() {
    const hasNativeQrDecoder = typeof window.BarcodeDetector === 'function';
    const hasBundledQrDecoder = typeof window.jsQR === 'function';
    if (!hasNativeQrDecoder && !hasBundledQrDecoder) {
      pmToast('QR scanning is unavailable in this browser. Use Gateway Connections → Add gateway and enter the short-lived pair code.', 'info');
      return false;
    }
    cameraPairScanDetector = null;
    if (hasNativeQrDecoder) {
      try {
        cameraPairScanDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        cameraPairScanDetector = null;
      }
    }
    if (!cameraPairScanDetector && !hasBundledQrDecoder) {
      pmToast('This camera does not expose a safe QR decoder. Use the pair-code fallback.', 'info');
      return false;
    }
    await openCameraCapture({ target: 'pairing' });
    if (!cameraStream || !cameraVideo || (!cameraPairScanDetector && !hasBundledQrDecoder)) return false;
    cameraPairScanBusy = false;
    cameraPairScanLastAt = 0;
    cameraShutter?.setAttribute('disabled', 'disabled');
    cameraShutter?.setAttribute('aria-label', 'QR scanner active');
    setCameraStatus('Point the camera at a Prometheus pairing QR');
    const scan = async (now = performance.now()) => {
      if (!cameraStream || cameraCapture?.hidden || cameraCaptureOptions?.target !== 'pairing') return;
      if (!cameraPairScanBusy && now - cameraPairScanLastAt >= 140) {
        cameraPairScanBusy = true;
        cameraPairScanLastAt = now;
        try {
          const raw = cameraPairScanDetector
            ? String((await cameraPairScanDetector.detect(cameraVideo))?.[0]?.rawValue || '').trim()
            : decodePairingQrFrameWithJsQr();
          if (raw) {
            let parsedUrl = null;
            try { parsedUrl = new URL(raw); } catch {}
            const pairValue = parsedUrl && ['http:', 'https:'].includes(parsedUrl.protocol)
              ? parsedUrl.searchParams.get('pair')
              : '';
            const payload = getPairingPayload(pairValue || '');
            if (payload && payload.origin === parsedUrl.origin) {
              stopCameraCapture();
              // This is the deliberate multi-gateway path. Keep the current
              // PWA document/origin so its catalog remains the hub, then let
              // the pairing page claim and poll the scanned target directly.
              // The validated payload is the only thing carried forward;
              // arbitrary QR URLs and unrelated query data are discarded.
              if (!setPendingGatewayPair(pairValue)) {
                setCameraStatus('That pairing QR is no longer valid');
                cameraPairScanBusy = false;
                return;
              }
              navigate?.('#mobile/pair/add');
              return;
            }
            setCameraStatus('That is not a valid Prometheus pairing QR');
          }
        } catch {}
        cameraPairScanBusy = false;
      }
      cameraPairScanTimer = requestAnimationFrame(scan);
    };
    cameraPairScanTimer = requestAnimationFrame(scan);
    return true;
  }

  const previousPairingScanner = window.__pmMobilePairingScanner;
  const pairingScannerBridge = () => { startPairingQrScan().catch(() => {}); };
  window.__pmMobilePairingScanner = pairingScannerBridge;
  try {
    if (sessionStorage.getItem('pm_open_pairing_scanner') === '1') {
      sessionStorage.removeItem('pm_open_pairing_scanner');
      setTimeout(() => startPairingQrScan().catch(() => {}), 120);
    }
  } catch {}

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.96) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture camera frame.'));
      }, type, quality);
    });
  }

  function readCameraFrameDataUrl(maxDim = 1024, quality = 0.78) {
    if (!cameraVideo || !cameraStream) return null;
    const capturedAt = Date.now();
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) return null;
    const scale = Math.min(1, Math.max(320, Number(maxDim) || 1024) / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', Math.max(0.5, Math.min(0.9, Number(quality) || 0.78))),
      width: canvas.width,
      height: canvas.height,
      capturedAt,
      encodedAt: Date.now(),
      frameId: `chat_camera_${++voiceCameraFrameSequence}`,
    };
  }

  function stopVoiceCameraFrameCache() {
    const restoreRealtimeResponseCreation = __pmRealtimeAgent?.liveCameraFrameReader === voiceCameraLiveFrameReader
      && (__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening';
    const restoreViaTurnGate = __pmRealtimeAgent?.liveCameraVision?.responseGateActive === true;
    if (voiceCameraFrameCacheTimer) clearInterval(voiceCameraFrameCacheTimer);
    voiceCameraFrameCacheTimer = null;
    voiceCameraFrameCache = null;
    voiceCameraFrameCacheRefreshPending = false;
    voiceCameraFrameCacheRefreshPromise = null;
    if (__pmRealtimeAgent?.liveCameraFrameReader === voiceCameraLiveFrameReader) {
      __pmRealtimeAgent.liveCameraFrameReader = null;
    }
    if (__pmRealtimeAgent?.liveCameraFrameAsyncReader === refreshVoiceCameraFrameCache) {
      __pmRealtimeAgent.liveCameraFrameAsyncReader = null;
    }
    voiceCameraLiveFrameReader = null;
    if (restoreRealtimeResponseCreation || restoreViaTurnGate || __pmRealtimeAgent?.cameraRuntime?.open === true) {
      _setMobileRealtimeCameraRuntime(false, { source: 'chat_camera', reason: 'chat_camera_closed' });
    }
    _stopMobileRealtimeLiveCameraVision('camera_closed');
    if (restoreRealtimeResponseCreation && !restoreViaTurnGate) _sendMobileRealtimeAgentCreateResponseFlag(true);
    if (__pmRealtimeAgent?.autoCaptureCameraFrames === autoCaptureVoiceCameraFrames) {
      __pmRealtimeAgent.autoCaptureCameraFrames = null;
    }
  }

  function readVoiceCameraFrameDataUrlAsync(maxDim = 768, quality = 0.68) {
    if (!cameraVideo || !cameraStream) return Promise.resolve(null);
    const capturedAt = Date.now();
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) return Promise.resolve(null);
    const scale = Math.min(1, Math.max(320, Number(maxDim) || 768) / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(readCameraFrameDataUrl(maxDim, quality));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve({
          dataUrl: String(reader.result || ''),
          width: canvas.width,
          height: canvas.height,
          capturedAt,
          encodedAt: Date.now(),
          frameId: `chat_camera_${++voiceCameraFrameSequence}`,
        });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }, 'image/jpeg', Math.max(0.5, Math.min(0.9, Number(quality) || 0.68)));
    });
  }

  async function refreshVoiceCameraFrameCache(options = {}) {
    if (String(cameraCaptureOptions?.target || '') !== 'voice') return voiceCameraFrameCache;
    const force = options?.force === true;
    const requestedAt = Date.now();
    const previous = voiceCameraFrameCacheRefreshPromise;
    if (previous) {
      let previousTimedOut = false;
      const existing = await _awaitMobileRealtimeCameraOperation(
        () => previous,
        900,
        () => { previousTimedOut = true; },
      );
      if (previousTimedOut) {
        _voiceDebug('realtime-agent-live-camera-cache-refresh-timeout', { force });
        // A stalled toBlob/FileReader must not poison every later turn-boundary
        // refresh by leaving the old promise as the only cache source.
      } else {
        const existingCapturedAt = Number(existing?.capturedAt || 0) || 0;
        // A turn-boundary request may await a cache refresh that started a few
        // milliseconds earlier, but it must not accept an older timer result as
        // the turn's frame when that refresh has already gone stale.
        if (!force || existingCapturedAt >= requestedAt - 150) return existing;
      }
    }
    // Live vision is sampled once per spoken second. Keep those frames lighter
    // than a user-captured photo. `toBlob`/FileReader keeps JPEG encoding off
    // the synchronous live-audio read path on iOS. A forced read retries briefly
    // while Safari finishes exposing the first video frame.
    const work = (async () => {
      let frame = null;
      for (let attempt = 0; attempt < (force ? 3 : 1); attempt++) {
        frame = await _awaitMobileRealtimeCameraOperation(
          () => readVoiceCameraFrameDataUrlAsync(768, 0.68),
          force ? 500 : 800,
        );
        if (frame?.dataUrl) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (frame?.dataUrl && String(cameraCaptureOptions?.target || '') === 'voice' && cameraStream) {
        voiceCameraFrameCache = frame;
      }
      return frame?.dataUrl ? frame : (force ? null : voiceCameraFrameCache);
    })().catch(() => (force ? null : voiceCameraFrameCache));
    let promise = null;
    promise = work.finally(() => {
      if (voiceCameraFrameCacheRefreshPromise === promise) voiceCameraFrameCacheRefreshPromise = null;
    });
    voiceCameraFrameCacheRefreshPromise = promise;
    return promise;
  }

  function scheduleVoiceCameraFrameCacheRefresh() {
    if (voiceCameraFrameCacheRefreshPending || String(cameraCaptureOptions?.target || '') !== 'voice') return;
    voiceCameraFrameCacheRefreshPending = true;
    const run = () => {
      voiceCameraFrameCacheRefreshPending = false;
      if (String(cameraCaptureOptions?.target || '') === 'voice' && cameraStream) refreshVoiceCameraFrameCache();
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 900 });
    else setTimeout(run, 0);
  }

  function startVoiceCameraFrameCache() {
    stopVoiceCameraFrameCache();
    __pmRealtimeAgent.autoCaptureCameraFrames = autoCaptureVoiceCameraFrames;
    voiceCameraLiveFrameReader = () => {
      const now = Date.now();
      const cached = voiceCameraFrameCache;
      if (cached?.dataUrl && now - Number(cached.capturedAt || 0) >= 2000) scheduleVoiceCameraFrameCacheRefresh();
      // Never synchronously JPEG-encode a fresh frame from the audio/live-feed
      // read path. A slightly older cached frame is preferable to blocking the
      // realtime output callback while the camera is open.
      const frame = cached?.dataUrl ? cached : null;
      return frame?.dataUrl ? { ...frame } : null;
    };
    __pmRealtimeAgent.liveCameraFrameReader = voiceCameraLiveFrameReader;
    __pmRealtimeAgent.liveCameraFrameAsyncReader = refreshVoiceCameraFrameCache;
    _setMobileRealtimeCameraRuntime(true, { source: 'chat_camera', reason: 'chat_camera_opened' });
    _startMobileRealtimeLiveCameraVision('chat_camera_opened');
    // Disable server-VAD auto responses before the first camera turn reaches
    // speech_stopped. Sending this at camera-open time closes the race where
    // response.created arrives before the per-turn camera gate can be applied.
    if ((__pmRealtimeAgent.conn?.listenMode || __pmRealtimeAgent.listenMode) === 'always_listening') {
      _sendMobileRealtimeAgentCreateResponseFlag(false);
    }
    refreshVoiceCameraFrameCache();
    voiceCameraFrameCacheTimer = setInterval(scheduleVoiceCameraFrameCacheRefresh, 1000);
  }

  function stageVoiceCameraDataUrl(dataUrl, sid, name, options = {}) {
    const url = String(dataUrl || '').trim();
    if (!url.startsWith('data:image')) return false;
    _stageMobileRealtimeAgentImage({
      dataUrl: url,
      name: name || `Live camera frame ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`,
      mimeType: 'image/jpeg',
      base64: '',
    }, sid, { toast: options.toast !== false });
    return true;
  }

  async function autoCaptureVoiceCameraFrames(reason = 'speech_started', options = {}) {
    if (String(cameraCaptureOptions?.target || '') !== 'voice') return false;
    if (!cameraStream || !cameraVideo || cameraOpening || cameraRecorder) return false;
    if (!_voiceAttachmentSessionAvailable()) return false;
    const now = Date.now();
    const cooldownMs = Math.max(400, Number(options.cooldownMs || 1400) || 1400);
    if (voiceCameraAutoCaptureInFlight || now - voiceCameraAutoCaptureLastAt < cooldownMs) return false;
    voiceCameraAutoCaptureLastAt = now;
    voiceCameraAutoCaptureInFlight = (async () => {
      let sid = _voiceAttachmentSessionId();
      if (sid === MOBILE_CHAT_SESSION_ID) {
        sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'voice_camera_auto_session_created' });
      }
      const frames = [];
      let cached = voiceCameraFrameCache && now - Number(voiceCameraFrameCache.capturedAt || 0) < 2600
        ? voiceCameraFrameCache
        : await refreshVoiceCameraFrameCache();
      if (cached?.dataUrl) frames.push(cached);
      const wantCount = Math.max(1, Math.min(2, Number(options.count || 2) || 2));
      if (frames.length < wantCount) {
        await new Promise((resolve) => setTimeout(resolve, 260));
        const fresh = await refreshVoiceCameraFrameCache();
        if (fresh?.dataUrl && fresh.dataUrl !== frames[0]?.dataUrl) frames.push(fresh);
      }
      const staged = [];
      frames.slice(0, wantCount).forEach((frame, index) => {
        if (stageVoiceCameraDataUrl(frame.dataUrl, sid, index === 0 ? 'Live camera view' : 'Live camera follow-up view', { toast: false })) {
          staged.push(frame.dataUrl);
        }
      });
      if (staged.length) {
        _voiceDebug('voice-camera-auto-captured', { reason, frames: staged.length });
      }
      return staged.length > 0;
    })().catch((err) => {
      _voiceDebug('voice-camera-auto-capture-failed', { reason, message: err?.message || String(err) });
      return false;
    }).finally(() => {
      voiceCameraAutoCaptureInFlight = null;
    });
    return voiceCameraAutoCaptureInFlight;
  }

  async function captureCameraFrame() {
    if (!cameraVideo || !cameraStream) return;
    try { pmHaptic?.(12); } catch {}
    const width = Number(cameraVideo.videoWidth || 0);
    const height = Number(cameraVideo.videoHeight || 0);
    if (!width || !height) {
      pmToast('Camera is still warming up.', 'info');
      return;
    }
    try {
      setCameraStatus('Capturing...');
      let blob = null;
      const track = cameraStream.getVideoTracks?.()[0];
      if (track && typeof window.ImageCapture === 'function' && (cameraPinchZoom?.hasHardwareZoom?.() || (cameraPinchZoom?.getZoom?.() || 1) <= 1.001)) {
        try {
          const imageCapture = new window.ImageCapture(track);
          const photoCapabilities = await imageCapture.getPhotoCapabilities?.();
          const photoSettings = {};
          const photoWidth = Number(photoCapabilities?.imageWidth?.max || 0);
          const photoHeight = Number(photoCapabilities?.imageHeight?.max || 0);
          if (photoWidth > 0) photoSettings.imageWidth = photoWidth;
          if (photoHeight > 0) photoSettings.imageHeight = photoHeight;
          blob = await imageCapture.takePhoto(photoSettings);
        } catch (err) {
          console.debug('[mobile camera] still capture fallback:', err?.message || err);
        }
      }
      if (!blob) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not prepare camera capture.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const zoom = Math.max(1, Number(cameraPinchZoom?.getZoom?.() || 1) || 1);
        const sourceWidth = width / zoom;
        const sourceHeight = height / zoom;
        const sourceX = (width - sourceWidth) / 2;
        const sourceY = (height - sourceHeight) / 2;
        ctx.drawImage(cameraVideo, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
        blob = await canvasToBlob(canvas);
      }
      const mimeType = blob.type || 'image/jpeg';
      const file = new File([blob], `prometheus-camera-${Date.now()}.jpg`, { type: mimeType });
      const normalized = await _normalizeMobileFile(file);
      const target = String(cameraCaptureOptions?.target || 'chat');
      if (target === 'voice' && typeof cameraCaptureOptions?.onCapture === 'function') {
        const onCapture = cameraCaptureOptions.onCapture;
        try {
          await onCapture(normalized, { file, dataUrl: normalized.dataUrl, blob });
        } finally {
          // The callback owns voice delivery. Do not invalidate its
          // connection/reader until the captured image has been delivered.
          stopCameraCapture();
        }
      } else {
        getPendingAttachments().push(normalized);
        renderPendingAttachments();
        stopCameraCapture();
      }
      pmToast(target === 'voice' ? 'Snapshot sent to voice.' : 'Snapshot attached.', 'success');
    } catch (err) {
      setCameraStatus('');
      pmToast(err?.message || 'Could not capture image.', 'error');
    }
  }

  _renderThread(threadEl);
  _scrollChat(body);
  renderPendingAttachments();

  function scheduleMobileRunRecovery(delay = 2500, { force = false, fullRefresh = false } = {}) {
    // A page that has been replaced can still finish an old promise and call
    // this helper. It must not cancel or replace the current page's recovery
    // timer for the same session.
    if (!isMobileRecoveryOwner()) return;
    const sid = String(requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    const remembered = _readMobileActiveRun(sid);
    const busy = !!(__pmChat.activeRuns?.[sid]?.busy || __pmChat.drawerRunSessionIds?.has?.(sid));
    if (!force && !remembered && !busy) return;
    if (__pmChat.recoverTimer) clearTimeout(__pmChat.recoverTimer);
    __pmChat.recoverTimer = setTimeout(() => refreshMobileRunRecovery({ silent: true, force, fullRefresh }), Math.max(250, Number(delay) || 2500));
  }

  const recoverVisibleMobileActiveRun = (sessionId, options = {}) => {
    const sid = String(sessionId || '').trim();
    if (!sid || sid !== requestedSession || String(__pmChat.activeSessionId || '').trim() !== sid) return false;
    // Replay first; a full history fetch is unnecessary here and can race the
    // just-rendered dev_apply status message.
    scheduleMobileRunRecovery(0, { force: true, fullRefresh: options.fullRefresh === true });
    return true;
  };
  window.__pmMobileRecoverActiveChatRun = recoverVisibleMobileActiveRun;

  let gatewayStatusInFlight = false;
  let gatewayStatusFailures = 0;
  function updateOnlineStatus() {
    // The pill is now the interactive model badge (.pm-model-badge): it shows the
    // current model name, not the literal "Online"/"Offline" text. We only toggle
    // the green/red dot via the .offline class so we don't clobber the label or
    // the embedded native haptic switch.
    const pill = page.querySelector('.pm-model-badge') || page.querySelector('.pm-online');
    if (!pill) return;
    if (gatewayStatusInFlight) return;
    gatewayStatusInFlight = true;
    const wasOffline = pill.classList.contains('offline');
    loadGatewayStatus({ timeoutMs: 30000 })
      .then(() => {
        gatewayStatusFailures = 0;
        pill.classList.remove('offline');
        if (wasOffline) scheduleMobileRunRecovery(250, { force: true, fullRefresh: true });
      })
      .catch(() => {
        gatewayStatusFailures += 1;
        if (gatewayStatusFailures >= 3) {
          pill.classList.add('offline');
        }
      })
      .finally(() => {
        gatewayStatusInFlight = false;
      });
  }

  function setChatConnectionStatus(visible, text = 'Reconnecting to Prometheus', options = {}) {
    if (!connectionStatus) return;
    if (connectionStatusHideTimer) {
      clearTimeout(connectionStatusHideTimer);
      connectionStatusHideTimer = null;
    }
    if (connectionStatusSuccessTimer) {
      clearTimeout(connectionStatusSuccessTimer);
      connectionStatusSuccessTimer = null;
    }
    const mode = String(options.mode || '').trim();
    const apply = () => {
      connectionStatus.querySelector('.pm-chat-connection-text')?.replaceChildren(document.createTextNode(text));
      connectionStatus.hidden = !visible;
      connectionStatus.classList.toggle('visible', !!visible);
      connectionStatus.classList.toggle('success', visible && mode === 'success');
      page?.classList.toggle('pm-chat-status-priority-active', !!visible);
      updateChatComposerSpace();
    };
    const delayMs = Math.max(0, Number(options.delayMs || 0) || 0);
    if (!visible && delayMs > 0) {
      connectionStatusHideTimer = setTimeout(() => {
        connectionStatusHideTimer = null;
        apply();
      }, delayMs);
      return;
    }
    apply();
  }

  const showReconnectingStatus = (msg = {}) => {
    const waitingForNetwork = String(msg?.type || '') === 'ws:waiting_for_network';
    setChatConnectionStatus(true, waitingForNetwork ? 'Waiting for network' : 'Reconnecting to Prometheus');
  };
  const hideReconnectingStatus = () => {
    if (connectionStatus && !connectionStatus.hidden && connectionStatus.classList.contains('visible')) {
      setChatConnectionStatus(true, 'Prometheus Reconnected', { mode: 'success' });
      connectionStatusSuccessTimer = setTimeout(() => {
        connectionStatusSuccessTimer = null;
        setChatConnectionStatus(false, 'Prometheus Reconnected', { mode: 'success', delayMs: 180 });
      }, 950);
      return;
    }
    setChatConnectionStatus(false, 'Reconnecting to Prometheus', { delayMs: 180 });
  };
  if (__pmChat.statusTimer) clearInterval(__pmChat.statusTimer);
  updateOnlineStatus();
  __pmChat.statusTimer = setInterval(updateOnlineStatus, 7000);
  wsEventBus?.on?.('ws:reconnecting', showReconnectingStatus);
  wsEventBus?.on?.('ws:waiting_for_network', showReconnectingStatus);
  wsEventBus?.on?.('ws:timeout', showReconnectingStatus);
  wsEventBus?.on?.('ws:error', showReconnectingStatus);
  wsEventBus?.on?.('ws:open', hideReconnectingStatus);

  let chatLoadRetryTimer = null;
  const clearChatLoadRetryTimer = () => {
    if (chatLoadRetryTimer) {
      clearTimeout(chatLoadRetryTimer);
      chatLoadRetryTimer = null;
    }
  };
  const showChatLoadRetry = (message = 'Chat is taking too long to load.') => {
    if (!isCurrentMobilePage()) return;
    if (__pmChat.threads[requestedSession]?.length) return;
    threadEl.innerHTML = `
      <div class="pm-chat-loading error">
        <div>${escapeHtml(message)}</div>
        <button class="pm-btn primary" type="button" data-action="retry-load-chat">Retry</button>
      </div>
    `;
    setChatConnectionStatus(true, 'Chat load stalled');
    updateChatComposerSpace();
  };
  threadEl.addEventListener('click', (event) => {
    const retry = event.target?.closest?.('[data-action="retry-load-chat"]');
    if (!retry) return;
    event.preventDefault();
    invalidateMobileChatSessionCache(requestedSession);
    renderChatPage(page, { navigate, sessionId: requestedSession });
  });

  // Register recovery ownership before starting the initial history request.
  // This lets a later render invalidate the old request even if both renders
  // target the same session id.
  const mobileRecoveryOwnerToken = `mobile_recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let mobileRecoveryDisposed = false;
  __pmChat.mobileRecoveryOwners[requestedSession] = mobileRecoveryOwnerToken;
  const isMobileRecoveryOwner = () => !mobileRecoveryDisposed
    && isCurrentMobilePage()
    && __pmChat.mobileRecoveryOwners[requestedSession] === mobileRecoveryOwnerToken;

  let initialSessionLoadPending = false;
  if (!__pmChat.threads[requestedSession]?.length && requestedSession !== MOBILE_CHAT_SESSION_ID) {
    initialSessionLoadPending = true;
    // Render localStorage skeleton immediately so the user sees content at once
    const cachedThread = _loadMobileThreadCache(requestedSession);
    if (cachedThread.length) {
      __pmChat.threads[requestedSession] = cachedThread;
      _activeMobileThread();
      _commitMobileTranscriptCache(requestedSession, 'mobile-cache-hydration');
      _renderThread(threadEl);
      _scrollChat(body);
    } else {
      threadEl.innerHTML = '<div class="pm-chat-loading">Loading chat...</div>';
      setChatConnectionStatus(true, 'Loading chat');
    }
    chatLoadRetryTimer = setTimeout(() => {
      showChatLoadRetry('Chat load timed out. Prometheus may be restarting or the session request stalled.');
    }, 20_000);
    // The local skeleton already provides the instant paint. Always reconcile
    // the visible chat against the gateway instead of accepting a 30s API copy.
    gatewayExecutionRefresh.then(() => loadMobileChatSession(requestedSession, {
      force: true,
      historyLimit: PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE,
      processLimit: 60,
      fullProcess: false,
    }))
      .then((session) => {
        if (!isMobileRecoveryOwner()) return;
        clearChatLoadRetryTimer();
        hideReconnectingStatus();
        targetProjectId = String(session?.projectId || session?.project?.id || '').trim();
        targetProjectLabel = String(session?.projectName || session?.project?.name || '').trim();
        targetWorkspaceLabel = String(session?.workspaceName || session?.workspace?.name || gatewayTarget?.workspaceName || '').trim();
        if (requestedSession !== MOBILE_CHAT_SESSION_ID) {
          const sessionGateway = currentChatGateway();
          _saveMobileLastChatContext({
            gatewayId: sessionGateway?.gatewayId || pendingGatewayId,
            gatewayName: sessionGateway?.name || '',
            projectId: targetProjectId,
            projectName: targetProjectLabel,
          });
        }
        renderChatTargetChip();
        renderChatProjectChip();
        _rememberMobileSessionGoal(session, requestedSession);
        _renderMobileGoalPill(goalStrip, requestedSession);
        updateChatComposerSpace();
        const history = Array.isArray(session?.history) ? session.history : [];
        __pmChat.historyPagination[requestedSession] = {
          loading: false,
          loadedHistoryCount: history.length,
          totalHistoryCount: Number(session?.totalHistoryCount || history.length) || history.length,
          historyTruncated: session?.historyTruncated === true,
          olderCursor: String(session?.historyPage?.olderCursor || '').trim() || null,
        };
        const localThread = __pmChat.threads[requestedSession] || [];
        __pmChat.threads[requestedSession] = _mergeMobileSessionThreadWithLocal(requestedSession, history, localThread, {
          preserveLocalHistory: _mobileHistoryPageIsPartial(session, history),
        });
        mobileChatRuntimeAdapter.syncInitial(requestedSession, session, __pmChat.threads[requestedSession]);
        _activeMobileThread();
        _renderThread(threadEl);
        _scrollChat(body);
        // Persist this fresh render to localStorage for the next cold open
        _saveMobileThreadCache(requestedSession, __pmChat.threads[requestedSession] || []);
        // Session was just freshly loaded — skip the redundant re-fetch in
        // refreshMobileRunRecovery by using fullRefresh:false. The run status
        // check still fires to detect active runs and replay missed events.
        refreshMobileRunRecovery({ silent: true, force: true, fullRefresh: false });
      })
      .catch((err) => {
        if (!isMobileRecoveryOwner()) return;
        clearChatLoadRetryTimer();
        if (!__pmChat.threads[requestedSession]?.length) {
          showChatLoadRetry(`Could not load chat: ${err.message || 'Unknown error'}`);
          setChatConnectionStatus(true, 'Reconnecting to Prometheus');
        } else {
          pmToast('Showing cached chat while Prometheus reconnects.', 'info');
          setChatConnectionStatus(true, 'Reconnecting to Prometheus');
        }
      })
      .finally(() => {
        initialSessionLoadPending = false;
      });
  }
  if (requestedSession !== MOBILE_CHAT_SESSION_ID) {
    _restoreMobileVoiceWorkgroupsForSession(requestedSession).catch(() => {});
  }

  let mobileRecoveryInFlight = null;
  let mobileRecoveryInFlightOptions = null;
  let queuedMobileRecovery = null;

  function mergeMobileRecoveryOptions(current = null, next = {}) {
    return {
      silent: (current?.silent ?? true) && next.silent !== false,
      force: current?.force === true || next.force === true,
      fullRefresh: current?.fullRefresh === true || next.fullRefresh === true,
    };
  }

  async function refreshMobileRunRecovery(options = {}) {
    if (!isMobileRecoveryOwner()) return null;
    const requestedOptions = mergeMobileRecoveryOptions(null, options);
    if (mobileRecoveryInFlight) {
      const current = mobileRecoveryInFlightOptions || {};
      const alreadyCovered = (current.force === true || requestedOptions.force !== true)
        && (current.fullRefresh === true || requestedOptions.fullRefresh !== true)
        && (current.silent === false || requestedOptions.silent !== false);
      if (alreadyCovered) return mobileRecoveryInFlight;
      queuedMobileRecovery = mergeMobileRecoveryOptions(queuedMobileRecovery, requestedOptions);
      return mobileRecoveryInFlight;
    }
    const request = _performMobileRunRecovery(requestedOptions);
    mobileRecoveryInFlight = request;
    mobileRecoveryInFlightOptions = requestedOptions;
    try {
      return await request;
    } finally {
      if (mobileRecoveryInFlight === request) mobileRecoveryInFlight = null;
      mobileRecoveryInFlightOptions = null;
      const queued = queuedMobileRecovery;
      queuedMobileRecovery = null;
      if (queued && isMobileRecoveryOwner()) {
        setTimeout(() => refreshMobileRunRecovery(queued), 0);
      }
    }
  }

  async function _performMobileRunRecovery({ silent = false, force = false, fullRefresh = false } = {}) {
    const remembered = _readMobileActiveRun(requestedSession);
    const startingRun = __pmChat.activeRuns?.[requestedSession] || {};
    const recoveryIdentity = {
      clientRequestId: String(startingRun.clientRequestId || remembered?.clientRequestId || '').trim(),
      runtimeId: String(startingRun.runtimeId || remembered?.runtimeId || '').trim(),
      startedAt: Number(startingRun.startedAt || remembered?.startedAt || 0) || 0,
    };
    const startingWasBusy = startingRun.busy === true || !!remembered;
    const isCurrentRecoveryTarget = () => {
      if (!isMobileRecoveryOwner()) return false;
      const current = __pmChat.activeRuns?.[requestedSession] || {};
      const currentRemembered = _readMobileActiveRun(requestedSession) || {};
      const currentClientRequestId = String(current.clientRequestId || currentRemembered.clientRequestId || '').trim();
      const currentRuntimeId = String(current.runtimeId || currentRemembered.runtimeId || '').trim();
      const currentStartedAt = Number(current.startedAt || currentRemembered.startedAt || 0) || 0;
      if (!startingWasBusy && current.busy === true) return false;
      if (recoveryIdentity.clientRequestId && currentClientRequestId && recoveryIdentity.clientRequestId !== currentClientRequestId) return false;
      if (!recoveryIdentity.clientRequestId && recoveryIdentity.runtimeId && currentRuntimeId && recoveryIdentity.runtimeId !== currentRuntimeId) return false;
      if (!recoveryIdentity.clientRequestId && !recoveryIdentity.runtimeId
        && recoveryIdentity.startedAt > 0 && currentStartedAt > recoveryIdentity.startedAt + 1000) return false;
      return true;
    };
    try {
      // ── Parallel batch 1: run-status + session history (independent) ──────────
      const [status, prefetchedSession, backgroundStatusResponse] = await Promise.all([
        loadMobileChatRunStatus(requestedSession),
        (fullRefresh || force) ? loadMobileChatSession(requestedSession, { force: true }).catch(() => null) : Promise.resolve(null),
        loadMobileBackgroundStatuses(requestedSession).catch(() => null),
      ]);
      const recoveredBackgroundStatuses = Array.isArray(backgroundStatusResponse?.statuses) ? backgroundStatusResponse.statuses : [];
      if (!isCurrentRecoveryTarget()) return;
      if (!force && !remembered && !status?.active) return;
      // Draft new-chat session has no server-side history — skip even when force=true
      if (requestedSession === MOBILE_CHAT_SESSION_ID && !remembered && !status?.active) return;
      if (__pmChat.activeSessionId !== requestedSession) return;
      const recoverBackgroundDock = async (frames = []) => {
        const changed = await _recoverMobileBackgroundSpawnDock({
          sessionId: requestedSession,
          frames,
          statuses: recoveredBackgroundStatuses,
          dock: backgroundSpawnDock,
        });
        if (changed) updateChatComposerSpace();
        return changed;
      };

      let recoveredSessionProcessLog = [];
      let recoveredSessionHistory = [];
      let recoveredSessionHistoryPartial = false;
      if (fullRefresh || force) {
        const session = prefetchedSession;
        _rememberMobileSessionGoal(session, requestedSession);
        _renderMobileGoalPill(goalStrip, requestedSession);
        const history = Array.isArray(session?.history) ? session.history : [];
        recoveredSessionHistory = history;
        recoveredSessionHistoryPartial = _mobileHistoryPageIsPartial(session, history);
        recoveredSessionProcessLog = Array.isArray(session?.processLog) ? session.processLog : [];
        // CRITICAL: do NOT replace the thread with server history while a run is
        // still active. Server history never includes the in-progress streaming turn,
        // so merging it here destroys the live aiTurn before hasLocalLiveHistory is
        // evaluated — making hasLocalLiveHistory always false and forcing a full
        // seq=0 replay that wipes and reloads the entire tool stream on every
        // reconnect. Defer the history merge to after active-run recovery.
        if (history.length && !status?.active) {
          const localThread = __pmChat.threads[requestedSession] || [];
          __pmChat.threads[requestedSession] = _mergeMobileSessionThreadWithLocal(requestedSession, history, localThread, {
            preserveLocalHistory: recoveredSessionHistoryPartial,
          });
          _activeMobileThread();
        }
        // ── Parallel batch 2: approvals + questions (independent) ────────────────
        const [pendingApprovals, pendingQuestions] = await Promise.all([
          _reconcileMobilePendingApprovals({ retry: true }).catch(() => []),
          loadMobileQuestions('pending').catch(() => []),
        ]);
        if (!isCurrentRecoveryTarget()) return;
        (Array.isArray(pendingApprovals) ? pendingApprovals : [])
          .filter((approval) => {
            const sid = String(approval?.sessionId || approval?.sourceSessionId || '').trim();
            return !sid || sid === requestedSession || !!_mobileBackgroundSpawnIdFromSessionId(sid);
          })
          .forEach((approval) => _upsertMobilePendingApproval(approval));
        (Array.isArray(pendingQuestions) ? pendingQuestions : [])
          .filter((q) => {
            const sid = String(q?.sessionId || q?.sourceSessionId || '').trim();
            return !sid || sid === requestedSession;
          })
          .forEach((q) => _upsertMobileQuestion(_normalizeMobileQuestion(q, { status: 'pending' })));
      }

      const activeThread = _activeMobileThread();
      const latestAssistantTurn = _findLatestAssistantTurn(activeThread);
      const recoveryClientRequestId = String(
        status?.run?.clientRequestId
        || status?.activeRun?.clientRequestId
        || remembered?.clientRequestId
        || '',
      ).trim();
      let aiTurn = _findMobileRecoverableAssistantTurn(activeThread, recoveryClientRequestId)
        || (latestAssistantTurn?.streaming === true ? latestAssistantTurn : null);
      // A successful status request proves that the mobile client is connected
      // again, whether the run is still active or has already completed.
      if (status?.active) _clearRecoveredMobileChatError(aiTurn || latestAssistantTurn);
      const runStartedAt = Number(status?.run?.startedAt || remembered?.startedAt || 0) || 0;
      const activeRunKind = String(status?.run?.kind || '').trim();
      const activeRunSource = String(status?.run?.source || status?.activeRun?.source || '').trim().toLowerCase();
      // Once a final frame has reached the phone, recovery must be monotonic:
      // never reset that answer just because run-status propagation or SSE
      // teardown is a few seconds behind. Finalize the durable local turn and
      // let the ordinary stream cleanup finish independently.
      if (aiTurn?._pmFinalReceived && _mobileAssistantHasVisibleAnswer(aiTurn)) {
        hideReconnectingStatus();
        finalizeMobileLiveAiTurn(aiTurn);
        return;
      }
      if (status?.active && runStartedAt > 0 && _mobileHistoryHasCompletedTurnSince(recoveredSessionHistory, runStartedAt, { activeRunKind })) {
        const localThread = __pmChat.threads[requestedSession] || [];
        __pmChat.threads[requestedSession] = _mergeMobileSessionThreadWithLocal(
          requestedSession,
          recoveredSessionHistory,
          localThread,
          { preserveLocalHistory: recoveredSessionHistoryPartial },
        ).filter((turn) => !(turn?.role === 'ai' && turn.streaming));
        _activeMobileThread();
        _flushThreadRender(threadEl, body, requestedSession);
        hideReconnectingStatus();
        _clearMobileActiveRun(requestedSession);
        _markMobileSessionRunning(requestedSession, false);
        setBusy(false);
        return;
      }
      if (status?.active) {
        const serverRecoveryClientRequestId = String(
          status?.run?.clientRequestId
          || status?.activeRun?.clientRequestId
          || recoveryClientRequestId
          || '',
        ).trim();
        if (serverRecoveryClientRequestId) recoveryIdentity.clientRequestId = serverRecoveryClientRequestId;
        _adoptMobileActiveRunState(requestedSession, {
          run: status?.run || status?.activeRun || null,
          stream: status?.stream || null,
          fallback: remembered,
        });
        delete __pmChat.mobileRecoveryUncertainSince[requestedSession];
        let hasLocalLiveHistory = !!(aiTurn?.streaming && (
          String(aiTurn.body?.text || aiTurn.content || '').trim()
          || (Array.isArray(aiTurn.processEntries) && aiTurn.processEntries.length)
          || (Array.isArray(aiTurn.liveTraceEntries) && aiTurn.liveTraceEntries.length)
        ));
        if (!aiTurn || !aiTurn.streaming) {
          const recoveredStartedAt = Number(status?.run?.startedAt || remembered?.startedAt || 0);
          const startedAt = Number.isFinite(recoveredStartedAt) && recoveredStartedAt > 0 ? recoveredStartedAt : Date.now();
          aiTurn = {
            role: 'ai',
            streaming: true,
            time: '',
            timestamp: startedAt,
            workStartedAt: startedAt,
            body: { sender: '', text: '' },
            content: '',
            processEntries: [],
            liveTraceEntries: [],
            activeRunKind,
            agentRuntimeKind: activeRunKind,
            messageKind: activeRunSource === 'internal_watch' ? 'internal_watch_review' : undefined,
            _clientRequestId: recoveryClientRequestId || undefined,
          };
          activeThread.push(aiTurn);
          hasLocalLiveHistory = false;
        }
        aiTurn.streaming = true;
        if (activeRunSource === 'internal_watch') aiTurn.messageKind = 'internal_watch_review';
        const statusRuntimeId = String(status?.run?.id || status?.activeRun?.id || '').trim();
        const localRuntimeId = String(aiTurn.runtimeId || remembered?.runtimeId || '').trim();
        const statusClientRequestId = recoveryClientRequestId;
        const localClientRequestId = String(aiTurn._clientRequestId || remembered?.clientRequestId || '').trim();
        const sameClientRequest = !!statusClientRequestId && !!localClientRequestId
          && statusClientRequestId === localClientRequestId;
        const clientRequestConflicts = !!statusClientRequestId && !!localClientRequestId
          && statusClientRequestId !== localClientRequestId;
        const localStartedAt = Number(aiTurn.workStartedAt || aiTurn.timestamp || remembered?.startedAt || 0) || 0;
        const statusStartedAt = Number(status?.run?.startedAt || status?.activeRun?.startedAt || 0) || 0;
        const clearlyNewerRuntime = !!statusStartedAt && !!localStartedAt && statusStartedAt > localStartedAt + 30_000;
        // Runtime IDs can legitimately change when the gateway/supervisor
        // reattaches the same user turn. Treat that as a new turn only when its
        // start boundary also proves it is newer and no stable request ID ties
        // the two sides together.
        const runtimeIdentityConflicts = !!statusRuntimeId && !!localRuntimeId
          && statusRuntimeId !== localRuntimeId && !sameClientRequest && clearlyNewerRuntime;
        const localRunIdentityConflicts = clientRequestConflicts || runtimeIdentityConflicts;
        if (recoveryClientRequestId && aiTurn && String(aiTurn._clientRequestId || '').trim() !== recoveryClientRequestId) {
          if (aiTurn._pmAdmissionPending === true || aiTurn._pmRejectedAdmission === true || !String(aiTurn._clientRequestId || '').trim()) {
            aiTurn._clientRequestId = recoveryClientRequestId;
          }
        }
        // Recovery is monotonic: a visible/cache-restored timeline belonging to
        // this runtime is richer than a checkpoint or partial replay until the
        // server proves otherwise. Foregrounding the app must never erase it.
        const canPreserveLocalTimeline = hasLocalLiveHistory && !localRunIdentityConflicts;
        const checkpointProcessLog = Array.isArray(status?.run?.checkpoint?.processEntries)
          ? status.run.checkpoint.processEntries
          : [];
        const activeRunProcessLog = [
          ...checkpointProcessLog,
          ..._filterMobileProcessEntriesForActiveRun(recoveredSessionProcessLog, aiTurn, status, remembered),
        ];
        if (activeRunProcessLog.length) _mergeMobileProcessEntries(aiTurn, activeRunProcessLog);
        _mergeMobileWorkflowTraceFromProcessEntries(aiTurn);
        const rememberedLastSeq = Math.max(
          Number(__pmChat.activeRuns?.[requestedSession]?.lastSeq || 0) || 0,
          Number(remembered?.lastSeq || 0) || 0,
        );
        // A cold/foreground recovery should request missing frames, but it must
        // not automatically replace a richer local timeline. Replacement is
        // reserved for an empty trace or a positively different runtime/turn.
        const isColdReopen = remembered?.disconnected === true;
        let shouldResetForReplay = !canPreserveLocalTimeline
          && (fullRefresh || isColdReopen || force || !hasLocalLiveHistory);
        // Only a destructive replacement clears the replay cursor here. Stream
        // changes/gaps below may reset the cursor independently while retaining
        // the already-rendered timeline.
        if (shouldResetForReplay && __pmChat.activeRuns?.[requestedSession]) {
          __pmChat.activeRuns[requestedSession] = {
            ...__pmChat.activeRuns[requestedSession],
            lastSeq: 0,
            streamId: '',
          };
          _rememberMobileActiveRun(requestedSession, { lastSeq: 0, streamId: '' });
        }
        let replayAfter = shouldResetForReplay ? 0 : rememberedLastSeq;
        let replay = await loadMobileChatStreamReplay(requestedSession, replayAfter).catch(() => null);
        let events = Array.isArray(replay?.events) ? replay.events : [];
        if (!isCurrentRecoveryTarget()) return;
        const replayStreamId = String(replay?.stream?.streamId || '').trim();
        const rememberedStreamId = String(__pmChat.activeRuns?.[requestedSession]?.streamId || remembered?.streamId || '').trim();
        if (!shouldResetForReplay && replayStreamId && rememberedStreamId && replayStreamId !== rememberedStreamId) {
          // A gateway restart creates a new in-memory stream ID. Its seq=0
          // replay is a continuation, not proof that the cached pre-restart
          // timeline is stale. Reset only the dedupe cursor and merge it.
          shouldResetForReplay = !canPreserveLocalTimeline;
          replayAfter = 0;
          if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
          const run = __pmChat.activeRuns[requestedSession] || {};
          __pmChat.activeRuns[requestedSession] = { ...run, lastSeq: 0, streamId: replayStreamId };
          _rememberMobileActiveRun(requestedSession, { lastSeq: 0, streamId: replayStreamId });
          replay = await loadMobileChatStreamReplay(requestedSession, replayAfter).catch(() => replay);
          events = Array.isArray(replay?.events) ? replay.events : [];
          if (!isCurrentRecoveryTarget()) return;
        }
        const firstSeq = Math.max(0, Math.floor(Number(replay?.stream?.firstSeq || 0)) || 0);
        const replayGap = !shouldResetForReplay
          && rememberedLastSeq > 0
          && firstSeq > 0
          && firstSeq > rememberedLastSeq + 1;
        if (replayGap) {
          // The server no longer has every intermediate frame. Preserve the
          // local prefix and merge all frames the server can still provide.
          shouldResetForReplay = !canPreserveLocalTimeline;
          replayAfter = 0;
          if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
          const run = __pmChat.activeRuns[requestedSession] || {};
          __pmChat.activeRuns[requestedSession] = { ...run, lastSeq: 0, streamId: '' };
          _rememberMobileActiveRun(requestedSession, { lastSeq: 0, streamId: '' });
          replay = await loadMobileChatStreamReplay(requestedSession, replayAfter).catch(() => replay);
          events = Array.isArray(replay?.events) ? replay.events : [];
          if (!isCurrentRecoveryTarget()) return;
        }
        if (shouldResetForReplay && events.length) {
          _resetMobileLiveAiTurnForReplay(aiTurn, {
            startedAt: Number(replay?.stream?.startedAt || status?.run?.startedAt || remembered?.startedAt || aiTurn.workStartedAt || aiTurn.timestamp || 0),
            clientRequestId: aiTurn._clientRequestId,
          });
          if (activeRunProcessLog.length) _mergeMobileProcessEntries(aiTurn, activeRunProcessLog);
          _mergeMobileWorkflowTraceFromProcessEntries(aiTurn);
        }
        let terminal = '';
        aiTurn._pmRecoveryReplay = true;
        try {
          for (const frame of events) {
            if (!isCurrentRecoveryTarget()) return;
            const applied = applyMobileChatStreamEvent(aiTurn, replayFrameToEvent(frame));
            if (applied === 'done' || applied === 'error') {
              terminal = applied;
              break;
            }
          }
        } finally {
          delete aiTurn._pmRecoveryReplay;
        }
        _mergeMobileWorkflowTraceFromProcessEntries(aiTurn);
        if (!isCurrentRecoveryTarget()) return;
        if (terminal) {
          await recoverBackgroundDock(events);
          if (!isCurrentRecoveryTarget()) return;
          finalizeMobileLiveAiTurn(aiTurn);
          return;
        }
        if (!events.length && !String(aiTurn.body?.text || '').trim() && !(Array.isArray(aiTurn.processEntries) && aiTurn.processEntries.length)) {
          _appendMobileProcess(aiTurn, 'info', 'Live run is connected. Waiting for the next update.');
        }
        hideReconnectingStatus();
        _rememberMobileActiveRun(requestedSession, {
          startedAt: status.run?.startedAt || remembered?.startedAt,
          disconnected: false,
          streamId: replay?.stream?.streamId || remembered?.streamId || '',
          lastSeq: Math.max(
            Number(replay?.stream?.lastSeq || 0) || 0,
            Number(__pmChat.activeRuns?.[requestedSession]?.lastSeq || 0) || 0,
            Number(remembered?.lastSeq || 0) || 0,
          ),
        });
        await recoverBackgroundDock(events);
        if (!isCurrentRecoveryTarget()) return;
        renderThreadNow();
        // Preserve the complete in-progress trace across an immediate hard
        // reload (service-worker takeover) or an iOS process eviction.
        _saveMobileThreadCache(requestedSession, _activeMobileThread());
        setBusy(true);
        return;
      }

      const replay = await loadMobileChatStreamReplay(requestedSession, 0).catch(() => null);
      if (!isCurrentRecoveryTarget()) return;
      const replayEvents = Array.isArray(replay?.events) ? replay.events : [];
      await recoverBackgroundDock(replayEvents);
      if (!isCurrentRecoveryTarget()) return;
      const session = await loadMobileChatSession(requestedSession).catch(() => null);
      if (!isCurrentRecoveryTarget()) return;
      _rememberMobileSessionGoal(session, requestedSession);
      _renderMobileGoalPill(goalStrip, requestedSession);
      const history = Array.isArray(session?.history) ? session.history : [];
      const localThread = Array.isArray(__pmChat.threads?.[requestedSession])
        ? __pmChat.threads[requestedSession]
        : [];
      // `_clearMobileLiveRunForSession` removes streaming rows in place. Keep
      // a separate array for the final merge so a transient inactive/recovered
      // read cannot erase the only copy of the current stream before the
      // server snapshot is reconciled.
      const localThreadBeforeClear = localThread.slice();
      const inactiveRecoveryClientRequestId = String(
        status?.run?.clientRequestId
        || status?.activeRun?.clientRequestId
        || remembered?.clientRequestId
        || '',
      ).trim();
      let localAiTurn = _findMobileRecoverableAssistantTurn(localThread, inactiveRecoveryClientRequestId)
        || (_findLatestAssistantTurn(localThread)?.streaming === true ? _findLatestAssistantTurn(localThread) : null);
      const replayStillActive = replay?.active === true || replay?.stream?.active === true;
      if (!isCurrentRecoveryTarget()) return;
      if (localAiTurn && replayEvents.length) {
        _adoptMobileActiveRunState(requestedSession, {
          run: status?.run || status?.activeRun || null,
          stream: replay?.stream || null,
          fallback: remembered,
        });
        let terminal = '';
        localAiTurn._pmRecoveryReplay = true;
        try {
          for (const frame of replayEvents) {
            if (!isCurrentRecoveryTarget()) return;
            const applied = applyMobileChatStreamEvent(localAiTurn, replayFrameToEvent(frame));
            if (applied === 'done' || applied === 'error') {
              terminal = applied;
              break;
            }
          }
        } finally {
          delete localAiTurn._pmRecoveryReplay;
        }
        _mergeMobileWorkflowTraceFromProcessEntries(localAiTurn);
        if (terminal || localAiTurn._pmFinalReceived) {
          if (!isCurrentRecoveryTarget()) return;
          finalizeMobileLiveAiTurn(localAiTurn);
          delete __pmChat.mobileRecoveryUncertainSince[requestedSession];
          const queue = _getMobileQueuedPrompts(requestedSession);
          if (queue.length) {
            const next = queue.shift();
            _renderMobileQueuedPromptsPanel(requestedSession);
            setTimeout(() => window.__pmMobileSendMessage?.(next.message, {
              fromQueue: true,
              attachments: Array.isArray(next.files) ? next.files : [],
              excludedSkillIds: Array.isArray(next.excludedSkillIds) ? next.excludedSkillIds : [],
              selectedSkillIds: Array.isArray(next.selectedSkillIds) ? next.selectedSkillIds : [],
              selectedSkillRefs: Array.isArray(next.selectedSkillRefs) ? next.selectedSkillRefs : [],
            }), 0);
          }
          return;
        }
      }
      const recoveryStartedAt = Number(
        remembered?.startedAt
        || replay?.stream?.startedAt
        || localAiTurn?.workStartedAt
        || localAiTurn?.timestamp
        || 0,
      ) || 0;
      const completedDurableTurn = recoveryStartedAt > 0
        && _mobileHistoryHasCompletedTurnSince(history, recoveryStartedAt, {});
      if (replayStillActive || (localAiTurn?.streaming && !completedDurableTurn)) {
        if (!isCurrentRecoveryTarget()) return;
        _adoptMobileActiveRunState(requestedSession, {
          run: status?.run || status?.activeRun || null,
          stream: replay?.stream || null,
          fallback: remembered,
        });
        _rememberMobileActiveRun(requestedSession, { disconnected: true });
        setChatConnectionStatus(true, 'Reconnecting to Prometheus');
        setBusy(true);
        renderThreadNow();
        const uncertainSince = Number(__pmChat.mobileRecoveryUncertainSince[requestedSession] || 0) || Date.now();
        __pmChat.mobileRecoveryUncertainSince[requestedSession] = uncertainSince;
        const graceElapsed = Date.now() - uncertainSince >= 15_000;
        if (!graceElapsed || replayStillActive) {
          scheduleMobileRunRecovery(2000, { force: true, fullRefresh: false });
          return;
        }
        if (localAiTurn?.streaming) {
          _appendMobileProcess(localAiTurn, 'warn', 'The live connection ended before a terminal frame. The visible tool trace was preserved; you can continue from here.');
          finalizeMobileLiveAiTurn(localAiTurn);
        }
        delete __pmChat.mobileRecoveryUncertainSince[requestedSession];
        return;
      }
      // Run-status/replay are now authoritative: only remove the cached
      // streaming turn after a terminal replay or durable history proves that
      // the active request is over. A single false inactive read must never
      // erase a richer tool trace while another tab is still working.
      if (!isCurrentRecoveryTarget()) return;
      _clearMobileLiveRunForSession(requestedSession);
      if (history.length) {
        // If durable history positively contains this turn's completion, the
        // post-clear array is intentional: it drops the old streaming row and
        // lets the durable answer win. Otherwise merge the pre-clear snapshot
        // so a stale/equal-sized page cannot roll back newer local messages.
        const localThreadForMerge = completedDurableTurn ? localThread : localThreadBeforeClear;
        __pmChat.threads[requestedSession] = _mergeMobileSessionThreadWithLocal(requestedSession, history, localThreadForMerge, {
          preserveLocalHistory: _mobileHistoryPageIsPartial(session, history)
            || (!completedDurableTurn && _mobileHistoryHasProtectedLocalContinuity(localThreadBeforeClear)),
        });
        _activeMobileThread();
        _flushThreadRender(threadEl, body, requestedSession);
        if (!silent) pmToast('Recovered latest mobile chat result.', 'success');
      }
      delete __pmChat.mobileRecoveryUncertainSince[requestedSession];
      setBusy(false);
      const queue = _getMobileQueuedPrompts(requestedSession);
      if (queue.length) {
        const next = queue.shift();
        _renderMobileQueuedPromptsPanel(requestedSession);
        setTimeout(() => window.__pmMobileSendMessage?.(next.message, {
          fromQueue: true,
          attachments: Array.isArray(next.files) ? next.files : [],
          excludedSkillIds: Array.isArray(next.excludedSkillIds) ? next.excludedSkillIds : [],
          selectedSkillIds: Array.isArray(next.selectedSkillIds) ? next.selectedSkillIds : [],
          selectedSkillRefs: Array.isArray(next.selectedSkillRefs) ? next.selectedSkillRefs : [],
        }), 0);
      }
    } catch (err) {
      if (_readMobileActiveRun(requestedSession)?.disconnected) scheduleMobileRunRecovery(2500, { fullRefresh });
      if (!silent) pmToast(`Recovery check failed: ${err.message || err}`, 'warn');
    }
  }

  // A cold session load starts recovery after hydration. Do not race it with a
  // second full refresh that can replace a complete replay with a partial tail.
  if (!initialSessionLoadPending) {
    refreshMobileRunRecovery({ silent: true, force: true, fullRefresh: true });
  }
  if (requestedSession && requestedSession !== MOBILE_CHAT_SESSION_ID) {
    markMobileChatSessionRead(requestedSession, Date.now()).catch(() => {});
  }

  function _composerHasOutboundContent() {
    const text = _pmGetComposerValue(input);
    return !!(text.trim() || getPendingAttachments().length);
  }

  function updateComposerSubmitState(sessionForBusy = requestedSession) {
    const sid = String(sessionForBusy || requestedSession || MOBILE_CHAT_SESSION_ID);
    // The composer belongs to the requested route. Do not let a run in a
    // different chat session turn a fresh/new-chat composer into a stop button.
    const sessionBusy = !!__pmChat.activeRuns?.[sid]?.busy;
    const questionPending = !!_getPendingQuestionForSession(sid);
    const shouldAbort = !questionPending && sessionBusy && !_composerHasOutboundContent();
    const shouldVoice = !questionPending && !sessionBusy && !_composerHasOutboundContent();
    const shouldSubmitQuestion = questionPending;
    sendBtn.disabled = false;
    sendBtn.classList.toggle('is-abort', shouldAbort);
    sendBtn.classList.toggle('is-voice', shouldVoice);
    sendBtn.title = shouldSubmitQuestion ? 'Submit answer' : shouldAbort ? 'Stop Prometheus' : shouldVoice ? 'Start voice mode' : sessionBusy ? 'Queue message' : 'Send';
    sendBtn.innerHTML = shouldSubmitQuestion
      ? ICONS.send
      : shouldAbort
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
      : shouldVoice
        ? `<img class="pm-send-voice-icon" src="${PM_CHAT_VOICE_ICON_SRC}" alt="" aria-hidden="true" />`
      : ICONS.send;
    sendBtn.setAttribute('aria-label', shouldSubmitQuestion ? 'Submit answer' : shouldAbort ? 'Stop' : shouldVoice ? 'Start voice mode' : sessionBusy ? 'Queue message' : 'Send');
    updateComposerExpandedState();
  }

  // Question cards live in the composer host and can be inserted by a stream
  // event without an input/change event. Keep the send control authoritative
  // as soon as that host changes, including the option-only/empty-composer
  // case where the button is the question submit action.
  const previousQuestionComposerBridge = window.__pmMobileQuestionComposerChanged;
  const currentQuestionComposerBridge = (sessionId = requestedSession) => {
    const sid = String(sessionId || requestedSession || '').trim();
    if (sid && sid !== String(requestedSession || '').trim()) return;
    updateComposerSubmitState(requestedSession);
    updateChatComposerSpace();
  };
  window.__pmMobileQuestionComposerChanged = currentQuestionComposerBridge;

  function setBusy(busy, sessionForBusy = requestedSession) {
    const sid = String(sessionForBusy || requestedSession || MOBILE_CHAT_SESSION_ID);
    const wasBusy = !!__pmChat.activeRuns?.[sid]?.busy;
    _markMobileSessionRunning(sid, !!busy);
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    if (busy) {
      __pmChat.activeRuns[sid] = {
        ...(__pmChat.activeRuns[sid] || {}),
        busy: true,
      };
    } else {
      delete __pmChat.activeRuns[sid];
    }
    __pmChat.busy = Object.values(__pmChat.activeRuns).some((run) => run?.busy);
    if (wasBusy !== !!busy) invalidateMobileDrawerSessions('chat-run-state');
    const activeSid = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
    updateComposerSubmitState(sid);
    _renderMobileQueuedPromptsPanel(activeSid);
  }
  setBusy(!!__pmChat.activeRuns[requestedSession]?.busy);
  _renderMobileQueuedPromptsPanel(requestedSession);

  function buildMessageWithAttachments(text, files, uploadResults = []) {
    const msg = String(text || '').trim();
    const blocks = [];
    for (const f of files) {
      if (f.kind === 'text' && f.text) {
        blocks.push(`--- ${f.name} (${f.mimeType || 'text/plain'}, ${f.sizeLabel}) ---\n${String(f.text).slice(0, 12000)}`);
      } else if (f.kind !== 'image') {
        blocks.push(`[Attached file: ${f.name} (${f.mimeType || 'application/octet-stream'}, ${f.sizeLabel})]`);
      }
    }
    const uploadNote = _buildMobileFileContextNote(uploadResults);
    if (!blocks.length) return `${msg}${uploadNote}`;
    return `${msg || 'Please review the attached file(s).'}\n\n[Attached files]\n${blocks.join('\n\n')}${uploadNote}`;
  }

  function renderThreadNow() {
    _flushThreadRender(threadEl, body, requestedSession);
  }

  function renderStreamingThreadNow() {
    const timerKey = String(requestedSession || 'chat');
    mobileStreamRenderScheduler.cancel(`mobile:thread:${timerKey}`);
    mobileStreamRenderScheduler.cancel(`mobile:patch:${timerKey}`);
    if (!_patchLatestMobileStreamingMessage(threadEl, body, requestedSession)) {
      _flushThreadRender(threadEl, body, requestedSession);
    }
  }

  function renderThreadSoon() {
    if (!_scheduleMobileStreamingPatch(threadEl, body, requestedSession, 16)) {
      _scheduleThreadRender(threadEl, body, requestedSession, 16);
    }
  }

  function _currentChatVoiceSessionLabel() {
    const sid = String(requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    if (sid === MOBILE_CHAT_SESSION_ID) return 'Mobile - New Chat';
    const firstText = String((__pmChat.threads?.[sid] || []).find((turn) => turn?.role === 'user')?.body?.text || '').trim();
    return firstText ? `Mobile - ${firstText.slice(0, 42)}` : 'Mobile - Chat';
  }

  async function _setChatVoiceTarget() {
    const sid = String(requestedSession || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    // Opening voice from the transcript of a Voice Room is the sole chat-page
    // path that deliberately restores that room and its participants.
    if (sid.startsWith('voice_room_')) {
      const loaded = await _loadDurableMobileVoiceRoom(sid);
      if (!loaded) throw new Error('Could not restore this Voice Room.');
      return;
    }
    // Every ordinary chat, including a pristine New Chat, must sever a stale
    // room binding before mounting inline voice. Otherwise the room router can
    // hijack the first transcription despite the chat appearing brand new.
    _exitMobileVoiceRoomForFreshChat('ordinary_chat_voice_open');
    __pmVoice.target = { kind: 'main' };
    __pmVoice.targetSessionId = sid;
    __pmVoice.targetSessionLabel = _currentChatVoiceSessionLabel();
    __pmVoice.targetSessionChannel = 'mobile';
    __pmVoice.targetSessionForced = true;
    if (__pmVoice.activeVoiceRuntime && String(__pmVoice.activeVoiceRuntime.sessionId || '').trim() !== sid) {
      __pmVoice.activeVoiceRuntime.isStreamActive = false;
      __pmVoice.activeVoiceRuntime = null;
    }
    if (__pmRealtimeAgent?.conn && String(__pmRealtimeAgent.conn.sessionId || '').trim() !== sid) {
      _stopMobileRealtimeAgentContextRefreshLoop();
      _mobileRealtimeAgentDisableAlwaysListening();
    }
  }

  function _setChatVoiceActive(active) {
    const enabled = !!active;
    if (enabled && modeLauncher && !composerModeOpen) {
      setChatComposerMode(true, {
        animate: false,
        preserveScroll: false,
        reason: 'voice',
        update: false,
      });
    }
    const thread = Array.isArray(__pmChat.threads?.[requestedSession]) ? __pmChat.threads[requestedSession] : [];
    const newChatVoice = !thread.some((message) => ['user', 'ai', 'assistant'].includes(String(message?.role || '').toLowerCase()));
    const hideNewChatContext = enabled && newChatVoice;
    if (hideNewChatContext) closeTargetPopover();
    contextDock?.classList.toggle('pm-chat-context-dock-voice-hidden', hideNewChatContext);
    contextDock?.setAttribute('aria-hidden', hideNewChatContext ? 'true' : 'false');
    form?.classList.toggle('is-voice-active', enabled);
    body?.classList.toggle('pm-chat-voice-occluded', enabled);
    document.body?.classList.toggle('pm-chat-voice-active', enabled);
    document.body?.classList.toggle('pm-chat-voice-new-chat', enabled && newChatVoice);
    document.body?.classList.toggle('pm-chat-voice-existing-chat', enabled && !newChatVoice);
    if (chatVoiceShell) chatVoiceShell.hidden = !enabled;
    if (chatVoiceHost) chatVoiceHost.hidden = !enabled;
    updateChatComposerSpace();
  }

  function syncMobileBackgroundSpawnDockToComposer(composerRect = null) {
    if (!backgroundSpawnDock) return;
    if (backgroundSpawnDock.hidden || !form) {
      backgroundSpawnDock.style.removeProperty('bottom');
      backgroundSpawnDock.style.removeProperty('left');
      backgroundSpawnDock.style.removeProperty('right');
      return;
    }
    const rect = composerRect || form.getBoundingClientRect?.();
    const visualViewport = window.visualViewport;
    const viewportWidth = Number(
      visualViewport?.width
        || window.innerWidth
        || document.documentElement?.clientWidth
        || 0,
    );
    const viewportHeight = Number(
      visualViewport?.height
        || window.innerHeight
        || document.documentElement?.clientHeight
        || 0,
    );
    const viewportLeft = Number(visualViewport?.offsetLeft || 0) || 0;
    const viewportTop = Number(visualViewport?.offsetTop || 0) || 0;
    const composerTop = Number(rect?.top || 0) - viewportTop;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(composerTop)) return;
    // The dock is a separate fixed surface, so derived tab-bar/composer
    // variables can drift when the document-scrolled mobile path or the iOS
    // keyboard changes the composer geometry. Anchor its bottom edge to the
    // measured composer top instead of guessing from those offsets.
    const bottom = Math.max(0, Math.round(viewportHeight - composerTop + 8));
    backgroundSpawnDock.style.setProperty('bottom', `${bottom}px`);

    // The resting composer uses a responsive chrome inset, while a focused
    // composer expands to the 10px edge inset. Lock the expanded background
    // dock to the measured composer box so both states stay exactly the same
    // width. A collapsed count pill keeps its own centered, content-sized
    // geometry and must not inherit these edge anchors.
    const composerLeft = Number(rect?.left);
    const composerRight = Number(rect?.right);
    const canMeasureHorizontal = backgroundSpawnDock.classList.contains('is-collapsed') === false
      && Number.isFinite(viewportWidth)
      && viewportWidth > 0
      && Number.isFinite(composerLeft)
      && Number.isFinite(composerRight)
      && composerRight > composerLeft;
    if (canMeasureHorizontal) {
      const left = Math.max(0, Math.round(composerLeft - viewportLeft));
      const right = Math.max(0, Math.round(viewportWidth - (composerRight - viewportLeft)));
      backgroundSpawnDock.style.setProperty('left', `${left}px`);
      backgroundSpawnDock.style.setProperty('right', `${right}px`);
    } else {
      backgroundSpawnDock.style.removeProperty('left');
      backgroundSpawnDock.style.removeProperty('right');
    }
  }

  function updateChatComposerSpace() {
    if (chatComposerSpaceRaf) cancelAnimationFrame(chatComposerSpaceRaf);
    chatComposerSpaceRaf = requestAnimationFrame(() => {
      chatComposerSpaceRaf = 0;
      if (!body || !form) return;
      const scrollSnapshot = _mobileChatScrollSnapshot(body);
      const previousSpace = Math.max(0, Number.parseFloat(body.style.getPropertyValue('--pm-chat-composer-space')) || 170);
      const composerRect = form.getBoundingClientRect?.();
      const height = Math.ceil(composerRect?.height || 0);
      const queuedPanel = page?.querySelector?.('#pm-mobile-queued-prompts');
      const queuedHeight = queuedPanel && !queuedPanel.hidden
        ? Math.ceil(queuedPanel.getBoundingClientRect?.().height || 0)
        : 0;
      const goalHeight = goalStrip && !goalStrip.hidden
        ? Math.ceil(goalStrip.getBoundingClientRect?.().height || 0)
        : 0;
      const connectionHeight = connectionStatus && !connectionStatus.hidden
        ? Math.ceil(connectionStatus.getBoundingClientRect?.().height || 0)
        : 0;
      const toolProgressHeight = toolProgressDock && !toolProgressDock.hidden
        ? Math.ceil(toolProgressDock.getBoundingClientRect?.().height || 0)
        : 0;
      page?.style?.setProperty?.('--pm-composer-live-height', `${height}px`);
      syncContextDockToComposer();
      page?.style?.setProperty?.('--pm-queued-live-height', `${queuedHeight}px`);
      page?.style?.setProperty?.('--pm-goal-live-height', `${goalHeight}px`);
      page?.style?.setProperty?.('--pm-connection-live-height', `${connectionHeight}px`);
      page?.style?.setProperty?.('--pm-tool-progress-live-height', `${toolProgressHeight}px`);
      const dockHeight = backgroundSpawnDock && !backgroundSpawnDock.hidden
        ? Math.ceil(backgroundSpawnDock.getBoundingClientRect?.().height || 0)
        : 0;
      syncMobileBackgroundSpawnDockToComposer(composerRect);
      // The background-agent dock is a viewport-anchored chrome surface in
      // both nested and document-scroll modes. Reserve its measured height so
      // the composer and the latest-message affordance stay above the glass.
      const overlayDockHeight = dockHeight;
      const planDockHeight = mainPlanDock && !mainPlanDock.hidden
        ? Math.ceil(mainPlanDock.getBoundingClientRect?.().height || 0)
        : 0;
      const goalAgentPillsPaired = page?.classList?.contains('pm-runtime-goal-agent-pills-paired') === true;
      const runtimeDockHeight = Math.max(overlayDockHeight, planDockHeight);
      const runtimeSurfaceHeight = goalAgentPillsPaired ? 0 : Math.max(dockHeight, planDockHeight);
      const stackedGoalHeight = goalAgentPillsPaired ? Math.max(dockHeight, planDockHeight, goalHeight) : goalHeight;
      page?.style?.setProperty?.('--pm-goal-live-height', `${stackedGoalHeight}px`);
      page?.style?.setProperty?.('--pm-background-dock-live-height', `${goalAgentPillsPaired ? 0 : dockHeight}px`);
      page?.style?.setProperty?.('--pm-main-plan-live-height', `${planDockHeight}px`);
      page?.style?.setProperty?.('--pm-scroll-latest-stack-height', `${queuedHeight + stackedGoalHeight + toolProgressHeight + runtimeSurfaceHeight + connectionHeight}px`);
      const hasExpandedSurface = goalStrip?.dataset?.expanded === 'true'
        || mainPlanDock?.classList?.contains('is-open')
        || backgroundSpawnDock?.classList?.contains('is-open');
      // Open cards get a larger reading gutter than their collapsed pills. The
      // extra 32px keeps the final chat/tool line visibly above the glass edge.
      const clearance = hasExpandedSurface || connectionHeight || queuedHeight ? 78 : (runtimeDockHeight ? 46 : 34);
      const space = Math.max(170, height + queuedHeight + stackedGoalHeight + toolProgressHeight + runtimeSurfaceHeight + connectionHeight + clearance);
      body.style.setProperty('--pm-chat-composer-space', `${space}px`);
      if (form.classList.contains('is-voice-active') && chatVoiceShell && !chatVoiceShell.hidden) {
        const bodyRect = body.getBoundingClientRect?.();
        const shellRect = chatVoiceShell.getBoundingClientRect?.();
        const occlusionTop = Math.max(0, Math.floor((shellRect?.top || 0) - (bodyRect?.top || 0)));
        body.style.setProperty('--pm-chat-voice-occlusion-top', `${occlusionTop}px`);
      } else {
        body.style.removeProperty('--pm-chat-voice-occlusion-top');
      }
      // Reading scrollHeight forces the new inset to settle before restoring the
      // bottom anchor. This avoids restoring against the old padding and leaving
      // the newest chat line underneath an opening card.
      void body.scrollHeight;
      // Focusing the composer is a special case on iOS.  The document can
      // still report the old bottom anchor while Safari is opening the
      // keyboard; restoring that anchor here makes the fixed composer get
      // covered until the user manually scrolls.  Leave the current document
      // position alone while the composer owns the keyboard transition.
      const composerOwnsKeyboard = document.body?.classList?.contains('pm-keyboard-open')
        || document.activeElement === input
        || (sideSheet?.classList?.contains('open') && document.activeElement === sideInput);
      const lockedScrollTop = composerModeScrollLockTop;
      composerModeScrollLockTop = null;
      if (lockedScrollTop != null) {
        const scrollTarget = _mobileChatScrollTarget(body);
        const restoreComposerModeScroll = () => {
          if (!scrollTarget) return;
          const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
          scrollTarget.scrollTop = Math.min(Math.max(0, lockedScrollTop), maxScrollTop);
        };
        restoreComposerModeScroll();
        requestAnimationFrame(restoreComposerModeScroll);
      } else if (!composerOwnsKeyboard) _restoreMobileChatScroll(body, scrollSnapshot);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const shift = Math.max(-64, Math.min(64, space - previousSpace));
      // Once the composer owns the keyboard, the visual-viewport controller is
      // already repositioning the fixed composer. A second WAAPI translation
      // on the transcript makes the keyboard hand-off visibly flicker on iOS,
      // especially while ResizeObserver reports the intermediate heights.
      if (!reduceMotion && !composerOwnsKeyboard && Math.abs(shift) >= 2 && typeof threadEl?.animate === 'function') {
        // ResizeObserver can fire on several consecutive frames while the
        // composer or a runtime card grows. Continue from the current visual
        // offset instead of restarting from zero on every measurement.
        let currentOffset = 0;
        try {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(threadEl).transform);
          currentOffset = Number.isFinite(matrix.m42) ? matrix.m42 : 0;
        } catch {}
        chatComposerShiftAnimation?.cancel?.();
        chatComposerShiftAnimation = threadEl.animate(
          [
            { transform: `translate3d(0, ${currentOffset + shift}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: 300, easing: 'cubic-bezier(.22,.74,.22,1)', fill: 'none' },
        );
        chatComposerShiftAnimation.addEventListener?.('finish', () => {
          chatComposerShiftAnimation = null;
        }, { once: true });
      } else if (reduceMotion || composerOwnsKeyboard) {
        chatComposerShiftAnimation?.cancel?.();
        chatComposerShiftAnimation = null;
      }
    });
  }

  window.__pmRenderActiveChatThread = renderThreadSoon;

  // These composer-adjacent surfaces can grow without a new render (live agent
  // output, plan progress, font wrapping, viewport rotation). Observing their
  // actual boxes keeps the chat inset correct for every open/close path rather
  // than relying on each feature to remember to request a remeasurement.
  const chatSurfaceResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (_pmKbFocusActive) _scheduleKeyboardOffset();
      updateChatComposerSpace();
    })
    : null;
  [form, connectionStatus, toolProgressDock, mainPlanDock, backgroundSpawnDock, goalStrip, page?.querySelector?.('#pm-mobile-queued-prompts')]
    .filter(Boolean)
    .forEach((surface) => chatSurfaceResizeObserver?.observe(surface));

  const updateScrollLatestButton = () => {
    if (!scrollLatestBtn || !body) return;
    const { distanceFromBottom } = _mobileChatScrollSnapshot(body, 0);
    scrollLatestBtn.hidden = distanceFromBottom < 150;
  };
  const syncBackgroundDockOnScroll = () => syncMobileBackgroundSpawnDockToComposer();
  let lastHistoryScrollTop = Number(_mobileChatScrollTarget(body)?.scrollTop || 0);
  let historyLoadInFlight = null;
  async function loadOlderMobileMessages() {
    if (historyLoadInFlight || __pmChat.activeSessionId !== requestedSession) return historyLoadInFlight;
    const timelineEntries = _mobileTimelineEntries(requestedSession);
    const timelineKey = `mobile:main:${requestedSession}`;
    if (mobileTimelineController.peek(timelineKey)?.omittedBefore > 0) {
      mobileTimelineController.stepEarlier(timelineKey, timelineEntries);
      _renderThread(threadEl, requestedSession);
      return null;
    }
    const pagination = __pmChat.historyPagination?.[requestedSession] || {};
    if (!pagination.historyTruncated) return null;
    const olderCursor = String(pagination.olderCursor || '').trim();
    if (!olderCursor) return null;
    pagination.loading = true;
    __pmChat.historyPagination[requestedSession] = pagination;
    mobileChatRuntimeAdapter.setPaging(requestedSession,{ loadingOlder:true,error:null });
    _renderThread(threadEl, requestedSession);
    historyLoadInFlight = mobileChatRuntimeAdapter.loadOlderPage(requestedSession, {
      before: olderCursor,
      limit: PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE,
    }).then(({ applied }) => {
      if (!applied) return;
      // The server page is a real prepend. Expand the retained timeline range
      // to include the new oldest block before repainting, so the existing
      // newer block remains in place instead of being replaced by the page.
      mobileTimelineController.retainEarlier(
        timelineKey,
        _mobileTimelineEntries(requestedSession),
      );
      _renderThread(threadEl, requestedSession);
      _scheduleMobileThreadCacheSave(requestedSession, 120);
    }).catch((err) => {
      pagination.loading = false;
      _renderThread(threadEl, requestedSession);
      pmToast(`Could not load earlier messages: ${err?.message || 'Unknown error'}`, 'error');
    }).finally(() => {
      historyLoadInFlight = null;
    });
    return historyLoadInFlight;
  }
  const maybeLoadOlderOnScroll = () => {
    const scrollTop = Number(_mobileChatScrollTarget(body)?.scrollTop || 0);
    const isUpwardScroll = scrollTop < lastHistoryScrollTop - 2;
    lastHistoryScrollTop = scrollTop;
    const timelineKey = `mobile:main:${requestedSession}`;
    const keyedScroll = captureKeyedScrollState(threadEl, _mobileChatScrollTarget(body));
    if (keyedScroll.nearBottom && !(mobileTimelineController.peek(timelineKey)?.omittedAfter > 0)) mobileTimelineController.followTail(timelineKey);
    else if (keyedScroll.anchorKey) mobileTimelineController.anchorKey(timelineKey, keyedScroll.anchorKey);
    if (isUpwardScroll && scrollTop <= 80) loadOlderMobileMessages();
  };
  const composerModeScrollTarget = _mobileChatScrollTarget(body);
  const composerModeCanAutoHide = () => {
    if (!composerModeOpen || !form || form.classList.contains('is-voice-active')) return false;
    const keyboardOpen = document.body?.classList?.contains('pm-keyboard-open')
      || page.querySelector('.pm-app')?.classList?.contains('pm-keyboard-open');
    const keyboardFocusHandoff = _pmKbFocusActive
      || document.activeElement === input
      || (sideSheet?.classList?.contains('open') && document.activeElement === sideInput);
    // A delayed iOS focus/viewport pass can briefly remove the CSS keyboard
    // marker. Focus ownership is the stronger signal and must also suppress
    // auto-hide, otherwise that layout shift closes the composer underneath
    // the keyboard.
    if (keyboardOpen || keyboardFocusHandoff) return false;
    return !form.classList.contains('has-text')
      && !form.classList.contains('has-attachments')
      && !form.classList.contains('has-pending-question');
  };
  const onComposerModeScrollIntent = () => {
    // Opening the composer on iOS can move the document by a few pixels while
    // Safari reveals the focused field. That is layout work, not a user's
    // upward scroll. Require a recent gesture before allowing auto-hide.
    composerModeScrollIntentUntil = (window.performance?.now?.() || 0) + 900;
  };
  const onComposerModeScroll = () => {
    const scrollTop = Number(composerModeScrollTarget?.scrollTop || 0);
    const delta = scrollTop - composerModeLastScrollTop;
    composerModeLastScrollTop = scrollTop;
    if (delta >= -2) return;
    if ((window.performance?.now?.() || 0) < composerModeScrollIgnoreUntil) return;
    if ((window.performance?.now?.() || 0) > composerModeScrollIntentUntil) return;
    if (!composerModeCanAutoHide()) return;
    setChatComposerMode(false, {
      animate: true,
      preserveScroll: true,
      reason: 'scroll',
    });
  };
  const onLoadOlderClick = (event) => {
    const button = event.target?.closest?.('[data-pm-load-older]');
    if (!button) return;
    event.preventDefault();
    loadOlderMobileMessages();
  };
  const jumpToLatest = () => {
    const scrollTarget = _mobileChatScrollTarget(body);
    if (!scrollTarget) return;
    mobileTimelineController.followTail(`mobile:main:${requestedSession}`);
    _renderThread(threadEl, requestedSession);
    try { pmHaptic(12); } catch {}
    // The transcript renderer preserves the user's keyed scroll position by
    // design. A direct scrollTo before that reconciliation settles can be
    // immediately overwritten, especially when document-scroll mode changes
    // the composer inset in the same frame. Use the shared force-bottom path
    // after rendering and once more after the layout frame.
    _scrollChat(body);
    requestAnimationFrame(() => requestAnimationFrame(() => _scrollChat(body)));
    scrollLatestBtn.hidden = true;
  };
  body?.addEventListener('scroll', updateScrollLatestButton, { passive: true });
  document.addEventListener('scroll', updateScrollLatestButton, { passive: true });
  window.addEventListener('scroll', updateScrollLatestButton, { passive: true });
  body?.addEventListener('scroll', syncBackgroundDockOnScroll, { passive: true });
  document.addEventListener('scroll', syncBackgroundDockOnScroll, { passive: true });
  window.addEventListener('scroll', syncBackgroundDockOnScroll, { passive: true });
  body?.addEventListener('scroll', maybeLoadOlderOnScroll, { passive: true });
  document.addEventListener('scroll', maybeLoadOlderOnScroll, { passive: true });
  const composerModeScrollIntentOptions = { passive: true };
  for (const eventName of ['touchstart', 'pointerdown', 'wheel']) {
    composerModeScrollTarget?.addEventListener(eventName, onComposerModeScrollIntent, composerModeScrollIntentOptions);
    if (composerModeScrollTarget !== body) document.addEventListener(eventName, onComposerModeScrollIntent, composerModeScrollIntentOptions);
  }
  composerModeScrollTarget?.addEventListener('scroll', onComposerModeScroll, { passive: true });
  if (composerModeScrollTarget !== body) document.addEventListener('scroll', onComposerModeScroll, { passive: true });
  threadEl?.addEventListener('click', onLoadOlderClick);
  scrollLatestBtn?.addEventListener('click', jumpToLatest);
  requestAnimationFrame(updateScrollLatestButton);

  function resizeSideInput() {
    if (!sideInput) return;
    const maxHeight = Number(sideInput.dataset.maxHeight || 148);
    sideInput.style.height = 'auto';
    const nextHeight = Math.min(sideInput.scrollHeight || 0, maxHeight);
    sideInput.style.height = `${Math.max(0, nextHeight)}px`;
    sideInput.style.overflowY = sideInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function _mobileBackgroundAgentDetailRecord(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    return _mobileChatRendererInvoke('backgroundDetailRecord', [
      cleanId,
      requestedSession,
      _normalizeMobileRecoveredTraceEntry,
      _mobileBackgroundAgentDetailMessage,
    ]);
  }

  function _mobileBackgroundAgentDetailEvents(record) {
    const name = String(record?.agentName || 'Agent');
    return (Array.isArray(record?.events) ? record.events : [])
      .map((entry) => ({
        ...entry,
        type: String(entry?.type || 'info'),
        text: String(entry?.text || entry?.content || entry?.message || '').trim(),
        actor: String(entry?.actor || name).trim() || name,
      }))
      .filter((entry) => entry.text);
  }

  function _mobileBackgroundAgentDetailPrompt(record) {
    return String(record?.task || record?.prompt || '').trim();
  }

  function _appendMobileBackgroundSnapshotTrace(message, entry) {
    if (!message || !entry || typeof entry !== 'object') return false;
    const normalizedEntry = _normalizeMobileRecoveredTraceEntry(entry) || entry;
    const text = String(normalizedEntry.text || normalizedEntry.content || normalizedEntry.message || normalizedEntry.thinking || normalizedEntry.summary || '').trim();
    if (!text) return false;
    const rawType = String(entry.type || entry.kind || '').trim().toLowerCase();
    const type = String(normalizedEntry.type || normalizedEntry.kind || rawType).trim().toLowerCase();
    const extra = normalizedEntry.extra && typeof normalizedEntry.extra === 'object' ? normalizedEntry.extra : {};
    if (_isMobileReasoningSummaryTraceEntry(entry) || _isMobileReasoningSummaryTraceEntry(normalizedEntry)) {
      return _setMobileLiveProgressNarration(message, text);
    }
    if (!['preamble', 'assistant', 'think', 'thinking', 'thought', 'agent_thought'].includes(type)) return false;
    const visibility = String(extra.visibility || normalizedEntry.visibility || entry.visibility || '').trim().toLowerCase();
    if (visibility === 'private' || visibility === 'internal') return false;
    const explicitUserThought = ['preamble', 'assistant', 'agent_thought'].includes(type) || rawType === 'agent_thought'
      ? true
      : _isMobileUserVisibleReasoningTraceEntry({
        type: type === 'thinking' || type === 'thought' ? 'think' : type,
        extra: { ...extra, visibility },
      });
    if (!explicitUserThought) return false;
    _appendMobileLiveTrace(message, type === 'preamble' || type === 'assistant' ? type : 'think', text, {
      extra: { ...extra, visibility: visibility || 'user' },
    });
    return true;
  }

  function _mobileBackgroundAgentDetailMessage(record) {
    const status = String(record?.status || 'running').toLowerCase();
    const running = ['queued', 'running', 'in_progress'].includes(status);
    const agentName = String(record?.agentName || 'Background agent');
    const promptText = _mobileBackgroundAgentDetailPrompt(record);
    const source = record?.message && typeof record.message === 'object' ? record.message : {};
    const processEntries = (Array.isArray(source.processEntries) && source.processEntries.length
      ? source.processEntries
      : _mobileBackgroundAgentDetailEvents(record))
      .filter((entry) => !_isMobileTransientReasoningTraceEntry(entry));
    const liveTraceEntries = Array.isArray(source.liveTraceEntries) && source.liveTraceEntries.length
      ? source.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean)
      : (Array.isArray(record.liveTraceEntries) ? record.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean) : []);
    const sourceText = String(source?.body?.text || source?.content || source?.text || '').trim();
    const normalizedPrompt = promptText.replace(/\s+/g, ' ').trim();
    const normalizedSourceText = sourceText.replace(/\s+/g, ' ').trim();
    // A cold lane can carry the original task in its cached message body. It
    // belongs in the user row below, never in the agent's response bubble.
    const sourceIsPrompt = !!normalizedPrompt
      && !!normalizedSourceText
      && normalizedSourceText === normalizedPrompt;
    const responseText = sourceIsPrompt ? '' : sourceText;
    const finalText = String(record?.error || record?.result || '').trim();
    const displayText = running
      ? responseText
      : (finalText || responseText);
    const traceMessage = {
      ...source,
      content: displayText,
      body: { ...(source?.body || {}), text: displayText },
      processEntries,
      liveTraceEntries,
    };
    // Keep the persisted live trace as the primary source, then add any
    // process-log entries recovered after a gateway restart (tool calls,
    // results, and explicit user-visible reasoning summaries).
    _mergeMobileWorkflowTraceFromProcessEntries(traceMessage);
    return {
      ...traceMessage,
      role: 'ai',
      from: agentName,
      fromLabel: agentName,
      content: displayText,
      body: { ...(source?.body || {}), sender: agentName, text: displayText },
      processEntries,
      liveTraceEntries: traceMessage.liveTraceEntries,
      traceExpanded: typeof sideState.backgroundTraceExpanded === 'boolean'
        ? sideState.backgroundTraceExpanded
        : running,
      streaming: running,
      _done: !running,
      _backgroundAgentLive: running,
      workStartedAt: Number(source.workStartedAt || record?.startedAt || Date.now()) || Date.now(),
      workEndedAt: running ? undefined : (Number(source.workEndedAt || record?.completedAt || Date.now()) || Date.now()),
    };
  }

  let backgroundDetailPollTimer = null;
  let backgroundDetailPollInFlight = false;

  function stopMobileBackgroundAgentDetailRefresh() {
    if (backgroundDetailPollTimer) clearInterval(backgroundDetailPollTimer);
    backgroundDetailPollTimer = null;
  }

  function _applyMobileBackgroundStreamReplay(lane, replay) {
    if (!lane || !replay) return false;
    const stream = replay.stream || null;
    const streamId = String(stream?.streamId || '').trim();
    if (streamId && lane.streamId && lane.streamId !== streamId) {
      lane.lastSeq = 0;
      lane.message.processEntries = [];
      lane.message.liveTraceEntries = [];
    }
    if (streamId) lane.streamId = streamId;
    let changed = false;
    (Array.isArray(replay.events) ? replay.events : [])
      .slice()
      .sort((a, b) => Number(a?.seq || 0) - Number(b?.seq || 0))
      .forEach((frame) => {
        const seq = Math.max(0, Math.floor(Number(frame?.seq || 0)) || 0);
        if (seq && seq <= Number(lane.lastSeq || 0)) return;
        const data = frame?.data && typeof frame.data === 'object' ? frame.data : {};
        changed = _pushMobileBackgroundSpawnEvent({
          ...data,
          bgId: lane.id,
          backgroundId: lane.id,
          sessionId: lane.sessionId,
          spawnerSessionId: lane.sessionId,
          eventType: frame.type,
          streamId: frame.streamId || streamId,
          seq,
          at: frame.at,
        }, lane.sessionId) || changed;
      });
    return changed;
  }

  function _mergeMobileBackgroundAgentSessionSnapshot(lane, session) {
    if (!lane?.message || !session || typeof session !== 'object') return false;
    const entries = (Array.isArray(session.processLog) ? session.processLog : [])
      .map(_normalizeMobileProcessEntry)
      .filter(Boolean);
    let changed = false;
    for (const entry of entries) {
      const type = String(entry?.type || 'info').trim() || 'info';
      const text = String(entry?.text || entry?.content || entry?.message || '').trim();
      if (!text) continue;
      const before = Array.isArray(lane.message.processEntries) ? lane.message.processEntries.length : 0;
      const extra = entry.extra || entry;
      const isReasoningSummary = _isMobileReasoningSummaryTraceEntry(entry);
      const processType = isReasoningSummary ? 'think' : type;
      const processExtra = isReasoningSummary
        ? { ...(extra && typeof extra === 'object' ? extra : {}), source: 'reasoning_summary', visibility: 'user' }
        : extra;
      if (isReasoningSummary) {
        const beforeTrace = String(lane.message.liveTraceEntries?.find((item) => (
          String(item?.extra?.source || '').toLowerCase() === 'agent_progress'
        ))?.text || '');
        const traceChanged = _setMobileLiveProgressNarration(lane.message, text);
        changed = changed || traceChanged || beforeTrace !== text;
      } else {
        _pushMobileStreamProcessEntry(lane.message, processType, text, processExtra, true);
      }
      changed = changed || (Array.isArray(lane.message.processEntries) && lane.message.processEntries.length > before);
    }
    const snapshotTraceEntries = [
      ...(Array.isArray(session.liveTraceEntries) ? session.liveTraceEntries : []),
      ...(Array.isArray(session.history) ? session.history : []).flatMap((turn) => [
        ...(Array.isArray(turn?.liveTraceEntries) ? turn.liveTraceEntries : []),
        ...(Array.isArray(turn?.body?.liveTraceEntries) ? turn.body.liveTraceEntries : []),
      ]),
    ];
    for (const entry of snapshotTraceEntries) {
      const beforeTrace = Array.isArray(lane.message.liveTraceEntries) ? lane.message.liveTraceEntries.length : 0;
      if (!_appendMobileBackgroundSnapshotTrace(lane.message, entry)) continue;
      changed = changed || (Array.isArray(lane.message.liveTraceEntries) && lane.message.liveTraceEntries.length > beforeTrace);
    }
    const history = _mapServerHistoryToMobile(session.history || []);
    const finalTurn = [...history].reverse().find((entry) => entry?.role === 'ai' && String(entry?.content || entry?.body?.text || '').trim());
    const finalText = String(finalTurn?.content || finalTurn?.body?.text || '').trim();
    const terminal = ['completed', 'failed'].includes(String(lane.status || '').toLowerCase());
    if (terminal && finalText && !String(lane.result || lane.error || '').trim()) {
      if (lane.status === 'failed') lane.error = finalText;
      else lane.result = finalText;
      changed = true;
    }
    if (changed) {
      _mergeMobileWorkflowTraceFromProcessEntries(lane.message);
      lane.updatedAt = Date.now();
      persistBackgroundAgentWork(_mobileBackgroundSpawnWorkRecord(lane));
    }
    return changed;
  }

  async function refreshMobileBackgroundAgentDetail(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId || backgroundDetailPollInFlight) return;
    let lane = _mobileBackgroundSpawnLanes()[cleanId];
    if (!lane) {
      const stored = _mobileBackgroundAgentDetailRecord(cleanId);
      if (!stored) return;
      lane = _hydrateMobileBackgroundSpawnLane(stored, cleanId, requestedSession);
      if (!lane) return;
    }
    backgroundDetailPollInFlight = true;
    try {
      const currentLane = _mobileBackgroundSpawnLanes()[cleanId];
      let [statusResponse, replay, session] = await Promise.all([
        loadMobileBackgroundStatus(cleanId).catch(() => null),
        loadMobileBackgroundStreamReplay(cleanId, currentLane?.lastSeq || 0).catch(() => null),
        currentLane?.bgSessionId
          ? loadMobileChatSession(currentLane.bgSessionId, { force: true, historyLimit: 24, processLimit: 500, fullProcess: true }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const status = statusResponse?.status || statusResponse;
      if (status) _applyMobileBackgroundSpawnStatus(status, requestedSession);
      const refreshedLane = _mobileBackgroundSpawnLanes()[cleanId];
      if (refreshedLane && replay) _applyMobileBackgroundStreamReplay(refreshedLane, replay);
      if (!session && refreshedLane?.bgSessionId) {
        session = await loadMobileChatSession(refreshedLane.bgSessionId, {
          force: true,
          historyLimit: 24,
          processLimit: 500,
          fullProcess: true,
        }).catch(() => null);
      }
      if (refreshedLane && session) _mergeMobileBackgroundAgentSessionSnapshot(refreshedLane, session);
      const refreshedRecord = _mobileBackgroundAgentDetailRecord(cleanId);
      if (refreshedRecord) {
        _renderMobileBackgroundSpawnDock(backgroundSpawnDock, requestedSession);
        const detailOpen = sideState.backgroundAgentId === cleanId;
        const terminal = !['queued', 'running', 'in_progress'].includes(String(refreshedRecord.status || '').toLowerCase());
        if (detailOpen) {
          if (terminal) flushSideRender();
          else scheduleSideRenderSoon();
        }
        if (terminal) {
          stopMobileBackgroundAgentDetailRefresh();
        }
      }
    } finally {
      backgroundDetailPollInFlight = false;
    }
  }

  function startMobileBackgroundAgentDetailRefresh(id) {
    stopMobileBackgroundAgentDetailRefresh();
    refreshMobileBackgroundAgentDetail(id).catch(() => {});
    backgroundDetailPollTimer = setInterval(() => {
      if (document.hidden || sideState.backgroundAgentId !== String(id || '').trim()) return;
      refreshMobileBackgroundAgentDetail(id).catch(() => {});
    }, 2200);
  }

  function openMobileBackgroundAgentDetail(id) {
    const cleanId = String(id || '').trim();
    const record = _mobileBackgroundAgentDetailRecord(cleanId);
    if (!cleanId || !record) return;
    sideState.backgroundAgentId = cleanId;
    sideState.backgroundTraceExpanded = null;
    sideState.link = null;
    sideState.thread = [];
    sideState.sideThreadRendered = false;
    setMobileSideBusy(false);
    if (sideTitleEl) sideTitleEl.textContent = record.agentName || 'Background work';
    if (sideSubtitleEl) {
      const status = String(record.status || 'running').toLowerCase();
      sideSubtitleEl.textContent = `Background work · ${status === 'in_progress' ? 'running' : status}`;
    }
    sideInput?.setAttribute('placeholder', `Steer ${record.agentName || 'agent'} directly`);
    sideSheet?.removeAttribute('inert');
    sideSheet?.setAttribute('aria-hidden', 'false');
    sideSheet?.classList.add('open');
    sideSheet?.classList.add('background-agent-detail-mode');
    renderMobileSideSheet();
    startMobileBackgroundAgentDetailRefresh(cleanId);
    resizeSideInput();
  }

  function renderMobileSideSheet() {
    if (!sideThreadEl) return;
    const openBackgroundId = String(sideState.backgroundAgentId || '').trim();
    if (openBackgroundId && sideState.sideThreadRendered) {
      const renderedBackgroundMessage = sideThreadEl.querySelector('.pm-agent-chat-msg[data-pm-background-agent-message]');
      if (renderedBackgroundMessage
        && String(renderedBackgroundMessage.getAttribute('data-pm-background-agent-message') || '').trim() === openBackgroundId) {
        const renderedTimer = renderedBackgroundMessage.querySelector('[data-expandable="trace"]');
        if (renderedTimer) sideState.backgroundTraceExpanded = renderedTimer.classList.contains('expanded');
      }
    }
    const shouldFollowTail = !sideState.sideThreadRendered || _mobileSideThreadNearBottom(sideThreadEl);
    const backgroundRecord = sideState.backgroundAgentId
      ? _mobileBackgroundAgentDetailRecord(sideState.backgroundAgentId)
      : null;
    sideSheet?.classList.toggle('background-agent-detail-mode', !!backgroundRecord);
    if (backgroundRecord) {
      const status = String(backgroundRecord.status || 'running').toLowerCase();
      const running = ['queued', 'running', 'in_progress'].includes(status);
      const agentName = String(backgroundRecord.agentName || 'Background agent');
      const message = _mobileBackgroundAgentDetailMessage(backgroundRecord);
      const promptText = _mobileBackgroundAgentDetailPrompt(backgroundRecord);
      const promptMessage = promptText
        ? {
            role: 'user',
            content: promptText,
            body: { text: promptText },
            timestamp: Number(backgroundRecord.startedAt || Date.now()) || Date.now(),
          }
        : null;
      const steerHistory = (Array.isArray(backgroundRecord.steerMessages) ? backgroundRecord.steerMessages : [])
        .map((steer, index) => {
          const content = String(steer?.content || steer?.body?.text || '').trim();
          return {
            role: 'user',
            content,
            body: { ...(steer?.body || {}), text: content },
            timestamp: Number(steer?.timestamp || Date.now()) || Date.now(),
            channelLabel: 'steer',
            _backgroundSteerRowKey: `background:${backgroundRecord.id}:steer:${String(steer?.id || index)}`,
          };
        })
        .filter((steer) => steer.content);
      const promptHtml = promptMessage
        ? _renderChatMessageHtml(
            promptMessage,
            -1,
            `background:${backgroundRecord.id}:prompt`,
            `background-prompt:${backgroundRecord.id}`,
          )
        : '';
      const historyHtml = steerHistory.map((steer, index) => _renderChatMessageHtml(
        steer,
        index,
        steer._backgroundSteerRowKey,
        `background-steer:${backgroundRecord.id}:${String(steer._backgroundSteerRowKey || index)}`,
      )).join('');
      _reconcileMobileBackgroundAgentSideThread(sideThreadEl, `${promptHtml}${historyHtml}${_renderMobileAgentChatBubble(message, {
        sender: agentName,
        live: running,
        keepLiveTraceVisible: true,
        backgroundAgentId: backgroundRecord.id,
      })}`);
    } else {
      const visible = (Array.isArray(sideState.thread) ? sideState.thread : [])
        .filter((msg, index) => msg && msg.sideChatBoundary !== true && !_isMobileHiddenTranscriptMessage(msg, index));
      setInnerHTMLPreservingVisuals(sideThreadEl, visible.length
        ? visible.map((msg, index) => _renderChatMessageHtml(msg, index)).join('')
        : '<div class="pm-mobile-side-empty">Start the side chat from /side.</div>');
    }
    sideState.sideThreadRendered = true;
    _wireMobileProcessRunActions(sideThreadEl);
    _wireMobileChatEnhancements(sideThreadEl);
    // Background details use a separate reconciled thread, so install the
    // delegated work-timer disclosure listener here as well as on main chat.
    _installMobileTimestampReveal(sideThreadEl, () => {});
    if (shouldFollowTail) requestAnimationFrame(() => {
      if (sideThreadEl) sideThreadEl.scrollTop = sideThreadEl.scrollHeight;
    });
  }

  // Coalesce side-sheet streaming renders to a steady cadence (mirrors the main
  // thread's _scheduleThreadRender). Token text still accumulates immediately on
  // sideState.thread; only the full innerHTML rebuild is throttled. Finalization
  // must flush so the complete final answer always lands.
  let _sideRenderTimer = null;
  function scheduleSideRenderSoon() {
    if (_sideRenderTimer) return; // leading-guard coalesce
    _sideRenderTimer = setTimeout(() => {
      _sideRenderTimer = null;
      renderMobileSideSheet();
    }, 16);
  }
  function flushSideRender() {
    if (_sideRenderTimer) { clearTimeout(_sideRenderTimer); _sideRenderTimer = null; }
    renderMobileSideSheet();
  }

  function setMobileSideBusy(busy) {
    sideState.busy = !!busy;
    if (!sideSendBtn) return;
    const shouldAbort = sideState.busy && !String(sideInput?.value || '').trim();
    sideSendBtn.disabled = false;
    sideSendBtn.classList.toggle('is-abort', shouldAbort);
    sideSendBtn.title = shouldAbort ? 'Stop side chat' : 'Send side chat';
    sideSendBtn.setAttribute('aria-label', shouldAbort ? 'Stop side chat' : 'Send side chat');
    sideSendBtn.innerHTML = shouldAbort
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
      : ICONS.send;
  }

  async function ensureMobileSideParentSession() {
    if (requestedSession !== MOBILE_CHAT_SESSION_ID) return requestedSession;
    const sid = createMobileChatSessionId();
    const currentThread = [];
    __pmChat.threads[sid] = currentThread;
    __pmChat.attachments[sid] = getPendingAttachments().slice();
    __pmChat.activeSessionId = sid;
    _rememberMobileLastChatSession(sid);
    __pmChat.threads[requestedSession] = [];
    __pmChat.attachments[requestedSession] = [];
    requestedSession = sid;
    try {
      await createMobileChatSession(sid, { title: 'Mobile chat' });
      if (currentThread.length) await updateMobileChatSessionHistory(sid, _mobileHistoryForServer(currentThread), { resetCompaction: true });
    } catch (err) {
      console.warn('[mobile side chat] failed to create parent session:', err);
    }
    try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(sid)}`); } catch {}
    invalidateMobileDrawerSessions('mobile');
    return sid;
  }

  async function loadMobileSideThread(link) {
    const sid = String(link?.id || '').trim();
    if (!sid) return [];
    if (Array.isArray(__pmChat.threads[sid]) && __pmChat.threads[sid].length) return __pmChat.threads[sid];
    const session = await loadMobileChatSession(sid).catch(() => null);
    const history = Array.isArray(session?.history) ? session.history : [];
    const mapped = _mapServerHistoryToMobile(history);
    __pmChat.threads[sid] = mapped;
    return mapped;
  }

  async function createMobileSideChat(initialText = '') {
    const parentSessionId = await ensureMobileSideParentSession();
    const parentThread = Array.isArray(__pmChat.threads[parentSessionId]) ? __pmChat.threads[parentSessionId] : [];
    const sideId = _generateMobileSideChatId();
    const title = _makeMobileSideChatTitle(initialText || 'Side chat');
    const boundary = _buildMobileSideChatBoundaryMessage(parentSessionId, parentThread, requestedSession === MOBILE_CHAT_SESSION_ID ? 'New Chat' : 'Mobile chat');
    const sideThread = [boundary];
    const link = {
      id: sideId,
      parentSessionId,
      title,
      anchorPreview: String(initialText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      closed: false,
    };
    __pmChat.threads[sideId] = sideThread;
    const links = _loadMobileSideChatLinks().filter((item) => item.id !== sideId);
    _saveMobileSideChatLinks([link, ...links]);
    try {
      await createMobileChatSession(sideId, { title });
      await updateMobileChatSessionHistory(sideId, _mobileHistoryForServer(sideThread), { resetCompaction: true });
    } catch (err) {
      console.warn('[mobile side chat] failed to persist side session:', err);
    }
    invalidateMobileDrawerSessions('mobile');
    return { link, thread: sideThread };
  }

  async function openMobileSideChat(initialText = '') {
    const parentSessionId = await ensureMobileSideParentSession();
    const existing = _getMobileSideChatLinksForParent(parentSessionId)[0];
    const result = existing
      ? { link: existing, thread: await loadMobileSideThread(existing) }
      : await createMobileSideChat(initialText);
    sideState.backgroundAgentId = '';
    sideState.backgroundTraceExpanded = null;
    sideState.link = result.link;
    sideState.thread = Array.isArray(result.thread) ? result.thread : [];
    sideState.sideThreadRendered = false;
    setMobileSideBusy(false);
    sideInput?.setAttribute('placeholder', 'Follow up');
    if (sideTitleEl) sideTitleEl.textContent = result.link?.title || 'Side Chat';
    if (sideSubtitleEl) sideSubtitleEl.textContent = `Prometheus · ${String(parentSessionId).startsWith('mobile_') ? 'Mobile' : 'Chat'}`;
    sideSheet?.removeAttribute('inert');
    sideSheet?.setAttribute('aria-hidden', 'false');
    sideSheet?.classList.add('open');
    renderMobileSideSheet();
    resizeSideInput();
    if (initialText) {
      sideInput.value = '';
      setTimeout(() => sendMobileSideMessage(initialText), 0);
    } else {
      setTimeout(() => sideInput?.focus?.(), 40);
    }
  }

  function closeMobileSideChatSheet() {
    stopMobileBackgroundAgentDetailRefresh();
    sideState.backgroundAgentId = '';
    sideState.backgroundTraceExpanded = null;
    sideState.sideThreadRendered = false;
    sideSheet?.classList.remove('background-agent-detail-mode');
    sideSheet?.classList.remove('open');
    sideSheet?.setAttribute('aria-hidden', 'true');
    sideSheet?.setAttribute('inert', '');
    sideInput?.setAttribute('placeholder', 'Follow up');
    sideInput?.blur?.();
  }

  function applyMobileSideStreamEvent(aiTurn, evt) {
    if (!aiTurn || !evt?.type) return '';
    _maybeFlushMobileThinkingBeforeEvent(aiTurn, evt);
    switch (String(evt.type || '')) {
      case 'final_response_start':
        beginFinalResponse(aiTurn);
        scheduleSideRenderSoon();
        return 'streaming';
      case 'token':
        if (evt.text) {
          const chunk = String(evt.text);
          if (_shouldRouteMobileTokenToLiveTrace(aiTurn)) {
            _appendMobileLiveTrace(aiTurn, 'preamble', chunk, { append: true });
          } else {
            _appendMobileVisualStreamToken(aiTurn, chunk, scheduleSideRenderSoon);
          }
        }
        scheduleSideRenderSoon();
        return 'streaming';
      case 'agent_mode':
        aiTurn.agentExecutionMode = String(evt.mode || aiTurn.agentExecutionMode || '').trim();
        if (aiTurn.agentExecutionMode === 'execute') _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        if (evt.mode) _appendMobileProcess(aiTurn, 'info', `Agent mode: ${evt.mode}${evt.turnKind ? ` (${evt.turnKind})` : ''}`, evt);
        scheduleSideRenderSoon();
        return 'streaming';
      case 'thinking_delta': {
        if (_handleMobileThinkingDelta(aiTurn, evt)) scheduleSideRenderSoon();
        return 'streaming';
      }
      case 'reasoning_summary_delta': {
        if (_handleMobileReasoningSummaryDelta(aiTurn, evt)) scheduleSideRenderSoon();
        return 'streaming';
      }
      case 'reasoning_delta':
      case 'reasoning_summary': {
        const chunk = String(evt.text || evt.summary || evt.thinking || '');
        if (_handleMobileReasoningSummaryDelta(aiTurn, { ...evt, text: chunk })) scheduleSideRenderSoon();
        return 'streaming';
      }
      case 'thinking':
      case 'agent_thought': {
        if (_handleMobileCleanThought(aiTurn, evt)) scheduleSideRenderSoon();
        return 'streaming';
      }
      case 'info':
      case 'ui_preflight':
      case 'tool_progress':
        if (String(evt.type || '') === 'tool_progress') {
          _moveMobileWorkflowBubbleBeforeTool(aiTurn);
          aiTurn.toolActivityStarted = true;
          _collectMediaFromToolEvent(aiTurn, evt);
        }
        if (evt.message) {
          const messageText = String(evt.message);
          const isCompactionPreflight = String(evt.type || '') === 'ui_preflight' && /^Compacting the thread before continuing/i.test(messageText);
          if (!isCompactionPreflight) {
            _appendMobileProcess(aiTurn, 'info', messageText, evt);
            if (String(evt.type || '') === 'tool_progress') _applyMobileToolActivity(aiTurn, 'progress', evt);
            else _appendMobileLiveTrace(aiTurn, 'info', messageText);
          }
        }
        renderMobileSideSheet();
        return 'streaming';
      case 'heartbeat':
        return 'streaming';
      case 'tool_call':
        if (String(evt.action || evt.name || evt.toolName || '').trim() === 'context_compaction') {
          _appendMobileCompactionTrace(aiTurn, 'compacting', '', evt.args || evt);
          renderMobileSideSheet();
          return 'streaming';
        }
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        _appendMobileProcess(aiTurn, 'tool', _mobileToolLabel(evt), evt);
        _applyMobileToolActivity(aiTurn, 'call', evt);
        renderMobileSideSheet();
        return 'streaming';
      case 'tool_result':
        if (String(evt.action || evt.name || evt.toolName || '').trim() === 'context_compaction') {
          const status = String(evt?.extra?.status || '').toLowerCase() || (evt.error ? 'failed' : 'compacted');
          _appendMobileCompactionTrace(aiTurn, status, evt?.extra?.summary || '', evt.extra || evt);
          _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', status === 'failed' ? 'Context compaction failed' : 'Context compacted', evt);
          renderMobileSideSheet();
          return 'streaming';
        }
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        _collectMediaFromToolEvent(aiTurn, evt);
        _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', _mobileToolResultLabel(evt), evt);
        _applyMobileToolActivity(aiTurn, 'result', evt);
        renderMobileSideSheet();
        return 'streaming';
      case 'vision_injected':
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        _appendMobileVisionTrace(aiTurn, evt);
        renderMobileSideSheet();
        return 'streaming';
      case 'final':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        _mergeMobileRichArtifacts(aiTurn, evt.richArtifacts);
        if (evt.goalCompletionReport) aiTurn.goalCompletionReport = evt.goalCompletionReport;
        if (evt.text) {
          beginFinalResponse(aiTurn);
          _finishMobileVisualStreamText(aiTurn, String(evt.text));
        } else {
          _finishMobileVisualStreamText(aiTurn);
        }
        aiTurn.content = String(aiTurn.body.text || '');
        flushSideRender();
        return 'final';
      case 'done':
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        _mergeMobileRichArtifacts(aiTurn, evt.richArtifacts);
        if (evt.goalCompletionReport) aiTurn.goalCompletionReport = evt.goalCompletionReport;
        if (evt.reply) {
          beginFinalResponse(aiTurn);
          _finishMobileVisualStreamText(aiTurn, String(evt.reply));
        } else {
          _finishMobileVisualStreamText(aiTurn);
        }
        aiTurn.content = String(aiTurn.body.text || '');
        flushSideRender();
        return 'done';
      case 'error':
        _finishMobileVisualStreamText(aiTurn);
        _recordMobileChatError(aiTurn, { message: String(evt.message || 'Chat error'), rawBody: String(evt.message || ''), payload: evt });
        aiTurn.content = aiTurn.body.text;
        pmToast(aiTurn.errorPresentation);
        flushSideRender();
        return 'error';
      default:
        return '';
    }
  }

  async function sendMobileSideMessage(text = '') {
    const link = sideState.link;
    const sideId = String(link?.id || '').trim();
    const msg = String(text || sideInput?.value || '').trim();
    const backgroundId = String(sideState.backgroundAgentId || '').trim();
    if (backgroundId) {
      if (!msg) return;
      try {
        await sendMobileBackgroundSteer(backgroundId, msg);
        const steer = {
          id: `background_steer_${backgroundId}_${Date.now()}`,
          role: 'user',
          content: msg,
          timestamp: Date.now(),
          channelLabel: 'steer',
          workflowGroupId: `chat_steer_background_${backgroundId}`,
          workflowPart: 'interruption',
        };
        const lane = _mobileBackgroundSpawnLanes()[backgroundId];
        if (lane) {
          if (!lane.steerMessages.some((item) => item.content === msg && Math.abs(Number(item.timestamp || 0) - steer.timestamp) < 5000)) {
            lane.steerMessages.push(steer);
            lane.steerMessages = lane.steerMessages.slice(-80);
            lane.updatedAt = Date.now();
            persistBackgroundAgentWork(_mobileBackgroundSpawnWorkRecord(lane));
          }
        } else {
          const stored = _mobileBackgroundAgentDetailRecord(backgroundId);
          if (stored) {
            persistBackgroundAgentWork({
              ...stored,
              steerMessages: [...(stored.steerMessages || []), steer].slice(-80),
              updatedAt: Date.now(),
            });
          }
        }
        if (sideInput) {
          sideInput.value = '';
          resizeSideInput();
        }
        renderMobileSideSheet();
      } catch (error) {
        pmToast(`Could not steer ${_mobileBackgroundAgentDetailRecord(backgroundId)?.agentName || 'background agent'}: ${String(error?.message || error || 'The live agent is no longer available.')}`, 'error');
      }
      return;
    }
    if (sideState.busy && !msg) {
      try { sideState.abort?.abort?.(); } catch {}
      return;
    }
    if (!msg || sideState.busy) return;
    if (!sideId) {
      return;
    }
    if (sideInput) {
      sideInput.value = '';
      resizeSideInput();
    }
    const thread = Array.isArray(sideState.thread) ? sideState.thread : (sideState.thread = []);
    thread.push(_makeMobileUserMessage(msg));
    const aiTurn = {
      role: 'ai',
      streaming: true,
      time: '',
      timestamp: Date.now(),
      workStartedAt: Date.now(),
      body: { sender: '', text: '' },
      content: '',
      processEntries: [],
      liveTraceEntries: [],
      agentExecutionMode: 'execute',
    };
    thread.push(aiTurn);
    setMobileSideBusy(true);
    renderMobileSideSheet();
    const clientRequestId = _newMobileClientRequestId(sideId);
    let sideTurnFinished = false;
    const stream = streamChat({ message: msg, sessionId: sideId, clientRequestId }, {
      onEvent: (evt) => {
        const applied = applyMobileSideStreamEvent(aiTurn, evt);
        if (applied === 'done' || applied === 'error') finishMobileSideTurn();
      },
      onError: (err) => {
        if (err?.name === 'AbortError') return;
        _finishMobileVisualStreamText(aiTurn);
        _recordMobileChatError(aiTurn, err);
        aiTurn.content = aiTurn.body.text;
        finishMobileSideTurn();
        pmToast(aiTurn.errorPresentation);
      },
      onDone: () => finishMobileSideTurn(),
    });
    sideState.abort = { abort: () => {
      try { stream.abort(); } catch {}
      _finishMobileVisualStreamText(aiTurn);
      aiTurn.streaming = false;
      aiTurn.body.text = String(aiTurn.body.text || '').trim()
        ? `[Stopped by user]\n\n${aiTurn.body.text}`
        : '[Generation stopped by user.]';
      aiTurn.content = aiTurn.body.text;
      finishMobileSideTurn();
    } };

    function finishMobileSideTurn() {
      if (sideTurnFinished) {
        setMobileSideBusy(false);
        sideState.abort = null;
        return;
      }
      sideTurnFinished = true;
      _flushMobilePendingThinkingBurst(aiTurn);
      _finishMobileVisualStreamText(aiTurn);
      aiTurn.streaming = false;
      aiTurn.workEndedAt = Number(aiTurn.workEndedAt || Date.now()) || Date.now();
      aiTurn.workDurationMs = Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
      aiTurn.time = _nowTime();
      aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
      aiTurn.content = String(aiTurn.body?.text || '');
      _mergeMobileLiveTraceIntoProcess(aiTurn);
      setMobileSideBusy(false);
      sideState.abort = null;
      const links = _loadMobileSideChatLinks();
      const idx = links.findIndex((item) => item.id === sideId);
      if (idx >= 0) {
        links[idx] = { ...links[idx], title: links[idx].title || _makeMobileSideChatTitle(msg), updatedAt: Date.now(), closed: false };
        _saveMobileSideChatLinks(links);
      }
      updateMobileChatSessionHistory(sideId, _mobileHistoryForServer(thread), { resetCompaction: true }).catch((err) => {
        console.warn('[mobile side chat] failed to persist completed side turn:', err);
      });
      renderMobileSideSheet();
      invalidateMobileDrawerSessions('mobile');
    }
  }

  // ----- Mobile keyboard (visualViewport) controller -----
  // Goal: keep the chat shell (and tab bar) visually still, and float ONLY the
  // composer above the on-screen keyboard.
  //
  // The hard part is iOS Safari: when the input is focused it scrolls the
  // document to reveal it, which lifts the whole `position: fixed` shell up
  // above the keyboard. iOS won't undo that scroll on its own (the user has to
  // scroll the page back), and visualViewport events fire unreliably during the
  // keyboard animation. So we (a) measure keyboard height from
  // window.visualViewport, and (b) run a short requestAnimationFrame loop that
  // forces the document back to the top every frame while the keyboard settles
  // — effectively performing the "scroll back" the user was doing by hand.
  const _pmKbApp = document.querySelector('.pm-app') || page;
  const _pmKbTabbar = document.querySelector('.pm-tabbar');
  let _pmKbBaselineHeight = Math.max(
    Number(window.innerHeight || 0),
    Number(window.visualViewport?.height || 0),
  );
  let _pmKbRaf = 0;
  let _pmKbPinRaf = 0;
  let _pmKbPinUntil = 0;
  let _pmKbFocusActive = false;
  let _pmKbFocusGraceUntil = 0;
  let _pmKbFocusGraceTimer = 0;
  let _pmKbViewportMode = '';
  const _pmKbComposerShiftProperty = '--pm-keyboard-composer-shift';
  const _pmKbComposerViewportProperties = ['position', 'left', 'right', 'top', 'bottom', 'z-index'];
  function _pmKbComposerNodes() {
    const nodes = [form];
    if (sideSheet) nodes.push(...sideSheet.querySelectorAll('.pm-composer'));
    return nodes.filter((node, index, list) => node && list.indexOf(node) === index);
  }
  function _pmKbClearComposerShift() {
    _pmKbComposerNodes().forEach((node) => node.style.removeProperty(_pmKbComposerShiftProperty));
  }
  function _pmKbClearComposerViewportStyles() {
    _pmKbComposerNodes().forEach((node) => {
      _pmKbComposerViewportProperties.forEach((property) => node.style.removeProperty(property));
    });
  }
  function _pmKbSetComposerViewportStyles(bottomPx) {
    const composer = _pmKbActiveComposer();
    if (!composer) return;
    const layoutHeight = Math.max(
      Number(window.innerHeight || 0),
      Number(document.documentElement?.clientHeight || 0),
    );
    const vv = window.visualViewport;
    const visualBottom = Math.round(
      Math.max(0, Number(vv?.offsetTop || 0)) + Math.max(0, Number(vv?.height || layoutHeight || 0)),
    );
    const resolvedBottom = Math.max(8, Math.round(Number(bottomPx) || 8));
    // Safari can derive an auto `top` for a fixed element from its old flow
    // position while the document is being scrolled. Give the keyboard-owned
    // composer an explicit top and make bottom auto so that static-position
    // recalculation cannot move it to the top edge. The height observer below
    // reapplies this when the multiline composer grows.
    const viewportBottom = _pmKbViewportMode === 'visual' ? visualBottom : layoutHeight;
    const composerHeight = Math.max(0, Number(composer.getBoundingClientRect?.().height || 0));
    const top = Math.max(0, Math.round(viewportBottom - resolvedBottom - composerHeight));
    const values = {
      position: 'fixed',
      left: '10px',
      right: '10px',
      top: `${top}px`,
      bottom: 'auto',
      'z-index': '10020',
    };
    Object.entries(values).forEach(([property, value]) => {
      if (composer.style.getPropertyValue(property) !== value
        || composer.style.getPropertyPriority(property) !== 'important') {
        composer.style.setProperty(property, value, 'important');
      }
    });
  }
  let _pmKbComposerRepairRaf = 0;
  function _pmKbScheduleComposerPositionRepair() {
    if (_pmKbComposerRepairRaf || !_pmKbFocusActive || !_pmKbViewportMode) return;
    _pmKbComposerRepairRaf = requestAnimationFrame(() => {
      _pmKbComposerRepairRaf = 0;
      if (!_pmKbFocusActive || !_pmKbViewportMode) return;
      const composer = _pmKbActiveComposer();
      if (!composer) return;
      const rect = composer.getBoundingClientRect?.();
      if (!rect || !rect.height) return;
      const layoutHeight = Math.max(
        Number(window.innerHeight || 0),
        Number(document.documentElement?.clientHeight || 0),
      );
      const vv = window.visualViewport;
      const visualHeight = Math.max(0, Number(vv?.height || layoutHeight || 0));
      const visualBottom = Math.round(Math.max(0, Number(vv?.offsetTop || 0)) + visualHeight);
      const keyboardHeightOffset = vv ? Math.max(0, Math.round(layoutHeight - visualHeight)) : 0;
      const bottom = _pmKbViewportMode === 'layout' ? keyboardHeightOffset + 8 : 8;
      const viewportBottom = _pmKbViewportMode === 'visual' ? visualBottom : layoutHeight;
      const desiredTop = Math.max(0, Math.round(viewportBottom - bottom - rect.height));
      const drift = desiredTop - Math.round(rect.top);
      // Normal visualViewport panning should be a no-op. Only repair a large
      // displacement, which is the iOS fixed/static-position failure mode.
      if (Math.abs(drift) < 24) return;
      const currentTop = Number.parseFloat(composer.style.getPropertyValue('top'));
      const nextTop = Number.isFinite(currentTop) ? Math.max(0, Math.round(currentTop + drift)) : desiredTop;
      composer.style.setProperty('top', `${nextTop}px`, 'important');
    });
  }
  function _pmKbActiveComposer() {
    const sideFocused = sideSheet?.classList?.contains('open') && document.activeElement === sideInput;
    return sideFocused ? (sideInput?.closest?.('.pm-composer') || form) : form;
  }
  function _pmKbPinScroll() {
    // The document-scroll PWA path must remain fully user-scrollable. Its
    // fixed composer is handled by viewport sizing below; never write to the
    // document scroll position from this controller.
    if (document.body?.classList?.contains('pm-mobile-document-scroll')) return;
    if (performance.now() >= _pmKbPinUntil) return;
    try {
      if (window.pageYOffset) window.scrollTo(0, 0);
      const de = document.scrollingElement || document.documentElement;
      if (de && de.scrollTop) de.scrollTop = 0;
      if (document.body && document.body.scrollTop) document.body.scrollTop = 0;
    } catch {}
  }
  function _applyKeyboardOffset() {
    _pmKbRaf = 0;
    const vv = window.visualViewport;
    if (!_pmKbApp) return;
    const layoutHeight = Math.max(
      Number(window.innerHeight || 0),
      Number(document.documentElement?.clientHeight || 0),
    );
    const visualHeight = Math.max(0, Number(vv?.height || layoutHeight || 0));
    const visualTop = Math.max(0, Number(vv?.offsetTop || 0));
    // Keyboard height is the layout/visual height difference. Do not include
    // visualViewport.offsetTop here: iOS changes that value while the user
    // scrolls chat history, but the keyboard has not moved on screen.
    const visualBottom = Math.round(visualTop + visualHeight);
    const keyboardHeightOffset = vv
      ? Math.max(0, Math.round(layoutHeight - visualHeight))
      : 0;
    const baselineOffset = Math.max(0, Math.round(_pmKbBaselineHeight - (vv ? visualHeight : layoutHeight)));
    const composerFocused = document.activeElement === input
      || document.activeElement?.matches?.('#pm-new-project-name')
      || (sideSheet?.classList?.contains('open') && document.activeElement === sideInput);
    // Ignore small deltas from Safari's collapsing URL bar; only treat a
    // sizeable gap as a real keyboard. Some installed iOS PWAs shrink both
    // innerHeight and visualViewport.height, so their difference stays zero;
    // the pre-focus baseline catches that mode.
    // Treat a focused composer as keyboard-active during the opening
    // transition.  On iOS, the resize/visualViewport event can arrive after
    // the focus frame, especially when the document is already at its bottom;
    // waiting for a measurable delta leaves the composer behind the keyboard
    // until a manual scroll produces the next viewport event.
    // A stale/shrinking visual viewport can outlive the field that opened the
    // keyboard. Do not let that closing-frame measurement re-hide the tab bar;
    // only an actively focused composer or project-name field owns this state.
    const open = composerFocused && (
      keyboardHeightOffset > 90
      || baselineOffset > 90
      || (_pmKbFocusActive && performance.now() < _pmKbFocusGraceUntil)
    );
    const keyboardViewportSettled = keyboardHeightOffset > 90 || baselineOffset > 90;
    // iOS has two incompatible fixed-position behaviors: some webviews anchor
    // fixed children to the layout viewport, while others already anchor them
    // to the visual viewport. Classify that behavior once after the keyboard
    // settles; reclassifying on every scroll makes the composer jump between
    // two different bottom anchors.
    if (!open) {
      _pmKbViewportMode = '';
      _pmKbApp.classList.remove('pm-keyboard-open');
      _pmKbClearComposerShift();
      _pmKbClearComposerViewportStyles();
    } else {
      _pmKbApp.classList.add('pm-keyboard-open');
      if (keyboardViewportSettled && !_pmKbViewportMode) {
        const composerBottom = Number(_pmKbActiveComposer()?.getBoundingClientRect?.().bottom || 0);
        _pmKbViewportMode = composerBottom > 0 && composerBottom <= visualBottom + 44 ? 'visual' : 'layout';
      }
      _pmKbSetComposerViewportStyles(_pmKbViewportMode === 'layout' ? keyboardHeightOffset + 8 : 8);
    }
    const keyboardOffset = open && _pmKbViewportMode === 'layout' ? keyboardHeightOffset : 0;
    const keyboardOffsetValue = `${keyboardOffset}px`;
    if (_pmKbApp.style.getPropertyValue('--pm-keyboard-offset') !== keyboardOffsetValue) {
      _pmKbApp.style.setProperty('--pm-keyboard-offset', keyboardOffsetValue);
    }
    // A focused field is not proof that iOS has presented the keyboard yet.
    // During that short focus-only window the new-project dialog must remain
    // centered; switch to keyboard anchoring only after the viewport has
    // actually contracted.
    syncNewProjectPopoverToKeyboard(open && keyboardViewportSettled, visualBottom, layoutHeight);
    // Do this on the actual nav node instead of depending on ancestor CSS.
    // Installed iOS PWAs may retain an older mobile stylesheet for one launch,
    // while this controller still has the authoritative keyboard state.
    if (_pmKbTabbar) {
      if (open) _pmKbTabbar.style.setProperty('display', 'none', 'important');
      else _pmKbTabbar.style.removeProperty('display');
    }
    syncContextDockToComposer();
    // While the keyboard is open, keep the document pinned to the top so iOS
    // can't leave the fixed shell lifted above the keyboard.
    if (open) _pmKbPinScroll();
    if (!open && !composerFocused) {
      _pmKbBaselineHeight = Math.max(_pmKbBaselineHeight, Number(window.innerHeight || 0), Number(vv?.height || 0));
    }
  }
  function _scheduleKeyboardOffset() {
    if (_pmKbRaf) return;
    _pmKbRaf = requestAnimationFrame(_applyKeyboardOffset);
  }
  function _pmKbPinLoop() {
    _pmKbPinRaf = 0;
    _pmKbPinScroll();
    _applyKeyboardOffset();
    if (performance.now() < _pmKbPinUntil) {
      _pmKbPinRaf = requestAnimationFrame(_pmKbPinLoop);
    }
  }
  function _startKbPinLoop(ms = 700) {
    if (document.body?.classList?.contains('pm-mobile-document-scroll')) return;
    _pmKbPinUntil = Math.max(_pmKbPinUntil, performance.now() + ms);
    if (!_pmKbPinRaf) _pmKbPinRaf = requestAnimationFrame(_pmKbPinLoop);
  }
  const _onVvResize = () => { _scheduleKeyboardOffset(); _startKbPinLoop(400); };
  // A visualViewport scroll is page panning, not a keyboard resize. Once the
  // keyboard mode is locked, re-running the anchor pass here makes the
  // composer chase offsetTop and visibly flicker while chat scrolls.
  const _onVvScroll = () => {
    if (_pmKbFocusActive && _pmKbViewportMode) {
      _pmKbScheduleComposerPositionRepair();
      return;
    }
    _scheduleKeyboardOffset();
  };
  const _onWindowKeyboardResize = () => { _scheduleKeyboardOffset(); };
  const _onWindowKeyboardScroll = () => {
    if (_pmKbFocusActive && _pmKbViewportMode) _pmKbScheduleComposerPositionRepair();
  };
  const _pmVisualViewport = window.visualViewport || null;
  if (_pmVisualViewport) {
    _pmVisualViewport.addEventListener('resize', _onVvResize);
    _pmVisualViewport.addEventListener('scroll', _onVvScroll, { passive: true });
  }
  window.addEventListener('resize', _onWindowKeyboardResize, { passive: true });
  window.addEventListener('scroll', _onWindowKeyboardScroll, { passive: true });
  body?.addEventListener('scroll', _onWindowKeyboardScroll, { passive: true });
  const _onComposerFocusKb = () => {
    _pmKbFocusActive = true;
    _pmKbFocusGraceUntil = performance.now() + 1600;
    if (_pmKbFocusGraceTimer) window.clearTimeout(_pmKbFocusGraceTimer);
    _pmKbFocusGraceTimer = window.setTimeout(() => {
      _pmKbFocusGraceTimer = 0;
      _scheduleKeyboardOffset();
    }, 1700);
    _pmKbBaselineHeight = Math.max(_pmKbBaselineHeight, Number(window.innerHeight || 0), Number(window.visualViewport?.height || 0));
    // Move the real composer before Safari finishes presenting the keyboard;
    // the later viewport pass replaces the provisional 8px bottom edge with
    // the measured visual-viewport edge.
    // Cancel any transcript shift that was queued before focus. The composer
    // and keyboard must have one owner during this visual-viewport hand-off.
    chatComposerShiftAnimation?.cancel?.();
    chatComposerShiftAnimation = null;
    _pmKbApp.style.setProperty('--pm-keyboard-offset', '0px');
    _pmKbApp.classList.add('pm-keyboard-open');
    // Keep the dialog centered during the focus hand-off. The first measured
    // visualViewport/layout resize will move it to the keyboard edge.
    syncNewProjectPopoverToKeyboard(false, Number(window.visualViewport?.height || window.innerHeight || 0), Number(window.innerHeight || 0));
    _pmKbTabbar?.style.setProperty('display', 'none', 'important');
    _pmKbSetComposerViewportStyles(8);
    // Pin aggressively through the keyboard's open animation so the shell never
    // ends up stuck above the keyboard waiting for a manual scroll.
    _pmKbViewportMode = '';
    _startKbPinLoop(1200);
    _scheduleKeyboardOffset();
    // Safari can report the focused element before it settles the visual
    // viewport. Re-check across that animation instead of leaving the
    // composer at an intermediate, off-keyboard position.
    [120, 320, 700].forEach((delay) => setTimeout(_scheduleKeyboardOffset, delay));
  };
  const _onComposerBlurKb = () => {
    _pmKbFocusActive = false;
    _pmKbFocusGraceUntil = 0;
    if (_pmKbFocusGraceTimer) {
      window.clearTimeout(_pmKbFocusGraceTimer);
      _pmKbFocusGraceTimer = 0;
    }
    _pmKbPinUntil = 0;
    _pmKbViewportMode = '';
    // Blur is the authoritative end of the keyboard interaction. Restore the
    // persistent chrome immediately; waiting for a final visualViewport event
    // can leave iOS PWAs with the tab bar permanently hidden/frozen.
    _pmKbApp.classList.remove('pm-keyboard-open');
    _pmKbTabbar?.style.removeProperty('display');
    syncNewProjectPopoverToKeyboard(false);
    // iOS restores visualViewport and the fixed containing block over several
    // frames after blur. Re-anchor throughout that close animation, including
    // the retained multiline-text case where the composer stays tall.
    [60, 180, 360, 700].forEach((delay) => setTimeout(() => {
      _scheduleKeyboardOffset();
      updateChatComposerSpace();
    }, delay));
  };
  const _isKeyboardComposerTarget = (target) => target === input
    || target === sideInput
    || target?.matches?.('#pm-composer-input, #pm-mobile-side-input, #pm-new-project-name');
  const _onComposerFocusInKb = (event) => {
    if (_isKeyboardComposerTarget(event.target)) _onComposerFocusKb();
  };
  const _onComposerFocusOutKb = (event) => {
    if (_isKeyboardComposerTarget(event.target)) _onComposerBlurKb();
  };
  const _resetKeyboardControllerForLifecycle = () => {
    _pmKbFocusActive = false;
    _pmKbFocusGraceUntil = 0;
    _pmKbPinUntil = 0;
    _pmKbViewportMode = '';
    if (_pmKbFocusGraceTimer) {
      window.clearTimeout(_pmKbFocusGraceTimer);
      _pmKbFocusGraceTimer = 0;
    }
    _pmKbApp?.classList.remove('pm-keyboard-open');
    _pmKbApp?.style.removeProperty('--pm-keyboard-offset');
    _pmKbClearComposerShift();
    _pmKbClearComposerViewportStyles();
    _pmKbTabbar?.style.removeProperty('display');
  };
  const _onPageHideKb = () => _resetKeyboardControllerForLifecycle();
  const _onPageShowKb = () => { _resetKeyboardControllerForLifecycle(); _scheduleKeyboardOffset(); };
  const _onVisibilityChangeKb = () => {
    if (document.visibilityState === 'hidden') _resetKeyboardControllerForLifecycle();
    else _onPageShowKb();
  };
  page.addEventListener('focusin', _onComposerFocusInKb);
  page.addEventListener('focusout', _onComposerFocusOutKb);
  window.addEventListener('pagehide', _onPageHideKb);
  window.addEventListener('pageshow', _onPageShowKb);
  document.addEventListener('visibilitychange', _onVisibilityChangeKb);
  function _teardownKeyboardController() {
    if (_pmKbRaf) { cancelAnimationFrame(_pmKbRaf); _pmKbRaf = 0; }
    if (_pmKbPinRaf) { cancelAnimationFrame(_pmKbPinRaf); _pmKbPinRaf = 0; }
    _pmKbPinUntil = 0;
    if (_pmVisualViewport) {
      _pmVisualViewport.removeEventListener('resize', _onVvResize);
      _pmVisualViewport.removeEventListener('scroll', _onVvScroll);
    }
    window.removeEventListener('resize', _onWindowKeyboardResize);
    window.removeEventListener('scroll', _onWindowKeyboardScroll);
    body?.removeEventListener('scroll', _onWindowKeyboardScroll);
    if (_pmKbComposerRepairRaf) { cancelAnimationFrame(_pmKbComposerRepairRaf); _pmKbComposerRepairRaf = 0; }
    window.removeEventListener('pagehide', _onPageHideKb);
    window.removeEventListener('pageshow', _onPageShowKb);
    document.removeEventListener('visibilitychange', _onVisibilityChangeKb);
    page.removeEventListener('focusin', _onComposerFocusInKb);
    page.removeEventListener('focusout', _onComposerFocusOutKb);
    _pmKbFocusActive = false;
    _pmKbFocusGraceUntil = 0;
    if (_pmKbFocusGraceTimer) {
      window.clearTimeout(_pmKbFocusGraceTimer);
      _pmKbFocusGraceTimer = 0;
    }
    if (_pmKbApp) {
      _pmKbApp.classList.remove('pm-keyboard-open');
      _pmKbApp.style.removeProperty('--pm-keyboard-offset');
    }
    _pmKbClearComposerShift();
    _pmKbClearComposerViewportStyles();
    _pmKbTabbar?.style.removeProperty('display');
  }

  function _closeChatVoiceMode() {
    // Always drop the full-screen voice overlay first. Cleanup can throw while
    // tearing down mic/audio/listeners; if that aborts before class removal,
    // the fixed composer keeps covering chat and only the higher-z hamburger
    // remains tappable until a hard navigation/refresh.
    const clearChatVoiceUi = () => {
      try {
        if (chatVoiceHost) {
          chatVoiceHost.innerHTML = '';
          chatVoiceHost.hidden = true;
          delete chatVoiceHost.dataset.pmVoiceMounted;
        }
      } catch {}
      try { if (chatVoiceShell) chatVoiceShell.hidden = true; } catch {}
      try { form?.classList.remove('is-voice-active'); } catch {}
      try {
        contextDock?.classList.remove('pm-chat-context-dock-voice-hidden');
        contextDock?.setAttribute('aria-hidden', 'false');
      } catch {}
      try { body?.classList.remove('pm-chat-voice-occluded'); } catch {}
      try {
        document.body?.classList.remove(
          'pm-chat-voice-active',
          'pm-chat-voice-new-chat',
          'pm-chat-voice-existing-chat',
          'pm-chat-voice-focus',
          'pm-chat-voice-docked',
        );
      } catch {}
      try { body?.style?.removeProperty?.('--pm-chat-voice-occlusion-top'); } catch {}
    };
    try {
      chatVoiceHost?._pmCleanup?.('chat_voice_close');
    } catch (err) {
      console.warn('[mobile chat] voice cleanup failed during close:', err);
    } finally {
      clearChatVoiceUi();
      if (modeLauncher) {
        setChatComposerMode(false, {
          animate: false,
          preserveScroll: true,
          reason: 'voice-close',
          update: false,
        });
      }
      try { updateChatComposerSpace(); } catch {}
      try { updateComposerSubmitState(); } catch {}
    }
  }

  function _voiceAttachmentSessionId() {
    return String(__pmRealtimeAgent.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  }

  function _voiceAttachmentSessionAvailable() {
    return !!(__pmRealtimeAgent.conn || __pmRealtimeAgent.connecting || _isMobileRealtimeAgentMode());
  }

  async function openVoiceCameraCaptureFromSheet() {
    if (!_voiceAttachmentSessionAvailable()) {
      pmToast('Start realtime voice first, then attach a photo.', 'info');
      return;
    }
    let sid = _voiceAttachmentSessionId();
    if (sid === MOBILE_CHAT_SESSION_ID) {
      sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'voice_attachment_session_created' });
    }
    try {
      await openCameraCapture({
        target: 'voice',
        onCapture: async (normalized, extra) => {
          const dataUrl = extra?.dataUrl || normalized?.dataUrl || '';
          const delivered = await _sendMobileRealtimeAgentCameraSnapshot({
            dataUrl,
            name: extra?.file?.name || normalized?.name || 'Camera snapshot',
            mimeType: normalized?.mimeType || extra?.file?.type || 'image/jpeg',
            base64: normalized?.base64,
          }, {
            source: 'chat_voice_camera_shutter',
            sessionId: sid,
          });
          if (!delivered) throw new Error('Could not send camera snapshot to voice.');
        },
        onVideoCapture: async (payload) => {
          const frames = Array.isArray(payload?.frames) ? payload.frames : [];
          if (!frames.length) { pmToast('Could not sample video frames.', 'error'); return; }
          _stageMobileRealtimeAgentImage({
            dataUrl: frames[0].dataUrl,
            name: `Video clip (${frames.length} frame${frames.length === 1 ? '' : 's'})`,
            mimeType: frames[0].mimeType || 'image/jpeg',
          }, sid);
          for (let i = 1; i < frames.length; i++) {
            if (!String(frames[i]?.dataUrl || '').trim()) continue;
            _stageMobileRealtimeAgentImage({
              dataUrl: frames[i].dataUrl,
              name: frames[i].name || `video-frame-${i + 1}.jpg`,
              mimeType: frames[i].mimeType || 'image/jpeg',
              base64: '',
            }, sid, { toast: false });
          }
        },
      });
    } catch (err) {
      _voiceDebug('realtime-agent-camera-open-failed', { message: err?.message || String(err) });
      pmToast(err?.message || 'Could not open camera.', 'error');
    }
  }

  async function stageVoicePhotoFiles(files = []) {
    if (!_voiceAttachmentSessionAvailable()) {
      pmToast('Start realtime voice first, then attach a photo.', 'info');
      return;
    }
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return;
    let sid = _voiceAttachmentSessionId();
    if (sid === MOBILE_CHAT_SESSION_ID) {
      sid = await _ensureDurableMobileVoiceSession({ title: 'Mobile voice', source: 'voice_attachment_session_created' });
    }
    const valid = [];
    let unsupported = 0;
    let oversized = 0;
    for (const file of list.slice(0, 8)) {
      if (!_isVoicePhotoFile(file)) { unsupported += 1; continue; }
      if (Number(file?.size || 0) > VOICE_PHOTO_FILE_MAX_BYTES) { oversized += 1; continue; }
      valid.push(file);
    }
    if (unsupported) pmToast('Voice attachments currently support photos only. Use regular chat for other files.', 'error');
    if (oversized) pmToast(`Photo too large for voice. Limit is ${_formatBytes(VOICE_PHOTO_FILE_MAX_BYTES)}.`, 'error');
    if (!valid.length) return;
    try {
      const normalized = await Promise.all(valid.map(_normalizeMobileFile));
      const dataUrls = [];
      normalized.filter(Boolean).forEach((item) => {
        if (item.kind !== 'image' || !item.dataUrl) return;
        _stageMobileRealtimeAgentImage({
          dataUrl: item.dataUrl,
          name: item.name || 'Photo attachment',
          mimeType: item.mimeType || 'image/jpeg',
          base64: item.base64,
        }, sid);
        dataUrls.push(item.dataUrl);
      });
      if (dataUrls.length) _voiceDebug('realtime-agent-image-files-staged', { count: dataUrls.length });
    } catch (err) {
      pmToast(err?.message || 'Could not read the selected photo. Check photo or file permission.', 'error');
    }
  }

  function _onChatVoiceUpdate(sessionId, detail = {}) {
    const sid = String(sessionId || __pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID).trim();
    const activeSid = String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    // A draft may be rotated to a durable id by the local voice flow. Adopt
    // that id only after the flow itself has made it active. A late tool/voice
    // event from the page's previous session is not navigation authority.
    if (sid && requestedSession === MOBILE_CHAT_SESSION_ID && sid !== MOBILE_CHAT_SESSION_ID && activeSid === sid) {
      requestedSession = sid;
      _rememberMobileLastChatSession(sid);
      try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(sid)}`); } catch {}
      invalidateMobileDrawerSessions('mobile');
      // Recompute the inline Voice chrome against the newly durable session.
      // Otherwise the first spoken turn leaves the draft-only selectors and
      // new-chat body class visible even though chat state has already moved.
      if (form?.classList.contains('is-voice-active')) _setChatVoiceActive(true);
    }
    if (!sid || (sid === requestedSession && sid === activeSid)) {
      if (sid && __pmChat.threads?.[sid]) {
        __pmChat.thread = __pmChat.threads[sid];
      } else {
        _activeMobileThread();
      }
      if (detail?.force === true || detail?.reason === 'voice_turn_started' || detail?.reason === 'voice_session_created') {
        _flushThreadRender(threadEl, body, sid || requestedSession);
      } else {
        renderThreadSoon();
      }
      updateComposerSubmitState(sid || requestedSession);
      return;
    }
    // `force` means render immediately when visible; it does not grant a
    // background stream permission to change the selected conversation.
  }

  const previousVoiceUpdateBridge = window.__pmMobileChatVoiceUpdate;
  window.__pmMobileChatVoiceUpdate = _onChatVoiceUpdate;
  const _chatVoiceUpdateEventHandler = (event) => {
    const update = event?.detail || {};
    _onChatVoiceUpdate(update.sessionId, update);
  };
  const _chatVoiceLayoutEventHandler = (event) => {
    if (event?.detail?.docked !== true) return;
    // The dock changes the available bottom clearance. Wait for that layout
    // transition, then force the transcript to the true latest position.
    requestAnimationFrame(() => requestAnimationFrame(() => _scrollChat(body)));
  };
  const _openChatVoiceAttachSheet = () => openAttachSheet({ target: 'voice' });
  window.addEventListener('pm-mobile-chat-voice-update', _chatVoiceUpdateEventHandler);
  window.addEventListener('pm-mobile-chat-voice-layout', _chatVoiceLayoutEventHandler);
  chatVoiceClose?.addEventListener('click', _closeChatVoiceMode);
  chatVoiceCamera?.addEventListener('click', _openChatVoiceAttachSheet);

  async function _toggleChatVoiceMode({ autoStart = false } = {}) {
    if (!chatVoiceHost) return;
    try {
      await _setChatVoiceTarget();
    } catch (err) {
      console.warn('[mobile chat] voice target could not be prepared:', err);
      pmToast(err?.message || 'Could not prepare voice mode.', 'error');
      return;
    }
    const warmMicPromise = autoStart
      ? _requestMobileVoiceMicFromGesture().catch((err) => {
          console.warn('[mobile chat] microphone warmup failed:', err);
          return null;
        })
      : null;
    if (chatVoiceHost.hidden || !chatVoiceHost.dataset.pmVoiceMounted) {
      _setChatVoiceActive(true);
      chatVoiceHost.dataset.pmVoiceMounted = '1';
      renderVoicePage(chatVoiceHost, {
        navigate,
        inline: true,
        inlineChatSessionId: __pmVoice.targetSessionId,
        inlineChatSessionLabel: __pmVoice.targetSessionLabel,
        autoStart,
        openCameraCapture,
        openAttachmentSheet: () => openAttachSheet({ target: 'voice' }),
      }).catch((err) => {
        console.warn('[mobile chat] inline voice mount failed:', err);
        pmToast('Could not start voice mode.', 'error');
      }).finally(() => {
        updateChatComposerSpace();
      });
      if (warmMicPromise) void warmMicPromise;
      updateComposerSubmitState();
      return;
    }
    _setChatVoiceActive(true);
    const voiceMic = chatVoiceHost.querySelector('#pm-voice-mic');
    if (autoStart && voiceMic) voiceMic.click();
    updateChatComposerSpace();
    updateComposerSubmitState();
  }

  const focusChatComposerInput = () => {
    if (!input || form?.classList?.contains('is-voice-active')) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      try { input.focus(); } catch {}
    }
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    // A few iOS WebViews report focus one frame late after the morph. Keep the
    // trusted click's synchronous focus first, then retry only if it did not
    // stick; this opens the native keyboard without changing the scroll anchor.
    requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
      }
    });
  };
  const onChatModeKeyboardClick = (event) => {
    event.preventDefault();
    if (document.body?.classList?.contains('pm-chat-voice-active')) return;
    if (event.isTrusted) {
      try { pmHaptic?.(10); } catch {}
    }
    setChatComposerMode(true, {
      animate: true,
      preserveScroll: true,
      reason: 'keyboard',
    });
    focusChatComposerInput();
  };
  const onChatModeVoiceClick = (event) => {
    event.preventDefault();
    if (document.body?.classList?.contains('pm-chat-voice-active')) return;
    if (!chatVoiceHost) return;
    if (event.isTrusted) {
      try { pmHaptic?.(12); } catch {}
    }
    setChatComposerMode(true, {
      animate: true,
      preserveScroll: true,
      reason: 'voice',
      update: false,
    });
    void _toggleChatVoiceMode({ autoStart: true }).catch((err) => {
      console.warn('[mobile chat] launcher voice open failed:', err);
      if (!document.body?.classList?.contains('pm-chat-voice-active')) {
        setChatComposerMode(false, {
          animate: false,
          preserveScroll: true,
          reason: 'voice-error',
        });
      }
    });
  };
  modeKeyboardButton?.addEventListener('click', onChatModeKeyboardClick);
  modeVoiceButton?.addEventListener('click', onChatModeVoiceClick);

  async function syncMobileThreadHistory(history = _mobileHistoryForServer(), options = {}) {
    try {
      await updateMobileChatSessionHistory(requestedSession, history, options);
    } catch (err) {
      console.warn('[mobile chat] failed to sync history:', err);
      pmToast('Could not sync edited chat history.', 'error');
    }
  }

  async function copyMobileChatMessage(index) {
    const msg = _activeMobileThread()[index];
    const text = _mobileMessageCopyText(msg);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      pmToast('Message copied', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); pmToast('Message copied', 'success'); }
      catch { pmToast('Copy failed', 'error'); }
      ta.remove();
    }
  }

  function _mobileSpeakResponseLabel() {
    const settings = __pmVoice?.settings || {};
    const mode = String(settings.voiceMode || 'default');
    const provider = String(settings.ttsProvider || __pmVoice?.provider?.ttsProvider || _outputProviderForMode(mode) || 'browser');
    if (provider === 'openai_realtime') return `${_mobileRealtimeProviderLabel()} · ${String(settings.realtimeVoice || __pmVoice?.provider?.voice || 'saved voice')}`;
    if (provider === 'xai') return `xAI / Grok · ${String(settings.serverVoice || __pmVoice?.provider?.ttsVoice || 'saved voice')}`;
    if (provider === 'openai') return `OpenAI · ${String(settings.serverVoice || __pmVoice?.provider?.ttsVoice || 'saved voice')}`;
    return 'Browser voice';
  }

  function _showMobileSpeakResponseConfirm({ text, onConfirm }) {
    const clean = _cleanVoiceSpeechText(text);
    if (!clean) return;
    const existing = document.querySelector('.pm-speak-confirm-overlay');
    existing?.remove?.();
    const overlay = document.createElement('div');
    overlay.className = 'pm-speak-confirm-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <section class="pm-speak-confirm" role="dialog" aria-modal="true" aria-labelledby="pm-speak-confirm-title">
        <button type="button" class="pm-speak-confirm-close" data-speak-close aria-label="Close">${ICONS.x}</button>
        <div class="pm-speak-confirm-icon">${ICONS.volume || ICONS.play}</div>
        <h2 id="pm-speak-confirm-title">Speak response?</h2>
        <p>Play this Prometheus message with ${escapeHtml(_mobileSpeakResponseLabel())}.</p>
        <div class="pm-speak-confirm-actions">
          <button type="button" class="pm-speak-confirm-btn secondary" data-speak-close>Cancel</button>
          <button type="button" class="pm-speak-confirm-btn primary" data-speak-confirm>Speak</button>
        </div>
      </section>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', async (event) => {
      const target = event.target;
      if (target === overlay || target?.closest?.('[data-speak-close]')) {
        close();
        return;
      }
      if (target?.closest?.('[data-speak-confirm]')) {
        try { _unlockVoiceAudio(); } catch {}
        close();
        try { await onConfirm?.(clean); }
        catch (err) { pmToast(err?.message || 'Could not speak response', 'error'); }
      }
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  }

  async function speakMobileChatMessage(index) {
    const msg = _activeMobileThread()[index];
    if (!_isMobileAssistantMessage(msg)) return;
    const text = _mobileMessageCopyText(msg);
    if (!String(text || '').trim()) return;
    _showMobileSpeakResponseConfirm({
      text,
      onConfirm: async (clean) => {
        __pmVoice.lastAi = clean;
        _ttsStop();
        await _ttsSpeak(clean);
      },
    });
  }

  async function forkMobileConversationFromMessage(index) {
    const thread = _activeMobileThread();
    const sourceSessionId = String(__pmChat.activeSessionId || '').trim();
    const msg = thread[index];
    if (!_isMobileAssistantMessage(msg)) return;
    const forkedThread = thread.slice(0, index + 1).map(_cloneMobileMessageForBranch).filter(Boolean);
    const sid = createMobileChatSessionId();
    const titleSeed = forkedThread.find((item) => item.role === 'user')?.body?.text || 'Forked chat';
    const title = String(titleSeed || 'Forked chat').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Forked chat';
    try {
      await createMobileChatSession(sid, { title });
      await updateMobileChatSessionHistory(sid, _mobileHistoryForServer(forkedThread));
      if (sourceSessionId) {
        await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sid)}/resources/copy-from`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceSessionId }),
        });
      }
      __pmChat.threads[sid] = forkedThread;
      __pmChat.attachments[sid] = [];
      __pmChat.activeSessionId = sid;
      _rememberMobileLastChatSession(sid);
      __pmChat.editingMessageIndex = -1;
      navigate?.(`#mobile/chat/${encodeURIComponent(sid)}`);
      pmToast('Conversation forked', 'success');
    } catch (err) {
      pmToast(`Fork failed: ${err.message || err}`, 'error');
    }
  }

  function startMobileEditUserMessage(index) {
    const thread = _activeMobileThread();
    const msg = thread[index];
    if (!msg || msg.role !== 'user') return;
    __pmChat.editingMessageIndex = index;
    msg._editingDraft = _mobileMessageCopyText(msg);
    renderThreadNow();
    setTimeout(() => {
      const inputEl = threadEl?.querySelector(`[data-msg-edit-input="${index}"]`);
      inputEl?.focus?.();
      inputEl?.setSelectionRange?.(inputEl.value.length, inputEl.value.length);
    }, 0);
  }

  function cancelMobileEditUserMessage(index) {
    const msg = _activeMobileThread()[index];
    if (msg) delete msg._editingDraft;
    __pmChat.editingMessageIndex = -1;
    renderThreadNow();
  }

  async function submitMobileEditedUserMessage(index) {
    const inputEl = threadEl?.querySelector(`[data-msg-edit-input="${index}"]`);
    const nextText = String(inputEl?.value || '').trim();
    if (!nextText) return;
    await rerunMobileEditedUserMessage(index, nextText);
  }

  async function rerunMobileEditedUserMessage(index, nextText) {
    const thread = _activeMobileThread();
    const userMsg = thread[index];
    if (!userMsg || userMsg.role !== 'user') return;
    if (__pmChat.activeRuns?.[requestedSession]?.busy) {
      try { await markMobileEditRerunReset(requestedSession); } catch {}
      __pmChat.activeRuns?.[requestedSession]?.abort?.abort();
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const previousText = _mobileMessageCopyText(userMsg);
    if (previousText === nextText && !__pmChat.activeRuns?.[requestedSession]?.busy) {
      cancelMobileEditUserMessage(index);
      return;
    }
    const variants = _ensureMobilePromptVariantsForEdit(index) || [];
    const editedUser = _makeMobileUserMessage(nextText, Array.isArray(userMsg.body?.attachments) ? userMsg.body.attachments : []);
    const nextVariant = { user: _cloneMobileMessageForBranch(editedUser), assistant: null, tail: [] };
    variants.push(nextVariant);
    const activeIndex = variants.length - 1;
    const activeUser = _attachMobilePromptVariantsToUserMessage(editedUser, variants, activeIndex);
    thread.splice(index, thread.length - index, activeUser);
    __pmChat.thread = thread;
    __pmChat.threads[requestedSession] = thread;
    __pmChat.editingMessageIndex = -1;
    _reindexMobileThread(thread);
    renderThreadNow();
    await syncMobileThreadHistory(_mobileHistoryForServer(thread.slice(0, index)), { resetCompaction: true });
    await sendMessage(nextText, { reuseExistingUserIndex: index, skipUserBubble: true, attachments: Array.isArray(userMsg.body?.attachments) ? userMsg.body.attachments : [] });
  }

  async function switchMobilePromptVariant(index, targetIndex) {
    if (__pmChat.activeRuns?.[requestedSession]?.busy) {
      pmToast('Wait for Prometheus to finish before switching variants.', 'info');
      return;
    }
    const thread = _activeMobileThread();
    const msg = thread[index];
    if (!msg || msg.role !== 'user') return;
    const variants = _saveActiveMobilePromptVariant(index);
    if (!Array.isArray(variants) || !variants[targetIndex]) return;
    const selected = variants[targetIndex];
    const nextUser = _attachMobilePromptVariantsToUserMessage(selected.user, variants, targetIndex);
    const replacement = [nextUser];
    if (selected.assistant) replacement.push(_cloneMobileMessageForBranch(selected.assistant));
    if (Array.isArray(selected.tail)) replacement.push(...selected.tail.map(_cloneMobileMessageForBranch).filter(Boolean));
    thread.splice(index, thread.length - index, ...replacement);
    __pmChat.editingMessageIndex = -1;
    _reindexMobileThread(thread);
    renderThreadNow();
    await syncMobileThreadHistory(_mobileHistoryForServer(thread), { resetCompaction: true });
  }

  async function handleMobileMessageAction(button) {
    const action = String(button?.getAttribute?.('data-msg-action') || '').trim();
    const index = Number(button?.getAttribute?.('data-msg-index'));
    if (!action || !Number.isFinite(index)) return;
    if (action === 'copy' || action === 'speak' || action === 'fork') {
      try { pmHaptic(12); } catch {}
      try {
        button.classList.add('is-pressed');
        window.setTimeout(() => button.classList.remove('is-pressed'), 220);
      } catch {}
    }
    if (action === 'copy') return copyMobileChatMessage(index);
    if (action === 'speak') return speakMobileChatMessage(index);
    if (action === 'fork') return forkMobileConversationFromMessage(index);
    if (action === 'edit') return startMobileEditUserMessage(index);
    if (action === 'cancel-edit') return cancelMobileEditUserMessage(index);
    if (action === 'submit-edit') return submitMobileEditedUserMessage(index);
    if (action === 'variant-prev') return switchMobilePromptVariant(index, _getMobilePromptVariantActiveIndex(index) - 1);
    if (action === 'variant-next') return switchMobilePromptVariant(index, _getMobilePromptVariantActiveIndex(index) + 1);
  }

  function noteChatStreamSeq(evt) {
    if (!evt) return true;
    const seq = Math.max(0, Math.floor(Number(evt?.seq || 0)) || 0);
    const streamId = evt?.streamId ? String(evt.streamId) : '';
    const cid = typeof evt.clientRequestId === 'string' ? evt.clientRequestId.trim() : '';
    if (cid) {
      if (!__pmChat.sentClientRequestIds || typeof __pmChat.sentClientRequestIds !== 'object') __pmChat.sentClientRequestIds = {};
      const previous = __pmChat.sentClientRequestIds[requestedSession];
      const currentRun = __pmChat.activeRuns?.[requestedSession] || {};
      const currentStreamId = String(currentRun.streamId || '').trim();
      // A second tab may have a speculative request ID for the same session.
      // Once the gateway gives us a stream ID, that stream is the authority;
      // adopt its request identity instead of dropping every replay frame.
      // Only reject a frame when this tab already owns a different, known
      // stream and the incoming frame is demonstrably from that other stream.
      if (previous && previous !== cid && currentStreamId && streamId && currentStreamId !== streamId) return false;
      __pmChat.sentClientRequestIds[requestedSession] = cid;
    }
    const runtimeId = String(evt?.runtimeId || evt?.run?.id || evt?.activeRun?.id || '').trim();
    if (runtimeId) {
      if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
      const run = __pmChat.activeRuns[requestedSession] || {};
      __pmChat.activeRuns[requestedSession] = { ...run, busy: run.busy !== false, runtimeId };
      _rememberMobileActiveRun(requestedSession, { runtimeId });
    }
    if (!seq) {
      return receipts.accept(requestedSession, evt);
    }
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    const run = __pmChat.activeRuns[requestedSession] || {};
    const previousStreamId = String(run.streamId || '').trim();
    const streamChanged = !!streamId && !!previousStreamId && streamId !== previousStreamId;
    const prevSeq = Math.max(0, Math.floor(Number(run.lastSeq || 0)) || 0);
    if (!streamChanged && seq <= prevSeq) return false;
    if (!receipts.accept(requestedSession, evt)) return false;
    __pmChat.activeRuns[requestedSession] = {
      ...run,
      busy: true,
      lastSeq: seq,
      streamId: streamId || run.streamId || '',
      runtimeId: runtimeId || run.runtimeId || '',
      clientRequestId: cid || run.clientRequestId || '',
    };
    _rememberMobileActiveRun(requestedSession, {
      lastSeq: seq,
      streamId: streamId || run.streamId || '',
      runtimeId: runtimeId || run.runtimeId || '',
      clientRequestId: cid || run.clientRequestId || '',
    });
    return true;
  }

  function replayFrameToEvent(frame) {
    if (!frame) return null;
    return {
      type: String(frame.type || ''),
      ...(frame.data || {}),
      seq: frame.seq,
      streamId: frame.streamId,
      at: frame.at,
    };
  }

  function processEntriesFromReplayFrames(frames) {
    const entries = [];
    const replayState = { liveTraceEntries: entries, streaming: true };
    for (const frame of Array.isArray(frames) ? frames : []) {
      const evt = replayFrameToEvent(frame);
      if (!evt?.type) continue;
      switch (evt.type) {
        case 'agent_mode':
          if (evt.mode) entries.push({ type: 'info', text: `Agent mode: ${evt.mode}${evt.turnKind ? ` (${evt.turnKind})` : ''}`, extra: evt });
          break;
        case 'thinking':
        case 'agent_thought': {
          _handleMobileCleanThought(replayState, evt);
          break;
        }
        case 'thinking_delta': {
          // Match live handling: raw thinking deltas stay private. An explicit
          // reasoning summary is reconstructed into the same replaceable
          // progress slot used by the active stream.
          if (String(evt.source || '').toLowerCase() === 'reasoning_summary') {
            const text = String(evt.thinking || evt.text || '');
            if (text) {
              _setMobileLiveProgressNarration(replayState, text);
            }
          }
          break;
        }
        case 'reasoning_summary_delta': {
          const text = String(evt.text || evt.summary || '');
          if (text) {
            _setMobileLiveProgressNarration(replayState, text);
          }
          break;
        }
        case 'info':
        case 'ui_preflight':
          if (evt.message) entries.push({ type: 'info', text: String(evt.message), extra: evt });
          break;
        case 'heartbeat':
          break;
        case 'tool_call': {
          applyToolActivityEvent(entries, 'call', evt);
          break;
        }
        case 'tool_result': {
          applyToolActivityEvent(entries, 'result', evt);
          break;
        }
        case 'tool_progress': {
          applyToolActivityEvent(entries, 'progress', evt);
          break;
        }
        case 'canvas_present': {
          const path = String(evt.path || '').trim();
          if (path) entries.push({ type: 'file', text: `Presented file: ${path}`, extra: evt });
          break;
        }
        case 'model_switched':
        case 'main_model_changed': {
          const model = evt.model || evt.modelRef || evt.providerId || '';
          if (model) entries.push({ type: 'info', text: `Model: ${model}`, extra: evt });
          break;
        }
        default:
          break;
      }
    }
    _flushMobileTraceThoughtProbe(replayState, { force: true });
    return entries;
  }

function _resetMobileLiveAiTurnForReplay(aiTurn, options = {}) {
  if (!aiTurn) return;
  _clearMobileVisualStreamTimer(aiTurn);
    const startedAtRaw = Number(options.startedAt || 0);
    const startedAt = Number.isFinite(startedAtRaw) && startedAtRaw > 0
      ? startedAtRaw
      : Number(aiTurn.workStartedAt || aiTurn.timestamp || Date.now()) || Date.now();
    aiTurn.streaming = true;
    aiTurn.time = '';
    aiTurn.timestamp = startedAt;
    aiTurn.workStartedAt = startedAt;
    aiTurn.workEndedAt = 0;
    aiTurn.workDurationMs = 0;
    aiTurn.body = { ...(aiTurn.body || {}), sender: '', text: '' };
    aiTurn.content = '';
    aiTurn.processEntries = [];
    aiTurn.liveTraceEntries = [];
    aiTurn.finalResponseStarted = false;
    delete aiTurn._pmFinalReceived;
    delete aiTurn._pmLiveActivityCompleted;
    aiTurn.toolActivityStarted = false;
    aiTurn.agentExecutionMode = '';
    if (options.clientRequestId) aiTurn._clientRequestId = options.clientRequestId;
    delete aiTurn.fileChanges;
    delete aiTurn.productCarousel;
    delete aiTurn.richArtifacts;
    delete aiTurn._pmVisualStreamPending;
    delete aiTurn._pmVisualStreamFull;
  }


  function applyMobileChatStreamEvent(aiTurn, evt) {
    aiTurn = _mobileStreamTargetTurn(aiTurn);
    if (!aiTurn || !evt?.type) return '';
    if (!noteChatStreamSeq(evt)) return 'duplicate';
    if (evt.type === 'error' && _isMobileRuntimeAbortEvent(evt)) {
      if (aiTurn._pmAbortRequested === true || aiTurn._pmAbortAcknowledged === true) {
        _ackMobileAbort(aiTurn);
        return 'aborted';
      }
      if (aiTurn._pmFinalReceived === true) return 'duplicate';
    }
    const eventClientRequestId = String(evt.clientRequestId || '').trim();
    if (eventClientRequestId && (aiTurn._pmAdmissionPending === true || !String(aiTurn._clientRequestId || '').trim())) {
      aiTurn._clientRequestId = eventClientRequestId;
    }
    if (evt.streamId) aiTurn._streamId = String(evt.streamId).trim();
    if (evt.runtimeId || evt.run?.id || evt.activeRun?.id) {
      aiTurn.runtimeId = String(evt.runtimeId || evt.run?.id || evt.activeRun?.id || '').trim();
    }
    if (evt.type !== 'error') {
      aiTurn._pmAdmissionPending = false;
      delete aiTurn._pmAdmissionClientRequestId;
    }
    if (evt.type !== 'error') _clearRecoveredMobileChatError(aiTurn);
    _maybeFlushMobileThinkingBeforeEvent(aiTurn, evt);
    const sharedRuntime = mobileChatRuntimeAdapter.observeStreamEvent(requestedSession, aiTurn, evt);
    try {
      switch (evt.type) {
      case 'final_response_start':
        beginFinalResponse(aiTurn);
        _settleMobileChatSteerWorkflow(__pmChat.threads?.[requestedSession], aiTurn);
        renderThreadSoon();
        return 'streaming';
      case 'token':
        if (evt.text) {
          const chunk = String(evt.text);
          if (_shouldRouteMobileTokenToLiveTrace(aiTurn)) {
            _appendMobileLiveTrace(aiTurn, 'preamble', chunk, { append: true });
          } else {
            _appendMobileVisualStreamToken(aiTurn, chunk, renderThreadSoon);
            mobileChatRuntimeAdapter.appendStreamEvent(sharedRuntime, aiTurn, evt, chunk);
          }
          _settleMobileChatSteerWorkflow(__pmChat.threads?.[requestedSession], aiTurn);
        }
        renderThreadSoon();
        return 'streaming';
      case 'agent_mode':
        aiTurn.agentExecutionMode = String(evt.mode || aiTurn.agentExecutionMode || '').trim();
        if (aiTurn.agentExecutionMode === 'execute') _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        if (evt.mode) _appendMobileProcess(aiTurn, 'info', `Agent mode: ${evt.mode}${evt.turnKind ? ` (${evt.turnKind})` : ''}`, evt);
        renderThreadSoon();
        return 'streaming';
      case 'runtime_registered':
        if (evt.runtimeId || evt.run?.id) {
          aiTurn.runtimeId = String(evt.runtimeId || evt.run?.id || '').trim();
        }
        return 'streaming';
      case 'coding_context_packet': {
        const status = String(evt.status || 'omitted');
        const reason = String(evt.reason || 'unknown');
        const age = Number.isFinite(Number(evt.ageMs)) ? `, age ${Math.round(Number(evt.ageMs) / 1000)}s` : '';
        aiTurn.codingContextPacketDecision = { ...evt, receivedAt: Date.now() };
        if (status !== 'omitted' || evt.taskId) {
          _appendMobileProcess(aiTurn, 'info', `Code context: ${status} (${reason}${age})`, evt);
          renderThreadSoon();
        }
        return 'streaming';
      }
      case 'thinking_delta': {
        if (_handleMobileThinkingDelta(aiTurn, evt)) renderThreadSoon();
        return 'streaming';
      }
      case 'reasoning_summary_delta': {
        if (_handleMobileReasoningSummaryDelta(aiTurn, evt)) renderThreadSoon();
        return 'streaming';
      }
      case 'reasoning_delta':
      case 'reasoning_summary': {
        const chunk = String(evt.text || evt.summary || evt.thinking || '');
        if (_handleMobileReasoningSummaryDelta(aiTurn, { ...evt, text: chunk })) renderThreadSoon();
        return 'streaming';
      }
      case 'thinking':
      case 'agent_thought': {
        if (_handleMobileCleanThought(aiTurn, evt)) renderThreadSoon();
        return 'streaming';
      }
      case 'info':
      case 'ui_preflight':
        if (evt.message) {
          const messageText = String(evt.message);
          const isCompactionPreflight = String(evt.type || '') === 'ui_preflight' && /^Compacting the thread before continuing/i.test(messageText);
          if (!isCompactionPreflight) {
            _appendMobileProcess(aiTurn, 'info', messageText, evt);
          }
          renderThreadSoon();
        }
        return 'streaming';
      case 'heartbeat':
        if (evt.message) setChatConnectionStatus(true, String(evt.message));
        return 'streaming';
      case 'progress_state':
        _applyMobileMainPlanProgress(evt, requestedSession);
        _renderMobileMainPlanDock(mainPlanDock, requestedSession);
        updateChatComposerSpace();
        return 'streaming';
      case 'tool_call': {
        if (String(evt.action || evt.name || evt.toolName || '').trim() === 'context_compaction') {
          _appendMobileCompactionTrace(aiTurn, 'compacting', '', evt.args || evt);
          renderThreadSoon();
          return 'streaming';
        }
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        const label = _mobileToolLabel(evt);
        const args = _safeJsonPreview(evt.args || evt.params || evt.input);
        _appendMobileProcess(aiTurn, 'tool', `${label}${args ? `: ${args}` : ''}`, evt);
        _applyMobileToolActivity(aiTurn, 'call', evt);
        renderStreamingThreadNow();
        return 'streaming';
      }
      case 'tool_result': {
        if (String(evt.action || evt.name || evt.toolName || '').trim() === 'context_compaction') {
          const status = String(evt?.extra?.status || '').toLowerCase() || (evt.error ? 'failed' : 'compacted');
          _appendMobileCompactionTrace(aiTurn, status, evt?.extra?.summary || '', evt.extra || evt);
          _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', status === 'failed' ? 'Context compaction failed' : 'Context compacted', evt);
          renderThreadSoon();
          return 'streaming';
        }
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        const label = _mobileToolResultLabel(evt);
        const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
        _collectMediaFromToolEvent(aiTurn, evt);
        _appendMobileProcess(aiTurn, evt.error ? 'error' : 'result', `${label}${result ? ` -> ${result}` : ' complete'}`, evt);
        _applyMobileToolActivity(aiTurn, 'result', evt);
        if (_clearMobileToolProgress(requestedSession, String(evt.action || evt.name || evt.toolName || ''))) {
          _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        }
        renderStreamingThreadNow();
        return 'streaming';
      }
      case 'vision_injected':
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        _appendMobileVisionTrace(aiTurn, evt);
        renderThreadSoon();
        return 'streaming';
      case 'tool_progress': {
        _moveMobileWorkflowBubbleBeforeTool(aiTurn);
        aiTurn.toolActivityStarted = true;
        _collectMediaFromToolEvent(aiTurn, evt);
        const messageText = String(evt.message || '').trim();
        const progressText = messageText ? `${_mobileToolLabel(evt)}: ${messageText}` : _mobileToolLabel(evt);
        if (messageText) {
          _appendMobileProcess(aiTurn, 'info', progressText, evt);
          _applyMobileToolActivity(aiTurn, 'progress', evt);
        }
        if (_setMobileToolProgress(requestedSession, evt)) {
          _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        }
        renderStreamingThreadNow();
        return 'streaming';
      }
      case 'canvas_present': {
        const path = String(evt.path || '').trim();
        if (!path) return 'streaming';
        const name = evt.name || path.split(/[\\/]/).pop();
        const kind = _mobileMediaKind({ path, name });
        _mergeMobileMediaIntoMessage(aiTurn, [{ path, name, kind }]);
        _appendMobileProcess(aiTurn, 'file', `Presented file: ${path}`, evt);
        renderStreamingThreadNow();
        window.__pmCanvasSheet?.open({
          name,
          kind,
          path,
          src: _mobileMediaUrl({ path }, 'inline'),
          download: _mobileMediaUrl({ path }, 'download'),
        });
        return 'streaming';
      }
      case 'model_stream_event': {
        const modelEvent = evt.event && typeof evt.event === 'object' ? evt.event : {};
        const eventType = String(modelEvent.type || '').trim();
        if (eventType === 'tool_call_start' || eventType === 'tool_call_done') {
          _moveMobileWorkflowBubbleBeforeTool(aiTurn);
          aiTurn.toolActivityStarted = true;
          _applyMobileToolActivity(aiTurn, eventType === 'tool_call_start' ? 'prepare' : 'prepared', {
            ...modelEvent,
            action: modelEvent.name,
          });
          renderStreamingThreadNow();
        }
        return 'streaming';
      }
      case 'model_switched':
      case 'main_model_changed': {
        const detail = notifyMobileModelChanged(evt, { sessionId: __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID });
        const model = detail?.modelRef || detail?.model || evt.model || evt.modelRef || evt.providerId || 'model';
        _appendMobileProcess(aiTurn, 'info', `Model: ${model}`, evt);
        renderThreadSoon();
        return 'streaming';
      }
      case 'model_reverted': {
        // switch_model is turn-scoped; gateway emits this at turn end to revert the badge.
        import('./mobile-model-badge.js').then(({ refreshMobileModelBadge }) => {
          refreshMobileModelBadge(true, null).catch(() => {});
        }).catch(() => {});
        return 'streaming';
      }
      case 'session_title':
        invalidateMobileDrawerSessions('mobile');
        return 'streaming';
      case 'final':
        _closeMobileTraceThoughts(aiTurn);
        aiTurn._pmLiveActivityCompleted = true;
        _clearMobileToolProgress(requestedSession);
        _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        _mergeMobileRichArtifacts(aiTurn, evt.richArtifacts);
        if (evt.text) {
          beginFinalResponse(aiTurn);
          _finishMobileVisualStreamText(aiTurn, String(evt.text));
        } else {
          _finishMobileVisualStreamText(aiTurn);
        }
        if (evt.goalCompletionReport) aiTurn.goalCompletionReport = evt.goalCompletionReport;
        aiTurn._pmFinalReceived = true;
        aiTurn.workStartedAt = Number(evt.workStartedAt || aiTurn.workStartedAt || aiTurn.createdAt || Date.now()) || Date.now();
        aiTurn.workEndedAt = Number(evt.workEndedAt || aiTurn.workEndedAt || Date.now()) || Date.now();
        aiTurn.workDurationMs = Number.isFinite(Number(evt.workDurationMs))
          ? Math.max(0, Number(evt.workDurationMs))
          : Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
        _settleMobileChatSteerWorkflow(__pmChat.threads?.[requestedSession], aiTurn);
        _rememberMobileCompletedAssistantTurn(requestedSession, aiTurn);
        mobileChatRuntimeAdapter.completeStream(requestedSession, evt.text || aiTurn.body?.text || aiTurn.content, aiTurn);
        _scheduleMobileThreadCacheSave(requestedSession, 80);
        _clearMobileBackgroundSpawnDockForSession(requestedSession);
        renderThreadSoon();
        return 'final';
      case 'done':
        _closeMobileTraceThoughts(aiTurn);
        aiTurn._pmLiveActivityCompleted = true;
        _clearMobileToolProgress(requestedSession);
        _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        _collectMediaFromToolEvent(aiTurn, evt);
        if (evt.fileChanges) aiTurn.fileChanges = evt.fileChanges;
        if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(aiTurn, evt.productCarousel);
        _mergeMobileRichArtifacts(aiTurn, evt.richArtifacts);
        if (evt.goalCompletionReport) aiTurn.goalCompletionReport = evt.goalCompletionReport;
        if (evt.reply) {
          beginFinalResponse(aiTurn);
          _finishMobileVisualStreamText(aiTurn, String(evt.reply));
        } else {
          _finishMobileVisualStreamText(aiTurn);
        }
        if (_isMobileGoalStartAcknowledgementText(evt.reply || aiTurn.body?.text || aiTurn.content)) {
          aiTurn.messageKind = 'goal_command_ack';
        }
        aiTurn.workStartedAt = Number(evt.workStartedAt || aiTurn.workStartedAt || aiTurn.createdAt || Date.now()) || Date.now();
        aiTurn.workEndedAt = Number(evt.workEndedAt || aiTurn.workEndedAt || Date.now()) || Date.now();
        aiTurn.workDurationMs = Number.isFinite(Number(evt.workDurationMs))
          ? Math.max(0, Number(evt.workDurationMs))
          : Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
        _settleMobileChatSteerWorkflow(__pmChat.threads?.[requestedSession], aiTurn);
        mobileChatRuntimeAdapter.completeStream(requestedSession, evt.reply || aiTurn.body?.text || aiTurn.content, aiTurn);
        return 'done';
      case 'error':
        _closeMobileTraceThoughts(aiTurn);
        aiTurn._pmLiveActivityCompleted = true;
        _clearMobileToolProgress(requestedSession);
        _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        _finishMobileVisualStreamText(aiTurn);
        _recordMobileChatError(aiTurn, { message: String(evt.message || 'Chat error'), rawBody: String(evt.message || ''), payload: evt });
        mobileChatRuntimeAdapter.completeStream(requestedSession, aiTurn.body?.text || aiTurn.content, aiTurn);
        pmToast(aiTurn.errorPresentation);
        renderThreadNow();
        return 'error';
        default:
          return '';
      }
    } finally {
      // Rich process, trace, artifact, and lifecycle fields are updated by
      // the mobile event helpers above. Commit the complete source row after
      // each event so the runtime remains authoritative for the next paint.
      const streamTurnKey = String(sharedRuntime?.snapshot?.stream?.turnKey || '').trim();
      mobileChatRuntimeAdapter.replaceTranscriptRow(requestedSession, aiTurn, {
        key: streamTurnKey || undefined,
        source: `mobile-stream-event:${String(evt.type || 'unknown')}`,
      });
    }
  }

  function finalizeMobileLiveAiTurn(aiTurn) {
    aiTurn = _mobileStreamTargetTurn(aiTurn);
    if (!aiTurn) return;
    _closeMobileTraceThoughts(aiTurn);
    aiTurn._pmLiveActivityCompleted = true;
    _flushMobilePendingThinkingBurst(aiTurn);
    _finishMobileVisualStreamText(aiTurn);
    aiTurn.streaming = false;
    aiTurn.workEndedAt = Number(aiTurn.workEndedAt || Date.now()) || Date.now();
    aiTurn.workDurationMs = Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
    aiTurn.time = _nowTime();
    aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
    aiTurn.content = String(aiTurn.body?.text || '');
    _mergeMobileLiveTraceIntoProcess(aiTurn);
    _settleMobileChatSteerWorkflow(__pmChat.threads?.[requestedSession], aiTurn);
    _rememberMobileCompletedAssistantTurn(requestedSession, aiTurn);
    mobileChatRuntimeAdapter.completeStream(requestedSession, aiTurn.body?.text || aiTurn.content, aiTurn);
    if (__pmChat.activeRuns?.[requestedSession]) __pmChat.activeRuns[requestedSession].abort = null;
    __pmChat.abort = null;
    _clearMobileActiveRun(requestedSession);
    _markMobileSessionRunning(requestedSession, false);
    if (_isMobileChatSessionVisibleToUser(requestedSession)) {
      markMobileChatSessionRead(requestedSession, Date.now()).catch(() => {});
    }
    const timerKey = String(requestedSession || 'chat');
    mobileStreamRenderScheduler.cancel(`mobile:thread:${timerKey}`);
    mobileStreamRenderScheduler.cancel(`mobile:patch:${timerKey}`);
    const scrollSnapshot = _mobileChatScrollSnapshot(body);
    const committedFinalTurn = mobileChatRuntimeAdapter.replaceTranscriptRow(requestedSession, aiTurn, {
      source: 'mobile-recovery-final',
    });
    const committedSource = committedFinalTurn?.source || aiTurn;
    // The mobile timeline deliberately omits command acknowledgements such as
    // "Started main-chat goal mode.". A direct row patch bypasses that
    // timeline filter and can put the acknowledgement back into the DOM until
    // the next reconnect/history paint. Force the filtered paint at this
    // boundary; the real main_chat_goal runtime turn is a separate row and
    // remains visible as soon as its lifecycle events arrive.
    if (_isMobileHiddenTranscriptMessage(committedSource)) {
      renderThreadNow();
    } else {
      const patchedFinal = _patchMobileThreadMessage(
        threadEl,
        committedSource,
        _activeMobileThread().indexOf(aiTurn),
      );
      if (patchedFinal) {
        _syncMobileWorkTimer(threadEl, body, requestedSession);
        _restoreMobileChatScroll(body, scrollSnapshot);
      } else {
        renderThreadNow();
      }
    }
    const finalThread = _activeMobileThread();
    _saveMobileThreadCache(requestedSession, finalThread);
    updateMobileChatSessionHistory(requestedSession, _mobileHistoryForServer(finalThread)).catch((err) => {
      console.warn('[mobile chat] failed to persist recovered turn:', err);
    });
    setBusy(false);
  }

  function addCommandTurn(command, response) {
    const activeThread = _activeMobileThread();
    activeThread.push(_makeMobileUserMessage(command));
    const aiTurn = {
      role: 'ai',
      time: _nowTime(),
      timestamp: Date.now(),
      content: '',
      body: {
        sender: 'Prometheus',
        text: response.text || '',
        actions: Array.isArray(response.actions) ? response.actions : [],
      },
    };
    activeThread.push(aiTurn);
    renderThreadNow();
    return aiTurn;
  }

  function updateCommandTurn(turn, patch = {}) {
    if (!turn) return;
    turn.time = _nowTime();
    turn.body = {
      ...(turn.body || {}),
      ...patch,
      actions: Array.isArray(patch.actions) ? patch.actions : (turn.body?.actions || []),
    };
    renderThreadNow();
  }

  function normalizeBareSlashCommand(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!/^\/[a-z_]+$/.test(raw)) return '';
    if (raw === '/model') return '/models';
    return ['/models', '/new', '/screenshot', '/restart', '/update', '/stop', '/stop_now'].includes(raw) ? raw : '';
  }

  async function requestMobileMainChatAbort(sessionId = requestedSession, { showToast = true } = {}) {
    const sid = String(sessionId || requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    mobileChatRuntimeAdapter.requestInterruption(sid);
    const runtimeId = String(
      __pmChat.activeRuns?.[sid]?.runtimeId ||
      __pmChat.activeRuns?.[requestedSession]?.runtimeId ||
      _readMobileActiveRun(sid)?.runtimeId ||
      ''
    ).trim();
    const localAbort =
      __pmChat.activeRuns?.[sid]?.abort ||
      __pmChat.activeRuns?.[requestedSession]?.abort ||
      __pmChat.abort;
    let localAbortRequested = false;

    if (localAbort && typeof localAbort.abort === 'function') {
      localAbortRequested = true;
      try { localAbort.abort(); } catch (err) {
        console.warn('[mobile chat] local abort failed:', err);
      }
    } else {
      const activeThread = _activeMobileThread();
      const aiTurn = _findLatestAssistantTurn(activeThread);
      if (aiTurn?.streaming) {
        aiTurn._pmAbortRequested = true;
        _appendMobileProcess(aiTurn, 'warn', 'Stop requested. Aborting the live runtime now.');
        const streamed = String(aiTurn.body?.text || aiTurn.content || '').trim();
        aiTurn.body = aiTurn.body || { sender: 'Prometheus', text: '' };
        aiTurn.body.text = streamed
          ? `[Stopped by user]\n\n${streamed}`
          : '[Generation stopped by user. Runtime abort sent and process log preserved.]';
        aiTurn.content = aiTurn.body.text;
        _ackMobileAbort(aiTurn);
        finalizeMobileLiveAiTurn(aiTurn);
      }
      _clearMobileActiveRun(sid);
      _markMobileSessionRunning(sid, false);
      setBusy(false, sid);
    }

    try {
      const direct = await stopMobileMainChat(sid, { runtimeId, source: 'mobile_stop_button' });
      if (direct?.success) {
        if (showToast) pmToast('Stopped.', 'success');
        return { success: true, message: direct.message || 'Main chat aborted.', localAbortRequested, result: direct };
      }

      const targetsResult = await loadMobileStopTargets().catch(() => null);
      const targets = Array.isArray(targetsResult?.targets) ? targetsResult.targets : [];
      const match = targets.find((target) =>
        target?.abortable !== false &&
        ((runtimeId && String(target?.id || '').trim() === runtimeId) || String(target?.sessionId || '').trim() === sid)
      );
      if (match?.id) {
        const fallback = await stopMobileRuntime(match.id, { source: 'mobile_stop_button_fallback' });
        if (fallback?.success) {
          if (showToast) pmToast('Stopped.', 'success');
          return { success: true, message: fallback.message || 'Runtime aborted.', localAbortRequested, result: fallback };
        }
        return { success: localAbortRequested, message: fallback?.message || fallback?.error || direct?.message || 'Abort sent.', localAbortRequested, result: fallback };
      }

      return {
        success: localAbortRequested,
        message: localAbortRequested
          ? 'Local stream stopped.'
          : (direct?.message || 'No active main chat turn found for this session.'),
        localAbortRequested,
        result: direct,
      };
    } catch (err) {
      if (!localAbortRequested) throw err;
      return { success: true, message: 'Local stream stopped.', localAbortRequested, error: err };
    }
  }

  function screenshotRootActions() {
    return [
      { action: 'screenshot-desktop', label: 'Desktop', icon: 'monitor' },
      { action: 'screenshot-browser', label: 'Browser', icon: 'globe' },
      { action: 'screenshot-som', label: 'Clickable UI Map', icon: 'spark' },
    ];
  }

  async function handleImmediateSlashCommand(text) {
    const command = normalizeBareSlashCommand(text);
    if (!command) return false;

    if (command === '/models') {
      const turn = addCommandTurn(command, { text: 'Opening model controls...' });
      try {
        const data = await loadMobileCommandModels().catch(() => null);
        const modelLine = data?.activeProvider
          ? `Current: ${data.activeProvider} / ${data.activeModel || 'unknown'}`
          : 'Opening mobile model settings.';
        updateCommandTurn(turn, {
          text: `${modelLine}\n\nUse the Models panel to switch provider/model or test the connection.`,
          actions: [{ action: 'open-models', label: 'Open Models', icon: 'brain' }],
        });
      } catch (err) {
        updateCommandTurn(turn, { text: `Could not load models: ${err.message || err}` });
      }
      window.pmOpenSettings?.('models');
      return true;
    }

    if (command === '/new') {
      _startMobileNewChat(navigate);
      return true;
    }

    if (command === '/restart') {
      addCommandTurn(command, {
        text: 'Choose a restart mode. Quick restarts the gateway immediately; Full runs the build first, then restarts.',
        actions: [
          { action: 'restart-quick', label: 'Quick Restart', icon: 'refresh' },
          { action: 'restart-full', label: 'Full Build + Restart', icon: 'gear', kind: 'danger' },
        ],
      });
      return true;
    }

    if (command === '/update') {
      addCommandTurn(command, {
        text: 'Choose an update action. Prometheus will check the signed release first; installation requires a second explicit tap and backs up user state before closing and reopening.',
        actions: [
          { action: 'update-check', label: 'Check for Updates', icon: 'refresh' },
          { action: 'update-apply', label: 'Install & Reopen', icon: 'download', kind: 'danger' },
        ],
      });
      return true;
    }

    if (command === '/screenshot') {
      addCommandTurn(command, {
        text: 'Choose what to capture. Desktop and Browser mirror the Telegram screenshot flow; Clickable UI Map overlays numbered desktop elements for coordinate-free clicking.',
        actions: screenshotRootActions(),
      });
      return true;
    }

    if (command === '/stop_now') {
      const turn = addCommandTurn(command, { text: 'Stopping the active main chat turn...' });
      try {
        const r = await requestMobileMainChatAbort(requestedSession, { showToast: false });
        updateCommandTurn(turn, { text: r?.message || (r?.success ? 'Main chat aborted.' : 'No active main chat turn found.') });
      } catch (err) {
        updateCommandTurn(turn, { text: `Stop failed: ${err.message || err}` });
      }
      return true;
    }

    if (command === '/stop') {
      const turn = addCommandTurn(command, { text: 'Checking live AI flows...' });
      try {
        const r = await loadMobileStopTargets();
        const targets = Array.isArray(r?.targets) ? r.targets : [];
        if (!targets.length) {
          updateCommandTurn(turn, { text: 'No live AI flows are running right now.' });
          return true;
        }
        updateCommandTurn(turn, {
          text: `Live AI flows (${targets.length}). Tap a flow to abort it.`,
          actions: targets.slice(0, 8).map((target) => ({
            action: 'stop-runtime',
            id: target.id,
            label: `${target.label || target.kind || 'AI flow'}${target.sessionId ? ` (${target.sessionId})` : ''}`.slice(0, 80),
            icon: 'Stop',
            kind: 'danger',
          })),
        });
      } catch (err) {
        updateCommandTurn(turn, { text: `Could not load live flows: ${err.message || err}` });
      }
      return true;
    }

    return false;
  }

  function _normalizeBrowseState(cwdRel, entries, previous = {}) {
    const dirs = entries
      .filter(e => e.type === 'dir')
      .map(e => ({
        name: e.name,
        path: e.path,
        itemCount: Number.isFinite(Number(e.itemCount)) ? Number(e.itemCount) : undefined,
        mtime: e.mtime || 0,
        modifiedAt: e.modifiedAt || '',
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const files = entries
      .filter(e => e.type === 'file')
      .map(e => ({
        name: e.name,
        path: e.path,
        kind: _mobileMediaKind({ path: e.path, name: e.name }),
        size: e.size || 0,
        mtime: e.mtime || 0,
        modifiedAt: e.modifiedAt || '',
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    return {
      loading: false,
      cwd: cwdRel,
      dirs,
      files,
      error: null,
      query: previous.query || '',
      view: previous.view === 'grid' ? 'grid' : 'list',
      showAllFolders: previous.showAllFolders === true,
      showAllFiles: previous.showAllFiles === true,
    };
  }

  async function _prefetchBrowseRoot() {
    const key = '';
    const cached = pmMobileBrowseCache.get(key);
    if (cached && Date.now() - cached.loadedAt < PM_MOBILE_BROWSE_CACHE_TTL_MS) return;
    try {
      const data = await loadMobileWorkspaceFiles('');
      const entries = Array.isArray(data?.files) ? data.files : [];
      pmMobileBrowseCache.set(key, { loadedAt: Date.now(), entries });
    } catch {}
  }

  async function _browseTo(turn, cwdRel) {
    const cwd = String(cwdRel || '').trim();
    const previous = turn.body.browseState || {};
    const cached = pmMobileBrowseCache.get(cwd);
    if (cached && Date.now() - cached.loadedAt < PM_MOBILE_BROWSE_CACHE_TTL_MS) {
      turn.body.browseState = _normalizeBrowseState(cwd, cached.entries, previous);
    } else {
      turn.body.browseState = {
        loading: true,
        cwd,
        dirs: [],
        files: [],
        error: null,
        query: previous.query || '',
        view: previous.view === 'grid' ? 'grid' : 'list',
        showAllFolders: previous.showAllFolders === true,
        showAllFiles: previous.showAllFiles === true,
      };
    }
    turn.body.text = '';
    renderThreadNow();
    try {
      const data = await loadMobileWorkspaceFiles(cwd);
      const entries = Array.isArray(data?.files) ? data.files : [];
      pmMobileBrowseCache.set(cwd, { loadedAt: Date.now(), entries });
      turn.body.browseState = _normalizeBrowseState(cwd, entries, turn.body.browseState || previous);
    } catch (err) {
      turn.body.browseState = {
        loading: false,
        cwd,
        dirs: [],
        files: [],
        error: err.message || String(err),
        query: previous.query || '',
        view: previous.view === 'grid' ? 'grid' : 'list',
      };
    }
    renderThreadNow();
  }

  async function handleBrowseCommand(initialPath = '') {
    const turn = addCommandTurn('/browse', { text: '' });
    await _browseTo(turn, initialPath.trim());
    return true;
  }

  async function runCommandAction(action, id, button) {
    const activeThread = _activeMobileThread();
    const turn = activeThread[activeThread.length - 1]?.role === 'ai' ? activeThread[activeThread.length - 1] : null;
    button.disabled = true;
    try {
      if (action === 'open-models') {
        window.pmOpenSettings?.('models');
        return;
      }
      if (action === 'update-check' || action === 'update-apply') {
        const applying = action === 'update-apply';
        updateCommandTurn(turn, {
          text: applying
            ? 'Checking the release and asking Prometheus to perform the safe backup, drain, install, and reopen sequence...'
            : 'Checking the latest signed Prometheus release...',
          actions: [],
        });
        const result = await requestMobileUpdate({
          action: applying ? 'apply' : 'check',
          confirm: applying,
          source: 'mobile',
        });
        const status = result?.status || {};
        const phase = String(status.phase || '').toLowerCase();
        const available = phase === 'available' || phase === 'ready';
        updateCommandTurn(turn, {
          text: applying
            ? (result?.message || 'Safe update accepted. Prometheus will back up state, install, reopen, and validate the new version.')
            : (status.message || (available ? 'A Prometheus update is available.' : 'Prometheus is up to date.')),
          actions: !applying && available
            ? [{ action: 'update-apply', label: 'Install & Reopen', icon: 'download', kind: 'danger' }]
            : [],
        });
        return;
      }
      if (action === 'restart-quick' || action === 'restart-full') {
        const rebuild = action === 'restart-full';
        updateCommandTurn(turn, {
          text: rebuild
            ? 'Starting full build + restart. The app may briefly disconnect while Prometheus comes back.'
            : 'Starting quick restart. The app may briefly disconnect while Prometheus comes back.',
          actions: [],
        });
        let restartSessionId = String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
        // A restart completion is durable, so promote the throwaway New Chat
        // draft before requesting it. This preserves the visible slash-command
        // turn while ensuring the completion cannot land in `mobile_default`.
        if (restartSessionId === MOBILE_CHAT_SESSION_ID) {
          restartSessionId = await _ensureDurableMobileVoiceSession({
            title: 'Mobile restart',
            source: 'mobile_restart_session_created',
          });
          requestedSession = restartSessionId;
        }
        const r = await restartMobileGateway({
          rebuild,
          sessionId: restartSessionId,
          origin: {
            channel: 'mobile',
            surface: 'mobile_app',
            device: 'phone',
            source: 'mobile_slash_command',
          },
        });
        updateCommandTurn(turn, { text: r?.message || (rebuild ? 'Full build + restart initiated.' : 'Quick restart initiated.'), actions: [] });
        return;
      }
      if (action.startsWith('screenshot-')) {
        const target =
          action === 'screenshot-browser' ? 'browser'
            : action === 'screenshot-browser-session' ? 'browser-session'
              : action === 'screenshot-desktop-all' ? 'desktop-all'
                : action === 'screenshot-desktop-monitor' ? 'desktop-monitor'
                  : action === 'screenshot-som' ? 'som'
                    : 'desktop';
        updateCommandTurn(turn, { text: 'Capturing screenshot...', actions: [] });
        const r = await runMobileScreenshotCommand({ sessionId: __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID, target, id });
        const hasImage = !!r?.image;
        const isBrowserCapture = target === 'browser' || target === 'browser-session';
        const isMenuResponse = Array.isArray(r?.actions) && r.actions.length > 0;
        const conciseScreenshotText = isMenuResponse
          ? (r?.result || 'Choose what to capture.')
          : hasImage
            ? (isBrowserCapture
              ? `Browser screenshot captured${r.image.width && r.image.height ? ` (${r.image.width}x${r.image.height})` : ''}.`
              : `Desktop screenshot captured${r.image.width && r.image.height ? ` (${r.image.width}x${r.image.height})` : ''}.`)
            : (r?.result || (r?.success ? 'Screenshot captured.' : 'Screenshot failed.'));
        updateCommandTurn(turn, {
          text: conciseScreenshotText,
          image: r?.image || null,
          actions: isMenuResponse
            ? r.actions
            : screenshotRootActions(),
        });
        return;
      }
      if (action === 'stop-runtime' && id) {
        const r = await stopMobileRuntime(id, { source: 'mobile_stop_menu' });
        updateCommandTurn(turn, { text: r?.message || (r?.success ? 'Runtime aborted.' : 'Abort failed.'), actions: [] });
      }
    } catch (err) {
      if (String(action || '').startsWith('restart-')) {
        updateCommandTurn(turn, { text: 'Restart was requested. Prometheus may be reconnecting now.', actions: [] });
        return;
      }
      updateCommandTurn(turn, { text: `${action} failed: ${err.message || err}`, actions: [] });
    }
  }

  async function sendMessage(text, options = {}) {
    const busySessionId = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
    const msg = String(text || '').trim();
    const stagedVoiceImages = (
      !Array.isArray(options.attachments)
      && Array.isArray(__pmRealtimeAgent?.pendingImages)
      && __pmRealtimeAgent.pendingImages.length
    )
      ? __pmRealtimeAgent.pendingImages.map((img, index) => ({
          kind: 'image',
          name: String(img?.name || `Voice snapshot ${index + 1}`).trim(),
          mimeType: String(img?.mimeType || 'image/jpeg').trim(),
          dataUrl: String(img?.dataUrl || '').trim(),
          base64: String(img?.base64 || String(img?.dataUrl || '').replace(/^data:[^;]+;base64,/, '')).trim(),
          sizeLabel: '',
        })).filter((img) => img.dataUrl && img.base64)
      : [];
    const files = Array.isArray(options.attachments)
      ? options.attachments.slice()
      : getPendingAttachments().slice().concat(stagedVoiceImages);
    if (!msg && files.length === 0) return;
    // Claim this physical send before any gateway/recovery await. Previously
    // rapid taps could all pass the guard while the first probe was pending,
    // admitting duplicate turns before busy state or the user bubble existed.
    // Exclude the session id: the first send promotes `mobile_default` to a
    // durable id while a delayed iOS click from the same physical tap can
    // still be pending. A session-qualified key lets that duplicate through.
    const sendAttemptKey = `${msg}|${files.map((file) => `${String(file?.name || '').trim().toLowerCase()}:${String(file?.size || file?.bytes || '').trim()}`).join(',')}`;
    const previousSendAttempt = __pmChat.lastMobileSendAttempt;
    if (previousSendAttempt?.key === sendAttemptKey && Date.now() - Number(previousSendAttempt.at || 0) < 8000) return;
    __pmChat.lastMobileSendAttempt = { key: sendAttemptKey, at: Date.now() };
    let selectedGateway = currentChatGateway();
    if (!selectedGateway) {
      pmToast(
        requestedSession === MOBILE_CHAT_SESSION_ID
          ? 'No paired gateway target. Pair a gateway before starting a new chat.'
          : 'This chat’s gateway is unavailable. Reconnect it to continue this chat.',
        'error',
      );
      return;
    }
    // The catalog dot is only a cache. Verify the selected target immediately
    // before admitting a turn so a gateway that went offline cannot receive a
    // message through a stale composer state. Probe failures update the
    // target status and remain fail-closed below.
    try {
      selectedGateway = await probeGateway(selectedGateway);
    } catch {
      selectedGateway = getGateway(selectedGateway.gatewayId) || selectedGateway;
    }
    if (selectedGateway.status !== MOBILE_GATEWAY_STATUS.ONLINE) {
      pmToast(`${selectedGateway.name} is ${selectedGateway.status}. Sending is blocked until it reconnects or is repaired.`, 'error');
      return;
    }
    const fromQueue = options.fromQueue === true;
    const excludedSkillIds = fromQueue && Array.isArray(options.excludedSkillIds)
      ? options.excludedSkillIds.map((id) => String(id || '').trim()).filter(Boolean)
      : _pmGetExcludedSkillIds();
    const selectedSkillIds = mergeSlashCommandSkillIds(msg, fromQueue
      ? _pmNormalizeSelectedSkillIds(options.selectedSkillIds || options.forcedSkillIds || options.matchedSkillIds)
      : _pmNormalizeSelectedSkillIds(options.selectedSkillIds || options.forcedSkillIds || options.matchedSkillIds || pmSelectedComposerSkillIds));
    const selectedSkillRefs = fromQueue
      ? _pmNormalizeSelectedComposerSkillRefs(options.selectedSkillRefs || options.selectedSkills)
      : _pmNormalizeSelectedComposerSkillRefs(options.selectedSkillRefs || options.selectedSkills || pmSelectedComposerSkills);
    const rememberedBusyRun = _readMobileActiveRun(busySessionId);
    let locallyBusy = !fromQueue && (
      __pmChat.activeRuns?.[busySessionId]?.busy
      || __pmChat.activeRuns?.[requestedSession]?.busy
      || !!rememberedBusyRun
    );
    if (locallyBusy) {
      // Local cache is only a hint.  Before queueing behind it, reconcile with
      // the runtime owner so an interrupted/restarted turn cannot strand the
      // composer behind a ghost "Worked for 0s" placeholder.
      const reconciliation = await reconcileMobileChatTurn(busySessionId).catch(() => null);
      if (reconciliation?.success && reconciliation.active !== true) {
        _clearMobileLiveRunForSession(busySessionId);
        _clearMobileActiveRun(busySessionId);
        _markMobileSessionRunning(busySessionId, false);
        setBusy(false, busySessionId);
        locallyBusy = false;
        if (reconciliation.recovered) pmToast('Recovered an interrupted chat turn. Sending your message.', 'info');
      } else if (reconciliation?.active === true) {
        _adoptMobileActiveRunState(busySessionId, {
          run: reconciliation.run || null,
          stream: reconciliation.stream || null,
          fallback: rememberedBusyRun,
        });
        scheduleMobileRunRecovery(0, { force: true, fullRefresh: false });
      }
    }
    if (locallyBusy) {
      const queue = _getMobileQueuedPrompts(busySessionId);
      if (queue.length >= PM_MOBILE_MAX_QUEUED_PROMPTS) {
        pmToast(`Queue full (${PM_MOBILE_MAX_QUEUED_PROMPTS}). Wait for Prometheus to finish.`, 'warn');
        return;
      }
      queue.push(_makeMobileQueuedPrompt(msg || 'Attached file(s)', files, { excludedSkillIds, selectedSkillIds, selectedSkillRefs }));
      if (!Array.isArray(options.attachments)) {
        __pmChat.attachments[busySessionId] = [];
        renderPendingAttachments();
      }
      resetComposerInput();
      _pmClearActiveSlashCommand(page, input, { focus: false });
      _renderMobileQueuedPromptsPanel(busySessionId);
      pmToast(`Queued prompt #${queue.length}. It will run automatically next.`, 'success');
      return;
    }

    const liveActiveSessionId = String(__pmChat.activeSessionId || '').trim();
    const isUnsavedDraftSession = requestedSession === MOBILE_CHAT_SESSION_ID || liveActiveSessionId === MOBILE_CHAT_SESSION_ID;
    let actualSessionId = isUnsavedDraftSession ? createMobileChatSessionId() : requestedSession;
    let projectSessionCreated = false;
    if (isUnsavedDraftSession && targetProjectId) {
      try {
        const projectSession = await createMobileProjectChatSession(targetProjectId, { title: 'New Chat' });
        actualSessionId = String(projectSession?.sessionId || projectSession?.session?.id || '').trim();
        if (!actualSessionId) throw new Error('Project did not return a chat session.');
        projectSessionCreated = true;
      } catch (error) {
        pmToast(`Could not open that project: ${String(error?.message || error)}`, 'error');
        return;
      }
    }
    if (selectedGateway?.gatewayId && actualSessionId !== MOBILE_CHAT_SESSION_ID) {
      bindMobileSessionTarget(actualSessionId, selectedGateway.gatewayId, {
        started: true,
        project: targetProjectLabel,
        workspace: targetWorkspaceLabel,
      });
      setMobileActiveGatewayTarget(selectedGateway);
      // Persist the target selected for the admitted turn as well as the
      // immutable session binding. This repairs older bare session routes if
      // they are reopened before the next drawer refresh has namespaced them.
      _saveMobileLastChatContext({
        gatewayId: selectedGateway.gatewayId,
        gatewayName: selectedGateway.name,
        projectId: targetProjectId,
        projectName: targetProjectLabel,
      });
    }
    if (isUnsavedDraftSession) {
      __pmChat.threads[actualSessionId] = [];
      __pmChat.attachments[actualSessionId] = files.slice();
      __pmChat.activeSessionId = actualSessionId;
      _rememberMobileLastChatSession(actualSessionId);
      __pmChat.threads[requestedSession] = [];
      __pmChat.attachments[requestedSession] = [];
      const routedActualSessionId = targetNamespacedId(selectedGateway?.gatewayId, actualSessionId) || actualSessionId;
      try { window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(routedActualSessionId)}`); } catch {}
      requestedSession = actualSessionId;
      __pmVoice.targetSessionId = actualSessionId;
      __pmVoice.targetSessionLabel = _currentChatVoiceSessionLabel();
      __pmVoice.targetSessionChannel = 'mobile';
      __pmVoice.targetSessionForced = true;
      if (__pmVoice.activeVoiceRuntime) __pmVoice.activeVoiceRuntime.isStreamActive = false;
      __pmVoice.activeVoiceRuntime = null;
      dismissNewChatContextDock();
      invalidateMobileDrawerSessions('mobile');
      try {
        if (!projectSessionCreated) await createMobileChatSession(actualSessionId, { title: 'New Chat' });
        await applyMobileDraftModelRouteToSession(actualSessionId);
      } catch (err) {
        pmToast(`Could not start chat with the selected model: ${String(err?.message || err)}`, 'error');
        return;
      }
    }
    const activeThread = __pmChat.threads[actualSessionId] || (__pmChat.threads[actualSessionId] = []);
    __pmChat.thread = activeThread;
    const clientRequestId = _newMobileClientRequestId(actualSessionId);
    const activeTurnStartedAt = Date.now();
    if (!__pmChat.sentClientRequestIds || typeof __pmChat.sentClientRequestIds !== 'object') __pmChat.sentClientRequestIds = {};
    __pmChat.sentClientRequestIds[actualSessionId] = clientRequestId;
    setBusy(true, actualSessionId);
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    __pmChat.activeRuns[actualSessionId] = {
      ...(__pmChat.activeRuns[actualSessionId] || {}),
      busy: true,
      startedAt: activeTurnStartedAt,
      lastSeq: 0,
      streamId: '',
      runtimeId: '',
      clientRequestId,
    };
    _markMobileSessionRunning(actualSessionId, true);
    _rememberMobileActiveRun(actualSessionId, { startedAt: activeTurnStartedAt, disconnected: false, lastSeq: 0, streamId: '', runtimeId: '', clientRequestId });
    window.__pmMobileContextTurnStart?.({ sessionId: actualSessionId });

    let optimisticUserTurn = null;
    // Commit and paint the user row before camera summarization, attachment
    // upload, or any other optional preflight. Those awaits can take seconds
    // on a phone; the submitted text must remain visible throughout them.
    if (options.skipUserBubble !== true) {
      optimisticUserTurn = _makeMobileUserMessage(msg || 'Attached file(s)', files, { selectedSkillRefs });
      optimisticUserTurn._clientRequestId = clientRequestId;
      optimisticUserTurn._pmOptimistic = true;
      optimisticUserTurn.uploadState = files.length ? 'uploading' : 'ready';
      activeThread.push(optimisticUserTurn);
    }
    _reindexMobileThread(activeThread);
    renderThreadNow();

    // Background-agent activity is a turn surface, not session history. Hide
    // any lanes from the prior turn before the next user turn begins; clearing
    // their ids also prevents delayed events from resurrecting an old dock.
    _clearMobileBackgroundSpawnDockForSession(actualSessionId);
    let stagedVoiceImageSummary = '';
    const realtimeProviderForSend = String(__pmRealtimeAgent?.conn?.provider || '').trim();
    if (stagedVoiceImages.length && realtimeProviderForSend === 'xai') {
      stagedVoiceImageSummary = await _summarizeMobileXaiVisionImages(
        stagedVoiceImages.map((img) => img.dataUrl),
        {
          name: stagedVoiceImages.length > 1 ? 'camera images' : (stagedVoiceImages[0]?.name || 'camera photo'),
          reason: 'typed_chat_send',
          toast: true,
        },
      );
    }
    if (stagedVoiceImages.length) {
      await _flushMobileRealtimeAgentPendingImages('typed_chat_send', {
        promptText: msg,
        createResponse: __pmVoice?.settings?.voiceMode === 'openai_realtime',
        precomputedSummary: stagedVoiceImageSummary,
      });
    }

    if (!Array.isArray(options.attachments)) {
      __pmChat.attachments[actualSessionId] = [];
      renderPendingAttachments();
    }
    // Push streaming AI placeholder before attachment upload so the thread shows
    // an active turn even while workspace upload retries are still running.
    const optimisticUserTimestamp = Number(optimisticUserTurn?.timestamp || 0) || activeTurnStartedAt;
    const aiTurn = {
      role: 'ai', streaming: true, time: '', timestamp: Math.max(Date.now(), optimisticUserTimestamp + 1),
      workStartedAt: activeTurnStartedAt,
      body: { sender: '', text: '' },
      content: '',
      processEntries: [],
      liveTraceEntries: [],
      agentExecutionMode: 'execute',
      _pmAdmissionPending: true,
      _pmAdmissionClientRequestId: clientRequestId,
      _clientRequestId: clientRequestId,
    };
    activeThread.push(aiTurn);
    _appendMobileUserProcess(aiTurn, msg || 'Attached file(s)', {
      stage: 'mobile_chat_user_message',
      sessionId: actualSessionId,
      clientRequestId,
    });
    if (files.length) {
      _appendMobileProcess(aiTurn, 'info', `Uploading ${files.length} attachment${files.length === 1 ? '' : 's'}...`);
    }
    renderThreadNow();

    const uploadResults = files.length ? await _uploadMobileChatAttachments(files) : [];
    const failedUploads = uploadResults.filter((r) => r.error);
    const visionFallbackUploads = failedUploads.filter((r) => r.isImage && r.base64);
    const hardFailedUploads = failedUploads.filter((r) => !(r.isImage && r.base64));
    if (hardFailedUploads.length) {
      pmToast(`${hardFailedUploads.length} attachment upload failed`, 'error');
    } else if (visionFallbackUploads.length) {
      pmToast(`${visionFallbackUploads.length} image${visionFallbackUploads.length === 1 ? '' : 's'} sent for vision; workspace save failed.`, 'warn');
    }
    if (optimisticUserTurn) {
      optimisticUserTurn.body = optimisticUserTurn.body || { text: msg || 'Attached file(s)', attachments: [] };
      optimisticUserTurn.body.attachments = files;
      optimisticUserTurn.attachmentPreviews = files.map(_sanitizeMobileAttachmentPreviewForServer);
      optimisticUserTurn.uploadState = failedUploads.length
        ? (failedUploads.length === uploadResults.length ? 'upload_failed' : 'upload_partial')
        : (files.length ? 'uploaded' : 'ready');
    }
    if (files.length) {
      if (failedUploads.length) {
        const imageFallbacks = visionFallbackUploads.length;
        const msgText = imageFallbacks
          ? `${failedUploads.length} workspace upload${failedUploads.length === 1 ? '' : 's'} failed; image bytes are still attached for vision.`
          : `${failedUploads.length} attachment upload${failedUploads.length === 1 ? '' : 's'} failed.`;
        _appendMobileProcess(aiTurn, 'warn', msgText);
      } else {
        _appendMobileProcess(aiTurn, 'result', `Uploaded ${files.length} attachment${files.length === 1 ? '' : 's'}.`);
      }
      renderThreadNow();
    }
    const visionAttachments = files
      .filter(f => f.kind === 'image' && f.base64 && f.mimeType)
      .map(f => ({ type: 'image', base64: f.base64, mimeType: f.mimeType, name: f.name }));
    const apiMessageText = stagedVoiceImageSummary
      ? [
          msg || 'Please review the attached image.',
          '',
          '[REALTIME VOICE VISUAL CONTEXT]',
          'The image attached to this turn was summarized for the xAI realtime voice lane before this worker request:',
          stagedVoiceImageSummary,
          'Use this visual context directly. Do not say the image has not arrived unless there are no image attachments or visual summary.',
          '[/REALTIME VOICE VISUAL CONTEXT]',
        ].join('\n')
      : msg;
    const messageForApi = buildMessageWithAttachments(apiMessageText, files, uploadResults);

    let stoppedByUser = false;
    let turnFinished = false;
    let recoveringExistingServerTurn = false;

    const finishAiTurn = () => {
      if (turnFinished) return;
      turnFinished = true;
      const targetAiTurn = _mobileStreamTargetTurn(aiTurn);
      _finishMobileVisualStreamText(targetAiTurn);
      if (stoppedByUser) {
        _appendMobileProcess(targetAiTurn, 'warn', 'Generation stopped by user. Runtime abort sent; process log preserved.');
        const streamed = String(targetAiTurn.body.text || '').trim();
        targetAiTurn.body.text = streamed
          ? `[Stopped by user]\n\n${streamed}`
          : '[Generation stopped by user. Runtime abort sent and process log preserved.]';
        targetAiTurn._pmAbortRequested = false;
        targetAiTurn._pmAbortAcknowledged = true;
      }
      targetAiTurn.streaming = false;
      targetAiTurn.workEndedAt = Number(targetAiTurn.workEndedAt || Date.now()) || Date.now();
      targetAiTurn.workDurationMs = Math.max(0, targetAiTurn.workEndedAt - _mobileAssistantWorkStartedAt(targetAiTurn));
      targetAiTurn.time = _nowTime();
      targetAiTurn.timestamp = Number(targetAiTurn.timestamp || Date.now()) || Date.now();
      targetAiTurn.content = String(targetAiTurn.body?.text || '');
      _mergeMobileLiveTraceIntoProcess(targetAiTurn);
      const mergedFileChanges = _mergeMobileFileChangesWithBackground(targetAiTurn.fileChanges || null, actualSessionId);
      if (mergedFileChanges) targetAiTurn.fileChanges = mergedFileChanges;
      if (Number.isFinite(Number(options.reuseExistingUserIndex)) && !stoppedByUser) {
        const userIndex = Number(options.reuseExistingUserIndex);
        const userMsg = _activeMobileThread()[userIndex];
        if (userMsg && Array.isArray(userMsg._promptVariants) && userMsg._promptVariants.length) {
          _saveActiveMobilePromptVariant(userIndex);
        }
      }
      if (__pmChat.activeRuns?.[actualSessionId]) __pmChat.activeRuns[actualSessionId].abort = null;
      __pmChat.abort = null;
      if (!stoppedByUser) _clearMobileActiveRun(actualSessionId);
      _markMobileSessionRunning(actualSessionId, false);
      if (!stoppedByUser && _isMobileChatSessionVisibleToUser(actualSessionId)) {
        markMobileChatSessionRead(actualSessionId, Date.now()).catch(() => {});
      }
      if (__pmChat.sentClientRequestIds?.[actualSessionId] === clientRequestId) delete __pmChat.sentClientRequestIds[actualSessionId];
      _rememberMobileCompletedAssistantTurn(actualSessionId, targetAiTurn);
      const timerKey = String(actualSessionId || 'chat');
      mobileStreamRenderScheduler.cancel(`mobile:thread:${timerKey}`);
      mobileStreamRenderScheduler.cancel(`mobile:patch:${timerKey}`);
      const scrollSnapshot = _mobileChatScrollSnapshot(body);
      const committedFinalTurn = mobileChatRuntimeAdapter.replaceTranscriptRow(actualSessionId, targetAiTurn, {
        source: 'mobile-send-final',
      });
      const committedSource = committedFinalTurn?.source || targetAiTurn;
      // A goal command acknowledgement is filtered from the mobile timeline.
      // Do not incrementally patch it back into the already-painted thread;
      // use the filtered render so the acknowledgement disappears immediately
      // just as it does after reconnect/history hydration.
      if (_isMobileHiddenTranscriptMessage(committedSource)) {
        renderThreadNow();
      } else {
        const patchedFinal = _patchMobileThreadMessage(
          threadEl,
          committedSource,
          activeThread.indexOf(targetAiTurn),
        );
        if (patchedFinal) {
          _syncMobileWorkTimer(threadEl, body, actualSessionId);
          _restoreMobileChatScroll(body, scrollSnapshot);
        } else {
          renderThreadNow();
        }
      }
      const finalThread = Array.isArray(__pmChat.threads[actualSessionId]) ? __pmChat.threads[actualSessionId] : activeThread;
      _saveMobileThreadCache(actualSessionId, finalThread);
      // A 409 means this local attempt was never admitted. Do not overwrite
      // the durable history of the real active turn with its local error card.
      if (!targetAiTurn._pmSkipHistoryPersist) {
        updateMobileChatSessionHistory(actualSessionId, _mobileHistoryForServer(finalThread)).catch((err) => {
          console.warn('[mobile chat] failed to persist completed turn:', err);
        });
      }
      window.__pmMobileContextTurnDone?.({ sessionId: actualSessionId });
      setBusy(false, actualSessionId);
    };

    const runNextQueuedMobilePrompt = () => {
      const queue = _getMobileQueuedPrompts(actualSessionId);
      if (!queue.length) return;
      const next = queue.shift();
      _renderMobileQueuedPromptsPanel(actualSessionId);
      pmToast(queue.length ? `Running queued prompt (${queue.length} remaining).` : 'Running queued prompt.', 'info');
      setTimeout(() => {
        sendMessage(next.message, { fromQueue: true, attachments: Array.isArray(next.files) ? next.files : [], excludedSkillIds: Array.isArray(next.excludedSkillIds) ? next.excludedSkillIds : [], selectedSkillIds: Array.isArray(next.selectedSkillIds) ? next.selectedSkillIds : [], selectedSkillRefs: Array.isArray(next.selectedSkillRefs) ? next.selectedSkillRefs : [] });
      }, 0);
    };

    const requeueRejectedAdmission = () => {
      const queue = _getMobileQueuedPrompts(actualSessionId);
      const queueKey = String(clientRequestId || '').trim();
      if (!queue.some((item) => String(item?._pmRecoveryQueueKey || '') === queueKey)) {
        const queued = _makeMobileQueuedPrompt(msg || 'Attached file(s)', files, { excludedSkillIds, selectedSkillIds, selectedSkillRefs });
        queued._pmRecoveryQueueKey = queueKey;
        queue.unshift(queued);
      }
      const removeTurn = (turn) => {
        const index = activeThread.indexOf(turn);
        if (index >= 0) activeThread.splice(index, 1);
      };
      // This POST was never admitted. Remove its speculative bubbles so the
      // real server-owned stream has exactly one visible assistant turn.
      const canonicalStreamAdopted = aiTurn && aiTurn._pmAdmissionPending !== true;
      if (!canonicalStreamAdopted) removeTurn(optimisticUserTurn);
      // Another tab can deliver the canonical stream before this tab receives
      // the HTTP 409. If that stream adopted the speculative assistant turn,
      // leave it in place; deleting it here would erase the real live trace.
      const stillSpeculative = aiTurn
        && aiTurn._pmAdmissionPending === true
        && String(aiTurn._pmAdmissionClientRequestId || aiTurn._clientRequestId || '').trim() === clientRequestId;
      if (stillSpeculative) removeTurn(aiTurn);
      _reindexMobileThread(activeThread);
      if (__pmChat.sentClientRequestIds?.[actualSessionId] === clientRequestId) {
        delete __pmChat.sentClientRequestIds[actualSessionId];
      }
      const run = __pmChat.activeRuns?.[actualSessionId];
      if (run && String(run.clientRequestId || '').trim() === clientRequestId) {
        __pmChat.activeRuns[actualSessionId] = { ...run, busy: true, abort: null, clientRequestId: '' };
      }
      _renderMobileQueuedPromptsPanel(actualSessionId);
      renderThreadNow();
    };

    const stream = streamChat({
      message: messageForApi,
      sessionId: actualSessionId,
      attachments: visionAttachments,
      attachmentPreviews: files.map(_sanitizeMobileAttachmentPreviewForServer),
      clientRequestId,
      excludedSkillIds: excludedSkillIds.length ? excludedSkillIds : undefined,
      selectedSkillIds: selectedSkillIds.length ? selectedSkillIds : undefined,
    }, {
      onEvent: (evt) => {
        hideReconnectingStatus();
        window.__pmMobileContextStreamEvent?.(evt, { sessionId: actualSessionId });
        const applied = applyMobileChatStreamEvent(aiTurn, evt);
        if (applied === 'done' || applied === 'error') finishAiTurn();
      },
      onError: (err) => {
        if (stoppedByUser || err?.name === 'AbortError') return;
        const targetAiTurn = _mobileStreamTargetTurn(aiTurn);
        const message = err?.message || 'Chat error';
        _finishMobileVisualStreamText(targetAiTurn);
        // Safari/WebView can reject the SSE reader while closing it after a
        // valid final frame. The final answer wins over this stale transport
        // callback; do not replace it with a recovery placeholder.
        if (targetAiTurn?._pmFinalReceived && _mobileAssistantHasVisibleAnswer(targetAiTurn)) {
          hideReconnectingStatus();
          _clearMobileActiveRun(actualSessionId);
          finishAiTurn();
          renderThreadNow();
          return;
        }
        if (err?.mobileStreamDisconnected) {
          targetAiTurn.body.text = targetAiTurn.body.text || "Connection dropped, but Prometheus may still be working. I'll keep checking and recover the result here.";
          targetAiTurn.streaming = true;
          _recordMobileChatError(targetAiTurn, err);
          _rememberMobileActiveRun(actualSessionId, { disconnected: true });
          setChatConnectionStatus(true, 'Reconnecting to Prometheus');
          pmToast(targetAiTurn.errorPresentation);
          scheduleMobileRunRecovery(2500, { force: true });
        } else {
          const sourcePresentation = err?.chatPresentation || presentChatError(err);
          if (sourcePresentation?.key === 'session-turn-active') {
            recoveringExistingServerTurn = true;
            const presentation = {
              ...sourcePresentation,
              severity: 'info',
              title: 'Active request found',
              summary: 'Prometheus is already working in this chat. Your message was queued behind it while its live tool stream reconnects.',
            };
            requeueRejectedAdmission();
            setChatConnectionStatus(true, 'Reconnecting to active request');
            pmToast(presentation);
          } else {
            const presentation = _recordMobileChatError(targetAiTurn, err);
            _coalesceMobileChatError(activeThread, targetAiTurn, presentation);
            _clearMobileActiveRun(actualSessionId);
            pmToast(presentation);
            finishAiTurn();
          }
        }
        renderThreadNow();
      },
      onDone: () => {
        if (recoveringExistingServerTurn) {
          setBusy(true, actualSessionId);
          scheduleMobileRunRecovery(0, { force: true, fullRefresh: false });
          return;
        }
        if (!stoppedByUser && aiTurn.streaming && _readMobileActiveRun(actualSessionId)?.disconnected) {
          setBusy(true, actualSessionId);
          scheduleMobileRunRecovery(2500, { force: true });
          return;
        }
        finishAiTurn();
        if (!stoppedByUser) runNextQueuedMobilePrompt();
      },
    });
    let stopSent = false;
    const abortHandle = { abort: () => {
      if (stopSent) return;
      stopSent = true;
      stoppedByUser = true;
      aiTurn._pmAbortRequested = true;
      const run = __pmChat.activeRuns?.[actualSessionId] || {};
      const runtimeId = String(run.runtimeId || aiTurn.runtimeId || _readMobileActiveRun(actualSessionId)?.runtimeId || '').trim();
      _appendMobileProcess(aiTurn, 'warn', 'Stop requested. Aborting the live runtime now.', runtimeId ? { runtimeId } : undefined);
      _clearMobileActiveRun(actualSessionId);
      _markMobileSessionRunning(actualSessionId, false);
      stopMobileMainChat(actualSessionId, { runtimeId, source: 'mobile_stop_button' }).catch((err) => {
        _appendMobileProcess(aiTurn, 'error', `Backend abort request failed: ${err?.message || err}`);
        renderThreadNow();
      });
      stream.abort();
      _finishMobileVisualStreamText(aiTurn);
      finishAiTurn();
    } };
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    __pmChat.activeRuns[actualSessionId] = {
      ...(__pmChat.activeRuns[actualSessionId] || {}),
      busy: true,
      abort: abortHandle,
      runtimeId: __pmChat.activeRuns[actualSessionId]?.runtimeId || '',
    };
    __pmChat.abort = abortHandle;
  }
  window.__pmMobileSendMessage = sendMessage;

  let lastForegroundRecoveryAt = 0;
  const runRecoveryOnReturn = () => {
    const now = Date.now();
    if (now - lastForegroundRecoveryAt < 5000) return;
    lastForegroundRecoveryAt = now;
    scheduleMobileRunRecovery(250, { force: true, fullRefresh: true });
  };
  const runRecoveryOnVisibility = () => {
    if (!document.hidden) runRecoveryOnReturn();
  };
  const runRecoveryOnWsOpen = () => runRecoveryOnReturn();
  const applyMainChatStreamPayload = (msg = {}) => {
    if (String(msg.sessionId || '') !== requestedSession) return '';
    if (__pmChat.activeSessionId !== requestedSession) return '';
    hideReconnectingStatus();
    const activeThread = _activeMobileThread();
    const data = msg.data && typeof msg.data === 'object' ? msg.data : msg;
    const activeRunKind = String(msg.activeRunKind || data?.activeRunKind || data?.runKind || '').trim();
    const isInternalWatchRun = String(data?.source || data?.run?.source || '').trim().toLowerCase() === 'internal_watch';
    const incomingClientRequestId = String(data?.clientRequestId || '').trim();
    const eventType = String(msg.event || data?.event || data?.type || '');
    const evt = {
      ...data,
      type: eventType,
      seq: msg.seq || data?.seq,
      streamId: msg.streamId || data?.streamId,
      at: msg.at || data?.at,
    };
    if (eventType === 'user_message') {
      const ownClientRequestId = String(__pmChat.sentClientRequestIds?.[requestedSession] || '').trim();
      if (incomingClientRequestId && incomingClientRequestId === ownClientRequestId) return 'own-user';
      const payload = data?.message && typeof data.message === 'object' ? data.message : {};
      const text = _stripMobileInternalUploadContext(payload.content || payload.text || payload.body?.text || '');
      const channelLabel = String(payload.channelLabel || payload.channel || payload.source || payload.body?.source || '').toLowerCase();
      const isInternalWatchUserMessage = channelLabel === 'internal_watch' || /^\[Internal watch\b/i.test(text);
      const attachments = Array.isArray(payload.attachmentPreviews)
        ? payload.attachmentPreviews
        : (Array.isArray(payload.body?.attachments) ? payload.body.attachments : []);
      const ts = Number(payload.timestamp || msg.at || data?.at || Date.now()) || Date.now();
      const incomingUserTurn = {
        role: 'user',
        timestamp: ts,
        body: { text, attachments },
        content: text,
        attachmentPreviews: attachments,
        _clientRequestId: incomingClientRequestId,
      };
      const existingRequestUser = incomingClientRequestId
        ? [...activeThread].reverse().find((turn) => turn?.role === 'user'
          && String(turn._clientRequestId || '').trim() === incomingClientRequestId)
        : null;
      if (existingRequestUser) {
        _mergeMobileUserTurnDetails(existingRequestUser, incomingUserTurn);
        _reindexMobileThread(activeThread);
        renderThreadNow();
        _markMobileSessionRunning(requestedSession, true);
        setBusy(true);
        return 'streaming';
      }
      const existingWorkerHandoff = _findMobileVoiceWorkerHandoffByText(activeThread, text, ts);
      if (existingWorkerHandoff) {
        existingWorkerHandoff._clientRequestId = incomingClientRequestId || existingWorkerHandoff._clientRequestId;
        if (attachments.length && !Array.isArray(existingWorkerHandoff.attachmentPreviews)) {
          existingWorkerHandoff.attachmentPreviews = attachments;
        }
        _markMobileSessionRunning(requestedSession, true);
        setBusy(true);
        return 'streaming';
      }
      const previousUser = [...activeThread].reverse().find((turn) => turn?.role === 'user');
      const previousText = _stripMobileInternalUploadContext(previousUser?.body?.text || previousUser?.content || '');
      const previousTs = Number(previousUser?.timestamp || 0);
      const isDuplicate = previousUser
        && (_mobileUserTurnsRepresentSameSend(previousUser, incomingUserTurn)
          || (previousText === text && Math.abs(previousTs - ts) < 10000));
      if (!isInternalWatchUserMessage && !isDuplicate && (text || attachments.length)) {
        activeThread.push({
          ...incomingUserTurn,
          time: _nowTime(),
        });
        _dedupeMobileUserTurns(activeThread);
        _reindexMobileThread(activeThread);
        renderThreadNow();
      }
      _markMobileSessionRunning(requestedSession, true);
      setBusy(true);
      return 'streaming';
    }
    if (receipts.has(requestedSession, evt)) return 'duplicate';
    if (eventType === 'error' && _isMobileRuntimeAbortEvent({ ...data, ...msg, type: eventType })) {
      const expectedAbortTurn = _findMobileExpectedAbortTurn(activeThread, { ...data, ...msg });
      if (expectedAbortTurn) {
        if (!noteChatStreamSeq(evt)) return 'duplicate';
        _ackMobileAbort(expectedAbortTurn);
        _clearMobileToolProgress(requestedSession);
        _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        _clearMobileActiveRun(requestedSession);
        _markMobileSessionRunning(requestedSession, false);
        setBusy(false, requestedSession);
        renderThreadNow();
        return 'aborted';
      }
    }
    if (_findMobileCompletedTurn(activeThread, evt, requestedSession)) return 'duplicate';
    _markMobileSessionRunning(requestedSession, true);
    let aiTurn = _findMobileRecoverableAssistantTurn(activeThread, incomingClientRequestId);
    const foundRequestOwnedTurn = !!aiTurn;
    if (!aiTurn) {
      const latestAssistant = _findLatestAssistantTurn(activeThread);
      const latestClientRequestId = String(latestAssistant?._clientRequestId || '').trim();
      const canAdoptLatest = latestAssistant?.streaming === true
        && (!latestClientRequestId
          || !incomingClientRequestId
          || latestClientRequestId === incomingClientRequestId
          || latestAssistant._pmAdmissionPending === true
          || latestAssistant._pmRejectedAdmission === true);
      if (canAdoptLatest) {
        aiTurn = latestAssistant;
        if (incomingClientRequestId && latestClientRequestId !== incomingClientRequestId) {
          aiTurn._clientRequestId = incomingClientRequestId;
          aiTurn._pmAdmissionPending = false;
        }
      }
    }
    // A persisted steer continuation intentionally loses ephemeral `streaming`
    // state in server history. If request identity found it, revive that exact
    // bubble; only allocate a new assistant when there is no owned live turn.
    if (!aiTurn || (!aiTurn.streaming && !foundRequestOwnedTurn)) {
      const rememberedRun = _readMobileActiveRun(requestedSession);
      const recoveredStartedAt = Number(rememberedRun?.startedAt || data?.run?.startedAt || data?.startedAt || msg.startedAt || msg.at || data?.at || 0);
      const startedAt = Number.isFinite(recoveredStartedAt) && recoveredStartedAt > 0 ? recoveredStartedAt : Date.now();
      const handoffIndex = incomingClientRequestId
        ? activeThread.findIndex((turn) => turn?.role === 'user'
          && String(turn._clientRequestId || '').trim() === incomingClientRequestId)
        : -1;
      const isVoiceForegroundWorker = handoffIndex >= 0
        && _isMobileVoiceAgentWorkerHandoff(activeThread[handoffIndex]);
      aiTurn = {
        role: 'ai',
        streaming: true,
        time: '',
        timestamp: startedAt,
        workStartedAt: startedAt,
        body: { sender: '', text: '' },
        content: '',
        processEntries: [],
        liveTraceEntries: [],
        agentExecutionMode: 'execute',
        activeRunKind,
        agentRuntimeKind: activeRunKind,
        messageKind: isVoiceForegroundWorker
          ? 'voice_foreground_worker'
          : (isInternalWatchRun ? 'internal_watch_review' : undefined),
        _clientRequestId: incomingClientRequestId,
      };
      if (handoffIndex >= 0) activeThread.splice(handoffIndex + 1, 0, aiTurn);
      else activeThread.push(aiTurn);
    }
    _adoptMobileActiveRunState(requestedSession, {
      run: {
        id: data?.runtimeId || data?.run?.id || data?.activeRun?.id,
        clientRequestId: incomingClientRequestId,
        startedAt: data?.run?.startedAt || data?.startedAt || msg.startedAt || msg.at,
      },
      stream: { streamId: msg.streamId || data?.streamId || '' },
      fallback: _readMobileActiveRun(requestedSession),
    });
    _clearRecoveredMobileChatError(aiTurn);
    aiTurn.streaming = true;
    if (activeRunKind) {
      aiTurn.activeRunKind = activeRunKind;
      aiTurn.agentRuntimeKind = activeRunKind;
      if (activeRunKind === 'main_chat_goal') aiTurn.messageKind = 'goal_turn';
    }
    if (isInternalWatchRun) aiTurn.messageKind = 'internal_watch_review';
    const applied = applyMobileChatStreamEvent(aiTurn, evt);
    if (applied === 'aborted') {
      _clearMobileActiveRun(requestedSession);
      _markMobileSessionRunning(requestedSession, false);
      setBusy(false, requestedSession);
      renderThreadNow();
    } else if (applied === 'done' || applied === 'error') {
      finalizeMobileLiveAiTurn(aiTurn);
      _clearMobileActiveRun(requestedSession);
      _markMobileSessionRunning(requestedSession, false);
      setBusy(false, requestedSession);
    } else if (applied && applied !== 'duplicate') setBusy(true);
    return applied;
  };
  const onMainChatStreamEvent = (msg = {}) => {
    applyMainChatStreamPayload(msg);
  };
  const onInternalWatchSse = (msg = {}) => {
    const event = String(msg.eventType || msg.event || '').trim();
    if (!event) return;
    // Internal-watch delivery already runs through the durable main-chat
    // stream. Applying both transports here made every tool event race its
    // replayable counterpart: the trace could briefly render, then be replaced
    // by an older stream state. Keep this event only as the immediate activity
    // signal while runtime setup is in flight; the normal stream owns all UI
    // frames from preflight through done.
    if (event === 'runtime_registered') {
      applyMainChatStreamPayload({
        sessionId: msg.sessionId,
        at: msg.at,
        event,
        activeRunKind: 'main_chat',
        data: { ...msg, type: event, event, source: 'internal_watch' },
      });
      renderThreadNow();
    }
    scheduleMobileRunRecovery(event === 'runtime_registered' ? 0 : 120, { force: true, fullRefresh: false });
  };
  const onMainChatGoalSse = (msg = {}) => {
    const sid = String(msg.sessionId || '').trim();
    if (sid !== requestedSession) return;
    const event = String(msg.event || '').trim();
    if (!event) return;
    const applied = applyMainChatStreamPayload({
      sessionId: sid,
      event,
      activeRunKind: 'main_chat_goal',
      streamId: msg.streamId,
      seq: msg.seq,
      at: msg.at,
      data: msg,
    });
    // Goal lifecycle frames can arrive before the first tool event and some
    // of them intentionally carry no transcript content. Paint the active
    // goal turn immediately so the regular tool stream has a visible owner.
    if (['runtime_registered', 'goal_turn_preparing', 'goal_turn_identity'].includes(event)
      && applied !== 'duplicate') renderThreadNow();
  };
  const onMainChatStreamUpdate = (msg = {}) => {
    if (String(msg.sessionId || '') !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    const updateStreamId = String(msg.streamId || '').trim();
    const updateLastSeq = Math.max(0, Math.floor(Number(msg.lastSeq || msg.seq || 0)) || 0);
    const remembered = _readMobileActiveRun(requestedSession);
    const currentRun = __pmChat.activeRuns?.[requestedSession] || {};
    const rememberedStreamId = String(currentRun.streamId || remembered?.streamId || '').trim();
    const rememberedLastSeq = Math.max(
      Number(currentRun.lastSeq || 0) || 0,
      Number(remembered?.lastSeq || 0) || 0,
    );
    if (updateStreamId && rememberedStreamId === updateStreamId && updateLastSeq > 0 && updateLastSeq <= rememberedLastSeq) {
      return;
    }
    scheduleMobileRunRecovery(120, { force: true, fullRefresh: false });
  };
  const onVoiceInterruptionEvent = (msg = {}) => {
    if (msg?.isInterruption === false) return;
    const sid = String(msg.sessionId || '').trim();
    if (sid !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    const activeThread = _activeMobileThread();
    const aiTurn = _findLatestAssistantTurn(activeThread);
    if (!aiTurn) return;
    const intent = String(msg.intent || 'unknown').trim() || 'unknown';
    const shouldAbort = msg.shouldAbortOriginalRun === true;
    const transcript = String(msg.transcript || msg.currentUserPrompt || msg.userInterruptionTranscript || '').trim();
    const classification = {
      ...(msg.classification || {}),
      intent,
      shouldAbortOriginalRun: shouldAbort,
    };
    const eventId = String(msg.eventId || msg.steerEventId || '').trim();
    const abortedBySplit = _applyVoiceInterruptionToMobileChat(sid, { ...msg, classification }, transcript);
    if (abortedBySplit || (eventId && activeThread.some((turn) => String(turn?.voiceInterruptionEventId || '') === eventId))) {
      setBusy(false);
      renderThreadNow();
      return;
    }
    _appendMobileProcess(aiTurn, shouldAbort ? 'warn' : 'info', `Voice interruption: ${intent}`, {
      eventId: msg.eventId || '',
      runtimeId: msg.runtimeId || '',
      intent,
      shouldAbortOriginalRun: shouldAbort,
      transcript,
    });
    if (shouldAbort && aiTurn.streaming && !__pmChat.activeRuns?.[requestedSession]?.abort) {
      const streamed = String(aiTurn.body?.text || aiTurn.content || '').trim();
      aiTurn.streaming = false;
      aiTurn.workEndedAt = Number(aiTurn.workEndedAt || Date.now()) || Date.now();
      aiTurn.workDurationMs = Math.max(0, aiTurn.workEndedAt - _mobileAssistantWorkStartedAt(aiTurn));
      aiTurn.time = _nowTime();
      aiTurn.timestamp = Number(aiTurn.timestamp || Date.now()) || Date.now();
      aiTurn.body = aiTurn.body || { sender: 'Prometheus', text: '' };
      aiTurn.body.text = streamed
        ? `[Stopped by user]\n\n${streamed}`
        : '[Stopped by user]\n\nVoice interruption stopped the active Prometheus worker. Process log preserved.';
      aiTurn.content = aiTurn.body.text;
      _clearMobileActiveRun(requestedSession);
      _markMobileSessionRunning(requestedSession, false);
      setBusy(false);
      _persistMobileThreadSnapshot(requestedSession);
    }
    renderThreadNow();
  };
  const onVoiceAgentToolEvent = (msg = {}) => {
    const sid = String(msg.sessionId || '').trim();
    if (sid !== requestedSession) return;
    if (__pmChat.activeSessionId !== requestedSession) return;
    const evt = { type: String(msg.event || ''), ...(msg.data || {}) };
    const label = _mobileToolLabel(evt);
    let entry = null;
    if (evt.type === 'tool_call') {
      const args = _safeJsonPreview(evt.args || evt.params || evt.input);
      entry = {
        type: label.toLowerCase().includes('skill') ? 'skill' : 'tool',
        text: `${label}${args ? `: ${args}` : ''}`,
        extra: evt,
      };
    } else if (evt.type === 'tool_result') {
      const result = _safeJsonPreview(evt.result || evt.output || evt.error || '', 180);
      entry = {
        type: evt.error ? 'error' : 'result',
        text: `${label}${result ? ` -> ${result}` : ' complete'}`,
        extra: evt,
      };
    } else {
      return;
    }
    if (_attachVoiceAgentProcessEntriesToMobileTurn(sid, [entry])) {
      renderThreadSoon();
    }
  };
  const onBackgroundSpawnEvent = (msg = {}) => {
    if (__pmChat.activeSessionId !== requestedSession) return;
    if (!_pushMobileBackgroundSpawnEvent(msg, requestedSession)) return;
    _renderMobileBackgroundSpawnDock(backgroundSpawnDock, requestedSession);
    if (sideState.backgroundAgentId && sideState.backgroundAgentId === _mobileBackgroundSpawnId(msg)) scheduleSideRenderSoon();
    updateChatComposerSpace();
  };
  const onBackgroundSpawnDone = (msg = {}) => {
    if (__pmChat.activeSessionId !== requestedSession) return;
    if (!_completeMobileBackgroundSpawnLane(msg, requestedSession)) return;
    const mergedLateFileChanges = _mergeMobileLatestAssistantBackgroundFileChanges(requestedSession);
    _renderMobileBackgroundSpawnDock(backgroundSpawnDock, requestedSession);
    if (sideState.backgroundAgentId && sideState.backgroundAgentId === _mobileBackgroundSpawnId(msg)) {
      flushSideRender();
      stopMobileBackgroundAgentDetailRefresh();
    }
    updateChatComposerSpace();
    if (mergedLateFileChanges) {
      renderThreadNow();
      updateMobileChatSessionHistory(requestedSession, _mobileHistoryForServer(_activeMobileThread())).catch(() => {});
    }
  };
  // Stamp disconnected:true whenever the app is hidden/closed while a run is active.
  // This is the ONLY reliable way to detect a cold reopen on iOS — the app dies
  // silently without firing a WS error, so disconnected never gets set otherwise.
  // On next open, isColdReopen=true → replayAfter=0 → full tool stream from seq=0.
  const onAppHide = () => {
    const sid = String(requestedSession || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
    if (!sid) return;
    const run = __pmChat.activeRuns?.[sid];
    if (run?.busy) {
      _rememberMobileActiveRun(sid, { disconnected: true });
    }
  };
  const onAppHideVisibility = () => {
    if (document.hidden) onAppHide();
  };
  window.addEventListener('pagehide', onAppHide, { capture: true });
  document.addEventListener('visibilitychange', onAppHideVisibility, { capture: true });

  window.addEventListener('focus', runRecoveryOnReturn);
  window.addEventListener('pageshow', runRecoveryOnReturn);
  document.addEventListener('visibilitychange', runRecoveryOnVisibility);
  wsEventBus?.on?.('ws:open', runRecoveryOnWsOpen);

  wsEventBus?.on?.('main_chat_stream_event', onMainChatStreamEvent);
  wsEventBus?.on?.('main_chat_stream_update', onMainChatStreamUpdate);
  wsEventBus?.on?.('internal_watch_sse', onInternalWatchSse);
  wsEventBus?.on?.('main_chat_goal_sse', onMainChatGoalSse);
  wsEventBus?.on?.('voice_interruption', onVoiceInterruptionEvent);
  wsEventBus?.on?.('voice_agent_tool_event', onVoiceAgentToolEvent);
  wsEventBus?.on?.('bg_agent_event', onBackgroundSpawnEvent);
  wsEventBus?.on?.('bg_agent_done', onBackgroundSpawnDone);
  const refreshSkillTriggerPill = () => _pmRenderSkillTriggerPill(page, input);
  const onSkillsCacheUpdated = (event) => {
    if (Array.isArray(event?.detail?.skills)) {
      window.prometheusSkillsCache = event.detail.skills;
      _pmSkillCacheReady = true;
      setPmSkillCacheReady(_pmSkillCacheReady);
    }
    refreshSkillTriggerPill();
    if (_pmSkillComposerState(input)) _pmRenderSlashPopover(page, input);
  };
  const onMarkdownReady = () => {
    renderThreadNow();
    if (sideSheet?.classList?.contains('open')) renderMobileSideSheet();
  };
  const previousCleanup = typeof page._pmCleanup === 'function' ? page._pmCleanup : null;
  page._pmCleanup = () => {
    previousCleanup?.();
    releaseActiveChatRuntime();
    mobilePageDisposed = true;
    if (__pmChat.mobilePageInstanceToken === mobilePageInstanceToken) {
      __pmChat.mobilePageInstanceToken = '';
    }
    mobileRecoveryDisposed = true;
    if (__pmChat.mobileRecoveryOwners[requestedSession] === mobileRecoveryOwnerToken) {
      delete __pmChat.mobileRecoveryOwners[requestedSession];
      if (__pmChat.recoverTimer) {
        clearTimeout(__pmChat.recoverTimer);
        __pmChat.recoverTimer = null;
      }
    }
    stopMobileBackgroundAgentDetailRefresh();
    stopGatewayTargetUpdates?.();
    closeTargetPopover?.();
    if (window.__pmMobilePairingScanner === pairingScannerBridge) window.__pmMobilePairingScanner = previousPairingScanner;
    chatSurfaceResizeObserver?.disconnect();
    body?.removeEventListener('scroll', updateScrollLatestButton);
    document.removeEventListener('scroll', updateScrollLatestButton);
    window.removeEventListener('scroll', updateScrollLatestButton);
    body?.removeEventListener('scroll', syncBackgroundDockOnScroll);
    document.removeEventListener('scroll', syncBackgroundDockOnScroll);
    window.removeEventListener('scroll', syncBackgroundDockOnScroll);
    body?.removeEventListener('scroll', maybeLoadOlderOnScroll);
    document.removeEventListener('scroll', maybeLoadOlderOnScroll);
    composerModeScrollTarget?.removeEventListener('scroll', onComposerModeScroll);
    if (composerModeScrollTarget !== body) document.removeEventListener('scroll', onComposerModeScroll);
    for (const eventName of ['touchstart', 'pointerdown', 'wheel']) {
      composerModeScrollTarget?.removeEventListener(eventName, onComposerModeScrollIntent, composerModeScrollIntentOptions);
      if (composerModeScrollTarget !== body) document.removeEventListener(eventName, onComposerModeScrollIntent, composerModeScrollIntentOptions);
    }
    modeKeyboardButton?.removeEventListener('click', onChatModeKeyboardClick);
    modeVoiceButton?.removeEventListener('click', onChatModeVoiceClick);
    if (composerModeTransitionTimer) {
      window.clearTimeout(composerModeTransitionTimer);
      composerModeTransitionTimer = 0;
    }
    threadEl?.removeEventListener('click', onLoadOlderClick);
    scrollLatestBtn?.removeEventListener('click', jumpToLatest);
    window.removeEventListener('pagehide', onAppHide, { capture: true });
    document.removeEventListener('visibilitychange', onAppHideVisibility, { capture: true });
    window.removeEventListener('focus', runRecoveryOnReturn);
    window.removeEventListener('pageshow', runRecoveryOnReturn);
    window.removeEventListener('prometheus:skills-cache-updated', onSkillsCacheUpdated);
    window.removeEventListener('prometheus:markdown-ready', onMarkdownReady);
    wsEventBus?.off?.('ws:open', runRecoveryOnWsOpen);
    wsEventBus?.off?.('ws:reconnecting', showReconnectingStatus);
    wsEventBus?.off?.('ws:waiting_for_network', showReconnectingStatus);
    wsEventBus?.off?.('ws:timeout', showReconnectingStatus);
    wsEventBus?.off?.('ws:error', showReconnectingStatus);
    wsEventBus?.off?.('ws:open', hideReconnectingStatus);
    if (connectionStatusHideTimer) {
      clearTimeout(connectionStatusHideTimer);
      connectionStatusHideTimer = null;
    }
    if (connectionStatusSuccessTimer) {
      clearTimeout(connectionStatusSuccessTimer);
      connectionStatusSuccessTimer = null;
    }

    document.removeEventListener('visibilitychange', runRecoveryOnVisibility);
    wsEventBus?.off?.('main_chat_stream_event', onMainChatStreamEvent);
    wsEventBus?.off?.('main_chat_stream_update', onMainChatStreamUpdate);
    wsEventBus?.off?.('internal_watch_sse', onInternalWatchSse);
    wsEventBus?.off?.('main_chat_goal_sse', onMainChatGoalSse);
    wsEventBus?.off?.('voice_interruption', onVoiceInterruptionEvent);
    wsEventBus?.off?.('voice_agent_tool_event', onVoiceAgentToolEvent);
    wsEventBus?.off?.('bg_agent_event', onBackgroundSpawnEvent);
    wsEventBus?.off?.('bg_agent_done', onBackgroundSpawnDone);
    if (window.__pmMobileRecoverActiveChatRun === recoverVisibleMobileActiveRun) {
      delete window.__pmMobileRecoverActiveChatRun;
    }
    if (window.__pmMobileBackgroundSpawnDockChanged === currentBackgroundDockBridge) {
      window.__pmMobileBackgroundSpawnDockChanged = previousBackgroundDockBridge;
    }
    if (window.__pmMobileBackgroundAgentDetail === currentBackgroundAgentDetailBridge) {
      window.__pmMobileBackgroundAgentDetail = previousBackgroundAgentDetailBridge;
    }
    if (window.__pmMobileBackgroundAgentDetailRender === currentBackgroundAgentDetailRenderBridge) {
      window.__pmMobileBackgroundAgentDetailRender = previousBackgroundAgentDetailRenderBridge;
    }
    if (window.__pmMobileToolProgressDockChanged === currentToolProgressDockBridge) {
      window.__pmMobileToolProgressDockChanged = previousToolProgressDockBridge;
    }
    if (window.__pmMobileQueuedPromptsChanged === currentQueuedPromptsBridge) {
      window.__pmMobileQueuedPromptsChanged = previousQueuedPromptsBridge;
    }
    if (window.__pmMobileGoalChanged === currentGoalBridge) {
      window.__pmMobileGoalChanged = previousGoalBridge;
    }
    if (window.__pmMobileQuestionComposerChanged === currentQuestionComposerBridge) {
      window.__pmMobileQuestionComposerChanged = previousQuestionComposerBridge;
    }
    if (window.__pmMobileOpenChatComposer === currentOpenChatComposerBridge) {
      window.__pmMobileOpenChatComposer = previousOpenChatComposerBridge;
    }
    if (__pmChat.workTimer) {
      clearInterval(__pmChat.workTimer);
      __pmChat.workTimer = null;
    }
    if (__pmChat.recoverTimer) {
      clearTimeout(__pmChat.recoverTimer);
      __pmChat.recoverTimer = null;
    }
    if (window.__pmMobileChatVoiceUpdate === _onChatVoiceUpdate) {
      window.__pmMobileChatVoiceUpdate = previousVoiceUpdateBridge;
    }
    window.removeEventListener('pm-mobile-chat-voice-update', _chatVoiceUpdateEventHandler);
    window.removeEventListener('pm-mobile-chat-voice-layout', _chatVoiceLayoutEventHandler);
    chatVoiceClose?.removeEventListener('click', _closeChatVoiceMode);
    chatVoiceCamera?.removeEventListener('click', _openChatVoiceAttachSheet);
    // Prefer the hardened close path so a cleanup throw cannot leave the
    // full-screen voice composer covering chat after route teardown.
    try {
      _closeChatVoiceMode();
    } catch (err) {
      console.warn('[mobile chat] voice close during page cleanup failed:', err);
      try {
        document.body?.classList.remove(
          'pm-chat-voice-active',
          'pm-chat-voice-new-chat',
          'pm-chat-voice-existing-chat',
          'pm-chat-voice-focus',
          'pm-chat-voice-docked',
        );
      } catch {}
      try { body?.classList.remove('pm-chat-voice-occluded'); } catch {}
      try { form?.classList.remove('is-voice-active'); } catch {}
    }
    stopCameraCapture();
    _teardownKeyboardController();
  };

  let lastComposerSubmitAt = 0;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitNow = Date.now();
    // The native haptic proxy and the real submit control can both produce a
    // submit-sized activation on iOS. Collapse that same physical tap into one
    // request while still allowing deliberate later sends/queued prompts.
    if (submitNow - lastComposerSubmitAt < 450) return;
    lastComposerSubmitAt = submitNow;
    // The send control is a submit button behind the mobile haptic proxy.
    // Explicitly blur the composer first so iOS/Android dismiss the virtual
    // keyboard before the send/queue/abort/voice branch updates the layout.
    try { input?.blur?.(); } catch {}
    const text = _pmGetComposerValue(input);
    const activeSid = String(__pmChat.activeSessionId || requestedSession || MOBILE_CHAT_SESSION_ID);
    if (_getPendingQuestionForSession(activeSid)) {
      const submitted = await _submitMobileQuestionFromComposer(text, activeSid);
      if (submitted) {
        resetComposerInput();
        _pmClearActiveSlashCommand(page, input, { focus: false });
      }
      updateComposerSubmitState(activeSid);
      return;
    }
    if (/^\/side(\s|$)/i.test(text.trim())) {
      const initial = text.trim().slice('/side'.length).trim();
      resetComposerInput();
      _pmClearActiveSlashCommand(page, input, { focus: false });
      updateComposerSubmitState();
      openMobileSideChat(initial).catch((err) => {
        console.warn('[mobile side chat] open failed:', err);
        pmToast(`Side chat failed: ${err.message || err}`, 'error');
      });
      return;
    }
    if (/^\/browse(\s|$)/i.test(text.trim())) {
      const path = text.trim().slice('/browse'.length).trim();
      resetComposerInput();
      _pmClearActiveSlashCommand(page, input, { focus: false });
      handleBrowseCommand(path);
      return;
    }
    if (normalizeBareSlashCommand(text)) {
      resetComposerInput();
      _pmClearActiveSlashCommand(page, input, { focus: false });
      handleImmediateSlashCommand(text);
      return;
    }
    const hasAttachments = getPendingAttachments().length > 0;
    if ((__pmChat.activeRuns?.[activeSid]?.busy || __pmChat.activeRuns?.[requestedSession]?.busy) && !text.trim() && !hasAttachments) {
      requestMobileMainChatAbort(activeSid).catch((err) => {
        console.warn('[mobile chat] abort request failed:', err);
        pmToast(`Stop failed: ${err.message || err}`, 'error');
      });
      resizeComposerInput();
      updateComposerSubmitState();
      return;
    }
    if (!text.trim() && !hasAttachments) {
      _toggleChatVoiceMode({ autoStart: true }).catch((err) => {
        console.warn('[mobile chat] voice mode start failed:', err);
        pmToast('Could not start voice mode.', 'error');
      });
      return;
    }
    const selectedSkillIds = _pmNormalizeSelectedSkillIds(pmSelectedComposerSkillIds);
    const selectedSkillRefs = _pmNormalizeSelectedComposerSkillRefs(pmSelectedComposerSkills);
    resetComposerInput();
    _pmClearActiveSlashCommand(page, input, { focus: false });
    updateComposerSubmitState();
    sendMessage(text, { selectedSkillIds, selectedSkillRefs });
  });

  // Haptic feedback on the orange send / voice-mode / abort button and the mic
  // button. The send button routes through the form's submit handler (which
  // decides send vs voice-start vs abort), so we forward via requestSubmit().
  try {
    if (sendBtn) attachMobileButtonHaptic(sendBtn, () => form.requestSubmit());
    if (micBtn) attachMobileButtonHaptic(micBtn, () => micBtn.click());
  } catch (err) { console.warn('[mobile chat] haptic wiring failed:', err); }

  threadEl?.addEventListener('click', (event) => {
    const skillRefBtn = event.target.closest?.('[data-pm-skill-ref]');
    if (skillRefBtn) {
      event.preventDefault();
      event.stopPropagation();
      _pmShowSkillReferencePopover(
        skillRefBtn.getAttribute('data-pm-skill-ref') || '',
        skillRefBtn.getAttribute('data-pm-skill-title') || skillRefBtn.textContent || '',
      ).catch((err) => {
        console.warn('[mobile skills] failed to open skill reference popover:', err);
        pmToast('Could not load skill details.', 'error');
      });
      return;
    }

    const emailComposerBtn = event.target.closest?.('[data-email-composer-action]');
    if (emailComposerBtn) {
      event.preventDefault();
      event.stopPropagation();
      _handleMobileEmailComposerAction(emailComposerBtn);
      return;
    }

    const msgActionBtn = event.target.closest?.('[data-msg-action][data-msg-index]');
    if (msgActionBtn) {
      event.preventDefault();
      event.stopPropagation();
      handleMobileMessageAction(msgActionBtn);
      return;
    }

    const browseViewBtn = event.target.closest?.('[data-browse-view]');
    if (browseViewBtn) {
      event.preventDefault();
      const activeThread = _activeMobileThread();
      const browseTurn = [...activeThread].reverse().find(m => m.body?.browseState);
      if (browseTurn) {
        browseTurn.body.browseState.view = browseViewBtn.getAttribute('data-browse-view') === 'grid' ? 'grid' : 'list';
        renderThreadNow();
      }
      return;
    }

    const browseToggleBtn = event.target.closest?.('[data-browse-toggle]');
    if (browseToggleBtn) {
      event.preventDefault();
      const activeThread = _activeMobileThread();
      const browseTurn = [...activeThread].reverse().find(m => m.body?.browseState);
      const section = browseToggleBtn.getAttribute('data-browse-toggle') || '';
      if (browseTurn) {
        if (section === 'folders') browseTurn.body.browseState.showAllFolders = !browseTurn.body.browseState.showAllFolders;
        if (section === 'files') browseTurn.body.browseState.showAllFiles = !browseTurn.body.browseState.showAllFiles;
        renderThreadNow();
      }
      return;
    }

    // Browse: navigate into directory / breadcrumb
    const navBtn = event.target.closest?.('[data-browse-nav]');
    if (navBtn) {
      event.preventDefault();
      const path = navBtn.getAttribute('data-browse-nav') || '';
      const activeThread = _activeMobileThread();
      const browseTurn = [...activeThread].reverse().find(m => m.body?.browseState);
      if (browseTurn) _browseTo(browseTurn, path);
      return;
    }
    // Browse: open file in canvas sheet
    const fileBtn = event.target.closest?.('[data-browse-open]');
    if (fileBtn) {
      event.preventDefault();
      const path = fileBtn.getAttribute('data-browse-open') || '';
      const kind = fileBtn.getAttribute('data-browse-kind') || 'file';
      const name = fileBtn.getAttribute('data-browse-name') || path.split('/').pop() || 'File';
      window.__pmCanvasSheet?.open({
        name, kind, path,
        src: _mobileMediaUrl({ path }, 'inline'),
        download: _mobileMediaUrl({ path }, 'download'),
      });
      return;
    }

    // Existing: command action buttons
    const button = event.target.closest?.('[data-pm-command-action]');
    if (!button) return;
    event.preventDefault();
    const action = button.getAttribute('data-pm-command-action') || '';
    const id = button.getAttribute('data-pm-command-id') || '';
    runCommandAction(action, id, button);
  });

  threadEl?.addEventListener('input', (event) => {
    const search = event.target.closest?.('[data-browse-search]');
    if (!search) return;
    const activeThread = _activeMobileThread();
    const browseTurn = [...activeThread].reverse().find(m => m.body?.browseState);
    if (!browseTurn) return;
    browseTurn.body.browseState.query = search.value || '';
    browseTurn.body.browseState.showAllFolders = false;
    browseTurn.body.browseState.showAllFiles = false;
    renderThreadNow();
    requestAnimationFrame(() => {
      const next = threadEl.querySelector('[data-browse-search]');
      try {
        if (next) {
          next.focus({ preventScroll: true });
          const len = next.value.length;
          next.setSelectionRange(len, len);
        }
      } catch {}
    });
  });

  input?.addEventListener('input', () => {
    resizeComposerInput();
    _pmHandleSlashInput(page, input);
    _pmRenderSkillTriggerPill(page, input);
    _pmUpdateComposerRichPreview(page, input);
    updateComposerSubmitState();
    // Text growth changes the form's top edge while it remains bottom-anchored.
    // Re-measure immediately so the routing rows stay above the expanded
    // composer instead of being left behind at their collapsed position.
    updateComposerExpandedState();
  });
  input?.addEventListener('focus', updateComposerExpandedState);
  input?.addEventListener('blur', () => setTimeout(updateComposerExpandedState, 0));
  input?.addEventListener('scroll', () => _pmUpdateComposerRichPreview(page, input));
  input?.addEventListener('keydown', (e) => {
    const skillSuggestions = _pmSkillComposerSuggestions(input);
    const suggestions = skillSuggestions.length ? skillSuggestions : _pmSlashCommandSuggestions(input);
    const popoverOpen = !page.querySelector('#pm-chat-slash-popover')?.hidden && suggestions.length > 0;
    if (!popoverOpen) {
      // Plain Enter inserts a newline (default behavior) so multi-paragraph
      // messages can be typed; sending is done via the Send button.
      if (e.key === 'Escape' && pmActiveSlashCommand) {
        e.preventDefault();
        _pmClearActiveSlashCommand(page, input);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (skillSuggestions.length) {
        pmSkillComposerSelectionIndex = e.key === 'ArrowDown'
          ? (pmSkillComposerSelectionIndex + 1) % suggestions.length
          : (pmSkillComposerSelectionIndex - 1 + suggestions.length) % suggestions.length;
        setPmSkillComposerSelectionIndex(pmSkillComposerSelectionIndex);
      } else {
        pmSlashCommandSelectionIndex = e.key === 'ArrowDown'
          ? (pmSlashCommandSelectionIndex + 1) % suggestions.length
          : (pmSlashCommandSelectionIndex - 1 + suggestions.length) % suggestions.length;
        setPmSlashCommandSelectionIndex(pmSlashCommandSelectionIndex);
      }
      _pmRenderSlashPopover(page, input);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (skillSuggestions.length) {
        _pmReplaceSkillComposerWithSelection(page, input, suggestions[pmSkillComposerSelectionIndex] || suggestions[0]);
      } else {
        _pmSelectSlashCommand(page, input, suggestions[pmSlashCommandSelectionIndex]?.command || suggestions[0]?.command || '');
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _pmHideSlashPopover(page);
    }
  });
  input?.addEventListener('blur', () => setTimeout(() => _pmHideSlashPopover(page), 120));
  questionHost?.addEventListener('input', (event) => {
    const field = event.target?.closest?.('[data-pm-q-text], [data-pm-q-other], [data-pm-q-general]');
    if (!field) return;
    _mobileQuestionRememberDraft(field);
    updateChatComposerSpace();
  });
  questionHost?.addEventListener('change', (event) => {
    const field = event.target?.closest?.('[data-pm-q-text], [data-pm-q-other], [data-pm-q-general]');
    if (field) _mobileQuestionRememberDraft(field);
  });
  commandChip?.addEventListener('click', () => _pmClearActiveSlashCommand(page, input));
  window.addEventListener('prometheus:skills-cache-updated', onSkillsCacheUpdated);
  // Warm the explicit `$` picker while the chat surface mounts. The picker
  // still shows a stable loading row if the user types before this completes.
  _pmEnsureSkillTriggerCacheLoaded();
  window.addEventListener('prometheus:markdown-ready', onMarkdownReady);

  function syncComposerAfterProgrammaticTextChange() {
    if (!input) return;
    resizeComposerInput();
    _pmHandleSlashInput(page, input);
    _pmRenderSkillTriggerPill(page, input);
    _pmUpdateComposerRichPreview(page, input);
    updateComposerSubmitState();
    updateComposerExpandedState();
    try {
      input.scrollTop = input.scrollHeight;
      const end = String(input.value || '').length;
      input.setSelectionRange(end, end);
    } catch {}
    requestAnimationFrame(() => {
      resizeComposerInput();
      _pmUpdateComposerRichPreview(page, input);
      updateChatComposerSpace();
    });
  }

  sideComposer?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMobileSideMessage().catch((err) => {
      console.warn('[mobile side chat] send failed:', err);
      pmToast(`Side chat failed: ${err.message || err}`, 'error');
    });
  });
  sideInput?.addEventListener('input', () => {
    resizeSideInput();
    setMobileSideBusy(sideState.busy);
  });
  sideInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (typeof sideComposer?.requestSubmit === 'function') sideComposer.requestSubmit();
      else sideComposer?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
    if (event.key === 'Escape') closeMobileSideChatSheet();
  });
  sideCloseBtn?.addEventListener('click', closeMobileSideChatSheet);
  sideScrim?.addEventListener('click', closeMobileSideChatSheet);
  sideAttachBtn?.addEventListener('click', () => pmToast('Side chat attachments are coming next. Attach files in the main chat first.', 'info'));
  sideMicBtn?.addEventListener('click', () => pmToast('Side chat dictation is coming next. Use the main mic for now.', 'info'));

  let sideDragY = null;
  sideHandle?.addEventListener('touchstart', (event) => {
    sideDragY = event.touches?.[0]?.clientY ?? null;
    if (sidePanel) sidePanel.style.transition = 'none';
  }, { passive: true });
  sideHandle?.addEventListener('touchmove', (event) => {
    if (sideDragY == null || !sidePanel) return;
    const dy = (event.touches?.[0]?.clientY ?? sideDragY) - sideDragY;
    if (dy > 0) sidePanel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sideHandle?.addEventListener('touchend', (event) => {
    if (sideDragY == null || !sidePanel) return;
    const dy = (event.changedTouches?.[0]?.clientY ?? sideDragY) - sideDragY;
    sidePanel.style.transition = '';
    sidePanel.style.transform = '';
    if (dy > 80) closeMobileSideChatSheet();
    sideDragY = null;
  }, { passive: true });

  attachBtn?.addEventListener('pointerdown', () => {
    pendingFileInputTarget = 'chat';
    closeAttachSheet();
  });
  attachBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAttachSheet({ target: 'chat' });
  });
  attachBtn?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    pendingFileInputTarget = 'chat';
    openAttachSheet({ target: 'chat' });
  });
  attachSheetScrim?.addEventListener('click', closeAttachSheet);
  attachSheet?.querySelectorAll('[data-pm-attach-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = String(btn.getAttribute('data-pm-attach-action') || '');
      const target = String(attachSheetTarget || attachSheet?.dataset?.pmAttachTarget || 'chat');
      if (action === 'camera') {
        if (target === 'voice') openVoiceCameraCaptureFromSheet();
        else openCameraCapture();
      } else if (action === 'files-photos' || action === 'photos' || action === 'files') {
        pendingFileInputTarget = target === 'voice' ? 'voice' : 'chat';
        closeAttachSheet();
        fileInput?.click();
      }
    });
  });
  cameraClose?.addEventListener('click', stopCameraCapture);
  cameraMore?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCameraMoreMenuOpen(!cameraMore.classList.contains('is-open'));
  });
  cameraFlash?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCameraTorch().catch(() => {});
  });
  cameraPairScan?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCameraMoreMenuOpen(false);
    startPairingQrScan().catch(() => {});
  });
  cameraFlip?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCameraMoreMenuOpen(false);
    flipCameraCapture().catch(() => {});
  });
  function clearCameraHoldTimer() {
    if (cameraHoldTimer) clearTimeout(cameraHoldTimer);
    cameraHoldTimer = null;
  }
  function beginCameraShutterPress(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!cameraStream || cameraOpening || cameraPointerActive) return;
    try { pmHaptic?.(10); } catch {}
    cameraPointerActive = true;
    cameraSuppressClick = false;
    clearCameraHoldTimer();
    cameraHoldTimer = setTimeout(() => {
      cameraHoldTimer = null;
      if (!cameraPointerActive) return;
      cameraSuppressClick = true;
      try { pmHaptic?.(16); } catch {}
      startCameraRecording();
    }, CAMERA_RECORD_HOLD_MS);
  }
  function endCameraShutterPress(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!cameraPointerActive) return;
    cameraPointerActive = false;
    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
      clearCameraHoldTimer();
      stopCameraRecording();
      return;
    }
    if (cameraHoldTimer) {
      clearCameraHoldTimer();
      captureCameraFrame().catch(() => {});
      return;
    }
    setTimeout(() => { cameraSuppressClick = false; }, 250);
  }
  function cancelCameraShutterPress(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    cameraPointerActive = false;
    clearCameraHoldTimer();
    if (cameraRecorder && cameraRecorder.state !== 'inactive') stopCameraRecording();
  }
  cameraShutter?.addEventListener('contextmenu', (event) => event.preventDefault());
  cameraShutter?.addEventListener('selectstart', (event) => event.preventDefault());
  cameraShutter?.addEventListener('click', (event) => {
    if (cameraSuppressClick) {
      event.preventDefault();
      event.stopPropagation();
      cameraSuppressClick = false;
    }
  });
  cameraShutter?.addEventListener('pointerdown', beginCameraShutterPress);
  cameraShutter?.addEventListener('pointerup', endCameraShutterPress);
  cameraShutter?.addEventListener('pointercancel', cancelCameraShutterPress);
  cameraShutter?.addEventListener('pointerleave', cancelCameraShutterPress);
  cameraShutter?.addEventListener('touchstart', beginCameraShutterPress, { passive: false });
  cameraShutter?.addEventListener('touchend', endCameraShutterPress, { passive: false });
  cameraShutter?.addEventListener('touchcancel', cancelCameraShutterPress, { passive: false });
  window.addEventListener('pagehide', stopCameraCapture, { once: true });
  if (__pmChat.cameraVisibilityHandler) document.removeEventListener('visibilitychange', __pmChat.cameraVisibilityHandler);
  __pmChat.cameraVisibilityHandler = () => {
    if (document.visibilityState === 'hidden') stopCameraCapture();
  };
  document.addEventListener('visibilitychange', __pmChat.cameraVisibilityHandler);
  async function handleMobileAttachmentInputChange(sourceInput) {
    const files = Array.from(sourceInput?.files || []).slice(0, 8);
    const target = String(pendingFileInputTarget || 'chat');
    pendingFileInputTarget = 'chat';
    if (sourceInput) sourceInput.value = '';
    if (!files.length) return;
    if (target === 'voice') {
      await stageVoicePhotoFiles(files);
      return;
    }
    try {
      const normalized = await Promise.all(files.map(_normalizeMobileFile));
      getPendingAttachments().push(...normalized);
      renderPendingAttachments();
    } catch (err) {
      pmToast(err.message || 'Could not attach file', 'error');
    }
  }
  fileInput?.addEventListener('change', () => handleMobileAttachmentInputChange(fileInput));
  photoInput?.addEventListener('change', () => handleMobileAttachmentInputChange(photoInput));

  let chatSpeech = null;
  let chatSpeechEnabled = false;
  let chatSpeechRestartTimer = null;
  let chatSpeechRecognition = null;
  let chatSpeechCycleGeneration = 0;
  const scheduleChatDictationCycle = (delay = 140) => {
    if (chatSpeechRestartTimer) clearTimeout(chatSpeechRestartTimer);
    chatSpeechRestartTimer = null;
    if (!chatSpeechEnabled || !chatSpeechRecognition) return;
    chatSpeechRestartTimer = setTimeout(() => {
      chatSpeechRestartTimer = null;
      startChatDictationCycle(chatSpeechRecognition);
    }, delay);
  };
  resetChatDictationComposerState = () => {
    // Sending always ends transcription mode. Besides clearing the active
    // recognizer, invalidate its callbacks so a late result cannot repopulate
    // the now-empty composer.
    chatSpeechEnabled = false;
    chatSpeechCycleGeneration += 1;
    if (chatSpeechRestartTimer) clearTimeout(chatSpeechRestartTimer);
    chatSpeechRestartTimer = null;
    const recognition = chatSpeech;
    chatSpeech = null;
    try { recognition?.abort?.(); } catch {
      try { recognition?.stop?.(); } catch {}
    }
    micBtn?.classList.remove('listening');
  };
  const stopChatDictation = () => {
    chatSpeechEnabled = false;
    chatSpeechCycleGeneration += 1;
    if (chatSpeechRestartTimer) clearTimeout(chatSpeechRestartTimer);
    chatSpeechRestartTimer = null;
    const recognition = chatSpeech;
    chatSpeech = null;
    try { recognition?.stop?.(); } catch {}
    micBtn?.classList.remove('listening');
    input?.focus();
    syncComposerAfterProgrammaticTextChange();
  };
  const startChatDictationCycle = (SpeechRecognition) => {
    if (!chatSpeechEnabled || chatSpeech) return;
    try {
      const recognition = new SpeechRecognition();
      const cycleGeneration = chatSpeechCycleGeneration;
      chatSpeech = recognition;
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;
      const cycleStartValue = String(input.value || '').trimEnd();
      recognition.onstart = () => {
        if (cycleGeneration === chatSpeechCycleGeneration) micBtn?.classList.add('listening');
      };
      recognition.onresult = (event) => {
        if (cycleGeneration !== chatSpeechCycleGeneration) return;
        let finalTranscript = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const transcript = String(event.results[i][0]?.transcript || '');
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interim += transcript;
        }
        const spoken = `${finalTranscript}${interim}`.trim();
        input.value = `${cycleStartValue}${cycleStartValue && spoken ? ' ' : ''}${spoken}`;
        syncComposerAfterProgrammaticTextChange();
      };
      recognition.onerror = (event) => {
        if (cycleGeneration !== chatSpeechCycleGeneration) return;
        const error = String(event?.error || 'unknown');
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) {
          const msg = error === 'not-allowed' || error === 'service-not-allowed'
            ? 'Microphone permission was denied.'
            : 'The microphone is not available.';
          pmToast(msg, 'error');
          chatSpeechEnabled = false;
        } else if (!['no-speech', 'aborted'].includes(error)) {
          console.warn('[mobile chat] dictation cycle error:', error);
        }
      };
      recognition.onend = () => {
        if (cycleGeneration !== chatSpeechCycleGeneration) return;
        if (chatSpeech === recognition) chatSpeech = null;
        syncComposerAfterProgrammaticTextChange();
        if (!chatSpeechEnabled) {
          micBtn?.classList.remove('listening');
          input?.focus();
          return;
        }
        // Mobile browsers end SpeechRecognition after a silence window even in
        // continuous mode. Keep the user-controlled dictation session alive by
        // starting a new cycle; only another mic tap switches it off.
        scheduleChatDictationCycle();
      };
      recognition.start();
    } catch (err) {
      chatSpeech = null;
      chatSpeechEnabled = false;
      micBtn?.classList.remove('listening');
      pmToast(err?.message || 'Could not start dictation.', 'error');
    }
  };
  micBtn?.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      pmToast('Speech dictation is not available in this browser.', 'error');
      return;
    }
    chatSpeechRecognition = SpeechRecognition;
    if (chatSpeechEnabled) {
      stopChatDictation();
      return;
    }
    chatSpeechEnabled = true;
    micBtn.classList.add('listening');
    pmToast('Listening until you tap the mic again.', 'info');
    startChatDictationCycle(SpeechRecognition);
  });

  const cleanupChatPageBeforeDictation = page._pmCleanup;
  page._pmCleanup = () => {
    chatSpeechEnabled = false;
    chatSpeechCycleGeneration += 1;
    if (chatSpeechRestartTimer) clearTimeout(chatSpeechRestartTimer);
    chatSpeechRestartTimer = null;
    const recognition = chatSpeech;
    chatSpeech = null;
    try { recognition?.abort?.(); } catch {
      try { recognition?.stop?.(); } catch {}
    }
    resetChatDictationComposerState = () => {};
    cleanupChatPageBeforeDictation?.();
  };

  if (form && input) markMobileLifecycle('composerInteractive');
}
}
