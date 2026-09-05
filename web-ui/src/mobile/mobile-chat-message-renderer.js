/**
 * Owns the mobile rich-message renderer's presentation boundary.
 *
 * The renderer runtime supplies a lazy context resolver so the extracted
 * function keeps the same live state and sibling presentation helpers.
 */
export function createMobileChatMessageRenderer(resolveContext = () => ({})) {
  function _renderChatMessageHtml(m, index = -1, rowKey = '', rowSignature = '') {
    const {
      ICONS,
      __pmChat,
      _collectMessageMedia,
      _getPendingApprovalsForSession,
      _hasPendingImageGeneration,
      _isMobileVoiceAgentWorkerHandoff,
      _isMobileVoiceTraceTurn,
      _mobileTraceHasToolGroup,
      _mobileWorkflowTraceEntriesForMessage,
      _mobileWorkflowTransitionLabel,
      _normalizeMobileMedia,
      _renderBrowseCard,
      _renderChatAttachmentPreviews,
      _renderMobileApprovalCard,
      _renderMobileChatErrorPresentation,
      _renderMobileFileChanges,
      _renderMobileGeneratedImageLoadingCard,
      _renderMobileGoalCompletionReport,
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
      chatTimelineRowSignature,
      escapeHtml,
    } = resolveContext() || {};
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
    const liveCompletionThoughts = m._pmLiveActivityCompleted === true
      ? _renderMobileGroupedTrace(completedTraceEntries, {
          streaming: false,
          visibleKinds: ['thought', 'thought-summary'],
          openThoughts: true,
        })
      : '';
    const liveCompletionTools = m._pmLiveActivityCompleted === true
      ? _renderMobileGroupedTrace(completedTraceEntries, {
          streaming: false,
          visibleKinds: ['tools', 'compaction', 'vision'],
        })
      : '';
    const hasPendingImageGeneration = _hasPendingImageGeneration(m) && !_collectMessageMedia(m).some((media) => media.kind === 'image' && media.generated);
    if (hasLiveTrace) {
      inner += liveTraceHtml;
    } else if (traceFrozenForSteer && hasCompletedTrace) {
      // The captured half of a steer is still live conversation context, not a
      // completed historical drawer. Keep its tool stream visible above the
      // injected user message while the continuation runs below it.
      inner += _renderMobileGroupedTrace(completedTraceEntries, { streaming: false });
    } else if (hasCompletedTrace) {
      // A live turn keeps its completed thoughts visible as independent,
      // closable disclosures while the tool stream remains behind the work
      // timer. Historical turns retain the compact drawer behavior.
      if (liveCompletionThoughts) inner += `<div class="pm-trace-thoughts-visible">${liveCompletionThoughts}</div>`;
      inner += `<div class="pm-trace-drawer" data-trace-completed="1">${liveCompletionTools || _renderMobileGroupedTrace(completedTraceEntries, { streaming: false })}</div>`;
    } else if (liveCompletionThoughts) {
      inner += `<div class="pm-trace-thoughts-visible">${liveCompletionThoughts}</div>`;
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
      inner += `<div class="markdown-body pm-final-answer${answerStreaming ? ' pm-final-answer--streaming' : ' pm-final-answer--complete'}"${answerStreaming ? ' aria-busy="true"' : ''}>${_renderMobileMarkdown(b.text, m)}</div>`;
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
    // Tool results can carry the eventual edit summary before the assistant
    // turn has emitted its terminal frame. Keep the data on the turn for the
    // final render, but do not surface the card while work is still running.
    if (m.streaming !== true) inner += _renderMobileFileChanges(m.fileChanges);
    inner += _renderMobileThreadLinkArtifacts(m);
    inner += _renderMobileGoalCompletionReport(m.goalCompletionReport);
    if (inner.endsWith(statusDividerHtml)) inner = inner.slice(0, -statusDividerHtml.length);
    return `<div class="pm-msg from-ai${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}" data-pm-row-key="${escapeHtml(stableRowKey)}" data-pm-row-signature="${escapeHtml(`${stableRowSignature}:view`)}"${m.streaming ? ' data-streaming="1"' : ''}>
      ${workflowLabel ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}
      <div class="pm-bubble">${inner}</div>${_renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
  }
}
