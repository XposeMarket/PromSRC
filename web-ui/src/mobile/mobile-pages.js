// Chat and inline Voice route owner.
import {
  ICONS, icon, escapeHtml, el, renderMobileHeader, wireHeaderActions, openDrawer, invalidateMobileDrawerSessions, refreshMobileDrawerSessions,
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
  loadCanvasImageDataUrl, creativeExtractLayers, loadCreativeGallery, buildInlineMediaUrl, buildDownloadMediaUrl, buildWorkspaceCanvasUrl,
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
const {
  controller: mobileTimelineController,
  scheduler: mobileStreamRenderScheduler,
  entries: _mobileTimelineEntries,
  rowSignature: chatTimelineRowSignature,
} = createMobileTimelineView({
  runtimeFor: mobileChatRuntimeAdapter.runtimeFor,
  getRows: mobileChatRuntimeAdapter.getTranscriptRows,
  isHiddenMessage: _isMobileHiddenVoiceDraftMessage,
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

function _compactMobileThreadCacheTrace(entries, limit = 180) {
  return (Array.isArray(entries) ? entries : []).slice(-limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const text = String(entry.text || entry.content || entry.message || '').slice(0, 4200);
    const extra = _compactMobileThreadCacheExtra(entry.extra);
    const activity = _compactMobileThreadCacheActivity(entry.activity);
    const compact = {
      id: String(entry.id || '').trim() || undefined,
      type: String(entry.type || entry.kind || 'event').trim() || 'event',
      text,
      ts: Number(entry.ts || entry.timestamp || 0) || undefined,
      time: String(entry.time || '').trim() || undefined,
      endTs: Number(entry.endTs || 0) || undefined,
      ...(extra ? { extra } : {}),
      ...(activity ? { activity } : {}),
    };
    return compact;
  }).filter((entry) => entry && (entry.text || entry.activity || entry.extra));
}

function _compactMobileThreadCacheProcess(entries, limit = 10) {
  return (Array.isArray(entries) ? entries : []).slice(-limit).map((entry) => ({
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
    return entry.thread;
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
      processEntries: entries,
      liveTraceEntries: recoveredTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean),
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
    processEntries: Array.isArray(m?.processEntries) ? m.processEntries.map(_normalizeMobileProcessEntry).filter(Boolean) : [],
    liveTraceEntries: Array.isArray(m?.liveTraceEntries) && m.liveTraceEntries.length
      ? m.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean)
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
        liveTraceEntries: Array.isArray(msg.liveTraceEntries) && msg.liveTraceEntries.length ? msg.liveTraceEntries : undefined,
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
    .filter((msg, index) => msg && !_isMobileHiddenVoiceDraftMessage(msg, index))
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
    _setMobileSteerContinuationTurn(latestAi, continuationTurn);
  }
  _persistMobileThreadSnapshot(sid);
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
    const expanded = (opts.expanded || active) ? ' expanded' : '';
    return `<div class="pm-work-timer pm-work-timer--expandable${expanded}" data-expandable="trace">
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

function _acknowledgeMobileExpectedAbortTurn(turn) {
  if (!turn) return false;
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

function _setMobileLiveProgressNarration(message, text, { replace = false, visibility = 'summary' } = {}) {
  if (!message) return false;
  const incoming = String(text || '');
  if (!incoming) return false;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const existing = [...message.liveTraceEntries].reverse().find((entry) =>
    String(entry?.extra?.source || '').toLowerCase() === 'agent_progress'
  );
  if (!existing) {
    _appendMobileLiveTrace(message, 'think', incoming, {
      extra: { visibility, source: 'agent_progress' },
    });
    return true;
  }
  const merged = replace
    ? incoming.trim()
    : _dedupeMobileTraceProseText(_appendMobileStreamingText(existing.text || '', incoming));
  const latest = replace
    ? merged
    : (merged.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).pop() || merged);
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

function _shouldAppendMobileReasoningSummary(message, chunk) {
  const incoming = String(chunk || '');
  if (!message || !incoming) return false;
  const last = [...(Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [])]
    .reverse()
    .find((entry) => String(entry?.type || '').toLowerCase() === 'reasoning_summary');
  if (!last) return false;
  const previous = String(last.text || '').trim();
  const next = incoming.trimStart();
  if (!previous || !next) return false;
  // Keep transport-sized deltas together, but start a new durable summary
  // paragraph when the provider has finished the previous thought.
  return !/[.!?:]\s*$/.test(previous)
    && (/^\s/.test(incoming) || /^[a-z0-9,'"’”\-—.;:!?)}\]]/.test(next));
}

function _appendMobileReasoningSummary(message, chunk) {
  const incoming = String(chunk || '');
  if (!message || !incoming) return false;
  const previous = [...(Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [])]
    .reverse()
    .find((entry) => String(entry?.type || '').toLowerCase() === 'reasoning_summary');
  const previousText = String(previous?.text || '').trim();
  const incomingText = incoming.trim();
  if (previous && incomingText.length > previousText.length && incomingText.startsWith(previousText)) {
    previous.text = incomingText;
    previous.time = _nowTime();
    return true;
  }
  if (previous && _mobileTraceThoughtTextsSimilar(previousText, incomingText)) return false;
  _appendMobileLiveTrace(message, 'reasoning_summary', incoming, {
    append: _shouldAppendMobileReasoningSummary(message, incoming),
    extra: { visibility: 'summary', source: 'reasoning_summary' },
  });
  return true;
}

function _handleMobileThinkingDelta(message, evt) {
  if (!message) return false;
  const chunk = String(evt?.thinking || evt?.text || '');
  if (!chunk) return false;
  message._pendingThinkingBurst = `${message._pendingThinkingBurst || ''}${chunk}`;
  // Only reasoning summaries stream live (desktop parity). Raw chain-of-thought stays buffered.
  if (String(evt?.source || '').toLowerCase() === 'reasoning_summary') {
    // `reasoning_summary` is already an explicit user-safe progress channel.
    // Keep it in the single replaceable tool-stream status slot even when the
    // prose does not start with one of the action verbs in
    // `_isMobileProgressNarration`.
    _setMobileLiveProgressNarration(message, chunk);
    _appendMobileReasoningSummary(message, chunk);
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
  _appendMobileReasoningSummary(message, chunk);
  return true;
}

function _handleMobileCleanThought(message, evt) {
  if (!message) return false;
  const visibility = chatProgressVisibility(evt);
  if (visibility === 'private') return false;
  const text = String(evt?.thinking || evt?.text || '').trim();
  if (!text) return false;
  const streamId = String(evt?.streamId || '').trim();
  const seq = Number(evt?.seq);
  const eventKey = String(evt?.eventKey || '').trim()
    || (streamId && Number.isFinite(seq) && seq >= 0 ? `${streamId}:${Math.floor(seq)}` : '');
  const thoughtExtra = {
    source: String(evt?.source || '').trim() || 'agent_thought',
    visibility,
    event: String(evt?.type || '').trim() || 'agent_thought',
    reasoningKind: String(evt?.reasoningKind || evt?.extra?.reasoningKind || '').trim().toLowerCase()
      || (String(evt?.source || '').trim().toLowerCase() === 'reasoning_summary' ? 'summary' : 'full_thought'),
    ...(streamId ? { streamId } : {}),
    ...(eventKey ? { eventKey } : {}),
    ...(Number.isFinite(seq) && seq >= 0 ? { seq: Math.floor(seq) } : {}),
  };
  // Summary packets own the replaceable one-line progress slot. A curated
  // paragraph thought is a separate journal entry and must never replace that
  // slot; otherwise the renderer cannot keep the two presentation surfaces
  // distinct after a tool call or reconnect.
  message._thinking = message._thinking ? `${message._thinking}\n\n${text}` : text;
  const updated = thoughtExtra.reasoningKind === 'summary'
    ? _setMobileLiveProgressNarration(message, text, { replace: true, visibility })
    : false;
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
  return updated || true;
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

function _isMobileHiddenRuntimeProcessEntry(entry) {
  if (_isInternalMobileRestartProcessEntry(entry)) return true;
  const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
  // Plan progress is rendered by the dedicated plan UI. Older runtime
  // checkpoints wrote it as generic `step` process rows, which made recovered
  // tool drawers show fake "Plan: Run …" tools.
  return String(extra.source || '').toLowerCase() === 'runtime_checkpoint'
    && String(extra.event || '').toLowerCase() === 'progress_state';
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
    const kind = String(normalizedExtra.reasoningKind || '').trim().toLowerCase()
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
    .filter(Boolean);
}

function _mergeMobileProcessEntries(message, entries) {
  if (!message) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const existing = new Set(message.processEntries.map(_mobileProcessEntryKey).filter(Boolean));
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = _normalizeMobileProcessEntry(raw);
    if (!entry) continue;
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
  const isUserVisibleThought = isThoughtLike && _isMobileUserVisibleReasoningTraceEntry({ type: normalizedType, extra });
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
    if (_isMobileUserVisibleReasoningTraceEntry(entry) !== isUserVisibleThought) return false;
    return _mobileTraceThoughtTextsSimilar(entry?.text || '', content);
  }) : false;
  if (existingThoughtText) return;
  if (append && last && last.type === normalizedType
    && (!isThoughtLike || _isMobileUserVisibleReasoningTraceEntry(last) === isUserVisibleThought)) {
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
  const source = String(value || '').trim();
  return /^data:image\//i.test(source)
    || /^\/api\/canvas\/inline\?path=/i.test(source)
    || /^\/api\/canvas\/generated-image-preview\?cache=/i.test(source)
    || /^\/api\/chat\/desktop-screenshot-preview\//i.test(source);
}

function _appendMobileVisionTrace(message, evt) {
  if (!message || !evt) return;
  const preview = evt.preview && typeof evt.preview === 'object' ? evt.preview : {};
  const dataUrl = String(preview.dataUrl || evt.dataUrl || '').trim();
  if (!_isRenderableMobileTraceImageSource(dataUrl)) return;
  if (!Array.isArray(message.liveTraceEntries)) message.liveTraceEntries = [];
  const sourceValue = String(evt.source || '').toLowerCase();
  if (sourceValue === 'generated_image') message._pmBackgroundImageGeneration = true;
  const source = sourceValue === 'browser' ? 'Browser' : sourceValue === 'media_analysis' ? 'Media analysis' : sourceValue === 'generated_image' ? 'Generated image' : 'Desktop';
  const tool = String(evt.tool || evt.action || evt.name || '').trim();
  const text = String(evt.label || `Vision injected: ${tool ? _mobileToolLabel({ ...evt, action: tool }) : `${source} observation`}`).trim();
  if (sourceValue === 'generated_image') {
    const incomingPreviewId = String(preview.previewId || '').trim();
    const incomingGenerationId = String(preview.generationId || '').trim();
    const incomingWorkspacePath = String(preview.workspacePath || '').trim();
    const incomingCacheKey = String(preview.cacheKey || '').trim();
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
    preview,
    previewTitle: String(evt.previewTitle || preview.title || `${source} preview`),
    previewKey: _mobileVisionPreviewKey(dataUrl, preview),
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
  const traces = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!traces.length) return;
  if (!Array.isArray(message.processEntries)) message.processEntries = [];
  const existing = new Set(message.processEntries.map((entry) =>
    `${String(entry?.type || '').toLowerCase()}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`
  ));
  for (const trace of traces) {
    const type = String(trace?.type || 'info').toLowerCase();
    const rawText = String(trace?.text || '').trim();
    const text = (type === 'preamble' || type === 'think' || type === 'assistant')
      ? _dedupeMobileTraceProseText(rawText)
      : rawText;
    if (!text || (type !== 'preamble' && type !== 'think' && !_isMobileTraceReasoningSummaryType(type))) continue;
    const key = `${type}|${text.replace(/\s+/g, ' ').trim()}`;
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
  const out = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
  const traces = Array.isArray(message?.liveTraceEntries) ? message.liveTraceEntries : [];
  if (!traces.length) return out;
  const existing = new Set(out.map((entry) =>
    `${String(entry?.type || '').toLowerCase()}|${String(entry?.text || entry?.content || '').replace(/\s+/g, ' ').trim()}`
  ));
  const liveEntries = [];
  for (const trace of traces) {
    const type = String(trace?.type || 'info').toLowerCase();
    const rawText = String(trace?.text || '').trim();
    const text = (type === 'preamble' || type === 'think' || type === 'assistant')
      ? _dedupeMobileTraceProseText(rawText)
      : rawText;
    if (!text || (type !== 'preamble' && type !== 'think' && !_isMobileTraceReasoningSummaryType(type))) continue;
    const key = `${type}|${text.replace(/\s+/g, ' ').trim()}`;
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
    const key = `${type}|${normalizedText}|${previewData.slice(0, 120)}`;
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
    return `${thoughtType ? 'thought' : type}|${text}|${preview}`;
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
    .map((entry) => _dedupeMobileTraceProseText(entry?.text || entry?.content || ''))
    .filter(Boolean);
  let changed = false;
  for (let index = 0; index < derived.length; index += 1) {
    const entry = derived[index];
    const key = traceDedupeKey(entry);
    if (!key || existing.has(key)) continue;
    if (isThoughtTraceEntry(entry)) {
      const text = _dedupeMobileTraceProseText(entry?.text || entry?.content || '');
      if (existingThoughts.some((seen) => _mobileTraceThoughtTextsSimilar(seen, text))) continue;
      existingThoughts.push(text);
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
  const title = String(entry?.previewTitle || preview?.title || entry?.text || 'Vision preview').trim();
  const width = Number(preview?.width || entry?.width || 0);
  const height = Number(preview?.height || entry?.height || 0);
  const dims = width > 0 && height > 0 ? ` (${Math.round(width)}x${Math.round(height)})` : '';
  const aspect = width > 0 && height > 0 ? `${Math.max(1, Math.round(width))} / ${Math.max(1, Math.round(height))}` : '16 / 9';
  const key = String(entry?.previewKey || _mobileVisionPreviewKey(dataUrl, preview)).trim();
  return `<button type="button" class="pm-live-vision-preview" data-pm-live-vision-preview="${escapeHtml(key)}" title="${escapeHtml(title + dims)}" style="--pm-vision-aspect:${escapeHtml(aspect)}">
    <img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async"${width > 0 ? ` width="${escapeHtml(String(Math.round(width)))}"` : ''}${height > 0 ? ` height="${escapeHtml(String(Math.round(height)))}"` : ''}>
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
    const visibleReasoning = _isMobileUserVisibleReasoningTraceEntry(entry);
    const existingIndex = kept.findIndex((candidate) => {
      if (!_isMobileTraceThoughtType(candidate?.type)) return false;
      if (_isMobileUserVisibleReasoningTraceEntry(candidate) !== visibleReasoning) return false;
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
  const visibleReasoning = _isMobileUserVisibleReasoningTraceEntry(candidateEntry || { type: excludeEntry?.type || 'think' });
  const entries = Array.isArray(message.liveTraceEntries) ? message.liveTraceEntries : [];
  return entries.some((entry) => {
    if (!entry || entry === excludeEntry) return false;
    if (!_isMobileTraceThoughtType(entry.type)) return false;
    if (_isMobileUserVisibleReasoningTraceEntry(entry) !== visibleReasoning) return false;
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
  return _isMobileUserVisibleReasoningTraceEntry(last)
    !== _isMobileUserVisibleReasoningTraceEntry({ type, extra });
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

function _mergeMobileSessionThreadWithLocal(sessionId, serverHistory, localThread, options = {}) {
  const mapped = _mapServerHistoryToMobile(serverHistory);
  const local = Array.isArray(localThread) ? localThread : [];
  const durableLocal = local.filter((message, index) => message
    && (message.role === 'user' || message.role === 'ai')
    && !_isMobileHiddenVoiceDraftMessage(message, index));
  // `/api/sessions/:id` deliberately returns a bounded tail on mobile. Keep
  // every already-loaded local transcript row when that response advertises
  // older history; otherwise a cold reopen can render and cache only the tail.
  const base = options.preserveLocalHistory === true
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

function _mobileHasPendingImageGeneration(message) {
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
    const eventKey = String(extra.eventKey || entry.eventKey || '').trim();
    const callId = String(extra.callId || extra.call_id || extra.toolCallId || extra.tool_call_id || entry.callId || '').trim();
    const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim();
    const key = `${type}|${eventKey || callId || text}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  });
  let activeImageCalls = 0;
  let observedImageActivity = false;
  entries.forEach((entry) => {
    const type = String(entry?.type || '').toLowerCase();
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    const presentationMode = String(extra.presentation_mode || extra.presentationMode || entry?.presentation_mode || '').trim().toLowerCase();
    if (presentationMode === 'background') return;
    const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim();
    const isImageActivity = _isMobileGenerateImageToolName(_mobileToolEventName(entry?.extra || entry) || text);
    if (!isImageActivity) return;
    observedImageActivity = true;
    if (type === 'result' || type === 'error' || type === 'tool_result') {
      activeImageCalls = Math.max(0, activeImageCalls - 1);
      return;
    }
    if (type === 'tool' || type === 'call') {
      activeImageCalls += 1;
      return;
    }
    // Some older runtimes only emitted a progress/info row for image jobs.
    // Treat the first such row as an open job, while repeated progress rows do
    // not inflate the count.
    if (activeImageCalls === 0) activeImageCalls = 1;
  });
  return observedImageActivity && activeImageCalls > 0;
}

function _isMobileImageGenerationStreamEntry(entry) {
  const text = String(entry?.text || entry?.content || entry?.message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return false;
  if (/\b(preparing generate image|prepared generate image|generate_image)\b/.test(text)) return true;
  if (/^generate image\s*(?:[:(]|complete\b|failed\b)/.test(text)) return true;
  if (/^generating image\s*(?:[:(]|$)/.test(text)) return true;
  return false;
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
  const src = input && typeof input === 'object' ? input : {};
  const id = String(src.id || extra.questionId || extra.id || '').trim();
  const rawCurrentIndex = src.currentIndex ?? extra.currentIndex;
  const questions = (Array.isArray(src.questions) ? src.questions : []).map((q, i) => ({
    id: String(q?.id || `q${i + 1}`),
    label: String(q?.label || q?.question || ''),
    mode: q?.mode === 'multi_select' ? 'multi_select' : q?.mode === 'text' ? 'text' : 'single_select',
    options: Array.isArray(q?.options) ? q.options.map((o) => String(o)) : [],
    allowOther: q?.allowOther !== false,
    required: q?.required !== false,
  })).filter((q) => q.label);
  return {
    id,
    sessionId: String(src.sessionId || src.sourceSessionId || extra.sessionId || '').trim(),
    currentIndex: Number.isFinite(Number(rawCurrentIndex)) ? Number(rawCurrentIndex) : 0,
    questions,
    allowGeneralOther: false,
    status: String(extra.status || src.status || 'pending'),
    answers: Array.isArray(src.answers) ? src.answers : [],
    generalOther: String(src.generalOther || extra.generalOther || '').trim(),
  };
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

function _applyMobileQuestionComposerAnswer(q, payload, composerText = '') {
  const text = String(composerText || '').trim();
  if (!text || !q || !payload) return payload;
  const card = document.querySelector(`[data-pm-q-card="${_pmCssEscape(q.id)}"]`);
  const rawTarget = String(card?.getAttribute('data-pm-q-compose-target') || '').trim();
  const [targetId, targetKind] = rawTarget.split('::');
  const targetQuestion = q.questions.find((item) => String(item.id) === String(targetId || ''))
    || q.questions.find((item) => item.mode === 'text')
    || q.questions.find((item) => item.allowOther)
    || null;
  const targetAnswer = targetQuestion
    ? payload.answers.find((answer) => String(answer.id) === String(targetQuestion.id))
    : null;
  if (targetAnswer) {
    if (targetKind === 'other' || (!targetKind && targetQuestion.mode !== 'text')) targetAnswer.other = text;
    else targetAnswer.text = text;
  } else if (q.allowGeneralOther) {
    payload.generalOther = text;
  } else if (payload.answers[0]) {
    payload.answers[0].text = text;
  }
  return payload;
}

function _getMissingMobileQuestionAnswers(q, payload) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  return (q?.questions || []).filter((item) => {
    if (item?.required === false) return false;
    const answer = answers.find((candidate) => String(candidate?.id || '') === String(item?.id || ''));
    return !answer || (
      !(Array.isArray(answer.selected) && answer.selected.length)
      && !String(answer.text || '').trim()
      && !String(answer.other || '').trim()
    );
  });
}

function _focusMobileQuestionComposer() {
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

function _findMobileQuestionRecord(qid) {
  const id = String(qid || '').trim();
  if (!id) return null;
  const sessions = __pmChat.threads || {};
  for (const sid of Object.keys(sessions)) {
    const thread = sessions[sid];
    if (!Array.isArray(thread)) continue;
    const msg = thread.find((m) => String(m?.questionRequest?.id || '') === id);
    if (msg?.questionRequest) return msg.questionRequest;
  }
  return null;
}
function _mobileQuestionIsResolved(id) {
  return __pmChat.resolvedQuestionIds?.[String(id || '').trim()] === true;
}
function _setMobileQuestionSubmitting(id) {
  const qid = String(id || '').trim();
  if (!qid) return;
  Object.entries(__pmChat.threads || {}).forEach(([sid, thread]) => {
    if (!Array.isArray(thread)) return;
    let changed = false;
    thread.forEach((message) => {
      if (String(message?.questionRequest?.id || '') !== qid) return;
      message.questionRequest = { ...message.questionRequest, status: 'submitting' };
      mobileChatRuntimeAdapter.upsertQuestion(sid, message.questionRequest);
      changed = true;
    });
    if (changed && String(__pmChat.activeSessionId || '').trim() === String(sid)) _renderMobileChatSessionNow(sid);
  });
}
function _removeMobileQuestionFromThread(id) {
  const qid = String(id || '').trim();
  if (!qid) return;
  __pmChat.resolvedQuestionIds[qid] = true;
  Object.entries(__pmChat.threads || {}).forEach(([sid, thread]) => {
    if (!Array.isArray(thread)) return;
    let changed = false;
    thread.forEach((message) => {
      if (String(message?.questionRequest?.id || '') !== qid) return;
      mobileChatRuntimeAdapter.resolveQuestion(sid, qid, 'resolved', message.questionRequest);
      delete message.questionRequest;
      changed = true;
    });
    if (changed && String(__pmChat.activeSessionId || '').trim() === String(sid)) _renderMobileChatSessionNow(sid);
  });
}
async function _submitMobileQuestion(id, options = {}) {
  const qid = String(id || '').trim();
  const card = document.querySelector(`[data-pm-q-card="${_pmCssEscape(qid)}"]`);
  const submitButton = card?.querySelector('[data-pm-q-submit]');
  if (submitButton?.disabled) return false;
  submitButton?.setAttribute('aria-busy', 'true');
  if (submitButton) submitButton.disabled = true;
  // Prefer the locally-rendered question record (already in the thread) so a
  // slow/failed /api/questions fetch can't strand Submit with an empty question
  // shape and silently send no answers. Network is only a fallback.
  let record = _findMobileQuestionRecord(qid);
  if (!record) {
    try { const data = await window.api('/api/questions?status=all'); record = (data.questions || []).find((it) => String(it.id || '') === qid) || null; } catch {}
  }
  const q = _normalizeMobileQuestion(record || { id: qid, questions: [] });
  const currentIndex = _mobileQuestionStepIndex(q);
  let payload = _collectMobileQuestionAnswers(q);
  _applyMobileQuestionComposerAnswer(q, payload, options.composerText);
  const isLastQuestion = currentIndex >= q.questions.length - 1;
  const missing = _getMissingMobileQuestionAnswers(
    { ...q, questions: isLastQuestion ? q.questions : [q.questions[currentIndex]] },
    payload,
  );
  if (missing.length) {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
    _focusMobileQuestionComposer();
    const labels = missing.map((item) => item.label).filter(Boolean).slice(0, 3).join('; ');
    pmToast?.({
      key: 'mobile-question-answer-required',
      severity: 'warning',
      title: 'Answer required',
      summary: `Answer before submitting: ${labels}`,
    });
    return false;
  }
  if (!isLastQuestion) {
    const nextIndex = currentIndex + 1;
    const state = _rememberMobileQuestionPayload(q, payload, nextIndex);
    const sessionId = String(q.sessionId || __pmChat.activeSessionId || '').trim();
    _syncMobileQuestionComposerPopover(sessionId, { [qid]: state });
    return true;
  }
  _setMobileQuestionSubmitting(qid);
  try {
    const result = await window.api(`/api/questions/${encodeURIComponent(qid)}/submit`, { method: 'POST', body: JSON.stringify(payload) });
    const answeredQuestion = { ...(result?.question || q), answers: payload.answers, generalOther: payload.generalOther };
    _mobileQuestionDrafts.delete(qid);
    _updateMobileQuestionStatus({ questionId: qid, sessionId: answeredQuestion.sessionId, question: answeredQuestion }, 'answered');
    _mobileQuestionDrafts.delete(qid);
    // When there was no live waiter (the normal async case on mobile, since the
    // original turn already ended), the backend returns a resumePrompt so the
    // agent can be continued with the answers. Mirror the approval-resume flow:
    // re-fire the chat in the right session so the agent actually responds.
    const resumePrompt = String(result?.resumePrompt || '').trim();
    if (resumePrompt) {
      const resumeSid = String(result?.question?.sessionId || result?.question?.sourceSessionId || __pmChat.activeSessionId || '').trim();
      if (resumeSid) __pmChat.activeSessionId = resumeSid;
      if (typeof window.__pmMobileSendMessage === 'function') {
        setTimeout(() => window.__pmMobileSendMessage(resumePrompt, { fromQuestionResume: true }), 100);
      } else {
        const queue = _getMobileQueuedPrompts(resumeSid);
        queue.push(_makeMobileQueuedPrompt(resumePrompt));
        if (queue.length > PM_MOBILE_MAX_QUEUED_PROMPTS) queue.splice(0, queue.length - PM_MOBILE_MAX_QUEUED_PROMPTS);
        _renderMobileQueuedPromptsPanel(resumeSid);
        pmToast('Answer queued a resume message', 'info');
      }
    }
    return true;
  } catch (err) {
    // Restore the same card if the answer could not be submitted.
    _updateMobileQuestionStatus({ questionId: qid, question: q }, 'pending');
    pmToast?.(`Question submit failed: ${err?.message || err}`, 'error');
    return false;
  }
}
async function _cancelMobileQuestion(id) {
  const qid = String(id || '').trim();
  try {
    const result = await window.api(`/api/questions/${encodeURIComponent(qid)}/cancel`, { method: 'POST', body: '{}' });
    _updateMobileQuestionStatus({ questionId: qid, sessionId: result?.question?.sessionId, question: result?.question }, 'cancelled');
  } catch (err) { pmToast?.(`Question cancel failed: ${err?.message || err}`, 'error'); }
}
function _upsertMobileQuestion(q) {
  const sid = String(q.sessionId || '').trim();
  if (!sid || !q.id) return;
  if (_mobileQuestionIsResolved(q.id)) return;
  if (!Array.isArray(__pmChat.threads[sid])) __pmChat.threads[sid] = [];
  const thread = __pmChat.threads[sid];
  const existing = thread.filter((m) => String(m?.questionRequest?.id || '') === q.id);
  if (existing.length) {
    existing.forEach((message) => { message.questionRequest = { ...(message.questionRequest || {}), ...q }; });
  } else {
    thread.push({ role: 'ai', timestamp: Date.now(), time: _nowTime(), body: { sender: 'Prometheus', text: '' }, content: '', questionRequest: q });
  }
  mobileChatRuntimeAdapter.upsertQuestion(sid, q);
  if (String(__pmChat.activeSessionId || '').trim() === sid) _renderMobileChatSessionNow(sid);
}
function _updateMobileQuestionStatus(event, status) {
  const id = String(event.questionId || event.id || event.question?.id || '').trim();
  if (!id) return;
  if (status && status !== 'pending' && status !== 'submitting') {
    _mobileQuestionDrafts.delete(id);
    _removeMobileQuestionFromThread(id);
    return;
  }
  const sessions = __pmChat.threads || {};
  for (const sid of Object.keys(sessions)) {
    const thread = sessions[sid];
    if (!Array.isArray(thread)) continue;
    const matches = thread.filter((m) => String(m?.questionRequest?.id || '') === id);
    if (!matches.length) continue;
    matches.forEach((msg) => {
      msg.questionRequest = _normalizeMobileQuestion(event.question || msg.questionRequest, { id, status });
      msg.questionRequest.status = status || msg.questionRequest.status || 'pending';
    });
    try { mobileChatRuntimeAdapter.reconcileQuestion(sid, id, status, matches[0]?.questionRequest || { id, status }); } catch {}
    if (String(__pmChat.activeSessionId || '').trim() === sid) _renderMobileChatSessionNow(sid);
  }
}
if (typeof window !== 'undefined' && !window.__pmMobileQuestionBridgeInstalled) {
  window.__pmMobileQuestionBridgeInstalled = true;
  window._mobileQuestionToggleOption = _mobileQuestionToggleOption;
  window._mobileQuestionToggleOther = _mobileQuestionToggleOther;
  window._mobileQuestionRememberDraft = _mobileQuestionRememberDraft;
  window._submitMobileQuestion = _submitMobileQuestion;
  window._cancelMobileQuestion = _cancelMobileQuestion;
  wsEventBus.on('question_created', (msg = {}) => {
    const q = _normalizeMobileQuestion(msg.question || {}, { ...msg, status: 'pending' });
    if (q.id && q.sessionId) _upsertMobileQuestion(q);
  });
  wsEventBus.on('question_answered', (msg = {}) => _updateMobileQuestionStatus(msg, 'answered'));
  wsEventBus.on('question_cancelled', (msg = {}) => _updateMobileQuestionStatus(msg, 'cancelled'));
  wsEventBus.on('question_expired', (msg = {}) => _updateMobileQuestionStatus(msg, 'expired'));
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
  "_mobileHasPendingImageGeneration": { enumerable: true, get: () => _mobileHasPendingImageGeneration },
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
  if (/[\s\r\n]/.test(query)) return null;
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
  const safeName = name.replace(/\*/g, '').trim() || 'Skill';
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

export async function renderChatPage(page, { navigate, sessionId = null, voiceRoomTranscript = false }) {
  await loadMobileChatRendererRuntime();
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
  pmSlashCommandSelectionIndex = 0;
  pmSkillComposerSelectionIndex = 0;
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
    pop.innerHTML = `
      <button class="pm-chat-settings-menu-item" id="pm-chat-settings-notifications" type="button" data-action="notifications" aria-pressed="false"><span class="pm-chat-settings-menu-icon" aria-hidden="true">${ICONS.bell}</span><span class="pm-chat-settings-menu-label">Notifications</span><span class="pm-chat-settings-menu-status" id="pm-chat-settings-notifications-status" aria-hidden="true" hidden>${ICONS.check}</span></button>
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
    <div class="pm-main-plan-dock" id="pm-main-plan-dock" hidden></div>
    <div class="pm-background-spawn-dock" id="pm-background-spawn-dock" hidden></div>
    <div id="pm-mobile-sources-popover" class="pm-mobile-sources-popover" hidden role="dialog" aria-modal="true" aria-label="Chat Sources">
      <button type="button" id="pm-mobile-sources-scrim" class="pm-mobile-sources-popover-scrim" aria-label="Close Sources"></button>
      <section class="pm-mobile-sources-panel">
        <div class="pm-mobile-sources-header"><div><strong>Sources <span id="pm-mobile-sources-count"></span></strong><div id="pm-mobile-sources-mode">Attached to this chat</div></div><button type="button" id="pm-mobile-sources-close" class="pm-mobile-sources-close" aria-label="Close Sources">×</button></div>
        <div class="pm-mobile-sources-toolbar"><button type="button" id="pm-mobile-sources-save" class="pm-mobile-source-toolbar-btn">Save current page</button><button type="button" id="pm-mobile-sources-history" class="pm-mobile-source-toolbar-btn">Browser history</button><button type="button" id="pm-mobile-sources-attached" class="pm-mobile-source-toolbar-btn">Attached</button></div>
        <input id="pm-mobile-sources-search" class="pm-mobile-sources-search" type="search" placeholder="Search Sources" aria-label="Search Sources">
        <div id="pm-mobile-sources-list" class="pm-mobile-sources-list"><div class="pm-mobile-sources-empty">Sources stay online and load selectively when needed.</div></div>
      </section>
    </div>
    <div class="pm-mobile-goal-strip" id="pm-mobile-goal-strip" hidden></div>
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
    <form class="pm-composer${isVoiceRoomTranscript ? ' pm-voice-room-transcript-composer' : ''}" id="pm-composer"${isVoiceRoomTranscript ? ' aria-hidden="true" inert' : ''}>
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
    if (__pmChat.activeSessionId !== requestedSession) return;
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
        if (__pmChat.activeSessionId !== requestedSession) return;
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
        if (__pmChat.activeSessionId !== requestedSession) return;
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

  const mobileRecoveryOwnerToken = `mobile_recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let mobileRecoveryDisposed = false;
  __pmChat.mobileRecoveryOwners[requestedSession] = mobileRecoveryOwnerToken;
  const isMobileRecoveryOwner = () => !mobileRecoveryDisposed
    && __pmChat.activeSessionId === requestedSession
    && __pmChat.mobileRecoveryOwners[requestedSession] === mobileRecoveryOwnerToken;
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
      if (replayStillActive || (localAiTurn?.streaming && !completedDurableTurn && status?.recovered !== true)) {
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
        __pmChat.threads[requestedSession] = _mergeMobileSessionThreadWithLocal(requestedSession, history, localThread, {
          preserveLocalHistory: _mobileHistoryPageIsPartial(session, history),
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
      return;
    }
    const rect = composerRect || form.getBoundingClientRect?.();
    const visualViewport = window.visualViewport;
    const viewportHeight = Number(
      visualViewport?.height
        || window.innerHeight
        || document.documentElement?.clientHeight
        || 0,
    );
    const viewportTop = Number(visualViewport?.offsetTop || 0) || 0;
    const composerTop = Number(rect?.top || 0) - viewportTop;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(composerTop)) return;
    // The dock is a separate fixed surface, so derived tab-bar/composer
    // variables can drift when the document-scrolled mobile path or the iOS
    // keyboard changes the composer geometry. Anchor its bottom edge to the
    // measured composer top instead of guessing from those offsets.
    const bottom = Math.max(0, Math.round(viewportHeight - composerTop + 8));
    backgroundSpawnDock.style.setProperty('bottom', `${bottom}px`);
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
      const runtimeDockHeight = Math.max(overlayDockHeight, planDockHeight);
      const runtimeSurfaceHeight = Math.max(dockHeight, planDockHeight);
      page?.style?.setProperty?.('--pm-background-dock-live-height', `${dockHeight}px`);
      page?.style?.setProperty?.('--pm-main-plan-live-height', `${planDockHeight}px`);
      page?.style?.setProperty?.('--pm-scroll-latest-stack-height', `${queuedHeight + goalHeight + toolProgressHeight + runtimeSurfaceHeight + connectionHeight}px`);
      const hasExpandedSurface = goalStrip?.dataset?.expanded === 'true'
        || mainPlanDock?.classList?.contains('is-open')
        || backgroundSpawnDock?.classList?.contains('is-open');
      // Open cards get a larger reading gutter than their collapsed pills. The
      // extra 32px keeps the final chat/tool line visibly above the glass edge.
      const clearance = hasExpandedSurface || connectionHeight || queuedHeight ? 78 : (runtimeDockHeight ? 46 : 34);
      const space = Math.max(170, height + queuedHeight + goalHeight + toolProgressHeight + runtimeDockHeight + connectionHeight + clearance);
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
      if (!composerOwnsKeyboard) _restoreMobileChatScroll(body, scrollSnapshot);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const shift = Math.max(-64, Math.min(64, space - previousSpace));
      if (!reduceMotion && Math.abs(shift) >= 2 && typeof threadEl?.animate === 'function') {
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
      } else if (reduceMotion) {
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
    ? new ResizeObserver(() => updateChatComposerSpace())
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
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    try {
      scrollTarget.scrollTo({ top: scrollTarget.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    } catch {
      scrollTarget.scrollTop = scrollTarget.scrollHeight;
    }
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
    const lane = _mobileBackgroundSpawnLanes()[cleanId];
    const stored = findBackgroundAgentWork(cleanId, requestedSession)
      || findBackgroundAgentWork(cleanId, __pmChat.activeSessionId);
    if (!lane) return stored;
    const identity = resolveBackgroundAgentIdentity(lane.id, {
      existingName: lane.agentName,
      existingColor: lane.agentColor,
    });
    const processEntries = Array.isArray(lane.message?.processEntries) && lane.message.processEntries.length
      ? lane.message.processEntries
      : _mobileBackgroundStoredProcessEntries(stored);
    const liveTraceEntries = Array.isArray(lane.message?.liveTraceEntries) && lane.message.liveTraceEntries.length
      ? lane.message.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean)
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
      // `result` belongs solely to the completed background run. Live token
      // text remains on `message`, and tool results stay in processEntries.
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

  function _appendMobileBackgroundSnapshotTrace(message, entry) {
    if (!message || !entry || typeof entry !== 'object') return false;
    const text = String(entry.text || entry.content || entry.message || entry.thinking || entry.summary || '').trim();
    if (!text) return false;
    const type = String(entry.type || entry.kind || '').trim().toLowerCase();
    const extra = entry.extra && typeof entry.extra === 'object' ? entry.extra : {};
    if (_isMobileReasoningSummaryTraceEntry(entry)) {
      _appendMobileReasoningSummary(message, text);
      return true;
    }
    if (!['think', 'thinking', 'thought', 'agent_thought'].includes(type)) return false;
    const visibility = String(extra.visibility || entry.visibility || '').trim().toLowerCase();
    if (visibility === 'private' || visibility === 'internal') return false;
    const explicitUserThought = type === 'agent_thought'
      ? true
      : _isMobileUserVisibleReasoningTraceEntry({
        type: 'think',
        extra: { ...extra, visibility },
      });
    if (!explicitUserThought) return false;
    _appendMobileLiveTrace(message, 'think', text, {
      extra: { ...extra, visibility: visibility || 'user' },
    });
    return true;
  }

  function _mobileBackgroundAgentDetailMessage(record) {
    const status = String(record?.status || 'running').toLowerCase();
    const running = ['queued', 'running', 'in_progress'].includes(status);
    const agentName = String(record?.agentName || 'Background agent');
    const source = record?.message && typeof record.message === 'object' ? record.message : {};
    const processEntries = Array.isArray(source.processEntries) && source.processEntries.length
      ? source.processEntries
      : _mobileBackgroundAgentDetailEvents(record);
    const liveTraceEntries = Array.isArray(source.liveTraceEntries) && source.liveTraceEntries.length
      ? source.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean)
      : (Array.isArray(record.liveTraceEntries) ? record.liveTraceEntries.map(_normalizeMobileRecoveredTraceEntry).filter(Boolean) : []);
    const sourceText = String(source?.body?.text || source?.content || source?.text || '').trim();
    const finalText = String(record?.error || record?.result || '').trim();
    const displayText = running ? sourceText : (finalText || sourceText);
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
      _pushMobileStreamProcessEntry(lane.message, processType, text, processExtra, !isReasoningSummary);
      if (isReasoningSummary) {
        const beforeTrace = Array.isArray(lane.message.liveTraceEntries) ? lane.message.liveTraceEntries.length : 0;
        const traceChanged = _appendMobileReasoningSummary(lane.message, text);
        changed = changed || traceChanged || (Array.isArray(lane.message.liveTraceEntries) && lane.message.liveTraceEntries.length > beforeTrace);
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
    const lane = _mobileBackgroundSpawnLanes()[cleanId];
    if (!lane) return;
    backgroundDetailPollInFlight = true;
    try {
      const currentLane = _mobileBackgroundSpawnLanes()[cleanId];
      const [statusResponse, replay, session] = await Promise.all([
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
      const steerHistory = (Array.isArray(backgroundRecord.steerMessages) ? backgroundRecord.steerMessages : [])
        .map((steer) => ({
          role: 'user',
          content: String(steer?.content || '').trim(),
          timestamp: Number(steer?.timestamp || Date.now()) || Date.now(),
          channelLabel: 'steer',
        }))
        .filter((steer) => steer.content);
      const historyHtml = steerHistory.map((steer, index) => _renderChatMessageHtml(steer, index)).join('');
      _reconcileMobileBackgroundAgentSideThread(sideThreadEl, `${historyHtml}${_renderMobileAgentChatBubble(message, {
        sender: agentName,
        live: running,
        keepLiveTraceVisible: true,
        backgroundAgentId: backgroundRecord.id,
      })}`);
    } else {
      const visible = (Array.isArray(sideState.thread) ? sideState.thread : [])
        .filter((msg, index) => msg && msg.sideChatBoundary !== true && !_isMobileHiddenVoiceDraftMessage(msg, index));
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
  const _pmKbComposerViewportProperties = ['position', 'left', 'right', 'bottom', 'z-index'];
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
    composer.style.setProperty('position', 'fixed', 'important');
    composer.style.setProperty('left', '10px', 'important');
    composer.style.setProperty('right', '10px', 'important');
    composer.style.setProperty('bottom', `${Math.max(8, Math.round(Number(bottomPx) || 8))}px`, 'important');
    composer.style.setProperty('z-index', '10020', 'important');
  }
  function _pmKbActiveComposer() {
    const sideFocused = sideSheet?.classList?.contains('open') && document.activeElement === sideInput;
    return sideFocused ? (sideInput?.closest?.('.pm-composer') || form) : form;
  }
  function _pmKbAnchorComposer(visualBottom) {
    const composer = _pmKbActiveComposer();
    if (!composer) return;
    const rect = composer.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return;
    const desiredBottom = Math.max(0, Number(visualBottom || 0) - 8);
    const rawShift = desiredBottom - Number(rect.bottom || 0);
    const limit = Math.max(Number(window.innerHeight || 0), Number(visualBottom || 0), Number(rect.height || 0)) + 80;
    const shift = Math.max(-limit, Math.min(limit, rawShift));
    if (Math.abs(shift) < 0.5) {
      composer.style.removeProperty(_pmKbComposerShiftProperty);
      return;
    }
    composer.style.setProperty(_pmKbComposerShiftProperty, `${Math.round(shift)}px`);
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
    // Keyboard height = layout viewport height minus the visible (visual)
    // viewport height. The shell stays anchored to the layout viewport, so the
    // composer only needs to float up by this amount.
    const visualBottom = Math.round(visualTop + visualHeight);
    const layoutOffset = vv
      ? Math.max(0, Math.round(layoutHeight - visualBottom))
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
      layoutOffset > 90
      || baselineOffset > 90
      || (_pmKbFocusActive && performance.now() < _pmKbFocusGraceUntil)
    );
    // iOS has two incompatible fixed-position behaviors: some webviews anchor
    // fixed children to the layout viewport, while others already anchor them
    // to the visual viewport. Reset the small visual correction before each
    // measurement so a scroll-up or viewport-pan cannot leave a stale mode or
    // stale lift attached to the composer.
    if (!open) {
      _pmKbViewportMode = '';
      _pmKbApp.classList.remove('pm-keyboard-open');
      _pmKbClearComposerShift();
      _pmKbClearComposerViewportStyles();
    } else {
      _pmKbApp.style.setProperty('--pm-keyboard-offset', '0px');
      _pmKbApp.classList.add('pm-keyboard-open');
      _pmKbClearComposerShift();
      const composerBottom = Number(_pmKbActiveComposer()?.getBoundingClientRect?.().bottom || 0);
      _pmKbViewportMode = composerBottom > 0 && composerBottom <= visualBottom + 44 ? 'visual' : 'layout';
      _pmKbSetComposerViewportStyles(_pmKbViewportMode === 'layout' ? layoutOffset + 8 : 8);
    }
    const keyboardOffset = open && _pmKbViewportMode === 'layout' ? layoutOffset : 0;
    _pmKbApp.style.setProperty('--pm-keyboard-offset', `${keyboardOffset}px`);
    _pmKbApp.classList.toggle('pm-keyboard-open', open);
    // A focused field is not proof that iOS has presented the keyboard yet.
    // During that short focus-only window the new-project dialog must remain
    // centered; switch to keyboard anchoring only after the viewport has
    // actually contracted.
    const keyboardViewportSettled = layoutOffset > 90 || baselineOffset > 90;
    syncNewProjectPopoverToKeyboard(open && keyboardViewportSettled, visualBottom, layoutHeight);
    if (open && !document.body?.classList?.contains('pm-mobile-document-scroll')) {
      // A document-scrolled iOS PWA can pan the visual viewport while the
      // fixed composer remains tied to the layout viewport. Correct the final
      // measured edge instead of guessing from the page's scroll position.
      _pmKbClearComposerShift();
      _pmKbAnchorComposer(visualBottom);
    }
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
  // iOS pans visualViewport.offsetTop (without necessarily resizing it) when
  // the user scrolls chat history while the keyboard stays open. Re-run the
  // same anchoring pass so the fixed composer remains locked to the keyboard
  // edge throughout that pan instead of drifting with the document.
  const _onVvScroll = () => { _scheduleKeyboardOffset(); };
  const _onWindowKeyboardResize = () => { _scheduleKeyboardOffset(); };
  const _pmVisualViewport = window.visualViewport || null;
  if (_pmVisualViewport) {
    _pmVisualViewport.addEventListener('resize', _onVvResize);
    _pmVisualViewport.addEventListener('scroll', _onVvScroll, { passive: true });
  }
  window.addEventListener('resize', _onWindowKeyboardResize, { passive: true });
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
    if (!seq) return true;
    if (!__pmChat.activeRuns || typeof __pmChat.activeRuns !== 'object') __pmChat.activeRuns = {};
    const run = __pmChat.activeRuns[requestedSession] || {};
    const previousStreamId = String(run.streamId || '').trim();
    const streamChanged = !!streamId && !!previousStreamId && streamId !== previousStreamId;
    const prevSeq = Math.max(0, Math.floor(Number(run.lastSeq || 0)) || 0);
    if (!streamChanged && seq <= prevSeq) return false;
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
              _appendMobileReasoningSummary(replayState, text);
            }
          }
          break;
        }
        case 'reasoning_summary_delta': {
          const text = String(evt.text || evt.summary || '');
          if (text) {
            _setMobileLiveProgressNarration(replayState, text);
            _appendMobileReasoningSummary(replayState, text);
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
    if (evt.type === 'error' && _isMobileRuntimeAbortEvent(evt) && aiTurn._pmAbortRequested === true) {
      _acknowledgeMobileExpectedAbortTurn(aiTurn);
      return 'aborted';
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
    const patchedFinal = _patchMobileThreadMessage(
      threadEl,
      committedFinalTurn?.source || aiTurn,
      _activeMobileThread().indexOf(aiTurn),
    );
    if (patchedFinal) {
      _syncMobileWorkTimer(threadEl, body, requestedSession);
      _restoreMobileChatScroll(body, scrollSnapshot);
    } else {
      renderThreadNow();
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
      const patchedFinal = _patchMobileThreadMessage(
        threadEl,
        committedFinalTurn?.source || targetAiTurn,
        activeThread.indexOf(targetAiTurn),
      );
      if (patchedFinal) {
        _syncMobileWorkTimer(threadEl, body, actualSessionId);
        _restoreMobileChatScroll(body, scrollSnapshot);
      } else {
        renderThreadNow();
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
    if (eventType === 'error' && _isMobileRuntimeAbortEvent({ ...data, ...msg, type: eventType })) {
      const expectedAbortTurn = _findMobileExpectedAbortTurn(activeThread, { ...data, ...msg });
      if (expectedAbortTurn) {
        _acknowledgeMobileExpectedAbortTurn(expectedAbortTurn);
        _clearMobileToolProgress(requestedSession);
        _renderMobileToolProgressDock(toolProgressDock, requestedSession);
        _clearMobileActiveRun(requestedSession);
        _markMobileSessionRunning(requestedSession, false);
        setBusy(false, requestedSession);
        renderThreadNow();
        return 'aborted';
      }
    }
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
    }
    if (isInternalWatchRun) aiTurn.messageKind = 'internal_watch_review';
    const evt = {
      ...data,
      type: eventType,
      seq: msg.seq || data?.seq,
      streamId: msg.streamId || data?.streamId,
      at: msg.at || data?.at,
    };
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
    applyMainChatStreamPayload({
      sessionId: sid,
      event,
      activeRunKind: 'main_chat_goal',
      streamId: msg.streamId,
      seq: msg.seq,
      at: msg.at,
      data: msg,
    });
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
      } else {
        pmSlashCommandSelectionIndex = e.key === 'ArrowDown'
          ? (pmSlashCommandSelectionIndex + 1) % suggestions.length
          : (pmSlashCommandSelectionIndex - 1 + suggestions.length) % suggestions.length;
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
  "_flushMobilePendingThinkingBurst": { enumerable: true, get: () => _flushMobilePendingThinkingBurst },
  "_formatBytes": { enumerable: true, get: () => _formatBytes },
  "_handleMobileCleanThought": { enumerable: true, get: () => _handleMobileCleanThought },
  "_handleMobileThinkingCallback": { enumerable: true, get: () => _handleMobileThinkingCallback },
  "_isMobileNewChatDraftActiveForVoice": { enumerable: true, get: () => _isMobileNewChatDraftActiveForVoice },
  "_markMobileSessionRunning": { enumerable: true, get: () => _markMobileSessionRunning },
  "_mergeMobileMediaIntoMessage": { enumerable: true, get: () => _mergeMobileMediaIntoMessage },
  "_mergeMobileSessionThreadWithLocal": { enumerable: true, get: () => _mergeMobileSessionThreadWithLocal },
  "_mobileAssistantWorkStartedAt": { enumerable: true, get: () => _mobileAssistantWorkStartedAt },
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
  "_nowTime": { enumerable: true, get: () => _nowTime },
  "_pmApprovalCanSave": { enumerable: true, get: () => _pmApprovalCanSave },
  "_pmApprovalTechnicalText": { enumerable: true, get: () => _pmApprovalTechnicalText },
  "_pmHasProcessRun": { enumerable: true, get: () => _pmHasProcessRun },
  "_pmHumanApproval": { enumerable: true, get: () => _pmHumanApproval },
  "_pmIsCommandApproval": { enumerable: true, get: () => _pmIsCommandApproval },
  "_pmLoadApprovalProcessRun": { enumerable: true, get: () => _pmLoadApprovalProcessRun },
  "_readMobileActiveRun": { enumerable: true, get: () => _readMobileActiveRun },
  "_recordMobileChatError": { enumerable: true, get: () => _recordMobileChatError },
  "_rememberMobileActiveRun": { enumerable: true, get: () => _rememberMobileActiveRun },
  "_rememberMobileLastChatSession": { enumerable: true, get: () => _rememberMobileLastChatSession },
  "_renderAgentVoicePicker": { enumerable: true, get: () => _renderAgentVoicePicker },
  "_renderMobileMediaGallery": { enumerable: true, get: () => _renderMobileMediaGallery },
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
  "denyMobileApproval": { enumerable: true, get: () => denyMobileApproval },
  "escapeHtml": { enumerable: true, get: () => escapeHtml },
  "getVoicePreviewDragStyle": { enumerable: true, get: () => getVoicePreviewDragStyle },
  "getVoicePreviewGestureOutcome": { enumerable: true, get: () => getVoicePreviewGestureOutcome },
  "invalidateMobileDrawerSessions": { enumerable: true, get: () => invalidateMobileDrawerSessions },
  "isCurrentGateway": { enumerable: true, get: () => isCurrentGateway },
  "loadMobileApprovals": { enumerable: true, get: () => loadMobileApprovals },
  "loadMobileChatSession": { enumerable: true, get: () => loadMobileChatSession },
  "loadMobileSubagents": { enumerable: true, get: () => loadMobileSubagents },
  "loadVoiceStatus": { enumerable: true, get: () => loadVoiceStatus },
  "mobileGatewayFetch": { enumerable: true, get: () => mobileGatewayFetch },
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
  "setMobileActiveGatewayTarget": { enumerable: true, get: () => setMobileActiveGatewayTarget },
  "stopMobileMainChat": { enumerable: true, get: () => stopMobileMainChat },
  "streamChat": { enumerable: true, get: () => streamChat },
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
