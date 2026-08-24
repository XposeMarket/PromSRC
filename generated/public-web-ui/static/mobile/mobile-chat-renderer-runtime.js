// Chat rich-message, attachment, and transcript renderer runtime.
export function createMobileChatRendererRuntime(context = {}) {
  const {
    ICONS,
    MOBILE_CHAT_SESSION_ID,
    PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE,
    __pmChat,
    __pmVoice,
    _activeMobileThread,
    _captureMobileApprovalDetailsState,
    _captureMobileQuestionDraftState,
    _captureMobileWorkerDeckViewState,
    _collectMessageMedia,
    _formatMobileGoalElapsed,
    _formatMobileWorkDuration,
    _getPendingApprovalsForSession,
    _isMobileAssistantMessage,
    _isMobileExplicitMediaToolName,
    _isMobileGenerateImageToolName,
    _isMobileGenerateVideoToolName,
    _isMobileVoiceAgentWorkerHandoff,
    _isMobileVoiceTraceTurn,
    _markMobileLiveStreamMotion,
    _mergeMobileMediaIntoMessage,
    _mergeMobileProductCarouselIntoMessage,
    _mobileAssistantWorkStartedAt,
    _mobileBackgroundSpawnId,
    _mobileBackgroundSpawnLanes,
    _mobileFileExt,
    _mobileHasPendingImageGeneration,
    _mobileTimelineEntries,
    _mobileToolEventName,
    _mobileTraceHasToolGroup,
    _mobileVoiceWorkgroupStatus,
    _mobileWorkflowTraceEntriesForMessage,
    _normalizeMobileMedia,
    _normalizeMobileMediaList,
    _normalizeMobileVoiceWorkgroup,
    _nowTime,
    _pmCssEscape,
    _reconcileMobileThreadOrder,
    _renderBrowseCard,
    _renderMobileApprovalCard,
    _renderMobileApprovalSheet,
    _renderMobileBackgroundSpawnDock,
    _renderMobileChatErrorPresentation,
    _renderMobileFileChanges,
    _renderMobileGeneratedImageLoadingCard,
    _renderMobileGroupedTrace,
    _renderMobileMarkdown,
    _renderMobileMediaGallery,
    _renderMobileMessageActions,
    _renderMobileProductCarousel,
    _renderMobileQuestionCard,
    _renderMobileRichArtifacts,
    _renderMobileSkillReferencedMarkdown,
    _renderMobileThreadLinkArtifacts,
    _renderMobileUserEditComposer,
    _renderMobileVoiceWorkgroup,
    _renderMobileWorkTimer,
    _resolveMobileApprovalButton,
    _restoreMobileApprovalDetailsState,
    _restoreMobileQuestionDraftState,
    _safeJsonPreview,
    _scheduleMobileThreadCacheSave,
    _syncMobileQuestionComposerPopover,
    _wireMobileChatEnhancements,
    _wireMobileProcessRunActions,
    captureKeyedScrollState,
    chatTimelineRowSignature,
    escapeHtml,
    loadBgTaskDetail,
    mobileChatRuntimeAdapter,
    mobileGatewayFetch,
    mobileStreamRenderScheduler,
    mobileTimelineController,
    pmHaptic,
    pmToast,
    reconcileKeyedTimelineRows,
    setInnerHTMLPreservingVisuals,
    uploadMobileBinaryFile,
    uploadMobileTextFile,
    wsEventBus,
  } = context || {};

  function _mobileWorkflowTransitionLabel(message) {
    const groupId = String(message?.workflowGroupId || '');
    if (/^chat_steer_/i.test(groupId)) {
      const part = String(message?.workflowPart || '');
      if (part === 'before_interruption') return 'Tool stream before steer';
      if (part === 'interruption') return 'Message sent as steer';
      if (part === 'interruption_response') return 'Response after steer';
    }
    return String(message?.workflowLabel || '').trim();
  }
  
  function _renderChatMessageHtml(m, index = -1, rowKey = '', rowSignature = '') {
    const msgIndex = Number.isFinite(Number(index)) ? Number(index) : -1;
    const stableRowKey = String(rowKey || `mobile-message:${msgIndex}`);
    const stableRowSignature = String(rowSignature || chatTimelineRowSignature(m));
    const workflowLabel = _mobileWorkflowTransitionLabel(m);
    const attachments = Array.isArray(m.body?.attachments) ? m.body.attachments : [];
    const attachmentHtml = attachments.length
      ? _renderChatAttachmentPreviews(attachments, false, m.role === 'user')
      : '';
    const revealTime = m.time ? `<span class="pm-reveal-time" aria-hidden="true">${escapeHtml(m.time)}</span>` : '';
    if (m.role === 'user') {
      const isWorkerHandoff = _isMobileVoiceAgentWorkerHandoff(m);
      const isEditing = __pmChat.editingMessageIndex === msgIndex;
      const userText = String(m.body?.text || '').trim();
      const isAttachmentOnlyPlaceholder = attachments.length > 0
        && /^(attached file\(s\)|please review the attached file\(s\)\.)$/i.test(userText);
      const userBubbleHtml = (isAttachmentOnlyPlaceholder && !isWorkerHandoff)
        ? ''
        : `<div class="pm-bubble">${isWorkerHandoff ? '<span class="pm-sender pm-handoff-sender">Voice Agent to Worker</span>' : ''}${isAttachmentOnlyPlaceholder ? '' : `<div class="markdown-body">${_renderMobileSkillReferencedMarkdown(m.body.text, m.body.selectedSkillRefs || m.selectedSkillRefs)}</div>`}</div>`;
      // While editing, render the composer in place of the bubble (NOT nested
      // inside .pm-bubble) so it reads as an editable message, not an inner panel.
      const contentHtml = isEditing
        ? _renderMobileUserEditComposer(m, msgIndex, attachmentHtml)
        : `${attachmentHtml}${userBubbleHtml}`;
      return `<div class="pm-msg from-user${isEditing ? ' editing' : ''}${isWorkerHandoff ? ' voice-worker-handoff' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}" data-pm-row-key="${escapeHtml(stableRowKey)}" data-pm-row-signature="${escapeHtml(`${stableRowSignature}:${isEditing ? 'editing' : 'view'}`)}">
        ${workflowLabel && !isWorkerHandoff ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}
        ${contentHtml}${isEditing ? '' : _renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
    }
    const b = m.body || {};
    if (m._pmCoalescedError) return '';
    const answerStarted = !!(m.finalResponseStarted || String(b.text || m.content || '').trim());
    const isVoiceTraceTurn = _isMobileVoiceTraceTurn(m);
    const statusDividerHtml = '<div class="pm-msg-status-divider" aria-hidden="true"></div>';
    const voiceSpeaker = String(m?.voiceSpeaker || '').trim();
    let inner = voiceSpeaker ? `<div class="pm-voice-room-speaker">${escapeHtml(voiceSpeaker)}</div>` : '';
    inner += _renderMobileWorkTimer(m);
    if (inner) inner += statusDividerHtml;
    const renderedApprovalIds = new Set();
    if (m.approvalRequest) {
      const approvalId = String(m.approvalRequest.id || '').trim();
      if (approvalId) renderedApprovalIds.add(approvalId);
      inner += _renderMobileApprovalCard(m.approvalRequest, { compact: false });
    }
    if (m.questionRequest) {
      // Pending questions are owned by the composer popover. Keep the history
      // stream free of a second copy; preserve any real assistant text/approval
      // that accompanied the question.
      const qPending = String(m.questionRequest.status || 'pending').toLowerCase() === 'pending';
      if (qPending) {
        if (!String(m.body?.text || m.content || '').trim() && !m.approvalRequest) return '';
      } else {
        inner += _renderMobileQuestionCard(m.questionRequest);
      }
    }
    const hasLiveTraceEntries = Array.isArray(m.liveTraceEntries) && m.liveTraceEntries.length > 0;
    const finalFrameReceived = m._pmFinalReceived === true;
    const traceFrozenForSteer = m._steerFrozenTrace === true;
    const showLiveWorkflowTrace = m.streaming && !finalFrameReceived && hasLiveTraceEntries && !traceFrozenForSteer;
    const liveTraceHtml = showLiveWorkflowTrace
      ? _renderMobileGroupedTrace(m.liveTraceEntries, { streaming: true, openLiveCurrent: isVoiceTraceTurn })
      : '';
    const hasLiveTrace = !!liveTraceHtml;
    const completedTraceEntries = (!m.streaming || finalFrameReceived || traceFrozenForSteer) ? _mobileWorkflowTraceEntriesForMessage(m) : [];
    const hasCompletedTrace = _mobileTraceHasToolGroup(completedTraceEntries);
    const hasPendingImageGeneration = _mobileHasPendingImageGeneration(m) && !_collectMessageMedia(m).some((media) => media.kind === 'image' && media.generated);
    if (hasLiveTrace) {
      inner += liveTraceHtml;
    } else if (traceFrozenForSteer && hasCompletedTrace) {
      // The captured half of a steer is still live conversation context, not a
      // completed historical drawer. Keep its tool stream visible above the
      // injected user message while the continuation runs below it.
      inner += _renderMobileGroupedTrace(completedTraceEntries, { streaming: false });
    } else if (hasCompletedTrace) {
      // Completed turn — trace hidden in collapsible drawer behind the work timer
      inner += `<div class="pm-trace-drawer" data-trace-completed="1">${_renderMobileGroupedTrace(completedTraceEntries, { streaming: false })}</div>`;
    } else if (m.streaming && !answerStarted && !hasPendingImageGeneration) {
      inner += '<div class="pm-thinking-dots"><span></span><span></span><span></span></div>';
    }
    if (hasPendingImageGeneration) {
      inner += _renderMobileGeneratedImageLoadingCard();
    }
    inner += _renderMobileChatErrorPresentation(m.errorPresentation);
    if (b.text) {
      // Final-answer text is already authored Markdown. Do not run it through the
      // trace-prose normalizer: that collapses intentional newlines and turns
      // headings/lists into strings such as `text### Heading` while streaming.
      const answerStreaming = m.streaming === true && m._pmFinalReceived !== true;
      // Chat history must stay visually stable while a realtime response is
      // spoken. Karaoke/rolling lyrics belong only to the dedicated voice stage,
      // never to an assistant bubble in the normal chat page.
      inner += `<div class="markdown-body pm-final-answer${answerStreaming ? ' pm-final-answer--streaming' : ' pm-final-answer--complete'}">${_renderMobileMarkdown(b.text, m)}</div>`;
      // rendered above with the shared desktop Markdown renderer
    }
    if (false && b.text)   inner += escapeHtml(b.text).replace(/\n/g, '<br>');
    if (b.summary) {
      inner += `<div class="pm-summary-rows">${b.summary.map(s => `
        <div class="pm-summary-row">
          <span class="pm-icon">${ICONS[s.icon] || ICONS.clipboard}</span>
          <span class="pm-meta"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.subtitle)}</span></span>
        </div>`).join('')}</div>`;
    }
    if (b.numbered) {
      inner += `<ol class="pm-numbered">${b.numbered.map((n, i) => `
        <li><span class="pm-num">${i+1}</span><div><strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.subtitle)}</span></div></li>
      `).join('')}</ol>`;
    }
    if (b.teamRows) {
      inner += `<div class="pm-team-rows">${b.teamRows.map(t => `
        <div class="pm-team-row"><span class="pm-team-icon">${t.icon}</span><div><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.detail)}</span></div></div>
      `).join('')}</div>`;
    }
    if (b.image?.base64) {
      inner += _renderMobileMediaGallery([_normalizeMobileMedia({
        kind: 'image',
        name: b.image.name || 'Screenshot.png',
        mimeType: b.image.mimeType || 'image/png',
        base64: b.image.base64,
      })].filter(Boolean));
    }
    if (Array.isArray(b.actions) && b.actions.length) {
      inner += `<div class="pm-command-actions">${b.actions.map((action) => `
        <button type="button" class="pm-command-action ${escapeHtml(action.kind || '')}" data-pm-command-action="${escapeHtml(action.action || '')}" data-pm-command-id="${escapeHtml(action.id || '')}">
          ${action.icon ? `<span>${ICONS[action.icon] || escapeHtml(action.icon)}</span>` : ''}<strong>${escapeHtml(action.label || action.action || 'Action')}</strong>
        </button>
      `).join('')}</div>`;
    }
    const activeApprovals = m.streaming
      ? _getPendingApprovalsForSession(__pmChat.activeSessionId).filter((approval) => {
          const approvalId = String(approval?.id || '').trim();
          return !approvalId || !renderedApprovalIds.has(approvalId);
        })
      : [];
    if (activeApprovals.length) {
      inner += `<div class="pm-chat-approvals-inline">${activeApprovals.map((approval) => _renderMobileApprovalCard(approval, { compact: true })).join('')}</div>`;
    }
    if (b.browseState) inner += _renderBrowseCard(b.browseState);
    inner += _renderMobileRichArtifacts(m);
    inner += _renderMobileVoiceWorkgroup(m);
    if (!(Array.isArray(m.richArtifacts) && m.richArtifacts.some((a) => a?.type === 'products'))) {
      inner += _renderMobileProductCarousel(m);
    }
    inner += _renderMobileMediaGallery(_collectMessageMedia(m));
    inner += _renderMobileFileChanges(m.fileChanges);
    inner += _renderMobileThreadLinkArtifacts(m);
    inner += _renderMobileGoalCompletionReport(m.goalCompletionReport);
    if (inner.endsWith(statusDividerHtml)) inner = inner.slice(0, -statusDividerHtml.length);
    return `<div class="pm-msg from-ai${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}" data-pm-row-key="${escapeHtml(stableRowKey)}" data-pm-row-signature="${escapeHtml(`${stableRowSignature}:view`)}"${m.streaming ? ' data-streaming="1"' : ''}>
      ${workflowLabel ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}
      <div class="pm-bubble">${inner}</div>${_renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
  }
  
  function _renderMobileGoalCompletionReport(report) {
    if (!report || typeof report !== 'object') return '';
    const elapsed = _formatMobileGoalElapsed(Math.max(0, Number(report.elapsedMs || 0)));
    const tokens = Math.max(0, Math.round(Number(report.totalTokens || 0)));
    const costMicros = Math.max(0, Math.round(Number(report.totalCostMicros || 0)));
    const cost = costMicros > 0 ? ` · $${(costMicros / 1_000_000).toFixed(costMicros >= 10_000 ? 2 : 4)} est.` : '';
    return `<div class="pm-goal-completion-report" aria-label="Goal completion totals">
      <span>Goal complete</span><strong>${escapeHtml(elapsed)}</strong><i>·</i><strong>${escapeHtml(tokens.toLocaleString())} tokens</strong>${cost ? `<em>${escapeHtml(cost)}</em>` : ''}
    </div>`;
  }
  
  function _addMobileMedia(message, key, items, forcedKind = '') {
    if (!message) return;
    const normalized = _normalizeMobileMediaList(items).map((media) => forcedKind ? { ...media, kind: forcedKind } : media);
    if (!normalized.length) return;
    if (!Array.isArray(message[key])) message[key] = [];
    const existing = new Set(_normalizeMobileMediaList(message[key]).map((media) => media.dataUrl || media.path || media.name));
    for (const media of normalized) {
      const raw = {
        kind: media.kind,
        path: media.path,
        dataUrl: media.dataUrl,
        name: media.name,
        file_name: media.name,
        prompt: media.prompt,
        provider: media.provider,
        model: media.model,
        bytes: media.bytes,
      };
      const id = media.dataUrl || media.path || media.name;
      if (id && !existing.has(id)) {
        message[key].push(raw);
        existing.add(id);
      }
    }
  }
  
  function _collectMediaFromToolEvent(message, evt, inheritedToolName = '') {
    const toolName = _mobileToolEventName(evt) || _mobileToolEventName(inheritedToolName);
    const isGenerateImageTool = _isMobileGenerateImageToolName(toolName);
    const isGenerateVideoTool = _isMobileGenerateVideoToolName(toolName);
    const isExplicitMediaTool = _isMobileExplicitMediaToolName(toolName);
    const isTerminalEnvelope = /^(final|done)$/i.test(String(evt?.type || evt?.event || ''));
    const extra = evt?.extra && typeof evt.extra === 'object' ? evt.extra : {};
    let result = evt?.result && typeof evt.result === 'object' ? evt.result : {};
    if ((!result || !Object.keys(result).length) && typeof evt?.result === 'string') {
      try {
        const parsed = JSON.parse(evt.result);
        if (parsed && typeof parsed === 'object') result = parsed;
      } catch {}
    }
    const sources = [extra, result, evt].filter(Boolean);
    const presentationMode = String(
      evt?.args?.presentation_mode
      || evt?.params?.presentation_mode
      || evt?.input?.presentation_mode
      || extra?.presentation_mode
      || result?.presentation_mode
      || '',
    ).trim().toLowerCase();
    if (isGenerateImageTool && presentationMode === 'background') {
      message._pmBackgroundImageGeneration = true;
    }
    for (const source of sources) {
      const hasExplicitGeneratedImages = Array.isArray(source.generated_images)
        || Array.isArray(source.generatedImages)
        || !!source.generated_image
        || !!source.generatedImage;
      const hasExplicitGeneratedVideos = Array.isArray(source.generated_videos)
        || Array.isArray(source.generatedVideos)
        || !!source.generated_video
        || !!source.generatedVideo;
      const allowGeneratedImages = isGenerateImageTool || (isTerminalEnvelope && hasExplicitGeneratedImages);
      const allowGeneratedVideos = isGenerateVideoTool || (isTerminalEnvelope && hasExplicitGeneratedVideos);
      if (allowGeneratedImages && Array.isArray(source.generated_images)) _addMobileMedia(message, 'generatedImages', source.generated_images, 'image');
      if (allowGeneratedImages && Array.isArray(source.generatedImages)) _addMobileMedia(message, 'generatedImages', source.generatedImages, 'image');
      if (allowGeneratedImages && source.generated_image) _addMobileMedia(message, 'generatedImages', source.generated_image, 'image');
      if (allowGeneratedImages && source.generatedImage) _addMobileMedia(message, 'generatedImages', source.generatedImage, 'image');
      if (isGenerateImageTool && Array.isArray(source.images)) _addMobileMedia(message, 'generatedImages', source.images, 'image');
      if (isGenerateImageTool && source.image && typeof source.image === 'object' && (source.image.path || source.image.rel_path || source.image.base64)) _addMobileMedia(message, 'generatedImages', source.image, 'image');
      if (allowGeneratedVideos && Array.isArray(source.generated_videos)) _addMobileMedia(message, 'generatedVideos', source.generated_videos, 'video');
      if (allowGeneratedVideos && Array.isArray(source.generatedVideos)) _addMobileMedia(message, 'generatedVideos', source.generatedVideos, 'video');
      if (allowGeneratedVideos && source.generated_video) _addMobileMedia(message, 'generatedVideos', source.generated_video, 'video');
      if (allowGeneratedVideos && source.generatedVideo) _addMobileMedia(message, 'generatedVideos', source.generatedVideo, 'video');
      if (isGenerateVideoTool && Array.isArray(source.videos)) _addMobileMedia(message, 'generatedVideos', source.videos, 'video');
      if (isGenerateVideoTool && source.video && typeof source.video === 'object' && (source.video.path || source.video.rel_path || source.video.url)) _addMobileMedia(message, 'generatedVideos', source.video, 'video');
      if (isExplicitMediaTool && Array.isArray(source.canvasFiles)) _mergeMobileMediaIntoMessage(message, source.canvasFiles.map((path) => ({ path })));
      if (isExplicitMediaTool && Array.isArray(source.files)) {
        const mediaFiles = source.files.filter((f) => f && typeof f === 'object');
        if (mediaFiles.length) _mergeMobileMediaIntoMessage(message, mediaFiles);
      }
      if (isExplicitMediaTool && Array.isArray(source.artifacts)) _mergeMobileMediaIntoMessage(message, source.artifacts);
      if (source.productCarousel && typeof source.productCarousel === 'object') _mergeMobileProductCarouselIntoMessage(message, source.productCarousel);
      if (Array.isArray(source.results)) {
        for (const nested of source.results) _collectMediaFromToolEvent(message, nested, toolName);
      }
    }
  }
  
  function _renderChatAttachmentPreviews(files, removable = true, plainImagePreviews = false) {
    const items = (Array.isArray(files) ? files : []).map((f, i) => {
      const name = escapeHtml(f.name || 'Attachment');
      const state = String(f.uploadState || '').trim();
      const stateLabel = state === 'uploading'
        ? 'Uploading...'
        : state === 'uploaded'
          ? 'Uploaded'
          : state === 'vision_only'
            ? 'Vision attached'
            : state === 'failed'
              ? 'Upload failed'
              : '';
      const meta = escapeHtml(stateLabel || f.sizeLabel || f.mimeType || 'file');
      const remove = removable ? `<button type="button" class="pm-attach-remove" data-remove-attachment="${i}" aria-label="Remove attachment">×</button>` : '';
      if (f.kind === 'image' && (f.dataUrl || f.workspacePath)) {
        const src = f.dataUrl || `/api/canvas/inline?path=${encodeURIComponent(String(f.workspacePath || ''))}`;
        const mediaAttrs = !removable
          ? ` data-pm-media data-kind="image" data-src="${escapeHtml(src)}" data-download="${escapeHtml(f.workspacePath ? `/api/canvas/download?path=${encodeURIComponent(String(f.workspacePath || ''))}` : src)}" data-name="${name}" data-path="${escapeHtml(String(f.workspacePath || ''))}"`
          : '';
        if (plainImagePreviews) {
          return `<button type="button" class="pm-message-image-preview"${mediaAttrs}><img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async"></button>`;
        }
        const tag = removable ? 'div' : 'button type="button"';
        return `<${tag} class="pm-attach-chip image${removable ? '' : ' openable'}"${mediaAttrs}>${remove}<img src="${escapeHtml(src)}" alt=""><span><strong>${name}</strong><em>${meta}</em></span></${removable ? 'div' : 'button'}>`;
      }
      if (f.kind === 'video' && (f.dataUrl || f.workspacePath)) {
        const src = f.dataUrl || `/api/canvas/inline?path=${encodeURIComponent(String(f.workspacePath || ''))}`;
        const mediaAttrs = !removable
          ? ` data-pm-media data-kind="video" data-src="${escapeHtml(src)}" data-download="${escapeHtml(f.workspacePath ? `/api/canvas/download?path=${encodeURIComponent(String(f.workspacePath || ''))}` : src)}" data-name="${name}" data-path="${escapeHtml(String(f.workspacePath || ''))}"`
          : '';
        const tag = removable ? 'div' : 'button type="button"';
        return `<${tag} class="pm-attach-chip video${removable ? '' : ' openable'}"${mediaAttrs}>${remove}<video src="${escapeHtml(src)}" muted playsinline preload="metadata"></video><span><strong>${name}</strong><em>${meta}</em></span></${removable ? 'div' : 'button'}>`;
      }
      return `<div class="pm-attach-chip">${remove}<span class="pm-attach-file">${ICONS.clipboard}</span><span><strong>${name}</strong><em>${meta}</em></span></div>`;
    }).join('');
    return items ? `<div class="pm-attach-list${plainImagePreviews ? ' pm-message-attachment-list' : ''}">${items}</div>` : '';
  }
  
  function _formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
    return `${Math.round(n / 1024 / 102.4) / 10} MB`;
  }
  
  function _fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }
  
  function _fileToText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsText(file);
    });
  }
  
  function _isTextLike(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('text/')
      || /\.(txt|md|json|csv|tsv|log|xml|html|css|js|ts|tsx|jsx|py|yaml|yml)$/i.test(name);
  }
  
  async function _normalizeMobileFile(file) {
    const mimeType = file.type || 'application/octet-stream';
    const base = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || 'Attachment',
      mimeType,
      size: file.size || 0,
      sizeLabel: _formatBytes(file.size || 0),
      file,
    };
    if (mimeType.startsWith('image/')) {
      const dataUrl = await _fileToDataUrl(file);
      return { ...base, kind: 'image', dataUrl, base64: dataUrl.replace(/^data:[^;]+;base64,/, '') };
    }
    if (mimeType.startsWith('video/')) {
      return { ...base, kind: 'video' };
    }
    if (_isTextLike(file) && file.size <= 220_000) {
      return { ...base, kind: 'text', text: await _fileToText(file) };
    }
    return { ...base, kind: 'file' };
  }
  
  function _readMobileFileBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file bytes available'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
        if (!base64) reject(new Error('Could not read file bytes'));
        else resolve(base64);
      };
      reader.onerror = () => reject(reader.error || new Error('Could not read file bytes'));
      reader.readAsDataURL(file);
    });
  }
  
  async function _uploadMobileChatAttachments(files = [], options = {}) {
    const list = Array.isArray(files) ? files : [];
    const results = [];
    for (const f of list) {
      const filename = f.name || 'attachment';
      const ext = _mobileFileExt(filename);
      try {
        if (options.signal?.aborted) {
          const abortError = new Error('Request stopped');
          abortError.name = 'AbortError';
          throw abortError;
        }
        if (f.kind === 'text' && f.text != null) {
          const r = await uploadMobileTextFile({ filename, content: String(f.text || ''), signal: options.signal });
          const workspacePath = r?.absPath || r?.path || '';
          f.workspacePath = workspacePath;
          f.uploadState = 'uploaded';
          delete f.uploadError;
          results.push({ name: filename, ext, workspacePath, relPath: r?.relPath || '' });
        } else {
          const base64 = f.base64 || await _readMobileFileBase64(f.file);
          const mimeType = f.mimeType || 'application/octet-stream';
          const r = await uploadMobileBinaryFile({ filename, base64, mimeType, signal: options.signal });
          const workspacePath = r?.absPath || r?.path || '';
          f.workspacePath = workspacePath;
          f.uploadState = 'uploaded';
          delete f.uploadError;
          results.push({
            name: filename,
            ext,
            workspacePath,
            relPath: r?.relPath || '',
            isImage: f.kind === 'image',
            isVideo: f.kind === 'video',
            binary: f.kind !== 'text',
            mimeType,
            base64: f.kind === 'image' ? base64 : undefined,
          });
        }
      } catch (err) {
        if (options.signal?.aborted) throw err;
        f.uploadState = f.kind === 'image' ? 'vision_only' : 'failed';
        f.uploadError = err?.message || String(err || 'Upload failed');
        results.push({
          name: filename,
          ext,
          workspacePath: '',
          isImage: f.kind === 'image',
          isVideo: f.kind === 'video',
          binary: f.kind !== 'text',
          mimeType: f.mimeType || '',
          base64: f.kind === 'image' ? f.base64 : undefined,
          error: f.uploadError,
        });
      }
    }
    return results;
  }
  
  function _buildMobileFileContextNote(uploadResults = []) {
    const list = Array.isArray(uploadResults) ? uploadResults : [];
    if (!list.length) return '';
    const lines = list.map((r) => {
      if (r.workspacePath) return `  - "${r.name}" -> saved to: ${r.workspacePath}`;
      if (r.isImage) return `  - "${r.name}" -> attached for vision analysis; workspace upload failed${r.error ? `: ${r.error}` : ''}`;
      return `  - "${r.name}" -> upload failed${r.error ? `: ${r.error}` : ''}`;
    });
    const hasImages = list.some((r) => r.isImage && r.base64);
    return `\n\n[UPLOADED FILES]\n${lines.join('\n')}${hasImages ? '\nImages are attached directly for vision analysis.' : ''}\nUse the exact workspace paths above to read, edit, present, or process the attached files.`;
  }
  
  const MOBILE_EMPTY_CHAT_STARTER_PROMPTS = [
    {
      title: 'Start a new build',
      body: 'Shape a page, app mockup, workflow, or feature plan inside the current project.',
      prompt: 'Help me start a new build in this project. Ask only for the key missing details, then turn it into a concrete implementation plan.',
    },
    {
      title: 'Review recent momentum',
      body: 'Look across recent Prometheus work and suggest the next highest-leverage move.',
      prompt: 'Review the recent Prometheus project momentum and suggest the single highest-leverage next step, with a short plan for how to execute it.',
    },
    {
      title: 'Turn an idea into a plan',
      body: 'Take a rough thought and convert it into a scoped build, research, or agent task.',
      prompt: 'Help me turn a rough idea into a clear plan. Start by making the idea concrete, then propose the smallest useful first version.',
    },
  ];
  let mobileEmptyChatBrainCards = [];
  let mobileEmptyChatBrainCardsLoaded = false;
  let mobileEmptyChatBrainCardsLoading = false;
  
  function _normalizeMobileEmptyChatBrainCard(card) {
    if (!card || typeof card !== 'object') return null;
    const title = String(card.title || '').trim();
    const body = String(card.body || '').trim();
    const prompt = String(card.prompt || '').trim();
    if (!title || !body || !prompt) return null;
    return { title, body, prompt };
  }
  
  function _getMobileEmptyChatStarterCards() {
    return mobileEmptyChatBrainCards.length ? mobileEmptyChatBrainCards : MOBILE_EMPTY_CHAT_STARTER_PROMPTS;
  }
  
  async function _loadMobileEmptyChatBrainCards(options = {}) {
    const force = options?.force === true;
    if (!force && (mobileEmptyChatBrainCardsLoaded || mobileEmptyChatBrainCardsLoading)) return;
    if (mobileEmptyChatBrainCardsLoading) return;
    mobileEmptyChatBrainCardsLoading = true;
    try {
      const data = await mobileGatewayFetch('/api/brain/pulse-cards');
      mobileEmptyChatBrainCards = Array.isArray(data?.cards)
        ? data.cards.map(_normalizeMobileEmptyChatBrainCard).filter(Boolean).slice(0, 3)
        : [];
      mobileEmptyChatBrainCardsLoaded = true;
    } catch (err) {
      console.warn('[mobile chat] failed to load Brain pulse cards:', err);
      mobileEmptyChatBrainCards = [];
      mobileEmptyChatBrainCardsLoaded = true;
    } finally {
      mobileEmptyChatBrainCardsLoading = false;
    }
    if (String(__pmChat.activeSessionId || '') === MOBILE_CHAT_SESSION_ID) {
      _renderMobileChatSessionNow(MOBILE_CHAT_SESSION_ID);
    }
  }
  
  function _renderMobileEmptyChatStarterCards() {
    const cards = _getMobileEmptyChatStarterCards();
    return `<div class="pm-mobile-empty-chat" aria-label="Starter prompts">
      <div class="pm-mobile-empty-chat-cards">
        ${cards.map((card, index) => `
          <button class="pm-mobile-empty-chat-card" type="button" aria-label="${escapeHtml(`${card.title}: ${card.body}`)}" data-mobile-starter-prompt="${index}">
            <span class="pm-mobile-empty-chat-card-title" aria-hidden="true">${escapeHtml(card.title)}</span>
            <span class="pm-mobile-empty-chat-card-body">${escapeHtml(card.body)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
  }
  
  function _threadForMobileSessionKey(key = '') {
    const sid = String(key || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    if (!Array.isArray(__pmChat.threads?.[sid])) __pmChat.threads[sid] = [];
    return { sid, thread: __pmChat.threads[sid] };
  }
  
  function _mobileSessionIdForRenderKey(key = '') {
    return String(key || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  }
  
  function _commitMobileTranscriptCache(sessionId, source = 'mobile-render-commit') {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    const thread = Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [];
    return mobileChatRuntimeAdapter.replaceTranscript(sid, thread, {
      source,
      pageInfo: __pmChat.historyPagination?.[sid],
    });
  }
  
  function _findMobileVoiceWorkgroupMessage(workgroupId) {
    const id = String(workgroupId || '').trim();
    if (!id) return null;
    for (const [sessionId, thread] of Object.entries(__pmChat.threads || {})) {
      if (!Array.isArray(thread)) continue;
      const message = thread.find((item) => String(item?.voiceWorkgroup?.id || '') === id);
      if (message) return { sessionId, thread, message };
    }
    return null;
  }
  
  function _findMobileVoiceWorkerByTaskId(taskId) {
    const id = String(taskId || '').trim();
    if (!id) return null;
    for (const [sessionId, thread] of Object.entries(__pmChat.threads || {})) {
      if (!Array.isArray(thread)) continue;
      for (const message of thread) {
        const workgroup = message?.voiceWorkgroup;
        const worker = (Array.isArray(workgroup?.workers) ? workgroup.workers : [])
          .find((item) => String(item?.taskId || '').trim() === id);
        if (worker) return { sessionId, thread, message, workgroup, worker };
      }
    }
    return null;
  }
  
  function _appendMobileVoiceWorkerProcess(taskId, type, content, source = {}) {
    const found = _findMobileVoiceWorkerByTaskId(taskId);
    const text = String(content || '').trim();
    if (!found?.worker || !text) return false;
    if (!Array.isArray(found.worker.processEntries)) found.worker.processEntries = [];
    const entry = {
      t: Number(source?.t || source?.timestamp || Date.now()) || Date.now(),
      type: String(type || source?.type || 'event').trim() || 'event',
      content: text,
      detail: String(source?.detail || '').trim(),
    };
    const previous = found.worker.processEntries[found.worker.processEntries.length - 1];
    if (!previous || previous.type !== entry.type || previous.content !== entry.content) {
      found.worker.processEntries.push(entry);
      found.worker.processEntries = found.worker.processEntries.slice(-40);
    }
    found.worker.updatedAt = Math.max(Number(found.worker.updatedAt || 0), entry.t);
    if (String(__pmChat.activeSessionId || '').trim() === found.sessionId) _renderMobileChatSessionNow(found.sessionId);
    if (String(__pmVoice?.targetSessionId || '').trim() === found.sessionId) __pmVoice.renderRecent?.();
    return true;
  }
  
  function _appendMobilePrimaryWorkerProcess(link, type, content, source = {}) {
    if (!link || typeof link !== 'object') return;
    const text = String(content || '').trim();
    if (!text) return;
    if (!Array.isArray(link.processEntries)) link.processEntries = [];
    const entry = {
      t: Number(source?.t || source?.timestamp || Date.now()) || Date.now(),
      type: String(type || 'event').trim() || 'event',
      content: text,
      detail: String(source?.detail || '').trim(),
    };
    const previous = link.processEntries[link.processEntries.length - 1];
    if (!previous || previous.type !== entry.type || previous.content !== entry.content) {
      link.processEntries.push(entry);
      link.processEntries = link.processEntries.slice(-40);
    }
    _appendMobileVoiceWorkerProcess(link.taskId, entry.type, entry.content, entry);
  }
  
  const _mobileVoiceWorkerJournalTimers = new Map();
  function _refreshMobileVoiceWorkerJournal(taskId, delayMs = 120) {
    const id = String(taskId || '').trim();
    if (!id || !_findMobileVoiceWorkerByTaskId(id)) return;
    const prior = _mobileVoiceWorkerJournalTimers.get(id);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(async () => {
      _mobileVoiceWorkerJournalTimers.delete(id);
      try {
        const detail = await loadBgTaskDetail(id);
        const found = _findMobileVoiceWorkerByTaskId(id);
        if (!found?.worker || !detail?.success || !detail.task) return;
        found.worker.processEntries = (Array.isArray(detail.task.journal) ? detail.task.journal : [])
          .map((entry) => ({
            t: Number(entry?.t || entry?.timestamp || Date.now()) || Date.now(),
            type: String(entry?.type || 'event').trim() || 'event',
            content: String(entry?.content || entry?.detail || '').trim(),
            detail: String(entry?.detail || '').trim(),
          }))
          .filter((entry) => entry.content)
          .slice(-40);
        found.worker.status = String(detail.task.status || found.worker.status || 'queued').toLowerCase();
        found.workgroup.status = _mobileVoiceWorkgroupStatus(found.workgroup.workers);
        if (String(__pmChat.activeSessionId || '').trim() === found.sessionId) _renderMobileChatSessionNow(found.sessionId);
        if (String(__pmVoice?.targetSessionId || '').trim() === found.sessionId) __pmVoice.renderRecent?.();
      } catch {}
    }, Math.max(0, Number(delayMs) || 0));
    _mobileVoiceWorkerJournalTimers.set(id, timer);
  }
  
  function _upsertMobileVoiceWorkgroup(sessionId, rawWorkgroup, acknowledgement = '', options = {}) {
    const sid = String(sessionId || rawWorkgroup?.parentSessionId || '').trim();
    const workgroup = _normalizeMobileVoiceWorkgroup(rawWorkgroup);
    if (!sid || !workgroup) return null;
    if (!Array.isArray(__pmChat.threads[sid])) __pmChat.threads[sid] = [];
    const thread = __pmChat.threads[sid];
    let message = thread.find((item) => String(item?.voiceWorkgroup?.id || '') === workgroup.id);
    if (message) {
      const previousWorkers = new Map((message.voiceWorkgroup?.workers || []).map((worker) => [String(worker?.taskId || ''), worker]));
      workgroup.workers.forEach((worker) => {
        const previous = previousWorkers.get(String(worker.taskId || ''));
        if (previous?.processEntries?.length && !worker.processEntries.length) {
          worker.processEntries = previous.processEntries.slice(-40);
        }
      });
      message.voiceWorkgroup = workgroup;
      if (acknowledgement && !String(message.body?.text || message.content || '').trim()) {
        message.body = { ...(message.body || {}), sender: message.body?.sender || 'Prometheus', text: acknowledgement };
        message.content = acknowledgement;
      }
    } else {
      const text = String(acknowledgement || (workgroup.workers.length === 1
        ? `All right — I'm sending out a worker for this.`
        : `All right — I'm sending out ${workgroup.workers.length} workers for this.`)).trim();
      message = {
        role: 'ai',
        timestamp: Number(workgroup.createdAt || Date.now()) || Date.now(),
        time: _nowTime(),
        body: { sender: 'Prometheus', text },
        content: text,
        source: 'voice_workgroup_dispatch',
        voiceWorkgroup: workgroup,
      };
      thread.push(message);
    }
    workgroup.workers
      .filter((worker) => worker.kind === 'background_task' && worker.taskId && !/^bg_/i.test(String(worker.taskId)))
      .forEach((worker) => _refreshMobileVoiceWorkerJournal(worker.taskId, 40));
    _drainPendingMobileVoiceBackgroundEvents(workgroup);
    _removeMobileVoiceWorkersFromBackgroundDock(sid);
    _scheduleMobileThreadCacheSave(sid, 120);
    if (options.render !== false && String(__pmChat.activeSessionId || '').trim() === sid) _renderMobileChatSessionNow(sid);
    if (options.render !== false && String(__pmVoice?.targetSessionId || '').trim() === sid) __pmVoice.renderRecent?.();
    return message;
  }
  
  const _mobileVoiceWorkgroupRestoreRequests = new Map();
  const _pendingMobileVoiceBackgroundEvents = new Map();
  
  function _mobileBackgroundVoiceWorkgroupId(msg = {}) {
    const direct = String(msg.voiceWorkgroupId || msg.workgroupId || '').trim();
    if (direct) return direct;
    const tag = (Array.isArray(msg.tags) ? msg.tags : [])
      .find((value) => String(value || '').startsWith('voice_workgroup:'));
    return tag ? String(tag).slice('voice_workgroup:'.length).trim() : '';
  }
  
  function _mobileBackgroundSpawnIsVoiceWorker(msg = {}) {
    if (msg.voiceDispatch === true || _mobileBackgroundVoiceWorkgroupId(msg)) return true;
    const taskId = _mobileBackgroundSpawnId(msg) || String(msg.id || '').trim();
    return !!(taskId && _findMobileVoiceWorkerByTaskId(taskId));
  }
  
  function _removeMobileVoiceWorkersFromBackgroundDock(sessionId = '') {
    const sid = String(sessionId || '').trim();
    const voiceTaskIds = new Set();
    (Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : []).forEach((message) => {
      (Array.isArray(message?.voiceWorkgroup?.workers) ? message.voiceWorkgroup.workers : [])
        .forEach((worker) => { if (worker?.taskId) voiceTaskIds.add(String(worker.taskId)); });
    });
    let changed = false;
    const lanes = _mobileBackgroundSpawnLanes();
    voiceTaskIds.forEach((taskId) => {
      if (lanes[taskId]) {
        delete lanes[taskId];
        changed = true;
      }
    });
    if (changed) _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid);
    return changed;
  }
  
  function _routeMobileVoiceBackgroundEvent(event = {}, done = false) {
    if (!_mobileBackgroundSpawnIsVoiceWorker(event)) return false;
    const taskId = _mobileBackgroundSpawnId(event) || String(event.id || '').trim();
    const workgroupId = _mobileBackgroundVoiceWorkgroupId(event);
    const found = taskId ? _findMobileVoiceWorkerByTaskId(taskId) : null;
    if (!found?.worker) {
      if (taskId) {
        const queued = _pendingMobileVoiceBackgroundEvents.get(taskId) || [];
        queued.push({ event, done });
        _pendingMobileVoiceBackgroundEvents.set(taskId, queued.slice(-40));
      }
      if (workgroupId) {
        mobileGatewayFetch(`/api/voice-agent/workgroups/${encodeURIComponent(workgroupId)}`)
          .then((data) => _upsertMobileVoiceWorkgroup(event.sessionId, data?.workgroup))
          .catch(() => {});
      }
      return true;
    }
    const eventType = String(event.eventType || event.type || '').trim();
    const action = String(event.action || event.name || event.toolName || '').trim();
    const detail = done
      ? String(event.result || event.error || (event.state === 'failed' ? 'Worker failed.' : 'Worker complete.')).trim()
      : eventType === 'tool_call'
        ? `${action || 'Tool'}${event.args ? `(${_safeJsonPreview(event.args, 120)})` : ''}`
        : eventType === 'tool_result'
          ? `${action || 'Tool'}: ${_safeJsonPreview(event.result || event.output || event.error || 'complete', 180)}`
          : String(event.message || event.thinking || event.text || event.current_step || event.state || '').trim();
    if (detail) _appendMobileVoiceWorkerProcess(taskId, done ? (event.state === 'failed' ? 'error' : 'final') : eventType, detail, event);
    if (done) {
      found.worker.status = event.state === 'failed' || event.error ? 'failed' : 'complete';
      found.worker.finalResult = String(event.result || event.error || '').trim();
      found.worker.updatedAt = Date.now();
      found.workgroup.status = _mobileVoiceWorkgroupStatus(found.workgroup.workers);
      _scheduleMobileThreadCacheSave(found.sessionId, 120);
      if (String(__pmChat.activeSessionId || '').trim() === found.sessionId) _renderMobileChatSessionNow(found.sessionId);
      if (String(__pmVoice?.targetSessionId || '').trim() === found.sessionId) __pmVoice.renderRecent?.();
    }
    _removeMobileVoiceWorkersFromBackgroundDock(found.sessionId);
    return true;
  }
  
  function _drainPendingMobileVoiceBackgroundEvents(workgroup) {
    (Array.isArray(workgroup?.workers) ? workgroup.workers : []).forEach((worker) => {
      const taskId = String(worker?.taskId || '').trim();
      const queued = taskId ? _pendingMobileVoiceBackgroundEvents.get(taskId) : null;
      if (!queued?.length) return;
      _pendingMobileVoiceBackgroundEvents.delete(taskId);
      queued.forEach((item) => _routeMobileVoiceBackgroundEvent(item.event, item.done));
    });
  }
  
  function _restoreMobileVoiceWorkgroupsForSession(sessionId, { render = true } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid || sid === MOBILE_CHAT_SESSION_ID) return Promise.resolve([]);
    const existing = _mobileVoiceWorkgroupRestoreRequests.get(sid);
    if (existing) return existing;
    const request = mobileGatewayFetch(`/api/voice-agent/workgroups/session/${encodeURIComponent(sid)}?limit=8`)
      .then((data) => {
        const workgroups = Array.isArray(data?.workgroups) ? data.workgroups.slice().reverse() : [];
        workgroups.forEach((workgroup) => _upsertMobileVoiceWorkgroup(sid, workgroup, '', { render: false }));
        if (workgroups.length) {
          __pmChat.threads[sid] = _reconcileMobileThreadOrder(__pmChat.threads[sid] || []);
          if (String(__pmChat.activeSessionId || '').trim() === sid) {
            __pmChat.thread = __pmChat.threads[sid];
            if (render) _renderMobileChatSessionNow(sid);
          }
          if (String(__pmVoice?.targetSessionId || '').trim() === sid) __pmVoice.renderRecent?.();
          _scheduleMobileThreadCacheSave(sid, 120);
        }
        return workgroups;
      })
      .catch((err) => {
        console.warn('[mobile voice workgroup] restore failed', { sessionId: sid, error: String(err?.message || err) });
        return [];
      })
      .finally(() => _mobileVoiceWorkgroupRestoreRequests.delete(sid));
    _mobileVoiceWorkgroupRestoreRequests.set(sid, request);
    return request;
  }
  
  function _applyMobileVoiceWorkerUpdate(event = {}) {
    const workgroupId = String(event.workgroupId || '').trim();
    const taskId = String(event.taskId || '').trim();
    if (!workgroupId || !taskId) return false;
    const found = _findMobileVoiceWorkgroupMessage(workgroupId);
    if (!found?.message?.voiceWorkgroup) return false;
    const workgroup = found.message.voiceWorkgroup;
    const worker = (workgroup.workers || []).find((item) => String(item.taskId || '') === taskId);
    if (!worker) return false;
    const kind = String(event.kind || '').toLowerCase();
    worker.status = String(event.status || (kind === 'complete' ? 'complete' : kind === 'paused' ? 'paused' : 'running')).toLowerCase();
    worker.currentStep = String(event.currentStep || worker.currentStep || '').trim();
    worker.completedSteps = Array.isArray(event.completedSteps) ? event.completedSteps.map((step) => String(step || '').trim()).filter(Boolean) : worker.completedSteps;
    worker.finalResult = String(event.finalResult || worker.finalResult || '').trim();
    worker.updatedAt = Number(event.timestamp || Date.now()) || Date.now();
    workgroup.updatedAt = worker.updatedAt;
    workgroup.status = _mobileVoiceWorkgroupStatus(workgroup.workers);
    if (String(__pmChat.activeSessionId || '').trim() === found.sessionId) _renderMobileChatSessionNow(found.sessionId);
    if (String(__pmVoice?.targetSessionId || '').trim() === found.sessionId) __pmVoice.renderRecent?.();
    return true;
  }
  
  function _updateMobilePrimaryWorkgroupLink(link, status, finalResult = '') {
    if (!link || typeof link !== 'object') return Promise.resolve(null);
    link.status = String(status || link.status || 'running').trim();
    link.finalResult = String(finalResult || link.finalResult || '').trim();
    if (!link.workgroupId || !link.taskId) return Promise.resolve(null);
    return mobileGatewayFetch(`/api/voice-agent/workgroups/${encodeURIComponent(link.workgroupId)}/workers/${encodeURIComponent(link.taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: link.status,
        currentStep: link.status === 'running' ? 'Working in this chat' : '',
        finalResult: link.finalResult,
      }),
    }).then((data) => {
      if (data?.workgroup) _upsertMobileVoiceWorkgroup(data.workgroup.parentSessionId, data.workgroup);
      return data;
    }).catch(() => null);
  }
  
  if (typeof window !== 'undefined' && !window.__pmMobileVoiceWorkgroupBridgeInstalled) {
    window.__pmMobileVoiceWorkgroupBridgeInstalled = true;
    wsEventBus.on('voice_workgroup_dispatched', (event = {}) => {
      _upsertMobileVoiceWorkgroup(event.sessionId, event.workgroup || { id: event.workgroupId, workers: event.tasks, mode: event.mode, delivery: event.delivery }, event.acknowledgement);
    });
    wsEventBus.on('voice_worker_update', (event = {}) => {
      if (_applyMobileVoiceWorkerUpdate(event)) return;
      const workgroupId = String(event.workgroupId || '').trim();
      if (!workgroupId) return;
      mobileGatewayFetch(`/api/voice-agent/workgroups/${encodeURIComponent(workgroupId)}`)
        .then((data) => {
          const message = _upsertMobileVoiceWorkgroup(event.sessionId, data?.workgroup);
          if (message) _applyMobileVoiceWorkerUpdate(event);
        })
        .catch(() => {});
    });
    wsEventBus.on('bg_agent_event', (event = {}) => _routeMobileVoiceBackgroundEvent(event, false));
    wsEventBus.on('bg_agent_done', (event = {}) => _routeMobileVoiceBackgroundEvent(event, true));
    wsEventBus.on('task_running', (event = {}) => {
      const taskId = String(event.taskId || '').trim();
      if (_appendMobileVoiceWorkerProcess(taskId, 'resume', 'Worker started.', event)) _refreshMobileVoiceWorkerJournal(taskId);
    });
    wsEventBus.on('task_tool_call', (event = {}) => {
      const taskId = String(event.taskId || '').trim();
      const tool = String(event.tool || event.action || 'tool').trim();
      const args = _safeJsonPreview(event.args || {}, 100);
      if (_appendMobileVoiceWorkerProcess(taskId, 'tool_call', `${tool}${args ? `(${args})` : '()'}`, event)) _refreshMobileVoiceWorkerJournal(taskId);
    });
    wsEventBus.on('task_tool_result', (event = {}) => {
      const taskId = String(event.taskId || '').trim();
      const tool = String(event.tool || event.action || 'tool').trim();
      const result = _safeJsonPreview(event.result || event.output || event.error || '', 140);
      if (_appendMobileVoiceWorkerProcess(taskId, event.error ? 'error' : 'tool_result', `${tool}: ${result || 'complete'}`, event)) _refreshMobileVoiceWorkerJournal(taskId);
    });
    wsEventBus.on('task_reasoning', (event = {}) => {
      const taskId = String(event.taskId || '').trim();
      const text = String(event.text || event.reasoning || '').trim();
      if (_appendMobileVoiceWorkerProcess(taskId, 'reasoning', text, event)) _refreshMobileVoiceWorkerJournal(taskId);
    });
    wsEventBus.on('task_step_done', (event = {}) => {
      const taskId = String(event.taskId || '').trim();
      if (_appendMobileVoiceWorkerProcess(taskId, 'status_push', 'Step complete signal received.', event)) _refreshMobileVoiceWorkerJournal(taskId);
    });
    ['task_panel_update', 'task_complete', 'task_paused', 'task_awaiting_input', 'task_needs_assistance'].forEach((eventName) => {
      wsEventBus.on(eventName, (event = {}) => _refreshMobileVoiceWorkerJournal(event.taskId, eventName === 'task_panel_update' ? 80 : 0));
    });
    wsEventBus.on('ws:open', () => {
      const sid = String(__pmChat.activeSessionId || __pmVoice?.targetSessionId || '').trim();
      if (sid) _restoreMobileVoiceWorkgroupsForSession(sid).catch(() => {});
    });
  }
  
  if (!window.__pmMobileDevEditCoordinationBridgeInstalled) {
    window.__pmMobileDevEditCoordinationBridgeInstalled = true;
    wsEventBus.on('dev_edit_coordination_updated', (msg = {}) => {
      const blockers = Array.isArray(msg.blockers) ? msg.blockers.length : 0;
      if (msg.role === 'waiting') {
        pmToast(`Dev edit verified — waiting for ${blockers || 'other'} coordinated edit${blockers === 1 ? '' : 's'}.`, 'info');
      } else if (msg.role === 'leader' && msg.batchId) {
        pmToast('All coordinated edits are ready. Building and applying once.', 'success');
      }
    });
  }
  
  function _isMobileSessionRenderCurrent(key = '') {
    const sid = String(key || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    return sid === String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
  }
  
  function _renderThread(threadEl, sessionKey = '') {
    const sid = _mobileSessionIdForRenderKey(sessionKey);
    const runtimeRows = mobileChatRuntimeAdapter.getTranscriptRows(sid);
    const thread = runtimeRows.map((row) => row.msg);
    __pmChat.thread = thread;
    const bodyEl = document.getElementById('pm-chat-body');
    const timelineScroll = captureKeyedScrollState(threadEl, _mobileChatScrollTarget(bodyEl));
    _captureMobileWorkerDeckViewState(threadEl);
    const openProc = {};
    const closedProc = new Set();
    const openTraceDrawers = new Set();
    const openTraceGroups = {};
    const closedTraceGroups = new Set();
    const openTerminals = {};
    const stableImageNodes = new Map();
    const approvalDetails = _captureMobileApprovalDetailsState(threadEl);
    const questionDrafts = _captureMobileQuestionDraftState(document);
    try {
      threadEl.querySelectorAll('img[src]').forEach((node) => {
        const src = String(node.getAttribute('src') || '').trim();
        if (!src) return;
        const nodes = stableImageNodes.get(src) || [];
        nodes.push(node);
        stableImageNodes.set(src, nodes);
      });
      threadEl.querySelectorAll('details.pm-process-stream').forEach((d) => {
        const idx = d.closest('[data-msg-index]')?.getAttribute('data-msg-index');
        if (idx == null) return;
        if (d.open) {
          const full = d.querySelector('.pm-process-full');
          openProc[idx] = { scrollTop: full ? full.scrollTop : 0 };
        } else {
          closedProc.add(idx);
        }
      });
      threadEl.querySelectorAll('.pm-trace-drawer.open').forEach((drawer) => {
        const idx = drawer.closest('[data-msg-index]')?.getAttribute('data-msg-index');
        if (idx != null) openTraceDrawers.add(idx);
      });
      threadEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
        const idx = d.closest('[data-msg-index]')?.getAttribute('data-msg-index');
        if (idx == null) return;
        const traceId = d.getAttribute('data-pm-trace-group') || d.getAttribute('data-pm-trace-entry-id') || detailIndex;
        const key = `${idx}:${d.classList.contains('pm-trace-compaction') ? 'compaction' : 'group'}:${traceId}`;
        if (d.open) {
          openTraceGroups[key] = true;
        } else {
          closedTraceGroups.add(key);
        }
      });
      threadEl.querySelectorAll('[data-process-approval-host][data-terminal-open="1"]').forEach((host) => {
        const approvalId = String(host.getAttribute('data-process-approval-host') || '').trim();
        if (!approvalId || !host.parentElement) return;
        const toggle = host.parentElement.querySelector?.('[data-pm-process-action="load-approval"]') || null;
        openTerminals[approvalId] = {
          host,
          toggleText: toggle?.textContent || 'Close terminal',
        };
      });
    } catch {}
    const timelineKey = `mobile:main:${sid}`;
    const timelineEntries = _mobileTimelineEntries(sid, thread, runtimeRows);
    const previousTimeline = mobileTimelineController.peek(timelineKey);
    const timeline = mobileTimelineController.select(timelineKey, timelineEntries, {
      followTail: timelineScroll.nearBottom && !(previousTimeline?.omittedAfter > 0),
      pinnedKeys: timelineScroll.pinnedKeys,
      hidden: document.hidden === true,
    });
    const pagination = __pmChat.historyPagination?.[sid] || {};
    const hasEarlierMessages = timeline.omittedBefore > 0 || pagination.historyTruncated === true;
    const olderMessagesControl = hasEarlierMessages
      ? `<div class="pm-chat-history-loader" data-pm-history-loader data-pm-row-key="timeline-pager:older">
          <button type="button" data-pm-load-older ${pagination.loading ? 'disabled aria-busy="true"' : ''}>
            ${pagination.loading ? 'Loading earlier messages...' : `Load ${PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE} earlier messages`}
          </button>
        </div>`
      : '';
    const renderedMessages = timeline.paintEntries
      .map((entry) => _renderChatMessageHtml(entry.msg, entry.originalIndex, entry.key, entry.signature))
      .join('');
    reconcileKeyedTimelineRows(threadEl, (olderMessagesControl + renderedMessages) || (
      sid === MOBILE_CHAT_SESSION_ID
        ? _renderMobileEmptyChatStarterCards()
        : ''
    ), {
      scroller: _mobileChatScrollTarget(bodyEl),
      scrollState: timelineScroll,
      followBottom: timelineScroll.nearBottom,
      setContents: setInnerHTMLPreservingVisuals,
    });
    _syncMobileQuestionComposerPopover(sid, questionDrafts);
    try {
      threadEl.querySelectorAll('img[src]').forEach((node) => {
        const src = String(node.getAttribute('src') || '').trim();
        const stable = src ? stableImageNodes.get(src)?.shift() : null;
        if (stable && stable !== node && stable.isConnected === false) node.replaceWith(stable);
      });
      Object.keys(openProc).forEach((idx) => {
        if (closedProc.has(idx)) return;
        const msgEl = threadEl.querySelector(`[data-msg-index="${idx}"]`);
        const d = msgEl?.querySelector('details.pm-process-stream');
        if (!d) return;
        d.setAttribute('open', '');
        const full = d.querySelector('.pm-process-full');
        if (full) full.scrollTop = openProc[idx].scrollTop;
      });
      closedProc.forEach((idx) => {
        const msgEl = threadEl.querySelector(`[data-msg-index="${idx}"]`);
        const d = msgEl?.querySelector('details.pm-process-stream');
        if (d) d.removeAttribute('open');
      });
      threadEl.querySelectorAll('[data-msg-index]').forEach((msgEl) => {
        const idx = msgEl.getAttribute('data-msg-index');
        if (!openTraceDrawers.has(idx)) return;
        msgEl.querySelector('.pm-trace-drawer')?.classList.add('open');
        msgEl.querySelector('[data-expandable="trace"]')?.classList.add('expanded');
      });
      threadEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
        const idx = d.closest('[data-msg-index]')?.getAttribute('data-msg-index');
        if (idx == null) return;
        const traceId = d.getAttribute('data-pm-trace-group') || d.getAttribute('data-pm-trace-entry-id') || detailIndex;
        const key = `${idx}:${d.classList.contains('pm-trace-compaction') ? 'compaction' : 'group'}:${traceId}`;
        if (closedTraceGroups.has(key)) d.removeAttribute('open');
        else if (openTraceGroups[key]) d.setAttribute('open', '');
      });
      _restoreMobileApprovalDetailsState(threadEl, approvalDetails);
      _restoreMobileQuestionDraftState(document, questionDrafts);
      Object.entries(openTerminals).forEach(([approvalId, snapshot]) => {
        const nextHost = threadEl.querySelector(`[data-process-approval-host="${_pmCssEscape(approvalId)}"]`);
        if (!nextHost || !snapshot?.host) return;
        nextHost.replaceWith(snapshot.host);
        snapshot.host.dataset.terminalOpen = '1';
        const toggle = snapshot.host.parentElement?.querySelector?.('[data-pm-process-action="load-approval"]');
        if (toggle) toggle.textContent = snapshot.toggleText || 'Close terminal';
      });
    } catch {}
    threadEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
      btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
    });
    _wireMobileProcessRunActions(threadEl);
    _wireMobileChatEnhancements(threadEl);
    _scheduleMobileThreadCacheSave(sid);
    _renderMobileApprovalSheet();
  }
  
  if (!window.__pmToolActivityReadyBridgeInstalled) {
    window.__pmToolActivityReadyBridgeInstalled = true;
    window.addEventListener('prometheus:tool-activity-ready', () => {
      const sessionId = String(__pmChat.activeSessionId || '').trim();
      if (sessionId && document.getElementById('pm-chat-thread')) _renderMobileChatSessionNow(sessionId);
      // Background-agent detail is rendered in the side sheet rather than the
      // main chat thread. Repaint it when the optional rich renderer becomes
      // available so a cold recovery cannot remain on raw TOOL RESULT blocks.
      try { window.__pmMobileBackgroundAgentDetailRender?.(); } catch {}
    });
  }
  
  function _mobileTraceNodeKey(node, index = 0) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
    const groupId = String(node.getAttribute?.('data-pm-trace-group') || '').trim();
    if (groupId) return `group:${groupId}`;
    const entryId = String(node.getAttribute?.('data-pm-trace-entry-id') || '').trim();
    if (entryId) return `entry:${entryId}`;
    const activityId = String(node.getAttribute?.('data-activity-key') || '').trim();
    if (activityId) return `activity:${activityId}`;
    const liveEntryId = String(node.getAttribute?.('data-pm-live-entry-id') || '').trim();
    if (liveEntryId) return `live:${liveEntryId}`;
    return `node:${String(node.tagName || '').toLowerCase()}:${String(node.className || '')}:${index}`;
  }
  
  function _captureMobileTraceDetailsState(root) {
    const state = new Map();
    let fallbackIndex = 0;
    root?.querySelectorAll?.('details')?.forEach((detail) => {
      const key = String(
        detail.getAttribute('data-tool-disclosure-key')
        || detail.getAttribute('data-pm-trace-group')
        || detail.getAttribute('data-pm-trace-entry-id')
        || `${detail.className || 'details'}:${fallbackIndex++}`,
      );
      state.set(key, detail.open === true);
    });
    return state;
  }
  
  function _restoreMobileTraceDetailsState(root, state) {
    if (!root || !(state instanceof Map)) return;
    let fallbackIndex = 0;
    root.querySelectorAll?.('details')?.forEach((detail) => {
      const key = String(
        detail.getAttribute('data-tool-disclosure-key')
        || detail.getAttribute('data-pm-trace-group')
        || detail.getAttribute('data-pm-trace-entry-id')
        || `${detail.className || 'details'}:${fallbackIndex++}`,
      );
      if (!state.has(key)) return;
      detail.open = state.get(key) === true;
    });
  }
  
  function _syncMobileTraceNodeAttributes(current, next) {
    const preserved = new Set(['open']);
    Array.from(current.attributes || []).forEach((attr) => {
      if (!preserved.has(attr.name) && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    });
    Array.from(next.attributes || []).forEach((attr) => {
      if (!preserved.has(attr.name)) current.setAttribute(attr.name, attr.value);
    });
  }
  
  function _patchMobileLiveTraceEntries(currentTrace, nextTrace) {
    if (!currentTrace || !nextTrace) return;
    const existing = new Map();
    Array.from(currentTrace.children).forEach((node, index) => {
      existing.set(_mobileTraceNodeKey(node, index), node);
    });
    const ordered = [];
    Array.from(nextTrace.children).forEach((nextNode, index) => {
      const key = _mobileTraceNodeKey(nextNode, index);
      const currentNode = existing.get(key);
      if (currentNode && currentNode.tagName === nextNode.tagName && currentNode.className === nextNode.className) {
        if (currentNode.outerHTML !== nextNode.outerHTML) {
          const detailsState = _captureMobileTraceDetailsState(currentNode);
          const replacement = nextNode.cloneNode(true);
          _restoreMobileTraceDetailsState(replacement, detailsState);
          currentNode.replaceWith(replacement);
          ordered.push(replacement);
        } else {
          ordered.push(currentNode);
        }
      } else {
        ordered.push(nextNode.cloneNode(true));
      }
    });
    Array.from(currentTrace.children).forEach((node) => {
      if (!ordered.includes(node)) node.remove();
    });
    ordered.forEach((node) => currentTrace.appendChild(node));
  }
  
  function _patchMobileTraceGroup(currentGroup, nextGroup) {
    if (!currentGroup || !nextGroup) return;
    const wasOpen = currentGroup.open === true;
    _syncMobileTraceNodeAttributes(currentGroup, nextGroup);
    if (currentGroup.classList.contains('pm-trace-tool-group')) {
      const currentSummary = Array.from(currentGroup.children).find((node) => node.tagName === 'SUMMARY');
      const nextSummary = Array.from(nextGroup.children).find((node) => node.tagName === 'SUMMARY');
      if (currentSummary && nextSummary && currentSummary.innerHTML !== nextSummary.innerHTML) {
        currentSummary.innerHTML = nextSummary.innerHTML;
      }
      const currentBody = Array.from(currentGroup.children).find((node) => node.classList?.contains('pm-trace-tool-body'));
      const nextBody = Array.from(nextGroup.children).find((node) => node.classList?.contains('pm-trace-tool-body'));
      const currentTrace = Array.from(currentBody?.children || []).find((node) => node.classList?.contains('pm-live-trace'));
      const nextTrace = Array.from(nextBody?.children || []).find((node) => node.classList?.contains('pm-live-trace'));
      if (currentTrace && nextTrace) {
        _patchMobileLiveTraceEntries(currentTrace, nextTrace);
      } else if (currentBody && nextBody && currentBody.innerHTML !== nextBody.innerHTML) {
        const detailsState = _captureMobileTraceDetailsState(currentBody);
        currentBody.innerHTML = nextBody.innerHTML;
        _restoreMobileTraceDetailsState(currentBody, detailsState);
      }
    } else if (currentGroup.innerHTML !== nextGroup.innerHTML) {
      const detailsState = _captureMobileTraceDetailsState(currentGroup);
      currentGroup.innerHTML = nextGroup.innerHTML;
      _restoreMobileTraceDetailsState(currentGroup, detailsState);
    }
    if ('open' in currentGroup) currentGroup.open = wasOpen;
  }
  
  function _patchMobileLiveTraceTimeline(currentTimeline, nextTimeline) {
    if (!currentTimeline || !nextTimeline) return false;
    const existing = new Map();
    Array.from(currentTimeline.children).forEach((node, index) => {
      existing.set(_mobileTraceNodeKey(node, index), node);
    });
    const ordered = [];
    Array.from(nextTimeline.children).forEach((nextNode, index) => {
      const key = _mobileTraceNodeKey(nextNode, index);
      const currentNode = existing.get(key);
      if (currentNode && currentNode.tagName === nextNode.tagName && currentNode.className === nextNode.className) {
        _patchMobileTraceGroup(currentNode, nextNode);
        ordered.push(currentNode);
      } else {
        ordered.push(nextNode.cloneNode(true));
      }
    });
    Array.from(currentTimeline.children).forEach((node) => {
      if (!ordered.includes(node)) node.remove();
    });
    ordered.forEach((node) => currentTimeline.appendChild(node));
    return true;
  }
  
  function _mobileSideThreadNearBottom(threadEl, threshold = 96) {
    if (!threadEl) return true;
    return threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight <= threshold;
  }
  
  function _mobileSideThreadChildKey(node, index = 0) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return `index:${index}`;
    const backgroundId = String(node.getAttribute?.('data-pm-background-agent-message') || '').trim();
    if (backgroundId) return `background:${backgroundId}`;
    const rowKey = String(node.getAttribute?.('data-pm-row-key') || '').trim();
    if (rowKey) return `row:${rowKey}`;
    const messageIndex = String(node.getAttribute?.('data-msg-index') || '').trim();
    if (messageIndex) return `message:${messageIndex}`;
    return `index:${index}`;
  }
  
  function _mobileSideBubbleChildKey(node, index = 0) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return `index:${index}`;
    const traceKey = _mobileTraceNodeKey(node, index);
    if (node.classList?.contains('pm-trace-timeline')) return 'trace-timeline';
    if (node.classList?.contains('pm-work-timer')) return 'work-timer';
    if (node.classList?.contains('pm-sender')) return 'sender';
    if (node.classList?.contains('pm-time')) return 'time';
    const className = String(node.className || '').trim();
    return `child:${String(node.tagName || '').toLowerCase()}:${className}:${traceKey || index}`;
  }
  
  function _patchMobileSideElementContents(current, next) {
    if (!current || !next) return;
    _syncMobileTraceNodeAttributes(current, next);
    if (current.innerHTML === next.innerHTML) return;
    const detailsState = _captureMobileTraceDetailsState(current);
    setInnerHTMLPreservingVisuals(current, next.innerHTML);
    _restoreMobileTraceDetailsState(current, detailsState);
  }
  
  function _patchMobileBackgroundAgentBubble(currentBubble, nextBubble) {
    if (!currentBubble || !nextBubble) return false;
    _syncMobileTraceNodeAttributes(currentBubble, nextBubble);
    const existing = new Map();
    Array.from(currentBubble.children).forEach((node, index) => {
      existing.set(_mobileSideBubbleChildKey(node, index), node);
    });
    const ordered = [];
    Array.from(nextBubble.children).forEach((nextNode, index) => {
      const key = _mobileSideBubbleChildKey(nextNode, index);
      const currentNode = existing.get(key);
      if (!currentNode || currentNode.tagName !== nextNode.tagName || currentNode.className !== nextNode.className) {
        ordered.push(nextNode.cloneNode(true));
        return;
      }
      if (nextNode.classList?.contains('pm-trace-timeline')) {
        _patchMobileLiveTraceTimeline(currentNode, nextNode);
        _syncMobileTraceNodeAttributes(currentNode, nextNode);
      } else {
        _patchMobileSideElementContents(currentNode, nextNode);
      }
      ordered.push(currentNode);
    });
    Array.from(currentBubble.children).forEach((node) => {
      if (!ordered.includes(node)) node.remove();
    });
    ordered.forEach((node) => currentBubble.appendChild(node));
    return true;
  }
  
  function _patchMobileBackgroundAgentMessage(currentMessage, nextMessage) {
    if (!currentMessage || !nextMessage) return false;
    _syncMobileTraceNodeAttributes(currentMessage, nextMessage);
    const currentBubble = currentMessage.querySelector?.('.pm-bubble');
    const nextBubble = nextMessage.querySelector?.('.pm-bubble');
    if (!currentBubble || !nextBubble) return false;
    return _patchMobileBackgroundAgentBubble(currentBubble, nextBubble);
  }
  
  function _reconcileMobileBackgroundAgentSideThread(threadEl, markup) {
    if (!threadEl) return;
    const nextWrap = document.createElement('div');
    nextWrap.innerHTML = String(markup || '');
    const existing = new Map();
    Array.from(threadEl.children).forEach((node, index) => {
      existing.set(_mobileSideThreadChildKey(node, index), node);
    });
    const ordered = [];
    Array.from(nextWrap.children).forEach((nextNode, index) => {
      const key = _mobileSideThreadChildKey(nextNode, index);
      const currentNode = existing.get(key);
      if (!currentNode || currentNode.tagName !== nextNode.tagName || currentNode.className !== nextNode.className) {
        ordered.push(nextNode.cloneNode(true));
        return;
      }
      if (nextNode.hasAttribute('data-pm-background-agent-message')) {
        _patchMobileBackgroundAgentMessage(currentNode, nextNode);
      } else {
        _patchMobileSideElementContents(currentNode, nextNode);
      }
      ordered.push(currentNode);
    });
    Array.from(threadEl.children).forEach((node) => {
      if (!ordered.includes(node)) node.remove();
    });
    ordered.forEach((node) => threadEl.appendChild(node));
  }
  
  function _patchMobileThreadMessage(threadEl, message, index) {
    if (!threadEl || !message) return false;
    _captureMobileWorkerDeckViewState(threadEl);
    const msgIndex = Number.isFinite(Number(index)) ? Number(index) : _activeMobileThread().indexOf(message);
    if (msgIndex < 0) return false;
    const currentEl = threadEl.querySelector(`[data-msg-index="${msgIndex}"]`);
    if (!currentEl) return false;
    const nextWrap = document.createElement('div');
    nextWrap.innerHTML = _renderChatMessageHtml(
      message,
      msgIndex,
      currentEl.getAttribute('data-pm-row-key') || '',
      chatTimelineRowSignature(message),
    );
    const nextEl = nextWrap.firstElementChild;
    if (!nextEl) return false;
    const currentClass = String(currentEl.className || '');
    const nextClass = String(nextEl.className || '');
    const currentStreaming = currentEl.getAttribute('data-streaming') === '1';
    const nextStreaming = nextEl.getAttribute('data-streaming') === '1';
    const sameMessageShell = currentEl.getAttribute('data-msg-index') === nextEl.getAttribute('data-msg-index')
      && currentEl.tagName === nextEl.tagName
      && currentClass === nextClass;
    if (!sameMessageShell) {
      if (currentEl.tagName === nextEl.tagName) {
        currentEl.className = nextClass;
        if (nextStreaming) currentEl.setAttribute('data-streaming', '1');
        else currentEl.removeAttribute('data-streaming');
        setInnerHTMLPreservingVisuals(currentEl, nextEl.innerHTML);
      } else {
        currentEl.replaceWith(nextEl);
      }
    } else {
      if (nextStreaming) currentEl.setAttribute('data-streaming', '1');
      else currentEl.removeAttribute('data-streaming');
      currentEl.setAttribute('data-pm-row-signature', nextEl.getAttribute('data-pm-row-signature') || '');
      const currentBubble = currentEl.querySelector('.pm-bubble');
      const nextBubble = nextEl.querySelector('.pm-bubble');
      if (!currentBubble || !nextBubble) return false;
      const wasStreaming = currentStreaming;
      const isStreaming = nextStreaming;
      const finalizedThisPatch = wasStreaming && !isStreaming;
      const openProc = {};
      const closedProc = new Set();
      const openTraceGroups = {};
      const closedTraceGroups = new Set();
      const openTerminals = {};
      const stableVisionPreviews = {};
      const stableImageNodes = new Map();
      const stableTraceSummaryLabels = {};
      const stableLiveTraceTimeline = currentBubble.querySelector('.pm-trace-timeline');
      let stablePendingImageBatch = null;
      let stableThinkingDots = null;
      const approvalDetails = _captureMobileApprovalDetailsState(currentEl);
      const questionDrafts = _captureMobileQuestionDraftState(currentEl);
      try {
        currentEl.querySelectorAll('[data-pm-live-vision-preview]').forEach((node) => {
          const key = String(node.getAttribute('data-pm-live-vision-preview') || '').trim();
          if (key) stableVisionPreviews[key] = node;
        });
        // Streaming trace updates rebuild the bubble frequently. Retain every
        // already-decoded image node (generated media, presented files, and
        // attachments) so iOS does not flash an empty frame while decoding the
        // exact same source again after each tool event.
        currentBubble.querySelectorAll('img[src]').forEach((node) => {
          const src = String(node.getAttribute('src') || '').trim();
          if (!src) return;
          const nodes = stableImageNodes.get(src) || [];
          nodes.push(node);
          stableImageNodes.set(src, nodes);
        });
        currentEl.querySelectorAll('.pm-trace-tool-summary strong[data-pm-trace-summary-key]').forEach((node) => {
          const groupKey = node.closest('details.pm-trace-tool-group')?.getAttribute('data-pm-trace-group') || '';
          const key = String(node.getAttribute('data-pm-trace-summary-key') || '').trim();
          if (groupKey && key) stableTraceSummaryLabels[groupKey] = { key, node };
        });
        stablePendingImageBatch = currentBubble.querySelector('.pm-generated-image-batch--pending');
        stableThinkingDots = currentBubble.querySelector('.pm-thinking-dots');
        currentEl.querySelectorAll('details.pm-process-stream').forEach((d, detailIndex) => {
          if (d.open) {
            const full = d.querySelector('.pm-process-full');
            openProc[detailIndex] = { scrollTop: full ? full.scrollTop : 0 };
          } else {
            closedProc.add(detailIndex);
          }
        });
        currentEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
          const traceId = d.getAttribute('data-pm-trace-group') || d.getAttribute('data-pm-trace-entry-id') || detailIndex;
          const key = `${d.classList.contains('pm-trace-compaction') ? 'compaction' : 'group'}:${traceId}`;
          if (finalizedThisPatch) {
            closedTraceGroups.add(key);
            return;
          }
          if (d.open) {
            openTraceGroups[key] = true;
          } else {
            closedTraceGroups.add(key);
          }
        });
        currentEl.querySelectorAll('[data-process-approval-host][data-terminal-open="1"]').forEach((host) => {
          const approvalId = String(host.getAttribute('data-process-approval-host') || '').trim();
          if (!approvalId || !host.parentElement) return;
          const toggle = host.parentElement.querySelector?.('[data-pm-process-action="load-approval"]') || null;
          openTerminals[approvalId] = {
            host,
            toggleText: toggle?.textContent || 'Close terminal',
          };
        });
      } catch {}
      setInnerHTMLPreservingVisuals(currentBubble, nextBubble.innerHTML);
      try {
        const nextLiveTraceTimeline = currentBubble.querySelector('.pm-trace-timeline');
        if (stableLiveTraceTimeline && nextLiveTraceTimeline && _patchMobileLiveTraceTimeline(stableLiveTraceTimeline, nextLiveTraceTimeline)) {
          nextLiveTraceTimeline.replaceWith(stableLiveTraceTimeline);
        }
        currentBubble.querySelectorAll('[data-pm-live-vision-preview]').forEach((node) => {
          const key = String(node.getAttribute('data-pm-live-vision-preview') || '').trim();
          const stable = key ? stableVisionPreviews[key] : null;
          if (stable && stable !== node) node.replaceWith(stable);
        });
        currentBubble.querySelectorAll('img[src]').forEach((node) => {
          const src = String(node.getAttribute('src') || '').trim();
          const stable = src ? stableImageNodes.get(src)?.shift() : null;
          if (stable && stable !== node && stable.isConnected === false) node.replaceWith(stable);
        });
        currentBubble.querySelectorAll('.pm-trace-tool-summary strong[data-pm-trace-summary-key]').forEach((node) => {
          const groupKey = node.closest('details.pm-trace-tool-group')?.getAttribute('data-pm-trace-group') || '';
          const key = String(node.getAttribute('data-pm-trace-summary-key') || '').trim();
          const stable = groupKey ? stableTraceSummaryLabels[groupKey] : null;
          if (stable?.node && stable.key === key && stable.node !== node) {
            node.replaceWith(stable.node);
          } else if (!stable || stable.key !== key) {
            node.classList.add('pm-trace-summary-swap');
          }
        });
        if (stablePendingImageBatch) {
          const nextPending = currentBubble.querySelector('.pm-generated-image-batch--pending');
          if (nextPending && nextPending !== stablePendingImageBatch) nextPending.replaceWith(stablePendingImageBatch);
        }
        if (stableThinkingDots) {
          const nextDots = currentBubble.querySelector('.pm-thinking-dots');
          if (nextDots && nextDots !== stableThinkingDots) nextDots.replaceWith(stableThinkingDots);
        }
      } catch {}
      const nextActions = nextEl.querySelector('[data-msg-action]') ? nextEl.querySelectorAll('[data-msg-action]') : null;
      const currentActionsHost = currentEl.querySelector('.pm-msg-actions');
      const nextActionsHost = nextEl.querySelector('.pm-msg-actions');
      if (currentActionsHost && nextActionsHost) currentActionsHost.innerHTML = nextActionsHost.innerHTML;
      else if (!currentActionsHost && nextActionsHost) currentBubble.insertAdjacentElement('afterend', nextActionsHost);
      void nextActions;
      try {
        currentEl.querySelectorAll('details.pm-process-stream').forEach((d, detailIndex) => {
          if (closedProc.has(detailIndex)) d.removeAttribute('open');
          else if (openProc[detailIndex]) {
            d.setAttribute('open', '');
            const full = d.querySelector('.pm-process-full');
            if (full) full.scrollTop = openProc[detailIndex].scrollTop;
          }
        });
        currentEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
          const traceId = d.getAttribute('data-pm-trace-group') || d.getAttribute('data-pm-trace-entry-id') || detailIndex;
          const key = `${d.classList.contains('pm-trace-compaction') ? 'compaction' : 'group'}:${traceId}`;
          if (closedTraceGroups.has(key)) d.removeAttribute('open');
          else if (openTraceGroups[key]) d.setAttribute('open', '');
        });
        _restoreMobileApprovalDetailsState(currentEl, approvalDetails);
        _restoreMobileQuestionDraftState(currentEl, questionDrafts);
        Object.entries(openTerminals).forEach(([approvalId, snapshot]) => {
          const nextHost = currentEl.querySelector(`[data-process-approval-host="${_pmCssEscape(approvalId)}"]`);
          if (!nextHost || !snapshot?.host) return;
          nextHost.replaceWith(snapshot.host);
          snapshot.host.dataset.terminalOpen = '1';
          const toggle = snapshot.host.parentElement?.querySelector?.('[data-pm-process-action="load-approval"]');
          if (toggle) toggle.textContent = snapshot.toggleText || 'Close terminal';
        });
      } catch {}
    }
    const patchedEl = threadEl.querySelector(`[data-msg-index="${msgIndex}"]`) || nextEl;
    patchedEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
      btn.addEventListener('click', () => _resolveMobileApprovalButton(btn));
    });
    _wireMobileProcessRunActions(patchedEl);
    _wireMobileChatEnhancements(patchedEl);
    try {
      _markMobileLiveStreamMotion(patchedEl, String(__pmChat?.activeSessionId || ''));
    } catch {}
    _scheduleMobileThreadCacheSave(__pmChat?.activeSessionId || '');
    return true;
  }
  
  function _patchLatestMobileStreamingMessage(threadEl, bodyEl, key = 'chat') {
    if (!_isMobileSessionRenderCurrent(key)) return true;
    const sid = _mobileSessionIdForRenderKey(key);
    _commitMobileTranscriptCache(sid, 'mobile-stream-patch');
    const rows = mobileChatRuntimeAdapter.getTranscriptRows(sid);
    const messageRow = [...rows].reverse().find((row) => _isMobileAssistantMessage(row.msg) && row.msg.streaming === true);
    const message = messageRow?.msg || null;
    if (!message) return false;
    const messageIndex = messageRow.index;
    const timeline = mobileTimelineController.peek(`mobile:main:${sid}`);
    if (!threadEl.querySelector(`[data-msg-index="${messageIndex}"]`)
      && timeline && !timeline.paintEntries.some((entry) => entry.originalIndex === messageIndex)) return true;
    const scrollSnapshot = _mobileChatScrollSnapshot(bodyEl);
    const patched = _patchMobileThreadMessage(threadEl, message, messageIndex);
    if (!patched) return false;
    _syncMobileWorkTimer(threadEl, bodyEl, key);
    _restoreMobileChatScroll(bodyEl, scrollSnapshot);
    return true;
  }
  
  function _scheduleMobileStreamingPatch(threadEl, bodyEl, key = 'chat', delay = 16) {
    if (!threadEl) return false;
    if (!_isMobileSessionRenderCurrent(key)) return true;
    const timerKey = String(key || 'chat');
    mobileStreamRenderScheduler.schedule(`mobile:patch:${timerKey}`, () => {
      if (!_patchLatestMobileStreamingMessage(threadEl, bodyEl, timerKey)) {
        _scheduleThreadRender(threadEl, bodyEl, timerKey, delay);
      }
    }, { minimumDelay: Math.max(0, Number(delay) || 0) });
    return true;
  }
  
  function _syncMobileWorkTimerLabel(threadEl) {
    const sid = _mobileSessionIdForRenderKey(__pmChat.activeSessionId);
    const rows = mobileChatRuntimeAdapter.getTranscriptRows(sid);
    const messageRow = [...rows].reverse().find((row) => _isMobileAssistantMessage(row.msg) && row.msg.streaming === true);
    const message = messageRow?.msg || null;
    if (!message) return false;
    const msgIndex = messageRow.index;
    const root = threadEl || document.getElementById('pm-chat-thread');
    if (!root) return false;
    const msgEl = root.querySelector(`[data-msg-index="${msgIndex}"]`);
    if (!msgEl) return false;
    const timerEl = msgEl.querySelector('.pm-work-timer:not(.pm-work-timer--expandable)');
    if (!timerEl) return false;
    const startedAt = _mobileAssistantWorkStartedAt(message);
    if (!startedAt) return false;
    const duration = Date.now() - startedAt;
    const label = `Working for ${_formatMobileWorkDuration(duration)}`;
    if (timerEl.textContent !== label) timerEl.textContent = label;
    return true;
  }
  
  function _syncMobileWorkTimer(threadEl, bodyEl, key = 'chat') {
    const sid = _mobileSessionIdForRenderKey(key);
    const hasStreamingAssistant = mobileChatRuntimeAdapter
      .getTranscriptRows(sid)
      .some((row) => _isMobileAssistantMessage(row.msg) && row.msg.streaming === true);
    if (hasStreamingAssistant) {
      if (!__pmChat.workTimer) {
        __pmChat.workTimer = setInterval(() => {
          const activeThreadEl = document.getElementById('pm-chat-thread') || threadEl;
          if (!activeThreadEl) return;
          _syncMobileWorkTimerLabel(activeThreadEl);
        }, 1000);
      }
    } else if (__pmChat.workTimer) {
      clearInterval(__pmChat.workTimer);
      __pmChat.workTimer = null;
    }
  }
  
  function _installMobileTimestampReveal(threadEl, onMessageAction) {
    if (!threadEl || threadEl.dataset.pmTimestampRevealInstalled === '1') return;
    threadEl.dataset.pmTimestampRevealInstalled = '1';
  
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    let activeInput = '';
    let dragging = false;
    let resetTimer = null;
    let lastTouchStartedAt = 0;
    const maxReveal = 88;
  
    const isInteractiveTarget = (target) => {
      if (!target) return false;
      if (target.closest?.(
        'button,a,input,textarea,select,summary,details,[data-msg-action],[data-pm-command-action],[data-pm-file-change-path],[data-pm-restore-checkpoint],.pm-media-card,.pm-generated-file,.pm-product-carousel,.pm-product-track,.pm-product-card,.pm-worker-deck,.pm-worker-track,.pm-worker-card,.pm-worker-process'
      )) return true;
      if (target.closest?.('.pm-md-table-scroll')) return true;
      return false;
    };
  
    // ── Expandable work timer → toggle trace drawer ──────────────────────────
    threadEl.addEventListener('click', (event) => {
      const timerEl = event.target?.closest?.('[data-expandable="trace"]');
      if (!timerEl) return;
      const bubble = timerEl.closest('.pm-bubble');
      if (!bubble) return;
      const drawer = bubble.querySelector('.pm-trace-drawer');
      if (!drawer) return;
      const isExpanded = timerEl.classList.contains('expanded');
      timerEl.classList.toggle('expanded', !isExpanded);
      drawer.classList.toggle('open', !isExpanded);
      if (isExpanded) {
        drawer.querySelectorAll('details.pm-trace-tool-group').forEach((detail) => detail.removeAttribute('open'));
      }
      event.stopPropagation();
    });
  
    const beginReveal = (clientX, clientY, id, inputType = '') => {
      startX = clientX;
      startY = clientY;
      pointerId = id;
      activeInput = inputType;
      dragging = false;
      clearTimeout(resetTimer);
      threadEl.classList.remove('pm-time-reveal-reset');
    };
  
    const resetReveal = () => {
      pointerId = null;
      activeInput = '';
      dragging = false;
      threadEl.classList.add('pm-time-reveal-reset');
      threadEl.classList.remove('pm-time-revealing');
      threadEl.style.setProperty('--pm-time-reveal-x', '0px');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => threadEl.classList.remove('pm-time-reveal-reset'), 190);
    };
  
    const updateReveal = (clientX, clientY, event) => {
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy) || dx > 0) return;
        dragging = true;
      }
      event?.preventDefault?.();
      const reveal = Math.min(maxReveal, Math.max(0, -dx));
      threadEl.style.setProperty('--pm-time-reveal-x', `${-reveal}px`);
      threadEl.classList.toggle('pm-time-revealing', reveal > 4);
    };
  
    threadEl.addEventListener('pointerdown', (event) => {
      if (Date.now() - lastTouchStartedAt < 700) return;
      if (event.button != null && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      beginReveal(event.clientX, event.clientY, event.pointerId, 'pointer');
    });
  
    threadEl.addEventListener('pointermove', (event) => {
      if (activeInput !== 'pointer') return;
      if (pointerId !== event.pointerId) return;
      updateReveal(event.clientX, event.clientY, event);
    }, { passive: false });
  
    const finishPointerReveal = (event) => {
      if (activeInput !== 'pointer') return;
      if (pointerId == null) return;
      if (event?.pointerId != null && pointerId !== event.pointerId) return;
      resetReveal();
    };
  
    threadEl.addEventListener('pointerup', finishPointerReveal);
    threadEl.addEventListener('pointercancel', finishPointerReveal);
  
    threadEl.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      if (isInteractiveTarget(event.target)) return;
      const touch = event.touches[0];
      lastTouchStartedAt = Date.now();
      beginReveal(touch.clientX, touch.clientY, touch.identifier, 'touch');
    }, { passive: true });
  
    threadEl.addEventListener('touchmove', (event) => {
      if (activeInput !== 'touch' || pointerId == null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === pointerId);
      if (!touch) return;
      updateReveal(touch.clientX, touch.clientY, event);
    }, { passive: false });
  
    const finishTouchReveal = (event) => {
      if (activeInput !== 'touch' || pointerId == null) return;
      const stillActive = Array.from(event.touches || []).some((item) => item.identifier === pointerId);
      if (stillActive) return;
      resetReveal();
    };
  
    threadEl.addEventListener('touchend', finishTouchReveal);
    threadEl.addEventListener('touchcancel', finishTouchReveal);
  
    // ── Long-press on user bubble → show copy/edit popover ──────────────────
    let _lpTimer = null;
    let _lpTarget = null;
  
    const _dismissLongPressPopover = () => {
      const existing = document.getElementById('pm-msg-lp-popover');
      if (existing) existing.remove();
      const clone = document.getElementById('pm-msg-lp-bubble-clone');
      if (clone) clone.remove();
      const backdrop = document.getElementById('pm-msg-lp-backdrop');
      if (backdrop) {
        backdrop.classList.remove('pm-msg-lp-backdrop--in');
        setTimeout(() => backdrop.remove(), 200);
      }
      // Restore visibility of any source bubble we hid while a clone was lifted
      document.querySelectorAll('.pm-bubble--lp-source').forEach(el => {
        el.classList.remove('pm-bubble--lp-source');
        el.style.visibility = '';
      });
    };
  
    const _showLongPressPopover = (bubbleEl, msgEl, msgIndex) => {
      _dismissLongPressPopover();
      const rect = bubbleEl.getBoundingClientRect();
  
      // Full-screen blur backdrop so the lifted bubble stands out
      const backdrop = document.createElement('div');
      backdrop.id = 'pm-msg-lp-backdrop';
      backdrop.className = 'pm-msg-lp-backdrop';
      document.body.appendChild(backdrop);
      // Force reflow then add the active class so the blur/fade transitions in
      void backdrop.offsetWidth;
      backdrop.classList.add('pm-msg-lp-backdrop--in');
      backdrop.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        _dismissLongPressPopover();
      });
  
      // Lift a CLONE of the bubble into a body-level overlay. Applying
      // position:fixed to the real bubble does NOT escape ancestor transforms /
      // backdrop-filters (the chat container), so the real bubble would stay
      // trapped inside the blurred layer. A clone appended to <body> truly
      // escapes every ancestor stacking/transform context and stays sharp
      // ABOVE the backdrop. The original bubble is hidden (space preserved).
      const clone = bubbleEl.cloneNode(true);
      clone.id = 'pm-msg-lp-bubble-clone';
      clone.classList.add('pm-bubble--lifted');
      clone.classList.remove('pm-bubble--lp-source');
      clone.style.top = `${rect.top}px`;
      clone.style.left = `${rect.left}px`;
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      // Strip any nested haptic helper from the clone
      clone.querySelectorAll('.pm-bubble-haptic-switch').forEach(el => el.remove());
      document.body.appendChild(clone);
      // Hide the source bubble so only the lifted clone is visible
      bubbleEl.classList.add('pm-bubble--lp-source');
      bubbleEl.style.visibility = 'hidden';
  
      // Haptic — fire a REAL click on an on-screen native iOS switch, exactly the
      // mechanism the tab bar uses (pmHaptic's programmatic toggle does not buzz
      // from inside a setTimeout outside a user gesture). The switch must be
      // on-screen + non-zero size or iOS skips the haptic.
      try {
        const hsw = document.createElement('input');
        hsw.type = 'checkbox';
        hsw.setAttribute('switch', '');
        hsw.setAttribute('aria-hidden', 'true');
        hsw.tabIndex = -1;
        hsw.className = 'pm-bubble-haptic-switch';
        hsw.addEventListener('click', () => { try { pmHaptic(18); } catch {} });
        clone.appendChild(hsw);
        hsw.click();
      } catch {}
      // Android fallback
      try { pmHaptic(18); } catch {}
  
      const pop = document.createElement('div');
      pop.id = 'pm-msg-lp-popover';
      pop.className = 'pm-msg-lp-popover';
      pop.style.visibility = 'hidden'; // hide until rAF positions it
      pop.innerHTML = `
        <div class="pm-msg-lp-actions">
          <button type="button" class="pm-msg-lp-btn" data-lp-action="copy" data-lp-index="${msgIndex}">
            ${ICONS.clipboard}<span>Copy</span>
          </button>
          <div class="pm-msg-lp-divider"></div>
          <button type="button" class="pm-msg-lp-btn" data-lp-action="edit" data-lp-index="${msgIndex}">
            ${ICONS.wand}<span>Edit</span>
          </button>
        </div>
      `;
      document.body.appendChild(pop);
  
      // Position after layout so offsetHeight is real
      const margin = 10;
      requestAnimationFrame(() => {
        const popH = pop.offsetHeight || 100;
        const popW = Math.min(Math.max(pop.offsetWidth || 260, 240), window.innerWidth - margin * 2);
        const nearBottom = rect.bottom > window.innerHeight * 0.67;
        let top, origin;
        if (nearBottom) {
          top = rect.top - popH - margin;
          origin = 'bottom right';
          pop.classList.add('pm-msg-lp-above');
        } else {
          top = rect.bottom + margin;
          origin = 'top right';
        }
        let left = rect.right - popW;
        if (left < margin) left = margin;
        if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
        if (top < margin) top = margin;
        if (top + popH > window.innerHeight - margin) top = window.innerHeight - popH - margin;
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
        pop.style.transformOrigin = origin;
        pop.style.visibility = 'visible';
      });
  
      // Dismiss on outside tap
      const onOutside = (e) => {
        if (!pop.contains(e.target)) {
          _dismissLongPressPopover();
          document.removeEventListener('pointerdown', onOutside, true);
        }
      };
      setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 80);
  
      // Button actions — bind to CLICK (a trusted user gesture) and run the action
      // BEFORE dismissing, so the clipboard write for Copy stays inside the gesture.
      pop.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lp-action]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-lp-action');
        document.removeEventListener('pointerdown', onOutside, true);
        // Call the real action handler via a lightweight button-like shim so the
        // exact same code path the inline buttons use runs (copy / edit).
        try {
          if (typeof onMessageAction === 'function') {
            onMessageAction({
              getAttribute: (name) =>
                name === 'data-msg-action' ? action :
                name === 'data-msg-index' ? String(msgIndex) : null,
            });
          }
        } catch {}
        _dismissLongPressPopover();
      });
    };
  
    threadEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const bubble = touch.target.closest?.('.pm-msg.from-user .pm-bubble');
      if (!bubble) return;
      const msgEl = bubble.closest('[data-msg-index]');
      if (!msgEl) return;
      // Stop the swipe-reveal system from consuming this touch
      e.stopImmediatePropagation();
      _lpTarget = { bubble, msgEl, index: Number(msgEl.getAttribute('data-msg-index')), startX: touch.clientX, startY: touch.clientY };
      clearTimeout(_lpTimer);
      _lpTimer = setTimeout(() => {
        const target = _lpTarget;
        _lpTarget = null;
        if (!target) return;
        _showLongPressPopover(target.bubble, target.msgEl, target.index);
      }, 500);
    }, { passive: true });
  
    threadEl.addEventListener('touchmove', (e) => {
      if (!_lpTarget) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - _lpTarget.startX) > 10 || Math.abs(t.clientY - _lpTarget.startY) > 10) {
        clearTimeout(_lpTimer);
        _lpTarget = null;
      }
    }, { passive: true });
  
    threadEl.addEventListener('touchend', (e) => {
      // Only cancel if the timer hasn't fired yet; if it already fired _lpTarget is null
      if (_lpTarget) { clearTimeout(_lpTimer); _lpTarget = null; }
    }, { passive: true });
    threadEl.addEventListener('touchcancel', () => { clearTimeout(_lpTimer); _lpTarget = null; }, { passive: true });
  }
  
  function _mobileChatScrollTarget(bodyEl) {
    if (document.body?.classList?.contains('pm-mobile-document-scroll')) {
      return document.scrollingElement || document.documentElement;
    }
    return bodyEl;
  }
  
  function _mobileChatScrollSnapshot(bodyEl, threshold = 72) {
    const scrollTarget = _mobileChatScrollTarget(bodyEl);
    if (!scrollTarget) return { nearBottom: true, distanceFromBottom: 0 };
    const distanceFromBottom = Math.max(0, scrollTarget.scrollHeight - scrollTarget.scrollTop - scrollTarget.clientHeight);
    return {
      nearBottom: distanceFromBottom <= threshold,
      distanceFromBottom,
    };
  }
  
  function _withMobileInstantScroll(bodyEl, fn) {
    const scrollTarget = _mobileChatScrollTarget(bodyEl);
    if (!scrollTarget || typeof fn !== 'function') return;
    const previous = scrollTarget.style.scrollBehavior;
    scrollTarget.style.scrollBehavior = 'auto';
    try {
      fn();
    } finally {
      requestAnimationFrame(() => {
        if (scrollTarget) scrollTarget.style.scrollBehavior = previous;
      });
    }
  }
  
  function _restoreMobileChatScroll(bodyEl, snapshot, { forceBottom = false } = {}) {
    const scrollTarget = _mobileChatScrollTarget(bodyEl);
    if (!scrollTarget) return;
    const snap = snapshot || _mobileChatScrollSnapshot(bodyEl);
    const followBottom = forceBottom || snap.nearBottom;
    const apply = () => {
      if (followBottom) {
        scrollTarget.scrollTop = scrollTarget.scrollHeight;
      } else {
        const nextTop = scrollTarget.scrollHeight - scrollTarget.clientHeight - Number(snap.distanceFromBottom || 0);
        scrollTarget.scrollTop = Math.max(0, nextTop);
      }
    };
    _withMobileInstantScroll(bodyEl, apply);
    requestAnimationFrame(() => _withMobileInstantScroll(bodyEl, apply));
  }
  
  function _scheduleThreadRender(threadEl, bodyEl, key = 'chat', delay = 90) {
    if (!threadEl) return;
    if (!_isMobileSessionRenderCurrent(key)) return;
    const timerKey = String(key || 'chat');
    _commitMobileTranscriptCache(_mobileSessionIdForRenderKey(timerKey), 'mobile-scheduled-render');
    mobileStreamRenderScheduler.cancel(`mobile:patch:${timerKey}`);
    mobileStreamRenderScheduler.schedule(`mobile:thread:${timerKey}`, () => {
      if (!_isMobileSessionRenderCurrent(timerKey)) return;
      _renderThread(threadEl, timerKey);
    }, { minimumDelay: Math.max(0, Number(delay) || 0) });
  }
  
  function _flushThreadRender(threadEl, bodyEl, key = 'chat', options = {}) {
    const timerKey = String(key || 'chat');
    if (!_isMobileSessionRenderCurrent(timerKey)) return;
    _commitMobileTranscriptCache(_mobileSessionIdForRenderKey(timerKey), 'mobile-flush-render');
    mobileStreamRenderScheduler.cancel(`mobile:patch:${timerKey}`);
    mobileStreamRenderScheduler.flush(`mobile:thread:${timerKey}`, () => {
      _renderThread(threadEl, timerKey);
      _syncMobileWorkTimer(threadEl, bodyEl, timerKey);
      if (options.forceBottom) _restoreMobileChatScroll(bodyEl, null, options);
    });
  }
  
  function _renderMobileChatSessionNow(sessionId) {
    const sid = String(sessionId || '').trim();
    const renderSid = sid || String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    const rows = mobileChatRuntimeAdapter.getTranscriptRows(renderSid);
    __pmChat.activeSessionId = renderSid;
    __pmChat.thread = rows.map((row) => row.msg);
    const threadEl = document.getElementById('pm-chat-thread');
    const bodyEl = document.getElementById('pm-chat-body');
    if (threadEl) _flushThreadRender(threadEl, bodyEl, renderSid || 'chat');
  }
  
  const runtime = Object.freeze({
    _mobileWorkflowTransitionLabel,
    _renderChatMessageHtml,
    _renderMobileGoalCompletionReport,
    _addMobileMedia,
    _collectMediaFromToolEvent,
    _renderChatAttachmentPreviews,
    _formatBytes,
    _fileToDataUrl,
    _fileToText,
    _isTextLike,
    _normalizeMobileFile,
    _readMobileFileBase64,
    _uploadMobileChatAttachments,
    _buildMobileFileContextNote,
    _normalizeMobileEmptyChatBrainCard,
    _getMobileEmptyChatStarterCards,
    _loadMobileEmptyChatBrainCards,
    _renderMobileEmptyChatStarterCards,
    _threadForMobileSessionKey,
    _mobileSessionIdForRenderKey,
    _commitMobileTranscriptCache,
    _findMobileVoiceWorkgroupMessage,
    _findMobileVoiceWorkerByTaskId,
    _appendMobileVoiceWorkerProcess,
    _appendMobilePrimaryWorkerProcess,
    _refreshMobileVoiceWorkerJournal,
    _upsertMobileVoiceWorkgroup,
    _mobileBackgroundVoiceWorkgroupId,
    _mobileBackgroundSpawnIsVoiceWorker,
    _removeMobileVoiceWorkersFromBackgroundDock,
    _routeMobileVoiceBackgroundEvent,
    _drainPendingMobileVoiceBackgroundEvents,
    _restoreMobileVoiceWorkgroupsForSession,
    _applyMobileVoiceWorkerUpdate,
    _updateMobilePrimaryWorkgroupLink,
    _isMobileSessionRenderCurrent,
    _renderThread,
    _mobileTraceNodeKey,
    _captureMobileTraceDetailsState,
    _restoreMobileTraceDetailsState,
    _syncMobileTraceNodeAttributes,
    _patchMobileLiveTraceEntries,
    _patchMobileTraceGroup,
    _patchMobileLiveTraceTimeline,
    _mobileSideThreadNearBottom,
    _mobileSideThreadChildKey,
    _mobileSideBubbleChildKey,
    _patchMobileSideElementContents,
    _patchMobileBackgroundAgentBubble,
    _patchMobileBackgroundAgentMessage,
    _reconcileMobileBackgroundAgentSideThread,
    _patchMobileThreadMessage,
    _patchLatestMobileStreamingMessage,
    _scheduleMobileStreamingPatch,
    _syncMobileWorkTimerLabel,
    _syncMobileWorkTimer,
    _installMobileTimestampReveal,
    _mobileChatScrollTarget,
    _mobileChatScrollSnapshot,
    _withMobileInstantScroll,
    _restoreMobileChatScroll,
    _scheduleThreadRender,
    _flushThreadRender,
    _renderMobileChatSessionNow,
  });
  try {
    if (context?.window) context.window.__pmMobileChatRendererRuntime = runtime;
  } catch {}
  return runtime;
}
