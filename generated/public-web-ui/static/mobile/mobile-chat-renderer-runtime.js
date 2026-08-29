import {
  coalesceToolActivityEntries,
  renderToolActivityIcon,
  renderToolActivityEntry,
  toolActivitySummary,
} from '../features/chat/optional/tool-activity-runtime.js';
import { createMobileStreamReceiptLedger } from '../features/chat/runtime/mobile-stream-receipts.js';

function _compactMobileThreadCacheFileChanges(value) {
  if (!value || typeof value !== 'object') return undefined;
  const compactPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const files = (Array.isArray(payload.files) ? payload.files : []).slice(-12).map((file) => {
      if (!file || typeof file !== 'object') return null;
      return {
        path: String(file.path || '').trim() || undefined,
        displayPath: String(file.displayPath || file.path || '').trim() || undefined,
        status: String(file.status || 'modified').trim() || 'modified',
        insertions: Math.max(0, Number(file.insertions) || 0),
        deletions: Math.max(0, Number(file.deletions) || 0),
        binary: file.binary === true || undefined,
      };
    }).filter((file) => file && (file.path || file.displayPath));
    if (!files.length) return null;
    const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const checkpointValue = payload.checkpoint && typeof payload.checkpoint === 'object'
      ? {
        id: String(payload.checkpoint.id || payload.checkpoint.checkpoint_id || payload.checkpoint.checkpointId || '').trim() || undefined,
        createdAt: Number(payload.checkpoint.createdAt || payload.checkpoint.created_at || 0) || undefined,
        snapshotCount: Math.max(0, Number(payload.checkpoint.snapshotCount || payload.checkpoint.snapshot_count || 0) || 0),
      }
      : undefined;
    const checkpoint = checkpointValue?.id ? checkpointValue : undefined;
    return {
      summary: {
        fileCount: Math.max(files.length, Number(summary.fileCount) || 0),
        insertions: Math.max(0, Number(summary.insertions) || files.reduce((sum, file) => sum + file.insertions, 0)),
        deletions: Math.max(0, Number(summary.deletions) || files.reduce((sum, file) => sum + file.deletions, 0)),
      },
      files,
      ...(checkpoint ? { checkpoint } : {}),
    };
  };
  const primary = compactPayload(value);
  const groups = (Array.isArray(value.groups) ? value.groups : []).slice(-8).map((group, index) => {
    const data = compactPayload(group?.fileChanges || group);
    if (!data) return null;
    return {
      id: String(group?.id || group?.source || `group_${index + 1}`).trim() || `group_${index + 1}`,
      source: String(group?.source || '').trim() || undefined,
      label: String(group?.label || '').trim() || undefined,
      fileChanges: data,
    };
  }).filter(Boolean);
  if (!primary && !groups.length) return undefined;
  return {
    ...(primary || {}),
    ...(groups.length ? { groups } : {}),
  };
}

