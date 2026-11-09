import { renderConnectionChatCards } from '../features/connectors/connection-chat-card.js';
import { pendingStatusMarkup } from './mobile-ttft-state.js';
import { highlightMobileVoiceMarkdown } from './mobile-voice-markdown-highlight.js';
import { isMobileQuestionOnlyRow, isPendingMobileQuestion } from './mobile-question-rows.js';

// True while the row is blocked on its own pending question: no answer text
// streams and no other tool has started since. Resolving the question or a
// new running tool clears it. Lives here (lazy renderer chunk), not in the
// eagerly loaded question-row helpers.
function mobileRowAwaitsQuestionAnswer(row) {
  if (!row || row.role !== 'ai' || !isPendingMobileQuestion(row.questionRequest)) return false;
  if (row._pmFinalReceived === true || row._done === true || row.finalResponseStarted) return false;
  if (String(row.body?.text || row.content || '').trim()) return false;
  return !(row.liveTraceEntries || []).some((entry) => {
    const a = entry?.activity;
    return a?.kind === 'operation' && ['preparing', 'running'].includes(String(a.status || ''))
      && !/question/i.test(String(a.action || ''));
  });
}

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
      _mobileHasCompletedTrace,
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
      _renderMobileVoiceLyrics,
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
      // Editing borrows the bottom composer; keep the original bubble visible.
      const contentHtml = `${attachmentHtml}${userBubbleHtml}`;
      return `<div class="pm-msg from-user${isEditing ? ' editing' : ''}${isWorkerHandoff ? ' voice-worker-handoff' : ''}${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}" data-pm-row-key="${escapeHtml(stableRowKey)}" data-pm-row-signature="${escapeHtml(`${stableRowSignature}:${isEditing ? 'editing' : 'view'}`)}">
        ${workflowLabel && !isWorkerHandoff ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}
        ${contentHtml}${isEditing ? '' : _renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
    }
    const b = m.body || {};
    if (m._pmCoalescedError) return '';
    // Recovery may only know the steer boundary, not the pre-steer activity.
    // Do not turn that empty placeholder into a misleading Worked for 0s row.
    if (m.workflowPart === 'before_interruption'
      && !String(b.text || m.content || '').trim()
      && !(m.processEntries?.length || m.liveTraceEntries?.length || m.toolCalls?.length
        || m.steps?.length || m.commandRuns?.length || attachments.length
        || m.approvalRequest || m.questionRequest)) return '';
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
      // Pending questions are owned by the composer popover: never render the
      // card inline too. Only a question-only placeholder row is hidden; a row
      // carrying the tool stream / pre-tool preamble stays visible so the user
      // can see what the question is about.
      if (isPendingMobileQuestion(m.questionRequest)) {
        if (isMobileQuestionOnlyRow(m)) return '';
      } else {
        inner += _renderMobileQuestionCard(m.questionRequest);
      }
    }
    const hasLiveTraceEntries = Array.isArray(m.liveTraceEntries) && m.liveTraceEntries.length > 0;
    const finalFrameReceived = m._pmFinalReceived === true;
    const terminalFrameReceived = finalFrameReceived || m._done === true;
    const messageIsLive = m.streaming === true && !terminalFrameReceived;
    const traceFrozenForSteer = m._steerFrozenTrace === true;
    const showLiveWorkflowTrace = messageIsLive && hasLiveTraceEntries && !traceFrozenForSteer;
    const liveTraceHtml = showLiveWorkflowTrace
      ? _renderMobileGroupedTrace(m.liveTraceEntries, { streaming: true, openLiveCurrent: isVoiceTraceTurn })
      : '';
    const hasLiveTrace = !!liveTraceHtml;
    const completedTraceEntries = !messageIsLive || traceFrozenForSteer ? _mobileWorkflowTraceEntriesForMessage(m) : [];
    // Once the terminal frame arrives, the timer owns the entire activity
    // disclosure. Thoughts and tool groups must share the same collapsed
    // surface; keeping thoughts beside it makes the disclosure look broken
    // after a reconnect even though the turn itself is complete.
    const hasCompletedTrace = _mobileHasCompletedTrace(completedTraceEntries);
    const renderCompletedTraceNow = traceFrozenForSteer || m._pmTraceExpanded === true;
    const completedTraceHtml = hasCompletedTrace && renderCompletedTraceNow
      ? _renderMobileGroupedTrace(completedTraceEntries, { streaming: false })
      : '';
    const hasPendingImageGeneration = _hasPendingImageGeneration(m) && !_collectMessageMedia(m).some((media) => media.kind === 'image' && media.generated);
    if (hasLiveTrace) {
      inner += liveTraceHtml;
    } else if (traceFrozenForSteer && hasCompletedTrace) {
      // The captured half of a steer is still live conversation context, not a
      // completed historical drawer. Keep its tool stream visible above the
      // injected user message while the continuation runs below it.
      inner += completedTraceHtml;
    } else if (hasCompletedTrace) {
      // Completed thoughts and tools belong to one collapsed drawer. The
      // timer is its only disclosure control, including for turns recovered
      // from cache after the transport has already finished.
      inner += `<div class="pm-trace-drawer" data-trace-completed="1"${renderCompletedTraceNow ? '' : ' data-pm-trace-lazy="1"'}>${completedTraceHtml}</div>`;
    }
    const awaitingQuestionAnswer = mobileRowAwaitsQuestionAnswer(m) && !hasPendingImageGeneration;
    if (awaitingQuestionAnswer && (messageIsLive || hasLiveTraceEntries || hasCompletedTrace)) {
      // Blocked on the composer question: say so instead of working dots.
      inner += '<div class="pm-question-waiting-status" role="status" style="margin-top:4px;font-size:13px;opacity:.7">Waiting for your answer</div>';
    } else if (!hasLiveTrace && !(traceFrozenForSteer && hasCompletedTrace) && !hasCompletedTrace
      && messageIsLive && !answerStarted && !hasPendingImageGeneration) {
      inner += pendingStatusMarkup(m);
      inner += `<div class="pm-thinking-dots"><span></span><span></span><span></span>${window.PROM_THEME_ENGINE?.loadingWordHtml(String(m?.id || m?.timestamp || ''), 'prom-loading-word', 'em') || ''}</div>`;
    }
    if (hasPendingImageGeneration) {
      inner += _renderMobileGeneratedImageLoadingCard();
    }
    inner += _renderMobileChatErrorPresentation(m.errorPresentation);
    if (b.text) {
      // Final-answer text is already authored Markdown. Do not run it through the
      // trace-prose normalizer: that collapses intentional newlines and turns
      // headings/lists into strings such as `text### Heading` while streaming.
      const answerStreaming = messageIsLive;
      const realtimeVoiceSpeaking = m.source === 'voice_agent_realtime' && m.voiceRealtimeActive === true;
      // Voice uses the same Markdown and typography as every other answer.
      // Highlight words in the rendered text, never in the Markdown source:
      // splitting source Markdown into spans breaks links, lists, and emphasis.
      const answerHtml = _renderMobileMarkdown(b.text, m);
      const voiceHtml = realtimeVoiceSpeaking
        ? highlightMobileVoiceMarkdown(answerHtml, m.voiceRealtimeProgress)
        : answerHtml;
      inner += `<div class="markdown-body pm-final-answer${answerStreaming ? ' pm-final-answer--streaming' : ' pm-final-answer--complete'}${realtimeVoiceSpeaking ? ' pm-voice-answer-speaking' : ''}"${answerStreaming ? ' aria-busy="true"' : ''}>${voiceHtml}</div>`;
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
    const activeApprovals = messageIsLive
      ? _getPendingApprovalsForSession(__pmChat.activeSessionId).filter((approval) => {
          const approvalId = String(approval?.id || '').trim();
          return !approvalId || !renderedApprovalIds.has(approvalId);
        })
      : [];
    if (activeApprovals.length) {
      inner += `<div class="pm-chat-approvals-inline">${activeApprovals.map((approval) => _renderMobileApprovalCard(approval, { compact: true })).join('')}</div>`;
    }
    if (b.browseState) inner += _renderBrowseCard(b.browseState);
    inner += _renderMobileRichArtifacts(b.text && !m.content ? { ...m, content: b.text } : m);
    inner += renderConnectionChatCards(m);
    inner += _renderMobileVoiceWorkgroup(m);
    if (!(Array.isArray(m.richArtifacts) && m.richArtifacts.some((a) => a?.type === 'products'))) {
      inner += _renderMobileProductCarousel(m);
    }
    inner += _renderMobileMediaGallery(_collectMessageMedia(m));
    // Tool results can carry the eventual edit summary before the assistant
    // turn has emitted its terminal frame. Keep the data on the turn for the
    // final render, but do not surface the card while work is still running.
    if (!messageIsLive) inner += _renderMobileFileChanges(m.fileChanges);
    inner += _renderMobileThreadLinkArtifacts(m);
    inner += _renderMobileGoalCompletionReport(m.goalCompletionReport);
    if (inner.endsWith(statusDividerHtml)) inner = inner.slice(0, -statusDividerHtml.length);
    return `<div class="pm-msg from-ai${m.workflowPart ? ` workflow-${escapeHtml(String(m.workflowPart))}` : ''}" data-msg-index="${msgIndex}" data-pm-row-key="${escapeHtml(stableRowKey)}" data-pm-row-signature="${escapeHtml(`${stableRowSignature}:view`)}"${messageIsLive ? ' data-streaming="1"' : ''}>
      ${workflowLabel ? `<div class="pm-workflow-transition-label">${escapeHtml(workflowLabel)}</div>` : ''}
      <div class="pm-bubble">${inner}</div>${_renderMobileMessageActions(m, msgIndex)}${revealTime}</div>`;
  }

  return _renderChatMessageHtml;
}
