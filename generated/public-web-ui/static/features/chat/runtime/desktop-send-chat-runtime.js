/**
 * Owns the desktop send orchestration boundary.
 *
 * The page keeps the DOM/session wiring and supplies this runtime through a
 * lazy context resolver so late-initialized page state remains live.
 */
export function createDesktopSendChatRuntime(resolveContext = () => ({})) {
  return async function sendChat(queuedMessage = null, options = {}) {
      let {
        MAX_QUEUED_PROMPTS,
        _chatSteerWorkflowGroupIds,
        _collapseChatSteerWorkflowPresentation,
        _settlePendingChatSteerPresentation,
        acquireChatSendLock,
        addSessionProcessEntry,
        announceSourcePanelFileChanges,
        appendDesktopDurableThought,
        appendFinalResponseDelta,
        applyCreativeAssistantOps,
        applyDesignAssistantOps,
        applyServerSessionTitle,
        applySessionCreativeMode,
        applyStreamStateToWindow,
        applyToolActivityEvent,
        beginDesktopProjectChatSession,
        beginFinalResponse,
        buildCombinedCallerContext,
        buildFileContextNote,
        buildReasoningPayload,
        canvasOpen,
        canvasPresentFile,
        chatProgressVisibility,
        clearBackgroundSpawnDockForSession,
        clearChatComposerAfterSend,
        clearDesignMultiSelection,
        clearDesktopActiveChatRun,
        createEmptyChatSession,
        currentAbortController,
        setCurrentAbortController,
        designMultiSelectedElements,
        designSelectionToAttachmentPreview,
        desktopChatRuntime,
        desktopNewChatContext,
        desktopTraceThoughtKind,
        ensureActiveChatSessionExists,
        ensureCreativeFeatureRuntime,
        finalizeRealtimeVoicePlaybackInterruptContext,
        findRecentVoiceWorkflowUserIndex,
        flushStreamingRenderFor,
        forgetLocalMainChatRequest,
        formatModelDisplayName,
        formatToolCallForLog,
        formatToolProgressForLog,
        formatToolResultForLog,
        getChatComposerValue,
        getChatSessionById,
        getCreativeModeMeta,
        getMainChatStreamLastSeq,
        getSessionQueuedPrompts,
        getSessionStreamState,
        getSkillTriggerExcludedIds,
        handleImmediateChatSlashCommand,
        handleRealtimeVoiceInterruptionOnly,
        hasPendingPrometheusQuestion,
        highlightedTextToAttachmentPreview,
        isActiveMainGoalRunning,
        isAssistantLikeMessage,
        isBareThinkingLiveTraceText,
        isBrowserDesignMode,
        isDesktopChatTransportDisconnect,
        isDesktopNewChatDraft,
        isDesktopProgressNarration,
        isDesktopSummaryThoughtEvent,
        isDesktopTraceThoughtType,
        isDesktopVoiceNarrationActive,
        isFailedTurnReply,
        isRenderableLiveTraceImageSource,
        isSessionThinking,
        isSessionVisibleInChatSurface,
        logDesktopVoiceLatency,
        makeEmptyStreamState,
        makeQueuedChatTurn,
        markLiveStreamMotionAfterRender,
        markVoicePendingTurn,
        maybeAutoScrollRightColumn,
        mergeChatMessageMetadata,
        mergeFileChangesWithBackground,
        mergeLiveTraceProcessEntries,
        mergeSlashCommandSkillIds,
        mergeVoiceAgentProcessEntryLists,
        newChatClientRequestId,
        normalizeCreativeMode,
        normalizeDeclaredRuntimeProgressState,
        normalizeGeneratedImageEntry,
        normalizeGeneratedVideoEntry,
        normalizeQueuedChatTurn,
        normalizeSelectedSkillIds,
        pendingChatFiles,
        setPendingChatFiles,
        persistSession,
        prepareDesktopVoiceAgentHandoff,
        processVoicePendingTurns,
        readDesktopActiveChatRun,
        realtimeVoicePendingInterruptContext,
        reconcileFinalResponse,
        recordChatContextWindowToolResult,
        refreshOpenCanvasFiles,
        releaseChatSendLock,
        rememberDesktopActiveChatRun,
        rememberLocalMainChatRequest,
        removeVoicePendingTurnInternal,
        renderChatFilePills,
        renderChatMessages,
        renderProgressPanel,
        renderStreamingChatUpdate,
        requestVoiceAgentRealtimeFinalSummaryWithRetry,
        resetChatContextWindowLiveTurn,
        resetSessionStreamState,
        restoreActiveSessionIfStreamStoleFocus,
        rightPanelCollapsed,
        sanitizeAttachmentPreviewForDurableStorage,
        saveChatSessions,
        scheduleChatContextWindowRefresh,
        scheduleChatResourcesReload,
        scheduleDesktopMainChatRecovery,
        scheduleStreamingRenderFor,
        selectedComposerSkillIds,
        setDesktopLiveProgressNarration,
        settleChatContextWindowLiveTurn,
        shouldProcessMainChatStreamEvent,
        shouldRefreshChatResourcesForAction,
        showDesktopVoiceStatus,
        showToast,
        speakAssistantReply,
        speakVoiceMilestone,
        stagedFilesToAttachmentPreviews,
        startVoiceAgentRealtimeSession,
        steerActiveGoalRunFromComposer,
        submitPendingPrometheusQuestionFromComposer,
        syncActiveSessionRunState,
        syncSessionHistoryToServerById,
        syncStreamingVisualActivity,
        toggleRightPanel,
        updateHeartbeatUI,
        updatePromptVariantAfterRerun,
        updateQueuedPromptUI,
        uploadResultsToAttachmentPreviews,
        uploadStagedFilesToCanvas,
        voiceAgentRealtimeConnection,
        waitForChatFileStaging,
        wantsVoiceAgentRealtimeMode,
      } = resolveContext() || {};
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    if (typeof waitForChatFileStaging === 'function') await waitForChatFileStaging();
    const queuedTurn = queuedMessage == null ? null : normalizeQueuedChatTurn(queuedMessage);
    const raw = queuedTurn ? queuedTurn.message : getChatComposerValue();
    const message = String(raw || '').trim();
    if (!queuedTurn && hasPendingPrometheusQuestion(window.activeChatSessionId)) {
      await submitPendingPrometheusQuestionFromComposer(message, input);
      return;
    }
    if (!message) return;
    if (!queuedTurn && handleImmediateChatSlashCommand(message)) return;
    const excludedSkillIds = queuedTurn
      ? (Array.isArray(queuedTurn.excludedSkillIds) ? queuedTurn.excludedSkillIds.slice() : [])
      : getSkillTriggerExcludedIds();
    const selectedSkillIds = mergeSlashCommandSkillIds(message, queuedTurn
      ? normalizeSelectedSkillIds(queuedTurn.selectedSkillIds || queuedTurn.forcedSkillIds || queuedTurn.matchedSkillIds)
      : normalizeSelectedSkillIds(selectedComposerSkillIds));
    const forcedSessionId = String(options.sessionIdOverride || '').trim();
    if (!forcedSessionId && !queuedTurn && desktopNewChatContext.projectId && isDesktopNewChatDraft()) {
      try {
        await beginDesktopProjectChatSession();
      } catch (error) {
        showToast('Could not open project', error?.message || String(error), 'error');
        return;
      }
    }
    if (!forcedSessionId) ensureActiveChatSessionExists();
    const thisSessionId = forcedSessionId || window.activeChatSessionId; // capture at send time — stable through async closure
    if (forcedSessionId && !getChatSessionById(forcedSessionId)) {
      window.chatSessions.unshift(createEmptyChatSession(forcedSessionId));
      saveChatSessions();
    }
    const sendLock = (!queuedTurn && !Number.isInteger(options.reuseExistingUserIndex))
      ? acquireChatSendLock(thisSessionId, message)
      : { key: '', at: Date.now() };
    if (!sendLock) return;
    const clientRequestId = String(options.clientRequestId || '').trim() || newChatClientRequestId(thisSessionId);
    const markChatPerformance = (name, details = {}) => {
      try {
        window.__PROM_PERF_MARK?.(name, {
          clientRequestId,
          ...details,
        });
      } catch {}
    };
    markChatPerformance('chat_submit');
    rememberLocalMainChatRequest(thisSessionId, clientRequestId);
    const thisSession = getChatSessionById(thisSessionId);
    const isVoiceRoomComposerTurn = String(thisSession?.source || thisSession?.channel || '') === 'voice_room'
      || String(thisSessionId).startsWith('voice_room_');
    if (isVoiceRoomComposerTurn && !queuedTurn && !Number.isInteger(options.reuseExistingUserIndex)) {
      try {
        const voiceRoomFiles = pendingChatFiles.length ? pendingChatFiles.slice() : [];
        const uploadedVoiceRoomFiles = voiceRoomFiles.length
          ? await uploadStagedFilesToCanvas(voiceRoomFiles)
          : [];
        const failedVoiceRoomFiles = uploadedVoiceRoomFiles.filter((file) => !String(file?.workspacePath || '').trim());
        if (failedVoiceRoomFiles.length) {
          throw new Error(`Could not upload ${failedVoiceRoomFiles.map((file) => file?.name || 'attachment').join(', ')}.`);
        }
        const attachmentLines = uploadedVoiceRoomFiles
          .map((file) => {
            const path = String(file?.workspacePath || '').trim();
            return path ? `- ${String(file?.name || 'attachment')}: ${path}` : '';
          })
          .filter(Boolean);
        const voiceRoomPrompt = attachmentLines.length
          ? `${message}\n\nAttached files (open these workspace paths when answering):\n${attachmentLines.join('\n')}`
          : message;
        const connection = voiceAgentRealtimeConnection?.sessionId === thisSessionId
          ? voiceAgentRealtimeConnection
          : await startVoiceAgentRealtimeSession(thisSessionId, { listenMode: 'always_listening' });
        const bridgeSessionId = String(connection?.codexBridgeSessionId || '').trim();
        if (!bridgeSessionId) throw new Error('The Voice Room is not connected through Codex Voice / Live.');
        const response = await fetch('/api/realtime/codex-bridge/append-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: bridgeSessionId, text: voiceRoomPrompt }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) throw new Error(result?.error || 'Voice Room message was not accepted.');
        const timestamp = Date.now();
        const attachmentPreviews = uploadResultsToAttachmentPreviews(uploadedVoiceRoomFiles);
        if (!Array.isArray(thisSession.history)) thisSession.history = [];
        thisSession.history.push({
          messageId: clientRequestId,
          role: 'user',
          content: message,
          attachmentPreviews: attachmentPreviews.length ? attachmentPreviews : undefined,
          timestamp,
          channel: 'voice_room',
          channelLabel: 'Voice Room',
          source: 'voice_room_composer',
          voiceSpeaker: 'You',
        });
        fetch(`/api/voice-rooms/${encodeURIComponent(thisSessionId)}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: clientRequestId,
            role: 'user',
            speaker: 'You',
            text: message,
            timestamp,
            attachments: uploadedVoiceRoomFiles.map((file) => ({
              name: file.name,
              path: file.workspacePath,
              mimeType: file.mimeType || '',
            })),
          }),
        }).catch(() => {});
        if (window.activeChatSessionId === thisSessionId) window.chatHistory = thisSession.history;
        if (voiceRoomFiles.length) {
          pendingChatFiles = [];
          setPendingChatFiles(pendingChatFiles);
          renderChatFilePills();
        }
        clearChatComposerAfterSend(input);
        persistSession(thisSessionId);
        renderChatMessages();
        releaseChatSendLock(sendLock);
        forgetLocalMainChatRequest(thisSessionId, clientRequestId);
        return;
      } catch (error) {
        releaseChatSendLock(sendLock);
        forgetLocalMainChatRequest(thisSessionId, clientRequestId);
        showDesktopVoiceStatus('Voice Room message failed', error?.message || String(error), 'error');
        return;
      }
    }
    let streamState = getSessionStreamState(thisSessionId) || resetSessionStreamState(thisSessionId);
    let streamTraceId = '';
    let firstSseByteMarked = false;
    let firstTokenReceivedMarked = false;
    let firstVisibleTokenMarked = false;
    const addProcessEntry = (type, content, extra) => addSessionProcessEntry(thisSessionId, type, content, extra);
    const renderIfViewingThisSession = () => {
      if (!isSessionVisibleInChatSurface(thisSessionId)) return;
      const beforeTextLen = String(document.getElementById('streaming-text-content')?.textContent || '').length;
      if (window.activeChatSessionId === thisSessionId) applyStreamStateToWindow(thisSessionId);
      renderStreamingChatUpdate(thisSessionId);
      const afterTextLen = String(document.getElementById('streaming-text-content')?.textContent || '').length;
      if (!firstVisibleTokenMarked && afterTextLen > beforeTextLen && afterTextLen > 0) {
        firstVisibleTokenMarked = true;
        markChatPerformance('chat_first_visible_token', { traceId: streamTraceId, size: afterTextLen });
      }
      markLiveStreamMotionAfterRender(thisSessionId, beforeTextLen);
    };
    const pushProgressLine = (line) => {
      const txt = String(line || '').trim();
      if (!txt) return;
      streamState.currentProgressThinkingActive = false;
      streamState.currentProgressThinkingText = '';
      const last = streamState.currentProgressLines[streamState.currentProgressLines.length - 1] || '';
      if (last === txt) return;
      streamState.currentProgressLines.push(txt);
      if (streamState.currentProgressLines.length > 8) streamState.currentProgressLines = streamState.currentProgressLines.slice(-8);
      scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
    };
    const appendThinkingProgressChunk = (chunk) => {
      const text = String(chunk || '');
      if (!text) return;
      const lastIdx = streamState.currentProgressLines.length - 1;
      const hasActiveThinkingLine = streamState.currentProgressThinkingActive
        && lastIdx >= 0
        && String(streamState.currentProgressLines[lastIdx] || '').startsWith('Thinking:');
      const nextText = hasActiveThinkingLine
        ? `${streamState.currentProgressThinkingText || ''}${text}`
        : text;
      const thinkLine = `Thinking: ${nextText.replace(/\n/g, ' ')}`;
      streamState.currentProgressThinkingActive = true;
      streamState.currentProgressThinkingText = nextText;
      if (hasActiveThinkingLine) {
        streamState.currentProgressLines[lastIdx] = thinkLine;
      } else {
        streamState.currentProgressLines.push(thinkLine);
        if (streamState.currentProgressLines.length > 8) streamState.currentProgressLines = streamState.currentProgressLines.slice(-8);
      }
      scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
    };
    const appendLiveTrace = (type, text, { append = false, extra = null } = {}) => {
      const content = String(text || '');
      if (!content) return;
      if (isBareThinkingLiveTraceText(content)) return;
      if (!Array.isArray(streamState.liveTraceEntries)) streamState.liveTraceEntries = [];
      const normalizedType = String(type || 'info').toLowerCase();
      const isThoughtLike = isDesktopTraceThoughtType(normalizedType);
      const thoughtKind = isThoughtLike ? desktopTraceThoughtKind({ type: normalizedType, extra }) : '';
      const last = streamState.liveTraceEntries[streamState.liveTraceEntries.length - 1];
      if (append && last && last.type === normalizedType
        && (!isThoughtLike || desktopTraceThoughtKind(last) === thoughtKind)) {
        last.text = `${last.text || ''}${content}`;
        if (extra && typeof extra === 'object') last.extra = { ...(last.extra || {}), ...extra };
      } else {
        const trimmed = content.trim();
        if (!trimmed) return;
        if (last && last.type === normalizedType
          && (!isThoughtLike || desktopTraceThoughtKind(last) === thoughtKind)
          && String(last.text || '').trim() === trimmed) return;
        streamState.liveTraceEntries.push({
          id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: normalizedType,
          text: trimmed,
          ts: new Date().toLocaleTimeString(),
          ...(extra && typeof extra === 'object' ? { extra } : {}),
        });
      }
      scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
    };
    const applyLiveToolActivity = (phase, payload = {}) => {
      if (!Array.isArray(streamState.liveTraceEntries)) streamState.liveTraceEntries = [];
      const entry = applyToolActivityEvent(streamState.liveTraceEntries, phase, payload);
      scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
      return entry;
    };
    const appendCompactionTrace = (status = 'compacting', summary = '', extra = null) => {
      if (!Array.isArray(streamState.liveTraceEntries)) streamState.liveTraceEntries = [];
      const normalizedStatus = String(status || 'compacting').toLowerCase();
      const label = normalizedStatus === 'compacting'
        ? 'Compacting Context'
        : normalizedStatus === 'failed'
          ? 'Context Compaction Failed'
          : normalizedStatus === 'skipped'
            ? 'Context Compaction Skipped'
            : 'Context Compacted';
      const cleanSummary = String(summary || extra?.summary || '').trim();
      const last = streamState.liveTraceEntries[streamState.liveTraceEntries.length - 1];
      const payload = extra && typeof extra === 'object' ? extra : {};
      if (last && String(last.type || '').toLowerCase() === 'compaction') {
        last.text = label;
        last.status = normalizedStatus;
        if (cleanSummary) last.summary = cleanSummary;
        last.extra = { ...(last.extra || {}), ...payload };
      } else {
        streamState.liveTraceEntries.push({
          id: `trace_compact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'compaction',
          text: label,
          status: normalizedStatus,
          summary: cleanSummary,
          extra: payload,
          ts: new Date().toLocaleTimeString(),
        });
      }
      scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
    };
    const moveVisibleAnswerTextIntoWorkflowTrace = () => {
      const text = String(streamState.streamingAIText || '').trim();
      if (!text) return;
      if (isDesktopProgressNarration(text)) {
        setDesktopLiveProgressNarration(streamState, text, appendLiveTrace);
      } else {
        // A tool may start after an assistant paragraph has already streamed.
        // Keep that paragraph as visible, immutable reasoning instead of
        // recategorising it as an internal raw-thought entry.
        appendLiveTrace(sawToolActivityThisTurn ? 'think' : 'preamble', text, {
          extra: { visibility: 'user', source: 'reasoning_summary' },
        });
      }
      streamState.streamingAIText = '';
      streamState.finalResponseStarted = false;
      if (window.activeChatSessionId === thisSessionId) window.streamingAIText = '';
    };
    const movePreToolAnswerTextIntoPreamble = moveVisibleAnswerTextIntoWorkflowTrace;
    const shouldRouteTokenToLiveTrace = () => {
      return false;
    };
    const sessionHistoryRef = thisSession ? (thisSession.history || (thisSession.history = [])) : window.chatHistory;
    if (thisSession && window.activeChatSessionId === thisSessionId) {
      window.chatHistory = sessionHistoryRef;
    }
    const sessionQueue = getSessionQueuedPrompts(thisSessionId);
    if (isSessionThinking(thisSessionId)) {
      if (!queuedTurn && isActiveMainGoalRunning(thisSessionId) && !pendingChatFiles.length) {
        const steered = await steerActiveGoalRunFromComposer(message);
        if (steered) {
          clearChatComposerAfterSend(input);
          releaseChatSendLock(sendLock);
          forgetLocalMainChatRequest(thisSessionId, clientRequestId);
          return;
        }
      }
      if (!queuedTurn && realtimeVoicePendingInterruptContext) {
        const handled = await handleRealtimeVoiceInterruptionOnly(message);
        if (handled) {
          clearChatComposerAfterSend(input);
          releaseChatSendLock(sendLock);
          forgetLocalMainChatRequest(thisSessionId, clientRequestId);
          return;
        }
      }
      if (queuedTurn) {
        if (options.voicePendingTurnId) {
          markVoicePendingTurn(options.voicePendingTurnId, { state: 'queued' });
          renderIfViewingThisSession();
        }
        releaseChatSendLock(sendLock);
        forgetLocalMainChatRequest(thisSessionId, clientRequestId);
        return;
      }
      if (sessionQueue.length >= MAX_QUEUED_PROMPTS) {
        addProcessEntry('warn', `Queue full (${MAX_QUEUED_PROMPTS}). Wait for current run to finish.`);
        releaseChatSendLock(sendLock);
        forgetLocalMainChatRequest(thisSessionId, clientRequestId);
        return;
      }
      const queuedFiles = pendingChatFiles.length ? pendingChatFiles.slice() : [];
      sessionQueue.push(makeQueuedChatTurn(message, queuedFiles, { excludedSkillIds, selectedSkillIds }));
      if (queuedFiles.length) {
        pendingChatFiles = [];
        setPendingChatFiles(pendingChatFiles);
        renderChatFilePills();
      }
      if (window.activeChatSessionId === thisSessionId) window.queuedPrompts = sessionQueue;
      addProcessEntry('info', `Queued prompt #${sessionQueue.length}${queuedFiles.length ? ` with ${queuedFiles.length} file(s)` : ''}. It will run automatically next.`);
      clearChatComposerAfterSend(input);
      updateQueuedPromptUI();
      releaseChatSendLock(sendLock);
      forgetLocalMainChatRequest(thisSessionId, clientRequestId);
      return;
    }
    streamState = resetSessionStreamState(thisSessionId);
    streamState.turnStartedAt = Date.now();
    resetChatContextWindowLiveTurn(thisSessionId);

    // Show the user's message immediately, then do attachment work before the API call.
    let fileContextNote = '';
    let uploadedFileCount = 0;
    let visionAttachments = []; // image attachments to send as vision content
    let uploadedAttachmentPreviews = [];
    const designAttachmentPreview = (normalizeCreativeMode(window.currentCreativeMode) === 'design' || isBrowserDesignMode())
      ? designSelectionToAttachmentPreview()
      : null;
    const highlightedTextAttachmentPreview = highlightedTextToAttachmentPreview();
    const contextualAttachmentPreviews = [designAttachmentPreview, highlightedTextAttachmentPreview].filter(Boolean);
    let filesToUpload = [];
    const queuedFiles = queuedTurn ? queuedTurn.files : [];
    if (queuedFiles.length || (!queuedTurn && pendingChatFiles.length)) {
      filesToUpload = queuedFiles.length ? queuedFiles.slice() : pendingChatFiles.slice();
      uploadedFileCount = filesToUpload.length;
      uploadedAttachmentPreviews = stagedFilesToAttachmentPreviews(filesToUpload);
      uploadedAttachmentPreviews.push(...contextualAttachmentPreviews);
      if (!queuedTurn) {
        pendingChatFiles = [];
        setPendingChatFiles(pendingChatFiles);
        renderChatFilePills();
      }
    } else if (contextualAttachmentPreviews.length) {
      uploadedAttachmentPreviews = contextualAttachmentPreviews.slice();
    }
    let messageWithFiles = message;

    const realtimeAgentDispatch = String(options.voiceSource || '').includes('realtime_agent_dispatch');
    const realtimeAgentChatHandoff = String(options.voiceSource || '').includes('realtime_agent_chat_handoff');
    const realtimeAgentVoiceHandoff = realtimeAgentDispatch || realtimeAgentChatHandoff;
    const reuseExistingUserIndex = Number.isInteger(options.reuseExistingUserIndex)
      ? options.reuseExistingUserIndex
      : (options.voiceAgentHandoff === true ? findRecentVoiceWorkflowUserIndex(sessionHistoryRef, messageWithFiles) : -1);
    const userTurnMessage = reuseExistingUserIndex >= 0 && sessionHistoryRef[reuseExistingUserIndex]?.role === 'user'
      ? sessionHistoryRef[reuseExistingUserIndex]
      : {
          role: 'user',
          content: messageWithFiles,
          attachmentPreviews: uploadedAttachmentPreviews.length ? uploadedAttachmentPreviews : undefined,
        };
    userTurnMessage.content = messageWithFiles;
    userTurnMessage.attachmentPreviews = uploadedAttachmentPreviews.length ? uploadedAttachmentPreviews : undefined;
    userTurnMessage.timestamp = userTurnMessage.timestamp || Date.now();
    if (realtimeAgentVoiceHandoff) {
      userTurnMessage.voiceAgentWorkerHandoff = true;
      userTurnMessage.source = realtimeAgentChatHandoff ? 'realtime_agent_chat_handoff' : 'realtime_agent_dispatch';
      userTurnMessage.channel = 'voice';
      userTurnMessage.channelLabel = realtimeAgentChatHandoff ? 'Voice Agent to Worker' : 'Voice Agent handoff';
    }
    if (reuseExistingUserIndex < 0) sessionHistoryRef.push(userTurnMessage);
    const userTurnIndex = sessionHistoryRef.indexOf(userTurnMessage);
    const userTurnTimestamp = Number(userTurnMessage.timestamp || 0);
    const assistantTurnTimestamp = Number.isFinite(userTurnTimestamp) && userTurnTimestamp > 0
      ? userTurnTimestamp + 1
      : Date.now();
    const appendAssistantTurnForUser = (message) => {
      const shouldAppendAfterInterruption = streamState.forceAppendAssistantAfterInterruption === true;
      const interruptionPresentationCleared = streamState.pendingInterruptionWorkflowPresentationCleared === true;
      const steerWorkflowGroupIds = shouldAppendAfterInterruption ? _chatSteerWorkflowGroupIds(streamState) : [];
      const workStartedAt = Number(message.workStartedAt || streamState.turnStartedAt || assistantTurnTimestamp || Date.now());
      const workEndedAt = Number(message.workEndedAt || Date.now());
      const assistantMessage = {
        ...message,
        role: message.role || 'ai',
        timestamp: Number(message.timestamp || (shouldAppendAfterInterruption ? Date.now() : assistantTurnTimestamp)),
        workStartedAt,
        workEndedAt,
        workDurationMs: Math.max(0, Number(message.workDurationMs ?? (workEndedAt - workStartedAt)) || 0),
      };
      if (shouldAppendAfterInterruption && !interruptionPresentationCleared) {
        assistantMessage.workflowGroupId = assistantMessage.workflowGroupId || streamState.pendingInterruptionWorkflowGroupId || '';
        assistantMessage.workflowPart = assistantMessage.workflowPart || 'interruption_response';
        assistantMessage.workflowLabel = assistantMessage.workflowLabel || streamState.pendingInterruptionWorkflowLabel || 'Response after steer';
      } else if (shouldAppendAfterInterruption) {
        delete assistantMessage.workflowGroupId;
        delete assistantMessage.workflowPart;
        delete assistantMessage.workflowLabel;
        if (String(assistantMessage.messageKind || '') === 'steer_continuation') delete assistantMessage.messageKind;
      }
      const existingIndex = shouldAppendAfterInterruption ? -1 : sessionHistoryRef.findIndex((candidate, idx) => (
        idx > userTurnIndex
        && isAssistantLikeMessage(candidate)
        && String(candidate.content || '').trim() === String(assistantMessage.content || '').trim()
      ));
      if (existingIndex >= 0) {
        sessionHistoryRef[existingIndex] = mergeChatMessageMetadata({ ...assistantMessage }, sessionHistoryRef[existingIndex]);
        if (sessionHistoryRef[existingIndex]?.fileChanges) announceSourcePanelFileChanges(thisSessionId);
        return sessionHistoryRef[existingIndex];
      }
      if (!shouldAppendAfterInterruption && userTurnIndex >= 0 && userTurnIndex < sessionHistoryRef.length - 1) {
        sessionHistoryRef.splice(userTurnIndex + 1, 0, assistantMessage);
      } else {
        sessionHistoryRef.push(assistantMessage);
      }
      if (shouldAppendAfterInterruption) {
        streamState.forceAppendAssistantAfterInterruption = false;
        streamState.pendingInterruptionWorkflowGroupId = '';
        streamState.pendingInterruptionWorkflowLabel = '';
        streamState.pendingInterruptionWorkflowPresentationCleared = false;
        steerWorkflowGroupIds.forEach((groupId) => {
          _collapseChatSteerWorkflowPresentation(thisSessionId, groupId, { persist: false });
        });
        streamState.steerWorkflowGroupIds = [];
        streamState.steerTimerAnchored = false;
        syncSessionHistoryToServerById(thisSessionId, sessionHistoryRef).catch(() => {});
      }
      if (assistantMessage.fileChanges) announceSourcePanelFileChanges(thisSessionId);
      return assistantMessage;
    };
    if (options.voicePendingTurnId) removeVoicePendingTurnInternal(options.voicePendingTurnId);
    if (thisSession) {
      // Set the run state before the first sidebar paint. This keeps the regular
      // list, project tree, and priority rail in lockstep with the composer.
      thisSession.activeRun = true;
      thisSession.unread = false;
    }
    window._sessionThinking[thisSessionId] = true;
    persistSession(thisSessionId);
    desktopChatRuntime(thisSessionId)?.beginStreaming({
      clientRequestId,
      startedAt: Date.now(),
    });
    if (!queuedTurn) {
      clearChatComposerAfterSend(input);
    }
    window.chatMessagesUserScrolledUp = false;
    if (window.activeChatSessionId === thisSessionId) syncActiveSessionRunState();
    if (typeof window.renderSessionsList === 'function') window.renderSessionsList();
    streamState.lastHeartbeat = {
      state: 'running',
      level: '',
      current_step: 'dispatch',
      retry_count: 0,
      format_violation_count: 0,
      message: 'Turn started',
    };
    streamState.lastHeartbeatLogSignature = '';
    window.processLogAutoFollow = true;
    window.rightColumnAutoFollow = true;
    if (window.activeChatSessionId === thisSessionId) {
      applyStreamStateToWindow(thisSessionId);
      if (typeof window.setButtonState === 'function') window.setButtonState(true);
      updateHeartbeatUI();
      renderProgressPanel();
    }
    sendBtn.disabled = false;
    updateQueuedPromptUI();
    renderIfViewingThisSession();
    if (window.activeChatSessionId === thisSessionId) maybeAutoScrollRightColumn(true);

    if (filesToUpload.length) {
      const uploadResults = await uploadStagedFilesToCanvas(filesToUpload);
      fileContextNote = buildFileContextNote(uploadResults);
      uploadedAttachmentPreviews = uploadResultsToAttachmentPreviews(uploadResults);
      uploadedAttachmentPreviews.push(...contextualAttachmentPreviews);
      visionAttachments = uploadResults
        .filter(r => r.isImage && r.base64 && r.mimeType)
        .map(r => ({ type: 'image', base64: r.base64, mimeType: r.mimeType, name: r.name }));
      messageWithFiles = fileContextNote ? message + fileContextNote : message;
      userTurnMessage.content = messageWithFiles;
      userTurnMessage.attachmentPreviews = uploadedAttachmentPreviews.length ? uploadedAttachmentPreviews : undefined;
      persistSession(thisSessionId);
      renderIfViewingThisSession();
    }

    streamState.currentTurnStartIndex = Array.isArray(thisSession?.processLog) ? thisSession.processLog.length : 0;
    if (window.activeChatSessionId === thisSessionId) window.currentTurnStartIndex = streamState.currentTurnStartIndex;
    if (realtimeAgentVoiceHandoff) {
      addProcessEntry('info', `${realtimeAgentChatHandoff ? 'Voice Agent to Worker (current chat)' : 'Voice Agent handoff to Worker'}: ${(uploadedFileCount > 0 ? `${message} [+${uploadedFileCount} file(s)]` : message).slice(0, 900)}`);
    } else {
      addProcessEntry('user', uploadedFileCount > 0 ? `${message} [+${uploadedFileCount} file(s)]` : message);
    }

    let desktopVoiceAgentHandoffContext = '';
    const voiceLatencyTurnStartedAt = options.voiceAgentHandoff === true ? Date.now() : 0;
    let voiceLatencyFirstPreflightLogged = false;
    let voiceLatencyFirstTokenLogged = false;
    if (options.voiceAgentHandoff === true) {
      const voiceHandoff = await prepareDesktopVoiceAgentHandoff(thisSessionId, messageWithFiles, {
        source: options.voiceSource || (options.voicePendingTurnId ? 'desktop_voice_pending' : 'desktop_voice_handoff'),
      });
      desktopVoiceAgentHandoffContext = String(voiceHandoff?.callerContext || '').trim();
      if (!voiceHandoff?.shouldContinueToWorker) {
        const reply = String(voiceHandoff?.result?.voiceReply || '').trim();
        if (reply) {
          const sessionProcessEntries = Array.isArray(thisSession?.processLog)
            ? thisSession.processLog.slice(Math.max(0, Number(streamState.currentTurnStartIndex || 0)))
            : [];
          appendAssistantTurnForUser({
            role: 'ai',
            content: reply,
            processEntries: mergeVoiceAgentProcessEntryLists(sessionProcessEntries, voiceHandoff?.result?.processEntries),
            mode: window.useAgentMode ? 'agentic' : 'chat',
          });
        }
        delete window._sessionThinking[thisSessionId];
        delete window._sessionAbortControllers[thisSessionId];
        if (thisSession) {
          thisSession.activeRun = false;
          thisSession.unread = true;
        }
        if (window.activeChatSessionId === thisSessionId) {
          syncActiveSessionRunState();
          applyStreamStateToWindow(thisSessionId);
          if (typeof window.setButtonState === 'function') window.setButtonState(false);
        }
        persistSession(thisSessionId);
        renderIfViewingThisSession();
        releaseChatSendLock(sendLock);
        forgetLocalMainChatRequest(thisSessionId, clientRequestId);
        return;
      }
    }
    if (voiceLatencyTurnStartedAt) {
      logDesktopVoiceLatency(thisSessionId, 'worker handoff starting', voiceLatencyTurnStartedAt);
    }

    const historyForAPI = sessionHistoryRef.slice(-13, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));
    const combinedCallerContext = buildCombinedCallerContext(messageWithFiles);
    const realtimeInterruptCallerContext = await finalizeRealtimeVoicePlaybackInterruptContext(messageWithFiles);
    const realtimeAgentDispatchContext = realtimeAgentDispatch
      ? [
        '[REALTIME_AGENT_HANDOFF]',
        'This desktop realtime voice turn was already acknowledged by the live realtime voice agent before the worker started.',
        'Do not repeat a generic startup acknowledgement. Continue directly into the requested work.',
        '[/REALTIME_AGENT_HANDOFF]',
      ].join('\n')
      : '';
    const realtimeAgentChatHandoffContext = realtimeAgentChatHandoff
      ? [
        '[VOICE_AGENT_HANDOFF]',
        '[VOICE_AGENT_CHAT_HANDOFF]',
        'The live Voice Agent routed this planning or discussion request to the Prometheus Worker in the current foreground chat.',
        'Respond as a normal chat turn with the full reasoning and tool stream. Do not create or queue a background task for this turn.',
        'Voice milestone mode may narrate meaningful progress, so emit accurate progress and finish with a complete answer for the Voice Agent to summarize.',
        '[/VOICE_AGENT_CHAT_HANDOFF]',
        '[/VOICE_AGENT_HANDOFF]',
      ].join('\n')
      : '';
    const turnCallerContext = [combinedCallerContext, realtimeInterruptCallerContext, desktopVoiceAgentHandoffContext, realtimeAgentDispatchContext, realtimeAgentChatHandoffContext].filter(Boolean).join('\n\n') || undefined;
    if (designMultiSelectedElements.length) clearDesignMultiSelection();

		  const allSteps = [];
		  let finalReply = '';
		  let finalArtifacts = [];
		  let finalFileChanges = null;
		  let finalProductCarousel = null;
		  let finalRichArtifacts = null;
		  let finalGoalCompletionReport = null;
		  const canvasPresentedFiles = []; // file paths presented to canvas this turn
		  const turnGeneratedImages = [];
		  const turnGeneratedImageKeys = new Set();
		  const turnGeneratedVideos = [];
		  const turnGeneratedVideoKeys = new Set();
		  const turnThinkingBuffer = [];
		  const turnThinkingSeen = new Set();
		  let pendingThinkingBurst = '';
		  let sawToolActivityThisTurn = false;
		  const getTurnEntries = () => {
		    const log = Array.isArray(thisSession?.processLog) ? thisSession.processLog : [];
		    const startIndex = Number.isFinite(Number(streamState.currentTurnStartIndex)) ? Number(streamState.currentTurnStartIndex) : -1;
		    return startIndex >= 0 ? log.slice(startIndex) : [];
		  };
		  const collectTurnThinking = (value) => {
	    const text = String(value || '').trim();
	    if (!text) return;
	    const key = text.replace(/\s+/g, ' ').trim();
	    if (!key || turnThinkingSeen.has(key)) return;
	    turnThinkingSeen.add(key);
	    turnThinkingBuffer.push(text);
	  };
	  const logThinkingToProcess = (value) => {
	    const text = String(value || '').trim();
	    if (!text) return;
	    const key = text.replace(/\s+/g, ' ').trim();
		    const turnEntries = getTurnEntries();
	    const alreadyLogged = turnEntries.some((entry) => {
	      if (entry?.type !== 'think') return false;
	      return String(entry.content || '').replace(/\s+/g, ' ').trim() === key;
	    });
	    if (!alreadyLogged) addProcessEntry('think', text);
	  };
	  const flushPendingThinkingBurst = () => {
	    const text = String(pendingThinkingBurst || '').trim();
	    if (!text) return '';
	    pendingThinkingBurst = '';
	    collectTurnThinking(text);
	    return text;
	  };
		  const persistTurnThinkingToProcess = () => {
		    flushPendingThinkingBurst();
			    const mergedThinking = (streamState.streamingThinkingText || turnThinkingBuffer.join('\n\n')).trim();
		    if (!mergedThinking) return mergedThinking;
		    const turnEntries = getTurnEntries();
	    const alreadyLogged = turnEntries.some((entry) => entry?.type === 'think');
		    if (!alreadyLogged) logThinkingToProcess(mergedThinking);
		    return mergedThinking;
		  };
		  const collectTurnGeneratedImage = (value) => {
		    const image = normalizeGeneratedImageEntry(value);
		    if (!image) return;
		    const key = image.absPath || image.relPath || image.previewPath || image.fileName;
		    if (!key || turnGeneratedImageKeys.has(key)) return;
		    turnGeneratedImageKeys.add(key);
		    turnGeneratedImages.push(image);
		  };
		  const collectTurnGeneratedVideo = (value) => {
		    const video = normalizeGeneratedVideoEntry(value);
		    if (!video) return;
		    const key = video.absPath || video.relPath || video.previewPath || video.fileName;
		    if (!key || turnGeneratedVideoKeys.has(key)) return;
		    turnGeneratedVideoKeys.add(key);
		    turnGeneratedVideos.push(video);
		  };
		  const getDeclaredPlanActiveIndex = () => {
		    const progress = streamState.runtimeProgressState || {};
		    if (String(progress.source || 'none') !== 'declared') return -1;
		    const items = Array.isArray(progress.items) ? progress.items : [];
		    if (items.length < 2) return -1;
		    const activeIndex = Number(progress.activeIndex);
		    if (Number.isFinite(activeIndex) && activeIndex >= 0) return activeIndex;
		    return items.findIndex((item) => {
		      const status = String(item?.status || '').toLowerCase();
		      return status === 'pending' || status === 'in_progress';
		    });
		  };
		  const syncDeclaredPlanToolCounter = () => {
		    const activeIndex = getDeclaredPlanActiveIndex();
		    if (activeIndex < 0) {
		      streamState.declaredPlanToolCounter = 0;
		      streamState.declaredPlanToolActiveIndex = -1;
		      streamState.declaredPlanToolPrefixes = {};
		      return false;
		    }
		    if (streamState.declaredPlanToolActiveIndex !== activeIndex) {
		      streamState.declaredPlanToolCounter = 0;
		      streamState.declaredPlanToolActiveIndex = activeIndex;
		      streamState.declaredPlanToolPrefixes = {};
		    }
		    if (!streamState.declaredPlanToolPrefixes || typeof streamState.declaredPlanToolPrefixes !== 'object') {
		      streamState.declaredPlanToolPrefixes = {};
		    }
		    return true;
		  };
		  const nextDeclaredPlanToolPrefix = (eventStepNum) => {
		    if (!syncDeclaredPlanToolCounter()) return '';
		    streamState.declaredPlanToolCounter = Number(streamState.declaredPlanToolCounter || 0) + 1;
		    const prefix = `Step ${streamState.declaredPlanToolCounter}: `;
		    const key = String(Number(eventStepNum || 0) || '');
		    if (key) streamState.declaredPlanToolPrefixes[key] = prefix;
		    return prefix;
		  };
		  const getDeclaredPlanToolPrefix = (eventStepNum) => {
		    const key = String(Number(eventStepNum || 0) || '');
		    if (key && streamState.declaredPlanToolPrefixes && streamState.declaredPlanToolPrefixes[key]) {
		      return streamState.declaredPlanToolPrefixes[key];
		    }
		    return '';
		  };

	  let partialContent = '';
	  let turnAbortController = null;
	  let sawTerminalStreamEvent = false;
	  let sawFinalStreamEvent = false;
	  let desktopStreamRecoveryPending = false;
	  let interruptedTurnSaved = false;
		  const saveInterruptedAssistantTurn = () => {
		    if (interruptedTurnSaved) return;
		    interruptedTurnSaved = true;
		    const isEditRerunReset = window._editRerunAbortResetSessions?.has?.(thisSessionId);
		    if (isEditRerunReset) return;
		    const lastAssistant = sessionHistoryRef[sessionHistoryRef.length - 1];
		    if (lastAssistant && isAssistantLikeMessage(lastAssistant) && /^\[(?:Stopped by user|Generation stopped)\]/i.test(String(lastAssistant.content || '').trim())) {
		      return;
		    }
		    const alreadyLogged = getTurnEntries().some((entry) => (
		      String(entry?.type || '').toLowerCase() === 'warn'
		      && /generation stopped by user/i.test(String(entry?.content || ''))
		    ));
		    if (!alreadyLogged) addProcessEntry('warn', 'Generation stopped by user. Process log preserved.');
		    const turnEntries = getTurnEntries();
		    const streamedText = String(streamState.streamingAIText || partialContent || '').trim();
		    const streamedThinking = String(streamState.streamingThinkingText || '').trim();
		    const content = partialContent ||
		      (streamedText
		        ? `[Stopped by user]\n\n${streamedText}`
		        : allSteps.length
		          ? `[Stopped by user]\n\nStopped after ${allSteps.length} step${allSteps.length !== 1 ? 's' : ''}. Process log preserved.`
		          : streamedThinking
		            ? '[Stopped by user while thinking. Process log preserved.]'
		            : '[Generation stopped by user. Process log preserved.]');
		    appendAssistantTurnForUser({
		      role: 'ai',
                content,
                steps: allSteps,
                artifacts: finalArtifacts.length ? [...finalArtifacts] : undefined,
                fileChanges: mergeFileChangesWithBackground(finalFileChanges, thisSessionId) || undefined,
                productCarousel: finalProductCarousel || undefined,
                richArtifacts: (Array.isArray(finalRichArtifacts) && finalRichArtifacts.length) ? [...finalRichArtifacts] : undefined,
                goalCompletionReport: finalGoalCompletionReport || undefined,
                canvasFiles: canvasPresentedFiles.length ? [...canvasPresentedFiles] : undefined,
                generatedImages: turnGeneratedImages.length ? [...turnGeneratedImages] : undefined,
                generatedVideos: turnGeneratedVideos.length ? [...turnGeneratedVideos] : undefined,
		      mode: window.useAgentMode ? 'agentic' : 'chat',
		      thinking: streamedThinking || undefined,
		      processEntries: mergeLiveTraceProcessEntries(streamState.liveTraceEntries, turnEntries),
		      liveTraceEntries: Array.isArray(streamState.liveTraceEntries) ? streamState.liveTraceEntries.slice() : undefined,
		    });
		  };
	  if (thisSession) thisSession.activeRun = true;
	  delete window._desktopPageLifecycleDisconnectedSessions?.[thisSessionId];
	  rememberDesktopActiveChatRun(thisSessionId, {
	    clientRequestId,
	    startedAt: Number(readDesktopActiveChatRun(thisSessionId)?.startedAt || Date.now()),
	    disconnected: false,
	    finalReceived: false,
	    forcePersist: true,
	  });
	  persistSession(thisSessionId);
	  try {
	    // Use SSE fetch — stream steps live as they arrive
		    turnAbortController = new AbortController();
		    window._sessionAbortControllers[thisSessionId] = turnAbortController;
		    if (window.activeChatSessionId === thisSessionId) {
              currentAbortController = turnAbortController;
              setCurrentAbortController(currentAbortController);
            }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
	      signal: turnAbortController.signal,
	      body: JSON.stringify({ message: messageWithFiles, history: historyForAPI, useTools: window.useAgentMode, sessionId: thisSessionId, clientRequestId, attachments: visionAttachments.length > 0 ? visionAttachments : undefined, attachmentPreviews: uploadedAttachmentPreviews.length ? uploadedAttachmentPreviews.map(sanitizeAttachmentPreviewForDurableStorage) : undefined, reasoning: buildReasoningPayload(), callerContext: turnCallerContext, excludedSkillIds: excludedSkillIds.length ? excludedSkillIds : undefined, selectedSkillIds: selectedSkillIds.length ? selectedSkillIds : undefined, origin: { channel: 'web', surface: 'desktop_app', device: 'computer', label: 'Desktop app', source: 'chat_page' } })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      streamTraceId = String(res.headers.get('x-prometheus-trace-id') || '').trim().slice(0, 160);
      markChatPerformance('chat_request_accepted', { traceId: streamTraceId });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!firstSseByteMarked && value?.byteLength) {
          firstSseByteMarked = true;
          markChatPerformance('chat_sse_first_byte', { traceId: streamTraceId, bytes: value.byteLength });
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

	      for (const line of lines) {
	        if (!line.startsWith('data: ')) continue;
	        let event;
	        try { event = JSON.parse(line.slice(6)); } catch { continue; }
	        if (!streamTraceId && event.traceId) streamTraceId = String(event.traceId).trim().slice(0, 160);
	        if (event.type === 'latency_mark' && event.stage) {
	          markChatPerformance(`chat_latency_${event.stage}`, {
	            traceId: streamTraceId,
	            elapsedMs: event.elapsedMs,
	          });
	        }
	        const eventSeq = Number(event.seq);
	        const eventStreamId = String(event.streamId || '').trim();
	        if (Number.isFinite(eventSeq)) {
	          if (!shouldProcessMainChatStreamEvent({ sessionId: thisSessionId, streamId: eventStreamId, seq: eventSeq })) continue;
	          const runPatch = { lastSeq: eventSeq, disconnected: false };
	          if (eventStreamId) runPatch.streamId = eventStreamId;
	          if (event.runtimeId) runPatch.runtimeId = String(event.runtimeId);
	          if (event.clientRequestId) runPatch.clientRequestId = String(event.clientRequestId);
	          rememberDesktopActiveChatRun(thisSessionId, runPatch);
	        }
	        if (event.type === 'final') sawFinalStreamEvent = true;
	        if (event.type === 'done' || event.type === 'error') sawTerminalStreamEvent = true;
	        if (event.type === 'done' || event.type === 'error') {
	          markChatPerformance(`chat_${event.type}`, { traceId: streamTraceId });
	        }
          if (event.type === 'tool_call' || event.type === 'tool_progress' || event.type === 'tool_result') {
            const toolTelemetry = event.telemetry && typeof event.telemetry === 'object' ? event.telemetry : {};
            const toolDetails = {
              traceId: streamTraceId,
              telemetryId: event.telemetryId || toolTelemetry.telemetryId,
              toolCallId: event.toolCallId || event.tool_call_id || toolTelemetry.toolCallId,
              toolFamily: toolTelemetry.toolFamily,
              toolName: event.action || toolTelemetry.toolName,
              eventCount: toolTelemetry.eventCount,
              resultBytes: toolTelemetry.resultBytes,
              resultTokens: toolTelemetry.resultTokens,
              dispatchMs: toolTelemetry.dispatchMs,
              executorMs: toolTelemetry.executorMs,
              firstOutputMs: toolTelemetry.firstOutputMs,
              resultToModelMs: toolTelemetry.resultToModelMs,
              modelToVisibleMs: toolTelemetry.modelToVisibleMs,
              toolWallMs: toolTelemetry.toolWallMs,
              transportMs: toolTelemetry.transportMs,
            };
            markChatPerformance(`chat_${event.type}_received`, toolDetails);
            if (event.type === 'tool_result' && isSessionVisibleInChatSurface(thisSessionId)) {
              requestAnimationFrame(() => markChatPerformance('chat_tool_result_visible', toolDetails));
            }
          }
          const activeBeforeStreamEvent = window.activeChatSessionId;
	        const isReasoningCompanionEvent =
	          event.type === 'model_stream_event'
	          && /^reasoning_/i.test(String(event.event?.type || ''));
	        if (event.type !== 'thinking_delta' && !isReasoningCompanionEvent) flushPendingThinkingBurst();

	        switch (event.type) {
	          case 'final_response_start':
	            beginFinalResponse(streamState);
	            _settlePendingChatSteerPresentation(thisSessionId, streamState);
	            scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
	            break;
            case 'agent_mode':
              window.lastAgentMode = event.mode || '-';
              window.lastTurnKind = event.turnKind || window.lastTurnKind;
              streamState.agentExecutionMode = String(event.mode || streamState.agentExecutionMode || '').trim();
              if (event.mode === 'execute') {
                movePreToolAnswerTextIntoPreamble();
              }
              addProcessEntry(
                'info',
                `Agent mode: ${event.mode || 'unknown'}${event.turnKind ? ` (${event.turnKind})` : ''}${event.switched_from ? ` | switched_from=${event.switched_from}` : ''}${event.route_target ? ` | route_target=${event.route_target}` : ''}${event.trigger ? ` | trigger=${event.trigger}` : ''}`
              );
              break;

            case 'session_mode_locked':
              addProcessEntry('info', `Session mode locked: ${event.mode || 'unknown'}`);
              break;

            case 'coding_context_packet': {
              const status = String(event.status || 'omitted');
              const reason = String(event.reason || 'unknown');
              const age = Number.isFinite(Number(event.ageMs)) ? `, age ${Math.round(Number(event.ageMs) / 1000)}s` : '';
              window.lastCodingContextPacketDecision = { ...event, receivedAt: Date.now() };
              if (status !== 'omitted' || event.taskId) {
                addProcessEntry('info', `Code context: ${status} (${reason}${age})`, { action: 'coding_context_packet', ...event });
              }
              break;
            }

            case 'creative_mode': {
              const sid = String(event.sessionId || thisSessionId || '').trim();
              if (normalizeCreativeMode(event.creativeMode)) await ensureCreativeFeatureRuntime();
              applySessionCreativeMode(sid, event.creativeMode, { resetScene: event.resetScene === true });
              const meta = getCreativeModeMeta(event.creativeMode);
              addProcessEntry('info', meta ? `${meta.title} workspace selected.` : 'Creative workspace closed.');
              break;
            }

            case 'decomposed':
              addProcessEntry('split', `Split into ${event.questions.length} sub-questions: ${event.questions.map((q,i) => `Q${i+1}: ${q.slice(0,40)}`).join(' | ')}`);
              break;

            case 'token': {
              const chunk = String(event.text || '');
              if (chunk) {
                if (!firstTokenReceivedMarked) {
                  firstTokenReceivedMarked = true;
                  markChatPerformance('chat_first_token_received', { traceId: streamTraceId, size: chunk.length });
                }
                if (voiceLatencyTurnStartedAt && !voiceLatencyFirstTokenLogged) {
                  voiceLatencyFirstTokenLogged = true;
                  logDesktopVoiceLatency(thisSessionId, 'worker first token', voiceLatencyTurnStartedAt, { textLen: chunk.length });
	              }
	              beginFinalResponse(streamState);
	              _settlePendingChatSteerPresentation(thisSessionId, streamState);
	              streamState.streamingAIText = appendFinalResponseDelta(streamState.streamingAIText, chunk);
                desktopChatRuntime(thisSessionId)?.appendStreamDelta(chunk, { clientRequestId, allowStart: true });
                syncStreamingVisualActivity(streamState, streamState.streamingAIText, applyLiveToolActivity);
                if (window.activeChatSessionId === thisSessionId) window.streamingAIText = streamState.streamingAIText;
                scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
              }
              break;
            }

	          case 'thinking_delta': {
	            const chunk = String(event.thinking || event.text || '');
	            if (chunk) {
                const isSummary = chatProgressVisibility(event) === 'summary';
                if (!isSummary) {
                  pendingThinkingBurst += chunk;
                  streamState.streamingThinkingText = (streamState.streamingThinkingText || '') + chunk;
                  if (window.activeChatSessionId === thisSessionId) window.streamingThinkingText = streamState.streamingThinkingText;
                }
                if (isSummary) {
                  // reasoning_summary is already an explicit user-safe progress channel.
                  // Treat every transport delta as part of the single replaceable status slot;
                  // classifying individual chunks leaks markdown/token boundaries into the UI.
                  setDesktopLiveProgressNarration(streamState, chunk, appendLiveTrace);
	              }
	            }
	            break;
	          }

	          case 'reasoning_summary_delta': {
	            const chunk = String(event.text || event.summary || '');
	            if (chunk) {
                // reasoning_summary is already an explicit user-safe progress channel.
                // Treat every transport delta as part of the single replaceable status slot;
                // classifying individual chunks leaks markdown/token boundaries into the UI.
                setDesktopLiveProgressNarration(streamState, chunk, appendLiveTrace);
	            }
	            break;
	          }

	          case 'agent_thought': {
	            const thoughtText = String(event.thinking || event.text || '').trim();
	            const visibility = chatProgressVisibility(event);
	            if (thoughtText && visibility !== 'private') {
	              if (isDesktopSummaryThoughtEvent(event)) {
	                setDesktopLiveProgressNarration(streamState, thoughtText, appendLiveTrace, { replace: true, visibility: 'summary' });
	              } else {
	                collectTurnThinking(thoughtText);
	                appendDesktopDurableThought(streamState, thoughtText, appendLiveTrace, event);
	              }
	            }
	            break;
	          }

	          case 'thinking':
	            if (event.thinking && String(event.thinking).trim() && chatProgressVisibility(event) !== 'private') {
	              const thinkingText = String(event.thinking).trim();
	              if (isDesktopSummaryThoughtEvent(event)) {
	                setDesktopLiveProgressNarration(streamState, thinkingText, appendLiveTrace, { replace: true, visibility: 'summary' });
	              } else {
	                collectTurnThinking(thinkingText);
	                appendDesktopDurableThought(streamState, thinkingText, appendLiveTrace, event);
	              }
              }
              break;

            case 'model_stream_event': {
              const modelEvent = event.event && typeof event.event === 'object' ? event.event : {};
              const modelType = String(modelEvent.type || '').trim();
              if (modelType === 'tool_call_start') {
                movePreToolAnswerTextIntoPreamble();
                sawToolActivityThisTurn = true;
                applyLiveToolActivity('prepare', { ...modelEvent, action: modelEvent.name });
              } else if (modelType === 'tool_call_delta') {
                // Arguments can stream token-by-token; keep the UI calm and let the
                // final normalized tool event show the complete call.
              } else if (modelType === 'tool_call_done') {
                sawToolActivityThisTurn = true;
                applyLiveToolActivity('prepared', { ...modelEvent, action: modelEvent.name });
              }
              break;
            }

            case 'info': {
              if (event.message) {
                const msg = String(event.message);
                addProcessEntry('info', msg, event.actor ? { actor: event.actor } : undefined);
              }
              break;
            }

            case 'resources_changed': {
              const resourceSessionId = String(event.sessionId || thisSessionId || '').trim();
              if (!resourceSessionId || resourceSessionId === thisSessionId) {
                scheduleChatResourcesReload(thisSessionId, 0);
              }
              break;
            }

            case 'voice_milestone': {
              const text = String(event.text || '').trim();
              if (text) {
                if (isDesktopVoiceNarrationActive()) {
                  addProcessEntry('info', `Voice milestone: ${text}`, event.tool ? { actor: 'Voice Narrator', tool: event.tool } : { actor: 'Voice Narrator' });
                }
                speakVoiceMilestone(text, { force: event.stage === 'start', minGapMs: Number(event.minGapMs ?? 2500) || 2500 });
              }
              break;
            }

	          case 'heartbeat': {
		            streamState.lastHeartbeat = {
		              ...streamState.lastHeartbeat,
	              state: event.state || streamState.lastHeartbeat.state,
	              level: event.level || streamState.lastHeartbeat.level,
	              current_step: event.current_step || streamState.lastHeartbeat.current_step,
	              retry_count: Number(event.retry_count || streamState.lastHeartbeat.retry_count || 0),
	              format_violation_count: Number(event.format_violation_count || streamState.lastHeartbeat.format_violation_count || 0),
	              message: event.message || streamState.lastHeartbeat.message || '',
	            };
	            if (window.activeChatSessionId === thisSessionId) {
	              window.lastHeartbeat = streamState.lastHeartbeat;
	              updateHeartbeatUI();
	            }
	            const sig = `${streamState.lastHeartbeat.state}|${streamState.lastHeartbeat.level}|${streamState.lastHeartbeat.current_step}|${streamState.lastHeartbeat.retry_count}|${streamState.lastHeartbeat.format_violation_count}`;
	            if (sig !== streamState.lastHeartbeatLogSignature) {
	              const level = String(streamState.lastHeartbeat.level || '').toLowerCase();
	              const text = String(streamState.lastHeartbeat.message || `state=${streamState.lastHeartbeat.state} step=${streamState.lastHeartbeat.current_step}`).trim();
	              addProcessEntry(level === 'hard' ? 'warn' : 'info', `Heartbeat: ${text}`);
	              streamState.lastHeartbeatLogSignature = sig;
	            }
	            break;
	          }

            case 'ui_preflight':
              if (event.message) {
                streamState.currentPreflightStatus = String(event.message);
                pushProgressLine(streamState.currentPreflightStatus);
                if (voiceLatencyTurnStartedAt && !voiceLatencyFirstPreflightLogged) {
                  voiceLatencyFirstPreflightLogged = true;
                  logDesktopVoiceLatency(thisSessionId, 'worker first preflight', voiceLatencyTurnStartedAt, { message: String(event.message) });
                }
                renderIfViewingThisSession();
              }
              break;

            case 'tool_call': {
              const action = String(event.action || '').trim();
              const stepNum = Number(event.stepNum || 0);
              const stepPrefix = nextDeclaredPlanToolPrefix(stepNum);
              const args = (event.args && typeof event.args === 'object') ? event.args : null;
              const displayAction = formatToolCallForLog(action, args, streamState);
              const syntheticTag = event.synthetic ? ' [synthetic]' : '';
              movePreToolAnswerTextIntoPreamble();
              if (action === 'context_compaction') {
                pushProgressLine('Compacting thread context...');
                appendCompactionTrace('compacting', '', args || event);
                addProcessEntry(
                  'tool',
                  `${stepPrefix}Compacting thread context...${syntheticTag}`,
                  { action, ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) },
                );
                break;
              }
              sawToolActivityThisTurn = true;
              const isSkillTool = action === 'skill_list' || action === 'skill_read' || action === 'skill_resource_list' || action === 'skill_resource_read' || action === 'skill_create';
              const isBackgroundAgentTool = action.startsWith('background_');
              if (isSkillTool) {
                pushProgressLine(`${stepPrefix}${displayAction}`);
                applyLiveToolActivity('call', event);
                addProcessEntry('skill', `${stepPrefix}${displayAction}${syntheticTag}`, { action, args: args || {}, ...(event.actor ? { actor: event.actor } : {}) });
              } else if (isBackgroundAgentTool) {
                pushProgressLine(`${stepPrefix}${displayAction}`);
                applyLiveToolActivity('call', event);
                addProcessEntry(
                  'tool',
                  `${stepPrefix}${displayAction}${syntheticTag}`,
                  { action, args: args || {}, ...(args || {}), actor: event.actor || 'Background Agent' },
                );
              } else {
                if (action) pushProgressLine(`${stepPrefix}${displayAction}`);
                if (action) applyLiveToolActivity('call', event);
                if (action) {
                  addProcessEntry(
                    'tool',
                    `${stepPrefix}${displayAction}${syntheticTag}`,
                    { action, args: args || {}, ...(args || {}), ...(event.actor ? { actor: event.actor } : {}) },
                  );
                  scheduleChatContextWindowRefresh(650);
                }
              }
              break;
            }

            case 'tool_result': {
              const action = String(event.action || '').trim();
              const stepNum = Number(event.stepNum || 0);
              const stepPrefix = getDeclaredPlanToolPrefix(stepNum);
              movePreToolAnswerTextIntoPreamble();
              const text = String(event.result || '');
	            const ok = event.ok !== false && event.success !== false && !event.error;
	            const syntheticTag = event.synthetic ? ' [synthetic]' : '';
	            const isBackgroundAgentTool = action.startsWith('background_');
	            const extraData = (event.extra && typeof event.extra === 'object') ? { ...event.extra } : {};
	            if (action === 'generate_image' && ok) {
	              if (Array.isArray(event?.extra?.generated_images)) {
	                event.extra.generated_images.forEach((image) => collectTurnGeneratedImage(image));
	              } else if (event?.extra?.generated_image) {
	                collectTurnGeneratedImage(event.extra.generated_image);
	              }
	            }
	            if (action === 'generate_video' && ok) {
	              if (Array.isArray(event?.extra?.generated_videos)) {
	                event.extra.generated_videos.forEach((video) => collectTurnGeneratedVideo(video));
	              } else if (event?.extra?.generated_video) {
	                collectTurnGeneratedVideo(event.extra.generated_video);
	              }
	            }
	            if (event.actor || isBackgroundAgentTool) extraData.actor = event.actor || 'Background Agent';
	            const extraPayload = Object.keys(extraData).length ? extraData : undefined;
              if (action === 'context_compaction') {
                const status = String(event?.extra?.status || '').toLowerCase();
                const mode = String(event?.extra?.mode || '').trim();
                const baseResultText = ok
                  ? (status === 'skipped'
                    ? 'Thread compaction skipped (continuing with normal flow).'
                    : `Thread compacted${mode ? ` (${mode})` : ''}.`)
                  : `Thread compaction failed: ${text || '(no output)'}`;
                const displayResultText = String(text || '').trim() || baseResultText;
                pushProgressLine(status === 'skipped' ? 'Thread compaction skipped' : (ok ? 'Thread compacted' : 'Thread compaction failed'));
                appendCompactionTrace(status || (ok ? 'compacted' : 'failed'), extraData.summary || '', extraData);
                addProcessEntry(
                  ok ? 'result' : 'error',
                  `${stepPrefix}${displayResultText}${syntheticTag}`,
                  { action, ...(extraPayload || {}) },
                );
                break;
              }
              sawToolActivityThisTurn = true;
              const resultDisplay = formatToolResultForLog(action, text, ok, streamState, event.args || {});
              if (action) pushProgressLine(`${stepPrefix}${formatToolCallForLog(action, {}, streamState).replace(/\.\.\.$/, '')} ${ok ? 'complete' : 'failed'}`);
              if (action) applyLiveToolActivity('result', event);
              if (isBackgroundAgentTool) {
                try {
                  const parsed = JSON.parse(text);
                  const state = String(parsed?.state || '').trim();
                  if (state) pushProgressLine(`Background Agent: ${state}`);
                } catch {}
              }
              addProcessEntry(
                ok ? 'result' : 'error',
                `${stepPrefix}${resultDisplay}${syntheticTag}`,
                { action, args: event.args || {}, error: !ok, durationMs: event.durationMs ?? event.elapsedMs, ...(extraPayload || {}) },
              );
              recordChatContextWindowToolResult(event, thisSessionId);
              if (ok && shouldRefreshChatResourcesForAction(action)) {
                scheduleChatResourcesReload(thisSessionId, 180);
              }
              break;
            }

            case 'tool_progress': {
              const action = String(event.action || '').trim();
              const message = String(event.message || '').trim();
              if (action && message) {
                movePreToolAnswerTextIntoPreamble();
                sawToolActivityThisTurn = true;
                const progressText = formatToolProgressForLog(action, message);
                pushProgressLine(progressText);
                applyLiveToolActivity('progress', event);
                addProcessEntry('info', progressText, event.actor ? { actor: event.actor } : undefined);
              }
              break;
            }

            case 'vision_injected': {
              const preview = event.preview && typeof event.preview === 'object' ? event.preview : {};
              const dataUrl = String(preview.dataUrl || event.dataUrl || '').trim();
              if (isRenderableLiveTraceImageSource(dataUrl)) {
                movePreToolAnswerTextIntoPreamble();
                sawToolActivityThisTurn = true;
                const sourceValue = String(event.source || '').toLowerCase();
                const source = sourceValue === 'browser' ? 'Browser' : sourceValue === 'media_analysis' ? 'Media analysis' : sourceValue === 'generated_image' ? 'Generated image' : 'Desktop';
                const tool = String(event.tool || event.action || '').trim();
                const toolLabel = tool ? formatToolCallForLog(tool, {}, streamState).replace(/\.\.\.$/, '') : `${source} observation`;
                const text = String(event.label || `Vision injected: ${toolLabel}`).trim();
                if (sourceValue === 'generated_image' && Array.isArray(streamState.liveTraceEntries)) {
                  const incomingPreviewId = String(preview.previewId || '').trim();
                  const incomingGenerationId = String(preview.generationId || '').trim();
                  const incomingWorkspacePath = String(preview.workspacePath || '').trim();
                  const incomingCacheKey = String(preview.cacheKey || '').trim();
                  const priorIndex = streamState.liveTraceEntries.findIndex((entry) =>
                    entry?.type === 'vision'
                    && String(entry?.preview?.artifactKind || '') === 'generated_image_partial'
                    && (
                      (!!incomingPreviewId && String(entry?.preview?.previewId || '') === incomingPreviewId)
                      || (!!incomingGenerationId && String(entry?.preview?.generationId || '') === incomingGenerationId)
                      || (!incomingPreviewId && !incomingGenerationId && !!incomingWorkspacePath && String(entry?.preview?.workspacePath || '') === incomingWorkspacePath)
                      || (!incomingPreviewId && !incomingGenerationId && !!incomingCacheKey && String(entry?.preview?.cacheKey || '') === incomingCacheKey)
                    )
                  );
                  if (priorIndex >= 0) streamState.liveTraceEntries.splice(priorIndex, 1);
                }
                const last = Array.isArray(streamState.liveTraceEntries) ? streamState.liveTraceEntries[streamState.liveTraceEntries.length - 1] : null;
                const samePreview = last
                  && last.type === 'vision'
                  && String(last.text || '') === text
                  && String(last?.preview?.dataUrl || '') === dataUrl;
                if (!samePreview) {
                  appendLiveTrace('vision', text);
                  const added = streamState.liveTraceEntries[streamState.liveTraceEntries.length - 1];
                  if (added) {
                    added.preview = preview;
                    added.previewTitle = String(event.previewTitle || preview.title || `${source} preview`);
                  }
                }
                renderIfViewingThisSession();
              }
              break;
            }

	          case 'progress_state': {
	            const previousPlanActiveIndex = Number(streamState.declaredPlanToolActiveIndex ?? -1);
	            streamState.runtimeProgressState = normalizeDeclaredRuntimeProgressState({
	              source: String(event.source || 'none'),
	              activeIndex: Number(event.activeIndex || -1),
	              items: Array.isArray(event.items) ? event.items.map((item, idx) => ({
                  id: String(item.id || `p${idx + 1}`),
                  text: String(item.text || '').slice(0, 120),
	                status: String(item.status || 'pending'),
	              })) : [],
	            });
	            const nextPlanActiveIndex = getDeclaredPlanActiveIndex();
	            if (nextPlanActiveIndex < 0 || nextPlanActiveIndex !== previousPlanActiveIndex) {
	              if (previousPlanActiveIndex >= 0 && nextPlanActiveIndex !== previousPlanActiveIndex) {
	                streamState.lastCompletedDeclaredPlanIndex = previousPlanActiveIndex;
	              }
	              streamState.declaredPlanToolCounter = 0;
	              streamState.declaredPlanToolActiveIndex = nextPlanActiveIndex;
	            }
	            if (thisSession) thisSession.progressState = streamState.runtimeProgressState;
	            if (window.activeChatSessionId === thisSessionId) {
	              window.runtimeProgressState = streamState.runtimeProgressState;
	              renderProgressPanel();
	            }
	            persistSession(thisSessionId);
	            scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
	            break;
	          }

            case 'browser_advisor_start': {
              const pageType = event.page_type ? ` type=${event.page_type}` : '';
              const count = Number.isFinite(Number(event.extracted_count)) ? ` | extracted=${event.extracted_count}` : '';
              addProcessEntry('info', `Browser advisor start:${pageType}${count}`);
              break;
            }

            case 'feed_collected': {
              const b = Number(event.batch || 0);
              const added = Number(event.added || 0);
              const total = Number(event.total || 0);
              const deduped = Number(event.deduped || 0);
              addProcessEntry('info', `Feed collected: batch ${b} | +${added} | total ${total} | deduped ${deduped}`);
              break;
            }

            case 'browser_advisor_route': {
              const route = String(event.route || 'unknown');
              const reason = event.reason ? ` | ${String(event.reason)}` : '';
              const cap = (Number.isFinite(Number(event.assist_count)) && Number.isFinite(Number(event.assist_cap)))
                ? ` | assists ${event.assist_count}/${event.assist_cap}`
                : '';
              const nextTool = event.next_tool?.tool ? ` | next=${event.next_tool.tool}` : '';
              addProcessEntry('info', `Browser advisor route=${route}${nextTool}${reason}${cap}`, event);
              const rawResponse = String(event.raw_response || '').trim();
              if (rawResponse) {
                addProcessEntry('think', `[Secondary AI browser advisor raw response]\n${rawResponse}`);
              }
              break;
            }

            case 'browser_advisor_nudge': {
              const route = event.route ? `[${event.route}] ` : '';
              const preview = String(event.preview || '').trim();
              if (preview) addProcessEntry('info', `Advisor nudge ${route}${preview}`);
              break;
            }

            case 'forced_retry': {
              const reason = String(event.reason || 'advisor requested continuation');
              const retry = Number(event.retry || 0);
              const max = Number(event.max_retries || 0);
              addProcessEntry('warn', `Forced retry ${retry}/${max}: ${reason}`);
              break;
            }

            case 'preempt_start': {
              const elapsedSec = Math.max(1, Math.round(Number(event.elapsed_ms || 0) / 1000));
              const thresholdSec = Math.max(1, Math.round(Number(event.threshold_ms || 0) / 1000));
              addProcessEntry('warn', `Preempt start: generation stalled ${elapsedSec}s (threshold ${thresholdSec}s).`);
              break;
            }

            case 'preempt_killed': {
              const restarted = event.restarted === true;
              const cap = (Number.isFinite(Number(event.preempts_session)) && Number.isFinite(Number(event.preempts_session_cap)))
                ? ` | preempts ${event.preempts_session}/${event.preempts_session_cap}`
                : '';
              addProcessEntry(restarted ? 'info' : 'warn', `Preempt kill/restart ${restarted ? 'completed' : 'failed'}${cap}`);
              break;
            }

            case 'preempt_ready': {
              const cap = (Number.isFinite(Number(event.preempts_session)) && Number.isFinite(Number(event.preempts_session_cap)))
                ? ` | preempts ${event.preempts_session}/${event.preempts_session_cap}`
                : '';
              addProcessEntry('info', `Preempt ready: Ollama online, running rescue advisor${cap}`);
              break;
            }

            case 'preempt_rescue': {
              const cap = (Number.isFinite(Number(event.assist_count)) && Number.isFinite(Number(event.assist_cap)))
                ? ` | assists ${event.assist_count}/${event.assist_cap}`
                : '';
              addProcessEntry('info', `Preempt rescue guidance injected${cap}`);
              break;
            }

            case 'preempt_retry':
              addProcessEntry('info', 'Preempt retry: re-running primary with rescue context.');
              break;

            case 'synthesizing':
              pushProgressLine(`Synthesizing ${Number(event.count || 1)} answer(s)...`);
              addProcessEntry('synth', `Combining ${event.count} answers...`);
              break;

            case 'step': {
              const s = event;
              allSteps.push(s);

              // Show step number
              if (s.stepNum && !s.isFormatViolation && !s.finalAnswer && !s.action) {
                // just a step counter with no other info — skip
              }

	            // Thinking block
	            if (s.thinking) {
	              collectTurnThinking(s.thinking);
	              logThinkingToProcess(s.thinking);
	            }

              // Format violation
              if (s.isFormatViolation) {
                addProcessEntry('warn', 'Format violation — retrying');
                break;
              }

              // Tool call
              if (s.action && !s.toolResult) {
                sawToolActivityThisTurn = true;
                addProcessEntry('tool', `${s.action}  ${JSON.stringify(s.params || {}).slice(0, 100)}`);
                if (s.thought) addProcessEntry('info', s.thought);
              }

              // Tool result (same step object updated)
              if (s.action && s.toolResult) {
                sawToolActivityThisTurn = true;
                const toolText = typeof s.toolResult === 'string' ? s.toolResult : JSON.stringify(s.toolResult || '');
                const isErr = toolText.startsWith('ERROR');
                addProcessEntry(isErr ? 'error' : 'result', toolText);
                if (s.action === 'web_search') {
                  const diag = s?.toolData?.search_diagnostics || s?.diagnostics || null;
                  if (diag) {
                    const query = String(diag.query || s?.params?.query || '').trim();
                    if (query) addProcessEntry('info', `Search query: ${query}`);
                    if (Array.isArray(diag.attempted) && diag.attempted.length) {
                      const providers = diag.attempted.map(a => {
                        const p = String(a.provider || '').toLowerCase();
                        const status = String(a.status || '').toLowerCase();
                        if (status === 'success') {
                          const count = Number.isFinite(a.result_count) ? `, ${a.result_count} result${a.result_count === 1 ? '' : 's'}` : '';
                          return `${p}=success${count}`;
                        }
                        if (status === 'skipped') return `${p}=skipped${a.reason ? ` (${a.reason})` : ''}`;
                        return `${p}=failed${a.reason ? ` (${a.reason})` : ''}`;
                      }).join(' | ');
                      addProcessEntry('info', `Providers: ${providers}`);
	          }
	        }
	        restoreActiveSessionIfStreamStoleFocus(activeBeforeStreamEvent, thisSessionId);
	      }
	    }

              // Final answer
              if (s.finalAnswer) {
                addProcessEntry('final', s.finalAnswer);
                partialContent = s.finalAnswer; // track for stop
              }
              break;
            }

            case 'memory_suggest':
              // event.suggestion: { fact, reference, source_tool, source_output, actor }
              const s = event.suggestion || {};
              addProcessEntry('memory', s.fact || '(memory suggestion)', s);
              addProcessEntry('info', 'A memory suggestion was created; approve to persist.');
              break;

            case 'memory_saved':
              addProcessEntry(event.ok ? 'result' : 'warn', event.ok
                ? `Memory updated${event.key ? ` (${event.key})` : ''}.`
                : 'Memory update failed.');
              break;

            case 'web_search_snippets':
              // event: { query, snippets }
              const q = event.query || '(search)';
              addProcessEntry('info', `Search results: ${q}`, event.snippets || []);
              if (event.diagnostics && Array.isArray(event.diagnostics.attempted)) {
                const providers = event.diagnostics.attempted.map(a => {
                  const p = String(a.provider || '').toLowerCase();
                  const status = String(a.status || '').toLowerCase();
                  if (status === 'success') {
                    const count = Number.isFinite(a.result_count) ? `, ${a.result_count} result${a.result_count === 1 ? '' : 's'}` : '';
                    return `${p}=success${count}`;
                  }
                  if (status === 'skipped') return `${p}=skipped${a.reason ? ` (${a.reason})` : ''}`;
                  return `${p}=failed${a.reason ? ` (${a.reason})` : ''}`;
                }).join(' | ');
                addProcessEntry('info', `Providers: ${providers}`);
              }
              break;

            case 'error':
              addProcessEntry('error', event.message);
              break;

            case 'canvas_present': {
              // AI created/wrote a file — present it in the canvas
              const presentPath = String(event.path || '');
              if (presentPath) {
                // Auto-expand right panel if it was collapsed
                if (rightPanelCollapsed) {
                  toggleRightPanel();
                }
                // Show notification dot on canvas button if canvas is closed
                if (!canvasOpen) {
                  const dot = document.getElementById('canvas-notify-dot');
                  if (dot) dot.style.display = 'block';
                }
                // Keep the user's current right-panel surface stable; the Canvas
                // button/dot lets them open the presented file when they want it.
                canvasPresentFile(presentPath, undefined, { autoOpen: false });
                // Track for file pill in chat message
                if (!canvasPresentedFiles.includes(presentPath)) {
                  canvasPresentedFiles.push(presentPath);
                }
              }
              break;
            }

            case 'model_switched': {
              const switchedModel = String(event.model || '').trim();
              const switchedProvider = String(event.providerId || '').trim();
              const switchedReason = String(event.reason || '').trim();
              // Show a compact badge-style line in the process log and the streaming bubble.
              const isHaiku = switchedModel.toLowerCase().includes('haiku');
              const modelLabel = isHaiku ? `⚡ Haiku` : formatModelDisplayName(switchedModel, switchedProvider);
              const badgeText = `${modelLabel}${switchedReason ? ` — ${switchedReason}` : ''}`;
              pushProgressLine(badgeText);
              streamState.activeModelBadge = { label: modelLabel, reason: switchedReason, provider: switchedProvider };
              showToast('Model switched', `${switchedProvider ? `${switchedProvider}/` : ''}${switchedModel}${switchedReason ? ` - ${switchedReason}` : ''}`, 'info', 4500);
              renderIfViewingThisSession();
              break;
            }

            case 'main_model_changed': {
              const modelRef = String(event.modelRef || '').trim();
              const model = String(event.model || modelRef).trim();
              const provider = String(event.providerId || '').trim();
              const label = formatModelDisplayName(model || 'main model', provider);
              pushProgressLine(`Main chat model set to ${provider ? `${provider}/` : ''}${model}`);
              streamState.activeModelBadge = { label, reason: 'main chat default', provider };
              showToast('Main model changed', modelRef || `${provider ? `${provider}/` : ''}${model}`, 'success', 5000);
              renderIfViewingThisSession();
              break;
            }

            case 'session_title': {
              applyServerSessionTitle(event.sessionId || thisSessionId, event.title);
              renderIfViewingThisSession();
              break;
            }

	          case 'done':
	            finalReply = event.reply || finalReply || '';
                desktopChatRuntime(thisSessionId)?.completeStream(finalReply || streamState.streamingAIText, event);
	            if (finalReply) partialContent = finalReply;
	            syncStreamingVisualActivity(streamState, finalReply || streamState.streamingAIText, applyLiveToolActivity, { finalize: true });
	            if (event.thinking) collectTurnThinking(event.thinking);
	            finalArtifacts = Array.isArray(event.artifacts) ? event.artifacts : [];
	            finalFileChanges = event.fileChanges || null;
	            if (event.fileChanges) void refreshOpenCanvasFiles(event.fileChanges);
	            finalProductCarousel = event.productCarousel || null;
	            finalRichArtifacts = Array.isArray(event.richArtifacts) ? event.richArtifacts : null;
	            finalGoalCompletionReport = event.goalCompletionReport || finalGoalCompletionReport;
	            streamState.activeModelBadge = null; // clear badge when turn completes
	            break;

	          case 'final':
	            finalReply = reconcileFinalResponse(streamState.streamingAIText, event.text || event.reply || '');
                desktopChatRuntime(thisSessionId)?.completeStream(finalReply, event);
	            if (finalReply) {
	              partialContent = finalReply;
	              beginFinalResponse(streamState);
	              _settlePendingChatSteerPresentation(thisSessionId, streamState);
	              streamState.streamingAIText = finalReply;
	              syncStreamingVisualActivity(streamState, streamState.streamingAIText, applyLiveToolActivity, { finalize: true });
	              if (window.activeChatSessionId === thisSessionId) window.streamingAIText = streamState.streamingAIText;
	              scheduleStreamingRenderFor(thisSessionId, renderIfViewingThisSession);
	            }
	            if (Array.isArray(event.artifacts)) finalArtifacts = event.artifacts;
	            if (event.fileChanges) finalFileChanges = event.fileChanges;
	            if (event.fileChanges) void refreshOpenCanvasFiles(event.fileChanges);
	            if (event.productCarousel) finalProductCarousel = event.productCarousel;
	            if (Array.isArray(event.richArtifacts)) finalRichArtifacts = event.richArtifacts;
	            if (event.goalCompletionReport) finalGoalCompletionReport = event.goalCompletionReport;
	            break;

            case 'turn_execution_created':
            case 'turn_execution_updated':
              break;
          }
        }
      }

	    if (!streamState.abortRequested && !turnAbortController?.signal?.aborted
	      && !finalReply && !sawTerminalStreamEvent && !sawFinalStreamEvent) {
	      const streamEndedError = new Error('stream ended before completion');
	      streamEndedError.desktopStreamDisconnected = true;
	      throw streamEndedError;
	    }

	    if (streamState.abortRequested === true || turnAbortController?.signal?.aborted) {
	      persistTurnThinkingToProcess();
	      saveInterruptedAssistantTurn();
	    } else if (finalReply) {
	      const mergedThinking = persistTurnThinkingToProcess();
	      await applyDesignAssistantOps(finalReply);
	      applyCreativeAssistantOps(finalReply);
	      const turnEntries = mergeLiveTraceProcessEntries(streamState.liveTraceEntries, getTurnEntries());
	      appendAssistantTurnForUser({
	        role: 'ai',
	        content: finalReply,
	        artifacts: finalArtifacts,
	        fileChanges: mergeFileChangesWithBackground(finalFileChanges, thisSessionId) || undefined,
	        productCarousel: finalProductCarousel || undefined,
	        richArtifacts: (Array.isArray(finalRichArtifacts) && finalRichArtifacts.length) ? finalRichArtifacts : undefined,
	        goalCompletionReport: finalGoalCompletionReport || undefined,
	        canvasFiles: canvasPresentedFiles.length ? [...canvasPresentedFiles] : undefined,
	        generatedImages: turnGeneratedImages.length ? [...turnGeneratedImages] : undefined,
	        generatedVideos: turnGeneratedVideos.length ? [...turnGeneratedVideos] : undefined,
	        steps: allSteps,
	        mode: window.useAgentMode ? 'agentic' : 'chat',
	        processEntries: turnEntries,
	        liveTraceEntries: Array.isArray(streamState.liveTraceEntries) ? streamState.liveTraceEntries.slice() : undefined,
	      });
	      clearBackgroundSpawnDockForSession(thisSessionId);
	    } else {
	      const turnEntries = mergeLiveTraceProcessEntries(streamState.liveTraceEntries, getTurnEntries());
	      appendAssistantTurnForUser({
	        role: 'ai',
	        content: 'No response received.',
	        generatedImages: turnGeneratedImages.length ? [...turnGeneratedImages] : undefined,
	        generatedVideos: turnGeneratedVideos.length ? [...turnGeneratedVideos] : undefined,
	        processEntries: turnEntries,
	        liveTraceEntries: Array.isArray(streamState.liveTraceEntries) ? streamState.liveTraceEntries.slice() : undefined,
	      });
	    }
      persistSession(thisSessionId);
      if (finalReply && window.activeChatSessionId === thisSessionId) {
        const voiceAgentShouldSummarize = !!(
          realtimeAgentDispatch
          || (
            wantsVoiceAgentRealtimeMode()
            && voiceAgentRealtimeConnection?.dc?.readyState === 'open'
            && String(voiceAgentRealtimeConnection?.sessionId || '') === String(thisSessionId || '')
          )
        );
        if (voiceAgentShouldSummarize) {
          requestVoiceAgentRealtimeFinalSummaryWithRetry(finalReply, {
            key: `worker_final:${thisSessionId}:${finalReply.length}:${finalReply.slice(0, 120)}`,
            sessionId: thisSessionId,
          });
        } else {
          speakAssistantReply(finalReply).catch((err) => {
            addProcessEntry('warn', `Voice reply failed: ${String(err?.message || err)}`);
          });
        }
      }

    } catch (err) {
      persistTurnThinkingToProcess();
      const pageLifecycleDisconnected = window._desktopPageLifecycleDisconnectedSessions?.[thisSessionId] === true;
      const wasAborted = !pageLifecycleDisconnected && (err?.name === 'AbortError'
        || turnAbortController?.signal?.aborted
        || streamState.abortRequested === true
        || /abort/i.test(String(err?.message || err || '')));
      if (wasAborted) {
        saveInterruptedAssistantTurn();
      } else if (pageLifecycleDisconnected || isDesktopChatTransportDisconnect(err)) {
        desktopStreamRecoveryPending = true;
        desktopChatRuntime(thisSessionId)?.markRetry({ reason: String(err?.message || err || 'connection_lost') });
        streamState.lastHeartbeat = {
          ...streamState.lastHeartbeat,
          state: 'running',
          level: '',
          message: 'Connection lost; recovering the live Prometheus stream.',
          current_step: 'reconnecting',
        };
        const alreadyNoted = getTurnEntries().some((entry) => /connection lost; recovering/i.test(String(entry?.content || '')));
        if (!alreadyNoted) {
          addProcessEntry('warn', 'Connection lost; Prometheus is still working. Reconnecting to recover this turn.');
        }
        if (thisSession) thisSession.activeRun = true;
        window._sessionThinking[thisSessionId] = true;
        forgetLocalMainChatRequest(thisSessionId, clientRequestId, { immediate: true });
        const rememberedRun = readDesktopActiveChatRun(thisSessionId);
        rememberDesktopActiveChatRun(thisSessionId, {
          clientRequestId: rememberedRun?.clientRequestId || clientRequestId,
          streamId: rememberedRun?.streamId || String(window._mainChatStreamActiveIdBySession?.[thisSessionId] || ''),
          lastSeq: Math.max(Number(rememberedRun?.lastSeq || 0), getMainChatStreamLastSeq(thisSessionId, rememberedRun?.streamId || 'default')),
          disconnected: true,
        });
        if (window.activeChatSessionId === thisSessionId) {
          window.lastHeartbeat = streamState.lastHeartbeat;
          applyStreamStateToWindow(thisSessionId);
          updateHeartbeatUI();
          renderIfViewingThisSession();
        }
        scheduleDesktopMainChatRecovery(thisSessionId, { recovery: true, fullRefresh: false, delayMs: 180 });
      } else {
        const turnEntries = mergeLiveTraceProcessEntries(streamState.liveTraceEntries, getTurnEntries());
        streamState.lastHeartbeat = { ...streamState.lastHeartbeat, state: 'stalled', level: 'hard', message: String(err.message || 'connection_error'), current_step: 'error' };
        if (window.activeChatSessionId === thisSessionId) {
          window.lastHeartbeat = streamState.lastHeartbeat;
          updateHeartbeatUI();
        }
        addProcessEntry('error', err.message);
        appendAssistantTurnForUser({
          role: 'ai',
          content: `Connection error: ${err.message}`,
          generatedImages: turnGeneratedImages.length ? [...turnGeneratedImages] : undefined,
          generatedVideos: turnGeneratedVideos.length ? [...turnGeneratedVideos] : undefined,
          processEntries: turnEntries,
          liveTraceEntries: Array.isArray(streamState.liveTraceEntries) ? streamState.liveTraceEntries.slice() : undefined,
        });
      }
      persistSession(thisSessionId);
    }

    // Finalization flush: cancel any pending coalesced streaming render and paint
    // the final state immediately so the complete answer is never truncated by an
    // un-fired throttle timer. Runs for done/abort/error/stop (all converge here).
    flushStreamingRenderFor(thisSessionId, renderIfViewingThisSession);

    // Per-session cleanup
    delete window._sessionThinking[thisSessionId];
    delete window._sessionAbortControllers[thisSessionId];
    if (desktopStreamRecoveryPending) {
      if (thisSession) thisSession.activeRun = true;
      window._sessionThinking[thisSessionId] = true;
      rememberDesktopActiveChatRun(thisSessionId, { disconnected: true, clientRequestId });
      persistSession(thisSessionId);
      syncActiveSessionRunState();
      const isViewingRecoverySession = window.activeChatSessionId === thisSessionId;
      if (isViewingRecoverySession) {
        applyStreamStateToWindow(thisSessionId);
        if (typeof window.setButtonState === 'function') window.setButtonState(true);
        updateHeartbeatUI();
        renderChatMessages();
      }
      sendBtn.disabled = false;
      releaseChatSendLock(sendLock);
      forgetLocalMainChatRequest(thisSessionId, clientRequestId, { immediate: true });
      scheduleChatContextWindowRefresh(500);
      updateQueuedPromptUI();
      return;
    }
    delete window._desktopPageLifecycleDisconnectedSessions?.[thisSessionId];
    const isViewingThisSession = window.activeChatSessionId === thisSessionId;
    if (thisSession) {
      thisSession.activeRun = false;
      // Sending a turn clears unread while the session is Working. Completion
      // always advances that state to Unread, including when the chat is still
      // visible, so the default list marks it and Priority retains it instead of
      // immediately reclassifying it into Today.
      thisSession.unread = true;
    }
    clearDesktopActiveChatRun(thisSessionId);
    persistSession(thisSessionId);
    scheduleChatResourcesReload(thisSessionId, 80);
    // Do this before the final non-streaming paint. A late render must never
    // reuse the completed turn's state and recreate an empty Working bubble.
    window._sessionStreamState[thisSessionId] = makeEmptyStreamState();
    syncActiveSessionRunState();
    if (isViewingThisSession) {
      applyStreamStateToWindow(thisSessionId);
      if (typeof window.setButtonState === 'function') window.setButtonState(false);
      window.currentPreflightStatus = '';
      window.currentProgressLines = [];
      window.currentProgressThinkingActive = false;
      window.currentProgressThinkingText = '';
      window.liveTraceEntries = [];
      window.lastHeartbeat = { ...streamState.lastHeartbeat, state: 'idle', level: '', message: '', current_step: 'done' };
      window.currentTurnStartIndex = -1;
      updateHeartbeatUI();
      renderChatMessages();
    }
    sendBtn.disabled = false;
    releaseChatSendLock(sendLock);
    forgetLocalMainChatRequest(thisSessionId, clientRequestId);
    settleChatContextWindowLiveTurn(thisSessionId);
    scheduleChatContextWindowRefresh(500);
    updateQueuedPromptUI();
    if (Number.isInteger(options.reuseExistingUserIndex) && options.reuseExistingUserIndex >= 0) {
      updatePromptVariantAfterRerun(options.reuseExistingUserIndex);
      window._editRerunAbortResetSessions?.delete?.(thisSessionId);
    }

    if (isViewingThisSession) {
      const shouldPauseQueue = isFailedTurnReply(finalReply || (sessionHistoryRef[sessionHistoryRef.length - 1]?.content || ''));
      const queue = getSessionQueuedPrompts(thisSessionId);
      let queuedPromptStarted = false;
      if (queue.length > 0 && shouldPauseQueue) {
        addProcessEntry('warn', 'Queue paused because the previous turn failed/blocked. Press Send to resume queued prompts.');
      } else if (queue.length > 0) {
        const next = queue.shift();
        window.queuedPrompts = queue;
        updateQueuedPromptUI();
        addProcessEntry('info', `Auto-running queued prompt${queue.length ? ` (${queue.length} remaining)` : ''}.`);
        queuedPromptStarted = true;
        setTimeout(() => { sendChat(next); }, 0);
      }
      if (!queuedPromptStarted) setTimeout(processVoicePendingTurns, 0);
    }
  }
}