function _imageGenerationToolName(value) {
  const raw = typeof value === 'string'
    ? value
    : String(
      value?.action
      || value?.name
      || value?.toolName
      || value?.tool_name
      || value?.tool
      || value?.label
      || '',
    );
  return raw.trim().replace(/[^a-z0-9_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function _isImageGenerationToolName(value) {
  return [
    'generate_image',
    'image_gen',
    'imagegen',
    'image_generation',
    'voice_generate_image',
    'creative_generate_image_shot',
  ].includes(_imageGenerationToolName(value));
}

function _imageGenerationEntryAction(entry) {
  const activity = entry?.activity && typeof entry.activity === 'object' ? entry.activity : {};
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  return _imageGenerationToolName(
    activity.action
    || activity.toolName
    || extra.action
    || extra.toolName
    || entry?.action
    || entry?.toolName
    || entry?.name
    || entry,
  );
}

function _imageGenerationEntryKey(entry, action) {
  const activity = entry?.activity && typeof entry.activity === 'object' ? entry.activity : {};
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  return String(
    activity.callId
    || activity.call_id
    || activity.activityId
    || extra.callId
    || extra.call_id
    || extra.toolCallId
    || extra.tool_call_id
    || entry?.callId
    || entry?.call_id
    || entry?.toolCallId
    || entry?.eventKey
    || extra.eventKey
    || `${action || 'image'}:anonymous`,
  ).trim();
}

function _isImageGenerationTerminalText(text) {
  const value = String(text || '');
  return /\b(?:generate[_ ]image|generating[_ ]image|generated[_ ]image|image[_ ](?:gen|generation)|imagegen)\b[\s\S]*\b(?:complete|completed|failed|failure|error|succeeded|success)\b/i.test(value)
    || /\b(?:failed|error)\b[\s\S]*\b(?:generate[_ ]image|image[_ ](?:gen|generation)|imagegen)\b/i.test(value);
}

function _hasPendingImageGeneration(message) {
  if (message?.streaming !== true
    || message?.finalResponseStarted === true
    || message?._pmFinalReceived === true
    || message?._pmLiveActivityCompleted === true
    || message?._done === true) return false;
  const rawEntries = [
    ...(Array.isArray(message.processEntries) ? message.processEntries : []),
    ...(Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : []),
  ];
  const entries = [];
  const seen = new Set();
  rawEntries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const type = String(entry?.type || '').toLowerCase();
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const activity = entry?.activity && typeof entry.activity === 'object' ? entry.activity : {};
    const eventKey = String(extra.eventKey || entry.eventKey || '').trim();
    const callId = String(activity.callId || activity.call_id || activity.activityId || extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id || entry.callId || entry.call_id || entry.toolCallId || '').trim();
    const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim();
    const key = `${type}|${eventKey || callId || text}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  });
  const activeImageCalls = new Set();
  let observedImageActivity = false;
  entries.forEach((entry) => {
    const type = String(entry?.type || '').toLowerCase();
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const activity = entry?.activity && typeof entry.activity === 'object' ? entry.activity : {};
    const presentationMode = String(extra.presentation_mode || extra.presentationMode || activity.presentation_mode || activity.presentationMode || entry?.presentation_mode || '').trim().toLowerCase();
    if (presentationMode === 'background') return;
    const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim();
    const action = _imageGenerationEntryAction(entry);
    const lowerText = text.toLowerCase();
    const isImageActivity = _isImageGenerationToolName(action)
      || /\b(generate_image|image_gen|imagegen|generate image|generating image|generated image|image generation)\b/.test(lowerText);
    if (!isImageActivity) return;
    observedImageActivity = true;
    const key = _imageGenerationEntryKey(entry, action);
    const terminalText = _isImageGenerationTerminalText(text);
    if (type === 'result' || type === 'error' || type === 'tool_result' || terminalText) {
      if (entry?.callId || entry?.eventKey || extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id || extra.eventKey || activity.callId || activity.activityId) activeImageCalls.delete(key);
      else activeImageCalls.clear();
      return;
    }
    if (type === 'tool' || type === 'call') {
      activeImageCalls.add(key);
      return;
    }
    if (activeImageCalls.size === 0) activeImageCalls.add(key);
  });
  return observedImageActivity && activeImageCalls.size > 0;
}

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
  _mergeMobileMediaIntoMessage,
  _mergeMobileProductCarouselIntoMessage,
  _mobileAssistantWorkStartedAt,
  _mobileFileExt,
  _mobileTimelineEntries,
  _mobileToolEventName,
  _dedupeMobileTraceProseText,
  _isMobileBareThinkingTraceText,
  _isMobileImageGenerationStreamEntry,
  _isMobileTraceReasoningSummaryType,
  _isMobileTraceThoughtFragmentText,
  _isMobileTraceThoughtType,
  _isMobileUserVisibleReasoningTraceEntry,
  _isMobileVisionInjectionStatusText,
  _mobileTraceComparableText,
  _mobileTraceJsonPayload,
  _mobileTraceThoughtTextsSimilar,
  _renderMobileLiveTracePreview,
  _mobileVoiceWorkgroupStatus,
  _mobileWorkflowTraceEntriesForMessage,
  _normalizeMobileMedia,
  _normalizeMobileMediaList,
  _normalizeMobileQuestion,
  _normalizeMobileVoiceWorkgroup,
  _nowTime,
  _pmCssEscape,
  _reconcileMobileThreadOrder,
  _renderBrowseCard,
  _renderMobileApprovalCard,
  _renderMobileApprovalSheet,
  _renderMobileChatErrorPresentation,
  _renderMobileFileChanges,
  _renderMobileGeneratedImageLoadingCard,
  _renderMobileMarkdown,
  _renderMobileMediaGallery,
  _renderMobileMessageActions,
  _renderMobileProductCarousel,
  _renderMobileRichArtifacts,
  _renderMobileSkillReferencedMarkdown,
  _renderMobileThreadLinkArtifacts,
  _renderMobileUserEditComposer,
  _renderMobileVoiceWorkgroup,
  _renderMobileWorkTimer,
  _wireMobileApprovalActionButton,
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
  __pmRealtimeAgent,
  _appendMobileProcess,
  _formatTimeAgo,
  _getMobileGoalForSession,
  _linkMobileApprovalToBackgroundLane,
  _mobileApprovalVisibleSessionId,
  _mobileBackgroundSpawnIdFromSessionId,
  _mobileBackgroundStoredProcessEntries,
  _mobileGoalStepStatus,
  _normalizeMobileApproval,
  _pmApprovalTitle,
  _renderMobileGoalPill,
  _renderMobileProcess,
  _renderMobileSourceList,
  _updateMobilePendingApproval,
  _upsertMobilePendingApproval,
  findBackgroundAgentWork,
  loadMobileBackgroundStatus,
  mobileSourceState,
  persistBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
  _appendMobileCompactionTrace,
  _appendMobileVisionTrace,
  _applyMobileToolActivity,
  _handleMobileCleanThought,
  _handleMobileReasoningSummaryDelta,
  _handleMobileThinkingDelta,
  _maybeFlushMobileThinkingBeforeEvent,
  _mergeMobileRichArtifacts,
  _refreshMobileSourcesForSession,
  appendFinalResponseDelta,
  beginFinalResponse,
  reconcileFinalResponse,
  _appendMobileLiveTrace,
  _isMobileProgressNarration,
  _setMobileLiveProgressNarration,
  _normalizeMobileFileChanges,
  } = context || {};

  let mobileFirstTranscriptPaintMarked = false;

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

  function _renderMobileLiveTraceEntry(entry) {
    if (entry?.activity) return renderToolActivityEntry(entry, escapeHtml);
    const type = String(entry.type || 'info').toLowerCase();
    const text = String(entry.text || '').trim();
    const entryId = String(entry.id || `${type}_${text.replace(/\s+/g, ' ').slice(0, 80)}_${String(entry.time || entry.ts || '')}`).trim();
    const attr = entryId ? ` data-pm-live-entry-id="${escapeHtml(entryId)}"` : '';
    const previewHtml = _renderMobileLiveTracePreview(entry);
    if (type === 'preamble' || type === 'think' || type === 'assistant' || _isMobileTraceReasoningSummaryType(type)) {
      return `<div class="pm-live-prose ${escapeHtml(type)}"${attr}><div class="pm-live-md">${_renderMobileMarkdown(_dedupeMobileTraceProseText(text))}</div>${previewHtml}</div>`;
    }
    const label = type === 'vision' ? 'Vision' : type === 'result' ? 'Tool result' : type === 'error' ? 'Tool error' : 'Tool';
    const body = text ? `<div class="pm-live-text">${escapeHtml(text)}</div>` : '';
    return `<div class="pm-live-segment ${escapeHtml(type)}"${attr}><span>${escapeHtml(label)}</span>${body}${previewHtml}</div>`;
  }

  function _isMobileTraceCompactionEntry(entry) {
    return String(entry?.type || '').toLowerCase() === 'compaction';
  }

  function _renderMobileCompactionBreak(entry) {
    const status = String(entry?.status || entry?.extra?.status || '').toLowerCase();
    const entryId = String(entry?.id || `compaction_${entry?.time || entry?.ts || ''}_${status}`).trim();
    const label = String(entry?.text || '').trim()
      || (status === 'compacting' ? 'Compacting Context' : status === 'failed' ? 'Context Compaction Failed' : 'Context Compacted');
    const summary = String(entry?.summary || entry?.extra?.summary || '').trim();
    const body = summary
      ? `<div class="pm-trace-compaction-body"><div class="pm-live-md">${_renderMobileMarkdown(summary)}</div></div>`
      : (status === 'compacting' ? '<div class="pm-trace-compaction-body muted">Compaction summary will appear when complete.</div>' : '');
    return `<details class="pm-trace-compaction" data-status="${escapeHtml(status || 'done')}" data-pm-trace-entry-id="${escapeHtml(entryId)}">
      <summary>
        <span class="pm-trace-compaction-line" aria-hidden="true"></span>
        <strong>${escapeHtml(label)}</strong>
        <span class="pm-trace-compaction-line" aria-hidden="true"></span>
      </summary>
      ${body}
    </details>`;
  }

  function _mobileTracePresentationEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      if (!entry || entry.activity) return entry;
      const type = String(entry.type || '').toLowerCase();
      const text = String(entry.text || entry.content || entry.message || '').trim();
      const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
      const action = String(extra.action || extra.toolName || entry.action || entry.toolName || '').trim();
      // Older mobile turns stored agent narration as generic process/info rows.
      // Reclassify only action-less progress prose so it can use the same muted,
      // collapsible thought treatment as live reasoning.
      if (['info', 'progress'].includes(type) && !action && _isMobileProgressNarration(text)) {
        return {
          ...entry,
          type: 'think',
          extra: {
            ...extra,
            source: extra.source || 'agent_progress',
            visibility: extra.visibility || 'user',
          },
        };
      }
      return entry;
    });
  }

  function _mobileTraceEntryTime(entry, key) {
    const value = entry?.[key] ?? entry?.extra?.[key];
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function _mobileTraceGroupDurationMs(entries, { live = false } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    let startedAt = 0;
    let endedAt = 0;
    let explicitDuration = 0;
    for (const entry of list) {
      const start = _mobileTraceEntryTime(entry, 'ts') || _mobileTraceEntryTime(entry, 'startedAt');
      const end = _mobileTraceEntryTime(entry, 'endTs') || _mobileTraceEntryTime(entry, 'endedAt');
      const duration = Number(entry?.durationMs ?? entry?.extra?.durationMs);
      if (start > 0) startedAt = startedAt > 0 ? Math.min(startedAt, start) : start;
      if (end > 0) endedAt = Math.max(endedAt, end);
      if (Number.isFinite(duration) && duration > explicitDuration) explicitDuration = duration;
    }
    if (startedAt > 0) {
      const effectiveEnd = endedAt > startedAt ? endedAt : (live ? Date.now() : startedAt);
      if (effectiveEnd >= startedAt) return Math.max(0, effectiveEnd - startedAt);
    }
    return explicitDuration;
  }

  function _isMobilePreparedTraceEntry(entry) {
    const type = String(entry?.type || '').toLowerCase();
    const text = String(entry?.text || '').replace(/\s+/g, ' ').trim();
    return type === 'tool' && /^Prepared\b/i.test(text);
  }

  function _mobileVisibleTraceEntries(entries) {
    const thoughtTexts = [];
    const sourceEntries = _mobileTracePresentationEntries(entries);
    const replaceableProgressTexts = sourceEntries
      .filter((entry) => String(entry?.extra?.source || '').toLowerCase() === 'agent_progress')
      .map((entry) => String(entry?.text || entry?.content || '').trim())
      .filter(Boolean);
    return coalesceToolActivityEntries(sourceEntries).filter((entry) => {
      if (_isMobileImageGenerationStreamEntry(entry)) return false;
      if (_isMobilePreparedTraceEntry(entry)) return false;
      if (_isMobileVisionInjectionStatusText(entry?.text)) return false;
      if (_isMobileBareThinkingTraceText(entry?.text)) return false;
      const hasContent = String(entry?.text || '').trim() || String(entry?.preview?.dataUrl || entry?.dataUrl || '').trim();
      if (!hasContent) return false;
      const type = String(entry?.type || '').toLowerCase();
      if (_isMobileTraceThoughtType(type)) {
        // Older/replayed frames could leave the same explicit summary in a
        // visible think row after the progress slot was created. The summary
        // slot is authoritative; suppress that stale duplicate so the tool
        // stream does not grow a second reasoning card.
        if (replaceableProgressTexts.length
          && type === 'think'
          && String(entry?.extra?.source || '').toLowerCase() === 'reasoning_summary'
          && replaceableProgressTexts.some((progressText) => _mobileTraceThoughtTextsSimilar(entry?.text || '', progressText))) return false;
        if (!_isMobileUserVisibleReasoningTraceEntry(entry)) return false;
        const text = _dedupeMobileTraceProseText(entry?.text || '');
        if (text) {
          if (_isMobileTraceThoughtFragmentText(text)) return false;
          const comparable = _mobileTraceComparableText(text);
          const words = comparable.split(/\s+/).filter(Boolean).length;
          if (thoughtTexts.some((seen) => {
            const seenComparable = _mobileTraceComparableText(seen);
            return _mobileTraceThoughtTextsSimilar(seen, text)
              || (comparable.length >= 18 && words >= 3 && seenComparable.includes(comparable));
          })) return false;
          thoughtTexts.push(text);
        }
      }
      return true;
    });
  }

  function _mobileTraceProgressSummary(entries) {
    const source = Array.isArray(entries) ? entries : [];
    // `agent_progress` is the single mutable live slot. Prefer it over the
    // durable reasoning-summary journal so an active tool cannot resurrect an
    // older summary as a second label after a reconnect.
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const entry = source[index];
      const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
      if (String(extra.source || '').toLowerCase() !== 'agent_progress') continue;
      const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text.slice(0, 220);
    }
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const entry = source[index];
      const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
      if (String(extra.source || '').toLowerCase() !== 'reasoning_summary'
        && String(entry?.type || '').toLowerCase() !== 'reasoning_summary') continue;
      const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;
      // The progress slot is the source of truth for the collapsed label. Keep
      // its actual text instead of falling back to a generic "Reasoning" label.
      return text.slice(0, 220);
    }
    return '';
  }

  function _renderMobileLiveTrace(entries) {
    const list = _mobileVisibleTraceEntries(entries);
    if (!list.length) return '';
    return `<div class="pm-live-trace">${list.map(_renderMobileLiveTraceEntry).join('')}</div>`;
  }

  function _isMobileTraceThoughtEntry(entry) {
    const type = String(entry?.type || 'info').toLowerCase();
    return type === 'preamble' || type === 'think' || type === 'assistant' || _isMobileTraceReasoningSummaryType(type);
  }

  function _mobileTraceThoughtKind(entry) {
    if (!_isMobileTraceThoughtEntry(entry)) return '';
    if (String(entry?.type || '').toLowerCase() === 'preamble') return 'full_thought';
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const explicit = String(extra.reasoningKind || extra.presentationKind || '').trim().toLowerCase();
    if (explicit === 'summary' || explicit === 'full_thought') return explicit;
    const source = String(extra.source || entry?.source || '').trim().toLowerCase();
    return String(entry?.type || '').toLowerCase() === 'reasoning_summary'
      || source === 'reasoning_summary'
      || source === 'agent_progress'
      || extra.visibility === 'summary'
      ? 'summary'
      : 'full_thought';
  }

  function _mobileTraceGroupStableKey(group, index = 0) {
    const kind = String(group?.kind || 'group');
    const first = Array.isArray(group?.entries) ? group.entries[0] : null;
    const entryKey = String(
      first?.activity?.callId
      || first?.activity?.activityId
      || first?.id
      || `${kind}_${index}`
    ).trim();
    return `trace_group_${kind}_${entryKey}`;
  }

  function _markMobileLiveStreamMotion(rootEl, sessionKey) {
    if (!rootEl) return;
    const key = String(sessionKey || (typeof __pmChat !== 'undefined' && __pmChat?.activeSessionId) || 'chat');
    const seenBySession = window.__pmMobileLiveStreamEntryIdsBySession || (window.__pmMobileLiveStreamEntryIdsBySession = {});
    const seen = seenBySession[key] || (seenBySession[key] = new Set());
    const segmentSeenBySession = window.__pmMobileLiveTraceSegmentIdsBySession || (window.__pmMobileLiveTraceSegmentIdsBySession = {});
    const segmentSeen = segmentSeenBySession[key] || (segmentSeenBySession[key] = new Set());
    try {
      rootEl.querySelectorAll('[data-pm-live-entry-id]').forEach((node) => {
        const id = String(node.getAttribute('data-pm-live-entry-id') || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        node.classList.add('pm-live-stream-enter');
      });
      rootEl.querySelectorAll('.pm-trace-thought-group[data-pm-trace-group], details.pm-trace-tool-group[data-pm-trace-group]').forEach((node) => {
        const id = String(node.getAttribute('data-pm-trace-group') || '').trim();
        if (!id || segmentSeen.has(id)) return;
        segmentSeen.add(id);
        node.classList.add('pm-live-stream-enter');
      });
    } catch {}
  }

  function _mobileTraceGroups(entries) {
    const list = _mobileVisibleTraceEntries(entries);
    const groups = [];
    let activeToolGroup = null;
    list.forEach((entry) => {
      if (_isMobileTraceCompactionEntry(entry)) {
        activeToolGroup = null;
        groups.push({ kind: 'compaction', entries: [entry] });
        return;
      }
      if (String(entry?.type || '').toLowerCase() === 'vision' && _renderMobileLiveTracePreview(entry)) {
        // Screenshots intentionally break the collapsible tool sequence so they
        // stay visible as first-class timeline cards.
        if (groups[groups.length - 1]?.kind === 'vision') groups[groups.length - 1].entries.push(entry);
        else groups.push({ kind: 'vision', entries: [entry] });
        activeToolGroup = null;
        return;
      }
      if (_isMobileTraceThoughtEntry(entry)) {
        activeToolGroup = null;
        const thoughtKind = _mobileTraceThoughtKind(entry);
        const groupKind = thoughtKind === 'summary' ? 'thought-summary' : 'thought';
        const previous = groups[groups.length - 1];
        if (previous?.kind === groupKind) previous.entries.push(entry);
        else groups.push({ kind: groupKind, entries: [entry] });
        return;
      }
      if (!activeToolGroup) {
        activeToolGroup = { kind: 'tools', entries: [] };
        groups.push(activeToolGroup);
      }
      activeToolGroup.entries.push(entry);
    });
    return groups.map((group, index) => ({ ...group, id: _mobileTraceGroupStableKey(group, index) }));
  }

  function _mobileTraceHasToolGroup(entries) {
    return _mobileTraceGroups(entries).some((group) =>
      (group.kind === 'tools' || group.kind === 'compaction') && group.entries.length > 0
    );
  }

  function _mobileTraceToolLabel(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^Preparing\s+/i, '')
      .replace(/^Prepared\s+/i, '')
      .replace(/\s*(?:->|→).*/, '')
      .replace(/:\s+(?!\{).*/, '')
      .replace(/\s+(?:complete|failed)$/i, '')
      .replace(/:\s*\{.*$/, '')
      .trim();
  }

  function _mobileTraceCountPhrase(count) {
    if (count === 1) return 'once';
    if (count === 2) return 'twice';
    return `${count} times`;
  }


  function _mobileTracePayloadValues(payload, keys, limit = 4) {
    const wanted = new Set((keys || []).map((key) => String(key || '').toLowerCase()));
    const out = [];
    const visit = (value, depth = 0) => {
      if (out.length >= limit || value == null || depth > 5) return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      Object.entries(value).forEach(([key, item]) => {
        if (out.length >= limit) return;
        if (wanted.has(String(key || '').toLowerCase()) && item != null && typeof item !== 'object') {
          const text = String(item || '').trim();
          if (text) out.push(text);
        } else {
          visit(item, depth + 1);
        }
      });
    };
    visit(payload);
    return [...new Set(out)];
  }

  function _mobileTraceFirstPayloadValue(payload, keys) {
    return _mobileTracePayloadValues(payload, keys, 1)[0] || '';
  }

  function _mobileTraceArrowDetail(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    const match = raw.match(/(?:->|=>|→)\s*([^.;\n]+)/);
    return match ? match[1].replace(/\s+bundle\s+Description.*$/i, '').trim() : '';
  }

  function _mobileTraceTitleCaseSlug(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/[-_]/.test(raw)) return raw;
    return raw.split(/[-_]+/).filter(Boolean).map((part) => {
      const lower = part.toLowerCase();
      if (['ai', 'ui', 'api', 'url', 'json', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'x'].includes(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join(' ');
  }

  function _mobileTraceCompactDetail(value, { path = false, url = false, slug = false } = {}) {
    let raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (url || /^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        raw = `${parsed.host}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}`;
      } catch {}
    } else if (path || /[\\/]/.test(raw)) {
      raw = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    } else if (slug) {
      raw = _mobileTraceTitleCaseSlug(raw);
    }
    return raw.length > 48 ? `${raw.slice(0, 45)}...` : raw;
  }

  function _mobileTraceDescriptorFor(rawText, entryType = 'tool') {
    const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
    const type = String(entryType || '').toLowerCase();
    const label = _mobileTraceToolLabel(raw);
    const lower = `${label} ${raw}`.toLowerCase();
    const payload = _mobileTraceJsonPayload(raw);
    const arrow = _mobileTraceArrowDetail(raw);
    const fileValues = _mobileTracePayloadValues(payload, ['file', 'filename', 'path', 'source', 'target', 'to_path', 'from_path'], 3)
      .map((value) => _mobileTraceCompactDetail(value, { path: true }))
      .filter(Boolean);
    const urlValue = _mobileTraceFirstPayloadValue(payload, ['url', 'href', 'currentUrl', 'pageUrl', 'targetUrl']);
    const windowValue = _mobileTraceFirstPayloadValue(payload, ['window', 'windowTitle', 'title', 'name', 'app']);
    const commandValue = _mobileTraceFirstPayloadValue(payload, ['command', 'cmd', 'script']);
    const skillValue = _mobileTraceFirstPayloadValue(payload, ['id', 'skill', 'skillId', 'name']);
    const make = (key, past, gerund, noun, plural, detail = '', opts = {}) => ({
      key,
      past,
      gerund,
      noun,
      plural: plural || `${noun}s`,
      detail: String(detail || '').trim(),
      detailPrefix: opts.detailPrefix || '',
      countStyle: opts.countStyle || 'noun',
      status: type === 'error' || /\bfailed\b/i.test(raw) ? 'failed' : '',
    });
    if (type === 'vision' || /\b(vision|screenshot|screen shot|image preview)\b/.test(lower)) {
      return make('vision', 'Viewed', 'Viewing', 'screenshot', 'screenshots', windowValue || arrow, { detailPrefix: '' });
    }
    if (/\b(skill read|read skill)\b/.test(lower)) {
      return make('skillRead', 'Read', 'Reading', 'skill', 'skills', _mobileTraceCompactDetail(skillValue || arrow, { slug: true }), { detailPrefix: 'skill' });
    }
    if (/\b(skill list|list skills|skill search|skill match)\b/.test(lower)) {
      const query = _mobileTraceFirstPayloadValue(payload, ['query', 'q', 'search']);
      return make('skillList', 'Searched', 'Searching', 'skill list', 'skill searches', _mobileTraceCompactDetail(query || arrow), { detailPrefix: 'for' });
    }
    if (/\b(desktop focus|focus window|desktop window)\b/.test(lower)) {
      return make('desktopFocus', 'Focused', 'Focusing', 'window', 'windows', _mobileTraceCompactDetail(windowValue || arrow, { slug: true }));
    }
    if (/\b(desktop screen|desktop screenshot|screen capture)\b/.test(lower)) {
      return make('desktopScreen', 'Captured', 'Capturing', 'desktop screen', 'desktop screens', _mobileTraceCompactDetail(windowValue, { slug: true }));
    }
    if (/\b(browser scroll|scrolled?|scroll_collect|scroll collect)\b/.test(lower)) {
      const direction = _mobileTraceFirstPayloadValue(payload, ['direction', 'dir']);
      return make('browserScroll', 'Scrolled', 'Scrolling', 'scroll', 'scrolls', _mobileTraceCompactDetail(direction || arrow), { countStyle: 'times' });
    }
    if (/\b(browser click|clicked?|tap|tapped)\b/.test(lower)) {
      const target = _mobileTraceFirstPayloadValue(payload, ['text', 'label', 'selector', 'target', 'ariaLabel']);
      return make('browserClick', 'Clicked', 'Clicking', 'click', 'clicks', _mobileTraceCompactDetail(target || arrow), { countStyle: 'times' });
    }
    if (/\b(browser open|browser navigate|navigate|opened page|open page|go to|goto|visited)\b/.test(lower)) {
      return make('browserOpen', 'Opened', 'Opening', 'page', 'pages', _mobileTraceCompactDetail(urlValue || arrow, { url: true }));
    }
    if (/\b(browser extract|get page text|page text|read page|browser read)\b/.test(lower)) {
      return make('browserRead', 'Read', 'Reading', 'page', 'pages', _mobileTraceCompactDetail(urlValue || arrow, { url: true }));
    }
    if (/\b(workspace edit|dev source edit|apply patch|edited?|update file|delete file)\b/.test(lower)) {
      return make('fileEdit', 'Edited', 'Editing', 'file', 'files', fileValues[0] || _mobileTraceCompactDetail(arrow, { path: true }), { detailPrefix: 'file' });
    }
    if (/\b(write note|workspace write|create file|write file|save file)\b/.test(lower)) {
      return make('fileWrite', 'Wrote', 'Writing', 'file', 'files', fileValues[0] || _mobileTraceCompactDetail(arrow, { path: true }), { detailPrefix: 'file' });
    }
    if (/\b(workspace read|dev source read|read files batch|read file|file read|fetch file|get-content|cat|sed|open file|view file)\b/.test(lower)) {
      return make('fileRead', 'Read', 'Reading', 'file', 'files', fileValues[0] || _mobileTraceCompactDetail(arrow, { path: true }), { detailPrefix: 'file' });
    }
    if (/\b(grep|rg|ripgrep|search source|search file|search files|file search|find in files)\b/.test(lower)) {
      const query = _mobileTraceFirstPayloadValue(payload, ['pattern', 'query', 'q', 'search']);
      return make('fileSearch', 'Searched', 'Searching', 'files', 'file searches', _mobileTraceCompactDetail(query || fileValues[0] || arrow), { detailPrefix: 'for' });
    }
    if (/\b(web search|search query|searched web|web\.run|internet search|search web)\b/.test(lower)) {
      const query = _mobileTraceFirstPayloadValue(payload, ['q', 'query', 'search']);
      return make('webSearch', 'Searched', 'Searching', 'web', 'web searches', _mobileTraceCompactDetail(query || arrow), { detailPrefix: 'for' });
    }
    if (/\b(shell|powershell|command|terminal|run command|workspace run|cmd\.exe)\b/.test(lower)) {
      const command = _mobileTraceCompactDetail(commandValue || arrow || label);
      return make('command', 'Ran', 'Running', 'command', 'commands', command, { detailPrefix: 'command' });
    }
    if (/\b(approval|approve|permission)\b/.test(lower)) {
      return make('approval', 'Requested', 'Requesting', 'approval', 'approvals', _mobileTraceCompactDetail(arrow));
    }
    return make(`tool:${label || raw || 'tool'}`, 'Used', 'Using', 'tool', 'tools', _mobileTraceCompactDetail(arrow || label || raw));
  }

  function _mobileTraceJoinSummaryParts(parts) {
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  }

  function _mobileTraceMergeDetail(target, source) {
    if (!target || !source) return;
    if (!target.detail && source.detail) target.detail = source.detail;
    if (!target.status && source.status) target.status = source.status;
  }

  function _mobileTraceLogicalTools(entries) {
    const list = _mobileVisibleTraceEntries(entries);
    const calls = [];
    let pending = null;
    let current = null;
    list.forEach((entry) => {
      const type = String(entry?.type || '').toLowerCase();
      if (!['tool', 'result', 'error', 'vision'].includes(type)) return;
      const raw = String(entry?.text || '').replace(/\s+/g, ' ').trim();
      if (!raw && type !== 'vision') return;
      if (/^Processing\.{0,3}$/i.test(raw) || /^Prepared\b/i.test(raw)) return;
      const descriptor = _mobileTraceDescriptorFor(raw, type);
      if (type === 'tool' && /^Preparing\b/i.test(raw)) {
        pending = (!pending || pending.key !== descriptor.key) ? { ...descriptor, pending: true } : pending;
        return;
      }
      if (type === 'tool' || type === 'vision') {
        if (pending && pending.key !== descriptor.key) calls.push(pending);
        pending = null;
        current = { ...descriptor };
        calls.push(current);
        return;
      }
      const target = current || pending;
      if (target && (!descriptor.key || target.key === descriptor.key || /\bcomplete\b|->|=>|→|\bok\b|\bapplied\b/i.test(raw))) {
        _mobileTraceMergeDetail(target, descriptor);
        if (type === 'error' || /\bfailed\b/i.test(raw)) target.status = 'failed';
        return;
      }
      if (type === 'error' || !/\bcomplete\b/i.test(raw)) {
        current = { ...descriptor };
        calls.push(current);
      }
    });
    if (pending && !calls.includes(pending)) calls.push(pending);
    return calls;
  }

  function _mobileTraceLogicalGroupText(calls) {
    const list = Array.isArray(calls) ? calls : [];
    if (!list.length) return '';
    const first = list[0];
    const count = list.length;
    const details = [...new Set(list.map((call) => call.detail).filter(Boolean))].slice(0, 2);
    const failed = list.filter((call) => call.status === 'failed').length;
    if (failed && failed === count) {
      if (count === 1) return `${first.noun.charAt(0).toUpperCase()}${first.noun.slice(1)} failed${details[0] ? `: ${details[0]}` : ''}`;
      return `${count} ${first.plural} failed`;
    }
    if (count === 1) {
      const detail = details[0] ? `${first.detailPrefix && first.detailPrefix !== 'for' ? ` ${first.detailPrefix}:` : ''} ${details[0]}` : ` ${first.noun}`;
      if (first.detailPrefix === 'for' && details[0]) return `${first.past} for ${details[0]}`;
      return `${first.past}${detail}`;
    }
    if (first.countStyle === 'times') return `${first.past} ${_mobileTraceCountPhrase(count)}`;
    const tail = details.length ? `: ${details.join(', ')}` : '';
    return `${first.past} ${count} ${first.plural}${tail}`;
  }

  function _mobileTraceToolSummary(entries) {
    const structured = toolActivitySummary(entries);
    if (structured) return structured;
    const calls = _mobileTraceLogicalTools(entries);
    const groups = new Map();
    calls.forEach((call) => {
      const key = `${call.key}|${call.status === 'failed' ? 'failed' : 'ok'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(call);
    });
    const parts = [...groups.values()].map(_mobileTraceLogicalGroupText).filter(Boolean);
    if (parts.length) return _mobileTraceJoinSummaryParts(parts.slice(0, 3));
    const count = _mobileVisibleTraceEntries(entries).length;
    return `Used ${count} tool${count === 1 ? '' : 's'}`;
  }

  function _mobileTraceCurrentToolLabel(entries) {
    const structured = toolActivitySummary(entries, { live: true });
    if (structured) return structured;
    const calls = _mobileTraceLogicalTools(entries);
    const call = calls[calls.length - 1];
    if (call) {
      if (call.status === 'failed') return `${call.noun.charAt(0).toUpperCase()}${call.noun.slice(1)} failed${call.detail ? `: ${call.detail}` : ''}`;
      if (call.detailPrefix === 'for' && call.detail) return `${call.gerund} for ${call.detail}`;
      if (call.detail) return `${call.gerund}${call.detailPrefix ? ` ${call.detailPrefix}:` : ''} ${call.detail}`;
      return `${call.gerund} ${call.noun}`;
    }
    return _mobileTraceToolSummary(entries);
  }

  function _mobileTraceSummaryKey(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function _renderMobileGroupedTrace(entries, { streaming = false, openLiveCurrent = false, visibleKinds = null, openThoughts = false } = {}) {
    const kindFilter = Array.isArray(visibleKinds) || visibleKinds instanceof Set
      ? new Set(Array.from(visibleKinds).map((kind) => String(kind || '').toLowerCase()))
      : null;
    let groups = _mobileTraceGroups(entries).filter((group) => !kindFilter || kindFilter.has(String(group.kind || '').toLowerCase()));
    if (!groups.length) return '';
    if (!streaming
      && !groups.some((group) => (group.kind === 'tools' || group.kind === 'compaction') && group.entries.length > 0)
      && !kindFilter?.has('thought')
      && !kindFilter?.has('thought-summary')) return '';
    let latestToolGroupIndex = groups.reduce((latest, group, index) => (
      group.kind === 'tools' ? index : latest
    ), -1);
    const activeProgressSummary = streaming ? _mobileTraceProgressSummary(entries) : '';
    // The mutable progress slot belongs to the current live tool phase. Once
    // a tool group is the last group, hide its matching Thought copy so the
    // text has one visual owner and cannot appear to overwrite an earlier
    // thought position during rapid stream paints or recovery.
    if (streaming && activeProgressSummary && latestToolGroupIndex === groups.length - 1) {
      groups = groups.filter((group) => !(
        group.kind === 'thought-summary'
        && _mobileTraceThoughtTextsSimilar(_mobileTraceProgressSummary(group.entries), activeProgressSummary)
      ));
      latestToolGroupIndex = groups.reduce((latest, group, index) => (
        group.kind === 'tools' ? index : latest
      ), -1);
    }
    return `<div class="pm-trace-timeline">${groups.map((group, index) => {
      if (group.kind === 'thought' || group.kind === 'thought-summary') {
        const isSummaryThought = group.kind === 'thought-summary';
        const isLiveThought = streaming && index === groups.length - 1;
        const progressSummary = isSummaryThought && isLiveThought ? _mobileTraceProgressSummary(group.entries) : '';
        const durationMs = _mobileTraceGroupDurationMs(group.entries, { live: isLiveThought });
        const summaryMarkup = progressSummary
          ? `<div class="pm-trace-thought-summary" aria-live="polite"><strong data-pm-trace-summary-key="${escapeHtml(_mobileTraceSummaryKey(progressSummary))}">${escapeHtml(progressSummary)}</strong></div>`
          : '';
        return `<div class="pm-trace-thought-group" data-pm-trace-group="${escapeHtml(group.id)}" data-thought-duration-ms="${durationMs}">
          ${summaryMarkup}
          <div class="pm-trace-thought-body"><div class="pm-live-trace">${group.entries.map(_renderMobileLiveTraceEntry).join('')}</div></div>
        </div>`;
      }
      if (group.kind === 'compaction') {
        return group.entries.map(_renderMobileCompactionBreak).join('');
      }
      if (group.kind === 'vision') {
        return `<div class="pm-trace-vision-break" data-pm-trace-group="${escapeHtml(group.id)}">${group.entries.map(_renderMobileLiveTracePreview).join('')}</div>`;
      }
      const isLiveCurrent = streaming && index === latestToolGroupIndex && index === groups.length - 1;
      const progressSummary = isLiveCurrent ? activeProgressSummary : '';
      const summary = progressSummary || (isLiveCurrent ? _mobileTraceCurrentToolLabel(group.entries) : _mobileTraceToolSummary(group.entries));
      const summaryKey = _mobileTraceSummaryKey(summary);
      const visibleEntries = _mobileVisibleTraceEntries(group.entries);
      const callCount = visibleEntries.filter((entry) => entry?.activity?.kind === 'operation').length;
      const nonReasoningEntries = visibleEntries.filter((entry) => !_isMobileTraceReasoningSummaryType(entry?.type));
      const itemCount = callCount || nonReasoningEntries.length || (visibleEntries.length ? 1 : 0);
      const itemLabel = callCount ? 'call' : 'item';
      const openAttr = isLiveCurrent && openLiveCurrent ? ' open' : '';
      return `<details class="pm-trace-tool-group"${openAttr}${isLiveCurrent ? ' data-pm-trace-live-current="1"' : ''} data-pm-trace-group="${escapeHtml(group.id)}">
        <summary class="pm-trace-tool-summary">
          <span class="pm-trace-tool-icon${isLiveCurrent ? ' is-live' : ''}" aria-hidden="true">${isLiveCurrent ? '' : renderToolActivityIcon({ family: 'tool', key: 'tool.summary' }, escapeHtml)}</span>
          <strong data-pm-trace-summary-key="${escapeHtml(summaryKey)}">${escapeHtml(summary)}</strong>
          <span class="pm-trace-tool-chevron" aria-hidden="true">›</span>
          <em>${itemCount} ${itemLabel}${itemCount === 1 ? '' : 's'}</em>
        </summary>
        <div class="pm-trace-tool-body">${_renderMobileLiveTrace(group.entries)}</div>
      </details>`;
    }).join('')}</div>`;
  }



  function _renderMobileQuestionCard(item) {
    const q = _normalizeMobileQuestion(item);
    if (!q.id || !q.questions.length) return '';
    // Submission is optimistic: remove the card before the network round-trip
    // so the stream never leaves an answered card behind while the agent resumes.
    if (q.status === 'submitting') return '';
    const pending = q.status === 'pending';
    const questionCount = q.questions.length;
    const requestedIndex = Number(q.currentIndex);
    const currentIndex = Number.isFinite(requestedIndex)
      ? Math.max(0, Math.min(questionCount - 1, Math.floor(requestedIndex)))
      : 0;
    const currentQuestion = q.questions[currentIndex];
    const isLastQuestion = currentIndex === questionCount - 1;
    // Escape the inline JS id arg for use inside a double-quoted onclick
    // attribute. escapeHtml turns the quotes into entities that decode back to
    // a valid JS string literal in the browser.
    const idJson = escapeHtml(JSON.stringify(q.id));
    const answerMap = new Map((q.answers || []).map((a) => [String(a?.id || ''), a || {}]));
    const visibleQuestions = pending ? [currentQuestion] : q.questions;
    const blocks = visibleQuestions.map((qq) => {
      const ans = answerMap.get(qq.id) || {};
      if (!pending) {
        const sel = Array.isArray(ans.selected) ? ans.selected : [];
        const txt = [sel.join(', '), String(ans.text || ''), ans.other ? `Other: ${ans.other}` : ''].filter(Boolean).join(' · ') || 'No answer';
        return `<div class="pm-q-block"><div class="pm-q-label">${escapeHtml(qq.label)}</div><div class="pm-q-answered">${escapeHtml(txt)}</div></div>`;
      }
      const opts = (qq.options || []).map((opt) => `<button type="button" class="pm-q-opt" data-pm-q-opt="${escapeHtml(opt)}" aria-pressed="false" onclick="_mobileQuestionToggleOption(this, '${escapeHtml(qq.mode)}')"><span class="pm-q-check" aria-hidden="true"></span><span class="pm-q-opt-label">${escapeHtml(opt)}</span></button>`).join('');
      const textArea = qq.mode === 'text'
        ? `<textarea class="pm-q-input" data-pm-q-text="1" rows="3" placeholder="Type your answer" aria-label="${escapeHtml(qq.label)}"></textarea>`
        : '';
      const otherArea = qq.allowOther && qq.mode !== 'text'
        ? `<div class="pm-q-other-row">
            <button type="button" class="pm-q-other-toggle" aria-expanded="false" aria-pressed="false" onclick="_mobileQuestionToggleOther(this)"><span class="pm-q-check" aria-hidden="true"></span><span>Other…</span></button>
            <textarea class="pm-q-input" data-pm-q-other="1" rows="2" placeholder="Type another answer" aria-label="Other answer for ${escapeHtml(qq.label)}" hidden></textarea>
          </div>`
        : '';
      return `<div class="pm-q-block" data-pm-q="${escapeHtml(qq.id)}" data-pm-q-mode="${escapeHtml(qq.mode)}">
        <div class="pm-q-label">${escapeHtml(qq.label)}</div>
        ${opts ? `<div class="pm-q-opts">${opts}</div>` : ''}
        ${textArea}
        ${otherArea}
      </div>`;
    }).join('');
    return `<div class="pm-question-card pm-question-${escapeHtml(q.status)}" data-pm-q-card="${escapeHtml(q.id)}" data-pm-q-index="${currentIndex}" data-pm-q-total="${questionCount}">
      ${pending && questionCount > 1 ? `<div class="pm-q-head"><span class="pm-q-progress" aria-label="Question ${currentIndex + 1} of ${questionCount}"><span class="pm-q-progress-current">${currentIndex + 1}</span><span class="pm-q-progress-total">/${questionCount}</span></span></div>` : ''}
      ${blocks}
      ${pending
        ? `<div class="pm-q-actions"><button type="button" class="pm-q-submit" data-pm-q-submit="1" onclick="_submitMobileQuestion(${idJson})">${isLastQuestion ? 'Submit answer' : 'Next question'}</button><button type="button" class="pm-q-cancel" onclick="_cancelMobileQuestion(${idJson})">Cancel</button></div>`
        : ''}
    </div>`;
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
      threadEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-thought-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
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
      threadEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-thought-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
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
    threadEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach(_wireMobileApprovalActionButton);
    _wireMobileProcessRunActions(threadEl);
    _wireMobileChatEnhancements(threadEl);
    _scheduleMobileThreadCacheSave(sid);
    _renderMobileApprovalSheet();
    const hasTranscriptTurn = runtimeRows.some((row) => {
      const message = row?.msg || row?.turn || null;
      return Boolean(message && typeof message === 'object' && String(message.role || '').trim());
    });
    if (hasTranscriptTurn && !mobileFirstTranscriptPaintMarked) {
      mobileFirstTranscriptPaintMarked = true;
      context.markMobileLifecycle?.('firstTranscriptPaint');
    }
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
    const isToolGroup = currentGroup.classList.contains('pm-trace-tool-group');
    const isThoughtGroup = currentGroup.classList.contains('pm-trace-thought-group');
    if (isToolGroup || isThoughtGroup) {
      const currentSummary = Array.from(currentGroup.children).find((node) => node.tagName === 'SUMMARY' || node.classList?.contains('pm-trace-thought-summary'));
      const nextSummary = Array.from(nextGroup.children).find((node) => node.tagName === 'SUMMARY' || node.classList?.contains('pm-trace-thought-summary'));
      if (currentSummary && nextSummary && currentSummary.innerHTML !== nextSummary.innerHTML) {
        currentSummary.innerHTML = nextSummary.innerHTML;
      }
      const bodyClass = isToolGroup ? 'pm-trace-tool-body' : 'pm-trace-thought-body';
      const currentBody = Array.from(currentGroup.children).find((node) => node.classList?.contains(bodyClass));
      const nextBody = Array.from(nextGroup.children).find((node) => node.classList?.contains(bodyClass));
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
      const nextLiveTraceTimeline = nextBubble.querySelector('.pm-trace-timeline');
      const currentHasCompletedTraceLayout = Boolean(
        currentBubble.querySelector('.pm-trace-drawer[data-trace-completed="1"]'),
      );
      const nextHasCompletedTraceLayout = Boolean(
        nextBubble.querySelector('.pm-trace-drawer[data-trace-completed="1"]'),
      );
      // The final frame splits the live all-in-one timeline into visible
      // thoughts and a collapsed tool drawer. Do not reconcile the old
      // timeline against the first timeline in that new layout: that would
      // move the live tool groups into the thought surface and make the
      // completion paint look like an out-of-order rewrite.
      const enteredCompletedTraceLayout = !currentHasCompletedTraceLayout && nextHasCompletedTraceLayout;
      const preserveLiveTraceTimeline = Boolean(
        stableLiveTraceTimeline
        && !nextLiveTraceTimeline
        && currentStreaming
        && Array.isArray(message.liveTraceEntries)
        && message.liveTraceEntries.length,
      );
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
        currentEl.querySelectorAll('.pm-trace-tool-summary strong[data-pm-trace-summary-key], .pm-trace-thought-summary strong[data-pm-trace-summary-key]').forEach((node) => {
          const groupKey = node.closest('[data-pm-trace-group]')?.getAttribute('data-pm-trace-group') || '';
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
        currentEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-thought-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
          const traceId = d.getAttribute('data-pm-trace-group') || d.getAttribute('data-pm-trace-entry-id') || detailIndex;
          const key = `${d.classList.contains('pm-trace-compaction') ? 'compaction' : 'group'}:${traceId}`;
          if (finalizedThisPatch || enteredCompletedTraceLayout) {
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
        let renderedLiveTraceTimeline = currentBubble.querySelector('.pm-trace-timeline');
        // A transient recovery/render pass can briefly produce a bubble with
        // no trace markup even though the source turn still has live entries.
        // Keep the current timeline attached until the authoritative source
        // either renders it again or is explicitly reset to an empty trace.
        if (preserveLiveTraceTimeline && !renderedLiveTraceTimeline) {
          currentBubble.appendChild(stableLiveTraceTimeline);
          renderedLiveTraceTimeline = stableLiveTraceTimeline;
        }
        if (!enteredCompletedTraceLayout
          && stableLiveTraceTimeline && renderedLiveTraceTimeline && renderedLiveTraceTimeline !== stableLiveTraceTimeline
          && _patchMobileLiveTraceTimeline(stableLiveTraceTimeline, renderedLiveTraceTimeline)) {
          renderedLiveTraceTimeline.replaceWith(stableLiveTraceTimeline);
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
        if (!enteredCompletedTraceLayout) currentBubble.querySelectorAll('.pm-trace-tool-summary strong[data-pm-trace-summary-key], .pm-trace-thought-summary strong[data-pm-trace-summary-key]').forEach((node) => {
          const groupKey = node.closest('[data-pm-trace-group]')?.getAttribute('data-pm-trace-group') || '';
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
        currentEl.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-thought-group, details.pm-trace-compaction').forEach((d, detailIndex) => {
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
    patchedEl.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach(_wireMobileApprovalActionButton);
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
        drawer.querySelectorAll('details.pm-trace-tool-group, details.pm-trace-thought-group').forEach((detail) => detail.removeAttribute('open'));
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
  // Background/process rendering and agent transcript presentation are Chat-owned optional work.
function _mobileAgentMessageAttachments(message) {
  return [
    ...(Array.isArray(message?.body?.attachments) ? message.body.attachments : []),
    ...(Array.isArray(message?.attachmentPreviews) ? message.attachmentPreviews : []),
    ...(Array.isArray(message?.metadata?.attachmentPreviews) ? message.metadata.attachmentPreviews : []),
  ].filter(Boolean);
}

function _mobileAgentMessageFiles(message) {
  return [
    ...(Array.isArray(message?.files) ? message.files : []),
    ...(Array.isArray(message?.canvasFiles) ? message.canvasFiles : []),
    ...(Array.isArray(message?.metadata?.canvasFiles) ? message.metadata.canvasFiles : []),
    ...(Array.isArray(message?.metadata?.files) ? message.metadata.files : []),
  ].filter(Boolean);
}

function _mobileAgentMessageFileChanges(message) {
  return message?.fileChanges || message?.metadata?.fileChanges || message?.body?.fileChanges || null;
}

function _mobileAgentTurnPresentation(message) {
  const metadata = message?.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  return {
    ...message,
    artifacts: Array.isArray(message?.artifacts) ? message.artifacts : metadata.artifacts,
    generatedImages: Array.isArray(message?.generatedImages) ? message.generatedImages : metadata.generatedImages,
    generatedVideos: Array.isArray(message?.generatedVideos) ? message.generatedVideos : metadata.generatedVideos,
    canvasFiles: Array.isArray(message?.canvasFiles) ? message.canvasFiles : metadata.canvasFiles,
    fileChanges: message?.fileChanges || metadata.fileChanges,
    productCarousel: message?.productCarousel || metadata.productCarousel,
    richArtifacts: Array.isArray(message?.richArtifacts) ? message.richArtifacts : metadata.richArtifacts,
    goalCompletionReport: message?.goalCompletionReport || metadata.goalCompletionReport,
  };
}

function _findMobileCompletedTurn(thread, evt = null, sessionId = '') {
  if (!Array.isArray(thread)) return null;
  const clientRequestId = String(evt?.clientRequestId || evt?.data?.clientRequestId || '').trim();
  const streamId = String(evt?.streamId || evt?.data?.streamId || '').trim();
  if (!clientRequestId && !streamId) return null;
  const sid = String(sessionId || evt?.sessionId || '').trim();
  const pinned = sid ? __pmChat.completedAssistantTurns?.[sid] : null;
  if (pinned && Date.now() - Number(pinned.at || 0) <= 120_000) {
    const pinnedTurn = pinned.turn;
    if (clientRequestId && String(pinnedTurn?._clientRequestId || '').trim() === clientRequestId) return pinnedTurn;
    if (streamId && String(pinnedTurn?._streamId || pinnedTurn?._pmLastStreamId || '').trim() === streamId) return pinnedTurn;
  }
  return [...thread].reverse().find((turn) => {
    if (turn?.role !== 'ai' || turn.streaming === true) return false;
    if (clientRequestId && String(turn._clientRequestId || '').trim() === clientRequestId) return true;
    return !!streamId && String(turn._streamId || turn._pmLastStreamId || '').trim() === streamId;
  }) || null;
}

function _ackMobileAbort(turn) {
  if (!turn) return false;
  if (turn._pmAbortAcknowledged === true && turn._pmAbortRequested !== true) return true;
  turn._pmAbortRequested = false;
  turn._pmAbortAcknowledged = true;
  turn.streaming = false;
  turn._pmLiveActivityCompleted = true;
  if (!String(turn.body?.text || turn.content || '').trim()) {
    turn.body = { ...(turn.body || {}), text: '[Generation stopped by user. Runtime abort sent and process log preserved.]' };
    turn.content = turn.body.text;
  }
  delete turn.errorPresentation;
  return true;
}

function _voiceMessageMeta(message) {
  const source = [
    message?.source,
    message?.metadata?.source,
    message?.metadata?.channelSource,
    message?.body?.source,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  if (!source || !/voice/i.test(source)) return '';
  return message?.role === 'user' ? 'Voice transcript' : 'Voice response';
}

function _normalizeCollapsedAgentMarkdown(text) {
  const raw = String(text || '');
  const hasInlineHeading = /[^\n][ \t]+#{1,6}[ \t]+\S/.test(raw);
  const inlineListCount = (raw.match(/[^\n][ \t]+-[ \t]+\S/g) || []).length;
  if (!hasInlineHeading && inlineListCount < 2) return raw;
  return raw.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/([^\n])[ \t]+(#{1,6}[ \t]+\S)/g, '$1\n\n$2')
      .replace(/([^\n])[ \t]+(-[ \t]+\S)/g, '$1\n$2');
  }).join('');
}

function _renderMobileAgentChatBubble(message, options = {}) {
  const role = String(message?.role || message?.from || options.role || 'agent').toLowerCase();
  const fromUser = role === 'user' || role === 'you' || role === 'human';
  const timeValue = message?.createdAt || message?.timestamp || message?.ts;
  const time = timeValue ? _formatTimeAgo(timeValue) : '';
  const text = String(message?.content || message?.message || message?.text || message?.body?.text || '').replace(/\n\n\[UPLOADED FILES\][\s\S]*$/, '').trim();
  const markdownText = fromUser ? text : _normalizeCollapsedAgentMarkdown(text);
  const voiceMeta = _voiceMessageMeta(message);
  const attachments = _mobileAgentMessageAttachments(message);
  const attachmentHtml = attachments.length ? _renderChatAttachmentPreviews(attachments, false) : '';
  const progress = message?._progress ? `<div class="pm-sa-progress">${escapeHtml(message._progress)}</div>` : '';
  const streaming = message?.streaming === true || !!message?._progress || (message && message._done !== true && options.live === true);
  const explicitStartedAt = Number(message?.workStartedAt || message?.startedAt || 0);
  const assistantLike = {
    ...message,
    role: 'ai',
    timestamp: Number(timeValue || Date.now()),
    streaming,
    workStartedAt: (Number.isFinite(explicitStartedAt) && explicitStartedAt > 0)
      ? explicitStartedAt
      : (streaming ? Number(timeValue || Date.now()) : 0),
  };
  const traceMessage = {
    ...assistantLike,
    content: text,
    body: { ...(message?.body || {}), text },
    processEntries: Array.isArray(message?.processEntries) ? message.processEntries : [],
    liveTraceEntries: Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [],
    metadata: {
      ...(message?.metadata || {}),
      processEntries: Array.isArray(message?.metadata?.processEntries) ? message.metadata.processEntries : [],
      liveTraceEntries: Array.isArray(message?.metadata?.liveTraceEntries) ? message.metadata.liveTraceEntries : [],
    },
  };
  const turnPresentation = _mobileAgentTurnPresentation(message);
  let inner = '';
  if (fromUser) {
    inner = `${voiceMeta ? `<span class="pm-sender">${escapeHtml(voiceMeta)}</span>` : ''}<div class="markdown-body">${_renderMobileMarkdown(markdownText)}</div>${attachmentHtml}`;
  } else {
    const sender = String(options.sender || message?.fromLabel || message?.body?.sender || message?.fromName || 'Agent');
    inner += _renderMobileWorkTimer(traceMessage);
    inner += `<span class="pm-sender">${escapeHtml(voiceMeta || sender)}</span>`;
    const answerStarted = !!String(text || '').trim();
    const isVoiceTraceTurn = _isMobileVoiceTraceTurn(traceMessage);
    // Background-agent details are a live work surface: keep their tool
    // timeline visible while an answer starts streaming instead of replacing
    // the timeline with the first response token.
    const liveTraceHtml = streaming && Array.isArray(traceMessage.liveTraceEntries)
      ? _renderMobileGroupedTrace(traceMessage.liveTraceEntries, { streaming: true, openLiveCurrent: isVoiceTraceTurn })
      : '';
    const hasLiveTrace = !!liveTraceHtml;
    const completedTraceEntries = !streaming ? _mobileWorkflowTraceEntriesForMessage(traceMessage) : [];
    if (hasLiveTrace) {
      // Keep activity mounted through final-answer streaming. The work timer
      // owns the disclosure target, so active traces can be collapsed without
      // disappearing or being rebuilt as a second tool stream.
      inner += `<div class="pm-trace-drawer open" data-trace-live="1">${liveTraceHtml}</div>`;
    } else if (_mobileTraceHasToolGroup(completedTraceEntries)) {
      inner += `<div class="pm-trace-drawer" data-trace-completed="1">${_renderMobileGroupedTrace(completedTraceEntries, { streaming: false })}</div>`;
    } else {
      inner += progress;
    }
    const hasPendingImageGeneration = _hasPendingImageGeneration(traceMessage) && !_collectMessageMedia(message).some((media) => media.kind === 'image' && media.generated);
    inner += text
      ? `<div class="markdown-body">${_renderMobileMarkdown(markdownText)}</div>`
      : (streaming && !hasPendingImageGeneration && !hasLiveTrace ? `<div class="thinking"><div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div></div>` : '');
    inner += attachmentHtml;
    inner += _renderMobileRichArtifacts(turnPresentation);
    if (!(Array.isArray(turnPresentation.richArtifacts) && turnPresentation.richArtifacts.some((artifact) => artifact?.type === 'products'))) {
      inner += _renderMobileProductCarousel(turnPresentation);
    }
    inner += _renderMobileMediaGallery(_collectMessageMedia({
      ...turnPresentation,
      files: _mobileAgentMessageFiles(turnPresentation),
      artifacts: Array.isArray(turnPresentation.artifacts) ? turnPresentation.artifacts : [],
    }));
    inner += _renderMobileFileChanges(_mobileAgentMessageFileChanges(turnPresentation));
    inner += _renderMobileThreadLinkArtifacts(turnPresentation);
    inner += _renderMobileGoalCompletionReport(turnPresentation.goalCompletionReport);
    if (message?.approvalRequest) {
      inner += `<div class="pm-chat-approvals-inline">${_renderMobileApprovalCard(message.approvalRequest, { compact: false })}</div>`;
    }
    if (hasPendingImageGeneration) {
      inner += _renderMobileGeneratedImageLoadingCard();
    }
  }
  const backgroundDetailAttr = options.backgroundAgentId
    ? ` data-pm-background-agent-message="${escapeHtml(String(options.backgroundAgentId))}"`
    : '';
  return `
    <div class="pm-msg ${fromUser ? 'from-user' : 'from-ai'} pm-agent-chat-msg"${streaming && !fromUser ? ' data-streaming="1"' : ''}${backgroundDetailAttr}>
      <div class="pm-bubble">
        ${inner}
        ${time ? `<span class="pm-time">${escapeHtml(time)}</span>` : ''}
      </div>
    </div>`;
}

function _mobileMainPlanState(sessionId = __pmChat.activeSessionId) {
  if (!__pmChat.mainPlanProgress || typeof __pmChat.mainPlanProgress !== 'object') {
    __pmChat.mainPlanProgress = {};
  }
  const agentDc = __pmRealtimeAgent?.conn?.dc;
  if (agentDc?.readyState === 'open') {
    try { agentDc.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
    if (__pmRealtimeAgent?.conn?.provider !== 'xai') {
      try { agentDc.send(JSON.stringify({ type: 'output_audio_buffer.clear' })); } catch {}
    }
  }
  try { __pmRealtimeAgent?.conn?.playback?.interrupt?.(); } catch {}
  __pmRealtimeAgent.activeResponse = false;
  __pmRealtimeAgent.narrationPending = false;
  const sid = String(sessionId || '');
  if (!__pmChat.mainPlanProgress[sid]) {
    __pmChat.mainPlanProgress[sid] = { items: [], activeIndex: -1, total: 0, open: false };
  }
  return __pmChat.mainPlanProgress[sid];
}

function _applyMobileMainPlanProgress(evt = {}, sessionId = __pmChat.activeSessionId) {
  const state = _mobileMainPlanState(sessionId);
  const source = String(evt.source || '').trim().toLowerCase();
  const incoming = Array.isArray(evt.items) ? evt.items : [];
  // Only an explicit declare_plan owns this UI. Internal preflight and inferred
  // tool-sequence progress must never create or update the visible plan pill.
  if (source !== 'declared' || !incoming.length || Number(evt.total || incoming.length) <= 0) {
    state.items = [];
    state.activeIndex = -1;
    state.total = 0;
    state.open = false;
    return state;
  }
  state.items = incoming.map((item, index) => ({
    text: String(item?.text || item?.label || `Step ${index + 1}`).trim(),
    status: _mobileGoalStepStatus(item?.status),
  }));
  state.total = Math.max(state.items.length, Number(evt.total || 0) || 0);
  state.activeIndex = Number.isFinite(Number(evt.activeIndex)) ? Number(evt.activeIndex) : state.items.findIndex((item) => item.status === 'in_progress');
  return state;
}

function _setMobileToolProgress(sessionId, evt = {}) {
  if (evt.show_pill !== true) return false;
  const sid = String(sessionId || '').trim();
  const message = String(evt.message || '').trim();
  if (!sid || !message) return false;
  __pmChat.toolProgressBySession[sid] = {
    action: String(evt.action || evt.name || evt.toolName || 'tool').trim(),
    message: message.slice(0, 180),
    phase: String(evt.phase || 'working').trim(),
    current: Number.isFinite(Number(evt.current)) ? Number(evt.current) : null,
    total: Number.isFinite(Number(evt.total)) ? Number(evt.total) : null,
    updatedAt: Date.now(),
  };
  return true;
}

function _clearMobileToolProgress(sessionId, action = '') {
  const sid = String(sessionId || '').trim();
  const state = __pmChat.toolProgressBySession?.[sid];
  if (!state) return false;
  const expected = String(action || '').trim();
  if (expected && state.action && expected !== state.action) return false;
  delete __pmChat.toolProgressBySession[sid];
  return true;
}

function _renderMobileToolProgressDock(dock, sessionId = __pmChat.activeSessionId) {
  const host = dock || document.getElementById('pm-tool-progress-dock');
  if (!host) return;
  const sid = String(sessionId || '').trim();
  const state = __pmChat.toolProgressBySession?.[sid];
  const activeTurn = [...(Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [])]
    .reverse()
    .find((message) => message?.role === 'ai' && message?.streaming === true);
  const inlineActivityVisible = !!activeTurn
    && (Array.isArray(activeTurn.liveTraceEntries) && activeTurn.liveTraceEntries.length > 0);
  // Foreground activity belongs to the assistant row once the first trace
  // entry exists. Keep this dock only as a short-lived fallback before that
  // row is ready, or when a background run has no inline message surface.
  host.hidden = !state?.message || inlineActivityVisible;
  host.innerHTML = state?.message && !inlineActivityVisible ? `
    <div class="pm-tool-progress-pill" role="status">
      <span class="pm-tool-progress-spinner" aria-hidden="true"></span>
      <strong>${escapeHtml(state.message)}</strong>
    </div>
  ` : '';
  host.closest?.('.pm-page')?.classList?.toggle('pm-tool-progress-active', !!state?.message);
  try { window.__pmMobileToolProgressDockChanged?.(); } catch {}
}

function _syncMobileRuntimePillPair(host) {
  const page = host?.closest?.('.pm-page');
  if (!page) return;
  const planDock = page.querySelector('#pm-main-plan-dock');
  const bgDock = page.querySelector('#pm-background-spawn-dock');
  const goalDock = page.querySelector('.pm-mobile-goal-strip:not(.pm-mobile-goal-strip-inline)');
  const hasGoalPill = !!goalDock && !goalDock.hidden;
  const goalAgentPillsPaired = hasGoalPill
    && goalDock.dataset.expanded !== 'true'
    && !!bgDock
    && !bgDock.hidden
    && bgDock.classList.contains('is-collapsed');
  const paired = !hasGoalPill && !!planDock && !planDock.hidden && !planDock.classList.contains('is-open')
    && !!bgDock && !bgDock.hidden && bgDock.classList.contains('is-collapsed');
  page.classList.toggle('pm-runtime-pills-paired', paired);
  page.classList.toggle('pm-runtime-goal-agent-pills-paired', goalAgentPillsPaired);
  page.classList.toggle('pm-goal-pill-active', hasGoalPill);
  page.classList.remove('pm-goal-plan-pills-paired');
}

function _renderMobileMainPlanDock(dock, sessionId = __pmChat.activeSessionId) {
  const host = dock || document.getElementById('pm-main-plan-dock');
  if (!host) return;
  const state = _mobileMainPlanState(sessionId);
  const items = Array.isArray(state.items) ? state.items : [];
  host.hidden = !items.length;
  if (!items.length) {
    host.innerHTML = '';
    host.classList.remove('is-open');
    _syncMobileRuntimePillPair(host);
    return;
  }
  const done = items.filter((item) => ['done', 'skipped'].includes(_mobileGoalStepStatus(item.status))).length;
  const total = Math.max(items.length, Number(state.total || 0) || items.length);
  const percent = total ? Math.round((done / total) * 100) : 0;
  host.classList.toggle('is-open', state.open === true);
  host.innerHTML = `
    ${state.open ? `<div class="pm-main-plan-popover" role="region" aria-label="Plan steps">
      <div class="pm-main-plan-steps">
        ${items.map((item, index) => {
          const status = _mobileGoalStepStatus(item.status);
          return `<div class="pm-main-plan-step ${escapeHtml(status)}">
            <span>${status === 'done' || status === 'skipped' ? '&#10003;' : String(index + 1)}</span>
            <p>${escapeHtml(item.text.slice(0, 240))}</p>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
    <button type="button" class="pm-main-plan-pill" data-pm-main-plan-toggle aria-expanded="${state.open === true}">
      <span class="pm-main-plan-ring" style="--pm-plan-progress:${percent}%" aria-hidden="true"><i></i></span>
      <strong>${done} of ${total}</strong>
      <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
    </button>
  `;
  host.querySelector('[data-pm-main-plan-toggle]')?.addEventListener('click', () => {
    try { pmHaptic(12); } catch {}
    state.open = !state.open;
    if (state.open) {
      const goal = _getMobileGoalForSession(sessionId);
      if (goal) {
        __pmChat.goalDetailsOpen[String(sessionId || '')] = false;
        _renderMobileGoalPill(document.querySelector('.pm-mobile-goal-strip:not(.pm-mobile-goal-strip-inline)'), sessionId);
      }
      _setMobileBackgroundSpawnDockOpen(sessionId, false);
      _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sessionId);
    }
    _renderMobileMainPlanDock(host, sessionId);
    try { window.__pmMobileBackgroundSpawnDockChanged?.(); } catch {}
  });
  _syncMobileRuntimePillPair(host);
}

function _mobileBackgroundSpawnLanes() {
  if (!__pmChat.backgroundSpawnLanes || typeof __pmChat.backgroundSpawnLanes !== 'object') {
    __pmChat.backgroundSpawnLanes = {};
  }
  return __pmChat.backgroundSpawnLanes;
}

function _mobileBackgroundSpawnDockOpen(sessionId = __pmChat.activeSessionId) {
  if (!__pmChat.backgroundSpawnDockOpen || typeof __pmChat.backgroundSpawnDockOpen !== 'object') {
    __pmChat.backgroundSpawnDockOpen = {};
  }
  return __pmChat.backgroundSpawnDockOpen[String(sessionId || '')] === true;
}

function _setMobileBackgroundSpawnDockOpen(sessionId, open) {
  if (!__pmChat.backgroundSpawnDockOpen || typeof __pmChat.backgroundSpawnDockOpen !== 'object') {
    __pmChat.backgroundSpawnDockOpen = {};
  }
  __pmChat.backgroundSpawnDockOpen[String(sessionId || '')] = open === true;
}

function _mobileBackgroundSpawnClearedIds() {
  if (!__pmChat.backgroundSpawnClearedIds || typeof __pmChat.backgroundSpawnClearedIds !== 'object') {
    __pmChat.backgroundSpawnClearedIds = {};
  }
  return __pmChat.backgroundSpawnClearedIds;
}

function _mobileBackgroundSpawnId(msg = {}) {
  return String(msg.bgId || msg.backgroundId || msg.serverAgentId || msg.agentId || '').trim();
}

function _mobileBackgroundSpawnPromptFromMessage(msg = {}, existing = {}) {
  const direct = String(
    msg.taskPrompt
      || msg.task_prompt
      || msg.browserTaskPrompt
      || msg.task
      || msg.prompt
      || ''
  ).trim();
  if (direct) return direct;
  const args = msg.args && typeof msg.args === 'object' ? msg.args
    : (msg.params && typeof msg.params === 'object' ? msg.params
      : (msg.input && typeof msg.input === 'object' ? msg.input : null));
  const fromArgs = args ? String(args.task_prompt || args.taskPrompt || args.prompt || args.task || '').trim() : '';
  return fromArgs || String(existing.prompt || existing.task || '').trim();
}

function _mobileParseBackgroundStatus(value) {
  if (!value) return null;
  if (value.status && typeof value.status === 'object') return _mobileParseBackgroundStatus(value.status);
  if (typeof value === 'object') return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {}
  }
  return null;
}

function _collectMobileBackgroundSpawnRecoveries(frames = [], sessionId = __pmChat.activeSessionId) {
  const byId = new Map();
  const promptQueue = [];
  const remember = (item = {}) => {
    const id = _mobileBackgroundSpawnId(item) || String(item.id || '').trim();
    if (!id || _mobileBackgroundSpawnClearedIds()[id]) return;
    const existing = byId.get(id) || {};
    byId.set(id, {
      ...existing,
      ...item,
      id,
      bgId: id,
      backgroundId: id,
      sessionId: String(sessionId || item.sessionId || '').trim(),
      spawnerSessionId: String(sessionId || item.spawnerSessionId || '').trim(),
      prompt: String(item.prompt || item.taskPrompt || item.promptPreview || existing.prompt || '').trim(),
      taskPrompt: String(item.taskPrompt || item.prompt || item.promptPreview || existing.taskPrompt || existing.prompt || '').trim(),
    });
  };
  for (const frame of Array.isArray(frames) ? frames : []) {
    const evt = {
      type: String(frame?.type || ''),
      ...(frame?.data && typeof frame.data === 'object' ? frame.data : {}),
      seq: frame?.seq,
      streamId: frame?.streamId,
      at: frame?.at,
    };
    const action = String(evt.action || evt.name || evt.toolName || '').trim();
    if (action !== 'background_spawn') continue;
    if (evt.type === 'tool_call') {
      const prompt = _mobileBackgroundSpawnPromptFromMessage(evt, {});
      if (prompt) promptQueue.push(prompt);
      continue;
    }
    if (evt.type !== 'tool_result') continue;
    const parsed = _mobileParseBackgroundStatus(evt.result || evt.output || evt);
    const prompt = String(parsed?.prompt || parsed?.taskPrompt || parsed?.promptPreview || promptQueue.shift() || '').trim();
    if (parsed?.id) remember({ ...parsed, prompt, taskPrompt: prompt });
  }
  return [...byId.values()];
}

function _linkMobilePendingApprovalsToBackgroundLanes(sessionId = __pmChat.activeSessionId) {
  if (!__pmChat.pendingApprovals) return false;
  let changed = false;
  const activeSid = String(sessionId || __pmChat.activeSessionId || '').trim();
  for (const [sid, list] of Object.entries(__pmChat.pendingApprovals || {})) {
    if (!Array.isArray(list)) continue;
    let listChanged = false;
    list.forEach((approval, index) => {
      const visibleSid = _mobileApprovalVisibleSessionId(approval);
      if (activeSid && visibleSid !== activeSid) return;
      const lane = _linkMobileApprovalToBackgroundLane(approval);
      if (!lane?.approvalRequest) return;
      list[index] = lane.approvalRequest;
      listChanged = true;
      changed = true;
    });
    if (listChanged) __pmChat.pendingApprovals[sid] = list;
  }
  return changed;
}

function _applyMobileBackgroundSpawnStatus(statusInput = {}, sessionId = __pmChat.activeSessionId) {
  const status = _mobileParseBackgroundStatus(statusInput) || {};
  const id = _mobileBackgroundSpawnId(status) || String(status.id || '').trim();
  if (!id || _mobileBackgroundSpawnClearedIds()[id]) return false;
  const sid = String(sessionId || status.spawnerSessionId || status.sessionId || __pmChat.activeSessionId || '').trim();
  const rawState = String(status.state || status.status || 'running').toLowerCase();
  const terminalState = rawState === 'completed' || rawState === 'failed' || rawState === 'timed_out';
  const prompt = String(status.prompt || status.taskPrompt || status.promptPreview || '').trim();
  const msg = {
    ...status,
    bgId: id,
    backgroundId: id,
    sessionId: sid,
    spawnerSessionId: sid,
    state: rawState === 'timed_out' ? 'failed' : rawState,
    taskPrompt: prompt,
    prompt,
    error: rawState === 'timed_out' ? (status.error || 'Background agent timed out.') : status.error,
  };
  if (terminalState) {
    return _completeMobileBackgroundSpawnLane(msg, sid);
  }
  const lane = _upsertMobileBackgroundSpawnLane(msg, sid);
  if (!lane) return false;
  lane.status = rawState === 'queued' || rawState === 'in_progress' ? 'running' : (rawState || 'running');
  lane.message.streaming = true;
  lane.message._done = false;
  if (status.stream?.streamId) lane.streamId = String(status.stream.streamId);
  lane.updatedAt = Date.now();
  _linkMobilePendingApprovalsToBackgroundLanes(sid);
  return true;
}

async function _recoverMobileBackgroundSpawnDock({ sessionId = __pmChat.activeSessionId, frames = [], statuses = [], dock = null } = {}) {
  const sid = String(sessionId || __pmChat.activeSessionId || '').trim();
  if (!sid) return false;
  const byId = new Map();
  const add = (item, fromStatus = false) => {
    const status = _mobileParseBackgroundStatus(item) || {};
    if (_mobileBackgroundSpawnIsVoiceWorker(status)) return;
    const id = _mobileBackgroundSpawnId(status) || String(status.id || '').trim();
    if (!id || _mobileBackgroundSpawnClearedIds()[id]) return;
    const prev = byId.get(id) || {};
    byId.set(id, {
      ...prev,
      ...status,
      id,
      bgId: id,
      backgroundId: id,
      sessionId: sid,
      spawnerSessionId: sid,
      prompt: String(status.prompt || status.taskPrompt || status.promptPreview || prev.prompt || '').trim(),
      taskPrompt: String(status.taskPrompt || status.prompt || status.promptPreview || prev.taskPrompt || prev.prompt || '').trim(),
      _fromStatus: prev._fromStatus || fromStatus,
    });
  };
  _collectMobileBackgroundSpawnRecoveries(frames, sid).forEach((item) => add(item, false));
  (Array.isArray(statuses) ? statuses : []).forEach((status) => add(status, true));
  const missingStatuses = [...byId.values()].filter((item) => !item._fromStatus);
  if (missingStatuses.length) {
    const fetched = await Promise.all(missingStatuses.map((item) =>
      loadMobileBackgroundStatus(item.id).then((res) => res?.status || res).catch(() => null)
    ));
    fetched.filter(Boolean).forEach((status) => add(status, true));
  }
  let changed = false;
  for (const item of byId.values()) {
    changed = _applyMobileBackgroundSpawnStatus(item, sid) || changed;
  }
  changed = _linkMobilePendingApprovalsToBackgroundLanes(sid) || changed;
  if (changed) {
    _renderMobileBackgroundSpawnDock(dock || document.getElementById('pm-background-spawn-dock'), sid);
    try { window.__pmMobileBackgroundSpawnDockChanged?.(); } catch {}
  }
  return changed;
}

function _mobileBackgroundSpawnMatchesSession(msg = {}, sessionId = __pmChat.activeSessionId) {
  if (_mobileBackgroundSpawnIsVoiceWorker(msg)) return false;
  const id = _mobileBackgroundSpawnId(msg);
  if (id && _mobileBackgroundSpawnClearedIds()[id]) return false;
  const activeSid = String(sessionId || '').trim();
  const lane = id ? _mobileBackgroundSpawnLanes()[id] : null;
  const parentSid = String(msg.spawnerSessionId || msg.parentSessionId || msg.mainSessionId || lane?.sessionId || '').trim();
  if (parentSid) return parentSid === activeSid;
  const sid = String(msg.sessionId || '').trim();
  if (!sid) return true;
  const backgroundId = _mobileBackgroundSpawnIdFromSessionId(sid);
  if (backgroundId && lane?.sessionId) return lane.sessionId === activeSid;
  return sid === activeSid;
}

function _upsertMobileBackgroundSpawnLane(msg = {}, sessionId = __pmChat.activeSessionId) {
  const id = _mobileBackgroundSpawnId(msg);
  if (!id) return null;
  const lanes = _mobileBackgroundSpawnLanes();
  const existing = lanes[id] || {};
  const identity = resolveBackgroundAgentIdentity(id, {
    existingName: existing.agentName,
    existingColor: existing.agentColor,
    usedNames: Object.values(lanes).filter((lane) => lane !== existing).map((lane) => lane.agentName || lane.label),
    usedColors: Object.values(lanes).filter((lane) => lane !== existing).map((lane) => lane.agentColor),
  });
  const prompt = _mobileBackgroundSpawnPromptFromMessage(msg, existing);
  const rawSessionId = String(msg.sessionId || '').trim();
  const bgSessionId = String(
    msg.bgSessionId
      || msg.backgroundSessionId
      || (_mobileBackgroundSpawnIdFromSessionId(rawSessionId) ? rawSessionId : '')
      || existing.bgSessionId
      || ''
  ).trim();
  const parentSessionId = String(
    msg.spawnerSessionId
      || msg.parentSessionId
      || msg.mainSessionId
      || existing.sessionId
      || (_mobileBackgroundSpawnIdFromSessionId(rawSessionId) ? '' : rawSessionId)
      || sessionId
      || ''
  ).trim();
  const stored = findBackgroundAgentWork(id, parentSessionId)
    || findBackgroundAgentWork(id, rawSessionId)
    || findBackgroundAgentWork(id);
  const storedProcessEntries = _mobileBackgroundStoredProcessEntries(stored);
  const storedLiveTraceEntries = Array.isArray(stored?.liveTraceEntries) ? stored.liveTraceEntries.slice() : [];
  const storedStatus = String(stored?.status || '').toLowerCase();
  const storedTerminal = ['completed', 'failed', 'timed_out'].includes(storedStatus);
  const resolvedBgSessionId = bgSessionId || String(stored?.backgroundSessionId || '').trim();
  const eventType = String(msg.eventType || msg.type || '').trim().toLowerCase();
  // A background tool result is still only a timeline event. Treating it as
  // lane.result made mobile render the tool output as the agent's final answer
  // and hid the live tool stream until the sheet was reopened.
  const isFinalStreamEvent = eventType === 'final' || eventType === 'done';
  const streamedFinalResult = isFinalStreamEvent
    ? String(msg.reply || msg.text || msg.result || msg.output || '').trim()
    : '';
  const lane = {
    id,
    sessionId: parentSessionId,
    bgSessionId: resolvedBgSessionId,
    label: identity.name,
    agentName: identity.name,
    agentColor: identity.color,
    task: prompt || stored?.task || '',
    prompt: prompt || stored?.task || '',
    status: String(msg.state || existing.status || stored?.status || 'running').trim(),
    expanded: existing.expanded === true,
    startedAt: Number(existing.startedAt || stored?.startedAt || msg.startedAt || Date.now()),
    completedAt: Number(msg.completedAt || existing.completedAt || stored?.completedAt || 0) || null,
    updatedAt: Date.now(),
    message: existing.message || {
      role: 'ai',
      from: identity.name,
      content: storedTerminal ? String(stored?.result || stored?.error || '') : '',
      body: { sender: identity.name, text: storedTerminal ? String(stored?.result || stored?.error || '') : '' },
      processEntries: storedProcessEntries,
      liveTraceEntries: storedLiveTraceEntries,
      streaming: !storedTerminal,
      createdAt: Number(stored?.startedAt || Date.now()) || Date.now(),
      workStartedAt: Number(stored?.startedAt || Date.now()) || Date.now(),
    },
    fileChanges: msg.fileChanges || existing.fileChanges || stored?.fileChanges || null,
    plan: existing.plan || null,
    result: streamedFinalResult || existing.result || stored?.result || '',
    // Like result, a streamed error may describe one failed tool call rather
    // than the background run itself. The terminal bg_agent_done payload owns
    // the durable lane error.
    error: existing.error || stored?.error || '',
    approvalRequest: existing.approvalRequest || null,
    steerMessages: Array.isArray(existing.steerMessages) && existing.steerMessages.length
      ? existing.steerMessages
      : (Array.isArray(stored?.steerMessages) ? stored.steerMessages : []),
    streamId: String(msg.streamId || msg.stream?.streamId || existing.streamId || stored?.streamId || '').trim(),
    lastSeq: Math.max(0, Math.floor(Number(existing.lastSeq || stored?.lastSeq || 0)) || 0),
  };
  lanes[id] = lane;
  if (lane.message) {
    lane.message.from = lane.agentName;
    if (!lane.message.body || typeof lane.message.body !== 'object') lane.message.body = { sender: lane.agentName, text: '' };
    lane.message.body.sender = lane.agentName;
    if (!Array.isArray(lane.message.processEntries) || !lane.message.processEntries.length) {
      lane.message.processEntries = storedProcessEntries;
    }
    if (!Array.isArray(lane.message.liveTraceEntries) || !lane.message.liveTraceEntries.length) {
      lane.message.liveTraceEntries = storedLiveTraceEntries;
    }
  }
  return lane;
}

function _mobileBackgroundStoredDetailRecord(stored, id, sessionId, normalizeTrace) {
  const record = {
    ...stored,
    id,
    sessionId: stored.sessionId || sessionId,
    backgroundSessionId: stored.backgroundSessionId || '',
    task: stored.task || stored.prompt || '',
    status: stored.status || 'running',
    events: _mobileBackgroundStoredProcessEntries(stored),
    liveTraceEntries: Array.isArray(stored.liveTraceEntries)
      ? stored.liveTraceEntries.map(normalizeTrace).filter(Boolean)
      : [],
  };
  return record;
}

function _mobileBackgroundAgentDetailRecord(id, requestedSession, normalizeTrace, buildMessage) {
  const lane = _mobileBackgroundSpawnLanes()[id];
  const stored = findBackgroundAgentWork(id, requestedSession)
    || findBackgroundAgentWork(id, __pmChat.activeSessionId);
  if (!lane) {
    if (!stored) return null;
    const storedRecord = _mobileBackgroundStoredDetailRecord(stored, id, requestedSession, normalizeTrace);
    return { ...storedRecord, message: buildMessage(storedRecord) };
  }
  const identity = resolveBackgroundAgentIdentity(lane.id, {
    existingName: lane.agentName,
    existingColor: lane.agentColor,
  });
  const processEntries = Array.isArray(lane.message?.processEntries) && lane.message.processEntries.length
    ? lane.message.processEntries
    : _mobileBackgroundStoredProcessEntries(stored);
  const liveTraceEntries = Array.isArray(lane.message?.liveTraceEntries) && lane.message.liveTraceEntries.length
    ? lane.message.liveTraceEntries.map(normalizeTrace).filter(Boolean)
    : (Array.isArray(stored?.liveTraceEntries) ? stored.liveTraceEntries : []);
  return {
    id: lane.id,
    sessionId: lane.sessionId || requestedSession,
    backgroundSessionId: lane.bgSessionId || stored?.backgroundSessionId || '',
    agentName: identity.name,
    agentColor: identity.color,
    task: lane.task || lane.prompt || stored?.task || '',
    status: lane.status || stored?.status || 'running',
    startedAt: Number(lane.startedAt || stored?.startedAt || lane.message?.workStartedAt || lane.message?.createdAt || 0) || 0,
    completedAt: Number(lane.completedAt || stored?.completedAt || lane.message?.workEndedAt || 0) || 0,
    updatedAt: Number(lane.updatedAt || stored?.updatedAt || Date.now()) || Date.now(),
    result: String(lane.result || stored?.result || '').trim(),
    error: String(lane.error || stored?.error || '').trim(),
    fileChanges: lane.fileChanges || lane.message?.fileChanges || null,
    events: processEntries,
    liveTraceEntries,
    steerMessages: Array.isArray(lane.steerMessages) && lane.steerMessages.length
      ? lane.steerMessages
      : (Array.isArray(stored?.steerMessages) ? stored.steerMessages : []),
    streamId: lane.streamId || stored?.streamId || '',
    lastSeq: Number(lane.lastSeq || stored?.lastSeq || 0) || 0,
    message: lane.message || null,
  };
}

function _hydrateMobileBackgroundSpawnLane(record, id, sessionId) {
  return _upsertMobileBackgroundSpawnLane({
    ...record,
    bgId: id,
    backgroundId: id,
    state: record.status || 'running',
    prompt: record.task || '',
    taskPrompt: record.task || '',
    sessionId: record.sessionId || sessionId,
    spawnerSessionId: record.sessionId || sessionId,
    bgSessionId: record.backgroundSessionId || '',
    streamId: record.streamId || '',
    seq: record.lastSeq || 0,
    message: record.message,
  }, sessionId);
}

function _mobileBackgroundSpawnWorkRecord(lane) {
  if (!lane) return null;
  const identity = resolveBackgroundAgentIdentity(lane.id, {
    existingName: lane.agentName,
    existingColor: lane.agentColor,
  });
  return {
    id: lane.id,
    sessionId: lane.sessionId || __pmChat.activeSessionId,
    backgroundSessionId: lane.bgSessionId || '',
    agentName: identity.name,
    agentColor: identity.color,
    task: lane.task || lane.prompt,
    status: lane.status,
    startedAt: lane.startedAt,
    completedAt: lane.completedAt || (['completed', 'failed'].includes(String(lane.status || '').toLowerCase()) ? lane.updatedAt : 0),
    updatedAt: lane.updatedAt,
    result: lane.result,
    error: lane.error,
    fileChanges: lane.fileChanges || lane.message?.fileChanges || null,
    events: Array.isArray(lane.message?.processEntries) ? lane.message.processEntries : [],
    liveTraceEntries: Array.isArray(lane.message?.liveTraceEntries) ? lane.message.liveTraceEntries : [],
    steerMessages: Array.isArray(lane.steerMessages) ? lane.steerMessages : [],
    streamId: lane.streamId,
    lastSeq: lane.lastSeq,
  };
}

function _normalizeMobileBackgroundSpawnEvent(msg = {}) {
  const payload = msg?.data && typeof msg.data === 'object' ? msg.data : {};
  const wrapperType = typeof msg.type === 'string' && msg.type !== 'bg_agent_event' ? msg.type : '';
  const eventType = String(
    msg.eventType
      || msg.eventName
      || payload.eventType
      || payload.eventName
      || wrapperType
      || '',
  ).trim();
  if (!eventType) return null;
  const source = { ...payload, ...msg };
  return {
    ...source,
    type: eventType,
    streamId: String(source.streamId || '').trim(),
    seq: Math.max(0, Math.floor(Number(source.seq || 0)) || 0),
    at: Number(source.at || 0) || undefined,
    action: source.action || source.name || source.toolName || '',
    name: source.name || source.action || source.toolName || '',
    actor: source.actor || 'Background Agent',
  };
}

function _extractMobileBackgroundPlanSteps(value) {
  if (Array.isArray(value)) return value.map((step) => String(step || '').trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.steps)) return _extractMobileBackgroundPlanSteps(value.steps);
    if (Array.isArray(value.plan)) return _extractMobileBackgroundPlanSteps(value.plan);
  }
  return [];
}

function _updateMobileBackgroundSpawnPlan(lane, msg = {}) {
  if (!lane) return;
  const eventType = String(msg.eventType || msg.type || '').trim();
  const action = String(msg.action || msg.name || msg.toolName || '').trim();
  if (eventType === 'tool_call' && action === 'bg_plan_declare') {
    const steps = _extractMobileBackgroundPlanSteps(msg.args || msg.params || msg.input || msg);
    if (steps.length) {
      lane.plan = {
        steps: steps.map((text, index) => ({ text, status: index === 0 ? 'in_progress' : 'pending' })),
        activeIndex: 0,
      };
    }
    return;
  }
  if (eventType !== 'tool_result' || action !== 'bg_plan_advance') return;
  if (!lane.plan || !Array.isArray(lane.plan.steps) || !lane.plan.steps.length) return;
  const resultText = String(msg.result || msg.output || '').trim();
  const match = resultText.match(/Step\s+(\d+)\s*\/\s*(\d+)\s+complete/i);
  if (!match) return;
  const completedIndex = Math.max(0, Number(match[1]) - 1);
  const total = Math.max(lane.plan.steps.length, Number(match[2]) || lane.plan.steps.length);
  lane.plan.steps.forEach((step, index) => {
    if (index <= completedIndex) step.status = 'done';
    else if (index === completedIndex + 1 && index < total) step.status = 'in_progress';
    else step.status = 'pending';
  });
  lane.plan.activeIndex = completedIndex + 1 < lane.plan.steps.length ? completedIndex + 1 : -1;
}

function _renderMobileBackgroundSpawnPlan(lane) {
  const steps = Array.isArray(lane?.plan?.steps) ? lane.plan.steps : [];
  if (!steps.length) return '';
  const done = steps.filter((step) => step.status === 'done').length;
  return `
    <div class="pm-background-spawn-plan">
      <div class="pm-background-spawn-plan-head">
        <strong>Progress</strong>
        <span>${done}/${steps.length}</span>
      </div>
      <div class="pm-background-spawn-plan-list">
        ${steps.map((step, index) => {
          const status = ['done', 'failed', 'in_progress'].includes(String(step.status || '')) ? String(step.status) : 'pending';
          const dot = status === 'done' ? '&#10003;' : status === 'failed' ? '&times;' : String(index + 1);
          return `
            <div class="pm-background-spawn-plan-step ${escapeHtml(status)}">
              <span>${dot}</span>
              <p>${escapeHtml(String(step.text || `Step ${index + 1}`).slice(0, 180))}</p>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function _renderMobileBackgroundSpawnPrompt(lane) {
  const prompt = String(lane?.prompt || lane?.task || '').trim();
  if (!prompt) return '';
  return `<div class="pm-background-spawn-prompt">
    <span>Prompt</span>
    <p>${escapeHtml(prompt)}</p>
  </div>`;
}

function _renderMobileBackgroundSpawnFinal(lane) {
  const failed = String(lane?.status || '').toLowerCase() === 'failed';
  const text = String(
    failed
      ? (lane?.error || lane?.message?.content || 'Background Spawn failed.')
      : (lane?.result || lane?.message?.content || 'Background task completed with no textual output.')
  ).trim();
  return `<div class="pm-background-spawn-final ${failed ? 'failed' : 'completed'}">
    <div class="pm-background-spawn-final-head">
      <strong>${failed ? 'Failed' : 'Final response'}</strong>
    </div>
    <div class="markdown-body">${_renderMobileMarkdown(text)}</div>
  </div>`;
}

function _renderMobileBackgroundSpawnPanel(lane, planHtml, processHtml) {
  const status = String(lane?.status || 'running').toLowerCase();
  if (status === 'completed' || status === 'failed') {
    return _renderMobileBackgroundSpawnFinal(lane);
  }
  const approval = lane?.approvalRequest && String(lane.approvalRequest.status || 'pending').toLowerCase() === 'pending'
    ? lane.approvalRequest
    : null;
  if (approval) {
    return `${_renderMobileBackgroundSpawnPrompt(lane)}
      <div class="pm-background-spawn-approval">${_renderMobileApprovalCard(approval, { compact: false })}</div>`;
  }
  return `${_renderMobileBackgroundSpawnPrompt(lane)}${planHtml}${processHtml}`;
}

function _pushMobileBackgroundSpawnEvent(msg = {}, sessionId = __pmChat.activeSessionId) {
  if (!_mobileBackgroundSpawnMatchesSession(msg, sessionId)) return false;
  const lane = _upsertMobileBackgroundSpawnLane(msg, sessionId);
  const evt = _normalizeMobileBackgroundSpawnEvent(msg);
  if (!lane || !evt) return false;
  if (evt.streamId) {
    if (lane.streamId && lane.streamId !== evt.streamId) {
      lane.streamId = evt.streamId;
      lane.lastSeq = 0;
      lane.message.processEntries = [];
      lane.message.liveTraceEntries = [];
    } else {
      lane.streamId = evt.streamId;
    }
    if (evt.seq && evt.seq <= Number(lane.lastSeq || 0)) return false;
  }
  const hasPendingApproval = lane.approvalRequest && String(lane.approvalRequest.status || 'pending').toLowerCase() === 'pending';
  lane.status = lane.status === 'completed' || lane.status === 'failed'
    ? lane.status
    : (hasPendingApproval ? 'approval_required' : 'running');
  if (msg.fileChanges) lane.fileChanges = msg.fileChanges;
  _updateMobileBackgroundSpawnPlan(lane, msg);
  let laneChanged = false;
  if (evt.type === 'approval_created') {
    const approval = _normalizeMobileApproval(evt.approval || evt, {
      bgId: lane.id,
      sessionId: evt.bgSessionId || evt.backgroundSessionId || evt.sourceSessionId || evt.sessionId || lane.bgSessionId,
      spawnerSessionId: lane.sessionId,
      visibleSessionId: lane.sessionId,
    });
    if (approval?.id) {
      lane.approvalRequest = {
        ...approval,
        bgId: lane.id,
        backgroundId: lane.id,
        visibleSessionId: lane.sessionId,
        spawnerSessionId: lane.sessionId,
        backgroundSessionId: approval.backgroundSessionId || lane.bgSessionId || approval.sessionId,
      };
      lane.status = 'approval_required';
      lane.expanded = true;
      _upsertMobilePendingApproval(lane.approvalRequest);
      laneChanged = true;
    }
  } else if (evt.type === 'approval_approved' || evt.type === 'approval_denied' || evt.type === 'approval_expired' || evt.type === 'approval_failed') {
    const status = evt.type === 'approval_approved' ? 'approved'
      : evt.type === 'approval_denied' ? 'rejected'
        : evt.type === 'approval_expired' ? 'expired'
          : 'failed';
    const approvalId = String(evt.approvalId || evt.id || evt.approval?.id || lane.approvalRequest?.id || '').trim();
    if (approvalId && lane.approvalRequest && String(lane.approvalRequest.id || '') === approvalId) {
      lane.approvalRequest = _normalizeMobileApproval({ ...lane.approvalRequest, ...(evt.approval || evt), status });
      if (lane.status === 'approval_required') lane.status = 'running';
      _updateMobilePendingApproval(approvalId, { ...(evt.approval || {}), status });
      laneChanged = true;
    }
  }
  let changed = false;
  if (evt.type === 'user_message') {
    const content = String(evt.message || evt.text || evt.data?.message || '').trim();
    const eventId = String(evt.eventId || evt.id || '').trim();
    if (content && !lane.steerMessages.some((item) => (eventId && item.id === eventId) || item.content === content && Math.abs(Number(item.timestamp || 0) - Number(evt.at || Date.now())) < 5000)) {
      lane.steerMessages.push({
        id: eventId || `background_steer_${lane.id}_${evt.seq || Date.now()}`,
        role: 'user',
        content,
        timestamp: Number(evt.at || Date.now()) || Date.now(),
        channelLabel: 'steer',
        workflowGroupId: `chat_steer_background_${lane.id}`,
        workflowPart: 'interruption',
      });
      lane.steerMessages = lane.steerMessages.slice(-80);
      changed = true;
    }
  } else {
    changed = _applyMobileAgentStreamEvent(lane.message, evt, lane.agentName || 'Background agent');
  }
  if (lane.message?.approvalRequest && !lane.approvalRequest) {
    lane.approvalRequest = {
      ...lane.message.approvalRequest,
      bgId: lane.id,
      backgroundId: lane.id,
      visibleSessionId: lane.sessionId,
      spawnerSessionId: lane.sessionId,
      backgroundSessionId: lane.bgSessionId || lane.message.approvalRequest.sessionId,
    };
    if (String(lane.approvalRequest.status || 'pending') === 'pending') {
      lane.status = 'approval_required';
      lane.expanded = true;
      _upsertMobilePendingApproval(lane.approvalRequest);
      laneChanged = true;
    }
  }
  if (lane.message?.fileChanges) lane.fileChanges = lane.message.fileChanges;
  lane.updatedAt = Date.now();
  if (evt.streamId && evt.seq) lane.lastSeq = evt.seq;
  persistBackgroundAgentWork(_mobileBackgroundSpawnWorkRecord(lane));
  if (mobileSourceState.sessionId === lane.sessionId && !mobileSourceState.history) _renderMobileSourceList(document);
  return changed || laneChanged;
}

function _completeMobileBackgroundSpawnLane(msg = {}, sessionId = __pmChat.activeSessionId) {
  const clearedId = _mobileBackgroundSpawnId(msg);
  const clearedSessionId = String(sessionId || msg.spawnerSessionId || msg.sessionId || __pmChat.activeSessionId || '').trim();
  if (clearedId && _mobileBackgroundSpawnClearedIds()[clearedId]) {
    const existing = findBackgroundAgentWork(clearedId, clearedSessionId) || {};
    const failed = msg.state === 'failed' || msg.state === 'timed_out' || !!msg.error;
    const completedAt = Number(msg.completedAt || Date.now()) || Date.now();
    const identity = resolveBackgroundAgentIdentity(clearedId, {
      existingName: existing.agentName,
      existingColor: existing.agentColor,
    });
    persistBackgroundAgentWork({
      ...existing,
      id: clearedId,
      sessionId: clearedSessionId || existing.sessionId || __pmChat.activeSessionId,
      agentName: identity.name,
      agentColor: identity.color,
      task: existing.task || msg.task || msg.prompt || '',
      status: failed ? 'failed' : 'completed',
      startedAt: existing.startedAt || msg.startedAt || completedAt,
      completedAt,
      updatedAt: Date.now(),
      result: String(msg.result || existing.result || '').trim(),
      error: String(msg.error || existing.error || '').trim(),
      fileChanges: msg.fileChanges || existing.fileChanges || null,
      events: existing.events || [],
    });
    if (mobileSourceState.sessionId === clearedSessionId && !mobileSourceState.history) _renderMobileSourceList(document);
    return true;
  }
  if (!_mobileBackgroundSpawnMatchesSession(msg, sessionId)) return false;
  const lane = _upsertMobileBackgroundSpawnLane(msg, sessionId);
  if (!lane) return false;
  const failed = msg.state === 'failed' || !!msg.error;
  lane.status = failed ? 'failed' : 'completed';
  lane.completedAt = Number(msg.completedAt || Date.now()) || Date.now();
  lane.result = String(msg.result || lane.result || lane.message?.content || '').trim();
  lane.error = String(msg.error || lane.error || '').trim();
  if (msg.fileChanges) {
    lane.fileChanges = msg.fileChanges;
    lane.message.fileChanges = msg.fileChanges;
  }
  lane.message.streaming = false;
  lane.message._done = true;
  lane.message.workEndedAt = Date.now();
  lane.message.workDurationMs = Math.max(0, lane.message.workEndedAt - Number(lane.message.workStartedAt || lane.message.createdAt || lane.message.workEndedAt));
  if (failed) {
    _appendMobileProcess(lane.message, 'error', `${lane.agentName || 'Agent'} failed${msg.error ? `: ${String(msg.error).slice(0, 260)}` : ''}`, { actor: lane.agentName || 'Background Agent', ...msg });
  } else {
    const result = String(lane.result || '').trim();
    _appendMobileProcess(lane.message, 'final', `${lane.agentName || 'Agent'} complete${result ? `: ${result.slice(0, 260)}` : ''}`, { actor: lane.agentName || 'Background Agent', ...msg });
    if (result && !String(lane.message.content || '').trim()) {
      lane.message.content = result;
      lane.message.body = { ...(lane.message.body || {}), text: result };
    }
  }
  lane.updatedAt = Date.now();
  persistBackgroundAgentWork(_mobileBackgroundSpawnWorkRecord(lane));
  if (mobileSourceState.sessionId === lane.sessionId && !mobileSourceState.history) _renderMobileSourceList(document);
  return true;
}

function _reconcileMobileBackgroundSpawnDockMarkup(host, markup) {
  if (!host) return;
  reconcileKeyedTimelineRows(host, markup, {
    scroller: host,
    setContents: (current, next) => {
      const detailsState = _captureMobileTraceDetailsState(current);
      current.innerHTML = next.innerHTML;
      _restoreMobileTraceDetailsState(current, detailsState);
    },
  });
}

function _renderMobileBackgroundSpawnDock(dock, sessionId = __pmChat.activeSessionId) {
  const host = dock || document.getElementById('pm-background-spawn-dock');
  if (!host) return;
  const previousScroll = {};
  host.querySelectorAll('.pm-background-spawn-lane[data-bg-id]').forEach((node) => {
    const id = String(node.getAttribute('data-bg-id') || '');
    const panel = node.querySelector('.pm-background-spawn-panel');
    const processFull = node.querySelector('.pm-process-full');
    if (!id) return;
    previousScroll[id] = {
      panelTop: Number(panel?.scrollTop || 0),
      panelNearBottom: panel ? ((panel.scrollHeight - panel.scrollTop - panel.clientHeight) < 6) : false,
      processTop: Number(processFull?.scrollTop || 0),
      processNearBottom: processFull ? ((processFull.scrollHeight - processFull.scrollTop - processFull.clientHeight) < 6) : false,
    };
  });
  const activeSession = String(sessionId || '').trim();
  const lanes = Object.values(_mobileBackgroundSpawnLanes())
    .filter((lane) => lane && (!lane.sessionId || lane.sessionId === activeSession))
    .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
  host.hidden = lanes.length === 0;
  host.classList.toggle('has-many', lanes.length > 2);
  if (!lanes.length) {
    host.innerHTML = '';
    host.classList.remove('is-open', 'is-collapsed');
    host.closest?.('.pm-page')?.classList.remove('pm-bg-agents-open');
    _syncMobileRuntimePillPair(host);
    return;
  }
  const preferenceState = __pmChat.backgroundSpawnDockOpen && typeof __pmChat.backgroundSpawnDockOpen === 'object'
    ? __pmChat.backgroundSpawnDockOpen
    : {};
  const hasPreference = Object.prototype.hasOwnProperty.call(preferenceState, activeSession);
  const dockOpen = hasPreference ? _mobileBackgroundSpawnDockOpen(activeSession) : lanes.length <= 2;
  host.classList.toggle('is-open', dockOpen);
  host.classList.toggle('is-collapsed', !dockOpen);
  host.closest?.('.pm-page')?.classList.toggle('pm-bg-agents-open', dockOpen);
  if (!dockOpen) {
    _reconcileMobileBackgroundSpawnDockMarkup(host, `
      <button type="button" class="pm-background-spawn-pill" data-pm-bg-open aria-label="Open ${lanes.length} background agents">
        <span class="pm-background-spawn-pill-dot" aria-hidden="true"></span>
        <strong>${lanes.length} ${lanes.length === 1 ? 'Agent' : 'Agents'}</strong>
        <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
      </button>
    `);
    const openButton = host.querySelector('[data-pm-bg-open]');
    if (openButton) openButton.onclick = () => {
      try { pmHaptic(16); } catch {}
      const planState = _mobileMainPlanState(activeSession);
      if (planState.open) {
        planState.open = false;
        _renderMobileMainPlanDock(document.getElementById('pm-main-plan-dock'), activeSession);
      }
      _setMobileBackgroundSpawnDockOpen(activeSession, true);
      _renderMobileBackgroundSpawnDock(host, sessionId);
      try { window.__pmMobileBackgroundSpawnDockChanged?.(); } catch {}
    };
    _syncMobileRuntimePillPair(host);
    return;
  }
  _reconcileMobileBackgroundSpawnDockMarkup(host, `
    <button type="button" class="pm-background-spawn-close" data-pm-bg-close aria-label="Collapse background agents">&times;<input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" /></button>
    ${lanes.map((lane) => {
    const entries = Array.isArray(lane.message?.processEntries) ? lane.message.processEntries : [];
    const latest = entries[entries.length - 1];
    const status = String(lane.status || 'running').toLowerCase();
    const pendingApproval = lane.approvalRequest && String(lane.approvalRequest.status || 'pending').toLowerCase() === 'pending';
    const finalText = status === 'completed' ? String(lane.result || lane.message?.content || '').trim() : '';
    const errorText = status === 'failed' ? String(lane.error || lane.message?.content || '').trim() : '';
    const latestText = String(
      pendingApproval
        ? `Approval needed: ${_pmApprovalTitle(lane.approvalRequest)}`
        : (finalText || errorText || latest?.text || latest?.content || lane.task || 'Working in parallel...')
    ).trim();
    const processHtml = entries.length
      ? _renderMobileProcess(entries).replace('<details class="pm-process-stream"', `<details class="pm-process-stream"${lane.expanded ? ' open' : ''}`)
      : '<div class="pm-background-spawn-empty">Waiting for live events...</div>';
    const planHtml = _renderMobileBackgroundSpawnPlan(lane);
    const panelHtml = _renderMobileBackgroundSpawnPanel(lane, planHtml, processHtml);
    const statusLabel = status === 'approval_required' ? 'approval' : (status === 'in_progress' ? 'running' : status);
    return `
      <section class="pm-background-spawn-lane ${escapeHtml(status)}" data-bg-id="${escapeHtml(lane.id)}" data-pm-row-key="background:${escapeHtml(lane.id)}">
        <button type="button" class="pm-background-spawn-summary" data-pm-bg-open-detail="${escapeHtml(lane.id)}" aria-label="Open ${escapeHtml(lane.agentName || 'background agent')} background work">
          <span class="pm-background-spawn-avatar" style="--background-agent-color:${escapeHtml(lane.agentColor || '#1677d2')}">${escapeHtml(String(lane.agentName || 'Agent').slice(0, 2).toUpperCase())}</span>
          <span class="pm-background-spawn-main">
            <strong style="color:${escapeHtml(lane.agentColor || '#1677d2')}">${escapeHtml(lane.agentName || 'Agent')}</strong>
            <em>${escapeHtml(latestText)}</em>
          </span>
          <span class="pm-background-spawn-status">${escapeHtml(statusLabel)}</span>
          <span class="pm-background-spawn-chevron">›</span>
          <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
        </button>
        <div class="pm-background-spawn-panel">${panelHtml}</div>
      </section>
    `;
    }).join('')}
  `);
  const closeButton = host.querySelector('[data-pm-bg-close]');
  if (closeButton) closeButton.onclick = () => {
    try { pmHaptic(16); } catch {}
    _setMobileBackgroundSpawnDockOpen(activeSession, false);
    _renderMobileBackgroundSpawnDock(host, sessionId);
    try { window.__pmMobileBackgroundSpawnDockChanged?.(); } catch {}
  };
  host.querySelectorAll('[data-pm-bg-open-detail]').forEach((btn) => {
    btn.onclick = () => {
      try { pmHaptic(12); } catch {}
      window.__pmMobileBackgroundAgentDetail?.(btn.getAttribute('data-pm-bg-open-detail') || '');
    };
  });
  host.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach((btn) => {
    _wireMobileApprovalActionButton(btn);
  });
  _wireMobileProcessRunActions(host);
  host.querySelectorAll('.pm-background-spawn-lane[data-bg-id]').forEach((node) => {
    const id = String(node.getAttribute('data-bg-id') || '');
    const saved = previousScroll[id];
    if (!saved) return;
    const panel = node.querySelector('.pm-background-spawn-panel');
    const processFull = node.querySelector('.pm-process-full');
    if (panel) panel.scrollTop = saved.panelNearBottom ? panel.scrollHeight : saved.panelTop;
    if (processFull) processFull.scrollTop = saved.processNearBottom ? processFull.scrollHeight : saved.processTop;
  });
  _syncMobileRuntimePillPair(host);
}
  // Stream event reduction stays with the Chat renderer's optional UI owner.
function _applyMobileAgentStreamEvent(message, evt, fallbackName = 'Agent') {
  if (!message || !evt) return false;
  _maybeFlushMobileThinkingBeforeEvent(message, evt);
  const applyCompletedTurnPresentation = () => {
    if (Array.isArray(evt.artifacts)) message.artifacts = evt.artifacts;
    if (Array.isArray(evt.generatedImages)) message.generatedImages = evt.generatedImages;
    if (Array.isArray(evt.generatedVideos)) message.generatedVideos = evt.generatedVideos;
    if (Array.isArray(evt.canvasFiles)) message.canvasFiles = evt.canvasFiles;
    if (evt.fileChanges) message.fileChanges = evt.fileChanges;
    if (evt.productCarousel) message.productCarousel = evt.productCarousel;
    _mergeMobileRichArtifacts(message, evt.richArtifacts);
    if (evt.goalCompletionReport) message.goalCompletionReport = evt.goalCompletionReport;
  };
  const type = String(evt.type || '').trim();
  switch (type) {
    case 'final_response_start':
      beginFinalResponse(message);
      return true;
    case 'token': {
      const chunk = String(evt.text || '');
      if (!chunk) return false;
      beginFinalResponse(message);
      const previous = String(message.body?.text || message.content || message.text || '');
      message.content = appendFinalResponseDelta(previous, chunk);
      message.text = message.content;
      message.body = { ...(message.body || {}), text: message.content };
      message._progress = '';
      return true;
    }
    case 'thinking_delta': {
      const chunk = String(evt.thinking || evt.text || '');
      if (!chunk) return false;
      _handleMobileThinkingDelta(message, evt);
      message._thinking = `${message._thinking || ''}${chunk}`;
      message._progress = `${fallbackName} is thinking...`;
      return true;
    }
    case 'reasoning_summary_delta': {
      return _handleMobileReasoningSummaryDelta(message, evt);
    }
    case 'reasoning_delta':
    case 'reasoning_summary': {
      const chunk = String(evt.text || evt.summary || evt.thinking || '');
      if (!chunk) return false;
      return _handleMobileReasoningSummaryDelta(message, { ...evt, text: chunk });
    }
    case 'thinking':
    case 'agent_thought': {
      const thought = String(evt.thinking || evt.text || '').trim();
      if (!thought) return false;
      _handleMobileCleanThought(message, evt);
      message._progress = `${fallbackName} is thinking...`;
      return true;
    }
    case 'info':
    case 'heartbeat': {
      const info = String(evt.message || evt.current_step || evt.state || '').trim();
      if (!info || /^processing$/i.test(info)) return false;
      message._progress = info.slice(0, 140);
      _pushMobileStreamProcessEntry(message, 'info', info, evt);
      return true;
    }
    case 'model_stream_event': {
      const modelEvent = evt.event && typeof evt.event === 'object' ? evt.event : {};
      const modelType = String(modelEvent.type || '').trim();
      if (!modelType) return false;
      if (modelType === 'tool_call_start' || modelType === 'tool_call_done') {
        _moveMobileAgentVisibleAnswerIntoWorkflowTrace(message);
        message.toolActivityStarted = true;
        _applyMobileToolActivity(message, modelType === 'tool_call_start' ? 'prepare' : 'prepared', {
          ...modelEvent,
          action: modelEvent.name,
          streamId: evt.streamId || modelEvent.streamId,
          seq: evt.seq || modelEvent.seq,
        });
        return true;
      }
      // Argument deltas are intentionally not rendered as individual rows;
      // the normalized tool_call frame carries the complete call.
      return modelType === 'tool_call_delta';
    }
    case 'progress_state': {
      const items = Array.isArray(evt.items) ? evt.items : [];
      const activeIndex = Number(evt.activeIndex || -1);
      const activeText = String(activeIndex >= 0 ? items[activeIndex]?.text || '' : '').trim();
      if (!activeText) return false;
      message._progress = activeText.slice(0, 140);
      return true;
    }
    case 'resources_changed': {
      _refreshMobileSourcesForSession(evt.sessionId || evt.sourceSessionId || '');
      return false;
    }
    case 'coding_context_packet': {
      const status = String(evt.status || 'omitted');
      const reason = String(evt.reason || 'unknown');
      const age = Number.isFinite(Number(evt.ageMs)) ? `, age ${Math.round(Number(evt.ageMs) / 1000)}s` : '';
      message.codingContextPacketDecision = { ...evt, receivedAt: Date.now() };
      if (status !== 'omitted' || evt.taskId) {
        _pushMobileStreamProcessEntry(message, 'info', `Code context: ${status} (${reason}${age})`, evt);
        return true;
      }
      return false;
    }
    case 'tool_call': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      if (action === 'context_compaction') {
        _appendMobileCompactionTrace(message, 'compacting', '', evt.args || evt);
        message._progress = 'Compacting Context';
        return true;
      }
      const stepNum = Number(evt.stepNum || 0);
      const stepPrefix = stepNum ? `Step ${stepNum}: ` : '';
      const args = evt.args && typeof evt.args === 'object' ? JSON.stringify(evt.args).slice(0, 180) : '';
      message.toolActivityStarted = true;
      message._progress = `Running ${action}...`;
      _pushMobileStreamProcessEntry(message, 'tool', `${stepPrefix}${action}${args ? ` ${args}` : ''}`, evt, false);
      _applyMobileToolActivity(message, 'call', evt);
      return true;
    }
    case 'tool_result': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      const text = String(evt.result || evt.output || '').trim();
      const ok = evt.ok !== false && evt.success !== false && !evt.error;
      if (action === 'context_compaction') {
        const status = String(evt?.extra?.status || '').toLowerCase() || (ok ? 'compacted' : 'failed');
        _appendMobileCompactionTrace(message, status, evt?.extra?.summary || '', evt.extra || evt);
        message._progress = '';
        return true;
      }
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      _mergeMobileRichArtifacts(message, evt.richArtifacts);
      message.toolActivityStarted = true;
      message._progress = ok ? '' : `${action} failed`;
      _pushMobileStreamProcessEntry(message, ok ? 'result' : 'error', `${action}${text ? ` -> ${text}` : ' complete'}`, { ...evt, error: !ok }, false);
      _applyMobileToolActivity(message, 'result', { ...evt, error: !ok });
      return true;
    }
    case 'vision_injected': {
      message.toolActivityStarted = true;
      _appendMobileVisionTrace(message, evt);
      return true;
    }
    case 'tool_progress': {
      const action = String(evt.action || evt.name || evt.toolName || 'tool').trim();
      const text = String(evt.message || '').trim();
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (!text) return true;
      _moveMobileAgentVisibleAnswerIntoWorkflowTrace(message);
      message.toolActivityStarted = true;
      message._progress = `${action}: ${text}`.slice(0, 140);
      _pushMobileStreamProcessEntry(message, 'info', `${action}: ${text}`, { ...evt, event: 'tool_progress' }, false);
      _applyMobileToolActivity(message, 'progress', evt);
      return true;
    }
    case 'approval_created': {
      const approval = _normalizeMobileApproval(evt.approval || evt);
      if (!approval?.id) return false;
      message.approvalRequest = approval;
      return true;
    }
    case 'approval_approved':
    case 'approval_denied':
    case 'approval_expired':
    case 'approval_failed': {
      const status = type === 'approval_approved' ? 'approved'
        : type === 'approval_denied' ? 'rejected'
          : type === 'approval_expired' ? 'expired'
            : 'failed';
      const id = String(evt.approvalId || evt.id || evt.approval?.id || message?.approvalRequest?.id || '').trim();
      if (!message.approvalRequest || (id && String(message.approvalRequest.id || '') !== id)) return false;
      message.approvalRequest = _normalizeMobileApproval({ ...message.approvalRequest, ...(evt.approval || evt), status });
      return true;
    }
    case 'final': {
      const text = String(evt.text || evt.reply || '');
      applyCompletedTurnPresentation();
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      _mergeMobileRichArtifacts(message, evt.richArtifacts);
      beginFinalResponse(message);
      message.content = reconcileFinalResponse(message.content || message.text || message.body?.text || '', text);
      message.text = message.content;
      message.body = { ...(message.body || {}), text: message.content };
      message._progress = '';
      return true;
    }
    case 'done': {
      const text = String(evt.reply || evt.text || '');
      applyCompletedTurnPresentation();
      try { _collectMediaFromToolEvent(message, evt); } catch {}
      if (evt.fileChanges) message.fileChanges = evt.fileChanges;
      if (evt.productCarousel) _mergeMobileProductCarouselIntoMessage(message, evt.productCarousel);
      _mergeMobileRichArtifacts(message, evt.richArtifacts);
      beginFinalResponse(message);
      message.content = reconcileFinalResponse(message.content || message.text || message.body?.text || '', text);
      message.text = message.content;
      message.body = { ...(message.body || {}), text: message.content };
      if (String(evt.thinking || '').trim()) {
        message._thinking = message._thinking ? `${message._thinking}\n\n${String(evt.thinking).trim()}` : String(evt.thinking).trim();
      }
      message._progress = '';
      message._done = true;
      message.streaming = false;
      message.workEndedAt = Number(message.workEndedAt || Date.now()) || Date.now();
      message.workDurationMs = Math.max(0, message.workEndedAt - Number(message.workStartedAt || message.createdAt || message.timestamp || message.workEndedAt));
      return true;
    }
    case 'error': {
      const err = String(evt.message || 'Stream error').trim();
      message.content = message.content || `Error: ${err}`;
      message.text = message.content;
      message.body = { ...(message.body || {}), text: message.content };
      message._progress = '';
      message.streaming = false;
      message.workEndedAt = Number(message.workEndedAt || Date.now()) || Date.now();
      _pushMobileStreamProcessEntry(message, 'error', err, evt);
      return true;
    }
    default:
      return false;
  }
}
  // Small process-trace helpers share the deferred Chat renderer boundary.
function _pushMobileStreamProcessEntry(message, type, text, extra = null, includeLiveTrace = true) {
  const clean = String(text || '').trim();
  if (!message || !clean) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const streamId = String(extra?.streamId || '').trim();
  const seq = Math.max(0, Math.floor(Number(extra?.seq || 0)) || 0);
  const key = streamId && seq ? `stream:${streamId}:${seq}` : `${type}:${clean}`.slice(0, 260);
  if (message.processEntries.some((entry) => String(entry?._key || '') === key)) return;
  message.processEntries.push({
    _key: key,
    ...(streamId ? { streamId } : {}),
    ...(seq ? { seq } : {}),
    type,
    text: clean.length > 420 ? `${clean.slice(0, 420)}...` : clean,
    extra,
    time: _nowTime(),
  });
  if (message.processEntries.length > 80) {
    message.processEntries.splice(0, message.processEntries.length - 80);
  }
  const traceType = String(type || 'info').toLowerCase();
  if (includeLiveTrace && traceType !== 'final' && traceType !== 'user') {
    _appendMobileLiveTrace(message, traceType, clean, { extra });
  }
}

function _moveMobileAgentVisibleAnswerIntoWorkflowTrace(message) {
  if (!message) return;
  const text = String(message.content || message.text || message.body?.text || '').trim();
  if (!text) return;
  if (_isMobileProgressNarration(text)) {
    _setMobileLiveProgressNarration(message, text);
  } else {
    _appendMobileLiveTrace(message, message.toolActivityStarted ? 'think' : 'preamble', text, {
      extra: { visibility: 'user', source: 'reasoning_summary' },
    });
  }
  message.content = '';
  message.text = '';
  message.body = { ...(message.body || {}), text: '' };
  message.finalResponseStarted = false;
}
  // Background file-change reconciliation remains with the deferred Chat renderer.
function _clearMobileBackgroundSpawnDockForSession(sessionId = __pmChat.activeSessionId) {
  const sid = String(sessionId || '').trim();
  const lanes = _mobileBackgroundSpawnLanes();
  const cleared = _mobileBackgroundSpawnClearedIds();
  Object.keys(lanes).forEach((id) => {
    const lane = lanes[id];
    if (!sid || !lane?.sessionId || lane.sessionId === sid) {
      cleared[id] = true;
      delete lanes[id];
    }
  });
  _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid);
  try { window.__pmMobileBackgroundSpawnDockChanged?.(); } catch {}
}

function _collectMobileBackgroundFileChangeGroups(sessionId = __pmChat.activeSessionId) {
  const sid = String(sessionId || '').trim();
  return Object.values(_mobileBackgroundSpawnLanes())
    .filter((lane) => lane && (lane.fileChanges || lane.message?.fileChanges) && (!sid || !lane.sessionId || lane.sessionId === sid))
    .map((lane) => ({
      id: `bg_${lane.id}`,
      source: `background:${lane.id}`,
      label: lane.agentName ? `${lane.agentName} edits` : 'Background agent edits',
      fileChanges: lane.fileChanges || lane.message?.fileChanges,
    }));
}

function _mergeMobileFileChangesWithBackground(mainFileChanges, sessionId = __pmChat.activeSessionId) {
  const existingGroups = Array.isArray(mainFileChanges?.groups) ? mainFileChanges.groups : [];
  const groups = existingGroups.length ? existingGroups.slice() : [];
  if (!existingGroups.length && _normalizeMobileFileChanges(mainFileChanges)) {
    groups.push({ id: 'main', source: 'main', label: 'Main agent edits', fileChanges: mainFileChanges });
  }
  const seen = new Set(groups.map((group) => String(group?.source || group?.id || '')));
  for (const group of _collectMobileBackgroundFileChangeGroups(sessionId)) {
    const key = String(group.source || group.id || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    groups.push(group);
  }
  if (!groups.length) return mainFileChanges || null;
  if (groups.length === 1 && groups[0]?.source === 'main' && !Array.isArray(mainFileChanges?.groups)) return mainFileChanges;
  return { groups };
}

function _mergeMobileLatestAssistantBackgroundFileChanges(sessionId = __pmChat.activeSessionId) {
  const thread = __pmChat.threads?.[sessionId] || [];
  const latest = [...thread].reverse().find((turn) => _isMobileAssistantMessage(turn));
  if (!latest) return false;
  const merged = _mergeMobileFileChangesWithBackground(latest.fileChanges || null, sessionId);
  if (!merged || merged === latest.fileChanges) return false;
  latest.fileChanges = merged;
  return true;
}

  const runtime = Object.freeze({
    createMobileStreamReceiptLedger,
    _findMobileCompletedTurn,
    _ackMobileAbort,
    _mobileWorkflowTransitionLabel,
    _renderMobileQuestionCard,
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
    _clearMobileBackgroundSpawnDockForSession,
    _collectMobileBackgroundFileChangeGroups,
    _mergeMobileFileChangesWithBackground,
    _mergeMobileLatestAssistantBackgroundFileChanges,
    _applyMobileAgentStreamEvent,
    _pushMobileStreamProcessEntry,
    _moveMobileAgentVisibleAnswerIntoWorkflowTrace,
    _mobileAgentMessageAttachments,
    _mobileAgentMessageFiles,
    _mobileAgentMessageFileChanges,
    _mobileAgentTurnPresentation,
    _voiceMessageMeta,
    _normalizeCollapsedAgentMarkdown,
    _renderMobileAgentChatBubble,
    _mobileMainPlanState,
    _applyMobileMainPlanProgress,
    _setMobileToolProgress,
    _clearMobileToolProgress,
    _renderMobileToolProgressDock,
    _syncMobileRuntimePillPair,
    _renderMobileMainPlanDock,
    _mobileBackgroundSpawnLanes,
    _mobileBackgroundSpawnDockOpen,
    _setMobileBackgroundSpawnDockOpen,
    _mobileBackgroundSpawnClearedIds,
    _mobileBackgroundSpawnId,
    compactFileChanges: _compactMobileThreadCacheFileChanges,
    backgroundDetailRecord: _mobileBackgroundAgentDetailRecord,
    hydrateBackgroundLane: _hydrateMobileBackgroundSpawnLane,
    _mobileBackgroundSpawnPromptFromMessage,
    _mobileParseBackgroundStatus,
    _collectMobileBackgroundSpawnRecoveries,
    _linkMobilePendingApprovalsToBackgroundLanes,
    _applyMobileBackgroundSpawnStatus,
    _recoverMobileBackgroundSpawnDock,
    _mobileBackgroundSpawnMatchesSession,
    _upsertMobileBackgroundSpawnLane,
    _mobileBackgroundSpawnWorkRecord,
    _normalizeMobileBackgroundSpawnEvent,
    _extractMobileBackgroundPlanSteps,
    _updateMobileBackgroundSpawnPlan,
    _renderMobileBackgroundSpawnPlan,
    _renderMobileBackgroundSpawnPrompt,
    _renderMobileBackgroundSpawnFinal,
    _renderMobileBackgroundSpawnPanel,
    _pushMobileBackgroundSpawnEvent,
    _completeMobileBackgroundSpawnLane,
    _reconcileMobileBackgroundSpawnDockMarkup,
    _renderMobileBackgroundSpawnDock,
  });
  try {
    if (context?.window) context.window.__pmMobileChatRendererRuntime = runtime;
  } catch {}
  return runtime;
}
