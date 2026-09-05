// Chat and inline Voice route owner.
import {
  ICONS, icon, escapeHtml, el, renderMobileHeader, wireHeaderActions, openDrawer, invalidateMobileDrawerSessions, refreshMobileDrawerSessions, isMobileChatPinned, toggleMobileChatPin,
} from './mobile-shell.js';
import { pmToast } from './mobile-feedback.js';
import {
  formatMobileChatTime as _formatChatTime,
  formatMobileTimeAgo as _formatTimeAgo,
} from './mobile-format.js';
import {
  applyMobileDraftModelRouteToSession,
  attachMobileButtonHaptic,
  attachMobileHapticGestureSurface,
  pmHaptic,
  resetMobileDraftModelRoute,
  setMobileSubagentReasoningContext,
} from './mobile-model-badge.js';
import { renderMobileContextChip, wireMobileContextWindow } from './mobile-context-window.js';
import { formatModelWithReasoning } from '../model-display.js';
import {
  SOURCE_PANEL_SURFACE,
  sourcePanelResourceBelongsToContext,
  subagentChatSessionId,
} from '../source-panel-context.js';
import {
  backgroundAgentAgeLabel,
  backgroundAgentPreview,
  backgroundAgentWorkForSession,
  findBackgroundAgentWork,
  persistBackgroundAgentWork,
  resolveBackgroundAgentIdentity,
} from '../background-agent-work.js';

import {
  loadMobileSchedules, toggleSchedule, runScheduleNow, updateMobileSchedule, deleteMobileSchedule,
  getCachedMobilePageData,
  loadMobileTeams, loadMobileTeamDetail,
  startTeamRun, pauseTeam, resumeTeam, triggerTeamReview, deleteTeam,
  saveTeamContextReference, invalidateTeamsCache,
  streamChat, MOBILE_CHAT_SESSION_ID, createMobileChatSessionId, createMobileChatSession, createMobileProject, createMobileProjectChatSession,
  resolveMobileVoiceRoom, appendMobileVoiceRoomTranscript,
  loadGatewayStatus, loadMobileChatSession, loadMobileChatHistoryPage, invalidateMobileChatSessionCache, loadMobileChatRunStatus, loadMobileChatRunStatuses, loadMobileChatStreamReplay, reconcileMobileChatTurn,
  loadMobileBackgroundStatuses, loadMobileBackgroundStatus, loadMobileBackgroundStreamReplay, sendMobileBackgroundSteer,
  updateMobileChatSessionHistory, markMobileEditRerunReset, markMobileChatSessionRead,
  loadTeamRuns, loadTeamChat, postTeamChat, loadTeamRoomState, streamTeamChat, loadTeamChatStreamReplay,
  createVoiceInterruptionEvent, streamVoiceAgentInputMobile,
  getDeviceToken, setDeviceToken, clearDeviceToken,
  mobileGatewayFetch, mobileGatewayTextFetch, buildMobileGatewayWsUrl,
  loadMobileChatResources, loadMobileBrowserHistory, saveMobileCurrentBrowserPage, attachMobileResource, detachMobileResource,
  loadTeamWorkspace, loadTeamWorkspaceFile, loadMemoryGraph,
  loadBgTasks, loadBgTaskDetail, loadBgTaskEvidence, sendBgTaskMessage, runBgTaskAction, loadVoiceStatus,
  transcribeVoiceAudio,
  loadMobileMoreSummary, loadMobileHubOverview, loadMobileHubGoals, loadMobileAuditRuns, loadMobileMemoryOverview,
  loadMobileProposals, loadMobileProposal, approveMobileProposal, denyMobileProposal,
  loadMobileApprovals, approveMobileApproval, denyMobileApproval, loadMobileQuestions,
  loadMobileProcessRuns, loadMobileProcessRunLog, rerunMobileProcessRun, killMobileProcessRun, submitMobileProcessInput,
  uploadMobileTextFile, uploadMobileBinaryFile,
  loadMobileCommandModels, loadMobileStopTargets, stopMobileMainChat, stopMobileRuntime,
  runMobileScreenshotCommand, restartMobileGateway, requestMobileUpdate,
  loadMobileWorkspaceFiles, loadMobileFileScreenshot,
  loadCanvasImageDataUrl, creativeExtractLayers, loadCreativeGallery, buildInlineMediaUrl, buildMobileVisionPreviewUrl, buildDownloadMediaUrl, buildWorkspaceCanvasUrl,
  loadMobileSubagents, loadMobileSubagentDetail, loadSubagentSystemPrompt, loadSubagentMemory, loadSubagentHeartbeat,
  tickSubagentHeartbeat, loadSubagentRuns, loadSubagentRunDetail, sendSubagentRunRecovery, loadSubagentChat, loadSubagentContextRefs,
  spawnSubagentTask, streamSubagentChat, loadSubagentChatStreamReplay,
 getMobilePushStatus, enableMobileChatPushNotifications, disableMobileChatPushNotifications, reconcileMobileChatPushNotifications,
 } from './mobile-api.js';
import {
  getGateway,
  loadGatewayCatalog,
  MOBILE_GATEWAY_STATUS,
  probeGateway,
  gatewayStatusLabel,
  getActiveGatewayId,
  getMobileSessionTarget,
  resolveMobileSessionGateway,
  setMobileActiveGatewayTarget,
  isCurrentGateway,
  setActiveGatewayId,
  bindMobileSessionTarget,
  parseTargetNamespacedId,
  targetNamespacedId,
  onGatewayCatalogChanged,
  getPairingPayload,
  setPendingGatewayPair,
} from './mobile-gateway-catalog.js';
import { getAccount } from '../auth/account.js';
import { renderMd, setInnerHTMLPreservingVisuals } from '../utils.js';
import { presentChatError, presentGoalAction } from '../chat-error-presentation.js';
import { wsEventBus, wsSend } from '../ws.js';
import { CHAT_COMPOSER_SUGGESTION_LIMIT, CHAT_SKILL_TRIGGER, getChatSlashCommands, mergeSlashCommandSkillIds } from '../chat-slash-commands.js';
import {
  appendCommandTerminalChunkToDom,
  applyCommandProcessEvent,
  applyToolActivityEvent,
  installToolActivityExpansionPersistence,
  loadToolActivityFeature,
  setToolActivityDisclosureState,
} from '../features/chat/optional/tool-activity-runtime.js';
import { appendFinalResponseDelta, beginFinalResponse, reconcileFinalResponse } from '../chat-final-response.js';
import { createMobileChatRuntimeAdapter } from '../features/chat/runtime/mobile-chat-adapter.js';
import { createMobileTimelineView } from '../features/chat/timeline/mobile-timeline-view.js';
import { captureKeyedScrollState, reconcileKeyedTimelineRows } from '../features/chat/timeline/keyed-dom.js';
import { chatProgressVisibility } from '../features/chat/trace-visibility.js';

const MOBILE_LIFECYCLE_MARKS = Object.freeze({
  navigation: 'mobile_navigation',
  shellPaint: 'mobile_shell_paint',
  gatewayReady: 'mobile_gateway_ready',
  chatChunkRequested: 'mobile_chat_chunk_requested',
  chatRuntimeHydrated: 'mobile_chat_runtime_hydrated',
  firstTranscriptPaint: 'mobile_first_transcript_paint',
  composerInteractive: 'mobile_composer_interactive',
});

function markMobileLifecycle(stage, details = {}) {
  const name = MOBILE_LIFECYCLE_MARKS[stage];
  if (!name) return 0;
  try { return window.__PROM_PERF_MARK?.(name, { surface: 'mobile', ...details }) || 0; } catch { return 0; }
}

installToolActivityExpansionPersistence();
import {
  renderAgentModelPicker as _renderAgentModelPicker,
  agentModelPickerHydrate,
  registerAgentModelPickerOnSaved,
} from '../components/agent-model-picker.js';
import {
  renderAgentVoicePicker as _renderAgentVoicePicker,
  agentVoicePickerHydrate,
  registerAgentVoicePickerOnSaved,
} from '../components/agent-voice-picker.js';
import {
  VOICE_PREVIEW_DRAG_START_PX,
  getVoicePreviewDragStyle,
  getVoicePreviewGestureOutcome,
} from './voice-preview-deck.mjs';
import { mountThinkingOrbWhenReady } from '../features/chat/optional/thinking-orb-runtime.js';
import { ensureMobileChatStyles } from './mobile-style-owners.js';

const PM_MOBILE_BROWSE_CACHE_TTL_MS = 45_000;
const pmMobileBrowseCache = new Map();

function _cleanMobileCompletionText(value, max = 180) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function _showMobileCompletionToast({ key, title, summary, route } = {}) {
  if (!document.body?.classList?.contains('pm-mobile-active')) return;
  const target = String(route || '').trim();
  const toastKey = String(key || `${title}:${summary}:${target}`).trim();
  if (!toastKey) return;
  let host = document.getElementById('pm-completion-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-completion-toast-host';
    document.body.appendChild(host);
  }
  const existing = host.querySelector(`[data-pm-completion-key="${_pmCssEscape(toastKey)}"]`);
  if (existing) {
    clearTimeout(Number(existing.dataset.pmCompletionTimer || 0));
    existing.dataset.pmCompletionTimer = String(setTimeout(() => existing.remove(), 8000));
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pm-completion-toast';
  button.dataset.pmCompletionKey = toastKey;
  const heading = _cleanMobileCompletionText(title, 90) || 'Prometheus update';
  const detail = _cleanMobileCompletionText(summary, 180) || 'Tap to open.';
  button.setAttribute('aria-label', `${heading}. ${detail}. Open chat.`);
  button.innerHTML = `
    <span class="pm-completion-toast-copy">
      <strong class="pm-completion-toast-title">${escapeHtml(heading)}</strong>
      <span class="pm-completion-toast-detail">${escapeHtml(detail)}</span>
    </span>
    <span class="pm-completion-toast-chevron" aria-hidden="true">›</span>
  `;
  const dismiss = () => {
    clearTimeout(Number(button.dataset.pmCompletionTimer || 0));
    button.remove();
  };
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerId = null;
  let swipedUp = false;
  button.addEventListener('click', (event) => {
    if (swipedUp) {
      swipedUp = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    dismiss();
    if (target) window.location.hash = target.startsWith('#') ? target : `#${target}`;
  });
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    swipedUp = false;
    try { button.setPointerCapture?.(event.pointerId); } catch {}
    try { pmHaptic(8); } catch {}
  });
  button.addEventListener('pointerup', (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    pointerId = null;
    try { button.releasePointerCapture?.(event.pointerId); } catch {}
    if (deltaY <= -36 && Math.abs(deltaY) > Math.abs(deltaX)) {
      swipedUp = true;
      event.preventDefault();
      clearTimeout(Number(button.dataset.pmCompletionTimer || 0));
      button.classList.add('is-dismissing-up');
      setTimeout(() => button.remove(), 180);
    }
  });
  button.addEventListener('pointercancel', (event) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    try { button.releasePointerCapture?.(event.pointerId); } catch {}
  });
  host.appendChild(button);
  button.dataset.pmCompletionTimer = String(setTimeout(dismiss, 8000));
}

function _mobileCompletionRoute(msg = {}) {
  const teamId = String(msg.teamId || msg.task?.teamId || '').trim();
  const agentId = String(msg.agentId || msg.task?.agentId || '').trim();
  const taskId = String(msg.taskId || msg.task?.id || '').trim();
  const sessionId = String(msg.sessionId || msg.spawnerSessionId || msg.originSessionId || '').trim();
  if (teamId) return `#mobile/teams/${encodeURIComponent(teamId)}`;
  if (agentId) return `#mobile/subagents/${encodeURIComponent(agentId)}`;
  if (taskId) return `#mobile/tasks/${encodeURIComponent(taskId)}`;
  return sessionId ? `#mobile/chat/${encodeURIComponent(sessionId)}` : '#mobile/chat';
}

if (!window.__pmMobileCompletionToastBridgeInstalled) {
  window.__pmMobileCompletionToastBridgeInstalled = true;
  wsEventBus.on('task_notification', (msg = {}) => {
    _showMobileCompletionToast({
      key: `task:${msg.taskId || ''}:${msg.status || 'complete'}:${msg.message || ''}`,
      title: String(msg.status || '').toLowerCase() === 'failed' ? 'Task failed' : 'Task complete',
      summary: msg.message || msg.taskTitle || 'A task finished.',
      route: _mobileCompletionRoute(msg),
    });
  });
  wsEventBus.on('bg_agent_done', (msg = {}) => {
    _showMobileCompletionToast({
      key: `background:${msg.bgId || ''}:${msg.state || 'completed'}`,
      title: String(msg.state || '').toLowerCase() === 'failed' ? 'Background agent failed' : 'Background agent finished',
      summary: msg.result || msg.error || msg.taskPrompt || msg.task || 'A background agent completed its work.',
      route: _mobileCompletionRoute(msg),
    });
  });
  wsEventBus.on('main_chat_stream_event', (msg = {}) => {
    if (String(msg.event || '') !== 'final') return;
    const sessionId = String(msg.sessionId || '').trim();
    const onSameOpenChat = sessionId && sessionId === String(__pmChat.activeSessionId || '').trim()
      && /^#mobile\/chat(?:\/|$)/.test(String(location.hash || ''));
    if (onSameOpenChat) return;
    _showMobileCompletionToast({
      key: `chat:${sessionId}:${msg.streamId || ''}`,
      title: 'Response ready',
      summary: msg.data?.text || msg.text || 'Prometheus finished responding.',
      route: _mobileCompletionRoute(msg),
    });
  });
  wsEventBus.on('delivery_notification', (msg = {}) => {
    _showMobileCompletionToast({
      key: `delivery:${msg.batchId || msg.attachmentPath || msg.text || ''}`,
      title: 'New delivery',
      summary: msg.text || msg.caption || msg.fileName || 'Prometheus sent an update.',
      route: _mobileCompletionRoute(msg),
    });
  });
  wsEventBus.on('session_notification', (msg = {}) => {
    if (!['schedule', 'hot_restart', 'dev_apply'].includes(String(msg.source || ''))) return;
    _showMobileCompletionToast({
      key: `session:${msg.notificationId || `${msg.source}:${msg.sessionId}`}`,
      title: msg.source === 'schedule' ? 'Scheduled work finished' : 'Prometheus update',
      summary: msg.message || msg.text || 'An automated update is ready.',
      route: _mobileCompletionRoute(msg),
    });
  });
}

function notifyMobileModelChanged(evt = {}, { sessionId = '' } = {}) {
  const type = String(evt?.type || '').trim();
  if (type !== 'model_switched' && type !== 'main_model_changed') return null;
  const rawModelRef = String(evt.modelRef || '').trim();
  const rawProvider = String(evt.provider || evt.providerId || '').trim();
  const rawModel = String(evt.model || '').trim();
  const slashIdx = rawModelRef.indexOf('/');
  const provider = rawProvider || (slashIdx > 0 ? rawModelRef.slice(0, slashIdx) : '');
  const model = rawModel || (slashIdx > 0 ? rawModelRef.slice(slashIdx + 1) : rawModelRef);
  const detail = {
    provider,
    providerId: provider,
    model,
    modelRef: rawModelRef || (provider && model ? `${provider}/${model}` : model),
    reason: String(evt.reason || '').trim(),
    tier: String(evt.tier || '').trim(),
    source: String(evt.source || '').trim(),
    reasoningEffort: String(evt.reasoningEffort || evt.reasoning_effort || '').trim(),
    sourceEventType: type,
    sessionId: String(sessionId || evt.sessionId || '').trim(),
    at: Date.now(),
  };
  try { window.__pmLastModelChange = detail; } catch {}
  try { window.dispatchEvent(new CustomEvent('pm-model-changed', { detail })); } catch {}
  try { console.info('[mobile model] live model change', detail); } catch {}
  return detail;
}

const PM_CHAT_VOICE_ICON_SRC = '/assets/icons8-sound-wave-50.apng.png';

function _mobileSubagentModelParts(agent = {}) {
  const raw = agent?.raw && typeof agent.raw === 'object' ? agent.raw : {};
  const modelRef = String(agent?.effectiveModel || agent?.model || raw.effectiveModel || raw.model || '').trim();
  const slash = modelRef.indexOf('/');
  const providerFromRef = slash > 0 ? modelRef.slice(0, slash).trim() : '';
  const modelFromRef = slash > 0 ? modelRef.slice(slash + 1).trim() : modelRef;
  const provider = String(
    raw.provider
    || raw.providerId
    || raw.modelProvider
    || providerFromRef
    || '',
  ).trim().toLowerCase();
  const model = String(raw.modelId || modelFromRef || '').trim();
  const effort = String(
    raw.reasoningEffort
    || raw.reasoning_effort
    || raw.effort
    || '',
  ).trim();
  const accountId = String(
    raw.accountId
    || raw.account_id
    || raw.defaultAccountId
    || '',
  ).trim();
  return { provider, model, effort, accountId, modelRef };
}

function _mobileSubagentHeaderLabel(agent = {}) {
  const name = String(agent?.name || agent?.id || 'Subagent').trim() || 'Subagent';
  const parts = _mobileSubagentModelParts(agent);
  const modelLabel = parts.model
    ? formatModelWithReasoning(parts.model, parts.provider, parts.effort)
    : 'Default model';
  return `${name}/${modelLabel}`;
}


function _notifyMobileChatVoiceUpdate(sessionId, detail = {}) {
  const sid = String(sessionId || '').trim();
  try {
    window.__pmMobileChatVoiceUpdate?.(sid, detail);
  } catch (err) {
    console.warn('[mobile voice] chat update bridge failed:', err);
  }
  try {
    window.dispatchEvent(new CustomEvent('pm-mobile-chat-voice-update', {
      detail: { ...(detail || {}), sessionId: sid },
    }));
  } catch {}
}

function _notifyMobileVoiceAgentConnection(stage, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('pm-mobile-voice-agent-connection', {
      detail: { stage: String(stage || '').trim(), ...(detail || {}) },
    }));
  } catch {}
}

function _markMobileRealtimeAgentBackendReady(conn, detail = {}) {
  if (!conn) return false;
  conn.backendReady = true;
  conn.backendReadyAt = Number(conn.backendReadyAt || 0) || Date.now();
  if (__pmRealtimeAgent?.conn !== conn) return false;
  // The camera can be opened before WebRTC/AVAS finishes booting. Once the
  // data channel is ready, attach the live vision loop immediately instead of
  // waiting for the first spoken turn to notice the camera reader.
  if (
    conn.dc?.readyState === 'open'
    && __pmRealtimeAgent.cameraRuntime?.open === true
    && typeof __pmRealtimeAgent.liveCameraFrameReader === 'function'
  ) {
    _startMobileRealtimeLiveCameraVision('realtime_backend_ready');
  }
  const ptt = __pmRealtimeAgent.ptt || {};
  const shouldEnableMic = __pmVoice?.listening === true
    && (String(conn.listenMode || '') === 'always_listening'
      || (ptt.held === true && String(ptt.sessionId || '') === String(conn.sessionId || '')));
  if (shouldEnableMic) _setMobileRealtimeAgentMicEnabled(true);
  if (conn.backendReadyNotified === true) return false;
  conn.backendReadyNotified = true;
  _voiceDebug?.('realtime-agent-backend-ready', {
    sessionId: String(conn.sessionId || ''),
    provider: String(conn.provider || ''),
    transport: String(conn.transport || ''),
    ...detail,
  });
  _notifyMobileVoiceAgentConnection('connected', {
    sessionId: String(conn.sessionId || ''),
    ...detail,
  });
  return true;
}

/* ---------------- CHAT ---------------- */

async function _refreshMobileChatPushButton() {
  const btn = document.getElementById('pm-chat-push-btn');
  try {
    const status = await getMobilePushStatus();
    const on = status.browserSupported && status.permission === 'granted' && status.subscribed && status.registered !== false && !status.lastError;
    if (btn) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('title', on ? 'Notifications on' : 'Enable notifications');
      btn.setAttribute('aria-label', on ? 'Disable notifications' : 'Enable notifications');
      btn.style.color = on ? 'var(--pm-orange)' : '';
      btn.dataset.pushState = on ? 'on' : (status.lastError ? 'error' : status.permission || 'off');
      btn.title = status.lastError
        ? `Notifications need repair: ${status.lastError}`
        : (on ? 'Notifications on' : 'Enable notifications');
    }
    const menuItem = document.getElementById('pm-chat-settings-notifications');
    const menuStatus = document.getElementById('pm-chat-settings-notifications-status');
    if (menuItem) {
      menuItem.classList.toggle('is-enabled', on);
      menuItem.setAttribute('aria-pressed', on ? 'true' : 'false');
      menuItem.setAttribute('aria-label', on ? 'Notifications enabled' : 'Enable notifications');
      menuItem.dataset.pushState = on ? 'on' : (status.lastError ? 'error' : status.permission || 'off');
    }
    if (menuStatus) menuStatus.hidden = !on;
  } catch {
    if (btn) btn.dataset.pushState = 'unknown';
  }
}

async function _toggleMobileChatPushNotifications() {
  const btn = document.getElementById('pm-chat-push-btn');
  if (btn?.dataset.busy === '1') return;
  if (btn) btn.dataset.busy = '1';
  try {
    const browserSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!browserSupported) {
      pmToast('Push is only available from the installed iOS Home Screen app.', 'error');
      return;
    }
    if (Notification.permission !== 'granted') {
      await enableMobileChatPushNotifications();
      pmToast('Notifications on', 'success');
      return;
    }
    const status = await getMobilePushStatus();
    const needsRepair = status.registered === false || !!status.lastError;
    if (status.permission === 'granted' && status.subscribed && !needsRepair) {
      await disableMobileChatPushNotifications();
      pmToast('Notifications off', 'success');
    } else {
      await enableMobileChatPushNotifications();
      pmToast('Notifications on', 'success');
    }
  } catch (err) {
    pmToast(String(err?.message || err || 'Could not update notifications'), 'error');
  } finally {
    if (btn) btn.dataset.busy = '0';
    _refreshMobileChatPushButton().catch(() => {});
  }
}

// Persistent in-tab thread. Survives navigation between mobile pages.
const PM_MOBILE_ACTIVE_RUN_KEY = 'pm_mobile_active_chat_run';
const PM_MOBILE_ACTIVE_RUNS_KEY = 'pm_mobile_active_chat_runs';
const PM_MOBILE_LAST_CHAT_SESSION_KEY = 'pm_mobile_last_chat_session';
const PM_MOBILE_THREAD_CACHE_KEY = 'pm_mobile_thread_cache_v2';
const PM_MOBILE_THREAD_CACHE_LEGACY_KEY = 'pm_mobile_thread_cache_v1';
const PM_MOBILE_THREAD_CACHE_MAX = 80;
const PM_MOBILE_THREAD_CACHE_SESSION_MAX = 6;
const PM_MOBILE_THREAD_CACHE_ENTRY_CHAR_BUDGET = 280_000;
const PM_MOBILE_THREAD_CACHE_TOTAL_CHAR_BUDGET = 1_500_000;
const PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE = 20;
const PM_MOBILE_SIDE_CHAT_LINKS_KEY = 'prometheus_side_chat_links_v1';
const PM_MOBILE_GOAL_CACHE_KEY = 'pm_mobile_main_chat_goals_v1';
const PM_MOBILE_LAST_GOAL_SESSION_KEY = 'pm_mobile_last_goal_session';

function _readMobileGoalCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_MOBILE_GOAL_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function _writeMobileGoalCache(goals = __pmChat.mainChatGoals) {
  try {
    const safe = {};
    Object.entries(goals || {}).forEach(([sid, goal]) => {
      const key = String(sid || '').trim();
      if (key && goal && goal.status !== 'cleared') safe[key] = goal;
    });
    localStorage.setItem(PM_MOBILE_GOAL_CACHE_KEY, JSON.stringify(safe));
  } catch {}
}

function _readMobileLastGoalSession() {
  try {
    return String(localStorage.getItem(PM_MOBILE_LAST_GOAL_SESSION_KEY) || '').trim();
  } catch {
    return '';
  }
}

function _rememberMobileLastGoalSession(sessionId, goal) {
  const sid = String(sessionId || '').trim();
  try {
    if (sid && goal && goal.status !== 'cleared') {
      localStorage.setItem(PM_MOBILE_LAST_GOAL_SESSION_KEY, sid);
      return;
    }
    if (sid && _readMobileLastGoalSession() === sid) {
      localStorage.removeItem(PM_MOBILE_LAST_GOAL_SESSION_KEY);
    }
  } catch {}
}

const __pmChat = (window.__pmChat = window.__pmChat || {
  activeSessionId: MOBILE_CHAT_SESSION_ID,
  threads: { [MOBILE_CHAT_SESSION_ID]: [] },
  attachments: {},
  thread: [],  // legacy alias for the active thread
  busy: false,
  abort: null,
  activeRuns: {},
  drawerRunSessionIds: new Set(),
  statusTimer: null,
  recoverTimer: null,
  backgroundSpawnLanes: {},
  toolProgressBySession: {},
  pendingApprovals: {},
  sentClientRequestIds: {},
  queuedPrompts: {},
  mainChatGoals: _readMobileGoalCache(),
  goalDetailsOpen: {},
  goalTimer: null,
  editingMessageIndex: -1,
  historyPagination: {},
  resolvedQuestionIds: {},
  mobileRecoveryOwners: {},
  mobileRecoveryUncertainSince: {},
});

if (!__pmChat.mainChatGoals || typeof __pmChat.mainChatGoals !== 'object') __pmChat.mainChatGoals = {};
if (!__pmChat.historyPagination || typeof __pmChat.historyPagination !== 'object') __pmChat.historyPagination = {};
__pmChat.mainChatGoals = { ..._readMobileGoalCache(), ...__pmChat.mainChatGoals };
if (!__pmChat.goalDetailsOpen || typeof __pmChat.goalDetailsOpen !== 'object') __pmChat.goalDetailsOpen = {};
if (!__pmChat.toolProgressBySession || typeof __pmChat.toolProgressBySession !== 'object') __pmChat.toolProgressBySession = {};
if (!__pmChat.resolvedQuestionIds || typeof __pmChat.resolvedQuestionIds !== 'object') __pmChat.resolvedQuestionIds = {};
if (!__pmChat.mobileRecoveryOwners || typeof __pmChat.mobileRecoveryOwners !== 'object') __pmChat.mobileRecoveryOwners = {};
if (!__pmChat.mobileRecoveryUncertainSince || typeof __pmChat.mobileRecoveryUncertainSince !== 'object') __pmChat.mobileRecoveryUncertainSince = {};

let receipts = null;
const mobileChatSteerSnapshotWriteQueues = new Map();

const mobileChatRuntimeAdapter = createMobileChatRuntimeAdapter({
  defaultSessionId: MOBILE_CHAT_SESSION_ID,
  getState: () => __pmChat,
  getSessionTarget: getMobileSessionTarget,
  getActiveGatewayId,
  loadHistoryPage: loadMobileChatHistoryPage,
  mergeHistory: _mergeMobileSessionThreadWithLocal,
  mergeOlderHistory: _mergeMobileHistoryPageWithCurrent,
  normalizeSkillIds: _pmNormalizeSelectedSkillIds,
  normalizeSkillRefs: _pmNormalizeSelectedComposerSkillRefs,
});
const _makeMobileQueuedPrompt=mobileChatRuntimeAdapter.createQueuedPrompt;
const _markMobileSessionRunning = mobileChatRuntimeAdapter.setRunning;

let mobileNormalizeQuestionRecord = null;
let mobileQuestionController = null;
let mobileQuestionControllerPromise = null;

function _ensureMobileQuestionController() {
  if (mobileQuestionController) return Promise.resolve(mobileQuestionController);
  if (!mobileQuestionControllerPromise) {
    mobileQuestionControllerPromise = Promise.all([
      import('../features/chat/questions/question-controller.js'),
      import('../features/chat/questions/mobile-question-transport.js'),
    ]).then(([questionApi, transportApi]) => {
      mobileNormalizeQuestionRecord = questionApi.normalizeQuestionRecord;
      const mobileQuestionTransport = transportApi.createMobileQuestionTransport({
        request: (...args) => window.api(...args),
        getActiveSessionId: () => __pmChat.activeSessionId,
        setActiveSessionId: (sessionId) => { __pmChat.activeSessionId = String(sessionId || '').trim() || MOBILE_CHAT_SESSION_ID; },
        sendResume: (message, options = {}) => {
          if (typeof window.__pmMobileSendMessage !== 'function') return false;
          window.__pmMobileSendMessage(message, { fromQuestionResume: true, sessionId: options.sessionId });
          return true;
        },
        queueResume: (message, sessionId) => {
          const queue = _getMobileQueuedPrompts(sessionId);
          queue.push(_makeMobileQueuedPrompt(message));
          if (queue.length > PM_MOBILE_MAX_QUEUED_PROMPTS) queue.splice(0, queue.length - PM_MOBILE_MAX_QUEUED_PROMPTS);
          _renderMobileQueuedPromptsPanel(sessionId);
          pmToast('Answer queued a resume message', 'info');
          return true;
        },
      });
      mobileQuestionController = questionApi.createQuestionController({
        runtimeFor: mobileChatRuntimeAdapter.runtimeFor,
        getActiveSessionId: () => __pmChat.activeSessionId,
        getSessionIds: () => Object.keys(__pmChat.threads || {}),
        getLegacyQuestion: (id, preferredSessionId = '') => {
          const sessions = preferredSessionId
            ? [preferredSessionId]
            : Object.keys(__pmChat.threads || {});
          for (const sid of sessions) {
            const thread = __pmChat.threads?.[sid];
            const message = (Array.isArray(thread) ? thread : [])
              .find((item) => String(item?.questionRequest?.id || '') === String(id || ''));
            if (message?.questionRequest) return { sessionId: sid, record: message.questionRequest };
          }
          return null;
        },
        getLegacyQuestionSessionIds: () => Object.keys(__pmChat.threads || {}),
        transport: mobileQuestionTransport,
        projectToLegacy: (details) => _projectMobileQuestionToLegacy(details),
        readAnswers: (question) => _collectMobileQuestionAnswers(question),
        readDraftAnswers: (question) => _mobileQuestionPayloadFromDraft(question, _mobileQuestionDrafts.get(question.id)),
        getComposerTarget: (question) => {
          const card = document.querySelector(`[data-pm-q-card="${_pmCssEscape(question.id)}"]`);
          return String(card?.getAttribute('data-pm-q-compose-target') || '').trim();
        },
        focusComposer: _focusMobileQuestionComposer,
        onValidationMissing: (missing) => {
          const labels = missing.map((item) => item.label).filter(Boolean).slice(0, 3).join('; ');
          pmToast?.({
            key: 'mobile-question-answer-required',
            severity: 'warning',
            title: 'Answer required',
            summary: `Use the composer to answer: ${labels}`,
          });
        },
        onError: (error, details = {}) => {
          const title = details.phase === 'cancel' ? 'Question cancel failed' : 'Question submit failed';
          pmToast?.(`${title}: ${error?.message || error}`, 'error');
        },
      });
      return mobileQuestionController;
    });
  }
  return mobileQuestionControllerPromise;
}
const {
  controller: mobileTimelineController,
  scheduler: mobileStreamRenderScheduler,
  entries: _mobileTimelineEntries,
  rowSignature: chatTimelineRowSignature,
} = createMobileTimelineView({
  runtimeFor: mobileChatRuntimeAdapter.runtimeFor,
  getRows: mobileChatRuntimeAdapter.getTranscriptRows,
  isHiddenMessage: _isMobileHiddenTranscriptMessage,
});

function _mobileGoalTimestampMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function _mobileGoalStartedAtMs(goal) {
  return _mobileGoalTimestampMs(goal?.createdAt || goal?.created_at || goal?.startedAt);
}

function _mobileGoalPauseStartedAtMs(goal) {
  return _mobileGoalTimestampMs(goal?.pauseStartedAt || goal?.pause_started_at);
}

function _mobileGoalPausedMs(goal) {
  const value = Number(goal?.pausedMs || goal?.paused_ms);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function _mobileGoalFinishedAtMs(goal) {
  return _mobileGoalTimestampMs(goal?.completedAt || goal?.failedAt || goal?.blockedAt || goal?.updatedAt);
}

function _mobileGoalElapsedMs(goal) {
  const startedAt = _mobileGoalStartedAtMs(goal);
  if (!startedAt) return 0;
  const status = String(goal?.status || 'active');
  if (status === 'paused' || status === 'restarting') {
    const pausedMs = _mobileGoalPausedMs(goal);
    const pauseStartedAt = _mobileGoalPauseStartedAtMs(goal);
    const totalPausedMs = pauseStartedAt ? pausedMs + Math.max(0, Date.now() - pauseStartedAt) : pausedMs;
    const endAt = (_mobileGoalFinishedAtMs(goal) || Date.now()) - totalPausedMs;
    return Math.max(0, endAt - startedAt);
  }
  if (['completed', 'done', 'failed', 'blocked', 'cleared'].includes(status)) {
    const endedAt = _mobileGoalFinishedAtMs(goal) || Date.now();
    return Math.max(0, endedAt - startedAt - _mobileGoalPausedMs(goal));
  }
  return Math.max(0, Date.now() - startedAt - _mobileGoalPausedMs(goal));
}

function _formatMobileGoalElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function _mobileGoalStatusLabel(status) {
  const value = String(status || 'active').toLowerCase();
  if (value === 'done' || value === 'completed') return 'Completed goal';
  if (value === 'paused') return 'Paused goal';
  if (value === 'restarting') return 'Applying changes';
  if (value === 'blocked') return 'Blocked goal';
  if (value === 'failed') return 'Failed goal';
  return 'Pursuing goal';
}

function _mobileGoalStepStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'done' || value === 'failed' || value === 'in_progress' || value === 'skipped') return value;
  return 'pending';
}

function _renderMobileGoalStepList(steps = []) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  return safeSteps.map((step, idx) => {
    const status = _mobileGoalStepStatus(step?.status);
    const label = status === 'done' || status === 'skipped' ? '&#10003;' : (status === 'failed' ? '&times;' : String(idx + 1));
    return `<div class="pm-mobile-goal-step ${escapeHtml(status)}">
      <span>${label}</span>
      <p>${escapeHtml(String(step?.text || `Step ${idx + 1}`).slice(0, 180))}</p>
    </div>`;
  }).join('');
}

function _renderMobileGoalDiagnostics(goal) {
  const rows = [
    ['Quality', goal?.lastQualityGrade || ''],
    ['Open issues', Array.isArray(goal?.lastUnresolvedIssues) ? goal.lastUnresolvedIssues.join(' | ') : ''],
    ['Missing', Array.isArray(goal?.lastMissingAcceptanceCriteria) ? goal.lastMissingAcceptanceCriteria.join(' | ') : ''],
    ['Verification', Array.isArray(goal?.lastVerificationGaps) ? goal.lastVerificationGaps.join(' | ') : ''],
  ].filter(([, value]) => String(value || '').trim());
  if (!rows.length) return '';
  return `<div class="pm-mobile-goal-diagnostics">
    ${rows.map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(String(value).slice(0, 520))}</span></div>`).join('')}
  </div>`;
}

function _renderMobileGoalPlans(goal) {
  const plans = Array.isArray(goal?.turnPlans) ? goal.turnPlans : [];
  if (!plans.length) return '<div class="pm-mobile-goal-empty">No turn plan has been declared yet.</div>';
  const total = plans.length;
  return `<div class="pm-mobile-goal-plans">
    ${plans.map((plan, index) => {
      const steps = Array.isArray(plan?.steps) ? plan.steps : [];
      const done = steps.filter((step) => ['done', 'skipped'].includes(_mobileGoalStepStatus(step?.status))).length;
      const outcome = String(plan?.judgeReason || '').trim();
      return `<section class="pm-mobile-goal-plan">
        <div class="pm-mobile-goal-plan-head">
          <strong>Turn ${escapeHtml(String(index + 1))}/${escapeHtml(String(total))}</strong>
          <span>${escapeHtml(String(plan?.status || 'planned'))} - ${escapeHtml(String(done))}/${escapeHtml(String(steps.length))}</span>
        </div>
        ${steps.length ? _renderMobileGoalStepList(steps) : '<div class="pm-mobile-goal-empty">This turn has no tracked steps.</div>'}
        ${outcome ? `<div class="pm-mobile-goal-outcome">${escapeHtml(outcome.slice(0, 520))}</div>` : ''}
      </section>`;
    }).join('')}
  </div>`;
}

function _setMobileSessionGoal(sessionId, goal) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (goal && goal.status !== 'cleared') __pmChat.mainChatGoals[sid] = goal;
  else delete __pmChat.mainChatGoals[sid];
  _rememberMobileLastGoalSession(sid, goal);
  _writeMobileGoalCache();
}

function _rememberMobileSessionGoal(session = {}, fallbackSessionId = '') {
  const sid = String(session?.id || session?.sessionId || fallbackSessionId || '').trim();
  if (!sid) return;
  _setMobileSessionGoal(sid, session?.mainChatGoal || null);
}

function _getMobileGoalForSession(sessionId = '', options = {}) {
  const sid = String(sessionId || __pmChat.activeSessionId || '').trim();
  const direct = sid ? (__pmChat.mainChatGoals?.[sid] || null) : null;
  if (direct || options.fallbackToLast !== true) return direct;
  const lastSid = _readMobileLastGoalSession();
  return lastSid ? (__pmChat.mainChatGoals?.[lastSid] || null) : null;
}

function _updateMobileGoalElapsedLabels() {
  document.querySelectorAll('[data-pm-goal-elapsed][data-session-id]').forEach((label) => {
    const goal = _getMobileGoalForSession(label.getAttribute('data-session-id'));
    if (!goal || goal.status === 'cleared') return;
    label.textContent = _formatMobileGoalElapsed(_mobileGoalElapsedMs(goal));
  });
}

function _syncMobileGoalTimer() {
  const hasVisibleGoal = !!document.querySelector('[data-pm-goal-elapsed][data-session-id]');
  if (!hasVisibleGoal) {
    if (__pmChat.goalTimer) clearInterval(__pmChat.goalTimer);
    __pmChat.goalTimer = null;
    return;
  }
  _updateMobileGoalElapsedLabels();
  const anyActiveGoal = !!document.querySelector('.pm-mobile-goal-strip[data-status="active"] [data-pm-goal-elapsed][data-session-id]');
  if (anyActiveGoal && !__pmChat.goalTimer) {
    __pmChat.goalTimer = setInterval(_updateMobileGoalElapsedLabels, 1000);
  } else if (!anyActiveGoal && __pmChat.goalTimer) {
    clearInterval(__pmChat.goalTimer);
    __pmChat.goalTimer = null;
  }
}

async function _mobileGoalAction(sessionId, action) {
  const sid = String(sessionId || __pmChat.activeSessionId || '').trim();
  const name = String(action || '').trim().toLowerCase();
  if (!sid || !name) return;
  try { pmHaptic?.(12); } catch {}
  const body = {};
  if (name === 'pause') {
    const reason = window.prompt?.('Pause reason (optional)', '') || '';
    if (reason.trim()) body.text = reason.trim();
  } else if (name === 'done') {
    const note = window.prompt?.('Completion note (optional)', '') || '';
    if (note.trim()) body.text = note.trim();
  } else if (name === 'clear') {
    const ok = window.confirm?.('Clear and archive this goal?') ?? true;
    if (!ok) return;
    const note = window.prompt?.('Archive note (optional)', '') || '';
    if (note.trim()) body.text = note.trim();
  } else if (name === 'revise') {
    const current = _getMobileGoalForSession(sid);
    const goal = window.prompt?.('Revise goal', current?.goal || '') || '';
    if (!goal.trim()) return;
    body.goal = goal.trim();
  }
  try {
    const result = await mobileGatewayFetch(`/api/sessions/${encodeURIComponent(sid)}/main-goal/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    _setMobileSessionGoal(sid, result?.goal || null);
    _refreshVisibleMobileGoalPills(sid);
    try { window.__pmMobileGoalChanged?.(); } catch {}
    pmToast(presentGoalAction(name, result));
  } catch (err) {
    pmToast(presentChatError(err));
  }
}

function _renderMobileGoalPill(target, sessionId = '', options = {}) {
  if (!target) return;
  let sid = String(sessionId || __pmChat.activeSessionId || '').trim();
  let goal = _getMobileGoalForSession(sid);
  const fallbackToLast = options.fallbackToLast === true || target.dataset.goalFallback === 'last';
  target.dataset.goalFallback = fallbackToLast ? 'last' : '';
  if (!goal && fallbackToLast) {
    const lastSid = _readMobileLastGoalSession();
    const fallbackGoal = lastSid ? _getMobileGoalForSession(lastSid) : null;
    if (fallbackGoal) {
      sid = lastSid;
      goal = fallbackGoal;
    }
  }
  if (!sid || !goal || ['cleared', 'done', 'completed'].includes(String(goal.status || '').toLowerCase())) {
    target.hidden = true;
    target.innerHTML = '';
    delete target.dataset.sessionId;
    delete target.dataset.expanded;
    target.removeAttribute('data-status');
    _syncMobileGoalTimer();
    _syncMobileRuntimePillPair(target);
    return;
  }
  target.dataset.sessionId = sid;
  const expanded = __pmChat.goalDetailsOpen?.[sid] === true;
  const judgeReprompt = String(goal.nextStepDirective || goal.lastJudgeDirective || goal.lastReason || '').trim();
  const status = String(goal.status || 'active');
  const isActive = status === 'active';
  const canResume = ['paused', 'blocked', 'failed'].includes(status);
  target.hidden = false;
  target.setAttribute('data-status', status);
  target.dataset.expanded = expanded ? 'true' : 'false';
  target.innerHTML = `
    <button type="button" class="pm-mobile-goal-pill" data-mobile-goal-toggle="${escapeHtml(sid)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="Toggle goal progress">
      <span class="pm-mobile-goal-pill-icon" aria-hidden="true"></span>
      <span class="pm-mobile-goal-pill-label">${escapeHtml(_mobileGoalStatusLabel(status))}</span>
      <b data-pm-goal-elapsed data-session-id="${escapeHtml(sid)}">${escapeHtml(_formatMobileGoalElapsed(_mobileGoalElapsedMs(goal)))}</b>
      <input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" />
    </button>
    ${expanded ? `
      <div class="pm-mobile-goal-details">
        <div><strong>Turns</strong><span>${escapeHtml(String(Number(goal.turnsUsed || 0)))}</span></div>
        <div><strong>Original goal</strong><span>${escapeHtml(goal.goal || 'Untitled goal')}</span></div>
        <div><strong>Last judge reprompt</strong><span>${escapeHtml(judgeReprompt || 'No judge reprompt yet.')}</span></div>
        ${_renderMobileGoalDiagnostics(goal)}
        ${_renderMobileGoalPlans(goal)}
        <div class="pm-mobile-goal-actions">
          ${isActive ? `<button type="button" data-mobile-goal-action="pause">Pause</button>` : ''}
          ${canResume ? `<button type="button" data-mobile-goal-action="resume">Resume</button>` : ''}
          <button type="button" data-mobile-goal-action="status">Status</button>
          <button type="button" data-mobile-goal-action="revise">Revise</button>
          ${status !== 'done' ? `<button type="button" data-mobile-goal-action="done">Done</button>` : ''}
          <button type="button" data-mobile-goal-action="clear">Clear</button>
        </div>
      </div>
    ` : ''}`;
  target.querySelector('[data-mobile-goal-toggle]')?.addEventListener('click', () => {
    try { pmHaptic?.(12); } catch {}
    __pmChat.goalDetailsOpen[sid] = !__pmChat.goalDetailsOpen[sid];
    if (__pmChat.goalDetailsOpen[sid]) {
      const planState = _mobileMainPlanState(sid);
      planState.open = false;
      _renderMobileMainPlanDock(document.getElementById('pm-main-plan-dock'), sid);
    }
    _renderMobileGoalPill(target, sid, { fallbackToLast });
    // The goal card is fixed above the composer. Tell the active chat shell to
    // remeasure it after both opening and closing so the conversation reserves
    // the card's full height instead of being covered by it.
    try { window.__pmMobileGoalChanged?.({ sessionId: sid, event: 'details_toggled' }); } catch {}
  });
  target.querySelectorAll('[data-mobile-goal-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _mobileGoalAction(sid, button.getAttribute('data-mobile-goal-action') || '').catch(() => {});
    });
  });
  _syncMobileGoalTimer();
  _syncMobileRuntimePillPair(target);
}

function _refreshVisibleMobileGoalPills(sessionId = '') {
  document.querySelectorAll('.pm-mobile-goal-strip').forEach((target) => {
    const existingSid = String(target.dataset.sessionId || __pmChat.activeSessionId || '').trim();
    const changedSid = String(sessionId || '').trim();
    if (changedSid && existingSid && changedSid !== existingSid) return;
    const sid = String(existingSid || changedSid || __pmChat.activeSessionId || '').trim();
    _renderMobileGoalPill(target, sid, { fallbackToLast: target.dataset.goalFallback === 'last' });
  });
}

function _activeMobileThread() {
  const sid = __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
  __pmChat.thread = __pmChat.threads[sid];
  return __pmChat.thread;
}

function _isMobileChatSessionVisibleToUser(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID) return false;
  const activeSid = String(__pmChat.activeSessionId || '').trim();
  if (activeSid !== sid) return false;
  if (document.visibilityState && document.visibilityState !== 'visible') return false;
  const hash = String(location.hash || '');
  return hash === `#mobile/chat/${encodeURIComponent(sid)}` || hash === `#mobile/chat/${sid}`;
}


function _rememberMobileLastChatSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID) return;
  try { localStorage.setItem(PM_MOBILE_LAST_CHAT_SESSION_KEY, sid); } catch {}
}

function _readMobileLastChatSession() {
  try {
    const sid = String(localStorage.getItem(PM_MOBILE_LAST_CHAT_SESSION_KEY) || '').trim();
    return sid && sid !== MOBILE_CHAT_SESSION_ID ? sid : '';
  } catch {
    return '';
  }
}

function _clearMobileLastChatSession() {
  try { localStorage.removeItem(PM_MOBILE_LAST_CHAT_SESSION_KEY); } catch {}
}

function _clearMobileDraftSessionState() {
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
  _clearMobileActiveRun(MOBILE_CHAT_SESSION_ID);
  _markMobileSessionRunning(MOBILE_CHAT_SESSION_ID, false);
  if (String(__pmChat.activeSessionId || '') === MOBILE_CHAT_SESSION_ID) {
    __pmChat.thread = __pmChat.threads[MOBILE_CHAT_SESSION_ID];
  }
}

// ── Thread skeleton cache (instant cold-open render) ─────────────────────────
// This is deliberately a compact render skeleton, not a second durable history.
// The gateway remains authoritative and replaces/merges it immediately on open.
function _compactMobileThreadCacheMedia(items) {
  return (Array.isArray(items) ? items : []).slice(-12).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const path = String(item.path || item.workspacePath || item.relPath || item.rel_path || item.filePath || '').trim();
    const rawUrl = String(item.url || item.src || item.imageUrl || item.productUrl || '').trim();
    const url = rawUrl && !/^data:/i.test(rawUrl) ? rawUrl : '';
    return {
      kind: String(item.kind || item.type || '').trim() || undefined,
      name: String(item.name || item.file_name || item.title || '').trim() || undefined,
      mimeType: String(item.mimeType || item.mime_type || '').trim() || undefined,
      path: path || undefined,
      url: url || undefined,
      productUrl: String(item.productUrl || '').trim() || undefined,
    };
  }).filter((item) => item && (item.path || item.url || item.name || item.productUrl));
}

function _compactMobileThreadCacheFileChanges(value) {
  return _mobileChatRendererInvoke('compactFileChanges', [value]);
}

function _hasMobileFileChanges(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.files) && value.files.length > 0) return true;
  return Array.isArray(value.groups) && value.groups.some((group) => {
    const payload = group?.fileChanges && typeof group.fileChanges === 'object' ? group.fileChanges : group;
    return Array.isArray(payload?.files) && payload.files.length > 0;
  });
}

function _compactMobileThreadCacheValue(value, limit = 1800) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') return value.slice(0, limit);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    const clone = JSON.parse(JSON.stringify(value));
    return JSON.stringify(clone).length <= limit ? clone : undefined;
  } catch {
    return undefined;
  }
}

function _compactMobileThreadCacheExtra(value) {
  if (!value || typeof value !== 'object') return undefined;
  const compact = {};
  const keys = [
    'event', 'source', 'visibility', 'action', 'toolName', 'toolCallId', 'tool_call_id',
    'callId', 'eventKey', 'streamId', 'seq', 'stepNum', 'status', 'ok', 'durationMs',
    'message', 'progress', 'error', 'args', 'result', 'output',
  ];
  for (const key of keys) {
    const next = _compactMobileThreadCacheValue(value[key], key === 'result' || key === 'output' ? 2800 : 1200);
    if (next !== undefined) compact[key] = next;
  }
  return Object.keys(compact).length ? compact : undefined;
}

function _compactMobileThreadCacheActivity(activity) {
  if (!activity || typeof activity !== 'object') return undefined;
  const compact = {};
  const keys = [
    'kind', 'callId', 'action', 'key', 'family', 'countNoun', 'target', 'status', 'ok',
    'progress', 'result', 'durationMs', 'startedAt', 'updatedAt', 'technicalName',
    'activityId', 'resultAttached', 'eventKey', 'streamId', 'seq', 'stepNum',
  ];
  for (const key of keys) {
    const next = _compactMobileThreadCacheValue(activity[key], key === 'result' ? 4200 : 1200);
    if (next !== undefined) compact[key] = next;
  }
  const args = _compactMobileThreadCacheValue(activity.args, 2200);
  if (args !== undefined) compact.args = args;
  if (activity.terminal && typeof activity.terminal === 'object') {
    const terminal = _compactMobileThreadCacheValue({
      runId: activity.terminal.runId,
      state: activity.terminal.state,
      output: String(activity.terminal.output || '').slice(-12000),
      sequence: activity.terminal.sequence,
      exitCode: activity.terminal.exitCode,
      durationMs: activity.terminal.durationMs,
    }, 15000);
    if (terminal) compact.terminal = terminal;
  }
  return Object.keys(compact).length ? compact : undefined;
}

function _compactMobileThreadCachePreview(preview, fallbackDataUrl = '') {
  const source = preview && typeof preview === 'object' ? preview : {};
  const rawDataUrl = String(source.dataUrl || fallbackDataUrl || '').trim();
  const dataUrl = buildMobileVisionPreviewUrl(rawDataUrl);
  if (!dataUrl) return undefined;
  // Keep reconnect snapshots bounded and never persist a truncated data URL.
  // Route-backed desktop/canvas previews are small; browser capture data URLs
  // are retained only when they can fit as a complete image in the cache.
  if (/^data:image\//i.test(dataUrl) && dataUrl.length > 180_000) return undefined;
  const compact = {
    dataUrl,
    mimeType: String(source.mimeType || '').trim() || undefined,
    width: Number(source.width || 0) || undefined,
    height: Number(source.height || 0) || undefined,
    screenshotId: String(source.screenshotId || '').trim() || undefined,
    capturedAt: Number(source.capturedAt || 0) || undefined,
    title: String(source.title || '').trim() || undefined,
    artifactKind: String(source.artifactKind || '').trim() || undefined,
    previewId: String(source.previewId || '').trim() || undefined,
    generationId: String(source.generationId || '').trim() || undefined,
    workspacePath: String(source.workspacePath || '').trim() || undefined,
    cacheKey: String(source.cacheKey || '').trim() || undefined,
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined));
}

function _compactMobileThreadCacheTrace(entries, limit = 180) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => !_isMobileTransientReasoningTraceEntry(entry))
    .slice(-limit)
    .map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const text = String(entry.text || entry.content || entry.message || '').slice(0, 4200);
    const extra = _compactMobileThreadCacheExtra(entry.extra);
    const activity = _compactMobileThreadCacheActivity(entry.activity);
    const preview = _compactMobileThreadCachePreview(entry.preview, entry.dataUrl);
    const compact = {
      id: String(entry.id || '').trim() || undefined,
      type: String(entry.type || entry.kind || 'event').trim() || 'event',
      text,
      ts: Number(entry.ts || entry.timestamp || 0) || undefined,
      time: String(entry.time || '').trim() || undefined,
      endTs: Number(entry.endTs || 0) || undefined,
      ...(extra ? { extra } : {}),
      ...(activity ? { activity } : {}),
      ...(preview ? { preview } : {}),
    };
    return compact;
    }).filter((entry) => entry && (entry.text || entry.activity || entry.extra));
}

function _compactMobileThreadCacheProcess(entries, limit = 10) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => !_isMobileTransientReasoningTraceEntry(entry))
    .slice(-limit)
    .map((entry) => ({
    id: String(entry?.id || '').trim() || undefined,
    _key: String(entry?._key || '').trim() || undefined,
    type: String(entry?.type || entry?.kind || 'event').trim() || 'event',
    text: String(entry?.text || entry?.content || entry?.message || '').slice(0, 900),
    content: String(entry?.content || entry?.text || entry?.message || '').slice(0, 900),
    toolName: String(entry?.toolName || entry?.action || entry?.name || '').trim() || undefined,
    timestamp: Number(entry?.timestamp || entry?.t || entry?.ts || 0) || undefined,
    time: String(entry?.time || '').trim() || undefined,
    status: String(entry?.status || '').trim() || undefined,
    extra: _compactMobileThreadCacheExtra(entry?.extra),
    })).filter((entry) => entry.text || entry.content || entry.toolName);
}

function _compactMobileThreadCacheWorkgroup(value) {
  const workgroup = _normalizeMobileVoiceWorkgroup(value);
  if (!workgroup) return undefined;
  return {
    ...workgroup,
    workers: workgroup.workers.map((worker) => ({
      ...worker,
      prompt: String(worker.prompt || '').slice(0, 500),
      finalResult: String(worker.finalResult || '').slice(0, 1000),
      completedSteps: (worker.completedSteps || []).slice(-12),
      processEntries: _compactMobileThreadCacheProcess(worker.processEntries, 8),
    })),
  };
}

function _compactMobileThreadCacheMessage(m) {
  const content = String(m?.content || m?.body?.text || '');
  const bodyAttachments = _compactMobileThreadCacheMedia(m?.body?.attachments);
  const attachmentPreviews = _compactMobileThreadCacheMedia(m?.attachmentPreviews);
  const compact = {
    role: m?.role,
    messageId: String(m?.messageId || '').trim() || undefined,
    messageKind: String(m?.messageKind || '').trim() || undefined,
    timestamp: Number(m?.timestamp || Date.now()) || Date.now(),
    time: String(m?.time || '').trim() || undefined,
    streaming: m?.streaming === true,
    _pmFinalReceived: m?._pmFinalReceived === true || undefined,
    _pmBackgroundImageGeneration: m?._pmBackgroundImageGeneration === true || undefined,
    content,
    body: {
      text: String(m?.body?.text || content),
      sender: String(m?.body?.sender || ''),
      source: String(m?.body?.source || '').trim() || undefined,
      attachments: bodyAttachments.length ? bodyAttachments : undefined,
      selectedSkillRefs: Array.isArray(m?.body?.selectedSkillRefs) ? m.body.selectedSkillRefs.slice(-8) : undefined,
    },
    attachmentPreviews: attachmentPreviews.length ? attachmentPreviews : undefined,
    processEntries: _compactMobileThreadCacheProcess(m?.processEntries, m?.streaming ? 16 : 8),
    liveTraceEntries: _compactMobileThreadCacheTrace(m?.liveTraceEntries, m?.streaming ? 300 : 180),
    workStartedAt: Number(m?.workStartedAt || 0) || undefined,
    workEndedAt: Number(m?.workEndedAt || 0) || undefined,
    workDurationMs: Number.isFinite(Number(m?.workDurationMs)) ? Number(m.workDurationMs) : undefined,
    _clientRequestId: String(m?._clientRequestId || '').trim() || undefined,
    source: String(m?.source || '').trim() || undefined,
    channelLabel: String(m?.channelLabel || '').trim() || undefined,
    workflowGroupId: String(m?.workflowGroupId || '').trim() || undefined,
    workflowPart: String(m?.workflowPart || '').trim() || undefined,
    workflowLabel: String(m?.workflowLabel || '').trim() || undefined,
    voiceAgentWorkerHandoff: m?.voiceAgentWorkerHandoff === true || undefined,
    voiceWorkgroup: _compactMobileThreadCacheWorkgroup(m?.voiceWorkgroup),
    generatedImages: _compactMobileThreadCacheMedia(m?.generatedImages),
    generatedVideos: _compactMobileThreadCacheMedia(m?.generatedVideos),
    files: _compactMobileThreadCacheMedia(m?.files),
    artifacts: _compactMobileThreadCacheMedia(m?.artifacts),
    fileChanges: _compactMobileThreadCacheFileChanges(m?.fileChanges),
    // Keep every supported rich card in the offline/reconnect snapshot. Voice
    // show_ui cards use concrete types such as weather, chart, and sources;
    // filtering to only legacy `visual` cards made them vanish after recovery.
    richArtifacts: Array.isArray(m?.richArtifacts)
      ? m.richArtifacts.filter((item) => item && typeof item === 'object').slice(-8).map((item) => ({ ...item }))
      : undefined,
    productCarousel: m?.productCarousel && typeof m.productCarousel === 'object' ? {
      title: String(m.productCarousel.title || '').slice(0, 160),
      source: String(m.productCarousel.source || '').slice(0, 240),
      items: (Array.isArray(m.productCarousel.items) ? m.productCarousel.items : []).slice(0, 12).map((item) => ({
        title: String(item?.title || '').slice(0, 240),
        price: String(item?.price || '').slice(0, 80),
        description: String(item?.description || '').slice(0, 500),
        imageUrl: /^data:/i.test(String(item?.imageUrl || '')) ? undefined : String(item?.imageUrl || '').slice(0, 1200),
        imagePath: String(item?.imagePath || '').slice(0, 500),
        productUrl: String(item?.productUrl || '').slice(0, 1200),
        merchant: String(item?.merchant || '').slice(0, 120),
      })),
    } : undefined,
  };
  if (!compact.processEntries.length) delete compact.processEntries;
  if (!compact.liveTraceEntries.length) delete compact.liveTraceEntries;
  for (const key of ['generatedImages', 'generatedVideos', 'files', 'artifacts']) {
    if (!compact[key]?.length) delete compact[key];
  }
  if (!_hasMobileFileChanges(compact.fileChanges)) {
    delete compact.fileChanges;
  }
  if (!compact.richArtifacts?.length) delete compact.richArtifacts;
  return compact;
}

function _trimMobileThreadCacheToBudget(thread) {
  const safe = (Array.isArray(thread) ? thread : [])
    .filter(_isMobileMessageCacheable)
    .slice(-PM_MOBILE_THREAD_CACHE_MAX)
    .map(_compactMobileThreadCacheMessage);
  while (safe.length > 4 && JSON.stringify(safe).length > PM_MOBILE_THREAD_CACHE_ENTRY_CHAR_BUDGET) safe.shift();
  return safe;
}

function _saveMobileThreadCache(sessionId, thread) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID) return;
  try {
    let safe = _trimMobileThreadCacheToBudget(thread);
    const store = _readMobileThreadCacheStore();
    const latestTimestamp = safe.reduce((latest, message) => Math.max(latest, Number(message?.timestamp || 0) || 0), 0);
    store[sid] = {
      schemaVersion: 2,
      thread: safe,
      savedAt: Date.now(),
      latestTimestamp,
      messageCount: safe.length,
    };
    // Keep a small recent-session set and a hard total payload budget.
    const keys = Object.keys(store).filter((k) => k !== sid);
    if (keys.length >= PM_MOBILE_THREAD_CACHE_SESSION_MAX) {
      const sorted = keys.sort((a, b) => (store[a]?.savedAt || 0) - (store[b]?.savedAt || 0));
      sorted.slice(0, keys.length - (PM_MOBILE_THREAD_CACHE_SESSION_MAX - 1)).forEach((k) => delete store[k]);
    }
    while (Object.keys(store).length > 1 && JSON.stringify(store).length > PM_MOBILE_THREAD_CACHE_TOTAL_CHAR_BUDGET) {
      const oldest = Object.keys(store)
        .filter((key) => key !== sid)
        .sort((a, b) => (store[a]?.savedAt || 0) - (store[b]?.savedAt || 0))[0];
      if (!oldest) break;
      delete store[oldest];
    }
    // Quota may be lower on an iOS PWA. Evict old sessions, then shrink this
    // one and retry instead of silently leaving an ancient snapshot behind.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        localStorage.setItem(PM_MOBILE_THREAD_CACHE_KEY, JSON.stringify(store));
        if (attempt > 0) console.info('[mobile cache] recovered after quota eviction', { sessionId: sid, attempt });
        return;
      } catch (err) {
        const oldest = Object.keys(store)
          .filter((key) => key !== sid)
          .sort((a, b) => (store[a]?.savedAt || 0) - (store[b]?.savedAt || 0))[0];
        if (oldest) {
          delete store[oldest];
          continue;
        }
        if (safe.length <= 4) {
          console.warn('[mobile cache] snapshot could not be stored', { sessionId: sid, error: String(err?.message || err) });
          return;
        }
        safe = safe.slice(Math.max(0, Math.floor(safe.length / 3)));
        store[sid] = { ...store[sid], thread: safe, messageCount: safe.length };
      }
    }
  } catch (err) {
    console.warn('[mobile cache] snapshot serialization failed', { sessionId: sid, error: String(err?.message || err) });
  }
}

function _readMobileThreadCacheStore() {
  try {
    const raw = localStorage.getItem(PM_MOBILE_THREAD_CACHE_KEY)
      || localStorage.getItem(PM_MOBILE_THREAD_CACHE_LEGACY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function _loadMobileThreadCache(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID) return [];
  try {
    const store = _readMobileThreadCacheStore();
    const entry = store[sid];
    if (!entry || !Array.isArray(entry.thread)) return [];
    // Discard cache older than 24h — stale enough to be confusing
    if (Date.now() - Number(entry.savedAt || 0) > 86_400_000) return [];
    if (_mobileThreadLooksRoleGrouped(entry.thread)) {
      delete store[sid];
      try { localStorage.setItem(PM_MOBILE_THREAD_CACHE_KEY, JSON.stringify(store)); } catch {}
      return [];
    }
    // Older snapshots may contain the pre-fix summary rows. They are live UI
    // state, not transcript history; drop them before hydration so a cold
    // open cannot turn a replaced summary back into a regular thought.
    return entry.thread.map((message) => {
      if (!message || typeof message !== 'object') return message;
      const next = { ...message };
      next.processEntries = _mobileDurableReasoningEntries(next.processEntries);
      next.liveTraceEntries = _mobileDurableReasoningEntries(next.liveTraceEntries);
      if (!next.processEntries.length) delete next.processEntries;
      if (!next.liveTraceEntries.length) delete next.liveTraceEntries;
      return next;
    });
  } catch { return []; }
}

const _mobileThreadCacheSaveTimers = new Map();

function _scheduleMobileThreadCacheSave(sessionId, delayMs = 700) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID || !Array.isArray(__pmChat.threads?.[sid])) return;
  const prior = _mobileThreadCacheSaveTimers.get(sid);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    _mobileThreadCacheSaveTimers.delete(sid);
    _saveMobileThreadCache(sid, __pmChat.threads?.[sid] || []);
  }, Math.max(80, Number(delayMs) || 700));
  _mobileThreadCacheSaveTimers.set(sid, timer);
}

function _flushMobileThreadCacheSave(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID || !Array.isArray(__pmChat.threads?.[sid])) return;
  const prior = _mobileThreadCacheSaveTimers.get(sid);
  if (prior) clearTimeout(prior);
  _mobileThreadCacheSaveTimers.delete(sid);
  _saveMobileThreadCache(sid, __pmChat.threads[sid]);
}

if (typeof window !== 'undefined' && !window.__pmMobileThreadCacheLifecycleInstalled) {
  window.__pmMobileThreadCacheLifecycleInstalled = true;
  const flushActive = () => _flushMobileThreadCacheSave(__pmChat.activeSessionId);
  window.addEventListener('pagehide', flushActive);
  window.addEventListener('beforeunload', flushActive);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushActive();
    } else {
      _scheduleMobileSessionFreshnessRefresh(__pmChat.activeSessionId, { delayMs: 80 });
    }
  });
}

// A mobile tab can observe a turn admitted by another tab.  Make the server's
// identity the local source of truth before replaying it; otherwise the
// observer keeps its speculative clientRequestId and noteChatStreamSeq rejects
// every legitimate replay frame as "foreign".
function _adoptMobileActiveRunState(sessionId, { run = null, stream = null, fallback = null } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const current = __pmChat.activeRuns?.[sid] && typeof __pmChat.activeRuns[sid] === 'object'
    ? __pmChat.activeRuns[sid]
    : {};
  const remembered = fallback || _readMobileActiveRun(sid) || {};
  const runtimeId = String(run?.id || run?.runtimeId || run?.runId || current.runtimeId || remembered.runtimeId || '').trim();
  const streamId = String(stream?.streamId || current.streamId || remembered.streamId || '').trim();
  const clientRequestId = String(run?.clientRequestId || current.clientRequestId || remembered.clientRequestId || '').trim();
  const startedAt = Number(run?.startedAt || current.startedAt || remembered.startedAt || 0) || 0;
  const lastSeq = Math.max(
    Number(current.lastSeq || 0) || 0,
    Number(remembered.lastSeq || 0) || 0,
    Number(stream?.lastSeq || 0) || 0,
  );
  const next = {
    ...current,
    busy: true,
    startedAt,
    runtimeId,
    streamId,
    clientRequestId,
    lastSeq,
  };
  if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
  __pmChat.activeRuns[sid] = next;
  _markMobileSessionRunning(sid, true);
  if (clientRequestId) {
    if (!__pmChat.sentClientRequestIds || typeof __pmChat.sentClientRequestIds !== 'object') __pmChat.sentClientRequestIds = {};
    __pmChat.sentClientRequestIds[sid] = clientRequestId;
  }
  _rememberMobileActiveRun(sid, {
    startedAt: startedAt || undefined,
    disconnected: false,
    runtimeId,
    streamId,
    clientRequestId,
    lastSeq,
  });
  delete __pmChat.mobileRecoveryUncertainSince[sid];
  return next;
}

function _getMobileRunningSessionIds() {
  const ids = new Set();
  if (__pmChat.drawerRunSessionIds instanceof Set) {
    for (const id of __pmChat.drawerRunSessionIds) if (id) ids.add(String(id));
  }
  if (__pmChat.activeRuns && typeof __pmChat.activeRuns === 'object') {
    Object.entries(__pmChat.activeRuns).forEach(([id, run]) => {
      if (run?.busy) ids.add(String(id));
    });
  }
  return ids;
}

window.enrichMobileSessionGroupsForDrawer = enrichMobileSessionGroupsForDrawer;

async function enrichMobileSessionGroupsForDrawer(loadSessions) {
  const data = typeof loadSessions === 'function' ? await loadSessions() : { mobile: [], channels: [] };
  let activeIds = _getMobileRunningSessionIds();
  try {
    const status = typeof loadMobileChatRunStatuses === 'function' ? await loadMobileChatRunStatuses() : null;
    const serverIds = Array.isArray(status?.activeSessionIds) ? status.activeSessionIds : [];
    activeIds = new Set([...activeIds, ...serverIds.map((id) => String(id || '').trim()).filter(Boolean)]);
    __pmChat.drawerRunSessionIds = activeIds;
  } catch {}
  const applyState = (session) => ({
    ...(session || {}),
    activeRun: activeIds.has(String(session?.id || '')) || session?.activeRun === true,
  });
  return {
    ...data,
    mobile: Array.isArray(data?.mobile) ? data.mobile.map(applyState) : [],
    channels: Array.isArray(data?.channels)
      ? data.channels.map((channel) => ({
          ...channel,
          sessions: Array.isArray(channel?.sessions) ? channel.sessions.map(applyState) : [],
        }))
      : [],
  };
}

function _startMobileNewChat(navigate) {
  // A regular mobile chat is deliberately separate from a Voice Room.  Keep
  // the durable room session on disk, but tear down the *active* room binding
  // so entering voice from this fresh chat cannot silently route back there.
  _exitMobileVoiceRoomForFreshChat('new_mobile_chat');
  _clearMobileLastChatSession();
  __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
  resetMobileDraftModelRoute();
  _clearMobileDraftSessionState();
  __pmChat.editingMessageIndex = -1;
  __pmVoice.targetSessionId = MOBILE_CHAT_SESSION_ID;
  __pmVoice.targetSessionLabel = 'Mobile - New Chat';
  __pmVoice.targetSessionChannel = 'mobile';
  __pmVoice.targetSessionForced = true;
  __pmVoice.pendingInterruptContext = null;
  __pmVoice.lastInterruptionEvent = null;
  if (__pmVoice.activeVoiceRuntime) __pmVoice.activeVoiceRuntime.isStreamActive = false;
  __pmVoice.activeVoiceRuntime = null;
  invalidateMobileDrawerSessions('mobile');
  navigate?.('#mobile/chat');
  return MOBILE_CHAT_SESSION_ID;
}

function _startMobileNewVoiceDraft() {
  _clearMobileLastChatSession();
  __pmChat.activeSessionId = MOBILE_CHAT_SESSION_ID;
  resetMobileDraftModelRoute();
  _clearMobileDraftSessionState();
  __pmChat.editingMessageIndex = -1;
  __pmVoice.target = { kind: 'main' };
  _restoreTemporaryMobileSubagentVoiceProfile({ applyLive: false });
  __pmVoice.target = { kind: 'main' };
  // Starting a standalone Voice conversation must reset its *chat context*,
  // but a configured multi-agent room is a separate, durable preference.  Do
  // not inherit its sticky speaker into a fresh room entry: the user must
  // address a participant again before an unaddressed follow-up can route.
  const room = _normalizeVoiceRoomState(__pmVoice?.room || _loadVoiceRoomState());
  __pmVoice.room = _saveVoiceRoomState({
    ...room,
    focusUntil: 0,
    recentRoutes: [],
  });
  __pmVoice.targetSessionId = MOBILE_CHAT_SESSION_ID;
  __pmVoice.targetSessionLabel = 'Mobile - New Chat';
  __pmVoice.targetSessionChannel = 'mobile';
  __pmVoice.targetSessionForced = true;
  __pmVoice.pendingInterruptContext = null;
  __pmVoice.lastInterruptionEvent = null;
  if (__pmVoice.activeVoiceRuntime) __pmVoice.activeVoiceRuntime.isStreamActive = false;
  __pmVoice.activeVoiceRuntime = null;
  invalidateMobileDrawerSessions('mobile');
  return MOBILE_CHAT_SESSION_ID;
}

function _isMobileNewChatDraftActiveForVoice() {
  const chatSid = String(__pmChat.activeSessionId || '').trim();
  const voiceSid = String(__pmVoice?.targetSessionId || '').trim();
  const draftThread = Array.isArray(__pmChat.threads?.[MOBILE_CHAT_SESSION_ID])
    ? __pmChat.threads[MOBILE_CHAT_SESSION_ID]
    : [];
  const forcedDraftTarget = __pmVoice?.targetSessionForced === true
    && (!voiceSid || voiceSid === MOBILE_CHAT_SESSION_ID);
  return chatSid === MOBILE_CHAT_SESSION_ID
    || forcedDraftTarget
    || (voiceSid === MOBILE_CHAT_SESSION_ID && draftThread.length === 0);
}

async function _rebindMobileCodexBridgeOwnerSession(ownerSessionId) {
  const owner = String(ownerSessionId || '').trim();
  const conn = __pmRealtimeAgent?.conn;
  const bridgeSessionId = String(conn?.codexBridgeSessionId || '').trim();
  if (!owner || !bridgeSessionId || conn?.transport !== 'codex_app_server') return false;
  try {
    const result = await mobileGatewayFetch('/api/realtime/codex-bridge/rebind-owner', {
      method: 'POST',
      body: JSON.stringify({ sessionId: bridgeSessionId, ownerSessionId: owner }),
    });
    if (!result?.success) return false;
    conn.sessionId = owner;
    if (__pmRealtimeAgent?.codexBridgeEventPoll?.conn === conn) {
      __pmRealtimeAgent.codexBridgeEventPoll.conn.sessionId = owner;
    }
    _voiceDebug('codex-bridge-owner-rebound', { bridgeSessionId, ownerSessionId: owner });
    return true;
  } catch (err) {
    _voiceDebug('codex-bridge-owner-rebind-failed', {
      bridgeSessionId,
      ownerSessionId: owner,
      message: String(err?.message || err),
    });
    return false;
  }
}

async function _ensureDurableMobileVoiceSession({ title = 'Mobile chat', source = 'mobile_voice' } = {}) {
  const chatSid = String(__pmChat?.activeSessionId || '').trim();
  const voiceSid = String(__pmVoice?.targetSessionId || '').trim();
  const currentSid = voiceSid || chatSid || MOBILE_CHAT_SESSION_ID;
  if (currentSid && currentSid !== MOBILE_CHAT_SESSION_ID) {
    if (!Array.isArray(__pmChat.threads?.[currentSid])) __pmChat.threads[currentSid] = [];
    if (!Array.isArray(__pmChat.attachments?.[currentSid])) __pmChat.attachments[currentSid] = [];
    __pmChat.activeSessionId = currentSid;
    __pmChat.thread = __pmChat.threads[currentSid];
    _rememberMobileLastChatSession(currentSid);
    return currentSid;
  }

  const sid = createMobileChatSessionId();
  const draftThread = Array.isArray(__pmChat.threads?.[MOBILE_CHAT_SESSION_ID])
    ? __pmChat.threads[MOBILE_CHAT_SESSION_ID]
    : [];
  const draftAttachments = Array.isArray(__pmChat.attachments?.[MOBILE_CHAT_SESSION_ID])
    ? __pmChat.attachments[MOBILE_CHAT_SESSION_ID]
    : [];
  __pmChat.threads[sid] = draftThread;
  __pmChat.attachments[sid] = draftAttachments;
  __pmChat.threads[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.attachments[MOBILE_CHAT_SESSION_ID] = [];
  __pmChat.activeSessionId = sid;
  __pmChat.thread = __pmChat.threads[sid];
  _rememberMobileLastChatSession(sid);

  __pmVoice.targetSessionId = sid;
  __pmVoice.targetSessionLabel = 'Mobile - Chat';
  __pmVoice.targetSessionChannel = 'mobile';
  __pmVoice.targetSessionForced = true;
  if (__pmVoice.activeVoiceRuntime && String(__pmVoice.activeVoiceRuntime.sessionId || '').trim() === MOBILE_CHAT_SESSION_ID) {
    __pmVoice.activeVoiceRuntime.sessionId = sid;
  }
  await _rebindMobileCodexBridgeOwnerSession(sid);

  const cleanTitle = String(title || 'Mobile chat').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Mobile chat';
  try {
    await createMobileChatSession(sid, { title: cleanTitle });
    await applyMobileDraftModelRouteToSession(sid);
    if (draftThread.length) {
      await updateMobileChatSessionHistory(sid, _mobileHistoryForServer(draftThread), { resetCompaction: true });
    }
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!/409|already exists|exists/i.test(msg)) {
      console.warn('[mobile voice] failed to create durable voice session:', err);
    }
  }

  try {
    if (location.hash === '#mobile/chat' || location.hash === `#mobile/chat/${encodeURIComponent(MOBILE_CHAT_SESSION_ID)}`) {
      window.history.replaceState(null, '', `${window.location.pathname || '/'}${window.location.search || ''}#mobile/chat/${encodeURIComponent(sid)}`);
    }
  } catch {}
  invalidateMobileDrawerSessions('mobile');
  refreshMobileDrawerSessions({ force: true, channel: 'mobile' }).catch(() => {});
  _notifyMobileChatVoiceUpdate(sid, { reason: source, force: true });
  try { _voiceDebug('mobile-voice-durable-session', { sessionId: sid, source }); } catch {}
  return sid;
}

function _serverRoleToMobileRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'ai';
}

function _mobileRoleToServerRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
}

function _isMobileRestartContextPacketText(value) {
  return /^Restart Context Packet\b/i.test(String(value || '').trim());
}

function _stripMobileInternalUploadContext(value) {
  return String(value || '').replace(/\n\n\[UPLOADED FILES\][\s\S]*$/i, '').trim();
}

function _isMobileInternalServerMessage(m) {
  const text = String(m?.content || m?.body?.text || '').trim();
  const label = String(m?.channelLabel || m?.channel || m?.source || m?.body?.source || '').toLowerCase();
  return m?.sideChatBoundary === true
    || label === 'internal_watch'
    || /^\[Internal watch\b/i.test(text)
    || (_isMobileRestartContextPacketText(m?.content) && !Array.isArray(m?.fileChanges?.files));
}

function _mapServerHistoryToMobile(history) {
  const mapped = (Array.isArray(history) ? history : [])
    .filter((msg) => !_isMobileInternalServerMessage(msg))
    .map((msg, index) => _mapServerMessageToMobile(msg, index))
    .filter(Boolean);
  for (let index = 0; index < mapped.length; index += 1) {
    const message = mapped[index];
    const text = String(message?.body?.text || message?.content || '').trim();
    const entries = Array.isArray(message?.processEntries) ? message.processEntries : [];
    const recoveredTraceEntries = Array.isArray(message?.liveTraceEntries) && message.liveTraceEntries.length
      ? message.liveTraceEntries
      : entries;
    const hasRestartTool = entries.some((entry) => /prom_apply_dev_changes|gateway_restart/i.test(String(entry?.toolName || entry?.extra?.toolName || entry?.content || '')));
    const longGoalTrace = entries.length >= 20 || Number(message?.workDurationMs || 0) >= 30_000;
    if (!/^Started main-chat goal mode\b/i.test(text) || (!hasRestartTool && !longGoalTrace)) continue;
    message.messageKind = 'goal_command_ack';
    message.processEntries = [];
    message.liveTraceEntries = undefined;
    message.workStartedAt = undefined;
    message.workEndedAt = undefined;
    message.workDurationMs = undefined;
    mapped.splice(index + 1, 0, {
      role: 'ai',
      messageKind: 'goal_restart_checkpoint',
      activeRunKind: 'main_chat_goal',
      agentRuntimeKind: 'main_chat_goal',
      timestamp: Number(message.timestamp || Date.now()) + 1,
      time: message.time || '',
      body: { sender: 'Prometheus', text: 'Recovered goal activity from before the gateway restart.' },
      content: 'Recovered goal activity from before the gateway restart.',
      processEntries: _mobileDurableReasoningEntries(entries),
      liveTraceEntries: _mobileDurableReasoningEntries(recoveredTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean)),
      streaming: false,
    });
    index += 1;
  }
  return mapped;
}

function _mapServerMessageToMobile(m, index = -1) {
  if (_isMobileInternalServerMessage(m)) return null;
  const serverLabel = String(m?.channelLabel || m?.channel || m?.source || '').trim().toLowerCase();
  const storedContent = String(m?.content || '');
  const isLegacyGoalRuntimePrompt = serverLabel === 'goal'
    && String(m?.role || '').toLowerCase() === 'user'
    && /^\s*\[Continuing toward active main-chat goal\]/i.test(storedContent);
  const legacyGoalRestart = isLegacyGoalRuntimePrompt
    && /Restart recovery checkpoint:|Interrupted by (?:prom_apply_dev_changes|gateway_restart|build_deploy)/i.test(storedContent);
  const role = isLegacyGoalRuntimePrompt ? 'ai' : _serverRoleToMobileRole(m?.role);
  const rawContent = isLegacyGoalRuntimePrompt
    ? (legacyGoalRestart ? 'Gateway restarted — goal continuing.' : 'Goal continuing.')
    : storedContent;
  const content = role === 'user' ? _stripMobileInternalUploadContext(rawContent) : rawContent;
  const attachmentPreviews = Array.isArray(m?.attachmentPreviews) ? m.attachmentPreviews : [];
  return {
    role,
    messageId: String(m?.messageId || '').trim() || undefined,
    messageKind: isLegacyGoalRuntimePrompt
      ? (legacyGoalRestart ? 'goal_restart_notice' : 'goal_continuation_notice')
      : (String(m?.messageKind || '').trim() || undefined),
    activeRunKind: String(m?.activeRunKind || '').trim() || undefined,
    agentRuntimeKind: String(m?.activeRunKind || '').trim() || undefined,
    goalId: String(m?.goalId || '').trim() || undefined,
    goalTurnNumber: Number.isFinite(Number(m?.goalTurnNumber)) ? Number(m.goalTurnNumber) : undefined,
    goalIterationNumber: Number.isFinite(Number(m?.goalIterationNumber)) ? Number(m.goalIterationNumber) : undefined,
    goalTurnId: String(m?.goalTurnId || '').trim() || undefined,
    _clientRequestId: String(m?._clientRequestId || m?.clientRequestId || '').trim() || undefined,
    sourceIndex: Number.isFinite(Number(index)) ? Number(index) : -1,
    timestamp: Number(m?.timestamp || Date.now()) || Date.now(),
    workStartedAt: Number(m?.workStartedAt || 0) || undefined,
    workEndedAt: Number(m?.workEndedAt || 0) || undefined,
    workDurationMs: Number.isFinite(Number(m?.workDurationMs)) ? Number(m.workDurationMs) : undefined,
    time: m?.timestamp ? _formatChatTime(m.timestamp) : '',
    body: {
      sender: role === 'user' ? '' : 'Prometheus',
      text: content,
      attachments: attachmentPreviews,
      selectedSkillRefs: _pmNormalizeSelectedComposerSkillRefs(m?.body?.selectedSkillRefs || m?.selectedSkillRefs || m?.selectedSkills),
    },
    content,
    selectedSkillRefs: _pmNormalizeSelectedComposerSkillRefs(m?.body?.selectedSkillRefs || m?.selectedSkillRefs || m?.selectedSkills),
    attachmentPreviews,
    _promptVariants: Array.isArray(m?._promptVariants) ? m._promptVariants : undefined,
    _promptVariantActive: Number.isFinite(Number(m?._promptVariantActive)) ? Number(m._promptVariantActive) : undefined,
    generatedImages: Array.isArray(m?.generatedImages) ? m.generatedImages : [],
    generatedVideos: Array.isArray(m?.generatedVideos) ? m.generatedVideos : [],
    artifacts: Array.isArray(m?.artifacts) ? m.artifacts : [],
    // Live delivery/present_file events store normalized media in files/body.files,
    // while gateway-finalized turns may use canvasFiles. Restore every durable
    // descriptor source after a cold load instead of only canvasFiles.
    files: _dedupeMobileMediaList(_normalizeMobileMediaList([
      ...(Array.isArray(m?.canvasFiles) ? m.canvasFiles : []),
      ...(Array.isArray(m?.files) ? m.files : []),
      ...(Array.isArray(m?.body?.files) ? m.body.files : []),
    ])),
    fileChanges: m?.fileChanges && typeof m.fileChanges === 'object' ? m.fileChanges : undefined,
    productCarousel: m?.productCarousel && typeof m.productCarousel === 'object' ? m.productCarousel : undefined,
    richArtifacts: Array.isArray(m?.richArtifacts) && m.richArtifacts.length ? m.richArtifacts : undefined,
    goalCompletionReport: m?.goalCompletionReport && typeof m.goalCompletionReport === 'object' ? m.goalCompletionReport : undefined,
    voiceWorkgroup: m?.voiceWorkgroup && typeof m.voiceWorkgroup === 'object' ? _normalizeMobileVoiceWorkgroup(m.voiceWorkgroup) : undefined,
    voiceSpeaker: String(m?.voiceSpeaker || '').trim() || undefined,
    voiceTargetKey: String(m?.voiceTargetKey || '').trim() || undefined,
    questionRequest: m?.questionRequest && typeof m.questionRequest === 'object' ? m.questionRequest : undefined,
    sideChatBoundary: m?.sideChatBoundary === true,
    voiceAgentWorkerHandoff: m?.voiceAgentWorkerHandoff === true,
    source: String(m?.source || ''),
    channel: String(m?.channel || ''),
    channelLabel: String(m?.channelLabel || ''),
    origin: m?.origin && typeof m.origin === 'object' ? {
      channel: String(m.origin.channel || '').trim(),
      surface: String(m.origin.surface || '').trim() || undefined,
      device: String(m.origin.device || '').trim() || undefined,
      label: String(m.origin.label || '').trim() || undefined,
      source: String(m.origin.source || '').trim() || undefined,
    } : undefined,
    workflowGroupId: String(m?.workflowGroupId || '').trim() || undefined,
    workflowPart: String(m?.workflowPart || '').trim() || undefined,
    workflowLabel: String(m?.workflowLabel || ''),
    voiceInterruptionEventId: String(m?.voiceInterruptionEventId || '').trim() || undefined,
    processEntries: Array.isArray(m?.processEntries)
      ? _mobileDurableReasoningEntries(m.processEntries.map(_normalizeMobileProcessEntry).filter(Boolean))
      : [],
    liveTraceEntries: Array.isArray(m?.liveTraceEntries) && m.liveTraceEntries.length
      ? _mobileDurableReasoningEntries(m.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean))
      : undefined,
    _pmBackgroundImageGeneration: m?._pmBackgroundImageGeneration === true || undefined,
  };
}

function _reconcileMobilePushSubscriptionSilently() {
  if (!getDeviceToken()) return;
  reconcileMobileChatPushNotifications({ requestPermission: false, sendTest: false })
    .then(() => _refreshMobileChatPushButton())
    .catch(() => _refreshMobileChatPushButton());
}

if (!window.__pmMobilePushRepairInstalled) {
  window.__pmMobilePushRepairInstalled = true;
  window.addEventListener('pageshow', _reconcileMobilePushSubscriptionSilently);
  window.addEventListener('online', _reconcileMobilePushSubscriptionSilently);
  wsEventBus?.on?.('ws:open', _reconcileMobilePushSubscriptionSilently);
  setTimeout(_reconcileMobilePushSubscriptionSilently, 1200);
}

function _cloneMobileMessageForBranch(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const clone = JSON.parse(JSON.stringify(msg));
  delete clone.streaming;
  delete clone.liveTraceEntries;
  delete clone.finalResponseStarted;
  delete clone.toolActivityStarted;
  delete clone.agentExecutionMode;
  delete clone._editingDraft;
  return clone;
}

function _mobileMessageCopyText(msg) {
  const text = String(msg?.content || msg?.body?.text || '').trim();
  return msg?.role === 'user' ? _stripMobileInternalUploadContext(text) : text;
}

function _mobileMessageStableFingerprint(msg) {
  if (!msg || (msg.role !== 'user' && msg.role !== 'ai')) return '';
  const role = String(msg.role || '');
  const text = _mobileMessageCopyText(msg)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text) return '';
  const attachments = [
    ...(Array.isArray(msg.attachmentPreviews) ? msg.attachmentPreviews : []),
    ...(Array.isArray(msg.body?.attachments) ? msg.body.attachments : []),
  ]
    .map((item) => String(item?.workspacePath || item?.path || item?.filePath || item?.name || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  return `${role}|${text}|${attachments}`;
}

function _pruneMobileRoleGroupedDuplicateTail(thread) {
  const list = Array.isArray(thread) ? thread : [];
  if (list.length < 4) return list;
  let end = list.length - 1;
  while (end >= 0 && !(list[end]?.role === 'user' || list[end]?.role === 'ai')) end -= 1;
  if (end < 2) return list;
  const tailRole = list[end]?.role;
  let start = end;
  while (start > 0 && list[start - 1]?.role === tailRole) start -= 1;
  const tailLength = end - start + 1;
  if (tailLength < 2) return list;
  const earlier = new Set();
  for (let i = 0; i < start; i += 1) {
    const key = _mobileMessageStableFingerprint(list[i]);
    if (key) earlier.add(key);
  }
  if (!earlier.size) return list;
  let duplicateCount = 0;
  for (let i = start; i <= end; i += 1) {
    const key = _mobileMessageStableFingerprint(list[i]);
    if (key && earlier.has(key)) duplicateCount += 1;
  }
  if (duplicateCount < tailLength || duplicateCount < 2) return list;
  list.splice(start, tailLength);
  return list;
}

function _mobileThreadLooksRoleGrouped(thread) {
  const list = Array.isArray(thread) ? thread : [];
  const before = list.length;
  const clone = list.map((msg) => ({ ...msg }));
  _pruneMobileRoleGroupedDuplicateTail(clone);
  return clone.length < before;
}

function _reconcileMobileThreadOrder(thread) {
  const list = Array.isArray(thread) ? thread : [];
  _pruneMobileRoleGroupedDuplicateTail(list);
  _dedupeMobileAssistantTurns(list);
  // A recovery refresh can briefly return the completed assistant before the
  // matching user record. Stable request identity makes the intended pair
  // unambiguous, so restore user -> assistant ordering before rendering.
  for (let userIndex = 0; userIndex < list.length; userIndex += 1) {
    const user = list[userIndex];
    if (user?.role !== 'user') continue;
    const requestId = String(user._clientRequestId || '').trim();
    if (!requestId) continue;
    const assistantIndex = list.findIndex((message, index) => index < userIndex
      && _isMobileAssistantMessage(message)
      && String(message._clientRequestId || '').trim() === requestId);
    if (assistantIndex < 0) continue;
    list.splice(userIndex, 1);
    list.splice(assistantIndex, 0, user);
  }
  _repairMobileRealtimeExchangeOrder(list);
  _reindexMobileThread(list);
  return list;
}

function _isMobileChatSteerWorkflowGroup(groupId) {
  return /^chat_steer_/i.test(String(groupId || '').trim());
}

function _clearMobileChatSteerPresentation(message) {
  if (!message || typeof message !== 'object') return;
  delete message.workflowGroupId;
  delete message.workflowPart;
  delete message.workflowLabel;
  delete message.suppressWorkTimer;
  delete message._steerTimerAnchor;
  delete message._steerTimerAnchorTurn;
  delete message._steerFrozenTrace;
  if (String(message.messageKind || '') === 'steer_continuation') delete message.messageKind;
}

// A chat steer temporarily splits the in-flight response so the user can see
// its tool stream and the injected message separately. Once answer generation
// starts, that split has served its purpose: the durable conversation should
// read as two ordinary user messages followed by one assistant response.
function _settleMobileChatSteerWorkflow(thread, finalTurn) {
  const list = Array.isArray(thread) ? thread : [];
  const groupId = String(finalTurn?.workflowGroupId || '').trim();
  if (!list.length || !_isMobileChatSteerWorkflowGroup(groupId)) return false;

  let changed = false;
  const sourceTurns = new Set();
  let sourceTurn = finalTurn?._steerSourceTurn || null;
  while (sourceTurn && !sourceTurns.has(sourceTurn)) {
    sourceTurns.add(sourceTurn);
    sourceTurn = sourceTurn._steerSourceTurn || null;
  }
  const groupStart = list.findIndex((message) => String(message?.workflowGroupId || '') === groupId);
  const clientRequestId = String(finalTurn?._clientRequestId || '').trim();
  if (!sourceTurns.size && groupStart > 0 && clientRequestId) {
    for (let index = groupStart - 1; index >= 0; index -= 1) {
      const candidate = list[index];
      if (candidate?.role !== 'ai') continue;
      if (String(candidate._clientRequestId || '').trim() === clientRequestId) {
        sourceTurns.add(candidate);
        break;
      }
    }
  }

  const groupIds = new Set([groupId]);
  sourceTurns.forEach((turn) => {
    const sourceGroupId = String(turn?.workflowGroupId || '').trim();
    if (_isMobileChatSteerWorkflowGroup(sourceGroupId)) groupIds.add(sourceGroupId);
  });
  const steerUser = list.find((message) => (
    message?.role === 'user'
    && groupIds.has(String(message.workflowGroupId || ''))
    && String(message.workflowPart || '') === 'interruption'
    // Voice interruptions keep their own dedicated timeline presentation.
    && !String(message.voiceInterruptionEventId || '').trim()
  ));
  if (!steerUser) return false;

  // The first split turn owns the one visible work timer. Carry that original
  // start time onto the eventual final response before removing the split.
  const timerAnchor = finalTurn?._steerTimerAnchorTurn
    || [...sourceTurns].find((turn) => turn?._steerTimerAnchor === true)
    || [...sourceTurns].at(-1)
    || null;
  const sourceStartedAt = _mobileAssistantWorkStartedAt(timerAnchor);
  const finalStartedAt = _mobileAssistantWorkStartedAt(finalTurn);
  if (sourceStartedAt > 0 && (!finalStartedAt || sourceStartedAt < finalStartedAt)) {
    finalTurn.workStartedAt = sourceStartedAt;
    const endedAt = Number(finalTurn.workEndedAt || 0);
    if (endedAt > 0) finalTurn.workDurationMs = Math.max(0, endedAt - sourceStartedAt);
    changed = true;
  }

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const isTemporaryTrace = message?.role === 'ai'
      && groupIds.has(String(message.workflowGroupId || ''))
      && String(message.workflowPart || '') === 'before_interruption';
    if (sourceTurns.has(message) || isTemporaryTrace) {
      list.splice(index, 1);
      changed = true;
    }
  }

  for (const message of list) {
    if (!groupIds.has(String(message?.workflowGroupId || ''))) continue;
    _clearMobileChatSteerPresentation(message);
    changed = true;
  }
  return changed;
}

function _isMobileVoiceAgentWorkerHandoff(msg) {
  const label = String(msg?.channelLabel || msg?.source || msg?.body?.source || '').toLowerCase();
  return msg?.voiceAgentWorkerHandoff === true
    || label.includes('voice agent handoff')
    || label.includes('realtime agent dispatch');
}

function _isMobileVoiceTraceTurn(msg) {
  if (!msg || msg.role !== 'ai') return false;
  if (msg._voiceWorkerLocalTurn === true || msg._voiceWorkerLocalFinal === true) return true;
  if (msg.voiceRealtimeActive === true || msg.voiceInterruptionEventId) return true;
  const source = [
    msg.source,
    msg.channel,
    msg.channelLabel,
    msg.body?.source,
    msg.metadata?.source,
    msg.metadata?.channel,
    msg.metadata?.channelLabel,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
  return /\bvoice\b/.test(source) || source.includes('voice_agent') || source.includes('realtime_agent');
}

function _normalizeMobileVoiceWorkerHandoffText(value) {
  return _stripMobileInternalUploadContext(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function _findMobileVoiceWorkerHandoffByText(thread, text, timestamp = 0) {
  const target = _normalizeMobileVoiceWorkerHandoffText(text);
  if (!target || !Array.isArray(thread)) return null;
  const ts = Number(timestamp || 0);
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (!msg || msg.role !== 'user' || !_isMobileVoiceAgentWorkerHandoff(msg)) continue;
    const candidate = _normalizeMobileVoiceWorkerHandoffText(_mobileMessageCopyText(msg));
    if (!candidate || candidate !== target) continue;
    const msgTs = Number(msg.timestamp || 0);
    if (ts > 0 && msgTs > 0 && Math.abs(msgTs - ts) > 120000) continue;
    return msg;
  }
  return null;
}

function _promoteMobileVoiceWorkerHandoffMessage(target, source) {
  if (!target || !source) return target;
  const text = _mobileMessageCopyText(target);
  target.voiceAgentWorkerHandoff = true;
  target.source = String(source.source || 'realtime_agent_dispatch');
  target.channelLabel = String(source.channelLabel || 'Voice Agent handoff');
  if (!target.body || typeof target.body !== 'object') target.body = { text };
  target.body.text = String(target.body.text || text);
  target.body.source = String(source.body?.source || target.source);
  return target;
}

function _isMobileHiddenVoiceDraftMessage(msg, index = -1) {
  const text = _mobileMessageCopyText(msg);
  const isDraftText = /^Mobile voice chat$/i.test(text)
    || (Number(index) <= 1 && /^New Chat$/i.test(text));
  return isDraftText
    && !Array.isArray(msg?.body?.attachments)
    && !Array.isArray(msg?.attachmentPreviews);
}

function _isMobileGoalStartAcknowledgementText(value) {
  return /^(?:Started|Resumed|Revised and resumed) main-chat goal\b/i.test(String(value || '').trim());
}

function _isMobileGoalStartAcknowledgement(msg) {
  return String(msg?.messageKind || '').trim() === 'goal_command_ack'
    && _isMobileGoalStartAcknowledgementText(_mobileMessageCopyText(msg));
}

function _isMobileHiddenTranscriptMessage(msg, index = -1) {
  return _isMobileHiddenVoiceDraftMessage(msg, index)
    || _isMobileGoalStartAcknowledgement(msg);
}

function _isMobileMessagePersistable(msg) {
  if (!msg || (msg.role !== 'user' && msg.role !== 'ai')) return false;
  if (msg.role !== 'ai') return true;
  if (msg.streaming !== true) return true;
  const hasAnswer = _mobileAssistantHasVisibleAnswer(msg);
  const hasEnded = Number(msg.workEndedAt || 0) > 0 || Number.isFinite(Number(msg.workDurationMs));
  return hasAnswer && hasEnded;
}

function _mobileHistoryForServer(thread = _activeMobileThread()) {
  return (Array.isArray(thread) ? thread : [])
    .filter((msg, index) => msg && (msg.role === 'user' || msg.role === 'ai') && !_isMobileHiddenVoiceDraftMessage(msg, index))
    .filter(_isMobileMessagePersistable)
    .filter((msg) => msg._voiceWorkerLocalTurn !== true && msg._voiceWorkerLocalFinal !== true)
    .filter((msg) => !_isMobileRestartContextPacketText(_mobileMessageCopyText(msg)))
    .filter((msg) => !msg._isRestartNotification)
    .map((msg) => {
      const clone = _cloneMobileMessageForBranch(msg) || {};
      const content = _mobileMessageCopyText(msg);
      const attachmentPreviews = Array.isArray(msg.attachmentPreviews)
        ? msg.attachmentPreviews.map(_sanitizeMobileAttachmentPreviewForServer)
        : (Array.isArray(msg.body?.attachments) ? msg.body.attachments.map(_sanitizeMobileAttachmentPreviewForServer) : undefined);
      const body = clone.body && typeof clone.body === 'object'
        ? {
            ...clone.body,
            text: String(clone.body.text || content),
            attachments: Array.isArray(attachmentPreviews) && attachmentPreviews.length ? attachmentPreviews : undefined,
            files: _sanitizeMobileDurableMediaList(clone.body.files),
          }
        : undefined;
      const processEntries = _mobileDurableReasoningEntries(msg.processEntries);
      const liveTraceEntries = _mobileDurableReasoningEntries(msg.liveTraceEntries);
      return {
        ...clone,
        role: _mobileRoleToServerRole(msg.role),
        content,
        body,
        timestamp: Number(msg.timestamp) || Date.now(),
        attachmentPreviews,
        files: _sanitizeMobileDurableMediaList(clone.files),
        generatedImages: _sanitizeMobileDurableMediaList(clone.generatedImages),
        generatedVideos: _sanitizeMobileDurableMediaList(clone.generatedVideos),
        artifacts: _sanitizeMobileDurableMediaList(clone.artifacts),
        processEntries: processEntries.length ? processEntries : undefined,
        liveTraceEntries: liveTraceEntries.length ? liveTraceEntries : undefined,
      };
    })
    // A realtime Voice show_ui card can intentionally have no text bubble.
    // It is still a durable chat turn and must survive history replacement.
    .filter((msg) => msg.content.trim() || (Array.isArray(msg.richArtifacts) && msg.richArtifacts.length))
    .map((msg, index) => ({ ...msg, sourceIndex: index }));
}

const _mobileVisualStateSyncTimers = new Map();

function _persistMobileVisualArtifactState(visualId, state) {
  const id = String(visualId || '').trim();
  const sid = String(__pmChat.activeSessionId || '').trim();
  const thread = Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [];
  if (!id || !sid || !state || typeof state !== 'object') return;
  let artifact = null;
  for (const message of thread) {
    artifact = Array.isArray(message?.richArtifacts)
      ? message.richArtifacts.find((item) => item?.type === 'visual' && String(item.id || '') === id)
      : null;
    if (artifact) break;
  }
  if (!artifact) return;
  const nextState = JSON.parse(JSON.stringify(state));
  if (JSON.stringify(artifact.state || {}) === JSON.stringify(nextState)) return;
  artifact.state = nextState;
  artifact.stateUpdatedAt = Date.now();
  _saveMobileThreadCache(sid, thread);
  const prior = _mobileVisualStateSyncTimers.get(sid);
  if (prior) clearTimeout(prior);
  _mobileVisualStateSyncTimers.set(sid, setTimeout(() => {
    _mobileVisualStateSyncTimers.delete(sid);
    updateMobileChatSessionHistory(sid, _mobileHistoryForServer(thread), { originReason: 'visual_state' }).catch(() => {});
  }, 450));
}

if (typeof window !== 'undefined' && !window.__PROM_MOBILE_VISUAL_STATE_LISTENER__) {
  window.__PROM_MOBILE_VISUAL_STATE_LISTENER__ = true;
  window.addEventListener('prometheus:visual-state-change', (event) => {
    _persistMobileVisualArtifactState(event?.detail?.visualId, event?.detail?.state);
  });
}

function _isMobileMessageCacheable(msg) {
  if (_isMobileMessagePersistable(msg)) return true;
  if (!msg || msg.role !== 'ai' || msg.streaming !== true) return false;
  return !!(
    String(msg.body?.text || msg.content || '').trim()
    || (Array.isArray(msg.processEntries) && msg.processEntries.length)
    || (Array.isArray(msg.liveTraceEntries) && msg.liveTraceEntries.length)
  );
}

function _sanitizeMobileDurableMediaList(value) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    const durablePath = _mobileMediaPath(next);
    if (durablePath) {
      // The canvas endpoint streams this path on demand. Keeping the same image
      // as base64 in session JSON makes chat hydration unnecessarily enormous.
      delete next.dataUrl;
      delete next.base64;
      delete next.raw;
      delete next.buffer;
    }
    return next;
  });
}

function _sanitizeMobileAttachmentPreviewForServer(attachment) {
  if (!attachment || typeof attachment !== 'object') return attachment;
  const next = { ...attachment };
  delete next.file;
  if (next.base64) {
    delete next.base64;
    next.hasInlineData = true;
  }
  const dataUrl = String(next.dataUrl || '').trim();
  if (dataUrl && dataUrl.length > 30000) {
    delete next.dataUrl;
    next.hasPreview = true;
    next.previewTruncated = true;
  }
  const hasDurablePath = !!String(next.workspacePath || next.path || next.filePath || '').trim();
  if (hasDurablePath) {
    delete next.dataUrl;
  }
  return next;
}

function _reindexMobileThread(thread = _activeMobileThread()) {
  (Array.isArray(thread) ? thread : []).forEach((msg, index) => {
    if (msg && typeof msg === 'object') msg.sourceIndex = index;
  });
}

function _isMobileAssistantMessage(msg) {
  return msg?.role === 'ai';
}

function _findMobileAssistantResponseIndex(thread, userIndex) {
  const list = Array.isArray(thread) ? thread : [];
  for (let i = userIndex + 1; i < list.length; i += 1) {
    const msg = list[i];
    if (!msg) continue;
    if (msg.role === 'user') return -1;
    if (_isMobileAssistantMessage(msg)) return i;
  }
  return -1;
}

function _makeMobilePromptVariantFromTimeline(userIndex, thread = _activeMobileThread()) {
  const user = _cloneMobileMessageForBranch(thread[userIndex]);
  if (!user) return null;
  const assistantIndex = _findMobileAssistantResponseIndex(thread, userIndex);
  const assistant = assistantIndex >= 0 ? _cloneMobileMessageForBranch(thread[assistantIndex]) : null;
  const tailStart = assistantIndex >= 0 ? assistantIndex + 1 : userIndex + 1;
  const tail = thread.slice(tailStart).map(_cloneMobileMessageForBranch).filter(Boolean);
  return { user, assistant, tail };
}

function _getMobilePromptVariants(userIndex) {
  const msg = _activeMobileThread()[userIndex];
  return Array.isArray(msg?._promptVariants) ? msg._promptVariants : [];
}

function _getMobilePromptVariantActiveIndex(userIndex) {
  const variants = _getMobilePromptVariants(userIndex);
  const raw = Number(_activeMobileThread()[userIndex]?._promptVariantActive);
  if (!variants.length) return -1;
  return Number.isFinite(raw) ? Math.max(0, Math.min(Math.floor(raw), variants.length - 1)) : 0;
}

function _saveActiveMobilePromptVariant(userIndex) {
  const thread = _activeMobileThread();
  const msg = thread[userIndex];
  const variants = Array.isArray(msg?._promptVariants) ? msg._promptVariants : null;
  if (!variants || !variants.length) return variants || [];
  const activeIndex = _getMobilePromptVariantActiveIndex(userIndex);
  const current = _makeMobilePromptVariantFromTimeline(userIndex, thread);
  if (current) variants[activeIndex] = current;
  msg._promptVariants = variants;
  msg._promptVariantActive = activeIndex;
  return variants;
}

function _ensureMobilePromptVariantsForEdit(userIndex) {
  const thread = _activeMobileThread();
  const msg = thread[userIndex];
  if (!msg || msg.role !== 'user') return null;
  if (Array.isArray(msg._promptVariants) && msg._promptVariants.length) {
    _saveActiveMobilePromptVariant(userIndex);
    return msg._promptVariants;
  }
  const original = _makeMobilePromptVariantFromTimeline(userIndex, thread);
  msg._promptVariants = original ? [original] : [];
  msg._promptVariantActive = 0;
  return msg._promptVariants;
}

function _attachMobilePromptVariantsToUserMessage(user, variants, activeIndex) {
  const next = _cloneMobileMessageForBranch(user) || { role: 'user', body: { text: '' }, time: _nowTime(), timestamp: Date.now() };
  next._promptVariants = variants;
  next._promptVariantActive = activeIndex;
  return next;
}

function _makeMobileUserMessage(text, attachments = [], options = {}) {
  const content = _stripMobileInternalUploadContext(text);
  const attachmentPreviews = Array.isArray(attachments) ? attachments.map(_sanitizeMobileAttachmentPreviewForServer) : [];
  const selectedSkillRefs = _pmNormalizeSelectedComposerSkillRefs(options.selectedSkillRefs || options.selectedSkills);
  return {
    role: 'user',
    time: _nowTime(),
    timestamp: Date.now(),
    body: { text: content, attachments, selectedSkillRefs },
    content,
    selectedSkillRefs,
    attachmentPreviews,
  };
}

function _generateMobileSideChatId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `side_mobile_${Date.now().toString(36)}_${rand}`;
}

function _normalizeMobileSideChatLink(link) {
  const id = String(link?.id || '').trim();
  const parentSessionId = String(link?.parentSessionId || '').trim();
  if (!id || !parentSessionId) return null;
  return {
    id,
    parentSessionId,
    title: String(link?.title || 'Side chat').trim() || 'Side chat',
    anchorPreview: String(link?.anchorPreview || '').trim(),
    createdAt: Number(link?.createdAt || Date.now()),
    updatedAt: Number(link?.updatedAt || Date.now()),
    closed: link?.closed === true,
  };
}

function _loadMobileSideChatLinks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_MOBILE_SIDE_CHAT_LINKS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(_normalizeMobileSideChatLink).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function _saveMobileSideChatLinks(links) {
  try {
    localStorage.setItem(PM_MOBILE_SIDE_CHAT_LINKS_KEY, JSON.stringify((Array.isArray(links) ? links : []).map(_normalizeMobileSideChatLink).filter(Boolean)));
  } catch {}
}

function _getMobileSideChatLinksForParent(parentSessionId) {
  const parent = String(parentSessionId || '').trim();
  if (!parent) return [];
  return _loadMobileSideChatLinks()
    .filter((link) => link.parentSessionId === parent && link.closed !== true)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function _makeMobileSideChatTitle(seed = '') {
  const text = String(seed || '').replace(/\s+/g, ' ').trim();
  return text ? `Side chat - ${text.slice(0, 52)}` : 'Side chat';
}

function _mobileSideReferenceSnapshot(parentThread = []) {
  const visible = (Array.isArray(parentThread) ? parentThread : [])
    .filter((msg, index) => msg && !_isMobileHiddenTranscriptMessage(msg, index))
    .filter((msg) => msg.role === 'user' || msg.role === 'ai')
    .slice(-8);
  return visible.map((msg) => {
    const label = msg.role === 'user' ? 'User' : 'Prometheus';
    return `${label}: ${_mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim().slice(0, 420)}`;
  }).filter(Boolean);
}

function _buildMobileSideChatBoundaryMessage(parentSessionId, parentThread = [], parentTitle = 'Mobile chat') {
  const reference = _mobileSideReferenceSnapshot(parentThread);
  return {
    role: 'ai',
    time: _nowTime(),
    timestamp: Date.now(),
    sideChatBoundary: true,
    content: [
      '[Side chat boundary]',
      `Parent chat: ${parentTitle || parentSessionId}`,
      'Inherited parent context is reference only.',
      'Do not continue old plans, edits, tool calls, approvals, or implementation work from the parent unless the user explicitly asks in this side chat.',
      reference.length ? 'Reference snapshot:' : '',
      ...reference.map((line) => `- ${line}`),
      '[/Side chat boundary]',
    ].filter(Boolean).join('\n'),
    body: { sender: 'Prometheus', text: '' },
  };
}

function _rememberMobileActiveRun(sessionId, state = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    const runs = JSON.parse(localStorage.getItem(PM_MOBILE_ACTIVE_RUNS_KEY) || '{}') || {};
    const prev = runs[sid] || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(state || {}, key);
    const entry = {
      sessionId: sid,
      startedAt: Number(state.startedAt || prev.startedAt || Date.now()),
      updatedAt: Date.now(),
      disconnected: has('disconnected') ? state.disconnected === true : prev.disconnected === true,
      streamId: has('streamId') ? String(state.streamId || '') : String(prev.streamId || ''),
      runtimeId: has('runtimeId') ? String(state.runtimeId || '') : String(prev.runtimeId || ''),
      clientRequestId: has('clientRequestId') ? String(state.clientRequestId || '') : String(prev.clientRequestId || ''),
      lastSeq: has('lastSeq')
        ? Math.max(0, Math.floor(Number(state.lastSeq || 0)) || 0)
        : Math.max(0, Math.floor(Number(prev.lastSeq || 0)) || 0),
    };
    runs[sid] = entry;
    localStorage.setItem(PM_MOBILE_ACTIVE_RUNS_KEY, JSON.stringify(runs));
    localStorage.setItem(PM_MOBILE_ACTIVE_RUN_KEY, JSON.stringify(entry));
  } catch {}
}

function _readMobileActiveRun(sessionId = '') {
  try {
    const sid = String(sessionId || '').trim();
    const runs = JSON.parse(localStorage.getItem(PM_MOBILE_ACTIVE_RUNS_KEY) || '{}') || {};
    if (sid && runs[sid]?.sessionId) return runs[sid];
    const raw = JSON.parse(localStorage.getItem(PM_MOBILE_ACTIVE_RUN_KEY) || 'null');
    if (!raw || !raw.sessionId) return null;
    if (sid && String(raw.sessionId || '') !== sid) return null;
    return raw;
  } catch {
    return null;
  }
}

function _clearMobileActiveRun(sessionId = '') {
  try {
    const sid = String(sessionId || '').trim();
    const runs = JSON.parse(localStorage.getItem(PM_MOBILE_ACTIVE_RUNS_KEY) || '{}') || {};
    if (sid) delete runs[sid];
    else Object.keys(runs).forEach((key) => delete runs[key]);
    localStorage.setItem(PM_MOBILE_ACTIVE_RUNS_KEY, JSON.stringify(runs));
    const current = _readMobileActiveRun();
    if (!sid || !current || String(current.sessionId || '') === sid) {
      localStorage.removeItem(PM_MOBILE_ACTIVE_RUN_KEY);
    }
  } catch {}
}

const PM_MOBILE_MAX_QUEUED_PROMPTS = 8;

const _getMobileQueuedPrompts = mobileChatRuntimeAdapter.queue;

function _moveMobileQueuedPromptToComposer(sessionId, index) {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  const queue = _getMobileQueuedPrompts(sid);
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
  const item = queue.splice(index, 1)[0] || {};
  try { window.__pmMobileOpenChatComposer?.({ reason: 'queued-prompt' }); } catch {}
  const input = document.getElementById('pm-composer-input');
  if (input) {
    pmSelectedComposerSkillIds = _pmNormalizeSelectedSkillIds(item.selectedSkillIds || item.forcedSkillIds || item.matchedSkillIds);
    pmSelectedComposerSkills = _pmNormalizeSelectedComposerSkillRefs(item.selectedSkillRefs || item.selectedSkills);
    input.value = String(item.message || '').trim();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
  }
  _renderMobileQueuedPromptsPanel(sid);
}

function _setMobileChatSteerContinuationTurn(sourceTurn, continuationTurn) {
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

function _persistMobileChatSteerSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  const thread = sid ? __pmChat.threads?.[sid] : null;
  if (!sid || !Array.isArray(thread)) return Promise.resolve(false);
  mobileChatRuntimeAdapter.sync(sid, { history: thread, source: 'mobile-steer-persist' });
  const history = _mobileHistoryForServer(thread);
  const previous = mobileChatSteerSnapshotWriteQueues.get(sid) || Promise.resolve(true);
  const write = previous.catch(() => false)
    .then(() => updateMobileChatSessionHistory(sid, history))
    .then(() => true)
    .catch((err) => {
      console.warn('[mobile chat] failed to persist steer state:', err);
      return false;
    });
  mobileChatSteerSnapshotWriteQueues.set(sid, write);
  write.finally(() => {
    if (mobileChatSteerSnapshotWriteQueues.get(sid) === write) mobileChatSteerSnapshotWriteQueues.delete(sid);
  });
  return write;
}

function _appendMobileQueuedSteerTurn(sessionId, message, data = {}) {
  const sid = String(sessionId || '').trim();
  const text = String(message || '').trim();
  const thread = sid ? __pmChat.threads?.[sid] : null;
  if (!sid || !text || !Array.isArray(thread)) return false;
  const latestAi = _findLatestAssistantTurn(thread);
  const workflowGroupId = `chat_steer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (latestAi) {
    _appendMobileProcess(latestAi, 'info', `Chat steer: ${text.slice(0, 180)}`, {
      actor: 'Chat Steer',
      eventId: data?.eventId || data?.steerEventId || '',
      runtimeId: data?.runtimeId || data?.activeRun?.id || '',
    });
    // Freeze the already-rendered stream in place. Future runtime events are
    // routed to the continuation below, so the second trace contains only
    // work performed after this steer.
    const timerAnchor = latestAi._steerTimerAnchorTurn || latestAi;
    if (timerAnchor === latestAi) latestAi._steerTimerAnchor = true;
    latestAi._steerTimerAnchorTurn = timerAnchor;
    latestAi._steerFrozenTrace = true;
    latestAi.workflowGroupId = workflowGroupId;
    latestAi.workflowPart = 'before_interruption';
    latestAi.workflowLabel = 'Tool stream before steer';
    if (latestAi !== timerAnchor && latestAi.streaming) {
      latestAi.streaming = false;
      latestAi.workEndedAt = Number(latestAi.workEndedAt || Date.now()) || Date.now();
      latestAi.workDurationMs = Math.max(0, latestAi.workEndedAt - _mobileAssistantWorkStartedAt(latestAi));
      latestAi.time = _nowTime();
      latestAi.timestamp = Number(latestAi.timestamp || Date.now()) || Date.now();
      latestAi.content = String(latestAi.body?.text || latestAi.content || '');
    }
  }
  thread.push({
    role: 'user',
    time: _nowTime(),
    timestamp: Date.now(),
    body: { text, source: 'mobile_queue_steer' },
    content: text,
    workflowGroupId,
    workflowPart: 'interruption',
    workflowLabel: 'Message sent as steer',
  });
  if (latestAi) {
    const continuationTurn = {
      role: 'ai',
      time: '',
      timestamp: Date.now(),
      streaming: true,
      workStartedAt: Date.now(),
      body: { sender: 'Prometheus', text: '' },
      content: '',
      processEntries: [],
      liveTraceEntries: [],
      agentExecutionMode: 'execute',
      suppressWorkTimer: true,
      _clientRequestId: latestAi._clientRequestId || data?.clientRequestId || '',
      workflowGroupId,
      workflowPart: 'interruption_response',
      workflowLabel: 'Response after steer',
    };
    thread.push(continuationTurn);
    _setMobileChatSteerContinuationTurn(latestAi, continuationTurn);
  }
  void _persistMobileChatSteerSnapshot(sid);
  const threadEl = document.getElementById('pm-chat-thread');
  const bodyEl = document.getElementById('pm-chat-body');
  if (threadEl && String(__pmChat.activeSessionId || '') === sid) {
    __pmChat.thread = thread;
    _commitMobileTranscriptCache(sid, 'mobile-steer-commit');
    _renderThread(threadEl);
    _scrollChat(bodyEl);
  }
  return true;
}

async function _steerMobileQueuedPrompt(sessionId, index) {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  const queue = _getMobileQueuedPrompts(sid);
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
  const item = queue[index] || {};
  const message = String(item.message || '').trim();
  if (!message) return;
  let localRun = __pmChat.activeRuns?.[sid] || null;
  if (!localRun?.busy) {
    const rememberedRun = _readMobileActiveRun(sid);
    if (rememberedRun) {
      localRun = _adoptMobileActiveRunState(sid, { fallback: rememberedRun });
    } else {
      const status = await loadMobileChatRunStatus(sid).catch(() => null);
      if (status?.active === true) {
        localRun = _adoptMobileActiveRunState(sid, { run: status.run || status.activeRun || null, stream: status.stream || null });
      }
    }
  }
  if (!localRun?.busy) {
    pmToast('No active run to steer. This prompt will run normally when the chat is idle.', 'info');
    return;
  }
  try {
    const files = Array.isArray(item.files) ? item.files : [];
    const uploadResults = files.length ? await _uploadMobileChatAttachments(files) : [];
    const steerMessage = `${message}${_buildMobileFileContextNote(uploadResults)}`;
    const result = await mobileGatewayFetch('/api/chat/steer', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sid,
        message: steerMessage,
        attachmentPreviews: files.map(_sanitizeMobileAttachmentPreviewForServer),
        source: 'mobile_queue_button',
      }),
    });
    queue.splice(index, 1);
    _renderMobileQueuedPromptsPanel(sid);
    _appendMobileQueuedSteerTurn(sid, message, result || {});
    pmToast(files.length ? 'Queued steer sent with files.' : 'Queued steer sent.', 'success');
  } catch (err) {
    const errorText = String(err?.message || err || '');
    if (/no active steerable chat turn/i.test(errorText)) {
      try { window.__pmMobileRecoverActiveChatRun?.(sid, { force: true, fullRefresh: false }); } catch {}
      pmToast('Prometheus is reconnecting the active turn. The queued prompt was kept.', 'info');
      return;
    }
    pmToast(`Steer failed: ${errorText}`, 'error');
  }
}

function _renderMobileQueuedPromptsPanel(sessionId = '') {
  const panel = document.getElementById('pm-mobile-queued-prompts');
  if (!panel) return;
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  const queue = _getMobileQueuedPrompts(sid);
  if (!queue.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    try { window.__pmMobileQueuedPromptsChanged?.(); } catch {}
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <div class="pm-mobile-queued-list">
      ${queue.map((item, index) => `
        <div class="pm-mobile-queued-item">
          <button type="button" class="pm-mobile-queued-text" data-edit-mobile-queued="${index}" aria-label="Edit queued prompt">${escapeHtml(String(item.message || 'Attached file(s)').slice(0, 140))}${Array.isArray(item.files) && item.files.length ? ` <em>+${item.files.length}</em>` : ''}</button>
          <div class="pm-mobile-queued-actions">
            <div class="pm-mobile-queued-menu-wrap">
              <button type="button" class="pm-mobile-queued-icon pm-mobile-queued-menu-trigger" data-toggle-mobile-queued-menu="${index}" aria-label="Queued prompt actions" title="Actions">${ICONS.dots}</button>
              <div class="pm-mobile-queued-popover" data-mobile-queued-menu="${index}" hidden>
                <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-steer" data-steer-mobile-queued="${index}">${ICONS.target}<span>Steer</span></button>
                <button type="button" class="pm-mobile-queued-menu-item pm-mobile-queued-remove" data-remove-mobile-queued="${index}">${ICONS.trash}<span>Delete</span></button>
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;
  _ensureMobileQueuedPromptMenuDismiss();
  panel.querySelectorAll('[data-edit-mobile-queued]').forEach((btn) => {
    attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-edit-mobile-queued'));
      _moveMobileQueuedPromptToComposer(sid, idx);
    });
  });
  panel.querySelectorAll('[data-toggle-mobile-queued-menu]').forEach((btn) => {
    attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-toggle-mobile-queued-menu'));
      _toggleMobileQueuedPromptMenu(panel, idx);
    });
  });
  panel.querySelectorAll('[data-steer-mobile-queued]').forEach((btn) => {
    attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-steer-mobile-queued'));
      _closeMobileQueuedPromptMenus(panel);
      _steerMobileQueuedPrompt(sid, idx);
    });
  });
  panel.querySelectorAll('[data-remove-mobile-queued]').forEach((btn) => {
    attachMobileButtonHaptic(btn, () => {
      const idx = Number(btn.getAttribute('data-remove-mobile-queued'));
      if (Number.isInteger(idx) && idx >= 0 && idx < queue.length) {
        queue.splice(idx, 1);
        _renderMobileQueuedPromptsPanel(sid);
      }
    });
  });
  try { window.__pmMobileQueuedPromptsChanged?.(); } catch {}
}

function _closeMobileQueuedPromptMenus(root = document) {
  root?.querySelectorAll?.('.pm-mobile-queued-popover:not([hidden])').forEach((menu) => {
    menu.hidden = true;
  });
}

function _toggleMobileQueuedPromptMenu(panel, index) {
  if (!Number.isInteger(index)) return;
  const menu = panel?.querySelector?.(`[data-mobile-queued-menu="${index}"]`);
  if (!menu) return;
  const nextOpen = !!menu.hidden;
  _closeMobileQueuedPromptMenus(panel);
  menu.hidden = !nextOpen;
}

function _ensureMobileQueuedPromptMenuDismiss() {
  if (document.body?.dataset.pmMobileQueuedMenuDismiss === '1') return;
  if (document.body) document.body.dataset.pmMobileQueuedMenuDismiss = '1';
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target?.closest?.('.pm-mobile-queued-menu-wrap')) return;
    _closeMobileQueuedPromptMenus(document);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') _closeMobileQueuedPromptMenus(document);
  });
}

function _findLatestAssistantTurn(thread) {
  const list = Array.isArray(thread) ? thread : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'ai') return list[i];
  }
  return null;
}

function _mobileHistoryHasCompletedTurnSince(history, startedAt = 0, options = {}) {
  if (String(options?.activeRunKind || '').trim() === 'main_chat_goal') return false;
  const list = Array.isArray(history) ? history : [];
  const start = Math.max(0, Number(startedAt || 0) || 0);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    const role = String(msg?.role || '').toLowerCase();
    if (role === 'user') return false;
    if (role !== 'assistant' && role !== 'ai') continue;
    const content = String(msg?.content || msg?.body?.text || '').trim();
    if (!content) continue;
    const ts = Math.max(0, Number(msg?.timestamp || msg?.workEndedAt || msg?.workStartedAt || 0) || 0);
    if (!start || !ts || ts >= start - 5000) return true;
  }
  return false;
}

function _mobileAssistantContentKey(msg) {
  if (!_isMobileAssistantMessage(msg)) return '';
  return _mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim().toLowerCase();
}

function _mobileAssistantRichnessScore(msg) {
  if (!msg || typeof msg !== 'object') return 0;
  return [
    Array.isArray(msg.processEntries) ? msg.processEntries.length : 0,
    Array.isArray(msg.liveTraceEntries) ? msg.liveTraceEntries.length : 0,
    Array.isArray(msg.generatedImages) ? msg.generatedImages.length : 0,
    Array.isArray(msg.generatedVideos) ? msg.generatedVideos.length : 0,
    Array.isArray(msg.files) ? msg.files.length : 0,
    Array.isArray(msg.artifacts) ? msg.artifacts.length : 0,
    Array.isArray(msg.productCarousel?.items) ? msg.productCarousel.items.length : 0,
    Array.isArray(msg.fileChanges?.files) ? msg.fileChanges.files.length : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function _mobileAssistantTurnIdentity(msg, index = -1, thread = null) {
  if (!_isMobileAssistantMessage(msg)) return '';
  const clientRequestId = String(msg?._clientRequestId || '').trim();
  if (clientRequestId) return `cid:${clientRequestId}`;
  const text = _mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim().toLowerCase();
  let prompt = '';
  if (Array.isArray(thread)) {
    for (let i = Math.min(Number(index) || 0, thread.length - 1) - 1; i >= 0; i -= 1) {
      if (String(thread[i]?.role || '') === 'user') {
        prompt = _mobileMessageCopyText(thread[i]).replace(/\s+/g, ' ').trim().toLowerCase();
        break;
      }
    }
  }
  if (prompt && text) return `prompt:${prompt.slice(0, 260)}|answer:${text.slice(0, 260)}`;
  if (text) return `answer:${text.slice(0, 360)}`;
  const startedAt = Number(msg?.workStartedAt || msg?.startedAt || msg?.timestamp || 0) || 0;
  return startedAt ? `started:${Math.round(startedAt / 1000)}` : '';
}

function _rememberMobileCompletedAssistantTurn(sessionId, message) {
  const sid = String(sessionId || '').trim();
  if (!sid || !_isMobileAssistantMessage(message)) return;
  const thread = __pmChat.threads?.[sid];
  const index = Array.isArray(thread) ? thread.indexOf(message) : -1;
  const key = _mobileAssistantTurnIdentity(message, index, thread);
  if (!key) return;
  if (!__pmChat.completedAssistantTurns || typeof __pmChat.completedAssistantTurns !== 'object') {
    __pmChat.completedAssistantTurns = {};
  }
  __pmChat.completedAssistantTurns[sid] = {
    key,
    at: Date.now(),
    turn: JSON.parse(JSON.stringify({
      ...message,
      streaming: false,
    })),
  };
}

function _findMobileCompletedTurn(...args) {
  return _mobileChatRendererInvoke('_findMobileCompletedTurn', args) || null;
}

function _mergeMobilePinnedCompletedTurn(sessionId, nextThread) {
  const sid = String(sessionId || '').trim();
  const pin = sid ? __pmChat.completedAssistantTurns?.[sid] : null;
  if (!pin?.turn || Date.now() - Number(pin.at || 0) > 30_000) return nextThread;
  const list = Array.isArray(nextThread) ? nextThread : [];
  const pinned = pin.turn;
  let best = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (!_isMobileAssistantMessage(msg)) continue;
    const key = _mobileAssistantTurnIdentity(msg, i, list);
    if (key && key === pin.key) {
      best = i;
      break;
    }
    const msgText = _mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim();
    const pinText = _mobileMessageCopyText(pinned).replace(/\s+/g, ' ').trim();
    if (msgText && pinText && msgText === pinText) {
      best = i;
      break;
    }
  }
  if (best >= 0) {
    _mergeMobileAssistantTurnDetails(list[best], pinned);
    list[best].streaming = false;
    return list;
  }
  list.push(pinned);
  return list;
}

function _mergeMobileAssistantTurnDetails(target, source) {
  if (!target || !source || target === source) return target;
  const mergeList = (key) => {
    const existing = Array.isArray(target[key]) ? target[key] : [];
    const incoming = Array.isArray(source[key]) ? source[key] : [];
    if (!incoming.length) return;
    target[key] = existing.slice();
    const keyFor = (item) => {
      if (!item || typeof item !== 'object') return '';
      const extra = item.extra && typeof item.extra === 'object' ? item.extra : {};
      const eventKey = String(
        item.eventKey
          || extra.eventKey
          || ((extra.streamId || item.streamId) && (extra.seq ?? item.seq) !== undefined
            ? `${extra.streamId || item.streamId}:${extra.seq ?? item.seq}`
            : ''),
      ).trim();
      if (eventKey) return `event:${eventKey}`;
      const callId = String(
        item.callId
          || item.toolCallId
          || extra.callId
          || extra.call_id
          || extra.toolCallId
          || extra.tool_call_id
          || item.activity?.callId
          || item.activity?.activityId
          || '',
      ).trim();
      const type = String(item.type || item.kind || '').toLowerCase();
      const action = String(item.action || item.toolName || extra.action || extra.toolName || item.activity?.action || '').trim().toLowerCase();
      const text = String(item.text || item.content || item.message || '').replace(/\s+/g, ' ').trim();
      const preview = String(item.preview?.dataUrl || item.dataUrl || '').slice(0, 120);
      if (!callId && !action && !text && !preview) return '';
      return `${type}|${callId}|${action}|${text}|${preview}`;
    };
    const positions = new Map();
    target[key].forEach((item, index) => {
      const itemKey = keyFor(item);
      if (itemKey && !positions.has(itemKey)) positions.set(itemKey, index);
    });
    incoming.forEach((item) => {
      const itemKey = keyFor(item);
      const existingIndex = itemKey ? positions.get(itemKey) : undefined;
      if (existingIndex !== undefined) {
        const prior = target[key][existingIndex];
        const priorText = String(prior?.text || prior?.content || '').trim();
        const incomingText = String(item?.text || item?.content || '').trim();
        target[key][existingIndex] = {
          ...prior,
          ...item,
          ...(priorText.length > incomingText.length ? { text: prior.text } : {}),
          ...(prior?.extra || item?.extra ? { extra: { ...(prior?.extra || {}), ...(item?.extra || {}) } } : {}),
        };
      } else {
        if (itemKey) positions.set(itemKey, target[key].length);
        target[key].push(item);
      }
    });
  };
  mergeList('processEntries');
  mergeList('liveTraceEntries');
  mergeList('generatedImages');
  mergeList('generatedVideos');
  mergeList('files');
  mergeList('artifacts');
  _mergeMobileMediaIntoMessage(target, _collectMessageMedia(source));
  _mergeMobileProductCarouselIntoMessage(target, source.productCarousel);
  _mergeMobileRichArtifacts(target, source.richArtifacts);
  if (!target.fileChanges && source.fileChanges) target.fileChanges = source.fileChanges;
  if (!target.approvalRequest && source.approvalRequest) target.approvalRequest = source.approvalRequest;
  if (!target.questionRequest && source.questionRequest && !_mobileQuestionIsResolved(source.questionRequest.id)) {
    target.questionRequest = source.questionRequest;
  }
  if (!target.goalCompletionReport && source.goalCompletionReport) target.goalCompletionReport = source.goalCompletionReport;
  if (!String(target._clientRequestId || '').trim() && String(source._clientRequestId || '').trim()) {
    target._clientRequestId = String(source._clientRequestId).trim();
  }
  if (!String(target.messageKind || '').trim() && String(source.messageKind || '').trim()) target.messageKind = source.messageKind;
  if (!String(target.workflowGroupId || '').trim() && String(source.workflowGroupId || '').trim()) target.workflowGroupId = source.workflowGroupId;
  if (!String(target.workflowPart || '').trim() && String(source.workflowPart || '').trim()) target.workflowPart = source.workflowPart;
  if (!String(target.workflowLabel || '').trim() && String(source.workflowLabel || '').trim()) target.workflowLabel = source.workflowLabel;
  if (!String(target.voiceInterruptionEventId || '').trim() && String(source.voiceInterruptionEventId || '').trim()) {
    target.voiceInterruptionEventId = source.voiceInterruptionEventId;
  }
  if (!String(target.body?.text || '').trim() && String(source.body?.text || source.content || '').trim()) {
    if (!target.body || typeof target.body !== 'object') target.body = { text: '' };
    target.body.text = String(source.body?.text || source.content || '');
    target.content = target.body.text;
  }
  if (!target.time && source.time) target.time = source.time;
  const targetStartedAt = Number(target.workStartedAt || target.startedAt || 0);
  const sourceStartedAt = Number(source.workStartedAt || source.startedAt || 0);
  if (Number.isFinite(sourceStartedAt) && sourceStartedAt > 0) {
    target.workStartedAt = Number.isFinite(targetStartedAt) && targetStartedAt > 0
      ? Math.min(targetStartedAt, sourceStartedAt)
      : sourceStartedAt;
  }
  if (!target.workEndedAt && source.workEndedAt) target.workEndedAt = source.workEndedAt;
  if (Number.isFinite(Number(source.workDurationMs))) {
    target.workDurationMs = Number.isFinite(Number(target.workDurationMs))
      ? Math.max(Number(target.workDurationMs), Number(source.workDurationMs))
      : Number(source.workDurationMs);
  }
  target.timestamp = Math.min(Number(target.timestamp || Date.now()), Number(source.timestamp || Date.now()));
  const targetHasAnswer = _mobileAssistantHasVisibleAnswer(target);
  const sourceHasAnswer = _mobileAssistantHasVisibleAnswer(source);
  const canInheritStreaming = !(targetHasAnswer && !sourceHasAnswer);
  target.streaming = target.streaming === true || (
    source.streaming === true
    && canInheritStreaming
    && !target.workEndedAt
    && !Number.isFinite(Number(target.workDurationMs))
  );
  return target;
}

function _mergeMobileRichArtifacts(target, incomingArtifacts) {
  if (!target || !Array.isArray(incomingArtifacts) || !incomingArtifacts.length) return target;
  const artifacts = Array.isArray(target.richArtifacts) ? target.richArtifacts.slice() : [];
  const artifactKey = (artifact) => {
    const type = String(artifact?.type || '').trim();
    const id = String(artifact?.id || '').trim();
    if (type && id) return `${type}:${id}`;
    try { return `${type}:${JSON.stringify(artifact)}`; }
    catch { return `${type}:${String(artifact?.title || '')}`; }
  };
  const positions = new Map(artifacts.map((artifact, index) => [artifactKey(artifact), index]));
  for (const artifact of incomingArtifacts) {
    if (!artifact || typeof artifact !== 'object') continue;
    const key = artifactKey(artifact);
    const index = positions.get(key);
    if (index === undefined) {
      positions.set(key, artifacts.length);
      artifacts.push(artifact);
    } else {
      artifacts[index] = { ...artifacts[index], ...artifact };
    }
  }
  if (artifacts.length) target.richArtifacts = artifacts;
  return target;
}

function _mobileAssistantHasVisibleAnswer(msg) {
  return !!String(msg?.body?.text || msg?.content || msg?.text || '').trim();
}

function _isMobileVoiceShowUiCard(msg) {
  return !!msg
    && String(msg.role || '') === 'ai'
    && String(msg.messageKind || '') === 'voice_show_ui_card'
    && Array.isArray(msg.richArtifacts)
    && msg.richArtifacts.length > 0;
}

function _pruneMobileStaleStreamingTraceTurns(thread = _activeMobileThread()) {
  const list = Array.isArray(thread) ? thread : [];
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    if (!_isMobileAssistantMessage(msg) || msg.streaming !== true || _mobileAssistantHasVisibleAnswer(msg)) continue;
    // Autonomous /goal turns often begin with tool/thinking trace before any
    // assistant text. Never collapse that live turn into the completed goal
    // command acknowledgement that immediately precedes it.
    if (
      String(msg.activeRunKind || msg.agentRuntimeKind || '').trim() === 'main_chat_goal'
      || !!String(msg.goalTurnId || '').trim()
      || ['goal_turn', 'goal_restart_checkpoint'].includes(String(msg.messageKind || '').trim())
    ) continue;
    // Foreground Workers started by the Voice Agent are real chat turns. Their
    // trace can arrive after the Voice Agent acknowledgement (especially after
    // reconnect), but it must remain in its own bubble instead of being folded
    // into that acknowledgement as a supposedly stale trace-only assistant.
    if (
      msg._voiceWorkerLocalTurn === true
      || msg._voiceWorkerLocalFinal === true
      || ['voice_foreground_worker', 'internal_watch_review'].includes(String(msg.messageKind || '').trim())
    ) continue;
    let previousAssistantIndex = -1;
    let blockedByUser = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = list[j];
      if (prev?.role === 'user') {
        blockedByUser = true;
        break;
      }
      if (_isMobileAssistantMessage(prev)) {
        previousAssistantIndex = j;
        break;
      }
    }
    if (blockedByUser || previousAssistantIndex < 0) continue;
    const previous = list[previousAssistantIndex];
    if (String(previous.messageKind || '').trim() === 'goal_command_ack') continue;
    const msgRequestId = String(msg._clientRequestId || '').trim();
    const previousRequestId = String(previous._clientRequestId || '').trim();
    // A request-owned stream may only merge with the same request-owned turn.
    // In particular, never attach Worker process entries to an unowned realtime
    // Voice Agent acknowledgement.
    if ((msgRequestId || previousRequestId) && (!msgRequestId || msgRequestId !== previousRequestId)) continue;
    if (msg.goalId && previous.goalId && String(msg.goalId) !== String(previous.goalId)) continue;
    if (msg.goalTurnId && String(msg.goalTurnId) !== String(previous.goalTurnId || '')) continue;
    if (previous.streaming === true || !_mobileAssistantHasVisibleAnswer(previous)) continue;
    _mergeMobileAssistantTurnDetails(previous, msg);
    previous.streaming = false;
    list.splice(i, 1);
    i -= 1;
  }
  return list;
}

function _dedupeMobileAssistantTurns(thread = _activeMobileThread()) {
  const list = Array.isArray(thread) ? thread : [];
  _pruneMobileStaleStreamingTraceTurns(list);
  const seen = new Map();
  const seenRequests = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    const requestId = _isMobileAssistantMessage(msg) ? String(msg._clientRequestId || '').trim() : '';
    const previousRequestTurn = requestId ? seenRequests.get(requestId) : null;
    const requestIndex = previousRequestTurn ? list.indexOf(previousRequestTurn) : -1;
    if (requestIndex >= 0) {
      const previous = previousRequestTurn;
      const keepCurrent = _mobileAssistantRichnessScore(msg) > _mobileAssistantRichnessScore(previous);
      const keepIndex = keepCurrent ? i : requestIndex;
      const dropIndex = keepCurrent ? requestIndex : i;
      _mergeMobileAssistantTurnDetails(list[keepIndex], list[dropIndex]);
      list.splice(dropIndex, 1);
      seenRequests.set(requestId, list[keepCurrent ? dropIndex : requestIndex]);
      i -= 1;
      continue;
    }
    if (requestId) seenRequests.set(requestId, msg);
    const key = _mobileAssistantContentKey(msg);
    if (!key) continue;
    const prevIndex = seen.get(key);
    if (prevIndex == null) {
      seen.set(key, i);
      continue;
    }
    const previous = list[prevIndex];
    const separatedByUser = list.slice(prevIndex + 1, i).some((turn) => turn?.role === 'user');
    if (separatedByUser) {
      const previousAt = Number(previous?.workEndedAt || previous?.timestamp || 0) || 0;
      const currentAt = Number(msg?.workEndedAt || msg?.timestamp || 0) || 0;
      const isRecentDuplicate = previous?.streaming !== true
        && msg?.streaming !== true
        && previousAt > 0
        && currentAt > 0
        && Math.abs(currentAt - previousAt) < 30_000;
      if (!isRecentDuplicate) {
        seen.set(key, i);
        continue;
      }
    }
    const keepCurrent = _mobileAssistantRichnessScore(msg) > _mobileAssistantRichnessScore(previous);
    const keepIndex = keepCurrent ? i : prevIndex;
    const dropIndex = keepCurrent ? prevIndex : i;
    _mergeMobileAssistantTurnDetails(list[keepIndex], list[dropIndex]);
    list.splice(dropIndex, 1);
    seen.set(key, keepCurrent ? dropIndex : prevIndex);
    i -= 1;
  }
  return list;
}

function _newMobileClientRequestId(sessionId = '') {
  const sid = String(sessionId || 'mobile').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'mobile';
  const rand = Math.random().toString(36).slice(2, 10);
  return `${sid}_${Date.now().toString(36)}_${rand}`;
}

function _nowTime() {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function _formatMobileWorkDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function _mobileAssistantWorkStartedAt(msg) {
  const explicit = Number(msg?.workStartedAt || msg?.startedAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const ts = Number(msg?.timestamp || 0);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function _mobileTraceHasToolGroup(entries) {
  return (Array.isArray(entries) ? entries : []).some((entry) => {
    if (entry?.activity) return true;
    const type = String(entry?.type || '').toLowerCase();
    return ['tool', 'result', 'error', 'compaction', 'vision'].includes(type);
  });
}

function _renderMobileWorkTimer(msg, opts = {}) {
  if (!_isMobileAssistantMessage(msg)) return '';
  if (msg?.suppressWorkTimer === true) return '';
  const startedAt = _mobileAssistantWorkStartedAt(msg);
  if (!startedAt) return '';
  // A final frame is the UI completion boundary even if the transport's later
  // `done` callback has not cleared `streaming` yet. Keeping it "Working" in
  // that gap also removed the trace disclosure after the answer appeared.
  const active = msg?.streaming === true && msg?._pmFinalReceived !== true;
  const endedAt = Number(msg?.workEndedAt || 0);
  const duration = active
    ? Date.now() - startedAt
    : (Number.isFinite(Number(msg?.workDurationMs)) && Number(msg.workDurationMs) >= 0
      ? Number(msg.workDurationMs)
      : ((Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Number(msg?.timestamp || Date.now())) - startedAt));
  const label = `${active ? 'Working for' : 'Worked for'} ${escapeHtml(_formatMobileWorkDuration(duration))}`;
  const traceEntries = _mobileWorkflowTraceEntriesForMessage(msg);
  const hasTrace = traceEntries.length > 0;
  if (hasTrace) {
    const isExpanded = typeof opts.expanded === 'boolean' ? opts.expanded : active;
    const expanded = isExpanded ? ' expanded' : '';
    return `<div class="pm-work-timer pm-work-timer--expandable${expanded}" data-expandable="trace" role="button" tabindex="0" aria-expanded="${isExpanded ? 'true' : 'false'}">
      ${label}
      <svg class="pm-work-timer-chevron" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>`;
  }
  return `<div class="pm-work-timer">${label}</div>`;
}

function _wrapMobileMarkdownTables(html) {
  const src = String(html || '');
  if (!src || !/<table\b/i.test(src)) return src;
  return src.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    return `<div class="pm-md-table-scroll">${tableHtml}</div>`;
  });
}

function _renderMobileMarkdown(text, message = null) {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  if (typeof window !== 'undefined' && (!window.marked || typeof window.marked.parse !== 'function')) {
    Promise.resolve(window.__PROM_EXTERNAL_LIBS_READY || null)
      .then(() => {
        if (window.marked && typeof window.marked.parse === 'function') {
          try { renderThreadNow(); } catch {}
        }
      })
      .catch(() => {});
  }
  try {
    return _wrapMobileMarkdownTables(renderMd(raw, {
      visualArtifacts: Array.isArray(message?.richArtifacts) ? message.richArtifacts : [],
    }));
  } catch {
    return escapeHtml(raw).replace(/\n/g, '<br>');
  }
}

function _renderMobileSkillReferencedMarkdown(text, refs = []) {
  let html = _renderMobileMarkdown(text);
  const normalizedRefs = _pmNormalizeSelectedComposerSkillRefs(refs)
    .sort((a, b) => String(b.title || '').length - String(a.title || '').length);
  for (const ref of normalizedRefs) {
    const title = String(ref.title || '').trim();
    if (!title) continue;
    const escapedTitle = escapeHtml(title);
    const replacement = `<button type="button" class="pm-inline-skill-token" data-pm-skill-ref="${escapeHtml(ref.id || title)}" data-pm-skill-title="${escapedTitle}"><span class="pm-inline-skill-token-icon" aria-hidden="true"></span>${escapedTitle}</button>`;
    html = html.split(escapedTitle).join(replacement);
  }
  for (const item of _pmSortedSlashCommandTokens()) {
    const command = String(item.command || '').trim();
    if (!command) continue;
    const escapedCommand = escapeHtml(command);
    const replacement = `<span class="pm-inline-command-token"><span class="pm-inline-skill-token-icon" aria-hidden="true"></span>${escapedCommand}</span>`;
    html = html.split(escapedCommand).join(replacement);
  }
  return html;
}

function _pmSkillExcerpt(value, max = 760) {
  const text = String(value || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'No skill instructions preview available.';
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

async function _pmResolveSkillIdForPopover(id, title) {
  const direct = String(id || '').trim();
  if (direct) return direct;
  _pmEnsureSkillTriggerCacheLoaded();
  const wanted = String(title || '').trim().toLowerCase();
  const skills = Array.isArray(window.prometheusSkillsCache) ? window.prometheusSkillsCache : [];
  const match = skills.find((skill) => String(skill.name || '').trim().toLowerCase() === wanted)
    || skills.find((skill) => String(skill.id || '').trim().toLowerCase() === wanted);
  return String(match?.id || '').trim();
}

async function _pmShowSkillReferencePopover(id, title) {
  const skillId = await _pmResolveSkillIdForPopover(id, title);
  const label = String(title || skillId || 'Skill').trim();
  document.getElementById('pm-skill-ref-popover')?.remove();
  const host = el(`
    <div class="pm-skill-ref-popover" id="pm-skill-ref-popover" role="dialog" aria-modal="true" aria-label="Skill details">
      <div class="pm-skill-ref-scrim" data-skill-ref-close></div>
      <section class="pm-skill-ref-panel">
        <button type="button" class="pm-skill-ref-close" data-skill-ref-close aria-label="Close">&times;</button>
        <div class="pm-skill-ref-loading">Loading ${escapeHtml(label)}...</div>
      </section>
    </div>
  `);
  document.body.appendChild(host);
  const panel = host.querySelector('.pm-skill-ref-panel');
  const close = () => host.remove();
  host.querySelectorAll('[data-skill-ref-close]').forEach((node) => node.addEventListener('click', close));
  try {
    if (!skillId) throw new Error('Skill metadata is unavailable for this message.');
    const data = await mobileGatewayFetch(`/api/hub/skills/${encodeURIComponent(skillId)}/content`);
    const skill = data?.skill || {};
    const resources = Array.isArray(skill.resources) ? skill.resources : [];
    panel.innerHTML = `
      <button type="button" class="pm-skill-ref-close" data-skill-ref-close aria-label="Close">&times;</button>
      <div class="pm-skill-ref-kicker">Skill</div>
      <h3>${escapeHtml(skill.name || label)}</h3>
      <p class="pm-skill-ref-desc">${escapeHtml(skill.description || 'No description available.')}</p>
      <div class="pm-skill-ref-section">
        <strong>SKILL.md Preview</strong>
        <p>${escapeHtml(_pmSkillExcerpt(skill.content || ''))}</p>
      </div>
      <div class="pm-skill-ref-section">
        <strong>Reference Files</strong>
        ${resources.length ? `<div class="pm-skill-ref-resources">${resources.slice(0, 12).map((resource) => {
          const path = String(resource?.path || '').trim();
          return `<button type="button" class="pm-skill-ref-resource" data-skill-resource-path="${escapeHtml(path)}">${escapeHtml(path || 'resource')}</button>`;
        }).join('')}</div>` : '<p>No reference files listed.</p>'}
      </div>
      <div class="pm-skill-ref-resource-preview" id="pm-skill-ref-resource-preview" hidden></div>
    `;
    panel.querySelectorAll('[data-skill-ref-close]').forEach((node) => node.addEventListener('click', close));
    panel.querySelectorAll('[data-skill-resource-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        const path = String(button.getAttribute('data-skill-resource-path') || '').trim();
        const preview = panel.querySelector('#pm-skill-ref-resource-preview');
        if (!path || !preview) return;
        preview.hidden = false;
        preview.textContent = 'Loading resource...';
        try {
          const result = await mobileGatewayFetch(`/api/hub/skills/${encodeURIComponent(skillId)}/resources/content?path=${encodeURIComponent(path)}`);
          preview.innerHTML = `<strong>${escapeHtml(path)}</strong><p>${escapeHtml(_pmSkillExcerpt(result?.resource?.content || '', 900))}</p>`;
        } catch (err) {
          preview.textContent = `Could not load ${path}: ${err?.message || err}`;
        }
      });
    });
  } catch (err) {
    panel.innerHTML = `
      <button type="button" class="pm-skill-ref-close" data-skill-ref-close aria-label="Close">&times;</button>
      <h3>${escapeHtml(label)}</h3>
      <p class="pm-skill-ref-desc">${escapeHtml(err?.message || String(err))}</p>
    `;
    panel.querySelectorAll('[data-skill-ref-close]').forEach((node) => node.addEventListener('click', close));
  }
}

function _safeJsonPreview(value, max = 130) {
  if (value == null) return '';
  let raw = '';
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    raw = String(value || '');
  }
  raw = raw.replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function _mobileToolLabel(evt) {
  const action = String(evt?.action || evt?.toolName || evt?.type || '').trim();
  if (!action) return 'Working';
  const normalized = action.toLowerCase();
  if (['workspace_run', 'run_command', 'terminal', 'shell', 'shell_command', 'terminal_run', 'start_process'].includes(normalized)) {
    const args = evt?.args && typeof evt.args === 'object'
      ? evt.args
      : evt?.params && typeof evt.params === 'object' ? evt.params : {};
    const command = String(args.command || args.cmd || args.script || '').replace(/\s+/g, ' ').trim();
    return command ? `Running command · ${command.length > 120 ? `${command.slice(0, 117)}...` : command}` : 'Running command';
  }
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function _mobileToolResultLabel(evt) {
  const action = String(evt?.action || evt?.toolName || evt?.name || '').trim().toLowerCase();
  if (['workspace_run', 'run_command', 'terminal', 'shell', 'shell_command', 'terminal_run', 'start_process'].includes(action)) {
    const args = evt?.args && typeof evt.args === 'object' ? evt.args : {};
    const command = String(args.command || args.cmd || args.script || '').replace(/\s+/g, ' ').trim();
    const compactCommand = command.length > 120 ? `${command.slice(0, 117)}...` : command;
    return evt?.error ? `Command failed${compactCommand ? ` · ${compactCommand}` : ''}` : `Ran command${compactCommand ? ` · ${compactCommand}` : ''}`;
  }
  return _mobileToolLabel(evt);
}

function _makeProcessEntry(type, text, extra = null) {
  const content = String(text || '').trim();
  if (!content) return null;
  return {
    id: `proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: String(type || 'info'),
    text: content,
    extra,
    ts: Date.now(),
    time: _nowTime(),
  };
}

function _appendMobileProcess(message, type, text, extra = null) {
  if (!message) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const entry = _makeProcessEntry(type, text, extra);
  if (!entry) return;
  if (_isMobileTransientReasoningTraceEntry(entry)) return;
  const entryKey = _mobileProcessEntryKey(entry);
  if (entryKey && message.processEntries.some((existing) => _mobileProcessEntryKey(existing) === entryKey)) return;
  const prev = message.processEntries[message.processEntries.length - 1];
  if (prev && prev.type === entry.type && prev.text === entry.text) return;
  message.processEntries.push(entry);
  if (message.processEntries.length > 120) message.processEntries.splice(0, message.processEntries.length - 120);
}

function _recordMobileChatError(message, error) {
  if (!message) return null;
  const presentation = error?.chatPresentation || presentChatError(error);
  const prior = message.errorPresentation;
  if (prior?.key === presentation.key) {
    prior.count = Math.max(1, Number(prior.count || 1)) + 1;
    return prior;
  }
  message.errorPresentation = { ...presentation, count: 1 };
  _appendMobileProcess(message, 'error', `${presentation.title}: ${presentation.summary}`, {
    code: presentation.code,
    technicalDetails: presentation.technicalDetails,
  });
  return message.errorPresentation;
}

function _isMobileRuntimeAbortEvent(evt) {
  const code = String(evt?.code || evt?.error?.code || '').trim().toUpperCase();
  const reason = String(evt?.reason || '').trim().toLowerCase();
  return code === 'MAIN_CHAT_RUNTIME_ABORTED'
    || (String(evt?.type || '').toLowerCase() === 'error' && /^(operator_abort|user_abort|abort|aborted|stop)/.test(reason));
}

function _findMobileExpectedAbortTurn(thread, evt = null) {
  if (!Array.isArray(thread)) return null;
  const runtimeId = String(evt?.runtimeId || evt?.data?.runtimeId || '').trim();
  const streamId = String(evt?.streamId || evt?.data?.streamId || '').trim();
  const clientRequestId = String(evt?.clientRequestId || evt?.data?.clientRequestId || '').trim();
  const hasIdentity = !!(runtimeId || streamId || clientRequestId);
  return [...thread].reverse().find((turn) => {
    if (turn?.role !== 'ai' || turn?._pmAbortRequested !== true) return false;
    if (clientRequestId && String(turn._clientRequestId || '').trim() === clientRequestId) return true;
    if (runtimeId && String(turn.runtimeId || '').trim() === runtimeId) return true;
    if (streamId && String(turn.streamId || turn._streamId || '').trim() === streamId) return true;
    // An identified late frame must never settle a newer queued turn. The
    // identity-less fallback is only for older gateways that cannot echo any
    // request/runtime/stream identifier.
    return !hasIdentity;
  }) || null;
}

function _ackMobileAbort(...args) {
  return _mobileChatRendererInvoke('_ackMobileAbort', args) || false;
}

function _clearRecoveredMobileChatError(message) {
  if (!message) return false;
  let changed = false;
  if (message.errorPresentation?.key === 'chat-connection-dropped') {
    delete message.errorPresentation;
    changed = true;
  }
  const recoveryPlaceholder = "Connection dropped, but Prometheus may still be working. I'll keep checking and recover the result here.";
  const currentText = String(message.body?.text || message.content || '').trim();
  if (currentText === recoveryPlaceholder) {
    if (!message.body || typeof message.body !== 'object') message.body = { sender: '', text: '' };
    message.body.text = '';
    message.content = '';
    changed = true;
  }
  return changed;
}

function _coalesceMobileChatError(thread, message, presentation) {
  if (!Array.isArray(thread) || !message || !presentation?.key) return;
  const earlier = [...thread].reverse().find((item) => item !== message
    && item?.role === 'ai'
    && item?.errorPresentation?.key === presentation.key
    && !String(item?.body?.text || item?.content || '').trim());
  if (!earlier) return;
  earlier.errorPresentation.count = Math.max(1, Number(earlier.errorPresentation.count || 1)) + 1;
  message._pmCoalescedError = true;
}

function _renderMobileChatErrorPresentation(presentation) {
  if (!presentation?.title) return '';
  const count = Math.max(1, Number(presentation.count || 1));
  const details = String(presentation.technicalDetails || '').trim();
  return `<section class="pm-chat-error-status" data-severity="${escapeHtml(presentation.severity || 'error')}" aria-live="polite">
    <div class="pm-chat-error-status-copy"><strong>${escapeHtml(presentation.title)}</strong><span>${escapeHtml(presentation.summary || '')}</span>${count > 1 ? `<em>Repeated ${escapeHtml(String(count))} times</em>` : ''}</div>
    ${details ? `<details class="pm-chat-error-details"><summary>Technical details</summary><pre>${escapeHtml(details)}</pre><button type="button" data-pm-copy-error-details>Copy details</button></details>` : ''}
  </section>`;
}

if (typeof document !== 'undefined' && !window.__pmMobileErrorDetailsCopyInstalled) {
  window.__pmMobileErrorDetailsCopyInstalled = true;
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-pm-copy-error-details]');
    if (!button) return;
    const details = button.closest('.pm-chat-error-details')?.querySelector('pre')?.textContent || '';
    navigator.clipboard?.writeText?.(details).then(() => { button.textContent = 'Copied'; }).catch(() => {});
  });
}

/** Match desktop ChatPage thinking policy: buffer raw thinking_delta, only live-show reasoning_summary + full thoughts. */
function _flushMobilePendingThinkingBurst(message) {
  if (!message) return '';
  const text = String(message._pendingThinkingBurst || '').trim();
  message._pendingThinkingBurst = '';
  if (!text) return '';
  // Raw provider thinking remains private. It may be retained transiently for
  // turn bookkeeping, but only explicit reasoning summaries enter the UI.
  return text;
}

function _isMobileReasoningCompanionEvent(evt) {
  if (!evt || String(evt.type || '') !== 'model_stream_event') return false;
  const modelType = String(evt.event?.type || '').trim();
  return /^reasoning_/i.test(modelType);
}

function _maybeFlushMobileThinkingBeforeEvent(message, evt) {
  if (!message || !evt) return;
  const type = String(evt.type || '');
  if (type === 'thinking_delta' || _isMobileReasoningCompanionEvent(evt)) return;
  _flushMobilePendingThinkingBurst(message);
}

function _isMobileProgressNarration(value) {
  const text = _normalizeMobileTraceProseText(value).replace(/\s+/g, ' ').trim();
  return /^(?:Clarifying|Explaining|Confirming|Summarizing|Planning|Deciding|Inspecting|Preparing|Starting|Activating|Executing|Focusing|Prioritizing|Assessing|Attempting|Identifying|Verifying|Loading|Running|Capturing|Opening|Closing|Reading|Writing|Checking|Reviewing|Collecting|Invoking|Calling|Using|Searching|Coordinating|Waiting|Listing|Retrieving|Inferring|Implementing|Investigating|Exploring|Queuing|Dispatching)\b/i.test(text);
}

function _isMobileTransientReasoningTraceEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const type = String(entry.type || entry.kind || '').trim().toLowerCase();
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const event = String(entry.event || extra.event || extra.eventType || '').trim().toLowerCase();
  const source = String(entry.source || extra.source || '').trim().toLowerCase();
  const visibility = String(entry.visibility || extra.visibility || '').trim().toLowerCase();
  const reasoningKind = String(entry.reasoningKind || extra.reasoningKind || extra.presentationKind || '').trim().toLowerCase();
  // Full thoughts are durable journal entries even if a provider echoes a
  // summary field alongside them. Summary cleanup must never remove one.
  if (reasoningKind === 'full_thought') return false;
  return source === 'agent_progress'
    || source === 'reasoning_summary'
    || type === 'reasoning_summary'
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(type)
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(event)
    || reasoningKind === 'summary'
    || (visibility === 'summary' && ['think', 'thinking', 'agent_thought'].includes(type));
}

function _mobileDurableReasoningEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => !_isMobileTransientReasoningTraceEntry(entry));
}

function _setMobileLiveProgressNarration(message, text, { replace = false, visibility = 'summary' } = {}) {
  if (!message) return false;
  const incoming = String(text || '');
  if (!incoming) return false;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  // Only the current tail can still be mutable. Reusing an older progress
  // row after a thought/tool boundary makes the next summary rewrite history.
  const activeProgressEntry = message.liveTraceEntries.at(-1);
  const existing = activeProgressEntry
    && String(activeProgressEntry?.extra?.source || activeProgressEntry?.source || '').toLowerCase() === 'agent_progress'
    ? activeProgressEntry
    : null;
  if (!existing) {
    message.liveTraceEntries.push({
      id: `mtrace_progress_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'think',
      text: incoming.trim(),
      ts: Date.now(),
      time: _nowTime(),
      extra: { visibility, source: 'agent_progress', reasoningKind: 'summary' },
    });
    return true;
  }
  const previous = String(existing.text || '').trim();
  const next = incoming.trim();
  if (!next) return false;
  const isSnapshot = next.length > previous.length && next.startsWith(previous);
  const canAppend = !replace
    && !isSnapshot
    && previous
    && !/[.!?:]\s*$/.test(previous)
    && (/^\s/.test(incoming) || /^[a-z0-9,'"‘’“”\-—.;:!?)}\]]/.test(next));
  const merged = canAppend
    ? _dedupeMobileTraceProseText(_appendMobileStreamingText(previous, incoming))
    : next;
  const latest = canAppend
    ? (merged.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).pop() || merged)
    : merged;
  if (!latest) return false;
  const visibilityChanged = String(existing?.extra?.visibility || '') !== visibility;
  if (latest === String(existing.text || '').trim()) {
    if (visibilityChanged) existing.extra = { ...(existing.extra || {}), visibility, source: 'agent_progress' };
    return visibilityChanged;
  }
  existing.text = latest;
  existing.time = _nowTime();
  existing.extra = { ...(existing.extra || {}), visibility, source: 'agent_progress' };
  return true;
}

function _handleMobileThinkingDelta(message, evt) {
  if (!message) return false;
  const chunk = String(evt?.thinking || evt?.text || '');
  if (!chunk) return false;
  const isSummary = chatProgressVisibility(evt) === 'summary';
  if (!isSummary) message._pendingThinkingBurst = `${message._pendingThinkingBurst || ''}${chunk}`;
  // Only explicit reasoning summaries stream live. Raw chain-of-thought stays
  // out of both the live trace and the durable process journal.
  if (isSummary) {
    // `reasoning_summary` is already an explicit user-safe progress channel.
    // Keep it in the single replaceable tool-stream status slot even when the
    // prose does not start with one of the action verbs in
    // `_isMobileProgressNarration`.
    _setMobileLiveProgressNarration(message, chunk);
  }
  return true;
}

function _handleMobileReasoningSummaryDelta(message, evt) {
  if (!message) return false;
  const chunk = String(evt?.text || evt?.summary || '');
  if (!chunk) return false;
  // This event type is the authoritative, user-visible reasoning summary.
  // It must update the collapsible tool-stream label rather than becoming a
  // second standalone thought card.
  _setMobileLiveProgressNarration(message, chunk);
  return true;
}

function _handleMobileCleanThought(message, evt) {
  if (!message) return false;
  const visibility = chatProgressVisibility(evt);
  if (visibility === 'private') return false;
  const text = String(evt?.thinking || evt?.text || '').trim();
  if (!text) return false;
  const reasoningKind = String(evt?.reasoningKind || evt?.extra?.reasoningKind || evt?.extra?.presentationKind || '').trim().toLowerCase();
  const source = String(evt?.source || evt?.extra?.source || '').trim().toLowerCase();
  const isSummary = reasoningKind !== 'full_thought'
    && (visibility === 'summary' || reasoningKind === 'summary' || source === 'reasoning_summary');
  if (isSummary) {
    // Some gateways replay a safe summary through the legacy thought event.
    // Treat it exactly like the explicit summary channel: update one mutable
    // slot and never copy it into `_thinking`, live thoughts, or process rows.
    return _setMobileLiveProgressNarration(message, text, { replace: true, visibility: 'summary' });
  }
  const streamId = String(evt?.streamId || '').trim();
  const seq = Number(evt?.seq);
  const eventKey = String(evt?.eventKey || '').trim()
    || (streamId && Number.isFinite(seq) && seq >= 0 ? `${streamId}:${Math.floor(seq)}` : '');
  const thoughtExtra = {
    source: String(evt?.source || evt?.extra?.source || '').trim() || 'agent_thought',
    visibility,
    event: String(evt?.type || '').trim() || 'agent_thought',
    reasoningKind: String(evt?.reasoningKind || evt?.extra?.reasoningKind || evt?.extra?.presentationKind || '').trim().toLowerCase() || 'full_thought',
    ...(streamId ? { streamId } : {}),
    ...(eventKey ? { eventKey } : {}),
    ...(Number.isFinite(seq) && seq >= 0 ? { seq: Math.floor(seq) } : {}),
  };
  // Summary packets own the replaceable one-line progress slot. A curated
  // paragraph thought is a separate journal entry and must never replace that
  // slot; otherwise the renderer cannot keep the two presentation surfaces
  // distinct after a tool call or reconnect.
  message._thinking = message._thinking ? `${message._thinking}\n\n${text}` : text;
  const alreadyJournaled = eventKey && Array.isArray(message.liveTraceEntries)
    && message.liveTraceEntries.some((entry) => (
      String(entry?.eventKey || entry?.extra?.eventKey || '').trim() === eventKey
    ));
  if (!alreadyJournaled) {
    _appendMobileLiveTrace(message, 'think', text, { extra: thoughtExtra });
  }
  _pushMobileStreamProcessEntry(message, 'think', text, {
    ...evt,
    source: thoughtExtra.source,
    visibility,
  }, false);
  return true;
}

function _handleMobileThinkingCallback(message, text, meta = null) {
  if (!message) return false;
  const chunk = String(text || '');
  if (!chunk) return false;
  const source = String(
    (meta && typeof meta === 'object' ? meta.source : meta) || ''
  ).toLowerCase();
  return _handleMobileThinkingDelta(message, { thinking: chunk, source });
}

function _mobileProcessEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const streamId = String(extra.streamId || entry.streamId || '').trim();
  const seq = Number(extra.seq ?? entry.seq);
  const eventKey = String(extra.eventKey || entry.eventKey || '').trim()
    || (streamId && Number.isFinite(seq) && seq >= 0 ? `${streamId}:${Math.floor(seq)}` : '');
  if (eventKey) return `${String(entry.type || '').toLowerCase()}|event:${eventKey}`;
  const event = String(extra.event || entry.event || '').trim().toLowerCase();
  const callId = String(extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id || '').trim();
  if (event && callId) return `${String(entry.type || '').toLowerCase()}|${event}|call:${callId}`;
  return [
    String(entry.type || '').toLowerCase(),
    String(entry.text || entry.content || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    String(entry.time || entry.ts || ''),
  ].join('|');
}

function _isInternalMobileRestartProcessEntry(entry) {
  const packetType = String(entry?.extra?.packetType || '').trim();
  return packetType === 'hot_restart_context'
    || packetType === 'restart_context_packet'
    || packetType === 'runtime_recovery_context';
}

function _isMobileInternalToolProtocolText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return /^(?:latency:\s*provider_[a-z0-9_]+(?:\s+at\b.*)?|processing\.{0,3})$/i.test(text)
    || /^prepared\s+(?:skill|request|tool|provider)\b/i.test(text);
}

function _isMobileHiddenRuntimeProcessEntry(entry) {
  if (_isInternalMobileRestartProcessEntry(entry)) return true;
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  // Plan progress is rendered by the dedicated plan UI. Older runtime
  // checkpoints wrote it as generic `step` process rows, which made recovered
  // tool drawers show fake "Plan: Run …" tools.
  if (String(extra.source || '').toLowerCase() === 'runtime_checkpoint'
    && String(extra.event || '').toLowerCase() === 'progress_state') return true;
  // Background runtimes may persist provider lifecycle diagnostics as plain
  // process rows. They are implementation details, not user-facing tools;
  // real tool calls/results remain visible through the activity coalescer.
  return !entry?.activity && _isMobileInternalToolProtocolText(
    entry?.text || entry?.content || entry?.message,
  );
}

function _normalizeMobileProcessEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const recovered = _normalizeMobileRecoveredTraceEntry(entry);
  if (_isMobileHiddenRuntimeProcessEntry(recovered)) return null;
  const text = String(recovered.text || recovered.content || recovered.message || '').trim();
  if (!text) return null;
  return {
    id: recovered.id || `proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: String(recovered.type || 'info').toLowerCase(),
    text,
    extra: recovered.extra || null,
    time: recovered.time || (recovered.ts ? _formatChatTime(recovered.ts) : ''),
  };
}

function _mobileRecoveredTraceInference(entry) {
  const type = String(entry?.type || entry?.kind || '').toLowerCase();
  if (!['tool', 'skill', 'result', 'error', 'progress'].includes(type)) return null;
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const existingAction = String(extra.action || extra.toolName || entry?.action || entry?.toolName || '').trim();
  if (existingAction) return null;
  const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const payload = _mobileTraceJsonPayload(text);
  const commandMatch = text.match(/^(?:running|ran)\s+command\s*(?:·|:|->|=>|→)?\s*(.*)$/i);
  if (commandMatch) {
    const command = String(commandMatch[1] || '').trim();
    return { action: 'workspace_run', args: command ? { command } : {} };
  }
  const namedAction = text.match(/\b((?:browser|desktop|workspace|web|file|skill|run|request_tool|background)_[a-z0-9_]+)\b/i);
  if (namedAction?.[1]) {
    return { action: String(namedAction[1]).toLowerCase(), args: payload && typeof payload === 'object' ? payload : {} };
  }
  if (/^workspace\s+git\b/i.test(text)) {
    return { action: 'workspace_git', args: payload && typeof payload === 'object' ? payload : {} };
  }
  if (/^request\s+tool\s+category\b/i.test(text)) {
    return { action: 'request_tool_category', args: payload && typeof payload === 'object' ? payload : {} };
  }
  if (/^workspace\s+(?:read|write|edit|search)\b/i.test(text)) {
    const label = text.match(/^workspace\s+([a-z]+)/i)?.[1] || 'read';
    return { action: `workspace_${label}`, args: payload && typeof payload === 'object' ? payload : {} };
  }
  const payloadAction = payload && typeof payload === 'object'
    ? String(payload.action || payload.toolName || payload.name || '').trim()
    : '';
  return payloadAction ? { action: payloadAction, args: payload } : null;
}

function typeIsResultOrError(type) {
  const value = String(type || '').toLowerCase();
  return value === 'result' || value === 'error';
}

function _isMobileReasoningSummaryTraceEntry(entry) {
  const type = String(entry?.type || entry?.kind || '').trim().toLowerCase();
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const event = String(extra.event || entry?.event || '').trim().toLowerCase();
  const source = String(extra.source || entry?.source || '').trim().toLowerCase();
  const reasoningKind = String(extra.reasoningKind || entry?.reasoningKind || extra.presentationKind || '').trim().toLowerCase();
  if (reasoningKind === 'full_thought') return false;
  return ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(type)
    || ['reasoning_summary', 'reasoning_summary_delta', 'reasoning_delta'].includes(event)
    || source === 'reasoning_summary';
}

function _normalizeMobileRecoveredTraceEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const rawType = String(entry.type || entry.kind || '').toLowerCase();
  const event = String(extra.event || entry.event || rawType || '').toLowerCase();
  const text = String(entry.text || entry.content || entry.message || '').trim();
  const normalizedType = event === 'tool_call' || rawType === 'tool_call'
    ? 'tool'
    : event === 'tool_result' || rawType === 'tool_result'
      ? (entry.error === true || extra.error === true ? 'error' : 'result')
      : event === 'tool_progress' || rawType === 'tool_progress'
        ? 'progress'
        : (event === 'reasoning_summary_delta' || event === 'reasoning_summary' || rawType === 'reasoning_summary_delta'
          || (event === 'thinking_delta' && String(extra.source || entry.source || '').toLowerCase() === 'reasoning_summary')
          || event === 'thinking' || event === 'agent_thought' || rawType === 'thinking' || rawType === 'agent_thought')
          ? 'think'
          : event === 'token_narration_boundary' || rawType === 'token_narration_boundary'
            ? 'preamble'
            : rawType;
  const normalized = normalizedType && normalizedType !== rawType
    ? { ...entry, type: normalizedType, extra: { ...extra, event: event || rawType } }
    : entry;
  const normalizedExtra = normalized.extra && typeof normalized.extra === 'object' ? normalized.extra : extra;
  if (_isMobileReasoningSummaryTraceEntry(entry) && text) {
    return {
      ...normalized,
      type: 'think',
      text,
      extra: {
        ...normalizedExtra,
        source: 'reasoning_summary',
        visibility: 'user',
        reasoningKind: 'summary',
        event: event || 'reasoning_summary',
      },
    };
  }
  if ((event === 'token_narration_boundary' || normalizedType === 'preamble') && text) {
    return {
      ...normalized,
      type: 'preamble',
      text,
      extra: {
        ...normalizedExtra,
        source: 'agent_progress',
        visibility: 'user',
        reasoningKind: 'summary',
        event: event || 'token_narration_boundary',
      },
    };
  }
  if ((normalizedType === 'think' || normalizedType === 'reasoning_summary') && text) {
    const source = String(normalizedExtra.source || entry.source || '').trim().toLowerCase();
    const kind = String(normalizedExtra.reasoningKind || normalizedExtra.presentationKind || entry.reasoningKind || entry.presentationKind || '').trim().toLowerCase()
      || (source === 'reasoning_summary' || source === 'agent_progress' || normalizedType === 'reasoning_summary'
        ? 'summary'
        : 'full_thought');
    return {
      ...normalized,
      type: 'think',
      text,
      extra: { ...normalizedExtra, reasoningKind: kind },
    };
  }
  const inference = _mobileRecoveredTraceInference(normalized);
  if (!inference) return normalized;
  return {
    ...normalized,
    extra: {
      ...normalizedExtra,
      action: normalizedExtra.action || inference.action,
      toolName: normalizedExtra.toolName || inference.action,
      args: normalizedExtra.args || inference.args || {},
      ...(typeIsResultOrError(normalized?.type) ? { result: normalizedExtra.result || text } : {}),
    },
  };
}

function _mobileBackgroundStoredProcessEntries(record) {
  return (Array.isArray(record?.events) ? record.events : [])
    .map((entry) => _normalizeMobileRecoveredTraceEntry({
      ...entry,
      text: entry?.text || entry?.content || entry?.message,
      extra: entry?.extra || entry,
    }))
    .map(_normalizeMobileProcessEntry)
    .filter(Boolean)
    .filter((entry) => !_isMobileTransientReasoningTraceEntry(entry));
}

function _mergeMobileProcessEntries(message, entries) {
  if (!message) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const existing = new Set(message.processEntries.map(_mobileProcessEntryKey).filter(Boolean));
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = _normalizeMobileProcessEntry(raw);
    if (!entry) continue;
    if (_isMobileTransientReasoningTraceEntry(entry)) continue;
    const key = _mobileProcessEntryKey(entry);
    if (key && existing.has(key)) continue;
    if (key) existing.add(key);
    message.processEntries.push(entry);
  }
  if (message.processEntries.length > 500) {
    message.processEntries.splice(0, message.processEntries.length - 500);
  }
}

function _filterMobileProcessEntriesForActiveRun(entries, aiTurn, status = null, remembered = null) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];
  const runtimeId = String(
    status?.run?.id
    || status?.activeRun?.id
    || remembered?.runtimeId
    || aiTurn?.runtimeId
    || '',
  ).trim();
  const clientRequestId = String(
    aiTurn?._clientRequestId
    || status?.run?.clientRequestId
    || status?.activeRun?.clientRequestId
    || remembered?.clientRequestId
    || '',
  ).trim();
  if (!runtimeId && !clientRequestId) return [];
  return list.filter((raw) => {
    const entry = raw && typeof raw === 'object' ? raw : {};
    const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const entryRuntimeId = String(
      entry.runtimeId
      || entry.runId
      || extra.runtimeId
      || extra.runId
      || extra.activeRunId
      || '',
    ).trim();
    const entryClientRequestId = String(
      entry.clientRequestId
      || extra.clientRequestId
      || extra.activeRequestId
      || '',
    ).trim();
    return !!(
      (runtimeId && entryRuntimeId && entryRuntimeId === runtimeId)
      || (clientRequestId && entryClientRequestId && entryClientRequestId === clientRequestId)
    );
  });
}

function _appendMobileUserProcess(message, text, extra = null) {
  try {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!message || !value) return;
    const clipped = value.length > 900 ? `${value.slice(0, 900)}...` : value;
    const line = `User: ${clipped}`;
    if (Array.isArray(message.processEntries) && message.processEntries.some((entry) =>
      String(entry?.type || '') === 'user' && String(entry?.text || entry?.content || '').trim() === line
    )) return;
    _appendMobileProcess(message, 'user', line, {
      actor: 'User',
      source: 'mobile_user_message',
      ...(extra || {}),
    });
  } catch (err) {
    console.warn('[mobile chat] failed to append user process entry', err);
  }
}

function _normalizeVoiceAgentProcessEntry(entry) {
  const text = String(entry?.content || entry?.text || '').trim();
  if (!text) return null;
  return {
    id: String(entry?.id || `voice_proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    type: String(entry?.type || 'info'),
    text,
    extra: entry?.extra || null,
    time: String(entry?.time || entry?.ts || _nowTime()),
  };
}

function _takePendingVoiceAgentProcessEntries(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const bucket = __pmChat.voiceAgentProcessEntriesBySession || {};
  const entries = Array.isArray(bucket[sid]) ? bucket[sid].slice() : [];
  delete bucket[sid];
  __pmChat.voiceAgentProcessEntriesBySession = bucket;
  return entries.map(_normalizeVoiceAgentProcessEntry).filter(Boolean);
}

function _rememberVoiceAgentProcessEntry(sessionId, entry) {
  const sid = String(sessionId || '').trim();
  const normalized = _normalizeVoiceAgentProcessEntry(entry);
  if (!sid || !normalized) return;
  if (!__pmChat.voiceAgentProcessEntriesBySession || typeof __pmChat.voiceAgentProcessEntriesBySession !== 'object') {
    __pmChat.voiceAgentProcessEntriesBySession = {};
  }
  const list = Array.isArray(__pmChat.voiceAgentProcessEntriesBySession[sid])
    ? __pmChat.voiceAgentProcessEntriesBySession[sid]
    : [];
  const prev = list[list.length - 1];
  if (prev && prev.type === normalized.type && prev.text === normalized.text) return;
  list.push(normalized);
  __pmChat.voiceAgentProcessEntriesBySession[sid] = list.slice(-40);
}

function _voiceAgentProcessEntriesFromResult(sessionId, result) {
  const pending = _takePendingVoiceAgentProcessEntries(sessionId);
  const returned = Array.isArray(result?.processEntries)
    ? result.processEntries.map(_normalizeVoiceAgentProcessEntry).filter(Boolean)
    : [];
  const out = [];
  const seen = new Set();
  for (const entry of [...pending, ...returned]) {
    const key = `${entry.type}|${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function _mobileVoiceProcessEntryTextKey(entry) {
  return `${String(entry?.type || '').toLowerCase()}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`;
}

function _isMobileVoiceAgentAssistantTurn(turn) {
  if (!turn || turn.role !== 'ai') return false;
  const source = String(turn.source || '').toLowerCase();
  const channel = String(turn.channel || turn.channelLabel || '').toLowerCase();
  return source.includes('voice_agent') || channel.includes('voice') || !!turn.voiceInterruptionEventId;
}

function _appendVoiceAgentProcessEntriesToTurn(turn, entries) {
  if (!turn) return false;
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(_normalizeVoiceAgentProcessEntry)
    .filter(Boolean);
  if (!normalized.length) return false;
  turn.processEntries = Array.isArray(turn.processEntries) ? turn.processEntries : [];
  const seen = new Set(turn.processEntries.map(_mobileVoiceProcessEntryTextKey).filter(Boolean));
  let added = false;
  for (const entry of normalized) {
    const key = _mobileVoiceProcessEntryTextKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    turn.processEntries.push(entry);
    if (turn.streaming === true) {
      if (!Array.isArray(turn.liveTraceEntries)) turn.liveTraceEntries = [];
      const traceType = String(entry.type || 'tool').toLowerCase();
      const traceText = String(entry.text || entry.content || '').trim();
      const traceKey = `${traceType}|${traceText.replace(/\s+/g, ' ').trim()}`;
      const alreadyLive = turn.liveTraceEntries.some((trace) => {
        const liveType = String(trace?.type || '').toLowerCase();
        const liveText = String(trace?.text || trace?.content || '').replace(/\s+/g, ' ').trim();
        return `${liveType}|${liveText}` === traceKey;
      });
      if (traceText && !alreadyLive) {
        turn.liveTraceEntries.push({
          ...entry,
          id: entry.id || `voice_trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: traceType,
          text: traceText,
          time: String(entry.time || entry.ts || _nowTime()),
        });
      }
    }
    added = true;
  }
  if (!added) return false;
  const now = Date.now();
  turn.workStartedAt = Number(turn.workStartedAt || turn.timestamp || now) || now;
  if (!turn.streaming && !turn.workEndedAt) turn.workEndedAt = now;
  if (!turn.streaming) turn.workDurationMs = Math.max(0, Number(turn.workEndedAt || now) - Number(turn.workStartedAt || now));
  return true;
}

function _attachVoiceAgentProcessEntriesToMobileTurn(sessionId, entries) {
  const sid = String(sessionId || '').trim();
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(_normalizeVoiceAgentProcessEntry)
    .filter(Boolean);
  if (!sid || !normalized.length) return false;
  const thread = __pmChat.threads?.[sid];
  let target = null;
  if (Array.isArray(thread)) {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const turn = thread[i];
      if (turn?.role === 'user') break;
      if (_isMobileVoiceAgentAssistantTurn(turn)) {
        target = turn;
        break;
      }
    }
  }
  if (!target) {
    normalized.forEach((entry) => _rememberVoiceAgentProcessEntry(sid, entry));
    return false;
  }
  return _appendVoiceAgentProcessEntriesToTurn(target, normalized);
}

function _renderMobileProcess(entries, options = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => !_isMobileImageGenerationStreamEntry(entry));
  if (!list.length) return '';
  const recent = list.slice(-5);
  const full = list.map((entry) => `
    <div class="pm-process-row ${escapeHtml(entry.type)}">
      <span>${escapeHtml(entry.type)}</span>
      <p>${escapeHtml(entry.text)}</p>
    </div>
  `).join('');
  // Keep collapsed by default on mobile; _renderThread restores panels the user opened.
  return `
    <details class="pm-process-stream">
      <summary><span>Process</span><em>${list.length} event${list.length === 1 ? '' : 's'}</em></summary>
      <div class="pm-process-latest">${recent.map((entry) => `<b>${escapeHtml(entry.text)}</b>`).join('')}</div>
      <div class="pm-process-full">${full}</div>
    </details>
  `;
}

function _closeMobileTraceThoughts(message) {
  const entries = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!entries.length) return;
  const endedAt = Date.now();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!_isMobileTraceThoughtType(entry?.type)) break;
    if (!Number.isFinite(Number(entry.endTs)) || Number(entry.endTs) <= 0) entry.endTs = endedAt;
  }
}

function _appendMobileLiveTrace(message, type, text, { append = false, extra = null } = {}) {
  if (!message) return;
  const content = String(text || '');
  if (!content) return;
  if (_isMobileStartupStatusText(content)) return;
  if (_isMobileBareThinkingTraceText(content)) return;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const normalizedType = String(type || 'info').toLowerCase();
  const isThoughtLike = _isMobileTraceThoughtType(normalizedType);
  const thoughtKind = isThoughtLike ? _mobileTraceThoughtKind({ type: normalizedType, extra }) : '';
  if (!isThoughtLike) {
    _closeMobileTraceThoughts(message);
    _flushMobileTraceThoughtProbe(message, { force: true });
  }
  if (isThoughtLike && _mobileTraceShouldProbeThought(message, normalizedType, append, extra)) {
    const probe = message._pmTraceThoughtProbe;
    const nextProbeText = _appendMobileStreamingText(
      probe && probe.type === normalizedType ? String(probe.text || '') : '',
      content,
    );
    message._pmTraceThoughtProbe = {
      type: normalizedType,
      text: nextProbeText,
      time: probe?.time || _nowTime(),
      extra: extra && typeof extra === 'object' ? { ...(probe?.extra || {}), ...extra } : probe?.extra || null,
    };
    if (_mobileLiveTraceCompactionEnabled(message) && _mobileTraceThoughtCoveredByEarlier(message, nextProbeText, null, { type: normalizedType, extra: message._pmTraceThoughtProbe.extra })) {
      delete message._pmTraceThoughtProbe;
      return;
    }
    _flushMobileTraceThoughtProbe(message);
    return;
  }
  const last = message.liveTraceEntries[message.liveTraceEntries.length - 1];
  const existingThoughtText = isThoughtLike ? message.liveTraceEntries.some((entry) => {
    const entryType = String(entry?.type || '').toLowerCase();
    if (!_isMobileTraceThoughtType(entryType)) return false;
    if (_mobileTraceThoughtKind(entry) !== thoughtKind) return false;
    return _mobileTraceThoughtTextsSimilar(entry?.text || '', content);
  }) : false;
  if (existingThoughtText) return;
  if (append && last && last.type === normalizedType
    && (!isThoughtLike || _mobileTraceThoughtKind(last) === thoughtKind)) {
    last.text = _appendMobileStreamingText(last.text || '', content);
    if (isThoughtLike) {
      if (extra && typeof extra === 'object') last.extra = { ...(last.extra || {}), ...extra };
      last.text = _dedupeMobileTraceProseText(last.text);
      if (_mobileLiveTraceCompactionEnabled(message)) {
        if (_mobileTraceThoughtCoveredByEarlier(message, last.text, last, last)) {
          message.liveTraceEntries.pop();
        }
        _compactMobileTraceThoughtEntries(message);
      }
    }
  } else {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (last && last.type === normalizedType && String(last.text || '').trim() === trimmed) return;
    if (isThoughtLike && _mobileLiveTraceCompactionEnabled(message) && _mobileTraceThoughtCoveredByEarlier(message, trimmed, null, { type: normalizedType, extra })) return;
    if (isThoughtLike) {
      _pushMobileTraceThoughtEntry(message, normalizedType, trimmed, '', extra);
      if (_mobileLiveTraceCompactionEnabled(message)) _compactMobileTraceThoughtEntries(message);
    }
    else {
      message.liveTraceEntries.push({
        id: `mtrace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: normalizedType,
        text: trimmed,
        ts: Date.now(),
        time: _nowTime(),
        ...(extra && typeof extra === 'object' ? { extra } : {}),
      });
    }
  }
}

function _applyMobileToolActivity(message, phase, payload = {}) {
  if (!message) return null;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  _closeMobileTraceThoughts(message);
  return applyToolActivityEvent(message.liveTraceEntries, phase, payload);
}

function _mobileCommandActivityCollections(sessionId) {
  const sid = String(sessionId || '').trim();
  const collections = [];
  const add = (entries) => {
    if (Array.isArray(entries) && !collections.includes(entries)) collections.push(entries);
  };
  for (const message of Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : []) {
    add(message?.liveTraceEntries);
    add(message?.metadata?.liveTraceEntries);
    add(message?.body?.liveTraceEntries);
  }
  return collections;
}

function _handleMobileInlineCommandProcessEvent(eventType, message = {}, attempt = 0) {
  const run = message.run && typeof message.run === 'object' ? message.run : {};
  const sessionId = String(run.sessionId || message.sessionId || '').trim();
  const runId = String(run.runId || message.runId || '').trim();
  if (!sessionId || !runId) return;
  if (eventType === 'process_run_exited') setToolActivityDisclosureState(`terminal:${runId}`, false);
  let applied = false;
  for (const entries of _mobileCommandActivityCollections(sessionId)) {
    if (applyCommandProcessEvent(entries, eventType, message)) applied = true;
  }
  if (!applied && attempt < 12) {
    setTimeout(() => _handleMobileInlineCommandProcessEvent(eventType, message, attempt + 1), 40 + attempt * 20);
    return;
  }
  if (eventType === 'process_run_output') {
    appendCommandTerminalChunkToDom(runId, message.chunk, message.sequence || run.outputSeq);
    return;
  }
  if (applied && String(__pmChat.activeSessionId || '') === sessionId) window.__pmRenderActiveChatThread?.();
}

['process_run_started', 'process_run_update', 'process_run_exited'].forEach((eventType) => {
  wsEventBus.on(eventType, (message = {}) => _handleMobileInlineCommandProcessEvent(eventType, message));
});
wsEventBus.on('process_run_output', (message = {}) => _handleMobileInlineCommandProcessEvent('process_run_output', message));
wsEventBus.on('workspace_changes', (message = {}) => {
  if (_mergeMobileWorkspaceChangeEvent(message)) {
    window.__pmRenderActiveChatThread?.();
  }
});

document.addEventListener('toggle', async (event) => {
  const terminal = event.target?.closest?.('.tool-command-terminal.is-complete');
  if (!terminal?.open || terminal.dataset.logLoaded === '1' || terminal.dataset.logLoading === '1') return;
  const runId = String(terminal.dataset.commandRunId || '').trim();
  if (!runId) return;
  terminal.dataset.logLoading = '1';
  try {
    const log = await loadMobileProcessRunLog(runId);
    const output = terminal.querySelector('[data-command-terminal-output]');
    if (output) output.textContent = String(log?.combined || '(no output)');
    terminal.dataset.logLoaded = '1';
  } catch {
    const output = terminal.querySelector('[data-command-terminal-output]');
    if (output && /Open to load output/.test(output.textContent || '')) output.textContent = 'Could not load terminal output.';
  } finally {
    delete terminal.dataset.logLoading;
  }
}, true);

function _appendMobileCompactionTrace(message, status = 'compacting', summary = '', extra = null) {
  if (!message) return;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  _flushMobileTraceThoughtProbe(message, { force: true });
  const normalizedStatus = String(status || 'compacting').toLowerCase();
  const label = normalizedStatus === 'compacting'
    ? 'Compacting Context'
    : normalizedStatus === 'failed'
      ? 'Context Compaction Failed'
      : normalizedStatus === 'skipped'
        ? 'Context Compaction Skipped'
        : 'Context Compacted';
  const cleanSummary = String(summary || extra?.summary || '').trim();
  const last = message.liveTraceEntries[message.liveTraceEntries.length - 1];
  const payload = extra && typeof extra === 'object' ? extra : {};
  if (last && String(last.type || '').toLowerCase() === 'compaction') {
    last.text = label;
    last.status = normalizedStatus;
    if (cleanSummary) last.summary = cleanSummary;
    last.extra = { ...(last.extra || {}), ...payload };
    return;
  }
  message.liveTraceEntries.push({
    id: `mtrace_compact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'compaction',
    text: label,
    status: normalizedStatus,
    summary: cleanSummary,
    extra: payload,
    time: _nowTime(),
  });
}

function _isRenderableMobileTraceImageSource(value) {
  return !!buildMobileVisionPreviewUrl(value);
}

function _appendMobileVisionTrace(message, evt) {
  if (!message || !evt) return;
  const preview = evt.preview && typeof evt.preview === 'object' ? evt.preview : {};
  const rawDataUrl = String(preview.dataUrl || evt.dataUrl || '').trim();
  const dataUrl = buildMobileVisionPreviewUrl(rawDataUrl);
  if (!_isRenderableMobileTraceImageSource(dataUrl)) return;
  const normalizedPreview = preview.dataUrl === dataUrl
    ? preview
    : { ...preview, dataUrl };
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const sourceValue = String(evt.source || '').toLowerCase();
  if (sourceValue === 'generated_image') message._pmBackgroundImageGeneration = true;
  const source = sourceValue === 'browser' ? 'Browser' : sourceValue === 'media_analysis' ? 'Media analysis' : sourceValue === 'generated_image' ? 'Generated image' : 'Desktop';
  const tool = String(evt.tool || evt.action || evt.name || '').trim();
  const text = String(evt.label || `Vision injected: ${tool ? _mobileToolLabel({ ...evt, action: tool }) : `${source} observation`}`).trim();
  if (sourceValue === 'generated_image') {
    const incomingPreviewId = String(normalizedPreview.previewId || '').trim();
    const incomingGenerationId = String(normalizedPreview.generationId || '').trim();
    const incomingWorkspacePath = String(normalizedPreview.workspacePath || '').trim();
    const incomingCacheKey = String(normalizedPreview.cacheKey || '').trim();
    const priorIndex = message.liveTraceEntries.findIndex((entry) =>
      entry?.type === 'vision'
      && String(entry?.preview?.artifactKind || '') === 'generated_image_partial'
      && (
        (!!incomingPreviewId && String(entry?.preview?.previewId || '') === incomingPreviewId)
        || (!!incomingGenerationId && String(entry?.preview?.generationId || '') === incomingGenerationId)
        || (!incomingPreviewId && !incomingGenerationId && !!incomingWorkspacePath && String(entry?.preview?.workspacePath || '') === incomingWorkspacePath)
        || (!incomingPreviewId && !incomingGenerationId && !!incomingCacheKey && String(entry?.preview?.cacheKey || '') === incomingCacheKey)
      )
    );
    if (priorIndex >= 0) message.liveTraceEntries.splice(priorIndex, 1);
  }
  const last = message.liveTraceEntries[message.liveTraceEntries.length - 1];
  if (last && last.type === 'vision' && String(last.text || '') === text && String(last?.preview?.dataUrl || '') === dataUrl) return;
  message.liveTraceEntries.push({
    id: `mtrace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'vision',
    text,
    time: _nowTime(),
    preview: normalizedPreview,
    previewTitle: String(evt.previewTitle || normalizedPreview.title || `${source} preview`),
    previewKey: _mobileVisionPreviewKey(dataUrl, normalizedPreview),
  });
}

function _appendMobileStreamingText(existing, chunk) {
  return appendFinalResponseDelta(existing, chunk);
}

function _clearMobileVisualStreamTimer(message) {
  if (!message || !message._pmVisualStreamTimer) return;
  try { clearTimeout(message._pmVisualStreamTimer); } catch {}
  message._pmVisualStreamTimer = 0;
}

function _flushMobileVisualStreamText(message, renderSoon = null) {
  if (!message) return;
  const full = String(message._pmVisualStreamFull || '');
  const pending = String(message._pmVisualStreamPending || '');
  if (!full && !pending) {
    _clearMobileVisualStreamTimer(message);
    return;
  }
  if (!message.body || typeof message.body !== 'object') message.body = { text: '' };
  const next = full || _appendMobileStreamingText(String(message.body.text || ''), pending);
  beginFinalResponse(message);
  message.body.text = next;
  message.content = next;
  message._pmVisualStreamPending = '';
  message._pmVisualStreamFull = '';
  _clearMobileVisualStreamTimer(message);
  if (typeof renderSoon === 'function') renderSoon();
}

function _scheduleMobileVisualStreamFlush(message, renderSoon) {
  if (!message || message._pmVisualStreamTimer) return;
  // Coalesce provider-sized token bursts into calm visual frames. Re-rendering
  // the entire Markdown tree for every token makes iOS text visibly jump.
  message._pmVisualStreamTimer = setTimeout(() => {
    message._pmVisualStreamTimer = 0;
    _flushMobileVisualStreamText(message, renderSoon);
  }, 42);
}

function _appendMobileVisualStreamToken(message, chunk, renderSoon) {
  if (!message) return;
  const text = String(chunk || '');
  if (!text) return;
  if (!message.body || typeof message.body !== 'object') message.body = { text: '' };
  beginFinalResponse(message);
  const previousFull = String(message._pmVisualStreamFull || message.body.text || '');
  const nextFull = _appendMobileStreamingText(previousFull, text);
  const appended = nextFull.length >= previousFull.length ? nextFull.slice(previousFull.length) : '';
  if (!appended) return;
  message._pmVisualStreamPending = _appendMobileStreamingText(String(message._pmVisualStreamPending || ''), appended);
  message._pmVisualStreamFull = nextFull;
  _scheduleMobileVisualStreamFlush(message, renderSoon);
}

function _finishMobileVisualStreamText(message, finalText = '', renderSoon = null) {
  if (!message) return;
  _clearMobileVisualStreamTimer(message);
  if (!message.body || typeof message.body !== 'object') message.body = { text: '' };
  const explicit = String(finalText || '');
  if (explicit) {
    const canonical = reconcileFinalResponse(String(message.body.text || message.content || ''), explicit);
    message.body.text = canonical;
    message.content = canonical;
  } else {
    _flushMobileVisualStreamText(message, renderSoon);
    message.content = String(message.body.text || message.content || '');
  }
  message._pmVisualStreamPending = '';
  message._pmVisualStreamFull = '';
}

function _mobileVisionPreviewKey(dataUrl, preview = {}) {
  const raw = String(dataUrl || preview?.dataUrl || '').trim();
  if (!raw) return '';
  let hash = 0;
  const seed = `${raw.length}|${raw.slice(0, 96)}|${raw.slice(-96)}|${preview?.width || ''}x${preview?.height || ''}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `vision_${Math.abs(hash).toString(36)}_${raw.length.toString(36)}`;
}

function _isMobileStartupStatusText(value) {
  return /^(request received\. starting chat turn|preparing chat context|preparing prometheus runtime|building model context)/i
    .test(String(value || '').trim());
}

function _isMobileVisionInjectionStatusText(value) {
  return /^vision screenshot injected \((?:desktop|browser)\) after\b/i
    .test(String(value || '').replace(/\s+/g, ' ').trim());
}

function _isMobileBareThinkingTraceText(value) {
  return /^thinking(?:\.\.\.)?$/i.test(String(value || '').replace(/\s+/g, ' ').trim());
}

function _mobileTraceTextLooksLikeFinalAnswer(text, finalText) {
  const trace = String(text || '').replace(/\s+/g, ' ').trim();
  const final = String(finalText || '').replace(/\s+/g, ' ').trim();
  if (!trace || !final) return false;
  if (trace === final) return true;
  const traceLower = trace.toLowerCase();
  const finalLower = final.toLowerCase();
  if (trace.length >= 32 && finalLower.startsWith(traceLower)) return true;
  if (final.length >= 32 && traceLower.startsWith(finalLower)) return true;
  return false;
}

function _mergeMobileLiveTraceIntoProcess(message) {
  if (!message) return;
  _flushMobileTraceThoughtProbe(message, { force: true });
  message.processEntries = _mobileDurableReasoningEntries(message.processEntries);
  const traces = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!traces.length) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const existing = new Set(message.processEntries.map((entry) =>
    `${String(entry?.type || '').toLowerCase()}|${_mobileTraceThoughtKind(entry)}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`
  ));
  for (const trace of traces) {
    if (_isMobileTransientReasoningTraceEntry(trace)) continue;
    const type = String(trace?.type || 'info').toLowerCase();
    const rawText = String(trace?.text || '').trim();
    const text = (type === 'preamble' || type === 'think' || type === 'assistant')
      ? _dedupeMobileTraceProseText(rawText)
      : rawText;
    if (!text || (type !== 'preamble' && type !== 'think' && !_isMobileTraceReasoningSummaryType(type))) continue;
    const key = `${type}|${_mobileTraceThoughtKind({ ...trace, type })}|${text.replace(/\s+/g, ' ').trim()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    message.processEntries.unshift({
      id: `trace_proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      text,
      time: String(trace?.time || _nowTime()),
      ...(trace?.extra && typeof trace.extra === 'object' ? { extra: { ...trace.extra } } : {}),
    });
  }
}

function _mobileProcessEntriesWithLiveTrace(message, entries) {
  const out = _mobileDurableReasoningEntries(entries).map((entry) => ({ ...entry }));
  const traces = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!traces.length) return out;
  const existing = new Set(out.map((entry) =>
    `${String(entry?.type || '').toLowerCase()}|${_mobileTraceThoughtKind(entry)}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`
  ));
  const liveEntries = [];
  for (const trace of traces) {
    if (_isMobileTransientReasoningTraceEntry(trace)) continue;
    const type = String(trace?.type || 'info').toLowerCase();
    const rawText = String(trace?.text || '').trim();
    const text = (type === 'preamble' || type === 'think' || type === 'assistant')
      ? _dedupeMobileTraceProseText(rawText)
      : rawText;
    if (!text || (type !== 'preamble' && type !== 'think' && !_isMobileTraceReasoningSummaryType(type))) continue;
    const key = `${type}|${_mobileTraceThoughtKind({ ...trace, type })}|${text.replace(/\s+/g, ' ').trim()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    liveEntries.push({
      id: `trace_proc_preview_${liveEntries.length}`,
      type,
      text,
      time: String(trace?.time || _nowTime()),
      ...(trace?.extra && typeof trace.extra === 'object' ? { extra: { ...trace.extra } } : {}),
    });
  }
  return liveEntries.length ? [...liveEntries, ...out] : out;
}

function _mobileWorkflowTraceEntriesForMessage(message) {
  const out = [];
  const seen = new Set();
  const liveSources = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  // The durable process log is a recovery fallback, not a second narration
  // channel. When the stream already supplied thought text, replaying the
  // same planning updates from processEntries produces duplicate prose rows.
  const structuredActions = new Set(liveSources.map((entry) => String(
    entry?.activity?.action
      || entry?.extra?.action
      || entry?.extra?.toolName
      || entry?.action
      || entry?.toolName
      || '',
  ).trim()).filter(Boolean));
  const structuredCallIds = new Set(liveSources.map((entry) => String(
    entry?.activity?.callId
      || entry?.extra?.toolCallId
      || entry?.extra?.tool_call_id
      || entry?.toolCallId
      || '',
  ).trim()).filter(Boolean));
  const finalText = String(message?.body?.text || message?.content || '').replace(/\s+/g, ' ').trim();
  const add = (entry, fallbackType = 'info', fromProcess = false) => {
    if (!entry || typeof entry !== 'object') return;
    entry = _normalizeMobileRecoveredTraceEntry(entry);
    if (_isMobileTransientReasoningTraceEntry(entry)) return;
    if (_isMobileHiddenRuntimeProcessEntry(entry)) return;
    let type = String(entry.type || entry.kind || fallbackType || 'info').toLowerCase();
    let text = String(entry.text || entry.content || entry.message || '').trim();
    const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : null;
    const action = String(extra?.action || extra?.toolName || entry.action || entry.toolName || '').trim();
    const callId = String(extra?.toolCallId || extra?.tool_call_id || entry.toolCallId || '').trim();
    if (fromProcess && action && (structuredActions.has(action) || (callId && structuredCallIds.has(callId)))
      && ['tool', 'skill', 'result', 'error', 'info', 'progress'].includes(type)) return;
    if (action === 'context_compaction') {
      const status = String(extra?.extra?.status || extra?.status || '').toLowerCase()
        || (type === 'error' ? 'failed' : type === 'tool' ? 'compacting' : 'compacted');
      type = 'compaction';
      text = status === 'compacting'
        ? 'Compacting Context'
        : status === 'failed'
          ? 'Context Compaction Failed'
          : status === 'skipped'
            ? 'Context Compaction Skipped'
            : 'Context Compacted';
      entry = {
        ...entry,
        type,
        text,
        status,
        summary: String(extra?.extra?.summary || extra?.summary || entry.summary || '').trim(),
      };
    }
    if (type === 'preamble' || type === 'think' || type === 'assistant') {
      text = _dedupeMobileTraceProseText(text);
    }
    if (_isMobileTraceThoughtType(type) && !_isMobileUserVisibleReasoningTraceEntry({ ...entry, type, extra })) return;
    const preview = entry.preview && typeof entry.preview === 'object' ? entry.preview : null;
    const previewData = String(preview?.dataUrl || entry.dataUrl || '').trim();
    if (!text && !previewData) return;
    if (text && _isMobileStartupStatusText(text)) return;
    if (type === 'user' || type === 'final' || /^user\s*:/i.test(text)) return;
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    if (_isMobileVisionInjectionStatusText(normalizedText)) return;
    if (_isMobileBareThinkingTraceText(normalizedText) && !previewData) return;
    if (_mobileTraceTextLooksLikeFinalAnswer(normalizedText, finalText) && !previewData) return;
    if (type === 'process' || type === 'info') {
      if (!previewData) return;
    }
    const thoughtKind = _mobileTraceThoughtKind({ ...entry, type, extra });
    const key = `${type}|${thoughtKind}|${normalizedText}|${previewData.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ...entry,
      type,
      text,
      time: String(entry.time || entry.ts || entry.timestamp || _nowTime()),
    });
  };
  (Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : []).forEach((entry) => add(entry, 'info'));
  (Array.isArray(message?.processEntries) ? message.processEntries : []).forEach((entry) => add(entry, 'process', true));
  const bodyEntries = Array.isArray(message?.body?.processEntries) ? message.body.processEntries : [];
  bodyEntries.forEach((entry) => add(entry, 'process', true));
  return out;
}

function _mergeMobileWorkflowTraceFromProcessEntries(message) {
  if (!message) return false;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const derived = _mobileWorkflowTraceEntriesForMessage({
    ...message,
    liveTraceEntries: [],
  });
  if (!derived.length) return false;
  const traceDedupeKey = (entry) => {
    const type = String(entry?.type || '').toLowerCase();
    const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim();
    const preview = String(entry?.preview?.dataUrl || entry?.dataUrl || '').slice(0, 120);
    const thoughtType = type === 'preamble' || type === 'think' || type === 'assistant';
    const thoughtKind = thoughtType ? _mobileTraceThoughtKind(entry) : '';
    return `${thoughtType ? 'thought' : type}|${thoughtKind}|${text}|${preview}`;
  };
  const isThoughtTraceEntry = (entry) => {
    const type = String(entry?.type || '').toLowerCase();
    return type === 'preamble' || type === 'think' || type === 'assistant';
  };
  // A cold recovery may have only process entries. Reconstruct every curated
  // visible thought in order; retaining only the latest one makes a recovered
  // turn look like a single flat tool stream and loses the reasoning between
  // tool calls. Explicit live thoughts remain authoritative when present.
  const existing = new Set(message.liveTraceEntries.map((entry) =>
    traceDedupeKey(entry)
  ));
  const existingThoughts = message.liveTraceEntries
    .filter(isThoughtTraceEntry)
    .map((entry) => ({
      kind: _mobileTraceThoughtKind(entry),
      text: _dedupeMobileTraceProseText(entry?.text || entry?.content || ''),
    }))
    .filter((entry) => entry.text);
  let changed = false;
  for (let index = 0; index < derived.length; index += 1) {
    const entry = derived[index];
    const key = traceDedupeKey(entry);
    if (!key || existing.has(key)) continue;
    if (isThoughtTraceEntry(entry)) {
      const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '');
      const thoughtKind = _mobileTraceThoughtKind(entry);
      if (existingThoughts.some((seen) => seen.kind === thoughtKind && _mobileTraceThoughtTextsSimilar(seen.text, text))) continue;
      existingThoughts.push({ kind: thoughtKind, text });
    }
    existing.add(key);
    message.liveTraceEntries.push({
      ...entry,
      id: entry.id || `mtrace_proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });
    changed = true;
  }
  return changed;
}

function _moveMobilePreToolAnswerIntoPreamble(message) {
  if (!message || message.toolActivityStarted) return;
  _finishMobileVisualStreamText(message);
  const text = String(message.body?.text || message.content || '').trim();
  if (!text) return;
  if (_isMobileProgressNarration(text)) {
    _setMobileLiveProgressNarration(message, text);
  } else {
    _appendMobileLiveTrace(message, 'preamble', text, {
      extra: { visibility: 'user', source: 'reasoning_summary' },
    });
  }
  if (message.body) message.body.text = '';
  message.content = '';
  message.finalResponseStarted = false;
}

function _moveMobileAnswerTextIntoTrace(message, type = 'think') {
  if (!message) return;
  _finishMobileVisualStreamText(message);
  const text = String(message.body?.text || message.content || '').trim();
  if (!text) return;
  if (_isMobileProgressNarration(text)) {
    _setMobileLiveProgressNarration(message, text);
  } else {
    // Text that was already rendered in the assistant bubble is actual
    // reasoning/commentary. Tool activity may arrive after it, but that must
    // not turn it into a hidden raw-thought row.
    _appendMobileLiveTrace(message, type, text, {
      extra: {
        visibility: 'user',
        source: 'agent_thought',
        reasoningKind: 'full_thought',
      },
    });
  }
  if (message.body) message.body.text = '';
  message.content = '';
  message.finalResponseStarted = false;
}

function _moveMobileVisibleAnswerIntoWorkflowTrace(message) {
  _moveMobileAnswerTextIntoTrace(message, message?.toolActivityStarted ? 'think' : 'preamble');
}

function _shouldRouteMobileTokenToLiveTrace(message) {
  // Final answer deltas have an explicit transport boundary. Tool and
  // commentary events are never inferred from the timing of a text token.
  return false;
}

function _moveMobileWorkflowBubbleBeforeTool(message) {
  if (!message) return;
  if (!message.toolActivityStarted) {
    _moveMobilePreToolAnswerIntoPreamble(message);
    return;
  }
  _moveMobileAnswerTextIntoTrace(message, 'think');
}

function _mobileLiveTraceCompactionEnabled(message) {
  // Do not compact user-visible reasoning while it is arriving. A provider may
  // send a longer replacement/update in the next frame; compacting live made
  // legitimate reasoning paragraphs vanish before the turn settled.
  return message?.streaming !== true;
}

function _renderMobileLiveTracePreview(entry) {
  const preview = entry?.preview && typeof entry.preview === 'object' ? entry.preview : null;
  const dataUrl = String(preview?.dataUrl || entry?.dataUrl || '').trim();
  if (!_isRenderableMobileTraceImageSource(dataUrl)) return '';
  const source = buildMobileVisionPreviewUrl(dataUrl);
  if (!source) return '';
  const title = String(entry?.previewTitle || preview?.title || entry?.text || 'Vision preview').trim();
  const width = Number(preview?.width || entry?.width || 0);
  const height = Number(preview?.height || entry?.height || 0);
  const dims = width > 0 && height > 0 ? ` (${Math.round(width)}x${Math.round(height)})` : '';
  const aspect = width > 0 && height > 0 ? `${Math.max(1, Math.round(width))} / ${Math.max(1, Math.round(height))}` : '16 / 9';
  const key = String(entry?.previewKey || _mobileVisionPreviewKey(dataUrl, preview)).trim();
  return `<button type="button" class="pm-live-vision-preview" data-pm-live-vision-preview="${escapeHtml(key)}" title="${escapeHtml(title + dims)}" style="--pm-vision-aspect:${escapeHtml(aspect)}">
    <img src="${escapeHtml(source)}" alt="${escapeHtml(title)}" loading="eager" decoding="async"${width > 0 ? ` width="${escapeHtml(String(Math.round(width)))}"` : ''}${height > 0 ? ` height="${escapeHtml(String(Math.round(height)))}"` : ''}>
  </button>`;
}

function _normalizeMobileTraceProseText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/```/.test(raw)) return raw;
  // Some narration providers flatten Markdown boundaries while streaming
  // snapshots. A run of 3+ asterisks here is an interrupted separator, not
  // useful emphasis, and the known status verbs can otherwise get glued to the
  // preceding update ("workflowDeciding", "restartPlanning"). Repair only
  // those unmistakable shapes before handing the text to the Markdown parser.
  const repaired = raw
    .replace(/[ \t]*\*{3,}[ \t]*/g, '\n\n')
    .replace(/\*{2}(?=(?:Clarifying|Explaining|Confirming|Summarizing|Planning|Deciding|Inspecting|Preparing|Starting|Activating|Focusing|Prioritizing|Assessing|Attempting|Identifying|Verifying|Loading|Running|Capturing|Opening|Closing|Reading|Writing|Checking|Reviewing|Collecting|Invoking|Calling|Using|Searching|Coordinating|Waiting|Listing|Retrieving|Inferring|Implementing|Investigating|Exploring)\b)/g, '\n\n')
    .replace(
      /([a-z0-9_),.!?:])(?=(?:Clarifying|Explaining|Confirming|Summarizing|Planning|Deciding|Inspecting|Preparing|Starting|Activating|Focusing|Prioritizing|Evaluating|Assessing|Attempting|Identifying|Verifying|Loading|Running|Capturing|Opening|Closing|Reading|Writing|Checking|Reviewing|Collecting|Invoking|Calling|Using|Searching|Coordinating|Waiting|Listing|Retrieving|Inferring|Implementing|Investigating|Exploring)\b)/g,
      '$1\n\n',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Providers sometimes wrap an entire incremental thought in **...** over
  // several streamed lines. Marked cannot reliably parse that cross-line
  // emphasis while it is incomplete, so show the prose plainly instead of
  // leaking literal asterisks into the chat.
  const plainNarration = repaired
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .trim();
  const lines = plainNarration.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 5) return _normalizeCollapsedAgentMarkdown(plainNarration);

  const isShortWrappedLine = (line) => {
    const clean = String(line || '').trim();
    if (!clean) return false;
    if (/^[-*+]\s+/.test(clean) || /^\d+[.)]\s+/.test(clean)) return false;
    if (/^#{1,6}\s+/.test(clean)) return false;
    if (/^[,.;:!?)]$/.test(clean)) return true;
    const words = clean.split(/\s+/).filter(Boolean);
    return words.length <= 3 && clean.length <= 42;
  };
  const collapseWrappedLines = (items) => items
    .join(' ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const out = [];
  let run = [];
  const flushRun = () => {
    if (!run.length) return;
    if (run.length >= 2) out.push(collapseWrappedLines(run));
    else out.push(...run);
    run = [];
  };
  for (const line of lines) {
    if (isShortWrappedLine(line)) {
      run.push(line);
    } else {
      if (
        run.length >= 2
        && out.length
        && /^[a-z0-9'"(]/.test(String(run[0] || '').trim())
        && !/[.!?:]$/.test(String(out[out.length - 1] || '').trim())
      ) {
        out[out.length - 1] = collapseWrappedLines([out[out.length - 1], ...run, line]);
        run = [];
        continue;
      }
      flushRun();
      out.push(line);
    }
  }
  flushRun();
  return _normalizeCollapsedAgentMarkdown(out.join('\n').trim());
}

function _mobileTraceComparableText(value) {
  return _normalizeMobileTraceProseText(value)
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();
}

function _mobileTraceThoughtTextsSimilar(a, b) {
  const left = _mobileTraceComparableText(a);
  const right = _mobileTraceComparableText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 40 && (left.includes(right) || right.includes(left))) return true;
  const leftTokens = new Set(left.split(/[^a-z0-9_']+/i).filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(/[^a-z0-9_']+/i).filter((token) => token.length > 2));
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  if (smaller < 8) return false;
  let overlap = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) overlap += 1; });
  return overlap / smaller >= 0.72;
}

function _isMobileTraceThoughtFragmentText(value) {
  const raw = String(value || '').trim();
  const comparable = _mobileTraceComparableText(raw);
  if (!comparable) return true;
  const words = comparable.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (/[.!?]\s*$/.test(raw) || /\n\s*\n/.test(raw)) return false;
  if (words.length === 1 && comparable.length <= 16) return true;
  return false;
}

function _compactMobileTraceThoughtEntries(message) {
  const entries = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  if (entries.length < 2) return false;
  const kept = [];
  let changed = false;
  for (const entry of entries) {
    if (!_isMobileTraceThoughtType(entry?.type)) {
      kept.push(entry);
      continue;
    }
    const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '');
    const comparable = _mobileTraceComparableText(text);
    if (!comparable) {
      changed = true;
      continue;
    }
    if (_isMobileTraceThoughtFragmentText(text)) {
      changed = true;
      continue;
    }
    const thoughtKind = _mobileTraceThoughtKind(entry);
    const existingIndex = kept.findIndex((candidate) => {
      if (!_isMobileTraceThoughtType(candidate?.type)) return false;
      if (_mobileTraceThoughtKind(candidate) !== thoughtKind) return false;
      const existing = _mobileTraceComparableText(candidate?.text || candidate?.content || '');
      if (!existing) return false;
      return existing === comparable
        || (Math.min(existing.length, comparable.length) >= 18 && (existing.includes(comparable) || comparable.includes(existing)))
        || _mobileTraceThoughtTextsSimilar(existing, comparable);
    });
    if (existingIndex >= 0) {
      const existing = kept[existingIndex];
      const existingText = _dedupeMobileTraceProseText(existing?.text || existing?.content || '');
      const existingComparable = _mobileTraceComparableText(existingText);
      if (comparable.length > existingComparable.length && comparable.includes(existingComparable)) {
        kept[existingIndex] = { ...entry, text };
      }
      changed = true;
      continue;
    }
    kept.push({ ...entry, text });
  }
  if (changed) message.liveTraceEntries = kept;
  return changed;
}

function _isMobileTraceThoughtType(type) {
  const value = String(type || '').toLowerCase();
  return value === 'preamble' || value === 'think' || value === 'assistant' || value === 'reasoning_summary';
}

function _mobileTraceThoughtKind(entry) {
  if (!_isMobileTraceThoughtType(entry?.type)) return '';
  if (String(entry?.type || '').toLowerCase() === 'preamble') return 'full_thought';
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const explicit = String(extra.reasoningKind || extra.presentationKind || entry?.reasoningKind || '').trim().toLowerCase();
  if (explicit === 'full_thought') return 'full_thought';
  if (explicit === 'summary') return 'summary';
  const source = String(extra.source || entry?.source || '').trim().toLowerCase();
  return String(entry?.type || '').toLowerCase() === 'reasoning_summary'
    || source === 'reasoning_summary'
    || source === 'agent_progress'
    || String(extra.visibility || entry?.visibility || '').trim().toLowerCase() === 'summary'
    ? 'summary'
    : 'full_thought';
}

function _isMobileTraceReasoningSummaryType(type) {
  return String(type || '').toLowerCase() === 'reasoning_summary';
}

function _isMobileUserVisibleReasoningTraceEntry(entry) {
  const type = String(entry?.type || '').toLowerCase();
  if (type === 'preamble' || type === 'assistant') return true;
  if (type !== 'think' && !_isMobileTraceReasoningSummaryType(type)) return false;
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const reasoningKind = String(extra.reasoningKind || '').trim().toLowerCase();
  if (reasoningKind === 'private') return false;
  if (reasoningKind === 'summary' || reasoningKind === 'full_thought') return true;
  const source = String(extra.source || entry?.source || '').toLowerCase();
  return type === 'reasoning_summary'
    ? source === 'reasoning_summary' || source === 'agent_progress' || extra.visibility === 'user' || extra.visibility === 'summary'
    : source === 'reasoning_summary' || source === 'agent_progress' || source === 'agent_thought' || extra.visibility === 'user';
}

function _mobileTraceThoughtCoveredByEarlier(message, text, excludeEntry = null, candidateEntry = null) {
  const candidate = _mobileTraceComparableText(text);
  if (!message || !candidate) return false;
  const candidateWords = candidate.split(/\s+/).filter(Boolean).length;
  const canUseContainedTail = candidate.length >= 18 && candidateWords >= 3;
  const canUseSimilarity = candidate.length >= 36;
  if (!canUseContainedTail && !canUseSimilarity) return false;
  const thoughtKind = _mobileTraceThoughtKind(candidateEntry || { type: excludeEntry?.type || 'think' });
  const entries = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  return entries.some((entry) => {
    if (!entry || entry === excludeEntry) return false;
    if (!_isMobileTraceThoughtType(entry.type)) return false;
    if (_mobileTraceThoughtKind(entry) !== thoughtKind) return false;
    const existing = _mobileTraceComparableText(entry.text || entry.content || '');
    if (!existing || existing === candidate) return !!existing;
    if (canUseContainedTail && existing.length >= candidate.length && existing.includes(candidate)) return true;
    return canUseSimilarity && _mobileTraceThoughtTextsSimilar(existing, candidate);
  });
}

function _mobileTraceShouldProbeThought(message, type, append, extra = null) {
  if (!message || !append || !_isMobileTraceThoughtType(type)) return false;
  const entries = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  const last = entries[entries.length - 1];
  if (!last || String(last.type || '').toLowerCase() !== String(type || '').toLowerCase()) return true;
  return _mobileTraceThoughtKind(last)
    !== _mobileTraceThoughtKind({ type, extra });
}

function _pushMobileTraceThoughtEntry(message, type, text, time = '', extra = null) {
  const trimmed = _dedupeMobileTraceProseText(text);
  if (!message || !trimmed) return null;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const entry = {
    id: `mtrace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: String(type || 'preamble').toLowerCase(),
    text: trimmed,
    ts: Date.now(),
    time: String(time || _nowTime()),
    ...(extra && typeof extra === 'object' ? { extra } : {}),
  };
  message.liveTraceEntries.push(entry);
  return entry;
}

function _flushMobileTraceThoughtProbe(message, { force = false } = {}) {
  const probe = message?._pmTraceThoughtProbe;
  if (!message || !probe || !probe.text) return false;
  const type = String(probe.type || 'think').toLowerCase();
  const text = String(probe.text || '');
  delete message._pmTraceThoughtProbe;
  if (_mobileTraceThoughtCoveredByEarlier(message, text, null, { type, extra: probe.extra })) return false;
  const comparable = _mobileTraceComparableText(text);
  const ready = force || comparable.length >= 48 || /[.!?]\s*$/.test(text) || /\n\s*\n/.test(text);
  if (!ready) {
    message._pmTraceThoughtProbe = {
      type,
      text,
      time: probe.time || _nowTime(),
      extra: probe.extra && typeof probe.extra === 'object' ? { ...probe.extra } : null,
    };
    return false;
  }
  _pushMobileTraceThoughtEntry(message, type, text, probe.time || _nowTime(), probe.extra);
  return true;
}

function _dedupeMobileTraceProseText(value) {
  const normalized = _normalizeMobileTraceProseText(value);
  if (!normalized || /```/.test(normalized)) return normalized;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return normalized;
  const isTitleLike = (line) => {
    const clean = String(line || '').replace(/^[#*_`\s]+|[*_`\s]+$/g, '').trim();
    if (!clean || clean.length > 96 || /[.!?]$/.test(clean)) return false;
    const words = clean.split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 9;
  };
  for (let i = 0; i < lines.length - 2; i += 1) {
    if (!isTitleLike(lines[i])) continue;
    const titleKey = _mobileTraceComparableText(lines[i]);
    if (!titleKey) continue;
    for (let j = i + 2; j < lines.length; j += 1) {
      const repeatedLineKey = _mobileTraceComparableText(lines[j]);
      if (repeatedLineKey !== titleKey && !repeatedLineKey.startsWith(`${titleKey} `)) continue;
      const firstBlock = lines.slice(i, j).join('\n');
      const duplicateTail = lines.slice(j).join('\n');
      const firstComparable = _mobileTraceComparableText(firstBlock);
      const tailComparable = _mobileTraceComparableText(duplicateTail);
      if (!tailComparable) continue;
      if (
        _mobileTraceThoughtTextsSimilar(firstBlock, duplicateTail)
        || (tailComparable.length >= titleKey.length && firstComparable.startsWith(tailComparable))
      ) {
        return lines.slice(0, j).join('\n').trim();
      }
    }
  }
  return normalized;
}

function _mobileTraceJsonPayload(text) {
  const raw = String(text || '');
  const start = raw.search(/[\[{]/);
  if (start < 0) return null;
  const opener = raw[start];
  const closer = opener === '[' ? ']' : '}';
  const end = raw.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}


function _renderMobileGeneratedFiles(files) {
  const media = _normalizeMobileMediaList(files);
  if (!media.length) return '';
  return _renderMobileMediaGallery(media);
}

function _mobileFileExt(pathOrName) {
  const base = String(pathOrName || '').split(/[\\/]/).pop() || '';
  const m = base.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return m ? m[1] : '';
}

function _mobileMediaKind(item) {
  const declared = String(item?.kind || item?.type || '').toLowerCase();
  const mime = String(item?.mime_type || item?.mimeType || '').toLowerCase();
  const src = String(item?.path || item?.absPath || item?.rel_path || item?.relPath || item?.cache_path || item?.cachePath || item?.url || item?.src || item || '');
  const ext = _mobileFileExt(src || item?.file_name || item?.fileName || item?.name);
  if (declared === 'image' || mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) return 'image';
  if (declared === 'video' || mime.startsWith('video/') || ['mp4','webm','mov','m4v','avi','mkv'].includes(ext)) return 'video';
  if (declared === 'audio' || mime.startsWith('audio/') || ['mp3','wav','m4a','ogg','aac','flac'].includes(ext)) return 'audio';
  return 'file';
}

function _mobileMediaPath(item) {
  if (typeof item === 'string') return item.trim();
  return String(item?.path || item?.absPath || item?.rel_path || item?.relPath || item?.to_path || item?.toPath || item?.from_path || item?.fromPath || item?.cache_path || item?.cachePath || item?.workspacePath || item?.url || item?.src || '').trim();
}

function _mobileMediaName(item, path) {
  if (typeof item === 'string') return String(path || item).split(/[\\/]/).pop() || 'file';
  return String(item?.file_name || item?.fileName || item?.name || item?.title || String(path || '').split(/[\\/]/).pop() || 'file').trim();
}

function _mobileMediaUrl(media, mode = 'inline') {
  if (media.dataUrl) return media.dataUrl;
  if (/^https?:\/\//i.test(media.path)) return media.path;
  if (!media.path) return '#';
  if (mode === 'download') return buildDownloadMediaUrl(media.path);
  const ext = _mobileFileExt(media.path || media.name);
  if (['html', 'htm'].includes(ext)) return buildWorkspaceCanvasUrl(media.path);
  return buildInlineMediaUrl(media.path);
}

function _normalizeMobileMedia(item) {
  if (!item) return null;
  const dataUrl = item?.dataUrl || (item?.base64 ? `data:${item?.mimeType || item?.mime_type || 'image/png'};base64,${item.base64}` : '');
  const path = _mobileMediaPath(item);
  if (!path && !dataUrl) return null;
  const kind = _mobileMediaKind(item);
  const name = _mobileMediaName(item, path || dataUrl);
  return {
    kind,
    path,
    dataUrl,
    name,
    prompt: String(item?.prompt || item?.revised_prompt || item?.revisedPrompt || '').trim(),
    provider: String(item?.provider || '').trim(),
    model: String(item?.model || '').trim(),
    bytes: Number(item?.bytes || 0) || 0,
    generated: item?.generated === true,
    gallery: item?.gallery === true,
    deliveryBatchId: String(item?.deliveryBatchId || item?.batchId || '').trim(),
    deliveryBatchIndex: Number.isFinite(Number(item?.deliveryBatchIndex ?? item?.batchIndex))
      ? Number(item?.deliveryBatchIndex ?? item?.batchIndex)
      : -1,
  };
}

function _normalizeMobileMediaList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const seen = new Set();
  return list.map(_normalizeMobileMedia).filter((media) => {
    if (!media) return false;
    const key = media.dataUrl || media.path || media.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _dedupeMobileMediaList(mediaList) {
  const seen = new Set();
  return (Array.isArray(mediaList) ? mediaList : []).filter((media) => {
    const key = media?.dataUrl || media?.path || media?.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _collectMessageGeneratedImages(m) {
  const b = m?.body || {};
  // Background generations are working assets. They are already rendered in
  // the tool timeline by the generated-image vision event, so promoting the
  // same files into the assistant's large final gallery duplicates the image.
  // Check the durable trace as well as the live flag so reopened chats keep the
  // same presentation.
  const traceSources = [
    ...(Array.isArray(m?.liveTraceEntries) ? m.liveTraceEntries : []),
    ...(Array.isArray(m?.processEntries) ? m.processEntries : []),
    ...(Array.isArray(b?.processEntries) ? b.processEntries : []),
  ];
  const hasInlineGeneratedImage = m?._pmBackgroundImageGeneration === true
    || traceSources.some((entry) => /^generated_image(?:_|$)/i.test(String(entry?.preview?.artifactKind || '')));
  if (hasInlineGeneratedImage) return [];
  return _normalizeMobileMediaList(m?.generatedImages || b.generatedImages).map(x => ({ ...x, kind: 'image', generated: true }));
}

function _collectMessageGeneratedVideos(m) {
  const b = m?.body || {};
  return _normalizeMobileMediaList(m?.generatedVideos || b.generatedVideos).map(x => ({ ...x, kind: 'video', generated: true }));
}

function _collectMessageMedia(m) {
  const b = m.body || {};
  const fromImages = _collectMessageGeneratedImages(m);
  const fromVideos = _collectMessageGeneratedVideos(m);
  const fromFiles = _normalizeMobileMediaList(b.files || m.files);
  return _dedupeMobileMediaList([...fromImages, ...fromVideos, ...fromFiles]);
}

function _mergeMobileMediaIntoMessage(message, items) {
  if (!message) return;
  const merged = _normalizeMobileMediaList([
    ..._normalizeMobileMediaList(message.body?.files),
    ..._normalizeMobileMediaList(message.files),
    ..._normalizeMobileMediaList(items),
  ]);
  if (!merged.length) return;
  const files = merged.map((media) => ({
    kind: media.kind,
    path: media.path,
    dataUrl: media.dataUrl,
    name: media.name,
    file_name: media.name,
    bytes: media.bytes,
    generated: media.generated === true,
    gallery: media.gallery === true,
    deliveryBatchId: media.deliveryBatchId,
    deliveryBatchIndex: media.deliveryBatchIndex,
  }));
  if (!message.body || typeof message.body !== 'object') message.body = { sender: 'Prometheus', text: '' };
  message.body.files = files;
  message.files = files;
}

function _mergeMobileProductCarouselIntoMessage(message, carousel) {
  if (!message || !carousel || typeof carousel !== 'object') return;
  const items = Array.isArray(carousel.items) ? carousel.items.filter(Boolean) : [];
  if (!items.length) return;
  const existingItems = Array.isArray(message.productCarousel?.items) ? message.productCarousel.items : [];
  const byKey = new Map();
  for (const item of existingItems) {
    const key = String(item?.productUrl || item?.title || '').trim();
    if (key) byKey.set(key, item);
  }
  for (const item of items) {
    const key = String(item?.productUrl || item?.title || '').trim();
    if (key && !byKey.has(key)) byKey.set(key, item);
  }
  const mergedItems = Array.from(byKey.values());
  if (!mergedItems.length) return;
  message.productCarousel = {
    title: String(message.productCarousel?.title || carousel.title || '').trim(),
    items: mergedItems,
  };
}

function _mobileMessagesRepresentSameTurn(a, b) {
  if (!a || !b || String(a.role || '') !== String(b.role || '')) return false;
  const aGoalTurn = String(a.goalTurnId || '').trim();
  const bGoalTurn = String(b.goalTurnId || '').trim();
  if (aGoalTurn && bGoalTurn) return aGoalTurn === bGoalTurn;
  const aRequest = String(a._clientRequestId || '').trim();
  const bRequest = String(b._clientRequestId || '').trim();
  const aMessageId = String(a.messageId || '').trim();
  const bMessageId = String(b.messageId || '').trim();
  const requestIdentityMatches = !!aRequest && !!bRequest && aRequest === bRequest;
  // The cached optimistic row often has no messageId while the hydrated row
  // does. Do not reject a matching request identity just because the server
  // assigned a new id during reconnect.
  if (aMessageId && bMessageId && aMessageId !== bMessageId && !requestIdentityMatches) return false;
  const aWorkflowPart = String(a.workflowPart || '').trim();
  const bWorkflowPart = String(b.workflowPart || '').trim();
  const aWorkflowGroup = String(a.workflowGroupId || '').trim();
  const bWorkflowGroup = String(b.workflowGroupId || '').trim();
  if (aWorkflowPart || bWorkflowPart || aWorkflowGroup || bWorkflowGroup) {
    if (!aWorkflowPart || !bWorkflowPart || aWorkflowPart !== bWorkflowPart) return false;
    if ((aWorkflowGroup || bWorkflowGroup) && (!aWorkflowGroup || aWorkflowGroup !== bWorkflowGroup)) return false;
  }
  const aKind = String(a.messageKind || '').trim();
  const bKind = String(b.messageKind || '').trim();
  if (aKind || bKind) {
    if (!aKind || aKind !== bKind) return false;
  }
  if (aRequest || bRequest) return !!aRequest && aRequest === bRequest;
  const aText = _mobileMessageCopyText(a).replace(/\s+/g, ' ').trim();
  const bText = _mobileMessageCopyText(b).replace(/\s+/g, ' ').trim();
  if (aText && bText && aText === bText) return true;
  const aSource = Number(a.sourceIndex);
  const bSource = Number(b.sourceIndex);
  return Number.isFinite(aSource) && aSource >= 0 && aSource === bSource;
}

function _mobileUserAttachmentSignature(msg) {
  const attachments = [
    ...(Array.isArray(msg?.attachmentPreviews) ? msg.attachmentPreviews : []),
    ...(Array.isArray(msg?.body?.attachments) ? msg.body.attachments : []),
  ];
  const keys = attachments.map((item) => {
    const path = String(item?.workspacePath || item?.path || item?.filePath || '').trim().toLowerCase();
    const name = String(item?.name || item?.file_name || item?.fileName || '').trim().toLowerCase();
    const mime = String(item?.mimeType || item?.type || '').trim().toLowerCase();
    return `${path || name}|${mime}`;
  }).filter((key) => key !== '|');
  return [...new Set(keys)].sort().join(';;');
}

function _mergeMobileUserTurnDetails(target, source) {
  if (!target || !source || target === source) return target;
  const targetBody = target.body && typeof target.body === 'object' ? target.body : { text: '' };
  const sourceText = _mobileMessageCopyText(source);
  const targetText = _mobileMessageCopyText(target);
  if ((!targetText
    || /^attached file\(s\)$/i.test(targetText)
    || /^please review the attached file\(s\)\.?$/i.test(targetText)) && sourceText) {
    targetBody.text = sourceText;
    target.content = sourceText;
  }
  const sourceAttachments = [
    ...(Array.isArray(source?.attachmentPreviews) ? source.attachmentPreviews : []),
    ...(Array.isArray(source?.body?.attachments) ? source.body.attachments : []),
  ];
  const targetAttachments = [
    ...(Array.isArray(target?.attachmentPreviews) ? target.attachmentPreviews : []),
    ...(Array.isArray(targetBody.attachments) ? targetBody.attachments : []),
  ];
  if (sourceAttachments.length || targetAttachments.length) {
    const seen = new Set();
    const merged = [...targetAttachments, ...sourceAttachments].filter((item) => {
      const key = `${String(item?.workspacePath || item?.path || item?.filePath || item?.name || '').trim().toLowerCase()}|${String(item?.size || item?.bytes || '').trim()}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    targetBody.attachments = merged;
    target.attachmentPreviews = merged;
  }
  if (!String(target._clientRequestId || '').trim() && String(source._clientRequestId || '').trim()) {
    target._clientRequestId = String(source._clientRequestId).trim();
  }
  if (!target.uploadState && source.uploadState) target.uploadState = source.uploadState;
  target.timestamp = Math.min(Number(target.timestamp || Date.now()), Number(source.timestamp || Date.now()));
  return target;
}

function _mobileUserTurnsRepresentSameSend(a, b) {
  if (!a || !b || a.role !== 'user' || b.role !== 'user') return false;
  const aRequest = String(a._clientRequestId || '').trim();
  const bRequest = String(b._clientRequestId || '').trim();
  if (aRequest && bRequest) return aRequest === bRequest;
  const aText = _mobileMessageCopyText(a).replace(/\s+/g, ' ').trim().toLowerCase();
  const bText = _mobileMessageCopyText(b).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!aText || aText !== bText) return false;
  if (_mobileUserAttachmentSignature(a) !== _mobileUserAttachmentSignature(b)) return false;
  return Math.abs(Number(a.timestamp || 0) - Number(b.timestamp || 0)) < 15_000;
}

function _dedupeMobileUserTurns(thread) {
  const list = Array.isArray(thread) ? thread : [];
  for (let i = 0; i < list.length; i += 1) {
    const current = list[i];
    if (!current || current.role !== 'user') continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      const previous = list[j];
      if (!previous || previous.role !== 'user') continue;
      if (!_mobileUserTurnsRepresentSameSend(previous, current)) break;
      _mergeMobileUserTurnDetails(previous, current);
      list.splice(i, 1);
      i -= 1;
      break;
    }
  }
  return list;
}

function _mergeMobileThreadLocalArtifacts(nextThread, localThread) {
  const next = Array.isArray(nextThread) ? nextThread : [];
  const local = Array.isArray(localThread) ? localThread : [];
  if (!local.length) return next;
  if (!next.length) return local;
  for (const msg of next) {
    if (!msg || msg.role !== 'user' || _isMobileVoiceAgentWorkerHandoff(msg)) continue;
    const localHandoff = _findMobileVoiceWorkerHandoffByText(local, _mobileMessageCopyText(msg), msg.timestamp);
    if (localHandoff) _promoteMobileVoiceWorkerHandoffMessage(msg, localHandoff);
  }
  next.forEach((msg, index) => {
    if (!msg || msg.role !== 'ai') return;
    const localCandidate = local.find((candidate) => candidate?.role === 'ai' && _mobileMessagesRepresentSameTurn(msg, candidate));
    if (localCandidate) {
      _mergeMobileAssistantTurnDetails(msg, localCandidate);
      _mergeMobileMediaIntoMessage(msg, _collectMessageMedia(localCandidate));
      _mergeMobileProductCarouselIntoMessage(msg, localCandidate.productCarousel);
    }
  });
  const localLatest = _findLatestAssistantTurn(local);
  const nextLatest = _findLatestAssistantTurn(next);
  if (localLatest && nextLatest && _mobileMessagesRepresentSameTurn(nextLatest, localLatest)) {
    _mergeMobileAssistantTurnDetails(nextLatest, localLatest);
    _mergeMobileMediaIntoMessage(nextLatest, _collectMessageMedia(localLatest));
    _mergeMobileProductCarouselIntoMessage(nextLatest, localLatest.productCarousel);
  }
  const previousUserTextBefore = (list, index) => {
    for (let i = Math.min(Number(index) || 0, list.length - 1) - 1; i >= 0; i -= 1) {
      if (String(list[i]?.role || '') === 'user') {
        return _mobileMessageCopyText(list[i]).replace(/\s+/g, ' ').trim().toLowerCase();
      }
    }
    return '';
  };
  const hasCompletedServerTurnForLocalAssistant = (candidate) => {
    if (!candidate || String(candidate.role || '') !== 'ai') return false;
    if (candidate.streaming !== true && !String(candidate._clientRequestId || '').trim()) return false;
    const candidateRequestId = String(candidate._clientRequestId || '').trim();
    if (candidateRequestId) {
      return next.some((msg) => msg
        && String(msg.role || '') === 'ai'
        && msg.streaming !== true
        && _mobileAssistantHasVisibleAnswer(msg)
        && String(msg._clientRequestId || '').trim() === candidateRequestId
        && _mobileMessagesRepresentSameTurn(msg, candidate));
    }
    const candidateIndex = local.indexOf(candidate);
    const localPrompt = previousUserTextBefore(local, candidateIndex);
    const candidateStartedAt = Number(candidate.workStartedAt || candidate.startedAt || candidate.timestamp || 0) || 0;
    return next.some((msg, index) => {
      if (!msg || String(msg.role || '') !== 'ai' || msg.streaming === true || !_mobileAssistantHasVisibleAnswer(msg)) return false;
      // A realtime Voice Agent acknowledgement follows the handoff user turn,
      // but it is not the foreground Worker's answer. Never let that adjacent
      // acknowledgement evict the still-streaming local Worker trace.
      if (candidate._voiceWorkerLocalTurn === true && _isMobileVoiceAgentAssistantTurn(msg)) return false;
      const nextPrompt = previousUserTextBefore(next, index);
      if (localPrompt && nextPrompt && localPrompt === nextPrompt) return true;
      const serverStartedAt = Number(msg.workStartedAt || msg.startedAt || msg.timestamp || 0) || 0;
      return !!candidateStartedAt && !!serverStartedAt && Math.abs(candidateStartedAt - serverStartedAt) < 30_000;
    });
  };
  const hasMatchingTurn = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return true;
    const role = String(candidate.role || '');
    const clientRequestId = String(candidate._clientRequestId || '').trim();
    const text = _mobileMessageCopyText(candidate).replace(/\s+/g, ' ').trim();
    if (role === 'ai' && hasCompletedServerTurnForLocalAssistant(candidate)) return true;
    return next.some((msg) => {
      if (!msg || String(msg.role || '') !== role) return false;
      if (clientRequestId && String(msg._clientRequestId || '').trim() === clientRequestId) {
        return _mobileMessagesRepresentSameTurn(msg, candidate);
      }
      const msgText = _mobileMessageCopyText(msg).replace(/\s+/g, ' ').trim();
      return !!text && !!msgText && msgText === text;
    });
  };
  const insertForegroundWorkerAfterHandoff = (candidate) => {
    if (!candidate || candidate.role !== 'ai') return false;
    const candidateRequestId = String(candidate._clientRequestId || '').trim();
    const isForegroundWorker = candidate._voiceWorkerLocalTurn === true
      || String(candidate.messageKind || '').trim() === 'voice_foreground_worker';
    if (!candidateRequestId || !isForegroundWorker) return false;
    let anchorIndex = next.findIndex((turn) => turn?.role === 'user'
      && String(turn._clientRequestId || '').trim() === candidateRequestId);
    if (anchorIndex < 0) {
      const localIndex = local.indexOf(candidate);
      let localHandoff = null;
      for (let i = localIndex - 1; i >= 0; i -= 1) {
        if (local[i]?.role === 'user') {
          localHandoff = local[i];
          break;
        }
      }
      if (localHandoff && _isMobileVoiceAgentWorkerHandoff(localHandoff)) {
        const handoffText = _mobileMessageCopyText(localHandoff).replace(/\s+/g, ' ').trim();
        anchorIndex = next.findIndex((turn) => turn?.role === 'user'
          && _isMobileVoiceAgentWorkerHandoff(turn)
          && _mobileMessageCopyText(turn).replace(/\s+/g, ' ').trim() === handoffText);
      }
    }
    if (anchorIndex < 0) return false;
    next.splice(anchorIndex + 1, 0, candidate);
    return true;
  };
  for (const msg of local) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'ai')) continue;
    if (_isMobileHiddenVoiceDraftMessage(msg, -1)) continue;
    const isPendingAssistant = msg.role === 'ai' && (msg.streaming || String(msg._clientRequestId || '').trim());
    const isRecentCompletedAssistant = msg.role === 'ai'
      && msg.streaming !== true
      && _mobileAssistantHasVisibleAnswer(msg)
      && Date.now() - Number(msg.workEndedAt || msg.timestamp || 0) < 45_000;
    const pendingUserAge = Date.now() - Number(msg.timestamp || 0);
    const isPendingUser = msg.role === 'user'
      && !hasMatchingTurn(msg)
      && (msg._pmOptimistic === true || !!String(msg._clientRequestId || '').trim())
      && pendingUserAge < 45_000;
    const isVoiceShowUiCard = _isMobileVoiceShowUiCard(msg);
    if ((isPendingAssistant || isRecentCompletedAssistant || isPendingUser || isVoiceShowUiCard) && !hasMatchingTurn(msg)) {
      if (!insertForegroundWorkerAfterHandoff(msg)) next.push(msg);
    }
  }
  return next;
}

function _mobileHistoryTurnsRepresentSameTurn(a, b) {
  if (!a || !b) return false;
  const role = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'ai' || normalized === 'assistant' ? 'assistant' : normalized;
  };
  if (role(a.role) !== role(b.role)) return false;
  if (_mobileMessagesRepresentSameTurn(a, b)) return true;
  const aRequest = String(a._clientRequestId || a.clientRequestId || '').trim();
  const bRequest = String(b._clientRequestId || b.clientRequestId || '').trim();
  if (aRequest && bRequest && aRequest === bRequest) return true;
  const aId = String(a.messageId || a.turnId || a.id || '').trim();
  const bId = String(b.messageId || b.turnId || b.id || '').trim();
  if (aId && bId && aId !== bId) return false;
  const aText = _mobileMessageCopyText(a).replace(/\s+/g, ' ').trim();
  const bText = _mobileMessageCopyText(b).replace(/\s+/g, ' ').trim();
  return !!aText && aText === bText;
}

function _mergeMobileHistoryRecords(primary, secondary, { sortByTimestamp = false } = {}) {
  const next = [];
  const append = (candidate, preferIncoming = false) => {
    if (!candidate || typeof candidate !== 'object') return;
    const existingIndex = next.findIndex((item) => _mobileHistoryTurnsRepresentSameTurn(item, candidate));
    if (existingIndex < 0) {
      next.push(candidate);
      return;
    }
    const existing = next[existingIndex];
    const target = existing;
    const source = preferIncoming ? candidate : existing;
    if (target.role === 'ai') {
      _mergeMobileAssistantTurnDetails(target, source);
      _mergeMobileMediaIntoMessage(target, _collectMessageMedia(source));
      _mergeMobileProductCarouselIntoMessage(target, source.productCarousel);
    } else if (target.role === 'user') {
      _mergeMobileUserTurnDetails(target, source);
    }
    if (preferIncoming && candidate.streaming === true && target.streaming !== false) target.streaming = true;
  };
  (Array.isArray(primary) ? primary : []).forEach((message) => append(message));
  (Array.isArray(secondary) ? secondary : []).forEach((message) => append(message, true));
  if (sortByTimestamp) {
    const originalOrder = new Map(next.map((message, index) => [message, index]));
    next.sort((a, b) => {
      const at = Number(a?.timestamp || 0) || 0;
      const bt = Number(b?.timestamp || 0) || 0;
      if (at && bt && at !== bt) return at - bt;
      return (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0);
    });
  }
  return next;
}

function _mobileHistoryPageIsPartial(session, history = []) {
  const list = Array.isArray(history) ? history : [];
  const totalCount = Number(session?.totalHistoryCount || session?.historyPage?.totalCount || 0) || 0;
  return session?.historyTruncated === true
    || session?.historyPage?.hasOlder === true
    || (totalCount > 0 && totalCount > list.length);
}

function _mergeMobileHistoryPageWithCurrent(_sessionId, olderHistory, currentThread) {
  const older = _mapServerHistoryToMobile(olderHistory);
  const current = Array.isArray(currentThread) ? currentThread : [];
  const merged = _mergeMobileHistoryRecords(older, current);
  _dedupeMobileUserTurns(merged);
  return _reconcileMobileThreadOrder(merged);
}

function _mobileHistoryHasProtectedLocalContinuity(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => message
    && (
      message.streaming === true
      || message._pmFinalReceived === true
      || message._pmRecoveryReplay === true
      || message._pmOptimistic === true
      || message._pmAdmissionPending === true
    ));
}

function _mobileShouldPreserveLocalHistoryContinuity(mapped, durableLocal) {
  const serverRows = Array.isArray(mapped) ? mapped : [];
  const localRows = Array.isArray(durableLocal) ? durableLocal : [];
  if (!localRows.length) return false;
  const durableServerCount = serverRows.filter((message) => message
    && (message.role === 'user' || message.role === 'ai')).length;
  // A transient empty/short response is not permission to erase a transcript
  // already painted from the recovery cache. The server-side history write is
  // itself merge-preserving, so retaining the richer local copy is safe here.
  if (!durableServerCount || localRows.length > durableServerCount) return true;
  const latestServerUser = [...serverRows].reverse().find((message) => message?.role === 'user') || null;
  const latestLocalUser = [...localRows].reverse().find((message) => message?.role === 'user') || null;
  const serverUserTimestamp = Number(latestServerUser?.timestamp || 0) || 0;
  const localUserTimestamp = Number(latestLocalUser?.timestamp || 0) || 0;
  // Equal-sized pages can still be stale when a refresh races the durable
  // history write for the newest prompt. The local prompt is the continuity
  // boundary for the active turn, so do not let that older page roll it back.
  if (localUserTimestamp > serverUserTimestamp + 500) return true;
  const localRequestId = String(latestLocalUser?._clientRequestId || '').trim();
  if (localRequestId && !serverRows.some((message) => message?.role === 'user'
    && String(message?._clientRequestId || '').trim() === localRequestId)) return true;
  // Equal-length snapshots can still replace a recovered row with a newer
  // server row while the replay/final frame is settling. Keep the local
  // continuity markers in that case as well.
  return _mobileHistoryHasProtectedLocalContinuity(localRows);
}

function _mergeMobileSessionThreadWithLocal(sessionId, serverHistory, localThread, options = {}) {
  const mapped = _mapServerHistoryToMobile(serverHistory);
  const local = Array.isArray(localThread) ? localThread : [];
  const durableLocal = local.filter((message, index) => message
    && (message.role === 'user' || message.role === 'ai')
    && !_isMobileHiddenVoiceDraftMessage(message, index));
  // `/api/sessions/:id` deliberately returns a bounded tail on mobile. Keep
  // every already-loaded local transcript row when that response advertises
  // older history, or when recovery has a richer local snapshot. Otherwise a
  // cold reopen can render and cache only the tail, and a late stale response
  // can make recovered messages disappear while the user is typing.
  const preserveLocalHistory = options.preserveLocalHistory === true
    || _mobileShouldPreserveLocalHistoryContinuity(mapped, durableLocal);
  const base = preserveLocalHistory
    ? _mergeMobileHistoryRecords(mapped, durableLocal, { sortByTimestamp: true })
    : mapped;
  const merged = _mergeMobileThreadLocalArtifacts(base, local);
  _dedupeMobileUserTurns(merged);
  return _reconcileMobileThreadOrder(_mergeMobilePinnedCompletedTurn(sessionId, merged));
}

function _clearMobileLiveRunForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  if (__pmChat.activeRuns && typeof __pmChat.activeRuns === 'object') delete __pmChat.activeRuns[sid];
  _clearMobileActiveRun(sid);
  _markMobileSessionRunning(sid, false);
  __pmChat.busy = Object.values(__pmChat.activeRuns || {}).some((run) => run?.busy);
  const thread = __pmChat.threads?.[sid];
  if (Array.isArray(thread)) {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const msg = thread[i];
      if (msg?.streaming || _isMobileRestartContextPacketText(_mobileMessageCopyText(msg))) {
        thread.splice(i, 1);
      }
    }
  }
}

async function _applyMobileHotRestartNotification(msg = {}) {
  const sid = String(msg.previousSessionId || msg.sessionId || '').trim();
  if (!sid) return;
  // `mobile_default` is an unsaved client-side draft slot, not a durable
  // conversation. Older clients used it as a restart target, which left a
  // server-side history full of restart confirmations. Never hydrate that
  // legacy history back into a fresh draft during reconnect.
  if (sid === MOBILE_CHAT_SESSION_ID) {
    if (msg.notificationId) {
      try { wsSend({ type: 'startup_notification_ack', notificationId: String(msg.notificationId), surface: 'mobile', sessionId: sid }); } catch {}
    }
    return;
  }
  const restartText = String(msg.text || '').trim();
  const isDevApply = String(msg.source || '').trim() === 'dev_apply';
  const localBeforeRefresh = Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [];
  const hasActiveTurn = localBeforeRefresh.some((item) => item?.role === 'ai' && item?.streaming === true)
    || !!__pmChat.activeRuns?.[sid]?.busy
    || !!_readMobileActiveRun(sid);
  // A coordinated dev_apply can publish its status while the same Prometheus
  // turn continues using tools. It is not a restart/turn-completion boundary.
  // Preserve that live turn so the durable status message is followed by the
  // still-streaming tool trace, like a second Prometheus message.
  const preserveActiveTurn = isDevApply && hasActiveTurn;
  if (!preserveActiveTurn) _clearMobileLiveRunForSession(sid);
  const session = await loadMobileChatSession(sid).catch(() => null);
  _rememberMobileSessionGoal(session, sid);
  try { window.__pmMobileGoalChanged?.(); } catch {}
  const history = Array.isArray(session?.history) ? session.history : [];
  const localThread = preserveActiveTurn ? localBeforeRefresh : (__pmChat.threads?.[sid] || []);
  __pmChat.threads[sid] = _mergeMobileSessionThreadWithLocal(sid, history, localThread, {
    preserveLocalHistory: _mobileHistoryPageIsPartial(session, history),
  });
  const pendingApprovals = await loadMobileApprovals('pending').catch(() => []);
  for (const approval of Array.isArray(pendingApprovals) ? pendingApprovals : []) {
    const approvalSid = String(approval?.sessionId || approval?.sourceSessionId || '').trim();
    if (approvalSid && approvalSid !== sid) continue;
    _upsertMobilePendingApproval(approval);
    const exists = __pmChat.threads[sid].some((item) => String(item?.approvalRequest?.id || '') === String(approval.id || ''));
    if (!exists) {
      __pmChat.threads[sid].push({
        role: 'ai',
        timestamp: Date.now(),
        time: _nowTime(),
        body: { sender: 'Prometheus', text: '' },
        content: '',
        approvalRequest: _normalizeMobileApproval(approval),
      });
    }
  }
  if (!__pmChat.threads[sid].some((item) => _mobileMessageCopyText(item) === restartText) && restartText) {
    const statusMessage = {
      role: 'ai',
      timestamp: Date.now(),
      time: _nowTime(),
      body: { sender: 'Prometheus', text: restartText },
      content: restartText,
      _isRestartNotification: true,
    };
    const liveIndex = preserveActiveTurn
      ? __pmChat.threads[sid].findIndex((item) => item?.role === 'ai' && item?.streaming === true)
      : -1;
    if (liveIndex >= 0) __pmChat.threads[sid].splice(liveIndex, 0, statusMessage);
    else __pmChat.threads[sid].push(statusMessage);
  }
  // Only take over the chat view if the user is currently viewing that session
  // or a real (non-draft) session. Never override an intentional new-chat state —
  // the user pressed New Chat and shouldn't be yanked back to an old session.
  const _restartActiveSid = String(__pmChat.activeSessionId || '').trim();
  if (_restartActiveSid === sid) {
    __pmChat.activeSessionId = sid;
    _activeMobileThread();
    const threadEl = document.getElementById('pm-chat-thread');
    const bodyEl = document.getElementById('pm-chat-body');
    if (threadEl) _flushThreadRender(threadEl, bodyEl, sid);
    // A dev_apply status can arrive while the worker is still live even when
    // this tab lost its local run marker. The notification itself carries no
    // trace frames, so always reconcile the visible session after it.
    if (isDevApply) {
      try { window.__pmMobileRecoverActiveChatRun?.(sid, { source: 'dev_apply' }); } catch {}
    }
  }
  if (_isMobileChatSessionVisibleToUser(sid)) {
    markMobileChatSessionRead(sid, Date.now()).catch(() => {});
  }
  if (restartText && !preserveActiveTurn && __pmRealtimeAgent?.conn?.dc?.readyState === 'open') {
    const realtimeSid = String(__pmRealtimeAgent.conn.sessionId || __pmVoice?.targetSessionId || __pmChat.activeSessionId || '').trim();
    const shouldSpeakForSession = realtimeSid === sid || String(__pmVoice?.targetSessionId || '').trim() === sid;
    const notificationKey = String(msg.notificationId || `${sid}:${restartText.length}:${restartText.slice(0, 120)}`);
    if (shouldSpeakForSession && __pmRealtimeAgent.lastHotRestartSummaryKey !== notificationKey) {
      const spoke = _requestMobileRealtimeAgentFinalSummary(restartText);
      if (spoke) {
        __pmRealtimeAgent.lastHotRestartSummaryKey = notificationKey;
        _setOrbState('speaking');
        _setStatus('Speaking response', 'Realtime agent is summarizing the restart result');
      }
    }
  }
  if (msg.notificationId) {
    try { wsSend({ type: 'startup_notification_ack', notificationId: String(msg.notificationId), surface: 'mobile', sessionId: sid }); } catch {}
  }
}

// Live-update an open scheduled-task ("Automated: …") thread when a new run
// completes. Scheduled jobs now use one stable session per job (auto_<jobId>),
// so each run appends to the same thread. If the user is currently viewing that
// thread we refresh it in place; otherwise the list re-fetch on drawer open
// picks it up. We deliberately do NOT yank the user into the thread.
async function _applyMobileScheduledNotification(msg = {}) {
  const sid = String(msg.sessionId || '').trim();
  if (!sid || !/^auto_/i.test(sid)) return;
  invalidateMobileDrawerSessions('mobile');
  const session = await loadMobileChatSession(sid).catch(() => null);
  const history = Array.isArray(session?.history) ? session.history : [];
  const localThread = __pmChat.threads?.[sid] || [];
  __pmChat.threads[sid] = _mergeMobileSessionThreadWithLocal(sid, history, localThread, {
    preserveLocalHistory: _mobileHistoryPageIsPartial(session, history),
  });
  if (String(__pmChat.activeSessionId || '').trim() === sid) {
    _activeMobileThread();
    const threadEl = document.getElementById('pm-chat-thread');
    const bodyEl = document.getElementById('pm-chat-body');
    if (threadEl) _flushThreadRender(threadEl, bodyEl, sid);
    markMobileChatSessionRead(sid, Date.now()).catch(() => {});
  }
}

if (!window.__pmMobileSessionNotificationBridgeInstalled) {
  window.__pmMobileSessionNotificationBridgeInstalled = true;
  wsEventBus.on('session_notification', (msg = {}) => {
    if (['hot_restart', 'dev_apply'].includes(String(msg.source || ''))) {
      _applyMobileHotRestartNotification(msg).catch((err) => {
        pmToast(`Dev apply message sync failed: ${err?.message || err}`, 'error');
      });
    } else if (String(msg.source || '') === 'schedule') {
      _applyMobileScheduledNotification(msg).catch((err) => {
        console.warn('[mobile] scheduled notification sync failed:', err?.message || err);
      });
    }
  });
}

const _mobileSessionFreshnessTimers = new Map();

function _scheduleMobileSessionFreshnessRefresh(sessionId, { delayMs = 180, attempt = 0 } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid === MOBILE_CHAT_SESSION_ID) return;
  invalidateMobileChatSessionCache(sid);
  const prior = _mobileSessionFreshnessTimers.get(sid);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(async () => {
    _mobileSessionFreshnessTimers.delete(sid);
    if (String(__pmChat.activeSessionId || '').trim() !== sid) return;
    const busy = !!(__pmChat.activeRuns?.[sid]?.busy || __pmChat.drawerRunSessionIds?.has?.(sid));
    const hasStreamingTurn = (__pmChat.threads?.[sid] || []).some((msg) => msg?.streaming === true);
    if (busy || hasStreamingTurn) {
      if (attempt < 30) {
        _scheduleMobileSessionFreshnessRefresh(sid, { delayMs: 1500, attempt: attempt + 1 });
      }
      return;
    }
    const session = await loadMobileChatSession(sid, { force: true }).catch(() => null);
    if (!session || String(__pmChat.activeSessionId || '').trim() !== sid) return;
    const history = Array.isArray(session.history) ? session.history : [];
    const localThread = Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [];
    __pmChat.threads[sid] = _mergeMobileSessionThreadWithLocal(sid, history, localThread, {
      preserveLocalHistory: _mobileHistoryPageIsPartial(session, history),
    });
    __pmChat.thread = __pmChat.threads[sid];
    _renderMobileChatSessionNow(sid);
    _flushMobileThreadCacheSave(sid);
  }, Math.max(60, Number(delayMs) || 180));
  _mobileSessionFreshnessTimers.set(sid, timer);
}

if (typeof window !== 'undefined' && !window.__pmMobileSessionHistoryBridgeInstalled) {
  window.__pmMobileSessionHistoryBridgeInstalled = true;
  wsEventBus.on('session_history_changed', (msg = {}) => {
    const sid = String(msg.sessionId || '').trim();
    if (!sid) return;
    invalidateMobileChatSessionCache(sid);
    // The visual iframe already owns the latest local state. Its debounced
    // history persistence is acknowledged by the gateway, but must not cause
    // this client to fetch and rebuild the entire chat thread while the user
    // is dragging a control or interacting with the visual.
    if (String(msg.source || '').toLowerCase() === 'mobile_visual_state') return;
    if (String(__pmChat.activeSessionId || '').trim() === sid) {
      _scheduleMobileSessionFreshnessRefresh(sid);
    }
  });
}

if (typeof window !== 'undefined' && !window.__pmMobileSessionStateBridgeInstalled) {
  window.__pmMobileSessionStateBridgeInstalled = true;
  wsEventBus.on('session_state_changed', (msg = {}) => {
    const sid = String(msg.sessionId || msg.session?.id || '').trim();
    if (!sid) return;
    invalidateMobileDrawerSessions();
    invalidateMobileChatSessionCache(sid);
  });
  wsEventBus.on('auto_settle_run', (summary = {}) => {
    if (summary?.dryRun === true || summary?.reason !== 'scheduled') return;
    const settled = Number(summary?.settled || 0);
    if (settled <= 0) return;
    pmToast(`${settled} untouched chat${settled === 1 ? '' : 's'} moved to Settled Chats. You can reopen them there.`, 'info');
  });
}

if (!window.__pmMobileGoalBridgeInstalled) {
  window.__pmMobileGoalBridgeInstalled = true;
  wsEventBus.on('main_chat_goal_updated', (msg = {}) => {
    const sid = String(msg?.sessionId || '').trim();
    if (!sid) return;
    _setMobileSessionGoal(sid, msg.goal || null);
    _refreshVisibleMobileGoalPills(sid);
    try { window.__pmMobileGoalChanged?.(msg); } catch {}
  });
}

function _deliveryNotificationToMobileMedia(msg = {}) {
  const imageDataUrl = String(msg.imageDataUrl || '').trim();
  const attachmentPath = String(msg.attachmentPath || '').trim();
  if (!imageDataUrl && !attachmentPath) return null;
  const kind = imageDataUrl ? 'image' : _mobileMediaKind({ path: attachmentPath, name: msg.fileName });
  return _normalizeMobileMedia({
    kind,
    dataUrl: imageDataUrl,
    path: attachmentPath,
    name: String(msg.fileName || msg.caption || (imageDataUrl ? 'Delivered image.png' : attachmentPath.split(/[\\/]/).pop()) || 'Delivered file').trim(),
    mimeType: msg.mimeType || (imageDataUrl.match(/^data:([^;]+);/i)?.[1] || ''),
    gallery: kind === 'image' && Number(msg.batchCount || 0) > 1,
    deliveryBatchId: msg.batchId,
    deliveryBatchIndex: msg.batchIndex,
  });
}

function _refreshMobileDeliveryThread(sid) {
  if (String(__pmChat.activeSessionId || '') !== sid) return;
  _activeMobileThread();
  const threadEl = document.getElementById('pm-chat-thread');
  const bodyEl = document.getElementById('pm-chat-body');
  if (threadEl) _flushThreadRender(threadEl, bodyEl, sid);
}

function _appendMobileDeliveryNotification(msg = {}) {
  const sid = String(msg.sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.threads[sid]) __pmChat.threads[sid] = [];
  const text = String(msg.text || msg.caption || '').trim();
  const media = _deliveryNotificationToMobileMedia(msg);
  const key = media ? _mobileMediaKey(media) : '';
  const batchId = String(msg.batchId || media?.deliveryBatchId || '').trim();
  if (batchId) {
    const batchTurn = __pmChat.threads[sid].find((item) => String(item?.deliveryBatchId || '').trim() === batchId);
    if (batchTurn) {
      const mediaExists = key && _collectMessageMedia(batchTurn).some((candidate) => _mobileMediaKey(candidate) === key);
      if (!mediaExists && media) _mergeMobileMediaIntoMessage(batchTurn, [media]);
      if (!_mobileMessageCopyText(batchTurn) && text) {
        batchTurn.body.text = text;
        batchTurn.content = text;
      }
      batchTurn.deliveryBatchCount = Math.max(Number(batchTurn.deliveryBatchCount || 0), Number(msg.batchCount || 0));
      _refreshMobileDeliveryThread(sid);
      return;
    }
  }
  const exists = __pmChat.threads[sid].some((item) => {
    if (key) return _collectMessageMedia(item).some((candidate) => _mobileMediaKey(candidate) === key);
    return !!text && _mobileMessageCopyText(item) === text;
  });
  if (exists) return;
  const turn = {
    role: 'ai',
    timestamp: Number(msg.timestamp || Date.now()),
    time: _nowTime(),
    body: { sender: 'Prometheus', text },
    content: text,
    source: String(msg.source || 'delivery'),
    channel: String(msg.target || 'mobile'),
    channelLabel: 'delivery',
    deliveryBatchId: batchId,
    deliveryBatchCount: Number(msg.batchCount || 0),
  };
  if (media) _mergeMobileMediaIntoMessage(turn, [media]);
  __pmChat.threads[sid].push(turn);
  // Delivery notifications are session-scoped background updates. They may
  // refresh the thread already on screen, but must never select their session.
  // A tool finishing in chat A can emit a delivery while the user is composing
  // a new chat B; selecting A here would discard the user's navigation intent.
  _refreshMobileDeliveryThread(sid);
}

if (!window.__pmMobileDeliveryBridgeInstalled) {
  window.__pmMobileDeliveryBridgeInstalled = true;
  wsEventBus.on('delivery_notification', (msg = {}) => {
    const target = String(msg.target || '').toLowerCase();
    if (target && target !== 'mobile' && target !== 'all') return;
    _appendMobileDeliveryNotification(msg);
  });
}

function _renderMobileGeneratedImageBatch(mediaList) {
  const list = _dedupeMobileMediaList(_normalizeMobileMediaList(mediaList).map((media) => ({ ...media, kind: 'image', generated: true })));
  if (!list.length) return '';
  const first = list[0];
  const firstSrc = _mobileMediaUrl(first, 'inline');
  const firstDownload = _mobileMediaUrl(first, 'download');
  const primaryAttrs = `data-pm-media data-pm-generated-primary data-kind="image" data-src="${escapeHtml(firstSrc)}" data-download="${escapeHtml(firstDownload)}" data-name="${escapeHtml(first.name)}" data-path="${escapeHtml(first.path || '')}" data-index="0"`;
  const thumbs = list.length > 1 ? `<div class="pm-generated-image-thumbs" aria-label="Image options">${list.map((media, idx) => {
    const src = _mobileMediaUrl(media, 'inline');
    const download = _mobileMediaUrl(media, 'download');
    const attrs = `data-pm-generated-thumb data-kind="image" data-src="${escapeHtml(src)}" data-download="${escapeHtml(download)}" data-name="${escapeHtml(media.name)}" data-path="${escapeHtml(media.path || '')}" data-index="${idx}"`;
    return `<button type="button" class="pm-generated-image-thumb${idx === 0 ? ' selected' : ''}" ${attrs} aria-label="Show image ${idx + 1}" aria-pressed="${idx === 0 ? 'true' : 'false'}"><img src="${escapeHtml(src)}" alt="${escapeHtml(media.name)}" loading="lazy" decoding="async"><span>${idx + 1}</span></button>`;
  }).join('')}</div>` : '';
  return `<div class="pm-generated-image-batch" data-count="${escapeHtml(String(list.length))}">
    <button type="button" class="pm-generated-image-primary" ${primaryAttrs}><img src="${escapeHtml(firstSrc)}" alt="${escapeHtml(first.name)}" loading="lazy" decoding="async"></button>
    ${thumbs}
  </div>`;
}

function _mobileToolEventName(evtOrName) {
  if (typeof evtOrName === 'string') return evtOrName.replace(/\s+/g, '_').toLowerCase();
  const evt = evtOrName && typeof evtOrName === 'object' ? evtOrName : {};
  const raw = String(
    evt.action
    || evt.name
    || evt.toolName
    || evt.tool_name
    || evt.tool
    || evt.label
    || '',
  ).trim();
  return raw.replace(/\s+/g, '_').toLowerCase();
}

function _isMobileGenerateImageToolName(name) {
  const value = _mobileToolEventName(name)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return value === 'generate_image'
    || value === 'image_gen'
    || value === 'imagegen'
    || value === 'image_generation'
    || value === 'voice_generate_image'
    || value === 'creative_generate_image_shot';
}

function _isMobileGenerateVideoToolName(name) {
  const value = _mobileToolEventName(name)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return value === 'generate_video'
    || value === 'video_generation'
    || value === 'voice_generate_video'
    || value === 'creative_generate_video_shot';
}

function _isMobileExplicitMediaToolName(name) {
  const value = _mobileToolEventName(name)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return _isMobileGenerateImageToolName(value)
    || _isMobileGenerateVideoToolName(value)
    || value === 'present_file'
    || value === 'canvas_present'
    || value.startsWith('creative_')
    || value.startsWith('hyperframes_');
}

function _isMobileImageGenerationStreamEntry(entry) {
  const activity = entry?.activity && typeof entry.activity === 'object' ? entry.activity : {};
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  const args = activity.args && typeof activity.args === 'object'
    ? activity.args
    : extra.args && typeof extra.args === 'object'
      ? extra.args
      : entry?.args && typeof entry.args === 'object'
        ? entry.args
        : {};
  const action = _mobileToolEventName(
    activity.action
    || activity.toolName
    || activity.tool_name
    || activity.name
    || extra.action
    || extra.toolName
    || extra.tool_name
    || extra.name
    || entry?.action
    || entry?.toolName
    || entry?.tool_name
    || entry?.name,
  );
  if (!_isMobileGenerateImageToolName(action)) return false;
  const presentationMode = String(
    args.presentation_mode
    || args.presentationMode
    || activity.presentation_mode
    || activity.presentationMode
    || extra.presentation_mode
    || extra.presentationMode
    || entry?.presentation_mode
    || entry?.presentationMode
    || '',
  ).trim().toLowerCase();
  return presentationMode === 'foreground';
}

function _renderMobileGeneratedImageLoadingCard() {
  return `<div class="pm-generated-image-batch pm-generated-image-batch--pending" aria-live="polite">
    <div class="pm-generated-image-loading-panel">
      <span class="pm-generated-image-particles" aria-hidden="true"></span>
      <span class="pm-generated-image-orb" aria-hidden="true"></span>
      <i aria-hidden="true"></i>
    </div>
  </div>`;
}

function _renderMobileMediaGallery(mediaList) {
  const list = Array.isArray(mediaList) ? mediaList : [];
  if (!list.length) return '';
  const generatedImages = list
    .filter((media) => media.kind === 'image' && (media.generated || media.gallery))
    .sort((a, b) => Number(a.deliveryBatchIndex ?? -1) - Number(b.deliveryBatchIndex ?? -1));
  const rest = list.filter((media) => !(media.kind === 'image' && (media.generated || media.gallery)));
  const generatedHtml = generatedImages.length ? _renderMobileGeneratedImageBatch(generatedImages) : '';
  const restHtml = rest.length ? `<div class="pm-media-gallery">${rest.map((media, idx) => {
    const src = _mobileMediaUrl(media, 'inline');
    const download = _mobileMediaUrl(media, 'download');
    const ext = _mobileFileExt(media.name || media.path).toUpperCase() || 'FILE';
    const meta = [media.provider, media.model, media.bytes ? _formatBytes(media.bytes) : ''].filter(Boolean).join(' · ');
    const attrs = `data-pm-media data-kind="${escapeHtml(media.kind)}" data-src="${escapeHtml(src)}" data-download="${escapeHtml(download)}" data-name="${escapeHtml(media.name)}" data-path="${escapeHtml(media.path || '')}" data-index="${idx}"`;
    if (media.kind === 'image') {
      return `<button type="button" class="pm-media-card image" ${attrs}><img src="${escapeHtml(src)}" alt="${escapeHtml(media.name)}" loading="lazy"><span><strong>${escapeHtml(media.name)}</strong>${meta ? `<em>${escapeHtml(meta)}</em>` : ''}</span></button>`;
    }
    if (media.kind === 'video') {
      return `<button type="button" class="pm-media-card video" ${attrs}><video src="${escapeHtml(src)}" muted playsinline preload="none"></video><span class="pm-media-play">${ICONS.play}</span><span><strong>${escapeHtml(media.name)}</strong>${meta ? `<em>${escapeHtml(meta)}</em>` : ''}</span></button>`;
    }
    return `<button type="button" class="pm-generated-file" ${attrs}><span class="pm-generated-file-icon">${ICONS.clipboard}</span><span class="pm-generated-file-info"><strong>${escapeHtml(media.name)}</strong><em>${escapeHtml(ext)} file${meta ? ` · ${escapeHtml(meta)}` : ''}</em></span></button>`;
  }).join('')}</div>` : '';
  return `${generatedHtml}${restHtml}`;
}

function _browseFileIcon(kind) {
  if (kind === 'image') return ICONS.image;
  if (kind === 'video') return ICONS.video;
  if (kind === 'audio') return ICONS.volume;
  return ICONS.doc;
}

function _browseFolderIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.2h7A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
}

function _browseViewIcon(view) {
  if (view === 'grid') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
}

function _formatBrowseDate(value) {
  const raw = value || 0;
  const date = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function _formatBrowseSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function _browseMeta(parts) {
  return parts.filter(Boolean).join(' · ');
}

function _filterBrowseEntries(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  if (!q) return list;
  return list.filter((entry) => String(entry?.name || entry?.path || '').toLowerCase().includes(q));
}

function _browseSectionHtml({ id, title, icon, entries, expanded, view, kind }) {
  const list = Array.isArray(entries) ? entries : [];
  const visible = expanded ? list : list.slice(0, 5);
  const rows = visible.map((entry) => {
    const name = String(entry.name || entry.path || (kind === 'dir' ? 'Folder' : 'File'));
    const date = _formatBrowseDate(entry.modifiedAt || entry.mtime);
    const meta = kind === 'dir'
      ? _browseMeta([date, Number.isFinite(Number(entry.itemCount)) ? `${Number(entry.itemCount)} items` : ''])
      : _browseMeta([date, _formatBrowseSize(entry.size)]);
    const attrs = kind === 'dir'
      ? `data-browse-nav="${escapeHtml(entry.path || '')}"`
      : `data-browse-open="${escapeHtml(entry.path || '')}" data-browse-kind="${escapeHtml(entry.kind || 'file')}" data-browse-name="${escapeHtml(name)}"`;
    const entryIcon = kind === 'dir' ? _browseFolderIcon() : _browseFileIcon(entry.kind);
    return `
      <button type="button" class="pm-browse-row ${kind}" ${attrs}>
        <span class="pm-browse-row-icon">${entryIcon}</span>
        <span class="pm-browse-row-main">
          <span class="pm-browse-row-name">${escapeHtml(name)}</span>
          ${meta ? `<span class="pm-browse-row-meta">${escapeHtml(meta)}</span>` : ''}
        </span>
        <span class="pm-browse-row-more" aria-hidden="true">${ICONS.dots}</span>
      </button>`;
  }).join('');
  const empty = !list.length ? `<div class="pm-browse-empty">${kind === 'dir' ? 'No folders' : 'No files'}</div>` : '';
  const toggle = list.length > 5
    ? `<button type="button" class="pm-browse-show-all" data-browse-toggle="${escapeHtml(id)}">${expanded ? 'Show fewer' : `Show all ${title.toLowerCase()}`} <span>${expanded ? '&uarr;' : '&darr;'}</span></button>`
    : '';
  return `
    <section class="pm-browse-section ${view}${expanded ? ' expanded' : ''}">
      <header class="pm-browse-section-head">
        <span class="pm-browse-section-title"><span class="pm-browse-section-icon">${icon}</span>${escapeHtml(title)}</span>
        <span class="pm-browse-section-count">${list.length}</span>
      </header>
      <div class="pm-browse-list">${rows}${empty}</div>
      ${toggle}
    </section>`;
}

function _renderBrowseCard(bs) {
  if (bs.loading) {
    return `<div class="pm-browse-card"><div class="pm-browse-empty">Loading workspace files...</div></div>`;
  }
  if (bs.error) {
    return `<div class="pm-browse-card"><div class="pm-browse-error">${escapeHtml(bs.error)}</div></div>`;
  }
  const view = bs.view === 'grid' ? 'grid' : 'list';
  const query = String(bs.query || '');
  const parts = bs.cwd ? String(bs.cwd).split('/').filter(Boolean) : [];
  const crumbs = [{ label: 'Workspace', path: '' }, ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join('/') }))];
  const breadcrumbHtml = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    return `<button type="button" class="pm-browse-crumb${isLast ? ' active' : ''}" data-browse-nav="${escapeHtml(c.path)}">${escapeHtml(c.label)}</button>${isLast ? '' : '<span class="pm-browse-sep">›</span>'}`;
  }).join('');
  const dirs = _filterBrowseEntries(bs.dirs, query);
  const files = _filterBrowseEntries(bs.files, query);
  const emptyHtml = !dirs.length && !files.length ? '<div class="pm-browse-empty">No matching files or folders</div>' : '';
  return `
    <div class="pm-browse-card">
      <div class="pm-browse-toolbar">
        <label class="pm-browse-search">
          <span class="pm-browse-search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></span>
          <input type="search" data-browse-search value="${escapeHtml(query)}" placeholder="Search files and folders..." autocomplete="off" autocorrect="off" spellcheck="false">
        </label>
        <div class="pm-browse-view-toggle" aria-label="View">
          <button type="button" class="${view === 'grid' ? 'active' : ''}" data-browse-view="grid" aria-label="Grid view">${_browseViewIcon('grid')}</button>
          <button type="button" class="${view === 'list' ? 'active' : ''}" data-browse-view="list" aria-label="List view">${_browseViewIcon('list')}</button>
        </div>
      </div>
      <nav class="pm-browse-breadcrumb" aria-label="Path">${breadcrumbHtml}</nav>
      ${emptyHtml || _browseSectionHtml({ id: 'folders', title: 'Folders', icon: _browseFolderIcon(), entries: dirs, expanded: !!bs.showAllFolders, view, kind: 'dir' })}
      ${emptyHtml ? '' : _browseSectionHtml({ id: 'files', title: 'Files', icon: ICONS.doc, entries: files, expanded: !!bs.showAllFiles, view, kind: 'file' })}
    </div>`;
}

function _normalizeMobileApproval(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const id = String(source.id || source.approvalId || fallback.id || fallback.approvalId || '').trim();
  const sessionId = String(source.sourceSessionId || source.sessionId || fallback.sourceSessionId || fallback.sessionId || '').trim();
  const toolArgs = source.toolArgs && typeof source.toolArgs === 'object' ? source.toolArgs : (fallback.toolArgs || {});
  return {
    ...fallback,
    ...source,
    id,
    sessionId,
    sourceSessionId: sessionId,
    toolArgs,
    toolName: String(source.toolName || fallback.toolName || '').trim(),
    approvalKind: String(source.approvalKind || fallback.approvalKind || '').trim(),
    action: String(source.action || source.summary || fallback.action || fallback.summary || '').trim(),
    reason: String(source.reason || fallback.reason || '').trim(),
    riskScore: Number.isFinite(Number(source.riskScore)) ? Number(source.riskScore) : Number(fallback.riskScore || 0),
    affectedSystems: Array.isArray(source.affectedSystems) ? source.affectedSystems : (Array.isArray(fallback.affectedSystems) ? fallback.affectedSystems : []),
    commandBoundary: source.commandBoundary || fallback.commandBoundary || null,
    devSourceEdit: source.devSourceEdit || fallback.devSourceEdit || null,
    devApplyLive: source.devApplyLive || fallback.devApplyLive || null,
    finalAction: source.finalAction || fallback.finalAction || null,
    pathAccess: source.pathAccess || fallback.pathAccess || null,
    status: String(source.status || fallback.status || 'pending').toLowerCase(),
  };
}

function _pmApprovalStatusCopy(status = 'pending') {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'pending') return 'Approval required';
  if (normalized === 'approving') return 'Approving';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected' || normalized === 'denied') return 'Denied';
  if (normalized === 'running' || normalized === 'executing') return 'Running';
  if (normalized === 'complete' || normalized === 'executed') return 'Completed';
  if (normalized === 'failed' || normalized === 'error') return 'Failed';
  if (normalized === 'expired') return 'Expired';
  return normalized || 'Approval required';
}

function _pmApprovalStatusIcon(status = 'pending') {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'approved' || normalized === 'complete' || normalized === 'executed') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>';
  }
  if (normalized === 'rejected' || normalized === 'denied' || normalized === 'failed' || normalized === 'error' || normalized === 'expired') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  }
  if (normalized === 'approving' || normalized === 'running' || normalized === 'executing') {
    return '<span class="pm-chat-approval-spinner" aria-hidden="true"></span>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>';
}

function _pmApprovalParameterHtml(label, value, { code = false, multiline = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const valueClass = ['pm-chat-approval-parameter-value', code ? 'code' : '', multiline ? 'multiline' : ''].filter(Boolean).join(' ');
  return `<div class="pm-chat-approval-parameter">
    <dt>${escapeHtml(label)}</dt>
    <dd class="${valueClass}">${escapeHtml(text)}</dd>
  </div>`;
}

function _pmApprovalParametersHtml(approval, human, technicalText, {
  risk = 0,
  boundaryScope = '',
  boundaryPaths = [],
  sourceDirs = [],
  devFiles = [],
  devPlan = null,
  evidence = [],
  steps = [],
  expectedWorkflow = [],
} = {}) {
  const args = approval?.toolArgs && typeof approval.toolArgs === 'object' ? approval.toolArgs : {};
  const rows = [];
  const command = String(args.command || '').trim();
  const directory = String(args.cwd || args.directory || args.workdir || '').trim();
  const path = String(approval?.pathAccess?.requestedPath || args.path || '').trim();
  const detail = String(human?.detail || '').trim();
  if (command) rows.push(_pmApprovalParameterHtml('Command', command, { code: true, multiline: true }));
  if (directory) rows.push(_pmApprovalParameterHtml('Directory', directory, { code: true }));
  if (path && path !== detail) rows.push(_pmApprovalParameterHtml('Path', path, { code: true, multiline: true }));
  if (detail && detail !== command && detail !== path) rows.push(_pmApprovalParameterHtml(
    approval?.approvalKind === 'path_access' ? 'Path' : command && detail === command ? 'Command' : 'Target',
    detail,
    { code: true, multiline: true },
  ));
  if (boundaryScope && boundaryScope !== 'workspace') {
    rows.push(_pmApprovalParameterHtml('Boundary', `${boundaryScope.replace(/_/g, ' ')}${approval?.commandBoundary?.reason ? ` — ${approval.commandBoundary.reason}` : ''}`));
  }
  if (boundaryPaths.length) rows.push(_pmApprovalParameterHtml('External paths', boundaryPaths.slice(0, 8).join('\n'), { code: true, multiline: true }));
  if (sourceDirs.length) rows.push(_pmApprovalParameterHtml('Workspace docs', sourceDirs.join(', '), { code: true, multiline: true }));
  if (devFiles.length) rows.push(_pmApprovalParameterHtml('Files', devFiles.slice(0, 12).join('\n'), { code: true, multiline: true }));
  if (devPlan?.reasoning) rows.push(_pmApprovalParameterHtml('Reasoning', devPlan.reasoning, { multiline: true }));
  if (evidence.length) rows.push(_pmApprovalParameterHtml(
    'Evidence',
    evidence.slice(0, 5).map((item) => `${item.file || 'file'}${item.lines ? `:${item.lines}` : ''} — ${item.finding || ''}`).join('\n'),
    { multiline: true },
  ));
  if (steps.length) rows.push(_pmApprovalParameterHtml('Plan', steps.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'), { multiline: true }));
  if (expectedWorkflow.length) rows.push(_pmApprovalParameterHtml('Expected workflow', expectedWorkflow.slice(0, 8).map((step, idx) => `${idx + 1}. ${step}`).join('\n'), { multiline: true }));
  if (risk) rows.push(_pmApprovalParameterHtml('Risk', String(risk)));
  if (!rows.length && technicalText) rows.push(_pmApprovalParameterHtml('Technical details', technicalText, { code: true, multiline: true }));
  return rows.filter(Boolean).join('');
}

function _renderMobileApprovalCard(approvalInput = {}, { compact = false } = {}) {
  const approval = _normalizeMobileApproval(approvalInput);
  if (!approval.id) return '';
  const human = _pmHumanApproval(approval);
  const technicalText = _pmApprovalTechnicalText(approval);
  const status = String(approval.status || 'pending').toLowerCase();
  const pending = status === 'pending';
  const risk = Number(approval.riskScore || 0);
  const statusLabel = _pmApprovalStatusCopy(status);
  const toolName = String(approval.toolName || _pmApprovalToolLabel(approval.toolName) || 'tool').trim();
  const devPlan = approval?.devSourceEdit?.plan || null;
  const sourceDirs = Array.isArray(approval?.devSourceEdit?.allowedDirs) ? approval.devSourceEdit.allowedDirs : [];
  const devFiles = Array.isArray(approval?.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
  const evidence = Array.isArray(devPlan?.evidence) ? devPlan.evidence : [];
  const steps = Array.isArray(devPlan?.steps) ? devPlan.steps : [];
  const boundary = approval.commandBoundary || null;
  const boundaryScope = String(boundary?.scope || '').trim();
  const boundaryPaths = Array.isArray(boundary?.externalPaths) ? boundary.externalPaths.filter(Boolean) : [];
  const expectedWorkflow = Array.isArray(devPlan?.expectedWorkflow)
    ? devPlan.expectedWorkflow
    : (Array.isArray(devPlan?.expected_workflow) ? devPlan.expected_workflow : []);
  const parametersHtml = _pmApprovalParametersHtml(approval, human, technicalText, {
    risk,
    boundaryScope,
    boundaryPaths,
    sourceDirs,
    devFiles,
    devPlan,
    evidence,
    steps,
    expectedWorkflow,
  });
  const title = pending ? 'Allow this tool to run?' : (human.title || 'Tool access');
  const approveLabel = approval.approvalKind === 'dev_apply_live' ? 'Apply live' : 'Allow once';
  return `<div class="pm-chat-approval ${pending ? 'pending' : 'resolved'} ${compact ? 'compact' : ''}" data-pm-approval-id="${escapeHtml(approval.id)}">
    <div class="pm-chat-approval-head">
      <span class="pm-chat-approval-icon">${_pmApprovalStatusIcon(status)}</span>
      <div class="pm-chat-approval-heading">
        <strong class="pm-chat-approval-title">${escapeHtml(title)}</strong>
        <code class="pm-chat-approval-tool">${escapeHtml(toolName)}</code>
      </div>
    </div>
    ${human.summary ? `<p>${escapeHtml(human.summary)}</p>` : ''}
    ${parametersHtml ? `<details class="pm-approval-technical pm-chat-approval-details" open>
      <summary>View details <span aria-hidden="true">⌃</span></summary>
      <dl class="pm-chat-approval-parameters">${parametersHtml}</dl>
    </details>` : ''}
    ${pending ? _pmRenderCommandRunLink(approval) : ''}
    ${pending ? `<div class="pm-chat-approval-actions">
      <button type="button" class="pm-chat-approval-btn approve" data-pm-approval-action="approve" data-pm-approval-id="${escapeHtml(approval.id)}">${escapeHtml(approveLabel)}</button>
      ${_pmApprovalCanSave(approval) ? `<button type="button" class="pm-chat-approval-btn always" data-pm-approval-action="approve_always" data-pm-approval-id="${escapeHtml(approval.id)}">Always allow</button>
      <button type="button" class="pm-chat-approval-btn session" data-pm-approval-action="approve_session" data-pm-approval-id="${escapeHtml(approval.id)}">Allow this session</button>` : ''}
      <button type="button" class="pm-chat-approval-btn reject" data-pm-approval-action="reject" data-pm-approval-id="${escapeHtml(approval.id)}">${approval.approvalKind === 'dev_apply_live' ? 'Keep verified' : 'Deny'}</button>
    </div>` : `<div class="pm-chat-approval-done">${escapeHtml(statusLabel)}</div>`}
  </div>`;
}

function _mobileBackgroundSpawnIdFromSessionId(sessionId) {
  const sid = String(sessionId || '').trim();
  const match = sid.match(/^background_(bg_[A-Za-z0-9_.:-]+)$/);
  return match ? match[1] : '';
}

function _mobileBackgroundSpawnApprovalId(approvalInput = {}) {
  const source = approvalInput && typeof approvalInput === 'object' ? approvalInput : {};
  const nested = source.approval && typeof source.approval === 'object' ? source.approval : {};
  const taskId = String(source.taskId || nested.taskId || '').trim();
  return _mobileBackgroundSpawnId(source)
    || _mobileBackgroundSpawnId(nested)
    || (taskId.startsWith('bg_') ? taskId : '')
    || _mobileBackgroundSpawnIdFromSessionId(source.backgroundSessionId || source.bgSessionId || source.sourceSessionId || source.sessionId)
    || _mobileBackgroundSpawnIdFromSessionId(nested.backgroundSessionId || nested.bgSessionId || nested.sourceSessionId || nested.sessionId);
}

function _mobileBackgroundSpawnLaneForApproval(approvalInput = {}) {
  const bgId = _mobileBackgroundSpawnApprovalId(approvalInput);
  return bgId ? (_mobileBackgroundSpawnLanes()[bgId] || null) : null;
}

function _mobileApprovalVisibleSessionId(approvalInput = {}) {
  const source = approvalInput && typeof approvalInput === 'object' ? approvalInput : {};
  const explicit = String(
    source.visibleSessionId
      || source.spawnerSessionId
      || source.parentSessionId
      || source.mainSessionId
      || source.browserSpawnerSessionId
      || ''
  ).trim();
  if (explicit) return explicit;
  const lane = _mobileBackgroundSpawnLaneForApproval(source);
  if (lane?.sessionId) return String(lane.sessionId).trim();
  const sid = String(source.sessionId || source.sourceSessionId || '').trim();
  return sid || String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
}

function _linkMobileApprovalToBackgroundLane(approvalInput = {}) {
  const bgId = _mobileBackgroundSpawnApprovalId(approvalInput);
  if (!bgId) return null;
  const lane = _mobileBackgroundSpawnLanes()[bgId] || null;
  if (!lane) return null;
  const approval = _normalizeMobileApproval({
    ...approvalInput,
    bgId,
    backgroundId: bgId,
    visibleSessionId: lane.sessionId || approvalInput.visibleSessionId,
    spawnerSessionId: lane.sessionId || approvalInput.spawnerSessionId,
    backgroundSessionId: approvalInput.backgroundSessionId || approvalInput.bgSessionId || approvalInput.sourceSessionId || approvalInput.sessionId,
  });
  const status = String(approval.status || 'pending').toLowerCase();
  lane.approvalRequest = approval;
  if (status === 'pending') {
    lane.status = 'approval_required';
    lane.expanded = true;
  } else if (lane.status === 'approval_required') {
    lane.status = 'running';
  }
  lane.updatedAt = Date.now();
  return lane;
}

function _getPendingApprovalsForSession(sessionId) {
  const sid = String(sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim();
  const out = new Map();
  const add = (approval) => {
    if (!approval || !approval.id || String(approval.status || 'pending') !== 'pending') return;
    if (_mobileApprovalVisibleSessionId(approval) !== sid) return;
    out.set(String(approval.id), approval);
  };
  (Array.isArray(__pmChat.pendingApprovals?.[sid]) ? __pmChat.pendingApprovals[sid] : []).forEach(add);
  Object.entries(__pmChat.pendingApprovals || {}).forEach(([key, list]) => {
    if (key === sid || !Array.isArray(list)) return;
    list.forEach(add);
  });
  return [...out.values()];
}

function _mobileApprovalSurfaceSessionId() {
  const voiceRoute = String(window.location?.hash || '').startsWith('#mobile/voice');
  return String(
    (voiceRoute ? __pmVoice?.targetSessionId : __pmChat.activeSessionId)
    || __pmChat.activeSessionId
    || __pmVoice?.targetSessionId
    || MOBILE_CHAT_SESSION_ID,
  ).trim() || MOBILE_CHAT_SESSION_ID;
}

function _upsertMobilePendingApproval(approvalInput = {}) {
  const approval = _normalizeMobileApproval(approvalInput);
  if (!approval.id) return false;
  const lane = _linkMobileApprovalToBackgroundLane(approval);
  const storedApproval = lane?.approvalRequest || approval;
  const sid = _mobileApprovalVisibleSessionId(storedApproval) || storedApproval.sessionId || __pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID;
  if (!__pmChat.pendingApprovals) __pmChat.pendingApprovals = {};
  const list = Array.isArray(__pmChat.pendingApprovals[sid]) ? __pmChat.pendingApprovals[sid] : [];
  const idx = list.findIndex((item) => String(item?.id || '') === storedApproval.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...storedApproval };
  else list.push(storedApproval);
  __pmChat.pendingApprovals[sid] = list;
  mobileChatRuntimeAdapter.upsertApproval(sid, storedApproval);
  return true;
}

function _updateMobilePendingApproval(id, patch = {}) {
  const approvalId = String(id || '').trim();
  if (!approvalId || !__pmChat.pendingApprovals) return null;
  for (const [sid, list] of Object.entries(__pmChat.pendingApprovals)) {
    const idx = Array.isArray(list) ? list.findIndex((item) => String(item?.id || '') === approvalId) : -1;
    if (idx < 0) continue;
    list[idx] = _normalizeMobileApproval({ ...list[idx], ...patch, id: approvalId });
    const lane = _linkMobileApprovalToBackgroundLane(list[idx]);
    if (lane?.approvalRequest) list[idx] = lane.approvalRequest;
    __pmChat.pendingApprovals[sid] = list;
    mobileChatRuntimeAdapter.upsertApproval(sid, list[idx]);
    return list[idx];
  }
  return null;
}

const MOBILE_APPROVAL_RECENT_RESOLUTION_MS = 15000;
const mobileApprovalActionsInFlight = new Map();
const mobileApprovalResolvedAt = new Map();

function _mobileApprovalWasRecentlyResolved(id) {
  const approvalId = String(id || '').trim();
  if (!approvalId) return false;
  const resolvedAt = Number(mobileApprovalResolvedAt.get(approvalId) || 0);
  if (!resolvedAt) return false;
  if (Date.now() - resolvedAt <= MOBILE_APPROVAL_RECENT_RESOLUTION_MS) return true;
  mobileApprovalResolvedAt.delete(approvalId);
  return false;
}

function _wireMobileApprovalActionButton(button) {
  if (!button || button.dataset?.pmApprovalWired === '1') return;
  button.dataset.pmApprovalWired = '1';
  button.addEventListener('click', () => _resolveMobileApprovalButton(button));
}

function _renderMobileApprovalSheet() {
  const activeSessionId = _mobileApprovalSurfaceSessionId();
  const pending = _getPendingApprovalsForSession(activeSessionId)
    .filter((approval) => {
      const id = String(approval?.id || '').trim();
      if (!id) return false;
      const selector = `[data-pm-approval-id="${_pmCssEscape(id)}"]`;
      return ![...document.querySelectorAll(selector)].some((node) => !node.closest('#pm-global-approval-host'));
    });
  let host = document.getElementById('pm-global-approval-host');
  if (!pending.length) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'pm-global-approval-host';
    document.body.appendChild(host);
  }
  const openTerminals = {};
  const approvalDetails = _captureMobileApprovalDetailsState(host);
  try {
    host.querySelectorAll('[data-process-approval-host][data-terminal-open="1"]').forEach((terminalHost) => {
      const approvalId = String(terminalHost.getAttribute('data-process-approval-host') || '').trim();
      if (!approvalId || !terminalHost.parentElement) return;
      const toggle = terminalHost.parentElement.querySelector?.('[data-pm-process-action="load-approval"]') || null;
      openTerminals[approvalId] = {
        host: terminalHost,
        toggleText: toggle?.textContent || 'Close terminal',
      };
    });
  } catch {}
  host.innerHTML = `<div class="pm-global-approval-backdrop"></div>
    <div class="pm-global-approval-sheet" role="dialog" aria-live="polite" aria-label="Approval required">
      ${pending.map((approval) => _renderMobileApprovalCard(approval)).join('')}
    </div>`;
  try {
    _restoreMobileApprovalDetailsState(host, approvalDetails);
    Object.entries(openTerminals).forEach(([approvalId, snapshot]) => {
      const nextHost = host.querySelector(`[data-process-approval-host="${_pmCssEscape(approvalId)}"]`);
      if (!nextHost || !snapshot?.host) return;
      nextHost.replaceWith(snapshot.host);
      snapshot.host.dataset.terminalOpen = '1';
      const toggle = snapshot.host.parentElement?.querySelector?.('[data-pm-process-action="load-approval"]');
      if (toggle) toggle.textContent = snapshot.toggleText || 'Close terminal';
    });
  } catch {}
  host.querySelectorAll('[data-pm-approval-action][data-pm-approval-id]').forEach(_wireMobileApprovalActionButton);
  _wireMobileProcessRunActions(host);
}

function _captureMobileApprovalDetailsState(root) {
  const out = {};
  try {
    root?.querySelectorAll?.('[data-approval-id], [data-pm-approval-id]').forEach((card) => {
      const approvalId = String(card.getAttribute('data-approval-id') || card.getAttribute('data-pm-approval-id') || '').trim();
      if (!approvalId) return;
      card.querySelectorAll('details.pm-approval-technical').forEach((details) => {
        const label = String(details.querySelector('summary')?.textContent || '').trim();
        if (!label) return;
        out[`${approvalId}::${label}`] = details.open === true;
      });
    });
  } catch {}
  return out;
}

function _restoreMobileApprovalDetailsState(root, map) {
  if (!map) return;
  try {
    root?.querySelectorAll?.('[data-approval-id], [data-pm-approval-id]').forEach((card) => {
      const approvalId = String(card.getAttribute('data-approval-id') || card.getAttribute('data-pm-approval-id') || '').trim();
      if (!approvalId) return;
      card.querySelectorAll('details.pm-approval-technical').forEach((details) => {
        const label = String(details.querySelector('summary')?.textContent || '').trim();
        const key = `${approvalId}::${label}`;
        if (!Object.prototype.hasOwnProperty.call(map, key)) return;
        if (map[key]) details.setAttribute('open', '');
        else details.removeAttribute('open');
      });
    });
  } catch {}
}

async function _resolveMobileApprovalButton(button) {
  const id = String(button?.getAttribute?.('data-pm-approval-id') || '').trim();
  const action = String(button?.getAttribute?.('data-pm-approval-action') || '').trim();
  if (!id || !action) return;
  if (mobileApprovalActionsInFlight.has(id)) {
    console.debug('[mobile approvals] duplicate action ignored', { id, action, reason: 'in_flight' });
    return;
  }
  if (_mobileApprovalWasRecentlyResolved(id)) {
    console.debug('[mobile approvals] stale action ignored', { id, action, reason: 'recently_resolved' });
    return;
  }
  const approved = action === 'approve' || action === 'approve_session' || action === 'approve_always';
  const grantScope = action === 'approve_session' ? 'session' : action === 'approve_always' ? 'always' : '';
  const scope = button.closest('.pm-chat-approval, .pm-global-approval-sheet');
  scope?.querySelectorAll('button')?.forEach((btn) => { btn.disabled = true; });
  const request = (async () => {
    try {
      const result = approved ? await approveMobileApproval(id, grantScope) : await denyMobileApproval(id);
      mobileApprovalResolvedAt.set(id, Date.now());
      const updated = _updateMobilePendingApproval(id, { status: approved ? 'approved' : 'rejected' });
      pmToast(approved ? (grantScope === 'always' ? 'Always allowed' : grantScope === 'session' ? 'Allowed this session' : 'Approved') : 'Rejected', approved ? 'success' : 'info');
      const sid = _mobileApprovalVisibleSessionId(updated || result?.approval || { id }) || updated?.sessionId || updated?.sourceSessionId || __pmChat.activeSessionId;
      _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid || __pmChat.activeSessionId);
      if (String(sid || '') === String(__pmChat.activeSessionId || '')) {
        const threadEl = document.getElementById('pm-chat-thread');
        const bodyEl = document.getElementById('pm-chat-body');
        if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
      }
      _renderMobileApprovalSheet();
      if (approved) {
        setTimeout(() => {
          const host = document.querySelector(`[data-process-approval-host="${_pmCssEscape(id)}"]`);
          if (host) _pmLoadApprovalProcessRun(id, host).then(() => _wireMobileProcessRunActions(host)).catch(() => {});
        }, 100);
        const resumePrompt = String(result?.resumePrompt || '').trim();
        if (resumePrompt) {
          const resumeSid = String(result?.approval?.sessionId || updated?.sessionId || updated?.sourceSessionId || __pmChat.activeSessionId || '').trim();
          if (resumeSid) __pmChat.activeSessionId = resumeSid;
          if (typeof window.__pmMobileSendMessage === 'function') {
            setTimeout(() => window.__pmMobileSendMessage(resumePrompt, { fromApprovalResume: true }), 100);
          } else {
            const queue = _getMobileQueuedPrompts(resumeSid);
            queue.push(_makeMobileQueuedPrompt(resumePrompt));
            if (queue.length > PM_MOBILE_MAX_QUEUED_PROMPTS) queue.splice(0, queue.length - PM_MOBILE_MAX_QUEUED_PROMPTS);
            _renderMobileQueuedPromptsPanel(resumeSid);
            pmToast('Approval queued a resume message', 'info');
          }
        }
      }
    } catch (err) {
      const message = String(err?.message || err || '').trim();
      const alreadyHandled = /approval(?:\s+is)?\s+already\s+(?:approved|rejected|resolved)|approval\s+could\s+not\s+be\s+resolved/i.test(message);
      if (alreadyHandled) {
        mobileApprovalResolvedAt.set(id, Date.now());
        await _reconcileMobilePendingApprovals({ retry: false }).catch(() => {});
        return;
      }
      scope?.querySelectorAll('button')?.forEach((btn) => { btn.disabled = false; });
      pmToast(`Approval failed: ${message}`, 'error');
    }
  })();
  mobileApprovalActionsInFlight.set(id, request);
  try {
    await request;
  } finally {
    if (mobileApprovalActionsInFlight.get(id) === request) mobileApprovalActionsInFlight.delete(id);
  }
}

let _mobileApprovalReconcileInFlight = null;
let _mobileApprovalReconcileRetryTimer = null;
let _mobileApprovalReconcileFailures = 0;
let _mobileApprovalReconcileWarned = false;

function _replaceMobilePendingApprovals(approvals = []) {
  const pendingIds = new Set(
    (Array.isArray(approvals) ? approvals : [])
      .filter((approval) => String(approval?.status || 'pending').toLowerCase() === 'pending')
      .map((approval) => String(approval?.id || '').trim())
      .filter(Boolean),
  );
  Object.values(__pmChat.threads || {}).forEach((thread) => {
    (Array.isArray(thread) ? thread : []).forEach((message) => {
      const id = String(message?.approvalRequest?.id || '').trim();
      if (id && String(message.approvalRequest.status || 'pending').toLowerCase() === 'pending' && !pendingIds.has(id)) {
        message.approvalRequest = _normalizeMobileApproval({ ...message.approvalRequest, status: 'resolved' });
      }
    });
  });
  Object.values(_mobileBackgroundSpawnLanes()).forEach((lane) => {
    const id = String(lane?.approvalRequest?.id || '').trim();
    if (!id || pendingIds.has(id) || String(lane.approvalRequest.status || 'pending').toLowerCase() !== 'pending') return;
    lane.approvalRequest = _normalizeMobileApproval({ ...lane.approvalRequest, status: 'resolved' });
    if (lane.status === 'approval_required') lane.status = 'running';
  });
  __pmChat.pendingApprovals = {};
  (Array.isArray(approvals) ? approvals : []).forEach((approval) => {
    if (String(approval?.status || 'pending').toLowerCase() !== 'pending') return;
    _upsertMobilePendingApproval(approval);
  });
}

function _syncMobileApprovalSurfaces() {
  const sid = _mobileApprovalSurfaceSessionId();
  _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid);
  const threadEl = document.getElementById('pm-chat-thread');
  if (threadEl) _flushThreadRender(threadEl, document.getElementById('pm-chat-body'), sid);
  _renderMobileApprovalSheet();
}

async function _reconcileMobilePendingApprovals({ retry = true } = {}) {
  if (_mobileApprovalReconcileInFlight) return _mobileApprovalReconcileInFlight;
  const request = (async () => {
    try {
      const approvals = await loadMobileApprovals('pending');
      _replaceMobilePendingApprovals(approvals);
      _mobileApprovalReconcileFailures = 0;
      _mobileApprovalReconcileWarned = false;
      if (_mobileApprovalReconcileRetryTimer) clearTimeout(_mobileApprovalReconcileRetryTimer);
      _mobileApprovalReconcileRetryTimer = null;
      _syncMobileApprovalSurfaces();
      return approvals;
    } catch (err) {
      _mobileApprovalReconcileFailures += 1;
      console.warn('[mobile approvals] reconciliation failed:', err?.message || err);
      if (retry && getDeviceToken() && _mobileApprovalReconcileFailures < 4 && !_mobileApprovalReconcileRetryTimer) {
        const delay = [400, 1200, 3000][_mobileApprovalReconcileFailures - 1] || 3000;
        _mobileApprovalReconcileRetryTimer = setTimeout(() => {
          _mobileApprovalReconcileRetryTimer = null;
          _reconcileMobilePendingApprovals({ retry: true }).catch(() => {});
        }, delay);
      } else if (getDeviceToken() && _mobileApprovalReconcileFailures >= 4 && !_mobileApprovalReconcileWarned) {
        _mobileApprovalReconcileWarned = true;
        pmToast('Could not restore pending approvals. Reconnecting will retry.', 'warn');
      }
      throw err;
    }
  })();
  _mobileApprovalReconcileInFlight = request;
  try {
    return await request;
  } finally {
    if (_mobileApprovalReconcileInFlight === request) _mobileApprovalReconcileInFlight = null;
  }
}

async function _approvalFromMobileEvent(msg = {}) {
  if (msg.approval && typeof msg.approval === 'object') return _normalizeMobileApproval(msg.approval, msg);
  const id = String(msg.approvalId || msg.id || '').trim();
  try {
    const list = await loadMobileApprovals('pending');
    const found = (Array.isArray(list) ? list : []).find((item) => String(item.id || '') === id)
      || (Array.isArray(list) ? list : []).find((item) => String(item.sessionId || item.sourceSessionId || '') === String(msg.sessionId || ''));
    return found ? _normalizeMobileApproval(found, msg) : _normalizeMobileApproval(msg);
  } catch {
    return _normalizeMobileApproval(msg);
  }
}

function _installMobileApprovalBridge() {
  if (window.__pmMobileApprovalBridgeInstalled) return;
  const bus = window.wsEventBus || wsEventBus;
  if (!bus) return;
  window.__pmMobileApprovalBridgeInstalled = true;
  bus.on('approval_created', async (msg) => {
    const approval = await _approvalFromMobileEvent(msg);
    if (!approval?.id) return;
    _upsertMobilePendingApproval(approval);
    const sid = _mobileApprovalVisibleSessionId(approval);
    _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid || __pmChat.activeSessionId);
    if (String(sid) === String(__pmChat.activeSessionId || '')) {
      const threadEl = document.getElementById('pm-chat-thread');
      const bodyEl = document.getElementById('pm-chat-body');
      if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
    }
    _renderMobileApprovalSheet();
  });
  ['approval_approved', 'approval_denied', 'approval_expired', 'approval_failed'].forEach((eventName) => {
    bus.on(eventName, (msg = {}) => {
      const id = String(msg.approvalId || msg.id || msg.approval?.id || '').trim();
      if (!id) return;
      const status = eventName === 'approval_approved' ? 'approved'
        : eventName === 'approval_denied' ? 'rejected'
          : eventName === 'approval_expired' ? 'expired'
            : 'failed';
      const updated = _updateMobilePendingApproval(id, { ...(msg.approval || {}), status });
      const sid = _mobileApprovalVisibleSessionId(updated || msg.approval || msg) || updated?.sessionId || updated?.sourceSessionId || msg.sessionId || '';
      _renderMobileBackgroundSpawnDock(document.getElementById('pm-background-spawn-dock'), sid || __pmChat.activeSessionId);
      if (String(sid) === String(__pmChat.activeSessionId || '')) {
        const threadEl = document.getElementById('pm-chat-thread');
        const bodyEl = document.getElementById('pm-chat-body');
        if (threadEl) _flushThreadRender(threadEl, bodyEl, sid || 'chat');
      }
      _renderMobileApprovalSheet();
    });
  });
  const reconcile = () => {
    if (!getDeviceToken()) return;
    _reconcileMobilePendingApprovals({ retry: true }).catch(() => {});
  };
  const reconcileWhenVisible = () => {
    if (document.visibilityState === 'visible') reconcile();
  };
  bus.on('ws:open', reconcile);
  window.addEventListener('online', reconcile);
  window.addEventListener('pageshow', reconcile);
  window.addEventListener('focus', reconcile);
  document.addEventListener('visibilitychange', reconcileWhenVisible);
  queueMicrotask(reconcile);
}

_installMobileApprovalBridge();

function _renderMobileVariantNav(index) {
  const variants = _getMobilePromptVariants(index);
  if (variants.length < 2) return '';
  const active = _getMobilePromptVariantActiveIndex(index);
  return `<span class="pm-msg-variant-nav" aria-label="Prompt variants">
    <button type="button" class="pm-msg-action" data-msg-action="variant-prev" data-msg-index="${index}" ${active <= 0 ? 'disabled' : ''}>‹</button>
    <span>${active + 1}/${variants.length}</span>
    <button type="button" class="pm-msg-action" data-msg-action="variant-next" data-msg-index="${index}" ${active >= variants.length - 1 ? 'disabled' : ''}>›</button>
  </span>`;
}

function _renderMobileMessageActions(m, index) {
  if (m?.streaming || index < 0) return '';
  const isUser = m?.role === 'user';
  // User messages: no inline action bar — long-press the bubble opens the popover instead.
  if (isUser) {
    const variantNav = _renderMobileVariantNav(index);
    return variantNav ? `<div class="pm-msg-actions pm-msg-actions-user-variants">${variantNav}</div>` : '';
  }
  const secondary = `<button type="button" class="pm-msg-action" data-msg-action="fork" data-msg-index="${index}" title="Fork" aria-label="Fork">${ICONS.fork || ICONS.chev}</button>`;
  return `<div class="pm-msg-actions">
    <button type="button" class="pm-msg-action" data-msg-action="copy" data-msg-index="${index}" title="Copy" aria-label="Copy">${ICONS.clipboard}<input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" /></button>
    <button type="button" class="pm-msg-action" data-msg-action="speak" data-msg-index="${index}" title="Speak response" aria-label="Speak response">${ICONS.volume || ICONS.play}<input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" /></button>
    ${secondary.replace('</button>', '<input type="checkbox" switch class="pm-haptic-switch-overlay" aria-hidden="true" tabindex="-1" /></button>')}
  </div>`;
}

function _renderMobileUserEditComposer(m, index, attachmentHtml = '') {
  const value = escapeHtml(String(m?._editingDraft ?? m?.body?.text ?? m?.content ?? ''));
  // Only stop propagation for non-action targets (e.g. tapping the textarea) so
  // the Cancel/Send buttons still reach the delegated threadEl click handler.
  return `<div class="pm-mobile-edit-composer" data-msg-edit-index="${index}" onclick="if(!event.target.closest('[data-msg-action]'))event.stopPropagation()">
    <textarea class="pm-mobile-edit-input" rows="4" data-msg-edit-input="${index}">${value}</textarea>
    ${attachmentHtml}
    <div class="pm-mobile-edit-actions">
      <button type="button" class="pm-msg-action" data-msg-action="cancel-edit" data-msg-index="${index}">Cancel</button>
      <button type="button" class="pm-msg-action primary" data-msg-action="submit-edit" data-msg-index="${index}">Send</button>
    </div>
  </div>`;
}

function _normalizeMobileFileChanges(fileChanges) {
  const files = Array.isArray(fileChanges?.files) ? fileChanges.files : [];
  if (!files.length) return null;
  const normalizedFiles = files.map((file) => {
    const path = String(file?.path || file?.displayPath || '').trim();
    const displayPath = String(file?.displayPath || path || '').trim();
    const displayIsAbsolute = /^(?:[a-zA-Z]:[\\/]|\/)/.test(displayPath);
    const openPath = displayPath && !displayIsAbsolute ? displayPath : path;
    const statusRaw = String(file?.status || 'modified').toLowerCase();
    const status = ['added', 'modified', 'deleted', 'renamed'].includes(statusRaw) ? statusRaw : 'modified';
    return {
      path,
      openPath,
      displayPath,
      status,
      insertions: Math.max(0, Number(file?.insertions) || 0),
      deletions: Math.max(0, Number(file?.deletions) || 0),
      binary: file?.binary === true,
    };
  }).filter((file) => file.displayPath || file.path);
  if (!normalizedFiles.length) return null;
  const summary = fileChanges?.summary && typeof fileChanges.summary === 'object' ? fileChanges.summary : {};
  return {
    summary: {
      fileCount: Math.max(normalizedFiles.length, Number(summary.fileCount) || 0),
      insertions: Math.max(0, Number(summary.insertions) || normalizedFiles.reduce((sum, file) => sum + file.insertions, 0)),
      deletions: Math.max(0, Number(summary.deletions) || normalizedFiles.reduce((sum, file) => sum + file.deletions, 0)),
    },
    files: normalizedFiles,
    checkpoint: _normalizeMobileWorkspaceCheckpoint(fileChanges?.checkpoint),
  };
}

function _mergeMobileWorkspaceChangeEvent(event = {}) {
  const run = event?.run && typeof event.run === 'object' ? event.run : {};
  const sessionId = String(event.sessionId || run.sessionId || '').trim();
  if (!sessionId || sessionId !== String(__pmChat.activeSessionId || '').trim()) return false;
  const incoming = _normalizeMobileFileChanges({
    files: event.workspaceChanges || run.workspaceChanges || event.workspace_changes,
    summary: event.summary,
  });
  if (!incoming) return false;
  const thread = Array.isArray(__pmChat.threads?.[sessionId]) ? __pmChat.threads[sessionId] : [];
  const target = [...thread].reverse().find((message) => message?.role === 'ai' || message?.role === 'assistant');
  if (!target) return false;
  const existing = _normalizeMobileFileChanges(target.fileChanges);
  const files = [...(existing?.files || []), ...incoming.files];
  const byPath = new Map(files.map((file) => [String(file.path || file.displayPath).toLowerCase(), file]));
  target.fileChanges = _normalizeMobileFileChanges({
    files: Array.from(byPath.values()),
    summary: {
      fileCount: byPath.size,
      insertions: Array.from(byPath.values()).reduce((sum, file) => sum + Number(file.insertions || 0), 0),
      deletions: Array.from(byPath.values()).reduce((sum, file) => sum + Number(file.deletions || 0), 0),
    },
  });
  return true;
}

function _normalizeMobileWorkspaceCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  const id = String(checkpoint.id || checkpoint.checkpoint_id || checkpoint.checkpointId || '').trim();
  if (!id) return null;
  return {
    id,
    createdAt: Number(checkpoint.createdAt || checkpoint.created_at || 0) || 0,
    snapshotCount: Math.max(0, Number(checkpoint.snapshotCount || checkpoint.snapshot_count || 0) || 0),
  };
}

function _normalizeMobileFileChangeGroups(fileChanges) {
  const groups = Array.isArray(fileChanges?.groups) ? fileChanges.groups : [];
  if (!groups.length) return [];
  return groups.map((group, index) => {
    const data = _normalizeMobileFileChanges(group?.fileChanges || group);
    if (!data) return null;
    return {
      id: String(group?.id || group?.source || `group_${index + 1}`),
      label: String(group?.label || (index === 0 ? 'Main agent edits' : 'Background agent edits')).trim(),
      data,
    };
  }).filter(Boolean);
}

function _renderMobileFileChangeRow(file) {
  const openPath = String(file.openPath || file.path || '').trim();
  const canOpen = openPath && file.status !== 'deleted';
  const kind = _mobileMediaKind({ path: openPath, name: file.displayPath });
  return `
    <div class="pm-file-change-row ${canOpen ? 'is-openable' : 'is-disabled'}"
      ${canOpen ? `data-pm-file-change-path="${escapeHtml(openPath)}" data-pm-file-change-name="${escapeHtml(file.displayPath.split(/[\\/]/).pop() || file.displayPath || 'file')}" data-pm-file-change-kind="${escapeHtml(kind)}"` : 'aria-disabled="true"'}>
      <div class="pm-file-change-main">
        <span class="pm-file-change-status ${escapeHtml(file.status)}">${escapeHtml(file.binary ? 'binary' : file.status)}</span>
        <span class="pm-file-change-path">${escapeHtml(file.displayPath)}</span>
      </div>
      <div class="pm-file-change-counts">
        <span class="ins">+${file.insertions}</span>
        <span class="del">-${file.deletions}</span>
      </div>
    </div>
  `;
}

function _renderMobileWorkspaceCheckpointAction(checkpoint) {
  if (!checkpoint?.id) return '';
  const title = checkpoint.snapshotCount
    ? `Restore this turn checkpoint (${checkpoint.snapshotCount} snapshots)`
    : 'Restore this turn checkpoint';
  return `<button type="button" class="pm-file-change-restore-btn" data-pm-restore-checkpoint="${escapeHtml(checkpoint.id)}" title="${escapeHtml(title)}">Restore</button>`;
}

function _renderMobileFileChangesGroup(data, options = {}) {
  if (!data) return '';
  const visible = data.files.slice(0, 3);
  const rest = data.files.slice(3);
  const fileWord = data.summary.fileCount === 1 ? 'file' : 'files';
  const label = String(options.label || '').trim();
  const checkpointAction = _renderMobileWorkspaceCheckpointAction(options.checkpoint || data.checkpoint);
  return `
    <div class="pm-file-changes-card pm-file-changes-card--turn-summary">
      <div class="pm-file-changes-head">
        <strong>${label ? `${escapeHtml(label)} - ` : ''}${data.summary.fileCount} ${fileWord} changed</strong>
        <span class="pm-file-changes-actions">${checkpointAction}<span class="pm-file-changes-total"><em class="ins">+${data.summary.insertions}</em><em class="del">-${data.summary.deletions}</em></span></span>
      </div>
      <div class="pm-file-change-list">
        ${visible.map(_renderMobileFileChangeRow).join('')}
        ${rest.length ? `
          <details class="pm-file-change-more">
            <summary>View ${rest.length} more ${rest.length === 1 ? 'file' : 'files'}</summary>
            ${rest.map(_renderMobileFileChangeRow).join('')}
          </details>
        ` : ''}
      </div>
    </div>
  `;
}

function _renderMobileFileChanges(fileChanges) {
  const groups = _normalizeMobileFileChangeGroups(fileChanges);
  const checkpoint = _normalizeMobileWorkspaceCheckpoint(fileChanges?.checkpoint);
  if (groups.length) {
    return `<div class="pm-file-changes-grouped">${groups.map((group, index) => _renderMobileFileChangesGroup(group.data, { label: group.label, checkpoint: index === 0 ? checkpoint : null })).join('')}</div>`;
  }
  return _renderMobileFileChangesGroup(_normalizeMobileFileChanges(fileChanges));
}

function _productCarouselImageUrl(item) {
  const imagePath = String(item?.imagePath || '').trim();
  if (imagePath) return `/api/canvas/download?path=${encodeURIComponent(imagePath)}`;
  return String(item?.imageUrl || '').trim();
}

function _renderMobileProductCarousel(message) {
  const carousel = message?.productCarousel && typeof message.productCarousel === 'object' ? message.productCarousel : null;
  const items = Array.isArray(carousel?.items) ? carousel.items.filter(Boolean) : [];
  if (!items.length) return '';
  const title = String(carousel?.title || '').trim();
  const cards = items.map((item) => {
    const productUrl = String(item?.productUrl || '').trim();
    const imgSrc = _productCarouselImageUrl(item);
    const tag = String(item?.tag || item?.badge || '').trim();
    const price = String(item?.price || '').trim();
    const desc = String(item?.description || '').trim();
    const rating = item?.rating != null && Number.isFinite(Number(item.rating))
      ? Number(item.rating).toFixed(1)
      : '';
    const reviewValue = item?.reviews ?? item?.reviewCount;
    const reviewLabel = reviewValue != null && Number.isFinite(Number(reviewValue)) && Number(reviewValue) > 0
      ? ` (${Number(reviewValue).toLocaleString()})`
      : '';
    const body = `
      <div class="pm-product-img-wrap">
        ${imgSrc ? `<img class="pm-product-img" src="${escapeHtml(imgSrc)}" alt="" loading="lazy">` : '<div class="pm-product-img pm-product-img-placeholder"></div>'}
        ${tag ? `<span class="pm-product-tag">${escapeHtml(tag)}</span>` : ''}
      </div>
      <strong class="pm-product-title">${escapeHtml(String(item?.title || 'Product'))}</strong>
      ${(price || desc) ? `<div class="pm-product-meta">${price ? `<span>${escapeHtml(price)}</span>` : ''}${desc ? `<em>${escapeHtml(desc)}</em>` : ''}</div>` : ''}
      ${rating ? `<div class="pm-product-rating">Rating ${escapeHtml(rating)}${escapeHtml(reviewLabel)}</div>` : ''}
    `;
    return productUrl
      ? `<a class="pm-product-card" href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">${body}</a>`
      : `<div class="pm-product-card">${body}</div>`;
  }).join('');
  return `<div class="pm-product-carousel">
    ${title ? `<div class="pm-product-heading">${escapeHtml(title)}</div>` : ''}
    <div class="pm-product-track">${cards}</div>
  </div>`;
}

function _mobileEmailList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw.map((item) => String(item || '').trim()).filter(Boolean);
}

function _renderMobileEmailComposerArtifact(a) {
  if (!a || typeof a !== 'object') return '';
  const id = String(a.id || `email_${Date.now().toString(36)}`).trim();
  const status = String(a.status || a.mode || 'draft').toLowerCase();
  const sent = status === 'sent' || String(a.mode || '').toLowerCase() === 'sent';
  const to = _mobileEmailList(a.to).join(', ');
  const cc = _mobileEmailList(a.cc).join(', ');
  const bcc = _mobileEmailList(a.bcc).join(', ');
  const subject = String(a.subject || '').trim();
  const body = String(a.body || '');
  const attachments = Array.isArray(a.attachments) ? a.attachments.filter(Boolean) : [];
  const title = sent ? 'Email sent' : (subject || 'New email');
  const sentMeta = [
    a.sentAt ? new Date(a.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
    a.messageId ? `Message ${String(a.messageId).slice(0, 18)}` : '',
  ].filter(Boolean).join(' · ');
  const hidden = (name, value) => `<input type="hidden" data-email-field="${name}" value="${escapeHtml(String(value || ''))}">`;
  return `<article class="pm-email-composer-card ${sent ? 'is-sent' : 'is-draft'}" data-email-composer-id="${escapeHtml(id)}">
    ${hidden('to', to)}${hidden('cc', cc)}${hidden('bcc', bcc)}${hidden('subject', subject)}
    <textarea class="pm-email-composer-body" data-email-field="body" hidden>${escapeHtml(body)}</textarea>
    <div class="pm-email-composer-kicker">${escapeHtml(title)}</div>
    <div class="pm-email-composer-preview">${escapeHtml(body || '(empty draft)')}</div>
    ${attachments.length ? `<div class="pm-email-composer-attachments">${attachments.map((att) => {
      const name = String(att?.name || att?.filename || 'Attachment').trim();
      return `<span>${ICONS.paperclip}${escapeHtml(name)}</span>`;
    }).join('')}</div>` : ''}
    ${sent ? `<div class="pm-email-composer-sent">Sent${sentMeta ? ' · ' + escapeHtml(sentMeta) : ''}</div>` : `<div class="pm-email-composer-actions">
      <button type="button" class="pm-email-composer-send" data-email-composer-action="send">Send email</button>
      <button type="button" class="pm-email-composer-discard" data-email-composer-action="discard">Discard</button>
    </div>`}
    <div class="pm-email-composer-notice" hidden></div>
  </article>`;
}

function _findMobileEmailComposerArtifact(artifactId) {
  const id = String(artifactId || '').trim();
  if (!id) return null;
  const threads = __pmChat.threads && typeof __pmChat.threads === 'object' ? __pmChat.threads : {};
  for (const [sessionId, thread] of Object.entries(threads)) {
    if (!Array.isArray(thread)) continue;
    for (const message of thread) {
      const artifacts = Array.isArray(message?.richArtifacts) ? message.richArtifacts : [];
      const artifact = artifacts.find((item) => item?.type === 'email_composer' && String(item.id || '') === id);
      if (artifact) return { sessionId, thread, message, artifact };
    }
  }
  return null;
}

function _mobileEmailComposerPayload(card) {
  const get = (name) => String(card?.querySelector?.(`[data-email-field="${name}"]`)?.value || '').trim();
  return {
    artifactId: String(card?.getAttribute?.('data-email-composer-id') || '').trim(),
    sessionId: String(__pmChat.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID,
    to: get('to'),
    cc: get('cc'),
    bcc: get('bcc'),
    subject: get('subject'),
    body: get('body'),
  };
}

function _setMobileEmailComposerNotice(card, message, kind = 'info') {
  if (!card) return;
  let notice = card.querySelector('.pm-email-composer-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'pm-email-composer-notice';
    card.querySelector('.pm-email-composer-panel')?.appendChild(notice);
  }
  notice.textContent = String(message || '');
  notice.dataset.kind = kind;
  notice.hidden = !message;
}

async function _sendMobileEmailComposer(button) {
  const card = button?.closest?.('.pm-email-composer-card');
  const payload = _mobileEmailComposerPayload(card);
  if (!payload.to) {
    _setMobileEmailComposerNotice(card, 'Add at least one recipient.', 'error');
    return;
  }
  if (!payload.subject) {
    _setMobileEmailComposerNotice(card, 'Add a subject before sending.', 'error');
    return;
  }
  button.disabled = true;
  const previous = button.innerHTML;
  button.innerHTML = `${ICONS.send}<span>Sending</span>`;
  _setMobileEmailComposerNotice(card, '', 'info');
  try {
    const data = await mobileGatewayFetch('/api/connectors/gmail/send-composer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!data?.success) throw new Error(data?.error || 'Could not send email');
    const found = _findMobileEmailComposerArtifact(payload.artifactId);
    if (found?.artifact && data.artifact) Object.assign(found.artifact, data.artifact);
    const sid = found?.sessionId || payload.sessionId;
    const thread = found?.thread || __pmChat.threads?.[sid] || _activeMobileThread();
    if (sid && Array.isArray(thread)) {
      updateMobileChatSessionHistory(sid, _mobileHistoryForServer(thread)).catch((err) => {
        console.warn('[mobile email composer] failed to sync sent email card:', err);
      });
    }
    pmToast('Email sent', 'success');
    _renderMobileChatSessionNow(sid);
  } catch (err) {
    _setMobileEmailComposerNotice(card, err?.message || 'Could not send email.', 'error');
    button.disabled = false;
    button.innerHTML = previous;
  }
}

function _handleMobileEmailComposerAction(button) {
  const action = String(button?.getAttribute?.('data-email-composer-action') || '').trim();
  const card = button?.closest?.('.pm-email-composer-card');
  if (!action || !card) return;
  if (action === 'send') {
    _sendMobileEmailComposer(button);
    return;
  }
  if (action === 'discard') {
    card.remove();
    pmToast('Draft hidden', 'info');
    return;
  }
  _setMobileEmailComposerNotice(card, action === 'attach' ? 'Attachments are managed by Prometheus for now.' : 'You can edit the draft text directly.', 'info');
}

function _renderMobileRichArtifacts(message) {
  const artifacts = Array.isArray(message?.richArtifacts) ? message.richArtifacts : [];
  if (!artifacts.length) return '';
  return artifacts.map((a) => {
    switch (a?.type) {
      case 'products': return _renderMobileProductCarousel({ productCarousel: { title: a.title, items: a.items } });
      case 'agent_work': return _renderMobileAgentWork(a);
      case 'sources': return _renderMobileSources(a);
      case 'stocks': return _renderMobileMarket(a);
      case 'weather': return _renderMobileWeather(a);
      case 'comparison': return _renderMobileComparison(a);
      case 'chart': return _renderMobileChart(a);
      case 'run_result': return _renderMobileRunResult(a);
      case 'map': return _renderMobileMap(a);
      case 'prediction_market': return _renderMobilePredictionMarket(a);
      case 'email_composer': return _renderMobileEmailComposerArtifact(a);
      default: return '';
    }
  }).join('');
}

function _renderMobileThreadLinkArtifacts(message) {
  const artifacts = Array.isArray(message?.richArtifacts)
    ? message.richArtifacts.filter((artifact) => artifact?.type === 'thread_links')
    : [];
  if (!artifacts.length) return '';
  const seen = new Set();
  const cards = artifacts.flatMap((artifact) => Array.isArray(artifact?.items) ? artifact.items : [])
    .filter((item) => {
      const sessionId = String(item?.sessionId || '').trim();
      if (!sessionId || seen.has(sessionId)) return false;
      seen.add(sessionId);
      return true;
    })
    .map((item) => {
      const sessionId = String(item.sessionId || '').trim();
      const label = String(item.label || 'Thread touched').trim();
      const title = String(item.title || 'Prometheus thread').trim();
      const detail = String(item.subtitle || item.status || '').trim();
      return `<button type="button" class="pm-thread-link-card" data-pm-thread-session="${escapeHtml(sessionId)}" onclick="window.pmOpenPrometheusThread(this.dataset.pmThreadSession)" aria-label="Open Prometheus thread ${escapeHtml(title)}">
        <span class="pm-thread-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7.5 18.25 4 20l.85-3.75A8 8 0 1 1 7.5 18.25Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="pm-thread-link-copy"><span class="pm-thread-link-label">${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>
        <span class="pm-thread-link-open">Open thread <span aria-hidden="true">›</span></span>
      </button>`;
    }).join('');
  return cards ? `<div class="pm-thread-links-artifact">${cards}</div>` : '';
}

function _openMobilePrometheusThread(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return;
  __pmChat.activeSessionId = id;
  _rememberMobileLastChatSession(id);
  window.location.hash = `#mobile/chat/${encodeURIComponent(id)}`;
}

window.pmOpenPrometheusThread = _openMobilePrometheusThread;

function _renderMobilePredictionMarket(a) {
  const items = Array.isArray(a?.items) ? a.items.filter(Boolean) : [];
  if (!items.length) return '';
  const title = String(a?.title || 'Polymarket').trim();
  const cards = items.map((it) => {
    const outcomes = Array.isArray(it.outcomes) ? it.outcomes.slice(0, 6) : [];
    const binary = outcomes.length === 2 && /^(yes|no)$/i.test(String(outcomes[0]?.label || ''));
    const rows = outcomes
      .slice()
      .sort((x, y) => (Number(y.price) || 0) - (Number(x.price) || 0))
      .map((o) => {
        const pct = Number.isFinite(Number(o.price)) ? Math.round(Number(o.price) * 100) : null;
        return `<div class="pm-pmkt-outcome">
          <div class="pm-pmkt-outcome-top"><span>${escapeHtml(String(o.label || ''))}</span><span class="pm-pmkt-pct">${pct != null ? pct + '%' : '—'}</span></div>
          <div class="pm-pmkt-bar"><div class="pm-pmkt-bar-fill${binary && /^yes$/i.test(String(o.label)) ? ' yes' : (binary ? ' no' : '')}" style="width:${pct != null ? pct : 0}%"></div></div>
        </div>`;
      }).join('');
    const end = it.endDate ? new Date(it.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const icon = it.icon ? `<img class="pm-pmkt-icon" src="${escapeHtml(String(it.icon))}" alt="" loading="lazy">` : '';
    const inner = `<div class="pm-pmkt-q">${icon}<span>${escapeHtml(String(it.question || ''))}</span></div><div class="pm-pmkt-outcomes">${rows}</div>${end ? `<div class="pm-pmkt-meta">Ends ${escapeHtml(end)}</div>` : ''}`;
    return it.url
      ? `<a class="pm-pmkt-card" href="${escapeHtml(String(it.url))}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="pm-pmkt-card">${inner}</div>`;
  }).join('');
  return `<div class="pm-prediction-market"><div class="pm-pmkt-heading">${escapeHtml(title)}</div><div class="pm-pmkt-cards">${cards}</div><div class="pm-pmkt-source">Polymarket · read-only</div></div>`;
}

function _renderMobileWeather(a) {
  if (!a || typeof a !== 'object') return '';
  const loc = String(a.location || '').trim();
  const unit = String(a.unit || 'F').toUpperCase();
  const cur = a.current || {};
  const daily = Array.isArray(a.daily) ? a.daily : [];
  const hourly = Array.isArray(a.hourly) ? a.hourly : [];
  if (!loc && !daily.length) return '';
  const selectDay = `const c=this.closest('.pm-weather');const i=Number(this.dataset.pmWxDay);c.querySelectorAll('.pm-wx-day').forEach((b)=>{const active=Number(b.dataset.pmWxDay)===i;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active))});c.querySelectorAll('.pm-wx-hourly-panel').forEach((p)=>{p.hidden=Number(p.dataset.pmWxPanel)!==i});`;
  const days = daily.map((d, i) => `
    <button type="button" class="pm-wx-day${i === 0 ? ' is-active' : ''}" data-pm-wx-day="${i}" aria-pressed="${i === 0 ? 'true' : 'false'}" onclick="${selectDay}">
      <div class="pm-wx-day-name">${escapeHtml(String(d.day || ''))}</div>
      <div class="pm-wx-day-icon">${escapeHtml(String(d.icon || '🌡️'))}</div>
      <div class="pm-wx-day-hi">${d.high != null ? escapeHtml(String(d.high)) + '°' : ''}</div>
      <div class="pm-wx-day-lo">${d.low != null ? escapeHtml(String(d.low)) + '°' : ''}</div>
    </button>`).join('');
  const panels = daily.map((d, i) => {
    const date = String(d.date || '');
    const hours = hourly.filter((h) => (date ? String(h.date || '') === date : i === 0 && !h.date));
    const cells = hours.map((h) => {
      const precip = Number(h.precipitationProbability);
      const feels = Number(h.feelsLike);
      const showFeels = Number.isFinite(feels) && Math.abs(feels - Number(h.temp)) >= 2;
      return `<div class="pm-wx-hour"><span class="pm-wx-hour-time">${escapeHtml(String(h.time || ''))}</span><span class="pm-wx-hour-icon">${escapeHtml(String(h.icon || '🌡️'))}</span><strong>${h.temp != null ? escapeHtml(String(h.temp)) + '°' : '—'}</strong>${showFeels ? `<small>Feels ${escapeHtml(String(feels))}°</small>` : ''}${Number.isFinite(precip) && precip > 0 ? `<small class="pm-wx-hour-rain">💧 ${precip}%</small>` : ''}</div>`;
    }).join('');
    return `<div class="pm-wx-hourly-panel" data-pm-wx-panel="${i}"${i === 0 ? '' : ' hidden'}><div class="pm-wx-hourly-title"><strong>${escapeHtml(String(d.day || ''))} hourly</strong><span>Swipe for more</span></div>${cells ? `<div class="pm-wx-hourly-track">${cells}</div>` : `<div class="pm-wx-hourly-empty">Hourly details are unavailable for this day.</div>`}</div>`;
  }).join('');
  return `<div class="pm-weather">
    <div class="pm-wx-head">
      <div class="pm-wx-loc">${escapeHtml(loc)}</div>
      <div class="pm-wx-now">${cur.temp != null ? escapeHtml(String(cur.temp)) + '°' + escapeHtml(unit) : ''}</div>
      <div class="pm-wx-cond">${escapeHtml(String(cur.icon || ''))} ${escapeHtml(String(cur.condition || ''))}</div>
    </div>
    ${days ? `<div class="pm-wx-days">${days}</div>` : ''}
    ${panels ? `<div class="pm-wx-hourly">${panels}</div>` : ''}
  </div>`;
}

function _renderMobileComparison(a) {
  const columns = Array.isArray(a?.columns) ? a.columns.filter((c) => c && c.key) : [];
  const rows = Array.isArray(a?.rows) ? a.rows : [];
  if (!columns.length || !rows.length) return '';
  const title = String(a?.title || '').trim();
  const labelKey = String(a?.labelKey || columns[0].key);
  const highlight = String(a?.highlightColumn || '');
  const head = `<tr>${columns.map((c) => `<th class="${c.key === highlight ? 'pm-cmp-hl' : ''}">${escapeHtml(String(c.label || c.key))}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const v = r[c.key];
    const cell = (v === true) ? '✓' : (v === false) ? '—' : (v == null ? '' : String(v));
    return `<td class="${c.key === highlight ? 'pm-cmp-hl' : ''}${c.key === labelKey ? ' pm-cmp-label' : ''}">${escapeHtml(cell)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="pm-comparison">${title ? `<div class="pm-cmp-heading">${escapeHtml(title)}</div>` : ''}<div class="pm-cmp-scroll"><table class="pm-cmp-table"><thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
}

function _pmRichChartSrcdoc(artifact) {
  const series = (Array.isArray(artifact?.series) ? artifact.series : []).map((s) => ({ ...s, points: (Array.isArray(s?.points) ? s.points : (Array.isArray(s?.data) ? s.data : [])).map((p, i) => ({ x: p?.x ?? p?.label ?? p?.date ?? p?.time ?? i + 1, y: Number(p?.y ?? p?.value) })).filter((p) => Number.isFinite(p.y)) })).filter((s) => s.points.length);
  const payload = JSON.stringify({ chartType: artifact?.chartType, series, xLabel: artifact?.xLabel, yLabel: artifact?.yLabel, unit: artifact?.unit, stacked: artifact?.stacked === true }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101a22;font-family:system-ui,sans-serif}#chart{height:100%;width:100%}</style></head><body><canvas id="chart"></canvas><script src="/vendor/chart/chart.umd.js"><\/script><script>const a=${payload};const palette=['#55a7ff','#42d392','#f6b44d','#fb7185','#b58cff','#2dd4bf','#f472b6','#a3e635'];const labels=[...new Set(a.series.flatMap(s=>s.points.map(p=>String(p.x))))];const rgba=(hex,alpha)=>{const clean=String(hex||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(clean))return 'rgba(85,167,255,'+alpha+')';const n=parseInt(clean,16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+alpha+')'};const radial=['pie','doughnut'].includes(a.chartType);const type=a.chartType==='area'?'line':(a.chartType==='scatter'?'scatter':(radial?a.chartType:(a.chartType==='bar'?'bar':'line')));const datasets=a.series.map((s,i)=>{const color=s.color||palette[i%palette.length];const values=radial?s.points.map(p=>p.y):(type==='scatter'?s.points.map(p=>({x:p.x,y:p.y})):labels.map(x=>{const p=s.points.find(point=>String(point.x)===x);return p?p.y:null}));return {label:s.label||'Series '+(i+1),data:values,borderColor:color,backgroundColor:radial?s.points.map((p,j)=>p.color||palette[j%palette.length]):rgba(color,type==='bar'?'.72':(a.chartType==='area'?'.25':'.12')),borderWidth:radial?1:2,fill:a.chartType==='area',tension:.32,pointRadius:type==='line'?2.5:(type==='scatter'?4:0),pointHoverRadius:5,borderRadius:type==='bar'?5:0,stack:a.stacked?'prometheus':undefined};});const tick='#9fb1bd',grid='rgba(173,208,220,.12)';new Chart(document.getElementById('chart'),{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:!radial&&datasets.length>1,position:'bottom',labels:{color:tick,boxWidth:10,boxHeight:10,padding:12,font:{size:10}}},tooltip:{backgroundColor:'#0b1820',padding:10,callbacks:{label:c=>{const v=c.parsed.y??c.raw;return ' '+c.dataset.label+': '+String(v)+(a.unit||'')}}}},scales:radial?{}:{x:{stacked:a.stacked,ticks:{color:tick,maxRotation:0,autoSkip:true,maxTicksLimit:5,font:{size:9}},title:{display:!!a.xLabel,text:a.xLabel,color:tick,font:{size:9,weight:'600'}},grid:{display:false}},y:{stacked:a.stacked,ticks:{color:tick,font:{size:9},callback:v=>String(v)+(a.unit||'')},title:{display:!!a.yLabel,text:a.yLabel,color:tick,font:{size:9,weight:'600'}},grid:{color:grid}}}}});<\/script></body></html>`;
}
function _renderMobileChart(a) {
  const title = String(a?.title || '').trim();
  const source = String(a?.source || '').trim();
  const updatedAt = a?.updatedAt ? new Date(a.updatedAt) : null;
  const freshness = updatedAt && Number.isFinite(updatedAt.getTime()) ? `Updated ${updatedAt.toLocaleString()}` : '';
  return `<div class="pm-chart">${title ? `<div class="pm-chart-heading">${escapeHtml(title)}</div>` : ''}<div class="pm-chart-frame-wrap"><iframe class="pm-chart-frame" title="Interactive chart" srcdoc="${escapeHtml(_pmRichChartSrcdoc(a))}" loading="lazy"></iframe></div>${(source || freshness) ? `<div class="pm-chart-meta">${source ? `<span>${escapeHtml(source)}</span>` : ''}${freshness ? `<span>${escapeHtml(freshness)}</span>` : ''}</div>` : ''}</div>`;
}

function _renderMobileRunResult(a) {
  if (!a || typeof a !== 'object') return '';
  const title = String(a.title || 'Task complete').trim();
  const status = String(a.status || '').trim();
  const summary = String(a.summary || '').trim();
  const files = Array.isArray(a.files) ? a.files : [];
  const links = Array.isArray(a.links) ? a.links : [];
  const filePills = files.map((f) => {
    const p = String(f.path || '').trim();
    if (!p) return '';
    return `<span class="pm-rr-file">📄 ${escapeHtml(String(f.label || p.split(/[\\/]/).pop() || p))}</span>`;
  }).join('');
  const linkPills = links.map((l) => `<a class="pm-rr-link" href="${escapeHtml(String(l.href))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(l.label || l.href))} ↗</a>`).join('');
  return `<div class="pm-run-result">
    <div class="pm-rr-head"><span>✅</span><strong>${escapeHtml(title)}</strong>${status ? `<span class="pm-aw-status ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span>` : ''}</div>
    ${summary ? `<div class="pm-rr-summary">${escapeHtml(summary)}</div>` : ''}
    ${filePills ? `<div class="pm-rr-files">${filePills}</div>` : ''}
    ${linkPills ? `<div class="pm-rr-links">${linkPills}</div>` : ''}
  </div>`;
}

function _pmRichMapSrcdoc(center, markers, zoom) {
  const located = markers.filter((m) => Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng))).map((m) => ({ ...m, lat: Number(m.lat), lng: Number(m.lng) }));
  const fallback = located[0] || { lat: 0, lng: 0 };
  const payload = JSON.stringify({ center: { lat: Number(center?.lat) || fallback.lat, lng: Number(center?.lng) || fallback.lng }, zoom: Math.max(2, Math.min(18, Number(zoom) || 12)), markers: located }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#09151d}.maplibregl-canvas{filter:brightness(.72) saturate(.82) contrast(1.06)}.maplibregl-ctrl-group{overflow:hidden!important;border:1px solid rgba(164,205,219,.22)!important;border-radius:10px!important;background:rgba(10,25,34,.86)!important;box-shadow:0 8px 22px rgba(0,0,0,.3)!important}.maplibregl-ctrl-group button{width:30px!important;height:30px!important}.maplibregl-ctrl-group button span{filter:invert(1) hue-rotate(145deg) saturate(.55)}.maplibregl-ctrl-attrib{padding:2px 6px!important;border-radius:8px 0 0 0!important;background:rgba(8,20,28,.74)!important;color:#9eb4bd!important;font:9px/1.25 system-ui!important}.maplibregl-ctrl-attrib a{color:#c2d6da!important}.pm-pin{width:17px;height:17px;border:3px solid #f5fbfc;border-radius:50% 50% 50% 0;background:#31b6cf;box-shadow:0 0 0 4px rgba(49,182,207,.2),0 5px 14px rgba(0,0,0,.45);transform:rotate(-45deg)}.pm-pin:after{content:'';position:absolute;inset:4px;border-radius:50%;background:#073745}.maplibregl-popup-content{padding:8px 10px!important;border:1px solid rgba(166,221,230,.2)!important;border-radius:10px!important;background:#0d202a!important;color:#e9f5f7!important;font:11px/1.3 system-ui!important}.maplibregl-popup-tip{border-top-color:#0d202a!important;border-bottom-color:#0d202a!important}</style></head><body><div id="map"></div><script src="/vendor/maplibre/maplibre-gl.js"><\/script><script>const payload=${payload};const map=new maplibregl.Map({container:'map',style:{version:8,sources:{carto:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],tileSize:256,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'}},layers:[{id:'background',type:'background',paint:{'background-color':'#09151d'}},{id:'carto',type:'raster',source:'carto',paint:{'raster-saturation':-.18,'raster-contrast':.08}}]},center:[payload.center.lng,payload.center.lat],zoom:payload.zoom,attributionControl:false});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');map.addControl(new maplibregl.AttributionControl({compact:true}));const popup=(m)=>{const node=document.createElement('div');const title=document.createElement('strong');title.textContent=m.label||'Location';node.append(title);if(m.address){const sub=document.createElement('div');sub.style.opacity='.72';sub.style.marginTop='2px';sub.textContent=m.address;node.append(sub)}return node};map.on('load',()=>{const bounds=new maplibregl.LngLatBounds();payload.markers.forEach((m)=>{bounds.extend([m.lng,m.lat]);const pin=document.createElement('div');pin.className='pm-pin';new maplibregl.Marker({element:pin,anchor:'bottom'}).setLngLat([m.lng,m.lat]).setPopup(new maplibregl.Popup({offset:17,closeButton:false}).setDOMContent(popup(m))).addTo(map)});if(payload.markers.length>1)map.fitBounds(bounds,{padding:36,maxZoom:14,duration:0})});<\/script></body></html>`;
}

function _renderMobileMap(a) {
  if (!a || typeof a !== 'object') return '';
  const markers = Array.isArray(a.markers) ? a.markers : [];
  if (!markers.length) return '';
  const title = String(a.title || '').trim();
  const list = markers.map((m, i) => {
    const name = String(m.label || `Location ${i + 1}`);
    const cat = String(m.category || '').trim();
    const rating = Number.isFinite(Number(m.rating)) ? `★ ${Number(m.rating).toFixed(1)}` : '';
    const addr = String(m.address || '').trim();
    const dirHref = (Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
      ? `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + addr)}`;
    return `<div class="pm-map-marker"><div class="pm-map-num">${i + 1}</div><div><div class="pm-map-top"><strong>${escapeHtml(name)}</strong>${rating ? `<span class="pm-map-rating">${escapeHtml(rating)}</span>` : ''}</div>${(cat || addr) ? `<div class="pm-map-sub">${[escapeHtml(cat), escapeHtml(addr)].filter(Boolean).join(' · ')}</div>` : ''}<a class="pm-map-link" href="${escapeHtml(dirHref)}" target="_blank" rel="noopener noreferrer">Directions ↗</a></div></div>`;
  }).join('');
  return `<div class="pm-map">${title ? `<div class="pm-map-heading">${escapeHtml(title)}</div>` : ''}<div class="pm-map-frame-wrap"><iframe class="pm-map-frame" title="Interactive map" srcdoc="${escapeHtml(_pmRichMapSrcdoc(a.center, markers, a.zoom))}" loading="lazy"></iframe></div><div class="pm-map-markers">${list}</div></div>`;
}

function _renderMobileSources(a) {
  const items = Array.isArray(a?.items) ? a.items.filter(Boolean) : [];
  if (!items.length) return '';
  const title = String(a?.title || '').trim();
  const cards = items.map((it) => {
    const url = String(it.url || '').trim();
    const img = it.imagePath
      ? `/api/canvas/download?path=${encodeURIComponent(String(it.imagePath))}`
      : String(it.imageUrl || '').trim();
    const publisher = String(it.publisher || '').trim();
    const headline = String(it.title || url || 'Source').trim();
    const date = String(it.publishedAt || '').trim();
    const inner = `
      <div class="pm-src-img-wrap${img ? '' : ' pm-src-img-missing'}">${img ? `<img class="pm-src-img" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.closest('.pm-src-img-wrap')?.classList.add('pm-src-img-missing');this.remove()">` : ''}<div class="pm-src-img-placeholder"><span>${escapeHtml(publisher || headline)}</span></div></div>
      <div class="pm-src-body">
        ${publisher ? `<div class="pm-src-publisher">${escapeHtml(publisher)}</div>` : ''}
        <strong class="pm-src-title">${escapeHtml(headline)}</strong>
        ${date ? `<div class="pm-src-date">${escapeHtml(date)}</div>` : ''}
      </div>`;
    return url
      ? `<a class="pm-src-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="pm-src-card">${inner}</div>`;
  }).join('');
  return `<div class="pm-sources">${title ? `<div class="pm-src-heading">${escapeHtml(title)}</div>` : ''}<div class="pm-src-track">${cards}</div></div>`;
}

function _renderMobileMarket(a) {
  const items = Array.isArray(a?.items) ? a.items.filter(Boolean) : [];
  if (!items.length) return '';
  const title = String(a?.title || '').trim();
  const rows = items.map((it) => {
    const up = Number(it.changePct) >= 0;
    const pct = Number.isFinite(Number(it.changePct))
      ? `<span class="pm-mk-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Number(it.changePct)).toFixed(2)}%</span>`
      : '';
    const logo = it.logoUrl ? `<img class="pm-mk-logo" src="${escapeHtml(String(it.logoUrl))}" alt="" loading="lazy">` : '';
    let price = '';
    const n = Number(it.price);
    if (Number.isFinite(n)) {
      const digits = n < 1 ? (n < 0.01 ? 6 : 4) : 2;
      price = `${n.toFixed(digits)} ${escapeHtml(String(it.currency || 'USD'))}`;
    }
    return `<div class="pm-mk-row">
      <div class="pm-mk-id">${logo}<div class="pm-mk-id-text"><strong>${escapeHtml(String(it.symbol || ''))}</strong>${it.name ? `<span>${escapeHtml(String(it.name))}</span>` : ''}</div></div>
      <div class="pm-mk-figures"><div class="pm-mk-price">${price}</div>${pct}</div>
    </div>`;
  }).join('');
  const src = String(a?.source || (items[0] && items[0].source) || 'CoinGecko');
  return `<div class="pm-market">${title ? `<div class="pm-mk-heading">${escapeHtml(title)}</div>` : ''}${rows}<div class="pm-mk-source">${escapeHtml(src)}</div></div>`;
}

function _renderMobileAgentWork(a) {
  if (!a || typeof a !== 'object') return '';
  const greeting = String(a.greeting || '').trim();
  const title = String(a.title || '').trim();
  const summaryRows = Array.isArray(a.summaryRows) ? a.summaryRows : [];
  const priorities = Array.isArray(a.priorities) ? a.priorities : [];
  const teams = Array.isArray(a.teams) ? a.teams : [];
  const activeWork = Array.isArray(a.activeWork) ? a.activeWork : [];
  if (!greeting && !title && !summaryRows.length && !priorities.length && !teams.length && !activeWork.length) return '';
  let out = '';
  if (greeting || title) {
    out += `<div class="pm-agent-work-head">${greeting ? `<strong>${escapeHtml(greeting)}</strong>` : ''}${title ? `<span>${escapeHtml(title)}</span>` : ''}</div>`;
  }
  if (summaryRows.length) {
    out += `<div class="pm-summary-rows">${summaryRows.map(s => `
      <div class="pm-summary-row">
        <span class="pm-icon">${ICONS[s.icon] || ICONS.clipboard}</span>
        <span class="pm-meta"><strong>${escapeHtml(String(s.title || ''))}</strong><span>${escapeHtml(String(s.subtitle || ''))}</span></span>
      </div>`).join('')}</div>`;
  }
  if (priorities.length) {
    out += `<ol class="pm-numbered">${priorities.map((n, i) => {
      const inner = `<span class="pm-num">${i+1}</span><div><strong>${escapeHtml(String(n.title || ''))}</strong><span>${escapeHtml(String(n.subtitle || ''))}</span></div>`;
      if (_awmClickable(n)) {
        return `<li class="pm-aw-item">${_awmHead(n, inner)}${_awmShell()}</li>`;
      }
      return `<li>${inner}</li>`;
    }).join('')}</ol>`;
  }
  if (teams.length) {
    out += `<div class="pm-team-rows">${teams.map(t => `
      <div class="pm-team-row"><span class="pm-team-icon">${escapeHtml(String(t.icon || '🏠'))}</span><div><strong>${escapeHtml(String(t.name || ''))}</strong><span>${escapeHtml(String(t.detail || ''))}</span></div></div>
    `).join('')}</div>`;
  }
  if (activeWork.length) {
    out += `<div class="pm-team-rows">${activeWork.map(w => {
      const body = `<span class="pm-team-icon">⚙️</span><div><strong>${escapeHtml(String(w.title || ''))}</strong><span>${escapeHtml(String(w.progressLabel || w.status || ''))}</span></div>`;
      if (_awmClickable(w)) {
        return `<div class="pm-aw-item">${_awmHead(w, body)}${_awmShell()}</div>`;
      }
      return w.href
        ? `<a class="pm-team-row" href="${escapeHtml(String(w.href))}">${body}</a>`
        : `<div class="pm-team-row">${body}</div>`;
    }).join('')}</div>`;
  }
  return out;
}

// ── Mobile agent_work interactivity (mirrors desktop) ────────────────────────
function _awmClickable(item) {
  return !!(item && typeof item === 'object' && String(item.taskId || '').trim());
}
function _awmHead(item, innerHtml) {
  const taskId = escapeHtml(String(item.taskId || ''));
  return `<div class="pm-team-row pm-aw-head" data-aw-task="${taskId}" onclick="_awmToggle(this)">${innerHtml}<span class="pm-aw-chevron">▾</span></div>`;
}
function _awmShell() {
  return `<div class="pm-aw-detail" hidden></div>`;
}
async function _awmToggle(headEl) {
  try {
    const wrap = headEl.parentElement;
    const detail = wrap && wrap.querySelector('.pm-aw-detail');
    if (!detail) return;
    const taskId = headEl.getAttribute('data-aw-task') || '';
    if (detail.hasAttribute('hidden')) {
      detail.removeAttribute('hidden');
      headEl.classList.add('pm-aw-open');
      if (!detail.getAttribute('data-loaded')) await _awmLoad(taskId, detail);
    } else {
      detail.setAttribute('hidden', '');
      headEl.classList.remove('pm-aw-open');
    }
  } catch (err) { console.warn('[agent_work mobile] toggle failed', err); }
}
async function _awmLoad(taskId, container) {
  container.innerHTML = '<div class="pm-aw-loading">Loading…</div>';
  try {
    const data = await window.api('/api/bg-tasks/' + encodeURIComponent(taskId));
    const task = (data && data.task) ? data.task : (data || {});
    container.setAttribute('data-loaded', '1');
    const status = String(task.status || 'unknown');
    const plan = Array.isArray(task.plan) ? task.plan : [];
    const total = plan.length;
    const step = total ? Math.min((Number(task.currentStepIndex) || 0) + 1, total) : 0;
    const issue = String(task.pauseReason || '').trim();
    const summary = String(task.finalSummary || '').trim();
    const idJson = JSON.stringify(taskId);
    const canResume = ['paused', 'stalled', 'needs_assistance', 'awaiting_user_input', 'failed', 'queued'].includes(status);
    const canPause = status === 'running';
    const acts = [
      canResume ? `<button class="pm-aw-act primary" onclick='_awmAction(${idJson},"resume",this)'>Resume</button>` : '',
      canPause ? `<button class="pm-aw-act" onclick='_awmAction(${idJson},"pause",this)'>Pause</button>` : '',
      status === 'failed' ? `<button class="pm-aw-act" onclick='_awmAction(${idJson},"restart",this)'>Restart</button>` : '',
      `<button class="pm-aw-act danger" onclick='_awmAction(${idJson},"delete",this)'>Delete</button>`,
    ].filter(Boolean).join('');
    container.innerHTML = `
      <div class="pm-aw-meta"><span class="pm-aw-status ${escapeHtml(status)}">${escapeHtml(status)}</span>${total ? `<span class="pm-aw-step">Step ${step}/${total}</span>` : ''}</div>
      ${issue ? `<div class="pm-aw-row"><b>Blocker:</b> ${escapeHtml(issue.slice(0, 300))}</div>` : ''}
      ${summary ? `<div class="pm-aw-row"><b>Summary:</b> ${escapeHtml(summary.slice(0, 400))}</div>` : ''}
      <div class="pm-aw-actions">${acts}</div>
      <div class="pm-aw-msg"><input type="text" class="pm-aw-msg-input" placeholder="Message this task's agent…"><button class="pm-aw-act" onclick='_awmSend(${idJson},this)'>Send</button></div>`;
  } catch (err) {
    container.removeAttribute('data-loaded');
    container.innerHTML = `<div class="pm-aw-loading">Could not load task.</div>`;
  }
}
async function _awmAction(taskId, action, btn) {
  const detail = btn && btn.closest('.pm-aw-detail');
  try {
    if (action === 'delete') {
      if (!confirm('Delete this task?')) return;
      await window.api('/api/bg-tasks/' + encodeURIComponent(taskId), { method: 'DELETE' });
      if (detail) detail.innerHTML = '<div class="pm-aw-loading">Task deleted.</div>';
      return;
    }
    if (btn) btn.disabled = true;
    await window.api('/api/bg-tasks/' + encodeURIComponent(taskId) + '/' + action, { method: 'POST' });
    if (detail) { detail.removeAttribute('data-loaded'); await _awmLoad(taskId, detail); }
  } catch (err) {
    if (btn) btn.disabled = false;
  }
}
async function _awmSend(taskId, el) {
  const detail = el && el.closest('.pm-aw-detail');
  const input = detail ? detail.querySelector('.pm-aw-msg-input') : null;
  const message = input ? String(input.value || '').trim() : '';
  if (!message) return;
  try {
    if (input) input.disabled = true;
    await window.api('/api/bg-tasks/' + encodeURIComponent(taskId) + '/message', { method: 'POST', body: JSON.stringify({ message }) });
    if (detail) { detail.removeAttribute('data-loaded'); await _awmLoad(taskId, detail); }
  } catch (err) {
    if (input) input.disabled = false;
  }
}
if (typeof window !== 'undefined') {
  window._awmToggle = _awmToggle;
  window._awmAction = _awmAction;
  window._awmSend = _awmSend;
}

// ── Prometheus questions (mobile) — mirrors the desktop inline question card ──
const _mobileQuestionDrafts = new Map();

function _normalizeMobileQuestion(input, extra = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const status = extra.status || source.status;
  if (typeof mobileNormalizeQuestionRecord !== 'function') return status ? { ...source, status } : source;
  return mobileNormalizeQuestionRecord(status ? { ...source, status } : source, extra);
}

function _renderMobileQuestionCard(...args) { return _mobileChatRendererInvoke('_renderMobileQuestionCard', args); }

function _mobileQuestionToggleOption(btn, mode) {
  if (!btn) return;
  const setSelected = (el, selected) => {
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  };
  if (mode === 'single_select') {
    // Reclicking the already-selected option deselects it (so the user can
    // clear a single-select answer); otherwise select this one and clear siblings.
    const wasSelected = btn.classList.contains('selected');
    const wrap = btn.parentElement;
    if (wrap) wrap.querySelectorAll('.pm-q-opt.selected').forEach((el) => setSelected(el, false));
    setSelected(btn, !wasSelected);
  } else {
    setSelected(btn, !btn.classList.contains('selected'));
  }
  _mobileQuestionRememberDraft(btn);
}

function _normalizeMobileVoiceWorkgroup(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || value.workgroupId || '').trim();
  if (!id) return null;
  const workers = (Array.isArray(value.workers) ? value.workers : Array.isArray(value.tasks) ? value.tasks : [])
    .map((worker, index) => ({
      taskId: String(worker?.taskId || worker?.id || '').trim(),
      title: String(worker?.title || worker?.name || `Worker ${index + 1}`).trim(),
      prompt: String(worker?.prompt || worker?.task || '').trim(),
      index: Number.isFinite(Number(worker?.index)) ? Number(worker.index) : index,
      status: String(worker?.status || 'queued').trim().toLowerCase() || 'queued',
      kind: worker?.kind === 'primary_chat' ? 'primary_chat' : 'background_task',
      currentStep: String(worker?.currentStep || '').trim(),
      completedSteps: Array.isArray(worker?.completedSteps) ? worker.completedSteps.map((step) => String(step || '').trim()).filter(Boolean) : [],
      finalResult: String(worker?.finalResult || '').trim(),
      updatedAt: Number(worker?.updatedAt || worker?.timestamp || Date.now()) || Date.now(),
      processEntries: (Array.isArray(worker?.processEntries) ? worker.processEntries : [])
        .map((entry) => ({
          t: Number(entry?.t || entry?.timestamp || Date.now()) || Date.now(),
          type: String(entry?.type || 'event').trim() || 'event',
          content: String(entry?.content || entry?.detail || '').trim(),
          detail: String(entry?.detail || '').trim(),
        }))
        .filter((entry) => entry.content)
        .slice(-40),
    }))
    .sort((a, b) => a.index - b.index);
  return {
    id,
    parentSessionId: String(value.parentSessionId || value.sessionId || '').trim(),
    mode: String(value.mode || 'parallel').trim() === 'sequential' ? 'sequential' : 'parallel',
    delivery: String(value.delivery || 'report_each').trim(),
    status: String(value.status || '').trim().toLowerCase() || _mobileVoiceWorkgroupStatus(workers),
    createdAt: Number(value.createdAt || Date.now()) || Date.now(),
    updatedAt: Number(value.updatedAt || Date.now()) || Date.now(),
    workers,
  };
}

function _mobileVoiceWorkgroupStatus(workers) {
  const statuses = (Array.isArray(workers) ? workers : []).map((worker) => String(worker?.status || 'queued').toLowerCase());
  if (!statuses.length) return 'queued';
  if (statuses.every((status) => status === 'complete')) return 'complete';
  if (statuses.every((status) => status === 'failed' || status === 'cancelled')) return 'failed';
  if (statuses.some((status) => status === 'paused' || status === 'awaiting_input' || status === 'needs_assistance')) return 'paused';
  if (statuses.some((status) => status === 'complete' || status === 'failed' || status === 'cancelled')) return 'partially_complete';
  if (statuses.some((status) => status === 'running' || status === 'in_progress' || status === 'working')) return 'running';
  return 'queued';
}

function _mobileWorkerStatusLabel(status) {
  const clean = String(status || 'queued').toLowerCase();
  if (clean === 'in_progress' || clean === 'working') return 'Running';
  if (clean === 'awaiting_input' || clean === 'needs_assistance') return 'Needs input';
  if (clean === 'partially_complete') return 'In progress';
  return clean.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function _renderMobileVoiceWorkgroup(message) {
  const workgroup = _normalizeMobileVoiceWorkgroup(message?.voiceWorkgroup);
  const workers = workgroup?.workers || [];
  if (!workgroup || !workers.length) return '';
  const completeCount = workers.filter((worker) => worker.status === 'complete').length;
  const cards = workers.map((worker, index) => {
    const status = String(worker.status || 'queued').toLowerCase();
    const journal = Array.isArray(worker.processEntries) ? worker.processEntries : [];
    const emptyLabel = worker.kind === 'primary_chat'
      ? 'Live tool activity from this chat will appear here.'
      : (status === 'queued' ? 'Waiting for the worker to start.' : 'Waiting for tool activity.');
    const processLog = journal.length
      ? _pmRenderTaskJournal(journal)
      : `<div class="pm-worker-process-empty">${escapeHtml(emptyLabel)}</div>`;
    return `<article class="pm-worker-card is-${escapeHtml(status)}" data-pm-worker-card data-worker-index="${index}" data-worker-task-id="${escapeHtml(worker.taskId)}" tabindex="0" aria-label="${escapeHtml(`${worker.title}, ${_mobileWorkerStatusLabel(status)}`)}">
      <div class="pm-worker-card-head">
        <span class="pm-worker-status"><span></span>${escapeHtml(worker.kind === 'primary_chat' && ['queued', 'running', 'in_progress', 'working'].includes(status) ? 'In chat' : _mobileWorkerStatusLabel(status))}</span>
        <span class="pm-worker-index">${String(index + 1).padStart(2, '0')}</span>
      </div>
      <strong class="pm-worker-title">${escapeHtml(worker.title || `Worker ${index + 1}`)}</strong>
      <div class="pm-worker-process" data-pm-worker-process>${processLog}</div>
    </article>`;
  }).join('');
  const dots = workers.map((worker, index) => `<button type="button" class="pm-worker-dot${index === 0 ? ' active' : ''}" data-pm-worker-dot="${index}" aria-label="Show worker ${index + 1}"></button>`).join('');
  return `<section class="pm-worker-deck" data-pm-worker-deck="${escapeHtml(workgroup.id)}" aria-label="Voice worker group">
    <div class="pm-worker-deck-head"><strong>${workers.length} worker${workers.length === 1 ? '' : 's'}</strong><span>${completeCount}/${workers.length} complete</span></div>
    <div class="pm-worker-track" data-pm-worker-track>${cards}</div>
    ${workers.length > 1 ? `<div class="pm-worker-pagination" aria-label="Worker carousel position">${dots}</div>` : ''}
  </section>`;
}
function _mobileQuestionToggleOther(btn) {
  const card = btn?.closest?.('[data-pm-q-card]');
  const block = btn?.closest?.('[data-pm-q]');
  const itemId = String(block?.getAttribute('data-pm-q') || '').trim();
  if (!card || !itemId) return;
  card.setAttribute('data-pm-q-compose-target', `${itemId}::other`);
  const otherInput = block.querySelector('[data-pm-q-other]');
  const isOpen = !!otherInput && !otherInput.hidden;
  if (otherInput) {
    otherInput.hidden = isOpen;
    btn.setAttribute('aria-expanded', String(!isOpen));
    btn.classList.toggle('selected', !isOpen);
    btn.setAttribute('aria-pressed', String(!isOpen));
    if (!isOpen) {
      try { otherInput.focus({ preventScroll: true }); } catch { try { otherInput.focus(); } catch {} }
    }
  }
  _mobileQuestionRememberDraft(otherInput || btn);
}

function _clearMobileQuestionValidationToast() {
  try {
    const toast = document.querySelector('#pm-toast-host [data-pm-toast-key="mobile-question-answer-required"]');
    if (!toast) return;
    const host = toast.parentElement;
    toast.remove();
    if (host && !host.childElementCount) {
      host.remove();
      document.querySelector('.pm-toast-priority-active')?.classList.remove('pm-toast-priority-active');
    }
  } catch {}
}

function _mobileQuestionRememberDraft(el) {
  const card = el?.closest?.('[data-pm-q-card]');
  if (!card) return;
  _clearMobileQuestionValidationToast();
  const qid = String(card.getAttribute('data-pm-q-card') || '').trim();
  if (!qid) return;
  const captured = _captureMobileQuestionDraftState(card.parentElement || card);
  if (captured[qid]) _mobileQuestionDrafts.set(qid, captured[qid]);
}

// ChatRuntime.questions is authoritative for question lifecycle state. This is
// the only question-specific write path back into the legacy mobile thread;
// history hydration can seed a runtime record once, but it cannot compete with
// controller transitions after that seed.
function _projectMobileQuestionToLegacy({ sessionId, question, options = {} } = {}) {
  const sid = String(sessionId || question?.sessionId || question?.sourceSessionId || '').trim();
  const qid = String(question?.id || question?.questionId || '').trim();
  if (!sid || !qid) return false;
  if (!__pmChat.threads || typeof __pmChat.threads !== 'object') __pmChat.threads = {};
  const status = String(question?.status || 'pending').trim().toLowerCase() || 'pending';
  const terminal = ['answered', 'cancelled', 'expired', 'resolved'].includes(status);
  if (terminal) {
    __pmChat.resolvedQuestionIds[qid] = true;
    let changed = false;
    Object.entries(__pmChat.threads).forEach(([threadSid, thread]) => {
      if (!Array.isArray(thread)) return;
      let threadChanged = false;
      thread.forEach((message) => {
        if (String(message?.questionRequest?.id || '') !== qid) return;
        delete message.questionRequest;
        changed = true;
        threadChanged = true;
      });
      if (threadChanged && String(__pmChat.activeSessionId || '').trim() === String(threadSid)) {
        _renderMobileChatSessionNow(threadSid);
      }
    });
    return changed;
  }
  if (_mobileQuestionIsResolved(qid)) {
    if (options.allowStatusRegression !== true) return false;
    delete __pmChat.resolvedQuestionIds[qid];
  }
  if (!Array.isArray(__pmChat.threads[sid])) __pmChat.threads[sid] = [];
  const thread = __pmChat.threads[sid];
  const matches = thread.filter((message) => String(message?.questionRequest?.id || '') === qid);
  let changed = false;
  if (matches.length) {
    matches.forEach((message) => {
      message.questionRequest = { ...(message.questionRequest || {}), ...question };
      changed = true;
    });
  } else if (options.create !== false) {
    thread.push({
      role: 'ai',
      timestamp: Date.now(),
      time: _nowTime(),
      body: { sender: 'Prometheus', text: '' },
      content: '',
      questionRequest: question,
    });
    changed = true;
  }
  if (changed && String(__pmChat.activeSessionId || '').trim() === sid) _renderMobileChatSessionNow(sid);
  return changed;
}

// Preserve in-progress answers in pending question cards across the full
// innerHTML rebuild that _renderThread does every streaming tick. Without this,
// a re-render a few seconds after the user taps an option / types wipes their
// selections + typed text + focus, so they can only type one letter at a time
// and Submit ends up sending empty answers. Mirrors the desktop card behavior.
function _captureMobileQuestionDraftState(root) {
  const out = {};
  if (!root) return out;
  try {
    root.querySelectorAll('[data-pm-q-card]').forEach((card) => {
      if (!card.classList || !card.classList.contains('pm-question-card')) return;
      const qid = card.getAttribute('data-pm-q-card');
      if (!qid) return;
      const previous = _mobileQuestionDrafts.get(qid) || {};
      const rawIndex = Number(card.getAttribute('data-pm-q-index'));
      const previousIndex = Number(previous.index);
      const state = {
        index: Number.isFinite(previousIndex) ? previousIndex : (Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : 0),
        selected: { ...(previous.selected || {}) },
        texts: { ...(previous.texts || {}) },
        others: { ...(previous.others || {}) },
        general: String(previous.general || ''),
        composeTarget: card.getAttribute('data-pm-q-compose-target') || previous.composeTarget || '',
        focus: null,
      };
      card.querySelectorAll('[data-pm-q]').forEach((block) => {
        const bid = block.getAttribute('data-pm-q') || '';
        state.selected[bid] = Array.from(block.querySelectorAll('.pm-q-opt.selected'))
          .map((el) => el.getAttribute('data-pm-q-opt') || '').filter(Boolean);
        const textEl = block.querySelector('[data-pm-q-text]');
        if (textEl) state.texts[bid] = textEl.value || '';
        const otherEl = block.querySelector('[data-pm-q-other]');
        if (otherEl) state.others[bid] = {
          value: otherEl.value || '',
          hidden: otherEl.hasAttribute('hidden'),
          open: otherEl.hidden !== true,
        };
      });
      const gen = card.querySelector('[data-pm-q-general]');
      if (gen) state.general = gen.value || '';
      try {
        const active = document.activeElement;
        if (active && card.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          let kind = '', key = '';
          if (active.hasAttribute('data-pm-q-general')) { kind = 'general'; }
          else {
            const block = active.closest('[data-pm-q]');
            key = block ? (block.getAttribute('data-pm-q') || '') : '';
            if (active.hasAttribute('data-pm-q-text')) kind = 'text';
            else if (active.hasAttribute('data-pm-q-other')) kind = 'other';
          }
          if (kind) {
            state.focus = {
              kind,
              key,
              selStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
              selEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
            };
          }
        }
      } catch {}
      out[qid] = state;
      _mobileQuestionDrafts.set(qid, state);
    });
  } catch {}
  return out;
}
function _restoreMobileQuestionDraftState(root, map) {
  if (!root) return;
  try {
    const combined = { ...Object.fromEntries(_mobileQuestionDrafts), ...(map || {}) };
    Object.keys(combined).forEach((qid) => {
      const card = root.querySelector(`[data-pm-q-card="${_pmCssEscape(qid)}"]`);
      if (!card || !card.classList || !card.classList.contains('pm-question-card')) return;
      const state = combined[qid];
      if (Number.isFinite(Number(state.index))) card.setAttribute('data-pm-q-index', String(Math.max(0, Math.floor(Number(state.index)))));
      if (state.composeTarget) card.setAttribute('data-pm-q-compose-target', state.composeTarget);
      Object.entries(state.selected || {}).forEach(([bid, vals]) => {
        const block = card.querySelector(`[data-pm-q="${_pmCssEscape(bid)}"]`);
        if (!block || !Array.isArray(vals) || !vals.length) return;
        const want = new Set(vals);
        block.querySelectorAll('.pm-q-opt').forEach((el) => {
          const selected = want.has(el.getAttribute('data-pm-q-opt') || '');
          el.classList.toggle('selected', selected);
          el.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
      });
      Object.entries(state.texts || {}).forEach(([bid, val]) => {
        const block = card.querySelector(`[data-pm-q="${_pmCssEscape(bid)}"]`);
        const el = block?.querySelector('[data-pm-q-text]');
        if (el) el.value = val;
      });
      Object.entries(state.others || {}).forEach(([bid, info]) => {
        const block = card.querySelector(`[data-pm-q="${_pmCssEscape(bid)}"]`);
        const el = block?.querySelector('[data-pm-q-other]');
        if (el) {
          // Only an explicit interaction in the current draft may reopen the
          // Other field. Do not infer selection from a legacy hidden flag or
          // from a previously captured value.
          const otherOpen = info?.open === true;
          el.value = info.value || '';
          if (otherOpen) el.removeAttribute('hidden');
          else el.setAttribute('hidden', '');
          const otherToggle = block?.querySelector('.pm-q-other-toggle');
          otherToggle?.setAttribute('aria-expanded', String(otherOpen));
          otherToggle?.setAttribute('aria-pressed', String(otherOpen));
          otherToggle?.classList.toggle('selected', otherOpen);
        }
      });
      const gen = card.querySelector('[data-pm-q-general]');
      if (gen) gen.value = state.general || '';
      try {
        if (state.focus && state.focus.kind) {
          let el = null;
          if (state.focus.kind === 'general') {
            el = gen;
          } else {
            const block = card.querySelector(`[data-pm-q="${_pmCssEscape(state.focus.key)}"]`);
            el = state.focus.kind === 'text'
              ? block?.querySelector('[data-pm-q-text]')
              : block?.querySelector('[data-pm-q-other]');
          }
          if (el && !el.hasAttribute('hidden') && document.activeElement !== el) {
            el.focus({ preventScroll: true });
            const len = el.value ? el.value.length : 0;
            const s = state.focus.selStart == null ? len : Math.min(state.focus.selStart, len);
            const e = state.focus.selEnd == null ? len : Math.min(state.focus.selEnd, len);
            if (typeof el.setSelectionRange === 'function') el.setSelectionRange(s, e);
          }
        }
      } catch {}
    });
  } catch {}
}

function _mobileQuestionPayloadFromDraft(q, state) {
  if (!state) return null;
  return {
    answers: q.questions.map((qq) => ({
      id: qq.id,
      label: qq.label,
      mode: qq.mode,
      selected: qq.mode === 'text' ? [] : (Array.isArray(state.selected?.[qq.id]) ? state.selected[qq.id] : []),
      text: String(state.texts?.[qq.id] || '').trim(),
      other: String(state.others?.[qq.id]?.value || '').trim(),
    })),
    generalOther: String(state.general || '').trim(),
  };
}
function _mobileQuestionStepIndex(q, state = _mobileQuestionDrafts.get(String(q?.id || '').trim())) {
  const total = Array.isArray(q?.questions) ? q.questions.length : 0;
  if (!total) return 0;
  const raw = Number(state?.index);
  return Number.isFinite(raw) ? Math.max(0, Math.min(total - 1, Math.floor(raw))) : 0;
}
function _rememberMobileQuestionPayload(q, payload, index) {
  const qid = String(q?.id || '').trim();
  if (!qid || !payload) return null;
  const previous = _mobileQuestionDrafts.get(qid) || {};
  const state = {
    ...previous,
    index: _mobileQuestionStepIndex(q, { index }),
    selected: { ...(previous.selected || {}) },
    texts: { ...(previous.texts || {}) },
    others: { ...(previous.others || {}) },
    general: String(payload.generalOther || '').trim(),
    composeTarget: previous.composeTarget || '',
    focus: previous.focus || null,
  };
  (payload.answers || []).forEach((answer) => {
    const aid = String(answer?.id || '').trim();
    if (!aid) return;
    state.selected[aid] = Array.isArray(answer.selected) ? answer.selected.slice() : [];
    state.texts[aid] = String(answer.text || '');
    state.others[aid] = { ...(state.others[aid] || {}), value: String(answer.other || '') };
  });
  _mobileQuestionDrafts.set(qid, state);
  return state;
}
function _collectMobileQuestionAnswers(q) {
  const card = document.querySelector(`[data-pm-q-card="${(window.CSS && CSS.escape) ? CSS.escape(q.id) : q.id}"]`);
  const saved = _mobileQuestionPayloadFromDraft(q, _mobileQuestionDrafts.get(q.id));
  const savedAnswers = new Map((saved?.answers || []).map((answer) => [String(answer.id || ''), answer]));
  const answers = q.questions.map((qq) => {
    const block = card?.querySelector(`[data-pm-q="${(window.CSS && CSS.escape) ? CSS.escape(qq.id) : qq.id}"]`);
    const previous = savedAnswers.get(String(qq.id));
    if (!block) return previous || { id: qq.id, label: qq.label, mode: qq.mode, selected: [], text: '', other: '' };
    const selected = block ? Array.from(block.querySelectorAll('.pm-q-opt.selected')).map((el) => el.getAttribute('data-pm-q-opt') || '').filter(Boolean) : [];
    const text = block ? String(block.querySelector('[data-pm-q-text]')?.value || '').trim() : '';
    const other = block ? String(block.querySelector('[data-pm-q-other]')?.value || '').trim() : '';
    return { id: qq.id, label: qq.label, mode: qq.mode, selected: qq.mode === 'single_select' ? selected.slice(0, 1) : selected, text, other };
  });
  const generalInput = card?.querySelector('[data-pm-q-general]');
  const generalOther = generalInput ? String(generalInput.value || '').trim() : String(saved?.generalOther || '').trim();
  return { answers, generalOther };
}

function _focusMobileQuestionComposer() {
  try { window.__pmMobileOpenChatComposer?.({ reason: 'question-focus' }); } catch {}
  const card = document.querySelector('[data-pm-q-card]');
  const answer = card?.querySelector('textarea:not([hidden]), input:not([hidden]), .pm-q-opt, .pm-q-other-toggle');
  if (answer) {
    try { answer.focus({ preventScroll: true }); } catch { try { answer.focus(); } catch {} }
    return;
  }
  const input = document.getElementById('pm-composer-input');
  if (!input) return;
  try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
}

async function _submitMobileQuestionFromComposer(text, sessionId = __pmChat.activeSessionId) {
  const clean = String(text || '').trim();
  const sid = String(sessionId || '').trim();
  const staged = sid ? __pmChat.attachments?.[sid] : null;
  if (Array.isArray(staged) && staged.length) return false;
  const question = _getPendingQuestionForSession(sid);
  if (!question) return false;
  const submitted = await _submitMobileQuestion(question.id, { composerText: clean });
  return submitted === true;
}

// Most-recent pending question for a session. The rendered question lives in
// the composer popover so it stays directly above the input while the stream
// re-renders.
function _getPendingQuestionForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  const runtime = mobileChatRuntimeAdapter.runtimeFor(sid);
  const runtimeQuestions = [...(runtime?.snapshot?.questions || [])];
  const runtimeQuestion = runtimeQuestions
    .reverse()
    .find((question) => String(question?.status || 'pending').toLowerCase() === 'pending');
  if (runtimeQuestion) return runtimeQuestion;
  // Before the first runtime hydration, a cached legacy thread may be the only
  // source available to the composer. Once the runtime has any question record
  // or a hydrated history, a legacy copy must never become a competing reader.
  if (runtimeQuestions.length || Number(runtime?.snapshot?.history?.revision || 0) > 0) return null;
  const thread = Array.isArray(__pmChat.threads?.[sid]) ? __pmChat.threads[sid] : [];
  for (let i = thread.length - 1; i >= 0; i--) {
    const q = thread[i]?.questionRequest;
    if (q && String(q.status || 'pending').toLowerCase() === 'pending') return q;
  }
  return null;
}

function _paintMobileQuestionComposerPopover(host, composer, question, currentIndex, draftMap, sessionId) {
  host.innerHTML = _renderMobileQuestionCard({ ...question, currentIndex });
  host.hidden = false;
  host.setAttribute('data-question-id', String(question.id || ''));
  composer?.classList.add('has-pending-question');
  _restoreMobileQuestionDraftState(host, draftMap);
  try { window.__pmMobileQuestionComposerChanged?.(sessionId); } catch {}
}

function _syncMobileQuestionComposerPopover(sessionId = __pmChat.activeSessionId, draftMap = {}) {
  const host = document.getElementById('pm-mobile-question-popover');
  if (!host) return;
  const transitionToken = Number(host.__pmQuestionTransitionToken || 0) + 1;
  host.__pmQuestionTransitionToken = transitionToken;
  const question = _getPendingQuestionForSession(sessionId);
  const composer = document.getElementById('pm-composer');
  const liveDraftMap = host.hidden ? {} : _captureMobileQuestionDraftState(host);
  if (!question) {
    host.classList.remove('pm-q-step-transitioning');
    host.hidden = true;
    host.innerHTML = '';
    host.removeAttribute('data-question-id');
    composer?.classList.remove('has-pending-question');
    try { window.__pmMobileQuestionComposerChanged?.(sessionId); } catch {}
    return;
  }
  document.getElementById('pm-composer-input')?.blur?.();
  const combinedDraftMap = { ...liveDraftMap, ...(draftMap || {}) };
  const currentIndex = _mobileQuestionStepIndex(question, combinedDraftMap[String(question.id || '')]);
  const previousCard = host.querySelector('[data-pm-q-card]');
  const previousIndex = Number(previousCard?.getAttribute('data-pm-q-index'));
  const stepChanged = !host.hidden && previousCard && Number.isFinite(previousIndex) && previousIndex !== currentIndex;
  if (!stepChanged) {
    host.classList.remove('pm-q-step-transitioning');
    _paintMobileQuestionComposerPopover(host, composer, question, currentIndex, combinedDraftMap, sessionId);
    return;
  }
  host.classList.add('pm-q-step-transitioning');
  previousCard.classList.add('pm-q-step-exit');
  window.setTimeout(() => {
    if (host.__pmQuestionTransitionToken !== transitionToken) return;
    _paintMobileQuestionComposerPopover(host, composer, question, currentIndex, combinedDraftMap, sessionId);
    const nextCard = host.querySelector('[data-pm-q-card]');
    nextCard?.classList.add('pm-q-step-enter');
    const reveal = () => nextCard?.classList.add('pm-q-step-enter-active');
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(reveal);
    else window.setTimeout(reveal, 16);
    window.setTimeout(() => {
      if (host.__pmQuestionTransitionToken !== transitionToken) return;
      nextCard?.classList.remove('pm-q-step-enter', 'pm-q-step-enter-active');
      host.classList.remove('pm-q-step-transitioning');
    }, 240);
  }, 110);
}

function _mobileQuestionIsResolved(id) {
  return __pmChat.resolvedQuestionIds?.[String(id || '').trim()] === true;
}
async function _submitMobileQuestion(id, options = {}) {
  await _ensureMobileQuestionController();
  const qid = String(id || '').trim();
  const card = document.querySelector(`[data-pm-q-card="${_pmCssEscape(qid)}"]`);
  const submitButton = card?.querySelector('[data-pm-q-submit]');
  if (submitButton?.disabled) return false;
  const local = mobileQuestionController.findQuestion(qid, options.sessionId);
  if (local?.record) {
    const q = _normalizeMobileQuestion(local.record);
    const currentIndex = _mobileQuestionStepIndex(q);
    submitButton?.setAttribute('aria-busy', 'true');
    if (submitButton) submitButton.disabled = true;
    const result = await mobileQuestionController.submit(qid, {
      ...options,
      readAnswers: () => _collectMobileQuestionAnswers(q),
      readDraftAnswers: () => null,
      stepIndex: currentIndex,
      advanceStep: true,
      onStepAdvance: ({ payload, nextIndex, sessionId }) => {
        const state = _rememberMobileQuestionPayload(q, payload, nextIndex);
        _syncMobileQuestionComposerPopover(sessionId || q.sessionId || __pmChat.activeSessionId, { [qid]: state });
      },
    });
    if (!result.ok && submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
    return result.ok === true;
  }

  const result = await mobileQuestionController.submit(qid, options);
  return result.ok === true;
}
async function _cancelMobileQuestion(id) {
  await _ensureMobileQuestionController();
  const result = await mobileQuestionController.cancel(id);
  return result.ok === true;
}
function _upsertMobileQuestion(q) {
  if (!mobileQuestionController) return false;
  return mobileQuestionController.upsert(q).accepted;
}
function _updateMobileQuestionStatus(event, status) {
  if (!mobileQuestionController) return false;
  return mobileQuestionController.transition(event, status).some((result) => result.accepted);
}
if (typeof window !== 'undefined' && !window.__pmMobileQuestionBridgeInstalled) {
  window.__pmMobileQuestionBridgeInstalled = true;
  window._mobileQuestionToggleOption = _mobileQuestionToggleOption;
  window._mobileQuestionToggleOther = _mobileQuestionToggleOther;
  window._mobileQuestionRememberDraft = _mobileQuestionRememberDraft;
  window._submitMobileQuestion = _submitMobileQuestion;
  window._cancelMobileQuestion = _cancelMobileQuestion;
  wsEventBus.on('question_created', async (msg = {}) => {
    await _ensureMobileQuestionController();
    const q = _normalizeMobileQuestion(msg.question || {}, { ...msg, status: 'pending' });
    if (q.id && q.sessionId) _upsertMobileQuestion(q);
  });
  wsEventBus.on('question_answered', async (msg = {}) => {
    await _ensureMobileQuestionController();
    _updateMobileQuestionStatus(msg, 'answered');
  });
  wsEventBus.on('question_cancelled', async (msg = {}) => {
    await _ensureMobileQuestionController();
    _updateMobileQuestionStatus(msg, 'cancelled');
  });
  wsEventBus.on('question_expired', async (msg = {}) => {
    await _ensureMobileQuestionController();
    _updateMobileQuestionStatus(msg, 'expired');
  });
}


function _renderMobileRealtimeVoiceAssistantText(m) {
  if (!m || m.role !== 'ai' || m.source !== 'voice_agent_realtime' || !m.voiceRealtimeActive) return '';
  const clean = String(m.body?.text || m.content || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return `<div class="pm-voice-chat-transcript">${escapeHtml(clean)}</div>`;
}

function _mobileVoiceLyricLines(text = '', wordsPerLine = 7) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  for (let i = 0; i < words.length; i += wordsPerLine) lines.push(words.slice(i, i + wordsPerLine));
  return { words, lines };
}

function _renderMobileVoiceLyrics(text = '', progress = 0, options = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const wordsPerLine = options.compact ? 7 : 4;
  const { words, lines } = _mobileVoiceLyricLines(clean, wordsPerLine);
  const weights = words.map((word) => {
    const cleanWord = String(word || '').replace(/[^\p{L}\p{N}']/gu, '');
    const syllableLike = Math.max(1, (cleanWord.match(/[aeiouy]+/gi) || []).length);
    const punctuationPause = /[.!?]$/.test(word) ? 1.8 : /[,;:]$/.test(word) ? .75 : 0;
    return Math.max(.7, Math.min(2.6, .42 + (cleanWord.length * .065) + (syllableLike * .28) + punctuationPause));
  });
  const totalWeight = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0));
  const progressWeight = safeProgress * totalWeight;
  let activeWordIndex = Math.max(0, words.length - 1);
  let traversedWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    traversedWeight += weights[index];
    if (progressWeight < traversedWeight) {
      activeWordIndex = index;
      break;
    }
  }
  const activeLineIndex = Math.min(Math.max(0, lines.length - 1), Math.floor(activeWordIndex / wordsPerLine));
  const startLine = Math.max(0, Math.min(Math.max(0, lines.length - 3), activeLineIndex - 1));
  const visible = lines.slice(startLine, startLine + 3);
  const html = visible.map((line, visibleIndex) => {
    const lineIndex = startLine + visibleIndex;
    const lineStart = lineIndex * wordsPerLine;
    const wordHtml = line.map((word, index) => {
      const absoluteIndex = lineStart + index;
      const state = absoluteIndex < activeWordIndex ? 'spoken' : absoluteIndex === activeWordIndex ? 'active' : 'pending';
      return `<span class="pm-voice-lyric-word pm-voice-lyric-word--${state}">${escapeHtml(word)}</span>`;
    }).join(' ');
    const lineState = lineIndex < activeLineIndex ? 'past' : lineIndex === activeLineIndex ? 'current' : 'future';
    return `<div class="pm-voice-lyric-line pm-voice-lyric-line--${lineState}">${wordHtml}</div>`;
  }).join('');
  return `<div class="pm-voice-chat-lyrics${options.standalone ? ' pm-voice-page-lyrics' : ''}">${html}</div>`;
}

// Rich-message construction and attachment/transcript rendering are loaded
// with the Chat route. Keeping this owner dynamic removes their implementation
// from the mobile route static closure without changing render order.
let mobileChatRendererRuntime = null;
let mobileChatRendererRuntimePromise = null;

function _mobileChatRendererGlobal() {
  if (mobileChatRendererRuntime) return mobileChatRendererRuntime;
  try {
    if (window.__pmMobileChatRendererRuntime) return window.__pmMobileChatRendererRuntime;
  } catch {}
  return null;
}

function _mobileChatRendererInvoke(name, args = []) {
  const runtime = _mobileChatRendererGlobal();
  const method = runtime && typeof runtime[name] === "function" ? runtime[name] : null;
  if (method) return method(...args);
  void loadMobileChatRendererRuntime().catch(() => {});
  return undefined;
}

function _renderChatMessageHtml(...args) { return _mobileChatRendererInvoke('_renderChatMessageHtml', args); }
function _renderMobileGoalCompletionReport(...args) { return _mobileChatRendererInvoke('_renderMobileGoalCompletionReport', args); }
function _collectMediaFromToolEvent(...args) { return _mobileChatRendererInvoke('_collectMediaFromToolEvent', args); }
function _renderChatAttachmentPreviews(...args) { return _mobileChatRendererInvoke('_renderChatAttachmentPreviews', args); }
function _formatBytes(...args) { return _mobileChatRendererInvoke('_formatBytes', args); }
function _normalizeMobileFile(...args) { return _mobileChatRendererInvoke('_normalizeMobileFile', args); }
function _uploadMobileChatAttachments(...args) { return _mobileChatRendererInvoke('_uploadMobileChatAttachments', args); }
function _buildMobileFileContextNote(...args) { return _mobileChatRendererInvoke('_buildMobileFileContextNote', args); }
function _getMobileEmptyChatStarterCards(...args) { return _mobileChatRendererInvoke('_getMobileEmptyChatStarterCards', args); }
function _loadMobileEmptyChatBrainCards(...args) { return _mobileChatRendererInvoke('_loadMobileEmptyChatBrainCards', args); }
function _commitMobileTranscriptCache(...args) { return _mobileChatRendererInvoke('_commitMobileTranscriptCache', args); }
function _findMobileVoiceWorkgroupMessage(...args) { return _mobileChatRendererInvoke('_findMobileVoiceWorkgroupMessage', args); }
function _appendMobilePrimaryWorkerProcess(...args) { return _mobileChatRendererInvoke('_appendMobilePrimaryWorkerProcess', args); }
function _upsertMobileVoiceWorkgroup(...args) { return _mobileChatRendererInvoke('_upsertMobileVoiceWorkgroup', args); }
function _mobileBackgroundSpawnIsVoiceWorker(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnIsVoiceWorker', args); }
function _restoreMobileVoiceWorkgroupsForSession(...args) { return _mobileChatRendererInvoke('_restoreMobileVoiceWorkgroupsForSession', args); }
function _updateMobilePrimaryWorkgroupLink(...args) { return _mobileChatRendererInvoke('_updateMobilePrimaryWorkgroupLink', args); }
function _renderThread(...args) { return _mobileChatRendererInvoke('_renderThread', args); }
function _captureMobileTraceDetailsState(...args) { return _mobileChatRendererInvoke('_captureMobileTraceDetailsState', args); }
function _restoreMobileTraceDetailsState(...args) { return _mobileChatRendererInvoke('_restoreMobileTraceDetailsState', args); }
function _mobileSideThreadNearBottom(...args) { return _mobileChatRendererInvoke('_mobileSideThreadNearBottom', args); }
function _reconcileMobileBackgroundAgentSideThread(...args) { return _mobileChatRendererInvoke('_reconcileMobileBackgroundAgentSideThread', args); }
function _patchMobileThreadMessage(...args) { return _mobileChatRendererInvoke('_patchMobileThreadMessage', args); }
function _patchLatestMobileStreamingMessage(...args) { return _mobileChatRendererInvoke('_patchLatestMobileStreamingMessage', args); }
function _scheduleMobileStreamingPatch(...args) { return _mobileChatRendererInvoke('_scheduleMobileStreamingPatch', args); }
function _syncMobileWorkTimer(...args) { return _mobileChatRendererInvoke('_syncMobileWorkTimer', args); }
function _installMobileTimestampReveal(...args) { return _mobileChatRendererInvoke('_installMobileTimestampReveal', args); }
function _mobileChatScrollTarget(...args) { return _mobileChatRendererInvoke('_mobileChatScrollTarget', args); }
function _mobileChatScrollSnapshot(...args) { return _mobileChatRendererInvoke('_mobileChatScrollSnapshot', args); }
function _restoreMobileChatScroll(...args) { return _mobileChatRendererInvoke('_restoreMobileChatScroll', args); }
function _scheduleThreadRender(...args) { return _mobileChatRendererInvoke('_scheduleThreadRender', args); }
function _flushThreadRender(...args) { return _mobileChatRendererInvoke('_flushThreadRender', args); }
function _renderMobileChatSessionNow(...args) { return _mobileChatRendererInvoke('_renderMobileChatSessionNow', args); }
function _clearMobileBackgroundSpawnDockForSession(...args) { return _mobileChatRendererInvoke('_clearMobileBackgroundSpawnDockForSession', args); }
function _collectMobileBackgroundFileChangeGroups(...args) { return _mobileChatRendererInvoke('_collectMobileBackgroundFileChangeGroups', args); }
function _mergeMobileFileChangesWithBackground(...args) { return _mobileChatRendererInvoke('_mergeMobileFileChangesWithBackground', args); }
function _mergeMobileLatestAssistantBackgroundFileChanges(...args) { return _mobileChatRendererInvoke('_mergeMobileLatestAssistantBackgroundFileChanges', args); }
function _pushMobileStreamProcessEntry(...args) { return _mobileChatRendererInvoke('_pushMobileStreamProcessEntry', args); }
function _moveMobileAgentVisibleAnswerIntoWorkflowTrace(...args) { return _mobileChatRendererInvoke('_moveMobileAgentVisibleAnswerIntoWorkflowTrace', args); }
function _applyMobileAgentStreamEvent(...args) { return _mobileChatRendererInvoke('_applyMobileAgentStreamEvent', args); }

function _mobileAgentMessageAttachments(...args) { return _mobileChatRendererInvoke('_mobileAgentMessageAttachments', args); }
function _mobileAgentMessageFiles(...args) { return _mobileChatRendererInvoke('_mobileAgentMessageFiles', args); }
function _mobileAgentMessageFileChanges(...args) { return _mobileChatRendererInvoke('_mobileAgentMessageFileChanges', args); }
function _mobileAgentTurnPresentation(...args) { return _mobileChatRendererInvoke('_mobileAgentTurnPresentation', args); }
function _voiceMessageMeta(...args) { return _mobileChatRendererInvoke('_voiceMessageMeta', args); }
function _normalizeCollapsedAgentMarkdown(...args) { return _mobileChatRendererInvoke('_normalizeCollapsedAgentMarkdown', args); }
function _renderMobileAgentChatBubble(...args) { return _mobileChatRendererInvoke('_renderMobileAgentChatBubble', args); }
function _mobileMainPlanState(...args) { return _mobileChatRendererInvoke('_mobileMainPlanState', args); }
function _applyMobileMainPlanProgress(...args) { return _mobileChatRendererInvoke('_applyMobileMainPlanProgress', args); }
function _setMobileToolProgress(...args) { return _mobileChatRendererInvoke('_setMobileToolProgress', args); }
function _clearMobileToolProgress(...args) { return _mobileChatRendererInvoke('_clearMobileToolProgress', args); }
function _renderMobileToolProgressDock(...args) { return _mobileChatRendererInvoke('_renderMobileToolProgressDock', args); }
function _syncMobileRuntimePillPair(...args) { return _mobileChatRendererInvoke('_syncMobileRuntimePillPair', args); }
function _renderMobileMainPlanDock(...args) { return _mobileChatRendererInvoke('_renderMobileMainPlanDock', args); }
function _mobileBackgroundSpawnLanes(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnLanes', args); }
function _mobileBackgroundSpawnDockOpen(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnDockOpen', args); }
function _setMobileBackgroundSpawnDockOpen(...args) { return _mobileChatRendererInvoke('_setMobileBackgroundSpawnDockOpen', args); }
function _mobileBackgroundSpawnClearedIds(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnClearedIds', args); }
function _mobileBackgroundSpawnId(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnId', args); }
function _hydrateMobileBackgroundSpawnLane(...args) { return _mobileChatRendererInvoke('hydrateBackgroundLane', args); }
function _mobileBackgroundSpawnPromptFromMessage(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnPromptFromMessage', args); }
function _mobileParseBackgroundStatus(...args) { return _mobileChatRendererInvoke('_mobileParseBackgroundStatus', args); }
function _collectMobileBackgroundSpawnRecoveries(...args) { return _mobileChatRendererInvoke('_collectMobileBackgroundSpawnRecoveries', args); }
function _linkMobilePendingApprovalsToBackgroundLanes(...args) { return _mobileChatRendererInvoke('_linkMobilePendingApprovalsToBackgroundLanes', args); }
function _applyMobileBackgroundSpawnStatus(...args) { return _mobileChatRendererInvoke('_applyMobileBackgroundSpawnStatus', args); }
function _recoverMobileBackgroundSpawnDock(...args) { return _mobileChatRendererInvoke('_recoverMobileBackgroundSpawnDock', args); }
function _mobileBackgroundSpawnMatchesSession(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnMatchesSession', args); }
function _upsertMobileBackgroundSpawnLane(...args) { return _mobileChatRendererInvoke('_upsertMobileBackgroundSpawnLane', args); }
function _mobileBackgroundSpawnWorkRecord(...args) { return _mobileChatRendererInvoke('_mobileBackgroundSpawnWorkRecord', args); }
function _normalizeMobileBackgroundSpawnEvent(...args) { return _mobileChatRendererInvoke('_normalizeMobileBackgroundSpawnEvent', args); }
function _extractMobileBackgroundPlanSteps(...args) { return _mobileChatRendererInvoke('_extractMobileBackgroundPlanSteps', args); }
function _updateMobileBackgroundSpawnPlan(...args) { return _mobileChatRendererInvoke('_updateMobileBackgroundSpawnPlan', args); }
function _renderMobileBackgroundSpawnPlan(...args) { return _mobileChatRendererInvoke('_renderMobileBackgroundSpawnPlan', args); }
function _renderMobileBackgroundSpawnPrompt(...args) { return _mobileChatRendererInvoke('_renderMobileBackgroundSpawnPrompt', args); }
function _renderMobileBackgroundSpawnFinal(...args) { return _mobileChatRendererInvoke('_renderMobileBackgroundSpawnFinal', args); }
function _renderMobileBackgroundSpawnPanel(...args) { return _mobileChatRendererInvoke('_renderMobileBackgroundSpawnPanel', args); }
function _pushMobileBackgroundSpawnEvent(...args) { return _mobileChatRendererInvoke('_pushMobileBackgroundSpawnEvent', args); }
function _completeMobileBackgroundSpawnLane(...args) { return _mobileChatRendererInvoke('_completeMobileBackgroundSpawnLane', args); }
function _reconcileMobileBackgroundSpawnDockMarkup(...args) { return _mobileChatRendererInvoke('_reconcileMobileBackgroundSpawnDockMarkup', args); }
function _renderMobileBackgroundSpawnDock(...args) { return _mobileChatRendererInvoke('_renderMobileBackgroundSpawnDock', args); }

const mobileChatRendererContext = Object.freeze(Object.defineProperties({}, {
  "ICONS": { enumerable: true, get: () => ICONS },
  "MOBILE_CHAT_SESSION_ID": { enumerable: true, get: () => MOBILE_CHAT_SESSION_ID },
  "PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE": { enumerable: true, get: () => PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE },
  "__pmChat": { enumerable: true, get: () => __pmChat },
  "__pmVoice": { enumerable: true, get: () => __pmVoice },
  "_activeMobileThread": { enumerable: true, get: () => _activeMobileThread },
  "_captureMobileApprovalDetailsState": { enumerable: true, get: () => _captureMobileApprovalDetailsState },
  "_captureMobileQuestionDraftState": { enumerable: true, get: () => _captureMobileQuestionDraftState },
  "_captureMobileWorkerDeckViewState": { enumerable: true, get: () => _captureMobileWorkerDeckViewState },
  "_collectMessageMedia": { enumerable: true, get: () => _collectMessageMedia },
  "_formatMobileGoalElapsed": { enumerable: true, get: () => _formatMobileGoalElapsed },
  "_formatMobileWorkDuration": { enumerable: true, get: () => _formatMobileWorkDuration },
  "_getPendingApprovalsForSession": { enumerable: true, get: () => _getPendingApprovalsForSession },
  "_isMobileAssistantMessage": { enumerable: true, get: () => _isMobileAssistantMessage },
  "_isMobileExplicitMediaToolName": { enumerable: true, get: () => _isMobileExplicitMediaToolName },
  "_isMobileGenerateImageToolName": { enumerable: true, get: () => _isMobileGenerateImageToolName },
  "_isMobileGenerateVideoToolName": { enumerable: true, get: () => _isMobileGenerateVideoToolName },
  "_isMobileVoiceAgentWorkerHandoff": { enumerable: true, get: () => _isMobileVoiceAgentWorkerHandoff },
  "_isMobileVoiceTraceTurn": { enumerable: true, get: () => _isMobileVoiceTraceTurn },
  "_mergeMobileMediaIntoMessage": { enumerable: true, get: () => _mergeMobileMediaIntoMessage },
  "_mergeMobileProductCarouselIntoMessage": { enumerable: true, get: () => _mergeMobileProductCarouselIntoMessage },
  "_mobileAssistantWorkStartedAt": { enumerable: true, get: () => _mobileAssistantWorkStartedAt },
  "_mobileFileExt": { enumerable: true, get: () => _mobileFileExt },
  "_mobileTimelineEntries": { enumerable: true, get: () => _mobileTimelineEntries },
  "_mobileToolEventName": { enumerable: true, get: () => _mobileToolEventName },
  "_mobileVoiceWorkgroupStatus": { enumerable: true, get: () => _mobileVoiceWorkgroupStatus },
  "_mobileWorkflowTraceEntriesForMessage": { enumerable: true, get: () => _mobileWorkflowTraceEntriesForMessage },
  "_normalizeMobileQuestion": { enumerable: true, get: () => _normalizeMobileQuestion },
  "_normalizeMobileMedia": { enumerable: true, get: () => _normalizeMobileMedia },
  "_normalizeMobileMediaList": { enumerable: true, get: () => _normalizeMobileMediaList },
  "_normalizeMobileVoiceWorkgroup": { enumerable: true, get: () => _normalizeMobileVoiceWorkgroup },
  "_nowTime": { enumerable: true, get: () => _nowTime },
  "_pmCssEscape": { enumerable: true, get: () => _pmCssEscape },
  "_reconcileMobileThreadOrder": { enumerable: true, get: () => _reconcileMobileThreadOrder },
  "_renderBrowseCard": { enumerable: true, get: () => _renderBrowseCard },
  "_renderMobileApprovalCard": { enumerable: true, get: () => _renderMobileApprovalCard },
  "_renderMobileApprovalSheet": { enumerable: true, get: () => _renderMobileApprovalSheet },
  "_renderMobileChatErrorPresentation": { enumerable: true, get: () => _renderMobileChatErrorPresentation },
  "_renderMobileFileChanges": { enumerable: true, get: () => _renderMobileFileChanges },
  "_renderMobileGeneratedImageLoadingCard": { enumerable: true, get: () => _renderMobileGeneratedImageLoadingCard },
  "_dedupeMobileTraceProseText": { enumerable: true, get: () => _dedupeMobileTraceProseText },
  "_isMobileBareThinkingTraceText": { enumerable: true, get: () => _isMobileBareThinkingTraceText },
  "_isMobileImageGenerationStreamEntry": { enumerable: true, get: () => _isMobileImageGenerationStreamEntry },
  "_isMobileTraceReasoningSummaryType": { enumerable: true, get: () => _isMobileTraceReasoningSummaryType },
  "_isMobileTraceThoughtFragmentText": { enumerable: true, get: () => _isMobileTraceThoughtFragmentText },
  "_isMobileTraceThoughtType": { enumerable: true, get: () => _isMobileTraceThoughtType },
  "_isMobileUserVisibleReasoningTraceEntry": { enumerable: true, get: () => _isMobileUserVisibleReasoningTraceEntry },
  "_isMobileVisionInjectionStatusText": { enumerable: true, get: () => _isMobileVisionInjectionStatusText },
  "_mobileTraceComparableText": { enumerable: true, get: () => _mobileTraceComparableText },
  "_mobileTraceJsonPayload": { enumerable: true, get: () => _mobileTraceJsonPayload },
  "_mobileTraceThoughtTextsSimilar": { enumerable: true, get: () => _mobileTraceThoughtTextsSimilar },
  "_renderMobileLiveTracePreview": { enumerable: true, get: () => _renderMobileLiveTracePreview },
  "_renderMobileMarkdown": { enumerable: true, get: () => _renderMobileMarkdown },
  "_renderMobileMediaGallery": { enumerable: true, get: () => _renderMobileMediaGallery },
  "_renderMobileMessageActions": { enumerable: true, get: () => _renderMobileMessageActions },
  "_renderMobileProductCarousel": { enumerable: true, get: () => _renderMobileProductCarousel },
  "_renderMobileRichArtifacts": { enumerable: true, get: () => _renderMobileRichArtifacts },
  "_renderMobileSkillReferencedMarkdown": { enumerable: true, get: () => _renderMobileSkillReferencedMarkdown },
  "_renderMobileThreadLinkArtifacts": { enumerable: true, get: () => _renderMobileThreadLinkArtifacts },
  "_renderMobileUserEditComposer": { enumerable: true, get: () => _renderMobileUserEditComposer },
  "_renderMobileVoiceWorkgroup": { enumerable: true, get: () => _renderMobileVoiceWorkgroup },
  "_renderMobileWorkTimer": { enumerable: true, get: () => _renderMobileWorkTimer },
  "_resolveMobileApprovalButton": { enumerable: true, get: () => _resolveMobileApprovalButton },
  "_wireMobileApprovalActionButton": { enumerable: true, get: () => _wireMobileApprovalActionButton },
  "_restoreMobileApprovalDetailsState": { enumerable: true, get: () => _restoreMobileApprovalDetailsState },
  "_restoreMobileQuestionDraftState": { enumerable: true, get: () => _restoreMobileQuestionDraftState },
  "_safeJsonPreview": { enumerable: true, get: () => _safeJsonPreview },
  "_scheduleMobileThreadCacheSave": { enumerable: true, get: () => _scheduleMobileThreadCacheSave },
  "_syncMobileQuestionComposerPopover": { enumerable: true, get: () => _syncMobileQuestionComposerPopover },
  "_wireMobileChatEnhancements": { enumerable: true, get: () => _wireMobileChatEnhancements },
  "_wireMobileProcessRunActions": { enumerable: true, get: () => _wireMobileProcessRunActions },
  "captureKeyedScrollState": { enumerable: true, get: () => captureKeyedScrollState },
  "chatTimelineRowSignature": { enumerable: true, get: () => chatTimelineRowSignature },
  "escapeHtml": { enumerable: true, get: () => escapeHtml },
  "loadBgTaskDetail": { enumerable: true, get: () => loadBgTaskDetail },
  "mobileChatRuntimeAdapter": { enumerable: true, get: () => mobileChatRuntimeAdapter },
  "loadMobileChatSession": { enumerable: true, get: () => loadMobileChatSession },
  "mobileGatewayFetch": { enumerable: true, get: () => mobileGatewayFetch },
  "markMobileLifecycle": { enumerable: true, get: () => markMobileLifecycle },
  "mobileStreamRenderScheduler": { enumerable: true, get: () => mobileStreamRenderScheduler },
  "mobileTimelineController": { enumerable: true, get: () => mobileTimelineController },
  "pmHaptic": { enumerable: true, get: () => pmHaptic },
  "pmToast": { enumerable: true, get: () => pmToast },
  "reconcileKeyedTimelineRows": { enumerable: true, get: () => reconcileKeyedTimelineRows },
  "setInnerHTMLPreservingVisuals": { enumerable: true, get: () => setInnerHTMLPreservingVisuals },
  "uploadMobileBinaryFile": { enumerable: true, get: () => uploadMobileBinaryFile },
  "uploadMobileTextFile": { enumerable: true, get: () => uploadMobileTextFile },
  "wsEventBus": { enumerable: true, get: () => wsEventBus },
  "__pmRealtimeAgent": { enumerable: true, get: () => __pmRealtimeAgent },
  "_appendMobileProcess": { enumerable: true, get: () => _appendMobileProcess },
  "_formatTimeAgo": { enumerable: true, get: () => _formatTimeAgo },
  "_getMobileGoalForSession": { enumerable: true, get: () => _getMobileGoalForSession },
  "_linkMobileApprovalToBackgroundLane": { enumerable: true, get: () => _linkMobileApprovalToBackgroundLane },
  "_mobileApprovalVisibleSessionId": { enumerable: true, get: () => _mobileApprovalVisibleSessionId },
  "_mobileBackgroundSpawnIdFromSessionId": { enumerable: true, get: () => _mobileBackgroundSpawnIdFromSessionId },
  "_mobileBackgroundStoredProcessEntries": { enumerable: true, get: () => _mobileBackgroundStoredProcessEntries },
  "_mobileGoalStepStatus": { enumerable: true, get: () => _mobileGoalStepStatus },
  "_normalizeMobileApproval": { enumerable: true, get: () => _normalizeMobileApproval },
  "_pmApprovalTitle": { enumerable: true, get: () => _pmApprovalTitle },
  "_renderMobileGoalPill": { enumerable: true, get: () => _renderMobileGoalPill },
  "_renderMobileProcess": { enumerable: true, get: () => _renderMobileProcess },
  "_renderMobileSourceList": { enumerable: true, get: () => _renderMobileSourceList },
  "_updateMobilePendingApproval": { enumerable: true, get: () => _updateMobilePendingApproval },
  "_upsertMobilePendingApproval": { enumerable: true, get: () => _upsertMobilePendingApproval },
  "findBackgroundAgentWork": { enumerable: true, get: () => findBackgroundAgentWork },
  "loadMobileBackgroundStatus": { enumerable: true, get: () => loadMobileBackgroundStatus },
  "mobileSourceState": { enumerable: true, get: () => mobileSourceState },
  "persistBackgroundAgentWork": { enumerable: true, get: () => persistBackgroundAgentWork },
  "resolveBackgroundAgentIdentity": { enumerable: true, get: () => resolveBackgroundAgentIdentity },
  "_appendMobileCompactionTrace": { enumerable: true, get: () => _appendMobileCompactionTrace },
  "_appendMobileVisionTrace": { enumerable: true, get: () => _appendMobileVisionTrace },
  "_applyMobileToolActivity": { enumerable: true, get: () => _applyMobileToolActivity },
  "_handleMobileCleanThought": { enumerable: true, get: () => _handleMobileCleanThought },
  "_handleMobileReasoningSummaryDelta": { enumerable: true, get: () => _handleMobileReasoningSummaryDelta },
  "_handleMobileThinkingDelta": { enumerable: true, get: () => _handleMobileThinkingDelta },
  "_maybeFlushMobileThinkingBeforeEvent": { enumerable: true, get: () => _maybeFlushMobileThinkingBeforeEvent },
  "_mergeMobileRichArtifacts": { enumerable: true, get: () => _mergeMobileRichArtifacts },
  "_refreshMobileSourcesForSession": { enumerable: true, get: () => _refreshMobileSourcesForSession },
  "appendFinalResponseDelta": { enumerable: true, get: () => appendFinalResponseDelta },
  "beginFinalResponse": { enumerable: true, get: () => beginFinalResponse },
  "reconcileFinalResponse": { enumerable: true, get: () => reconcileFinalResponse },
  "_appendMobileLiveTrace": { enumerable: true, get: () => _appendMobileLiveTrace },
  "_isMobileProgressNarration": { enumerable: true, get: () => _isMobileProgressNarration },
  "_setMobileLiveProgressNarration": { enumerable: true, get: () => _setMobileLiveProgressNarration },
  "_normalizeMobileFileChanges": { enumerable: true, get: () => _normalizeMobileFileChanges },
}));

function loadMobileChatRendererRuntime() {
  const existing = _mobileChatRendererGlobal();
  if (existing) {
    mobileChatRendererRuntime = existing;
    return Promise.resolve(existing);
  }
  if (!mobileChatRendererRuntimePromise) {
    mobileChatRendererRuntimePromise = import('./mobile-chat-renderer-runtime.js')
      .then(({ createMobileChatRendererRuntime }) => {
        mobileChatRendererRuntime = createMobileChatRendererRuntime(mobileChatRendererContext);
        markMobileLifecycle('chatRuntimeHydrated');
        return mobileChatRendererRuntime;
      })
      .catch((error) => {
        mobileChatRendererRuntimePromise = null;
        throw error;
      });
  }
  return mobileChatRendererRuntimePromise;
}

const mobileSourceState = {
  sessionId: '',
  history: false,
  resources: [],
  loading: false,
  requestToken: 0,
};

function _mobileSourceLocator(resource) {
  const locator = resource?.locator || {};
  return String(locator.url || locator.path || locator.artifactId || locator.taskId || '').trim();
}

function _renderMobileSourceList(root = document) {
  const list = root?.querySelector?.('#pm-mobile-sources-list');
  const count = root?.querySelector?.('#pm-mobile-sources-count');
  const mode = root?.querySelector?.('#pm-mobile-sources-mode');
  if (!list) return;
  const resources = Array.isArray(mobileSourceState.resources) ? mobileSourceState.resources : [];
  const isSubagentChat = String(mobileSourceState.sessionId || '').startsWith('subagent_chat_');
  const linkedWork = !mobileSourceState.history && !isSubagentChat
    ? backgroundAgentWorkForSession(mobileSourceState.sessionId || __pmChat.activeSessionId)
    : [];
  if (count) count.textContent = resources.length ? String(resources.length) : '';
  if (mode) mode.textContent = mobileSourceState.history
    ? 'Browser history'
    : (isSubagentChat ? 'Subagent chat sources' : 'Attached to this chat');
  if (!resources.length && !linkedWork.length) {
    list.innerHTML = `<div style="padding:20px 8px;text-align:center;color:var(--pm-muted,#89909d);font-size:12px">${mobileSourceState.history ? 'No Browser history yet.' : (isSubagentChat ? 'No sources from this subagent yet.' : 'No Sources attached yet.')}</div>`;
    return;
  }
  const workMarkup = linkedWork.length
    ? `<div class="pm-mobile-sources-section-label">Linked work</div>${linkedWork.slice(0, 8).map((record) => {
      const id = String(record?.id || '');
      const color = String(record?.agentColor || '#1677d2');
      const preview = backgroundAgentPreview(record?.result || record?.error || record?.task || 'Background work', 150);
      return `<button type="button" class="pm-mobile-source-row pm-mobile-source-row--work" data-mobile-background-work="${escapeHtml(id)}" aria-label="Open ${escapeHtml(record?.agentName || 'Background agent')} background work">
        <span class="pm-mobile-source-copy"><strong><span class="pm-mobile-source-agent-name" style="color:${escapeHtml(color)}">${escapeHtml(record?.agentName || 'Background agent')}</span><time class="pm-mobile-source-age">${escapeHtml(backgroundAgentAgeLabel(record?.completedAt || record?.updatedAt))}</time></strong><small>${escapeHtml(preview)}</small></span>
        <span class="pm-mobile-source-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('')}`
    : '';
  const resourceMarkup = resources.map((resource) => {
    const id = String(resource?.id || '');
    const locator = _mobileSourceLocator(resource);
    const action = mobileSourceState.history
      ? `<button type="button" data-mobile-source-attach="${escapeHtml(id)}" class="pm-mobile-source-action">Attach</button>`
      : `<button type="button" data-mobile-source-detach="${escapeHtml(id)}" class="pm-mobile-source-action pm-mobile-source-muted">Detach</button>`;
    return `<div class="pm-mobile-source-row"><div class="pm-mobile-source-copy"><strong>${escapeHtml(resource?.title || resource?.kind || 'Source')}</strong><small>${escapeHtml([resource?.kind, resource?.hasContent ? 'saved' : 'metadata', locator].filter(Boolean).join(' · '))}</small></div>${action}</div>`;
  }).join('');
  list.innerHTML = `${workMarkup}${resourceMarkup}`;
}

async function _loadMobileSources(root = document, options = {}) {
  const sid = String(options.sessionId || __pmChat.activeSessionId || '').trim();
  if (!sid) return;
  const history = options.history === true;
  const requestToken = ++mobileSourceState.requestToken;
  if (mobileSourceState.sessionId !== sid || mobileSourceState.history !== history) {
    mobileSourceState.resources = [];
  }
  mobileSourceState.sessionId = sid;
  mobileSourceState.history = history;
  mobileSourceState.loading = true;
  const list = root?.querySelector?.('#pm-mobile-sources-list');
  if (list && !mobileSourceState.resources.length) list.innerHTML = '<div style="padding:20px 8px;text-align:center;color:var(--pm-muted,#89909d);font-size:12px">Loading Sources…</div>';
  try {
    const data = history
      ? await loadMobileBrowserHistory(options.query || '', sid)
      : await loadMobileChatResources(sid, options.query || '');
    if (requestToken !== mobileSourceState.requestToken
      || mobileSourceState.sessionId !== sid
      || mobileSourceState.history !== history) return;
    mobileSourceState.resources = (Array.isArray(data?.resources) ? data.resources : [])
      .filter((resource) => sourcePanelResourceBelongsToContext(resource, {
        surface: SOURCE_PANEL_SURFACE.MAIN_CHAT,
        sessionId: sid,
      }));
    _renderMobileSourceList(root);
  } catch (error) {
    if (requestToken !== mobileSourceState.requestToken
      || mobileSourceState.sessionId !== sid
      || mobileSourceState.history !== history) return;
    mobileSourceState.resources = [];
    if (list) list.innerHTML = `<div style="padding:20px 8px;text-align:center;color:var(--pm-muted,#89909d);font-size:12px">Sources unavailable: ${escapeHtml(error?.message || 'request failed')}</div>`;
  } finally {
    if (requestToken === mobileSourceState.requestToken) mobileSourceState.loading = false;
  }
}

function _refreshMobileSourcesForSession(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || mobileSourceState.history || mobileSourceState.sessionId !== sid) return;
  const popover = document.getElementById('pm-mobile-sources-popover');
  if (!popover || popover.hidden) return;
  _loadMobileSources(popover.closest('.pm-page') || document, { sessionId: sid, history: false }).catch(() => {});
}

function _closeMobileSources(root = document) {
  const popover = root?.querySelector?.('#pm-mobile-sources-popover');
  if (popover) popover.hidden = true;
}

function _openMobileSources(root = document, options = {}) {
  document.getElementById('pm-chat-settings-popover')?.remove();
  document.getElementById('pm-chat-settings-popover-overlay')?.remove();
  const popover = root?.querySelector?.('#pm-mobile-sources-popover');
  if (!popover) return;
  popover.hidden = false;
  _loadMobileSources(root, {
    sessionId: options.sessionId || __pmChat.activeSessionId,
    history: options.history === true,
  });
}

function _scrollChat(bodyEl) {
  if (!bodyEl) return;
  _restoreMobileChatScroll(bodyEl, null, { forceBottom: true });
}

const PM_CHAT_SLASH_COMMANDS = getChatSlashCommands('mobile');

let pmActiveSlashCommand = null;
let pmSlashCommandSelectionIndex = 0;
let pmSkillTriggerExpanded = false;
let pmSkillTriggerSelectedId = '';
let pmSkillTriggerLastKey = '';
let pmSkillTriggerExcludedIds = new Set();
let pmSelectedComposerSkillIds = [];
let pmSelectedComposerSkills = [];
let pmSkillComposerSelectionIndex = 0;

function _pmNormalizeSkillText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Unified matcher: the pill now uses the SAME backend matcher that surfaces
// "matching skills" to the AI (GET /api/skills/match), instead of a duplicate
// client-side matcher that could drift. We keep a tiny cache of the last query
// result so render can stay synchronous; _pmFetchComposerSkillMatches refreshes
// it asynchronously (debounced) and re-renders when results change.
let _pmSkillMatchCacheQuery = '';
let _pmSkillMatchCacheResult = [];
let _pmSkillMatchInflight = '';
let _pmSkillMatchDebounce = null;

function _pmSkillTriggerExclusionKey(value) {
  return String(value || '').trim().toLowerCase();
}

function _pmSkillTriggerIdentity(skill) {
  return String(skill?.id || skill?.name || '').trim();
}

function _pmNormalizeSelectedSkillIds(value) {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set();
  const ids = [];
  raw.forEach((item) => {
    const id = String(item || '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) return;
    seen.add(key);
    ids.push(id);
  });
  return ids;
}

function _pmRememberSelectedComposerSkill(id, title = '') {
  pmSelectedComposerSkillIds = _pmNormalizeSelectedSkillIds([...pmSelectedComposerSkillIds, id]).slice(0, 8);
  const skillId = String(id || '').trim();
  const skillTitle = String(title || id || '').trim();
  if (!skillTitle) return;
  const key = (skillId || skillTitle).toLowerCase();
  const next = Array.isArray(pmSelectedComposerSkills) ? pmSelectedComposerSkills.filter((item) => {
    const itemKey = String(item?.id || item?.title || '').trim().toLowerCase();
    return itemKey && itemKey !== key;
  }) : [];
  next.push({ id: skillId || skillTitle, title: skillTitle });
  pmSelectedComposerSkills = next.slice(-8);
}

function _pmClearSelectedComposerSkills() {
  pmSelectedComposerSkillIds = [];
  pmSelectedComposerSkills = [];
}

function _pmNormalizeSelectedComposerSkillRefs(value) {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set();
  const refs = [];
  raw.forEach((item) => {
    const title = String(item?.title || item?.name || '').trim();
    const id = String(item?.id || title).trim();
    const key = (id || title).toLowerCase();
    if (!title || !key || seen.has(key)) return;
    seen.add(key);
    refs.push({ id: id || title, title });
  });
  return refs;
}

function _pmSkillRefMatchesAt(text, index, refs) {
  const lower = text.toLowerCase();
  for (const ref of refs) {
    const title = String(ref?.title || '').trim();
    if (!title) continue;
    const end = index + title.length;
    if (lower.slice(index, end) !== title.toLowerCase()) continue;
    return { ref, end };
  }
  return null;
}

function _pmSortedSlashCommandTokens() {
  return PM_CHAT_SLASH_COMMANDS.slice().sort((a, b) => b.command.length - a.command.length);
}

function _pmSlashCommandTokenAt(text, index) {
  const value = String(text || '');
  const lower = value.toLowerCase();
  const prev = index > 0 ? value.charAt(index - 1) : '';
  if (prev && !/\s/.test(prev)) return null;
  for (const item of _pmSortedSlashCommandTokens()) {
    const command = String(item.command || '').trim();
    if (!command) continue;
    const end = index + command.length;
    if (lower.slice(index, end) !== command.toLowerCase()) continue;
    const next = value.charAt(end);
    if (next && !/\s/.test(next)) continue;
    return { item, end };
  }
  return null;
}

function _pmHasSlashCommandToken(text) {
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    if (value.charAt(i) === '/' && _pmSlashCommandTokenAt(value, i)) return true;
  }
  return false;
}

function _pmComposerRichTextHtml(value, refs = pmSelectedComposerSkills) {
  const text = String(value || '');
  const normalizedRefs = _pmNormalizeSelectedComposerSkillRefs(refs)
    .sort((a, b) => String(b.title || '').length - String(a.title || '').length);
  let cursor = 0;
  let html = '';
  while (cursor < text.length) {
    const match = _pmSkillRefMatchesAt(text, cursor, normalizedRefs);
    if (match) {
      const label = text.slice(cursor, match.end);
      html += `<span class="pm-composer-skill-token">${escapeHtml(label)}</span>`;
      cursor = match.end;
      continue;
    }
    const commandMatch = text.charAt(cursor) === '/' ? _pmSlashCommandTokenAt(text, cursor) : null;
    if (commandMatch) {
      const label = text.slice(cursor, commandMatch.end);
      html += `<span class="pm-composer-command-token">${escapeHtml(label)}</span>`;
      cursor = commandMatch.end;
      continue;
    }
    html += escapeHtml(text.charAt(cursor));
    cursor += 1;
  }
  return html;
}

function _pmUpdateComposerRichPreview(page, input) {
  const wrap = page?.querySelector?.('#pm-composer-input-wrap');
  const preview = page?.querySelector?.('#pm-composer-rich-preview');
  if (!wrap || !preview || !input) return;
  const text = String(input.value || '');
  const refs = _pmNormalizeSelectedComposerSkillRefs(pmSelectedComposerSkills);
  const hasSkillToken = refs.some((ref) => ref.title && text.toLowerCase().includes(ref.title.toLowerCase()));
  const hasCommandToken = _pmHasSlashCommandToken(text);
  const hasRichPreview = hasSkillToken || hasCommandToken;
  wrap.classList.toggle('has-rich-preview', hasRichPreview);
  preview.hidden = !hasRichPreview;
  preview.innerHTML = hasRichPreview ? _pmComposerRichTextHtml(text, refs) : '';
  preview.scrollTop = input.scrollTop || 0;
}

function _pmGetExcludedSkillIds() {
  return Array.from(pmSkillTriggerExcludedIds || []).filter(Boolean);
}

function _pmClearSkillExclusions() {
  pmSkillTriggerExcludedIds = new Set();
}

function _pmIsSkillExcluded(skill) {
  const key = _pmSkillTriggerExclusionKey(_pmSkillTriggerIdentity(skill));
  return !!key && pmSkillTriggerExcludedIds.has(key);
}

function _pmComposerSkillMatches(value) {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return [];
  const filterExcluded = (matches) => (Array.isArray(matches) ? matches : []).filter((skill) => !_pmIsSkillExcluded(skill));
  // Never render a stale response for a newer composer query.
  if (text !== _pmSkillMatchCacheQuery) return [];
  return filterExcluded(_pmSkillMatchCacheResult);
}

function _pmSkillMatchEvidence(skill) {
  const evidence = [
    ...(Array.isArray(skill?.promptSignalEvidence) ? skill.promptSignalEvidence : []),
    ...(Array.isArray(skill?.matchedPromptSignals) ? skill.matchedPromptSignals : []),
    ...(Array.isArray(skill?.matchedTriggers) ? skill.matchedTriggers : []),
    ...(Array.isArray(skill?.matchedDomains) ? skill.matchedDomains.map((value) => `domain: ${value}`) : []),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return [...new Set(evidence)].slice(0, 3);
}

function _pmFetchComposerSkillMatches(value, page) {
  const text = String(value || '').toLowerCase().trim();
  if (!text) { _pmSkillMatchCacheQuery = ''; _pmSkillMatchCacheResult = []; return; }
  if (text === _pmSkillMatchCacheQuery || text === _pmSkillMatchInflight) return;
  if (_pmSkillMatchDebounce) clearTimeout(_pmSkillMatchDebounce);
  _pmSkillMatchDebounce = setTimeout(() => {
    _pmSkillMatchInflight = text;
    mobileGatewayFetch('/api/skills/match?q=' + encodeURIComponent(text) + '&limit=8')
      .then((data) => {
        // Ignore stale responses if the composer text changed since.
        if (_pmSkillMatchInflight !== text) return;
        _pmSkillMatchCacheQuery = text;
        _pmSkillMatchCacheResult = Array.isArray(data?.matches) ? data.matches : [];
        const input = page?.querySelector?.('.pm-composer textarea, .pm-composer input[type="text"]');
        if (input && String(input.value || '').toLowerCase().trim() === text) {
          _pmRenderSkillTriggerPill(page, input);
        }
      })
      .catch((err) => console.warn('[mobile skills] match fetch failed:', err))
      .finally(() => { if (_pmSkillMatchInflight === text) _pmSkillMatchInflight = ''; });
  }, 140);
}

let _pmSkillCacheLoadPromise = null;
// An empty array is a valid loaded result, but it is also the value used by
// the desktop skills page while its request is still in flight. Keep that
// distinction explicit so typing `$` never renders a picker and immediately
// hides it during the async load.
let _pmSkillCacheReady = Array.isArray(window.prometheusSkillsCache)
  && window.prometheusSkillsCache.length > 0;
function _pmEnsureSkillTriggerCacheLoaded() {
  if (_pmSkillCacheReady) return Promise.resolve(window.prometheusSkillsCache || []);
  if (Array.isArray(window.prometheusSkillsCache) && window.prometheusSkillsCache.length) {
    _pmSkillCacheReady = true;
    return Promise.resolve(window.prometheusSkillsCache);
  }
  if (_pmSkillCacheLoadPromise) return _pmSkillCacheLoadPromise;
  // Always use the mobile-authenticated fetch. The desktop loadInstalledSkills()
  // uses the desktop api() helper + #skills-list DOM and fails silently on mobile,
  // leaving window.prometheusSkillsCache empty so the trigger pill never renders.
  _pmSkillCacheLoadPromise = mobileGatewayFetch('/api/skills')
    .then((data) => {
      window.prometheusSkillsCache = Array.isArray(data?.skills) ? data.skills : [];
      _pmSkillCacheReady = true;
      window.dispatchEvent(new CustomEvent('prometheus:skills-cache-updated', { detail: { skills: window.prometheusSkillsCache } }));
      return window.prometheusSkillsCache;
    })
    .catch((err) => {
      console.warn('[mobile skills] trigger cache load failed:', err);
      // Complete the same render cycle on failure so a temporary loading
      // surface cannot remain open forever above the composer. Preserve any
      // cache another surface may have populated while this request ran.
      if (!Array.isArray(window.prometheusSkillsCache)) window.prometheusSkillsCache = [];
      _pmSkillCacheReady = true;
      window.dispatchEvent(new CustomEvent('prometheus:skills-cache-updated', { detail: { skills: window.prometheusSkillsCache, error: err } }));
      return window.prometheusSkillsCache;
    })
    .finally(() => { _pmSkillCacheLoadPromise = null; });
  return _pmSkillCacheLoadPromise;
}

function _pmSkillTriggerIcon() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3z"/><path d="M19 16l.7 2.1L22 19l-2.3.9L19 22l-.7-2.1L16 19l2.3-.9L19 16z"/></svg>`;
}

function _pmHideSkillTriggerPill(page) {
  const pill = page?.querySelector?.('#pm-skill-trigger-pill') || document.getElementById('pm-skill-trigger-pill');
  if (!pill) return;
  pill.hidden = true;
  pill.classList.remove('expanded', 'pop');
  pill.innerHTML = '';
  pmSkillTriggerExpanded = false;
  pmSkillTriggerSelectedId = '';
  pmSkillTriggerLastKey = '';
}

function _pmRemoveComposerSkillMatch(page, input, id) {
  const key = _pmSkillTriggerExclusionKey(id);
  if (!key) return;
  pmSkillTriggerExcludedIds.add(key);
  if (_pmSkillTriggerExclusionKey(pmSkillTriggerSelectedId) === key) pmSkillTriggerSelectedId = '';
  _pmRenderSkillTriggerPill(page, input);
  pmToast('Skill removed from this message', 'info');
}

function _pmRenderSkillTriggerPill(page, input) {
  const pill = page?.querySelector?.('#pm-skill-trigger-pill');
  if (!pill) return;
  // Explicit skill references own the composer suggestion surface. Do not
  // stack the unrelated skill matcher beneath the picker while typing `$`.
  if (_pmSlashCommandState(input) || _pmSkillComposerState(input) || _pmMatchSlashCommandValue(input?.value || '')) {
    _pmHideSkillTriggerPill(page);
    return;
  }
  if (!String(input?.value || '').trim()) _pmClearSkillExclusions();
  _pmEnsureSkillTriggerCacheLoaded();
  _pmFetchComposerSkillMatches(input?.value || '', page);
  const matches = _pmComposerSkillMatches(input?.value || '');
  if (!matches.length) {
    _pmHideSkillTriggerPill(page);
    return;
  }
  const nextKey = matches.map((skill) => String(skill.id || skill.name || '')).join('|');
  const shouldPop = pill.hidden || nextKey !== pmSkillTriggerLastKey;
  pmSkillTriggerLastKey = nextKey;
  if (pmSkillTriggerSelectedId && !matches.some((skill) => String(skill.id || '') === pmSkillTriggerSelectedId)) {
    pmSkillTriggerSelectedId = '';
  }
  const visibleNames = matches.slice(0, 3);
  const overflow = Math.max(0, matches.length - visibleNames.length);
  const selectedSkill = matches.find((skill) => String(skill.id || '') === pmSkillTriggerSelectedId) || null;

  pill.classList.toggle('expanded', pmSkillTriggerExpanded);
  pill.innerHTML = `
    <button type="button" class="pm-skill-trigger-summary" aria-expanded="${pmSkillTriggerExpanded ? 'true' : 'false'}">
      <span class="pm-skill-trigger-icon">${_pmSkillTriggerIcon()}</span>
      <span class="pm-skill-trigger-label">Related Skills</span>
      <span class="pm-skill-trigger-count">${matches.length}</span>
      <span class="pm-skill-trigger-preview">${visibleNames.map((skill) => `<span>${escapeHtml(skill.name || skill.id || 'Skill')}</span>`).join('')}${overflow ? `<span>+${overflow}</span>` : ''}</span>
    </button>
    <button type="button" class="pm-skill-trigger-close" aria-label="Dismiss related skills">x</button>
    ${pmSkillTriggerExpanded ? `
      <div class="pm-skill-trigger-row">
        ${matches.map((skill) => `
          <button type="button" class="pm-skill-trigger-item${String(skill.id || '') === pmSkillTriggerSelectedId ? ' active' : ''}" data-skill-id="${escapeHtml(skill.id || '')}">
            <span>${escapeHtml(skill.name || skill.id || 'Skill')}</span>
            <small>${escapeHtml(`${skill.confidence || 'match'}${Number.isFinite(Number(skill.score)) ? ` · ${Math.round(Number(skill.score))}` : ''}`)}</small>
          </button>
        `).join('')}
      </div>
      <div class="pm-skill-trigger-desc">
        ${selectedSkill ? `
          <div class="pm-skill-trigger-desc-copy">
            <strong>${escapeHtml(selectedSkill.name || selectedSkill.id || 'Skill')}</strong>
            <span>${escapeHtml(selectedSkill.description || 'No description available.')}</span>
            <small>${escapeHtml(_pmSkillMatchEvidence(selectedSkill).length ? `Matched: ${_pmSkillMatchEvidence(selectedSkill).join(' · ')}` : 'Matched by the canonical skill router.')}</small>
          </div>
          <button type="button" class="pm-skill-trigger-remove" data-skill-id="${escapeHtml(_pmSkillTriggerIdentity(selectedSkill))}">Remove</button>
        ` : '<span>Select a skill to preview its description.</span>'}
      </div>
    ` : ''}
  `;
  pill.querySelector('.pm-skill-trigger-summary')?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pmSkillTriggerExpanded = !pmSkillTriggerExpanded;
    if (!pmSkillTriggerExpanded) pmSkillTriggerSelectedId = '';
    _pmRenderSkillTriggerPill(page, input);
  });
  pill.querySelector('.pm-skill-trigger-close')?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    _pmHideSkillTriggerPill(page);
  });
  pill.querySelectorAll('.pm-skill-trigger-item').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      pmSkillTriggerExpanded = true;
      pmSkillTriggerSelectedId = button.getAttribute('data-skill-id') || '';
      _pmRenderSkillTriggerPill(page, input);
    });
  });
  pill.querySelector('.pm-skill-trigger-remove')?.addEventListener('click', (event) => {
    event.preventDefault();
    _pmRemoveComposerSkillMatch(page, input, event.currentTarget?.getAttribute('data-skill-id') || '');
  });
  pill.hidden = false;
  if (shouldPop) {
    pill.classList.remove('pop');
    void pill.offsetWidth;
    pill.classList.add('pop');
  }
}

function _pmSortedSlashCommands() {
  return PM_CHAT_SLASH_COMMANDS.slice().sort((a, b) => b.command.length - a.command.length);
}

function _pmMatchSlashCommandValue(value) {
  const text = String(value || '');
  const lower = text.toLowerCase();
  for (const item of _pmSortedSlashCommands()) {
    const command = item.command.toLowerCase();
    if (lower === command || lower.startsWith(`${command} `)) {
      return { item, remainder: text.slice(item.command.length).replace(/^\s+/, '') };
    }
  }
  return null;
}

function _pmSlashCommandState(input) {
  if (!input) return null;
  const value = typeof input === 'string' ? input : String(input.value || '');
  const cursor = typeof input === 'string'
    ? value.length
    : (Number.isFinite(Number(input.selectionStart)) ? Number(input.selectionStart) : value.length);
  const beforeCursor = value.slice(0, cursor);
  const slashIndex = beforeCursor.lastIndexOf('/');
  if (slashIndex < 0) return null;
  const prefixChar = slashIndex > 0 ? beforeCursor.charAt(slashIndex - 1) : '';
  if (prefixChar && !/\s/.test(prefixChar)) return null;
  const query = beforeCursor.slice(slashIndex);
  if (!query.startsWith('/') || /[\s\r\n]/.test(query)) return null;
  return { start: slashIndex, end: cursor, query, value };
}

function _pmSlashCommandSuggestions(input) {
  const state = _pmSlashCommandState(input);
  if (!state) return [];
  const query = state.query.toLowerCase();
  return PM_CHAT_SLASH_COMMANDS.filter((item) => item.command.toLowerCase().startsWith(query)).slice(0, CHAT_COMPOSER_SUGGESTION_LIMIT);
}

function _pmSkillComposerState(input) {
  if (!input) return null;
  const value = String(input.value || '');
  const cursor = Number.isFinite(Number(input.selectionStart)) ? Number(input.selectionStart) : value.length;
  const beforeCursor = value.slice(0, cursor);
  const skillIndex = beforeCursor.lastIndexOf(CHAT_SKILL_TRIGGER);
  if (skillIndex < 0) return null;
  const prefixChar = skillIndex > 0 ? beforeCursor.charAt(skillIndex - 1) : '';
  if (prefixChar && !/\s/.test(prefixChar)) return null;
  const query = beforeCursor.slice(skillIndex + CHAT_SKILL_TRIGGER.length);
  // Skill ids commonly use hyphens (for example `airtable-connector`), but
  // mobile users should be able to type the natural spaced form while the
  // normalized matcher treats spaces and hyphens as equivalent. Stop only at
  // a line break so ordinary spaces remain part of the skill query.
  if (/[\r\n]/.test(query)) return null;
  return { start: skillIndex, end: cursor, query, value };
}

function _pmSkillComposerSearchText(skill) {
  return _pmNormalizeSkillText([
    skill?.name,
    skill?.id,
    skill?.description,
    ...(Array.isArray(skill?.triggers) ? skill.triggers : []),
    ...(Array.isArray(skill?.categories) ? skill.categories : []),
  ].filter(Boolean).join(' '));
}

function _pmSkillComposerSuggestions(input) {
  const state = _pmSkillComposerState(input);
  if (!state) return [];
  _pmEnsureSkillTriggerCacheLoaded();
  const skills = Array.isArray(window.prometheusSkillsCache) ? window.prometheusSkillsCache : [];
  const query = _pmNormalizeSkillText(state.query);
  const matches = query ? skills.filter((skill) => _pmSkillComposerSearchText(skill).includes(query)) : skills;
  return matches.slice(0, CHAT_COMPOSER_SUGGESTION_LIMIT);
}

function _pmReplaceSkillComposerWithSelection(page, input, skill) {
  const state = _pmSkillComposerState(input);
  if (!state || !input || !skill) return;
  const name = String(skill.name || skill.id || 'Skill').trim();
  const safeName = name
    .replace(/\*/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Skill';
  const suffix = String(state.value.slice(state.end) || '');
  const replacement = `${safeName}${suffix && /^\s/.test(suffix) ? '' : ' '}`;
  input.value = `${state.value.slice(0, state.start)}${replacement}${state.value.slice(state.end)}`;
  const nextCursor = state.start + replacement.length;
  input.setSelectionRange?.(nextCursor, nextCursor);
  _pmRememberSelectedComposerSkill(skill.id || skill.name || safeName, safeName);
  _pmHideSlashPopover(page);
  _pmRenderSkillTriggerPill(page, input);
  _pmUpdateComposerRichPreview(page, input);
  input.focus?.();
}

function _pmHideSlashPopover(page) {
  const popover = page?.querySelector?.('#pm-chat-slash-popover') || document.getElementById('pm-chat-slash-popover');
  if (popover) popover.hidden = true;
}

function _pmRefreshSlashChrome(page, input) {
  const chip = page.querySelector('#pm-chat-command-chip');
  if (!chip || !input) return;
  if (!pmActiveSlashCommand) {
    chip.hidden = true;
    chip.querySelector('.pm-command-chip-token').textContent = '';
    input.placeholder = window.__pmMobileComposerPlaceholder || 'Type a message...';
    return;
  }
  chip.hidden = false;
  chip.querySelector('.pm-command-chip-token').textContent = pmActiveSlashCommand.command;
  input.placeholder = pmActiveSlashCommand.placeholder || 'Type the command details...';
}

function _pmSetActiveSlashCommand(page, input, item, remainder = '') {
  if (!input || !item) return;
  pmActiveSlashCommand = null;
  const command = String(item.command || '').trim();
  const detail = String(remainder || '').trim();
  input.value = `${command}${detail ? ` ${detail}` : ' '}`;
  try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
  _pmRefreshSlashChrome(page, input);
  _pmHideSlashPopover(page);
  _pmUpdateComposerRichPreview(page, input);
  input.focus();
}

function _pmClearActiveSlashCommand(page, input, options = {}) {
  pmActiveSlashCommand = null;
  _pmRefreshSlashChrome(page, input);
  _pmHideSlashPopover(page);
  if (options.focus !== false) input?.focus?.();
}

function _pmSelectSlashCommand(page, input, command) {
  const item = PM_CHAT_SLASH_COMMANDS.find((candidate) => candidate.command === command);
  if (!item) return;
  const slashState = _pmSlashCommandState(input);
  if (slashState && slashState.start > 0 && input) {
    const replacement = `${item.command} `;
    input.value = `${slashState.value.slice(0, slashState.start)}${replacement}${slashState.value.slice(slashState.end)}`;
    const nextCursor = slashState.start + replacement.length;
    input.setSelectionRange?.(nextCursor, nextCursor);
    pmActiveSlashCommand = null;
    _pmRefreshSlashChrome(page, input);
    _pmHideSlashPopover(page);
    _pmUpdateComposerRichPreview(page, input);
    input.focus?.();
    return;
  }
  const current = String(input?.value || '');
  const typedMatch = _pmMatchSlashCommandValue(current);
  const remainder = typedMatch?.item.command === item.command ? typedMatch.remainder : '';
  _pmSetActiveSlashCommand(page, input, item, remainder);
}

function _pmRenderSlashPopover(page, input) {
  const popover = page.querySelector('#pm-chat-slash-popover');
  const skillState = _pmSkillComposerState(input);
  if (!popover || (pmActiveSlashCommand && !skillState)) {
    _pmHideSlashPopover(page);
    return [];
  }
  if (skillState) {
    _pmEnsureSkillTriggerCacheLoaded();
    if (!_pmSkillCacheReady) {
      popover.innerHTML = '<div class="pm-chat-slash-loading" role="status">Loading skills…</div>';
      popover.hidden = false;
      return [];
    }
    const skillSuggestions = _pmSkillComposerSuggestions(input);
    if (!skillSuggestions.length) {
      _pmHideSlashPopover(page);
      return [];
    }
    pmSkillComposerSelectionIndex = Math.max(0, Math.min(pmSkillComposerSelectionIndex, skillSuggestions.length - 1));
    popover.innerHTML = skillSuggestions.map((skill, idx) => {
      const description = String(skill.description || '').trim();
      const shortDescription = description.length > 84 ? `${description.slice(0, 81).trim()}...` : description;
      return `
    <button class="pm-chat-slash-item ${idx === pmSkillComposerSelectionIndex ? 'active' : ''}" type="button" data-skill-id="${escapeHtml(skill.id || '')}">
      <span class="pm-skill-suggestion-token">$${escapeHtml(skill.name || skill.id || 'Skill')}</span>
      <span class="pm-chat-slash-label">${escapeHtml(shortDescription || skill.id || 'Skill')}</span>
      <span class="pm-chat-slash-hint">${idx === 0 ? 'Enter' : 'Tap'}</span>
    </button>
  `;
    }).join('');
    popover.querySelectorAll('.pm-chat-slash-item').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const id = btn.getAttribute('data-skill-id') || '';
        const skill = skillSuggestions.find((candidate) => String(candidate.id || '') === id) || skillSuggestions[0];
        _pmReplaceSkillComposerWithSelection(page, input, skill);
      });
    });
    popover.hidden = false;
    return skillSuggestions;
  }
  const suggestions = _pmSlashCommandSuggestions(input);
  if (!suggestions.length) {
    _pmHideSlashPopover(page);
    return [];
  }
  pmSlashCommandSelectionIndex = Math.max(0, Math.min(pmSlashCommandSelectionIndex, suggestions.length - 1));
  popover.innerHTML = suggestions.map((item, idx) => `
    <button class="pm-chat-slash-item ${idx === pmSlashCommandSelectionIndex ? 'active' : ''}" type="button" data-command="${escapeHtml(item.command)}">
      <span class="pm-chat-slash-token">${escapeHtml(item.command)}</span>
      <span class="pm-chat-slash-label">${escapeHtml(item.label)}</span>
      <span class="pm-chat-slash-hint">${idx === 0 ? 'Enter' : 'Tap'}</span>
    </button>
  `).join('');
  popover.querySelectorAll('.pm-chat-slash-item').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      _pmSelectSlashCommand(page, input, btn.getAttribute('data-command') || '');
    });
  });
  popover.hidden = false;
  return suggestions;
}

function _pmHandleSlashInput(page, input) {
  const value = String(input?.value || '');
  const skillState = _pmSkillComposerState(input);
  if (skillState) {
    // A slash command selection can outlive a route/input replacement. A
    // skill token is a new explicit picker mode and must always be allowed to
    // open its own suggestions.
    if (pmActiveSlashCommand) {
      pmActiveSlashCommand = null;
      _pmRefreshSlashChrome(page, input);
      _pmUpdateComposerRichPreview(page, input);
    }
    pmSkillComposerSelectionIndex = 0;
    _pmRenderSlashPopover(page, input);
    return;
  }
  if (pmActiveSlashCommand) {
    const activeMatch = _pmMatchSlashCommandValue(value);
    if (activeMatch?.item?.command === pmActiveSlashCommand.command) return;
    pmActiveSlashCommand = null;
    _pmRefreshSlashChrome(page, input);
    _pmUpdateComposerRichPreview(page, input);
  }
  const match = _pmMatchSlashCommandValue(value);
  if (match) {
    pmActiveSlashCommand = null;
    _pmRefreshSlashChrome(page, input);
    _pmUpdateComposerRichPreview(page, input);
    _pmHideSlashPopover(page);
    return;
  }
  pmSlashCommandSelectionIndex = 0;
  _pmRenderSlashPopover(page, input);
}

function _pmGetComposerValue(input) {
  const value = String(input?.value || '').trim();
  if (!pmActiveSlashCommand) return value;
  return `${pmActiveSlashCommand.command}${value ? ` ${value}` : ''}`.trim();
}

function _openMobileMediaViewer({ kind, src, download, name }) {
  const safeKind = String(kind || 'file').toLowerCase();
  const title = String(name || 'Media preview');
  const mediaSrc = String(src || download || '');
  const downloadHref = String(download || src || '#');
  if (!mediaSrc) return;
  document.getElementById('pm-media-viewer')?.remove();
  const viewer = el(`
    <div class="pm-media-viewer" id="pm-media-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="pm-media-viewer-top">
        <button type="button" class="pm-media-viewer-close" aria-label="Close">${ICONS.back}<span>Chat</span></button>
        <strong>${escapeHtml(title)}</strong>
        <a class="pm-media-viewer-save" href="${escapeHtml(downloadHref)}" download="${escapeHtml(title)}" target="_blank" rel="noopener noreferrer">${ICONS.upload}<span>Save</span></a>
      </div>
      <div class="pm-media-viewer-stage ${escapeHtml(safeKind)}">
        ${safeKind === 'video'
          ? `<video src="${escapeHtml(mediaSrc)}" controls autoplay playsinline></video>`
          : safeKind === 'audio'
            ? `<audio src="${escapeHtml(mediaSrc)}" controls autoplay></audio>`
            : `<img src="${escapeHtml(mediaSrc)}" alt="${escapeHtml(title)}">`}
      </div>
      ${safeKind === 'image' ? `
        <div class="pm-media-viewer-zoom" aria-label="Zoom controls">
          <button type="button" data-zoom="-0.25">-</button>
          <button type="button" data-zoom="reset">1x</button>
          <button type="button" data-zoom="0.25">+</button>
        </div>
      ` : ''}
    </div>
  `);
  document.body.appendChild(viewer);
  const img = viewer.querySelector('img');
  let zoom = 1;
  const applyZoom = () => { if (img) img.style.transform = `scale(${zoom})`; };
  viewer.querySelector('.pm-media-viewer-close')?.addEventListener('click', () => viewer.remove());
  viewer.addEventListener('click', (ev) => { if (ev.target === viewer) viewer.remove(); });
  viewer.querySelectorAll('[data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-zoom');
      zoom = raw === 'reset' ? 1 : Math.max(0.5, Math.min(4, zoom + Number(raw || 0)));
      applyZoom();
    });
  });
}

function _openMobileMediaTarget({ kind, src, download, name, path, openMode }) {
  const safeKind = String(kind || 'file').toLowerCase();
  const mediaPath = String(path || '').trim();
  const mediaSrc = String(src || '').trim();
  const title = String(name || (mediaPath || mediaSrc).split(/[\\/]/).pop() || 'Preview');
  if (window.__pmCanvasSheet && (mediaPath || mediaSrc)) {
    window.__pmCanvasSheet.open({
      name: title,
      kind: safeKind,
      path: mediaPath,
      src: mediaSrc || (mediaPath ? _mobileMediaUrl({ path: mediaPath }, 'inline') : ''),
      download: String(download || '') || (mediaPath ? _mobileMediaUrl({ path: mediaPath }, 'download') : mediaSrc),
      openMode: String(openMode || '') || undefined,
    });
    return;
  }
  if (['image', 'video', 'audio'].includes(safeKind)) {
    _openMobileMediaViewer({ kind: safeKind, src: mediaSrc, download, name: title });
  }
}

function _wireMobileMediaCards(root = document) {
  root?.querySelectorAll?.('[data-pm-generated-thumb]')?.forEach((thumb) => {
    if (thumb.dataset.pmGeneratedThumbWired === '1') return;
    thumb.dataset.pmGeneratedThumbWired = '1';
    thumb.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const batch = thumb.closest('.pm-generated-image-batch');
      const primary = batch?.querySelector('[data-pm-generated-primary]');
      const primaryImage = primary?.querySelector('img');
      if (!batch || !primary || !primaryImage) return;
      ['kind', 'src', 'download', 'name', 'path', 'index'].forEach((field) => {
        primary.setAttribute(`data-${field}`, thumb.getAttribute(`data-${field}`) || '');
      });
      primaryImage.src = thumb.getAttribute('data-src') || '';
      primaryImage.alt = thumb.getAttribute('data-name') || '';
      batch.querySelectorAll('[data-pm-generated-thumb]').forEach((candidate) => {
        const selected = candidate === thumb;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    });
  });
  root?.querySelectorAll?.('[data-pm-media]')?.forEach((card) => {
    if (card.dataset.pmMediaWired === '1') return;
    card.dataset.pmMediaWired = '1';
    card.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _openMobileMediaTarget({
        kind: card.getAttribute('data-kind') || 'file',
        src: card.getAttribute('data-src') || '',
        download: card.getAttribute('data-download') || '',
        name: card.getAttribute('data-name') || 'Preview',
        path: card.getAttribute('data-path') || '',
      });
    });
  });
}

async function _copyMobileSnippetText(text, button = null) {
  const value = String(text || '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    pmToast('Snippet copied', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); pmToast('Snippet copied', 'success'); }
    catch { pmToast('Could not copy snippet', 'error'); }
    finally { ta.remove(); }
  }
  if (button) {
    button.classList.add('copied');
    window.setTimeout(() => button.classList.remove('copied'), 700);
  }
}

function _wireMobileSnippetCopyButtons(root = document) {
  root?.querySelectorAll?.('.pm-bubble .markdown-body pre').forEach((pre) => {
    if (pre.dataset.pmSnippetCopyWired === '1') return;
    pre.dataset.pmSnippetCopyWired = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pm-snippet-copy-btn';
    button.title = 'Copy snippet';
    button.setAttribute('aria-label', 'Copy snippet');
    button.innerHTML = ICONS.clipboard;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const code = pre.querySelector('code');
      _copyMobileSnippetText((code?.innerText || pre.innerText || '').trim(), button);
    });
    pre.appendChild(button);
  });
}

function _mobileHtmlVisualFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `prometheus-visual-${ts}.html`;
}

function _mobileNormalizeVisualHtml(raw) {
  const html = String(raw || '').trim();
  if (!html) return '';
  if (/<!doctype html|<html[\s>]/i.test(html)) return html;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Prometheus Visual</title>
</head>
<body>
${html}
</body>
</html>`;
}

async function _saveMobileHtmlVisual(block, button = null) {
  const raw = block?.getAttribute?.('data-vis-code') || block?.querySelector?.('iframe')?.getAttribute?.('srcdoc') || '';
  const html = _mobileNormalizeVisualHtml(raw);
  if (!html) {
    pmToast('This visual has no HTML source to save.', 'error');
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.classList.add('saving');
    }
    const filename = _mobileHtmlVisualFilename();
    const result = await uploadMobileTextFile({ filename, content: html });
    const path = String(result?.relPath || `uploads/${filename}`);
    pmToast('Saved visual to workspace', 'success');
    window.__pmCanvasSheet?.open({
      name: filename,
      kind: 'html',
      path,
      src: _mobileMediaUrl({ path }, 'inline'),
      download: _mobileMediaUrl({ path }, 'download'),
      interactionMode: 'interact',
    });
  } catch (err) {
    pmToast(err?.message || 'Could not save visual', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('saving');
    }
  }
}

function _wireMobileVisualSaveButtons(root = document) {
  root?.querySelectorAll?.('.pm-bubble .visual-block[data-vis-lang="html"][data-vis-code]').forEach((block) => {
    if (block.dataset.pmVisualSaveWired === '1') return;
    block.dataset.pmVisualSaveWired = '1';
    const row = document.createElement('div');
    row.className = 'pm-visual-save-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pm-visual-save-btn';
    button.title = 'Save HTML visual';
    button.setAttribute('aria-label', 'Save HTML visual to workspace');
    button.innerHTML = `${ICONS.upload}<span>Save HTML</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _saveMobileHtmlVisual(block, button);
    });
    row.appendChild(button);
    block.insertAdjacentElement('afterend', row);
  });
}

function _wireMobileChatEnhancements(root = document) {
  _wireMobileMediaCards(root);
  _wireMobileFileChangeRows(root);
  _wireMobileCheckpointRestoreButtons(root);
  _wireMobileSnippetCopyButtons(root);
  _wireMobileVisualSaveButtons(root);
  _wireMobileWorkerDecks(root);
}

const _mobileWorkerDeckViewState = new Map();

function _captureMobileWorkerDeckViewState(root = document) {
  root?.querySelectorAll?.('[data-pm-worker-deck]')?.forEach((deck) => {
    const workgroupId = String(deck.getAttribute('data-pm-worker-deck') || '').trim();
    const track = deck.querySelector('[data-pm-worker-track]');
    if (!workgroupId || !track) return;
    const activeIndex = Math.max(0, Number(deck.dataset.activeWorker || 0) || 0);
    _mobileWorkerDeckViewState.set(workgroupId, { activeIndex, scrollLeft: track.scrollLeft });
  });
}

function _wireMobileWorkerDecks(root = document) {
  root?.querySelectorAll?.('[data-pm-worker-deck]')?.forEach((deck) => {
    if (deck.dataset.pmWorkerDeckWired === '1') return;
    deck.dataset.pmWorkerDeckWired = '1';
    const track = deck.querySelector('[data-pm-worker-track]');
    const cards = Array.from(deck.querySelectorAll('[data-pm-worker-card]'));
    const dots = Array.from(deck.querySelectorAll('[data-pm-worker-dot]'));
    if (!track || !cards.length) return;
    const workgroupId = String(deck.getAttribute('data-pm-worker-deck') || '').trim();
    const savedView = workgroupId ? _mobileWorkerDeckViewState.get(workgroupId) : null;
    if (savedView && Number.isFinite(Number(savedView.scrollLeft))) {
      track.scrollLeft = Math.max(0, Number(savedView.scrollLeft));
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const trackRect = track.getBoundingClientRect();
      const center = trackRect.left + trackRect.width / 2;
      let activeIndex = 0;
      let nearest = Infinity;
      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        const cardCenter = rect.left + rect.width / 2;
        const distance = Math.max(-2, Math.min(2, (cardCenter - center) / Math.max(1, rect.width)));
        const absolute = Math.abs(distance);
        card.style.setProperty('--pm-worker-distance', absolute.toFixed(3));
        card.style.setProperty('--pm-worker-direction', distance.toFixed(3));
        card.style.zIndex = String(20 - Math.round(absolute * 5));
        card.classList.toggle('is-active', absolute < 0.42);
        if (absolute < nearest) { nearest = absolute; activeIndex = index; }
      });
      dots.forEach((dot, index) => dot.classList.toggle('active', index === activeIndex));
      deck.dataset.activeWorker = String(activeIndex);
      if (workgroupId) {
        _mobileWorkerDeckViewState.set(workgroupId, { activeIndex, scrollLeft: track.scrollLeft });
        if (_mobileWorkerDeckViewState.size > 60) {
          _mobileWorkerDeckViewState.delete(_mobileWorkerDeckViewState.keys().next().value);
        }
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    track.addEventListener('scroll', () => {
      if (workgroupId) {
        const current = _mobileWorkerDeckViewState.get(workgroupId) || {};
        _mobileWorkerDeckViewState.set(workgroupId, { ...current, scrollLeft: track.scrollLeft });
      }
      schedule();
    }, { passive: true });
    cards.forEach((card) => card.addEventListener('click', () => card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })));
    dots.forEach((dot, index) => dot.addEventListener('click', () => cards[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(track);
    requestAnimationFrame(() => {
      if (savedView && Number.isFinite(Number(savedView.scrollLeft))) {
        track.scrollLeft = Math.max(0, Number(savedView.scrollLeft));
      } else if (savedView && Number.isFinite(Number(savedView.activeIndex))) {
        const card = cards[Math.max(0, Math.min(cards.length - 1, Number(savedView.activeIndex)))];
        if (card) track.scrollLeft = Math.max(0, card.offsetLeft - ((track.clientWidth - card.offsetWidth) / 2));
      }
      update();
    });
    if (workgroupId) {
      mobileGatewayFetch(`/api/voice-agent/workgroups/${encodeURIComponent(workgroupId)}`)
        .then((data) => {
          const fresh = _normalizeMobileVoiceWorkgroup(data?.workgroup);
          const found = _findMobileVoiceWorkgroupMessage(workgroupId);
          const currentUpdatedAt = Number(found?.message?.voiceWorkgroup?.updatedAt || 0);
          if (fresh && Number(fresh.updatedAt || 0) > currentUpdatedAt) {
            _upsertMobileVoiceWorkgroup(found?.sessionId || fresh.parentSessionId, fresh);
          }
        })
        .catch(() => {});
    }
  });
}

async function _restoreMobileWorkspaceCheckpoint(checkpointId, button = null) {
  const id = String(checkpointId || '').trim();
  if (!id) return;
  const approved = window.confirm?.('Restore this turn checkpoint?\n\nThis will put every changed file back to its state before that Prometheus turn.') ?? false;
  if (!approved) return;
  const btn = button && typeof button === 'object' ? button : null;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-loading');
  }
  try {
    const result = await mobileGatewayFetch('/api/canvas/history/restore', {
      method: 'POST',
      body: JSON.stringify({ checkpoint_id: id, confirm: true }),
      timeoutMs: 30000,
    });
    const touched = (Array.isArray(result?.restored) ? result.restored.length : 0) + (Array.isArray(result?.deleted) ? result.deleted.length : 0);
    pmToast(touched ? `Restored ${touched} path${touched === 1 ? '' : 's'}` : 'Restored checkpoint', 'success');
  } catch (err) {
    pmToast(`Restore failed: ${String(err?.message || err)}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }
}

function _wireMobileCheckpointRestoreButtons(root = document) {
  root?.querySelectorAll?.('[data-pm-restore-checkpoint]')?.forEach((button) => {
    if (button.dataset.pmRestoreCheckpointWired === '1') return;
    button.dataset.pmRestoreCheckpointWired = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _restoreMobileWorkspaceCheckpoint(button.getAttribute('data-pm-restore-checkpoint') || '', button);
    });
  });
}

function _wireMobileFileChangeRows(root = document) {
  root?.querySelectorAll?.('[data-pm-file-change-path]')?.forEach((row) => {
    if (row.dataset.pmFileChangeWired === '1') return;
    row.dataset.pmFileChangeWired = '1';
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const path = row.getAttribute('data-pm-file-change-path') || '';
      const name = row.getAttribute('data-pm-file-change-name') || path.split(/[\\/]/).pop() || 'File';
      const kind = row.getAttribute('data-pm-file-change-kind') || _mobileMediaKind({ path, name });
      _openMobileMediaTarget({
        kind,
        path,
        name,
        openMode: 'diff',
        src: path ? _mobileMediaUrl({ path }, 'inline') : '',
        download: path ? _mobileMediaUrl({ path }, 'download') : '',
      });
    });
  });
}

const PM_MOBILE_LAST_CHAT_CONTEXT_KEY = 'pm_mobile_last_chat_context';

function _readMobileLastChatContext() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PM_MOBILE_LAST_CHAT_CONTEXT_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function _saveMobileLastChatContext(context = {}) {
  try {
    localStorage.setItem(PM_MOBILE_LAST_CHAT_CONTEXT_KEY, JSON.stringify({
      gatewayId: String(context.gatewayId || '').trim(),
      gatewayName: String(context.gatewayName || '').trim(),
      projectId: String(context.projectId || '').trim(),
      projectName: String(context.projectName || '').trim(),
      updatedAt: Date.now(),
    }));
  } catch {}
}

let mobileChatPageRendererPromise = null;
function loadMobileChatPageRenderer() {
  if (!mobileChatPageRendererPromise) {
    mobileChatPageRendererPromise = import('./mobile-chat-page-runtime.js')
      .then(({ createMobileChatPageRenderer }) => createMobileChatPageRenderer(() => ({
  ICONS,
  isMobileChatPinned,
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
  setPmSkillCacheReady: (value) => { _pmSkillCacheReady = value; },
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
  setPmActiveSlashCommand: (value) => { pmActiveSlashCommand = value; },
  pmHaptic,
  pmMobileBrowseCache,
  pmSelectedComposerSkillIds,
  pmSelectedComposerSkills,
  pmSkillComposerSelectionIndex,
  setPmSkillComposerSelectionIndex: (value) => { pmSkillComposerSelectionIndex = value; },
  pmSlashCommandSelectionIndex,
  setPmSlashCommandSelectionIndex: (value) => { pmSlashCommandSelectionIndex = value; },
  pmToast,
  presentChatError,
  probeGateway,
  receipts,
  setReceipts: (value) => { receipts = value; },
  reconcileMobileChatTurn,
  renderMobileContextChip,
  renderMobileHeader,
  toggleMobileChatPin,
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
      })));
  }
  return mobileChatPageRendererPromise;
}
export async function renderChatPage(page, { navigate, sessionId = null, voiceRoomTranscript = false }) {
  const renderer = await loadMobileChatPageRenderer();
  return renderer(page, { navigate, sessionId, voiceRoomTranscript });
}

/* ---------------- VOICE ---------------- */

// The shared Voice state is created while the Chat owner module is evaluating,
// before the optional Voice runtime can be downloaded. Keep this tiny,
// side-effect-free bootstrap here so persisted Voice preferences are available
// synchronously; the Voice runtime remains the authority for later reads and
// writes once it is hydrated.
function _mobileVoiceBootstrapSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pm_voice_settings_v1') || '{}');
    const voiceMode = saved.voiceMode === 'xai' ? 'xai' : 'openai_realtime';
    const listenMode = ['push_to_speak', 'always_listening'].includes(saved.listenMode) ? saved.listenMode : 'push_to_speak';
    const wakePhrase = String(saved.wakePhrase || '').replace(/\s+/g, ' ').trim();
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
      wakePhrase: listenMode === 'always_listening' ? wakePhrase : '',
      wakeGateActive: listenMode === 'always_listening' && saved.wakeGateActive === true,
      sttProviderLocked: saved.sttProviderLocked === true,
      autoProviderDefault: saved.autoProviderDefault || '',
      voiceAgentRealtimeAgent: voiceMode === 'openai_realtime',
      voiceAgentXaiRealtime: voiceMode === 'xai',
    };
  } catch {
    return {
      voiceMode: 'openai_realtime',
      sttProvider: 'auto',
      ttsProvider: 'realtime',
      realtimeVoice: 'marin',
      realtimeSpeed: 1.05,
      serverVoice: '',
      xaiSpeed: 1.0,
      dictation: 'quiet',
      listenMode: 'push_to_speak',
      wakePhrase: '',
      wakeGateActive: false,
      sttProviderLocked: true,
      autoProviderDefault: '',
      voiceAgentRealtimeAgent: true,
      voiceAgentXaiRealtime: false,
    };
  }
}

const __pmVoice = (window.__pmVoice = window.__pmVoice || {
  recent: [],          // [{id, request, currentTool, finalText, toolStream: [], status, ts, expanded}]
  lastAi: '',          // last final response text
  dictation: 'quiet', // 'quiet' | 'milestone'
  settings: _mobileVoiceBootstrapSettings(),
  provider: null,      // detected provider snapshot
  voiceStatus: null,
  audioEl: null,
  audioUnlockEl: null,
  audioUnlocked: false,
  realtimeSpeechConnection: null,
  realtimeSpeechConnecting: null,
  realtimeSpeechWaiters: [],
  warmMicStream: null,
  warmMicPromise: null,
  speaking: false,
  listening: false,
  realtimeTranscript: '',
  realtimeDeltas: null,
  targetSessionId: '',
  targetSessionLabel: '',
  targetSessionChannel: '',
  targetSessionForced: false,
  statusEl: null,
  hintEl: null,
  voiceCatalog: {},
  activeVoiceRuntime: null,
  activeVoiceRenderToken: null,
  activeVoiceRenderCleanup: null,
  lastSubagentBridgeSubmit: null,
  pendingInterruptContext: null,
  lastInterruptionEvent: null,
  spokenTextSoFar: '',
  currentSpokenSegment: '',
  lastVoiceMilestone: '',
  previewQueue: [],
  activePreview: null,
  previewTimer: null,
  previewTransitionTimer: null,
  previewTransitionToken: 0,
  activeVoiceToolCalls: new Set(),
  thinkingOrbAudioPulse: 0,
});
__pmVoice.settings = { ..._mobileVoiceBootstrapSettings(), ...(__pmVoice.settings || {}) };
if (!(__pmVoice.activeVoiceToolCalls instanceof Set)) __pmVoice.activeVoiceToolCalls = new Set();
if (!Number.isFinite(Number(__pmVoice.thinkingOrbAudioPulse))) __pmVoice.thinkingOrbAudioPulse = 0;
if (!['openai_realtime', 'xai'].includes(__pmVoice.settings.voiceMode)) __pmVoice.settings.voiceMode = 'openai_realtime';
__pmVoice.settings.sttProvider = 'auto';
__pmVoice.settings.ttsProvider = 'realtime';
__pmVoice.settings.voiceAgentRealtimeAgent = __pmVoice.settings.voiceMode === 'openai_realtime';
__pmVoice.settings.voiceAgentXaiRealtime = __pmVoice.settings.voiceMode === 'xai';
__pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';

const __pmRealtimeAgent = {
  conn: null,                        // { pc, dc, audio, micStream, micTrack, sessionId, listenMode }
  connecting: null,
  listenMode: 'idle',                // 'idle' | 'push_to_talk' | 'always_listening'
  submitToWorker: null,
  submitToWorkerOwner: null,
  submitToChatWorker: null,
  submitToChatWorkerOwner: null,
  functionCallBuffers: new Map(),    // call_id -> { name, argsStr }
  functionCallConnections: new Map(), // call_id -> exact AVAS participant connection that issued it
  // Quiet mode: keep STT running while suppressing output/tools; public
  // Realtime disables create_response, while Codex Voice/Live v3 uses a local
  // hard mute because AVAS owns VAD and turn creation.
  quiet: { active: false, wakePhrase: '', wakeNormalized: '', pendingActivate: false, suppressResponse: false },
  contextRefreshTimer: null,
  pendingCreateResponse: null,
  outputGuard: { suspended: false, restoreSending: null, restoreTrackEnabled: null, until: 0, restoreTimer: null },
  // The camera surface can outlive a single spoken turn. Keep this separate
  // from liveCameraVision so the next turn still receives explicit camera
  // context after a one-shot capture closes the preview.
  cameraRuntime: {
    open: false,
    source: '',
    openedAt: 0,
    updatedAt: 0,
    turnContextKey: '',
    lastInstructions: '',
  },
  // PTT can be pressed while the WebRTC/AVAS session is still opening. Keep
  // the gesture explicitly so a release cannot later turn the mic on.
  ptt: { held: false, sessionId: '', pressId: 0, pressedAt: 0 },
  // Camera/photo staging: a captured image is held here (NOT sent to the model)
  // and shown in the chat bubble. It is flushed to the model as an attachment to
  // the user's NEXT spoken turn (flush on speech_started / PTT release), so the
  // user can "take a pic, then say 'look at this'". Voice-camera shutter paths
  // use the direct snapshot helper when the photo is the current voice input.
  pendingImages: [],                 // [{ dataUrl, name, mimeType, base64 }]
  // Live camera vision is latest-frame-only. While the camera surface is open
  // and the realtime data channel is ready, the loop delivers frames across
  // response boundaries instead of waiting for another spoken turn.
  liveCameraFrameReader: null,
  // Refresh immediately before delivery when the camera surface can encode
  // asynchronously. The sync reader remains the audio-safe cached fallback.
  liveCameraFrameAsyncReader: null,
  liveCameraVision: {
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
  },
  // WebRTC can expose a little more jitter/packet-loss telemetry than the
  // audio element itself.  Keep the monitor on the realtime session so it can
  // widen the receiver cushion only when the camera/tool traffic actually
  // makes the connection unstable.
  audioQualityMonitor: null,
  // Non-image files use the same staged turn: their preview remains visible
  // on the Voice page and is finalized with the next transcription.
  pendingFiles: [],                  // uploaded descriptors for the next spoken turn
  stagedImageTurn: null,             // legacy alias for stagedAttachmentTurn
  stagedAttachmentTurn: null,        // the chat bubble holding staged media
  // Per-response tracking for realtime worker hand-offs and subagent-only
  // recovery when the voice model verbally claims a handoff without a tool call.
  turn: {
    hadFunctionCall: false,
    dispatchedWorkerThisResponse: false,
    lastUserTranscript: '',
    lastAssistantTranscript: '',
    currentUserTranscriptItemId: '',
    currentUserSpeechStartedAt: 0,
    currentUserSpeechStoppedAt: 0,
    currentUserTranscriptPrefix: '',
    currentUserTranscriptSegment: '',
    voiceLyricTimer: null,
    nudged: false,
    pendingWorkerDispatch: null,
    suppressAssistantTranscript: false,
    finalSummaryPending: false,
    finalSummaryContentKey: '',
    queuedFinalSummary: '',
    queuedFinalSummaryKey: '',
    queuedFinalSummaryTranscriptKey: '',
    recentTranscriptEvents: [],
    recentSkillContextKeys: [],
  },
};

// Voice transport stays out of the Chat static closure. These same-name
// facades keep pre-mount Chat callbacks safe while the optional runtime is
// loading; Voice mounts create the real implementation before controls wire.
let mobileVoiceRuntime = null;
let mobileVoiceRuntimePromise = null;
const mobileVoiceThreadSnapshotWriteQueues = new Map();

function _mobileVoiceRuntimeGlobal() {
  if (mobileVoiceRuntime) return mobileVoiceRuntime;
  try {
    if (window.__pmMobileVoiceRuntime) return window.__pmMobileVoiceRuntime;
  } catch {}
  return null;
}

function _mobileVoiceRuntimeMethod(name) {
  const runtime = _mobileVoiceRuntimeGlobal();
  return runtime && typeof runtime[name] === "function" ? runtime[name] : null;
}

const MOBILE_VOICE_RUNTIME_FALLBACK_ONLY = new Set([
  '_isMobileRealtimeAgentMode',
  '_mobileRealtimeCameraRuntimePayload',
  '_mobileRealtimeAgentEffectiveSessionId',
  '_mobileVoiceDeviceTimeContext',
  '_mobileVoiceTargetPayload',
  '_currentMobileSubagentVoiceTarget',
  '_realtimeAgentDataChannelOpen',
  '_mobileRealtimeAgentPendingFileContext',
  '_consumeMobileRealtimeAgentPendingFiles',
  '_mobileXaiVoice',
  '_isProgressiveMobileRealtimeTranscript',
  '_mobileStreamTargetTurn',
  '_findMobileRecoverableAssistantTurn',
  '_persistMobileThreadSnapshot',
  '_setMobileSteerContinuationTurn',
  '_voiceShortSessionLabel',
  '_voiceTargetLabel',
  '_voiceMainAgentSvg',
  '_renderVoiceAgentTargetPickerHtml',
  '_makeRecognizer',
  '_canUseBrowserRecognition',
]);

function _mobileVoiceRuntimeFallback(name, args = []) {
  switch (name) {
    case '_isMobileRealtimeAgentMode':
      return !!(__pmRealtimeAgent?.conn || __pmRealtimeAgent?.connecting);
    case '_mobileRealtimeCameraRuntimePayload':
      return __pmRealtimeAgent?.cameraRuntime || null;
    case '_sendMobileRealtimeCameraRuntimeUpdate':
      return false;
    case '_setMobileRealtimeCameraRuntime':
      if (__pmRealtimeAgent) __pmRealtimeAgent.cameraRuntime = { ...(__pmRealtimeAgent.cameraRuntime || {}), ...(args[0] || {}) };
      return __pmRealtimeAgent?.cameraRuntime || null;
    case '_mobileRealtimeAgentEffectiveSessionId':
      return String(__pmRealtimeAgent?.conn?.sessionId || __pmVoice?.targetSessionId || __pmChat?.activeSessionId || MOBILE_CHAT_SESSION_ID).trim() || MOBILE_CHAT_SESSION_ID;
    case '_mobileVoiceDeviceTimeContext':
      return { iso: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
    case '_mobileVoiceTargetPayload':
      return {
        kind: __pmVoice?.target?.kind === 'subagent' ? 'subagent' : 'main',
        ...(String(__pmVoice?.target?.agentId || __pmVoice?.target?.id || "").trim() ? { agentId: String(__pmVoice.target.agentId || __pmVoice.target.id).trim() } : {}),
        ...(String(__pmVoice?.target?.label || __pmVoice?.targetSessionLabel || "").trim() ? { label: String(__pmVoice.target.label || __pmVoice.targetSessionLabel).trim() } : {}),
      };
    case '_currentMobileSubagentVoiceTarget':
      return __pmVoice?.target?.kind === 'subagent' ? __pmVoice.target : null;
    case '_realtimeAgentDataChannelOpen':
      return __pmRealtimeAgent?.conn?.dc?.readyState === 'open';
    case '_mobileRealtimeAgentPendingFileContext': {
      const files = Array.isArray(__pmRealtimeAgent?.pendingFiles) ? __pmRealtimeAgent.pendingFiles : [];
      const available = files.filter((item) => String(item?.workspacePath || "").trim());
      return available.length ? [
        '[VOICE_ATTACHMENT]',
        'The user attached these files for the next spoken request. Use them as context; do not reply to this attachment event by itself.',
        ...available.map((item) => `- ${String(item.name || "Attachment").trim()}: ${String(item.workspacePath).trim()}`),
      ].join("\\n") : "";
    }
    case '_consumeMobileRealtimeAgentPendingFiles': {
      const count = Array.isArray(__pmRealtimeAgent?.pendingFiles) ? __pmRealtimeAgent.pendingFiles.length : 0;
      if (__pmRealtimeAgent) __pmRealtimeAgent.pendingFiles = [];
      return count;
    }
    case '_persistMobileThreadSnapshot': {
      const sid = String(args[0] || '').trim();
      const thread = sid ? __pmChat.threads?.[sid] : null;
      if (!sid || !Array.isArray(thread)) return Promise.resolve(false);
      mobileChatRuntimeAdapter.sync(sid, { history: thread, source: 'mobile-persist' });
      const history = _mobileHistoryForServer(thread);
      const previous = mobileVoiceThreadSnapshotWriteQueues.get(sid) || Promise.resolve(true);
      const write = previous.catch(() => false)
        .then(() => updateMobileChatSessionHistory(sid, history))
        .then(() => true)
        .catch((err) => {
          console.warn('[mobile chat] failed to persist chat state:', err);
          return false;
        });
      mobileVoiceThreadSnapshotWriteQueues.set(sid, write);
      write.finally(() => {
        if (mobileVoiceThreadSnapshotWriteQueues.get(sid) === write) mobileVoiceThreadSnapshotWriteQueues.delete(sid);
      });
      return write;
    }
    case '_setMobileSteerContinuationTurn': {
      const sourceTurn = args[0];
      const continuationTurn = args[1];
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
      } catch {
        sourceTurn._steerContinuationTurn = continuationTurn;
        continuationTurn._steerSourceTurn = sourceTurn;
      }
      return continuationTurn;
    }
    case '_mobileXaiVoice':
      return String(args[0] || __pmVoice?.settings?.serverVoice || __pmVoice?.settings?.realtimeVoice || "carina").trim() || "carina";
    case '_isProgressiveMobileRealtimeTranscript':
      return !!(String(args[0] || "").trim() && String(args[1] || "").trim() && (String(args[1]).startsWith(String(args[0])) || String(args[0]).startsWith(String(args[1]))));
    case '_mobileStreamTargetTurn':
      return args[0]?._steerContinuationTurn || args[0];
    case '_findMobileRecoverableAssistantTurn': {
      const thread = args[0];
      const cid = String(args[1] || "").trim();
      if (!cid || !Array.isArray(thread)) return null;
      const matches = thread.filter((turn) => turn?.role === "ai" && String(turn._clientRequestId || "").trim() === cid);
      if (!matches.length) return null;
      return [...matches].reverse().find((turn) => String(turn.messageKind || "").trim() === "steer_continuation" || String(turn.workflowPart || "").trim() === "interruption_response")
        || [...matches].reverse().find((turn) => turn.streaming === true) || null;
    }
    case '_applyVoiceInterruptionToMobileChat':
      return false;
    case '_voiceShortSessionLabel':
      return String(args[0] || __pmVoice?.targetSessionLabel || __pmChat?.activeSessionId || "Mobile Voice").trim() || "Mobile Voice";
    case '_voiceTargetLabel':
      return String(args[0]?.label || args[0]?.name || __pmVoice?.target?.label || "Prometheus").trim() || "Prometheus";
    case '_voiceMainAgentSvg':
      return "";
    case '_renderVoiceAgentTargetPickerHtml':
      return "";
    case '_makeRecognizer':
      return null;
    case '_canUseBrowserRecognition':
      return false;
    case '_startMobileRealtimeAgentSession':
    case '_startMobileCodexVoiceRoomStandbyConnection':
      return Promise.resolve(null);
    case '_trySubmitVoiceAsLiveSteer':
    case '_prepareVoiceAgentHandoff':
    case '_startVoiceAgentNarrationLoop':
      return Promise.resolve(false);
    case '_ttsSpeak':
      return Promise.resolve();
    case '_sendMobileRealtimeAgentFunctionOutput':
      return false;
    default:
      return undefined;
  }
}

function _mobileVoiceRuntimeInvoke(name, args = []) {
  const method = _mobileVoiceRuntimeMethod(name);
  if (method) return method(...args);
  if (!MOBILE_VOICE_RUNTIME_FALLBACK_ONLY.has(name)) void loadMobileVoiceRuntime().catch(() => {});
  return _mobileVoiceRuntimeFallback(name, args);
}

function _sendMobileRealtimeAgentCreateResponseFlag(...args) { return _mobileVoiceRuntimeInvoke('_sendMobileRealtimeAgentCreateResponseFlag', args); }
function _mobileRealtimeCameraRuntimePayload(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeCameraRuntimePayload', args); }
function _sendMobileRealtimeCameraRuntimeUpdate(...args) { return _mobileVoiceRuntimeInvoke('_sendMobileRealtimeCameraRuntimeUpdate', args); }
function _setMobileRealtimeCameraRuntime(...args) { return _mobileVoiceRuntimeInvoke('_setMobileRealtimeCameraRuntime', args); }
function _setMobileRealtimeAgentWakePhrase(...args) { return _mobileVoiceRuntimeInvoke('_setMobileRealtimeAgentWakePhrase', args); }
function _syncMobileRealtimeAgentQuietFromSettings(...args) { return _mobileVoiceRuntimeInvoke('_syncMobileRealtimeAgentQuietFromSettings', args); }
function _requestMobileRealtimeAgentFinalSummary(...args) { return _mobileVoiceRuntimeInvoke('_requestMobileRealtimeAgentFinalSummary', args); }
function _cancelMobileRealtimeAgentResponseForDispatch(...args) { return _mobileVoiceRuntimeInvoke('_cancelMobileRealtimeAgentResponseForDispatch', args); }
function _mobileRealtimeAgentEffectiveSessionId(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentEffectiveSessionId', args); }
function _startMobileRealtimeAgentContextRefreshLoop(...args) { return _mobileVoiceRuntimeInvoke('_startMobileRealtimeAgentContextRefreshLoop', args); }
function _stopMobileRealtimeAgentContextRefreshLoop(...args) { return _mobileVoiceRuntimeInvoke('_stopMobileRealtimeAgentContextRefreshLoop', args); }
function _activateMobileRealtimeAgentQuietMode(...args) { return _mobileVoiceRuntimeInvoke('_activateMobileRealtimeAgentQuietMode', args); }
function _isMobileRealtimeAgentMode(...args) { return _mobileVoiceRuntimeInvoke('_isMobileRealtimeAgentMode', args); }
function _mobileVoiceDeviceTimeContext(...args) { return _mobileVoiceRuntimeInvoke('_mobileVoiceDeviceTimeContext', args); }
function _mobileVoiceTargetPayload(...args) { return _mobileVoiceRuntimeInvoke('_mobileVoiceTargetPayload', args); }
function _currentMobileSubagentVoiceTarget(...args) { return _mobileVoiceRuntimeInvoke('_currentMobileSubagentVoiceTarget', args); }
function _realtimeAgentDataChannelOpen(...args) { return _mobileVoiceRuntimeInvoke('_realtimeAgentDataChannelOpen', args); }
function _clearMobileRealtimeAgentQueuedFinalSummary(...args) { return _mobileVoiceRuntimeInvoke('_clearMobileRealtimeAgentQueuedFinalSummary', args); }
function _persistRealtimeSubagentUserTranscript(...args) { return _mobileVoiceRuntimeInvoke('_persistRealtimeSubagentUserTranscript', args); }
function _startMobileCodexVoiceRoomStandbyConnection(...args) { return _mobileVoiceRuntimeInvoke('_startMobileCodexVoiceRoomStandbyConnection', args); }
function _startMobileRealtimeAgentSession(...args) { return _mobileVoiceRuntimeInvoke('_startMobileRealtimeAgentSession', args); }
function _stopMobileRealtimeAgentSession(...args) { return _mobileVoiceRuntimeInvoke('_stopMobileRealtimeAgentSession', args); }
function _setMobileRealtimeAgentMicEnabled(...args) { return _mobileVoiceRuntimeInvoke('_setMobileRealtimeAgentMicEnabled', args); }
function _tuneMobileRealtimeAudioReceiver(...args) { return _mobileVoiceRuntimeInvoke('_tuneMobileRealtimeAudioReceiver', args); }
function _attachMobileRealtimeOutput(...args) { return _mobileVoiceRuntimeInvoke('_attachMobileRealtimeOutput', args); }
function _mobileXaiVoice(...args) { return _mobileVoiceRuntimeInvoke('_mobileXaiVoice', args); }
function _ensureMobileRealtimeAgentChatTurn(...args) { return _mobileVoiceRuntimeInvoke('_ensureMobileRealtimeAgentChatTurn', args); }
function _ensureMobileRealtimeExchangeId(...args) { return _mobileVoiceRuntimeInvoke('_ensureMobileRealtimeExchangeId', args); }
function _repairMobileRealtimeExchangeOrder(...args) { return _mobileVoiceRuntimeInvoke('_repairMobileRealtimeExchangeOrder', args); }
function _ensureMobileRealtimeAgentTurnOrder(...args) { return _mobileVoiceRuntimeInvoke('_ensureMobileRealtimeAgentTurnOrder', args); }
function _finalizeMobileRealtimeAgentChatTurn(...args) { return _mobileVoiceRuntimeInvoke('_finalizeMobileRealtimeAgentChatTurn', args); }
function _mobileRealtimeActiveAssistantTurn(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeActiveAssistantTurn', args); }
function _isProgressiveMobileRealtimeTranscript(...args) { return _mobileVoiceRuntimeInvoke('_isProgressiveMobileRealtimeTranscript', args); }
function _stopMobileCodexBridgeRealtimeEventPoll(...args) { return _mobileVoiceRuntimeInvoke('_stopMobileCodexBridgeRealtimeEventPoll', args); }
function _startMobileCodexBridgeRealtimeEventPoll(...args) { return _mobileVoiceRuntimeInvoke('_startMobileCodexBridgeRealtimeEventPoll', args); }
function _sendMobileRealtimeAgentFunctionOutput(...args) { return _mobileVoiceRuntimeInvoke('_sendMobileRealtimeAgentFunctionOutput', args); }
function _summarizeMobileXaiVisionImages(...args) { return _mobileVoiceRuntimeInvoke('_summarizeMobileXaiVisionImages', args); }
function _mobileRealtimeAgentPendingFileContext(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentPendingFileContext', args); }
function _consumeMobileRealtimeAgentPendingFiles(...args) { return _mobileVoiceRuntimeInvoke('_consumeMobileRealtimeAgentPendingFiles', args); }
function _stageMobileRealtimeAgentFile(...args) { return _mobileVoiceRuntimeInvoke('_stageMobileRealtimeAgentFile', args); }
function _stageMobileRealtimeAgentImage(...args) { return _mobileVoiceRuntimeInvoke('_stageMobileRealtimeAgentImage', args); }
function _flushMobileRealtimeAgentPendingImages(...args) { return _mobileVoiceRuntimeInvoke('_flushMobileRealtimeAgentPendingImages', args); }
function _awaitMobileRealtimeCameraOperation(...args) { return _mobileVoiceRuntimeInvoke('_awaitMobileRealtimeCameraOperation', args); }
function _stopMobileRealtimeLiveCameraVision(...args) { return _mobileVoiceRuntimeInvoke('_stopMobileRealtimeLiveCameraVision', args); }
function _startMobileRealtimeLiveCameraVision(...args) { return _mobileVoiceRuntimeInvoke('_startMobileRealtimeLiveCameraVision', args); }
function _sendMobileRealtimeAgentCameraSnapshot(...args) { return _mobileVoiceRuntimeInvoke('_sendMobileRealtimeAgentCameraSnapshot', args); }
function _mobileRealtimeAgentPttPress(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentPttPress', args); }
function _mobileRealtimeAgentPttRelease(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentPttRelease', args); }
function _mobileRealtimeAgentEnableAlwaysListening(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentEnableAlwaysListening', args); }
function _mobileRealtimeAgentDisableAlwaysListening(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeAgentDisableAlwaysListening', args); }
function _ttsSpeak(...args) { return _mobileVoiceRuntimeInvoke('_ttsSpeak', args); }
function _ttsStop(...args) { return _mobileVoiceRuntimeInvoke('_ttsStop', args); }
function _deliverSubagentVoiceReplyOnce(...args) { return _mobileVoiceRuntimeInvoke('_deliverSubagentVoiceReplyOnce', args); }
function _captureVoicePlaybackInterrupt(...args) { return _mobileVoiceRuntimeInvoke('_captureVoicePlaybackInterrupt', args); }
function _consumeVoicePlaybackInterruptContext(...args) { return _mobileVoiceRuntimeInvoke('_consumeVoicePlaybackInterruptContext', args); }
function _finalizeVoiceInterruptionForTranscript(...args) { return _mobileVoiceRuntimeInvoke('_finalizeVoiceInterruptionForTranscript', args); }
function _persistMobileThreadSnapshot(...args) { return _mobileVoiceRuntimeInvoke('_persistMobileThreadSnapshot', args); }
function _setMobileSteerContinuationTurn(...args) { return _mobileVoiceRuntimeInvoke('_setMobileSteerContinuationTurn', args); }
function _mobileStreamTargetTurn(...args) { return _mobileVoiceRuntimeInvoke('_mobileStreamTargetTurn', args); }
function _findMobileRecoverableAssistantTurn(...args) { return _mobileVoiceRuntimeInvoke('_findMobileRecoverableAssistantTurn', args); }
function _applyVoiceInterruptionToMobileChat(...args) { return _mobileVoiceRuntimeInvoke('_applyVoiceInterruptionToMobileChat', args); }
function _trySubmitVoiceAsLiveSteer(...args) { return _mobileVoiceRuntimeInvoke('_trySubmitVoiceAsLiveSteer', args); }
function _prepareVoiceAgentHandoff(...args) { return _mobileVoiceRuntimeInvoke('_prepareVoiceAgentHandoff', args); }
function _startVoiceAgentNarrationLoop(...args) { return _mobileVoiceRuntimeInvoke('_startVoiceAgentNarrationLoop', args); }
function _makeRecognizer(...args) { return _mobileVoiceRuntimeInvoke('_makeRecognizer', args); }
function _canUseBrowserRecognition(...args) { return _mobileVoiceRuntimeInvoke('_canUseBrowserRecognition', args); }
function _voiceShortSessionLabel(...args) { return _mobileVoiceRuntimeInvoke('_voiceShortSessionLabel', args); }
function _voiceTargetLabel(...args) { return _mobileVoiceRuntimeInvoke('_voiceTargetLabel', args); }
function _voiceMainAgentSvg(...args) { return _mobileVoiceRuntimeInvoke('_voiceMainAgentSvg', args); }
function _renderVoiceAgentTargetPickerHtml(...args) { return _mobileVoiceRuntimeInvoke('_renderVoiceAgentTargetPickerHtml', args); }
function _mobileRealtimeVoiceOptions(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeVoiceOptions', args); }
function _mobileRealtimeVoice(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeVoice', args); }
function _voicePresetForProviders(...args) { return _mobileVoiceRuntimeInvoke('_voicePresetForProviders', args); }
function _inputProviderForMode(...args) { return _mobileVoiceRuntimeInvoke('_inputProviderForMode', args); }
function _outputProviderForMode(...args) { return _mobileVoiceRuntimeInvoke('_outputProviderForMode', args); }
function _loadVoiceSettings(...args) { return _mobileVoiceRuntimeInvoke('_loadVoiceSettings', args); }
function _saveVoiceSettings(...args) { return _mobileVoiceRuntimeInvoke('_saveVoiceSettings', args); }
function _mobileRealtimeProviderLabel(...args) { return _mobileVoiceRuntimeInvoke('_mobileRealtimeProviderLabel', args); }
function _isMobileCodexV3RealtimeConnection(...args) { return _mobileVoiceRuntimeInvoke('_isMobileCodexV3RealtimeConnection', args); }
function _restartMobileRealtimeAgentForSettings(...args) { return _mobileVoiceRuntimeInvoke('_restartMobileRealtimeAgentForSettings', args); }
function _isMobileRealtimeBootstrapSupersededError(...args) { return _mobileVoiceRuntimeInvoke('_isMobileRealtimeBootstrapSupersededError', args); }
function _applyVoiceSettingsLive(...args) { return _mobileVoiceRuntimeInvoke('_applyVoiceSettingsLive', args); }
function _applyMobileVoiceProviderDefaults(...args) { return _mobileVoiceRuntimeInvoke('_applyMobileVoiceProviderDefaults', args); }
function _normalizeMobileWakePhrase(...args) { return _mobileVoiceRuntimeInvoke('_normalizeMobileWakePhrase', args); }
function _cleanMobileWakePhrase(...args) { return _mobileVoiceRuntimeInvoke('_cleanMobileWakePhrase', args); }
function _parseMobileWakePhraseSettingCommand(...args) { return _mobileVoiceRuntimeInvoke('_parseMobileWakePhraseSettingCommand', args); }
function _isMobileQuietModeCommand(...args) { return _mobileVoiceRuntimeInvoke('_isMobileQuietModeCommand', args); }
function _isMobileWakeUnlockCommand(...args) { return _mobileVoiceRuntimeInvoke('_isMobileWakeUnlockCommand', args); }
function _prewarmMobileVoiceWorkerContext(...args) { return _mobileVoiceRuntimeInvoke('_prewarmMobileVoiceWorkerContext', args); }
function _prewarmMobileCodexRealtimeBridge(...args) { return _mobileVoiceRuntimeInvoke('_prewarmMobileCodexRealtimeBridge', args); }
function _voiceRoomParticipantKey(...args) { return _mobileVoiceRuntimeInvoke('_voiceRoomParticipantKey', args); }
function _voiceRoomParticipantLabel(...args) { return _mobileVoiceRuntimeInvoke('_voiceRoomParticipantLabel', args); }
function _voiceMainRoomParticipant(...args) { return _mobileVoiceRuntimeInvoke('_voiceMainRoomParticipant', args); }
function _voiceSubagentRoomParticipant(...args) { return _mobileVoiceRuntimeInvoke('_voiceSubagentRoomParticipant', args); }
function _normalizeVoiceRoomState(...args) { return _mobileVoiceRuntimeInvoke('_normalizeVoiceRoomState', args); }
function _loadVoiceRoomState(...args) { return _mobileVoiceRuntimeInvoke('_loadVoiceRoomState', args); }
function _saveVoiceRoomState(...args) { return _mobileVoiceRuntimeInvoke('_saveVoiceRoomState', args); }
function _isVoiceRoomEnabled(...args) { return _mobileVoiceRuntimeInvoke('_isVoiceRoomEnabled', args); }
function _voiceRoomActiveParticipant(...args) { return _mobileVoiceRuntimeInvoke('_voiceRoomActiveParticipant', args); }
function _voiceRoomCurrentTargetKey(...args) { return _mobileVoiceRuntimeInvoke('_voiceRoomCurrentTargetKey', args); }
function _exitMobileVoiceRoomForFreshChat(...args) { return _mobileVoiceRuntimeInvoke('_exitMobileVoiceRoomForFreshChat', args); }
function _resolveDurableMobileVoiceRoom(...args) { return _mobileVoiceRuntimeInvoke('_resolveDurableMobileVoiceRoom', args); }
function _loadDurableMobileVoiceRoom(...args) { return _mobileVoiceRuntimeInvoke('_loadDurableMobileVoiceRoom', args); }
function _voiceRoomSetFocus(...args) { return _mobileVoiceRuntimeInvoke('_voiceRoomSetFocus', args); }
function _applyMobileVoiceTarget(...args) { return _mobileVoiceRuntimeInvoke('_applyMobileVoiceTarget', args); }
function _clearMobileCodexVoiceRoomWarmPool(...args) { return _mobileVoiceRuntimeInvoke('_clearMobileCodexVoiceRoomWarmPool', args); }
function _scheduleMobileCodexVoiceRoomPrewarm(...args) { return _mobileVoiceRuntimeInvoke('_scheduleMobileCodexVoiceRoomPrewarm', args); }
function _handoffMobileCodexVoiceRoomTarget(...args) { return _mobileVoiceRuntimeInvoke('_handoffMobileCodexVoiceRoomTarget', args); }
function _routeMobileVoiceRoomTranscript(...args) { return _mobileVoiceRuntimeInvoke('_routeMobileVoiceRoomTranscript', args); }
function _requestMobileVoiceMicFromGesture(...args) { return _mobileVoiceRuntimeInvoke('_requestMobileVoiceMicFromGesture', args); }
function _voiceSetStatus(...args) { return _mobileVoiceRuntimeInvoke('_voiceSetStatus', args); }
function _voiceStatusPreviewText(...args) { return _mobileVoiceRuntimeInvoke('_voiceStatusPreviewText', args); }
function _voiceSetStatusTone(...args) { return _mobileVoiceRuntimeInvoke('_voiceSetStatusTone', args); }
function _promoteMobileRealtimeUserDraft(...args) { return _mobileVoiceRuntimeInvoke('_promoteMobileRealtimeUserDraft', args); }
function _voiceShowRealtimeUserTranscript(...args) { return _mobileVoiceRuntimeInvoke('_voiceShowRealtimeUserTranscript', args); }
function _voiceShowRealtimeAgentMessage(...args) { return _mobileVoiceRuntimeInvoke('_voiceShowRealtimeAgentMessage', args); }
function _appendMobileRealtimeTranscriptDelta(...args) { return _mobileVoiceRuntimeInvoke('_appendMobileRealtimeTranscriptDelta', args); }
function _mobileVoiceToolKey(...args) { return _mobileVoiceRuntimeInvoke('_mobileVoiceToolKey', args); }
function _mobileVoiceToolsAreActive(...args) { return _mobileVoiceRuntimeInvoke('_mobileVoiceToolsAreActive', args); }
function _setMobileVoiceToolActive(...args) { return _mobileVoiceRuntimeInvoke('_setMobileVoiceToolActive', args); }
function _setOrbState(...args) { return _mobileVoiceRuntimeInvoke('_setOrbState', args); }
function _mobileMediaKey(...args) { return _mobileVoiceRuntimeInvoke('_mobileMediaKey', args); }
function _diffMobileMedia(...args) { return _mobileVoiceRuntimeInvoke('_diffMobileMedia', args); }
function _visionEventToMobileMedia(...args) { return _mobileVoiceRuntimeInvoke('_visionEventToMobileMedia', args); }
function _installMobileCameraPinchZoom(...args) { return _mobileVoiceRuntimeInvoke('_installMobileCameraPinchZoom', args); }
function _detectProvider(...args) { return _mobileVoiceRuntimeInvoke('_detectProvider', args); }
function _serverVoiceFallback(...args) { return _mobileVoiceRuntimeInvoke('_serverVoiceFallback', args); }
function _isRealtimeConnected(...args) { return _mobileVoiceRuntimeInvoke('_isRealtimeConnected', args); }
function _loadServerVoiceCatalog(...args) { return _mobileVoiceRuntimeInvoke('_loadServerVoiceCatalog', args); }
function _cleanVoiceSpeechText(...args) { return _mobileVoiceRuntimeInvoke('_cleanVoiceSpeechText', args); }
function _normalizeVoiceEchoText(...args) { return _mobileVoiceRuntimeInvoke('_normalizeVoiceEchoText', args); }
function _isLikelyMobileVoiceSelfEcho(...args) { return _mobileVoiceRuntimeInvoke('_isLikelyMobileVoiceSelfEcho', args); }
function _voiceSpokenMilestone(...args) { return _mobileVoiceRuntimeInvoke('_voiceSpokenMilestone', args); }
function _speakVoiceMilestone(...args) { return _mobileVoiceRuntimeInvoke('_speakVoiceMilestone', args); }
function _voiceLiveToolStatus(...args) { return _mobileVoiceRuntimeInvoke('_voiceLiveToolStatus', args); }
function _speakVoiceLiveStatus(...args) { return _mobileVoiceRuntimeInvoke('_speakVoiceLiveStatus', args); }
function _appendMobileCodexBridgeRealtimeSpeech(...args) { return _mobileVoiceRuntimeInvoke('_appendMobileCodexBridgeRealtimeSpeech', args); }
function _speakMobileRealtimeAgentMilestone(...args) { return _mobileVoiceRuntimeInvoke('_speakMobileRealtimeAgentMilestone', args); }
function _blobToBase64(...args) { return _mobileVoiceRuntimeInvoke('_blobToBase64', args); }
function _isIosSafariBrowser(...args) { return _mobileVoiceRuntimeInvoke('_isIosSafariBrowser', args); }
function _getRecorderMimeType(...args) { return _mobileVoiceRuntimeInvoke('_getRecorderMimeType', args); }
function _audioExtensionForMimeType(...args) { return _mobileVoiceRuntimeInvoke('_audioExtensionForMimeType', args); }
function _voiceDebug(...args) { return _mobileVoiceRuntimeInvoke('_voiceDebug', args); }
function _waitForLocalRealtimeOfferSdp(...args) { return _mobileVoiceRuntimeInvoke('_waitForLocalRealtimeOfferSdp', args); }
function _exchangeRealtimeSdpViaGateway(...args) { return _mobileVoiceRuntimeInvoke('_exchangeRealtimeSdpViaGateway', args); }
function _unlockVoiceAudio(...args) { return _mobileVoiceRuntimeInvoke('_unlockVoiceAudio', args); }
function _closeRealtimeSpeechConnection(...args) { return _mobileVoiceRuntimeInvoke('_closeRealtimeSpeechConnection', args); }
// The orb is shared by the inline voice composer and the standalone Voice
// page. The standalone version adds a particle canvas above this SVG so the
// sphere can feel dimensional without making the button itself heavy.

let mobileVoicePageFeaturePromise = null;

function loadMobileVoicePageFeature() {
  if (!mobileVoicePageFeaturePromise) {
    mobileVoicePageFeaturePromise = import('./mobile-voice-page.js').catch((error) => {
      mobileVoicePageFeaturePromise = null;
      throw error;
    });
  }
  return mobileVoicePageFeaturePromise;
}

const mobileVoicePageContext = Object.freeze(Object.defineProperties({}, {
  "ICONS": { enumerable: true, get: () => ICONS },
  "MOBILE_CHAT_SESSION_ID": { enumerable: true, get: () => MOBILE_CHAT_SESSION_ID },
  "PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE": { enumerable: true, get: () => PM_MOBILE_CHAT_MESSAGE_PAGE_SIZE },
  "VOICE_PREVIEW_DRAG_START_PX": { enumerable: true, get: () => VOICE_PREVIEW_DRAG_START_PX },
  "__pmChat": { enumerable: true, get: () => __pmChat },
  "__pmRealtimeAgent": { enumerable: true, get: () => __pmRealtimeAgent },
  "__pmVoice": { enumerable: true, get: () => __pmVoice },
  "appendMobileVoiceRoomTranscript": { enumerable: true, get: () => appendMobileVoiceRoomTranscript },
  "_appendMobileLiveTrace": { enumerable: true, get: () => _appendMobileLiveTrace },
  "_appendMobilePrimaryWorkerProcess": { enumerable: true, get: () => _appendMobilePrimaryWorkerProcess },
  "_appendMobileProcess": { enumerable: true, get: () => _appendMobileProcess },
  "_appendMobileUserProcess": { enumerable: true, get: () => _appendMobileUserProcess },
  "_applyMobileAgentStreamEvent": { enumerable: true, get: () => _applyMobileAgentStreamEvent },
  "_applyMobileToolActivity": { enumerable: true, get: () => _applyMobileToolActivity },
  "_clearMobileActiveRun": { enumerable: true, get: () => _clearMobileActiveRun },
  "_collectMediaFromToolEvent": { enumerable: true, get: () => _collectMediaFromToolEvent },
  "_collectMessageMedia": { enumerable: true, get: () => _collectMessageMedia },
  "_deliveryNotificationToMobileMedia": { enumerable: true, get: () => _deliveryNotificationToMobileMedia },
  "_drawAgentSVG": { enumerable: true, get: () => _drawAgentSVG },
  "_ensureDurableMobileVoiceSession": { enumerable: true, get: () => _ensureDurableMobileVoiceSession },
  "_findLatestAssistantTurn": { enumerable: true, get: () => _findLatestAssistantTurn },
  "_flushMobilePendingThinkingBurst": { enumerable: true, get: () => _flushMobilePendingThinkingBurst },
  "_formatBytes": { enumerable: true, get: () => _formatBytes },
  "_handleMobileCleanThought": { enumerable: true, get: () => _handleMobileCleanThought },
  "_handleMobileThinkingCallback": { enumerable: true, get: () => _handleMobileThinkingCallback },
  "_isMobileNewChatDraftActiveForVoice": { enumerable: true, get: () => _isMobileNewChatDraftActiveForVoice },
  "_markMobileSessionRunning": { enumerable: true, get: () => _markMobileSessionRunning },
  "_mergeMobileMediaIntoMessage": { enumerable: true, get: () => _mergeMobileMediaIntoMessage },
  "_mergeMobileSessionThreadWithLocal": { enumerable: true, get: () => _mergeMobileSessionThreadWithLocal },
  "_mobileAssistantWorkStartedAt": { enumerable: true, get: () => _mobileAssistantWorkStartedAt },
  "_mobileHistoryForServer": { enumerable: true, get: () => _mobileHistoryForServer },
  "_mapServerMessageToMobile": { enumerable: true, get: () => _mapServerMessageToMobile },
  "_mobileMediaKind": { enumerable: true, get: () => _mobileMediaKind },
  "_mobileToolLabel": { enumerable: true, get: () => _mobileToolLabel },
  "_mobileToolResultLabel": { enumerable: true, get: () => _mobileToolResultLabel },
  "_mobileWorkerStatusLabel": { enumerable: true, get: () => _mobileWorkerStatusLabel },
  "_moveMobileVisibleAnswerIntoWorkflowTrace": { enumerable: true, get: () => _moveMobileVisibleAnswerIntoWorkflowTrace },
  "_newMobileClientRequestId": { enumerable: true, get: () => _newMobileClientRequestId },
  "_normalizeMobileApproval": { enumerable: true, get: () => _normalizeMobileApproval },
  "_normalizeMobileFile": { enumerable: true, get: () => _normalizeMobileFile },
  "_normalizeMobileMediaList": { enumerable: true, get: () => _normalizeMobileMediaList },
  "_normalizeMobileVoiceWorkgroup": { enumerable: true, get: () => _normalizeMobileVoiceWorkgroup },
  "_notifyMobileChatVoiceUpdate": { enumerable: true, get: () => _notifyMobileChatVoiceUpdate },
  "_notifyMobileVoiceAgentConnection": { enumerable: true, get: () => _notifyMobileVoiceAgentConnection },
  "_markMobileRealtimeAgentBackendReady": { enumerable: true, get: () => _markMobileRealtimeAgentBackendReady },
  "_nowTime": { enumerable: true, get: () => _nowTime },
  "_pmApprovalCanSave": { enumerable: true, get: () => _pmApprovalCanSave },
  "_pmApprovalTechnicalText": { enumerable: true, get: () => _pmApprovalTechnicalText },
  "_pmHasProcessRun": { enumerable: true, get: () => _pmHasProcessRun },
  "_pmHumanApproval": { enumerable: true, get: () => _pmHumanApproval },
  "_pmIsCommandApproval": { enumerable: true, get: () => _pmIsCommandApproval },
  "_pmLoadApprovalProcessRun": { enumerable: true, get: () => _pmLoadApprovalProcessRun },
  "_readMobileActiveRun": { enumerable: true, get: () => _readMobileActiveRun },
  "_recordMobileChatError": { enumerable: true, get: () => _recordMobileChatError },
  "_rebindMobileCodexBridgeOwnerSession": { enumerable: true, get: () => _rebindMobileCodexBridgeOwnerSession },
  "_rememberMobileActiveRun": { enumerable: true, get: () => _rememberMobileActiveRun },
  "_rememberMobileLastChatSession": { enumerable: true, get: () => _rememberMobileLastChatSession },
  "_renderAgentVoicePicker": { enumerable: true, get: () => _renderAgentVoicePicker },
  "_renderMobileMediaGallery": { enumerable: true, get: () => _renderMobileMediaGallery },
  "_renderMobileChatSessionNow": { enumerable: true, get: () => _renderMobileChatSessionNow },
  "_renderMobileRichArtifacts": { enumerable: true, get: () => _renderMobileRichArtifacts },
  "_restoreMobileVoiceWorkgroupsForSession": { enumerable: true, get: () => _restoreMobileVoiceWorkgroupsForSession },
  "_restoreTemporaryMobileSubagentVoiceProfile": { enumerable: true, get: () => _restoreTemporaryMobileSubagentVoiceProfile },
  "_safeJsonPreview": { enumerable: true, get: () => _safeJsonPreview },
  "_setTemporaryMobileSubagentVoiceProfile": { enumerable: true, get: () => _setTemporaryMobileSubagentVoiceProfile },
  "_startMobileNewVoiceDraft": { enumerable: true, get: () => _startMobileNewVoiceDraft },
  "_updateMobilePrimaryWorkgroupLink": { enumerable: true, get: () => _updateMobilePrimaryWorkgroupLink },
  "_uploadMobileChatAttachments": { enumerable: true, get: () => _uploadMobileChatAttachments },
  "_upsertMobileVoiceWorkgroup": { enumerable: true, get: () => _upsertMobileVoiceWorkgroup },
  "_voiceAgentProcessEntriesFromResult": { enumerable: true, get: () => _voiceAgentProcessEntriesFromResult },
  "_wireMobileMediaCards": { enumerable: true, get: () => _wireMobileMediaCards },
  "_wireMobileProcessRunActions": { enumerable: true, get: () => _wireMobileProcessRunActions },
  "agentVoicePickerHydrate": { enumerable: true, get: () => agentVoicePickerHydrate },
  "approveMobileApproval": { enumerable: true, get: () => approveMobileApproval },
  "attachMobileButtonHaptic": { enumerable: true, get: () => attachMobileButtonHaptic },
  "attachMobileHapticGestureSurface": { enumerable: true, get: () => attachMobileHapticGestureSurface },
  "bindMobileSessionTarget": { enumerable: true, get: () => bindMobileSessionTarget },
  "buildMobileGatewayWsUrl": { enumerable: true, get: () => buildMobileGatewayWsUrl },
  "createVoiceInterruptionEvent": { enumerable: true, get: () => createVoiceInterruptionEvent },
  "denyMobileApproval": { enumerable: true, get: () => denyMobileApproval },
  "escapeHtml": { enumerable: true, get: () => escapeHtml },
  "getVoicePreviewDragStyle": { enumerable: true, get: () => getVoicePreviewDragStyle },
  "getVoicePreviewGestureOutcome": { enumerable: true, get: () => getVoicePreviewGestureOutcome },
  "getDeviceToken": { enumerable: true, get: () => getDeviceToken },
  "invalidateMobileDrawerSessions": { enumerable: true, get: () => invalidateMobileDrawerSessions },
  "isCurrentGateway": { enumerable: true, get: () => isCurrentGateway },
  "loadMobileApprovals": { enumerable: true, get: () => loadMobileApprovals },
  "loadMobileChatSession": { enumerable: true, get: () => loadMobileChatSession },
  "loadMobileChatRunStatus": { enumerable: true, get: () => loadMobileChatRunStatus },
  "loadMobileSubagentDetail": { enumerable: true, get: () => loadMobileSubagentDetail },
  "loadMobileSubagents": { enumerable: true, get: () => loadMobileSubagents },
  "loadVoiceStatus": { enumerable: true, get: () => loadVoiceStatus },
  "mobileChatRuntimeAdapter": { enumerable: true, get: () => mobileChatRuntimeAdapter },
  "mobileGatewayFetch": { enumerable: true, get: () => mobileGatewayFetch },
  "mobileGatewayTextFetch": { enumerable: true, get: () => mobileGatewayTextFetch },
  "updateMobileChatSessionHistory": { enumerable: true, get: () => updateMobileChatSessionHistory },
  "mountThinkingOrbWhenReady": { enumerable: true, get: () => mountThinkingOrbWhenReady },
  "notifyMobileModelChanged": { enumerable: true, get: () => notifyMobileModelChanged },
  "openDrawer": { enumerable: true, get: () => openDrawer },
  "parseTargetNamespacedId": { enumerable: true, get: () => parseTargetNamespacedId },
  "pmHaptic": { enumerable: true, get: () => pmHaptic },
  "pmToast": { enumerable: true, get: () => pmToast },
  "probeGateway": { enumerable: true, get: () => probeGateway },
  "refreshMobileDrawerSessions": { enumerable: true, get: () => refreshMobileDrawerSessions },
  "registerAgentVoicePickerOnSaved": { enumerable: true, get: () => registerAgentVoicePickerOnSaved },
  "renderMobileHeader": { enumerable: true, get: () => renderMobileHeader },
  "resolveMobileSessionGateway": { enumerable: true, get: () => resolveMobileSessionGateway },
  "resolveMobileVoiceRoom": { enumerable: true, get: () => resolveMobileVoiceRoom },
  "setMobileActiveGatewayTarget": { enumerable: true, get: () => setMobileActiveGatewayTarget },
  "stopMobileMainChat": { enumerable: true, get: () => stopMobileMainChat },
  "streamChat": { enumerable: true, get: () => streamChat },
  "streamVoiceAgentInputMobile": { enumerable: true, get: () => streamVoiceAgentInputMobile },
  "streamSubagentChat": { enumerable: true, get: () => streamSubagentChat },
  "transcribeVoiceAudio": { enumerable: true, get: () => transcribeVoiceAudio },
  "window": { enumerable: true, get: () => window },
  "wireHeaderActions": { enumerable: true, get: () => wireHeaderActions },
  "wsEventBus": { enumerable: true, get: () => wsEventBus },
}));
function loadMobileVoiceRuntime() {
  const existing = _mobileVoiceRuntimeGlobal();
  if (existing) {
    mobileVoiceRuntime = existing;
    return Promise.resolve(existing);
  }
  if (!mobileVoiceRuntimePromise) {
    mobileVoiceRuntimePromise = import('./mobile-voice-runtime.js')
      .then(({ createMobileVoiceRuntime }) => {
        mobileVoiceRuntime = createMobileVoiceRuntime(mobileVoicePageContext);
        return mobileVoiceRuntime;
      })
      .catch((error) => {
        mobileVoiceRuntimePromise = null;
        throw error;
      });
  }
  return mobileVoiceRuntimePromise;
}
export async function renderVoicePage(page, ctx) {
  const feature = await loadMobileVoicePageFeature();
  return feature.renderVoicePage(mobileVoicePageContext, page, ctx);
}






function _mobileVoiceSettingsFromAgentProfile(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const provider = String(p.provider || '').trim();
  const voice = String(p.voice || '').trim();
  if (provider === 'openai_codex' || provider === 'openai_realtime') {
    return {
      voiceMode: 'openai_realtime',
      sttProvider: 'openai_realtime',
      ttsProvider: 'openai_realtime',
      realtimeVoice: voice || undefined,
      sttProviderLocked: true,
      autoProviderDefault: '',
      voiceAgentRealtimeAgent: true,
    };
  }
  if (provider === 'xai') {
    return {
      voiceMode: 'xai',
      sttProvider: 'xai',
      ttsProvider: 'xai',
      serverVoice: voice || undefined,
      sttProviderLocked: true,
      autoProviderDefault: '',
      voiceAgentXaiRealtime: true,
    };
  }
  if (provider === 'openai') {
    return {
      voiceMode: 'custom',
      sttProvider: 'browser',
      ttsProvider: 'openai',
      serverVoice: voice || undefined,
      sttProviderLocked: true,
      autoProviderDefault: '',
    };
  }
  if (provider === 'browser') {
    return {
      voiceMode: 'default',
      sttProvider: 'browser',
      ttsProvider: 'browser',
      sttProviderLocked: true,
      autoProviderDefault: '',
    };
  }
  return null;
}

function _applyTemporaryMobileSubagentVoiceProfile(profile = null, options = {}) {
  const overrides = _mobileVoiceSettingsFromAgentProfile(profile || {});
  if (!overrides) return null;
  const applyLive = options?.applyLive !== false;
  const shouldApplyLive = () => applyLive && __pmVoice?.suppressTemporaryVoiceLiveApply !== true;
  const previous = { ...(__pmVoice.settings || {}) };
  const cleanOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  __pmVoice.settings = { ...previous, ...cleanOverrides };
  __pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';
  if (shouldApplyLive()) {
    try { _applyVoiceSettingsLive(previous, __pmVoice.settings || {}, cleanOverrides); } catch {}
  }
  return () => {
    const current = { ...(__pmVoice.settings || {}) };
    __pmVoice.settings = previous;
    __pmVoice.dictation = __pmVoice.settings.dictation || __pmVoice.dictation || 'quiet';
    if (shouldApplyLive()) {
      try { _applyVoiceSettingsLive(current, previous, previous); } catch {}
    }
  };
}

function _restoreTemporaryMobileSubagentVoiceProfile(options = {}) {
  const suppressLive = options?.applyLive === false;
  const previousSuppress = __pmVoice?.suppressTemporaryVoiceLiveApply === true;
  if (suppressLive) __pmVoice.suppressTemporaryVoiceLiveApply = true;
  try { __pmVoice.subagentVoiceRestore?.(); } catch {}
  finally {
    __pmVoice.subagentVoiceRestore = null;
    if (suppressLive) __pmVoice.suppressTemporaryVoiceLiveApply = previousSuppress;
  }
}

function _setTemporaryMobileSubagentVoiceProfile(profile = null, options = {}) {
  _restoreTemporaryMobileSubagentVoiceProfile({ applyLive: options?.applyLive });
  __pmVoice.subagentVoiceRestore = _applyTemporaryMobileSubagentVoiceProfile(profile, options);
  return __pmVoice.subagentVoiceRestore;
}





function _pmApprovalToolLabel(tool = '') {
  const name = String(tool || '').trim();
  if (name === 'desktop_click') return 'Desktop click';
  if (name === 'desktop_press_key') return 'Desktop keypress';
  if (name === 'browser_click') return 'Browser click';
  if (name === 'browser_press_key' || name === 'browser_key') return 'Browser keypress';
  if (name === 'run_command') return 'Command';
  return name ? name.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Action';
}

function _pmHumanApproval(approval = {}) {
  const tool = String(approval?.toolName || '').trim();
  const kind = String(approval?.approvalKind || '').trim();
  const args = approval?.toolArgs && typeof approval.toolArgs === 'object' ? approval.toolArgs : {};
  const finalAction = approval?.finalAction || null;
  const isDevSource = kind === 'dev_source_edit' || tool === 'request_dev_source_edit';
  const isDevApply = kind === 'dev_apply_live' || tool === 'prom_apply_dev_changes';
  const isFinalAction = kind === 'final_action' || tool === 'request_final_action_approval';
  if (isFinalAction) {
    const actionKind = String(finalAction?.actionKind || args.action_kind || 'continue').trim();
    const target = String(finalAction?.targetLabel || args.target_label || 'final action').trim();
    return {
      title: 'Final action approval',
      summary: String(finalAction?.summary || approval?.reason || `Ready to ${actionKind}.`).trim(),
      detail: target,
    };
  }
  if (isDevSource) {
    const files = Array.isArray(approval?.devSourceEdit?.allowedFiles) ? approval.devSourceEdit.allowedFiles : [];
    return {
      title: 'Dev source edit approval',
      summary: String(approval?.reason || 'Approve scoped source edits for this session.').trim(),
      detail: files.length ? `${files.length} file${files.length === 1 ? '' : 's'} requested` : '',
    };
  }
  if (isDevApply) {
    const apply = approval?.devApplyLive || {};
    const files = Array.isArray(apply.files) ? apply.files : [];
    const members = Array.isArray(apply.memberIds) ? apply.memberIds : [];
    return {
      title: 'Apply verified dev changes live',
      summary: 'Restart/reload Prometheus for the verified changes.',
      detail: `${members.length || 1} edit${members.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} · auto-rejects in 30 minutes`,
    };
  }
  if (kind === 'path_access') {
    const p = String(approval?.pathAccess?.requestedPath || args.path || '').trim();
    return {
      title: 'Path access',
      summary: 'Prometheus needs to access a directory outside the workspace.',
      detail: p,
    };
  }
  if (kind === 'elevated_command') {
    return {
      title: 'Administrator command',
      summary: 'Run this exact command with Windows administrator privileges after your one-shot approval.',
      detail: String(args.command || '').trim(),
    };
  }
  if (tool === 'run_command' || tool === 'shell' || tool === 'run_command_supervised' || tool === 'start_process') {
    const boundary = approval?.commandBoundary || null;
    const scope = String(boundary?.scope || '').trim();
    return {
      title: scope && scope !== 'workspace' ? 'Outside-workspace command' : 'Command approval',
      summary: scope && scope !== 'workspace' ? `May change ${scope.replace(/_/g, ' ')} state.` : (args.cwd ? `Run command in ${args.cwd}` : 'Run command'),
      detail: String(args.command || '').trim(),
    };
  }
  if (tool.startsWith('desktop_')) {
    const windowLabel = String(args.window_name || '').trim();
    const target = args.element != null
      ? `Element ${args.element}`
      : Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
        ? `Point ${Number(args.x)}, ${Number(args.y)}`
        : '';
    return {
      title: 'Desktop action',
      summary: `${_pmApprovalToolLabel(tool)}${windowLabel ? ` in ${windowLabel}` : ''}.`,
      detail: target,
    };
  }
  if (tool.startsWith('browser_')) {
    const target = String(args.element || args.selector || (args.ref != null ? `ref ${args.ref}` : '')).trim();
    return {
      title: 'Browser action',
      summary: _pmApprovalToolLabel(tool),
      detail: target,
    };
  }
  return {
    title: _pmApprovalTitle(approval),
    summary: String(approval?.reason || approval?.action || approval?.summary || '').trim(),
    detail: '',
  };
}

function _pmApprovalTechnicalText(approval = {}) {
  const args = approval?.toolArgs && typeof approval.toolArgs === 'object' ? approval.toolArgs : {};
  const parts = [];
  const reason = String(approval?.reason || '').trim();
  const action = String(approval?.action || '').trim();
  if (reason) parts.push(`Reason: ${reason}`);
  if (action) parts.push(`Action: ${action}`);
  if (Object.keys(args).length) {
    try { parts.push(JSON.stringify(args, null, 2)); }
    catch { parts.push(String(args)); }
  }
  return parts.join('\n\n').trim();
}

function _pmApprovalTitle(approval) {
  const tool = String(approval?.toolName || '').trim();
  if (approval?.approvalKind === 'elevated_command') return 'Administrator command';
  if (approval?.approvalKind === 'dev_source_edit' || tool === 'request_dev_source_edit') return 'Dev source edit approval';
  if (approval?.approvalKind === 'dev_apply_live' || tool === 'prom_apply_dev_changes') return 'Apply verified dev changes live';
  if (approval?.approvalKind === 'final_action' || tool === 'request_final_action_approval') return 'Final action approval';
  if (tool === 'run_command') return 'Command approval';
  if (tool.startsWith('desktop_')) return 'Desktop action';
  if (tool.startsWith('browser_')) return 'Browser action';
  return 'Tool approval';
}

function _pmIsCommandApproval(approval = {}) {
  const tool = String(approval?.toolName || '').trim();
  const kind = String(approval?.approvalKind || '').trim();
  return kind === 'path_access' || kind === 'command' || kind === 'elevated_command'
    || tool === 'run_command' || tool === 'shell'
    || tool === 'run_command_supervised' || tool === 'start_process';
}

function _pmFormatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0ms';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}s`;
  const minutes = Math.floor(n / 60000);
  const seconds = Math.round((n % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function _pmProcessRunText(run = {}, log = null, tab = 'combined') {
  const fromLog = log && typeof log === 'object' ? log : null;
  if (tab === 'stdout') return String(fromLog?.stdout ?? run.stdoutTail ?? run.stdout ?? '');
  if (tab === 'stderr') return String(fromLog?.stderr ?? run.stderrTail ?? run.stderr ?? '');
  return String(fromLog?.combined ?? run.outputTail ?? [run.stdoutTail, run.stderrTail].filter(Boolean).join('\n') ?? '');
}

function _pmCssEscape(value) {
  const raw = String(value || '');
  try {
    if (window.CSS?.escape) return window.CSS.escape(raw);
  } catch {}
  return raw.replace(/["\\\]]/g, '\\$&');
}

function _pmRenderProcessRunCard(run = {}, { log = null, tab = 'combined' } = {}) {
  const id = String(run.runId || run.id || '').trim();
  if (!id) return '';
  const status = String(run.state || run.status || 'unknown').toLowerCase();
  const shell = [run.shell || 'auto', run.pty ? 'pty' : 'pipe'].filter(Boolean).join(' / ');
  const duration = run.durationMs != null ? _pmFormatDuration(run.durationMs) : (run.startedAt ? 'running' : '0ms');
  const exit = run.exitCode == null ? 'pending' : String(run.exitCode);
  const waiting = run.waitingForInputHint ? 'Waiting for input' : '';
  const output = _pmProcessRunText(run, log, tab);
  const compactOutput = output ? output.slice(-5000) : 'No output yet.';
  const meta = [
    ['cwd', run.cwd || 'workspace'],
    ['shell', shell],
    ['status', status],
    ['duration', duration],
    ['exit', exit],
  ];
  return `<section class="pm-process-card" data-pm-process-run="${escapeHtml(id)}" data-pm-process-tab="${escapeHtml(tab)}">
    <div class="pm-process-head">
      <div>
        <span>Command run</span>
        <strong>${escapeHtml(run.title || run.command || id)}</strong>
      </div>
      <b class="pm-process-pill ${escapeHtml(status)}">${escapeHtml(status)}</b>
    </div>
    <div class="pm-process-meta">${meta.map(([k, v]) => `<span><b>${escapeHtml(k)}</b>${escapeHtml(String(v))}</span>`).join('')}</div>
    ${waiting ? `<div class="pm-process-hint">${escapeHtml(waiting)}</div>` : ''}
    ${run.completionSummary ? `<div class="pm-process-summary">${escapeHtml(String(run.completionSummary))}</div>` : ''}
    ${run.failureSummary ? `<div class="pm-process-summary failure">${escapeHtml(String(run.failureSummary))}</div>` : ''}
    <div class="pm-process-terminal">
      <div class="pm-process-terminal-bar"><span>Ran command</span><span class="pm-process-live-state">${status === 'exited' ? 'completed' : 'streaming'}</span></div>
      <pre class="pm-process-command"><span>$</span> ${escapeHtml(run.command || '')}</pre>
      <pre class="pm-process-log" data-pm-process-output="${escapeHtml(id)}">${escapeHtml(compactOutput)}</pre>
    </div>
    <div class="pm-process-tabs" role="tablist">
      ${['combined', 'stdout', 'stderr'].map((name) => `<button type="button" class="${tab === name ? 'active' : ''}" data-pm-process-action="tab" data-tab="${name}" data-run-id="${escapeHtml(id)}">${name}</button>`).join('')}
    </div>
    <div class="pm-process-actions">
      <button type="button" data-pm-process-action="refresh" data-run-id="${escapeHtml(id)}">Live tail</button>
      <button type="button" data-pm-process-action="copy" data-run-id="${escapeHtml(id)}">Copy output</button>
      <button type="button" data-pm-process-action="full-log" data-run-id="${escapeHtml(id)}">Open full log</button>
      <button type="button" data-pm-process-action="rerun" data-run-id="${escapeHtml(id)}">Rerun</button>
      <button type="button" data-pm-process-action="kill" data-run-id="${escapeHtml(id)}" ${status === 'running' ? '' : 'disabled'}>Kill</button>
    </div>
    <div class="pm-process-input">
      <input type="text" placeholder="Send input" data-pm-process-input="${escapeHtml(id)}" ${run.stdinOpen === false ? 'disabled' : ''}>
      <button type="button" data-pm-process-action="send-input" data-run-id="${escapeHtml(id)}" ${run.stdinOpen === false ? 'disabled' : ''}>Send</button>
    </div>
  </section>`;
}

function _pmProcessLogSnapshot(root) {
  const log = root?.querySelector?.('.pm-process-log');
  if (!log) return null;
  return {
    scrollTop: log.scrollTop || 0,
    distanceFromBottom: Math.max(0, log.scrollHeight - log.scrollTop - log.clientHeight),
    nearBottom: (log.scrollHeight - log.scrollTop - log.clientHeight) < 48,
  };
}

function _pmRestoreProcessLogSnapshot(root, snapshot) {
  const log = root?.querySelector?.('.pm-process-log');
  if (!log || !snapshot) return;
  const apply = () => {
    if (snapshot.nearBottom) log.scrollTop = log.scrollHeight;
    else log.scrollTop = Math.max(0, log.scrollHeight - log.clientHeight - Number(snapshot.distanceFromBottom || 0));
  };
  apply();
  requestAnimationFrame(apply);
}

function _pmRenderCommandRunLink(approval = {}) {
  if (!_pmHasProcessRun(approval) || !approval.id) return '';
  return `<div class="pm-process-approval-link">
    <button type="button" data-pm-process-action="load-approval" data-approval-id="${escapeHtml(approval.id)}">Open terminal</button>
    <div class="pm-process-approval-host" data-process-approval-host="${escapeHtml(approval.id)}"></div>
  </div>`;
}

async function _pmLoadApprovalProcessRun(approvalId, host) {
  if (!approvalId || !host) return;
  const toggle = host.parentElement?.querySelector?.('[data-pm-process-action="load-approval"]');
  const scrollSnapshot = _pmProcessLogSnapshot(host);
  host.dataset.terminalOpen = '1';
  if (toggle) toggle.textContent = 'Close terminal';
  if (!host.querySelector('.pm-process-card')) host.innerHTML = '<div class="pm-process-loading">Loading command run...</div>';
  try {
    let run = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const runs = await loadMobileProcessRuns(100);
      run = runs.find((item) => String(item?.approvalId || '') === String(approvalId))
        || runs.find((item) => String(item?.runId || '') === String(approvalId));
      if (run) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!run) {
      host.innerHTML = '<div class="pm-process-loading">No command run has been recorded for this approval yet.</div>';
      return;
    }
    const log = await loadMobileProcessRunLog(run.runId, 200000).catch(() => null);
    host.innerHTML = _pmRenderProcessRunCard(run, { log });
    _wireMobileProcessRunActions(host);
    _pmRestoreProcessLogSnapshot(host, scrollSnapshot);
  } catch (err) {
    host.innerHTML = `<div class="pm-process-loading error">${escapeHtml(err.message || 'Could not load command run')}</div>`;
  }
}

async function _pmRefreshMobileProcessCard(card, tab = '') {
  const runId = String(card?.getAttribute?.('data-pm-process-run') || '').trim();
  if (!runId) return;
  const activeTab = tab || card.getAttribute('data-pm-process-tab') || 'combined';
  const host = card.parentElement;
  const scrollSnapshot = _pmProcessLogSnapshot(card);
  try {
    const [runs, log] = await Promise.all([
      loadMobileProcessRuns(100),
      loadMobileProcessRunLog(runId, 200000).catch(() => null),
    ]);
    const run = runs.find((item) => String(item?.runId || '') === runId) || { runId };
    if (host) {
      host.innerHTML = _pmRenderProcessRunCard(run, { log, tab: activeTab });
      _wireMobileProcessRunActions(host);
      _pmRestoreProcessLogSnapshot(host, scrollSnapshot);
    }
  } catch (err) {
    pmToast(err.message || 'Could not refresh command run', 'error');
  }
}

function _wireMobileProcessRunActions(root = document) {
  root.querySelectorAll?.('[data-pm-process-action]')?.forEach((btn) => {
    if (btn.dataset.pmProcessWired === '1') return;
    btn.dataset.pmProcessWired = '1';
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = btn.getAttribute('data-pm-process-action') || '';
      const runId = btn.getAttribute('data-run-id') || '';
      const card = btn.closest('.pm-process-card');
      try {
        if (action === 'load-approval') {
          const approvalId = btn.getAttribute('data-approval-id') || '';
          const host = btn.parentElement?.querySelector(`[data-process-approval-host="${_pmCssEscape(approvalId)}"]`);
          if (host?.dataset.terminalOpen === '1') {
            host.innerHTML = '';
            host.dataset.terminalOpen = '0';
            btn.textContent = 'Open terminal';
            return;
          }
          await _pmLoadApprovalProcessRun(approvalId, host);
          _wireMobileProcessRunActions(host || root);
        } else if (action === 'tab') {
          await _pmRefreshMobileProcessCard(card, btn.getAttribute('data-tab') || 'combined');
        } else if (action === 'refresh' || action === 'full-log') {
          await _pmRefreshMobileProcessCard(card, card?.getAttribute('data-pm-process-tab') || 'combined');
          if (action === 'full-log') pmToast('Full log loaded', 'success');
        } else if (action === 'copy') {
          const text = card?.querySelector('.pm-process-log')?.textContent || '';
          await navigator.clipboard?.writeText(text);
          pmToast('Output copied', 'success');
        } else if (action === 'rerun') {
          btn.disabled = true;
          const r = await rerunMobileProcessRun(runId);
          const host = card?.parentElement;
          if (host && r?.run) {
            host.innerHTML = _pmRenderProcessRunCard(r.run);
            _wireMobileProcessRunActions(host);
          }
          pmToast('Command rerun started', 'success');
        } else if (action === 'kill') {
          btn.disabled = true;
          await killMobileProcessRun(runId);
          await _pmRefreshMobileProcessCard(card);
          pmToast('Kill sent', 'success');
        } else if (action === 'send-input') {
          const input = card?.querySelector(`[data-pm-process-input="${_pmCssEscape(runId)}"]`);
          const value = input?.value || '';
          if (!value) return;
          await submitMobileProcessInput(runId, value);
          input.value = '';
          pmToast('Input sent', 'success');
        }
      } catch (err) {
        btn.disabled = false;
        pmToast(err.message || 'Command action failed', 'error');
      }
    });
  });
}

function _pmRenderTaskJournal(journal) {
  const entries = Array.isArray(journal) ? journal.slice().reverse() : [];
  if (!entries.length) return `<div class="pm-card-body">No process log entries yet.</div>`;
  return `<div class="pm-task-journal" data-pm-task-journal>${entries.map(entry => {
    const time = entry?.t ? _formatChatTime(entry.t) : '';
    const type = String(entry?.type || 'event');
    const content = String(entry?.content || entry?.detail || '').trim();
    const color = type === 'error' ? '#d8473a' : type === 'tool_call' ? '#0d4faf' : type === 'tool_result' ? '#2f7d44' : type === 'reasoning' ? '#6d2d9e' : type === 'pause' ? '#7c4d00' : 'var(--pm-muted)';
    const typeClass = type.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    return `<div class="pm-task-journal-row type-${escapeHtml(typeClass)}" style="display:grid;grid-template-columns:54px 82px 1fr;gap:6px;padding:7px 8px;border-bottom:1px solid var(--pm-border);">
      <span style="color:var(--pm-muted);">${escapeHtml(time)}</span>
      <span style="color:${color};font-weight:800;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(type)}</span>
      <span style="white-space:pre-wrap;word-break:break-word;color:var(--pm-text-soft);">${escapeHtml(content)}</span>
    </div>`;
  }).join('')}</div>`;
}

const SUBAGENT_AGENT_COLORS = ['#4c8dff','#31b884','#d6a64f','#e05c5c','#a78bfa','#38bdf8','#fb923c','#4ade80'];

function _subagentHash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

function _subagentColor(id) {
  return SUBAGENT_AGENT_COLORS[_subagentHash(id) % SUBAGENT_AGENT_COLORS.length];
}

function _drawAgentSVG(agentId, { isActive = false, scale = 1 } = {}) {
  const color = _subagentColor(agentId);
  const h = _subagentHash(agentId);
  const eyeStyle = h % 3;
  const antenna  = !!(h % 2);
  const glow = isActive ? 'rgba(76,141,255,0.55)' : 'none';
  const W = 80, H = 90;

  const eyesHtml = eyeStyle === 1
    ? `<rect x="20" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="48" y="34" width="12" height="10" rx="1" fill="#fff" opacity="0.9"/>
       <rect x="23" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>
       <rect x="51" y="37" width="6" height="4" rx="1" fill="${color}" opacity="0.8"/>`
    : eyeStyle === 2
    ? `<rect x="18" y="32" width="44" height="14" rx="4" fill="rgba(0,0,0,0.4)"/>
       <rect x="22" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>
       <rect x="44" y="35" width="14" height="8" rx="2" fill="#7df" opacity="0.85"/>`
    : `<circle cx="28" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="52" cy="38" r="7" fill="#fff" opacity="0.9"/>
       <circle cx="28" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="52" cy="38" r="4" fill="${color}" opacity="0.8"/>
       <circle cx="29" cy="37" r="1.5" fill="#fff"/>
       <circle cx="53" cy="37" r="1.5" fill="#fff"/>`;

  const mouthY = 52;
  const mouthHtml = h % 4 === 0
    ? `<path d="M26 ${mouthY} Q40 ${mouthY+8} 54 ${mouthY}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`
    : h % 4 === 1
    ? `<rect x="26" y="${mouthY}" width="28" height="5" rx="2" fill="rgba(0,0,0,0.3)"/>
       <rect x="28" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="34" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="40" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>
       <rect x="46" y="${mouthY+1}" width="4" height="3" rx="1" fill="#fff" opacity="0.6"/>`
    : `<line x1="26" y1="${mouthY+2}" x2="54" y2="${mouthY+2}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="${W*scale}" height="${H*scale}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;filter:${glow !== 'none' ? `drop-shadow(0 0 9px ${glow})` : 'none'};transition:filter 0.2s">
    <ellipse cx="40" cy="${H-4}" rx="28" ry="4" fill="rgba(0,0,0,0.12)"/>
    <rect x="20" y="62" width="40" height="22" rx="6" fill="${color}" opacity="0.85"/>
    <rect x="8"  y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <rect x="62" y="64" width="10" height="16" rx="4" fill="${color}" opacity="0.7"/>
    <rect x="24" y="80" width="11" height="8"  rx="3" fill="${color}" opacity="0.7"/>
    <rect x="45" y="80" width="11" height="8"  rx="3" fill="${color}" opacity="0.7"/>
    <rect x="14" y="20" width="52" height="42" rx="10" fill="${color}"/>
    <rect x="16" y="22" width="48" height="38" rx="9"  fill="${color}" opacity="0.7"/>
    ${eyesHtml}
    ${mouthHtml}
    <circle cx="40" cy="71" r="4"   fill="rgba(255,255,255,0.25)"/>
    <circle cx="40" cy="71" r="2.5" fill="${isActive ? '#fff' : 'rgba(255,255,255,0.5)'}"/>
    ${antenna ? `<line x1="40" y1="20" x2="40" y2="10" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="40" cy="8" r="3.5" fill="${color}"/>
    <circle cx="40" cy="8" r="2"   fill="#fff" opacity="0.8"/>` : ''}
  </svg>`;
}

function _pmApprovalCanSave(approval = {}) {
  return _pmIsCommandApproval(approval)
    && approval?.oneShot !== true
    && String(approval?.approvalKind || '').trim() !== 'elevated_command';
}

function _pmHasProcessRun(approval = {}) {
  return _pmIsCommandApproval(approval)
    && String(approval?.approvalKind || '').trim() !== 'elevated_command';
}

export {
  ICONS,
  MOBILE_CHAT_SESSION_ID,
  PM_CHAT_VOICE_ICON_SRC,
  __pmChat,
  __pmVoice,
  _applyMobileAgentStreamEvent,
  _approvalFromMobileEvent,
  _buildMobileFileContextNote,
  _closeMobileQueuedPromptMenus,
  _closeMobileSources,
  _copyMobileSnippetText,
  _deliverSubagentVoiceReplyOnce,
  _drawAgentSVG,
  _ensureMobileQueuedPromptMenuDismiss,
  _formatChatTime,
  _formatTimeAgo,
  _installMobileTimestampReveal,
  _loadMobileSources,
  _mobileSubagentHeaderLabel,
  _mobileSubagentModelParts,
  _mobileVoiceTargetPayload,
  _normalizeMobileApproval,
  _normalizeMobileFile,
  _normalizeVoiceEchoText,
  _openMobileSources,
  _pmCssEscape,
  _pmHumanApproval,
  _pmRenderTaskJournal,
  _renderAgentModelPicker,
  _renderAgentVoicePicker,
  _renderChatAttachmentPreviews,
  _renderMobileAgentChatBubble,
  _renderMobileGoalPill,
  _renderMobileMarkdown,
  _renderMobileProcess,
  _resolveMobileApprovalButton,
  _wireMobileApprovalActionButton,
  _restoreTemporaryMobileSubagentVoiceProfile,
  _setTemporaryMobileSubagentVoiceProfile,
  _uploadMobileChatAttachments,
  _voiceDebug,
  _wireMobileChatEnhancements,
  _wireMobileProcessRunActions,
  agentModelPickerHydrate,
  agentVoicePickerHydrate,
  approveMobileProposal,
  attachMobileButtonHaptic,
  buildInlineMediaUrl,
  creativeExtractLayers,
  deleteMobileSchedule,
  deleteTeam,
  denyMobileProposal,
  detachMobileResource,
  escapeHtml,
  getAccount,
  getCachedMobilePageData,
  invalidateTeamsCache,
  loadBgTaskDetail,
  loadBgTaskEvidence,
  loadBgTasks,
  loadCanvasImageDataUrl,
  loadCreativeGallery,
  loadMemoryGraph,
  loadMobileApprovals,
  loadMobileAuditRuns,
  loadMobileHubGoals,
  loadMobileHubOverview,
  loadMobileMoreSummary,
  loadMobileProposal,
  loadMobileProposals,
  loadMobileSchedules,
  loadMobileSubagentDetail,
  loadMobileSubagents,
  loadMobileTeamDetail,
  loadMobileTeams,
  loadSubagentChat,
  loadSubagentChatStreamReplay,
  loadSubagentContextRefs,
  loadSubagentHeartbeat,
  loadSubagentMemory,
  loadSubagentRunDetail,
  loadSubagentRuns,
  loadSubagentSystemPrompt,
  loadTeamChat,
  loadTeamChatStreamReplay,
  loadTeamRoomState,
  loadTeamRuns,
  loadTeamWorkspace,
  loadTeamWorkspaceFile,
  pauseTeam,
  pmHaptic,
  pmToast,
  registerAgentModelPickerOnSaved,
  registerAgentVoicePickerOnSaved,
  renderMobileContextChip,
  renderMobileHeader,
  resumeTeam,
  runBgTaskAction,
  runScheduleNow,
  saveTeamContextReference,
  sendBgTaskMessage,
  sendSubagentRunRecovery,
  setMobileSubagentReasoningContext,
  spawnSubagentTask,
  startTeamRun,
  streamChat,
  streamSubagentChat,
  streamTeamChat,
  subagentChatSessionId,
  tickSubagentHeartbeat,
  toggleSchedule,
  triggerTeamReview,
  updateMobileSchedule,
  uploadMobileBinaryFile,
  wireHeaderActions,
  wireMobileContextWindow,
  wsEventBus,
};
